---
name: backend-onion-architecture
description: "Onion Architecture for the DevDigest backend — the `server/` Fastify API and the `reviewer-core/` engine. Answers which ring a piece of code belongs to and which rings it may import. Use when adding or reviewing a route, service, repository, adapter, port, background job, SSE event or migration; when deciding where a query, an external call, a pure transform or a literal goes; when wiring something into the DI container; when touching `reviewer-core`'s zero-I/O core; whenever a module is created, split, or copied from an existing one; and whenever a file is added to a slice under a name other than `routes`, `service`, `repository`, `helpers`, `constants` or `types`. Covers the ring map, the dependency rule, ports and adapters, the composition root, repositories with Drizzle, the Fastify edge, the pure core, testing per ring, the slice file manifest that decides which files the `pnpm arch` gate can even see, the gate itself, and the catalogued violations that must not be copied. Does NOT cover Fastify, Drizzle, Postgres or Zod mechanics — those belong to fastify-best-practices, drizzle-orm-patterns, postgresql-table-design and zod — nor frontend placement, which belongs to frontend-ui-architecture."
version: 1.1.0
---

# Backend Onion Architecture

Answers exactly one question, in every form it takes: **which ring does this code
belong to, and which rings may it import?**

Scope is structure and direction. How to write a Fastify hook, a Drizzle join, a
Postgres index or a Zod schema is out — see `fastify-best-practices`,
`drizzle-orm-patterns`, `postgresql-table-design` and `zod`. This skill decides
*where* those things live and *who* is allowed to reach them.

This is reference material for humans and for Claude reading the repo. It is
**not** text to paste into an agent's `system_prompt` — root `INSIGHTS.md`
records that stacking convention blocks into a review prompt made the reviews
worse, not better.

## Severity

| Tag | Meaning |
|---|---|
| **CRITICAL** | Breaks the architecture. A dependency pointing outward, a leaked secret, a boundary that cannot be undone cheaply. |
| **HIGH** | Costs real time later — churn, untestable code, a bug class that keeps coming back. |
| **MEDIUM** | Consistency and readability. |

Same vocabulary as `frontend-ui-architecture`, so the two read as one set.

---

## 1. The rings, and their address in this repo

**DevDigest is a modular monolith of vertical slices, with the onion rings
running inside each slice.** `modules/<name>/` is the slice; `routes → service →
repository` is the ring stack within it. Only ring 0 and the composition root are
genuinely global. Nothing in this skill asks you to reorganise `modules/` by
layer — that would be the opposite of the intent.

| Ring | What it is | Address | May import |
|---|---|---|---|
| **0 · Contracts & ports** | Zod domain contracts and adapter interfaces | `server/src/vendor/shared/adapters.ts`, `vendor/shared/contracts/*.ts` | `zod`, and nothing else |
| **1 · Pure core** | the review engine — prompt, grounding, reduce, scoring | `reviewer-core/src/**` | ring 0, `zod`, `openai` (only behind `LLMProvider`) |
| **2 · Application** | use-case logic, pure transforms, facade ports | `modules/*/{service,helpers,constants}.ts`, `modules/reviews/run-executor.ts`, `modules/repo-intel/{types,pipeline}` | rings 0–1, plus ports resolved from the container |
| **3 · Infrastructure** | port implementations, all SQL, platform machinery | `adapters/**`, `db/**`, `modules/*/repository.ts`, `modules/reviews/repository/*.repo.ts`, `platform/{jobs,sse,run-logger,trace-builder,price-book,resilience,model-router}.ts` | anything inward, plus its own library |
| **4 · Composition root** | the only place that knows an interface *and* its implementation | `platform/container.ts`, `platform/config.ts`, `app.ts` | everything |
| **5 · Delivery / edge** | HTTP, Zod request schemas, SSE, error mapping | `modules/*/routes.ts`, plugin order in `app.ts`, `platform/errors.ts` | rings 0–4 |

Tests sit outside every ring and may import anything — that is what makes them
tests.

