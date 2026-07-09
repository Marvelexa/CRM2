import {
  sendInteractiveButtons,
  sendInteractiveList,
  sendInteractiveCtaUrl,
  sendMediaMessage,
  sendTextMessage,
  type InteractiveButton,
  type InteractiveListSection,
  type MediaKind,
} from '@/lib/whatsapp/meta-api'
import { decrypt } from '@/lib/whatsapp/encryption'
import {
  sanitizePhoneForMeta,
  isValidE164,
  phoneVariants,
  isRecipientNotAllowedError,
} from '@/lib/whatsapp/phone-utils'
import { supabaseAdmin } from './admin-client'

// ------------------------------------------------------------
// Flows-side Meta sender with cached credentials.
//
// v2: All public senders now accept an optional `cached` parameter
// carrying the pre-fetched contact phone + WhatsApp config. When
// provided, the two per-send DB lookups (contacts + whatsapp_config)
// are skipped entirely — the flow engine pre-fetches them ONCE at
// the start of a run and passes them through the advance loop.
//
// The uncached path is still supported for one-off callers.
// ------------------------------------------------------------

/** Pre-fetched credentials the engine caches once per dispatch. */
export interface CachedSendContext {
  contactPhone: string
  contactId: string
  accessToken: string
  phoneNumberId: string
}

// Internal helper: resolve contact + config either from cache or DB.
async function resolveContext(
  accountId: string,
  contactId: string,
  cached?: CachedSendContext,
): Promise<{
  sanitized: string
  phoneNumberId: string
  accessToken: string
  contactIdResolved: string
  db: ReturnType<typeof supabaseAdmin>
}> {
  const db = supabaseAdmin()

  if (cached) {
    const sanitized = sanitizePhoneForMeta(cached.contactPhone)
    if (!isValidE164(sanitized)) {
      throw new Error(`contact phone invalid: ${cached.contactPhone}`)
    }
    return {
      sanitized,
      phoneNumberId: cached.phoneNumberId,
      accessToken: cached.accessToken,
      contactIdResolved: cached.contactId,
      db,
    }
  }

  // Uncached fallback — two DB round trips.
  const { data: contact, error: contactErr } = await db
    .from('contacts')
    .select('id, phone')
    .eq('id', contactId)
    .eq('account_id', accountId)
    .maybeSingle()
  if (contactErr || !contact?.phone) {
    throw new Error('contact not found for this account')
  }

  const sanitized = sanitizePhoneForMeta(contact.phone)
  if (!isValidE164(sanitized)) {
    throw new Error(`contact phone invalid: ${contact.phone}`)
  }

  const { data: config, error: configErr } = await db
    .from('whatsapp_config')
    .select('*')
    .eq('account_id', accountId)
    .single()
  if (configErr || !config) {
    throw new Error('WhatsApp not configured for this account')
  }

  return {
    sanitized,
    phoneNumberId: config.phone_number_id,
    accessToken: decrypt(config.access_token),
    contactIdResolved: contact.id,
    db,
  }
}

/** Build a cached context for the entire flow run — call ONCE. */
export async function buildCachedContext(
  accountId: string,
  contactId: string,
): Promise<CachedSendContext> {
  const db = supabaseAdmin()

  const { data: contact, error: contactErr } = await db
    .from('contacts')
    .select('id, phone')
    .eq('id', contactId)
    .eq('account_id', accountId)
    .maybeSingle()
  if (contactErr || !contact?.phone) {
    throw new Error('contact not found for this account')
  }

  const { data: config, error: configErr } = await db
    .from('whatsapp_config')
    .select('*')
    .eq('account_id', accountId)
    .single()
  if (configErr || !config) {
    throw new Error('WhatsApp not configured for this account')
  }

  return {
    contactPhone: contact.phone,
    contactId: contact.id,
    accessToken: decrypt(config.access_token),
    phoneNumberId: config.phone_number_id,
  }
}

interface SendTextEngineArgs {
  accountId: string
  userId: string
  conversationId: string
  contactId: string
  text: string
  cached?: CachedSendContext
}

