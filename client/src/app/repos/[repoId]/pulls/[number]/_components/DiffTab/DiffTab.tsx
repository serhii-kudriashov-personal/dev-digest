"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { SectionLabel, Button, Chip } from "@devdigest/ui";
import { DiffViewer, type DiffCommentApi } from "@/components/diff-viewer";
import { usePrComments, useCreatePrComment, usePrReviews } from "@/lib/hooks/reviews";
import { useSmartDiff } from "@/lib/hooks/smart-diff";
import { notify } from "@/lib/toast";
import type { PrFile } from "@devdigest/shared";
import { SmartDiffViewer } from "../SmartDiffViewer";

interface DiffTabProps {
  prId: string | null;
  filesCount: number;
  files: PrFile[];
  /** Inline commenting is offered only on open PRs (GitHub rejects otherwise). */
  canComment?: boolean;
}

export function DiffTab({ prId, filesCount, files, canComment }: DiffTabProps) {
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
        />
      ) : (
        <DiffViewer files={files} commenting={commenting} />
      )}
    </section>
  );
}
