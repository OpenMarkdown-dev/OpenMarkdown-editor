import { logError } from "@/lib/log";
import { Facet, type EditorState } from "@codemirror/state";
import type { SyntaxNodeRef } from "@lezer/common";
import { codeBlockBody } from "./codeblockCopy";
import type { ColorScheme } from "./environment";
import { attemptRenderAsync, type RenderResult } from "./blocks/render";
import { diagramDeclarationProblem, mermaidMarkup, type SafeMarkup } from "./markup";

/**
 * Mermaid diagrams for the live-preview editor (change: editor-mermaid). Every
 * contact with the `mermaid` package lives in THIS module — which fences are
 * diagrams, the one-time lazy load, the one configuration we render with, and
 * the render cache — except the `import("mermaid")` expression itself, which is
 * the one line of `./mermaidImport.ts`. The block entry (`blocks/mermaid.ts`)
 * only reads the cache and asks for renders.
 *
 * Four rules shape it:
 *
 * - **Lazy.** `import("mermaid")` runs the first time a document shows a
 *   diagram, so the critical path never carries it (bundle gate:
 *   `scripts/check-bundle-budget.mjs`).
 * - **Injected.** This module never names the `mermaid` package: a state renders
 *   diagrams only when it carries a loader (`mermaidLoader`), which the full
 *   entry (`./index.ts`) installs from `./mermaidImport.ts`. The diagram-free
 *   entry (`./base.ts`, published as `@openmarkdown-dev/editor/no-diagrams`)
 *   installs none, so its import closure never reaches Mermaid and a bundler
 *   emits no Mermaid chunk (spec: editor-package / 无图表的入口).
 * - **A renderer, async.** A render either resolves to SVG or REJECTS; the
 *   rejection is caught once, by `attemptRenderAsync` in `blocks/render.ts`, and
 *   becomes the source with the failure mark (spec: block-editing / 渲染失败只在
 *   一处接住). Nothing here catches a render error.
 * - **Mermaid's config is global, mutable state.** A host that uses mermaid
 *   itself shares the module instance with us. We never leave our config behind:
 *   each render snapshots the site config, applies ours, renders through the
 *   un-queued `mermaidAPI.render`, and restores the snapshot (design D4). Our
 *   own renders are serialized so they cannot interleave with each other.
 */

// The size metric, the threshold and the wide-diagram floor: defined once in
// `./mermaidSize.ts` (a leaf the measuring script imports), read through here.
export { LARGE_DIAGRAM_SIZE, MIN_DIAGRAM_SCALE, diagramFloorWidth, diagramSize, diagramViewBox, shownDiagramWidth } from "./mermaidSize";
import { LARGE_DIAGRAM_SIZE, diagramSize } from "./mermaidSize";

/** The fence info string that marks a diagram (GitHub's: exact, lowercase). */
export const MERMAID_INFO = "mermaid";

/**
 * Whether this editor renders diagrams — `EditorStateOptions.diagrams`, per
 * editor state like `checkSpelling` (spec: editor-host / 宿主可关闭图表渲染).
 * Off: no fence is a diagram (`mermaidFence` → null), so a ```` ```mermaid ````
 * block stays an ordinary code block and nothing ever asks for — or loads —
 * Mermaid. Unset: on. Any `false` turns it off.
 */
export const diagramRendering = Facet.define<boolean, boolean>({
  combine: (values) => values.every(Boolean),
});

/** Loads the `mermaid` package (`./mermaidImport.ts`); null = this state cannot load it. */
export type MermaidLoader = () => Promise<MermaidModule>;

/**
 * How this state loads Mermaid. Unset: it never asks for a render (a diagram
 * already in the render cache still shows — how tests seed one). The full
 * entry installs `importMermaid`; the diagram-free entry installs nothing and
 * turns `diagramRendering` off.
 */
export const mermaidLoader = Facet.define<MermaidLoader, MermaidLoader | null>({
  combine: (values) => values[0] ?? null,
});

/**
 * A fenced code block that is a diagram we render (and diagrams are on —
 * `diagramRendering`): info string `mermaid`,
 * closed, and at the top level of the document (a fence inside a quote or list
 * stays a code block — design D6). Returns its line-aligned range and body.
 */
export function mermaidFence(
  state: EditorState,
  node: SyntaxNodeRef,
): { from: number; to: number; body: string } | null {
  if (node.name !== "FencedCode" || !state.facet(diagramRendering)) return null;
  const n = node.node;
  if (n.parent && n.parent.name !== "Document") return null;
  const info = n.getChild("CodeInfo");
  if (!info || state.sliceDoc(info.from, info.to).trim().split(/\s+/)[0] !== MERMAID_INFO) return null;
  // Closed: an opening and a closing fence mark. An unclosed fence runs to the
  // end of the document while it is being typed — leave it a code block.
  if (n.getChildren("CodeMark").length < 2) return null;
  const from = state.doc.lineAt(node.from).from;
  const to = state.doc.lineAt(node.to).to;
  const body = codeBlockBody(state.sliceDoc(node.from, node.to));
  return body.trim() ? { from, to, body } : null;
}

