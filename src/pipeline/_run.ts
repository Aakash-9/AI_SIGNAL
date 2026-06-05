/**
 * CLI: run the full pipeline on a prompt and print the trace.
 *
 *   npm run generate -- "Build a CRM with login, contacts and premium analytics"
 */

import { generateApp } from "./index.js";

const prompt = process.argv.slice(2).join(" ").trim();
if (!prompt) {
  console.error('Usage: npm run generate -- "your app description"');
  process.exit(1);
}

const trace = await generateApp(prompt);

console.log("\n══════════════════════════════════════════════");
console.log(`PROMPT: ${trace.prompt}`);
console.log(`Provider: ${trace.provider} | ok: ${trace.ok}`);
console.log("══════════════════════════════════════════════\n");

console.log("⏱  Timings:", trace.timings);
console.log("🔢 Tokens:", trace.usage);

if (trace.intent) {
  console.log("\n── Intent ──");
  console.log(`  ${trace.intent.appType}: ${trace.intent.summary}`);
  console.log(`  entities: ${trace.intent.entities.map((e) => e.name).join(", ")}`);
  console.log(`  roles: ${trace.intent.roles.join(", ")}`);
}

if (trace.needsClarification) {
  console.log("\n🤔 Request too vague to build — clarification needed:");
  for (const q of trace.clarifyingQuestions) console.log(`   ? ${q}`);
  console.log("\n(No empty app emitted. Add detail and try again.)");
  process.exit(0);
}

if (trace.ambiguities.length) {
  console.log("\n⚠  Ambiguities:");
  for (const a of trace.ambiguities) console.log(`   - ${a}`);
}
if (trace.assumptions.length) {
  console.log("\n📝 Assumptions:");
  for (const a of trace.assumptions) console.log(`   - ${a}`);
}

if (trace.repair.steps.length) {
  console.log(`\n🔧 Repair: ${trace.repair.attempts} attempt(s), ${trace.repair.llmCalls} scoped LLM patch call(s)`);
  for (const s of trace.repair.steps) {
    console.log(`   [attempt ${s.attempt}] ${s.kind} (errors before: ${s.errorsBefore})`);
    for (const a of s.applied) console.log(`      - ${a}`);
  }
}

if (trace.diagnostics.length) {
  console.log("\n🔍 Remaining diagnostics:");
  for (const d of trace.diagnostics) {
    const icon = d.severity === "error" ? "✖" : "⚠";
    const fix = d.fixable ? `fix:${d.hint?.kind}` : d.hint?.kind === "llmPatch" ? "fix:llmPatch" : "no-fix";
    console.log(`   ${icon} [${d.tier}/${d.code}] ${d.pathStr} — ${d.message}  (${fix})`);
  }
}

if (!trace.ok) {
  console.log("\n❌ Has blocking errors. The repair engine (Phase 4) will fix these and recompile.");
  process.exit(0);
}

const { compiled, spec } = trace;
console.log("\n✅ Compiled app:");
console.log(`  entities: ${spec!.entities.map((e) => e.name).join(", ")}`);
console.log(`  tables:   ${compiled!.db.tables.map((t) => t.name).join(", ")}`);
console.log(`  endpoints: ${compiled!.api.endpoints.length}`);
console.log(`  pages:    ${compiled!.ui.pages.map((p) => p.name).join(", ")}`);
console.log(`  plans:    ${compiled!.auth.plans.map((p) => `${p.name}=$${p.price}`).join(", ")}`);

if (trace.smoke) {
  const s = trace.smoke;
  console.log(`\n🧪 Execution proof (boot + smoke tests): ${s.passed}/${s.passed + s.failed} passed` + (s.skipped ? `, ${s.skipped} skipped` : ""));
  for (const t of s.tests) {
    const icon = t.status === "pass" ? "✅" : t.status === "skip" ? "⏭️ " : "❌";
    console.log(`   ${icon} ${t.name} — ${t.detail}`);
  }
}
