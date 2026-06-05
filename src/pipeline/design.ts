/**
 * Stage 2 — SYSTEM DESIGN.
 *
 * Turns the structured intent into a full AppSpec blueprint. The output is
 * returned RAW (untrusted) — the validation engine (Phase 3) and repair engine
 * (Phase 4) are what make it safe. This stage just produces a candidate.
 */

import type { LLMProvider } from "../llm/index.js";
import type { IntentIR } from "./intent.js";
import { DESIGN_SYSTEM, buildDesignPrompt } from "./prompts.js";

export interface DesignResult {
  /** Untrusted candidate AppSpec (input shape). Validate before use. */
  rawSpec: unknown;
  raw: string;
  usage: { inputTokens: number; outputTokens: number };
  latencyMs: number;
}

export async function designApp(
  provider: LLMProvider,
  userRequest: string,
  intent: IntentIR,
  model?: string,
): Promise<DesignResult> {
  const res = await provider.generateJSON({
    stage: "design",
    system: DESIGN_SYSTEM,
    prompt: buildDesignPrompt(userRequest, JSON.stringify(intent, null, 2)),
    temperature: 0,
    model,
  });

  return { rawSpec: res.data, raw: res.raw, usage: res.usage, latencyMs: res.latencyMs };
}
