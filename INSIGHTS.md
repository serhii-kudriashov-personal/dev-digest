# Insights — repo-wide

Lessons that span the whole repo: what broke, why, and how not to step on it
twice. Package-level lessons live in `<pkg>/INSIGHTS.md`.

**Append-only, newest first.** Only what is NOT visible from the code and what
cost real time. Sections are fixed; entry format and routing rules live in
`.claude/skills/engineering-insights/SKILL.md`.

---

## What Works

_Empty so far._

## What Doesn't Work

### 2026-08-02 — A second web instance can't verify a UI change against the running API

**Tried:** verifying a client change in a real browser without disturbing the
user's dev stack, by starting a second Next dev server on `:3100` pointed at the
existing API on `:3001` (`PORT=3100 pnpm dev`, then
`NEXT_PUBLIC_API_BASE=http://localhost:3001`).

**Failed:** twice, for two unrelated reasons.

1. `PORT=` is ignored — `client/package.json`'s `dev` script is literally
   `next dev -p 3000`, so it booted on 3000 and died with `EADDRINUSE`.
2. Once on the right port, every request was blocked by CORS. `webOrigin` is a
   SINGLE origin computed as `http://localhost:${WEB_PORT}`, and the API
   registers `cors` with `origin: [config.webOrigin]`. The API running on `:3001`
   was started with `WEB_PORT=3000`, so `:3100` is not allowed — and the UI
   surfaces this as "Cannot reach the DevDigest engine", which reads like the API
   is down when it is up and answering `curl` fine.

**Instead:** run a matched PAIR against the same DB —
`API_PORT=3002 WEB_PORT=3100 pnpm dev` in `server/`, then
`NEXT_PUBLIC_API_BASE=http://localhost:3002 pnpm exec next dev -p 3100` in
`client/`. Both read the same `.env` `DATABASE_URL`, so the seeded data is
already there, and the user's `:3000`/`:3001` stack is untouched. Tear down with
`kill $(lsof -ti :3100) $(lsof -ti :3002)`.

**Where:** script at `client/package.json` (`"dev": "next dev -p 3000"`);
CORS at `server/src/app.ts:90`; origin derivation at
`server/src/platform/config.ts:77`.

### 2026-08-02 — Stacking convention blocks into an agent's `system_prompt` made the review worse

**Tried:** teaching `General Reviewer` this repo's conventions by appending a
`# Project conventions` section to its `system_prompt` in the Agent editor, then
a second `## Outbound I/O` subsection on top of it. Target was a one-file PR
(`upstream/demo/review-share-webhook`, +40 lines) carrying a planted SSRF.

**Failed:** both blocks landed, but the third run was worse than the second.

| Run | Prompt | Findings | Score | `tokens_in` |
|---|---|---|---|---|
| 1 | stock | 1 — SSRF | 65 | 3709 |
| 2 | `+ ## Three-layer modules` | 3 — SSRF, SQL-in-routes (conf 1.0), reliability | 41 | 3957 |
| 3 | `+ ## Outbound I/O` | 2 — bare-`fetch` (conf 1.0), **hallucinated** missing-`await` (conf 1.0) | 30 | 4025 |

Run 3 dropped both the SSRF and the SQL-in-routes finding, and invented a
"Missing `await` on `fetch`" defect — the reviewed line literally reads
`await fetch(req.body.url, {`. The stock prompt's own `# Findings discipline`
("report only DISTINCT issues", "there is no minimum") seems to make the model
stop once it has a couple of fresh issues, so a newly added rule crowds out what
the previous run caught.

**Instead:** add one rule at a time, re-run, and treat a single run as evidence
of nothing. Control group from the same session: `Performance Reviewer`, prompt
untouched (`tokens_in` identical at 4139 in every run), went 1 → 4 → 3 findings
and 97 → 0 → 50 score. Run-to-run variance is larger than most prompt edits, so
scoring a prompt change needs the eval harness (`eval_cases` / `eval_runs`), not
eyeballing two runs.

**Where:** the live prompt is `agents.system_prompt`, read at
`server/src/modules/reviews/run-executor.ts:193`.

### 2026-08-02 — `diff -r` is the wrong check for the two `vendor/shared` copies

**Tried:** verifying the canon/copy sync rule with
`diff -r server/src/vendor/shared client/src/vendor/shared`, expecting empty
output (this is what the L01 plan specified as its acceptance gate).

**Failed:** it can never be empty. The two trees carry ~120 lines of documented
pre-existing drift — `openrouter` missing from the client's `Provider` unions,
`AgentManifest`, `AgentVersionConfig`, `CommitFilesPayload`, `sessionId`, plus
divergent comment wording in `trace.ts`. A blanket `cp -r` "fixes" the diff but
silently ships unrelated contract changes far outside the task's scope.

**Instead:** diff only the files you touched, and ignore comments when you do:
`diff <(grep -v '^\s*[/*]' server/src/vendor/shared/<f>) <(grep -v '^\s*[/*]' client/src/vendor/shared/<f>)`.
Green means *your* change is synced, which is the actual rule. Closing the
historical drift is its own task.

