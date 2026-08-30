import type {
  GitInstance,
  GitInstanceInput,
  InstanceRejectionCode,
  InstanceTestResult,
} from '@devdigest/shared';
import type { Container } from '../../platform/container.js';
import { AppError, NotFoundError } from '../../platform/errors.js';
import { TimeoutError, withTimeout } from '../../platform/resilience.js';
import { admitBaseUrl, normalizeBaseUrl } from '../_shared/forge-url.js';
import { INSTANCE_VERIFY_TIMEOUT_MS, instanceSecretKey } from './constants.js';
import { admissionMessage, toInstanceDto } from './helpers.js';
import type { InstancesRepository } from './repository.js';

/**
 * instances slice application logic (SPEC-06 — AC-1…AC-12, AC-45, AC-46).
 *
 * Reads `container.instancesRepo`, `container.secrets` and
 * `container.gitlabInstanceClient` — ports and shared repositories only. It
 * never reaches the raw database handle, which belongs to ring 3
 * (`backend-onion-architecture` §4).
 *
 * TWO INVARIANTS THIS FILE OWNS.
 *
 *  1. **Nothing is registered until it verifies** (AC-1). Registration admits
 *     the base URL, then verifies against the instance, and only persists a row
 *     when both succeed — so "registered" and "usable for import" are the same
 *     state and the import screen needs no second filter.
 *  2. **The access token never lands anywhere but `SecretsProvider`** (AC-10).
 *     It arrives in a request body, is passed to the adapter as an argument,
 *     and is written under `instanceSecretKey(id)`. It is never a column, never
 *     part of a DTO, and never interpolated into a message — every message
 *     below is composed from a code, a host or a status.
 */
export class InstancesService {
  private readonly repo: InstancesRepository;

  constructor(private container: Container) {
    this.repo = container.instancesRepo;
  }

  /**
   * The operator's private-host opt-in (SPEC-06 AC-4), read from config on
   * every use rather than captured in the constructor — a service instance
   * outlives a request, and a security input latched at construction is the
   * shape `server/INSIGHTS.md` 2026-08-28 records going wrong in the adapter.
   *
   * Read from `container.config`, never from `process.env`: config is the one
   * place the environment is parsed (`backend-onion-architecture` §4).
   */
  private get allowedPrivateHosts(): readonly string[] {
    return this.container.config.allowPrivateForgeHosts;
  }

  async list(workspaceId: string): Promise<GitInstance[]> {
    const rows = await this.repo.list(workspaceId);
    return rows.map(toInstanceDto);
  }

  /**
   * Admit → verify → probe → persist → store the token (AC-1…AC-5, AC-7…AC-11).
   *
   * Re-registering an already-registered base URL refreshes that instance's
   * verification and rotates its stored token rather than creating a second
   * row: the base URL is unique per workspace, and the operator's intent when
   * re-submitting one is plainly to replace what is there.
   */
  async register(
    workspaceId: string,
    userId: string,
    input: GitInstanceInput,
  ): Promise<GitInstance> {
    const admitted = normalizeBaseUrl(input.base_url, this.allowedPrivateHosts);
    if (!admitted.ok) {
      throw rejection(admitted.code, admissionMessage(admitted.code, input.base_url));
    }
    const { baseUrl, instanceKey } = admitted.value;

    const verification = await this.verifyOrTimeout({
      baseUrl,
      instanceKey,
      credential: input.credential,
    });
    if (!verification.ok) {
      throw rejection(verification.code ?? 'unreachable', verification.message);
    }

    const { row, created } = await this.repo.insert(workspaceId, {
      provider: 'gitlab',
      baseUrl,
      instanceKey,
      label: input.label,
      version: verification.version,
      edition: verification.edition,
      approvalCapability: verification.approvalCapability,
      verifiedAt: new Date(),
      createdBy: userId,
    });

    if (row.baseUrl !== baseUrl) {
      // The derived key collided with a DIFFERENT base URL's instance. Two
      // instances sharing one key would share a clone directory (AC-17), so
      // this is refused rather than silently aliased.
      throw new AppError(
        'instance_key_conflict',
        `'${row.baseUrl}' is already registered under the same derived key.`,
        409,
      );
    }

    if (!created) {
      await this.repo.recordVerification(workspaceId, row.id, {
        label: input.label,
        version: verification.version,
        edition: verification.edition,
        approvalCapability: verification.approvalCapability,
        verifiedAt: new Date(),
      });
    }

    await this.storeCredential(workspaceId, row.id, input.credential, created);

    const stored = await this.repo.findById(workspaceId, row.id);
    if (!stored) throw new NotFoundError('Instance not found');
    return toInstanceDto(stored);
  }

