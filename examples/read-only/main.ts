import { createEditorState, mountEditor, type EditorMode } from "@openmarkdown-dev/editor";

const doc = `# Release notes

Reading mode renders the document and **cannot be edited**. Switch to Live to
edit with the preview, or to Source for the plain text.

| Version | Change |
| --- | --- |
| 0.1.0 | First release |

- [x] Tables, math and diagrams render here too
- [ ] Tick me in reading mode; lock the editor and I stay as I am
`;

const editor = mountEditor(document.getElementById("editor")!, createEditorState({ doc, mode: "reading" }));

const buttons = [...document.querySelectorAll<HTMLButtonElement>("[data-mode]")];
const show = () => buttons.forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.mode === editor.mode())));
for (const b of buttons) {
  b.addEventListener("click", () => {
    // The document, selection and undo history are kept across modes.
    editor.setMode(b.dataset.mode as EditorMode);
    show();

// `editable: false` is separate from the mode: the document cannot change in any
// mode, not even by a task checkbox (which reading mode lets you tick).
const lock = document.getElementById("lock") as HTMLInputElement;
lock.addEventListener("change", () => editor.setEditable(!lock.checked));
  });
}
show();

// `editable: false` is separate from the mode: the document cannot change in any
// mode, not even by a task checkbox (which reading mode lets you tick).
const lock = document.getElementById("lock") as HTMLInputElement;
lock.addEventListener("change", () => editor.setEditable(!lock.checked));
