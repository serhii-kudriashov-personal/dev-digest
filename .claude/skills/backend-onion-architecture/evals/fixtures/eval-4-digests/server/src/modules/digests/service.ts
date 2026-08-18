import type { Container } from '../../platform/container.js';
import type { DigestRow } from '../../db/rows.js';
import type { DigestStore } from './data-access.js';
import { extractConventionCandidates } from '../conventions/extract-pipeline.js';
import { DIGEST_SUMMARY_LIMIT } from './constants.js';

/**
 * L07 — digests service. Assembles the weekly digest for a workspace out of the
 * reviews that closed in the window, plus the conventions the extractor found.
 */
export class DigestsService {
  private store: DigestStore;

  constructor(private container: Container) {
    this.store = container.digestsRepo;
  }

  async list(workspaceId: string, limit: number): Promise<DigestRow[]> {
    return this.store.listForWorkspace(workspaceId, limit);
  }

  async get(workspaceId: string, id: string): Promise<DigestRow | undefined> {
    return this.store.findById(workspaceId, id);
  }

  async publish(workspaceId: string, id: string): Promise<{ published: boolean }> {
    const digest = await this.store.findById(workspaceId, id);
    if (!digest) return { published: false };
    await this.store.markPublished(workspaceId, id, new Date());
    return { published: true };
  }

  async summarizeConventions(workspaceId: string, repoId: string): Promise<string[]> {
    const candidates = await extractConventionCandidates(this.container, workspaceId, repoId);
    return candidates.slice(0, DIGEST_SUMMARY_LIMIT).map((c) => c.title);
  }
}
