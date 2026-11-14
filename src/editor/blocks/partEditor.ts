import { Annotation, EditorSelection, EditorState, Prec, Transaction } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { standardKeymap } from "@codemirror/commands";
import { openSearchPanel } from "@codemirror/search";
import { markdown } from "@codemirror/lang-markdown";
import { dialectBase, dialectExtensions } from "../dialectParser";
import { livePreviewConfig } from "../previewConfig";
import { markdownHighlighting } from "../theme";
import { nestedEditorBase, nestedPreview } from "./nested";
import { scrollBoxIntoView } from "../caret";

/**
 * The editor a B block puts in place of ONE editable part — a table cell, a
 * property value (spec: block-editing / 三种编辑方式, B; change:
 * table-cell-editor, design D1). Born from the `spike/cell-cm6` spike.
 *
 * It renders its text with the SAME live preview as the document, so editing a
 * part looks like the part did before you clicked it. It owns no undo history:
 * every keystroke is pushed to the outer document through `sync`, and undo /
 * redo belong to the document (the block forwards them from `onKey`).
 */
export interface PartEditorHooks {
  /** Write the part's new text into the outer document. */
  sync: (text: string) => void;
  /**
   * Keys the block may want: Tab, Enter, Escape, arrows, undo / redo. Return
   * true when handled (the editor then ignores the key). Never called mid-IME.
   */
  onKey: (e: KeyboardEvent, part: EditorView) => boolean;
}

export interface PartEditorOptions {
  /**
   * What the part can hold: every typed or pasted insert passes through it
   * (`before` = the part's text before the insertion point) — the ONE place a
   * block says what its part accepts. A table cell flattens line breaks and
   * escapes pipes (`tableCellInsert`); a property value flattens line breaks.
   */
  accept?: (inserted: string, before: string) => string;
  /**
   * Where the caret lands on entry; "all" selects the whole part (a new name); a
   * number is an offset into the part (an undo landing there, caret-rules R2b).
   */
  caret?: PartCaret;
}

/**
 * Where a part editor's caret lands when it opens (spec: caret-rules R15). A
 * `{ anchor, head }` range selects that text in the part (R2c: a Find match the
 * body hands over when it takes the keys back).
 */
export type PartCaret = "start" | "end" | "all" | number | { anchor: number; head: number };

/** Marks a reseed, so it is not echoed back to the document as an edit. */
const reseed = Annotation.define<boolean>();

const parts = new WeakMap<HTMLElement, EditorView>();

/** The part editor living somewhere inside `dom`, if any. */
export function partEditorIn(dom: HTMLElement): EditorView | undefined {
  const host = dom.querySelector<HTMLElement>(".om-part-editor");
  return host ? parts.get(host) : undefined;
}

export function buildPartEditor(
  outer: EditorView,
  text: string,
  hooks: PartEditorHooks,
  opts: PartEditorOptions = {},
): HTMLElement {
  const host = document.createElement("div");
  // `om-table-cell-input` keeps the table's click routing and outside-click
  // exit working unchanged (they look for it); `om-part-editor` is ours.
  host.className = "om-part-editor om-table-cell-input";
  let pendingCompose = false;
  // A press in the part before its entry caret is placed (below) — the second
  // press of a double / triple click that entered the cell.
  let pointerPlaced = false;

  const view: EditorView = new EditorView({
    parent: host,
    state: EditorState.create({
      doc: text,
      extensions: [
        Prec.highest(
          EditorView.domEventHandlers({
            mousedown: () => {
              pointerPlaced = true;
              return false; // CodeMirror's own mouse selection goes ahead
            },
            keydown: (e) => {
              // Mid-composition the IME owns every key, arrows included.
              if (e.isComposing || e.keyCode === 229) return false;
              return hooks.onKey(e, view);
            },
            compositionend: () => {
              if (pendingCompose) {
                pendingCompose = false;
                hooks.sync(view.state.doc.toString());
              }
              return false;
            },
          }),
        ),
        opts.accept
          ? acceptFilter(opts.accept)
          : [],
        EditorView.updateListener.of((u) => {
          if (!u.docChanged) return;
          if (u.transactions.some((t) => t.annotation(reseed))) return;
          // Same rule the old <input> had: never sync mid-composition.
          if (u.view.composing) {
            pendingCompose = true;
            return;
          }
          hooks.sync(u.state.doc.toString());
        }),
        // Caret movement, deletion, selection — the same bindings as the body,
        // so a part edits like the document does. The block's own keys (Enter,
        // Tab, arrows at an edge, undo) were offered to `onKey` first, above.
        keymap.of(standardKeymap),
        // Find belongs to the document: Cmd+F in a part opens the document's
        // panel (which then closes the part so its block paints every match —
        // caret.ts `findTookKeys`), never a search of the part alone or, in a
        // browser, the page's own find over a half-typed cell.
        keymap.of(partFindKeymap(outer)),
        nestedEditorBase(),
        // No markdown keymap: a part's Enter / Backspace are standardKeymap's
        // (spec: structure-input — the body's structure keys stay out of blocks).
        markdown({ base: dialectBase, extensions: dialectExtensions, addKeymap: false }),
        outer.state.facet(nestedPreview),
        livePreviewConfig.of({ ...outer.state.facet(livePreviewConfig), revealOnSelection: true }),
        markdownHighlighting,
      ],
    }),
  });
  parts.set(host, view);

  // A microtask: it runs once the dispatch that built this widget has attached
  // its DOM (toDOM returns before that) and BEFORE the next input event, so a
  // key typed right after the click / entry lands in the part, never in the
  // body (whose DOM caret sits after the block). Not rAF, which never fires in a
  // hidden tab; not setTimeout, which lets keys through in between.
  queueMicrotask(() => {
    if (!host.isConnected) return;
    const selection = entrySelection(opts.caret, view.state.doc.length, pointerPlaced);
    if (!selection) return;
    view.focus();
    // Scrolled into view (spec: caret-rules R8, 落点看得见 L2): the one place
    // every part entry passes — Tab / Enter / arrows into a cell below the
    // fold. A nested editor's scroll walks up to the outer scroller; `nearest`,
    // so a cell entered by a click (already under the pointer) does not move.
    // Then the part's whole box (a cell with its padding), in the outer scroller.
    view.dispatch({ selection, scrollIntoView: true });
    scrollBoxIntoView(outer, host.closest<HTMLElement>("td, th") ?? host);
  });
  return host;
}

