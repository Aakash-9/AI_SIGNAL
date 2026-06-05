/**
 * The schema-driven runtime — the second half of "execution awareness".
 *
 * Given a CompiledApp it behaves like the generated application's backend:
 *   - signup/login against the synthesised users table (hashed passwords)
 *   - generic CRUD against any entity table
 *   - LIVE enforcement of the compiled AuthPolicy: role permissions, ownership
 *     scope ("own" rows), and plan gating (premium features)
 *
 * Nothing here is app-specific — it INTERPRETS the config. The same runtime runs
 * a CRM, a booking app or a project tracker with no code changes. That's the
 * proof the generated config is genuinely executable.
 */

import { randomBytes, randomUUID, scryptSync } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { snakeCase, tableName } from "../compiler/naming.js";
import type { Action } from "../contracts/appspec.js";
import type { CompiledApp, DBColumn, DBTable } from "../contracts/compiled.js";
import { buildDatabase } from "./database.js";

export interface RuntimeUser {
  id: string;
  email: string;
  role: string;
  plan: string;
}

export type OpResult =
  | { ok: true; status: number; data: unknown }
  | { ok: false; status: number; error: string };

const BOILERPLATE = new Set(["id", "owner_id", "created_at", "updated_at", "password_hash"]);

function hashPassword(pw: string): string {
  const salt = randomBytes(16).toString("hex");
  return `${salt}:${scryptSync(pw, salt, 32).toString("hex")}`;
}
function verifyPassword(pw: string, stored: string): boolean {
  const [salt, dk] = stored.split(":");
  if (!salt || !dk) return false;
  return scryptSync(pw, salt, 32).toString("hex") === dk;
}

export class Runtime {
  readonly db: DatabaseSync;
  private readonly tableByEntity = new Map<string, DBTable>();

  constructor(private readonly app: CompiledApp) {
    this.db = buildDatabase(app.db);
    for (const t of app.db.tables) {
      if (t.sourceEntity) this.tableByEntity.set(t.sourceEntity, t);
    }
    // Seed ready-to-use logins (admin + member) so the app works out of the box.
    for (const u of app.auth.seededUsers ?? []) {
      try {
        this.createUser(u.email, u.password, u.role, u.plan);
      } catch {
        /* already seeded */
      }
    }
  }

  /* ----------------------------- auth ----------------------------- */

  /** Create a user with an explicit role/plan (used by tests + admin seeding). */
  createUser(email: string, password: string, role?: string, plan?: string): RuntimeUser {
    const existing = this.db.prepare(`SELECT id FROM users WHERE email = ?`).get(email);
    if (existing) throw new Error(`email already registered: ${email}`);
    const now = new Date().toISOString();
    const user: RuntimeUser = {
      id: randomUUID(),
      email,
      role: role ?? this.app.auth.defaultRole,
      plan: plan ?? this.app.auth.defaultPlan,
    };
    this.db
      .prepare(
        `INSERT INTO users (id, email, password_hash, role, plan, created_at, updated_at) VALUES (?,?,?,?,?,?,?)`,
      )
      .run(user.id, email, hashPassword(password), user.role, user.plan, now, now);
    return user;
  }

  /** Public signup: assigns the default role + plan. */
  signup(email: string, password: string): RuntimeUser {
    return this.createUser(email, password);
  }

  login(email: string, password: string): RuntimeUser | null {
    const row = this.db.prepare(`SELECT * FROM users WHERE email = ?`).get(email) as Record<string, string> | undefined;
    if (!row || !verifyPassword(password, row.password_hash!)) return null;
    return { id: row.id!, email: row.email!, role: row.role!, plan: row.plan! };
  }

  setPlan(user: RuntimeUser, plan: string): RuntimeUser {
    this.db.prepare(`UPDATE users SET plan = ? WHERE id = ?`).run(plan, user.id);
    return { ...user, plan };
  }

  /* -------------------------- authorization ----------------------- */

  /** Resolve whether `user` may perform `action` on `entity`, and at what scope. */
  authorize(
    user: RuntimeUser,
    entity: string,
    action: Action,
  ): { allowed: boolean; scope: "all" | "own" | "none"; reason?: string } {
    const rules = this.app.auth.rules.filter((r) => r.role === user.role && r.entity === entity && r.action === action);
    if (rules.length === 0) return { allowed: false, scope: "none", reason: "no permission for this role" };

    let planBlocked = false;
    for (const r of rules) {
      if (r.scope === "none") continue;
      if (r.requiresPlan && user.plan !== r.requiresPlan) {
        planBlocked = true;
        continue;
      }
      return { allowed: true, scope: r.scope };
    }
    return { allowed: false, scope: "none", reason: planBlocked ? "requires a higher plan" : "denied" };
  }

  /** Can this user view a given page (role + plan gate)? */
  canViewPage(user: RuntimeUser, pageName: string): { allowed: boolean; reason?: string } {
    const page = this.app.auth.pageAccess.find((p) => p.page === pageName);
    if (!page) return { allowed: false, reason: "no such page" };
    if (page.roles.length > 0 && !page.roles.includes(user.role)) return { allowed: false, reason: "role not allowed" };
    if (page.requiresPlan && user.plan !== page.requiresPlan) return { allowed: false, reason: "requires a higher plan" };
    return { allowed: true };
  }

