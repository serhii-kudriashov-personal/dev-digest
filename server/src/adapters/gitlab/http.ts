import { lookup } from 'node:dns/promises';
import type { InstanceRejectionCode } from '@devdigest/shared';
import {
  allowlistHint,
  isAllowlistablePrivateAddress,
  isRefusedAddress,
} from '../../modules/_shared/forge-url.js';
import { RateGate } from '../../platform/resilience.js';

/**
 * One HTTP client for one registered GitLab instance (SPEC-06 — AC-3, AC-4,
 * AC-10, AC-11, NFR-2, NFR-10, NFR-11).
 *
 * The operator's base URL decides where this process opens a connection and
 * where an access key is sent, so this file is the outbound half of the SSRF
 * control and every branch in it is fail-closed: an outcome it cannot classify
 * becomes `unreachable`, never a pass (`security` §A05/§A10).
 *
 * What it guarantees, in the order the guarantees apply:
 *
 *  1. **The host is re-resolved before EVERY request** and every answer is
 *     classified (AC-4 runtime half). The syntactic half — IP literals,
 *     loopback names, userinfo, `http:` — already ran in
 *     `modules/_shared/forge-url.ts`, which is where the shared predicate lives.
 *     Per request, not per client: `verify()` alone makes three requests off one
 *     client, so a check latched after the first would leave the other two
 *     unguarded and a record that flips mid-verification would go unnoticed.
 *     The operator's per-host opt-in (`allowedPrivateHosts`) is applied by the
 *     SAME predicate the syntactic half uses, so the two cannot disagree about
 *     which ranges it widens — and it is applied inside the per-request check,
 *     never as a construction-time decision that stops re-evaluating.
 *  2. **A redirect is reported, never followed** (`redirect: 'manual'`, AC-11).
 *     Following one would let the instance choose the next destination, which
 *     is the whole reason the base URL is admitted up front.
 *  3. **Every request carries its own abort** (NFR-2), so a silent instance
 *     cannot hold a request open.
 *  4. **A certificate failure is distinguishable from unreachable** (AC-3), by
 *     reading `cause.code` off the `TypeError` `fetch` throws.
 *  5. **The access key travels in a header and nowhere else** (AC-10). It is
 *     never put in a URL, never logged, and no error message built here can
 *     contain it — every message is composed from the method, the path and a
 *     status.
 *  6. **Rate limiting is per instance** (NFR-10, NFR-11), through a `RateGate`
 *     keyed by the instance; a `429` from one instance never defers another.
 *
 * One residual worth naming for review, and deliberately NOT closed here:
 * resolving the host and then handing the hostname to `fetch` leaves a
 * DNS-rebinding window, because `fetch` resolves again itself. Checking per
 * request rather than per client NARROWS that window — it is now one
 * resolve-to-connect gap per request instead of one per client, so a record that
 * flips between the second and third request of a `verify()` is caught — but it
 * does not close it. Closing it needs a dispatcher that dials the address this
 * file already validated instead of re-resolving the name (undici
 * `Agent({ connect: { lookup } })` or equivalent). That is a tracked follow-up,
 * not something this file does today.
 */

/** GitLab's header for a personal / project / group access key. */
const AUTH_HEADER = 'PRIVATE-TOKEN';

/** Per-request abort (NFR-2). */
export const FORGE_REQUEST_TIMEOUT_MS = 30_000;

/** Refuse a response body larger than this rather than buffering it. */
export const FORGE_MAX_BODY_BYTES = 2 * 1024 * 1024;

/** `cause.code` values Node reports for a chain it will not verify (AC-3). */
const TLS_ERROR_CODES = new Set([
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'SELF_SIGNED_CERT_IN_CHAIN',
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'CERT_HAS_EXPIRED',
  'ERR_TLS_CERT_ALTNAME_INVALID',
  'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
  'CERT_UNTRUSTED',
]);

/**
 * A refusal that is about reaching the instance at all, carrying the typed code
 * a consumer branches on. Never carries the access key: the message is built
 * from the method, the path and a status only.
 */
export class ForgeHttpError extends Error {
  constructor(
    readonly code: InstanceRejectionCode,
    message: string,
  ) {
    super(message);
    this.name = 'ForgeHttpError';
  }
}

