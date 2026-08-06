# Skills for review agents (L02)

> **Revised 2026-08-05** against four new skill-management designs. Two things
> changed shape and one changed kind:
>
> - `/skills` becomes a **master-detail** screen — a rail of skill cards beside a
>   five-tab detail pane — replacing the card grid plus side preview that first
>   shipped. See §Screens.
> - Version history gains **messages**, a **Diff** and a **Restore**. See
>   §Versions.
> - The Stats tab asks for per-skill `PULL FREQUENCY`, `ACCEPT RATE` and
>   `FINDINGS BY CATEGORY`, none of which the first cut could answer. The Open
>   Question at the bottom of the original spec — "attributing findings back to
>   the skill that produced them … needs a per-finding provenance that does not
>   exist yet" — is therefore **resolved rather than deferred**. See §Provenance.
>
> Everything in §Why still holds. The original scope decisions are kept below with
> their revisions marked inline, so this file stays the record of what was agreed
> and when.

## Why

A review agent can only be taught this repo's conventions one way today: by hand,
in its own `system_prompt`, one agent at a time. Two entries in the root
`INSIGHTS.md` say why that is a dead end.

The first (2026-08-02) records that `## Skills / rules`, `## Relevant memory` and
`## Project context` are **wired to nothing**. `assemblePrompt` builds the section
whenever it is handed `skills`, but `reviewPullRequest()` is called with only
`systemPrompt`, `diff`, `callers`, `repoMap`, `prDescription` and `task`, and the
run trace records `{ skills: null, memory: null, specs: null }` as literals. The
`skills` table has existed and been empty by design since Part 0.

The second (2026-08-02) measured what happens when you use the only wire that
does exist. Stacking two convention blocks into `General Reviewer`'s
`system_prompt` made the review **worse**: findings went 1 → 3 → 2, the third run
dropped both the SSRF and the SQL-in-routes finding it had caught before, and
invented a missing-`await` defect on a line that reads `await fetch(...)`. Score
fell 65 → 41 → 30. A single growing prompt is not a place to accumulate rules.

Skills make an instruction block a first-class object: authored once, attached to
many agents in an explicit order, switchable, versioned, and visible in the run
trace as its own block with its own token cost. That last part is what makes the
effect of a rule measurable instead of anecdotal.

**The revision extends that argument one step.** Once a rule is an object, the
next question is whether it earns its tokens — and that cannot be answered while
every finding is anonymous. §Provenance is what makes "is this skill working?" a
query rather than an opinion.

## Scope

### In

**A `skills` module** (`server/src/modules/skills/`) over the existing table —
list, read, create, update, delete, body-version history, and `used-by`.

**Import from a file.** `POST /skills/import` parses an uploaded `.md` or `.zip`
into a *preview* and persists nothing. The client shows the extracted body plus
every archive entry that was skipped, and only a confirm creates the skill.

**The prompt wire.** The run executor loads the agent's linked skills in
`agent_skills.order`, keeps the ones whose `skills.enabled` is true, and passes
their bodies to `reviewPullRequest`. This is the change that closes the gap above.

**Per-section token attribution.** `PromptAssembly` gains `token_counts`, filled
server-side from `outcome.assembly`, so the trace shows what the skills block
cost rather than requiring two runs and a subtraction.

**UI.** The master-detail `/skills` screen described in §Screens, and a **Skills**
tab in the agent editor (attach, detach, drag to reorder).

**Two new agents** — `Test Quality Reviewer` and `API Contract Reviewer` — plus a
seven-skill library, linked in prompt order.

**Finding provenance** (added 2026-08-05) — `run_skills`, `findings.skill_id`, and
the validation gate in §Provenance.

**Version messages, diff and restore** (added 2026-08-05) — §Versions.

### Out

- **URL and community import.** `messages/en/skills.json` already carries copy for
  both; it stays unused. A server-side fetch of a user-supplied URL is an SSRF
  surface that deserves its own change (this repo has a planted-SSRF fixture for
  exactly that reason).
- **A per-agent enabled flag.** `agent_skills` is `(agent_id, skill_id, order)`.
  Attachment is row existence; `skills.enabled` is a single global gate.