// --- The configuration we render with ---------------------------------------

/**
 * One config, always applied whole (design D4). `securityLevel: "strict"`
 * sanitizes labels and disables click handlers — a document is untrusted
 * input. `suppressErrorRendering` keeps mermaid from drawing its own error
 * "bomb" into the page: a failure is ours to show (the source + mark).
 * A system font stack, so text is measured with the same face it is painted
 * with — no web font that might still be loading when mermaid measures.
 */
export const MERMAID_FONT =
  'ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", "Helvetica Neue", Helvetica, Arial, sans-serif';

export function mermaidConfig(scheme: ColorScheme): Record<string, unknown> {
  return {
    startOnLoad: false,
    securityLevel: "strict",
    suppressErrorRendering: true,
    theme: scheme === "dark" ? "dark" : "default",
    fontFamily: MERMAID_FONT,
    logLevel: "fatal",
    maxTextSize: MAX_TEXT_SIZE,
    htmlLabels: false,
    flowchart: { htmlLabels: false },
    secure: SECURE_KEYS,
  };
}

/** mermaid's own default, stated so a directive cannot raise it. */
const MAX_TEXT_SIZE = 50000;

/**
 * Config keys a diagram's `%%{init}%%` directive or front-matter `config:` may
 * NOT set (mermaid deletes them from directives, at any depth) — design D10.
 * mermaid's defaults, plus what keeps the diagram inside our profile: labels
 * stay SVG text (`htmlLabels`), no document-supplied CSS (`themeCSS`) and no
 * font stack carrying CSS (`fontFamily`, `altFontFamily`). `theme` and
 * `themeVariables` stay overridable: mermaid reduces each variable to colour
 * characters (`[\d "#%(),.;A-Za-z]`, no `:` or braces), so they can recolour a
 * diagram but not add a property.
 */
export const SECURE_KEYS = [
  "secure", "securityLevel", "startOnLoad", "maxTextSize", "suppressErrorRendering", "maxEdges",
  "htmlLabels", "themeCSS", "fontFamily", "altFontFamily",
];

// --- Render cache -----------------------------------------------------------

/** Results kept, oldest dropped first. A document rarely has more diagrams. */
export const CACHE_LIMIT = 64;

const cacheKey = (body: string, scheme: ColorScheme) => `${scheme}\n${body}`;
const cache = new Map<string, RenderResult<SafeMarkup>>();
/**
 * Renders in flight → everyone waiting on each (a view torn down and rebuilt
 * mid-render still hears), each with whether it still wants the result.
 */
const inflight = new Map<string, Map<() => void, () => boolean>>();

// --- Large diagrams (change: mermaid-large-diagrams, D2) --------------------
// Whether the user asked for a given BLOCK is per editor state, so it lives
// with the block entry (`blocks/mermaid.ts`, `waitsForUser`); here only the size.

/** Is this a large diagram (above the threshold)? The one size comparison. */
export function isLargeDiagram(body: string): boolean {
  return diagramSize(body) > LARGE_DIAGRAM_SIZE;
}

/** Remember a finished render (also how tests seed a rendered sample). */
export function rememberMermaid(body: string, scheme: ColorScheme, result: RenderResult<SafeMarkup>): void {
  const key = cacheKey(body, scheme);
  cache.delete(key);
  cache.set(key, result);
  while (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value!);
}

/** The finished render for this source in this scheme, if there is one. */
export function cachedMermaid(body: string, scheme: ColorScheme): RenderResult<SafeMarkup> | undefined {
  return cache.get(cacheKey(body, scheme));
}

/**
 * What to show for a diagram now. The exact (source, scheme) result when there
 * is one; else, after a theme switch, the same source's render in the OTHER
 * scheme — so a diagram does not flash back to source while it re-renders
 * (design D3). Undefined = nothing yet ("not now": source, unmarked).
 */
export function shownMermaid(body: string, scheme: ColorScheme): RenderResult<SafeMarkup> | undefined {
  const exact = cachedMermaid(body, scheme);
  if (exact) return exact;
  const other = cachedMermaid(body, scheme === "dark" ? "light" : "dark");
  return other?.kind === "rendered" ? other : undefined;
}

// --- Lazy load + serialized render -------------------------------------------

