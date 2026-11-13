import { EditorView, keymap, drawSelection, dropCursor, highlightSpecialChars } from "@codemirror/view";
import { EditorState, Compartment, Transaction, type Extension } from "@codemirror/state";
import { editorConfig, setEditorConfig, type EditorConfig, type EditorHost, type EditorMode } from "./host";
import { editorEnvironment, type ColorScheme } from "./environment";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { search, searchKeymap, highlightSelectionMatches } from "@codemirror/search";
import { markdown } from "@codemirror/lang-markdown";
import { dialectBase, dialectExtensions } from "./dialectParser";
import { blockArrowKeymap } from "./blocks/arrows";
import { languages } from "@codemirror/language-data";
import { codeFolding, foldKeymap } from "@codemirror/language";
import { editorTheme, markdownHighlighting, sourceHighlighting } from "./theme";
import { schemeAttribute } from "./tokens";
import { contentZoomMeasure } from "./contentZoom";
import { imageLoadMeasure } from "./imageElement";
import { imageResize } from "./imageResize";
import { spellChecking } from "./spellcheck";
import { diagramRendering, mermaidLoader, type MermaidLoader } from "./mermaid";
import { livePreview, livePreviewConfig } from "./livePreview";
import { structureKeymap } from "./structure";
import { tableInlineEdit } from "./tableInlineEdit";
import { propertiesState } from "./blocks/properties";
import { createFindPanel } from "./findPanel";
import { outlineTracker } from "./outlineTracker";
import { foldPlaceholderDOM, headingFoldService, headingFoldToggle } from "./headingFold";
import { settleTreeOnKey } from "./syntax";
import { listFoldService, listFoldToggle } from "./listFold";
import { revealFlash } from "./revealFlash";
import { imagePaste } from "./imagePaste";
import { strandedCaret, undoLanding } from "./caret";
import { separatorKeepsBlocks } from "./separatorKeep";
import { changedRange } from "./docDiff";
import { refreshImagesEffect } from "./imageRefresh";
import { linkAutocomplete } from "./linkComplete";
import { editorImageSrc } from "./safeUrl";
import { keystrokeProbe, perfProbeEnabled, recordToStringMs, logOpen } from "@/lib/perfProbe";

export type { EditorMode, EditorHost } from "./host";
export { editorConfigOf } from "./host";
export { configureEditorEnvironment } from "./environment";
export type { EditorEnvironment, ColorScheme, SpellService, SpellMiss } from "./environment";
export { openMarkdownFile, saveMarkdownFile, InvalidUtf8Error } from "./fileBytes";
export type { MarkdownFile, LineEnding } from "./fileBytes";

/** What a new editor state starts with (`createEditorState`). Every field is optional. */
export interface EditorStateOptions {
  /** The Markdown source to edit. Default: the empty document. */
  doc?: string;
  /** Live preview (default), plain source, or read-only reading mode. */
  mode?: EditorMode;
  /** The document's absolute path, or null for an unsaved one. Relative links and images resolve against it, and pasted images are stored beside it. Default: null. */
  docPath?: string | null;
  /** Where the caret starts (UTF-16 offsets into `doc`). Default: the start of the document. */
  selection?: { anchor: number; head?: number };
  /** The per-document callbacks (change, links, images, attachments, completion, outline). Default: none. */
  host?: EditorHost;
  /**
   * Draw spelling squiggles when the environment's spell service is on. Turn it
   * off for an editor where a squiggle could not be fixed. Default true.
   */
  // The app turns it off for the feedback composer (spec: spellcheck).
  checkSpelling?: boolean;
  /**
   * Render ```` ```mermaid ```` fences as diagrams. With `false`, they show as
   * ordinary code blocks and Mermaid is never loaded — for a page that must not
   * download it, or whose Content Security Policy cannot allow Mermaid's inline
   * styles (see the self-hosting guide). Default true. Ignored by the
   * `@openmarkdown-dev/editor/no-diagrams` entry, which never renders diagrams
   * and does not contain Mermaid at all.
   */
  diagrams?: boolean;
  /**
   * Your own CodeMirror extensions, installed in this state beside the editor's.
   * They stay installed in every mode and travel with the state.
   */
  // spec: editor-host / agent 协作层不在内核里,由宿主作为插件装入. The app passes
  // its agent-collaboration layer (`./agent`, `agentLayer`) here; the core
  // imports none of it. They ride outside the mode compartment, after the core's
  // own decorations, so one instance serves all three modes.
  extensions?: Extension;
}

