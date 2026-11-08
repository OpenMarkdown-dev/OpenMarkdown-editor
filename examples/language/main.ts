import { configureEditorEnvironment, createEditorState, mountEditor, type EditorEnvironment, type MarkdownEditor } from "@openmarkdown-dev/editor";

type Language = NonNullable<EditorEnvironment["language"]>;

const parent = document.getElementById("editor")!;
const select = document.getElementById("language") as HTMLSelectElement;
let editor: MarkdownEditor | null = null;
let doc = "---\ntitle: Language\ntags: [demo]\n---\n\n# UI language\n\nThe editor's own words, like the property controls above and the find panel (Cmd/Ctrl+F), follow the language you pick.\n\n```js\nconsole.log(\"the copy button's tooltip too\");\n```\n";

/** The language is read when a word is drawn, so remount to redraw what is already on screen. */
function mount(language: Language) {
  if (editor) {
    doc = editor.getDoc();
    editor.destroy();
  }
  configureEditorEnvironment({ language });
  editor = mountEditor(parent, createEditorState({ doc }));
}

select.addEventListener("change", () => mount(select.value as Language));
mount(select.value as Language);
