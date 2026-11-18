import { EditorView, ViewPlugin, keymap, drawSelection, dropCursor, highlightSpecialChars, type ViewUpdate } from "@codemirror/view";
import { EditorState, Compartment, Transaction, type EditorSelection, type Extension, type StateEffect } from "@codemirror/state";
import { editorConfig, setEditorConfig, type EditorConfig, type EditorHost, type EditorMode } from "./host";
import {
  environmentOf,
  ownEnvironment,
  schemeOf,
  schemeSourceOf,
  withPageDefaults,
  type ColorScheme,
  type ColorSchemeSource,
  type EditorOwnEnvironment,
} from "./environment";
import { defaultKeymap, history, historyField, historyKeymap, redo, undo } from "@codemirror/commands";
import { search, searchKeymap, highlightSelectionMatches, searchPanelOpen } from "@codemirror/search";
import { markdownSupport } from "./markdownSupport";
import { blockArrowKeymap } from "./blocks/arrows";
import { codeFolding, foldKeymap, type LanguageDescription } from "@codemirror/language";
import { editorTheme, markdownHighlighting, sourceHighlighting } from "./theme";
import { heightExtension, rootClass, schemeAttribute } from "./tokens";
import { contentZoomMeasure } from "./contentZoom";
import { imageLoadMeasure } from "./imageElement";
import { imageResize } from "./imageResize";
import { spellChecking } from "./spellcheck";
import { diagramRendering, mermaidLoader, type MermaidLoader } from "./mermaid";
import { mathLoader, mathReadyEffect, type MathLoader } from "./math";
import { asyncRenderDone } from "./blocks/render";
import { livePreview, livePreviewConfig } from "./livePreview";
import { structureKeymap } from "./structure";
import { tableInlineEdit } from "./tableInlineEdit";
import { propertiesState } from "./blocks/properties";
import { closeFindPanel, createFindPanel, openFindPanel } from "./findPanel";
import { outlineTracker } from "./outlineTracker";
import { foldPlaceholderDOM, headingFoldService, headingFoldToggle } from "./headingFold";
import { settleTreeOnKey } from "./syntax";
import { listFoldService, listFoldToggle } from "./listFold";
import { revealFlash } from "./revealFlash";
import { imagePaste } from "./imagePaste";
import { findClosesParts, landingScroll, leaveBlockEdits, revealText, scrollLanding, strandedCaret, undoLanding } from "./caret";
import { separatorKeepsBlocks } from "./separatorKeep";
import { changedRange } from "./docDiff";
import { isUnedited } from "./fileBytes";
import { refreshImagesEffect } from "./imageRefresh";
import { linkAutocomplete } from "./linkComplete";
import { editorImageSrc } from "./safeUrl";
import { keystrokeProbe, perfProbeEnabled, recordToStringMs, logOpen } from "@/lib/perfProbe";

export type { EditorMode, EditorHost } from "./host";
export { editorConfigOf } from "./host";
export { configureEditorEnvironment } from "./environment";
export type { EditorEnvironment, EditorOwnEnvironment, ColorScheme, ColorSchemeSource, SpellService, SpellMiss, MathRenderer, DiagramRenderer } from "./environment";
export { openMarkdownFile, saveMarkdownFile, openMarkdownText, saveMarkdownText, InvalidUtf8Error } from "./fileBytes";
export type { MarkdownFile, MarkdownText, LineEnding } from "./fileBytes";

