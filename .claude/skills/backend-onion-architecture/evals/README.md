# Evals for `backend-onion-architecture`

Fixtures and assertions used to measure whether this skill actually improves
architecture-boundary review, using Claude Code's `skill-creator` eval loop
(with-skill vs. a skill-blind baseline on the same prompt).

## Structure

- `evals.json` — one entry per test case: the review prompt, the fixture files
  it points at, and the `expectations` (assertions) a grader checks the
  produced findings against.
- `run-ab.sh` — the headless A/B runner (below).
- `grade.py` — its grading half, split out so `expectations` can be re-graded
  against reports already on disk.
- `fixtures/` — synthetic code, one directory per eval case, laid out to
  mirror real repo paths (`server/src/modules/<name>/...`,
  `reviewer-core/src/...`) even though these files are never built, typechecked,
  or imported by the real `server`/`reviewer-core` packages — they exist only
  to be read and reviewed.

Each fixture has three unmarked architecture violations (eval-4 has three that
carry five assertions) pulled from this skill's own anti-pattern catalogue
(`SKILL.md` §11) or rule sections (§4–§8, §13). **Do not add comments in the fixtures that name or hint at the
injected violations** — that would let a reviewer "pass" by reading the
comment instead of actually applying the skill's rules. If you add a new eval
case, keep this property.

## How this was run (2026-08-17, iteration 1)

Run manually via `skill-creator`: for each fixture, one subagent reviewed it
with the `backend-onion-architecture` skill loaded, one reviewed it with the
Skill tool disallowed (general engineering judgement only). Findings were
graded against `evals.json`'s `expectations`, one PASS/FAIL per assertion.

Result: both configurations scored 7/9 (78%) on the planted assertions — most
of the injected violations are also generic industry anti-patterns a strong
reviewer catches without repo-specific guidance. The skill's measurable edge
showed up elsewhere: it cited the exact `pnpm arch` gate and `SKILL.md`
section per finding, gave repo-idiomatic fixes (`container.<port>`,
`ContainerOverrides`) instead of generic DI advice, and in one case caught a
real, unplanted tenancy-scoping bug in a fixture (`markRead` accepting
`workspaceId` but never using it in the `WHERE` clause) that the baseline
missed and even asserted was clean. With-skill runs cost ~30–50% more tokens.

Full run artifacts (per-run findings, grading, aggregated benchmark) were not
committed — they're reproducible, one-off outputs, not source. Rerun to
regenerate them.

## How this is run now — `./run-ab.sh`

```
./run-ab.sh [BASELINE_REF] [OUT_DIR] [MODEL]     # defaults: HEAD, $TMPDIR/onion-ab, sonnet
```

It A/Bs the **working-tree `SKILL.md` against an earlier revision of itself**.
Per (variant × case) it builds a throwaway workspace holding only that variant's
`SKILL.md` and that case's fixture tree, runs `claude -p` in it, then grades
every report with a second `claude -p` that sees the report and the assertions
and nothing else. All runs are parallel; the whole set is ~16 headless calls.

Both variants get the **identical** prompt, including "load the
`backend-onion-architecture` skill". That is deliberate: this measures the
skill's CONTENT, not its triggering, so a `description:` change is invisible to
it. The skill-blind experiment (iteration 1) is a different one — drop `Skill`
from `--allowedTools`.

`grade.py` is a separate entry point on purpose. A miscalibrated assertion can be
fixed and re-graded without re-running the reviews, and because the reports are
already on disk a re-grade cannot be tuned toward a variant.

## Iteration 2 (2026-08-18) — `SKILL.md` v1.0.0 vs v1.1.0

v1.1.0 adds **§13, the slice file manifest**: the `modules/` rules in
`.dependency-cruiser.cjs` select files by *filename*, so a file named anything
other than `routes`/`service`/`repository`/`helpers`/`constants`/`types` is
matched by no rule at all and `pnpm arch` has no opinion on it. `eval-4-digests`
was added with it — a `digests` slice whose SQL sits in `data-access.ts`, whose
service reaches into `conventions/extract-pipeline.ts` (a cross-slice import
`no-cross-slice-import` misses, because that filename is not in `SLICE_PRIVATE`),
and which is never registered in `modules/index.ts`.

| Case | v1.0.0 | v1.1.0 |
|---|---|---|
| eval-1-notifications | 2/3 | 2/3 |
| eval-2-exports | 3/3 | 3/3 |
| eval-3-billing | 2/3 | 2/3 |
| eval-4-digests | **3/5** | **5/5** |
| **total** | 10/14 (71%) | 12/14 (86%) |

The whole delta is eval-4, and it is the two assertions that ask for the
*mechanism* rather than the smell. Both versions noticed `data-access.ts` was
oddly named and that the module was unregistered — v1.0.0 could reason its way
there from §12's `feature-models.ts` note. What it could not do is state which
rule goes blind: it hedged ("**if** `no-cross-slice-import`'s `to` pattern is
written as a filename allow-list … verify before merging") and filed the
filename as MEDIUM. v1.1.0 named `SLICE_PRIVATE`, said the gate is a floor made
of filenames, and filed it CRITICAL.

Cost went **down**, not up: 29,998 output tokens against 38,467 (-22%), and
$1.35 against $1.48. Stating a rule is cheaper than deriving it — the v1.0.0
eval-4 report spent 17.8k output tokens reasoning toward a hedge that the v1.1.0
run answered in 9.8k.

Two caveats worth carrying forward:

- **Assertion 4-2 was wrong when it was written** and both variants failed it.
  It asked the reviewer to cite `no-sql-in-service` for `data-access.ts`, but
  that rule does not govern a correctly-named `repository.ts` either — "the SQL
  is unpoliced" was never the real consequence. It was reworded to the real ones
  (`no-http-below-the-edge` never inspects it; it is absent from
  `SLICE_PRIVATE`) and eval-4 was re-graded against the reports already on disk.
  `evals.json` carries this as `grading_note`.
- **eval-1 assertion 3 and eval-3 assertion 2 fail in every configuration run so
  far** — iteration 1 (skill vs skill-blind) and both arms of iteration 2. They
  are not discriminating. Treat 12/14 as the ceiling this set currently measures,
  not as two open defects.

## Running in CI (not yet built)

`run-ab.sh` supplies the first two things a CI job needs — a headless driver and
a grader that emits pass/fail per assertion. What is still missing:

1. **A drift check.** `benchmark.json` is written next to the runs; nothing yet
   compares it against a committed baseline or fails a build on a regression. A
   hard 100% requirement would be wrong — see the non-discriminating assertions
   above — so the gate has to be "no worse than the recorded baseline".
2. **Cost control.** A full set is ~16 headless calls and ~$3 on sonnet. That is
   a pre-merge check on `SKILL.md`, not a per-push one.
3. **Non-determinism.** Every number here is a single sample. A regression of one
   assertion is inside the noise; run the set twice before believing a delta that
   small.

Until that exists, run `./run-ab.sh <ref-before-your-change>` by hand before
making a non-trivial change to `SKILL.md`, and paste the table into the PR.
