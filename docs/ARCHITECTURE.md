# System Design

## The core idea

> **One canonical Intermediate Representation (IR), compiled into four interlocking layers.**
> The LLM does only the small, fuzzy job — understand the human and produce the IR.
> Everything else is **deterministic code**, so the layers *cannot* drift, and most
> failures are fixed without ever calling the model again.

This is a **compiler**, not a prompt: `Natural language → IR → validate/repair → 4 layers → a running app`.

---

## 1. End-to-end pipeline

```mermaid
flowchart TD
    P([User prompt]) --> I

    subgraph LLM["🧠 LLM stages — the ONLY non-deterministic part"]
      direction TB
      I["1 · Intent Extraction<br/>(constrained JSON) → IntentIR"]
      D["2 · System Design<br/>(constrained JSON) → raw AppSpec"]
    end

    I -->|"entities = 0 (too vague)"| CL([❓ Clarification gate<br/>ask, don't guess])
    I -->|structured intent| D
    D --> V

    subgraph SAFETY["🛡️ Validation + Repair loop  (the reliability core)"]
      direction LR
      V["3 · Validate<br/>structural · referential · semantic"]
      R["4 · Repair<br/>deterministic fixers + scoped LLM patch"]
      V -- "typed diagnostics" --> R
      R -- "re-validate (bounded, converging)" --> V
    end

    V -->|"valid AppSpec = the IR"| C

    subgraph COMPILE["⚙️ Deterministic compiler — NO LLM"]
      direction LR
      C{{"5 · compile(IR)"}}
      DBs[("DB schema")]
      APIs["API schema"]
      AUTHs["Auth policy<br/>+ seeded admin"]
      UIs["UI config<br/>+ pricing page"]
      C --> DBs & APIs & AUTHs & UIs
    end

    DBs & APIs & AUTHs & UIs --> RT

    subgraph EXEC["✅ Execution proof"]
      RT["6 · Runtime: boot real SQLite<br/>+ smoke tests (signup, CRUD,<br/>403 ownership, premium gating)"]
    end

    RT --> OUT([Working app · JSON · clickable preview · 100% smoke])
    CL --> OUT

    classDef llm fill:#efe9ff,stroke:#6d5efc,color:#222;
    classDef code fill:#e9f9ef,stroke:#16a34a,color:#222;
    class I,D llm;
    class C,DBs,APIs,AUTHs,UIs,RT code;
```

**Why this wins:** the LLM's variance is confined to a tiny IR. The four layers are
*derived from the same object by code*, so cross-layer consistency is guaranteed by
construction (proven: 200 compiles → 1 identical hash; 10/10 UI fields trace to real
DB columns; 0 scoped-LLM-patch calls across the 20-prompt eval).

---

## 2. Module / component map

```mermaid
flowchart LR
    subgraph APP["apps"]
      WEB["web server + demo UI<br/>(node:http, zero-dep)"]
    end

    subgraph PIPE["pipeline (orchestration)"]
      ORCH["orchestrator<br/>generate / refine"]
    end

    subgraph LLMLAYER["llm (provider abstraction)"]
      PROV["provider interface"]
      CACHE["response cache<br/>(record/replay)"]
      GEM["Gemini"]
      GRQ["Groq"]
      MOCK["Mock (offline)"]
    end

    subgraph CORE["core engine"]
      CON["contracts / IR<br/>(Zod — 1 source of truth)"]
      VAL["validation<br/>(4 tiers, typed errors)"]
      REP["repair<br/>(deterministic + LLM patch)"]
      COMP["compiler<br/>(IR → DB/API/Auth/UI)"]
      RUN["runtime<br/>(node:sqlite + smoke)"]
    end

    EVAL["eval harness<br/>(20 prompts → metrics)"]
    CRIT["criteria suite<br/>(proves the 5 criteria)"]

    WEB --> ORCH
    ORCH --> PROV --> CACHE --> GEM & GRQ & MOCK
    ORCH --> VAL --> REP --> COMP --> RUN
    CON -. "validates / types" .-> VAL & REP & COMP & RUN
    EVAL --> ORCH
    CRIT --> COMP & VAL & REP & RUN
```

---

## 3. The canonical IR (what flows through the system)

```
AppSpec  (the single source of truth)
├── entities      [{ name, fields[], relations[], ownable }]
├── roles         [{ name, isDefault }]
├── permissions   [{ role, entity, actions[], scope, requiresPlan }]
├── pages         [{ name, route, type, entity, access[], widgets[] }]
├── plans         [{ name, price, interval, features[] }]
├── businessRules [ plan_gate | ownership ]
├── auth          { strategy, requireAuth }
└── assumptions   [ documented guesses for vague prompts ]
```

Everything references everything else **by name** → cross-layer checks become a
symbol-table problem the validator resolves like a linker.

---

## 4. Tech stack & why

| Concern | Choice | Why |
| --- | --- | --- |
| Language | **TypeScript** (strict) | one source → contract + types + JSON-Schema |
| Contract / IR | **Zod** | runtime validation + inferred types + strict (rejects hallucinated keys) |
| LLM | **Gemini** (Groq/Mock pluggable) | free tier; provider abstraction for routing & cost |
| Reliability | retry + rate-limit-hint + model fallback + response cache | survives outages & rate limits |
| Runtime DB | **node:sqlite** (built-in) | zero-dep execution proof, no native build |
| Web | **node:http** (zero-dep) | deploys anywhere (Azure App Service), no framework |
| Determinism | temp 0 · code compilation · normalization · cache | same input → same output |

---

## 5. Failure handling (decision flow)

```mermaid
flowchart TD
    A([prompt / candidate]) --> B{enough to build?}
    B -- no --> Q([ask clarifying questions])
    B -- yes --> C{valid?}
    C -- yes --> OK([compile + run])
    C -- no --> D{fixable in code?}
    D -- "yes (casing, dangling ref,<br/>reserved entity, scope, conflict)" --> E[deterministic repair] --> C
    D -- "no (needs judgement)" --> F{LLM budget left?}
    F -- yes --> G[scoped LLM patch<br/>one fragment only] --> C
    F -- no --> H([fail gracefully<br/>structured error, never crash])
```

Reasonable gaps → **documented assumptions**. True vagueness → **clarification**.
Everything else → **typed error → targeted fix → re-validate**, bounded so it always terminates.
