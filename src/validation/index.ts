/**
 * The validation engine — runs the tiers in escalating order.
 *
 *   syntactic  : (handled upstream by the provider's JSON.parse)
 *   structural : Zod strict parse           -> if it fails, stop here
 *   referential: symbol-table resolution    } only run once the candidate is
 *   semantic   : business-logic consistency } structurally valid
 *
 * Stopping at the first failing tier is intentional and compiler-like: there's
 * no point checking references on an object that isn't even shaped right. The
 * repair loop (Phase 4) fixes structural issues, then re-validates, which peels
 * the next tier — exactly how a compiler surfaces errors in waves.
 */

import { safeParseAppSpec } from "../contracts/appspec.js";
import { referentialDiagnostics } from "./referential.js";
import { semanticDiagnostics } from "./semantic.js";
import { structuralDiagnostics } from "./structural.js";
import { hasErrors, type Diagnostic, type ValidationResult } from "./types.js";

export function validate(candidate: unknown): ValidationResult {
  // Tier 2: structural.
  const parsed = safeParseAppSpec(candidate);
  if (!parsed.success) {
    const diagnostics = structuralDiagnostics(parsed.error);
    return { ok: false, diagnostics };
  }

  const spec = parsed.data;

  // Tiers 3 & 4: referential + semantic (only meaningful on a valid shape).
  const diagnostics: Diagnostic[] = [
    ...referentialDiagnostics(spec),
    ...semanticDiagnostics(spec),
  ];

  return { ok: !hasErrors(diagnostics), diagnostics, spec };
}

export type { Diagnostic, ValidationResult, RepairHint, Severity, Tier } from "./types.js";
export { hasErrors, pathToString } from "./types.js";
