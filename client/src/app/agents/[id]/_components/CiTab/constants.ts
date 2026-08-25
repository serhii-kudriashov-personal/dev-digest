import type { ExportToCiWizardPrefill } from "../ExportToCiWizard";

/**
 * Pre-fill for the trigger/publish-mode fields when opening the wizard from
 * an existing installation's "Update" action. `CiInstallation` (the row this
 * tab renders) persists only `agent_id`, `repo`, `target_type` and
 * `installed_at` (`server/src/db/schema/ci.ts`) — it does NOT carry the
 * triggers or publish mode the operator picked on the original export, so
 * those two fields cannot be genuinely recovered here. They are set to the
 * same defaults `ExportToCiWizard` already falls back to when no `prefill`
 * is given, so "Update" behaves like a fresh export for these two fields;
 * only `repo` reflects a real prior installation (SPEC-05 AC-24, partial —
 * see the implementer's report).
 */
export const DEFAULT_PREFILL_TRIGGERS: ExportToCiWizardPrefill["triggers"] = [
  "opened",
  "synchronize",
  "reopened",
];
export const DEFAULT_PREFILL_POST_AS: ExportToCiWizardPrefill["postAs"] = "github_review";
