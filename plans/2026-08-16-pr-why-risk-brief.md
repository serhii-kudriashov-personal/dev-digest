# PR Why + Risk Brief (SPEC-02) — implementation plan

## Task

Build a reviewer-facing "PR Brief" card on the pull-request Overview tab: one bounded, cached, on-demand model call that turns the PR's identity, derived intent (L03), blast radius (L06), findings, linked issue and linked specs into a what/why statement, a high|medium|low risk level, up to five validated risks and up to five "read this first" entries that navigate into the reviewer-ordered diff (L04).

## Requirements source

`specs/2026-08-16-pr-why-risk-brief.md` (SPEC-02) — AC-1…AC-45, NFR-1…NFR-8, §Inputs and provenance, §Contract promises, §Untrusted inputs, §Open questions 1–6.

This plan implements those requirements and does not amend them. Where it decides something, it is because the spec explicitly delegated it (§Non-goals: "**The transport surface** … is the implementation plan's call"; §Contract promises: "Reconciling the two is the implementation plan's problem"; Open questions 1–4).

**One deviation from the spec is deliberate and user-authorised** — see `## Answers taken` item 4 and `## Scope decision: AC-32 changes shipped L04/L06 behaviour`. It is called out there rather than buried, because the spec's §Non-goals says "Changing L03, L04 or L06" is out of scope and this plan changes L04/L06 navigation behaviour.

## Answers taken

The caller resolved all five intake questions on 2026-08-16:

1. **Transport** — `GET /pulls/:id/brief` + `POST /pulls/:id/brief` with `{ force?: boolean }`, mirroring L03 (`server/src/modules/intent/routes.ts:27-52`). *(planner default, accepted)*
2. **Contract shape** — a new `PrRiskBriefRecord` in `contracts/review-api.ts`. Vendored `contracts/brief.ts` — including `PrBrief` and `PrHistory` — stays untouched, in **both** vendor copies. *(planner default, accepted)*
3. **Storage** — all provenance (head commit, generated-at, provider, model, cost) lives inside the **existing** `pr_brief.json` jsonb column. **No migration, no schema edit.** *(planner default, accepted)*
4. **AC-32 focus — OVERRIDE of the planner's recommendation.** Extend `useDiffLineTarget`'s existing scroll behaviour to **also set focus, for every consumer** (L04's findings badge and L06's caller rows included), rather than an opt-in flag scoped to the brief. The caller acknowledges this is a change to shipped L04/L06 navigation behaviour despite the spec's non-goal, and requires it stated explicitly with before/after so later reviewers can see it. *(see `## Scope decision` below)*
5. **NFR-4 rate limit** — a route-level `keyGenerator` keyed on the PR id (`brief:${prId}`), `max: 3`, `timeWindow: '1 minute'`, with the `NODE_ENV=test` caveat recorded. *(planner default, accepted)*

**Execution mode:** not treated as a blocking question, per the caller. The planner's multi-agent recommendation is recorded as `## Appendix — suggested execution` for whoever runs this later. `## Steps` is written so it reads correctly as a single ordered list either way.

## Context read

- root `INSIGHTS.md` (2026-08-02, "A field added to a persisted-jsonb contract must be `.nullish()`") — the brief document is jsonb-persisted; **binds every future field**, and is why `## Constraints that bind` carries a standing rule rather than a step.
- root `INSIGHTS.md` (2026-08-11, "A REQUIRED new field on a jsonb-persisted contract goes on a sibling response schema") — the reason `PrRiskBriefRecord` is a **new sibling** in `review-api.ts` rather than an extension of `PrBrief`. Same reasoning `docs/blast-radius.md:100-104` records for `BlastRadiusResponse`.
- root `INSIGHTS.md` (2026-08-02, "Unknown cost is `null`, never `0`") — AC-40. `cost_usd` is `.nullable()` on the wire and the card renders "unknown".
- root `INSIGHTS.md` (2026-08-02, "`findings.confidence` is not calibrated — never gate on it") — AC-10 and AC-25. Confidence never enters the model input, the document or the card.
- root `INSIGHTS.md` (2026-08-05, "A skill body must NOT be `wrapUntrusted`-wrapped") — only the six author-controlled sources are wrapped; the instruction text is not.
- root `INSIGHTS.md` (2026-08-16, "Shipped-but-unwired scaffolding also ships a stale product decision") — the two stale strings in `client/messages/en/brief.json:11-13` are a claim, not a requirement. New keys are written fresh; the old ones are neither reused nor deleted (Open Q2).
- root `INSIGHTS.md` (2026-08-05, "A lesson feature is mostly already scaffolded") — borne out: the `pr_brief` table, the `risk_brief` model slot, the `?goto=` navigation and the collapsed-group expansion all already exist. See `## Inventory`.
- `server/INSIGHTS.md` (2026-08-10, "A prompt that summarises user text must state its OUTPUT LANGUAGE") — AC-16 is one line in `BRIEF_SYSTEM`, not a post-hoc check.
- `server/INSIGHTS.md` (2026-08-05, "A non-review caller of `assemblePrompt` must use the `diff` slot, and will be mislabelled") — the assembled blocks go in the `diff` slot because it is the only unconditional `wrapUntrusted`-wrapped slot. The trace will label them "Diff". Accepted, same as L03.
- `server/INSIGHTS.md` (2026-08-08, "`no-cross-slice-import` scopes its `from` to `^src/modules/` — which is why the container may import a slice's service") — **load-bearing for this plan.** It is what makes Step 3 (`container.blast`, `container.intent`) legal instead of a violation.
- `server/INSIGHTS.md` (2026-08-09, "`normalizePath` strips `a/` and `b/`, so a real top-level directory with either name breaks") — AC-17 inherits this sharp edge verbatim. Not worked around; recorded.
- `server/INSIGHTS.md` (2026-08-11, "`repo_index_state.status='partial'` does NOT mean a working index") — AC-36's "incomplete" comes from `BlastRadiusResponse.state`/`.reason`, never from an empty `downstream` array.
- `server/INSIGHTS.md` (2026-08-05, "`pnpm test` is red here for an environmental reason: 8 files start 8 Postgres containers at once") and (2026-08-02, "A SKIPPING integration suite silently reads as passing") — the verification plan runs the new `*.it.test.ts` **by name**, and the `Done when` reads the test count, not the exit code.
- `client/INSIGHTS.md` (2026-08-09, "A `retry: false` query for a resource that does not exist YET caches the 404 forever") — closes Open Q3: `usePrBrief` carries `retry: false` and the POST writes the result straight into the cache with `setQueryData`, exactly as `useDeriveIntent` does.
- `client/INSIGHTS.md` (2026-08-09, "Two panels of one screen reading two query keys go stale ASYMMETRICALLY") — AC-34/AC-35. `stale` is computed by the server on read **and** recomputed during render from `headSha`, the same belt-and-braces `OverviewTab.tsx:38-42` already uses for intent.
- `client/INSIGHTS.md` (2026-08-09, "jsdom implements NO `Element.prototype.scrollIntoView`") and (2026-08-10, "jsdom 25 implements no `window.CSS` at all") — both bite the `useDiffLineTarget` change in Step 10.
- `client/INSIGHTS.md` (2026-08-08, "`@testing-library/user-event` is NOT installed here") — every interactive client test uses `fireEvent`.
- `client/INSIGHTS.md` (2026-08-16, "A message reproducing engine output goes through `t.raw`, not `t()`") — relevant to AC-45: model-authored text is rendered as **data** (a plain `{value}` in JSX), never through the message catalogue at all.
- `AGENTS.md` §Repo rules — `@devdigest/shared` exists twice; migrations never on boot; `*.it.test.ts` naming; English-only Markdown.
- `AGENTS.md` §Do not touch — `server/src/db/migrations/**`, `reviewer-core/src/grounding.ts`, `INJECTION_GUARD`, `*/src/vendor/**` (extend, never reorganise), empty reserved tables.
- `docs/intent-layer.md`, `docs/blast-radius.md` (`:65-104` state truth table, `:176-204` navigation, `:241-242` `PrHistory`/`pr_brief` reserved), `docs/smart-diff.md` (`:82-92` path normalization, `:154-181` collapsed group + repeat-click `seq`).
- `specs/README.md` — this document is a **plan**, not a spec; it carries no requirements of its own.

**Contradicts (one).** `docs/blast-radius.md:241-242` states "`PrHistory` stays unused, and **`pr_brief` stays empty** — both are reserved for a later lesson", and `server/src/modules/blast/service.ts:31` says the same in a docblock. **This plan makes `pr_brief` the brief's storage**, so both prose claims become false the moment Step 5 lands. `PrHistory` genuinely stays unused. Step 12 corrects both sentences; nothing else in either document changes.

## Inventory — what already exists

