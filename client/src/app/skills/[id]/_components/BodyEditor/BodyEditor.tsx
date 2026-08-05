/* BodyEditor — the skill body as a code editor: filename, dirty badge, token
   estimate, and a line-number gutter.

   Editing is plain monospace text. Syntax highlighting lives in the Preview tab,
   which renders the markdown properly: highlighting *inside* an editable field
   needs either an editor dependency or a transparent-textarea overlay whose
   scroll sync, wrapping and IME handling all drift. Not worth it for a field
   whose rendered form is one tab away. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, Icon } from "@devdigest/ui";
import { TOKEN_ESTIMATE_DEBOUNCE_MS } from "@/app/skills/constants";
import { bodyFilename, estimateTokens, lineCount } from "./helpers";
import { s } from "./styles";

export function BodyEditor({
  value,
  onChange,
  skillName,
  dirty,
  rows = 18,
}: {
  value: string;
  onChange: (v: string) => void;
  skillName: string;
  /** Unsaved changes — drives the `unsaved` badge. */
  dirty?: boolean;
  rows?: number;
}) {
  const t = useTranslations("skills");
  const gutterRef = React.useRef<HTMLDivElement>(null);

  // Debounced so a fast typist does not re-measure on every keystroke. The
  // estimate is cheap, but it is also not urgent — it settles a beat later.
  const [tokens, setTokens] = React.useState(() => estimateTokens(value));
  React.useEffect(() => {
    const id = setTimeout(() => setTokens(estimateTokens(value)), TOKEN_ESTIMATE_DEBOUNCE_MS);
    return () => clearTimeout(id);
  }, [value]);

  // Derived every render, never mirrored into state: the gutter is a pure
  // function of the body.
  const lines = lineCount(value);

  return (
    <div style={s.wrap}>
      <div style={s.header}>
        <Icon.FileText size={13} />
        <span className="mono" style={s.filename}>
          {bodyFilename(skillName)}
        </span>
        {dirty && <Badge color="var(--warn)">{t("editor.unsaved")}</Badge>}
        <span style={s.tokens}>{t("editor.tokenEstimate", { count: tokens })}</span>
      </div>
      <div style={s.body}>
        <div ref={gutterRef} className="mono" style={s.gutter} aria-hidden="true">
          {Array.from({ length: lines }, (_, i) => (
            <div key={i}>{i + 1}</div>
          ))}
        </div>
        <textarea
          className="mono"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          rows={rows}
          spellCheck={false}
          aria-label={t("file.bodyLabel")}
          style={s.textarea}
          // Keep the gutter aligned while the textarea scrolls vertically.
          onScroll={(e) => {
            if (gutterRef.current) {
              gutterRef.current.scrollTop = (e.target as HTMLTextAreaElement).scrollTop;
            }
          }}
        />
      </div>
    </div>
  );
}
