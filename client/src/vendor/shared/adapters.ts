import { z } from 'zod';
import type {
  PrMeta,
  PrDetail,
  IssueMeta,
  PrReviewComment,
} from './contracts/platform.js';
import type { PostBackOutcome } from './contracts/review-api.js';
import type { Verdict } from './contracts/findings.js';

/**
 * Adapter interfaces. ALL external calls go behind these interfaces.
 * Real implementations live in `apps/api/src/adapters/*`; mock implementations
 * live alongside for tests/dev (Services depend on the interface, not the impl).
 */

// ---------- LLM ----------
export const ModelInfo = z.object({
  id: z.string(),
  provider: z.enum(['openai', 'anthropic', 'openrouter']),
  label: z.string().nullish(),
  created: z.number().int().nullish(),
  /** Pricing in USD per 1M tokens (when the provider exposes it, e.g. OpenRouter). */
  pricing: z
    .object({ promptPerM: z.number(), completionPerM: z.number() })
    .nullish(),
  /** Max context window in tokens (when the provider exposes it). */
  contextLength: z.number().int().nullish(),
});
export type ModelInfo = z.infer<typeof ModelInfo>;

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface CompletionRequest {
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;
}

export interface CompletionResult {
  text: string;
  model: string;
  tokensIn: number;
  tokensOut: number;
  costUsd: number | null;
}

/**
 * Structured-output request. `schema` is a Zod schema; `schemaName` names the
 * tool / json_schema. `maxRetries` controls reprompt-on-error.
 */
export interface StructuredRequest<T> {
  model: string;
  schema: z.ZodType<T>;
  schemaName: string;
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;
  maxRetries?: number;
  /**
   * OpenRouter provider routing. `{ requireParameters: true }` restricts the
   * request to providers that support every parameter sent — in particular
   * `response_format`. Structured-output support on OpenRouter is per ENDPOINT,
   * not per model, so without this a request can land on a provider that treats
   * the schema as a hint and the only symptom is the repair loop exhausting its
   * retries. Ignored by non-OpenRouter providers.
   *
   * OPT-IN on purpose: switching it on for every structured call would change
   * which providers serve every existing review run, invisibly and possibly at
   * a different price.
   */
  providerRouting?: { requireParameters?: boolean };
}

export interface StructuredResult<T> {
  data: T;
  model: string;
  tokensIn: number;
  tokensOut: number;
  costUsd: number | null;
  raw: string;
  attempts: number;
}

export interface LLMProvider {
  readonly id: 'openai' | 'anthropic';
  listModels(): Promise<ModelInfo[]>;
  complete(req: CompletionRequest): Promise<CompletionResult>;
  completeStructured<T>(req: StructuredRequest<T>): Promise<StructuredResult<T>>;
  embed(texts: string[]): Promise<number[][]>;
}

// ---------- Embedder ----------
export interface Embedder {
  /** OpenAI text-embedding-3-small → 1536 dims. */
  embed(texts: string[]): Promise<number[][]>;
  readonly dims: number;
}

// ---------- Forge (GitHub, GitLab — change requests, comments, issues) ----------
/**
 * How a repository is named to an adapter.
 *
 * `instanceKey` is OPTIONAL, and optional here means exactly one thing
 * (SPEC-06 — AC-17, AC-19): **absent selects the legacy github.com layout**,
 * `<cloneDir>/<owner>/<name>`, which is what keeps every clone already on disk
 * working without a re-import. It is a DEFAULT, not a "the caller does not care"
 * escape hatch.
 *
 * SO EVERY CALLER THAT REACHES `container.git` OR `container.codeIndex` MUST
 * PASS IT. `GitClient.clonePathFor` turns a `RepoRef` into a directory, and
 * `CodeIndex` resolves its root through that same method — so a bare
 * `{ owner, name }` built from a non-github.com repository row does not degrade,
 * it resolves to a DIFFERENT repository's clone: the one github.com would own at
 * those two segments. That is a read of another workspace's mirror, and
 * `sync()` `reset --hard`s it, so it is destructive as well (root `INSIGHTS.md`
 * 2026-08-16). The value is always available — `repos.instance_key` is
 * `NOT NULL DEFAULT 'github.com'` — so a row in scope is a value in scope.
 *
 * The field stays optional rather than required only because the legacy branch
 * must remain expressible; making it required is a separate decision that would
 * break AC-19's zero-migration path.
 */
export interface RepoRef {
  owner: string;
  name: string;
  /**
   * Filesystem-safe slug of the owning forge instance (`git_instances.instance_key`).
   * Present only for a repository imported from a registered instance; absent or
   * `'github.com'` selects the legacy `<cloneDir>/<owner>/<name>` layout.
   */
  instanceKey?: string;
}

/** One GitHub Actions workflow run, as GitHub itself describes it. This is
 *  the provenance for an ingested CI run (SPEC-05 AC-26) — never the
 *  uploaded result file. */
