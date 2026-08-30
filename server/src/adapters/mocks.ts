import type { z } from 'zod';
import type {
  LLMProvider,
  ModelInfo,
  CompletionRequest,
  CompletionResult,
  StructuredRequest,
  StructuredResult,
  Embedder,
  ForgeClient,
  GitHubClient,
  RepoRef,
  PrMeta,
  PrDetail,
  GitHubReviewPayload,
  CreateReviewCommentInput,
  PrReviewComment,
  OpenPrPayload,
  CommitFilesPayload,
  WorkflowRunSummary,
  IssueMeta,
  ReviewPublication,
  ReviewPublicationResult,
  GitClient,
  CloneOptions,
  UnifiedDiff,
  BlameLine,
  GitCommit,
  CodeIndex,
  CodeMatch,
  CodeSymbol,
  CodeReference,
  AuthProvider,
  AuthUser,
  AuthWorkspace,
  SecretsProvider,
  SecretKey,
  ContextListing,
  ContextDocContent,
  ContextAttachment,
} from '@devdigest/shared';
import type { ProjectContext, ResolvedRunContext } from '../modules/context/types.js';
import type {
  GitLabInstanceClient,
  InstanceVerification,
  InstanceVerifyInput,
} from './gitlab/index.js';
import { parseUnifiedDiff } from './git/diff-parser.js';

/**
 * Deterministic MOCK adapters for tests/dev — NO real network. Each mirrors the
 * adapter interface. The mock LLM returns a caller-supplied fixture (or a default)
 * for completeStructured, so review/grounding flows can be tested end-to-end.
 */

// ---------- Mock LLM ----------
export interface MockLLMOptions {
  models?: ModelInfo[];
  /** Fixture returned by completeStructured (validated against the schema). */
  structured?: unknown;
  /**
   * Per-schemaName fixtures, looked up by `req.schemaName`; falls back to
   * `structured` when no entry matches. Useful for keying a fixture to one call in
   * a flow that makes several, and for naming the schema under test explicitly —
   * e.g. 'ConventionExtraction' in the conventions tests.
   */
  structuredBySchema?: Record<string, unknown>;
  completionText?: string;
  embedding?: number[];
}

export class MockLLMProvider implements LLMProvider {
  readonly id: 'openai' | 'anthropic';
  public calls: { method: string; req: unknown }[] = [];

  constructor(
    id: 'openai' | 'anthropic' = 'openai',
    private opts: MockLLMOptions = {},
  ) {
    this.id = id;
  }

  async listModels(): Promise<ModelInfo[]> {
    this.calls.push({ method: 'listModels', req: null });
    return (
      this.opts.models ?? [
        { id: 'gpt-4.1', provider: this.id === 'anthropic' ? 'anthropic' : 'openai' },
      ]
    );
  }

  async complete(req: CompletionRequest): Promise<CompletionResult> {
    this.calls.push({ method: 'complete', req });
    return {
      text: this.opts.completionText ?? 'mock completion',
      model: req.model,
      tokensIn: 100,
      tokensOut: 50,
      costUsd: 0.001,
    };
  }

  async completeStructured<T>(req: StructuredRequest<T>): Promise<StructuredResult<T>> {
    this.calls.push({ method: 'completeStructured', req });
    const fixture = this.opts.structuredBySchema?.[req.schemaName] ?? this.opts.structured ?? {};
    const parsed = (req.schema as z.ZodType<T>).safeParse(fixture);
    if (!parsed.success) {
      throw new Error(`MockLLMProvider fixture failed schema: ${parsed.error.message}`);
    }
    return {
      data: parsed.data,
      model: req.model,
      tokensIn: 100,
      tokensOut: 50,
      costUsd: 0.001,
      raw: JSON.stringify(fixture),
      attempts: 1,
    };
  }

  async embed(texts: string[]): Promise<number[][]> {
    this.calls.push({ method: 'embed', req: texts });
    return texts.map(() => this.opts.embedding ?? new Array(1536).fill(0));
  }
}

// ---------- Mock Embedder ----------
export class MockEmbedder implements Embedder {
  readonly dims = 1536;
  async embed(texts: string[]): Promise<number[][]> {
    return texts.map((_, i) => new Array(1536).fill(0).map((_, j) => (i + j) % 2));
  }
}