export async function engineSendText(
  args: SendTextEngineArgs,
): Promise<{ whatsapp_message_id: string }> {
  const ctx = await resolveContext(args.accountId, args.contactId, args.cached)

  const attempt = async (phone: string): Promise<string> => {
    const r = await sendTextMessage({
      phoneNumberId: ctx.phoneNumberId,
      accessToken: ctx.accessToken,
      to: phone,
      text: args.text,
    })
    return r.messageId
  }

  const variants = phoneVariants(ctx.sanitized)
  let workingPhone = ctx.sanitized
  let waMessageId = ''
  let lastError: unknown = null
  for (const v of variants) {
    try {
      waMessageId = await attempt(v)
      workingPhone = v
      lastError = null
      break
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (!isRecipientNotAllowedError(msg)) throw err
      lastError = err
    }
  }
  if (lastError) throw lastError

  if (workingPhone !== ctx.sanitized) {
    ctx.db.from('contacts').update({ phone: workingPhone }).eq('id', ctx.contactIdResolved).then(() => {})
  }

  // Fire DB writes concurrently — neither blocks the caller.
  const msgInsert = ctx.db.from('messages').insert({
    conversation_id: args.conversationId,
    sender_type: 'bot',
    content_type: 'text',
    content_text: args.text,
    message_id: waMessageId,
    status: 'sent',
  })
  const convUpdate = ctx.db
    .from('conversations')
    .update({
      last_message_text: args.text,
      last_message_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', args.conversationId)

  await Promise.all([msgInsert, convUpdate])

  return { whatsapp_message_id: waMessageId }
}

interface SendMediaEngineArgs {
  accountId: string
  userId: string
  conversationId: string
  contactId: string
  kind: MediaKind
  link: string
  caption?: string
  filename?: string
  cached?: CachedSendContext
}

export async function engineSendMedia(
  args: SendMediaEngineArgs,
): Promise<{ whatsapp_message_id: string }> {
  const ctx = await resolveContext(args.accountId, args.contactId, args.cached)

  const attempt = async (phone: string): Promise<string> => {
    const r = await sendMediaMessage({
      phoneNumberId: ctx.phoneNumberId,
      accessToken: ctx.accessToken,
      to: phone,
      kind: args.kind,
      link: args.link,
      caption: args.caption,
      filename: args.filename,
    })
    return r.messageId
  }

  const variants = phoneVariants(ctx.sanitized)
  let workingPhone = ctx.sanitized
  let waMessageId = ''
  let lastError: unknown = null
  for (const v of variants) {
    try {
      waMessageId = await attempt(v)
      workingPhone = v
      lastError = null
      break
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (!isRecipientNotAllowedError(msg)) throw err
      lastError = err
    }
  }
  if (lastError) throw lastError

  if (workingPhone !== ctx.sanitized) {
    ctx.db.from('contacts').update({ phone: workingPhone }).eq('id', ctx.contactIdResolved).then(() => {})
  }

  const preview = args.caption?.trim() || `[${args.kind}]`
  const msgInsert = ctx.db.from('messages').insert({
    conversation_id: args.conversationId,
    sender_type: 'bot',
    content_type: args.kind,
    content_text: args.caption ?? null,
    message_id: waMessageId,
    status: 'sent',
  })
  const convUpdate = ctx.db
    .from('conversations')
    .update({
      last_message_text: preview,
      last_message_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', args.conversationId)

  await Promise.all([msgInsert, convUpdate])

  return { whatsapp_message_id: waMessageId }
}

interface SendInteractiveButtonsEngineArgs {
  accountId: string
  userId: string
  conversationId: string
  contactId: string
  bodyText: string
  buttons: InteractiveButton[]
  headerText?: string
  footerText?: string
  cached?: CachedSendContext
}

interface SendInteractiveListEngineArgs {
  accountId: string
  userId: string
  conversationId: string
  contactId: string
  bodyText: string
  buttonLabel: string
  sections: InteractiveListSection[]
  headerText?: string
  footerText?: string
  cached?: CachedSendContext
}

export async function engineSendInteractiveButtons(
  args: SendInteractiveButtonsEngineArgs,
): Promise<{ whatsapp_message_id: string }> {
  return sendInteractiveViaMeta({ ...args, kind: 'buttons' })
}

export async function engineSendInteractiveList(
  args: SendInteractiveListEngineArgs,
): Promise<{ whatsapp_message_id: string }> {
  return sendInteractiveViaMeta({ ...args, kind: 'list' })
}

type SendInput =
  | (SendInteractiveButtonsEngineArgs & { kind: 'buttons' })
  | (SendInteractiveListEngineArgs & { kind: 'list' })

async function sendInteractiveViaMeta(
  input: SendInput,
): Promise<{ whatsapp_message_id: string }> {
  const ctx = await resolveContext(input.accountId, input.contactId, input.cached)

  const attempt = async (phone: string): Promise<string> => {
    if (input.kind === 'buttons') {
      const r = await sendInteractiveButtons({
        phoneNumberId: ctx.phoneNumberId,
        accessToken: ctx.accessToken,
        to: phone,
        bodyText: input.bodyText,
        buttons: input.buttons,
        headerText: input.headerText,
        footerText: input.footerText,
      })
      return r.messageId
    }
    const r = await sendInteractiveList({
      phoneNumberId: ctx.phoneNumberId,
      accessToken: ctx.accessToken,
      to: phone,
      bodyText: input.bodyText,
      buttonLabel: input.buttonLabel,
      sections: input.sections,
      headerText: input.headerText,
      footerText: input.footerText,
    })
    return r.messageId
  }

  const variants = phoneVariants(ctx.sanitized)
  let workingPhone = ctx.sanitized
  let waMessageId = ''
  let lastError: unknown = null
  for (const v of variants) {
    try {
      waMessageId = await attempt(v)
      workingPhone = v
      lastError = null
      break
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (!isRecipientNotAllowedError(msg)) throw err
      lastError = err
    }
  }
  if (lastError) throw lastError

  if (workingPhone !== ctx.sanitized) {
    ctx.db.from('contacts').update({ phone: workingPhone }).eq('id', ctx.contactIdResolved).then(() => {})
  }

  let dbText = input.bodyText;
  if (input.kind === 'buttons' && input.buttons?.length > 0) {
    dbText += "\n\nOptions:\n" + input.buttons.map(b => `🔘 ${b.title}`).join("\n");
  } else if (input.kind === 'list' && input.sections?.length > 0) {
    dbText += "\n\nOptions:\n" + input.sections.flatMap(s => s.rows || []).map(r => `🔘 ${r.title}`).join("\n");
  }

  // Fire DB writes concurrently.
  const msgInsert = ctx.db.from('messages').insert({
    conversation_id: input.conversationId,
    sender_type: 'bot',
    content_type: 'interactive',
    content_text: dbText,
    message_id: waMessageId,
    status: 'sent',
  })
  const convUpdate = ctx.db
    .from('conversations')
    .update({
      last_message_text: dbText,
      last_message_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', input.conversationId)

  await Promise.all([msgInsert, convUpdate])

  return { whatsapp_message_id: waMessageId }
}

export interface SendInteractiveCtaUrlEngineArgs {
  accountId: string
  userId: string
  conversationId: string
  contactId: string
  bodyText: string
  ctaDisplayText: string
  ctaUrl: string
  cached?: CachedSendContext
}

export async function engineSendInteractiveCtaUrl(
  args: SendInteractiveCtaUrlEngineArgs,
): Promise<{ whatsapp_message_id: string }> {
  const ctx = await resolveContext(args.accountId, args.contactId, args.cached)

  const attempt = async (phone: string): Promise<string> => {
    const r = await sendInteractiveCtaUrl({
      phoneNumberId: ctx.phoneNumberId,
      accessToken: ctx.accessToken,
      to: phone,
      bodyText: args.bodyText,
      buttonText: args.ctaDisplayText,
      url: args.ctaUrl
    })
    return r.messageId
  }

  const variants = phoneVariants(ctx.sanitized)
  let workingPhone = ctx.sanitized
  let waMessageId = ''
  let lastError: unknown = null
  for (const v of variants) {
    try {
      waMessageId = await attempt(v)
      workingPhone = v
      lastError = null
      break
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (!isRecipientNotAllowedError(msg)) throw err
      lastError = err
    }
  }
  if (lastError) throw lastError

  if (workingPhone !== ctx.sanitized) {
    ctx.db.from('contacts').update({ phone: workingPhone }).eq('id', ctx.contactIdResolved).then(() => {})
  }

  const dbText = args.bodyText + `\n\nLink: 🔗 [${args.ctaDisplayText}](${args.ctaUrl})`;

  const msgInsert = ctx.db.from('messages').insert({
    conversation_id: args.conversationId,
    sender_type: 'bot',
    content_type: 'interactive',
    content_text: dbText,
    message_id: waMessageId,
    status: 'sent',
  })
  const convUpdate = ctx.db
    .from('conversations')
    .update({
      last_message_text: dbText,
      last_message_at: new Date().toISOString(),
    })
    .eq('id', args.conversationId)

  await Promise.all([msgInsert, convUpdate])

  return { whatsapp_message_id: waMessageId }
}
