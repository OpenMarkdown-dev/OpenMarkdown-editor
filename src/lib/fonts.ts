/**
 * The app's one monospace stack (spec: live-preview-editor / 代码只有一种字体).
 * Code in the document, the terminal, and every other fixed-width surface take
 * it from here; the gate `src/editor/codeFont.gate.test.ts` fails on a copy.
 */
export const MONO_FONT_FAMILY = "ui-monospace, 'SF Mono', Menlo, monospace";
