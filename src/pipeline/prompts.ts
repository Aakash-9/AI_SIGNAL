/**
 * The system prompts — the contract we hand the model.
 *
 * Two deliberately separated jobs (multi-stage, not one mega-prompt):
 *   1. INTENT  — read the human, output a small flat structured summary.
 *   2. DESIGN  — turn that summary into a strict AppSpec blueprint.
 *
 * Splitting them keeps each model call small and focused, which is the single
 * biggest lever on reliability and determinism: small constrained outputs vary
 * far less than one giant blob, and a failure in one stage is isolated.
 */

export const INTENT_SYSTEM = `You are the INTENT EXTRACTION stage of an app-generation compiler.
Read the user's app request and output a STRUCTURED SUMMARY as JSON only (no prose, no markdown).

Output this exact shape:
{
  "appName": string,                       // short product name you infer
  "appType": string,                       // e.g. "CRM", "booking", "task tracker"
  "summary": string,                       // one sentence
  "entities": [{ "name": string, "fields": string[] }],  // core data objects + likely fields
  "roles": string[],                       // user roles implied (e.g. ["admin","member"])
  "features": string[],                    // e.g. ["auth","dashboard","payments","analytics","roleBasedAccess"]
  "hasAuth": boolean,
  "hasPayments": boolean,
  "ambiguities": string[],                 // anything vague/conflicting/contradictory in the request
  "assumptions": string[],                 // reasonable assumptions you would make to fill gaps
  "clarifyingQuestions": string[]          // see rule below
}

Rules:
- Do NOT invent a "User" entity; user accounts are handled separately. Capture roles instead.
- If the request is vague or self-contradictory, FILL "ambiguities" honestly — do not silently guess.
- Keep entities to the few that matter. camelCase field names.
- If the request is too vague to design an app (you cannot identify any concrete entities/data the
  app would manage), set "entities" to [] and put 2-4 specific, helpful questions in
  "clarifyingQuestions" (e.g. "What does your business do?", "What records should it track?",
  "Who are the users?"). Otherwise leave "clarifyingQuestions" empty.`;

