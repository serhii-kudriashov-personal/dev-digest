import { z } from 'zod';
import { Provider } from './knowledge.js';
import { SeverityCounts } from './findings.js';
import { RepoProvider } from './instances.js';

/**
 * Platform / scaffolding DTOs owned by F1:
 *  - settings (GET/PUT /settings, POST /settings/test-connection)
 *  - repos (POST/GET /repos, refresh, delete)
 *  - pulls (GET /repos/:id/pulls, GET /pulls/:id)
 *  - context (Project Context folder)
 */

// ---- Feature → model selection ----
/** System LLM features whose model is selectable in Settings (per-workspace). */
export const FeatureModelId = z.enum([
  'onboarding',
  'review_intent',
  'risk_brief',
  'conformance',
  'conventions',
]);
export type FeatureModelId = z.infer<typeof FeatureModelId>;

/** A chosen provider + model for one feature. */
export const FeatureModelChoice = z.object({
  provider: Provider,
  model: z.string().min(1),
});
export type FeatureModelChoice = z.infer<typeof FeatureModelChoice>;

/**
 * Registry of the selectable features: stable id, display label, and the
 * built-in default used when the workspace hasn't overridden the choice. The
 * defaults MIRROR each module's constants, so behaviour is unchanged until a
 * model is explicitly picked.
 */
export interface FeatureModelDef {
  id: FeatureModelId;
  label: string;
  description: string;
  defaultProvider: Provider;
  defaultModel: string;
}
export const FEATURE_MODELS: FeatureModelDef[] = [
  {
    id: 'onboarding',
    label: 'Onboarding Tour',
    description: 'Writes the per-repo onboarding tour.',
    defaultProvider: 'openrouter',
    defaultModel: 'deepseek/deepseek-v4-flash',
  },
  {
    id: 'review_intent',
    label: 'PR Review · Intent',
    description: 'Derives a PR’s intent and scope before review.',
    defaultProvider: 'openrouter',
    // The DATED snapshot, deliberately, not the `-latest` alias: an alias moves
    // its target underneath the eval tables and the price book, which makes a
    // cost or quality regression unattributable. Note this is a DIFFERENT and
    // cheaper model than the bare `deepseek/deepseek-v4-flash` above.
    defaultModel: 'deepseek/deepseek-v4-flash-0731',
  },
  {
    id: 'risk_brief',
    label: 'Risk Brief',
    description: 'Assesses merge risks for a pull request.',
    defaultProvider: 'openai',
    defaultModel: 'gpt-4.1',
  },
  {
    id: 'conformance',
    label: 'Conformance',
    description: 'Checks a PR against the project spec.',
    defaultProvider: 'openai',
    defaultModel: 'gpt-4.1',
  },
  {
    id: 'conventions',
    label: 'Conventions',
    description: 'Extracts coding conventions from the repo.',
    defaultProvider: 'openai',
    defaultModel: 'gpt-5.4',
  },
];

// ---- Settings ----
/**
 * Non-secret prefs/config. Secrets (API keys) are NOT stored here — they go
 * through SecretsProvider (.env in MVP). Settings is a flat key/value bag,
 * surfaced as a typed object for the well-known keys.
 */
export const SettingsKnown = z.object({
  polling_interval_min: z.number().int().min(1).default(5),
  theme: z.enum(['dark', 'light']).default('dark'),
  density: z.enum(['regular', 'compact']).default('regular'),
  sync_to_folder: z.boolean().default(true),
  automatic_reviews: z.boolean().default(false),
  /** Per-feature model overrides (provider+model), keyed by FeatureModelId. */
  feature_models: z.record(FeatureModelId, FeatureModelChoice).default({}),
});
export type SettingsKnown = z.infer<typeof SettingsKnown>;

/** Full settings payload: well-known keys + arbitrary extras. */
export const Settings = SettingsKnown.passthrough();
export type Settings = z.infer<typeof Settings>;

export const SettingsUpdate = Settings.partial();
export type SettingsUpdate = z.infer<typeof SettingsUpdate>;

// ---- Connection test ----
export const ConnTestProvider = z.enum(['openai', 'anthropic', 'openrouter', 'github']);
export type ConnTestProvider = z.infer<typeof ConnTestProvider>;

export const ConnTestRequest = z.object({
  provider: ConnTestProvider,
  /** Optional API key/PAT to persist and then test (BYO key from the UI). */
  key: z.string().min(1).optional(),
});
export type ConnTestRequest = z.infer<typeof ConnTestRequest>;

export const ConnTestResult = z.object({
  provider: ConnTestProvider,
  ok: z.boolean(),
  message: z.string(),
  detail: z.unknown().optional(),
});
export type ConnTestResult = z.infer<typeof ConnTestResult>;

// ---- Secrets status (which provider keys are configured; never the values) ----
/** Boolean per provider: true ⇒ a key/PAT is stored. The value is never exposed. */
export const SecretsStatus = z.object({
  openai: z.boolean(),
  anthropic: z.boolean(),
  openrouter: z.boolean(),
  github: z.boolean(),
});
export type SecretsStatus = z.infer<typeof SecretsStatus>;

