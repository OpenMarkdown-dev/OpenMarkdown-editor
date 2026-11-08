import { Annotation, EditorState, Prec, Transaction } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { standardKeymap } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import { dialectBase, dialectExtensions } from "../dialectParser";
import { livePreviewConfig } from "../previewConfig";
import { markdownHighlighting } from "../theme";
import { flattenCellInsert } from "../tableEdit";
import { nestedEditorBase, nestedPreview } from "./nested";

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
  /** Flatten pasted / typed line breaks into spaces (a GFM cell is one line). */
  singleLine?: boolean;
  /**
   * Where the caret lands on entry; "all" selects the whole part (a new name); a
   * number is an offset into the part (an undo landing there, caret-rules R2b).
   */
  caret?: PartCaret;
}

/** Where a part editor's caret lands when it opens (spec: caret-rules R15). */
export type PartCaret = "start" | "end" | "all" | number;

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
        opts.singleLine
          ? EditorState.transactionFilter.of((tr) => {
              let broken = false;
              tr.changes.iterChanges((_a, _b, _c, _d, inserted) => {
                if (/\r?\n/.test(inserted.toString())) broken = true;
              });
              if (!broken) return tr;
              // Re-issue the same changes with line breaks flattened; the caret
              // maps through them as it would have.
              const changes: { from: number; to: number; insert: string }[] = [];
              tr.changes.iterChanges((fromA, toA, _b, _c, inserted) => {
                changes.push({ from: fromA, to: toA, insert: flattenCellInsert(inserted.toString()) });
              });
              return { changes, selection: tr.selection, userEvent: tr.annotation(Transaction.userEvent) };
            })
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

  // setTimeout, not requestAnimationFrame: rAF never fires in a hidden tab, and
  // the widget DOM is not attached yet when toDOM returns.
  setTimeout(() => {
    if (!host.isConnected) return;
    const selection = entrySelection(opts.caret, view.state.doc.length, pointerPlaced);
    if (!selection) return;
    view.focus();
    view.dispatch({ selection });
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
  if (typeof caret === "number") return { anchor: Math.max(0, Math.min(caret, end)) };
  return { anchor: caret === "start" ? 0 : end };
}

/**
 * Put an open part editor's caret at `offset` and give it focus — the undo
 * landing re-entering the part that is already being edited (caret-rules R2b).
 */
export function placePartCaret(view: EditorView, offset: number): void {
  view.dispatch({ selection: { anchor: Math.max(0, Math.min(offset, view.state.doc.length)) } });
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
