/**
 * `@openmarkdown-dev/editor` — the OpenMarkdown editor core, a live-preview Markdown
 * editor built on CodeMirror 6 that edits the source text itself (spec:
 * editor-package / 公共入口只有一个).
 *
 * This file is the package's ONE public entry and lists its whole public
 * surface; nothing else in the build is reachable from outside. The surface is
 * locked by `packages/editor/api.gate.test.ts` against
 * `packages/editor/api/editor.api.d.ts` — changing what is exported here, or
 * the shape of anything exported, fails that gate until the snapshot is
 * regenerated on purpose (`npm run build:editor -- --update-api`).
 *
 * The declarations live in `src/editor/**` (the core) and carry their own
 * TSDoc; this file only chooses what is public.
 *
 * @packageDocumentation
 */

export { createEditorState, mountEditor } from "./editor/index";
export type { EditorStateOptions, MarkdownEditor } from "./editor/index";
export { configureEditorEnvironment } from "./editor/environment";
export type { EditorEnvironment, ColorScheme, SpellService, SpellMiss } from "./editor/environment";
export type { EditorHost, EditorMode } from "./editor/host";
export type { OutlineItem } from "./editor/outline";
export type { EditorLang } from "./editor/strings";
export { openMarkdownFile, saveMarkdownFile, InvalidUtf8Error } from "./editor/fileBytes";
export type { MarkdownFile, LineEnding } from "./editor/fileBytes";
