import { ViewPlugin, type EditorView } from "@codemirror/view";
import type { SyntaxNode } from "@lezer/common";
import { contentZoom } from "@/lib/zoom";
import { imageLabelRange, readImageLabel, writeImageSize } from "./imageAlt";
import { IMAGE_HANDLE_CLASS } from "./imageElement";
import { parseInlineSegments, type InlineSegment } from "./inlineCell";
import { treeUpTo } from "./syntax";
import { parseTable } from "./tableEdit";

/**
 * Drag-to-resize (spec: live-preview-editor / 拖拽调图片尺寸; change:
 * image-resize, design D3–D4) — the ONE gesture, for a body image and a
 * table-cell image alike.
 *
 * Every image frame carries a grip (`imageElement.ts`); `theme.ts` shows it on
 * an editable surface only. Pressing it is taken here, in the capture phase,
 * before the image widget or the table sees it: `preventDefault` suppresses the
 * compatibility `mousedown`, so CodeMirror does not move the caret (the image
 * does not reveal its source) and the table does not enter in-place editing.
 * Dragging resizes the picture in place — CodeMirror does not read mutations
 * inside a widget — and only the width follows the pointer; the height follows
 * the ratio. Releasing finds the label in the CURRENT document (D4: the document
 * may have changed under the drag) and writes the size through the one write
 * side, `writeImageSize`, as one transaction: one undo step, the caret mapped.
 * Esc cancels.
 *
 * Installed once per editor (main and `nestedEditorBase()`); each instance only
 * takes grips whose nearest editor is its own, so a cell being edited is its
 * own editor's business.
 */

/** Below this height (CSS px) the grip sits outside the picture's corner, not over it. */
export const SMALL_IMAGE_HEIGHT = 32;

/** The smallest width a drag may reach, in document pixels. */
export const MIN_IMAGE_WIDTH = 16;

/** The CSS width a drag has reached: the start plus the pointer's travel, inside [min, max]. Pure. */
export function dragWidth(start: number, dx: number, min: number, max: number): number {
  return Math.max(min, Math.min(start + dx, Math.max(min, max)));
}

/**
 * The size to write for a picture dragged to `cssWidth` at content zoom `zoom`:
 * the width in document pixels, and — for a label that writes both — the height
 * by the WRITTEN ratio. Pure.
 */
export function sizeToWrite(
  written: { width?: number; height?: number },
  cssWidth: number,
  zoom: number,
): { width: number; height?: number } {
  const width = Math.max(1, Math.round(cssWidth / (zoom || 1)));
  if (written.width === undefined || written.height === undefined) return { width };
  return { width, height: Math.max(1, Math.round((width * written.height) / written.width)) };
}

/** Where a label lies in a document, and whether it is written inside a table cell. */
interface LabelSite {
  from: number;
  to: number;
  inTable: boolean;
}

/** The `name` node at a widget's position (posAtDOM may report its start or its end). */
function nodeAt(view: EditorView, pos: number, name: string): SyntaxNode | null {
  const tree = treeUpTo(view.state, Math.min(view.state.doc.length, pos + 1));
  for (const side of [1, -1] as const) {
    for (let n: SyntaxNode | null = tree.resolveInner(pos, side); n; n = n.parent) if (n.name === name) return n;
  }
  return null;
}

/** The width a picture may grow to: its column's content box — the table cell, or the line. */
function columnWidth(frame: HTMLElement): number {
  const col = frame.closest<HTMLElement>("th,td") ?? frame.closest<HTMLElement>(".cm-line");
  if (!col) return Infinity;
  const cs = getComputedStyle(col);
  return col.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
}

/** The image segments of a cell, in rendering order (the order of its frames). */
function cellImages(segs: InlineSegment[], out: Extract<InlineSegment, { kind: "image" }>[] = []) {
  for (const s of segs) {
    if (s.kind === "image") out.push(s);
    else if ("children" in s) cellImages(s.children, out);
  }
  return out;
}

/** D4: the label of the picture `frame` shows, in `view`'s current document; null = it no longer lines up. */
function locate(view: EditorView, frame: HTMLElement): LabelSite | null {
  const cellEl = frame.closest<HTMLElement>("th,td");
  const wrap = cellEl?.closest<HTMLElement>(".om-table-wrap");
  if (cellEl && wrap && view.contentDOM.contains(wrap)) {
    // A picture drawn by the table widget: find its cell, then the nth image in it.
    const tableNode = nodeAt(view, view.posAtDOM(wrap), "Table");
    const table = tableNode ? parseTable(view.state.sliceDoc(tableNode.from, tableNode.to), tableNode.from) : null;
    const cell = table?.rows[Number(cellEl.dataset.omRow)]?.cells[Number(cellEl.dataset.omCol)];
    if (!cell) return null;
    const frames = [...cellEl.querySelectorAll(".om-image-frame")];
    const seg = cellImages(parseInlineSegments(cell.text))[frames.indexOf(frame)];
    return seg ? { from: cell.from + seg.labelFrom, to: cell.from + seg.labelTo, inTable: true } : null;
  }
  // A picture drawn by the image widget (the body, or a cell's own editor).
  const node = nodeAt(view, view.posAtDOM(frame), "Image");
  const range = node ? imageLabelRange(node) : null;
  return range ? { ...range, inTable: !!view.dom.closest(".om-table") } : null;
}

