// The host's file codec (change: editor-integration-fixes, design D4; spec:
// editor-package / 随包提供文件字节适配器).
//
// The editor holds a string in `\n` with no BOM. The fidelity claim — open and
// save without editing, and the file is byte-for-byte what it was — is about
// the FILE, so it holds only when the host's read and write keep what the
// string does not carry: the BOM, the line endings, and the exact bytes. These
// two functions are that read and write. They are pure (no DOM, no I/O) and run
// in browsers and in Node.
//
// The OpenMarkdown app does not use them: it keeps its own Rust-side BOM and
// line-ending handling. They are for hosts.
//
// A host that holds the file as a string (a CMS field, a textarea, a JSON API)
// uses the text pair, `openMarkdownText` / `saveMarkdownText` (change:
// editor-per-instance, design D8). Both pairs are one codec: `layoutOf` reads
// the BOM and the line endings, `isUnedited` decides "unedited", and
// `serialize` writes an edited document — the bytes pair only adds strict
// UTF-8 decoding and encoding around them.

/** A line ending as it appears in the file: LF, CRLF, or a lone CR. */
export type LineEnding = "\n" | "\r\n" | "\r";

/**
 * A Markdown file opened with `openMarkdownFile`: the text to give the editor,
 * plus what `saveMarkdownFile` needs to write it back.
 */
export interface MarkdownFile {
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
 * A Markdown file opened from a string with `openMarkdownText`: the text to
 * give the editor, plus what `saveMarkdownText` needs to write it back. The
 * same as `MarkdownFile`, with the original string in place of the bytes.
 */
export interface MarkdownText {
  /** The text to edit: without a leading BOM, every line ending turned into `\n`. */
  text: string;
  /** The string as it was passed in. `saveMarkdownText` returns it as it is while the text is unedited. */
  source: string;
  /** Whether the string started with a BOM (U+FEFF). An edited save writes it back. */
  bom: boolean;
  /** The line ending an edited save writes: the most frequent one; on a tie, the first. `"\n"` with no line break. */
  ending: LineEnding;
  /** Whether the string mixes line endings. Unedited, it is saved as it was; once edited, every line break is written as `ending`. */
  mixed: boolean;
}

/**
 * Thrown by `openMarkdownFile` when the bytes are not valid UTF-8. Refuse to
 * open the file in the editor: decoding it anyway would replace the bad bytes
 * with U+FFFD, and the next save would write that damage to disk. Recognise it
 * with `instanceof`, or by `code` (`"INVALID_UTF8"`) across bundles.
 */
export class InvalidUtf8Error extends Error {
  /** Always `"INVALID_UTF8"`. */
  readonly code = "INVALID_UTF8";
  /** @param options.cause The decoder's own error. */
  constructor(options?: { cause?: unknown }) {
    super("The file is not valid UTF-8, so it was not opened: editing it would corrupt the invalid bytes.", options);
    this.name = "InvalidUtf8Error";
  }
}

const BOM = "\uFEFF";
const LINE_BREAK = /\r\n|\r|\n/g;

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
export function openMarkdownFile(bytes: Uint8Array): MarkdownFile {
  let raw: string;
  try {
    raw = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch (cause) {
    throw new InvalidUtf8Error({ cause });
  }
  return { ...layoutOf(raw), bytes: bytes.slice() };
}

/** What a decoded file looks like: its text, BOM and line endings. The one reading behind both opens. */
function layoutOf(raw: string): { text: string; bom: boolean; ending: LineEnding; mixed: boolean } {
  const bom = raw.startsWith(BOM);
  const body = bom ? raw.slice(1) : raw;

  const counts = new Map<LineEnding, number>();
  for (const m of body.matchAll(LINE_BREAK)) {
    const e = m[0] as LineEnding;
    counts.set(e, (counts.get(e) ?? 0) + 1);
  }
  // Map keeps insertion order = first appearance, so the strict `>` keeps the earlier one on a tie.
  let ending: LineEnding = "\n";
  let most = 0;
  for (const [e, n] of counts) {
    if (n > most) {
      ending = e;
      most = n;
    }
  }

  return { text: body.replace(LINE_BREAK, "\n"), bom, ending, mixed: counts.size > 1 };
}

/**
 * Is `doc` the opened file's text, unchanged? THE test behind both saves
 * returning the original exactly, and `editor.isUnedited` (an unsaved-changes
 * indicator).
 */
export function isUnedited(doc: string, file: { readonly text: string }): boolean {
  return doc === file.text;
}

/** An edited document as the file writes it: the BOM put back, every line break as `ending`. */
function serialize(doc: string, file: { bom: boolean; ending: LineEnding }): string {
  return (file.bom ? BOM : "") + doc.replace(LINE_BREAK, file.ending);
}

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
export function saveMarkdownFile(doc: string, file: MarkdownFile): Uint8Array {
  if (isUnedited(doc, file)) return file.bytes;
  return new TextEncoder().encode(serialize(doc, file));
}

/**
 * Open a Markdown file you hold as a string — a CMS field, a textarea, a JSON
 * response — for the editor: the same reading as `openMarkdownFile` after
 * decoding (notes and strips a leading BOM, detects the line endings and turns
 * them into `\n`), keeping the original string. Save with `saveMarkdownText`.
 * If you decode bytes yourself, decode with `ignoreBOM: true` (a default
 * `TextDecoder` drops the BOM before this sees it), or use
 * `openMarkdownFile` on the bytes instead.
 *
 * @param source The file's content as a string.
 * @returns The text to edit, and what saving needs to write the string back.
 */
export function openMarkdownText(source: string): MarkdownText {
  return { ...layoutOf(source), source };
}

/**
 * The string to store for the editor's document. Unedited (`doc` equals
 * `file.text`), it is the original string, exactly. Edited, it is `doc` with
 * the original BOM put back and every line break written as `file.ending` —
 * the same text `saveMarkdownFile` encodes.
 *
 * @param doc The document to save, usually `editor.getDoc()`.
 * @param file What `openMarkdownText` returned for this string.
 * @returns The string to store.
 */
export function saveMarkdownText(doc: string, file: MarkdownText): string {
  if (isUnedited(doc, file)) return file.source;
  return serialize(doc, file);
}
