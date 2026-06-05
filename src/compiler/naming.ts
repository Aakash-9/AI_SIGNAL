/**
 * Deterministic naming helpers.
 *
 * Determinism is a graded requirement, and it starts here: the same entity name
 * must always produce the same table name, column name, and route — every run,
 * no randomness. These are pure functions with no LLM involvement.
 */

/** "firstName" / "FirstName" -> "first_name" */
export function snakeCase(input: string): string {
  return input
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[\s-]+/g, "_")
    .toLowerCase();
}

/**
 * Naive but deterministic English pluraliser. Good enough for table names;
 * intentionally simple so behaviour is predictable (company -> companies,
 * box -> boxes, contact -> contacts).
 */
export function pluralize(word: string): string {
  if (/[^aeiou]y$/i.test(word)) return word.replace(/y$/i, "ies");
  if (/(s|x|z|ch|sh)$/i.test(word)) return word + "es";
  return word + "s";
}

/** Entity "Contact" -> table "contacts" */
export function tableName(entity: string): string {
  return pluralize(snakeCase(entity));
}

/** Relation "owner" -> foreign key column "owner_id" */
export function foreignKeyColumn(relationName: string): string {
  return snakeCase(relationName) + "_id";
}

/** Deterministic join-table name for a many-to-many, order-independent. */
export function joinTableName(a: string, b: string): string {
  return [tableName(a), tableName(b)].sort().join("_");
}

/** A human label fallback: "firstName" -> "First Name" */
export function humanLabel(name: string): string {
  const spaced = name
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}
