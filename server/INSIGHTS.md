# Insights — server

Lessons learned in this package: what broke, why, and how not to repeat it.
Cross-package lessons go in the root `INSIGHTS.md`.

**Append-only, newest first.** Only what is NOT visible from the code and what
cost real time. Sections are fixed; entry format and routing rules live in
`.claude/skills/engineering-insights/SKILL.md`.

---

## Index

This file is ~17k tokens. **Read this table first, then open only the entries
whose `Scope` intersects the files you are about to change.** Rules and rationale
for the index are in root `INSIGHTS.md` §Index; **appending an entry means
appending its row here in the same edit.**

| Date | Section | Scope | Entry |
|---|---|---|---|
| 2026-08-09 | Works | `server/test/**`, response assertions | A value returned but rendered NOWHERE has no UI that can notice it breaking — assert it at the boundary |
| 2026-08-08 | Works | `server/src/modules/**/service.ts`, facade tests | A never-throw facade is untestable through a caller with its own `.catch` — test the guarantee at the service |
| 2026-08-03 | Works | `server/test/*.it.test.ts`, vitest config | `--no-file-parallelism` makes the integration suite deterministic AND faster; re-running is the wrong fix |
| 2026-08-17 | Doesn't | `server/test/*.it.test.ts`, `dockerAvailable()`, multi-turn verification | "Docker was unavailable" from an earlier turn is not a property of the environment — it re-checks on every invocation |
| 2026-08-17 | Doesn't | `plans/**`, `Done when` file references | A plan's `Done when` naming a specific test file as proof does not mean that file actually asserts the thing |
| 2026-08-08 | Doesn't | `server/test/reviews.it.test.ts`, `run-executor.ts`, provider mocks | A pre-work step made the suite spend REAL money — `.env` holds live keys and the file mocks only ONE provider |
| 2026-08-05 | Doesn't | `server/src/modules/**`, ports from upstream | Porting `upstream/reference/full-build`'s conventions module fails three of this repo's gates |
| 2026-08-03 | Doesn't | `server/test/helpers/pg.ts`, `*.it.test.ts` | The `*.it.test.ts` skip is a CONCURRENCY race, not a missing Docker |
| 2026-08-02 | Doesn't | `server/.dependency-cruiser.cjs`, `pnpm arch` | A green first run proved nothing: 8 of 9 rules were blind |
| 2026-08-02 | Doesn't | `server/test/*.it.test.ts`, CI lanes | A SKIPPING integration suite silently reads as passing |
| 2026-08-21 | Patterns | `server/src/modules/eval/helpers.ts`, `service.ts#compare`, `client/.../EvalsTab/**`, small case sets | `eval-comparison`'s `attributable` flag guards against a different case set or model, NOT against LLM sampling noise between two runs of the identical config |
| 2026-08-19 | Patterns | `server/src/modules/eval/service.ts`, `executeSet`, NFR-6 | NFR-6's "zero executed cases shall not be recorded" only fires on a pre-first-case cancellation — a parse-failed case still counts as executed and the run IS recorded |
| 2026-08-19 | Patterns | `server/src/modules/eval/helpers.ts`, run-level scoring, arithmetic metrics | A run-level precision score has a real exception to "no denominator → `null`": a must-not-flag-only run that produces nothing scores `1`, not `null` |
| 2026-08-16 | Patterns | `server/src/db/schema/**` link tables, composite PKs, reverse lookups | The composite PK that excuses a link table from an FK index leaves its SECOND column unindexed |
| 2026-08-16 | Patterns | `server/src/modules/**` reading cloned/untrusted files, `node:fs` | `readFile` is the wrong primitive for attacker-supplied content you only need a bounded prefix of |
| 2026-08-16 | Patterns | `server/src/modules/repo-intel/pipeline/walk.ts`, any `**/{dir}/**` file discovery | A depth-agnostic discovery glob makes `EXCLUDED_DIRS` load-bearing — and `walk.ts` will not apply it for you |
| 2026-08-10 | Patterns | prompts under `server/src/modules/**`, intent | A prompt that summarises user text must state its OUTPUT LANGUAGE |
| 2026-08-11 | Patterns | `server/src/modules/repo-intel/**`, blast radius | `repo_index_state.status='partial'` does NOT mean "a working index" |
| 2026-08-11 | Patterns | `server/src/modules/repo-intel/service.ts` | A cap named `MAX_..._PER_SYMBOL` was applied to the FLATTENED list |
| 2026-08-17 | Patterns | `server/src/modules/brief/service.ts`, `server/test/*.it.test.ts` concurrency cases | `BriefService`'s single-flight `Map` is module-scoped, so it is shared across every instance in the process |
| 2026-08-17 | Patterns | `server/src/modules/brief/constants.ts`, `pipeline.ts#fitBudget` | `BRIEF_DROP_ORDER`'s array reads top-to-bottom but drops bottom-to-top |
| 2026-08-17 | Patterns | `server/.dependency-cruiser.cjs`, any slice needing another slice's pure helper | A slice's `constants.ts` export is a sanctioned cross-slice import; a slice's pure helper function is not — promote it to `modules/_shared/<name>.ts` |
| 2026-08-09 | Patterns | `server/src/modules/smart-diff/**`, diff paths | `normalizePath` strips `a/` and `b/`, so a real top-level directory with either name breaks |
| 2026-08-08 | Patterns | `server/.dependency-cruiser.cjs`, `server/src/platform/**` | `no-cross-slice-import` scopes its `from` to `^src/modules/` — which is why the container may import a slice's service |
| 2026-08-05 | Patterns | `reviewer-core/src/prompt.ts` callers, `server/src/modules/**` | A non-review caller of `assemblePrompt` must use the `diff` slot, and will be mislabelled |
| 2026-08-02 | Patterns | `server/src/modules/pulls/status.ts` | A PR-list rollup may already exist there — and its docblock may lie |
| 2026-08-09 | Patterns | `server/src/db/schema/**`, migrations | `findings` and `reviews` ARE indexed now — check the schema before you owe a migration |
| 2026-08-02 | Patterns | `server/src/db/schema/**` | The `findings` table has no indexes at all — a FK is not an index |
| 2026-08-02 | Patterns | `agents.system_prompt`, `docs/agent-prompts/**` | The live agent prompt is the DB column, not the markdown file |
| 2026-08-18 | Tools | `server/.dependency-cruiser.cjs`, auditing `pnpm arch` coverage | Grepping for a `db/schema` import to find gate-blind SQL over-reports — a type-only import is not an edge |
| 2026-08-08 | Tools | model ids, model config | `deepseek/deepseek-v4-flash` and `…-flash-latest` are DIFFERENT models at different prices |
| 2026-08-05 | Tools | `server/src/db/migrations/**`, `pnpm db:generate` | `db:generate` goes INTERACTIVE when one migration both drops and adds a column |
| 2026-08-05 | Tools | `server/test/*.it.test.ts`, running `pnpm test` | `pnpm test` is red here for an environmental reason: 8 files start 8 Postgres containers at once |
| 2026-08-05 | Tools | `server/src/modules/**/routes.ts`, uploads | A base64 upload route needs its OWN `bodyLimit` |
| 2026-08-03 | Tools | `server/src/modules/**/repository.ts`, transactions | A Drizzle transaction handle is NOT a `Db` — compose with `DbOrTx` |
| 2026-08-02 | Tools | `server/.dependency-cruiser.cjs` | `octokit` and `p-queue` are UNRESOLVABLE to dependency-cruiser |
| 2026-08-02 | Tools | `server/.dependency-cruiser.cjs` | The depcruise config must be `.cjs`, and `--init` writes the wrong extension |
| 2026-08-11 | Errors | `server/src/modules/repo-intel/**`, blast contracts | `DownstreamImpact.symbol` is not unique across `blast.downstream` |
| 2026-08-09 | Errors | `server/src/modules/reviews/**`, `agent_runs` | Deleting an `agent_runs` row does NOT stop the run — it keeps spending |
| 2026-08-08 | Errors | `server/test/reviews.it.test.ts`, traces | The `prompt_assembly` flake is a run-vs-trace ordering race |
| 2026-08-05 | Errors | `server/test/reviews.it.test.ts` | It fails on `prompt_assembly` for reasons that have nothing to do with your change |
| 2026-08-03 | Errors | `*/src/vendor/shared/contracts/**`, DTOs | The jsonb `.nullish()` trap, second instance — and the fix is NOT to loosen the DTO |
| 2026-08-02 | Errors | `server/src/modules/reviews/**` | `completeAgentRun`'s parameter type is declared TWICE |
| 2026-08-08 | Open | `server/src/modules/settings/**`, §12 debt | Two slices import `settings/feature-models.ts`, and the §12 fix would break both |
| 2026-08-05 | Open | metrics, `server/src/modules/**` | `pull_rate` counts pre-provenance runs as "not pulled" |

