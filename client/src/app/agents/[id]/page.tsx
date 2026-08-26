import { AgentEditorView } from "./_components/AgentEditorView";

/* Route: /agents/:id (Agent editor). Thin route entry — the agent rail, the
   editor chrome, styles and constants are colocated under
   _components/AgentEditorView. */
export default function AgentEditorPage() {
  return <AgentEditorView />;
}
