import type { CiFile } from "@devdigest/shared";
import { ApiError } from "@/lib/api";
import type { TriggerEvent } from "./constants";

/**
 * Toggle one trigger, refusing to drop the last one (AC-7 — refused, not
 * merely warned). Returns the SAME array reference when refused, so a caller
 * can skip the state update entirely.
 */
export function toggleTrigger(current: TriggerEvent[], value: TriggerEvent): TriggerEvent[] {
  const has = current.includes(value);
  if (has && current.length === 1) return current;
  return has ? current.filter((t) => t !== value) : [...current, value];
}

/**
 * The generated workflow is the only YAML file in the bundle — identified by
 * extension rather than by duplicating the server's exact path, so this
 * keeps working if the path ever changes (AC-3).
 */
export function findWorkflowFile(files: CiFile[]): CiFile | undefined {
  return files.find((f) => f.path.endsWith(".yml") || f.path.endsWith(".yaml"));
}

/** The reported reason for a failed mutation (AC-5) — an `ApiError`'s own
 *  message when there is one, else the caller's translated fallback. */
export function reasonFrom(error: unknown, fallback: string): string {
  return error instanceof ApiError ? error.message : fallback;
}
