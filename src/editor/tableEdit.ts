/**
 * Pure table core (change: smart-table-editing).
 *
 * Everything here is a pure function over the table's **source text** + its
 * document-from offset — no `EditorState`, no DOM. That keeps it unit-testable in
 * node (an `EditorView` can't be constructed there; see CLAUDE.md) and matches
 * the 文本流派 discipline: all edits rewrite the raw `.md` pipe text and produce
 * canonical GFM. Locating the enclosing `Table` node (via the lezer tree) and
 * dispatching transactions live in the thin wiring layer (`tableCommands.ts`).
 */

export type Align = "left" | "center" | "right" | "none";

/** Minimum dash count for a delimiter cell (GFM needs ≥1; tools use ≥3). */
const MIN_COL_WIDTH = 3;

// --- display width (design R2) ---------------------------------------------

/**
 * Rendered column width of a string: CJK / fullwidth / most emoji count as 2,
 * everything else as 1. An approximation (combining marks and ZWJ sequences are
 * not special-cased) but enough to align mixed CJK/ASCII tables.
 */
export function displayWidth(s: string): number {
  let w = 0;
  for (const ch of s) w += isWide(ch.codePointAt(0)!) ? 2 : 1;
  return w;
}

function isWide(cp: number): boolean {
  return (
    (cp >= 0x1100 && cp <= 0x115f) || // Hangul Jamo
    (cp >= 0x2e80 && cp <= 0x303e) || // CJK radicals … symbols
    (cp >= 0x3041 && cp <= 0x33ff) || // Hiragana … CJK compat
    (cp >= 0x3400 && cp <= 0x4dbf) || // CJK ext A
    (cp >= 0x4e00 && cp <= 0x9fff) || // CJK unified
    (cp >= 0xa000 && cp <= 0xa4cf) || // Yi
    (cp >= 0xac00 && cp <= 0xd7a3) || // Hangul syllables
    (cp >= 0xf900 && cp <= 0xfaff) || // CJK compat ideographs
    (cp >= 0xfe30 && cp <= 0xfe4f) || // CJK compat forms
    (cp >= 0xff00 && cp <= 0xff60) || // Fullwidth forms
    (cp >= 0xffe0 && cp <= 0xffe6) ||
    (cp >= 0x1f300 && cp <= 0x1faff) || // emoji & pictographs
    (cp >= 0x20000 && cp <= 0x3fffd) // CJK ext B+
  );
}

// --- row splitting with offsets --------------------------------------------

export interface ParsedCell {
  /** Trimmed cell content. */
  text: string;
  /** Doc offset of the trimmed content start. */
  from: number;
  /** Doc offset of the trimmed content end. */
  to: number;
}

export interface ParsedRow {
  /** Index of this row's line within the table (0 = header). */
  lineIndex: number;
  /** Doc offset of the line start. */
  lineFrom: number;
  cells: ParsedCell[];
}

export interface ParsedTable {
  /** Doc offset of the table start (== tableFrom). */
  from: number;
  /** Doc offset of the table end. */
  to: number;
  aligns: Align[];
  /** Header (index 0) + body rows; the delimiter row is excluded. */
  rows: ParsedRow[];
  delimLineFrom: number;
  delimLineTo: number;
  /** Whether a whole-table rewrite keeps the table's container (`tableRewritable`). */
  rewritable: boolean;
}

/**
 * Split one table row into cells with doc offsets for the trimmed content.
 * Handles the optional leading/trailing `|` and escaped `\|` pipes.
 */
function splitRowWithOffsets(line: string, lineFrom: number): ParsedCell[] {
  // Inner region = strip one leading `|` (after leading spaces) and one trailing
  // unescaped `|` (before trailing spaces).
  let innerStart = 0;
  while (innerStart < line.length && line[innerStart] === " ") innerStart++;
  if (line[innerStart] === "|") innerStart++;
  else innerStart = 0;

  let innerEnd = line.length;
  let lastNonSpace = line.length;
  while (lastNonSpace > 0 && line[lastNonSpace - 1] === " ") lastNonSpace--;
  if (lastNonSpace > innerStart && line[lastNonSpace - 1] === "|" && line[lastNonSpace - 2] !== "\\") {
    innerEnd = lastNonSpace - 1;
  }

  const cells: ParsedCell[] = [];
  let segStart = innerStart;
  let escaped = false;
  for (let i = innerStart; i < innerEnd; i++) {
    const ch = line[i];
    if (escaped) {
      escaped = false;
    } else if (ch === "\\") {
      escaped = true;
    } else if (ch === "|") {
      cells.push(trimmedCell(line, segStart, i, lineFrom));
      segStart = i + 1;
    }
  }
  cells.push(trimmedCell(line, segStart, innerEnd, lineFrom));
  return cells;
}

