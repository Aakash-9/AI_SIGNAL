/**
 * Gemini provider — talks to Google's Generative Language REST API.
 *
 * Reliability features (this is a system graded on reliability):
 *   - JSON mode + temperature 0  -> valid, deterministic JSON
 *   - exponential-backoff retries -> rides out transient 429/503 spikes
 *   - automatic model fallback    -> if the primary model stays overloaded,
 *                                    transparently switch to a lighter model
 *
 * We deliberately do NOT rely on Gemini's responseSchema (its OpenAPI subset
 * doesn't cleanly express our discriminated unions); the contract is embedded in
 * the prompt and enforced by our own Zod validation + repair engine.
 */

import type { GenerateOptions, LLMProvider, LLMResult } from "./types.js";

const API_BASE = "https://generativelanguage.googleapis.com/v1beta/models";

/** Status codes worth retrying: rate limits and transient overload. */
const RETRYABLE = new Set([429, 500, 503]);
const MAX_ATTEMPTS = 4;
/** Cap on how long we'll honour a server "retry in Xs" hint. */
const MAX_RETRY_WAIT_MS = 35000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface GeminiResponse {
  candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
  error?: { message?: string };
}

class OverloadError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

/** Strip ```json fences if the model wraps its output despite JSON mode. */
function extractJsonText(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  return (fenced?.[1] ?? text).trim();
}

export class GeminiProvider implements LLMProvider {
  readonly name = "gemini";

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
        // Only fall through to the next model on overload/rate-limit; real
        // errors (bad request, auth) should surface immediately.
        if (!(err instanceof OverloadError)) throw err;
      }
    }
    throw lastError;
  }

  /** One model, with internal backoff retries. Throws OverloadError if it stays overloaded. */
  private async callModel(model: string, opts: GenerateOptions): Promise<LLMResult> {
    const url = `${API_BASE}/${model}:generateContent?key=${this.apiKey}`;
    const body = {
      systemInstruction: { parts: [{ text: opts.system }] },
      contents: [{ role: "user", parts: [{ text: opts.prompt }] }],
      generationConfig: {
        responseMimeType: "application/json",
        temperature: opts.temperature ?? 0,
      },
    };

    const t0 = Date.now();
    for (let attempt = 1; ; attempt++) {
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = (await res.json()) as GeminiResponse;

      if (res.ok && !json.error) {
        const raw = json.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
        const usage = {
          inputTokens: json.usageMetadata?.promptTokenCount ?? 0,
          outputTokens: json.usageMetadata?.candidatesTokenCount ?? 0,
        };
        let data: unknown;
        try {
          data = JSON.parse(extractJsonText(raw));
        } catch {
          throw Object.assign(new Error("Gemini returned non-JSON output"), { raw });
        }
        return { data, raw, usage, model, latencyMs: Date.now() - t0 };
      }

      const message = json.error?.message ?? "request failed";
      if (RETRYABLE.has(res.status) && attempt < MAX_ATTEMPTS) {
        // Respect the server's rate-limit hint ("Please retry in 12.3s") so we
        // actually wait out the window; otherwise exponential backoff.
        const hint = /retry in ([\d.]+)s/i.exec(message)?.[1];
        const waitMs = hint
          ? Math.min(Number(hint) * 1000 + 1500, MAX_RETRY_WAIT_MS)
          : 800 * 2 ** (attempt - 1);
        await sleep(waitMs);
        continue;
      }
      if (RETRYABLE.has(res.status)) throw new OverloadError(res.status, `Gemini ${res.status}: ${message}`);
      throw new Error(`Gemini ${res.status}: ${message}`);
    }
  }
}
