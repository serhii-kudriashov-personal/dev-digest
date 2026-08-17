export { AgentEditor, AgentEditor as default } from "./AgentEditor";
/* The tab list is public: the editor renders the bar from it, and the view that
   owns `?tab=` derives its allowlist from it. Two hand-kept copies drifted once
   (client/INSIGHTS.md 2026-08-16) — there is only one list now. */
export { TABS } from "./constants";
export type { EditorTab } from "./constants";
