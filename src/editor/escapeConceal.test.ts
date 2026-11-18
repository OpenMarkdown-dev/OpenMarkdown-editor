import { describe, expect, it } from "vitest";
import { highlightTree, tags } from "@lezer/highlight";
import type { EditorState } from "@codemirror/state";
import { LivePreviewPluginValue } from "./livePreview";
import { markdownHighlightStyle } from "./theme";
import { createEditorState } from "./base";
import { landingShownBy } from "./caret";
import { renderedTextForRange } from "./plainCopy";
import { treeUpTo, withCompleteTree } from "./syntax";

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

/**
 * What an escape looks like (0.2.1, Nextcloud's report: off the caret `\*not\*`
 * drew its `*` in a syntax colour, like markup). Every escaped punctuation is
 * text: the escaped character gets exactly what a plain letter beside it gets
 * from the editor's highlight style, and only the backslash is a mark — hidden
 * off the caret, painted as every revealed mark (`**`, `#`, `` ` ``) is under it.
 */
describe("an escaped character is text; only its backslash is a mark", () => {
  // The marks' own style (`*x*`'s `*` also carries the emphasis it sits in).
  const markClass = markdownHighlightStyle.style([tags.processingInstruction])!;
  const classesOf = (state: EditorState) => {
    const doc = state.doc.toString();
    const at: string[] = Array.from({ length: doc.length }, () => "");
    highlightTree(treeUpTo(state, doc.length), markdownHighlightStyle, (from, to, cls) => {
      for (let i = from; i < to; i++) at[i] = cls;
    });
    return at;
  };
  /** What the inline preview builds at `pos`: hidden (replaced) or the classes of the marks over it. */
  const previewAt = (state: EditorState, pos: number) => {
    const built = new LivePreviewPluginValue().compute(state, [{ from: 0, to: state.doc.length }]);
    let hidden = false;
    const classes: string[] = [];
    built.decorations.between(pos, pos + 1, (from, to, d) => {
      if (from > pos || to <= pos) return;
      if (d.point) hidden = true;
      else if (d.spec.class) classes.push(d.spec.class);
    });
    return { hidden, classes };
  };

  it("the marks have a style to compare against, the one `*x*`'s `*` carries", () => {
    const s = withCompleteTree(createEditorState({ doc: "a *x* b" }));
    expect(markClass).toBeTruthy();
    expect(classesOf(s)[2].split(" ")).toContain(markClass);
  });

  it.each(["\\*", "\\_", "\\[", "\\]", "\\`", "\\#", "\\\\", "\\$"])("%s: the escaped character is plain text; the backslash is hidden off the caret, a mark under it", (esc) => {
    const doc = `Prices are ${esc}not${esc} final\n\nother`;
    const away = withCompleteTree(createEditorState({ doc, selection: { anchor: doc.length } }));
    const cls = classesOf(away);
    const plain = cls[doc.indexOf("P")];
    for (const at of [doc.indexOf(esc), doc.lastIndexOf(esc)]) {
      expect(cls[at + 1], `the escaped ${esc[1]} at ${at + 1}`).toBe(plain);
      expect(previewAt(away, at + 1), `the escaped ${esc[1]} off the caret`).toEqual({ hidden: false, classes: [] });
      expect(previewAt(away, at).hidden, `the backslash at ${at} off the caret`).toBe(true);
      const under = withCompleteTree(createEditorState({ doc, selection: { anchor: at + 1 } }));
      expect(previewAt(under, at), `the backslash at ${at} under the caret`).toEqual({ hidden: false, classes: [markClass] });
      expect(previewAt(under, at + 1).classes, `the escaped ${esc[1]} under the caret`).toEqual([]);
    }
  });
});

describe("the escape grammar is CommonMark's", () => {
  const escapes = (doc: string) => {
    const s = withCompleteTree(createEditorState({ doc }));
    const out: string[] = [];
    treeUpTo(s, doc.length).iterate({ enter: (n) => void (n.name === "Escape" && out.push(doc.slice(n.from, n.to))) });
    return out;
  };
  it("a backslash before ASCII punctuation only; not before a letter, a space or the end", () => {
    expect(escapes("\\! \\~ \\{ \\a \\é \\ x \\")).toEqual(["\\!", "\\~", "\\{"]);
  });
});
