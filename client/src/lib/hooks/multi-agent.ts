/* hooks/multi-agent.ts — React Query hooks for Multi-Agent Review (SPEC-05).
   Start a run, read its record (Columns and Tabs both read the SAME hook —
   AC-28), the run history for a PR, and the per-agent history behind the
   Configure-run screen's pre-run estimate. */
"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import type {
  AgentHistoryRow,
  MultiAgentRunResult,
  MultiAgentRunSummary,
} from "@devdigest/shared";

/** Run history for a PR, newest first. */
export function useMultiAgentRuns(prId: string | null | undefined) {
  return useQuery({
    queryKey: ["multi-agent-runs", prId],
    queryFn: () => api.get<MultiAgentRunSummary[]>(`/pulls/${prId}/multi-agent-runs`),
    enabled: !!prId,
  });
}

/**
 * One run's full results — lanes, grouped locations, totals. Feeds BOTH the
 * Columns and the Tabs result modes; do not add a second query key for Tabs
 * or the two panels go stale asymmetrically (`client/INSIGHTS.md` 2026-08-09).
 *
 * No `retry: false` — the run record exists before any member completes, but
 * a caller may render this hook a moment before that write lands, and a
 * disabled retry would cache that 404 forever (`client/INSIGHTS.md`
 * 2026-08-09). AC-44's empty state comes from an empty list, not a cached 404.
 *
 * Polls while any lane is still `queued`/`running` (AC-29) — member execution
 * is sequential (AC-14), so a lane's status only advances between fetches;
 * plain client polling over the existing `GET /multi-agent-runs/:id`, same
 * shape as `usePrRuns`/`usePrActiveRuns`. Off the moment every lane has
 * settled, so a finished run stops polling on its own.
 */
export function useMultiAgentRun(runId: string | null | undefined) {
  return useQuery({
    queryKey: ["multi-agent-run", runId],
    queryFn: () => api.get<MultiAgentRunResult>(`/multi-agent-runs/${runId}`),
    enabled: !!runId,
    refetchInterval: (query) =>
      (query.state.data?.lanes ?? []).some((l) => l.status === "queued" || l.status === "running")
        ? 2500
        : false,
  });
}

/** Every agent in the workspace, enabled or not, with its last completed run
 *  — the Configure-run screen's pre-run estimate and per-agent history card. */
export function useAgentHistory() {
  return useQuery({
    queryKey: ["multi-agent-agent-history"],
    queryFn: () => api.get<AgentHistoryRow[]>("/multi-agent/agent-history"),
  });
}

/** Start a multi-agent run. Returns the record before any member completes
 *  (NFR-2) — invalidate the PR's run lists so the header and history refresh. */
export function useStartMultiAgentRun() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ prId, agentIds }: { prId: string; agentIds: string[] }) =>
      api.post<MultiAgentRunSummary>(`/pulls/${prId}/multi-agent-runs`, {
        agent_ids: agentIds,
      }),
    onSuccess: (_d, { prId }) => {
      qc.invalidateQueries({ queryKey: ["multi-agent-runs", prId] });
      qc.invalidateQueries({ queryKey: ["pr-active-runs", prId] });
      qc.invalidateQueries({ queryKey: ["pr-runs", prId] });
    },
  });
}