/**
 * A cell's text as GFM reads it for display (change: editor-cell-fixes): the
 * table's own escape `\|` becomes `|` BEFORE the inline parse — everywhere,
 * inside code spans and math too ("including inside other inline spans", GFM
 * spec / tables). That is what lets `` `a\|b` `` show as `a|b`: a code span
 * keeps backslashes literally, so reading the cell as written would leave the
 * `\` showing. Same rule as cmark-gfm: a `\` directly before `|` is dropped.
 *
 * `at[i]` is where character `i` of `text` sits in the cell's source
 * (`at[text.length]` = the source length), so offsets read off `text` can be
 * written back into the source. Pure.
 */
export function cellDisplaySource(cell: string): { text: string; at: number[] } {
  let text = "";
  const at: number[] = [];
  for (let i = 0; i < cell.length; i++) {
    if (cell[i] === "\\" && cell[i + 1] === "|") continue;
    text += cell[i];
    at.push(i);
  }
  at.push(cell.length);
  return { text, at };
}

function trimmedCell(line: string, s: number, e: number, lineFrom: number): ParsedCell {
  let from = s;
  while (from < e && line[from] === " ") from++;
  let to = e;
  while (to > from && line[to - 1] === " ") to--;
  return { text: line.slice(from, to), from: from + lineFrom, to: to + lineFrom };
}

// --- alignment parsing ------------------------------------------------------

const DELIM_CELL = /^:?-+:?$/;

/** Parse the `:--- | ---:` delimiter line into per-column alignments. */
export function parseAligns(delimLine: string): Align[] {
  return splitRowWithOffsets(delimLine, 0).map((c) => {
    const t = c.text;
    const left = t.startsWith(":");
    const right = t.endsWith(":");
    if (left && right) return "center";
    if (right) return "right";
    if (left) return "left";
    return "none";
  });
}

function isDelimiterRow(line: string): boolean {
  const cells = splitRowWithOffsets(line, 0);
  return cells.length > 0 && cells.every((c) => DELIM_CELL.test(c.text));
}

// --- table parsing ----------------------------------------------------------

/**
 * Parse a GFM table from its source text. Returns null when the text is not a
 * table (needs a header line followed by a delimiter row). Offsets are shifted
 * by `tableFrom` so they address the live document.
 */
export function parseTable(tableText: string, tableFrom: number): ParsedTable | null {
  const rawLines = tableText.split("\n");
  const lines: { text: string; from: number }[] = [];
  let off = 0;
  for (const text of rawLines) {
    lines.push({ text, from: tableFrom + off });
    off += text.length + 1; // + newline
  }
  if (lines.length < 2 || !isDelimiterRow(lines[1].text)) return null;

  const aligns = parseAligns(lines[1].text);
  const rows: ParsedRow[] = [];
  const pushRow = (li: number) => {
    rows.push({ lineIndex: li, lineFrom: lines[li].from, cells: splitRowWithOffsets(lines[li].text, lines[li].from) });
  };
  pushRow(0);
  for (let li = 2; li < lines.length; li++) pushRow(li);

  return {
    from: tableFrom,
    to: tableFrom + tableText.length,
    aligns,
    rows,
    delimLineFrom: lines[1].from,
    delimLineTo: lines[1].from + lines[1].text.length,
    rewritable: tableRewritable(tableText),
  };
}

// --- normalized data model + serialization ----------------------------------

export interface TableData {
  header: string[];
  aligns: Align[];
  body: string[][];
}

function padArr<T>(arr: T[], n: number, fill: T): T[] {
  const out = arr.slice();
  while (out.length < n) out.push(fill);
  return out;
}