Section keys as in root `INSIGHTS.md` §Index.

---

## What Works

### 2026-08-09 — A value that is returned but rendered NOWHERE has no UI that can notice it breaking — assert it at the boundary that returns it

**Pattern:** when an endpoint returns a field no client consumes yet, put the
assertion on the **boundary function that emits it**, not only on the helper that
computes it:

```ts
// helpers pin the computation…
expect(suggestSplit(files).too_big).toBe(true);
// …and this pins that the builder still CARRIES it into the response
expect(diff.split_suggestion).toEqual(suggestSplit(files));
expect(SmartDiff.parse(diff)).toBeTruthy();
```

**Why:** Smart Diff computes `split_suggestion` server-side and nothing renders
it — the plan's Step 8 prop list omitted it deliberately, leaving the field ahead
of its UI. That is a normal state for a field a later lesson will pick up, and it
creates a specific blind spot: with `suggestSplit` unit-tested and no consumer, a
refactor that stops threading the result into `buildSmartDiff` breaks nothing
visible, fails no test, and produces a response that still parses — because the
contract allows the field to be present-and-empty. The regression surfaces
whenever someone finally builds the UI, by which time the cause is many commits
back.

Generalises past this feature: the same shape covers a field added for an
upcoming client, a trace attribute only an eval reads, and anything behind a flag
that is currently off. The question to ask is "if this silently stopped being
populated, what would go red?" — and if the answer is nothing, the assertion
belongs one layer out from where you were about to put it.

**Where:** the computation is `src/modules/smart-diff/helpers.ts` (`suggestSplit`),
the boundary that carries it is `buildSmartDiff` in the same file; the pair of
assertions is `test/smart-diff-helpers.test.ts:140-145`, with the reason written
in the test. The consumer that does not exist yet is the split-suggestion UI —
`specs/l04-smart-diff.md` §Out of scope records why.

### 2026-08-08 — A never-throw facade is untestable through its production caller the moment that caller has its own containment `.catch` — test the guarantee at the service

**Pattern:** when a port documents "this never throws" (`RepoIntel`, now
`IntentFacade`), write the proof against the **service**, driving each failure in
through `ContainerOverrides`, and assert two things per case: that the call
returned `null`, and a **distinguishing string** from the layer that was supposed
to fail — the provider's `503`, the schema name, the missing key's name. Without
the second assertion the test only proves that `null` came back from somewhere,
which is also what a stub returning `null` at step 1 proves.

Assert as well that **nothing was persisted**. A half-written row is worse than a
clean failure: on the next call it reads as a valid cache and silently suppresses
the retry, so the degraded path succeeds once and then stops running at all.

**Why:** the obvious place to test it is the caller, and that test is a trap. The
L03 pre-work step is `container.intent.ensure(...).catch(() => null)` in
`run-executor.ts`, and the integration case "a throwing `ensure` still lets the
review run to completion" passes **because of the `.catch`** — it proves the
caller's resilience, a different property. If `ensure` regressed to throwing,
nothing would go red.

The reflex fix — delete the `.catch` so the contract becomes load-bearing — is
wrong here, and the reason generalises. That step sits **outside** the try/catch
that calls `failAll`, and `executeRuns` runs in the background un-awaited by the
route, so an escaping throw is an unhandled rejection that leaves every queued
run with no status and no trace. The `.catch` is a containment boundary, not a
duplicate guarantee. Keep it, and move the proof to where the guarantee lives.

Two placement notes that cost time. These tests have to be `*.it.test.ts`: the
service constructs its repository from `container.db` and `ensure` reads the pull
**before** any failure path is reachable, so a hermetic fake `db` makes every
case return `null` at step 1 — green for the wrong reason. And append them to the
existing `.it.test.ts` file for that slice rather than starting a new one, so the
Postgres container starts once.

One limb stays untested and that is the honest outcome: "a DB hiccup returns
`null`" cannot be forced without either corrupting the shared fixture for every
other case in the file, or stubbing `container.db` — which short-circuits the
test. It rests on the same single `try/catch` the other four limbs exercise.

**Where:** the contract is `src/modules/intent/types.ts` (`IntentFacade`
docblock); the implementation's single `try/catch` is `src/modules/intent/service.ts`
(`ensure`); the containment boundary and the reason it stays are commented at
`src/modules/reviews/run-executor.ts` (the `Deriving PR intent` step); the proof
is `test/intent.it.test.ts` (`describe('the degraded contract — ensure NEVER
throws')`, five cases incl. "nothing persisted on failure"); the caller-side test
that does NOT prove it is `test/reviews.it.test.ts`. Precedent for the port shape
is `RepoIntel` (`src/modules/repo-intel/types.ts`).

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

### 2026-08-17 — "Docker was unavailable" from an earlier turn is not a property of the environment — a `dockerAvailable()`-gated `*.it.test.ts` file re-checks on every invocation

**Tried:** trusting a prior session's report that `server/test/brief.it.test.ts`
could not run because `docker info` had failed, and carrying that as fixed
context into a later verification pass in the same task.

**Failed:** it was stale. A later `plan-verifier` run in the same session
found the Docker daemon reachable and ran the exact same file for real —
11/11 passed, 0 skipped — where the earlier pass had recorded 11 skipped.
Nothing in the repo changed between the two checks; only the daemon's
up/down state did. `dockerAvailable()` (`server/test/helpers/pg.ts`) is
evaluated fresh at the top of the file on every `vitest run`, so "Docker is
down" is a fact about *this invocation*, never a fact about the machine or
the session.

**Instead:** re-run `docker info` (or just re-run the `.it.test.ts` file)
before reporting a DB-backed suite as unverified, rather than relaying an
earlier turn's skip count. A `0 run / N skipped` result from one invocation
is not evidence the next invocation will skip too.

**Where:** `server/test/brief.it.test.ts:21-27` (`dockerAvailable()` gate);
`server/test/helpers/pg.ts`.

### 2026-08-17 — A plan's `Done when` naming a specific test file as proof does not mean that file actually asserts the thing

