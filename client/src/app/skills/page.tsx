import { SkillsListView } from "./_components/SkillsListView";

/* Route: /skills (the skill library). Thin route entry — the rail, its create
   modal, import drawer, styles, helpers and i18n are colocated under
   _components/SkillsListView. With no skill selected the detail side prompts. */
export default function SkillsPage() {
  return <SkillsListView />;
}
