/**
 * Tier 3 — REFERENTIAL validation (the "linker").
 *
 * The blueprint is held together by names: permissions point at entities/roles,
 * pages at entities, rules at plans/pages. This tier resolves every reference and
 * flags danglers.
 *
 * Repair philosophy: a reference to something that doesn't exist is simply
 * BROKEN, and the safe, deterministic fix is to remove the broken element (drop
 * the permission, page, relation, widget, or the bad list member / key). This
 * keeps repair free, instant and reproducible — no LLM patch required — and the
 * app stays internally consistent.
 */

import type { AppSpec } from "../contracts/appspec.js";
import { diag, type Diagnostic } from "./types.js";

export function referentialDiagnostics(spec: AppSpec): Diagnostic[] {
  const diags: Diagnostic[] = [];
  const entities = new Set(spec.entities.map((e) => e.name));
  const roles = new Set(spec.roles.map((r) => r.name));
  const plans = new Set(spec.plans.map((p) => p.name));
  const pages = new Set(spec.pages.map((p) => p.name));

  const dropItem = (path: (string | number)[], msg: string): Diagnostic =>
    diag("referential", "MISSING_REF", "error", path, msg, true, { kind: "removeArrayItem" });
  const dropKey = (path: (string | number)[], key: string, msg: string): Diagnostic =>
    diag("referential", "MISSING_REF", "error", path, msg, true, { kind: "removeKey", key });

  // ---- permissions: drop if the entity or role is undefined ----
  spec.permissions.forEach((p, i) => {
    if (!entities.has(p.entity)) {
      diags.push(dropItem(["permissions", i], `Permission references entity '${p.entity}' which is not defined`));
    } else if (!roles.has(p.role)) {
      diags.push(dropItem(["permissions", i], `Permission references role '${p.role}' which is not defined`));
    } else if (p.requiresPlan && !plans.has(p.requiresPlan)) {
      diags.push(dropKey(["permissions", i], "requiresPlan", `Permission requires plan '${p.requiresPlan}' which is not defined`));
    }
  });

  // ---- relation targets: drop the broken relation ----
  spec.entities.forEach((e, ei) => {
    e.relations.forEach((r, ri) => {
      if (!entities.has(r.target)) {
        diags.push(dropItem(["entities", ei, "relations", ri], `Relation '${r.name}' targets entity '${r.target}' which is not defined`));
      }
    });
  });

  // ---- pages ----
  spec.pages.forEach((p, i) => {
    if (p.entity && !entities.has(p.entity)) {
      diags.push(dropItem(["pages", i], `Page '${p.name}' references entity '${p.entity}' which is not defined`));
      return; // dropping the whole page; skip its sub-checks
    }
    if (p.requiresPlan && !plans.has(p.requiresPlan)) {
      diags.push(dropKey(["pages", i], "requiresPlan", `Page '${p.name}' requires plan '${p.requiresPlan}' which is not defined`));
    }
    p.access.forEach((role, ai) => {
      if (!roles.has(role)) diags.push(dropItem(["pages", i, "access", ai], `Page '${p.name}' grants access to undefined role '${role}'`));
    });
    p.widgets.forEach((w, wi) => {
      if (w.entity && !entities.has(w.entity)) {
        diags.push(dropItem(["pages", i, "widgets", wi], `Widget on '${p.name}' references entity '${w.entity}' which is not defined`));
      }
    });
  });

  // ---- business rules ----
  spec.businessRules.forEach((rule, i) => {
    if (rule.type === "plan_gate") {
      if (!plans.has(rule.requiresPlan)) {
        diags.push(dropItem(["businessRules", i], `plan_gate references plan '${rule.requiresPlan}' which is not defined`));
        return;
      }
      rule.gates.pages.forEach((pg, gi) => {
        if (!pages.has(pg)) diags.push(dropItem(["businessRules", i, "gates", "pages", gi], `gate references page '${pg}' which is not defined`));
      });
      rule.gates.entities.forEach((en, gi) => {
        if (!entities.has(en)) diags.push(dropItem(["businessRules", i, "gates", "entities", gi], `gate references entity '${en}' which is not defined`));
      });
    } else if (rule.type === "ownership") {
      if (!entities.has(rule.entity)) {
        diags.push(dropItem(["businessRules", i], `ownership references entity '${rule.entity}' which is not defined`));
      }
    }
  });

  return diags;
}