// ---------- Mock GitHub ----------
export interface MockGitHubOptions {
  pulls?: PrMeta[];
  detail?: Partial<PrDetail>;
  login?: string;
  /** Existing inline review comments returned by listReviewComments. */
  comments?: PrReviewComment[];
  /** Seeds `listWorkflowRuns`; defaults to no runs. */
  workflowRuns?: WorkflowRunSummary[];
  /** Seeds `downloadRunArtifact`; defaults to no artifact. */
  runArtifact?: Uint8Array;
  /** When set, `publishReview` reports `not_posted` carrying this reason. */
  publishFailure?: string;
}

export class MockGitHubClient implements GitHubClient {
  public posted: { n: number; review: GitHubReviewPayload }[] = [];
  /** Every `publishReview` call, so a test can assert WHAT was published. */
  public published: { repo: RepoRef; n: number; payload: ReviewPublication }[] = [];
  public openedPrs: OpenPrPayload[] = [];
  public committed: CommitFilesPayload[] = [];
  public createdComments: CreateReviewCommentInput[] = [];

  constructor(private opts: MockGitHubOptions = {}) {}

  async listPullRequests(_repo: RepoRef): Promise<PrMeta[]> {
    return (
      this.opts.pulls ?? [
        {
          number: 482,
          title: 'Add rate limiting to public API endpoints',
          author: 'marisa.koch',
          branch: 'feat/rate-limit-public',
          base: 'main',
          head_sha: 'a1b2c3d4',
          additions: 247,
          deletions: 38,
          files_count: 9,
          status: 'open',
          opened_at: '2026-06-01T00:00:00Z',
          updated_at: '2026-06-01T03:00:00Z',
        },
      ]
    );
  }

  async getPullRequest(_repo: RepoRef, n: number): Promise<PrDetail> {
    const base: PrDetail = {
      number: n,
      title: 'Add rate limiting to public API endpoints',
      author: 'marisa.koch',
      branch: 'feat/rate-limit-public',
      base: 'main',
      head_sha: 'a1b2c3d4',
      additions: 247,
      deletions: 38,
      files_count: 9,
      status: 'open',
      body: 'Add rate limiting. Closes #471.',
      files: [
        {
          path: 'src/config.ts',
          additions: 4,
          deletions: 0,
          patch: '@@ -10,3 +10,4 @@\n   port: 3000,\n+  stripeKey: "sk_live_xxx",\n   redisUrl: x,',
        },
      ],
      commits: [
        { sha: 'a1b2c3d4', message: 'Add limiter', author: 'marisa.koch', committed_at: null },
      ],
      linked_issue: null,
    };
    return { ...base, ...this.opts.detail };
  }

  async postReview(_repo: RepoRef, n: number, review: GitHubReviewPayload): Promise<{ id: string }> {
    this.posted.push({ n, review });
    return { id: `mock-review-${n}` };
  }

  /**
   * GitHub's publication is ONE request, so the mock models only the two
   * outcomes the real adapter can reach — never `partially_published`, which
   * describes a note-by-note forge (SPEC-06 AC-39).
   */
  async publishReview(
    repo: RepoRef,
    n: number,
    payload: ReviewPublication,
  ): Promise<ReviewPublicationResult> {
    this.published.push({ repo, n, payload });
    if (this.opts.publishFailure) {
      return { outcome: 'not_posted', reason: this.opts.publishFailure, notesPublished: 0 };
    }
    return {
      outcome: 'posted_verdict_applied',
      reason: null,
      notesPublished: payload.notes.length + 1,
    };
  }

  async listReviewComments(_repo: RepoRef, _n: number): Promise<PrReviewComment[]> {
    return this.opts.comments ?? [];
  }

  async createReviewComment(
    _repo: RepoRef,
    _n: number,
    input: CreateReviewCommentInput,
  ): Promise<PrReviewComment> {
    this.createdComments.push(input);
    return {
      // String, like the real adapter's `String(c.id)` (SPEC-06 AC-23).
      id: String(this.createdComments.length),
      path: input.path,
      line: input.line,
      original_line: input.line,
      side: input.side ?? 'RIGHT',
      body: input.body,
      user: this.opts.login ?? 'mock-user',
      created_at: '2026-06-01T00:00:00Z',
      html_url: `https://github.com/mock/mock/pull/1#discussion_r${this.createdComments.length}`,
      in_reply_to_id: input.inReplyTo ?? null,
      is_outdated: false,
    };
  }

