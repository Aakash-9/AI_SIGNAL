/**
 * Repair engine demo.
 *
 * Case A runs with ZERO AI (deterministic fixers only).
 * Case B uses a tiny offline STUB provider to exercise the scoped-LLM-patch path
 * deterministically (no network, no quota) — it fixes the dangling references in
 * exactly the fragments the repair loop hands it.
 *
 * Run:  npm run test:repair
 */

import { compile } from "../compiler/index.js";
import type { GenerateOptions, LLMProvider, LLMResult } from "../llm/index.js";
import { repair } from "./index.js";

/** Offline stand-in for the model: corrects the broken fragment it is given. */
class StubRepairProvider implements LLMProvider {
  readonly name = "stub";
  async generateJSON(opts: GenerateOptions): Promise<LLMResult> {
    const marker = "Current fragment JSON:\n";
    const i = opts.prompt.indexOf(marker);
    const fragStr = opts.prompt.slice(i + marker.length).split("\n\nReturn")[0]!;
    // The stub "knows" the right names just like a model would infer them.
    const fixed = fragStr.replace(/Ghost/g, "Task").replace(/gold/g, "pro");
    return { data: JSON.parse(fixed), raw: fixed, usage: { inputTokens: 0, outputTokens: 0 }, model: "stub", latencyMs: 0 };
  }
}

function show(label: string, outcome: Awaited<ReturnType<typeof repair>>) {
  console.log(`\n── ${label} ──`);
  console.log(`ok: ${outcome.ok} | attempts: ${outcome.attempts} | llmCalls: ${outcome.llmCalls}`);
  for (const s of outcome.steps) {
    console.log(`  [attempt ${s.attempt}] ${s.kind} (errorsBefore=${s.errorsBefore})`);
    for (const a of s.applied) console.log(`      - ${a}`);
  }
  if (outcome.ok && outcome.spec) {
    const app = compile(outcome.spec);
    console.log(`  ✅ repaired & compiled: tables=[${app.db.tables.map((t) => t.name).join(", ")}], endpoints=${app.api.endpoints.length}`);
  } else {
    console.log("  ❌ still has errors:");
    for (const d of outcome.diagnostics.filter((x) => x.severity === "error")) console.log(`      ${d.pathStr}: ${d.message}`);
  }
}

// Case A — hallucinated keys (deterministic only).
const structurallyBroken = {
  meta: { name: "Broken1" },
  entities: [
    {
      name: "Note",
      ownable: true,
      fields: [{ name: "title", type: "string", required: true, description: "fields can't have description" }],
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
show("Case A: hallucinated keys (deterministic)", await repair(structurallyBroken));

// Case B — dangling refs + bad scope + double default (deterministic + scoped patch).
const logicallyBroken = {
  meta: { name: "Broken2" },
  entities: [{ name: "Task", fields: [{ name: "title", type: "string", required: true }] }],
  roles: [
    { name: "admin", isDefault: true },
    { name: "member", isDefault: true },
  ],
  permissions: [
    { role: "member", entity: "Task", actions: ["read"], scope: "own" }, // Task not ownable
    { role: "admin", entity: "Ghost", actions: ["read"] }, // Ghost missing -> scoped patch
  ],
  pages: [{ name: "Tasks", route: "/tasks", type: "list", entity: "Task", access: ["member", "admin"] }],
  plans: [
    { name: "free", price: 0, isDefault: true },
    { name: "pro", price: 10 },
  ],
  businessRules: [{ type: "plan_gate", id: "proGate", requiresPlan: "gold", gates: { pages: ["Tasks"] } }], // gold missing
  auth: { strategy: "email_password" },
};
show("Case B: dangling refs + bad scope (deterministic + scoped patch)", await repair(logicallyBroken, { provider: new StubRepairProvider() }));
