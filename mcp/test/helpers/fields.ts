/**
 * Field-level inspection of a shaped tool response.
 *
 * Acceptance criterion 8 of `specs/l05-mcp-server.md` is a rule about FIELDS,
 * not about bytes: no response object may carry a `confidence`, a `rationale`,
 * or a UUID **in any field of its own**, and the one permitted UUID carrier is
 * the `trace_url` string — because every run id the engine mints is a UUID and
 * both Step 3's success shape and §Blocking mandate that URL.
 *
 * A `JSON.stringify(...)` + regex assertion cannot express that distinction: to
 * it, "a URL that happens to contain a UUID" and "a field whose value IS a
 * UUID" are the same hit. So these walk the object and report per PATH, which
 * makes the carve-out the thing under test rather than an accident of regex.
 */

/** Matches a UUID anywhere inside a string — substring, not anchored. */
export const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

/**
 * The identifier fields `shape.ts` drops. Handing any of them to the model is
 * what would let it pass an id back as a tool argument — the intent behind the
 * criterion.
 */
export const ID_FIELDS: ReadonlySet<string> = new Set([
  'id',
  'review_id',
  'agent_id',
  'pr_id',
  'run_id',
]);

export interface Leaf {
  /** `trace_url`, `counts.CRITICAL`, `findings[0].title`, … */
  path: string;
  value: unknown;
}

/** Every primitive leaf of `value`, at any depth, with its path. */
export function leaves(value: unknown, path = ''): Leaf[] {
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => leaves(item, `${path}[${index}]`));
  }
  if (typeof value === 'object' && value !== null) {
    return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) =>
      leaves(child, path === '' ? key : `${path}.${key}`),
    );
  }
  return [{ path, value }];
}

/** Every object key of `value`, at any depth, in encounter order. */
export function fieldNames(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(fieldNames);
  if (typeof value === 'object' && value !== null) {
    return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) => [
      key,
      ...fieldNames(child),
    ]);
  }
  return [];
}

/** Paths of every string field whose value contains a UUID. */
export function uuidBearingPaths(value: unknown): string[] {
  return leaves(value)
    .filter((leaf) => typeof leaf.value === 'string' && UUID.test(leaf.value))
    .map((leaf) => leaf.path);
}

/** Paths of every field named like an identifier, whatever its value. */
export function identifierFields(value: unknown): string[] {
  return fieldNames(value).filter((name) => ID_FIELDS.has(name));
}
