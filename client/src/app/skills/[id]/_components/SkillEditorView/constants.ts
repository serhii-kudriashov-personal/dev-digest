import type { IconName } from "@devdigest/ui";

/** Detail tab descriptor. `labelKey` resolves under the `skills` namespace. */
export interface SkillEditorTab {
  key: string;
  labelKey: string;
  icon: IconName;
}

/**
 * The five tabs from the design, plus `context` (SPEC-01). `evals` renders but
 * is deliberately empty:
 * `eval_cases.owner_kind` already accepts `'skill'`, yet AGENTS.md reserves the
 * `eval_*` tables for a later lesson, so the tab says so rather than pretending.
 */
export const TABS: readonly SkillEditorTab[] = [
  { key: "config", labelKey: "editor.tabs.config", icon: "Settings" },
  { key: "preview", labelKey: "editor.tabs.preview", icon: "FileText" },
  { key: "context", labelKey: "editor.tabs.context", icon: "Folder" },
  { key: "evals", labelKey: "editor.tabs.evals", icon: "ListChecks" },
  { key: "stats", labelKey: "editor.tabs.stats", icon: "BarChart" },
  { key: "versions", labelKey: "editor.tabs.versions", icon: "Clock" },
];

export const DEFAULT_TAB = "config";
export const VALID_TABS = TABS.map((t) => t.key);
