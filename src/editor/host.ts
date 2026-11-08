import { StateEffect, StateField, type EditorState } from "@codemirror/state";
import type { OutlineItem } from "./outline";

/**
 * How the editor shows the document: `live` renders Markdown in place and
 * reveals the source under the caret; `source` is the plain text, colored;
 * `reading` is rendered and read-only.
 */
export type EditorMode = "live" | "source" | "reading";

/**
 * What the editor calls back into, per document: pass it as `host` to
 * `createEditorState`. The editor reads each member through the object when it
 * needs it, so you can change the object later without rebuilding the state.
 *
 * Every member is optional: a capability the host does not provide is switched
 * off quietly (no error, no notice) and the rest of the editor carries on.
 * Window-wide capabilities live in the editor environment
 * (`configureEditorEnvironment`).
 */
// spec: editor-host / 宿主能力只经两个注入口进入. Held by the ONE pane that owns
// the view and read lazily, so a state created for one tab and swapped in later
// never runs a stale closure (change: tab-state, D1). Only the shown state ever
// renders or fires, so "the pane's current callbacks" are always the right ones.
export interface EditorHost {
  /**
   * The document changed; `doc` is the whole new source. `isUserEdit` is true for
   * typing, pasting and other user actions, false for programmatic changes
   * (`setDoc`). `docPath` is the document the change happened in, so a host that
   * swaps documents can drop a change for one that is no longer shown.
   */
  onChange?: (doc: string, isUserEdit: boolean, docPath: string | null) => void;
  /**
   * Map an image target as written (`![](src)`) to a URL the page may load, or
   * null to show the source instead. Script-capable URLs are dropped whatever
   * this returns. Absent: only absolute `https:` images load. It may be called
   * more than once for the same image, so keep it free of side effects; when its
   * answer changes, call `editor.refreshImages()`.
   */
  resolveImage?: (src: string) => string | null;
  /**
   * A link to a local file was followed (Cmd/Ctrl+click; a plain click in reading
   * mode): `absPath` is the target resolved against the document's directory, and
   * `fragment` its decoded `#fragment` without the `#` (`other.md#setup` →
   * `"setup"`), or null. The host decides whether the file exists, how to open it
   * and whether to go to the fragment. Absent: local links do nothing.
   */
  openLink?: (absPath: string, fragment: string | null) => void;
  /**
   * The root folder of the user's files, for link-target completion. A getter,
   * read each time completion opens. Null, or absent: completion uses the
   * document's own directory.
   */
  getFolder?: () => string | null;
  /** The selection, scroll position or document moved (debounced); use it to remember the position. */
  onMoved?: () => void;
  /**
   * Store pasted / dropped image bytes beside `docPath`. `hint` is the file's
   * name, or its MIME type. Resolves the document-relative path to link, or null
   * when the save failed (report it yourself); then the editor inserts nothing.
   * Only called when the document has a path.
   * Absent: image paste / drop stores nothing and inserts nothing.
   */
  saveAttachment?: (docPath: string, bytes: Uint8Array, hint: string | null) => Promise<string | null>;
  /**
   * Images were pasted or dropped but could not be stored, so nothing was
   * inserted: `reason` is `"no-save-attachment"` (no `saveAttachment`) or
   * `"no-doc-path"` (the document has no path to store them beside); `count` is
   * how many images. Only a notice — the editor itself stays silent and the
   * document is unchanged. Use it to tell the user. Absent: nothing happens.
   */
  // spec: editor-host / 宿主可选地获知被丢弃的图片 (an optional notice; the
  // silence of 宿主未提供的能力静默关闭 is unchanged).
  onUnsupportedPaste?: (reason: "no-save-attachment" | "no-doc-path", count: number) => void;
  /**
   * The linkable files under `root`, as root-relative paths (link-target
   * completion). Absent: file completion offers nothing; heading completion is
   * unaffected.
   */
  listFiles?: (root: string) => Promise<string[]>;
  /** The heading outline changed; null when the view is going away (clear yours). */
  onOutline?: (outline: OutlineItem[] | null) => void;
}

/** What a state carries about its document (change: tab-state, D1). */
export interface EditorConfig {
  docPath: string | null;
  mode: EditorMode;
  host: EditorHost;
}

export const setEditorConfig = StateEffect.define<EditorConfig>();

/** The per-document config travels in the state, so a swapped-in state brings its own. */
export const editorConfig = StateField.define<EditorConfig>({
  create: () => ({ docPath: null, mode: "live", host: {} }),
  update(value, tr) {
    for (const e of tr.effects) if (e.is(setEditorConfig)) value = e.value;
    return value;
  },
});

/** The document path / mode a state was configured for (null path = the empty state). */
export function editorConfigOf(state: EditorState): { docPath: string | null; mode: EditorMode } {
  const c = state.field(editorConfig, false);
  return { docPath: c?.docPath ?? null, mode: c?.mode ?? "live" };
}

/** The host a state was built with (an empty host when the state has no editor config). */
export function hostOf(state: EditorState): EditorHost {
  return state.field(editorConfig, false)?.host ?? {};
}
