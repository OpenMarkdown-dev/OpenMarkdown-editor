import { logError } from "@/lib/log";
import { Facet, type EditorState } from "@codemirror/state";
import type { SyntaxNodeRef } from "@lezer/common";
import { codeBlockBody } from "./codeblockCopy";
import { environmentOf, type ColorScheme, type DiagramRenderer } from "./environment";
import { attemptRenderAsync, type RenderResult } from "./blocks/render";
import type { SafeMarkup } from "./markup";

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
 * - **Injected.** This module never names the `mermaid` package. A state draws
 *   diagrams with its drawer (`diagramDrawerOf`, change: editor-lean-deps):
 *   the host's `renderDiagram` when its environment gives one, else the
 *   built-in Mermaid when the state carries its loader (`mermaidLoader`),
 *   which only the full entry (`./index.ts`) installs from
 *   `./mermaidImport.ts`. The other entries install none, so their import
 *   closure never reaches Mermaid and a bundler emits no Mermaid chunk (spec:
 *   editor-package / 入口与内置渲染器).
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
 * How this state loads the built-in Mermaid. Unset: no built-in renderer — a
 * fence is a diagram only when the host gives `renderDiagram`. Only the full
 * entry installs `importMermaid`.
 */
export const mermaidLoader = Facet.define<MermaidLoader, MermaidLoader | null>({
  combine: (values) => values[0] ?? null,
});

/**
 * A fenced code block that is a diagram we render (diagrams are on —
 * `diagramRendering` — and the state has something to draw them with —
 * `diagramDrawerOf`): info string `mermaid`,
 * closed, and at the top level of the document (a fence inside a quote or list
 * stays a code block — design D6). Returns its line-aligned range and body.
 */
