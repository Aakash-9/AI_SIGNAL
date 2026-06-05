/**
 * ============================================================================
 *  AppSpec — THE CENTRAL BLUEPRINT (the compiler's Intermediate Representation)
 * ============================================================================
 *
 *  This is the single source of truth for a generated application.
 *
 *  The LLM's ONLY job is to produce a valid AppSpec from a user's sentence.
 *  It never writes the database, API, screens, or permissions directly.
 *  Instead, our deterministic compiler (Phase 1) *derives* all four of those
 *  layers FROM this one object — which is why they can never disagree with
 *  each other (the "contacts" page maps to the "contacts" table because our
 *  code wired it, not because the model remembered to).
 *
 *  Design principles baked into this schema:
 *   1. SMALL SURFACE FOR THE LLM. We only ask the model for *business* fields.
 *      Boilerplate columns (id, createdAt, updatedAt, ownerId) are added later
 *      by the compiler, never by the model. Less to hallucinate = more reliable.
 *   2. EVERYTHING IS REFERENCED BY NAME. permissions.entity, pages.entity,
 *      rules.requiresPlan ... all point at names defined elsewhere in this spec.
 *      That turns cross-layer consistency into a symbol-resolution problem the
 *      validation engine (Phase 3) can check like a compiler's linker.
 *   3. STRICT BY DEFAULT. `.strict()` rejects unknown keys, so a hallucinated
 *      field is a structural error we catch immediately instead of a silent bug.
 *
 *  Zod gives us three things from this one definition: the runtime validator,
 *  the TypeScript types (via z.infer), and a JSON Schema we feed to the model
 *  for constrained decoding (Phase 2).
 * ============================================================================
 */

import { z } from "zod";

/* ----------------------------------------------------------------------------
 * Identifiers
 * Entities are PascalCase singular nouns (Contact, User, Invoice).
 * Fields/roles/etc. are camelCase. Enforcing this here means the compiler can
 * derive table names, foreign keys, and routes deterministically.
 * -------------------------------------------------------------------------- */
export const EntityName = z
  .string()
  .regex(/^[A-Z][A-Za-z0-9]*$/, "Entity name must be PascalCase (e.g. Contact)");

export const Identifier = z
  .string()
  .regex(/^[a-z][A-Za-z0-9]*$/, "Must be camelCase (e.g. firstName)");

/* ----------------------------------------------------------------------------
 * Fields — the columns of an entity (business fields only).
 * -------------------------------------------------------------------------- */
export const FieldType = z.enum([
  "string", // short text
  "text", // long text
  "integer",
  "number", // float / decimal
  "boolean",
  "date",
  "datetime",
  "email",
  "url",
  "enum", // requires enumValues
]);
export type FieldType = z.infer<typeof FieldType>;

export const FieldValidation = z
  .object({
    min: z.number().optional(), // for number/integer
    max: z.number().optional(),
    minLength: z.number().int().optional(), // for string/text
    maxLength: z.number().int().optional(),
    pattern: z.string().optional(), // regex source
  })
  .strict();

export const Field = z
  .object({
    name: Identifier,
    type: FieldType,
    required: z.boolean().default(false),
    unique: z.boolean().default(false),
    /** Only meaningful when type === "enum". */
    enumValues: z.array(z.string()).optional(),
    /** Literal default value, if any. */
    default: z.union([z.string(), z.number(), z.boolean()]).optional(),
    validation: FieldValidation.optional(),
    /** Human-friendly label for the UI; compiler falls back to the field name. */
    label: z.string().optional(),
  })
  .strict()
  // An enum field is meaningless without its allowed values.
  .refine((f) => f.type !== "enum" || (f.enumValues?.length ?? 0) > 0, {
    message: "enum fields must declare a non-empty enumValues array",
    path: ["enumValues"],
  });
export type Field = z.infer<typeof Field>;