/**
 * Normalize a parsed table into a rectangular {header, aligns, body}.
 *
 * `cellText` maps a cell to the text that should occupy it; it defaults to the
 * cell's own source. Plain-text copy passes the RENDERED text instead, so that
 * `serializeTable` lays the columns out for what actually lands on the clipboard
 * rather than for the source width (change: copy-flavors) — sharing this
 * normalization keeps one CJK-aware width model instead of two that drift.
 */
export function tableDataFromParsed(
  p: ParsedTable,
  cellText: (cell: ParsedCell) => string = (cell) => cell.text,
): TableData {
  const cols = Math.max(p.aligns.length, ...p.rows.map((r) => r.cells.length));
  const textRow = (r: ParsedRow) => padArr(r.cells.map(cellText), cols, "");
  return {
    header: textRow(p.rows[0]),
    aligns: padArr(p.aligns, cols, "none"),
    body: p.rows.slice(1).map(textRow),
  };
}

function delimMarker(a: Align, w: number): string {
  switch (a) {
    case "left":
      return ":" + "-".repeat(w - 1);
    case "right":
      return "-".repeat(w - 1) + ":";
    case "center":
      return ":" + "-".repeat(w - 2) + ":";
    default:
      return "-".repeat(w);
  }
}

/**
 * Serialize to canonical aligned GFM: every column padded to a common width
 * (CJK-aware), the delimiter row encoding per-column alignment via colons. Cells
 * are left-padded (content + trailing spaces) so pipes line up in the source;
 * render alignment comes from the delimiter colons. No trailing newline.
 */
export function serializeTable(data: TableData): string {
  const cols = Math.max(data.header.length, data.aligns.length, ...data.body.map((r) => r.length));
  const at = (row: string[], c: number) => row[c] ?? "";
  const widths: number[] = [];
  for (let c = 0; c < cols; c++) {
    let w = displayWidth(at(data.header, c));
    for (const row of data.body) w = Math.max(w, displayWidth(at(row, c)));
    widths.push(Math.max(MIN_COL_WIDTH, w));
  }
  const pad = (text: string, c: number) => text + " ".repeat(Math.max(0, widths[c] - displayWidth(text)));
  const renderRow = (row: string[]) =>
    "|" + widths.map((_, c) => " " + pad(at(row, c), c) + " ").join("|") + "|";
  const delimRow =
    "|" + widths.map((w, c) => " " + delimMarker(data.aligns[c] ?? "none", w) + " ").join("|") + "|";
  return [renderRow(data.header), delimRow, ...data.body.map(renderRow)].join("\n");
}

/**
 * Can this table be rewritten whole (re-aligned, a row appended, a structural
 * command) without breaking what contains it? A table inside a list item or a
 * quote carries that container's prefix (`  `, `> `) at the start of every line
 * after its first; `serializeTable` writes bare rows, so a rewrite would strip
 * those prefixes and drop the rest of the table out of its container (spec:
 * editor-fidelity / 整表重写不越过表的容器). Such a table is left as written:
 * every whole-table rewrite below returns "nothing to do" for it, while
 * single-cell edits (`cellEditChange`) still work. Pure.
 */
export function tableRewritable(tableText: string): boolean {
  return tableText.split("\n").slice(1).every((line) => !/^[ \t>]/.test(line));
}

// --- cursor location --------------------------------------------------------

/** Grid position (row over header+body, col over cells) of the cursor. */
function locate(p: ParsedTable, cursor: number): { r: number; c: number } {
  let r = 0;
  for (let i = 0; i < p.rows.length; i++) if (p.rows[i].lineFrom <= cursor) r = i;
  const row = p.rows[r];
  let c = row.cells.findIndex((cell) => cursor <= cell.to);
  if (c < 0) c = Math.max(0, row.cells.length - 1);
  return { r, c };
}

function cellAt(p: ParsedTable, r: number, c: number): ParsedCell {
  const row = p.rows[Math.min(Math.max(0, r), p.rows.length - 1)];
  return row.cells[Math.min(Math.max(0, c), row.cells.length - 1)];
}

// --- navigation (task 2.1) --------------------------------------------------

