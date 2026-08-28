import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed, DEFAULT_WORKSPACE_NAME } from '../src/db/seed.js';
import * as t from '../src/db/schema.js';
import { MockGitLabInstanceClient, MockSecretsProvider } from '../src/adapters/mocks.js';
import { instanceSecretKey } from '../src/modules/instances/constants.js';

/**
 * The `instances` slice end to end (SPEC-06 —
 * `specs/2026-08-28-gitlab-repositories.md`, AC-1…AC-12, AC-45, AC-46).
 *
 * Ring 5 + ring 3: routes through `buildApp({ overrides })` + `app.inject()`
 * against a REAL Postgres, because the workspace scoping and the two unique
 * indexes are SQL and a mock DB would assert nothing about them
 * (`backend-onion-architecture` §9).
 *
 * `*.it.test.ts` is the CI split, not a style choice — and a skipping suite
 * reads as passing with exit code 0, so the run's COUNT is the evidence, never
 * the exit code (`server/INSIGHTS.md` 2026-08-02, 2026-08-03).
 *
 * No outbound request is ever made: `gitlabInstanceClient` is the mock, because
 * AC-4 forbids connecting to a local address and the plan (Q4) refuses a
 * test-only SSRF bypass.
 */

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;
const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

/** The fixture access token. It must appear in no response and no message. */
const CREDENTIAL = 'glpat-FIXTURE-never-echo-1234567890';

