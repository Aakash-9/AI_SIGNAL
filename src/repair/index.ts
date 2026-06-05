/**
 * The repair loop — the compiler's "fix errors and re-check" cycle.
 *
 * Strategy (cheapest-first, always terminating):
 *   repeat up to maxAttempts:
 *     validate the candidate
 *     if there are DETERMINISTIC fixes (errors or fixable warnings) -> apply them
 *     else if there are LLM-patchable ERRORS and budget remains       -> scoped patch
 *     else                                                            -> stop
 *
 * Deterministic fixes are preferred because they're free, instant and
 * reproducible. The LLM is a last resort and strictly budgeted (maxLlmPatches),
 * so cost and latency stay bounded. Each deterministic fix is self-clearing
 * (it removes the diagnostic that triggered it), so the loop converges.
 */

import type { AppSpec } from "../contracts/appspec.js";
import type { LLMProvider } from "../llm/index.js";
import { validate } from "../validation/index.js";
import type { Diagnostic } from "../validation/types.js";
import { applyDeterministicFixes } from "./deterministic.js";
import { applyLLMPatch } from "./llmpatch.js";
import { clone, type Json } from "./paths.js";

export interface RepairStep {
  attempt: number;
  kind: "deterministic" | "llmPatch";
  errorsBefore: number;
  applied: string[];
}

export interface RepairOutcome {
  ok: boolean;
  spec?: AppSpec;
  candidate: Json;
  diagnostics: Diagnostic[];
  steps: RepairStep[];
  llmCalls: number;
  attempts: number;
  usage: { inputTokens: number; outputTokens: number };
}

export interface RepairOptions {
  provider?: LLMProvider;
  model?: string;
  maxAttempts?: number;
  maxLlmPatches?: number;
}

const isDeterministic = (d: Diagnostic) => d.fixable && d.hint != null && d.hint.kind !== "llmPatch";

export async function repair(rawCandidate: unknown, options: RepairOptions = {}): Promise<RepairOutcome> {
  const maxAttempts = options.maxAttempts ?? 8;
  const maxLlmPatches = options.maxLlmPatches ?? 5;

  let candidate: Json = clone(rawCandidate);
  const steps: RepairStep[] = [];
  let llmCalls = 0;
  let attempt = 0;
  const usage = { inputTokens: 0, outputTokens: 0 };

  for (; attempt < maxAttempts; attempt++) {
    const result = validate(candidate);
    const errors = result.diagnostics.filter((d) => d.severity === "error");

    // 1. Deterministic fixes first (covers fixable errors AND fixable warnings).
    const deterministic = result.diagnostics.filter(isDeterministic);
    if (deterministic.length > 0) {
      const { applied } = applyDeterministicFixes(candidate, deterministic);
      // Convergence guard: if a round changes nothing, the fix can't resolve the
      // error — stop spinning and fall through to the LLM patch / break, rather
      // than looping uselessly to maxAttempts.
      if (applied.length > 0) {
        steps.push({ attempt: attempt + 1, kind: "deterministic", errorsBefore: errors.length, applied });
        continue;
      }
    }

    // 2. Clean (no errors, nothing left to deterministically normalise) -> done.
    if (result.ok && result.spec) {
      return { ok: true, spec: result.spec, candidate, diagnostics: result.diagnostics, steps, llmCalls, attempts: attempt, usage };
    }

    // 3. Scoped LLM patch for the judgment cases, within budget.
    const llmDiags = errors.filter((d) => d.hint?.kind === "llmPatch");
    if (llmDiags.length > 0 && options.provider && llmCalls < maxLlmPatches) {
      const out = await applyLLMPatch(candidate, llmDiags, options.provider, options.model);
      candidate = out.candidate;
      llmCalls += out.llmCalls;
      usage.inputTokens += out.usage.inputTokens;
      usage.outputTokens += out.usage.outputTokens;
      steps.push({ attempt: attempt + 1, kind: "llmPatch", errorsBefore: errors.length, applied: out.applied });
      continue;
    }

    // 4. Nothing more we can do (no fixers apply, or LLM budget exhausted).
    break;
  }

  const final = validate(candidate);
  return {
    ok: final.ok && !!final.spec,
    spec: final.spec,
    candidate,
    diagnostics: final.diagnostics,
    steps,
    llmCalls,
    attempts: attempt,
    usage,
  };
}
