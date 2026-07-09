import { NextResponse, after } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { decrypt, encrypt, isLegacyFormat } from '@/lib/whatsapp/encryption'
import { getMediaUrl, downloadMedia, sendTextMessage, sendInteractiveCtaUrl, sendInteractiveButtons } from '@/lib/whatsapp/meta-api'
import { normalizePhone } from '@/lib/whatsapp/phone-utils'
import { findExistingContact, isUniqueViolation } from '@/lib/contacts/dedupe'
import { verifyMetaWebhookSignature } from '@/lib/whatsapp/webhook-signature'
import { runAutomationsForTrigger } from '@/lib/automations/engine'
import { dispatchInboundToFlows } from '@/lib/flows/engine'
import {
  handleTemplateWebhookChange,
  isTemplateWebhookField,
} from '@/lib/whatsapp/template-webhook'
import { generateAIReply } from '@/lib/ai/reply-generator'


// In-memory caches to bypass database lookups on every incoming webhook message
const webhookConfigCache = new Map<string, { config: any, expiresAt: number }>();
const contactConvCache = new Map<string, { contact: any, conversation: any, expiresAt: number }>();

// Lazy-initialized to avoid build-time crash when env vars are missing
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _adminClient: any = null
function supabaseAdmin() {
  if (!_adminClient) {
    _adminClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )
  }
  return _adminClient
}

interface WhatsAppMessage {
  id: string
  from: string
  timestamp: string
  type: string
  text?: { body: string }
  image?: { id: string; mime_type: string; caption?: string }
  video?: { id: string; mime_type: string; caption?: string }
  document?: { id: string; mime_type: string; filename?: string; caption?: string }
  audio?: { id: string; mime_type: string }
  sticker?: { id: string; mime_type: string }
  location?: { latitude: number; longitude: number; name?: string; address?: string }
  reaction?: { message_id: string; emoji: string }
  /**
   * Set when the customer taps a button or list row on an interactive
   * message we sent. `button_reply.id` / `list_reply.id` is whatever id
   * we put on the button/row when sending — the Flows engine uses this
   * to advance the per-contact run.
   */
  interactive?: {
    type: 'button_reply' | 'list_reply'
    button_reply?: { id: string; title: string }
    list_reply?: { id: string; title: string; description?: string }
  }
  button?: { text: string; payload?: string }
  /** Present when the customer swipe-replies to one of our messages. */
  context?: { id: string }
}

interface WhatsAppWebhookEntry {
  id: string
  changes: Array<{
    value: {
      messaging_product: string
      metadata: {
        display_phone_number: string
        phone_number_id: string
      }
      contacts?: Array<{
        profile: { name: string }
        wa_id: string
      }>
      messages?: WhatsAppMessage[]
      statuses?: Array<{
        id: string
        status: string
        timestamp: string
        recipient_id: string
      }>
    }
    field: string
  }>
}

