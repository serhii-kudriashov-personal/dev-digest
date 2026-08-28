import type { Container } from '../../platform/container.js';
import { type Repo } from '@devdigest/shared';
import { NotFoundError } from '../../platform/errors.js';
import { RepoRepository } from './repository.js';
import {
  resolveRepoUrl,
  withGitHubToken,
  withInstanceToken,
  cloneUrlFor,
  instanceFor,
  toRepoDto,
} from './helpers.js';
import {
  CLONE_JOB_KIND,
  CLONE_DEPTH,
  GITHUB_TOKEN_SECRET,
} from './constants.js';
import {
  INDEX_JOB_KIND,
  REFRESH_JOB_KIND,
} from '../repo-intel/constants.js';
// A slice's `constants.ts` is its PUBLIC surface, so this import is the
// sanctioned cross-slice channel (`server/INSIGHTS.md` 2026-08-17); its
// `service`/`repository`/`helpers` would not be.
import { instanceSecretKey } from '../instances/constants.js';

/**
 * F1 — repos service. Business logic for the Repositories feature:
 *   - add / list / refresh / remove
 *   - the asynchronous `clone` job (real `git clone` via the GitClient adapter)
 *
 * No HTTP and no raw SQL live here — persistence goes through RepoRepository,
 * pure transforms through helpers.ts, literals through constants.ts.
 */

/**
 * Payload enqueued for (and consumed by) the `clone` job.
 *
 * The three SPEC-06 fields are OPTIONAL, and that is not decoration: a payload
 * is persisted as jsonb on the `jobs` row, so a job enqueued before this change
 * and consumed after it simply has no such keys. Absent means the built-in
 * github.com host, which is the same default the columns carry.
 */
export interface CloneJobPayload {
  repoId: string;
  owner: string;
  name: string;
  url: string;
  /** Clone-path segment of the owning instance; absent ⇒ `github.com`. */
  instanceKey?: string;
  /** Owning instance id, for the stored credential; absent/null ⇒ github.com. */
  instanceId?: string | null;
  /** Owning instance base URL, for the host-equality token check. */
  instanceBaseUrl?: string;
}

export class RepoService {
  private repo: RepoRepository;

  constructor(private container: Container) {
    this.repo = new RepoRepository(container.db);
  }

  /**
   * Register the `clone` job handler once. Authenticates the clone with the
   * stored GitHub PAT (so private repos work), clones via the GitClient adapter,
   * then persists the resulting path + last_polled_at.
   */
  registerCloneJobHandler(): void {
    this.container.jobs.register(CLONE_JOB_KIND, async (payload) => {
      await this.runCloneJob(payload as CloneJobPayload);
    });
  }

  async runCloneJob(payload: CloneJobPayload): Promise<void> {
    const { repoId, owner, name, url, instanceKey, instanceId, instanceBaseUrl } = payload;
    // Which credential authenticates the clone follows the owning instance, and
    // an instance's token lives ONLY under its own derived secret key — never a
    // column, never shared with github.com's PAT (AC-10).
    const cloneUrl = await this.authenticatedCloneUrl(url, instanceId, instanceBaseUrl);
    const { path } = await this.container.git.clone({ owner, name, instanceKey }, cloneUrl, {
      depth: CLONE_DEPTH,
    });
    await this.repo.updateClonePath(repoId, path);

    // T2.2 — kick off the indexer in the background. ENQUEUE (not call) so the
    // clone job closes immediately and the (heavier) index runs as its own
    // job under JobRunner's timeout/retry. If the handler isn't registered
    // (e.g. repo-intel disabled at module wiring), enqueue() throws — log and
    // continue so the clone result is preserved either way.
    const workspaceId = await this.repo.workspaceIdFor(repoId);
    if (workspaceId) {
      try {
        await this.container.jobs.enqueue(workspaceId, INDEX_JOB_KIND, {
          repoId,
          owner,
          name,
        });
      } catch {
        // No handler registered or transient enqueue failure — clone has
        // already succeeded, so we don't fail the job for an index-followup
        // miss. The user can hit POST /repos/:id/reindex to retry.
      }
    }
  }

