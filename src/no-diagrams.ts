/**
 * `@openmarkdown-dev/editor/no-diagrams` — the editor without diagram support
 * (spec: editor-package / 无图表的入口). The same public surface as the main
 * entry (`./index.ts`), from the same source; the one difference is
 * `createEditorState`, which comes from `src/editor/base.ts` and never installs
 * the Mermaid loader. Nothing this entry imports reaches the `mermaid` package,
 * so a bundler emits no Mermaid chunk for it. A ```` ```mermaid ```` fence stays
 * a code block; `EditorStateOptions.diagrams` is accepted and ignored.
 *
 * Locked by `packages/editor/api.gate.test.ts` against
 * `packages/editor/api/editor-no-diagrams.api.d.ts`.
 *
 * @packageDocumentation
 */

export { createEditorState, mountEditor } from "./editor/base";
export type { EditorStateOptions, MarkdownEditor } from "./editor/base";
export { configureEditorEnvironment } from "./editor/environment";
export type { EditorEnvironment, ColorScheme, SpellService, SpellMiss } from "./editor/environment";
export type { EditorHost, EditorMode } from "./editor/host";
export type { OutlineItem } from "./editor/outline";
export type { EditorLang } from "./editor/strings";
export { openMarkdownFile, saveMarkdownFile, InvalidUtf8Error } from "./editor/fileBytes";
export type { MarkdownFile, LineEnding } from "./editor/fileBytes";
