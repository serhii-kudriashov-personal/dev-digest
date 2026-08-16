# Project Context — fix plan, round 1

## Task
Remediate 1 finding from `architecture-reviewer`, round 1. Derived from the
review report, not from new requirements.

## Requirements source
None — this plan adds nothing. Its parent is `plans/2026-08-16-project-context.md`.

## Steps

### Step 1 — Promote the byte-identical `ContextTab` helper module to shared `lib/`
- **Files:**
  - `client/src/app/agents/[id]/_components/AgentEditor/_components/ContextTab/helpers.ts` — delete
  - `client/src/app/skills/[id]/_components/ContextTab/helpers.ts` — delete
  - `client/src/lib/context-docs.ts` — new, holding the four functions verbatim
  - `client/src/app/agents/[id]/_components/AgentEditor/_components/ContextTab/ContextTab.tsx:30` — re-point the import
  - `client/src/app/skills/[id]/_components/ContextTab/ContextTab.tsx:29` — re-point the import
- **Change:** The two `helpers.ts` files are byte-identical (md5 `2aee2e5f4665b9579b3a458dc6d1f789` on both) and export four pure transforms over `ContextAttachment` / `ContextDocument` — `orderedPaths`, `reorder`, `filterByPath`, `missingPaths` — with no agent-specific or skill-specific logic in any of them. Move the module verbatim to `client/src/lib/context-docs.ts` (kebab-case, matching the existing `github-urls.ts`, `model-label.ts`, `feature-models.ts`), delete both copies, and change both importers from `from "./helpers"` to `from "@/lib/context-docs"`.

  Keep the function bodies, signatures and docblocks exactly as they are — this is a move, not a rewrite. Do not add, rename or re-order exports.

  **Do not touch either `ContextTab.tsx` beyond its one import line, and do not merge, extract or otherwise de-duplicate the two components themselves.** Their duplication is deliberate under `frontend-ui-architecture` §2 and is named in the parent plan's `## Risks & open questions`; the reviewer confirmed by `diff` that they genuinely diverge in props, prose and mutation hooks. Only the helper module is being promoted. Both `ContextTab/index.ts` barrels and both `styles.ts` files stay exactly where they are.
- **Skill:** `frontend-ui-architecture` §1 placement table (`SKILL.md:38` — "Pure helper used by **2+** → shared `lib/<name>.ts`") and §2 the promotion rule (`SKILL.md:58` — "Second consumer appears → move up to the nearest shared ancestor, in the same commit that adds the second use").
- **Verify:** `cd client && pnpm typecheck && pnpm lint && pnpm test`, then `./scripts/pr-self-review.sh gates`.
- **Done when:** `rg -n "ContextTab/helpers" client/src` returns nothing; no `helpers.ts` remains in either `ContextTab/` directory; `client/src/lib/context-docs.ts` exports exactly `orderedPaths`, `reorder`, `filterByPath`, `missingPaths`; client typecheck, lint and the 174-test suite are green.
- **Finding:** HIGH · round 1 · `frontend-ui-architecture` §2 (promotion rule) / §1 placement table — `export function orderedPaths(attachments: ContextAttachment[] | undefined): string[] {`, identical in both files.

## Verification plan
| Package | Command | Runs when |
|---|---|---|
| client | `cd client && pnpm typecheck` | always |
| client | `cd client && pnpm lint` | always |
| client | `cd client && pnpm test` | always — report the count, not the exit code |
| — | `./scripts/pr-self-review.sh gates` | always |

`server/` has no row: no server file is changed by this plan. `cd server && pnpm arch`
already exits 0 and cruises only `server/` and `reviewer-core/`, so it cannot
observe this change either way.

## Out of scope
- **De-duplicating the two `ContextTab.tsx` components.** Deliberate under `frontend-ui-architecture` §2; the components diverge in props, prose and mutation hooks, and the third consumer is the trigger to extract. The reviewer explicitly did not raise this.
- **Every "Not mine" item in the round-1 report** — jsonb column typing and the new migration (`postgresql-table-design`), the Zod schema mechanics of `ContextListing` / `RootPattern` / `project_context` (`zod`), Fastify route style (`fastify-best-practices`), the adequacy of `isSafeContextPath` (`security`), and the correctness/efficiency of `walkMarkdown` and the read-budget logic. None is a boundary finding and none was raised as one.
- **The NFR-2 per-read deadline gap** surfaced by `plan-verifier` (the budget is checked between files, not during a single hanging read). Real, but it is correctness/robustness, not placement, and no agent in this loop owns it. Reported, not fixed.