  async openPullRequest(_repo: RepoRef, payload: OpenPrPayload): Promise<{ url: string }> {
    this.openedPrs.push(payload);
    return { url: 'https://github.com/mock/mock/pull/1' };
  }

  async commitFiles(_repo: RepoRef, payload: CommitFilesPayload): Promise<{ branch: string }> {
    this.committed.push(payload);
    return { branch: payload.branch };
  }

  async findOpenPr(_repo: RepoRef, branch: string): Promise<{ url: string } | null> {
    const pr = this.openedPrs.find((p) => p.head === branch);
    return pr ? { url: 'https://github.com/mock/mock/pull/1' } : null;
  }

  async getIssue(_repo: RepoRef, n: number): Promise<IssueMeta> {
    return { number: n, title: `Issue #${n}`, body: 'mock issue', state: 'open' };
  }

  async currentLogin(): Promise<string> {
    return this.opts.login ?? 'mock-user';
  }

  async listWorkflowRuns(
    _repo: RepoRef,
    _opts: { workflowFile: string; perPage: number },
  ): Promise<WorkflowRunSummary[]> {
    return this.opts.workflowRuns ?? [];
  }

  async downloadRunArtifact(
    _repo: RepoRef,
    _runId: number,
    _name: string,
  ): Promise<Uint8Array | null> {
    return this.opts.runArtifact ?? null;
  }
}

// ---------- Mock Forge (provider-neutral, SPEC-06) ----------
/** What one repository's forge answers with. Seeded per instance key. */
export interface MockForgeSeed {
  pulls?: PrMeta[];
  detail?: Partial<PrDetail>;
  comments?: PrReviewComment[];
  /**
   * When set, EVERY call for this instance key rejects with this message —
   * the "one registered instance is offline" case (AC-43).
   */
  offline?: string;
  /**
   * Seeds what `publishReview` reports for this instance (SPEC-06 AC-39).
   * Seeded rather than derived, because the four outcomes are the whole point
   * of the port and a mock that only ever answers "posted" would let every
   * caller's degraded branch go unexercised (`server/INSIGHTS.md` 2026-08-28).
   * Defaults to `posted_verdict_applied` with every note published.
   */
  publication?: Omit<ReviewPublicationResult, 'notesPublished'> & { notesPublished?: number };
}

export interface MockForgeOptions extends MockForgeSeed {
  login?: string;
  /**
   * Per-instance-key overrides, looked up by `RepoRef.instanceKey` (absent ⇒
   * `'github.com'`, the legacy layout the port's docblock defines).
   *
   * THE MOCK BRANCHES ON `instanceKey` ON PURPOSE. A mock that ignored it would
   * answer identically for two repositories on two instances, and an isolation
   * test asserting they differ would pass having compared one value with itself
   * (`server/INSIGHTS.md` 2026-08-29).
   */
  byInstanceKey?: Record<string, MockForgeSeed>;
}

/**
 * `ForgeClient` mock — the seam that keeps ring 2 and ring 5 testable for a
 * provider that is not GitHub (`backend-onion-architecture` §9). Every call
 * records its `RepoRef`, so a test can assert WHICH repository was asked, not
 * merely that something was.
 */
export class MockForgeClient implements ForgeClient {
  /** Every ref this client was called with, in order. */
  public calls: { method: string; repo: RepoRef; n?: number }[] = [];
  public createdComments: { repo: RepoRef; n: number; input: CreateReviewCommentInput }[] = [];
  /** Every published review, so a test can assert the summary, the note count
   *  after the cap, and each note's side (SPEC-06 AC-34, AC-35, NFR-3). */
  public published: { repo: RepoRef; n: number; payload: ReviewPublication }[] = [];

  constructor(private opts: MockForgeOptions = {}) {}

  /** Absent `instanceKey` means the legacy github.com layout — see `RepoRef`. */
  private seedFor(repo: RepoRef): MockForgeSeed {
    const key = repo.instanceKey ?? 'github.com';
    return this.opts.byInstanceKey?.[key] ?? this.opts;
  }

