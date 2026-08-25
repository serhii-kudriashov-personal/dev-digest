import { MultiAgentView } from "./_components/MultiAgentView";

/* Route: /repos/:repoId/multi-agent (SPEC-05). Thin route entry — every
   search param, the Configure/Results split and the trace mount live in
   _components/MultiAgentView. */
export default function MultiAgentPage() {
  return <MultiAgentView />;
}
