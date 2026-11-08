import {
  EditorSelection,
  type EditorState,
  type Extension,
  Facet,
  type StateEffect,
  type Transaction,
  findClusterBreak,
} from "@codemirror/state";
import { EditorView, ViewPlugin, type ViewUpdate } from "@codemirror/view";
import type { SyntaxNode } from "@lezer/common";
import { REVEAL_ON_TOUCH_NODES } from "./previewConceal";
import { livePreviewConfig } from "./previewConfig";
import { treeUpTo } from "./syntax";

/**
 * Where the caret goes after an undo and after a user navigation (spec:
 * caret-rules — the rule table; this module implements R2 / R2a / R2b and R3).
 * Every other place that sets the caret is registered against its row in
 * `caret.gate.test.ts`.
 *
 * R2 · undo / redo — ONE view plugin, so the keyboard, the menu's Undo (the
 * webview's `historyUndo` input, which `history()` turns into the same
 * command) and the undo a table cell or property value forwards all land
 * alike. CM's history restores the selection from BEFORE the change, which is
 * far away when the change did not move the caret (an image drag, a cell, a
 * property value). The plugin puts the caret at the end of the last changed
 * range instead, unless the restored selection is already at the change (it
 * then keeps it — e.g. the re-selected text of an undone deletion).
 *
 * Why not a transaction filter (design D2's first plan): history dispatches
 * its undo with `filter: false`, so filters never see it, and an extender
 * cannot set the selection. The plugin reads the undo transaction after the
 * update and dispatches the landing in a microtask — still before the browser
 * paints or CodeMirror measures, so history's far scroll target is replaced
 * before it is ever acted on and nothing is drawn in between.
 *
 * R2a · a landing that would touch a widget live preview reveals on touch (an
 * image, inline or block math) steps past it, so the undo does not turn it
 * back into source.
 *
 * R2b · a landing inside a B block (a table cell, a property) re-enters that
 * part through the block's own `enterAt`; a landing outside an open part edit
 * ends that edit instead.
 *
 * What the blocks are is the block framework's to say: `blocks/field.ts`
 * provides `blockCaret` from its registry. Reached through a facet rather than
 * imported, because this module sits BELOW the block framework: the table
 * widget (a registry entry) reaches it through `linkNavigate.ts`, so an import
 * of the registry from here would point up the layers (spec: module-graph /
 * 运行时 import 不成环). The facet also carries meaning of its own: no
 * provider = no live preview (source mode), so nothing is stepped past or
 * re-entered.
 */

/** A block as the caret rules see it: where it is, which way it is edited. */
export interface CaretBlock {
  id: string;
  mode: "A" | "B" | "C";
  from: number;
  to: number;
}

/** The block framework's answers (provided by `blocks/field.ts`). */
export interface BlockCaretHooks {
  /** The range an A block draws for syntax node `node` (it reveals when the caret touches it), or null. */
  revealRange(state: EditorState, node: SyntaxNode): { from: number; to: number } | null;
  /** The rendered B blocks of `state`. */
  editable(state: EditorState): CaretBlock[];
  /** Enter the part of B block `block` that holds `pos` (the block's `enterAt`). */
  enterAt(view: EditorView, block: CaretBlock, pos: number): void;
  /** The effects that end every open B-block part edit; [] when none is open. */
  leave(state: EditorState): StateEffect<unknown>[];
}

export const blockCaret = Facet.define<BlockCaretHooks, BlockCaretHooks | null>({
  combine: (values) => values[0] ?? null,
});

// --- R2 / R2a: the landing -----------------------------------------------------

/** What an undo / redo leaves: where the caret is, and whether that is history's own selection. */
export interface UndoLanding {
  pos: number;
  /** True: history's restored selection was at the change and is kept as it is. */
  keep: boolean;
}

/**
 * Where an undo / redo transaction should leave the caret (R2 / R2a), or null
 * when `tr` is not an undo / redo that changed the document. Reads the
 * transaction only (its start state, changes, selection; the new state for R2a).
 */
export function undoLandingOf(tr: Transaction): UndoLanding | null {
  if (!tr.docChanged || !(tr.isUserEvent("undo") || tr.isUserEvent("redo"))) return null;
  const ranges: { from: number; to: number }[] = [];
  tr.changes.iterChangedRanges((_fromA, _toA, from, to) => ranges.push({ from, to }));
  const last = ranges[ranges.length - 1];
  if (!last) return null;
  const sel = (tr.selection ?? tr.startState.selection.map(tr.changes)).main;
  if (sel.from <= last.to && sel.to >= last.from && !(sel.empty && inBlockPart(tr.state, last.to))) {
    return { pos: sel.head, keep: true };
  }
  return { pos: clearOfWidgets(tr.state, last.to), keep: false };
}

