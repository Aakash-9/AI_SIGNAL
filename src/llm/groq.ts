/**
 * Groq provider — OpenAI-compatible chat completions on Groq's fast inference.
 *
 * Why Groq: extremely low latency (often <1s for our stage sizes) and a free
 * tier, which makes the whole pipeline feel instant and keeps the demo reliable.
 * Same reliability features as the Gemini provider: JSON mode + temperature 0,
 * exponential-backoff retries, and automatic model fallback on overload.
 *
 * Drops in behind the same LLMProvider interface — no pipeline changes needed.
 */

import type { GenerateOptions, LLMProvider, LLMResult } from "./types.js";

const API_URL = "https://api.groq.com/openai/v1/chat/completions";
const RETRYABLE = new Set([429, 500, 502, 503]);
const MAX_ATTEMPTS = 3;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface GroqResponse {
  choices?: Array<{ message?: { content?: string } }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
  error?: { message?: string };
}

class OverloadError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

function extractJsonText(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  return (fenced?.[1] ?? text).trim();
}

export class GroqProvider implements LLMProvider {
  readonly name = "groq";

  constructor(
    private readonly apiKey: string,
    private readonly defaultModel: string,
    private readonly fallbackModel?: string,
  ) {}

  async generateJSON(opts: GenerateOptions): Promise<LLMResult> {
    const primary = opts.model ?? this.defaultModel;
    const models =
      this.fallbackModel && this.fallbackModel !== primary ? [primary, this.fallbackModel] : [primary];

    let lastError: unknown;
    for (const model of models) {
      try {
        return await this.callModel(model, opts);
      } catch (err) {
        lastError = err;
        if (!(err instanceof OverloadError)) throw err;
      }
    }
    throw lastError;
  }

  private async callModel(model: string, opts: GenerateOptions): Promise<LLMResult> {
    const body = {
      model,
      messages: [
        { role: "system", content: opts.system },
        { role: "user", content: opts.prompt },
      ],
      temperature: opts.temperature ?? 0,
      // JSON mode — Groq requires the word "json" to appear in the prompt, which
      // our contract-heavy prompts always satisfy.
      response_format: { type: "json_object" as const },
    };

    const t0 = Date.now();
    for (let attempt = 1; ; attempt++) {
      const res = await fetch(API_URL, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${this.apiKey}` },
        body: JSON.stringify(body),
      });
      const json = (await res.json()) as GroqResponse;

      if (res.ok && !json.error) {
        const raw = json.choices?.[0]?.message?.content ?? "";
        const usage = {
          inputTokens: json.usage?.prompt_tokens ?? 0,
          outputTokens: json.usage?.completion_tokens ?? 0,
        };
        let data: unknown;
        try {
          data = JSON.parse(extractJsonText(raw));
        } catch {
          throw Object.assign(new Error("Groq returned non-JSON output"), { raw });
        }
        return { data, raw, usage, model, latencyMs: Date.now() - t0 };
      }

      const message = json.error?.message ?? "request failed";
      if (RETRYABLE.has(res.status) && attempt < MAX_ATTEMPTS) {
        await sleep(600 * 2 ** (attempt - 1));
        continue;
      }
      if (RETRYABLE.has(res.status)) throw new OverloadError(res.status, `Groq ${res.status}: ${message}`);
      throw new Error(`Groq ${res.status}: ${message}`);
    }
  }
}
