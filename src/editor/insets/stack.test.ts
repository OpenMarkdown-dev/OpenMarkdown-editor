import { describe, expect, it } from "vitest";
import { goldenState } from "../structure/golden";
import { calloutOf, lineContainers, newStackCache } from "./stack";
import type { Layer } from "./compose";
import { treeUpTo } from "../syntax";

function stacks(doc: string): Array<Layer[] | null> {
  const state = goldenState(doc + "‸");
  const cache = newStackCache();
  const out: Array<Layer[] | null> = [];
  for (let ln = 1; ln <= state.doc.lines; ln++) out.push(lineContainers(state, state.doc.line(ln), cache)?.layers ?? null);
  return out;
}

/** Compact form: q / c:<type> / b|n<chars>[*marker][+task] / code. */
const short = (s: Layer[] | null) =>
  s === null
    ? null
    : s
        .map((l) =>
          l.kind === "quote"
            ? "q"
            : l.kind === "callout"
              ? `c:${l.type}`
              : l.kind === "code"
                ? "code"
                : `${l.markerChars === 1 ? "b" : "n" + l.markerChars}${l.markerLine ? "*" : ""}${l.task ? "+" : ""}`,
        )
        .join(" ");

function leads(doc: string): Record<number, { lead: string[]; gap: string[] }> {
  const state = goldenState(doc + "‸");
  const cache = newStackCache();
  const out: Record<number, { lead: string[]; gap: string[] }> = {};
  for (let ln = 1; ln <= state.doc.lines; ln++) {
    const c = lineContainers(state, state.doc.line(ln), cache);
    if (c) out[ln] = { lead: c.lead.map(([a, b]) => state.sliceDoc(a, b)), gap: c.gap.map(([a, b]) => state.sliceDoc(a, b)) };
  }
  return out;
}

describe("lineContainers — 栈取自语法树(与结构键共用 linePrefix)", () => {
  it("plain nested list: one list layer per depth, marker on its own line only", () => {
    expect(stacks("- a\n    - b\n        - c").map(short)).toEqual(["b*", "b b*", "b b b*"]);
  });

  it("depth comes from structure, not from the number of spaces (2 vs 4 vs tab)", () => {
    expect(stacks("- a\n  - b").map(short)).toEqual(["b*", "b b*"]);
    expect(stacks("- a\n\t- b").map(short)).toEqual(["b*", "b b*"]);
    // too little indent to nest: still a sibling
    expect(stacks("1. a\n 1. b").map(short)).toEqual(["n2*", "n2*"]);
  });

  it("list in a quote, quote in a list, `>>`", () => {
    expect(stacks("> - 第一项\n> - 第二项").map(short)).toEqual(["q b*", "q b*"]);
    expect(stacks("- 项\n  > 引用").map(short)).toEqual(["b*", "b q"]);
    expect(stacks("> 一层\n> > 二层").map(short)).toEqual(["q", "q q"]);
  });

  it("a callout, with its type, holding a list", () => {
    expect(stacks("> [!NOTE]\n> - a\n>   - b").map(short)).toEqual(["c:note", "c:note b*", "c:note b b*"]);
    // a callout nested in a list is the same reading
    expect(stacks("- x\n  > [!TIP]\n  > 正文").map(short)).toEqual(["b*", "b c:tip", "b c:tip"]);
  });

  it("an ordered list is sized for its widest marker", () => {
    const doc = Array.from({ length: 100 }, (_, i) => `${i + 1}. x`).join("\n");
    const s = stacks(doc).map(short);
    expect(s[0]).toBe("n4*");
    expect(s[99]).toBe("n4*");
    expect(stacks("1. a\n2. b").map(short)).toEqual(["n2*", "n2*"]);
  });

  it("task items are marked", () => {
    expect(stacks("- [ ] a\n- [x] b\n- c").map(short)).toEqual(["b*+", "b*+", "b*"]);
  });

  it("code lines, including a blank one, carry their containers plus a code layer", () => {
    expect(stacks("```\nx\n\ny\n```").map(short)).toEqual(["code", "code", "code", "code", "code"]);
    expect(stacks("- a\n\n  ```\n  x\n\n  ```").map(short)).toEqual(["b*", null, "b code", "b code", "b code", "b code"]);
    expect(stacks("> ```\n> x\n> ```").map(short)).toEqual(["q code", "q code", "q code"]);
  });

  it("a lazy continuation stays in its quote", () => {
    expect(stacks("> a\nb").map(short)).toEqual(["q", "q"]);
  });

  it("lines outside containers have no stack", () => {
    expect(stacks("# t\n\npara").map(short)).toEqual([null, null, null]);
  });
});

