/**
 * The pipeline orchestrator: prompt -> intent -> design -> validate+repair ->
 * compile -> execute (smoke tests).
 *
 * Produces a full PipelineTrace: every stage's output, timings, token usage,
 * assumptions, ambiguities, diagnostics, repair steps and the execution proof.
 * The trace is what the demo UI renders and what the eval harness measures —
 * observability is built in, not bolted on.
 *
 * RELIABILITY CONTRACT: generateApp() never throws. Any failure (LLM transport
 * error, non-JSON output, unrepairable spec) is captured in trace.errors and a
 * trace with ok=false is returned, so a single bad prompt can never crash the
 * eval harness or the web server.
 */

import type { AppSpec } from "../contracts/appspec.js";
import type { CompiledApp } from "../contracts/compiled.js";
import { compile } from "../compiler/index.js";
import { getProvider, type LLMProvider } from "../llm/index.js";
import { repair, type RepairStep } from "../repair/index.js";
import { runSmokeTests, type SmokeReport } from "../runtime/index.js";
import type { Diagnostic } from "../validation/index.js";
import { designApp } from "./design.js";
import { extractIntent, type IntentIR } from "./intent.js";

export interface PipelineTrace {
  prompt: string;
  provider: string;
  /** "generate" = from scratch; "refine" = an iterative edit of an existing app. */
  mode: "generate" | "refine";
  ok: boolean;
  /** True when the request was too vague to design — we ask instead of guessing. */
  needsClarification: boolean;
  clarifyingQuestions: string[];
  /** For refine mode: a human-readable summary of what changed. */
  diff?: string[];
  intent?: IntentIR;
  rawSpec?: unknown;
  spec?: AppSpec;
  compiled?: CompiledApp;
  /** Execution proof: did the generated app boot and pass smoke tests? */
  smoke?: SmokeReport;
  assumptions: string[];
  ambiguities: string[];
  warnings: string[];
  errors: string[];
  /** Full typed diagnostics from the validation engine (after repair). */
  diagnostics: Diagnostic[];
  /** What the repair engine did, if anything. */
  repair: { attempts: number; llmCalls: number; steps: RepairStep[] };
  usage: { inputTokens: number; outputTokens: number };
  timings: { intentMs: number; designMs: number; compileMs: number; totalMs: number };
}

export interface GenerateOptions {
  provider?: LLMProvider;
  /** Model override for both stages (used by cost/quality presets later). */
  model?: string;
}

function unique(list: string[]): string[] {
  return [...new Set(list.filter(Boolean))];
}

export function createTrace(prompt: string, providerName: string, mode: "generate" | "refine"): PipelineTrace {
  return {
    prompt,
    provider: providerName,
    mode,
    ok: false,
    needsClarification: false,
    clarifyingQuestions: [],
    assumptions: [],
    ambiguities: [],
    warnings: [],
    errors: [],
    diagnostics: [],
    repair: { attempts: 0, llmCalls: 0, steps: [] },
    usage: { inputTokens: 0, outputTokens: 0 },
    timings: { intentMs: 0, designMs: 0, compileMs: 0, totalMs: 0 },
  };
}

/**
 * Shared backend used by BOTH generate and refine: take an untrusted candidate
 * AppSpec, run validate -> repair -> compile -> execute, and fill the trace.
 * Returns the validated spec (or undefined if unrepairable). Mutates `trace`.
 */
export async function validateRepairCompile(
  trace: PipelineTrace,
  rawSpec: unknown,
  provider: LLMProvider,
  options: GenerateOptions,
): Promise<AppSpec | undefined> {
  const outcome = await repair(rawSpec, { provider, model: options.model });
  trace.diagnostics = outcome.diagnostics;
  trace.repair = { attempts: outcome.attempts, llmCalls: outcome.llmCalls, steps: outcome.steps };
  trace.usage.inputTokens += outcome.usage.inputTokens;
  trace.usage.outputTokens += outcome.usage.outputTokens;
  trace.errors = outcome.diagnostics.filter((d) => d.severity === "error").map((d) => `${d.pathStr}: ${d.message}`);
  trace.warnings.push(
    ...outcome.diagnostics.filter((d) => d.severity === "warning").map((d) => `${d.pathStr}: ${d.message}`),
  );

  if (!outcome.ok || !outcome.spec) return undefined;

  const spec = outcome.spec;
  spec.assumptions = unique([...trace.assumptions, ...spec.assumptions]);
  trace.spec = spec;
  trace.assumptions = spec.assumptions;

  const tc = Date.now();
  const compiled = compile(spec);
  trace.compiled = compiled;
  trace.timings.compileMs = Date.now() - tc;

  trace.smoke = runSmokeTests(compiled);
  trace.ok = trace.smoke.bootOk && trace.smoke.failed === 0;
  return spec;
}

export async function generateApp(
  userRequest: string,
  options: GenerateOptions = {},
): Promise<PipelineTrace> {
  const provider = options.provider ?? getProvider();
  const t0 = Date.now();
  const trace = createTrace(userRequest, provider.name, "generate");

  try {
    // ---- Stage 1: intent ----
    const intentRes = await extractIntent(provider, userRequest, options.model);
    trace.intent = intentRes.intent;
    trace.ambiguities = intentRes.intent.ambiguities;
    trace.assumptions = unique([...intentRes.intent.assumptions]);
    trace.warnings.push(...intentRes.warnings);
    trace.timings.intentMs = intentRes.latencyMs;
    trace.usage.inputTokens += intentRes.usage.inputTokens;
    trace.usage.outputTokens += intentRes.usage.outputTokens;

    // ---- Clarification gate: too vague to build? Ask instead of emitting an empty app. ----
    if (intentRes.intent.entities.length === 0) {
      trace.needsClarification = true;
      trace.clarifyingQuestions =
        intentRes.intent.clarifyingQuestions.length > 0
          ? intentRes.intent.clarifyingQuestions
          : [
              "What does your business or product do?",
              "What are the main things the app should keep track of?",
              "Who will use it, and are there different roles (e.g. admin vs regular user)?",
            ];
      return trace; // ok stays false; not a failure, a request for more info
    }

    // ---- Stage 2: design ----
    const designRes = await designApp(provider, userRequest, intentRes.intent, options.model);
    trace.rawSpec = designRes.rawSpec;
    trace.timings.designMs = designRes.latencyMs;
    trace.usage.inputTokens += designRes.usage.inputTokens;
    trace.usage.outputTokens += designRes.usage.outputTokens;

    // ---- Stages 3-5: validate -> repair -> compile -> execute ----
    const spec = await validateRepairCompile(trace, designRes.rawSpec, provider, options);

    // Post-compile clarification gate: if repair stripped everything down to an
    // app with no data entities, it's an empty shell — ask rather than ship it.
    if (spec && spec.entities.length === 0) {
      trace.needsClarification = true;
      trace.clarifyingQuestions =
        (trace.intent?.clarifyingQuestions.length ?? 0) > 0
          ? trace.intent!.clarifyingQuestions
          : [
              "What kind of records or data should the app manage?",
              "Who will use it, and what are the main things they'll do?",
            ];
      trace.ok = false;
      trace.spec = undefined;
      trace.compiled = undefined;
      trace.smoke = undefined;
    }
  } catch (e) {
    // Reliability contract: capture, never throw.
    trace.errors.push(`pipeline error: ${(e as Error).message}`);
  } finally {
    trace.timings.totalMs = Date.now() - t0;
  }

  return trace;
}
