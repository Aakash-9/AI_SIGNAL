/**
 * Compiler sanity check — runs with ZERO AI.
 *
 * Compiles the reference CRM blueprint into all four layers and then ASSERTS
 * cross-layer consistency: every UI field must trace to a real API endpoint and
 * a real DB column. This is the "they can't disagree" guarantee, proven by code.
 *
 * Run:  npm run test:compiler
 */

import { crmSpec } from "../examples/crm.js";
import { snakeCase, tableName } from "./naming.js";
import { compile } from "./index.js";

const app = compile(crmSpec);

/* ---- Print a readable summary of each compiled layer ---- */
console.log("✅ Compiled MiniCRM into 4 layers.\n");

console.log("DB tables:");
for (const t of app.db.tables) {
  console.log(`  ${t.name}: ${t.columns.map((c) => c.name).join(", ")}`);
}

console.log("\nAPI endpoints:");
for (const e of app.api.endpoints) {
  const roles = e.auth.roles.length ? `[${e.auth.roles.join("/")}]` : "[any]";
  const plan = e.auth.requiresPlan ? ` plan:${e.auth.requiresPlan}` : "";
  console.log(`  ${e.method.padEnd(6)} ${e.path.padEnd(22)} ${roles}${plan}`);
}

console.log("\nAuth policy rules (role x entity x action -> scope):");
for (const r of app.auth.rules) {
  const plan = r.requiresPlan ? ` (plan:${r.requiresPlan})` : "";
  console.log(`  ${r.role} ${r.entity}.${r.action} -> ${r.scope}${plan}`);
}

console.log("\nUI pages:");
for (const p of app.ui.pages) {
  const plan = p.requiresPlan ? ` plan:${p.requiresPlan}` : "";
  console.log(`  ${p.name} (${p.route}) [${p.type}] access:[${p.access.join("/")}]${plan}`);
}

/* ---- Assert cross-layer consistency ---- */
const errors: string[] = [];

// Index DB columns by table for quick lookup.
const columnsByTable = new Map<string, Set<string>>();
for (const t of app.db.tables) {
  columnsByTable.set(t.name, new Set(t.columns.map((c) => c.name)));
}

// Index API endpoint paths.
const apiPaths = new Set(app.api.endpoints.map((e) => `${e.method} ${e.path}`));

// 1. Every API endpoint bound to an entity must have a DB table.
for (const e of app.api.endpoints) {
  if (e.entity && !columnsByTable.has(tableName(e.entity))) {
    errors.push(`API ${e.method} ${e.path} references entity '${e.entity}' with no table`);
  }
}

// 2. Every auth policy rule entity must have a DB table.
for (const r of app.auth.rules) {
  if (!columnsByTable.has(tableName(r.entity))) {
    errors.push(`Policy rule references entity '${r.entity}' with no table`);
  }
}

// 3. Every UI column/form field must exist as a column in the page's entity table.
for (const p of app.ui.pages) {
  if (!p.entity) continue;
  const cols = columnsByTable.get(tableName(p.entity));
  if (!cols) {
    errors.push(`UI page '${p.name}' references entity '${p.entity}' with no table`);
    continue;
  }
  const uiFields = [
    ...(p.columns?.map((c) => c.field) ?? []),
    ...(p.formFields?.map((f) => f.field) ?? []),
  ];
  for (const field of uiFields) {
    if (!cols.has(snakeCase(field))) {
      errors.push(`UI page '${p.name}' shows field '${field}' missing from table '${tableName(p.entity)}'`);
    }
  }
}

// 4. Every UI dataSource (GET) must correspond to a real API endpoint.
for (const p of app.ui.pages) {
  if (p.dataSource && !apiPaths.has(`GET ${p.dataSource}`)) {
    errors.push(`UI page '${p.name}' dataSource '${p.dataSource}' has no matching GET endpoint`);
  }
}

console.log("\n── Cross-layer consistency ──");
if (errors.length === 0) {
  console.log("✅ All UI fields trace to real API endpoints and DB columns. Layers are consistent.");
} else {
  console.error(`❌ ${errors.length} consistency error(s):`);
  for (const e of errors) console.error(`   - ${e}`);
  process.exit(1);
}
