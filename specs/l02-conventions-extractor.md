# Conventions extractor (L02)

## Why

A review agent knows general good practice. It does not know *this* project's
house rules — that `Result<T, ApiError>` is the return shape of every public
handler, that Redis is reached only through one singleton, that `.then()` chains
are not written here. So it reviews every repo as if it were any repo.

The obvious fix is to write those rules into the agent's `system_prompt`, and this
repo has already **measured** what that does. Root `INSIGHTS.md:289` records three
runs against the same one-file PR: stock prompt found the planted SSRF (score 65);
`+ ## Three-layer modules` found three issues (score 41); `+ ## Outbound I/O`
dropped both the SSRF *and* the SQL-in-routes finding and invented a missing-`await`
defect against a line reading `await fetch(...)` (score 30). Each rule added
crowded out what the previous run caught.

L02's Skills feature is the answer to that: rules live in `skills` rows, are linked
per agent, and are injected as a discrete `## Skills / rules` block. What is still
missing is the *authoring* — somebody has to sit down and write the rules. This
feature mines them from the repository instead: sample the code, ask a cheap model
what patterns it sees, verify every claim against the files on disk, and let the
user approve or reject each one. The approved set becomes one skill, attached to a
review agent.

`README.md:83` lists L02 as "Skills in the product · **Conventions extractor**".
The Skills half shipped (`specs/l02-skills.md`); this is the other half. The
`conventions` table has been in the schema since `0000_init.sql:96`, and
`repoIntel.getConventionSamples()` has existed at
`server/src/modules/repo-intel/service.ts:630` with **no production caller** —
`ONBOARDING.md:203` marks it `L02`. This feature is what those were reserved for.

## Scope

### In

- A new `conventions` module: `GET` the candidates, `POST` a scan, `PATCH` a rule
  or a batch of statuses, and build a skill draft.
- Sampling done **entirely in code** — no model call decides what to read.
- **One** structured model call per scan, through the `conventions` feature-model.
- A code-side evidence gate that **drops** any candidate it cannot prove, and
  computes the evidence line range itself.
- A `/repos/:repoId/conventions` screen: candidate cards with category, evidence,
  and a confidence meter; per-card accept / reject / edit; a bulk deselect.
- A "Create skill from conventions" modal that merges the accepted set into one
  editable skill and **links it to an agent**.
- Migrations: `conventions` gains `status`, `category`, `created_at` and the two
  evidence line columns and loses `accepted`; a new `convention_scans` table; two
  indexes.

### Out

- **Auto-accepting anything.** No confidence threshold, no "accept all above 85%".
  See Semantics — `confidence` is not a signal.
- **One skill per rule.** The mockups merge the accepted set into a single
  `<repo>-conventions` skill. The per-rule alternative is recorded in Open
  questions.
- **Background execution.** The scan runs synchronously inside the request.
  `platform/jobs.ts` and `platform/sse.ts` are untouched; the already-shipped
  `page.scanning` i18n key exists for exactly this.
- **Embeddings, RAG, or the `memory` table.** Unrelated, and still empty by design.
- **Re-verifying an accepted convention against a later commit.** A rule accepted
  today keeps the evidence snippet it was accepted with. Drift detection is a
  different feature.
- **Editing evidence.** Only `rule` is editable. See Semantics.
- **Writing conventions into `agents.system_prompt`.** That is the failure this
  feature exists to avoid.

### Migrations

`conventions` shipped in `0000_init.sql:96` with `accepted boolean`, which cannot
express *rejected*. Generated with `pnpm db:generate`; earlier migrations are never
edited.

**Two migrations, not one, and deliberately so.** Dropping `accepted` in the same
step as adding `status` makes `drizzle-kit generate` stop and ask whether `status`
is a *rename* of `accepted` — an interactive prompt that needs a TTY and cannot be
answered from a script. Splitting it removes the ambiguity: `0014` is purely
additive (nothing dropped, so nothing to disambiguate) and `0015` is purely a drop
(nothing added). The net effect is the SQL below.

