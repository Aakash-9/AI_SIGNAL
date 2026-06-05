/**
 * Live-app registry — turns a generated CompiledApp into a RUNNING app.
 *
 * When a generation succeeds we boot a Runtime (real in-memory SQLite + the
 * enforced auth/permission model) and keep it under a short id. The server then
 * serves a generic SPA at /app/<id> that talks to /app/<id>/api/* — so the
 * "preview" becomes an actually-usable app you can log into and CRUD against,
 * with the runtime enforcing roles, ownership and plan gating for real.
 *
 * Apps live in memory (this is a demo) and the oldest are evicted past a cap.
 */

import { randomUUID } from "node:crypto";
import type { CompiledApp } from "../contracts/compiled.js";
import { Runtime, type RuntimeUser } from "../runtime/index.js";

export interface AppInstance {
  id: string;
  compiled: CompiledApp;
  runtime: Runtime;
  sessions: Map<string, RuntimeUser>;
  tableToEntity: Map<string, string>;
  createdAt: number;
}

const apps = new Map<string, AppInstance>();
const MAX_APPS = 40;

export function registerApp(compiled: CompiledApp): string {
  const id = randomUUID().slice(0, 8);
  const runtime = new Runtime(compiled);
  const tableToEntity = new Map<string, string>();
  for (const t of compiled.db.tables) if (t.sourceEntity) tableToEntity.set(t.name, t.sourceEntity);
  apps.set(id, { id, compiled, runtime, sessions: new Map(), tableToEntity, createdAt: Date.now() });

  while (apps.size > MAX_APPS) {
    let oldest: AppInstance | undefined;
    for (const a of apps.values()) if (!oldest || a.createdAt < oldest.createdAt) oldest = a;
    if (!oldest) break;
    apps.delete(oldest.id);
  }
  return id;
}

export function getApp(id: string): AppInstance | undefined {
  return apps.get(id);
}
