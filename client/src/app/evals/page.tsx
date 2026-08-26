import { EvalDashboardView } from "./_components/EvalDashboardView";

/* Route: /evals (the cross-agent Eval Dashboard, L06/SPEC-04). Thin route
   entry — the interactive view, its styles and helpers are colocated under
   _components/EvalDashboardView (frontend-ui-architecture §9: mark the leaf,
   not the page). */
export default function EvalsPage() {
  return <EvalDashboardView />;
}
