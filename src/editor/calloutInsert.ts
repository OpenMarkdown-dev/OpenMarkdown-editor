/**
 * Pure callout-skeleton insertion (change: callout-insert-command).
 *
 * A callout is a GFM blockquote whose first content line is `[!TYPE]` (see
 * `callout.ts`). Inserting one means dropping a minimal `> [!TYPE]` marker line
 * + one empty `> ` body line at a safe block boundary, with blank-line isolation
 * on both sides (a GFM blockquote must be separated from surrounding content),
 * and landing the caret in the empty body line so the user types the body next.
 *
 * Pure (unit-tested; an `EditorView` can't be built in node — see CLAUDE.md).
 * Block-boundary / leading-trailing-newline logic mirrors `insertTableChange`
 * (`tableEdit.ts`) — both are block-level insertion entry points that must not
 * split a surrounding paragraph.
 */
import type { CalloutType } from "./callout";

export interface CalloutInsertChange {
  from: number;
  to: number;
  insert: string;
  anchor: number;
  head: number;
}

function trailingNewlines(s: string): number {
  let n = 0;
  for (let i = s.length - 1; i >= 0 && s[i] === "\n"; i--) n++;
  return n;
}

function leadingNewlines(s: string): number {
  let n = 0;
  for (let i = 0; i < s.length && s[i] === "\n"; i++) n++;
  return n;
}

/**
 * Offset just past the block containing `cursor`: extend through the contiguous
 * run of non-blank lines so the new callout anchors AFTER the whole paragraph,
 * never splitting it. A blank cursor line returns its own start (insert in
 * place). Mirrors `blockEndOffset` in `tableEdit.ts`.
 */
function blockEndOffset(doc: string, cursor: number): number {
  const n = doc.length;
  const lineStart = doc.lastIndexOf("\n", cursor - 1) + 1;
  let lineEnd = doc.indexOf("\n", cursor);
  if (lineEnd < 0) lineEnd = n;
  if (doc.slice(lineStart, lineEnd).trim() === "") return lineStart;
  let end = lineEnd;
  while (end < n) {
    const ns = end + 1;
    let ne = doc.indexOf("\n", ns);
    if (ne < 0) ne = n;
    if (doc.slice(ns, ne).trim() === "") break;
    end = ne;
  }
  return end;
}

/**
 * Insert a minimal legal `> [!TYPE]` callout skeleton at a safe block boundary
 * near `cursor` (spec: live-preview-editor / Callout 插入(命令)). The marker
 * keyword is the UPPERCASE type. The caret (anchor === head) lands right after
 * the second `> ` — in the empty body line — ready for immediate typing.
 * Returns a pure insertion (`from === to`); the caller makes it one undo unit.
 */
export function calloutInsertChange(
  doc: string,
  cursor: number,
  type: CalloutType,
): CalloutInsertChange {
  const at = blockEndOffset(doc, cursor);
  const before = doc.slice(0, at);
  const after = doc.slice(at);
  // Marker line + one empty body line; caret lands after this whole skeleton.
  const skeleton = `> [!${type.toUpperCase()}]\n> `;

  // Blank-line separation on both sides (GFM blockquotes must be block-isolated).
  const lead = before === "" ? "" : "\n".repeat(Math.max(0, 2 - trailingNewlines(before)));
  const trail = after === "" ? "\n" : "\n".repeat(Math.max(0, 2 - leadingNewlines(after)));

  const insert = lead + skeleton + trail;
  // Caret right after the second `> ` (end of the skeleton), in the empty body.
  const caret = at + lead.length + skeleton.length;
  return { from: at, to: at, insert, anchor: caret, head: caret };
}
