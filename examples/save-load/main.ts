import { InvalidUtf8Error, createEditorState, mountEditor, openMarkdownFile, saveMarkdownFile, type MarkdownFile } from "@openmarkdown-dev/editor";

/**
 * The editor holds LF text without a BOM. `openMarkdownFile` reads the file's
 * bytes (strict UTF-8) and notes its BOM and line endings; `saveMarkdownFile`
 * puts them back. An unedited file goes back to disk as the bytes it came in.
 */

// Unusual but valid Markdown: a BOM, CRLF line endings, a `*` bullet,
// `__strong__`, a trailing-space line break and no final newline.
let file: MarkdownFile = openMarkdownFile(new TextEncoder().encode("\uFEFFTitle\r\n=====\r\n\r\n* item one  \r\n* item __two__\r\n\r\n1) first\r\n2) second"));
let name = "example.md";

const status = document.getElementById("status")!;

/** Compare what Save would write with what was opened, byte by byte. */
function compare(doc: string) {
  const a = file.bytes;
  const b = saveMarkdownFile(doc, file);
  const same = a.length === b.length && a.every((x, i) => x === b[i]);
  status.dataset.identical = String(same);
  status.textContent = same ? `Save writes the same ${b.length} bytes you opened.` : `Edited: ${b.length} bytes, was ${a.length}.`;
}

const editor = mountEditor(document.getElementById("editor")!, createEditorState({ doc: file.text, host: { onChange: compare } }));
compare(editor.getDoc());

document.getElementById("open")!.addEventListener("change", async (e) => {
  const picked = (e.target as HTMLInputElement).files?.[0];
  if (!picked) return;
  try {
    file = openMarkdownFile(new Uint8Array(await picked.arrayBuffer()));
  } catch (err) {
    // Not UTF-8: refuse it rather than let a save write U+FFFD over the bad bytes.
    if (!(err instanceof InvalidUtf8Error)) throw err;
    status.dataset.identical = "false";
    status.textContent = `${picked.name} is not valid UTF-8, so it was not opened.`;
    return;
  }
  name = picked.name;
  editor.setDoc(file.text);
  compare(editor.getDoc());
});

document.getElementById("save")!.addEventListener("click", () => {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([saveMarkdownFile(editor.getDoc(), file)], { type: "text/markdown" }));
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
});
