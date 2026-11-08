import { describe, expect, it } from "vitest";
import { EditorState } from "@codemirror/state";
import { history, undo } from "@codemirror/commands";
import {
  displayWidth,
  parseAligns,
  parseTable,
  serializeTable,
  tableDataFromParsed,
  tableCellNav,
  tableStructEdit,
  reflowChangeIfNeeded,
  insertTableChange,
  cellSourceRange,
  cellEditChange,
  cellDisplaySource,
  CELL_SYNC_USER_EVENT,
  tableGridNav,
  type TableData,
} from "./tableEdit";

/**
 * Pure table core (change: smart-table-editing). Operates on the table's source
 * text + its doc-from offset, so it's unit-testable without a DOM EditorView
 * (see CLAUDE.md). Tests are derived from the spec Scenarios, not the impl.
 */

describe("displayWidth — CJK/emoji aware column width (design R2)", () => {
  it("counts ASCII as width 1", () => {
    expect(displayWidth("abc")).toBe(3);
    expect(displayWidth("")).toBe(0);
  });
  it("counts CJK as width 2", () => {
    expect(displayWidth("张三")).toBe(4);
    expect(displayWidth("a张")).toBe(3);
  });
  it("counts fullwidth punctuation as width 2", () => {
    expect(displayWidth("，。")).toBe(4);
  });
});

describe("cellDisplaySource — GFM drops the cell escape before the inline parse (change: editor-cell-fixes)", () => {
  it("turns every \\| into |, code spans included, and maps offsets back to the source", () => {
    const src = "`a\\|b` x";
    const { text, at } = cellDisplaySource(src);
    expect(text).toBe("`a|b` x");
    expect(at).toHaveLength(text.length + 1);
    expect([...text].map((ch, i) => src[at[i]] === ch)).not.toContain(false);
    expect(at[text.length]).toBe(src.length);
  });

  it("leaves other backslashes alone (cmark-gfm: only a backslash right before | goes)", () => {
    expect(cellDisplaySource("a\\*b").text).toBe("a\\*b");
    expect(cellDisplaySource("a\\\\\\|b").text).toBe("a\\\\|b");
    expect(cellDisplaySource("").text).toBe("");
  });
});

describe("parseAligns — delimiter row markers", () => {
  it("maps :--- / :---: / ---: / --- to left/center/right/none", () => {
    expect(parseAligns("| :--- | :---: | ---: | --- |")).toEqual([
      "left",
      "center",
      "right",
      "none",
    ]);
  });
  it("tolerates missing outer pipes and stray spaces", () => {
    expect(parseAligns(":--- | ---:")).toEqual(["left", "right"]);
  });
});

describe("parseTable — locate rows, cells, offsets, aligns", () => {
  const src = ["| Name | Age |", "| --- | ---: |", "| 张三 | 28 |", "| Bob | 30 |"].join("\n");

  it("returns null for non-tables (no delimiter row)", () => {
    expect(parseTable("just text\nmore text", 0)).toBeNull();
  });

  it("parses header, aligns and body row counts", () => {
    const t = parseTable(src, 0)!;
    expect(t).not.toBeNull();
    expect(t.aligns).toEqual(["none", "right"]);
    expect(t.rows).toHaveLength(3); // header + 2 body (delimiter excluded from rows)
    expect(t.rows[0].cells.map((c) => c.text)).toEqual(["Name", "Age"]);
    expect(t.rows[2].cells.map((c) => c.text)).toEqual(["Bob", "30"]);
  });

  it("cell offsets slice back to the trimmed content", () => {
    const t = parseTable(src, 0)!;
    const cell = t.rows[1].cells[0]; // "张三" (rows: header, 张三, Bob)
    expect(src.slice(cell.from, cell.to)).toBe("张三");
  });

  it("offsets are shifted by tableFrom", () => {
    const t = parseTable(src, 100)!;
    const cell = t.rows[0].cells[0]; // "Name"
    expect(cell.from).toBe(100 + src.indexOf("Name"));
  });

  it("parses a pipe-less GFM table (no outer pipes)", () => {
    const t = parseTable("a | b\n--- | ---\nc | d", 0)!;
    expect(t.rows[0].cells.map((c) => c.text)).toEqual(["a", "b"]);
    expect(t.rows[1].cells.map((c) => c.text)).toEqual(["c", "d"]);
  });
});

