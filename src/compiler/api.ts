/**
 * API compiler: AppSpec -> APISchema.
 *
 * For each entity we emit CRUD endpoints, but ONLY for actions that at least one
 * role is permitted to perform — so the API surface honours the permission model
 * instead of blindly exposing everything.
 *
 * Request bodies for create/update are derived directly from the entity's fields
 * (plus manyToOne relations as `<name>Id`). That's the cross-layer guarantee:
 * the API literally cannot accept a field the database doesn't have.
 */

import type { Action, AppSpec, Entity } from "../contracts/appspec.js";
import type { APIEndpoint, APISchema, ApiField } from "../contracts/compiled.js";
import { tableName } from "./naming.js";
import { entityPlanGate, rolesForAction } from "./policy.js";

/** Body fields for create/update, derived from the entity. */
function requestFields(entity: Entity, partial: boolean): ApiField[] {
  const fields: ApiField[] = entity.fields.map((f) => ({
    name: f.name,
    type: f.type,
    // A field is only required on create if it has no default to fall back on
    // (an update is always partial). Avoids demanding e.g. a "status" that
    // already defaults to "booked".
    required: partial ? false : f.required && f.default === undefined,
  }));

  // manyToOne relations are accepted as "<relationName>Id" references.
  for (const rel of entity.relations) {
    if (rel.kind === "manyToOne") {
      fields.push({
        name: `${rel.name}Id`,
        type: "string",
        required: partial ? false : rel.required,
      });
    }
  }
  return fields;
}

function authEndpoints(spec: AppSpec): APIEndpoint[] {
  if (spec.auth.strategy === "none" || !spec.auth.requireAuth) return [];
  const endpoints: APIEndpoint[] = [
    {
      method: "POST",
      path: "/api/auth/signup",
      operation: "signup",
      auth: { required: false, roles: [], scope: "all" },
      requestFields: [
        { name: "email", type: "email", required: true },
        { name: "password", type: "string", required: true },
      ],
    },
    {
      method: "POST",
      path: "/api/auth/login",
      operation: "login",
      auth: { required: false, roles: [], scope: "all" },
      requestFields: [
        { name: "email", type: "email", required: true },
        { name: "password", type: "string", required: true },
      ],
    },
    {
      method: "GET",
      path: "/api/auth/me",
      operation: "me",
      auth: { required: true, roles: [], scope: "all" },
    },
  ];
  return endpoints;
}

function billingEndpoints(spec: AppSpec): APIEndpoint[] {
  const hasPaidPlan = spec.plans.some((p) => p.price > 0);
  if (!hasPaidPlan) return [];
  return [
    {
      method: "POST",
      path: "/api/billing/subscribe",
      operation: "subscribe",
      auth: { required: true, roles: [], scope: "all" },
      requestFields: [{ name: "plan", type: "string", required: true }],
    },
  ];
}

function crudEndpoints(spec: AppSpec, entity: Entity): APIEndpoint[] {
  const table = tableName(entity.name);
  const requiresPlan = entityPlanGate(spec, entity.name);
  const endpoints: APIEndpoint[] = [];

  // Helper to build the per-endpoint auth block from the permission matrix.
  const authFor = (action: Action) => {
    const roles = rolesForAction(spec, entity.name, action);
    // If any permitted role uses "own" scope, hint the runtime to scope rows.
    const scoped = spec.permissions.some(
      (p) => p.entity === entity.name && p.actions.includes(action) && p.scope === "own",
    );
    return {
      required: spec.auth.requireAuth,
      roles,
      scope: (scoped ? "own" : "all") as "own" | "all",
      ...(requiresPlan ? { requiresPlan } : {}),
    };
  };

  // Only emit an endpoint when at least one role can perform the action.
  const can = (action: Action) => rolesForAction(spec, entity.name, action).length > 0;

  if (can("read")) {
    endpoints.push({ method: "GET", path: `/api/${table}`, operation: "list", entity: entity.name, auth: authFor("read") });
    endpoints.push({ method: "GET", path: `/api/${table}/:id`, operation: "get", entity: entity.name, auth: authFor("read") });
  }
  if (can("create")) {
    endpoints.push({
      method: "POST",
      path: `/api/${table}`,
      operation: "create",
      entity: entity.name,
      auth: authFor("create"),
      requestFields: requestFields(entity, false),
    });
  }
  if (can("update")) {
    endpoints.push({
      method: "PATCH",
      path: `/api/${table}/:id`,
      operation: "update",
      entity: entity.name,
      auth: authFor("update"),
      requestFields: requestFields(entity, true),
    });
  }
  if (can("delete")) {
    endpoints.push({ method: "DELETE", path: `/api/${table}/:id`, operation: "delete", entity: entity.name, auth: authFor("delete") });
  }

  return endpoints;
}

export function compileAPI(spec: AppSpec): APISchema {
  const endpoints: APIEndpoint[] = [
    ...authEndpoints(spec),
    ...billingEndpoints(spec),
  ];
  for (const entity of spec.entities) {
    endpoints.push(...crudEndpoints(spec, entity));
  }
  return { endpoints };
}
