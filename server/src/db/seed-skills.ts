import type { SkillSource, SkillType } from '@devdigest/shared';

/**
 * Built-in skill library used by the seed (L02).
 *
 * A skill is a reusable instruction block. `assemblePrompt` renders the enabled
 * ones an agent links to as the `## Skills / rules` section of the review
 * prompt, in `agent_skills.order`.
 *
 * Two rules every body here follows, both learned the hard way:
 *
 *  - **State the severity.** Root `INSIGHTS.md` (2026-08-02) recorded a rule that
 *    omitted it coming back CRITICAL, and since the verdict is a pure function of
 *    "any CRITICAL exists", that alone flipped a run to `request_changes`.
 *  - **Add one rule at a time.** The same entry measured a second prompt block
 *    making a review WORSE (it crowded out findings the previous run caught), so
 *    these are small and single-purpose rather than one big rubric.
 */

export interface SeedSkill {
  name: string;
  description: string;
  type: SkillType;
  source: SkillSource;
  body: string;
  /** Recorded against version 1, so the Versions tab is never blank on a fresh seed. */
  versionMessage: string;
}

export const SEED_SKILLS: SeedSkill[] = [
  {
    name: 'pr-quality-rubric',
    versionMessage: 'Initial rubric',
    description:
      'Use when scoring overall PR quality, to weigh correctness over style and keep scores comparable between runs.',
    type: 'rubric',
    source: 'manual',
    body: `## PR quality rubric

Weigh findings in this order; a lower-priority issue never outranks a
higher-priority one in the summary.

1. Correctness and data integrity
2. Security and authorization
3. Contract stability for existing callers
4. Test coverage of the changed behaviour
5. Readability and naming

Report a **SUGGESTION** for anything in bands 4-5 that has no functional
consequence. Do not raise style to WARNING to make a review look thorough.`,
  },
  {
    name: 'no-then-chains',
    versionMessage: 'Initial async-style convention',
    description:
      'Use when reviewing asynchronous JavaScript or TypeScript, to flag promise chains that should be async/await.',
    type: 'convention',
    source: 'manual',
    body: `## Async style

This codebase uses \`async\`/\`await\` throughout. In changed code, flag:

- \`.then()\` / \`.catch()\` chains where \`await\` with \`try\`/\`catch\` reads plainly.
- \`.forEach()\` with an async callback — the promises are never awaited, so errors
  are unhandled and ordering is not what the code implies. Use \`for...of\` with
  \`await\`, or \`Promise.all\` over a \`map\`.
- A floating promise: any async call whose result is neither awaited nor returned.

Report a **SUGGESTION** for a plain \`.then()\` chain that is otherwise correct.
Report a **WARNING** for an async \`forEach\` or a floating promise — those are
behavioural bugs, not style.`,
  },
  {
    name: 'secret-leakage-gate',
    versionMessage: 'Initial secret-leakage gate',
    description:
      'Use when a diff may introduce credentials in source, config, logs, or client-visible code.',
    type: 'security',
    source: 'manual',
    body: `## Secret leakage

Flag any credential that reaches source control, a log line, or the browser:

- Literal keys and tokens: \`sk_live\`, \`sk-\`, \`service_role\`, \`ghp_\`, AWS access
  key ids, private-key PEM blocks, connection strings with an inline password.
- A secret under a \`NEXT_PUBLIC_\` name, or any secret read in client-side code —
  that ships to the browser.
- A secret written to a log, an error message, a trace, or an analytics event.
- A secret committed to \`.env\`, a fixture, a snapshot, or a test file.

In this repo secrets come from \`SecretsProvider\` (\`~/.devdigest/secrets.json\`)
only — never the DB, never \`AppConfig\`, never a commit.

Report a **CRITICAL** for a live or plausibly live credential, and for any secret
exposed to the browser. Report a **WARNING** for an obvious placeholder or dummy
value that still belongs in the secrets provider.`,
  },
  {
    name: 'lethal-trifecta',
    versionMessage: 'Initial trifecta data-flow rule',
    description:
      'Use when reviewing code that handles untrusted input alongside private data and any outbound call.',
    type: 'security',
    source: 'manual',
    body: `## The lethal trifecta

A serious exfiltration risk needs three things in one reachable path:

1. **Private data** — secrets, tokens, user records, repo contents.
2. **Untrusted input** — a request body or query, a PR title or description, a
   file's contents, model output, a webhook payload.
3. **An exfiltration path** — an outbound \`fetch\`, a webhook, a redirect, a
   shell command, an email, a log shipped off-box.

Trace the data flow before reporting. Name all three components and the line
where each appears; if you cannot find all three, you do not have a trifecta
finding.

A URL taken from untrusted input and passed to \`fetch\` is SSRF: it can reach
internal addresses and cloud metadata endpoints. \`fetch(process.env.API_URL)\` is
safe; \`fetch(req.body.url)\` is not.

Report a **CRITICAL** when all three components are present in one path. Report a
**WARNING** when two are present and the third is plausible but not shown in the
diff.`,
  },
  {
    name: 'phantom-api-gate',
    versionMessage: 'Initial phantom-API gate',
    description:
      'Use when a diff calls a method, field, option, or package that may not exist, to catch invented APIs.',
    type: 'security',
    source: 'manual',
    body: `## Phantom APIs

Code that calls something which does not exist fails at run time, and it is easy
to miss in review because the call reads plausibly.

In changed code, check that every method, option and field is real:

- A method invented on a library object, or one from a different major version.
- A config or option key the library ignores because it is misspelled or renamed.
- An imported package that is not in the relevant \`package.json\` — remember this
  repo is NOT a monorepo: \`server/\`, \`client/\`, \`reviewer-core/\` and \`e2e/\` each
  have their own dependencies, so an import valid in one is not valid in another.
- A cross-package import that does not go through a tsconfig \`paths\` alias.

Report a **CRITICAL** when a call would throw or a module would fail to resolve.
Report a **WARNING** when an option is silently ignored rather than fatal.`,
  },
  {
    name: 'test-coverage-nudge',
    versionMessage: 'Initial coverage rubric',
    description:
      'Use when a diff adds or changes tests, to demand branch, boundary, and failure-path coverage rather than a happy path only.',
    type: 'custom',
    source: 'manual',
    body: `## Test coverage rubric

For every function whose behaviour this diff adds or changes, enumerate the paths
through it and check the tests against that list. Do this explicitly — count the
branches before judging the tests.

**Branches.** Every \`if\`, \`else\`, \`switch\` case, ternary, \`&&\`/\`||\` shortcut,
optional-chain fallback, \`??\` default, and early \`return\` is a branch. A test
suite that exercises only the path where every condition takes its first outcome
has covered ONE branch, however many assertions it makes. Name each branch no
test reaches.

**Boundaries.** For any numeric or size-based condition, the interesting inputs
are at the edge, not in the middle: zero, one, the limit itself, the limit ± 1,
negative, and the maximum. For collections: empty, exactly one element, and more
than the page size. For strings: empty, whitespace only, and over the length cap.

**Failure paths.** Every \`throw\`, rejected promise, non-2xx response, timeout and
validation rejection is behaviour that needs its own test. A suite that never
asserts a failure has not tested the error handling.

**Assertion strength.** A test that asserts only "did not throw", or only a status
code while ignoring the body, passes for a broken implementation. Flag an
assertion that cannot distinguish correct output from wrong output.

**Over-mocking.** When the mock encodes the very logic under test, the test
asserts the mock. Flag a mocked module whose real behaviour is what the test
claims to verify.

**Flakiness.** Flag dependence on wall-clock time, \`Date.now()\`, timezone,
\`Math.random()\`, network availability, filesystem ordering, or the order in which
tests run. In this repo a DB-backed test must be named \`*.it.test.ts\`; one that
touches Postgres under any other name breaks the CI split silently.

Report a **WARNING** for each uncovered branch, missing boundary case, untested
failure path, over-mocked test, or flake risk. Report a **CRITICAL** only when the
untested path can cause a security breach, data loss, or incorrect results in
production. Cite the exact input that would reach the path you say is untested.`,
  },
  {
    name: 'api-contract-gate',
    versionMessage: 'Initial breaking-change checklist',
    description:
      'Use when a diff changes a route, function signature, schema, or exported type, to catch breaking changes to existing callers.',
    type: 'convention',
    source: 'manual',
    body: `## API contract changes

For every changed signature, route, schema or exported type, name the callers and
decide whether each still works. These are breaking, in descending order of harm:

**Removing or renaming** a response field, an exported symbol, a route, or an
enum member a consumer reads.

**Narrowing an input**: a parameter that was optional becoming required, a widened
type becoming specific, a new validation that rejects payloads previously
accepted, a stricter enum.

**Changing meaning without changing shape** — the same field carrying different
units, a different base, or a different null semantic. This is the worst kind,
because nothing fails loudly.

**Changing a response**: its status code, its error shape, pagination, or
nullability. A field going from non-null to nullable breaks every consumer that
does not check.

**Reordering positional parameters** of the same type — callers keep compiling and
start passing the wrong values.

**Persisted-document schemas.** A jsonb column is validated only on read, so
tightening its schema breaks documents ALREADY on disk. In this repo a field added
to a persisted jsonb contract must be \`.nullish()\`, never \`.nullable()\`:
\`.nullable()\` accepts an explicit null but rejects a MISSING key, and every
document written before the change is missing it.

**The duplicated contracts.** \`server/src/vendor/shared\` is canonical and
\`client/src/vendor/shared\` is a manual copy. Each package typechecks in isolation,
so a server-only contract edit leaves the client stale and CI stays green.

Report a **CRITICAL** when you can name an existing caller that breaks — say which
one and how. Report a **WARNING** for a contract risk with no caller you can name,
and for a canonical contract edited without its copy.`,
  },
];
