import type { EditorView } from "@codemirror/view";
import { editorString } from "../strings";
import { blockDecorationField } from "./field";
import { addProperty, canInsertProperty, parsePropsOf, setActiveProp } from "./properties";

// A command, so it sits ABOVE the block framework: it acts on the whole editor
// and asks the framework whether this editor renders blocks at all (live
// preview) or shows source. The Properties entry itself (`properties.ts`) sits
// below the framework — the framework's registry imports it — so it never
// imports `field.ts` (spec: module-graph / 运行时 import 不成环).

/**
 * The "add property" command (spec: Properties 块 / 添加属性命令): the + button's
 * row at the end of existing frontmatter, or a whole one-property block at the
 * top of a document that has none. Either way the new name is selected, ready to
 * be typed over — in the Properties block when it renders, in the text itself in
 * source mode. One dispatch = one undo unit.
 */
export function insertProperty(view: EditorView): void {
  const { state } = view;
  if (state.readOnly || !canInsertProperty(state)) return;
  const p = parsePropsOf(state);
  const rendersBlocks = !!state.field(blockDecorationField, false);
  if (p && rendersBlocks) return addProperty(view, p);
  const name = editorString("props.newName");
  const from = p ? p.closeFrom : 4;
  view.dispatch({
    changes: p ? { from, insert: `${name}: \n` } : { from: 0, insert: `---\n${name}: \n---\n\n` },
    effects: setActiveProp.of({ index: p ? p.props.length : 0, part: "key", caret: "all" }),
    // Source mode has no Properties block to edit in, so select the name itself.
    ...(rendersBlocks ? {} : { selection: { anchor: from, head: from + name.length } }),
    userEvent: "input",
    scrollIntoView: true,
  });
  view.focus();
}