  /**
   * Re-verify ONE instance and report the outcome (AC-12). Named by
   * `instance_id`, so a screen with several rows can attribute the result to
   * one of them; no other instance's stored state is read or written.
   *
   * The stored base URL is re-admitted before it is used. Reading a column and
   * handing it to the adapter would make the SSRF gate a WRITE-time control
   * only, and a write-time-only control holds exactly as long as `register`
   * stays the single writer of that column — which stops being true the moment
   * repository import writes one. Re-admitting on the read path costs a pure
   * function call and makes the guarantee independent of who wrote the row.
   */
  async test(workspaceId: string, id: string): Promise<InstanceTestResult> {
    const row = await this.repo.findById(workspaceId, id);
    if (!row) throw new NotFoundError('Instance not found');

    const credential = await this.container.secrets.get(instanceSecretKey(row.id));
    if (!credential) {
      return {
        instance_id: row.id,
        ok: false,
        code: 'credential_rejected',
        message: 'No access token is stored for this instance. Register it again to supply one.',
        version: row.version,
        edition: row.edition,
        approval_capability: row.approvalCapability,
      };
    }

    const rejected = admitBaseUrl(row.baseUrl, this.allowedPrivateHosts);
    if (rejected) {
      // A result, not a thrown 422: AC-12 asks for the test result "per
      // registered instance", and an error envelope carries no `instance_id`,
      // so a settings screen showing several rows could not attribute it. The
      // contract already has the slot — `InstanceTestResult.code` is
      // `InstanceRejectionCode.nullable()`, and `private_address` is one of its
      // members — and the missing-credential branch above already answers this
      // way. `register` still throws, because there is no row to attribute to.
      return {
        instance_id: row.id,
        ok: false,
        code: rejected,
        message: admissionMessage(rejected, row.baseUrl),
        version: row.version,
        edition: row.edition,
        approval_capability: row.approvalCapability,
      };
    }

    const verification = await this.verifyOrTimeout({
      baseUrl: row.baseUrl,
      instanceKey: row.id,
      credential,
    });

    if (verification.ok) {
      await this.repo.recordVerification(workspaceId, row.id, {
        version: verification.version,
        edition: verification.edition,
        approvalCapability: verification.approvalCapability,
        verifiedAt: new Date(),
      });
    }

    return {
      instance_id: row.id,
      ok: verification.ok,
      code: verification.code,
      message: verification.message,
      version: verification.version ?? row.version,
      edition: verification.edition ?? row.edition,
      // A failed test says nothing new about the capability, so the recorded
      // value stands rather than degrading to a guess (AC-8, AC-9).
      approval_capability: verification.ok
        ? verification.approvalCapability
        : row.approvalCapability,
    };
  }

  async remove(workspaceId: string, id: string): Promise<void> {
    const removed = await this.repo.remove(workspaceId, id);
    if (!removed) throw new NotFoundError('Instance not found');
    // Best effort: an instance nobody can address should not leave a usable
    // token behind on disk. `set` is optional on the port, and a failure here
    // must not turn a successful delete into a 500.
    try {
      await this.container.secrets.set?.(instanceSecretKey(id), '');
    } catch {
      /* the row is gone; a stale entry is inert */
    }
    this.container.invalidateSecretCaches();
  }

  /**
   * The hard NFR-1 bound. The adapter keeps its own budget and normally returns
   * first; a timeout here is mapped onto the same typed shape as any other
   * failure so callers have one thing to branch on.
   */
  private async verifyOrTimeout(input: {
    baseUrl: string;
    instanceKey: string;
    credential: string;
  }) {
    try {
      return await withTimeout(
        this.container.gitlabInstanceClient.verify(input),
        INSTANCE_VERIFY_TIMEOUT_MS,
      );
    } catch (err) {
      if (err instanceof TimeoutError) {
        return {
          ok: false as const,
          code: 'unreachable' as const,
          message: 'The instance did not answer within 10 seconds.',
          version: null,
          edition: null,
          approvalCapability: 'unknown' as const,
          login: null,
        };
      }
      throw err;
    }
  }

  /** Write the token, then drop cached clients so the next resolve sees it. A
   *  failed write must not leave a row that can never be used, so a brand-new
   *  row is rolled back. */
  private async storeCredential(
    workspaceId: string,
    id: string,
    credential: string,
    created: boolean,
  ): Promise<void> {
    if (!this.container.secrets.set) {
      if (created) await this.repo.remove(workspaceId, id);
      throw new AppError(
        'secrets_read_only',
        'The configured secrets backend cannot store an instance access token.',
        500,
      );
    }
    try {
      await this.container.secrets.set(instanceSecretKey(id), credential);
    } catch (err) {
      if (created) await this.repo.remove(workspaceId, id);
      throw err;
    }
    this.container.invalidateSecretCaches();
  }
}

/**
 * One shape for every refusal: a stable error code, the reason in words, and
 * the typed `InstanceRejectionCode` in `details` so a consumer branches on the
 * code instead of matching the prose (`zod` — error-custom-messages). 422,
 * because in every case the operator-supplied base URL or token is what has to
 * change.
 */
function rejection(code: InstanceRejectionCode, message: string): AppError {
  return new AppError('instance_rejected', message, 422, { code });
}