```sql
ALTER TABLE conventions ADD COLUMN status text NOT NULL DEFAULT 'pending';
ALTER TABLE conventions DROP COLUMN accepted;
ALTER TABLE conventions ADD COLUMN category text NOT NULL DEFAULT 'other';
ALTER TABLE conventions ADD COLUMN created_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE conventions ADD COLUMN evidence_line_start integer;
ALTER TABLE conventions ADD COLUMN evidence_line_end   integer;
CREATE INDEX conventions_ws_repo_idx ON conventions(workspace_id, repo_id);

CREATE TABLE convention_scans (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  repo_id       uuid NOT NULL REFERENCES repos(id) ON DELETE CASCADE,
  files_sampled integer NOT NULL,
  candidates    integer NOT NULL,
  dropped       integer NOT NULL,
  provider      text NOT NULL,
  model         text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX convention_scans_ws_repo_idx ON convention_scans(workspace_id, repo_id);
```

Four choices worth stating:

- **`DROP COLUMN accepted` is safe.** `conventions` is one of the ~16 tables root
  `AGENTS.md` keeps deliberately empty, so no install has a row to migrate. A
  tri-state `status` is used rather than a second `rejected boolean` because two
  booleans can represent `(true, true)`, and every read would then have to defend
  against a state that means nothing.
- **Both indexes are required, not optional.** `server/INSIGHTS.md:170` records the
  `findings` table shipping with no indexes at all — a foreign key is not an index
  in Postgres, and both new queries filter on `(workspace_id, repo_id)`.
- **`created_at` exists to order the list.** Cards render in insertion order.
  They are never ordered by confidence — see Semantics.
- **`convention_scans` is a separate table, not columns on `repos`.** It is an
  append-only audit trail: which model, over how many files, produced how many
  candidates, and how many it claimed that could not be proven. `dropped` is
  stored for the reason given under the evidence gate.

`evidence_line_start` / `evidence_line_end` are nullable because a row seeded for
tests or fixtures may have no snippet, not because a scan may skip them — a scan
that cannot compute them drops the candidate instead.

## Screens

One route, `/repos/:repoId/conventions`, reached from `SKILLS LAB → Conventions`
(`g c`). Every string comes from `client/messages/en/conventions.json`, which
already ships complete; the modal adds new keys to the same file.

### Header

`Conventions in <repo>` with a `Re-scan` button (label cycles
`runExtraction` → `scanning` → `rescan`), and beneath it
`Detected from N sample files · last scan 1h ago` read from the latest
`convention_scans` row. With no scan yet, the subtitle line is omitted and the
`EmptyState` carries the call to action.

A toolbar row shows `Deselect all`, the counter `X of Y accepted`, and
`Create skill` — disabled while zero candidates are accepted.

### Candidate card

Rule text; a `Badge` with the category; an evidence block whose header is
`` `path:start-end` `` (`MonoLink`) with a copy button, and whose body is the
snippet in a `<pre className="mono">`; then a confidence row —
`ProgressBar` + `NN%`. The action column holds `Accepted` and `Reject` as a
stacked pair.

Behaviour:

- All cards stay visible whatever their status. A rejected card dims and shows
  `Reject` in its active state, so pressing `Accepted` undoes the rejection. A
  rejection the user cannot see is a rejection they cannot take back.
- The counter's `Y` is every candidate from the latest scan, rejected ones
  included.
- `Deselect all` sets every accepted card back to `pending` — not to `rejected`.
  Deselecting is not a verdict.
- Editing a card turns the rule line into a text field. **Only `rule` is
  editable.** `evidence_path`, `evidence_snippet` and `confidence` are immutable
  provenance: they were verified against a file actually read, and letting the user
  rewrite the snippet would leave a confidence figure and a line range that no
  longer describe anything.

### Create-skill modal

Prefilled from `POST /repos/:id/conventions/skill-draft`, which persists nothing —
the same contract as `POST /skills/import` (`contracts/knowledge.ts:204`). Fields:
`Name`, `Description`, `Type` (`SelectInput`), `Enabled` (`Toggle`),
**`Attach to agent`** (`SelectInput`), and `Skill body` in the line-numbered
`BodyEditor` with its token estimate.