Ring 3 sitting *outside* ring 2 is the whole point and the thing most people get
backwards. Palermo: *"Data Access is a top layer along with UI, I/O, etc."* The
database is not underneath the application, it is beside the HTTP server.

---

## 2. The dependency rule (CRITICAL)

> "all code can depend on layers more central, but code cannot depend on layers
> further out from the core" — Palermo
>
> "Source code dependencies can only point inwards. Nothing in an inner circle
> can know anything at all about something in an outer circle." — Martin

Corollaries that actually bite in this repo:

- **`reviewer-core/src/**` may not reach** `fastify`, `drizzle-orm`, `postgres`,
  `simple-git`, `octokit`, `node:fs`, `node:child_process`, `src/db`, or
  `src/adapters`. This is `reviewer-core/AGENTS.md` invariant #1 restated as a
  direction, and it is now machine-checked (§10).
- **An outer ring may call any inner ring directly.** A route may use a ring-1
  function without a pass-through method in `service.ts`. Proxy methods that add
  no logic are waste, not layering.
- **A type-only import is not a dependency.** `import type { PullRow }` does not
  make the importer depend on the exporter at runtime, which is why the gate runs
  with `tsPreCompilationDeps: false`. Ring 2 files that pull `$inferSelect` types
  out of `db/schema` are tolerated for this reason but are still a smell — the
  fix is `db/rows.ts`, which exists for exactly this and says so in its docblock.
- **What crosses inward is plain data.** A row type is fine. A `db.select()`
  chain, an `SQL` fragment, a transaction handle, a `FastifyRequest` or an
  Octokit response object is not (§5, §6).

**The one physical inversion not to "fix":** `reviewer-core/tsconfig.json` maps
`@devdigest/shared` → `../server/src/vendor/shared`. Ring 0 physically lives
inside the ring-3 package. That is a packaging wart, not a direction violation —
ring 0 is pure types and Zod schemas with no imports of its own. Leave it, and
keep the gate configured not to flag it.

---

## 3. Ports (CRITICAL)

A port is a **capability**, named for the conversation and not for the library
that happens to hold up the other end. `GitHubClient`, never `OctokitWrapper`.
Rename the library tomorrow and the port keeps its name.

**The canonical port file is `server/src/vendor/shared/adapters.ts`** — seven
interfaces (`LLMProvider`, `Embedder`, `GitHubClient`, `GitClient`, `CodeIndex`,
`AuthProvider`, `SecretsProvider`), with the rule stated in its own header: *"ALL
external calls go behind these interfaces… Services depend on the interface, not
the impl."*

| Where a port may be declared | When | Precedent |
|---|---|---|
| `vendor/shared/adapters.ts` | any external system a feature talks to | all seven above |
| beside its implementation in `adapters/<name>/index.ts` | exactly one ring-3 pipeline consumes it | `DepGraph`, `Tokenizer` |
| `modules/<name>/types.ts` | a facade over a whole subsystem | `RepoIntel` |

**Adding a port to ring 0 is a two-file commit.** `@devdigest/shared` exists
twice: the canon is `server/src/vendor/shared`, and `client/src/vendor/shared` is
a manual copy. Change the canon, port the copy in the same commit. `vendor/**` is
vendored — **extend it, never reorganise it.** And do not verify the sync with
`diff -r`: the two trees carry documented historical drift, so diff only the file
you touched, comments stripped (root `INSIGHTS.md` 2026-08-01).

**A facade port states its degraded contract.** `RepoIntel`
(`modules/repo-intel/types.ts`) is "the SINGLE interface every feature codes
against", and it never throws on partial data: object methods carry
`degraded?`/`reason`, array methods return `[]`. Copy that shape. A facade that
throws when a subsystem is half-available forces every caller into a try/catch
and the degraded path stops being tested.

