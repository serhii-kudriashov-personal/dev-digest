/* hooks/reviews.ts — React Query + SSE hooks for the A2 reviewer.
   Run a review, stream RunEvents live, act on findings. */
"use client";

import React from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, API_BASE } from "../api";
import { notify } from "../toast";
import type {
  FindingActionKind,
  PrReviewComment,
  ReviewPostBack,
  ReviewRecord,
  ReviewRunResponse,
  RunEvent,
  RunSummary,
} from "@devdigest/shared";

// ---- Active (in-flight) runs — server-side source of truth ----
export interface ActiveRun {
  run_id: string;
  agent_id: string | null;
  agent_name: string | null;
  ran_at: string | null;
}

/** In-flight runs for a PR, from the server (agent_runs where status='running').
   Survives reloads/devices; polls while anything is running so it self-clears. */
export function usePrActiveRuns(prId: string | null | undefined) {
  return useQuery({
    queryKey: ["pr-active-runs", prId],
    queryFn: () => api.get<ActiveRun[]>(`/pulls/${prId}/runs/active`),
    enabled: !!prId,
    refetchInterval: (query) => ((query.state.data?.length ?? 0) > 0 ? 4000 : false),
  });
}

// ---- Full run history for a PR (every agent_runs row, any status) ----
/** All runs for a PR — done, failed (with error), cancelled, running. Survives
   reload (DB-backed). Polls while anything is running so it self-updates. */
export function usePrRuns(prId: string | null | undefined) {
  return useQuery({
    queryKey: ["pr-runs", prId],
    queryFn: () => api.get<RunSummary[]>(`/pulls/${prId}/runs`),
    enabled: !!prId,
    refetchInterval: (query) =>
      (query.state.data ?? []).some((r) => r.status === "running") ? 4000 : false,
  });
}

// ---- Persisted reviews + findings for a PR ----
export function usePrReviews(prId: string | null | undefined) {
  return useQuery({
    queryKey: ["reviews", prId],
    queryFn: () => api.get<ReviewRecord[]>(`/pulls/${prId}/reviews`),
    enabled: !!prId,
  });
}

/** Delete one run from the PR's run history (+ its trace). */
export function useDeleteRun(prId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (runId: string) => api.del<{ ok: boolean }>(`/runs/${runId}`),
    // Deleting a run also deletes the review it produced (server-side), so drop
    // both the timeline and the Review Runs list from cache. Smart Diff's
    // `finding_lines` feed the per-file badges, so it goes stale too.
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["pr-runs", prId] });
      qc.invalidateQueries({ queryKey: ["reviews", prId] });
      qc.invalidateQueries({ queryKey: ["smart-diff", prId] });
    },
  });
}

/** Request cancellation of an in-flight run (takes effect at the next step). */
export function useCancelRun(prId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (runId: string) => api.post<{ ok: boolean }>(`/runs/${runId}/cancel`),
    // Without this the button appears to do nothing until `usePrActiveRuns`
    // happens to poll (up to 4s later), which reads as a broken control.
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["pr-active-runs", prId] });
      qc.invalidateQueries({ queryKey: ["pr-runs", prId] });
    },
  });
}