The body the draft opens with:

````markdown
# payments-api-conventions

House conventions for `payments-api`, extracted from the repository and reviewed by
hand. Report a **WARNING** when a change violates any rule below, and cite the
offending `file:line`.

## async-await-instead-of-then-chains

Always use async/await instead of `.then()` chains.

Detected in `src/api/users.ts:23-31`:

```
const user = await db.users.find(id);
const posts = await db.posts.findMany({ userId });
```
````

Defaults: name `<repo>-conventions`, description
`N house conventions extracted from <repo>`, type `convention`, source
`extracted`, `evidence_files` the accepted candidates' distinct paths, sections
ordered by category then insertion, slugs from a pure `slugify(rule)`.

**The severity sentence is mandatory.** Root `INSIGHTS.md:430` records that a rule
which does not state its own level is reported as CRITICAL, and the stock
`# Verdict` section makes the verdict a pure function of whether any CRITICAL
exists — so an unlabelled convention silently flips reviews to `request_changes`
and cost one run 11 score points. The generated body says
`Report a **WARNING**`.

**Enabled defaults to on.** This departs from root `INSIGHTS.md:344`, which says a
skill the user did not write must be created disabled and badged until vetted
(`needsVetting(skill) = source !== "manual" && !enabled`). That rule protects
against a skill imported from a stranger. A convention mined from the user's own
repository, whose every rule they accepted or rejected by hand on the previous
screen, has already been through a stricter review than the badge represents — the
accept/reject/edit loop *is* the procedural control. Creating it disabled would
mean the user vets it twice and the feature does nothing until they notice.

### Attaching to an agent

**Without this step the feature changes nothing.** `run-executor` injects only the
skills linked to the agent that runs, and `agent_skills` has no `enabled` column
(`server/src/db/schema/agents.ts:51`), so attachment *is* row existence — root
`INSIGHTS.md:86` records this as the fact that decides the whole enablement model.
A skill sitting unlinked in `/skills` is a skill with a token cost of zero and an
effect of zero.

So the modal's `Attach to agent` select lists the workspace's agents plus an
explicit "Don't attach yet", defaulting to `General Reviewer` when one exists. On
submit: `POST /skills`, then `POST /agents/:id/skills` with `{ skill_id, order }`
(`server/src/modules/agents/routes.ts:153` → `service.linkSkill`). If the link
call fails after the skill was created, the skill is kept, the failure is toasted,
and the user lands on `/skills/:id` — a successful create is never rolled back
because a follow-up failed.

Whether attaching actually improved the review is measured by
`docs/l02-experiment.md`, not by eyeballing: two runs per arm, and the reportable
result is a *specific* finding present in every skills-on run and absent from every
skills-off run. Never a count or a score delta — root `INSIGHTS.md:311` shows a
control agent with a byte-identical prompt swinging 1 → 4 → 3 findings and
97 → 0 → 50 score, so run-to-run variance is larger than most prompt edits.

## Contracts

Vendored twice. Edit `server/src/vendor/shared/` (canon), port to
`client/src/vendor/shared/` **in the same commit**. Note that `diff -r` over the
two trees can never come back empty — root `INSIGHTS.md:321` catalogues ~120 lines
of pre-existing drift — so the check is a comment-stripped diff of the touched
file only.

`contracts/knowledge.ts`:

```ts
ConventionStatus    = z.enum(['pending', 'accepted', 'rejected'])            // new
ConventionCategory  = z.enum(['naming', 'error-handling', 'structure',       // new
                              'testing', 'api-shape', 'tooling', 'other'])

ConventionCandidate  = { id, rule, evidence_path, evidence_snippet, confidence }
ConventionCandidate -= accepted: z.boolean()
ConventionCandidate += category: ConventionCategory
ConventionCandidate += evidence_line_start: z.number().int()   // server-computed
ConventionCandidate += evidence_line_end:   z.number().int()   // server-computed
ConventionCandidate += status: ConventionStatus
ConventionCandidate += created_at: z.string()

ConventionScan       = { id, files_sampled, candidates, dropped,            // new
                         provider, model, created_at }
ConventionsPayload   = { candidates: ConventionCandidate[],                 // new
                         last_scan: ConventionScan.nullable() }
ConventionSkillDraft = { name, description, type: SkillType, body,          // new
                         enabled, evidence_files: z.array(z.string()) }
```

