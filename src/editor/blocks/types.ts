import type { EditorState, Extension, StateEffect } from "@codemirror/state";
import type { EditorView, WidgetType } from "@codemirror/view";
import type { SyntaxNodeRef } from "@lezer/common";
import type { LivePreviewConfig } from "../previewConfig";

/**
 * The three ways a block may be edited (spec: block-editing / 三种编辑方式).
 *   A — reveal: caret enters → the whole block becomes source again.
 *   B — edit a part in place: always rendered; one part becomes an editor.
 *   C — decorate only: never replaced, edited like ordinary text.
 */
export type BlockMode = "A" | "B" | "C";

/** A block's source range, as the framework sees it once rendered. */
export interface BlockRange {
  id: string;
  mode: BlockMode;
  from: number;
  to: number;
}

/** What an A / B entry hands the framework for one occurrence. */
export interface BlockCandidate {
  from: number;
  to: number;
  widget: WidgetType;
  /**
   * A only: the range the selection must touch to reveal the block. Defaults to
   * the whole block. Skill-mode frontmatter starts it at the inner YAML so the
   * caret resting at offset 0 on open does not reveal the card.
   */
  revealFrom?: number;
}

export interface BlockEntry {
  /** = the id in the spec's block-type table. */
  id: string;
  mode: BlockMode;
  /** Syntax-tree node this entry renders (A / B). */
  node?: string;
  /** Source range for a matched node, or null to leave it as source. */
  range?: (state: EditorState, node: SyntaxNodeRef) => { from: number; to: number } | null;
  /**
   * Rendered widget for a range. Three answers (change: block-fallback, design
   * D1): the widget; `null` for "not now" (converter still loading, not a shape
   * this entry draws) — the source stays, unmarked; or THROW for "cannot" — the
   * framework (`attemptRender` in `render.ts`) leaves the source with the
   * failure mark. Never catch your own render error.
   */
  widget?: (state: EditorState, node: SyntaxNodeRef, range: { from: number; to: number }) => WidgetType | null;
  /** Document-level entries that are not a syntax node (frontmatter). */
  scan?: (state: EditorState, config: LivePreviewConfig) => BlockCandidate | null;
  /**
   * B only: enter the block from its top or bottom edge. `x` is the caret's
   * horizontal screen coordinate, for picking the nearest editable part.
   */
  enter?: (view: EditorView, block: BlockRange, edge: "top" | "bottom", x: number | null) => void;
  /**
   * B only: enter the part that holds document offset `pos`, its caret at `pos`
   * (an undo landing inside the block — spec: caret-rules R2b). The outer caret
   * stays at `pos`.
   */
  enterAt?: (view: EditorView, block: BlockRange, pos: number) => void;
  /** B only: the effects that end this block's open part edit; [] when none is open. */
  leave?: (state: EditorState) => StateEffect<unknown>[];
  /**
   * What the entry needs installed beside the block field — an async renderer's
   * driver (mermaid: asks for renders, dispatches `asyncRenderDone`). The field
   * provides it, so wherever blocks render, the driver is there.
   */
  extension?: Extension;
}