d('instances slice (Testcontainers pg)', () => {
  let pg: PgFixture;
  let workspaceId: string;
  /** One secrets backend across every app, so a write survives a rebuild. */
  let secrets: MockSecretsProvider;

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
    const [ws] = await pg.handle.db
      .select()
      .from(t.workspaces)
      .where(eq(t.workspaces.name, DEFAULT_WORKSPACE_NAME));
    workspaceId = ws!.id;
  });
  afterAll(async () => {
    await pg?.stop();
  });

  const makeApp = async (client = new MockGitLabInstanceClient()): Promise<FastifyInstance> =>
    buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: { secrets, gitlabInstanceClient: client },
    });

  /**
   * Every response that leaves this API is checked for the fixture token here,
   * once, so AC-10 cannot be satisfied by remembering to assert it (AC-10:
   * "no response or message produced by any instance … path contains the
   * credential's characters").
   */
  const call = async (app: FastifyInstance, opts: Parameters<FastifyInstance['inject']>[0]) => {
    const res = await app.inject(opts);
    expect(res.payload).not.toContain(CREDENTIAL);
    expect(res.payload).not.toContain('glpat-');
    return res;
  };

  const wipe = async () => {
    await pg.handle.db.delete(t.gitInstances);
    secrets = new MockSecretsProvider();
  };

  const register = (app: FastifyInstance, base_url: string, label: string) =>
    call(app, {
      method: 'POST',
      url: '/instances',
      payload: { base_url, label, credential: CREDENTIAL },
    });

  // -------------------------------------------------------------------------

  it('round-trip: register → list → test → delete', async () => {
    await wipe();
    const app = await makeApp();

    const created = await register(app, 'https://gitlab.example.com/', 'Primary');
    expect(created.statusCode).toBe(201);
    const instance = created.json();
    expect(instance).toMatchObject({
      workspace_id: workspaceId,
      provider: 'gitlab',
      // Normalized on the way in: no trailing slash (AC-6).
      base_url: 'https://gitlab.example.com',
      label: 'Primary',
      version: '17.4.1',
      edition: 'enterprise',
      approval_capability: 'unknown',
    });
    expect(instance.verified_at).not.toBeNull();
    expect(instance).not.toHaveProperty('credential');

    const listed = await call(app, { method: 'GET', url: '/instances' });
    expect(listed.statusCode).toBe(200);
    expect(listed.json()).toEqual([instance]);

    const tested = await call(app, { method: 'POST', url: `/instances/${instance.id}/test` });
    expect(tested.statusCode).toBe(200);
    expect(tested.json()).toMatchObject({
      instance_id: instance.id,
      ok: true,
      code: null,
      version: '17.4.1',
      edition: 'enterprise',
    });

    const deleted = await call(app, { method: 'DELETE', url: `/instances/${instance.id}` });
    expect(deleted.statusCode).toBe(200);
    expect(deleted.json()).toEqual({ deleted: instance.id });

    const after = await call(app, { method: 'GET', url: '/instances' });
    expect(after.json()).toEqual([]);
    // Deleting the instance takes its stored token with it.
    expect(secrets.stored[instanceSecretKey(instance.id)]).toBe('');

    await app.close();
  });

  it('a base URL with a non-default port and a path prefix is accepted and kept opaque (AC-6)', async () => {
    await wipe();
    const app = await makeApp();

    const created = await register(app, 'https://git.acme.io:8443/gitlab/', 'Self-managed');
    expect(created.statusCode).toBe(201);
    expect(created.json().base_url).toBe('https://git.acme.io:8443/gitlab');

    await app.close();
  });

  // ---- AC-10 ---------------------------------------------------------------

  it('AC-10: the token reaches SecretsProvider and nothing else — no row, no body, no message', async () => {
    await wipe();
    const failing = new MockGitLabInstanceClient({
      byBaseUrl: {
        'https://gitlab.rejects.example.com': {
          ok: false,
          code: 'credential_rejected',
          message: 'The instance rejected the supplied access token (401 on /api/v4/user).',
        },
      },
    });
    const app = await makeApp(failing);

    const created = await register(app, 'https://gitlab.example.com', 'Primary');
    const id = created.json().id as string;

    // 1. It went to the secrets provider, under this instance's own key…
    expect(secrets.stored[instanceSecretKey(id)]).toBe(CREDENTIAL);
    // …and under no other key.
    const holders = Object.entries(secrets.stored)
      .filter(([, v]) => v === CREDENTIAL)
      .map(([k]) => k);
    expect(holders).toEqual([instanceSecretKey(id)]);

    // 2. No column holds it. The table has no column for one; this asserts that
    //    nothing smuggled it into `label`, `version` or `edition` either.
    const [row] = await pg.handle.db
      .select()
      .from(t.gitInstances)
      .where(eq(t.gitInstances.id, id));
    expect(JSON.stringify(row)).not.toContain(CREDENTIAL);

    // 3. No response body and no error message carries it. `call()` asserts
    //    that on every response; these are the paths that produce a message.
    const responses = [
      await call(app, { method: 'GET', url: '/instances' }),
      await call(app, { method: 'POST', url: `/instances/${id}/test` }),
      await register(app, 'https://gitlab.rejects.example.com', 'Rejecting'),
      await register(app, 'http://gitlab.example.com', 'Not TLS'),
      await register(app, `https://user:${CREDENTIAL}@gitlab.example.com`, 'Userinfo'),
      await register(app, 'https://127.0.0.1', 'Loopback'),
      await call(app, {
        method: 'POST',
        url: `/instances/${id}/test`,
        payload: { credential: CREDENTIAL },
      }),
      await call(app, { method: 'DELETE', url: '/instances/00000000-0000-4000-8000-000000000000' }),
    ];

    // The userinfo rejection is the sharp one: the submitted URL itself carried
    // the token, so echoing the URL back would leak it (AC-5 + AC-10 together).
    const userinfo = responses[4]!;
    expect(userinfo.statusCode).toBe(422);
    expect(userinfo.json().error.details).toEqual({ code: 'credentials_in_url' });
    expect(userinfo.payload).not.toContain(CREDENTIAL);

    for (const res of responses) expect(res.payload).not.toContain(CREDENTIAL);

    await app.close();
  });

  it('each typed admission rejection is refused before any outbound call is attempted', async () => {
    await wipe();
    const client = new MockGitLabInstanceClient();
    const app = await makeApp(client);

    const cases: [string, string][] = [
      ['http://gitlab.example.com', 'not_https'],
      ['https://u:p@gitlab.example.com', 'credentials_in_url'],
      ['https://127.0.0.1', 'private_address'],
      ['https://[::1]', 'private_address'],
      ['https://10.1.2.3', 'private_address'],
      ['https://localhost', 'private_address'],
    ];
    for (const [base_url, code] of cases) {
      const res = await register(app, base_url, 'Rejected');
      expect(res.statusCode).toBe(422);
      expect(res.json().error).toMatchObject({ code: 'instance_rejected', details: { code } });
    }

    // AC-4's whole point: the refusal happens at registration time, before any
    // request goes out. Nothing was verified, and nothing was persisted.
    expect(client.calls).toEqual([]);
    expect((await call(app, { method: 'GET', url: '/instances' })).json()).toEqual([]);

    await app.close();
  });

  it('the private-address message names the rejected host (AC-4)', async () => {
    await wipe();
    const app = await makeApp();
    const res = await register(app, 'https://169.254.169.254', 'Metadata');
    expect(res.statusCode).toBe(422);
    expect(res.json().error.message).toContain('169.254.169.254');
    await app.close();
  });

  // ---- AC-12 ---------------------------------------------------------------

  it('AC-12: testing one instance names it and leaves the other instance untouched', async () => {
    await wipe();
    const app = await makeApp();
    const one = (await register(app, 'https://gitlab.one.example.com', 'One')).json();
    const two = (await register(app, 'https://gitlab.two.example.com', 'Two')).json();
    await app.close();

    // A second app whose instance client answers DIFFERENTLY, so a successful
    // re-test of `one` visibly rewrites `one`'s stored verification. If the
    // write were not scoped to one row, `two` would move with it.
    const rebuilt = await makeApp(
      new MockGitLabInstanceClient({
        result: {
          message: 'Connected to GitLab 18.0.0 as @devdigest.',
          version: '18.0.0',
          edition: 'community',
          approvalCapability: 'permitted',
        },
      }),
    );

    const result = (await call(rebuilt, { method: 'POST', url: `/instances/${one.id}/test` })).json();

    // The result NAMES the instance it belongs to — a screen with several rows
    // has to attribute it to one of them.
    expect(result).toMatchObject({
      instance_id: one.id,
      ok: true,
      code: null,
      version: '18.0.0',
      edition: 'community',
      approval_capability: 'permitted',
    });
    expect(result.instance_id).not.toBe(two.id);

    const rows = (await call(rebuilt, { method: 'GET', url: '/instances' })).json() as {
      id: string;
    }[];
    const after = Object.fromEntries(rows.map((r) => [r.id, r]));

    expect(after[one.id]).toMatchObject({ version: '18.0.0', approval_capability: 'permitted' });
    // Byte-for-byte what it was before the other instance was tested.
    expect(after[two.id]).toEqual(two);

    await rebuilt.close();
  });

  it('a failed test does not degrade the recorded capability to a guess (AC-8, AC-9)', async () => {
    await wipe();
    const app = await makeApp(
      new MockGitLabInstanceClient({ result: { approvalCapability: 'permitted' } }),
    );
    const instance = (await register(app, 'https://gitlab.example.com', 'Primary')).json();
    expect(instance.approval_capability).toBe('permitted');
    await app.close();

    const failing = await makeApp(
      new MockGitLabInstanceClient({
        result: { ok: false, code: 'unreachable', message: 'The instance answered 503 on /api/v4/metadata.' },
      }),
    );
    const result = (
      await call(failing, { method: 'POST', url: `/instances/${instance.id}/test` })
    ).json();

    expect(result).toMatchObject({ instance_id: instance.id, ok: false, code: 'unreachable' });
    // A failure says nothing new about the capability, so the recorded value
    // stands and the failure's own version falls back to the stored one (AC-46).
    expect(result.approval_capability).toBe('permitted');
    expect(result.version).toBe('17.4.1');

    const [listed] = (await call(failing, { method: 'GET', url: '/instances' })).json();
    expect(listed).toEqual(instance);

    await failing.close();
  });

  // ---- Workspace scoping ---------------------------------------------------

  it('an instance belonging to another workspace is not readable, testable or deletable', async () => {
    await wipe();
    const { db } = pg.handle;
    const [otherWs] = await db.insert(t.workspaces).values({ name: 'other-instances-ws' }).returning();
    const [foreign] = await db
      .insert(t.gitInstances)
      .values({
        workspaceId: otherWs!.id,
        provider: 'gitlab',
        baseUrl: 'https://gitlab.other.example.com',
        instanceKey: 'gitlab.other.example.com',
        label: 'Someone else’s',
      })
      .returning();
    // A credential exists, so a leak would be a real leak rather than an early
    // "no token stored" return.
    await secrets.set(instanceSecretKey(foreign!.id), CREDENTIAL);

    const app = await makeApp();

    const listed = (await call(app, { method: 'GET', url: '/instances' })).json() as { id: string }[];
    expect(listed.map((r) => r.id)).not.toContain(foreign!.id);

    const tested = await call(app, { method: 'POST', url: `/instances/${foreign!.id}/test` });
    expect(tested.statusCode).toBe(404);

    const deleted = await call(app, { method: 'DELETE', url: `/instances/${foreign!.id}` });
    expect(deleted.statusCode).toBe(404);

    // The failed delete really did nothing.
    const [still] = await db
      .select()
      .from(t.gitInstances)
      .where(eq(t.gitInstances.id, foreign!.id));
    expect(still).toBeDefined();

    await app.close();
    await db.delete(t.gitInstances).where(eq(t.gitInstances.workspaceId, otherWs!.id));
    await db.delete(t.workspaces).where(eq(t.workspaces.id, otherWs!.id));
  });

  // ---- Validation at the edge ---------------------------------------------

  it('a malformed body is 422 from the route `schema:`, before the handler runs', async () => {
    await wipe();
    const client = new MockGitLabInstanceClient();
    const app = await makeApp(client);

    const bad = [
      { base_url: 'https://gitlab.example.com', label: '', credential: CREDENTIAL },
      { base_url: 'https://gitlab.example.com', label: 'x'.repeat(121), credential: CREDENTIAL },
      { base_url: 'not-a-url', label: 'Primary', credential: CREDENTIAL },
      { base_url: 'https://gitlab.example.com', label: 'Primary', credential: '' },
      { base_url: 'https://gitlab.example.com', label: 'Primary' },
      {},
    ];
    for (const payload of bad) {
      const res = await call(app, { method: 'POST', url: '/instances', payload });
      expect(res.statusCode).toBe(422);
    }

    // The proof that it is the schema and not the handler: the service was
    // never reached, so nothing was verified and nothing was persisted.
    expect(client.calls).toEqual([]);
    expect((await call(app, { method: 'GET', url: '/instances' })).json()).toEqual([]);

    await app.close();
  });

  it('a non-uuid :id is 422 at the edge, not a 404 or a 500 from the data layer', async () => {
    await wipe();
    const client = new MockGitLabInstanceClient();
    const app = await makeApp(client);

    for (const id of ['abc', '1', "'; drop table git_instances;--"]) {
      expect((await call(app, { method: 'POST', url: `/instances/${encodeURIComponent(id)}/test` })).statusCode).toBe(422);
      expect((await call(app, { method: 'DELETE', url: `/instances/${encodeURIComponent(id)}` })).statusCode).toBe(422);
    }

    // A well-formed id that names nothing is the 404, and it is distinguishable.
    const absent = '00000000-0000-4000-8000-000000000000';
    expect((await call(app, { method: 'POST', url: `/instances/${absent}/test` })).statusCode).toBe(404);
    expect((await call(app, { method: 'DELETE', url: `/instances/${absent}` })).statusCode).toBe(404);

    expect(client.calls).toEqual([]);
    await app.close();
  });

  // ---- test() re-admits the STORED base URL --------------------------------

  it('test() re-admits the stored base_url, so the SSRF gate is not a write-time-only control', async () => {
    await wipe();
    const { db } = pg.handle;
    // A row whose `base_url` no longer admits. Reachable in practice the moment
    // anything other than `register` writes that column — Stage B's repository
    // import is exactly that — and reachable today by a direct DB edit.
    const [row] = await db
      .insert(t.gitInstances)
      .values({
        workspaceId,
        provider: 'gitlab',
        baseUrl: 'https://169.254.169.254',
        instanceKey: 'stale-key',
        label: 'Stale',
        version: '17.4.1',
      })
      .returning();
    await secrets.set(instanceSecretKey(row!.id), CREDENTIAL);

    const client = new MockGitLabInstanceClient();
    const app = await makeApp(client);

    const res = await call(app, { method: 'POST', url: `/instances/${row!.id}/test` });

    // The refusal is an `ok: false` result carrying `instance_id`, not a thrown
    // 422 — AC-12 asks for the result "per registered instance", and an error
    // envelope cannot be attributed to a row. Matches the no-token branch.
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      instance_id: row!.id,
      ok: false,
      code: 'private_address',
    });
    expect(res.json().message).toContain('169.254.169.254');
    // The recorded version survives a failed test — it says nothing new.
    expect(res.json().version).toBe('17.4.1');

    // The point of the whole assertion: no outbound verification was attempted
    // against the address the stored row named.
    expect(client.calls).toEqual([]);

    await app.close();
  });

  it('an instance with no stored token reports it as a result rather than a throw (AC-45)', async () => {
    await wipe();
    const app = await makeApp();
    const instance = (await register(app, 'https://gitlab.example.com', 'Primary')).json();
    await app.close();

    // A fresh secrets backend: the row survives, its token does not.
    secrets = new MockSecretsProvider();
    const app2 = await makeApp();
    const res = await call(app2, { method: 'POST', url: `/instances/${instance.id}/test` });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      instance_id: instance.id,
      ok: false,
      code: 'credential_rejected',
      version: '17.4.1',
    });

    await app2.close();
  });

  // ---- Re-registration -----------------------------------------------------

  it('re-registering one base URL refreshes that instance rather than creating a second row', async () => {
    await wipe();
    const app = await makeApp();
    const first = (await register(app, 'https://gitlab.example.com', 'Primary')).json();
    await app.close();

    const rebuilt = await makeApp(
      new MockGitLabInstanceClient({ result: { version: '18.1.0', approvalCapability: 'permitted' } }),
    );
    const second = await call(rebuilt, {
      method: 'POST',
      url: '/instances',
      payload: {
        base_url: 'https://gitlab.example.com/',
        label: 'Primary renamed',
        credential: `${CREDENTIAL}-rotated`,
      },
    });

    expect(second.statusCode).toBe(201);
    expect(second.json().id).toBe(first.id);
    expect(second.json()).toMatchObject({ label: 'Primary renamed', version: '18.1.0' });

    const listed = (await call(rebuilt, { method: 'GET', url: '/instances' })).json();
    expect(listed).toHaveLength(1);
    // The rotated token replaced the old one under the same key.
    expect(secrets.stored[instanceSecretKey(first.id)]).toBe(`${CREDENTIAL}-rotated`);

    await rebuilt.close();
  });
});
