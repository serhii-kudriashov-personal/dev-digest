/**
 * The ONLY module in this package that calls `fetch`.
 *
 * The base URL comes from `DEVDIGEST_API_BASE` (default `http://localhost:3001`),
 * read once at startup and validated to be an http(s) URL. It is NEVER derived
 * from a tool argument — `security` §"Golden rule": `fetch(process.env.API_URL)`
 * is safe, `fetch(req.query.url)` is not. Path segments are UUIDs the engine
 * itself produced, so no constructed URL has an attacker-controlled component.
 *
 * The API is `LocalNoAuthProvider` for local calls
 * (`server/src/modules/_shared/context.ts:14-23`), so no credential is sent and
 * none is accepted as a tool argument.
 */
import { REQUEST_TIMEOUT_MS } from './constants.js';

/** A non-2xx answer from the engine, carrying its error envelope. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/** The engine could not be reached at all (connection refused, DNS, timeout). */
export class EngineDownError extends Error {
  constructor(readonly baseUrl: string) {
    super(`Cannot reach the DevDigest engine at ${baseUrl}`);
    this.name = 'EngineDownError';
  }
}

/** The engine answered, but not with the shape this client reads. */
export class BadShapeError extends Error {
  constructor(
    readonly path: string,
    readonly baseUrl: string,
  ) {
    super(`Unexpected response shape from ${path}`);
    this.name = 'BadShapeError';
  }
}

/**
 * Validate and normalise the base URL. Throws on anything that is not http(s),
 * which fails the process at startup rather than at the first tool call.
 */
export function normalizeBaseUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`DEVDIGEST_API_BASE is not a valid URL: ${raw}`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`DEVDIGEST_API_BASE must be http(s): ${raw}`);
  }
  return url.origin;
}

export interface ApiClient {
  readonly baseUrl: string;
  get(path: string): Promise<unknown>;
  post(path: string, body: unknown): Promise<unknown>;
}

export class HttpApiClient implements ApiClient {
  constructor(readonly baseUrl: string) {}

  get(path: string): Promise<unknown> {
    return this.request('GET', path);
  }

  post(path: string, body: unknown): Promise<unknown> {
    return this.request('POST', path, body);
  }

  private async request(method: 'GET' | 'POST', path: string, body?: unknown): Promise<unknown> {
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}${path}`, {
        method,
        headers: body === undefined ? {} : { 'content-type': 'application/json' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        // Per-request cap. The 120 s blocking budget is a separate wall-clock
        // deadline in `handlers.ts` — a request timeout is not a loop timeout.
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch {
      // Network failure or per-request timeout. Deliberately no `cause`: the
      // undici message can carry the URL, and nothing from here is logged.
      throw new EngineDownError(this.baseUrl);
    }

    const text = await res.text();
    let parsed: unknown = undefined;
    if (text.length > 0) {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = undefined;
      }
    }

    if (!res.ok) {
      // `{ error: { code, message } }` — `server/src/app.ts:153-157`.
      const envelope = parsed as { error?: { code?: unknown; message?: unknown } } | undefined;
      const code = typeof envelope?.error?.code === 'string' ? envelope.error.code : 'http_error';
      const message =
        typeof envelope?.error?.message === 'string'
          ? envelope.error.message
          : `HTTP ${res.status}`;
      throw new ApiError(res.status, code, message);
    }

    return parsed;
  }
}
