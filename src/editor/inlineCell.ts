/**
 * Inline markdown rendering for table cells (changes: table-cell-render-and-overflow,
 * cell-tree).
 *
 * `TableWidget` renders in DETACHED DOM (raw `<td>` outside the document flow), so
 * the editor's CM6 inline decorations — anchored on document offsets — can't reach
 * into it. A cell is therefore parsed on its own, by THE editor grammar
 * (`dialectMarkdownParser`: the same CommonMark + GFM + registered dialects the
 * body uses), and its inline tree mapped to DOM here. There is no second inline
 * parser: what strikes, what is math, what an image label is, is decided by the
 * grammar alone (spec: live-preview-editor / 格内 inline 渲染).
 *
 * Split in two so the risky part is node-testable without a DOM (no jsdom here):
 *   - `parseInlineSegments(text) -> Segment[]`  PURE, tree→data, unit-tested.
 *   - `renderInlineCell(text) -> DocumentFragment`  thin DOM mapper.
 *
 * How each inline node is drawn in a cell is the table `CELL_NODES`; a node the
 * grammar produces that is not in it fails `inlineCell.gate.test.ts`, so a new
 * inline dialect has to decide its cell drawing first. Anything not rendered —
 * a cell that parses as a block, raw HTML, an image outside the whitelist —
 * degrades to literal source text, never throwing and never swallowing content.
 */

import type { SyntaxNode } from "@lezer/common";
import { dialectMarkdownParser } from "./dialectParser";
import { readImageLabel, type ImageLabel } from "./imageAlt";
import { imageElement } from "./imageElement";
import { mathBody, renderMath } from "./math";
import { setMarkup } from "./markup";
import { attemptRender, failedSourceElement } from "./blocks/render";
import { cellDisplaySource } from "./tableEdit";

export type InlineSegment =
  | { kind: "text"; text: string }
  | { kind: "code"; text: string }
  | { kind: "strong"; children: InlineSegment[] }
  | { kind: "em"; children: InlineSegment[] }
  | { kind: "strike"; children: InlineSegment[] }
  | { kind: "link"; href: string; children: InlineSegment[] }
  /** `source` is the node as written (`$…$`), shown while the converter loads or when the TeX fails. */
  | { kind: "math"; source: string }
  /**
   * `url` as written (resolved at render); `source` is the text shown if it can't
   * be. `labelFrom` / `labelTo`: where the `[…]` text lies in the cell's source —
   * drag-to-resize writes the size back there (change: image-resize, design D4).
   */
  | { kind: "image"; url: string; label: ImageLabel; source: string; labelFrom: number; labelTo: number };

/**
 * How a cell draws each inline node the editor grammar produces — the one
 * definition (change: cell-tree, design D3). `render`: drawn as the segment of
 * the same name below. `source`: shown as its source text — either it is not
 * drawn in cells, or it is a mark / part its parent node reads (`EmphasisMark`,
 * `URL` …) and only reaches here on its own when the grammar says so (a bare
 * GFM autolink is a lone `URL`: plain text, as before).
 */
export const CELL_NODES: Record<string, "render" | "source"> = {
  StrongEmphasis: "render",
  Emphasis: "render",
  Strikethrough: "render",
  InlineCode: "render",
  Link: "render",
  Image: "render",
  InlineMath: "render",
  Escape: "render",
  // Parts of the nodes above, read by their parent.
  EmphasisMark: "source",
  StrikethroughMark: "source",
  CodeMark: "source",
  CodeText: "source",
  LinkMark: "source",
  LinkLabel: "source",
  LinkTitle: "source",
  URL: "source",
  // Not drawn in cells: their source shows.
  Autolink: "source",
  HTMLTag: "source",
  Comment: "source",
  ProcessingInstruction: "source",
  Entity: "source",
  HardBreak: "source",
  // A quote's `>` on a lazy continuation line: never inside a one-line cell.
  QuoteMark: "source",
};

function kids(node: SyntaxNode): SyntaxNode[] {
  const out: SyntaxNode[] = [];
  for (let c = node.firstChild; c; c = c.nextSibling) out.push(c);
  return out;
}

