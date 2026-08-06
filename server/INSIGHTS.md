# Insights — server

Lessons learned in this package: what broke, why, and how not to repeat it.
Cross-package lessons go in the root `INSIGHTS.md`.

**Append-only, newest first.** Only what is NOT visible from the code and what
cost real time. Sections are fixed; entry format and routing rules live in
`.claude/skills/engineering-insights/SKILL.md`.

---

## What Works

### 2026-08-03 — `--no-file-parallelism` makes the integration suite deterministic AND faster; re-running is the wrong fix

**Pattern:** run the DB-backed suite serialized, always:

```sh
cd server && pnpm exec vitest run .it.test --no-file-parallelism
```

Three consecutive runs: `7 passed (7)` / `37 passed (37)`, every time. Measured
against the parallel form, it is also **faster** — 87s vs 121s — because the
Docker daemon is not thrashing seven Postgres containers into existence at once.
There is no trade-off to weigh here: serialized is both more correct and quicker.

**Why:** this supersedes the "re-run it" workaround in the entry below, which
treats a skip as bad luck. The skip is load-dependent, not random, and the
parallel form is *unreliable in both directions* — measured the same afternoon,
same code, same Docker daemon:

| Command | Result |
|---|---|
| `vitest run .it.test` (parallel) | `7 passed` — then `1 passed \| 6 skipped` on the very next run |
| `pnpm test` (all 24 files, parallel) | `18 passed \| 6 skipped`, **exit 0** |
| `vitest run .it.test --no-file-parallelism` | `7 passed`, ×3 runs |

Note the second row: the full-suite run is the *worst* case, because the 17
hermetic files occupy the workers while the DB-backed files are still probing.
So `cd server && pnpm test` is the one command you should never trust for
integration coverage — and it is the obvious one to reach for.

The mechanism is narrower than "a probe loses a race". `dockerAvailable()` is
`execSync('docker info', { timeout: 5000 })`, and its `catch` maps **timeout**
and **no daemon** to the identical `false`. Measured directly: `docker info`
costs 0.09–0.66s idle and ~0.84s with seven concurrent invocations — nowhere near
5s. It only blows the timeout once testcontainers is *concurrently starting
containers*, which is why serializing the files fixes it and why a warm-but-busy
daemon (right after another suite tore its containers down) is the worst moment
to probe.

**Where:** probe at `server/test/helpers/pg.ts:22-33` (`dockerAvailable`, the
5000ms `execSync` and the lossy `catch`); the seven files are
`server/test/*.it.test.ts`. The commands are documented in `server/AGENTS.md`
("Commands") without the flag — add it there if you touch that table.

## What Doesn't Work

### 2026-08-05 — Porting `upstream/reference/full-build`'s conventions module fails three of this repo's own gates

**Tried:** implementing the L02 conventions extractor by taking the complete module
that already exists on `upstream/reference/full-build`
(`server/src/modules/conventions/{constants,helpers,repository,routes,service,extract-pipeline}.ts`
plus its `.it.test.ts`) and adapting it.

**Failed:** three separate gates, none of which the reference branch runs.

1. **`pnpm arch` — `no-cross-slice-import`.** Its `service.ts` does
   `import { SkillsService } from '../skills/service.js'` so that accepting a
   candidate can create a skill. `SLICE_PRIVATE`
   (`.dependency-cruiser.cjs:65`) forbids reaching another slice's `service`.
2. **`InsertSkill` has no `evidenceFiles`.** The reference `accept` passes
   `evidenceFiles: [row.evidencePath]`, and the `skills.evidence_files` column
   exists (`src/db/schema/skills.ts:19`) — but this branch's
   `modules/skills/repository.ts:17` had dropped the field, so it typechecks
   nowhere and the provenance link is silently lost.
3. **Route validation style.** It uses `app.get<{Params:{id:string}}>` with no
   `schema:` and calls `ExtractBody.parse(req.body ?? {})` inside the handler,
   which `server/AGENTS.md:33` forbids outright.

