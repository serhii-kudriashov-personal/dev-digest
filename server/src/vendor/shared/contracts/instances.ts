import { z } from 'zod';

/**
 * Registered forge instances (SPEC-06 — `specs/2026-08-28-gitlab-repositories.md`).
 *
 * An "instance" is one operator-registered forge the workspace may import
 * repositories from: gitlab.com, a self-managed GitLab, or the built-in
 * github.com host. Everything here is ring 0 — Zod schemas over plain data,
 * importing `zod` and nothing else.
 *
 * The one invariant worth stating loudly: `GitInstance` is the shape a response
 * body carries, and it holds NO secret of any kind (AC-10). The access token an
 * instance is registered with lives only in `SecretsProvider`, under a key
 * derived from the instance id, and is never selected, serialized or logged.
 */

/** Which forge a repository (and the instance holding it) belongs to. */
export const RepoProvider = z.enum(['github', 'gitlab']);
export type RepoProvider = z.infer<typeof RepoProvider>;

/**
 * Whether DevDigest may record an approval on this instance.
 *
 * Three states, not two, and `unknown` is load-bearing: GitLab answers 404 both
 * for "not licensed" and for "not permitted" so it never leaks existence, which
 * makes the probe genuinely ambiguous rather than negative. Showing that as
 * "unavailable" would be a confident guess (root `INSIGHTS.md` 2026-08-28).
 */
export const ApprovalCapability = z.enum(['permitted', 'refused', 'unknown']);
export type ApprovalCapability = z.infer<typeof ApprovalCapability>;

/**
 * Why an instance was refused, as a closed set a consumer can branch on.
 *
 * A typed code rather than prose, so AC-3 (a certificate problem), AC-4 (a
 * private address) and AC-45 (a rejected token) stay distinguishable without
 * string-matching a message (`zod` — schema-use-enums / error-custom-messages).
 */
export const InstanceRejectionCode = z.enum([
  /** The base URL is not `https:` (AC-2). */
  'not_https',
  /** The base URL embeds a userinfo component (AC-5). */
  'credentials_in_url',
  /** The host is, or resolves to, a loopback / link-local / private address (AC-4). */
  'private_address',
  /** The TLS chain could not be verified — distinct from unreachable (AC-3). */
  'tls_untrusted',
  /** The instance answered a redirect; it is reported, never followed (AC-11). */
  'cross_origin_redirect',
  /** No usable answer: DNS, connection, timeout, or an unclassifiable failure. */
  'unreachable',
  /** The instance answered, and rejected the supplied token (AC-45). */
  'credential_rejected',
  /** The instance answered, but the API surface DevDigest needs is absent. */
  'capability_missing',
]);
export type InstanceRejectionCode = z.infer<typeof InstanceRejectionCode>;

/**
 * A registered instance as the API reports it.
 *
 * Deliberately has no field for the token it was registered with (AC-10) — see
 * this file's header. `version` and `edition` come from the instance's own
 * metadata endpoint and are null until a verification succeeds; the licensed
 * *tier* is NOT here, because no ordinary integration token can read it.
 */
export const GitInstance = z.object({
  id: z.string(),
  workspace_id: z.string(),
  provider: RepoProvider,
  /** Origin + optional path prefix, normalized, no trailing slash. */
  base_url: z.string(),
  label: z.string(),
  /** e.g. `17.4.1` — from the instance's metadata endpoint, null until verified. */
  version: z.string().nullable(),
  /** The CE/EE codebase flag, NOT the licensed tier (root `INSIGHTS.md` 2026-08-28). */
  edition: z.string().nullable(),
  approval_capability: ApprovalCapability,
  /** ISO-8601 of the last successful verification, null if never verified. */
  verified_at: z.string().nullable(),
  created_at: z.string(),
});
export type GitInstance = z.infer<typeof GitInstance>;

/** `POST /instances` body. The only place in this file a secret appears. */
export const GitInstanceInput = z.object({
  base_url: z.string().url(),
  label: z.string().min(1).max(120),
  /** Write-only access token. Persisted via `SecretsProvider`, never read back. */
  credential: z.string().min(1),
});
export type GitInstanceInput = z.infer<typeof GitInstanceInput>;

/**
 * `POST /instances/:id/test` result (AC-12).
 *
 * Names the instance it belongs to, so a screen rendering several rows can
 * attribute the outcome to one of them and leave the rest untouched. `ok:false`
 * always carries a `code`; `ok:true` carries `code: null`.
 */
export const InstanceTestResult = z.object({
  instance_id: z.string(),
  ok: z.boolean(),
  code: InstanceRejectionCode.nullable(),
  /** Human-readable, safe to display: never echoes the supplied token. */
  message: z.string(),
  version: z.string().nullable(),
  edition: z.string().nullable(),
  approval_capability: ApprovalCapability,
});
export type InstanceTestResult = z.infer<typeof InstanceTestResult>;
