/**
 * An in-memory `ApiClient` with a call log. Used where a test cares about HOW
 * MANY calls were made (cache hits, cache misses) rather than about the wire.
 */
import type { ApiClient } from '../../src/api-client.js';

export interface StubApi extends ApiClient {
  calls: string[];
  responses: Map<string, unknown | (() => unknown)>;
}

export function stubApi(
  responses: Record<string, unknown | (() => unknown)>,
  baseUrl = 'http://localhost:3001',
): StubApi {
  const calls: string[] = [];
  const table = new Map<string, unknown | (() => unknown)>(Object.entries(responses));

  const answer = (key: string) => {
    if (!table.has(key)) throw new Error(`stubApi: no response registered for ${key}`);
    const value = table.get(key);
    return typeof value === 'function' ? (value as () => unknown)() : value;
  };

  return {
    baseUrl,
    calls,
    responses: table,
    async get(path: string) {
      calls.push(`GET ${path}`);
      return answer(`GET ${path}`);
    },
    async post(path: string, body: unknown) {
      calls.push(`POST ${path} ${JSON.stringify(body)}`);
      return answer(`POST ${path}`);
    },
  };
}
