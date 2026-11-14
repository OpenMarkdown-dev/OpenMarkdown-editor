import { beforeEach, describe, expect, it } from "vitest";
import { ChangeSet } from "@codemirror/state";
import {
  PendingWidget,
  SIZE_MEMORY_LIMIT,
  blockSizeKey,
  carriedAt,
  forgetSizes,
  mapBlockStart,
  mapCarried,
  isPlainClick,
  pressOnScrollbar,
  rememberSize,
  rememberedSize,
  reserveStyle,
  reservedSize,
} from "./pending";

/**
 * The one placeholder's size order (spec: block-editing / 块在渲染前占住它的位置;
 * change: render-placeholder-size, design D3): stated → remembered → carried →
 * minimum.
 */
describe("reservedSize — the one size order", () => {
  beforeEach(() => forgetSizes());

  it("stated beats remembered beats carried beats minimum", () => {
    rememberSize("k", { height: 200 });
    const all = { stated: { width: 480, height: 332 }, key: "k", carried: { height: 150 }, minHeight: "2em" };
    expect(reservedSize(all)).toEqual({ origin: "stated", size: { width: 480, height: 332 } });
    expect(reservedSize({ ...all, stated: null })).toEqual({ origin: "remembered", size: { height: 200 } });
    expect(reservedSize({ ...all, stated: null, key: "other" })).toEqual({ origin: "carried", size: { height: 150 } });
    expect(reservedSize({ key: "other", minHeight: "2em" })).toEqual({ origin: "minimum", minHeight: "2em" });
  });

  it("the minimum defaults to one text line", () => {
    expect(reservedSize({})).toEqual({ origin: "minimum", minHeight: "1lh" });
  });

  it("a known size reserves its exact height; the minimum is a floor", () => {
    expect(reserveStyle({ origin: "remembered", size: { height: 212.4 } })).toEqual({ height: "212.4px" });
    expect(reserveStyle({ origin: "minimum", minHeight: "6em" })).toEqual({ minHeight: "6em" });
  });
});

describe("the size memory — bounded, in memory, shared", () => {
  beforeEach(() => forgetSizes());

  it("keeps at most SIZE_MEMORY_LIMIT sizes, dropping the least recently used", () => {
    for (let i = 0; i < SIZE_MEMORY_LIMIT; i++) rememberSize(`k${i}`, { height: i + 1 });
    // Touch the oldest so it is no longer the least recently used.
    expect(rememberedSize("k0")).toEqual({ height: 1 });
    rememberSize("new", { height: 1 });
    expect(rememberedSize("k0")).toEqual({ height: 1 });
    expect(rememberedSize("k1")).toBeUndefined();
    expect(rememberedSize("new")).toEqual({ height: 1 });
  });

  it("an unmeasured (0 px) size is not remembered", () => {
    rememberSize("zero", { height: 0 });
    expect(rememberedSize("zero")).toBeUndefined();
  });

  it("a block's key is entry + scheme + source", () => {
    expect(blockSizeKey("mermaid", "light", "a")).not.toBe(blockSizeKey("mermaid", "dark", "a"));
    expect(blockSizeKey("mermaid", "light", "a")).not.toBe(blockSizeKey("block-math", "light", "a"));
    expect(blockSizeKey("mermaid", "light", "a")).toBe(blockSizeKey("mermaid", "light", "a"));
  });
});

