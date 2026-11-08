import { EditorView } from "@codemirror/view";
import { opensAs } from "@/lib/opensAs";
import type { EditorHost } from "./host";
import { relativePath } from "./relativePath";

/**
 * Paste / drop image → attachments → insert relative link (spec:
 * image-attachments). Clipboard image blobs (paste) and dropped image files
 * (drop) both flow through the host's `saveAttachment` (spec: editor-host; in
 * the app, src/lib/disk.ts — the frontend's one door to the Rust write funnel;
 * it never writes the FS directly), which stores the bytes under a doc-sibling
 * `attachments/` folder and returns a document-relative path; we then insert
 * `![](relative/path)` at the cursor / drop position. Local-image rendering
 * (change: reference-rendering) makes the insertion immediately visible.
 *
 * Drop REQUIRES `dragDropEnabled: false` on the window (tauri.conf.json):
 * Tauri's OS-level drag-drop (default on) otherwise swallows the file drop
 * before the webview, so this DOM `drop` handler never fires. With it off, the
 * WKWebView delivers standard `File` objects whose bytes are readable via
 * `File.arrayBuffer()` — no native drag-drop event needed. (Paste is a pure
 * clipboard DOM event and is unaffected by that flag.)
 */

type SaveAttachment = NonNullable<EditorHost["saveAttachment"]>;
type NotifyUnsupported = NonNullable<EditorHost["onUnsupportedPaste"]>;
type UnsupportedPasteReason = Parameters<NotifyUnsupported>[0];

/** Insert syntax for an image reference. Pure (unit-tested). */
export function imageInsertText(relPath: string): string {
  return `![](${relPath})`;
}

/** Cursor offset that lands inside the empty alt-text slot of `![]()`. */
const ALT_CURSOR_OFFSET = 2;

/**
 * dataTransfer MIME carrying an absolute workspace-file path for an internal
 * sidebar → editor drag (spec: sidebar-drag-link). A private type so it never
 * collides with text / uri-list drags; the drop handler checks it before the
 * image (OS file) path. The sidebar file row is the sole producer.
 */
export const WORKSPACE_PATH_DND_TYPE = "application/x-openmd-path";

/**
 * A relative path's link label: base name with a trailing `.md` stripped (other
 * extensions kept). Pure (unit-tested). Single source of truth for the label a
 * file-target link gets, shared by the sidebar drag (`fileLinkInsertText`) and
 * the Cmd+K / `[[` completion name-fill (linkComplete.ts) so every "link to a
 * file" entry point names the link the same way.
 */
export function fileLabel(relPath: string): string {
  const base = relPath.split("/").pop() ?? relPath;
  return base.replace(/\.md$/i, "");
}

/**
 * Insert syntax for a link to an existing workspace file. Pure (unit-tested).
 * Label = the file's base name with a trailing `.md` stripped (other extensions
 * kept); target = the already-relativized path.
 */
export function fileLinkInsertText(relPath: string): string {
  // An image row dragged from the tree embeds the picture, as a dropped image
  // file does (`![](rel)`) — the tree lists images since change image-viewer.
  if (opensAs(relPath) === "image") return imageInsertText(relPath);
  return `[${fileLabel(relPath)}](${relPath})`;
}

function isImageFile(f: File | null): f is File {
  return !!f && f.type.startsWith("image/");
}

function clipboardImage(data: DataTransfer | null): File | null {
  if (!data) return null;
  for (const item of Array.from(data.items)) {
    if (item.kind === "file" && item.type.startsWith("image/")) {
      const f = item.getAsFile();
      if (f) return f;
    }
  }
  return null;
}

function droppedImages(data: DataTransfer | null): File[] {
  if (!data) return [];
  return Array.from(data.files).filter(isImageFile);
}

/**
 * Why images cannot be stored here, or null when they can. Pure (unit-tested).
 * A missing `saveAttachment` is named first: it is the one a host can fix.
 */
export function unsupportedPasteReason(docPath: string | null, save: SaveAttachment | undefined): UnsupportedPasteReason | null {
  if (!save) return "no-save-attachment";
  if (!docPath) return "no-doc-path";
  return null;
}

