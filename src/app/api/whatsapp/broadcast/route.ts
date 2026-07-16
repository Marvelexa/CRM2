import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { sendTemplateMessage } from '@/lib/whatsapp/meta-api'
import { decrypt } from '@/lib/whatsapp/encryption'
import type { SendTimeParams } from '@/lib/whatsapp/template-send-builder'
import { isMessageTemplate } from '@/lib/whatsapp/template-row-guard'
import {
  sanitizePhoneForMeta,
  isValidE164,
  phoneVariants,
  isRecipientNotAllowedError,
  resolveContactDisplayName,
} from '@/lib/whatsapp/phone-utils'
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit'

interface BroadcastResult {
  phone: string
  status: 'sent' | 'failed'
  whatsapp_message_id?: string
  error?: string
}

/**
 * Two input shapes are accepted:
 *
 *   NEW (preferred — supports per-recipient variable substitution):
 *     {
 *       recipients: Array<{ phone: string; params: string[] }>,
 *       template_name, template_language
 *     }
 *
 *   LEGACY (all phones receive the same params — kept so existing
 *   callers don't break):
 *     {
 *       phone_numbers: string[],
 *       template_params: string[],
 *       template_name, template_language
 *     }
 *
 * Previous implementation only supported the legacy shape, and the
 * sending hook was forced to ship every batch with `templateParams[0]`
 * — meaning every recipient got contact-0's personalization. The new
 * shape is what actually fixes that.
 */
interface NewRecipient {
  phone: string
  /** Body variable values, one per {{N}}. Legacy field. */
  params?: string[]
  /**
   * Structured per-send values (header text variable, media URL
   * override, URL/COPY_CODE button values). When set, takes
   * precedence over `params` for the body too — see
   * sendTemplateMessage for the merge rules.
   */
  messageParams?: SendTimeParams
}

