---
name: impl
description: Executes an approved implementation plan end to end and drives it to a clean architecture review. Dispatches `implementer`, then `plan-verifier` as a gap pass, then `architecture-reviewer` with a bounded remediation loop that turns accepted findings into a derived fix plan and runs them. Use when `plans/<slug>.md` exists and has been approved, and the change now needs to be built and reviewed without a human relaying every hop. Do NOT use it to write a specification or a plan — `spec-writer` and `implementation-planner` are run separately, by hand, before this — and do NOT expect it to commit, open a pull request, write documentation, or produce a `pr-self-review` verdict.
user-invocable: true
---

# /impl — run an approved plan to a clean review

You are the caller. Subagents share no context and cannot dispatch each other, so
every hop below is yours to launch, and every artifact between hops is a **file
path**, never a paraphrase.

```
plans/<slug>.md ─→ implementer ─→ plan-verifier ─→ architecture-reviewer
                        ↑              (gap pass)          │
                        │                  │               ↓
                        └── not-met ───────┘        triage → plans/<slug>-fix-N.md
                        └───────────────────────────────────┘   (≤ 2 rounds)
```

## What this command is not

It starts at an **approved plan** and stops at a **clean review**. Four things
sit outside it deliberately, and none of them is an oversight to fix mid-run:

| Not here | Why | Where it is |
|---|---|---|
| Authoring the spec | it needs a design review and a human answering an intake block | run `spec-writer` by hand, first |
| Authoring the plan | same — the intake block is the ask, and the human picks the execution mode | run `implementation-planner` by hand, first |
| `test-writer` | switched off for now to save tokens; see §Tests below, which says what that costs | `--tests` re-enables it |
| `doc-writer`, `pr-self-review`, commit, push, PR | each is a deliberate separate step | run them yourself afterwards |

Security and correctness review are **not in this loop either**, and there is no
agent for them in this repo. `architecture-reviewer`'s scope fence is *where
code lives and who may import it* — it does not look for bugs, injection,
authorisation, or Fastify/Drizzle/Zod/React mechanics. Say so in the final
report every time. A clean run of this command means "the plan was built and the
boundaries hold", never "this change is good".

## Invocation

```
/impl plans/<slug>.md [--rounds N] [--steps 3-5] [--tests] [--resume]
```

| Flag | Default | Effect |
|---|---|---|
| `--rounds N` | `2` | remediation rounds after the architecture review. Hard ceiling 3 |
| `--steps A-B` | all | execute only these plan steps; everything else is reported as not done |
| `--tests` | off | put the `test-writer` hop back between phases 2 and 3 |
| `--resume` | off | read the run file and continue from the last completed phase |

With no argument, look for exactly one `plans/*.md` newer than its matching
implementation. If there is not exactly one, **stop and ask** — do not guess
which plan to execute.

## Step 0 — preconditions, then the run file

Three hard stops. Each returns only its own message; none of them is a thing to
work around.

1. **No plan.** `plans/<slug>.md` does not exist, or the path names a `specs/`
   file. A spec is not a plan (`plans/README.md`): it carries requirements and no
   ordered steps, and `implementer` cannot execute it. Say which agent to run.
2. **The plan has open blockers.** Read `## Risks & open questions`. An entry
   that says `needs researcher: …`, or an unconfirmed **assumed** requirement
   under `## Requirements source`, is a decision this command is not entitled to
   take. List them and stop.
3. **The tree is not clean enough to attribute.** Run
   `./scripts/pr-self-review.sh gates`. A gate that is **already red** before you
   start becomes indistinguishable from damage you caused. Report the failing
   gate verbatim and ask whether to proceed anyway; if told to proceed, record
   the pre-existing failure in the run file so the final report can subtract it.

Then create `.devdigest/impl/<slug>.md`. This file is the run's memory: it is
outside git's tracked tree and outside `pr-self-review`'s `tree_hash` (excluded
by pathspec at `scripts/pr-self-review.sh:29`), so writing it cannot invalidate a
verdict. Append to it after **every** hop — the run is long, the context will be
summarised before it ends, and `--resume` has nothing else to read.

```markdown
# impl run — <slug>
Plan: `plans/<slug>.md` · started: <YYYY-MM-DD> · rounds allowed: N
Pre-existing red gates at start: <names, or "none">

## Phase log
| # | Phase | Agent | Outcome | Artifact |
|---|---|---|---|---|
| 1 | implement | implementer | 7 files, gates green | — |
| 2 | gap pass | plan-verifier | 12 items · 11 met · 1 not-met | — |

## Findings ledger
| Round | Finding | Severity | Verdict | Round it was first seen |
```

## Phase 1 — implement