/** Push text, joining it onto a text segment just before it. */
function pushText(out: InlineSegment[], text: string): void {
  if (!text) return;
  const last = out[out.length - 1];
  if (last?.kind === "text") last.text += text;
  else out.push({ kind: "text", text });
}

/**
 * Segments for `src[from, to)`, reading the nodes among `children` that lie in it;
 * the gaps between them are text.
 */
/**
 * The text a cell is parsed from (GFM's: `\|` already turned into `|`, see
 * `cellDisplaySource`) and, for each of its offsets, where it sits in the
 * cell's source as written.
 */
interface CellText {
  source: string;
  text: string;
  at: number[];
}

function segmentsIn(cell: CellText, children: SyntaxNode[], from: number, to: number): InlineSegment[] {
  const src = cell.text;
  const out: InlineSegment[] = [];
  let at = from;
  for (const c of children) {
    if (c.to <= from || c.from >= to) continue;
    pushText(out, src.slice(at, c.from));
    const seg = CELL_NODES[c.name] === "render" ? segmentOf(cell, c) : null;
    if (seg) {
      if (seg.kind === "text") pushText(out, seg.text);
      else out.push(seg);
    } else pushText(out, src.slice(c.from, c.to));
    at = c.to;
  }
  pushText(out, src.slice(at, to));
  return out;
}

/** The content between a node's opening and closing marks (`**`, `~~`, `` ` ``…). */
function between(node: SyntaxNode, mark: string): [number, number] | null {
  const marks = kids(node).filter((c) => c.name === mark);
  if (marks.length < 2) return null;
  return [marks[0].to, marks[marks.length - 1].from];
}

/** A rendered node as a segment; null = show its source. */
function segmentOf(cell: CellText, node: SyntaxNode): InlineSegment | null {
  const src = cell.text;
  const children = kids(node);
  switch (node.name) {
    case "Escape":
      return { kind: "text", text: src.slice(node.from + 1, node.to) };
    case "InlineCode": {
      const r = between(node, "CodeMark");
      return r ? { kind: "code", text: src.slice(r[0], r[1]) } : null;
    }
    case "InlineMath":
      return { kind: "math", source: src.slice(node.from, node.to) };
    case "StrongEmphasis":
    case "Emphasis":
    case "Strikethrough": {
      const r = between(node, node.name === "Strikethrough" ? "StrikethroughMark" : "EmphasisMark");
      if (!r) return null;
      const kind = node.name === "StrongEmphasis" ? "strong" : node.name === "Emphasis" ? "em" : "strike";
      return { kind, children: segmentsIn(cell, children, r[0], r[1]) };
    }
    case "Link":
    case "Image": {
      // `[` label `]` `(` URL `)` — `![` for an image. Reference links and the
      // like (no URL) show their source.
      const marks = children.filter((c) => c.name === "LinkMark");
      const url = children.find((c) => c.name === "URL");
      if (marks.length < 2 || !url) return null;
      const [labelFrom, labelTo] = [marks[0].to, marks[1].from];
      if (node.name === "Image") {
        // `source` and the label offsets address the cell's source as written
        // (with its `\|`): drag-to-resize writes back there.
        const { at } = cell;
        return {
          kind: "image",
          url: src.slice(url.from, url.to),
          label: readImageLabel(src.slice(labelFrom, labelTo)),
          source: cell.source.slice(at[node.from], at[node.to]),
          labelFrom: at[labelFrom],
          labelTo: at[labelTo],
        };
      }
      return { kind: "link", href: src.slice(url.from, url.to), children: segmentsIn(cell, children, labelFrom, labelTo) };
    }
  }
  return null;
}

/**
 * Parse a cell's source into inline segments, by the editor grammar. As GFM
 * does, the cell's `\|` escapes become `|` first — so `` `a\|b` `` is the code
 * `a|b` (change: editor-cell-fixes). The cell is read as one paragraph; a cell
 * that the grammar reads as anything else (a heading, a list, a quote…) is shown
 * as its text — a cell holds inline content only. Offsets (an image's label)
 * address `src`, the cell as written.
 */
