import { logError } from "@/lib/log";
import { createSignal } from "@/lib/signal";
import { StateEffect } from "@codemirror/state";
import { mathMarkup, type SafeMarkup } from "./markup";
import { type Pending, pending } from "./blocks/render";
import type {
  MarkdownConfig,
  InlineContext,
  BlockContext,
  Line,
} from "@lezer/markdown";

/**
 * Inline (`$…$`) + block (`$$…$$`) math for the live-preview editor
 * (change: code-highlight-and-math).
 *
 * Two halves:
 * - `mathMarkdown`: a `@lezer/markdown` extension that recognizes `$`/`$$` as
 *   real syntax-tree nodes (InlineMath / BlockMath), so `livePreview.ts` renders
 *   them by walking the tree exactly like InlineCode / HorizontalRule — no regex
 *   pass. Delimiter rules reject prose dollars (`$5 and $10`) the CommonMark-math
 *   way: no space just inside a delimiter, non-empty content.
 * - a lazily-loaded TeX→MathML converter (Temml) that leans on the WebView's
 *   native MathML instead of shipping KaTeX's layout engine + fonts. Loaded only
 *   when a document actually contains math (mirrors `src/lib/sync.ts`'s
 *   `diff-match-patch` dynamic import), so a doc without `$` pays nothing.
 */

const DOLLAR = 36; // '$'
const NEWLINE = 10; // '\n'

function isSpace(code: number): boolean {
  return code === 32 || code === 9 || code === 10 || code === 13;
}

// --- Inline `$…$` -----------------------------------------------------------

const inlineMathParser = {
  name: "InlineMath",
  parse(cx: InlineContext, next: number, pos: number): number {
    if (next !== DOLLAR) return -1;
    // `$$` is the block parser's job — don't open inline math on it.
    if (cx.char(pos + 1) === DOLLAR) return -1;
    // Opening `$` must be followed by a non-space, non-EOL char.
    const after = cx.char(pos + 1);
    if (after < 0 || isSpace(after)) return -1;
    for (let p = pos + 1; p < cx.end; p++) {
      const c = cx.char(p);
      if (c === NEWLINE) return -1; // inline math stays on one line
      if (c === DOLLAR) {
        // Non-empty content, and no space directly before the closing `$`
        // (this is what rejects `$5 and $10` — the char before the 2nd `$`
        // is a space).
        if (p > pos + 1 && !isSpace(cx.char(p - 1))) {
          return cx.addElement(cx.elt("InlineMath", pos, p + 1));
        }
        return -1;
      }
    }
    return -1;
  },
  // Backtick code spans are resolved before us, so `` `$x$` `` stays code.
  before: "Emphasis",
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
      // Empty (`$$$$`) or trailing content after the close → not a math block.
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

export const mathMarkdown: MarkdownConfig = {
  defineNodes: [{ name: "InlineMath" }, { name: "BlockMath", block: true }],
  parseInline: [inlineMathParser],
  parseBlock: [blockMathParser],
};

/** Strip the `$` / `$$` delimiters (and surrounding space) from a math node's
 *  source, leaving the TeX body. */
export function mathBody(source: string): string {
  return source
    .trim()
    .replace(/^\$+/, "")
    .replace(/\$+$/, "")
    .trim();
}

// --- Lazy TeX→MathML converter (Temml) --------------------------------------

/** Dispatched once the converter finishes loading, so the inline ViewPlugin and
 *  the block StateField rebuild and swap source→formula. */
export const mathReadyEffect = StateEffect.define<null>();

interface TemmlModule {
  renderToString(tex: string, options?: Record<string, unknown>): string;
}

let temml: TemmlModule | null = null;
let loading = false;
/** The load failed (change: render-placeholder-size, design D5): formulas stay their source. */
let loadFailed = false;
/** One-shot: every waiter is told once, then the signal is cleared. */
const ready = createSignal();

/** True once the converter is loaded and `renderMath` can return MathML. */
export function isMathReady(): boolean {
  return temml !== null;
}

/** Where the converter is: a value that changes exactly when formulas should redraw. */
export function mathState(): "loading" | "ready" | "failed" {
  return temml ? "ready" : loadFailed ? "failed" : "loading";
}

/** True once the converter's load has failed: no formula will render this session. */
export function mathLoadFailed(): boolean {
  return loadFailed;
}

/**
 * Kick off the one-time lazy load of the converter. `onReady` runs after the
 * load settles — loaded or FAILED (design D5: a placeholder waiting on it must
 * hear the end either way) — asynchronously, so it is safe to `view.dispatch`
 * from it. No-ops once settled or already in flight, but every caller's
 * `onReady` fires.
 */
export function ensureMath(onReady: () => void): void {
  if (temml || loadFailed) return;
  ready.subscribe(onReady);
  if (loading) return;
  loading = true;
  import("temml")
    .then((m) => {
      temml = ((m as unknown as { default?: TemmlModule }).default ??
        (m as unknown as TemmlModule));
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
 * Render a TeX body to a MathML string — a renderer in the block-fallback sense
 * (`blocks/render.ts`): null while the converter is not loaded ("not now"), and
 * it THROWS on TeX it cannot render, which `attemptRender` turns into the source
 * with the failure mark (change: block-fallback, design D4).
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
 * The editor's formula renderer (block, inline, table cell): `renderMath`'s
 * answer with "not loaded yet" told apart (change: render-placeholder-size,
 * design D1) — `pending()` while the converter is loading (the placeholder),
 * `null` once its load has failed ("not mine": the source, unmarked), MathML
 * otherwise; it THROWS on TeX it cannot render.
 */
export function renderFormula(tex: string, displayMode: boolean): SafeMarkup | Pending | null {
  if (temml) return renderMath(tex, displayMode);
  return loadFailed ? null : pending();
}
