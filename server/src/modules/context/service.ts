import { open } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import type { Container } from '../../platform/container.js';
import type {
  ContextAttachment,
  ContextDocContent,
  ContextDocument,
  ContextListing,
} from '@devdigest/shared';
import { ValidationError } from '../../platform/errors.js';
import { ContextRepository } from './repository.js';
import { walkMarkdown } from './pipeline/walk-markdown.js';
import {
  CONTEXT_DOC_EXT,
  DEFAULT_CONTEXT_ROOTS,
  MAX_DOCS_PER_AGENT,
  MAX_DOCUMENT_CHARS,
  RUNTIME_READ_BUDGET_MS,
} from './constants.js';
import {
  isSafeContextPath,
  matchesRoots,
  resolveEffectiveDocs,
  truncateForInjection,
} from './helpers.js';
import type { ProjectContext, ResolvedRunContext, SkippedDoc } from './types.js';

/**
 * Project Context (SPEC-01) — business logic. Implements the `ProjectContext`
 * degraded contract (`types.ts`).
 *
 * Reads `container.tokenizer` but NEVER `container.db`: the repository is
 * constructed with it once, here, which is the sanctioned line (the same shape
 * `IntentService` uses).
 *
 * AC-41 — NOTHING in this file logs. Not a path, and above all not a
 * document's text: the only reason to log here would be to explain a skip, and
 * the skip reasons are returned as structured data instead, where the run trace
 * renders them. Keep it that way when adding a method.
 *
 * AC-43 / NFR-7 — no code path in this slice resolves an LLM provider or an
 * embedder from the container. Token estimates are local tiktoken, nothing
 * else, and this feature makes no model call at any point.
 */

/**
 * Ceiling on what a single read pulls off disk. UTF-8 is at most 4 bytes per
 * code point, so this many bytes always decode to at least `MAX_DOCUMENT_CHARS`
 * characters — reading more could never survive `truncateForInjection`, and a
 * pathological 500 MB `.md` in the mirror must not become 500 MB of heap.
 */
const READ_BYTE_LIMIT = MAX_DOCUMENT_CHARS * 4 + 1;

export class ContextService implements ProjectContext {
  private repo: ContextRepository;

  constructor(private container: Container) {
    this.repo = new ContextRepository(container.db);
  }

  // ---- listing ------------------------------------------------------------

  /**
   * The document listing. Every outcome is a STATE, never a thrown error:
   * an unknown repository, a repository with no mirror, and a mirror where
   * nothing matched are three different answers the UI renders differently, and
   * none of them is a failure (AC-6, AC-8, AC-10).
   *
   * An unknown repo id answers `not_synced` rather than 404 for two reasons: a
   * `retry: false` client query would cache a 404 for the whole session
   * (`client/INSIGHTS.md` 2026-08-09), and it keeps "exists in another
   * workspace" indistinguishable from "does not exist".
   */
  async list(workspaceId: string, repoId: string): Promise<ContextListing> {
    const repo = await this.repo.getRepoForContext(workspaceId, repoId);
    const roots = [...(repo?.contextRoots ?? DEFAULT_CONTEXT_ROOTS)];
    if (!repo?.clonePath) return { state: 'not_synced' };

    const walk = await walkMarkdown(repo.clonePath, roots);
    if (walk.files.length === 0) return { state: 'no_match', roots };

    const counts = await this.repo.agentReachCounts(
      workspaceId,
      walk.files.map((f) => f.path),
    );

    const documents: ContextDocument[] = [];
    for (const file of walk.files) {
      const read = await this.readBounded(join(repo.clonePath, file.path));
      documents.push({
        path: file.path,
        dir: file.dir,
        root: file.root,
        size: file.size,
        updated_at: file.mtime,
        // Estimated over the TRUNCATED text, so the number the user reads is
        // the number the prompt will actually pay (AC-15, AC-16, AC-43).
        est_tokens: read ? this.container.tokenizer.count(read.text) : null,
        truncated: read?.truncated ?? false,
        agent_count: counts.get(file.path) ?? 0,
        missing: false,
      });
    }

    // Attached-but-vanished documents are appended so the user can see and
    // detach them (AC-39). They are not part of the walk, so they do not count
    // toward `total` or trip `truncated`, which describe discovery.
    const present = new Set(walk.files.map((f) => f.path));
    const attached = await this.repo.attachedPaths(workspaceId);
    const missingCounts = await this.repo.agentReachCounts(
      workspaceId,
      attached.filter((p) => !present.has(p)),
    );
    for (const path of attached) {
      if (present.has(path)) continue;
      const slash = path.lastIndexOf('/');
      documents.push({
        path,
        dir: slash < 0 ? '' : path.slice(0, slash),
        root: matchesRoots(path, roots) ?? '',
        size: null,
        updated_at: null,
        est_tokens: null,
        truncated: false,
        agent_count: missingCounts.get(path) ?? 0,
        missing: true,
      });
    }

    return {
      state: 'ok',
      roots,
      documents,
      total: walk.total,
      truncated: walk.truncated,
      scanned_at: new Date().toISOString(),
    };
  }

