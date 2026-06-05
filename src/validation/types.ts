/**
 * The typed error channel — shared vocabulary between the validation engine
 * (Phase 3, which DETECTS problems) and the repair engine (Phase 4, which FIXES
 * them).
 *
 * This is the heart of "intelligent repair, not brute retry": instead of a
 * pass/fail boolean, every problem is a structured Diagnostic that says exactly
 * WHERE it is (path), WHAT it is (code), HOW bad it is (severity), and crucially
 * HOW to fix it (hint) — including whether a deterministic fixer can handle it
 * or whether a scoped LLM patch is required.
 */

import type { AppSpec } from "../contracts/appspec.js";

export type Severity = "error" | "warning";

/** The four compiler-style tiers, in escalating order. */
export type Tier = "syntactic" | "structural" | "referential" | "semantic";

/**
 * A repair hint. Most kinds are DETERMINISTIC (Phase 4 applies them in code,
 * for free, instantly). `llmPatch` is the escape hatch for problems that need
 * judgment — and even then we re-prompt ONLY the offending part, not the whole app.
 */
export type RepairHint =
  | { kind: "removeKey"; key: string } // strip a hallucinated key at the path
  | { kind: "removeArrayItem" } // drop a dangling array element at the path
  | { kind: "pascalCase" } // normalise an identifier to PascalCase (entity names/refs)
  | { kind: "camelCase" } // normalise an identifier to camelCase (field/role names)
  | { kind: "markOwnable"; entity: string } // set entity.ownable = true
  | { kind: "addDefaultRole" } // make exactly one role the default
  | { kind: "dedupeDefaultRole" } // collapse multiple defaults to one
  | { kind: "addDefaultPlan" } // make exactly one plan the default
  | { kind: "enableAuth" } // turn on auth to resolve a no-login + role-write conflict
  | { kind: "llmPatch"; instruction: string }; // scoped regeneration required

export interface Diagnostic {
  tier: Tier;
  code: string; // machine-readable, e.g. "UNKNOWN_KEY", "MISSING_ENTITY_REF"
  severity: Severity;
  path: (string | number)[]; // precise JSON path for navigation/repair
  pathStr: string; // display form
  message: string;
  /** True when a deterministic fixer can resolve it (no LLM needed). */
  fixable: boolean;
  hint?: RepairHint;
}

export interface ValidationResult {
  /** True when there are zero ERROR-severity diagnostics (warnings are allowed). */
  ok: boolean;
  diagnostics: Diagnostic[];
  /** Present when the candidate is at least structurally valid. */
  spec?: AppSpec;
}

export function pathToString(path: (string | number)[]): string {
  return path.length ? path.map(String).join(".") : "(root)";
}

export function hasErrors(diags: Diagnostic[]): boolean {
  return diags.some((d) => d.severity === "error");
}

/** Convenience constructor. */
export function diag(
  tier: Tier,
  code: string,
  severity: Severity,
  path: (string | number)[],
  message: string,
  fixable: boolean,
  hint?: RepairHint,
): Diagnostic {
  return { tier, code, severity, path, pathStr: pathToString(path), message, fixable, hint };
}
