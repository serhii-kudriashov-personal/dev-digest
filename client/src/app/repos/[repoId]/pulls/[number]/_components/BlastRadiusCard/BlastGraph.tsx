"use client";

import React from "react";
import { useTranslations } from "next-intl";
import type { DownstreamImpact } from "@devdigest/shared";
import {
  GRAPH_LEFT_X,
  GRAPH_MAX_CALLERS_PER_SYMBOL,
  GRAPH_MAX_SYMBOLS,
  GRAPH_PADDING_Y,
  GRAPH_RIGHT_X,
  GRAPH_ROW_HEIGHT,
  GRAPH_WIDTH,
} from "./constants";
import { s } from "./styles";

/**
 * Changed symbols on the left, their callers on the right, one connector each.
 *
 * Inline SVG rather than a charting library: this is two columns of text and some
 * straight lines, and the repo's one chart primitive (`Donut`) is a money chart.
 * A new dependency for this would be all cost.
 *
 * Capped by `GRAPH_MAX_SYMBOLS` / `GRAPH_MAX_CALLERS_PER_SYMBOL` — the Tree view
 * is where a reviewer reads the full list, and an uncapped SVG grows without
 * bound on a wide PR.
 */
export function BlastGraph({
  downstream,
  onOpenCaller,
  isInDiff,
}: {
  downstream: DownstreamImpact[];
  /** Called when a caller row inside the PR's own diff is activated. */
  onOpenCaller: (path: string, line: number) => void;
  isInDiff: (path: string) => boolean;
}) {
  const t = useTranslations("blast");

  // Derived during render — never stored, never synced by an Effect.
  const nodes = downstream
    .filter((entry) => entry.callers.length > 0)
    .slice(0, GRAPH_MAX_SYMBOLS)
    .map((entry) => ({
      symbol: entry.symbol,
      callers: entry.callers.slice(0, GRAPH_MAX_CALLERS_PER_SYMBOL),
    }));

  if (nodes.length === 0) {
    return <div style={s.graphEmpty}>{t("graph.empty")}</div>;
  }

  // Lay the rows out first, so the connectors can be drawn from real positions.
  let row = 0;
  const laid = nodes.map((node) => {
    const symbolY = GRAPH_PADDING_Y + row * GRAPH_ROW_HEIGHT;
    const callers = node.callers.map((caller, i) => ({
      ...caller,
      y: GRAPH_PADDING_Y + (row + i) * GRAPH_ROW_HEIGHT,
    }));
    row += Math.max(node.callers.length, 1);
    return { symbol: node.symbol, symbolY, callers };
  });
  const height = GRAPH_PADDING_Y * 2 + row * GRAPH_ROW_HEIGHT;

  return (
    <div style={s.graphWrap}>
      <svg
        role="img"
        aria-label={t("graph.ariaLabel")}
        width={GRAPH_WIDTH}
        height={height}
        viewBox={`0 0 ${GRAPH_WIDTH} ${height}`}
      >
        {laid.map((node) => (
          <g key={node.symbol}>
            {node.callers.map((caller) => (
              <line
                key={`${caller.file}:${caller.line}`}
                x1={GRAPH_LEFT_X + 180}
                y1={node.symbolY - 4}
                x2={GRAPH_RIGHT_X - 6}
                y2={caller.y - 4}
                style={s.graphEdge}
              />
            ))}
            <text x={GRAPH_LEFT_X} y={node.symbolY} style={s.graphLabelStrong}>
              {node.symbol}
            </text>
            {node.callers.map((caller) => {
              const label = `${caller.file}:${caller.line}`;
              return isInDiff(caller.file) ? (
                <text
                  key={label}
                  x={GRAPH_RIGHT_X}
                  y={caller.y}
                  style={{ ...s.graphLabel, cursor: "pointer", fill: "var(--accent)" }}
                  onClick={() => onOpenCaller(caller.file, caller.line)}
                >
                  {label}
                </text>
              ) : (
                <text key={label} x={GRAPH_RIGHT_X} y={caller.y} style={s.graphLabel}>
                  {label}
                </text>
              );
            })}
          </g>
        ))}
      </svg>
    </div>
  );
}
