import { describe, expect, it } from "vitest";
import {
  frontmatterChipSummary,
  frontmatterEntries,
  hasLeadingFrontmatter,
  nextEditorMode,
  skillFrontmatterSkeleton,
} from "./skill";

const SKILL_DOC = `---
name: pdf-processing
description: Use when the user needs to extract text or fill forms in PDF files
---

# Body
`;

describe("nextEditorMode (spec: 编辑器三种模式)", () => {
  it("every file cycles the same three modes", () => {
    expect(nextEditorMode("live")).toBe("source");
    expect(nextEditorMode("source")).toBe("reading");
    expect(nextEditorMode("reading")).toBe("live");
  });
});

describe("frontmatterEntries", () => {
  it("returns ordered key/value pairs, quotes stripped", () => {
    const doc = `---\ntitle: "My Note"\ntags: a, b\n---\n`;
    expect(frontmatterEntries(doc)).toEqual([
      { key: "title", value: "My Note" },
      { key: "tags", value: "a, b" },
    ]);
  });
  it("no frontmatter → empty", () => {
    expect(frontmatterEntries("plain")).toEqual([]);
  });
  it("value-less key keeps an empty value", () => {
    expect(frontmatterEntries("---\ndraft:\n---\n")).toEqual([{ key: "draft", value: "" }]);
  });
  // The Properties block's own reading (change: missing-gates): what it shows
  // is what this returns.
  it("keeps a Chinese property name", () => {
    expect(frontmatterEntries("---\n作者: 张三\n---\n")).toEqual([{ key: "作者", value: "张三" }]);
  });
  it("leaves a trailing comment out of the value", () => {
    expect(frontmatterEntries("---\nstatus: draft # 注释\n---\n")).toEqual([{ key: "status", value: "draft" }]);
  });
  it("unparseable frontmatter (shown as source) has no entries", () => {
    expect(frontmatterEntries("---\ntitle: 正常\n- 顶层直接写了一个列表项\n---\n")).toEqual([]);
  });
});

describe("frontmatterChipSummary (feature 3)", () => {
  it("shows key: value pairs joined by ·", () => {
    const doc = `---\ntitle: My Note\ndate: 2026-08-03\n---\n`;
    expect(frontmatterChipSummary(doc)).toBe("title: My Note · date: 2026-08-03");
  });
  it("value-less key shows the key alone", () => {
    expect(frontmatterChipSummary("---\ntitle: My Note\ndraft:\n---\n")).toBe(
      "title: My Note · draft",
    );
  });
  it("truncates long values", () => {
    const long = "x".repeat(100);
    const out = frontmatterChipSummary(`---\nnote: ${long}\n---\n`, 10);
    expect(out).toBe("note: xxxxxxxxx…");
  });
  it("empty frontmatter → fallback label", () => {
    expect(frontmatterChipSummary("---\n---\n")).toBe("frontmatter");
    expect(frontmatterChipSummary("no fm")).toBe("frontmatter");
  });
});

describe("hasLeadingFrontmatter", () => {
  it("detects a leading --- fence", () => {
    expect(hasLeadingFrontmatter(SKILL_DOC)).toBe(true);
    expect(hasLeadingFrontmatter("---\nname: x\n---\n")).toBe(true);
    // A leading `---` that does not open YAML (or never closes) is a thematic
    // break, not frontmatter — the one frontmatter rule (change: heading-model).
    expect(hasLeadingFrontmatter("---\nfoo\n")).toBe(false);
    expect(hasLeadingFrontmatter("---\nname: x\n")).toBe(false);
  });
  it("false without one", () => {
    expect(hasLeadingFrontmatter("# heading\n")).toBe(false);
    expect(hasLeadingFrontmatter("text --- more")).toBe(false);
    expect(hasLeadingFrontmatter("")).toBe(false);
  });
});

describe("skillFrontmatterSkeleton", () => {
  it("is a name/description block with caret after `name: `", () => {
    const { text, caret } = skillFrontmatterSkeleton();
    expect(text.startsWith("---\nname: ")).toBe(true);
    expect(text).toContain("description: ");
    expect(text.trimEnd().endsWith("---")).toBe(true);
    expect(text.slice(0, caret)).toBe("---\nname: ");
  });
});
