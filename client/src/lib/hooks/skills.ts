/* hooks/skills.ts — React Query hooks for the Skills page, the Skill editor, and
   the Agent editor's Skills tab. */
"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import type {
  AgentSkillLink,
  Skill,
  SkillImportPreview,
  SkillSource,
  SkillStats,
  SkillType,
  SkillVersion,
} from "@devdigest/shared";

export function useSkills() {
  return useQuery({
    queryKey: ["skills"],
    queryFn: () => api.get<Skill[]>("/skills"),
  });
}

export function useSkill(id: string | null | undefined) {
  return useQuery({
    queryKey: ["skill", id],
    queryFn: () => api.get<Skill>(`/skills/${id}`),
    enabled: !!id,
  });
}

export function useSkillVersions(id: string | null | undefined) {
  return useQuery({
    queryKey: ["skill-versions", id],
    queryFn: () => api.get<SkillVersion[]>(`/skills/${id}/versions`),
    enabled: !!id,
  });
}

export interface CreateSkillInput {
  name: string;
  description?: string;
  type?: SkillType;
  source?: SkillSource;
  body: string;
  enabled?: boolean;
  /** Paths the skill was extracted from — set by the conventions extractor. */
  evidence_files?: string[];
}

export function useCreateSkill() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateSkillInput) => api.post<Skill>("/skills", input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["skills"] }),
  });
}

export interface UpdateSkillInput {
  id: string;
  patch: Partial<Pick<Skill, "name" | "description" | "type" | "body" | "enabled">> & {
    /** Recorded against the new version; ignored unless the body changed. */
    version_message?: string;
  };
}

export function useUpdateSkill() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: UpdateSkillInput) => api.put<Skill>(`/skills/${id}`, patch),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["skills"] });
      qc.setQueryData(["skill", data.id], data);
      // A body change appends a version server-side, so the history and the
      // version count in Stats are both stale.
      qc.invalidateQueries({ queryKey: ["skill-versions", data.id] });
      qc.invalidateQueries({ queryKey: ["skill-stats", data.id] });
    },
  });
}

export function useDeleteSkill() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.del<{ ok: boolean }>(`/skills/${id}`),
    onSuccess: (_d, id) => {
      qc.invalidateQueries({ queryKey: ["skills"] });
      qc.removeQueries({ queryKey: ["skill", id] });
      // Deleting a skill cascades its agent links, so every agent's linked set
      // and the list's per-agent counts may have changed.
      qc.invalidateQueries({ queryKey: ["agent-skills"] });
      qc.invalidateQueries({ queryKey: ["agents"] });
    },
  });
}

/**
 * Parse an upload into a preview WITHOUT persisting it. Deliberately not a
 * query: it is a user-triggered action whose result is reviewed before any
 * skill is created, and re-running it must not be served from a cache.
 */
export function useImportSkillPreview() {
  return useMutation({
    mutationFn: (input: { filename: string; content_base64: string }) =>
      api.post<SkillImportPreview>("/skills/import", input),
  });
}

/** Usage and outcome stats for the detail pane's Stats tab. */
export function useSkillStats(id: string | null | undefined) {
  return useQuery({
    queryKey: ["skill-stats", id],
    queryFn: () => api.get<SkillStats>(`/skills/${id}/stats`),
    enabled: !!id,
  });
}

/**
 * Restore a previous body. The server APPENDS a new version rather than
 * rewinding, so the skill, its history and its stats all change.
 */
export function useRestoreSkillVersion() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, version }: { id: string; version: number }) =>
      api.post<Skill>(`/skills/${id}/restore`, { version }),
    onSuccess: (data) => {
      qc.setQueryData(["skill", data.id], data);
      qc.invalidateQueries({ queryKey: ["skills"] });
      qc.invalidateQueries({ queryKey: ["skill-versions", data.id] });
      qc.invalidateQueries({ queryKey: ["skill-stats", data.id] });
    },
  });
}

// ---- agent ⇄ skill links (the Agent editor's Skills tab) -------------------

export function useAgentSkillLinks(agentId: string | null | undefined) {
  return useQuery({
    queryKey: ["agent-skills", agentId],
    queryFn: () => api.get<AgentSkillLink[]>(`/agents/${agentId}/skills`),
    enabled: !!agentId,
  });
}

/**
 * Replace an agent's whole ordered set of linked skills. One endpoint covers
 * attach, detach and reorder, because all three are just "here is the new list,
 * in prompt order".
 *
 * Updates OPTIMISTICALLY on purpose. Reordering by drag has to feel immediate,
 * and writing the new order straight into the query cache means the Skills tab
 * can render purely from server state — no local copy of the ordered list, and
 * so no Effect re-syncing one when the server answers. (That "store derived
 * state, then patch it" bug is the CRITICAL one client/INSIGHTS.md records for
 * ConfigTab; `AgentEditor` still carries the comment explaining the fix.)
 */
/**
 * Attach ONE skill to an agent, appended at the end of its prompt order.
 *
 * The same endpoint as `useSetAgentSkills`, taking the `{ skill_id }` branch — a
 * caller that has just created a skill knows nothing about the agent's existing
 * order and must not have to fetch it first only to send it back.
 *
 * Not optimistic: the skill did not exist a moment ago, so there is no stale
 * ordering on screen to keep smooth, and a silent failure here would leave the
 * user believing the skill is live when it reaches no review.
 */
export function useLinkAgentSkill() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ agentId, skillId }: { agentId: string; skillId: string }) =>
      api.post<AgentSkillLink[]>(`/agents/${agentId}/skills`, { skill_id: skillId }),
    onSuccess: (data, { agentId }) => {
      qc.setQueryData(["agent-skills", agentId], data);
      qc.invalidateQueries({ queryKey: ["agents"] });
      qc.invalidateQueries({ queryKey: ["skills"] });
    },
  });
}

export function useSetAgentSkills() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ agentId, skillIds }: { agentId: string; skillIds: string[] }) =>
      api.post<AgentSkillLink[]>(`/agents/${agentId}/skills`, { skill_ids: skillIds }),
    onMutate: async ({ agentId, skillIds }) => {
      const key = ["agent-skills", agentId];
      await qc.cancelQueries({ queryKey: key });
      const previous = qc.getQueryData<AgentSkillLink[]>(key);
      qc.setQueryData<AgentSkillLink[]>(
        key,
        skillIds.map((skillId, order) => ({ agent_id: agentId, skill_id: skillId, order })),
      );
      return { previous };
    },
    onError: (_err, { agentId }, ctx) => {
      // Put the server's last known order back, or the UI keeps showing an order
      // that was never saved.
      if (ctx?.previous) qc.setQueryData(["agent-skills", agentId], ctx.previous);
    },
    onSuccess: (data, { agentId }) => {
      qc.setQueryData(["agent-skills", agentId], data);
    },
    onSettled: () => {
      // The agents list renders a per-agent skill count.
      qc.invalidateQueries({ queryKey: ["agents"] });
    },
  });
}