**Tried:** trusting `plans/2026-08-16-pr-why-risk-brief.md` Step 8's `Done
when` — "`routes-smoke.test.ts` passes with both new routes registered" — as
evidence the new `/pulls/:id/brief` routes were exercised by that file.

**Failed:** `routes-smoke.test.ts` has no assertion touching `/pulls/:id/brief`
at all. Route registration was actually proven by `brief.it.test.ts`'s
`app.inject()` calls against the live routes, a different file than the one
the plan's own verification step names.

**Instead:** when a `Done when` line names a specific file, `rg` that file for
the claimed behaviour before accepting the check as satisfied — a plan step
can pass its literal command (the file exists and is green) while the
specific claim attached to it is false.

**Where:** `plans/2026-08-16-pr-why-risk-brief.md` Step 8; `server/test/routes-smoke.test.ts`;
the actual proof is `server/test/brief.it.test.ts`.

### 2026-08-08 — Adding a pre-work step to the review executor made `reviews.it.test.ts` spend REAL money, because `.env` holds live keys and that file mocks only ONE provider

**Tried:** wiring L03's intent derivation into `ReviewRunExecutor.executeRuns` as
shared pre-work (one `container.intent.ensure` per queued batch, exactly like the
callers digest), then running the existing integration suite unchanged.

**Failed:** `reviews.it.test.ts` went from ~25s to **562s** with cascading
timeouts, and it was making real, billable calls the whole time. Two live
credentials, both from `server/.env`, which the test config loads:

1. **OpenRouter.** `appWith` overrides `llm: { [provider]: … }` — one key, either
   `openai` or `anthropic`. The `review_intent` feature default is now
   `openrouter`, so `container.llm('openrouter')` fell through to the real
   `OpenRouterProvider` built from `OPENROUTER_API_KEY` and classified intent
   against the live API, once per review run.
2. **GitHub.** The seeded PR body reads "Add rate limiting. Closes #471", so the
   intent pipeline resolved a linked issue and called `api.github.com` for issue
   #471 on a repo that does not exist, through the real Octokit client built from
   `GITHUB_TOKEN`.

Neither announces itself. There is no "you are online" warning; the only symptom
is a slow suite and `trace.prompt_assembly` coming back undefined as unrelated
assertions time out — which reads exactly like the flake documented below.

**Instead:** when a shared pre-work step is added to the executor, every
integration test that triggers a review has to mock the ports that step newly
reaches. Here the honest fix is to stub the facade itself, so the pre-work does
no I/O at all and those tests keep testing what they are about:

```ts
const nullIntent = () => ({ async get() { return null; }, async ensure() { return null; } });
// …overrides: { …, intent: nullIntent() }
```

The generalisable rule: **`ContainerOverrides` is only a seam for the ports a
test knows to override.** A new `container.<port>` consumer in a shared code path
silently un-mocks every existing test that did not name it, and a partial
override map (`llm` keyed by ONE provider id) is the most dangerous shape,
because it looks complete. Before adding a container call to `run-executor.ts`,
grep the integration tests for `overrides:` and check each one covers the new
edge. Note the two keys are in `server/.env` rather than
`~/.devdigest/secrets.json`, so "no secrets file" is not evidence of a hermetic
environment.

**Where:** the pre-work step is `src/modules/reviews/run-executor.ts` (the
`Deriving PR intent` `runLog.step`); the stub and the reasoning comment are in
`test/reviews.it.test.ts` (`nullIntent`, used by `appWith`); the feature default
that routes to OpenRouter is
`src/vendor/shared/contracts/platform.ts:53-61`; the issue lookup is
`src/modules/intent/pipeline.ts` (`collectSources`, the `linked_issue` block).

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

### 2026-08-21 — `eval-comparison`'s `attributability.attributable` guards against a different case set or model, NOT against LLM sampling noise between two runs of the identical config

**Rule:** `compare()`'s attributability flag (`helpers.ts` ~line 222,
`attributable: !caseSetChanged && !modelChanged`) reads as "this delta is caused
by the prompt change" but it only rules out two specific confounds — the two
runs covering a different `covered_case_ids` set, or a different model. It says
nothing about whether the *same* config, run twice, would reproduce the same
numbers. It does not, necessarily: re-running the Security Reviewer agent
(8-case set) twice at the same `config_version`, same `system_prompt`, same
model, with zero changes in between, produced recall 0.43 → 0.57 and precision
0.75 → 1.0 — a swing of the same order of magnitude as the deltas this feature
is meant to detect. The one real LLM call per case (`reviewPullRequest` inside
`executeSet`) is not deterministic across runs; `scoreRun`/`matchExpectation`
downstream of it are pure arithmetic and reproduce exactly given the same
`actual_output`, so the variance is entirely in the model's sampling, not in
scoring.

**Why:** discovered manually walking the L06 eval pipeline end-to-end (case
creation → run v4 → edit prompt to v5 → run v5 → compare → run v5 again with no
prompt change). A single before/after run pair on a small case set (this one:
8 cases) can show an `attributable: true` delta that is mostly or entirely
run-to-run noise, not signal from the prompt edit. Anyone using this feature —
or building UI copy/messaging around it — should not present `attributable:
true` as "this delta is real"; it only means "this delta isn't explained by a
different case set or model." Judging a prompt change with confidence needs
either a larger case set or more than one run per config, neither of which this
feature currently surfaces or suggests.

**Where:** `server/src/modules/eval/helpers.ts:222` (`attributable` computation);
`server/src/modules/eval/service.ts:554` (`reviewPullRequest` call inside
`executeSet`, the one non-deterministic step per case); `client/src/app/agents/
[id]/_components/AgentEditor/_components/EvalsTab/EvalsTab.tsx:401-407` (renders
`notAttributable` only when the flag is false — never warns about sampling
variance when it's true).

### 2026-08-19 — NFR-6's "zero executed cases shall not be recorded" only fires on a pre-first-case cancellation — a case that fails to PARSE still counts as executed and the run IS recorded

**Rule:** `executeSet`'s NFR-6 branch (`if (casesDone === 0) { deleteSetRun(...); return }`)
reads, from the spec prose alone, as "a run where every case fails to start
leaves no `eval_set_runs` row." That is not what the code does. `casesDone` is
incremented for **every** case that reaches `recordCaseResult`, including one
whose diff fails to parse and is recorded as a failed case (see the AC-25
handling in the same function) — a parse failure is still an executed case
with a result, just a losing one. The delete-and-don't-record branch only
fires when the run is **cancelled before the first case ever starts**, i.e.
`casesDone` never leaves zero. A case set where every case fails to parse
still produces a real, queryable `eval_set_runs` row with `status: 'incomplete'`
and `cases_passed: 0` — it does not vanish.

**Why:** discovered closing the plan-verifier gap for NFR-6 test coverage
(`plans/2026-08-18-l06-eval-pipeline.md`, `server/test/eval.it.test.ts`). The
literal spec reading ("every case fails to even start") does not correspond to
any reachable code path, so the test that actually exercises the delete branch
uses a **different** trigger: a case set that is empty at read time (zero
cases at all), which is refused before `openSetRun` is ever called, not the
"every case fails mid-flight" scenario the prose implies. Anyone extending
`executeSet` to add a new failure mode should check which of these two the new
failure resembles — "never reached `recordCaseResult`" (deletes the run) vs.
"reached it and lost" (keeps the run, marks it incomplete) — because the
NFR-6 prose alone does not disambiguate.

**Where:** `server/src/modules/eval/service.ts:489` (`executeSet`'s
`casesDone === 0` branch); the NFR-6 test is in `server/test/eval.it.test.ts`
(the zero-case-set scenario, not a mid-run failure scenario).

### 2026-08-19 — A run-level precision score has a real exception to "no denominator → `null`": a run with only `must_not_flag` cases that correctly produces nothing scores `1`, not `null`

**Rule:** in `scoreRun`, `recall` and `citation_accuracy` are `null` whenever
their denominator is zero, but `precision` is **not** unconditionally the
same. Precision is `null` only when the case set contains at least one
`must_find` expectation **and** the run produced no grounded findings at all —
in every other zero-findings case (a run made entirely of `must_not_flag`
cases that correctly stayed silent), precision is `1`, because "produced
nothing forbidden" is itself a fully-determined precision of 1, not an
undefined ratio.

```ts
// scoreRun — the branch that is easy to over-generalise from AC-23's headline
if (producedCount === 0) {
  return hasMustFindCase ? null : 1; // NOT: return null unconditionally
}
```

**Why:** `plans/2026-08-18-l06-eval-pipeline.md` Step 4's own prose ("precision
is `null` when nothing was produced") and its Step 10 test description (which
implies the must-not-flag-only, nothing-produced case reports a precision
value, not `null`) directly contradict each other — the plan was written
against the spec's AC-23 headline case, not its full Edge-cases table. The
`null`-for-every-empty-denominator rule (root `INSIGHTS.md` 2026-08-02,
"Unknown cost is `null`, never `0`") is right for recall and citation accuracy
but does not generalise to precision, because precision's denominator being
zero is not "unknown" here — it is the observed, meaningful outcome of a
must-not-flag-only case set behaving correctly. Resolving which reading was
right required cross-referencing the spec's own `## Edge cases` table, not
just the plan.

**Where:** `server/src/modules/eval/helpers.ts:70-90` (`scoreRun`); the
AC-23 exception is asserted in `server/test/eval-helpers.test.ts`.

