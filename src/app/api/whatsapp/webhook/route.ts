import { NextResponse, after } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { decrypt, encrypt, isLegacyFormat } from '@/lib/whatsapp/encryption'
import { getMediaUrl, downloadMedia, sendTextMessage, sendInteractiveCtaUrl, sendInteractiveButtons, sendInteractiveList } from '@/lib/whatsapp/meta-api'
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
import { isOwnerPhone, handleOwnerAssistantQuery } from '@/lib/ai/owner-assistant'


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

      if (!config) continue

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
    case "Oman":
      return `*💎 Starter - AED 1,499*\n• Up to 5 Premium Pages, Mobile Optimized\n\n*🚀 Growth - AED 2,499 (Most Popular)*\n• Up to 15 Pages, Animations, Lead Capture, Analytics\n\n*🛍️ Professional - AED 3,999*\n• Full E-commerce / Booking System\n\n*👑 Enterprise - AED 6,999+*\n• Custom UI/UX, AI Chatbot & CRM Integration`;
    case "Bahrain":
      return `*💎 Starter - 299 BHD*\n• Up to 5 Premium Pages, Mobile Optimized\n\n*🚀 Growth - 599 BHD (Most Popular)*\n• Up to 15 Pages, Animations, Lead Capture, Analytics\n\n*🛍️ Professional - 999 BHD*\n• Full E-commerce / Booking System\n\n*👑 Enterprise - 1499-2999+ BHD*\n• Custom UI/UX, AI Chatbot & CRM Integration`;
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
    const replyText = "Thank you so much for your interest! 😊✨\n\nOur expert team will connect with you very soon to discuss your specific requirements, finalize your package, and get your premium website live in record time!\n\nIn the meantime, feel free to explore our live design concepts and portfolio below:";
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
    const replyText = "Thank you so much for your honest feedback! 😊\n\nWe are constantly working to improve our services and designs. We will always be right here whenever you need us in the future for any website or digital solutions.\n\nWishing you and your business immense success and growth ahead! 😊🌟";
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

