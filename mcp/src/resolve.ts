/**
 * Flat, human-readable identifiers → the UUIDs the API actually takes.
 *
 * Every `:id` path parameter on the engine is a UUID
 * (`IdParams = z.object({ id: z.string().uuid() })`,
 * `server/src/modules/_shared/schemas.ts:11`), and no tool signature exposes
 * one — `repo` is `owner/name`, `pr` is the PR number, `agent` is a name from
 * `list_agents`. This module is where that gap is closed.
 *
 * Argument validation lives here too, and runs BEFORE any URL is built
 * (`security` §A05, §A08). The arguments arrive from a model, so they are
 * attacker-adjacent: shape-check each named field, never spread a raw
 * `arguments` object into a URL or a request body.
 */
import { BadShapeError } from './api-client.js';
import type { ApiClient } from './api-client.js';
import { MAX_AGENT_CHARS, MAX_PR_NUMBER, MAX_REPO_CHARS } from './constants.js';
import { stripControlChars } from './sanitize.js';
import { isAgentArray, isPullArray, isRepoArray } from './types.js';
import type { Agent } from './types.js';

const REPO_SLUG = /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/;

/** A resolution miss the caller turns into a forward-leading tool error. */
export class NotFound extends Error {
  constructor(readonly what: 'repo' | 'pull' | 'agent') {
    super(what);
    this.name = 'NotFound';
  }
}

/** A malformed argument. Same handling as a miss: an actionable tool error. */
export class InvalidArgument extends Error {
  constructor(readonly which: 'repo' | 'pr' | 'agent') {
    super(which);
    this.name = 'InvalidArgument';
  }
}

// ---- Argument validation (pure) -----------------------------------------

export function validateRepo(value: unknown): string {
  if (typeof value !== 'string') throw new InvalidArgument('repo');
  const repo = value.trim();
  if (repo.length === 0 || repo.length > MAX_REPO_CHARS) throw new InvalidArgument('repo');
  if (!REPO_SLUG.test(repo)) throw new InvalidArgument('repo');
  return repo;
}

export function validatePr(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value)) throw new InvalidArgument('pr');
  if (value < 1 || value > MAX_PR_NUMBER) throw new InvalidArgument('pr');
  return value;
}

export function validateAgent(value: unknown): string {
  if (typeof value !== 'string') throw new InvalidArgument('agent');
  const agent = stripControlChars(value).trim();
  if (agent.length === 0 || agent.length > MAX_AGENT_CHARS) throw new InvalidArgument('agent');
  return agent;
}

/** `agent` is optional on `get_findings`: absent means "any agent". */
export function validateOptionalAgent(value: unknown): string | undefined {
  return value === undefined || value === null ? undefined : validateAgent(value);
}

// ---- Resolution ----------------------------------------------------------

/**
 * Process-lifetime caches with a single retry on a miss: a repo, PR or agent
 * added since the cache warmed must resolve on the second attempt rather than
 * require a client restart. A UUID never changes, so a HIT is never refreshed.
 */
export class Resolver {
  private readonly repos = new Map<string, string>();
  private readonly pulls = new Map<string, string>();
  private readonly agents = new Map<string, string>();

  constructor(private readonly api: ApiClient) {}

  async resolveRepoId(fullName: string): Promise<string> {
    const key = fullName.toLowerCase();
    const cached = this.repos.get(key);
    if (cached) return cached;

    const body = await this.api.get('/repos');
    if (!isRepoArray(body)) throw new BadShapeError('/repos', this.api.baseUrl);
    for (const repo of body) this.repos.set(repo.full_name.toLowerCase(), repo.id);

    const found = this.repos.get(key);
    if (!found) throw new NotFound('repo');
    return found;
  }

  async resolvePullId(repoId: string, number: number): Promise<string> {
    const key = `${repoId}#${number}`;
    const cached = this.pulls.get(key);
    if (cached) return cached;

    // NOTE: this handler syncs from GitHub inside the request
    // (`server/src/modules/pulls/routes.ts:49-79`), so it is the slowest link in
    // the cold path and degrades (does not fail) without a GitHub token.
    const body = await this.api.get(`/repos/${repoId}/pulls`);
    if (!isPullArray(body)) throw new BadShapeError(`/repos/:id/pulls`, this.api.baseUrl);
    for (const pull of body) {
      // `PrMeta.id` is `.nullish()` (`platform.ts:163`) — a null id means the PR
      // was listed but never persisted, which is the not-imported case, not a
      // crash.
      if (typeof pull.id === 'string') this.pulls.set(`${repoId}#${pull.number}`, pull.id);
    }

    const found = this.pulls.get(key);
    if (!found) throw new NotFound('pull');
    return found;
  }

  /**
   * Agent name → agent id. A value that already looks like a UUID is passed
   * through unvalidated; `IdParams` rejects a bad one with a 422.
   */
  async resolveAgentId(nameOrId: string): Promise<string> {
    const key = nameOrId.toLowerCase();
    const cached = this.agents.get(key);
    if (cached) return cached;

    const agents = await this.listAgents();
    for (const agent of agents) this.agents.set(agent.name.toLowerCase(), agent.id);

    const found = this.agents.get(key);
    if (found) return found;
    if (UUID.test(nameOrId)) return nameOrId;
    throw new NotFound('agent');
  }

  async listAgents(): Promise<Agent[]> {
    const body = await this.api.get('/agents');
    if (!isAgentArray(body)) throw new BadShapeError('/agents', this.api.baseUrl);
    return body;
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
