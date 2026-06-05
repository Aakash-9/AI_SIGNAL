/**
 * Deterministic mock provider — no network, no key, no cost.
 *
 * Purpose: run the whole pipeline offline in tests and CI, and let the eval
 * harness exercise the validation/repair/runtime machinery without burning API
 * quota. It returns fixed, valid-ish structures keyed by stage. It is NOT meant
 * to "understand" the prompt — that's Gemini's job.
 */

import type { GenerateOptions, LLMProvider, LLMResult } from "./types.js";

const MOCK_INTENT = {
  appName: "MockApp",
  appType: "generic",
  summary: "A mock single-entity app used for offline pipeline tests.",
  entities: [{ name: "Item", fields: ["title", "done"] }],
  roles: ["user"],
  features: ["auth"],
  hasAuth: true,
  hasPayments: false,
  ambiguities: [],
  assumptions: ["Mock provider: details are synthetic."],
};

const MOCK_DESIGN = {
  meta: { name: "MockApp", description: "Offline mock app" },
  entities: [
    {
      name: "Item",
      fields: [
        { name: "title", type: "string", required: true },
        { name: "done", type: "boolean", default: false },
      ],
      ownable: true,
    },
  ],
  roles: [{ name: "user", isDefault: true }],
  permissions: [
    { role: "user", entity: "Item", actions: ["create", "read", "update", "delete"], scope: "own" },
  ],
  pages: [
    { name: "Items", route: "/items", type: "list", entity: "Item", access: ["user"] },
    { name: "New Item", route: "/items/new", type: "form", entity: "Item", access: ["user"] },
  ],
  plans: [{ name: "free", price: 0, isDefault: true }],
  businessRules: [{ type: "ownership", id: "itemOwnership", entity: "Item" }],
  auth: { strategy: "email_password", requireAuth: true },
};

export class MockProvider implements LLMProvider {
  readonly name = "mock";

  async generateJSON(opts: GenerateOptions): Promise<LLMResult> {
    const data = opts.stage === "intent" ? MOCK_INTENT : MOCK_DESIGN;
    return {
      data,
      raw: JSON.stringify(data),
      usage: { inputTokens: 0, outputTokens: 0 },
      model: "mock",
      latencyMs: 0,
    };
  }
}
