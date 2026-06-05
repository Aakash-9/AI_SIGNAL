/**
 * Response cache — record/replay for LLM calls.
 *
 * Why this exists:
 *   - RELIABILITY: the hosted demo and the eval harness serve known prompts from
 *     disk, so they're instant and immune to provider outages/rate limits.
 *   - COST: identical requests never hit the API twice (a real lever in the
 *     cost/quality analysis).
 *   - DETERMINISM: a cached prompt returns byte-identical output every run.
 *
 * Modes:
 *   "rw"  (default) — serve from cache, else call the API and store the result
 *   "ro"            — serve only from cache; a miss throws (no live calls)
 *   "off"           — bypass the cache entirely
 *
 * Keyed by a hash of {provider, stage, model, system, prompt, temperature} so any
 * change to the request is a different entry.
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { GenerateOptions, LLMProvider, LLMResult } from "./types.js";

export type CacheMode = "rw" | "ro" | "off";

const CACHE_DIR = join(process.cwd(), ".cache", "llm");

function cacheKey(providerName: string, opts: GenerateOptions): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        provider: providerName,
        stage: opts.stage ?? "",
        model: opts.model ?? "",
        system: opts.system,
        prompt: opts.prompt,
        temperature: opts.temperature ?? 0,
      }),
    )
    .digest("hex");
}

export class CachingProvider implements LLMProvider {
  readonly name: string;

  constructor(
    private readonly inner: LLMProvider,
    private readonly mode: CacheMode = "rw",
  ) {
    this.name = inner.name;
    if (mode !== "off") mkdirSync(CACHE_DIR, { recursive: true });
  }

  async generateJSON(opts: GenerateOptions): Promise<LLMResult> {
    if (this.mode === "off") return this.inner.generateJSON(opts);

    const file = join(CACHE_DIR, `${cacheKey(this.inner.name, opts)}.json`);
    if (existsSync(file)) {
      const cached = JSON.parse(readFileSync(file, "utf8")) as LLMResult;
      return { ...cached, latencyMs: 0, fromCache: true };
    }

    if (this.mode === "ro") {
      throw new Error("LLM cache miss in read-only mode (live API calls are disabled)");
    }

    const result = await this.inner.generateJSON(opts);
    writeFileSync(file, JSON.stringify(result, null, 2));
    return result;
  }
}
