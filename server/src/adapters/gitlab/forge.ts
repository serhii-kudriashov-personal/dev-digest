import type {
  CreateReviewCommentInput,
  ForgeClient,
  IssueMeta,
  PrCommit,
  PrDetail,
  PrFile,
  PrMeta,
  PrReviewComment,
  PrStatus,
  RepoRef,
  ReviewPublication,
  ReviewPublicationNote,
  ReviewPublicationResult,
} from '@devdigest/shared';
import type { RateGate } from '../../platform/resilience.js';
import { ForgeHttpError, GitLabHttp, type ForgeResponse, type HostResolver } from './http.js';

/**
 * `ForgeClient` over GitLab's REST v4 API (SPEC-06 — AC-20…AC-25, AC-34…AC-41,
 * NFR-4, NFR-5, NFR-6, NFR-10).
 *
 * The whole job of this file is to absorb GitLab's representation so that
 * nothing above the port can tell which forge answered
 * (`backend-onion-architecture` §3): only `PrMeta`, `PrDetail`,
 * `PrReviewComment` and `IssueMeta` ever cross the boundary — never a raw
 * merge-request payload, never a note object, never a URL the instance chose.
 *
 * Five decisions worth stating, because each of them is a requirement rather
 * than a preference:
 *
 *  1. **The project is addressed by its URL-encoded path** (`group%2Fsub%2Fproj`),
 *     which is what makes an arbitrarily deep namespace addressable at all
 *     (AC-13, NFR-4). `RepoRef.owner` already carries every segment but the
 *     last (`repos/helpers.ts#resolveRepoUrl`), so the path is `owner/name`.
 *  2. **A merge request keeps its `iid`, as a number** (AC-21). The store keys a
 *     change request by repository + integer already (`db/schema/pulls.ts`), and
 *     the `iid` is the number in the merge request's own web URL — so no new
 *     identifier is introduced anywhere.
 *  3. **`closes_issues: []` means no linked issue** (AC-22) — `null`, never a
 *     placeholder. The instance's own answer is used; the description is never
 *     re-parsed for issue references, because the instance already did that.
 *  4. **`is_outdated` is DERIVED** (AC-24). GitLab exposes no outdated flag, so
 *     the note's stored `position` revision ids are compared against the merge
 *     request's current `diff_refs`. Nothing named `outdated` or `resolvable` is
 *     consulted: `resolved` is a human action, not a statement about the diff.
 *  5. **Every outbound link is rebuilt from the REGISTERED base URL**, never
 *     from the `web_url` the instance returned (AC-25). An instance that answers
 *     with an off-origin target therefore cannot get one rendered — the value is
 *     not carried far enough to be rendered at all.
 *  6. **Publishing a review REPORTS its outcome instead of throwing** (AC-39,
 *     AC-40). GitLab needs one request per note plus one for the verdict, so
 *     "half of it landed" is an ordinary result — see `publishReview` and
 *     `applyVerdict`, which also carry the reason a `403` on an approval is not
 *     a capability failure (AC-38).
 *
 * NFR-5/NFR-6: no model call and no cost anywhere in this file. NFR-2/NFR-10:
 * the abort and the per-instance rate gate both live in `http.ts`, which this
 * file uses rather than re-implements.
 */

/** Everything one registered GitLab instance needs to serve one repository. */
export interface GitLabForgeOptions {
  /** Normalized `origin + pathPrefix`, already admitted by `forge-url.ts`. */
  baseUrl: string;
  /** Rate-gate key — the instance id (NFR-10, NFR-11). */
  instanceKey: string;
  /** Access key. Header only, and never in a message (AC-10). */
  credential: string;
  /** Operator-chosen name, used to NAME the instance in a refusal (AC-45). */
  instanceLabel: string;
  /**
   * The operator's private-host opt-in, from `AppConfig.allowPrivateForgeHosts`
   * (SPEC-06 AC-4). Supplied by the composition root; consumed by `GitLabHttp`
   * on every request. Omitted means the shipped refusal.
   */
  allowedPrivateHosts?: readonly string[];
  gate?: RateGate;
  fetchImpl?: typeof fetch;
  resolveHost?: HostResolver;
  timeoutMs?: number;
}

/** GitLab's `state` for a merge request, mapped onto the shared vocabulary. */
function mapStatus(state: unknown): PrStatus {
  if (state === 'merged') return 'merged';
  if (state === 'closed' || state === 'locked') return 'closed';
  return 'open';
}