/**
 * A mounted editor (`mountEditor`): the CodeMirror view plus the operations a
 * host needs. Call `destroy` when the editor leaves the page.
 */
export interface MarkdownEditor {
  /** The underlying CodeMirror view — the escape hatch for anything not covered here. */
  view: EditorView;
  /** The current Markdown source, byte for byte what is being edited. */
  getDoc(): string;
  /**
   * Make `doc` the document, for example after the file changed on disk. Only
   * the range that differs is replaced, so the scroll position, selection and
   * folds outside it stay where they were (an agent appending a line does not
   * move the reader). The same text does nothing. Not an undo step, and not a
   * user edit: `onChange` reports it with `isUserEdit` false.
   */
  setDoc(doc: string): void;
  /**
   * Ask the host's `resolveImage` again for every image, after its answer
   * changed (the reader allowed remote images, say). An image that resolved to
   * null showed its source; it now shows the picture if the new answer is a URL.
   */
  refreshImages(): void;
  /** The shown state's mode (it travels with the state). */
  mode(): EditorMode;
  /** The shown state's document path, or null for an unsaved document (it travels with the state). */
  docPath(): string | null;
  /** Switch between live preview, source and reading mode; document, selection and history are kept. */
  setMode(mode: EditorMode): void;
  /** The shown state's document moved (rename) or was given a path (empty state → note). */
  setDocPath(path: string | null): void;
  /**
   * After swapping a state in (`editor.view.setState(state)`): bring what is the
   * window's, not the document's — the light / dark half of CodeMirror's base
   * theme — in line with now. A parked state kept the value it had when it left.
   */
  // In the app: called by `tabStates.swapIn`.
  syncAmbient(): void;
  /** Tear the view down and drop the color-scheme subscription. */
  destroy(): void;
}

const modeCompartment = new Compartment();
/** Per-document wiring that is not per-mode: image paste target, link completion's doc dir. */
const docCompartment = new Compartment();

/**
 * Tells CodeMirror which half of its own base stylesheet is live (change:
 * editor-theme-parity, design D2; spec: app-theme / 第三方组件的内置基础样式不得绕过主题).
 *
 * Everything else in the app follows the theme through CSS variables, so it needs
 * no wiring at all. CM does not: `EditorView.darkTheme` is a FACET, and the
 * `cm-light` / `cm-dark` class it drives is what CM's `&light` / `&dark` base
 * rules select on. Left unset it reads `false` forever, so every `&dark` rule CM
 * (and @codemirror/search, and @codemirror/autocomplete) ships is dead code and
 * every `&light` rule paints — in dark mode too.
 *
 * A compartment rather than a fixed value because the theme changes under a live
 * editor. Reconfiguring is enough: `updateAttrs()` runs on every update and
 * recomputes `themeClasses`, so the class swaps without rebuilding the view or
 * reparsing the document.
 *
 * ⚠️ `darkTheme`'s facet combine is `values.indexOf(true) > -1` — ANY provider
 * saying `true` wins. Reconfiguring this compartment back to `false` therefore
 * only actually returns to light while we are the sole provider. If a
 * third-party CM theme built with `{ dark: true }` is ever added, dark→light
 * switching breaks here first.
 */
const darkThemeCompartment = new Compartment();

/** The host window's scheme now; light when the host provides none (spec: editor-host). */
const schemeNow = (): ColorScheme => editorEnvironment().colorScheme?.current() ?? "light";

/** Injected link/image wiring shared by every live-preview mode config. */
interface PreviewWiring {
  resolveImage: (src: string) => string | null;
  /** Open document's directory (dirname of docPath); null = unsaved. */
  docDir: string | null;
  openLink?: (absPath: string, fragment: string | null) => void;
}

