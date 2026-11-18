import { describe, expect, it } from "vitest";
import { createEditorState } from "./base";
import { landingShownBy } from "./caret";
import { renderedTextForRange } from "./plainCopy";
import { withCompleteTree } from "./syntax";

/**
 * A backslash escape's backslash is markup (change: editor-dialect, #27; spec:
 * live-preview-editor / 转义反斜杠随标记规则隐藏): hidden while the selection does
 * not touch the escape, always in reading mode, kept in the source. The hide is
 * read off the decorations the inline preview builds (`landingShownBy`): the
 * same selection over the backslash is "plain" in live mode (touched, so not
 * hidden — like `**` under the caret) and "marked" in reading mode (hidden, its
 * stand-in marked as the landing).
 */
const DOC = "say \\*not emphasis\\* here";
const BACKSLASH = DOC.indexOf("\\");

function stateOf(mode: "live" | "reading", anchor: number, head = anchor) {
  return withCompleteTree(createEditorState({ doc: DOC, mode, selection: { anchor, head } }));
}

describe("escape backslashes follow the markup-hiding rules", () => {
  it("live: a selection touching the escape shows its backslash", () => {
    expect(landingShownBy(stateOf("live", BACKSLASH, BACKSLASH + 1))).toBe("plain");
  });

  it("reading: the backslash stays hidden under a selection, its escape marked", () => {
    expect(landingShownBy(stateOf("reading", BACKSLASH, BACKSLASH + 1))).toBe("marked");
  });

  it("plain copy reads what reading mode shows; the source keeps the backslashes", () => {
    const s = stateOf("reading", 0);
    expect(renderedTextForRange(s, 0, s.doc.length).text).toBe("say *not emphasis* here");
    expect(s.doc.toString()).toBe(DOC);
  });
});