export async function POST(request: Request) {
  try {
    const supabase = await createClient()

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Per-user broadcast budget. Note: this limits how often a user
    // can *start* a campaign, not how many messages go out inside
    // one — the fan-out loop below runs without additional gating.
    const limit = checkRateLimit(`broadcast:${user.id}`, RATE_LIMITS.broadcast)
    if (!limit.success) {
      return rateLimitResponse(limit)
    }

    // Resolve the caller's account_id. whatsapp_config + templates
    // + broadcasts are all account-scoped post-multi-user, so the
    // old `.eq('user_id', user.id)` filters miss every row created
    // by a teammate.
    const { data: profile } = await supabase
      .from('profiles')
      .select('account_id')
      .eq('user_id', user.id)
      .maybeSingle()
    const accountId = profile?.account_id as string | undefined
    if (!accountId) {
      return NextResponse.json(
        { error: 'Your profile is not linked to an account.' },
        { status: 403 },
      )
    }

    const body = await request.json()
    const {
      recipients: newRecipients,
      phone_numbers,
      template_name,
      template_language,
      template_params,
    } = body

    // Normalize to a list of {phone, params} regardless of shape.
    let recipients: NewRecipient[]
    if (Array.isArray(newRecipients) && newRecipients.length > 0) {
      recipients = newRecipients
    } else if (Array.isArray(phone_numbers) && phone_numbers.length > 0) {
      const shared: string[] = Array.isArray(template_params)
        ? template_params
        : []
      recipients = phone_numbers.map((phone: string) => ({
        phone,
        params: shared,
      }))
    } else {
      return NextResponse.json(
        {
          error:
            'Provide either `recipients` (preferred) or `phone_numbers` — must be a non-empty array',
        },
        { status: 400 }
      )
    }

    if (!template_name) {
      return NextResponse.json(
        { error: 'template_name is required' },
        { status: 400 }
      )
    }

    const { data: config, error: configError } = await supabase
      .from('whatsapp_config')
      .select('*')
      .eq('account_id', accountId)
      .single()

    if (configError || !config) {
      return NextResponse.json(
        {
          error:
            'WhatsApp not configured. Please set up your WhatsApp integration first.',
        },
        { status: 400 }
      )
    }

    const accessToken = decrypt(config.access_token)

    let effectiveTemplateName = template_name;
    let effectiveTemplateLanguage = template_language || 'en_US';
    const oldOutreachTemplates = ['website_outreach_soft', 'website_outreach_video', 'website_outreach'];
    if (accountId === 'fe7c308b-d9c0-49b5-af12-362f5620757a' && oldOutreachTemplates.includes(effectiveTemplateName)) {
      effectiveTemplateName = 'nexvora_template';
      effectiveTemplateLanguage = 'en';
      console.log(`[whatsapp/broadcast] Intercepted old outreach template '${template_name}' -> rewriting to 'nexvora_template'`);
    }

    // Load the template row once so sendTemplateMessage can build
    // header + button components on each iteration. Loading inside
    // the loop would N+1 against Supabase for every recipient.
    // Guard against a malformed local row crashing every send in
    // the loop with the same opaque TypeError — fail loudly once.
    const { data: rawTemplateRow } = await supabase
      .from('message_templates')
      .select('*')
      .eq('account_id', accountId)
      .eq('name', effectiveTemplateName)
      .eq('language', effectiveTemplateLanguage)
      .maybeSingle()
    if (rawTemplateRow && !isMessageTemplate(rawTemplateRow)) {
      return NextResponse.json(
        {
          error:
            'Template row is malformed locally — run "Sync from Meta" in Settings to repair it before broadcasting.',
        },
        { status: 500 },
      )
    }
    const templateRow = rawTemplateRow ?? null

    const { data: allContacts } = await supabase
      .from('contacts')
      .select('phone, name')
      .eq('account_id', accountId)
    const nameByPhone = new Map<string, string>()
    if (allContacts) {
      for (const c of allContacts) {
        if (c.phone) nameByPhone.set(sanitizePhoneForMeta(c.phone), c.name || '')
      }
    }

    const results: BroadcastResult[] = []
    let sentCount = 0
    let failedCount = 0

    for (const recipient of recipients) {
      const sanitized = sanitizePhoneForMeta(recipient.phone)

      if (!isValidE164(sanitized)) {
        results.push({
          phone: recipient.phone,
          status: 'failed',
          error: 'Invalid phone number format',
        })
        failedCount++
        continue
      }

      const contactDisplayName = resolveContactDisplayName(
        Array.isArray(recipient.messageParams?.body) ? recipient.messageParams.body[0] : null,
        Array.isArray(recipient.params) ? recipient.params[0] : null,
        nameByPhone.get(sanitized)
      );
      let effectiveMessageParams = recipient.messageParams;
      let effectiveParams = recipient.params ?? [];
      if (effectiveTemplateName === 'nexvora_template') {
        effectiveMessageParams = {
          ...(effectiveMessageParams || {}),
          body: [contactDisplayName]
        };
        effectiveParams = [contactDisplayName];
      }

      // Retry with phone variants on "not in allowed list" so numbers
      // that differ only in a trunk-prefix 0 still reach recipients.
      const variants = phoneVariants(sanitized)
      let sentMessageId: string | null = null
      let lastError: string | null = null
      let successfulVariant = sanitized

      for (const variant of variants) {
        try {
          const result = await sendTemplateMessage({
            phoneNumberId: config.phone_number_id,
            accessToken,
            to: variant,
            templateName: effectiveTemplateName,
            language: templateRow?.language || effectiveTemplateLanguage || 'en_US',
            template: templateRow ?? undefined,
            messageParams: effectiveMessageParams,
            params: effectiveParams,
          })
          sentMessageId = result.messageId
          successfulVariant = variant
          lastError = null
          break
        } catch (error) {
          const errorMessage =
            error instanceof Error ? error.message : 'Unknown error'
          if (!isRecipientNotAllowedError(errorMessage)) {
            lastError = errorMessage
            break
          }
          lastError = errorMessage
          // retry with next variant
        }
      }

      if (sentMessageId) {
        results.push({
          phone: recipient.phone,
          status: 'sent',
          whatsapp_message_id: sentMessageId,
        })
        sentCount++

        // Log broadcast message to CRM inbox (conversations + messages tables)
        try {
          let bodyText = templateRow && 'body_text' in templateRow ? templateRow.body_text : '[Template Broadcast]'
          if (bodyText && typeof bodyText === 'string') {
            bodyText = bodyText.replace(/\{\{1\}\}/g, contactDisplayName);
          }
          const { data: contactsData } = await supabase
            .from('contacts')
            .select('id, user_id, account_id')
            .eq('account_id', accountId)
            .eq('phone', successfulVariant)
            .limit(1)

          const contactRow = contactsData?.[0]
          if (contactRow) {
            let { data: conv } = await supabase
              .from('conversations')
              .select('id')
              .eq('contact_id', contactRow.id)
              .maybeSingle()

            const nowIso = new Date().toISOString()
            if (!conv) {
              const { data: newConv } = await supabase
                .from('conversations')
                .insert({
                  contact_id: contactRow.id,
                  user_id: contactRow.user_id || user.id,
                  account_id: accountId,
                  status: 'open',
                  last_message_text: bodyText,
                  last_message_at: nowIso,
                  unread_count: 0,
                })
                .select('id')
                .maybeSingle()
              conv = newConv
            } else {
              await supabase
                .from('conversations')
                .update({
                  last_message_text: bodyText,
                  last_message_at: nowIso,
                  status: 'open',
                })
                .eq('id', conv.id)
            }

            if (conv) {
              await supabase.from('messages').insert({
                conversation_id: conv.id,
                sender_type: 'agent',
                sender_id: user.id,
                content_type: 'template',
                content_text: bodyText,
                template_name: effectiveTemplateName,
                message_id: sentMessageId,
                status: 'sent',
                created_at: nowIso,
              })
            }
          }
        } catch (inboxErr) {
          console.error('Failed to log broadcast message to CRM inbox:', inboxErr)
        }
      } else {
        console.error(
          `Failed to send broadcast to ${recipient.phone}:`,
          lastError
        )
        results.push({
          phone: recipient.phone,
          status: 'failed',
          error: lastError || 'Unknown error',
        })
        failedCount++
      }
    }

    return NextResponse.json({
      success: true,
      total: recipients.length,
      sent: sentCount,
      failed: failedCount,
      results,
    })
  } catch (error) {
    console.error('Error in WhatsApp broadcast POST:', error)
    return NextResponse.json(
      { error: 'Failed to process broadcast' },
      { status: 500 }
    )
  }
}
