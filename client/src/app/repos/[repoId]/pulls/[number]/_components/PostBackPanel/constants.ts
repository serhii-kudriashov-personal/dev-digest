import type { IconName } from "@devdigest/ui";
import type { PostBackOutcome } from "@devdigest/shared";

/**
 * Per-outcome visual meta. Each key also names the message under
 * `prReview.postBack.outcome`, so the label is derived from the outcome at
 * render time and never mirrored into state.
 *
 * FOUR contract states, THREE of which are AC-39's user-facing outcomes
 * (`specs/2026-08-28-gitlab-repositories.md`):
 *
 * - `posted_verdict_applied` and `posted_verdict_not_applied` are BOTH "posted".
 *   They differ only in whether the verdict took effect on the forge, and the
 *   server's `reason` is what explains which — collapsing them into one "posted"
 *   state would delete the distinction that reason is written to carry.
 * - `partially_published` is deliberately NOT styled or worded as a failure
 *   (AC-40): some notes are already sitting on the change request, and a user
 *   who reads "failed" never goes to look at them. Warning, not critical.
 * - `not_posted` is not a fourth AC-39 outcome — it is the ordinary "nothing
 *   landed" failure that already existed for GitHub (spec §2, state machine).
 *
 * Nothing here interprets WHY. A refused approval is a stated reason from the
 * server (AC-38), never a capability claim composed in the client — GitLab
 * approvals are free tier, so a 403 means the credential's user is not an
 * eligible approver (root `INSIGHTS.md` 2026-08-28).
 */
export const POST_BACK_META: Record<PostBackOutcome, { c: string; bg: string; icon: IconName }> = {
  posted_verdict_applied: { c: "var(--ok)", bg: "var(--ok-bg)", icon: "CheckCircle" },
  posted_verdict_not_applied: { c: "var(--info)", bg: "var(--info-bg)", icon: "Info" },
  partially_published: { c: "var(--warn)", bg: "var(--warn-bg)", icon: "AlertTriangle" },
  not_posted: { c: "var(--crit)", bg: "var(--crit-bg)", icon: "XCircle" },
};

/**
 * Outcomes the "post" control stays available for.
 *
 * Only the one where nothing landed: re-posting after a complete or a partial
 * publication would duplicate notes already on the change request.
 */
export const RETRYABLE_OUTCOMES: readonly PostBackOutcome[] = ["not_posted"];