/** Exported for tests: the no-capability path returns before touching `view`. */
export async function storeAndInsert(
  view: EditorView,
  files: File[],
  docPath: string | null,
  save: SaveAttachment | undefined,
  pos: number,
  notify?: NotifyUnsupported,
): Promise<void> {
  // Every real document has a path (even the scratch note); a null path only
  // happens in browser dev with no filesystem — nowhere to put attachments.
  // No host save: nothing is stored or inserted (spec: editor-host / 静默关闭);
  // the host may ask to hear about it (`onUnsupportedPaste`, a notice only).
  const missing = unsupportedPasteReason(docPath, save);
  if (missing || !docPath || !save) {
    if (missing) notify?.(missing, files.length);
    return;
  }
  const rels: string[] = [];
  for (const file of files) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    // A failure is already reported (the save-error path); insert nothing.
    const rel = await save(docPath, bytes, file.name || file.type || null);
    if (rel === null) return;
    rels.push(rel);
  }
  const text = rels.map(imageInsertText).join("\n");
  const anchor = rels.length === 1 ? pos + ALT_CURSOR_OFFSET : pos + text.length;
  view.dispatch({
    changes: { from: pos, insert: text },
    selection: { anchor },
    userEvent: "input",
  });
  view.focus();
}

/**
 * Insert a relative markdown link to an existing workspace file at `pos`
 * (spec: sidebar-drag-link). No bytes are read or copied — this references a
 * file that already exists on disk. A null `docPath` (unsaved document, no
 * directory to resolve the relative path against) is a graceful no-op.
 */
function insertFileLink(
  view: EditorView,
  absPath: string,
  docPath: string | null,
  pos: number,
): void {
  if (!docPath) return;
  const docDir = docPath.slice(0, docPath.lastIndexOf("/")) || "/";
  const text = fileLinkInsertText(relativePath(docDir, absPath));
  view.dispatch({
    changes: { from: pos, insert: text },
    selection: { anchor: pos + text.length },
    userEvent: "input",
  });
  view.focus();
}

/**
 * Editor extension adding paste/drop image handling. `docPath` is the open
 * document's absolute path (attachments land beside it); `getSave` reads the
 * host's `saveAttachment` at drop time (absent → the image is swallowed, not
 * stored, and `getNotify`'s `onUnsupportedPaste`, if any, hears why). A write failure is reported by the host's save to its own error path.
 */
export function imagePaste(
  docPath: string | null,
  getSave: () => SaveAttachment | undefined,
  getNotify: () => NotifyUnsupported | undefined = () => undefined,
) {
  return EditorView.domEventHandlers({
    paste(event, view) {
      if (view.state.readOnly) return false;
      const file = clipboardImage(event.clipboardData);
      if (!file) return false; // let the default (text) paste proceed
      event.preventDefault();
      void storeAndInsert(view, [file], docPath, getSave(), view.state.selection.main.head, getNotify());
      return true;
    },
    dragover(event) {
      const data = event.dataTransfer;
      if (!data) return false;
      // A drop only fires if dragover's default is prevented. Two droppable
      // sources: an internal sidebar file drag (our private type — readable via
      // `types` even though `getData` is blocked during dragover) and an OS file
      // drag (image paste). `types` includes covers the former; item kind the
      // latter.
      const droppable =
        data.types.includes(WORKSPACE_PATH_DND_TYPE) ||
        Array.from(data.items).some((i) => i.kind === "file");
      if (droppable) event.preventDefault();
      return false;
    },
    drop(event, view) {
      if (view.state.readOnly) return false;
      const pos =
        view.posAtCoords({ x: event.clientX, y: event.clientY }) ??
        view.state.selection.main.head;
      // Internal sidebar drag → insert a relative link (checked before images:
      // it carries no `files`, only our private path type). No bytes copied.
      const wsPath = event.dataTransfer?.getData(WORKSPACE_PATH_DND_TYPE);
      if (wsPath) {
        event.preventDefault();
        insertFileLink(view, wsPath, docPath, pos);
        return true;
      }
      const files = droppedImages(event.dataTransfer);
      if (files.length === 0) return false;
      event.preventDefault();
      void storeAndInsert(view, files, docPath, getSave(), pos, getNotify());
      return true;
    },
  });
}
