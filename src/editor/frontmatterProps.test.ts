import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { finalizeValue, needsQuotes, parseProps } from "./frontmatterProps";

const fm = (...lines: string[]) => ["---", ...lines, "---", "", "body"].join("\n");
const slice = (doc: string, a: number, b: number) => doc.slice(a, b);

describe("parseProps", () => {
  it("returns null without frontmatter", () => {
    expect(parseProps("# just a doc")).toBeNull();
    expect(parseProps("---\nno close")).toBeNull();
  });

  it("places names and values exactly", () => {
    const doc = fm("title: 方言样例", "tags: [dialect, fixture]");
    const p = parseProps(doc)!;
    expect(p.props.map((x) => [x.key, x.value, x.editable])).toEqual([
      ["title", "方言样例", true],
      ["tags", "[dialect, fixture]", true],
    ]);
    for (const x of p.props) {
      expect(slice(doc, x.keyFrom, x.keyTo)).toBe(x.key);
      expect(slice(doc, x.valueFrom, x.valueTo)).toBe(x.value);
    }
    expect(slice(doc, p.closeFrom, p.to)).toBe("---");
  });

  it("puts a quoted value's range between its quotes and remembers the style", () => {
    const doc = fm("title: '旧标题'", 'note: "a \\"b\\""');
    const [t, n] = parseProps(doc)!.props;
    expect([t.value, t.quote]).toEqual(["旧标题", "'"]);
    expect(slice(doc, t.valueFrom - 1, t.valueTo + 1)).toBe("'旧标题'");
    expect([n.value, n.quote]).toEqual(['a \\"b\\"', '"']);
  });

  it("excludes a trailing comment from a plain value", () => {
    const doc = fm("status: draft # 待定");
    const [s] = parseProps(doc)!.props;
    expect(s.value).toBe("draft");
    expect(slice(doc, s.valueFrom, s.valueTo)).toBe("draft");
  });

  it("skips blank and comment lines without failing", () => {
    const doc = fm("# 作者填写", "", "title: x");
    expect(parseProps(doc)!.props.map((x) => x.key)).toEqual(["title"]);
  });

  it("marks block scalars, nested maps, block lists, anchors read-only", () => {
    const doc = fm("desc: |", "  line one", "  line two", "meta:", "  a: 1", "list:", "  - a", "ref: &x 1", "flow: {a: 1}");
    const p = parseProps(doc)!;
    expect(p.props.map((x) => [x.key, x.editable])).toEqual([
      ["desc", false],
      ["meta", false],
      ["list", false],
      ["ref", false],
      ["flow", false],
    ]);
    // A read-only property still owns all its lines (delete removes them all).
    expect(slice(doc, p.props[0].linesFrom, p.props[0].linesTo)).toBe("desc: |\n  line one\n  line two");
  });

  it("an empty value is editable and sits at the line end", () => {
    const doc = fm("name:", "description: x");
    const [n] = parseProps(doc)!.props;
    expect([n.value, n.editable]).toEqual(["", true]);
    expect(n.valueFrom).toBe(n.linesTo);
  });

  it("accepts names YAML allows: Chinese, spaces, dots", () => {
    const p = parseProps(fm("作者: 张三", "my key: v", "a.b: 1"))!;
    expect(p.props.map((x) => [x.key, x.value])).toEqual([
      ["作者", "张三"],
      ["my key", "v"],
      ["a.b", "1"],
    ]);
  });

  it("fails on a shape it cannot place", () => {
    expect(parseProps(fm("  indented: first"))).toBeNull(); // continuation of nothing
    expect(parseProps(fm("not a property"))).toBeNull();
    expect(parseProps(fm("- a top-level list item"))).toBeNull();
    expect(parseProps(fm("t: 'unterminated"))).toBeNull();
  });
});

describe("finalizeValue / needsQuotes", () => {
  it("leaves a plain value plain when it reads back the same", () => {
    expect(finalizeValue("新标题", null)).toBe("新标题");
    expect(finalizeValue("[a, b]", null)).toBe("[a, b]");
  });
  it("quotes only the value that would change meaning (spec scenario)", () => {
    expect(finalizeValue("draft: 待审", null)).toBe('"draft: 待审"');
    expect(needsQuotes("#tag")).toBe(true);
    expect(needsQuotes("a #b")).toBe(true);
    expect(needsQuotes("- item")).toBe(true);
  });
  it("keeps the original quote style, escaping only what was typed", () => {
    expect(finalizeValue("新标题", "'")).toBe("'新标题'");
    expect(finalizeValue("it's", "'")).toBe("'it''s'");
    expect(finalizeValue("it''s", "'")).toBe("'it''s'");
    expect(finalizeValue('say "hi"', '"')).toBe('"say \\"hi\\""');
    expect(finalizeValue("line\\nbreak", '"')).toBe('"line\\nbreak"');
  });
});

describe("the Properties fixtures say what the parser does", () => {
  const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
  it("fixtures/properties/mixed.md: six editable rows, four read-only", () => {
    const p = parseProps(read("fixtures/properties/mixed.md"))!;
    expect(p.props.filter((x) => x.editable).map((x) => x.key)).toEqual(["title", "作者", "status", "note", "tags", "empty"]);
    expect(p.props.filter((x) => !x.editable).map((x) => x.key)).toEqual(["desc", "meta", "list", "ref"]);
  });
  it("fixtures/properties/broken.md does not parse", () => {
    expect(parseProps(read("fixtures/properties/broken.md"))).toBeNull();
  });
});