**Where:** the drift is catalogued in "Recurring Errors & Fixes" below
(2026-08-01); the copies are `server/src/vendor/shared` and
`client/src/vendor/shared`.

## Codebase Patterns

### 2026-08-02 — `CLAUDE.md` is a symlink; the real instruction file is `AGENTS.md`

**Rule:** edit `AGENTS.md`. Each of the five `CLAUDE.md` (root, `server/`,
`client/`, `reviewer-core/`, `e2e/`) is a symlink to the `AGENTS.md` beside it,
and it has to stay one. Never `Write` a fresh `CLAUDE.md` over a link, and never
"resolve the duplication" by deleting one of the two names.

**Why:** Claude Code loads only `CLAUDE.md` — `AGENTS.md` is not read natively,
by design or by setting. So the link is load-bearing, not cosmetic: turn it into
a real file and you get two instruction files that drift silently, with Claude
reading the stale one. Both names must exist, and exactly one of them can hold
content.

**Where:** links at `CLAUDE.md`, `server/CLAUDE.md`, `client/CLAUDE.md`,
`reviewer-core/CLAUDE.md`, `e2e/CLAUDE.md`; rule stated in `AGENTS.md:40`
(Repo rules). Renaming across the repo: a blanket
`sed -i 's/CLAUDE.md/AGENTS.md/g'` must exclude `.claude/skills/zod/` (that
vendored skill ships its own unrelated `AGENTS.md`) and `server/clones/` (a
gitignored stale clone of this repo).

### 2026-08-02 — An `agent_runs` row and its `reviews` row can each outlive the other

**Rule:** when rendering runs and reviews together — they are both on the PR
detail page — never assume one implies the other. A run may have no review, and
a review may have no run row. Code that joins them by `run_id` needs a branch
for "absent", not a `!`.

**Why:** the PR page offers TWO deletes with different blast radii, and neither
touches the other's table. The Timeline's trash calls `DELETE /runs/:id`
(`deleteRun` → run + trace); the run accordion's trash calls
`DELETE /reviews/:id` (`deleteReview` → review + findings, cascade). There is no
FK between them — `RunSummary`'s own comment says "the timeline has no FK to the
review", which is why `findings_count` / `blockers` / `score` are denormalized
onto the run row at completion. So deleting from one place leaves a half-row
visible in the other, and both directions are reachable in a couple of clicks
from the same tab. This is what makes `RunHistory`'s `findingsByRun` prop
optional per row: a run with no review keeps its denormalized `findings_count`
instead of rendering an empty severity breakdown.

**Where:** routes at `server/src/modules/reviews/routes.ts:107` and `:135`;
`deleteReview` deletes only `t.reviews`
(`server/src/modules/reviews/repository/review.repo.ts:83-93`); contract note at
`server/src/vendor/shared/contracts/trace.ts:118-121`; the client's two buttons
are `client/src/app/repos/[repoId]/pulls/[number]/page.tsx:170` (run) and
`.../_components/ReviewRunAccordion/ReviewRunAccordion.tsx` (review); the
fallback is `.../_components/RunHistory/RunHistory.tsx`.

### 2026-08-02 — A rule added to an agent prompt must state its own severity

**Rule:** every behavioural rule appended to an agent's `system_prompt` has to
say which level to report at — `Report a **WARNING** when …`. Leave it out and
the model defaults to CRITICAL.

**Why:** same agent, same session, two blocks. `## Three-layer modules` spelled
out "Report a **WARNING**" and the finding came back WARNING. `## Outbound I/O`
left severity unstated, and the same class of maintainability issue came back
CRITICAL — which is not cosmetic: the stock `# Verdict` section makes the verdict
a pure function of whether any CRITICAL exists, so the run flipped to
`request_changes` and `score` fell 41 → 30.

**Where:** stock texts are mirrored in `docs/agent-prompts/*.md`; the live copy
is `agents.system_prompt`.

### 2026-08-02 — `## Skills / rules`, `## Relevant memory`, `## Project context` are wired to nothing

**Rule:** until a later lesson wires them, project conventions can reach a review
agent **only** through `agents.system_prompt`. Do not go looking for a
conventions loader — there isn't one.

**Why:** `assemblePrompt` does build those three sections, but only when handed
`skills` / `memory` / `specs`, and the server never hands them over —
`reviewPullRequest()` is called with just `systemPrompt`, `diff`, `callers`,
`repoMap`, `prDescription`, `task`, and the run trace records
`{ skills: null, memory: null, specs: null }` as literals. The `skills`,
`conventions` and `memory` tables are empty by design. The upstream branch
`lesson-2-lab/skills` is presumably what closes this.

**Where:** `reviewer-core/src/prompt.ts:109-114`;
`server/src/modules/reviews/run-executor.ts:192-213` and `:439`.

### 2026-08-02 — A field added to a persisted-jsonb contract must be `.nullish()`

**Rule:** when you add a field to a Zod schema that is stored as a **jsonb
document** rather than as columns, declare it `.nullish()`, never `.nullable()`.
`.nullable()` accepts an explicit `null` but REJECTS a missing key, and every
document already on disk is missing the new key.

