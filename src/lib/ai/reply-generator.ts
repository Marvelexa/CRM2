/**
 * AI auto-reply generator.
 * Uses OpenCode (DeepSeek) as the primary model and Gemini as a fallback.
 */

export async function generateAIReply(
  messagesFormatted: string,
  systemPrompt: string
): Promise<string> {
  const geminiApiKey = process.env.GEMINI_API_KEY;
  const opencodeApiKey = process.env.OPENCODE_API_KEY;
  const opencodeBaseUrl = process.env.OPENCODE_API_BASE_URL || "https://opencode.ai/zen/v1";
  const opencodeModel = process.env.OPENCODE_MODEL_NAME || "deepseek-v4-flash-free";

  // Priority 1: Gemini (Faster and more reliable)
  if (geminiApiKey) {
    try {
      return await generateGeminiReply(messagesFormatted, systemPrompt, geminiApiKey);
    } catch (geminiErr) {
      console.warn("[AI Bot] Gemini generation failed. Falling back to OpenCode...", geminiErr);
    }
  }

  // Priority 2: OpenCode (Fallback)
  if (!opencodeApiKey) {
    throw new Error("Neither Gemini nor OpenCode API key is configured or working.");
  }

  try {
    console.log(`[AI Bot] Calling OpenCode Chat Completion with model: ${opencodeModel}...`);
    
    // Add a 7-second timeout so it doesn't hang forever
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 7000);

    const response = await fetch(`${opencodeBaseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${opencodeApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: opencodeModel,
        messages: [
          ...(systemPrompt ? [{ role: "system", content: systemPrompt }] : []),
          { role: "user", content: messagesFormatted },
        ],
        temperature: 0.7,
        max_tokens: 1000,
      }),
      signal: controller.signal
    });
    clearTimeout(timeoutId);

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`OpenCode API error (status ${response.status}): ${errorText}`);
    }

    const data = await response.json();
    const text = data?.choices?.[0]?.message?.content;
    if (text) {
      console.log("[AI Bot] OpenCode reply generated successfully.");
      return text.trim();
    }
    throw new Error("Invalid response format from OpenCode API");
  } catch (err) {
    console.error("[AI Bot] OpenCode fallback also failed:", err);
    throw err;
  }
}

async function generateGeminiReply(
  messagesFormatted: string,
  systemPrompt: string,
  apiKey: string
): Promise<string> {
  console.log("[AI Bot] Calling Gemini API for generation...");
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;
  
  const prompt = `${systemPrompt}\n\nHere is the conversation history:\n${messagesFormatted}\n\nReply directly with the next response message from Nexvora. Keep it concise, helpful, and matching the customer's language/tone. Do not prepend with "Agent:" or "Bot:".`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      contents: [
        {
          role: "user",
          parts: [
            { text: prompt },
          ],
        },
      ],
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Gemini API error (status ${response.status}): ${errorText}`);
  }

  const data = await response.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (text) {
    console.log("[AI Bot] Gemini reply generated successfully.");
    return text.trim();
  }
  throw new Error("Invalid response format from Gemini API");
}