describe("serializeTable — canonical aligned GFM (spec: 对齐标记驱动重排)", () => {
  it("pads columns to a common width and encodes alignment in the delimiter", () => {
    const data: TableData = {
      header: ["Name", "Age"],
      aligns: ["none", "right"],
      body: [["张三", "28"], ["Bob", "30"]],
    };
    // Name col width = max(displayWidth: Name=4, 张三=4, Bob=3) = 4
    // Age col width = max(Age=3, 28=2, 30=2, min 3) = 3 → right delimiter "--:"
    expect(serializeTable(data)).toBe(
      ["| Name | Age |", "| ---- | --: |", "| 张三 | 28  |", "| Bob  | 30  |"].join("\n"),
    );
  });

  it("is idempotent: serialize∘parse of a canonical table is a fixed point", () => {
    const canonical = ["| a   | b   |", "| --- | --- |", "| ccc | d   |"].join("\n");
    const parsed = parseTable(canonical, 0)!;
    expect(serializeTable(tableDataFromParsed(parsed))).toBe(canonical);
  });
});

// --- navigation (task 2.1) --------------------------------------------------

const NAV_SRC = ["| Name | Age |", "| --- | ---: |", "| 张三 | 28 |", "| Bob | 30 |"].join("\n");

describe("tableCellNav — Tab/Shift-Tab cell movement (spec: Tab 跨格与行末环绕)", () => {
  const cursorAt = (needle: string) => NAV_SRC.indexOf(needle);

  it("next moves to the following cell in the same row", () => {
    const r = tableCellNav(NAV_SRC, 0, cursorAt("Name"), "next")!;
    expect(r.kind).toBe("move");
    if (r.kind === "move") expect(NAV_SRC.slice(r.anchor, r.head)).toBe("Age");
  });

  it("next at row end wraps to the next row's first cell", () => {
    const r = tableCellNav(NAV_SRC, 0, cursorAt("张三"), "next")!;
    expect(r.kind).toBe("move");
    if (r.kind === "move") expect(NAV_SRC.slice(r.anchor, r.head)).toBe("28");
  });

  it("next at the very last cell appends a row and lands in its first cell", () => {
    const r = tableCellNav(NAV_SRC, 0, cursorAt("30"), "next")!;
    expect(r.kind).toBe("change");
    if (r.kind === "change") {
      const np = parseTable(r.insert, 0)!;
      expect(np.rows).toHaveLength(4); // header + 3 body
      expect(np.rows[3].cells.map((c) => c.text)).toEqual(["", ""]);
      expect(r.anchor).toBe(r.head); // empty new cell → collapsed cursor
    }
  });

  it("prev moves to the previous cell", () => {
    const r = tableCellNav(NAV_SRC, 0, cursorAt("Age"), "prev")!;
    expect(r.kind).toBe("move");
    if (r.kind === "move") expect(NAV_SRC.slice(r.anchor, r.head)).toBe("Name");
  });

  it("prev at the very first cell is a consumed no-op (spec: Shift-Tab 首格 no-op)", () => {
    const r = tableCellNav(NAV_SRC, 0, cursorAt("Name"), "prev")!;
    expect(r.kind).toBe("noop");
  });
});

// --- structural edits (task 2.2) --------------------------------------------

