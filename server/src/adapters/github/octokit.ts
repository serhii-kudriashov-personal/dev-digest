import { Octokit } from 'octokit';
import type {
  GitHubClient,
  RepoRef,
  PrMeta,
  PrDetail,
  PrStatus,
  GitHubReviewPayload,
  CreateReviewCommentInput,
  PrReviewComment,
  OpenPrPayload,
  CommitFilesPayload,
  WorkflowRunSummary,
  IssueMeta,
  ReviewPublication,
  ReviewPublicationResult,
} from '@devdigest/shared';
import { withRetry, withTimeout } from '../../platform/resilience.js';

const TIMEOUT = 30_000;

function mapStatus(state: string, merged: boolean | undefined): PrStatus {
  if (merged) return 'merged';
  if (state === 'closed') return 'closed';
  return 'open';
}

/**
 * GitHubClient over Octokit REST — thin. PAT auth (fine-grained).
 * Reads PR list/detail/files/commits/issue; posts reviews; opens PRs.
 */
export class OctokitGitHubClient implements GitHubClient {
  private octokit: Octokit;

  constructor(token: string) {
    this.octokit = new Octokit({ auth: token });
  }

  async listPullRequests(repo: RepoRef): Promise<PrMeta[]> {
    return withRetry(() =>
      withTimeout(
        (async () => {
          // Fetch open + recently merged/closed (most-recently-updated first) so
          // the list shows which PRs are merged vs still open — not just open.
          const res = await this.octokit.rest.pulls.list({
            owner: repo.owner,
            repo: repo.name,
            state: 'all',
            sort: 'updated',
            direction: 'desc',
            per_page: 50,
          });
          return res.data.map((pr) => ({
            number: pr.number,
            title: pr.title,
            author: pr.user?.login ?? 'unknown',
            branch: pr.head.ref,
            base: pr.base.ref,
            head_sha: pr.head.sha,
            additions: 0,
            deletions: 0,
            files_count: 0, // not present on the list payload; populated by getPullRequest
            status: mapStatus(pr.state, Boolean(pr.merged_at)) as PrStatus,
            opened_at: pr.created_at,
            updated_at: pr.updated_at,
          }));
        })(),
        TIMEOUT,
      ),
    );
  }

  async getPullRequest(repo: RepoRef, n: number): Promise<PrDetail> {
    return withRetry(() =>
      withTimeout(
        (async () => {
          const { data: pr } = await this.octokit.rest.pulls.get({
            owner: repo.owner,
            repo: repo.name,
            pull_number: n,
          });
          const { data: files } = await this.octokit.rest.pulls.listFiles({
            owner: repo.owner,
            repo: repo.name,
            pull_number: n,
            per_page: 100,
          });
          const { data: commits } = await this.octokit.rest.pulls.listCommits({
            owner: repo.owner,
            repo: repo.name,
            pull_number: n,
            per_page: 100,
          });
          const linkedIssue = await this.resolveLinkedIssue(repo, pr.body ?? '');
          return {
            number: pr.number,
            title: pr.title,
            author: pr.user?.login ?? 'unknown',
            branch: pr.head.ref,
            base: pr.base.ref,
            head_sha: pr.head.sha,
            additions: pr.additions,
            deletions: pr.deletions,
            files_count: pr.changed_files,
            status: mapStatus(pr.state, Boolean(pr.merged_at)) as PrStatus,
            opened_at: pr.created_at,
            updated_at: pr.updated_at,
            body: pr.body,
            files: files.map((f) => ({
              path: f.filename,
              additions: f.additions,
              deletions: f.deletions,
              patch: f.patch,
            })),
            commits: commits.map((c) => ({
              sha: c.sha,
              message: c.commit.message,
              author: c.commit.author?.name ?? c.author?.login ?? 'unknown',
              committed_at: c.commit.author?.date,
            })),
            linked_issue: linkedIssue,
          };
        })(),
        TIMEOUT,
      ),
    );
  }

