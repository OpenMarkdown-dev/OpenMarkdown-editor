import { describe, expect, it } from "vitest";
import { EditorSelection, EditorState } from "@codemirror/state";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { mathMarkdown } from "./math";
import { frontmatterMarkdown } from "./frontmatterParse";
import { renderedTextForRange, selectionCopyText } from "./plainCopy";
import { withCompleteTree } from "./syntax";
import { displayWidth } from "./tableEdit";

/**
 * Reading-mode copy produces the RENDERED text, not the markdown source
 * (change: reading-mode-plain-copy). The derivation is a pure function over
 * (state, range) precisely so it can be tested here — and so it stays correct
 * beyond the rendered viewport, which a DOM-selection shortcut would not
 * (CodeMirror only renders `visibleRanges`, so a long document would silently
 * copy short). `EditorState` is constructible in node; `EditorView` is not.
 *
 * Parser config mirrors `index.ts` so InlineMath / BlockMath / frontmatter
 * produce the same nodes the renderer sees.
 */
function stateOf(doc: string) {
  return withCompleteTree(
    EditorState.create({
      doc,
      extensions: [
        markdown({ base: markdownLanguage, extensions: [mathMarkdown, frontmatterMarkdown] }),
      ],
    }),
  );
}

/** Rendered text of the whole document. */
function rendered(doc: string): string {
  const state = stateOf(doc);
  return renderedTextForRange(state, 0, state.doc.length).text;
}

