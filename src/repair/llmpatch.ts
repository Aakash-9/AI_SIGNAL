/**
 * Scoped LLM patch — the "surgical" repair for problems that need judgment
 * (e.g. a permission references entity 'Ghost' that doesn't exist; the model
 * probably meant a real entity, so deleting it would lose intent).
 *
 * Crucially this is NOT a blind full retry. We:
 *   1. group the failing diagnostics by their "repair unit" (one permission,
 *      one entity, one page...),
 *   2. extract ONLY that fragment,
 *   3. hand the model the fragment + the exact errors + the valid symbol names,
 *   4. splice the corrected fragment back in.
 *
 * One small focused call per broken unit, not a regeneration of the whole app.
 */

import type { LLMProvider } from "../llm/index.js";
import type { Diagnostic } from "../validation/types.js";
import { getByPath, type Json } from "./paths.js";

const REPAIR_SYSTEM = `You are the REPAIR stage of an app-generation compiler.
You are given ONE fragment of an AppSpec blueprint and a list of specific errors in it.
Return the CORRECTED fragment as JSON only (no prose, no markdown).
Change ONLY what is needed to fix the listed errors; keep everything else identical.
When a reference points to a name that does not exist, replace it with the closest matching
name from the provided valid-names lists.`;

interface RepairUnit {
  key: string; // display key e.g. "permissions[1]"
  container: string; // top-level field e.g. "permissions"
  index?: number; // array index if applicable
  diags: Diagnostic[];
}

/** Group diagnostics by the fragment they live in. */
function groupByUnit(diagnostics: Diagnostic[]): RepairUnit[] {
  const units = new Map<string, RepairUnit>();
  for (const d of diagnostics) {
    const head = d.path[0];
    const second = d.path[1];
    if (head === undefined) continue; // can't scope a root-level issue to a fragment
    const container = String(head);
    const index = typeof second === "number" ? second : undefined;
    const key = index !== undefined ? `${container}[${index}]` : container;
    if (!units.has(key)) units.set(key, { key, container, index, diags: [] });
    units.get(key)!.diags.push(d);
  }
  return [...units.values()];
}

function collectSymbols(candidate: Json) {
  const names = (arr: Json) => (Array.isArray(arr) ? arr.map((x: Json) => x?.name).filter(Boolean) : []);
  return {
    entities: names(candidate.entities),
    roles: names(candidate.roles),
    plans: names(candidate.plans),
    pages: names(candidate.pages),
  };
}

function buildRepairPrompt(unit: RepairUnit, fragment: Json, symbols: ReturnType<typeof collectSymbols>): string {
  const errors = unit.diags
    .map((d) => `- ${d.hint?.kind === "llmPatch" ? d.hint.instruction : d.message}`)
    .join("\n");
  return `Fragment location: ${unit.key}

Valid entity names: ${JSON.stringify(symbols.entities)}
Valid role names: ${JSON.stringify(symbols.roles)}
Valid plan names: ${JSON.stringify(symbols.plans)}
Valid page names: ${JSON.stringify(symbols.pages)}

Errors to fix in this fragment:
${errors}

Current fragment JSON:
${JSON.stringify(fragment, null, 2)}

Return the corrected fragment as JSON only.`;
}

export interface LLMPatchResult {
  candidate: Json;
  applied: string[];
  llmCalls: number;
  usage: { inputTokens: number; outputTokens: number };
}

export async function applyLLMPatch(
  candidate: Json,
  diagnostics: Diagnostic[],
  provider: LLMProvider,
  model?: string,
): Promise<LLMPatchResult> {
  const symbols = collectSymbols(candidate);
  const applied: string[] = [];
  let llmCalls = 0;
  const usage = { inputTokens: 0, outputTokens: 0 };

  for (const unit of groupByUnit(diagnostics)) {
    const fragmentPath: (string | number)[] =
      unit.index !== undefined ? [unit.container, unit.index] : [unit.container];
    const fragment = getByPath(candidate, fragmentPath);
    if (fragment === undefined) continue;

    let res;
    try {
      res = await provider.generateJSON({
        stage: "repair",
        system: REPAIR_SYSTEM,
        prompt: buildRepairPrompt(unit, fragment, symbols),
        temperature: 0,
        model,
      });
    } catch (e) {
      // A failed patch on one unit must not abort the whole repair; leave the
      // fragment as-is and let the loop's final validation report what remains.
      applied.push(`scoped LLM patch on ${unit.key} failed: ${(e as Error).message}`);
      continue;
    }
    llmCalls++;
    usage.inputTokens += res.usage.inputTokens;
    usage.outputTokens += res.usage.outputTokens;

    // Splice the corrected fragment back in.
    if (unit.index !== undefined) {
      if (Array.isArray(candidate[unit.container])) candidate[unit.container][unit.index] = res.data;
    } else {
      candidate[unit.container] = res.data;
    }
    applied.push(`scoped LLM patch on ${unit.key} (${unit.diags.length} issue(s))`);
  }

  return { candidate, applied, llmCalls, usage };
}
