import { createEditorState, mountEditor, type EditorHost } from "@openmarkdown-dev/editor";

// Stand-in for your upload endpoint: keep the bytes in this tab and hand back a URL.
// A real host would POST them and return the stored file's address.
const uploaded = new Map<string, string>();
let n = 0;

const host: EditorHost = {
  async saveAttachment(_docPath, bytes, hint) {
    const name = `uploads/${++n}-${(hint ?? "image").replace(/[^\w.-]+/g, "-")}`;
    uploaded.set(name, URL.createObjectURL(new Blob([bytes.slice()])));
    const li = document.createElement("li");
    li.textContent = `${name} (${bytes.length} bytes)`;
    document.getElementById("uploads")!.append(li);
    return name; // inserted into the document as ![](uploads/…)
  },
  // Map what the document says to what the browser may load.
  resolveImage: (src) => uploaded.get(src) ?? (src.startsWith("https://") ? src : null),
};

mountEditor(
  document.getElementById("editor")!,
  createEditorState({
    doc: "# Paste an image\n\nCopy a screenshot and paste it here, or drop an image file. Drag its corner to resize.\n\n",
    // A document path turns paste / drop on: attachments are named relative to it.
    docPath: "/notes/example.md",
    host,
  }),
);
