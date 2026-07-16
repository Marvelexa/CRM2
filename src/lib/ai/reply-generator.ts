export async function generateAIReply(history: string, systemPrompt: string): Promise<string> {
  const apiKey = process.env.OPENCODE_API_KEY || "";
  const apiBase = process.env.OPENCODE_API_BASE_URL || "https://opencode.ai/zen/v1";
  const modelName = process.env.OPENCODE_MODEL_NAME || "deepseek-v4-flash-free";

  try {
    const response = await fetch(`${apiBase}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: modelName,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: `Here is the conversation history:\n${history}\n\nPlease generate the next reply as the Agent:` }
        ]
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`OpenCode API error: ${response.status} - ${errorText}`);
    }

    const data = await response.json();
    return data.choices?.[0]?.message?.content?.trim() || "";
  } catch (error) {
    console.error("Error in generateAIReply:", error);
    // Fallback to Gemini if configured
    const geminiKey = process.env.GEMINI_API_KEY;
    if (geminiKey) {
      try {
        const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${geminiKey}`;
        const geminiResponse = await fetch(geminiUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            contents: [
              {
                role: "user",
                parts: [
                  { text: `${systemPrompt}\n\nHere is the conversation history:\n${history}\n\nPlease generate the next reply as the Agent:` }
                ]
              }
            ]
          })
        });
        if (geminiResponse.ok) {
          const geminiData = await geminiResponse.json();
          return geminiData.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || "";
        }
      } catch (geminiErr) {
        console.error("Gemini fallback error:", geminiErr);
      }
    }
    return "";
  }
}
