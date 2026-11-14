/**
 * The two copy flavors: RENDERED plain text, and the markdown source slice
 * (spec: live-preview-editor / 复制口味:渲染后纯文字与 markdown 源码).
 *
 * Cmd+C is NOT one of them. It writes the markdown source in every mode, reading
 * mode included, and this module deliberately no longer intercepts the `copy`
 * event to change that (change: copy-flavors, design D1). Source is lossless —
 * you can always strip it later — while plain text is not, and copy/paste WITHIN
 * a document must never quietly drop formatting. So the lossy flavor is reached
 * only when the user names it: ⌘⇧C, the command palette, or the selection
 * context menu, all three routed through `selectionCopyText` below.
 *
 * WHY NOT just read the DOM selection: CodeMirror only renders `visibleRanges`.
 * Rows outside the viewport do not exist in the DOM at all, so `getSelection()`
 * on a long document would silently copy short — a silent data loss, the exact
 * class of bug `fix-silent-data-loss` exists to prevent. Instead the text is
 * derived from the syntax tree over the selected range, which is
 * viewport-independent and (unlike anything touching a view) unit-testable:
 * `EditorState` is constructible in node, `EditorView` is not.
 */

import { EditorState } from "@codemirror/state";
import type { SyntaxNode, Tree } from "@lezer/common";
import {
  FORMATTING_MARKS,
  TASK_GLYPH,
  linkTextIsEmpty,
  listMarkStandIn,
} from "./previewConceal";
import { chipLabel } from "./refChip";
import { calloutTitle } from "./callout";
import { calloutOf } from "./insets/stack";
import { mathBody } from "./math";
import { parseProps } from "./frontmatterProps";
import { frontmatterChipSummary } from "./skill";
import { boundedTree } from "./syntax";
import { isLink, linkMarkConcealable, referenceLabels, type ReferenceLabels } from "./linkRefs";
import { imageLabelOf } from "./imageAlt";
import { parseTable, serializeTable, tableDataFromParsed } from "./tableEdit";

/** A source span that renders as something other than itself. `text` = "" drops it. */
interface Replacement {
  from: number;
  to: number;
  text: string;
}

const childrenOf = (node: SyntaxNode): SyntaxNode[] => {
  const out: SyntaxNode[] = [];
  for (let c = node.firstChild; c; c = c.nextSibling) out.push(c);
  return out;
};

/**
 * Collect every span in `[from, to)` that the reader does not see as itself.
 * Mirrors the conceal decisions in `livePreview.ts`'s `enterNode`, minus all of
 * its reveal-on-touch machinery — reading mode never reveals, so every
 * concealable node here IS concealed.
 */
function collectReplacements(
  state: EditorState,
  tree: Tree,
  from: number,
  to: number,
  labels: ReferenceLabels,
): Replacement[] {
  const out: Replacement[] = [];
  const read = (a: number, b: number) => state.sliceDoc(a, b);
  const push = (f: number, t: number, text = "") => {
    if (t > f) out.push({ from: f, to: t, text });
  };

  tree.iterate({
    from,
    to,
    enter: (node) => {
      const name = node.name;

      // A bracket is dropped only when its pair is a link (the one predicate,
      // `linkRefs.ts`): `[!FOOBAR]` and an undefined `[foo]` copy as written.
      if (name === "LinkMark") {
        if (linkMarkConcealable(node.node, read, labels)) push(node.from, node.to);
        return;
      }

      if (FORMATTING_MARKS.has(name)) {
        // `# heading` / `> quote` also swallow the space after the marker.
        let end = node.to;
        if (
          (name === "HeaderMark" || name === "QuoteMark") &&
          state.sliceDoc(end, end + 1) === " "
        ) {
          end += 1;
        }
        push(node.from, end);
        return;
      }

      switch (name) {
        case "Link": {
          if (!isLink(node.node, read, labels)) return; // text, copied as written
          const url = childrenOf(node.node).find((c) => c.name === "URL");
          if (url && linkTextIsEmpty(node.from, url.from)) {
            // `[](url)` renders as a short label derived from the URL, not blank.
            push(node.from, node.to, chipLabel(state.sliceDoc(url.from, url.to)));
            return false; // children already covered by the whole-link span
          }
          // Only the label is visible; `(url "title")` is hidden. The surrounding
          // LinkMark children are dropped by the LinkMark rule above; a
          // reference link's `[r]` / `[]` goes too (`[a][r]` reads `a`).
          for (const child of childrenOf(node.node)) {
            if (child.name === "URL" || child.name === "LinkTitle" || child.name === "LinkLabel") push(child.from, child.to);
          }
          return;
        }

        case "Image": {
          // An image's only plain-text carrier is its alt text — without the
          // size (spec: 图片的 alt 只有一个读法).
          push(node.from, node.to, imageLabelOf(state, node.node).alt);
          return false;
        }

        case "HorizontalRule":
          // A rule is a line, not words — the line survives, its text does not.
          push(node.from, node.to);
          return false;

        case "ListMark": {
          const item = node.node.parent;
          // The renderer's own answer: `1.` is visible and copied as is; a
          // bullet renders as `•`; a task's `-` renders as nothing (its
          // checkbox is the marker, copied below as ☐ / ☑).
          const standIn = item ? listMarkStandIn(item) : null;
          if (standIn === null) return;
          // A dropped `-` takes its space with it, or the copy would start with one.
          const end = !standIn && state.sliceDoc(node.to, node.to + 1) === " " ? node.to + 1 : node.to;
          push(node.from, end, standIn);
          return;
        }

        case "TaskMarker": {
          const checked = /x/i.test(state.sliceDoc(node.from, node.to));
          const end = state.sliceDoc(node.to, node.to + 1) === " " ? node.to + 1 : node.to;
          // Glyph + space: the marker's own trailing space is inside the concealed
          // span, and without it the label would butt against the box.
          push(node.from, end, (checked ? TASK_GLYPH.checked : TASK_GLYPH.unchecked) + " ");
          return;
        }

        case "InlineMath":
        case "BlockMath":
          // A formula has no plain-text form; its TeX body loses the least.
          push(node.from, node.to, mathBody(state.sliceDoc(node.from, node.to)));
          return false;

        case "Frontmatter": {
          // Rendered as the Properties block — copied as its rows on one line —
          // or, when it can't be parsed, shown (and so copied) as its YAML
          // source. Both read the one property reading (change: missing-gates).
          const yaml = state.sliceDoc(node.from, node.to);
          if (parseProps(yaml)) push(node.from, node.to, frontmatterChipSummary(yaml));
          return false;
        }

        case "Blockquote": {
          // A callout's marker (fold suffix included) renders as an icon + title
          // header; copied as the title. Read through the one callout reading
          // (`calloutOf`), so a callout nested in a list copies alike.
          const callout = calloutOf(state, node.node);
          if (callout) push(callout.from, callout.markerTo, calloutTitle(callout.type));
          return;
        }

        case "Table": {
          // A grid's plain-text carrier is its GFM pipe text: already aligned,
          // readable, and structure-preserving where flattening to one line is
          // not. Cell markup is stripped like anywhere else — that falls out of
          // the walk descending into the cells, and has always been so. What is
          // added here is the RE-FLOW: widths laid out for `**销售额**` leave that
          // cell short once the marks go, and the whole table reads ragged.
          //
          // Only a selection covering the WHOLE table re-flows. Half a table has
          // no correct column widths (it need not even include the header), so
          // the branch stands down and the walk descends instead: marks still go,
          // widths are left alone, and — the load-bearing part — no row outside
          // the selection can leak in (design D3). A malformed table degrades the
          // same way.
          if (node.from < from || node.to > to) return;
          const parsed = parseTable(state.sliceDoc(node.from, node.to), node.from);
          if (!parsed) return;
          const reflowed = serializeTable(
            tableDataFromParsed(parsed, (cell) =>
              renderWith(state, tree, cell.from, cell.to, labels),
            ),
          );
          push(node.from, node.to, reflowed);
          return false;
        }
      }
    },
  });

  return out;
}

