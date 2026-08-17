import { ContextView } from "./_components/ContextView";

/* Route: /repos/:repoId/context. Thin entry — the view and its components are
   colocated under _components/, which opts that subtree out of routing. */
export default function ContextPage() {
  return <ContextView />;
}