export class GitLabForgeClient implements ForgeClient {
  private readonly http: GitLabHttp;
  private readonly baseUrl: string;
  private readonly instanceLabel: string;

  constructor(opts: GitLabForgeOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/+$/, '');
    this.instanceLabel = opts.instanceLabel;
    this.http = new GitLabHttp({
      baseUrl: this.baseUrl,
      instanceKey: opts.instanceKey,
      credential: opts.credential,
      ...(opts.allowedPrivateHosts ? { allowedPrivateHosts: opts.allowedPrivateHosts } : {}),
      ...(opts.gate ? { gate: opts.gate } : {}),
      ...(opts.fetchImpl ? { fetchImpl: opts.fetchImpl } : {}),
      ...(opts.resolveHost ? { resolveHost: opts.resolveHost } : {}),
      ...(opts.timeoutMs === undefined ? {} : { timeoutMs: opts.timeoutMs }),
    });
  }

  // ---- Addressing ---------------------------------------------------------

  /** `group/sub/project` — every `RepoRef` segment, in order. */
  private namespacePath(repo: RepoRef): string {
    return repo.owner ? `${repo.owner}/${repo.name}` : repo.name;
  }

  /** GitLab's URL-encoded project id. The encoding IS the arbitrary-depth support. */
  private projectPath(repo: RepoRef): string {
    return `/api/v4/projects/${encodeURIComponent(this.namespacePath(repo))}`;
  }

  /** A link into the instance's own UI, built from the REGISTERED base URL only. */
  private webUrl(repo: RepoRef, iid: number, fragment = ''): string {
    return `${this.baseUrl}/${this.namespacePath(repo)}/-/merge_requests/${iid}${fragment}`;
  }

  // ---- Requests -----------------------------------------------------------

  /**
   * Answered-and-usable, or a typed refusal. A 401/403 names the instance and
   * says what the credential must be able to do, in behavioural terms rather
   * than as a list of scope names (AC-45).
   */
  private expectOk(res: ForgeResponse, what: string): ForgeResponse {
    if (res.status >= 200 && res.status < 300) return res;
    if (res.status === 401 || res.status === 403) {
      throw new ForgeHttpError(
        'credential_rejected',
        `${this.instanceLabel} rejected the stored access token. ` +
          'The token must be able to read merge requests and post notes on that instance.',
      );
    }
    if (res.status === 404) {
      throw new ForgeHttpError(
        'capability_missing',
        `${this.instanceLabel} has no ${what}, or the stored access token cannot see it.`,
      );
    }
    throw new ForgeHttpError(
      'unreachable',
      `${this.instanceLabel} answered ${res.status} for ${what}.`,
    );
  }

  private async getJson(path: string, what: string): Promise<unknown> {
    return this.expectOk(await this.http.get(path), what).body;
  }

  // ---- ForgeClient --------------------------------------------------------

  /**
   * Open merge requests (AC-20). Diff stats are deliberately zero here, exactly
   * as the GitHub adapter leaves them: GitLab's list payload carries no line
   * counts either, and the pulls route already backfills them from the detail
   * endpoint under its own cap.
   */
  async listPullRequests(repo: RepoRef): Promise<PrMeta[]> {
    const body = await this.getJson(
      `${this.projectPath(repo)}/merge_requests?state=opened&order_by=updated_at&sort=desc&per_page=50`,
      `merge requests for ${this.namespacePath(repo)}`,
    );
    if (!Array.isArray(body)) return [];
    return body.map((raw) => this.toPrMeta(asRecord(raw) ?? {}));
  }

  async getPullRequest(repo: RepoRef, n: number): Promise<PrDetail> {
    const project = this.projectPath(repo);
    const what = `merge request !${n} in ${this.namespacePath(repo)}`;

    const mr = asRecord(await this.getJson(`${project}/merge_requests/${n}`, what)) ?? {};
    const changes = asRecord(await this.getJson(`${project}/merge_requests/${n}/changes`, what));
    const commitsBody = await this.getJson(`${project}/merge_requests/${n}/commits`, what);
    const closes = await this.getJson(`${project}/merge_requests/${n}/closes_issues`, what);

    const files = toFiles(changes?.['changes']);
    const totals = files.reduce(
      (acc, f) => ({ additions: acc.additions + f.additions, deletions: acc.deletions + f.deletions }),
      { additions: 0, deletions: 0 },
    );

    return {
      ...this.toPrMeta(mr),
      additions: totals.additions,
      deletions: totals.deletions,
      files_count: files.length,
      body: typeof mr['description'] === 'string' ? mr['description'] : null,
      files,
      commits: toCommits(commitsBody),
      // AC-22: the instance's OWN answer about what this merge request closes.
      // An empty array is "nothing", not "unknown" — so it becomes null rather
      // than a placeholder issue.
      linked_issue: toLinkedIssue(closes),
    };
  }

  /**
   * Inline discussion notes as review comments (AC-23, AC-24).
   *
   * Two requests, both needed: the merge request carries the CURRENT
   * `diff_refs`, and the outdated derivation is a comparison against them —
   * there is nothing on a note that answers the question by itself.
   *
   * A discussion's root note is identified by the DISCUSSION id, and every
   * reply points back at it through `in_reply_to_id`, which is what lets a
   * consumer thread GitLab and GitHub with the same grouping rule.
   */
  async listReviewComments(repo: RepoRef, n: number): Promise<PrReviewComment[]> {
    const project = this.projectPath(repo);
    const what = `merge request !${n} in ${this.namespacePath(repo)}`;

    const mr = asRecord(await this.getJson(`${project}/merge_requests/${n}`, what)) ?? {};
    const current = asRecord(mr['diff_refs']);
    const discussions = await this.getJson(
      `${project}/merge_requests/${n}/discussions?per_page=100`,
      `discussions on ${what}`,
    );
    if (!Array.isArray(discussions)) return [];

    const out: PrReviewComment[] = [];
    for (const rawDiscussion of discussions) {
      const discussion = asRecord(rawDiscussion);
      const discussionId = discussion && typeof discussion['id'] === 'string' ? discussion['id'] : null;
      const notes = Array.isArray(discussion?.['notes']) ? (discussion['notes'] as unknown[]) : [];
      if (!discussionId || notes.length === 0) continue;

      const root = asRecord(notes[0]);
      const position = asRecord(root?.['position']);
      // Only inline notes belong on the "Files changed" tab. A discussion with
      // no position is a general comment on the merge request, and a `system`
      // note is GitLab narrating its own state changes.
      if (!position || root?.['system'] === true) continue;

      const outdated = isOutdated(position, current);
      const path =
        (typeof position['new_path'] === 'string' && position['new_path']) ||
        (typeof position['old_path'] === 'string' && position['old_path']) ||
        '';
      const newLine = intOrNull(position['new_line']);
      const oldLine = intOrNull(position['old_line']);

      notes.forEach((rawNote, index) => {
        const note = asRecord(rawNote);
        if (!note || note['system'] === true) return;
        const noteId = note['id'];
        const isRoot = index === 0;
        out.push({
          id: isRoot ? discussionId : `${discussionId}:${String(noteId)}`,
          path,
          // An outdated note does not anchor to the current diff, so it carries
          // no line — the same shape GitHub produces for its own outdated
          // comments, which is what keeps one renderer working for both.
          line: outdated ? null : newLine,
          original_line: newLine ?? oldLine,
          side: newLine === null && oldLine !== null ? 'LEFT' : 'RIGHT',
          body: typeof note['body'] === 'string' ? note['body'] : '',
          user: authorName(note['author']),
          created_at: typeof note['created_at'] === 'string' ? note['created_at'] : '',
          html_url: this.webUrl(repo, n, `#note_${String(noteId)}`),
          in_reply_to_id: isRoot ? null : discussionId,
          is_outdated: outdated,
        });
      });
    }
    return out;
  }

  /**
   * Post one inline note, or a reply into an existing discussion (AC-23).
   *
   * A reply targets the discussion the thread id names, which is why the port's
   * comment identity is a string: GitLab's discussion id is opaque and does not
   * reverse into an integer.
   */
  async createReviewComment(
    repo: RepoRef,
    n: number,
    input: CreateReviewCommentInput,
  ): Promise<PrReviewComment> {
    const project = this.projectPath(repo);
    const what = `merge request !${n} in ${this.namespacePath(repo)}`;

    if (input.inReplyTo != null) {
      // A reply id may be a root (`<discussion>`) or a note (`<discussion>:<id>`);
      // both reply into the same discussion.
      const discussionId = input.inReplyTo.split(':')[0]!;
      const res = this.expectOk(
        await this.http.post(
          `${project}/merge_requests/${n}/discussions/${encodeURIComponent(discussionId)}/notes`,
          { body: input.body },
        ),
        `a reply on ${what}`,
      );
      const note = asRecord(res.body) ?? {};
      return this.toPostedComment(repo, n, input, {
        id: `${discussionId}:${String(note['id'])}`,
        inReplyToId: discussionId,
        noteId: note['id'],
        createdAt: note['created_at'],
        author: note['author'],
      });
    }

    const mr = asRecord(await this.getJson(`${project}/merge_requests/${n}`, what)) ?? {};
    const refs = asRecord(mr['diff_refs']) ?? {};
    const res = this.expectOk(
      await this.http.post(`${project}/merge_requests/${n}/discussions`, {
        body: input.body,
        position: {
          position_type: 'text',
          base_sha: refs['base_sha'],
          head_sha: refs['head_sha'],
          start_sha: refs['start_sha'],
          new_path: input.path,
          old_path: input.path,
          ...(input.side === 'LEFT' ? { old_line: input.line } : { new_line: input.line }),
        },
      }),
      `a note on ${what}`,
    );
    const discussion = asRecord(res.body) ?? {};
    const notes = Array.isArray(discussion['notes']) ? (discussion['notes'] as unknown[]) : [];
    const note = asRecord(notes[0]) ?? {};
    return this.toPostedComment(repo, n, input, {
      id: typeof discussion['id'] === 'string' ? discussion['id'] : String(note['id']),
      inReplyToId: null,
      noteId: note['id'],
      createdAt: note['created_at'],
      author: note['author'],
    });
  }

  async getIssue(repo: RepoRef, n: number): Promise<IssueMeta> {
    const body = asRecord(
      await this.getJson(
        `${this.projectPath(repo)}/issues/${n}`,
        `issue #${n} in ${this.namespacePath(repo)}`,
      ),
    );
    return toIssue(body, n);
  }

  async currentLogin(): Promise<string> {
    const body = asRecord(await this.getJson('/api/v4/user', 'the current user'));
    return typeof body?.['username'] === 'string' ? body['username'] : 'unknown';
  }

  // ---- Publishing a review (AC-34…AC-41) ----------------------------------

  /**
   * Publish a review onto a merge request (AC-34, AC-35, AC-39, AC-40).
   *
   * GitLab has no single "create review" call, so this is four steps in order:
   * read the merge request's `diff_refs`, post the summary as a merge-request
   * note, post each finding as a diff note, then attempt the verdict. Each step
   * can fail on its own, which is exactly why the port reports an outcome
   * instead of throwing — the count of what already landed is the answer AC-40
   * asks for and an exception would throw it away.
   *
   * Ordering is load-bearing. The summary goes FIRST so that a failure before
   * it means nothing landed (`not_posted`) and any failure after it means
   * something did (`partially_published`). And a partial publication does NOT
   * go on to attempt the verdict: applying an approval to a merge request that
   * carries half a review is a worse state than not applying one.
   */
  async publishReview(
    repo: RepoRef,
    n: number,
    payload: ReviewPublication,
  ): Promise<ReviewPublicationResult> {
    const project = this.projectPath(repo);
    const what = `merge request !${n} in ${this.namespacePath(repo)}`;
    const totalNotes = payload.notes.length + 1;

    let refs: Record<string, unknown>;
    try {
      const mr = asRecord(await this.getJson(`${project}/merge_requests/${n}`, what)) ?? {};
      refs = asRecord(mr['diff_refs']) ?? {};
    } catch (err) {
      return { outcome: 'not_posted', reason: reasonFrom(err, `read ${what}`), notesPublished: 0 };
    }

    let published = 0;
    try {
      this.expectOk(
        await this.http.post(`${project}/merge_requests/${n}/notes`, { body: payload.summary }),
        `the summary note on ${what}`,
      );
      published++;
    } catch (err) {
      return {
        outcome: 'not_posted',
        reason: reasonFrom(err, `post the summary note on ${what}`),
        notesPublished: 0,
      };
    }

    for (const note of payload.notes) {
      try {
        this.expectOk(
          await this.http.post(`${project}/merge_requests/${n}/discussions`, {
            body: note.body,
            position: positionFor(note, refs),
          }),
          `an inline note on ${what}`,
        );
        published++;
      } catch (err) {
        // AC-40: something landed, so this is not a failure — it is a partial
        // publication, and the user is told how much of it got through.
        return {
          outcome: 'partially_published',
          reason:
            `${published} of ${totalNotes} notes reached ${what} before publication stopped: ` +
            `${reasonFrom(err, `post an inline note on ${what}`)} ` +
            'The verdict was not applied.',
          notesPublished: published,
        };
      }
    }

    const verdict = await this.applyVerdict(project, n, what, payload.verdict);
    return {
      outcome: verdict.applied ? 'posted_verdict_applied' : 'posted_verdict_not_applied',
      reason: verdict.reason,
      notesPublished: published,
    };
  }

  /**
   * Turn the run's verdict into a GitLab action, or say why it did not become
   * one (AC-36, AC-37, AC-38, AC-41).
   *
   * THE TIER TRAP, and why nothing here predicts availability. Merge-request
   * approvals are a FREE-tier feature — `POST .../approve` and `.../unapprove`
   * work on every edition; only the *enforcement* of approval rules is paid
   * (root `INSIGHTS.md` 2026-08-28). So a `403` here does NOT mean "this
   * instance cannot approve". It almost always means the credential's user is
   * not an eligible approver: an approver must be a project or group member,
   * and by default the merge request's own author is not one. That is the
   * common case, it gets its own reason, and it is never reported as a missing
   * capability. A `404` is ambiguous by GitLab's own design — it answers 404
   * for both "not licensed" and "not permitted" so as not to leak existence —
   * so it is reported as unknown rather than as a confident refusal.
   *
   * The honest design is therefore to ATTEMPT the action and report the
   * outcome, never to probe a capability at setup and predict from it.
   *
   * Two readings the spec's state diagram leaves open, resolved here:
   *
   *  - A `comment` verdict has no GitLab action to take and needs none — the
   *    summary note IS the comment. It counts as applied, with no reason.
   *  - A `request_changes` verdict that DID withdraw a standing approval took a
   *    real forge action, so it counts as applied (the diagram's "withdrawal
   *    accepted") — but it still states in words that GitLab carries the
   *    verdict in the note rather than as a blocking review state (AC-41). With
   *    no approval to withdraw there is no action at all, so it is not applied,
   *    and the same sentence explains why.
   */
  private async applyVerdict(
    project: string,
    n: number,
    what: string,
    verdict: ReviewPublication['verdict'],
  ): Promise<{ applied: boolean; reason: string | null }> {
    if (verdict === 'comment') return { applied: true, reason: null };

    if (verdict === 'approve') {
      try {
        const res = await this.http.post(`${project}/merge_requests/${n}/approve`, {});
        if (res.status >= 200 && res.status < 300) return { applied: true, reason: null };
        return { applied: false, reason: this.approvalRefusal(res.status, what, 'approve') };
      } catch (err) {
        return {
          applied: false,
          reason: `The notes were posted, but ${reasonFrom(err, `approve ${what}`)}`,
        };
      }
    }

    // request_changes — AC-37 and AC-41.
    const carriedInNote =
      'GitLab has no "request changes" review state, so the requested changes are ' +
      'carried by the summary note rather than as a blocking review state.';

    let holdsApproval: boolean;
    try {
      holdsApproval = await this.holdsApproval(project, n);
    } catch (err) {
      return {
        applied: false,
        reason:
          `${carriedInNote} DevDigest could not check whether it currently approves ` +
          `${what}, so no approval was withdrawn: ${reasonFrom(err, 'read the approvals')}`,
      };
    }
    if (!holdsApproval) {
      return {
        applied: false,
        reason: `${carriedInNote} DevDigest holds no approval on ${what}, so none was withdrawn.`,
      };
    }

    try {
      const res = await this.http.post(`${project}/merge_requests/${n}/unapprove`, {});
      if (res.status >= 200 && res.status < 300) {
        return {
          applied: true,
          reason: `${carriedInNote} DevDigest's earlier approval of ${what} was withdrawn.`,
        };
      }
      return {
        applied: false,
        reason: `${carriedInNote} ${this.approvalRefusal(res.status, what, 'unapprove')}`,
      };
    } catch (err) {
      return {
        applied: false,
        reason: `${carriedInNote} ${reasonFrom(err, `withdraw the approval on ${what}`)}`,
      };
    }
  }

  /** Does the stored credential's own user currently approve this merge request? */
  private async holdsApproval(project: string, n: number): Promise<boolean> {
    const me = await this.currentLogin();
    const body = asRecord(
      await this.getJson(`${project}/merge_requests/${n}/approvals`, 'the approvals'),
    );
    const approvedBy = Array.isArray(body?.['approved_by']) ? body['approved_by'] : [];
    return approvedBy.some((raw) => authorName(asRecord(raw)?.['user']) === me);
  }

  /** The user-facing half of the tier trap documented on `applyVerdict`. */
  private approvalRefusal(status: number, what: string, action: 'approve' | 'unapprove'): string {
    const verb = action === 'approve' ? 'approve' : 'withdraw its approval of';
    if (status === 401 || status === 403) {
      return (
        `The notes were posted, but ${this.instanceLabel} would not let the stored access ` +
        `token ${verb} ${what}. Approving requires the token's own user to be an eligible ` +
        "approver — a member of the project or its group, and by default not the merge " +
        'request\'s author.'
      );
    }
    if (status === 404) {
      return (
        `The notes were posted, but ${this.instanceLabel} answered 404 when asked to ` +
        `${verb} ${what}. GitLab answers 404 both for "not permitted" and for "not ` +
        'available", so whether the token may approve there is unknown.'
      );
    }
    return `The notes were posted, but ${this.instanceLabel} answered ${status} when asked to ${verb} ${what}.`;
  }

  // ---- Mapping ------------------------------------------------------------

  private toPrMeta(mr: Record<string, unknown>): PrMeta {
    const iid = intOrNull(mr['iid']) ?? 0;
    return {
      number: iid,
      title: typeof mr['title'] === 'string' ? mr['title'] : '',
      author: authorName(mr['author']),
      branch: typeof mr['source_branch'] === 'string' ? mr['source_branch'] : '',
      base: typeof mr['target_branch'] === 'string' ? mr['target_branch'] : '',
      head_sha: headSha(mr),
      // Not on GitLab's list payload; the route backfills from the detail call.
      additions: 0,
      deletions: 0,
      files_count: 0,
      status: mapStatus(mr['state']),
      opened_at: typeof mr['created_at'] === 'string' ? mr['created_at'] : null,
      updated_at: typeof mr['updated_at'] === 'string' ? mr['updated_at'] : null,
    };
  }

  private toPostedComment(
    repo: RepoRef,
    n: number,
    input: CreateReviewCommentInput,
    posted: {
      id: string;
      inReplyToId: string | null;
      noteId: unknown;
      createdAt: unknown;
      author: unknown;
    },
  ): PrReviewComment {
    return {
      id: posted.id,
      path: input.path,
      line: input.line,
      original_line: input.line,
      side: input.side ?? 'RIGHT',
      body: input.body,
      user: authorName(posted.author),
      created_at: typeof posted.createdAt === 'string' ? posted.createdAt : new Date().toISOString(),
      html_url: this.webUrl(repo, n, `#note_${String(posted.noteId)}`),
      in_reply_to_id: posted.inReplyToId,
      // Just written against the merge request's current revisions.
      is_outdated: false,
    };
  }
}

