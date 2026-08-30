/**
 * One function per tool: validate → resolve → call → shape.
 *
 * Two rules run through all five:
 *
 *  - **Errors lead forward.** Every failure text names the call that fixes it,
 *    so the model takes the next step instead of getting stuck. A dry 404 is a
 *    dead end.
 *  - **`isError` means "you can fix this by trying again".** A malformed
 *    argument, an unknown agent and a rate limit all set it, and so does an
 *    unusable code index — the fix there is a user action (re-analyze the
 *    repository), which is exactly what an actionable error is for. The
 *    120-second deadline deliberately does NOT: it would invite a retry that
 *    starts a second paid run.
 */
import { ApiError, BadShapeError, EngineDownError } from './api-client.js';
import type { ApiClient } from './api-client.js';
import { DEADLINE_MS, MAX_ERROR_CHARS, POLL_INTERVAL_MS } from './constants.js';
import { InvalidArgument, NotFound, Resolver } from './resolve.js';
import { validateOptionalAgent, validatePr, validateRepo } from './resolve.js';
import { clean } from './sanitize.js';
import {
  latestReview,
  reviewForRun,
  toConciseAgents,
  toConciseBlast,
  toConciseConventions,
  toConciseReview,
} from './shape.js';
import {
  isBlastPayload,
  isConventionsPayload,
  isReviewArray,
  isRunCreated,
  isRunSummaryArray,
} from './types.js';
import type { ToolResult } from './types.js';

// ---- Failure texts. Verbatim from specs/l05-mcp-server.md §Step 3. --------

const MESSAGES = {
  engineDown: (base: string) =>
    `Cannot reach the DevDigest engine at ${base}. Start it with ./scripts/dev.sh, then retry.`,
  agentNotFound: (agent: string) =>
    `Agent "${agent}" not found. Call list_agents to see the configured agents, then retry with one of those names.`,
  repoNotFound: (repo: string) =>
    `Repository "${repo}" is not in DevDigest. Add it in the web UI at http://localhost:3000, or check the spelling — it must be owner/name.`,
  prNotImported: (pr: unknown, repo: string) =>
    `Change request #${String(pr)} is not imported for ${repo}. Open the repository in the web UI to import its change requests, then retry.`,
  runFailed: (error: string) =>
    `The review run failed: ${error}. Check the API key in Settings, then retry.`,
  noReview: (repo: string, pr: number) =>
    `No review exists for ${repo}#${pr} yet. Call run_agent_on_pr to create one.`,
  noConventions: (repo: string) =>
    `No accepted conventions for ${repo}. Extract them in the web UI under the repository's Conventions tab.`,
  blastUnavailable: (repo: string) =>
    `The code index for ${repo} cannot answer this yet. Re-analyze the repository in the web UI at http://localhost:3000, then retry.`,
  invalidPr: () =>
    'The "pr" argument must be a whole change-request number, for example 42.',
  rateLimited: () =>
    'The DevDigest API is rate-limiting this MCP server. Wait a minute, then retry.',
  badShape: (base: string) =>
    `The DevDigest engine at ${base} answered with a shape this MCP server does not understand. The engine and the MCP package may be from different commits — rebuild both, then retry.`,
  engineError: (message: string) =>
    `The DevDigest engine rejected the request: ${message}. Check the repository and change request in the web UI at http://localhost:3000, then retry.`,
  /** Deliberately NOT an error. `isError: true` here invites a second paid run. */
  timedOut:
    'The review is still running after 120 seconds. It will finish on its own — call get_findings with the same repo, pr, and agent in a minute to read the result.',
} as const;

/**
 * Why a `partial` state is worth a sentence rather than the machine `reason`
 * code: the model has to decide whether to trust the list, and "some callers may
 * be missing" is actionable where `index_partial` is not.
 */
const BLAST_PARTIAL_NOTE =
  'The code index is incomplete, so some callers may be missing. Treat this list as a lower bound.';

// ---- Result helpers ------------------------------------------------------

function ok(value: unknown): ToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(value) }] };
}

function fail(text: string): ToolResult {
  return { content: [{ type: 'text', text }], isError: true };
}

interface ErrorContext {
  baseUrl: string;
  repo?: string;
  pr?: unknown;
  agent?: string;
}

/**
 * Every thrown error becomes a well-formed, actionable tool result — never a
 * bare crash and never a JSON-RPC protocol error (`security` §A10, fail-closed).
 * A protocol error is invisible to the model; a tool error it can act on.
 */
