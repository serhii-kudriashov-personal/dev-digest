/* hooks/eval.ts — React Query hooks for the Eval Pipeline (L06, SPEC-04):
   case creation from a finding, running an agent's case set, comparing two
   runs, promoting a historical agent version, and the cross-agent dashboard. */
"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import type {
  EvalCaseInputBody,
  EvalCaseRecord,
  EvalComparison,
  EvalDashboard,
  EvalPromoteResult,
  EvalRunRecord,
  EvalSetRun,
  EvalTrendPoint,
} from "@devdigest/shared";

const casesKey = (agentId: string | null | undefined) => ["eval-cases", agentId];
const caseKey = (caseId: string | null | undefined) => ["eval-case", caseId];
const runsKey = (agentId: string | null | undefined) => ["eval-runs", agentId];
const runKey = (setRunId: string | null | undefined) => ["eval-run", setRunId];
const runCasesKey = (setRunId: string | null | undefined) => ["eval-run-cases", setRunId];
const trendKey = (agentId: string | null | undefined) => ["eval-trend", agentId];
const dashboardKey = () => ["eval-dashboard"];
const comparisonKey = (a: string | null | undefined, b: string | null | undefined) => [
  "eval-comparison",
  a,
  b,
];

/** Every eval-affecting surface that must go stale together — three screens
 *  read overlapping data (the agent's Evals tab, the cross-agent dashboard,
 *  and the finding card), so a single mutation invalidates the full fan-out
 *  or one of them renders stale data (`client/INSIGHTS.md` 2026-08-09). */
function invalidateEvalSurfaces(
  qc: ReturnType<typeof useQueryClient>,
  agentId: string | null | undefined,
) {
  qc.invalidateQueries({ queryKey: casesKey(agentId) });
  qc.invalidateQueries({ queryKey: runsKey(agentId) });
  qc.invalidateQueries({ queryKey: trendKey(agentId) });
  qc.invalidateQueries({ queryKey: dashboardKey() });
}

// ===========================================================================
// Cases
// ===========================================================================

export function useEvalCases(agentId: string | null | undefined) {
  return useQuery({
    queryKey: casesKey(agentId),
    queryFn: () => api.get<EvalCaseRecord[]>(`/agents/${agentId}/eval-cases`),
    enabled: !!agentId,
  });
}

export function useEvalCase(caseId: string | null | undefined) {
  return useQuery({
    queryKey: caseKey(caseId),
    queryFn: () => api.get<EvalCaseRecord>(`/eval-cases/${caseId}`),
    enabled: !!caseId,
  });
}

/** AC-1…AC-9: freeze a judged finding into a case, from the PR view. */
export function useCreateEvalCaseFromFinding() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (findingId: string) =>
      api.post<{ case: EvalCaseRecord; secret_warning: boolean }>(
        `/findings/${findingId}/eval-case`,
      ),
    onSuccess: (result) => invalidateEvalSurfaces(qc, result.case.owner_id),
  });
}

export function useCreateEvalCase(agentId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Omit<EvalCaseInputBody, "owner_kind" | "owner_id">) =>
      api.post<EvalCaseRecord>(`/agents/${agentId}/eval-cases`, input),
    onSuccess: () => invalidateEvalSurfaces(qc, agentId),
  });
}

export function useUpdateEvalCase(agentId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ caseId, patch }: { caseId: string; patch: Partial<EvalCaseInputBody> }) =>
      api.put<EvalCaseRecord>(`/eval-cases/${caseId}`, patch),
    onSuccess: (data) => {
      qc.setQueryData(caseKey(data.id), data);
      invalidateEvalSurfaces(qc, agentId);
    },
  });
}

export function useDeleteEvalCase(agentId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (caseId: string) => api.del<{ ok: boolean }>(`/eval-cases/${caseId}`),
    onSuccess: (_d, caseId) => {
      qc.removeQueries({ queryKey: caseKey(caseId) });
      invalidateEvalSurfaces(qc, agentId);
    },
  });
}

/** AC-32: a single-case run — no `eval_set_runs` row, so only the case and
 *  the case list need to go stale. */
