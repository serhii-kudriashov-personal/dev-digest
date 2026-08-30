import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import type { IntentSourceLabel, PrIntentRecord } from '@devdigest/shared';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';

/**
 * Intent data-access. The ONLY file in this slice that may import Drizzle —
 * `pipeline.ts` and `service.ts` take rows as parameters.
 *
 * That separation is a discipline, not a gate: `no-sql-in-service` matches only
 * `(service|helpers).ts` by filename, so a `pipeline.ts` holding Drizzle would
 * pass `pnpm arch` silently. This is the honest placement.
 *
 * Nothing Drizzle-shaped crosses the boundary — rows and plain DTOs only.
 * Reads of `pull_requests` are workspace-scoped.
 */

export interface IntentPullRow {
  id: string;
  repoId: string;
  number: number;
  title: string;
  body: string | null;
  headSha: string;
}

export interface IntentRepoRow {
  id: string;
  owner: string;
  name: string;
  defaultBranch: string;
  /**
   * Carried so the `RepoRef` this slice builds resolves to the clone this row
   * actually owns — a bare `{ owner, name }` from a non-github.com row reads
   * another workspace's mirror (SPEC-06 AC-17; `@devdigest/shared` `RepoRef`).
   */
  instanceKey: string;
  /**
   * The three fields `container.forge(repo)` resolves an outbound client from
   * (SPEC-06). Carried on the row rather than looked up again, so this slice
   * never branches on a provider itself — `workspaceId` is here because the
   * instance lookup behind the resolver is workspace-scoped.
   */
  workspaceId: string;
  provider: string;
  instanceId: string | null;
}

export interface IntentPrFileRow {
  path: string;
  patch: string | null;
}

export interface UpsertIntentRow {
  prId: string;
  intent: string;
  inScope: string[];
  outOfScope: string[];
  headSha: string | null;
  confidence: string | null;
  modelConfidence: number | null;
  sources: string[] | null;
  provider: string | null;
  model: string | null;
  generatedAt: Date;
}

/** Internal only — the Drizzle row shape must not leave this file. */
type PrIntentRow = typeof t.prIntent.$inferSelect;

/**
 * The persisted intent, already mapped to the wire contract.
 *
 * `stale` is deliberately NOT part of this type. It is a comparison against the
 * pull's *current* head sha, which is a read-time judgement the service makes —
 * not a property of the stored row. Returning it here as `null` would read as
 * "not stale" to the next caller.
 */
export type StoredIntent = Omit<PrIntentRecord, 'stale'>;

/** Row → DTO. Kept here so nothing Drizzle-shaped crosses the boundary. */
function toStoredIntent(row: PrIntentRow): StoredIntent {
  return {
    pr_id: row.prId,
    intent: row.intent,
    in_scope: row.inScope,
    out_of_scope: row.outOfScope,
    head_sha: row.headSha,
    confidence: (row.confidence as PrIntentRecord['confidence']) ?? null,
    model_confidence: row.modelConfidence,
    sources: (row.sources as IntentSourceLabel[] | null) ?? null,
    provider: row.provider,
    model: row.model,
    generated_at: row.generatedAt ? row.generatedAt.toISOString() : null,
  };
}

export class IntentRepository {
  constructor(private db: Db) {}

  /** The pull, scoped to the workspace so one tenant can never derive another's. */
  async getPull(workspaceId: string, prId: string): Promise<IntentPullRow | undefined> {
    const [row] = await this.db
      .select({
        id: t.pullRequests.id,
        repoId: t.pullRequests.repoId,
        number: t.pullRequests.number,
        title: t.pullRequests.title,
        body: t.pullRequests.body,
        headSha: t.pullRequests.headSha,
      })
      .from(t.pullRequests)
      .where(and(eq(t.pullRequests.workspaceId, workspaceId), eq(t.pullRequests.id, prId)));
    return row;
  }

  async getRepo(workspaceId: string, repoId: string): Promise<IntentRepoRow | undefined> {
    const [row] = await this.db
      .select({
        id: t.repos.id,
        owner: t.repos.owner,
        name: t.repos.name,
        defaultBranch: t.repos.defaultBranch,
        instanceKey: t.repos.instanceKey,
        workspaceId: t.repos.workspaceId,
        provider: t.repos.provider,
        instanceId: t.repos.instanceId,
      })
      .from(t.repos)
      .where(and(eq(t.repos.workspaceId, workspaceId), eq(t.repos.id, repoId)));
    return row;
  }

  /** Patches for the PR's files. Only the `@@` headers are ever used — see helpers. */
  async getPrFiles(prId: string): Promise<IntentPrFileRow[]> {
    return this.db
      .select({ path: t.prFiles.path, patch: t.prFiles.patch })
      .from(t.prFiles)
      .where(eq(t.prFiles.prId, prId))
      .orderBy(asc(t.prFiles.path));
  }

  async getPrCommits(prId: string, limit: number): Promise<{ message: string }[]> {
    return this.db
      .select({ message: t.prCommits.message })
      .from(t.prCommits)
      .where(eq(t.prCommits.prId, prId))
      .orderBy(desc(t.prCommits.committedAt))
      .limit(limit);
  }

  async getIntent(prId: string): Promise<StoredIntent | undefined> {
    const [row] = await this.db.select().from(t.prIntent).where(eq(t.prIntent.prId, prId));
    return row ? toStoredIntent(row) : undefined;
  }

  /**
   * Insert-or-replace the intent for a PR. Keeps the existing upsert shape from
   * `reviews/repository/pull.repo.ts`, extended with the L03 metadata columns.
   */
  async upsertIntent(row: UpsertIntentRow): Promise<void> {
    const values = {
      prId: row.prId,
      intent: row.intent,
      inScope: row.inScope,
      outOfScope: row.outOfScope,
      headSha: row.headSha,
      confidence: row.confidence,
      modelConfidence: row.modelConfidence,
      sources: row.sources,
      provider: row.provider,
      model: row.model,
      generatedAt: row.generatedAt,
    };
    await this.db
      .insert(t.prIntent)
      .values(values)
      .onConflictDoUpdate({ target: t.prIntent.prId, set: values });
  }

  /**
   * Spec chunks previously indexed for this repo, if any. Best-effort secondary
   * route to a linked plan — nothing in this lesson guarantees a writer exists
   * for `code_chunks.source = 'spec'`, so an empty result is a normal answer.
   */
  async getSpecChunks(
    workspaceId: string,
    repoId: string,
    paths: string[],
  ): Promise<{ path: string; content: string }[]> {
    if (paths.length === 0) return [];
    return this.db
      .select({ path: t.codeChunks.path, content: t.codeChunks.content })
      .from(t.codeChunks)
      .where(
        and(
          eq(t.codeChunks.workspaceId, workspaceId),
          eq(t.codeChunks.repoId, repoId),
          eq(t.codeChunks.source, 'spec'),
          inArray(t.codeChunks.path, paths),
        ),
      );
  }
}
