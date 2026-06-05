/** Probe candidate models to find one with working free-tier quota. */
import { config } from "../config.js";

const candidates = [
  "gemini-2.5-flash",
  "gemini-2.5-flash-lite",
  "gemini-flash-latest",
  "gemini-flash-lite-latest",
  "gemini-2.0-flash-lite",
  "gemini-3-flash-preview",
];

for (const model of candidates) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${config.geminiApiKey}`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: 'Reply with JSON {"ok":true}' }] }],
        generationConfig: { responseMimeType: "application/json", temperature: 0 },
      }),
    });
    const json = (await res.json()) as any;
    if (res.ok) {
      const text = json.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
      console.log(`✅ ${model}  -> OK  (${text.replace(/\s+/g, " ").slice(0, 40)})`);
    } else {
      console.log(`❌ ${model}  -> ${res.status} ${String(json.error?.message).slice(0, 60)}`);
    }
  } catch (e) {
    console.log(`❌ ${model}  -> ${(e as Error).message.slice(0, 60)}`);
  }
}