function modeExtensions(mode: EditorMode, wiring: PreviewWiring) {
  const { resolveImage, docDir, openLink } = wiring;
  switch (mode) {
    case "source":
      // No livePreview; sourceHighlighting colors semantics at a uniform type
      // size — vim-style "plaintext + color" (spec: 源码模式统一字号带配色).
      return [sourceHighlighting];
    case "reading":
      return [
        // readOnly gates commands and input handlers only — programmatic
        // view.dispatch still goes through (the checkbox widget's write-back in
        // reading mode relies on this). editable(false) drops contenteditable so
        // the cursor disappears and the IME can't engage (spec: 阅读模式).
        EditorState.readOnly.of(true),
        EditorView.editable.of(false),
        // Keep the content focusable so Cmd+F and keyboard scrolling still work.
        EditorView.contentAttributes.of({ tabindex: "0" }),
        // CM's mouse handling prevents the browser's default tabindex focus and,
        // with editable off, never calls focus() itself — do it explicitly or
        // clicking the text leaves the keyboard dead.
        EditorView.domEventHandlers({
          mousedown: (_e, view) => {
            if (!view.hasFocus) {
              setTimeout(() => view.contentDOM.focus({ preventScroll: true }));
            }
            return false;
          },
        }),
        livePreview,
        livePreviewConfig.of({ revealOnSelection: false, resolveImage, docDir, openLink }),
        markdownHighlighting,
      ];
    case "live":
      return [
        livePreview,
        livePreviewConfig.of({ revealOnSelection: true, resolveImage, docDir, openLink }),
        markdownHighlighting,
      ];
  }
}

/** Directory of a document path (dirname); null for browser dev / a root file. */
function docDirOf(path: string | null): string | null {
  if (!path) return null;
  const slash = path.lastIndexOf("/");
  return slash > 0 ? path.slice(0, slash) : null;
}

/**
 * The link / image wiring for a document. Callbacks go through the host object
 * (read at call time); only the directory is a value, and it changes only with
 * the path (`setDocPath` rebuilds it).
 */
function wiringOf(config: EditorConfig): PreviewWiring {
  const { host } = config;
  return {
    // The one image chokepoint (spec: editor-host / 不可信内容渲染不执行脚本):
    // the host's policy, minus script-capable URLs; no host → https only.
    resolveImage: (src) => editorImageSrc(src, host.resolveImage ? (s) => host.resolveImage?.(s) ?? null : undefined),
    docDir: docDirOf(config.docPath),
    openLink: (abs, fragment) => host.openLink?.(abs, fragment),
  };
}

function docExtensions(config: EditorConfig) {
  return [
    // Paste/drop image → attachments → insert relative link (change:
    // image-paste). Mode-independent (guards on readOnly itself), so it
    // rides outside the mode compartment.
    imagePaste(config.docPath, () => config.host.saveAttachment, () => config.host.onUnsupportedPaste),
    // Link-target autocompletion (change: link-autocomplete). Mode-independent
    // (reading mode is editable(false) so it never triggers); docDir from the
    // path, folder read fresh via the host getter. Its completion keymap
    // installs at Prec.highest, so Enter-to-accept outranks the structure
    // entry's Prec.high Enter.
    linkAutocomplete({
      docDir: docDirOf(config.docPath),
      getFolder: () => config.host.getFolder?.() ?? null,
      listFiles: (root) => config.host.listFiles?.(root) ?? null,
    }),
  ];
}

/** The transaction that moves a state to `next` config (mode and / or path). */
function reconfigure(next: EditorConfig) {
  return {
    effects: [
      setEditorConfig.of(next),
      modeCompartment.reconfigure(modeExtensions(next.mode, wiringOf(next))),
      docCompartment.reconfigure(docExtensions(next)),
    ],
  };
}

/**
 * The one builder behind both entries' `createEditorState` (spec:
 * editor-package / 无图表的入口): the full entry (`./index.ts`) passes the
 * Mermaid loader, the diagram-free one (`createEditorState` below) passes null —
 * then `diagrams` is off whatever the options say, and nothing here can reach
 * the `mermaid` package. Not public.
 */
