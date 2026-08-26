/**
 * Architecture gate — `pnpm arch`.
 *
 * Machine-checks the ring boundaries described in
 * `.claude/skills/backend-onion-architecture/SKILL.md`. Section references below
 * point at that file.
 *
 *   ring 0  contracts & ports    src/vendor/shared/**
 *   ring 1  pure core            ../reviewer-core/src/**
 *   ring 2  application          src/modules/*&#47;{service,helpers,constants}.ts
 *   ring 3  infrastructure       src/adapters/**, src/db/**, src/modules/*&#47;repository*
 *   ring 4  composition root     src/platform/container.ts, src/platform/config.ts, src/app.ts
 *   ring 5  delivery             src/modules/*&#47;routes.ts
 *
 * Two configuration notes, both load-bearing:
 *
 * - This file is `.cjs` because `server/package.json` is `"type": "module"`.
 *   `depcruise --init` writes `.dependency-cruiser.js`, which will not load here.
 * - `tsPreCompilationDeps` is FALSE. A type-only import is not a runtime
 *   dependency (SKILL §2); with it true, the `$inferSelect` type imports in
 *   `modules/reviews/{diff-loader,run-executor}.ts` register as ring-2 → db
 *   edges and the SQL rules fire on files that emit no import at all.
 *
 * `pathNot` entries tagged KNOWN mirror SKILL §12 — pre-existing debt, not
 * precedent. That list may only ever shrink. Never widen a glob to quiet a hit:
 * either fix the code or add the exact file here with a reason.
 */

/** Files that legitimately live in `src` but are test support, not production. */
const TEST_SUPPORT = 'src/adapters/mocks[.]ts$';

/**
 * Match an npm package by name.
 *
 * Must tolerate BOTH forms `resolved` can take: a real path
 * (`node_modules/drizzle-orm/index.js`, or `node_modules/.pnpm/<v>/node_modules/…`
 * under pnpm) and, when the resolver cannot follow the package, the bare
 * specifier with no slashes at all (`octokit`, `p-queue`).
 *
 * Getting this wrong is silent: a rule written as `/fastify/` matches the
 * resolved form and misses the bare one, so `core-is-pure` would pass a
 * `fastify` import in ring 1 — which is the single most important thing it
 * exists to catch. The trailing `(/|$)` keeps `fastify` from matching
 * `fastify-sse-v2`.
 */
const pkg = (name) => `(^|/)${name}(/|$)`;

const DRIZZLE = pkg('drizzle-orm');
const FASTIFY = pkg('fastify');

/**
 * Concrete adapter implementations the container constructs (SKILL §4).
 * Deliberately NOT the whole `adapters/` tree: `codeindex/extract.ts`,
 * `git/diff-parser.ts` and `astgrep/index.ts` export pure functions, and a
 * module calling those is ring 2 using a library, not resolving a port.
 */
const ADAPTER_IMPLS =
  '^src/adapters/(secrets/|auth/|github/|git/simple-git|codeindex/ripgrep|llm/|embedder/)';

/**
 * A slice's public surface is its `constants.ts` and its facade `types.ts` —
 * literals and interfaces. Its `service`, `repository`, `routes` and `helpers`
 * are private; cross-slice data goes through the container (SKILL §4).
 */
const SLICE_PRIVATE = '^src/modules/[^/]+/(service|repository|routes|helpers|run-executor)';

