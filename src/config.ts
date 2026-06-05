/**
 * Central configuration, loaded from environment / .env.
 *
 * Node 20.6+ can load a .env file natively via process.loadEnvFile(); we call it
 * defensively so the app also works when env vars are injected by the host
 * (Vercel, CI) and no .env file exists.
 */

try {
  // Available in Node 20.6+. No-op-safe if the file is missing.
  process.loadEnvFile?.();
} catch {
  // No .env file present — rely on real environment variables.
}

export type ProviderName = "gemini" | "groq" | "mock";

export const config = {
  llmProvider: (process.env.LLM_PROVIDER as ProviderName) ?? "gemini",

  // Gemini  (keys are trimmed defensively against stray whitespace in .env)
  geminiApiKey: (process.env.GEMINI_API_KEY ?? "").trim(),
  geminiModel: (process.env.GEMINI_MODEL ?? "gemini-2.5-flash").trim(),
  /** Used automatically when the primary model is overloaded (503) or rate-limited. */
  geminiFallbackModel: (process.env.GEMINI_FALLBACK_MODEL ?? "gemini-2.5-flash-lite").trim(),

  // Groq
  groqApiKey: (process.env.GROQ_API_KEY ?? "").trim(),
  groqModel: (process.env.GROQ_MODEL ?? "llama-3.3-70b-versatile").trim(),
  groqFallbackModel: (process.env.GROQ_FALLBACK_MODEL ?? "llama-3.1-8b-instant").trim(),

  /** Response cache mode: "rw" (default) | "ro" (cache-only) | "off". */
  llmCacheMode: (process.env.LLM_CACHE_MODE ?? "rw") as "rw" | "ro" | "off",
} as const;
