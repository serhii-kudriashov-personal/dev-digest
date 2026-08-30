/* PostBackPanel — what happened when ONE review run was published onto its
   change request, plus the control that publishes it.

   SPEC-06 (`specs/2026-08-28-gitlab-repositories.md`) — AC-38…AC-41, NFR-3,
   NFR-12. Two rules shape the whole component:

   1. The outcome is READ BACK from the server (`usePostBackOutcome`), never held
      only in the mutation's result — NFR-12 asks for it to still be there after
      a reload.
   2. Every word explaining WHY comes from the server's `reason` and is rendered
      verbatim. The client picks the outcome's label and nothing else. That is
      what keeps AC-38 honest (a refused approval is "not an eligible approver",
      not "this instance cannot approve") and AC-41 exact (the `request_changes`
      downgrade is stated by the server, in its own words). It is also how NFR-3's
      note cap gets stated: the server appends the truncation to `reason`. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Icon, Button, SectionLabel } from "@devdigest/ui";
import type { RepoProvider } from "@/lib/types";
import { usePostBackOutcome, usePostReview } from "@/lib/hooks/reviews";
import { POST_BACK_META, RETRYABLE_OUTCOMES } from "./constants";
import { s } from "./styles";

function formatWhen(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}

export function PostBackPanel({
  prId,
  runId,
  provider = "github",
}: {
  prId: string;
  runId: string;
  /** Decides the change-request vocabulary only; every provider posts the same way. */
  provider?: RepoProvider;
}) {
  const t = useTranslations("prReview");
  const { data, isLoading } = usePostBackOutcome(prId, runId);
  const post = usePostReview(prId);

  // Derived during render, never mirrored into state with an Effect
  // (`react-best-practices` — "Derive, Don't Store"): the outcome is a server
  // value, and a copy of it is just a second thing to keep in sync.
  const outcome = data?.outcome ?? null;
  const meta = outcome ? POST_BACK_META[outcome] : null;
  const OutcomeIcon = meta ? Icon[meta.icon] : null;
  const canPost = outcome == null || RETRYABLE_OUTCOMES.includes(outcome);

  return (
    <div style={s.wrap}>
      <SectionLabel
        icon="Upload"
        right={
          canPost ? (
            <Button
              size="sm"
              icon="Upload"
              loading={post.isPending}
              disabled={post.isPending || isLoading}
              onClick={() => post.mutate(runId)}
            >
              {post.isPending
                ? t("postBack.posting", { provider })
                : t(outcome ? "postBack.retry" : "postBack.action", { provider })}
            </Button>
          ) : undefined
        }
      >
        {t("postBack.sectionLabel", { provider })}
      </SectionLabel>

      {data && meta && OutcomeIcon ? (
        <div style={s.outcome}>
          <div style={s.iconBox(meta.bg, meta.c)}>
            <OutcomeIcon size={16} />
          </div>
          <div style={s.body}>
            {/* Exactly ONE outcome line (AC-39). The two "posted" states keep
                their own labels — they differ in whether the verdict took
                effect, which is the distinction `reason` goes on to explain. */}
            <span style={s.label(meta.c)}>
              {t(`postBack.outcome.${data.outcome}`, { provider })}
            </span>
            {/* The server's own words, rendered as they are: the refused-approval
                reason (AC-38), the `request_changes` downgrade (AC-41) and the
                note-cap truncation (NFR-3) all arrive here. */}
            {data.reason && <p style={s.reason}>{data.reason}</p>}
            <span style={s.meta}>
              {t("postBack.notes", { count: data.notes_published, provider })}
              {" · "}
              {t("postBack.recordedAt", { when: formatWhen(data.created_at), provider })}
            </span>
          </div>
        </div>
      ) : isLoading ? null : (
        <p style={s.empty}>{t("postBack.notPostedYet", { provider })}</p>
      )}
    </div>
  );
}

export default PostBackPanel;
