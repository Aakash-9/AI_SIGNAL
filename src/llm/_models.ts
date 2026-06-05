/** List models available to the configured Gemini key. */
import { config } from "../config.js";

const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${config.geminiApiKey}&pageSize=100`;
const res = await fetch(url);
const json = (await res.json()) as {
  models?: Array<{ name: string; supportedGenerationMethods?: string[] }>;
  error?: { message?: string };
};

if (json.error) {
  console.error("Error:", json.error.message);
  process.exit(1);
}

const usable = (json.models ?? []).filter((m) =>
  m.supportedGenerationMethods?.includes("generateContent"),
);
console.log(`Models supporting generateContent (${usable.length}):`);
for (const m of usable) console.log("  " + m.name.replace("models/", ""));
