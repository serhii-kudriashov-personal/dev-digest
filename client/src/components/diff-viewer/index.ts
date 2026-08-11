/* diff-viewer — unified-diff viewer with optional inline GitHub comments and an
   optional findings overlay.
   Public surface: the DiffViewer and FileCard components, the three overlay
   contracts, `lineAnchorId` (the ONE definition of a line's DOM id, so a caller
   can scroll to a line this module rendered) and the hook that drives it. */
export { DiffViewer } from "./DiffViewer";
export { FileCard } from "./FileCard";
export type { DiffCommentApi } from "./comments";
export type { DiffFindingsApi } from "./findings";
export { lineAnchorId } from "./helpers";
export { useDiffLineTarget } from "./useDiffLineTarget";
export type { DiffLineTargetApi } from "./useDiffLineTarget";
