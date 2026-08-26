import type {
  ContextAttachment,
  ContextDocContent,
  ContextListing,
  ContextSkipReason,
} from '@devdigest/shared';

/**
 * Project Context (SPEC-01) — the facade every other slice codes against.
 *
 * Following `RepoIntel` (`modules/repo-intel/types.ts`), this is a DEGRADED
 * contract: it does not throw on partial data. `list` answers with a state
 * discriminator rather than an error — a repository with no mirror is
 * "not synced", which is a state — and `resolveForRun` never throws or rejects
 * at all. That guarantee IS NFR-3: a review must always be able to run, with
 * or without its project context.
 *
 * The two exceptions are deliberate and both are bad REQUESTS rather than
 * missing enrichment: `read` returns `null` for an unknown or unsafe path, and
 * the `replace*` methods return `null` when the owner is not in the caller's
 * workspace. The edge turns both into a 404. Only `resolveForRun` is safe to
 * call completely unguarded.
 */

/** One document the run declined to inject, and why (AC-37). */
export interface SkippedDoc {
  path: string;
  reason: ContextSkipReason;
}

/** The result of the run-time read pass. Never a throw, never a rejection. */
export interface ResolvedRunContext {
  /** Document texts, injection-ordered, already truncated (NFR-5). */
  texts: string[];
  /** Paths of `texts`, in the same order — the trace's `project_context.read`. */
  read: string[];
  skipped: SkippedDoc[];
}

export interface ProjectContext {
  /** The document listing for a repository. Always answers; never throws. */
  list(workspaceId: string, repoId: string): Promise<ContextListing>;
  /** One document's text; `null` when the path is unsafe, unknown or unreadable. */
  read(workspaceId: string, repoId: string, path: string): Promise<ContextDocContent | null>;
  /** Persist the search roots; `null` when the repo is not in this workspace. */
  setRoots(workspaceId: string, repoId: string, roots: string[]): Promise<string[] | null>;
  agentDocs(workspaceId: string, agentId: string): Promise<ContextAttachment[] | null>;
  skillDocs(workspaceId: string, skillId: string): Promise<ContextAttachment[] | null>;
  replaceAgentDocs(
    workspaceId: string,
    agentId: string,
    paths: string[],
  ): Promise<ContextAttachment[] | null>;
  replaceSkillDocs(
    workspaceId: string,
    skillId: string,
    paths: string[],
  ): Promise<ContextAttachment[] | null>;
  /** Run-time resolve + bounded read. NEVER throws. */
  resolveForRun(agentId: string, repoId: string): Promise<ResolvedRunContext>;
}
