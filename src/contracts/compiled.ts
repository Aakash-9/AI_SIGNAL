/**
 * ============================================================================
 *  Compiled output contracts — what the COMPILER (Phase 1) emits.
 * ============================================================================
 *
 *  The compiler takes ONE validated AppSpec and deterministically projects it
 *  into four interlocking layers. Because all four are derived from the same
 *  blueprint by code, they cannot disagree:
 *
 *      AppSpec ──► DBSchema    (tables & columns)
 *              ──► APISchema   (endpoints, derived from entities + permissions)
 *              ──► AuthPolicy  (the flattened role/plan permission matrix)
 *              ──► UIConfig    (pages bound to API endpoints bound to columns)
 *
 *  These are produced by trusted code, so they're plain TypeScript interfaces
 *  rather than Zod schemas (no untrusted input to validate here).
 * ============================================================================
 */

import type { Action, FieldType } from "./appspec.js";

/* ------------------------------- DB layer -------------------------------- */

export type SqlType = "TEXT" | "INTEGER" | "REAL" | "BOOLEAN" | "DATETIME";

export interface DBColumn {
  name: string; // snake_case column name
  sqlType: SqlType;
  nullable: boolean;
  unique: boolean;
  primaryKey: boolean;
  default?: string | number | boolean | null;
  /** Set when this column is a foreign key. */
  references?: { table: string; column: string };
  /** Carried through for enum fields so the runtime can validate values. */
  enumValues?: string[];
}

export interface DBTable {
  name: string; // snake_case, pluralised (e.g. "contacts")
  /** The AppSpec entity this table came from, or null if the compiler synthesised it
   *  (the `users` table and many-to-many join tables). */
  sourceEntity: string | null;
  columns: DBColumn[];
}

export interface DBSchema {
  tables: DBTable[];
}

/* ------------------------------- API layer ------------------------------- */

export type HttpMethod = "GET" | "POST" | "PATCH" | "DELETE";

export type ApiOperation =
  | "list"
  | "get"
  | "create"
  | "update"
  | "delete"
  | "signup"
  | "login"
  | "me"
  | "subscribe";

export interface EndpointAuth {
  required: boolean;
  /** Roles permitted to call this endpoint. Empty = any authenticated user. */
  roles: string[];
  /** Row scope hint; the runtime enforces per-role scope from AuthPolicy. */
  scope: "all" | "own" | "none";
  /** If set, caller must be on this plan. */
  requiresPlan?: string;
}

export interface ApiField {
  name: string;
  type: FieldType;
  required: boolean;
}

export interface APIEndpoint {
  method: HttpMethod;
  path: string; // e.g. "/api/contacts/:id"
  operation: ApiOperation;
  entity?: string; // source entity (for CRUD endpoints)
  auth: EndpointAuth;
  /** For create/update: the accepted request body fields (derived from the entity). */
  requestFields?: ApiField[];
}

export interface APISchema {
  endpoints: APIEndpoint[];
}

/* ------------------------------- Auth layer ------------------------------ */

export interface PolicyRule {
  role: string;
  entity: string;
  action: Action;
  scope: "all" | "own" | "none";
  requiresPlan?: string;
}

export interface PageAccess {
  page: string;
  route: string;
  roles: string[]; // empty = any authenticated user
  requiresPlan?: string;
}

export interface CompiledPlan {
  name: string;
  price: number;
  currency: string;
  interval: string;
  isDefault: boolean;
  features: string[];
}

/** A ready-to-use login the runtime seeds so the app is usable out of the box. */
export interface SeededUser {
  email: string;
  password: string;
  role: string;
  plan: string;
  label: string; // e.g. "Admin", "Member"
}

export interface AuthPolicy {
  strategy: string;
  requireAuth: boolean;
  roles: string[];
  defaultRole: string;
  plans: CompiledPlan[];
  defaultPlan: string;
  /** The flattened (role x entity x action) permission matrix the runtime enforces. */
  rules: PolicyRule[];
  /** Per-page view access the runtime/UI enforces. */
  pageAccess: PageAccess[];
  /** Pre-created accounts (an admin for the most-privileged role, + a regular user)
   *  so the generated app has working logins immediately — solving "how do I become admin?". */
  seededUsers: SeededUser[];
}

/* -------------------------------- UI layer ------------------------------- */

export interface NavItem {
  label: string;
  route: string;
  roles: string[]; // empty = visible to any authenticated user
  requiresPlan?: string;
}

export interface UIColumn {
  field: string;
  label: string;
  type: FieldType;
}

export interface UIFormField {
  field: string;
  label: string;
  type: FieldType;
  required: boolean;
  enumValues?: string[];
}

export interface UIWidget {
  type: "stat" | "chart" | "table";
  label: string;
  entity?: string;
  metric?: "count" | "sum" | "avg";
  field?: string;
  /** API endpoint the widget pulls data from. */
  dataSource: string;
}

export interface UIPage {
  name: string;
  route: string;
  type: "list" | "detail" | "form" | "dashboard" | "custom" | "pricing";
  access: string[];
  requiresPlan?: string;
  entity?: string;
  /** list pages */
  columns?: UIColumn[];
  dataSource?: string; // GET endpoint feeding a list/detail page
  /** form pages */
  formFields?: UIFormField[];
  submitTo?: { method: HttpMethod; path: string };
  /** dashboard pages */
  widgets?: UIWidget[];
}

export interface UIConfig {
  appName: string;
  nav: NavItem[];
  pages: UIPage[];
  /** Plan tiers for the synthesised Pricing page (present when paid plans exist). */
  plans?: CompiledPlan[];
  /** The endpoint the upgrade button posts to. */
  subscribeEndpoint?: string;
  /** Optional visual theme (color / font scale) applied by the renderer. */
  theme?: { color?: string; fontScale?: number };
}

/* ------------------------------ The bundle ------------------------------- */

export interface CompiledApp {
  db: DBSchema;
  api: APISchema;
  auth: AuthPolicy;
  ui: UIConfig;
}