async function handleLoanPlusFlow(args: {
  accountId: string
  conversation: any
  contactRecord: any
  inboundText: string
  interactiveReplyId: string | null
  accessToken: string
  phoneNumberId: string
}): Promise<boolean> {
  const { accountId, conversation, contactRecord, inboundText, interactiveReplyId, accessToken, phoneNumberId } = args;
  
  if (accountId !== '6b428da4-3ce6-47aa-8002-53296da16e9a') return false;

  const triggerInput = (interactiveReplyId || inboundText || '').trim().toLowerCase();

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
      console.error('[webhook] Error saving LoanPlus flow reply:', e);
    }
  };

  // Get last bot message to check context/state
  const { data: lastBotMessages } = await supabaseAdmin()
    .from('messages')
    .select('content_text')
    .eq('conversation_id', conversation.id)
    .eq('sender_type', 'bot')
    .order('created_at', { ascending: false })
    .limit(1);

  const lastBotMsgText = (lastBotMessages && lastBotMessages.length > 0 ? (lastBotMessages[0].content_text || '') : (conversation.last_message_text || '')).toLowerCase();

  let userLang = 'hinglish';
  // Check current message first
  if (triggerInput.includes('gujarati') || triggerInput === 'lang_gujarati') { userLang = 'gujarati'; }
  else if (triggerInput.includes('hindi') || triggerInput === 'lang_hindi') { userLang = 'hindi'; }
  else if (triggerInput.includes('english') || triggerInput === 'lang_english') { userLang = 'english'; }
  else if (triggerInput.includes('tamil') || triggerInput === 'lang_tamil') { userLang = 'tamil'; }
  
  // If not detected from current message, scan past customer messages
  if (userLang === 'hinglish') {
    try {
      const { data: customerMessages } = await supabaseAdmin()
        .from('messages')
        .select('content_text')
        .eq('conversation_id', conversation.id)
        .eq('sender_type', 'customer')
        .order('created_at', { ascending: false })
        .limit(10);
      
      if (customerMessages) {
        for (const msg of customerMessages) {
          const t = (msg.content_text || '').toLowerCase();
          if (t.includes('gujarati') || t === 'lang_gujarati') { userLang = 'gujarati'; break; }
          if (t.includes('hindi') || t === 'lang_hindi') { userLang = 'hindi'; break; }
          if (t.includes('english') || t === 'lang_english') { userLang = 'english'; break; }
          if (t.includes('tamil') || t === 'lang_tamil') { userLang = 'tamil'; break; }
        }
      }
    } catch(e) {}
  }
  
  // Final fallback: if bot has already sent Gujarati text, user must have chosen Gujarati
  if (userLang === 'hinglish') {
    try {
      const { data: botMsgs } = await supabaseAdmin()
        .from('messages')
        .select('content_text')
        .eq('conversation_id', conversation.id)
        .eq('sender_type', 'bot')
        .order('created_at', { ascending: false })
        .limit(5);
      
      if (botMsgs) {
        for (const msg of botMsgs) {
          const t = (msg.content_text || '');
          // Check for Gujarati Unicode range (0A80–0AFF)
          if (/[\u0A80-\u0AFF]/.test(t)) { userLang = 'gujarati'; break; }
        }
      }
    } catch(e) {}
  }


  // ------------------------------------------------------------
  // STEP 1: "Call To Advisor" button clicked OR any time they click call advisor
  // ------------------------------------------------------------
  if (/^(call_to_advisor|call to advisor|call pe baat|call pe baat karne par|btn_call_advisor)$/i.test(triggerInput)) {
    const replyText = userLang === 'gujarati' ? "😊 રસ દાખવવા બદલ આભાર, અમે ટૂંક સમયમાં તમારો સંપર્ક કરીશું." : "😊 Interest dikhane ke liye Thank you ham jaldi aapko sampark karenge.";
    try {
      const txtResult = await sendTextMessage({
        phoneNumberId,
        accessToken,
        to: contactRecord.phone,
        text: replyText
      });
      saveAndSend(replyText, txtResult.messageId);
    } catch (err) {
      console.error('[webhook] Error in LoanPlus Call Advisor flow:', err);
    }
    return true;
  }

  // ------------------------------------------------------------
  // STEP 2: "I want Loan" clicked -> Ask Language selection (Gujarati, Hindi, English, Tamil)
  // ------------------------------------------------------------
  if (/^(i_want_loan|i want loan|loan chahiye|apply loan|get loan|loan)$/i.test(triggerInput)) {
    const bodyText = "😊 Welcome to *Loan plus+*! Kripya apni bhasha chunein / Please select your preferred language:";
    try {
      // Use interactive list because there are 4 options (buttons max is 3)
      const listResult = await sendInteractiveList({
        phoneNumberId,
        accessToken,
        to: contactRecord.phone,
        bodyText,
        buttonLabel: "Select Language",
        sections: [
          {
            title: "Language / Bhasha",
            rows: [
              { id: 'lang_gujarati', title: 'Gujarati' },
              { id: 'lang_hindi', title: 'Hindi' },
              { id: 'lang_english', title: 'English' },
              { id: 'lang_tamil', title: 'Tamil' }
            ]
          }
        ]
      });
      saveAndSend(bodyText, listResult.messageId, 'interactive');
    } catch (err) {
      console.error('[webhook] Error in LoanPlus I want Loan step:', err);
    }
    return true;
  }

  // ------------------------------------------------------------
  // STEP 3: Language Selected (Gujarati, Hindi, English, Tamil)
  // -> Ask "kya kuch sawal ke jawab de sakte hai"
  // Options: "Call pe baat karne par" or "Ji haa puchiye"
  // ------------------------------------------------------------
  if (/^(lang_gujarati|lang_hindi|lang_english|lang_tamil|gujarati|hindi|english|tamil)$/i.test(triggerInput) || (lastBotMsgText.includes('bhasha chunein') || lastBotMsgText.includes('select your preferred language'))) {
    // Make sure it's not another option triggered
    if (!/^(call_to_advisor|i_want_loan|btn_call_advisor)$/i.test(triggerInput)) {
      let bodyText = "😊 Dhanyawad! Kya aap kuch sawal ke jawab de sakte hai taaki ham aapko best loan offer de sakein?";
      let btn1 = 'Ji haa puchiye';
      let btn2 = 'Call pe baat kare';
      if (userLang === 'gujarati') {
        bodyText = "😊 ધન્યવાદ! શું તમે કેટલાક પ્રશ્નોના જવાબ આપી શકો છો જેથી અમે તમને શ્રેષ્ઠ લોન ઓફર આપી શકીએ?";
        btn1 = 'હા, પૂછો';
        btn2 = 'કોલ પર વાત કરો';
      }
      try {
        const btnResult = await sendInteractiveButtons({
          phoneNumberId,
          accessToken,
          to: contactRecord.phone,
          bodyText,
          buttons: [
            { id: 'btn_ask_questions', title: btn1 },
            { id: 'btn_call_advisor', title: btn2 }
          ]
        });
        saveAndSend(bodyText, btnResult.messageId, 'interactive');
      } catch (err) {
        console.error('[webhook] Error in LoanPlus Language Selection step:', err);
      }
      return true;
    }
  }

  // ------------------------------------------------------------
  // STEP 4: "Ji haa puchiye" clicked -> Ask "Apka income Source kya hai"
  // Options: "Salary" or "Busniess"
  // ------------------------------------------------------------
  if (/^(btn_ask_questions|ji haa puchiye|ji haa|puchiye|haa puchiye)$/i.test(triggerInput) || ((lastBotMsgText.includes('kya aap kuch sawal') || lastBotMsgText.includes('પ્રશ્નોના જવાબ')) && /^(yes|haa|ha)$/i.test(triggerInput))) {
    let bodyText = "💼 Apka income Source kya hai? Kripya niche diye gaye options me se chunein:";
    let btn1 = 'Salary';
    let btn2 = 'Busniess';
    if (userLang === 'gujarati') {
      bodyText = "💼 તમારો આવકનો સ્ત્રોત શું છે? કૃપા કરીને નીચે આપેલા વિકલ્પોમાંથી પસંદ કરો:";
      btn1 = 'પગાર (Salary)';
      btn2 = 'વ્યવસાય (Business)';
    }
    try {
      const btnResult = await sendInteractiveButtons({
        phoneNumberId,
        accessToken,
        to: contactRecord.phone,
        bodyText,
        buttons: [
          { id: 'inc_salary', title: btn1 },
          { id: 'inc_business', title: btn2 }
        ]
      });
      saveAndSend(bodyText, btnResult.messageId, 'interactive');
    } catch (err) {
      console.error('[webhook] Error in LoanPlus Ask Questions step:', err);
    }
    return true;
  }

  // ------------------------------------------------------------
  // STEP 5: "Salary" chosen -> Ask "Apko salary kaise milti hai"
  // Options: "Bank Credit" (NEFT aur IMPS) or "Cash"
  // ------------------------------------------------------------
  if (/^(inc_salary|salary)$/i.test(triggerInput) && !((lastBotMsgText.includes('15,000 se jyada') || lastBotMsgText.includes('15,000 થી વધુ')) || lastBotMsgText.includes('15,000 થી વધુ'))) {
    let bodyText = "💵 Apko salary kaise milti hai?\n\n• *Bank Credit* (NEFT aur IMPS)\n• *Cash*\n\nKripya niche diye gaye button par click karein:";
    let btn1 = 'Bank Credit';
    let btn2 = 'Cash';
    if (userLang === 'gujarati') {
      bodyText = "💵 તમને પગાર કેવી રીતે મળે છે?\n\n• *બેંક ક્રેડિટ* (NEFT અને IMPS)\n• *રોકડ (Cash)*\n\nકૃપા કરીને નીચે આપેલ વિકલ્પ પસંદ કરો:";
      btn1 = 'બેંક ક્રેડિટ';
      btn2 = 'રોકડ (Cash)';
    }
    try {
      const btnResult = await sendInteractiveButtons({
        phoneNumberId,
        accessToken,
        to: contactRecord.phone,
        bodyText,
        buttons: [
          { id: 'sal_bank', title: btn1 },
          { id: 'sal_cash', title: btn2 }
        ]
      });
      saveAndSend(bodyText, btnResult.messageId, 'interactive');
    } catch (err) {
      console.error('[webhook] Error in LoanPlus Salary Type step:', err);
    }
    return true;
  }

  // ------------------------------------------------------------
  // STEP 6: "Bank Credit" clicked -> Ask "Kya aapki salary 15,000 se jyada Account me credit hoti hai?"
  // Options: "Yes" or "No"
  // ------------------------------------------------------------
  if (/^(sal_bank|bank credit|bank|neft|imps)$/i.test(triggerInput) && (lastBotMsgText.includes('salary kaise milti hai') || lastBotMsgText.includes('પગાર કેવી રીતે મળે છે'))) {
    let bodyText = "💰 Kya aapki salary 15,000 se jyada Account me credit hoti hai?";
    let btn1 = 'Yes';
    let btn2 = 'No';
    if (userLang === 'gujarati') {
      bodyText = "💰 શું તમારો પગાર 15,000 થી વધુ છે અને બેંક એકાઉન્ટમાં જમા થાય છે?";
      btn1 = 'હા (Yes)';
      btn2 = 'ના (No)';
    }
    try {
      const btnResult = await sendInteractiveButtons({
        phoneNumberId,
        accessToken,
        to: contactRecord.phone,
        bodyText,
        buttons: [
          { id: 'sal_gt_15k', title: btn1 },
          { id: 'sal_lt_15k', title: btn2 }
        ]
      });
      saveAndSend(bodyText, btnResult.messageId, 'interactive');
    } catch (err) {
      console.error('[webhook] Error in LoanPlus 15k Salary check step:', err);
    }
    return true;
  }

  // ------------------------------------------------------------
  // STEP 7: "No" clicked (Salary < 15k) -> Reply ineligible
  // Reply: "Aap loan ke liye aligeable nhi hai interest dikhane ke liye thank you"
  // ------------------------------------------------------------
  if (/^(sal_lt_15k|no|nahi)$/i.test(triggerInput) && (lastBotMsgText.includes('15,000 se jyada') || lastBotMsgText.includes('15,000 થી વધુ'))) {
    const replyText = userLang === 'gujarati' ? "😊 તમે લોન માટે પાત્ર નથી, રસ દાખવવા બદલ આભાર." : "😊 Aap loan ke liye aligeable nhi hai interest dikhane ke liye thank you.";
    try {
      const txtResult = await sendTextMessage({
        phoneNumberId,
        accessToken,
        to: contactRecord.phone,
        text: replyText
      });
      saveAndSend(replyText, txtResult.messageId);
    } catch (err) {
      console.error('[webhook] Error in LoanPlus Ineligible step:', err);
    }
    return true;
  }

  // ------------------------------------------------------------
  // STEP 8: "Yes" (Salary > 15k) OR "Cash" (Salary mode) chosen
  // -> Ask "Apko kis parakar ki Loan Chaiye"
  // Options: "Naya ghar kharidhne hetu" / "Mere property par" / "Bina property personal Loan"
  // ------------------------------------------------------------
  if ((/^(sal_gt_15k|yes|haa|ha)$/i.test(triggerInput) && (lastBotMsgText.includes('15,000 se jyada') || lastBotMsgText.includes('15,000 થી વધુ'))) ||
      (/^(sal_cash|cash)$/i.test(triggerInput) && (lastBotMsgText.includes('salary kaise milti hai') || lastBotMsgText.includes('પગાર કેવી રીતે મળે છે')))) {
    
    let bodyText = "🏠 Apko kis parakar ki Loan Chaiye? Kripya niche diye gaye options me se chunein:";
    let btn1 = 'Naya Ghar Kharidne';
    let btn2 = 'Mere Property Par';
    let btn3 = 'Personal Loan';
    let sectionTitle = 'Loan Prakar / Type';
    
    if (userLang === 'gujarati') {
      bodyText = "🏠 તમારે કયા પ્રકારની લોન જોઈએ છે? કૃપા કરીને નીચે આપેલા વિકલ્પોમાંથી પસંદ કરો:";
      btn1 = 'નવું ઘર ખરીદવા માટે';
      btn2 = 'પ્રોપર્ટી પર લોન';
      btn3 = 'પર્સનલ લોન';
      sectionTitle = 'લોન પ્રકાર';
    }

    try {
      // Interactive list because titles/descriptions are long (over 20 chars limit of buttons)
      const listResult = await sendInteractiveList({
        phoneNumberId,
        accessToken,
        to: contactRecord.phone,
        bodyText,
        buttonLabel: userLang === 'gujarati' ? "વિકલ્પો પસંદ કરો" : "Select Loan Type",
        sections: [
          {
            title: sectionTitle,
            rows: [
              { id: 'loan_home_new', title: btn1 },
              { id: 'loan_lap', title: btn2 },
              { id: 'loan_personal', title: btn3 }
            ]
          }
        ]
      });
      saveAndSend(bodyText, listResult.messageId, 'interactive');
    } catch (err) {
      console.error('[webhook] Error in LoanPlus Loan Type step:', err);
    }
    return true;
  }

  // ------------------------------------------------------------
  // STEP 9: Any Loan Type chosen ("Naya ghar kharidhne hetu", "Mere property par", "Bina property personal Loan")
  // Reply: "Interest dikhane ke liye thank you ham aapko jaldi sampark karenge"
  // ------------------------------------------------------------
  if (/^(loan_home_new|loan_lap|loan_personal|naya ghar kharidne|mere property par|personal loan|naya ghar kharidhne hetu|bina property personal loan)$/i.test(triggerInput) ||
      ((lastBotMsgText.includes('parakar ki loan') || lastBotMsgText.includes('પ્રકારની લોન')) && /^(1|2|3|home|property|personal)$/i.test(triggerInput))) {
    const replyText = userLang === 'gujarati' ? "😊 રસ દાખવવા બદલ આભાર, અમે ટૂંક સમયમાં તમારો સંપર્ક કરીશું." : "😊 Interest dikhane ke liye thank you ham aapko jaldi sampark karenge.";
    try {
      const txtResult = await sendTextMessage({
        phoneNumberId,
        accessToken,
        to: contactRecord.phone,
        text: replyText
      });
      saveAndSend(replyText, txtResult.messageId);
    } catch (err) {
      console.error('[webhook] Error in LoanPlus Loan Type final step:', err);
    }
    return true;
  }

  // ------------------------------------------------------------
  // STEP 10: "Busniess" / "Business" chosen at Income Source step
  // -> Ask "Apka income souce kya hai"
  // Options: "Trading" / "Manufacturering" / "Service"
  // ------------------------------------------------------------
  if (/^(inc_business|busniess|business|vyapar)$/i.test(triggerInput) && (!lastBotMsgText.includes('trading') && !lastBotMsgText.includes('આવકનો સ્ત્રોત'))) {
    let bodyText = "🏢 Apka income souce kya hai? Kripya niche diye gaye options me se chunein:";
    let btn1 = 'Trading';
    let btn2 = 'Manufacturering';
    let btn3 = 'Service';
    if (userLang === 'gujarati') {
      bodyText = "🏢 તમારો આવકનો સ્ત્રોત શું છે? કૃપા કરીને નીચે આપેલા વિકલ્પોમાંથી પસંદ કરો:";
      btn1 = 'વેપાર (Trading)';
      btn2 = 'ઉત્પાદન (Manufactur)';
      btn3 = 'સેવા (Service)';
    }
    try {
      const btnResult = await sendInteractiveButtons({
        phoneNumberId,
        accessToken,
        to: contactRecord.phone,
        bodyText,
        buttons: [
          { id: 'biz_trading', title: btn1 },
          { id: 'biz_manufacturing', title: btn2 },
          { id: 'biz_service', title: btn3 }
        ]
      });
      saveAndSend(bodyText, btnResult.messageId, 'interactive');
    } catch (err) {
      console.error('[webhook] Error in LoanPlus Business Type step:', err);
    }
    return true;
  }

  // ------------------------------------------------------------
  // STEP 11: Any Business option ("Trading", "Manufacturering", "Service") clicked
  // Reply: "Interest dikhane ke liye thank you ham jaldi aapko sampark karenge"
  // ------------------------------------------------------------
  if (/^(biz_trading|biz_manufacturing|biz_service|trading|manufacturering|manufacturing|service)$/i.test(triggerInput) && (lastBotMsgText.includes('income souce kya hai') || lastBotMsgText.includes('આવકનો સ્ત્રોત'))) {
    const replyText = userLang === 'gujarati' ? "😊 રસ દાખવવા બદલ આભાર, અમે ટૂંક સમયમાં તમારો સંપર્ક કરીશું." : "😊 Interest dikhane ke liye thank you ham jaldi aapko sampark karenge.";
    try {
      const txtResult = await sendTextMessage({
        phoneNumberId,
        accessToken,
        to: contactRecord.phone,
        text: replyText
      });
      saveAndSend(replyText, txtResult.messageId);
    } catch (err) {
      console.error('[webhook] Error in LoanPlus Business Type final step:', err);
    }
    return true;
  }

  // ------------------------------------------------------------
  // FALLBACK (STEP 0): Any unmatched message -> Send Main Menu
  // ------------------------------------------------------------
  const bodyText = "નમસ્તે! Loan plus+ માં આપનું સ્વાગત છે! અમે 15+ વર્ષનો અનુભવ ધરાવતા લોન સલાહકાર છીએ. કૃપા કરીને નીચેના વિકલ્પોમાંથી પસંદ કરો:";
  try {
    const listResult = await sendInteractiveList({
      phoneNumberId,
      accessToken,
      to: contactRecord.phone,
      bodyText,
      buttonLabel: "Main Menu",
      sections: [
        {
          title: "મુખ્ય મેનુ (Main Menu)",
          rows: [
            { id: 'i_want_loan', title: 'નવી લોન માટે અરજી કરો', description: 'Apply for a new loan' },
            { id: 'check_eligibility', title: 'લોન પાત્રતા તપાસો', description: 'Check loan eligibility' },
            { id: 'calc_emi', title: 'લોન EMI ગણતરી કરો', description: 'Calculate loan EMI' },
            { id: 'call_to_advisor', title: 'લોન નિષ્ણાત સાથે વાત કરો', description: 'Talk to an expert' }
          ]
        }
      ]
    });
    saveAndSend(bodyText, listResult.messageId, 'interactive');
  } catch (err) {
    console.error('[webhook] Error in LoanPlus Greeting fallback:', err);
  }

  return true;
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
      // AI IS DISABLED FOR LOAN PLUS AS PER USER REQUEST
      return;
    } else {
      // Prince Pandey / Default Account (Nexvora AI — V2 Super-Intelligence)
      systemPrompt = `You are Nexvora AI, an elite Professional Website Consultant, UX Expert, and Sales Psychologist — not just a customer service bot.
Your goal is to guide clients through web development, design modifications, and project updates AND convert leads into paying customers using advanced sales psychology.

============================================================
CORE INTELLIGENCE FRAMEWORKS:
============================================================

1. INTENT DETECTION: Do not give generic replies. Identify the exact intent (e.g., "Change UI" -> Website Modification; "Price" -> Pricing Inquiry; "Not sure" -> Needs Consultative Guidance; "Expensive" -> Objection Handling).
2. CONTEXT MEMORY: Read the chat history carefully. If the user previously mentioned "Footer", and now says "Change color", infer they mean "Change Footer Color". Do not ask them to repeat themselves.
3. WEBSITE KNOWLEDGE GRAPH: Understand standard website structures (Navbar, Hero, About, Services, Portfolio, Pricing, Testimonials, FAQ, Contact, Footer).
4. COMPONENT HIERARCHY: Know the sub-components. If they say "Footer", know it contains: Logo, Address, Contact, Social Links, Newsletter, Copyright, Quick Links.
5. SMART FOLLOW-UP: NEVER ask open-ended questions if options can be predicted. Instead of "Can you explain?", ask "Which would you like to change? (Colors, Layout, Content, Icons, etc.)"
6. CONVERSATION STATE: Maintain the state. (e.g., Website Editing -> Footer -> Social Links).
7. UX CONSULTANT BRAIN: Think like a designer. If they want to change the footer, ask about their goal (e.g., Modern Look, Better Conversion, Better Branding, Mobile Experience).
8. SOLUTION RECOMMENDATION: Don't just ask, recommend! (e.g., "I recommend moving the contact info to the left and adding a newsletter section. Would you like to apply this?")
9. DYNAMIC QUICK REPLIES: Provide numbered bullet points for options so the user can easily select what they want next.
10. PROJECT MEMORY: Acknowledge that you are building their website. Maintain a professional, high-end agency tone.
11. STRICT NEW CUSTOMER CONVERSATION FLOW: You MUST follow these exact steps for every new customer:
    - STEP 1 (GREETING): When a new customer messages for the very first time, your FIRST reply must be: "Please wait, Prince is connecting... But before that, let me ask you: Which language do you prefer to chat in?" (Translate this politely into English/Hindi/Arabic depending on their first message). Do NOT show a menu or fixed plans.
    - STEP 2 (BUDGET): Once they reply with their language, immediately ask: "What is your estimated budget for the website?"
    - STEP 3 (CUSTOM PITCH): When they provide their budget, DO NOT discuss Nexvora's fixed plans (Starter, Growth, etc.). Instead, enthusiastically tell them all the amazing features and premium quality they will get *within their stated budget*. 
    - STEP 4 (PAYMENT TERMS): After explaining what they get and answering any questions, you must state the payment policy: "We take the first payment before starting the website development, and the final payment after the website is completely built. Do you accept this?"
    - STEP 5 (HANDOFF): If they say "yes" or accept the payment terms, reply exactly with: "Thank you sir/ma'am! Prince sir will connect with you shortly to proceed with the further process."
12. COMPANY FACTS: Owner of Nexvora is *Prince R Pandey*. Nexvora has *2+ years of experience* and *20+ premium projects* delivered globally.
13. OPT-OUT / NOT INTERESTED: If the customer says "stop", "not interested", "nahi chahiye", "don't message", or anything similar indicating disinterest, DO NOT ask any further questions, attempt to convince them, or use sales psychology. Simply reply exactly with: "😊 Sorry for disturbing you. We will not send you any more messages. Have a great day!" and end the conversation.
14. CHAT PREFERENCE: NEVER ask the customer to jump on a phone call, voice call, or video call. If you want to discuss their project further, use your convincing skills and ONLY ask for "10 minutes of your time to chat right here when you are free".
15. DEVELOPER TEST MODE: If the user says "muje apna flow check karna hai" or anything indicating they are testing their own flow, immediately reply exactly with: "Okay sir, okay, uske baad ham flow ko test kar lenge." DO NOT use any sales psychology or attempt to sell them a website. If they later say "done", reply exactly with: "Ab flow ko rokte hai."

============================================================
SALES PSYCHOLOGY ENGINE (Cialdini's 6+1 Principles):
============================================================

Apply these principles NATURALLY in every conversation — never mention them by name to the customer:

1. RECIPROCITY: Give value BEFORE asking for commitment.
   - Offer free tips, design suggestions, or a quick audit before discussing pricing.
   - Example: "Here's a quick tip — adding a WhatsApp chat button to your site can increase inquiries by 40%. Want me to include that in your design?"

2. COMMITMENT & CONSISTENCY: Start with micro-yeses, then escalate.
   - Get small agreements first: "Would you like to see a 30-second demo of a site we built for a similar business?"
   - After they say yes to small things, they're psychologically primed to say yes to bigger asks.

3. SOCIAL PROOF: Reference other clients and numbers.
   - "We recently built a similar site for a boutique in Dubai — they saw a 3x increase in online inquiries within the first month."
   - "Our Growth plan is our most popular choice — 7 out of 10 clients pick it."

4. AUTHORITY: Position yourself as the expert advisor, not a salesperson.
   - "Based on our experience building 20+ premium sites, I'd recommend the Growth plan for your business size."
   - Use confident, knowledgeable language. Never sound unsure.

5. LIKING: Mirror the customer's communication style.
   - If they use emojis, use emojis. If they're formal, be formal. If they speak Hindi, respond in Hindi.
   - Find common ground: "As a fellow entrepreneur, I understand how important your online presence is."

6. SCARCITY: Create genuine urgency when appropriate.
   - "We only take on 3 new projects per month to ensure premium quality. We currently have 1 slot available."
   - "Our current pricing is valid until [end of month]. After that, rates increase by 15%."

7. UNITY (The 7th Principle): Create a sense of shared identity.
   - "We treat every client's project like our own brand — your success is our success."

============================================================
SPIN SELLING FRAMEWORK (Use for discovery conversations):
============================================================

S - SITUATION: Understand their current state.
   "What does your current online presence look like? Do you have a website?"

P - PROBLEM: Uncover pain points.
   "What challenges are you facing with your current setup? Are you getting enough leads?"

I - IMPLICATION: Show the cost of inaction.
   "Without a professional website, potential customers may be choosing your competitors who have one. That's lost revenue every single day."

N - NEED-PAYOFF: Paint the solution.
   "Imagine having a website that not only looks premium but actively brings you new customers every week. That's exactly what we build."

============================================================
AIDA MODEL (Use for pitching):
============================================================

A - ATTENTION: Hook them with a compelling opener.
I - INTEREST: Share relevant benefits and case studies.
D - DESIRE: Make them visualize the outcome.
A - ACTION: Give a clear, easy next step.

============================================================
OBJECTION HANDLING MATRIX:
============================================================

"Too expensive" / "Budget nahi hai":
→ Price Anchoring + ROI: "I understand budget is important. Think of it this way — if your website brings in just 2-3 new clients, the entire investment pays for itself. Plus, our Starter plan is designed specifically for businesses starting their digital journey."
→ Installment offer: "We also offer flexible payment options. Would you like to explore that?"

"I'll think about it" / "Baad mein baat karte hain":
→ Soft urgency + value: "Absolutely, take your time! While you're deciding, here's something interesting — a client who was in a similar situation launched with us last month and already got 15 new inquiries. I'll also note that our current pricing refreshes on [end of month]."

"I already have a website":
→ Audit offer: "That's great! Would you like me to do a quick free review? We often find 5-10 small tweaks that can significantly boost your conversions and speed."

"Not interested" / "Zaroorat nahi":
→ Graceful exit + bookmark: "No problem at all! I appreciate your time. If you ever need a website upgrade or digital consultation in the future, we're just a message away. Wishing your business great success!"

"Can you do it cheaper?" / "Thoda kam karo":
→ Value framing: "I appreciate you asking! The investment covers premium design, animations, mobile optimization, SEO setup, and dedicated support. We've kept our pricing competitive for the value delivered. That said, let me see if the Starter plan might be a better fit for your current needs."

============================================================
COGNITIVE BIASES TO LEVERAGE (Use subtly, never manipulatively):
============================================================

- ANCHORING: Always present the Enterprise/Professional tier first, then recommend Growth as "best value."
- LOSS AVERSION: Frame as "don't miss out" rather than "you'll gain." ("You're losing potential customers every day without a professional site.")
- BANDWAGON EFFECT: "Our most popular plan" / "Most businesses in your industry choose this."
- ZERO-RISK BIAS: "We offer revision rounds and full support — zero risk on your end."
- CONFIRMATION BIAS: Reflect the customer's stated needs back to them before presenting your solution. ("You mentioned you need more online visibility — that's exactly what our Growth plan is designed for.")
- DECOY EFFECT: When showing 3 plans, the middle one should feel like the obvious best choice.
- ENDOWMENT EFFECT: After showing a demo, say "This design is already configured for your brand — shall we proceed?"

============================================================
EMOTIONAL INTELLIGENCE LAYER:
============================================================

- If customer seems FRUSTRATED: Soften your tone, acknowledge their frustration, offer to connect with a human expert.
- If customer seems EXCITED: Capitalize! Push for commitment while energy is high. "You seem excited about this — shall I reserve a slot for your project today?"
- If customer seems PRICE-SENSITIVE: Emphasize ROI and value, not features. Show how the investment pays for itself.
- If customer is COMPARING with competitors: Differentiate with unique value: premium animations, dedicated support, WhatsApp integration, mobile-first approach.
- If customer is INDECISIVE: Reduce choices, recommend ONE specific plan, make the decision easy.

============================================================
FOLLOW-UP TIMING PSYCHOLOGY:
============================================================

- After initial interest: Follow up within 2 hours. Strike while the iron is hot.
- No reply after 24h: Send a value-add message (free tip, case study, or design inspiration).
- No reply after 48h: Social proof nudge ("A business in your area just launched with us...").
- No reply after 72h: Soft scarcity ("Just checking in — we have limited slots this month.").
- No reply after 7 days: Breakup message ("I don't want to bother you. Whenever you're ready, we're here!").

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
- Bahrain (BHD): Starter 299 BHD | Growth 599 BHD | Professional 999 BHD | Enterprise 1499-2999+ BHD
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
- Match the user's language (English, Hindi, Hinglish, Arabic, or any language they write in).
- Be extremely polite, warm, and professional.
- FORMATTING: Format your replies clearly using emojis and bullet points for readability.
- BOLD TEXT: Use WhatsApp's native bold formatting (*text*). Do NOT use markdown double asterisks (**text**).
- Do not prefix your reply with "Nexvora:" or "Bot:". Just reply directly.
- Keep replies concise but impactful. No more than 3-4 short paragraphs per message.
- End every message with a clear call-to-action or question to keep the conversation moving.

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
  // OWNER EXECUTIVE AI ASSISTANT CHECK
  // Intercept messages exclusively from Loan plus+ owner (+91 8000 270 207)
  // or Nexvora owner (+91 75749 01888) to provide instant CRM summaries.
  // ============================================================
  const ownerCheck = isOwnerPhone(contactRecord.phone);
  if (ownerCheck.isOwner && ownerCheck.ownerType) {
    const inboundText = contentText ?? message.text?.body ?? '';
    
    // Check if the owner is in "Test Mode" to act like a normal customer
    let isTestMode = false;
    const { data: recentMsgs } = await supabaseAdmin()
      .from('messages')
      .select('content_text')
      .eq('conversation_id', conversation.id)
      .eq('sender_type', 'customer')
      .order('created_at', { ascending: false })
      .limit(20);
      
    if (recentMsgs) {
      for (const msg of recentMsgs) {
        const text = (msg.content_text || '').toLowerCase();
        // If they explicitly exited test mode
        if (text === 'done' || text.includes('flow ko rokte hai')) {
          isTestMode = false;
          break;
        }
        // If they entered test mode
        if (text.includes('muje apna flow check karna hai') || text.includes('test mode')) {
          isTestMode = true;
          break;
        }
      }
    }

    if (!isTestMode) {
      const handled = await handleOwnerAssistantQuery({
        inboundText,
        conversation,
        contactRecord,
        ownerType: ownerCheck.ownerType,
        accessToken,
        phoneNumberId,
        supabaseAdmin: supabaseAdmin(),
        metaMessageId: message.id
      });
      if (handled) {
        console.log(`[webhook] Owner Executive Assistant processed query for ${contactRecord.phone}`);
        return;
      }
    }
  }

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
  let loanPlusConsumed = false;
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
  } else {
    loanPlusConsumed = await handleLoanPlusFlow({
      accountId,
      conversation,
      contactRecord,
      inboundText: contentText ?? message.text?.body ?? '',
      interactiveReplyId,
      accessToken,
      phoneNumberId
    });
  }

  const flowResult = (!outreachConsumed && !loanPlusConsumed) ? await dispatchInboundToFlows({
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
  const flowConsumed = outreachConsumed || loanPlusConsumed || flowResult.consumed

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
    const existingEntry = contactConvCache.get(cacheKey) || { contact: null, conversation: null, expiresAt: 0 }
    contactConvCache.set(cacheKey, { ...existingEntry, contact: existingContact, expiresAt: Date.now() + 120_000 })
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

  const newKey = `${accountId}:${newContact.phone}`
  const newEntry = contactConvCache.get(newKey) || { contact: null, conversation: null, expiresAt: 0 }
  contactConvCache.set(newKey, { ...newEntry, contact: newContact, expiresAt: Date.now() + 120_000 })
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
