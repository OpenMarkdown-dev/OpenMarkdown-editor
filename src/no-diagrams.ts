/**
 * `@openmarkdown-dev/editor/no-diagrams` — the editor without diagram support
 * (spec: editor-package / 入口与内置渲染器). The same public surface as the main
 * entry (`./index.ts`), from the same source; the one difference is
 * `createEditorState`, which comes from `src/editor/noDiagrams.ts` and never
 * installs the built-in Mermaid. Nothing this entry imports reaches the
 * `mermaid` package, so a bundler emits no Mermaid chunk for it. A
 * ```` ```mermaid ```` fence stays a code block unless the host gives its own
 * `renderDiagram`.
 *
 * Locked by `packages/editor/api.gate.test.ts` against
 * `packages/editor/api/editor-no-diagrams.api.d.ts`.
 *
 * @packageDocumentation
 */

export { createEditorState, mountEditor } from "./editor/noDiagrams";
export type { EditorStateOptions, MarkdownEditor } from "./editor/base";
export { configureEditorEnvironment } from "./editor/environment";
export type { EditorEnvironment, EditorOwnEnvironment, ColorScheme, ColorSchemeSource, SpellService, SpellMiss, MathRenderer, DiagramRenderer } from "./editor/environment";
export type { EditorHost, EditorMode } from "./editor/host";
export type { OutlineItem } from "./editor/outline";
export type { EditorLang } from "./editor/strings";
export { openMarkdownFile, saveMarkdownFile, openMarkdownText, saveMarkdownText, InvalidUtf8Error } from "./editor/fileBytes";
export type { MarkdownFile, MarkdownText, LineEnding } from "./editor/fileBytes";
