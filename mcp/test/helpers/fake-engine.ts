/**
 * A fake DevDigest engine on loopback: a real `http.createServer` the ApiClient
 * talks to, plus a request log so a test can assert what was NOT requested
 * (which is how "the deadline must not cancel the run" is proved).
 *
 * Loopback only — no test in this package reaches the network.
 */
import http from 'node:http';
import type { AddressInfo } from 'node:net';

/**
 * The run id `POST /pulls/:id/review` answers with. A UUID, because every run
 * id the real engine mints is one (`server/src/modules/_shared/schemas.ts:11`)
 * and it is the value that ends up inside `trace_url` — a short stand-in like
 * `run-1` cannot reproduce the production response shape.
 */
export const FAKE_RUN_ID = '99999999-9999-4999-8999-999999999999';

export interface FakeEngineState {
  agents: Array<Record<string, unknown>>;
  repos: Array<Record<string, unknown>>;
  pulls: Array<Record<string, unknown>>;
  runs: Array<Record<string, unknown>>;
  reviews: Array<Record<string, unknown>>;
  /** The run id created runs are given. */
  runId: string;
  /** Status code to answer with instead of 200, per path fragment. */
  failWith?: { path: string; status: number; code: string; message: string };
}

export interface FakeEngine {
  baseUrl: string;
  requests: string[];
  state: FakeEngineState;
  close(): Promise<void>;
}

export async function startFakeEngine(partial: Partial<FakeEngineState> = {}): Promise<FakeEngine> {
  const state: FakeEngineState = {
    agents: [],
    repos: [],
    pulls: [],
    runs: [],
    reviews: [],
    runId: FAKE_RUN_ID,
    ...partial,
  };
  const requests: string[] = [];

  const server = http.createServer((req, res) => {
    const url = req.url ?? '';
    requests.push(`${req.method} ${url}`);

    const send = (status: number, body: unknown) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    };

    if (state.failWith && url.includes(state.failWith.path)) {
      const { status, code, message } = state.failWith;
      send(status, { error: { code, message } });
      return;
    }

    if (req.method === 'GET' && url === '/agents') return send(200, state.agents);
    if (req.method === 'GET' && url === '/repos') return send(200, state.repos);
    if (req.method === 'GET' && /^\/repos\/[^/]+\/pulls$/.test(url)) return send(200, state.pulls);
    if (req.method === 'GET' && /^\/repos\/[^/]+\/conventions$/.test(url)) {
      return send(200, { candidates: [], last_scan: null });
    }
    if (req.method === 'POST' && /^\/pulls\/[^/]+\/review$/.test(url)) {
      return send(200, { pr_id: 'pr-1', runs: [{ run_id: state.runId }], reviews: [] });
    }
    if (req.method === 'GET' && /^\/pulls\/[^/]+\/runs$/.test(url)) return send(200, state.runs);
    if (req.method === 'GET' && /^\/pulls\/[^/]+\/reviews$/.test(url)) {
      return send(200, state.reviews);
    }

    send(404, { error: { code: 'not_found', message: `no fixture for ${url}` } });
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;

  return {
    baseUrl: `http://127.0.0.1:${port}`,
    requests,
    state,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