/**
 * The selection a part editor opens with (spec: caret-rules R15), or null when
 * the user's pointer already placed one (change: editor-cell-fixes). The entry
 * caret is placed a tick after the editor is built; the second press of a double
 * click that entered the cell can land in between (it lands on the new editor,
 * which CodeMirror turns into a word selection — a triple click, the line), and
 * the entry caret must not then collapse that selection: typing would append
 * instead of replacing the word. Pure.
 */
export function entrySelection(
  caret: PartCaret | undefined,
  end: number,
  pointerPlaced: boolean,
): { anchor: number; head?: number } | null {
  if (pointerPlaced) return null;
  if (caret === "all") return { anchor: 0, head: end };
  const clamp = (n: number) => Math.max(0, Math.min(n, end));
  if (typeof caret === "number") return { anchor: clamp(caret) };
  if (typeof caret === "object") return { anchor: clamp(caret.anchor), head: clamp(caret.head) };
  return { anchor: caret === "start" ? 0 : end };
}

/**
 * Put an open part editor's caret at `offset` and give it focus — the undo
 * landing re-entering the part that is already being edited (caret-rules R2b).
 */
export function placePartCaret(view: EditorView, offset: PartCaret): void {
  const selection = entrySelection(offset, view.state.doc.length, false);
  if (selection) view.dispatch({ selection });
  view.focus();
}

/** Re-seed from the document (undo, agent edit, sync) without rebuilding. */
export function reseedPart(view: EditorView, text: string): void {
  if (view.state.doc.toString() === text) return;
  view.dispatch({
    changes: { from: 0, to: view.state.doc.length, insert: text },
    selection: { anchor: Math.min(view.state.selection.main.head, text.length) },
    annotations: reseed.of(true),
  });
}

/**
 * Re-issue a transaction's inserts through `accept` when it would change any
 * of them. The caret maps through the rewritten changes as it did through the
 * originals (a caret after the typed text stays after the accepted text).
 */
function acceptFilter(accept: (inserted: string, before: string) => string) {
  return EditorState.transactionFilter.of((tr) => {
    if (!tr.docChanged) return tr;
    const changes: { from: number; to: number; insert: string }[] = [];
    let rewritten = false;
    tr.changes.iterChanges((fromA, toA, _b, _c, inserted) => {
      const text = inserted.toString();
      const ok = accept(text, tr.startState.sliceDoc(0, fromA));
      if (ok !== text) rewritten = true;
      changes.push({ from: fromA, to: toA, insert: ok });
    });
    if (!rewritten) return tr;
    const next = tr.startState.changes(changes);
    const back = tr.changes.invert(tr.startState.doc);
    const selection = tr.selection
      ? EditorSelection.create(
          tr.selection.ranges.map((r) =>
            EditorSelection.range(next.mapPos(back.mapPos(r.anchor, -1), 1), next.mapPos(back.mapPos(r.head, -1), 1)),
          ),
          tr.selection.mainIndex,
        )
      : undefined;
    return { changes: next, selection, userEvent: tr.annotation(Transaction.userEvent) };
  });
}

/** The keys a part hands to the document's Find (spec: caret-rules / 落点看得见). */
export function partFindKeymap(outer: EditorView): { key: string; run: () => boolean; preventDefault: true }[] {
  return [{ key: "Mod-f", run: () => openSearchPanel(outer), preventDefault: true }];
}
