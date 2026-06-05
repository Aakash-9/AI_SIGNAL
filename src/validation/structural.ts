/**
 * Tier 2 — STRUCTURAL validation.
 *
 * Translates Zod's parse errors into our typed diagnostics, deciding fixability:
 *   - hallucinated/unknown keys       -> DETERMINISTIC fix (removeKey)
 *   - missing fields / wrong types /  -> scoped LLM patch (needs a real value)
 *     bad enums / bad unions
 *
 * This is where most model "hallucinations" are caught (strict mode rejects any
 * key not in the contract).
 */

import type { ZodError, ZodIssue } from "zod";
import { diag, pathToString, type Diagnostic } from "./types.js";

export function structuralDiagnostics(error: ZodError): Diagnostic[] {
  const diags: Diagnostic[] = [];

  for (const issue of error.issues) {
    diags.push(...mapIssue(issue));
  }
  return diags;
}

function mapIssue(issue: ZodIssue): Diagnostic[] {
  switch (issue.code) {
    case "unrecognized_keys": {
      // One diagnostic per hallucinated key — each removable deterministically.
      return issue.keys.map((key) =>
        diag(
          "structural",
          "UNKNOWN_KEY",
          "error",
          issue.path,
          `Hallucinated key '${key}' is not part of the contract`,
          true,
          { kind: "removeKey", key },
        ),
      );
    }

    case "invalid_type": {
      const isMissing = issue.received === "undefined";
      return [
        diag(
          "structural",
          isMissing ? "MISSING_FIELD" : "INVALID_TYPE",
          "error",
          issue.path,
          isMissing
            ? `Missing required field (expected ${issue.expected})`
            : `Expected ${issue.expected}, received ${issue.received}`,
          false,
          {
            kind: "llmPatch",
            instruction: isMissing
              ? `Add the missing required field at '${pathToString(issue.path)}' (expected ${issue.expected}).`
              : `Fix the value at '${pathToString(issue.path)}': expected ${issue.expected}, got ${issue.received}.`,
          },
        ),
      ];
    }

    case "invalid_enum_value": {
      const options = (issue.options ?? []).map(String).join(", ");
      return [
        diag(
          "structural",
          "INVALID_ENUM",
          "error",
          issue.path,
          `Invalid value '${String(issue.received)}'. Allowed: ${options}`,
          false,
          {
            kind: "llmPatch",
            instruction: `Replace the value at '${pathToString(issue.path)}' with one of: ${options}.`,
          },
        ),
      ];
    }

    case "invalid_union_discriminator": {
      const options = (issue.options ?? []).map(String).join(", ");
      return [
        diag(
          "structural",
          "INVALID_DISCRIMINATOR",
          "error",
          issue.path,
          `Invalid discriminator. Allowed types: ${options}`,
          false,
          {
            kind: "llmPatch",
            instruction: `Fix the discriminator 'type' at '${pathToString(issue.path)}'. Allowed: ${options}.`,
          },
        ),
      ];
    }

    case "invalid_string": {
      // Identifier-casing failures (our EntityName / camelCase regexes) are
      // mechanically fixable — normalise them deterministically instead of
      // spending an LLM patch. Other string failures (email/url) need judgment.
      if (/PascalCase/.test(issue.message)) {
        return [diag("structural", "BAD_PASCAL_CASE", "error", issue.path, issue.message, true, { kind: "pascalCase" })];
      }
      if (/camelCase/.test(issue.message)) {
        return [diag("structural", "BAD_CAMEL_CASE", "error", issue.path, issue.message, true, { kind: "camelCase" })];
      }
      return [
        diag("structural", "INVALID_STRING", "error", issue.path, issue.message, false, {
          kind: "llmPatch",
          instruction: `Fix '${pathToString(issue.path)}': ${issue.message}.`,
        }),
      ];
    }

    case "too_small":
    case "too_big": {
      return [
        diag("structural", issue.code.toUpperCase(), "error", issue.path, issue.message, false, {
          kind: "llmPatch",
          instruction: `Fix '${pathToString(issue.path)}': ${issue.message}.`,
        }),
      ];
    }

    default: {
      // invalid_string, custom refinements (e.g. "enum needs enumValues"), etc.
      return [
        diag("structural", String(issue.code).toUpperCase(), "error", issue.path, issue.message, false, {
          kind: "llmPatch",
          instruction: `Fix '${pathToString(issue.path)}': ${issue.message}.`,
        }),
      ];
    }
  }
}