/** What a new editor state starts with (`createEditorState`). Every field is optional. */
export interface EditorStateOptions {
  /** The Markdown source to edit. Default: the empty document. */
  doc?: string;
  /** Live preview (default), plain source, or read-only reading mode. */
  mode?: EditorMode;
  /**
   * May the user change the document? `false` makes the editor read-only in
   * every mode — no typing, pasting, dropping, task-checkbox toggling or
   * property editing, and no editing controls drawn; it can still be
   * focused, selected, searched and copied, and links still open. Live
   * preview then renders like reading mode. Change it with
   * `editor.setEditable`. Default true.
   */
  editable?: boolean;
  /** The document's absolute path, or null for an unsaved one. Relative links and images resolve against it, and pasted images are stored beside it. Default: null. */
  docPath?: string | null;
  /** Where the caret starts (UTF-16 offsets into `doc`). Default: the start of the document. */
  selection?: { anchor: number; head?: number };
  /** The per-document callbacks (change, links, images, attachments, completion, outline). Default: none. */
  host?: EditorHost;
  /**
   * This editor's own environment: the color scheme, clipboard, external
   * links, refused-link notice, spelling and host keys for this editor only.
   * A member given here replaces the page's default
   * (`configureEditorEnvironment`); one left out falls back to it. Change it
   * with `editor.setEnvironment`. Default: none (the page's defaults).
   */
  environment?: EditorOwnEnvironment;
  /**
   * The `id` of the editable text element, so a `<label for>` with that id
   * focuses the editor when clicked. Give the label's text to screen readers
   * with `ariaLabelledBy` (a `<label for>` does not name a non-form element).
   * Default: none.
   */
  id?: string;
  /** The accessible name of the editable text (`aria-label`), when no visible label names it. Default: none. */
  ariaLabel?: string;
  /** The `id` (or space-separated ids) of the element(s) that name the editable text (`aria-labelledby`). Default: none. */
  ariaLabelledBy?: string;
  /**
   * Take over an existing CodeMirror state — from an editor this one
   * replaces — with its document, selection and undo history (the history
   * of `@codemirror/commands`' `history()`, the same copy of the package as
   * this editor's). Its other extensions are not carried over. `doc` and
   * `selection` are then ignored. Default: none.
   */
  fromState?: EditorState;
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
   * styles (see the self-hosting guide). Default true. With the
   * `/no-diagrams` and `/no-renderers` entries, which do not contain Mermaid,
   * diagrams render only through your own `renderDiagram` (environment).
   */
  diagrams?: boolean;
  /**
   * The languages fenced code blocks are highlighted in, matched by the
   * fence's info string — for example `languages` from
   * `@codemirror/language-data` (install it beside the editor), or a list of
   * your own `LanguageDescription`s. Each language's grammar loads the first
   * time a fence uses it. Default: none — fenced code shows unhighlighted.
   */
  codeLanguages?: readonly LanguageDescription[];
  /**
   * Your own CodeMirror extensions, installed in this state beside the editor's.
   * They stay installed in every mode and travel with the state.
   */
  // spec: editor-host / agent 协作层不在内核里,由宿主作为插件装入. The app passes
  // its agent-collaboration layer (`./agent`, `agentLayer`) here; the core
  // imports none of it. They ride outside the mode compartment, after the core's
  // own decorations, so one instance serves all three modes.
  extensions?: Extension | readonly Extension[];
  /**
   * How tall the editor is. `"fill"`: the parent's height — give the parent
   * one; the editor scrolls inside it. `"auto"`: the content's height — the
   * editor grows as lines are added and the page scrolls, as a form field
   * would (a `min-height` on `.ome-root` keeps it from collapsing when empty).
   * Default `"fill"`.
   */
  height?: "fill" | "auto";
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
  /** Whether the user may change the document (it travels with the state). */
  editable(): boolean;
  /** Allow or forbid changing the document (`EditorStateOptions.editable`); document, selection and history are kept. */
  setEditable(editable: boolean): void;
  /**
   * Replace this editor's own environment (`EditorStateOptions.environment`):
   * the members given override the page's defaults from now on, a new color
   * scheme applies at once. It travels with the state.
   */
  setEnvironment(environment: EditorOwnEnvironment): void;
  /** Undo the last change, as Mod+Z does. Returns false when there was nothing to undo (or the editor is not editable). */
  undo(): boolean;
  /** Redo the last undone change, as Mod+Shift+Z does. Returns false when there was nothing to redo. */
  redo(): boolean;
  /** Open the find panel and focus its field, as Mod+F does. It works in every mode. */
  openSearch(): void;
  /** Close the find panel and give the keys back to the text. */
  closeSearch(): void;
  /** Is the find panel open? */
  isSearchOpen(): boolean;
  /**
   * Select the first occurrence of `text` (from the start of the document)
   * and scroll it into view, the way Find shows its current match — a match
   * in a table cell scrolls that cell in. The editor is not focused (call
   * `focus`). Returns false, and moves nothing, when `text` is empty or not in
   * the document.
   */
  revealText(text: string): boolean;
  /** Give the editor the keyboard focus. */
  focus(): void;
  /**
   * Is the document unchanged from `file` (what `openMarkdownFile` or
   * `openMarkdownText` returned)? The same test `saveMarkdownFile` uses to
   * return the original bytes: for an unsaved-changes indicator.
   */
  isUnedited(file: { readonly text: string }): boolean;
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

// The runtime options (change: editor-per-instance, design D1): each lives in a
// compartment, and every change goes through `reconfigure` below.
const modeCompartment = new Compartment();
/** This editor's own environment (`environment.ts` `ownEnvironment`). */
const environmentCompartment = new Compartment();
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

/** The scheme a state's environment says now; light when it says none (spec: editor-host). */
const schemeNow = (state: EditorState): ColorScheme => schemeOf(environmentOf(state));

/** The `darkTheme` value for a scheme. */
const themeFor = (scheme: ColorScheme) => darkThemeCompartment.reconfigure(EditorView.darkTheme.of(scheme === "dark"));

/**
 * Follow the environment's live color scheme while the view shows this state
 * (spec: editor-host / 每个编辑器各自配置). A view plugin, so it lives exactly as
 * long as the state is shown: `view.setState` (the app's tab swap) builds a new
 * one for the new state, and `destroy` drops the subscription. A changed source
 * (`setEnvironment`) is followed from the next update.
 */
const schemeFollower = ViewPlugin.fromClass(
  class {
    private source: ColorSchemeSource | null = null;
    private unsubscribe: () => void = () => {};
    constructor(readonly view: EditorView) {
      this.follow(view.state);
    }
    update(u: ViewUpdate) {
      if (schemeSourceOf(environmentOf(u.state).colorScheme) !== this.source) this.follow(u.state);
    }
    private follow(state: EditorState) {
      this.unsubscribe();
      this.source = schemeSourceOf(environmentOf(state).colorScheme);
      this.unsubscribe =
        this.source?.subscribe((scheme) => {
          // A source that reports the value it already has (on subscribe, say)
          // needs no dispatch — and one mid-update would throw.
          if (this.view.state.facet(EditorView.darkTheme) !== (scheme === "dark")) {
            this.view.dispatch({ effects: themeFor(scheme) });
          }
        }) ?? (() => {});
    }
    destroy() {
      this.unsubscribe();
    }
  },
);

/** Injected link/image wiring shared by every live-preview mode config. */
interface PreviewWiring {
  resolveImage: (src: string) => string | null;
  /** Open document's directory (dirname of docPath); null = unsaved. */
  docDir: string | null;
  openLink?: (absPath: string, fragment: string | null) => void;
}

/**
 * What keeps the user from typing (reading mode, or `editable: false`).
 * readOnly gates commands and input handlers only — programmatic
 * view.dispatch still goes through (the checkbox widget's write-back in
 * reading mode relies on this; `editable: false` stops it through
 * `livePreviewConfig.locked`). editable(false) drops contenteditable so the
 * native caret is gone and the IME can't engage (spec: 阅读模式); the caret
 * drawSelection() draws is hidden by `noCaret` below (spec: caret-rules /
 * 落点看得见, L3).
 */
const readOnlyExtensions: Extension = [
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
];

function modeExtensions(mode: EditorMode, editable: boolean, wiring: PreviewWiring) {
  const { resolveImage, docDir, openLink } = wiring;
  // `editable: false` is orthogonal to the mode (change: editor-per-instance,
  // D2): source stays source, read-only; live renders as reading does (no
  // source revealed under a caret that cannot type).
  const locked = !editable;
  switch (mode) {
    case "source":
      // No livePreview; sourceHighlighting colors semantics at a uniform type
      // size — vim-style "plaintext + color" (spec: 源码模式统一字号带配色).
      return [sourceHighlighting, locked ? readOnlyExtensions : []];
    case "reading":
    case "live": {
      const reading = mode === "reading" || locked;
      return [
        reading ? readOnlyExtensions : [],
        livePreview,
        livePreviewConfig.of({ revealOnSelection: !reading, locked, resolveImage, docDir, openLink }),
        markdownHighlighting,
      ];
    }
  }
}

/**
 * No drawn caret where keys do not type (spec: caret-rules / 落点看得见, L3):
 * `drawSelection()` shows its cursor layer whenever the editor is focused,
 * editable or not, and Reading mode stays focusable (Cmd+F, keyboard scroll).
 * Derived from `EditorView.editable`, not from the mode's name, so any
 * non-editable view gets it; `theme.ts` hides the cursor layer under the class.
 * Selection ranges keep painting (Find's current match in Reading mode).
 */
export const NO_CARET_CLASS = "om-no-caret";
const noCaret = EditorView.editorAttributes.compute([EditorView.editable], (state): Record<string, string> =>
  state.facet(EditorView.editable) ? {} : { class: NO_CARET_CLASS },
);

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
    imagePaste(config.docPath, () => config.host, () => config.host.onUnsupportedPaste),
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

/** A change to an editor's runtime options. */
export interface Reconfigure {
  mode?: EditorMode;
  docPath?: string | null;
  editable?: boolean;
  environment?: EditorOwnEnvironment;
}

/**
 * THE way an editor's runtime options change (change: editor-per-instance,
 * design D1): the transaction that moves `state` to the options in `change`
 * — mode, path, editable (the config field plus the compartments built from
 * it), and the editor's own environment (its compartment, plus the dark /
 * light half its color scheme now says). Every `set…` of the handle is this.
 */
// Exported for the tests (`perInstance.test.ts`); not public.
export function reconfigure(
  state: EditorState,
  change: Reconfigure,
): { effects: StateEffect<unknown>[]; selection?: EditorSelection } {
  const effects: StateEffect<unknown>[] = [];
  const now = state.field(editorConfig);
  const next: EditorConfig = {
    ...now,
    ...(change.mode !== undefined && { mode: change.mode }),
    ...(change.docPath !== undefined && { docPath: change.docPath }),
    ...(change.editable !== undefined && { editable: change.editable }),
  };
  if (next.mode !== now.mode || next.docPath !== now.docPath || next.editable !== now.editable) {
    effects.push(
      setEditorConfig.of(next),
      modeCompartment.reconfigure(modeExtensions(next.mode, next.editable, wiringOf(next))),
      docCompartment.reconfigure(docExtensions(next)),
    );
  }
  if (change.environment) {
    // …and every formula and diagram redraws: the renderers may have changed.
    effects.push(environmentCompartment.reconfigure(ownEnvironment.of(change.environment)), mathReadyEffect.of(null), asyncRenderDone.of(null));
    const scheme = schemeOf(withPageDefaults(change.environment));
    if (state.facet(EditorView.darkTheme) !== (scheme === "dark")) effects.push(themeFor(scheme));
  }
  // A read-only document (Reading mode, or `editable: false`) has no editable
  // parts (change: editor-edit-locality, D7): an open cell / property edit ends
  // in the same transaction (settled like any other exit), the caret left where
  // it is. Otherwise the open part editor would stay drawn — with its caret —
  // in a read-only document.
  const readOnly = (c: EditorConfig) => c.mode === "reading" || !c.editable;
  if (readOnly(next) && !readOnly(now)) {
    const leave = leaveBlockEdits(state);
    if (leave.length > 0) return { effects: [...effects, ...leave], selection: state.selection };
  }
  return { effects };
}

/**
 * The editable text's identity for labels and screen readers (change:
 * editor-per-instance, design D5): `id` / `aria-label` / `aria-labelledby` on
 * the content element, and a click on a `<label for>` naming the id focuses
 * the editor (a label only focuses form controls by itself).
 */
function accessibility(options: EditorStateOptions): Extension {
  const attrs: Record<string, string> = {};
  if (options.id) attrs.id = options.id;
  if (options.ariaLabel) attrs["aria-label"] = options.ariaLabel;
  if (options.ariaLabelledBy) attrs["aria-labelledby"] = options.ariaLabelledBy;
  if (Object.keys(attrs).length === 0) return [];
  return [EditorView.contentAttributes.of(attrs), options.id ? labelFocus(options.id) : []];
}

function labelFocus(id: string): Extension {
  return ViewPlugin.define((view) => {
    const root = view.root as Document | ShadowRoot;
    const onClick = (e: Event) => {
      const label = (e.target as Element | null)?.closest?.("label");
      if (label instanceof HTMLLabelElement && label.htmlFor === id) view.focus();
    };
    root.addEventListener("click", onClick);
    return { destroy: () => root.removeEventListener("click", onClick) };
  });
}

/**
 * The built-in renderers an entry carries (change: editor-lean-deps, design
 * D2): the loader of each, or none. A host's `renderMath` / `renderDiagram`
 * (its environment) is used in place of these whenever given.
 */
export interface BuiltInRenderers {
  math?: MathLoader;
  diagram?: MermaidLoader;
}

/**
 * The one builder behind every entry's `createEditorState` (spec:
 * editor-package / 入口与内置渲染器): the full entry (`./index.ts`) passes the
 * Temml and Mermaid loaders, the diagram-free one (`./noDiagrams.ts`) only
 * Temml's, the one without renderers (`createEditorState` below) none — and
 * nothing here can reach a renderer package by itself. Not public.
 */
// One tab's editor state (change: tab-state, D1): document, selection, undo
// history, the host plugins' state (the app's agent undo stack), folds, mode —
// everything a tab keeps while it is parked. Built here and nowhere else; shown
// by `mountEditor` (the first one) or swapped in by `tabStates.swapIn` (every
// later one).
export function buildEditorState(options: EditorStateOptions, builtIn: BuiltInRenderers): EditorState {
  const config: EditorConfig = {
    docPath: options.docPath ?? null,
    mode: options.mode ?? "live",
    host: options.host ?? {},
    editable: options.editable ?? true,
  };
  const own = options.environment ?? {};
  // The scheme the new state starts in: its own environment over the page's.
  const startScheme = schemeOf(withPageDefaults(own));
  const extensions: Extension[] = [
    editorConfig.init(() => config),
    history(),
    // Undo / redo land at the change, not at history's old caret (spec:
    // caret-rules R2 / R2a / R2b) — one filter for every undo entry point.
    undoLanding,
    strandedCaret,
    findClosesParts,
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
    // The current match scrolls through the landing scroll (spec:
    // caret-rules R14 / 落点看得见 L2): a match in a table cell scrolls that
    // cell in, not the table's box.
    search({ top: true, literal: true, createPanel: createFindPanel, scrollToMatch: scrollLanding }),
    landingScroll,
    noCaret,
    EditorView.lineWrapping,
    // CommonMark + GFM + the registered parse-level dialects (math,
    // frontmatter) — see dialectParser.ts (spec: markdown-dialect).
    // Built in ./markdownSupport.ts: HTML inside Markdown loads on demand,
    // fenced code is highlighted with the host's `codeLanguages`. No keymap:
    // its Enter / Backspace belong to the structure entry below.
    markdownSupport(options.codeLanguages),
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
    // Diagrams off → mermaid fences stay code blocks, nothing loads. On, they
    // render with the host's `renderDiagram`, else the entry's built-in
    // Mermaid, else stay code blocks (`diagramDrawerOf`).
    diagramRendering.of(options.diagrams ?? true),
    builtIn.diagram ? mermaidLoader.of(builtIn.diagram) : [],
    // Formulas: the host's `renderMath`, else the entry's built-in Temml, else source.
    builtIn.math ? mathLoader.of(builtIn.math) : [],
    // Seeded from the host's scheme (the app's reads the class the pre-paint
    // script in index.html already set), then kept current by the
    // subscription set up in mountEditor.
    darkThemeCompartment.of(EditorView.darkTheme.of(startScheme === "dark")),
    // This editor's own environment (change: editor-per-instance, D1), and
    // the subscription to its live scheme while the state is shown.
    environmentCompartment.of(ownEnvironment.of(own)),
    schemeFollower,
    accessibility(options),
    // …and shown to the host as `data-ome-scheme` on the root (./tokens.ts).
    schemeAttribute,
    // The public root class, `.ome-root` (./tokens.ts EDITOR_CLASSES): every
    // state built here is a mounted editor's, never a nested one's.
    rootClass,
    heightExtension(options.height),
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
    // activeEdit view-state + settle-edited-cells-on-session-end + click-outside
    // exit. MUST precede the modeCompartment so `activeEditField` is registered
    // before livePreview's block-decoration field reads it. Mode-independent
    // (the field just stays null in source / reading modes).
    tableInlineEdit,
    // Frontmatter Properties: which part is edited, 按源码编辑, quote-on-leave
    // (change: properties-block).
    propertiesState,
    // livePreview lives inside the compartment so source mode can drop it
    // wholesale (design D2).
    modeCompartment.of(modeExtensions(config.mode, config.editable, wiringOf(config))),
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
      { any: (view, event) => environmentOf(view.state).handleKey?.(view, event) ?? false },
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
  ];
  // Taking over a host's CodeMirror state (change: editor-per-instance, design
  // D7): its document, selection and undo history, through the history
  // field's own JSON round trip (the one CodeMirror documents for keeping
  // history across states); nothing else of it comes along.
  if (options.fromState) {
    const fields = { history: historyField };
    return EditorState.fromJSON(options.fromState.toJSON(fields), { extensions }, fields);
  }
  const doc = options.doc ?? "";
  const clamp = (n: number) => Math.max(0, Math.min(n, doc.length));
  const anchor = clamp(options.selection?.anchor ?? 0);
  const head = clamp(options.selection?.head ?? anchor);
  return EditorState.create({ doc, selection: { anchor, head }, extensions });
}

/**
 * Build an editor state: the document, caret, undo history, folds and mode,
 * with the whole editor (live preview, structure keys, find, folding, tables)
 * installed, but no built-in renderers: this is the
 * `@openmarkdown-dev/editor/no-renderers` entry, which contains neither Temml
 * nor Mermaid. Formulas and diagrams render through the renderers you give in
 * the environment (`renderMath`, `renderDiagram`); without them a formula
 * shows its TeX and a ```` ```mermaid ```` fence stays a code block. Show the
 * state with `mountEditor`; a host with several documents keeps one state per
 * document and swaps them into one view (`editor.view.setState(state)`, then
 * `editor.syncAmbient()`).
 */
export function createEditorState(options: EditorStateOptions): EditorState {
  return buildEditorState(options, {});
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
  // The color scheme is followed by `schemeFollower`, which rides in the state
  // (change: editor-per-instance, D1): every view that shows the state —
  // this one, or one a host built itself — subscribes and unsubscribes with it.
  if (perfProbeEnabled) logOpen(state.doc.length, 0, performance.now() - t0);
  const config = () => view.state.field(editorConfig);
  const apply = (change: Reconfigure) => {
    const tr = reconfigure(view.state, change);
    if (tr.effects.length > 0) view.dispatch(tr);
  };

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
    editable: () => config().editable,
    setMode: (mode: EditorMode) => apply({ mode }),
    setDocPath: (docPath: string | null) => apply({ docPath }),
    setEditable: (editable: boolean) => apply({ editable }),
    setEnvironment: (environment: EditorOwnEnvironment) => apply({ environment }),
    // The editor's own commands, the ones its keys run (change:
    // editor-per-instance, design D4): one copy, so a host needs no import of
    // the CodeMirror packages to drive them.
    undo: () => undo(view),
    redo: () => redo(view),
    openSearch: () => openFindPanel(view),
    closeSearch: () => closeFindPanel(view),
    isSearchOpen: () => searchPanelOpen(view.state),
    revealText: (text: string) => revealText(view, text),
    focus: () => view.focus(),
    isUnedited: (file) => isUnedited(view.state.doc.toString(), file),
    syncAmbient() {
      const scheme = schemeNow(view.state);
      if (view.state.facet(EditorView.darkTheme) !== (scheme === "dark")) {
        view.dispatch({ effects: themeFor(scheme) });
      }
    },
    destroy: () => view.destroy(),
  };
}
