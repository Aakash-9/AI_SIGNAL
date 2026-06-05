/**
 * Provider factory — selects the LLM backend from config.
 */

import { config } from "../config.js";
import { CachingProvider } from "./cache.js";
import { GeminiProvider } from "./gemini.js";
import { GroqProvider } from "./groq.js";
import { MockProvider } from "./mock.js";
import type { LLMProvider } from "./types.js";

export type { LLMProvider, LLMResult, LLMUsage, GenerateOptions } from "./types.js";

/** Build the configured provider, wrapped in the response cache (unless off). */
export function getProvider(): LLMProvider {
  const base = makeBaseProvider();
  return config.llmCacheMode === "off" ? base : new CachingProvider(base, config.llmCacheMode);
}

function makeBaseProvider(): LLMProvider {
  switch (config.llmProvider) {
    case "mock":
      return new MockProvider();

    case "groq":
      if (!config.groqApiKey) {
        throw new Error(
          "GROQ_API_KEY is not set. Add it to .env (get a free key at https://console.groq.com/keys), " +
            "or set LLM_PROVIDER=mock to run offline.",
        );
      }
      return new GroqProvider(config.groqApiKey, config.groqModel, config.groqFallbackModel);

    case "gemini":
    default:
      if (!config.geminiApiKey) {
        throw new Error(
          "GEMINI_API_KEY is not set. Add it to .env (get a free key at https://aistudio.google.com/apikey), " +
            "or set LLM_PROVIDER=mock to run offline.",
        );
      }
      return new GeminiProvider(config.geminiApiKey, config.geminiModel, config.geminiFallbackModel);
  }
}
