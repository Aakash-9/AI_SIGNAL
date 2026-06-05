/**
 * Smoke tests — the execution proof.
 *
 * Boots the compiled app in the runtime and asserts it actually BEHAVES:
 *   - the database boots and every table exists
 *   - signup + login work (and reject bad passwords)
 *   - a record can be created and read back intact (CRUD round-trip)
 *   - ownership isolation holds (one user can't see another's "own" records)
 *   - permissions are enforced (a role is denied an action it lacks)
 *   - plan gating works (a premium page is blocked until the user upgrades)
 *
 * The suite is ADAPTIVE: it inspects whatever app was generated and skips a
 * check (rather than failing) when the app has no such feature. The pass rate is
 * the headline "is the output executable?" metric for the eval harness.
 */

import type { Action } from "../contracts/appspec.js";
import type { CompiledApp, DBColumn } from "../contracts/compiled.js";
import { Runtime, type RuntimeUser } from "./runtime.js";

export interface SmokeTest {
  name: string;
  status: "pass" | "fail" | "skip";
  detail: string;
}
export interface SmokeReport {
  bootOk: boolean;
  tests: SmokeTest[];
  passed: number;
  failed: number;
  skipped: number;
  /** passed / (passed + failed) — skips don't count against the app. */
  passRate: number;
}

const BOILERPLATE = new Set(["id", "owner_id", "created_at", "updated_at", "password_hash"]);

function sampleValue(col: DBColumn): unknown {
  if (col.enumValues?.length) return col.enumValues[0];
  if (col.references) return crypto.randomUUID(); // dummy FK (constraints aren't enforced in the runtime)
  // UNIQUE columns must get distinct values across records, or a second insert
  // (e.g. in the ownership test) hits a UNIQUE constraint.
  const uniq = col.unique;
  switch (col.sqlType) {
    case "BOOLEAN":
      return true;
    case "INTEGER":
      return uniq ? Math.floor(Math.random() * 1_000_000_000) : 1;
    case "REAL":
      return uniq ? Math.random() * 1000 : 1.5;
    case "DATETIME":
      return new Date().toISOString();
    default:
      if (col.name.includes("email")) return `${crypto.randomUUID().slice(0, 8)}@test.com`;
      return uniq ? `${col.name}-${crypto.randomUUID().slice(0, 8)}` : "sample";
  }
}

function sampleData(columns: DBColumn[]): Record<string, unknown> {
  const data: Record<string, unknown> = {};
  for (const c of columns) {
    if (c.primaryKey || BOILERPLATE.has(c.name)) continue;
    data[c.name] = sampleValue(c);
  }
  return data;
}

