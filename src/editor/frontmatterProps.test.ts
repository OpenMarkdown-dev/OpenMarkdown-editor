import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseProps, readScalar, writeScalar, type QuoteStyle } from "./frontmatterProps";

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
    // Decoded: `\"` reads as `"` (design D3).
    expect([n.value, n.quote]).toEqual(['a "b"', '"']);
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

  it("reads quoted names, decoded", () => {
    const doc = fm('"key: x #[": "{oops: [1, \\""', "'it''s': v", '"a \\"b\\"": 1');
    const p = parseProps(doc)!;
    expect(p.props.map((x) => [x.key, x.keyQuote, x.value, x.editable])).toEqual([
      ["key: x #[", '"', '{oops: [1, "', true],
      ["it's", "'", "v", true],
      ['a "b"', '"', "1", true],
    ]);
    // The name's bytes sit between its quotes.
    expect(slice(doc, p.props[1].keyFrom, p.props[1].keyTo)).toBe("it''s");
  });

  it("a plain name holding ` #` is not a name: YAML reads a comment there", () => {
    expect(parseProps(fm("key- x #[: {oops: [1, \"  "))).toBeNull();
    expect(parseProps(fm("a #b: 1"))).toBeNull();
    expect(parseProps(fm("a#b: 1"))!.props[0].key).toBe("a#b");
  });

  it("a quoted value with an escape other than \\\" / \\\\ is read-only, shown as written", () => {
    const doc = fm('nl: "line\\nbreak"', 'tab: "a\\tb"', 'ok: "a\\\\b"');
    const [nl, tab, ok] = parseProps(doc)!.props;
    expect([nl.editable, nl.value]).toEqual([false, '"line\\nbreak"']);
    expect(slice(doc, nl.valueFrom, nl.valueTo)).toBe('"line\\nbreak"');
    expect(tab.editable).toBe(false);
    expect([ok.editable, ok.value]).toEqual([true, "a\\b"]);
  });
});

/**
 * The round-trip table (spec: frontmatter 的属性只有一个写法; design D7). Each row:
 * the text a user types → the exact YAML the writer writes for it as a NAME and
 * as a bare-started VALUE. Written by hand from YAML 1.2 (no YAML library, P3).
 * Every row must also read back as the same text — alone (`readScalar`) and as
 * a whole frontmatter (`parseProps`).
 */
const ROUND_TRIP: [text: string, key: string, value: string][] = [
  ["plain", "plain", "plain"],
  ["two words", "two words", "two words"],
  ["中文", "中文", "中文"],
  ["emoji 🎉", "emoji 🎉", "emoji 🎉"],
  ["a: b", '"a: b"', '"a: b"'],
  ["ends:", '"ends:"', '"ends:"'],
  ["a:b", '"a:b"', "a:b"],
  ["a #b", '"a #b"', '"a #b"'],
  ["a#b", '"a#b"', "a#b"],
  ["#tag", '"#tag"', '"#tag"'],
  ["- item", '"- item"', '"- item"'],
  ["-", '"-"', '"-"'],
  ["-dash", "-dash", "-dash"],
  ["?q", '"?q"', '"?q"'],
  [":x", '":x"', '":x"'],
  ["[a", '"[a"', '"[a"'],
  ["[a, b]", '"[a, b]"', "[a, b]"],
  ["[]", '"[]"', "[]"],
  ["[-x, y]", '"[-x, y]"', "[-x, y]"],
  // A bracketed value stays a bare list only when every item is a plain scalar.
  ["[*x]", '"[*x]"', '"[*x]"'],
  ["[@x]", '"[@x]"', '"[@x]"'],
  ["[`x`]", '"[`x`]"', '"[`x`]"'],
  ["[%x]", '"[%x]"', '"[%x]"'],
  ["[!x]", '"[!x]"', '"[!x]"'],
  ["[&a b]", '"[&a b]"', '"[&a b]"'],
  ["[|]", '"[|]"', '"[|]"'],
  ["[>x]", '"[>x]"', '"[>x]"'],
  ["[?x]", '"[?x]"', '"[?x]"'],
  ["[:x]", '"[:x]"', '"[:x]"'],
  ["[a,,b]", '"[a,,b]"', '"[a,,b]"'],
  ["[a, ]", '"[a, ]"', '"[a, ]"'],
  ["[a:]", '"[a:]"', '"[a:]"'],
  ["[-]", '"[-]"', '"[-]"'],
  ["[- a]", '"[- a]"', '"[- a]"'],
  ["{a: 1}", '"{a: 1}"', '"{a: 1}"'],
  ['{oops: [1, "', '"{oops: [1, \\""', '"{oops: [1, \\""'],
  ["key: x #[", '"key: x #["', '"key: x #["'],
  ["&anchor", '"&anchor"', '"&anchor"'],
  ["*alias", '"*alias"', '"*alias"'],
  ["!tag", '"!tag"', '"!tag"'],
  ["|block", '"|block"', '"|block"'],
  [">fold", '">fold"', '">fold"'],
  ["%pct", '"%pct"', '"%pct"'],
  ["@at", '"@at"', '"@at"'],
  ["`tick", '"`tick"', '"`tick"'],
  [",comma", '",comma"', '",comma"'],
  ['"abc', '"\\"abc"', '"\\"abc"'],
  ["'abc", '"\'abc"', '"\'abc"'],
  ['say "hi"', 'say "hi"', 'say "hi"'],
  ["it's", "it's", "it's"],
  ["back\\slash", "back\\slash", "back\\slash"],
  ['"\\', '"\\"\\\\"', '"\\"\\\\"'],
  [" lead", '" lead"', '" lead"'],
  ["trail ", '"trail "', '"trail "'],
  ["true", "true", "true"],
  ["42", "42", "42"],
  ["", '""', ""],
];

