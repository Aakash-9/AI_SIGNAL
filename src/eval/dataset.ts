/**
 * The evaluation dataset — 10 real product prompts + 10 edge cases.
 *
 * The edge cases deliberately stress the failure-handling system: vague,
 * conflicting, incomplete, contradictory, overloaded, and non-app inputs. Each
 * case declares how it SHOULD be handled so the harness can score "graceful
 * handling", not just "did it build something".
 */

export type EvalCategory = "real" | "edge";

/** How we expect a case to resolve, for scoring. */
export type ExpectedOutcome =
  | "working" // should produce a usable, executable app
  | "clarification" // too vague — should ask, not guess
  | "handled"; // edge case — either a documented working app OR a clarification is fine

export interface EvalCase {
  id: string;
  category: EvalCategory;
  prompt: string;
  expect: ExpectedOutcome;
  note?: string;
}

export const DATASET: EvalCase[] = [
  /* ----------------------------- 10 real ----------------------------- */
  {
    id: "real-crm",
    category: "real",
    prompt:
      "Build a CRM with login, contacts, dashboard, role-based access, and a premium plan with payments. Admins can see analytics.",
    expect: "working",
  },
  {
    id: "real-salon",
    category: "real",
    prompt:
      "Booking app for a hair salon: customers book appointments with stylists for services; staff manage the schedule; premium unlocks SMS reminders.",
    expect: "working",
  },
  {
    id: "real-pm",
    category: "real",
    prompt:
      "Project management tool with projects, tasks, comments, team members, and a premium tier that unlocks time tracking. Managers see analytics.",
    expect: "working",
  },
  {
    id: "real-ecommerce",
    category: "real",
    prompt:
      "An online store where customers browse products, place orders, and track them; admins manage the product catalog and see sales. Premium sellers get featured listings.",
    expect: "working",
  },
  {
    id: "real-helpdesk",
    category: "real",
    prompt:
      "A customer support helpdesk where users submit tickets with a priority, agents respond and change status, and managers view ticket analytics. Premium gives SLA tracking.",
    expect: "working",
  },
  {
    id: "real-inventory",
    category: "real",
    prompt:
      "Inventory management for a warehouse: track products, suppliers, and stock levels; staff record stock movements; admins manage suppliers and see low-stock reports.",
    expect: "working",
  },
  {
    id: "real-events",
    category: "real",
    prompt:
      "An event booking platform where organizers create events and attendees reserve tickets. Organizers see attendee lists; a premium plan unlocks featured event placement.",
    expect: "working",
  },
  {
    id: "real-fitness",
    category: "real",
    prompt:
      "A fitness tracking app where users log workouts and exercises, view their history, and premium members unlock progress analytics and charts.",
    expect: "working",
  },
  {
    id: "real-recipes",
    category: "real",
    prompt:
      "A recipe sharing app where users post recipes with ingredients and steps, comment on others' recipes, and premium users unlock weekly meal planning.",
    expect: "working",
  },
  {
    id: "real-realestate",
    category: "real",
    prompt:
      "A real estate listings site where agents post properties and buyers send inquiries. Agents manage their own listings; admins moderate all; premium agents get featured listings.",
    expect: "working",
  },

  /* ----------------------------- 10 edge ----------------------------- */
  {
    id: "edge-vague",
    category: "edge",
    prompt: "I need an app for my business",
    expect: "clarification",
    note: "Too vague — no concrete entities.",
  },
  {
    id: "edge-conflict-auth",
    category: "edge",
    prompt:
      "A public notes app with no login, but only admins can edit and there are role-based permissions.",
    expect: "handled",
    note: "Conflict: no login vs role-based write access. Should resolve + document.",
  },
  {
    id: "edge-terse",
    category: "edge",
    prompt: "todo app",
    expect: "handled",
    note: "Extremely terse but buildable with assumptions.",
  },
  {
    id: "edge-incomplete",
    category: "edge",
    prompt: "build something with users and stuff",
    expect: "clarification",
    note: "Underspecified — no real domain.",
  },
  {
    id: "edge-contradictory-plan",
    category: "edge",
    prompt:
      "A totally free app where premium subscribers pay nothing but still unlock exclusive paid-only features.",
    expect: "handled",
    note: "Contradictory pricing — should resolve to a sensible plan model.",
  },
  {
    id: "edge-overloaded",
    category: "edge",
    prompt:
      "Build everything in one app: a social network, a marketplace, online banking, ride-sharing, video streaming, and a dating service.",
    expect: "handled",
    note: "Massively overloaded — should still produce a coherent (if reduced) app.",
  },
  {
    id: "edge-nonapp",
    category: "edge",
    prompt: "what is the weather in Tokyo today?",
    expect: "clarification",
    note: "Not an app-build request at all.",
  },
  {
    id: "edge-ambiguous-roles",
    category: "edge",
    prompt: "An app where every user is an admin but also just a normal user at the same time.",
    expect: "handled",
    note: "Ambiguous role model — should resolve sensibly.",
  },
  {
    id: "edge-private-public",
    category: "edge",
    prompt:
      "A private app that anyone can use without creating an account, but each person sees their own personalized private data.",
    expect: "handled",
    note: "Contradiction: anonymous access vs per-user private data.",
  },
  {
    id: "edge-onefield",
    category: "edge",
    prompt: "a dashboard",
    expect: "clarification",
    note: "A dashboard of what? No underlying data defined.",
  },
];