export type TableNavResult =
  | { kind: "move"; anchor: number; head: number }
  | { kind: "change"; from: number; to: number; insert: string; anchor: number; head: number }
  | { kind: "noop" }
  | null;

const asMove = (cell: ParsedCell): TableNavResult => ({ kind: "move", anchor: cell.from, head: cell.to });

/**
 * Tab (`next`) / Shift-Tab (`prev`) cell movement. `next` past the last cell
 * appends an empty row and lands in it; `prev` at the first cell is a consumed
 * no-op. Returns null when the text is not a table (wiring falls through).
 */
export function tableCellNav(
  tableText: string,
  tableFrom: number,
  cursor: number,
  dir: "next" | "prev",
): TableNavResult {
  const p = parseTable(tableText, tableFrom);
  if (!p) return null;
  const { r, c } = locate(p, cursor);
  const row = p.rows[r];
  if (dir === "next") {
    if (c + 1 < row.cells.length) return asMove(row.cells[c + 1]);
    if (r + 1 < p.rows.length) return asMove(p.rows[r + 1].cells[0]);
    // last cell of last row → append a row and land in its first cell
    if (!p.rewritable) return { kind: "noop" };
    const data = tableDataFromParsed(p);
    data.body.push(new Array(data.aligns.length).fill(""));
    const insert = serializeTable(data);
    const cell = cellAt(parseTable(insert, tableFrom)!, p.rows.length, 0);
    return { kind: "change", from: p.from, to: p.to, insert, anchor: cell.from, head: cell.to };
  }
  if (c - 1 >= 0) return asMove(row.cells[c - 1]);
  if (r - 1 >= 0) {
    const prev = p.rows[r - 1];
    return asMove(prev.cells[prev.cells.length - 1]);
  }
  return { kind: "noop" };
}

// --- structural edits (task 2.2) --------------------------------------------

export interface TableStructResult {
  from: number;
  to: number;
  insert: string;
  anchor: number;
  head: number;
}

export type TableOp =
  | "insertRowAbove"
  | "insertRowBelow"
  | "insertColLeft"
  | "insertColRight"
  | "deleteRow"
  | "deleteColumn"
  | "moveRowUp"
  | "moveRowDown"
  | "moveColLeft"
  | "moveColRight"
  | "toggleAlign"
  | "format";

function nextAlign(a: Align): Align {
  return a === "left" ? "center" : a === "center" ? "right" : a === "right" ? "none" : "left";
}

function spliceCol<T>(data: TableData, i: number, remove: number, ...ins: T[]): void {
  const put = (arr: unknown[], v: unknown) => arr.splice(i, remove, ...(remove ? [] : [v]));
  put(data.header, ins[0] ?? "");
  put(data.aligns, ins[0] === undefined ? "none" : ins[0]);
  for (const row of data.body) put(row, ins[0] ?? "");
}

function swapCol(data: TableData, a: number, b: number): void {
  const sw = (arr: unknown[]) => {
    const t = arr[a];
    arr[a] = arr[b];
    arr[b] = t;
  };
  sw(data.header);
  sw(data.aligns);
  for (const row of data.body) sw(row);
}

/**
 * Apply a structural op at the cursor's cell and return the whole-table
 * re-serialization (canonical GFM) plus the new cursor. Returns null when the
 * text isn't a table or the op is a boundary no-op (move at an edge). Deleting
 * the last column removes the whole table (spec: 删除列的边界安全).
 */
