import type { EditorState } from "@codemirror/state";
import { buildEditorState, type EditorStateOptions } from "./base";
import { importMermaid } from "./mermaidImport";

/**
 * The editor's full entry: everything in `./base.ts` (the editor itself, defined
 * once), plus diagrams — the one difference is that this `createEditorState`
 * hands the builder the Mermaid loader (`./mermaidImport.ts`). The diagram-free
 * entry is `./base.ts` itself (spec: editor-package / 无图表的入口).
 */
export { mountEditor, buildEditorState } from "./base";
export type { EditorStateOptions, MarkdownEditor } from "./base";
export type { EditorMode, EditorHost } from "./host";
export { editorConfigOf } from "./host";
export { configureEditorEnvironment } from "./environment";
export type { EditorEnvironment, ColorScheme, SpellService, SpellMiss } from "./environment";
export { openMarkdownFile, saveMarkdownFile, InvalidUtf8Error } from "./fileBytes";
export type { MarkdownFile, LineEnding } from "./fileBytes";

/**
 * Build an editor state: the document, caret, undo history, folds and mode,
 * with the whole editor (live preview, structure keys, find, folding, tables,
 * math, diagrams) installed. Show it with `mountEditor`; a host with several
 * documents keeps one state per document and swaps them into one view
 * (`editor.view.setState(state)`, then `editor.syncAmbient()`).
 */
export function createEditorState(options: EditorStateOptions): EditorState {
  return buildEditorState(options, importMermaid);
}
