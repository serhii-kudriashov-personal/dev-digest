"use client";

import React from "react";
import { SectionLabel } from "@devdigest/ui";
import type { PrFile } from "@devdigest/shared";
import { usePrIntent, useDeriveIntent } from "@/lib/hooks/intent";
import { useBlastRadius } from "@/lib/hooks/blast";
import { IntentCard } from "../IntentCard";
import { BlastRadiusCard } from "../BlastRadiusCard";
import { s } from "./styles";

interface OverviewTabProps {
  /** Null while the PR list is still resolving `number` → id; the hooks no-op. */
  prId: string | null | undefined;
  /** The PR's CURRENT head sha — what a stored intent is judged stale against. */
  headSha: string | null | undefined;
  prBody: string | null | undefined;
  /** "owner/repo", null until the repo is loaded — for github.com deep-links. */
  repoFullName: string | null;
  /** The PR's changed files: which blast callers can be opened in the Diff tab. */
  files: PrFile[];
  /** Opens the Diff tab at `path:line`; owned by `PrDetailView`, which owns the URL. */
  onOpenCaller: (path: string, line: number) => void;
}

export function OverviewTab({
  prId,
  headSha,
  prBody,
  repoFullName,
  files,
  onOpenCaller,
}: OverviewTabProps) {
  const { data: intent, isLoading } = usePrIntent(prId);
  const derive = useDeriveIntent(prId);
  const { data: blast, isLoading: blastLoading } = useBlastRadius(prId);

  // Derived during render, never stored and never synced by an Effect: it is a
  // pure function of two values already in hand. The server also reports its
  // own `stale`, but recomputing here keeps the badge correct the moment the
  // PR's head sha changes in the cache.
  const stale = !!intent?.head_sha && !!headSha && intent.head_sha !== headSha;

  const changedPaths = React.useMemo(() => new Set(files.map((f) => f.path)), [files]);

  return (
    <>
      <IntentCard
        intent={intent ?? null}
        loading={isLoading}
        stale={stale}
        deriving={derive.isPending}
        onDerive={() => derive.mutate({ force: true })}
      />

      <BlastRadiusCard
        blast={blast}
        loading={blastLoading}
        changedPaths={changedPaths}
        repoFullName={repoFullName}
        headSha={headSha ?? null}
        onOpenCaller={onOpenCaller}
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