**A signature is declared once. (CRITICAL)** Never re-type a delegated method in
a facade — derive it (`Parameters<typeof fn>[0]`, or export the parameter type
from the implementation). `modules/reviews/repository.ts` re-declares
`completeAgentRun`'s inline `values` type, so adding a field fails typecheck with
`TS2353` pointing at the **call sites** rather than at the type that needs
changing. Recorded in `server/INSIGHTS.md`; the same duplication exists for every
other method that facade delegates.

---

## 4. The composition root (CRITICAL)

**Never `new` an adapter outside `platform/container.ts`.** Take it from
`container.<port>`, or `await container.<port>()` when a secret is needed. That
single rule is what makes `ContainerOverrides` a working test seam; one direct
`new OctokitGitHubClient(token)` in a service and that service can no longer be
tested without a real token.

The container's shape, and the reasons behind it:

- **Eager**: `config`, `db`, `secrets`, `auth`, `runBus`, `jobs`.
- **Lazy `??=`**: `git`, `codeIndex`, `repoIntel`, `depgraph`, `tokenizer`,
  `priceBook`, `agentsRepo`, `reviewRepo`.
- **`async` only when a secret is involved**: `github()`, `llm(id)`,
  `embedder()`. Call `invalidateSecretCaches()` after writing a key, or the next
  resolve hands back a client built from the old one.
- **`ConfigError` from `container.llm()` / `container.github()` is a normal
  path**, not a bug. Catch it and record a failed run; never let it become a 500.

**Cross-slice access goes through the container, not through an import.**
`agentsRepo` and `reviewRepo` are constructed in the composition root
deliberately, "so consuming modules use `container.agentsRepo` instead of
reaching into another module's folder" (`container.ts`). Asking the container for
a shared repository is the sanctioned channel.

**A slice's public surface is its `constants.ts` and its facade `types.ts`** —
literals and interfaces. Its `service`, `repository`, `routes`, `helpers` and
`run-executor` are private. So `modules/repos/service.ts` importing
`modules/repo-intel/constants.ts` is fine, and importing
`modules/agents/repository.ts` is not. This is what `no-cross-slice-import`
enforces (§10), and it is the line that keeps a slice deletable: if removing one
slice breaks another, the boundary was decorative.

**Services take the container, and that has a cost worth naming.** The house
convention is `new XService(container)`, which is service location rather than
constructor injection — a service's real dependencies are invisible in its
signature. The boundary that keeps it honest: **a ring-2 service may read
`container.<port>` but must never read `container.db`.** The `Db` handle belongs
to ring 3, and a repository takes `Db` in its constructor, not the container.

A DI container library (`@fastify/awilix`, InversifyJS) is deliberately **not**
used. Palermo's own part-4 sample drops the IoC container to show the pattern
does not need one, and `ContainerOverrides` is a better seam than a token
registry. This is a recorded decision, not an omission to fix.

---

## 5. Repositories and Drizzle (CRITICAL)

**All SQL lives in `repository.ts` or `repository/*.repo.ts`.** The constructor
takes `Db`, not `Container`. Every method is workspace-scoped.

**Nothing Drizzle-shaped crosses the boundary.** No query-builder chain, no `SQL`
fragment, no transaction handle in a parameter or a return type. Rows and plain
DTOs go out; that is the whole contract. This is the specific failure mode the
pattern is known for — an "abstraction" that leaks paging types, query-method
incantations and transaction concerns until the business logic is welded to
today's ORM.

**Row types come from `db/rows.ts`**, which exists so cross-cutting consumers can
name a row shape "WITHOUT importing another module's data layer". Ring 2 should
reach `db/rows.ts`, never `db/schema`.

**Why this repo has repositories at all — and what that does *not* license.**
Modern typed query builders already give you most of what a repository wraps, and
"we could swap Postgres out" is not a scenario anyone here has. DevDigest's
repositories earn their place for two concrete, checkable reasons:

1. **Tenancy.** Scoping lives in one place. A stray `db.select()` in a route is
   not just a layering slip, it is a workspace-leak waiting to happen.
2. **The test seam.** The repository is the exact line where a test stops being
   hermetic and starts needing testcontainers (§9).

