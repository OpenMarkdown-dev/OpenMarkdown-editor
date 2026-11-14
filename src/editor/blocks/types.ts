import type { EditorState, Extension, StateEffect, Transaction } from "@codemirror/state";
import type { EditorView, WidgetType } from "@codemirror/view";
import type { SyntaxNodeRef } from "@lezer/common";
import type { LivePreviewConfig } from "../previewConfig";
import type { Pending } from "./render";

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
   * Rendered widget for a range. Four answers (change: block-fallback, design
   * D1; render-placeholder-size, design D1): the widget; `pending(…)` for "mine,
   * not yet" (converter still loading, result still queued, render deferred) —
   * the framework shows the one placeholder (`pending.ts`), never the source;
   * `null` for "not mine" (not a shape this entry draws) — the source stays,
   * unmarked; or THROW for "cannot" — the framework (`attemptRender` in
   * `render.ts`) leaves the source with the failure mark. Never catch your own
   * render error, and never answer "not yet" with `null`.
   */
  widget?: (state: EditorState, node: SyntaxNodeRef, range: { from: number; to: number }) => WidgetType | Pending | null;
  /**
   * A: the placeholder's height when no size is known yet (a CSS length; design
   * D3, step 3). Default: one text line.
   */
  pendingMinHeight?: string;
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
   * stays at `pos`. With `head`: a selection inside that one part, selected the
   * same in the part (R2c, a Find match when the body takes the keys back).
   */
  enterAt?: (view: EditorView, block: BlockRange, pos: number, head?: number) => void;
  /**
   * B only: the source range of the part (a cell, a property value) holding
   * `pos`, or null between parts. R2c enters a selection only when both its
   * ends lie in one part (spec: caret-rules / 光标不停在渲染块内部).
   */
  partAt?: (state: EditorState, block: BlockRange, pos: number) => { from: number; to: number } | null;
  /**
   * The block draws the landing (the main selection) inside itself — in the
   * part that holds it — instead of being marked whole (spec: caret-rules /
   * 落点看得见, outcome 2). Answers, for a landing inside `block`, whether this
   * state's widget paints it; computed from the same marks the widget is built
   * with. Absent, or false for this landing (nothing in the block paints it):
   * the block field marks the whole widget (outcome 3).
   */
  paintsLanding?: (state: EditorState, block: BlockRange) => boolean;
  /**
   * Inputs of the widget's own beyond the document and the selection that
   * should redraw it (the table: the Find query and panel, which it paints).
   */
  redrawOn?: (tr: Transaction) => boolean;
  /** B only: the effects that end this block's open part edit; [] when none is open. */
  leave?: (state: EditorState) => StateEffect<unknown>[];
  /**
   * What the entry needs installed beside the block field — an async renderer's
   * driver (mermaid: asks for renders, dispatches `asyncRenderDone`). The field
   * provides it, so wherever blocks render, the driver is there.
   */
  extension?: Extension;
}
