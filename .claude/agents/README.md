# Agents

Subagents for this repo. Each is a separate Claude Code process with its **own
context window, own tool allowlist and own model**, invoked through the Agent
tool. This file is the map; the rules live in each agent's own definition.

Not skills. A skill is knowledge loaded into the *current* context on demand
(`.claude/skills/`, catalogued in `.claude/skills/README.md`). An agent is a
separate run with a separate context that you delegate a whole task to. An agent
may load skills; a skill cannot spawn an agent.

`.claude/agents/**` is **not** in `skills-lock.json` — unlike most of
`.claude/skills/**`, these files are ours to edit and will not be overwritten on
sync.

## The set

| Agent | Model | Reads | Writes | Use it for |
|---|---|---|---|---|
| [`researcher`](researcher.md) | Sonnet | repo + web | nothing | "where does X live", "what does the upstream doc actually say" |
| [`planner`](planner.md) | Opus | repo only | nothing | "how should we build X here" → a Development Plan |
| [`implementer`](implementer.md) | inherits | repo only | `client/`, `server/`, `reviewer-core/` | executing an approved plan |
| [`test-writer`](test-writer.md) | inherits | repo only | tests in `client/`, `server/`, `reviewer-core/` | "cover this with tests"; a red suite whose fix belongs in the test |
| [`architecture-reviewer`](architecture-reviewer.md) | Opus | repo only | nothing | "does this respect the rings and the placement rules" |
| [`plan-verifier`](plan-verifier.md) | Opus | repo only | nothing | "was `specs/<slug>.md` actually implemented, item by item" |
| [`doc-writer`](doc-writer.md) | Sonnet | repo only | `docs/`, `specs/`, `README.md`, `AGENTS.md` | writing up a shipped feature, with diagrams |

Architecture review **is** in the set, as a separate agent and a separate step —
`implementer` deliberately does not self-certify, and reviewing in the context
that wrote the code is not a review. **Security review is still not in the set.**
It remains to be written; until it exists, the security column of any change is
a human's.

## How they chain

```
                    ┌─ researcher ──→ report (evidence + what it could not find)
                    │
request ─→ planner ─→ Development Plan ─→ [caller saves specs/<slug>.md]
                                                        │
                                          [human reviews and approves]
                                                        ↓
                                          implementer ─→ Implementation Report
                                                        ↓
                                          test-writer ─→ tests + counts
                                                        ↓
                     ┌──────────────────────────────────┴──────────────────────┐
                     ↓                        ↓                                ↓
              plan-verifier          architecture-reviewer            security review
           (against the plan)        (against the skills)              (nobody yet)
                     └──────────────────────────────────┬──────────────────────┘
                                                        ↓
                                           doc-writer ─→ docs + Read when row
```

The two reviewers answer different questions from different authorities, which
is why both run. `plan-verifier`'s authority is the **plan** — it never opens a
skill. `architecture-reviewer`'s authority is a **skill** — it never opens
`specs/`. A change that skipped step 4 is invisible to one; a plan-conformant
change that put Drizzle in `routes.ts` is invisible to the other.

