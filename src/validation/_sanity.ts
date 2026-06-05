/**
 * Validation engine demo — runs with ZERO AI.
 *
 * Three blueprints exercise the tiers:
 *   1. the clean CRM            -> no errors
 *   2. structurally broken      -> hallucinated keys (deterministically fixable)
 *   3. logically broken         -> dangling refs + bad scope + double default
 *
 * Run:  npm run test:validation
 */

import { crmSpec } from "../examples/crm.js";
import { validate } from "./index.js";
import type { ValidationResult } from "./types.js";

function report(label: string, result: ValidationResult) {
  console.log(`\n── ${label} ──`);
  console.log(`ok: ${result.ok} | ${result.diagnostics.length} diagnostic(s)`);
  for (const d of result.diagnostics) {
    const fix = d.fixable ? `fix:${d.hint?.kind}` : d.hint?.kind === "llmPatch" ? "fix:llmPatch" : "no-fix";
    const icon = d.severity === "error" ? "✖" : "⚠";
    console.log(`  ${icon} [${d.tier}/${d.code}] ${d.pathStr} — ${d.message}  (${fix})`);
  }
}

// 1. Clean CRM — should be ok.
report("Clean CRM", validate(crmSpec));

// 2. Structurally broken — hallucinated keys on a field and a widget.
const structurallyBroken = {
  meta: { name: "Broken1" },
  entities: [
    {
      name: "Note",
      ownable: true,
      fields: [
        { name: "title", type: "string", required: true, description: "oops, fields can't have description" },
      ],
    },
  ],
  roles: [{ name: "user", isDefault: true }],
  permissions: [{ role: "user", entity: "Note", actions: ["create", "read"], scope: "own" }],
  pages: [
    {
      name: "Dash",
      route: "/dash",
      type: "dashboard",
      access: ["user"],
      widgets: [{ type: "table", label: "Notes", entity: "Note", fields: ["title"] }],
    },
  ],
  auth: { strategy: "email_password" },
};
report("Structurally broken (hallucinated keys)", validate(structurallyBroken));

// 3. Logically broken — valid shape, but inconsistent.
const logicallyBroken = {
  meta: { name: "Broken2" },
  entities: [{ name: "Task", fields: [{ name: "title", type: "string", required: true }] }], // NOT ownable
  roles: [
    { name: "admin", isDefault: true },
    { name: "member", isDefault: true }, // two defaults
    { name: "ghostRole" }, // unused
  ],
  permissions: [
    { role: "member", entity: "Task", actions: ["read"], scope: "own" }, // own but Task not ownable
    { role: "admin", entity: "Ghost", actions: ["read"] }, // Ghost entity does not exist
  ],
  pages: [{ name: "Tasks", route: "/tasks", type: "list", entity: "Task", access: ["member"] }],
  plans: [
    { name: "free", price: 0, isDefault: true },
    { name: "pro", price: 10 },
  ],
  businessRules: [
    { type: "plan_gate", id: "proGate", requiresPlan: "gold", gates: { pages: ["Tasks"] } }, // 'gold' plan missing
  ],
  auth: { strategy: "email_password" },
};
report("Logically broken (dangling refs + bad scope)", validate(logicallyBroken));