So: **no repository per table, no port interface per repository, and no generic
`list(criteria, pagination)` query API.** Add a method when a use case needs it,
named for that use case.

**A new query that joins or filters `findings` ships its own index, in a new
migration.** The `findings` table has **no indexes at all** — a foreign key is
not an index, and Drizzle's `.references()` emits only the constraint. Edit
`db/schema/reviews.ts` and run `pnpm db:generate`; applied migrations are never
edited (`server/INSIGHTS.md`).

---

## 6. The Fastify edge (CRITICAL)

`routes.ts` is HTTP and Zod. No logic, no SQL.

**Validation goes in the route `schema:`.** Declare Zod `params`/`body` there and
Fastify rejects bad input with 422 before the handler runs. A hand-rolled
`Schema.parse(req.body)` inside a handler is forbidden. There is exactly one
documented exception — `modules/reviews/routes.ts` keeps "a tolerant manual
parse" because both body fields are optional and an empty body is valid. An
exception, not a pattern.

**Plugin order in `app.ts` is load-bearing.** `register` opens a new
encapsulation context, and registrations propagate **downward only** —
descendants see their ancestors' decorators and hooks, parents never see a
descendant's, siblings never see each other. Consequences, in order:

1. Validator/serializer compilers, then `new Container(...)` +
   `app.decorate('container', container)`.
2. `helmet` → `cors` → `FastifySSEPlugin` → `rateLimit` (skipped under
   `NODE_ENV=test`).
3. `setErrorHandler` — **before** the module loop, "so encapsulated module
   plugins inherit it". Register it after, and every module gets Fastify's
   default handler and the `{ error: { code, message, details } }` envelope
   silently stops applying.
4. The static module registry.

**Throw, don't hand-craft.** Throw `NotFoundError`, `ValidationError`,
`ExternalServiceError` or `ConfigError` (all `AppError` subclasses, all carrying
their own `statusCode`). A `reply.code(500).send(...)` in a handler bypasses the
envelope and the logging.

**Registration is static.** A new module is `modules/<name>/routes.ts` exporting
a default Fastify plugin, plus one import and one entry in `modules/index.ts`.
`@fastify/autoload` is installed and never used — a decoy; native dynamic
`import()` of `.ts` is not portable across tsx, the bundler and vitest.

**Fastify types stay at the edge.** A `FastifyRequest` or `FastifyReply` in a
service or repository signature is ring 5 leaking inward. Pass the values the
inner ring actually needs.

---

## 7. The pure core (CRITICAL)

`reviewer-core` is a **functional core**: exported functions over Zod-validated
data, with one injected `LLMProvider` as its only side effect. Not a DDD domain
model — do not retrofit entity classes onto `Finding` or `Review`. Onion works
with and without DDD patterns, and this repo picked without.

The testable definition, and Palermo's fourth tenet: *"All application core code
can be compiled and run separate from infrastructure."* `reviewer-core`'s `build`
is `tsc --noEmit` and its tests need no key, no network and no Docker. If a
change breaks either of those, the change is in the wrong package.

- **Zero I/O.** No DB, no GitHub, no filesystem, no direct network. Need data?
  Take it as a parameter.
- **The public API grows only via `src/index.ts`.** Consumers never import an
  internal path.
- **All untrusted content goes through `wrapUntrusted`** — diff, PR body, repo
  map, callers, specs. No exceptions.
- **The score is always recomputed** by `scoreFromFindings` from the findings
  that survived grounding. The model's own number is never used.
- **`grounding.ts` and `INJECTION_GUARD` are gates, not code.** Changing them is
  a deliberate decision with a test per behavioural change.

**The core never names an outer-ring type — not even an error class.**
`checkCancelled` throws the *caller's* error rather than importing the server's
error hierarchy. That is the rule in action, and it generalises: the shell may
call the core, the core does not know the shell exists.

---

## 8. Where a new piece of code goes

Find the row, follow it, stop.