// ---- Repos ----
export const RepoInput = z.object({
  url: z.string().url(),
});
export type RepoInput = z.infer<typeof RepoInput>;

/**
 * A repository as the API reports it (SPEC-06 — AC-15, AC-19).
 *
 * `owner`, `name` and `full_name` are UNCHANGED and stay meaningful for a
 * GitHub repository: every pre-feature row keeps the values it already has, and
 * no consumer of them had to move (AC-19, AC-27).
 *
 * The provider fields are REQUIRED rather than optional because `Repo` is a
 * table-backed DTO built by `toRepoDto` from columns that all carry a
 * non-volatile `NOT NULL DEFAULT` — not a jsonb document already on disk with
 * the key missing, which is the case root `INSIGHTS.md` 2026-08-11 / 2026-08-02
 * govern. `instance_id` is `.nullable()` and not `.nullish()` for the same
 * reason: it is always serialized, and `null` carries a meaning — the built-in
 * github.com host, which is not a registered instance row.
 */
export const Repo = z.object({
  id: z.string(),
  workspace_id: z.string(),
  owner: z.string(),
  name: z.string(),
  full_name: z.string(),
  default_branch: z.string(),
  clone_path: z.string().nullable(),
  last_polled_at: z.string().nullable(),
  created_by: z.string().nullable(),
  /** Which forge this repository lives on. */
  provider: RepoProvider,
  /** The registered instance it was imported from; `null` ⇒ github.com. */
  instance_id: z.string().nullable(),
  /**
   * The repository's path within its instance, at any depth —
   * `owner/repo` on GitHub, `group/subgroup/project` on GitLab (AC-13, NFR-4).
   */
  namespace_path: z.string(),
  /** Human-readable name of the owning instance; `github.com` for the built-in host. */
  instance_label: z.string(),
  /** Canonical browser URL for the repository on its own forge. */
  web_url: z.string(),
});
export type Repo = z.infer<typeof Repo>;

// ---- Pull requests ----
export const PrStatus = z.enum(['needs_review', 'reviewed', 'stale', 'open', 'closed', 'merged']);
export type PrStatus = z.infer<typeof PrStatus>;

export const PrMeta = z.object({
  id: z.string().nullish(),
  number: z.number().int(),
  title: z.string(),
  author: z.string(),
  branch: z.string(),
  base: z.string(),
  head_sha: z.string(),
  additions: z.number().int(),
  deletions: z.number().int(),
  files_count: z.number().int(),
  status: PrStatus,
  opened_at: z.string().nullish(),
  updated_at: z.string().nullish(),
  // Latest-review score (list endpoint only; null/absent until reviewed).
  score: z.number().int().nullish(),
  // TOTAL cost of every run against this PR, summed (list endpoint only).
  // Runs with an unknown cost contribute nothing; null when no run has one.
  // See specs/l01-run-cost-badge.md.
  cost_usd: z.number().nullish(),
  // Findings of EVERY review of this PR, tallied by severity (list endpoint
  // only). null = never reviewed; an object of zeros = reviewed and clean.
  // See specs/findings-by-severity.md.
  findings_by_severity: SeverityCounts.nullish(),
});
export type PrMeta = z.infer<typeof PrMeta>;

export const PrFile = z.object({
  path: z.string(),
  additions: z.number().int(),
  deletions: z.number().int(),
  patch: z.string().nullish(),
});
export type PrFile = z.infer<typeof PrFile>;

export const PrCommit = z.object({
  sha: z.string(),
  message: z.string(),
  author: z.string(),
  committed_at: z.string().nullish(),
});
export type PrCommit = z.infer<typeof PrCommit>;

export const IssueMeta = z.object({
  number: z.number().int(),
  title: z.string(),
  body: z.string().nullish(),
  state: z.string(),
});
export type IssueMeta = z.infer<typeof IssueMeta>;

export const PrDetail = PrMeta.extend({
  body: z.string().nullish(),
  files: z.array(PrFile),
  commits: z.array(PrCommit),
  linked_issue: IssueMeta.nullish(),
});
export type PrDetail = z.infer<typeof PrDetail>;

// ---- PR review (inline) comments ----
/**
 * A GitHub PR review comment anchored to a diff line. Mirrors the fields the
 * "Files changed" tab needs to render threads inline; `line` is the position in
 * the current diff (null when GitHub can no longer anchor it → `is_outdated`).
 */
export const PrReviewComment = z.object({
  id: z.number().int(),
  path: z.string(),
  line: z.number().int().nullable(),
  original_line: z.number().int().nullable(),
  side: z.enum(['LEFT', 'RIGHT']),
  body: z.string(),
  user: z.string(),
  created_at: z.string(),
  html_url: z.string(),
  in_reply_to_id: z.number().int().nullable(),
  /** GitHub couldn't anchor it to the current diff (line == null). */
  is_outdated: z.boolean(),
});
export type PrReviewComment = z.infer<typeof PrReviewComment>;

