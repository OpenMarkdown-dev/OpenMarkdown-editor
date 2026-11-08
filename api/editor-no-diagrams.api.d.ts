import { EditorView } from '@codemirror/view';
import { Extension, EditorState } from '@codemirror/state';

interface Heading {
    /** Heading text without the `#` markers or a closing sequence. */
    text: string;
    /** 1–6. */
    level: number;
    /** The `::` join of the ancestor texts and this one, unescaped (for display; query with `anchor`). */
    path: string;
    /** `path`'s segments. */
    segments: string[];
    /**
     * The plainest query that resolves to exactly this heading (see `anchorOf`),
     * or null for a heading with no text (`#` alone): it names nothing.
     */
    anchor: string | null;
    /** 1-based line of the heading, and of the section's last line (inclusive). */
    fromLine: number;
    toLine: number;
    /** Offset of the heading line start. */
    from: number;
    /** Offset right after the heading line's newline (the body start). */
    bodyFrom: number;
    /** Offset of the section end: the next heading of level ≤ own, or the end. */
    to: number;
}

/**
 * One heading of the document, as `EditorHost.onOutline` reports it: its text,
 * level, line range and offsets.
 */
type OutlineItem = Heading;

/**
 * How the editor shows the document: `live` renders Markdown in place and
 * reveals the source under the caret; `source` is the plain text, colored;
 * `reading` is rendered and read-only.
 */
