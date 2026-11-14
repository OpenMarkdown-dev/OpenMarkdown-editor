import { describe, expect, it } from "vitest";
import { goldenState } from "../structure/golden";
import { calloutOf, lineContainers, newStackCache } from "./stack";
import type { Layer } from "./compose";
import { treeUpTo } from "../syntax";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { composeInset } from "./compose";
import { TASK_BOX, add, css, listBox, sub, type Len } from "./metrics";

function stacks(doc: string): Array<Layer[] | null> {
  const state = goldenState(doc + "‸");
  const cache = newStackCache();
  const out: Array<Layer[] | null> = [];
  for (let ln = 1; ln <= state.doc.lines; ln++) out.push(lineContainers(state, state.doc.line(ln), cache)?.layers ?? null);
  return out;
}

/** Compact form: q / c:<type> / b|n<chars>|t[*marker][+task] / code (b = 2ch box, n<k> = (k+1)ch, t = task-bearing). */
const boxName = (box: Len) => {
  const c = css(box);
  if (c === "2ch") return "b";
  const m = /^(\d+)ch$/.exec(c);
  return m ? `n${Number(m[1]) - 1}` : "t";
};
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
                : `${boxName(l.box)}${l.markerLine ? "*" : ""}${css(l.checkbox) !== "0px" ? "+" : ""}`,
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
    // and the list they are in is sized for the checkbox, plain sibling included
    expect(stacks("- [ ] a\n- [x] b\n- c").map(short)).toEqual(["t*+", "t*+", "t*"]);
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

/**
 * The gate for one marker-box rule (change: demo-phone-and-list-indent, design
 * D1/D2). Real documents through the stack reader and the composer, one row per
 * list kind, each nested two levels:
 *   (a) a child's marker starts exactly at its parent's content column;
 *   (b) a parent's content column = its marker's x + its list's box;
 *   (c) every item of one list shares one content column (a task and a plain
 *       sibling included), so their children line up too;
 *   (d) the box is the one `listBox` gives for that list — no per-item term.
 */
describe("one marker box per list — every list kind (gate)", () => {
  const hundred = Array.from({ length: 100 }, (_, i) => {
    const n = i + 1;
    const item = `${n}. x${n}`;
    return [1, 10, 100].includes(n) ? `${item}\n${" ".repeat(`${n}. `.length)}- child` : item;
  }).join("\n");
  const kinds: Array<{ name: string; doc: string; box: Len; tasks: number[] }> = [
    { name: "bullet", doc: "- a\n  - b\n- c\n  - d", box: listBox({ ordered: false, chars: 1, task: false }), tasks: [] },
    { name: "ordered 1. / 10. / 100.", doc: hundred, box: listBox({ ordered: true, chars: 4, task: false }), tasks: [] },
    { name: "bullet task", doc: "- [ ] a\n  - b\n- [x] c\n  - d", box: listBox({ ordered: false, chars: 1, task: true }), tasks: [1, 3] },
    { name: "ordered task", doc: "1. [ ] a\n   - b\n2. [x] c\n   - d", box: listBox({ ordered: true, chars: 2, task: true }), tasks: [1, 3] },
    {
      name: "mixed task + plain (the demo's 'Lists fold too')",
      doc: "- [x] done\n- [ ] todo\n  - c1\n  - c2\n- 普通\n  - c3\n  - c4",
      box: listBox({ ordered: false, chars: 1, task: true }),
      tasks: [1, 2],
    },
  ];

  for (const k of kinds) {
    it(k.name, () => {
      const state = goldenState(k.doc + "‸");
      const cache = newStackCache();
      let parent: { content: Len; box: Len } | null = null;
      const tops: Len[] = [];
      for (let ln = 1; ln <= state.doc.lines; ln++) {
        const c = lineContainers(state, state.doc.line(ln), cache)!;
        const inset = composeInset(c.layers);
        const top = c.layers[0];
        if (top.kind !== "list") throw new Error("expected a list layer");
        // (d) the list's box, not a per-item one
        expect(css(top.box)).toBe(css(k.box));
        if (c.layers.length === 1) {
          // (b) content = marker.x + the list's box
          expect(css(inset.content)).toBe(css(add(inset.marker!.x, top.box)));
          // a task line's marker element is the box minus the checkbox
          if (k.tasks.includes(ln)) expect(css(inset.marker!.width)).toBe(css(sub(top.box, TASK_BOX)));
          else expect(css(inset.marker!.width)).toBe(css(top.box));
          parent = { content: inset.content, box: top.box };
          tops.push(inset.content);
        } else {
          // (a) the child's marker starts at its parent's content column
          expect(css(inset.marker!.x)).toBe(css(parent!.content));
        }
      }
      // (c) one content column per list
      expect(new Set(tops.map(css)).size).toBe(1);
    });
  }

  it("a list with no task keeps the bullet box (spec: 全是普通项的列表不变宽)", () => {
    expect(css(listBox({ ordered: false, chars: 1, task: false }))).toBe("2ch");
  });

  it("compose.ts has no task term (it does not import TASK_BOX)", () => {
    const src = readFileSync(fileURLToPath(new URL("./compose.ts", import.meta.url)), "utf8");
    expect(src).not.toMatch(/\bTASK_BOX\b/);
  });
});
