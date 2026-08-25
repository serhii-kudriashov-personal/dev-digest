# Multi-Agent Review (SPEC-05) — implementation plan

## Task
Build the multi-agent review feature: an agent picker that replaces the PR page's one-or-all control, a Configure run screen with a pre-run estimate, a persisted multi-agent run record over the empty `multi_agent_runs` table, a deterministic cross-agent grouping of findings with a "Where agents disagree" panel, and a two-mode results screen that opens the shipped run-trace drawer whole.

## Requirements source
`specs/2026-08-24-multi-agent-review.md` (SPEC-05) — the whole document, including `## Goals / Non-goals` → "Builds vs reuses", `## Edge cases`, and the seven resolved `## Open questions`. This plan implements those requirements and cites them; it does not define, amend or restate them. Where a step names an `AC-N`, the criterion's text lives in the spec, not here.

## Answers taken
- **Q1 → A.** Membership lives in a new link table `multi_agent_run_members`, not in a column on `agent_runs`. Keeps `ReviewRepository.createAgentRun`'s signature untouched (`server/INSIGHTS.md` 2026-08-02, `completeAgentRun`'s param type is declared twice and `TS2353` points at call sites).
- **Q2 → A.** AC-43 "Learn" is implemented by extending the reviews slice: a `findings.learned_at` column, `'learn'` added to `FINDING_ACTIONS`, a `case 'learn'` in `actOnFinding`.
- **Q3 → A.** `multi_agent_runs` gains `head_sha`; staleness is computed at read time, never stored.
- **Q4 → A.** One client route, `client/src/app/repos/[repoId]/multi-agent/page.tsx`, with `?pr=&run=&mode=&trace=&agent=`.
- **Q5 → yes.** One row is added to the vendored `client/src/vendor/ui/nav.ts` `NAV` array plus its `SHORTCUTS` row, by the SPEC-01 precedent.
- **Rec 1 accepted.** The scaffolded `observability.ts` multi-agent contracts are rewritten to the shape the ACs require, not extended.
- **Rec 2 accepted.** `overlaps` is duplicated into the new slice with a docblock naming the original; `modules/eval/helpers.ts` is not opened for editing.
- **Rec 3 accepted.** All contradicting `runs.json` strings are reconciled, including the "in parallel" sentence in `noAgents.body` that Open question 2 does not name.
- **Rec 4 accepted.** The estimate is a pure client helper over `GET /multi-agent/agent-history`; no server-side sum.
- **Mode chosen: multi-agent, exactly 3 `implementer` agents, sequential**, in the order `impl-server` → `impl-client-results` → `impl-client-entry`.

