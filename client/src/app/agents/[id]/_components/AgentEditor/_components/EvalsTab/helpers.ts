export { formatPct, formatCost, formatDuration } from "@/lib/eval-format";

/** The two runs a compare action needs — exactly two, in either order. */
export function canCompare(selected: string[]): boolean {
  return selected.length === 2;
}