- **Evals.** The design shows an `Evals` tab and a `Run on evals` button. Both
  render, the tab shows an EmptyState naming the later lesson, and the button is
  **disabled**. `eval_cases.ownerKind` is already `['skill','agent']` and
  `eval_cases.ownerId` is ready for a skill id, but `AGENTS.md` reserves the
  `eval_*` tables for L06 and upstream carries a separate `l06-evals` branch.
  Building it here would be a second feature of comparable size landing on tables
  another lesson owns.
- **Relevance-based skill selection.** See the note on `pull_rate` in §Mock
  artifacts — the design's varied pull percentages imply on-demand skill loading,
  which is a different feature.
- **`memory` and `specs`.** The same `assemblePrompt` gap exists for both. This
  change closes only the `skills` third of it.
- **Any change to `INJECTION_GUARD` or `grounding.ts`** — repo rule, and
  §Provenance is deliberately designed to need neither.

> **Revised 2026-08-05.** Two items moved out of "Out":
> **restoring a previous version** is now in scope (the design has the button),
> and **skill stats** are in scope with real provenance instead of the proxy the
> first cut refused to ship.

### Migrations

The first cut needed **none** — `skills`, `skill_versions` and `agent_skills` all
existed from Part 0.

> **Revised 2026-08-05.** The revision needs exactly one (`0013_*`, generated with
> `pnpm db:generate`, never hand-written, and 0010–0012 untouched):
>
> ```sql
> skill_versions ADD message text;
> findings       ADD skill_id uuid REFERENCES skills(id) ON DELETE SET NULL;
> CREATE TABLE run_skills (run_id, skill_id, version, order, PK(run_id, skill_id));
> CREATE INDEX findings_skill_id_idx ON findings(skill_id);
> ```
>
> The index is not optional: every Stats read filters on `skill_id`, and
> `schema/reviews.ts` already carries the comment explaining that a foreign key is
> not an index in Postgres.
>
> `ON DELETE SET NULL` on `findings.skill_id` is deliberate and differs from every
> other skill FK, which cascade. A finding is a historical fact about a review;
> deleting a skill must not delete the findings raised while it existed.

## Screens

One route family, master-detail, mirroring `/agents/[id]?tab=`:

```
/skills                      rail + "select a skill"
/skills/[id]?tab=config      rail + detail
        …?tab=preview | evals | stats | versions
```

The rail persists across selection. The breadcrumb is
`Skills Lab › Skills › <name>`; the mock keeps it at `Skills Lab › Skills`, and
consistency with the sibling Agents editor wins over that pixel.

### Rail card

Icon, monospace name, `enabled` toggle, truncated description, then two rows:

- **type** badge (`rubric` `convention` `security` `custom`) and **source** badge
  with its own icon — `Manual`, `Extracted`, `Community`, `Imported`.
- a stats footer: `N agents · N% pull · N% accept`.

A disabled skill is dimmed, not hidden — it stays linked and keeps its order. The
delete action moves off the card into the detail pane, per the design.

The `needs vetting` badge is kept **only** while `source !== 'manual' && !enabled`,
so it does not simply restate the source badge; a disabled imported skill is
exactly the state that needs a human to look at it.

### Detail header

`✧ <name>` + type badge + version chip (`v5`), with `Run on evals` on the right
(disabled — see §Scope/Out).

### Config tab

Name, Description, Type, and the body as a code editor: a file header reading
`<name>.md` with an `unsaved` badge and a live token estimate, over a textarea
with a synced line-number gutter.

Editing is plain monospace; **syntax highlighting lives in the Preview tab**,
which already renders the markdown properly. Highlighting inside an editable field
needs either an editor dependency or a transparent-textarea overlay whose scroll
sync, wrapping and IME behaviour all drift — neither is worth it for a field whose
rendered form is one tab away.

The token number is `Math.ceil(len / 4)` — the same formula the server ships as
`approxTokens` — debounced, and rendered with a `~` because it is an estimate. The
trace's `token_counts.skills` remains the real tiktoken count.

### Preview tab