// GET - Webhook verification
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const mode = searchParams.get('hub.mode')
    const challenge = searchParams.get('hub.challenge')
    const verifyToken = searchParams.get('hub.verify_token')

    if (mode !== 'subscribe' || !challenge || !verifyToken) {
      return NextResponse.json(
        { error: 'Missing verification parameters' },
        { status: 400 }
      )
    }

    // Fetch all whatsapp configs to check verify tokens
    const { data: configs, error: configError } = await supabaseAdmin()
      .from('whatsapp_config')
      .select('id, verify_token')

    if (configError || !configs) {
      console.error('Error fetching configs for verification:', configError)
      return NextResponse.json(
        { error: 'Verification failed' },
        { status: 403 }
      )
    }

    // Check if any config's verify_token matches. Also collect the
    // matching row so we can opportunistically upgrade its token to
    // GCM if it was still in the legacy CBC format.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let matchedConfig: any = null
    for (const config of configs) {
      if (!config.verify_token) continue
      try {
        if (decrypt(config.verify_token) === verifyToken) {
          matchedConfig = config
          break
        }
      } catch {
        // Malformed / wrong-key token row — skip it and keep checking.
      }
    }

    if (matchedConfig) {
      // Fire-and-forget GCM upgrade. Safe to run on every subscribe
      // since it's a no-op once the column is already GCM.
      if (isLegacyFormat(matchedConfig.verify_token)) {
        void supabaseAdmin()
          .from('whatsapp_config')
          .update({ verify_token: encrypt(verifyToken) })
          .eq('id', matchedConfig.id)
          .then(({ error }: { error: unknown }) => {
            if (error) {
              console.warn(
                '[webhook] verify_token GCM upgrade failed:',
                (error as { message?: string })?.message ?? error,
              )
            }
          })
      }
      // Return challenge as plain text
      return new Response(challenge, {
        status: 200,
        headers: { 'Content-Type': 'text/plain' },
      })
    }

    return NextResponse.json(
      { error: 'Verification token mismatch' },
      { status: 403 }
    )
  } catch (error) {
    console.error('Error in webhook GET verification:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

function runInBackground(promise: Promise<any>) {
  try {
    after(async () => {
      await promise;
    });
  } catch (err) {
    console.error('Failed to trigger after:', err);
    promise.catch((e) => console.error('Background execution fallback promise failed:', e));
  }
}

// POST - Receive messages
export async function POST(request: Request) {
  // Read raw body first so we can HMAC-verify the exact bytes Meta
  // signed. request.json() would re-encode and break the signature.
  const rawBody = await request.text()
  const signature = request.headers.get('x-hub-signature-256')

  if (!verifyMetaWebhookSignature(rawBody, signature)) {
    console.warn('[webhook] signature verification failed - attempting fallback database lookup...')
    try {
      const parsedBody = JSON.parse(rawBody)
      const phoneId = parsedBody?.entry?.[0]?.changes?.[0]?.value?.metadata?.phone_number_id
      if (phoneId) {
        // Query the database to check if this phone_number_id exists
        const { data: configExists, error: lookupError } = await supabaseAdmin()
          .from('whatsapp_config')
          .select('id')
          .eq('phone_number_id', phoneId)
          .maybeSingle()

        if (!lookupError && configExists) {
          console.log(`[webhook] signature verification failed but phone_number_id ${phoneId} exists in database. Processing message via fallback bypass.`)
          
          // Clear any previous registration error since it is now working via fallback
          await supabaseAdmin()
            .from('whatsapp_config')
            .update({ last_registration_error: null })
            .eq('id', configExists.id)
            
          // Proceed with processing in background
          runInBackground(
            processWebhook(parsedBody).catch((error) => {
              console.error('Error processing webhook in signature bypass fallback:', error)
            })
          )
          return NextResponse.json({ status: 'received' }, { status: 200 })
        } else {
          console.warn(`[webhook] signature verification failed and phoneId ${phoneId} was not found in database configs.`)
        }
      }
    } catch (e) {
      console.error('[webhook] failed to process signature bypass fallback:', e)
    }
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
  }

  let body: { entry?: WhatsAppWebhookEntry[] }
  try {
    body = JSON.parse(rawBody)
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  // Process in the background using runInBackground so Vercel keeps the lambda execution context alive
  // while returning 200 OK instantly to WhatsApp.
  runInBackground(
    processWebhook(body).catch((error) => {
      console.error('Error processing webhook in background:', error)
    })
  )
  
  return NextResponse.json({ status: 'received' }, { status: 200 })
}

async function processWebhook(body: { entry?: WhatsAppWebhookEntry[] }) {
  if (!body.entry) return

  for (const entry of body.entry) {
    for (const change of entry.changes) {
      // Template-lifecycle events (status / quality / components
      // updates from Meta) come in on a different change.field and
      // have a different value shape — route them through the
      // dedicated handler. Skip the messaging branches below so we
      // don't try to read message-shaped fields off a template event.
      if (isTemplateWebhookField(change.field)) {
        await handleTemplateWebhookChange(
          { field: change.field, value: change.value as unknown },
          supabaseAdmin(),
        )
        continue
      }

      const value = change.value

      // Handle status updates
      if (value.statuses) {
        for (const status of value.statuses) {
          await handleStatusUpdate(status)
        }
      }

      // Handle incoming messages
      if (!value.messages || !value.contacts) continue

      const phoneNumberId = value.metadata.phone_number_id

      // Check in-memory cache for whatsapp_config first (5 min TTL)
      let config: any = null
      const nowTs = Date.now()
      const cachedConfig = webhookConfigCache.get(phoneNumberId)
      if (cachedConfig && cachedConfig.expiresAt > nowTs) {
        config = cachedConfig.config
      } else {
        const { data: configRows, error: configError } = await supabaseAdmin()
          .from('whatsapp_config')
          .select('*')
          .eq('phone_number_id', phoneNumberId)

        if (configError) {
          console.error(
            'Error fetching whatsapp_config for phone_number_id:',
            phoneNumberId,
            configError
          )
          continue
        }

        if (!configRows || configRows.length === 0) {
          console.error('No config found for phone_number_id:', phoneNumberId)
          continue
        }

        if (configRows.length > 1) {
          console.error(
            `Multiple configs (${configRows.length}) found for phone_number_id:`,
            phoneNumberId,
            '— inbound message dropped.'
          )
          continue
        }

        config = configRows[0]
        webhookConfigCache.set(phoneNumberId, { config, expiresAt: nowTs + 300_000 })
      }

      if (configError) {
        console.error(
          'Error fetching whatsapp_config for phone_number_id:',
          phoneNumberId,
          configError
        )
        continue
      }

      if (!configRows || configRows.length === 0) {
        console.error('No config found for phone_number_id:', phoneNumberId)
        continue
      }

      if (configRows.length > 1) {
        console.error(
          `Multiple configs (${configRows.length}) found for phone_number_id:`,
          phoneNumberId,
          '— inbound message dropped. Resolve duplicates so each number maps to a single account.',
          'Account owners:',
          configRows.map((r: { account_id: string; user_id: string }) => `${r.account_id} (admin ${r.user_id})`)
        )
        continue
      }

      const config = configRows[0]

      const decryptedAccessToken = decrypt(config.access_token)

      for (let i = 0; i < value.messages.length; i++) {
        const message = value.messages[i]
        const contact = value.contacts[i] || value.contacts[0]

        await processMessage(
          message,
          contact,
          // Tenancy — drives every contact / conversation lookup
          // and the engines' active-row dispatch.
          config.account_id,
          // Audit / sender-of-record — used as the user_id on row
          // inserts that need it for NOT NULL FK compliance. Always
          // the admin who saved the WhatsApp config.
          config.user_id,
          decryptedAccessToken,
          config.phone_number_id
        )
      }
    }
  }
}

// The happy-path status ladder — pending → sent → delivered → read →
// replied. Webhook replays must never regress a recipient back down
// this ladder.
//
// `failed` is NOT on this ladder. It's a terminal side branch that is
// only valid from the early states (pending / sent) — once Meta has
// delivered or the user has read or replied, a later "failed" status
// event is a bug in Meta's pipeline or a spoof attempt and must be
// ignored.
const RECIPIENT_STATUS_LADDER = [
  'pending',
  'sent',
  'delivered',
  'read',
  'replied',
] as const

function ladderLevel(s: string): number {
  const idx = (RECIPIENT_STATUS_LADDER as readonly string[]).indexOf(s)
  return idx < 0 ? -1 : idx
}

/**
 * Can a recipient transition from `current` to `incoming`?
 *   - Along the ladder, only forward moves are allowed.
 *   - `failed` is accepted only from `pending` or `sent`; it's refused
 *     once the recipient has reached any of the success states.
 */
function isValidStatusTransition(current: string, incoming: string): boolean {
  if (incoming === 'failed') {
    return current === 'pending' || current === 'sent'
  }
  if (current === 'failed') {
    return false // failed is terminal
  }
  const ci = ladderLevel(current)
  const ii = ladderLevel(incoming)
  if (ii < 0) return false // unknown incoming status
  if (ci < 0) return true // unknown current — accept anything on the ladder
  return ii > ci
}

async function handleStatusUpdate(status: {
  id: string
  status: string
  timestamp: string
  recipient_id: string
  errors?: any[]
}) {
  const tsIso = new Date(parseInt(status.timestamp) * 1000).toISOString()
  const updatePayload: Record<string, any> = { status: status.status }
  
  if (status.status === 'delivered') {
    updatePayload.delivered_at = tsIso
  } else if (status.status === 'read') {
    updatePayload.read_at = tsIso
    try {
      const { data: existingMsg } = await supabaseAdmin()
        .from('messages')
        .select('delivered_at')
        .eq('message_id', status.id)
        .maybeSingle()
      if (!existingMsg?.delivered_at) {
        updatePayload.delivered_at = new Date((parseInt(status.timestamp) - 1) * 1000).toISOString()
      }
    } catch (e) {
      // Ignore query errors, fallback to setting read_at only
    }
  }

  // 1) Mirror onto messages (legacy behavior) — Meta's status values
  //    already match the CHECK constraint on messages.status.
  let { error: msgErr } = await supabaseAdmin()
    .from('messages')
    .update(updatePayload)
    .eq('message_id', status.id)

  // Fallback for backwards compatibility if table is not migrated yet
  if (msgErr && msgErr.message?.includes('column')) {
    const { error: fallbackErr } = await supabaseAdmin()
      .from('messages')
      .update({ status: status.status })
      .eq('message_id', status.id)
    msgErr = fallbackErr
  }

  if (msgErr) {
    console.error('Error updating message status:', msgErr)
  }

  // 1.5) Show friendly errors in the conversation list if delivery fails
  if (status.status === 'failed' && status.errors && status.errors.length > 0) {
    try {
      const errCode = status.errors[0]?.code;
      let friendlyError = '';
      
      if (errCode === 131026) {
        friendlyError = '❌ Delivery failed: This number is not on WhatsApp.';
      } else if (errCode === 131049) {
        friendlyError = '❌ Delivery blocked: WhatsApp spam filter (Wait 24h or get a reply first).';
      } else if (errCode === 131047) {
        friendlyError = '❌ Delivery failed: The customer has blocked your business.';
      } else {
        friendlyError = `❌ Delivery failed: Error code ${errCode}`;
      }

      // Find the message
      const { data: msgData } = await supabaseAdmin()
        .from('messages')
        .select('conversation_id')
        .eq('message_id', status.id)
        .maybeSingle()
        
      if (msgData?.conversation_id) {
        await supabaseAdmin()
          .from('conversations')
          .update({
            last_message_text: friendlyError,
            last_message_at: new Date().toISOString()
          })
          .eq('id', msgData.conversation_id)
      }
    } catch (e) {
      // ignore
    }
  }

  // 2) Mirror onto broadcast_recipients via whatsapp_message_id
  //    (added in migration 003). The aggregate trigger on
  //    broadcast_recipients re-derives the parent broadcast's
  //    sent/delivered/read/failed counts automatically.
  const { data: recipient, error: recFetchErr } = await supabaseAdmin()
    .from('broadcast_recipients')
    .select('id, status')
    .eq('whatsapp_message_id', status.id)
    .maybeSingle()

  if (recFetchErr) {
    console.error('Error fetching broadcast recipient:', recFetchErr)
    return
  }
  if (!recipient) return // message wasn't part of a broadcast — fine

  // Guard transitions — forward-only on the success ladder, and
  // `failed` only from pre-delivered states.
  if (!isValidStatusTransition(recipient.status, status.status)) return

  const update: Record<string, unknown> = { status: status.status }
  if (status.status === 'sent' && !('sent_at' in update)) update.sent_at = tsIso
  if (status.status === 'delivered') update.delivered_at = tsIso
  if (status.status === 'read') update.read_at = tsIso

  const { error: recUpdateErr } = await supabaseAdmin()
    .from('broadcast_recipients')
    .update(update)
    .eq('id', recipient.id)

  if (recUpdateErr) {
    console.error('Error updating broadcast recipient status:', recUpdateErr)
  }
}

/**
 * If an inbound message's sender is on a still-unreplied
 * broadcast_recipients row, flip it to `replied` so the reply count
 * advances on the parent broadcast.
 *
 * Runs on a best-effort basis — failures here must not break the
 * main inbound-message flow, so errors are swallowed with a log.
 */
async function flagBroadcastReplyIfAny(accountId: string, contactId: string) {
  try {
    // Most recent outbound broadcast in this account that hasn't
    // been replied to yet. Account-scoped so a shared inbox reply
    // marks the broadcast as replied regardless of which teammate
    // sent it.
    const { data: recs, error } = await supabaseAdmin()
      .from('broadcast_recipients')
      .select('id, status, broadcast_id, broadcasts!inner(account_id)')
      .eq('contact_id', contactId)
      .eq('broadcasts.account_id', accountId)
      .in('status', ['sent', 'delivered', 'read'])
      .order('created_at', { ascending: false })
      .limit(1)

    if (error || !recs || recs.length === 0) return

    const row = recs[0]
    const { error: updErr } = await supabaseAdmin()
      .from('broadcast_recipients')
      .update({ status: 'replied', replied_at: new Date().toISOString() })
      .eq('id', row.id)

    if (updErr) {
      console.error('Error marking broadcast recipient replied:', updErr)
    }
  } catch (err) {
    console.error('flagBroadcastReplyIfAny failed:', err)
  }
}

/**
 * Resolve a Meta-side message_id into the matching internal UUID, scoped
 * to one conversation. Returns null when we never received the parent
 * (e.g. a swipe-reply to a message older than this CRM install).
 */
async function lookupInternalIdByMetaId(
  metaId: string,
  conversationId: string
): Promise<string | null> {
  const { data, error } = await supabaseAdmin()
    .from('messages')
    .select('id')
    .eq('message_id', metaId)
    .eq('conversation_id', conversationId)
    .maybeSingle()
  if (error) {
    console.error('[webhook] lookupInternalIdByMetaId failed:', error.message)
    return null
  }
  return data?.id ?? null
}

/**
 * Persist an inbound reaction. WhatsApp reactions are not new messages —
 * they're per-(target, actor) state. We upsert / delete on
 * `message_reactions`, never write a row into `messages`.
 *
 * Best-effort: a missing parent (we never received it) is logged and
 * skipped so the webhook still acks 200 to Meta.
 */
async function handleReaction(
  message: WhatsAppMessage,
  conversationId: string,
  contactId: string
) {
  const reaction = message.reaction
  if (!reaction?.message_id) return

  const targetInternalId = await lookupInternalIdByMetaId(
    reaction.message_id,
    conversationId
  )
  if (!targetInternalId) {
    console.warn(
      '[webhook] reaction target message not found; skipping',
      reaction.message_id
    )
    return
  }

  // Empty emoji = removal (per Meta's Cloud API spec).
  if (!reaction.emoji) {
    const { error: delError } = await supabaseAdmin()
      .from('message_reactions')
      .delete()
      .eq('message_id', targetInternalId)
      .eq('actor_type', 'customer')
      .eq('actor_id', contactId)
    if (delError) {
      console.error('[webhook] reaction delete failed:', delError.message)
    }
    return
  }

  const { error: upsertError } = await supabaseAdmin()
    .from('message_reactions')
    .upsert(
      {
        message_id: targetInternalId,
        conversation_id: conversationId,
        actor_type: 'customer',
        actor_id: contactId,
        emoji: reaction.emoji,
      },
      { onConflict: 'message_id,actor_type,actor_id' }
    )
  if (upsertError) {
    console.error('[webhook] reaction upsert failed:', upsertError.message)
  }
}

async function isBotMutedForContact(supabase: any, contactId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from('contact_tags')
    .select('tags!inner(name)')
    .eq('contact_id', contactId)
    .eq('tags.name', 'Bot Muted')
  if (error) {
    console.error('[webhook] Error checking if bot is muted:', error)
    return false
  }
  return !!data && data.length > 0
}

function detectCountryFromPhone(phone: string): string {
  const phoneStr = (phone || '').replace(/\D/g, '');
  if (phoneStr.startsWith("91")) return "India";
  if (phoneStr.startsWith("1")) return "United States/Canada";
  if (phoneStr.startsWith("44")) return "United Kingdom";
  if (phoneStr.startsWith("61")) return "Australia";
  if (phoneStr.startsWith("64")) return "New Zealand";
  if (phoneStr.startsWith("65")) return "Singapore";
  if (phoneStr.startsWith("971")) return "UAE";
  if (phoneStr.startsWith("966")) return "Saudi Arabia";
  if (phoneStr.startsWith("974")) return "Qatar";
  if (phoneStr.startsWith("968")) return "Oman";
  if (phoneStr.startsWith("965")) return "Kuwait";
  if (phoneStr.startsWith("973")) return "Bahrain";
  if (phoneStr.startsWith("60")) return "Malaysia";
  if (phoneStr.startsWith("66")) return "Thailand";
  if (phoneStr.startsWith("63")) return "Philippines";
  if (phoneStr.startsWith("62")) return "Indonesia";
  if (phoneStr.startsWith("84")) return "Vietnam";
  if (phoneStr.startsWith("81")) return "Japan";
  if (phoneStr.startsWith("82")) return "South Korea";
  if (phoneStr.startsWith("55")) return "Brazil";
  if (phoneStr.startsWith("52")) return "Mexico";
  if (phoneStr.startsWith("27")) return "South Africa";
  if (phoneStr.startsWith("90")) return "Türkiye";
  return "International";
}

function getCountryPricingSummary(country: string): string {
  switch (country) {
    case "India":
      return `*💎 Starter - ₹8,999*\n• Up to 5 Premium Pages, Mobile & Tablet Optimized\n• Contact Form & WhatsApp Chat Button\n• Basic SEO & SSL Security Setup\n• 30 Days Free Support\n\n*🚀 Growth - ₹19,999 (Most Popular)*\n• Up to 15 Pages + Product/Service Catalog\n• Advanced UI/UX & Premium Animations\n• Lead Capture Forms & Analytics\n• Speed & Image Optimization\n• 60 Days Free Support\n\n*🛍️ Professional - ₹39,999*\n• Full E-commerce / Booking System\n• Secure Checkout & Payment Gateway\n• Customer Login & Management System\n• 90 Days Free Support\n\n*👑 Enterprise - ₹69,999+*\n• Custom UI/UX, AI Chatbot & CRM Integration`;
    case "United Kingdom":
      return `*💎 Starter - £249*\n• Up to 5 Premium Pages, Mobile Optimized\n\n*🚀 Growth - £499 (Most Popular)*\n• Up to 15 Pages, Animations, Lead Capture, Analytics\n\n*🛍️ Professional - £849*\n• Full E-commerce / Booking System\n\n*👑 Enterprise - £1,299+*\n• Custom UI/UX, AI Chatbot & CRM Integration`;
    case "Australia":
    case "New Zealand":
      return `*💎 Starter - A$449*\n• Up to 5 Premium Pages, Mobile Optimized\n\n*🚀 Growth - A$899 (Most Popular)*\n• Up to 15 Pages, Animations, Lead Capture, Analytics\n\n*🛍️ Professional - A$1,499*\n• Full E-commerce / Booking System\n\n*👑 Enterprise - A$2,199+*\n• Custom UI/UX, AI Chatbot & CRM Integration`;
    case "UAE":
    case "Saudi Arabia":
    case "Qatar":
    case "Kuwait":
    case "Bahrain":
    case "Oman":
      return `*💎 Starter - AED 1,499*\n• Up to 5 Premium Pages, Mobile Optimized\n\n*🚀 Growth - AED 2,499 (Most Popular)*\n• Up to 15 Pages, Animations, Lead Capture, Analytics\n\n*🛍️ Professional - AED 3,999*\n• Full E-commerce / Booking System\n\n*👑 Enterprise - AED 6,999+*\n• Custom UI/UX, AI Chatbot & CRM Integration`;
    default:
      return `*💎 Starter - $299*\n• Up to 5 Premium Pages, Mobile & Tablet Optimized\n• Contact Form & WhatsApp Chat Button\n• Basic SEO & SSL Security Setup\n• 30 Days Free Support\n\n*🚀 Growth - $599 (Most Popular)*\n• Up to 15 Pages + Product/Service Catalog\n• Advanced UI/UX & Premium Animations\n• Lead Capture Forms & Analytics\n• Speed & Image Optimization\n• 60 Days Free Support\n\n*🛍️ Professional - $999*\n• Full E-commerce / Booking System\n• Secure Checkout & Payment Gateway\n• Customer Login & Management System\n• 90 Days Free Support\n\n*👑 Enterprise - $1,500+*\n• Custom UI/UX, AI Chatbot & CRM Integration`;
  }
}

async function handleOutreachFlow(args: {
  accountId: string
  conversation: any
  contactRecord: any
  inboundText: string
  interactiveReplyId: string | null
  accessToken: string
  phoneNumberId: string
}): Promise<boolean> {
  const { accountId, conversation, contactRecord, inboundText, interactiveReplyId, accessToken, phoneNumberId } = args;
  
  // Only execute this flow for Nexvora / non-LoanPlus accounts
  if (accountId === '6b428da4-3ce6-47aa-8002-53296da16e9a') return false;

  const triggerInput = (interactiveReplyId || inboundText || '').trim().toLowerCase();
  const detectedCountry = detectCountryFromPhone(contactRecord.phone);

  const saveAndSend = async (text: string, messageId: string, contentType = 'text') => {
    try {
      await Promise.all([
        supabaseAdmin()
          .from('messages')
          .insert({
            conversation_id: conversation.id,
            sender_type: 'bot',
            content_type: contentType,
            content_text: text,
            message_id: messageId,
            status: 'sent',
          }),
        supabaseAdmin()
          .from('conversations')
          .update({
            last_message_text: text,
            last_message_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq('id', conversation.id),
      ]);
    } catch (e) {
      console.error('[webhook] Error saving outreach flow reply:', e);
    }
  };

  // 1) Get Pricing button clicked or requested
  if (/^(get pricing|pricing|price|view pricing|how much)$/i.test(triggerInput)) {
    const pricingSummary = getCountryPricingSummary(detectedCountry);
    const bodyText = `Here are our transparent investment packages tailored for your business in *${detectedCountry}*:\n\n${pricingSummary}\n\nPlease select an option below to proceed:`;
    
    try {
      const btnResult = await sendInteractiveButtons({
        phoneNumberId,
        accessToken,
        to: contactRecord.phone,
        bodyText,
        buttons: [
          { id: 'choose_package', title: 'Choose Package' },
          { id: 'about_us', title: 'About Us' },
          { id: 'not_interested', title: 'Not interested' }
        ]
      });
      saveAndSend(bodyText, btnResult.messageId, 'interactive');

      const ctaBody = 'Or explore our live designs and portfolio online right now:';
      const ctaResult = await sendInteractiveCtaUrl({
        phoneNumberId,
        accessToken,
        to: contactRecord.phone,
        bodyText: ctaBody,
        buttonText: 'Visit Portfolio',
        url: 'https://nexvora-ud88.onrender.com'
      });
      saveAndSend(ctaBody, ctaResult.messageId, 'interactive');
    } catch (err) {
      console.error('[webhook] Error in Get Pricing flow:', err);
    }
    return true;
  }

  // 2) Choose Package / Price button clicked
  if (/^(choose_package|choose package|select package|select plan|proceed|interested|starter|growth|professional|enterprise)$/i.test(triggerInput)) {
    const replyText = "Thank you so much for your interest! 🙏✨\n\nOur expert team will connect with you very soon to discuss your specific requirements, finalize your package, and get your premium website live in record time!\n\nIn the meantime, feel free to explore our live design concepts and portfolio below:";
    try {
      const txtResult = await sendTextMessage({
        phoneNumberId,
        accessToken,
        to: contactRecord.phone,
        text: replyText
      });
      saveAndSend(replyText, txtResult.messageId);

      const ctaResult = await sendInteractiveCtaUrl({
        phoneNumberId,
        accessToken,
        to: contactRecord.phone,
        bodyText: "Check out our live portfolio while our expert connects with you:",
        buttonText: "Visit Portfolio",
        url: "https://nexvora-ud88.onrender.com"
      });
      saveAndSend("Visit Portfolio: https://nexvora-ud88.onrender.com", ctaResult.messageId, 'interactive');
    } catch (err) {
      console.error('[webhook] Error in Choose Package flow:', err);
    }
    return true;
  }

  // 3) About Us clicked -> AI answers it + gives options
  if (/^(about_us|about us|about nexvora|who are you)$/i.test(triggerInput)) {
    const aboutText = "At *Nexvora*, founded by *Prince R Pandey*, we are an elite digital design and web engineering agency with *2+ years of experience* and over *20+ premium projects* delivered globally. ✨🚀\n\nWe specialize in transforming digital storefronts with ultra-modern animations, lightning-fast performance, and high-converting UX/UI tailored specifically to your brand to turn your visitors into paying customers.\n\nWhat would you like to explore next?";
    try {
      const btnResult = await sendInteractiveButtons({
        phoneNumberId,
        accessToken,
        to: contactRecord.phone,
        bodyText: aboutText,
        buttons: [
          { id: 'pricing', title: 'Get Pricing' },
          { id: 'customize', title: 'Customize Mine' },
          { id: 'not_interested', title: 'Not interested' }
        ]
      });
      saveAndSend(aboutText, btnResult.messageId, 'interactive');

      const ctaResult = await sendInteractiveCtaUrl({
        phoneNumberId,
        accessToken,
        to: contactRecord.phone,
        bodyText: "Explore our recent agency work on our portfolio:",
        buttonText: "Visit Portfolio",
        url: "https://nexvora-ud88.onrender.com"
      });
      saveAndSend("Portfolio Link: https://nexvora-ud88.onrender.com", ctaResult.messageId, 'interactive');
    } catch (err) {
      console.error('[webhook] Error in About Us flow:', err);
    }
    return true;
  }

  // 4) Not interested clicked
  if (/^(not_interested|not interested|no thanks|no needed)$/i.test(triggerInput)) {
    const replyText = "Thank you so much for your honest feedback! 🙏\n\nWe are constantly working to improve our services and designs. We will always be right here whenever you need us in the future for any website or digital solutions.\n\nWishing you and your business immense success and growth ahead! 😊🌟";
    try {
      const txtResult = await sendTextMessage({
        phoneNumberId,
        accessToken,
        to: contactRecord.phone,
        text: replyText
      });
      saveAndSend(replyText, txtResult.messageId);
    } catch (err) {
      console.error('[webhook] Error in Not Interested flow:', err);
    }
    return true;
  }

  // 5) Customize Mine clicked
  if (/^(customize|customize mine|customise|customise mine)$/i.test(triggerInput)) {
    const replyText = "Thank you for your interest in customizing your website! ✨🚀\n\nTo begin setting up your personalized design and features, could you please tell us the exact *Name of your Business*?";
    try {
      const txtResult = await sendTextMessage({
        phoneNumberId,
        accessToken,
        to: contactRecord.phone,
        text: replyText
      });
      saveAndSend(replyText, txtResult.messageId);
    } catch (err) {
      console.error('[webhook] Error in Customize Mine flow:', err);
    }
    return true;
  }

  // 6) Customer answers with their Business Name (after bot asked for "Name of your Business")
  const { data: lastBotMessages } = await supabaseAdmin()
    .from('messages')
    .select('content_text')
    .eq('conversation_id', conversation.id)
    .eq('sender_type', 'bot')
    .order('created_at', { ascending: false })
    .limit(1);

  const lastBotMsgText = lastBotMessages && lastBotMessages.length > 0 ? (lastBotMessages[0].content_text || '') : (conversation.last_message_text || '');
  if (/name of your business/i.test(lastBotMsgText) && inboundText.trim().length > 0) {
    const businessName = inboundText.trim();
    const pricingSummary = getCountryPricingSummary(detectedCountry);
    const bodyText = `Thank you for sharing, *${businessName}*! We would love to build and customize your dream website. ✨\n\nHere are our transparent pricing packages tailored for your business in *${detectedCountry}*:\n\n${pricingSummary}\n\nPlease select an option below to proceed:`;
    
    try {
      const btnResult = await sendInteractiveButtons({
        phoneNumberId,
        accessToken,
        to: contactRecord.phone,
        bodyText,
        buttons: [
          { id: 'choose_package', title: 'Choose Package' },
          { id: 'about_us', title: 'About Us' },
          { id: 'not_interested', title: 'Not interested' }
        ]
      });
      saveAndSend(bodyText, btnResult.messageId, 'interactive');

      const ctaBody = 'Or visit our portfolio right now:';
      const ctaResult = await sendInteractiveCtaUrl({
        phoneNumberId,
        accessToken,
        to: contactRecord.phone,
        bodyText: ctaBody,
        buttonText: 'Visit Portfolio',
        url: 'https://nexvora-ud88.onrender.com'
      });
      saveAndSend(ctaBody, ctaResult.messageId, 'interactive');
    } catch (err) {
      console.error('[webhook] Error in Customize Business Name flow:', err);
    }
    return true;
  }

  return false;
}

async function handleAIAutoReply(
  conversation: any,
  contact: any,
  accessToken: string,
  phoneNumberId: string
) {
  try {
    // 1) Fetch last 10 messages for context
    const { data: history, error: historyErr } = await supabaseAdmin()
      .from('messages')
      .select('sender_type, content_text, created_at, id, message_id')
      .eq('conversation_id', conversation.id)
      .order('created_at', { ascending: false })
      .limit(10)

    if (historyErr) {
      console.error('[webhook] Failed to fetch conversation history for AI bot:', historyErr)
      return
    }
    const sortedHistory = (history || []).reverse()
    const messagesFormatted = sortedHistory
      .map((m: any) => {
        const role = m.sender_type === 'customer' ? 'Customer' : 'Agent'
        return `${role}: ${m.content_text || `[${m.content_type || 'media'}]`}`
      })
      .join('\n')

    const phoneStr = contact.phone || '';
    const detectedCountry = detectCountryFromPhone(phoneStr);

    // 2) Define system instruction (prompt) based on account tenancy
    const accountId = conversation.account_id;
    let systemPrompt = '';

    if (accountId === '6b428da4-3ce6-47aa-8002-53296da16e9a') {
      // Rajesh Pandey's Account (Loan plus+)
      systemPrompt = `You are Loan plus+ AI, an elite Professional Loan Consultant & Financial Advisor, not just a customer service bot.
Your goal is to guide clients through loan applications, eligibility criteria, documentation, and consulting services.

BUSINESS CREDENTIALS:
- Business Name: *Loan plus+*
- Experience: *15+ years* of excellence in financial consulting
- Banking Partners: Associated with *50+ leading banks and NBFCs*
- Happy Customers: Served *7000+ satisfied clients*
- Loans Processed: Over *100+ Crore* in loans successfully processed
- Owner Name: *Rajesh Pandey*

CORE RULES:
1. NO PRICING TABLE: Do not quote any packages or development costs. All loan consultation, processing advice, and basic eligibility checks are handled as a service, and custom rates/eligibility criteria apply based on the applicant's profile, income, and bank choice.
2. LOAN KNOWLEDGE GRAPH: Assist clients with various types of loans: Home Loans, Business Loans, Personal Loans, Loan Against Property (LAP), and Car Loans.
3. CONTEXT MEMORY: Read the chat history carefully. Maintain the flow of conversation. If the user mentions "Business Loan" and then asks "What documents?", explain the documentation specifically for a Business Loan.
4. SOLUTION RECOMMENDATION: Recommend the best type of loan based on their need. Explain the benefits of applying through Loan plus+ (associated with 50+ banking partners, offering competitive interest rates, and seamless processing).
5. NEW CUSTOMER GREETING: When a new customer says "Hi" or starts a conversation, warmly welcome them to *Loan plus+* and present a clear menu with options like:
   1. *Apply for a New Loan*
   2. *Check Loan Eligibility*
   3. *Calculate Loan EMI*
   4. *Speak to a Loan Expert*

LANGUAGE & TONE:
- Match the user's language (English, Hindi, Hinglish).
- Be extremely polite, warm, and professional.
- FORMATTING: Format your replies clearly using emojis and bullet points for readability. Use WhatsApp's native bold formatting (*text*).

CUSTOMER DETAILS:
Phone Number: ${contact.phone}
Detected Country: ${detectedCountry}`;
    } else {
      // Prince Pandey / Default Account (Nexvora AI)
      systemPrompt = `You are Nexvora AI, an elite Professional Website Consultant & UX Expert, not just a customer service bot. 
Your goal is to guide clients through web development, design modifications, and project updates using the following core frameworks:

1. INTENT DETECTION: Do not give generic replies. Identify the exact intent (e.g., "Change UI" -> Website Modification; "Price" -> Pricing Inquiry).
2. CONTEXT MEMORY: Read the chat history carefully. If the user previously mentioned "Footer", and now says "Change color", infer they mean "Change Footer Color". Do not ask them to repeat themselves.
3. WEBSITE KNOWLEDGE GRAPH: Understand standard website structures (Navbar, Hero, About, Services, Portfolio, Pricing, Testimonials, FAQ, Contact, Footer).
4. COMPONENT HIERARCHY: Know the sub-components. If they say "Footer", know it contains: Logo, Address, Contact, Social Links, Newsletter, Copyright, Quick Links.
5. SMART FOLLOW-UP: NEVER ask open-ended questions if options can be predicted. Instead of "Can you explain?", ask "Which would you like to change? (Colors, Layout, Content, Icons, etc.)"
6. CONVERSATION STATE: Maintain the state. (e.g., Website Editing -> Footer -> Social Links).
7. UX CONSULTANT BRAIN: Think like a designer. If they want to change the footer, ask about their goal (e.g., Modern Look, Better Conversion, Better Branding, Mobile Experience).
8. SOLUTION RECOMMENDATION: Don't just ask, recommend! (e.g., "I recommend moving the contact info to the left and adding a newsletter section. Would you like to apply this?")
9. DYNAMIC QUICK REPLIES: Provide numbered bullet points for options so the user can easily select what they want next.
10. PROJECT MEMORY: Acknowledge that you are building their website. Maintain a professional, high-end agency tone.
11. NEW CUSTOMER GREETING: When a new customer says "Hi" or starts a conversation, warmly welcome them and present a clear menu with a dedicated section/option for "Improve My Existing Website" (for those who already have a site) alongside other options like "Build a New Website", "View Pricing", and "Speak to an Expert".
12. COMPANY FACTS: If asked about the owner, say the owner of Nexvora is **Prince R Pandey**. If asked about experience or projects, state that Nexvora has **2+ years of experience** building premium digital solutions and has successfully completed **20+ projects**.

PRICING KNOWLEDGE:
You must quote prices strictly from this table based on the customer's detected country:
- India (INR): Starter ₹8,999 | Growth ₹19,999 | Professional ₹39,999 | Enterprise ₹69,999+
- United States (USD): Starter $299 | Growth $599 | Professional $999 | Enterprise $1,500+
- United Kingdom (GBP): Starter £249 | Growth £499 | Professional £849 | Enterprise £1,299+
- Canada (CAD): Starter C$379 | Growth C$759 | Professional C$1,249 | Enterprise C$1,899+
- Australia (AUD): Starter A$449 | Growth A$899 | Professional A$1,499 | Enterprise A$2,199+
- New Zealand (NZD): Starter NZ$479 | Growth NZ$959 | Professional NZ$1,599 | Enterprise NZ$2,299+
- Europe (EUR): Starter €279 | Growth €559 | Professional €939 | Enterprise €1,399+
- Singapore (SGD): Starter S$389 | Growth S$779 | Professional S$1,299 | Enterprise S$1,899+
- UAE (AED): Starter AED 1,499 | Growth AED 2,499 | Professional AED 3,999 | Enterprise AED 6,999+
- Saudi Arabia (SAR): Starter SAR799 | Growth SAR1,599 | Professional SAR2,699 | Enterprise SAR3,999+
- Qatar (QAR): Starter QAR799 | Growth QAR1,599 | Professional QAR2,699 | Enterprise QAR3,999+
- Oman (OMR): Starter OMR79 | Growth OMR159 | Professional OMR269 | Enterprise OMR399+
- Kuwait (KWD): Starter KWD130 | Growth KWD300 | Professional KWD600 (💡 Note: The video sample we shared is an example of a 600 KWD project) | Enterprise KWD1,050+
- Bahrain (BHD): Starter BHD79 | Growth BHD159 | Professional BHD269 | Enterprise BHD399+
- Malaysia (MYR): Starter RM449 | Growth RM899 | Professional RM1,499 | Enterprise RM2,299+
- Thailand (THB): Starter ฿3,999 | Growth ฿7,999 | Professional ฿13,999 | Enterprise ฿19,999+
- Philippines (PHP): Starter ₱5,999 | Growth ₱11,999 | Professional ₱19,999 | Enterprise ₱29,999+
- Indonesia (IDR): Starter Rp1,699,000 | Growth Rp3,399,000 | Professional Rp5,699,000 | Enterprise Rp8,499,000+
- Vietnam (VND): Starter ₫4,999,000 | Growth ₫9,999,000 | Professional ₫16,999,000 | Enterprise ₫24,999,000+
- Japan (JPY): Starter ¥29,999 | Growth ¥59,999 | Professional ¥99,999 | Enterprise ¥149,999+
- South Korea (KRW): Starter ₩299,000 | Growth ₩599,000 | Professional ₩999,000 | Enterprise ₩1,499,000+
- Brazil (BRL): Starter R$699 | Growth R$1,399 | Professional R$2,299 | Enterprise R$3,499+
- Mexico (MXN): Starter MX$2,999 | Growth MX$5,999 | Professional MX$9,999 | Enterprise MX$14,999+
- South Africa (ZAR): Starter ZAR2,999 | Growth ZAR5,999 | Professional ZAR9,999 | Enterprise ZAR14,999+
- Türkiye (TRY): Starter ₺5,999 | Growth ₺11,999 | Professional ₺19,999 | Enterprise ₺29,999+

LANGUAGE & TONE:
- Match the user's language (English, Hindi, Hinglish).
- Be extremely polite, warm, and professional. 
- FORMATTING: Format your replies clearly using emojis and bullet points for readability. 
- BOLD TEXT: When listing options or highlighting key points (like sections of a website e.g. Header, Footer, Homepage), you MUST use WhatsApp's native bold formatting which is a single asterisk on each side. Like this: *Header*, *Footer*. Do NOT use markdown double asterisks (like **Header**).
- Do not prefix your reply with "Nexvora:" or "Bot:". Just reply directly.
  
CUSTOMER DETAILS:
Phone Number: ${contact.phone}
Detected Country: ${detectedCountry}`;
    }

    // 3) Call AI API
    const replyText = await generateAIReply(messagesFormatted, systemPrompt)
    if (!replyText) {
      console.warn('[webhook] AI generated an empty response.')
      return
    }

    console.log(`[webhook] AI Bot sending reply to ${contact.phone}: ${replyText}`)

    // Find the last customer message's message_id to reply in context (swipe-reply)
    const lastCustomerMsg = sortedHistory
      .slice()
      .reverse()
      .find((m: any) => m.sender_type === 'customer')
    const contextMessageId = lastCustomerMsg?.message_id

    // 4) Send message via WhatsApp Meta API
    const result = await sendTextMessage({
      phoneNumberId,
      accessToken,
      to: contact.phone,
      text: replyText,
      contextMessageId,
    })

    // 5) Save response to DB under sender_type = 'bot'
    const { error: insertErr } = await supabaseAdmin()
      .from('messages')
      .insert({
        conversation_id: conversation.id,
        sender_type: 'bot',
        content_type: 'text',
        content_text: replyText,
        message_id: result.messageId,
        status: 'sent',
        reply_to_message_id: lastCustomerMsg?.id || null,
      })

    if (insertErr) {
      console.error('[webhook] Failed to save bot message to DB:', insertErr)
      return
    }

    // 6) Update conversation last_message_text
    await supabaseAdmin()
      .from('conversations')
      .update({
        last_message_text: replyText,
        last_message_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', conversation.id)

    // 7) If the user clicked 'Interested' on the outreach template, follow up with the portfolio button
    const isInterested = lastCustomerMsg && lastCustomerMsg.content_text && lastCustomerMsg.content_text.toLowerCase().includes('interested');
    if (isInterested) {
      try {
        const isLoanPlus = accountId === '6b428da4-3ce6-47aa-8002-53296da16e9a';
        const bodyText = isLoanPlus
          ? 'Aap hamari banking services aur profile dekhne ke liye humari website visit kar sakte hain!'
          : 'You can visit our portfolio to see our recent work!';
        const buttonText = isLoanPlus ? 'Visit Website' : 'Visit on our Website';
        const url = isLoanPlus ? 'https://loan-plus.onrender.com' : 'https://nexvora-ud88.onrender.com';

        const ctaResult = await sendInteractiveCtaUrl({
          phoneNumberId,
          accessToken,
          to: contact.phone,
          bodyText,
          buttonText,
          url
        })
        
        await supabaseAdmin()
          .from('messages')
          .insert({
            conversation_id: conversation.id,
            sender_type: 'bot',
            content_type: 'interactive',
            content_text: bodyText,
            message_id: ctaResult.messageId,
            status: 'sent',
          })
          
        await supabaseAdmin()
          .from('conversations')
          .update({
            last_message_text: bodyText,
            last_message_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq('id', conversation.id)
      } catch (ctaErr) {
        console.error('[webhook] Failed to send CTA URL button:', ctaErr)
      }
    }

  } catch (err) {
    console.error('[webhook] AI auto-reply failed:', err)
  }
}

async function processMessage(
  message: WhatsAppMessage,
  contact: { profile: { name: string }; wa_id: string },
  // Tenancy. Resolved from the matched whatsapp_config row; every
  // contact / conversation / message row created downstream is
  // stamped with this so any member of the account can see it.
  accountId: string,
  // Sender-of-record for inserts that need a NOT NULL user_id FK
  // (contacts, conversations). Always the admin who saved the
  // WhatsApp config; the choice is arbitrary post-017 but stable.
  configOwnerUserId: string,
  accessToken: string,
  phoneNumberId: string
) {
  const senderPhone = normalizePhone(message.from)
  const contactName = contact.profile.name

  // Find or create contact
  const contactOutcome = await findOrCreateContact(
    accountId,
    configOwnerUserId,
    senderPhone,
    contactName
  )
  if (!contactOutcome) return
  const contactRecord = contactOutcome.contact

  // Find or create conversation
  const conversation = await findOrCreateConversation(
    accountId,
    configOwnerUserId,
    contactRecord.id
  )
  if (!conversation) return

  // Reactions short-circuit here — they aren't messages. We never insert
  // into `messages`, never bump unread_count, never update last_message_text.
  // Done before parseMessageContent so the media-URL fetch is skipped.
  if (message.type === 'reaction') {
    await handleReaction(message, conversation.id, contactRecord.id)
    return
  }

  // Parse message content based on type
  const { contentText, mediaUrl, mediaType, interactiveReplyId } =
    await parseMessageContent(message, accessToken)

  // Resolve swipe-reply context if present. A missing parent is fine —
  // we just store NULL and the UI renders the message without a quote.
  let replyToInternalId: string | null = null
  if (message.context?.id) {
    replyToInternalId = await lookupInternalIdByMetaId(
      message.context.id,
      conversation.id
    )
    if (!replyToInternalId) {
      console.warn(
        '[webhook] reply context parent not found:',
        message.context.id
      )
    }
  }

  // Insert message — field names MUST match the messages table schema
  // (see supabase/migrations/001_initial_schema.sql):
  //   conversation_id, sender_type, content_type, content_text,
  //   media_url, template_name, message_id, status, created_at
  // `mediaType` is intentionally unused — the schema has no media_type
  // column; the MIME type is only used to construct the proxy URL during
  // parseMessageContent. Silence the unused-var warning:
  void mediaType

  // The messages.content_type CHECK constraint (widened in migration 010
  // to add 'interactive' for button/list taps) allows:
  //   text, image, document, audio, video, location, template, interactive
  // Map incoming WhatsApp types that aren't in that list to the closest
  // allowed value so the INSERT doesn't fail with a constraint error.
  const ALLOWED_CONTENT_TYPES = new Set([
    'text', 'image', 'document', 'audio', 'video',
    'location', 'template', 'interactive',
  ])
  const contentType = ALLOWED_CONTENT_TYPES.has(message.type)
    ? message.type
    : message.type === 'sticker'
      ? 'image'   // stickers are images
      : 'text'    // reaction, unknown → text fallback

  // Determine whether this is the contact's very first inbound message
  // BEFORE we insert, so the count is accurate. Covers the case where
  // the contact row already exists (manual add / CSV import) but they've
  // never messaged us before — which new_contact_created wouldn't catch.
  const { count: priorCustomerMsgCount } = await supabaseAdmin()
    .from('messages')
    .select('id', { count: 'exact', head: true })
    .eq('conversation_id', conversation.id)
    .eq('sender_type', 'customer')
  const isFirstInboundMessage = (priorCustomerMsgCount ?? 0) === 0

  // Parallelize message insertion, conversation update, and broadcast flag check
  await Promise.all([
    supabaseAdmin().from('messages').insert({
      conversation_id: conversation.id,
      sender_type: 'customer',
      content_type: contentType,
      content_text: contentText,
      media_url: mediaUrl,
      message_id: message.id,
      status: 'delivered',
      created_at: new Date(parseInt(message.timestamp) * 1000).toISOString(),
      reply_to_message_id: replyToInternalId,
      interactive_reply_id: interactiveReplyId,
    }),
    supabaseAdmin()
      .from('conversations')
      .update({
        last_message_text: contentText || `[${message.type}]`,
        last_message_at: new Date().toISOString(),
        unread_count: (conversation.unread_count || 0) + 1,
        updated_at: new Date().toISOString(),
      })
      .eq('id', conversation.id),
    flagBroadcastReplyIfAny(accountId, contactRecord.id)
  ]);

  // ============================================================
  // Flow runner dispatch.
  //
  // If the runner consumes the message (it either advanced an active
  // run or started a new one), we suppress the `new_message_received`
  // + `keyword_match` automation triggers for this inbound. Customer
  // is navigating the bot menu, not sending a fresh trigger word
  // that should fork into automations.
  //
  // The relationship-level triggers (`new_contact_created`,
  // `first_inbound_message`) still fire even when consumed — those
  // are about WHO is messaging, not what they said.
  //
  // Awaited (not fire-and-forget) because we need the `consumed`
  // result before deciding whether to dispatch automations. The
  // runner has its own try/catch and never throws. Accounts with
  // no active flows take the runner's early-exit "no_match" path
  // basically for free (one indexed SELECT for the active run).
  // ============================================================
  let outreachConsumed = false;
  if (accountId !== '6b428da4-3ce6-47aa-8002-53296da16e9a') {
    outreachConsumed = await handleOutreachFlow({
      accountId,
      conversation,
      contactRecord,
      inboundText: contentText ?? message.text?.body ?? '',
      interactiveReplyId,
      accessToken,
      phoneNumberId
    });
  }

  const flowResult = !outreachConsumed ? await dispatchInboundToFlows({
    accountId,
    userId: configOwnerUserId,
    contactId: contactRecord.id,
    conversationId: conversation.id,
    message:
      interactiveReplyId
        ? {
            kind: 'interactive_reply',
            reply_id: interactiveReplyId,
            reply_title: contentText ?? '',
            meta_message_id: message.id,
          }
        : {
            kind: 'text',
            text: contentText ?? message.text?.body ?? '',
            meta_message_id: message.id,
          },
    isFirstInboundMessage,
  }) : { consumed: true };
  const flowConsumed = outreachConsumed || flowResult.consumed

  // Fire any automations that react to this webhook event. All dispatches
  // run here (not earlier) so the contact, conversation, and inbound
  // message all exist before any step — including send_message — runs.
  // Fire-and-forget: a slow or failing automation must not block the
  // webhook's 200 OK response to Meta.
  const inboundText = contentText ?? message.text?.body ?? ''
  const automationTriggers: (
    | 'new_contact_created'
    | 'first_inbound_message'
    | 'new_message_received'
    | 'keyword_match'
  )[] = []
  // Content-level triggers are suppressed when a flow consumed the
  // message — see the comment block above.
  if (!flowConsumed) {
    automationTriggers.push('new_message_received', 'keyword_match')
  }
  // new_contact_created fires only when the webhook just auto-created the
  // contact row. first_inbound_message fires whenever this is the contact's
  // first-ever customer-sent message — a superset that also catches
  // manually-imported contacts sending for the first time. We dispatch both
  // so users can pick whichever semantic they want; an automation that
  // listens to only one trigger runs only when that trigger matches.
  if (contactOutcome.wasCreated) automationTriggers.unshift('new_contact_created')
  if (isFirstInboundMessage) automationTriggers.unshift('first_inbound_message')
  for (const triggerType of automationTriggers) {
    runAutomationsForTrigger({
      accountId,
      triggerType,
      contactId: contactRecord.id,
      context: {
        message_text: inboundText,
        conversation_id: conversation.id,
      },
    }).catch((err) => console.error('[automations] dispatch failed:', err))
  }

  // Trigger AI Auto-reply synchronously if not consumed by a Flow
  if (!flowConsumed) {
    try {
      const muted = await isBotMutedForContact(supabaseAdmin(), contactRecord.id)
      if (!muted) {
        await handleAIAutoReply(conversation, contactRecord, accessToken, phoneNumberId)
      } else {
        console.log(`[webhook] AI Bot is muted for contact ${contactRecord.phone}`)
      }
    } catch (err) {
      console.error('[webhook] AI auto reply logic failed:', err)
    }
  }
}

async function parseMessageContent(
  message: WhatsAppMessage,
  accessToken: string
): Promise<{
  contentText: string | null
  mediaUrl: string | null
  mediaType: string | null
  /**
   * For interactive button / list replies: the stable id of the tapped
   * option (whatever we put on the button when sending). Used by the
   * Flows engine to advance the per-contact run; persisted to
   * `messages.interactive_reply_id` so the inbox bubble can render the
   * tap with the right affordance. Null for everything else.
   */
  interactiveReplyId: string | null
}> {
  // getMediaUrl signature is (mediaId, accessToken) — earlier code had
  // the args swapped, so every verification hit an invalid Meta URL and
  // fell through to the catch block, leaving mediaUrl as null. That's
  // why images showed up as empty bubbles in the inbox.
  const verifyAndBuildUrl = async (
    mediaId: string
  ): Promise<string | null> => {
    try {
      await getMediaUrl({ mediaId, accessToken })
      return `/api/whatsapp/media/${mediaId}`
    } catch (error) {
      console.error(
        `Failed to verify media ${mediaId} with Meta:`,
        error instanceof Error ? error.message : error
      )
      return null
    }
  }

  // Default shape — each case overrides only the fields it cares about.
  // Keeps the new `interactiveReplyId` field DRY across every return site.
  const empty = {
    contentText: null,
    mediaUrl: null,
    mediaType: null,
    interactiveReplyId: null,
  }

  switch (message.type) {
    case 'text':
      return { ...empty, contentText: message.text?.body || null }

    case 'image':
      if (message.image?.id) {
        return {
          ...empty,
          contentText: message.image.caption || null,
          mediaUrl: await verifyAndBuildUrl(message.image.id),
          mediaType: message.image.mime_type,
        }
      }
      return empty

    case 'video':
      if (message.video?.id) {
        return {
          ...empty,
          contentText: message.video.caption || null,
          mediaUrl: await verifyAndBuildUrl(message.video.id),
          mediaType: message.video.mime_type,
        }
      }
      return empty

    case 'document':
      if (message.document?.id) {
        return {
          ...empty,
          contentText:
            message.document.caption || message.document.filename || null,
          mediaUrl: await verifyAndBuildUrl(message.document.id),
          mediaType: message.document.mime_type,
        }
      }
      return empty

    case 'audio':
      if (message.audio?.id) {
        return {
          ...empty,
          mediaUrl: await verifyAndBuildUrl(message.audio.id),
          mediaType: message.audio.mime_type,
        }
      }
      return empty

    case 'sticker':
      // Stickers are images under the hood. Treat them as such so the
      // MessageBubble renders the <img>. The caller maps the DB
      // content_type to 'image' for the CHECK constraint.
      if (message.sticker?.id) {
        return {
          ...empty,
          mediaUrl: await verifyAndBuildUrl(message.sticker.id),
          mediaType: message.sticker.mime_type,
        }
      }
      return empty

    case 'location':
      if (message.location) {
        const loc = message.location
        const locationText = [loc.name, loc.address, `${loc.latitude},${loc.longitude}`]
          .filter(Boolean)
          .join(' - ')
        return { ...empty, contentText: locationText }
      }
      return empty

    case 'reaction':
      return { ...empty, contentText: message.reaction?.emoji || null }

    case 'interactive': {
      // The customer tapped a reply button or a list row on a message
      // we previously sent. Meta delivers `interactive.button_reply` for
      // 3-button messages and `interactive.list_reply` for list messages.
      // Use the human-readable title as contentText so the inbox bubble
      // renders the tap legibly ("Existing customer"), and stash the
      // stable id separately so the Flows engine can route on it.
      const reply =
        message.interactive?.button_reply ?? message.interactive?.list_reply
      if (reply?.id) {
        return {
          ...empty,
          contentText: reply.title || reply.id,
          interactiveReplyId: reply.id,
        }
      }
      return { ...empty, contentText: '[Interactive reply]' }
    }

    case 'button': {
      // The customer tapped a quick reply button on a template message.
      // Meta delivers this with type "button" and button details under `message.button`.
      const button = message.button
      if (button) {
        return {
          ...empty,
          contentText: button.text || button.payload || '[Button Click]',
          interactiveReplyId: button.payload || null,
        }
      }
      return empty
    }

    default:
      return {
        ...empty,
        contentText: `[Unsupported message type: ${message.type}]`,
      }
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ContactRow = any

interface ContactOutcome {
  contact: ContactRow
  /** True when this call created the row; drives new_contact_created
   *  automation dispatch in processMessage. */
  wasCreated: boolean
}

async function findOrCreateContact(
  accountId: string,
  configOwnerUserId: string,
  phone: string,
  name: string
): Promise<ContactOutcome | null> {
  const cacheKey = `${accountId}:${phone}`
  const nowTs = Date.now()
  const cached = contactConvCache.get(cacheKey)
  if (cached && cached.expiresAt > nowTs && cached.contact) {
    if (name && name !== cached.contact.name) {
      cached.contact.name = name
      supabaseAdmin()
        .from('contacts')
        .update({ name, updated_at: new Date().toISOString() })
        .eq('id', cached.contact.id)
        .then()
    }
    return { contact: cached.contact, wasCreated: false }
  }

  // Find an existing contact for this account by phone. The shared
  // helper pre-filters in SQL by the last-8-digit suffix (so we don't
  // pull every contact on every inbound message) then applies the
  // strict `phonesMatch` in JS on the small candidate set. The same
  // helper backs the manual contact form and CSV import, so all three
  // paths agree on what "same number" means (issue #212).
  const existingContact = await findExistingContact(
    supabaseAdmin(),
    accountId,
    phone,
  )

  if (existingContact) {
    // Update name if it changed
    if (name && name !== existingContact.name) {
      await supabaseAdmin()
        .from('contacts')
        .update({ name, updated_at: new Date().toISOString() })
        .eq('id', existingContact.id)
    }
    const cacheKey = `${accountId}:${phone}`
    const cached = contactConvCache.get(cacheKey) || { contact: null, conversation: null, expiresAt: 0 }
    contactConvCache.set(cacheKey, { ...cached, contact: existingContact, expiresAt: Date.now() + 120_000 })
    return { contact: existingContact, wasCreated: false }
  }

  // Create new contact. account_id is the tenancy column;
  // user_id is the NOT NULL FK audit column (no inbound message
  // has a single "user who created" it — we attribute to the
  // WhatsApp config owner as a stable default).
  const { data: newContact, error: createError } = await supabaseAdmin()
    .from('contacts')
    .insert({
      account_id: accountId,
      user_id: configOwnerUserId,
      phone,
      name: name || phone,
    })
    .select()
    .single()

  if (createError) {
    // Lost a race: a concurrent inbound delivery (or another path)
    // created this contact between our lookup and insert, and the
    // unique index (migration 022) rejected the duplicate. Re-resolve
    // the existing row instead of dropping the message.
    if (isUniqueViolation(createError)) {
      const raced = await findExistingContact(supabaseAdmin(), accountId, phone)
      if (raced) return { contact: raced, wasCreated: false }
    }
    console.error('Error creating contact:', createError)
    return null
  }

  const cacheKey = `${accountId}:${newContact.phone}`
  const cached = contactConvCache.get(cacheKey) || { contact: null, conversation: null, expiresAt: 0 }
  contactConvCache.set(cacheKey, { ...cached, contact: newContact, expiresAt: Date.now() + 120_000 })
  return { contact: newContact, wasCreated: true }
}

async function findOrCreateConversation(
  accountId: string,
  configOwnerUserId: string,
  contactId: string,
) {
  // Check if we have conversation cached by contactId
  const nowTs = Date.now()
  for (const [key, value] of contactConvCache.entries()) {
    if (value.contact && value.contact.id === contactId && value.conversation && value.expiresAt > nowTs) {
      return value.conversation
    }
  }

  // Look for existing conversation in this account
  const { data: existing, error: findError } = await supabaseAdmin()
    .from('conversations')
    .select('*')
    .eq('account_id', accountId)
    .eq('contact_id', contactId)
    .single()

  if (!findError && existing) {
    for (const [key, value] of contactConvCache.entries()) {
      if (value.contact && value.contact.id === contactId) {
        contactConvCache.set(key, { ...value, conversation: existing, expiresAt: Date.now() + 120_000 })
      }
    }
    return existing
  }

  // Create new conversation. Same tenancy + audit split as
  // findOrCreateContact above.
  const { data: newConv, error: createError } = await supabaseAdmin()
    .from('conversations')
    .insert({
      account_id: accountId,
      user_id: configOwnerUserId,
      contact_id: contactId,
    })
    .select()
    .single()

  if (createError) {
    console.error('Error creating conversation:', createError)
    return null
  }

  for (const [key, value] of contactConvCache.entries()) {
    if (value.contact && value.contact.id === contactId) {
      contactConvCache.set(key, { ...value, conversation: newConv, expiresAt: Date.now() + 120_000 })
    }
  }

  return newConv
}
