/**
 * Auth/policy compiler: AppSpec -> AuthPolicy.
 *
 * Produces the flattened (role x entity x action) matrix the runtime enforces,
 * plus per-page access. Also exports the resolver helpers the API and UI
 * compilers share, so all three layers agree on "who can do what".
 */

import type { Action, AppSpec, Page } from "../contracts/appspec.js";
import type { AuthPolicy, PageAccess, PolicyRule } from "../contracts/compiled.js";

/** Roles whose permissions allow `action` on `entity` (scope != none). */
export function rolesForAction(spec: AppSpec, entity: string, action: Action): string[] {
  const roles: string[] = [];
  for (const p of spec.permissions) {
    if (p.entity !== entity) continue;
    if (p.scope === "none") continue;
    if (!p.actions.includes(action)) continue;
    if (!roles.includes(p.role)) roles.push(p.role);
  }
  return roles;
}

/** If a plan_gate rule locks this entity behind a plan, return that plan name. */
export function entityPlanGate(spec: AppSpec, entity: string): string | undefined {
  for (const rule of spec.businessRules) {
    if (rule.type === "plan_gate" && rule.gates.entities.includes(entity)) {
      return rule.requiresPlan;
    }
  }
  return undefined;
}

/** The plan (if any) required to view a page — from the page itself or a plan_gate rule. */
export function pagePlanGate(spec: AppSpec, page: Page): string | undefined {
  if (page.requiresPlan) return page.requiresPlan;
  for (const rule of spec.businessRules) {
    if (rule.type === "plan_gate" && rule.gates.pages.includes(page.name)) {
      return rule.requiresPlan;
    }
  }
  return undefined;
}

export function defaultRole(spec: AppSpec): string {
  return spec.roles.find((r) => r.isDefault)?.name ?? spec.roles[0]?.name ?? "user";
}

export function defaultPlan(spec: AppSpec): string {
  return spec.plans.find((p) => p.isDefault)?.name ?? spec.plans[0]?.name ?? "free";
}

/** The most-privileged role (named "admin", else the one with the most `all`-scope grants). */
export function adminRole(spec: AppSpec): string {
  const named = spec.roles.find((r) => /admin|manager|owner|staff/i.test(r.name));
  if (named) return named.name;
  const score = new Map<string, number>();
  for (const p of spec.permissions) {
    if (p.scope === "all") score.set(p.role, (score.get(p.role) ?? 0) + p.actions.length);
  }
  let best = "";
  let bestScore = -1;
  for (const [role, s] of score) if (s > bestScore) [best, bestScore] = [role, s];
  return best || defaultRole(spec);
}

/** The highest-priced plan (so the seeded admin can see premium features). */
function topPlan(spec: AppSpec): string {
  const paid = [...spec.plans].filter((p) => p.price > 0).sort((a, b) => b.price - a.price);
  return paid[0]?.name ?? defaultPlan(spec);
}

/** Seed ready-to-use logins so the generated app is usable immediately. */
function seededUsers(spec: AppSpec): { email: string; password: string; role: string; plan: string; label: string }[] {
  if (!spec.auth.requireAuth) return [];
  const dRole = defaultRole(spec);
  const aRole = adminRole(spec);
  const users = [{ email: "user@demo.app", password: "user1234", role: dRole, plan: defaultPlan(spec), label: "Member" }];
  if (aRole !== dRole) {
    users.unshift({ email: "admin@demo.app", password: "admin1234", role: aRole, plan: topPlan(spec), label: "Admin" });
  }
  return users;
}

export function compileAuth(spec: AppSpec): AuthPolicy {
  // Flatten permissions into one rule per (role, entity, action), carrying any
  // plan gate that applies to the entity.
  const rules: PolicyRule[] = [];
  for (const p of spec.permissions) {
    const requiresPlan = p.requiresPlan ?? entityPlanGate(spec, p.entity);
    for (const action of p.actions) {
      rules.push({
        role: p.role,
        entity: p.entity,
        action,
        scope: p.scope,
        ...(requiresPlan ? { requiresPlan } : {}),
      });
    }
  }

  const pageAccess: PageAccess[] = spec.pages.map((page) => {
    const requiresPlan = pagePlanGate(spec, page);
    return {
      page: page.name,
      route: page.route,
      roles: page.access,
      ...(requiresPlan ? { requiresPlan } : {}),
    };
  });

  return {
    strategy: spec.auth.strategy,
    requireAuth: spec.auth.requireAuth,
    roles: spec.roles.map((r) => r.name),
    defaultRole: defaultRole(spec),
    plans: spec.plans.map((p) => ({
      name: p.name,
      price: p.price,
      currency: p.currency,
      interval: p.interval,
      isDefault: p.isDefault,
      features: p.features,
    })),
    defaultPlan: defaultPlan(spec),
    rules,
    pageAccess,
    seededUsers: seededUsers(spec),
  };
}