### 2026-08-17 — `BriefService`'s single-flight `Map` is module-scoped, so it is shared across every instance in the process — a test that doesn't await `generate()` can leak a promise into the next case

**Rule:** `brief/service.ts`'s `inFlight` de-duplication map is declared at
module scope (`const inFlight = new Map<string, Promise<BriefGenerationResult>>()`),
not as an instance field, because `BriefService` is constructed fresh per
request (`new BriefService(app.container)` in `routes.ts`) and an instance
field would never survive across the concurrent requests it exists to
collapse. The consequence: every `BriefService` built anywhere in the same
process — including a different `buildApp()` in a different `it()` block of
the same test file — shares one map keyed by `prId`. Sequential `await`s
across test cases are safe today because each `generate()` call is awaited to
completion (and removes its own entry in `finally`) before the next test
starts. The trap is a *future* test that fires `generate()` without awaiting
it and moves on to assert something else: that leaves a live promise sitting
in the shared map under the same `prId`, and the next test case for that PR id
joins the stale in-flight call instead of starting its own.

**Why:** discovered writing `server/test/brief.it.test.ts`'s AC-4/NFR-7
concurrency assertion (two concurrent `POST` requests → one model call) for
`plans/2026-08-16-pr-why-risk-brief.md` Step 9 — reasoning through the map's
scope was required to know whether two `it()` blocks reusing the same seeded
`prId` could interfere with each other.

**Where:** `server/src/modules/brief/service.ts:24` (`inFlight` declaration);
`server/test/brief.it.test.ts` (the AC-4/NFR-7 case that depends on this
scoping being understood correctly).

### 2026-08-17 — `BRIEF_DROP_ORDER`'s array reads top-to-bottom but drops bottom-to-top: the loop walks it from the LAST entry, not the first

**Rule:** `constants.ts`'s `BRIEF_DROP_ORDER` array is
`['linked_spec', 'linked_issue', 'findings', 'blast_radius', 'derived_intent']`
and its docstring says blocks are "popped from the TAIL" — but "the tail"
means the tail of the iteration, not a literal `.pop()` off this array. Read
`pipeline.ts#fitBudget`'s loop before assuming the array's reading order is
the drop order: it iterates `for (let i = BRIEF_DROP_ORDER.length - 1; i >= 0; i--)`,
so the actual sequence when several blocks must go over budget is
`derived_intent → blast_radius → findings → linked_issue → linked_spec` — the
exact REVERSE of how the array reads top-to-bottom. The code is correct once
the loop is traced; a reader who only skims the array will guess backwards.

**Why:** surfaced writing `server/test/brief-helpers.test.ts`'s AC-13 case
(whole blocks dropped from the tail, never mid-content) for
`plans/2026-08-16-pr-why-risk-brief.md` Step 9 — the first draft asserted the
array's literal order and failed against the real drop sequence.

**Where:** `server/src/modules/brief/constants.ts` (`BRIEF_DROP_ORDER`
declaration and docstring); `server/src/modules/brief/pipeline.ts`
(`fitBudget`'s reverse-indexed loop); `server/test/brief-helpers.test.ts` (the
AC-13 assertion this saves the next reader from re-deriving).

### 2026-08-17 — A slice's `constants.ts` export is a sanctioned cross-slice import; a slice's pure helper function is not — promote it to `modules/_shared/<name>.ts`

**Rule:** when a second slice needs a *value* another slice already exports
from its `constants.ts` (a regex, an enum, a cap), import it directly —
`constants.ts` is not in `SLICE_PRIVATE`, so the gate stays green and the rule
stays single-sourced. But when what's needed is a *pure function* —
`normalizePath`, `hunkHeaders`, a link-parser — do not reach into the owning
slice's `helpers.ts`; `SLICE_PRIVATE` blocks it and `pnpm arch` fails. Either
duplicate the function locally with a docblock naming the original and the
reason, or, once a third consumer wants the same function, promote it to
`modules/_shared/<name>.ts` — any filename other than `helpers.ts`,
`service.ts`, `repository.ts`, `routes.ts` or `run-executor.ts` falls outside
`SLICE_PRIVATE` and is importable by every slice.

**Why:** building the PR Risk Brief slice (`modules/brief/**`) needed
`smart-diff`'s exact-match path normalization (AC-17) and `intent`'s
hunk-range/link-parsing helpers. `smart-diff/helpers.ts#normalizePath` and
`intent/helpers.ts#hunkHeaders` are both `SLICE_PRIVATE` and fail
`no-cross-slice-import` if imported from another slice. But
`smart-diff/constants.ts#PATH_PREFIX_PATTERN` is not — importing the pattern
and re-deriving the one-line `.replace()` locally is gate-clean, and it keeps
the normalization *rule* (including its documented `a/`/`b/` sharp edge, see
2026-08-09 above) single-sourced even though the call site is duplicated.
There is no equivalent constant for the hunk/link helpers, so those are plain
duplicated functions for now, with `modules/_shared/pr-text.ts` recorded as the
promotion target if a third slice ever needs them. `_shared` is already the
cross-slice home in this repo — `intent/routes.ts:4-5` imports
`_shared/context.js` and `_shared/schemas.js` today, so this is an existing
pattern, not a new one.

**Where:** `server/src/modules/smart-diff/constants.ts:94`
(`PATH_PREFIX_PATTERN`, importable); `server/src/modules/smart-diff/helpers.ts:45`
(`normalizePath`, not importable); `server/src/modules/intent/helpers.ts`
(`hunkHeaders` etc., not importable); `server/src/modules/intent/routes.ts:4-5`
(the `_shared/` precedent); `server/.dependency-cruiser.cjs:65`
(`SLICE_PRIVATE`); the decision is recorded in
`plans/2026-08-16-pr-why-risk-brief.md` Step 4 and Risk R1.

### 2026-08-16 — The composite PK that excuses a link table from an FK index leaves its SECOND column unindexed — and that is the column the reverse lookup filters on

**Rule:** a link table keyed `primaryKey({ columns: [ownerId, path] })` needs no
separate index for `WHERE owner_id = ?` — the PK's B-tree serves it as a
leftmost-prefix equality, which is why `postgresql-table-design` §Indexing lets
you decline the usual "FK columns are not auto-indexed, add them" rule. That
reasoning is correct and it is **half** the story. A link table almost always has
a second access path — the reverse lookup, `WHERE path IN (…)` — and the same
index cannot serve it, because `path` is the trailing column.

**Why:** "composite PK ⇒ no index owed" is true for exactly one of the two
directions, and the direction it covers is the one you thought of while writing
the schema. `agent_context_docs` and `skill_context_docs` were both reviewed
against the rule, both correctly declined the FK index, and both left
`agentReachCounts`'s `WHERE path IN (…)` on a sequential scan. Both tables are
empty today, so nothing is measurably slow and nothing will warn you; the
per-request query fans out over the whole document listing, so it degrades with
attachment count rather than with traffic.

**Where:** `server/src/modules/context/repository.ts:181` (`agentReachCounts`)
and `:156` (`attachedPaths`); the tables at
`server/src/db/schema/project-context.ts`. The fix, when a profile calls for it,
is an index on `skill_context_docs(path)` / `agent_context_docs(path)` in its own
additive migration — `plans/2026-08-16-project-context.md` §Risks pre-authorises
exactly that and set the default to "measure first".

### 2026-08-16 — `readFile` is the wrong primitive for attacker-supplied content you only need a bounded prefix of

**Rule:** when the bytes come from a third-party source of unbounded size — a
cloned repository's Markdown, an upload, anything mirrored from outside — and the
consumer caps the text anyway, do not `readFile` then truncate. Open the file and
issue one bounded `read` into a buffer sized to the cap
(`MAX_DOCUMENT_CHARS * 4 + 1` for UTF-8), and derive `truncated` from
`bytesRead >= limit`.