Read the plan's `## Execution` section. It is authoritative for how many
`implementer` runs there are and what each one owns.

- **Single-agent**: one `implementer` run, given the plan path and "steps 1…N".
- **Multi-agent**: one run per row, in the table's order. Pass each its row —
  the steps assigned to it **and its `Files owned` cell**. Launch two rows
  concurrently only when the plan says their scopes are disjoint; two writing
  agents on one file clobber each other and neither report will say so. If the
  plan predates the `Files owned` column, run the rows sequentially and note it.
- **A `test-writer` row**: skip it unless `--tests`. Record the skipped steps.

Each run returns an Implementation Report. Three sections decide what happens
next, and none of them is decoration:

- `## Not done / blocked` — carry it forward verbatim. It is the input to the
  final report, and a blocked step must never silently become a `not-met` row
  that looks like the implementer's failure.
- `## Deviations from the plan` — a self-routed skill here means the plan's file
  list was incomplete. Worth an insight candidate.
- `## Verification` — a `skipped` row is not a pass. If the integration lane
  self-skipped for want of Docker, every item depending on it will come back
  `unverifiable` in phase 2, and that is correct rather than a problem to fix.

## Phase 2 — the gap pass

Dispatch `plan-verifier` with the plan **path** and "the current working tree".

It runs here, before any review, for a mechanical reason: its `not-met` and
`partial` rows are unfinished work, and finding them now costs one cheap
structural pass, while finding them after a review means re-reviewing whatever
the fix touches.

Then branch on `## Counts`:

| Result | Do |
|---|---|
| any `not-met` or `partial` | back to phase 1 with **only those items**, as a step list quoting the verifier's rows. At most **one** return trip: a second failure on the same item is a plan problem, not an execution problem — stop and report it |
| `unverifiable` rows | not a failure. With `--tests` they are `test-writer`'s worklist; without it they are the honest answer to "what does nothing currently make observable", and they go into the final report under that heading |
| `## Spec criteria not in the plan` non-empty | **never** fix this silently. A criterion the spec states and the plan never carried is a gap between two documents that only a human can close — by amending the plan, or by deciding it was out of scope. Report and continue |
| all `met` | proceed |

Do not re-run `plan-verifier` at the end. Its own §Discipline asks for a second
run only when a verdict **gates** something; this command gates nothing.

## Phase 3 — architecture review, and the remediation loop

This is the part the command exists for.

### 3a. Review

Dispatch `architecture-reviewer` with the changed-file list
(`./scripts/pr-self-review.sh files`, or `git status --porcelain`). Round 2 and
later review **only the files the previous fix plan touched** — a full re-review
each round spends a whole agent to re-derive findings you already triaged, and it
hides the one thing worth watching, which is whether the fix introduced something
new.

### 3b. Triage — a closed rule set, not a judgement

You are sorting a report, not forming an opinion. Walk its sections:

| Section / property | Action | Why |
|---|---|---|
| `## Pre-existing (debt, §12)` | **never fix** | catalogued debt. Touching it is a separate decision and a separate plan |
| `## Unverified suspicions` | **never fix** | no `path:line`, so there is no finding — only a search that failed |
| CRITICAL or HIGH, with both citations (evidence line **and** rule section) | → fix plan | |
| MEDIUM | ask the user once, as a list; **default: defer** | a reviewer asked to find gaps reports some even when the work is sound, and chasing every one produces defensive code and tests for cases that cannot happen |
| CRITICAL from a **vendored** skill that does not also break an authored skill, an `AGENTS.md` rule, or a deterministic gate | demote to HIGH before deciding | `routing.md` §"Vendored severity is not house law" |
| anything on the `AGENTS.md` §Do not touch list | **never fix** — report it | those are deliberate decisions, never drive-by edits |
| a finding already in the ledger from an earlier round | see §3e | |

A finding missing either citation is not admissible even at CRITICAL. The
reviewer's own §4 says so; do not upgrade it on its behalf.

**One step is forbidden in a fix plan under every circumstance:** widening a glob
in `server/.dependency-cruiser.cjs`, adding a `pathNot`, or otherwise editing the
gate to make a finding stop firing. `backend-onion-architecture` §10 and the
reviewer's §2 both say the debt list may only shrink. It is also the cheapest way
to make `pnpm arch` green, which is exactly why it has to be named here.

### 3c. Write the fix plan

Write the accepted findings to `plans/<slug>-fix-N.md`. **This file is what makes
the loop legal.** `implementer`'s hard constraint is "do not expand the plan" — it
may not act on a review finding, but it may execute a plan. So the findings are
transcribed into one.

This is a **derived** plan and it is the one plan `implementation-planner` does
not author (`plans/README.md`). It carries no requirements, no inventory and no
new scope: every step is one finding, and every field is copied out of the
review, not invented.

