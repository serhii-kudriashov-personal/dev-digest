"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { SectionLabel, Button, Chip } from "@devdigest/ui";
import { DiffViewer, useDiffLineTarget, type DiffCommentApi } from "@/components/diff-viewer";
import { usePrComments, useCreatePrComment, usePrReviews } from "@/lib/hooks/reviews";
import { useSmartDiff } from "@/lib/hooks/smart-diff";
import { notify } from "@/lib/toast";
import type { FindingRecord, PrFile } from "@devdigest/shared";
import { SmartDiffViewer } from "../SmartDiffViewer";

interface DiffTabProps {
  prId: string | null;
  filesCount: number;
  files: PrFile[];
  /** Inline commenting is offered only on open PRs (GitHub rejects otherwise). */
  canComment?: boolean;
  /**
   * The reader clicked a severity chip on a diff line. Opening the card is the
   * PAGE's business — it knows the route and does the `window.open` into a new
   * browser tab — so this tab only reports which finding was clicked.
   */
  onGoToFinding?: (finding: FindingRecord) => void;
  /**
   * `<path>:<line>` handed over from another tab (the Blast Radius card's caller
   * rows). `PrDetailView` reads it from the URL and owns clearing it.
   */
  goto?: string | null;
  /** Called once the target has been handed to the viewer, so the param clears. */
  onGotoConsumed?: () => void;
}

export function DiffTab({
  prId,
  filesCount,
  files,
  canComment,
  onGoToFinding,
  goto,
  onGotoConsumed,
}: DiffTabProps) {
  const t = useTranslations("brief");
  const { data: comments } = usePrComments(prId);
  const create = useCreatePrComment(prId);
  // Ordering comes from the smart-diff endpoint; the findings the chips and
  // badges render come from `usePrReviews`, which every review action already
  // invalidates. Nothing invalidates `["smart-diff", prId]` — see the hook.
  const { data: smart } = useSmartDiff(prId);
  const { data: reviews } = usePrReviews(prId);
  // Comments start hidden so the diff is clean by default — toggle to reveal.
  const [showComments, setShowComments] = React.useState(false);
  const [smartOrder, setSmartOrder] = React.useState(true);

  const commentCount = comments?.length ?? 0;
  // Derived during render — no state, no Effect.
  const findings = (reviews ?? []).flatMap((r) => r.findings);
  const additions = files.reduce((sum, f) => sum + (f.additions ?? 0), 0);
  const deletions = files.reduce((sum, f) => sum + (f.deletions ?? 0), 0);

  const commenting: DiffCommentApi = {
    comments: comments ?? [],
    canComment: !!canComment && !!prId,
    showComments,
    posting: create.isPending,
    onSubmit: async (input) => {
      try {
        const res = await create.mutateAsync(input);
        setShowComments(true); // a just-posted comment shouldn't stay hidden
        return res;
      } catch (err) {
        notify.error(err instanceof Error ? err.message : "Couldn't post the comment to GitHub.");
        throw err;
      }
    },
  };

  // Ordering is ENRICHMENT: while it is loading or failed, the plain diff still
  // renders. A reviewer never loses the diff because a sort could not be built.
  const showSmart = smartOrder && !!smart;

  // This tab owns the card-open + scroll-to-line instance, because it renders
  // whichever viewer applies — so a target set from either order mode lands.
  const lineTarget = useDiffLineTarget();

  // The Effect below must fire on a NEW `goto` and on nothing else. `files` is a
  // fresh array on every PR refetch and `onGotoConsumed` is an inline arrow from
  // the parent, so both go through refs rather than into the dependency list —
  // reading them there would re-scroll on an unrelated render, and suppressing
  // the lint rule instead would hide exactly that.
  const latest = React.useRef({ files, onGotoConsumed, goTo: lineTarget.goTo });
  latest.current = { files, onGotoConsumed, goTo: lineTarget.goTo };

  // Synchronising with the URL, which is an external system: `?goto=` arrives
  // from another tab and has to become one imperative scroll, then be cleared so
  // the same value can arrive again.
  React.useEffect(() => {
    if (!goto) return;
    // rsplit on the LAST colon: the line number never contains one, a path may.
    const sep = goto.lastIndexOf(":");
    if (sep <= 0) return;
    const path = goto.slice(0, sep);
    const line = Number(goto.slice(sep + 1));
    if (!Number.isInteger(line) || line <= 0) return;
    // No card exists for a file outside this PR's diff — nothing to open.
    if (!latest.current.files.some((f) => f.path === path)) return;
    latest.current.goTo(path, line);
    latest.current.onGotoConsumed?.();
  }, [goto]);

  return (
    <section>
      <SectionLabel
        icon="Code"
        right={
          <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
            {commentCount > 0 && (
              <Button
                kind="ghost"
                size="sm"
                icon={showComments ? "EyeOff" : "Eye"}
                onClick={() => setShowComments((v) => !v)}
              >
                {showComments ? "Hide comments" : "Show comments"} ({commentCount})
              </Button>
            )}
            <Chip active={smartOrder} onClick={() => setSmartOrder(true)}>
              {t("smartDiff.order.smart")}
            </Chip>
            <Chip active={!smartOrder} onClick={() => setSmartOrder(false)}>
              {t("smartDiff.order.original")}
            </Chip>
          </span>
        }
      >
        {t("smartDiff.title")} · {t("smartDiff.stats", { files: filesCount, additions, deletions })}
      </SectionLabel>
      {showSmart ? (
        <SmartDiffViewer
          groups={smart.groups}
          files={files}
          findings={findings}
          commenting={commenting}
          onFindingClick={onGoToFinding}
          lineTarget={lineTarget}
        />
      ) : (
        <DiffViewer files={files} commenting={commenting} lineTarget={lineTarget} />
      )}
    </section>
  );
}
