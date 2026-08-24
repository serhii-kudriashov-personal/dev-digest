/* EvalMetricBar — a run-history metric cell as a colored bar plus its
   percentage, so recall vs precision vs citation read apart at a glance.
   Shared by the agent Evals tab and the cross-agent Eval Dashboard (L06). */
import { s } from "./styles";

export function EvalMetricBar({
  value,
  color,
  dash,
}: {
  value: number | null;
  color: string;
  dash: string;
}) {
  if (value === null) return <span>{dash}</span>;
  const pct = Math.max(0, Math.min(100, Math.round(value * 100)));
  return (
    <span style={s.cell}>
      <span style={s.track}>
        <span style={{ ...s.fill, width: `${pct}%`, background: color }} />
      </span>
      <span style={s.value}>{pct}%</span>
    </span>
  );
}