| You are adding | It goes | Rule |
|---|---|---|
| An HTTP endpoint | `modules/<name>/routes.ts`, plugin registered in `modules/index.ts` | §6 |
| Request validation | the route's `schema:`, as Zod | §6 |
| Use-case logic | `modules/<name>/service.ts` | §1 |
| A SQL query | `modules/<name>/repository.ts` (or `repository/<aggregate>.repo.ts`) | §5 |
| An index for that query | `db/schema/<file>.ts`, then `pnpm db:generate` | §5 |
| A call to an external system | a port in ring 0, an implementation in `adapters/<name>/`, resolved from the container | §3, §4 |
| A pure transform | `modules/<name>/helpers.ts` — no I/O, no DB, no container | §1 |
| A literal | `modules/<name>/constants.ts` | §1 |
| Domain logic with no I/O at all | `reviewer-core/src/**`, exported from `src/index.ts` | §7 |
| A wire DTO or a persisted contract | `vendor/shared/contracts/*.ts`, canon first then the client copy | §3 |
| A row type | `db/rows.ts` | §5 |
| A read of another slice's data | `container.<sharedRepo>`, never a cross-module import | §4 |
| A background job | a `*_JOB_KIND` constant + the `JobRunner` via `container.jobs` | §1 |
| A run event | `RunLogger` / `runBus` — one sink, never a second event path | §1 |
| A mock for a new port | `adapters/mocks.ts`, `implements` the interface | §9 |
| A DB-backed test | `test/<name>.it.test.ts` — the filename is the CI split | §9 |
| A file in a slice under any other name | nowhere — fold it into `service.ts` / `helpers.ts`, or ship its `.dependency-cruiser.cjs` glob entries in the same commit | §13 |
| A whole new slice | `modules/<name>/` **plus** one import and one entry in `modules/index.ts`, same commit | §13 |

**When two rows seem to fit, take the inner one.** Logic that can live in a ring
without I/O should.

---

## 9. Testing per ring (HIGH)

The ring decides the test style. Cockburn's stated intent for this whole family
of architectures is being able to develop and test "in isolation from its
eventual run-time devices and databases" — the rings are what make that possible,
so a ring tested the wrong way means the boundary is not real.

| Ring | How it is tested |
|---|---|
| 1 · core | hermetic, no container. Inject a stub `LLMProvider`; keys and network are never required. |
| 2 · services, pure helpers | helpers directly; services through a `Container` built with `ContainerOverrides` + `adapters/mocks.ts`. |
| 3 · repositories | `*.it.test.ts` only — real Postgres via testcontainers. |
| 5 · routes | `buildApp({ overrides })` + `app.inject()`. No port, no network. |

- **Every new port needs a mock** in `adapters/mocks.ts` that `implements` it,
  or ring 2 becomes untestable the moment it uses the port.
- **A DB-backed test must be named `*.it.test.ts`** or the CI split breaks
  silently.
- **Read the test count, never just the exit code.** `*.it.test.ts` files
  degrade to `describe.skip` when the Docker probe fails — `7 tests | 7 skipped`,
  exit code 0, no red, nothing verified. `N skipped` on an integration file means
  unverified (`server/INSIGHTS.md`).

---

## 10. Enforcement — `pnpm arch`

Prose conventions rot. From `server/`:

```
pnpm arch
```

`dependency-cruiser` was already a `server/` dependency (production use in
`adapters/depgraph`), so the gate adds no packages. Config:
`server/.dependency-cruiser.cjs` — `.cjs` because the package is
`"type": "module"`, and `depcruise --init` writes a `.js` file that will not
load.

