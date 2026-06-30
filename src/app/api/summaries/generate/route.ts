import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';

export async function POST(request: Request) {
  try {
    const { conversationId, contactId, accountId } = await request.json();

    if (!conversationId || !contactId || !accountId) {
      return NextResponse.json({ error: 'Missing required parameters' }, { status: 400 });
    }

    // 1. Fetch conversation history
    const { data: messages, error: msgError } = await supabaseAdmin()
      .from('messages')
      .select('sender_type, content_text, created_at')
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: false })
      .limit(100);

    if (msgError || !messages) {
      return NextResponse.json({ error: 'Failed to fetch messages' }, { status: 500 });
    }

    if (messages.length === 0) {
      return NextResponse.json({ error: 'No messages to summarize' }, { status: 400 });
    }

    const sortedHistory = messages.reverse();
    const messagesFormatted = sortedHistory
      .map((m: any) => `${m.sender_type === 'customer' ? 'Customer' : 'Agent/AI'}: ${m.content_text || '[Media]'}`)
      .join('\n');

    // 2. Call Gemini API to summarize
    const geminiApiKey = process.env.GEMINI_API_KEY;
    if (!geminiApiKey) {
      return NextResponse.json({ error: 'Gemini API key not configured' }, { status: 500 });
    }

    const systemPrompt = `You are an expert CRM analyst. Read the following WhatsApp conversation between a customer and our business.
Please provide a concise, professional summary (3-5 bullet points) covering:
- What the customer wants / their intent.
- Any important context, requirements, or constraints mentioned.
- Next action items or current status.
Keep it strictly under 100 words.`;

    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${geminiApiKey}`;
    const prompt = `${systemPrompt}\n\nConversation History:\n${messagesFormatted}`;

    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
      }),
    });

    if (!response.ok) {
      return NextResponse.json({ error: 'Failed to generate summary from AI' }, { status: 500 });
    }

    const data = await response.json();
    const summaryText = data?.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!summaryText) {
      return NextResponse.json({ error: 'Empty summary returned from AI' }, { status: 500 });
    }

    const noteText = `[AI Summary]\n${summaryText.trim()}`;

    // 3. Save to contact_notes
    // First, delete any existing AI summary for this contact to keep it clean
    await supabaseAdmin()
      .from('contact_notes')
      .delete()
      .eq('contact_id', contactId)
      .like('note_text', '[AI Summary]%');

    // Insert new summary
    const { data: newNote, error: insertError } = await supabaseAdmin()
      .from('contact_notes')
      .insert({
        contact_id: contactId,
        account_id: accountId,
        note_text: noteText,
      })
      .select()
      .single();

    if (insertError) {
      return NextResponse.json({ error: 'Failed to save summary note' }, { status: 500 });
    }

    return NextResponse.json({ success: true, note: newNote });
  } catch (error) {
    console.error('Summary generation error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
