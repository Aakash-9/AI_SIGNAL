/**
 * Boots a real (in-memory) SQLite database from a compiled DBSchema.
 *
 * This is the first half of "execution awareness": the generated schema isn't
 * just printed — it's turned into actual CREATE TABLE statements and run. If the
 * schema is malformed, this throws, which is itself a correctness signal.
 *
 * Uses Node's built-in node:sqlite (no native build step on Windows).
 */

import { DatabaseSync } from "node:sqlite";
import type { DBSchema, SqlType } from "../contracts/compiled.js";

/** Map our abstract column types to SQLite storage classes. */
export function sqliteType(t: SqlType): string {
  switch (t) {
    case "INTEGER":
    case "BOOLEAN":
      return "INTEGER";
    case "REAL":
      return "REAL";
    default:
      return "TEXT"; // TEXT, DATETIME stored as ISO strings
  }
}

export function buildDatabase(schema: DBSchema): DatabaseSync {
  const db = new DatabaseSync(":memory:");

  for (const table of schema.tables) {
    const cols = table.columns.map((c) => {
      let def = `"${c.name}" ${sqliteType(c.sqlType)}`;
      if (c.primaryKey) def += " PRIMARY KEY";
      else if (!c.nullable) def += " NOT NULL";
      if (c.unique && !c.primaryKey) def += " UNIQUE";
      return def;
    });
    db.exec(`CREATE TABLE "${table.name}" (${cols.join(", ")})`);
  }

  return db;
}
