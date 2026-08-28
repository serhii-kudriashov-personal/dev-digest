import { describe, it, expect } from 'vitest';
import {
  ForgeHttpError,
  FORGE_MAX_BODY_BYTES,
  GitLabHttp,
  type HostResolver,
} from '../src/adapters/gitlab/http.js';
import { GitLabInstanceHttpClient } from '../src/adapters/gitlab/instance.js';

/**
 * The GitLab instance adapter (SPEC-06 — `specs/2026-08-28-gitlab-repositories.md`,
 * AC-3, AC-4, AC-7, AC-8, AC-9, AC-10, AC-11, AC-45, AC-46, NFR-2).
 *
 * HERMETIC BY CONSTRUCTION. `fetch` and the host resolver are both injected, so
 * nothing here opens a socket, resolves a name or presents a certificate. That
 * is not only for speed: AC-4 forbids DevDigest from connecting to a local
 * address, so a test may not stand up a loopback server to talk to, and the plan
 * (Q4) refuses a test-only SSRF bypass. The live path is a manual `e2e/` flow.
 *
 * Every response below is a recorded fixture — the status, headers and body
 * shape GitLab answers with — replayed through the injected `fetchImpl`.
 */

const BASE = 'https://gitlab.example.com';
/** The fixture access token. Nothing this file produces may contain it. */
const CREDENTIAL = 'glpat-FIXTURE-do-not-echo-0000';

interface RecordedRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  redirect: RequestRedirect | undefined;
}

interface Rig {
  requests: RecordedRequest[];
  resolverCalls: string[];
  fetchImpl: typeof fetch;
  resolveHost: HostResolver;
}