describe("tableStructEdit — insert/delete/move/align (spec: 插入行与列, 删除列的边界安全)", () => {
  const at = (needle: string) => NAV_SRC.indexOf(needle);

  it("insertRowBelow on the header adds an empty first body row", () => {
    const r = tableStructEdit(NAV_SRC, 0, at("Name"), "insertRowBelow")!;
    const np = parseTable(r.insert, 0)!;
    expect(np.rows).toHaveLength(4);
    expect(np.rows[1].cells.map((c) => c.text)).toEqual(["", ""]);
  });

  it("insertColRight adds an empty column and extends the delimiter", () => {
    const r = tableStructEdit(NAV_SRC, 0, at("Name"), "insertColRight")!;
    const np = parseTable(r.insert, 0)!;
    expect(np.rows[0].cells.map((c) => c.text)).toEqual(["Name", "", "Age"]);
    expect(np.aligns).toHaveLength(3);
  });

  it("deleteColumn removes the cursor's column", () => {
    const r = tableStructEdit(NAV_SRC, 0, at("Age"), "deleteColumn")!;
    const np = parseTable(r.insert, 0)!;
    expect(np.aligns).toEqual(["none"]);
    expect(np.rows[0].cells.map((c) => c.text)).toEqual(["Name"]);
  });

  it("deleteColumn of the last column removes the whole table (spec: 删除列的边界安全)", () => {
    const single = ["| a |", "| --- |", "| b |"].join("\n");
    const r = tableStructEdit(single, 0, single.indexOf("a"), "deleteColumn")!;
    expect(r.insert).toBe("");
  });

  it("toggleAlign cycles left→center→right→none", () => {
    // Age is currently right → cycles to none.
    const r = tableStructEdit(NAV_SRC, 0, at("30"), "toggleAlign")!;
    expect(parseTable(r.insert, 0)!.aligns[1]).toBe("none");
  });

  it("moveColRight swaps the cursor's column with its right neighbor", () => {
    const r = tableStructEdit(NAV_SRC, 0, at("Name"), "moveColRight")!;
    expect(parseTable(r.insert, 0)!.rows[0].cells.map((c) => c.text)).toEqual(["Age", "Name"]);
  });

  it("moveRowUp at the first body row is a no-op (can't cross the header)", () => {
    expect(tableStructEdit(NAV_SRC, 0, at("张三"), "moveRowUp")).toBeNull();
  });
});

// --- reflow (task 3, idempotent) --------------------------------------------

describe("reflowChangeIfNeeded — auto-align on leave (spec: 已对齐离开无改动)", () => {
  it("returns a change that canonicalizes a ragged table", () => {
    const ragged = ["|a|b|", "|-|-|", "|longcell|x|"].join("\n");
    const r = reflowChangeIfNeeded(ragged, 0)!;
    expect(r).not.toBeNull();
    expect(r.from).toBe(0);
    expect(r.to).toBe(ragged.length);
    // content preserved, now aligned
    const np = parseTable(r.insert, 0)!;
    expect(np.rows[1].cells.map((c) => c.text)).toEqual(["longcell", "x"]);
    expect(r.insert).toBe(serializeTable(tableDataFromParsed(parseTable(ragged, 0)!)));
  });

  it("returns null for an already-canonical table (idempotent, no empty change)", () => {
    const canonical = ["| a   | b   |", "| --- | --- |", "| ccc | d   |"].join("\n");
    expect(reflowChangeIfNeeded(canonical, 0)).toBeNull();
  });

  it("preserves alignment markers when reflowing", () => {
    const src = ["| a | b | c |", "| :--- | :---: | ---: |", "| 1 | 2 | 3 |"].join("\n");
    const r = reflowChangeIfNeeded(src, 0)!;
    expect(parseTable(r.insert, 0)!.aligns).toEqual(["left", "center", "right"]);
  });

  it("returns null for non-tables", () => {
    expect(reflowChangeIfNeeded("not a table\nat all", 0)).toBeNull();
  });
});

describe("insertTableChange — 空上下文建表 (change: table-insert-command)", () => {
  // Canonical 2-col seed: header + delimiter + one empty data row.
  const SKELETON = ["|     |     |", "| --- | --- |", "|     |     |"].join("\n");
  const apply = (doc: string, r: { from: number; to: number; insert: string }) =>
    doc.slice(0, r.from) + r.insert + doc.slice(r.to);

  it("在普通文本尾部插入最小合法 2 列 GFM 表,前后空行分隔", () => {
    const doc = "hello";
    const r = insertTableChange(doc, doc.length, null);
    expect(apply(doc, r)).toBe("hello\n\n" + SKELETON + "\n");
  });

  it("是纯插入:from === to === 落点", () => {
    const r = insertTableChange("hello", 5, null);
    expect(r.from).toBe(r.to);
  });

  it("光标零宽,落在首(表头)格内容起点", () => {
    const doc = "hello";
    const r = insertTableChange(doc, doc.length, null);
    expect(r.head).toBe(r.anchor); // 零宽
    const out = apply(doc, r);
    expect(r.head).toBe(out.indexOf("|") + 2); // "| " 之后 = 首格内容
  });

  it("空文档:表落在文首,无多余前导空行", () => {
    const r = insertTableChange("", 0, null);
    expect(apply("", r)).toBe(SKELETON + "\n");
  });

  it("段落中间:锚定到整段之后,段落不被拆断", () => {
    const doc = "line one\nline two\n\nnext para";
    const r = insertTableChange(doc, 3, null); // 光标在 "line one"
    expect(apply(doc, r)).toBe("line one\nline two\n\n" + SKELETON + "\n\nnext para");
  });

  it("光标在已有表内:新表锚定于该表之后,既有表逐字不变", () => {
    const existing = ["| a | b |", "| - | - |", "| 1 | 2 |"].join("\n");
    const doc = existing + "\ntail";
    const r = insertTableChange(doc, 5, { from: 0, to: existing.length });
    const out = apply(doc, r);
    expect(out.startsWith(existing)).toBe(true); // 既有表逐字不变
    expect(out).toBe(existing + "\n\n" + SKELETON + "\n\ntail");
  });

  it("seed 表已是规范形态:离表自动对齐为 no-op(幂等,不触发 autosave)", () => {
    expect(reflowChangeIfNeeded(SKELETON, 0)).toBeNull();
  });
});

