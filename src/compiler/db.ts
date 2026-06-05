/**
 * DB compiler: AppSpec -> DBSchema.
 *
 * Responsibilities:
 *   - Synthesise the `users` table (the compiler owns auth, never the LLM).
 *   - Turn each entity into a table, adding boilerplate columns
 *     (id / created_at / updated_at, and owner_id for ownable entities).
 *   - Turn manyToOne relations into foreign-key columns.
 *   - Turn manyToMany relations into join tables (generated once per pair).
 *
 * No randomness, no AI — same spec in, same schema out.
 */

import type { AppSpec, Entity, Field } from "../contracts/appspec.js";
import type { DBColumn, DBSchema, DBTable, SqlType } from "../contracts/compiled.js";
import { foreignKeyColumn, joinTableName, snakeCase, tableName } from "./naming.js";

const USERS_TABLE = "users";

function sqlTypeFor(type: Field["type"]): SqlType {
  switch (type) {
    case "integer":
      return "INTEGER";
    case "number":
      return "REAL";
    case "boolean":
      return "BOOLEAN";
    case "date":
    case "datetime":
      return "DATETIME";
    default:
      // string, text, email, url, enum all stored as TEXT
      return "TEXT";
  }
}

/** The standard primary key every table gets. */
function idColumn(): DBColumn {
  return { name: "id", sqlType: "TEXT", nullable: false, unique: true, primaryKey: true };
}

/** created_at / updated_at audit columns. */
function timestampColumns(): DBColumn[] {
  return [
    { name: "created_at", sqlType: "DATETIME", nullable: false, unique: false, primaryKey: false },
    { name: "updated_at", sqlType: "DATETIME", nullable: false, unique: false, primaryKey: false },
  ];
}

function columnForField(field: Field): DBColumn {
  return {
    name: snakeCase(field.name),
    sqlType: sqlTypeFor(field.type),
    nullable: !field.required,
    unique: field.unique,
    primaryKey: false,
    ...(field.default !== undefined ? { default: field.default } : {}),
    ...(field.type === "enum" && field.enumValues ? { enumValues: field.enumValues } : {}),
  };
}

/** The synthesised users table — the backbone of auth. */
function buildUsersTable(): DBTable {
  return {
    name: USERS_TABLE,
    sourceEntity: null,
    columns: [
      idColumn(),
      { name: "email", sqlType: "TEXT", nullable: false, unique: true, primaryKey: false },
      { name: "password_hash", sqlType: "TEXT", nullable: false, unique: false, primaryKey: false },
      { name: "role", sqlType: "TEXT", nullable: false, unique: false, primaryKey: false },
      { name: "plan", sqlType: "TEXT", nullable: false, unique: false, primaryKey: false },
      ...timestampColumns(),
    ],
  };
}

function buildEntityTable(entity: Entity): DBTable {
  const columns: DBColumn[] = [idColumn()];

  for (const field of entity.fields) {
    columns.push(columnForField(field));
  }

  // manyToOne relations become foreign-key columns on this entity.
  for (const rel of entity.relations) {
    if (rel.kind === "manyToOne") {
      columns.push({
        name: foreignKeyColumn(rel.name),
        sqlType: "TEXT",
        nullable: !rel.required,
        unique: false,
        primaryKey: false,
        references: { table: tableName(rel.target), column: "id" },
      });
    }
  }

  // Ownable entities get an owner_id pointing at the users table.
  if (entity.ownable) {
    columns.push({
      name: "owner_id",
      sqlType: "TEXT",
      nullable: false,
      unique: false,
      primaryKey: false,
      references: { table: USERS_TABLE, column: "id" },
    });
  }

  columns.push(...timestampColumns());

  return { name: tableName(entity.name), sourceEntity: entity.name, columns };
}

/** Build a join table for a manyToMany relation between two entities. */
function buildJoinTable(a: string, b: string): DBTable {
  return {
    name: joinTableName(a, b),
    sourceEntity: null,
    columns: [
      idColumn(),
      {
        name: foreignKeyColumn(a),
        sqlType: "TEXT",
        nullable: false,
        unique: false,
        primaryKey: false,
        references: { table: tableName(a), column: "id" },
      },
      {
        name: foreignKeyColumn(b),
        sqlType: "TEXT",
        nullable: false,
        unique: false,
        primaryKey: false,
        references: { table: tableName(b), column: "id" },
      },
    ],
  };
}

export function compileDB(spec: AppSpec): DBSchema {
  const tables: DBTable[] = [buildUsersTable()];

  for (const entity of spec.entities) {
    tables.push(buildEntityTable(entity));
  }

  // Many-to-many join tables, de-duplicated by name so a relation declared on
  // both sides only produces one join table.
  const seen = new Set(tables.map((t) => t.name));
  for (const entity of spec.entities) {
    for (const rel of entity.relations) {
      if (rel.kind !== "manyToMany") continue;
      const name = joinTableName(entity.name, rel.target);
      if (seen.has(name)) continue;
      seen.add(name);
      tables.push(buildJoinTable(entity.name, rel.target));
    }
  }

  return { tables };
}
