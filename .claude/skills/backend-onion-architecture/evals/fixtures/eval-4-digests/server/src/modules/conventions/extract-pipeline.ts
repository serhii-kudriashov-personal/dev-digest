import type { Container } from '../../platform/container.js';

export interface ConventionCandidate {
  title: string;
  evidenceFiles: string[];
}

/**
 * A2 — conventions extraction pipeline. Walks the indexed repo and proposes
 * convention candidates for a human to accept.
 */
export async function extractConventionCandidates(
  container: Container,
  workspaceId: string,
  repoId: string,
): Promise<ConventionCandidate[]> {
  const intel = container.repoIntel;
  const map = await intel.repoMap(workspaceId, repoId);
  if (map.degraded) return [];
  return map.files.map((f) => ({ title: `pattern in ${f.path}`, evidenceFiles: [f.path] }));
}
