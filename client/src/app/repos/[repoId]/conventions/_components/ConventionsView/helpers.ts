import type { ConventionCandidate } from "@devdigest/shared";

/** Minutes below which a scan reads as "just now". */
const JUST_NOW_MINUTES = 1;
const MINUTES_PER_HOUR = 60;
const HOURS_PER_DAY = 24;

export interface ScanAge {
  unit: "justNow" | "minutes" | "hours" | "days";
  count: number;
}

/**
 * Coarse age of the last scan, as a unit + count for the i18n layer to phrase.
 *
 * Coarse on purpose: the header answers "is this stale?", not "exactly when". A
 * future `createdAt` (clock skew between the API host and the browser) reads as
 * "just now" rather than as a negative count.
 */
export function scanAge(createdAt: string, now: number = Date.now()): ScanAge {
  const minutes = Math.floor((now - new Date(createdAt).getTime()) / 60_000);
  if (!Number.isFinite(minutes) || minutes < JUST_NOW_MINUTES) return { unit: "justNow", count: 0 };
  if (minutes < MINUTES_PER_HOUR) return { unit: "minutes", count: minutes };
  const hours = Math.floor(minutes / MINUTES_PER_HOUR);
  if (hours < HOURS_PER_DAY) return { unit: "hours", count: hours };
  return { unit: "days", count: Math.floor(hours / HOURS_PER_DAY) };
}

/**
 * The accepted ids, in the order the cards render.
 *
 * Insertion order, never confidence order: `confidence` is not calibrated and is
 * not allowed to rank anything.
 */
export function acceptedIds(candidates: ConventionCandidate[]): string[] {
  return candidates.filter((c) => c.status === "accepted").map((c) => c.id);
}
