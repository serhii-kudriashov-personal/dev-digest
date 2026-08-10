/**
 * The wire shapes this MCP server consumes, plus the runtime guards that check
 * them.
 *
 * Type-only imports from `@devdigest/shared` (the canon at
 * `server/src/vendor/shared`, reached through the tsconfig `paths` alias). A
 * type-only import is not a runtime dependency — that is what makes the alias
 * legal here without creating a third copy of the contracts.
 *
 * ---------------------------------------------------------------------------
 * `McpReview` is NOT a shared contract, and that is deliberate.
 *
 * The body of `GET /pulls/:id/reviews` is `ReviewDto`, declared at
 * `server/src/modules/reviews/helpers.ts:18-32` — a plain interface inside a
 * slice-PRIVATE file. `backend-onion-architecture` §4: "A slice's public surface
 * is its `constants.ts` and its facade `types.ts`. Its `service`, `repository`,
 * `routes`, `helpers` and `run-executor` are private." Importing it from here
 * would reach into another slice's private file across a package boundary, and
 * no gate would catch it (`pnpm arch` does not scan `mcp/`).
 *
 * So this interface declares the narrow shape this client reads, which is what
 * any HTTP client does. The cost: a shape change on the server surfaces at
 * RUNTIME, not at typecheck. Nothing mechanical couples the two — re-check this
 * interface whenever `server/src/modules/reviews/helpers.ts` changes.
 * ---------------------------------------------------------------------------
 */
import type { Agent, ConventionCandidate, Finding, PrMeta, Repo, RunSummary } from '@devdigest/shared';

/**
 * The subset of `ReviewDto` the tools read. `findings` is typed as the SHARED
 * `Finding` — that one really is a contract
 * (`vendor/shared/contracts/findings.ts`) — but only the fields `shape.ts`
 * reads are checked at runtime by `isReviewArray` below.
 */
export interface McpReview {
  run_id: string | null;
  agent_name?: string | null;
  verdict: string | null;
  score: number | null;
  created_at: string;
  findings: Finding[];
}

/** Body of `POST /pulls/:id/review` (`server/src/modules/reviews/routes.ts:43`). */
export interface RunCreated {
  runs: Array<{ run_id: string; agent_name?: string | null }>;
}

/**
 * A tool result, exactly as the MCP `CallToolResult` shape requires.
 *
 * A `type` alias, NOT an `interface`: the SDK's `ResultSchema` is a
 * `z.looseObject`, so `CallToolResult` carries an `[x: string]: unknown` index
 * signature — and an interface is not assignable to one, while a type alias's
 * implicit index signature is. Declaring this as an interface fails typecheck
 * at `server.setRequestHandler(CallToolRequestSchema, …)` with an error that
 * names an unrelated missing `task` property.
 */
export type ToolResult = {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
};

export type { Agent, ConventionCandidate, Finding, PrMeta, Repo, RunSummary };

// ---- Runtime response guards --------------------------------------------
// Hand-rolled on purpose: Zod is a devDependency for TYPE RESOLUTION of the
// shared contract sources only, and must never appear in `mcp/src/**` (see
// `AGENTS.md`). These check the fields actually read and nothing else — a
// malformed engine response must produce an engine-error message, never a
// half-parsed object fed into the model's context.

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export function isReviewArray(value: unknown): value is McpReview[] {
  return (
    Array.isArray(value) &&
    value.every(
      (r) =>
        isRecord(r) &&
        typeof r.created_at === 'string' &&
        Array.isArray(r.findings) &&
        r.findings.every(
          (f) =>
            isRecord(f) &&
            typeof f.severity === 'string' &&
            typeof f.title === 'string' &&
            typeof f.file === 'string' &&
            typeof f.start_line === 'number' &&
            typeof f.end_line === 'number',
        ),
    )
  );
}

export function isAgentArray(value: unknown): value is Agent[] {
  return (
    Array.isArray(value) &&
    value.every((a) => isRecord(a) && typeof a.id === 'string' && typeof a.name === 'string')
  );
}

export function isRepoArray(value: unknown): value is Repo[] {
  return (
    Array.isArray(value) &&
    value.every((r) => isRecord(r) && typeof r.id === 'string' && typeof r.full_name === 'string')
  );
}

export function isPullArray(value: unknown): value is PrMeta[] {
  return Array.isArray(value) && value.every((p) => isRecord(p) && typeof p.number === 'number');
}

export function isRunSummaryArray(value: unknown): value is RunSummary[] {
  return Array.isArray(value) && value.every((r) => isRecord(r) && typeof r.run_id === 'string');
}

export function isConventionsPayload(
  value: unknown,
): value is { candidates: ConventionCandidate[] } {
  return (
    isRecord(value) &&
    Array.isArray(value.candidates) &&
    value.candidates.every(
      (c) => isRecord(c) && typeof c.rule === 'string' && typeof c.status === 'string',
    )
  );
}

export function isRunCreated(value: unknown): value is RunCreated {
  return (
    isRecord(value) &&
    Array.isArray(value.runs) &&
    value.runs.every((r) => isRecord(r) && typeof r.run_id === 'string')
  );
}