**Why:** `readFile` followed by `truncateForInjection` allocates the entire file
before discarding almost all of it, so a 500 MB `.md` committed to a mirrored
repository is 500 MB of heap in the review path — a resource exhaustion reachable
by anyone who can open a pull request against a watched repo. The bounded read
also gives the `truncated` flag for free instead of computing it after the fact.
The cost is one edge case worth knowing: a multi-byte character cut at the buffer
boundary decodes to a single U+FFFD, at the very end of text that is already
being presented as truncated.

**Where:** `server/src/modules/context/service.ts:336-350` (`readBounded`), whose
cap is `MAX_DOCUMENT_CHARS` at `server/src/modules/context/constants.ts:32`.

### 2026-08-16 — A depth-agnostic `**/{dir}/**` discovery glob makes `EXCLUDED_DIRS` load-bearing — and `walk.ts` will not apply it for you

**Rule:** the moment file discovery moves from a fixed prefix (`.devdigest/specs/`)
to a glob that matches at any depth (`**/{specs,docs,insights}/**/*.md`), the
exclusion list stops being tidiness and becomes correctness. Carry
`EXCLUDED_DIRS` explicitly into any new walker, and state it as an acceptance
criterion, not as an implementation nicety.

**Why:** `**/docs/**` matches `node_modules/<pkg>/docs/*.md`, `.next/**`,
`dist/**` and `out/**` — all of which are full of Markdown. Dropping the
exclusion list does not produce a slow scan; it produces **the model reading a
dependency's documentation as if it were this project's specification**, which is
both a grounding failure and a prompt-injection surface (a transitive dependency's
README is third-party text).

The trap is that the obvious reuse does not work. `walk.ts` already implements
exactly this filtering, but its `SUPPORTED_EXT` is `.ts .tsx .js .jsx .mjs .cjs`
— Markdown is not in it, and Markdown is never chunked or embedded anywhere in
repo-intel. So a Markdown discovery pass cannot call `walk.ts`; it re-implements
the walk, and re-implementing it is precisely where the exclusion list gets left
behind. And `.gitignore` is **not** honoured, so `EXCLUDED_DIRS` is the whole
defence — a repo that gitignores a generated `docs/` directory is protected by
nothing. Do not take that from the constant's own comment, which is wrong:
`constants.ts:15` says *"`.gitignore` is layered on top in T2 walk"*, while the
T2 walk itself lists `.gitignore` filtering under **`NOT YET HANDLED`** with a
`TODO(T3)`. The walker is the truth; the constant's docblock describes a plan.

**Where:** `server/src/modules/repo-intel/pipeline/walk.ts:1-35` (the docblock
naming the exclusion list and the missing `.gitignore` handling),
`server/src/modules/repo-intel/constants.ts:16-25` (`EXCLUDED_DIRS`) and `:14`
(`SUPPORTED_EXT`, JS/TS only). The criterion this produced is AC-3 of
`specs/2026-08-16-project-context.md`.

### 2026-08-10 — A prompt that summarises user-authored text must state its OUTPUT LANGUAGE, because the model mirrors its input and nothing downstream translates

**Rule:** any prompt whose input is text a human wrote (a PR body, a commit
message, a linked issue, a spec file) has to name the output language explicitly.
Do not rely on the prompt itself being written in English — that sets the
*instruction* language, not the *answer* language, and the model follows its
input.

**Why:** `INTENT_SYSTEM` asked for three fields in fluent English and never said
which language to answer in. Every one of its five sources is author-controlled
(`pr_title_body`, `linked_issue`, `linked_spec`, `hunk_headers`,
`commit_messages`), so a PR described in Ukrainian yields a Ukrainian `intent` —
and then two things consume it without translating:

- `renderIntentBlock` puts it in the `## PR intent (derived)` section of the
  review prompt, where it becomes context for an English-instructed reviewer;
- `IntentCard` renders it verbatim on the Overview tab.

The repo rule "All Markdown is written in English … whatever language the request
came in" (root `AGENTS.md` §Repo rules) is about files people write, so nothing
extended it to model output. The instruction is the only place this is fixable:
the schema's `.describe()` fields are per-field and would have to repeat it, and
there is no post-processing step to hook.

Worth knowing what the fix is *not*: it is not `temperature`, and it is not the
task line. `INTENT_TASK` interpolates the PR title verbatim, so on a
Ukrainian-titled PR the task string itself is mixed-language and pulls the answer
further toward the input.

Same shape as the L02 lesson that a rule added to a prompt must state its own
severity (root `INSIGHTS.md` 2026-08-02): what the prompt does not say, the model
decides — and it decides from the data.

**Where:** the instruction is `server/src/modules/intent/constants.ts`
(`INTENT_SYSTEM`, the `Answer in ENGLISH` line, with the reason in the docblock
above it); it is asserted on the assembled messages rather than on the constant in
`server/test/intent.it.test.ts` ("instructs the model to answer in English"),
because the guarantee is that it survives `assemblePrompt` into `messages`. The
two consumers that do not translate are `renderIntentBlock`
(`server/src/modules/intent/helpers.ts`) and
`client/src/app/repos/[repoId]/pulls/[number]/_components/IntentCard/`.

### 2026-08-11 — `repo_index_state.status='partial'` does NOT mean "a working index": it can mean the whole T3 block was skipped, and then "no callers" is indistinguishable from "no data"

**Rule:** never branch on `repo_index_state.status` alone before reading anything
that joins `file_rank`. `partial` covers two states that look identical to a
consumer and are not:

1. a working index that ran out of budget partway — callers resolve fine;
2. an index where the entire tier-3 block was skipped, so `file_edges`,
   `file_rank` and `file_facts` were **never written**.

In case 2, `getResolvedCallers` INNER JOINs `references` to `file_rank`
(`src/modules/repo-intel/repository.ts:503-531`) and returns **zero rows** — byte
-identical to "this symbol genuinely has no callers". Any feature that renders
that as an empty list is asserting an absence it never established.

The cheap capability probe, needing no new SQL and no repository edit:

```ts
// only when status === 'partial'; 'full' already implies the rank step succeeded
const rankGraphPresent =
  (await container.repoIntel.getTopFilesByRank(repoId, 1)).length > 0;
```

**Why:** `tryGetIndexState` deliberately does **not** flag `partial` as degraded —
its own comment says "'partial' is still a working index — no degraded flag"
(`repository.ts:215-218`), which is correct for its purpose and misleading as a
capability signal. And the obvious alternative signal is a trap: **`stats.ranked`
is written only by the FULL pipeline** (`pipeline/full.ts:260`) and never by the
incremental one (`pipeline/incremental.ts:245-256` writes `edgesWritten` but no
`ranked`), so a healthy incremental refresh that rewrote every rank row would
report "no rank graph". `tryGetIndexState` does not project `stats.ranked` at all,
so it is not even reachable through the facade — reading it would mean widening
the projection for a signal that is wrong.

Note also the asymmetry that makes `full` cheap: the pipeline records `full` only
when the graph/rank step succeeded (`pipeline/full.ts:252-254`;
`pipeline/incremental.ts:243` additionally requires the prior state to be `full`),
so the probe is owed on `partial` and on nothing else — the happy path pays
nothing.

**Where:** the probe and the truth table are
`src/modules/blast/helpers.ts` (`decideBlastState`, row 5 → `no_rank_graph`),
called from `src/modules/blast/service.ts`; the empirical proof is
`server/test/blast.it.test.ts` case 3, which deletes every `file_rank` row for the
repo under `status='partial'` and asserts `state:'degraded'`,
`reason:'no_rank_graph'` and a non-empty `summary` rather than `downstream: []`
alone. Reasoning of record: `specs/l06-blast-radius.md` §Contracts 3 and Risk 2.

### 2026-08-11 — A read-time cap named `MAX_..._PER_SYMBOL` was applied to the FLATTENED list, so every symbol after the first got zero

**Rule:** when a cap's name says "per X", check where the `.slice()` actually
sits. `tryPersistentBlast` ended with
`callers.slice(0, MAX_CALLERS_PER_SYMBOL)` over the **flattened, rank-sorted**
caller list, so with 20 callers on the hottest symbol every later changed symbol
came back with an empty array. A consumer cannot tell that from "this symbol has
no callers", which is the exact masking such a feature must not do.