The body rendered as markdown, under "Rendered as the reviewing agent receives
it." Note the honesty limit of that sentence: the agent receives the body as
**text**, wrapped in the labelled `### <slug>` heading described in §Provenance,
not as styled HTML. The preview shows the content, not the encoding.

### Stats tab

Four tiles — `USED BY`, `PULL FREQUENCY`, `ACCEPT RATE` (with the `CircularScore`
ring), `FINDINGS (30D)` — then `AGENTS USING THIS SKILL` (rows linking to each
agent) and `FINDINGS BY CATEGORY` as a `Donut`.

`Donut`, `MetricCard` and `CircularScore` already exist in `vendor/ui`. See §Mock
artifacts for the `$` in the donut legend.

### Versions

`Version history` + an `N versions` count, under "Every save snapshots the body so
eval runs stay reproducible against the exact text they scored." Each row: version
chip, **message**, date, and either a `Current` badge or `Diff` + `Restore`.

**Restore appends; it does not rewind.** Restoring v3 while at v5 writes **v6**
whose body equals v3's, with an automatic message naming the source. `skill_versions`
is append-only like every history in this repo, and rewinding a pointer would break
the reproducibility the tab's own subtitle promises.

`Diff` is computed client-side between two version bodies with a small LCS line
diff, rendered with the existing `--code-add` / `--code-del` variables.
`DiffViewer` cannot be reused — it takes `PrFile[]`, a PR-specific shape. No
dependency is added.

## Provenance

*Added 2026-08-05.* Two facts with very different reliability. They are kept
separate, and the unreliable one is never allowed to contaminate the reliable one.

### 1. Which skills a run used — deterministic

`run_skills`, written by the run executor, which already loads the linked skills.
It records the `version` injected as well as the `order`, because that is what
makes the Versions tab's promise true: without it a run records *that* a skill was
used, not which wording it was scored against.

### 2. Which skill caused a finding — model-reported, server-validated

`Finding` gains one optional field, and the instruction rides on the **schema**
rather than the prompt:

```ts
skill: z.string().nullish().describe(
  'The exact slug of the skill from the "## Skills / rules" section whose rule ' +
  'this finding applies. Use the slug verbatim. Set null when the finding came ' +
  'from your own analysis rather than a listed skill — do NOT guess or invent a slug.')
```

`Review` is handed straight to the LLM as the structured-output schema
(`reviewer-core/src/review/run.ts:174`), and `score` already instructs the model
through `.describe()`, so this is the established mechanism here. Consequently the
change needs **no edit to `prompt.ts`, `INJECTION_GUARD`, or `grounding.ts`**.

So the model has slugs to cite, the server labels each body as it builds the
array: `### ${skill.name}\n${skill.body}`. That is a server-side string change;
`PromptParts.skills?: string[]` is unchanged, and `reviewer-core` is untouched.

**The validation gate is the whole point.** At persist time a `finding.skill`
resolves to a `skill_id` only if it names a skill actually injected into *that
run*. An unknown slug, a skill belonging to a different agent, or an invented name
resolves to `NULL`, is counted as unattributed, and the rejection is logged.

This is deliberately the same discipline as `grounding.ts`, which refuses findings
citing lines absent from the diff. An attribution to a skill that was not in the
prompt is not evidence, it is a guess — and root `INSIGHTS.md` records
`findings.confidence` coming back `1.0` for a hallucination, which is why a
self-reported field is checked against something the server knows or is not
stored. Note what this gate does **not** prove: that the skill genuinely caused
the finding, only that the skill was present and could have.

Both engine stages already pass an unknown field through untouched —
`reduceReviews` does `partials.flatMap(p => p.findings)` and grounding does
`kept.push(finding)` — so nothing else in the pipeline changes.

### Metric definitions

Written down because every one of them is arguable.

| Metric | Definition | `null` when |
|---|---|---|
| `used_by_count` | rows in `agent_skills` for this skill | never (`0` is real) |
| `runs_count` | rows in `run_skills` for this skill | never |
| `pull_rate` | last 30d: runs that injected this skill ÷ runs by agents currently linking it | no eligible runs |
| `accept_rate` | `accepted ÷ (accepted + dismissed)` over findings with this `skill_id` | nothing accepted **or** dismissed yet |
| `findings_last_30d` | findings with this `skill_id` in reviews from the last 30 days | never |
| `findings_by_category` | that set grouped by `category` | never (empty map) |
| `unattributed_count` | findings from runs using this skill whose `skill_id` is `NULL` | never |

