import { describe, expect, it } from "vitest";
import { composeInset, insetVars, type Layer } from "./compose";
import { add, css, itemCheckbox, len, listBox, markerBox, FOLD_OFFSET, QUOTE_BAR, QUOTE_BOX, TASK_BOX, sub, type Len } from "./metrics";

/** Shorthand stacks. */
const quote: Layer = { kind: "quote" };
const note: Layer = { kind: "callout", type: "note" };
const code: Layer = { kind: "code" };
/** A bullet item; `task` makes it a task item in a task-bearing list. */
const bullet = (markerLine: boolean, task = false): Layer => ({
  kind: "list",
  box: listBox({ ordered: false, chars: 1, task }),
  markerLine,
  checkbox: itemCheckbox(task),
});
const ordered = (chars: number, markerLine: boolean): Layer => ({
  kind: "list",
  box: listBox({ ordered: true, chars, task: false }),
  markerLine,
  checkbox: itemCheckbox(false),
});

const same = (a: Len, b: Len) => expect(css(a)).toBe(css(b));

describe("composeInset — 一个循环,所有容器", () => {
  it("plain list: marker at the text column, content one marker box in", () => {
    const top = composeInset([bullet(true)]);
    expect(top.bars).toEqual([]);
    same(top.marker!.x, len());
    same(top.content, markerBox(1));
    same(top.marker!.width, markerBox(1));
    same(top.fold.x, sub(len(), FOLD_OFFSET));
    expect(top.fold.floor).toBeNull();
    expect(insetVars(top)).toEqual({
      "--om-inset": "2ch",
      "--om-mark-x": "0px",
      "--om-mark-w": "2ch",
      "--om-fold-x": "-1.4em",
    });
  });

  it("a child's marker starts exactly at its parent's content column", () => {
    const parent = composeInset([bullet(true)]);
    const child = composeInset([bullet(false), bullet(true)]);
    same(child.marker!.x, parent.content);
  });

  it("list in a quote (the user's `> - 第一项`): the marker starts after the bar and its gap", () => {
    const i = composeInset([quote, bullet(true)]);
    expect(i.bars.map((b) => css(b.x))).toEqual(["0px"]);
    same(i.marker!.x, QUOTE_BOX);
    same(i.content, add(QUOTE_BOX, markerBox(1)));
    // the toggle may not paint over the bar
    expect(insetVars(i)["--om-fold-x"]).toBe("max(calc(-0.4em + 3px), 3px)");
    expect(insetVars(i)["--om-inset-img"]).toBe("linear-gradient(var(--ome-border), var(--ome-border))");
  });

  it("quote in a list: the bar sits at the item's content column", () => {
    const first = composeInset([bullet(true), quote]); // `- > q`
    const cont = composeInset([bullet(false), quote]); // `  > q2`
    same(first.bars[0].x, markerBox(1));
    same(cont.bars[0].x, markerBox(1));
    same(first.content, cont.content);
    // the marker's box hangs over the quote opened on the same line
    same(first.marker!.width, first.content);
  });

  it("`>>`: one bar per level, each level one quote box further in", () => {
    const i = composeInset([quote, quote]);
    expect(i.bars.map((b) => css(b.x))).toEqual(["0px", css(QUOTE_BOX)]);
    same(i.content, add(QUOTE_BOX, QUOTE_BOX));
    same(i.fold.floor!, add(QUOTE_BOX, QUOTE_BAR));
    const v = insetVars(i);
    expect(v["--om-bar-0"]).toBe("0px");
    expect(v["--om-bar-1"]).toBe("calc(1em + 3px)");
    expect(v["--om-inset-pos"]).toBe("var(--om-bar-0) 0, var(--om-bar-1) 0");
  });

  it("callout with a list: a coloured bar and a tint from the callout's x, list inside", () => {
    const i = composeInset([note, bullet(true)]);
    expect(i.bars).toEqual([{ x: len(), color: "var(--ome-callout-note)" }]);
    expect(i.fills.map((f) => f.color)).toEqual(["color-mix(in oklab, var(--ome-callout-note) 7%, transparent)"]);
    same(i.marker!.x, QUOTE_BOX);
    const v = insetVars(i);
    // bar on top of the tint; the tint runs to the right edge
    expect(v["--om-inset-size"]).toBe("3px 100%, calc(100% - var(--om-fill-0)) 100%");
  });

  it("mixed bullet / number children of one parent start in the same column", () => {
    const b = composeInset([bullet(false), bullet(true)]);
    const n = composeInset([bullet(false), ordered(2, true)]);
    same(b.marker!.x, n.marker!.x);
    // and an ordered parent's children start at ITS content column
    same(composeInset([ordered(2, false), bullet(true)]).marker!.x, markerBox(2));
  });

  it("3-digit ordered list: one box for `1.` and `100.`, sized for the widest", () => {
    const one = composeInset([ordered(4, true)]);
    const hundred = composeInset([ordered(4, true)]);
    same(one.content, hundred.content);
    same(one.marker!.width, markerBox(4)); // "100." = 4 visible chars + the gap
    expect(insetVars(one)["--om-mark-w"]).toBe("5ch");
  });

  it("task item: the checkbox is inside its list's box; the marker element is the box minus the checkbox", () => {
    const box = listBox({ ordered: false, chars: 1, task: true });
    const i = composeInset([bullet(true, true)]);
    same(i.content, box);
    same(i.marker!.width, sub(box, TASK_BOX));
    expect(css(i.marker!.width)).toBe("0px"); // no bullet before the checkbox
    // its child starts at the list's content column — the same one a plain sibling's child starts at
    same(composeInset([bullet(false, true), bullet(true)]).marker!.x, i.content);
  });

  it("code inside a quoted list: the fill starts at the list's content column", () => {
    const i = composeInset([quote, bullet(false), code]);
    same(i.fills[0].x, add(QUOTE_BOX, markerBox(1)));
    expect(i.marker).toBeNull();
  });

  it("a line in no container composes to zero", () => {
    expect(insetVars(composeInset([]))).toEqual({ "--om-inset": "0px", "--om-fold-x": "-1.4em" });
  });
});

describe("listBox — one marker box per list (design D1)", () => {
  it("fits the widest marker plus one gap; a task-bearing list fits the checkbox too", () => {
    expect(css(listBox({ ordered: false, chars: 1, task: false }))).toBe("2ch");
    expect(css(listBox({ ordered: true, chars: 4, task: false }))).toBe("5ch");
    // a bullet task's checkbox takes the bullet's place: the box is the checkbox's
    same(listBox({ ordered: false, chars: 1, task: true }), TASK_BOX);
    same(listBox({ ordered: true, chars: 2, task: true }), add(markerBox(2), TASK_BOX));
  });
});

describe("metrics — 值都随字号缩放", () => {
  it("every distance is font-relative; only the bar stroke is absolute", () => {
    const stacks: Layer[][] = [[quote, bullet(false), ordered(3, true)], [note, bullet(true, true)], [bullet(false), quote, code]];
    for (const s of stacks) {
      const i = composeInset(s);
      // px only ever comes from bar strokes (3px per bar crossed)
      expect(i.content.px % 3).toBe(0);
      expect(i.content.em + i.content.ch).toBeGreaterThan(0);
    }
  });
});