**Instead:** the interaction design solved (1) for free. Because the user's flow
puts an editable modal between *accept* and *save*, the module never creates a
skill at all — it returns a draft (`POST /repos/:id/conventions/skill-draft`,
persists nothing) and the client saves it through the existing `POST /skills`. No
cross-slice import exists to forbid. (2) was a three-line restoration
(`InsertSkill.evidenceFiles`, `insert()`, `CreateSkillBody.evidence_files`) with no
migration. (3) is mechanical: `withTypeProvider<ZodTypeProvider>()` plus
`{ schema: { params: IdParams, body: … } }`.

Two softer notes for anyone reading that branch: its `loadRepo` runs Drizzle from
`extract-pipeline.ts`, which is ring 2 and escapes `no-sql-in-service` only because
the rule matches by filename — the honest home is `conventions/repository.ts`; and
its `provider` enum predates OpenRouter.

**Where:** the landed module is `src/modules/conventions/` (compare against
`git show upstream/reference/full-build:server/src/modules/conventions/service.ts`);
the arch rules are `server/.dependency-cruiser.cjs:65,128`; the restored field is
`src/modules/skills/repository.ts:17` and `src/modules/skills/routes.ts:33`.

### 2026-08-03 — The `*.it.test.ts` skip is a CONCURRENCY race, not a missing Docker

**Tried:** verifying Phase-1 server changes with one batch run,
`pnpm exec vitest run .it.test`, and reading the summary.

**Failed:** the batch reported `Test Files 6 passed | 1 skipped` /
`Tests 35 passed | 2 skipped` and **exit code 0**. An immediate re-run of the
same command passed all 7 files (37 tests), and every file also passed when run
alone. Nothing about the code changed between the two runs.

**Instead:** treat any `N skipped` on a batch integration run as "unverified,
re-run", not as "Docker is absent". The cause is that all 7 files evaluate
`const hasDocker = await dockerAvailable()` at **module top level**, so the
probe fires 7 times while 7 testcontainers Postgres instances are starting; one
probe loses the race, and that file degrades to `describe.skip` — silently, with
no red. To pin down which file, run the batch with
`pnpm exec vitest run .it.test 2>&1 | grep -E "^ *[✓↓×] test/"` and compare the
per-file list against the 7 on disk, then re-run the missing one alone.

This is the mechanism behind the existing "SKIPPING silently reads as passing"
entry below, which named the symptom but attributed it to an absent Docker
daemon. On CI the same race is likelier than locally, not less — a green
`server integration` job is only meaningful if the file count is 7.

**Where:** probe at `server/test/helpers/pg.ts` (`dockerAvailable`); the
top-level call is line ~13 of each of the seven
`server/test/*.it.test.ts` files, e.g. `test/agents-versions.it.test.ts:13`.

**Superseded by:** 2026-08-03 — the diagnosis (a concurrency race, not a missing
daemon) stands, but "re-run it" is the wrong remedy and "one probe loses"
understates it: a full `pnpm test` skipped **6 of 7**. Use
`--no-file-parallelism`, which is deterministic and faster. See the entry in
"What Works" above.

### 2026-08-02 — A green first run of `pnpm arch` proved nothing: 8 of 9 rules were blind

**Tried:** authoring `server/.dependency-cruiser.cjs` (9 ring-boundary rules) and
taking `✔ no dependency violations found (149 modules, 349 dependencies cruised)`
on the first run as evidence the backend was clean.

**Failed:** the rules were not passing, they were not matching. Two independent
silent-miss causes, and the run looks identical to a real pass:

1. **`tsPreCompilationDeps: false` means unused imports do not exist.** depcruise
   reads the post-TypeScript graph, and TS elides an import whose binding is
   never used in a value position. Every probe written as
   `import { eq } from 'drizzle-orm';` produced **zero** graph edges, so four
   rules "didn't fire" while being perfectly correct.
2. **An unresolvable package has no path to match.** See the Tool & Library note
   below — `core-is-pure` happily passed a `fastify` import in `reviewer-core`.