// ---- Pure mapping helpers ------------------------------------------------

/**
 * Anchor one diff note (AC-35).
 *
 * All three revision ids go on every note, because GitLab needs the base, the
 * start and the head to place a note against a specific revision of the diff —
 * the same triple `isOutdated` later compares against.
 *
 * The SIDE decides which line field is sent, and only one is: an added line is
 * `new_line`, a removed line is `old_line`. Sending both, or the wrong one,
 * lands the note on the wrong side of the diff — which is the whole failure
 * AC-35 exists to name. `old_path` and `new_path` are both sent because a
 * renamed file has two, and this port carries one path per note.
 */
function positionFor(
  note: ReviewPublicationNote,
  refs: Record<string, unknown>,
): Record<string, unknown> {
  return {
    position_type: 'text',
    base_sha: refs['base_sha'],
    head_sha: refs['head_sha'],
    start_sha: refs['start_sha'],
    old_path: note.path,
    new_path: note.path,
    ...(note.side === 'LEFT' ? { old_line: note.line } : { new_line: note.line }),
  };
}

/**
 * A sentence for the user out of a failure. `ForgeHttpError` and the refusals
 * `expectOk` builds are already composed from a method, a path and a status and
 * carry no credential; anything else is described by what was being attempted
 * rather than by interpolating an error this file did not build.
 */