/** A response that arrived. A non-2xx status is data here, not an exception. */
export interface ForgeResponse {
  status: number;
  headers: Headers;
  /** Parsed JSON, or `null` when the body was empty or not JSON. */
  body: unknown;
}

/** Resolve a hostname to its addresses. Injectable so tests need no DNS. */
export type HostResolver = (hostname: string) => Promise<string[]>;

export interface ForgeHttpOptions {
  /** Normalized `origin + pathPrefix` — already admitted by `forge-url.ts`. */
  baseUrl: string;
  /** Rate-gate key; the instance id, or its derived key before it has an id. */
  instanceKey: string;
  /** Access key. Header only — see guarantee 5 above. */
  credential: string;
  /**
   * Hosts the operator opted into reaching on a private network
   * (`AppConfig.allowPrivateForgeHosts`, from
   * `DEVDIGEST_ALLOW_PRIVATE_FORGE_HOSTS`). Omitted means the shipped refusal.
   */
  allowedPrivateHosts?: readonly string[];
  gate?: RateGate;
  fetchImpl?: typeof fetch;
  resolveHost?: HostResolver;
  timeoutMs?: number;
}

const defaultResolver: HostResolver = async (hostname) => {
  const answers = await lookup(hostname, { all: true });
  return answers.map((a) => a.address);
};

export class GitLabHttp {
  private readonly baseUrl: string;
  private readonly instanceKey: string;
  private readonly credential: string;
  private readonly gate: RateGate;
  private readonly fetchImpl: typeof fetch;
  private readonly resolveHost: HostResolver;
  private readonly timeoutMs: number;
  private readonly allowedPrivateHosts: readonly string[];

