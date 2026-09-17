import { config } from "./config.js";

export function hasLiveOpenAI() {
  const key = config.openaiApiKey;
  return Boolean(key) && key.startsWith("sk-") && !key.includes("...");
}
