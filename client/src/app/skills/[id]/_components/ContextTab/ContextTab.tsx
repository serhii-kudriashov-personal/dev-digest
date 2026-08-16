/* ContextTab — which project documents this skill carries, and in what order.

   Every agent that links this skill inherits these documents, after its own
   directly attached ones. Detaching here is the off switch; there is no
   separate per-agent toggle for the project-context block.

   A near-identical twin of the agent editor's Context tab, and deliberately not
   shared with it: two copies are the correct outcome until a third consumer
   shows what the real abstraction is. What must not be copied ACROSS is the
   handling of a skill BODY — that is house-authored instruction and reaches the
   model as instruction, while a project document is repository content and is
   wrapped as untrusted data. The serialisation panel says so.

   NOTE: no `useState` copy of the attached list. The replace mutation writes the
   new order into the query cache optimistically, so the rendered order is always
   derived from server state. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, Button, Icon, Skeleton } from "@devdigest/ui";
import { DocumentPreview } from "@/components/document-preview";
import { ApiError } from "@/lib/api";
import {
  useContextListing,
  useSetSkillContextDocs,
  useSkillContextDocs,
} from "@/lib/hooks/context";
import { useActiveRepo } from "@/lib/repo-context";
import { filterByPath, missingPaths, orderedPaths, reorder } from "@/lib/context-docs";
import { s } from "./styles";

export function ContextTab({ skillId }: { skillId: string }) {
  const t = useTranslations("context");
  // Documents are repo-relative and a skill is not bound to one repository, so
  // the library shown here is the mirror of the repository currently selected
  // in the shell. What is stored is the path.
  const { repoId, activeRepo } = useActiveRepo();
  const { data: listing } = useContextListing(repoId);
  const { data: attachments, isLoading } = useSkillContextDocs(skillId);
  const setDocs = useSetSkillContextDocs();

  const [search, setSearch] = React.useState("");
  // Ephemeral drag state only.
  const [dragFrom, setDragFrom] = React.useState<number | null>(null);
  const [dragOver, setDragOver] = React.useState<number | null>(null);
  // Which document the preview panel shows. Non-navigating (Design review row
  // 9 / Open question 3): the eye control opens the same read-only preview
  // AC-12 specifies, nothing more.
  const [previewPath, setPreviewPath] = React.useState<string | null>(null);

  if (isLoading) return <Skeleton height={200} />;

  const documents = listing?.state === "ok" ? listing.documents : [];
  const attachedPaths = orderedPaths(attachments);
  const attachedSet = new Set(attachedPaths);
  const missing = missingPaths(attachments);
  const available = filterByPath(
    documents.filter((doc) => !attachedSet.has(doc.path)),
    search,
  );

  const save = (paths: string[]) => setDocs.mutate({ skillId, paths });

  const toggle = (path: string) =>
    save(attachedSet.has(path) ? attachedPaths.filter((p) => p !== path) : [...attachedPaths, path]);

  /** The single reorder path: drag and keyboard both land here. */
  const move = (from: number, to: number) => {
    const next = reorder(attachedPaths, from, to);
    if (next !== attachedPaths) save(next);
  };

  const endDrag = () => {
    if (dragFrom !== null && dragOver !== null) move(dragFrom, dragOver);
    setDragFrom(null);
    setDragOver(null);
  };

  const onMoveKeyDown = (e: React.KeyboardEvent, idx: number) => {
    if (e.key === "ArrowUp") {
      e.preventDefault();
      move(idx, idx - 1);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      move(idx, idx + 1);
    }
  };

  const errorText = !setDocs.isError
    ? null
    : setDocs.error instanceof ApiError
      ? setDocs.error.status === 422
        ? t("limitReached")
        : setDocs.error.message
      : t("saveFailed");

  if (documents.length === 0 && attachedPaths.length === 0) {
    return <div style={s.hint}>{t("tab.empty")}</div>;
  }

  return (
    <div style={s.outer(previewPath !== null)}>
      <div style={s.wrap}>
        <div style={s.header}>
          <h2 style={s.h2}>{t("title")}</h2>
          <Badge color="var(--text-secondary)">{t("tab.count", { count: attachedPaths.length })}</Badge>
          {activeRepo && (
            <span className="mono" style={s.hint}>
              {t("tab.browsing", { repo: activeRepo.full_name })}
            </span>
          )}
          <div style={s.search}>
            <Icon.Search size={12} />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t("tab.filterPlaceholder")}
              style={s.searchInput}
              aria-label={t("tab.filterPlaceholder")}
            />
          </div>
        </div>
        <p style={s.hint}>{t("reorder.hint")}</p>
        {errorText != null && <p style={s.error}>{errorText}</p>}

        {attachedPaths.length > 0 && (
          <div>
            <div style={s.sectionLabel}>{t("tab.attached")}</div>
            {attachedPaths.map((path, idx) => (
              <div
                key={path}
                draggable
                onDragStart={() => setDragFrom(idx)}
                onDragEnter={() => setDragOver(idx)}
                onDragOver={(e) => e.preventDefault()}
                onDragEnd={endDrag}
                onDrop={endDrag}
                style={s.row({ attached: true, dragging: dragFrom === idx, dimmed: missing.has(path) })}
              >
                <span style={s.handle} title={t("reorder.hint")}>
                  <Icon.Menu size={13} />
                </span>
                <span className="mono" style={s.path}>
                  {path}
                </span>
                {missing.has(path) && (
                  <Badge color="var(--crit)" bg="var(--crit-bg)" icon="AlertTriangle">
                    {t("missing")}
                  </Badge>
                )}
                <button
                  type="button"
                  aria-label={t("reorder.up")}
                  style={s.moveBtn}
                  onClick={() => move(idx, idx - 1)}
                  onKeyDown={(e) => onMoveKeyDown(e, idx)}
                >
                  <Icon.ArrowUp size={12} />
                </button>
                <button
                  type="button"
                  aria-label={t("reorder.down")}
                  style={s.moveBtn}
                  onClick={() => move(idx, idx + 1)}
                  onKeyDown={(e) => onMoveKeyDown(e, idx)}
                >
                  <Icon.ArrowDown size={12} />
                </button>
                <Button kind="ghost" size="sm" icon="Eye" onClick={() => setPreviewPath(path)}>
                  {t("preview.action")}
                </Button>
                <Button kind="ghost" size="sm" onClick={() => toggle(path)}>
                  {t("detach")}
                </Button>
                <span style={s.order}>{idx + 1}</span>
              </div>
            ))}
          </div>
        )}

        {available.length > 0 && (
          <div>
            <div style={s.sectionLabel}>{t("tab.available")}</div>
            <p style={s.warning}>{t("attachWarning")}</p>
            {available.map((doc) => (
              <div
                key={doc.path}
                style={s.row({ attached: false, dragging: false, dimmed: false })}
              >
                <span style={s.handleSpacer} />
                <span className="mono" style={s.path}>
                  {doc.path}
                </span>
                {doc.est_tokens != null && (
                  <Badge color="var(--text-secondary)" mono>
                    {t("tokenEstimate", { count: doc.est_tokens })}
                  </Badge>
                )}
                <Button kind="ghost" size="sm" icon="Eye" onClick={() => setPreviewPath(doc.path)}>
                  {t("preview.action")}
                </Button>
                <Button kind="secondary" size="sm" onClick={() => toggle(doc.path)}>
                  {t("attach")}
                </Button>
              </div>
            ))}
          </div>
        )}

        {/* `t.raw`, not `t` — same reason as the agent ContextTab: these mirror
            `assemblePrompt`'s real output, and `<untrusted source="spec-N">`
            parses as a rich-text tag under `t()` and throws INVALID_TAG. */}
        <div style={s.serialization}>
          <span style={s.serializationTitle}>{t("serialization.title")}</span>
          <code className="mono" style={s.serializationCode}>
            {t.raw("serialization.heading")}
          </code>
          <code className="mono" style={s.serializationCode}>
            {t.raw("serialization.wrapper")}
          </code>
          <span style={s.hint}>{t("serialization.note")}</span>
        </div>
      </div>

      {previewPath !== null && (
        <DocumentPreview repoId={repoId} path={previewPath} onClose={() => setPreviewPath(null)} />
      )}
    </div>
  );
}