// One tab's editor state (change: tab-state, D1): document, selection, undo
// history, the host plugins' state (the app's agent undo stack), folds, mode —
// everything a tab keeps while it is parked. Built here and nowhere else; shown
// by `mountEditor` (the first one) or swapped in by `tabStates.swapIn` (every
// later one).
export function buildEditorState(options: EditorStateOptions, loadMermaid: MermaidLoader | null): EditorState {
  const doc = options.doc ?? "";
  const config: EditorConfig = {
    docPath: options.docPath ?? null,
    mode: options.mode ?? "live",
    host: options.host ?? {},
  };
  const clamp = (n: number) => Math.max(0, Math.min(n, doc.length));
  const anchor = clamp(options.selection?.anchor ?? 0);
  const head = clamp(options.selection?.head ?? anchor);
  return EditorState.create({
      doc,
      selection: { anchor, head },
      extensions: [
        editorConfig.init(() => config),
        history(),
        // Undo / redo land at the change, not at history's old caret (spec:
        // caret-rules R2 / R2a / R2b) — one filter for every undo entry point.
        undoLanding,
        strandedCaret,
        // Typing on the only blank line between two blocks keeps the block below
        // separate (spec: editor-fidelity N8). Every mode: the file's structure
        // is the same whether it is rendered or not.
        separatorKeepsBlocks,
        drawSelection(),
        // Drop caret: draws a cursor at the drop position while dragging over the
        // editor, so a sidebar file drag (sidebar-drag-link) shows exactly where
        // its link will land. Works for any drag once dragover's default is
        // prevented (imagePaste does that for our private type + OS files).
        dropCursor(),
        highlightSpecialChars(),
        highlightSelectionMatches(),
        // Custom find/replace panel (change: find-ui): only the panel UI is
        // replaced — the query engine stays @codemirror/search. searchKeymap
        // below keeps Mod-f/Escape wired to open/closeSearchPanel.
        search({ top: true, literal: true, createPanel: createFindPanel }),
        EditorView.lineWrapping,
        // CommonMark + GFM + the registered parse-level dialects (math,
        // frontmatter) — see dialectParser.ts (spec: markdown-dialect).
        // addKeymap: false — its Enter / Backspace bindings belong to the
        // structure entry below (spec: structure-input; design D3).
        markdown({
          base: dialectBase,
          codeLanguages: languages,
          extensions: dialectExtensions,
          addKeymap: false,
        }),
        // Heading folding (change: heading-fold + heading-fold-inline-toggle; spec:
        // live-preview-editor / 标题折叠). A heading folds to the start of the next
        // same-or-higher heading — lang-markdown's `headerIndent` rule (design D2),
        // computed by `headingFoldService` below on the bounded whole-document tree
        // (change: syntax-access). codeFolding() owns the fold state +
        // `…` placeholder; headingFoldToggle renders the clickable handle INLINE next
        // to each heading (replacing CM's left-edge foldGutter, whose arrow stranded
        // far from the heading once the centred content column narrowed). Both ride
        // the BASE config (NOT modeCompartment) so one shared fold state serves all
        // three modes — mode switches never rebuild it (design D1). Reading mode's
        // readOnly gates edits/input only; folding dispatches a StateEffect (not a doc
        // change), so it works there like the checkbox write-back.
        codeFolding({ placeholderDOM: foldPlaceholderDOM }),
        // Ahead of `headerIndent`, which reads the possibly partial language field.
        headingFoldService,
        headingFoldToggle,
        // List items fold their whole subtree, range from the list tree (change:
        // list-fold); same fold state and toggle as headings.
        listFoldService,
        listFoldToggle,
        // markdownHighlighting rides in the compartment: live/reading style
        // headings etc., source stays uniform plaintext.
        editorTheme,
        // Content zoom: the theme scales the font; this re-measures on change.
        contentZoomMeasure,
        // An image that loads (or fails) changes the layout behind CM's back:
        // re-measure, once per editor (change: table-cell-images, D4).
        imageLoadMeasure,
        // Drag an image's corner to resize it, written back as `|W` (change: image-resize).
        imageResize,
        // Spelling squiggles, drawn by the editor (change: spellcheck, D4);
        // they check nothing while spell checking is off (the default).
        spellChecking(options.checkSpelling ?? true),
        // Diagrams off (or no loader: the diagram-free entry) → mermaid fences
        // stay code blocks, Mermaid never loads.
        diagramRendering.of(loadMermaid !== null && (options.diagrams ?? true)),
        loadMermaid ? mermaidLoader.of(loadMermaid) : [],
        // Seeded from the host's scheme (the app's reads the class the pre-paint
        // script in index.html already set), then kept current by the
        // subscription set up in mountEditor.
        darkThemeCompartment.of(EditorView.darkTheme.of(schemeNow() === "dark")),
        // …and shown to the host as `data-ome-scheme` on the root (./tokens.ts).
        schemeAttribute,
        // Reveal landing flash rides outside the compartment — one decoration
        // set serves all three modes (spec: reveal / 标题定位与滚动).
        revealFlash,
        // The host's plugins (the app's: the agent-collaboration layer — agent
        // undo turns, section glow, edit signpost; `./agent`). Outside the
        // compartment like revealFlash; the core knows nothing of what they are.
        options.extensions ?? [],
        // Live heading outline for the sidebar OUTLINE section (spec:
        // outline-panel): pushes the active document's outline to outlineStore
        // on change / clears on teardown. Mode-independent — the outline exists
        // in every editor mode.
        outlineTracker,
        // Image paste + link completion: per document, outside the mode compartment.
        docCompartment.of(docExtensions(config)),
        // In-place table cell editing (change: table-inline-cell-editing): the
        // activeEdit view-state + deferred reflow-on-session-end + click-outside
        // exit. MUST precede the modeCompartment so `activeEditField` is registered
        // before livePreview's block-decoration field reads it. Mode-independent
        // (the field just stays null in source / reading modes).
        tableInlineEdit,
        // Frontmatter Properties: which part is edited, 按源码编辑, quote-on-leave
        // (change: properties-block).
        propertiesState,
        // livePreview lives inside the compartment so source mode can drop it
        // wholesale (design D2).
        modeCompartment.of(modeExtensions(config.mode, wiringOf(config))),
        // Enter / Tab / Shift-Tab / Backspace / Mod-] / Mod-[: one entry that
        // reads the syntax tree and hands the key to the structure under the
        // caret (spec: structure-input). Prec.high; nothing else binds these keys
        // — `src/editor/structure/gate.test.ts` fails if something does. Reading
        // mode's Enter swallow lives there too.
        // Before any key binding runs, the tree is complete through the caret's
        // block (change: syntax-access) — the one key choke point.
        settleTreeOnKey,
        structureKeymap,
        // ↑ / ↓ into and out of blocks instead of jumping over them (spec:
        // block-editing / 方向键进出块). Only the crossing step is taken.
        blockArrowKeymap,
        keymap.of([
          // The host's key bindings (the app's: every editor-scope command
          // combo — ⌘S, ⌘B / ⌘I / ⌘⇧X / ⌘E, ⌘K — DERIVED from the command
          // registry's `keys`; spec: command-registry / 一张快捷键表), via the
          // editor environment (spec: editor-host). Placed before CodeMirror's
          // defaults so a host binding wins; a binding that declines returns
          // false and the defaults get their turn.
          { any: (view, event) => editorEnvironment().handleKey?.(view, event) ?? false },
          ...defaultKeymap,
          ...historyKeymap,
          ...searchKeymap,
          // Fold/unfold shortcuts (change: heading-fold). Default bindings are
          // Cmd-Alt-[ / Cmd-Alt-] (fold/unfold) and Ctrl-Alt-[ / ] (fold/unfold all)
          // — distinct from every binding above (no bare Alt-bracket in use), so
          // ordering here is inconsequential.
          ...foldKeymap,
        ]),
        EditorView.updateListener.of((update) => {
          const { host, docPath } = update.state.field(editorConfig);
          if (update.docChanged || update.selectionSet || update.viewportChanged) host.onMoved?.();
          if (update.docChanged && host.onChange) {
            const isUserEdit = update.transactions.some(
              (tr) => tr.annotation(Transaction.userEvent) !== undefined,
            );
            // toString (B/❷) is the per-keystroke serialization cost that scales
            // with document size; time it for the perf probe (zero cost off).
            const ts0 = perfProbeEnabled ? performance.now() : 0;
            const text = update.state.doc.toString();
            if (perfProbeEnabled) recordToStringMs(performance.now() - ts0);
            host.onChange(text, isUserEdit, docPath);
          }
        }),
        // Dev-only keystroke-latency probe. Added ONLY when explicitly opted in
        // (localStorage flag), so a normal editor carries zero probe cost
        // (spec: perf-instrumentation / 探针默认零常驻开销).
        ...(perfProbeEnabled ? [keystrokeProbe] : []),
      ],
  });
}