```markdown
# <Feature> — fix plan, round N

## Task
Remediate N findings from `architecture-reviewer`, round N. Derived from the
review report, not from new requirements.

## Requirements source
None — this plan adds nothing. Its parent is `plans/<slug>.md`.

## Steps
### Step 1 — <the finding, as an imperative>
- **Files:** `path/file.ts:42` — from the finding's evidence cell
- **Change:** what must become true of that line
- **Skill:** `<slug>` §<section> — **the section the finding itself cited**
- **Verify:** `cd server && pnpm arch` — or the targeted test
- **Done when:** the rule no longer fires on that line
- **Finding:** CRITICAL · round N · <the verbatim source line>

## Verification plan
| Package | Command | Runs when |

## Out of scope
Every finding declined in triage, one line each with the reason.
```

`## Out of scope` is not padding: it is what stops the next round re-proposing a
MEDIUM the user already deferred.

### 3d. Fix, then re-review

Dispatch `implementer` with the fix plan's path. Everything that binds it
normally still binds: the gates, the do-not-touch list, the two-attempt stop
rule, `Files owned`. Then return to §3a with the scope narrowed to the files that
plan touched.

### 3e. Bounds, and how the loop ends

Three conditions, and the loop stops at whichever comes first:

1. **The review is clean** — `## Findings` empty. That is a valid and expected
   outcome, not a suspicious one.
2. **`--rounds` is spent** (default 2, ceiling 3).
3. **A finding survives its own fix.** If a finding appears in the ledger from an
   earlier round and is still there after a fix step aimed at it, stop
   remediating it. Two agents disagreeing about one line is a question for a
   human, not a third attempt — and the third attempt is where an agent starts
   reaching for the gate config.

Also stop, immediately, if a round produces a finding **caused by the previous
fix** in a file the parent plan never named. That is scope escaping through the
loop, and it needs the plan reopened rather than another round.

Append every finding to the ledger with the round it was first seen. The ledger
is the only thing that can tell "fixed" from "kept re-appearing".

## Tests

With `test-writer` off, this command produces no new tests, and the honest
consequence has to be stated rather than left implied:

- Existing suites still run — `implementer` runs the package's unit lane, and the
  `*.it.test.ts` lane when the change reaches the database.
- New behaviour ships **uncovered**. Every `unverifiable` row from phase 2 names
  a criterion nothing observes, and that list goes in the final report as the
  standing debt of this run.
- `--tests` inserts `test-writer` between phases 2 and 3, given the plan path,
  the `AC-N` to cover and phase 2's `unverifiable` rows.

## The final report

Emit exactly this. Sections stay even when empty — write "None".

```markdown
## Run
`plans/<slug>.md` · <N> implementer runs · <N> remediation rounds · run file
`.devdigest/impl/<slug>.md`.

## Plan conformance
`plan-verifier` counts, verbatim: N items · X met · Y partial · Z not-met ·
W deviated · V unverifiable. Say which pass produced them.

## Changes
The union of every `## Changes` table, deduplicated by file.

## Remediation
| Round | Finding | Severity | Outcome | Evidence |
Outcome: fixed / deferred (declined in triage) / survived (stop condition) /
not-admissible (missing a citation) / pre-existing.
Every finding the review produced appears here, including the ones not acted on.

## Gates
`./scripts/pr-self-review.sh gates` — final run, one line per gate. Test lanes
and their verbatim counts. A skip is reported as a skip.

## Not covered
- what `test-writer` would have covered, from phase 2's `unverifiable` rows
- **security and correctness were not reviewed** — no agent in this repo does
  either, and `architecture-reviewer` explicitly does not
- anything in `## Spec criteria not in the plan`
- every step left undone, with the reason from the implementer's report

## Next steps
The hops this command deliberately did not run: `doc-writer`, `pr-self-review`,
commit, PR. Name them.

## Insight candidates
Merged from every agent's report, deduplicated, one line each with a `path:line`.
Write them yourself — you are the main session, and `AGENTS.md` §Session protocol
puts that write here rather than in the agents.
```

## Discipline

- **The file is the handoff.** Give paths, never summaries. A plan relayed by
  paraphrase loses exactly the constraints it exists to carry.
- **Never let a hop's failure vanish.** A subagent that dies on an account limit
  returns *nothing*, not a partial result. Record the dead hop in the run file
  and either relaunch it once or report it — never continue as though it ran.
- **Do not widen scope to make a phase succeed.** Every phase has a report shape
  for saying it could not finish. Use it.
- **One run proves nothing.** If a change to this command's shape is supposed to
  improve outcomes, `docs/l02-experiment.md` is how that is measured — not one
  good run.