**Instead:** a depcruise rule that has never fired has not been tested. For each
rule, introduce the violation it targets **and use the imported binding**
(`import { eq } from 'drizzle-orm'; export const _probe = eq;`), confirm the rule
name appears in the output, then revert. `no-circular` needs a real *value* cycle
— a type-only one is elided too, so `import { AgentRow }` used only in a type
position will not trip it; `import { AgentsService }` assigned to a const will.
All 10 rules are proven this way; the procedure is written into
`.claude/skills/backend-onion-architecture/SKILL.md` §10.

**Where:** config at `server/.dependency-cruiser.cjs` (`tsPreCompilationDeps` in
`options`, bottom of file); script at `server/package.json` (`"arch"`).

### 2026-08-02 — `*.it.test.ts` SKIPPING silently reads as passing

**Tried:** running `pnpm exec vitest run test/reviews.it.test.ts` to verify new
DB-backed assertions. Output: `7 tests | 7 skipped`, exit code 0, no red.

**Failed:** nothing was verified. `dockerAvailable()` shells out to
`docker info`, and when that call cannot reach the daemon the whole suite
degrades to `describe.skip` by design (so CI without Docker stays green). Under
an agent/tool sandbox the socket is blocked for spawned processes even though
`docker info` succeeds when run directly in the same shell — so the probe is
false, every integration test evaporates, and the run still looks clean. A
Postgres container being up and healthy is NOT evidence the tests ran.

**Instead:** read the test COUNT, never just the exit code. `N skipped` on an
`.it.test.ts` file means unverified, not passing. If the probe is wrong, re-run
with the sandbox disabled — the tests then execute normally against
testcontainers.

**Where:** probe at `server/test/helpers/pg.ts:23` (`dockerAvailable`), gate at
`server/test/reviews.it.test.ts:13` (`const d = hasDocker ? describe : describe.skip`).

## Codebase Patterns

### 2026-08-05 — A non-review caller of `assemblePrompt` must use the `diff` slot, and will be mislabelled

**Rule:** when you call `assemblePrompt` for something that is not a diff review —
the conventions extractor sends a *sample of repository files* — put the payload in
`parts.diff` anyway, and accept the `## Diff to review` heading. Do not route it
through `repoMap` to get a nicer label.

**Why:** `reviewer-core/AGENTS.md` says every prompt slot is optional and an empty
one is omitted, which is true of all of them **except** `diff`:
`userSections.push(\`## Diff to review\n${wrapUntrusted('diff', parts.diff)}\`)` is
unconditional (`reviewer-core/src/prompt.ts:120`). So using `repoMap` for the bodies
does not remove the Diff section — it emits an *empty* one alongside, which misleads
the model more than a wrong heading does.

What actually matters is the property, not the name: `diff` is `wrapUntrusted`-wrapped,
so repository content arrives as data the model is told to ignore instructions from.
Prefix each body `FILE: <path>` and the content is unambiguous despite the heading.
`prompt.ts` is on the do-not-touch list, so adding a "files" slot is not a drive-by
fix — if a future lesson needs one, it is a deliberate change to the shared engine.

