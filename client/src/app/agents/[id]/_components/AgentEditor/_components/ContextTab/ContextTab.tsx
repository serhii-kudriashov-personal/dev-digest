/* ContextTab — which project documents this agent gets, and in what order.

   Structurally a twin of SkillsTab, and deliberately NOT shared with the skill
   editor's Context tab: two copies are the correct outcome until a third
   consumer shows what the real abstraction is.

   What the two tabs do NOT share is their meaning. A skill body is
   house-authored instruction and reaches the model as instruction. A project
   document is repository content written by whoever opened the PR, so it is
   wrapped as untrusted data — which is what the serialisation panel at the
   bottom exists to say out loud.

   NOTE: this component keeps NO copy of the attached list. The replace mutation
   writes the new order into the query cache optimistically, so the rendered
   order is always derived from server state. Adding a `useState` +
   `useEffect([attachments])` pair here would reintroduce the "store derived
   state, then patch it" bug that client/INSIGHTS.md records as CRITICAL. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, Button, Icon, Skeleton } from "@devdigest/ui";
import { DocumentPreview } from "@/components/document-preview";
import { ApiError } from "@/lib/api";
import {
  useAgentContextDocs,
  useContextListing,
  useSetAgentContextDocs,
} from "@/lib/hooks/context";
import { useActiveRepo } from "@/lib/repo-context";
import { filterByPath, missingPaths, orderedPaths, reorder } from "@/lib/context-docs";
import { s } from "./styles";

export function ContextTab({ agentId }: { agentId: string }) {
  const t = useTranslations("context");
  // Documents are repo-relative and an agent is not bound to one repository, so
  // the library shown here is the mirror of the repository currently selected
  // in the shell. What is stored is the path, matched at run time against
  // whichever repository the pull request lives in.
  const { repoId, activeRepo } = useActiveRepo();
  const { data: listing } = useContextListing(repoId);
  const { data: attachments, isLoading } = useAgentContextDocs(agentId);
  const setDocs = useSetAgentContextDocs();

  const [search, setSearch] = React.useState("");
  // Ephemeral drag state — which row is held and where it hovers. UI state, not
  // a copy of anything the server owns.
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

  const save = (paths: string[]) => setDocs.mutate({ agentId, paths });

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

  // Order must be changeable with the keyboard alone. Focus stays on the moved
  // row's button because the row's React key is its path, so the DOM node moves
  // rather than being recreated.
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
            {/* The one place in this feature where a user decision moves data
                off-machine, so the one place the warning belongs. */}
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

        {/* These two are verbatim reproductions of what `assemblePrompt` emits
            (reviewer-core/src/prompt.ts:33,133), not prose — AC-28 says the
            preview must show the real heading and wrapper. They go through
            `t.raw`, which returns the message unparsed: `t()` reads
            `<untrusted source="spec-N">` as a rich-text tag and throws
            INVALID_TAG for the missing handler. Anything mirroring engine output
            belongs on `t.raw`, because the engine's syntax is not ICU's. */}
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
