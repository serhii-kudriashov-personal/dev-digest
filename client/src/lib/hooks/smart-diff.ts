/* hooks/smart-diff.ts — React Query hook for the reviewer-ordered diff (L04). */
"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "../api";
import type { SmartDiffResponse } from "@devdigest/shared";

/**
 * The PR's changed files, grouped and ordered by risk.
 *
 * The endpoint is deterministic and cheap — no model call, nothing persisted —
 * so there is no mutation in this file.
 *
 * `finding_lines` IS load-bearing on the client: `SmartDiffViewer` counts it for
 * the per-file "N findings" badge. So this key is invalidated alongside every
 * `["reviews", prId]` invalidation in `hooks/reviews.ts` — run completed, review
 * deleted, run deleted, finding accepted/dismissed. Drop one of those and the
 * severity chips (which come from `usePrReviews`) refresh while the badges
 * beside them keep showing the previous run's counts, for up to `staleTime`.
 * Add any new `["reviews", prId]` invalidation to this key too.
 */
export function useSmartDiff(prId: string | null | undefined) {
  return useQuery({
    queryKey: ["smart-diff", prId],
    queryFn: () => api.get<SmartDiffResponse>(`/pulls/${prId}/smart-diff`),
    enabled: !!prId,
  });
}