  /** One document's text. `null` for an unsafe, unknown or unreadable path. */
  async read(
    workspaceId: string,
    repoId: string,
    path: string,
  ): Promise<ContextDocContent | null> {
    // The allowlist runs BEFORE any join — a rejected path never becomes a
    // filesystem operand at all (AC-42).
    if (!isSafeContextPath(path)) return null;
    const repo = await this.repo.getRepoForContext(workspaceId, repoId);
    if (!repo?.clonePath) return null;
    const full = this.insideMirror(repo.clonePath, path);
    if (!full) return null;
    const read = await this.readBounded(full);
    if (!read) return null;
    return { path, content: read.text, truncated: read.truncated };
  }

  async setRoots(workspaceId: string, repoId: string, roots: string[]): Promise<string[] | null> {
    const ok = await this.repo.setRoots(workspaceId, repoId, roots);
    return ok ? roots : null;
  }

  // ---- attachments --------------------------------------------------------

  async agentDocs(workspaceId: string, agentId: string): Promise<ContextAttachment[] | null> {
    if (!(await this.repo.agentInWorkspace(workspaceId, agentId))) return null;
    return this.withMissing(workspaceId, await this.repo.listAgentDocs(agentId));
  }

  async skillDocs(workspaceId: string, skillId: string): Promise<ContextAttachment[] | null> {
    if (!(await this.repo.skillInWorkspace(workspaceId, skillId))) return null;
    return this.withMissing(workspaceId, await this.repo.listSkillDocs(skillId));
  }

  /**
   * Replace an agent's whole list. Throws `ValidationError` — which the edge
   * maps to 422 — when the EFFECTIVE set (direct plus skill-inherited) would
   * pass `MAX_DOCS_PER_AGENT`, because the cap the user is warned about is the
   * one the run enforces, not the length of this one list (AC-26).
   */
  async replaceAgentDocs(
    workspaceId: string,
    agentId: string,
    paths: string[],
  ): Promise<ContextAttachment[] | null> {
    if (!(await this.repo.agentInWorkspace(workspaceId, agentId))) return null;
    const { inherited } = await this.repo.effectiveDocsForAgent(agentId);
    const effective = resolveEffectiveDocs(
      paths.map((path, order) => ({ path, order })),
      inherited,
    );
    if (effective.overflow.length > 0) {
      throw new ValidationError(
        `An agent can inject at most ${MAX_DOCS_PER_AGENT} documents, including those ` +
          `inherited from its skills; this change would reach ` +
          `${effective.injected.length + effective.overflow.length}.`,
      );
    }
    const rows = await this.repo.replaceAgentDocs(workspaceId, agentId, paths);
    return rows ? this.withMissing(workspaceId, rows) : null;
  }

  /**
   * The skill-side twin. No effective-set check here: a skill has no run of its
   * own, and the cap belongs to whichever agents link it — which
   * `replaceAgentDocs` and `resolveForRun` both enforce.
   */
  async replaceSkillDocs(
    workspaceId: string,
    skillId: string,
    paths: string[],
  ): Promise<ContextAttachment[] | null> {
    const rows = await this.repo.replaceSkillDocs(workspaceId, skillId, paths);
    return rows ? this.withMissing(workspaceId, rows) : null;
  }

  // ---- run time -----------------------------------------------------------