/**
 * Build an editor state: the document, caret, undo history, folds and mode,
 * with the whole editor (live preview, structure keys, find, folding, tables,
 * math) installed, but no diagrams: this is the
 * `@openmarkdown-dev/editor/no-diagrams` entry, which does not contain Mermaid.
 * A ```` ```mermaid ```` fence stays a code block and `options.diagrams` is
 * ignored. Show the state with `mountEditor`; a host with several documents keeps
 * one state per document and swaps them into one view
 * (`editor.view.setState(state)`, then `editor.syncAmbient()`).
 */
export function createEditorState(options: EditorStateOptions): EditorState {
  return buildEditorState(options, null);
}

/**
 * Mount `state` (from `createEditorState`) in a new editor view appended to
 * `parent`, following the environment's color scheme while it lives. Returns
 * the editor handle; call its `destroy` when done.
 */
// THE one place the application builds its editor view (gate:
// `src/lib/tabStates.gate.test.ts`). The workspace pane calls it once for the
// app's life and swaps tab states in afterwards; the feedback composer calls it
// for its own, separate view.
export function mountEditor(parent: HTMLElement, state: EditorState): MarkdownEditor {
  // Large-file open probe (spec: perf-instrumentation): the view construction
  // (first render + first build); the state's parse is timed by the caller.
  const t0 = perfProbeEnabled ? performance.now() : 0;
  const view = new EditorView({ parent, state });
  // Follow the app theme for as long as this view lives (change:
  // editor-theme-parity). Owned HERE rather than by EditorPane so every view
  // wires and tears down its own subscription — a second call site could forget,
  // and a leaked subscriber would dispatch into a destroyed view.
  const themeFor = (effective: string) =>
    darkThemeCompartment.reconfigure(EditorView.darkTheme.of(effective === "dark"));
  const unsubscribeTheme =
    editorEnvironment().colorScheme?.subscribe((scheme) => {
      view.dispatch({ effects: themeFor(scheme) });
    }) ?? (() => {});
  if (perfProbeEnabled) logOpen(state.doc.length, 0, performance.now() - t0);
  const config = () => view.state.field(editorConfig);

  return {
    view,
    getDoc: () => view.state.doc.toString(),
    setDoc(doc: string) {
      // Compared as CodeMirror holds text (line breaks as "\n"), so offsets match.
      const change = changedRange(view.state.doc.toString(), view.state.toText(doc).toString());
      if (!change) return;
      view.dispatch({ changes: change, annotations: Transaction.addToHistory.of(false) });
    },
    refreshImages() {
      view.dispatch({ effects: refreshImagesEffect.of(null) });
    },
    mode: () => config().mode,
    docPath: () => config().docPath,
    setMode(mode: EditorMode) {
      if (config().mode === mode) return;
      view.dispatch(reconfigure({ ...config(), mode }));
    },
    setDocPath(docPath: string | null) {
      if (config().docPath === docPath) return;
      view.dispatch(reconfigure({ ...config(), docPath }));
    },
    syncAmbient() {
      const dark = schemeNow() === "dark";
      if (view.state.facet(EditorView.darkTheme) !== dark) {
        view.dispatch({ effects: themeFor(dark ? "dark" : "light") });
      }
    },
    destroy: () => {
      unsubscribeTheme();
      view.destroy();
    },
  };
}