| Rule | Catches |
|---|---|
| `no-sql-in-routes` | Drizzle or `db/schema` reached from `modules/*/routes.ts` (§6) |
| `no-sql-in-service` | Drizzle reached from a `service.ts` / `helpers.ts` (§5) |
| `no-http-below-the-edge` | `fastify` imported by a service, repository or adapter (§6) |
| `no-adapter-impl-outside-root` | a module importing a concrete adapter instead of using the container (§4) |
| `no-cross-slice-import` | `modules/A` importing `modules/B` (§4) |
| `core-is-pure` | `reviewer-core` reaching `fastify`, `drizzle-orm`, `postgres`, `octokit`, `simple-git`, `@ast-grep/napi`, `src/db`, `src/adapters` (§7) |
| `core-is-pure-node-builtins` | `fs`, `child_process`, `net`, `http`, `https` in ring 1 (§7) |
| `core-resolves-everything` | an import ring 1 cannot resolve — see the trap below (§7) |
| `core-barrel-only` | an internal `reviewer-core` path imported instead of the barrel (§7) |
| `shared-is-a-leaf` | ring 0 importing anything but `zod` (§1) |
| `no-circular` | cycles anywhere |

**Every `modules/` rule above selects files by name, not by content.** A file called anything other than `routes`, `service`, `repository`, `helpers`, `constants` or `types` is matched by none of them and the gate has no opinion on it at all — see §13 before adding one.

`tsPreCompilationDeps` is **false** on purpose (§2): with it true, type-only
`$inferSelect` imports register as SQL dependencies and the rules fire on files
that emit no runtime import at all.

**Two traps, both of which made a rule silently pass during authoring:**

1. **`tsPreCompilationDeps: false` means unused imports do not exist.**
   TypeScript elides an import whose binding is never used in a value position,
   so a rule can only see imports that survive compilation. That is the right
   semantic for a runtime-dependency gate, but it means a test probe has to
   *use* what it imports — `import { eq } from 'drizzle-orm'` alone produces no
   edge at all, and the rule looks broken when it is fine.
2. **A package the resolver cannot follow has no path.** `resolved` is normally
   `node_modules/<pkg>/…`, but for a package the resolver cannot enter it is the
   bare specifier with no slashes — `octokit` and `p-queue` are both in that
   state today. A rule written as `/fastify/` matches the first form and misses
   the second, so match packages as `(^|/)<name>(/|$)` via the config's `pkg()`
   helper. `core-resolves-everything` exists to close this class for ring 1,
   where a missed import is worst; it is scoped to ring 1 because ring 3 has
   pre-existing unresolvables.

**Adding a rule:** write it, run `pnpm arch`, then **prove it fires** — introduce
the violation it targets (with the binding actually used), confirm the rule name
appears, revert. A rule that never fired has not been tested. If a real
violation already exists, add a `pathNot` entry naming the exact file and a row
to §12 — never widen a glob to make the gate quiet, and never call the gate green
on anything but exit 0.

---

## 11. Anti-patterns

