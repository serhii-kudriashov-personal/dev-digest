# L02 — the skills control experiment

How to show that attaching a skill changes what an agent catches, and how to avoid
fooling yourself while doing it.

The claim under test is narrow and falsifiable: **the same agent, on the same PR,
with the same model, finds an issue with a skill attached that it misses without
one.** Everything below exists to make that a measurement rather than an anecdote.

## Before you start: one run proves nothing

Root `INSIGHTS.md` (2026-08-02) measured run-to-run variance on this stack that is
larger than most prompt edits. A control agent whose prompt never changed — token
counts identical at 4139 on every run — went **1 → 4 → 3 findings** and scored
**97 → 0 → 50**.

So:

- Run **each arm at least twice**, and report both runs.
- If arm A gives 1 finding and arm B gives 2, you have measured nothing.
- The result worth reporting is a *specific finding* that appears in every
  skills-on run and no skills-off run. Counts and scores are context, not evidence.
- `findings.confidence` is not calibrated (root `INSIGHTS.md`) — the model emits
  `1.0` for a hallucination as readily as for a real defect. Do not use it to
  decide whether a finding is real. Read the cited lines yourself.

## Setup

```sh
./scripts/dev.sh                 # or --db-only if your stack is already up
cd server && pnpm db:migrate && pnpm db:seed
```

The seed creates both agents with their skills already linked:

| Agent | Linked skills (in prompt order) |
|---|---|
| Test Quality Reviewer | `test-coverage-nudge`, `pr-quality-rubric` |
| API Contract Reviewer | `api-contract-gate`, `phantom-api-gate` |

Both agents' `system_prompt` is deliberately **generic** about what to examine —
the rubric lives in the skills. That is the point: moving the rubric into the
prompt would make both arms behave the same and the experiment would stop
reproducing.

You will need a working provider key (Settings → API Keys). The seeded
provider/model is `openrouter` / `deepseek/deepseek-v4-flash`.

## The two fixture PRs

Neither exists yet — create them on your fork, following the existing `demo/*`
convention (`demo/agent-summary-endpoint`, `demo/review-share-webhook`, …).

### A. Test Quality — a happy-path-only test

A PR that adds a small function **with at least two branches and one boundary
condition**, plus a test that exercises only the successful path. Something like a
discount calculator with a cap, tested once with a normal input:

- an `if` that the test never enters (e.g. the cap being hit),
- a boundary the test never probes (0, the cap exactly, the cap + 1, negative),
- an error path that is never asserted.

The skill (`test-coverage-nudge`) tells the agent to enumerate branches before
judging the tests and to report a **WARNING** per uncovered branch and missing
boundary. Without it, the generic prompt tends to say the tests look reasonable.

### B. API Contract — a route signature change

A PR that changes a published shape in a way an existing caller depends on. The
cheapest honest version in this repo: rename or remove a field a client screen
reads, or make an optional request field required, and **do not** update
`client/src/vendor/shared/`. That leaves the canonical contract and its manual
copy disagreeing, which is a real defect class here — each package typechecks in
isolation, so CI stays green.

The skill (`api-contract-gate`) enumerates the breaking classes, including the
duplicated-contract trap and the jsonb `.nullish()` rule, and requires the finding
to **name the caller that breaks**.

## Running one arm

For the skills-off arm, do **not** delete the links — switch the skill off
globally, which is the gate the run executor filters on:

1. `g s` → Skills → toggle the agent's skills **off**.
2. Open the PR → Run Review → pick the agent. Repeat once more.
3. Toggle them back **on**, and run twice again.

Detaching in the agent's Skills tab also works, but toggling is one click, is
reversible, and is the same code path the acceptance criteria describe.

## Reading the result

For every run, open the run trace and record:

| Field | Where |
|---|---|
| skills block present? | Prompt assembly → `Skills (dynamic)` |
| skills token cost | the count on that block |
| `tokens_in` | Stats → TOKENS |
| findings + severities | the Findings section |
| verdict / score | the review header |

The skills-off arm must show **no** `Skills (dynamic)` block at all — not an empty
one. The skills-on arm shows the block, its bodies in the order you dragged, and a
non-zero token count. The difference in `tokens_in` between the arms should be
close to that count.

Suggested table:

| Agent | Arm | Run | Skills block | Skills tok | `tokens_in` | Findings | The finding in question |
|---|---|---|---|---|---|---|---|
| Test Quality | off | 1 | — | — | | | |
| Test Quality | off | 2 | — | — | | | |
| Test Quality | on | 1 | yes | | | | uncovered branch at `…:NN`? |
| Test Quality | on | 2 | yes | | | | |
| API Contract | off | 1 | — | — | | | |
| API Contract | off | 2 | — | — | | | |
| API Contract | on | 1 | yes | | | | breaking change named? |
| API Contract | on | 2 | yes | | | | |

## If it does not reproduce

Likely causes, cheapest first:

- **The skill is off, or not linked.** Check the Skills tab count and the trace.
- **The fixture is too easy.** If the generic prompt catches it in the off arm,
  the skill has nothing to add. Make the uncovered branch less obvious.
- **The fixture is too hard.** If neither arm catches it, the skill is not the
  variable being tested.
- **Variance.** Run more. See the top of this file.
- **Too many skills.** Root `INSIGHTS.md` measured a second prompt block *crowding
  out* findings the previous run caught. Attach one skill, measure, then add the
  next — this is also why the seeded skills are small and single-purpose.
- **A skill without a stated severity.** An unstated severity comes back CRITICAL,
  and because the verdict is a pure function of "any CRITICAL exists", that alone
  flips the run to `request_changes` and moves the score. Every seeded body states
  its own severity; a hand-written one must too.

## The import path

Worth doing on camera once, because it is where the trust story lives. Import one
of this repo's own skills:

```sh
cd .claude/skills && zip -r /tmp/security-skill.zip security
```

Then Skills → **Add Skill → Import from file** → `/tmp/security-skill.zip`.

What to point at:

- the extracted `SKILL.md` body, and `security/scripts/*` listed as **not read**;
- that nothing is saved until **Import skill** is pressed;
- that the created skill arrives **disabled**, badged *needs vetting*;
- and the reason: that body becomes instructions inside your agent's prompt. It is
  not delimiter-wrapped as data, because wrapping it would tell the model to ignore
  it — the injection guard does exactly that for untrusted blocks. So the control
  is you reading it before you switch it on.

Enable it, attach it to the Security Reviewer, and re-run: it now appears inside
the same `Skills (dynamic)` block as the seeded ones.
