/* hooks/intent.ts — React Query hooks for the derived PR intent (L03). */
"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import type { PrIntentRecord } from "@devdigest/shared";

const key = (prId: string | null | undefined) => ["pr-intent", prId];

/**
 * The stored intent for a PR.
 *
 * `retry: false` because a 404 is the NORMAL "not derived yet" answer, not a
 * failure — retrying it three times just delays the empty state.
 */
export function usePrIntent(prId: string | null | undefined) {
  return useQuery({
    queryKey: key(prId),
    queryFn: () => api.get<PrIntentRecord>(`/pulls/${prId}/intent`),
    enabled: !!prId,
    retry: false,
  });
}

/**
 * Derive (or re-derive) the intent. The call is synchronous and spends one
 * model call, so the response is authoritative for this key — write it straight
 * into the cache rather than invalidating and paying for a second round trip.
 */
export function useDeriveIntent(prId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (opts?: { force?: boolean }) =>
      api.post<PrIntentRecord>(`/pulls/${prId}/intent`, opts ?? {}),
    onSuccess: (data) => qc.setQueryData(key(prId), data),
  });
}
