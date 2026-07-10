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

    // Check if the 24-hour customer service window is open.
    // If not open (or no messages yet), and message_type is 'text' or 'video',
    // we automatically fallback to sending our approved 'website_outreach_video' template.
    let isWindowOpen = false;
    if (conversation) {
      const { data: lastCustomerMsg } = await ctx.supabase
        .from('messages')
        .select('created_at')
        .eq('conversation_id', conversation.id)
        .eq('sender_type', 'customer')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (lastCustomerMsg) {
        const hoursSince = (Date.now() - new Date(lastCustomerMsg.created_at).getTime()) / (1000 * 60 * 60);
        if (hoursSince < 24) {
          isWindowOpen = true;
        }
      }
    }

    let finalMessageType = message_type;
    let finalTemplateName = template_name;
    let finalTemplateLanguage = template_language;
    let finalTemplateMessageParams = template_message_params;
    let finalTemplateParams = template_params;
    let finalContentText = content_text;

    const oldOutreachTemplates = ['website_outreach_soft', 'website_outreach_video', 'website_outreach'];
    const isOldOutreachRequested = finalMessageType === 'template' && finalTemplateName && oldOutreachTemplates.includes(finalTemplateName);
    const isClosedWindowOutreach = !isWindowOpen && (finalMessageType === 'text' || finalMessageType === 'video');

    if (ctx.accountId === 'fe7c308b-d9c0-49b5-af12-362f5620757a' && (isOldOutreachRequested || isClosedWindowOutreach)) {
      const { data: hopeTemplate } = await ctx.supabase
        .from('message_templates')
        .select('*')
        .eq('account_id', ctx.accountId)
        .eq('name', 'nexvora_last_hope')
        .in('language', ['en', 'en_US'])
        .maybeSingle();

      if (hopeTemplate && isMessageTemplate(hopeTemplate) && hopeTemplate.status === 'APPROVED') {
        finalMessageType = 'template';
        finalTemplateName = hopeTemplate.name;
        finalTemplateLanguage = hopeTemplate.language || 'en';
        const effectiveMediaUrl = media_url || hopeTemplate.header_media_url || 'https://scontent.whatsapp.net/v/t61.29466-34/680354586_2172082376974105_4020584962587637279_n.mp4?ccb=1-7&_nc_sid=8b1bef&_nc_ohc=qBVYMsFctVYQ7kNvwEBFXL7&_nc_oc=Adp_0usPoBv5zVAz8bzB0zbnOQURY7mTDf1VztrkQexOSPeGm1QNCe9vit5Wckpb7Ak&_nc_zt=28&_nc_ht=scontent.whatsapp.net&edm=AH51TzQEAAAA&_nc_gid=eyifQPlM104Le9yK0AGkcw&_nc_tpa=Q5bMBQHBjS_y_nSx6ZuXbiU7ugQzMyE99HSJkzH_O1iJgyZm59P69gsa4W_iS8DBfX-zz7SOUMIC_rYdDQ&oh=01_Q5Aa5AEeYfRJcFRDaGjcYbjNteAtPlZtK3SUu52KEm0D5aTLJw&oe=6A77E10B';
        finalTemplateMessageParams = {
          body: [contact.name || 'there'],
          headerMediaUrl: effectiveMediaUrl
        };
        finalTemplateParams = [contact.name || 'there'];
        finalContentText = hopeTemplate.body_text || `Hi ${contact.name || 'there'} 👋\n\nI created this *personalized website concept* after exploring your business and recorded a *30-second preview* just for you.\n\nI'd genuinely love to hear your *honest feedback*. If you'd like a similar website for your business, simply tap one of the options below. 😊`;
        console.log(`[API v1 Messages] Intercepted outreach request/fallback for ${contact.phone} -> force overriding to ${finalTemplateName}`);
      }
    } else if (!isWindowOpen && (message_type === 'text' || message_type === 'video')) {
      // Find the approved fallback website outreach templates for non-Nexvora accounts
      let templateData = null;
      
      // 1. Check for 'website_outreach_video'
      const { data: videoTemplate } = await ctx.supabase
        .from('message_templates')
        .select('*')
        .eq('account_id', ctx.accountId)
        .eq('name', 'website_outreach_video')
        .in('language', ['en', 'en_US'])
        .maybeSingle();

      if (videoTemplate && isMessageTemplate(videoTemplate) && videoTemplate.status === 'APPROVED') {
        templateData = videoTemplate;
      } else {
        // 2. Check for 'website_outreach_soft'
        const { data: softTemplate } = await ctx.supabase
          .from('message_templates')
          .select('*')
          .eq('account_id', ctx.accountId)
          .eq('name', 'website_outreach_soft')
          .in('language', ['en', 'en_US'])
          .maybeSingle();

        if (softTemplate && isMessageTemplate(softTemplate) && softTemplate.status === 'APPROVED') {
          templateData = softTemplate;
        } else {
          // 3. Fallback to 'website_outreach'
          const { data: origTemplate } = await ctx.supabase
            .from('message_templates')
            .select('*')
            .eq('account_id', ctx.accountId)
            .eq('name', 'website_outreach')
            .in('language', ['en', 'en_US'])
            .maybeSingle();
          if (origTemplate && isMessageTemplate(origTemplate)) {
            templateData = origTemplate;
          }
        }
      }

      if (templateData) {
        finalMessageType = 'template';
        finalTemplateName = templateData.name;
        finalTemplateLanguage = templateData.language || 'en_US';
        
        const isVideoHeader = templateData.header_type === 'video';
        const effectiveMediaUrl = media_url || templateData.header_media_url;
        finalTemplateMessageParams = {
          body: [contact.name || 'there'],
          ...(isVideoHeader && effectiveMediaUrl ? { headerMediaUrl: effectiveMediaUrl } : {})
        };
        finalTemplateParams = [contact.name || 'there'];
        finalContentText = templateData.body_text || `Hello! I made this sample website for ${contact.name || 'there'}.`;
        console.log(`[API v1 Messages] Closed window detected. Falling back to template '${templateData.name}' (Video Header: ${isVideoHeader}) for phone ${sanitizedPhone}`);
      }
    }

    const finalIsMediaKind = ['image', 'video', 'document', 'audio'].includes(finalMessageType);

    // Preload template row
    let templateRow: MessageTemplate | null = null;
    if (finalMessageType === 'template' && finalTemplateName) {
      const { data } = await ctx.supabase
        .from('message_templates')
        .select('*')
        .eq('account_id', ctx.accountId)
        .eq('name', finalTemplateName)
        .eq('language', finalTemplateLanguage || 'en_US')
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
      if (finalMessageType === 'template') {
        const result = await sendTemplateMessage({
          phoneNumberId: config.phone_number_id,
          accessToken,
          to: phoneToTry,
          templateName: finalTemplateName!,
          language: finalTemplateLanguage || 'en_US',
          template: templateRow ?? undefined,
          messageParams: finalTemplateMessageParams ?? undefined,
          params: finalTemplateParams || [],
          contextMessageId,
        });
        return result.messageId;
      }
      if (finalIsMediaKind) {
        const result = await sendMediaMessage({
          phoneNumberId: config.phone_number_id,
          accessToken,
          to: phoneToTry,
          kind: finalMessageType as MediaKind,
          link: media_url!,
          caption: finalContentText || undefined,
          filename: filename || undefined,
          contextMessageId,
        });
        return result.messageId;
      }
      const result = await sendTextMessage({
        phoneNumberId: config.phone_number_id,
        accessToken,
        to: phoneToTry,
        text: finalContentText!,
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
        content_type: finalMessageType,
        content_text: finalContentText || null,
        media_url: media_url || null,
        template_name: finalTemplateName || null,
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
        last_message_text: finalContentText || `[${finalMessageType}]`,
        last_message_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', conversation.id);

    return ok(messageRecord);
  } catch (err) {
    return toApiErrorResponse(err);
  }
}