  /* ----------------------------- CRUD ----------------------------- */

  private columnsOf(entity: string): DBColumn[] {
    return this.tableByEntity.get(entity)?.columns ?? [];
  }
  private hasColumn(entity: string, name: string): boolean {
    return this.columnsOf(entity).some((c) => c.name === name);
  }

  /** Convert incoming data (camelCase or snake_case keys) to a DB row. */
  private toRow(entity: string, data: Record<string, unknown>): Record<string, unknown> {
    const cols = this.columnsOf(entity);
    const row: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(data)) {
      const col = cols.find((c) => c.name === snakeCase(k));
      if (!col || BOILERPLATE.has(col.name)) continue;
      row[col.name] = col.sqlType === "BOOLEAN" ? (v ? 1 : 0) : (v as unknown);
    }
    return row;
  }

  /** Convert a DB row back to typed output (booleans, etc.). */
  private fromRow(entity: string, row: Record<string, unknown>): Record<string, unknown> {
    const cols = this.columnsOf(entity);
    const out: Record<string, unknown> = { ...row };
    for (const c of cols) {
      if (c.sqlType === "BOOLEAN" && c.name in out) out[c.name] = !!out[c.name];
    }
    return out;
  }

  create(user: RuntimeUser, entity: string, data: Record<string, unknown>): OpResult {
    const table = this.tableByEntity.get(entity);
    if (!table) return { ok: false, status: 404, error: `unknown entity ${entity}` };
    const auth = this.authorize(user, entity, "create");
    if (!auth.allowed) return { ok: false, status: 403, error: auth.reason ?? "forbidden" };

    const row = this.toRow(entity, data);
    const id = randomUUID();
    const now = new Date().toISOString();
    row.id = id;
    if (this.hasColumn(entity, "owner_id")) row.owner_id = user.id;
    if (this.hasColumn(entity, "created_at")) row.created_at = now;
    if (this.hasColumn(entity, "updated_at")) row.updated_at = now;

    const keys = Object.keys(row);
    const placeholders = keys.map(() => "?").join(",");
    try {
      this.db
        .prepare(`INSERT INTO "${table.name}" (${keys.map((k) => `"${k}"`).join(",")}) VALUES (${placeholders})`)
        .run(...(keys.map((k) => row[k]) as never[]));
    } catch (e) {
      // Turn DB constraint errors (missing required field, unique clash) into a
      // clean 400 instead of a 500.
      const msg = (e as Error).message.replace(/^.*constraint failed:\s*/i, "validation failed: ");
      return { ok: false, status: 400, error: msg };
    }

    return this.get(user, entity, id);
  }

  list(user: RuntimeUser, entity: string): OpResult {
    const table = this.tableByEntity.get(entity);
    if (!table) return { ok: false, status: 404, error: `unknown entity ${entity}` };
    const auth = this.authorize(user, entity, "read");
    if (!auth.allowed) return { ok: false, status: 403, error: auth.reason ?? "forbidden" };

    const ownScoped = auth.scope === "own" && this.hasColumn(entity, "owner_id");
    const sql = ownScoped ? `SELECT * FROM "${table.name}" WHERE owner_id = ?` : `SELECT * FROM "${table.name}"`;
    const rows = (ownScoped ? this.db.prepare(sql).all(user.id) : this.db.prepare(sql).all()) as Record<string, unknown>[];
    return { ok: true, status: 200, data: rows.map((r) => this.fromRow(entity, r)) };
  }

  get(user: RuntimeUser, entity: string, id: string): OpResult {
    const table = this.tableByEntity.get(entity);
    if (!table) return { ok: false, status: 404, error: `unknown entity ${entity}` };
    const auth = this.authorize(user, entity, "read");
    if (!auth.allowed) return { ok: false, status: 403, error: auth.reason ?? "forbidden" };

    const row = this.db.prepare(`SELECT * FROM "${table.name}" WHERE id = ?`).get(id) as Record<string, unknown> | undefined;
    if (!row) return { ok: false, status: 404, error: "not found" };
    if (auth.scope === "own" && this.hasColumn(entity, "owner_id") && row.owner_id !== user.id) {
      return { ok: false, status: 403, error: "not your record" };
    }
    return { ok: true, status: 200, data: this.fromRow(entity, row) };
  }

  remove(user: RuntimeUser, entity: string, id: string): OpResult {
    const table = this.tableByEntity.get(entity);
    if (!table) return { ok: false, status: 404, error: `unknown entity ${entity}` };
    const auth = this.authorize(user, entity, "delete");
    if (!auth.allowed) return { ok: false, status: 403, error: auth.reason ?? "forbidden" };

    if (auth.scope === "own" && this.hasColumn(entity, "owner_id")) {
      const row = this.db.prepare(`SELECT owner_id FROM "${table.name}" WHERE id = ?`).get(id) as
        | { owner_id?: string }
        | undefined;
      if (!row) return { ok: false, status: 404, error: "not found" };
      if (row.owner_id !== user.id) return { ok: false, status: 403, error: "not your record" };
    }
    this.db.prepare(`DELETE FROM "${table.name}" WHERE id = ?`).run(id);
    return { ok: true, status: 200, data: { id } };
  }
}
