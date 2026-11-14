import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { EditorSelection, type EditorState, type Transaction, type TransactionSpec } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { undo } from "@codemirror/commands";
import { SearchQuery } from "@codemirror/search";
import { listFiles, repoPath } from "../../scripts/lib/repoFiles.mjs";
import { createEditorState } from "./base";
import { landingShownBy, strandedIn, undoLandingOf, type LandingShown } from "./caret";
import { blockRanges } from "./blocks/field";
import { tableEntryAt } from "./blocks/table";
import { withCompleteTree } from "./syntax";
import { cellEditChange, parseTable, tableGridNav } from "./tableEdit";
import { activeEditField, cellSync, setActiveEdit } from "./tableInlineEdit";
import { lineAfterBlock } from "./blocks/geometry";
import { NO_CARET_CLASS } from "./base";

/**
 * Gate (spec: caret-rules / 落点看得见). Fails, with the place, on:
 *
 * - G1: a product file under `src/editor/` that makes a replacing (hiding)
 *   decoration but is not in `HIDING_HOMES`; a home that must ask the one
 *   predicate (`landingInside`, `caret.ts`) and does not; a stale home.
 * - G2: a landing a test can drive from state — every Find match of a few
 *   queries on `fixtures/rendering/caret-landing.md` (live and Reading), every
 *   Tab step through its table, an undo inside a cell, each `navigateTo`
 *   heading target — that `landingShownBy` calls `hidden`. The verdict is read
 *   off the decorations the renderers build, not off a copy of their decision.
 * - G3: a non-editable state (Reading mode) without the no-caret marker on the
 *   editor root, or an editable one with it.
 *
 * Limits (stated, not hidden): G1 is textual (comments stripped); a replace
 * built through another helper is a review item. G2 covers the landings state
 * can produce; clicks and paste land through CodeMirror into the same
 * renderers, and what is ON SCREEN is the harness case `caret-rules`.
 */

const ROOT = process.cwd();
const SRC = join(ROOT, "src");
const FIXTURE = join(ROOT, "fixtures/rendering/caret-landing.md");

/** Every product file that hides source → how it keeps the landing shown. */
export const HIDING_HOMES: Record<string, { asks: true } | { exempt: string }> = {
  // The inline funnel `conceal`: skips the hide (live) or marks the stand-in (Reading).
  "editor/livePreview.ts": { asks: true },
  // The block fallback applier: marks the whole widget unless its entry paints the landing.
  "editor/blocks/field.ts": { asks: true },
  "editor/insets/decorate.ts": {
    exempt: "hides only indent whitespace a landing cannot select into (bar a Find for runs of spaces; see apply notes)",
  },
};

