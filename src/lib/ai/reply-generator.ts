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

  // Priority 1: Gemini (with model retry fallback)
  if (geminiApiKey) {
    try {
      return await generateGeminiReply(messagesFormatted, systemPrompt, geminiApiKey);
    } catch (geminiErr) {
      console.warn("[AI Bot] Gemini generation failed across models. Falling back to OpenCode...", geminiErr);
    }
  }

  // Priority 2: OpenCode (Fallback)
  if (!opencodeApiKey) {
    throw new Error("Neither Gemini nor OpenCode API key is configured or working.");
  }

  try {
    console.log(`[AI Bot] Calling OpenCode Chat Completion with model: ${opencodeModel}...`);
    
    // Add a 25-second timeout so it doesn't hang forever or cut off reasoning models
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 25000);

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
        max_tokens: 2500,
      }),
      signal: controller.signal
    });
    clearTimeout(timeoutId);

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`OpenCode API error (status ${response.status}): ${errorText}`);
    }

    const data = await response.json();
    const messageObj = data?.choices?.[0]?.message;
    let text = messageObj?.content;
    if (!text && messageObj?.reasoning_content) {
      // If the model put everything in reasoning_content or hit length limit right at reasoning
      const reason = messageObj.reasoning_content;
      // Try to get any text after "I'll write something like:" or after last newline
      const match = reason.match(/"([^"]{15,})"/g) || reason.match(/Here is the response:[\s\S]*/i);
      if (match && match.length > 0) {
        text = match[match.length - 1].replace(/^"|"$/g, '').trim();
      } else {
        text = reason.split('\n').slice(-3).join('\n').replace(/^[*\s-]+/, '').trim();
      }
    }

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
  const modelsToTry = ["gemini-2.5-flash", "gemini-1.5-flash", "gemini-2.0-flash"];
  let lastError: any = null;

  const prompt = `${systemPrompt}\n\nHere is the conversation history:\n${messagesFormatted}\n\nReply directly with the next response message from Nexvora. Keep it concise, helpful, and matching the customer's language/tone. Do not prepend with "Agent:" or "Bot:".`;

  for (const modelName of modelsToTry) {
    try {
      console.log(`[AI Bot] Calling Gemini API (${modelName}) for generation...`);
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`;
      
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
        throw new Error(`Gemini API error (${modelName}, status ${response.status}): ${errorText}`);
      }

      const data = await response.json();
      const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (text) {
        console.log(`[AI Bot] Gemini (${modelName}) reply generated successfully.`);
        return text.trim();
      }
      throw new Error(`Invalid response format from Gemini (${modelName})`);
    } catch (err) {
      console.warn(`[AI Bot] Model ${modelName} failed, trying next...`, err instanceof Error ? err.message : String(err));
      lastError = err;
    }
  }

  throw lastError || new Error("All Gemini models failed");
}