function reasonFrom(err: unknown, attempted: string): string {
  if (err instanceof ForgeHttpError) return err.message;
  return `DevDigest could not ${attempted}.`;
}

function asRecord(body: unknown): Record<string, unknown> | null {
  return typeof body === 'object' && body !== null && !Array.isArray(body)
    ? (body as Record<string, unknown>)
    : null;
}

function intOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) ? value : null;
}

function authorName(author: unknown): string {
  const record = asRecord(author);
  const username = record?.['username'];
  return typeof username === 'string' && username ? username : 'unknown';
}

/** `sha` on the list payload, `diff_refs.head_sha` on the detail one. */
function headSha(mr: Record<string, unknown>): string {
  if (typeof mr['sha'] === 'string') return mr['sha'];
  const refs = asRecord(mr['diff_refs']);
  return typeof refs?.['head_sha'] === 'string' ? refs['head_sha'] : '';
}

/**
 * AC-24, the whole derivation. A note anchors to the current diff only while
 * ALL THREE revision ids it was written against are still the merge request's
 * own. Anything else — a missing ref, a superseded head, a rebased base — is
 * outdated, which is the fail-closed direction: an unanchorable note shown as
 * anchored would point the reader at the wrong line.
 */
function isOutdated(
  position: Record<string, unknown>,
  current: Record<string, unknown> | null,
): boolean {
  if (!current) return true;
  for (const key of ['base_sha', 'head_sha', 'start_sha'] as const) {
    const noted = position[key];
    const live = current[key];
    if (typeof noted !== 'string' || typeof live !== 'string' || noted !== live) return true;
  }
  return false;
}

