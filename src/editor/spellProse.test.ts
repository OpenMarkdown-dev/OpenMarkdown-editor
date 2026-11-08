import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { EditorState } from "@codemirror/state";
import { markdown } from "@codemirror/lang-markdown";
import { dialectBase, dialectExtensions } from "./dialectParser";
import { withCompleteTree } from "./syntax";
import { proseContextAt, proseUnits } from "./spellProse";

const FIXTURES = join(__dirname, "..", "..", "fixtures");

function stateOf(doc: string): EditorState {
  return withCompleteTree(
    EditorState.create({ doc, extensions: [markdown({ base: dialectBase, extensions: dialectExtensions })] }),
  );
}

/** Every word the checker would be shown, across all units. */
function wordsSent(state: EditorState): string[] {
  return proseUnits(state, 0, state.doc.length).flatMap((u) => u.text.match(/\p{L}+/gu) ?? []);
}

describe("spellProse — 只查正文(spec: spellcheck / 只查正文,判定只在一处)", () => {
  const fixture = stateOf(readFileSync(join(FIXTURES, "spellcheck", "spellcheck.md"), "utf8"));
  const sent = wordsSent(fixture);

  it("prose is sent: paragraphs, headings, emphasis, link text, list items, tasks, quotes", () => {
    for (const w of ["Spel", "chek", "sentense", "anothr", "linkk", "bolld", "itallic", "recieve", "wrng", "mistaek", "quoet", "HTML"])
      expect(sent, w).toContain(w);
  });

  it("non-prose is blanked: code, link targets, bare URLs, HTML attributes, math, frontmatter, tables, HTML blocks", () => {
    for (const w of ["codde", "wordz", "blok", "exampel", "pathh", "fooo", "htmll", "mathh", "drafft", "Wendsday", "Expected"])
      expect(sent, w).not.toContain(w);
  });

  it("a unit is the block's own text, same length, non-prose blanked to spaces", () => {
    const line = "Inline `codde wordz` here and a [linkk text](https://exampel.com/pathh) end.";
    const s = stateOf(line);
    const [u] = proseUnits(s, 0, s.doc.length);
    expect(u.from).toBe(0);
    expect(u.text.length).toBe(line.length);
    expect(u.text).toBe("Inline " + " ".repeat("`codde wordz`".length) + " here and a [linkk text](" + " ".repeat("https://exampel.com/pathh".length) + ") end.");
  });

  it("a soft-wrapped paragraph is one unit, line breaks kept", () => {
    const s = stateOf("first line with `cod`\nsecond line\n\nnext");
    const units = proseUnits(s, 0, s.doc.length);
    expect(units.map((u) => u.text)).toEqual(["first line with      \nsecond line", "next"]);
  });

  it("a block that only overlaps the range is included whole; letterless blocks are left out", () => {
    const s = stateOf("alpha beta gamma\n\n`only code`\n\n12 34\n\ndelta");
    expect(proseUnits(s, 3, 4).map((u) => u.text)).toEqual(["alpha beta gamma"]);
    expect(proseUnits(s, 0, s.doc.length).map((u) => u.text)).toEqual(["alpha beta gamma", "delta"]);
  });

  it("autolinks, e-mail, reference labels and definitions, titles, comments are blanked", () => {
    const s = stateOf('See <https://autolnk.com> mail@exampl.com [ref][labl] ![alt](x.png "titl") <!-- commentt -->\n\n[labl]: https://x.com "tit"');
    const words = wordsSent(s);
    for (const w of ["autolnk", "exampl", "labl", "titl", "commentt", "tit"]) expect(words, w).not.toContain(w);
    for (const w of ["See", "ref", "alt"]) expect(words, w).toContain(w);
  });

  it("nested editors ask their place in the outer document: a table is prose context, frontmatter is not", () => {
    const doc = fixture.doc.toString();
    expect(proseContextAt(fixture, doc.indexOf("| Wendsday"))).toBe(true);
    expect(proseContextAt(fixture, doc.indexOf("drafft"))).toBe(false);
    expect(proseContextAt(fixture, 0)).toBe(false);
    expect(proseContextAt(fixture, doc.indexOf("fenced codde"))).toBe(false);
    expect(proseContextAt(fixture, doc.indexOf("This sentense"))).toBe(true);
  });

  it("cost on fixtures/perf/long-document.md (design D11 ②)", () => {
    const s = stateOf(readFileSync(join(FIXTURES, "perf", "long-document.md"), "utf8"));
    const screen = s.doc.line(Math.min(s.doc.lines, 40)).to;
    let t = performance.now();
    const first = proseUnits(s, 0, screen);
    const screenMs = performance.now() - t;
    t = performance.now();
    const all = proseUnits(s, 0, s.doc.length);
    const wholeMs = performance.now() - t;
    console.log(
      `[spell perf] proseUnits: one screen (${first.length} units) ${screenMs.toFixed(2)} ms; whole document (${all.length} units, ${s.doc.length} chars) ${wholeMs.toFixed(1)} ms`,
    );
    expect(first.length).toBeGreaterThan(0);
  });
});
