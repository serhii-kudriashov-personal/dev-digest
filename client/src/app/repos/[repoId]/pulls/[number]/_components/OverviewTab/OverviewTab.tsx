"use client";

import React from "react";
import { SectionLabel } from "@devdigest/ui";
import { usePrIntent, useDeriveIntent } from "@/lib/hooks/intent";
import { IntentCard } from "../IntentCard";
import { s } from "./styles";

interface OverviewTabProps {
  /** Null while the PR list is still resolving `number` → id; the hooks no-op. */
  prId: string | null | undefined;
  /** The PR's CURRENT head sha — what a stored intent is judged stale against. */
  headSha: string | null | undefined;
  prBody: string | null | undefined;
}

export function OverviewTab({ prId, headSha, prBody }: OverviewTabProps) {
  const { data: intent, isLoading } = usePrIntent(prId);
  const derive = useDeriveIntent(prId);

  // Derived during render, never stored and never synced by an Effect: it is a
  // pure function of two values already in hand. The server also reports its
  // own `stale`, but recomputing here keeps the badge correct the moment the
  // PR's head sha changes in the cache.
  const stale = !!intent?.head_sha && !!headSha && intent.head_sha !== headSha;

  return (
    <>
      <IntentCard
        intent={intent ?? null}
        loading={isLoading}
        stale={stale}
        deriving={derive.isPending}
        onDerive={() => derive.mutate({ force: true })}
      />

      {prBody && (
        <section>
          <SectionLabel icon="MessageSquare">Description</SectionLabel>
          <div style={s.descriptionBox}>{prBody}</div>
        </section>
      )}
    </>
  );
}