`accept_rate` **null renders `—`, never `0%`.** The repo already asserts this
distinction end to end for `cost_usd` ("unknown is `null`, never `0`"), and a skill
nobody has judged yet is not a skill with 0% acceptance.

`unattributed_count` is surfaced on purpose. It is the honest denominator — how
much of the picture the attribution is missing — and without it the other numbers
imply a completeness they do not have.

The three rail rollups come from **grouped queries joined in memory**, never a
per-skill lookup: the rail renders stats for every skill in the library, so the
per-item form would be an N+1 across the whole screen. Same discipline as
`skillCountsByAgent`.

## Mock artifacts

Two numbers in the designs are artifacts, not requirements. Recorded here because
the l01 spec's precedent is that the rule is authoritative, not the mock pixels.

**`security $52.00` in the donut legend.** `vendor/ui/charts/Donut.tsx` declares
`valuePrefix = "$"` as its default and the mock never overrode it — a
findings-by-category chart has no currency in it. Pass `valuePrefix=""`. The
categories themselves are correct: `FindingCategory` is already the enum
`bug | security | perf | style | test`.

**`34% / 71% / 88% / 92% pull` across four skills.** Under this model every
enabled linked skill is injected into every run of that agent, so a skill that has
been enabled for the whole window is **correctly 100%**, and the number only moves
when a skill was switched off for part of it. Varied percentages imply
relevance-based selection at run time — genuinely interesting, and a different
feature (see §Scope/Out). Do not manufacture variance to match the mock.

## Contracts

Canon is `server/src/vendor/shared/`; `client/src/vendor/shared/` is a manual copy
ported in the same commit. Verify only the touched files, ignoring comments —
`diff -r` between the two can never be empty, since they carry ~120 lines of
documented pre-existing drift (root `INSIGHTS.md`, 2026-08-02). The `shared:sync`
gate now runs deterministically; it was locale-dependent until the `LC_ALL=C` fix.

`contracts/knowledge.ts`:

```ts
SkillVersion       = { skill_id, version, body, created_at }
SkillVersion      += message: z.string().nullish()                    // 2026-08-05
SkillImportPreview = { name, description, type, source, body, ignored_files }
Skill             += used_by_count / pull_rate / accept_rate           // 2026-08-05
                     (nullish, LIST-only — same convention as Agent.skills_count)
SkillStats         = { used_by_count, agents[], version_count, runs_count,
                       pull_rate, accept_rate, findings_last_30d,
                       findings_by_category, unattributed_count }      // 2026-08-05
Agent             += skills_count: z.number().int().nullish()          // LIST-only
```

`contracts/findings.ts`:

```ts
Finding += skill: z.string().nullish().describe(…)                     // 2026-08-05
```

`Finding` is embedded in `eval_cases.expected_output` and
`eval_runs.actual_output`, both jsonb, so `.nullish()` here is required rather
than merely tidy.

`contracts/trace.ts` — `PromptAssembly` gains:

```ts
token_counts: z.record(z.string(), z.number().int()).nullish()
```

`.nullish()` is load-bearing throughout, not stylistic. `RunTrace` is persisted as
a single jsonb document, and every trace written before this change has no
`token_counts` key. `.nullable()` accepts an explicit `null` but **rejects a
missing key**, so it would make the entire run history unparseable — the identical
trap `RunStats.cost_usd` carries a comment about. Guarded by
`server/test/contracts.test.ts`.

### Endpoints

```
GET    /skills                 list — plus the three list-only rollups
POST   /skills                 create
GET    /skills/:id             read
PUT    /skills/:id             update — a BODY change appends a version;
                               accepts version_message
DELETE /skills/:id             delete — agent links cascade
GET    /skills/:id/versions    body history, newest first
GET    /skills/:id/used-by     agents linking this skill
GET    /skills/:id/stats       SkillStats
POST   /skills/:id/restore     { version } → APPENDS a new version with that body
POST   /skills/import          parse an upload into a preview; persists NOTHING
```