const HIDES = /\bDecoration\.replace\s*\(/;
const ASKS = /\blandingInside\s*\(/;

function stripComments(code: string): string {
  return code.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
}

export function hidingViolations(files: { path: string; code: string }[], homes: typeof HIDING_HOMES): string[] {
  const found: string[] = [];
  const hiders = new Set<string>();
  for (const { path, code } of files) {
    const bare = stripComments(code);
    if (!HIDES.test(bare)) continue;
    hiders.add(path);
    const home = homes[path];
    if (!home) found.push(`${path}: hides source — route it through landingInside and register it in HIDING_HOMES`);
    else if ("asks" in home && !ASKS.test(bare)) found.push(`${path}: hides source without asking landingInside`);
  }
  for (const path of Object.keys(homes)) {
    if (!hiders.has(path)) found.push(`${path}: registered in HIDING_HOMES but hides nothing — remove the entry`);
  }
  return found;
}

function editorFiles(): { path: string; code: string }[] {
  return listFiles(join(SRC, "editor"), { include: /\.tsx?$/, exclude: /\.test\.tsx?$/ }).map((p) => ({
    path: repoPath(SRC, p),
    code: readFileSync(p, "utf8"),
  }));
}

describe("G1 · every path that hides source asks the landing predicate", () => {
  it("the real editor", () => {
    const files = editorFiles();
    expect(files.some((f) => f.path === "editor/livePreview.ts")).toBe(true);
    expect(hidingViolations(files, HIDING_HOMES)).toEqual([]);
  });

  it("catches each kind of violation (reverse probes)", () => {
    expect(hidingViolations([{ path: "editor/x.ts", code: "const h = Decoration.replace({});" }], HIDING_HOMES)).toContain(
      "editor/x.ts: hides source — route it through landingInside and register it in HIDING_HOMES",
    );
    const homes = { "editor/x.ts": { asks: true as const } };
    expect(hidingViolations([{ path: "editor/x.ts", code: "deco.push(Decoration.replace({}).range(1, 2));" }], homes)).toEqual([
      "editor/x.ts: hides source without asking landingInside",
    ]);
    expect(
      hidingViolations([{ path: "editor/x.ts", code: "if (!landingInside(s, a, b)) deco.push(Decoration.replace({}).range(a, b));" }], homes),
    ).toEqual([]);
    expect(hidingViolations([{ path: "editor/x.ts", code: "const a = 1;" }], homes)).toEqual([
      "editor/x.ts: registered in HIDING_HOMES but hides nothing — remove the entry",
    ]);
    // Prose is not a hide.
    expect(hidingViolations([{ path: "editor/y.ts", code: "// Decoration.replace({})" }], {})).toEqual([]);
  });
});

// --- G2 ---------------------------------------------------------------------------

const DOC = readFileSync(FIXTURE, "utf8");
const LONG_URL = "https://openmarkdown.dev/editor/docs/fidelity/#what-the-exceptions-look-like";

function stateOf(mode: "live" | "reading"): EditorState {
  return withCompleteTree(createEditorState({ doc: DOC, mode }));
}

/** Apply `spec`, then R2c the way the view plugin would (body without the keys: a Find is open). */
function step(state: EditorState, spec: TransactionSpec): EditorState {
  let s = withCompleteTree(state.update(spec).state);
  const hit = strandedIn(s, false);
  const entry = hit ? tableEntryAt(s, hit.block, hit.pos, hit.head) : null;
  if (entry) s = s.update(entry.spec).state;
  return s;
}

function shown(state: EditorState, what: string): { what: string; shown: LandingShown } {
  return { what, shown: landingShownBy(state) };
}

const notHidden = (rows: { what: string; shown: LandingShown }[]) => rows.filter((r) => r.shown === "hidden");

describe("G2 · every landing a test can drive is shown", () => {
  it("reads the fixture the gate is about", () => {
    expect(DOC).toContain("| Kind | Cell |");
    expect(DOC).toContain("[Docs →](https://openmarkdown.dev/editor/docs/fidelity/#what-the-exceptions-look-like)");
    expect(DOC).toContain("[x](#the)");
    expect(DOC).toContain("- a **bold** item");
  });

  for (const mode of ["live", "reading"] as const) {
    it(`every Find match is shown (${mode})`, () => {
      const base = stateOf(mode);
      const rows: { what: string; shown: LandingShown }[] = [];
      // `|`, `-`: a match on a table's pipe or delimiter row, which no cell
      // paints — the whole table is marked instead. `-`, `**`, `#` and the
      // full URL: a match EQUAL to a hidden range (a bullet, an emphasis mark,
      // a heading mark, a link's whole URL) — in Reading mode nothing reveals
      // it, so its stand-in must be marked.
      for (const search of ["the", "exceptions", "x", "|", "-", "**", "#", LONG_URL]) {
        const cursor = new SearchQuery({ search, literal: true }).getCursor(base);
        let n = 0;
        for (let m = cursor.next(); !m.done; m = cursor.next()) {
          const s = step(base, { selection: EditorSelection.single(m.value.from, m.value.to), userEvent: "select.search" });
          rows.push(shown(s, `${search} #${++n} at ${m.value.from}`));
        }
        expect(n, search).toBeGreaterThan(0);
      }
      expect(notHidden(rows)).toEqual([]);
      // The long-URL match is the one this gate exists for.
      const url = DOC.indexOf("exceptions", DOC.indexOf("[Docs →]"));
      const atUrl = step(base, { selection: EditorSelection.single(url, url + "exceptions".length) });
      expect(landingShownBy(atUrl)).toBe(mode === "live" ? "revealed" : "marked");
    });
  }

  it("every Tab step through the table is shown", () => {
    let s = stateOf("live");
    const table = blockRanges(s).find((b) => b.id === "table")!;
    s = step(s, { effects: setActiveEdit.of({ tableFrom: table.from, row: 0, col: 0 }) });
    const rows = [shown(s, "enter 0:0")];
    for (let i = 0; i < 40; i++) {
      const edit = s.field(activeEditField)!;
      const model = parseTable(s.sliceDoc(table.from, table.to), table.from)!;
      const nav = tableGridNav(model, edit.row, edit.col, "next");
      if (nav.kind !== "move") break;
      s = step(s, { effects: setActiveEdit.of({ tableFrom: table.from, row: nav.row, col: nav.col }) });
      rows.push(shown(s, `tab to ${nav.row}:${nav.col}`));
    }
    expect(rows.length).toBeGreaterThan(16);
    expect(notHidden(rows)).toEqual([]);
  });

  it("an undo inside a cell is shown", () => {
    let s = stateOf("live");
    const table = blockRanges(s).find((b) => b.id === "table")!;
    s = step(s, { effects: setActiveEdit.of({ tableFrom: table.from, row: 2, col: 1 }) });
    const model = parseTable(s.sliceDoc(table.from, table.to), table.from)!;
    const change = cellEditChange(model, 2, 1, "a **THE** b")!;
    s = step(s, { changes: change, userEvent: "input.type", annotations: cellSync.of(true) });
    // Esc (R8a): leave the cell, caret on the line after the table.
    const t2 = blockRanges(s).find((b) => b.id === "table")!;
    s = step(s, { effects: setActiveEdit.of(null), selection: { anchor: lineAfterBlock(s.doc, t2.to) } });
    // Undo as the view does it: history's transaction, the R2 landing, then R2b
    // re-entering the cell the landing is in. Twice: the first undo is the Esc's
    // re-alignment (its own undo step, landing at the table's end), the second
    // the cell edit itself.
    const undoLanded = (state: EditorState): EditorState => {
      let tr: Transaction | null = null;
      undo({ state, dispatch: (t) => (tr = t) });
      expect(tr).not.toBeNull();
      const done = tr as unknown as Transaction;
      let next = withCompleteTree(done.state);
      const land = undoLandingOf(done)!;
      if (!land.keep) next = next.update({ selection: { anchor: land.pos } }).state;
      const table = blockRanges(next).find((b) => b.id === "table" && b.from <= land.pos && land.pos <= b.to);
      const entry = table ? tableEntryAt(next, table, land.pos) : null;
      return entry ? next.update(entry.spec).state : next;
    };
    const rows = [shown((s = undoLanded(s)), "undo the re-alignment"), shown((s = undoLanded(s)), "undo the cell edit")];
    expect(s.doc.toString()).toBe(DOC);
    expect(s.field(activeEditField)?.row).toBe(2);
    expect(notHidden(rows)).toEqual([]);
    expect(landingShownBy(s)).toBe("painted");
  });

  it("each navigateTo heading target is shown", () => {
    const base = stateOf("live");
    const rows: { what: string; shown: LandingShown }[] = [];
    for (let n = 1; n <= base.doc.lines; n++) {
      const line = base.doc.line(n);
      if (!line.text.startsWith("#")) continue;
      rows.push(shown(step(base, { selection: { anchor: line.from } }), line.text));
    }
    expect(rows.length).toBe(4);
    expect(notHidden(rows)).toEqual([]);
  });
});

// --- G3 ---------------------------------------------------------------------------

/** The root classes a state asks for (static records only). */
const rootClasses = (state: EditorState): string[] =>
  state
    .facet(EditorView.editorAttributes)
    .flatMap((a) => (typeof a === "function" ? [] : (a.class ?? "").split(/\s+/)))
    .filter(Boolean);

describe("G3 · no drawn caret where keys do not type", () => {
  it("Reading mode carries the no-caret marker; live and source do not", () => {
    expect(rootClasses(createEditorState({ doc: "x", mode: "reading" }))).toContain(NO_CARET_CLASS);
    expect(rootClasses(createEditorState({ doc: "x", mode: "live" }))).not.toContain(NO_CARET_CLASS);
    expect(rootClasses(createEditorState({ doc: "x", mode: "source" }))).not.toContain(NO_CARET_CLASS);
  });
});
