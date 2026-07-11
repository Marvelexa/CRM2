/**
 * Owner Executive AI Assistant for WhatsApp CRM
 * Specifically serves only Loan plus+ owner (+91 8000 270 207) and Nexvora owner (+91 75749 01888).
 * Provides live real-time summaries of who replied, who didn't, exact customer words, and custom query answers.
 */

import { generateAIReply } from '@/lib/ai/reply-generator';
import { sendTextMessage } from '@/lib/whatsapp/meta-api';

export function isOwnerPhone(phone: string | undefined | null): { isOwner: boolean; ownerType: 'loanplus' | 'nexvora' | null } {
  if (!phone) return { isOwner: false, ownerType: null };
  const clean = phone.replace(/\D/g, '');
  
  // Loan plus+ Owner: +91 8000 270 207
  if (clean.endsWith('8000270207')) {
    return { isOwner: true, ownerType: 'loanplus' };
  }
  
  // Nexvora Owner: +91 75749 01888
  if (clean.endsWith('7574901888')) {
    return { isOwner: true, ownerType: 'nexvora' };
  }
  
  return { isOwner: false, ownerType: null };
}

interface OwnerAssistantParams {
  inboundText: string;
  conversation: any;
  contactRecord: any;
  ownerType: 'loanplus' | 'nexvora';
  accessToken: string;
  phoneNumberId: string;
  supabaseAdmin: any;
  metaMessageId?: string;
}

