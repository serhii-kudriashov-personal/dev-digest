/* diff-viewer — unified-diff viewer with optional inline GitHub comments and an
   optional findings overlay.
   Public surface: the DiffViewer and FileCard components, the two overlay
   contracts, and `lineAnchorId` (the ONE definition of a line's DOM id, so a
   caller can scroll to a line this module rendered). */
export { DiffViewer } from "./DiffViewer";
export { FileCard } from "./FileCard";
export type { DiffCommentApi } from "./comments";
export type { DiffFindingsApi } from "./findings";
export { lineAnchorId } from "./helpers";
