import type { Severity } from "@devdigest/shared";

/** The chips, worst first. Also the canonical order of the `?severity=` param. */
export const FILTER_SEVERITIES: Severity[] = ["CRITICAL", "WARNING", "SUGGESTION"];

/** Query-string key holding the selection (shared by every run on the page). */
export const SEVERITY_PARAM = "severity";
