/* FindingsHoverCard — hover (or focus) an anchor to read the findings behind a
   severity breakdown: every finding, worst-first, with severity, title,
   category, file:line, confidence and a clamped rationale.

   Two screens use it and they source their findings differently. The PR list
   holds only counts, so it fetches on open and passes `loading`; the PR detail
   page already has `review.findings` in memory and passes them straight in.
   Everything else — the open delay, the flip-up placement, keyboard parity — is
   the same, so it lives here rather than twice.
   See specs/findings-by-severity.md. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Icon, SeverityBadge, CategoryTag, ConfidenceNum } from "@devdigest/ui";
import type { Category, Severity } from "@devdigest/ui";
import type { FindingRecord } from "@devdigest/shared";
import { HOVER_OPEN_DELAY_MS } from "./constants";
import { popoverPosition, sortBySeverity, type PopoverPosition } from "./helpers";
import { s } from "./styles";

export function FindingsHoverCard({
  findings,
  total,
  loading = false,
  disabled = false,
  onOpenChange,
  anchorStyle,
  children,
}: {
  /** Findings to list. May be empty while a lazy caller is still fetching. */
  findings: FindingRecord[];
  /** Heading count. Known from the breakdown before `findings` arrive. */
  total: number;
  loading?: boolean;
  /** No findings to show: the anchor is inert — no tab stop, no card, no fetch. */
  disabled?: boolean;
  /** Fires on open/close so a caller can gate a lazy fetch on it. */
  onOpenChange?: (open: boolean) => void;
  anchorStyle?: React.CSSProperties;
  children: React.ReactNode;
}) {
  const t = useTranslations("prReview");
  const ref = React.useRef<HTMLDivElement | null>(null);
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const [pos, setPos] = React.useState<PopoverPosition | null>(null);

  const sorted = React.useMemo(() => sortBySeverity(findings), [findings]);

  const notify = onOpenChange;
  const open = React.useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setPos(
      popoverPosition(
        { top: r.top, bottom: r.bottom, left: r.left },
        { width: window.innerWidth, height: window.innerHeight },
      ),
    );
    notify?.(true);
  }, [notify]);

  const scheduleOpen = () => {
    if (disabled) return;
    timer.current = setTimeout(open, HOVER_OPEN_DELAY_MS);
  };
  const close = React.useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    setPos(null);
    notify?.(false);
  }, [notify]);

  React.useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);

  return (
    <div
      ref={ref}
      // Named and grouped: tabbing onto the anchor otherwise announces a bare
      // run of counts, with nothing saying what they are counts OF.
      role="group"
      aria-label={t("findings.summary")}
      style={{ ...s.anchor, ...anchorStyle }}
      onMouseEnter={scheduleOpen}
      onMouseLeave={close}
      // Keyboard parity: the card is reachable without a pointer, and Escape
      // dismisses it without leaving the row.
      tabIndex={disabled ? undefined : 0}
      onFocus={disabled ? undefined : open}
      onBlur={close}
      onKeyDown={(e) => {
        if (e.key === "Escape") close();
      }}
    >
      {children}

      {pos && (
        <div
          style={s.popover(pos.top, pos.left)}
          role="tooltip"
          // Both anchors sit inside something clickable — a PR row that
          // navigates, a header that expands. A click inside the card should
          // land on the findings, not trigger the parent.
          onClick={(e) => e.stopPropagation()}
        >
          <div style={s.heading}>
            <Icon.AlertOctagon size={13} />
            {t("findings.popover.heading", { count: total })}
          </div>

          {loading && sorted.length === 0 ? (
            <div style={s.state}>{t("findings.popover.loading")}</div>
          ) : sorted.length === 0 ? (
            <div style={s.state}>{t("findings.popover.empty")}</div>
          ) : (
            sorted.map((f, i) => (
              <div key={f.id} style={s.item(i === 0)}>
                <div style={s.itemHead}>
                  <SeverityBadge severity={f.severity as Severity} compact />
                  <span style={s.itemTitle}>{f.title}</span>
                  <CategoryTag category={f.category as Category} />
                </div>
                <div style={s.itemMeta}>
                  <span className="mono" style={s.itemFile}>
                    {f.file}:
                    {f.start_line === f.end_line ? f.start_line : `${f.start_line}-${f.end_line}`}
                  </span>
                  <ConfidenceNum value={f.confidence} />
                </div>
                <div style={s.itemRationale}>{f.rationale}</div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

export default FindingsHoverCard;