| Thing | Where | Verdict |
|---|---|---|
| `pr_brief` table (`pr_id` PK → `pull_requests` cascade, `json` jsonb notNull) | `server/src/db/schema/reviews.ts:122-127`; DDL `server/src/db/migrations/0000_init.sql:211-214` | **reuse** — no migration |
| `risk_brief` feature-model slot, default `openai` / `gpt-4.1` | `server/src/vendor/shared/contracts/platform.ts:63-69` | **reuse** unchanged (Open Q4) |
| `resolveFeatureModel(container, workspaceId, 'risk_brief')` | `server/src/modules/settings/feature-models.ts:50-56` | **reuse** |
| `cl100k_base` counter + `ceil(chars/4)` fallback, behind the `Tokenizer` port | `server/src/adapters/tokenizer/index.ts:14-40`; `container.tokenizer` at `server/src/platform/container.ts:174-177`; test seam `ContainerOverrides.tokenizer` at `:62` | **reuse** (AC-11, AC-12) |
| `assemblePrompt` + `completeStructured` single-call pipeline | `server/src/modules/intent/pipeline.ts:161-197` | **reuse as template** |
| `BlastService.build(workspaceId, prId)` → `BlastRadiusResponse` with `state`/`reason` | `server/src/modules/blast/service.ts:44-110` | **reuse** via a new container getter |
| `IntentService.get(workspaceId, prId)` → `DerivedIntent \| null`, carrying a pre-rendered `promptBlock` | `server/src/modules/intent/service.ts:41-47,154-158` | **reuse** via a new container getter |
| `container.reviewRepo` — `getPull`, `getPrFiles`, `reviewsForPull` | `server/src/platform/container.ts:115-117`; `server/src/modules/reviews/repository.ts:30,38,79` | **reuse** (findings input, AC-35) |
| `PATH_PREFIX_PATTERN` (`/^(\.\/\|a\/\|b\/)+/`) — a slice **public** surface | `server/src/modules/smart-diff/constants.ts:94` | **reuse** (AC-17) |
| `normalizePath`, `hunkHeaders`, `linkedIssueNumbers`, `linkedSpecPaths` | `smart-diff/helpers.ts:45`, `intent/helpers.ts` | **not importable** — `helpers.ts` is slice-private (`server/.dependency-cruiser.cjs:65,128-139`). See `## Risks` R1 |
| Workspace-scoped "not found" pattern (`getContext` → scoped lookup → `NotFoundError`) | `server/src/modules/intent/routes.ts:27-32`; `server/src/modules/blast/service.ts:38-46` | **reuse** (AC-6) |
| Discriminated-union response with states-not-errors (`ContextListing`) | `server/src/vendor/shared/contracts/platform.ts:309-325` | **reuse as template** for the generation result |
| `?goto=<path>:<line>` handoff — one `router.replace`, consumed and cleared by `DiffTab` | `PrDetailView.tsx:202-207,248-249`; `DiffTab.tsx:84,94-109`; `OverviewTab.tsx:23,62` | **reuse** — AC-30 is already satisfied |
| Collapsed-group expansion on navigate (`goTo` forces `openByPath[path]=true`, overriding the boilerplate default) | `useDiffLineTarget.ts:58-61`; `SmartDiffViewer.tsx:95-96,133-135` | **already-done** — AC-31 needs a test, not code |
| Focus placement after navigation | — | **new** — `useDiffLineTarget.ts:43-51` calls `scrollIntoView` only; `rg -n "focus\(" client/src/components/diff-viewer/` finds none |
| Single-flight / in-flight de-duplication | — | **new** — `rg -n "inFlight\|Map<string, Promise" server/src` returns only unrelated prose in `sse.ts`, `app.ts`, `reviews/` |
| Secret redaction helper | — | **new** — `rg -n redact -i server/src client/src reviewer-core/src` returns **zero** hits; the only secret-shape list in the repo is prose inside a seeded agent prompt (`server/src/db/seed-skills.ts:84`) |
| `OverviewTab` renders `IntentCard`, `BlastRadiusCard`, description — cards take **resolved data + flags**, never a `prId` | `OverviewTab.tsx:34-70`; `IntentCard.tsx:20-26` | **extend** — third card, same contract |
| `client/messages/en/brief.json` | `client/messages/en/brief.json` | **extend** — new `riskBrief` namespace; lines 11-13 left as-is (Open Q2) |
| `client/src/lib/hooks/intent.ts` — `useQuery` + `useMutation` with `setQueryData` on success | `client/src/lib/hooks/intent.ts:16-37` | **reuse as template** for `hooks/brief.ts` |

## Constraints that bind

| Rule | Applies? | What the implementation must do |
|---|---|---|
| `@devdigest/shared` exists twice | **yes** | Every edit to `server/src/vendor/shared/contracts/review-api.ts` is mirrored into `client/src/vendor/shared/contracts/review-api.ts` **in the same step**. Gate: `./scripts/check-shared-sync.sh`. Verify by diffing **only that file**, comments stripped — never `diff -r` (root `INSIGHTS.md` 2026-08-01) |
| jsonb-persisted contract field | **yes** | `pr_brief.json` holds `StoredRiskBrief`. Fields required **now** are legal (zero documents on disk — verify with `SELECT count(*) FROM pr_brief`), but every field added **later** must be `.nullish()`, never `.nullable()`. `cost_usd` is `.nullable()` from the start because unknown-vs-zero is a product promise (AC-40), not an absence |
| DB-backed test naming | **yes** | `server/test/brief.it.test.ts` — the filename is the CI split |
| migration | **no** | Decision 3: everything goes in the existing `json` column. **No `pnpm db:generate`, no edit to `db/schema/reviews.ts`.** `pr_id` is already the PK and every read is `WHERE pr_id = $1`, so no index is owed either (same reasoning as `prIntent`, `reviews.ts:96-97`) |
| ring / import direction | **yes** | New slice `modules/brief/`: `routes.ts` (ring 5, Zod + HTTP only) → `service.ts` (ring 2, reads `container.<port>`, **never** `container.db`) → `repository.ts` (ring 3, the only file importing Drizzle). `pipeline.ts` and `helpers.ts` are ring 2 and take rows as parameters. Enforced by `cd server && pnpm arch` — which root `INSIGHTS.md` (2026-08-02) records as **not wired into CI**, so it must be run by hand |
| cross-slice access | **yes** | `brief/` may **not** import `modules/blast/**` or `modules/intent/**`. The container is the sanctioned channel and may itself import a slice's service (`server/INSIGHTS.md` 2026-08-08). Hence `container.blast` and `container.intent` in Step 3 |
| `reviewer-core` | **no** | Nothing here is added to the engine. It is consumed read-only via `assemblePrompt` from `@devdigest/reviewer-core`. `grounding.ts` and `INJECTION_GUARD` are untouched |
| new file placement in `client/` | **yes** | `BriefCard` is used by one route → `src/app/repos/[repoId]/pulls/[number]/_components/BriefCard/` (`frontend-ui-architecture` §1). Its `styles.ts`/`constants.ts`/test sit beside it (§2). The hook goes in `src/lib/hooks/brief.ts` — the data layer, never a component (§1, §5) |
| a secret | **no new one** | The model key is resolved by `container.llm(provider)` through `SecretsProvider` as today. Nothing is read from `AppConfig` or the DB. **But** AC-24 introduces secret *detection over untrusted text*, which is a security surface — see `## Handoff` |
| any `CLAUDE.md` / `AGENTS.md` | **yes, one** | Step 12 adds a `docs/pr-risk-brief.md` row to root `AGENTS.md` §Read when. Edit `AGENTS.md`; `CLAUDE.md` stays a symlink (mode `120000`) |
| empty reserved tables | **yes** | `pr_brief` stops being empty — that is the point of the feature and it is authorised by the spec. `ci_*`, `eval_*`, `memory`, `digests`, `onboarding` are **not** touched. `PrHistory` stays unfed and unrendered (spec §Non-goals) |
| a new rule in an agent `system_prompt` | **no** | This feature adds **no** rule to any DevDigest agent's `system_prompt`. `BRIEF_SYSTEM` is this feature's own prompt constant, not an edit to `agents.system_prompt`. Root `INSIGHTS.md` (2026-08-02) — stacking convention blocks made reviews worse — does not bite, and `docs/agent-prompts/**` is untouched |

## Modules touched