describe("renderedTextForRange", () => {
  describe("inline formatting marks are gone", () => {
    it("drops bold, italic and code marks", () => {
      expect(rendered("这是 **粗体** 与 *斜体* 与 `代码`")).toBe("这是 粗体 与 斜体 与 代码");
    });

    it("drops strikethrough marks", () => {
      expect(rendered("~~划掉~~ 保留")).toBe("划掉 保留");
    });

    it("drops nested marks", () => {
      expect(rendered("**粗里带 `码`**")).toBe("粗里带 码");
    });
  });

  describe("block marks are gone", () => {
    it("drops the heading marker and its space", () => {
      expect(rendered("## 小节")).toBe("小节");
    });

    it("drops the quote marker and its space", () => {
      expect(rendered("> 引用一句")).toBe("引用一句");
    });

    it("renders a horizontal rule as an empty line", () => {
      expect(rendered("上\n\n---\n\n下")).toBe("上\n\n\n\n下");
    });
  });

  describe("links keep only what you can see", () => {
    it("keeps the label and drops brackets plus URL", () => {
      expect(rendered("见 [文档](https://openmarkdown.dev)")).toBe("见 文档");
    });

    it("keeps the label of a relative link", () => {
      expect(rendered("[邻居](./other.md)")).toBe("邻居");
    });

    it("falls back to the rendered short label for an empty-label link", () => {
      // Matches what `LinkLabelWidget` shows (spec: 空文本链接不渲染为空白).
      expect(rendered("[](https://example.com/docs/guide)")).toBe("example.com/docs/…");
    });
  });

  describe("lists follow what is on screen", () => {
    it("replaces an unordered marker with the visible bullet", () => {
      expect(rendered("- 一\n- 二")).toBe("• 一\n• 二");
    });

    it("keeps ordered numbers, which the renderer does not hide", () => {
      expect(rendered("1. 一\n2. 二")).toBe("1. 一\n2. 二");
    });

    it("renders task markers as visible check glyphs", () => {
      expect(rendered("- [ ] 待办\n- [x] 完成")).toBe("• ☐ 待办\n• ☑ 完成");
    });
  });

  describe("widgets get their visible stand-in", () => {
    it("renders an image as its alt text", () => {
      expect(rendered("![示意图](./square.png)")).toBe("示意图");
    });

    it("renders an image with no alt as nothing", () => {
      expect(rendered("![](./square.png)")).toBe("");
    });

    it("renders a sized image as its alt without the size (spec: 图片的 alt 只有一个读法)", () => {
      expect(rendered("![截图|300](a.png)")).toBe("截图");
      expect(rendered("![截图|300x200](a.png)")).toBe("截图");
    });

    it("keeps a wrong size in the alt — it is not a size", () => {
      expect(rendered("![截图|300px](a.png)")).toBe("截图|300px");
    });

    it("reads an alt holding brackets whole", () => {
      expect(rendered("![a [b] c](p.png)")).toBe("a [b] c");
    });

    it("renders inline math as its TeX body", () => {
      expect(rendered("质能 $E=mc^2$ 方程")).toBe("质能 E=mc^2 方程");
    });

    it("renders a callout marker as its visible title", () => {
      expect(rendered("> [!NOTE]\n> 正文一句")).toBe("Note\n正文一句");
    });

    it("drops a callout's fold suffix with its marker, nested ones too (change: callout-suffix)", () => {
      expect(rendered("> [!note]-\n> 正文一句")).toBe("Note\n正文一句");
      expect(rendered("> [!tip]+\n> 正文一句")).toBe("Tip\n正文一句");
      expect(rendered("- 项\n  > [!warning]\n  > 正文")).toContain("Warning");
      // Not a callout (suffix not glued): no title stand-in.
      expect(rendered("> [!note] -\n> 正文")).not.toMatch(/^Note/);
    });

    // Frontmatter copies as the Properties block shows it (change: missing-gates;
    // spec: frontmatter 的属性只有一个读法): its rows, Chinese names included,
    // trailing comments not — and as YAML source when it shows as source.
    it("renders a Properties block as its rows on one line", () => {
      const doc = "---\n# 注释行\ntitle: '旧标题'\n作者: 张三\nstatus: draft # 行尾注释\n---\n\n正文";
      expect(rendered(doc)).toBe("title: 旧标题 · 作者: 张三 · status: draft\n\n正文");
    });

    it("renders unparseable frontmatter as its source", () => {
      const yaml = "---\ntitle: 正常\n- 顶层直接写了一个列表项\n---";
      expect(rendered(`${yaml}\n\n正文`)).toBe(`${yaml}\n\n正文`);
    });
  });

  describe("tables: cell markup stripped, pipe structure kept", () => {
    // REGRESSION GUARD: cell inline markup has ALWAYS been stripped (lezer parses
    // inline markup inside TableCell, and the walk descends into it) — the spec's
    // old "tables keep their GFM source" exception described behaviour that never
    // existed. Lock it down so the new Table branch can't quietly lose it.
    it("strips inline markup inside cells", () => {
      const out = rendered("| a | b |\n| --- | --- |\n| **粗** | `码` |");
      expect(out).not.toContain("**");
      expect(out).not.toContain("`");
      expect(out).toContain("粗");
      expect(out).toContain("码");
    });

    it("keeps pipes and the delimiter row", () => {
      const out = rendered("| a | b |\n| --- | --- |\n| 1 | 2 |");
      expect(out.split("\n")).toHaveLength(3);
      for (const line of out.split("\n")) expect(line.startsWith("|")).toBe(true);
      expect(out.split("\n")[1]).toMatch(/^[|\s:-]+$/);
    });

    it("re-aligns columns to the STRIPPED text, not the source width", () => {
      // The bug this fixes: widths were laid out for `**销售额**`, so dropping the
      // marks left that cell short and the whole table ragged.
      const doc = [
        "| 名称       | 说明                       |",
        "| ---------- | -------------------------- |",
        "| **销售额** | [文档](https://a.dev) 很长 |",
        "| 普通       | 文本                       |",
      ].join("\n");
      const lines = rendered(doc).split("\n");
      expect(lines).toHaveLength(4);
      // Every row's pipes sit at the same display columns → the table is aligned.
      const pipeCols = (line: string) => {
        const cols: number[] = [];
        let w = 0;
        for (const ch of line) {
          if (ch === "|") cols.push(w);
          w += displayWidth(ch);
        }
        return cols;
      };
      const first = pipeCols(lines[0]);
      for (const line of lines) expect(pipeCols(line)).toEqual(first);
      expect(rendered(doc)).not.toContain("**");
      expect(rendered(doc)).not.toContain("](");
    });

    it("keeps per-column alignment colons", () => {
      const doc = "| a | b | c |\n| :-- | :-: | --: |\n| 1 | 2 | 3 |";
      const delim = rendered(doc).split("\n")[1];
      expect(delim).toMatch(/\|\s:-+\s\|\s:-+:\s\|\s-+:\s\|/);
    });

    it("degrades to per-node stripping when the selection covers only part of the table", () => {
      // Half a table has no correct re-flow (no header → no column widths), so the
      // Table branch stands down: marks still go, widths are left alone, and —
      // the load-bearing part — rows OUTSIDE the selection must not appear.
      const doc = "| a | b |\n| --- | --- |\n| **粗** | 二 |\n| 三 | 四 |";
      const state = stateOf(doc);
      const third = state.doc.line(3);
      const out = renderedTextForRange(state, third.from, third.to).text;
      expect(out).toBe("| 粗 | 二 |");
      expect(out).not.toContain("**");
      expect(out).not.toContain("a");
      expect(out).not.toContain("三");
    });

    it("degrades when the table source is malformed (no delimiter row)", () => {
      // `parseTable` returns null → no re-flow, but nothing is lost either.
      const doc = "| a | b |\n| **粗** | 二 |";
      const out = rendered(doc);
      expect(out).toContain("粗");
      expect(out).not.toContain("**");
    });
  });

  describe("completeness beyond the rendered viewport", () => {
    it("covers the whole range of a document far longer than any viewport", () => {
      const body = Array.from({ length: 400 }, (_, i) => `## 第 ${i} 节\n\n**正文** ${i}\n`).join(
        "\n",
      );
      const out = rendered(body);
      expect(out).toContain("第 0 节");
      expect(out).toContain("第 399 节");
      expect(out).not.toContain("**");
      expect(out).not.toContain("## ");
    });
  });

  describe("ranges", () => {
    it("returns nothing for an empty range", () => {
      const state = stateOf("**粗体**");
      expect(renderedTextForRange(state, 3, 3).text).toBe("");
    });

    it("renders only the selected slice", () => {
      const doc = "第一行 **粗**\n第二行 *斜*";
      const state = stateOf(doc);
      const secondLine = state.doc.line(2);
      expect(renderedTextForRange(state, secondLine.from, secondLine.to).text).toBe("第二行 斜");
    });

    it("drops the visible part of a marker the selection only half covers", () => {
      // Selection starts inside `**` — the marker is concealed either way, so no
      // stray asterisk may leak into the clipboard.
      const doc = "**粗体**";
      const state = stateOf(doc);
      expect(renderedTextForRange(state, 1, doc.length).text).toBe("粗体");
    });
  });
});

