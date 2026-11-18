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
  /** Doc offset where the cell's segment ends (its right pipe, or the row's end). */
  end: number;
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
  /** The table's source text, as parsed. */
  source: string;
}

/**
 * Where one table row's cells sit in its line: the inner region (one leading
 * `|` after leading spaces and one trailing unescaped `|` before trailing spaces
 * stripped) and the raw segments between unescaped pipes, padding included.
 * Handles escaped `\|` pipes. The one row splitter: the trimmed cells
 * (`splitRowWithOffsets`) and the raw layout (`rawRows`) both read it.
 */
function rowSpans(line: string): { innerStart: number; innerEnd: number; spans: [number, number][] } {
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

  const spans: [number, number][] = [];
  let segStart = innerStart;
  let escaped = false;
  for (let i = innerStart; i < innerEnd; i++) {
    const ch = line[i];
    if (escaped) {
      escaped = false;
    } else if (ch === "\\") {
      escaped = true;
    } else if (ch === "|") {
      spans.push([segStart, i]);
      segStart = i + 1;
    }
  }
  spans.push([segStart, innerEnd]);
  return { innerStart, innerEnd, spans };
}

/** Split one table row into cells with doc offsets for the trimmed content. */
function splitRowWithOffsets(line: string, lineFrom: number): ParsedCell[] {
  return rowSpans(line).spans.map(([s, e]) => trimmedCell(line, s, e, lineFrom));
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
  // An empty cell is an insertion point one space in from its left pipe (change:
  // editor-edit-locality): typing into `|   |` writes `| x  |`, the way the cell
  // would be written by hand, not `|   x|` against the right pipe.
  if (from === e) from = Math.min(s + 1, e);
  let to = e;
  while (to > from && line[to - 1] === " ") to--;
  return { text: line.slice(from, to), from: from + lineFrom, to: to + lineFrom, end: e + lineFrom };
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
    source: tableText,
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

// --- the table's own layout (change: editor-edit-locality) ------------------
//
// An edit changes only what it touched; untouched source keeps its own style
// (spec: editor-fidelity / 规整登记表 N1, N2). Everything below reads a table's
// style off the table itself — no option, no canonical form imposed:
//
//   - ALIGNED: the pipes of most rows line up (one segment width per column) and
//     something shows the padding is deliberate (a cell padded past the table's
//     margin, an empty cell wider than the margins, a delimiter run longer than
//     `---`). Without that evidence a table whose cells merely happen to be the
//     same width reads as compact — the reading that rewrites fewer bytes.
//   - COMPACT: anything else (`|a|b|`, `| a | b |`, `| x | y |\n|---|---|`).
//
// A row whose segments do not match the column widths (a hand-compacted row in
// an aligned table) is not an aligned row, and nothing here re-pads it.

type Justify = "left" | "right" | "center";

/** One raw segment between pipes (or a row edge), padding included. */
interface RawSeg {
  /** Doc offsets of the whole segment. */
  from: number;
  to: number;
  /** The trimmed content. */
  content: string;
  /** Spaces before / after the content; an empty segment is all `trail`. */
  lead: number;
  trail: number;
  /** Display width of the whole segment. */
  width: number;
  /** Bounded by a pipe on the left / on the right (not by the row's edge). */
  leftPipe: boolean;
  rightPipe: boolean;
}

interface RawRow {
  from: number;
  text: string;
  /** Everything before the first segment (`|`, or indentation + `|`) and after the last. */
  prefix: string;
  suffix: string;
  segs: RawSeg[];
  delimiter: boolean;
  /** Has both a leading and a trailing pipe. */
  piped: boolean;
}

function rawRow(text: string, lineFrom: number, delimiter: boolean): RawRow {
  const { innerStart, innerEnd, spans } = rowSpans(text);
  const leading = innerStart > 0;
  const trailing = innerEnd < text.length;
  const segs = spans.map(([s, e], i): RawSeg => {
    const raw = text.slice(s, e);
    const content = raw.replace(/^ +| +$/g, "");
    const lead = content === "" ? 0 : raw.length - raw.replace(/^ +/, "").length;
    const trail = raw.length - lead - content.length;
    return {
      from: lineFrom + s,
      to: lineFrom + e,
      content,
      lead,
      trail,
      width: displayWidth(raw),
      leftPipe: i > 0 || leading,
      rightPipe: i < spans.length - 1 || trailing,
    };
  });
  return {
    from: lineFrom,
    text,
    prefix: text.slice(0, innerStart),
    suffix: text.slice(innerEnd),
    segs,
    delimiter,
    piped: leading && trailing,
  };
}

/** Every line of a table as a raw row (line 0 header, line 1 delimiter, then body). */
function rawRows(tableText: string, tableFrom: number): RawRow[] {
  let off = tableFrom;
  return tableText.split("\n").map((text, i) => {
    const row = rawRow(text, off, i === 1);
    off += text.length + 1;
    return row;
  });
}

/** Line index of a grid row (row over header+body; the delimiter is line 1). */
const lineOfRow = (row: number) => (row === 0 ? 0 : row + 1);

interface TableLayout {
  /** The column count over every row. */
  cols: number;
  /** Segment width per column where the rows agree (null: no closed segment to read). */
  widths: (number | null)[];
  /** Per line: its pipes sit on the column widths (wild cells not compared). */
  rowAligned: boolean[];
  /** The table as a whole is aligned (see the section comment). */
  aligned: boolean;
  /** Content cells' margins: the fewest spaces seen before / after a cell's text. */
  mL: number;
  mR: number;
  /** The delimiter row's own margins and its shortest dash run. */
  dL: number;
  dR: number;
  dashes: number;
  /** How content sits in each column's padding, read off its padded cells. */
  justify: Justify[];
}

const dashCount = (s: string) => (s.match(/-/g) ?? []).length;

/** The most frequent value; a tie goes to the one seen first (in row order: the header). */
function mode(values: number[]): number | null {
  const counts = new Map<number, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  let best: number | null = null;
  for (const v of values) if (best === null || counts.get(v)! > counts.get(best)!) best = v;
  return best;
}

/**
 * Read a table's layout. `wild(line, col)` marks cells the current edit wrote:
 * they are not evidence of the table's style (their padding is whatever typing
 * left), so they are skipped when the widths, margins and alignment are read.
 */
function tableLayout(rows: RawRow[], wild: (line: number, col: number) => boolean = () => false): TableLayout {
  const cols = Math.max(...rows.map((r) => r.segs.length));
  const closed = (r: RawRow, c: number) => !!r.segs[c] && r.segs[c].leftPipe && r.segs[c].rightPipe;

  const widths: (number | null)[] = [];
  for (let c = 0; c < cols; c++) {
    // Content rows decide; the delimiter row only when no content row can (a
    // compact `|---|` delimiter under padded rows must not win a tie).
    const seen = (delimiter: boolean) =>
      rows.flatMap((r, li) => (r.delimiter === delimiter && closed(r, c) && !wild(li, c) ? [r.segs[c].width] : []));
    widths.push(mode(seen(false)) ?? mode(seen(true)));
  }
  const prefixWidth = mode(rows.map((r) => displayWidth(r.prefix)));

  const compared: number[] = [];
  const rowAligned = rows.map((r, li) => {
    let n = 0;
    let ok = displayWidth(r.prefix) === prefixWidth;
    for (let c = 0; c < r.segs.length; c++) {
      if (!closed(r, c) || wild(li, c) || widths[c] === null) continue;
      n++;
      if (r.segs[c].width !== widths[c]) ok = false;
    }
    compared.push(n);
    return ok;
  });
  // Aligned lines must be the majority of the lines that could be compared, so
  // one row that happens to match a compact delimiter does not make a table
  // aligned. A line whose every cell was just edited has nothing to compare; it
  // still counts toward the two lines an alignment needs.
  const comparable = compared.filter((n) => n > 0).length;
  const matching = rowAligned.filter((ok, li) => ok && compared[li] > 0).length;
  const editedOnly = rowAligned.filter((ok, li) => ok && compared[li] === 0).length;
  const alignedLines = matching * 2 > comparable ? matching + editedOnly : 0;

  // Margins and justification come from the aligned rows when there are any:
  // a hand-compacted row's `|Raj|` must not read as the table's margin.
  const marginRows = rows
    .map((r, li) => ({ r, li }))
    .filter(({ r, li }) => !r.delimiter && (alignedLines >= 2 ? rowAligned[li] : true));
  const content = marginRows.flatMap(({ r, li }) =>
    r.segs.flatMap((seg, c) => (closed(r, c) && !wild(li, c) ? [seg] : [])),
  );
  const filled = content.filter((seg) => seg.content !== "");
  // A margin is at most one space (`|a|`, `| a |`); anything past it is padding —
  // so a lone padded row still shows its padding is deliberate.
  const mL = filled.length ? Math.min(1, ...filled.map((s) => s.lead)) : 1;
  const mR = filled.length ? Math.min(1, ...filled.map((s) => s.trail)) : 1;

  const delim = rows[1];
  const delimSegs = delim ? delim.segs.filter((seg) => seg.content !== "") : [];
  const dL = delimSegs.length ? Math.min(...delimSegs.map((s) => s.lead)) : mL;
  const dR = delimSegs.length ? Math.min(...delimSegs.map((s) => s.trail)) : mR;
  const dashes = delimSegs.length ? Math.max(1, Math.min(...delimSegs.map((s) => dashCount(s.content)))) : MIN_COL_WIDTH;

  const evidence =
    content.some((seg) => (seg.content === "" ? seg.width > mL + mR : seg.lead > mL || seg.trail > mR)) ||
    (!!delim && rowAligned[1] && delim.segs.some((seg) => dashCount(seg.content) > MIN_COL_WIDTH));

  // Body cells decide; the header only when no body cell is padded (a header is
  // often written left-justified over a right-justified column).
  const justify: Justify[] = [];
  for (let c = 0; c < cols; c++) {
    const paddedIn = (rowsIn: typeof marginRows) =>
      rowsIn.flatMap(({ r, li }) => {
        const seg = r.segs[c];
        return seg && closed(r, c) && !wild(li, c) && seg.content !== "" && seg.lead + seg.trail > mL + mR ? [seg] : [];
      });
    const body = paddedIn(marginRows.filter(({ li }) => li > 1));
    const padded = body.length ? body : paddedIn(marginRows);
    if (padded.every((seg) => seg.lead === mL)) justify.push("left");
    else if (padded.every((seg) => seg.trail === mR)) justify.push("right");
    else justify.push("center");
  }

  return { cols, widths, rowAligned, aligned: alignedLines >= 2 && evidence, mL, mR, dL, dR, dashes, justify };
}

/** Lead / trail spaces that put content of width `w` in a segment of width `W`. */
function padFor(L: TableLayout, c: number, w: number, W: number): { lead: number; trail: number } {
  const extra = Math.max(0, W - w - L.mL - L.mR);
  switch (L.justify[c] ?? "left") {
    case "right":
      return { lead: L.mL + extra, trail: L.mR };
    case "center":
      return { lead: L.mL + Math.floor(extra / 2), trail: L.mR + Math.ceil(extra / 2) };
    default:
      return { lead: L.mL, trail: L.mR + extra };
  }
}

/**
 * The padding-only changes that give `seg` `lead` / `trail` spaces. The content
 * itself is never rewritten, so a caret inside it maps through unmoved.
 */
function repad(seg: RawSeg, lead: number, trail: number): TableChange[] {
  const spaces = (n: number) => " ".repeat(n);
  if (seg.content === "") {
    const delta = lead + trail - (seg.to - seg.from);
    if (delta > 0) return [{ from: seg.to, to: seg.to, insert: spaces(delta) }];
    if (delta < 0) return [{ from: seg.to + delta, to: seg.to, insert: "" }];
    return [];
  }
  const out: TableChange[] = [];
  if (lead > seg.lead) out.push({ from: seg.from, to: seg.from, insert: spaces(lead - seg.lead) });
  if (lead < seg.lead) out.push({ from: seg.from, to: seg.from + seg.lead - lead, insert: "" });
  if (trail > seg.trail) out.push({ from: seg.to, to: seg.to, insert: spaces(trail - seg.trail) });
  if (trail < seg.trail) out.push({ from: seg.to - (seg.trail - trail), to: seg.to, insert: "" });
  return out;
}

/** Widen one untouched segment by `d`, keeping its own padding on the side it already pads. */
function widen(L: TableLayout, seg: RawSeg, delimiter: boolean, d: number): TableChange[] {
  if (d <= 0) return [];
  if (delimiter) {
    // More dashes, colons kept: insert after the run's last dash.
    const last = seg.content.lastIndexOf("-");
    if (last < 0) return [];
    const at = seg.from + seg.lead + last + 1;
    return [{ from: at, to: at, insert: "-".repeat(d) }];
  }
  // The cell's own placement decides: flush left grows on the right, flush
  // right grows on the left, anything else is re-centred.
  if (seg.content === "" || seg.lead <= L.mL) return repad(seg, seg.lead, seg.trail + d);
  if (seg.trail <= L.mR) return repad(seg, seg.lead + d, seg.trail);
  const extra = seg.lead + seg.trail + d - L.mL - L.mR;
  return repad(seg, L.mL + Math.floor(extra / 2), L.mR + Math.ceil(extra / 2));
}

/**
 * The changes that settle the cells an edit session wrote (spec: editor-fidelity
 * N1). Cell typing writes only the cell's text; when the session ends, an
 * ALIGNED table gets the padding of each edited cell back to its column's width
 * — and, when an edited cell no longer fits, that one column is widened in the
 * table's aligned rows (delimiter dashes included, colons kept). Nothing else
 * moves: a compact table, a row that is not aligned (hand-compacted), every
 * other column and every untouched cell stay byte for byte. Columns never
 * shrink — the other rows keep their padding.
 *
 * The style is read off `origin` — the table as it was before the session's
 * first keystroke — when it still has the same lines and cells: that is the
 * table's own style, the edited cells' old padding included. Without it (or
 * after a foreign change reshaped the table) it is read off the current text
 * with the edited cells left out as evidence.
 *
 * `cells` are grid positions (row over header+body). Returns [] when there is
 * nothing to settle. Changes are padding-only, sorted, in doc offsets. Pure.
 */
export function settleCellsChange(
  tableText: string,
  tableFrom: number,
  cells: readonly { row: number; col: number }[],
  origin: string | null = null,
): TableChange[] {
  if (!cells.length || !tableRewritable(tableText) || !parseTable(tableText, tableFrom)) return [];
  const rows = rawRows(tableText, tableFrom);
  const edited = new Set(cells.map((cell) => `${lineOfRow(cell.row)}:${cell.col}`));
  const before = origin !== null && parseTable(origin, tableFrom) ? rawRows(origin, tableFrom) : null;
  const sameShape =
    !!before && before.length === rows.length && before.every((r, li) => r.segs.length === rows[li].segs.length);
  const L = sameShape ? tableLayout(before!) : tableLayout(rows, (li, c) => edited.has(`${li}:${c}`));
  if (!L.aligned) return [];
  /** The line still sits on the widths read (its untouched cells unchanged in width). */
  const stillAligned = (li: number) =>
    L.rowAligned[li] &&
    rows[li].segs.every(
      (seg, c) => edited.has(`${li}:${c}`) || !seg.leftPipe || !seg.rightPipe || L.widths[c] === null || seg.width === L.widths[c],
    );

  const target = L.widths.slice();
  const settle: { seg: RawSeg; col: number }[] = [];
  for (const key of edited) {
    const [li, col] = key.split(":").map(Number);
    const seg = rows[li]?.segs[col];
    const W = L.widths[col];
    if (!seg || !seg.leftPipe || !seg.rightPipe || W === null || !stillAligned(li)) continue;
    target[col] = Math.max(target[col]!, L.mL + displayWidth(seg.content) + L.mR);
    settle.push({ seg, col });
  }

  const changes: TableChange[] = [];
  for (let c = 0; c < L.cols; c++) {
    const W = L.widths[c];
    const T = target[c];
    if (W === null || T === null || T <= W) continue;
    rows.forEach((r, li) => {
      const seg = r.segs[c];
      if (!seg || !seg.leftPipe || !seg.rightPipe || edited.has(`${li}:${c}`) || !stillAligned(li)) return;
      changes.push(...widen(L, seg, r.delimiter, T - W));
    });
  }
  for (const { seg, col } of settle) {
    const p = padFor(L, col, displayWidth(seg.content), target[col]!);
    changes.push(...repad(seg, p.lead, p.trail));
  }
  return changes.sort((a, b) => a.from - b.from);
}

/** `changes` (sorted, non-overlapping, doc offsets) applied to the table text at `tableFrom`. */
export function applyTableChanges(tableText: string, tableFrom: number, changes: readonly TableChange[]): string {
  let out = tableText;
  for (const ch of [...changes].sort((a, b) => b.from - a.from)) {
    out = out.slice(0, ch.from - tableFrom) + ch.insert + out.slice(ch.to - tableFrom);
  }
  return out;
}

// --- rows and columns in the table's own style (spec: N2) -------------------

/** Every row has both outer pipes — the tables the styled structural edits handle. */
function allPiped(rows: RawRow[]): boolean {
  return rows.every((r) => r.piped);
}

/**
 * An empty content segment for column `c`: padded to the column in an aligned
 * row, else the margins of `row` itself (a hand-compacted `|a|b|` row gets `||`),
 * or the table's margins for a new row.
 */
function blankSeg(L: TableLayout, c: number, aligned: boolean, width: number | null = L.widths[c], row?: RawRow): string {
  if (aligned && width !== null) return " ".repeat(width);
  const filled = row ? row.segs.filter((seg) => seg.content !== "" && seg.leftPipe && seg.rightPipe) : [];
  if (filled.length) return " ".repeat(Math.min(...filled.map((s) => s.lead)) + Math.min(...filled.map((s) => s.trail)));
  return " ".repeat(L.mL + L.mR);
}

/** A delimiter segment for a new column. */
function blankDelimSeg(L: TableLayout, aligned: boolean, width: number | null): string {
  const run = aligned && width !== null ? Math.max(1, width - L.dL - L.dR) : L.dashes;
  return " ".repeat(L.dL) + "-".repeat(run) + " ".repeat(L.dR);
}

/** The text of an empty body row in the table's style. */
function blankRowText(L: TableLayout, cols: number): string {
  const segs: string[] = [];
  for (let c = 0; c < cols; c++) segs.push(blankSeg(L, c, L.aligned));
  return "|" + segs.join("|") + "|";
}

const rowWith = (r: RawRow, segs: string[]) => r.prefix + segs.join("|") + r.suffix;
const segTexts = (r: RawRow) => r.segs.map((seg) => r.text.slice(seg.from - r.from, seg.to - r.from));

// --- cursor location --------------------------------------------------------

/** Grid position (row over header+body, col over cells) of the cursor. */
function locate(p: ParsedTable, cursor: number): { r: number; c: number } {
  let r = 0;
  for (let i = 0; i < p.rows.length; i++) if (p.rows[i].lineFrom <= cursor) r = i;
  const row = p.rows[r];
  // The cell whose segment holds the cursor, its padding included.
  let c = row.cells.findIndex((cell) => cursor <= cell.end);
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
    const grown = appendRowChange(p);
    if (!grown) return { kind: "noop" };
    const cell = cellAt(parseTable(grown.insert, tableFrom)!, p.rows.length, 0);
    return { kind: "change", ...grown, anchor: cell.from, head: cell.to };
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
 * Append an empty body row to the table (Tab / Enter past the last cell, spec:
 * N2): every existing line stays byte for byte and the new row is written in
 * the table's own style — padded to the column widths in an aligned table, the
 * table's margins in a compact one. A table without outer pipes on every row
 * gets the canonical rewrite instead (an empty row cannot be written pipe-less
 * without a leading space, which would read as a container prefix). Null when
 * the table cannot be rewritten (inside a container).
 */
export function appendRowChange(p: ParsedTable): TableChange | null {
  if (!p.rewritable) return null;
  return wholeTable(
    p,
    (L, cols, lines) => lines.push(blankRowText(L, cols)),
    (data) => data.body.push(new Array(data.aligns.length).fill("")),
  );
}

/**
 * Run a row-level rewrite on a table's lines in its own style, or — for a table
 * that is not piped on every row — the canonical one on its normalized data.
 * Returns the whole-table change (callers place the caret by re-parsing it).
 */
function wholeTable(
  p: ParsedTable,
  styled: (L: TableLayout, cols: number, lines: string[]) => void,
  canonical: (data: TableData) => void,
): TableChange {
  const rows = rawRows(p.source, p.from);
  if (!allPiped(rows)) {
    const data = tableDataFromParsed(p);
    canonical(data);
    return { from: p.from, to: p.to, insert: serializeTable(data) };
  }
  const L = tableLayout(rows);
  const cols = Math.max(p.aligns.length, ...p.rows.map((r) => r.cells.length));
  const lines = rows.map((r) => r.text);
  styled(L, cols, lines);
  return { from: p.from, to: p.to, insert: lines.join("\n") };
}

/**
 * Apply a structural op at the cursor's cell and return the whole-table text
 * plus the new cursor (spec: editor-fidelity N2). The op rewrites only what it
 * structurally affects, in the table's own style: a row op moves / inserts /
 * deletes lines and leaves every other line byte for byte; a column op splices
 * that column's segment in every row and keeps each row's other segments as
 * written; toggling alignment rewrites that column's delimiter marker (same
 * length when it fits; when it must grow in an aligned table, that column is
 * widened). `format` is the one op that rewrites the whole table to the
 * canonical aligned form — re-aligning is what it is for. A table without outer
 * pipes on every row falls back to the canonical rewrite for every op.
 *
 * Returns null when the text isn't a table or the op is a boundary no-op (move
 * at an edge). Deleting the last column removes the whole table (spec:
 * 删除列的边界安全).
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
  const rows = rawRows(tableText, tableFrom);
  const insert =
    op === "format" || !allPiped(rows) ? canonicalStructEdit(p, r, c, op) : styledStructEdit(p, rows, r, c, op);
  if (!insert) return null;
  if (insert.text === "") return { from: p.from, to: p.to, insert: "", anchor: p.from, head: p.from };
  const cell = cellAt(parseTable(insert.text, tableFrom)!, insert.row, insert.col);
  return { from: p.from, to: p.to, insert: insert.text, anchor: cell.from, head: cell.to };
}

type OpResult = { text: string; row: number; col: number } | null;

/** The op in the table's own style (every row piped). */
function styledStructEdit(p: ParsedTable, rows: RawRow[], r: number, c: number, op: TableOp): OpResult {
  const L = tableLayout(rows);
  const cols = Math.max(p.aligns.length, ...p.rows.map((row) => row.cells.length));
  const lines = rows.map((row) => row.text);
  const body = p.rows.length - 1;
  const done = (row: number, col: number): OpResult => ({ text: lines.join("\n"), row, col });
  const swapLines = (a: number, b: number) => ([lines[a], lines[b]] = [lines[b], lines[a]]);

  /** Each row's segments, padded with blanks up to `n` (a ragged row lacks some). */
  const segsUpTo = (li: number, n: number): string[] => {
    const row = rows[li];
    const segs = segTexts(row);
    const aligned = L.aligned && L.rowAligned[li];
    while (segs.length < n) {
      const k = segs.length;
      segs.push(row.delimiter ? blankDelimSeg(L, aligned, L.widths[k]) : blankSeg(L, k, aligned, L.widths[k], row));
    }
    return segs;
  };
  const eachRow = (f: (segs: string[], li: number, aligned: boolean) => string[] | null) => {
    rows.forEach((row, li) => {
      const next = f(segTexts(row), li, L.aligned && L.rowAligned[li]);
      if (next) lines[li] = rowWith(row, next);
    });
  };

  switch (op) {
    case "insertRowBelow":
      lines.splice(r === 0 ? 2 : r + 2, 0, blankRowText(L, cols));
      return done(r + 1, c);
    case "insertRowAbove":
      lines.splice(r === 0 ? 2 : r + 1, 0, blankRowText(L, cols));
      return done(r === 0 ? 1 : r, c);
    case "deleteRow":
      if (r === 0) return null; // header defines the table — never deleted alone
      lines.splice(r + 1, 1);
      return done(Math.min(r, body - 1), c);
    case "moveRowUp":
      if (r <= 1) return null; // header, or first body can't cross the header
      swapLines(r + 1, r);
      return done(r - 1, c);
    case "moveRowDown":
      if (r === 0 || r >= body) return null;
      swapLines(r + 1, r + 2);
      return done(r + 1, c);
    case "insertColLeft":
    case "insertColRight": {
      const ci = op === "insertColLeft" ? c : c + 1;
      const width = L.aligned ? L.mL + MIN_COL_WIDTH + L.mR : null;
      rows.forEach((row, li) => {
        const aligned = L.aligned && L.rowAligned[li];
        const segs = segsUpTo(li, ci);
        segs.splice(ci, 0, row.delimiter ? blankDelimSeg(L, aligned, width) : blankSeg(L, ci, aligned, width, row));
        lines[li] = rowWith(row, segs);
      });
      return done(r, ci);
    }
    case "deleteColumn":
      if (cols <= 1) return { text: "", row: 0, col: 0 };
      eachRow((segs) => (segs.length > c ? (segs.splice(c, 1), segs) : null));
      return done(r, Math.min(c, cols - 2));
    case "moveColLeft":
    case "moveColRight": {
      const other = op === "moveColLeft" ? c - 1 : c + 1;
      if (other < 0 || other >= cols) return null;
      rows.forEach((row, li) => {
        const segs = segsUpTo(li, Math.max(c, other) + 1);
        [segs[c], segs[other]] = [segs[other], segs[c]];
        lines[li] = rowWith(row, segs);
      });
      return done(r, other);
    }
    case "toggleAlign": {
      const delim = rows[1];
      const segs = segsUpTo(1, c + 1);
      const raw = segs[c];
      const marker = raw.trim();
      const lead = raw.length - raw.trimStart().length;
      const trail = raw.length - lead - marker.length;
      const align = nextAlign(p.aligns[c] ?? "none");
      const need = align === "center" ? 3 : align === "none" ? 1 : 2;
      const grow = Math.max(0, need - marker.length);
      // Room inside the segment's own padding first, then (aligned) widen the column.
      const fromPad = Math.min(grow, Math.max(0, trail - L.dR));
      segs[c] = " ".repeat(lead) + delimMarker(align, marker.length + grow) + " ".repeat(trail - fromPad);
      lines[1] = rowWith(delim, segs);
      const rest = grow - fromPad;
      if (rest > 0 && L.aligned && L.rowAligned[1] && L.widths[c] !== null) {
        rows.forEach((row, li) => {
          const seg = row.segs[c];
          if (li === 1 || !seg || !L.rowAligned[li] || seg.width !== L.widths[c]) return;
          lines[li] = applyTableChanges(row.text, row.from, widen(L, seg, false, rest));
        });
      }
      return done(r, c);
    }
    default:
      return null;
  }
}

/** The op on the table's normalized data, serialized canonical (Format table; pipe-less tables). */
function canonicalStructEdit(p: ParsedTable, r: number, c: number, op: TableOp): OpResult {
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
      if (r === 0) return null;
      data.body.splice(r - 1, 1);
      tr = Math.min(r, data.body.length);
      break;
    case "moveRowUp":
      if (r <= 1) return null;
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
      if (cols <= 1) return { text: "", row: 0, col: 0 };
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
  return { text: serializeTable(data), row: tr, col: tc };
}

// --- Format table's canonical form -----------------------------------------

export interface TableChange {
  from: number;
  to: number;
  insert: string;
}

/**
 * The canonical aligned form of a table, but ONLY if it isn't already canonical
 * (what Format table writes). Null when the text isn't a table, can't be
 * rewritten, or is already canonical. Editing no longer runs it: ending a cell
 * edit settles only the edited cells (`settleCellsChange`, change:
 * editor-edit-locality).
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
 * The seed is canonical; leaving it untyped writes nothing.
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
 * Discrete table commands (structural edits, the settle on leave) deliberately do NOT
 * use this — see `runTableOp` / `tableSettleOnEditEnd`.
 */
export const CELL_SYNC_USER_EVENT = "input.type";

/**
 * Precise change replacing ONE cell's source with `text` (task 1.1). The
 * in-place input dispatches this per keystroke to sync into the document WITHOUT
 * re-padding — only the cell's content span changes, so the table stays valid GFM and
 * the edited cells are settled at session end (spec: 单元格原位编辑 / 实时同步).
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
  const change = appendRowChange(p);
  if (!change) return { kind: "noop" };
  const cols = Math.max(p.aligns.length, ...p.rows.map((r) => r.cells.length));
  return {
    // The new body row's index over header+body == the current rows.length.
    kind: "expand",
    change,
    row: p.rows.length,
    col: Math.min(col, Math.max(0, cols - 1)),
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
