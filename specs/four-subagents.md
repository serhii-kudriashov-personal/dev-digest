# Four new subagents — `test-writer`, `architecture-reviewer`, `plan-verifier`, `doc-writer`

## Why

The repo has three subagents — `researcher`, `planner`, `implementer` — and the
chain stops at "the plan is implemented and the gates pass". Four capabilities
are missing, and `.claude/agents/README.md` §"How they chain" already names two
of them as future steps:

- nobody writes tests as a first-class task, with the per-ring styles and the
  `*.it.test.ts` gate in context;
- nobody reviews architectural boundaries in a **fresh context** — `implementer`
  deliberately does not self-certify;
- nobody checks the implementation against the plan **item by item**, so a
  skipped step 4 is invisible until someone re-reads `specs/<slug>.md`;
- nobody writes the feature up afterwards, and a document with no row in a
  `Read when` table is a document nobody opens.

## Scope

**In.** Four agent definitions under `.claude/agents/`, plus their registration
in the three surfaces the repo requires, plus two additive rows in the canonical
path→skill table.

**Out.**

- A security-review agent. It stays the natural fifth and is still missing after
  this change; it needs the `security` skill's OWASP sections routed, not the
  architecture pair.
- Wiring `pnpm arch` into CI (root `INSIGHTS.md` 2026-08-02, Open Questions).
  `architecture-reviewer` makes that gap less painful and must not be presented
  as closing it.
