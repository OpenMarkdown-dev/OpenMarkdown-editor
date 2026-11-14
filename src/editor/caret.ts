import {
  EditorSelection,
  type EditorState,
  type Extension,
  Facet,
  StateEffect,
  type Transaction,
  type TransactionSpec,
  findClusterBreak,
} from "@codemirror/state";
import { EditorView, ViewPlugin, type ViewUpdate } from "@codemirror/view";
import { searchPanelOpen } from "@codemirror/search";
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
  /** Enter the part of B block `block` that holds `pos` (the block's `enterAt`); with `head`, that range selected in it. */
  enterAt(view: EditorView, block: CaretBlock, pos: number, head?: number): void;
  /** The source range of the part of `block` holding `pos` (a cell, a property value), or null. */
  partAt(state: EditorState, block: CaretBlock, pos: number): { from: number; to: number } | null;
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

// --- R2c: no caret stranded inside a B block -----------------------------------

/**
 * A B block renders as one widget the caret cannot sit in, so a body caret
 * strictly inside its range — with none of its parts open — has no place on
 * screen: the browser puts its own caret after the widget, and the next key
 * types THERE while the state says otherwise. The usual way in: typing on the
 * line right under a table, which GFM makes a row of it (the table grows over
 * the caret). R2b covers undo; this is the same landing for every other
 * transaction: enter the part that holds the caret, at the caret.
 *
 * The END edge counts as inside: a caret there is drawn after the widget, on
 * the next line, yet a key typed there extends the block's last line — exactly
 * what happens when typing under a table makes the typed line its last row
 * (N8 keeps a blank line after it; change: separator-keeps-blocks). Leaving a
 * block on purpose never lands there (`exitBlock` goes to the next line start).
 *
 * Returns the block and position to enter, or null. The start edge is fine
 * (before the widget); so is any caret while a part edit is open (the part owns
 * the keys), and anything in source mode (no provider, nothing rendered).
 */
export function strandedIn(
  state: EditorState,
  bodyHasFocus?: boolean,
): { block: CaretBlock; pos: number; head?: number } | null {
  const hooks = state.facet(blockCaret);
  if (!hooks) return null;
  const sel = state.selection.main;
  if (!sel.empty) return strandedRange(state, hooks, bodyHasFocus);
  // The Find input has the keys: nothing opens until the body takes them back
  // (design D4) — the caret a part left behind when Find opened stays put.
  if (bodyHasFocus === false && searchPanelOpen(state)) return null;
  const pos = sel.head;
  const block = hooks.editable(state).find((b) => b.from < pos && pos <= b.to);
  if (!block || hooks.leave(state).length > 0) return null;
  return { block, pos };
}

/**
 * Opening Find ends an open part edit (design D4, extended): a part editor
 * paints no Find matches, and an open part keeps its block's DOM as it is (so
 * typing survives), so neither the open cell nor the others would show them.
 * With the part closed the block paints every match (D3). The caret stays
 * where it was (in the part's source, not after the block as an ordinary exit
 * puts it), so once Find closes and the body has the keys again, R2c enters
 * the part at the landing. The transaction that closes it, or null when Find
 * did not just open or nothing is open. Pure: `before` / `after` are one
 * transaction's states.
 */
export function findTookKeys(before: EditorState, after: EditorState): TransactionSpec | null {
  if (searchPanelOpen(before) || !searchPanelOpen(after)) return null;
  const effects = leaveBlockEdits(after);
  return effects.length ? { effects, selection: after.selection } : null;
}

/** `findTookKeys`, installed once in the main editor (after the update, like R2b / R2c). */
export const findClosesParts: Extension = ViewPlugin.define((view) => ({
  update(u: ViewUpdate) {
    const close = findTookKeys(u.startState, u.state);
    if (!close) return;
    queueMicrotask(() => {
      if (!view.dom.isConnected || view.state !== u.state) return;
      view.dispatch(close);
    });
  },
}));

/**
 * R2c for a selection (spec: caret-rules / 光标不停在渲染块内部, 2nd paragraph):
 * a range lying wholly in one part of a B block with no part open — a Find
 * match in a table cell — is entered with the same text selected, but only
 * once the BODY has the keys (`bodyHasFocus`, e.g. Esc closed the Find panel):
 * entering while the Find input has focus would take Enter away from it. No
 * focus information (`undefined`) is no entry. A range across two parts is
 * left where it is (design Open Question 2). Not in a read-only view: no keys
 * type there.
 */