export function tableStructEdit(
  tableText: string,
  tableFrom: number,
  cursor: number,
  op: TableOp,
): TableStructResult | null {
  const p = parseTable(tableText, tableFrom);
  if (!p || !p.rewritable) return null;
  const { r, c } = locate(p, cursor);
  const data = tableDataFromParsed(p);
  const cols = data.aligns.length;
  const emptyRow = () => new Array(cols).fill("");
  let tr = r;
  let tc = c;

  switch (op) {
    case "format":
      break;
    case "insertRowBelow":
      data.body.splice(r, 0, emptyRow()); // r=header(0)→body[0]; body b (=r)→after b
      tr = r + 1;
      break;
    case "insertRowAbove":
      data.body.splice(Math.max(0, r - 1), 0, emptyRow());
      tr = r === 0 ? 1 : r;
      break;
    case "deleteRow":
      if (r === 0) return null; // header defines the table — never deleted alone
      data.body.splice(r - 1, 1);
      tr = Math.min(r, data.body.length);
      break;
    case "moveRowUp":
      if (r <= 1) return null; // header, or first body can't cross the header
      [data.body[r - 2], data.body[r - 1]] = [data.body[r - 1], data.body[r - 2]];
      tr = r - 1;
      break;
    case "moveRowDown":
      if (r === 0 || r - 1 >= data.body.length - 1) return null;
      [data.body[r - 1], data.body[r]] = [data.body[r], data.body[r - 1]];
      tr = r + 1;
      break;
    case "insertColLeft":
    case "insertColRight": {
      const ci = op === "insertColLeft" ? c : c + 1;
      spliceCol(data, ci, 0);
      tc = ci;
      break;
    }
    case "deleteColumn":
      if (cols <= 1) return { from: p.from, to: p.to, insert: "", anchor: p.from, head: p.from };
      spliceCol(data, c, 1);
      tc = Math.min(c, cols - 2);
      break;
    case "moveColLeft":
      if (c === 0) return null;
      swapCol(data, c, c - 1);
      tc = c - 1;
      break;
    case "moveColRight":
      if (c >= cols - 1) return null;
      swapCol(data, c, c + 1);
      tc = c + 1;
      break;
    case "toggleAlign":
      data.aligns[c] = nextAlign(data.aligns[c]);
      break;
  }

  const insert = serializeTable(data);
  const cell = cellAt(parseTable(insert, tableFrom)!, tr, tc);
  return { from: p.from, to: p.to, insert, anchor: cell.from, head: cell.to };
}

// --- reflow (task 3) --------------------------------------------------------

export interface TableChange {
  from: number;
  to: number;
  insert: string;
}

/**
 * Canonicalize a table's pipe layout, but ONLY if it isn't already canonical.
 * Returns null when the text isn't a table OR is already aligned — so wiring it
 * to the "cursor left the table" boundary produces no empty change, no undo
 * entry, and no autosave churn (spec: 已对齐离开无改动; design D1 idempotency).
 */
export function reflowChangeIfNeeded(tableText: string, tableFrom: number): TableChange | null {
  const p = parseTable(tableText, tableFrom);
  if (!p || !p.rewritable) return null;
  const canonical = serializeTable(tableDataFromParsed(p));
  if (canonical === tableText) return null;
  return { from: tableFrom, to: tableFrom + tableText.length, insert: canonical };
}

// --- insert (change: table-insert-command) ----------------------------------

/** Default column count for a freshly inserted table (design D1). */
const DEFAULT_INSERT_COLS = 2;

/** An empty canonical seed: header + delimiter + one empty data row. */
function emptyTableData(cols: number): TableData {
  const row = (): string[] => new Array(cols).fill("");
  return { header: row(), aligns: new Array<Align>(cols).fill("none"), body: [row()] };
}

function trailingNewlines(s: string): number {
  let n = 0;
  for (let i = s.length - 1; i >= 0 && s[i] === "\n"; i--) n++;
  return n;
}

function leadingNewlines(s: string): number {
  let n = 0;
  for (let i = 0; i < s.length && s[i] === "\n"; i++) n++;
  return n;
}

/**
 * Offset just past the block containing `cursor`: extend through the contiguous
 * run of non-blank lines so a new table anchors AFTER the whole paragraph, never
 * splitting it. A blank cursor line returns its own start (insert in place).
 */
function blockEndOffset(doc: string, cursor: number): number {
  const n = doc.length;
  const lineStart = doc.lastIndexOf("\n", cursor - 1) + 1;
  let lineEnd = doc.indexOf("\n", cursor);
  if (lineEnd < 0) lineEnd = n;
  if (doc.slice(lineStart, lineEnd).trim() === "") return lineStart;
  let end = lineEnd;
  while (end < n) {
    const ns = end + 1;
    let ne = doc.indexOf("\n", ns);
    if (ne < 0) ne = n;
    if (doc.slice(ns, ne).trim() === "") break;
    end = ne;
  }
  return end;
}

