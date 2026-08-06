---
name: frontend-ui-architecture
description: "Frontend UI architecture and code organization for React and Next.js App Router — where every file goes and which module may import which. Use when adding a component, hook, helper, constant or type; when choosing between a route-local and a shared location; when splitting a component or carving out a feature; when drawing the server/client boundary; or when reviewing file layout, module boundaries and import direction. Covers the placement table, the promotion rule, business-logic placement, barrel files, naming, and the Next.js data-handling models. Does NOT cover rendering behaviour, hooks misuse, testing or performance — those belong to react-best-practices, react-testing-library and next-best-practices."
version: 1.0.0
---

# Frontend UI Architecture

Answers exactly one question, in every form it takes: **where does this code
go, and what is it allowed to import?**

Scope is structure, not behaviour. Rendering, hooks misuse, memoization,
bundle size and caching are out — see `react-best-practices` and
`next-best-practices`. When a rule here happens to rest on performance evidence
(barrel files, §7), the rule taken from it is still about module boundaries.

## Severity

| Tag | Meaning |
|---|---|
| **CRITICAL** | Breaks the architecture. Wrong imports, leaked secrets, a boundary that cannot be undone cheaply. |
| **HIGH** | Costs real time later — churn, merge pain, code nobody can find. |
| **MEDIUM** | Consistency and readability. |

---

## 1. The placement table

Start here. Find the row, follow it, stop.

| You are adding | It goes | Rule |
|---|---|---|
| Component used by **one** route | that route's `_components/<Name>/` | §3 |
| Component used by **2+** routes | shared module `components/<kebab>/` | §3 |
| Sub-component of a shared module | `components/<kebab>/<Name>/` | §8 |
| Data fetching of any kind | a query hook in the data layer — never in a component | §5 |
| Pure helper used by **one** component | `helpers.ts` beside it | §2 |
| Pure helper used by **2+** | shared `lib/<name>.ts` | §2 |
| Stateful logic reused **2+** times | a custom hook, named for its use case | §5 |
| Constant used by **one** component | `constants.ts` beside it | §6 |
| Constant that encodes an external contract | shared config / contracts | §6 |
| Type mirroring an API payload | the shared contracts package | §10 |
| Style object | `styles.ts` beside the component | §8 |
| Test | beside the file it tests | §2 |
| User-facing string | the i18n message catalogue, never inline | §10 |

**When two rows seem to fit, take the narrower one.** Promotion is cheap and
reversible; premature sharing is neither (§2).

---

## 2. The promotion rule (CRITICAL)

**Code starts in the narrowest scope that works, and moves up only when a
second real consumer appears.**

- One consumer → live beside it.
- Second consumer appears → move up to the nearest shared ancestor, in the
  same commit that adds the second use.
- Never create a shared location for a hypothetical future consumer.

Colocation is the default because things that change together should sit
together: tests, styles, helpers and constants live next to the component they
serve. The documented exception is tests that span components (integration/e2e)
— those belong at the project root, because they map to no single file.

**Duplication is cheaper than the wrong abstraction.** Two copies are fine.
The third occurrence is when the real shape becomes visible — extract then, not
before. An abstraction invented at copy one encodes a guess; one extracted at
copy three encodes evidence.

> Do not "tidy up" by pre-creating `shared/`, `common/` or `utils/` and filling
> them. A shared folder is an *outcome* of promotion, never a starting point.

---

## 3. Module boundaries (CRITICAL)

**A feature never imports from another feature.** If two features need the same
thing, that thing is promoted to shared (§2) and both import it from there.
Compose features at the application level instead.

**Imports flow one way:** `shared → features → app`. Shared code may be used
anywhere; a feature may reach into shared; the app layer composes features.
Nothing ever points back up. In a layered variant of the same idea, a module
may only import from layers strictly below it, and never from a sibling on its
own layer.

Why the direction matters more than the folder names: it is what makes a
feature **deletable**. If removing one feature breaks another, the boundary was
decorative.