| Smell | Why it hurts | Fix |
|---|---|---|
| `drizzle-orm` imported by `routes.ts` | tenancy scoping and the test seam both bypassed | a repository method (§5) |
| `new OctokitGitHubClient(token)` in a service | the service can no longer be tested without a real token | `await container.github()` (§4) |
| `container.db` read by a service | ring 2 doing ring 3's job, one line from inline SQL | pass `Db` to a repository (§4) |
| A `db.select()` chain or `SQL` fragment in a return type | business logic welded to today's ORM | return rows or DTOs (§5) |
| A transaction handle as a parameter | the "abstraction" now leaks transaction scope | keep the transaction inside the repository (§5) |
| `FastifyRequest` in a service signature | ring 5 leaking inward; untestable without a request | pass the values needed (§6) |
| `modules/A` importing `modules/B` | slices stop being independently deletable | `container.<sharedRepo>` (§4) |
| A facade re-declaring a delegated signature | two copies drift; `TS2353` points at the call sites | derive the type (§3) |
| A re-export shim making one symbol importable from three paths | nobody can tell which import is canonical | import from the owning package (§12) |
| `fetch`, `fs` or a DB call in `reviewer-core` | tenet 4 gone; the core needs infrastructure to run | take it as a parameter (§7) |
| `@devdigest/reviewer-core/review/run.js` imported directly | the barrel stops being the public API | import from the package root (§7) |
| A port named after its library (`OctokitClient`) | the name has to change when the library does | name the capability (§3) |
| An `AppError` thrown from ring 1 | the core now knows the server's error hierarchy | throw the caller's error (§7) |
| A new `findings` query with no index | full scan on a list that polls every 60s | index in the same migration (§5) |
| Gating, sorting or filtering on `findings.confidence` | not calibrated — `1.0` on a hallucination | treat it as prose, not a signal |
| A jsonb-persisted contract field declared `.nullable()` | every document already on disk is missing the key | `.nullish()` (root `INSIGHTS.md`) |
| A pass-through `service.ts` method that only forwards | layering theatre; no logic added | let the outer ring call inward directly (§2) |
| A slice file with an invented name (`data-access.ts`, `feature-models.ts`) | matched by no `modules/` glob — `pnpm arch` is green because it is not looking | `service.ts` / `helpers.ts`, or ship the glob entries (§13) |
| SQL or `fastify` inside an off-manifest file (`pipeline.ts`, `status.ts`, …) | the same violation §5/§6 forbid, with the gate switched off by the filename | move it to the manifest file that owns it (§13) |
| A cross-slice import the gate allowed | `no-cross-slice-import` only knows the five names in `SLICE_PRIVATE` | still a violation — a green gate is a floor, not a verdict (§13) |
| A new `modules/<name>/routes.ts` absent from `modules/index.ts` | every endpoint 404s; no typecheck, test or gate says a word | one import + one entry, same commit (§13) |

---

## 12. Known violations — debt, not precedent

These predate the rules. They are catalogued because `modules/pulls/routes.ts` is
the most copyable file in the repo, and a new module cloned from it inherits
every one of them. **Do not use these as templates.** Each is also a `pathNot`
entry in `.dependency-cruiser.cjs`, so the list can only shrink.

| Where | Violation | Fix shape |
|---|---|---|
| `modules/pulls/routes.ts` (~25 query sites) | Drizzle in ring 5, including the score/cost rollups and a `findings ⨝ reviews` join | extract `pulls/service.ts` + `pulls/repository.ts` |
| `modules/polling/routes.ts` | `insert().onConflictDoUpdate()` per PR, straight from a handler | same |
| `modules/workspace/routes.ts` | direct `container.db` reads | same |
| `modules/settings/routes.ts`, `settings/feature-models.ts` | same; `feature-models.ts` is service-shaped but does its own reads, and its name keeps it out of the `no-sql-in-service` glob | same, plus rename to `service.ts` |
| `modules/reviews/repository.ts` | facade re-declares `completeAgentRun`'s inline param type | derive it from `repository/run.repo.ts` (§3) |
| `platform/{prompt,grounding,structured}.ts`, `reviews/helpers.ts` | re-export shims — the same symbol is importable from two or three paths | import from `@devdigest/reviewer-core` |
| `modules/{brief,intent}/pipeline.ts`, `conventions/extract-pipeline.ts`, `reviews/{diff-loader,findings}.ts`, `pulls/status.ts` | off-manifest filenames — outside every `modules/` glob, so no gate governs them. Pure today, unpoliced tomorrow | fold into `service.ts`/`helpers.ts`, or add the names to the globs (§13) |
| `modules/pulls/status.ts` | `rollupSeverities` fully written and unit-tested with **zero production callers**, and two docblocks that contradict each other about whether the feature exists | check the call graph before writing a second copy (`server/INSIGHTS.md`) |

---

## 13. The slice file manifest (CRITICAL)

**A slice's filenames are the gate's interface.** Every §10 rule scoped to
`modules/` selects files by *name*, never by content: `no-sql-in-service` fires
only on `(service|helpers).ts`, `no-http-below-the-edge` only on
`(service|helpers|repository|run-executor)`, and `no-cross-slice-import` treats
only `(service|repository|routes|helpers|run-executor)` as private
(`SLICE_PRIVATE` in `.dependency-cruiser.cjs`). Invent a filename and the file is
not in a grey area — it is **outside every rule**, and `pnpm arch` stays green
while it does whatever it likes.

