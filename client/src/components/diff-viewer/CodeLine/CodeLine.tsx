/* CodeLine — one rendered diff line: gutter number, +/- sign, text, plus the
   hover "+" affordance, any anchored comment threads, and an inline composer. */
"use client";

import React from "react";
import { SeverityBadge } from "@devdigest/ui";
import type { FindingRecord } from "@devdigest/shared";
import { commentTargetFor, type CommentThread, type DiffCommentApi, cs } from "../comments";
import { findingsForLine, severityForLine } from "../findings";
import { lineAnchorId, type Line } from "../helpers";
import { s, lineRowFor, lineSignFor, findingRowFor } from "../styles";
import { CommentThreadView } from "../CommentThreadView";
import { InlineComposer } from "../InlineComposer";

export function CodeLine({
  ln,
  path,
  threads,
  commenting,
  findings,
  onFindingClick,
}: {
  ln: Line;
  path: string;
  threads: CommentThread[];
  commenting?: DiffCommentApi;
  /** This FILE's findings; the line picks its own out of them. */
  findings?: FindingRecord[];
  onFindingClick?: (finding: FindingRecord) => void;
}) {
  const [hover, setHover] = React.useState(false);
  const [composing, setComposing] = React.useState(false);

  if (ln.kind === "hunk") {
    return (
      <div className="mono" style={s.hunk}>
        {ln.text}
      </div>
    );
  }

  const sign = ln.kind === "add" ? "+" : ln.kind === "del" ? "−" : "";
  const target = commenting?.canComment ? commentTargetFor(ln) : null;
  const showAdd = hover && !!target && !composing;

  // Derived during render — there is nothing here to hold in state.
  const fileFindings = findings ?? [];
  const anchored = findingsForLine(ln, fileFindings);
  const covering = severityForLine(ln, fileFindings);

  return (
    <div
      // Only new-side rows are addressable: a finding cites a line of the new
      // file, so that is the only anchor a caller can scroll to.
      id={ln.newNo != null ? lineAnchorId(path, ln.newNo) : undefined}
      style={cs.rowWrap}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <div style={findingRowFor(lineRowFor(ln.kind), covering)}>
        <span className="mono tnum" style={{ ...s.lineNo, position: "relative" }}>
          {showAdd && target && (
            <button
              type="button"
              title="Add a comment on this line"
              aria-label="Add a comment on this line"
              onClick={() => setComposing(true)}
              style={cs.addBtn}
            >
              +
            </button>
          )}
          {ln.newNo ?? ln.oldNo ?? ""}
        </span>
        <span className="mono" style={lineSignFor(ln.kind)}>
          {sign}
        </span>
        <span className="mono" style={s.lineText}>
          {ln.text || " "}
        </span>
        {anchored.length > 0 && (
          <span style={s.lineFindings}>
            {anchored.map((f) =>
              onFindingClick ? (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => onFindingClick(f)}
                  aria-label={f.title}
                  style={s.findingChipBtn}
                >
                  {/* Never `compact`: that drops the label and leaves an icon
                      and a number (client/INSIGHTS.md 2026-08-02). */}
                  <SeverityBadge severity={f.severity} />
                </button>
              ) : (
                <SeverityBadge key={f.id} severity={f.severity} />
              ),
            )}
          </span>
        )}
      </div>

      {commenting &&
        commenting.showComments &&
        threads.map((th) => (
          <CommentThreadView key={th.rootId} thread={th} commenting={commenting} path={path} />
        ))}

      {commenting && composing && target && (
        <InlineComposer
          commenting={commenting}
          path={path}
          line={target.line}
          side={target.side}
          onClose={() => setComposing(false)}
        />
      )}
    </div>
  );
}