describe("lineContainers — 源码缩进零宽(lead / gap)", () => {
  it("marker line: leading indent and marker→content gap, marker itself excluded", () => {
    expect(leads("- a\n    - bravo")[2]).toEqual({ lead: ["    "], gap: [" "] });
    expect(leads("-   spaced")[1]).toEqual({ lead: [], gap: ["   "] });
    expect(leads("- a\n\t- b")[2]).toEqual({ lead: ["\t"], gap: [" "] });
  });

  it("continuation line: the container indent up to the content column", () => {
    expect(leads("- a\n\t- b\n\t  more")[3].lead.join("")).toBe("\t  ");
    // a space past the content column is the reader's, so it stays
    expect(leads("- a\n   more")[2].lead).toEqual(["  "]);
  });

  it("inside a quote, only the list's indent — never the `>` itself", () => {
    expect(leads("> - a\n>   - b")[2]).toEqual({ lead: ["  "], gap: [" "] });
    expect(leads("> - a\n>   more")[2]).toEqual({ lead: ["  "], gap: [] });
  });

  it("a code line in a list hides the container indent but keeps the code's own", () => {
    expect(leads("- a\n\n  ```\n    x\n  ```")[4]).toEqual({ lead: ["  "], gap: [] });
  });
});

describe("calloutOf — 与渲染头部共用", () => {
  it("finds the type and the `[!` offset after this quote's own `>`", () => {
    const state = goldenState("- x\n  > [!WARNING]\n  > body‸");
    let quote: import("@lezer/common").SyntaxNode | null = null;
    treeUpTo(state, state.doc.length).iterate({ enter: (n) => { if (n.name === "Blockquote") quote = n.node; } });
    const c = calloutOf(state, quote!);
    expect(c?.type).toBe("warning");
    expect(state.sliceDoc(c!.from, c!.from + 2)).toBe("[!");
  });

  it("carries the suffix and ends the marker after it (change: callout-suffix)", () => {
    const state = goldenState("- x\n  > [!note]-\n  > body‸");
    let quote: import("@lezer/common").SyntaxNode | null = null;
    treeUpTo(state, state.doc.length).iterate({ enter: (n) => { if (n.name === "Blockquote") quote = n.node; } });
    const c = calloutOf(state, quote!);
    expect(c?.suffix).toBe("-");
    expect(state.sliceDoc(c!.from, c!.markerTo)).toBe("[!note]-");
    const plain = goldenState("> [!tip]\n> b‸");
    let q: import("@lezer/common").SyntaxNode | null = null;
    treeUpTo(plain, plain.doc.length).iterate({ enter: (n) => { if (n.name === "Blockquote") q = n.node; } });
    const p = calloutOf(plain, q!);
    expect(p?.suffix).toBeNull();
    expect(plain.sliceDoc(p!.from, p!.markerTo)).toBe("[!tip]");
  });

  it("is null for a plain quote and for `[!X]` behind an inner container", () => {
    const plain = goldenState("> [!FOOBAR]‸");
    let q: import("@lezer/common").SyntaxNode | null = null;
    treeUpTo(plain, plain.doc.length).iterate({ enter: (n) => { if (n.name === "Blockquote") q = n.node; } });
    expect(calloutOf(plain, q!)).toBeNull();
  });
});