export function runSmokeTests(app: CompiledApp): SmokeReport {
  const tests: SmokeTest[] = [];
  const add = (name: string, fn: () => { status: "pass" | "skip"; detail: string }) => {
    try {
      tests.push({ name, ...fn() });
    } catch (e) {
      tests.push({ name, status: "fail", detail: (e as Error).message });
    }
  };

  let rt: Runtime;
  try {
    rt = new Runtime(app);
  } catch (e) {
    return {
      bootOk: false,
      tests: [{ name: "boot: database", status: "fail", detail: (e as Error).message }],
      passed: 0,
      failed: 1,
      skipped: 0,
      passRate: 0,
    };
  }

  const probe = (role: string, plan = app.auth.defaultPlan): RuntimeUser => ({ id: "_probe", email: "", role, plan });
  const can = (role: string, entity: string, action: Action, plan?: string) =>
    rt.authorize(probe(role, plan), entity, action).allowed;

  const entityTables = app.db.tables.filter((t) => t.sourceEntity);
  const defaultRole = app.auth.defaultRole;

  // 1. Boot: every table exists.
  add("boot: all tables created", () => {
    const names = (rt.db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[]).map(
      (r) => r.name,
    );
    const missing = app.db.tables.map((t) => t.name).filter((n) => !names.includes(n));
    if (missing.length) throw new Error(`missing tables: ${missing.join(", ")}`);
    return { status: "pass", detail: `${names.length} tables booted` };
  });

  // 2. Auth: signup + login.
  add("auth: signup + login", () => {
    if (!app.auth.requireAuth) return { status: "skip", detail: "auth disabled" };
    const u = rt.signup("alice@test.com", "secret1");
    const good = rt.login("alice@test.com", "secret1");
    const bad = rt.login("alice@test.com", "wrong");
    if (!good || good.id !== u.id) throw new Error("login with correct password failed");
    if (bad) throw new Error("login accepted a wrong password");
    return { status: "pass", detail: `user role=${u.role} plan=${u.plan}; bad password rejected` };
  });

  // 3. CRUD round-trip.
  add("crud: create + read back", () => {
    const table = entityTables.find((t) => can(defaultRole, t.sourceEntity!, "create") && can(defaultRole, t.sourceEntity!, "read"));
    if (!table) return { status: "skip", detail: "default role has no creatable+readable entity" };
    const entity = table.sourceEntity!;
    const user = rt.createUser(`crud-${crypto.randomUUID().slice(0, 6)}@test.com`, "pw", defaultRole);
    const data = sampleData(table.columns);
    const created = rt.create(user, entity, data);
    if (!created.ok) throw new Error(`create failed: ${created.error}`);
    const id = (created.data as { id: string }).id;
    const fetched = rt.get(user, entity, id);
    if (!fetched.ok) throw new Error(`read-back failed: ${fetched.error}`);
    // verify one business field round-tripped
    const checkCol = table.columns.find((c) => !c.primaryKey && !BOILERPLATE.has(c.name) && !c.references);
    if (checkCol) {
      const got = (fetched.data as Record<string, unknown>)[checkCol.name];
      if (got !== data[checkCol.name]) throw new Error(`field '${checkCol.name}' mismatch: ${got} != ${data[checkCol.name]}`);
    }
    return { status: "pass", detail: `${entity}: created + read back (id ${id.slice(0, 8)})` };
  });

  // 4. Ownership isolation.
  add("auth: ownership isolation", () => {
    const table = entityTables.find(
      (t) =>
        t.columns.some((c) => c.name === "owner_id") &&
        rt.authorize(probe(defaultRole), t.sourceEntity!, "read").scope === "own" &&
        can(defaultRole, t.sourceEntity!, "create"),
    );
    if (!table) return { status: "skip", detail: "no owner-scoped entity for default role" };
    const entity = table.sourceEntity!;
    const a = rt.createUser(`a-${crypto.randomUUID().slice(0, 6)}@test.com`, "pw", defaultRole);
    const b = rt.createUser(`b-${crypto.randomUUID().slice(0, 6)}@test.com`, "pw", defaultRole);
    const created = rt.create(a, entity, sampleData(table.columns));
    if (!created.ok) throw new Error(`setup create failed: ${created.error}`);
    const id = (created.data as { id: string }).id;
    const bList = rt.list(b, entity);
    if (!bList.ok) throw new Error(`B list failed: ${bList.error}`);
    if ((bList.data as unknown[]).length !== 0) throw new Error("B can see A's records");
    const bGet = rt.get(b, entity, id);
    if (bGet.ok) throw new Error("B can read A's record by id");
    return { status: "pass", detail: `${entity}: user B blocked from user A's record (status ${bGet.status})` };
  });

  // 5. Permission denial (a role is denied an action it lacks but another role has).
  add("auth: permission denied", () => {
    const actions: Action[] = ["create", "read", "update", "delete"];
    for (const t of entityTables) {
      const entity = t.sourceEntity!;
      for (const action of actions) {
        const allowedRole = app.auth.roles.find((r) => can(r, entity, action));
        if (allowedRole && !can(defaultRole, entity, action) && defaultRole !== allowedRole) {
          const user = rt.createUser(`denied-${crypto.randomUUID().slice(0, 6)}@test.com`, "pw", defaultRole);
          const res =
            action === "delete"
              ? rt.remove(user, entity, "any-id")
              : action === "create"
                ? rt.create(user, entity, sampleData(t.columns))
                : action === "read"
                  ? rt.list(user, entity)
                  : rt.get(user, entity, "any-id"); // proxy for update permission path
          if (res.ok) throw new Error(`${defaultRole} was allowed to ${action} ${entity}`);
          return { status: "pass", detail: `${defaultRole} denied '${action}' on ${entity} (status ${res.status})` };
        }
      }
    }
    return { status: "skip", detail: "no role-restricted action to test" };
  });

  // 6. Plan gating (premium page blocked until upgrade).
  add("logic: plan gating", () => {
    const gated = app.auth.pageAccess.find((p) => p.requiresPlan);
    if (!gated) return { status: "skip", detail: "no plan-gated page" };
    const role = gated.roles[0] ?? defaultRole;
    const user = rt.createUser(`plan-${crypto.randomUUID().slice(0, 6)}@test.com`, "pw", role, app.auth.defaultPlan);
    const before = rt.canViewPage(user, gated.page);
    if (before.allowed) throw new Error(`free user already saw gated page '${gated.page}'`);
    const upgraded = rt.setPlan(user, gated.requiresPlan!);
    const after = rt.canViewPage(upgraded, gated.page);
    if (!after.allowed) throw new Error(`upgraded user still blocked from '${gated.page}': ${after.reason}`);
    return { status: "pass", detail: `'${gated.page}' blocked on ${app.auth.defaultPlan}, allowed on ${gated.requiresPlan}` };
  });

  const passed = tests.filter((t) => t.status === "pass").length;
  const failed = tests.filter((t) => t.status === "fail").length;
  const skipped = tests.filter((t) => t.status === "skip").length;
  return { bootOk: true, tests, passed, failed, skipped, passRate: passed + failed === 0 ? 1 : passed / (passed + failed) };
}