/** Replay a queue of canned outcomes, one per request, recording each call. */
function rig(outcomes: (Response | Error)[], addresses: string[] = ['93.184.216.34']): Rig {
  const requests: RecordedRequest[] = [];
  const resolverCalls: string[] = [];
  let i = 0;

  const fetchImpl = (async (input: unknown, init: Record<string, unknown> = {}) => {
    requests.push({
      url: String(input),
      method: String(init.method ?? 'GET'),
      headers: { ...((init.headers as Record<string, string>) ?? {}) },
      redirect: init.redirect as RequestRedirect | undefined,
    });
    const next = outcomes[i++] ?? new Response('{}', { status: 200 });
    if (next instanceof Error) throw next;
    return next;
  }) as unknown as typeof fetch;

  const resolveHost: HostResolver = async (hostname) => {
    resolverCalls.push(hostname);
    return addresses;
  };

  return { requests, resolverCalls, fetchImpl, resolveHost };
}

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  // 204/205 are null-body statuses — the `Response` constructor refuses a body
  // for them, exactly as a real instance would send none.
  const payload = status === 204 || status === 205 ? null : JSON.stringify(body);
  return new Response(payload, {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

/** A transport error shaped like the `TypeError` `fetch` throws. */
function transportError(code: string): Error {
  return Object.assign(new TypeError('fetch failed'), { cause: { code } });
}

function http(over: Partial<ConstructorParameters<typeof GitLabHttp>[0]> & Rig): GitLabHttp {
  return new GitLabHttp({
    baseUrl: BASE,
    instanceKey: 'inst-1',
    credential: CREDENTIAL,
    fetchImpl: over.fetchImpl,
    resolveHost: over.resolveHost,
    ...over,
  });
}

const OK_METADATA = { version: '17.4.1', revision: 'abcdef', enterprise: true };
const OK_USER = { id: 7, username: 'devdigest' };

// ---------------------------------------------------------------------------

describe('redirects are refused, never followed (AC-11)', () => {
  for (const status of [301, 302, 303, 307, 308]) {
    it(`${status} → cross_origin_redirect, and exactly one request is made`, async () => {
      const r = rig([
        new Response(null, { status, headers: { location: 'https://attacker.test/steal' } }),
      ]);
      const err = await http(r)
        .get('/api/v4/user')
        .catch((e: unknown) => e);

      expect(err).toBeInstanceOf(ForgeHttpError);
      expect((err as ForgeHttpError).code).toBe('cross_origin_redirect');
      // Followed once and stopped: the redirect target was never contacted.
      expect(r.requests).toHaveLength(1);
      expect(r.requests[0]!.url).toBe(`${BASE}/api/v4/user`);
      expect(r.requests[0]!.redirect).toBe('manual');
    });
  }

  it('the message repeats no `Location` — the instance chose that string', async () => {
    const r = rig([
      new Response(null, { status: 302, headers: { location: 'https://attacker.test/steal' } }),
    ]);
    const err = (await http(r)
      .get('/api/v4/user')
      .catch((e: unknown) => e)) as ForgeHttpError;

    expect(err.message).not.toContain('attacker.test');
    expect(err.message).not.toMatch(/location/i);
    expect(err.message).toContain('302');
  });

  it('a redirect during verification is reported as that code, not as a pass', async () => {
    const r = rig([new Response(null, { status: 301, headers: { location: 'https://elsewhere/' } })]);
    const result = await new GitLabInstanceHttpClient({ ...r }).verify({
      baseUrl: BASE,
      instanceKey: 'inst-1',
      credential: CREDENTIAL,
    });
    expect(result).toMatchObject({ ok: false, code: 'cross_origin_redirect' });
  });
});

describe('a certificate failure is distinguishable from unreachable (AC-3)', () => {
  const tlsCodes = [
    'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
    'SELF_SIGNED_CERT_IN_CHAIN',
    'DEPTH_ZERO_SELF_SIGNED_CERT',
    'CERT_HAS_EXPIRED',
  ];
  for (const code of tlsCodes) {
    it(`${code} → tls_untrusted`, async () => {
      const r = rig([transportError(code)]);
      const err = (await http(r)
        .get('/api/v4/metadata')
        .catch((e: unknown) => e)) as ForgeHttpError;
      expect(err.code).toBe('tls_untrusted');
      expect(err.message).toContain(code);
    });
  }

  it('an unrecognised `cause.code` falls through to unreachable — fail closed', async () => {
    for (const code of ['ECONNREFUSED', 'ENOTFOUND', 'ECONNRESET', 'SOMETHING_NEW']) {
      const r = rig([transportError(code)]);
      const err = (await http(r)
        .get('/api/v4/metadata')
        .catch((e: unknown) => e)) as ForgeHttpError;
      expect(err.code).toBe('unreachable');
    }
  });

  it('tls_untrusted, unreachable and credential_rejected are three different answers', async () => {
    const verify = async (outcomes: (Response | Error)[]) => {
      const r = rig(outcomes);
      return new GitLabInstanceHttpClient({ ...r }).verify({
        baseUrl: BASE,
        instanceKey: 'inst-1',
        credential: CREDENTIAL,
      });
    };

    expect(await verify([transportError('SELF_SIGNED_CERT_IN_CHAIN')])).toMatchObject({
      ok: false,
      code: 'tls_untrusted',
    });
    expect(await verify([transportError('ECONNREFUSED')])).toMatchObject({
      ok: false,
      code: 'unreachable',
    });
    expect(await verify([json({ message: '401 Unauthorized' }, 401)])).toMatchObject({
      ok: false,
      code: 'credential_rejected',
    });
    // …and a 404 on the metadata endpoint is a fourth thing again: the host
    // answered, but it is not a GitLab (AC-46).
    expect(await verify([json({}, 404)])).toMatchObject({
      ok: false,
      code: 'capability_missing',
    });
  });
});

describe('verify() reads version and edition from /api/v4/metadata (AC-7)', () => {
  it('maps `version` and the `enterprise` codebase flag', async () => {
    const r = rig([json(OK_METADATA), json(OK_USER), json({}, 200)]);
    const result = await new GitLabInstanceHttpClient({ ...r }).verify({
      baseUrl: BASE,
      instanceKey: 'inst-1',
      credential: CREDENTIAL,
    });

    expect(result).toMatchObject({
      ok: true,
      code: null,
      version: '17.4.1',
      edition: 'enterprise',
      login: 'devdigest',
    });
    expect(r.requests[0]!.url).toBe(`${BASE}/api/v4/metadata`);
    expect(r.requests[1]!.url).toBe(`${BASE}/api/v4/user`);
  });

  it('`enterprise: false` is the community codebase, not a missing answer', async () => {
    const r = rig([json({ version: '16.11.0', enterprise: false }), json(OK_USER), json({}, 200)]);
    const result = await new GitLabInstanceHttpClient({ ...r }).verify({
      baseUrl: BASE,
      instanceKey: 'inst-1',
      credential: CREDENTIAL,
    });
    expect(result).toMatchObject({ ok: true, version: '16.11.0', edition: 'community' });
  });

  it('an instance that reports neither leaves both null rather than guessing', async () => {
    const r = rig([json({}), json(OK_USER), json({}, 200)]);
    const result = await new GitLabInstanceHttpClient({ ...r }).verify({
      baseUrl: BASE,
      instanceKey: 'inst-1',
      credential: CREDENTIAL,
    });
    expect(result).toMatchObject({ ok: true, version: null, edition: null });
  });

  it('a failure still carries the version already read, so AC-46 can state it', async () => {
    const r = rig([json(OK_METADATA), json({ message: '403 Forbidden' }, 403)]);
    const result = await new GitLabInstanceHttpClient({ ...r }).verify({
      baseUrl: BASE,
      instanceKey: 'inst-1',
      credential: CREDENTIAL,
    });
    expect(result).toMatchObject({ ok: false, code: 'credential_rejected', version: '17.4.1' });
  });
});

describe('the approval probe has three answers, and 404 is not the negative one (AC-8, AC-9)', () => {
  const probe = async (status: number) => {
    const r = rig([json(OK_METADATA), json(OK_USER), json({}, status)]);
    const result = await new GitLabInstanceHttpClient({ ...r }).verify({
      baseUrl: BASE,
      instanceKey: 'inst-1',
      credential: CREDENTIAL,
    });
    return result.approvalCapability;
  };

  it('200 → permitted', async () => expect(await probe(200)).toBe('permitted'));
  it('403 → refused', async () => expect(await probe(403)).toBe('refused'));

  it('404 → unknown, never refused', async () => {
    // GitLab answers 404 both for "not licensed" and for "not permitted", so it
    // never leaks existence — the answer is ambiguous by its own design and
    // presenting it as a definite negative would be a guess dressed as a fact
    // (root `INSIGHTS.md` 2026-08-28).
    expect(await probe(404)).toBe('unknown');
  });

  it('`refused` is reachable from 403 and from nothing else', async () => {
    const statuses = [200, 201, 204, 400, 401, 403, 404, 405, 418, 429, 500, 502, 503];
    const refusing: number[] = [];
    for (const status of statuses) {
      if ((await probe(status)) === 'refused') refusing.push(status);
    }
    expect(refusing).toEqual([403]);
  });

  it('a probe that could not complete at all is unknown, not refused', async () => {
    const r = rig([json(OK_METADATA), json(OK_USER), transportError('ECONNRESET')]);
    const result = await new GitLabInstanceHttpClient({ ...r }).verify({
      baseUrl: BASE,
      instanceKey: 'inst-1',
      credential: CREDENTIAL,
    });
    expect(result).toMatchObject({ ok: true, approvalCapability: 'unknown' });
  });
});

describe('the access token is a header and nothing else (AC-10)', () => {
  it('every request carries it as PRIVATE-TOKEN, and no URL contains it', async () => {
    const r = rig([json(OK_METADATA), json(OK_USER), json({}, 200)]);
    await new GitLabInstanceHttpClient({ ...r }).verify({
      baseUrl: BASE,
      instanceKey: 'inst-1',
      credential: CREDENTIAL,
    });

    expect(r.requests).toHaveLength(3);
    for (const req of r.requests) {
      expect(req.headers['PRIVATE-TOKEN']).toBe(CREDENTIAL);
      expect(req.url).not.toContain(CREDENTIAL);
      expect(req.url).not.toContain('private_token');
      expect(req.url.startsWith(`${BASE}/`)).toBe(true);
    }
  });

  it('no message this adapter produces contains it — thrown or returned', async () => {
    const messages: string[] = [];

    // Every throwing branch of `GitLabHttp`.
    const throwing: (Response | Error)[][] = [
      [new Response(null, { status: 302, headers: { location: 'https://elsewhere/' } })],
      [transportError('SELF_SIGNED_CERT_IN_CHAIN')],
      [transportError('ECONNREFUSED')],
    ];
    for (const outcomes of throwing) {
      const r = rig(outcomes);
      const err = (await http(r)
        .get('/api/v4/user')
        .catch((e: unknown) => e)) as Error;
      messages.push(err.message);
    }

    // …the private-address refusal, which names the host…
    const priv = rig([json(OK_USER)], ['10.0.0.5']);
    messages.push(
      ((await http(priv)
        .get('/api/v4/user')
        .catch((e: unknown) => e)) as Error).message,
    );

    // …and every returned verification message, success and failure alike.
    for (const outcomes of [
      [json(OK_METADATA), json(OK_USER), json({}, 200)],
      [json({ message: '401 Unauthorized' }, 401)],
      [json({}, 404)],
      [json({}, 500)],
    ]) {
      const r = rig(outcomes);
      const result = await new GitLabInstanceHttpClient({ ...r }).verify({
        baseUrl: BASE,
        instanceKey: 'inst-1',
        credential: CREDENTIAL,
      });
      messages.push(result.message);
    }

    expect(messages.length).toBeGreaterThan(0);
    for (const message of messages) {
      expect(message).not.toContain(CREDENTIAL);
      expect(message).not.toContain('glpat');
    }
  });
});

describe('the host guard runs before EVERY request, not once per client (AC-4, runtime half)', () => {
  it('verify() makes three requests and resolves the host three times', async () => {
    const r = rig([json(OK_METADATA), json(OK_USER), json({}, 200)]);
    await new GitLabInstanceHttpClient({ ...r }).verify({
      baseUrl: BASE,
      instanceKey: 'inst-1',
      credential: CREDENTIAL,
    });

    expect(r.requests).toHaveLength(3);
    // A latch here — resolving once per client — would leave the second and
    // third requests unguarded and a record that flips mid-verification
    // unnoticed. This assertion is the only thing that can see the difference.
    expect(r.resolverCalls).toEqual(['gitlab.example.com', 'gitlab.example.com', 'gitlab.example.com']);
  });

  it('a record that flips to a private address between requests is caught', async () => {
    const answers = [['93.184.216.34'], ['93.184.216.34'], ['169.254.169.254']];
    let call = 0;
    const r = rig([json(OK_METADATA), json(OK_USER), json({}, 200)]);
    const resolveHost: HostResolver = async () => answers[call++] ?? ['93.184.216.34'];

    const result = await new GitLabInstanceHttpClient({
      fetchImpl: r.fetchImpl,
      resolveHost,
    }).verify({ baseUrl: BASE, instanceKey: 'inst-1', credential: CREDENTIAL });

    // The first two requests went out; the third was refused before `fetch`.
    expect(r.requests).toHaveLength(2);
    // The probe cannot complete, so the capability is unknown — never refused.
    expect(result).toMatchObject({ ok: true, approvalCapability: 'unknown' });
  });

  it('one private answer in a round-robin set refuses the whole request', async () => {
    const r = rig([json(OK_USER)], ['93.184.216.34', '127.0.0.1']);
    const err = (await http(r)
      .get('/api/v4/user')
      .catch((e: unknown) => e)) as ForgeHttpError;

    expect(err.code).toBe('private_address');
    expect(err.message).toContain('gitlab.example.com');
    expect(r.requests).toHaveLength(0);
  });

  it('a host that does not resolve is unreachable, not admitted', async () => {
    const r = rig([json(OK_USER)], []);
    const err = (await http(r)
      .get('/api/v4/user')
      .catch((e: unknown) => e)) as ForgeHttpError;
    expect(err.code).toBe('unreachable');
    expect(r.requests).toHaveLength(0);
  });
});

describe('the response body is bounded at 2 MiB (the instance is third-party)', () => {
  it('a declared content-length over the cap is refused before the body is read', async () => {
    let pulls = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulls++;
        controller.enqueue(new Uint8Array(1024));
      },
    });
    const r = rig([
      new Response(body, { headers: { 'content-length': String(FORGE_MAX_BODY_BYTES + 1) } }),
    ]);
    const err = (await http(r)
      .get('/api/v4/user')
      .catch((e: unknown) => e)) as ForgeHttpError;

    expect(err).toBeInstanceOf(ForgeHttpError);
    expect(err.message).toMatch(/oversized/i);
    // `ReadableStream` eagerly prefetches one chunk to fill its queue, so 1 is
    // the floor here and not something the code under test can influence. What
    // this asserts is that the body was never DRAINED: the declared length is
    // checked before `getReader()`.
    expect(pulls).toBeLessThanOrEqual(1);
  });

  it('the cap still holds when content-length LIES about a small body', async () => {
    // The declared length is the instance's claim, not a fact. An endless body
    // announced as 12 bytes has to be stopped by the streaming counter, or the
    // cap is decorative and the process buffers until it dies.
    let pulls = 0;
    const chunk = new Uint8Array(512 * 1024);
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulls++;
        controller.enqueue(chunk.slice());
      },
    });
    const r = rig([new Response(body, { headers: { 'content-length': '12' } })]);

    const err = (await http(r)
      .get('/api/v4/user')
      .catch((e: unknown) => e)) as ForgeHttpError;

    expect(err).toBeInstanceOf(ForgeHttpError);
    expect(err.message).toMatch(/oversized/i);
    // 2 MiB / 512 KiB = 4 chunks to reach the cap, 5 to exceed it. A handful of
    // extra pulls is stream buffering; an unbounded number is the bug.
    expect(pulls).toBeLessThanOrEqual(8);
  });

  it('a body under the cap parses normally, and a non-JSON body is null rather than a throw', async () => {
    const ok = rig([json(OK_USER)]);
    expect((await http(ok).get('/api/v4/user')).body).toEqual(OK_USER);

    const html = rig([new Response('<html>sign in</html>', { status: 200 })]);
    const res = await http(html).get('/api/v4/user');
    expect(res.status).toBe(200);
    expect(res.body).toBeNull();
  });
});
