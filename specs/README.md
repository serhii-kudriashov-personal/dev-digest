# specs — repo-wide

**What it should do.** Feature specifications: the source of truth for
implementation and acceptance. Read BEFORE writing any code for the feature.

One file per feature, named **`<YYYY-MM-DD>-<feature-slug>.md`** — the date it
was written first so the directory sorts chronologically, then a kebab-case
feature name specific enough to tell two specs about the same area apart
(`2026-08-14-blast-radius-caller-filters.md`, not `2026-08-14-blast.md`). A
course lesson puts its token inside the slug
(`2026-08-14-l07-onboarding-digest.md`). Files written before this scheme keep
their names and are not renamed. Package-scoped specs go in `server/specs/`,
`client/specs/`, `reviewer-core/specs/` or `mcp/specs/`; the narrower home wins
when two fit. **`e2e/specs/` is not a spec directory** — it holds `*.flow.json`
browser flows.

Written by a human or by [`spec-writer`](../.claude/agents/spec-writer.md),
which reviews the designs first and returns its questions before it writes.

## Skeleton

```
# Spec: <feature name>

Spec ID: SPEC-NN
Created: YYYY-MM-DD
Status: draft | approved | implemented
Supersedes: <path to the spec this replaces, or "None">

## Problem and user            who hurts, what it costs them — no solution in it
## Goals / Non-goals           outcomes in, and what is explicitly out
## User stories                US-1…US-N: as a <role>, I want <capability>, so that <outcome>
## Acceptance criteria (EARS)  AC-1…AC-N, one response each, `shall`, + verification hint
## Edge cases                  the gaps found in the design review, decided
## Design & UX review          what the designs cover, what they miss, what is proposed
## Workflows and contracts     workflow diagram · service-communication diagram · contract promises
## Non-functional requirements NFR-1…NFR-N: latency · timeout · volume · cost · model call · degradation · concurrency · retention
## Inputs and provenance       per input: source, trust, freshness, if absent
## Untrusted inputs            third-party text is data, never instructions
## Traceability                US-N → AC-N, design gap → where it landed, no orphans
## Open questions              each with the assumption to proceed on
```

Each acceptance criterion carries a one-line **verification hint**: what evidence
settles it and where it is observable. It names an observation, never a test
file, a framework or a command — the test plan belongs to `test-writer`.

`## Traceability` must hold in both directions: every `US-N` reaches at least one
`AC-N`, every design-review gap reaches a criterion, an edge case or a numbered
open question, and every `AC-N` traces back to a story, a gap or an NFR. An
acceptance criterion with no source is scope somebody invented.

`Status` is flipped **by a human**, or by `doc-writer` once the feature ships —
`spec-writer` has no `Edit` and cannot revisit a file it wrote. A spec left at
`draft` after implementation is a bookkeeping miss, not a statement about the
feature.

`Spec ID` is repo-wide: the next free `SPEC-NN` across every `specs/`
directory. It is what plans and tests cite — the filename is for humans scanning
a directory. Specs written before this scheme carry no ID and are not renumbered.

## What a spec may contain, and where it stops

A spec is behaviour, not construction — but "no implementation details" is not
"no structure". Three things are wanted when they earn their place, and a
one-behaviour feature has none of them:

| Allowed | Form | Where it stops |
|---|---|---|
| A **workflow** | Mermaid `flowchart` / `stateDiagram` of what the user or the feature goes through, terminal states included | nodes are behaviour ("user confirms"), never routes, files or functions |
| **Service communication** | Mermaid `sequenceDiagram` between named systems — client, API, engine, MCP server, GitHub, model provider | participants are systems; a message is what is asked for, not the function that answers it |
| A **contract** | which fields cross a boundary, what each means, which are optional, and what is guaranteed present for records that already exist | it is a promise in a table, not a `z.object(…)` to paste or a migration to run |

Everything else about *how* belongs to `plans/`: ordered steps, ring or module
assignment, file paths as instructions, library choice, schema diffs, test plans.
The test when unsure — **could two competent teams satisfy this spec with
different implementations?** If only one implementation could possibly satisfy
it, it is a plan wearing a spec's headings.

## Acceptance criteria are written in EARS

EARS — *Easy Approach to Requirements Syntax*, Mavin, Wilkinson, Harwood and
Novak, IEEE RE'09 (2009) — separates the condition from the system response so a
criterion can be checked instead of argued about. Every criterion is exactly one
of five patterns:

| Pattern | Shape |
|---|---|
| Ubiquitous | The system shall … |
| Event-driven | **WHEN** \<trigger\>, the system shall … |
| State-driven | **WHILE** \<state\>, the system shall … |
| Unwanted behaviour | **IF** \<condition\>, **THEN** the system shall … |
| Optional feature | **WHERE** \<feature is enabled\>, the system shall … |

`shall` always, one observable response per criterion, numbered `AC-N` and never
renumbered once shipped — plans, tests and `plan-verifier` cite those numbers.
Phrase a criterion over **fields and observable behaviour, never over serialized
bytes** (root `INSIGHTS.md` 2026-08-09), and keep implementation out of the
response clause: that half belongs to the plan.

Shipped? Don't delete it — the spec stays as the record of what was agreed, and
a changed decision is a **new** spec whose `Supersedes:` points at the old one.

**A spec is not a plan.** This directory answers *what* and *why*; `plans/`
answers *how this repo builds it* — inventory, binding repo rules, ordered
steps, the skill governing each. `implementation-planner` reads a spec as input
and is forbidden from writing one: a requirement it finds missing is reported as
a gap, never filled. The split is `plans/README.md`.

Plans written before that split are still here (`l03-intent-layer.md`,
`l04-smart-diff.md`, `l05-mcp-server.md`, `l06-blast-radius.md`,
`four-subagents.md`) and were deliberately not moved — `INSIGHTS.md` entries and
`AGENTS.md` §Read when rows cite those paths, and this repo does not rewrite its
record. Those files, and the other pre-scheme specs here, carry the older
`## Why` · `## Scope` · `## Contracts` · `## Acceptance` skeleton. Read them
where they are; write new ones to the skeleton above.