Two things the fix needs beyond moving the slice:

- **Make the sort total first.** `callers.sort((a, b) => b.rank - a.rank)` is not
  a deterministic order here: every `rank` is `0` whenever the hotness-free
  PageRank collapses (`hotness` is always 0 under Option B, and `rank = pagerank`),
  and symmetric files tie exactly. Without `|| file ASC || line ASC` the retained
  20 differ between two calls on identical data.
- **Restate the new bound in the docblock.** The method can now return
  `MAX_CALLERS_PER_SYMBOL × changedSymbols.length` rows, not 20; the consuming
  slice is what bounds the total (`blast/constants.ts`'s
  `MAX_CHANGED_SYMBOLS = 50` → ≤ 1000).

Fixing it in the facade rather than in the consumer was safe because
`getBlastRadius` had **no production caller at all** at the time
(`rg -n getBlastRadius src test` → the interface, the impl, a docblock and one
shape test) and no test pinned the combined semantics. Check that before changing
a facade's semantics; if a caller exists, the per-symbol grouping still belongs in
the facade, not duplicated in each consumer.

**Where:** `src/modules/repo-intel/service.ts` (`tryPersistentBlast`, the
`keptPerSymbol` map and the three-key sort) with the new bound stated in its
docblock; the constant is `src/modules/repo-intel/constants.ts:30`; the hermetic
proof is `server/test/repo-intel-blast-clamp.test.ts` (25 callers × 2 symbols → 20
each, top-of-group retained, stable across two calls with every rank tied), and
the end-to-end one is `server/test/blast.it.test.ts` case 7.

### 2026-08-09 — `normalizePath` strips `a/` and `b/` as diff prefixes, so a real top-level directory with either name is treated as repo-root

**Rule:** anything that compares a `findings.file` path against a `pr_files.path`
has to strip the unified-diff prefixes first — a model-authored finding may carry
`a/src/x.ts` or `b/src/x.ts` where the imported file row says `src/x.ts`, and an
exact-match join silently finds nothing. `PATH_PREFIX_PATTERN`
(`/^(\.\/|a\/|b\/)+/`) is that strip, and it is why Smart Diff's badges line up
with its findings at all.

**Why:** the cost is a real ambiguity, and it is worth knowing before you debug
it from the other end. A repository that genuinely has a top-level directory
named `a/` or `b/` gets it stripped too, so `a/util.ts` classifies and splits as
if it were `util.ts` at the repo root. The regex cannot distinguish the two — a
diff prefix and a directory name are the same three characters — and no amount of
care at the call site recovers the information, because `pr_files.path` has
already lost it.

This is inherent to prefix stripping rather than a defect to fix, so it is pinned
by a test that **states** the consequence instead of a fixture that dodges it.
The tell that you have hit it: a `split_suggestion` proposal named `.` where you
expected `a`, or a file classified `core` that should have matched a per-directory
rule. It bit once already, in a test fixture that used `a/` and `b/` as ordinary
directory names and got two buckets collapsed into the root one.

**Where:** the pattern is `src/modules/smart-diff/constants.ts:94`, applied at
`src/modules/smart-diff/helpers.ts:45-46` and consumed by `classifyFile` (`:54`),
`findingLinesFor` (`:68,71`) and the split grouping (`:155`); the test that
states the trade-off rather than hiding it is
`test/smart-diff-helpers.test.ts` (the `suggestSplit` prefix case).

### 2026-08-08 — `no-cross-slice-import` scopes its `from` to `^src/modules/` — which is WHY the container may import a slice's service and a sibling slice may not

**Rule:** when slice A needs something slice B owns, put a facade port in
`modules/B/types.ts`, construct B's service in `platform/container.ts`, and let A
reach it as `container.<b>`. Do not import `modules/B/service.js` from anywhere
under `src/modules/`. This is not a style preference — it is the only shape the
gate permits, and the reason is in the rule's *selector*, not in its target.

**Why:** `no-cross-slice-import` is
`from: { path: '^src/modules/([^/]+)/' }` → `to: { path: SLICE_PRIVATE, pathNot: '^src/modules/$1/' }`,
with `SLICE_PRIVATE` = `^src/modules/[^/]+/(service|repository|routes|helpers|run-executor)`.
Both halves matter and only one of them is ever quoted:

- `modules/reviews/run-executor.ts` → `modules/intent/service.ts` **fires** — the
  importer is under `^src/modules/`, the target is `SLICE_PRIVATE`. This is the
  failure the 2026-08-05 conventions entry records.
- `platform/container.ts` → `modules/intent/service.ts` **does not fire** —
  `container.ts` is not under `^src/modules/`, so the `from` selector never
  matches it at all. The container is exempt by construction, not by an allowlist
  anyone maintains.
- `run-executor.ts` → `import type { IntentFacade } from '../intent/types.js'` is
  legal twice over: `types.ts` is not in `SLICE_PRIVATE`, **and**
  `tsPreCompilationDeps: false` means a type-only import produces no graph edge.

`backend-onion-architecture` §4 states the container-facade rule in prose, which
reads as convention. The mechanism that makes it enforceable is visible only in
the config, and knowing it changes what you do when the gate fires: the fix is to
move the edge to the container, never to widen `SLICE_PRIVATE`. `container.repoIntel`
is the worked example and exists in exactly this shape for exactly this reason.

Two traps the same selectors create, neither caught by anything:

- `SLICE_PRIVATE` does not list `pipeline.ts` or `constants.ts`, so another slice
  can import them and the gate stays green. Treat everything in a slice except
  `types.ts` as private by contract.
- `no-sql-in-service` matches only `(service|helpers).ts`, so a file named
  `pipeline.ts` may hold Drizzle with no complaint — the honesty problem the
  2026-08-05 entry already names about `conventions/extract-pipeline.ts`.

**Where:** rule at `server/.dependency-cruiser.cjs:128-139`, `SLICE_PRIVATE` at
`:65`, `no-sql-in-service` at `:88-101`, `tsPreCompilationDeps` in `options`
(`:216`); the exempt importer is `src/platform/container.ts:25-29` (four module
internals already imported) and the facade precedent is `:120` (`get repoIntel()`).

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

### 2026-08-09 — `findings` and `reviews` ARE indexed now — check the schema before you owe a migration

**Rule:** before adding an index for a new read of `findings` or `reviews`,
read `server/src/db/schema/reviews.ts`. Four indexes exist today:
`findings_review_id_idx`, `findings_skill_id_idx`, `reviews_pr_kind_idx`
(`pr_id, kind`) and `reviews_run_id_idx`. A feature that reads findings by
`review_id`, or reviews by `pr_id` — which is what `reviewsForPull` does, and
therefore what every read-side view of a PR's findings does — owes **no new
index and no migration**.

**Why:** the 2026-08-02 entry above states "the `findings` table has no indexes
at all", and it is the entry a session lands on when it greps for `findings`
and indexes. Its rule is still right; its factual premise is two migrations
stale. Acting on the premise means generating a migration for an index that
already exists, and `pnpm db:generate` goes interactive when one migration both
drops and adds — so the wasted work is not free.

Insights here are append-only, so the old entry keeps its text and carries a
`**Superseded by:**` pointer instead. The general shape worth carrying: an
insight that asserts *the current state of the schema* has a shelf life, unlike
one that asserts a rule. When you read one, check the schema.

Smart Diff (L04) is the worked example — a whole read-side feature over
`pr_files` + `findings` with no migration at all
(`specs/l04-smart-diff.md` §Inventory).

**Where:** the four indexes are `server/src/db/schema/reviews.ts` (`findings`
table definition and `reviews` table definition); the reader they serve is
`src/modules/reviews/repository/review.repo.ts` (`reviewsForPull`); the new
consumer that needed nothing added is
`src/modules/smart-diff/service.ts`.

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

**Superseded by:** 2026-08-09 — the premise no longer holds. See the entry of
that date below; the *rule* (a new query that filters `findings` ships its own
index) still stands, but "the table has no indexes at all" is now false.

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