describe("selectionCopyText", () => {
  const withSelection = (doc: string, anchor: number, head: number) =>
    stateOf(doc).update({ selection: { anchor, head } }).state;

  it("gives the rendered text for the plain flavor", () => {
    const state = withSelection("这是 **粗体**", 0, 9);
    expect(selectionCopyText(state, "plain")?.text).toBe("这是 粗体");
  });

  it("gives the verbatim source slice for the markdown flavor", () => {
    const doc = "这是 **粗体**";
    const state = withSelection(doc, 0, doc.length);
    expect(selectionCopyText(state, "markdown")?.text).toBe(doc);
  });

  it("returns null for an empty selection so the clipboard is left alone", () => {
    // Not "" — blanking someone's clipboard because they pressed the shortcut
    // with no selection would be worse than doing nothing (spec: 空选区复制为无操作).
    const state = withSelection("**粗体**", 3, 3);
    expect(selectionCopyText(state, "plain")).toBeNull();
    expect(selectionCopyText(state, "markdown")).toBeNull();
  });

  it("joins multiple ranges with newlines, like CodeMirror's own copy", () => {
    // The app does not enable `allowMultipleSelections` today, so this path is
    // unreachable in product — it is here so that turning the facet on later
    // cannot silently make ⌘⇧C disagree with Cmd+C about multi-range copy.
    const doc = "**一**\n**二**";
    const base = withCompleteTree(
      EditorState.create({
        doc,
        extensions: [
          markdown({ base: markdownLanguage, extensions: [mathMarkdown, frontmatterMarkdown] }),
          EditorState.allowMultipleSelections.of(true),
        ],
      }),
    );
    const state = base.update({
      selection: EditorSelection.create([
        EditorSelection.range(0, 5),
        EditorSelection.range(6, 11),
      ]),
    }).state;
    expect(selectionCopyText(state, "plain")?.text).toBe("一\n二");
  });
});