**The file is the handoff.** Subagents share no context and no message channel
(`docs/en/sub-agents`: "Each subagent starts with a fresh, isolated context
window"), so a plan relayed by paraphrase loses exactly the constraints it exists
to carry. Save the plan, then give `implementer` the path.

None of them can call another — subagents have no `Agent` tool. When one needs
another's work it says so in its report and the caller dispatches it.

---

## `researcher`

**Responsibility.** Answer a question with evidence. Two modes: REPO (how does
this codebase do X, cites `path:line`) and EXTERNAL (what does the upstream doc
say, cites a URL, pins the version and the date). Never applies anything.

| | |
|---|---|
| **Model** | `sonnet` |
| **Tools** | `Read, Grep, Glob, Bash, WebSearch, WebFetch` |
| **Denied** | `Write, Edit, NotebookEdit, Skill` |
| **Input** | a question with a decision attached to it |
| **Output** | report — Conclusions · Evidence table · Links · Conflicts · **Not found** · Next steps |

`Bash` is read-only by contract, not by mechanism. No `Skill`, so it cannot run
`/deep-research` and cannot write insights — it surfaces them under Next steps
for the caller to capture.

## `planner`

**Responsibility.** Turn a request into a Development Plan the implementer can
execute cold: what already exists, which repo rules bind the change, ordered
steps, and the exact skills each step is governed by.

| | |
|---|---|
| **Model** | `opus` |
| **Tools** | `Read, Grep, Glob, Bash, Skill` |
| **Denied** | `Write, Edit, NotebookEdit, WebSearch, WebFetch` |
| **Mode** | `permissionMode: plan` — edits blocked at the harness level, not only by the tool list |
| **Preloaded skills** | `backend-onion-architecture`, `frontend-ui-architecture` — the same two as `implementer` |
| **Input** | a feature request; optionally an existing `specs/*.md` to refine |
| **Output** | markdown Development Plan → the caller saves it to `specs/<slug>.md` |

Plan sections: `Task` · `Context read` · `Inventory — what already exists` ·
`Constraints that bind` · `Modules touched` · `Skills the implementer must load`
· `Steps` · `Verification plan` · `Acceptance` · `Risks & open questions` ·
`Out of scope` · `Handoff`.

Three things worth knowing before you use it:

- **It loads the same skills the implementer will.** Same two preloaded, same
  `routing.md` for the rest, and it must actually open every skill it lists —
  the plan's skill table is "what I read", not "what someone should read". A
  plan written without the governing rule is a plan the implementer has to
  deviate from. It is forbidden from running `pr-self-review` by the same body
  contract the implementer carries, since there is no per-skill deny.
- **It cannot reach the web.** A plan that depends on an unverifiable upstream
  fact says `needs researcher: <question>` under Risks, with the assumption it
  proceeded on.
- **It stops rather than guesses.** A vague request returns only a
  `## Clarification needed` block — subagents have no `AskUserQuestion`, so that
  hard stop is its only channel.

## `implementer`

**Responsibility.** Execute an approved plan across `client/` and `server/`,
load the skills the plan names, and run this repo's gates against its own
changes. Nothing else.

| | |
|---|---|
| **Model** | inherits the session's |
| **Tools** | `Read, Grep, Glob, Edit, Write, Bash, Skill, TodoWrite` |
| **Denied** | `WebSearch, WebFetch, NotebookEdit` |
| **Preloaded skills** | `backend-onion-architecture`, `frontend-ui-architecture` — full bodies injected at startup |
| **Input** | a path to `specs/<slug>.md` |
| **Output** | Implementation Report + changes left **in the working tree** |

Report sections: `Plan followed` · `Changes` · `Skills applied` ·
`Verification` · `Deviations from the plan` · `Not done / blocked` ·
`Handoff to review` · `Insight candidates`.

**What it will not do**, all as contracts in its body because `Bash` cannot be
scoped by command pattern in frontmatter and there is no per-skill deny:

- never runs `pr-self-review` — certifying a tree it just wrote is not a review
- never commits, pushes, or opens a PR; changes are left for the caller
- never touches the `AGENTS.md` §Do not touch list (migrations, `grounding.ts`,
  `INJECTION_GUARD`, `vendor/**`, reserved empty tables) — it stops that step,
  finishes the rest, and reports it
- never runs `./scripts/e2e.sh`, `db:migrate`, or `db:seed` unless the plan names
  the command
- never expands the plan; extra improvements go under `Deviations` as suggestions

Gates it does run, keyed to what changed: `pnpm typecheck` (server, client,
reviewer-core) · `pnpm arch` · `pnpm lint` (client) · `pnpm test` per package ·
`./scripts/check-shared-sync.sh` · the `CLAUDE.md` symlink check. Full table in
`implementer.md` §Method 4; the rationale per gate is
`.claude/skills/pr-self-review/gates.md`.

## `test-writer`

**Responsibility.** Write and repair tests, in the style the ring or the package
demands, and report what each one would actually catch. Nothing else.

| | |
|---|---|
| **Model** | inherits the session's |
| **Tools** | `Read, Grep, Glob, Edit, Write, Bash, Skill, TodoWrite` |
| **Denied** | `WebSearch, WebFetch, NotebookEdit` |
| **Preloaded skills** | none — nothing is unconditional for this agent |
| **Input** | a behaviour and the file that owns it |
| **Output** | Test Report + tests left **in the working tree** |

Report sections: `Task` · `Insights read` · `Tests written` ·
`Placement decisions` · `Skills loaded` · `Verification` ·
`Production code untouched` · `Not done / blocked` · `Insight candidates`.

Three things worth knowing:

- **It will not change production code to make a test pass**, and it will not
  weaken an assertion to get green. If the code is wrong it leaves the test
  failing and reports it — fixing it needs a plan and `implementer`. This is the
  one rule the agent exists to hold: models measurably do the opposite when the
  instruction is merely "make the tests pass".
- **It writes the expectation from the contract, not from the implementation.**
  Code under test may itself be buggy, and a test paraphrased from it asserts the
  bug and passes forever.
- **Two exceptions are permitted, both reported as deviations**: a mock in
  `server/src/adapters/mocks.ts` for a new port, and a test-only devDependency.
  The second is live — `client/` has no `@testing-library/user-event`.

## `architecture-reviewer`

**Responsibility.** Answer whether code respects this repo's boundaries, with
evidence. Read-only, in its own context, because reviewing in the session that
wrote the code is self-certification.

| | |
|---|---|
| **Model** | `opus` |
| **Tools** | `Read, Grep, Glob, Bash, Skill` |
| **Denied** | `Write, Edit, NotebookEdit, WebSearch, WebFetch` |
| **Preloaded skills** | `backend-onion-architecture`, `frontend-ui-architecture` — its rulebook for boundaries |
| **Input** | a diff, a path, a package or a commit range |
| **Output** | Boundary Review — findings with `path:line` + the verbatim line + the rule |

Report sections: `Scope reviewed` · `Automated gate` · `Findings` ·
`Pre-existing (debt, §12)` · `Unverified suspicions` · `Not mine` ·
`Insight candidates`.

- **It writes no verdict file and blocks nothing.** `pr-self-review` is the gate;
  this agent's findings are an *input* to that skill's dedup step, never a
  substitute for it.
- **It subtracts the known debt.** A hit inside `backend-onion-architecture` §12
  or a `.dependency-cruiser.cjs` `pathNot` is reported as pre-existing, not as a
  new finding — but a *new* file copying one of those patterns is a finding.
- **Severity always, confidence never.** An unstated severity comes back
  CRITICAL, and `findings.confidence` is not calibrated (root `INSIGHTS.md`
  2026-08-02, twice). A report with **no** findings is a valid and expected
  outcome; a reviewer asked to find gaps will invent some if you let it.
- It holds `Skill` and can reach the whole catalogue, including
  `engineering-insights`. What stops it forging a `pr-self-review` verdict is
  not a missing tool but a missing `Write`: the verdict file is written by the
  **model**, following `pr-self-review/SKILL.md` §3, never by the script.

## `plan-verifier`

**Responsibility.** Check an implementation against its plan, item by item, and
refuse to do anything else.

| | |
|---|---|
| **Model** | `opus` |
| **Tools** | `Read, Grep, Glob, Bash, Skill` |
| **Denied** | `Write, Edit, NotebookEdit, WebSearch, WebFetch` |
| **Preloaded skills** | **none — deliberately** |
| **Input** | a path to `specs/<slug>.md` (never a summary) + the implementation |
| **Output** | Conformance Report — one row per plan item |

Report sections: `Plan verified` · `Items extracted` · `Conformance` ·
`Counts` · `Findings outside the plan` · `Not mine` · `Insight candidates`.
Hard stops: `## No plan to verify`, `## Clarification needed`.

- **It extracts every item before opening a single source file**, quotes the plan
  verbatim, and emits exactly one table row per item with a verdict from a closed
  enum — `met` / `partial` / `not-met` / `deviated` / `unverifiable`. The
  `## Counts` line must sum to the extracted count; a missing row is a failed run.
- **Evidence is typed**: a `path:line` it read, or verbatim command output. Prose
  in that column is itself a defect, and an item it cannot evidence is
  `unverifiable`, never `met`.
- **It will refuse to give you general advice, and that is the feature.** The
  "explain the problem and propose a fix" framing measurably makes a
  code-versus-spec checker *worse* — it hunts for defects before committing to a
  verdict and rejects correct implementations. So the order is fixed: what the
  item requires, what the code does, then compare.
- **Its enum has no "the plan was wrong" value.** An item implemented exactly as
  a mistaken spec demanded is `met`. A clean conformance table means "the plan
  was followed", never "this change is good" — which is why
  `architecture-reviewer` runs too.

## `doc-writer`

**Responsibility.** Write up what shipped, put it in the directory this repo's
own README rules select, and register it so somebody reads it.

| | |
|---|---|
| **Model** | `sonnet` |
| **Tools** | `Read, Grep, Glob, Edit, Write, Bash, Skill, TodoWrite` |
| **Denied** | `WebSearch, WebFetch, NotebookEdit` |
| **Preloaded skills** | `mermaid-diagram` |
| **Input** | a shipped feature, an executed plan, or a subsystem to explain |
| **Output** | Documentation Report + `.md` files left in the working tree |

Report sections: `Documents written` · `Anchors used` · `Diagrams` ·
`Not documented` · `Verification` · `Insight candidates`.

- **Registration is part of "done".** `docs/README.md`: "Added a file? Add a row
  to the `Read when` table of the matching AGENTS.md — otherwise nobody will read
  it." A document with no row is not finished.
- **Three never-touch rules**, each with its reason in the body: never write or
  replace a `CLAUDE.md` (symlink, mode `120000`); never hand-edit an
  `INSIGHTS.md` (`engineering-insights` owns the format, append-only); never edit
  `docs/agent-prompts/*` unless the task names it (those mirror live
  `agents.system_prompt` rows).
- **Every non-obvious claim traces to a line it read** — the `## Anchors used`
  table. Documentation that describes intent instead of behaviour is the failure
  mode, and no reader can detect it.
- It labels each document's mode (tutorial / how-to / reference / explanation)
  rather than reorganising `docs/`, which is overwhelmingly *explanation* today.

---

## What each agent preloads, and why

Five of the seven can reach **all 14** skills — `planner`, `implementer`,
`test-writer` and `doc-writer` hold the `Skill` tool and route with
`.claude/skills/pr-self-review/routing.md`. `skills:` is not about access, it is
about what sits in context **on every run, whether the task needs it or not**.

| Agent | Preloads | Why |
|---|---|---|
| `planner`, `implementer` | `backend-onion-architecture` + `frontend-ui-architecture` | unconditional: their `routing.md` rows fire on *any* file in their packages |
| `architecture-reviewer` | the same two | unconditional **for this agent** — they are its entire rulebook; there is no boundary review without them |
| `doc-writer` | `mermaid-diagram` | unconditional by charter: every run produces a document, and ~1.8k tokens is the cheapest skill in the repo |
| `test-writer` | **none** | nothing is unconditional — a client task never needs the rings (~6.8k), a server task never needs `react-testing-library` (~4.8k) |
| `plan-verifier` | **none, deliberately** | see below |
| `researcher` | n/a — no `Skill` tool | |

Six of the seven hold `Skill`; only `researcher` does not. The two read-only
reviewers were briefly designed without it, to guarantee they could not run
`pr-self-review` — that was the wrong mechanism for the right worry. The verdict
that gates `gh pr create` is written by the **model** (`SKILL.md` §3), not by
`scripts/pr-self-review.sh`, whose four subcommands are all read-only. So
`disallowedTools: Write, Edit, NotebookEdit` already blocks the forgery
structurally, and removing `Skill` bought nothing while costing the catalogue
and `engineering-insights`. Both now carry the prohibition as a contract with
its real reason, exactly as `implementer` does.

`plan-verifier` carries a second, sharper limit for the same reason it preloads
nothing: almost every skill is an opinion about how code *should* be written,
which is the authority it does not have. It may open `engineering-insights`, and
a skill the plan itself names in a step — nothing else.

`plan-verifier` is the interesting case. Preloading an architecture skill would
hand it 27k characters of opinion it is *forbidden to act on*, and root
`INSIGHTS.md` (2026-08-02) measured what an extra block in context does: it
crowded out findings the previous run had caught (3 → 2, one hallucinated, score
41 → 30). **Context is not only a token cost, it is a suggestion.** That agent
gets exactly one document: the plan.

Measured (`wc -c` ÷ 4, SKILL.md only):

| | Tokens |
|---|---|
| `backend-onion-architecture` + `frontend-ui-architecture` (preloaded) | ~11.3k |
| all 14 `SKILL.md` | ~38.8k |
| all 14 including their `references/` | ~195k |

**The criterion is unconditionality, not importance.** Every row in `routing.md`
is gated by a path glob except these two, which fire on *any* file under
`server/src/{modules,adapters,platform}/**` + `reviewer-core/src/**` and *any*
file under `client/src/**` respectively. `drizzle-orm-patterns` applies only to
repositories, `zod` only when a `z.object(` changed, `react-testing-library`
only to tests — preloading those spends ~25k tokens of a frontend task on
Postgres and Fastify.

Three more reasons for this particular pair:

1. **They are house law.** Both were written in this repo. Root `INSIGHTS.md`
   (2026-08-02) records two CRITICAL rules in the vendored
   `react-best-practices` that their own authors have since retracted —
   preloading a vendored skill wires someone else's confidence into every run.
2. **`backend-onion-architecture` is machine-enforced** by `cd server && pnpm
   arch` (10 ring rules). Breaking it fails a gate; it is not a style opinion.
3. **Their violations are structural.** A wrong ring or a wrong directory costs
   rework after implementation. A missed `zod` nuance is a one-line fix.

Coverage of the other twelve comes from discipline, not preloading:
`planner` must **open every skill it lists** in the plan and write the step's
`Skill:` line as the rule itself (`backend-onion-architecture §5 — Drizzle only
in the repository ring`), not the slug. That line is what carries the practice
across the context boundary into `implementer`.

## Why the rules are what they are

Sources behind all seven. Primary docs first, then external evidence for the two
reviewers and the two writers, then this repo's own record. Each row names the
rule, not the whole argument — follow the link when you need it.

### Anthropic primary sources

| Rule | Source | Where it lands |
|---|---|---|
| "Design focused subagents… Limit tool access: grant only necessary permissions" | [docs/en/sub-agents](https://code.claude.com/docs/en/sub-agents) | both `tools:` lines — no agent has `*` |
| "`disallowedTools` is applied first, then `tools` is resolved against the remaining pool" | docs/en/sub-agents | deny lists that repeat what `tools` already excludes — documentation of intent |
| No `Bash` command-pattern scoping in frontmatter; that lives in `settings.json` permissions or a `PreToolUse` hook | [docs/en/sub-agents](https://code.claude.com/docs/en/sub-agents), [docs/en/permissions](https://code.claude.com/docs/en/permissions) | read-only `Bash` and no-commit are body contracts, not mechanisms |
| "`skills`… controls which skills are **preloaded**… The full content of each listed skill is injected at startup" | docs/en/sub-agents §Skills | `implementer.md` `skills:` + §"What is already in your context" |
| "Each subagent starts with a fresh, isolated context window" | docs/en/sub-agents | the `specs/` file handoff; `planner`'s "the plan is for an empty context window" |
| "Each subagent completes its task and returns results to Claude, which then passes relevant context to the next subagent" | docs/en/sub-agents | the chain diagram above — the caller mediates, agents never talk directly |
| Vague delegation makes subagents duplicate work; give each "an objective, an output format, guidance on the tools and sources to use, and clear task boundaries" | [Anthropic Engineering, 2025-06-13](https://www.anthropic.com/engineering/built-multi-agent-research-system) | the fixed report templates and the mandatory `Out of scope` / `Handoff` sections |
| No structured output for subagents — the convention is a hard-specified markdown template | docs/en/sub-agents (`code-reviewer` example) | `Plan format` / `Report format` |
| Descriptions: third person, what it does **and** when to use it | [agent-skills/best-practices](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices) | every `description:` carries *what* + `Use when…` + `Do NOT use…` |
| Progressive disclosure — metadata always, instructions on trigger, resources on demand | [agent-skills/overview](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/overview) | 2 skills preloaded of 13; the rest routed on demand; only the *sections* `routing.md` names are read |
| Plan mode "research and propose changes without making them" | [docs/en/permission-modes](https://code.claude.com/docs/en/permission-modes) | `planner`'s `permissionMode: plan` |
| A reviewer should be "a second opinion… a fresh model try to refute the result, so the agent doing the work isn't the one grading it" | [docs/en/best-practices](https://code.claude.com/docs/en/best-practices) | `architecture-reviewer` and `plan-verifier` as separate agents; `implementer` not self-certifying |
| "A reviewer prompted to find gaps will usually report some, even when the work is sound… Chasing every finding leads to over-engineering" | docs/en/best-practices | `architecture-reviewer` §Discipline — a report with no findings is a valid outcome |
| The canonical `code-reviewer` example is made read-only by **omitting** `Edit`/`Write`, not by a mode — and the docs ship two versions of it with different tool lists, one *with* `Bash` | docs/en/sub-agents | both reviewers' deny lists; and the body line that "read-only" means makes no edits, not runs nothing |
| LLM-judge graders "should be closely calibrated with human experts"; give the judge an "Unknown" escape hatch | [demystifying evals](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents) | `plan-verifier`'s `unverifiable` verdict; the tier-2 measurement plan |
| `permissionMode: plan` is "reads, plus classifier-approved commands" | docs/en/permission-modes | why the two read-only agents do **not** use it — they must run gates, and a subagent cannot answer a prompt |

There is **no** official Anthropic example subagent named test-writer,
doc-writer or verifier; the four here are ours.

### External evidence — the reviewers and the test writer

| Rule | Source | Where it lands |
|---|---|---|
| Asking a code-vs-spec checker to "explain the problem and propose a fix" **increases** false rejection of correct code (GPT-4o RCRR 52.4% → 11.0% on HumanEval); extracting obligations first, then comparing required-vs-actual behaviour, recovers it | [arXiv:2508.12358](https://arxiv.org/html/2508.12358v1) | `plan-verifier`'s banned-output rule and its fixed require → does → compare order |
| Checklist decomposition raises inter-model agreement and cuts score variance versus holistic judging | CheckEval, [arXiv:2403.18771](https://arxiv.org/abs/2403.18771) (EMNLP 2025) | one table row per plan item, never one holistic verdict |
| A verifier needs a bucket for requirement content that is ambiguous or not checkable, kept apart from pass/fail | [arXiv:2605.17926](https://arxiv.org/html/2605.17926v1) | the `unverifiable` verdict |
| Sycophancy is measured and rooted in preference data, not a prompt bug; critical/skeptic framing recovers most of the effect of targeted steering | [arXiv:2310.13548](https://arxiv.org/abs/2310.13548) (ICLR 2024), [arXiv:2605.21006](https://arxiv.org/html/2605.21006v1) | "make the case for `not-met` before writing `met`" |
| LLM judges are self-inconsistent run to run (Krippendorff's α 0.265–0.563) and prompting tricks do not fix it | [arXiv:2510.27106](https://arxiv.org/html/2510.27106v1) | `plan-verifier` §Discipline — run it twice if a verdict gates something |
| Frontier models cheat on tests by "modifying test assertions, inserting special-case logic", and stronger models cheat more | ImpossibleBench, [arXiv:2510.20270](https://arxiv.org/pdf/2510.20270); RLVR reward hacking, [arXiv:2604.15149](https://arxiv.org/pdf/2604.15149) | `test-writer`'s first two hard constraints |
| Buggy code in context steers a model into tests that validate the bug; specification-based prompting mitigates it | [arXiv:2607.22883](https://arxiv.org/abs/2607.22883) (ISSTA 2026) | "derive the expectation from the contract, not the implementation" |
| Coverage is a weak quality signal — suites at 100% coverage with 4% mutation score | MutGen, [arXiv:2506.02954](https://arxiv.org/html/2506.02954) | `test-writer`'s anti-padding rule ("what regression does this catch?" is a required column) |
| `userEvent` over `fireEvent`; role-based queries first | [testing-library docs](https://testing-library.com/docs/user-event/intro/) | the permitted test-only devDependency exception |

### External evidence — `doc-writer`

| Rule | Source | Where it lands |
|---|---|---|
| Four documentation modes, separated by action-vs-cognition × acquisition-vs-application; "crossing or blurring the boundaries… is at the heart of a vast number of problems in documentation" — and do not build empty structures ahead of content | [Diátaxis](https://diataxis.fr/start-here/) | the mode label on every document; the decision **not** to reorganise `docs/` |
| ADR format — Title · Status · Context · Decision · Consequences; a decided ADR is superseded, never edited | [Nygard, 2011](https://cognitect.com/blog/2011/11/15/documenting-architecture-decisions), [MADR v4.0.0](https://adr.github.io/madr/) | the ADR section; it matches this repo's own append-only rule |
| "Change your documentation in the same CL as the code change" | [Google styleguide](https://google.github.io/styleguide/docguide/best_practices.html) | registration in the same change as the document |
| C4 levels are chosen by audience; the Code level is discouraged for long-lived docs | [c4model.com](https://c4model.com) | diagram level selection |
| Mermaid's `C4Context` is experimental — "the syntax and properties can change in future releases" | [mermaid.js.org](https://mermaid.js.org/syntax/c4.html) | prefer stable diagram types; use C4 for levels, not syntax |
| LLM-written documentation fails as incomplete / unhelpful / factually incorrect; the fix is a verification step, not a better prompt | DocAgent, [arXiv:2504.08725](https://arxiv.org/abs/2504.08725) | the mandatory `## Anchors used` table |

⚠️ The same docs argue the **other** way too: "Use the main conversation when…
Multiple phases share significant context, such as planning, implementation, and
testing." Splitting is justified here only because the plan becomes a durable
`specs/` artifact with a human approving it in between. Drop that step and this
set is worse than one session.

### This repo's own record

| Rule | Source | Where it lands |
|---|---|---|
| `AskUserQuestion` is stripped from every subagent | root `INSIGHTS.md` 2026-08-08 | the `## Clarification needed` / `## No plan to execute` hard stops |
| `ExitPlanMode` is stripped too | root `INSIGHTS.md` 2026-08-08 | `planner` §Hard constraints: "your final message **is** the plan" — without it `permissionMode: plan` stalls |
| There is no per-skill deny | root `INSIGHTS.md` 2026-08-08 | `researcher` drops `Skill` wholesale; `implementer`, `architecture-reviewer` and `plan-verifier` keep it and forbid `pr-self-review` by contract |
| The `pr-self-review` verdict is written by the **model**, not by the script — so `disallowedTools: Write` is what actually prevents forging it | `pr-self-review/SKILL.md` §3, `scripts/pr-self-review.sh` (four read-only subcommands) | both read-only reviewers keep `Skill`; the prohibition is a contract with its real reason |
| Background subagents resolve a narrower built-in tool list, silently | root `INSIGHTS.md` 2026-08-08 | every tool granted is on the background-safe list, so foreground and background behave alike |
| Read the relevant `INSIGHTS.md` at session start and name the entries | `AGENTS.md` §Session protocol | `planner` pass 1 → `Context read`; `implementer` step 0 |
| A lesson feature is mostly already scaffolded — inventory before designing | root `INSIGHTS.md` 2026-08-05 | `planner` pass 3 → the `Inventory` table with reuse/extend/new verdicts |
| `routing.md` is the canonical path→skill table; a skill no row selected is not opened | `.claude/skills/pr-self-review/SKILL.md` §3, root `INSIGHTS.md` 2026-08-08 | both agents derive their skill list from that one file — which is what stops the plan and the implementation being held to different rules |
| The deterministic gates, and why each is CRITICAL | `.claude/skills/pr-self-review/gates.md` | `implementer` §Method 4 |
| `shared:sync` is checked by script, never `diff -r` | root `INSIGHTS.md` 2026-08-02 | `implementer` §Method 3 |
| A jsonb-persisted contract field must be `.nullish()` | root `INSIGHTS.md` 2026-08-02 | `planner` constraints table; `implementer` §Method 3 |
| A DB-backed test must be named `*.it.test.ts` | `AGENTS.md` §Repo rules, `gates.md` | both |
| `pr-self-review` writes a verdict and gates `gh pr create` | `pr-self-review/SKILL.md`, root `INSIGHTS.md` 2026-08-06 | `implementer`'s first hard constraint |
| `confidence` is not calibrated; a single run proves nothing | root `INSIGHTS.md` 2026-08-02, `docs/l02-experiment.md` | §Discipline in both |
| A rule that does not state its severity comes back CRITICAL, and a CRITICAL flips the verdict | root `INSIGHTS.md` 2026-08-02 | `architecture-reviewer`'s mandatory severity column |
| An extra block in an agent's prompt *crowded out* findings the previous run caught (3 → 2, one hallucinated, 41 → 30) | root `INSIGHTS.md` 2026-08-02 | `plan-verifier` preloads nothing |
| A per-item receipt is the only cheap way to tell "nothing matched" from "the run broke" | root `INSIGHTS.md` 2026-08-03 | `plan-verifier`'s `## Counts` must sum to N |
| A grounded finding cites a line that exists; grounding never proves the claim about it | `reviewer-core/src/grounding.ts`, `pr-self-review/SKILL.md` §4 | `architecture-reviewer`'s two-citation rule; `plan-verifier`'s typed Evidence column |
| §12 catalogues known violations as debt, not precedent — and a new file copying one is a finding | `backend-onion-architecture` §12 | `architecture-reviewer`'s `## Pre-existing (debt, §12)` section |
| A skipped integration suite exits 0 and verifies nothing | `backend-onion-architecture` §9, `server/INSIGHTS.md` | "a skip is a skip" in `test-writer` and `plan-verifier` |
| `CLAUDE.md` is a symlink and the real file is `AGENTS.md` | root `INSIGHTS.md` 2026-08-02 | `doc-writer`'s first hard constraint |
| Adding a skill without a `routing.md` row means no agent is ever told to open it | root `INSIGHTS.md` 2026-08-08 | the `.claude/agents/**` and `reviewer-core/test/**` rows added with these four |

### Not sourced — judgement calls

Recorded so nobody mistakes them for policy: `opus` for `planner`,
`architecture-reviewer` and `plan-verifier`, `sonnet` for `doc-writer`, inherited
for `implementer` and `test-writer`; the exact section lists of every report
template; `plan-verifier`'s five-value verdict enum; denying `implementer` web
access to keep it narrow; **not** using
`permissionMode: plan` on them, on the reasoning that a stalled agent produces
nothing and a subagent cannot answer a permission prompt; the `color` values
beyond the three already proven here. And the preload split — two skills for some
agents, one or none for others. That last one is **unmeasured** in every
variant: whether it reliably routes the right skills needs
`docs/l02-experiment.md`, not one good run.

## Writing another agent

Read [`.claude/skills/README.md`](../skills/README.md) first to check the
capability should not simply be a skill. Then:

1. Frontmatter: `name` and `description` are the only required fields. Write the
   description in third person with both *what* and *when*, or it will never be
   selected.
2. Grant the narrowest `tools` that still lets it finish, and pick them from the
   background-safe list (root `INSIGHTS.md` 2026-08-08) so it behaves the same in
   background and foreground.
3. Anything the frontmatter cannot express — Bash command limits, a forbidden
   skill, a path it must not touch — is a **hard constraint in the body**, stated
   as a rule with its reason.
4. Specify the output as an exact markdown template. There is no structured
   output for subagents.
5. Register it in three places: this file, `.claude/skills/README.md` §Agents,
   and `AGENTS.md` §Read when.
