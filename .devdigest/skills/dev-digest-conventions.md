# dev-digest-conventions

House conventions for `dev-digest`, extracted from the repository and reviewed
by hand. Report a **WARNING** when a change violates any rule below, and cite the
offending `file:line`.

## normalize-all-api-failures-network-and-http-into-a-single-ap

Normalize all API failures (network and HTTP) into a single ApiError type so the UI can branch on status.

Detected in `client/src/lib/api.ts:1-3`:

```
/* api.ts — typed fetch client for the F1 Fastify engine (localhost:3001).
   All hooks build on `apiFetch`. Errors are normalized to ApiError so the
   error-UX taxonomy (toast/inline/full-screen) can branch on status. */
```

## only-set-the-json-content-type-header-when-a-body-is-actuall

Only set the JSON content-type header when a body is actually sent, to avoid Fastify rejecting body-less requests.

Detected in `client/src/lib/api.ts:27-30`:

```
// Only declare a JSON body when one is actually sent — otherwise a
// body-less POST/PUT (e.g. tour generate, refresh, reindex) trips
// Fastify's "Body cannot be empty when content-type is application/json".
...(init?.body != null ? { "content-type": "application/json" } : {}),
```

## parse-the-error-body-defensively-falling-back-to-status-text

Parse the error body defensively, falling back to status text when the body is not JSON.

Detected in `client/src/lib/api.ts:48-57`:

```
try {
      const body = await res.json();
      if (body?.error) {
        code = body.error.code;
        message = body.error.message ?? message;
        details = body.error.details;
      }
    } catch {
      /* non-JSON error body */
    }
```

## use-non-null-assertion-on-array-lookups-where-the-element-is

Use non-null assertion on array lookups where the element is guaranteed to exist by construction.

Detected in `client/src/components/diff-viewer/comments.ts:50`:

```
const root = sorted.find((c) => c.id === rootId) ?? sorted[0]!;
```

## name-database-indexes-constraints-with-a-suffix-convention-u

Name database indexes/constraints with a suffix convention: `_uq` for unique indexes, `_idx` for plain indexes.

Detected in `server/src/db/schema/repos.ts:22-23`:

```
uq: uniqueIndex('repos_ws_fullname_uq').on(t.workspaceId, t.fullName),
    wsIdx: index('repos_ws_idx').on(t.workspaceId),
```

## name-shared-internal-schema-helpers-with-an-underscore-prefi

Name shared internal schema helpers with an underscore prefix and keep them out of the public barrel.

Detected in `server/src/db/schema/_shared.ts:3-6`:

```
/**
 * Shared internal column helpers for the schema domain files. NOT re-exported
 * by the `db/schema.ts` barrel — it stays out of the public schema surface.
 */
```

## prefix-react-query-hooks-with-use-and-name-them-after-the-re

Prefix React Query hooks with `use` and name them after the resource they fetch.

Detected in `client/src/lib/hooks/agents.ts:8-13`:

```
export function useAgents() {
  return useQuery({
    queryKey: ["agents"],
    queryFn: () => api.get<Agent[]>("/agents"),
  });
}
```

## name-constants-in-screaming-snake-case-and-export-them-as-na

Name constants in SCREAMING_SNAKE_CASE and export them as named exports.

Detected in `server/src/modules/repo-intel/constants.ts:7-8`:

```
export const INDEX_JOB_KIND = 'repo-intel-index';
export const REFRESH_JOB_KIND = 'repo-intel-refresh';
```
