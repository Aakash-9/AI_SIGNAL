/**
 * Tiny JSON-path utilities for navigating and mutating the untrusted candidate
 * object by the (string|number)[] paths the validation engine produces.
 *
 * The candidate is raw parsed JSON (pre-Zod-defaults), so we operate on it as a
 * loose structure — hence the `any`s, deliberately contained to this module.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

export type Json = any;

/** Walk a path and return the value (or undefined if any segment is missing). */
export function getByPath(root: Json, path: (string | number)[]): Json {
  let cur = root;
  for (const seg of path) {
    if (cur == null) return undefined;
    cur = cur[seg as any];
  }
  return cur;
}

/** The parent container of a path plus the final key/index. */
export function getParent(root: Json, path: (string | number)[]): { parent: Json; key: string | number } | null {
  if (path.length === 0) return null;
  const parent = getByPath(root, path.slice(0, -1));
  const key = path[path.length - 1]!;
  if (parent == null) return null;
  return { parent, key };
}

/** Deep clone using the structured-clone built-in (Node 17+). */
export function clone<T>(value: T): T {
  return structuredClone(value);
}
