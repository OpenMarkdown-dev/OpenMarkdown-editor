import type { SyntaxNode, Tree } from "@lezer/common";
import { dialectMarkdownParser } from "../dialectParser";
import { calloutTitle, parseCallout } from "../callout";
import { readImageLabel } from "../imageAlt";
import { githubSlugs } from "../headingSlug";
import { matchAgentTokens } from "../agentMention";
import { renderMath } from "../math";
import { MERMAID_INFO } from "../mermaid";
import { parseProps } from "../frontmatterProps";
import { isRemoteSrc } from "../imageResolve";
import { standaloneMarkup, type SafeMarkup } from "../markup";

/**
 * THE renderer: markdown → semantic HTML (spec: markdown-render; change:
 * render-export). One renderer for every rendered-output need — exported HTML,
 * exported PDF (the same HTML), rich copy and the editor package's
 * `renderHTML` — and it reads the document through the SAME grammar the editor
 * uses (`dialectMarkdownParser`, the one configured markdown parser). There is
 * no second Markdown library, so what the editor shows and what an export
 * shows come from one parse.
 *
 * Every construct in the `markdown-dialect` register has a rule here, listed in
 * `DIALECT_RENDER` (`./dialectRules.ts`); the gate `render.gate.test.ts` fails
 * when the register gains a row without one.
 *
 * Untrusted input (the editor renders other people's documents): every piece of
 * document text is escaped; raw HTML in the document is SHOWN as text, never
 * interpreted (the editor shows it as source too); a link or image whose URL
 * has a scheme outside http / https / mailto (or, for an image, `data:image/`)
 * keeps its text but loses its target. Markup the renderer did not write
 * itself enters only as `SafeMarkup` — the editor's one sanitising sink
 * (`../markup.ts`) — from the math and diagram renderers.
 *
 * Text is never changed: what is not markup reaches the output, escaped, as
 * written. Links to local files are kept as written (decided 2026-11-06): they
 * work when the reader has the file alongside.
 */

export interface RenderOptions {
  /**
   * TeX → MathML. Default: the editor's own converter (`renderMath`), which
   * answers null until it is loaded — then the TeX source is shown (the
   * editor's own degrade). Throwing counts as "cannot render" too.
   */
  math?: (tex: string, display: boolean) => SafeMarkup | null;
  /**
   * A mermaid fence body → its drawing. Mermaid needs a DOM, so the renderer
   * cannot draw on its own: a caller in a webview draws first (`collectAssets`
   * lists the bodies) and answers here. Default / null → the fence is shown as
   * a code block, which is how GitHub-less readers see it too.
   */
  diagram?: (body: string) => SafeMarkup | null;
  /**
   * An image's `src` as written → the URL to put in the page (an exporter
   * answers a `data:` URI for a local file). Null / absent → the src as
   * written.
   */
  image?: (src: string) => string | null;
}

/** Everything a caller may want to prepare before rendering (local images, diagrams). */
export interface RenderAssets {
  /** Every image `src` as written, in document order, duplicates removed. */
  images: string[];
  /** Every mermaid fence body, in document order, duplicates removed. */
  diagrams: string[];
}

const esc = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

/**
 * A URL as a browser reads it (WHATWG URL parsing): ASCII tab / LF / CR removed
 * anywhere, C0 controls and spaces trimmed at both ends. Classifying the RAW
 * text instead would let `java\tscript:` pass as a relative path while the
 * browser runs it as `javascript:`. Null when a control character is left
 * inside — no legitimate link or image needs one.
 */
export function browserUrl(url: string): string | null {
  // eslint-disable-next-line no-control-regex
  const u = url.replace(/[\t\n\r]/g, "").replace(/^[\u0000-\u0020]+|[\u0000-\u0020]+$/g, "");
  // eslint-disable-next-line no-control-regex
  if (!u || /[\u0000-\u001f\u007f]/.test(u)) return null;
  return u;
}

/** A link target the page may carry, or null (the link keeps its text, loses its target). */
export function safeHref(url: string): string | null {
  const u = browserUrl(url);
  if (!u) return null;
  if (!isRemoteSrc(u)) return u; // relative path, `#anchor`, `/abs/path`
  return /^(https?|mailto):/i.test(u) ? u : null;
}

