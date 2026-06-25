import { NextResponse } from 'next/server';
import { requireApiKey } from '@/lib/auth/api-context';
import { badRequest, ok, toApiErrorResponse } from '@/lib/api/v1/respond';
import { findExistingContact } from '@/lib/contacts/dedupe';
import {
  sendTextMessage,
  sendTemplateMessage,
  sendMediaMessage,
  type MediaKind,
} from '@/lib/whatsapp/meta-api';
import { decrypt, encrypt, isLegacyFormat } from '@/lib/whatsapp/encryption';
import {
  sanitizePhoneForMeta,
  isValidE164,
  phoneVariants,
  isRecipientNotAllowedError,
} from '@/lib/whatsapp/phone-utils';
import type { MessageTemplate } from '@/types';
import { isMessageTemplate } from '@/lib/whatsapp/template-row-guard';

export async function POST(request: Request) {
  try {
    const ctx = await requireApiKey(request, 'messages:send');

    const body = await request.json();
    const {
      phone,
      message_type,
      content_text,
      media_url,
      filename,
      template_name,
      template_language,
      template_params,
      template_message_params,
      reply_to_message_id,
      contact_name,
      contact_email,
      contact_company,
    } = body;

    if (!phone || !message_type) {
      return toApiErrorResponse(badRequest('phone and message_type are required'));
    }

    const MEDIA_KINDS = ['image', 'video', 'document', 'audio'] as const;
    const isMediaKind = (MEDIA_KINDS as readonly string[]).includes(message_type);

    const VALID_MESSAGE_TYPES = ['text', 'template', ...MEDIA_KINDS] as const;
    if (!(VALID_MESSAGE_TYPES as readonly string[]).includes(message_type)) {
      return toApiErrorResponse(badRequest(`Unsupported message_type "${message_type}"`));
    }

    if (message_type === 'text' && !content_text) {
      return toApiErrorResponse(badRequest('content_text is required for text messages'));
    }

    if (message_type === 'template' && !template_name) {
      return toApiErrorResponse(badRequest('template_name is required for template messages'));
    }

    if (isMediaKind && !media_url) {
      return toApiErrorResponse(badRequest(`media_url is required for ${message_type} messages`));
    }

    if (
      isMediaKind &&
      message_type !== 'audio' &&
      typeof content_text === 'string' &&
      content_text.length > 1024
    ) {
      return toApiErrorResponse(badRequest('Caption exceeds the 1024-character limit'));
    }

    // Sanitize and validate phone
    const sanitizedPhone = sanitizePhoneForMeta(phone);
    if (!isValidE164(sanitizedPhone)) {
      return toApiErrorResponse(badRequest('Invalid phone number format'));
    }

    // Resolve owner user_id to satisfy foreign key constraint on user_id NOT NULL
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

    // Find or create contact
    let contact = await findExistingContact(ctx.supabase, ctx.accountId, sanitizedPhone);
    if (!contact) {
      const { data: newContact, error: contactErr } = await ctx.supabase
        .from('contacts')
        .insert({
          account_id: ctx.accountId,
          user_id: userId,
          phone: sanitizedPhone,
          name: contact_name?.trim() || sanitizedPhone,
          email: contact_email?.trim() || null,
          company: contact_company?.trim() || null,
        })
        .select()
        .single();

      if (contactErr || !newContact) {
        throw new Error(`Failed to create contact: ${contactErr?.message}`);
      }
      contact = newContact;
    }

    if (!contact) {
      return toApiErrorResponse(badRequest('Failed to find or create contact'));
    }

    // Find or create conversation
    let { data: conversation } = await ctx.supabase
      .from('conversations')
      .select('*')
      .eq('contact_id', contact.id)
      .eq('account_id', ctx.accountId)
      .maybeSingle();

    if (!conversation) {
      const { data: newConv, error: convErr } = await ctx.supabase
        .from('conversations')
        .insert({
          account_id: ctx.accountId,
          user_id: userId,
          contact_id: contact.id,
          status: 'open',
        })
        .select()
        .single();

      if (convErr || !newConv) {
        throw new Error(`Failed to create conversation: ${convErr?.message}`);
      }
      conversation = newConv;
    }

    // Fetch and decrypt WhatsApp config
    const { data: config, error: configError } = await ctx.supabase
      .from('whatsapp_config')
      .select('*')
      .eq('account_id', ctx.accountId)
      .maybeSingle();

    if (configError || !config) {
      return toApiErrorResponse(badRequest('WhatsApp not configured for this account.'));
    }

    const accessToken = decrypt(config.access_token);

    // Self-heal legacy CBC tokens
    if (isLegacyFormat(config.access_token)) {
      void ctx.supabase
        .from('whatsapp_config')
        .update({ access_token: encrypt(accessToken) })
        .eq('id', config.id)
        .then(({ error }) => {
          if (error) {
            console.warn('[api/v1/messages] access_token GCM upgrade failed:', error.message);
          }
        });
    }

    // Resolve reply Target
    let contextMessageId: string | undefined;
    if (reply_to_message_id) {
      const { data: parent, error: parentError } = await ctx.supabase
        .from('messages')
        .select('message_id, conversation_id')
        .eq('id', reply_to_message_id)
        .eq('conversation_id', conversation.id)
        .maybeSingle();

      if (parentError || !parent) {
        return toApiErrorResponse(
          badRequest('reply_to_message_id not found in this conversation')
        );
      }
      if (parent.message_id) {
        contextMessageId = parent.message_id;
      }
    }

    // Preload template row
    let templateRow: MessageTemplate | null = null;
    if (message_type === 'template' && template_name) {
      const { data } = await ctx.supabase
        .from('message_templates')
        .select('*')
        .eq('account_id', ctx.accountId)
        .eq('name', template_name)
        .eq('language', template_language || 'en_US')
        .maybeSingle();

      if (data && !isMessageTemplate(data)) {
        return NextResponse.json(
          { error: { code: 'internal', message: 'Template definition is malformed.' } },
          { status: 500 }
        );
      }
      templateRow = data ?? null;
    }

    let waMessageId = '';
    let workingPhone = sanitizedPhone;

    const attempt = async (phoneToTry: string): Promise<string> => {
      if (message_type === 'template') {
        const result = await sendTemplateMessage({
          phoneNumberId: config.phone_number_id,
          accessToken,
          to: phoneToTry,
          templateName: template_name,
          language: template_language || 'en_US',
          template: templateRow ?? undefined,
          messageParams: template_message_params ?? undefined,
          params: template_params || [],
          contextMessageId,
        });
        return result.messageId;
      }
      if (isMediaKind) {
        const result = await sendMediaMessage({
          phoneNumberId: config.phone_number_id,
          accessToken,
          to: phoneToTry,
          kind: message_type as MediaKind,
          link: media_url,
          caption: content_text || undefined,
          filename: filename || undefined,
          contextMessageId,
        });
        return result.messageId;
      }
      const result = await sendTextMessage({
        phoneNumberId: config.phone_number_id,
        accessToken,
        to: phoneToTry,
        text: content_text,
        contextMessageId,
      });
      return result.messageId;
    };

    try {
      const variants = phoneVariants(sanitizedPhone);
      let lastError: unknown = null;

      for (const variant of variants) {
        try {
          waMessageId = await attempt(variant);
          workingPhone = variant;
          lastError = null;
          break;
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : String(err);
          if (!isRecipientNotAllowedError(errMsg)) {
            throw err;
          }
          lastError = err;
          console.warn(`[api/v1/messages] variant "${variant}" rejected, trying next…`);
        }
      }

      if (lastError) throw lastError;
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown Meta API error';
      return NextResponse.json(
        { error: { code: 'bad_request', message: `Meta API error: ${msg}` } },
        { status: 502 }
      );
    }

    // Auto-correct contact phone if alternate format succeeded
    if (workingPhone !== sanitizedPhone) {
      await ctx.supabase
        .from('contacts')
        .update({ phone: workingPhone })
        .eq('id', contact.id);
    }

    // Insert sent message record
    const { data: messageRecord, error: msgError } = await ctx.supabase
      .from('messages')
      .insert({
        conversation_id: conversation.id,
        sender_type: 'agent',
        content_type: message_type,
        content_text: content_text || null,
        media_url: media_url || null,
        template_name: template_name || null,
        message_id: waMessageId,
        status: 'sent',
        reply_to_message_id: reply_to_message_id || null,
      })
      .select()
      .single();

    if (msgError) {
      console.error('[api/v1/messages] DB insert error:', msgError);
      return NextResponse.json(
        { error: { code: 'internal', message: `Saved message failed: ${msgError.message}` } },
        { status: 500 }
      );
    }

    // Update conversation
    await ctx.supabase
      .from('conversations')
      .update({
        last_message_text: content_text || `[${message_type}]`,
        last_message_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', conversation.id);

    return ok(messageRecord);
  } catch (err) {
    return toApiErrorResponse(err);
  }
}
