# frontend-ui-architecture

Frontend UI architecture and code organization for React and Next.js App
Router. Answers one question in all its forms: **where does this code go, and
what may it import?**

| | |
|---|---|
| Version | 1.0.0 |
| Status | authored in this repo — **not** in `skills-lock.json`, safe to edit |
| Researched | 2026-08-02 |

## Files

| File | What it is |
|---|---|
| `SKILL.md` | The skill. Ten rule sections, severity-tagged, plus a DevDigest mapping. |
| `README.md` | This file — every source used, and how the skill was built. |
| `RESEARCH.md` | Annotated research: what each source establishes, where sources contradict each other, and the decisions taken. |

There is deliberately no `examples.md`: the subject is file placement, so the
worked examples are folder trees and decision tables, and those read better
inline than one hop away.

## Scope

**In:** file and folder placement, module boundaries, import direction, the
promotion rule, component splitting, business-logic placement, constants,
barrel files, naming, the Next.js data-handling models and the `'use client'`
boundary.

**Out, on purpose:** rendering behaviour, hooks misuse, state management,
testing, performance. Those belong to `react-best-practices`,
`react-testing-library` and `next-best-practices`. The one place the boundary
blurs is barrel files, where the evidence is performance data but the rule
taken from it is about module public API.

## Sources

All links below were read in full unless marked *(search only)* — meaning the
claim was seen in search results but the primary text was not opened, and
should be verified before being quoted as authority.

### Project structure — feature-first

