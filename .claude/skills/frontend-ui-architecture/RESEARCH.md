# Research — React / frontend code organization

Source material for the `frontend-ui-architecture` skill: **where code lives**,
which module may import which, and where the boundaries fall — React and
Next.js App Router.

**Out of scope, deliberately:** performance (memoization, bundle size,
streaming, caching) and behaviour-level React rules (hooks misuse, keys, a11y).
Those belong to the vendored `react-best-practices` and `next-best-practices`
skills. Where a source's evidence happens to be performance data — §5 on barrel
files is the case — the *rule* we take from it is still an architectural one
about module boundaries and public API.

Every source below was fetched and read unless marked `NOT FETCHED`.
Date of research: 2026-08-02.

---

## 1. Where do components live? (top-level structure)

There is no single answer in the industry — there are **three competing schools**,
and the skill has to name the tradeoff rather than pretend consensus exists.

### A. Feature-first (the mainstream position)

| Source | What it establishes |
|---|---|
| [bulletproof-react — `docs/project-structure.md`](https://github.com/alan2207/bulletproof-react/blob/master/docs/project-structure.md) | The de-facto reference structure. `src/{app,assets,components,config,features,hooks,lib,stores,testing,types,utils}`; each `features/<name>/` may hold `api/ assets/ components/ hooks/ stores/ types/ utils/`. Three hard rules: **"You don't need all of these folders for every feature"**, **no cross-feature imports** ("compose different features at the application level"), and **unidirectional flow `shared → features → app`**, enforced with `import/no-restricted-paths`. Also: **avoid barrel files** (breaks Vite tree-shaking). |
| [React Handbook — Project Standards](https://reacthandbook.dev/project-standards) | Endorses the bulletproof layout verbatim, and adds the pragmatic guard: **"don't spend more than 5 minutes trying to plan a folder structure"** — start flat in `src/`, refactor at ~10+ files with distinct concerns. Also gives an 8-step in-file component order and pushes absolute imports (`@/features/x`). |
| [Robin Wieruch — React Folder Structure Best Practices](https://www.robinwieruch.de/react-folder-structure/) | The best *progression* narrative: single file → multiple files → component folders → technical folders → feature folders → domain folders → packages → monorepo. Key promotion rule: project-specific helpers stay in the component folder, move to a top-level shared folder **once 2+ features need them**. States the removability test: "Features don't import from each other" — deleting one feature must not break another. |
| [Redux Style Guide](https://redux.js.org/style-guide/) | Priority B (Strongly Recommended): **"Structure Files as Feature Folders with Single-File Logic"** and an explicit rejection of the older folder-by-type layout ("separate folders for actions and reducers"). Useful because it is a *versioned, priority-tagged* rule set — a good format model for our skill. |

### B. Layered / methodological (Feature-Sliced Design)

| Source | What it establishes |
|---|---|
| [Feature-Sliced Design — overview](https://feature-sliced.design/docs/get-started/overview) | The most formal answer. Layers, top-down: `app → processes (deprecated) → pages → widgets → features → entities → shared`. Two hard rules: **"Modules on one layer can only know about and import from modules from the layers strictly below"** and **"Slices cannot use other slices on the same layer."** |
| same | The **segment** vocabulary is the single most useful import for our skill, because it answers the user's constants/utils/logic questions directly: `ui` (components, styles), `api` (requests, mappers), `model` (schemas, stores, **business logic**), `lib` (slice-internal helpers), `config` (**constants and feature flags**). |
| [Sandro Roth — How to structure your React projects](https://sandroroth.com/blog/project-structure/) | Argues FSD over type-grouping with the strongest single argument against `components/` + `hooks/` folders: *"Sometimes you have components and hooks that are tightly coupled together. You then either have to split them across two folders or violate the guidelines."* |
| [feature-sliced/steiger](https://github.com/feature-sliced/steiger) | The official FSD linter (beta). Rules: forbid higher-layer imports and same-layer cross-imports, forbid bypassing a slice's public API, flag slices with one or zero references. Evidence that layer rules are machine-checkable, not just prose. |

### C. Type-first (the dissent — do not omit)

| Source | What it establishes |
|---|---|
| [Josh W. Comeau — Delightful React File/Directory Structure](https://www.joshwcomeau.com/react/file-structure/) | Explicitly **against** feature grouping: feature boundaries shift with the product, so the tree ends up "conceptually organized around a product that no longer exists." Recommends `components/<Name>/{Name.tsx, index.ts, Name.helpers.ts, Name.types.ts}`, plus `hooks/`, `helpers/`, `utils.ts`, `constants.ts`. Note this is also the only source that **defends** the per-component `index.ts` barrel — a direct conflict with §5. |

---

## 2. How should components be split?

| Source | What it establishes |
|---|---|
| [Kent C. Dodds — When to break up a component into multiple components](https://kentcdodds.com/blog/when-to-break-up-a-component-into-multiple-components) | The counterweight to every "max 200 lines" rule: **"I don't mind if the JSX I return in my component function gets really long."** Split when you hit a *real* problem — re-render performance, actual reuse, state that's hard to follow, testing pain, merge conflicts, third-party integration, imperative sprawl — **"NOT BEFORE."** Quotes Sandi Metz: "Duplication is far cheaper than the wrong abstraction." |
| [Kent C. Dodds — AHA Programming](https://kentcdodds.com/blog/aha-programming) | Avoid Hasty Abstractions. "Write Everything Twice" — tolerate two copies; the third occurrence reveals the real shape. This is the rule that keeps `utils/` from becoming a dumping ground. |
| [Kent C. Dodds — Colocation](https://kentcdodds.com/blog/colocation) | **"Place code as close to where it's relevant as possible."** Tests beside source, styles beside components. Documented exceptions: integration/e2e tests (they span components, so they live at the root) and system-wide docs. |
| [React docs — Reusing Logic with Custom Hooks](https://react.dev/learn/reusing-logic-with-custom-hooks) | Official splitting rules for *logic*: `use` prefix only for functions that call hooks (`getSorted`, not `useSorted`); **"Keep custom Hooks focused on concrete high-level use cases"** — `useChatRoom`, not `useMount`/`useEffectOnce`; extraction should make the caller *declarative*. And: "You don't need to extract a custom Hook for every little duplicated bit of code. Some duplication is fine." |
| [patterns.dev — Container/Presentational](https://www.patterns.dev/react/presentational-container-pattern/) | **"Hooks make it possible to achieve the same result without having to use the Container/Presentational pattern."** |
| [Brad Frost — Atomic Design, ch. 2](https://atomicdesign.bradfrost.com/chapter-2/) | atoms → molecules → organisms → templates → pages. Worth citing as the *vocabulary* for UI-primitive hierarchy, with the author's own caveat that it is a mental model, not a linear process, and that the chemistry metaphor shouldn't be pushed onto stakeholders. |

**Contradiction to resolve in the skill.** The vendored `react-best-practices`
skill states as CRITICAL: *"Container components fetch data; presentational
components receive props and render UI"* and *"Max 200 lines per component."*
Dan Abramov retracted the container/presentational split in a 2019 update to his
own 2015 article ("I don't suggest splitting your components like this
anymore"), and Dodds rejects length-based splitting outright. Our skill should
supersede both rules with: **split on a named problem, not on a line count; use
a custom hook instead of a container wrapper.**
(Abramov's retraction is `NOT FETCHED` — it lives in a Medium/Gist update and
was only seen via search summaries and patterns.dev. Verify the primary text
before quoting it in the skill.)

---

## 3. Where do constants live?

Weakest area in the literature — no authoritative source, so the skill will have
to *make* the rule from the adjacent principles rather than cite one.

- **FSD** gives the only named home: the `config` segment inside a slice holds
  "configuration files and feature flags" — i.e. constants are **per-slice by
  default**, not global. ([FSD overview](https://feature-sliced.design/docs/get-started/overview))
- **Comeau** takes the opposite line: a single top-level `src/constants.ts` for
  app-wide values (colors, keys, app data), with component-specific values kept
  in the component folder. ([file structure](https://www.joshwcomeau.com/react/file-structure/))
- **Wieruch's promotion rule** is the reconciler: local until a second consumer
  appears, then promote. ([folder structure](https://www.robinwieruch.de/react-folder-structure/))
- Search-level consensus (`NOT FETCHED`, listicle-grade, do not cite as
  authority): keep constants next to use; a global constants file is justified
  for design tokens, env config, and values encoding an external contract (API
  enums, status codes). One contrarian piece worth reading for the argument
  that a shared constants file is "glue between independent features":
  [When magic numbers are not magic](https://medium.com/codex/when-magic-numbers-are-not-magic-fcdf034295a5).

---

## 4. Where does business logic live?

| Source | What it establishes |
|---|---|
| [React docs — You Might Not Need an Effect](https://react.dev/learn/you-might-not-need-an-effect) | The single most load-bearing source for this question. Nine cases where logic is in the wrong place: derived state (compute during render), expensive calc (`useMemo`), resetting state (`key`), adjusting state on prop change, **event-specific logic belongs in the event handler**, shared handler logic → a plain function, effect chains → one pass in the handler, app init → module scope, notifying the parent → same handler. Core rule: *"When something can be calculated from existing props or state, don't put it in state."* Effects are for **synchronizing with external systems** — nothing else. |
| [FSD — `model` segment](https://feature-sliced.design/docs/get-started/overview) | Names the home: schemas, stores and **business logic** go in `model`, separate from `ui` and `api`. |
| [Redux Style Guide](https://redux.js.org/style-guide/) | Two priority-tagged rules: "Put as Much Logic as Possible in Reducers" (Priority B) and "Move Complex Logic Outside Components" → thunks (Priority C), "especially true if the logic needs to read from the store state." |
| [React docs — Custom Hooks](https://react.dev/learn/reusing-logic-with-custom-hooks) | Hooks are the React-native unit for *stateful* logic extraction; pure transforms should stay plain functions (the `getSorted` vs `useSorted` rule). |
| [react.dev — `'use client'`](https://react.dev/reference/rsc/use-client) | In an RSC app the boundary is a **module-graph** decision, not a render-tree one: the directive marks the module *and all its transitive imports* as client code. Mark modules client-rendered only when they need state, effects, event handlers or browser APIs. Props crossing the boundary must be serializable — no class instances, no plain functions. This is what makes "where does the logic file sit" a bundle-size question in Next.js, not just taste. |
| [TkDodo — server state vs client state](https://tkdodo.eu/blog/) (`NOT FETCHED` — index only) | Server state belongs to the query cache; client state tracks only user edits; what's displayed is derived from both. Relevant to this repo, where every fetch is a TanStack Query hook. Pick the specific post before citing. |

---

## 5. Barrel files (`index.ts` re-exports)

A concrete, measurable rule — good material for the skill because it is the rare
organizational choice with numbers behind it.

| Source | What it establishes |
|---|---|
| [TkDodo — Please Stop Using Barrel Files](https://tkdodo.eu/blog/please-stop-using-barrel-files) | Barrels inside an app cause circular imports ("bundlers crash with the weirdest of error messages") and load every module synchronously. Measured: a Next.js project went from **11k modules and 5–10s startup to 3.5k modules — a 68% reduction** — after removing internal barrels. Barrels are legitimate **only for library public entry points**, "not made to group content of directories in your product application." |
| [Marvin Hagemeister — The barrel file debacle](https://marvinh.dev/blog/speeding-up-javascript-ecosystem-part-7/) | Module-graph construction cost: 500 modules → 0.15s, 10k → 3.12s, 50k → 48.44s. Removing barrels made many tasks **60–80% faster**; hits test runners and linters hardest. |
| [bulletproof-react](https://github.com/alan2207/bulletproof-react/blob/master/docs/project-structure.md) | Same conclusion from the structure side: barrels break Vite tree-shaking. |
| [Comeau](https://www.joshwcomeau.com/react/file-structure/) | **The dissent.** Recommends a per-component `index.ts` precisely so imports read `../Button` and editor tabs show real names. Note his barrels are one-line, non-chained, per-component — which is the narrow case the other two do not measure. The skill should say *that*, not "barrels bad." |

Related tooling seen in search (`NOT FETCHED`): `@trivago/prettier-plugin-sort-imports`,
[webpro-nl/unbarrelify](https://github.com/webpro-nl/unbarrelify), and Next.js's
`optimizePackageImports`.

---

## 6. Enforcement — rules that a linter can hold

Prose conventions rot; these are the tools that make the boundaries real.

- `import/no-restricted-paths` — the mechanism bulletproof-react names for
  unidirectional `shared → features → app`.
- [eslint-plugin-boundaries](https://github.com/javierbrea/eslint-plugin-boundaries)
  — element/category/origin dimensions; richer layer rules than the above.
- [dependency-cruiser](https://github.com/sverweij/dependency-cruiser) — graph-level
  validation and cycle detection; weaker editor feedback than ESLint, so the
  [Xebia writeup](https://xebia.com/blog/taking-frontend-architecture-serious-with-dependency-cruiser/)
  recommends running both.
- [steiger](https://github.com/feature-sliced/steiger) — FSD-specific linter.

---

## 7. Next.js App Router — architecture

Scoped to **architecture, not performance**: where code lives, which module may
import which, and where the trust boundary falls. Streaming, caching, image and
bundle tuning stay out.

### 7a. Where files go

[Next.js — Project structure and organization](https://nextjs.org/docs/app/getting-started/project-structure)
is explicit that the framework is **unopinionated**, then documents three
sanctioned strategies: files outside `app/`, files in top-level folders inside
`app/`, or **split by feature/route** (globals at the `app/` root, specifics in
the segment that uses them). Mechanics that decide placement:

- **Colocation is safe by default** — a route is not public until `page.js` or
  `route.js` exists, and only what those files *return* reaches the client. So
  the routing tree can hold non-route files without leaking them.
- **Private folders `_folder`** opt a subtree out of routing entirely. Documented
  reasons: "separating UI logic from routing logic" and avoiding collisions with
  future Next.js file conventions.
- **Route groups `(folder)`** organize without touching the URL, and are the
  mechanism for per-section layouts and multiple root layouts.
- Closing advice: *"choose a strategy that works for you and your team and be consistent."*

This validates the existing `client/` layout (`_components/<Name>/` per route)
as framework-idiomatic — the skill should read as a codification of what the
repo already does, not a rewrite of it.

### 7b. The `'use client'` boundary is an architectural decision

[Next.js — Server and Client Components](https://nextjs.org/docs/app/getting-started/server-and-client-components)
— the single most important Next.js source for this skill, because the boundary
is drawn in the **module graph**, not the render tree:

> `"use client"` is used to declare a **boundary** between the Server and Client
> module graphs (trees). Once a file is marked with `"use client"`, **all of its
> imports and the components it directly renders are included in the client
> bundle**.

The escape hatch is what makes composition work: *"It does not apply to Server
Components passed as children or other props. Those components are not imported
into the Client Component's module graph."* Concrete patterns to lift into the
skill:

| Pattern | Rule |
|---|---|
| Boundary placement | Mark the interactive leaf, not the container. The docs' example keeps `<Layout>` a Server Component and marks only `<Search />`. |
| Interleaving | A Client Component takes `children` as a *slot*; the Server Component renders into it (`<Modal><Cart /></Modal>`). This is how you nest server UI inside client UI. |
| Context providers | Context is unsupported in Server Components — wrap it in a `'use client'` provider taking `children`. *"You should render providers as deep as possible in the tree."* |
| Third-party client components | Re-export behind your own one-line `'use client'` module rather than marking the consumer. |
| Props across the boundary | Must be serializable. Classes and plain functions are rejected. |
| Environment poisoning | `import 'server-only'` makes a client import a **build-time error**; `client-only` is the mirror. Optional to install, and the standard guard for a module holding secrets or internal logic. |

### 7c. Where business logic lives — pick ONE data-handling model

[How to Think About Security in Next.js](https://nextjs.org/blog/security-nextjs-server-components-actions)
(Sebastian Markbåge, 2023-10-23) is the closest thing to an official
architecture doc, and it frames the whole question as a choice of three models —
with the instruction to **not mix them**: *"We recommend that you stick to one
approach and don't mix and match too much… Exceptions pop out as suspicious."*

| Model | Recommended for | Shape |
|---|---|---|
| **HTTP APIs** | "existing large projects / orgs" | Treat Server Components as untrusted like the client; call REST/GraphQL endpoints with `fetch()`, pass cookies. Zero Trust; keeps an existing backend team's practices intact. |
| **Data Access Layer (DAL)** | "new projects" | An internal library that owns *all* data access. "Every API should accept the current user and check if the user can see this data before returning it." Returns **DTOs** — objects safe to hand to the client as-is. Only the DAL touches `process.env`. |
| **Component-level access** | "prototyping and learning" only | Queries inline in Server Components. Requires auditing every `"use client"` prop signature for overly broad objects. |

Supporting rules worth quoting in the skill:

- *"The principle is that a Server Component function body should only see data
  that the current user issuing the request is authorized to have access to."*
- Re-read auth per read: *"always re-read access control and `cookies()` whenever
  reading data. Don't pass it as props or params."* `searchParams` and
  `[param]` are user input.
- Reads render, writes are Server Actions: *"Rendering a Server Component should
  never perform side-effects like mutations."*
- `"use server"` publishes an endpoint — *"the argument list to Server Actions
  must always be treated as hostile"*; validate args (zod) and re-authorize
  inside the action.
- Route Handlers and Middleware are *"low level escape hatches"*; a custom `GET`
  handler needs its own CSRF audit.
- The article's own **audit checklist** doubles as a review rubric for the skill:
  is the DAL isolated, are db packages and env vars imported nowhere else, are
  `"use client"` props narrow, are `"use server"` args validated and the user
  re-authorized, are bracket params validated.

**This matters for DevDigest specifically:** the repo is squarely in the **HTTP
APIs** model — a separate Fastify service at `:3001`, reached from the client
through `apiFetch` and TanStack Query hooks in `src/lib/hooks/`. So the skill
should teach the DAL as the alternative it is, and state plainly that this repo
has already chosen HTTP APIs, making a `lib/hooks/*` bypass (a raw `fetch`, or a
Server Component querying Postgres directly) a violation of the chosen model —
not merely a style slip.

### 7d. Already covered locally — do not duplicate

The vendored `next-best-practices` skill owns the mechanics one level down, and
the new skill should link to it rather than restate it:

| File | Covers |
|---|---|
| `rsc-boundaries.md` | async client components, non-serializable props, Server Actions as the exception |
| `data-patterns.md` | the read/write decision tree (Server Components for reads, Server Actions for mutations, Route Handlers for external APIs), waterfalls, preload |
| `file-conventions.md` | special files, route segments, parallel/intercepting routes, private folders, `middleware.ts` → `proxy.ts` |

---

## Repo-specific constraints the skill must respect

Pulled from `client/AGENTS.md` and `client/INSIGHTS.md` — these already answer
some of the user's questions for this codebase, and the skill must not
contradict them:

- Route-local logic → `src/app/**/_components/<Name>/` (**PascalCase**);
  cross-route → `src/components/<kebab-case>/`. Both conventions are
  load-bearing and they differ on purpose (`client/INSIGHTS.md`, 2026-08-02).
- Every fetch goes through a TanStack Query hook in `src/lib/hooks/` via
  `apiFetch`; a raw `fetch` in a component is forbidden.
- No hard-coded UI strings — `next-intl`, keys in `messages/en/<feature>.json`.
- Tests sit beside the component (colocation is already the house rule).
- A component serving both a fetching and a non-fetching caller takes **data,
  not an id** (`client/INSIGHTS.md`, 2026-08-02) — a concrete instance of the
  "who owns the data boundary" question.

---

## Skill outline — shipped as v1.0.0 (2026-08-02)

Named `frontend-ui-architecture`, sitting beside — not overlapping — the
vendored `react-best-practices`. Authored here, so it is **not** in
`skills-lock.json` and will not be overwritten on sync. The outline below is
what `SKILL.md` implements; section numbers there run 1–10 in a different
order (placement table first, boundaries at §3).

1. Decide the tree — feature-first default, the three schools and when each wins
2. Placement decision table — component / hook / util / constant / type / test
3. The promotion rule — local → shared, and the AHA gate on abstraction
4. Splitting components — problem-driven, not line-count-driven
5. Where business logic goes — handler vs hook vs plain module vs server
6. Boundaries — no cross-feature imports, unidirectional flow, how to lint it
7. Barrel files — module public API, and the narrow case where they are fine
8. Naming — files vs exports, and this repo's two live conventions
9. **Next.js architecture** — the three data-handling models and picking one;
   `'use client'` as a module-graph boundary; composition via `children` slots;
   provider depth; `server-only`; colocation, `_folders`, route groups
10. Anti-pattern catalog — `utils/` dumping ground, `components/` mega-folder,
    deep relative imports, effect-driven business logic, premature `shared/`,
    a client boundary drawn at the container instead of the leaf

Open questions for the author:

- ~~**Scope**: generic or Next.js-tuned?~~ **Resolved 2026-08-02** — include
  Next.js, architecture only, no performance. Reflected in §7 above.
- ~~**Naming rule**: keep the split, or move to all-kebab?~~ **Resolved
  2026-08-02** — there was no split to resolve. One rule already holds with zero
  violations: kebab names a module or segment, Pascal names a component. The
  skill codifies it; nothing gets renamed. Full statement and the measured
  rename cost of the rejected alternative are in `client/INSIGHTS.md`
  (Codebase Patterns, 2026-08-02).
- **Format**: adopt the Redux-style priority tags (Essential / Strongly
  Recommended / Recommended) or the severity tags the existing
  `react-best-practices` skill uses (CRITICAL / HIGH / MEDIUM)? Matching the
  latter makes the two skills readable as one set.
- **Depth of the Next.js section**: the DAL model (§7c) is the official
  recommendation for *new* projects, but DevDigest has already chosen HTTP APIs.
  Teach both, or teach HTTP-APIs-as-chosen with DAL as an appendix?

---

## Sources not reachable

- **[Tao of React — Alex Kondov](https://alexkondov.com/tao-of-react/)** —
  returns HTTP 403 to WebFetch (tried twice). Widely cited on component
  structure and props; needs a manual read before anything from it is quoted.
