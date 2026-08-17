# plans — repo-wide

**What it should do.** Implementation plans: *how* this repo builds a feature,
given its rules. One file per feature, kebab-case, prefixed with the lesson when
it helps (`l07-<slug>.md`).

A plan is not a spec, and the split is the point:

| | `specs/<YYYY-MM-DD>-<feature>.md` | `plans/<slug>.md` |
|---|---|---|
| Answers | what the product should do, and why | how this repo builds it |
| Owns | the user problem, scope, contracts, acceptance | inventory, binding repo rules, ordered steps, per-step skill |
| Written by | a human, or `spec-writer` | `implementation-planner` — which is **forbidden** from authoring the spec half |
| Source of truth for | acceptance | execution |

`implementation-planner` reads the spec (or the bare request) as **input**,
checks it against the repo, and returns a plan. It never invents a requirement:
a missing one is reported as a gap, not filled. So a plan that contains a
requirement its spec does not is a bug in the plan.

**The file is the handoff.** Subagents share no context and no message channel,
so save the planner's output here and give the *path* to `implementer`,
`plan-verifier` and `test-writer` — never a paraphrase, which loses exactly the
constraints the plan exists to carry.

**The order of those three is `implementer` → `plan-verifier` → `test-writer`.**
The verifier's `not-met` and `partial` rows send work back to the implementer,
and a test written against a half-built step is a test rewritten; its
`unverifiable` rows are what the test writer is there to make observable. In a
multi-agent plan the `## Execution` table also gives every writing hop a
`Files owned` cell, because two agents editing one file clobber each other and
neither report will say so.

## Derived fix plans — `<slug>-fix-N.md`

One kind of plan is **not** written by `implementation-planner`, and it is the
only exception: a remediation plan produced from an `architecture-reviewer`
report by `/impl` (`.claude/skills/impl/SKILL.md`).

It exists for a contract reason. A review finding is not a plan item, and
`implementer`'s hard constraint is "do not expand the plan" — so it may not act
on a finding, but it may execute a plan. Transcribing the accepted findings into
`plans/<slug>-fix-N.md` is what makes the remediation loop legal instead of a
quiet exception to that rule.

It is **derived, not authored**, and the difference is what keeps the split
above intact:

- every step is exactly one finding, and every field is copied out of the review
  — `Files` from the evidence cell, `Skill` from the section the finding itself
  cited, `Done when` from the rule that fired;
- it carries **no** requirements, no inventory and no new scope.
  `## Requirements source` reads "None — this plan adds nothing", and it names
  its parent plan;
- `## Out of scope` lists every finding triage declined, so the next round cannot
  re-propose something already deferred;
- it may never contain a step that widens a glob in
  `server/.dependency-cruiser.cjs` or adds a `pathNot`. Editing the gate to
  silence a finding is the cheapest way to green and is forbidden outright
  (`backend-onion-architecture` §10).

A fix plan whose steps cannot all be traced to a finding is not derived — it is
an authored plan wearing the name, and that is `implementation-planner`'s job.

Shipped? Don't delete it — `plan-verifier` checks the implementation against
this file, and the plan stays as the record of how it was built. That holds for
fix plans too: they are the record of what the review found and what was done
about it.

**Historical note.** Plans written before this split live in `specs/`
(`l03-intent-layer.md`, `l04-smart-diff.md`, `l05-mcp-server.md`,
`l06-blast-radius.md`, `four-subagents.md`). They were not moved — `INSIGHTS.md`
entries and `AGENTS.md` §Read when rows cite those paths, and this repo does not
rewrite its record. Read them where they are; write new ones here.
