/**
 * `@openmarkdown-dev/editor/no-renderers` — the editor without built-in renderers
 * (spec: editor-package / 入口与内置渲染器). The same public surface as the main
 * entry (`./index.ts`), from the same source; the one difference is
 * `createEditorState`, which comes from `src/editor/base.ts` and installs
 * neither built-in renderer. Nothing this entry imports reaches `temml` or
 * `mermaid` — not even through `import()` — so a bundler that cannot split
 * (an IIFE or single-file build) inlines neither. Formulas and diagrams render
 * through the host's `renderMath` / `renderDiagram`; without them a formula
 * shows its TeX and a ```` ```mermaid ```` fence stays a code block.
 *
 * Locked by `packages/editor/api.gate.test.ts` against
 * `packages/editor/api/editor-no-renderers.api.d.ts`.
 *
 * @packageDocumentation
 */

export { createEditorState, mountEditor } from "./editor/base";
export type { EditorStateOptions, MarkdownEditor } from "./editor/base";
export { configureEditorEnvironment } from "./editor/environment";
export type { EditorEnvironment, EditorOwnEnvironment, ColorScheme, ColorSchemeSource, SpellService, SpellMiss, MathRenderer, DiagramRenderer } from "./editor/environment";
export type { EditorHost, EditorMode } from "./editor/host";
export type { OutlineItem } from "./editor/outline";
export type { EditorLang } from "./editor/strings";
export { openMarkdownFile, saveMarkdownFile, openMarkdownText, saveMarkdownText, InvalidUtf8Error } from "./editor/fileBytes";
export type { MarkdownFile, MarkdownText, LineEnding } from "./editor/fileBytes";
