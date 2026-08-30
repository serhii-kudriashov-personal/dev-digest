import type { ApprovalCapability } from "@/lib/types";

/**
 * Message key per approval capability (AC-8, AC-9).
 *
 * Three entries, not two. `unknown` has its own sentence because GitLab answers
 * the same 404 for "not licensed" and "not permitted" — rendering it as
 * "unavailable" would be a confident guess about something the instance
 * deliberately does not disclose (root `INSIGHTS.md` 2026-08-28).
 */
export const CAPABILITY_KEY: Record<ApprovalCapability, string> = {
  permitted: "instances.capability.permitted",
  refused: "instances.capability.refused",
  unknown: "instances.capability.unknown",
};