Every field here is **column-backed**, so the `.nullish()` rule from root
`INSIGHTS.md:463` does not apply — that rule is about fields inside a jsonb
document, where a missing key must be tolerated. `last_scan` is `.nullable()`
because it is rebuilt from columns on every read and the key is always present;
`null` means "never scanned", and the UI renders that as an absent subtitle rather
than as `0 sample files`.

Replacing `accepted` with `status` is a breaking rename that costs nothing:
`ConventionCandidate` has no consumer on either side today.

`skills` needs one field restored — `skills.evidence_files` exists as a column
(`server/src/db/schema/skills.ts:19`) but `InsertSkill`
(`server/src/modules/skills/repository.ts:17`) and `CreateSkillBody` both dropped
it, so a skill cannot record what it was extracted from. Add
`evidence_files: z.array(z.string()).nullish()` to `CreateSkillBody` and
`evidenceFiles?: string[] | null` to `InsertSkill` and `insert()`. No migration.

The two model-facing schemas stay module-private in `conventions/constants.ts` —
they are not cross-package contracts:

```ts
ExtractionItem = { category, rule, evidence_path, evidence_snippet, confidence }
Extraction     = { conventions: ExtractionItem[].max(20) }
```

Each field carries a `.describe()`. That is not documentation: the schema is handed
straight to `completeStructured`, so a `.describe()` **is** the instruction the
model reads (root `INSIGHTS.md:14`). Note what is *absent* — the model is never
asked for a line number.

### Endpoints

```
GET    /repos/:id/conventions              list + latest scan   → ConventionsPayload
POST   /repos/:id/conventions/extract      scan (sync, 1 LLM call) → ConventionsPayload
PATCH  /conventions/:id                    { rule }             → ConventionCandidate
PATCH  /repos/:id/conventions/status       { ids, status }      → ConventionCandidate[]
POST   /repos/:id/conventions/skill-draft  { convention_ids }   → ConventionSkillDraft
                                           persists NOTHING
POST   /skills                             existing — saves the edited draft
POST   /agents/:id/skills                  existing — links the skill to an agent
```

One bulk status endpoint serves single-card Accept, single-card Reject, and the
header's `Deselect all`; three endpoints that differ only in a literal would be
three routes to keep in step. Validation is declared in the route `schema:` and
never parsed in the handler (`server/AGENTS.md:33`). `POST .../extract` answers
`409 repo_not_cloned` when `repos.clone_path` is null.

### Semantics

**Sampling makes zero model calls.** In order:

1. Config files by fixed name list — `eslint.config.*`, `.eslintrc*`,
   `tsconfig*.json`, `.prettierrc*`, `package.json` — read through
   `container.git.readFile`; a missing one is skipped silently. These are where a
   project states its rules outright, and they are cheap and deterministic to find.
2. `repoIntel.getConventionSamples(repoId, 12)` — the top 12 files by import-graph
   rank, with tests, configs and migrations already removed by `isJunkPath`. This
   is the method's first and only production caller.
3. If that returns `[]` — an unindexed repo, or `repoIntelEnabled` off, both of
   which it degrades to `[]` for by design — fall back to
   `container.codeIndex.grep()` on `SAMPLE_GREP_PATTERN`.

Budgets: `MAX_FILE_BYTES` 10 KB per file, `SAMPLE_BYTE_BUDGET` 180 KB total,
`temperature: 0`, `maxRetries: 2`. Bodies are wrapped with `wrapUntrusted` before
they reach the prompt: during extraction, repository content is data, never
instructions.

The reference implementation on `upstream/reference/full-build` instead spends a
first model call asking the model to pick its own files from a repo map. This spec
deliberately does not: code-side selection is one call cheaper, is deterministic —
so the integration test mocks a single schema rather than a two-turn conversation —
and it is what `getConventionSamples` was written for.