export function useRunEvalCase(agentId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (caseId: string) => api.post<EvalRunRecord>(`/eval-cases/${caseId}/run`),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: caseKey(data.case_id) });
      qc.invalidateQueries({ queryKey: casesKey(agentId) });
    },
  });
}

// ===========================================================================
// Set runs
// ===========================================================================

export function useEvalRuns(agentId: string | null | undefined) {
  return useQuery({
    queryKey: runsKey(agentId),
    queryFn: () => api.get<EvalSetRun[]>(`/agents/${agentId}/eval-runs`),
    enabled: !!agentId,
  });
}

/**
 * A4: the client POLLS a set run's progress rather than subscribing to an
 * event stream — no eval progress is published on `runBus` server-side.
 * Polling stops the moment the run leaves `running`, so a finished run never
 * refetches again.
 */
export function useEvalRun(setRunId: string | null | undefined) {
  return useQuery({
    queryKey: runKey(setRunId),
    queryFn: () => api.get<EvalSetRun>(`/eval-runs/${setRunId}`),
    enabled: !!setRunId,
    refetchInterval: (query) => (query.state.data?.status === "running" ? 1000 : false),
  });
}

/** AC-47: an agent's own metric trend — complete runs only, capped, labelled
 *  per series (never colour alone) by the caller. */
export function useEvalTrend(agentId: string | null | undefined) {
  return useQuery({
    queryKey: trendKey(agentId),
    queryFn: () => api.get<EvalTrendPoint[]>(`/agents/${agentId}/eval-trend`),
    enabled: !!agentId,
  });
}

export function useEvalRunCases(setRunId: string | null | undefined) {
  return useQuery({
    queryKey: runCasesKey(setRunId),
    queryFn: () => api.get<EvalRunRecord[]>(`/eval-runs/${setRunId}/cases`),
    enabled: !!setRunId,
  });
}

/** AC-17…AC-31: run an agent's whole case set (or a named subset). */
export function useRunEvalSet(agentId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (caseIds?: string[]) =>
      api.post<EvalSetRun>(`/agents/${agentId}/eval-runs`, { case_ids: caseIds ?? null }),
    onSuccess: (data) => {
      qc.setQueryData(runKey(data.id), data);
      invalidateEvalSurfaces(qc, agentId);
    },
  });
}

export function useCancelEvalRun(agentId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (setRunId: string) => api.post<{ ok: boolean }>(`/eval-runs/${setRunId}/cancel`),
    onSuccess: (_d, setRunId) => {
      qc.invalidateQueries({ queryKey: runKey(setRunId) });
      invalidateEvalSurfaces(qc, agentId);
    },
  });
}

/** A12: run every enabled agent's set under the concurrency limit. */
export function useRunAllEvals() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<EvalSetRun[]>("/eval-runs"),
    onSuccess: () => qc.invalidateQueries({ queryKey: dashboardKey() }),
  });
}

// ===========================================================================
// Compare + dashboard + promote
// ===========================================================================

/** AC-33…AC-37. Requires exactly two ids — the query stays disabled otherwise
 *  (AC-34's "exactly two required" state is UI, not a request that 422s). */
export function useEvalComparison(a: string | null | undefined, b: string | null | undefined) {
  return useQuery({
    queryKey: comparisonKey(a, b),
    queryFn: () => api.get<EvalComparison>(`/eval-comparison?a=${a}&b=${b}`),
    enabled: !!a && !!b,
  });
}

export function useEvalDashboard() {
  return useQuery({
    queryKey: dashboardKey(),
    queryFn: () => api.get<EvalDashboard>("/eval-dashboard"),
  });
}

/** AC-38, AC-39, A10. Invalidates the agent + its version history alongside
 *  every eval surface — a promotion is a config change like any other. */
export function usePromoteAgentVersion() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ agentId, version }: { agentId: string; version: number }) =>
      api.post<EvalPromoteResult>(`/agents/${agentId}/versions/${version}/promote`),
    onSuccess: (result, { agentId }) => {
      qc.invalidateQueries({ queryKey: ["agent", agentId] });
      qc.invalidateQueries({ queryKey: ["agent-versions", agentId] });
      invalidateEvalSurfaces(qc, agentId);
      qc.setQueryData(["agent", agentId], result.agent);
    },
  });
}
