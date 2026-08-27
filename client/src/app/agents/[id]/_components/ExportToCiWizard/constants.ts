import type { CiExportInputBody } from "@devdigest/shared";

/**
 * Pull-request trigger events the generated workflow can listen to — mirrors
 * `CI_TRIGGER_EVENTS` (`server/src/modules/ci/constants.ts`). Duplicated
 * rather than shared: no ring-0 contract carries the set, and it is fixed by
 * the spec (AC-6), not something this wizard derives.
 */
export const TRIGGER_EVENTS = ["opened", "synchronize", "reopened"] as const;
export type TriggerEvent = (typeof TRIGGER_EVENTS)[number];

/** Publish-mode options for the Configure step's select control (AC-10). */
export const POST_AS_OPTIONS: NonNullable<CiExportInputBody["post_as"]>[] = [
  "github_review",
  "pr_comment",
  "none",
];

/**
 * Secret names the generated workflow references (AC-8, AC-16). Named here
 * only — no field in this wizard reads, stores or displays a secret value.
 */
export const OPENROUTER_SECRET_NAME = "OPENROUTER_API_KEY";
export const GITHUB_TOKEN_SECRET_NAME = "GITHUB_TOKEN";

/** Fixed base branch for v1 — no branch picker in the wizard. */
export const DEFAULT_BASE_BRANCH = "main";