| Package | Path | Ring / layer | Why |
|---|---|---|---|
| server | `src/vendor/shared/contracts/review-api.ts` | 0 · contracts | `PrRiskBriefRecord`, `BriefGenerationResult`, and the model's structured-answer schema |
| client | `src/vendor/shared/contracts/review-api.ts` | 0 · contracts (MANUAL copy) | same edit, same step |
| server | `src/modules/brief/constants.ts` | 2 · application | budget, caps, drop order, prompt text |
| server | `src/modules/brief/helpers.ts` | 2 · application | pure validation, redaction, ranges, caps |
| server | `src/modules/brief/pipeline.ts` | 2 · application | block assembly, budget fitting, the one model call |
| server | `src/modules/brief/service.ts` | 2 · application | cache/force/single-flight, staleness, orchestration |
| server | `src/modules/brief/repository.ts` | 3 · infrastructure | the only Drizzle in the slice — `pr_brief` read/upsert |
| server | `src/modules/brief/routes.ts` | 5 · delivery | `GET`/`POST /pulls/:id/brief`, Zod, rate limit |
| server | `src/modules/index.ts` | 5 · delivery | static registration (one import, one entry) |
| server | `src/platform/container.ts` | 4 · composition root | lazy `blast` and `intent` getters |
| server | `src/adapters/tokenizer/index.ts` | 3 · infrastructure | **docblock only** — its stated scope is falsified by a second consumer |
| server | `test/brief-helpers.test.ts`, `test/brief.it.test.ts` | outside the rings | ring-2 pure and ring-3/5 integration |
| client | `src/lib/hooks/brief.ts` | data layer | `usePrBrief`, `useGenerateBrief` |
| client | `src/app/.../_components/BriefCard/**` | route-local component | the card and its states |
| client | `src/app/.../_components/OverviewTab/OverviewTab.tsx` | route-local component | mounts the card, owns the query |
| client | `src/components/diff-viewer/useDiffLineTarget.ts`, `helpers.ts`, `FileCard/**` | shared module | AC-32 focus — **the authorised L04/L06 behaviour change** |
| client | `messages/en/brief.json` | i18n catalogue | new `riskBrief` namespace |
| docs | `docs/pr-risk-brief.md`, `docs/blast-radius.md`, `AGENTS.md` | — | the feature doc, and the two false prose claims |

## Skills — read by the planner, to be loaded by the executor

| Path glob | Skill | Sections | routing.md row | Rule it imposes on this plan |
|---|---|---|---|---|
| `server/src/modules/brief/**` | `backend-onion-architecture` **(preloaded)** | §1 rings, §4 composition root, §5 repositories, §8 placement | `routing.md:34` | Drizzle only in `repository.ts`; the service reads `container.<port>` and **never** `container.db`; cross-slice reads go through the container, so `container.blast`/`container.intent` are the only legal route to L06/L03 data |
| `server/src/modules/brief/routes.ts` | `backend-onion-architecture` **(preloaded)** | §6 the Fastify edge | `routing.md:27` | Validation lives in `schema:`, not a hand-rolled `parse`; throw `NotFoundError`, never `reply.code(...)`; registration is static in `modules/index.ts` |
| same | `fastify-best-practices` | `rules/routes.md`, `rules/schemas.md`, `rules/error-handling.md` | `routing.md:28` | Schema-first: declare `params`/`body` and let Fastify reject with 422 before the handler runs. Per-route config (including the rate-limit `keyGenerator`) belongs on the route options object, not in the handler |
| same | `security` | A01 access control, A06 insecure design, A09 logging, §Secret Detection, §Agentic AI | `routing.md:29` | A01: `:id` alone would be an IDOR — authorization is `getContext` → workspace-scoped lookup (AC-6). A06: "AI generation — **3 req / 1 min**", which is exactly NFR-4, plus "sanitize AI output before storing" and "set request timeouts" (NFR-2). §Secret Detection supplies the shapes for AC-24 (`AKIA[0-9A-Z]{16}`, `AIza[0-9A-Za-z_-]{35}`, `gh[ps]_[A-Za-z0-9]{36,}`, `npm_[A-Za-z0-9]{36}`, `xox[bpsa]-…`, `-----BEGIN .* PRIVATE KEY-----`, the generic `(secret|key|token|password)\s*[:=]\s*['"][^'"]{8,}`, and the `mongodb(+srv)?://…` URI form). A09: "Never log … API keys"; redact before logging. §Agentic AI ASI09: "**Label AI-generated content**" = AC-41 |
| `server/src/modules/brief/repository.ts` | `backend-onion-architecture` **(preloaded)** | §5 | `routing.md:30` | Constructor takes `Db`, not `Container`; nothing Drizzle-shaped crosses the boundary — rows and DTOs out only |
| same | `drizzle-orm-patterns` | queries, upsert | `routing.md:31` | **Routed but not opened by the planner.** The in-repo precedent `upsertIntent` (`intent/repository.ts:142-160`, `insert().values().onConflictDoUpdate({ target, set })`) is the shape to copy; the executor should load the skill before deviating from it |
| `*/src/vendor/shared/contracts/review-api.ts` | `zod` | `object-discriminated-unions`, `object-optional-vs-nullable`, `parse-use-safeparse`, `type-export-schemas-and-types`, `schema-use-enums` | `routing.md:63-64` | The generation result is a **discriminated union** on `state`, so the card narrows instead of guessing — the same shape `ContextListing` already uses (`platform.ts:309-325`). `optional()` ≠ `nullable()`: on this jsonb-persisted document a later field must be `.nullish()`. Every stored document is read back with `safeParse`, never `parse` — a document this feature did not write must degrade to "no brief", not throw. Export both the schema and the inferred type |
| `client/src/app/**/_components/BriefCard/*.tsx`, `OverviewTab.tsx` | `frontend-ui-architecture` **(preloaded)** | §1 placement, §2 promotion, §4 data boundary, §5 business-logic placement | `routing.md:14` | One route uses it → route-local `_components/BriefCard/`. The card takes **resolved data plus flags**, never a `prId` it fetches from. `stale` is derived during render, never stored in state and never synced by an Effect |
| `client/src/components/diff-viewer/**` | `frontend-ui-architecture` **(preloaded)** | §2 promotion, §3 module boundaries, §7 barrels | `routing.md:14` | `useDiffLineTarget` is already a promoted shared module with two consumers; the third consumer joins it rather than forking a copy. Import the sibling file directly inside the module — never through its own barrel |
| `client/src/lib/hooks/brief.ts` | `frontend-ui-architecture` **(preloaded)** | §1 data layer, §In this repo | `routing.md:19` | A new endpoint means a new hook in the matching domain file, through `api`/`apiFetch`. A mutation must settle its query key in `onSuccess` |
| `client/src/**/*.test.tsx` | `react-testing-library` | query priority, async | `routing.md:18` | **Routed but not opened by the planner.** The executor must load it — and must also honour `client/INSIGHTS.md` (2026-08-08): `@testing-library/user-event` is **not installed here**, so every interactive test uses `fireEvent` |
| `client/src/app/**/*.tsx` | `react-best-practices` | anti-patterns, hooks rules | `routing.md:15` | **Routed but not opened by the planner.** Note the demotion list in `routing.md:107-116` — "max 200 lines per component" and container/presentational are **never blocking** here |
| `server/test/**` | `backend-onion-architecture` **(preloaded)** | §9 testing per ring | `routing.md:38` | Ring 2 through `ContainerOverrides` + `adapters/mocks.ts`; ring 3 only in `*.it.test.ts`; ring 5 through `buildApp({ overrides })` + `app.inject()`. **Read the test count, not the exit code** |
| `server/src/adapters/tokenizer/index.ts` | `backend-onion-architecture` **(preloaded)** | §3 ports | `routing.md:35` | Docblock-only edit; the port and its `ContainerOverrides` seam are unchanged |

`postgresql-table-design` and `next-best-practices` matched **no** row for this change — there is no schema edit and no `layout`/`page`/`route` file touched. They must not be opened.

## Scope decision: AC-32 changes shipped L04/L06 behaviour

**This is a deliberate, user-authorised deviation from the spec's §Non-goals ("Changing L03, L04 or L06").** It is recorded here in full so a later reviewer sees the decision rather than rediscovering the behaviour change.

The planner recommended an opt-in flag so only the brief's entries would move focus. **The caller overrode that** and chose to change `useDiffLineTarget` for every consumer. Concretely:

| | Before | After |
|---|---|---|
| **Mechanism** | `goTo(path, line)` sets `openByPath[path] = true` and `setTarget({path, line, seq})`; one Effect calls `document.getElementById(lineAnchorId(path, line))?.scrollIntoView({behavior:'smooth', block:'center'})` (`useDiffLineTarget.ts:43-61`) | identical, plus the same Effect calls `document.getElementById(fileHeadingId(path))?.focus({ preventScroll: true })` |
| **L04 — findings badge** (`SmartDiffViewer.tsx:97`, `onGoToFinding={lineTarget.goTo}`) | Clicking "N findings" scrolls the diff. **Keyboard focus stays on the badge button.** Tabbing continues from the badge, i.e. from above the diff | Focus **moves into the diff**, onto the target file card's heading. The next Tab continues from inside the diff. A keyboard user loses their place in the file list |
| **L06 — caller rows** (`?goto=` → `DiffTab.tsx:94-109`) | Cross-tab navigation scrolls the diff. Focus is wherever the tab switch left it — in practice the document body | Focus moves onto the target file's heading. This now happens on a **URL-driven** navigation, including a browser back/forward that re-supplies `?goto=` |
| **Blast Radius rows that link to GitHub** | unaffected | unaffected — those are anchors, not `goTo` calls |