function toFiles(changes: unknown): PrFile[] {
  if (!Array.isArray(changes)) return [];
  return changes.map((raw) => {
    const change = asRecord(raw) ?? {};
    const patch = typeof change['diff'] === 'string' ? change['diff'] : null;
    const counted = countDiffLines(patch);
    return {
      path:
        (typeof change['new_path'] === 'string' && change['new_path']) ||
        (typeof change['old_path'] === 'string' && change['old_path']) ||
        '',
      additions: counted.additions,
      deletions: counted.deletions,
      patch,
    };
  });
}

/**
 * GitLab reports no per-file line counts, so they are counted off the hunk
 * text. `+++`/`---` are the file headers, not content — GitLab's `diff` field
 * usually omits them, and skipping them costs nothing if it does not.
 */
function countDiffLines(patch: string | null): { additions: number; deletions: number } {
  if (!patch) return { additions: 0, deletions: 0 };
  let additions = 0;
  let deletions = 0;
  for (const line of patch.split('\n')) {
    if (line.startsWith('+++') || line.startsWith('---')) continue;
    if (line.startsWith('+')) additions++;
    else if (line.startsWith('-')) deletions++;
  }
  return { additions, deletions };
}

function toCommits(body: unknown): PrCommit[] {
  if (!Array.isArray(body)) return [];
  return body.map((raw) => {
    const commit = asRecord(raw) ?? {};
    return {
      sha: typeof commit['id'] === 'string' ? commit['id'] : '',
      message: typeof commit['message'] === 'string' ? commit['message'] : '',
      author: typeof commit['author_name'] === 'string' ? commit['author_name'] : 'unknown',
      committed_at:
        typeof commit['committed_date'] === 'string'
          ? commit['committed_date']
          : typeof commit['created_at'] === 'string'
            ? commit['created_at']
            : null,
    };
  });
}

/** AC-22 — an empty answer is `null`, never a placeholder issue. */
function toLinkedIssue(closes: unknown): IssueMeta | null {
  if (!Array.isArray(closes) || closes.length === 0) return null;
  const first = asRecord(closes[0]);
  if (!first) return null;
  const iid = intOrNull(first['iid']);
  if (iid === null) return null;
  return toIssue(first, iid);
}

function toIssue(issue: Record<string, unknown> | null, fallbackNumber: number): IssueMeta {
  return {
    number: intOrNull(issue?.['iid']) ?? fallbackNumber,
    title: typeof issue?.['title'] === 'string' ? issue['title'] : '',
    body: typeof issue?.['description'] === 'string' ? issue['description'] : null,
    state: typeof issue?.['state'] === 'string' ? issue['state'] : 'opened',
  };
}