/** An image source the page may carry, or null. */
export function safeImageSrc(src: string): string | null {
  const u = browserUrl(src);
  if (!u) return null;
  if (!isRemoteSrc(u)) return u;
  return /^(https?:|data:image\/)/i.test(u) ? u : null;
}

const ENTITY = /^&(#\d{1,7}|#[xX][0-9a-fA-F]{1,6}|[a-zA-Z][a-zA-Z0-9]{1,31});$/;

/** CommonMark link-label normalisation: case-fold, collapse whitespace. */
const labelKey = (label: string): string => label.trim().replace(/\s+/g, " ").toLowerCase();

/** Strip one `<…>` pair from a link destination. */
const destination = (raw: string): string => {
  const t = raw.trim();
  return t.startsWith("<") && t.endsWith(">") ? t.slice(1, -1) : t;
};

/** A link title without its quotes. */
const titleText = (raw: string): string => raw.trim().slice(1, -1);

interface Ref {
  url: string;
  title: string | null;
}

interface Heading {
  placeholder: string;
  text: string;
}

const MARKS = new Set([
  "QuoteMark",
  "ListMark",
  "HeaderMark",
  "EmphasisMark",
  "StrikethroughMark",
  "CodeMark",
  "LinkMark",
  "TaskMarker",
  "TableDelimiter",
]);

/** The text an HTML fragment shows: tags dropped, the few entities this file writes decoded. */
function plainOf(html: string): string {
  return html
    .replace(/<[^>]*>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");
}

/** A fenced block's content lines, with container marks (`> `) and the fence's own indent removed. */
function fenceBodyOf(src: string, node: SyntaxNode): string {
  const marks = node.getChildren("CodeMark");
  const open = marks[0];
  const firstLineEnd = src.indexOf("\n", open ? open.to : node.from);
  if (firstLineEnd === -1 || firstLineEnd >= node.to) return "";
  const close = marks.length > 1 ? marks[marks.length - 1] : null;
  const end = close ? src.lastIndexOf("\n", close.from) : node.to;
  if (end <= firstLineEnd) return "";
  const lineStart = src.lastIndexOf("\n", node.from) + 1;
  const indent = node.from - lineStart;
  const quoteMarks = node.getChildren("QuoteMark");
  let body = "";
  let pos = firstLineEnd + 1;
  for (const q of quoteMarks) {
    if (q.from < pos || q.from >= end) continue;
    body += src.slice(pos, q.from);
    pos = q.to;
    if (src[pos] === " ") pos++;
  }
  body += src.slice(pos, end);
  if (indent === 0) return body;
  const re = new RegExp(`^ {0,${indent}}`, "gm");
  return body.replace(re, "");
}


class Renderer {
  private readonly refs = new Map<string, Ref>();
  private readonly headings: Heading[] = [];

  constructor(
    private readonly src: string,
    private readonly tree: Tree,
    private readonly opts: RenderOptions,
  ) {
    const top = tree.topNode;
    for (let c = top.firstChild; c; c = c.nextSibling) this.collectRefs(c);
  }

  private collectRefs(node: SyntaxNode): void {
    if (node.name === "LinkReference") {
      const label = node.getChild("LinkLabel");
      const url = node.getChild("URL");
      if (label && url) {
        const key = labelKey(this.text(label).slice(1, -1));
        const title = node.getChild("LinkTitle");
        if (!this.refs.has(key)) this.refs.set(key, { url: destination(this.text(url)), title: title ? titleText(this.text(title)) : null });
      }
      return;
    }
    for (let c = node.firstChild; c; c = c.nextSibling) this.collectRefs(c);
  }

  private text(node: { from: number; to: number }): string {
    return this.src.slice(node.from, node.to);
  }

  render(): string {
    let out = "";
    for (let c = this.tree.topNode.firstChild; c; c = c.nextSibling) out += this.block(c, false);
    const slugs = githubSlugs(this.headings.map((h) => h.text));
    this.headings.forEach((h, i) => {
      out = out.replace(h.placeholder, esc(slugs[i]));
    });
    return out;
  }

  // --- blocks ---------------------------------------------------------------

  private children(node: SyntaxNode, tight: boolean): string {
    let out = "";
    for (let c = node.firstChild; c; c = c.nextSibling) out += this.block(c, tight);
    return out;
  }

  private block(node: SyntaxNode, tight: boolean): string {
    const name = node.name;
    if (MARKS.has(name) || name === "LinkReference") return "";
    const h = /^(?:ATX|Setext)Heading([1-6])$/.exec(name);
    if (h) return this.heading(node, Number(h[1]));
    switch (name) {
      case "Frontmatter":
        return this.frontmatter(node);
      case "Paragraph": {
        const inner = this.inline(node, node.from, node.to);
        return tight ? inner : `<p>${inner}</p>\n`;
      }
      case "Blockquote":
        return this.blockquote(node);
      case "BulletList":
        return `<ul>\n${this.listItems(node)}</ul>\n`;
      case "OrderedList": {
        const mark = node.firstChild?.getChild("ListMark");
        const start = mark ? parseInt(this.text(mark), 10) : 1;
        return `<ol${start !== 1 && Number.isFinite(start) ? ` start="${start}"` : ""}>\n${this.listItems(node)}</ol>\n`;
      }
      case "FencedCode":
        return this.fenced(node);
      case "CodeBlock":
        return this.codeBlock(this.indented(node), null);
      case "BlockMath":
        return this.blockMath(node);
      case "HorizontalRule":
        return "<hr>\n";
      case "HTMLBlock":
      case "CommentBlock":
      case "ProcessingInstructionBlock":
        return `<pre class="om-html-source"><code>${esc(this.text(node))}</code></pre>\n`;
      case "Table":
        return this.table(node);
      default:
        // An unknown block is never lost: its source, as text.
        return `<p>${esc(this.text(node))}</p>\n`;
    }
  }

  private heading(node: SyntaxNode, level: number): string {
    // Content: the node minus its HeaderMark(s); Setext's underline is a HeaderMark too.
    const marks = node.getChildren("HeaderMark");
    let from = node.from;
    let to = node.to;
    if (node.name.startsWith("ATX")) {
      if (marks[0]) from = marks[0].to;
      if (marks.length > 1) to = marks[marks.length - 1].from;
    } else if (marks.length) {
      to = marks[marks.length - 1].from;
    }
    const inner = this.inline(node, from, to).trim();
    const placeholder = `\u0000H${this.headings.length}\u0000`;
    this.headings.push({ placeholder, text: plainOf(inner) });
    return `<h${level} id="${placeholder}">${inner}</h${level}>\n`;
  }

  private frontmatter(node: SyntaxNode): string {
    const props = parseProps(this.src);
    if (!props || props.props.length === 0) {
      return `<pre class="om-props-source"><code>${esc(this.text(node))}</code></pre>\n`;
    }
    const rows = props.props
      .map((p) => {
        // A multi-line value (a list, a block scalar) is shown as written.
        const value = p.editable ? p.value : this.src.slice(p.valueFrom, p.linesTo).replace(/\n$/, "");
        return `<tr><th scope="row">${esc(p.key)}</th><td>${esc(value)}</td></tr>`;
      })
      .join("\n");
    return `<table class="om-props">\n<tbody>\n${rows}\n</tbody>\n</table>\n`;
  }

  private blockquote(node: SyntaxNode): string {
    const first = node.firstChild && MARKS.has(node.firstChild.name) ? node.firstChild.nextSibling : node.firstChild;
    if (first && first.name === "Paragraph") {
      const lineEnd = this.src.indexOf("\n", first.from);
      const firstLine = this.src.slice(first.from, lineEnd === -1 || lineEnd > first.to ? first.to : lineEnd);
      const callout = parseCallout(firstLine);
      if (callout) {
        let body = "";
        if (lineEnd !== -1 && lineEnd < first.to) {
          const rest = this.inline(first, lineEnd + 1, first.to).trim();
          if (rest) body += `<p>${rest}</p>\n`;
        }
        for (let c = first.nextSibling; c; c = c.nextSibling) body += this.block(c, false);
        return (
          `<div class="om-callout om-callout-${callout.type}">\n` +
          `<p class="om-callout-title">${esc(calloutTitle(callout.type))}</p>\n${body}</div>\n`
        );
      }
    }
    return `<blockquote>\n${this.children(node, false)}</blockquote>\n`;
  }

  /** A list is loose when a blank line separates its items or the blocks inside one. */
  private loose(list: SyntaxNode): boolean {
    for (let item = list.firstChild; item; item = item.nextSibling) {
      if (item.nextSibling && /\n[ \t>]*\n/.test(this.src.slice(item.to, item.nextSibling.from + 1))) return true;
      let blocks = 0;
      for (let c = item.firstChild; c; c = c.nextSibling) {
        if (MARKS.has(c.name)) continue;
        if (blocks++ > 0 && /\n[ \t>]*\n/.test(this.src.slice(c.prevSibling!.to, c.from))) return true;
      }
    }
    return false;
  }

  private listItems(list: SyntaxNode): string {
    const tight = !this.loose(list);
    let out = "";
    for (let item = list.firstChild; item; item = item.nextSibling) {
      if (item.name !== "ListItem") continue;
      const task = item.getChild("Task");
      if (task) {
        const marker = task.getChild("TaskMarker");
        const checked = marker ? /x/i.test(this.text(marker)) : false;
        const inner = this.inline(task, marker ? marker.to : task.from, task.to).trim();
        const rest = this.restOfItem(task, tight);
        const box = `<input type="checkbox" disabled${checked ? " checked" : ""}> `;
        out += `<li class="om-task${checked ? " om-task-done" : ""}">${tight ? box + inner : `<p>${box}${inner}</p>`}${rest}</li>\n`;
        continue;
      }
      out += `<li>${this.children(item, tight)}</li>\n`;
    }
    return out;
  }

  private restOfItem(after: SyntaxNode, tight: boolean): string {
    let out = "";
    for (let c = after.nextSibling; c; c = c.nextSibling) out += this.block(c, tight);
    return out ? `\n${out}` : "";
  }

  private fenced(node: SyntaxNode): string {
    const info = node.getChild("CodeInfo");
    const lang = info ? this.text(info).trim().split(/\s+/)[0] : "";
    const body = fenceBodyOf(this.src, node);
    if (lang.toLowerCase() === MERMAID_INFO) {
      const drawn = this.opts.diagram ? this.attempt(() => this.opts.diagram!(body)) : null;
      if (drawn) return `<figure class="om-mermaid">${drawn}</figure>\n`;
    }
    return this.codeBlock(body, lang || null);
  }

  private indented(node: SyntaxNode): string {
    return this.text(node).replace(/^ {4}|^\t/gm, "");
  }

  private codeBlock(body: string, lang: string | null): string {
    const cls = lang ? ` class="language-${esc(lang)}"` : "";
    return `<pre class="om-code"><code${cls}>${esc(body.replace(/\n$/, ""))}</code></pre>\n`;
  }

  /** The one place drawn markup enters the page: as plain HTML (`standaloneMarkup`). */
  private attempt(f: () => SafeMarkup | null): string | null {
    try {
      const m = f();
      return m === null ? null : standaloneMarkup(m);
    } catch {
      return null;
    }
  }

  private mathOf(tex: string, display: boolean): string | null {
    const f = this.opts.math ?? renderMath;
    return this.attempt(() => f(tex, display));
  }

  private blockMath(node: SyntaxNode): string {
    const source = this.text(node);
    const tex = source.trim().replace(/^\$\$/, "").replace(/\$\$$/, "").trim();
    const drawn = this.mathOf(tex, true);
    if (drawn) return `<div class="om-math-block">${drawn}</div>\n`;
    return `<pre class="om-math-source"><code>${esc(source)}</code></pre>\n`;
  }

  private table(node: SyntaxNode): string {
    const delim = node.getChildren("TableDelimiter").find((d) => /-/.test(this.text(d)));
    const aligns = delim
      ? this.text(delim)
          .trim()
          .replace(/^\|/, "")
          .replace(/\|$/, "")
          .split("|")
          .map((c) => {
            const t = c.trim();
            const l = t.startsWith(":");
            const r = t.endsWith(":");
            return l && r ? "center" : r ? "right" : l ? "left" : null;
          })
      : [];
    const row = (r: SyntaxNode, tag: "th" | "td"): string => {
      const cells = r.getChildren("TableCell");
      const n = Math.max(cells.length, tag === "th" ? cells.length : aligns.length || cells.length);
      let out = "<tr>";
      for (let i = 0; i < n; i++) {
        const c = cells[i];
        const a = aligns[i];
        const cls = a ? ` class="om-align-${a}"` : "";
        out += `<${tag}${cls}>${c ? this.inline(c, c.from, c.to).trim() : ""}</${tag}>`;
      }
      return out + "</tr>\n";
    };
    const header = node.getChild("TableHeader");
    const rows = node.getChildren("TableRow");
    let out = '<div class="om-table-wrap">\n<table>\n';
    if (header) out += `<thead>\n${row(header, "th")}</thead>\n`;
    if (rows.length) out += `<tbody>\n${rows.map((r) => row(r, "td")).join("")}</tbody>\n`;
    return out + "</table>\n</div>\n";
  }

  // --- inline ---------------------------------------------------------------

  /** Inline content of `node` between `from` and `to`: text gaps escaped, child nodes rendered. */
  private inline(node: SyntaxNode, from: number, to: number): string {
    let out = "";
    let pos = from;
    for (let c = node.firstChild; c; c = c.nextSibling) {
      if (c.to <= from || c.from >= to) continue;
      if (c.from > pos) out += this.textRun(this.src.slice(pos, c.from));
      out += this.inlineNode(c);
      pos = Math.max(pos, c.to);
    }
    if (pos < to) out += this.textRun(this.src.slice(pos, to));
    return out;
  }

  /** Plain text, escaped, with `@agent` tokens marked (registry row `agent-mention`). */
  private textRun(text: string): string {
    let out = "";
    const lines = text.split("\n");
    lines.forEach((line, i) => {
      let pos = 0;
      for (const tok of matchAgentTokens(line)) {
        out += esc(line.slice(pos, tok.from)) + `<span class="om-agent">${esc(line.slice(tok.from, tok.to))}</span>`;
        pos = tok.to;
      }
      out += esc(line.slice(pos));
      if (i < lines.length - 1) out += "\n";
    });
    return out;
  }

  /** Content between a node's first and last mark of `markName`. */
  private between(node: SyntaxNode, markName: string): string {
    const marks = node.getChildren(markName);
    const from = marks[0] ? marks[0].to : node.from;
    const to = marks.length > 1 ? marks[marks.length - 1].from : node.to;
    return this.inline(node, from, to);
  }

  private inlineNode(node: SyntaxNode): string {
    switch (node.name) {
      case "Emphasis":
        return `<em>${this.between(node, "EmphasisMark")}</em>`;
      case "StrongEmphasis":
        return `<strong>${this.between(node, "EmphasisMark")}</strong>`;
      case "Strikethrough":
        return `<del>${this.between(node, "StrikethroughMark")}</del>`;
      case "InlineCode": {
        const marks = node.getChildren("CodeMark");
        let body = this.src.slice(marks[0]?.to ?? node.from, marks.length > 1 ? marks[marks.length - 1].from : node.to);
        body = body.replace(/\n/g, " ");
        if (/^ .*[^ ].* $/.test(body)) body = body.slice(1, -1);
        return `<code>${esc(body)}</code>`;
      }
      case "InlineMath": {
        const source = this.text(node);
        const tex = source.replace(/^\$+/, "").replace(/\$+$/, "").trim();
        const drawn = this.mathOf(tex, false);
        return drawn ? `<span class="om-math">${drawn}</span>` : `<code class="om-math-source">${esc(source)}</code>`;
      }
      case "Link":
        return this.link(node, false);
      case "Image":
        return this.link(node, true);
      case "Autolink": {
        const url = node.getChild("URL");
        const u = url ? this.text(url) : this.text(node).slice(1, -1);
        const href = /^[^@\s]+@[^@\s]+$/.test(u) && !/^[a-z][a-z0-9+.-]*:/i.test(u) ? `mailto:${u}` : u;
        const safe = safeHref(href);
        return safe ? `<a href="${esc(safe)}">${esc(u)}</a>` : esc(this.text(node));
      }
      case "URL": {
        // A bare GFM autolink (`https://…`, `www.…`, an email).
        const u = this.text(node);
        const href = /^www\./i.test(u) ? `http://${u}` : /^[^@\s:/]+@[^@\s]+$/.test(u) ? `mailto:${u}` : u;
        const safe = safeHref(href);
        return safe ? `<a href="${esc(safe)}">${esc(u)}</a>` : esc(u);
      }
      case "Escape":
        return esc(this.text(node).slice(1));
      case "Entity": {
        const t = this.text(node);
        return ENTITY.test(t) ? t : esc(t);
      }
      case "HardBreak":
        return "<br>\n";
      case "HTMLTag":
      case "Comment":
      case "ProcessingInstruction":
        return esc(this.text(node)); // shown as written, never interpreted
      default:
        if (MARKS.has(node.name)) return "";
        return this.inline(node, node.from, node.to);
    }
  }

  /** `[text](url)`, `[text][ref]`, `[ref]`, and the same with `!` for images. */
  private link(node: SyntaxNode, image: boolean): string {
    const marks = node.getChildren("LinkMark");
    const open = marks[0];
    const close = marks.find((m, i) => i > 0 && this.text(m) === "]");
    if (!open || !close) return this.textRun(this.text(node));
    const labelFrom = open.to;
    const labelTo = close.from;
    let url: string | null = null;
    let title: string | null = null;
    const urlNode = node.getChild("URL");
    if (urlNode) {
      url = destination(this.text(urlNode));
      const t = node.getChild("LinkTitle");
      title = t ? titleText(this.text(t)) : null;
    } else {
      const ref = node.getChild("LinkLabel");
      const key = labelKey(ref ? this.text(ref).slice(1, -1) || this.src.slice(labelFrom, labelTo) : this.src.slice(labelFrom, labelTo));
      const hit = this.refs.get(key);
      if (!hit) {
        // No such reference: not a link (CommonMark) — the brackets stay as text.
        return esc(this.src.slice(node.from, labelFrom)) + this.inline(node, labelFrom, labelTo) + this.textRun(this.src.slice(labelTo, node.to));
      }
      url = hit.url;
      title = hit.title;
    }
    const titleAttr = title ? ` title="${esc(title)}"` : "";
    if (image) {
      const label = readImageLabel(this.src.slice(labelFrom, labelTo));
      const mapped = this.opts.image?.(url) ?? null;
      const src = safeImageSrc(mapped ?? url);
      const alt = esc(label.alt);
      if (!src) return `<span class="om-image-missing">${alt}</span>`;
      const size =
        (label.width ? ` width="${label.width}"` : "") + (label.height ? ` height="${label.height}"` : "");
      return `<img src="${esc(src)}" alt="${alt}"${size}${titleAttr}>`;
    }
    const inner = this.inline(node, labelFrom, labelTo);
    const href = safeHref(url);
    return href ? `<a href="${esc(href)}"${titleAttr}>${inner}</a>` : inner;
  }
}

/** Markdown → an HTML fragment (no `<html>` / `<head>`; see `./document.ts` for a whole page). */
export function renderHTML(markdown: string, options: RenderOptions = {}): string {
  const tree = dialectMarkdownParser.parse(markdown);
  return new Renderer(markdown, tree, options).render();
}

/** The images and diagrams a document needs prepared before `renderHTML` (pure). */
export function collectAssets(markdown: string): RenderAssets {
  const tree = dialectMarkdownParser.parse(markdown);
  const images: string[] = [];
  const diagrams: string[] = [];
  tree.iterate({
    enter: (n) => {
      if (n.name === "Image") {
        const url = n.node.getChild("URL");
        if (url) {
          const u = destination(markdown.slice(url.from, url.to));
          if (!images.includes(u)) images.push(u);
        }
      } else if (n.name === "FencedCode") {
        const info = n.node.getChild("CodeInfo");
        if (info && markdown.slice(info.from, info.to).trim().split(/\s+/)[0].toLowerCase() === MERMAID_INFO) {
          const body = fenceBodyOf(markdown, n.node);
          if (!diagrams.includes(body)) diagrams.push(body);
        }
      }
    },
  });
  return { images, diagrams };
}
