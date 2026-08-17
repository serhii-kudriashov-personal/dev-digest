/* hooks/brief.ts — React Query hooks for the PR Risk Brief (SPEC-02). */
"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import type { BriefGenerationResult, PrRiskBriefRecord } from "@devdigest/shared";

const key = (prId: string | null | undefined) => ["pr-brief", prId];

/**
 * The stored brief for a PR.
 *
 * `retry: false` because a 404 is the NORMAL "never generated" answer, not a
 * failure — retrying it three times just delays the empty state
 * (`client/INSIGHTS.md` 2026-08-09).
 */
export function usePrBrief(prId: string | null | undefined) {
  return useQuery({
    queryKey: key(prId),
    queryFn: () => api.get<PrRiskBriefRecord>(`/pulls/${prId}/brief`),
    enabled: !!prId,
    retry: false,
  });
}

/**
 * Generate (or re-generate) the brief. `BriefGenerationResult` is a
 * discriminated union — `too_large` / `failed` / `not_configured` are answered
 * states, not thrown errors, so the mutation always resolves and the caller
 * reads `result.state` to pick the card's presentation.
 *
 * Only an `'ok'` result is written into the query cache — the other states
 * carry no `PrRiskBriefRecord` to write, and AC-38 requires the PREVIOUS stored
 * brief to stay exactly as it was on a failure.
 */
export function useGenerateBrief(prId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (opts?: { force?: boolean }) =>
      api.post<BriefGenerationResult>(`/pulls/${prId}/brief`, opts ?? {}),
    onSuccess: (result) => {
      if (result.state === "ok") qc.setQueryData(key(prId), result.brief);
    },
  });
}
