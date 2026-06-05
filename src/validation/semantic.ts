/**
 * Tier 4 — SEMANTIC validation (does it make business sense?).
 *
 * These checks catch logically-inconsistent-but-structurally-valid blueprints —
 * the subtle failures that a naive generator ships silently. Many have clean
 * DETERMINISTIC fixes (mark an entity ownable, pick a default role/plan); the
 * rest surface as warnings so the app still compiles while staying honest.
 */

import type { AppSpec } from "../contracts/appspec.js";
import { tableName } from "../compiler/naming.js";
import { diag, type Diagnostic } from "./types.js";

export function semanticDiagnostics(spec: AppSpec): Diagnostic[] {
  const diags: Diagnostic[] = [];
  const entityByName = new Map(spec.entities.map((e) => [e.name, e]));

  // 0. Reserved: the compiler owns the `users` table (accounts/login are
  //    synthesised). An entity that maps to it (e.g. a model-created `User`)
  //    collides at boot, so it must be dropped — its references are then cleaned
  //    up deterministically by the referential tier on the next pass.
  spec.entities.forEach((e, i) => {
    if (tableName(e.name) === "users") {
      diags.push(
        diag(
          "semantic",
          "RESERVED_ENTITY",
          "error",
          ["entities", i],
          `Entity '${e.name}' collides with the built-in users table; accounts are handled automatically`,
          true,
          { kind: "removeArrayItem" },
        ),
      );
    }
  });

  // 1. scope "own" requires the entity to be ownable (so the compiler adds owner_id).
  spec.permissions.forEach((p, i) => {
    const entity = entityByName.get(p.entity);
    if (p.scope === "own" && entity && !entity.ownable) {
      diags.push(
        diag(
          "semantic",
          "SCOPE_OWN_NOT_OWNABLE",
          "error",
          ["permissions", i, "scope"],
          `Permission uses scope 'own' but entity '${p.entity}' is not ownable`,
          true,
          { kind: "markOwnable", entity: p.entity },
        ),
      );
    }
  });

  // 2. Exactly one default role.
  if (spec.roles.length > 0) {
    const defaults = spec.roles.filter((r) => r.isDefault);
    if (defaults.length === 0) {
      diags.push(
        diag("semantic", "NO_DEFAULT_ROLE", "warning", ["roles"], "No default role for new signups", true, {
          kind: "addDefaultRole",
        }),
      );
    } else if (defaults.length > 1) {
      diags.push(
        diag(
          "semantic",
          "MULTIPLE_DEFAULT_ROLES",
          "warning",
          ["roles"],
          `Multiple default roles (${defaults.map((r) => r.name).join(", ")})`,
          true,
          { kind: "dedupeDefaultRole" },
        ),
      );
    }
  }

  // 3. Exactly one default plan (when plans exist).
  if (spec.plans.length > 0 && spec.plans.filter((p) => p.isDefault).length === 0) {
    diags.push(
      diag("semantic", "NO_DEFAULT_PLAN", "warning", ["plans"], "No default plan set", true, {
        kind: "addDefaultPlan",
      }),
    );
  }

  // 4. A paid plan that gates nothing is suspicious (premium tier with no benefit).
  const hasPaid = spec.plans.some((p) => p.price > 0);
  const hasGate = spec.businessRules.some((r) => r.type === "plan_gate");
  if (hasPaid && !hasGate) {
    diags.push(
      diag(
        "semantic",
        "PAID_PLAN_NO_GATE",
        "warning",
        ["plans"],
        "A paid plan exists but no plan_gate rule restricts anything to it",
        false,
      ),
    );
  }

  // 5. Roles that are declared but never used anywhere.
  const usedRoles = new Set<string>([
    ...spec.permissions.map((p) => p.role),
    ...spec.pages.flatMap((p) => p.access),
  ]);
  spec.roles.forEach((r, i) => {
    if (!usedRoles.has(r.name)) {
      diags.push(
        diag("semantic", "UNUSED_ROLE", "warning", ["roles", i], `Role '${r.name}' is never used in permissions or pages`, false),
      );
    }
  });

  // 6. Entities with no permissions at all -> no API/UI access will be generated.
  const permEntities = new Set(spec.permissions.map((p) => p.entity));
  spec.entities.forEach((e, i) => {
    if (!permEntities.has(e.name)) {
      diags.push(
        diag(
          "semantic",
          "ENTITY_NO_PERMISSIONS",
          "warning",
          ["entities", i],
          `Entity '${e.name}' has no permissions; it will be unreachable via the API`,
          false,
        ),
      );
    }
  });

  // 7. Conflict: write access without login is incoherent — you can't enforce who
  //    may create/edit/delete without identifying users. Resolve it by enabling
  //    authentication and documenting the tradeoff. (A purely public, read-only
  //    app with no writes is coherent and is left untouched.)
  const hasRoleWrite = spec.permissions.some(
    (p) => p.scope !== "none" && p.actions.some((a) => a === "create" || a === "update" || a === "delete"),
  );
  if (!spec.auth.requireAuth && hasRoleWrite) {
    diags.push(
      diag(
        "semantic",
        "AUTH_REQUIRED_FOR_WRITES",
        "warning",
        ["auth", "requireAuth"],
        "Role-based write access can't be enforced without login — enabling authentication",
        true,
        { kind: "enableAuth" },
      ),
    );
  }

  return diags;
}
