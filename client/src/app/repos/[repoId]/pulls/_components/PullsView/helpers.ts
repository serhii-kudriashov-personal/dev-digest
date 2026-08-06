import type { PrMeta } from "../../constants";
import { OPEN_STATUSES } from "./constants";

/**
 * Apply the status chip, the free-text query and the sort order, in that order.
 * Returns a fresh array — the input is never mutated.
 */
export function filterAndSortPulls(
  pulls: PrMeta[],
  status: string,
  query: string,
  sort: string,
): PrMeta[] {
  const q = query.trim().toLowerCase();
  return pulls
    .filter((p) => status === "all" || p.status === status)
    .filter((p) => !q || p.title.toLowerCase().includes(q) || String(p.number).includes(q))
    .slice()
    .sort((a, b) => {
      const ta = Date.parse(a.updated_at ?? "") || 0;
      const tb = Date.parse(b.updated_at ?? "") || 0;
      return sort === "oldest" ? ta - tb : tb - ta;
    });
}

/** How many PRs are still open, by derived review status. */
export function countOpen(pulls: PrMeta[]): number {
  return pulls.filter((p) => OPEN_STATUSES.has(p.status)).length;
}

/** How many PRs are waiting for a first review. */
export function countNeedsReview(pulls: PrMeta[]): number {
  return pulls.filter((p) => p.status === "needs_review").length;
}