- Mutation testing (Stryker) as a test-quality gate. Evidence for it is strong —
  a suite with 100% coverage and 4% mutation score
  ([arXiv:2506.02954](https://arxiv.org/html/2506.02954)) — but it is a CI tool,
  not a line in an agent body.
- Reorganising `docs/` into a Diátaxis tree. `docs/` today plays the
  *explanation* role and Diátaxis itself warns against creating empty
  structures ahead of content ([diataxis.fr](https://diataxis.fr/how-to-use-diataxis/)).
  `doc-writer` labels the mode in the document instead.
- Adding the missing `engineering-insights` row to `.claude/skills/README.md`
  §Catalog (13 rows for 14 skill directories). Real, pre-existing, and a
  different concern.
- Any change to `agents.system_prompt` or `docs/agent-prompts/*`. Those are
  DevDigest review agents, an entirely different system from Claude Code
  subagents.
- Any change to package source, schema, contracts or migrations.

## Context that binds

| Source | Rule | Where it lands |
|---|---|---|
| root `INSIGHTS.md` 2026-08-08 (frontmatter) | `skills:` injects **full bodies at startup** and is the only deterministic way to get a skill into a subagent; naming it in the body is not a trigger | every `skills:` decision below |
| same | `permissionMode: plan` stalls without a body rule, because `ExitPlanMode` is stripped | none of the four uses it — see Risks |
| same | `disallowedTools` resolves first, then `tools` against what remains | deny lists that repeat a `tools` exclusion, as documentation of intent |
| root `INSIGHTS.md` 2026-08-08 (tools) | `AskUserQuestion` is stripped; a subagent's only channel to the user is its final message | every `## Clarification needed` hard stop |
| same | background subagents silently resolve a narrower built-in tool list | every tool granted is on that list, so foreground and background behave alike |
| same | **there is no per-skill deny** | `Skill` removed wholesale from both read-only agents |
| root `INSIGHTS.md` 2026-08-08 (`routing.md`) | it is the single canonical path→skill table; a skill with no row is one no agent is told to open | Step 1 adds the two missing rows |
| root `INSIGHTS.md` 2026-08-02 (`confidence`) | `findings.confidence` returns `1.0` for a hallucination as readily as for a real defect | `architecture-reviewer` emits no confidence number, ever |
| root `INSIGHTS.md` 2026-08-02 (severity) | a rule that does not state its severity comes back CRITICAL | mandatory severity column |
| root `INSIGHTS.md` 2026-08-02 (stacking) | an extra prompt block *crowded out* findings a previous run caught: 3 → 2, one hallucinated, score 41 → 30 | `plan-verifier` preloads nothing |
| root `INSIGHTS.md` 2026-08-03 (sweep) | a per-item receipt is the only cheap way to tell "nothing matched" from "the run broke" | `plan-verifier`'s `## Counts` must sum to N |
| root `INSIGHTS.md` 2026-08-02 (symlink) | `CLAUDE.md` is a symlink; edit `AGENTS.md` | `doc-writer`'s first hard constraint |
| `AGENTS.md` §Repo rules | all Markdown in English; a DB-backed test is `*.it.test.ts` | `test-writer`, everywhere |
| `AGENTS.md` §Do not touch | vendored skills = those in `skills-lock.json` | `pr-self-review` is **not** in the lock (8 names, checked with `jq`), so Step 1 is in policy |
| `docs/l02-experiment.md` | one run proves nothing; the control agent went 1 → 4 → 3 findings and 97 → 0 → 50 | the verification plan's tier 2 |

## Contracts — the four definitions

Every `description` is third person and carries *what it does* + *Use when* +
*Do NOT use*, per `.claude/agents/README.md:203`.

### `test-writer`

```yaml
tools: Read, Grep, Glob, Edit, Write, Bash, Skill, TodoWrite
disallowedTools: WebSearch, WebFetch, NotebookEdit
# no model — inherits, like implementer
# no skills — nothing is unconditional here
```

**Why no preload.** By the README's own criterion — "unconditionality, not
importance" — a client-only task never needs `backend-onion-architecture`
(≈6.8k tokens) and a server-only task never needs `react-testing-library`
(≈4.8k). Routing stays deterministic because the agent reads `routing.md` and
invokes a **named** skill; the non-determinism the insight warns about is
description-matched discovery, not named invocation.

**The load-bearing constraint** — never change production code to make a test
pass, never weaken an assertion. This is a measured failure mode, not a style
preference:

- ImpossibleBench ([arXiv:2510.20270](https://arxiv.org/pdf/2510.20270)):
  frontier models cheat by "modifying test assertions, inserting special-case
  logic", and **stronger models cheat more**.
- RLVR reward hacking ([arXiv:2604.15149](https://arxiv.org/pdf/2604.15149)):
  models learn to "weaken or remove validation checks".
- Misguidance ([arXiv:2607.22883](https://arxiv.org/abs/2607.22883), ISSTA
  2026): buggy code in context steers the model into tests that *validate the
  bug*. Mitigation, and therefore a body rule: derive the expected behaviour
  from the contract or the plan, never from the current implementation.

**Permitted exceptions**, both reported as deviations: adding a mock to
`server/src/adapters/mocks.ts` for a new port
(`backend-onion-architecture` §9 — "Every new port needs a mock… or ring 2
becomes untestable"), and adding a **test-only** devDependency. The second is
live: `client/` has no `@testing-library/user-event` and all interactive tests
use `fireEvent`, one via `querySelectorAll` — against both the current
[RTL docs](https://testing-library.com/docs/user-event/intro/) and the
`react-testing-library` skill.

Report sections: `Task` · `Tests written` · `Placement decisions` ·
`Skills loaded` · `Verification` · `Production code untouched` ·
`Not done / blocked` · `Insight candidates`.

### `architecture-reviewer`

```yaml
tools: Read, Grep, Glob, Bash, Skill
disallowedTools: Write, Edit, NotebookEdit, WebSearch, WebFetch
model: opus
skills: [backend-onion-architecture, frontend-ui-architecture]
```

`Skill` is granted. It was briefly denied, to guarantee the agent could not run
`pr-self-review` — the right worry, the wrong mechanism. The verdict that gates
`gh pr create` is written by the **model** (`pr-self-review/SKILL.md` §3), not by
`scripts/pr-self-review.sh`, whose four subcommands (`state`, `files`, `gates`,
`gate`) are all read-only. So `disallowedTools: Write, Edit, NotebookEdit`
already blocks the forgery structurally, and removing `Skill` cost the whole
catalogue plus `engineering-insights` while buying nothing. The prohibition is
now a body contract with its real reason, as it already is for `implementer` —
which holds both `Write` and `Skill` and is therefore the strictly more
dangerous case the repo already accepts.

Both skills preloaded because for **this** agent they are unconditional by
construction: they are its entire rulebook.

`Bash` is granted and the body says what "read-only" means here — makes no
edits, not runs nothing. `pnpm arch` is the strongest evidence available.

Three anti-hallucination mechanisms:

1. **Grounding.** Every finding carries `path:line` + the **verbatim** source
   line + the skill section. Missing either → `## Unverified suspicions` with
   the search that failed. Same shape as `reviewer-core/src/grounding.ts` and
   `pr-self-review/SKILL.md` §4.
2. **Debt subtraction.** A hit inside the `backend-onion-architecture` §12 list
   or a `.dependency-cruiser.cjs` `pathNot` goes to
   `## Pre-existing (debt, §12)`, never to Findings. A *new* file copying one of
   those patterns **is** a finding. The list may only shrink — never widen a
   glob to make something quiet.
3. **Mandatory severity, no confidence.** CRITICAL / HIGH / MEDIUM, never blank;
   no confidence number anywhere.

Plus an explicit line in §Discipline that a report with no findings is a valid
and common outcome — [Claude Code Best Practices](https://code.claude.com/docs/en/best-practices):
"A reviewer prompted to find gaps will usually report some, even when the work
is sound… Chasing every finding leads to over-engineering."

Report sections: `Scope reviewed` · `Automated gate` · `Findings` ·
`Pre-existing (debt, §12)` · `Unverified suspicions` · `Not mine` ·
`Insight candidates`.

### `plan-verifier`

```yaml
tools: Read, Grep, Glob, Bash, Skill
disallowedTools: Write, Edit, NotebookEdit, WebSearch, WebFetch
model: opus
# no skills — deliberately
```

`Skill` is granted for the same reason as on `architecture-reviewer` above, but
carries a second limit here: almost every skill is an opinion about how code
*should* be written, which is exactly the authority this agent does not have.
Opening one is how a conformance check becomes general advice. Two exceptions —
`engineering-insights`, and a skill the **plan itself names in a step**, read
only to decide whether that step was followed.

**No preload is the sharpest decision in this spec.** Preloading
`backend-onion-architecture` would hand the agent 27k characters of
architectural opinion it is *forbidden to act on*, and root `INSIGHTS.md`
2026-08-02 measured what an extra block does: it crowds out what the previous
run caught. Context is not only a token cost, it is a suggestion. This agent
gets one document in context — the plan.

Five mechanisms against the generic-advice failure mode, each sourced:

| Mechanism | Source |
|---|---|
| **Extract-first** — parse every step and acceptance criterion into a numbered list, ending in `N items`, **before opening a single source file** | obligation extraction then independent audit — [arXiv:2508.12358](https://arxiv.org/html/2508.12358v1) |
| **One row per item**, exactly N rows, in the extracted order | checklist decomposition raises agreement and cuts variance — CheckEval, [arXiv:2403.18771](https://arxiv.org/abs/2403.18771) (EMNLP 2025) |
| **Closed verdict enum** — `met` / `partial` / `not-met` / `deviated` / `unverifiable`, no sixth value | requirements-traceability practice; a separate bucket for non-verifiable content — [arXiv:2605.17926](https://arxiv.org/html/2605.17926v1) |
| **Typed evidence** — `path:line` actually read, or the verbatim tail of a command actually run. Prose in that column is itself a defect | behavioural-comparison prompting (2508.12358); same gate as `grounding.ts` |
| **Banned output** — no "consider…", "best practice is…", "for maintainability…" | asking a checker to "explain the problem and propose a fix" **increases** false rejection of correct code: GPT-4o RCRR 52.4% → 11.0% on HumanEval ([arXiv:2508.12358](https://arxiv.org/html/2508.12358v1)) |

That last row is the counter-intuitive one and the reason the agent exists: the
familiar "find problems and suggest fixes" framing makes a verifier **worse**.
The body therefore forbids that framing and requires the model to state, per
item, what the plan requires and what the code does, *then* compare.

Against agreement bias, the body requires arguing the `not-met` case before any
`met` verdict is permitted — Sharma et al.
([arXiv:2310.13548](https://arxiv.org/abs/2310.13548), ICLR 2024, Anthropic)
measure Claude 1.3 conceding on 98% of challenged questions; a critical persona
recovers 68–98% of targeted-steering's effect
([arXiv:2605.21006](https://arxiv.org/html/2605.21006v1)).

`## Findings outside the plan` is admissible in exactly two cases: a repo rule
or deterministic gate the change breaks (cited), or a plan item that has become
impossible (named). `None` is the expected answer.

Report sections: `Plan verified` · `Items extracted` · `Conformance` ·
`Counts` · `Findings outside the plan` · `Not mine` · `Insight candidates`.
Hard stops: `## No plan to verify` and `## Clarification needed`.

### `doc-writer`

```yaml
tools: Read, Grep, Glob, Edit, Write, Bash, Skill, TodoWrite
disallowedTools: WebSearch, WebFetch, NotebookEdit
model: sonnet
skills: [mermaid-diagram]
```

`mermaid-diagram` is the only preload: ≈1.8k tokens, and unconditional by
charter — every run produces a document and a diagram is part of what the agent
is for. The architecture skills are conditional (a client doc never needs the
rings) and therefore routed on demand.

Placement table, derived from the eight `README.md` files that actually exist —
not invented. Package-level `docs/` and `specs/` exist in `client/`, `server/`,
`reviewer-core/`; `e2e/` has `docs/` only, and `e2e/specs/` holds nine
`*.flow.json` browser flows, not prose.

Three never-touch rules, each with its reason: never write or replace a
`CLAUDE.md` (symlink, mode `120000`); never hand-edit an `INSIGHTS.md`
(`engineering-insights` owns the format and the routing, append-only, supersede
with a new dated entry); never edit `docs/agent-prompts/*` unless the task names
it (those mirror live `agents.system_prompt` rows and the DB is the runtime
source of truth).

**Registration is mandatory**, quoting `docs/README.md`: "Added a file? Add a
row to the `Read when` table of the matching AGENTS.md — otherwise nobody will
read it." A document with no row is not done.

Diagram selection: choose the type by purpose, and prefer Mermaid's **stable**
types — its `C4Context` syntax is officially
[experimental](https://mermaid.js.org/syntax/c4.html) ("the syntax and
properties can change in future releases"). C4 stays as a way to pick the level
and the audience ([c4model.com](https://c4model.com): Context → everybody;
Container → technical staff; Component → only "if you feel they add value";
Code → discouraged for long-lived documentation).

Against fabricated documentation, a mandatory `## Anchors used` section: every
non-obvious statement traces to a `path:line` the agent read. DocAgent
([arXiv:2504.08725](https://arxiv.org/abs/2504.08725)) frames LLM doc failure as
incomplete / unhelpful / factually incorrect and fixes it architecturally, with
a verifier — this is the cheap version of that.

Diátaxis mode is recorded as a label in the document
([diataxis.fr](https://diataxis.fr/start-here/): the four modes are separated by
action-vs-cognition × acquisition-vs-application, and "crossing or blurring the
boundaries… is at the heart of a vast number of problems in documentation").
ADRs follow Nygard's format
([2011](https://cognitect.com/blog/2011/11/15/documenting-architecture-decisions))
and supersede rather than get edited — which is already this repo's rule.

Report sections: `Documents written` · `Anchors used` · `Diagrams` ·
`Not documented` · `Verification` · `Insight candidates`.

## Overlap — settled before writing

| Pair | The distinction |
|---|---|
| `architecture-reviewer` vs `pr-self-review` | one is a **gate over a diff** that writes a verdict and blocks `gh pr create`; the other is a **review over a boundary** that writes nothing and blocks nothing. Its findings are an *input* to `pr-self-review` §4's dedup, not a substitute |
| `architecture-reviewer` vs `implementer` | `implementer` runs `pnpm arch` and reports a **fact**; the reviewer produces a **judgement**, in a fresh context, about the things the gate structurally cannot see — a wrong ring with no import edge, a port named after its library, a ring-2 service reading `container.db`, every placement question |
| `plan-verifier` vs `architecture-reviewer` | different authorities. The reviewer's authority is a **skill** — the rule holds whether or not any plan mentioned it, and it never reads `specs/`. The verifier's authority is the **plan**. A perfect-architecture implementation that skipped step 4 is `not-met` for one and invisible to the other |
| skill or agent? | all four are agents. `test-writer` and `doc-writer` own tasks and write files, which a skill cannot. Both reviewers need a **separate context window** — that is the mechanism, not a nicety. `doc-writer` is the borderline one: its placement table is skill-shaped, so it starts in the agent body and is promoted to `.claude/skills/doc-placement/` only when a second consumer appears (`frontend-ui-architecture` §2, the promotion rule) |

## Steps

1. **`routing.md`** — two additive rows, no existing row edited:
   `reviewer-core/test/**` → `backend-onion-architecture` §9, and
   `.claude/agents/**` → no skill, with the registration note.
2. **`.claude/agents/test-writer.md`** — new file per the contract above.
3. **`.claude/agents/architecture-reviewer.md`** — new file.
4. **`.claude/agents/plan-verifier.md`** — new file.
5. **`.claude/agents/doc-writer.md`** — new file.
6. **`.claude/agents/README.md`** — four rows in §The set; **rewrite `:24-26`**,
   which currently claims architecture review is not in the set and which a new
   agent falsifies; extend the chain diagram; four new `## <agent>` sections;
   turn §"Why only two skills are preloaded" into a per-agent table keeping the
   measured token figures and the criterion sentence verbatim; extend the
   sources tables and the "Not sourced — judgement calls" block.
7. **`.claude/skills/README.md` §Agents** — four rows; rewrite the closing
   "The pair is a chain" sentence, keeping the load-bearing claim that the file
   is the handoff. **root `AGENTS.md` §Read when** — four trigger rows.
8. **Structural self-check** — every frontmatter key is one of the eight
   supported fields; each new file has `## Hard constraints`, a fenced report
   template and `## Discipline`; `git ls-files -s '*CLAUDE.md'` prints `120000`
   on all five rows.

## Acceptance

1. Four files exist under `.claude/agents/`.
2. Every frontmatter key across all seven agents is one of `name`,
   `description`, `tools`, `disallowedTools`, `model`, `permissionMode`,
   `skills`, `color`.
3. Every tool granted is on the background-safe built-in list.
4. Every `description` is third person with *what* + *Use when* + *Do NOT use*.
5. Each new file has `## Hard constraints`, at least one fenced markdown report
   template, and `## Discipline`. `test-writer`, `architecture-reviewer` and
   `doc-writer` carry `## Clarification needed`; `plan-verifier` carries
   `## No plan to verify` as well.
6. No new agent forges a `pr-self-review` verdict: the two read-only reviewers
   by tool removal (`Write` — which is what the verdict actually needs), all
   four by an explicit body contract naming the reason.
7. `plan-verifier`'s template has the extract-first rule, the five-value enum,
   the typed Evidence column, a `## Counts` line that sums to N, and the
   two-case admissibility test.
8. `architecture-reviewer`'s template has a mandatory severity column, **no**
   confidence column anywhere, a verbatim-line column, a mandatory
   `## Automated gate` section and a separate `## Pre-existing (debt, §12)`.
9. `doc-writer`'s body has the full placement table with a source per row, the
   mandatory `Read when` registration rule, and the three never-touch rules.
10. `test-writer`'s body states the `*.it.test.ts` rule, the four per-ring test
    styles, the three placement conventions, and "a skip is a skip".
11. All three registration surfaces list all seven agents, and
    `.claude/agents/README.md` no longer claims architecture review is outside
    the set.
12. `routing.md` has the two new rows, no existing row altered.
13. `git ls-files -s '*CLAUDE.md'` → `120000` on all five rows.
14. All new and edited Markdown is in English.

## Verification

**No package gate runs on this diff** — there is no compiler, linter or
renderer for agent markdown, and `typecheck` / `arch` / `lint` / `shared:sync` /
`test-naming` are all selected by paths this change does not touch. `routing.md`
§"No row matched" applies: **silence is not a pass**. The four mechanical checks
are the frontmatter-key grep, the symlink check, `jq` on `skills-lock.json`, and
`git status --porcelain`.

Functional verification is the caller's — a subagent has no `Agent` tool.

*Tier 1 — does it run.*

| Agent | Smoke target | Passes when |
|---|---|---|
| `test-writer` | a test for `resolveSkillAttribution` in `server/src/modules/reviews/helpers.ts` | writes `server/test/*.test.ts` (no `.it.` — it is pure), reports counts verbatim, touches no production file |
| `architecture-reviewer` | `server/src/modules/pulls/routes.ts` | the ~25 Drizzle sites land under `## Pre-existing (debt, §12)`, **not** as new CRITICALs; `## Automated gate` carries a real exit code |
| `plan-verifier` | `specs/l02-skills.md` + the shipped L02 code | `## Items extracted` count matches steps + acceptance lines; `## Conformance` has exactly that many rows; `## Findings outside the plan` reads `None` |
| `doc-writer` | "document the run trace pipeline" | picks `server/docs/` or `docs/`, cites the rule, adds the `Read when` row, fences a ```mermaid block |

*Tier 2 — does it help.* Per `docs/l02-experiment.md`, one run proves nothing.
Run each arm at least twice; the reportable result is a **specific** finding
present in every on-run and no off-run.

- `plan-verifier`: `specs/l02-skills.md` against the complete tree (control) vs
  the same tree with one step reverted. Passes if it returns `not-met` on
  exactly the reverted item, twice, and does not drift into advice on the
  control.
- `architecture-reviewer`: a fresh `routes.ts` with a planted `db.select()` vs
  the same file clean. Passes if both on-runs cite it to
  `backend-onion-architecture` §6 with the verbatim line, and neither clean run
  invents one.

LLM judges are self-inconsistent across repeated runs — Krippendorff's α
0.265–0.563, and prompting tricks do not fix it
([arXiv:2510.27106](https://arxiv.org/html/2510.27106v1)). If a
`plan-verifier` verdict ever gates something, run it twice and escalate
disagreement to a human.

## Open questions — all closed 2026-08-08

All three were resolved before the definitions shipped; the defaults stood in
every case. Kept here as the record of what was weighed, not as pending work.

1. ~~**Does `skills:` preloading survive `disallowedTools: Skill`?**~~
   **Closed** — moot. Both read-only reviewers now hold `Skill`, so nothing
   depends on the answer. The question existed because `architecture-reviewer`
   denied `Skill` while preloading two skills; that denial has been removed
   (see the `architecture-reviewer` contract above).
2. **`permissionMode: plan` on the two read-only agents?** **Decided: no, on
   neither.** It buys a harness-enforced no-edit guarantee, but
   [permission-modes](https://code.claude.com/docs/en/permission-modes)
   describes `plan` as "reads, plus classifier-approved commands", and a
   subagent that hits a prompt has no channel to answer it. Evidence gathered
   while deciding: `planner` runs in `permissionMode: plan` **with** `Bash` and
   executed `git` and `jq` without stalling — so read-only shell is fine in the
   mode. What stayed untested is a *package script* (`pnpm arch`, `pnpm test`),
   which is what both reviewers actually need. Since `disallowedTools: Write,
   Edit, NotebookEdit` already blocks the only thing plan mode would add, the
   mode would be a second layer against the same threat while introducing a new
   failure it does not have today: an agent that hangs silently. If a reviewer
   is ever reduced to pure reading, revisit.
3. **Valid `color` values.** **Decided: keep them.** `cyan`, `blue`, `green` are
   proven here; `yellow`, `red`, `orange`, `purple` are assumed. The field is
   cosmetic and an unrecognised value is at worst ignored, so the cost of being
   wrong is a default swatch — against seven agents that are told apart at a
   glance in the picker.

## Risks

- **`architecture-reviewer` will over-report at first.** §12 subtraction is the
  mitigation and `modules/pulls/routes.ts` is the deliberate worst-case smoke
  target. If it still reports debt as new findings, sharpen the subtraction step
  in the body — do **not** widen a glob or add a `pathNot`.
- **`plan-verifier` has no "the plan was wrong" verdict.** An item implemented
  exactly as specified, where the spec itself was wrong, returns `met`. That is
  correct — its authority is the plan — but a clean conformance table must not
  be read as "this change is good". The body says so, and the caller must not
  skip `architecture-reviewer`.
- **Seven agents is a discoverability problem.** Selection is by description
  matching, and "review" / "verify" / "plan" overlap. Mitigated by every
  description naming its sibling under *Do NOT use*. Unmeasured.
- **The preload split is unmeasured** — the same status root `INSIGHTS.md`
  2026-08-08 already records for the existing two-skill split. Do not report a
  good first run as validation.
- **No renderer, no linter, no CI for any of this.** Malformed YAML, a broken
  Mermaid block or a dead link ships silently. Step 8's greps are the whole
  safety net, and they are shallow — the same class of gap root `INSIGHTS.md`
  2026-08-02 records for `pnpm arch`: rules that look enforced and are not.
- **`.claude/agents/` is untracked**, so `git diff` shows nothing; only
  `git status --porcelain` does.

## Sources

Beyond the repo's own record, cited inline above.

**Anthropic primary.**
[sub-agents](https://code.claude.com/docs/en/sub-agents) — the 15 frontmatter
fields, `name`/`description` the only required ones, the `code-reviewer` example
made read-only by tool omission (note the docs carry two versions of it with
different tool lists, so "read-only" there means no `Edit`/`Write`, not no
`Bash`) ·
[best-practices](https://code.claude.com/docs/en/best-practices) — "a fresh
model try to refute the result, so the agent doing the work isn't the one
grading it", and the over-triggering warning ·
[permission-modes](https://code.claude.com/docs/en/permission-modes) ·
[built a multi-agent research system](https://www.anthropic.com/engineering/built-multi-agent-research-system)
— "each subagent needs an objective, an output format, guidance on the tools and
sources to use, and clear task boundaries" ·
[demystifying evals](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents)
— LLM-judge graders need calibration against humans; give the judge an
"Unknown" escape hatch. There is **no** official product-doc example subagent
named test-writer, doc-writer or verifier.

**Verification and judging.** 2508.12358 (spec-conformance failure modes; the
"explain and fix" degradation; two-phase and behavioural-comparison prompts) ·
2403.18771 CheckEval · 2306.05685 MT-Bench (position, verbosity,
self-enhancement bias) · 2410.21819 (self-preference traced to perplexity) ·
2510.27106 (self-inconsistency) · 2310.13548 (sycophancy) · 2605.21006
(critical-persona framing) · 2605.17926 (industrial static verification of code
against NL requirements).

**Testing.** 2510.20270 ImpossibleBench · 2604.15149 (RLVR reward hacking) ·
2607.22883 (buggy-code misguidance) · 2506.02954 MutGen (coverage vs mutation
score) · [testing-library docs](https://testing-library.com/docs/queries/about/)
(query priority, `userEvent` over `fireEvent`) ·
[Fastify testing guide](https://fastify.dev/docs/latest/Guides/Testing/)
(`inject` and a real server both shown, no stated preference) ·
[Vitest workspace](https://vitest.dev/guide/workspace.html) (glob split, which
this repo's `*.it.test.ts` convention already is).

**Documentation.** [Diátaxis](https://diataxis.fr/start-here/) ·
[Nygard ADRs](https://cognitect.com/blog/2011/11/15/documenting-architecture-decisions)
· [MADR v4.0.0](https://adr.github.io/madr/) ·
[Google styleguide](https://google.github.io/styleguide/docguide/best_practices.html)
("change your documentation in the same CL as the code change") ·
[Write the Docs](https://www.writethedocs.org/guide/docs-as-code/) ·
[C4 model](https://c4model.com) ·
[Mermaid C4 is experimental](https://mermaid.js.org/syntax/c4.html) ·
2504.08725 DocAgent.
