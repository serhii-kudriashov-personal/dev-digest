/**
 * Public constants for the multi-agent review slice (SPEC-05). This file is
 * NOT in `SLICE_PRIVATE` (`backend-onion-architecture` §13), so any other
 * slice may import it directly — the sanctioned cross-slice channel for a
 * literal (`server/INSIGHTS.md` 2026-08-17).
 */

/**
 * NFR-3's hard cap on how many agents one multi-agent run may target.
 * Mirrored as a literal in `vendor/shared/contracts/observability.ts`'s
 * `MultiAgentStartRequest` — ring 0 imports only `zod`, so it cannot import
 * this constant (`shared-is-a-leaf`).
 */
export const MAX_AGENTS_PER_RUN = 8;

/** NFR-3: findings shown per lane; `AgentLane.findings_total` carries the true count. */
export const MAX_LANE_FINDINGS = 50;

/** NFR-3: grouped locations shown in the disagreement panel; `locations_total` carries the true count. */
export const MAX_LOCATIONS = 50;

/**
 * The start route fans out to up to `MAX_AGENTS_PER_RUN` paid model calls per
 * call — mirrors `reviews/routes.ts`'s `/pulls/:id/review` limit, the
 * precedent for a route that fans out to paid model calls.
 */
export const MULTI_AGENT_RATE_LIMIT = { max: 10, timeWindow: '1 minute' } as const;