## Context read
- root `INSIGHTS.md` (2026-08-19, "Zero consumers, safe to edit in place only proves the edit is SAFE") — **the governing entry for Step 1**: `observability.ts` has zero consumers, which licenses editing it in place, but says nothing about the shape fitting; the ACs decide the shape.
- root `INSIGHTS.md` (2026-08-18, "Unwired scaffolding's copy doesn't just go stale, it actively disagrees") — `runs.json` is diffed against the design in Step 8, not inherited.
- root `INSIGHTS.md` (2026-08-16, "A superseded entry whose INDEX ROW still states the stale claim keeps propagating it") — **contradicts** `client/INSIGHTS.md`'s index row for 2026-08-08: `@testing-library/user-event` **is** installed (`client/package.json:31`, `^14.6.3`) and new test files use it (`BriefBar.test.tsx:8-10` states the migration policy). New tests here use `userEvent`, not `fireEvent`.
- root `INSIGHTS.md` (2026-08-11, "A REQUIRED new field on a jsonb-persisted contract goes on a sibling response schema") and (2026-08-02, "A field added to a persisted-jsonb contract must be `.nullish()`") — why `FindingRecord.learned_at` is `.nullish()` in Step 3.
- root `INSIGHTS.md` (2026-08-02, "Unknown cost is `null`, never `0`") — NFR-4, AC-11, AC-13, AC-32.
- root `INSIGHTS.md` (2026-08-24, "A brief's reuse this existing parallel/isolated infra claim is verified against the executor's control flow") and (2026-08-24, "Rejected grounding-gate findings with reasons is not what the trace contract records") — both already absorbed into the spec (AC-14, Open question 7); no step contradicts them.
- root `INSIGHTS.md` (2026-08-02, "An `agent_runs` row and its `reviews` row can each outlive the other") — a lane joins `agent_runs` to `reviews` by `run_id` with no FK; a member with no review row is normal and means "no conclusion", not an error.
- `server/INSIGHTS.md` (2026-08-17, "A slice's `constants.ts` export is a sanctioned cross-slice import; a slice's pure helper function is not") — the rule behind Rec 2 and Step 4.
- `server/INSIGHTS.md` (2026-08-21, "Accept/Dismiss reshuffled the findings list because its fetch query had no `ORDER BY`") — every list query in Step 4 carries an explicit `ORDER BY`.
- `server/INSIGHTS.md` (2026-08-16, "The composite PK that excuses a link table from an FK index leaves its SECOND column unindexed") — the reason `multi_agent_run_members` gets an index on `run_id` in Step 2.
- `server/INSIGHTS.md` (2026-08-09, "`findings` and `reviews` ARE indexed now — check the schema before you owe a migration") — verified: `findings_review_id_idx`, `reviews_pr_kind_idx`, `reviews_run_id_idx`, `agent_runs_ws_pr_ran_idx` all exist; the results read needs no new index beyond the link table's own.
- `server/INSIGHTS.md` (2026-08-05, "`pnpm test` is red here for an environmental reason: 8 files start 8 Postgres containers at once") and (2026-08-03, "`--no-file-parallelism` makes the integration suite deterministic AND faster") — the verification plan runs the new integration file by name.
- `server/INSIGHTS.md` (2026-08-02, "A SKIPPING integration suite silently reads as passing") — a `*.it.test.ts` run is only green at a non-zero, non-skipped test count.
- `client/INSIGHTS.md` (2026-08-16, "The cross-route promotion rule fires on a COMPONENT, not only on a pure helper") — Step 6 moves the whole `RunTraceDrawer` folder, `_components/`, `constants.ts`, `helpers.ts`, `styles.ts`, `index.ts` and test included.
- `client/INSIGHTS.md` (2026-08-05, "Promoting a component must move its CONSTANTS too, and the linter will not tell you") — same step.
- `client/INSIGHTS.md` (2026-08-16, "A new screen does not appear in the left panel until it has a row in the vendored `NAV` array") — Step 13.
- `client/INSIGHTS.md` (2026-08-16, "A duplicated `VALID_TABS` swallows every new tab") — the `mode` allowlist is defined once, in the route's `constants.ts`.
- `client/INSIGHTS.md` (2026-08-16, "A message reproducing engine output goes through `t.raw`, not `t()`") — any catalogue string that reproduces model text.
- `client/INSIGHTS.md` (2026-08-17, "A record's own `stale` field is a snapshot from its last fetch") — the server computes `stale` at read time (AC-46); the client renders it and does not cache it.
- `client/INSIGHTS.md` (2026-08-10, "Open it in a new tab decides state-vs-query-param") — why `run`, `mode`, `trace` and `agent` are query params (AC-38, AC-51, AC-52).
- `client/INSIGHTS.md` (2026-08-09, "A `retry: false` query for a resource that does not exist YET caches the 404 forever") — the multi-agent-run query must not disable retry-and-cache a 404 (AC-44's empty state comes from an empty list, not from a 404).
- `client/INSIGHTS.md` (2026-08-09, "Two panels of one screen reading two query keys go stale ASYMMETRICALLY") — Columns and Tabs read **one** hook, per AC-28.
- `client/INSIGHTS.md` (2026-08-03, "A `'use client'` page becomes a server wrapper with NO Suspense") and (2026-08-05, "Reaching a route-root `_components/` with `../../../`: `typecheck` passes, only `lint` catches it").
- `AGENTS.md` §Repo rules (English-only Markdown; `@devdigest/shared` exists twice; `*.it.test.ts` naming; migrations not applied on boot), §Do not touch (`server/src/db/migrations/**`, `reviewer-core/src/grounding.ts`, `INJECTION_GUARD`, `*/src/vendor/**`, empty tables).
- `docs/l02-experiment.md` — **read and rejected**: this feature changes no prompt and makes no review-quality claim, so nothing here needs the A/B harness.
- `docs/blast-radius.md`, `docs/smart-diff.md` — **read and rejected** except for the `?goto=<path>:<line>` navigation contract reused by AC-39.

## Inventory — what already exists

| Thing | Where | Verdict |
|---|---|---|
| `multi_agent_runs` table (`id`, `workspace_id`, `pr_id`, `ran_at`) | `server/src/db/schema/runs.ts:106-115`; DDL `server/src/db/migrations/0000_init.sql:198-203` | reuse — never written to |
| Membership of a run in a multi-agent run | nowhere. `rg -n "multi_agent" server/src` returns only the declaration and the barrel `server/src/db/schema.ts:40,87`; `agent_runs`' full column list is `runs.ts:21-47` and has no such column | **new** |
| `head_sha` on any review-time record | nowhere. `agent_runs` (`runs.ts:21-47`) and `reviews` (`reviews.ts:11-28`) both lack it | **new** |
| `findings.learned_at` | nowhere; `findings` ends at `dismissed_at` (`server/src/db/schema/reviews.ts:75-77`) | **new** |
| `ReviewService.runReview(workspaceId, prId, targets: AgentRow[], logger?)` — creates one `agent_runs` row per agent, returns run ids, then fires the executor in the background | `server/src/modules/reviews/service.ts:98-140` | reuse, unchanged |
| `ReviewService.resolveTargets` — one-or-all only | `server/src/modules/reviews/service.ts:123-133` | not reused; the new slice resolves its own list from `container.agentsRepo.getById` |
| `ReviewRunExecutor.executeRuns` — shared diff+intent once, then a sequential `for … await` per agent, per-agent failure isolated | `server/src/modules/reviews/run-executor.ts:150-184` | reuse, **untouched** (AC-14; spec §Non-goals) |
| `container.agentsRepo`, `container.reviewRepo` | `server/src/platform/container.ts:111-121` | reuse |
| A container getter for a slice **service** (precedent) | `RepoIntelService`, `IntentService`, `BlastService`, `ContextService` at `server/src/platform/container.ts:136,151,164,181` | extend — add `container.reviews` |
| `overlaps(a, b)` inclusive line-range overlap | `server/src/modules/eval/helpers.ts:33-35` (used at `:74`) | duplicate — `SLICE_PRIVATE` blocks the import (`server/INSIGHTS.md` 2026-08-17); the same file already duplicates `labelSkillBodies` for this reason (`helpers.ts:48-57`) |
| Accept / Dismiss routes + service + repo | `server/src/modules/reviews/routes.ts:143-149`, `findings.ts:22-33`, `repository.ts:136,140` | reuse; extended only by `'learn'` |
| "Turn into eval case" bridge | `server/src/modules/eval/routes.ts:49-58` (`POST /findings/:id/eval-case`) | reuse, unchanged |
| `GET /runs/:id/trace`, `GET /runs/:id/events` (SSE) | `server/src/modules/reviews/routes.ts:48-92,121-126` | reuse, unchanged |
| `AgentColumn` / `ConflictTake` / `Conflict` / `MultiAgentRun` scaffolding | `server/src/vendor/shared/contracts/observability.ts:22-86` and the client copy | extend/rewrite — zero consumers (`rg -n "MultiAgentRun\|AgentColumn\|ConflictTake" --glob '!**/vendor/shared/**'` returns only `specs/**`) |
| `AgentStats` contract with no route | `observability.ts:96-115`; `server/src/modules/agents/routes.ts:74-190` has no `/stats` | untouched — Per-Agent Stats is a spec non-goal |
| `RunReviewDropdown` (run-all / one-agent) | `client/.../pulls/[number]/_components/RunReviewDropdown/` | **replaced and deleted** (AC-1) |
| `RunTraceDrawer` + `_components/{TraceBody,FindingsSection,PromptBlock,PromptModalBody,ToolCallRow,TraceSection,atoms}` | `client/.../pulls/[number]/_components/RunTraceDrawer/` | reuse whole — **promoted**, content untouched (AC-48…AC-53) |
| The `?trace=<runId>` open-by-address mechanic | `client/.../PrDetailView/PrDetailView.tsx:75,266-271` | reuse as the pattern for AC-51 |
| `RunTraceDrawer`'s `running` prop (opens on the live log) | `RunTraceDrawer.tsx:36-45`; **the shipped caller never passes it** (`PrDetailView.tsx:266-271`) | extend — every caller must now pass it (AC-50) |
| `FindingCard` with accept / dismiss / add-to-evals and the judged-first rule | `client/.../_components/FindingCard/FindingCard.tsx:117-148` | reference only — the multi-agent detail card is a new route-local component (see `## Out of scope`) |
| `usePulls`, `useAgents`, `useFindingAction`, `useCreateEvalCaseFromFinding`, `useRunEvents`, `useRunTrace` | `client/src/lib/hooks/{core,agents,reviews,eval,trace}.ts` | reuse |
| `activeKeyFor` branch for `/multi-agent` | `client/src/components/app-shell/helpers.ts:28` | already-done — no edit |
| `NAV` array row for the screen | `client/src/vendor/ui/nav.ts:21-38` — absent | **new** (one row) |
| Unwired copy catalogue for this exact feature | `client/messages/en/runs.json` — `conflicts.*`, `column.*`, `tabs.*`, `viewTrace` match the design; `trace.*`/`drawer.*` are the live shipped copy; `page.meta:132`, `page.runAll:130`, `noRun.bodyReady:140`, `noAgents.body` contradict it | extend + reconcile |
| `@testing-library/user-event` | `client/package.json:31` (`^14.6.3`) — installed | reuse; new tests use it |
| MSW | not in `client/package.json` | not available — mock hooks with `vi.mock` |

## Constraints that bind

| Rule | Applies? | What the implementation must do |
|---|---|---|
| `@devdigest/shared` exists twice | **yes** | `observability.ts`, `findings.ts` and `review-api.ts` changes land in `server/src/vendor/shared/contracts/` **and** `client/src/vendor/shared/contracts/` in the **same step** (Step 1 / Step 3). Gate: `./scripts/check-shared-sync.sh`. Do **not** verify with `diff -r` — the trees carry documented drift (root `INSIGHTS.md` 2026-08-01) |
| A field on a **jsonb-persisted** contract | **yes, once** | `FindingRecord.learned_at` is `.nullish()`, never `.nullable()` (root `INSIGHTS.md` 2026-08-02). Everything new on `MultiAgentRunResult` is a **wire-only** DTO computed per read and persisted nowhere, so `.nullable()` is correct there and expresses "unknown, not zero" |
| A DB-backed test | **yes** | the new server test file is `server/test/multi-agent.it.test.ts` — the `.it.` is the CI split, not a preference |
| A migration | **yes, one** | generated with `cd server && pnpm db:generate`, applied by hand with `cd server && pnpm db:migrate`. **Never edit `server/src/db/migrations/**`** — existing migrations are only superseded. The migration is pure `ADD`, so it will not trip the interactive prompt (`server/INSIGHTS.md` 2026-08-05) |
| ring / import direction | **yes** | `backend-onion-architecture` §1/§2/§5/§6. Gate: `cd server && pnpm arch`. Note it is **not** wired into CI (root `INSIGHTS.md` 2026-08-02) — run it by hand |
| slice file manifest | **yes** | `backend-onion-architecture` §13 — the new slice is exactly `constants.ts`, `helpers.ts`, `repository.ts`, `service.ts`, `routes.ts`. **No invented filename**, or the gate stops seeing the file. And the slice is dead until `modules/index.ts` names it |
| `reviewer-core` | **no** | untouched (spec §Non-goals). Nothing in this plan imports or edits it |
| new file placement in `client/` | **yes** | `frontend-ui-architecture` §1 placement, §2 promotion. Two consumers ⇒ `RunTraceDrawer` moves to `client/src/components/run-trace-drawer/`; the agent picker has two consumers from birth (PR header + Configure screen) so it starts at `client/src/components/agent-picker/` |
| a secret | **no** | no new secret, no new outbound call. The LLM path is entirely inside the reused executor |
| any `CLAUDE.md` / `AGENTS.md` | **no** | no agent-instruction file is edited by this plan |
| empty tables reserved for later lessons | **yes** | `multi_agent_runs` is one of them and is now claimed by SPEC-05. `ci_*`, `eval_*`, `memory`, `digests`, `onboarding` stay untouched |
| a new rule in an agent `system_prompt` | **no** | no `agents.system_prompt` edit |
| do-not-touch sentinels | **yes, avoided** | `server/src/db/migrations/**` gains a *generated* file and no edits; `reviewer-core/src/grounding.ts` and `INJECTION_GUARD` untouched; `*/src/vendor/**` is touched in exactly two sanctioned ways — the `vendor/shared` contract copies (the documented two-copy rule) and one `NAV` row (Q5, SPEC-01 precedent). See `## Risks & open questions` |

## Modules touched

| Package | Path | Ring / layer | Why |
|---|---|---|---|
| server | `server/src/vendor/shared/contracts/observability.ts` | 0 | the multi-agent wire contracts |
| server | `server/src/vendor/shared/contracts/review-api.ts` | 0 | `FindingRecord.learned_at` |
| server | `server/src/db/schema/runs.ts`, `server/src/db/schema/reviews.ts`, `server/src/db/schema.ts` | 3 | link table, `head_sha`, `learned_at`, barrel |
| server | `server/src/db/migrations/<generated>.sql` + `meta/` | 3 | generated, never hand-edited |
| server | `server/src/modules/multi-agent/{constants,helpers,repository,service,routes}.ts` | 2·3·5 | the new slice |
| server | `server/src/modules/index.ts` | 5 | the registry — without it every endpoint 404s |
| server | `server/src/platform/container.ts` | 4 | `container.reviews`, the sanctioned cross-slice channel |
| server | `server/src/modules/reviews/{routes,findings,repository,helpers}.ts` | 5·2·3 | AC-43 `learn` only |
| server | `server/test/multi-agent.it.test.ts` | outside the rings | route + repository coverage |
| client | `client/src/vendor/shared/contracts/{observability,review-api}.ts` | — | the manual copy, synced in the same step |
| client | `client/src/lib/hooks/multi-agent.ts`, `client/src/lib/hooks/index.ts` | data layer | the new endpoints |
| client | `client/src/components/run-trace-drawer/**` | shared component | promoted, content unchanged |
| client | `client/src/components/agent-picker/**` | shared component | two routes consume it |
| client | `client/src/app/repos/[repoId]/multi-agent/**` | route | Configure + Results |
| client | `client/src/app/repos/[repoId]/pulls/[number]/_components/{PrDetailHeader,PrDetailView}` | route-local | picker swap; promoted-drawer import |
| client | `client/messages/en/{runs,prReview}.json` | i18n | all copy |
| client | `client/src/vendor/ui/nav.ts` | vendored | one `NAV` row + one `SHORTCUTS` row |

## Skills — read by the planner, to be loaded by the executor

| Path glob | Skill | Sections | routing.md row | Rule it imposes on this plan |
|---|---|---|---|---|
| `server/src/modules/**` (service, helpers, anything else) | `backend-onion-architecture` **(preloaded)** | §1, §2, §8, §13 | line 34 | the new slice is exactly the five manifest filenames; a sixth name would be outside every `pnpm arch` rule |
| `server/src/modules/multi-agent/routes.ts` | `backend-onion-architecture` **(preloaded)** | §6 | line 27 | Zod in `schema:`, no SQL, no logic; throw `AppError` subclasses, never `reply.code(500)` |
| same | `fastify-best-practices` | `rules/schemas.md` — request validation parts, response schemas | line 28 | validate `params`/`body`/`querystring` declaratively. **House override:** this repo uses `fastify-type-provider-zod` (`withTypeProvider<ZodTypeProvider>()`, `reviews/routes.ts:19-20`), **not** TypeBox — do not introduce `@sinclair/typebox` |
| same | `security` | A01 access control, A06 rate limiting, A08 mass assignment | line 29 | every handler resolves `workspaceId` via `getContext` and scopes the query by it (AC-20); the start route gets its own tight `config.rateLimit` because it fans out to paid model calls; the body is destructured field-by-field, never spread |
| `server/src/modules/multi-agent/repository.ts` | `backend-onion-architecture` **(preloaded)** | §5 | line 30 | all Drizzle here and nowhere else; constructor takes `Db`, not `Container`; no query builder, `SQL` fragment or transaction handle in any signature |
| same | `drizzle-orm-patterns` | schema-definition, queries/joins | line 31 | `.references(() => table.col)` as an arrow function; `$inferSelect` for row types |
| `server/src/db/schema/**`, `server/src/db/schema.ts` | `postgresql-table-design` + `drizzle-orm-patterns` | Constraints, Indexing, Data Types | line 32 | `TIMESTAMPTZ` for `learned_at`; FK columns are **not** auto-indexed; a composite PK covers only its leftmost prefix, so `run_id` needs its own index |
| `server/src/db/migrations/**` | — | — | line 33 | **sentinel** — generated only, never edited |
| `server/src/platform/container.ts` | `backend-onion-architecture` **(preloaded)** | §4 | line 37 | the container is the only sanctioned cross-slice channel; lazy `??=`, no `await` (no secret involved) |
| `server/test/**` | `backend-onion-architecture` **(preloaded)** | §9 | line 38 | routes via `buildApp({ overrides })` + `app.inject()`; repositories via `*.it.test.ts` |
| `*/src/vendor/shared/**`, any `z.object(` changed | `zod` | `object-optional-vs-nullable`, `type-use-z-infer`, `schema-use-enums` | lines 63-64 | `.nullable()` = present-but-unknown (the lane cost); `.nullish()` = the jsonb rule for `FindingRecord.learned_at`; export the schema **and** the `z.infer` type |
| `client/src/app/**/*.tsx`, `client/src/components/**/*.tsx` | `frontend-ui-architecture` **(preloaded)** | §1, §2, §3, §5 | line 14 | a second route consumer forces promotion to `client/src/components/<kebab>/`, folder and all; no `../../../` into another route's `_components/` |
| same | `react-best-practices` | Derive-don't-store, hooks, keys, conditional rendering, a11y | line 15 | conflict filtering and the estimate are computed during render, never `useState`+`useEffect`; `{n > 0 && …}` never `{n && …}`; `aria-label` on icon-only trace buttons. **Demoted per `routing.md` §Demotion list: ignore "container components fetch data" and "max 200 lines" — split only on a named problem** |
| `client/src/app/**/page.tsx` | `next-best-practices` | `file-conventions.md`, `rsc-boundaries.md`, `suspense-boundaries.md` | line 16 | `page.tsx` stays a thin entry (`pulls/[number]/page.tsx` is the precedent); `'use client'` marks the view, not the page |
| `client/src/lib/**` | `frontend-ui-architecture` **(preloaded)** | §1, §2, §6 | line 19 | every fetch is a TanStack Query hook over `apiFetch`; a mutation invalidates its keys in `onSuccess` |
| `client/**/index.ts` | `frontend-ui-architecture` **(preloaded)** | §7 | line 20 | one shallow barrel per shared module; never a barrel of barrels, never self-import through the barrel |
| `client/src/**/*.test.tsx` | `react-testing-library` | query priority, `userEvent`, async | line 18 | `getByRole` first; `userEvent.setup()` before `render`. **House override:** MSW is not installed — mock the hook module with `vi.mock` |

## Execution

Multi-agent, **three `implementer` agents, strictly sequential**. Nothing runs in parallel among them; the only parallel pair is the two read-only reviewers at the end. Each writing row's `Files owned` set is disjoint from every other writing row.

**Implementer writes no tests in this workflow.** Every test file — server and client — is written by `test-writer` (hop 5), after all three implementer hops and after `plan-verifier`. Steps 5, 10 and 14 below are `test-writer`'s worklist, not the implementers'; they stay numbered where they sit in the feature's natural order for readability, but they do not run as part of hops 1–3 and their files are excluded from those hops' `Files owned`.

| # | Agent | Input artifact | Steps | Files owned | Output |
|---|---|---|---|---|---|
| 1 | `implementer` (**impl-server**) | `plans/2026-08-24-multi-agent-review.md` | 1–4 | `server/**` (incl. `server/src/vendor/shared/contracts/{observability,review-api}.ts`), excluding `server/test/**`, **and** `client/src/vendor/shared/contracts/{observability,review-api}.ts` | server changes in the working tree; both contract copies in sync; no test file |
| 2 | `implementer` (**impl-client-results**) | the same path | 6–9 | `client/src/components/run-trace-drawer/**` (its pre-existing, relocated test travels with the move — no new test authored), `client/src/app/repos/[repoId]/pulls/[number]/_components/RunTraceDrawer/**` (deleted), `client/src/app/repos/[repoId]/pulls/[number]/_components/PrDetailView/PrDetailView.tsx`, `client/src/lib/hooks/multi-agent.ts`, `client/src/lib/hooks/index.ts`, `client/messages/en/runs.json`, `client/src/app/repos/[repoId]/multi-agent/_components/{MultiAgentResults,AgentLane,DisagreementPanel,MultiAgentFindingCard}/**` excluding any `*.test.tsx` | results section + data layer; no new test file |
| 3 | `implementer` (**impl-client-entry**) | the same path | 11–13 | `client/src/components/agent-picker/**` excluding `AgentPicker.test.tsx`, `client/src/app/repos/[repoId]/pulls/[number]/_components/PrDetailHeader/**`, `client/src/app/repos/[repoId]/pulls/[number]/_components/RunReviewDropdown/**` (deleted), `client/messages/en/prReview.json`, `client/src/vendor/ui/nav.ts`, `client/src/app/repos/[repoId]/multi-agent/{page.tsx,constants.ts}`, `client/src/app/repos/[repoId]/multi-agent/_components/{MultiAgentView,ConfigureRunPanel}/**` excluding `ConfigureRunPanel.test.tsx` | entry points + route shell; no new test file |
| 4 | `plan-verifier` | the same path | — | none (read-only) | one row per plan item and per `AC-N`; `not-met` rows go back to the owning hop, `partial` rows too |
| 5 | `test-writer` | the same path + Steps 5, 10, 14 in full + the criteria named below + the `unverifiable` rows from hop 4 | 5, 10, 14 | `server/test/multi-agent.it.test.ts`, `server/test/multi-agent-helpers.test.ts`, `client/src/**/*.test.tsx` under this feature's new components — **every test file this feature needs, none written earlier** | tests |
| 6 | `architecture-reviewer` | the changed-file list | — | none (read-only) | ring and placement findings |
| 6′ | security review | the same changed-file list | — | none (read-only) | runs **in parallel with row 6** — both are read-only, so their scopes are trivially disjoint |
| 7 | `doc-writer` | the shipped feature + this plan | — | `docs/multi-agent-review.md`, the matching `AGENTS.md` §Read when row | the feature document |

**Why the order is forced, not stylistic.** Contracts precede their consumers, so hop 1 is first. Hop 3's `MultiAgentView` imports `MultiAgentResults` and calls `useMultiAgentRun` — both created in hop 2 — and it mounts `@/components/run-trace-drawer`, which hop 2 creates by moving the folder; **the later agent is the one that writes the import**, so hop 2 must precede hop 3. `PrDetailView.tsx` is the only file that both the drawer promotion and the PR page touch, so it is owned solely by hop 2, and hop 3's PR-page work is confined to `PrDetailHeader.tsx`, whose props are unchanged (`prId`, `warnMerged`, `onRunStart`, `onRunsStarted` — `PrDetailHeader.tsx:93-98`, `PrDetailView.tsx:191-199`). `runs.json` is owned solely by hop 2 and `prReview.json` solely by hop 3, so no catalogue is written twice — hop 2 adds every `runs.*` key, including those hop 3 consumes. `test-writer` runs last among the writers, after hop 4, because it needs the settled production code (and `plan-verifier`'s `unverifiable` rows) to write against — writing tests earlier against code the implementers might still adjust would mean rewriting them.

**Hand-offs are paths, never summaries.** Each hop reads `plans/2026-08-24-multi-agent-review.md` itself (`.claude/agents/README.md` §How they chain).

**What `test-writer` is handed:** the full content of Steps 5, 10 and 14 (the specific test cases this plan already specifies — every AC and edge case named in those three step bodies), plus, as additional worklist, `AC-11`, `AC-13`, `AC-14` (the estimate helper's three arithmetic rules), `AC-21`, `AC-24`, `AC-25`, `AC-26`, `AC-27` (the grouping helper), `AC-16`, `AC-17`, `AC-18`, `AC-19`, `AC-20` (the record and its scoping), `AC-32` (unknown-not-zero totals), `AC-46` (staleness), `AC-49` and `AC-50` (the trace caller's obligations), `AC-47` (text-only identity and the lane's live-region announcement), plus **every `unverifiable` row hop 4 produced** — those are precisely the criteria nothing yet makes observable. This hop writes every test file the feature needs; hops 1–3 write none.

**A second `plan-verifier` run** is worth scheduling only if hop 4 returns any `not-met` row, or if this change will gate a pull request.

**If a hop dies on an account limit it returns nothing, not a partial result** (root `INSIGHTS.md` 2026-08-08). Fallback: re-run that hop alone against the same plan path; the preceding hops' work is already in the working tree and the steps are idempotent in intent (re-reading a file the hop already wrote is safe; **the exception is Step 2, whose `pnpm db:generate` must not be run twice** — check `server/src/db/migrations/` for an already-generated file first).

## Remediation loop (post-review, bounded)

`plan-verifier` (hop 4) and `architecture-reviewer` / security review (hops 6/6′) can each return findings that call for a code change — a `not-met`/`partial` plan-verifier row, or an accepted CRITICAL/WARNING architecture or security finding. This feature does **not** run an open-ended fix loop. The cap:

- **At most 2 remediation iterations, total, across all review hops combined** — not 2 per hop. An iteration is one `implementer`-fix subagent addressing every accepted finding accumulated so far, followed by one re-check of only the affected area (not a full re-run of hops 4/6/6′).
- **At most 2 fix subagents may be raised in total.** Iteration 1 uses fix-subagent 1; iteration 2 (only if iteration 1 leaves an accepted finding unresolved) uses fix-subagent 2. There is no third.
- If accepted findings remain after 2 iterations, the loop stops. Remaining findings are reported to the user as-is, with their evidence, rather than triggering a third subagent. The user decides whether to fix by hand, accept the residual risk, or authorize a further round explicitly.
- A finding that is a matter of judgement (not a plan deviation and not a clear-cut CRITICAL) is not auto-fixed at all — it is surfaced to the user in the same report, unconsumed by the iteration count.
- `test-writer` (hop 5) is not part of this loop: a test that fails because production code is wrong is a `plan-verifier`/review finding to fix in code, not a test to rewrite until it passes.

## Steps

### Step 1 — Rewrite the multi-agent wire contracts to the shape the ACs require
- **Files:** `server/src/vendor/shared/contracts/observability.ts` **and** `client/src/vendor/shared/contracts/observability.ts` (identical edit, same step)
- **Change:** replace the scaffolded `AgentColumnFinding` / `AgentColumn` / `ConflictTake` / `Conflict` / `MultiAgentRun` block (lines 18–86) with:
  - `MultiAgentStartRequest = z.object({ agent_ids: z.array(z.string().uuid()).min(1).max(MAX_AGENTS_PER_RUN) })` — the cap literal is `8` (NFR-3) and is re-declared server-side in `modules/multi-agent/constants.ts`.
  - `MultiAgentRunSummary = z.object({ id, pr_id, pr_number: z.number().int().nullish(), ran_at: z.string(), agent_count: z.number().int(), member_run_ids: z.array(z.string()) })` — the start response (AC-16) and the list element (AC-17, AC-18).
  - `AgentLane` (replaces `AgentColumn`): `run_id`, `agent_id: z.string().nullable()`, `agent_name: z.string()` (the name recorded at run time, so it survives agent deletion — spec §Edge cases), `provider`, `model`, `status: z.enum(['queued','running','done','failed','cancelled'])`, `error: z.string().nullable()` (AC-19, AC-33), `verdict`, `score`, `summary`, `duration_ms: z.number().int().nullable()`, `cost_usd: z.number().nullable()`, `findings: z.array(FindingRecord)`, `findings_total: z.number().int()` (NFR-3's "how many shown out of how many exist"). **`findings` is the full `FindingRecord`, not a reduced shape** — AC-36 needs `rationale`/`suggestion`, AC-37 `confidence`, AC-40/41 `accepted_at`/`dismissed_at`, and AC-49 needs exactly what `RunTraceDrawer`'s `findings?: FindingRecord[]` prop takes (`RunTraceDrawer.tsx:25`).
  - `LocationStance = z.object({ agent_id: z.string().nullable(), agent_name: z.string(), run_id: z.string(), flagged: z.boolean(), severity: Severity.nullable(), finding_ids: z.array(z.string()) })` — **no `note` field, and no field that could carry a rationale for a did-not-flag entry** (AC-25). `flagged: false` ⇒ `severity: null` and `finding_ids: []`.
  - `GroupedLocation = z.object({ file: z.string(), start_line: z.number().int(), end_line: z.number().int(), stances: z.array(LocationStance), conflict: z.boolean() })` — a **range**, not a single line (AC-21); `conflict` is the server's deterministic verdict (AC-26, NFR-5).
  - `MultiAgentRunResult = z.object({ id, pr_id, pr_number, repo_id: z.string(), ran_at, stale: z.boolean(), lanes: z.array(AgentLane), locations: z.array(GroupedLocation), locations_total: z.number().int(), completed_lane_count: z.number().int(), total_duration_ms: z.number().int().nullable(), total_cost_usd: z.number().nullable() })`. `total_duration_ms` is **nullable** — absent until every member settles (AC-31); `total_cost_usd` is the sum of known values and `null` when none is known (AC-32, NFR-4).
  - `AgentHistoryRow = z.object({ agent_id: z.string(), agent_name: z.string(), enabled: z.boolean(), model: z.string().nullable(), last_run: z.object({ run_id, ran_at, duration_ms: z.number().int().nullable(), cost_usd: z.number().nullable(), summary: z.string().nullable(), pr_number: z.number().int().nullish() }).nullable() })` — AC-10, AC-11, and Open question 6's "the agent's last completed run's summary, attributed and dated".
  - Leave `AgentStats`, `StatPoint`, `CuratorMerge`, `CuratorResult` (lines 88–136) untouched.
  - Update the file's header docblock to name the routes this feature actually serves.
- **Skill:** `zod` `object-optional-vs-nullable` — `.nullable()` here means "the field is always present and its value is unknown", which is exactly NFR-4's unknown-never-zero; `type-export-schemas-and-types` — export both the schema and its `z.infer`
- **Agent:** `implementer` (impl-server)
- **Verify:** `cd server && pnpm typecheck` and `./scripts/check-shared-sync.sh`
- **Done when:** `check-shared-sync.sh` exits 0, and `rg -n "note" server/src/vendor/shared/contracts/observability.ts` returns no line inside a stance schema

### Step 2 — Schema: the membership link table, `head_sha`, `learned_at`, and one generated migration
- **Files:** `server/src/db/schema/runs.ts`, `server/src/db/schema/reviews.ts`, `server/src/db/schema.ts`, plus the file `pnpm db:generate` writes under `server/src/db/migrations/`
- **Change:**
  - In `runs.ts`, add `headSha: text('head_sha').notNull()` to `multiAgentRuns` (safe: the table has never held a row — spec §Contract promises; verified `rg -n "multi_agent" server/src`).
  - In `runs.ts`, add below `multiAgentRuns`:
    ```
    export const multiAgentRunMembers = pgTable('multi_agent_run_members', {
      multiAgentRunId: uuid('multi_agent_run_id').notNull().references(() => multiAgentRuns.id, { onDelete: 'cascade' }),
      runId: uuid('run_id').notNull().references(() => agentRuns.id, { onDelete: 'cascade' }),
      position: integer('position').notNull().default(0),
    }, (t) => [
      primaryKey({ columns: [t.multiAgentRunId, t.runId] }),
      index('multi_agent_run_members_run_idx').on(t.runId),
    ]);
    ```
    `position` preserves the selection order the lanes render in. The `run_id` index is **not** optional: the composite PK serves `WHERE multi_agent_run_id = ?` as a leftmost prefix but leaves the reverse lookup unindexed (`server/INSIGHTS.md` 2026-08-16).
  - In `reviews.ts`, add `learnedAt: timestamp('learned_at', { withTimezone: true })` to `findings`, beside `dismissedAt`. Nullable, no index — nothing filters on it yet (AC-43 only requires it be retrievable).
  - Register `multiAgentRunMembers` in the `server/src/db/schema.ts` barrel, in both the export block and the schema object (follow how `multiAgentRuns` appears at `:40,87`).
  - Run `cd server && pnpm db:generate`, then `cd server && pnpm db:migrate`. **Do not edit any existing file under `server/src/db/migrations/`.**
- **Skill:** `postgresql-table-design` §Constraints/§Indexing — FK columns are not auto-indexed and a composite PK only covers its leftmost prefix; `TIMESTAMPTZ`, never `TIMESTAMP`. `drizzle-orm-patterns` — `.references(() => …)` as an arrow function
- **Agent:** `implementer` (impl-server)
- **Verify:** `cd server && pnpm db:generate` produces exactly one new `.sql` (a pure `CREATE TABLE` + two `ALTER TABLE … ADD COLUMN`, no interactive prompt), `cd server && pnpm db:migrate` applies clean, `cd server && pnpm typecheck`
- **Done when:** `rg -n "multi_agent_run_members" server/src/db/schema.ts` matches, and the newest file in `server/src/db/migrations/` contains `multi_agent_run_members`, `head_sha` and `learned_at` and no `DROP`

### Step 3 — AC-43: record the Learn intent in the reviews slice
- **Files:** `server/src/modules/reviews/routes.ts`, `server/src/modules/reviews/findings.ts`, `server/src/modules/reviews/repository.ts`, `server/src/modules/reviews/repository/review.repo.ts`, `server/src/modules/reviews/helpers.ts`, `server/src/vendor/shared/contracts/review-api.ts` **and** `client/src/vendor/shared/contracts/review-api.ts`
- **Change:**
  - `review-api.ts` (both copies): add `learned_at: z.string().nullish()` to `FindingRecord`. **`.nullish()`, not `.nullable()`** — root `INSIGHTS.md` 2026-08-02 and `server/INSIGHTS.md` 2026-08-03; `FindingRecord` is reproduced inside documents the client already holds and a required-null key would reject every one of them.
  - `review.repo.ts`: add `setFindingLearned(findingId: string, at: Date | null)`, mirroring `setFindingDismissed` exactly (same `returning()`, same shape).
  - `repository.ts`: delegate it. **Derive the parameter type rather than re-typing it** — `backend-onion-architecture` §3 and `server/INSIGHTS.md` 2026-08-02, the `completeAgentRun` `TS2353` trap.
  - `findings.ts`: add `case 'learn': { const row = await repo.setFindingLearned(findingId, new Date()); return { finding: findingRowToDto(row!) }; }` before the `default:` that still throws `invalid_action` for `'reply'` (Open question 4 keeps Reply out).
  - `helpers.ts` `findingRowToDto`: map `learned_at`.
  - `routes.ts:18`: `const FINDING_ACTIONS = ['accept', 'dismiss', 'learn'] as const;` — the existing loop then registers `POST /findings/:id/learn` with no other edit.
- **Skill:** `backend-onion-architecture` §3 — a signature is declared once, derive it in the facade; §5 — the SQL stays in `*.repo.ts`
- **Agent:** `implementer` (impl-server)
- **Verify:** `cd server && pnpm typecheck && pnpm arch`, `./scripts/check-shared-sync.sh`
- **Done when:** `rg -n "'learn'" server/src/modules/reviews/findings.ts` matches inside a `case`, and `rg -n "reply" server/src/modules/reviews/findings.ts` shows it still falling through to `invalid_action`

### Step 4 — The `multi-agent` slice: record, read, group, and the agent history
- **Files:** `server/src/modules/multi-agent/constants.ts`, `helpers.ts`, `repository.ts`, `service.ts`, `routes.ts`; `server/src/modules/index.ts`; `server/src/platform/container.ts`
- **Change:**
  - `constants.ts` (**public**, importable across slices): `MAX_AGENTS_PER_RUN = 8`, `MAX_LANE_FINDINGS = 50`, `MAX_LOCATIONS = 50` (NFR-3), `MULTI_AGENT_RATE_LIMIT = { max: 10, timeWindow: '1 minute' }` (mirrors `reviews/routes.ts:29`, the precedent for a route that fans out to paid model calls).
  - `helpers.ts` (**ring 2, pure — no `Db`, no `Container`, no `fastify`**):
    - `overlaps(a: LineRange, b: LineRange): boolean` — `a.start_line <= b.end_line && b.start_line <= a.end_line`, **duplicated verbatim** from `server/src/modules/eval/helpers.ts:33-35` with a docblock naming that file:line as the original and `no-cross-slice-import` as the reason (the same file's `labelSkillBodies` at `:48-57` is the in-repo precedent; `server/INSIGHTS.md` 2026-08-17). **Do not edit `eval/helpers.ts`.**
    - `groupFindings(lanes)` → `GroupedLocation[]`: consider only lanes with `status === 'done'` (AC-24, and the "location flagged by an agent whose run failed" edge case); bucket by exact `file` string then merge any finding whose range overlaps a bucket's current span, widening the span; emit one `LocationStance` **per completed lane** — `flagged: true` with its severity and `finding_ids` when that lane has findings in the bucket, otherwise `flagged: false` with `severity: null` and no other field (AC-25). Two findings from the *same* agent produce **one** stance carrying both ids, so an agent never disagrees with itself (spec §Edge cases). Sort locations by `file` then `start_line` — deterministic per NFR-5 and never reshuffling (`server/INSIGHTS.md` 2026-08-21).
    - `isConflict(stances)`: `true` when any stance has `flagged === false`, or when the set of `severity` values among flagged stances has more than one member (AC-26). Never reads `confidence` (AC-37, root `INSIGHTS.md` 2026-08-02).
    - `runTotals(lanes)`: `total_duration_ms` is the sum of member durations **only when every lane has settled**, else `null` (AC-31); `total_cost_usd` sums the non-null costs and is `null` when every cost is unknown (AC-32).
  - `repository.ts` (**ring 3, constructor takes `Db`**): `createRun({ workspaceId, prId, headSha })`; `addMembers(multiAgentRunId, runIds)`; `listForPull(workspaceId, prId)` with `ORDER BY ran_at DESC`; `getRun(workspaceId, id)` scoped by `workspace_id` (AC-20 — an out-of-workspace id returns `undefined`, and the service turns that into `NotFoundError`, disclosing nothing); `membersWithReviews(multiAgentRunId)` joining `multi_agent_run_members → agent_runs → reviews (on run_id) → findings`, ordered by `position` then `findings.id`; `lastCompletedRunPerAgent(workspaceId)` — one row per agent, its newest `agent_runs` row with `status = 'done'`, left-joined to `reviews` for the summary and to `pull_requests` for the number. Nothing Drizzle-shaped leaves any signature.
  - `service.ts` (**ring 2, takes `Container`, never reads `container.db`**):
    - `start(workspaceId, prId, agentIds)` — reject `> MAX_AGENTS_PER_RUN` with a `ValidationError`; resolve each id through `container.agentsRepo.getById` (a missing one is `NotFoundError`), preserving the caller's order; read the pull to capture `head_sha`; call `container.reviews.runReview(workspaceId, prId, targets, logger)`, which returns the run ids **before** any agent finishes (NFR-2); then `createRun` + `addMembers`. **The record is written before completion** (AC-16), and because a disabled agent resolves by id just like an enabled one, the "disabled agent picked" edge case holds for free.
    - `results(workspaceId, runId)` — assemble `MultiAgentRunResult`: lanes from `membersWithReviews` (a member with no `reviews` row is a lane with `verdict`/`score`/`summary` all `null`, which is normal — root `INSIGHTS.md` 2026-08-02), findings capped at `MAX_LANE_FINDINGS` with `findings_total` carrying the true count, locations capped at `MAX_LOCATIONS` with `locations_total`, and `stale = run.headSha !== pull.headSha` **computed here, never stored** (AC-46; the pattern is `modules/intent/service.ts:155`, whose repository deliberately returns the DTO *minus* `stale`).
    - `listForPull`, `agentHistory(workspaceId)`.
  - `routes.ts` (**ring 5**), all four resolving `workspaceId` via `getContext(container, req)` first:
    - `POST /pulls/:id/multi-agent-runs` — `schema: { params: IdParams, body: MultiAgentStartRequest }`, `config: { rateLimit: MULTI_AGENT_RATE_LIMIT }`. **Declare the body in `schema:`** — the tolerant manual parse in `reviews/routes.ts:32` is a documented one-off for an optional-everything body and is not the pattern here (`backend-onion-architecture` §6). Destructure `agent_ids`; never spread the body.
    - `GET /pulls/:id/multi-agent-runs` → `MultiAgentRunSummary[]`, newest first.
    - `GET /multi-agent-runs/:id` → `MultiAgentRunResult`.
    - `GET /multi-agent/agent-history` → `AgentHistoryRow[]`.
  - `server/src/modules/index.ts`: one import and one entry. **Without this every route 404s and no gate says a word** (`backend-onion-architecture` §13).
  - `server/src/platform/container.ts`: add a lazy `get reviews(): ReviewService { return (this._reviews ??= new ReviewService(this)); }` beside `blast`/`intent`, plus an optional `reviews?: ReviewService` in `ContainerOverrides` so route tests can stub the executor. This is the sanctioned cross-slice channel — `no-cross-slice-import` scopes its `from` to `^src/modules/`, which is exactly why the composition root may import a slice's service (`server/INSIGHTS.md` 2026-08-08).
- **Skill:** `backend-onion-architecture` §13 — the slice is these five filenames and no other, or `pnpm arch` stops seeing the file; §5 — Drizzle only in `repository.ts`; §6 — Zod in `schema:`, throw `AppError` subclasses; §4 — cross-slice access via the container. `security` A01 — every query scoped by `workspaceId`; A06 — the start route carries its own rate limit; A08 — destructure, never spread. `drizzle-orm-patterns` — joins and `$inferSelect`
- **Agent:** `implementer` (impl-server)
- **Verify:** `cd server && pnpm typecheck && pnpm arch`
- **Done when:** `pnpm arch` exits 0; `rg -n "multiAgent" server/src/modules/index.ts` matches; `ls server/src/modules/multi-agent/` lists exactly `constants.ts helpers.ts repository.ts routes.ts service.ts`; and `rg -n "modules/eval" server/src/modules/multi-agent/` returns nothing

### Step 5 — Server tests
- **Files:** `server/test/multi-agent.it.test.ts`, `server/test/multi-agent-helpers.test.ts`
- **Change:** `multi-agent-helpers.test.ts` is hermetic (ring 2): `groupFindings` merges 28 with 26–30 in one file and keeps another file apart (AC-21), emits one did-not-flag stance per completed non-flagging lane with no extra field (AC-24, AC-25), collapses one agent's two findings into a single stance (edge case), ignores failed lanes entirely, and `runTotals` returns `null` duration while a lane is in flight and `null` cost when every cost is unknown (AC-31, AC-32). `multi-agent.it.test.ts` (**the `.it.` is the CI split**) covers: the record exists with all members before any completes (AC-16); a second run leaves the first retrievable (AC-18, NFR-7); a failed member keeps its status and `error` (AC-19); another workspace's run id yields 404 and discloses nothing (AC-20); `stale` flips when the pull's `head_sha` moves (AC-46); `POST` with nine agent ids is rejected (NFR-3); `POST /findings/:id/learn` records `learned_at` and it survives a re-read (AC-43). Routes go through `buildApp({ overrides })` + `app.inject()` with a stub `reviews` service, so no model is called.
- **Skill:** `backend-onion-architecture` §9 — ring 2 hermetic, ring 3 and ring 5 through the app; the `*.it.test.ts` filename is a gate, not a judgement
- **Agent:** `test-writer` (hop 5, runs after all three implementer hops and after `plan-verifier` — implementer writes no tests in this workflow)
- **Verify:** `cd server && pnpm typecheck && pnpm arch && vitest run multi-agent --no-file-parallelism`
- **Done when:** the run reports a **non-zero, non-skipped** test count. `N skipped` means Docker was unreachable and nothing was verified — that is not green (`server/INSIGHTS.md` 2026-08-02, 2026-08-17)

### Step 6 — Promote `RunTraceDrawer` to a shared component, unchanged
- **Files:** move `client/src/app/repos/[repoId]/pulls/[number]/_components/RunTraceDrawer/**` → `client/src/components/run-trace-drawer/**`; edit `client/src/app/repos/[repoId]/pulls/[number]/_components/PrDetailView/PrDetailView.tsx`
- **Change:** move the **whole folder** — `RunTraceDrawer.tsx`, `constants.ts`, `helpers.ts`, `styles.ts`, `index.ts`, `RunTraceDrawer.test.tsx` and the entire `_components/` subtree (`TraceBody`, `FindingsSection`, `PromptBlock`, `PromptModalBody`, `ToolCallRow`, `TraceSection`, `atoms.tsx`). Kebab folder, PascalCase file, per `client/INSIGHTS.md` 2026-08-16 and 2026-08-05. **Change no rendering logic, no section, no prop, no copy key** — AC-48 and the spec's §Non-goals put the drawer's content out of scope; the only permitted edits are the import specifiers the move forces and the `../../../../../../../../messages/...` depth in the moved test (`client/INSIGHTS.md` 2026-08-02: count the `../` from the file, not from a sibling). In `PrDetailView.tsx`, change line 30's import to `@/components/run-trace-drawer` and **add `running={liveRunIds.includes(traceRunId)}`** to the mount at `:266-271` — the prop exists (`RunTraceDrawer.tsx:36-45`) and the shipped caller never passed it, so a running run's trace opens on the wrong tab today; AC-50 makes passing it an obligation of every caller.
- **Skill:** `frontend-ui-architecture` §2 promotion rule and §1 placement — a second route consumer moves the folder, constants and all; §3 — no `../../../` across route trees
- **Agent:** `implementer` (impl-client-results)
- **Verify:** `cd client && pnpm typecheck && pnpm lint && vitest run run-trace-drawer`
- **Done when:** `rg -n "RunTraceDrawer" "client/src/app/repos/[repoId]/pulls/[number]/_components" -l` lists only `PrDetailView/PrDetailView.tsx` (as an `@/components/run-trace-drawer` import), and the moved test passes unmodified except for its message-import depth

### Step 7 — The data layer
- **Files:** `client/src/lib/hooks/multi-agent.ts`, `client/src/lib/hooks/index.ts`
- **Change:** four hooks over `apiFetch`, following `client/src/lib/hooks/reviews.ts` for shape and key naming:
  - `useMultiAgentRuns(prId)` → `GET /pulls/:id/multi-agent-runs`, key `["multi-agent-runs", prId]`.
  - `useMultiAgentRun(runId)` → `GET /multi-agent-runs/:id`, key `["multi-agent-run", runId]`. **`enabled` on a present id; do not set `retry: false`** — that caches a 404 forever for a resource that may not exist yet (`client/INSIGHTS.md` 2026-08-09).
  - `useAgentHistory()` → `GET /multi-agent/agent-history`, key `["multi-agent-agent-history"]`.
  - `useStartMultiAgentRun()` → `POST /pulls/:id/multi-agent-runs`; `onSuccess` invalidates `["multi-agent-runs", prId]`, `["pr-active-runs", prId]` and `["pr-runs", prId]`, or the PR page's run history silently lags.
  - Export the file from the barrel. One shallow barrel, no chaining (`frontend-ui-architecture` §7).
  - **One hook feeds both result modes** (AC-28) — do not add a second query key for Tabs, or the two panels go stale asymmetrically (`client/INSIGHTS.md` 2026-08-09).
- **Skill:** `frontend-ui-architecture` §1 data layer, §5 — no fetching in a component; the repo rule that a mutation invalidates its keys in `onSuccess`
- **Agent:** `implementer` (impl-client-results)
- **Verify:** `cd client && pnpm typecheck && pnpm lint`
- **Done when:** `rg -n "multi-agent" client/src/lib/hooks/index.ts` matches and no component in this plan calls `apiFetch` directly

### Step 8 — Copy: reconcile `runs.json` and add every new key
- **Files:** `client/messages/en/runs.json`
- **Change:** keep `viewTrace`, `conflicts.*`, `column.*`, `tabs.*`, `severity.*` and the whole `trace.*` / `drawer.*` blocks exactly as they are — they match the design and the shipped drawer. **Rewrite the four strings that state a mechanism or workflow the design has moved past** (Open question 2, root `INSIGHTS.md` 2026-08-18):
  - `page.meta:132` — drop "fan-out via p-queue"; it must not claim concurrency (AC-14, Row 12 defect B).
  - `page.runAll:130` and `page.noRun.cta` — "Run all agents" → a count-bearing string over the *selection*, with a singular form (AC-9, design row 8).
  - `page.noRun.bodyReady:140` — "Run all enabled agents on this PR…" → wording about the chosen agents.
  - `page.noAgents.body` — remove "runs the PR through every enabled agent **in parallel**". This string is not named in Open question 2 and carries the same false promise AC-14 forbids.
  Then add the keys the new screens need, all of them here so hop 3 can consume them: the estimate block (`estimate.duration`, `estimate.cost`, `estimate.unknown`, `estimate.approx`), the per-agent history card (`history.lastRun`, `history.noRuns`, `history.unknownCost`, `history.attributed`), the lane block (`lane.running`, `lane.failed`, `lane.cancelled`, `lane.queued`, `lane.noFindings`, `lane.statusAnnouncement`), the caps (`caps.findingsShown`, `caps.locationsShown` — "showing {shown} of {total}", NFR-3), the states (`state.noRun`, `state.noFindings`, `state.allFailed`, `state.needsTwoRuns`, `state.stale` — four visibly different messages, AC-27/44/45/46 and NFR-6), and the actions (`action.learn`, `action.learnRecorded` — "recorded; nothing is learned yet", AC-43; `action.evalCaseCreated`, AC-42). **Any string that reproduces model or author text is rendered with `t.raw`, not `t()`** (`client/INSIGHTS.md` 2026-08-16 — `<untrusted …>` throws `INVALID_TAG`).
- **Skill:** `frontend-ui-architecture` §1 — user-facing strings live in the catalogue, never inline
- **Agent:** `implementer` (impl-client-results)
- **Verify:** `cd client && pnpm typecheck && pnpm lint`
- **Done when:** `rg -n "p-queue|in parallel|Run all enabled agents" client/messages/en/runs.json` returns nothing

### Step 9 — The results section
- **Files:** `client/src/app/repos/[repoId]/multi-agent/_components/MultiAgentResults/{MultiAgentResults.tsx,helpers.ts,constants.ts,styles.ts,index.ts}`, `.../AgentLane/**`, `.../DisagreementPanel/**`, `.../MultiAgentFindingCard/**`
- **Change:**
  - `MultiAgentResults` — takes the resolved `MultiAgentRunResult` **plus a loading flag as props, not a run id** (`frontend-ui-architecture` §4, `client/INSIGHTS.md` 2026-08-02: a component shared by a fetching and a non-fetching caller takes data). Renders the header totals (`—` for a null duration or cost, never `0` — AC-31, AC-32, NFR-4), the staleness marker from `result.stale` (AC-46), and either the Columns grid of `AgentLane`s or the Tabs strip, driven by a `mode` prop the shell owns. **`DisagreementPanel` is rendered outside the mode switch so both modes show the identical section with the identical filter state** (AC-28).
  - `AgentLane` — the agent's recorded name as **text**, its status as **text plus icon** (never colour alone — AC-47), a `role="status"` live region announcing a settle (AC-47), the score/verdict/summary when present, up to `MAX_LANE_FINDINGS` cards with the `caps.findingsShown` line when `findings_total` exceeds them, and **a trace affordance on every lane including a failed one** (AC-30, AC-33) — a failed lane shows `error` and the trace button and renders **no findings area at all**, which is what distinguishes it from an empty successful lane (AC-45, NFR-6). The trace button calls an `onOpenTrace(runId)` prop; the lane never owns the drawer.
  - `DisagreementPanel` — the `conflicts.title` heading, the `conflicts.onlyConflicts` toggle, one row per location with `file:start_line–end_line` and one entry per completed agent: a flagged stance shows its severity **in words** (`severity.*`), a did-not-flag entry shows `conflicts.didNotFlag` **and nothing else** (AC-25). Filtering is `locations.filter(l => l.conflict)` computed during render — never `useState` + `useEffect` (`react-best-practices` §Derive-don't-store). When `completed_lane_count < 2` the panel renders `state.needsTwoRuns` instead of a list (AC-27). The location header links to the PR diff via the shipped handoff — `/repos/{repoId}/pulls/{number}?tab=diff&goto={file}:{start_line}` — which is the existing mechanic (`PrDetailView.tsx` §`goto`), so AC-39 needs no new navigation code.
  - `MultiAgentFindingCard` — severity, category, `file:line`, confidence rendered as a plain attribute (**never sorted, filtered or gated on** — AC-37, root `INSIGHTS.md` 2026-08-02), the expandable rationale, the suggestion only when one exists (AC-36), and four actions: Accept and Dismiss via `useFindingAction`, Learn via the same hook with `'learn'` showing `action.learnRecorded` (AC-43), and Turn into eval case via `useCreateEvalCaseFromFinding`, **inert with its reason until the finding is judged** (AC-41 — the rule `FindingCard.tsx:139-146` already applies) and confirming with a link to the created case (AC-42). Model-authored text is visibly attributed to its agent (spec §Untrusted inputs) and rendered through the existing `Markdown`/`t.raw` path, never as markup the interface acts on.
- **Skill:** `frontend-ui-architecture` §1 placement (route-local: one consumer), §5 business logic. `react-best-practices` — derive don't store; `{n > 0 && …}` never `{n && …}`; a stable key per location (`file:start:end`, not an array index — `client/INSIGHTS.md` 2026-08-11 records `entry.symbol` failing as a key); `aria-label` on icon-only buttons. **Demoted: do not split any of these to satisfy a 200-line limit** (`routing.md` §Demotion list)
- **Agent:** `implementer` (impl-client-results)
- **Verify:** `cd client && pnpm typecheck && pnpm lint`
- **Done when:** `rg -n "confidence" client/src/app/repos/\[repoId\]/multi-agent/_components -n` shows it only in a render position — no `sort`, `filter` or conditional keyed on it

### Step 10 — Results tests
- **Files:** `.../MultiAgentResults/MultiAgentResults.test.tsx`, `.../DisagreementPanel/DisagreementPanel.test.tsx`, `.../AgentLane/AgentLane.test.tsx`
- **Change:** flow tests over fixtures, mocking the hook module with `vi.mock` (MSW is not installed). Cover: a failed lane shows its reason, a trace affordance and no findings area (AC-33); the conflicts toggle removes a unanimous location and keeps one with a did-not-flag entry (AC-26); a did-not-flag entry carries no sentence beyond the agent name and the label (AC-25); switching mode leaves the comparison's locations, entries and toggle state identical (AC-28); an unknown cost renders an em dash and never `0` (AC-32); one completed lane renders `state.needsTwoRuns` (AC-27); a lane at the cap renders `caps.findingsShown` (NFR-3). Wrap in `NextIntlClientProvider` with the real `messages/en/runs.json`, as `BriefBar.test.tsx:12-18` does. Interactions use `userEvent.setup()` — **it is installed** (`client/package.json:31`) and new files use it (`BriefBar.test.tsx:8-10`), superseding the `client/INSIGHTS.md` 2026-08-08 index row.
- **Skill:** `react-testing-library` — `getByRole` first, `userEvent.setup()` before `render`, assert what the user sees. Note jsdom implements no `Element.prototype.scrollIntoView` (`client/INSIGHTS.md` 2026-08-09) but does implement `focus()` (2026-08-17)
- **Agent:** `test-writer` (hop 5, runs after all three implementer hops and after `plan-verifier` — implementer writes no tests in this workflow)
- **Verify:** `cd client && pnpm typecheck && pnpm lint && pnpm test`
- **Done when:** the three files pass and no test asserts on a CSS value or a hook internal

### Step 11 — Replace the PR page's review-launch control
- **Files:** `client/src/components/agent-picker/{AgentPicker.tsx,constants.ts,styles.ts,index.ts}`, `client/src/app/repos/[repoId]/pulls/[number]/_components/PrDetailHeader/PrDetailHeader.tsx`, delete `client/src/app/repos/[repoId]/pulls/[number]/_components/RunReviewDropdown/**`, `client/messages/en/prReview.json`. (`AgentPicker.test.tsx` is written later, by `test-writer` in Step 14 — not part of this step.)
- **Change:** `AgentPicker` is a **shared** component from birth — the PR header and the Configure screen are two routes (`frontend-ui-architecture` §1). It takes `agents`, `selected`, `onToggle`, `onSelectAll`, `onConfirm`, `pending`, `warnMerged` and an `onConfigure` link target: resolved data in, callbacks out, no fetching inside. It lists **every** agent with a checkbox, enabled or not (preserving the replaced control's behaviour — spec §Edge cases), keeps the run action unavailable and the count at zero while nothing is checked (AC-2), supports select-all (AC-5) and a single-agent selection (AC-4), and shows the no-agents explanation with the route to `/agents` instead of an empty list (AC-7). Its "Configure run…" item links to `/repos/{repoId}/multi-agent?pr={prId}` (AC-6). Keyboard: the checkbox list is reachable and operable by keyboard and each row is labelled in text (AC-47). In `PrDetailHeader.tsx`, swap the `RunReviewDropdown` import at `:5` and the element at `:93-98` for `AgentPicker`, calling `useAgents` and `useStartMultiAgentRun` in the header and keeping the existing `onRunStart` / `onRunsStarted` props unchanged so `PrDetailView.tsx:191-199` needs no edit. Then delete the `RunReviewDropdown` folder — **AC-1 requires exactly one launch control on the header**, so leaving it beside the new one fails the criterion. Move its still-used strings into `prReview.json` under the picker's own keys and drop `runReview.runAll`.
- **Skill:** `frontend-ui-architecture` §1 placement (2+ routes ⇒ `components/<kebab>/`), §4 — the shared component takes resolved data, not an id it fetches from. `react-best-practices` — a11y on the checkbox list, `{n > 0 && …}`
- **Agent:** `implementer` (impl-client-entry)
- **Verify:** `cd client && pnpm typecheck && pnpm lint` (no `vitest run` here — `AgentPicker.test.tsx` does not exist yet; it lands in Step 14)
- **Done when:** `rg -rn "RunReviewDropdown" client/src` returns nothing, and `rg -n "runReview.runAll" client/src client/messages` returns nothing

### Step 12 — The route: shell, search params, Configure run, and the trace mount
- **Files:** `client/src/app/repos/[repoId]/multi-agent/page.tsx`, `.../multi-agent/constants.ts`, `.../multi-agent/_components/MultiAgentView/{MultiAgentView.tsx,helpers.ts,styles.ts,index.ts}`, `.../multi-agent/_components/ConfigureRunPanel/{ConfigureRunPanel.tsx,styles.ts,index.ts}`
- **Change:**
  - `page.tsx` is a thin entry returning `<MultiAgentView />`, matching `pulls/[number]/page.tsx`. `'use client'` marks `MultiAgentView`, not the page (`frontend-ui-architecture` §9; `client/INSIGHTS.md` 2026-08-03 — a `'use client'` page becomes a server wrapper with no Suspense, so the route is dynamic either way).
  - `constants.ts` holds `VIEW_MODES = ['columns','tabs'] as const` and `DEFAULT_MODE`. **Declared once** — a second copy of the allowlist swallows every new mode (`client/INSIGHTS.md` 2026-08-16).
  - `MultiAgentView` **owns every search param on the screen** — `pr`, `run`, `mode`, `trace`, `agent` — with a single `setParams` that rebuilds one `URLSearchParams` and issues one `router.replace`, copied from `PrDetailView.tsx:73-88`. Two sequential single-param writes drop the first. This is what makes AC-38 (run + mode in the address), AC-51 (trace in the address) and AC-52 (closing the trace restores the run, the mode and the selected lane or tab, because none of them ever left the URL) fall out of one mechanism (`client/INSIGHTS.md` 2026-08-10).
  - It calls `useMultiAgentRuns(pr)` and `useMultiAgentRun(run ?? latest)`; with no `pr` it renders `ConfigureRunPanel` alone, with a `pr` and no run it renders `state.noRun` and the way to start one (AC-44), and with a run it renders `<MultiAgentResults result={…} loading={…} mode={mode} … />` (NFR-1's loading state).
  - It subscribes `useRunEvents(inFlightMemberRunIds)` and invalidates `["multi-agent-run", runId]` when a member settles, so lane headers update without a reload (AC-29). **This adds a caller of the shipped stream and no field or event kind** (spec §Non-goals).
  - It mounts `@/components/run-trace-drawer` when `?trace=` is set, passing `runId={trace}`, `agentName` and `prNumber` from the lane, **`findings={lane.findings}`** (AC-49 — a caller that forgets produces a silently empty section that reads as "this agent found nothing"), **`running={lane.status === 'running'}`** (AC-50) and `onClose={() => setParams({ trace: null })}` (AC-52). It passes nothing about the multi-agent run (AC-53).
  - `ConfigureRunPanel` — a PR chooser over `usePulls(repoId)`; the agent block is inert with its explanation until a PR is chosen (AC-8); it renders `AgentPicker` plus, per agent, the last completed run's duration, cost and truncated dated summary from `useAgentHistory()`, with unknowns shown as unknown and never as `0` (AC-10, AC-11, Open question 6); the run action stays unavailable and the count reads zero until both a PR and at least one agent are chosen (AC-9); confirming calls `useStartMultiAgentRun` and then `setParams({ run: <new id>, mode: DEFAULT_MODE })`, which opens the results (AC-15).
  - `helpers.ts` holds the **pure** estimate function: `estimate(selectedIds, history)` returns `{ durationMs: number | null, costUsd: number | null }` — duration is the **sum** of the selected agents' last durations because execution is sequential (AC-14, verified at `run-executor.ts:150-184`), cost sums only known values and is `null` when every selected agent's cost is unknown (AC-13). It is computed during render so it tracks the checkbox without a refetch (AC-12), presented as approximate (`estimate.approx`), and **no caption anywhere on the screen says "parallel"** (AC-14).
- **Skill:** `next-best-practices` `file-conventions.md` / `rsc-boundaries.md` — thin `page.tsx`, `'use client'` on the interactive view. `frontend-ui-architecture` §5 — derived values computed, not stored; §9 — HTTP-APIs is the one data model, so no raw `fetch`. `react-best-practices` — no `useEffect` for derived state, no effect chains
- **Agent:** `implementer` (impl-client-entry)
- **Verify:** `cd client && pnpm typecheck && pnpm lint`
- **Done when:** `rg -n "router.replace" client/src/app/repos/\[repoId\]/multi-agent` shows exactly one call site, and `rg -rni "parallel" client/src/app/repos/\[repoId\]/multi-agent client/messages/en/runs.json` returns nothing

### Step 13 — Register the screen in the sidebar
- **Files:** `client/src/vendor/ui/nav.ts`
- **Change:** add one `NavItemDef` to the `WORKSPACE` group — `{ key: "multi-agent", label: "Multi-Agent Review", icon: <an existing `IconName`>, href: "/repos/:repoId/multi-agent", gKey: "m" }` — and the matching `{ keys: "g m", label: "Go to Multi-Agent Review", group: "Navigation" }` in `SHORTCUTS`. `activeKeyFor` already returns `"multi-agent"` for this path (`client/src/components/app-shell/helpers.ts:28`) and needs no edit. **Two edits only, no reorganisation** — the file is vendored (`AGENTS.md` §Do not touch), and this is the SPEC-01 precedent recorded in `client/INSIGHTS.md` 2026-08-16. The icon must be a key of the **vendored registry**, not a lucide export name (`client/INSIGHTS.md` 2026-08-05).
- **Skill:** `frontend-ui-architecture` §In this repo — `src/vendor/ui/` is vendored: extend, never refactor
- **Agent:** `implementer` (impl-client-entry)
- **Verify:** `cd client && pnpm typecheck && pnpm lint`
- **Done when:** `git diff --stat client/src/vendor/ui/nav.ts` shows two added lines and no deletions

### Step 14 — Entry-point tests
- **Files:** `client/src/components/agent-picker/AgentPicker.test.tsx`, `.../multi-agent/_components/ConfigureRunPanel/ConfigureRunPanel.test.tsx`
- **Change:** the picker: nothing checked ⇒ the run action cannot be activated and the count reads zero (AC-2); select-all checks every listed agent (AC-5); one agent confirms one run (AC-4); a zero-agent workspace shows the explanation and the route (AC-7). Configure run: the agent block is inert before a PR is chosen and says why (AC-8); the run action still reads zero on first load (AC-9 — explicitly **not** a default selection); an agent with no completed run shows an unknown marker, never `0` (AC-11); the estimate for four ~8s agents reads ~32s and the screen says nothing about parallelism (AC-14); selecting only never-costed agents shows an unknown cost (AC-13).
- **Skill:** `react-testing-library` — `getByRole`, `userEvent.setup()`, assert visible text
- **Agent:** `test-writer` (hop 5, runs after all three implementer hops and after `plan-verifier` — implementer writes no tests in this workflow)
- **Verify:** `cd client && pnpm typecheck && pnpm lint && pnpm test`
- **Done when:** both files pass and the whole `client` suite is green

## Verification plan

| Package | Command | Runs when |
|---|---|---|
| server | `cd server && pnpm typecheck` | steps 1–4 (impl-server; no test step) |
| server | `cd server && pnpm arch` | steps 1–4 — exit 0 only; never widen a glob to quiet it |
| server | `cd server && vitest run multi-agent --no-file-parallelism` | step 5, run by `test-writer` after hop 1 and `plan-verifier` — read the **test count**, not the exit code |
| server | `cd server && pnpm db:generate` then `pnpm db:migrate` | step 2, once |
| — | `./scripts/check-shared-sync.sh` | steps 1 and 3 (`*/src/vendor/shared/**` changed) |
| client | `cd client && pnpm typecheck && pnpm lint` | steps 6–9, 11–13 (impl-client-results, impl-client-entry; no test step) |
| client | `cd client && pnpm typecheck && pnpm lint && pnpm test` | steps 10 and 14, run by `test-writer` after hops 2 and 3 and `plan-verifier`. `lint` is not optional: a deep relative import passes `typecheck` and only `lint` catches it (`client/INSIGHTS.md` 2026-08-05), and the rule is off in test files, so it under-reports (2026-08-03) |
| — | `./scripts/pr-self-review.sh gates` | each implementer, on its own changes, before reporting done; `test-writer` runs the equivalent test/typecheck/lint commands on its own changes |

`reviewer-core` is not touched, so its lane does not run.

## Acceptance-facing checks

Every row restates a criterion the spec already states; nothing here is new.

| Source | Settled by |
|---|---|
| AC-1 | `rg -rn "RunReviewDropdown" client/src` returns nothing; `PrDetailHeader.tsx` renders exactly one launch control |
| AC-2, AC-5, AC-4, AC-7 | `client/src/components/agent-picker/AgentPicker.test.tsx` |
| AC-8, AC-9, AC-11, AC-13, AC-14 | `.../ConfigureRunPanel/ConfigureRunPanel.test.tsx`; plus `rg -rni "parallel" client/src/app/repos/[repoId]/multi-agent client/messages/en/runs.json` returning nothing |
| AC-16, AC-18, AC-19, AC-20, AC-46 | `server/test/multi-agent.it.test.ts` |
| AC-21, AC-24, AC-25 | `server/test/multi-agent-helpers.test.ts` and `.../DisagreementPanel/DisagreementPanel.test.tsx` |
| AC-22 | `server/test/multi-agent.it.test.ts` — the PR's `GET /pulls/:id/reviews` payload is byte-identical in count and content before and after a results read |
| AC-23 | `AgentLane.agent_name` and `agent_id` on every lane and every stance (`observability.ts`, Step 1); asserted in the integration test |
| AC-26, AC-27, AC-28, AC-32, AC-33 | `.../MultiAgentResults/*.test.tsx`, `.../DisagreementPanel/*.test.tsx`, `.../AgentLane/*.test.tsx` |
| AC-31, NFR-3, NFR-4 | `runTotals` unit tests + the `caps.findingsShown` assertion |
| AC-37 | `rg -n "confidence" client/src/app/repos/[repoId]/multi-agent/_components` shows no `sort`/`filter`/gate |
| AC-38, AC-51, AC-52 | one `router.replace` call site in `MultiAgentView`, with `run`, `mode`, `trace` and `agent` all in the URL |
| AC-39 | the location header's href is `/repos/{repoId}/pulls/{number}?tab=diff&goto={file}:{line}` — the shipped handoff |
| AC-43 | `POST /findings/:id/learn` records `learned_at` and it survives a re-read (integration test) |
| AC-48 | `rg -rn "run-trace-drawer" client/src` shows exactly two consuming call sites and **one** implementation folder |
| AC-49, AC-50 | the `MultiAgentView` mount passes `findings` and `running`; asserted in `MultiAgentResults.test.tsx` |
| AC-53 | `rg -rn "multiAgent\|multi_agent" client/src/components/run-trace-drawer` returns nothing |
| NFR-5 | `groupFindings` / `isConflict` / `estimate` are pure functions with no `container`, no `llm`, no I/O; unit tests assert the same input yields the same output |
| NFR-8 | the integration test reopens a run through a fresh app instance and gets the same lanes and outcomes |

NFR-1 and NFR-2 have no automated check in this plan — see `## Risks & open questions`.

## Recommendations not taken
None — the caller accepted all four.

## Risks & open questions

- **R1 — Two sanctioned edits under `*/src/vendor/**`, which `AGENTS.md` §Do not touch otherwise forbids.** (a) The `vendor/shared/contracts` copies: mandatory and explicitly carved out by the repo's own two-copy rule. (b) One row in `client/src/vendor/ui/nav.ts`: Q5-yes, by the SPEC-01 precedent in `client/INSIGHTS.md` 2026-08-16. **Proceed on:** both, additive only, no reorganisation. Flag both to the architecture reviewer rather than letting them pass as routine.
- **R2 — `server/src/db/migrations/**` is a sentinel and this plan adds a file to it.** Adding a *generated* migration is the sanctioned path; editing any existing one is not. **Proceed on:** `pnpm db:generate` once, in Step 2, and never a hand edit. If the generator prompts interactively, stop — that means the change includes a drop it should not (`server/INSIGHTS.md` 2026-08-05).
- **R3 — Parallel worktrees may both generate a migration and collide on the sequence number.** This lab runs in several worktrees. **Proceed on:** generate late (Step 2 is early in *this* plan but the plan itself runs in one worktree); if the number collides on merge, regenerate rather than renaming by hand.
- **R4 — `container.reviews` introduces a new composition-root dependency on the reviews slice.** The precedent is four other slice services already constructed there (`container.ts:136,151,164,181`) and `server/INSIGHTS.md` 2026-08-08 explains why the gate permits it. **Proceed on:** the lazy getter. If `pnpm arch` reports `no-circular` against it, the fallback is to move `start()`'s executor call behind a narrow port on `container` rather than adding a `pathNot`.
- **R5 — NFR-1 (2s for 8 agents × 200 findings) and NFR-2 (3s to return the run) have no harness.** Nothing in the repo measures either. **Proceed on:** the structural obligations only — a loading state rather than a blank area, and a start path that returns before the executor runs (which it does: `runReview` is fire-and-forget at `service.ts:135-139`). Worth capturing with `engineering-insights`: this repo has no latency assertion of any kind, so every NFR of this shape is unverifiable by construction.
- **R6 — `client/INSIGHTS.md`'s index row for 2026-08-08 is stale** ("`user-event` is NOT installed"); the package is at `client/package.json:31` and new tests use it. **Proceed on:** `userEvent` in all new tests. Worth capturing with `engineering-insights`: the index row should be superseded, since the index is the part agents actually read (root `INSIGHTS.md` 2026-08-16).
- **R7 — AC-45 versus AC-44 versus NFR-6 is a three-state distinction that is easy to collapse in code.** "No run yet", "all agents failed", and "the agents found nothing" must produce three visibly different messages. **Proceed on:** three separate catalogue keys (`state.noRun`, `state.allFailed`, `state.noFindings`) and a test asserting all three, rather than one conditional with a shared fallback.
- **R8 — Deleting `RunReviewDropdown` is irreversible within the change.** AC-1 requires it, but if the picker regresses, the PR page has no launch control at all. **Proceed on:** Step 11 lands the picker and the deletion in the same step, with `AgentPicker.test.tsx` green before the folder is removed.
- **R9 — `AgentStats` stays a contract with no route.** Per-Agent Stats screens are a spec non-goal; US-7's only obligation is that attribution is not lost, which `AgentLane.agent_id`/`agent_name` and `LocationStance` satisfy. **Proceed on:** no stats endpoint. Flag if a reviewer reads US-7 as requiring one.

## Out of scope

- **`ci/`, `agent-runner/`, `reviewer-core/`** — untouched, per spec §Non-goals and the worktree boundary. Nobody picks these up in this change.
- **Making the executor concurrent.** `run-executor.ts` stays a sequential `for … await`. AC-14 is written *because* of that, and flipping it is a separate feature that must land first (Open question 1).
- **The finding-matching rule itself.** `modules/eval/helpers.ts` is read and its `overlaps` duplicated; the file is not edited and the rule is not tuned (Open question 5).
- **The trace surface's content.** No new section, field, cap or copy key inside `run-trace-drawer/**` or `TraceBody`. Membership back-links, sibling-agent stepping and a dropped-findings list are all declined by Open question 7 — and (c) needs `reviewer-core` to record drops before any UI can show them.
- **The SSE stream's shape.** This feature adds a caller of `GET /runs/:id/events`; it adds no event kind and no field.
- **"Reply to author."** No route, no button (Open question 4).
- **Memory learning.** Step 3 records the intent; the mechanics behind it are a later feature (spec §Non-goals).
- **Per-agent retry inside an existing multi-agent run.** Re-running is a new multi-agent review (Open question 3).
- **Per-Agent Stats screens** and any `/agents/:id/stats` route.
- **The Compose Review drawer** — a separate shipped surface, not renamed, wrapped or reworked.
- **The PR findings panel's "Hide low confidence" control** — a pre-existing tension the spec explicitly declines to inherit or fix (Row 12 defect C).
- **`FindingCard` on the PR page** — not refactored to share with `MultiAgentFindingCard`. Two copies is the correct state at two consumers (`frontend-ui-architecture` §2); a third would justify promotion.
- **Documentation** — `doc-writer` (hop 7) writes `docs/multi-agent-review.md` and its `AGENTS.md` §Read when row after the code lands.

## Handoff

For the **architecture reviewer**: a new server slice `modules/multi-agent/` and its registration in `modules/index.ts`; a new composition-root getter `container.reviews`, which is a new root-level dependency on the reviews slice; a duplicated pure helper (`overlaps`) with a docblock naming its original — the alternative was a `no-cross-slice-import` violation; a cross-route component promotion (`RunTraceDrawer` → `client/src/components/run-trace-drawer/`) and a second, born-shared component (`agent-picker`); one new client route owning five search params; and two edits under `*/src/vendor/**` (R1) that are deliberate, not drive-by.

For the **security review**: one new `POST` route that fans out to paid model calls, with its own rate limit and an 8-agent cap; four new routes each scoped by `workspaceId` from `getContext`, one of which (`GET /multi-agent-runs/:id`) is a direct-object read where a missing workspace predicate would be a cross-tenant disclosure (AC-20); a new write path recording a user judgement on a finding (`POST /findings/:id/learn`); and four categories of untrusted content newly rendered on two screens — PR title/body, the diff, model-authored finding text, and the model's raw output inside the reused trace drawer (spec §Untrusted inputs). No new secret, no new outbound call, no new migration beyond the one generated in Step 2.
