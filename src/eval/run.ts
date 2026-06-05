/**
 * Evaluation harness — runs the dataset and produces real metrics.
 *
 *   npm run eval
 *
 * For each case it records: outcome, repairs, scoped patches, smoke pass rate,
 * latency, tokens, and (on failure) a failure-type from a fixed taxonomy. It
 * then prints a summary and writes a markdown report to eval-report.md.
 *
 * First run is live (populates the response cache); re-runs are cache-served and
 * near-instant, which is itself the determinism/repeatability story.
 */

import { writeFileSync } from "node:fs";
import { generateApp, type PipelineTrace } from "../pipeline/index.js";
import { DATASET, type EvalCase } from "./dataset.js";

// Approximate public pricing (USD per 1M tokens) for the cost estimate.
const PRICE_IN = 0.3;
const PRICE_OUT = 2.5;

// Throttle live calls to stay under free-tier rate limits (~10-20 req/min).
// Cached prompts are near-instant and effectively skip the throttle.
// ~8 calls/min sustained (2 calls/prompt every 15s) stays well under the free
// tier's ~20 req/min, so the window never saturates after a clean start.
const THROTTLE_MS = Number(process.env.EVAL_THROTTLE_MS ?? 15000);
// A full rolling-window clear (calls count for ~60s) before retrying.
const RETRY_WAIT_MS = Number(process.env.EVAL_RETRY_WAIT_MS ?? 62000);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function isTransportFailure(t: PipelineTrace): boolean {
  return !t.spec && t.errors.some((e) => /pipeline error|Gemini|Groq|non-JSON|transport|429|503/i.test(e));
}

type Outcome = "working" | "clarification" | "failed";

interface EvalResult {
  id: string;
  category: EvalCase["category"];
  expect: EvalCase["expect"];
  outcome: Outcome;
  success: boolean;
  repairs: number;
  llmPatches: number;
  errorCount: number;
  warningCount: number;
  smokePassed: number;
  smokeTotal: number;
  latencyMs: number;
  inTokens: number;
  outTokens: number;
  cached: boolean;
  entities: number;
  endpoints: number;
  pages: number;
  failureType?: string;
}

function outcomeOf(t: PipelineTrace): Outcome {
  if (t.needsClarification) return "clarification";
  return t.ok ? "working" : "failed";
}

/** Did the system handle the case as expected (graceful + appropriate)? */
function isSuccess(c: EvalCase, outcome: Outcome): boolean {
  if (c.expect === "working") return outcome === "working";
  if (c.expect === "clarification") return outcome === "clarification";
  // "handled": a documented working app OR an appropriate clarification both pass;
  // only an outright failure (errors, no clarification) counts against us.
  return outcome !== "failed";
}

async function runCase(c: EvalCase): Promise<EvalResult> {
  let t = await generateApp(c.prompt);
  // A rate-limit failure isn't a system failure — wait out the per-minute
  // window and retry once so the metric reflects the pipeline, not the quota.
  if (isTransportFailure(t)) {
    await sleep(RETRY_WAIT_MS);
    t = await generateApp(c.prompt);
  }
  const outcome = outcomeOf(t);
  const errs = t.diagnostics.filter((d) => d.severity === "error");
  const warns = t.diagnostics.filter((d) => d.severity === "warning");

  let failureType: string | undefined;
  if (outcome === "failed") {
    if (t.errors.some((e) => /cache miss/i.test(e))) failureType = "NOT_CACHED";
    else if (t.errors.some((e) => /Gemini|Groq|non-JSON|429|503|transport|pipeline error/i.test(e)))
      failureType = "LLM_TRANSPORT";
    else if (errs.some((d) => d.tier === "structural")) failureType = "STRUCTURAL_UNREPAIRED";
    else if (errs.some((d) => d.tier === "referential")) failureType = "REFERENTIAL_UNREPAIRED";
    else if (errs.some((d) => d.tier === "semantic")) failureType = "SEMANTIC_UNREPAIRED";
    else if (t.smoke && t.smoke.failed > 0) failureType = "RUNTIME_SMOKE_FAIL";
    else failureType = "OTHER_ERROR";
  }

  return {
    id: c.id,
    category: c.category,
    expect: c.expect,
    outcome,
    success: isSuccess(c, outcome),
    repairs: t.repair.steps.length,
    llmPatches: t.repair.llmCalls,
    errorCount: errs.length,
    warningCount: warns.length,
    smokePassed: t.smoke?.passed ?? 0,
    smokeTotal: (t.smoke?.passed ?? 0) + (t.smoke?.failed ?? 0),
    latencyMs: t.timings.totalMs,
    inTokens: t.usage.inputTokens,
    outTokens: t.usage.outputTokens,
    // A genuinely cached success returns in well under a second; a failed call
    // also has 0 stage timings, so gate on success to avoid mislabelling it.
    cached: outcome !== "failed" && t.timings.totalMs < 1500,
    entities: t.spec?.entities.length ?? 0,
    endpoints: t.compiled?.api.endpoints.length ?? 0,
    pages: t.compiled?.ui.pages.length ?? 0,
    failureType,
  };
}