/** Delete a whole review run (one agent's pass) + its findings. */
export function useDeleteReview(prId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (reviewId: string) => api.del<{ ok: boolean }>(`/reviews/${reviewId}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["reviews", prId] });
      qc.invalidateQueries({ queryKey: ["smart-diff", prId] });
    },
  });
}

// ---- Inline review comments on the "Files changed" tab (proxied to GitHub) --
/** Existing GitHub PR review comments, fetched live. */
export function usePrComments(prId: string | null | undefined) {
  return useQuery({
    queryKey: ["pr-comments", prId],
    queryFn: () => api.get<PrReviewComment[]>(`/pulls/${prId}/comments`),
    enabled: !!prId,
  });
}

export interface CreateCommentInput {
  path: string;
  line: number;
  side?: "LEFT" | "RIGHT";
  body: string;
  in_reply_to?: string;
}

/** Post one inline comment (or reply) to GitHub; refreshes the thread list. */
export function useCreatePrComment(prId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateCommentInput) =>
      api.post<PrReviewComment>(`/pulls/${prId}/comments`, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["pr-comments", prId] }),
  });
}

// ---- Posting a run's review back onto its change request ----
/** Query key for one run's post-back outcome — shared by the read and the
 *  mutation that records a new one, so they cannot go stale against each other. */
function postBackKey(prId: string | null | undefined, runId: string | null | undefined) {
  return ["post-back", prId, runId] as const;
}

/**
 * The recorded outcome of posting one run's review, or `null` when this run has
 * never been posted (SPEC-06 — AC-39, NFR-12).
 *
 * Read from the server rather than kept beside the mutation on purpose: NFR-12
 * asks for the outcome to still be visible after a page reload, and the row
 * behind `GET /pulls/:id/post-review/:runId` is the only thing that survives
 * one. A run that was never posted answers 200 with `null`, not a 404, so
 * nothing here caches a miss (`client/INSIGHTS.md` 2026-08-09).
 */
export function usePostBackOutcome(
  prId: string | null | undefined,
  runId: string | null | undefined,
) {
  return useQuery({
    queryKey: postBackKey(prId, runId),
    queryFn: () => api.get<ReviewPostBack | null>(`/pulls/${prId}/post-review/${runId}`),
    enabled: !!prId && !!runId,
  });
}

/**
 * Publish one run's review onto the change request it reviewed.
 *
 * The server answers **200 with a stated outcome** for every publication that
 * did not fully work out — a refused approval, an offline instance, a post that
 * stopped halfway — and only an unknown pull or run is an error. So the result
 * of this mutation is `data.outcome`, never `isError`; a caller that branches on
 * `isError` would report a posted-but-not-approved review as a failure.
 */
export function usePostReview(prId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (runId: string) =>
      api.post<ReviewPostBack>(`/pulls/${prId}/post-review`, { run_id: runId }),
    onSuccess: (data, runId) => {
      // The response IS the newly recorded row, so seed it before invalidating —
      // otherwise the panel flickers back to "not posted yet" until the refetch
      // lands.
      qc.setQueryData(postBackKey(prId, runId), data);
      qc.invalidateQueries({ queryKey: postBackKey(prId, runId) });
    },
  });
}

// ---- Run a review (all enabled agents or a specific agent) ----
export interface RunReviewInput {
  prId: string;
  agentId?: string;
  all?: boolean;
}

export function useRunReview() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ prId, agentId, all }: RunReviewInput) =>
      api.post<ReviewRunResponse>(`/pulls/${prId}/review`, {
        ...(agentId ? { agentId } : {}),
        ...(all ? { all } : {}),
      }),
    onSuccess: (_d, { prId }) => {
      qc.invalidateQueries({ queryKey: ["reviews", prId] });
      // Smart Diff's `finding_lines` are what the per-file badges count, so a
      // finished run must refresh them too — otherwise the severity chips (from
      // `usePrReviews`) update and the badges beside them do not.
      qc.invalidateQueries({ queryKey: ["smart-diff", prId] });
      // The run history and the spinner both self-heal on their 4s poll, but
      // only after a visible lag; invalidating makes the finished run land at
      // once.
      qc.invalidateQueries({ queryKey: ["pr-runs", prId] });
      qc.invalidateQueries({ queryKey: ["pr-active-runs", prId] });
      // `useRunTrace` is fetched with `retry: false`, and `run_traces` does not
      // exist until the very end of the run — so a drawer opened WHILE the run
      // was live has cached a 404 that nothing would ever clear, and the log
      // stayed blank until the tab was remounted. Safe to fire here and only
      // here: this mutation resolves after the server has persisted the trace
      // (`run-executor.ts` saves it at :417 and returns at :420), whereas
      // `useCancelRun` resolves while the run is still winding down and would
      // just cache another miss. Prefix key — `{ all: true }` fans out to one
      // run per agent, so there is no single id to target.
      qc.invalidateQueries({ queryKey: ["run-trace"] });
    },
  });
}

// ---- Finding actions (accept/dismiss) ----
export function useFindingAction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      findingId,
      action,
      reply,
      prId: _prId,
    }: {
      findingId: string;
      action: FindingActionKind;
      reply?: string;
      prId?: string;
    }) =>
      api.post<{ finding: ReviewRecord["findings"][number]; memoryId?: string }>(
        `/findings/${findingId}/${action}`,
        reply ? { reply } : undefined,
      ),
    onSuccess: (_d, { prId }) => {
      if (prId) {
        qc.invalidateQueries({ queryKey: ["reviews", prId] });
        qc.invalidateQueries({ queryKey: ["smart-diff", prId] });
      }
    },
  });
}

/**
 * Subscribe to a run's SSE event stream. Returns the accumulated RunEvents and a
 * `running` flag (true until the stream closes). Live status for the
 * AgentPicker / Live Log. Multiple runIds are subscribed in parallel.
 */
export function useRunEvents(runIds: string[]) {
  const [events, setEvents] = React.useState<RunEvent[]>([]);
  const [running, setRunning] = React.useState(false);
  const key = runIds.join(",");

  React.useEffect(() => {
    if (runIds.length === 0) return;
    setEvents([]);
    setRunning(true);
    const sources: EventSource[] = [];
    let open = runIds.length;

    for (const runId of runIds) {
      const es = new EventSource(`${API_BASE}/runs/${runId}/events`);
      const onMsg = (ev: MessageEvent) => {
        try {
          const parsed = JSON.parse(ev.data) as RunEvent;
          setEvents((prev) => [...prev, parsed]);
          // Runtime agent failures arrive as SSE `error` events (not as a
          // mutation/query error), so the global error toast never sees them —
          // surface them here so the user gets a notification without a reload.
          if (parsed.kind === "error" && parsed.msg) notify.error(parsed.msg);
        } catch {
          /* ignore non-JSON keepalive frames (and dataless native error events) */
        }
      };
      // The server tags events with kind as the SSE `event:` name AND emits them
      // as default messages too in some clients — listen broadly.
      es.onmessage = onMsg;
      for (const kind of ["info", "tool", "result", "error"]) {
        es.addEventListener(kind, onMsg as EventListener);
      }
      es.onerror = () => {
        es.close();
        open -= 1;
        if (open <= 0) setRunning(false);
      };
      sources.push(es);
    }

    return () => {
      for (const es of sources) es.close();
      setRunning(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return { events, running };
}
