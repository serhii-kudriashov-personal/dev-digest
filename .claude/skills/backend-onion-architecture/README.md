# backend-onion-architecture

Onion Architecture for the DevDigest backend — `server/` and `reviewer-core/`.
Answers one question in all its forms: **which ring does this code belong to, and
which rings may it import?**

| | |
|---|---|
| Version | 1.0.0 |
| Status | authored in this repo — **not** in `skills-lock.json`, safe to edit |
| Researched | 2026-08-02 |
| Enforced by | `cd server && pnpm arch` (`server/.dependency-cruiser.cjs`) |

## Files

| File | What it is |
|---|---|
| `SKILL.md` | The skill. Twelve rule sections, severity-tagged, ending in the catalogued violations. |
| `README.md` | This file — every source used, and how the skill was built. |
| `RESEARCH.md` | Annotated research: what each source establishes, what could not be fetched, where sources contradict each other, and the decisions taken. |

There is deliberately no `examples.md`. The subject is *placement and direction*,
so the worked examples are a ring table, a placement table and a set of
`from → to` lint rules — all of which read better inline than one hop away. The
executable example is `server/.dependency-cruiser.cjs`, which is a real file in
the real package rather than a snippet.

## Scope

**In:** the ring map and each ring's DevDigest address; the dependency rule;
where a port may be declared and who may declare one; the composition root and
the "never `new` an adapter" rule; repositories and what may cross their
boundary; the Fastify edge and plugin order; `reviewer-core`'s zero-I/O core;
placement of a new endpoint / query / external call / transform / literal;
testing per ring; the `pnpm arch` gate; and the pre-existing violations that must
not be copied.

**Out, on purpose:** how to write a Fastify hook, a Drizzle join, a Postgres
index or a Zod schema. Those belong to `fastify-best-practices`,
`drizzle-orm-patterns`, `postgresql-table-design` and `zod`. This skill decides
where those things live and who may reach them; it links rather than restates.
Frontend placement belongs to `frontend-ui-architecture`, which shares this
skill's severity vocabulary so the two read as one set.

**Not agent-prompt material.** This is reference for humans and for Claude
reading files. Root `INSIGHTS.md` (2026-08-02) records that stacking convention
blocks into a review agent's `system_prompt` made the reviews measurably worse,
and that any rule fed to an agent has to state its own severity. Do not paste
sections of this file into `agents.system_prompt`.

## Sources

All links were read in full unless marked *(not fetched)* — meaning the page
refused automated fetching or was only seen in search-result summaries, and the
claim should be verified before being quoted as authority. `RESEARCH.md` records
which specific claim each one backs.

### Onion Architecture — primary

