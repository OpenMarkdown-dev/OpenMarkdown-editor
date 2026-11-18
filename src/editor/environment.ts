import { Facet, type EditorState } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import type { EditorLang } from "./strings";

/**
 * The editor environment: the capabilities that are not about one document —
 * the color scheme, the clipboard, external links, spelling, host keys and the
 * UI language. Give each editor its own with `createEditorState({ environment })`
 * (and change it later with `editor.setEnvironment`); `configureEditorEnvironment`
 * sets the page's defaults, which every editor uses for the members it was not
 * given. Per-document needs go through `EditorHost` instead.
 *
 * Every member is optional: what the host leaves out is switched off quietly —
 * no error, no notice, no fallback of the editor's own — except the two
 * renderers, whose absence means the entry's built-in one. An editor mounted with
 * no environment configured at all is light, English, editable, and has no
 * copy, external-link, spelling or host-key behaviour.
 */
// spec: editor-host / 宿主能力只经两个注入口进入, 每个编辑器各自配置 (change:
// editor-per-instance, design D1). No hidden fallbacks: one would make the
// editor behave differently per host and bypass the host's error policy.
export interface EditorEnvironment {
  /**
   * The language of the editor's own UI words. Read whenever a word is drawn,
   * so set it before the first editor mounts; already-drawn words do not redraw
   * on a change. Left out, or not one the editor ships: English. Page-wide
   * only: set it with `configureEditorEnvironment` (a per-editor
   * `environment` has no `language`).
   */
  language?: EditorLang;
  /**
   * Light or dark: a fixed `"light"` / `"dark"` (change it with
   * `editor.setEnvironment`), or a live source — its value now, and a
   * subscription to changes (returns the unsubscribe), which the editor
   * follows while it is mounted.
   */
  colorScheme?: ColorScheme | ColorSchemeSource;
  /** Put `text` on the clipboard (code-block copy button). The host reports success / failure itself. */
  copyText?: (text: string) => unknown;
  /** Open an external (non-file) link target, e.g. Cmd/Ctrl+click on `https://…`. The host owns the policy. */
  openExternal?: (url: string) => unknown;
  /**
   * The editor refused to follow a script-capable link (`javascript:` /
   * `vbscript:` / `data:` …, however obfuscated); `scheme` is the
   * scheme as a browser reads it. For telling the user only: the URL MUST NOT
   * be opened. Absent: the refusal is silent.
   */
  refusedLink?: (url: string, scheme: string) => unknown;
  /** The spell-checking service behind the editor's own squiggles and suggestions. Absent: no spell checking. */
  spell?: SpellService;
  /**
   * Offered every key the editor's keymap sees, before CodeMirror's defaults:
   * return true when the host ran a binding for it (the key is consumed).
   */
  handleKey?: (view: EditorView, event: KeyboardEvent) => boolean;
  /**
   * Your own formula renderer, used for every `$…$` and `$$…$$` in place of
   * the editor's built-in one (Temml) — to draw formulas the way the rest of
   * your page does (MathJax, KaTeX), or to have formulas at all with an entry
   * that carries no built-in renderer (`/no-renderers`). Left out: the
   * entry's built-in renderer, if it has one; else formulas show as their TeX.
   * See `MathRenderer`.
   */
  renderMath?: MathRenderer;
  /**
   * Your own diagram renderer, used for every ```` ```mermaid ```` fence in
   * place of the editor's built-in Mermaid — for example your page's own copy
   * of Mermaid, so the page loads one, or to have diagrams at all with an entry
   * that carries no built-in one (`/no-diagrams`, `/no-renderers`). Left out:
   * the entry's built-in renderer, if it has one; else the fence stays a code
   * block. `EditorStateOptions.diagrams: false` turns diagrams off either way.
   * See `DiagramRenderer`.
   */
  renderDiagram?: DiagramRenderer;
}

/**
 * Renders the TeX inside one formula (without its `$` / `$$` delimiters) to
 * presentation MathML: a string holding one `<math>` element (MathJax's
 * `tex2mml`, KaTeX with `output: "mathml"`, Temml's `renderToString`).
 * `displayMode` is true for a `$$…$$` block. Called synchronously each time a
 * formula is drawn, so have the renderer loaded before you hand it over
 * (`editor.setEnvironment` redraws every formula with a new one). Throw on TeX
 * it cannot render: the formula then shows its source with the failure mark.
 * The TeX is the document's — possibly someone else's — so configure the
 * renderer not to trust it (no `\href`, no `\style`). Its output goes through
 * the editor's sanitiser, which keeps presentation MathML only: anything else
 * (HTML, SVG, styles) makes the formula show its source with the failure mark.
 */
export type MathRenderer = (tex: string, displayMode: boolean) => string;