function mapError(err: unknown, ctx: ErrorContext): ToolResult {
  if (err instanceof EngineDownError) return fail(MESSAGES.engineDown(ctx.baseUrl));
  if (err instanceof BadShapeError) return fail(MESSAGES.badShape(ctx.baseUrl));
  if (err instanceof NotFound) {
    if (err.what === 'repo') return fail(MESSAGES.repoNotFound(ctx.repo ?? ''));
    if (err.what === 'pull') return fail(MESSAGES.prNotImported(ctx.pr, ctx.repo ?? ''));
    return fail(MESSAGES.agentNotFound(ctx.agent ?? ''));
  }
  if (err instanceof InvalidArgument) {
    if (err.which === 'repo') return fail(MESSAGES.repoNotFound(String(ctx.repo ?? '')));
    if (err.which === 'pr') return fail(MESSAGES.invalidPr());
    return fail(MESSAGES.agentNotFound(String(ctx.agent ?? '')));
  }
  if (err instanceof ApiError) {
    if (err.status === 429) return fail(MESSAGES.rateLimited());
    return fail(MESSAGES.engineError(clean(err.message, MAX_ERROR_CHARS)));
  }
  // Unknown failure: still a well-formed result, still pointing somewhere.
  return fail(MESSAGES.engineDown(ctx.baseUrl));
}

// ---- Handler wiring ------------------------------------------------------

