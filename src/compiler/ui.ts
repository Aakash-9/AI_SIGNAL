/**
 * UI compiler: AppSpec -> UIConfig.
 *
 * Each page is bound to a concrete API endpoint and its columns/fields are
 * resolved from the entity definition. This closes the consistency chain:
 *
 *     UI column ──► API endpoint ──► DB table column
 *
 * Every field shown on screen traces back to a real database column by
 * construction, never by the model's memory.
 */

import type { AppSpec, Entity, Page } from "../contracts/appspec.js";
import type {
  NavItem,
  UIColumn,
  UIConfig,
  UIFormField,
  UIPage,
  UIWidget,
} from "../contracts/compiled.js";
import { humanLabel, tableName } from "./naming.js";
import { pagePlanGate } from "./policy.js";

function findEntity(spec: AppSpec, name?: string): Entity | undefined {
  return name ? spec.entities.find((e) => e.name === name) : undefined;
}

/** Which fields to show: the page's explicit list, or all of the entity's fields. */
function resolveFieldNames(page: Page, entity: Entity | undefined): string[] {
  if (page.fields.length > 0) return page.fields;
  return entity ? entity.fields.map((f) => f.name) : [];
}

function toColumns(entity: Entity | undefined, fieldNames: string[]): UIColumn[] {
  return fieldNames.map((name) => {
    const f = entity?.fields.find((x) => x.name === name);
    return { field: name, label: f?.label ?? humanLabel(name), type: f?.type ?? "string" };
  });
}

function toFormFields(entity: Entity | undefined, fieldNames: string[]): UIFormField[] {
  return fieldNames.map((name) => {
    const f = entity?.fields.find((x) => x.name === name);
    return {
      field: name,
      label: f?.label ?? humanLabel(name),
      type: f?.type ?? "string",
      required: f?.required ?? false,
      ...(f?.type === "enum" && f.enumValues ? { enumValues: f.enumValues } : {}),
    };
  });
}

function toWidgets(spec: AppSpec, page: Page): UIWidget[] {
  return page.widgets.map((w) => {
    const target = w.entity ?? page.entity;
    const dataSource = target ? `/api/${tableName(target)}` : "/api";
    return {
      type: w.type,
      label: w.label,
      ...(w.entity ? { entity: w.entity } : {}),
      ...(w.metric ? { metric: w.metric } : {}),
      ...(w.field ? { field: w.field } : {}),
      dataSource,
    };
  });
}

function compilePage(spec: AppSpec, page: Page): UIPage {
  const entity = findEntity(spec, page.entity);
  const requiresPlan = pagePlanGate(spec, page);
  const table = entity ? tableName(entity.name) : undefined;
  const fieldNames = resolveFieldNames(page, entity);

  const base: UIPage = {
    name: page.name,
    route: page.route,
    type: page.type,
    access: page.access,
    ...(requiresPlan ? { requiresPlan } : {}),
    ...(entity ? { entity: entity.name } : {}),
  };

  switch (page.type) {
    case "list":
      return {
        ...base,
        columns: toColumns(entity, fieldNames),
        ...(table ? { dataSource: `/api/${table}` } : {}),
      };
    case "detail":
      return {
        ...base,
        columns: toColumns(entity, fieldNames),
        ...(table ? { dataSource: `/api/${table}/:id` } : {}),
      };
    case "form":
      return {
        ...base,
        formFields: toFormFields(entity, fieldNames),
        ...(table ? { submitTo: { method: "POST", path: `/api/${table}` } } : {}),
      };
    case "dashboard":
      return { ...base, widgets: toWidgets(spec, page) };
    case "custom":
    default:
      return base;
  }
}

/** Top-level navigation: list, dashboard and custom pages (forms/details are reached in-context). */
function buildNav(spec: AppSpec): NavItem[] {
  return spec.pages
    .filter((p) => p.type === "list" || p.type === "dashboard" || p.type === "custom")
    .map((p) => {
      const requiresPlan = pagePlanGate(spec, p);
      return {
        label: p.name,
        route: p.route,
        roles: p.access,
        ...(requiresPlan ? { requiresPlan } : {}),
      };
    });
}

export function compileUI(spec: AppSpec): UIConfig {
  const nav = buildNav(spec);
  const pages = spec.pages.map((p) => compilePage(spec, p));

  const ui: UIConfig = { appName: spec.meta.name, nav, pages };
  if (spec.meta.theme) ui.theme = spec.meta.theme;

  // If the app has a paid plan, synthesise a Pricing/Upgrade page so the premium
  // tier is actually visible and purchasable (wired to the billing endpoint).
  const hasPaid = spec.plans.some((p) => p.price > 0);
  if (hasPaid) {
    ui.plans = spec.plans.map((p) => ({
      name: p.name,
      price: p.price,
      currency: p.currency,
      interval: p.interval,
      isDefault: p.isDefault,
      features: p.features,
    }));
    ui.subscribeEndpoint = "/api/billing/subscribe";
    pages.push({ name: "Pricing", route: "/pricing", type: "pricing", access: [] });
    nav.push({ label: "Pricing", route: "/pricing", roles: [] });
  }

  return ui;
}