module.exports = {
  forbidden: [
    {
      name: 'no-sql-in-routes',
      severity: 'error',
      comment:
        'SKILL §6 — routes.ts is HTTP and Zod. SQL belongs in a repository, ' +
        'where workspace scoping lives and where the *.it.test.ts seam is.',
      from: {
        path: '^src/modules/[^/]+/routes[.]ts$',
        pathNot: [
          // KNOWN (SKILL §12) — predates the rule, do not copy.
          '^src/modules/pulls/routes[.]ts$',
          '^src/modules/polling/routes[.]ts$',
          '^src/modules/workspace/routes[.]ts$',
          '^src/modules/settings/routes[.]ts$',
        ],
      },
      to: { path: [DRIZZLE, '^src/db/'] },
    },
    {
      name: 'no-sql-in-service',
      severity: 'error',
      comment:
        'SKILL §5 — service.ts is logic, no SQL. Row types come from db/rows.ts, ' +
        'never db/schema.',
      from: {
        path: '^src/modules/[^/]+/(service|helpers)[.]ts$',
        pathNot: [
          // KNOWN (SKILL §12) — settings/feature-models.ts is service-shaped and
          // does its own reads; its name keeps it outside this glob entirely.
        ],
      },
      to: { path: [DRIZZLE, '^src/db/schema'] },
    },
    {
      name: 'no-http-below-the-edge',
      severity: 'error',
      comment:
        'SKILL §6 — Fastify stays at the edge. A service, repository or adapter ' +
        'that imports fastify cannot be tested without a request.',
      from: {
        path: [
          '^src/modules/[^/]+/(service|helpers|repository|run-executor)',
          '^src/adapters/',
          '^src/db/',
        ],
        pathNot: [TEST_SUPPORT],
      },
      to: { path: FASTIFY },
    },
    {
      name: 'no-adapter-impl-outside-root',
      severity: 'error',
      comment:
        'SKILL §4 — never import a concrete adapter. Take it from the container, ' +
        'or ContainerOverrides stops being a working test seam.',
      from: { path: '^src/modules/', pathNot: [TEST_SUPPORT] },
      to: { path: ADAPTER_IMPLS },
    },
    {
      name: 'no-cross-slice-import',
      severity: 'error',
      comment:
        "SKILL §4 — a slice's logic and SQL are private. Read another slice's " +
        'data through container.<sharedRepo>; import only its constants/types.',
      from: { path: '^src/modules/([^/]+)/' },
      to: {
        path: SLICE_PRIVATE,
        // $1 is the slice name captured in `from.path` — "not to my own slice".
        pathNot: '^src/modules/$1/',
      },
    },
    {
      name: 'core-is-pure',
      severity: 'error',
      comment:
        'SKILL §7 / reviewer-core invariant #1 — zero I/O. Palermo tenet 4: the ' +
        'application core compiles and runs separate from infrastructure.',
      from: { path: '^[.][.]/reviewer-core/src/' },
      to: {
        path: [
          DRIZZLE,
          FASTIFY,
          pkg('postgres'),
          pkg('simple-git'),
          pkg('octokit'),
          pkg('@octokit'),
          pkg('@ast-grep/napi'),
          '^src/db/',
          '^src/adapters/',
        ],
      },
    },
    {
      name: 'core-resolves-everything',
      severity: 'error',
      comment:
        'SKILL §7 — an import ring 1 cannot resolve is a hole in core-is-pure: ' +
        'an unresolvable specifier has no path, so package rules silently miss ' +
        'it. Ring 1 has zero unresolvables today; keep it that way.',
      from: { path: '^[.][.]/reviewer-core/src/' },
      to: { couldNotResolve: true },
    },
    {
      name: 'core-is-pure-node-builtins',
      severity: 'error',
      comment:
        'SKILL §7 — no filesystem, no subprocesses, no sockets in ring 1. Need ' +
        'data? Take it as a parameter.',
      from: { path: '^[.][.]/reviewer-core/src/' },
      to: { path: '^(fs|node:fs|child_process|node:child_process|net|node:net|http|node:http|https|node:https)$' },
    },
    {
      name: 'core-barrel-only',
      severity: 'error',
      comment:
        "SKILL §7 — reviewer-core's public API is src/index.ts. Importing an " +
        'internal path makes the barrel stop being the contract.',
      from: { path: '^src/' },
      to: {
        path: '^[.][.]/reviewer-core/src/.+',
        pathNot: '^[.][.]/reviewer-core/src/index[.]ts$',
      },
    },
    {
      name: 'shared-is-a-leaf',
      severity: 'error',
      comment:
        'SKILL §1 — ring 0 is contracts and ports. It imports zod and nothing ' +
        'else, which is what lets every other ring depend on it.',
      from: { path: '^src/vendor/shared/' },
      to: {
        pathNot: ['^src/vendor/shared/', '/zod/'],
      },
    },
    {
      name: 'no-circular',
      severity: 'error',
      comment: 'A cycle means the two files are one module wearing two names.',
      from: {},
      to: { circular: true },
    },
  ],

  options: {
    doNotFollow: { path: 'node_modules' },
    tsConfig: { fileName: 'tsconfig.json' },
    // See the header: type-only imports are not dependencies (SKILL §2).
    tsPreCompilationDeps: false,
    exclude: { path: ['^src/db/migrations/', '/[.]test[.]ts$'] },
    enhancedResolveOptions: { exportsFields: ['exports'], conditionNames: ['import', 'require', 'node', 'default'] },
  },
};