/** Body for POST /pulls/:id/comments (create one inline comment / reply). */
export const PrCommentInput = z.object({
  path: z.string().min(1),
  line: z.number().int().positive(),
  side: z.enum(['LEFT', 'RIGHT']).optional(),
  body: z.string().min(1),
  /** Reply to an existing review comment thread (its comment id). */
  in_reply_to: z.number().int().optional(),
});
export type PrCommentInput = z.infer<typeof PrCommentInput>;

// ---- Project Context ----
export const SpecFile = z.object({
  path: z.string(),
  content: z.string().nullish(),
  size: z.number().int().nullish(),
  updated_at: z.string().nullish(),
});
export type SpecFile = z.infer<typeof SpecFile>;

export const IndexStatus = z.object({
  status: z.enum(['idle', 'cloning', 'parsing', 'embedding', 'done', 'error']),
  pct: z.number().min(0).max(100),
  message: z.string().nullish(),
  chunks_indexed: z.number().int().nullish(),
});
export type IndexStatus = z.infer<typeof IndexStatus>;

// ---- Project Context (SPEC-01) ----
// Markdown discovered in a repo's local mirror under configurable search roots,
// attachable to agents and skills and injected into the `specs` prompt slot.
// `SpecFile` / `IndexStatus` above are the earlier scaffolding and stay as they
// are — `vendor/**` is extend-never-reorganise.

/**
 * One discovered Markdown document, as the list renders it.
 *
 * Every field the mirror may fail to answer for is `.nullish()` so the UI can
 * render "unknown" rather than a fabricated zero: a document whose `stat()`
 * failed has an unknown size, not a size of 0.
 */
export const ContextDocument = z.object({
  /** Repo-relative posix path, e.g. `packages/api/docs/auth.md`. */
  path: z.string(),
  /** The directory part of `path` — rendered as the row's secondary line. */
  dir: z.string(),
  /** Label of the FIRST configured root that matched this path. */
  root: z.string(),
  size: z.number().int().nullish(),
  updated_at: z.string().nullish(),
  /** Local tiktoken estimate over the TRUNCATED text; never a model call. */
  est_tokens: z.number().int().nullish(),
  /** The document is longer than the per-document injection cap. */
  truncated: z.boolean(),
  /** Distinct agents that reach this document, directly or via a skill. */
  agent_count: z.number().int(),
  /** Attached somewhere but no longer present in the mirror. */
  missing: z.boolean(),
});
export type ContextDocument = z.infer<typeof ContextDocument>;

/**
 * The listing, as a discriminated union on `state`. "Not synced" and "nothing
 * matched" are STATES, not errors — the endpoint answers 200 for all three, and
 * the UI renders a different remedy for each.
 */
export const ContextListing = z.discriminatedUnion('state', [
  /** The repository has no local mirror yet. */
  z.object({ state: z.literal('not_synced') }),
  /** A mirror exists, but no document matched the configured roots. */
  z.object({ state: z.literal('no_match'), roots: z.array(z.string()) }),
  z.object({
    state: z.literal('ok'),
    roots: z.array(z.string()),
    documents: z.array(ContextDocument),
    /** Everything that matched, before the list cap. */
    total: z.number().int(),
    /** `documents` was cut at the list cap. */
    truncated: z.boolean(),
    scanned_at: z.string(),
  }),
]);
export type ContextListing = z.infer<typeof ContextListing>;

/** One document's text. Content NEVER rides the list — it is its own request. */
export const ContextDocContent = z.object({
  path: z.string(),
  content: z.string(),
  truncated: z.boolean(),
});
export type ContextDocContent = z.infer<typeof ContextDocContent>;

/** A document attached to an agent or a skill, in injection order. */
export const ContextAttachment = z.object({
  path: z.string(),
  order: z.number().int(),
  /** Attached, but absent from the mirror at the last scan. */
  missing: z.boolean(),
});
export type ContextAttachment = z.infer<typeof ContextAttachment>;

/** Body of `PUT /repos/:id/context/roots` — the per-repository search roots. */
export const ContextRootsUpdate = z.object({
  roots: z.array(z.string().min(1).max(300)).min(1).max(20),
});
export type ContextRootsUpdate = z.infer<typeof ContextRootsUpdate>;

/** Body of `PUT /agents/:id/context-docs` and `PUT /skills/:id/context-docs`. */
export const ContextDocsUpdate = z.object({
  paths: z.array(z.string().min(1)).max(64),
});
export type ContextDocsUpdate = z.infer<typeof ContextDocsUpdate>;

// ---- Run request (review trigger; owned by A2, contract lives here) ----
export const RunRequest = z.object({
  agentId: z.string().optional(),
  all: z.boolean().optional(),
});
export type RunRequest = z.infer<typeof RunRequest>;

// ---- Structured API error envelope (returned by the API; UX taxonomy is FE) ----
export const ApiErrorBody = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.unknown().optional(),
  }),
});
export type ApiErrorBody = z.infer<typeof ApiErrorBody>;
