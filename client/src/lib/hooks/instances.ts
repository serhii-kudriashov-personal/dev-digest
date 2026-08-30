/* hooks/instances.ts — registered forge instances (SPEC-06 — AC-1, AC-7, AC-12).
   Same shape as the other domain files: every call goes through `api` so a
   failure normalizes into `ApiError`, and every mutation invalidates its keys. */
"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import type { GitInstance, GitInstanceInput, InstanceTestResult } from "../types";

/** Query key for the registered-instance list. */
export const INSTANCES_KEY = ["instances"] as const;

/** GET /instances — every instance the workspace has registered (AC-1, AC-7). */
export function useInstances() {
  return useQuery({
    queryKey: INSTANCES_KEY,
    queryFn: () => api.get<GitInstance[]>("/instances"),
  });
}

/**
 * POST /instances — register, verify and probe in one call.
 *
 * Invalidates BOTH `["instances"]` and `["repos"]`. The instances panel and the
 * repository switcher are two panels of one screen reading two query keys, and
 * they otherwise go stale asymmetrically: a newly registered instance is what
 * makes a repository importable from it, so the repository list's "which hosts
 * can I import from" answer changes at the same moment
 * (`client/INSIGHTS.md` 2026-08-09).
 */
export function useRegisterInstance() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: GitInstanceInput) => api.post<GitInstance>("/instances", input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: INSTANCES_KEY });
      qc.invalidateQueries({ queryKey: ["repos"] });
    },
  });
}

/**
 * POST /instances/:id/test — re-verify one instance (AC-12).
 *
 * The result is returned to the caller rather than written into the cache under
 * a per-row key: the screen attributes it by `instance_id`, so testing one row
 * leaves every other row's last result exactly as it was. The list is still
 * invalidated, because a successful test refreshes `version`, `edition`,
 * `approval_capability` and `verified_at` on the row itself.
 */
export function useTestInstance() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (instanceId: string) =>
      api.post<InstanceTestResult>(`/instances/${instanceId}/test`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: INSTANCES_KEY });
    },
  });
}

/** DELETE /instances/:id. Repositories are re-read too — one may have been imported from it. */
export function useDeleteInstance() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (instanceId: string) =>
      api.del<{ deleted: string }>(`/instances/${instanceId}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: INSTANCES_KEY });
      qc.invalidateQueries({ queryKey: ["repos"] });
    },
  });
}