Why it is defensible: focus following a programmatic scroll is the accessible behaviour in all three cases, and the current L04/L06 behaviour (scroll the viewport, leave focus behind) is a latent accessibility defect rather than a designed choice. Why it still needs flagging: it is a behaviour change to two shipped lessons, made outside their specs, and neither L04's nor L06's tests assert focus today — so nothing would have caught it.

Two mechanical consequences the implementation must handle:

- `focus()` on an element with `tabIndex={-1}` scrolls it into view in several browsers, which fights `scrollIntoView({block:'center'})`. Use `focus({ preventScroll: true })`, and order the calls scroll-then-focus.
- The file card's heading is not currently focusable. It needs `tabIndex={-1}` and a stable id from a new `fileHeadingId(path)` beside `lineAnchorId` in `client/src/components/diff-viewer/helpers.ts`.

## Execution

One ordered list, Steps 1–12, in dependency order: contracts → container → server slice → routes → server tests → client contract-consumers → card → navigation → docs. Contracts precede consumers; the container getters precede the service that reads them; the server precedes the client. A suggested multi-agent split is in `## Appendix — suggested execution` and is advisory only.

## Steps

### Step 1 — Declare the brief contracts in ring 0, in both vendor copies

- **Files:** `server/src/vendor/shared/contracts/review-api.ts`, `client/src/vendor/shared/contracts/review-api.ts`
- **Change:** append (do not reorganise — `vendor/**` is extend-only) to the **canon** first, then mirror byte-for-byte into the client copy in this same step:
  - `BriefRiskLevel = z.enum(['high','medium','low'])` — AC-25. There is deliberately **no** numeric score field anywhere in this contract.
  - `BriefInputLabel = z.enum(['pr_identity','derived_intent','blast_radius','findings','linked_issue','linked_spec'])` — AC-7's closed set of six.
  - `BriefRisk = z.object({ title, explanation, severity: BriefRiskLevel, file_refs: z.array(z.string()), endpoint_refs: z.array(z.string()) })`.
  - `BriefFocus = z.object({ path: z.string(), line: z.number().int(), reason: z.string() })`.
  - `BriefAnswer = z.object({ what, why, risk_level: BriefRiskLevel, risks: z.array(BriefRisk), review_focus: z.array(BriefFocus) })` — **the model's structured-output schema**. Use `.describe()` on `what`, `why` and `BriefFocus.line` to carry the instruction into the JSON Schema rather than stacking another prose block into the system prompt (root `INSIGHTS.md` 2026-08-05).
  - `StoredRiskBrief` — what lands in `pr_brief.json`: `BriefAnswer` fields plus `head_sha`, `generated_at`, `provider`, `model`, `cost_usd: z.number().nullable()`, `input_tokens: z.number().int()`, `tokens_estimated: z.boolean()`, `included_inputs: z.array(BriefInputLabel)`, `missing_inputs: z.array(BriefInputLabel)`, `dropped_refs: z.number().int()`, `index_complete: z.boolean()`, `index_reason: z.string().nullish()`.
  - `PrRiskBriefRecord = StoredRiskBrief.extend({ pr_id: z.string(), stale: z.boolean() })` — **`stale` is on the record, never on `StoredRiskBrief`.** It is a read-time comparison, not a property of the row; storing it would read as "not stale" to the next caller. This mirrors `StoredIntent = Omit<PrIntentRecord,'stale'>` exactly (`intent/repository.ts:56-64`).
  - `BriefGenerationResult = z.discriminatedUnion('state', [ {state:'ok', brief: PrRiskBriefRecord}, {state:'too_large', identity_tokens, budget}, {state:'failed', reason: z.enum(['provider_error','unusable_answer'])}, {state:'not_configured'} ])` — AC-15, AC-22, AC-38, AC-39 as **states answered 200**, not HTTP errors, following `ContextListing` (`platform.ts:309-325`).
- **Skill:** `zod` §`object-discriminated-unions` (narrowing at the card), §`object-optional-vs-nullable` (`cost_usd` is `.nullable()` because unknown is a **value**, not an absence — root `INSIGHTS.md` 2026-08-02), §`type-export-schemas-and-types`. Plus `AGENTS.md` §Repo rules — canon then manual copy, same step.
- **Verify:** `./scripts/check-shared-sync.sh` && `cd server && pnpm typecheck` && `cd client && pnpm typecheck`
- **Done when:** `check-shared-sync.sh` exits 0, both typechecks pass, and `rg -n "score" server/src/vendor/shared/contracts/review-api.ts` shows no numeric field on any `Brief*` schema (AC-25).

### Step 2 — Constants: budget, caps, drop order, prompt

