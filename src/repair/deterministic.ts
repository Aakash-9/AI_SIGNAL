/**
 * Deterministic fixers — the cheap, instant, no-LLM repairs.
 *
 * These handle the bulk of real failures (hallucinated keys, scope/ownership
 * mismatches, default role/plan normalisation, dangling list members) in pure
 * code. Every fix here is reproducible: same input + same diagnostics -> same
 * result, which is what keeps the system deterministic and near-zero-cost.
 *
 * Operates by MUTATING the passed candidate (the caller clones first).
 */

import type { Diagnostic } from "../validation/types.js";
import { getByPath, getParent, type Json } from "./paths.js";

export interface DeterministicResult {
  candidate: Json;
  applied: string[];
}

function toPascalCase(s: string): string {
  const parts = s
    .replace(/[^A-Za-z0-9]+/g, " ") // any separator (spaces, dots, _, -) → word break
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/\s+/)
    .filter(Boolean);
  let out = parts.map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join("").replace(/[^A-Za-z0-9]/g, "");
  // Guarantee a valid identifier (regex requires a leading letter), so the fix
  // always clears the diagnostic and the repair loop converges.
  if (!/^[A-Za-z]/.test(out)) out = "X" + out;
  return out || "Field";
}
function toCamelCase(s: string): string {
  const p = toPascalCase(s);
  return p.charAt(0).toLowerCase() + p.slice(1);
}

export function applyDeterministicFixes(candidate: Json, diagnostics: Diagnostic[]): DeterministicResult {
  const applied: string[] = [];

  // Buckets so we can order operations safely (array removals must go last).
  const removeKeys: { path: (string | number)[]; key: string }[] = [];
  const arrayRemovals: (string | number)[][] = [];
  const caseFixes: { path: (string | number)[]; to: "pascalCase" | "camelCase" }[] = [];
  const markOwnable = new Set<string>();
  let needDefaultRole = false;
  let dedupeRole = false;
  let needDefaultPlan = false;
  let enableAuth = false;

  for (const d of diagnostics) {
    if (!d.fixable || !d.hint) continue;
    switch (d.hint.kind) {
      case "removeKey":
        removeKeys.push({ path: d.path, key: d.hint.key });
        break;
      case "removeArrayItem":
        arrayRemovals.push(d.path);
        break;
      case "pascalCase":
      case "camelCase":
        caseFixes.push({ path: d.path, to: d.hint.kind });
        break;
      case "markOwnable":
        markOwnable.add(d.hint.entity);
        break;
      case "addDefaultRole":
        needDefaultRole = true;
        break;
      case "dedupeDefaultRole":
        dedupeRole = true;
        break;
      case "addDefaultPlan":
        needDefaultPlan = true;
        break;
      case "enableAuth":
        enableAuth = true;
        break;
    }
  }

  // 1. Remove hallucinated keys.
  for (const { path, key } of removeKeys) {
    const obj = getByPath(candidate, path);
    if (obj && typeof obj === "object" && key in obj) {
      delete obj[key];
      applied.push(`removed hallucinated key '${key}' at ${path.join(".") || "(root)"}`);
    }
  }

  // 1b. Normalise identifier casing (entity names/refs to PascalCase, etc.).
  //     For references we snap to an existing entity name when one matches,
  //     so 'teamMember' -> 'TeamMember' lines up with the real entity.
  for (const { path, to } of caseFixes) {
    const loc = getParent(candidate, path);
    if (!loc || typeof loc.parent !== "object" || loc.parent == null) continue;
    const cur = loc.parent[loc.key];
    if (typeof cur !== "string") continue;
    let fixed = to === "pascalCase" ? toPascalCase(cur) : toCamelCase(cur);
    if (to === "pascalCase") {
      const match = (candidate.entities ?? []).find(
        (e: Json) => typeof e?.name === "string" && e.name.toLowerCase() === fixed.toLowerCase(),
      );
      if (match) fixed = match.name;
    }
    if (fixed !== cur) {
      loc.parent[loc.key] = fixed;
      applied.push(`normalised '${cur}' -> '${fixed}' at ${path.join(".")}`);
    }
  }

  // 2. Mark entities ownable (so scope "own" is enforceable).
  for (const name of markOwnable) {
    const entity = (candidate.entities ?? []).find((e: Json) => e?.name === name);
    if (entity) {
      entity.ownable = true;
      applied.push(`marked entity '${name}' as ownable`);
    }
  }

  // 3. Ensure exactly one default role.
  if (Array.isArray(candidate.roles) && candidate.roles.length > 0) {
    if (needDefaultRole && !candidate.roles.some((r: Json) => r?.isDefault)) {
      candidate.roles[0].isDefault = true;
      applied.push(`set default role '${candidate.roles[0].name}'`);
    }
    if (dedupeRole) {
      let seen = false;
      for (const r of candidate.roles) {
        if (r?.isDefault) {
          if (seen) r.isDefault = false;
          else seen = true;
        }
      }
      applied.push("collapsed multiple default roles to one");
    }
  }

  // 3b. Resolve a "no login + role-based writes" conflict by enabling auth,
  //     and record WHY as a documented assumption.
  if (enableAuth) {
    if (!candidate.auth || typeof candidate.auth !== "object") candidate.auth = {};
    if (!candidate.auth.requireAuth) {
      candidate.auth.requireAuth = true;
      if (!candidate.auth.strategy || candidate.auth.strategy === "none") candidate.auth.strategy = "email_password";
      if (!Array.isArray(candidate.assumptions)) candidate.assumptions = [];
      candidate.assumptions.push(
        "Your request asked for 'no login' but also role-based/admin-only editing. Since roles can't be " +
          "enforced without identifying users, authentication was enabled: anyone can sign up as the default role " +
          "to read, while elevated actions require the appropriate role.",
      );
      applied.push("enabled authentication (role-based writes require login)");
    }
  }

  // 4. Ensure exactly one default plan (prefer the free one).
  if (needDefaultPlan && Array.isArray(candidate.plans) && candidate.plans.length > 0) {
    if (!candidate.plans.some((p: Json) => p?.isDefault)) {
      const free = candidate.plans.find((p: Json) => p?.price === 0) ?? candidate.plans[0];
      free.isDefault = true;
      applied.push(`set default plan '${free.name}'`);
    }
  }

  // 5. Drop dangling array members — LAST, grouped by parent, descending index,
  //    so earlier splices don't shift the indices of later ones.
  const byParent = new Map<string, { parentPath: (string | number)[]; indices: number[] }>();
  for (const path of arrayRemovals) {
    const idx = path[path.length - 1];
    if (typeof idx !== "number") continue;
    const parentPath = path.slice(0, -1);
    const key = JSON.stringify(parentPath);
    if (!byParent.has(key)) byParent.set(key, { parentPath, indices: [] });
    byParent.get(key)!.indices.push(idx);
  }
  for (const { parentPath, indices } of byParent.values()) {
    const arr = getByPath(candidate, parentPath);
    if (!Array.isArray(arr)) continue;
    for (const idx of indices.sort((a, b) => b - a)) {
      arr.splice(idx, 1);
      applied.push(`dropped dangling reference at ${parentPath.join(".")}.${idx}`);
    }
  }

  return { candidate, applied };
}
