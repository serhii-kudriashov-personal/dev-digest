import type { ApprovalCapability, InstanceRejectionCode } from '@devdigest/shared';
import type { RateGate } from '../../platform/resilience.js';
import { ForgeHttpError, GitLabHttp, type HostResolver } from './http.js';

/**
 * GitLab instance verification and capability probing (SPEC-06 — AC-3, AC-7,
 * AC-8, AC-9, AC-11, AC-45, AC-46, NFR-1, NFR-2, NFR-6).
 *
 * Three GitLab facts shape everything below, all recorded in root
 * `INSIGHTS.md` 2026-08-28 ("GitLab's licensed TIER is unreadable by a
 * non-admin credential, and the tier-gated probe returns the same 404 as 'not
 * permitted'"):
 *
 *  1. `GET /api/v4/metadata` reports `version` and an `enterprise` boolean, and
 *     that boolean distinguishes the CE from the EE **codebase** — not the
 *     licensed plan. The only endpoint that reports the plan needs administrator
 *     access, which an integration never has. So this file reports version and
 *     edition, and says nothing at all about the tier.
 *  2. A tier-gated endpoint answers **404 both for "not licensed" and for "not
 *     permitted"**, deliberately, so it never leaks existence. A 404 is
 *     therefore ambiguous by construction and can only ever map to `unknown` —
 *     mapping it to a definite negative would be presenting a guess as a fact.
 *  3. Merge-request approvals are a free-tier feature, so "this instance cannot
 *     approve" is a rare state; the ordinary failure is that the identity is not
 *     an eligible approver, which is a 403 and is a different answer.
 *
 * NFR-6: nothing here calls a model. NFR-5: nothing here costs money.
 */

/** What the caller supplies to verify one instance. */
export interface InstanceVerifyInput {
  /** Normalized `origin + pathPrefix`, already admitted by `forge-url.ts`. */
  baseUrl: string;
  /** Rate-gate key — the instance id once it has one, else its derived key. */
  instanceKey: string;
  /** Access key. Sent as a header by `GitLabHttp` and never persisted here. */
  credential: string;
}

/**
 * The outcome of one verification. A failure is a VALUE, not an exception: the
 * route needs to render the reason, and `code` is what it branches on.
 */
export interface InstanceVerification {
  ok: boolean;
  code: InstanceRejectionCode | null;
  /** Safe to display — composed from a status and a path, never from the key. */
  message: string;
  version: string | null;
  edition: string | null;
  approvalCapability: ApprovalCapability;
  /** The identity the instance attributed the key to, when it reported one. */
  login: string | null;
}

/**
 * The capability: verify one registered GitLab instance. Named for what it
 * does, not for the transport behind it (`backend-onion-architecture` §3).
 *
 * Resolve it from the container; `adapters/mocks.ts` carries the mock that
 * keeps ring 2 testable.
 */
export interface GitLabInstanceClient {
  verify(input: InstanceVerifyInput): Promise<InstanceVerification>;
}

/** Whole-verification budget (NFR-1): register and test both answer within it. */
export const INSTANCE_VERIFY_BUDGET_MS = 10_000;

const METADATA_PATH = '/api/v4/metadata';
const USER_PATH = '/api/v4/user';
/**
 * The approvals surface probed for AC-8/AC-9. Any status this file does not
 * recognise — 404 included — resolves to `unknown`, so an endpoint that moves
 * or does not exist on a given instance degrades to the honest answer rather
 * than to a confident negative.
 */
const APPROVAL_PROBE_PATH = '/api/v4/merge_request_approval_settings';

export interface GitLabInstanceClientOptions {
  gate?: RateGate;
  fetchImpl?: typeof fetch;
  resolveHost?: HostResolver;
  now?: () => number;
  budgetMs?: number;
}

export class GitLabInstanceHttpClient implements GitLabInstanceClient {
  private readonly gate?: RateGate;
  private readonly fetchImpl?: typeof fetch;
  private readonly resolveHost?: HostResolver;
  private readonly now: () => number;
  private readonly budgetMs: number;

  constructor(opts: GitLabInstanceClientOptions = {}) {
    this.gate = opts.gate;
    this.fetchImpl = opts.fetchImpl;
    this.resolveHost = opts.resolveHost;
    this.now = opts.now ?? (() => Date.now());
    this.budgetMs = opts.budgetMs ?? INSTANCE_VERIFY_BUDGET_MS;
  }

