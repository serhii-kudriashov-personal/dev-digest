# Intent Layer (L03)

## Task

Derive a structured `Intent { intent, in_scope[], out_of_scope[] }` for a pull
request with one cheap OpenRouter classification call over PR text, linked
issue, linked plan/spec and hunk headers (never diff bodies); persist it per PR
with a re-derivation trigger; inject it into the review prompt; filter
out-of-scope findings while always keeping one signal for a serious out-of-scope
problem; surface it as a card on the PR page; make the classification model
separately selectable; and log the prompt's parts, model, token estimate and
sources without recording secrets or diff content.

---

## Context read

- root `INSIGHTS.md` (2026-08-05, "A lesson feature is mostly already
  scaffolded") — the governing entry. Confirmed below: the table, both
  contracts, the repository methods, the feature-model id, the settings picker
  and the i18n namespace all already exist. The real work is one module plus one
  wire, not a subsystem.
- root `INSIGHTS.md` (2026-08-05, "To make the model report a new field,
  `.describe()` the shared contract — then validate the answer server-side") —
  this is exactly how `Finding.scope` must be asked for and how the model's
  self-reported confidence must be treated. `Finding.skill`
  (`server/src/vendor/shared/contracts/findings.ts:88-96`) is the worked
  precedent, including the "field survives reduce + grounding untouched"
  plumbing facts.
- root `INSIGHTS.md` (2026-08-02, "Stacking convention blocks into an agent's
  `system_prompt` made the review worse") — measured 41 → 30 with a dropped SSRF
  finding. This is why the scope filter is a **deterministic post-step**, never a
  prompt instruction, and why the plan must not touch any agent's
  `system_prompt`.
- root `INSIGHTS.md` (2026-08-02, "`findings.confidence` is not calibrated —
  never gate on it") — the model returns `1.0` on a hallucination. The confidence
  shown on the intent card is therefore computed server-side from which sources
  were actually present; the model's own number is stored as a secondary claim
  only.
- root `INSIGHTS.md` (2026-08-02, "A field added to a persisted-jsonb contract
  must be `.nullish()`") — binds `PromptAssembly.intent`, `Finding.scope`
  (embedded in `eval_cases.expected_output` jsonb) and every new
  `PrIntentRecord` field.
- root `INSIGHTS.md` (2026-08-02, "Unknown cost is `null`, never `0`") — the
  classifier call's cost when the price book cannot attribute it.
- root `INSIGHTS.md` (2026-08-03, "A `grep -l | perl -pi` sweep fails silently
  here") — `grep` on this machine is ugrep; do not batch-rewrite imports with the
  usual one-liner.
- root `INSIGHTS.md` (2026-08-02, "`diff -r` is the wrong check for the two
  `vendor/shared` copies") — verify the sync per touched file with comments
  stripped, or run `./scripts/check-shared-sync.sh`.
- root `INSIGHTS.md` (2026-08-01, "`@devdigest/shared` drifts silently") —
  **partly stale, and this plan contradicts it**: the entry says `openrouter` is
  missing from the client's `Provider` union. It is not —
  `client/src/vendor/shared/contracts/knowledge.ts:312` reads
  `z.enum(['openai','anthropic','openrouter'])`. Setting
  `defaultProvider: 'openrouter'` in the client copy typechecks.
- root `INSIGHTS.md` (2026-08-02, "The `pnpm arch` boundary gate is not wired
  into CI") — `pnpm arch` must be run by hand on every step that touches
  `server/**` or `reviewer-core/**`; a green CI proves nothing about the ring
  boundaries.
- `server/INSIGHTS.md` (2026-08-05, "Porting `upstream/reference/full-build`'s
  conventions module fails three of this repo's own gates") — the three gates
  that will fail a new module: `no-cross-slice-import`, a repository field
  dropped from an insert type, and route validation done in the handler instead
  of `schema:`.
- `server/INSIGHTS.md` (2026-08-05, "`pnpm db:generate` goes INTERACTIVE when one
  migration both drops and adds a column") — keeps the `pr_intent` migration
  strictly additive.
- `server/INSIGHTS.md` (2026-08-05, "A non-review caller of `assemblePrompt` must
  use the `diff` slot, and will be mislabelled") — records that `prompt.ts` is on
  the do-not-touch list and that adding a slot "is a deliberate change to the
  shared engine". **This plan does exactly that, deliberately** — see Risks.
- `server/INSIGHTS.md` (2026-08-05, "`--no-file-parallelism` makes the
  integration suite deterministic AND faster") and (2026-08-02, "`*.it.test.ts`
  SKIPPING silently reads as passing") — the integration lane must be run
  serialized and the **test count** read, never the exit code.
- `server/INSIGHTS.md` (2026-08-02, "`completeAgentRun`'s parameter type is
  declared TWICE") — the `ReviewRepository` facade re-declares delegated
  signatures; derive types rather than adding a third copy.
- `server/INSIGHTS.md` (2026-08-02, "The `findings` table has no indexes at all")
  — does **not** bind here: no query in this plan joins or filters `findings`.
- `AGENTS.md` §Repo rules — English-only Markdown; `@devdigest/shared` exists
  twice, canon `server/`, client copy manual, synced in the same commit;
  migrations never applied on boot; a DB-backed test is `*.it.test.ts`; secrets
  only through `SecretsProvider`.
- `AGENTS.md` §Do not touch — `server/src/db/migrations/**` (never edited, only
  superseded), `reviewer-core/src/grounding.ts` and `INJECTION_GUARD` in
  `reviewer-core/src/prompt.ts`, `*/src/vendor/**` (extend, never reorganise),
  and the empty reserved tables.
- `server/AGENTS.md` §Conventions — three layers per module; validation in the
  route `schema:`; adapters from `container`, never `new`; a new module is one
  `routes.ts` plus one import and one entry in `modules/index.ts`.
- `client/AGENTS.md` / `frontend-ui-architecture` §"In this repo" — the data
  model is HTTP APIs through `apiFetch` + TanStack Query hooks; a mutation must
  invalidate its query keys.
- `reviewer-core/AGENTS.md` invariant #1 — zero I/O; the package never emits JS
  (`build` is `tsc --noEmit`).
- `specs/README.md` — the spec is the source of truth for implementation and
  acceptance.
- `docs/l02-experiment.md` — the harness for deciding whether a prompt/engine
  change actually helps. One run proves nothing.
- `.claude/skills/pr-self-review/routing.md` — the canonical path→skill table;
  every skill row below is derived from it.

### External sources

Verified 2026-08-08 by the `researcher` agent; the full report is summarised in
§"External findings of record" below.

- OpenRouter, Structured Outputs guide — support is per **endpoint**, not per
  model.
- OpenRouter, Provider Routing — `provider: { require_parameters: true }`.
- OpenRouter `/api/v1/models` and `/endpoints` (live JSON) — slug resolution,
  pricing, per-endpoint capability.
- Xiong et al., ICLR 2024, [arXiv:2306.13063](https://arxiv.org/abs/2306.13063)
  — verbalized LLM confidence is systematically overconfident.
- Sanz-Guerrero et al.,
  [arXiv:2606.03437](https://arxiv.org/html/2606.03437v1) — models assign up to
  26% higher confidence to their own responses.
- GitHub Docs, "Linking a pull request to an issue"; GitHub GraphQL reference,
  `closingIssuesReferences`.
- Qodo PR-Agent `pr_description_prompts.toml` / `pr_reviewer_prompts.toml`
  (open source); CodeRabbit, Cursor BugBot, Graphite and GitHub Copilot vendor
  docs.

---

## Why

A reviewer that does not know why a PR was opened reviews the diff in a vacuum.
It flags the pre-existing pattern the PR merely moved, it asks for the test the
author deliberately deferred to a follow-up, and it spends its finite attention
on things nobody asked about. The author then learns to skim the output, which
is how a review tool stops being read.

The fix is to give the reviewer the same orientation a human reviewer gets for
free from the PR description and the ticket: what this change is *for*, and what
it deliberately does *not* cover. Derived once, cheaply, from the material the
author already wrote — and shown back to the author, so a wrong reading is
visible before it distorts a review rather than after.

---

## Inventory — what already exists

Every line the request listed was verified against the files. **Six
corrections**, marked ⚠.

| Thing | Where | Verdict |
|---|---|---|
| `Intent { intent, in_scope[], out_of_scope[] }` | `server/src/vendor/shared/contracts/brief.ts:9-14` (+ identical client copy) | reuse, unchanged |
| `PrIntentRecord = Intent.extend({ pr_id })` | `server/src/vendor/shared/contracts/review-api.ts:60-61` (+ client copy) — **zero consumers anywhere** (`rg PrIntentRecord` hits only the two contract files) | extend |
| table `pr_intent` (`pr_id` PK → `pull_requests` ON DELETE CASCADE, `intent text NOT NULL`, `in_scope`/`out_of_scope` jsonb `NOT NULL DEFAULT '[]'`) | ⚠ `server/src/db/schema/reviews.ts:92-100` (the block runs to 100, not 99). Already in `0000_init.sql`, so **no migration is needed to USE it** | extend (additive migration for metadata only) |
| `upsertIntent` / `getIntent`, zero callers | `server/src/modules/reviews/repository/pull.repo.ts:49` and `:64`; facade `server/src/modules/reviews/repository.ts:146` / `:150` | reuse the mapping shape, **new home** (see below) |
| feature-model id `review_intent`, default `openai` / `gpt-4.1` | `server/src/vendor/shared/contracts/platform.ts:53-58`; enum member at `:17`; client vendor copy identical; client runtime mirror `client/src/lib/feature-models.ts:21-27` | extend (change the default) |
| `resolveFeatureModel` / `getFeatureModelOverride` | `server/src/modules/settings/feature-models.ts:51` / `:36` | reuse |
| Settings → Models picker for `review_intent` | ⚠ `client/.../SettingsModels/SettingsModels.tsx:38` (the `FEATURE_MODELS.map(`), not `:39`. It **always writes `provider: "openrouter"`** (`:31`), so an OpenRouter default is what the UI already assumes | reuse, no change |
| i18n namespace `brief` with `block.intent`, `unavailable`, `unavailableHint` | `client/messages/en/brief.json` | extend (add missing keys only) |
| linked-issue resolution + `PrDetail.linked_issue` | `server/src/adapters/github/octokit.ts:126-134` (regex at `:127`); contract `platform.ts:213`. ⚠ **`linked_issue` is never persisted** — it exists only on the live `PrDetail` response (`mocks.ts:184` returns `null`). There is no `linked_issue` column | new fetch path needed |
| `GitHubClient.getIssue(repo, n): Promise<IssueMeta>` | `server/src/vendor/shared/adapters.ts:164` — already on the port, already mocked | reuse (no port change) |
| `pr_files.patch` | `server/src/db/schema/pulls.ts:46`; `pr_commits.message` at `:60` for the fallback | reuse |
| second-LLM-call precedent | `server/src/modules/conventions/extract-pipeline.ts:87-106` — one `assemblePrompt` + one `completeStructured`, payload in the `diff` slot, model from `getFeatureModelOverride` | reuse the shape |
| container facade precedent | `server/src/platform/container.ts:120` (`get repoIntel()`); interface at `modules/repo-intel/types.ts`; the container already imports `modules/{agents,skills,reviews}/repository.js` and `modules/repo-intel/service.js` at `:25-29` | reuse |
| `run-executor` docblocks say "Loads the diff + intent once" | ⚠ `server/src/modules/reviews/run-executor.ts:45-46`, `:58-59`, `:69-70`, `:157`, `:356-357` — **five** sites, not two | correct in the same step |
| `INJECTION_GUARD` already names "derived intent/scope" | ⚠ the constant starts at `reviewer-core/src/prompt.ts:16` (not `:18`); "derived intent/scope" is on `:18`, the descoping clause on `:21-28` | **DO NOT TOUCH** |
| module registry reserves "intent/smart-diff" | `server/src/modules/index.ts:23` | extend |
| `scoreFromFindings` is NOT exported from the engine barrel | `reviewer-core/src/index.ts:35` exports only `reduceReviews, sliceDiff` from `./review/reduce.js`; `run.ts:12` imports it internally | correct, unchanged |
| `Finding.scope` | **new** — the contract has no scope field of any kind |
| `reviewer-core/src/scope.ts` | **new** — `reviewer-core/src` holds `grounding.ts index.ts llm output prompt.ts review` |
| `PromptParts.intent` / `PromptAssembly.intent` | **new** — `prompt.ts:39-73` and `contracts/trace.ts:39-64` have no `intent` |
| `server/src/modules/intent/` | **new** — ten slices exist, none named `intent` |
| `promptTokenCounts` picks up a new slot automatically | **false** — `server/src/modules/reviews/helpers.ts:107-116` is an **explicit array of eight pairs**. A new slot needs a new row or its token count is silently missing |
| `code_chunks.source = 'spec'` | `server/src/db/schema/context.ts:44` exists; whether any row is ever written with `'spec'` is unverified | optional secondary source |
| `StructuredRequest` has no provider-routing field | `server/src/vendor/shared/adapters.ts:55-70`; the OpenRouter request at `reviewer-core/src/llm/openrouter.ts:69-84` sends no `provider` key | **new** — see Step 3 |
| `pricing.ts` already has a `deepseek/deepseek-v4-flash` row | `server/src/adapters/llm/pricing.ts:31` — `{ in: 0.14, out: 0.28 }`, which is the price of a **different, older snapshot**; the file's own comment at `:27-29` says slugs and prices must be confirmed | **new row needed** — see Step 2 |

---

## External findings of record

Four facts from the external research that change decisions in this plan. They
are recorded here because they are not derivable from the repo, and a later
reader will otherwise re-open them.

### 1. The model slug is a trap

Verified against OpenRouter's live `/api/v1/models`:

| Slug | Resolves to | Price / 1M | Context |
|---|---|---|---|
| `~deepseek/deepseek-v4-flash-latest` | `deepseek/deepseek-v4-flash-0731` (moving alias) | $0.09 / $0.18 | 1,048,576 |
| `deepseek/deepseek-v4-flash` (already in this repo) | `deepseek/deepseek-v4-flash-20260423` | **$0.14 / $0.28** | 1,048,576 |

The `-latest` suffix is a real alias — its `alias_target` is
`deepseek/deepseek-v4-flash-0731`, described as "always redirects to the latest
model in the DeepSeek V4 Flash family". The price quoted for it ($0.09/$0.18) is
correct **for its current target**.

The bare slug this repo already hardcodes at
`server/src/adapters/llm/pricing.ts:31` and
`server/src/modules/conventions/constants.ts:121` is a **different, older,
pricier snapshot**. Both numbers are real; they are not a documentation error.

**Decision: pin the dated slug `deepseek/deepseek-v4-flash-0731`, not the
alias.** An alias silently changes the model underneath the eval harness
(`eval_cases` / `eval_runs`) and underneath the pricing table, which makes a
cost regression or a quality regression unattributable. `pricing.ts:27-29`
already asks for exactly this discipline. The alternative — pin `-latest`, take
the newest snapshot automatically — was rejected because reproducibility is the
whole point of the eval tables this feature will eventually be measured with.

Consequence to write down: the `onboarding` feature default still points at the
older bare slug, so the two features run on different snapshots until someone
reconciles them. That reconciliation is **not** in this plan's scope.

### 2. Structured-output support is per-endpoint, and this repo sends no guard

OpenRouter's structured-outputs guide: *"Support is determined per endpoint, not
just per model: the same model may be served by multiple providers, and only
some of those providers may support structured outputs."* And on strict mode:
*"Enforcement varies by provider: some guarantee schema-conforming output, while
others translate your schema into their own structured-output format or treat it
as a strong hint, so exact compliance is not guaranteed on every endpoint."*

Checked live for `deepseek-v4-flash-0731`: DeepInfra and DigitalOcean advertise
`structured_outputs`; StreamLake, BaseTen, CoreWeave and GMICloud advertise only
`response_format`. So a request can land on an endpoint that treats the schema as
a hint. The only symptom is `parseWithRepair` burning its retry budget and then
throwing — which reads as a model quality problem, not a routing problem.

The fix is OpenRouter's provider-routing flag: *"You can restrict requests only
to providers that support all parameters in your request using the
`require_parameters` field… When you set `require_parameters` to true, the
request won't even be routed to that provider."*

Today `reviewer-core/src/llm/openrouter.ts:74-77` sends `response_format` with
`strict: true` and **no `provider` field at all**, and `StructuredRequest`
(`server/src/vendor/shared/adapters.ts:55-70`) has no field to carry one. Step 3
adds it.

### 3. No prior art exists for the CRITICAL escape hatch

Nothing published describes "suppress out-of-scope comments, but always surface
a genuinely serious out-of-scope problem". The surveyed products filter by
severity or by category, never by scope with a severity override:

- **Qodo PR-Agent** (the only one whose prompts are inspectable) derives a
  `PRType` enum in `/describe` — `Bug fix / Tests / Enhancement / Documentation /
  Other` — entirely separately from the review pass. Its reviewer prompt has no
  PR-scope concept at all; the only "scope" in it is lexical ("an opening brace
  or statement that begins a new scope"). Its closest analogue is
  `TicketCompliance`, which compares the code to ticket requirements rather than
  tagging findings.
- **CodeRabbit** runs a walkthrough/summary before line comments and has a
  post-generation verification layer, but its severity labels are described as a
  **user-facing** filter, not an automated scope filter.
- **Cursor BugBot** suppresses by **category** ("filters out categories where
  false positive rates are high, e.g. style suggestions"), not by scope.
- **GitHub Copilot** and **Graphite Diamond** publish a summary-then-comments UX
  and general "context-aware analysis" claims, with no documented scope filter.

So the rule in §Contracts is **original, unvalidated design**. Two consequences:
it strengthens the case for a deterministic server-side gate over a prompt
instruction (there is no vendor prompt to copy), and it makes measuring the
result with `docs/l02-experiment.md` a required follow-up rather than optional
polish.

### 4. The deterministic confidence tier is the supported choice

Xiong et al. (ICLR 2024): LLMs *"when verbalizing their confidence, tend to be
overconfident, potentially imitating human patterns of expressing confidence."*
Sanz-Guerrero et al.: models *"assign up to 26% higher confidence to their own
responses"* than to identical answers reframed as user-provided — which is
precisely this case, since the same call both derives the intent and rates it.

This matches root `INSIGHTS.md` (2026-08-02) on `findings.confidence` returning
`1.0` for a hallucination, and the engine's existing practice of always
recomputing the score rather than trusting the model's number
(`reviewer-core/AGENTS.md` §Conventions).

Also confirmed: GitHub's closing keywords are **nine** stems — `close, closes,
closed, fix, fixes, fixed, resolve, resolves, resolved` — effective only against
the default branch, and the authoritative retrieval path is the GraphQL
`closingIssuesReferences` connection on `PullRequest`. The regex at
`octokit.ts:127` makes the keyword optional and checks three of the nine, taking
the first match — so `see #123 for context` resolves as a closing link.

---

## Scope

### In

- One cheap OpenRouter classification call per derivation, producing
  `Intent { intent, in_scope[], out_of_scope[] }` plus a validated confidence
  and evidence list.
- Sources: PR title + body, linked issue, linked plan/spec, hunk headers,
  commit messages. **Never diff bodies.**
- Persistence on the existing `pr_intent` table, extended with metadata, keyed
  by `head_sha` so staleness is decidable.
- `GET` / `POST /pulls/:id/intent`, the latter with `{ force }`.
- A new optional `## PR intent (derived)` prompt slot in `reviewer-core`.
- A deterministic post-grounding scope gate with a CRITICAL escape hatch.
- An intent card on the PR page.
- The `review_intent` feature-model default pointed at the pinned DeepSeek slug,
  with a matching `pricing.ts` row.
- `provider: { require_parameters: true }` support on `StructuredRequest`,
  opt-in.
- Run-log, trace and pino observability.

### Out

- **Smart diff.** `modules/index.ts:23` reserves "intent/smart-diff" as one
  slot; only intent is built here.
- **The rest of `PrBrief`.** `pr_brief` (`db/schema/reviews.ts:101`),
  `BlastRadius`, `Risks`, `PR History` and `SmartDiff` stay untouched and
  unwired. The `brief` i18n namespace is reused for copy only.
- **Backfilling intent for existing PRs.** No job, no data migration. Intent
  appears on first review or first explicit `POST`.
- **Persisting `linked_issue` on `pull_requests`.** The intent slice fetches it
  per derivation.
- **Fixing the loose regex at `octokit.ts:127`.** Left as documented
  imprecision; the intent slice carries its own stricter parser. See Risks 6.
- **Reconciling the `onboarding` feature's older DeepSeek snapshot** with the
  one pinned here.
- **Turning `require_parameters` on globally** for every existing review run.
- **Wiring `pnpm arch` into CI.** Still an open question in root `INSIGHTS.md`
  (2026-08-02).
- **Showing suppressed out-of-scope findings in the UI.**
  `ReviewOutcome.scopeDropped` is logged and discarded.
- **Measuring the quality effect.** Running `docs/l02-experiment.md` against L03
  is its own task with its own report; this plan only names it as required.
- **e2e flows.** No `e2e/specs/*.flow.json` is added.
- **Architecture and security verdicts.** Named in §Handoff, judged by
  `architecture-reviewer` and the security review.

---

## Constraints that bind

| Rule | Applies? | What the implementation must do |
|---|---|---|
| `@devdigest/shared` exists twice | **yes** | Step 1 edits four contract files under `server/src/vendor/shared/contracts/` and the identical four under `client/src/vendor/shared/contracts/`; Step 3 edits `adapters.ts` in both. Port in the **same** step, then `./scripts/check-shared-sync.sh`. Do **not** `diff -r` the trees (root `INSIGHTS.md` 2026-08-02); diff only the touched file with comment lines stripped. `client/src/lib/feature-models.ts` is a **third** copy of the registry. |
| a field on a **jsonb-persisted** contract | **yes** | `PromptAssembly.intent` (persisted whole inside `run_traces.trace`), `Finding.scope` (embedded in `eval_cases.expected_output` / `eval_runs.actual_output`), and every new `PrIntentRecord` field: all `.nullish()`, never `.nullable()`. |
| a DB-backed test | **yes** | `server/test/intent.it.test.ts` — the suffix is a CI gate, not a style choice. Run the lane with `--no-file-parallelism` and read the **count**. |
| a migration | **yes** | One **additive-only** migration on `pr_intent` via `cd server && pnpm db:generate`, applied by hand with `pnpm db:migrate`. Additive-only keeps `drizzle-kit` non-interactive (`server/INSIGHTS.md` 2026-08-05). Existing files in `src/db/migrations/**` are never edited. |
| ring / import direction | **yes** | New slice `modules/intent/` is rings 2/3/5; `reviewer-core/src/scope.ts` is ring 1; `container.intent` is ring 4. Verified against `server/.dependency-cruiser.cjs` below. Run `cd server && pnpm arch` after every server/engine step — it is **not** in CI. |
| `reviewer-core` | **yes** | `scope.ts` takes findings + a boolean and returns findings. No DB, no fetch, no `node:*`. Exported from `src/index.ts`. `pnpm typecheck` **is** its build. |
| new file placement in `client/` | **yes** | `IntentCard` has one consumer → `client/src/app/repos/[repoId]/pulls/[number]/_components/IntentCard/`. Do **not** promote it to `src/components/`. Hooks go in `client/src/lib/hooks/intent.ts`, re-exported from the existing barrel. |
| a secret | **no** | The OpenRouter key is resolved by `container.llm('openrouter')` through `SecretsProvider`, exactly as today. No new secret, no new key path, nothing new in `AppConfig` or the DB. |
| any `CLAUDE.md` / `AGENTS.md` | **no new row required** | `specs/` is already listed in `AGENTS.md` §Read when. If any `AGENTS.md` is edited, edit `AGENTS.md` — `CLAUDE.md` stays a symlink, mode `120000`. |
| empty tables (`ci_*`, `eval_*`, `memory`, `digests`, …) | **yes, as a prohibition** | `pr_brief`, `digests`, `memory`, `eval_*` are **not** touched. |
| a new rule in an agent `system_prompt` | **no — deliberately** | No `agents.system_prompt` is edited and `docs/agent-prompts/*.md` is untouched. Both the scope label and the intent block reach the model through the **schema** (`Finding.scope.describe()`) and a **prompt slot** — the route root `INSIGHTS.md` (2026-08-05) prescribes and (2026-08-02) measured as strictly better. |

### The arch verdict on `container.intent`, with the rule name

`no-cross-slice-import` (`server/.dependency-cruiser.cjs:128-139`) is defined as
`from: { path: '^src/modules/([^/]+)/' }` → `to: { path: SLICE_PRIVATE, pathNot:
'^src/modules/$1/' }`, with
`SLICE_PRIVATE = '^src/modules/[^/]+/(service|repository|routes|helpers|run-executor)'`
(`:65`).

Three consequences, all load-bearing:

1. `modules/reviews/run-executor.ts` importing `modules/intent/service.ts`
   **fires the rule** — `run-executor` is inside `^src/modules/`, and
   `intent/service` matches `SLICE_PRIVATE`. This is the exact failure
   `server/INSIGHTS.md` (2026-08-05) records.
2. `src/platform/container.ts` importing `modules/intent/service.ts` **does not
   fire it** — `container.ts` is not under `^src/modules/`, so the `from`
   selector never matches. The container already does this for
   `modules/{agents,skills,reviews}/repository.js` and
   `modules/repo-intel/service.js` (`container.ts:25-29`). **The
   `container.intent` facade is therefore valid, and this is the rule that says
   so.**
3. `run-executor.ts` importing `type { IntentFacade } from '../intent/types.js'`
   is legal twice over: `types.ts` is not in `SLICE_PRIVATE`, and
   `tsPreCompilationDeps: false` (`:216`) means a type-only import produces no
   graph edge at all.

Two traps this creates, both to be respected by discipline because no rule
catches them:

- `no-sql-in-service` (`:88-101`) matches only `(service|helpers).ts`. A file
  named `pipeline.ts` **escapes it**, which is the honesty problem
  `server/INSIGHTS.md` (2026-08-05) names about `conventions/extract-pipeline.ts`.
  Rule for this plan: **all Drizzle lives in `modules/intent/repository.ts`**;
  `pipeline.ts` may not import `drizzle-orm` or `src/db/*`.
- `SLICE_PRIVATE` does not cover `pipeline.ts` or `constants.ts`, so another
  slice could import them without tripping the gate. Nothing outside
  `modules/intent/` may import anything from it except `types.ts`.

---

## Modules touched

| Package | Path | Ring / layer | Why |
|---|---|---|---|
| server | `src/vendor/shared/contracts/{findings,trace,review-api,platform}.ts` | 0 · contracts | `Finding.scope`, `PromptAssembly.intent`, `PrIntentRecord` metadata, `review_intent` default |
| client | the same four under `src/vendor/shared/contracts/` | 0 · contracts (manual copy) | same four edits, same step |
| client | `src/lib/feature-models.ts` | shared config | third copy of the registry |
| server | `src/vendor/shared/adapters.ts` | 0 · contracts | `StructuredRequest.providerRouting` |
| client | `src/vendor/shared/adapters.ts` | 0 · contracts (copy) | same |
| server | `src/adapters/llm/pricing.ts` | 3 · infrastructure | a row for the pinned DeepSeek slug |
| server | `src/db/schema/reviews.ts` | 3 · infrastructure | additive columns on `pr_intent` |
| server | `src/db/migrations/00NN_*.sql` | sentinel | generated, never hand-edited |
| reviewer-core | `src/llm/openrouter.ts` | 1 · pure core | send `provider` when asked |
| reviewer-core | `src/scope.ts` (new), `src/prompt.ts`, `src/review/run.ts`, `src/index.ts` | 1 · pure core | the scope gate, the `## PR intent (derived)` slot, the wiring, the barrel |
| server | `src/modules/intent/{constants,types,helpers,repository,pipeline,service,routes}.ts` (new) | 2/3/5 | the new slice |
| server | `src/modules/index.ts` | 5 · delivery | one import + one entry |
| server | `src/platform/container.ts` | 4 · composition root | `container.intent` + `ContainerOverrides.intent` |
| server | `src/modules/reviews/{run-executor,helpers}.ts` | 2 · application | pre-work step, prompt slot, token attribution, scope-drop logging |
| client | `src/lib/hooks/{intent.ts,index.ts}` | data layer | `usePrIntent` / `useDeriveIntent` |
| client | `src/app/repos/[repoId]/pulls/[number]/_components/IntentCard/**` (new) | route-local component | the card |
| client | `src/app/repos/[repoId]/pulls/[number]/_components/OverviewTab/OverviewTab.tsx` | route-local component | renders the card |
| client | `messages/en/brief.json` | i18n catalogue | missing keys only |

---

## Skills — read by the planner, to be loaded by the implementer

Every row below is a skill the planner opened. The last column is the rule it
imposes **on this plan**.

| Path glob | Skill | Sections | `routing.md` row | Rule it imposes here |
|---|---|---|---|---|
| `server/src/modules/intent/routes.ts` | `backend-onion-architecture` **(preloaded)** | §6 the Fastify edge, §2 dependency rule | Backend row 1 | `routes.ts` is HTTP + Zod only. No SQL, no logic, no `FastifyRequest` passed inward. |
| same | `fastify-best-practices` | `rules/routes.md`, `rules/schemas.md`, `rules/error-handling.md` | Backend row 2 | Schema-first: `withTypeProvider<ZodTypeProvider>()` + `{ schema: { params, body } }`; throw `AppError` subclasses, never `reply.code(500)`. |
| same | `security` | A01 access control, A05 injection, A06 rate limiting | Backend row 3 | `POST /pulls/:id/intent` spends money → its own `config.rateLimit` (repo precedent `reviews/routes.ts:29`, `max: 10`). Every source string is attacker-controlled. Path inputs get an allowlist, never a blacklist. |
| `server/src/modules/intent/repository.ts` | `backend-onion-architecture` **(preloaded)** | §5 repositories | Backend row 4 | Constructor takes `Db`, not `Container`. Nothing Drizzle-shaped crosses the boundary. Every method workspace-scoped. |
| same | `drizzle-orm-patterns` | schema definition, queries, `onConflictDoUpdate` | Backend row 5 | Keep the existing upsert shape (`pull.repo.ts:49-63`). `references()` is a constraint, not an index. |
| `server/src/db/schema/reviews.ts` | `postgresql-table-design` | data types, constraints, indexing | Backend row 6 | `timestamptz` for `generated_at`, `text` not `varchar(n)`, jsonb for `sources`. New columns nullable → no table rewrite. No index: `pr_id` is the PK and every read is by PK. |
| same | `drizzle-orm-patterns` | migrations | Backend row 6 | `generate` + `migrate`, never `push`. |
| `server/src/db/migrations/**` | — | — | Backend row 7 | **Sentinel.** Generated file, never hand-edited. |
| `server/src/modules/intent/{service,helpers,constants,pipeline,types}.ts`, `server/src/modules/reviews/{run-executor,helpers}.ts`, `server/src/modules/index.ts` | `backend-onion-architecture` **(preloaded)** | §1 rings, §3 ports, §8 placement, §11 anti-patterns | Backend row 8 | A facade port states its **degraded contract** and never throws (§3, the `RepoIntel` shape). A signature is declared once. A ring-2 service may read `container.<port>` but **never `container.db`**. |
| `server/src/platform/container.ts` | `backend-onion-architecture` **(preloaded)** | §4 composition root | Backend row 9 | Lazy `??=`, override-first, so `ContainerOverrides` stays a test seam. |
| `server/test/**` | `backend-onion-architecture` **(preloaded)** | §9 testing per ring | Backend row 10 | Pure helpers tested directly; the service through `buildApp({ overrides })`; DB tests only in `*.it.test.ts`. **Read the count, not the exit code.** Every new port needs a mock in `adapters/mocks.ts`. |
| `reviewer-core/src/{scope,prompt,index}.ts`, `reviewer-core/src/review/run.ts`, `reviewer-core/src/llm/openrouter.ts` | `backend-onion-architecture` **(preloaded)** | §7 the pure core | Engine row 1 | Zero I/O. Public API grows only via `src/index.ts`. All untrusted content through `wrapUntrusted`. The score is always recomputed from the findings that survived. |
| `reviewer-core/src/prompt.ts` | — | — | Engine row 4 | Sentinel **only if `INJECTION_GUARD` changes**. It does not — see Risks 2. |
| `reviewer-core/src/grounding.ts` | — | — | Engine row 3 | **Sentinel — not touched at all.** `scope.ts` is a new sibling deliberately mirroring its shape. |
| `reviewer-core/test/**` | `backend-onion-architecture` **(preloaded)** | §9 | Engine row 6 | Hermetic: a stub `LLMProvider`, no key, no network, no Docker. |
| `*/src/vendor/shared/**`, any changed `z.object(` | `zod` | `schema-`, `object-optional-vs-nullable`, `type-use-z-infer`, `error-` | Contracts rows 1-2 | `.nullish()` on every jsonb-persisted addition; `z.infer` for the type, both exported; `.describe()` is what the model reads. Canon first, client copy in the same commit. |
| `client/src/app/**/*.tsx` | `frontend-ui-architecture` **(preloaded)** | §1 placement, §2 promotion, §3 boundaries, §5 business logic | Frontend row 1 | One consumer → route-local `_components/<Name>/`. No cross-`_components` import. No data fetching in a component. |
| same | `react-best-practices` | Derive-don't-store, useEffect rules, conditional rendering, a11y | Frontend row 2 | No `useEffect` copying server state into `useState`. `{count > 0 && …}`, never `{count && …}`. Icon-only buttons need `aria-label`. Ignore its retracted container/presentational and 200-line rules — `routing.md` §Demotion list. |
| `client/src/lib/hooks/intent.ts` | `frontend-ui-architecture` **(preloaded)** | §1 placement, §2, §6 constants | Frontend row 6 | The data layer is `src/lib/hooks/<domain>.ts` through `apiFetch`; a mutation invalidates its keys in `onSuccess`. |
| `client/src/app/**/IntentCard/IntentCard.test.tsx` | `react-testing-library` | query priority, `userEvent`, async | Frontend row 5 | `getByRole` first; `userEvent.setup()` before `render`; wrap in `NextIntlClientProvider` with the real `messages/en/brief.json` (repo pattern at `RunHistory.test.tsx:9-11`). |
| `client/messages/en/brief.json` | — | — | **no row matched** | `routing.md` covers `client/src/i18n/**`, not `client/messages/**`. Only the repo rule applies: English. |
| `specs/l03-intent-layer.md` | — | — | Contracts row 8 | `scripts/**`, `docs/**`, `specs/**` load no skill; repo rules only. |
| `typescript-expert` | **not opened** | — | Contracts row 7 — "lowest priority, and only for a type-level change" | No type-level programming in this plan. |

---

## Contracts

**`server/src/vendor/shared/contracts/brief.ts` — unchanged.** `Intent` stays
exactly the model's structured-output core and the DB mapper's shape. This is the
`AgentVersionConfig` role split (root `INSIGHTS.md` 2026-08-03): the strict shape
stays strict, the lenient/extended shapes are new siblings.

**`contracts/review-api.ts`** — `PrIntentRecord` gains metadata, every field
`.nullish()`:

```
PrIntentRecord = Intent.extend({
  pr_id: z.string(),
  head_sha: .nullish()                                    // the commit the intent was derived from
  confidence: z.enum(['high','medium','low']).nullish()   // DETERMINISTIC, server-computed
  model_confidence: z.number().min(0).max(1).nullish()    // the model's claim, stored not trusted
  sources: z.array(SourceLabel).nullish()                 // LABELS only, never content
  provider: .nullish()
  model: .nullish()
  generated_at: z.string().nullish()                      // ISO
  stale: z.boolean().nullish()                            // derived at read: head_sha !== pull.head_sha
})
```

`sources` is a closed enum of labels — `pr_title_body`, `linked_issue`,
`linked_spec`, `hunk_headers`, `commit_messages` — not free text and never the
content itself. That is what makes requirement 6 checkable and "no excess diff
content" enforceable by the type.

**`contracts/findings.ts`** — `Finding.scope`, following `Finding.skill`
(`:88-96`) exactly:

```
scope: z.enum(['in_scope','out_of_scope']).nullish().describe(
  'Whether this finding falls inside the PR intent stated in the "## PR intent (derived)" ' +
  'section. Set "out_of_scope" ONLY when the issue is unrelated to that stated scope. ' +
  'Label honestly and NEVER omit or downgrade a finding because it is out of scope — ' +
  'the label is metadata, not permission to withhold. Set null when no intent was given.'
)
```

`.nullish()` because `Finding` is embedded in the `eval_cases.expected_output` /
`eval_runs.actual_output` jsonb documents — the same reason `skill` is
(`findings.ts:81-82`). No DB column is added: `findingRowToDto`
(`reviews/helpers.ts:34-53`) already omits `skill`, and an omitted optional field
typechecks.

**`contracts/trace.ts`** — `PromptAssembly.intent: z.string().nullish()`, sited
next to `pr_description` (`:50`) with the same one-line rationale comment.
`.nullish()` because `RunTrace` is one jsonb document and every existing trace
lacks the key. No `RunStats` change; the classifier's tokens are logged, not
folded into the review run's totals.

**`contracts/platform.ts`** — `FEATURE_MODELS`'s `review_intent` entry
(`:53-58`): `defaultProvider: 'openrouter'`,
`defaultModel: 'deepseek/deepseek-v4-flash-0731'`. `FeatureModelId` unchanged.
See §"External findings of record" 1 for why the dated slug and not `-latest`.

**`adapters.ts`** — `StructuredRequest` gains one optional field:

```
/**
 * OpenRouter provider routing. `{ requireParameters: true }` restricts the
 * request to providers that support every parameter sent — in particular
 * `response_format`. Structured-output support on OpenRouter is per ENDPOINT,
 * not per model, so without this a request can land on a provider that treats
 * the schema as a hint and the only symptom is the repair loop exhausting its
 * retries. Ignored by non-OpenRouter providers.
 */
providerRouting?: { requireParameters?: boolean };
```

**Not in `vendor/shared`:** the classifier's structured-output schema. It lives
in `server/src/modules/intent/constants.ts` as
`IntentClassification = Intent.extend({ confidence: …, evidence_used: … })` with
the instructions in `.describe()`. It is neither a wire DTO nor a persisted
document, so it does not belong in ring 0 — same placement as `Extraction` in
`modules/conventions/constants.ts`. This keeps the two-copy sync surface as small
as possible.

---

## Steps

### Step 1 — Contracts, both copies, plus the registry mirror

- **Files:** `server/src/vendor/shared/contracts/{findings,trace,review-api,platform}.ts`;
  the four identically-named files under `client/src/vendor/shared/contracts/`;
  `client/src/lib/feature-models.ts`
- **Change:** apply the four contract edits described in §Contracts, canon first,
  then port each one to the client copy verbatim. In
  `client/src/lib/feature-models.ts:21-27` set `defaultProvider: "openrouter"`
  and `defaultModel: "deepseek/deepseek-v4-flash-0731"` (double quotes — the
  client file uses them). Nothing else in `vendor/**` is reorganised.
- **Skill:** `zod` §`object-optional-vs-nullable` — `.optional()`/`.nullish()`
  accepts a **missing key**, `.nullable()` does not; every one of these lands in
  a document already on disk. Plus `backend-onion-architecture` §3 — "Adding a
  port to ring 0 is a two-file commit… change the canon, port the copy in the
  same commit", and `vendor/**` is extended, never reorganised.
- **Verify:**
  ```
  cd server && pnpm typecheck && pnpm arch
  cd client && pnpm typecheck
  ./scripts/check-shared-sync.sh
  diff <(grep -v '^\s*[/*]' server/src/vendor/shared/contracts/findings.ts) \
       <(grep -v '^\s*[/*]' client/src/vendor/shared/contracts/findings.ts)
  ```
- **Done when:** `check-shared-sync.sh` exits 0; `rg -n "scope"` on both
  `findings.ts` copies shows the new field; `rg -n "deepseek-v4-flash-0731"`
  shows the slug in all three registry copies — server vendor, client vendor,
  `client/src/lib/feature-models.ts`.

  > **Corrected 2026-08-08, after `plan-verifier`.** This clause originally
  > demanded "exactly three hits". That was never achievable: Step 2 of this
  > same plan mandates a fourth occurrence in `server/src/adapters/llm/pricing.ts`,
  > and the test files add more. Check the three registry sites are present and
  > correct; do not count total matches.

### Step 2 — `pr_intent` metadata columns, the migration, and the pricing row

- **Files:** `server/src/db/schema/reviews.ts` (the `prIntent` table at `:92`);
  one **new** generated file under `server/src/db/migrations/`;
  `server/src/adapters/llm/pricing.ts`
- **Change:**
  - Add seven nullable columns to `prIntent` — `headSha: text('head_sha')`,
    `confidence: text('confidence')`,
    `modelConfidence: doublePrecision('model_confidence')`,
    `sources: jsonb('sources').$type<string[]>()`, `provider: text('provider')`,
    `model: text('model')`,
    `generatedAt: timestamp('generated_at', { withTimezone: true })`. All
    nullable and all additive — no drop, no rename — so `drizzle-kit generate`
    cannot go interactive. Add a comment stating why `head_sha` exists (it is
    what makes "the PR moved, re-derive" decidable). **No index:** `pr_id` is the
    primary key and every read is `WHERE pr_id = $1`.
  - Add a **new** row to `pricing.ts` for `'deepseek/deepseek-v4-flash-0731'` at
    `{ in: 0.09, out: 0.18 }`, with a comment recording the verification date and
    that the existing `deepseek/deepseek-v4-flash` row (`:31`, `{ in: 0.14, out:
    0.28 }`) is a **different, older snapshot** and must not be reused for this
    slug. Do not modify the existing row.
- **Skill:** `postgresql-table-design` §Data Types — `timestamptz` for event
  time, never bare `timestamp`; `text` over `varchar(n)`; §Safe Schema Evolution
  — a nullable column with no volatile default does not rewrite the table.
  `drizzle-orm-patterns` §migrations — `generate` + `migrate`, never `push`.
- **Verify:**
  ```
  cd server && pnpm db:generate     # must exit non-interactively, writing ONE new file
  cd server && pnpm db:migrate
  cd server && pnpm typecheck && pnpm arch
  ```
- **Done when:** exactly one new file appears under `server/src/db/migrations/`,
  containing only `ALTER TABLE "pr_intent" ADD COLUMN` statements and no `DROP`;
  `git status` shows no modification to any pre-existing migration;
  `pnpm db:migrate` applies cleanly; `pricing.ts` has two distinct DeepSeek rows.

### Step 3 — OpenRouter provider-routing guard

- **Files:** `server/src/vendor/shared/adapters.ts`,
  `client/src/vendor/shared/adapters.ts`, `reviewer-core/src/llm/openrouter.ts`
- **Change:** add `providerRouting?: { requireParameters?: boolean }` to
  `StructuredRequest` (both copies, §Contracts wording). In `openrouter.ts`, send
  it only when talking to OpenRouter and only when asked, using the same
  conditional-spread shape the file already uses for `session_id` (`:80`) and
  `usage` (`:83`):
  ```ts
  ...(this.id === 'openrouter' && req.providerRouting?.requireParameters
    ? { provider: { require_parameters: true } }
    : {}),
  ```
  **Opt-in, not default on.** Turning it on for every structured call would
  change the routing of every existing review run — a blast radius this feature
  has no mandate to take on, and one that would be invisible until a provider
  that used to serve reviews stopped being eligible. The intent call passes it
  explicitly; review runs are untouched until someone decides otherwise, which
  is recorded as Risks 17.
- **Skill:** `backend-onion-architecture` §7 — the pure core takes what it needs
  as a parameter and grows its public surface only through the barrel (this is a
  field on an existing exported interface, so the barrel is unchanged). `zod`
  Contracts row 1 — canon first, client copy in the same commit.
- **Tests:** extend `reviewer-core/test/openrouter.test.ts` (or add it) with a
  stub `OpenAI` client capturing the request body: with
  `providerRouting: { requireParameters: true }` the body carries
  `provider: { require_parameters: true }`; without it, the body has **no**
  `provider` key at all; and with `id: 'openai'` the key is absent even when
  asked.
- **Verify:**
  ```
  cd reviewer-core && pnpm typecheck && pnpm test
  cd server && pnpm typecheck && pnpm arch
  ./scripts/check-shared-sync.sh
  ```
- **Done when:** the three request-shape tests pass; `git diff` on
  `openrouter.ts` shows one added spread and nothing else.

### Step 4 — `reviewer-core`: the scope gate, the prompt slot, the wiring

- **Files:** `reviewer-core/src/scope.ts` (new), `reviewer-core/src/prompt.ts`,
  `reviewer-core/src/review/run.ts`, `reviewer-core/src/index.ts`
- **Change, in four parts:**

  **(a) `scope.ts` — a new pure module, deliberately mirroring `grounding.ts`**
  (which is a sentinel and is not touched). It exports:
  ```ts
  export interface ScopeResult { kept: Finding[]; dropped: { finding: Finding; reason: string }[] }
  export function applyScopeGate(findings: Finding[], hasIntent: boolean): ScopeResult
  ```
  Rules, in order:
  1. `hasIntent === false` → `{ kept: findings, dropped: [] }`. **Identity, not a
     copy-with-filter** — the no-op must be provably a no-op.
  2. Keep every finding whose `scope` is not exactly `'out_of_scope'` (so
     `null`, `undefined` and `'in_scope'` all pass).
  3. Keep **every** `severity === 'CRITICAL'` out-of-scope finding,
     unconditionally. This is the "one signal" requirement and the reason the
     gate cannot be talked out of a real defect.
  4. Of the remaining out-of-scope findings, keep **at most one** — the highest
     severity, ties broken by input order — and drop the rest with
     `reason: "out of the PR's stated scope (N similar dropped)"`.
  5. Never reorder the kept findings relative to their input order.

  **(b) `prompt.ts` — one new optional slot.** `PromptParts.intent?: string`
  documented like `prDescription` (`:62-68`): untrusted, delimiter-wrapped,
  omitted when empty. In `assemblePrompt`, insert between the `prDescription`
  push (`:106-108`) and the skills push (`:109`):
  ```ts
  if (parts.intent && parts.intent.trim().length > 0) {
    userSections.push(`## PR intent (derived)\n${wrapUntrusted('intent', parts.intent)}`);
  }
  ```
  and add `intent: parts.intent ?? null` to the `assembly` object (`:129-138`).
  **`INJECTION_GUARD` (`:16-28`) is not touched** — it already names "derived
  intent/scope" as untrusted (`:18`) and already forbids stated intent from
  descoping a real defect (`:21-28`), which is precisely the guarantee this
  feature needs.

  **(c) `review/run.ts` — three edits.** `ReviewInput.intent?: string`
  documented with the same omit-when-empty contract as `callers`/`repoMap`
  (`:61-70`); `intent: input.intent` added to `promptParts` (`:130-139`); and the
  gate applied between grounding and scoring:
  ```ts
  const scoped = applyScopeGate(ground.kept, Boolean(input.intent?.trim()));
  for (const d of scoped.dropped) emit('info', `scope dropped "${d.finding.title}": ${d.reason}`);
  ```
  with the return becoming
  `review: { ...merged, findings: scoped.kept, score: scoreFromFindings(scoped.kept) }`
  and a new `scopeDropped: scoped.dropped` field on `ReviewOutcome`. Update the
  comment at `:204-206` so it still describes what actually happens.

  **(d) `index.ts` — export `applyScopeGate` and `type ScopeResult`**, in a block
  commented like the grounding one at `:22-23`.

- **Skill:** `backend-onion-architecture` §7 — zero I/O; "the public API grows
  only via `src/index.ts`"; "all untrusted content goes through `wrapUntrusted`";
  "the score is always recomputed by `scoreFromFindings` from the findings that
  survived". The gate deliberately keeps the shape of `grounding.ts` (a sibling,
  not an edit) because §7 names both as gates, not code.
- **Tests (hermetic, ring 1, no container):** `reviewer-core/test/scope.test.ts`,
  at minimum —
  1. **no-intent no-op:** `applyScopeGate(fs, false)` returns the *same array
     identity* and `dropped` is empty;
  2. **CRITICAL escape hatch:** two out-of-scope findings, one CRITICAL and one
     SUGGESTION → the CRITICAL is kept **and** so is one other; a run with
     *three* out-of-scope CRITICALs keeps all three;
  3. **collapse:** four out-of-scope WARNING/SUGGESTION findings → exactly one
     kept (the WARNING) and three dropped, each with a reason string;
  4. **passthrough:** `scope: null` / `'in_scope'` / `undefined` are all kept
     when intent is present;
  5. **order preserved** among kept findings.

  Plus in `reviewer-core/test/prompt.test.ts`: **byte-identical assembly with no
  intent** — assert the `user` string for `{...parts}`,
  `{...parts, intent: undefined}` and `{...parts, intent: '   '}` are `===`; and
  with an intent, that the section appears exactly once, after
  `## PR description`, before `## Skills / rules`, wrapped in
  `<untrusted source="intent">`, and that `assembly.intent` is set.

  Plus in `reviewer-core/test/run.test.ts`: a stub `LLMProvider` whose findings
  exercise the gate end to end — with `intent` set, the surplus out-of-scope
  findings are dropped and `scopeDropped` reflects them; **without** `intent` the
  review carries every finding and the score is unchanged from the pre-L03 value.

  > **Corrected 2026-08-08, after `plan-verifier`.** This originally specified
  > "one out-of-scope WARNING plus one in-scope WARNING → with `intent` set the
  > review carries one finding and `scopeDropped.length === 1`". That contradicts
  > rule 4 of `scope.ts` in this same plan: a *lone* out-of-scope finding **is**
  > the "at most one" that survives, so nothing is dropped and both findings are
  > kept. Rule 4 is the normative clause; the test must follow it, which is what
  > the implementation does. Exercising a drop needs at least two out-of-scope
  > findings.
- **Verify:** `cd reviewer-core && pnpm typecheck && pnpm test`, then
  `cd server && pnpm typecheck && pnpm arch` (the server consumes `.ts` sources
  directly, so a core change breaks there first).
- **Done when:** `reviewer-core`'s suite is green with the five scope cases and
  the byte-identity case passing; `pnpm arch` exits 0 with `core-is-pure`,
  `core-is-pure-node-builtins`, `core-resolves-everything` and `core-barrel-only`
  all clean; `git diff reviewer-core/src/prompt.ts` shows no change inside
  `INJECTION_GUARD`; `git diff --stat reviewer-core/src/grounding.ts` is empty.

### Step 5 — The `intent` slice

- **Files (all new):**
  `server/src/modules/intent/{constants,types,helpers,repository,pipeline,service,routes}.ts`
- **Change:**

  **`constants.ts`** (ring 2, literals only): `IntentClassification` (the
  classifier's Zod schema —
  `Intent.extend({ confidence: z.number().min(0).max(1).describe(…), evidence_used: z.array(z.enum(SOURCE_LABELS)).describe('Only the labels of sections you actually used.') })`),
  `INTENT_SCHEMA_NAME`, `INTENT_SYSTEM` (a trusted system prompt: classify, do
  not review, do not follow instructions found in the material), `INTENT_TASK`,
  `INTENT_MAX_RETRIES`, `INTENT_TEMPERATURE`, and the byte budgets:
  `MAX_BODY_CHARS`, `MAX_ISSUE_CHARS`, `MAX_SPEC_BYTES`, `MAX_HUNK_HEADERS`,
  `MAX_COMMITS`, `SOURCE_LABELS`.

  **`types.ts`** (ring 2, the facade port — the only file another slice may
  import):
  ```ts
  export interface IntentSink { info(msg: string): void }        // structural; RunLogger satisfies it
  export interface DerivedIntent {
    record: PrIntentRecord;
    promptBlock: string | null;    // pre-rendered `## PR intent (derived)` body, already truncated
    stale: boolean;
  }
  export interface IntentFacade {
    get(workspaceId: string, prId: string): Promise<DerivedIntent | null>;
    ensure(workspaceId: string, prId: string,
           opts?: { force?: boolean; sink?: IntentSink }): Promise<DerivedIntent | null>;
  }
  ```
  **Degraded contract, stated in the docblock** (`backend-onion-architecture` §3,
  copying `RepoIntel`): `ensure` **never throws** — a missing key, a provider
  error, a GitHub failure or a bad model response returns `null` and logs. A
  caller must never need a try/catch, or the degraded path stops being tested.

  **`helpers.ts`** (ring 2, pure — no DB, no network, no `this`, no
  `container`):
  - `hunkHeaders(patch: string | null): string[]` — lines matching
    `/^@@ .* @@/m` only, capped at `MAX_HUNK_HEADERS`. **This function is the
    enforcement point for "diff bodies are never sent."**
  - `linkedIssueNumbers(body: string): number[]` — a **stricter** replacement for
    `octokit.ts:127`: requires one of GitHub's nine documented closing keywords
    (`close|closes|closed|fix|fixes|fixed|resolve|resolves|resolved`), collects
    *all* matches rather than the first, dedupes, caps at 3. Does not modify the
    adapter.
  - `linkedSpecPaths(body: string): string[]` — repo-relative `.md`/`.mdx` paths
    from markdown links or backticks. **Rejects** anything containing `..`, a
    leading `/`, a `~`, a URL scheme, or a NUL; caps the count. Allowlist by
    extension, not blacklist.
  - `deterministicConfidence(sources: SourceLabel[]): 'high'|'medium'|'low'` —
    `high` when a linked issue **or** a linked spec is present *and* the body is
    non-trivial; `medium` when a substantive body alone; `low` when only indirect
    signals (hunk headers, commit messages). This is what the UI shows.
  - `renderIntentBlock(record): string` — the plain-text block the engine wraps.
    Names the confidence tier and the source **labels**; never embeds spec or
    hunk content.
  - `validateClassification(raw, presented: SourceLabel[]): { sources: SourceLabel[]; rejected: string[] }`
    — keeps only `evidence_used` labels that were **actually put in the prompt**,
    exactly the discipline of `resolveSkillAttribution`
    (`reviews/helpers.ts:170-196`) and `grounding.ts`. Returns the rejects so
    they can be logged rather than swallowed.

  **`repository.ts`** (ring 3, **the only file here that may import Drizzle**):
  constructor takes `Db`. Methods: `getPull(workspaceId, prId)`
  (workspace-scoped), `getRepo(repoId)`, `getPrFiles(prId)`,
  `getPrCommits(prId, limit)`, `getIntent(prId)`, `upsertIntent(row)`, and
  optionally `getSpecChunks(repoId, paths)` reading `code_chunks` where
  `source = 'spec'`. `upsertIntent` keeps the existing
  `insert().onConflictDoUpdate` shape from `pull.repo.ts:49-63`, extended with
  the seven new columns. Row→DTO mapping stays in the repository; nothing
  Drizzle-shaped is returned.

  **`pipeline.ts`** (ring 2 — **no Drizzle, no `src/db`; it takes rows as
  parameters**): `collectSources(container, repo, pull, files, commits)` →
  `{ blocks: {label, text}[], labels: SourceLabel[] }` in the stated priority
  order — PR title+body → linked issue
  (`(await container.github()).getIssue(ref, n)`, best-effort, `ConfigError` and
  any throw degrade to skipping the label) → linked plan/spec
  (`container.git.readFile(ref, path)` for validated paths, truncated to
  `MAX_SPEC_BYTES`; `code_chunks` as a secondary route) → hunk headers → commit
  messages. Then one `assemblePrompt` + one `completeStructured` against
  `IntentClassification` with
  `providerRouting: { requireParameters: true }` (Step 3), mirroring
  `conventions/extract-pipeline.ts:87-106`. Every block is prefixed
  `SOURCE: <label>` and goes in the `diff` slot — because that slot is the only
  unconditional one and it is `wrapUntrusted`-wrapped (`server/INSIGHTS.md`
  2026-08-05); routing it through `repoMap` would additionally emit an empty Diff
  section.

  **`service.ts`** (ring 2, `implements IntentFacade`,
  `new IntentService(container)`): `ensure` returns the cached row when
  `head_sha` matches the pull's current `head_sha` and `force !== true`;
  otherwise resolves the model via
  `resolveFeatureModel(container, workspaceId, 'review_intent')`, collects
  sources, makes **one** call, validates with `validateClassification`, computes
  the deterministic confidence, upserts, and returns `DerivedIntent`. It reads
  `container.<port>` but **never `container.db`** — the `IntentRepository` is
  constructed with `container.db` once, in the constructor, which is the
  sanctioned line (§4).

  **`routes.ts`** (ring 5): `GET /pulls/:id/intent` → `200` with
  `DerivedIntent['record'] & { stale }`, or `404` via `NotFoundError` when no row
  exists; `POST /pulls/:id/intent` with
  `body: z.object({ force: z.boolean().optional() })`. Both use
  `withTypeProvider<ZodTypeProvider>()` with `schema: { params: IdParams, body: … }`
  — **no `Schema.parse(req.body)` in a handler** (`server/AGENTS.md`
  §Conventions; the failure is catalogued in `server/INSIGHTS.md` 2026-08-05).
  `POST` carries its own
  `config: { rateLimit: { max: 5, timeWindow: '1 minute' } }` because it spends
  money, mirroring `reviews/routes.ts:29`. `getContext(container, req)` for the
  workspace, as every module does.

  **`modules/index.ts`:** one import and one entry, `intent`, filling the slot
  the comment at `:23` reserved.

- **Skill:** `backend-onion-architecture` §8 placement table (route →
  `routes.ts`, validation → the route `schema:`, use-case logic → `service.ts`,
  SQL → `repository.ts`, pure transform → `helpers.ts`, literal →
  `constants.ts`, facade over a subsystem → `types.ts`), §3 "a facade port states
  its degraded contract" and "a signature is declared once", §5 "the constructor
  takes `Db`, not `Container`". `fastify-best-practices` `rules/schemas.md` —
  schema-first validation rejects with 422 before the handler runs. `security`
  A05/A06 — the spec-path allowlist, the per-route rate limit, and "trace the
  data flow" on every source. `drizzle-orm-patterns` — the upsert shape.
- **Tests:**
  - `server/test/intent-helpers.test.ts` (hermetic, ring 2): `hunkHeaders`
    returns **only** `@@` lines and never a `+`/`-`/context line, on a real
    multi-hunk patch; `linkedSpecPaths` rejects `../../etc/passwd`,
    `/etc/passwd`, `https://evil/x.md` and a `.md` inside a URL;
    `linkedIssueNumbers` requires the keyword, accepts all nine stems, and
    dedupes; `deterministicConfidence` returns `low` when only hunk headers and
    commits are present (the "no documentation" requirement);
    `validateClassification` discards a label never presented and reports it in
    `rejected`.
  - `server/test/intent.it.test.ts` (**`.it.test.ts` is a gate, not a
    preference**): with a mock `LLMProvider` and a mock `GitHubClient` from
    `adapters/mocks.ts` injected via `ContainerOverrides`,
    `POST /pulls/:id/intent` persists a `pr_intent` row with `head_sha`,
    `provider`, `model`, `sources` and a deterministic `confidence`; a second
    `POST` without `force` makes **no** LLM call (assert the mock's call count)
    and returns the cached row; with `force: true` it re-derives; after the
    pull's `head_sha` changes, `GET` reports `stale: true`; and — the
    load-bearing assertion — **the prompt handed to the mock provider contains
    the `@@` header lines and none of the patch body**.
- **Verify:**
  ```
  cd server && pnpm typecheck && pnpm arch
  cd server && pnpm exec vitest run intent --no-file-parallelism
  ```
- **Done when:** `pnpm arch` exits 0 — in particular `no-cross-slice-import`,
  `no-sql-in-routes`, `no-sql-in-service`, `no-adapter-impl-outside-root` and
  `no-circular` are all clean;
  `rg -n "drizzle-orm|src/db" server/src/modules/intent/{service,helpers,pipeline,routes}.ts`
  returns nothing; the integration file reports its full test **count**, with
  zero skipped.

### Step 6 — Container facade + the run-executor wire

- **Files:** `server/src/platform/container.ts`,
  `server/src/modules/reviews/run-executor.ts`,
  `server/src/modules/reviews/helpers.ts`
- **Change:**
  - `container.ts`: `import type { IntentFacade } from '../modules/intent/types.js'`
    and `import { IntentService } from '../modules/intent/service.js'` (legal from
    ring 4 — this file already imports four module internals at `:25-29`); add
    `intent?: IntentFacade` to `ContainerOverrides`; add a lazy override-first
    getter beside `repoIntel` (`:120`):
    ```ts
    get intent(): IntentFacade {
      if (this.overrides.intent) return this.overrides.intent;
      this._intent ??= new IntentService(this);
      return this._intent;
    }
    ```
  - `run-executor.ts`: inside `executeRuns`, immediately after the diff loads
    (`:114`), add a **best-effort** pre-work step in the shape of
    `buildCallersDigest` — a failure logs and continues, it never fails the run:
    ```ts
    const intent = await runLog.step('Deriving PR intent',
      () => this.container.intent.ensure(workspaceId, pull.id).catch(() => null),
      { kind: 'tool' });
    ```
    then `runLog.info(...)` lines carrying: the source **labels**, the tier,
    `provider/model`, `tokens_in`/`tokens_out`, cost (`null` when unknown, never
    `0`), and any labels rejected by `validateClassification`. In `runOneAgent`,
    pass `...(intent?.promptBlock ? { intent: intent.promptBlock } : {})` into
    `reviewPullRequest` — the same omit-when-empty contract as
    `callers`/`repoMap` (`:238-240`), so a PR with no intent produces a
    byte-identical prompt. After the call, log `outcome.scopeDropped.length` when
    non-zero. Correct the five stale docblocks — `:45-46`, `:58-59`, `:69-70`,
    `:157`, `:356-357` — which claim intent is already loaded.
  - `helpers.ts`: add `['intent', assembly.intent]` to the `sections` array in
    `promptTokenCounts` (`:107-116`). **This is not automatic** — the array is an
    explicit list of eight pairs, and without the row `token_counts.intent` is
    silently absent.
- **Skill:** `backend-onion-architecture` §4 — "never `new` an adapter outside
  `platform/container.ts`", lazy `??=`, override-first so `ContainerOverrides`
  stays a test seam; §4 again — "cross-slice access goes through the container,
  not through an import", which is the rule that makes this legal where a direct
  import is not. §11 — no pass-through service method that only forwards.
- **Tests:** extend `server/test/reviews.it.test.ts` with two cases — (a) with an
  `IntentFacade` override returning a block, `trace.prompt_assembly.intent` is
  non-null and `trace.token_counts.intent > 0`; (b) with an override returning
  `null`, `prompt_assembly.intent` is `null` and the run completes normally. Add
  one case asserting an `ensure` that **throws** still lets the review run to
  completion (the degraded contract). Note the known flake in this file
  (`server/INSIGHTS.md` 2026-08-05, `waitForPrRuns` counts every terminal run for
  the PR cumulatively) — reproduce on a clean detached worktree before blaming
  the change.
- **Verify:**
  ```
  cd server && pnpm typecheck && pnpm arch
  cd server && pnpm exec vitest run .it.test --no-file-parallelism
  cd server && pnpm exec vitest run --exclude '**/*.it.test.ts'
  ```
- **Done when:** `pnpm arch` is 0 (`no-cross-slice-import` clean despite
  `run-executor` now using intent); the integration lane reports every
  `.it.test.ts` file passing with **zero skipped**;
  `rg -n "intent" server/src/modules/reviews/run-executor.ts` shows no static
  import of `modules/intent/service.js`.

### Step 7 — Client: hooks, card, copy

- **Files:** `client/src/lib/hooks/intent.ts` (new),
  `client/src/lib/hooks/index.ts`,
  `client/src/app/repos/[repoId]/pulls/[number]/_components/IntentCard/{IntentCard.tsx,styles.ts,index.ts,IntentCard.test.tsx}`
  (new), `.../_components/OverviewTab/OverviewTab.tsx`,
  `client/messages/en/brief.json`
- **Change:**
  - `hooks/intent.ts`: `"use client"`,
    `const key = (prId) => ["pr-intent", prId]`, `usePrIntent(prId)` via
    `api.get<PrIntentRecord>(\`/pulls/${prId}/intent\`)` with
    `enabled: !!prId` and `retry: false` (a 404 is a normal "not derived yet"),
    and `useDeriveIntent(prId)` posting `{ force }` with
    `onSuccess: (data) => qc.setQueryData(key(prId), data)` — the response is
    authoritative, so writing it beats a refetch (the `useExtractConventions`
    precedent, `hooks/conventions.ts:28-35`). Add `export * from "./intent";` to
    the barrel.
  - `IntentCard.tsx`: props are **resolved data plus flags**, not an id it
    fetches from — `{ intent, loading, stale, onDerive, deriving }`
    (`frontend-ui-architecture` §4, "own the data boundary explicitly"). Renders
    the intent sentence, the in-scope and out-of-scope lists, the deterministic
    confidence tier, the source labels, and a "Re-derive" button. A stale badge
    when `stale` is true. When there is no intent, the empty state uses the
    existing `brief.unavailable` / `brief.unavailableHint`. Copy comes from
    `useTranslations("brief")` — no hard-coded user-facing string. The icon-only
    refresh control, if used, carries an `aria-label`.
  - `OverviewTab.tsx`: gains `prId` and `headSha` props, calls `usePrIntent` and
    `useDeriveIntent`, derives
    `stale = intent?.head_sha != null && intent.head_sha !== headSha` **during
    render** (never in state, never in an Effect), and renders `<IntentCard …/>`
    as the **first** section, above Description. `PrDetailView.tsx:164` passes
    `prId={prId}` and `headSha={pr.head_sha}`.
  - `brief.json`: add only the missing keys under the existing `brief` namespace
    — `inScope`, `outOfScope`, `confidence.{high,medium,low}`, `sources.*` (one
    label per `SourceLabel` value), `stale`, `rederive`, `deriving`. Do not
    duplicate `block.intent`, `unavailable` or `unavailableHint`, which already
    exist.
- **Skill:** `frontend-ui-architecture` §1 placement (one consumer → route-local
  `_components/<Name>/`), §2 promotion (do **not** pre-create a shared home), §5
  ("if it can be calculated from existing props or state, do not put it in
  state"), §"In this repo" (the data model is HTTP APIs through `apiFetch`; a
  mutation invalidates or writes its query key). `react-best-practices`
  §Derive-Don't-Store and §Conditional Rendering (`{n > 0 && …}`, never
  `{n && …}`). `react-testing-library` §Query Priority + §userEvent.
- **Tests:** `IntentCard.test.tsx`, wrapped in `NextIntlClientProvider` with the
  real `messages/en/brief.json` (the pattern at `RunHistory.test.tsx:7-11`), 2-3
  flow tests: renders intent + both scope lists + the confidence tier; shows the
  stale badge and calls `onDerive` when the user clicks Re-derive
  (`userEvent.setup()`, `getByRole('button', { name: /re-derive/i })`); shows the
  unavailable empty state when `intent` is null. Assert on what the user sees —
  never on hook internals or CSS.
- **Verify:** `cd client && pnpm typecheck && pnpm lint && pnpm test`
- **Done when:** all three client gates pass; no hard-coded user-facing string
  appears in `IntentCard.tsx`; the new component appears nowhere under
  `client/src/components/`.

### Step 8 — Register the spec

- **Files:** `specs/l03-intent-layer.md` (this document)
- **Change:** none beyond the file itself. `specs/README.md` already describes
  the directory; no `AGENTS.md` §Read when row is required because `specs/` is
  already listed there.
- **Skill:** none — `routing.md` Contracts row 8: `specs/**` loads no skill,
  repo rules only (English).
- **Verify:** `git ls-files -s '*CLAUDE.md'` still prints `120000` on every row.
- **Done when:** every acceptance criterion below is checkable against a
  `path:line`.

---

## Verification plan

| Package | Command | Runs when |
|---|---|---|
| server | `cd server && pnpm typecheck` | steps 1, 2, 3, 4, 5, 6 |
| server | `cd server && pnpm arch` | steps 1, 2, 3, 4, 5, 6 — **not in CI**, so by hand every time |
| server | `cd server && pnpm exec vitest run --exclude '**/*.it.test.ts'` | steps 5, 6 |
| server | `cd server && pnpm exec vitest run .it.test --no-file-parallelism` | steps 5, 6 — read the **count**, `N skipped` means unverified |
| server | `cd server && pnpm db:generate` then `pnpm db:migrate` | step 2 only |
| reviewer-core | `cd reviewer-core && pnpm typecheck && pnpm test` | steps 3, 4 |
| client | `cd client && pnpm typecheck && pnpm lint && pnpm test` | steps 1, 3, 7 |
| — | `./scripts/check-shared-sync.sh` | steps 1, 3 |

---

## Acceptance

Each line is phrased so `plan-verifier` can return a verdict with `path:line` or
verbatim command output.

1. **Classifier, one cheap call.** `server/src/modules/intent/pipeline.ts`
   contains exactly **one** `completeStructured` call, against
   `IntentClassification` from `modules/intent/constants.ts`, with the model
   resolved through
   `resolveFeatureModel(container, workspaceId, 'review_intent')`. Exactly one
   **call site** exists in the slice.

   > **Corrected 2026-08-08, after `plan-verifier`.** This originally read
   > "`rg -c "completeStructured" …` returns 1". `rg -c` counts matching *lines*,
   > and the implementation's own docblock names the function — so the correct
   > code returns 2. Count call sites, not mentions.
2. **Inputs are title+body, linked issue, plan/spec, and hunk headers.**
   `collectSources` emits blocks for all five `SOURCE_LABELS`, and
   `server/test/intent-helpers.test.ts` asserts `hunkHeaders` returns only
   `@@ … @@` lines.
3. **Diff bodies are never sent.** `server/test/intent.it.test.ts` asserts the
   prompt captured by the mock `LLMProvider` contains the `@@` header of a seeded
   patch and contains **none** of that patch's `+`/`-` lines.
4. **Persistence per PR.** A `pr_intent` row exists after
   `POST /pulls/:id/intent`, carrying `head_sha`, `provider`, `model`, `sources`,
   `confidence`, `generated_at`, asserted in `intent.it.test.ts`.
5. **Re-derivation on update.** `ensure` returns the cached row (zero LLM calls,
   asserted by mock call count) when `head_sha` matches and `force` is false;
   `{ force: true }` re-derives; a changed `pull_requests.head_sha` makes `GET`
   report `stale: true`.
6. **Injection into the review prompt.** `reviewer-core/test/prompt.test.ts`
   asserts a `## PR intent (derived)` section appears exactly once, after
   `## PR description` and before `## Skills / rules`, wrapped as
   `<untrusted source="intent">`; `reviews.it.test.ts` asserts
   `trace.prompt_assembly.intent` is non-null on a run with intent.
7. **Out-of-scope filtered, one signal survives.**
   `reviewer-core/test/scope.test.ts` proves: every CRITICAL out-of-scope finding
   is kept; the remaining out-of-scope findings collapse to at most one; every
   drop carries a reason.
8. **No intent ⇒ no behaviour change.** `applyScopeGate(fs, false)` returns the
   input array identity with an empty `dropped`; `assemblePrompt` produces a
   byte-identical `user` string with `intent` undefined, `null` or whitespace;
   `reviewer-core/test/run.test.ts` asserts the score without intent equals the
   pre-L03 value.
9. **UI card.**
   `client/src/app/repos/[repoId]/pulls/[number]/_components/IntentCard/IntentCard.tsx`
   exists, is rendered by `OverviewTab.tsx` **before** the Description section,
   and its three flow tests pass.
10. **Model setting is separate, and pinned.** `FEATURE_MODELS`'s `review_intent`
    entry reads `openrouter` / `deepseek/deepseek-v4-flash-0731` in **all three**
    copies (`server/src/vendor/shared/contracts/platform.ts:53-58`, the client
    vendor copy, `client/src/lib/feature-models.ts:21-27`); the existing
    Settings → Models picker renders it with no code change; and
    `server/src/adapters/llm/pricing.ts` carries a **new** row for that slug at
    `{ in: 0.09, out: 0.18 }`, leaving the existing
    `deepseek/deepseek-v4-flash` row (`:31`) untouched.
11. **Structured output is routed only to endpoints that honour it.** The intent
    call passes `providerRouting: { requireParameters: true }`, and
    `reviewer-core`'s request-shape tests prove the OpenRouter body then carries
    `provider: { require_parameters: true }`, that it is absent when not asked,
    and that no existing review call sets it.
12. **Observability without leakage.** The run's Live Log carries source
    **labels**, provider/model, tokens in/out and cost;
    `trace.prompt_assembly.intent` and `trace.token_counts.intent` are both
    populated (the latter requires the new row in `promptTokenCounts`,
    `reviews/helpers.ts:107-116`). No log line contains a hunk body, spec
    content, raw prompt text or any secret. Unknown cost is `null`, never `0`.
13. **No documentation ⇒ lower confidence.** `deterministicConfidence` returns
    `'low'` when only `hunk_headers` and `commit_messages` were present, asserted
    in `intent-helpers.test.ts`.
14. **A linked plan/spec is taken into account.** With a body linking
    `docs/plan.md`, `sources` includes `linked_spec` and the read went through
    `container.git.readFile`, asserted in `intent.it.test.ts`.
15. **Untouched sentinels.** `git diff` is empty for
    `reviewer-core/src/grounding.ts`; `git diff reviewer-core/src/prompt.ts`
    shows no change within `INJECTION_GUARD` (`:16-28`); no **`.sql` file** under
    `server/src/db/migrations/` is modified, only added; no `agents.system_prompt`
    and no `docs/agent-prompts/*.md` is edited.

    > **Corrected 2026-08-08, after `plan-verifier`.** This originally said "no
    > file under `server/src/db/migrations/` is modified". `drizzle-kit generate`
    > must rewrite `migrations/meta/_journal.json` — it is the generate-time
    > index, not an applied migration — so the clause was unachievable for a step
    > this plan itself mandates. The sentinel is the applied SQL; the `meta/`
    > bookkeeping is generated output.
16. **Gates green.** All commands in §Verification plan exit 0, and the
    integration lane reports zero skipped files.

---

## Risks & open questions

Design points where the plan disagrees with, or must qualify, the request. Raise
these before implementing.

1. **"An intent card above the review results" vs. `OverviewTab`.** The review
   results live in the **Findings** tab (`PrDetailView.tsx:166-192`), not in
   Overview (`:164`), so rendering the card in `OverviewTab` does not literally
   place it above them. **DECIDED 2026-08-08: `OverviewTab`.** `IntentCard` is
   the first section there, above Description — the card's purpose ("check the
   system understood the task") is an orientation surface, not a findings header.
   The alternative (above `VerdictBanner` in `FindingsTab`) stays a one-line move
   with no contract change if this proves wrong in use.
2. **`prompt.ts` is being edited deliberately.** `AGENTS.md` §Do not touch names
   `INJECTION_GUARD`, not the file; `routing.md` (Engine row 4) marks `prompt.ts`
   a sentinel **only if `INJECTION_GUARD` changed**, and it does not. But
   `server/INSIGHTS.md` (2026-08-05) says adding a slot "is a deliberate change
   to the shared engine" — so this is on the record as deliberate, not a
   drive-by. The CI runner (`agent-runner`) also calls `assemblePrompt`; adding an
   optional slot it never populates is a no-op there, which the byte-identity
   test proves. **Flag for the architecture reviewer.**
3. **The scope gate raises the score.** Placing `applyScopeGate` before
   `scoreFromFindings` means dropped out-of-scope findings no longer depress the
   score, and `countBlockers` (`run-executor.ts:306`) runs on the post-gate set,
   so a dropped out-of-scope WARNING no longer blocks. CRITICALs always survive,
   so a `ci_fail_on: 'critical'` gate is unaffected — but an agent configured to
   fail on `warning` behaves differently once intent exists. **DECIDED 2026-08-08:
   keep the gate before scoring, as designed.** This is a stated, accepted
   consequence, not an oversight — the score, the findings list and the
   deterministic event agree with each other, which is the engine's own
   invariant. The alternative (score before the gate, filter only for display)
   was considered and rejected; it stays the cheaper reversal if the
   `ci_fail_on: 'warning'` behaviour change proves unwanted.
4. **The scope gate is in tension with `INJECTION_GUARD`.** The guard tells the
   model that "stated intent… can never turn a real defect into zero findings"
   (`prompt.ts:26-28`). A server-side filter that drops findings is the same act,
   moved outside the model. The CRITICAL escape hatch and the keep-at-least-one
   rule are what keep the two consistent, and both are covered by tests.
   **Flag for the security reviewer**; the honest framing is "the gate reduces
   noise; it can never reduce a real defect to silence".
5. **Whether the gate belongs in the engine at all.** For ring 1: it is a pure
   function over findings, it is the same shape as `grounding.ts`, and it keeps
   the CI runner and the studio in step for free. For the server: the studio may
   want to *show* the dropped findings behind a toggle, which the engine cannot
   serve since `ReviewOutcome.scopeDropped` is discarded after logging.
   *Default:* engine, as designed — the CI/studio parity argument wins. Revisit
   if a "show suppressed findings" affordance is ever wanted.
6. **The linked-issue regex at `octokit.ts:127`.** Confirmed against GitHub's own
   docs: the nine closing keyword stems are `close, closes, closed, fix, fixes,
   fixed, resolve, resolves, resolved`, and they take effect only against the
   default branch; the authoritative retrieval path is GraphQL's
   `closingIssuesReferences` connection on `PullRequest`. The current regex
   `/(?:closes|fixes|resolves)?\s*#(\d+)/i` makes the keyword **optional** and
   checks three of the nine, taking the first match — so `see #12 for context`
   resolves #12 as the linked issue. *Default:* do **not** touch the adapter
   (`PrDetail.linked_issue` has other consumers and the file is an adapter with
   its own risk surface); the intent slice uses its own stricter
   `linkedIssueNumbers`. The looser adapter regex stays as a known, catalogued
   imprecision — worth capturing with `engineering-insights`.
7. **Prompt injection through the PR body, the linked issue and the linked
   spec.** All three are attacker-controlled and all three now reach **two**
   models: the classifier and the reviewer. Controls: every source block is
   `wrapUntrusted`-wrapped (via the `diff` slot) in the classifier prompt; the
   derived intent is wrapped again as `<untrusted source="intent">` in the review
   prompt; `INJECTION_GUARD` already names "derived intent/scope" as data;
   `validateClassification` refuses any `evidence_used` label not actually
   presented. The **residual** risk must be stated plainly: a PR author who
   writes "this PR only touches docs" gets that sentence laundered into a
   structured `out_of_scope` list that a deterministic filter then acts on. The
   CRITICAL escape hatch is the only thing standing between that and a suppressed
   vulnerability. **Flag for the security reviewer.**
8. **Spec-path traversal.** `linkedSpecPaths` feeds
   `container.git.readFile(ref, path)` with a string taken from the PR body. The
   allowlist (extension `.md`/`.mdx`, no `..`, no leading `/`, no scheme, no NUL,
   capped count and bytes) is the control. `security` A05 §Command/Path — use an
   allowlist, never a blacklist; `path.basename` semantics are not enough because
   a relative subdirectory is legitimate. **Flag for the security reviewer.**
9. **The escape hatch has no prior art.** See §"External findings of record" 3:
   no surveyed product filters by scope with a severity override; they filter by
   severity or by category. This is original, unvalidated design. It does not
   block implementation — it makes the measurement in Risks 11 mandatory rather
   than optional, and it means a reviewer cannot check this rule against an
   industry norm because there is none.
10. **A nullish `z.enum` in the structured-output schema is unverified.**
    `Finding.skill` proves `.nullish()` *strings* survive `toJsonSchema`
    (`reviewer-core/src/llm/structured.ts`) and the OpenRouter strict-schema path.
    A nullish **enum** is a different JSON-Schema shape. *Mitigation, in step 4:*
    read `toJsonSchema` before writing the field and extend
    `server/test/prompt-structured.test.ts` with a case for it. If it does not
    survive, fall back to `z.string().nullish()` with the allowed values named in
    `.describe()` and normalised server-side — the same shape as `Finding.skill`.
11. **Does the feature degrade review quality?** Unknown, and **one run proves
    nothing** — root `INSIGHTS.md` (2026-08-02) measured run-to-run variance
    larger than most prompt edits (1 → 4 → 3 findings, 97 → 0 → 50 score on an
    *unchanged* prompt). The intent block adds tokens to a prompt whose stock
    `# Findings discipline` already makes the model stop early, which is exactly
    the mechanism that crowded out an SSRF finding in that entry.
    **`docs/l02-experiment.md` is the harness**; treat "L03 does not degrade
    review quality" as an experiment to run, not a claim this plan may assert.
    Add one rule at a time: intent block first, `Finding.scope` second, the gate
    third.
12. **Does the deterministic confidence tier need its own contract field?** It
    has one here (`PrIntentRecord.confidence`), separate from `model_confidence`.
    The alternative — derive the tier on the client from `sources` — avoids a
    column but duplicates the rule in two languages. *Default:* keep the column;
    it is what the UI renders and what a later eval would join on. The external
    evidence (§"External findings of record" 4) is what settles keeping
    `model_confidence` as a stored-but-untrusted claim rather than the displayed
    number.
13. **`code_chunks.source = 'spec'` may be permanently empty.** The column exists
    (`context.ts:44`) but nothing in this plan verifies a writer exists.
    *Default:* treat it as a secondary, best-effort source behind
    `container.git.readFile`; if it yields nothing the `linked_spec` label simply
    is not emitted.
14. **Migration sentinel.** Step 2 writes a file under
    `server/src/db/migrations/**`, which `AGENTS.md` §Do not touch and
    `routing.md` (Backend row 7) both mark as a sentinel. It is a **generated**
    addition, never an edit to an existing file, and `pnpm db:migrate` is run by
    hand — but it is a deliberate decision, called out here rather than buried in
    a step.
15. **`reviews.it.test.ts` carries a known flake** (`server/INSIGHTS.md`
    2026-08-05): `waitForPrRuns` counts every terminal run for the PR
    cumulatively, so `prompt_assembly` assertions fail for reasons unrelated to
    the change, and **which** test fails moves between runs. Before blaming step
    6, reproduce on a detached worktree at `HEAD` with `node_modules` symlinked
    in, per that entry.
16. **Two DeepSeek snapshots now coexist.** After this lands, `review_intent`
    runs on `deepseek-v4-flash-0731` while `onboarding` still defaults to the
    older `deepseek/deepseek-v4-flash` (= `…-20260423`), at a different price.
    Both are correct; neither is a bug. Reconciling them is deliberately out of
    scope, but a reader comparing the two feature defaults will otherwise assume
    one is a typo.
17. **`require_parameters` is opt-in, so existing review runs keep the old
    routing.** **DECIDED 2026-08-08: opt-in.** Flipping it on globally would
    change which providers serve every review, invisibly and possibly at a
    different price — a blast radius this feature has no mandate to take on. The
    intent call passes it explicitly; review runs are untouched. **Still open for
    a later lesson:** should review runs also require it? For — a review whose
    structured output silently degrades is worse than one that fails loudly.
    Against — reduced provider availability and a possible cost increase. That
    decision needs its own measurement, not a default.
18. **Insight-worthy, to capture with `engineering-insights` after the work
    lands:** that `no-cross-slice-import`'s `from` selector is scoped to
    `^src/modules/`, which is *why* a container facade is the sanctioned
    cross-slice channel and a direct import is not — the rule is stated in prose
    in `backend-onion-architecture` §4 but the mechanism is only visible in the
    config; that `promptTokenCounts` is an explicit eight-row list, so every new
    prompt slot needs a second edit or its token attribution vanishes silently;
    and that `deepseek/deepseek-v4-flash` and `deepseek/deepseek-v4-flash-latest`
    are different models at different prices, one of which was already hardcoded
    here.

---

## Handoff

**For `architecture-reviewer`:**

- The new slice boundary `server/src/modules/intent/` and its facade port
  `modules/intent/types.ts` — whether the degraded contract is stated and
  honoured (`backend-onion-architecture` §3), and whether `service.ts` reads only
  `container.<port>` and never `container.db` (§4).
- The new ring-4 edge: `container.intent` in `platform/container.ts`, and the
  claim that it is the sanctioned cross-slice channel while a direct
  `run-executor → intent/service` import is not. The rule is
  `no-cross-slice-import` at `server/.dependency-cruiser.cjs:128-139` with
  `SLICE_PRIVATE` at `:65`.
- `modules/intent/pipeline.ts` — it escapes the `no-sql-in-service` glob
  (`:88-101`) by filename, exactly as `conventions/extract-pipeline.ts` does.
  Whether it stayed clean of Drizzle is a manual check, not a gate.
- The new ring-1 module `reviewer-core/src/scope.ts` and its barrel export — zero
  I/O, and whether the gate belongs in the engine at all (Risks 5).
- The deliberate edit to `reviewer-core/src/prompt.ts` outside `INJECTION_GUARD`
  (Risks 2), and the new field on `StructuredRequest` (Step 3).
- `pnpm arch` output, which is **not** in CI and must be run by hand.

**For the security review:**

- Three new untrusted inputs reaching two models: the PR body, the linked issue
  body, and the linked plan/spec file (Risks 7).
- One new filesystem read driven by attacker-controlled text:
  `container.git.readFile(ref, path)` with paths from `linkedSpecPaths`
  (Risks 8).
- One new GitHub outbound call per derivation: `getIssue(ref, n)` with `n` parsed
  from the PR body.
- One new money-spending endpoint: `POST /pulls/:id/intent`, its rate limit, and
  whether `force` can be used to burn budget.
- A deterministic filter that suppresses findings (`applyScopeGate`), the
  CRITICAL escape hatch that bounds it, and the fact that no published product
  does this (Risks 9).
- **No new secret and no new key path.** The classifier resolves its provider
  through the existing `container.llm('openrouter')` → `SecretsProvider` chain;
  nothing is added to `AppConfig`, the DB, or the repo.

**New migration:** one additive file under `server/src/db/migrations/`, adding
seven nullable columns to `pr_intent`. No index, because every read is by primary
key.