interface MermaidApi {
  render(id: string, text: string): Promise<{ svg: string }>;
  getSiteConfig(): Record<string, unknown>;
}
export interface MermaidModule {
  initialize(config: Record<string, unknown>): void;
  mermaidAPI: MermaidApi;
}

let loaded: Promise<MermaidModule | null> | null = null;
let lastLoadFailed = false;

/**
 * Did the last load of mermaid fail? Then a diagram with no result is "not
 * mine" (its source, unmarked), not "not yet" — a placeholder must not wait on
 * a load that ended (change: render-placeholder-size, design D5). Cleared by
 * the next load that succeeds.
 */
export function mermaidLoadFailed(): boolean {
  return lastLoadFailed;
}

function loadMermaid(load: MermaidLoader): Promise<MermaidModule | null> {
  if (!loaded) {
    loaded = load()
      .then((m) => {
        lastLoadFailed = false;
        return m;
      })
      .catch((e: unknown) => {
        // A failed LOAD is not a diagram that cannot render: every diagram stays
        // source, unmarked; the next request tries again.
        logError("mermaid load", e);
        loaded = null;
        lastLoadFailed = true;
        return null;
      });
  }
  return loaded;
}

/**
 * The three steps of showing a diagram, as `performance` measures (change:
 * mermaid-large-diagrams, design D1): Mermaid's own layout (`render`), our
 * sanitiser (`sanitize`), and putting the SVG into the page (`insert`, in
 * `MermaidWidget.toDOM`). Read by `scripts/measure-mermaid-render.mjs`, and in
 * the app's Web Inspector timeline under the same names. Measures with explicit
 * times, so no marks pile up. Returns the end time, the next step's start.
 */
export const MERMAID_MEASURES = ["om-mermaid:render", "om-mermaid:sanitize", "om-mermaid:insert"] as const;

export function measureMermaidStep(step: "render" | "sanitize" | "insert", start: number): number {
  const end = performance.now();
  performance.measure(`om-mermaid:${step}`, { start, end });
  return end;
}

let seq = 0;
/** Our renders, one at a time (they share mermaid's global config). */
let queue: Promise<unknown> = Promise.resolve();

/**
 * Wait until the page has painted once (design D4): a large render blocks the
 * main thread, so the "Rendering…" state must be on screen before it starts.
 * A frame, then a task; a `setTimeout` fallback so a hidden page (no frames)
 * still goes on. Replaceable for tests only (`setFrameScheduler`).
 */
type FrameScheduler = (go: () => void) => void;
const paintedFrame: FrameScheduler = (go) => {
  let done = false;
  const once = () => {
    if (!done) {
      done = true;
      go();
    }
  };
  if (typeof requestAnimationFrame === "function") requestAnimationFrame(() => setTimeout(once, 0));
  setTimeout(once, 100);
};
let frameScheduler: FrameScheduler = paintedFrame;

/** Tests only: drive the "one frame" wait by hand; no argument restores it. */
export function setFrameScheduler(fn?: FrameScheduler): void {
  frameScheduler = fn ?? paintedFrame;
}

/**
 * Render `body` with our config, leaving mermaid's site config as we found it.
 * Resolves to the sanitised SVG, or rejects with mermaid's own error or the
 * sanitiser's refusal.
 */
export function renderWith(mermaid: MermaidModule, body: string, scheme: ColorScheme): Promise<SafeMarkup> {
  const before = mermaid.mermaidAPI.getSiteConfig();
  mermaid.initialize(mermaidConfig(scheme));
  const start = performance.now();
  return mermaid.mermaidAPI
    .render(`om-mermaid-${++seq}`, body)
    .then(
      // Through the editor's one HTML sink (`./markup.ts`): anything outside the
      // diagram profile throws here and the diagram falls back to its source.
      (r) => {
        const laidOut = measureMermaidStep("render", start);
        const svg = mermaidMarkup(normalizeDiagram(r.svg));
        measureMermaidStep("sanitize", laidOut);
        return svg;
      },
      (e: unknown) => {
        throw new Error(mermaidReason(e));
      },
    )
    .finally(() => mermaid.initialize(before));
}

/**
 * Bring mermaid's own output inside the diagram profile before it is vetted
 * (design D9, D10) — by dropping declarations, never adding anything:
 *   - mermaid's themes carry rules for HTML it does not draw here (tooltips,
 *     popup menus: `position: absolute`, `z-index`, `margin`), and a document's
 *     `classDef` / `style` statements can ask for `position: fixed` or a
 *     viewport-sized box. Every declaration outside `DIAGRAM_CSS_PROPERTIES`
 *     (or failing `diagramDeclarationProblem`) is dropped, in the `<style>` and
 *     in `style` attributes alike — such a request is neutralised, the diagram
 *     still draws;
 *   - the dark theme paints with `url(#<id>-gradient)` in every diagram, but
 *     only some types define that gradient; a `url()` to an id the SVG does not
 *     define is dropped (it points at nothing).
 * A mistake here can only make `mermaidMarkup` refuse a diagram, never let
 * anything through: the result is still vetted in full.
 */