// --- inline cell editing (change: table-inline-cell-editing) ------------------

describe("cellSourceRange / cellEditChange — single-cell sync (task 1.1)", () => {
  const P = parseTable(NAV_SRC, 0)!; // rows: 0=[Name,Age] 1=[张三,28] 2=[Bob,30]

  it("addresses a cell's trimmed content by grid (row, col)", () => {
    expect(NAV_SRC.slice(...rangeOf(cellSourceRange(P, 0, 1)!))).toBe("Age");
    expect(NAV_SRC.slice(...rangeOf(cellSourceRange(P, 1, 0)!))).toBe("张三");
  });

  it("returns null out of range", () => {
    expect(cellSourceRange(P, 9, 0)).toBeNull();
    expect(cellSourceRange(P, 0, 9)).toBeNull();
    expect(cellEditChange(P, 9, 0, "x")).toBeNull();
  });

  it("replaces one cell's content, leaving pipe/padding structure intact (no reflow)", () => {
    const ch = cellEditChange(P, 1, 0, "李四")!;
    const out = NAV_SRC.slice(0, ch.from) + ch.insert + NAV_SRC.slice(ch.to);
    expect(out).toBe(
      ["| Name | Age |", "| --- | ---: |", "| 李四 | 28 |", "| Bob | 30 |"].join("\n"),
    );
  });

  it("passes marked / escaped-pipe / <br> / code cell text through verbatim", () => {
    const src = ["| a | b |", "| - | - |", "| x | y |"].join("\n");
    const p = parseTable(src, 0)!;
    for (const text of ["**bold**", "a \\| b", "x<br>y", "`code`"]) {
      const ch = cellEditChange(p, 1, 0, text)!;
      expect(ch.insert).toBe(text); // verbatim — the cell's raw markdown is the user's own text
      const out = src.slice(0, ch.from) + ch.insert + src.slice(ch.to);
      expect(out).toBe(["| a | b |", "| - | - |", `| ${text} | y |`].join("\n"));
    }
  });

  // The in-place input re-derives this range on EVERY keystroke (change:
  // table-cell-edit-undo / design D3) — a cached offset goes stale the moment
  // anything else edits the doc and the next write runs past the cell's pipes.
  // Padding and empty cells are where an off-by-one shows up first.

  it("addresses only the trimmed content, never the surrounding padding", () => {
    const src = ["| a | b |", "| - | - |", "|    wide     | y |"].join("\n");
    const p = parseTable(src, 0)!;
    expect(src.slice(...rangeOf(cellSourceRange(p, 1, 0)!))).toBe("wide");
    const ch = cellEditChange(p, 1, 0, "W")!;
    const out = src.slice(0, ch.from) + ch.insert + src.slice(ch.to);
    expect(out).toBe(["| a | b |", "| - | - |", "|    W     | y |"].join("\n"));
  });

  it("addresses an empty cell as a zero-width point between its pipes", () => {
    const src = ["| a | b |", "| - | - |", "|  | y |"].join("\n");
    const p = parseTable(src, 0)!;
    const r = cellSourceRange(p, 1, 0)!;
    expect(r.to).toBe(r.from); // nothing to replace — an insertion point
    const ch = cellEditChange(p, 1, 0, "z")!;
    const out = src.slice(0, ch.from) + ch.insert + src.slice(ch.to);
    // Where inside the padding the point sits is not contracted (reflow on leave
    // normalises it); what MUST hold is that it stays INSIDE the pipes, so the row
    // still parses as the same two cells with the typed text in the first one.
    const reparsed = parseTable(out, 0)!;
    expect(reparsed.rows[1].cells.map((c) => c.text)).toEqual(["z", "y"]);
  });
});

