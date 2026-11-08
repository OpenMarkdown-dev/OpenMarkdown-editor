import { describe, expect, it } from "vitest";
import { EditorSelection, EditorState } from "@codemirror/state";
import { markdown } from "@codemirror/lang-markdown";
import { dialectBase, dialectExtensions } from "./dialectParser";
import { withCompleteTree } from "./syntax";
import { inlineToggle, type InlineKind } from "./commands";

/**
 * Spec: live-preview-editor / 行内标记切换按语法树去掉原有标记 (change: strike-marks).
 * `|` is the cursor, `«…»` the selection.
 */
function stateOf(marked: string): EditorState {
  let doc = marked;
  let anchor: number;
  let head: number;
  if (doc.includes("«")) {
    anchor = doc.indexOf("«");
    doc = doc.replace("«", "");
    head = doc.indexOf("»");
    doc = doc.replace("»", "");
  } else {
    anchor = head = doc.indexOf("|");
    if (anchor < 0) throw new Error("test doc needs | or «…»");
    doc = doc.replace("|", "");
  }
  return withCompleteTree(
    EditorState.create({
      doc,
      selection: EditorSelection.single(anchor, head),
      extensions: [markdown({ base: dialectBase, extensions: dialectExtensions })],
    }),
  );
}

/** Run the toggle; return the doc with the resulting selection marked the same way. */
function run(state: EditorState, kind: InlineKind): { text: string; state: EditorState } {
  const next = withCompleteTree(state.update(inlineToggle(state, kind)).state);
  const { from, to } = next.selection.main;
  const d = next.doc.toString();
  const text = from === to ? d.slice(0, from) + "|" + d.slice(from) : d.slice(0, from) + "«" + d.slice(from, to) + "»" + d.slice(to);
  return { text, state: next };
}
const toggle = (marked: string, kind: InlineKind) => run(stateOf(marked), kind).text;

describe("inlineToggle — removing reads the syntax tree", () => {
  it("removes the other bold spelling instead of wrapping it", () => {
    expect(toggle("__粗|粗__", "bold")).toBe("粗|粗");
  });

  it("removes the other italic spelling", () => {
    expect(toggle("_斜|斜_", "italic")).toBe("斜|斜");
  });

  it("removes strikethrough and keeps the text selected", () => {
    expect(toggle("~~«划掉»~~", "strike")).toBe("«划掉»");
  });

  it("removes when the selection includes the marks", () => {
    expect(toggle("«~~划掉~~»", "strike")).toBe("«划掉»");
  });

  it("removes the canonical spellings too", () => {
    expect(toggle("**粗|粗**", "bold")).toBe("粗|粗");
    expect(toggle("*斜|斜*", "italic")).toBe("斜|斜");
    expect(toggle("`码|码`", "code")).toBe("码|码");
    expect(toggle("``码|码``", "code")).toBe("码|码");
  });

  it("removes only the nearest layer of the same kind", () => {
    expect(toggle("***粗|斜***", "italic")).toBe("**粗|斜**");
    expect(toggle("***粗|斜***", "bold")).toBe("*粗|斜*");
  });

  it("leaves a different kind alone and wraps instead", () => {
    expect(toggle("*«斜»*", "bold")).toBe("***«斜»***");
  });

  it("a cursor just outside the marks is not inside the format", () => {
    expect(toggle("**粗**|", "bold")).toBe("**粗****|**");
  });
});

describe("inlineToggle — adding writes the canonical marker", () => {
  it.each([
    ["bold", "**字**"],
    ["italic", "*字*"],
    ["strike", "~~字~~"],
    ["code", "`字`"],
  ] as const)("%s wraps the selection", (kind, wrapped) => {
    const inner = wrapped.replace("字", "«字»");
    expect(toggle("«字»", kind)).toBe(inner);
  });

  it("an empty selection inserts a pair with the cursor inside", () => {
    expect(toggle("ab|cd", "bold")).toBe("ab**|**cd");
    expect(toggle("ab|cd", "strike")).toBe("ab~~|~~cd");
  });

  it.each(["bold", "italic", "strike", "code"] as const)("%s twice on an empty selection is a no-op", (kind) => {
    const once = run(stateOf("ab|cd"), kind).state;
    expect(run(once, kind).text).toBe("ab|cd");
  });

  it("italic inside an empty bold pair does not eat the bold marks", () => {
    expect(toggle("ab**|**cd", "italic")).toBe("ab***|***cd");
  });

  it("wraps each range of a multi-selection independently", () => {
    const state = withCompleteTree(
      EditorState.create({
        doc: "a b",
        selection: EditorSelection.create([EditorSelection.range(0, 1), EditorSelection.range(2, 3)]),
        extensions: [EditorState.allowMultipleSelections.of(true), markdown({ base: dialectBase, extensions: dialectExtensions })],
      }),
    );
    const next = state.update(inlineToggle(state, "strike")).state;
    expect(next.doc.toString()).toBe("~~a~~ ~~b~~");
  });
});