function strandedRange(
  state: EditorState,
  hooks: BlockCaretHooks,
  bodyHasFocus: boolean | undefined,
): { block: CaretBlock; pos: number; head: number } | null {
  if (bodyHasFocus !== true || state.readOnly) return null;
  const { from, to, anchor, head } = state.selection.main;
  const block = hooks.editable(state).find((b) => b.from <= from && to <= b.to);
  if (!block || hooks.leave(state).length > 0) return null;
  const part = hooks.partAt(state, block, from);
  if (!part || to > part.to) return null;
  return { block, pos: anchor, head };
}

/**
 * R2c, installed once in the main editor: after any update but an undo / redo
 * (R2b lands those), a stranded caret — or, once the body has the keys, a
 * selection inside one part — enters its part. After the update, in a
 * microtask, like the undo landing (an update may not dispatch).
 */
export const strandedCaret: Extension = ViewPlugin.define((view) => ({
  update(u: ViewUpdate) {
    // A focus change too: the body taking the keys back (Find closed) is when
    // a selection inside one cell is entered.
    if (!u.docChanged && !u.selectionSet && !u.focusChanged) return;
    if (u.transactions.some((tr) => tr.isUserEvent("undo") || tr.isUserEvent("redo"))) return;
    if (!strandedIn(u.state, view.hasFocus)) return;
    queueMicrotask(() => {
      if (!view.dom.isConnected || view.state !== u.state || view.composing) return;
      const hit = strandedIn(view.state, view.hasFocus);
      const hooks = view.state.facet(blockCaret);
      if (hit && hooks) hooks.enterAt(view, hit.block, hit.pos, hit.head);
    });
  },
}));

// --- 落点看得见: a landing is visible (L1 / L2) ----------------------------------

/**
 * Does the landing (the main selection: a caret or a range) lie inside the
 * hidden range [from, to]? True when an endpoint of the main selection is
 * STRICTLY inside it (an empty selection: its caret). Touching an edge, or
 * spanning the whole range, is not inside: a drag across a whole long link
 * keeps its URL chip (spec: live-preview-editor / 长链接触碰不炸开); only a
 * selection that starts or ends inside the hidden text (a Find match, an undo)
 * must be shown. The ONE definition (spec: caret-rules / 落点看得见); every path
 * that hides source asks it (gate: `landing.gate.test.ts` G1).
 *
 * `{ strict: false }` also counts a non-empty landing lying wholly within
 * [from, to], edges included — a Find match EQUAL to the hidden range (a
 * bullet, `**`, `# `, a link's whole URL): nothing of it is on screen either.
 * Strict is what decides a REVEAL (so the URL chip survives a selection that
 * merely touches it); non-strict is what decides whether the hidden range
 * holds the landing at all — the stand-in mark and the verdict.
 */
export function landingInside(state: EditorState, from: number, to: number, { strict = true } = {}): boolean {
  const { anchor, head, empty } = state.selection.main;
  if ((from < anchor && anchor < to) || (from < head && head < to)) return true;
  return !strict && !empty && from <= Math.min(anchor, head) && Math.max(anchor, head) <= to;
}

/**
 * How the landing is shown (spec: caret-rules / 落点看得见, L1):
 * - `plain`: nothing hides it;
 * - `revealed`: a hiding path skipped its hide over it (live mode reveals);
 * - `painted`: a rendered block draws it inside itself (the cell holding it);
 * - `marked`: the visible stand-in of the hidden range (link text, the whole
 *   widget) is marked as the landing;
 * - `hidden`: something hides it and nothing shows it — the bug the rule forbids.
 */
export type LandingShown = "plain" | "revealed" | "painted" | "marked" | "hidden";

/**
 * Each hiding path's own answer for the current landing — read off what that
 * path ACTUALLY builds for the state (its decorations), not off a copy of its
 * decision — or null when it hides nothing the landing is in. Provided by the
 * inline preview (`livePreview.ts`) and the block field (`blocks/field.ts`);
 * a facet for the same reason as `blockCaret` (this module sits below them).
 */
export const landingHiders = Facet.define<(state: EditorState) => LandingShown | null>();

/** Worst first: one path hiding the landing outweighs every other showing it. */
const SHOWN_ORDER: LandingShown[] = ["hidden", "painted", "marked", "revealed"];

/**
 * The pure verdict for `state`'s landing: how the renderers installed in it
 * show it. Never `hidden` once every hiding path asks `landingInside` (gate G2).
 */
