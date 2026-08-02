import type { Severity } from "@devdigest/shared";
import { FILTER_SEVERITIES } from "./constants";

/**
 * Parse `?severity=CRITICAL,WARNING`. Unknown tokens are ignored rather than
 * treated as an error — a hand-edited or stale URL should degrade to a wider
 * view, never to a broken page. The result is deduped and in canonical order,
 * so the param round-trips to itself.
 */
export function parseSeverityParam(raw: string | null | undefined): Severity[] {
  if (!raw) return [];
  const seen = new Set(raw.split(",").map((s) => s.trim().toUpperCase()));
  return FILTER_SEVERITIES.filter((s) => seen.has(s));
}

/** Serialize a selection back to the param value, or `null` to drop the key. */
export function serializeSeverityParam(selected: Severity[]): string | null {
  const ordered = FILTER_SEVERITIES.filter((s) => selected.includes(s));
  return ordered.length > 0 ? ordered.join(",") : null;
}

/** Add or remove one level. Clicking a lit chip clears it. */
export function toggleSeverity(selected: Severity[], sev: Severity): Severity[] {
  return selected.includes(sev)
    ? selected.filter((s) => s !== sev)
    : FILTER_SEVERITIES.filter((s) => s === sev || selected.includes(s));
}
