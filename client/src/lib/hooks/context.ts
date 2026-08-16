/* hooks/context.ts — Project Context (SPEC-01).

   Markdown discovered in a repo's local mirror, previewed read-only, and
   attached to agents and skills in an explicit order. Every read and write on
   this feature goes through here; no component fetches. */
"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import type { ContextAttachment, ContextDocContent, ContextListing } from "@devdigest/shared";

/**
 * How often the listing re-asks while the repository has no mirror yet.
 *
 * This poll is the whole of "the tab left open moves from not-synced to a
 * populated list with no reload". It works because the endpoint answers 200
 * with `state: 'not_synced'` rather than 404: a 404 under `retry: false` would
 * be the cached value for the rest of the session and the tab would never
 * recover (client/INSIGHTS.md 2026-08-09). Nothing here sets `retry: false`.
 */
const NOT_SYNCED_POLL_MS = 5_000;

/** The document listing — a discriminated union on `state`, never an error. */
export function useContextListing(repoId: string | null | undefined) {
  return useQuery({
    queryKey: ["context", repoId],
    queryFn: () => api.get<ContextListing>(`/repos/${repoId}/context`),
    enabled: !!repoId,
    refetchInterval: (query) =>
      query.state.data?.state === "not_synced" ? NOT_SYNCED_POLL_MS : false,
  });
}

/**
 * One document's text. Content never rides the listing — it is its own request,
 * fired only once a document is selected.
 */
export function useContextDoc(repoId: string | null | undefined, path: string | null | undefined) {
  return useQuery({
    queryKey: ["context-doc", repoId, path],
    queryFn: () =>
      api.get<ContextDocContent>(
        `/repos/${repoId}/context/doc?path=${encodeURIComponent(path ?? "")}`,
      ),
    enabled: !!repoId && !!path,
  });
}

/**
 * Re-scan the mirror. A re-scan, not a re-index: there is no Markdown index.
 * The response is the fresh listing, so it replaces the cached one directly
 * rather than triggering a second round trip.
 */
export function useRefreshContext() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (repoId: string) => api.post<ContextListing>(`/repos/${repoId}/context/refresh`),
    onSuccess: (data, repoId) => {
      qc.setQueryData(["context", repoId], data);
      // The list and the open preview are two query keys on one screen. A
      // re-scan that picks up an edited document would otherwise refresh the row
      // and leave the body beside it showing the previous text.
      qc.invalidateQueries({ queryKey: ["context-doc", repoId] });
    },
  });
}

/** Change which directories are searched for documents, per repository. */
export function useSetContextRoots() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ repoId, roots }: { repoId: string; roots: string[] }) =>
      api.put<{ roots: string[] }>(`/repos/${repoId}/context/roots`, { roots }),
    onSuccess: (_data, { repoId }) => {
      // Narrowing or widening the roots changes which documents exist, so the
      // listing is stale. Attachments are NOT touched by a roots change.
      qc.invalidateQueries({ queryKey: ["context", repoId] });
    },
  });
}

// ---- attachments (the agent editor's and the skill editor's Context tabs) ----

export function useAgentContextDocs(agentId: string | null | undefined) {
  return useQuery({
    queryKey: ["agent-context", agentId],
    queryFn: () => api.get<ContextAttachment[]>(`/agents/${agentId}/context-docs`),
    enabled: !!agentId,
  });
}

export function useSkillContextDocs(skillId: string | null | undefined) {
  return useQuery({
    queryKey: ["skill-context", skillId],
    queryFn: () => api.get<ContextAttachment[]>(`/skills/${skillId}/context-docs`),
    enabled: !!skillId,
  });
}

/**
 * Every mutation on this feature invalidates the SAME four keys, because one
 * attach touches four surfaces that are visible at once:
 *
 *   ["context"]        the document list, whose rows carry `agent_count`
 *   ["agent-context"]  the agent's ordered attachments
 *   ["skill-context"]  the skill's, since an agent inherits a skill's documents
 *   ["agents"]         the agents list, which renders a per-agent count
 *
 * The list's count and the owner's attachment list are two query keys on one
 * screen, and client/INSIGHTS.md (2026-08-09) records that such a pairing goes
 * stale asymmetrically — half the screen refreshes and half keeps the previous
 * numbers. The prefix form is deliberate: another agent's inherited set can
 * change from a skill edit, so there is no single id to target.
 */
function invalidateAttachmentSurfaces(qc: ReturnType<typeof useQueryClient>): void {
  qc.invalidateQueries({ queryKey: ["context"] });
  qc.invalidateQueries({ queryKey: ["agent-context"] });
  qc.invalidateQueries({ queryKey: ["skill-context"] });
  qc.invalidateQueries({ queryKey: ["agents"] });
}

/** The optimistic cache seed — order is the array index, exactly as the server re-numbers it. */
function seedAttachments(paths: string[]): ContextAttachment[] {
  return paths.map((path, order) => ({ path, order, missing: false }));
}

/**
 * Replace an agent's whole ordered document set. One endpoint covers attach,
 * detach and reorder, because all three are "here is the new list, in order".
 *
 * OPTIMISTIC on purpose, cloning `useSetAgentSkills`: reordering by drag or by
 * keyboard has to feel immediate, and writing the new order into the query
 * cache means the tab renders purely from server state — no local copy of the
 * ordered list, and so no Effect re-syncing one when the server answers.
 *
 * `onError` restoring `ctx.previous` is not only the save-failed path: an
 * over-limit replace is a 422, which arrives here like any other failure, so
 * the list returns to the order the server actually holds while the caller
 * renders `error.message`.
 */
export function useSetAgentContextDocs() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ agentId, paths }: { agentId: string; paths: string[] }) =>
      api.put<ContextAttachment[]>(`/agents/${agentId}/context-docs`, { paths }),
    onMutate: async ({ agentId, paths }) => {
      const key = ["agent-context", agentId];
      await qc.cancelQueries({ queryKey: key });
      const previous = qc.getQueryData<ContextAttachment[]>(key);
      qc.setQueryData<ContextAttachment[]>(key, seedAttachments(paths));
      return { previous };
    },
    onError: (_err, { agentId }, ctx) => {
      if (ctx?.previous) qc.setQueryData(["agent-context", agentId], ctx.previous);
    },
    onSuccess: (data, { agentId }) => {
      qc.setQueryData(["agent-context", agentId], data);
    },
    onSettled: () => invalidateAttachmentSurfaces(qc),
  });
}

/** The skill-side twin of `useSetAgentContextDocs`, with the same rollback. */
export function useSetSkillContextDocs() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ skillId, paths }: { skillId: string; paths: string[] }) =>
      api.put<ContextAttachment[]>(`/skills/${skillId}/context-docs`, { paths }),
    onMutate: async ({ skillId, paths }) => {
      const key = ["skill-context", skillId];
      await qc.cancelQueries({ queryKey: key });
      const previous = qc.getQueryData<ContextAttachment[]>(key);
      qc.setQueryData<ContextAttachment[]>(key, seedAttachments(paths));
      return { previous };
    },
    onError: (_err, { skillId }, ctx) => {
      if (ctx?.previous) qc.setQueryData(["skill-context", skillId], ctx.previous);
    },
    onSuccess: (data, { skillId }) => {
      qc.setQueryData(["skill-context", skillId], data);
    },
    onSettled: () => invalidateAttachmentSurfaces(qc),
  });
}