**Evidence gate — no proof, no candidate.** A pure `groundEvidence` helper applies
three checks, and failing any one **drops** the candidate:

1. `evidence_path` must be one of the files actually read. A path the model
   invented is a claim about a file nobody opened.
2. the snippet must occur in that file's text, compared with collapsed whitespace
   so that reindentation does not count as a mismatch.
3. `evidence_line_start` / `evidence_line_end` are then **computed by the server**
   from the match offset.

Two departures from the reference, both deliberate. It clamped confidence to `0.5`
when a snippet could not be found instead of dropping the candidate — a rule whose
evidence does not exist is not a low-confidence rule, it is not a finding. And it
recorded no line number at all, while the design shows `src/api/users.ts:23-31`.
Asking the model for the range would add a second unverifiable claim to validate;
deriving it from a match already proven is free and cannot be wrong. This is the
same shape as `reviewer-core/src/grounding.ts`, which refuses a finding citing a
line absent from the diff.

`convention_scans.dropped` records how many were discarded. A model that
systematically invents evidence must not look like one that never does.

**Confidence is displayed and nothing else.** Root `INSIGHTS.md:605` records the
model returning `confidence: 1.0` for a hallucinated finding as readily as for a
correct one. So it is never sorted, filtered, ranked, thresholded or auto-acted on
— it is prose rendered as a bar. The mockup's own card order (91%, 78%, 85%)
already respects this, and it should not be "fixed" into descending order.

**A re-scan preserves every verdict.** It deletes only `status = 'pending'` rows,
then inserts the fresh candidates, skipping any whose whitespace-normalised `rule`
already exists for that repo with a non-`pending` status. Without that dedup an
accepted rule returns as a duplicate pending card on every scan, and a rejected one
comes back forever — which is the whole reason `status` is tri-state rather than a
boolean. One `convention_scans` row is written per scan, including a scan that
yielded nothing.

**Model resolution:** explicit request body → `getFeatureModelOverride(ws,
'conventions')` (`server/src/modules/settings/feature-models.ts:36`, already
registered at `contracts/platform.ts:74`) → the per-provider default probed against
`listModels()`. The brief calls for a *cheap* model, and the feature-model registry
is where that is chosen — `openrouter` reaches DeepSeek-class models through the
OpenAI-compatible path. A missing key surfaces as `ConfigError`, which is a normal
path to be reported, not a 500 (`server/AGENTS.md:47`).

## Trust

Two things, following `specs/l02-skills.md` §Trust.

1. **The skill body is not `wrapUntrusted`-wrapped.** `INJECTION_GUARD` tells the
   model that anything inside `<untrusted>` is data whose instructions must be
   ignored, and a skill *is* an instruction. Wrapping one would make the feature
   silently do nothing while still costing tokens and appearing in the trace (root
   `INSIGHTS.md:344`).

2. **The residual risk, stated plainly.** The evidence snippet is text the model
   chose out of repository files, and it lands unwrapped inside every subsequent
   review prompt. A repository containing a file that reads like an instruction
   could therefore get that text in front of a review agent. The controls are
   procedural, not a delimiter: the snippet is proven to occur verbatim in a file
   that was actually read, it is fenced as a code block inside the body, only the
   accepted subset is ever promoted, and the user reads each rule and its snippet
   before accepting it. During extraction the same content *is* wrapped — the
   transition from data to instruction happens exactly at the accept click, which
   is where a human is.

   Creating the skill enabled (see Screens) is a judgement that this loop is
   sufficient for a repository the user owns. It would not be sufficient for a
   convention extracted from someone else's repository, and this feature does not
   offer that.

## Mock artifacts

Where the two supplied mockups and this spec disagree, the spec wins:

- The modal's preamble reads "Flag changes that violate any rule below and cite the
  offending `file:line`" with **no severity**. Shipping that wording sets every
  violation to CRITICAL and flips the verdict; the generated body must say
  `Report a **WARNING**`. See Screens.
- The mockups have no `Attach to agent` field, and stop at `Create skill`. Without
  the link the feature has no effect on any review. Added.
- The mockups show no category on the cards, while the brief's candidate shape
  includes one. Rendered as a `Badge`.