export interface WorkflowRunSummary {
  id: number;
  /** `html_url` — the Actions job page. Always present (AC-28). */
  htmlUrl: string;
  headSha: string;
  /** `queued` | `in_progress` | `completed`. */
  status: string;
  /** `success` | `failure` | `cancelled` | … ; null while not completed. */
  conclusion: string | null;
  /** ISO-8601. */
  createdAt: string;
  /** PR numbers GitHub attributes to this run; empty for a run it cannot
   *  attribute. */
  pullRequestNumbers: number[];
}

export interface GitHubReviewPayload {
  body: string;
  event: 'APPROVE' | 'REQUEST_CHANGES' | 'COMMENT';
  comments?: { path: string; line: number; body: string }[];
}

/** Create one standalone inline review comment (or a reply to a thread). */
export interface CreateReviewCommentInput {
  /** Head commit the comment pins to (GitHub requires commit_id). */
  commitId: string;
  path: string;
  line: number;
  side?: 'LEFT' | 'RIGHT';
  body: string;
  /**
   * When set, post as a reply to that comment's thread instead of a new one.
   *
   * A STRING, because a comment identity is a string on this port (SPEC-06
   * AC-23): GitHub numbers its review comments, GitLab names its discussions.
   * The adapter converts — `OctokitGitHubClient` parses this back to a number
   * on the way out, so GitHub behaviour above the adapter is unchanged (AC-27).
   */
  inReplyTo?: string;
}

/**
 * One inline note of a published review (SPEC-06 — AC-34, AC-35).
 *
 * `side` is what makes AC-35 expressible: `'RIGHT'` is a line of the new file
 * and `'LEFT'` a line of the old one, so an adapter can anchor an added line by
 * its new-side number and a removed line by its old-side number. The caller
 * states the side; no adapter guesses it from the line number.
 */
export interface ReviewPublicationNote {
  path: string;
  line: number;
  side: 'LEFT' | 'RIGHT';
  body: string;
}

/**
 * A whole review, ready to publish (SPEC-06 — AC-34…AC-41).
 *
 * The caller has ALREADY applied the note cap and composed `summary`; this
 * carries what goes on the change request, not the review it came from. `notes`
 * is therefore what will be posted, in the order it will be posted.
 */
export interface ReviewPublication {
  /** Posted as one change-request-level note (AC-34). */
  summary: string;
  notes: ReviewPublicationNote[];
  /** What the run concluded. How — or whether — it becomes a forge ACTION is
   *  the adapter's answer, reported through `ReviewPublicationResult`. */
  verdict: Verdict;
}

/**
 * How publication ended, in the same four states the user is shown (AC-39).
 *
 * The port reports rather than throws, because "some of it landed" is an
 * ordinary outcome on a forge where the summary note, each inline note and the
 * verdict are separate requests — an exception would lose the count of what
 * already reached the change request (AC-40).
 */
export interface ReviewPublicationResult {
  outcome: PostBackOutcome;
  /** Prose for the user: a refusal (AC-38), the `request_changes` downgrade
   *  (AC-41), or what failed. Null when the outcome needs nothing added. */
  reason: string | null;
  /** Notes that actually landed, summary note included. */
  notesPublished: number;
}

export interface OpenPrPayload {
  title: string;
  head: string;
  base: string;
  body: string;
}

/**
 * What EVERY forge can do (SPEC-06 — AC-20…AC-25). The provider-neutral read
 * path codes against this, never against `GitHubClient`: a pull request and a
 * merge request are the same conversation, so the capability is named for the
 * conversation and not for the vendor (`backend-onion-architecture` §3).
 *
 * Resolve it from `container.forge(repo)`, which picks the implementation from
 * the repository's own `provider`/`instance_id`. `container.github()` stays for
 * the GitHub-only surfaces below.
 *
 * The vocabulary is still GitHub's (`listPullRequests`, `n`) because renaming it
 * would touch every caller for no behavioural gain; the CONTRACT is neutral, and
 * `n` is the change request's number on GitHub and its `iid` on GitLab (AC-21 —
 * the store keys by repository + integer, so no new identifier is introduced).
 */
export interface ForgeClient {
  listPullRequests(repo: RepoRef): Promise<PrMeta[]>;
  getPullRequest(repo: RepoRef, n: number): Promise<PrDetail>;
  /** List inline review comments on a change request (the "Files changed" tab). */
  listReviewComments(repo: RepoRef, n: number): Promise<PrReviewComment[]>;
  /** Create one inline review comment (or reply); returns the new comment. */
  createReviewComment(
    repo: RepoRef,
    n: number,
    input: CreateReviewCommentInput,
  ): Promise<PrReviewComment>;
  getIssue(repo: RepoRef, n: number): Promise<IssueMeta>;
  /** The identity the configured credential belongs to — for "posting as @user". */
  currentLogin(): Promise<string>;
  /**
   * Publish a completed review onto the change request (SPEC-06 — AC-34…AC-41).
   *
   * REPORTS, never throws for an ordinary outcome. A forge where the summary
   * note, each inline note and the verdict are three separate requests can end
   * half-way, and an exception would discard the one fact the user needs: how
   * much of it already landed (AC-40).
   *
   * The verdict becomes a forge ACTION only where the forge has one. GitHub
   * applies all three as a review state; GitLab has approvals but no
   * "request changes" state, so that verdict is carried by the summary note and
   * the result says so in words (AC-41). Neither answer is predicted from a
   * capability probe — the action is attempted and its outcome reported (root
   * `INSIGHTS.md` 2026-08-28).
   */
  publishReview(
    repo: RepoRef,
    n: number,
    payload: ReviewPublication,
  ): Promise<ReviewPublicationResult>;
}