/* ----------------------------------------------------------------------------
 * Relations — how entities connect.
 *   manyToOne  : THIS entity holds a foreign key to `target`
 *                (e.g. Contact.manyToOne(User) => Contact.ownerId).
 *   manyToMany : a join table is generated between the two entities.
 *   oneToMany  : the inverse of a manyToOne; the compiler derives it, the LLM
 *                only needs to state the manyToOne side. Listed here for specs
 *                that want to be explicit.
 * -------------------------------------------------------------------------- */
export const RelationKind = z.enum(["manyToOne", "oneToMany", "manyToMany"]);

export const Relation = z
  .object({
    /** Name of this relation as seen from the current entity (e.g. "owner"). */
    name: Identifier,
    kind: RelationKind,
    /** The entity on the other side of the relation. */
    target: EntityName,
    required: z.boolean().default(false),
  })
  .strict();
export type Relation = z.infer<typeof Relation>;

export const Entity = z
  .object({
    name: EntityName,
    description: z.string().optional(),
    fields: z.array(Field).default([]),
    relations: z.array(Relation).default([]),
    /**
     * If true, the compiler adds an ownerId column + ownership-aware policies,
     * enabling "users can only see their own records" (scope: "own").
     */
    ownable: z.boolean().default(false),
  })
  .strict();
export type Entity = z.infer<typeof Entity>;

/* ----------------------------------------------------------------------------
 * Roles & Permissions — the auth model.
 * Permissions form a matrix: (role x entity) -> which actions, over which rows.
 * -------------------------------------------------------------------------- */
export const Role = z
  .object({
    name: Identifier, // e.g. "admin", "member"
    description: z.string().optional(),
    /** The role assigned to a brand-new signup. Exactly one should be default. */
    isDefault: z.boolean().default(false),
  })
  .strict();
export type Role = z.infer<typeof Role>;

export const Action = z.enum(["create", "read", "update", "delete"]);
export type Action = z.infer<typeof Action>;

export const Permission = z
  .object({
    role: Identifier, // must match a Role.name
    entity: EntityName, // must match an Entity.name
    actions: z.array(Action).min(1),
    /**
     * Row scope:
     *   "all"  -> every row of the entity
     *   "own"  -> only rows the user owns (requires entity.ownable)
     *   "none" -> explicitly denied (useful to override a broader grant)
     */
    scope: z.enum(["all", "own", "none"]).default("all"),
    /** Optional plan gate: this permission only applies if the user is on `requiresPlan`. */
    requiresPlan: z.string().optional(),
  })
  .strict();
export type Permission = z.infer<typeof Permission>;

/* ----------------------------------------------------------------------------
 * Pages — the UI layer, described declaratively so the runtime can render it.
 * -------------------------------------------------------------------------- */
export const Widget = z
  .object({
    type: z.enum(["stat", "chart", "table"]),
    label: z.string(),
    entity: EntityName.optional(), // which entity the widget summarizes
    metric: z.enum(["count", "sum", "avg"]).optional(),
    field: Identifier.optional(), // field to aggregate for sum/avg
  })
  .strict();

export const PageType = z.enum([
  "list", // a table of records for one entity
  "detail", // a single record view
  "form", // create/edit a record
  "dashboard", // widgets / analytics
  "custom", // free-form (rare; runtime renders a placeholder)
]);

