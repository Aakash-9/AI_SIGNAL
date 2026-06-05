# NL → App Compiler

**Turn a sentence into a working, executable application** — database, API, auth, UI — through a
compiler-style pipeline with validation, self-repair, and an execution runtime.

> **A compiler, not a prompt.** The LLM does only the small, fuzzy job — read the human and produce a
> tiny canonical **IR**. Our deterministic **code** derives the database, API, auth and UI from that
> one object, so the four layers *cannot* drift, and most errors are repaired **without ever calling
> the model again** (0 LLM-repair calls across a 20-prompt evaluation).

Reference inspiration: [base44](https://base44.com) (describe-an-app → full-stack app).

---

## What it does

```
 natural language ─► IR ─► validate + repair ─► compile (DB/API/Auth/UI) ─► boot & run ─► a live app
```

From one sentence you get:
1. A strict **JSON config** (Blueprint + Database + API + Auth + UI).
2. An **execution proof** — the config boots a real SQLite database and passes smoke tests
   (signup, CRUD, a real `403` for cross-user access, premium gating).
3. A **clickable, running app** at its own URL (log in with seeded accounts, do real CRUD).
4. **Iterative refinement** — change requirements in plain English (*"add a Category entity"*,
   *"make the theme blue"*) and it re-validates, repairs and re-tests.

---

## Quick start

```bash
npm install
cp .env.example .env            # then add a free Gemini key from https://aistudio.google.com/apikey
npm run serve                   # demo UI at http://localhost:4321
```

### Runnable proofs (the system ships with its own evidence — no LLM/quota needed)
```bash
npm run criteria        # proves the 5 grading criteria with hard numbers
npm run eval            # runs the 20-prompt dataset -> eval-report.md
npm run test:contracts  # the IR contract
npm run test:compiler   # IR -> 4 layers + cross-layer consistency assertion
npm run test:validation # the 4 validation tiers
npm run test:repair     # deterministic + scoped-LLM repair
npm run test:runtime    # boots a real DB, enforces auth/ownership/gating
```

---

## Architecture

See **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)** for full diagrams. The core idea:

```
                          NATURAL LANGUAGE PROMPT
                                   │
   ┌────────────  🧠 LLM stages (the only non-deterministic part)  ───────────┐
   │   1. Intent Extraction ─► IntentIR     (or ❓ clarify if too vague)       │
   │   2. System Design     ─► raw AppSpec                                     │
   └───────────────────────────────┬─────────────────────────────────────────┘
                                    ▼
   ┌────────────  🛡️ Validation + Repair loop (the reliability core)  ─────────┐
   │   3. Validate (structural · referential · semantic)  ──typed diagnostics──►│
   │   4. Repair  (deterministic fixers first, scoped LLM patch only if needed) │
   └───────────────────────────────┬─────────────────────────────────────────┘
                                    ▼  valid AppSpec = THE IR
   ┌────────────  ⚙️ Deterministic compiler (NO LLM)  ────────────────────────┐
   │   compile(IR) ─► DB schema · API schema · Auth policy · UI config         │
   └───────────────────────────────┬─────────────────────────────────────────┘
                                    ▼
   ┌────────────  ✅ Runtime — execution proof  ──────────────────────────────┐
   │   boot real SQLite + smoke tests (signup · CRUD · 403 ownership · gating) │
   └──────────────────────────────────────────────────────────────────────────┘
```

Everything in the IR references everything else **by name**, so cross-layer consistency is a
symbol-table problem the validator resolves like a linker — guaranteed *by construction*.

---

## How it scores on the evaluation criteria

