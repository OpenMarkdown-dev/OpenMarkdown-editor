import type { EditorState } from "@codemirror/state";
import type { SyntaxNode } from "@lezer/common";

/**
 * What a markdown image's `[…]` says — the ONE reading of it (spec:
 * markdown-dialect / 图片尺寸写法; live-preview-editor / 图片的 alt 只有一个读法;
 * change: image-size, design D1–D2).
 *
 * The label of `![截图|300x200](a.png)` is `截图|300x200`: alt 「截图」, width 300,
 * height 200. Everything that needs an image's alt or size — the rendered image
 * (`livePreview.ts`), plain copy (`plainCopy.ts`), the table-cell image
 * (`inlineCell.ts`), and later drag-to-resize — asks here. Gate: `imageAlt.gate.test.ts`.
 *
 * - Only the LAST separator counts: `a|b|300` is alt 「a|b」, width 300.
 * - `\|` is a separator exactly like `|`, inside a table or not (D2): GFM turns a
 *   cell's `\|` back into `|` before reading the cell, and outside a table `\|`
 *   is CommonMark's escaped literal `|` — so both read as the same alt. A table
 *   cell's own editor sees the raw `\|`, and reads it right without knowing it
 *   is in a table.
 * - After the separator, up to the end, exactly `<w>` or `<w>x<h>`: decimal
 *   digits, each > 0, lowercase `x`, nothing else — no spaces, units or points.
 *   Anything else is not a size, and the WHOLE label is the alt (as on GitHub).
 *
 * The write side is here too (`writeImageSize`, change: image-resize D2): the
 * one place that writes a size into a label, for drag-to-resize.
 */

export interface ImageLabel {
  alt: string;
  width?: number;
  height?: number;
}

const SIZE = /^([0-9]+)(?:x([0-9]+))?$/;

/** The `[…]` text → its alt and, if one is written, its size. Pure. */
export function readImageLabel(label: string): ImageLabel {
  const bar = label.lastIndexOf("|");
  if (bar < 0) return { alt: label };
  const m = SIZE.exec(label.slice(bar + 1));
  if (!m) return { alt: label };
  const width = Number(m[1]);
  const height = m[2] === undefined ? undefined : Number(m[2]);
  if (!(width > 0) || (height !== undefined && !(height > 0))) return { alt: label };
  const alt = label.slice(0, label[bar - 1] === "\\" ? bar - 1 : bar);
  return height === undefined ? { alt, width } : { alt, width, height };
}

/**
 * The edit that writes `size` into an image label (spec: markdown-dialect /
 * 图片尺寸写法 — the write side; change: image-resize, design D2). Offsets are
 * relative to the label's start. Only the size part changes:
 *
 * - a size already written → its digits are replaced, the separator kept as it
 *   is (`|` or `\|`);
 * - no size → `|W` (`\|W` in a table cell, where a bare `|` splits the cell) is
 *   appended;
 * - the same size as written → null: no edit.
 *
 * `height` is passed only for a label that writes one; the caller keeps the
 * written ratio. Pure.
 */
export function writeImageSize(
  label: string,
  size: { width: number; height?: number },
  inTable: boolean,
): { from: number; to: number; insert: string } | null {
  const digits = size.height === undefined ? `${size.width}` : `${size.width}x${size.height}`;
  const read = readImageLabel(label);
  if (read.width === undefined) {
    return { from: label.length, to: label.length, insert: (inTable ? "\\|" : "|") + digits };
  }
  if (read.width === size.width && read.height === size.height) return null;
  const from = label.lastIndexOf("|") + 1;
  return { from, to: label.length, insert: digits };
}

/**
 * Where an `Image` syntax node's label lies in the document: between its `![`
 * and `]` marks (the tree knows the brackets, so an alt holding `[b]` reads
 * whole). Null when the node is not shaped like an image.
 */
export function imageLabelRange(image: SyntaxNode): { from: number; to: number } | null {
  const open = image.firstChild;
  const close = open ? markAfter(open) : null;
  if (!open || open.name !== "LinkMark" || !close) return null;
  return { from: open.to, to: close.from };
}

/** The label of an `Image` syntax node, read. */
export function imageLabelOf(state: EditorState, image: SyntaxNode): ImageLabel {
  const range = imageLabelRange(image);
  return range ? readImageLabel(state.sliceDoc(range.from, range.to)) : { alt: "" };
}

/** The `]` mark: the first LinkMark after the opening `![`. */
function markAfter(open: SyntaxNode): SyntaxNode | null {
  for (let c = open.nextSibling; c; c = c.nextSibling) if (c.name === "LinkMark") return c;
  return null;
}

/**
 * Is `before` (a line up to the caret) inside an IMAGE's unfinished target —
 * `![alt](par` — rather than a link's? Link completion offers only images
 * there (change image-viewer). The syntax tree cannot answer it: an unclosed
 * `(` is not an image node yet.
 */
export function inImageTarget(before: string): boolean {
  return /!\[[^\]]*\]\([^)]*$/.test(before);
}