/** Rendered text plus whether the parse covered all of it (change: syntax-access). */
export interface RenderedText {
  text: string;
  /**
   * False when the bounded parse stopped inside the range: past that point the
   * text is the markdown source, and the caller MUST say so.
   */
  complete: boolean;
}

/**
 * The text a reader sees for `[from, to)` — markers dropped, widgets replaced by
 * their visible stand-ins. Pure: no view, no DOM, no viewport. A whole-range
 * consumer: the tree comes from the bounded parse, and `complete` says whether
 * it reached `to`.
 */
export function renderedTextForRange(state: EditorState, from: number, to: number): RenderedText {
  if (to <= from) return { text: "", complete: true };
  const { tree, complete } = boundedTree(state, to);
  // Reference definitions may sit after the range: their labels come from the
  // whole-document parse (bounded too — a definition it has not reached reads
  // as text, the predicate's safe side).
  const whole = boundedTree(state).tree;
  const labels = referenceLabels(whole, (a, b) => state.sliceDoc(a, b));
  return { text: renderWith(state, tree, from, to, labels), complete };
}

function renderWith(state: EditorState, tree: Tree, from: number, to: number, labels: ReferenceLabels): string {
  if (to <= from) return "";
  const spans = collectReplacements(state, tree, from, to, labels).sort((a, b) => a.from - b.from);

  let out = "";
  let pos = from;
  for (const span of spans) {
    const end = Math.min(span.to, to);
    if (end <= pos) continue; // already consumed by an enclosing span
    const start = Math.max(span.from, from);
    if (start > pos) out += state.sliceDoc(pos, start);
    out += span.text;
    pos = end;
  }
  return out + state.sliceDoc(pos, to);
}

/** Which of the two named flavors a copy action asks for. */
export type CopyFlavor = "plain" | "markdown";

/**
 * The text `flavor` puts on the clipboard for `state`'s current selection, or
 * null when nothing is selected. `complete` is false when the plain flavor's
 * bounded parse stopped inside the selection (change: syntax-access).
 *
 * Null rather than "" on purpose: an empty selection is a NO-OP, and the caller
 * must leave the clipboard alone rather than blank it (spec: 空选区复制为无操作).
 * Multiple ranges join with newlines, matching CodeMirror's own multi-range copy.
 *
 * Pure over (state, selection) — no view, no DOM, no viewport — so the whole
 * derivation stays unit-testable; only the clipboard write needs a browser.
 */
export function selectionCopyText(state: EditorState, flavor: CopyFlavor): RenderedText | null {
  const ranges = state.selection.ranges.filter((r) => !r.empty);
  if (ranges.length === 0) return null;
  const parts = ranges.map((r) =>
    flavor === "plain"
      ? renderedTextForRange(state, r.from, r.to)
      : { text: state.sliceDoc(r.from, r.to), complete: true },
  );
  return { text: parts.map((p) => p.text).join("\n"), complete: parts.every((p) => p.complete) };
}
