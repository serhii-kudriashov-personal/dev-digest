/* hooks/conventions.ts — React Query hooks for the Conventions extractor. */
"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import type {
  ConventionCandidate,
  ConventionSkillDraft,
  ConventionsPayload,
  ConventionStatus,
} from "@devdigest/shared";

const key = (repoId: string | null | undefined) => ["conventions", repoId];

export function useConventions(repoId: string | null | undefined) {
  return useQuery({
    queryKey: key(repoId),
    queryFn: () => api.get<ConventionsPayload>(`/repos/${repoId}/conventions`),
    enabled: !!repoId,
  });
}

/**
 * The scan is synchronous and makes one model call, so it can take a while. The
 * response already carries the new candidates plus the scan row, so it is written
 * straight into the cache rather than triggering a refetch.
 */
export function useExtractConventions(repoId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (opts?: { provider?: string; model?: string }) =>
      api.post<ConventionsPayload>(`/repos/${repoId}/conventions/extract`, opts ?? {}),
    onSuccess: (data) => qc.setQueryData(key(repoId), data),
  });
}

/** Edit the rule text. Evidence and confidence are not writable. */
export function useUpdateConventionRule(repoId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, rule }: { id: string; rule: string }) =>
      api.patch<ConventionCandidate>(`/conventions/${id}`, { rule }),
    onSuccess: (updated) => patchCandidate(qc, repoId, [updated]),
  });
}

/** Accept, reject or return to pending — one id or many. */
export function useSetConventionStatus(repoId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ ids, status }: { ids: string[]; status: ConventionStatus }) =>
      api.patch<ConventionCandidate[]>(`/repos/${repoId}/conventions/status`, { ids, status }),
    onSuccess: (updated) => patchCandidate(qc, repoId, updated),
  });
}

export function useConventionSkillDraft(repoId: string | null | undefined) {
  return useMutation({
    mutationFn: (conventionIds: string[]) =>
      api.post<ConventionSkillDraft>(`/repos/${repoId}/conventions/skill-draft`, {
        convention_ids: conventionIds,
      }),
  });
}

/**
 * Merge the rows the server returned into the cached payload rather than
 * invalidating it: a re-fetch would drop `last_scan` for a beat and make the
 * header flicker, and the response is already authoritative for these rows.
 */
function patchCandidate(
  qc: ReturnType<typeof useQueryClient>,
  repoId: string | null | undefined,
  updated: ConventionCandidate[],
) {
  const byId = new Map(updated.map((c) => [c.id, c] as const));
  qc.setQueryData<ConventionsPayload>(key(repoId), (prev) =>
    prev
      ? { ...prev, candidates: prev.candidates.map((c) => byId.get(c.id) ?? c) }
      : prev,
  );
}
