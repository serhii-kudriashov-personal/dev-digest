import { SkillEditorView } from "./_components/SkillEditorView";

/* Route: /skills/:id (skill detail). Thin route entry — SkillEditorView renders
   the five-tab detail INSIDE the library rail, so the list stays visible. */
export default function SkillDetailPage() {
  return <SkillEditorView />;
}
