import { describe, expect, it } from "vitest";
import { EditorState } from "@codemirror/state";
import { findHeading, headingAtPos, outlineOf } from "./outline";

const stateOf = (doc: string) => EditorState.create({ doc });
const texts = (doc: string) => outlineOf(stateOf(doc)).map((h) => h.text);

describe("outlineOf — the heading model, seen from the editor", () => {
  it("lists ATX headings with text, level, position and anchor", () => {
    const doc = "# 一\n\ntext\n\n## 二 2\n\n### Three ###\n";
    expect(outlineOf(stateOf(doc)).map(({ text, level, from, anchor }) => ({ text, level, from, anchor }))).toEqual([
      { text: "一", level: 1, from: 0, anchor: "一" },
      { text: "二 2", level: 2, from: doc.indexOf("## 二 2"), anchor: "一::二 2" },
      { text: "Three", level: 3, from: doc.indexOf("### Three"), anchor: "一::二 2::Three" },
    ]);
  });

  it("ignores setext headings, fences, quotes, lists and frontmatter", () => {
    const doc = "---\ntitle: x\n# 注释\n---\nTitle\n=====\n\n```\n# not a heading\n```\n\n> # 引用\n\n- # 列表\n\n## real\n";
    expect(texts(doc)).toEqual(["real"]);
  });

  it("returns empty for a document without headings", () => {
    expect(texts("plain text\n\nmore text")).toEqual([]);
  });

  it("is computed once per document version", () => {
    const state = stateOf("# a\n");
    expect(outlineOf(state)).toBe(outlineOf(state));
  });

  it("knows which section a position is in", () => {
    const doc = "intro\n\n# A\n\nbody\n\n## B\n\nmore\n";
    const s = stateOf(doc);
    expect(headingAtPos(s, 2)).toBeNull();
    expect(headingAtPos(s, doc.indexOf("body"))?.anchor).toBe("A");
    expect(headingAtPos(s, doc.indexOf("more"))?.anchor).toBe("A::B");
  });
});

describe("findHeading — navigation", () => {
  const doc = "## Requirements\n\n## 实现方案 A\n\n## 实现方案 B\n\n### requirements\n\n## 记录\n\n## 记录\n";
  const s = stateOf(doc);

  it("exact match wins over case-insensitive", () => {
    expect(findHeading(s, "requirements")?.from).toBe(doc.indexOf("### requirements"));
  });

  it("falls back to case-insensitive match", () => {
    expect(findHeading(s, "REQUIREMENTS")?.from).toBe(0);
  });

  it("never matches by prefix — the same rule read_section uses", () => {
    expect(findHeading(s, "requi")).toBeNull();
    expect(findHeading(s, "实现方案")).toBeNull();
  });

  it("several matches scroll to the first; `#k` picks one", () => {
    expect(findHeading(s, "记录")?.from).toBe(doc.indexOf("## 记录"));
    expect(findHeading(s, "记录#2")?.from).toBe(doc.lastIndexOf("## 记录"));
  });

  it("returns null on miss and on empty query", () => {
    expect(findHeading(s, "不存在的标题")).toBeNull();
    expect(findHeading(s, "")).toBeNull();
    expect(findHeading(s, "  ")).toBeNull();
  });
});
