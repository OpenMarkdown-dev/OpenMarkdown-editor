import { type Extension, Facet } from "@codemirror/state";
import { EditorView, drawSelection } from "@codemirror/view";
import { editorMarkTheme, editorStyleFoundation } from "../theme";
import { imageLoadMeasure } from "../imageElement";
import { imageResize } from "../imageResize";
import { spellChecking } from "../spellcheck";

/**
 * What every editor nested inside a block starts from (spec: block-editing /
 * 嵌套编辑器不受外层样式影响; design D3).
 *
 * - `drawSelection`: the OUTER editor's drawSelection hides the native caret and
 *   selection with `!important` DESCENDANT rules, which reach in here too. Without
 *   drawing its own, a nested editor has focus and no visible caret (found in the
 *   table-cell spike, on a real device).
 * - a compact layout, written as child chains for the same reason the outer
 *   layout is (`editorLayoutTheme`): it must not reach an editor nested in THIS one.
 * - `editorMarkTheme`: rendering styles are shared with the outer editor, on
 *   the same style foundation (tokens + primitives; a nested editor declares
 *   no token defaults of its own and inherits the outer editor's values).
 * - `imageLoadMeasure`: an image in the part (an editing cell) re-measures
 *   this editor when it loads, as the outer editor's copy re-measures that one.
 * - `imageResize`: an image in the part can be dragged to resize, written back
 *   into the part (change: image-resize, D3).
 * - `spellChecking()`: a part being edited (a table cell) gets squiggles while
 *   its outer editor checks and its place there is prose (change: spellcheck).
 */
export function nestedEditorBase(): Extension {
  return [
    drawSelection(),
    EditorView.lineWrapping,
    nestedLayout,
    editorStyleFoundation,
    editorMarkTheme,
    imageLoadMeasure,
    imageResize,
    spellChecking(),
  ];
}

const nestedLayout = EditorView.theme({
  "&": { background: "transparent", font: "inherit", color: "inherit" },
  "&.cm-focused": { outline: "none" },
  "& > .cm-scroller": { fontFamily: "inherit", lineHeight: "inherit", overflow: "visible" },
  "& > .cm-scroller > .cm-content": { padding: "0", textAlign: "inherit" },
});

/**
 * The live preview a part editor should render with, PROVIDED by the outer
 * editor (change: table-cell-editor). The part editor lives inside a block
 * entry, below the block framework; the live preview it renders with is the
 * layer ABOVE that framework (livePreview → blocks/field → registry → table →
 * widgets → partEditor). What the outer editor renders with is the outer
 * editor's to say, so it hands it down — the one direction the layers allow
 * (spec: module-graph / 运行时 import 不成环).
 */
export const nestedPreview = Facet.define<Extension, Extension>({
  combine: (values) => values[0] ?? [],
});