/**
 * Insert a minimal legal GFM table at a safe block boundary near `cursor`
 * (spec: 表格插入). When `tableRange` is given (cursor sits inside a table) the
 * new table anchors AFTER that table block so existing pipes are never split.
 * The seed is already canonical, so a later 离表 reflow is a no-op (idempotent).
 * Returns a pure insertion (`from === to`) with the caret in the first header cell.
 */
export function insertTableChange(
  doc: string,
  cursor: number,
  tableRange: { from: number; to: number } | null,
  cols: number = DEFAULT_INSERT_COLS,
): TableStructResult {
  const at = tableRange ? tableRange.to : blockEndOffset(doc, cursor);
  const before = doc.slice(0, at);
  const after = doc.slice(at);
  const skeleton = serializeTable(emptyTableData(cols));

  // Blank-line separation on both sides (GFM tables must be block-isolated).
  const lead = before === "" ? "" : "\n".repeat(Math.max(0, 2 - trailingNewlines(before)));
  const trail = after === "" ? "\n" : "\n".repeat(Math.max(0, 2 - leadingNewlines(after)));

  const insert = lead + skeleton + trail;
  // Caret at the first header cell's content start: canonical rows begin "| ".
  const caret = at + lead.length + 2;
  return { from: at, to: at, insert, anchor: caret, head: caret };
}

// --- inline cell editing (change: table-inline-cell-editing) -----------------

/**
 * Grid position (row over header+body, col over cells) of a document offset that
 * falls within a table. Used to re-target the in-place editor onto the cell a
 * structural command landed on (spec: 结构命令在编辑会话中可达).
 */
export function locateCell(p: ParsedTable, pos: number): { row: number; col: number } {
  const { r, c } = locate(p, pos);
  return { row: r, col: c };
}

/**
 * Doc offsets of one cell's trimmed content, addressed by grid position
 * (row over header+body, col over that row's cells; the delimiter row is not
 * addressable). Null when out of range. The in-place cell editor seeds and syncs
 * against this range so the surrounding pipe/padding structure is left intact.
 */
export function cellSourceRange(
  p: ParsedTable,
  row: number,
  col: number,
): { from: number; to: number } | null {
  const r = p.rows[row];
  if (!r) return null;
  const cell = r.cells[col];
  if (!cell) return null;
  return { from: cell.from, to: cell.to };
}

/**
 * `userEvent` the in-place cell input tags its per-keystroke sync with.
 *
 * It MUST stay inside history's `joinableUserEvent = /^(input\.type|delete)($|\.)/`,
 * otherwise each keystroke becomes its own undo step and `Cmd+Z` walks the cell
 * back one character at a time (change: table-cell-edit-undo / F2). A bare
 * `"input"` is the trap here: it reads right and is WORSE than omitting the field,
 * which history treats as joinable. Pinned in `tableEdit.test.ts`.
 *
 * Discrete table commands (structural edits, reflow on leave) deliberately do NOT
 * use this — see `runTableOp` / `tableReflowOnEditEnd`.
 */
export const CELL_SYNC_USER_EVENT = "input.type";

/**
 * Precise change replacing ONE cell's source with `text` (task 1.1). The
 * in-place input dispatches this per keystroke to sync into the document WITHOUT
 * reflow — only the cell's content span changes, so the table stays valid GFM and
 * column re-alignment is deferred to session end (spec: 单元格原位编辑 / 实时同步).
 * Returns null when (row, col) is out of range.
 */
export function cellEditChange(
  p: ParsedTable,
  row: number,
  col: number,
  text: string,
): TableChange | null {
  const range = cellSourceRange(p, row, col);
  if (!range) return null;
  return { from: range.from, to: range.to, insert: text };
}

/** Result of a grid navigation step for the in-place editor (task 1.2). */
export type GridNav =
  | { kind: "move"; row: number; col: number }
  | { kind: "expand"; change: TableChange; row: number; col: number }
  | { kind: "noop" };

/** Append an empty body row and land the editor in it (col clamped to width). */
function expandRow(p: ParsedTable, col: number): GridNav {
  if (!p.rewritable) return { kind: "noop" };
  const data = tableDataFromParsed(p);
  data.body.push(new Array(data.aligns.length).fill(""));
  const insert = serializeTable(data);
  return {
    // The new body row's index over header+body == the current rows.length.
    kind: "expand",
    change: { from: p.from, to: p.to, insert },
    row: p.rows.length,
    col: Math.min(col, Math.max(0, data.aligns.length - 1)),
  };
}

