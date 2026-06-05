/**
 * The compiler entry point.
 *
 * compile(spec) deterministically projects one validated AppSpec into the four
 * interlocking layers. No AI, no randomness — the heart of the "compiler, not a
 * script" design.
 */

import type { AppSpec } from "../contracts/appspec.js";
import type { CompiledApp } from "../contracts/compiled.js";
import { compileAPI } from "./api.js";
import { compileDB } from "./db.js";
import { compileAuth } from "./policy.js";
import { compileUI } from "./ui.js";

export function compile(spec: AppSpec): CompiledApp {
  return {
    db: compileDB(spec),
    api: compileAPI(spec),
    auth: compileAuth(spec),
    ui: compileUI(spec),
  };
}

export { compileAPI, compileDB, compileAuth, compileUI };