export function landingShownBy(state: EditorState): LandingShown {
  const answers = state.facet(landingHiders).map((f) => f(state));
  return SHOWN_ORDER.find((v) => answers.includes(v)) ?? "plain";
}

/** A landing scroll for a range inside a rendered block: scroll the drawn landing (D5). */
export const landingScrollEffect = StateEffect.define<{ from: number; to: number }>();

/** What a landing scroll looks for inside a block: the current match, the painted selection, the marked widget. */
export const PAINTED_LANDING = ".cm-searchMatch-selected, .om-landing, [data-om-landing]";

/**
 * The landing scroll (spec: caret-rules / 落点看得见, L2; R14): what Find's
 * `scrollToMatch` returns (`base.ts`). Outside a rendered B block it is
 * CodeMirror's own `scrollIntoView(range)`. Inside one it is
 * `landingScrollEffect`: the block's box is not the target (a table taller than
 * the viewport would scroll to its header, the cell still off screen), the cell
 * that paints the landing is — `landingScroll` below scrolls it in once the
 * table has drawn it.
 */
export function scrollLanding(range: { from: number; to: number }, view: EditorView): StateEffect<unknown> {
  const hooks = view.state.facet(blockCaret);
  const inBlock = hooks?.editable(view.state).some((b) => b.from < range.to && range.from < b.to);
  return inBlock ? landingScrollEffect.of({ from: range.from, to: range.to }) : EditorView.scrollIntoView(EditorSelection.range(range.from, range.to));
}

/** The smallest scroll that brings [top, bottom] inside [viewTop, viewBottom] (`nearest`); 0 when it already is. Pure. */
export function nearestDelta(top: number, bottom: number, viewTop: number, viewBottom: number): number {
  if (top >= viewTop && bottom <= viewBottom) return 0;
  if (bottom - top > viewBottom - viewTop || top < viewTop) return top - viewTop;
  return bottom - viewBottom;
}

/**
 * Scroll `el` — a drawn landing: a cell, a painted match — into `view`'s
 * scroller, `nearest` (no movement when it is in view). One measure: read its
 * box, write the offset. The cell entry uses it for the cell's whole box: a
 * nested editor's own scroll brings only its caret line in, short of the
 * cell's padding (spec: caret-rules R8, 落点看得见 L2).
 */
export function scrollBoxIntoView(view: EditorView, el: HTMLElement): void {
  view.requestMeasure({
    read: () => {
      if (!el.isConnected) return 0;
      const r = el.getBoundingClientRect();
      const sc = view.scrollDOM.getBoundingClientRect();
      return nearestDelta(r.top, r.bottom, sc.top, sc.bottom);
    },
    write: (delta) => {
      if (delta) view.scrollDOM.scrollTop += delta;
    },
  });
}

/**
 * Scrolls the painted landing of a `landingScrollEffect` into view, `nearest`.
 * One measure: read the painted element's box, write the scroller's offset. A
 * block that is not drawn yet (far outside the viewport) is scrolled to first
 * by its height-map position; after any scroll the measure looks once more.
 */
export const landingScroll: Extension = ViewPlugin.define((view) => {
  const scrollTo = (range: { from: number; to: number }, retry: boolean) =>
    view.requestMeasure({
      read: () => {
        const block = view.state.facet(blockCaret)?.editable(view.state).find((b) => b.from < range.to && range.from < b.to);
        if (!block) return null;
        const scroller = view.scrollDOM.getBoundingClientRect();
        const el = [...view.contentDOM.querySelectorAll<HTMLElement>(PAINTED_LANDING)].find((e) => {
          const pos = view.posAtDOM(e);
          return block.from <= pos && pos <= block.to;
        });
        if (el) {
          const r = el.getBoundingClientRect();
          return { delta: nearestDelta(r.top, r.bottom, scroller.top, scroller.bottom), drawn: true };
        }
        // Not drawn: bring the block's top in by the height map, then look again.
        const top = view.lineBlockAt(block.from).top + view.documentTop;
        return { delta: nearestDelta(top, top + 1, scroller.top, scroller.bottom), drawn: false };
      },
      write: (m) => {
        if (!m) return;
        if (m.delta) view.scrollDOM.scrollTop += m.delta;
        // Look once more after a scroll: the block may only now be drawn, and
        // the heights CodeMirror re-measures around it can shift it again.
        if (m.delta && !retry) scrollTo(range, true);
      },
    });
  return {
    update(u: ViewUpdate) {
      for (const tr of u.transactions) for (const e of tr.effects) if (e.is(landingScrollEffect)) scrollTo(e.value, false);
    },
  };
});

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