  /**
   * Resolve, then read, everything this agent injects into one run.
   *
   * NEVER throws and never rejects (NFR-3): a review must be able to run with
   * or without its project context, so every failure is a `skipped` entry with
   * a reason the trace renders (AC-32, AC-37). The whole pass is bounded by
   * `RUNTIME_READ_BUDGET_MS` (NFR-2), and the documents are re-read from disk
   * on every run — nothing here is cached, so two concurrent runs each see the
   * mirror as it was for them (AC-29, NFR-8).
   */
  async resolveForRun(agentId: string, repoId: string): Promise<ResolvedRunContext> {
    const texts: string[] = [];
    const read: string[] = [];
    const skipped: SkippedDoc[] = [];
    try {
      const rows = await this.repo.effectiveDocsForAgent(agentId);
      const { injected, overflow } = resolveEffectiveDocs(rows.direct, rows.inherited);
      for (const path of overflow) skipped.push({ path, reason: 'over_limit' });
      if (injected.length === 0) return { texts, read, skipped };

      const clonePath = await this.repo.clonePathForRepo(repoId);
      if (!clonePath) {
        for (const path of injected) skipped.push({ path, reason: 'missing' });
        return { texts, read, skipped };
      }

      const deadline = Date.now() + RUNTIME_READ_BUDGET_MS;
      for (const path of injected) {
        if (!path.toLowerCase().endsWith(CONTEXT_DOC_EXT)) {
          skipped.push({ path, reason: 'not_markdown' });
          continue;
        }
        // Re-evaluated on EVERY read, not once at attach time, and before the
        // path is joined to anything (AC-42).
        if (!isSafeContextPath(path)) {
          skipped.push({ path, reason: 'out_of_bounds' });
          continue;
        }
        if (Date.now() >= deadline) {
          skipped.push({ path, reason: 'deadline' });
          continue;
        }
        const full = this.insideMirror(clonePath, path);
        if (!full) {
          skipped.push({ path, reason: 'out_of_bounds' });
          continue;
        }
        const doc = await this.readBounded(full);
        if (!doc) {
          skipped.push({ path, reason: 'missing' });
          continue;
        }
        texts.push(doc.text);
        read.push(path);
      }
    } catch {
      // Belt and braces for the NEVER-throws contract: an unexpected failure
      // (a DB blip) degrades to "no project context", never to a failed run.
      return { texts, read, skipped };
    }
    return { texts, read, skipped };
  }

  // ---- internals ----------------------------------------------------------

  /** Attachment rows plus the `missing` flag, checked against the mirrors. */
  private async withMissing(
    workspaceId: string,
    rows: { path: string; order: number }[],
  ): Promise<ContextAttachment[]> {
    if (rows.length === 0) return [];
    const mirrors = await this.repo.mirrorRootsForWorkspace(workspaceId);
    const out: ContextAttachment[] = [];
    for (const row of rows) {
      out.push({ path: row.path, order: row.order, missing: !(await this.existsIn(mirrors, row.path)) });
    }
    return out;
  }

  /**
   * An attachment is a bare path with no repository attached, so "still there?"
   * is asked of every mirror in the workspace and answered by the first hit.
   */
  private async existsIn(mirrors: string[], path: string): Promise<boolean> {
    if (!isSafeContextPath(path)) return false;
    for (const mirror of mirrors) {
      const full = this.insideMirror(mirror, path);
      if (!full) continue;
      const handle = await open(full, 'r').catch(() => null);
      if (handle) {
        await handle.close();
        return true;
      }
    }
    return false;
  }

  /**
   * Join and then PROVE containment. `isSafeContextPath` is the gate; this is
   * the second lock on the same door, so a future loosening of the allowlist
   * cannot by itself turn into an escape from the mirror.
   */
  private insideMirror(mirror: string, path: string): string | null {
    const base = resolve(mirror);
    const full = resolve(base, path);
    return full === base || full.startsWith(base + sep) ? full : null;
  }

  /**
   * Read at most `READ_BYTE_LIMIT` bytes and truncate to `MAX_DOCUMENT_CHARS`.
   * `null` means the file is absent or unreadable — the caller decides whether
   * that is `missing`, `unreadable` or simply "not shown".
   *
   * Reading a bounded prefix rather than the whole file means a multi-byte
   * character can be cut at the boundary and decode to U+FFFD; that is one
   * replacement character at the very end of an already-truncated document.
   */
  private async readBounded(full: string): Promise<{ text: string; truncated: boolean } | null> {
    const handle = await open(full, 'r').catch(() => null);
    if (!handle) return null;
    try {
      const buffer = Buffer.alloc(READ_BYTE_LIMIT);
      const { bytesRead } = await handle.read(buffer, 0, READ_BYTE_LIMIT, 0);
      const raw = buffer.subarray(0, bytesRead).toString('utf8');
      const cut = truncateForInjection(raw);
      return { text: cut.text, truncated: cut.truncated || bytesRead >= READ_BYTE_LIMIT };
    } catch {
      return null;
    } finally {
      await handle.close().catch(() => undefined);
    }
  }
}
