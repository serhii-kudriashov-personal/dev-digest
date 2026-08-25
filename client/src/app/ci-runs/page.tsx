import { CiRunsView } from "./_components/CiRunsView";

/* Route: /ci-runs (SPEC-05). Thin route entry — the interactive view, its
   styles and helpers are colocated under _components/CiRunsView
   (frontend-ui-architecture §9: mark the leaf, not the page). */
export default function CiRunsPage() {
  return <CiRunsView />;
}
