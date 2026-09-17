import OpenAI from "openai";
import { config } from "./config.js";
import { logError } from "./errors.js";
import { geminiJson, hasLiveGemini } from "./gemini.js";
import { hasLiveOpenAI } from "./openaiLive.js";
import { SYSTEM_PROMPT, userPrompt, countWords } from "./prompts.js";
import { templatePitch } from "./researchPrompt.js";

function openaiClient() {
  return new OpenAI({ apiKey: config.openaiApiKey });
}

export async function generatePitch(lead) {
  if (hasLiveGemini() || hasLiveOpenAI()) {
    try {
      return await generatePitchInner(lead);
    } catch (err) {
      logError("llm.generatePitch falling back to template", err);
    }
  }
  const copy = templatePitch(lead);
  return { ...copy, wordCount: countWords(copy.body) };
}

async function generateJsonCopy({ system, user, temperature }) {
  if (hasLiveGemini()) {
    return geminiJson({ system, user, temperature });
  }
  const openai = openaiClient();
  const completion = await openai.chat.completions.create({
    model: config.openaiModel,
    temperature,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
  });
  const raw = completion.choices[0]?.message?.content || "{}";
  return JSON.parse(raw);
}

async function generatePitchInner(lead) {
  let parsed;
  try {
    parsed = await generateJsonCopy({
      system: SYSTEM_PROMPT,
      user: userPrompt(lead),
      temperature: 0.6,
    });
  } catch {
    throw new Error("LLM returned non-JSON copy");
  }

  const subject = String(parsed.subject || "").trim();
  let body = String(parsed.body || "").trim();
  if (!subject || !body) {
    throw new Error("Generated copy is missing subject or body");
  }

  let wordCount = countWords(body);
  if (wordCount > 120) {
    let shortened;
    try {
      shortened = await generateJsonCopy({
        system: SYSTEM_PROMPT,
        user: `Shorten this email to under 120 words. Keep the same facts, CTA, and personalization.\n\nSubject: ${subject}\n\n${body}\n\nReturn JSON {"subject":"...","body":"..."}`,
        temperature: 0.3,
      });
    } catch {
      throw new Error("LLM shorten step returned non-JSON copy");
    }
    if (shortened.subject) parsed.subject = String(shortened.subject).trim();
    if (shortened.body) body = String(shortened.body).trim();
    wordCount = countWords(body);
  }

  return {
    subject: String(parsed.subject || subject).trim(),
    body,
    wordCount,
  };
}
