# Research — backend-onion-architecture

Annotated research behind `SKILL.md`. Written before the skill, kept afterwards
so the next person can see what each rule rests on, what was never verified, and
which decisions were judgement calls rather than sourced facts.

Researched 2026-08-02. Sources marked **NOT FETCHED** returned HTTP 403 to
automated fetching or were only seen in search-result summaries — do not quote
them as authority without opening them by hand.

---

## 1. What does Onion Architecture actually require?

| Source | What it establishes |
|---|---|
| [Palermo, part 1](https://jeffreypalermo.com/2008/07/the-onion-architecture-part-1/) — fetched | The single rule: *"all code can depend on layers more central, but code cannot depend on layers further out from the core."* Domain model at the centre; **repository interfaces in the core**, implementations outside; UI, infrastructure and tests at the outer edge because they change most. *"The database is not the center. It is external."* |
| [Palermo, part 2](https://jeffreypalermo.com/2008/07/the-onion-architecture-part-2/) — fetched | The concrete shape, via CodeCampServer: core holds `IConferenceRepository`, `IUserSession`, `IClock`; outer layers hold `ConferenceRepository`, `UserSession`. *"At runtime, the IoC container will resolve the classes that implement interfaces and pass them into the SpeakerController constructor."* The sharp bit: a controller **may** use a same-layer class directly but **may not** use `ConferenceRepository` directly — same layer is not the same as same ring. |
| [Palermo, part 3](https://jeffreypalermo.com/2008/08/the-onion-architecture-part-3/) — fetched | The **four tenets**, and the most quotable source in the set: (1) the application is built around an independent object model; (2) inner layers define interfaces, outer layers implement them; (3) coupling points toward the centre; (4) *"All application core code can be compiled and run separate from infrastructure."* Also the difference from classic layering: *"any outer layer can directly call any inner layer"*, and *"Data Access is a top layer along with UI, I/O, etc."* |
| [Palermo, part 4 — after four years](https://jeffreypalermo.com/blog/onion-architecture-part-4-after-four-years/) — fetched | No retraction. Two clarifications that matter here: *"Onion architecture works well with and without DDD patterns. It works well with CQRS, forms over data, and DDD"*, and he deliberately shipped a sample **without** an IoC container to show the pattern does not need one. |
| [Herberto Graça — Onion Architecture](https://herbertograca.com/2017/09/21/onion-architecture/) — fetched | Onion = Ports & Adapters plus DDD ordering *inside* the core. Restates the rule as *"Outer layers depend on inner layers; Inner layers do not know about outer layers."* Adds that outer layers may call **any** inner layer, so proxy methods that add no business value are waste. Disagrees with Palermo on repository-interface placement (see §6). |
| [Jordiag — mirror of Palermo's original sample](https://github.com/Jordiag/Jeffrey-Palermo-Onion-Architecture) — NOT FETCHED | Fork of the original Bitbucket sample; listed for provenance only. |

**Taken into the skill:** tenet 4 becomes the testable definition of ring 1.
`reviewer-core`'s `build` being `tsc --noEmit` and its tests needing no keys and
no network *is* "compiled and run separate from infrastructure" — the invariant
already exists, the skill just names it. Tenet 2 becomes §3 (ports). Graça's
"outer may call any inner directly" is why the skill does **not** demand that
`routes.ts` reach ring 1 only through `service.ts`.

---

## 2. Hexagonal and Clean — what do the neighbours add?

| Source | What it establishes |
|---|---|
| [Cockburn — Hexagonal Architecture](https://alistair.cockburn.us/hexagonal-architecture/) — fetched | The intent, verbatim: *"Allow an application to equally be driven by users, programs, automated test or batch scripts, and to be developed and tested in isolation from its eventual run-time devices and databases."* A port is *"a purposeful conversation channel"* — the protocol is given by the **purpose**, not the device. The primary/secondary asymmetry: *"A primary actor is an actor that drives the application… A secondary actor is one that the application drives."* |
| [Uncle Bob — The Clean Architecture](https://blog.cleancoder.com/uncle-bob/2012/08/13/the-clean-architecture.html) — fetched | The Dependency Rule verbatim: *"Source code dependencies can only point inwards. Nothing in an inner circle can know anything at all about something in an outer circle."* Frameworks and databases are *"details"* that live outermost *"where they can do little harm."* And the boundary-crossing rule the skill needs most: outer-circle data structures must never pass inward — *"isolated, simple, data structures are passed across the boundaries"*, explicitly warning against passing database row structures inward. |

**Taken into the skill:** Cockburn's "purposeful conversation channel" is the
source of §3's naming rule (`GitHubClient`, not `OctokitWrapper` — the port names
the conversation, not the device). The primary/secondary split explains why
`vendor/shared/adapters.ts` holds only *secondary* (driven) ports and why
`routes.ts` is the primary adapter: nobody writes an interface for the driving
side, they write a Fastify plugin. Uncle Bob's boundary rule is the source of §5's
"nothing Drizzle-shaped crosses the boundary" — and it is also the rule DevDigest
partially breaks (§6 below).

---

## 3. Rings or slices? — the question the skill lives or dies on

`server/src/modules/<name>/` is a vertical slice. Palermo's rings are horizontal.
If the skill gets this wrong it reads as a demand to reorganise `modules/` by
layer, which nobody wants.

| Source | What it establishes |
|---|---|
| [Jimmy Bogard — Vertical Slice Architecture](https://www.jimmybogard.com/vertical-slice-architecture/) — fetched | *"Minimize coupling between slices, and maximize coupling in a slice."* Each slice picks its own depth: start with a transaction script, refactor to patterns when the business logic smells. And the part that fights this skill: *"most traditional abstractions like repositories and services become unnecessary."* |
| [Milan Jovanović — Where vertical slices fit inside the modular monolith](https://milanjovanovic.tech/blog/where-vertical-slices-fit-inside-the-modular-monolith-architecture) — **NOT FETCHED** (403) | Per search summary: inside a module a vertical slice is the natural fit, because the module boundary already enforces separation — *"you don't need layers to protect you; the module's public API does that."* Directionally consistent with Bogard. Verify before quoting. |
| [NILUS — Layered vs Vertical Slice in modular monoliths](https://www.nilus.be/blog/layered_architecture_vs_vertical_slice_in_modular_monoliths/) — **NOT FETCHED** | Per search summary: layered = horizontal separation by technical concern, vertical = separation by business behaviour; the two can be mixed, with *"layered ideas within slices, not as the top-level organizing principle."* This sentence is the reconciliation the skill adopts. Unverified. |
| [Kevin Sookocheff — Making Modular Monoliths Work](https://sookocheff.com/post/architecture/making-modular-monoliths-work/) — **NOT FETCHED** | Listed for completeness; nothing taken from it. |
| [Ep #122 — The Modular Monolith: Death to Layered Architecture](https://thearchitectsnotebook.substack.com/p/ep-122-the-modular-monolith-part) — **NOT FETCHED** | Title is the strongest available statement of the opposing view. Read before anyone argues the skill is uncontested. |

**Decision:** slices at the top level, rings **inside** each slice. Stated
explicitly in §1 so it cannot be misread. This is not a compromise invented here —
it is the position the NILUS and Jovanović summaries describe, and it is what the
repo already does: `modules/<name>/` is the slice, `routes → service →
repository` is the ring stack within it, and only ring 0 (`vendor/shared`) and
the composition root (`platform/container.ts`) are genuinely global.

**Unresolved tension, recorded not hidden:** Bogard would delete the service and
repository layers in the four modules that lack them, rather than add them. That
is a real position, not sloppiness, and it is the strongest argument against
§12's "fix shape" column. The skill keeps the three-layer rule anyway, for two
reasons that are specific to this repo rather than to architecture in general:
`server/AGENTS.md` already states it as house law, and workspace scoping plus the
`*.it.test.ts` seam give the repository layer a concrete job (§4 below). Where
Bogard is right and the skill agrees: nothing here demands a repository per table
or a port interface per repository.

---

## 4. Repositories: is the pattern worth it with Drizzle?

| Source | What it establishes |
|---|---|
| [Jay Freestone — You might not need the repository pattern](https://www.jayfreestone.com/writing/you-might-not-need-the-repository-pattern/) — fetched | The strongest counterweight, and it names Drizzle directly as a *"typed query builder"* offering *"a freeform typed canvas"* better than hand-rolled repository filtering. Costs: interface bloat (`findActiveById`, `getWithProduct`, `list(criteria, pagination)`) turning a repository into *"the cursed offspring of a repository and a DAO wearing DDD clothing"*; transaction parameters leaking through; most apps having no invariant-enforcing aggregates at all, just *"ripping out, transforming, and putting back"*; and the testability argument being obsolete now that a real Postgres can run in tests. |
| [Repository Pattern Is Lying To You — Use Ports And Adapters](https://medium.com/@samurai.stateless.coder/repository-pattern-is-lying-to-you-use-ports-and-adapters-a36d81534f40) — **NOT FETCHED** | Per search summary: the pattern *"can quietly weld your business logic to today's database and ORM quirks, turning 'abstraction' into a dependency that leaks paging types, query-method incantations, and transaction concerns."* This is the precise failure mode §5's boundary rule forbids. Unverified — the rule is independently supported by Uncle Bob's boundary quote (§2), so nothing rests on this source alone. |
| [cosmicpython — ch. 2, Repository](https://www.cosmicpython.com/book/chapter_02_repository) — **NOT FETCHED** (403, both URL forms) | The canonical case *for* the pattern, including its own honest trade-off table. Read by hand before citing. |
| [Arnaud Langlade — The repository design pattern](https://www.arnaudlanglade.com/repository-design-pattern/) — **NOT FETCHED** | Same side of the argument. |
| [ORM-unaware domain models in hexagonal architecture](https://medium.com/@john200Ok/domain-models-that-are-100-ignorant-of-persistence-and-orm-unaware-d8f7a8253c7b) — **NOT FETCHED** | Per search summary: domain objects are rich models; persistence models are data structures only; the repository converts between them on the way in and out. DevDigest does **not** do this — see §6. |
| [Repository Pattern in Nest.js with Drizzle ORM](https://medium.com/@vimulatus/repository-pattern-in-nest-js-with-drizzle-orm-e848aa75ecae) — **NOT FETCHED** | Implementation flavour only; nothing taken. |

**Decision:** keep the repository layer, and say plainly *why* — because
Freestone's critique lands otherwise. The two reasons are local and checkable:

1. **Workspace scoping.** Every repository method is scoped by workspace at
   construction. A stray `db.select()` in a route is not just a layering slip, it
   is a tenancy bug waiting to happen.
2. **The `*.it.test.ts` seam.** The repository is the line where a test switches
   from hermetic to testcontainers.

Freestone's own conclusion — *only adopt the pattern if it genuinely protects a
domain boundary or hides real complexity* — is satisfied by (1) and (2), and it
also settles what **not** to do: no repository per table, no port interface per
repository, no `list(criteria, pagination)` generic query API.

---

## 5. Where does the pure core fit — onion, or functional core?

| Source | What it establishes |
|---|---|
| [Kenneth Lange — The Functional Core, Imperative Shell Pattern](https://kennethlange.com/functional-core-imperative-shell/) — fetched (via search summary of the primary) | Two attributes: a core with the business logic, a shell handling the outside world; *"the shell can call the core, but the core cannot call the shell and the core is even unaware of the existence of the shell"*; plus the extra requirement that the core be written functionally — immutable values, pure functions. |
| [Albert Llousas — FCIS revamp](https://medium.com/@allousas/building-modern-architectures-functional-core-imperative-shell-revamp-0bb5ae62b589) — **NOT FETCHED** | Per search summary, the exact reconciliation DevDigest needs: keep hexagonal/clean as the structural blueprint, keep the domain purely functional — *"instead of having Rich domain objects that implement those ports… you place pure functions in the domain."* Ports stay at the shell/core boundary. Verify before quoting. |
| [Functional Core with Ports and Adapters](https://dev.to/siy/functional-core-with-ports-and-adapters-3m0g) — **NOT FETCHED** | Per search summary: FCIS *"is inspired by Ports & Adapters, and essentially boils down to it, but simply on a lower level: dealing with functions, not services."* |
| [Javier Casas — Functional Core, Imperative Shell](http://www.javiercasas.com/articles/functional-programming-patterns-functional-core-imperative-shell/) — **NOT FETCHED** | Background only. |

**Decision:** describe ring 1 as a functional core, not a DDD domain model. This
matters practically: it forecloses the "make `Finding` a class with methods"
refactor that reading Palermo alone would suggest. `reviewer-core` is 8 files of
exported functions over Zod-validated data, with one injected `LLMProvider`, and
Palermo's part 4 explicitly blesses onion *without* DDD patterns — so this is not
a deviation, it is one of the sanctioned shapes.

**Weakest-sourced area in the whole skill.** Three of the four FCIS sources are
unfetched, and the one fetched source is a blog post. The rule taken from them is
nonetheless safe, because it is *descriptive* of code that already exists and
whose purity is independently enforced by `reviewer-core/AGENTS.md` invariant #1.

---

## 6. Onion in Node/TypeScript specifically — and how DI is usually done

| Source | What it establishes |
|---|---|
| [Remo Jansen (Wolk) — Implementing SOLID and the onion architecture in Node.js with TypeScript and InversifyJS](http://blog.wolksoftware.com/implementing-solid-and-the-onion-architecture-in-node-js-with-typescript-and-inversifyjs) — **NOT FETCHED** | Per search summary: the reference Node/TS treatment; *"uses the dependency injection principle extensively"*, influenced by DDD. The canonical answer in this ecosystem is a decorator-based IoC container. |
| [@fastify/awilix](https://github.com/fastify/fastify-awilix) — fetched | The Fastify-native answer: `asClass`/`asFunction` registration, `disposeOnClose` via an `onClose` hook, `disposeOnResponse` via `onResponse`, request-scoped `diScope`. Composition root conventionally lives in `container.ts`. |
| [Melzar/onion-architecture-boilerplate](https://github.com/Melzar/onion-architecture-boilerplate) — **NOT FETCHED** | Express + TS OOP variant. |
| [Sankhadip Samanta — Onion Architecture in Node.js with TypeScript](https://sankhadip.medium.com/onion-architecture-in-node-js-with-typescript-5508612a4391) — **NOT FETCHED** | Blog-level walkthrough. |

**Decision:** do not introduce a container library. `platform/container.ts` is
219 hand-written lines that already do the job, `ContainerOverrides` is a better
test seam than a registry of tokens, and Palermo's part 4 explicitly demonstrates
onion without an IoC container. `@fastify/awilix` is cited in the skill's README
so that the hand-rolled container reads as a **recorded decision** rather than an
omission someone should "fix".

**The honest cost, written into §4:** `new XService(container)` passes the whole
container, which is service location, not constructor injection. The mitigation
is a stated boundary — a ring-2 service may read `container.<port>` but never
`container.db` — rather than a pretence that the pattern is clean.

---

## 7. The Fastify edge — what the docs actually say

| Source | What it establishes |
|---|---|
| [Fastify — Encapsulation](https://fastify.dev/docs/latest/Reference/Encapsulation/) — fetched | *"A fundamental feature of Fastify is the 'encapsulation context.' It governs which decorators, registered hooks, and plugins are available to routes."* Propagation is downward only: descendants see ancestors' registrations, parents cannot see a descendant's, siblings never see each other. `fastify-plugin` deliberately breaks the boundary so a registration escapes upward. |
| [Fastify — The hitchhiker's guide to plugins](https://fastify.dev/docs/latest/Guides/Plugins-Guide/) — **NOT FETCHED** in full | Per search summary: *"everything is a plugin"*; `register` creates a new scope; wrap distributable code in a `register` so it can bootstrap asynchronously, since `decorate` is synchronous. |
| [Fastify — Decorators](https://fastify.dev/docs/latest/Reference/Decorators/) — **NOT FETCHED** in full | Backs `app.decorate('container', …)` + `declare module 'fastify'` augmentation, which is what `app.ts` does. |
| [Snyk — Fastify plugins as building blocks for a backend Node.js API](https://snyk.io/blog/fastify-plugins-for-backend-node-js-api/) — **NOT FETCHED** | Secondary. |

**Correction to my own first draft.** I had planned to source "`setErrorHandler`
must be registered before modules or they will not inherit it" from the Fastify
encapsulation docs. The fetched page does **not** state anything about error-handler
scope inheritance. The claim is therefore sourced from this repo instead —
`server/src/app.ts` registers `setErrorHandler` before the module loop and says so
in a comment — and the skill presents it as a house invariant backed by the
general downward-only propagation rule, not as a documented Fastify guarantee.

---

## 8. Zod at the boundary

| Source | What it establishes |
|---|---|
| [Zod — Defining schemas](https://zod.dev/api) — reference | `.nullish()` vs `.nullable()`, `.brand()`, `safeParse`. |
| [Parse, Don't Validate — In a Language That Doesn't Want You To](https://cekrem.github.io/posts/parse-dont-validate-typescript/) — **NOT FETCHED** | Framing only. |
| [Branded Types & Zod](https://www.gperrucci.com/blog/typescript/branded-types-zod-senior-engineer-secret-safety) — **NOT FETCHED** | Per search summary: `.brand()` is purely type-level, nothing at runtime; validate at the I/O boundary, then hand a branded type inward. |

**Decision:** mention branded ids as an available option for ring 0 and do
**not** adopt them. `vendor/shared` is vendored — the root rule is extend, never
refactor — and branding existing id types would touch every contract and both
copies of `@devdigest/shared`. Recorded here so the idea is not lost.

The rules that *are* taken are already repo insights rather than source claims:
a field added to a **jsonb-persisted** contract must be `.nullish()`, never
`.nullable()` (root `INSIGHTS.md` 2026-08-02), and validation belongs in the
Fastify route `schema:`, never a hand-rolled `.parse()` in a handler
(`server/AGENTS.md`).

---

## 9. Enforcement tooling

| Source | What it establishes |
|---|---|
| [dependency-cruiser](https://github.com/sverweij/dependency-cruiser) + [rules reference](https://github.com/sverweij/dependency-cruiser/blob/main/doc/rules-reference.md) | `forbidden` rules as `{name, severity, from, to}` with `path`/`pathNot` regexes; `options.tsConfig.fileName` for path-alias resolution; `options.tsPreCompilationDeps` for whether type-only imports count as dependencies. Already a `server/` dependency at `^17.4.3`. |
| [eslint-plugin-boundaries](https://github.com/javierbrea/eslint-plugin-boundaries) — fetched | Real, ESLint-9 flat-config and TypeScript capable, `settings["boundaries/elements"]` + a dependency rule. |
| [Taking frontend architecture seriously with dependency-cruiser](https://xebia.com/blog/taking-frontend-architecture-serious-with-dependency-cruiser/) — **NOT FETCHED** | The "run it alongside ESLint" argument. |

**Decision:** `dependency-cruiser`, for one decisive reason — it is **already
installed** in `server/` (used in production by `src/adapters/depgraph/index.ts`
to build the repo import graph), so the gate adds zero packages and zero lockfile
churn to a repo whose root rule is "NOT a monorepo, install inside a package".
`eslint-plugin-boundaries` was rejected only because the backend has no ESLint at
all — adopting it means adopting a whole toolchain to enforce one rule set. If
ESLint ever lands in `server/`, it becomes the better editor-feedback layer and
this decision should be revisited.

Two configuration traps found while planning, both worth an insight:
- `server/package.json` is `"type": "module"`, so the config must be
  `.dependency-cruiser.cjs`. `depcruise --init` generates `.dependency-cruiser.js`,
  which will fail to load.
- `tsPreCompilationDeps` must be **false**. With it true, the type-only
  `$inferSelect` imports in `reviews/{diff-loader,run-executor}.ts` register as
  ring-2 → `db/schema` dependencies and the SQL rules fire on files that emit no
  runtime import at all.

---

## 10. Repo-specific constraints the skill must respect

Not sources — house law. Every one of these had to be checked before a rule was
written, because several obvious-looking rules are forbidden here.

| Constraint | Consequence for the skill |
|---|---|
| `*/src/vendor/**` — "vendored code, do not refactor" (root `AGENTS.md`) | Ring 0 can be **extended** but never reorganised. No "move the ports into a `ports/` folder" rule. |
| `@devdigest/shared` exists twice; canon is `server/src/vendor/shared`, `client/src/vendor/shared` is a manual copy | Adding a port is a two-file change in one commit. And root `INSIGHTS.md` 2026-08-01: `diff -r` is the wrong check — diff only the file you touched, comments stripped. |
| `reviewer-core/tsconfig.json` maps `@devdigest/shared` → `../server/src/vendor/shared` | Ring 0 physically lives inside the ring-3 package. A packaging wart, not a direction violation. The gate must not flag it, and the skill must say "do not fix this". |
| `reviewer-core` never emits JS; `build` is `tsc --noEmit`; consumers read `.ts` | Nothing in the skill may assume a build artefact boundary between rings 1 and 2. |
| NOT a monorepo — four `package.json`, four lockfiles | The gate lives in `server/` and cruises `../reviewer-core/src` from there. No root-level tooling. |
| Migrations are never edited, only superseded | §5's "ship the index in the same migration" means a **new** migration via `pnpm db:generate`. |
| `db/migrations/**`, `reviewer-core/src/grounding.ts`, `INJECTION_GUARD` are do-not-touch | §7 states this rather than restating what the files do. |
| Empty tables (`ci_*`, `eval_*`, `memory`, `digests`, `onboarding`) are reserved on purpose | No "clean up the unused schema" advice anywhere. |
| A DB-backed test must be named `*.it.test.ts` or the CI split breaks silently | §9's naming rule is load-bearing, not cosmetic. |
| Vendored skills are overwritten on sync; only unlocked skills are ours to edit | This skill must stay out of `skills-lock.json` (root `INSIGHTS.md` 2026-08-02). |
| A rule fed to an agent `system_prompt` must state its own severity, and stacking rule blocks made review *worse* | This skill is for humans and for Claude reading files. It is **not** material to paste into `agents.system_prompt` — say so, or someone will try. |

---

## 11. Contradictions to resolve, and how they were resolved

1. **Where repository interfaces live.** Palermo: in the core (part 1, part 2 —
   `IConferenceRepository` sits in the application core). Graça: in the
   application layer, because persistence is an infrastructure detail the domain
   should not know about; he notes both work in practice. **DevDigest does
   neither** — *adapter* ports live in ring 0 (`vendor/shared/adapters.ts`) while
   DB repositories are concrete ring-3 classes with **no interface at all**.
   Resolution: keep it, and justify it from Freestone (§4) plus the fact that the
   swap-the-database scenario the interface would enable is not a scenario anyone
   has, whereas the tenancy and test-seam jobs are real. Written into §5 as a
   deliberate deviation, not as an oversight.

2. **Whether repositories should exist at all.** Bogard would delete them per
   slice; cosmicpython/Langlade defend them; Freestone says only if they protect
   a real boundary. Resolution in §4/§5 above: keep, for two named local reasons,
   and forbid the bloat variants Freestone catalogues.

3. **Rings vs slices as the top-level organising principle.** Resolved in §3:
   slices on top, rings inside. Stated in §1 of the skill so it cannot be
   misread as a demand to reorganise `modules/`.

4. **IoC container vs hand-rolled.** Resolved in §6: hand-rolled, with the
   service-locator cost stated and bounded.

5. **Rich domain model vs functional core.** Resolved in §5: functional core,
   blessed by Palermo part 4's "works well with and without DDD patterns".

6. **No outer-circle data structures inward — and DevDigest passing DB row types
   into ring 2.** Uncle Bob is explicit: never pass database row structures
   inward; pass *"isolated, simple, data structures"*. DevDigest exports
   `$inferSelect` row types from `db/rows.ts` and hands them to services. Strict
   reading: a violation. Resolution taken: a Drizzle `$inferSelect` type **is** an
   isolated plain data structure — it carries no query builder, no connection, no
   behaviour — so it satisfies the spirit of the rule while a `db.select()` chain,
   an `SQL` fragment or a transaction handle does not. That is exactly where §5
   draws the line, and it is a judgement call, not a sourced fact. Recorded so it
   can be argued with.

---

## 12. Proposed skill outline — confirmed before writing

1. The rings and their DevDigest address · 2. The dependency rule (CRITICAL) ·
3. Ports (CRITICAL) · 4. The composition root (CRITICAL) · 5. Repositories and
Drizzle (CRITICAL) · 6. The Fastify edge (CRITICAL) · 7. The pure core
(CRITICAL) · 8. Placement table · 9. Testing per ring (HIGH) · 10. Enforcement ·
11. Anti-patterns · 12. Known violations — debt, not precedent.

Resolved while planning, so recorded rather than left open:

- ~~Should the skill prescribe a `domain/` ring per module?~~ No — the user chose
  "codify + name the debt". A domain ring appears only if a module grows real
  invariants, and that is not today.
- ~~Single file or hub + `rules/`?~~ Single `SKILL.md`, mirroring
  `frontend-ui-architecture`, so the two backend/frontend skills read as one set.
- ~~Enforce with ESLint or dependency-cruiser?~~ dependency-cruiser — already
  installed (§9).
- ~~Should the gate run in CI?~~ Out of scope for this change, by decision. The
  `pnpm arch` script exists; wiring `server-unit.yml` is a follow-up, and it must
  be an inlined `pnpm exec depcruise` step because that workflow deliberately
  avoids depending on `package.json` scripts.

Still open, genuinely:

- Whether `no-cross-slice-import` can ever reach `severity: error`, or whether
  the container-mediated `agentsRepo`/`reviewRepo` channel leaves too many
  legitimate edges. Settled empirically when the gate is first run — see the
  violation table in `README.md`.
- Whether `settings/feature-models.ts` should be renamed to `service.ts` so the
  `no-sql-in-service` glob catches it. Renaming is a `server/src` change, which
  this task excludes; it is listed as debt in §12 instead.

---

## Sources not reachable

`cosmicpython` ch. 2 (403 on both URL forms), Milan Jovanović (403), and the
`eslint-plugin-boundaries` npm page (403) refused automated fetching. The
Medium-hosted pieces and several blogs were only seen as search summaries. Every
one of them is marked **NOT FETCHED** above, and no rule in `SKILL.md` rests on
an unfetched source alone — each has either a fetched primary saying the same
thing or a repo fact backing it.