/**
 * Grid navigation for the in-place cell editor (task 1.2): move the edited cell
 * by one step. `next` (Tab) / `prev` (Shift-Tab) walk cells with row wrap; `down`
 * (Enter) moves one row in the same column. `next` past the last cell and `down`
 * past the last row append an empty row (expand) and land in it; `prev` at the
 * very first cell is a consumed no-op (spec: 单元格导航). Pure — no DOM, no
 * EditorState — so it's node-testable (see CLAUDE.md).
 */
export function tableGridNav(
  p: ParsedTable,
  row: number,
  col: number,
  dir: "next" | "prev" | "down",
): GridNav {
  const rows = p.rows;
  const count = (r: number) => rows[r].cells.length;
  if (dir === "next") {
    if (col + 1 < count(row)) return { kind: "move", row, col: col + 1 };
    if (row + 1 < rows.length) return { kind: "move", row: row + 1, col: 0 };
    return expandRow(p, 0);
  }
  if (dir === "prev") {
    if (col - 1 >= 0) return { kind: "move", row, col: col - 1 };
    if (row - 1 >= 0) return { kind: "move", row: row - 1, col: count(row - 1) - 1 };
    return { kind: "noop" };
  }
  // down (Enter)
  if (row + 1 < rows.length) {
    return { kind: "move", row: row + 1, col: Math.min(col, count(row + 1) - 1) };
  }
  return expandRow(p, col);
}

/** Where an arrow key leaves a cell (change: table-cell-editor; spec: 格内方向键换格). */
export type ArrowNav =
  | { kind: "move"; row: number; col: number }
  | { kind: "exit"; dir: "up" | "down" }
  | { kind: "noop" };

/**
 * The cell an arrow key moves to once the caret is already at that edge of its
 * own cell (the caller decides "at the edge" — first / last visual line for ↑ / ↓,
 * source start / end for ← / →). ↑ / ↓ keep the column (clamped to a shorter
 * row) and leave the table past the header / last row; ← / → wrap across rows
 * and stop at the table's first / last cell.
 */
export function tableArrowNav(
  p: ParsedTable,
  row: number,
  col: number,
  dir: "up" | "down" | "left" | "right",
): ArrowNav {
  const rows = p.rows;
  const last = (r: number) => rows[r].cells.length - 1;
  switch (dir) {
    case "up":
      return row > 0 ? { kind: "move", row: row - 1, col: Math.min(col, last(row - 1)) } : { kind: "exit", dir: "up" };
    case "down":
      return row < rows.length - 1
        ? { kind: "move", row: row + 1, col: Math.min(col, last(row + 1)) }
        : { kind: "exit", dir: "down" };
    case "left":
      if (col > 0) return { kind: "move", row, col: col - 1 };
      return row > 0 ? { kind: "move", row: row - 1, col: last(row - 1) } : { kind: "noop" };
    case "right":
      if (col < last(row)) return { kind: "move", row, col: col + 1 };
      return row < rows.length - 1 ? { kind: "move", row: row + 1, col: 0 } : { kind: "noop" };
  }
}

/** A GFM cell holds one line of source: pasted line breaks become spaces. */
export function flattenCellInsert(text: string): string {
  return text.replace(/\r?\n/g, " ");
}

/**
 * What a GFM table cell can hold, applied to text typed or pasted into one
 * (`before` = the cell's text before the insertion point): one line, and no
 * bare `|` — a bare pipe IS the column separator, so it would split the cell in
 * the source. It is written `\|`, the table's own escape (rendered as `|`).
 * A pipe already escaped — by a backslash in the insert or right before it — is
 * left alone; a backslash that is itself escaped (`\\`) does not count.
 */
export function tableCellInsert(text: string, before: string): string {
  let run = /\\*$/.exec(before)![0].length;
  let out = "";
  for (const ch of flattenCellInsert(text)) {
    if (ch === "|" && run % 2 === 0) out += "\\";
    out += ch;
    run = ch === "\\" ? run + 1 : 0;
  }
  return out;
}
