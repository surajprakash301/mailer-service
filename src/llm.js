import OpenAI from "openai";
import { config } from "./config.js";
import { logError } from "./errors.js";
import { hasLiveOpenAI } from "./openaiLive.js";
import { SYSTEM_PROMPT, userPrompt, countWords } from "./prompts.js";
import { templatePitch } from "./researchPrompt.js";

function client() {
  return new OpenAI({ apiKey: config.openaiApiKey });
}

export async function generatePitch(lead) {
  if (hasLiveOpenAI()) {
    try {
      return await generatePitchInner(lead);
    } catch (err) {
      logError("llm.generatePitch falling back to template", err);
    }
  }
  const copy = templatePitch(lead);
  return { ...copy, wordCount: countWords(copy.body) };
}

async function generatePitchInner(lead) {
  const openai = client();
  const completion = await openai.chat.completions.create({
    model: config.openaiModel,
    temperature: 0.6,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: userPrompt(lead) },
    ],
  });

  const raw = completion.choices[0]?.message?.content || "{}";
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("OpenAI returned non-JSON copy");
  }

  const subject = String(parsed.subject || "").trim();
  let body = String(parsed.body || "").trim();
  if (!subject || !body) {
    throw new Error("Generated copy is missing subject or body");
  }

  let wordCount = countWords(body);
  if (wordCount > 120) {
    const retry = await openai.chat.completions.create({
      model: config.openaiModel,
      temperature: 0.3,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        {
          role: "user",
          content: `Shorten this email to under 120 words. Keep the same facts, CTA, and personalization.\n\nSubject: ${subject}\n\n${body}\n\nReturn JSON {"subject":"...","body":"..."}`,
        },
      ],
    });
    let shortened;
    try {
      shortened = JSON.parse(retry.choices[0]?.message?.content || "{}");
    } catch {
      throw new Error("OpenAI shorten step returned non-JSON copy");
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