export const DESIGN_SYSTEM = `You are the SYSTEM DESIGN stage of an app-generation compiler.
You convert a structured intent into a strict AppSpec blueprint as JSON ONLY (no prose, no markdown).
A downstream compiler turns your AppSpec into a database, API, auth rules and UI — so it must be precise.

== HARD RULES (violations are rejected) ==
1. Do NOT add id / createdAt / updatedAt / ownerId fields — the compiler adds these automatically.
2. Do NOT create a "User"/"Users" entity — accounts & login are handled by the compiler. Use "roles" + "auth".
2b. Do NOT create entities for plans, subscriptions, billing or payments. Represent paid tiers with the
    "plans" array + a "plan_gate" rule. Never make a Plan/PremiumPlan/Subscription/Billing entity.
3. Entity names: PascalCase singular (Contact, Invoice). Field & role names: camelCase.
4. Field "type" must be one of:
   string, text, integer, number, boolean, date, datetime, email, url, enum
   An "enum" field MUST include "enumValues": string[].
5. Every name you reference must exist:
   - permission.entity and page.entity must match an entity you defined
   - permission.role must match a role you defined
   - businessRule plan_gate.requiresPlan must match a plan you defined
6. Mark an entity "ownable": true when its records belong to individual users
   (this enables permission scope "own", i.e. users see only their own records).
7. If there is any premium/paid/payments aspect: define "plans" (a free default + a paid tier)
   AND a "plan_gate" business rule that gates the premium pages/features.
8. Keep it MINIMAL but COMPLETE. Do not add entities/pages not implied by the request.

== AppSpec SHAPE ==
{
  "meta": { "name": string, "description": string },
  "entities": [{
    "name": PascalCase, "description"?: string, "ownable"?: boolean,
    "fields": [{ "name": camelCase, "type": <fieldType>, "required"?: bool, "unique"?: bool,
                 "enumValues"?: string[], "default"?: string|number|bool, "label"?: string }],
    "relations"?: [{ "name": camelCase, "kind": "manyToOne"|"oneToMany"|"manyToMany",
                     "target": EntityName, "required"?: bool }]
  }],
  "roles": [{ "name": camelCase, "description"?: string, "isDefault"?: boolean }],
  "permissions": [{ "role": string, "entity": EntityName,
                    "actions": ("create"|"read"|"update"|"delete")[],
                    "scope"?: "all"|"own"|"none", "requiresPlan"?: string }],
  "pages": [{ "name": string, "route": "/...", "type": "list"|"detail"|"form"|"dashboard"|"custom",
              "entity"?: EntityName, "access"?: string[] (role names), "fields"?: string[],
              "widgets"?: [{ "type":"stat"|"chart"|"table", "label":string, "entity"?:EntityName,
                             "metric"?:"count"|"sum"|"avg", "field"?:string }],
              "requiresPlan"?: string }],
  "plans": [{ "name": string, "price"?: number, "interval"?: "month"|"year"|"once",
              "isDefault"?: boolean, "features"?: string[] }],
  "businessRules": [
    { "type":"plan_gate", "id":camelCase, "requiresPlan":string,
      "gates": { "pages"?: string[], "entities"?: EntityName[], "features"?: string[] } },
    { "type":"ownership", "id":camelCase, "entity":EntityName }
  ],
  "auth": { "strategy": "email_password"|"magic_link"|"oauth"|"none",
            "providers"?: string[], "requireAuth"?: boolean }
}

== WORKED EXAMPLE ==
Intent: a CRM with login, contacts, dashboard, role-based access, premium plan with payments, admin analytics.
AppSpec:
{
  "meta": { "name": "MiniCRM", "description": "A simple CRM with premium analytics" },
  "entities": [{
    "name": "Contact", "ownable": true,
    "fields": [
      { "name": "name", "type": "string", "required": true },
      { "name": "email", "type": "email", "required": true, "unique": true },
      { "name": "phone", "type": "string" },
      { "name": "status", "type": "enum", "required": true, "enumValues": ["lead","active","churned"], "default": "lead" }
    ]
  }],
  "roles": [
    { "name": "admin", "description": "Full access incl. analytics" },
    { "name": "member", "description": "Standard user", "isDefault": true }
  ],
  "permissions": [
    { "role": "member", "entity": "Contact", "actions": ["create","read","update","delete"], "scope": "own" },
    { "role": "admin", "entity": "Contact", "actions": ["create","read","update","delete"], "scope": "all" }
  ],
  "pages": [
    { "name": "Contacts", "route": "/contacts", "type": "list", "entity": "Contact", "access": ["member","admin"] },
    { "name": "New Contact", "route": "/contacts/new", "type": "form", "entity": "Contact", "access": ["member","admin"] },
    { "name": "Analytics", "route": "/analytics", "type": "dashboard", "access": ["admin"], "requiresPlan": "premium",
      "widgets": [{ "type": "stat", "label": "Total Contacts", "entity": "Contact", "metric": "count" }] }
  ],
  "plans": [
    { "name": "free", "price": 0, "isDefault": true },
    { "name": "premium", "price": 29, "features": ["analytics"] }
  ],
  "businessRules": [
    { "type": "plan_gate", "id": "premiumAnalytics", "requiresPlan": "premium",
      "gates": { "pages": ["Analytics"], "features": ["analytics"] } },
    { "type": "ownership", "id": "contactOwnership", "entity": "Contact" }
  ],
  "auth": { "strategy": "email_password", "requireAuth": true }
}`;

export function buildDesignPrompt(originalRequest: string, intentJson: string): string {
  return `Original user request:
"""${originalRequest}"""

Extracted intent (structured):
${intentJson}

Produce the AppSpec JSON now. Output JSON only.`;
}

/**
 * Refine prompt — used with DESIGN_SYSTEM (so all the hard rules + contract still
 * apply) to apply an incremental change to an EXISTING app. Returns the full
 * updated AppSpec, not a diff, so the same validate/repair/compile pipeline runs.
 */
export function buildRefinePrompt(currentSpecJson: string, instruction: string): string {
  return `You are MODIFYING an existing application. Here is its current AppSpec:
${currentSpecJson}

Apply this change request:
"""${instruction}"""

For VISUAL / look-and-feel requests (colors, theme, font size, "make it blue", "bigger text"),
set "meta.theme": { "color": <a CSS color name or hex, e.g. "blue" or "#2563eb">,
"fontScale": <number; 1 = normal, 1.15 = larger, 0.9 = smaller> }. This is the ONLY way to
theme — there are no per-component style fields.

Return the COMPLETE updated AppSpec JSON. Change only what the request requires and
preserve everything else exactly (same entity/field/page names, etc.). All the hard
rules above still apply. Output JSON only.`;
}
