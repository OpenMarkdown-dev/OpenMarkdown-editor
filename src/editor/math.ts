import { logError } from "@/lib/log";
import { createSignal } from "@/lib/signal";
import { Facet, StateEffect, type EditorState } from "@codemirror/state";
import { environmentOf } from "./environment";
import { mathMarkup, type SafeMarkup } from "./markup";
import { type Pending, pending } from "./blocks/render";
import type {
  MarkdownConfig,
  InlineContext,
  BlockContext,
  LeafBlock,
  Line,
} from "@lezer/markdown";

/**
 * Math for the live-preview editor (change: code-highlight-and-math; the
 * delimiter rules: change editor-dialect).
 *
 * Two halves:
 * - `mathMarkdown`: a `@lezer/markdown` extension that recognizes the math
 *   delimiters as real syntax-tree nodes (InlineMath / BlockMath), so
 *   `livePreview.ts` and the HTML renderer read them by walking the tree like
 *   InlineCode / HorizontalRule — no regex pass. The delimiters and their rules
 *   are registry rows `math` and `math-tex-delimiters` (spec: markdown-dialect /
 *   数学定界符); every rule below is pinned by a vector in `../syntaxSupport.ts`:
 *     - `$…$` inline, Pandoc's `tex_math_dollars`: the opening `$` has a
 *       non-space right after it, the closing `$` a non-space right before it
 *       and no digit right after it (`$20-$30` is prose); `\$` is a dollar, also
 *       inside a formula; one line.
 *     - `$$…$$` inside a line: inline math (remark-math, Obsidian, Typora read
 *       it as math too); on a line of its own: block math.
 *     - `\(…\)` inline (LLM output); `\[ … \]` block, a paragraph of its own.
 * - the formula renderer: the host's (`EditorEnvironment.renderMath`), or the
 *   built-in TeX→MathML converter (Temml), which leans on the browser's
 *   native MathML instead of shipping KaTeX's layout engine + fonts, and is
 *   loaded only when a document actually contains math, so a doc without math
 *   pays nothing.
 */

const DOLLAR = 36; // '$'
const BACKSLASH = 92; // '\'
const OPEN_PAREN = 40; // '('
const CLOSE_PAREN = 41; // ')'
const NEWLINE = 10; // '\n'

function isSpace(code: number): boolean {
  return code === 32 || code === 9 || code === 10 || code === 13;
}

function isDigit(code: number): boolean {
  return code >= 48 && code <= 57;
}

// --- Inline `$…$` and `$$…$$` -------------------------------------------------

/**
 * `$…$` from `pos` (the opening `$`), Pandoc's `tex_math_dollars`: the end of
 * the formula, or -1. A backslash takes the next character with it (`\$` is a
 * dollar inside the formula). A space that runs into the closing `$`, a line
 * end, or a digit right after the closing `$` ends the attempt — Pandoc does
 * not look for a later `$` either.
 */
function singleDollar(cx: InlineContext, pos: number): number {
  const after = cx.char(pos + 1);
  if (after < 0 || isSpace(after)) return -1;
  for (let p = pos + 1; p < cx.end; p++) {
    const c = cx.char(p);
    if (c === NEWLINE) return -1; // inline math stays on one line
    if (c === BACKSLASH) {
      p++;
      continue;
    }
    if (c === DOLLAR) {
      if (isSpace(cx.char(p - 1))) return -1; // `$5 and $10`
      if (isDigit(cx.char(p + 1))) return -1; // `$20-$30`
      return p + 1;
    }
  }
  return -1;
}

/** `$$…$$` inside a line from `pos`: the end, or -1. Non-blank content, one line. */
function doubleDollar(cx: InlineContext, pos: number): number {
  let blank = true;
  for (let p = pos + 2; p < cx.end; p++) {
    const c = cx.char(p);
    if (c === NEWLINE) return -1;
    if (c === BACKSLASH) {
      p++;
      blank = false;
      continue;
    }
    if (c === DOLLAR && cx.char(p + 1) === DOLLAR) return blank ? -1 : p + 2;
    if (!isSpace(c)) blank = false;
  }
  return -1;
}

