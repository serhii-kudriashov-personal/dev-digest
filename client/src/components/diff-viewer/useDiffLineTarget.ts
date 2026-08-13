/* useDiffLineTarget — open a file's card and scroll to one of its lines.
   Lives in `diff-viewer` because this module already owns `lineAnchorId` (the ONE
   definition of a rendered line's DOM id) and `FileCard`'s controlled `open`
   state, which are the two halves the orchestration needs. */
"use client";

import React from "react";
import { lineAnchorId } from "./helpers";

/**
 * The overlay-style API a viewer receives, mirroring `DiffCommentApi` /
 * `DiffFindingsApi`. The owner is whichever component renders the viewer.
 */
export interface DiffLineTargetApi {
  /** Per-path controlled `open` state. A path absent here is uncontrolled. */
  openByPath: Record<string, boolean>;
  setOpen: (path: string, open: boolean) => void;
  /** Open the file's card and scroll to `line`; a repeat call re-fires. */
  goTo: (path: string, line: number) => void;
}

/** Which file was asked for, and a sequence number so a repeat call re-fires. */
interface ScrollTarget {
  path: string;
  line: number;
  seq: number;
}

/**
 * Two consumers as of L06: the Smart Diff viewer's per-file findings badge, and
 * the Blast Radius card's caller rows arriving through `?goto=path:line`. It was
 * inlined in `SmartDiffViewer` until the second consumer appeared — promoted now,
 * not earlier (`frontend-ui-architecture` §2).
 */
export function useDiffLineTarget(): DiffLineTargetApi {
  // A card is uncontrolled until something forces it open; from then on its state
  // lives here, so the reader can still collapse it again.
  const [openByPath, setOpenByPath] = React.useState<Record<string, boolean>>({});
  const [target, setTarget] = React.useState<ScrollTarget | null>(null);

  // The ONE legitimate Effect here: it synchronises with the DOM, which is an
  // external system. Opening the card happens in `goTo` below, and React batches
  // it with `setTarget`, so by the time this runs the line has been rendered and
  // can be found. `seq` is what makes a SECOND call for the same line scroll
  // again — without it the state is unchanged and the Effect never re-runs.
  React.useEffect(() => {
    if (!target) return;
    document
      .getElementById(lineAnchorId(target.path, target.line))
      ?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [target]);

  const setOpen = React.useCallback((path: string, open: boolean) => {
    setOpenByPath((prev) => ({ ...prev, [path]: open }));
  }, []);

  const goTo = React.useCallback((path: string, line: number) => {
    setOpenByPath((prev) => ({ ...prev, [path]: true }));
    setTarget((prev) => ({ path, line, seq: (prev?.seq ?? 0) + 1 }));
  }, []);

  return { openByPath, setOpen, goTo };
}
