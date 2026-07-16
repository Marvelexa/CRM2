import { NextResponse } from 'next/server';
import { requireApiKey } from '@/lib/auth/api-context';
import { badRequest, ok, toApiErrorResponse } from '@/lib/api/v1/respond';
import { findExistingContact } from '@/lib/contacts/dedupe';
import { sendTemplateMessage } from '@/lib/whatsapp/meta-api';
import { decrypt } from '@/lib/whatsapp/encryption';
import {
  sanitizePhoneForMeta,
  isValidE164,
  phoneVariants,
  isRecipientNotAllowedError,
  resolveContactDisplayName,
} from '@/lib/whatsapp/phone-utils';
import { isMessageTemplate } from '@/lib/whatsapp/template-row-guard';

interface NewRecipient {
  phone: string;
  messageParams?: any;
  params?: string[];
}

export async function POST(request: Request) {
  try {
    const ctx = await requireApiKey(request, 'broadcasts:send');

    const body = await request.json();
    const {
      name,
      recipients: newRecipients,
      phone_numbers,
      template_name,
      template_language,
      template_params,
    } = body;

    // Normalize to list of recipients
    let recipients: NewRecipient[] = [];
    if (Array.isArray(newRecipients) && newRecipients.length > 0) {
      recipients = newRecipients;
    } else if (Array.isArray(phone_numbers) && phone_numbers.length > 0) {
      const sharedParams = Array.isArray(template_params) ? template_params : [];
      recipients = phone_numbers.map((phone: string) => ({
        phone,
        params: sharedParams,
      }));
    } else {
      return toApiErrorResponse(
        badRequest('Provide either `recipients` or `phone_numbers` as a non-empty array')
      );
    }

    if (!template_name) {
      return toApiErrorResponse(badRequest('template_name is required'));
    }

    // Resolve owner user_id
    let userId = ctx.createdBy;
    if (!userId) {
      const { data: p } = await ctx.supabase
        .from('profiles')
        .select('user_id')
        .eq('account_id', ctx.accountId)
        .limit(1)
        .maybeSingle();
      userId = p?.user_id || null;
    }
    if (!userId) {
      return toApiErrorResponse(badRequest('No active user found linked to this account.'));
    }

    // Load WhatsApp configuration
    const { data: config, error: configError } = await ctx.supabase
      .from('whatsapp_config')
      .select('*')
      .eq('account_id', ctx.accountId)
      .maybeSingle();

    if (configError || !config) {
      return toApiErrorResponse(badRequest('WhatsApp not configured for this account.'));
    }

    const accessToken = decrypt(config.access_token);

    let effectiveTemplateName = template_name;
    let effectiveTemplateLanguage = template_language || 'en_US';
    const oldOutreachTemplates = ['website_outreach_soft', 'website_outreach_video', 'website_outreach'];
    if (ctx.accountId === 'fe7c308b-d9c0-49b5-af12-362f5620757a' && oldOutreachTemplates.includes(effectiveTemplateName)) {
      effectiveTemplateName = 'nexvora_template';
      effectiveTemplateLanguage = 'en';
      console.log(`[API v1 Broadcasts] Intercepted old outreach template '${template_name}' -> rewriting to 'nexvora_template'`);
    }

    // Preload template definition
    const { data: rawTemplateRow } = await ctx.supabase
      .from('message_templates')
      .select('*')
      .eq('account_id', ctx.accountId)
      .eq('name', effectiveTemplateName)
      .eq('language', effectiveTemplateLanguage)
      .maybeSingle();

    if (rawTemplateRow && !isMessageTemplate(rawTemplateRow)) {
      return NextResponse.json(
        { error: { code: 'internal', message: 'Template definition is malformed.' } },
        { status: 500 }
      );
    }
    const templateRow = rawTemplateRow ?? null;

    // Resolve/create contacts for all recipients
    const resolvedContacts: Array<{ phone: string; id: string }> = [];
    for (const recipient of recipients) {
      const sanitized = sanitizePhoneForMeta(recipient.phone);
      if (!isValidE164(sanitized)) continue;

      let contact = await findExistingContact(ctx.supabase, ctx.accountId, sanitized);
      if (!contact) {
        const { data: newContact } = await ctx.supabase
          .from('contacts')
          .insert({
            account_id: ctx.accountId,
            user_id: userId,
            phone: sanitized,
            name: sanitized,
          })
          .select('id, phone')
          .single();
        if (newContact) {
          contact = newContact;
        }
      }
      if (contact) {
        resolvedContacts.push({ phone: recipient.phone, id: contact.id });
      }
    }

    const resolvedContactByPhone = new Map<string, string>();
    for (const c of resolvedContacts) {
      resolvedContactByPhone.set(sanitizePhoneForMeta(c.phone), c.id);
    }

    // Create the broadcast row in the database
    const { data: broadcast, error: broadcastError } = await ctx.supabase
      .from('broadcasts')
      .insert({
        user_id: userId,
        account_id: ctx.accountId,
        name: name || `API Broadcast - ${effectiveTemplateName}`,
        template_name: effectiveTemplateName,
        template_language: effectiveTemplateLanguage || 'en_US',
        status: 'sending',
        total_recipients: recipients.length,
        sent_count: 0,
        failed_count: 0,
      })
      .select()
      .single();

    if (broadcastError || !broadcast) {
      throw new Error(`Failed to create broadcast row: ${broadcastError?.message}`);
    }

    // Create recipient rows
    const recipientRows = recipients.map((r) => {
      const sanitized = sanitizePhoneForMeta(r.phone);
      const contactId = resolvedContactByPhone.get(sanitized);
      return {
        broadcast_id: broadcast.id,
        contact_id: contactId || null,
        status: contactId ? ('pending' as const) : ('failed' as const),
        error_message: contactId ? null : 'Invalid phone number format',
      };
    });

    const { error: recipientInsertError } = await ctx.supabase
      .from('broadcast_recipients')
      .insert(recipientRows);

    if (recipientInsertError) {
      await ctx.supabase
        .from('broadcasts')
        .update({ status: 'failed', failed_count: recipients.length })
        .eq('id', broadcast.id);
      throw new Error(`Failed to insert broadcast recipients: ${recipientInsertError.message}`);
    }

    // Load newly created recipient rows to get their IDs
    const { data: dbRecipients } = await ctx.supabase
      .from('broadcast_recipients')
      .select('id, contact_id, status, contact:contacts(name, phone)')
      .eq('broadcast_id', broadcast.id);

    const recipientById = new Map<string, any>();
    if (dbRecipients) {
      for (const r of dbRecipients) {
        const contactObj = Array.isArray(r.contact) ? r.contact[0] : (r.contact as any);
        if (contactObj && contactObj.phone) {
          recipientById.set(sanitizePhoneForMeta(contactObj.phone), r);
        }
      }
    }

    const results: any[] = [];
    let sentCount = 0;
    let failedCount = 0;

    for (const recipient of recipients) {
      const sanitized = sanitizePhoneForMeta(recipient.phone);
      const dbRec = recipientById.get(sanitized);

      if (!dbRec || dbRec.status === 'failed') {
        results.push({
          phone: recipient.phone,
          status: 'failed',
          error: 'Invalid phone number format',
        });
        failedCount++;
        continue;
      }

      const variants = phoneVariants(sanitized);
      let sentMessageId: string | null = null;
      let lastError: string | null = null;

      const contactObj = Array.isArray(dbRec.contact) ? dbRec.contact[0] : (dbRec.contact as any);
      const contactDisplayName = resolveContactDisplayName(
        Array.isArray(recipient.messageParams?.body) ? recipient.messageParams.body[0] : null,
        Array.isArray(recipient.params) ? recipient.params[0] : null,
        contactObj?.name
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
          });
          sentMessageId = result.messageId;
          lastError = null;
          break;
        } catch (error) {
          const errMsg = error instanceof Error ? error.message : 'Unknown error';
          if (!isRecipientNotAllowedError(errMsg)) {
            lastError = errMsg;
            break;
          }
          lastError = errMsg;
        }
      }

      const tsIso = new Date().toISOString();
      if (sentMessageId) {
        await ctx.supabase
          .from('broadcast_recipients')
          .update({
            status: 'sent',
            sent_at: tsIso,
            whatsapp_message_id: sentMessageId,
            error_message: null,
          })
          .eq('id', dbRec.id);

        results.push({
          phone: recipient.phone,
          status: 'sent',
          whatsapp_message_id: sentMessageId,
        });
        sentCount++;
      } else {
        await ctx.supabase
          .from('broadcast_recipients')
          .update({
            status: 'failed',
            error_message: lastError || 'Unknown error',
          })
          .eq('id', dbRec.id);

        results.push({
          phone: recipient.phone,
          status: 'failed',
          error: lastError || 'Unknown error',
        });
        failedCount++;
      }
    }

    const finalStatus = failedCount === recipients.length ? 'failed' : 'sent';
    await ctx.supabase
      .from('broadcasts')
      .update({ status: finalStatus })
      .eq('id', broadcast.id);

    return ok({
      broadcast_id: broadcast.id,
      total: recipients.length,
      sent: sentCount,
      failed: failedCount,
      results,
    });
  } catch (err) {
    return toApiErrorResponse(err);
  }
}