export async function handleOwnerAssistantQuery({
  inboundText,
  conversation,
  contactRecord,
  ownerType,
  accessToken,
  phoneNumberId,
  supabaseAdmin,
  metaMessageId
}: OwnerAssistantParams): Promise<boolean> {
  try {
    const ownerName = ownerType === 'loanplus' ? 'Rajesh Pandey (Loan plus+)' : 'Prince Pandey (Nexvora)';
    const accountId = conversation.account_id;

    console.log(`[Owner Assistant] Processing query from owner ${contactRecord.phone} (${ownerName}): "${inboundText}"`);

    // 1) Fetch Live CRM Statistics and Recent Activity
    const now = new Date();
    const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
    const fortyEightHoursAgo = new Date(now.getTime() - 48 * 60 * 60 * 1000).toISOString();

    // Total Contacts Count
    const { count: totalContacts } = await supabaseAdmin
      .from('contacts')
      .select('id', { count: 'exact', head: true })
      .eq('account_id', accountId);

    // Fetch all conversations for this account with contact info
    const { data: conversations, error: convErr } = await supabaseAdmin
      .from('conversations')
      .select(`
        id,
        contact_id,
        last_message_text,
        last_message_at,
        unread_count,
        contacts (
          name,
          phone
        )
      `)
      .eq('account_id', accountId)
      .order('updated_at', { ascending: false })
      .limit(35);

    if (convErr) {
      console.error('[Owner Assistant] Error fetching conversations:', convErr);
    }

    const convList = conversations || [];
    const convIds = convList.map((c: any) => c.id);

    // Fetch recent incoming messages (from customers) in the last 48 hours
    let recentCustomerMessages: any[] = [];
    if (convIds.length > 0) {
      const { data: msgs, error: msgsErr } = await supabaseAdmin
        .from('messages')
        .select('conversation_id, content_text, content_type, created_at')
        .in('conversation_id', convIds)
        .eq('sender_type', 'customer')
        .gte('created_at', fortyEightHoursAgo)
        .order('created_at', { ascending: false })
        .limit(25);

      if (!msgsErr && msgs) {
        recentCustomerMessages = msgs;
      }
    }

    // Map conversation IDs to Contact Details for easy lookup
    const contactMap = new Map<string, { name: string; phone: string; lastMessageText?: string; lastMessageAt?: string }>();
    convList.forEach((c: any) => {
      const contactObj = Array.isArray(c.contacts) ? c.contacts[0] : c.contacts;
      if (contactObj) {
        contactMap.set(c.id, {
          name: contactObj.name || contactObj.phone || 'Unknown Lead',
          phone: contactObj.phone || '',
          lastMessageText: c.last_message_text,
          lastMessageAt: c.last_message_at
        });
      }
    });

    // Build "Who Replied & What They Said" List
    const repliedSummaryList: string[] = [];
    const seenRepliedContacts = new Set<string>();

    for (const msg of recentCustomerMessages) {
      const contactInfo = contactMap.get(msg.conversation_id);
      if (contactInfo && !seenRepliedContacts.has(contactInfo.phone)) {
        // Exclude the owner's own phone from the summary list
        const checkOwner = isOwnerPhone(contactInfo.phone);
        if (!checkOwner.isOwner) {
          seenRepliedContacts.add(contactInfo.phone);
          const timeFormatted = new Date(msg.created_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
          const textExcerpt = msg.content_text || `[${msg.content_type || 'Media'}]`;
          repliedSummaryList.push(`• *${contactInfo.name}* (${timeFormatted}): "${textExcerpt}"`);
        }
      }
    }

    // Build "Who Did Not Reply / Awaiting Response" List
    const noReplyList: string[] = [];
    for (const c of convList) {
      const contactInfo = contactMap.get(c.id);
      if (contactInfo) {
        const checkOwner = isOwnerPhone(contactInfo.phone);
        if (!checkOwner.isOwner && !seenRepliedContacts.has(contactInfo.phone)) {
          // If conversation has a last message and they didn't reply recently
          if (contactInfo.lastMessageText) {
            const timeDiffHours = Math.round((now.getTime() - new Date(contactInfo.lastMessageAt || now).getTime()) / (1000 * 60 * 60));
            if (timeDiffHours <= 72) {
              const excerpt = contactInfo.lastMessageText.length > 50 
                ? contactInfo.lastMessageText.slice(0, 50) + '...' 
                : contactInfo.lastMessageText;
              noReplyList.push(`• *${contactInfo.name}* (Sent ${timeDiffHours === 0 ? 'recently' : timeDiffHours + 'h ago'}): "${excerpt}"`);
            }
          }
        }
      }
    }

    // Check if user is asking for a greeting vs summary vs specific question
    const cleanText = inboundText.trim().toLowerCase();
    const isGreeting = ['hi', 'hello', 'hey', 'start', 'help', 'namaste'].includes(cleanText);
    const isSummaryRequest = ['summary', 'report', 'status', 'update', 'kya update hai', 'aaj ka update', 'full summary', 'who replied', 'who not', 'details', 'kya chal raha hai', 'leads update'].includes(cleanText);

    let replyText = '';

    if (isGreeting) {
      replyText = `👋 Hello Executive Owner (*${ownerName}*)! 👔👑\n\nI am your *AI Executive CRM Assistant*. I monitor all incoming leads, conversations, and updates in real-time.\n\n📊 *Quick Snapshot Right Now:*\n• Total Active Leads/Contacts: *${totalContacts || 0}*\n• Customers Replied (Last 48h): *${repliedSummaryList.length}*\n• Pending / Awaiting Reply: *${noReplyList.length}*\n\n💡 *What would you like to check? Type:*\n• *Summary* — Full report of who replied today & what exact words they said\n• *Pending* — List of leads who received our message but haven't replied\n• Or ask any custom question like *"Rahul ne kya bola?"* or *"Give me hot leads today"*!`;
    } else if (isSummaryRequest) {
      // Format a comprehensive Executive Summary
      let repliedSection = repliedSummaryList.length > 0 
        ? repliedSummaryList.slice(0, 10).join('\n') 
        : '• No new customer replies received in the last 48 hours.';
      
      let noReplySection = noReplyList.length > 0 
        ? noReplyList.slice(0, 8).join('\n') 
        : '• All recent active contacts have responded.';

      replyText = `📊 *EXECUTIVE CRM SUMMARY REPORT*\n👤 For Owner: *${ownerName}*\n⏰ Generated: *${new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: 'short' })}*\n\n💬 *WHO REPLIED & WHAT THEY SAID:*\n${repliedSection}\n\n⏳ *WHO DID NOT REPLY (Awaiting Customer Response):*\n${noReplySection}\n\n📈 *Overall Account Metrics:*\n• Total Leads Registered: *${totalContacts || 0}*\n• Active Conversations Checked: *${convList.length}*\n\n💡 *Tip:* Ask me about any specific person (e.g. *"What did Sharma say?"*) to get instant AI analysis!`;
    } else {
      // The owner asked a specific custom question about the CRM data!
      // Let's feed the real-time CRM database context + their exact question to AI.
      const systemPrompt = `You are the Executive AI Assistant to the Owner (*${ownerName}*).
You have full access to the real-time WhatsApp CRM activity logs.
Answer the owner's question directly, clearly, and professionally based on the real-time CRM database context provided below.

REAL-TIME CRM DATABASE CONTEXT:
Total Contacts: ${totalContacts || 0}

WHO REPLIED RECENTLY (Customer Messages):
${repliedSummaryList.join('\n') || 'No customer replies in last 48 hours.'}

WHO DID NOT REPLY YET (Pending Leads):
${noReplyList.join('\n') || 'No pending unresponded leads.'}

INSTRUCTIONS:
1. If the owner asks about a specific person (e.g. "Rahul ne kya bola"), search the context above and tell them exactly what Rahul said and when.
2. If the owner asks for advice on closing leads or what to do next, provide expert executive recommendations.
3. Be warm, concise, and respectful. Use emojis and WhatsApp bold formatting (*word*). Do not invent false data if the contact is not listed.`;

      let aiResponse = '';
      try {
        aiResponse = await generateAIReply(`Owner Question: "${inboundText}"`, systemPrompt);
      } catch (aiErr) {
        console.warn('[Owner Assistant] AI generation failed, using direct data summary:', aiErr);
      }
      replyText = aiResponse || `🤖 *AI Assistant Data Report for "${inboundText}":*\n\n📊 *Total Contacts:* ${totalContacts || 0}\n💬 *Recent Customer Replies (${repliedSummaryList.length}):*\n${repliedSummaryList.slice(0, 5).join('\n') || 'None'}\n\n⏳ *Pending Leads Awaiting Reply (${noReplyList.length}):*\n${noReplyList.slice(0, 5).join('\n') || 'None'}\n\n💡 _Type *Summary* or *Pending* for the full lists._`;
    }

    // Send text response to the Owner
    await sendTextMessage({
      phoneNumberId,
      accessToken,
      to: contactRecord.phone,
      text: replyText,
      contextMessageId: metaMessageId
    });

    // Save the assistant's reply inside the conversation history under 'bot'
    await supabaseAdmin
      .from('messages')
      .insert({
        conversation_id: conversation.id,
        sender_type: 'bot',
        content_type: 'text',
        content_text: replyText,
        status: 'delivered',
        created_at: new Date().toISOString()
      });

    console.log(`[Owner Assistant] Successfully sent executive summary/reply to ${contactRecord.phone}`);
    return true;
  } catch (err) {
    console.error('[Owner Assistant] Error executing query:', err);
    return false;
  }
}