  /**
   * Embed the right credential into a clone URL, or return it untouched.
   *
   * Both branches are host-equality gated inside `helpers.ts`, so a URL that
   * somehow reached here without belonging to its instance gets no token.
   */
  private async authenticatedCloneUrl(
    url: string,
    instanceId: string | null | undefined,
    instanceBaseUrl: string | undefined,
  ): Promise<string> {
    if (instanceId && instanceBaseUrl) {
      const credential = await this.container.secrets.get(instanceSecretKey(instanceId));
      return credential ? withInstanceToken(url, credential, instanceBaseUrl) : url;
    }
    const token = await this.container.secrets.get(GITHUB_TOKEN_SECRET);
    return token ? withGitHubToken(url, token) : url;
  }

  /**
   * Add a repo: resolve the URL against github.com and the workspace's
   * registered instances, dedupe within the workspace, persist, and enqueue the
   * real clone (non-blocking). `created` is false when the repo already existed
   * (the caller returns 200 instead of 201) — including when a concurrent
   * request won the race (NFR-9).
   */
  async add(
    workspaceId: string,
    userId: string,
    url: string,
  ): Promise<{ repo: Repo; created: boolean }> {
    const instances = await this.container.instancesRepo.list(workspaceId);
    const resolved = resolveRepoUrl(url, instances);

    const existing = await this.repo.findByIdentity(
      workspaceId,
      resolved.instanceKey,
      resolved.fullName,
    );
    if (existing) return { repo: toRepoDto(existing, resolved.instance), created: false };

    const { row, created } = await this.repo.insert({
      workspaceId,
      owner: resolved.owner,
      name: resolved.name,
      fullName: resolved.fullName,
      createdBy: userId,
      provider: resolved.provider,
      instanceId: resolved.instanceId,
      instanceKey: resolved.instanceKey,
      namespacePath: resolved.namespacePath,
    });
    if (created) {
      await this.container.jobs.enqueue(workspaceId, CLONE_JOB_KIND, {
        repoId: row.id,
        owner: resolved.owner,
        name: resolved.name,
        url: resolved.cloneUrl,
        instanceKey: resolved.instanceKey,
        instanceId: resolved.instanceId,
        instanceBaseUrl: resolved.instance?.baseUrl,
      } satisfies CloneJobPayload);
    }

    return { repo: toRepoDto(row, resolved.instance), created };
  }

  async list(workspaceId: string): Promise<Repo[]> {
    const [rows, instances] = await Promise.all([
      this.repo.list(workspaceId),
      this.container.instancesRepo.list(workspaceId),
    ]);
    return rows.map((row) => toRepoDto(row, instanceFor(row.instanceId, instances)));
  }

  /** Re-fetch the clone for an existing repo (enqueues a fresh `clone` job). */
  async refresh(workspaceId: string, id: string): Promise<{ status: 'refreshing' }> {
    const repo = await this.repo.getById(workspaceId, id);
    if (!repo) throw new NotFoundError('Repo not found');
    // The clone URL is rebuilt from the OWNING instance, not from a hard-coded
    // github.com — a GitLab repository refreshed against github.com would clone
    // a different project into its directory, and `sync()` hard-resets that
    // mirror (root `INSIGHTS.md` 2026-08-16).
    const instances = await this.container.instancesRepo.list(workspaceId);
    const instance = instanceFor(repo.instanceId, instances);
    if (repo.instanceId !== null && instance === null) {
      throw new NotFoundError('The instance this repository was imported from is no longer registered');
    }
    const namespacePath = repo.namespacePath === '' ? repo.fullName : repo.namespacePath;
    await this.container.jobs.enqueue(workspaceId, CLONE_JOB_KIND, {
      repoId: repo.id,
      owner: repo.owner,
      name: repo.name,
      url: cloneUrlFor(namespacePath, instance),
      instanceKey: repo.instanceKey,
      instanceId: repo.instanceId,
      instanceBaseUrl: instance?.baseUrl,
    } satisfies CloneJobPayload);
    // T2.2 — also enqueue an incremental refresh. The two queue positions are
    // independent (p-queue doesn't FIFO across kinds), but `runIncremental` is
    // a no-op when `currentHead === lastIndexedSha`, so ordering is safe: if
    // refresh fires before the new clone settles, it cheaply exits; if after,
    // it picks up the new HEAD.
    try {
      await this.container.jobs.enqueue(workspaceId, REFRESH_JOB_KIND, {
        repoId: repo.id,
        owner: repo.owner,
        name: repo.name,
      });
    } catch {
      // No handler / transient enqueue failure — refresh button is best-effort.
    }
    return { status: 'refreshing' };
  }

  async remove(workspaceId: string, id: string): Promise<void> {
    const ok = await this.repo.remove(workspaceId, id);
    if (!ok) throw new NotFoundError('Repo not found');
  }
}