`POST /skills/import` is registered **before** `/skills/:id`; the reverse order
validates the literal `"import"` against `IdParams` and 422s. It also carries its
own `bodyLimit` — see below. `GET/POST /agents/:id/skills` already existed and are
unchanged.

### Semantics

- **Order is prompt order.** `agent_skills.order` is the order of the blocks
  inside `## Skills / rules`. That is why the editor lets it be dragged.
- **Two gates, one direction.** A skill reaches the prompt iff a link row exists
  **and** `skills.enabled` is true. A disabled skill keeps its link and its
  position and contributes nothing.
- **Omit, never zero.** With no enabled skills, `skills` is omitted from
  `PromptParts` entirely, so the assembled prompt is byte-identical to a pre-L02
  run. Likewise `token_counts` omits a section that did not exist rather than
  recording `0` — "absent" and "empty" are different facts.
- **A body change versions; metadata does not.** Renaming, retyping or toggling
  `enabled` leaves `version` alone. The history tracks the instructions the agent
  was given, not the labels around them. Rewriting the same body is a no-op.
- **An imported skill is created disabled**, with `source: 'imported_url'`, and is
  badged "needs vetting" until enabled.

### Import limits

Three limits that have to agree, in this order:

| Limit | Value | Why |
|---|---|---|
| route `bodyLimit` | 1.5 MB | app-wide default is 1 MiB (`app.ts:49`) |
| `MAX_IMPORT_BYTES` | 512 KB | on the **decoded** buffer |
| `MAX_UNPACKED_BYTES` | 2 MB | on the **decompressed** total |

The payload is base64, which inflates by ~33%, so without a route-level
`bodyLimit` a ~750 KB file fails with Fastify's opaque 413 rather than the
service's clear size error. `MAX_IMPORT_BYTES` sits below the route limit so the
readable message always wins. `MAX_UNPACKED_BYTES` is separate because a small
archive can expand without bound — that guard has to be on the output.

## Trust

An imported skill body is **instructions in your agent's prompt**. That is the
whole value and the whole risk, and the two cannot be separated.

Skills are NOT wrapped in `wrapUntrusted`. `INJECTION_GUARD` tells the model to
ignore instructions inside `<untrusted>` blocks, so wrapping a skill would neuter
the thing that was just imported. `prompt.ts:42` says as much in its own comment
("trusted-ish; community skills should be sanitized upstream").

The control is therefore procedural, and it is what the shipped copy already
promised: **preview → explicit confirm → created disabled → badged until vetted**.
Two strings in `skills.json` claimed the body was "wrapped as untrusted data —
never executed as instructions" and "delimiter-wrapped"; both were false and are
corrected to say what actually happens.

What the archive path does guarantee: exactly one markdown entry is read, nothing
is written to disk, and every other entry — scripts included — is listed back to
the user unexecuted.

## Acceptance

Original criteria 1–14 stand, with 1 amended. Numbering continues for the
revision.

1. ~~No migration is added.~~ **Amended 2026-08-05:** exactly one migration is
   added, generated by `pnpm db:generate`; 0010–0012 are untouched.
2. `GET /skills` lists the workspace's skills; a skill in another workspace 404s
   and a non-uuid id 422s.
3. Creating a skill records body version 1. Changing the body bumps `version` and
   appends to `skill_versions`, newest first; a rename or an `enabled` toggle does
   not, and rewriting an identical body does not.
4. `DELETE /skills/:id` removes the skill and cascades its `agent_skills` rows.
5. `POST /skills/import` returns a preview for `.md` and `.zip`, reports skipped
   archive entries in `ignored_files`, and **leaves the library unchanged**.
   Frontmatter `name`/`description` win over the first heading, which wins over the
   filename stem. Unsupported types, empty uploads, oversize uploads and
   over-expanding archives all fail 4xx, never 500.
6. A skill created through the import flow is `enabled: false` with
   `source: 'imported_url'`, and the UI badges it "needs vetting".
7. An agent with enabled linked skills produces a `## Skills / rules` block whose
   bodies appear in `agent_skills.order`.
