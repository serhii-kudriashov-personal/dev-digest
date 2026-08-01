# @devdigest/reviewer-core

The pure review engine: diff → prompt → LLM → grounded findings.

## Commands

`pnpm test` (vitest, hermetic) · `pnpm typecheck` — which is also the `build`.
The package **never emits JS**; consumers read `src/**/*.ts` directly.

## Map

| Path | What it is |
|---|---|
| `src/index.ts` | the public API — nothing leaves except through here |
| `src/review/run.ts` | `reviewPullRequest`, the engine entry point |
| `src/prompt.ts` | `assemblePrompt`, `wrapUntrusted`, `INJECTION_GUARD` |
| `src/grounding.ts` | the mandatory citation gate |
| `src/review/reduce.ts` | map-reduce merge, `scoreFromFindings` |
| `src/llm/` | `OpenRouterProvider`, structured output (Zod → JSON Schema) |
| `src/output/to-review.ts` | Review → GitHub payload, `countBlockers` |

## Conventions

- **Invariant #1: zero I/O.** No database, no GitHub, no filesystem, no direct
  network calls. The only side effect is the injected `LLMProvider`. Need data?
  Take it as a parameter; do not go fetch it.
- **Every new prompt slot is optional.** Empty or `undefined` means the section
  disappears and the prompt stays byte-identical to what it was before.
- **All untrusted content goes through `wrapUntrusted`.** Diff, PR body, repo
  map, callers, specs. No exceptions.
- **The score is always recomputed** from the findings that survived grounding
  (`scoreFromFindings`). The model's own number is never used anywhere.
- **The public API grows only via `src/index.ts`.** Consumers never import
  internal paths.
- Tests inject a stub `LLMProvider` — keys and network are never required.

## Gotchas

- `costUsd` is computed and returned in `ReviewOutcome`, but the server does not
  persist it right now. Don't "fix" it — the consumer comes back in L01.
- `strategy: 'auto'` only picks map-reduce when the diff is both large and
  multi-file; otherwise it's a single pass.
- `checkCancelled` deliberately throws the caller's own error — the engine knows
  nothing about the server's error types.
- `@devdigest/shared` resolves to `../server/src/vendor/shared` here.

## Do not touch

`grounding.ts` and `INJECTION_GUARD` are quality and safety gates. Change them
deliberately only, with a test covering every behavioural change.

## Read when

| Read | When |
|---|---|
| `README.md` | you need the pipeline diagram or the public API list |
| `../docs/agent-prompts/README.md` | working out how the prompt is assembled |
| `../server/src/modules/reviews/run-executor.ts` | you need to see what the server actually passes in |
| `docs/` | asking why the engine is designed this way |
| `specs/` | implementing a new engine capability |
| `INSIGHTS.md` | before changing prompts, grounding, or structured output |