export function mermaidFence(
  state: EditorState,
  node: SyntaxNodeRef,
): { from: number; to: number; body: string } | null {
  if (node.name !== "FencedCode" || !state.facet(diagramRendering) || !diagramDrawerOf(state)) return null;
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

// --- Render cache -----------------------------------------------------------

/** Results kept, oldest dropped first. A document rarely has more diagrams. */
export const CACHE_LIMIT = 64;

/** Keyed by drawer (`DiagramDrawer.id`; "" is the built-in Mermaid), scheme and source. */
const cacheKey = (body: string, scheme: ColorScheme, drawer: string) => `${drawer}\n${scheme}\n${body}`;
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
export function rememberMermaid(body: string, scheme: ColorScheme, result: RenderResult<SafeMarkup>, drawer = BUILT_IN): void {
  const key = cacheKey(body, scheme, drawer);
  cache.delete(key);
  cache.set(key, result);
  while (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value!);
}

/** The finished render for this source in this scheme, if there is one. */
export function cachedMermaid(body: string, scheme: ColorScheme, drawer = BUILT_IN): RenderResult<SafeMarkup> | undefined {
  return cache.get(cacheKey(body, scheme, drawer));
}

/**
 * What to show for a diagram now. The exact (source, scheme) result when there
 * is one; else, after a theme switch, the same source's render in the OTHER
 * scheme — so a diagram does not flash back to source while it re-renders
 * (design D3). Undefined = nothing yet ("not now": source, unmarked).
 */
export function shownMermaid(body: string, scheme: ColorScheme, drawer = BUILT_IN): RenderResult<SafeMarkup> | undefined {
  const exact = cachedMermaid(body, scheme, drawer);
  if (exact) return exact;
  const other = cachedMermaid(body, scheme === "dark" ? "light" : "dark", drawer);
  return other?.kind === "rendered" ? other : undefined;
}

// --- Drawers: the host's renderer or the built-in Mermaid -------------------

/** The built-in Mermaid's drawer id (and cache namespace). */
const BUILT_IN = "";

/**
 * What draws one state's diagrams (change: editor-lean-deps, design D1):
 * `ready` settles the renderer's load (false: it failed — every diagram stays
 * source, unmarked), `render` resolves to the sanitised SVG or rejects.
 */
export interface DiagramDrawer {
  readonly id: string;
  ready(): Promise<boolean>;
  render(body: string, scheme: ColorScheme): Promise<SafeMarkup>;
  /** Did the last load fail? Then nothing is coming: source, not the placeholder. */
  loadFailed(): boolean;
}

const builtIn = new WeakMap<MermaidLoader, DiagramDrawer>();
const hosted = new WeakMap<DiagramRenderer, DiagramDrawer>();
let hostSeq = 0;

/**
 * The ONE answer to "what draws this state's diagrams": the host's
 * `renderDiagram`, else the built-in Mermaid through the state's loader, else
 * nothing (null — a fence stays a code block). The same object for the same
 * renderer, so its renders are cached once.
 */
export function diagramDrawerOf(state: EditorState): DiagramDrawer | null {
  const host = environmentOf(state).renderDiagram;
  if (host) {
    let d = hosted.get(host);
    if (!d) hosted.set(host, (d = hostDrawer(host)));
    return d;
  }
  const load = state.facet(mermaidLoader);
  return load ? mermaidDrawer(load) : null;
}

/** The built-in Mermaid's drawer for a loader (one per loader). */
export function mermaidDrawer(load: MermaidLoader): DiagramDrawer {
  let d = builtIn.get(load);
  if (!d) builtIn.set(load, (d = builtInDrawer(load)));
  return d;
}

// How a diagram is drawn — our Mermaid config, the sanitising, a host's SVG
// adopted into the profile — lives in `./mermaidRender.ts`, loaded with the
// first diagram (change: editor-lean-deps): an editor that never draws one
// never carries it.
const renderCode = () => import("./mermaidRender");

function builtInDrawer(load: MermaidLoader): DiagramDrawer {
  let mermaid: MermaidModule | null = null;
  let code: typeof import("./mermaidRender") | null = null;
  return {
    id: BUILT_IN,
    ready: () =>
      loadMermaid(load).then((m) =>
        (mermaid = m) === null ? false : renderCode().then((c) => ((code = c), true)),
      ),
    render: (body, scheme) => code!.renderWith(mermaid!, body, scheme),
    loadFailed: mermaidLoadFailed,
  };
}

/**
 * A host's renderer: no load of ours; its SVG is brought inside the diagram
 * profile and vetted exactly as Mermaid's own (`normalizeDiagram`, then the
 * one sink `mermaidMarkup`), so an injected renderer cannot put anything in
 * the page the built-in one could not.
 */
function hostDrawer(render: DiagramRenderer): DiagramDrawer {
  return {
    id: `host-${++hostSeq}`,
    ready: () => Promise.resolve(true),
    render: (body, scheme) =>
      Promise.resolve()
        .then(() => Promise.all([render(body, scheme), renderCode()]))
        .then(([drawing, code]) => code.hostDiagram(String(drawing))),
    loadFailed: () => false,
  };
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

/** The next diagram root id (`om-mermaid-N`), one sequence for every renderer. */
let seq = 0;
export const nextDiagramId = (): string => `om-mermaid-${++seq}`;
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
  drawer: DiagramDrawer,
  done: () => void,
  wanted: () => boolean,
): void {
  const key = cacheKey(body, scheme, drawer.id);
  if (cache.has(key)) return;
  const waiting = inflight.get(key);
  if (waiting) {
    waiting.set(done, wanted);
    return;
  }
  const waiters = new Map([[done, wanted]]);
  inflight.set(key, waiters);
  queue = queue.then(async () => {
    if (!(await drawer.ready())) {
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
    const result = await attemptRenderAsync(() => drawer.render(body, scheme));
    rememberMermaid(body, scheme, result, drawer.id);
    inflight.delete(key);
    // Outside the chain: a waiter that throws must not stall the renders queued after it.
    for (const fn of waiters.keys()) queueMicrotask(fn);
  });
}
