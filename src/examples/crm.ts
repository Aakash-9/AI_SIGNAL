/**
 * The reference CRM, hand-written and parsed once, reused across sanity tests.
 *
 *   "Build a CRM with login, contacts, dashboard, role-based access,
 *    and a premium plan with payments. Admins can see analytics."
 */

import { parseAppSpec, type AppSpecInput } from "../contracts/appspec.js";

const input: AppSpecInput = {
  meta: { name: "MiniCRM", description: "A simple CRM with premium analytics" },
  entities: [
    {
      name: "Contact",
      description: "A customer contact record",
      ownable: true,
      fields: [
        { name: "name", type: "string", required: true },
        { name: "email", type: "email", required: true, unique: true },
        { name: "phone", type: "string" },
        { name: "company", type: "string" },
        { name: "status", type: "enum", required: true, enumValues: ["lead", "active", "churned"], default: "lead" },
      ],
    },
  ],
  roles: [
    { name: "admin", description: "Full access incl. analytics" },
    { name: "member", description: "Standard CRM user", isDefault: true },
  ],
  permissions: [
    { role: "member", entity: "Contact", actions: ["create", "read", "update", "delete"], scope: "own" },
    { role: "admin", entity: "Contact", actions: ["create", "read", "update", "delete"], scope: "all" },
  ],
  pages: [
    { name: "Contacts", route: "/contacts", type: "list", entity: "Contact", access: ["member", "admin"] },
    { name: "New Contact", route: "/contacts/new", type: "form", entity: "Contact", access: ["member", "admin"] },
    {
      name: "Analytics",
      route: "/analytics",
      type: "dashboard",
      access: ["admin"],
      requiresPlan: "premium",
      widgets: [{ type: "stat", label: "Total Contacts", entity: "Contact", metric: "count" }],
    },
  ],
  plans: [
    { name: "free", price: 0, isDefault: true },
    { name: "premium", price: 29, features: ["analytics"] },
  ],
  businessRules: [
    {
      type: "plan_gate",
      id: "premiumAnalytics",
      description: "Analytics dashboard requires the premium plan",
      requiresPlan: "premium",
      gates: { pages: ["Analytics"], features: ["analytics"] },
    },
    { type: "ownership", id: "contactOwnership", entity: "Contact" },
  ],
  auth: { strategy: "email_password", requireAuth: true },
};

export const crmSpec = parseAppSpec(input);