  private enter(method: string, repo: RepoRef, n?: number): MockForgeSeed {
    this.calls.push({ method, repo, ...(n === undefined ? {} : { n }) });
    const seed = this.seedFor(repo);
    if (seed.offline) throw new Error(seed.offline);
    return seed;
  }

  async listPullRequests(repo: RepoRef): Promise<PrMeta[]> {
    return this.enter('listPullRequests', repo).pulls ?? [];
  }

  async getPullRequest(repo: RepoRef, n: number): Promise<PrDetail> {
    const seed = this.enter('getPullRequest', repo, n);
    const base: PrDetail = {
      number: n,
      title: `Change request !${n}`,
      author: 'mock.author',
      branch: 'feat/mock',
      base: 'main',
      head_sha: 'a1b2c3d4',
      additions: 3,
      deletions: 1,
      files_count: 1,
      status: 'open',
      opened_at: '2026-06-01T00:00:00Z',
      updated_at: '2026-06-01T03:00:00Z',
      body: null,
      files: [{ path: 'src/config.ts', additions: 3, deletions: 1, patch: null }],
      commits: [
        { sha: 'a1b2c3d4', message: 'Mock commit', author: 'mock.author', committed_at: null },
      ],
      linked_issue: null,
    };
    return { ...base, ...seed.detail };
  }

  async listReviewComments(repo: RepoRef, n: number): Promise<PrReviewComment[]> {
    return this.enter('listReviewComments', repo, n).comments ?? [];
  }

  async createReviewComment(
    repo: RepoRef,
    n: number,
    input: CreateReviewCommentInput,
  ): Promise<PrReviewComment> {
    this.enter('createReviewComment', repo, n);
    this.createdComments.push({ repo, n, input });
    return {
      id: `mock-discussion-${this.createdComments.length}`,
      path: input.path,
      line: input.line,
      original_line: input.line,
      side: input.side ?? 'RIGHT',
      body: input.body,
      user: this.opts.login ?? 'mock-user',
      created_at: '2026-06-01T00:00:00Z',
      html_url: `https://forge.test/mock/-/merge_requests/${n}#note_1`,
      in_reply_to_id: input.inReplyTo ?? null,
      is_outdated: false,
    };
  }

  async getIssue(repo: RepoRef, n: number): Promise<IssueMeta> {
    this.enter('getIssue', repo, n);
    return { number: n, title: `Issue #${n}`, body: 'mock issue', state: 'opened' };
  }

  async currentLogin(): Promise<string> {
    return this.opts.login ?? 'mock-user';
  }

  async publishReview(
    repo: RepoRef,
    n: number,
    payload: ReviewPublication,
  ): Promise<ReviewPublicationResult> {
    // `enter` throws for a seeded-offline instance, which is the "nothing
    // landed" path the caller must still turn into `not_posted` itself.
    const seed = this.enter('publishReview', repo, n);
    this.published.push({ repo, n, payload });
    const seeded = seed.publication;
    if (!seeded) {
      return {
        outcome: 'posted_verdict_applied',
        reason: null,
        notesPublished: payload.notes.length + 1,
      };
    }
    return {
      outcome: seeded.outcome,
      reason: seeded.reason,
      notesPublished: seeded.notesPublished ?? payload.notes.length + 1,
    };
  }
}

// ---------- Mock Git ----------
export interface MockGitOptions {
  diff?: string;
  files?: Record<string, string>;
  /** Name-only diff result (drives the incremental indexer's "changed files since X" path). */
  diffNameOnly?: string[];
  /** Override `currentHead()` so tests can simulate "sha unchanged since last index". */
  head?: string;
  /** Head `currentHead()` returns AFTER `sync()` runs — simulates fetch+reset advancing HEAD. */
  syncedHead?: string;
}

export class MockGitClient implements GitClient {
  public cloned: { repo: RepoRef; url: string }[] = [];
  public syncs: { repo: RepoRef; branch: string }[] = [];
  private syncedHead?: string;

  constructor(private opts: MockGitOptions = {}) {}

