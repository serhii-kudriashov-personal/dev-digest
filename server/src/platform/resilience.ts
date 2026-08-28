/**
 * resilience primitives: timeouts on every external call + retry with
 * exponential backoff on transient failures (rate-limit / 5xx).
 */

export class TimeoutError extends Error {
  constructor(ms: number) {
    super(`Operation timed out after ${ms}ms`);
    this.name = 'TimeoutError';
  }
}

export async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  if (!ms || ms <= 0) return p;
  let handle: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    handle = setTimeout(() => reject(new TimeoutError(ms)), ms);
  });
  try {
    return await Promise.race([p, timeout]);
  } finally {
    clearTimeout(handle!);
  }
}

export interface RetryOptions {
  retries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  /** Decide whether an error is retryable (rate-limit / 5xx by default). */
  isRetryable?: (err: unknown) => boolean;
  onRetry?: (attempt: number, err: unknown) => void;
}

function defaultIsRetryable(err: unknown): boolean {
  const status =
    (err as { status?: number })?.status ??
    (err as { statusCode?: number })?.statusCode ??
    (err as { response?: { status?: number } })?.response?.status;
  if (typeof status === 'number') return status === 429 || status >= 500;
  // network-ish errors
  const code = (err as { code?: string })?.code;
  return code === 'ECONNRESET' || code === 'ETIMEDOUT' || code === 'ENOTFOUND';
}

export async function withRetry<T>(fn: () => Promise<T>, opts: RetryOptions = {}): Promise<T> {
  const retries = opts.retries ?? 3;
  const base = opts.baseDelayMs ?? 250;
  const max = opts.maxDelayMs ?? 8000;
  const isRetryable = opts.isRetryable ?? defaultIsRetryable;

  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt === retries || !isRetryable(err)) break;
      opts.onRetry?.(attempt + 1, err);
      const delay = Math.min(max, base * 2 ** attempt) + Math.random() * base;
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastErr;
}

/**
 * Per-key rate gate (SPEC-06 NFR-10, NFR-11).
 *
 * One registered forge instance answering `429` must not slow down calls to any
 * OTHER instance — so the pause is recorded per key (the instance id) and never
 * as a process-wide lock. A key with no recorded reset never waits at all,
 * which is what keeps the common path free.
 *
 * The reset comes from the instance itself (`RateLimit-Reset` / `Retry-After`),
 * so it is third-party input: it is clamped to `MAX_RATE_GATE_DEFER_MS` rather
 * than trusted, or a hostile or mis-clocked header would park a request
 * indefinitely.
 */
export const MAX_RATE_GATE_DEFER_MS = 60_000;

/** Just enough of `Headers` to read a response's rate-limit hints. */
export interface RateLimitHeaders {
  get(name: string): string | null;
}

/**
 * Absolute epoch-ms this response says to resume at, or `null` when it carries
 * no usable hint.
 *
 * `Retry-After` is delta-seconds or an HTTP-date (RFC 9110). `RateLimit-Reset`
 * is delta-seconds in the IETF draft but a Unix EPOCH timestamp on GitLab, so
 * the value is disambiguated by magnitude rather than assumed.
 */
export function parseRateLimitReset(headers: RateLimitHeaders, nowMs: number): number | null {
  const retryAfter = headers.get('retry-after');
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds) && seconds >= 0) return nowMs + seconds * 1000;
    const at = Date.parse(retryAfter);
    if (Number.isFinite(at)) return at;
  }

  const reset = headers.get('ratelimit-reset');
  if (reset) {
    const value = Number(reset);
    if (Number.isFinite(value) && value >= 0) {
      // A plausible epoch-seconds value (anything past 2001) is absolute;
      // anything smaller is a delta.
      return value > 1_000_000_000 ? value * 1000 : nowMs + value * 1000;
    }
  }
  return null;
}