  constructor(opts: ForgeHttpOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/+$/, '');
    this.instanceKey = opts.instanceKey;
    this.credential = opts.credential;
    this.allowedPrivateHosts = opts.allowedPrivateHosts ?? [];
    this.gate = opts.gate ?? new RateGate();
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.resolveHost = opts.resolveHost ?? defaultResolver;
    this.timeoutMs = opts.timeoutMs ?? FORGE_REQUEST_TIMEOUT_MS;
  }

  /**
   * `GET {baseUrl}{path}`. Throws `ForgeHttpError` when the instance could not
   * be reached, refused to be reached, or answered a redirect; returns the
   * response — including a 401/403/404 — when it answered.
   */
  async get(path: string, opts: { timeoutMs?: number } = {}): Promise<ForgeResponse> {
    return this.request('GET', path, opts);
  }

  /**
   * `POST {baseUrl}{path}` with a JSON body. Same guarantees as `get` — in
   * particular the host guard runs here too, because it runs per REQUEST and
   * not per client (`server/INSIGHTS.md` 2026-08-28: a guard latched on the
   * client is a guard skipped on 3 of 4 requests).
   */
  async post(
    path: string,
    body: unknown,
    opts: { timeoutMs?: number } = {},
  ): Promise<ForgeResponse> {
    return this.request('POST', path, opts, body);
  }

  private async request(
    method: 'GET' | 'POST',
    path: string,
    opts: { timeoutMs?: number } = {},
    body?: unknown,
  ): Promise<ForgeResponse> {
    await this.assertHostIsPublic();

    const url = `${this.baseUrl}${path}`;
    const budget = Math.max(1, Math.min(opts.timeoutMs ?? this.timeoutMs, this.timeoutMs));
    // One signal for the WHOLE attempt, rate-gate defer included. The gate's
    // pause comes from a `Retry-After` the instance chose, so an unbounded wait
    // is the instance's decision, not ours: giving `wait` the same signal makes
    // the caller's timeout cancel the sleep instead of leaving it pending.
    const signal = AbortSignal.timeout(budget);

    await this.gate.wait(this.instanceKey, signal);

    let res: Response;
    try {
      res = await this.fetchImpl(url, {
        method,
        headers: {
          [AUTH_HEADER]: this.credential,
          accept: 'application/json',
          ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        // Guarantee 2: a 3xx is reported, never followed.
        redirect: 'manual',
        signal,
      });
    } catch (err) {
      throw this.classifyTransportError(err, `${method} ${path}`);
    }

    this.gate.noteResponse(this.instanceKey, res.headers);

    if (res.status >= 300 && res.status < 400) {
      // Deliberately does NOT echo `Location`: that value is chosen by the
      // instance, and repeating it in a message is how an untrusted string
      // reaches a log or a screen.
      throw new ForgeHttpError(
        'cross_origin_redirect',
        `${method} ${path} answered ${res.status} with a redirect; DevDigest does not follow redirects.`,
      );
    }

    return { status: res.status, headers: res.headers, body: await readJson(res) };
  }

  /** AC-4, runtime half. Runs on every request, never latched — see guarantee 1.
   *  Names the rejected host, never the resolved address list: the host is what
   *  the operator typed and can act on, and the address list is information
   *  about their network that a message does not need to carry. */
  private async assertHostIsPublic(): Promise<void> {
    const hostname = new URL(this.baseUrl).hostname.replace(/^\[|\]$/g, '');

    let addresses: string[];
    try {
      addresses = await this.resolveHost(hostname);
    } catch {
      throw new ForgeHttpError('unreachable', `Could not resolve '${hostname}'.`);
    }
    if (addresses.length === 0) {
      throw new ForgeHttpError('unreachable', `Could not resolve '${hostname}'.`);
    }
    // EVERY answer must clear the gate: one refused address in a round-robin
    // set is enough to reach an internal service on a later request. An
    // allowlisted host widens this for RFC 1918 and unique-local only, so the
    // same loop still refuses `127.0.0.1`, `169.254.169.254` and `::1` for a
    // host the operator named.
    const refused = addresses.filter((address) =>
      isRefusedAddress(address, hostname, this.allowedPrivateHosts),
    );
    if (refused.length > 0) {
      // The hint is offered only when following it would actually work. Note
      // this condition already implies the host is NOT allowlisted: were it
      // allowlisted, an allowlistable address would not be in `refused` at all.
      const actionable = refused.every((address) => isAllowlistablePrivateAddress(address));
      throw new ForgeHttpError(
        'private_address',
        `'${hostname}' resolves to a private or loopback address, which DevDigest will not connect to.` +
          (actionable ? ` ${allowlistHint(hostname)}` : ''),
      );
    }
  }

  private classifyTransportError(err: unknown, what: string): ForgeHttpError {
    const name = (err as { name?: string })?.name;
    if (name === 'TimeoutError' || name === 'AbortError') {
      return new ForgeHttpError('unreachable', `${what} timed out.`);
    }
    const code =
      (err as { cause?: { code?: string } })?.cause?.code ?? (err as { code?: string })?.code;
    if (typeof code === 'string' && TLS_ERROR_CODES.has(code)) {
      return new ForgeHttpError(
        'tls_untrusted',
        `The instance's TLS certificate could not be verified (${code}).`,
      );
    }
    // Fail closed: anything unclassifiable is unreachable, never a pass. The
    // original error is deliberately not interpolated — it can carry the
    // request headers.
    return new ForgeHttpError('unreachable', `${what} could not be completed.`);
  }
}

/**
 * Parse a JSON body, bounded. The instance is third-party, so its response size
 * is its choice, not ours; anything past the cap is refused rather than
 * buffered. A body that is empty or is not JSON becomes `null` — the caller
 * decides whether that is a failure, because for some statuses it is not.
 */
async function readJson(res: Response): Promise<unknown> {
  const declared = Number(res.headers.get('content-length') ?? '');
  if (Number.isFinite(declared) && declared > FORGE_MAX_BODY_BYTES) {
    throw new ForgeHttpError('unreachable', 'The instance returned an oversized response.');
  }

  const reader = res.body?.getReader();
  if (!reader) return null;

  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > FORGE_MAX_BODY_BYTES) {
      await reader.cancel();
      throw new ForgeHttpError('unreachable', 'The instance returned an oversized response.');
    }
    chunks.push(value);
  }
  if (total === 0) return null;

  const buf = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    buf.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder().decode(buf));
  } catch {
    return null;
  }
}