/**
 * Renders one diagram's source (the body of a ```` ```mermaid ```` fence) to
 * an SVG string, in the editor's light or dark scheme; it may return a
 * promise. Reject or throw on a source it cannot render: the fence then shows
 * its source with the failure mark. Pass the same function each time —
 * results are cached per renderer and source. The source is the document's,
 * so run the renderer in its strictest mode (Mermaid: `securityLevel:
 * "strict"`, `htmlLabels: false`). Its output goes through the editor's
 * diagram sanitiser, which keeps SVG drawing elements and plain styling only:
 * HTML labels (`foreignObject`), scripts, links and event handlers make the
 * diagram show its source with the failure mark.
 */
export type DiagramRenderer = (source: string, scheme: ColorScheme) => string | Promise<string>;

/** The editor's light or dark look; it follows `EditorEnvironment.colorScheme`. */
export type ColorScheme = "light" | "dark";

/** A live light / dark scheme (`EditorEnvironment.colorScheme`): its value now, and its changes. */
export interface ColorSchemeSource {
  /** The scheme now. */
  current(): ColorScheme;
  /** Follow changes; returns the unsubscribe. */
  subscribe(cb: (scheme: ColorScheme) => void): () => void;
}

/**
 * One editor's environment (`createEditorState({ environment })`,
 * `editor.setEnvironment`): any `EditorEnvironment` member but the page-wide
 * `language`. A member given here replaces the page's for this editor — given
 * as `undefined`, it switches the page's off; left out, the page's applies.
 */
export type EditorOwnEnvironment = Omit<EditorEnvironment, "language">;

/** One misspelling, UTF-16 offsets into the paragraph that was sent. */
export interface SpellMiss {
  from: number;
  to: number;
}

/**
 * A spell checker keyed by "spell document" numbers (one per top-level editor,
 * so the checker can keep per-editor ignore lists).
 */
export interface SpellService {
  /** Is spell checking on right now? */
  isOn(): boolean;
  /** Follow the on / off state; returns the unsubscribe. */
  onChange(cb: (on: boolean) => void): () => void;
  /** A fresh spell-document number for a top-level editor. */
  newDocument(): number;
  /** Misspellings for each paragraph, in order; null when the check could not run. */
  check(doc: number, paragraphs: string[]): Promise<SpellMiss[][] | null>;
  /** Up to five suggestions for `paragraph.slice(from, to)`, in the checker's order. */
  suggestions(doc: number, paragraph: string, from: number, to: number): Promise<string[]>;
  /** The editor of `doc` is gone. */
  closeDocument(doc: number): void;
}

let environment: EditorEnvironment = {};

/**
 * Set the page's defaults (`EditorEnvironment`): what every editor uses for a
 * member its own `environment` does not give, and the page-wide UI
 * `language`. Call once at startup, before the first editor mounts; a later
 * call replaces the whole set. Optional: without it (and without a per-editor
 * `environment`) the editor is light, English, and has no clipboard,
 * external-link, spelling or host-key behaviour.
 */
export function configureEditorEnvironment(env: EditorEnvironment): void {
  environment = env;
}

/** The page's defaults (empty until configured). Read at call time, never cached. */
export function editorEnvironment(): EditorEnvironment {
  return environment;
}

/**
 * The editor's own environment, as a facet (change: editor-per-instance, D1):
 * a mounted editor's state holds it in a compartment (`base.ts`), so
 * `setEnvironment` reconfigures it like any other runtime option; a nested
 * (part) editor is handed its outer editor's value (`blocks/partEditor.ts`).
 */
const NONE: EditorOwnEnvironment = {};
export const ownEnvironment = Facet.define<EditorOwnEnvironment, EditorOwnEnvironment>({
  combine: (values) => values[0] ?? NONE,
});

/**
 * The environment an editor runs with: its own members over the page's
 * defaults (a member present in its own, even as `undefined`, wins). The ONE
 * read of every environment member but `language` — call it at use time.
 */
export function environmentOf(state: EditorState): EditorEnvironment {
  return withPageDefaults(state.facet(ownEnvironment));
}

/** `own` over the page's defaults; `language` is always the page's. */
export function withPageDefaults(own: EditorOwnEnvironment): EditorEnvironment {
  return own === NONE ? environment : { ...environment, ...own, language: environment.language };
}

/** A scheme member as a source: a fixed value never changes. Pure. */
export function schemeSourceOf(scheme: EditorEnvironment["colorScheme"]): ColorSchemeSource | null {
  return scheme === undefined || typeof scheme === "string" ? null : scheme;
}

/** The scheme an environment says now; light when it says none (spec: editor-host). */
export function schemeOf(env: EditorEnvironment): ColorScheme {
  const s = env.colorScheme;
  if (s === undefined) return "light";
  return typeof s === "string" ? s : s.current();
}