  /**
   * Mirrors `SimpleGitClient.clonePathFor`'s IDENTITY semantics, including the
   * legacy branch: an absent, empty or `'github.com'` `instanceKey` gives the
   * two-segment path (byte-identical to this mock's pre-SPEC-06 value, so no
   * existing expectation moves), and any other key is a path segment of its own.
   *
   * It has to. A mock that ignored `instanceKey` returns ONE string for two
   * repositories that differ only by instance, so any test asserting clone
   * isolation through the standard ring-2/ring-5 seam compares two identical
   * strings and passes having asserted nothing — the exact failure the real
   * change is meant to prevent.
   *
   * What it deliberately does NOT mirror is `clonePathFor`'s containment check:
   * that is a filesystem guard over a real `cloneDir`, and asserting it belongs
   * against `SimpleGitClient` itself, not against a mock with an invented root.
   */
  clonePathFor(repo: RepoRef): string {
    const key = repo.instanceKey;
    const legacy = key === undefined || key === '' || key === 'github.com';
    return legacy
      ? `/mock/clones/${repo.owner}/${repo.name}`
      : `/mock/clones/${key}/${repo.owner}/${repo.name}`;
  }
  async clone(repo: RepoRef, url: string, _opts?: CloneOptions): Promise<{ path: string }> {
    this.cloned.push({ repo, url });
    return { path: this.clonePathFor(repo) };
  }
  async fetchPullHead(): Promise<void> {}
  async sync(repo: RepoRef, branch: string): Promise<{ head: string }> {
    this.syncs.push({ repo, branch });
    // After a sync, HEAD advances to syncedHead (or stays at head if unset).
    this.syncedHead = this.opts.syncedHead ?? this.opts.head ?? 'a1b2c3d4';
    return { head: this.syncedHead };
  }
  async currentHead(): Promise<string> {
    return this.syncedHead ?? this.opts.head ?? 'a1b2c3d4';
  }
  async diffNameOnly(): Promise<string[]> {
    return this.opts.diffNameOnly ?? [];
  }
  async diff(): Promise<UnifiedDiff> {
    const raw =
      this.opts.diff ??
      'diff --git a/src/config.ts b/src/config.ts\n--- a/src/config.ts\n+++ b/src/config.ts\n@@ -10,3 +10,4 @@\n   port: 3000,\n+  stripeKey: "sk_live_xxx",\n   redisUrl: x,';
    return parseUnifiedDiff(raw);
  }
  async blame(): Promise<BlameLine[]> {
    return [{ line: 1, sha: 'a1b2c3d4', author: 'marisa.koch', date: '2026-06-01', summary: 'init' }];
  }
  async log(): Promise<GitCommit[]> {
    return [{ sha: 'a1b2c3d4', message: 'init', author: 'marisa.koch', date: '2026-06-01' }];
  }
  async readFile(_repo: RepoRef, path: string): Promise<string> {
    return this.opts.files?.[path] ?? '';
  }
}

// ---------- Mock CodeIndex ----------
export class MockCodeIndex implements CodeIndex {
  async grep(_repo: RepoRef, pattern: string): Promise<CodeMatch[]> {
    return [{ path: 'src/config.ts', line: 12, text: `match for ${pattern}` }];
  }
  async symbols(): Promise<CodeSymbol[]> {
    return [{ path: 'src/middleware/ratelimit.ts', name: 'rateLimit', kind: 'function', line: 25 }];
  }
  async references(_repo: RepoRef, symbol: string): Promise<CodeReference[]> {
    return [{ fromPath: 'src/api/public/index.ts', toSymbol: symbol, line: 23 }];
  }
}

// ---------- Mock Auth / Secrets ----------
export class MockAuthProvider implements AuthProvider {
  constructor(
    private user: AuthUser = { id: 'u1', email: 'you@local', name: 'You' },
    private workspace: AuthWorkspace = { id: 'w1', name: 'default' },
  ) {}
  async currentUser(): Promise<AuthUser> {
    return this.user;
  }
  async currentWorkspace(): Promise<AuthWorkspace> {
    return this.workspace;
  }
}

export class MockSecretsProvider implements SecretsProvider {
  constructor(private secrets: Partial<Record<string, string>> = {}) {}
  async get(key: SecretKey): Promise<string | undefined> {
    return this.secrets[key as string];
  }
  /**
   * Writable, because `set` is what the SPEC-06 registration path uses to store
   * an instance's access token — without it that path is untestable and the
   * service's "the secrets backend cannot store" branch would be the only one a
   * test could ever reach.
   *
   * `stored` is exposed so a test can assert WHERE a value went (under
   * `GITLAB_TOKEN_<id>`) and, just as importantly, that it went nowhere else.
   */
  async set(key: SecretKey, value: string): Promise<void> {
    this.secrets[key as string] = value;
  }
  get stored(): Partial<Record<string, string>> {
    return this.secrets;
  }
}