type EditorMode = "live" | "source" | "reading";
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
interface EditorHost {
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

/**
 * The editor's own UI strings: exactly the words the editor draws — the find
 * panel, the code-copy button, fold handles, the properties block, image and
 * link chips, render failures — in every language it ships.
 *
 * The language is the host's to pick, through the editor environment's
 * `language`; it is read when a string is drawn, never at module evaluation.
 * Without a host language, or with one the editor does not ship, the editor
 * speaks English: a fixed default, not a guess from the browser, so the editor
 * behaves the same in every host and the host stays the only owner of
 * language policy.
 */
/** The languages the editor ships (`zh` is Simplified Chinese). */
declare const EDITOR_LANGS: readonly ["zh", "ja", "ko", "en"];
/** A language the editor's own UI words ship in (`EditorEnvironment.language`). */
type EditorLang = (typeof EDITOR_LANGS)[number];

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
interface EditorEnvironment {
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
type ColorScheme = "light" | "dark";
/** One misspelling, UTF-16 offsets into the paragraph that was sent. */
interface SpellMiss {
    from: number;
    to: number;
}
/**
 * A spell checker keyed by "spell document" numbers (one per top-level editor,
 * so the checker can keep per-editor ignore lists).
 */
interface SpellService {
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
/**
 * Provide the window-wide capabilities (`EditorEnvironment`). Call once at
 * startup, before the first editor mounts; a later call replaces the whole
 * environment. Optional: without it the editor is light, English, and has no
 * clipboard, external-link, spelling or host-key behaviour.
 */
declare function configureEditorEnvironment(env: EditorEnvironment): void;

/** A line ending as it appears in the file: LF, CRLF, or a lone CR. */
type LineEnding = "\n" | "\r\n" | "\r";
/**
 * A Markdown file opened with `openMarkdownFile`: the text to give the editor,
 * plus what `saveMarkdownFile` needs to write it back.
 */
interface MarkdownFile {
    /**
     * The text to edit: the file decoded as UTF-8, without a leading BOM, with
     * every line ending turned into `\n`. Pass it as `doc` to `createEditorState`
     * (or to `editor.setDoc`). Unicode is kept as written: nothing is normalized.
     */
    text: string;
    /**
     * The file's original bytes (a copy of what was passed in).
     * `saveMarkdownFile` returns them as they are while the text is unedited.
     */
    bytes: Uint8Array;
    /** Whether the file started with a UTF-8 BOM (`EF BB BF`). An edited save writes it back. */
    bom: boolean;
    /**
     * The line ending an edited save writes: the file's most frequent one; on a
     * tie, the one that comes first in the file. `"\n"` for a file with no line
     * break.
     */
    ending: LineEnding;
    /**
     * Whether the file mixes line endings (two or more of LF, CRLF and lone CR).
     * Unedited, it is saved as its original bytes, mix included; once edited,
     * every line break is written as `ending`.
     */
    mixed: boolean;
}
/**
 * Thrown by `openMarkdownFile` when the bytes are not valid UTF-8. Refuse to
 * open the file in the editor: decoding it anyway would replace the bad bytes
 * with U+FFFD, and the next save would write that damage to disk. Recognise it
 * with `instanceof`, or by `code` (`"INVALID_UTF8"`) across bundles.
 */
declare class InvalidUtf8Error extends Error {
    /** Always `"INVALID_UTF8"`. */
    readonly code = "INVALID_UTF8";
    /** @param options.cause The decoder's own error. */
    constructor(options?: {
        cause?: unknown;
    });
}
/**
 * Open a Markdown file's bytes for the editor. Decodes strict UTF-8 (invalid
 * bytes throw `InvalidUtf8Error`; nothing is replaced), notes and strips a
 * leading BOM, detects the line endings (LF, CRLF, lone CR, or a mix) and turns
 * them into `\n`, and keeps a copy of the original bytes. Save with
 * `saveMarkdownFile`.
 *
 * @param bytes The file as read from disk, a network response or a file input.
 * @returns The text to edit, and what saving needs to write the file back.
 * @throws InvalidUtf8Error when `bytes` is not valid UTF-8.
 */
declare function openMarkdownFile(bytes: Uint8Array): MarkdownFile;
/**
 * The bytes to write for the editor's document. Unedited (`doc` equals
 * `file.text`), they are the original bytes, exactly. Edited, they are `doc`
 * encoded as UTF-8 with the file's BOM put back and every line break written
 * as `file.ending`; a file with mixed line endings gets uniform ones.
 *
 * @param doc The document to save, usually `editor.getDoc()`.
 * @param file What `openMarkdownFile` returned for this file.
 * @returns The file's bytes.
 */
declare function saveMarkdownFile(doc: string, file: MarkdownFile): Uint8Array;

/** What a new editor state starts with (`createEditorState`). Every field is optional. */
interface EditorStateOptions {
    /** The Markdown source to edit. Default: the empty document. */
    doc?: string;
    /** Live preview (default), plain source, or read-only reading mode. */
    mode?: EditorMode;
    /** The document's absolute path, or null for an unsaved one. Relative links and images resolve against it, and pasted images are stored beside it. Default: null. */
    docPath?: string | null;
    /** Where the caret starts (UTF-16 offsets into `doc`). Default: the start of the document. */
    selection?: {
        anchor: number;
        head?: number;
    };
    /** The per-document callbacks (change, links, images, attachments, completion, outline). Default: none. */
    host?: EditorHost;
    /**
     * Draw spelling squiggles when the environment's spell service is on. Turn it
     * off for an editor where a squiggle could not be fixed. Default true.
     */
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
    extensions?: Extension;
}
/**
 * A mounted editor (`mountEditor`): the CodeMirror view plus the operations a
 * host needs. Call `destroy` when the editor leaves the page.
 */
interface MarkdownEditor {
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
    syncAmbient(): void;
    /** Tear the view down and drop the color-scheme subscription. */
    destroy(): void;
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
declare function createEditorState(options: EditorStateOptions): EditorState;
/**
 * Mount `state` (from `createEditorState`) in a new editor view appended to
 * `parent`, following the environment's color scheme while it lives. Returns
 * the editor handle; call its `destroy` when done.
 */
declare function mountEditor(parent: HTMLElement, state: EditorState): MarkdownEditor;

export { InvalidUtf8Error, configureEditorEnvironment, createEditorState, mountEditor, openMarkdownFile, saveMarkdownFile };
export type { ColorScheme, EditorEnvironment, EditorHost, EditorLang, EditorMode, EditorStateOptions, LineEnding, MarkdownEditor, MarkdownFile, OutlineItem, SpellMiss, SpellService };