- [Jeffrey Palermo — The Onion Architecture, part 1](https://jeffreypalermo.com/2008/07/the-onion-architecture-part-1/) — the dependency rule ("all code can depend on layers more central, but code cannot depend on layers further out from the core"); repository *interfaces* in the core, implementations outside; "The database is not the center. It is external."
- [part 2](https://jeffreypalermo.com/2008/07/the-onion-architecture-part-2/) — the concrete shape via CodeCampServer; the IoC container resolving interfaces into a controller constructor; and the sharp distinction that same layer ≠ same ring.
- [part 3](https://jeffreypalermo.com/2008/08/the-onion-architecture-part-3/) — the **four tenets**, including the one this skill uses as its definition of ring 1: "All application core code can be compiled and run separate from infrastructure." Also "any outer layer can directly call any inner layer" and "Data Access is a top layer along with UI, I/O, etc."
- [part 4 — after four years](https://jeffreypalermo.com/blog/onion-architecture-part-4-after-four-years/) — no retraction; two clarifications that matter here: "Onion architecture works well with and without DDD patterns", and a sample deliberately shipped *without* an IoC container.
- [Herberto Graça — Onion Architecture](https://herbertograca.com/2017/09/21/onion-architecture/) — Onion as Ports & Adapters plus DDD ordering inside the core; "Outer layers depend on inner layers; Inner layers do not know about outer layers"; proxy methods that add no business value are waste; and his disagreement with Palermo over repository-interface placement.
- [Mirror of Palermo's original sample](https://github.com/Jordiag/Jeffrey-Palermo-Onion-Architecture) *(not fetched)* — provenance only.

### Hexagonal and Clean — the neighbours

- [Alistair Cockburn — Hexagonal Architecture](https://alistair.cockburn.us/hexagonal-architecture/) — the intent: "Allow an application to equally be driven by users, programs, automated test or batch scripts, and to be developed and tested in isolation from its eventual run-time devices and databases." A port is "a purposeful conversation channel" — the source of §3's rule that a port is named for the capability, not the library. Plus the primary/secondary (driving/driven) asymmetry that explains why ring 0 holds only driven ports while `routes.ts` is the driving adapter.
- [Robert C. Martin — The Clean Architecture](https://blog.cleancoder.com/uncle-bob/2012/08/13/the-clean-architecture.html) — the Dependency Rule verbatim; frameworks and databases as "details" that live outermost "where they can do little harm"; and the boundary-crossing rule §5 rests on — "isolated, simple, data structures are passed across the boundaries", with an explicit warning against passing database row structures inward.

### Functional core, imperative shell — what ring 1 actually is

- [Kenneth Lange — The Functional Core, Imperative Shell Pattern](https://kennethlange.com/functional-core-imperative-shell/) — "the shell can call the core, but the core cannot call the shell and the core is even unaware of the existence of the shell"; the core written with immutable values and pure functions.
- [Albert Llousas — Functional Core, Imperative Shell revamp](https://medium.com/@allousas/building-modern-architectures-functional-core-imperative-shell-revamp-0bb5ae62b589) *(not fetched)* — keep hexagonal/clean as the structural blueprint while the domain stays pure functions rather than rich objects. The closest published description of what `reviewer-core` is.
- [Functional Core with Ports and Adapters](https://dev.to/siy/functional-core-with-ports-and-adapters-3m0g) *(not fetched)* — FCIS as Ports & Adapters "on a lower level: dealing with functions, not services".
- [Javier Casas — Functional Core, Imperative Shell](http://www.javiercasas.com/articles/functional-programming-patterns-functional-core-imperative-shell/) *(not fetched)* — background.

### Onion in Node/TypeScript, and how DI is usually done there

- [Remo Jansen — Implementing SOLID and the onion architecture in Node.js with TypeScript and InversifyJS](http://blog.wolksoftware.com/implementing-solid-and-the-onion-architecture-in-node-js-with-typescript-and-inversifyjs) *(not fetched)* — the reference Node/TS treatment; the ecosystem's default answer is a decorator-based IoC container.
- [@fastify/awilix](https://github.com/fastify/fastify-awilix) — the Fastify-native container: `asClass`/`asFunction`, `disposeOnClose`, `disposeOnResponse`, request-scoped `diScope`, composition root in `container.ts`. Cited so that DevDigest's hand-rolled `platform/container.ts` reads as a **recorded decision**, not an omission.
- [Melzar/onion-architecture-boilerplate](https://github.com/Melzar/onion-architecture-boilerplate) *(not fetched)* · [Sankhadip Samanta — Onion Architecture in Node.js with TypeScript](https://sankhadip.medium.com/onion-architecture-in-node-js-with-typescript-5508612a4391) *(not fetched)*

### Repositories — both sides, because §5 needs the counterweight

- [Jay Freestone — You might not need the repository pattern](https://www.jayfreestone.com/writing/you-might-not-need-the-repository-pattern/) — the strongest critique, and it names Drizzle specifically as a typed query builder already offering what a repository wraps. Catalogues the costs: interface bloat, transaction parameters leaking through, no real invariant-enforcing aggregates, and the testability argument being obsolete once a real database can run in tests. Its conclusion — adopt the pattern only if it genuinely protects a boundary or hides real complexity — is the test §5 answers explicitly.
- [Repository Pattern Is Lying To You — Use Ports And Adapters](https://medium.com/@samurai.stateless.coder/repository-pattern-is-lying-to-you-use-ports-and-adapters-a36d81534f40) *(not fetched)* — the leak list (paging types, query-method incantations, transaction concerns) that §5's boundary rule forbids. Independently backed by Martin's boundary quote, so nothing rests on this source alone.
- [cosmicpython — ch. 2, Repository](https://www.cosmicpython.com/book/chapter_02_repository) *(not fetched — 403 on both URL forms)* — the canonical case *for* the pattern, with its own trade-off table.
- [Arnaud Langlade — The repository design pattern](https://www.arnaudlanglade.com/repository-design-pattern/) *(not fetched)*
- [Domain models that are 100% ignorant of persistence and ORM unaware](https://medium.com/@john200Ok/domain-models-that-are-100-ignorant-of-persistence-and-orm-unaware-d8f7a8253c7b) *(not fetched)* — the strict position (separate domain and persistence models, converted in the repository) that DevDigest deliberately does not take.
- [Repository Pattern in Nest.js with Drizzle ORM](https://medium.com/@vimulatus/repository-pattern-in-nest-js-with-drizzle-orm-e848aa75ecae) *(not fetched)*

### Fastify — rings 4 and 5

- [Fastify — Encapsulation](https://fastify.dev/docs/latest/Reference/Encapsulation/) — "A fundamental feature of Fastify is the 'encapsulation context.' It governs which decorators, registered hooks, and plugins are available to routes." Propagation is downward only; parents cannot see a descendant's registrations; siblings never see each other; `fastify-plugin` deliberately breaks the boundary.
- [Fastify — The hitchhiker's guide to plugins](https://fastify.dev/docs/latest/Guides/Plugins-Guide/) *(not fetched in full)* — everything is a plugin; `register` creates a new scope; `decorate` is synchronous, so async bootstrapping goes inside a `register`.
- [Fastify — Decorators](https://fastify.dev/docs/latest/Reference/Decorators/) *(not fetched in full)* — backs `app.decorate('container', …)` plus `declare module 'fastify'` augmentation.
- [Snyk — Fastify plugins as building blocks for a backend Node.js API](https://snyk.io/blog/fastify-plugins-for-backend-node-js-api/) *(not fetched)*

**One correction worth recording.** §6's rule that `setErrorHandler` must be
registered *before* the module loop is **not** documented in the Fastify
encapsulation reference — that page says nothing about error-handler scope. The
rule is sourced from this repo (`server/src/app.ts` registers it before the loop
and says why in a comment) and is consistent with the documented downward-only
propagation, but it is a house invariant, not a quoted Fastify guarantee.

### Rings versus vertical slices — the reconciliation §1 rests on

- [Jimmy Bogard — Vertical Slice Architecture](https://www.jimmybogard.com/vertical-slice-architecture/) — "Minimize coupling between slices, and maximize coupling in a slice"; each slice picks its own depth and refactors toward patterns the business logic demands. Also the strongest argument *against* this skill's §12: on his view "most traditional abstractions like repositories and services become unnecessary". Recorded, not hidden — see the disagreements below.
- [Milan Jovanović — Where vertical slices fit inside the modular monolith](https://milanjovanovic.tech/blog/where-vertical-slices-fit-inside-the-modular-monolith-architecture) *(not fetched — 403)* — a module boundary already enforces separation, so the module's public API does the protecting.
- [NILUS — Layered architecture vs vertical slice in modular monoliths](https://www.nilus.be/blog/layered_architecture_vs_vertical_slice_in_modular_monoliths/) *(not fetched)* — "layered ideas within slices, not as the top-level organizing principle", which is the sentence §1 adopts.
- [Kevin Sookocheff — Making Modular Monoliths Work](https://sookocheff.com/post/architecture/making-modular-monoliths-work/) *(not fetched)* · [The Modular Monolith: Death to Layered Architecture](https://thearchitectsnotebook.substack.com/p/ep-122-the-modular-monolith-part) *(not fetched)* — the opposing view, listed so nobody mistakes this skill for uncontested.

### Boundary enforcement

- [dependency-cruiser](https://github.com/sverweij/dependency-cruiser) and its [rules reference](https://github.com/sverweij/dependency-cruiser/blob/main/doc/rules-reference.md) — chosen because it was **already** a `server/` dependency at `^17.4.3`, used in production by `src/adapters/depgraph/index.ts`. In a repo whose rule is "NOT a monorepo, install inside a package", a gate that adds zero packages wins.
- [eslint-plugin-boundaries](https://github.com/javierbrea/eslint-plugin-boundaries) — considered and rejected: the backend has no ESLint at all, so adopting it means adopting a toolchain to enforce one rule set. If ESLint ever lands in `server/` it becomes the better editor-feedback layer and this should be revisited.
- [Taking frontend architecture seriously with dependency-cruiser](https://xebia.com/blog/taking-frontend-architecture-serious-with-dependency-cruiser/) *(not fetched)*

### Zod at the boundary

- [Zod — Defining schemas](https://zod.dev/api) — `.nullish()` vs `.nullable()`, `.brand()`, `safeParse`.
- [Parse, Don't Validate — In a Language That Doesn't Want You To](https://cekrem.github.io/posts/parse-dont-validate-typescript/) *(not fetched)* — framing.
- [Branded Types & Zod](https://www.gperrucci.com/blog/typescript/branded-types-zod-senior-engineer-secret-safety) *(not fetched)* — `.brand()` is purely type-level. Noted as an option for ring-0 ids and deliberately **not** adopted: `vendor/shared` is vendored, and branding existing ids would touch every contract in both copies of `@devdigest/shared`.

### Internal to this repo

- `server/AGENTS.md` — the three-layer rule, "adapters come from `container`", route-schema validation, the `*.it.test.ts` naming rule, and the `@fastify/autoload` warning. This skill is largely that file's rules given a ring vocabulary, a placement table and a gate.
- `reviewer-core/AGENTS.md` — invariant #1 (zero I/O), barrel-only public API, `wrapUntrusted`, recomputed score, the `grounding.ts` / `INJECTION_GUARD` gates.
- Root `AGENTS.md` — not-a-monorepo, tsconfig `paths`, the two copies of `@devdigest/shared`, `SecretsProvider`-only secrets, do-not-touch paths, and the vendored-skill policy.
- `server/INSIGHTS.md` — the `completeAgentRun` double declaration (§3), `findings` having no indexes (§5), the silently-skipping `*.it.test.ts` (§9), and `rollupSeverities` being written-but-uncalled (§12).
- Root `INSIGHTS.md` — jsonb contract fields must be `.nullish()`, unknown cost is `null` not `0`, `findings.confidence` is uncalibrated (§11), and why a locked vendored skill cannot be corrected in place.
- Header docblocks of `src/vendor/shared/adapters.ts`, `src/modules/repo-intel/types.ts` and `src/platform/container.ts` — the three rules those files state about themselves, quoted rather than paraphrased.
- Sibling skills `fastify-best-practices`, `drizzle-orm-patterns`, `postgresql-table-design`, `zod` — they own the mechanics one level down. `frontend-ui-architecture` — the same question for `client/`, and the source of the severity vocabulary.

## Where the sources disagree

Recorded because a skill that hides its disagreements is just one opinion in a
confident voice. Full treatment in `RESEARCH.md` §11.

1. **Where repository interfaces belong.** Palermo puts them in the core; Graça
   puts them in the application layer and says both work. DevDigest does neither:
   *adapter* ports are ring 0, and DB repositories are concrete ring-3 classes
   with **no interface at all**. Justified by Freestone plus the fact that
   "swap the database" is nobody's scenario here, while tenancy and the test seam
   are real jobs.
2. **Whether repositories should exist.** Bogard would delete them per slice;
   cosmicpython and Langlade defend them; Freestone says only if they protect a
   real boundary. Decision: keep them for the two named local reasons, and forbid
   the bloat variants Freestone catalogues — no repository per table, no port per
   repository, no generic `list(criteria, pagination)`.
3. **Rings or slices as the top-level organising principle.** Decision: slices on
   top, rings inside each slice. Stated in §1 so it cannot be misread as a demand
   to reorganise `modules/` by layer.
4. **A DI container library or a hand-rolled one.** Inversify/awilix versus
   `platform/container.ts`. Decision: hand-rolled — with the service-locator cost
   stated out loud and bounded by "no `container.db` in a service".
5. **Rich domain model or functional core.** Onion/DDD assumes entities with
   behaviour; `reviewer-core` is pure functions over Zod-validated data. Decision:
   functional core, blessed by Palermo's part 4. **Weakest-sourced area in the
   skill** — three of four FCIS sources are unfetched — though the rule is
   descriptive of code that already exists and whose purity is independently
   enforced.
6. **Passing DB row types inward.** Martin is explicit that database row
   structures must not cross inward. DevDigest exports `$inferSelect` row types
   from `db/rows.ts` and hands them to ring 2. Resolution taken: a `$inferSelect`
   type *is* an "isolated, simple data structure" — no query builder, no
   connection, no behaviour — while a `db.select()` chain, an `SQL` fragment or a
   transaction handle is not. That is where §5 draws the line, and it is a
   judgement call rather than a sourced fact.