export const Page = z
  .object({
    name: z.string(),
    route: z.string().regex(/^\//, "route must start with '/'"),
    type: PageType,
    /** The entity this page is bound to (omit for dashboard/custom). */
    entity: EntityName.optional(),
    /** Roles allowed to view this page. Empty = all authenticated users. */
    access: z.array(Identifier).default([]),
    /** For list/detail/form pages: which fields to show. Empty = all. */
    fields: z.array(Identifier).default([]),
    /** For dashboard pages: the widgets to render. */
    widgets: z.array(Widget).default([]),
    /** Optional plan gate on the whole page. */
    requiresPlan: z.string().optional(),
  })
  .strict();
export type Page = z.infer<typeof Page>;

/* ----------------------------------------------------------------------------
 * Business rules — the logic that isn't pure CRUD.
 * Modelled as a discriminated union so each rule type stays type-safe and the
 * compiler/runtime can handle each kind explicitly.
 * -------------------------------------------------------------------------- */
export const PlanGateRule = z
  .object({
    type: z.literal("plan_gate"),
    id: Identifier,
    description: z.string().optional(),
    requiresPlan: z.string(), // must match a Plan.name
    gates: z
      .object({
        pages: z.array(z.string()).default([]), // page names locked behind the plan
        entities: z.array(EntityName).default([]), // entities locked behind the plan
        features: z.array(z.string()).default([]), // named feature keys
      })
      .strict(),
  })
  .strict();

export const OwnershipRule = z
  .object({
    type: z.literal("ownership"),
    id: Identifier,
    description: z.string().optional(),
    entity: EntityName, // records of this entity are scoped to their creator
  })
  .strict();

export const BusinessRule = z.discriminatedUnion("type", [
  PlanGateRule,
  OwnershipRule,
]);
export type BusinessRule = z.infer<typeof BusinessRule>;

/* ----------------------------------------------------------------------------
 * Plans — subscription tiers (drives premium gating + payments).
 * -------------------------------------------------------------------------- */
export const Plan = z
  .object({
    name: z.string(), // e.g. "free", "premium"
    price: z.number().nonnegative().default(0),
    currency: z.string().default("usd"),
    interval: z.enum(["month", "year", "once"]).default("month"),
    isDefault: z.boolean().default(false),
    features: z.array(z.string()).default([]),
  })
  .strict();
export type Plan = z.infer<typeof Plan>;

/* ----------------------------------------------------------------------------
 * Auth configuration.
 * -------------------------------------------------------------------------- */
export const Auth = z
  .object({
    strategy: z.enum(["email_password", "magic_link", "oauth", "none"]).default(
      "email_password",
    ),
    providers: z.array(z.string()).default([]), // e.g. ["google"] for oauth
    requireAuth: z.boolean().default(true),
  })
  .strict();
export type Auth = z.infer<typeof Auth>;

/* ----------------------------------------------------------------------------
 * AppSpec — the root blueprint.
 * -------------------------------------------------------------------------- */
export const AppSpec = z
  .object({
    meta: z
      .object({
        name: z.string(),
        description: z.string().optional(),
        version: z.string().default("1.0.0"),
        /** Optional visual theming — set/changed via the Refine feature. */
        theme: z
          .object({
            color: z.string().optional(), // a CSS color name or hex, e.g. "blue" / "#2563eb"
            fontScale: z.number().optional(), // 1 = normal, 1.15 = larger, 0.9 = smaller
          })
          .strict()
          .optional(),
      })
      .strict(),
    entities: z.array(Entity).default([]),
    roles: z.array(Role).default([]),
    permissions: z.array(Permission).default([]),
    pages: z.array(Page).default([]),
    businessRules: z.array(BusinessRule).default([]),
    plans: z.array(Plan).default([]),
    auth: Auth.default({}),
    /**
     * The "assumptions ledger" — every reasonable default the system filled in
     * for an underspecified prompt is recorded here and surfaced to the user.
     * (Populated by the pipeline, not the model.)
     */
    assumptions: z.array(z.string()).default([]),
  })
  .strict();

/**
 * `AppSpec` is the OUTPUT type: every default has been applied, so the compiler
 * downstream can rely on every field being present.
 */
export type AppSpec = z.infer<typeof AppSpec>;

/**
 * `AppSpecInput` is the INPUT type: defaults may be omitted. This is the shape
 * the LLM produces and the shape we hand to `parseAppSpec`. Parsing turns an
 * AppSpecInput into a fully-populated AppSpec.
 */
export type AppSpecInput = z.input<typeof AppSpec>;

/**
 * Parse + validate an unknown value into a typed AppSpec.
 * Throws a ZodError (rich, path-aware) on failure — the validation engine
 * (Phase 3) turns those into our typed diagnostics for the repair engine.
 */
export function parseAppSpec(input: unknown): AppSpec {
  return AppSpec.parse(input);
}

/** Non-throwing variant: returns Zod's discriminated result. */
export function safeParseAppSpec(input: unknown) {
  return AppSpec.safeParse(input);
}