### 2026-08-18 — Grepping for a `db/schema` import to find gate-blind SQL over-reports: `tsPreCompilationDeps: false` means a type-only import is not an edge

**Quirk:** the `modules/` rules in `.dependency-cruiser.cjs` select files by
name, so any slice file not called `routes`/`service`/`repository`/`helpers` is
outside them (SKILL §13). Sweeping for the files that exploit that — anything
off-manifest importing Drizzle or `db/schema` — returns three hits out of the
sixteen off-manifest files:

```
src/modules/reviews/diff-loader.ts       import * as schema from '../../db/schema.js'
src/modules/reviews/run-executor.ts      import * as schema from '../../db/schema.js'
src/modules/settings/feature-models.ts   import { eq } from 'drizzle-orm'
```

Only `feature-models.ts` is real. `diff-loader.ts` uses `schema` exactly once, as
`typeof schema.repos.$inferSelect` in a parameter type (`diff-loader.ts:17`);
`run-executor.ts` is the same shape. TypeScript elides an import whose binding is
never used in a value position, and the gate runs with
`tsPreCompilationDeps: false` (`.dependency-cruiser.cjs`), so those files emit no
runtime edge at all. They are the `db/rows.ts` smell from SKILL §2, not unpoliced
SQL — filing them as gate-blind SQL sites would have put two false rows into
SKILL §12, where the list is only allowed to shrink.

**Workaround:** a grep for the import is a candidate list, not a finding. Confirm
each hit by checking whether the binding is used in a *value* position — for
`import * as x`, grep `x\.` and see whether every use sits behind `typeof`. The
same elision is why a dependency-cruiser rule probe has to *use* what it imports
to fire at all (SKILL §10, trap 1); this is that trap seen from the other side,
where it produces false positives in a manual audit instead of a silently passing
rule.

**Where:** `server/.dependency-cruiser.cjs` (`tsPreCompilationDeps: false`),
`server/src/modules/reviews/diff-loader.ts:4,17`,
`server/src/modules/settings/feature-models.ts:1,8`.

### 2026-08-08 — `deepseek/deepseek-v4-flash` and `…-flash-latest` are DIFFERENT models at different prices, and the pricier one is the one already hardcoded here

**Quirk:** the two slugs look like the same model with an optional freshness
suffix. They are not. Verified against OpenRouter's live `/api/v1/models`:

| Slug | Resolves to | Price / 1M |
|---|---|---|
| `~deepseek/deepseek-v4-flash-latest` | `deepseek/deepseek-v4-flash-0731` (moving alias) | $0.09 / $0.18 |
| `deepseek/deepseek-v4-flash` | `deepseek/deepseek-v4-flash-20260423` | **$0.14 / $0.28** |

Both numbers are real — this is two dated snapshots, not a stale price book. The
alias carries `alias_target: deepseek/deepseek-v4-flash-0731` and is described as
"always redirects to the latest model in the DeepSeek V4 Flash family", so its
target moves whenever DeepSeek ships a new V4 Flash.

The bare, pricier slug is the one this repo already commits to in two places:
the cost table, and the OpenRouter default every conventions extraction uses when
the workspace has picked nothing. So "switch to the cheap DeepSeek flash model"
is not a no-op — done by editing a feature default it produces a run whose cost
is attributed from the *other* snapshot's prices, silently and with no error.