**Reaching across two sibling trees is the signal you picked the wrong home.**
If a route-local component is being imported by a second route, the fix is to
promote it (§2) — not to import across `_components/` trees just because a
common ancestor exists.

**Enforce it, don't document it.** Prose conventions rot; these do not:

| Tool | Use |
|---|---|
| `import/no-restricted-paths` | the baseline — forbid cross-feature and upward imports |
| `eslint-plugin-boundaries` | richer layer/element rules, good editor feedback |
| `dependency-cruiser` | graph-level validation and cycle detection in CI |
| `steiger` | if the project follows Feature-Sliced Design specifically |

**No deep relative imports.** `../../../../` is a boundary violation wearing a
disguise — it means the importer knows the internal shape of a distant tree.
Use a path alias.

---

## 4. Splitting components (HIGH)

**Split on a named problem, not on a line count.** A long component is not by
itself a defect, and a 200-line ceiling is not a rule — splitting to satisfy a
number produces wrappers that pass props through and hide nothing.

Legitimate reasons to break a component up:

- **Reuse** — a second caller genuinely needs this piece.
- **State scope** — a piece of state re-renders far more than it should, or
  state has drifted so far from its use that bugs are hard to trace.
- **Testing** — a behaviour cannot be exercised without standing up the whole screen.
- **Collaboration** — the file is a standing merge conflict.
- **Integration** — a third-party widget needs its own island.
- **Boundary** — part of the tree must cross the server/client line (§9).

If none of these hold, leave it alone.

**Composition over prop drilling.** Before threading a prop through three
levels, ask whether the parent can pass `children` instead. A wrapper that does
not read a prop should not receive it.

**Own the data boundary explicitly.** A component serving both a caller that
must fetch and a caller that already holds the data takes **resolved data plus
a loading flag** — not an id it fetches from. Pushing the query inside forces
the caller that already has the data to refetch it, and makes "when to fetch"
the shared component's problem instead of the one caller that has it.

**Container/presentational is retired.** Do not create a wrapper component
whose only job is to fetch and pass down; its author withdrew the pattern once
hooks existed. Call the hook in the component that renders the data, and keep
the *hook* as the reusable unit.

---

## 5. Where business logic lives (CRITICAL)

Take the first row that applies:

| The logic… | Lives in |
|---|---|
| is derivable from props/state | the render body — compute it, do not store it |
| runs because the user did something | the event handler |
| is shared between two handlers | a plain function in the module |
| is a pure transform | a plain function, `helpers.ts` or shared `lib/` |
| is stateful and reused | a custom hook named for the use case |
| synchronizes with an external system | an Effect, wrapped in a custom hook |
| reads or writes the backend | the data layer (§9) — never a component |

**If it can be calculated from existing props or state, do not put it in
state.** Storing derived values and syncing them with an Effect is the most
common way business logic ends up in the wrong place. Specifically, no Effect
is needed to: transform data for rendering, reset state on a prop change (use
`key`), react to a user event, notify a parent, chain state updates, or
initialize the app. Effects are for synchronizing with systems outside React —
nothing else.

**Custom hooks are named for a use case, not a lifecycle.** `useChatRoom`,
`useOnlineStatus`, `useReviewRuns` — yes. `useMount`, `useEffectOnce`,
`useUpdateEffect` — no; they hide *when* without expressing *what*. A function
that calls no hooks does not get the `use` prefix (`getSorted`, not
`useSorted`).

Extraction is not automatic: a hook wrapping a single `useState` earns nothing.
Extract when it makes the caller **declarative** — when the component stops
describing how and starts naming what.

---

## 6. Constants (MEDIUM)

**Default to local.** A value used in one component lives in `constants.ts`
beside it. It is promoted by the same rule as everything else (§2).

A constant earns a shared home only when it is one of:

- a **design token** (spacing, colour, breakpoint) belonging to the design system;
- an **environment/config** value;
- an **external contract** — an API enum, status code, route name, query key —
  where the cost of two definitions drifting is a bug.