| Criterion | Edge (run `npm run criteria` to verify) |
| --- | --- |
| **System Thinking** | One IR → 4 layers derived in code. `10/10` UI fields provably trace to real DB columns. |
| **Control over LLMs** | `200` compiles → `1` identical hash. Strict contract rejects `5/5` hallucination classes. |
| **Reliability** | `generateApp` never throws; 7 garbage inputs → 0 crashes; surgical, converging repair. |
| **Execution Awareness** | Boots a real DB; proves a real `403` + premium gating; **runs the app**, not just emits JSON. |
| **Depth** | Deterministic-first repair → `0` LLM-repair calls; `$0.09` for 20 apps; honest 19/20 eval. |

---

## Evaluation results (`eval-report.md`)

Dataset: **20 prompts** (10 real products + 10 edge cases: vague, conflicting, contradictory, overloaded, non-app).

| Metric | Value |
| --- | --- |
| Pipeline success (prompts that reached the LLM) | **95% (19/20)** |
| Real prompts → working app | **100% (10/10)** |
| Edge cases → handled (no crash) | **100%** |
| Execution proof (avg smoke pass, working apps) | **100%** |
| Scoped LLM patches needed | **0%** — every repair deterministic |
| Crashes / hard failures | **0** |
| Cost (20 apps, gemini-2.5-flash rates) | **~$0.09** |

> The single non-match (`edge-nonapp`: *"what's the weather in Tokyo?"*) built a working weather app
> instead of asking — a defensible judgment call, scored honestly. We did **not** game it to 20/20.

---

## Reliability & control features

- **Strict Zod contract** — rejects hallucinated/unknown keys, wrong types, bad enums.
- **Typed error channel** → **deterministic fixers** (casing, dangling refs, reserved-entity collisions,
  ownership/auth conflicts) + **scoped LLM patch** (one fragment, not the whole app), bounded + converging.
- **Response cache** (record/replay) — repeat prompts are instant and free; the deployed demo serves
  examples with zero API calls.
- **Provider resilience** — rate-limit-hint–aware retries + automatic model fallback; provider
  abstraction (Gemini / Groq / offline mock).
- **Failure handling** — too-vague → asks clarifying questions; minor gaps → documents assumptions;
  conflicts → resolves with a stated rationale.

---

## Deploy (Azure App Service)

It's a single zero-dependency Node server (UI + API together), so it's one deploy:

1. VS Code → install the **Azure App Service** extension → sign in.
2. **Create Web App** (Linux, **Node 22 LTS**, B1) → **Deploy** the project folder.
3. App settings: `GEMINI_API_KEY`, `LLM_PROVIDER=gemini`, `GEMINI_MODEL=gemini-2.5-flash-lite`,
   `LLM_CACHE_MODE=rw`, `SCM_DO_BUILD_DURING_DEPLOYMENT=true`.
4. Startup command: `npm start`.

The server reads `process.env.PORT` (set by Azure) and uses Node's built-in SQLite
(hence Node ≥ 22 + the `--experimental-sqlite` flag, already in the `start` script).

---

## Tech stack

| Concern | Choice | Why |
| --- | --- | --- |
| Language | TypeScript (strict) | one source → contract + types |
| Contract / IR | **Zod** | runtime validation + inferred types + strict (rejects hallucinations) |
| LLM | Gemini (Groq / mock pluggable) | free tier; provider abstraction |
| Runtime DB | **node:sqlite** | zero-dependency execution proof |
| Web | **node:http** | deploys anywhere, no framework |

---

## Project structure

```
src/
  contracts/   the IR (AppSpec) + the 4 compiled-layer types   ← the source of truth
  pipeline/    intent · design · refine · orchestrator
  llm/         provider abstraction (Gemini/Groq/mock) + response cache
  validation/  4 tiers → typed diagnostics
  repair/      deterministic fixers + scoped LLM patch + bounded loop
  compiler/    IR → DB / API / Auth / UI  (deterministic, no LLM)
  runtime/     boots SQLite, enforces auth/ownership/gating, smoke tests
  server/      node:http server: demo UI + API + live generated apps
  eval/        20-prompt dataset, metrics harness, criteria proof
docs/ARCHITECTURE.md   full diagrams
eval-report.md         latest metrics
```