- **Files:** `server/src/modules/brief/constants.ts` (new)
- **Change:** `BRIEF_TOKEN_BUDGET = 8000` (NFR-3), `BRIEF_MAX_IDENTITY_PATHS = 50` (AC-14), `BRIEF_MAX_RISKS = 5`, `BRIEF_MAX_FOCUS = 5` (AC-42), `BRIEF_MAX_RISK_EXPLANATION = 240`, `BRIEF_MAX_FOCUS_REASON = 160` (NFR-3), `BRIEF_TIMEOUT_MS = 90_000` (NFR-2), `BRIEF_RATE_LIMIT = { max: 3, timeWindow: '1 minute' }` (NFR-4), `BRIEF_DROP_ORDER: BriefInputLabel[] = ['linked_spec','linked_issue','findings','blast_radius','derived_intent']` (AC-13 — `pr_identity` is deliberately absent, which is how AC-14's "never drop" is expressed as data), `BRIEF_SCHEMA_NAME`, `BRIEF_TEMPERATURE`, `BRIEF_MAX_RETRIES`, `BRIEF_SYSTEM`, `BRIEF_TASK(...)`, and `SECRET_PATTERNS` (the shapes listed in the skills table).
  `BRIEF_SYSTEM` **must state its output language**: "Answer in English, whatever language the pull request's own text is written in" (AC-16, `server/INSIGHTS.md` 2026-08-10). It must also state that no numeric score is to be produced (AC-25).
- **Skill:** `backend-onion-architecture` §8 — "A literal → `modules/<name>/constants.ts`"; §4 — `constants.ts` is the slice's **public** surface, so nothing secret or private belongs here.
- **Verify:** `cd server && pnpm typecheck`
- **Done when:** `rg -n "English" server/src/modules/brief/constants.ts` matches inside `BRIEF_SYSTEM`, and `BRIEF_DROP_ORDER` has exactly five entries, none of them `'pr_identity'`.

### Step 3 — Expose `blast` and `intent` on the container

- **Files:** `server/src/platform/container.ts`
- **Change:** two lazy getters alongside the existing `agentsRepo`/`reviewRepo` block (`:81-117`): `get blast(): BlastService { return (this._blast ??= new BlastService(this)); }` and `get intent(): IntentService { … }`, plus their private fields and `ContainerOverrides` entries so tests can stub them.
- **Why this and not an import:** `brief/service.ts` importing `modules/blast/service.ts` fails `no-cross-slice-import`. The container is the sanctioned channel (`backend-onion-architecture` §4), and `server/INSIGHTS.md` (2026-08-08) records that the rule scopes its `from` to `^src/modules/` **precisely so the container may import a slice's service**. This is the pattern, not a workaround.
- **Skill:** `backend-onion-architecture` §4 — never `new` a dependency outside the composition root; cross-slice access goes through the container.
- **Verify:** `cd server && pnpm typecheck && pnpm arch`
- **Done when:** `pnpm arch` exits **0** (not merely "no new findings"), and `rg -n "modules/(blast|intent)" server/src/modules/brief/` returns nothing at the end of Step 6.

### Step 4 — Pure helpers: ranges, normalization, validation, caps, redaction

- **Files:** `server/src/modules/brief/helpers.ts` (new)
- **Change:** no I/O, no container, no Drizzle — every input is a parameter:
  - `changedRanges(patch: string | null): {start:number; end:number}[]` — parses `@@ -a,b +c,d @@` new-side ranges. **New code, not an import**: `intent/helpers.ts#hunkHeaders` is slice-private (R1).
  - `normalizeBriefPath(path)` — `path.replace(PATH_PREFIX_PATTERN, '')`, importing the pattern from `smart-diff/constants.ts:94` (a slice **public** surface, so this is gate-clean and the rule stays single-sourced). Inherits the documented `a/`-directory sharp edge (`server/INSIGHTS.md` 2026-08-09) — AC-17 says exact match, **no basename fallback**.
  - `validateFocus(entries, rangesByPath)` → `{ kept, dropped }`. Drops an entry whose normalized path is not a changed file (AC-17); **keeps** an entry whose line falls outside every range and retargets it to that file's first changed line (AC-18).
  - `validateRisks(risks, changedPaths, knownEndpoints)` → `{ kept, dropped }` — drops any risk whose named endpoint or cron did not appear in the blast input (AC-19).
  - `capBrief(answer)` — five risks, five focus entries, "most important first" = the model's own order preserved (AC-42); truncates explanation to 240 and reason to 160 (NFR-3).
  - `isTitleRestatement(what, title)` — lowercase, collapse whitespace, strip punctuation, compare (AC-23).
  - `redactSecrets(text)` — replaces every `SECRET_PATTERNS` match with a fixed marker (AC-24). Applied to **every** string field of the brief.
- **Skill:** `backend-onion-architecture` §1/§8 — a pure transform lives in `helpers.ts`; §11 — never gate on `findings.confidence`. `security` §Secret Detection supplies the patterns.
- **Verify:** `cd server && pnpm typecheck && pnpm arch`
- **Done when:** `rg -n "drizzle|container|db" server/src/modules/brief/helpers.ts` returns nothing, and `pnpm arch` exits 0.

### Step 5 — Repository: read and upsert the brief document

- **Files:** `server/src/modules/brief/repository.ts` (new)
- **Change:** `class BriefRepository { constructor(private db: Db) }` — the only file in the slice importing `drizzle-orm` / `db/schema`:
  - `getBrief(prId): Promise<StoredRiskBrief | undefined>` — `select().from(t.prBrief).where(eq(t.prBrief.prId, prId))`, then `StoredRiskBrief.safeParse(row.json)`; **on failure return `undefined`**, not a throw. A document this feature did not write (e.g. a hypothetical `PrBrief`) must read as "no brief", never as a 500 (`zod` §`parse-use-safeparse`).
  - `upsertBrief(prId, doc)` — `insert().values({prId, json: doc}).onConflictDoUpdate({ target: t.prBrief.prId, set: {json: doc} })`, copying `upsertIntent` (`intent/repository.ts:142-160`). NFR-8: one brief per PR, no version history.
  - `getPull(workspaceId, prId)` — **workspace-scoped**, the ownership check for the whole feature (AC-6).
  - `getPrFiles(prId)` — `path`, `additions`, `deletions`, `patch`. The patch is used **only** to derive ranges in Step 4; no hunk body ever leaves this slice (AC-8).
- **Skill:** `backend-onion-architecture` §5 — constructor takes `Db` not `Container`; every method workspace-scoped where it reads a tenant table; nothing Drizzle-shaped crosses the boundary. `drizzle-orm-patterns` for the upsert (executor loads it).
- **Verify:** `cd server && pnpm typecheck && pnpm arch`
- **Done when:** `pnpm arch` exits 0 and `rg -n "drizzle-orm" server/src/modules/brief/` matches **only** `repository.ts`.

### Step 6 — Pipeline: assemble six blocks, fit the budget, make one model call

- **Files:** `server/src/modules/brief/pipeline.ts` (new)
- **Change:** modelled on `intent/pipeline.ts:66-197`, taking every row as a parameter:
  - `collectBlocks(...)` → `{ blocks: {label, text}[], missing: BriefInputLabel[] }`, in AC-7's order:
    1. `pr_identity` — number, title, branch, base, and **at most 50** changed paths with `+a/−d` counts and changed ranges, plus aggregate totals for the remainder (AC-14). Never dropped.
    2. `derived_intent` — `container.intent.get()`'s already-rendered `promptBlock`. Absent → label goes to `missing` (AC-37).
    3. `blast_radius` — `BlastRadiusResponse.summary` plus the endpoint/cron names, **and** `state`/`reason`, so AC-36's "incomplete" is stated from the truth table (`docs/blast-radius.md:65-104`) rather than inferred from an empty array.
    4. `findings` — **severity, title, file, start line only** (AC-9). `rationale`, `suggestion` and `confidence` are never read (AC-10).
    5. `linked_issue` — best effort via `container.github()`; a `ConfigError` or a fetch failure drops the label, never the brief (AC-37).
    6. `linked_spec` — via `container.git.readFile` over allowlisted paths.
    **No raw hunk bodies, ever** (AC-8) — this function is the enforcement point, exactly as `hunkHeaders` is for L03.
  - `fitBudget(blocks, tokenizer)` → `{ blocks, dropped, tokens, estimated }`. Counts the **fully assembled input including the instruction text** with `container.tokenizer.count` (AC-11); on failure the adapter already falls back to `ceil(chars/4)` and the pipeline records `estimated: true` (AC-12). Over budget → pop from `BRIEF_DROP_ORDER`'s tail, whole blocks only, never mid-content (AC-13). Identity alone still over → return a `too_large` signal and **make no call** (AC-15).
  - `requestBrief(...)` → one `assemblePrompt({ system: BRIEF_SYSTEM, task: BRIEF_TASK(...), diff: blob })` + one `llm.completeStructured({ schema: BriefAnswer, … })` with `providerRouting: { requireParameters: true }` and an `AbortSignal.timeout(BRIEF_TIMEOUT_MS)` (NFR-2). Exactly one call (NFR-5).
  - The blocks go in the **`diff` slot** because it is the only unconditional `wrapUntrusted`-wrapped slot — every one of the six sources is author-controlled text that must arrive as **data** (spec §Untrusted inputs). The trace will mislabel the section "Diff"; that is the accepted, recorded cost (`server/INSIGHTS.md` 2026-08-05). The system/task text is **not** wrapped (root `INSIGHTS.md` 2026-08-05).
- **Skill:** `backend-onion-architecture` §2 — no Drizzle, no `src/db`; rows arrive as parameters. Note `no-sql-in-service` matches only `(service|helpers).ts` by filename, so a query here would pass the gate silently — this is discipline, not enforcement (`intent/pipeline.ts:25-35`).
- **Verify:** `cd server && pnpm typecheck && pnpm arch`
- **Done when:** `rg -n "\bpatch\b" server/src/modules/brief/pipeline.ts` returns nothing (patches are consumed in `helpers.ts`, never emitted), and `rg -n "confidence" server/src/modules/brief/` returns nothing (AC-10).

### Step 7 — Service: cache, force, single-flight, staleness, validation

- **Files:** `server/src/modules/brief/service.ts` (new)
- **Change:** `class BriefService { constructor(private container: Container) { this.repo = new BriefRepository(container.db); } }` — the one sanctioned `container.db` read in the slice, and only to construct the repository (`backend-onion-architecture` §4).
  - `get(workspaceId, prId): Promise<PrRiskBriefRecord | null>` — `getPull` → `NotFoundError` if absent or foreign (AC-6); `getBrief` → `null` if none; otherwise attach `stale`.
  - `staleness` is computed at read from two independent facts (AC-34, AC-35): `doc.head_sha !== pull.headSha`, **or** the latest completed review's `created_at` is after `doc.generated_at` (via `container.reviewRepo.reviewsForPull(prId)`). Never stored.
  - `generate(workspaceId, prId, {force}): Promise<BriefGenerationResult>`:
    - `getPull` → `NotFoundError` (AC-6);
    - not `force` and a stored brief matches the current head and is not review-stale → return it with **no model call** (AC-2, NFR-5);
    - **single-flight**: a module-level `Map<string, Promise<BriefGenerationResult>>` keyed by `prId`. A second request joins the in-flight promise; the entry is deleted in `finally`. One generation, one cost (AC-4, NFR-7). Different PRs are unconstrained.
    - `container.llm(provider)` throwing `ConfigError` → `{state:'not_configured'}` — a **normal path**, never a 500 (`backend-onion-architecture` §4, AC-39);
    - after the answer: `validateFocus` + `validateRisks` → `dropped_refs` (AC-20); empty focus survives as an explicit empty list (AC-21); `isTitleRestatement(what, title)` or a missing what/why → `{state:'failed', reason:'unusable_answer'}` with **nothing stored** (AC-22, AC-23); provider failure → `{state:'failed', reason:'provider_error'}`, the previous document **untouched** (AC-38);
    - `redactSecrets` over every string field **before** persist, display or log, so all three obligations are one function at one seam (AC-24);
    - persist, then return `{state:'ok', brief}`.
  - **Logging discipline:** log labels, counts, tokens and cost — **never** issue bodies, spec contents, finding text or the assembled input (spec §Untrusted inputs; `docs/intent-layer.md:250-258`; `security` §A09).
- **Skill:** `backend-onion-architecture` §4 — a ring-2 service reads `container.<port>`, never `container.db`, and never imports another slice; §11 — no pass-through methods.
- **Verify:** `cd server && pnpm typecheck && pnpm arch`
- **Done when:** `pnpm arch` exits 0; `rg -n "container\.db" server/src/modules/brief/service.ts` matches exactly once, on the `new BriefRepository(...)` line.

### Step 8 — Routes and static registration

- **Files:** `server/src/modules/brief/routes.ts` (new), `server/src/modules/index.ts`
- **Change:**
  - `GET /pulls/:id/brief` — `schema: { params: IdParams }`; `getContext` → `service.get(...)`; `null` → `throw new NotFoundError('No brief generated for this pull request yet')`, the same shape as `intent/routes.ts:30`. No rate-limit override: the read spends nothing.
  - `POST /pulls/:id/brief` — `schema: { params: IdParams, body: z.object({ force: z.boolean().optional() }).default({}) }`; `config: { rateLimit: { max: 3, timeWindow: '1 minute', keyGenerator: (req) => \`brief:${(req.params as {id:string}).id}\` } }` (NFR-4, `security` §A06 "AI generation — 3 req / 1 min"). Returns `BriefGenerationResult` with **200 for every non-404 state** — `too_large`, `failed` and `not_configured` are states the card renders, not HTTP errors.
  - One import and one entry in `modules/index.ts`. Registration is static; `@fastify/autoload` is a decoy.
- **Skill:** `backend-onion-architecture` §6 — routes are HTTP and Zod, validation in `schema:`, throw `AppError` subclasses rather than `reply.code(...)`. `fastify-best-practices` `rules/routes.md` + `rules/schemas.md` — schema-first, per-route config on the options object.
- **Verify:** `cd server && pnpm typecheck && pnpm arch && pnpm test -- routes-smoke`
- **Done when:** `routes-smoke.test.ts` passes with both new routes registered, and `pnpm arch` exits 0 with no `no-sql-in-routes` finding.

### Step 9 — Server tests

- **Files:** `server/test/brief-helpers.test.ts` (new), `server/test/brief.it.test.ts` (new)
- **Change:**
  - `brief-helpers.test.ts` — hermetic ring-2 unit tests over `helpers.ts` and `fitBudget`: AC-13 drop order and "never mid-content"; AC-14's 50-path cap on a 300-file PR; AC-15's no-call refusal; AC-17 exact-match dropping (including that a plausible-but-unchanged path is dropped); AC-18 retargeting to the first changed line; AC-19 endpoint dropping; AC-20's count; AC-23 title restatement; AC-24 redaction of each `SECRET_PATTERNS` shape; AC-42's caps and NFR-3's truncations.
  - `brief.it.test.ts` — **the `.it.` prefix is the CI split, not a preference.** `buildApp({ overrides })` with a stub `LLMProvider` and a stub `tokenizer`: AC-1 first generation; AC-2 second request makes no call; AC-3 force replaces; AC-4 two concurrent requests → one call; AC-5 survives a reload; AC-6 a foreign PR id is indistinguishable from an invented one; AC-8/AC-9/AC-10 assert a distinctive string in a patch, a finding rationale and a confidence value reach **neither** the assembled input nor the stored document; AC-12 with the tokenizer forced to fail; AC-22/AC-38/AC-39 the three failure states.
- **Skill:** `backend-onion-architecture` §9 — helpers directly, services through `ContainerOverrides` + `adapters/mocks.ts`, routes through `app.inject()`; the filename is the gate.
- **Verify:** `cd server && pnpm test -- brief-helpers` then `cd server && pnpm test -- brief.it`
- **Done when:** both report a **non-zero passing count with zero skipped**. `N skipped` on the integration file means unverified, not green (`server/INSIGHTS.md` 2026-08-02, 2026-08-05 — run it by name; eight containers at once is why the whole suite is red for environmental reasons).

### Step 10 — Focus after navigation (the authorised L04/L06 change)

- **Files:** `client/src/components/diff-viewer/helpers.ts`, `client/src/components/diff-viewer/useDiffLineTarget.ts`, `client/src/components/diff-viewer/FileCard/**`
- **Change:**
  - `helpers.ts`: add `fileHeadingId(path)` beside the existing `lineAnchorId` — the module already owns "the ONE definition of a rendered element's DOM id", which is why it belongs here and not in the brief.
  - `FileCard`: give the heading element that id and `tabIndex={-1}` so it can receive programmatic focus without entering the tab order.
  - `useDiffLineTarget.ts`: in the existing Effect (`:43-51`), after `scrollIntoView`, call `document.getElementById(fileHeadingId(target.path))?.focus({ preventScroll: true })`. `preventScroll` is required or the focus fights the smooth centred scroll. Update the hook's docblock to state the focus behaviour and to name this plan as its origin.
  - **Applies to all three consumers.** See `## Scope decision` for the exact before/after on L04's badge and L06's caller rows.
  - Tests: extend the existing L04 and L06 navigation tests to assert focus lands on the heading, and add one for the brief in Step 11. jsdom implements **no** `Element.prototype.scrollIntoView` and **no** `window.CSS` — both must be stubbed (`client/INSIGHTS.md` 2026-08-09, 2026-08-10). Assert *which* element a stubbed DOM method was called on via `mock.contexts[0]` (2026-08-09).
- **Skill:** `frontend-ui-architecture` §2 — the third consumer joins the promoted module rather than forking it; §7 — inside the module, import the sibling file directly, never through the barrel. `react-testing-library` (executor loads) plus the repo rule that `user-event` is not installed, so `fireEvent` is the tool.
- **Verify:** `cd client && pnpm typecheck && pnpm lint && pnpm test -- diff-viewer SmartDiffViewer BlastRadiusCard DiffTab`
- **Done when:** the pre-existing L04 and L06 navigation tests still pass **and** each asserts focus on the target file heading; AC-31 has a test proving a boilerplate-group file opens and scrolls (behaviour that already works — the test is what makes it a criterion).

### Step 11 — The card, the hook, the copy, and the mount

- **Files:** `client/src/lib/hooks/brief.ts` (new); `client/src/app/repos/[repoId]/pulls/[number]/_components/BriefCard/{BriefCard.tsx,styles.ts,constants.ts,BriefCard.test.tsx,index.ts}` (new); `client/src/app/repos/[repoId]/pulls/[number]/_components/OverviewTab/OverviewTab.tsx`; `client/messages/en/brief.json`
- **Change:**
  - **Hook** — `usePrBrief(prId)`: `useQuery` on `["pr-brief", prId]`, `enabled: !!prId`, **`retry: false`** because a 404 is the normal never-generated answer. `useGenerateBrief(prId)`: `useMutation` POSTing `{force}`, and in `onSuccess` writing `result.brief` straight into the cache with `setQueryData` when `state === 'ok'`. That combination is what stops `client/INSIGHTS.md` (2026-08-09)'s cached-404 trap from swallowing the first successful generation — and it is Open Q3's answer.
  - **Card** — takes **resolved data plus flags** (`brief`, `loading`, `generating`, `result`, `onGenerate`, `onOpenFocus`), never a `prId` it fetches from, matching `IntentCard.tsx:20-26`. States: empty naming the generate action (AC-26); generating, keeping the previous brief readable and the control disabled (AC-27); fresh; stale with regenerate named (AC-34/35); `too_large`; `failed` with retry; `not_configured` **with no retry control** and the settings screen named (AC-39). Risk level rendered as **text label beside colour** (AC-28). Cost rendered "unknown" when `cost_usd` is null, never `$0.00` (AC-40). "Model-generated" label always present (AC-41). Zero risks → an explicit sentence, not an empty box (AC-43). Long paths shortened in display with the full value reachable (AC-44). Every focus entry and the regenerate control keyboard-reachable with accessible names (AC-33). `stale` derived during render, never stored (`frontend-ui-architecture` §5).
  - **Copy** — a new `riskBrief` namespace in `messages/en/brief.json`. **Every fixed label** comes from the catalogue; **all model-authored text renders as data** — a plain `{value}` in JSX, never a message key, and never `t.raw` either (AC-45; the precedent is `docs/blast-radius.md:168-174`). The two stale strings at `:11-13` are neither reused nor deleted (Open Q2).
  - **Mount** — `OverviewTab` calls both hooks and renders `<BriefCard … onOpenFocus={onOpenCaller} />`. `onOpenCaller` already does exactly what AC-30 needs: one `router.replace` carrying `tab` and `goto` together (`PrDetailView.tsx:202-207`). **No change to `PrDetailView` or `DiffTab` is required.**
  - **Tests** — one per card state, plus AC-30 (one activation → one `onOpenFocus` call with the right path and line) and AC-32 (focus lands in the diff). `fireEvent`, not `user-event`.
- **Skill:** `frontend-ui-architecture` §1 (one route → route-local `_components/`; strings → the catalogue; fetching → the data layer), §4 (resolved data, not an id), §5 (derive during render; no Effect for derived state). `react-best-practices` and `react-testing-library` (executor loads) — noting `routing.md:107-116`, the 200-line and container/presentational rules are **never blocking** here.
- **Verify:** `cd client && pnpm typecheck && pnpm lint && pnpm test -- BriefCard OverviewTab`
- **Done when:** `rg -n '"[A-Z][a-z]+ ' client/src/app/repos/\[repoId\]/pulls/\[number\]/_components/BriefCard/BriefCard.tsx` finds no baked-in English sentence, every card state has a test, and `pnpm lint` is clean (it, not `typecheck`, is what catches a deep relative import — `client/INSIGHTS.md` 2026-08-05).

### Step 12 — Documentation and the two false prose claims

- **Files:** `docs/pr-risk-brief.md` (new), `docs/blast-radius.md`, `server/src/modules/blast/service.ts`, `server/src/adapters/tokenizer/index.ts`, `AGENTS.md`
- **Change:**
  - `docs/pr-risk-brief.md` — the feature doc: the six inputs and their drop order, the state machine, the validation-then-redact-then-store order, the cache key, and the AC-32 scope decision with its before/after table.
  - `docs/blast-radius.md:241-242` — "`pr_brief` stays empty" is now false. Correct it to "`PrHistory` stays unused; `pr_brief` is written by the PR Risk Brief (`docs/pr-risk-brief.md`)". `PrHistory` genuinely stays unused.
  - `server/src/modules/blast/service.ts:31` — same correction, one line of docblock. **No behaviour change to the blast slice.**
  - `server/src/adapters/tokenizer/index.ts:11-12` — "Scope: in-process, ONLY under modules/repo-intel" is falsified by the second consumer. Name both.
  - `AGENTS.md` §Read when — a row for `docs/pr-risk-brief.md`. Edit `AGENTS.md`; **never** touch the `CLAUDE.md` symlink.
- **Skill:** none routed — `routing.md:70` gives `docs/**` "repo rules only. English only", and `routing.md:68` covers the `AGENTS.md`/symlink rule.
- **Verify:** `cd server && pnpm typecheck` && `ls -l CLAUDE.md | grep -q '^l'` && `git diff --stat docs/ AGENTS.md`
- **Done when:** `rg -n "pr_brief stays empty|pr_brief. is NOT written" docs/ server/src/` returns nothing, `CLAUDE.md` is still mode `120000`, and `AGENTS.md` §Read when has the new row.

## Verification plan

| Package | Command | Runs when |
|---|---|---|
| — | `./scripts/check-shared-sync.sh` | after Step 1 — `*/src/vendor/shared/**` changed |
| server | `cd server && pnpm typecheck` | Steps 1–9, 12 |
| server | `cd server && pnpm arch` | Steps 3–8 — **must exit 0**, and it is **not** wired into CI (root `INSIGHTS.md` 2026-08-02), so it only runs if run by hand |
| server | `cd server && pnpm test -- brief-helpers` | Step 9 |
| server | `cd server && pnpm test -- brief.it` | Step 9 — **read the count, not the exit code**; `N skipped` means unverified |
| server | `cd server && pnpm test -- routes-smoke` | Step 8 |
| client | `cd client && pnpm typecheck && pnpm lint` | Steps 1, 10, 11 — `lint`, not `typecheck`, catches deep relative imports |
| client | `cd client && pnpm test -- diff-viewer SmartDiffViewer BlastRadiusCard DiffTab` | Step 10 — the L04/L06 regression surface for the authorised behaviour change |
| client | `cd client && pnpm test -- BriefCard OverviewTab` | Step 11 |

`cd server && pnpm test` (whole suite) is **not** a gate here: it is red for an environmental reason — eight `*.it.test.ts` files start eight Postgres containers at once (`server/INSIGHTS.md` 2026-08-05). Run the new files by name.

## Acceptance-facing checks

Every row restates a criterion the spec already states, rephrased as something a command or a `path:line` settles. Nothing here is new.

| AC / NFR | Settled by |
|---|---|
| AC-2, AC-4, NFR-5, NFR-7 | `server/test/brief.it.test.ts` — the stub `LLMProvider`'s call counter is 1 after a second request and after two concurrent requests |
| AC-6 | `brief.it.test.ts` — the response body and status for a foreign PR id are byte-identical to those for an invented uuid |
| AC-8, AC-9, AC-10 | `brief.it.test.ts` — a distinctive string planted in a patch, in a finding `rationale`, and any `confidence` value appear in **neither** the captured model input nor the stored document. Reinforced by `rg -n "confidence" server/src/modules/brief/` → no match |
| AC-11, AC-12 | `brief-helpers.test.ts` — the recorded count matches an independent `cl100k_base` count; with `ContainerOverrides.tokenizer` forced to throw, generation still succeeds and `tokens_estimated` is `true` |
| AC-13, AC-14, AC-15 | `brief-helpers.test.ts` — the dropped set is a suffix of `BRIEF_DROP_ORDER`, no block is half-present, a 300-file PR names 50 paths plus totals, and the identity-only overflow records no cost |
| AC-16 | `rg -n "English" server/src/modules/brief/constants.ts` inside `BRIEF_SYSTEM` |
| AC-17, AC-18, AC-19, AC-20, AC-21 | `brief-helpers.test.ts` — one case per criterion, `dropped_refs` non-zero where a reference fails |
| AC-22, AC-23, AC-38, AC-39 | `brief.it.test.ts` — three distinct `BriefGenerationResult.state` values, and the stored document unchanged after a provider failure |
| AC-24 | `brief-helpers.test.ts` — one case per `SECRET_PATTERNS` shape; plus `BriefCard.test.tsx` asserting the marker, not the literal |
| AC-25 | `rg -n "score" server/src/vendor/shared/contracts/review-api.ts` shows no numeric field on any `Brief*` schema |
| AC-26, AC-27, AC-34…AC-37, AC-40…AC-44 | `BriefCard.test.tsx` — one test per state; the cost test asserts the string "unknown" and the **absence** of `$0.00` |
| AC-28, AC-33 | `BriefCard.test.tsx` — the level is queried by its text, and every entry plus the regenerate control is reachable by accessible name |
| AC-30, AC-31, AC-32 | `BriefCard.test.tsx` (one activation → one `onOpenFocus` with the right path/line) and the Step 10 diff-viewer tests (boilerplate file opens; focus lands on the heading) |
| AC-45 | the `rg` in Step 11's `Done when`, plus a test asserting a model-authored sentence is rendered verbatim and never looked up as a key |
| NFR-3 | `brief-helpers.test.ts` — 240/160 truncation and the 5/5 caps |
| NFR-4 | **`server/src/modules/brief/routes.ts` — the `config.rateLimit` block, by inspection.** Not a command: the limiter is not registered under `NODE_ENV=test` (`server/src/app.ts:94-98`), so no `app.inject()` test can exercise it. Recorded as R4 |
| NFR-1, NFR-2 | Not settled by an automated check in this plan. NFR-2's 90 s abandon is asserted structurally (`BRIEF_TIMEOUT_MS` reaches the provider call); NFR-1's latency is a manual observation on a warm local install. Recorded as R5 |

## Recommendations not taken

- **AC-32 as an opt-in flag** — the planner recommended `focusOnArrive` so L04 and L06 kept their current behaviour. **The caller overrode this**, choosing the change for all consumers, and asked for it to be visible. Documented in `## Scope decision` and `docs/pr-risk-brief.md`.
- Recommendations 1, 2, 3, 4 and 5 from the intake were all accepted as their stated defaults and are folded into Steps 6, 4, 12, 7 and 11 respectively. Nothing else was declined.

## Risks & open questions

- **R1 — three pure helpers are duplicated across a slice boundary.** `changedRanges`, `linkedIssueNumbers` and `linkedSpecPaths` already exist in `intent/helpers.ts`, which is slice-private (`server/.dependency-cruiser.cjs:65`), and refactoring L03 to share them is a spec non-goal. *Proceed on:* duplicate them in `brief/helpers.ts` with a docblock naming the original and the rule. **The promotion target when a third consumer appears is `server/src/modules/_shared/pr-text.ts`** — `_shared` is already the cross-slice home (`intent/routes.ts:4-5` imports `_shared/context.js` and `_shared/schemas.js`), and a file **not** named `helpers.ts` falls outside `SLICE_PRIVATE`, so it is gate-clean. `normalizeBriefPath` is **not** duplicated: it derives from the importable `smart-diff/constants.ts:94`. *Worth capturing with `engineering-insights`:* "`modules/_shared/<name>.ts` is the gate-clean home for a cross-slice pure helper — `helpers.ts` is not, because `SLICE_PRIVATE` matches the filename."
- **R2 — `pr_brief.json` now has two declared shapes.** `PrBrief` (`contracts/brief.ts:117-124`) was declared for this column and never written; this feature writes `StoredRiskBrief` there instead. *Proceed on:* `getBrief` uses `safeParse` and returns `undefined` on a mismatch, so a foreign document degrades to "no brief" rather than a 500. A later lesson wanting `PrBrief` must pick a different column or a discriminator. Called out in `## Handoff`.
- **R3 — single-flight is process-local.** The `Map` in `brief/service.ts` collapses concurrent requests within one Node process. Two server processes would each spend a call. *Proceed on:* acceptable — DevDigest is a local-first single-process app. AC-4's verification is written per-process and the `.it.test.ts` exercises exactly that.
- **R4 — NFR-4 has no automated test.** `@fastify/rate-limit` is not registered under `NODE_ENV=test` (`server/src/app.ts:94-98`), so `app.inject()` cannot exercise the limit. *Proceed on:* the `Done when` is a `path:line` on the route's `config.rateLimit`, not a command. Do **not** "fix" this by registering the limiter in tests — that would make every other integration suite flaky.
- **R5 — NFR-1 and NFR-2 are not machine-checked.** A p95 latency and a 90 s abandon need a stalled provider and a warm install. *Proceed on:* assert them structurally (the timeout constant reaches the provider call) and note the manual check in `docs/pr-risk-brief.md`.
- **R6 — the spec's own text is stale in one place.** §Contract promises says "**Records that already exist.** None do… the only references to it in the server source are its own declaration and the barrel". The `pr_brief` **table** has existed since the initial migration (`db/schema/reviews.ts:122-127`, `migrations/0000_init.sql:211-214`) and is referenced from `db/schema.ts:33,64`. The *document* claim holds; the storage claim does not. This plan proceeds on the corrected fact. **Correcting the spec is the caller's call and `doc-writer`'s tool** — this plan does not amend `specs/`.
- **R7 — a sentinel is adjacent but not touched.** `AGENTS.md` §Do not touch names `server/src/db/migrations/**`. Decision 3 means **no migration is generated and no existing one is read or edited**. If anyone later decides to promote the provenance fields to columns, that is a new migration and a new decision, never an edit to `0000_init.sql`.
- **R8 — the `a/`-directory sharp edge is inherited.** A repository with a real top-level directory named `a` or `b` has that segment stripped by `PATH_PREFIX_PATTERN`, so AC-17's exact match can mis-compare (`server/INSIGHTS.md` 2026-08-09). *Proceed on:* inherit it. Working around it here would fork the normalization rule L04 owns.
- **R9 — `docs/l02-experiment.md` is not invoked, deliberately.** The spec's §Non-goals says "**A quality claim.** Nothing here asserts that reviews get better." Nothing in this plan measures review quality, and nothing may claim it. If that claim is ever wanted, `docs/l02-experiment.md` is the only route.
- **Needs `researcher`: none.** Every fact this plan rests on was verified from the repo. No upstream documentation was required.

## Out of scope

- **L03, L04 and L06 logic.** Intent derivation, the reviewer-ordered diff's classification/ordering, and the blast-radius computation are read as inputs and never modified. The **one** exception is the AC-32 focus behaviour in `useDiffLineTarget` — authorised, and documented in `## Scope decision`.
- **The verdict banner, the "N findings · M blockers" counts, and the numeric PR score ring.** Pre-existing features; the brief only must not contradict them (AC-25).
- **A PR-history section.** `PrHistory` stays declared, unfed and unrendered; `client/messages/en/brief.json`'s history labels stay unrendered. Reserved for a later lesson.
- **An MCP tool.** No `get_pr_brief`; `mcp/**` is untouched (Open Q5).
- **Automatic generation.** No review run, import or page load produces a brief. The stale marker plus a deliberate regenerate does the job visibly.
- **The PR body as an input in its own right.** It reaches the brief only through the derived intent (Open Q6).
- **A migration, a schema edit, or an index.** Decision 3.
- **Deleting the two stale copy strings** at `brief.json:11-13` (Open Q2).
- **Correcting `specs/2026-08-16-pr-why-risk-brief.md`** for R6 — the caller's decision, `doc-writer`'s tool.
- **`e2e/` flows.** No browser flow is added; `e2e/AGENTS.md` is not in scope.

## Handoff

What the architecture and security reviewers will need to look at once this lands:

- **New module boundary** — `server/src/modules/brief/` as a full slice (routes → service → repository, plus `pipeline`/`helpers`/`constants`), and **two new container getters** (`blast`, `intent`) that make `platform/container.ts` import two more slice services. That is the sanctioned channel (`server/INSIGHTS.md` 2026-08-08), but it is a widening of the composition root and should be looked at as one.
- **New outbound calls** — one structured LLM call per generation (a new `risk_brief` cost centre), a best-effort GitHub issue fetch, and `git.readFile` over PR-body-derived spec paths. The last one takes **attacker-controlled paths**; confirm the allowlist is applied before the read, as L03 does.
- **New untrusted input, and a new trust boundary** — the model's answer is parsed, every file/line/endpoint validated against the PR's own data, and every string redacted, all **before** anything is stored. Reviewers should confirm the order is validate → redact → persist and that no path bypasses it (including logs).
- **A new secret-detection surface** — `SECRET_PATTERNS` and `redactSecrets` are the repo's first redaction code. The patterns come from `.claude/skills/security/SKILL.md` §Secret Detection; false negatives are a real risk and worth a second read.
- **A behaviour change to shipped navigation** — `useDiffLineTarget` now moves focus for L04's findings badge and L06's caller rows too. See `## Scope decision` for the before/after; this is the change most likely to surprise someone reviewing only the brief's diff.
- **A storage claim reversed** — `pr_brief` stops being an empty reserved table. `AGENTS.md` §Do not touch lists empty tables as intentional; this one is now written, by design and with the spec's authority.
- **No new secrets, no new migration, no new `AppConfig` key.**

---

## Appendix — suggested execution (advisory, not a gate)

Recorded for whoever runs this later; the caller ruled the mode out of scope for this planning session. Steps 1–12 read correctly as one ordered list for a single `implementer` run.

| # | Agent | Input artifact | Steps | Files owned | Output |
|---|---|---|---|---|---|
| 1 | `implementer` | `plans/2026-08-16-pr-why-risk-brief.md` | 1–8 | `*/src/vendor/shared/contracts/review-api.ts`, `server/src/modules/brief/**`, `server/src/modules/index.ts`, `server/src/platform/container.ts` | server slice + contracts in the working tree |
| 2 | `plan-verifier` | the same path | — | none (read-only) | conformance table; `not-met` rows return to hop 1 |
| 3 | `implementer` | the same path | 10–11 | `client/src/lib/hooks/brief.ts`, `client/src/app/**/_components/{BriefCard,OverviewTab}/**`, `client/src/components/diff-viewer/**`, `client/messages/en/brief.json` | client card, hook, copy, navigation |
| 4 | `plan-verifier` | the same path | — | none (read-only) | second conformance pass |
| 5 | `test-writer` | the plan + the `AC-N` list in `## Acceptance-facing checks` + hop 2's and hop 4's `unverifiable` rows | 9 | `server/test/brief*.ts`, `client/src/**/BriefCard.test.tsx` | tests |
| 6 | `architecture-reviewer` ‖ the security review | the changed-file list | — | none (read-only) | boundary findings; secret/untrusted-input findings |
| 7 | `doc-writer` | the plan | 12 | `docs/pr-risk-brief.md`, `docs/blast-radius.md`, `AGENTS.md` | feature doc + the two corrections |

Three properties this table has to satisfy, and does: `Input artifact` is always a **path**, because subagents share no context and a plan relayed by paraphrase loses the constraints it exists to carry; `test-writer` is handed **behaviours** (`AC-N` identifiers and the `unverifiable` rows), never a command list; and the two writing hops own **disjoint** file sets, with hops 1 and 3 strictly sequential because the client cannot type against a contract that does not exist yet. The only safe parallel pair is hop 6's two read-only reviewers.

Ordering constraints that are not preferences: **both** `vendor/shared` copies move in the same step (never split across agents); the container getters precede the service that reads them; the server precedes the client. And a subagent that dies on an account limit returns **nothing**, not a partial result (root `INSIGHTS.md` 2026-08-08) — the fallback is to re-run that hop from the plan file, which is why every hop's input is the file rather than the previous agent's message.

---

**Files referenced most in this plan, for the reader's convenience:**
- `specs/2026-08-16-pr-why-risk-brief.md`
- `server/src/db/schema/reviews.ts` (lines 122-127 — the existing `pr_brief` table)
- `server/src/modules/intent/{service,pipeline,repository,routes}.ts` (the template this slice follows)
- `server/src/modules/blast/service.ts`
- `server/src/platform/container.ts`
- `server/.dependency-cruiser.cjs` (line 65 — `SLICE_PRIVATE`, why `helpers.ts` cannot be imported)
- `client/src/components/diff-viewer/useDiffLineTarget.ts` (the AC-32 change site)
- `client/src/app/repos/[repoId]/pulls/[number]/_components/OverviewTab/OverviewTab.tsx`
