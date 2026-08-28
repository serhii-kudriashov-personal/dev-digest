import type { GitInstance, InstanceRejectionCode } from '@devdigest/shared';
import type { GitInstanceRow } from './repository.js';

/**
 * instances slice pure helpers (SPEC-06). No I/O, no DB, no container.
 *
 * The row type comes from this slice's own `repository.ts` rather than from
 * `db/rows.ts`, because nothing outside the slice needs the shape
 * (`server/INSIGHTS.md` 2026-08-25).
 */

/** Map a persisted row to the API DTO. Carries no authentication material by
 *  construction — the table has no column for one (AC-10). */
export function toInstanceDto(row: GitInstanceRow): GitInstance {
  return {
    id: row.id,
    workspace_id: row.workspaceId,
    provider: row.provider,
    base_url: row.baseUrl,
    label: row.label,
    version: row.version,
    edition: row.edition,
    approval_capability: row.approvalCapability,
    verified_at: row.verifiedAt?.toISOString() ?? null,
    created_at: row.createdAt.toISOString(),
  };
}

/**
 * The host an operator typed, for a message that has to name it (AC-4).
 * Returns `null` rather than echoing an unparseable string back at the user.
 *
 * Only ever the HOSTNAME: the submitted URL may carry a username and password
 * (that is AC-5's whole rejection), and repeating the URL would put them in a
 * response — the exact thing AC-10 forbids.
 */
export function hostnameOf(rawUrl: string): string | null {
  try {
    return new URL(rawUrl.trim()).hostname || null;
  } catch {
    return null;
  }
}

/**
 * English for a rejection code, for the codes decided before any request is
 * made. The codes the adapter decides arrive with their own message, which is
 * more specific than anything this table could say.
 */
export function admissionMessage(code: InstanceRejectionCode, rawUrl: string): string {
  const host = hostnameOf(rawUrl);
  switch (code) {
    case 'not_https':
      return 'Only TLS-protected instances are supported: the base URL must start with https://.';
    case 'credentials_in_url':
      return 'The base URL must not contain a username or password. Supply the access token separately.';
    case 'private_address':
      return host
        ? `'${host}' is a loopback, link-local or private address, which DevDigest will not connect to.`
        : 'The base URL names a loopback, link-local or private address, which DevDigest will not connect to.';
    default:
      return host
        ? `'${host}' could not be used as an instance base URL.`
        : 'The base URL could not be used as an instance base URL.';
  }
}
