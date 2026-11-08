import { describe, expect, it } from "vitest";
import { tableClickAction, type TableClickInput } from "./tableClick";

/**
 * Click routing inside a rendered `TableWidget` (change: table-cell-link-navigation).
 *
 * The widget owns every event inside itself (`ignoreEvent() === true`), so the
 * editor's generic link handler never sees these clicks — the widget must decide
 * for itself. The decision is branch ORDER, and getting that order wrong is the
 * bug this change fixes: today the read-only early-return sits ABOVE any link
 * check, so a table link is unclickable in reading mode. Extracted as a pure
 * function because that ordering is the risky part and `EditorView` is not
 * constructible in node (no jsdom — see CLAUDE.md).
 *
 * Cases derive from the spec Scenarios under「表格渲染态单元格点击落格」.
 */

/** A click on ordinary text in cell (1,2) of an editable table, no modifier. */
const base: TableClickInput = {
  modifier: false,
  linkHref: null,
  inActiveInput: false,
  cell: { row: 1, col: 2 },
  readOnly: false,
};

const at = (patch: Partial<TableClickInput>): TableClickInput => ({ ...base, ...patch });

describe("tableClickAction", () => {
  describe("link navigation (the modifier exception)", () => {
    it("navigates on modifier+click over a link in live mode", () => {
      expect(at({ modifier: true, linkHref: "https://example.com" })).toBeDefined();
      expect(tableClickAction(at({ modifier: true, linkHref: "https://example.com" }))).toEqual({
        kind: "navigate",
        href: "https://example.com",
      });
    });

    it("navigates on modifier+click over a link in READING mode", () => {
      // The regression this change exists for: reading mode must not swallow it.
      expect(
        tableClickAction(at({ modifier: true, linkHref: "./other.md", readOnly: true })),
      ).toEqual({ kind: "navigate", href: "./other.md" });
    });

    it("navigates even when the click is not over any cell", () => {
      // A link can only render inside a cell, but the cell lookup must not gate
      // navigation — the link hit is the authority.
      expect(
        tableClickAction(at({ modifier: true, linkHref: "#总结", cell: null })),
      ).toEqual({ kind: "navigate", href: "#总结" });
    });

    it("does not navigate without the modifier", () => {
      // Plain click keeps "drop into this cell to edit" (design D1 gesture).
      expect(tableClickAction(at({ linkHref: "https://example.com" }))).toEqual({
        kind: "edit",
        row: 1,
        col: 2,
      });
    });

    it("does not navigate when the modifier misses the link", () => {
      expect(tableClickAction(at({ modifier: true, linkHref: null }))).toEqual({
        kind: "edit",
        row: 1,
        col: 2,
      });
    });
  });

  describe("reading mode follows a link on a plain click", () => {
    it("navigates on a plain click over a link", () => {
      expect(tableClickAction(at({ linkHref: "./other.md", readOnly: true }))).toEqual({
        kind: "navigate",
        href: "./other.md",
      });
    });

    it("live mode still enters the cell on a plain click over a link", () => {
      expect(tableClickAction(at({ linkHref: "./other.md" }))).toEqual({ kind: "edit", row: 1, col: 2 });
    });
  });

  describe("reading mode stays read-only", () => {
    it("ignores a plain click on a cell", () => {
      expect(tableClickAction(at({ readOnly: true }))).toEqual({ kind: "none" });
    });

    it("ignores modifier+click on ordinary cell text", () => {
      expect(tableClickAction(at({ modifier: true, readOnly: true }))).toEqual({ kind: "none" });
    });
  });

  describe("live mode cell editing", () => {
    it("enters the clicked cell", () => {
      expect(tableClickAction(at({ cell: { row: 0, col: 0 } }))).toEqual({
        kind: "edit",
        row: 0,
        col: 0,
      });
    });

    it("leaves the active cell input alone so it keeps its own caret", () => {
      expect(tableClickAction(at({ inActiveInput: true }))).toEqual({ kind: "none" });
    });

    it("ignores a click that hits no cell so native scrolling survives", () => {
      // Scrollbar / border / outer padding — must not preventDefault (spec: 宽表横向滚动).
      expect(tableClickAction(at({ cell: null }))).toEqual({ kind: "none" });
    });

    it("ignores modifier+click that hits neither a link nor a cell", () => {
      expect(tableClickAction(at({ modifier: true, cell: null }))).toEqual({ kind: "none" });
    });
  });

  describe("precedence", () => {
    it("prefers navigation over the active input", () => {
      // A link rendered in a sibling cell while another cell is mid-edit.
      expect(
        tableClickAction(
          at({ modifier: true, linkHref: "./a.md", inActiveInput: true }),
        ),
      ).toEqual({ kind: "navigate", href: "./a.md" });
    });

    it("treats an empty href as no link", () => {
      expect(tableClickAction(at({ modifier: true, linkHref: "" }))).toEqual({
        kind: "edit",
        row: 1,
        col: 2,
      });
    });
  });
});