A global constants file is glue between modules that are supposed to be
independent. Every entry in it is a small coupling, so each one needs the
justification above.

**Name a value the moment it crosses a boundary.** Inside a three-line function
a literal is readable; the same literal in two files is a magic value and needs
a name. Do not invert this into ceremony — extracting every number into a
constant hurts more than it helps.

---

## 7. Barrel files (HIGH)

A barrel is an `index.ts` that only re-exports. It is a **public API
declaration**, and that is the only thing it should ever be.

- **One shallow barrel per shared module is fine** — it declares what the
  module exposes, so consumers import `@/components/diff-viewer` and stay
  ignorant of its internals.
- **Never chain barrels.** A barrel that re-exports other barrels pulls an
  entire subtree into the graph on the first import. Measured: a real app went
  from 11k modules to 3.5k — a 68% cut — by removing internal barrels; graph
  construction alone costs 0.15s at 500 modules and 48s at 50k.
- **Never import your own module through its own barrel.** `tab-panel.ts`
  importing from `../tab` (which re-exports `tab-panel.ts`) is a cycle, and
  bundlers report it as something else entirely. Inside a module, import the
  sibling file directly.
- **Do not barrel a feature or a route tree.** Those are not public APIs.

---

## 8. Naming (MEDIUM)

Casing encodes **what a thing is**, so the tree is readable without opening
files:

| Kind | Case | Example |
|---|---|---|
| Route segment (becomes a URL) | lowercase | `repos/`, `pulls/`, `[repoId]` |
| Module — the thing others import | kebab-case | `diff-viewer/`, `app-shell/` |
| Segment inside a module or route | kebab-case | `_components/`, `hooks/`, `primitives/` |
| Folder that **is** one component | PascalCase | `FindingsPanel/`, `FileCard/` |
| File exporting a component | PascalCase | `AppShell.tsx`, `Badge.tsx` |
| Everything else | lowercase | `helpers.ts`, `constants.ts`, `styles.ts` |

The rule is not "folders are kebab" — `diff-viewer/` is kebab because it is a
*module*, while `FileCard/` inside it is Pascal because it is a *component*.
Infrastructure modules (`lib/`) stay lowercase even when they export a
provider component.

---

## 9. Next.js App Router architecture (CRITICAL)

### Pick one data-handling model, and do not mix

| Model | Fits | Shape |
|---|---|---|
| **HTTP APIs** | a project with a separate backend service | Server Components are treated as untrusted, like the client. The UI calls REST/GraphQL endpoints; the backend owns authorization. |
| **Data Access Layer** | a new project with no separate backend | One internal library owns *all* data access. Every function takes the current user and checks authorization before returning. It returns DTOs — objects safe to hand to the client as-is. Only the DAL reads `process.env`. |
| **Component-level** | prototypes only | Queries inline in Server Components. Requires auditing every client prop for over-broad objects. |

Mixing them is the actual danger: when one model is the norm, an exception
looks suspicious in review. When there is no norm, nothing looks suspicious.

### The `'use client'` boundary is a module-graph decision

It does **not** split the render tree — it splits the module graph. Once a file
is marked, every module it imports and every component it renders directly is
client code.

- **Mark the interactive leaf, not the container.** A layout with a search box
  stays a Server Component; only the search box is marked.
- **Server components can still nest inside client ones — as `children`.**
  Components passed as props are not part of the client module graph; they are
  rendered on the server and handed over as output. This is the escape hatch
  that makes a client `<Modal>` wrapping a server `<Cart>` legal.
- **Providers go as deep as possible.** Context does not exist in Server
  Components, so a provider must be a client component taking `children` — wrap
  `{children}`, not the whole document.
- **Wrap third-party client components** in your own one-line `'use client'`
  re-export rather than marking every consumer.
- **Props crossing the boundary must be serializable.** Classes and plain
  functions are rejected; pass data, and let the client component own its
  handlers.