const inlineMathParser = {
  name: "InlineMath",
  parse(cx: InlineContext, next: number, pos: number): number {
    if (next !== DOLLAR) return -1;
    let run = 1;
    while (cx.char(pos + run) === DOLLAR) run++;
    const end = run === 1 ? singleDollar(cx, pos) : run === 2 ? doubleDollar(cx, pos) : -1;
    if (end > -1) return cx.addElement(cx.elt("InlineMath", pos, end));
    // A run that opens nothing is text as a whole, so its second `$` cannot
    // open `$…$` (`$$x$$` was read as `$` + `$x$` + `$`).
    return run === 1 ? -1 : pos + run;
  },
  // Backtick code spans are resolved before us, so `` `$x$` `` stays code.
  before: "Emphasis",
};

// --- Inline `\(…\)` ------------------------------------------------------------

/**
 * `\(…\)` on one line, non-blank. Installed before CommonMark's Escape: when it
 * finds no closing `\)`, `\(` is the escaped paren it always was.
 */
const texInlineMathParser = {
  name: "TexInlineMath",
  parse(cx: InlineContext, next: number, pos: number): number {
    if (next !== BACKSLASH || cx.char(pos + 1) !== OPEN_PAREN) return -1;
    let blank = true;
    for (let p = pos + 2; p < cx.end; p++) {
      const c = cx.char(p);
      if (c === NEWLINE) return -1;
      if (c === BACKSLASH) {
        if (cx.char(p + 1) === CLOSE_PAREN) return blank ? -1 : cx.addElement(cx.elt("InlineMath", pos, p + 2));
        p++;
        blank = false;
        continue;
      }
      if (!isSpace(c)) blank = false;
    }
    return -1;
  },
  before: "Escape",
};

// --- Block `$$…$$` -----------------------------------------------------------

const blockMathParser = {
  name: "BlockMath",
  parse(cx: BlockContext, line: Line): boolean {
    if (line.next !== DOLLAR || line.text.charCodeAt(line.pos + 1) !== DOLLAR) {
      return false;
    }
    const from = cx.lineStart + line.pos;
    const afterOpen = line.pos + 2;

    // Same-line close: `$$E = mc^2$$` on its own line.
    const closeIdx = line.text.indexOf("$$", afterOpen);
    if (closeIdx > -1) {
      // Empty (`$$$$`) or trailing content after the close → not a math block
      // (the line is a paragraph, where `$$…$$` is inline math).
      if (closeIdx <= afterOpen) return false;
      if (line.skipSpace(closeIdx + 2) !== line.text.length) return false;
      cx.addElement(cx.elt("BlockMath", from, cx.lineStart + line.text.length));
      cx.nextLine();
      return true;
    }

    // Multi-line: opening `$$` on this line, scan for a line that is just `$$`.
    // Commit like an unclosed fenced code block (consume to close or EOF).
    while (cx.nextLine()) {
      const p = line.pos;
      if (
        line.text.charCodeAt(p) === DOLLAR &&
        line.text.charCodeAt(p + 1) === DOLLAR &&
        line.skipSpace(p + 2) === line.text.length
      ) {
        cx.addElement(cx.elt("BlockMath", from, cx.lineStart + line.text.length));
        cx.nextLine();
        return true;
      }
    }
    // No closing `$$` before EOF — still a (degrading) math block to doc end.
    cx.addElement(cx.elt("BlockMath", from, cx.prevLineEnd()));
    return true;
  },
};

// --- Block `\[ … \]` -----------------------------------------------------------

/**
 * `\[ … \]` is block math when it is a whole paragraph: the paragraph's text
 * starts with `\[` and ends with `\]`, and on one line both delimiters have
 * space inside (`\[ x \]`) — a bare `\[x\]` stays the escaped brackets `[x]` it
 * is in CommonMark — and the closing `\]` is the only one. Read when the
 * paragraph is complete (a leaf parser), so an unclosed `\[` never swallows
 * the text after it, unlike `$$`.
 */