// ---------- Mock GitLab instance client (SPEC-06) ----------
/**
 * Instance verification with no network, no DNS and no TLS, so ring-2 and
 * ring-5 tests can exercise every registration outcome hermetically — which is
 * the only way to test them at all, since AC-4 forbids contacting a local
 * instance and no test may reach a real one.
 *
 * Defaults to a successful verification of a modern GitLab. Override per base
 * URL to make one instance fail while another succeeds (AC-12), or globally to
 * exercise one rejection code.
 *
 * `calls` records every verification attempt, which is how a test asserts both
 * that the access token was passed as an ARGUMENT (never read back out of a row
 * or a response, AC-10) and that testing one instance contacted only that one.
 */
export interface MockGitLabInstanceOptions {
  /** Applied to every base URL that has no entry in `byBaseUrl`. */
  result?: Partial<InstanceVerification>;
  byBaseUrl?: Record<string, Partial<InstanceVerification>>;
}

export class MockGitLabInstanceClient implements GitLabInstanceClient {
  readonly calls: InstanceVerifyInput[] = [];
  constructor(private opts: MockGitLabInstanceOptions = {}) {}

  async verify(input: InstanceVerifyInput): Promise<InstanceVerification> {
    this.calls.push(input);
    const override = this.opts.byBaseUrl?.[input.baseUrl] ?? this.opts.result ?? {};
    return {
      ok: true,
      code: null,
      message: 'Connected to GitLab 17.4.1 as @devdigest.',
      version: '17.4.1',
      // The CE/EE codebase flag, never the licensed tier — no integration
      // token can read the tier (root `INSIGHTS.md` 2026-08-28).
      edition: 'enterprise',
      // `unknown` is the honest default for an unprobed capability (AC-8).
      approvalCapability: 'unknown',
      login: 'devdigest',
      ...override,
    };
  }
}

// ---------- Mock ProjectContext (SPEC-01) ----------
/**
 * The project-context facade with no filesystem and no database, so ring-2 and
 * ring-5 tests can exercise the listing states, the attachment lists and the
 * run-time injection hermetically. Every option defaults to the empty answer,
 * which is also the "feature attached to nothing" path a pre-SPEC-01 run takes.
 *
 * It mirrors the real degraded contract: `resolveForRun` never throws.
 */
export interface MockProjectContextOptions {
  listing?: ContextListing;
  /** Keyed by path — anything absent reads as an unknown document. */
  docs?: Record<string, string>;
  agentDocs?: ContextAttachment[];
  skillDocs?: ContextAttachment[];
  run?: ResolvedRunContext;
}

export class MockProjectContext implements ProjectContext {
  constructor(private opts: MockProjectContextOptions = {}) {}

  async list(): Promise<ContextListing> {
    return this.opts.listing ?? { state: 'not_synced' };
  }
  async read(_ws: string, _repoId: string, path: string): Promise<ContextDocContent | null> {
    const content = this.opts.docs?.[path];
    if (content === undefined) return null;
    return { path, content, truncated: false };
  }
  async setRoots(_ws: string, _repoId: string, roots: string[]): Promise<string[] | null> {
    return roots;
  }
  async agentDocs(): Promise<ContextAttachment[] | null> {
    return this.opts.agentDocs ?? [];
  }
  async skillDocs(): Promise<ContextAttachment[] | null> {
    return this.opts.skillDocs ?? [];
  }
  async replaceAgentDocs(
    _ws: string,
    _agentId: string,
    paths: string[],
  ): Promise<ContextAttachment[] | null> {
    return paths.map((path, order) => ({ path, order, missing: false }));
  }
  async replaceSkillDocs(
    _ws: string,
    _skillId: string,
    paths: string[],
  ): Promise<ContextAttachment[] | null> {
    return paths.map((path, order) => ({ path, order, missing: false }));
  }
  async resolveForRun(): Promise<ResolvedRunContext> {
    return this.opts.run ?? { texts: [], read: [], skipped: [] };
  }
}
