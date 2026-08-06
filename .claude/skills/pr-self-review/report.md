# Report and verdict format

Step 6 of `SKILL.md`. Two artifacts: a file the hook reads, and a report the
human reads.

## The verdict file — `.devdigest/pr-self-review.json`

Gitignored. `scripts/pr-self-review.sh gate` reads exactly four fields —
`head_sha`, `tree_hash`, `verdict`, `overridden_by_user` — and lists the CRITICAL
findings back to the user when it denies.

```json
{
  "created_at": "2026-08-04T12:00:00Z",
  "base_sha": "66727c85ce06d7b16e64f888925d131d558cbe51",
  "head_sha": "ae5a53f4181cf91ad010efaa6eb1f5d7aaa6415e",
  "tree_hash": "0b6b28e72421eef83933c37625c48ba9a07bb71a",
  "branch": "lab/lab02",
  "files": [
    { "path": "server/src/modules/pulls/routes.ts", "status": "review",
      "matched_rows": ["server-routes"] },
    { "path": "client/pnpm-lock.yaml", "status": "skip:lockfile",
      "matched_rows": [] }
  ],
  "skills_loaded": ["backend-onion-architecture", "fastify-best-practices", "security"],
  "gates": [
    { "name": "server:typecheck", "status": "pass", "detail": "-" },
    { "name": "server:arch", "status": "fail",
      "detail": ".devdigest/pr-self-review-logs/server-arch.log" }
  ],
  "findings": [
    {
      "severity": "CRITICAL",
      "file": "server/src/modules/pulls/routes.ts",
      "line": 116,
      "source": "server:arch + backend-onion-architecture#6",
      "grounded": true,
      "rule": "A route holds a Drizzle query — the Fastify edge may not reach the DB.",
      "fix": "Move the query into pulls/repository/pull.repo.ts and call it from the service."
    }
  ],
  "verdict": "block",
  "overridden_by_user": false
}
```

Rules that make it work:

- **`base_sha`, `head_sha`, `tree_hash` are copied verbatim** from
  `./scripts/pr-self-review.sh state`. Never recompute them by hand — the hook
  recomputes `tree_hash` with the script's algorithm, and any other algorithm
  makes every verdict read as stale.
- **`verdict` is `"block"` or `"pass"`**, derived mechanically: one surviving
  CRITICAL ⇒ `block`.
- **`source`** names the skill and section, or the gate, or both when a finding
  was deduplicated across them.
- **`grounded`** is `false` only on a finding whose citation is not in the diff —
  and such a finding is never CRITICAL.
- **`overridden_by_user`** stays `false` unless the user explicitly waived the
  findings in this session, after seeing them. The waived findings stay in
  `findings`: the point of an audited override is the trace it leaves.
- Every file from `./scripts/pr-self-review.sh files` appears in `files`,
  including the skipped ones.

## The chat report

Order: CRITICAL, then HIGH, then MEDIUM, then the footer.

```
## pr-self-review — BLOCK (1 critical, 2 high)

### CRITICAL

**server/src/modules/pulls/routes.ts:116** — a route holds a Drizzle query.
The Fastify edge may not reach the DB; move it to a repository and call it from
the service.
_server:arch + backend-onion-architecture §6_

### HIGH
...

### Coverage
- 14 files: 12 reviewed, 2 skipped (1 lockfile, 1 vendored)
- rows matched: server-routes, server-repo, client-app
- skills loaded: backend-onion-architecture, fastify-best-practices, security,
  drizzle-orm-patterns
- gates: 8 run, 7 pass, 1 fail (server:arch)
- not covered: e2e/ has no skill; the GitHub web UI can open a PR without this gate
```

One finding, one paragraph: **what**, **where**, **why it is that severity**,
**the fix in one line**. No restating the rule at length — cite the section and
let the reader open it.

## The footer is load-bearing

Root `INSIGHTS.md` (2026-08-03): a per-item receipt is the only cheap way to tell
"nothing matched" from "the run broke". A report with no findings and no footer is
indistinguishable from a review that silently did nothing.

So the footer always states:

1. file counts — reviewed vs skipped, with the skip reasons;
2. which routing rows matched, by name;
3. which skills were actually loaded;
4. gate results;
5. **what is not covered** — an `e2e/` change with no skill, a PR openable through
   the web UI, anything the routing table had no row for.

A `pass` on a `docs/`-only diff should read as "zero skills loaded, nothing to
check", not as an endorsement.
