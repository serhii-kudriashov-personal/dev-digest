import { PullsView } from "./_components/PullsView";

/* Route: /repos/:repoId/pulls (PR list). Thin route entry — the table, its
   filters, helpers and i18n are colocated under _components/PullsView. */
export default function PullsPage() {
  return <PullsView />;
}
