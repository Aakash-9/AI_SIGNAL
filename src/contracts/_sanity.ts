/**
 * Sanity check for the AppSpec contract — runs with ZERO AI.
 *
 * We hand-write the blueprint for the task's reference prompt:
 *   "Build a CRM with login, contacts, dashboard, role-based access,
 *    and a premium plan with payments. Admins can see analytics."
 *
 * If this parses cleanly, our contract can faithfully represent a real,
 * non-trivial app — the foundation everything else compiles from.
 *
 * Run:  npm run test:contracts
 */

import { safeParseAppSpec, type AppSpecInput } from "./appspec";

const crm: AppSpecInput = {
  meta: { name: "MiniCRM", description: "A simple CRM with premium analytics", version: "1.0.0" },

  entities: [
    {
      name: "Contact",
      description: "A customer contact record",
      ownable: true, // each member sees their own contacts
      fields: [
        { name: "name", type: "string", required: true },
        { name: "email", type: "email", required: true, unique: true },
        { name: "phone", type: "string", required: false },
        { name: "company", type: "string", required: false },
        {
          name: "status",
          type: "enum",
          required: true,
          enumValues: ["lead", "active", "churned"],
          default: "lead",
        },
      ],
      relations: [],
    },
  ],

  roles: [
    { name: "admin", description: "Full access incl. analytics", isDefault: false },
    { name: "member", description: "Standard CRM user", isDefault: true },
  ],

  permissions: [
    { role: "member", entity: "Contact", actions: ["create", "read", "update", "delete"], scope: "own" },
    { role: "admin", entity: "Contact", actions: ["create", "read", "update", "delete"], scope: "all" },
  ],

  pages: [
    { name: "Contacts", route: "/contacts", type: "list", entity: "Contact", access: ["member", "admin"], fields: [], widgets: [] },
    { name: "New Contact", route: "/contacts/new", type: "form", entity: "Contact", access: ["member", "admin"], fields: [], widgets: [] },
    {
      name: "Analytics",
      route: "/analytics",
      type: "dashboard",
      access: ["admin"], // admins only, per the prompt
      requiresPlan: "premium", // and gated behind the premium plan
      fields: [],
      widgets: [
        { type: "stat", label: "Total Contacts", entity: "Contact", metric: "count" },
      ],
    },
  ],

  plans: [
    { name: "free", price: 0, currency: "usd", interval: "month", isDefault: true, features: [] },
    { name: "premium", price: 29, currency: "usd", interval: "month", isDefault: false, features: ["analytics"] },
  ],

  businessRules: [
    {
      type: "plan_gate",
      id: "premiumAnalytics",
      description: "Analytics dashboard requires the premium plan",
      requiresPlan: "premium",
      gates: { pages: ["Analytics"], entities: [], features: ["analytics"] },
    },
    { type: "ownership", id: "contactOwnership", entity: "Contact" },
  ],

  auth: { strategy: "email_password", providers: [], requireAuth: true },
  assumptions: [],
};

const result = safeParseAppSpec(crm);

if (!result.success) {
  console.error("❌ AppSpec contract FAILED to validate the hand-written CRM:\n");
  console.error(JSON.stringify(result.error.format(), null, 2));
  process.exit(1);
}

const spec = result.data;
console.log("✅ AppSpec contract validated the hand-written CRM blueprint.\n");
console.log(`   App:         ${spec.meta.name} — ${spec.meta.description}`);
console.log(`   Entities:    ${spec.entities.map((e) => e.name).join(", ")}`);
console.log(`   Roles:       ${spec.roles.map((r) => r.name).join(", ")}`);
console.log(`   Pages:       ${spec.pages.map((p) => `${p.name}(${p.route})`).join(", ")}`);
console.log(`   Plans:       ${spec.plans.map((p) => `${p.name}=$${p.price}`).join(", ")}`);
console.log(`   Rules:       ${spec.businessRules.map((r) => r.type + ":" + r.id).join(", ")}`);
console.log("\n   Note: id/createdAt/updatedAt/ownerId are intentionally absent —");
console.log("   the compiler (Phase 1) adds those, not the model.");