- [bulletproof-react — project-structure.md](https://github.com/alan2207/bulletproof-react/blob/master/docs/project-structure.md) — the de-facto reference layout; no cross-feature imports; unidirectional `shared → features → app`; avoid barrel files; enforce with `import/no-restricted-paths`.
- [React Handbook — Project Standards](https://reacthandbook.dev/project-standards) — endorses the above; "don't spend more than 5 minutes trying to plan a folder structure"; absolute imports.
- [Robin Wieruch — React Folder Structure Best Practices](https://www.robinwieruch.de/react-folder-structure/) — the flat→feature→domain progression; the promotion rule (local until a second consumer); the removability test.
- [Redux Style Guide](https://redux.js.org/style-guide/) — "Structure Files as Feature Folders with Single-File Logic"; put logic in reducers; move complex logic out of components; explicit rejection of folder-by-type.

### Project structure — layered

- [Feature-Sliced Design — overview](https://feature-sliced.design/docs/get-started/overview) — layers, slices, segments; a layer imports only from layers strictly below; slices never import siblings. The `ui / api / model / lib / config` segment vocabulary is where §5 and §6 of the skill get their shape.
- [Sandro Roth — How to structure your React projects](https://sandroroth.com/blog/project-structure/) — the strongest argument against `components/` + `hooks/` type folders: tightly coupled code gets split across them.

### Project structure — the dissent

- [Josh W. Comeau — Delightful React File/Directory Structure](https://www.joshwcomeau.com/react/file-structure/) — argues *against* feature folders (product boundaries shift, the tree ends up organized around a product that no longer exists) and *for* the per-component `index.ts`. Kept in the research because both positions are load-bearing counterweights.

### Splitting, abstraction, colocation

- [Kent C. Dodds — When to break up a component into multiple components](https://kentcdodds.com/blog/when-to-break-up-a-component-into-multiple-components) — the seven real triggers; "NOT BEFORE"; long JSX is not a defect. Source for §4.
- [Kent C. Dodds — AHA Programming](https://kentcdodds.com/blog/aha-programming) — Avoid Hasty Abstractions; "prefer duplication over the wrong abstraction" (Sandi Metz); Write Everything Twice. Source for §2.
- [Kent C. Dodds — Colocation](https://kentcdodds.com/blog/colocation) — "place code as close to where it's relevant as possible", and the documented exception for tests that span components.

### React official

- [React — Reusing Logic with Custom Hooks](https://react.dev/learn/reusing-logic-with-custom-hooks) — the `use` prefix rule; "keep custom Hooks focused on concrete high-level use cases"; no `useMount`/`useEffectOnce`; extract to make callers declarative.
- [React — You Might Not Need an Effect](https://react.dev/learn/you-might-not-need-an-effect) — the nine cases where logic is in the wrong place. The backbone of §5.
- [React — `'use client'`](https://react.dev/reference/rsc/use-client) — the directive as a module-graph boundary; serializable props.

### Next.js architecture

- [Next.js — Server and Client Components](https://nextjs.org/docs/app/getting-started/server-and-client-components) — the most important Next.js source here: boundary placement at the leaf, `children` slots for interleaving, provider depth, third-party wrapping, `server-only` / `client-only`.
- [Next.js — How to Think About Security](https://nextjs.org/blog/security-nextjs-server-components-actions) (Sebastian Markbåge) — the three data-handling models and the instruction not to mix them; the Data Access Layer and DTOs; hostile Server Action arguments; the audit checklist.
- [Next.js — Project structure and organization](https://nextjs.org/docs/app/getting-started/project-structure) — colocation safety, `_folder`, `(group)`, and the framework's explicit neutrality on the rest.

### Barrel files

- [TkDodo — Please Stop Using Barrel Files](https://tkdodo.eu/blog/please-stop-using-barrel-files) — cycles and synchronous loading; 11k → 3.5k modules (68%); barrels belong to library entry points, not app directories.
- [Marvin Hagemeister — The barrel file debacle](https://marvinh.dev/blog/speeding-up-javascript-ecosystem-part-7/) — module-graph construction: 0.15s at 500 modules, 48.44s at 50k; removal makes many tasks 60–80% faster.

### Boundary enforcement

- [eslint-plugin-boundaries](https://github.com/javierbrea/eslint-plugin-boundaries) — layer/element/origin rules with editor feedback.
- [dependency-cruiser](https://github.com/sverweij/dependency-cruiser) and [why to run it alongside ESLint](https://xebia.com/blog/taking-frontend-architecture-serious-with-dependency-cruiser/).
- [steiger](https://github.com/feature-sliced/steiger) — the official Feature-Sliced Design linter (beta).

### Component vocabulary and retired patterns

- [Brad Frost — Atomic Design, ch. 2](https://atomicdesign.bradfrost.com/chapter-2/) — atoms → molecules → organisms → templates → pages, with the author's own caveat that it is a mental model, not a process.
- [patterns.dev — Container/Presentational](https://www.patterns.dev/react/presentational-container-pattern/) — "Hooks make it possible to achieve the same result without having to use the Container/Presentational pattern."
- Dan Abramov's 2019 retraction of Presentational and Container Components ("I don't suggest splitting your components like this anymore") *(search only — seen via patterns.dev and search summaries; verify the primary text before quoting)*.

### Consulted, not usable as authority

- [Tao of React — Alex Kondov](https://alexkondov.com/tao-of-react/) — returns HTTP 403 to automated fetching (tried twice). Widely cited on component structure; read manually before taking anything from it.
- [When magic numbers are not magic](https://medium.com/codex/when-magic-numbers-are-not-magic-fcdf034295a5) *(search only)* — the argument that a shared constants file is glue between modules meant to be independent. Informs §6's framing; not cited as authority.

### Internal to this repo

- `.claude/skills/next-best-practices/{rsc-boundaries,data-patterns,file-conventions}.md` — owns the mechanics one level down; this skill links rather than restates.
- `.claude/skills/react-best-practices/SKILL.md` — behaviour rules. **Two of its CRITICAL rules are superseded here**: container/presentational (§4) and the 200-line component cap (§4). See `INSIGHTS.md` (root, Tool & Library Notes, 2026-08-02) — it is a locked vendored skill, so it cannot be corrected in place.
- `client/AGENTS.md` and `client/INSIGHTS.md` — the house rules this skill codifies, including the kebab/Pascal naming rule in §8.

## Where the sources disagree

Recorded because a skill that hides its disagreements is just one opinion in a
confident voice. Full treatment in `RESEARCH.md`.

1. **Feature folders vs type folders** — bulletproof-react, FSD, Wieruch and Redux say group by feature; Comeau argues product boundaries shift and the tree rots. The skill takes feature-first and states the promotion rule that keeps it honest.
2. **Barrel files** — TkDodo and Hagemeister measured real costs; Comeau recommends per-component barrels. Their measurements are about *chained* barrels, which is not his case. §7 splits the difference along that line.
3. **Component splitting** — the vendored `react-best-practices` sets a 200-line cap; Dodds rejects length-based splitting outright. §4 follows Dodds.
4. **Constants** — FSD puts them per-slice in `config`; Comeau puts them in one top-level file. Wieruch's promotion rule reconciles the two, and §6 adopts it. This is the weakest-sourced area in the skill.
