const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');
require('dotenv').config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

function decrypt(encryptedText) {
  const parts = encryptedText.split(':');
  if (parts.length === 3) {
    const [ivHex, ctHex, tagHex] = parts;
    const decipher = crypto.createDecipheriv('aes-256-gcm', Buffer.from(process.env.ENCRYPTION_KEY, 'hex'), Buffer.from(ivHex, 'hex'));
    decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
    return decipher.update(Buffer.from(ctHex, 'hex'), undefined, 'utf8') + decipher.final('utf8');
  } else {
    const [ivHex, ctHex] = parts;
    const decipher = crypto.createDecipheriv('aes-256-cbc', Buffer.from(process.env.ENCRYPTION_KEY, 'hex'), Buffer.from(ivHex, 'hex'));
    return decipher.update(Buffer.from(ctHex, 'hex'), undefined, 'utf8') + decipher.final('utf8');
  }
}

async function sendMetaTemplate({ phoneNumberId, accessToken, to, templateName, contactName }) {
  const url = `https://graph.facebook.com/v21.0/${phoneNumberId}/messages`;
  const body = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to,
    type: 'template',
    template: {
      name: templateName,
      language: { code: 'en' },
      components: [
        {
          type: 'header',
          parameters: [
            {
              type: 'video',
              video: {
                link: 'https://scontent.whatsapp.net/v/t61.29466-34/621463772_1021390310614370_5873646268822855403_n.mp4?ccb=1-7&_nc_sid=8b1bef&_nc_ohc=c6gnz-3uFRwQ7kNvwES3hik&_nc_oc=AdpNhbqFqoRx5wEKbrEE8c2aMeZLLxnMmyh_PYpAiSNb4rweT_ZAHHJeWJxoo8S9iCg&_nc_zt=28&_nc_ht=scontent.whatsapp.net&edm=AH51TzQEAAAA&_nc_gid=iFSdhfMeQOvJxLSPXe_u2w&_nc_tpa=Q5bMBQFeSHKU_Bls6TNfEvdQo7rc9lwirm9m1SQzTkG3AlcfIWLubPcsI9vBW7voEOtsP9KyjfSLr0Gv1w&oh=01_Q5Aa5AH-zXqM8cr0_oMz5-9IHxwKQSHu7NcJtkcrBVndJKe8Gg&oe=6A8073BB'
              }
            }
          ]
        },
        {
          type: 'body',
          parameters: [
            {
              type: 'text',
              parameter_name: 'company_name',
              text: contactName || "Lavi's"
            }
          ]
        }
      ]
    }
  };

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(body),
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error?.message || `Meta API error: ${response.status}`);
  }
  return data.messages?.[0]?.id || null;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function run() {
  console.log('Starting broadcast of nexvora_template to all Nexvora contacts...');
  const nexvoraAccountId = 'fe7c308b-d9c0-49b5-af12-362f5620757a';
  const templateName = 'nexvora_template';

  const { data: config } = await supabase
    .from('whatsapp_config')
    .select('*')
    .eq('account_id', nexvoraAccountId)
    .single();

  if (!config) {
    console.error('No whatsapp_config found for Nexvora');
    return;
  }

  const accessToken = decrypt(config.access_token);
  const phoneNumberId = config.phone_number_id;

  const { data: contacts, error: cErr } = await supabase
    .from('contacts')
    .select('*')
    .eq('account_id', nexvoraAccountId);

  if (cErr || !contacts || contacts.length === 0) {
    console.error('No contacts found under Nexvora account:', cErr);
    return;
  }

  console.log(`Loaded ${contacts.length} contacts under Nexvora account.`);

  let sentCount = 0;
  let failedCount = 0;

  for (let i = 0; i < contacts.length; i++) {
    const contact = contacts[i];
    console.log(`Sending (${i + 1}/${contacts.length}) to ${contact.name} (${contact.phone})...`);

    try {
      // Get clean first word or fallback for body variable {{1}}
      const cleanName = contact.name && !contact.name.includes('+') && !/^\d+$/.test(contact.name)
        ? contact.name.split(' ')[0]
        : "friend";

      const metaMessageId = await sendMetaTemplate({
        phoneNumberId,
        accessToken,
        to: contact.phone,
        templateName,
        contactName: cleanName
      });

      sentCount++;

      // Log into CRM inbox
      const bodyText = `Hi, Prince from Nexvora here.\n\nI came across ${cleanName} and noticed your products have strong potential, but your online presence could do more to turn visitors into customers.\n\nI created a quick demo showing how a premium website experience could help your brand look more professional and make buying easier.\n\nI’ve attached it — can I share a few ideas?`;
      
      let { data: conv } = await supabase
        .from('conversations')
        .select('*')
        .eq('contact_id', contact.id)
        .maybeSingle();

      const nowIso = new Date().toISOString();

      if (!conv) {
        const { data: newConv } = await supabase
          .from('conversations')
          .insert({
            contact_id: contact.id,
            user_id: contact.user_id || config.user_id,
            account_id: nexvoraAccountId,
            status: 'open',
            last_message_text: bodyText,
            last_message_at: nowIso,
            unread_count: 0
          })
          .select()
          .maybeSingle();
        conv = newConv;
      } else {
        await supabase
          .from('conversations')
          .update({
            last_message_text: bodyText,
            last_message_at: nowIso,
            status: 'open'
          })
          .eq('id', conv.id);
      }

      if (conv) {
        await supabase.from('messages').insert({
          conversation_id: conv.id,
          sender_type: 'agent',
          sender_id: contact.user_id || config.user_id,
          content_type: 'template',
          content_text: bodyText,
          template_name: templateName,
          message_id: metaMessageId || `hope_${Date.now()}_${contact.id}`,
          status: 'sent',
          created_at: nowIso
        });
      }
    } catch (err) {
      console.error(`Failed sending to ${contact.phone}:`, err.message);
      failedCount++;
    }

    await sleep(800);
  }

  console.log(`Nexvora broadcast complete! Sent: ${sentCount}, Failed: ${failedCount}`);
}

run();
