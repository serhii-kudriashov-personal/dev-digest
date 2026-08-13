/* hooks/blast.ts — React Query hook for the Blast Radius map (L06). */
"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "../api";
import type { BlastRadiusResponse } from "@devdigest/shared";

/**
 * What else this PR's diff could touch: the symbols its changed files declare,
 * who calls them, and which endpoints/crons those callers serve.
 *
 * The endpoint is deterministic and cheap — served from the persisted repo-intel
 * index, no model call, no code parsed, nothing persisted — so there is no
 * mutation in this file.
 *
 * Two facts about staleness, and NO claim of a mitigation this code does not
 * implement (`client/INSIGHTS.md` 2026-08-09):
 *
 * - **A repo-intel resync is the only user action that can change this answer**,
 *   and `useResyncRepoIntel` invalidates the `["blast"]` prefix for that reason.
 *   Resync is asynchronous (the route answers 202 and the job runs after), so the
 *   refetch that invalidation triggers may still report the OLD `state`; the card
 *   corrects itself on a later refetch. Nothing here waits for the job.
 * - **No review action affects this key.** Findings, runs and reviews are not
 *   inputs to the blast radius, so the `["reviews", prId]` invalidations in
 *   `hooks/reviews.ts` are deliberately not paired with this one.
 */
export function useBlastRadius(prId: string | null | undefined) {
  return useQuery({
    queryKey: ["blast", prId],
    queryFn: () => api.get<BlastRadiusResponse>(`/pulls/${prId}/blast`),
    enabled: !!prId,
  });
}
