/* FindingsCell — the PR list's FINDINGS column: per-severity counts, plus the
   shared hover card listing the findings themselves.

   What is specific to the list, and so lives here rather than in the shared
   card: the never-reviewed state (`—`, distinct from a reviewed-and-clean
   `None`), and the lazy fetch. The list endpoint carries only the counts, so
   the card fetches that PR's reviews when it opens (cached by TanStack
   afterwards) rather than widening GET /repos/:id/pulls with a payload nobody
   sees until they point at it. See specs/findings-by-severity.md. */
"use client";

import React from "react";
import type { PrMeta } from "@/lib/types";
import { usePrReviews } from "@/lib/hooks/reviews";
import { FindingsHoverCard, SeverityBadges } from "@/components/findings-hover-card";
import { s as listStyles } from "../../styles";
import { s } from "./styles";

export function FindingsCell({ pr }: { pr: PrMeta }) {
  const [open, setOpen] = React.useState(false);

  const counts = pr.findings_by_severity ?? null;
  const total = counts ? counts.CRITICAL + counts.WARNING + counts.SUGGESTION : 0;

  // Gated on the card actually opening, so brushing past a row costs no request.
  const { data: reviews, isLoading } = usePrReviews(open && pr.id ? pr.id : null);
  const findings = React.useMemo(() => (reviews ?? []).flatMap((r) => r.findings), [reviews]);

  // Never reviewed: no counts, nothing to hover, and not a tab stop either.
  if (counts == null) {
    return (
      <div style={s.cell}>
        <span style={listStyles.muted}>—</span>
      </div>
    );
  }

  return (
    <FindingsHoverCard
      findings={findings}
      total={total}
      loading={isLoading}
      disabled={total === 0}
      onOpenChange={setOpen}
      anchorStyle={s.cell}
    >
      <SeverityBadges counts={counts} noneStyle={listStyles.muted} />
    </FindingsHoverCard>
  );
}

export default FindingsCell;
