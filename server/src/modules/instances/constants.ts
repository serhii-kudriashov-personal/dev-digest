import type { SecretKey } from '@devdigest/shared';

/**
 * instances slice constants (SPEC-06). Literals only — this file is a slice's
 * PUBLIC surface (`backend-onion-architecture` §13), so anything another slice
 * legitimately needs belongs here rather than in `helpers.ts`.
 */

/** Prefix of the `SecretsProvider` key holding one instance's access token. */
export const INSTANCE_SECRET_PREFIX = 'GITLAB_TOKEN_';

/**
 * Where an instance's access token lives — and the ONLY place it lives.
 * `SecretKey` is already open (`string & {}`), so N per-instance keys need no
 * ring-0 change. Never a column, never `AppConfig`, never a response (AC-10).
 */
export function instanceSecretKey(instanceId: string): SecretKey {
  return `${INSTANCE_SECRET_PREFIX}${instanceId}`;
}

/**
 * Hard outer bound on register and test (NFR-1). The adapter keeps its own
 * budget of the same length and normally wins the race; this one exists so the
 * guarantee holds even if a future adapter forgets to.
 */
export const INSTANCE_VERIFY_TIMEOUT_MS = 10_000;

/** Registration verifies against an operator-named host — its own tight limit,
 *  following `modules/ci/routes.ts`'s precedent (`security` §A06). */
export const INSTANCE_REGISTER_RATE_LIMIT = { max: 10, timeWindow: '1 minute' } as const;

/** Testing is cheaper but still an outbound call per press. */
export const INSTANCE_TEST_RATE_LIMIT = { max: 20, timeWindow: '1 minute' } as const;
