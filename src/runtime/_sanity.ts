/**
 * Runtime execution proof — runs with ZERO AI.
 *
 * Boots the compiled CRM in the schema-driven runtime and runs the smoke suite.
 * If these pass, the generated config is genuinely EXECUTABLE: a real database, a
 * working login, enforced permissions, ownership isolation and premium gating.
 *
 * Run:  npm run test:runtime
 */

import { compile } from "../compiler/index.js";
import { crmSpec } from "../examples/crm.js";
import { runSmokeTests } from "./smoke.js";

const app = compile(crmSpec);
const report = runSmokeTests(app);

console.log(`Boot: ${report.bootOk ? "OK" : "FAILED"}\n`);
for (const t of report.tests) {
  const icon = t.status === "pass" ? "✅" : t.status === "skip" ? "⏭️ " : "❌";
  console.log(`  ${icon} ${t.name} — ${t.detail}`);
}
console.log(
  `\nPassed ${report.passed}/${report.passed + report.failed}` +
    (report.skipped ? ` (${report.skipped} skipped)` : "") +
    ` → pass rate ${(report.passRate * 100).toFixed(0)}%`,
);

if (report.failed > 0) process.exit(1);