/**
 * Sleep that a signal can cut short. The timer is CLEARED on abort rather than
 * merely raced away: an abandoned `setTimeout` still holds the event loop open
 * for its full duration, which is the whole problem an abortable defer exists to
 * solve.
 */
function abortableSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const finish = (): void => {
      clearTimeout(handle);
      signal?.removeEventListener('abort', finish);
      resolve();
    };
    const handle = setTimeout(finish, ms);
    if (signal) {
      if (signal.aborted) finish();
      else signal.addEventListener('abort', finish, { once: true });
    }
  });
}

export interface RateGateOptions {
  /** Injectable for tests — a gate is otherwise untestable without real time. */
  now?: () => number;
  /**
   * Receives the caller's signal so an injected sleep can cancel too. An
   * implementation that ignores it still aborts correctly — `wait` races it —
   * but it will leak whatever timer it holds.
   */
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  maxDeferMs?: number;
}

export class RateGate {
  private readonly resumeAt = new Map<string, number>();
  private readonly now: () => number;
  private readonly sleep: (ms: number, signal?: AbortSignal) => Promise<void>;
  private readonly maxDeferMs: number;

  constructor(opts: RateGateOptions = {}) {
    this.now = opts.now ?? (() => Date.now());
    this.sleep = opts.sleep ?? abortableSleep;
    this.maxDeferMs = opts.maxDeferMs ?? MAX_RATE_GATE_DEFER_MS;
  }

  /**
   * Defer until `key`'s recorded reset passes. Every other key proceeds now.
   *
   * `signal` is the CALLER'S per-request abort, and passing it is what keeps a
   * hostile `Retry-After` bounded by the caller's own timeout. Without it the
   * sleep outlives the request it was deferring — `withTimeout` is a
   * `Promise.race` and cancels nothing, so the caller returns while the defer,
   * and then the request it releases, are still pending.
   *
   * An aborted wait returns rather than throwing, and deliberately leaves the
   * recorded reset in place: the defer was abandoned, not served, so the next
   * request for this key must still honour it. The caller's request then fails
   * on the same already-aborted signal, which is the outcome it asked for.
   */
  async wait(key: string, signal?: AbortSignal): Promise<void> {
    const until = this.resumeAt.get(key);
    if (until === undefined) return;
    const delay = until - this.now();
    if (delay <= 0) {
      this.resumeAt.delete(key);
      return;
    }
    if (signal?.aborted) return;
    await this.deferFor(Math.min(delay, this.maxDeferMs), signal);
    if (signal?.aborted) return;
    this.resumeAt.delete(key);
  }

  private async deferFor(ms: number, signal?: AbortSignal): Promise<void> {
    if (!signal) return this.sleep(ms);
    let onAbort!: () => void;
    const abandoned = new Promise<void>((resolve) => {
      onAbort = () => resolve();
      signal.addEventListener('abort', onAbort, { once: true });
    });
    try {
      await Promise.race([this.sleep(ms, signal), abandoned]);
    } finally {
      signal.removeEventListener('abort', onAbort);
    }
  }

  /** Record an absolute epoch-ms reset for one key. */
  pauseUntil(key: string, epochMs: number): void {
    const capped = Math.min(epochMs, this.now() + this.maxDeferMs);
    const current = this.resumeAt.get(key);
    if (current === undefined || capped > current) this.resumeAt.set(key, capped);
  }

  /** Record whatever reset a response reported, if any. */
  noteResponse(key: string, headers: RateLimitHeaders): void {
    const at = parseRateLimitReset(headers, this.now());
    if (at !== null) this.pauseUntil(key, at);
  }

  /** Epoch-ms this key is deferred until, or `null` when it is not deferred. */
  deferredUntil(key: string): number | null {
    return this.resumeAt.get(key) ?? null;
  }

  /** Forget a key's recorded reset — used when its instance is deleted. */
  forget(key: string): void {
    this.resumeAt.delete(key);
  }
}