describe("the carried size — an edited block keeps its last drawn height", () => {
  it("is found by the block's start, mapped through an edit inside and before the block", () => {
    const carried = [{ from: 10, height: 300 }];
    // Typing inside the block (after its start) leaves the start put.
    const inside = ChangeSet.of([{ from: 14, insert: "xyz" }], 40);
    expect(mapCarried(carried, inside)).toEqual([{ from: 10, height: 300 }]);
    // Enter (or a block pasted) at the block's own start pushes the block
    // down: the height follows it, not the inserted text.
    const atStart = ChangeSet.of([{ from: 10, insert: "\n" }], 40);
    expect(mapCarried(carried, atStart)).toEqual([{ from: 11, height: 300 }]);
    expect(mapBlockStart(10, atStart)).toBe(11);
    // Text added above moves it down.
    const above = ChangeSet.of([{ from: 0, insert: "12345" }], 40);
    const moved = mapCarried(carried, above);
    expect(moved).toEqual([{ from: 15, height: 300 }]);
    expect(carriedAt(moved, 15)).toEqual({ height: 300 });
    expect(carriedAt(moved, 10)).toBeNull();
  });

  it("is dropped when the block's start is deleted", () => {
    const gone = ChangeSet.of([{ from: 5, to: 20 }], 40);
    expect(mapCarried([{ from: 10, height: 300 }], gone)).toEqual([]);
    expect(mapBlockStart(10, gone)).toBeNull();
  });
});

describe("PendingWidget equality — a rebuild with the same answer keeps the DOM", () => {
  const min = { origin: "minimum", minHeight: "1lh" } as const;
  it("equal on flow, start, size and content key; unequal otherwise", () => {
    const a = new PendingWidget("block", 3, min);
    expect(a.eq(new PendingWidget("block", 3, min))).toBe(true);
    expect(a.eq(new PendingWidget("block", 4, min))).toBe(false);
    expect(a.eq(new PendingWidget("inline", 3, min))).toBe(false);
    expect(a.eq(new PendingWidget("block", 3, { origin: "remembered", size: { height: 9 } }))).toBe(false);
    const build = () => ({}) as HTMLElement;
    expect(new PendingWidget("block", 3, min, { key: "x", build }).eq(new PendingWidget("block", 3, min, { key: "x", build }))).toBe(true);
    expect(new PendingWidget("block", 3, min, { key: "x", build }).eq(new PendingWidget("block", 3, min, { key: "y", build }))).toBe(false);
    expect(new PendingWidget("inline", 3, min, undefined, "$x$").eq(new PendingWidget("inline", 3, min, undefined, "$y$"))).toBe(false);
  });

  it("estimates its height from a known size, else leaves it to CodeMirror", () => {
    expect(new PendingWidget("block", 0, { origin: "carried", size: { height: 120 } }).estimatedHeight).toBe(120);
    expect(new PendingWidget("block", 0, min).estimatedHeight).toBe(-1);
  });
});

describe("pressOnScrollbar — a press on a scrolling box's bar does not reveal (change: mermaid-large-diagrams, D5)", () => {
  // A 656×300 box with a 1 px border and a 15 px horizontal scrollbar at the bottom.
  const el = { clientLeft: 1, clientTop: 1, clientWidth: 654, clientHeight: 283 };
  it("inside the client box: a press on the diagram", () => {
    expect(pressOnScrollbar({ x: 300, y: 150 }, el)).toBe(false);
    expect(pressOnScrollbar({ x: 1, y: 1 }, el)).toBe(false);
  });
  it("below the client box (the bar) or on the border: not a press on the diagram", () => {
    expect(pressOnScrollbar({ x: 300, y: 292 }, el)).toBe(true);
    expect(pressOnScrollbar({ x: 0.5, y: 150 }, el)).toBe(true);
    expect(pressOnScrollbar({ x: 656, y: 150 }, el)).toBe(true);
  });
});

describe("isPlainClick — a scrolling box reveals only on a click, not a drag or a scroll (D5 fallback)", () => {
  it("still: a click; moved or scrolled: not", () => {
    const down = { x: 100, y: 50, scrollLeft: 0 };
    expect(isPlainClick(down, { x: 102, y: 51, scrollLeft: 0 })).toBe(true);
    expect(isPlainClick(down, { x: 300, y: 50, scrollLeft: 0 })).toBe(false);
    expect(isPlainClick(down, { x: 100, y: 50, scrollLeft: 240 })).toBe(false);
  });
});