**Why:** `RunTrace` is persisted whole into `run_traces.trace`. Declaring
`RunStats.cost_usd` as `.nullable()` would have made every trace written before
L01 unparseable — a silent, total break of run history that no typecheck
catches, because the rows are `jsonb` and only validate at read time. The
sibling field `RunSummary.cost_usd` IS `.nullable()`, and correctly so: it is
rebuilt from columns on every read, so the key is always present.

**Where:** `server/src/vendor/shared/contracts/trace.ts:67` (`RunStats`, nullish)
vs `:112` (`RunSummary`, nullable); persistence at
`server/src/modules/reviews/repository/run.repo.ts:170` (`saveRunTrace`).
Guard test: `server/test/contracts.test.ts:167`.

### 2026-08-02 — Unknown cost is `null`, never `0`

**Rule:** a run that did not bill anything because it never got that far stores
`cost_usd = NULL`. Only a run that genuinely cost nothing stores `0`. The UI
renders `null` as `—` and `0` as `$0.0000`.

**Why:** the failure paths already zero `tokensIn`/`tokensOut`, so the tempting
move is to zero the cost alongside them. That makes a run that died on a missing
API key render as `$0.00` — indistinguishable from a free run, and actively
misleading on a screen whose whole purpose is spend. The distinction is load
bearing across all four render sites, so it is asserted end to end rather than
left as a convention.

**Where:** `server/src/modules/reviews/run-executor.ts:85` (`failAll`) and `:309`
(catch); formatter `client/src/lib/format.ts:17`; asserted in
`server/test/reviews.it.test.ts` ("a failed run records cost_usd = NULL, not 0").

### 2026-08-01 — `costUsd` reaches the server and dies there

**Symptom:** cost is computed in the adapters and accumulated by the engine, but
never surfaces anywhere.

**Cause:** commit `d45ab0d` removed the consumer (per-run cost) and left the
producer in place. This is intentional — the cost badge returns in L01.

**Takeaway:** don't "fix" it as a forgotten wire and don't delete it as dead
code.

**Superseded by:** 2026-08-02 — L01 landed; the consumer is back. `cost_usd` is
persisted on `agent_runs` again (migration `0010_bored_raider.sql`) and rendered
at four sites. The producer side is unchanged: cost still originates in the
adapters and is accumulated by `reviewer-core`, so there is still nothing to
"fix" there.

## Tool & Library Notes

### 2026-08-02 — A committed symlink survives macOS/Linux clones and dies silently on Windows

**Quirk:** git stores a symlink as mode `120000` with no `.gitattributes` and no
config — a fresh checkout materializes a real link. But a Windows checkout
WITHOUT `core.symlinks=true` (or Developer Mode) writes a regular file whose
entire content is the target path. For `CLAUDE.md` that means Claude Code loads a
one-line memory file reading `AGENTS.md` — no error, no warning, the project
instructions are simply gone and the session looks like the repo has no
conventions.

**Workaround:** on Windows clone with `git clone -c core.symlinks=true`. To
verify a checkout anywhere: `git ls-files -s '*CLAUDE.md'` must print `120000`
on every row (`100644` means the link was flattened or a tool dereferenced it),
and `/context` must show a non-trivial token count for the memory file — ~1.8k
for root, not ~10. To test the staged links before committing, use
`git checkout-index -a -f --prefix=/tmp/check/`; a plain `git clone .` only
reflects HEAD and will show the pre-rename layout.

**Where:** `CLAUDE.md` and `<pkg>/CLAUDE.md`; no `.gitattributes` exists in this
repo and none is needed.

### 2026-08-02 — `findings.confidence` is not calibrated — never gate on it

**Quirk:** the model emits `confidence: 1.0` for a hallucination as readily as
for a correct finding. One run returned "Missing `await` on `fetch`" at
confidence 1.0 against a line that reads `await fetch(...)`; the previous run's
correct SQL-in-routes finding also came in at 1.0.

**Workaround:** do not filter, sort, rank or auto-act on `confidence` — treat it
as prose, not a signal. Note that grounding does not cover this either:
`agent_runs.grounding` ("2/2 passed") only proves the cited lines exist in the
diff, never that the claim about them is true.

**Where:** `findings.confidence`; `agent_runs.grounding`.

## Recurring Errors & Fixes

### 2026-08-01 — `@devdigest/shared` drifts silently between server and client

**Symptom:** the client's types don't know about the `openrouter` provider even
though the server fully supports it; `AgentManifest`, `AgentVersionConfig`,
`CommitFilesPayload` and the `sessionId` field are missing too.

**Cause:** the contracts are vendored twice — `server/src/vendor/shared` (canon)
and `client/src/vendor/shared` (copy). There is no sync script, and CI can't
catch the divergence because each package typechecks in isolation and both pass.

**Takeaway:** always edit the canon and port the change in the same commit.
Before touching contracts, check: `diff -r server/src/vendor/shared
client/src/vendor/shared`.

## Session Notes

_Empty so far._

## Open Questions

_Empty so far._
