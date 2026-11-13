import type { EditorState } from "@codemirror/state";
import { livePreviewConfig } from "../previewConfig";

/**
 * Whether an A block at `range` is revealed (shown as source) rather than drawn:
 * the ONE definition (change: mermaid-render-drawn-only, design D1). The block
 * field (`./field.ts`) uses it to skip the widget; an async renderer's driver
 * (`./mermaid.ts`) uses it to skip the render. Reading mode
 * (`revealOnSelection: false`) reveals nothing. `revealFrom`: see `BlockCandidate`.
 *
 * A leaf module, not `field.ts`: the driver is an entry the field's registry
 * imports, so taking it from the field would be an import cycle.
 */
export function isRevealed(state: EditorState, range: { from: number; to: number; revealFrom?: number }): boolean {
  return (
    state.facet(livePreviewConfig).revealOnSelection &&
    state.selection.ranges.some((r) => r.from <= range.to && r.to >= (range.revealFrom ?? range.from))
  );
}
