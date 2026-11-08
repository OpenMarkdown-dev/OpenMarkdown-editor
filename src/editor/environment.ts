import type { EditorView } from "@codemirror/view";
import type { EditorLang } from "./strings";

/**
 * The editor environment: window-wide capabilities the host provides once per
 * page with `configureEditorEnvironment`. Per-document needs go through
 * `EditorHost` instead.
 *
 * Every member is optional: what the host leaves out is switched off quietly —
 * no error, no notice, no fallback of the editor's own. An editor mounted with
 * no environment configured at all is light, English, editable, and has no
 * copy, external-link, spelling or host-key behaviour.
 */
// spec: editor-host / 宿主能力只经两个注入口进入. No hidden fallbacks: one would make
// the editor behave differently per host and bypass the host's error policy.
export interface EditorEnvironment {
  /**
   * The language of the editor's own UI words. Read whenever a word is drawn,
   * so set it before the first editor mounts; already-drawn words do not redraw
   * on a change. Left out, or not one the editor ships: English.
   */
  language?: EditorLang;
  /** The window's light / dark scheme: its value now, and a subscription to changes (returns the unsubscribe). */
  colorScheme?: {
    current(): ColorScheme;
    subscribe(cb: (scheme: ColorScheme) => void): () => void;
  };
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
}

/** The editor's light or dark look; it follows `EditorEnvironment.colorScheme`. */
export type ColorScheme = "light" | "dark";

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
 * Provide the window-wide capabilities (`EditorEnvironment`). Call once at
 * startup, before the first editor mounts; a later call replaces the whole
 * environment. Optional: without it the editor is light, English, and has no
 * clipboard, external-link, spelling or host-key behaviour.
 */
export function configureEditorEnvironment(env: EditorEnvironment): void {
  environment = env;
}

/** The current environment (empty until configured). Read at call time, never cached. */
export function editorEnvironment(): EditorEnvironment {
  return environment;
}
