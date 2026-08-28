/* hooks/ci.ts — React Query hooks for Export to CI (L07, SPEC-05): generating
   and installing the CI export bundle, the CI Runs list, an agent's own
   installations, and the ingest refresh. */
"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import type { CiExport, CiExportInputBody, CiInstallation, CiRun } from "@devdigest/shared";

const ciRunsKey = () => ["ci-runs"];
const ciInstallationsKey = (agentId: string | null | undefined) => ["ci-installations", agentId];

/** Every run in the workspace, newest first — no pagination in v1 (AC-28…AC-32). */
export function useCiRuns() {
  return useQuery({
    queryKey: ciRunsKey(),
    queryFn: () => api.get<CiRun[]>("/ci-runs"),
    // Retries stay at their default (never disabled here) — a freshly
    // created agent's installations/runs list must not cache a transient
    // failure as a permanent miss (`client/INSIGHTS.md` 2026-08-09).
  });
}

/** One agent's own CI installations (AC-22, AC-33). */
export function useCiInstallations(agentId: string | null | undefined) {
  return useQuery({
    queryKey: ciInstallationsKey(agentId),
    queryFn: () => api.get<CiInstallation[]>(`/agents/${agentId}/ci-installations`),
    enabled: !!agentId,
  });
}

/** `action: 'files'` — the wizard's Preview step. No GitHub call, no
 *  installation written (AC-3, AC-4). */
export function useExportPreview() {
  return useMutation({
    mutationFn: ({ agentId, input }: { agentId: string; input: Omit<CiExportInputBody, "action"> }) =>
      api.post<CiExport>(`/agents/${agentId}/export-ci`, { ...input, action: "files" }),
  });
}

/** `action: 'open_pr'` — the wizard's Install step. On success, invalidates
 *  BOTH the agent's installations and the CI Runs list, which is the whole
 *  mechanism behind AC-22's "visible without a manual reload". */
export function useInstallCi() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ agentId, input }: { agentId: string; input: Omit<CiExportInputBody, "action"> }) =>
      api.post<CiExport>(`/agents/${agentId}/export-ci`, { ...input, action: "open_pr" }),
    onSuccess: (_result, { agentId }) => {
      qc.invalidateQueries({ queryKey: ciInstallationsKey(agentId) });
      qc.invalidateQueries({ queryKey: ciRunsKey() });
    },
  });
}

/** Pull recent GitHub Actions runs for every installation (AC-25). */
export function useRefreshCiRuns() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<{ ingested: number }>("/ci/refresh"),
    onSuccess: () => qc.invalidateQueries({ queryKey: ciRunsKey() }),
  });
}
