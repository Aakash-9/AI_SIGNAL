/**
 * Stage 1 — INTENT EXTRACTION.
 *
 * Reads the user's sentence and produces a small, flat structured summary
 * (IntentIR). This is the only stage that has to "understand the human"; it
 * also surfaces ambiguities/assumptions for the failure-handling system.
 */

import { z } from "zod";
import type { LLMProvider } from "../llm/index.js";
import { INTENT_SYSTEM } from "./prompts.js";

export const IntentIR = z
  .object({
    appName: z.string().default("App"),
    appType: z.string().default("generic"),
    summary: z.string().default(""),
    entities: z
      .array(z.object({ name: z.string(), fields: z.array(z.string()).default([]) }))
      .default([]),
    roles: z.array(z.string()).default([]),
    features: z.array(z.string()).default([]),
    hasAuth: z.boolean().default(true),
    hasPayments: z.boolean().default(false),
    ambiguities: z.array(z.string()).default([]),
    assumptions: z.array(z.string()).default([]),
    /** Populated when the request is too vague to design — drives the clarification gate. */
    clarifyingQuestions: z.array(z.string()).default([]),
  })
  // Lenient on unknown keys here — intent is a soft summary, not the strict contract.
  .passthrough();

export type IntentIR = z.infer<typeof IntentIR>;

export interface IntentResult {
  intent: IntentIR;
  usage: { inputTokens: number; outputTokens: number };
  latencyMs: number;
  /** Non-fatal notes (e.g. the model returned a slightly off shape we coerced). */
  warnings: string[];
}

export async function extractIntent(
  provider: LLMProvider,
  userRequest: string,
  model?: string,
): Promise<IntentResult> {
  const res = await provider.generateJSON({
    stage: "intent",
    system: INTENT_SYSTEM,
    prompt: `User request:\n"""${userRequest}"""\n\nExtract the intent as JSON.`,
    temperature: 0,
    model,
  });

  const warnings: string[] = [];
  const parsed = IntentIR.safeParse(res.data);

  // Intent is lenient by design: if the shape is slightly off, coerce with
  // defaults rather than failing the whole pipeline this early.
  const intent = parsed.success ? parsed.data : IntentIR.parse(res.data ?? {});
  if (!parsed.success) warnings.push("Intent output was partially malformed; coerced with defaults.");

  return { intent, usage: res.usage, latencyMs: res.latencyMs, warnings };
}