function isTexDisplayParagraph(text: string): boolean {
  const t = text.trim();
  if (t.length < 5 || !t.startsWith("\\[") || !t.endsWith("\\]") || t.endsWith("\\\\]")) return false;
  const body = t.slice(2, -2);
  // One pair: `\[ a \] and \[ b \]` is not one formula.
  if (!body.trim() || body.includes("\\]")) return false;
  if (!body.includes("\n") && !(isSpace(body.charCodeAt(0)) && isSpace(body.charCodeAt(body.length - 1)))) return false;
  return true;
}

const texBlockMathParser = {
  name: "TexBlockMath",
  leaf(_cx: BlockContext, leaf: LeafBlock) {
    if (!leaf.content.startsWith("\\[")) return null;
    return {
      nextLine: () => false,
      finish(cx: BlockContext, leaf: LeafBlock): boolean {
        if (!isTexDisplayParagraph(leaf.content)) return false;
        cx.addLeafElement(leaf, cx.elt("BlockMath", leaf.start, leaf.start + leaf.content.length));
        return true;
      },
    };
  },
};

export const mathMarkdown: MarkdownConfig = {
  defineNodes: [{ name: "InlineMath" }, { name: "BlockMath", block: true }],
  parseInline: [texInlineMathParser, inlineMathParser],
  parseBlock: [blockMathParser, texBlockMathParser],
};

/** The delimiters a math node's source is written with: lengths of the opening and closing marks. */
function delimiters(source: string): [number, number] {
  for (const [open, close] of [["\\(", "\\)"], ["\\[", "\\]"], ["$$", "$$"]] as const) {
    if (source.startsWith(open)) return [2, source.length >= 4 && source.endsWith(close) ? 2 : 0];
  }
  if (source.startsWith("$")) return [1, source.length >= 2 && source.endsWith("$") ? 1 : 0];
  return [0, 0];
}

/** Strip the delimiters (`$`, `$$`, `\(…\)`, `\[…\]`) and surrounding space from a math node's
 *  source, leaving the TeX body. The one place a formula's body is read. */
export function mathBody(source: string): string {
  const s = source.trim();
  const [open, close] = delimiters(s);
  return s.slice(open, s.length - close).trim();
}

// --- Formula renderers ---------------------------------------------------------
//
// Which renderer a state draws formulas with (change: editor-lean-deps, design
// D1; spec: live-preview-editor / 公式与图表经可替换的渲染器): the host's
// `renderMath` (its environment, `environmentOf`) when it gives one; else the
// entry's built-in converter (Temml, loaded on first use through the loader the
// entry installs — `mathLoader`); else none, and formulas stay their source.

/** Dispatched once the converter finishes loading, so the inline ViewPlugin and
 *  the block StateField rebuild and swap source→formula. Also dispatched when
 *  an editor's renderers change (`setEnvironment`). */
export const mathReadyEffect = StateEffect.define<null>();

export interface TemmlModule {
  renderToString(tex: string, options?: Record<string, unknown>): string;
}

/** Loads the built-in converter (`./mathImport.ts`). */
export type MathLoader = () => Promise<TemmlModule>;

/**
 * How this state loads the built-in converter. Unset: it has none (the entry
 * without built-in renderers, or a bare test state) — formulas render only
 * through a host's `renderMath`.
 */
export const mathLoader = Facet.define<MathLoader, MathLoader | null>({
  combine: (values) => values[0] ?? null,
});

let temml: TemmlModule | null = null;
let loading = false;
/** The load failed (change: render-placeholder-size, design D5): formulas stay their source. */
let loadFailed = false;
/** One-shot: every waiter is told once, then the signal is cleared. */
const ready = createSignal();

/** True once the built-in converter is loaded and `renderMath` can return MathML. */
export function isMathReady(): boolean {
  return temml !== null;
}