**Where:** `src/modules/conventions/extract-pipeline.ts` (the `assemblePrompt` call
carries this reasoning as a comment); the unconditional push is
`reviewer-core/src/prompt.ts:120`; asserted end to end by
`server/test/conventions.it.test.ts` ("sends repo content as UNTRUSTED data, never as
instructions").

### 2026-08-02 — A PR-list rollup may already exist in `modules/pulls/status.ts` — and its docblock may lie

**Rule:** before writing a new per-PR aggregate for `GET /repos/:id/pulls`, grep
`modules/pulls/status.ts`. Helpers there are pure, exported and unit-tested, but
**not necessarily called** — check for a production caller before assuming the
feature exists, and before writing a second copy of the logic.

**Why:** `rollupSeverities` (severity tally for the list's FINDINGS column) is
fully written and covered by `test/pulls-status.test.ts:52`, yet has zero callers
— the column was designed, half-built, then pulled back, exactly like
`agent_runs.cost_usd` before L01. Worse, the two comments about it **contradict
each other**: the `status.ts` docblock states "The Pull Requests list shows, per
PR: the latest review's SCORE, **a FINDINGS severity breakdown**, and a review
STATUS", while `pulls/routes.ts:116` states "the per-severity FINDINGS breakdown
is **intentionally not surfaced** on the list". Neither comment is evidence of
anything; only the call graph is. Note the helper's keys are lowercase
(`critical/warning/suggestion`) while the contracts' `findings_by_severity`
aggregates use uppercase — they were written apart and never reconciled.

**Where:** `server/src/modules/pulls/status.ts:23` (helper + stale docblock);
`server/src/modules/pulls/routes.ts:114-152` (the two rollups that *are* wired,
score and cost — copy their shape) and `:116` (the contradicting comment);
uppercase siblings at `src/vendor/shared/contracts/observability.ts:111` and
`contracts/productionize.ts:156`.

### 2026-08-02 — The `findings` table has no indexes at all — a FK is not an index

**Rule:** any new query that joins or filters `findings` must ship its own index
in the same migration. Do not assume `review_id` is indexed because it is a
foreign key — Postgres auto-indexes primary keys and unique constraints, never
foreign keys, and Drizzle's `.references()` only emits the constraint.

**Why:** `0000_init.sql:142-158` declares the whole table without a single
index; the `review_id` FK constraint lands separately at `:378` and creates
nothing. Every read of findings to date goes through `reviewsForPull`, which
fetches by `inArray(reviewId, …)` on a table small enough that nobody noticed.
The first per-PR aggregate joining `findings` → `reviews` turns that into a full
scan on every PR-list load, which polls every 60 s.

**Where:** table at `server/src/db/schema/reviews.ts` (add the index there, then
`pnpm db:generate` — applied migrations are never edited); DDL at
`server/src/db/migrations/0000_init.sql:142-158`, FK at `:378`; the current sole
reader is `src/modules/reviews/repository/review.repo.ts:reviewsForPull`.

### 2026-08-02 — The live agent prompt is `agents.system_prompt`, not `docs/agent-prompts/`

**Rule:** editing an agent in the UI writes the `agents.system_prompt` column and
takes effect on the very next run — no restart, no migration. `docs/agent-prompts/*.md`
and `src/db/seed-prompts.ts` are seed material only; the moment someone edits in
the UI they stop describing what the model actually receives. Sync them by hand
if the change should survive a fresh database.

**Why:** the executor passes the column straight through
(`systemPrompt: agent.systemPrompt`). And `pnpm db:seed` will NOT put the file
version back over a UI edit — it looks the agent up by workspace + name and
inserts only when missing, so re-seeding is a no-op for an agent that exists.
That is convenient here, but it also means a stale prompt can never be repaired
by re-seeding.

**Where:** `src/modules/reviews/run-executor.ts:193`; `src/db/seed.ts:217-220`;
the editor field is
`client/src/app/agents/[id]/_components/AgentEditor/_components/ConfigTab/ConfigTab.tsx:130`.

## Tool & Library Notes

### 2026-08-05 — `pnpm db:generate` goes INTERACTIVE when one migration both drops and adds a column

**Quirk:** a schema edit that removes `accepted` and adds `status` makes
`drizzle-kit generate` stop and ask
`Is category column in conventions table created or renamed from another column?`
with a cursor-key menu. It needs a real TTY, so from a script it just hangs and then
dies with `ELIFECYCLE Command failed` — having written **no** migration, while its
log still shows the full table inventory as if it had worked.

Piping does not help and makes it worse: `yes '' | pnpm db:generate` floods the
prompt and the run fails the same way, again leaving nothing behind. Only the
combination of a drop *and* an add triggers it — either alone is unambiguous.

**Workaround:** split it into two generates, so neither is ambiguous.

1. Keep the old column in the schema, add the new ones, run `pnpm db:generate` →
   a purely additive migration (nothing dropped ⇒ nothing to disambiguate).
2. Remove the old column, run it again → a pure `DROP COLUMN`.

That is why the conventions change ships as `0014_amusing_forge.sql` (additive plus
`convention_scans` plus both indexes) and `0015_messy_hellfire_club.sql`
(`ALTER TABLE conventions DROP COLUMN accepted`) rather than one file. `expect(1)` is
the other route if you truly need a single migration — `/usr/bin/expect` is present
and a bare `\r` selects the already-highlighted "create column" — but two migrations
are cheaper and read more honestly in the log.

**Where:** `src/db/migrations/0014_amusing_forge.sql` and `0015_messy_hellfire_club.sql`;
schema at `src/db/schema/knowledge.ts:31`; reasoning recorded in
`specs/l02-conventions-extractor.md` §Migrations.

### 2026-08-05 — `pnpm test` is red here for an environmental reason: 8 `*.it.test.ts` files start 8 Postgres containers at once

**Quirk:** on this machine the full `pnpm test` reports ~6 of 8 integration files
failing with `Error: Hook timed out in 120000ms` inside `beforeAll` — i.e. in
`startPg()`, before a single assertion runs. It is **not** a regression and not
specific to any one file: each file passes on its own, and the same 6 fail with a
newly added file *excluded*. Vitest runs test files in parallel, each
`.it.test.ts` spins up its own pgvector container via testcontainers, and eight
simultaneous container starts starve past the 120s `hookTimeout` in
`vitest.config.ts`.

The failure mode is the problem: a timeout in a `beforeAll` looks exactly like
"the change under test broke the integration suite", so it invites a long hunt for
a bug that is not there.

**Workaround:** run the integration lane serially —

```sh
cd server && pnpm exec vitest run .it.test --no-file-parallelism   # 8 files, 51 tests, ~60s
cd server && pnpm exec vitest run --exclude '**/*.it.test.ts'      # unit lane, ~6s
```

Serially all 8 files pass. Before blaming your change for an `.it.test.ts`
timeout, re-run with `--no-file-parallelism`, and if you need to attribute a
failure, re-run the single file. Note CI's `server-integration` job runs the
parallel form (`pnpm exec vitest run .it.test`) on a dedicated runner, so a green
CI does not mean the parallel form works locally.

**Where:** timeouts at `server/vitest.config.ts` (`hookTimeout: 120_000`);
container fixture `server/test/helpers/pg.ts` (`startPg`); the eight files are
`server/test/*.it.test.ts`; lanes documented in `TESTING.md:67`.

### 2026-08-05 — A base64 upload route needs its OWN `bodyLimit`, or the app-wide 1 MiB rejects it with an opaque 413

**Quirk:** `buildApp` sets a global `bodyLimit: 1_048_576` (`app.ts:49`). A JSON
route that carries a file as base64 gets ~33% inflation plus the envelope, so a
**~750 KB** upload already exceeds 1 MiB. Fastify rejects it before the handler
runs, so no service-level validation, log line, or error message of yours ever
executes — the client sees a bare 413 that reads like an unrelated network fault
rather than "your file is too big".

**Workaround:** set `bodyLimit` per route, and keep the service's own size ceiling
**below** it so the readable error always wins the race:

```ts
app.post('/skills/import',
  { schema: { body: ImportBody }, bodyLimit: IMPORT_BODY_LIMIT_BYTES },  // 1.5 MB
  async (req) => service.importPreview(req.body.filename, req.body.content_base64));
```

with `MAX_IMPORT_BYTES = 512 * 1024` checked on the *decoded* buffer. Two separate
limits are needed, not one: a compressed archive also needs a cap on its
**decompressed** total (`MAX_UNPACKED_BYTES`), because a small zip can expand
without bound and the upload-size check cannot see that. The upstream lesson
branch omits both the route limit and the unpacked cap while allowing a 5 MB
import — i.e. every import over ~750 KB 413s there.

**Where:** global limit `server/src/app.ts:49`; route override and the reasoning
comment in `server/src/modules/skills/routes.ts`; the three constants and why they
are ordered that way in `server/src/modules/skills/constants.ts`; zip-bomb guard
in `server/src/modules/skills/helpers.ts` (`previewFromZip`), asserted by
`server/test/skills-import.test.ts` ("rejects an archive that expands past the
unpacked ceiling").

### 2026-08-03 — A Drizzle transaction handle is NOT a `Db`, so composing repo helpers needs `DbOrTx`

**Quirk:** `db.transaction(async (tx) => …)` hands the callback a
`PgTransaction`, which is **not** assignable to
`Db = PostgresJsDatabase<typeof schema>`. So the obvious way to make two existing
repository helpers atomic — call them with `tx` — fails typecheck, even though
every query method they use exists on both.

**Workaround:** `DbOrTx` in `db/client.ts`, derived rather than hand-written so
it cannot drift from Drizzle's own type:

```ts
export type DbOrTx = Db | Parameters<Parameters<Db['transaction']>[0]>[0];
```

Widen the *helpers* to `DbOrTx`; keep the public repository method taking `Db`
and opening the transaction itself. The boundary that matters: `DbOrTx` stays
inside ring 3. A transaction handle must never appear in a signature a service or
a route can see, or the "abstraction" starts leaking transaction scope — see the
`backend-onion-architecture` skill, §5.

**Where:** type at `server/src/db/client.ts:7`; the pattern in use at
`server/src/modules/reviews/repository/review.repo.ts`
(`insertReviewWithFindings` opens the transaction, `insertReview` /
`insertFindings` take `DbOrTx`); second instance at
`server/src/modules/reviews/repository/run.repo.ts` (`deleteAgentRun`).

### 2026-08-02 — `octokit` and `p-queue` are UNRESOLVABLE to dependency-cruiser, so `resolved` is the bare specifier

**Quirk:** a depcruise dependency normally carries
`resolved: 'node_modules/drizzle-orm/index.js'`, but for a package the resolver
cannot enter it carries the **bare specifier with no slashes at all**. Two are in
that state in this package today:

```
src/adapters/github/octokit.ts        -> octokit    (couldNotResolve)
src/platform/jobs.ts                  -> p-queue    (couldNotResolve)
src/modules/repo-intel/pipeline/full.ts -> p-queue   (couldNotResolve)
```

So a rule written the obvious way — `to: { path: '/fastify/' }` — matches the
resolved form and **silently misses the unresolvable one**. That is exactly how
`core-is-pure` passed an `import Fastify from 'fastify'` planted in
`reviewer-core/src/prompt.ts`: `fastify` is not a `reviewer-core` dependency, so
it resolved to the bare string and the regex never matched. The rule that matters
most for ring-1 purity is the one most likely to be blind, because the packages
ring 1 must never import are precisely the ones it cannot resolve.

**Workaround:** match packages as `(^|/)<name>(/|$)` — the `pkg()` helper at the
top of the config. It covers the resolved path, the pnpm
`.pnpm/<v>/node_modules/<name>/` form and the bare specifier, and the trailing
`(/|$)` stops `fastify` matching `fastify-sse-v2`. Belt and braces: the
`core-resolves-everything` rule fails ring 1 on **any** `couldNotResolve`
dependency, closing the whole class. It is scoped to `reviewer-core` on purpose —
promoting it to `src/**` would fire on the three pre-existing hits above.

**Where:** `server/.dependency-cruiser.cjs` — `pkg()` and the `DRIZZLE`/`FASTIFY`
constants near the top, `core-is-pure` and `core-resolves-everything` in
`forbidden`.

### 2026-08-02 — The depcruise config must be `.cjs`, and `depcruise --init` writes the wrong extension

**Quirk:** `server/package.json` is `"type": "module"`, so a
`.dependency-cruiser.js` config is loaded as ESM and its `module.exports` fails.
`depcruise --init` generates exactly that filename, so the scaffolding command
produces a config this package cannot load.

**Workaround:** write `.dependency-cruiser.cjs` by hand and pass it explicitly
(`depcruise src ../reviewer-core/src --config .dependency-cruiser.cjs`) rather
than relying on config auto-discovery. Same trap applies to any future
`server/`-local tool config that expects CJS.

**Where:** `server/.dependency-cruiser.cjs`; script at `server/package.json`
(`"arch"`); `"type": "module"` at `server/package.json:4`.

## Recurring Errors & Fixes

### 2026-08-05 — `reviews.it.test.ts` fails on `prompt_assembly` for reasons that have nothing to do with your change

**Symptom:** `TypeError: Cannot read properties of undefined (reading 'skills')` at
`test/reviews.it.test.ts:452` (`trace.prompt_assembly.skills`), in the
"linked skills reach the assembled prompt" block. **Which** test fails moves between
runs — 2 failures alone, a different single failure inside the full lane — so it
reads exactly like a regression from whatever you just touched.

**Cause:** a race in the test's own helper, not in the product.
`waitForPrRuns(db, prId, { expected: 1 })` (`test/helpers/runs.ts:26-29`) counts
**every** terminal `agent_runs` row for that `pr_id`, cumulatively across the whole
file. Earlier tests in the file already left terminal runs against the same seeded
PR, so `terminal.length >= 1` is true the instant it is called; `runWithSkills`
proceeds to `GET /runs/:id/trace` before the run it just started has written one,
and the trace comes back without `prompt_assembly`.

**Takeaway:** before blaming your diff, reproduce on a clean tree — and note that
`git stash` is not the way here, because a partial tree may not build. Use a
detached worktree at `HEAD` with `node_modules` symlinked in:

```sh
git worktree add --detach /tmp/clean HEAD
ln -s "$PWD/server/node_modules" /tmp/clean/server/node_modules
ln -s "$PWD/reviewer-core/node_modules" /tmp/clean/reviewer-core/node_modules
pnpm --dir /tmp/clean/server exec vitest run reviews.it --no-file-parallelism
git worktree remove --force /tmp/clean     # rm the symlinks first
```

The same two failures reproduce there, which settles it in about three minutes. The
real fix, when someone takes it, is for `waitForPrRuns` to count runs created *after*
a baseline (or to filter by the `run_id` the caller already holds) rather than
counting every row for the PR.

**Where:** helper at `server/test/helpers/runs.ts:14-34`; call sites
`server/test/reviews.it.test.ts:446` and `:452`.

### 2026-08-03 — The jsonb `.nullish()` trap, second instance — and the fix is NOT to loosen the DTO

**Symptom:** `GET /agents/:id/versions` returns 500 for an agent whose history
includes a snapshot taken before migration `0002`/`0003`/`0007`. Not one bad row
in the list — the **whole list** fails, because the parse happens inside
`rows.map(...)`.

**Cause:** `AgentVersionConfig` declares `strategy`, `ci_fail_on` and
`repo_intel` as required, but those columns were added by migrations `0002`,
`0003` and `0007` respectively. `agent_versions.config_json` is a jsonb snapshot
of whatever the agent looked like at the time, so every snapshot older than those
migrations is **missing the keys outright** — and a missing key fails a required
Zod field exactly as it fails `.nullable()`.

**Takeaway:** this is the documented `RunStats.cost_usd` trap again, but the
same fix does not apply, because `AgentVersionConfig` is **also the wire DTO** —
loosening it would push "strategy might be absent" onto every client. Split the
two roles instead:

1. A lenient read schema, `StoredAgentVersionConfig =
   AgentVersionConfig.extend({ … .nullish() })`, used to parse what is on disk.
2. The strict `AgentVersionConfig` unchanged, as the contract going out.
3. Backfill with the **columns' own defaults** (`'single-pass'`, `'critical'`,
   `true`) so a replayed old version behaves the way that agent actually behaved,
   rather than getting today's defaults or a null.
4. `toAgentVersionDtoSafe` for the list path — one corrupt snapshot should cost
   that row, not the endpoint. Single-version reads keep throwing: there is no
   partial answer to give.

Rule of thumb: before declaring a jsonb-persisted field required, check
`git log --oneline -- src/db/migrations` for when its column landed. If the
column is newer than the table, the field is `.nullish()`.

**Where:** `server/src/vendor/shared/contracts/knowledge.ts:206` (strict DTO) and
`:218` (`StoredAgentVersionConfig`); backfill at
`server/src/modules/agents/helpers.ts` (`toAgentVersionDto`,
`toAgentVersionDtoSafe`); list path at
`server/src/modules/agents/service.ts:120`.

### 2026-08-02 — `completeAgentRun`'s parameter type is declared TWICE

**Symptom:** adding a field to the `values` object of
`repository/run.repo.ts:completeAgentRun` and passing it from the executor fails
typecheck with three copies of
`TS2353: 'costUsd' does not exist in type '{ status: ... }'` — pointing at the
CALL SITES, not at the type that needs changing.

**Cause:** `ReviewRepository` (`modules/reviews/repository.ts`) is a hand-written
facade that re-declares the whole inline `values` type instead of deriving it
from the function it delegates to. The executor calls `this.repo.completeAgentRun`,
so it type-checks against the facade's copy, which knows nothing about the new
field.

**Takeaway:** any change to a `repository/*.repo.ts` function signature needs the
same edit in `modules/reviews/repository.ts`. Grep the method name — if it
appears in both files, expect two edits. The same duplication exists for the
other delegated methods there.

**Where:** `server/src/modules/reviews/repository.ts:151` (facade) mirrors
`server/src/modules/reviews/repository/run.repo.ts:134`.

## Session Notes

_Empty so far._

## Open Questions

### 2026-08-05 — `pull_rate` counts pre-provenance runs as "not pulled", so it reads 0% right after the migration

**Question:** should `pullRate`'s denominator exclude runs that predate
`run_skills`?

The metric is "of the last 30 days' runs by agents currently linking this skill,
how many actually injected it" — a `LEFT JOIN` from `agent_runs` onto
`run_skills`. Every run recorded **before** migration `0013` is in the denominator
and can never match, because no row was ever written for it. Result: a skill that
has been enabled the whole time shows `0%` rather than the truthful `100%`, and
there is no way to tell that apart from a skill that genuinely was never pulled.

It self-heals — after 30 days the window contains only post-migration runs — and
`null` is already handled correctly for "no eligible runs at all". So this is
wrong only in the transitional period, and only for workspaces with run history.
Verified live on the dev DB: `lethal-trifecta` and friends show `0% pull` while
`api-contract-gate` (whose agent has never run) correctly shows `—`.

Three candidate fixes, none obviously right:

- **Floor the window** at the earliest `run_skills` row for that agent. Correct,
  but a skill attached to a brand-new agent then has no floor and reads `—` for a
  while.
- **Require the run to have at least one `run_skills` row** to be eligible. Cheap,
  but it also excludes legitimate runs where every skill was disabled — which is
  exactly a 0%-pull case worth counting.
- **Leave it and document it.** What is shipped, on the grounds that the number is
  uninformative rather than false, and that inventing a floor adds a rule readers
  have to learn.

**Blocked:** on a judgement about whether a transitional metric is worth extra
machinery, not on work. If it is worth fixing, the floor variant is ~5 lines in
`pullRate` plus a matching change in `listRollups`, and both need a test with a
run inserted at an explicit `ranAt` before the migration.

**Where:** `server/src/modules/skills/repository.ts` (`pullRate`, and the `pull`
query inside `listRollups`); definition of record in `specs/l02-skills.md`
§"Metric definitions"; migration that created the table is
`server/src/db/migrations/0013_skinny_alice.sql`.
