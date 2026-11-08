import { describe, expect, it } from "vitest";
import { CALLOUT_TYPES, parseCalloutType } from "./callout";
import { calloutInsertChange } from "./calloutInsert";

/**
 * Pure callout-skeleton insertion (change: callout-insert-command). Operates on
 * the doc source text + a caret offset, so it's unit-testable without a DOM
 * EditorView (see CLAUDE.md). Tests derive from the spec Scenarios, not the impl.
 * Block-isolation logic mirrors insertTableChange (tableEdit.ts).
 */

const apply = (doc: string, r: { from: number; to: number; insert: string }) =>
  doc.slice(0, r.from) + r.insert + doc.slice(r.to);

describe("calloutInsertChange — 五类型骨架 (change: callout-insert-command)", () => {
  it("each of the 5 types produces its UPPERCASE `> [!TYPE]` marker", () => {
    for (const type of CALLOUT_TYPES) {
      const r = calloutInsertChange("hello", 5, type);
      expect(r.insert).toContain(`> [!${type.toUpperCase()}]\n> `);
    }
  });

  it("inserted marker line is recognised by the callout parser as that type", () => {
    for (const type of CALLOUT_TYPES) {
      const out = apply("hello", calloutInsertChange("hello", 5, type));
      // The rendered layer strips `> ` from the first content line; emulate it.
      const firstLine = out.split("\n").find((l) => l.startsWith("> [!"))!;
      expect(parseCalloutType(firstLine.replace(/^>\s?/, ""))).toBe(type);
    }
  });
});

describe("calloutInsertChange — 落点 + 块隔离 (change: callout-insert-command)", () => {
  it("是纯插入:from === to === 落点", () => {
    const r = calloutInsertChange("hello", 5, "note");
    expect(r.from).toBe(r.to);
  });

  it("光标零宽,落在空正文行第二个 `> ` 之后", () => {
    const doc = "hello";
    const r = calloutInsertChange(doc, doc.length, "note");
    expect(r.head).toBe(r.anchor); // 零宽
    const out = apply(doc, r);
    // The caret sits at the very end of the `> [!NOTE]\n> ` skeleton — right
    // after the second `> `, in the empty body line, ready for typing.
    expect(out.slice(0, r.head)).toBe("hello\n\n> [!NOTE]\n> ");
    // Nothing between the caret and the trailing blank line but content-free.
    expect(out.slice(r.head)).toBe("\n");
  });

  it("在普通文本尾部插入,前后空行分隔", () => {
    const doc = "hello";
    const r = calloutInsertChange(doc, doc.length, "warning");
    expect(apply(doc, r)).toBe("hello\n\n> [!WARNING]\n> \n");
  });

  it("空文档:callout 落在文首,无多余前导空行", () => {
    const r = calloutInsertChange("", 0, "tip");
    expect(apply("", r)).toBe("> [!TIP]\n> \n");
  });

  it("文件末尾:锚定于文末,单个尾随换行终结正文行", () => {
    const doc = "a\n\nb";
    const r = calloutInsertChange(doc, doc.length, "important");
    expect(apply(doc, r)).toBe("a\n\nb\n\n> [!IMPORTANT]\n> \n");
  });

  it("段落中间:锚定到整段之后,段落逐字不变、不被拆断", () => {
    const doc = "line one\nline two\n\nnext para";
    const r = calloutInsertChange(doc, 3, "note"); // 光标在 "line one"
    expect(apply(doc, r)).toBe(
      "line one\nline two\n\n> [!NOTE]\n> \n\nnext para",
    );
  });

  it("光标所在行为空:原地插入,前后各一空行分隔(不重复)", () => {
    const doc = "hello\n\nworld";
    const r = calloutInsertChange(doc, 6, "caution"); // 光标在中间空行
    expect(apply(doc, r)).toBe("hello\n\n> [!CAUTION]\n> \n\nworld");
  });

  it("紧邻已有 callout:新块锚定于其后,既有 callout 逐字不变、空行隔离", () => {
    const existing = "> [!NOTE]\n> first";
    const doc = existing;
    const r = calloutInsertChange(doc, 3, "tip"); // 光标在既有 callout marker 内
    const out = apply(doc, r);
    expect(out.startsWith(existing)).toBe(true); // 既有 callout 逐字不变
    expect(out).toBe("> [!NOTE]\n> first\n\n> [!TIP]\n> \n");
  });
});
