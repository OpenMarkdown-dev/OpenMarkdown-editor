import { describe, expect, it } from "vitest";
import { Text } from "@codemirror/state";
import { crossedBlock, lineAfterBlock, nearestIndex } from "./geometry";
import type { BlockRange } from "./types";

const table: BlockRange = { id: "table", mode: "B", from: 10, to: 40 };
const math: BlockRange = { id: "block-math", mode: "A", from: 60, to: 70 };
const callout: BlockRange = { id: "callout", mode: "C", from: 80, to: 90 };

describe("crossedBlock", () => {
  it("finds the block a downward move jumps over", () => {
    expect(crossedBlock([table, math], 5, 45, true)).toBe(table);
  });
  it("finds the block an upward move jumps over", () => {
    expect(crossedBlock([table, math], 75, 50, false)).toBe(math);
  });
  it("picks the nearest of two crossed blocks", () => {
    expect(crossedBlock([math, table], 5, 75, true)).toBe(table);
    expect(crossedBlock([table, math], 75, 5, false)).toBe(math);
  });
  it("ignores a move that crosses nothing", () => {
    expect(crossedBlock([table], 45, 50, true)).toBeNull();
    expect(crossedBlock([table], 5, 8, true)).toBeNull();
  });
  it("never intercepts C blocks", () => {
    expect(crossedBlock([callout], 75, 95, true)).toBeNull();
  });
  it("treats a target exactly on the block edge as crossing (atomic boundary)", () => {
    expect(crossedBlock([table], 5, 10, true)).toBe(table);
    expect(crossedBlock([table], 45, 40, false)).toBe(table);
  });
});

describe("nearestIndex", () => {
  it("picks the closest centre", () => {
    expect(nearestIndex([10, 50, 90], 60, 3)).toBe(1);
    expect(nearestIndex([10, 50, 90], 200, 3)).toBe(2);
  });
  it("falls back to the first part without measurements", () => {
    expect(nearestIndex([], 60, 3)).toBe(0);
  });
  it("clamps to the part count", () => {
    expect(nearestIndex([10, 50, 90], 90, 2)).toBe(1);
  });
});

describe("lineAfterBlock", () => {
  const doc = Text.of(["| a |", "| - |", "| 1 |", "after"]);
  it("is the start of the line after the block", () => {
    expect(lineAfterBlock(doc, doc.line(3).to)).toBe(doc.line(4).from);
  });
  it("is the block's end when nothing follows it", () => {
    const last = Text.of(["| a |", "| - |"]);
    expect(lineAfterBlock(last, last.length)).toBe(last.length);
  });
});
