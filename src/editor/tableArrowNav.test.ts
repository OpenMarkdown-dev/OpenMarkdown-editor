import { describe, expect, it } from "vitest";
import { flattenCellInsert, parseTable, tableArrowNav, tableCellInsert } from "./tableEdit";

// 3 rows (header + 2 body), 3 columns; the last body row is short (2 cells).
const p = parseTable(["| a | b | c |", "| - | - | - |", "| 1 | 2 | 3 |", "| x | y |"].join("\n"), 0)!;

describe("tableArrowNav", () => {
  it("↑ / ↓ keep the column", () => {
    expect(tableArrowNav(p, 1, 2, "up")).toEqual({ kind: "move", row: 0, col: 2 });
    expect(tableArrowNav(p, 0, 1, "down")).toEqual({ kind: "move", row: 1, col: 1 });
  });
  it("↓ into a shorter row clamps the column", () => {
    expect(tableArrowNav(p, 1, 2, "down")).toEqual({ kind: "move", row: 2, col: 1 });
  });
  it("↑ on the header and ↓ on the last row leave the table", () => {
    expect(tableArrowNav(p, 0, 0, "up")).toEqual({ kind: "exit", dir: "up" });
    expect(tableArrowNav(p, 2, 0, "down")).toEqual({ kind: "exit", dir: "down" });
  });
  it("← / → move along the row and wrap across rows", () => {
    expect(tableArrowNav(p, 1, 1, "left")).toEqual({ kind: "move", row: 1, col: 0 });
    expect(tableArrowNav(p, 1, 0, "left")).toEqual({ kind: "move", row: 0, col: 2 });
    expect(tableArrowNav(p, 0, 2, "right")).toEqual({ kind: "move", row: 1, col: 0 });
  });
  it("← at the first cell and → at the last cell stay put", () => {
    expect(tableArrowNav(p, 0, 0, "left")).toEqual({ kind: "noop" });
    expect(tableArrowNav(p, 2, 1, "right")).toEqual({ kind: "noop" });
  });
});

describe("flattenCellInsert", () => {
  it("turns LF and CRLF into spaces", () => {
    expect(flattenCellInsert("a\nb\r\nc")).toBe("a b c");
  });
  it("leaves single-line text alone", () => {
    expect(flattenCellInsert("plain **bold**")).toBe("plain **bold**");
  });
});

describe("tableCellInsert (what a GFM cell can hold)", () => {
  it("escapes a typed pipe so it stays inside the cell", () => {
    expect(tableCellInsert("|", "Type a word")).toBe("\\|");
    expect(tableCellInsert("a|b", "")).toBe("a\\|b");
  });
  it("leaves an already escaped pipe alone (the backslash may come before the insert)", () => {
    expect(tableCellInsert("|", "a\\")).toBe("|");
    expect(tableCellInsert("a\\|b", "")).toBe("a\\|b");
  });
  it("escapes a pipe after an escaped backslash", () => {
    expect(tableCellInsert("|", "a\\\\")).toBe("\\|");
  });
  it("flattens line breaks as before", () => {
    expect(tableCellInsert("a\nb|c", "")).toBe("a b\\|c");
  });
  it("round-trips through the table parser as one cell", () => {
    const cell = "x" + tableCellInsert("a|b", "x");
    const t = parseTable(`| h |\n| - |\n| ${cell} |`, 0)!;
    expect(t.rows[t.rows.length - 1].cells.length).toBe(1);
  });
});
