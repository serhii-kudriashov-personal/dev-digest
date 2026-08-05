/* CategoryDonut — findings-by-category ring with an integer legend.

   Why not `@devdigest/ui`'s `Donut`: it is built for money. Its `valuePrefix`
   defaults to "$" and it always renders `value.toFixed(2)`, so a count of 96
   comes out as "$96.00" — which is exactly the artifact visible in the design
   mock, where the legend reads "security $52.00". Passing valuePrefix="" removes
   the currency but not the decimals, and `src/vendor/**` is not ours to refactor.

   A ring is ~20 lines of SVG, so the honest option is to draw it here with the
   right formatting. */
"use client";

import React from "react";
import { s } from "./styles";

export interface CategorySegment {
  label: string;
  value: number;
  color: string;
}

export function CategoryDonut({
  segments,
  size = 130,
  stroke = 22,
}: {
  segments: CategorySegment[];
  size?: number;
  stroke?: number;
}) {
  const total = segments.reduce((n, seg) => n + seg.value, 0);
  const r = (size - stroke) / 2;
  const circumference = 2 * Math.PI * r;

  // Running offset so each arc starts where the previous one ended.
  let consumed = 0;

  return (
    <div style={s.donutWrap}>
      <svg width={size} height={size} style={s.donutSvg} role="img">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="var(--bg-hover)"
          strokeWidth={stroke}
        />
        {total > 0 &&
          segments.map((seg) => {
            const fraction = seg.value / total;
            const dash = fraction * circumference;
            const offset = consumed * circumference;
            consumed += fraction;
            return (
              <circle
                key={seg.label}
                cx={size / 2}
                cy={size / 2}
                r={r}
                fill="none"
                stroke={seg.color}
                strokeWidth={stroke}
                strokeDasharray={`${dash} ${circumference - dash}`}
                strokeDashoffset={-offset}
              />
            );
          })}
      </svg>
      <div style={s.legend}>
        {segments.map((seg) => (
          <div key={seg.label} style={s.legendRow}>
            <span style={s.legendSwatch(seg.color)} />
            <span style={s.legendLabel}>{seg.label}</span>
            {/* Integers, no currency — these are finding counts. */}
            <span className="mono tnum" style={s.legendValue}>
              {seg.value}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