describe("writeScalar / readScalar: the round-trip table", () => {
  for (const [text, key, value] of ROUND_TRIP) {
    it(`${JSON.stringify(text)} → name ${key} · value ${value}`, () => {
      expect(writeScalar(text, "key", null)).toBe(key);
      expect(writeScalar(text, "value", null)).toBe(value);
      expect(readScalar(key)?.text).toBe(text);
      expect(readScalar(value)?.text).toBe(text);
    });
  }

  it("parseProps reads every row of the table back as the exact name and value", () => {
    const rows = ROUND_TRIP.filter(([t]) => t !== "");
    const doc = fm(...rows.map(([, key, value]) => (value === "" ? `${key}:` : `${key}: ${value}`)));
    const p = parseProps(doc);
    expect(p).not.toBeNull();
    expect(p!.props.map((x) => [x.key, x.value])).toEqual(rows.map(([t]) => [t, t]));
    expect(p!.props.every((x) => x.editable)).toBe(true);
  });

  it("a quote style given is kept, with its own escapes", () => {
    const cases: [string, QuoteStyle, string][] = [
      ["新标题", "'", "'新标题'"],
      ["it's", "'", "'it''s'"],
      ['say "hi"', '"', '"say \\"hi\\""'],
      ["plain", '"', '"plain"'],
      ["a: b", "'", "'a: b'"],
    ];
    for (const [text, style, written] of cases) {
      expect(writeScalar(text, "value", style)).toBe(written);
      expect(readScalar(written)).toEqual({ text, style });
    }
  });

  it("readScalar refuses what it cannot round-trip", () => {
    expect(readScalar('"line\\nbreak"')).toBeNull();
    expect(readScalar('"\\u00e9"')).toBeNull();
    expect(readScalar('"unterminated')).toBeNull();
    expect(readScalar("'a' b'")).toBeNull();
  });
});

describe("the Properties fixtures say what the parser does", () => {
  const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
  it("fixtures/properties/mixed.md: six editable rows, four read-only", () => {
    const p = parseProps(read("fixtures/properties/mixed.md"))!;
    expect(p.props.filter((x) => x.editable).map((x) => x.key)).toEqual(["title", "作者", "status", "note", "tags", "empty"]);
    expect(p.props.filter((x) => !x.editable).map((x) => x.key)).toEqual(["desc", "meta", "list", "ref"]);
  });
  it("fixtures/properties/write-back.md: plain and quoted values editable, the escaped one read-only", () => {
    const p = parseProps(read("fixtures/properties/write-back.md"))!;
    expect(p.props.map((x) => [x.key, x.value, x.editable])).toEqual([
      ["title", "写回样例", true],
      ["status", "draft", true],
      ["quoted", '已带 "双引号" 的值', true],
      ["escaped", '"第一行\\n第二行"', false],
    ]);
  });
  it("fixtures/properties/broken.md does not parse", () => {
    expect(parseProps(read("fixtures/properties/broken.md"))).toBeNull();
  });
});
