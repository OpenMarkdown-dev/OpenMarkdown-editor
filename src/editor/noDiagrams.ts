import type { EditorState } from "@codemirror/state";
import { buildEditorState, type EditorStateOptions } from "./base";
import { importTemml } from "./mathImport";

/**
 * The editor without its built-in diagram renderer (spec: editor-package /
 * 入口与内置渲染器): everything in `./base.ts` plus the built-in formula
 * renderer (`./mathImport.ts`). Nothing it imports reaches the `mermaid`
 * package. Published as `@openmarkdown-dev/editor/no-diagrams`.
 */
export { mountEditor } from "./base";

/**
 * Build an editor state: the document, caret, undo history, folds and mode,
 * with the whole editor (live preview, structure keys, find, folding, tables,
 * math) installed, but no built-in diagram renderer: this is the
 * `@openmarkdown-dev/editor/no-diagrams` entry, which does not contain
 * Mermaid. A ```` ```mermaid ```` fence stays a code block unless you give a
 * diagram renderer of your own (`renderDiagram` in the environment — your
 * page's copy of Mermaid, say). Show the state with `mountEditor`; a host with
 * several documents keeps one state per document and swaps them into one view
 * (`editor.view.setState(state)`, then `editor.syncAmbient()`).
 */
export function createEditorState(options: EditorStateOptions): EditorState {
  return buildEditorState(options, { math: importTemml });
}