- **Guard server-only modules** with `import 'server-only'` — a client import
  then fails at build time instead of leaking secrets or internal logic.

### Reads render, writes are actions

Rendering a Server Component must never mutate. Writes go through Server
Actions — and `'use server'` publishes a callable endpoint, so **treat every
argument as hostile**: validate the input and re-authorize the user *inside*
the action. Route Handlers and middleware are escape hatches; a hand-written
`GET` handler needs its own CSRF review.

Re-read authorization at every read. `searchParams` and `[param]` are user
input — being on `/[team]/` is not proof of access to that team. Read
`cookies()` and re-check, rather than passing identity down as props.

### Placement mechanics

- **Colocation is safe by default** — a folder is not a route until it holds
  `page` or `route`, and only what those return reaches the client.
- **`_folder`** opts a subtree out of routing entirely — the idiomatic home for
  a route's own components and helpers.
- **`(group)`** organizes routes without touching the URL, and is how sections
  get their own layouts.
- The framework is deliberately unopinionated about the rest. Pick one strategy
  — files outside the routing tree, files at its root, or split by route — and
  be consistent.

---

## 10. Anti-patterns

| Smell | Why it hurts | Fix |
|---|---|---|
| `utils/` as a dumping ground | unrelated code with one shared name; nothing is findable | group by domain; promote only on a second consumer (§2) |
| `shared/` created up front | invites premature abstraction | let it emerge (§2) |
| One flat `components/` with 60 entries | no boundaries left to enforce | split by feature/module (§1) |
| Cross-feature import | features stop being deletable | promote to shared (§3) |
| `../../../../thing` | importer knows a distant tree's internals | path alias (§3) |
| Barrel importing barrels | huge graphs, cycles, cryptic bundler errors | direct sibling imports (§7) |
| Raw `fetch` inside a component | bypasses the chosen data model, error handling and cache | the data layer (§5, §9) |
| `useEffect` computing derived state | logic in the wrong place; extra renders; stale values | compute during render (§5) |
| Container component that only fetches | a wrapper hiding nothing | call the hook where you render (§4) |
| Splitting to satisfy a line limit | prop-passing wrappers, no boundary gained | split on a named problem (§4) |
| `'use client'` on a page or layout | drags the whole subtree into the client graph | mark the leaf (§9) |
| Passing a whole entity to a client component | over-broad props leak fields | pass the minimum (§9) |
| Hard-coded user-facing string | untranslatable, unreviewable | i18n catalogue (§1) |

---

## In this repo (DevDigest `client/`)

The rules above are already the house style; these are the concrete addresses.

| Generic | Here |
|---|---|
| Route-local component | `src/app/**/_components/<Name>/` |
| Shared component | `src/components/<kebab>/` |
| Data layer | `src/lib/hooks/<domain>.ts`, all through `apiFetch` |
| Shared helper | `src/lib/<name>.ts` |
| API contracts | `src/vendor/shared` — a **copy**; the canon is `server/src/vendor/shared`, change the canon first and port in the same commit |
| UI primitives | `src/vendor/ui/` — vendored, do not refactor; wrap instead of editing |
| Strings | `messages/en/<feature>.json` |

**The chosen data model is HTTP APIs** — a separate Fastify service on `:3001`,
reached through `apiFetch` and TanStack Query hooks. Consequences:

- A raw `fetch` in a component, or a Server Component querying Postgres
  directly, is not a style slip — it is a second data model appearing in a
  codebase that already picked one (§9).
- A new endpoint means a new hook in the matching domain file.
- A mutation must invalidate its query keys in `onSuccess`, or the screen keeps
  rendering stale data.

Read `client/INSIGHTS.md` before changing layout or contracts — the traps are
recorded there.

---

## Changelog

| Version | Date | Change |
|---|---|---|
| 1.0.0 | 2026-08-02 | Initial. Sources and provenance in `README.md`; annotated research and the conflicts between sources in `RESEARCH.md`. |