- `Detected from 84 sample files · last scan 1h ago` is real data in the design and
  had no storage behind it. Hence `convention_scans`.
- The three cards read `91%`, `78%`, `85%` — not descending. That is correct and
  intentional; do not sort by confidence.

## Acceptance

1. Migrations `0014` (additive) and `0015` (drop `accepted`) together add `status`,
   `category`, `created_at`, `evidence_line_start`, `evidence_line_end`, create
   `convention_scans` and both indexes. `0000`–`0013` are untouched.
2. `POST /repos/:id/conventions/extract` performs **exactly one**
   `completeStructured` call, and sampling performs **none**.
3. Sampling reads the config files it finds plus
   `repoIntel.getConventionSamples(repoId, 12)`, and falls back to `codeIndex.grep`
   only when that returns `[]`.
4. A candidate whose `evidence_path` was not among the sampled files is dropped.
5. A candidate whose `evidence_snippet` does not occur in that file (whitespace
   collapsed) is dropped — not down-ranked.
6. `evidence_line_start` / `evidence_line_end` equal the snippet's real position in
   the file, and are never read from the model's response.
7. `convention_scans` gains one row per scan, carrying `files_sampled`,
   `candidates`, `dropped`, `provider` and `model` — including for a scan that
   produced zero candidates.
8. A re-scan leaves `accepted` and `rejected` rows untouched and replaces only
   `pending` ones.
9. A rule already accepted or rejected is not re-inserted by a later scan.
10. `PATCH /conventions/:id` changes `rule` and nothing else; the evidence fields
    and `confidence` are not writable through any endpoint.
11. `PATCH /repos/:id/conventions/status` accepts one id or many, and
    `Deselect all` moves accepted cards to `pending`, never to `rejected`.
12. `POST /repos/:id/conventions/skill-draft` writes no row to any table.
13. The generated body contains `Report a **WARNING**`, one `##` section per
    accepted convention, and each section's `` `path:start-end` ``.
14. Creating with an agent selected produces an `agent_skills` row, and the skill
    then appears in that agent's next run trace `## Skills / rules` block. Creating
    with "Don't attach yet" produces no `agent_skills` row.
15. A skill created this way has `source = 'extracted'`, `type = 'convention'`,
    `enabled = true`, and `evidence_files` listing the accepted paths.
16. A failed link after a successful create leaves the skill in place and reports
    the link failure.
17. Confidence is rendered on every card and is not used to sort, filter, hide or
    auto-accept anything.
18. `POST .../extract` on a repo with `clone_path = NULL` answers `409`, and a
    missing API key is reported rather than surfacing as a 500.
19. Every UI string resolves through `messages/en/conventions.json`; no literal
    copy in a component.
20. The sidebar shows `Conventions` under `SKILLS LAB`, `g c` navigates to it, and
    it highlights on `/repos/:id/conventions`.
21. `pnpm typecheck`, `pnpm arch`, `pnpm lint` and both server test lanes pass, the
    client suite and `pnpm build` pass, and the comment-stripped diff of
    `contracts/knowledge.ts` between the two `vendor/shared` copies is empty.

## Open questions

- Should `conventions` record the `skill_id` they became? It would let the page
  show "already in a skill" and stop a second `Create skill` from silently
  producing a duplicate. Cheap provenance, absent from the mockups.
- Should `conventions.scan_id` reference the scan that produced each row? The
  header needs only the newest scan, so the minimal migration omits it — but with
  it, an accepted rule could show which model first proposed it.
- The brief offers "many skills from the findings" as an alternative to one merged
  skill. This spec merges, matching the mockups. One skill per rule is what would
  make `SkillStats.accept_rate` attributable to a single rule instead of to a
  bundle, which is the stronger argument for revisiting it.
- Does a scan need a per-repo cooldown? 180 KB through a model is real money and
  `Re-scan` is one click.
- Config files are sampled but never distinguished in the prompt. A rule read out
  of `.eslintrc` is enforceable by tooling and arguably should not become a review
  skill at all — the linter already catches it. Worth a category, or an exclusion?