  /** linked issue via regex on PR body (#123 / closes #123). */
  private async resolveLinkedIssue(repo: RepoRef, body: string): Promise<IssueMeta | undefined> {
    const m = body.match(/(?:closes|fixes|resolves)?\s*#(\d+)/i);
    if (!m?.[1]) return undefined;
    try {
      return await this.getIssue(repo, Number(m[1]));
    } catch {
      return undefined;
    }
  }

  /**
   * GitHub's half of SPEC-06 AC-34/AC-39, on top of `postReview`.
   *
   * Only two of the four outcomes are reachable here, and that is a property of
   * the forge rather than a gap: `pulls.createReview` is ONE request carrying
   * the body, the event and every inline comment, so it either all lands with
   * the verdict applied (`posted_verdict_applied`) or none of it does
   * (`not_posted`). `partially_published` describes a forge that publishes note
   * by note, which GitHub is not.
   *
   * The cap and the summary text are the caller's; this method posts what it is
   * given.
   */
  async publishReview(
    repo: RepoRef,
    n: number,
    payload: ReviewPublication,
  ): Promise<ReviewPublicationResult> {
    const event =
      payload.verdict === 'approve'
        ? 'APPROVE'
        : payload.verdict === 'request_changes'
          ? 'REQUEST_CHANGES'
          : 'COMMENT';
    try {
      await this.postReview(repo, n, {
        body: payload.summary,
        event,
        // GitHub anchors a LEFT-side comment by the same `line` plus a `side`;
        // `postReview`'s payload carries no side, so an old-side note would land
        // on the new side. Sending it as `side` is not available on this
        // primitive, so the note keeps its line and GitHub resolves it against
        // the diff — unchanged from the pre-SPEC-06 shape of this call.
        comments: payload.notes.map((note) => ({
          path: note.path,
          line: note.line,
          body: note.body,
        })),
      });
      return {
        outcome: 'posted_verdict_applied',
        reason: null,
        // The summary is part of the same review object GitHub created.
        notesPublished: payload.notes.length + 1,
      };
    } catch (err) {
      return {
        outcome: 'not_posted',
        reason: err instanceof Error ? err.message : 'GitHub refused the review.',
        notesPublished: 0,
      };
    }
  }

  async postReview(
    repo: RepoRef,
    n: number,
    review: GitHubReviewPayload,
  ): Promise<{ id: string }> {
    return withRetry(() =>
      withTimeout(
        (async () => {
          const res = await this.octokit.rest.pulls.createReview({
            owner: repo.owner,
            repo: repo.name,
            pull_number: n,
            body: review.body,
            event: review.event,
            comments: review.comments?.map((c) => ({
              path: c.path,
              line: c.line,
              body: c.body,
            })),
          });
          return { id: String(res.data.id) };
        })(),
        TIMEOUT,
      ),
    );
  }

  /**
   * Shape an Octokit review-comment payload into our DTO.
   *
   * THIS IS THE BOUNDARY WHERE GITHUB'S INTEGER IDS BECOME STRINGS (SPEC-06
   * AC-23, AC-27). The port carries a string because GitLab names its
   * discussions, and the conversion lives here rather than one layer up so
   * nothing above the adapter can tell the contract changed: `String(c.id)` in,
   * `Number(input.inReplyTo)` back out in `createReviewComment`.
   */
  private mapReviewComment(c: {
    id: number;
    path: string;
    line?: number | null;
    original_line?: number | null;
    side?: string | null;
    body: string;
    user: { login: string } | null;
    created_at: string;
    html_url: string;
    in_reply_to_id?: number;
  }): PrReviewComment {
    return {
      id: String(c.id),
      path: c.path,
      line: c.line ?? null,
      original_line: c.original_line ?? null,
      side: c.side === 'LEFT' ? 'LEFT' : 'RIGHT',
      body: c.body,
      user: c.user?.login ?? 'unknown',
      created_at: c.created_at,
      html_url: c.html_url,
      in_reply_to_id: c.in_reply_to_id == null ? null : String(c.in_reply_to_id),
      // GitHub's own rule for `is_outdated` — it drops `line` when the comment
      // can no longer be placed on the diff. Each provider derives this
      // differently; the contract states the meaning, not this rule.
      is_outdated: c.line == null,
    };
  }

  async listReviewComments(repo: RepoRef, n: number): Promise<PrReviewComment[]> {
    return withRetry(() =>
      withTimeout(
        (async () => {
          const res = await this.octokit.rest.pulls.listReviewComments({
            owner: repo.owner,
            repo: repo.name,
            pull_number: n,
            per_page: 100,
          });
          return res.data.map((c) => this.mapReviewComment(c));
        })(),
        TIMEOUT,
      ),
    );
  }

  async createReviewComment(
    repo: RepoRef,
    n: number,
    input: CreateReviewCommentInput,
  ): Promise<PrReviewComment> {
    return withRetry(() =>
      withTimeout(
        (async () => {
          if (input.inReplyTo != null) {
            // Back to GitHub's own representation — the port's string id came
            // from `String(c.id)` above, so this is the exact inverse (AC-27).
            const commentId = Number(input.inReplyTo);
            if (!Number.isInteger(commentId)) {
              throw new Error(`'${input.inReplyTo}' is not a GitHub review-comment id`);
            }
            const res = await this.octokit.rest.pulls.createReplyForReviewComment({
              owner: repo.owner,
              repo: repo.name,
              pull_number: n,
              comment_id: commentId,
              body: input.body,
            });
            return this.mapReviewComment(res.data);
          }
          const res = await this.octokit.rest.pulls.createReviewComment({
            owner: repo.owner,
            repo: repo.name,
            pull_number: n,
            commit_id: input.commitId,
            path: input.path,
            line: input.line,
            side: input.side ?? 'RIGHT',
            body: input.body,
          });
          return this.mapReviewComment(res.data);
        })(),
        TIMEOUT,
      ),
    );
  }

  async openPullRequest(repo: RepoRef, payload: OpenPrPayload): Promise<{ url: string }> {
    return withRetry(() =>
      withTimeout(
        (async () => {
          const res = await this.octokit.rest.pulls.create({
            owner: repo.owner,
            repo: repo.name,
            title: payload.title,
            head: payload.head,
            base: payload.base,
            body: payload.body,
          });
          return { url: res.data.html_url };
        })(),
        TIMEOUT,
      ),
    );
  }

  async commitFiles(
    repo: RepoRef,
    payload: CommitFilesPayload,
  ): Promise<{ branch: string }> {
    return withRetry(() =>
      withTimeout(
        (async () => {
          const owner = repo.owner;
          const name = repo.name;
          const g = this.octokit.rest.git;

          // Parent commit: the target branch if it already exists, else the base.
          let parentSha: string;
          let branchExists = false;
          try {
            const ref = await g.getRef({ owner, repo: name, ref: `heads/${payload.branch}` });
            parentSha = ref.data.object.sha;
            branchExists = true;
          } catch {
            const baseRef = await g.getRef({ owner, repo: name, ref: `heads/${payload.base}` });
            parentSha = baseRef.data.object.sha;
          }

          // New tree layered on the parent's tree (so unrelated files are kept).
          const parentCommit = await g.getCommit({ owner, repo: name, commit_sha: parentSha });
          const tree = await g.createTree({
            owner,
            repo: name,
            base_tree: parentCommit.data.tree.sha,
            tree: payload.files.map((f) => ({
              path: f.path,
              mode: '100644',
              type: 'blob',
              content: f.contents,
            })),
          });

          const commit = await g.createCommit({
            owner,
            repo: name,
            message: payload.message,
            tree: tree.data.sha,
            parents: [parentSha],
          });

          if (branchExists) {
            await g.updateRef({
              owner,
              repo: name,
              ref: `heads/${payload.branch}`,
              sha: commit.data.sha,
              force: true,
            });
          } else {
            await g.createRef({
              owner,
              repo: name,
              ref: `refs/heads/${payload.branch}`,
              sha: commit.data.sha,
            });
          }
          return { branch: payload.branch };
        })(),
        TIMEOUT,
      ),
    );
  }

  async findOpenPr(repo: RepoRef, branch: string): Promise<{ url: string } | null> {
    return withRetry(() =>
      withTimeout(
        (async () => {
          const res = await this.octokit.rest.pulls.list({
            owner: repo.owner,
            repo: repo.name,
            state: 'open',
            head: `${repo.owner}:${branch}`,
            per_page: 1,
          });
          const pr = res.data[0];
          return pr ? { url: pr.html_url } : null;
        })(),
        TIMEOUT,
      ),
    );
  }

  async getIssue(repo: RepoRef, n: number): Promise<IssueMeta> {
    const res = await withRetry(() =>
      withTimeout(
        this.octokit.rest.issues.get({ owner: repo.owner, repo: repo.name, issue_number: n }),
        TIMEOUT,
      ),
    );
    return {
      number: res.data.number,
      title: res.data.title,
      body: res.data.body,
      state: res.data.state,
    };
  }

  async currentLogin(): Promise<string> {
    const res = await withRetry(() =>
      withTimeout(this.octokit.rest.users.getAuthenticated(), TIMEOUT),
    );
    return res.data.login;
  }

  async listWorkflowRuns(
    repo: RepoRef,
    opts: { workflowFile: string; perPage: number },
  ): Promise<WorkflowRunSummary[]> {
    try {
      const res = await withRetry(() =>
        withTimeout(
          this.octokit.rest.actions.listWorkflowRuns({
            owner: repo.owner,
            repo: repo.name,
            workflow_id: opts.workflowFile,
            per_page: opts.perPage,
          }),
          TIMEOUT,
        ),
      );
      return res.data.workflow_runs.map((run) => ({
        id: run.id,
        htmlUrl: run.html_url,
        headSha: run.head_sha,
        status: run.status ?? 'queued',
        conclusion: run.conclusion,
        createdAt: run.created_at,
        pullRequestNumbers: (run.pull_requests ?? []).map((pr) => pr.number),
      }));
    } catch (err) {
      // A repository where the setup PR has not been merged yet has no such
      // workflow file — that is a normal state, not an error.
      if (isNotFound(err)) return [];
      throw err;
    }
  }

  async downloadRunArtifact(
    repo: RepoRef,
    runId: number,
    name: string,
  ): Promise<Uint8Array | null> {
    const artifacts = await withRetry(() =>
      withTimeout(
        this.octokit.rest.actions.listWorkflowRunArtifacts({
          owner: repo.owner,
          repo: repo.name,
          run_id: runId,
          per_page: 100,
        }),
        TIMEOUT,
      ),
    );
    const artifact = artifacts.data.artifacts.find((a) => a.name === name);
    if (!artifact) return null;
    try {
      const res = await withRetry(() =>
        withTimeout(
          this.octokit.rest.actions.downloadArtifact({
            owner: repo.owner,
            repo: repo.name,
            artifact_id: artifact.id,
            archive_format: 'zip',
          }),
          TIMEOUT,
        ),
      );
      return new Uint8Array(res.data as ArrayBuffer);
    } catch (err) {
      // 410 Gone — the artifact has expired past its retention window.
      if (isGone(err)) return null;
      throw err;
    }
  }
}

function isNotFound(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { status?: number }).status === 404;
}

function isGone(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { status?: number }).status === 410;
}
