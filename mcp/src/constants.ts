/**
 * Budgets, caps, deadlines. Every number here has a reason next to it.
 */

/** Fallback when DEVDIGEST_API_BASE is unset. The local engine's default port. */
export const DEFAULT_API_BASE = 'http://localhost:3001';

/** The MCP server name a user sees in their client config. */
export const SERVER_NAME = 'devdigest-mcp';

/** Per-request abort. A slow response must not eat the whole wall-clock budget. */
export const REQUEST_TIMEOUT_MS = 10_000;

/**
 * Hard blocking budget for `run_agent_on_pr`. Measured with a `Date.now()`
 * deadline checked before each poll — NOT a single outer timer, because a
 * per-request timeout is not a wall-clock cap on a loop.
 */
export const DEADLINE_MS = 120_000;

/**
 * Poll interval for `GET /pulls/:id/runs`.
 *
 * `server/src/app.ts:96` registers a GLOBAL limit of 120 requests per minute and
 * `/pulls/:id/runs` carries no per-route override, so every poll counts. At
 * 2000 ms a full 120-second wait is 60 polls — 30/min, a quarter of the budget,
 * leaving room for the 3 resolution calls, the create (itself capped at 10/min),
 * the final read, and a second concurrent tool call. At 1000 ms it would be
 * 60/min and one concurrent call away from a 429 the model cannot fix.
 */
export const POLL_INTERVAL_MS = 2000;

/** Response-side caps. The real token cost is here, not in the definitions. */
export const MAX_FINDINGS = 10;
export const MAX_CONVENTIONS = 40;
export const MAX_TITLE_CHARS = 300;
export const MAX_SUGGESTION_CHARS = 400;
export const MAX_RULE_CHARS = 500;
export const MAX_ERROR_CHARS = 300;

/**
 * Blast-radius caps. The server already bounds its response (50 symbols × 20
 * callers), but that is sized for a UI a human scrolls — a model pays per token,
 * so this client cuts harder and says so with a `truncated` marker.
 */
export const MAX_BLAST_SYMBOLS = 10;
/** 5 is enough to see the shape of the fan-out; `caller_count` carries the rest. */
export const MAX_BLAST_CALLERS_PER_SYMBOL = 5;
/** Endpoints and crons are short strings, so this cap rarely bites. */
export const MAX_BLAST_ENDPOINTS = 10;
/** File paths and symbol names are repo-authored text — `clean()` and cap them. */
export const MAX_BLAST_PATH_CHARS = 300;

/** Argument bounds. Checked before any URL is built. */
export const MAX_REPO_CHARS = 200;
export const MAX_AGENT_CHARS = 200;
export const MAX_PR_NUMBER = 10_000_000;

/**
 * Serialized `tools/list` ceiling, in `cl100k_base` tokens.
 *
 * 1200 rather than ~600 on purpose: the tokenizer is a proxy for Anthropic's and
 * can be off by ~20% either way; a later lesson implementing `get_blast_radius`
 * for real will roughly double that entry; and a ceiling one word above today's
 * number fails on the next honest edit and gets raised reflexively, which is how
 * a gate stops meaning anything.
 */
export const TOOL_DEFINITION_TOKEN_BUDGET = 1200;

/** `instructions` ships in the `initialize` result, not in `tools/list`. */
export const INSTRUCTIONS_TOKEN_BUDGET = 150;
