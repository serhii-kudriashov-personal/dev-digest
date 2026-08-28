import type { FindingActionKind } from '@devdigest/shared';
import { AppError, NotFoundError } from '../../platform/errors.js';
import type { ReviewRepository } from './repository.js';
import { findingRowToDto, type ReviewDtoFinding } from './helpers.js';

/**
 * Finding actions available in the starter: accept / dismiss / learn. `learn`
 * (SPEC-05 AC-43) records the intent only — the memory mechanics behind it are
 * a later feature (spec §Non-goals). `reply` is intentionally NOT handled here
 * and falls through to `invalid_action` (Open question 4).
 */
export async function actOnFinding(
  repo: ReviewRepository,
  workspaceId: string,
  findingId: string,
  action: FindingActionKind,
): Promise<{ finding: ReviewDtoFinding }> {
  const ctx = await repo.findingContext(findingId);
  if (!ctx || ctx.pull.workspaceId !== workspaceId) {
    throw new NotFoundError('Finding not found');
  }

  switch (action) {
    case 'accept': {
      const row = await repo.setFindingAccepted(findingId, new Date());
      return { finding: findingRowToDto(row!) };
    }
    case 'dismiss': {
      const row = await repo.setFindingDismissed(findingId, new Date());
      return { finding: findingRowToDto(row!) };
    }
    case 'learn': {
      const row = await repo.setFindingLearned(findingId, new Date());
      return { finding: findingRowToDto(row!) };
    }
    default:
      throw new AppError('invalid_action', `Action '${action}' is not available in the starter`, 400);
  }
}