class ImageResize {
  private drag: {
    pointerId: number;
    frame: HTMLElement;
    img: HTMLImageElement;
    startX: number;
    startWidth: number;
    max: number;
    width: number;
    before: string;
  } | null = null;

  constructor(private readonly view: EditorView) {
    view.dom.addEventListener("pointerdown", this.onDown, true);
    view.dom.addEventListener("pointerover", this.onOver, true);
  }

  destroy() {
    this.view.dom.removeEventListener("pointerdown", this.onDown, true);
    this.view.dom.removeEventListener("pointerover", this.onOver, true);
    this.end();
  }

  /** Entering a picture: is it small enough that the grip goes outside? (Its size changes with zoom and drags.) */
  private readonly onOver = (e: PointerEvent) => {
    const frame = e.target instanceof Element ? e.target.closest<HTMLElement>(".om-image-frame") : null;
    const img = frame?.querySelector<HTMLImageElement>("img.om-image");
    if (!frame || !img || frame.closest(".cm-editor") !== this.view.dom || this.drag) return;
    if (img.getBoundingClientRect().height < SMALL_IMAGE_HEIGHT) frame.dataset.omSmall = "";
    else delete frame.dataset.omSmall;
  };

  private readonly onDown = (e: PointerEvent) => {
    const handle = e.target instanceof Element ? e.target.closest<HTMLElement>(`.${IMAGE_HANDLE_CLASS}`) : null;
    if (!handle || e.button !== 0 || this.view.state.readOnly) return;
    if (handle.closest(".cm-editor") !== this.view.dom) return;
    const frame = handle.parentElement;
    const img = frame?.querySelector<HTMLImageElement>("img.om-image");
    if (!frame || !img) return;
    e.preventDefault();
    e.stopPropagation();
    try {
      handle.setPointerCapture(e.pointerId);
    } catch {
      // A synthetic pointer (the harness) has no capture; window listeners still see it.
    }
    const zoom = contentZoom();
    const start = img.getBoundingClientRect().width;
    const column = columnWidth(frame);
    this.drag = {
      pointerId: e.pointerId,
      frame,
      img,
      startX: e.clientX,
      startWidth: start,
      max: column,
      width: start,
      before: img.style.width,
    };
    frame.dataset.omResizing = String(Math.round(start / zoom));
    handle.setAttribute("aria-pressed", "true");
    window.addEventListener("pointermove", this.onMove, true);
    window.addEventListener("pointerup", this.onUp, true);
    window.addEventListener("pointercancel", this.onCancel, true);
    window.addEventListener("keydown", this.onKey, true);
  };

  private readonly onMove = (e: PointerEvent) => {
    const d = this.drag;
    if (!d || e.pointerId !== d.pointerId) return;
    e.preventDefault();
    const zoom = contentZoom();
    d.width = dragWidth(d.startWidth, e.clientX - d.startX, MIN_IMAGE_WIDTH * zoom, d.max);
    d.img.style.width = `${d.width}px`;
    d.frame.dataset.omResizing = String(Math.round(d.width / zoom));
  };

  private readonly onUp = (e: PointerEvent) => {
    const d = this.drag;
    if (!d || e.pointerId !== d.pointerId) return;
    e.preventDefault();
    const site = locate(this.view, d.frame);
    const label = site ? this.view.state.sliceDoc(site.from, site.to) : null;
    const edit = site && label !== null
      ? writeImageSize(label, sizeToWrite(readImageLabel(label), d.width, contentZoom()), site.inTable)
      : null;
    this.end();
    if (site && edit) {
      this.view.dispatch({
        changes: { from: site.from + edit.from, to: site.from + edit.to, insert: edit.insert },
        userEvent: "input.resize",
      });
    }
  };

  private readonly onCancel = () => this.end();

  private readonly onKey = (e: KeyboardEvent) => {
    if (!this.drag || e.key !== "Escape") return;
    e.preventDefault();
    e.stopPropagation();
    this.end();
  };

  /** Stop listening and put the picture back as it was; a write (if any) redraws it anew. */
  private end() {
    const d = this.drag;
    if (!d) return;
    this.drag = null;
    d.img.style.width = d.before;
    delete d.frame.dataset.omResizing;
    d.frame.querySelector(`.${IMAGE_HANDLE_CLASS}`)?.removeAttribute("aria-pressed");
    window.removeEventListener("pointermove", this.onMove, true);
    window.removeEventListener("pointerup", this.onUp, true);
    window.removeEventListener("pointercancel", this.onCancel, true);
    window.removeEventListener("keydown", this.onKey, true);
  }
}

export const imageResize = ViewPlugin.fromClass(ImageResize);