/** True once the built-in converter's load has failed: it renders nothing this session. */
export function mathLoadFailed(): boolean {
  return loadFailed;
}

/** The host's formula renderer for this state, if it gave one. */
function hostMath(state: EditorState) {
  return environmentOf(state).renderMath;
}

/**
 * Where this state's formulas are: a value that changes exactly when they
 * should redraw. A host renderer is always ready; no renderer at all draws
 * the source, as a failed load does.
 */
export function mathState(state: EditorState): "loading" | "ready" | "failed" {
  if (hostMath(state)) return "ready";
  if (!state.facet(mathLoader)) return "failed";
  return temml ? "ready" : loadFailed ? "failed" : "loading";
}

/** Must this state's built-in converter still be loaded before formulas can draw? */
export function mathNeedsLoad(state: EditorState): boolean {
  return mathState(state) === "loading";
}

/**
 * Kick off the one-time lazy load of the built-in converter through `load`.
 * `onReady` runs after the load settles — loaded or FAILED (design D5: a
 * placeholder waiting on it must hear the end either way) — asynchronously,
 * so it is safe to `view.dispatch` from it. No-ops once settled or already in
 * flight, but every caller's `onReady` fires.
 */
export function ensureMath(load: MathLoader, onReady: () => void): void {
  if (temml || loadFailed) return;
  ready.subscribe(onReady);
  if (loading) return;
  loading = true;
  load()
    .then((m) => {
      temml = m;
      ready.emit();
      ready.clear();
    })
    .catch((e: unknown) => {
      // Leave `temml` null and record the failure, so formulas show their
      // source (degrade contract) instead of waiting forever — the user still
      // reads the TeX; the developer gets the reason. Waiters are told, so the
      // placeholders turn back into source.
      logError("math converter load", e);
      loading = false;
      loadFailed = true;
      ready.emit();
      ready.clear();
    });
}

/**
 * Render a TeX body to a MathML string with the built-in converter — a
 * renderer in the block-fallback sense (`blocks/render.ts`): null while the
 * converter is not loaded ("not now"), and it THROWS on TeX it cannot render,
 * which `attemptRender` turns into the source with the failure mark (change:
 * block-fallback, design D4).
 *
 * `throwOnError: true` is load-bearing: Temml's default is false, and then a
 * parse error comes back as red `temml-error` text (source + "ParseError: …")
 * that looks like a successful render. An unknown command (`\foo`) is not an
 * error to Temml — it renders the formula and marks the command red.
 *
 * The TeX is the document's, so possibly someone else's (change:
 * editor-untrusted-content): `trust: false` is pinned here rather than left to
 * the library default, so `\href` / `\url` / `\class` / `\style` / `\data` /
 * `\includegraphics` never emit links, ids, styles or images; and the output
 * still goes through the one sanitising sink (`mathMarkup`), which refuses any
 * element outside presentation MathML (a `\ref`'s `<a>` → the failure mark) and
 * drops any attribute outside its list (a `\label`'s `id`).
 */
export function renderMath(tex: string, displayMode: boolean): SafeMarkup | null {
  if (!temml) return null;
  return mathMarkup(temml.renderToString(tex, { displayMode, throwOnError: true, trust: false }));
}

/**
 * This state's formula renderer (block, inline, table cell), with "not loaded
 * yet" told apart (change: render-placeholder-size, design D1): the host's
 * `renderMath`, its MathML through the same sanitising sink; else the
 * built-in — `pending()` while it loads, `null` once its load has failed or
 * when the state has none ("not mine": the source, unmarked), MathML
 * otherwise. It THROWS on TeX it cannot render.
 */
export function renderFormula(state: EditorState, tex: string, displayMode: boolean): SafeMarkup | Pending | null {
  const host = hostMath(state);
  if (host) return mathMarkup(host(tex, displayMode));
  if (temml && state.facet(mathLoader)) return renderMath(tex, displayMode);
  return mathState(state) === "loading" ? pending() : null;
}