function pct(n: number, d: number): string {
  return d === 0 ? "—" : `${Math.round((100 * n) / d)}%`;
}
function avg(xs: number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}

function buildReport(results: EvalResult[]): string {
  const real = results.filter((r) => r.category === "real");
  const edge = results.filter((r) => r.category === "edge");
  const working = results.filter((r) => r.outcome === "working");
  const clarif = results.filter((r) => r.outcome === "clarification");
  const failed = results.filter((r) => r.outcome === "failed");
  const successes = results.filter((r) => r.success);
  const needingRepair = results.filter((r) => r.repairs > 0);
  const usedLlmPatch = results.filter((r) => r.llmPatches > 0);
  // Separate genuine pipeline outcomes from external infra blocks (free-tier
  // rate limits / not-yet-cached prompts) so the metric reflects the SYSTEM.
  const infraBlocked = results.filter((r) => r.failureType === "LLM_TRANSPORT" || r.failureType === "NOT_CACHED");
  const reached = results.filter((r) => !infraBlocked.includes(r));
  const reachedOk = reached.filter((r) => r.success);

  const liveLatencies = results.filter((r) => !r.cached).map((r) => r.latencyMs);
  const totalIn = results.reduce((a, r) => a + r.inTokens, 0);
  const totalOut = results.reduce((a, r) => a + r.outTokens, 0);
  const cost = (totalIn / 1e6) * PRICE_IN + (totalOut / 1e6) * PRICE_OUT;

  const smokeApps = working.filter((r) => r.smokeTotal > 0);
  const smokePassRate = avg(smokeApps.map((r) => r.smokePassed / r.smokeTotal));

  // Failure taxonomy
  const taxonomy = new Map<string, number>();
  for (const r of failed) taxonomy.set(r.failureType ?? "OTHER", (taxonomy.get(r.failureType ?? "OTHER") ?? 0) + 1);

  const lines: string[] = [];
  lines.push("# Evaluation Report\n");
  lines.push(`Dataset: **${results.length}** prompts (${real.length} real product prompts, ${edge.length} edge cases).\n`);

  lines.push("## Headline metrics\n");
  lines.push(
    `> Note: prompts marked LLM_TRANSPORT / NOT_CACHED were blocked by the free-tier ` +
      `rate limit (external infra), not by the pipeline — they were handled gracefully (no crash). ` +
      `The pipeline metric below excludes them.\n`,
  );
  lines.push("| Metric | Value |");
  lines.push("| --- | --- |");
  lines.push(`| **Pipeline success (prompts that reached the LLM)** | **${pct(reachedOk.length, reached.length)}** (${reachedOk.length}/${reached.length}) |`);
  lines.push(`| Blocked by free-tier rate limit / not cached | ${infraBlocked.length} |`);
  lines.push(`| Overall (incl. infra-blocked) | ${pct(successes.length, results.length)} (${successes.length}/${results.length}) |`);
  lines.push(`| Real prompts → working app | **${pct(real.filter((r) => r.outcome === "working").length, real.length)}** |`);
  lines.push(`| Edge cases → handled (no crash) | **${pct(edge.filter((r) => r.outcome !== "failed").length, edge.length)}** |`);
  lines.push(`| Outcomes | ${working.length} working · ${clarif.length} clarification · ${failed.length} failed |`);
  lines.push(`| Execution proof (avg smoke pass rate, working apps) | **${(smokePassRate * 100).toFixed(0)}%** |`);
  lines.push(`| Requests needing any repair | ${pct(needingRepair.length, results.length)} (${needingRepair.length}/${results.length}) |`);
  lines.push(`| Requests needing a scoped LLM patch | ${pct(usedLlmPatch.length, results.length)} (${usedLlmPatch.length}/${results.length}) |`);
  lines.push(`| Avg repair steps / request | ${avg(results.map((r) => r.repairs)).toFixed(2)} |`);
  lines.push(`| Avg scoped LLM patches / request | ${avg(results.map((r) => r.llmPatches)).toFixed(2)} |`);
  lines.push(`| Avg latency (live, uncached) | ${Math.round(avg(liveLatencies))}ms |`);
  lines.push(`| Total tokens | ${totalIn.toLocaleString()} in / ${totalOut.toLocaleString()} out |`);
  lines.push(`| Est. cost (gemini-2.5-flash public rates) | $${cost.toFixed(4)} |`);
  lines.push("");

  lines.push("## Failure taxonomy\n");
  if (taxonomy.size === 0) {
    lines.push("No failures. Every prompt produced a working app or an appropriate clarification.\n");
  } else {
    lines.push("| Failure type | Count |");
    lines.push("| --- | --- |");
    for (const [k, v] of taxonomy) lines.push(`| ${k} | ${v} |`);
    lines.push("");
  }

  lines.push("## Per-prompt results\n");
  lines.push("| ID | Cat | Expected | Outcome | ✓ | Repairs | Patches | Smoke | Latency | Tokens(in/out) | Detail |");
  lines.push("| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |");
  for (const r of results) {
    const smoke = r.smokeTotal ? `${r.smokePassed}/${r.smokeTotal}` : "—";
    const detail =
      r.outcome === "working"
        ? `${r.entities}e ${r.endpoints}ep ${r.pages}pg`
        : r.outcome === "clarification"
          ? "asked"
          : (r.failureType ?? "failed");
    lines.push(
      `| ${r.id} | ${r.category} | ${r.expect} | ${r.outcome} | ${r.success ? "✅" : "❌"} | ${r.repairs} | ${r.llmPatches} | ${smoke} | ${r.latencyMs}ms${r.cached ? " ⚡" : ""} | ${r.inTokens}/${r.outTokens} | ${detail} |`,
    );
  }
  lines.push("");
  return lines.join("\n");
}

async function main() {
  console.log(`\nRunning eval on ${DATASET.length} prompts (first run is live, then cached)…\n`);
  const results: EvalResult[] = [];
  for (const c of DATASET) {
    const r = await runCase(c);
    results.push(r);
    const icon = r.success ? "✅" : "❌";
    console.log(
      `  ${icon} ${r.id.padEnd(22)} ${r.outcome.padEnd(13)} repairs:${r.repairs} patches:${r.llmPatches} ` +
        `smoke:${r.smokeTotal ? r.smokePassed + "/" + r.smokeTotal : "-"} ${r.latencyMs}ms${r.cached ? "⚡" : ""}` +
        (r.failureType ? ` [${r.failureType}]` : ""),
    );
    // Throttle only after a live (uncached) call, to respect rate limits.
    if (!r.cached && c !== DATASET[DATASET.length - 1]) await sleep(THROTTLE_MS);
  }

  const report = buildReport(results);
  writeFileSync("eval-report.md", report, "utf8");

  const successes = results.filter((r) => r.success).length;
  console.log(`\n${"─".repeat(60)}`);
  console.log(`Overall: ${successes}/${results.length} handled as expected.`);
  console.log(`Report written to eval-report.md`);
}

main();
