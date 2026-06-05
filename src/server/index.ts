/**
 * The demo server — a zero-dependency node:http server.
 *
 * Routes:
 *   GET  /                         -> the compiler demo UI
 *   GET  /health                   -> liveness + config
 *   POST /api/generate { prompt }  -> run the pipeline, returns the trace (+ appUrl)
 *   POST /api/refine  { spec, instruction }
 *   GET  /app/:id                  -> the generated app, running (generic SPA)
 *   *    /app/:id/api/*            -> the generated app's live backend (runtime)
 *
 * generateApp() never throws, so /api/generate always returns a structured trace.
 */

import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { safeParseAppSpec } from "../contracts/appspec.js";
import { config } from "../config.js";
import { generateApp, type PipelineTrace } from "../pipeline/index.js";
import { refineApp } from "../pipeline/refine.js";
import { getApp, registerApp } from "./apps.js";

const PORT = Number(process.env.PORT ?? 4321);
const PAGE = readFileSync(new URL("./page.html", import.meta.url), "utf8");
const APP_PAGE = readFileSync(new URL("./app.html", import.meta.url), "utf8");

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

function json(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

/** Boot a runtime for a successful generation and attach its live URL. */
function attachAppUrl(trace: PipelineTrace): void {
  if (trace.ok && trace.compiled) {
    (trace as PipelineTrace & { appUrl?: string }).appUrl = `/app/${registerApp(trace.compiled)}`;
  }
}

function tokenFrom(req: IncomingMessage, search: URLSearchParams): string {
  const auth = req.headers.authorization;
  if (auth?.startsWith("Bearer ")) return auth.slice(7);
  return search.get("token") ?? "";
}

/** Serve a running generated app and its live runtime API. */
async function serveApp(req: IncomingMessage, res: ServerResponse, segs: string[], search: URLSearchParams) {
  const inst = getApp(segs[1] ?? "");
  if (!inst) {
    if (req.method === "GET" && segs.length === 2) {
      res.writeHead(404, { "content-type": "text/html; charset=utf-8" });
      res.end("<body style='font-family:sans-serif;padding:40px'><h2>App expired</h2><p>Generated apps run in memory — go back and generate it again.</p></body>");
      return;
    }
    return json(res, 404, { error: "app not found (it may have expired)" });
  }

  // GET /app/:id  -> the SPA
  if (segs.length === 2 && req.method === "GET") {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(APP_PAGE);
    return;
  }
  // GET /app/:id/config
  if (segs[2] === "config" && req.method === "GET") {
    return json(res, 200, {
      appName: inst.compiled.ui.appName,
      ui: inst.compiled.ui,
      requireAuth: inst.compiled.auth.requireAuth,
      seededUsers: inst.compiled.auth.seededUsers,
      defaultPlan: inst.compiled.auth.defaultPlan,
    });
  }
  // /app/:id/api/*
  if (segs[2] === "api") {
    const rest = segs.slice(3);

    if (rest[0] === "auth" && rest[1] === "login" && req.method === "POST") {
      const body = JSON.parse((await readBody(req)) || "{}");
      const user = inst.runtime.login(String(body.email ?? ""), String(body.password ?? ""));
      if (!user) return json(res, 401, { error: "invalid email or password" });
      const token = randomUUID();
      inst.sessions.set(token, user);
      return json(res, 200, { token, user: { email: user.email, role: user.role, plan: user.plan } });
    }

    const token = tokenFrom(req, search);
    const user = inst.sessions.get(token);
    if (!user) return json(res, 401, { error: "not authenticated" });

    if (rest[0] === "auth" && rest[1] === "me" && req.method === "GET") return json(res, 200, { user });

    if (rest[0] === "billing" && rest[1] === "subscribe" && req.method === "POST") {
      const body = JSON.parse((await readBody(req)) || "{}");
      const updated = inst.runtime.setPlan(user, String(body.plan ?? ""));
      inst.sessions.set(token, updated);
      return json(res, 200, { user: updated });
    }

    // entity CRUD
    const table = rest[0] ?? "";
    const entity = inst.tableToEntity.get(table);
    if (!entity) return json(res, 404, { error: "unknown collection" });
    const rid = rest[1];
    const reply = (r: { ok: boolean; status: number; data?: unknown; error?: string }) =>
      json(res, r.status, r.ok ? r.data : { error: r.error });

    if (!rid) {
      if (req.method === "GET") return reply(inst.runtime.list(user, entity));
      if (req.method === "POST") return reply(inst.runtime.create(user, entity, JSON.parse((await readBody(req)) || "{}")));
    } else {
      if (req.method === "GET") return reply(inst.runtime.get(user, entity, rid));
      if (req.method === "DELETE") return reply(inst.runtime.remove(user, entity, rid));
    }
    return json(res, 405, { error: "method not allowed" });
  }
  return json(res, 404, { error: "not found" });
}

const server = createServer(async (req, res) => {
  const u = new URL(req.url ?? "/", "http://localhost");
  const url = u.pathname;
  const segs = url.split("/").filter(Boolean);
  try {
    if (segs[0] === "app") return await serveApp(req, res, segs, u.searchParams);

    if (req.method === "GET" && (url === "/" || url === "/index.html")) {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(PAGE);
      return;
    }
    if (req.method === "GET" && url === "/health") {
      return json(res, 200, { ok: true, provider: config.llmProvider, cache: config.llmCacheMode });
    }
    if (req.method === "POST" && url === "/api/generate") {
      const prompt = String(JSON.parse((await readBody(req)) || "{}").prompt ?? "").trim();
      if (!prompt) return json(res, 400, { error: "prompt is required" });
      const trace = await generateApp(prompt);
      attachAppUrl(trace);
      return json(res, 200, trace);
    }
    if (req.method === "POST" && url === "/api/refine") {
      const parsed = JSON.parse((await readBody(req)) || "{}");
      const instruction = String(parsed.instruction ?? "").trim();
      if (!instruction) return json(res, 400, { error: "instruction is required" });
      const specResult = safeParseAppSpec(parsed.spec);
      if (!specResult.success) return json(res, 400, { error: "a valid current spec is required" });
      const trace = await refineApp(specResult.data, instruction);
      attachAppUrl(trace);
      return json(res, 200, trace);
    }
    json(res, 404, { error: "not found" });
  } catch (e) {
    json(res, 500, { error: (e as Error).message });
  }
});

server.on("error", (err: NodeJS.ErrnoException) => {
  if (err.code === "EADDRINUSE") {
    console.error(`\n  Port ${PORT} is already in use. Start on another port, e.g.:  PORT=4400 npm run serve\n`);
  } else {
    console.error("Server error:", err.message);
  }
  process.exit(1);
});

server.listen(PORT, () => {
  console.log(`\n  NL→App Compiler — demo running at http://localhost:${PORT}`);
  console.log(`  provider: ${config.llmProvider}  |  cache: ${config.llmCacheMode}\n`);
});
