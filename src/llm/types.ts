/**
 * LLM provider abstraction.
 *
 * Every stage talks to the model through this single interface, so swapping
 * Gemini for Ollama, a paid model, or the deterministic mock is a one-line
 * change. Each call returns not just the data but the USAGE and LATENCY too —
 * that telemetry feeds the cost/quality analysis (Phase 8) and the eval
 * harness (Phase 7).
 */

export interface LLMUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface LLMResult {
  /** Parsed JSON value the model returned (still UNTRUSTED until validated). */
  data: unknown;
  /** The raw text, kept for debugging and JSON-repair. */
  raw: string;
  usage: LLMUsage;
  model: string;
  latencyMs: number;
  /** True when served from the response cache (no live API call was made). */
  fromCache?: boolean;
}

export interface GenerateOptions {
  system: string;
  prompt: string;
  /** Lower = more deterministic. Defaults to 0. */
  temperature?: number;
  /** Override the provider's default model (used for cost/quality routing). */
  model?: string;
  /** A label for tracing/telemetry, e.g. "intent" or "design". */
  stage?: string;
}

export interface LLMProvider {
  readonly name: string;
  /** Generate a JSON response. Throws on transport/parse failure. */
  generateJSON(opts: GenerateOptions): Promise<LLMResult>;
}