describe("tableGridNav — in-place editor cell movement (task 1.2; spec: 单元格导航)", () => {
  const P = parseTable(NAV_SRC, 0)!; // rows: 0=[Name,Age] 1=[张三,28] 2=[Bob,30]

  it("next: within a row, then wrap to the next row's first cell", () => {
    expect(tableGridNav(P, 0, 0, "next")).toEqual({ kind: "move", row: 0, col: 1 });
    expect(tableGridNav(P, 0, 1, "next")).toEqual({ kind: "move", row: 1, col: 0 });
  });

  it("next at the very last cell appends a row and lands in its first cell", () => {
    const r = tableGridNav(P, 2, 1, "next");
    expect(r.kind).toBe("expand");
    if (r.kind === "expand") {
      expect({ row: r.row, col: r.col }).toEqual({ row: 3, col: 0 });
      expect(parseTable(r.change.insert, 0)!.rows).toHaveLength(4);
    }
  });

  it("prev: back a cell, wrap to previous row's last cell, no-op at the first cell", () => {
    expect(tableGridNav(P, 0, 1, "prev")).toEqual({ kind: "move", row: 0, col: 0 });
    expect(tableGridNav(P, 1, 0, "prev")).toEqual({ kind: "move", row: 0, col: 1 });
    expect(tableGridNav(P, 0, 0, "prev")).toEqual({ kind: "noop" });
  });

  it("down: same column, next row", () => {
    expect(tableGridNav(P, 0, 1, "down")).toEqual({ kind: "move", row: 1, col: 1 });
    expect(tableGridNav(P, 1, 0, "down")).toEqual({ kind: "move", row: 2, col: 0 });
  });

  it("down at the last row appends a row in the same column", () => {
    const r = tableGridNav(P, 2, 1, "down");
    expect(r.kind).toBe("expand");
    if (r.kind === "expand") expect({ row: r.row, col: r.col }).toEqual({ row: 3, col: 1 });
  });

  it("down clamps the column to a shorter (ragged) target row", () => {
    const ragged = parseTable(["| a | b | c |", "| - | - | - |", "| x |"].join("\n"), 0)!;
    expect(tableGridNav(ragged, 0, 2, "down")).toEqual({ kind: "move", row: 1, col: 0 });
  });
});

/** Tuple form of a {from,to} range for `slice(...)`. */
function rangeOf(r: { from: number; to: number }): [number, number] {
  return [r.from, r.to];
}

describe("CELL_SYNC_USER_EVENT — one input session is one undo unit (F2)", () => {
  /** How many `undo` presses it takes to walk back five same-spot inserts. */
  const undoPresses = (userEvent?: string): number => {
    let state = EditorState.create({ doc: "| 1 | 2 |", extensions: [history()] });
    const start = state.doc.toString();
    for (const ch of "hello") {
      state = state.update({
        changes: { from: 3, insert: ch },
        ...(userEvent ? { userEvent } : {}),
      }).state;
    }
    let presses = 0;
    while (state.doc.toString() !== start && presses < 12) {
      const before = state;
      undo({ state, dispatch: (tr) => void (state = tr.state) });
      presses++;
      if (state === before) break; // nothing left to undo — don't spin
    }
    return presses;
  };

  it("collapses a five-keystroke cell edit into a single undo", () => {
    // Asserted on the string too: an absent/renamed export would import as
    // `undefined`, which behaves exactly like "no userEvent" and would let the
    // press count pass while pinning nothing.
    expect(CELL_SYNC_USER_EVENT).toMatch(/^(input\.type|delete)($|\.)/);
    expect(undoPresses(CELL_SYNC_USER_EVENT)).toBe(1);
  });

  it("pins WHY: history only joins `input.type` / `delete` / no userEvent at all", () => {
    // The bug this change fixes: the sync used a bare "input", which
    // `joinableUserEvent = /^(input\.type|delete)($|\.)/` does not match — so it
    // joined with nothing and every keystroke became its own undo step. Note it is
    // WORSE than omitting the field, which is the trap that makes it easy to write.
    expect(undoPresses("input")).toBe(5);
    expect(undoPresses(undefined)).toBe(1);
  });
});