export function normalizeDiagram(diagram: string): string {
  const ids = new Set([...diagram.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));
  const root = /\sid="([^"]+)"/.exec(diagram); // mermaid writes the root svg first, its id first
  const scope = "#" + (root ? root[1] : "");
  const keep = (body: string, onRoot: boolean) =>
    body
      .split(";")
      .filter((decl) => {
        const colon = decl.indexOf(":");
        if (colon < 1) return decl.trim() === "";
        const value = decl.slice(colon + 1);
        const dangling = [...value.matchAll(/url\(\s*#([\w-]+)\s*\)/g)].some((m) => !ids.has(m[1]));
        return !dangling && diagramDeclarationProblem(decl.slice(0, colon), value, onRoot) === null;
      })
      .join(";");
  const rootOnly = (prelude: string) =>
    prelude.split(",").some((sel) => sel.trim().startsWith(scope) && /^[^\s>+~&]*$/.test(sel.trim().slice(scope.length)));
  return diagram
    .replace(/(<style[^>]*>)([\s\S]*?)(<\/style>)/g, (_all, open: string, css: string, close: string) =>
      open + css.replace(/([^{}]*)\{([^{}]*)\}/g, (_r, prelude: string, body: string) => `${prelude}{${keep(body, rootOnly(prelude))}}`) + close,
    )
    .replace(/(\sstyle=")([^"]*)(")/g, (_all, open: string, body: string, close: string) => open + keep(body, false) + close);
}

/**
 * Mermaid's parse errors are several lines: "Parse error on line N:", the
 * offending line, a caret line, then "Expecting …, got …". The hover shows one
 * line (`failureReason`), so keep the first and the last — where, and what.
 * Rewording only: the error is re-thrown, never swallowed.
 */
export function mermaidReason(e: unknown): string {
  const text = e instanceof Error ? e.message : String(e);
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  if (lines.length < 2) return lines[0] ?? text;
  const reason = `${lines[0]} ${lines[lines.length - 1]}`;
  return reason.length > 200 ? `${reason.slice(0, 199)}…` : reason;
}

/**
 * Ask for (body, scheme) to be rendered. Once it has — rendered or failed —
 * `done` runs (asynchronously) so the caller can redraw. Already cached: nothing
 * to do. Already in flight: `done` joins its waiters. A failed load calls every
 * waiter too, so a placeholder turns back into source (`mermaidLoadFailed`).
 *
 * `wanted` says whether this caller still wants this exact (body, scheme). It is
 * asked when the render's turn in the queue comes: if no waiter still wants it
 * (a source typed past, a view closed), the render is dropped unrun and nobody
 * is called — a later request starts it afresh (change: mermaid-render-drawn-only,
 * design D2; spec: block-editing / 异步渲染的块, 不渲染过时的源码).
 */
export function requestMermaid(
  body: string,
  scheme: ColorScheme,
  load: MermaidLoader,
  done: () => void,
  wanted: () => boolean,
): void {
  const key = cacheKey(body, scheme);
  if (cache.has(key)) return;
  const waiting = inflight.get(key);
  if (waiting) {
    waiting.set(done, wanted);
    return;
  }
  const waiters = new Map([[done, wanted]]);
  inflight.set(key, waiters);
  queue = queue.then(async () => {
    const mermaid = await loadMermaid(load);
    if (!mermaid) {
      // The load failed: tell the waiters, whose placeholders become source.
      inflight.delete(key);
      for (const fn of waiters.keys()) queueMicrotask(fn);
      return;
    }
    const stillWanted = () => [...waiters.values()].some((w) => w());
    if (!stillWanted()) {
      inflight.delete(key);
      return;
    }
    // A large render freezes the page: let "Rendering…" paint first — and ask
    // again after it, since the source may have been typed past meanwhile.
    if (isLargeDiagram(body)) {
      await new Promise<void>((go) => frameScheduler(go));
      if (!stillWanted()) {
        inflight.delete(key);
        return;
      }
    }
    // Still in `inflight` while it renders: a request arriving now joins and hears.
    const result = await attemptRenderAsync(() => renderWith(mermaid, body, scheme));
    rememberMermaid(body, scheme, result);
    inflight.delete(key);
    // Outside the chain: a waiter that throws must not stall the renders queued after it.
    for (const fn of waiters.keys()) queueMicrotask(fn);
  });
}