/**
 * Is `pos` inside a B block (a table, the Properties block)? There the outer
 * caret history restores is the part's source START (R8 / R9 put it there), so
 * "touching the change" says nothing — the landing is the change itself (R2b).
 */
function inBlockPart(state: EditorState, pos: number): boolean {
  const hooks = state.facet(blockCaret);
  return !!hooks && hooks.editable(state).some((b) => b.from <= pos && pos <= b.to);
}

/** A widget that would turn back into source with the caret at `pos`: its range, or null. */
function revealedAt(state: EditorState, hooks: BlockCaretHooks, pos: number): { from: number; to: number } | null {
  const tree = treeUpTo(state, Math.min(state.doc.length, pos + 1));
  for (const side of [-1, 1] as const) {
    for (let n: SyntaxNode | null = tree.resolveInner(pos, side); n; n = n.parent) {
      if (REVEAL_ON_TOUCH_NODES.has(n.name) && n.from <= pos && pos <= n.to) return { from: n.from, to: n.to };
      const r = hooks.revealRange(state, n);
      if (r && r.from <= pos && pos <= r.to) return r;
    }
  }
  return null;
}

/** The first position after `to` that no longer touches it: one cluster on, or the next line's start. */
function stepPast(state: EditorState, to: number): number {
  const line = state.doc.lineAt(to);
  if (to < line.to) return line.from + findClusterBreak(line.text, to - line.from);
  return Math.min(to + 1, state.doc.length);
}

/**
 * `pos`, or — when the caret there would reveal a widget (R2a) — the first
 * position after it that reveals none. Live preview only: with no rendering
 * (source mode) nothing reveals.
 */
export function clearOfWidgets(state: EditorState, pos: number): number {
  const hooks = state.facet(blockCaret);
  if (!hooks || !state.facet(livePreviewConfig).revealOnSelection) return pos;
  // A run of adjacent widgets (`![a](x)![b](y)`) is stepped over one by one.
  for (let i = 0; i < 16; i++) {
    const hit = revealedAt(state, hooks, pos);
    if (!hit) return pos;
    const next = stepPast(state, hit.to);
    if (next <= pos) return pos; // the document's end: nothing after it to land on
    pos = next;
  }
  return pos;
}

// --- R2b: re-entering a block part --------------------------------------------

/** The effects that end every open B-block part edit (a cell, a property); [] when none is open. */
export function leaveBlockEdits(state: EditorState): StateEffect<unknown>[] {
  return state.facet(blockCaret)?.leave(state) ?? [];
}

/** Apply a landing to the state the undo produced (`after`); a no-op once anything else happened. */
function settleLanding(view: EditorView, after: EditorState, land: UndoLanding): void {
  if (!view.dom.isConnected || view.state !== after) return; // moved on since
  const { pos } = land;
  if (!land.keep) {
    view.dispatch({ selection: EditorSelection.cursor(pos), scrollIntoView: true, userEvent: "select" });
  }
  const hooks = view.state.facet(blockCaret);
  if (!hooks) return;
  const block = hooks.editable(view.state).find((b) => b.from <= pos && pos <= b.to);
  if (block) return hooks.enterAt(view, block, pos);
  const leave = hooks.leave(view.state);
  if (leave.length === 0) return;
  // The undo was pressed in a part that now has nothing to do with it: close it
  // and give the keys back to the body, where the caret is.
  view.dispatch({ effects: leave });
  view.focus();
}

/**
 * The undo landing (R2 / R2a / R2b), installed once in the main editor. Part
 * editors (cells, property values) own no history — their undo is the
 * document's (`blocks/partEditor.ts`) — so it reaches them through this one.
 */
export const undoLanding: Extension = ViewPlugin.define((view) => ({
  update(u: ViewUpdate) {
    let land: UndoLanding | null = null;
    for (const tr of u.transactions) land = undoLandingOf(tr) ?? land;
    // After the update, never inside it (an update may not dispatch).
    if (land) queueMicrotask(() => settleLanding(view, u.state, land));
  },
}));

// --- R3: user navigation ---------------------------------------------------------

/**
 * A user navigation to `pos` — an outline row (panel or overlay), the palette's
 * `@` jump, a same-document anchor link, the signpost's Jump (spec: caret-rules
 * R3): the caret moves to the start of that line, the line comes to the top of
 * the viewport, and the body gets the keys. An open cell / property edit ends.
 * The agent's reveal does NOT come here: it scrolls only (`revealHeadingAt`, R4).
 */
export function navigateTo(view: EditorView, pos: number): void {
  const line = view.state.doc.lineAt(Math.max(0, Math.min(pos, view.state.doc.length)));
  view.dispatch({
    selection: { anchor: line.from },
    effects: [...leaveBlockEdits(view.state), EditorView.scrollIntoView(line.from, { y: "start" })],
    userEvent: "select",
  });
  view.focus();
}
