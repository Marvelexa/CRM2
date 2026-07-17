/**
 * Owner Executive AI Assistant for WhatsApp CRM — V2 SUPER-INTELLIGENCE
 * 
 * Serves only Loan plus+ owner (+91 8000 270 207) and Nexvora owner (+91 75749 01888).
 * 
 * V2 Capabilities:
 * - FULL CRM database access: contacts, tags, broadcasts, flows, messages, pipeline
 * - Sales Psychology Engine: Cialdini, SPIN Selling, AIDA, cognitive biases
 * - Lead Scoring Intelligence: Hot/Warm/Cold classification from engagement signals
 * - Proactive Recommendations: Follow-up strategies, closing scripts, objection handling
 * - Deep Analytics: Conversion rates, response rates, broadcast performance, flow completion
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

/**
 * Classify a lead as Hot / Warm / Cold based on engagement signals.
 */
function scoreLeadFromSignals(args: {
  repliedRecently: boolean;
  messageCount: number;
  lastActiveHoursAgo: number;
  clickedInterested: boolean;
}): 'HOT \uD83D\uDD25' | 'WARM \uD83C\uDF24\uFE0F' | 'COLD \uD83E\uDDCA' {
  if (args.clickedInterested || (args.repliedRecently && args.messageCount >= 3)) return 'HOT \uD83D\uDD25';
  if (args.repliedRecently || args.messageCount >= 1) return 'WARM \uD83C\uDF24\uFE0F';
  return 'COLD \uD83E\uDDCA';
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

    console.log(`[Owner Assistant V2] Processing query from owner ${contactRecord.phone} (${ownerName}): "${inboundText}"`);

    // ============================================================
    // 1) COMPREHENSIVE CRM DATA FETCH
    // ============================================================
    const now = new Date();
    const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
    const fortyEightHoursAgo = new Date(now.getTime() - 48 * 60 * 60 * 1000).toISOString();
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();

    // A) Total Contacts
    const { count: totalContacts } = await supabaseAdmin
      .from('contacts')
      .select('id', { count: 'exact', head: true })
      .eq('account_id', accountId);

    // B) Recent conversations with contact details
    const { data: conversations, error: convErr } = await supabaseAdmin
      .from('conversations')
      .select(`
        id,
        contact_id,
        last_message_text,
        last_message_at,
        unread_count,
        status,
        assigned_agent_id,
        contacts (
          name,
          phone,
          email,
          company,
          created_at
        )
      `)
      .eq('account_id', accountId)
      .order('updated_at', { ascending: false })
      .limit(50);

    if (convErr) {
      console.error('[Owner Assistant V2] Error fetching conversations:', convErr);
    }

    const convList = conversations || [];
    const convIds = convList.map((c: any) => c.id);

    // C) Recent customer messages (last 48h)
    let recentCustomerMessages: any[] = [];
    if (convIds.length > 0) {
      const { data: msgs } = await supabaseAdmin
        .from('messages')
        .select('conversation_id, content_text, content_type, created_at, sender_type')
        .in('conversation_id', convIds)
        .eq('sender_type', 'customer')
        .gte('created_at', fortyEightHoursAgo)
        .order('created_at', { ascending: false })
        .limit(40);

      if (msgs) recentCustomerMessages = msgs;
    }

    // D) Tags distribution
    let tagsSummary = '';
    try {
      const { data: tags } = await supabaseAdmin
        .from('tags')
        .select('id, name')
        .eq('account_id', accountId);

      if (tags && tags.length > 0) {
        const tagCounts: string[] = [];
        for (const tag of tags) {
          const { count } = await supabaseAdmin
            .from('contact_tags')
            .select('contact_id', { count: 'exact', head: true })
            .eq('tag_id', tag.id);
          tagCounts.push(`\u2022 *${tag.name}*: ${count || 0} contacts`);
        }
        tagsSummary = tagCounts.join('\n');
      }
    } catch (e) {
      tagsSummary = 'Unable to fetch tags data.';
    }

    // E) Broadcast performance (last 7 days)
    let broadcastSummary = '';
    try {
      const { data: broadcasts } = await supabaseAdmin
        .from('broadcasts')
        .select('id, name, status, total_recipients, sent_count, delivered_count, read_count, failed_count, replied_count, created_at')
        .eq('account_id', accountId)
        .gte('created_at', sevenDaysAgo)
        .order('created_at', { ascending: false })
        .limit(5);

      if (broadcasts && broadcasts.length > 0) {
        const broadcastLines: string[] = [];
        for (const b of broadcasts) {
          const total = b.total_recipients || 0;
          const deliveryRate = total > 0 ? Math.round(((b.delivered_count || 0) / total) * 100) : 0;
          const readRate = total > 0 ? Math.round(((b.read_count || 0) / total) * 100) : 0;
          const replyRate = total > 0 ? Math.round(((b.replied_count || 0) / total) * 100) : 0;
          broadcastLines.push(
            `\u2022 *${b.name || 'Unnamed'}* (${b.status}): ${total} recipients | Delivered: ${deliveryRate}% | Read: ${readRate}% | Replied: ${replyRate}% | Failed: ${b.failed_count || 0}`
          );
        }
        broadcastSummary = broadcastLines.join('\n');
      } else {
        broadcastSummary = 'No broadcasts sent in the last 7 days.';
      }
    } catch (e) {
      broadcastSummary = 'Unable to fetch broadcast data.';
    }

    // F) Flow completion rates
    let flowSummary = '';
    try {
      const { data: flowRuns } = await supabaseAdmin
        .from('flow_runs')
        .select('id, status, flow_id, started_at, ended_at, end_reason')
        .eq('account_id', accountId)
        .gte('started_at', sevenDaysAgo)
        .order('started_at', { ascending: false })
        .limit(50);

      if (flowRuns && flowRuns.length > 0) {
        const total = flowRuns.length;
        const completed = flowRuns.filter((r: any) => r.status === 'completed').length;
        const active = flowRuns.filter((r: any) => r.status === 'active').length;
        const handedOff = flowRuns.filter((r: any) => r.status === 'handed_off').length;
        const failed = flowRuns.filter((r: any) => r.status === 'failed').length;
        const timedOut = flowRuns.filter((r: any) => r.status === 'timed_out').length;
        const completionRate = total > 0 ? Math.round((completed / total) * 100) : 0;
        flowSummary = `Total: ${total} | Completed: ${completed} (${completionRate}%) | Active: ${active} | Handed Off: ${handedOff} | Failed: ${failed} | Timed Out: ${timedOut}`;
      } else {
        flowSummary = 'No flow runs in the last 7 days.';
      }
    } catch (e) {
      flowSummary = 'Unable to fetch flow data.';
    }

    // G) Message volume analytics
    let messageVolume = '';
    try {
      const { count: totalMsgsToday } = await supabaseAdmin
        .from('messages')
        .select('id', { count: 'exact', head: true })
        .in('conversation_id', convIds.length > 0 ? convIds : ['__none__'])
        .gte('created_at', twentyFourHoursAgo);

      const { count: inboundToday } = await supabaseAdmin
        .from('messages')
        .select('id', { count: 'exact', head: true })
        .in('conversation_id', convIds.length > 0 ? convIds : ['__none__'])
        .eq('sender_type', 'customer')
        .gte('created_at', twentyFourHoursAgo);

      const { count: outboundToday } = await supabaseAdmin
        .from('messages')
        .select('id', { count: 'exact', head: true })
        .in('conversation_id', convIds.length > 0 ? convIds : ['__none__'])
        .in('sender_type', ['user', 'bot'])
        .gte('created_at', twentyFourHoursAgo);

      messageVolume = `Total Today: ${totalMsgsToday || 0} | Inbound (Customer): ${inboundToday || 0} | Outbound (You/Bot): ${outboundToday || 0}`;
    } catch (e) {
      messageVolume = 'Unable to fetch message volume.';
    }

    // ============================================================
    // 2) BUILD CONTACT & LEAD INTELLIGENCE MAPS
    // ============================================================
    const contactMap = new Map<string, { name: string; phone: string; email?: string; company?: string; lastMessageText?: string; lastMessageAt?: string; createdAt?: string }>();
    convList.forEach((c: any) => {
      const contactObj = Array.isArray(c.contacts) ? c.contacts[0] : c.contacts;
      if (contactObj) {
        contactMap.set(c.id, {
          name: contactObj.name || contactObj.phone || 'Unknown Lead',
          phone: contactObj.phone || '',
          email: contactObj.email || undefined,
          company: contactObj.company || undefined,
          lastMessageText: c.last_message_text,
          lastMessageAt: c.last_message_at,
          createdAt: contactObj.created_at
        });
      }
    });

    // Replied list
    const repliedSummaryList: string[] = [];
    const seenRepliedContacts = new Set<string>();
    for (const msg of recentCustomerMessages) {
      const contactInfo = contactMap.get(msg.conversation_id);
      if (contactInfo && !seenRepliedContacts.has(contactInfo.phone)) {
        const checkOwner = isOwnerPhone(contactInfo.phone);
        if (!checkOwner.isOwner) {
          seenRepliedContacts.add(contactInfo.phone);
          const timeFormatted = new Date(msg.created_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
          const textExcerpt = msg.content_text || `[${msg.content_type || 'Media'}]`;
          repliedSummaryList.push(`\u2022 *${contactInfo.name}* (${timeFormatted}): "${textExcerpt}"`);
        }
      }
    }

    // Pending (no reply) list
    const noReplyList: string[] = [];
    for (const c of convList) {
      const contactInfo = contactMap.get(c.id);
      if (contactInfo) {
        const checkOwner = isOwnerPhone(contactInfo.phone);
        if (!checkOwner.isOwner && !seenRepliedContacts.has(contactInfo.phone)) {
          if (contactInfo.lastMessageText) {
            const timeDiffHours = Math.round((now.getTime() - new Date(contactInfo.lastMessageAt || now).getTime()) / (1000 * 60 * 60));
            if (timeDiffHours <= 72) {
              const excerpt = contactInfo.lastMessageText.length > 50
                ? contactInfo.lastMessageText.slice(0, 50) + '...'
                : contactInfo.lastMessageText;
              noReplyList.push(`\u2022 *${contactInfo.name}* (Sent ${timeDiffHours === 0 ? 'recently' : timeDiffHours + 'h ago'}): "${excerpt}"`);
            }
          }
        }
      }
    }

    // Lead scoring
    const hotLeads: string[] = [];
    const warmLeads: string[] = [];
    const coldLeads: string[] = [];
    for (const c of convList) {
      const contactInfo = contactMap.get(c.id);
      if (!contactInfo) continue;
      const checkOwner = isOwnerPhone(contactInfo.phone);
      if (checkOwner.isOwner) continue;

      const repliedRecently = seenRepliedContacts.has(contactInfo.phone);
      const customerMsgCount = recentCustomerMessages.filter((m: any) => m.conversation_id === c.id).length;
      const lastActiveHoursAgo = contactInfo.lastMessageAt
        ? Math.round((now.getTime() - new Date(contactInfo.lastMessageAt).getTime()) / (1000 * 60 * 60))
        : 999;
      const clickedInterested = (contactInfo.lastMessageText || '').toLowerCase().includes('interested');

      const score = scoreLeadFromSignals({
        repliedRecently,
        messageCount: customerMsgCount,
        lastActiveHoursAgo,
        clickedInterested
      });

      const entry = `\u2022 *${contactInfo.name}*${contactInfo.company ? ' (' + contactInfo.company + ')' : ''} \u2014 ${lastActiveHoursAgo < 999 ? lastActiveHoursAgo + 'h ago' : 'No activity'}`;

      if (score === 'HOT \uD83D\uDD25') hotLeads.push(entry);
      else if (score === 'WARM \uD83C\uDF24\uFE0F') warmLeads.push(entry);
      else coldLeads.push(entry);
    }

    // ============================================================
    // 3) ROUTE OWNER INTENT OR EXECUTE ACTION COMMANDS
    // ============================================================
    const cleanText = inboundText.trim().toLowerCase();
    const isGreeting = ['hi', 'hello', 'hey', 'start', 'help', 'namaste'].includes(cleanText);
    const isSummaryRequest = /summary|report|status|update|kya update|aaj ka update|full summary|who replied|who not|details|kya chal|leads update|dashboard|overview/i.test(cleanText);
    const isPendingRequest = /pending|not replied|awaiting|didn'?t reply|reply nhi|jawab nhi|cold leads?/i.test(cleanText);
    const isHotLeadRequest = /hot lead|best lead|high intent|close kar|convert|ready to buy|sabse acha lead|urgent lead/i.test(cleanText);
    const isBroadcastRequest = /broadcast|campaign|bulk|mass message|kitne bheje|delivery rate/i.test(cleanText);
    const isFlowRequest = /flow|automation|bot performance|chatbot|funnel|completion rate/i.test(cleanText);
    const isStrategyRequest = /strategy|kaise close|how to close|follow.?up|objection|deal close|sales tip|convert kaise|closing technique|psychology/i.test(cleanText);

    // Check if the owner is giving an ACTION instruction (send message, broadcast, tag, follow up)
    const isActionCommand = /send|bhej|do message|bhejo|give them a message|follow.?up|tag add|tag remove|change status/i.test(cleanText);

    let replyText = '';

    if (isActionCommand && !isGreeting && !isSummaryRequest) {
      console.log(`[Owner Assistant V2] Executing action command: "${inboundText}"`);
      
      // Determine target audience
      let targetContacts: { convId: string; name: string; phone: string; company?: string }[] = [];
      let segmentName = 'Selected Leads';

      if (/saw.*reply|seen.*reply|read.*reply|saw.*no reply|seen.*no reply|dekha.*reply/i.test(cleanText)) {
        segmentName = 'Saw Reply / Read But No Reply Yet';
        for (const c of convList) {
          const info = contactMap.get(c.id);
          if (info && !isOwnerPhone(info.phone).isOwner && !seenRepliedContacts.has(info.phone)) {
            if (c.unread_count === 0 && info.lastMessageText) {
              targetContacts.push({ convId: c.id, name: info.name, phone: info.phone, company: info.company });
            }
          }
        }
        // If unread_count === 0 check yields fewer results, fallback to all pending with delivered/read message
        if (targetContacts.length === 0) {
          for (const c of convList) {
            const info = contactMap.get(c.id);
            if (info && !isOwnerPhone(info.phone).isOwner && !seenRepliedContacts.has(info.phone) && info.lastMessageText) {
              targetContacts.push({ convId: c.id, name: info.name, phone: info.phone, company: info.company });
            }
          }
        }
      } else if (/hot/i.test(cleanText)) {
        segmentName = 'Hot Leads 🔥';
        for (const c of convList) {
          const info = contactMap.get(c.id);
          if (info && !isOwnerPhone(info.phone).isOwner) {
            const repliedRecently = seenRepliedContacts.has(info.phone);
            const customerMsgCount = recentCustomerMessages.filter((m: any) => m.conversation_id === c.id).length;
            const lastActiveHoursAgo = info.lastMessageAt ? Math.round((now.getTime() - new Date(info.lastMessageAt).getTime()) / (1000 * 60 * 60)) : 999;
            const clickedInterested = (info.lastMessageText || '').toLowerCase().includes('interested');
            if (scoreLeadFromSignals({ repliedRecently, messageCount: customerMsgCount, lastActiveHoursAgo, clickedInterested }) === 'HOT 🔥') {
              targetContacts.push({ convId: c.id, name: info.name, phone: info.phone, company: info.company });
            }
          }
        }
      } else if (/warm/i.test(cleanText)) {
        segmentName = 'Warm Leads 🌤️';
        for (const c of convList) {
          const info = contactMap.get(c.id);
          if (info && !isOwnerPhone(info.phone).isOwner) {
            const repliedRecently = seenRepliedContacts.has(info.phone);
            const customerMsgCount = recentCustomerMessages.filter((m: any) => m.conversation_id === c.id).length;
            const lastActiveHoursAgo = info.lastMessageAt ? Math.round((now.getTime() - new Date(info.lastMessageAt).getTime()) / (1000 * 60 * 60)) : 999;
            const clickedInterested = (info.lastMessageText || '').toLowerCase().includes('interested');
            if (scoreLeadFromSignals({ repliedRecently, messageCount: customerMsgCount, lastActiveHoursAgo, clickedInterested }) === 'WARM 🌤️') {
              targetContacts.push({ convId: c.id, name: info.name, phone: info.phone, company: info.company });
            }
          }
        }
      } else if (/cold/i.test(cleanText)) {
        segmentName = 'Cold Leads 🧊';
        for (const c of convList) {
          const info = contactMap.get(c.id);
          if (info && !isOwnerPhone(info.phone).isOwner) {
            const repliedRecently = seenRepliedContacts.has(info.phone);
            const customerMsgCount = recentCustomerMessages.filter((m: any) => m.conversation_id === c.id).length;
            const lastActiveHoursAgo = info.lastMessageAt ? Math.round((now.getTime() - new Date(info.lastMessageAt).getTime()) / (1000 * 60 * 60)) : 999;
            const clickedInterested = (info.lastMessageText || '').toLowerCase().includes('interested');
            if (scoreLeadFromSignals({ repliedRecently, messageCount: customerMsgCount, lastActiveHoursAgo, clickedInterested }) === 'COLD 🧊') {
              targetContacts.push({ convId: c.id, name: info.name, phone: info.phone, company: info.company });
            }
          }
        }
      } else if (/pending|no reply|didn'?t reply/i.test(cleanText)) {
        segmentName = 'Pending Leads (No Reply Yet)';
        for (const c of convList) {
          const info = contactMap.get(c.id);
          if (info && !isOwnerPhone(info.phone).isOwner && !seenRepliedContacts.has(info.phone) && info.lastMessageText) {
            targetContacts.push({ convId: c.id, name: info.name, phone: info.phone, company: info.company });
          }
        }
      } else {
        // Fallback to all non-owner active contacts
        segmentName = 'Active Leads';
        for (const c of convList) {
          const info = contactMap.get(c.id);
          if (info && !isOwnerPhone(info.phone).isOwner) {
            targetContacts.push({ convId: c.id, name: info.name, phone: info.phone, company: info.company });
          }
        }
      }

      // Extract custom message text if provided in quotes or after colon/saying
      let customMessage = '';
      const quoteMatch = inboundText.match(/["'](.+)["']/);
      if (quoteMatch && quoteMatch[1]) {
        customMessage = quoteMatch[1].trim();
      } else {
        const sayingMatch = inboundText.match(/(?:saying|message|bhej do|msg do|give them a message)[:\s]+(.+)$/i);
        if (sayingMatch && sayingMatch[1]) {
          customMessage = sayingMatch[1].trim();
        }
      }

      // Limit to 20 leads at once for safety
      const leadsToMessage = targetContacts.slice(0, 20);

      if (leadsToMessage.length === 0) {
        replyText = `ℹ️ *Action Execution Update:* No contacts found matching the segment *"${segmentName}"* right now.\n\nAll contacts in this category have either already responded or don't have pending messages.`;
      } else {
        // Generate or use exact message
        let finalMsgTemplate = customMessage;
        if (!finalMsgTemplate) {
          const aiGenPrompt = `Generate a high-converting, polite 2-paragraph WhatsApp follow-up message from ${ownerName} (${ownerType === 'loanplus' ? 'Loan plus+ Financial Consulting' : 'Nexvora Website Solutions'}) to a customer who ${segmentName}. Use Cialdini's Reciprocity/Scarcity and SPIN selling to encourage them to reply. Do not include placeholders like [Name]. Keep it natural, friendly, and professional.`;
          try {
            finalMsgTemplate = (await generateAIReply(`Create follow-up for ${segmentName}`, aiGenPrompt)) || `Hi! Just checking in to see if you had any questions regarding our previous discussion? We would love to help your business grow. Let us know!`;
          } catch (e) {
            finalMsgTemplate = `Hi! Just checking in to see if you had any questions regarding our previous discussion? We would love to help your business grow. Let us know!`;
          }
        }

        let sentCount = 0;
        let failedCount = 0;
        const sentNames: string[] = [];

        for (const lead of leadsToMessage) {
          try {
            const result = await sendTextMessage({
              phoneNumberId,
              accessToken,
              to: lead.phone,
              text: finalMsgTemplate
            });

            if (result && (result.messageId || result.success !== false)) {
              sentCount++;
              sentNames.push(lead.name);

              await supabaseAdmin
                .from('messages')
                .insert({
                  conversation_id: lead.convId,
                  sender_type: 'bot',
                  content_type: 'text',
                  content_text: finalMsgTemplate,
                  status: 'delivered',
                  created_at: new Date().toISOString()
                });

              await supabaseAdmin
                .from('conversations')
                .update({
                  last_message_text: finalMsgTemplate,
                  last_message_at: new Date().toISOString(),
                  updated_at: new Date().toISOString()
                })
                .eq('id', lead.convId);
            } else {
              failedCount++;
            }
          } catch (sendErr) {
            console.error(`[Owner Assistant V2] Failed sending to ${lead.phone}:`, sendErr);
            failedCount++;
          }
        }

        replyText = `🚀 *CRM ACTION EXECUTED SUCCESSFULLY!*\n\n🎯 *Segment:* ${segmentName}\n✅ *Sent:* ${sentCount} messages\n❌ *Failed:* ${failedCount}\n\n💬 *Message Sent:*\n"${finalMsgTemplate}"\n\n👥 *Recipients:*\n${sentNames.slice(0, 10).map(n => '• ' + n).join('\n')}${sentNames.length > 10 ? `\n...and ${sentNames.length - 10} more` : ''}`;
      }
    } else if (isGreeting) {
      replyText = `\uD83D\uDC4B Welcome back, *${ownerName}*! \uD83D\uDC54\uD83D\uDC51\n\nI am your *AI Executive CRM Assistant V2* \u2014 powered with full CRM intelligence, sales psychology, and lead scoring.\n\n\uD83D\uDCCA *Live Dashboard:*\n\u2022 Total Leads: *${totalContacts || 0}*\n\u2022 Replied (48h): *${repliedSummaryList.length}*\n\u2022 Pending Reply: *${noReplyList.length}*\n\u2022 Hot Leads \uD83D\uDD25: *${hotLeads.length}*\n\u2022 Warm Leads \uD83C\uDF24\uFE0F: *${warmLeads.length}*\n\u2022 Cold Leads \uD83E\uDDCA: *${coldLeads.length}*\n\n\uD83D\uDCEC *Message Volume (24h):*\n${messageVolume}\n\n\uD83D\uDCA1 *What would you like?*\n\u2022 *Summary* \u2014 Full executive report\n\u2022 *Hot leads* \u2014 High-intent leads ready to convert\n\u2022 *Pending* \u2014 Who hasn't replied yet\n\u2022 *Broadcast* \u2014 Campaign performance analytics\n\u2022 *Flows* \u2014 Automation completion rates\n\u2022 *Strategy* \u2014 AI sales psychology advice\n\u2022 Or ask anything: "Rahul ne kya bola?", "Give me closing script"`;
    } else if (isSummaryRequest) {
      const repliedSection = repliedSummaryList.length > 0
        ? repliedSummaryList.slice(0, 12).join('\n')
        : '\u2022 No customer replies in the last 48 hours.';

      const noReplySection = noReplyList.length > 0
        ? noReplyList.slice(0, 8).join('\n')
        : '\u2022 All active contacts have responded.';

      replyText = `\uD83D\uDCCA *EXECUTIVE CRM INTELLIGENCE REPORT*\n\uD83D\uDC64 Owner: *${ownerName}*\n\u23F0 Generated: *${new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: 'short' })}*\n\n\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\n\uD83D\uDCAC *WHO REPLIED & WHAT THEY SAID:*\n${repliedSection}\n\n\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\n\u23F3 *PENDING \u2014 AWAITING REPLY:*\n${noReplySection}\n\n\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\n\uD83C\uDFAF *LEAD SCORING:*\n\uD83D\uDD25 Hot (${hotLeads.length}): ${hotLeads.slice(0, 3).map(l => l.replace('\u2022 ', '')).join(', ') || 'None'}\n\uD83C\uDF24\uFE0F Warm (${warmLeads.length}): ${warmLeads.slice(0, 3).map(l => l.replace('\u2022 ', '')).join(', ') || 'None'}\n\uD83E\uDDCA Cold (${coldLeads.length}): ${coldLeads.slice(0, 3).map(l => l.replace('\u2022 ', '')).join(', ') || 'None'}\n\n\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\n\uD83D\uDCEC *MESSAGE VOLUME (24h):*\n${messageVolume}\n\n\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\n\uD83D\uDCE2 *BROADCAST PERFORMANCE (7 days):*\n${broadcastSummary}\n\n\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\n\uD83E\uDD16 *FLOW/AUTOMATION STATS (7 days):*\n${flowSummary}\n\n${tagsSummary ? '\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\n\uD83C\uDFF7\uFE0F *TAGS DISTRIBUTION:*\n' + tagsSummary : ''}\n\n\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\n\uD83D\uDCC8 *OVERALL METRICS:*\n\u2022 Total Registered Leads: *${totalContacts || 0}*\n\u2022 Active Conversations: *${convList.length}*\n\n\uD83D\uDCA1 Ask me: *"Hot leads"*, *"Strategy"*, *"Kaise close karu?"*, or any custom question!`;
    } else if (isHotLeadRequest) {
      replyText = `\uD83D\uDD25 *HOT LEADS \u2014 Ready to Convert*\n\n${hotLeads.length > 0 ? hotLeads.slice(0, 10).join('\n') : '\u2022 No hot leads detected right now.'}\n\n${warmLeads.length > 0 ? '\uD83C\uDF24\uFE0F *WARM LEADS \u2014 Need Nurturing:*\n' + warmLeads.slice(0, 5).join('\n') : ''}\n\n\uD83D\uDCA1 *AI Closing Strategy for Hot Leads:*\n1\uFE0F\u20E3 *Reciprocity*: Send a free value-add (design mockup, free audit) before asking for commitment\n2\uFE0F\u20E3 *Urgency*: "This pricing is only available until [date] \u2014 want me to lock it in for you?"\n3\uFE0F\u20E3 *Social Proof*: "20+ businesses chose this exact plan last month"\n4\uFE0F\u20E3 *Direct CTA*: "Shall I set up a quick 5-min call to finalize your package?"\n\nType *"Strategy"* for full closing playbook!`;
    } else if (isPendingRequest) {
      replyText = `\u23F3 *PENDING LEADS \u2014 No Reply Yet*\n\n${noReplyList.length > 0 ? noReplyList.slice(0, 12).join('\n') : '\u2022 All contacts have responded! \uD83C\uDF89'}\n\n\uD83D\uDCA1 *AI Follow-Up Strategy:*\n1\uFE0F\u20E3 *Day 1 (No reply)*: Send a soft value message \u2014 "Hey! Just wanted to share this quick tip for your business..."\n2\uFE0F\u20E3 *Day 2*: Curiosity trigger \u2014 "I was looking at your industry and noticed something interesting..."\n3\uFE0F\u20E3 *Day 3*: Social proof \u2014 "A business similar to yours just launched their site with us. Would you like to see it?"\n4\uFE0F\u20E3 *Day 5*: Loss aversion \u2014 "Just a heads up \u2014 our current pricing resets on [date]. Didn't want you to miss out!"\n5\uFE0F\u20E3 *Day 7+*: Breakup message \u2014 "I don't want to bother you, so this will be my last follow-up. If you ever need a premium website, I'm here."`;
    } else if (isBroadcastRequest) {
      replyText = `\uD83D\uDCE2 *BROADCAST CAMPAIGN ANALYTICS (Last 7 Days)*\n\n${broadcastSummary}\n\n\uD83D\uDCA1 *AI Optimization Tips:*\n\u2022 *Read rate < 50%?* \u2192 Try sending between 10-11 AM or 7-8 PM (peak WhatsApp hours)\n\u2022 *Reply rate < 5%?* \u2192 Add a clear CTA button ("Interested" / "Get Pricing")\n\u2022 *High failed count?* \u2192 Clean your contact list, remove invalid numbers\n\u2022 *Low delivery?* \u2192 Check if your WhatsApp Business account has quality warnings`;
    } else if (isFlowRequest) {
      replyText = `\uD83E\uDD16 *FLOW & AUTOMATION PERFORMANCE (Last 7 Days)*\n\n${flowSummary}\n\n\uD83D\uDCA1 *AI Optimization Tips:*\n\u2022 *High dropout?* \u2192 Simplify the flow, reduce steps to 3-4 max\n\u2022 *Many timeouts?* \u2192 Increase wait duration or add reminder messages\n\u2022 *Low completion?* \u2192 Check if collect_input prompts are clear and specific\n\u2022 *Consider A/B testing* different button labels to increase click-through`;
    } else if (isStrategyRequest) {
      replyText = `\uD83E\uDDE0 *AI SALES PSYCHOLOGY PLAYBOOK*\n\n\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\n*\uD83C\uDFAF CIALDINI'S 6 PRINCIPLES (Applied to Chat):*\n\n1\uFE0F\u20E3 *Reciprocity*: Give value BEFORE asking\n   \u2192 "Here's a free design mockup I made for your business..."\n\n2\uFE0F\u20E3 *Commitment*: Start with micro-yeses\n   \u2192 "Would you like to see a 30-second demo?" \u2192 then escalate\n\n3\uFE0F\u20E3 *Social Proof*: Share numbers\n   \u2192 "47 businesses in your industry chose this plan"\n\n4\uFE0F\u20E3 *Authority*: Position as expert\n   \u2192 "Based on our work with 20+ clients globally..."\n\n5\uFE0F\u20E3 *Liking*: Mirror their style\n   \u2192 Match their emoji usage, tone, and language\n\n6\uFE0F\u20E3 *Scarcity*: Create urgency\n   \u2192 "This pricing is available until Friday \u2014 want me to lock it in?"\n\n\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\n*\uD83D\uDD04 SPIN SELLING FRAMEWORK:*\n\n*S*ituation \u2192 "What does your current website look like?"\n*P*roblem \u2192 "Are you getting leads from it? What's missing?"\n*I*mplication \u2192 "Without a modern site, competitors are stealing your customers"\n*N*eed-Payoff \u2192 "Imagine a site that converts 3x more visitors into paying customers"\n\n\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\n*\u274C OBJECTION HANDLING:*\n\n"Too expensive" \u2192\n   "I understand \u2014 let me show you the ROI. A single client your website brings in covers the entire investment. Plus, we offer EMI options."\n\n"I'll think about it" \u2192\n   "Absolutely! While you're thinking, here's what one of our clients said after launching... Also, our current pricing resets on [date]."\n\n"I already have a website" \u2192\n   "That's great! Would you like a free audit? We often find 5-10 quick wins that can double your conversions."\n\n"Not interested" \u2192\n   "No problem at all! I'll send you a quick resource that might help your business regardless. Feel free to reach out anytime! \uD83D\uDE4F"\n\n\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\n*\uD83E\uDDEC COGNITIVE BIASES TO LEVERAGE:*\n\n\u2022 *Anchoring*: Show premium plan first, then the growth plan feels like a deal\n\u2022 *Loss Aversion*: "Don't miss out" > "You'll gain"\n\u2022 *Zero-Risk Bias*: "100% satisfaction guarantee"\n\u2022 *Bandwagon*: "Most popular choice" label\n\u2022 *Confirmation Bias*: Reflect their stated needs before presenting solution\n\n\uD83D\uDCA1 Type any specific lead name and I'll craft a personalized closing message!`;
    } else {
      // ============================================================
      // 4) CUSTOM QUESTION \u2014 Full AI with complete CRM context
      // ============================================================
      const systemPrompt = `You are the Executive AI Assistant V2 to the Owner (*${ownerName}*).
You have FULL ACCESS to the real-time WhatsApp CRM database. You are also a trained Sales Psychologist with deep knowledge of Cialdini's 6 Principles, SPIN Selling, AIDA model, cognitive biases, and objection handling.

REAL-TIME CRM DATABASE CONTEXT:
================================
Total Contacts: ${totalContacts || 0}
Active Conversations: ${convList.length}
Message Volume (24h): ${messageVolume}

WHO REPLIED RECENTLY (Last 48h):
${repliedSummaryList.join('\n') || 'No customer replies in last 48 hours.'}

WHO DID NOT REPLY (Pending Leads):
${noReplyList.join('\n') || 'No pending unresponded leads.'}

LEAD SCORING:
Hot Leads (${hotLeads.length}): ${hotLeads.slice(0, 5).join('\n') || 'None'}
Warm Leads (${warmLeads.length}): ${warmLeads.slice(0, 5).join('\n') || 'None'}
Cold Leads (${coldLeads.length}): ${coldLeads.slice(0, 3).join('\n') || 'None'}

BROADCAST PERFORMANCE (Last 7 Days):
${broadcastSummary}

FLOW/AUTOMATION STATS (Last 7 Days):
${flowSummary}

TAGS DISTRIBUTION:
${tagsSummary || 'No tags data available.'}

SALES PSYCHOLOGY KNOWLEDGE:
================================
You know Cialdini's 6 Principles (Reciprocity, Commitment, Social Proof, Authority, Liking, Scarcity), SPIN Selling (Situation-Problem-Implication-Need-payoff), AIDA Model (Attention-Interest-Desire-Action), 20 cognitive biases for sales, objection handling techniques, and follow-up timing psychology.

When the owner asks for a closing script or follow-up message, use these frameworks:
- Anchoring: Show highest tier first, then recommend mid-tier as "best value"
- Loss Aversion: Frame as "don't miss" rather than "you'll gain"
- Social Proof: Reference other clients who chose similar packages
- Scarcity: Add time-limited element to create urgency
- Reciprocity: Suggest giving free value before asking for commitment
- Mirroring: Match the lead's communication style

INSTRUCTIONS:
================================
1. If the owner asks about a specific person (e.g. "Rahul ne kya bola"), search the CRM context and tell exactly what they said, when, and their lead score.
2. If the owner asks for advice on closing leads, provide expert recommendations using psychology frameworks. Give SPECIFIC chat scripts they can copy-paste.
3. If the owner asks for follow-up strategy, provide a day-by-day plan with exact message templates.
4. If the owner asks for analytics, calculate from the data above and present clearly.
5. If the owner asks to craft a message for a specific lead, generate a persuasion-optimized message.
6. Be warm, concise, and respectful. Use emojis and WhatsApp bold formatting (*word*). Do NOT invent false data.
7. Match the owner's language \u2014 English, Hindi, or Hinglish.
8. Think like a Chief Revenue Officer \u2014 every recommendation should aim to increase revenue and conversions.`;

      let aiResponse = '';
      try {
        aiResponse = await generateAIReply(`Owner Question: "${inboundText}"`, systemPrompt);
      } catch (aiErr) {
        console.warn('[Owner Assistant V2] AI generation failed, using direct data summary:', aiErr);
      }

      replyText = aiResponse || `\uD83E\uDD16 *AI Assistant V2 \u2014 Data Report for "${inboundText}":*\n\n\uD83D\uDCCA *Total Contacts:* ${totalContacts || 0}\n\uD83D\uDCAC *Recent Replies (${repliedSummaryList.length}):*\n${repliedSummaryList.slice(0, 5).join('\n') || 'None'}\n\n\u23F3 *Pending Leads (${noReplyList.length}):*\n${noReplyList.slice(0, 5).join('\n') || 'None'}\n\n\uD83D\uDD25 *Hot Leads:* ${hotLeads.length}\n\uD83C\uDF24\uFE0F *Warm Leads:* ${warmLeads.length}\n\uD83E\uDDCA *Cold Leads:* ${coldLeads.length}\n\n\uD83D\uDCA1 _Type *Summary*, *Hot leads*, *Strategy*, or *Pending* for detailed reports._`;
    }

    // ============================================================
    // 5) SEND RESPONSE & SAVE TO DB
    // ============================================================
    await sendTextMessage({
      phoneNumberId,
      accessToken,
      to: contactRecord.phone,
      text: replyText,
      contextMessageId: metaMessageId
    });

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

    console.log(`[Owner Assistant V2] Successfully sent executive reply to ${contactRecord.phone}`);
    return true;
  } catch (err) {
    console.error('[Owner Assistant V2] Error executing query:', err);
    return false;
  }
}