export interface HandlerDeps {
  api: ApiClient;
  resolver?: Resolver;
  /** Injected so the deadline case runs in milliseconds under test. */
  deadlineMs?: number;
  pollIntervalMs?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

export type Handler = (args: Record<string, unknown>) => Promise<ToolResult>;

export function createHandlers(deps: HandlerDeps): Record<string, Handler> {
  const { api } = deps;
  const resolver = deps.resolver ?? new Resolver(api);
  const deadlineMs = deps.deadlineMs ?? DEADLINE_MS;
  const pollIntervalMs = deps.pollIntervalMs ?? POLL_INTERVAL_MS;
  const now = deps.now ?? (() => Date.now());
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));

  const traceUrl = (runId: string) => `${api.baseUrl}/runs/${runId}/trace`;

  async function readReviews(prId: string) {
    const body = await api.get(`/pulls/${prId}/reviews`);
    if (!isReviewArray(body)) throw new BadShapeError('/pulls/:id/reviews', api.baseUrl);
    return body;
  }

  const listAgents: Handler = async () => {
    try {
      const agents = await resolver.listAgents();
      return ok({ agents: toConciseAgents(agents) });
    } catch (err) {
      return mapError(err, { baseUrl: api.baseUrl });
    }
  };

  /**
   * Result, not operation: create the run, wait for it, collect the findings —
   * all three behind one call. Nothing about runs, run ids, polling or statuses
   * reaches the model.
   */
  const runAgentOnPr: Handler = async (args) => {
    const ctx: ErrorContext = {
      baseUrl: api.baseUrl,
      repo: typeof args.repo === 'string' ? args.repo : String(args.repo ?? ''),
      pr: args.pr,
      agent: typeof args.agent === 'string' ? args.agent : String(args.agent ?? ''),
    };
    try {
      // Named fields only — the raw `arguments` object is never spread into a
      // URL or a body (`security` §A08).
      const repo = validateRepo(args.repo);
      const pr = validatePr(args.pr);
      const agent = validateOptionalAgent(args.agent);
      if (agent === undefined) throw new InvalidArgument('agent');
      ctx.repo = repo;
      ctx.agent = agent;

      // Agent first: one GET, and an unknown name should not pay for the
      // forge-syncing pulls call.
      const agentId = await resolver.resolveAgentId(agent);
      const repoId = await resolver.resolveRepoId(repo);
      const prId = await resolver.resolvePullId(repoId, pr);

      const created = await api.post(`/pulls/${prId}/review`, { agentId });
      if (!isRunCreated(created) || created.runs.length === 0) {
        throw new BadShapeError('/pulls/:id/review', api.baseUrl);
      }
      const runId = created.runs[0]!.run_id;

      const deadline = now() + deadlineMs;
      while (now() < deadline) {
        await sleep(pollIntervalMs);
        const runs = await api.get(`/pulls/${prId}/runs`);
        if (!isRunSummaryArray(runs)) throw new BadShapeError('/pulls/:id/runs', api.baseUrl);
        const run = runs.find((r) => r.run_id === runId);
        if (!run) continue;

        if (run.status === 'failed' || run.status === 'cancelled') {
          return fail(MESSAGES.runFailed(clean(run.error ?? run.status, MAX_ERROR_CHARS)));
        }
        if (run.status === 'done') {
          const reviews = await readReviews(prId);
          const review = reviewForRun(reviews, runId) ?? latestReview(reviews, agent);
          if (!review) return fail(MESSAGES.noReview(repo, pr));
          return ok({ status: 'completed', ...toConciseReview(review, traceUrl(runId)) });
        }
      }

      // Deadline. Do NOT cancel: the run keeps going and will persist its
      // review, and cancelling throws away LLM work the user already paid for.
      return ok({
        status: 'timed_out',
        message: MESSAGES.timedOut,
        trace_url: traceUrl(runId),
      });
    } catch (err) {
      return mapError(err, ctx);
    }
  };

  const getFindings: Handler = async (args) => {
    const ctx: ErrorContext = {
      baseUrl: api.baseUrl,
      repo: typeof args.repo === 'string' ? args.repo : String(args.repo ?? ''),
      pr: args.pr,
      agent: typeof args.agent === 'string' ? args.agent : String(args.agent ?? ''),
    };
    try {
      const repo = validateRepo(args.repo);
      const pr = validatePr(args.pr);
      const agent = validateOptionalAgent(args.agent);
      ctx.repo = repo;

      const repoId = await resolver.resolveRepoId(repo);
      const prId = await resolver.resolvePullId(repoId, pr);
      // Resolving the name proves the agent exists, so an unknown one gets the
      // agent error rather than a silent empty result.
      if (agent !== undefined) await resolver.resolveAgentId(agent);

      const reviews = await readReviews(prId);
      const review = latestReview(reviews, agent);
      if (!review) return fail(MESSAGES.noReview(repo, pr));
      return ok(toConciseReview(review, review.run_id ? traceUrl(review.run_id) : undefined));
    } catch (err) {
      return mapError(err, ctx);
    }
  };

  const getConventions: Handler = async (args) => {
    const ctx: ErrorContext = {
      baseUrl: api.baseUrl,
      repo: typeof args.repo === 'string' ? args.repo : String(args.repo ?? ''),
    };
    try {
      const repo = validateRepo(args.repo);
      ctx.repo = repo;
      const repoId = await resolver.resolveRepoId(repo);
      const body = await api.get(`/repos/${repoId}/conventions`);
      if (!isConventionsPayload(body)) {
        throw new BadShapeError('/repos/:id/conventions', api.baseUrl);
      }
      const shaped = toConciseConventions(body.candidates);
      if (shaped.conventions.length === 0) return fail(MESSAGES.noConventions(repo));
      return ok(shaped);
    } catch (err) {
      return mapError(err, ctx);
    }
  };

  /**
   * One GET beyond resolution. The endpoint is served entirely from the persisted
   * repo-intel index — it parses no code and calls no model — so this is a cheap
   * read, not a job.
   */
  const getBlastRadius: Handler = async (args) => {
    const ctx: ErrorContext = {
      baseUrl: api.baseUrl,
      repo: typeof args.repo === 'string' ? args.repo : String(args.repo ?? ''),
      pr: args.pr,
    };
    try {
      // Named fields only — the raw `arguments` object is never spread into a URL
      // (`security` §A08), and the base URL stays env-derived.
      const repo = validateRepo(args.repo);
      const pr = validatePr(args.pr);
      ctx.repo = repo;

      const repoId = await resolver.resolveRepoId(repo);
      const prId = await resolver.resolvePullId(repoId, pr);

      const body = await api.get(`/pulls/${prId}/blast`);
      if (!isBlastPayload(body)) throw new BadShapeError('/pulls/:id/blast', api.baseUrl);

      // A degraded index IS an actionable error: nothing was computed, and the
      // fix is a user action rather than a retry of this call.
      if (body.state === 'degraded') return fail(MESSAGES.blastUnavailable(repo));

      return ok(toConciseBlast(body, body.state === 'partial' ? BLAST_PARTIAL_NOTE : undefined));
    } catch (err) {
      return mapError(err, ctx);
    }
  };

  return {
    list_agents: listAgents,
    run_agent_on_pr: runAgentOnPr,
    get_findings: getFindings,
    get_conventions: getConventions,
    get_blast_radius: getBlastRadius,
  };
}

export { MESSAGES };
