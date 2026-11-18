import type { EditorState } from "@codemirror/state";
import { buildEditorState, type EditorStateOptions } from "./base";
import { importMermaid } from "./mermaidImport";
import { importTemml } from "./mathImport";

/**
 * The editor's full entry: everything in `./base.ts` (the editor itself, defined
 * once), plus both built-in renderers — the one difference is that this
 * `createEditorState` hands the builder the Temml and Mermaid loaders
 * (`./mathImport.ts`, `./mermaidImport.ts`). The diagram-free entry is
 * `./noDiagrams.ts`, the one without renderers `./base.ts` itself (spec:
 * editor-package / 入口与内置渲染器).
 */
export { mountEditor, buildEditorState } from "./base";
export type { EditorStateOptions, MarkdownEditor } from "./base";
export type { EditorMode, EditorHost } from "./host";
export { editorConfigOf } from "./host";
export { configureEditorEnvironment } from "./environment";
export type { EditorEnvironment, EditorOwnEnvironment, ColorScheme, ColorSchemeSource, SpellService, SpellMiss, MathRenderer, DiagramRenderer } from "./environment";
export { openMarkdownFile, saveMarkdownFile, openMarkdownText, saveMarkdownText, InvalidUtf8Error } from "./fileBytes";
export type { MarkdownFile, MarkdownText, LineEnding } from "./fileBytes";

/**
 * Build an editor state: the document, caret, undo history, folds and mode,
 * with the whole editor (live preview, structure keys, find, folding, tables,
 * math, diagrams) installed. Show it with `mountEditor`; a host with several
 * documents keeps one state per document and swaps them into one view
 * (`editor.view.setState(state)`, then `editor.syncAmbient()`).
 */
export function createEditorState(options: EditorStateOptions): EditorState {
  return buildEditorState(options, { math: importTemml, diagram: importMermaid });
}