/**
 * GitHub, which is a forge PLUS the surfaces only GitHub has here: opening a
 * PR, committing files, and the two GitHub Actions reads the `ci` slice needs
 * (SPEC-05).
 *
 * It EXTENDS rather than re-declaring the neutral methods — a signature is
 * declared once (`backend-onion-architecture` §3), so widening `ForgeClient`
 * cannot leave this interface behind.
 *
 * Review publication is NO LONGER one of them: `publishReview` is provider-
 * neutral and lives on `ForgeClient` above (SPEC-06 — AC-34). `postReview`
 * stays here as GitHub's own single-request review API, which is what
 * `OctokitGitHubClient.publishReview` is implemented on top of.
 */
export interface GitHubClient extends ForgeClient {
  /**
   * GitHub's atomic "create review" call: body, event and inline comments in
   * ONE request. Prefer `publishReview` — this is the GitHub-shaped primitive
   * underneath it, kept because the payload's `event` vocabulary is GitHub's.
   */
  postReview(repo: RepoRef, n: number, review: GitHubReviewPayload): Promise<{ id: string }>;
  openPullRequest(repo: RepoRef, payload: OpenPrPayload): Promise<{ url: string }>;
  /** Recent runs of ONE workflow file, newest first, capped by `perPage`
   *  (SPEC-05 NFR-2). */
  listWorkflowRuns(
    repo: RepoRef,
    opts: { workflowFile: string; perPage: number },
  ): Promise<WorkflowRunSummary[]>;
  /** Raw bytes of the named artifact of a run, as a zip. `null` when the run
   *  uploaded no artifact of that name or it has expired. */
  downloadRunArtifact(repo: RepoRef, runId: number, name: string): Promise<Uint8Array | null>;
}

// ---------- Git (simple-git, heavy) ----------
export interface CloneOptions {
  depth?: number;
  branch?: string;
}

export interface DiffHunk {
  file: string;
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  /** Lines present in the *new* file covered by this hunk (for grounding). */
  newLineNumbers: number[];
}

export interface UnifiedDiff {
  raw: string;
  files: { path: string; additions: number; deletions: number; hunks: DiffHunk[] }[];
}

export interface BlameLine {
  line: number;
  sha: string;
  author: string;
  date: string;
  summary: string;
}

export interface GitCommit {
  sha: string;
  message: string;
  author: string;
  date: string;
}

export interface GitClient {
  clone(repo: RepoRef, url: string, opts?: CloneOptions): Promise<{ path: string }>;
  fetchPullHead(repo: RepoRef, n: number): Promise<void>;
  currentHead(repo: RepoRef): Promise<string>;
  diff(repo: RepoRef, base: string, head: string): Promise<UnifiedDiff>;
  blame(repo: RepoRef, path: string): Promise<BlameLine[]>;
  log(repo: RepoRef, path?: string): Promise<GitCommit[]>;
  readFile(repo: RepoRef, path: string): Promise<string>;
  clonePathFor(repo: RepoRef): string;
}

// ---------- CodeIndex (ripgrep + tree-sitter) ----------
export interface CodeMatch {
  path: string;
  line: number;
  text: string;
}

export interface CodeSymbol {
  path: string;
  name: string;
  kind: string;
  line: number;
}

export interface CodeReference {
  fromPath: string;
  toSymbol: string;
  line: number;
}

export interface CodeIndex {
  grep(repo: RepoRef, pattern: string): Promise<CodeMatch[]>;
  symbols(repo: RepoRef): Promise<CodeSymbol[]>;
  references(repo: RepoRef, symbol: string): Promise<CodeReference[]>;
}

// ---------- Auth (pluggable; MVP = LocalNoAuthProvider) ----------
export interface AuthUser {
  id: string;
  email: string;
  name: string;
}

export interface AuthWorkspace {
  id: string;
  name: string;
}

export interface AuthProvider {
  currentUser(req: unknown): Promise<AuthUser>;
  currentWorkspace(req: unknown): Promise<AuthWorkspace>;
}

// ---------- Secrets (pluggable; MVP = LocalSecretsProvider) ----------
export type SecretKey =
  | 'OPENAI_API_KEY'
  | 'ANTHROPIC_API_KEY'
  | 'GITHUB_TOKEN'
  | 'DATABASE_URL'
  | (string & {});

export interface SecretsProvider {
  get(key: SecretKey): Promise<string | undefined>;
  /**
   * Persist a secret (BYO key entered via the UI). Optional — read-only
   * providers (e.g. the env-only MVP backend) may omit it.
   */
  set?(key: SecretKey, value: string): Promise<void>;
}
