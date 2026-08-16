import type { ContextAttachment, ContextDocument } from "@devdigest/shared";

/**
 * The attached document paths in injection order.
 *
 * Derived from the attachments on every render rather than mirrored into state
 * — the mutation writes the new order into the query cache optimistically, so
 * this is always the order the user last asked for.
 */
export function orderedPaths(attachments: ContextAttachment[] | undefined): string[] {
  return [...(attachments ?? [])].sort((a, b) => a.order - b.order).map((a) => a.path);
}

/** Move the item at `from` to `to`, returning a new array (or the same one on a no-op). */
export function reorder(paths: string[], from: number, to: number): string[] {
  if (from === to || from < 0 || to < 0 || from >= paths.length || to >= paths.length) return paths;
  const next = [...paths];
  const [moved] = next.splice(from, 1);
  if (moved === undefined) return paths;
  next.splice(to, 0, moved);
  return next;
}

/** Case-insensitive filter over a document's path. */
export function filterByPath(documents: ContextDocument[], search: string): ContextDocument[] {
  const q = search.trim().toLowerCase();
  if (!q) return documents;
  return documents.filter((doc) => doc.path.toLowerCase().includes(q));
}

/** Which attached paths the last scan could not find, by path. */
export function missingPaths(attachments: ContextAttachment[] | undefined): Set<string> {
  return new Set((attachments ?? []).filter((a) => a.missing).map((a) => a.path));
}