  async verify(input: InstanceVerifyInput): Promise<InstanceVerification> {
    const deadline = this.now() + this.budgetMs;
    const remaining = () => deadline - this.now();

    const http = new GitLabHttp({
      baseUrl: input.baseUrl,
      instanceKey: input.instanceKey,
      credential: input.credential,
      gate: this.gate,
      fetchImpl: this.fetchImpl,
      resolveHost: this.resolveHost,
    });

    try {
      if (remaining() <= 0) return fail('unreachable', 'Verification timed out.');

      // --- 1. Version and edition (AC-7) --------------------------------
      const metadata = await http.get(METADATA_PATH, { timeoutMs: remaining() });
      const metadataFailure = statusFailure(metadata.status, METADATA_PATH);
      if (metadataFailure) return metadataFailure;

      const meta = asRecord(metadata.body);
      const version = typeof meta?.version === 'string' ? meta.version : null;
      // `enterprise` is the CODEBASE flag, not the plan — see fact 1 above.
      const edition =
        typeof meta?.enterprise === 'boolean' ? (meta.enterprise ? 'enterprise' : 'community') : null;

      // --- 2. The identity the key belongs to (AC-45, AC-46) ------------
      if (remaining() <= 0) return fail('unreachable', 'Verification timed out.', version, edition);
      const user = await http.get(USER_PATH, { timeoutMs: remaining() });
      const userFailure = statusFailure(user.status, USER_PATH, version, edition);
      if (userFailure) return userFailure;

      const identity = asRecord(user.body);
      const login = typeof identity?.username === 'string' ? identity.username : null;

      // --- 3. Approval capability (AC-8, AC-9) --------------------------
      const approvalCapability =
        remaining() > 0 ? await this.probeApproval(http, remaining()) : 'unknown';

      return {
        ok: true,
        code: null,
        message: login
          ? `Connected to GitLab ${version ?? 'instance'} as @${login}.`
          : `Connected to GitLab ${version ?? 'instance'}.`,
        version,
        edition,
        approvalCapability,
        login,
      };
    } catch (err) {
      if (err instanceof ForgeHttpError) return fail(err.code, err.message);
      // Fail closed: an error this file cannot classify is not a pass.
      return fail('unreachable', 'The instance could not be verified.');
    }
  }

  /**
   * Three outcomes, never two. The `unknown` branch is the whole point: a 404
   * here is ambiguous by GitLab's own design (fact 2 above), so it must not
   * become a definite negative shown to an operator.
   */
  private async probeApproval(http: GitLabHttp, timeoutMs: number): Promise<ApprovalCapability> {
    try {
      const res = await http.get(APPROVAL_PROBE_PATH, { timeoutMs });
      if (res.status === 200) return 'permitted';
      if (res.status === 403) return 'refused';
      // 404 and every other status: ambiguous, so say so.
      return 'unknown';
    } catch {
      // A probe that could not complete tells us nothing about the capability.
      return 'unknown';
    }
  }
}

/**
 * Map an answered-but-unusable status onto its typed code. `null` means the
 * status was fine and the caller should read the body.
 */
function statusFailure(
  status: number,
  path: string,
  version: string | null = null,
  edition: string | null = null,
): InstanceVerification | null {
  if (status >= 200 && status < 300) return null;
  if (status === 401 || status === 403) {
    return fail(
      'credential_rejected',
      `The instance rejected the supplied access token (${status} on ${path}).`,
      version,
      edition,
    );
  }
  if (status === 404) {
    return fail(
      'capability_missing',
      `The instance does not expose ${path}; it may not be a GitLab instance.`,
      version,
      edition,
    );
  }
  return fail('unreachable', `The instance answered ${status} on ${path}.`, version, edition);
}

function fail(
  code: InstanceRejectionCode,
  message: string,
  version: string | null = null,
  edition: string | null = null,
): InstanceVerification {
  return {
    ok: false,
    code,
    message,
    version,
    edition,
    approvalCapability: 'unknown',
    login: null,
  };
}

function asRecord(body: unknown): Record<string, unknown> | null {
  return typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : null;
}