export function parseInlineSegments(src: string): InlineSegment[] {
  if (!src) return [];
  const cell: CellText = { source: src, ...cellDisplaySource(src) };
  const text = cell.text;
  const blocks = kids(dialectMarkdownParser.parse(text).topNode);
  const para = blocks.length === 1 && blocks[0].name === "Paragraph" ? blocks[0] : null;
  if (!para || text.slice(0, para.from).trim() || text.slice(para.to).trim()) return [{ kind: "text", text }];
  return segmentsIn(cell, kids(para), 0, text.length);
}

/** Resolve an image path to a loadable URL; null = outside the whitelist (`livePreviewConfig`). */
type ResolveImage = (src: string) => string | null;

/**
 * A cell's inline formula, by the body's rule (spec: 格内行内公式): the converter
 * not loaded yet → the source, and `requestMath` (the editor loads the converter
 * and redraws — see `TableWidget.mathReady`); TeX it cannot render → the source with the one
 * failure mark, the reason on hover; otherwise the formula.
 */
function mathElement(source: string, requestMath: () => void): Node {
  const out = attemptRender(() => renderMath(mathBody(source), false));
  if (out.kind === "source") {
    requestMath();
    return document.createTextNode(source);
  }
  if (out.kind === "failed") return failedSourceElement(source, out.reason);
  const el = document.createElement("span");
  el.className = "om-math-inline";
  // Sanitised MathML (`renderMath` → `markup.ts`), through the one sink.
  setMarkup(el, out.value);
  return el;
}

/** Append segments as DOM under `parent` (thin, no logic — mirrors the segment tree). */
function appendSegments(parent: Node, segs: InlineSegment[], resolveImage: ResolveImage, requestMath: () => void): void {
  for (const s of segs) {
    switch (s.kind) {
      case "text":
        parent.appendChild(document.createTextNode(s.text));
        break;
      case "code": {
        const el = document.createElement("code");
        el.className = "om-inline-code";
        el.textContent = s.text;
        parent.appendChild(el);
        break;
      }
      case "strong": {
        const el = document.createElement("strong");
        appendSegments(el, s.children, resolveImage, requestMath);
        parent.appendChild(el);
        break;
      }
      case "em": {
        const el = document.createElement("em");
        appendSegments(el, s.children, resolveImage, requestMath);
        parent.appendChild(el);
        break;
      }
      case "strike": {
        // `<s>` is line-through and nothing else — the body's strikethrough style.
        const el = document.createElement("s");
        appendSegments(el, s.children, resolveImage, requestMath);
        parent.appendChild(el);
        break;
      }
      case "math":
        parent.appendChild(mathElement(s.source, requestMath));
        break;
      case "link": {
        // Still a <span>, not an <a> — an <a href> would drag in the browser's own
        // navigation (an external URL would navigate the app's own webview away),
        // middle-click, drag-as-link and context-menu semantics, and it would
        // resolve `./x.md` as a URL rather than against the document's directory.
        // The target rides in a data attribute instead, so the widget's mousedown
        // can route a Cmd/Ctrl+click through the SAME classifier body links use
        // (change: table-cell-link-navigation). A plain click still falls through
        // to "edit this cell" — the appearance is unchanged either way.
        const el = document.createElement("span");
        el.className = "om-link";
        el.dataset.omHref = s.href;
        if (s.children.length) appendSegments(el, s.children, resolveImage, requestMath);
        else el.textContent = s.href; // `[](url)` → show the href as visible text
        parent.appendChild(el);
        break;
      }
      case "image": {
        // Outside the whitelist / unresolvable → the source, as a body image does
        // (spec: 白名单外路径降级).
        const url = resolveImage(s.url);
        parent.appendChild(url == null ? document.createTextNode(s.source) : imageElement(url, s.label));
        break;
      }
    }
  }
}

/**
 * Render a table cell's trimmed source text into a DOM fragment with inline
 * markdown styled. Thin wrapper over `parseInlineSegments` — the parse is the
 * tested part; this just maps the tree to elements. `resolveImage` is the
 * editor's own (`livePreviewConfig`), so a cell image loads from where a body
 * image would; `requestMath` asks the editor to load the formula converter.
 */
export function renderInlineCell(text: string, resolveImage: ResolveImage, requestMath: () => void): DocumentFragment {
  const frag = document.createDocumentFragment();
  appendSegments(frag, parseInlineSegments(text), resolveImage, requestMath);
  return frag;
}