**Workaround:** pin the **dated** slug (`deepseek/deepseek-v4-flash-0731`) rather
than the alias whenever the model backs something that will be measured, and add
its own row to `pricing.ts` instead of assuming the existing `deepseek/…-flash`
row covers it. The reason to avoid the alias is not cost — it is that
`eval_cases` / `eval_runs` compare runs across time, and a slug that silently
changes model makes a quality or cost regression unattributable. `pricing.ts`
already asks for this in its own comment ("Slugs + prices are APPROXIMATE and
must be confirmed against openrouter.ai/models before relying on cost"); the
comment is easy to read as boilerplate rather than as an instruction.

Unknown slugs fall through to `null` cost, which is safe and explicitly flagged —
so a *wrong* slug is loud, but a *different-but-known* slug is silent. That
asymmetry is the whole trap.

**Where:** the price table is `src/adapters/llm/pricing.ts:31`, with the
confirm-before-relying comment at `:27-29`; the OpenRouter default that uses the
bare slug is `src/modules/conventions/constants.ts:121` (`DEFAULT_MODEL`); the
feature-model registry that will point at the pinned slug is
`src/vendor/shared/contracts/platform.ts:53-58` (mirrored in
`client/src/vendor/shared` and again in `client/src/lib/feature-models.ts`).
Decision recorded in `specs/l03-intent-layer.md` §"External findings of record".

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

### 2026-08-11 — Blast Radius `DownstreamImpact.symbol` was not a unique key across `blast.downstream` — two changed symbols can share a bare name from different files

**Symptom:** the console showed `Encountered two children with the same key,
'renderWithIntl'` from `BlastRadiusCard.tsx`. Not a hypothetical fixture: two
test files in the PR's diff each declared a local `renderWithIntl` helper, so
the indexer emitted two `changed_symbols` rows with the same `name` but
different `file`.

**Cause:** `foldBlastResult` (`src/modules/blast/helpers.ts`) grouped callers
and the "own declaring file" exclusion by `sym.name` alone —
`declFileBySymbol: Map<string, string>` kept only the FIRST file seen per name.
For the second same-named symbol, a caller sitting in *its* declaring file was
not recognized as a self-reference and leaked into the output as a fake
downstream caller. On the client, `entry.symbol` was the React key (duplicate
→ the warning) and `declFile` was resolved by
`changed_symbols.find(sym => sym.name === entry.symbol)`, which always
returned the first match — mislabeling the second entry's declaring file.
`mcp/src/shape.ts`'s `toConciseBlast` had the identical bug: `downstreamBySymbol`
was a `Map` keyed by `d.symbol` alone.

The root limitation runs deeper than any of those call sites: `BlastCallerRow.
viaSymbol` (`src/modules/repo-intel/types.ts:67`) is a bare name, and
`getResolvedCallers` (called from `tryPersistentBlast`,
`src/modules/repo-intel/service.ts:348`) resolves references by name via a
`Set<string>`, not by declaration id. The persisted index cannot tell which of
two same-named declarations a given caller actually reaches — that is a real
resolution-granularity limit, not just a bug in the fold step, and fixing it
would mean threading declaration ids through the indexer's reference-resolution
query, well beyond a `helpers.ts` fix.

**Takeaway:** added `file: z.string()` to the `DownstreamImpact` contract
(`src/vendor/shared/contracts/brief.ts` — **and** the `client/src/vendor/shared`
copy, per root AGENTS.md's "change the canon, sync the copy in the same
commit") so every entry carries its own declaring file, giving every consumer
an honest unique key (`` `${file}:${symbol}` ``) even where caller *attribution*
between two same-named declarations still can't be told apart. `foldBlastResult`
now collects **every** declaring file per name into a `Set` before excluding
self-references, so the exclusion is correct regardless of which same-named
declaration a caller sits near; both same-named entries still legitimately
share the same caller group (the index genuinely can't split them further),
but each now carries its correct, distinct `file`. When adding a field to a
wire contract that already has a "this is the only shape a consumer keys on"
assumption baked in three places (client React key, an MCP dedup `Map`, a
lookup `.find()`), grep every reader of that field's name before assuming the
fix is local to where the field is computed.

**Where:** contract — `src/vendor/shared/contracts/brief.ts:31-38` (canon) and
`client/src/vendor/shared/contracts/brief.ts:31-38` (copy). Fold —
`src/modules/blast/helpers.ts:142-201` (`foldBlastResult`). Root limitation —
`src/modules/repo-intel/types.ts:63-72` (`BlastCallerRow`),
`src/modules/repo-intel/service.ts:321-413` (`tryPersistentBlast`,
`getResolvedCallers` call at `:348`). Client —
`client/src/app/repos/[repoId]/pulls/[number]/_components/BlastRadiusCard/BlastRadiusCard.tsx`
and `BlastGraph.tsx` (both re-keyed on `` `${file}:${symbol}` ``). MCP —
`mcp/src/shape.ts` (`toConciseBlast`'s `downstreamBySymbol`), `mcp/src/types.ts`
(`isBlastPayload`). Tests updated for the new required field: `server/test/
blast-helpers.test.ts`, `server/test/contracts.test.ts`, `mcp/test/
errors.test.ts`, and the client's `BlastRadiusCard.test.tsx`. Also documented
in `docs/blast-radius.md` under "Folding, and the two things the facade does
not do".

### 2026-08-09 — Deleting an `agent_runs` row does NOT stop the run: the task keeps executing, keeps spending, and writes its review into the DB minutes after the row is gone

**Symptom:** a demo PR was reset between recording takes with
`delete from agent_runs where pr_id = …`. Every later run then looked "stuck":
`status = 'running'` for minutes, `tokens_in`/`grounding`/`score` all NULL, no
`run_traces` row — while the server sat at 0% CPU with no lock contention, a
healthy pool, and other endpoints answering in 40ms. Findings nonetheless
appeared in the UI. The giveaway came from the review row itself: its `run_id`
pointed at a run **deleted twelve minutes earlier**, and the server log carried
`Run failed: OpenRouter structured output failed schema validation for Review`
with `durationMs: 2222448` — a 37-minute zombie finally dying.

**Cause:** two independent things, and they masked each other.

1. The run is an in-process async task. `POST /pulls/:id/review` awaits it (the
   request logged `responseTime: 272697`), and cancellation is an *in-memory*
   signal checked at engine checkpoints (`runBus.cancel` →
   `checkCancelled`, `run-executor.ts:297`). Deleting the row removes the
   bookkeeping, not the work. The orphan runs to completion, calls
   `markReviewed` and `insertReviewWithFindings` against a `runId` that no
   longer exists, and its terminal `completeAgentRun` updates **zero rows** — so
   nothing ever records that it finished.
2. `deepseek/deepseek-v4-flash` cannot reliably satisfy the `Review` structured
   output on a ~700-line diff. One attempt looped — 19 near-identical
   "Missing input validation on X parameter" findings, all anchored at
   `start_line: 1`; the next failed schema validation outright after 37 minutes.

**Takeaway:** to reset a PR's review state, **cancel first, wait for the run to
actually leave `running`, and only then delete** — `POST /runs/:id/cancel`, poll
`GET /pulls/:id/runs/active` until it is `[]`, then clean. Restarting the server
is the blunt equivalent: it kills the tasks, and the boot reaper in `app.ts`
marks the leftover `running` rows. Also note `pull_requests.last_reviewed_sha`
(`schema/pulls.ts:21`, written by `markReviewed`, `repository/pull.repo.ts:39`)
is what `deriveReviewStatus` (`modules/pulls/status.ts:52`) reads — deleting
reviews and runs alone leaves a PR showing `reviewed`; the column must be set
back to NULL. And when a run "hangs", read the **server log** before profiling
the process: the real error was sitting there the whole time.

### 2026-08-08 — The `prompt_assembly` flake is a run-vs-trace ordering race: the run is marked DONE before the trace is written

**Symptom:** `TypeError: Cannot read properties of undefined (reading 'skills')`
/ `(reading 'intent')` — `trace.prompt_assembly` is undefined after the test has
already waited for the run to finish. Intermittent, and **which** test fails
moves between runs.

**Cause:** the entry below attributes this to `waitForPrRuns` counting every
terminal `agent_runs` row for the PR cumulatively. That is real, but it cannot be
the whole story: `runWithSkills` calls `setupRepoAndPr` and therefore gets a
**fresh PR with zero prior runs** on every invocation, so there is nothing
cumulative to over-count — and it still fails.

The mechanism underneath is an ordering one in the executor itself.
`completeAgentRun(runId, { status: 'done', … })` runs **before** the trace
document is built and `saveRunTrace(runId, trace)` persists it. So there is a
real window in which the run is terminal and `run_traces` has no row, and *any*
waiter keyed on run STATUS — `waitForPrRuns`, or a per-`runId` status poll —
returns inside it. `GET /runs/:id/trace` then answers without `prompt_assembly`.

**Takeaway:** wait on the row you are about to assert on, not on a proxy for it.

```ts
async function waitForTrace(runId: string, timeoutMs = 10_000) {
  const start = Date.now();
  for (;;) {
    const [row] = await pg.handle.db
      .select().from(t.runTraces).where(eq(t.runTraces.runId, runId));
    if (row) return row;
    if (Date.now() - start > timeoutMs) return row;
    await new Promise((r) => setTimeout(r, 25));
  }
}
```

Three L03 tests using this passed 3/3 consecutive runs while the neighbouring
skills tests, still on `waitForPrRuns`, failed on one of them. Note the run is
genuinely `done` at that point — this is not a product bug and the trace does
arrive; it is only a test that asked the wrong question. Converting the remaining
`waitForPrRuns` call sites is its own task.

Before blaming your diff for any of this, get a baseline: the **unmodified**
`HEAD` in a detached worktree flakes the same way (measured 2026-08-08: one run
`2 failed | 17 passed`, the next `19 passed`, same code, same daemon), using the
worktree recipe in the entry below.

**Where:** the ordering is `src/modules/reviews/run-executor.ts` —
`this.repo.completeAgentRun(runId, { status: 'done', … })` followed later by
`this.repo.saveRunTrace(runId, trace)`; the racy shared helper is
`test/helpers/runs.ts:14-34`; the trace-keyed waiter is `waitForTrace` in
`test/reviews.it.test.ts` (the `L03 — the derived intent reaches the prompt`
block); the table it polls is `src/db/schema/runs.ts:99` (`run_traces`).

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

**Superseded by:** 2026-08-08 (the entry above) — the worktree-baseline advice
stands and the cumulative count is real, but the diagnosis is incomplete, and the
proposed fix would **not** have worked. `runWithSkills` creates a fresh PR per
call, so filtering by `run_id` still returns inside the window: the executor
marks the run `done` before `saveRunTrace` writes the trace. Wait on the
`run_traces` row instead.

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

### 2026-08-08 — Two slices now import `settings/feature-models.ts`, and the §12 fix for it would break both

**Question:** should per-feature model resolution move behind the container, the
way `container.intent` and `container.repoIntel` already do?

`modules/intent/service.ts` imports `resolveFeatureModel` from
`../settings/feature-models.js`, and `modules/conventions/extract-pipeline.ts`
imports `getFeatureModelOverride` from the same file. Both are cross-slice
imports into another slice's private logic, and that file does its own reads
(`await container.db`), so each importer transitively runs a `settings` SELECT
outside its own repository.

`pnpm arch` is green on both, and that is the uncomfortable part rather than a
reprieve: `SLICE_PRIVATE` is a **filename allowlist**
(`service|repository|routes|helpers|run-executor`), and `feature-models` is none
of those. The `backend-onion-architecture` §12 fix shape for that file is "rename
to `service.ts`" — the day anyone does, both imports start failing the gate at
once, in two features neither of which owns the file.

Accepted as debt for L03 deliberately, not overlooked: `specs/l03-intent-layer.md`
prescribed `resolveFeatureModel`, the conventions precedent was already shipping,
and a real fix touches two slices this plan had no mandate over and would need its
own review. Recorded because the alternative is that the second instance looks
like the first one's endorsement.

**Blocked:** on a decision about scope, not on work. The container route is the
one this repo already sanctions for exactly this shape, and it would let §12's
rename happen without collateral. Whoever takes it fixes `conventions/` in the
same change, or the rename stays blocked either way.

**Where:** the two importers are `src/modules/intent/service.ts` and
`src/modules/conventions/extract-pipeline.ts:5`; the file itself is
`src/modules/settings/feature-models.ts` (its own read at `:41`); the rule that
does not fire is `no-cross-slice-import` (`server/.dependency-cruiser.cjs:128-139`,
`SLICE_PRIVATE` at `:65`) — see the Codebase Patterns entry above for why the
container is exempt. The §12 row is in
`.claude/skills/backend-onion-architecture/SKILL.md`.

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
