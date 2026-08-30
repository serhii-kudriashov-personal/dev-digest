/**
 * Review module constants.
 */

/**
 * Studio review strategy. 'single-pass' = send the WHOLE diff in ONE LLM call.
 * We deliberately do NOT use 'auto'/map-reduce by default: map-reduce makes one
 * call PER FILE, which is slow and fragile (any single file's transient 5xx
 * fails the entire run) and unnecessary — the whole diff already fits the
 * model's context.
 */
export const REVIEW_STRATEGY = 'single-pass' as const;

/**
 * How many inline notes one post-back may publish (SPEC-06 — NFR-3).
 *
 * READ THIS BEFORE LOOKING FOR THE GITHUB BASELINE: there is not one. NFR-3 is
 * written as "capped at the same limit already applied when posting to GitHub",
 * and no such limit exists anywhere in this repo — `postReview` had a real
 * adapter, a mock and a passing test, and ZERO production callers, so nothing
 * ever posted a review to GitHub and nothing ever capped one (root `INSIGHTS.md`
 * 2026-08-28; `plans/2026-08-28-gitlab-repositories.md` §Risks item 1).
 *
 * So 20 is a NEW DECISION standing in for an unmeasurable requirement, taken by
 * the repo owner to unblock Stage E — not an implementation of NFR-3 as
 * written. It is deliberately a plain constant and not configuration: nobody has
 * a reason yet to want a different number, and inventing a setting would imply a
 * baseline that was never there. If a real GitHub post-back path ever lands,
 * this is the value it should either match or replace.
 *
 * The user is always told when it truncated a post — a silent cap is what turns
 * "the review said N things" into "the merge request shows 20", with nothing on
 * the screen to explain the difference.
 */
export const POST_BACK_NOTE_CAP = 20;

/**
 * Which findings survive the cap when there are more than `POST_BACK_NOTE_CAP`.
 * Most severe first, so a truncated post keeps what matters — dropping by
 * arbitrary row order would sometimes publish twenty suggestions and drop a
 * critical.
 */
export const POST_BACK_SEVERITY_ORDER = ['CRITICAL', 'WARNING', 'SUGGESTION'] as const;