8. A **disabled** linked skill contributes no block; an agent whose every linked
   skill is disabled assembles no block at all, exactly as if none were linked.
9. `GET /runs/:id/trace` returns `prompt_assembly.skills` and a
   `token_counts.skills` greater than zero for such a run.
10. A trace document persisted **before** this change still parses, and reports
    `token_counts` as undefined.
11. `GET /agents` returns `skills_count` per agent from ONE grouped query, not an
    N+1; the agent card renders it.
12. The agent Skills tab lists the whole library, attaches and detaches by
    checkbox, reorders by drag, and holds **no** local copy of the linked list.
13. `pnpm typecheck`, `pnpm arch`, `pnpm lint` and both test lanes pass; the two
    `vendor/shared` copies agree on every file this change touched.
14. Seeding is idempotent, and a re-seed never overwrites a skill order the user
    arranged in the editor.
15. A run writes one `run_skills` row per **enabled** linked skill, carrying the
    `version` injected and its `order`; a disabled skill writes none.
16. A finding attributed to a skill that WAS injected into that run persists
    `findings.skill_id`. A finding naming a skill that was **not** injected — or a
    slug that matches nothing — persists `NULL` and is logged as rejected.
17. Deleting a skill sets its findings' `skill_id` to `NULL` and deletes no
    findings.
18. `accept_rate` is `null` before anything is accepted or dismissed and renders
    `—`, never `0%`. `pull_rate` reads 100% for a skill enabled throughout the
    window, and below it for one disabled during the window.
19. `GET /skills/:id/stats` returns every field in `SkillStats`, and
    `unattributed_count` is displayed rather than hidden.
20. `POST /skills/:id/restore` **appends** a version — restoring v3 at v5 yields
    v6 with v3's body, and v3 remains readable. No version is ever deleted or
    rewritten.
21. `/skills/[id]?tab=` renders the rail beside the detail; the rail's per-skill
    rollups come from grouped queries, not one request per card.
22. The Config body editor's gutter tracks the body, the filename is `<name>.md`,
    `unsaved` appears on the first keystroke and clears on save, and the field is
    uncontrolled-with-`key` rather than Effect-synced.
23. The Evals tab renders its deferred EmptyState and `Run on evals` is disabled;
    no `eval_*` table is written.
24. The findings donut renders counts with **no currency prefix**.
25. A `Finding` with no `skill` key still parses, and a `SkillVersion` with no
    `message` still parses.

## Open questions

- ~~Attributing findings back to the skill that produced them.~~ **Resolved
  2026-08-05** by §Provenance — with the caveat stated there: the gate proves the
  skill was *present*, not that it *caused* the finding.
- **How often does the model actually attribute?** Unknown until measured. If the
  rate is low, Stats legitimately reads mostly `unattributed` — that is the design
  working, not failing — but if it is near zero the feature is not earning its
  schema change. Measure over several runs before judging; root `INSIGHTS.md`
  records run-to-run variance larger than most prompt edits.
- **Does adding a field to the output schema cost findings?** The same INSIGHTS
  entry measured a new prompt block crowding out findings a previous run caught.
  A schema field is a smaller intervention than a prompt rule, but it is not free
  and should be A/B'd against the pre-change baseline.
- **`pull_rate` reads 0% for the first 30 days after the migration.** Runs recorded
  before `run_skills` existed sit in the denominator and can never match, so a
  skill enabled throughout shows `0%` instead of `100%`. It self-heals as the
  window rolls forward. Options and the reasoning are in `server/INSIGHTS.md`
  (2026-08-05); shipped as-is on the grounds that the number is uninformative
  rather than false.
- Should a skill be switchable **per agent** rather than only globally? One column
  (`agent_skills.enabled`) would do it.
- `memory` and `specs` have the same dead wire. Same treatment later, or is
  curated memory a different enough problem?
- Relevance-based skill selection would make `pull_rate` genuinely vary — and
  would raise the question of what selects, and on what evidence.
- The two new agents' prompts are deliberately generic so their skills carry the
  rubric. If a later lesson folds rubrics back into prompts, the L02 experiment
  stops reproducing — `docs/agent-prompts/README.md` says so, but nothing enforces
  it.