Not hypothetical: `modules/settings/feature-models.ts` is service-shaped, imports
`drizzle-orm` and `db/schema` at runtime, and passes the gate — "its name keeps
it out of the `no-sql-in-service` glob" (§12). The gate is a floor made of
filenames, so a reviewer checks the name before trusting the exit code.

**The manifest.** A slice is these files and nothing else:

| File | Ring | Rules that see it |
|---|---|---|
| `routes.ts` | 5 | `no-sql-in-routes`; private to the slice |
| `service.ts` | 2 | `no-sql-in-service`, `no-http-below-the-edge`; private |
| `helpers.ts` | 2 | `no-sql-in-service`, `no-http-below-the-edge`; private |
| `repository.ts`, `repository/<aggregate>.repo.ts` | 3 | `no-http-below-the-edge`; private |
| `constants.ts` | 2 | **public** — literals, importable across slices |
| `types.ts` | 0 · 2 | **public** — facade interfaces, importable across slices |

`modules/index.ts` is the registry and `modules/_shared/**` the shared edge
helpers; neither is a slice.

**A file whose name is not on that list is a gate change, not a file change.**
Three edits in the same commit, or do not add the file:

1. Add the new name to every `from.path` glob in `.dependency-cruiser.cjs` whose
   rule should govern it — at minimum `no-sql-in-service` and
   `no-http-below-the-edge` for anything ring-2-shaped.
2. Add it to `SLICE_PRIVATE` unless it is genuinely public. `constants.ts` and
   `types.ts` are the only public names; everything else is private.
3. **Prove each edited rule fires** (§10): introduce the violation with the
   binding actually used, watch the rule name appear, revert.

**Prefer not to.** `service.ts` and `helpers.ts` hold everything a ring-2 file
can hold and are already covered. The existing off-manifest files —
`*/pipeline.ts`, `conventions/extract-pipeline.ts`, `reviews/diff-loader.ts`,
`reviews/findings.ts`, `pulls/status.ts` — are tolerated only because they are
pure and import no SQL today. Every one of them is unpoliced, so the first person
to add a query to one gets no warning from any gate (§12).

**Renaming is the fix, never a `pathNot` entry.** `feature-models.ts` →
`service.ts` puts the file under `no-sql-in-service` the moment it lands. §10
forbids widening a glob to keep the gate quiet; choosing a filename no glob
matches is the same move with extra steps.

**A slice is dead until `modules/index.ts` names it.** A new `routes.ts`
exporting a Fastify plugin mounts nothing until it gets one import and one entry
there — registration is static and `@fastify/autoload` is a decoy (§6). Nothing
fails on the way: typecheck passes, `pnpm arch` passes, and every endpoint 404s.
Adding a slice is therefore always **two files minimum**, and the review is not
done until the registry diff is in it.

---

## Related

| Skill | Owns |
|---|---|
| `fastify-best-practices` | how to write the hook, the schema, the plugin |
| `drizzle-orm-patterns` | how to write the query, the relation, the migration |
| `postgresql-table-design` | column types, indexes, constraints |
| `zod` | schema authoring, parsing, error handling |
| `frontend-ui-architecture` | the same question for `client/` |

Read `server/INSIGHTS.md` and the root `INSIGHTS.md` before any non-trivial
change — several of the rules above exist because something already went wrong.

---

## Changelog

| Version | Date | Change |
|---|---|---|
| 1.1.0 | 2026-08-18 | §13 — the slice file manifest: the `modules/` gate rules select by filename, so an off-manifest name is outside every rule; adding one is a `.dependency-cruiser.cjs` change. Plus the registry rule (a slice is dead until `modules/index.ts` names it), §11 rows and the §12 off-manifest debt row. |
| 1.0.0 | 2026-08-02 | Initial. Sources and provenance in `README.md`; annotated research and the conflicts between sources in `RESEARCH.md`. |
