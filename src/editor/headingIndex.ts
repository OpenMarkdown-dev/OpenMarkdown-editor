/**
 * The ONE heading model (spec: section-write / 一个标题模型; change:
 * heading-model). Pure string functions — no CodeMirror — because the Rust
 * disk path (`src-tauri/src/section.rs`) implements the same rules and both
 * are held to `fixtures/section-write/vectors.json`.
 *
 * It defines, once:
 * - the frontmatter range (`frontmatterRange`);
 * - which lines are headings (`headingIndex`): document-level ATX headings —
 *   a `#`–`######` line with at most three leading spaces, outside fences and
 *   the frontmatter. A `#` line in a blockquote or a list item starts with `>`
 *   or a marker and is not one: those have no section an agent could write;
 * - a heading's section: to the next heading of the same or a higher level;
 * - its path (`::`-joined ancestor texts) and its anchor — the plainest query
 *   that resolves back to exactly this heading (`anchorOf`): the path, with
 *   `\` `\#` `\:` escapes where a heading's own text needs them, plus `#k`
 *   when the path alone names more than this one section (change:
 *   heading-anchors);
 * - how a query finds a heading (`resolveHeading`): a trailing `#k` is an
 *   ordinal only when the rest names several headings; otherwise the query is
 *   matched as written — exact, then case-insensitive, over the `::` path
 *   suffix; never by prefix.
 *
 * The outline panel, the palette, reveal, link navigation, heading folds,
 * get_context, the sidebar's context chip, the edit signpost and
 * read/write_section all project from here. The gate
 * `headingIndexGate.test.ts` fails heading or frontmatter detection anywhere
 * else.
 */

export interface Line {
  start: number;
  text: string;
}

export function splitLines(text: string): Line[] {
  const out: Line[] = [];
  let start = 0;
  while (start < text.length) {
    const nl = text.indexOf("\n", start);
    const end = nl === -1 ? text.length : nl;
    out.push({ start, text: text.slice(start, end) });
    start = end + 1;
  }
  return out;
}

// ---------------------------------------------------------------- frontmatter

/** A `---` fence line: exactly three dashes at column 0, then only spaces / tabs. */
export function isFenceLine(text: string): boolean {
  return text.startsWith("---") && /^[ \t]*$/.test(text.slice(3));
}

/**
 * What may follow the opening fence for the block to be frontmatter rather
 * than a thematic break: the closing fence (empty frontmatter), a YAML comment,
 * or a `key:` line — the key is anything up to the first `:`, not starting with
 * a YAML indicator, and the `:` is followed by a space, a tab or the line end.
 */
function opensYaml(text: string): boolean {
  if (isFenceLine(text)) return true;
  const t = text.replace(/^[ \t]+/, "");
  if (t.startsWith("#")) return true;
  if (t === "" || ":-".includes(t[0])) return false;
  const colon = t.indexOf(":");
  if (colon <= 0) return false;
  const after = t[colon + 1];
  return after === undefined || after === " " || after === "\t";
}

export interface FrontmatterRange {
  /** Always 0: frontmatter only ever opens the document. */
  from: number;
  /** End of the closing fence line (its newline excluded). */
  to: number;
  /** Where the body starts: after the closing fence's newline. */
  bodyFrom: number;
  /** 1-based line of the closing fence. */
  closeLine: number;
}

/**
 * The leading YAML frontmatter of `text` (already decoded: CRLF folded, BOM
 * stripped — both disk decoders do that first), or null. Frontmatter is: line
 * 1 a `---` fence, line 2 opening YAML (see `opensYaml`), and a closing `---`
 * fence somewhere below. Unclosed is NOT frontmatter: the `---` is a thematic
 * break and the lines below are ordinary markdown, as on GitHub.
 */
export function frontmatterRange(text: string): FrontmatterRange | null {
  const first = text.indexOf("\n");
  if (first === -1 || !isFenceLine(text.slice(0, first))) return null;
  const secondEnd = text.indexOf("\n", first + 1);
  if (!opensYaml(text.slice(first + 1, secondEnd === -1 ? text.length : secondEnd))) return null;
  let start = first + 1;
  for (let line = 2; start <= text.length; line++) {
    const nl = text.indexOf("\n", start);
    const end = nl === -1 ? text.length : nl;
    if (isFenceLine(text.slice(start, end))) {
      return { from: 0, to: end, bodyFrom: Math.min(end + 1, text.length), closeLine: line };
    }
    if (nl === -1) break;
    start = nl + 1;
  }
  return null;
}

// ------------------------------------------------------------------- headings

export interface Heading {
  /** Heading text without the `#` markers or a closing sequence. */
  text: string;
  /** 1–6. */
  level: number;
  /** The `::` join of the ancestor texts and this one, unescaped (for display; query with `anchor`). */
  path: string;
  /** `path`'s segments. */
  segments: string[];
  /**
   * The plainest query that resolves to exactly this heading (see `anchorOf`),
   * or null for a heading with no text (`#` alone): it names nothing.
   */
  anchor: string | null;
  /** 1-based line of the heading, and of the section's last line (inclusive). */
  fromLine: number;
  toLine: number;
  /** Offset of the heading line start. */
  from: number;
  /** Offset right after the heading line's newline (the body start). */
  bodyFrom: number;
  /** Offset of the section end: the next heading of level ≤ own, or the end. */
  to: number;
}

const ATX = /^ {0,3}(#{1,6})(?:[ \t].*)?$/;
const FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})(.*)$/;
const FENCE_CLOSE = /^ {0,3}(`{3,}|~{3,})[ \t]*$/;

/** Strip the leading markers and an optional closing `#` sequence. */
function headingText(lineText: string): string {
  return lineText
    .replace(/^ {0,3}#{1,6}[ \t]*/, "")
    .replace(/[ \t]+#+[ \t]*$/, "")
    .trim();
}

let memo: { text: string; index: Heading[] } | null = null;

/** Every heading of `text`, in document order, with its section, path and anchor. */
export function headingIndex(text: string): Heading[] {
  if (memo && memo.text === text) return memo.index;
  const lines = splitLines(text);
  const fm = frontmatterRange(text);
  const skip = fm ? fm.closeLine : 0;

  interface Head {
    level: number;
    text: string;
    line: number;
    start: number;
    bodyFrom: number;
  }
  const heads: Head[] = [];
  let fence: { ch: string; len: number } | null = null;
  for (let i = skip; i < lines.length; i++) {
    const line = lines[i];
    if (fence) {
      const close = FENCE_CLOSE.exec(line.text);
      if (close && close[1][0] === fence.ch && close[1].length >= fence.len) fence = null;
      continue;
    }
    const open = FENCE_OPEN.exec(line.text);
    // A backtick fence's info string may not contain backticks (CommonMark).
    if (open && !(open[1][0] === "`" && open[2].includes("`"))) {
      fence = { ch: open[1][0], len: open[1].length };
      continue;
    }
    const atx = ATX.exec(line.text);
    if (atx) {
      heads.push({
        level: atx[1].length,
        text: headingText(line.text),
        line: i + 1,
        start: line.start,
        bodyFrom: Math.min(line.start + line.text.length + 1, text.length),
      });
    }
  }

  const index: Heading[] = [];
  const stack: Head[] = [];
  heads.forEach((head, i) => {
    while (stack.length > 0 && stack[stack.length - 1].level >= head.level) stack.pop();
    stack.push(head);
    let to = text.length;
    let toLine = lines.length;
    for (let j = i + 1; j < heads.length; j++) {
      if (heads[j].level <= head.level) {
        to = heads[j].start;
        toLine = heads[j].line - 1;
        break;
      }
    }
    const segments = stack.map((s) => s.text);
    const path = segments.join(SEP);
    index.push({ text: head.text, level: head.level, path, segments, anchor: null, fromLine: head.line, toLine, from: head.start, bodyFrom: head.bodyFrom, to });
  });
  for (const h of index) h.anchor = anchorOf(index, h);
  memo = { text, index };
  return index;
}

// -------------------------------------------------------------------- anchors
//
// A query is `::`-separated segments. Inside a segment `\\`, `\#` and `\:` stand
// for a literal `\`, `#` and `:` (so a heading's own `::` is written `\::`); any
// other `\` is itself. An unescaped `::` separates segments. See
// `escapeSegment` for the one writer, `splitQuery` / `unescape` for the reader.

const SEP = "::";

/**
 * A heading text written as one query segment that reads back as exactly that
 * text: `\` → `\\`, `#` → `\#`, and a `:` that is followed by another `:` or
 * sits at either end of the text → `\:` (so no unescaped `::` can form inside
 * the segment or across a separator next to it). The text `a::b` is `a\::b`.
 */
export function escapeSegment(text: string): string {
  let out = "";
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === "\\" || c === "#") out += "\\" + c;
    else if (c === ":" && (i === 0 || i === text.length - 1 || text[i + 1] === ":")) out += "\\:";
    else out += c;
  }
  return out;
}

/** The raw segments of a query: split on unescaped `::`, each trimmed, empty ones at either end dropped. */
function splitQuery(query: string): string[] {
  const raw: string[] = [];
  let cur = "";
  for (let i = 0; i < query.length; i++) {
    const c = query[i];
    if (c === "\\" && i + 1 < query.length) {
      cur += c + query[i + 1];
      i++;
    } else if (c === ":" && query[i + 1] === ":") {
      raw.push(cur);
      cur = "";
      i++;
    } else cur += c;
  }
  raw.push(cur);
  const segs = raw.map((s) => s.trim());
  while (segs.length > 0 && segs[0] === "") segs.shift();
  while (segs.length > 0 && segs[segs.length - 1] === "") segs.pop();
  return segs;
}

/**
 * A heading text as a one-segment query that is read literally in any
 * document — the form a `#heading` link stores: the text itself when it needs
 * no escape and cannot be taken for an ordinal, else `escapeSegment(text)`.
 */
export function segmentQuery(text: string): string {
  const raws = splitQuery(text);
  const plain = raws.length === 1 && raws[0] === text && unescape(text) === text && !ordinalOf(raws);
  return plain ? text : escapeSegment(text);
}

/** A raw segment's text: `\\` `\#` `\:` unescaped, any other `\` kept. */
function unescape(raw: string): string {
  let out = "";
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i];
    const next = raw[i + 1];
    if (c === "\\" && (next === "\\" || next === "#" || next === ":")) {
      out += next;
      i++;
    } else out += c;
  }
  return out;
}

/**
 * A trailing ordinal on the last raw segment: `<base>#<digits>` where the `#`
 * is not escaped and the base is non-empty and does not end in whitespace.
 * Returns the raw segments with the ordinal cut off, and k.
 */
function ordinalOf(raws: string[]): { base: string[]; k: number } | null {
  const last = raws[raws.length - 1];
  const m = /^(.*\S)#(\d+)$/.exec(last);
  if (!m) return null;
  let slashes = 0;
  while (slashes < m[1].length && m[1][m[1].length - 1 - slashes] === "\\") slashes++;
  if (slashes % 2 === 1) return null;
  return { base: [...raws.slice(0, -1), m[1]], k: Number(m[2]) };
}

/** Exact suffix matches by key, built once per index. */
const exactByIndex = new WeakMap<Heading[], Map<string, Heading[]>>();
const KEY = "\u0000";

function exactSuffixes(index: Heading[]): Map<string, Heading[]> {
  let map = exactByIndex.get(index);
  if (!map) {
    map = new Map();
    for (const h of index) {
      for (let n = 1; n <= h.segments.length; n++) {
        const key = h.segments.slice(h.segments.length - n).join(KEY);
        const list = map.get(key);
        if (list) list.push(h);
        else map.set(key, [h]);
      }
    }
    exactByIndex.set(index, map);
  }
  return map;
}

/** Headings whose path ends with `segs`: exact first, else case-insensitive. */
function matches(index: Heading[], segs: string[]): Heading[] {
  const exact = exactSuffixes(index).get(segs.join(KEY));
  if (exact) return exact;
  const fold = segs.map((s) => s.toLowerCase());
  return index.filter((h) => {
    if (fold.length > h.segments.length) return false;
    const tail = h.segments.slice(h.segments.length - fold.length);
    return fold.every((q, i) => q === tail[i].toLowerCase());
  });
}

export type HeadingHit =
  | { kind: "hit"; heading: Heading }
  | { kind: "ambiguous"; candidates: Heading[] }
  | { kind: "notFound" };

/**
 * Find the heading a query names (spec: section-write / 标题锚定与消歧). In order:
 *
 * 1. Split the trimmed query on unescaped `::` (empty segments at either end
 *    dropped; none left → not found).
 * 2. If the last segment ends in an unescaped `#<digits>` after a non-blank
 *    base, and the base matches MORE THAN ONE heading, `#k` is an ordinal: the
 *    k-th of those in document order, or not found when k is out of range.
 * 3. Otherwise the whole query is matched as written (`#k` included).
 *
 * "Matches" is always: the unescaped segments equal the end of a heading's
 * path, exact; when nothing matches exactly, case-insensitive; never by
 * prefix. One match is a hit; several are ambiguous (each candidate's anchor
 * resolves uniquely). What a caller does with `ambiguous` is its own policy: a
 * write refuses, a scroll takes the first.
 */
export function resolveHeading(index: Heading[], query: string): HeadingHit {
  const raws = splitQuery(query.trim());
  if (raws.length === 0) return { kind: "notFound" };
  let hits: Heading[] | null = null;
  const ord = ordinalOf(raws);
  if (ord) {
    const base = matches(index, ord.base.map(unescape));
    if (base.length > 1) hits = ord.k >= 1 && ord.k <= base.length ? [base[ord.k - 1]] : [];
  }
  hits ??= matches(index, raws.map(unescape));
  if (hits.length === 0) return { kind: "notFound" };
  if (hits.length > 1) return { kind: "ambiguous", candidates: hits };
  return { kind: "hit", heading: hits[0] };
}

function resolvesTo(index: Heading[], query: string, h: Heading): boolean {
  const hit = resolveHeading(index, query);
  return hit.kind === "hit" && hit.heading === h;
}

/**
 * A heading's anchor: the plainest query that resolves to exactly it — the
 * first of: the path as is; the path with each segment escaped; the path as is
 * plus `#k`; the escaped path plus `#k` (k = its place among the matches of
 * that path). The last always resolves for a heading with text (round-trip
 * invariant, asserted here in dev and over the shared vectors in tests). A
 * heading with no text names nothing (no query can end in an empty segment):
 * null — it is never reported, listed or offered as a candidate.
 */
function anchorOf(index: Heading[], h: Heading): string | null {
  if (h.text === "") return null;
  const escaped = h.segments.map(escapeSegment).join(SEP);
  for (const base of [h.path, escaped]) if (resolvesTo(index, base, h)) return base;
  let last = escaped;
  for (const base of [h.path, escaped]) {
    const raws = splitQuery(base);
    if (raws.length === 0) continue;
    const k = matches(index, raws.map(unescape)).indexOf(h) + 1;
    if (k === 0) continue;
    last = ordinal(base, k);
    if (resolvesTo(index, last, h)) return last;
  }
  if (import.meta.env?.DEV) throw new Error(`heading anchor does not round-trip: ${JSON.stringify(h.path)} → ${JSON.stringify(last)}`);
  return last;
}

/** `base` plus the ordinal `#k`. The one place an anchor's ordinal is written. */
function ordinal(base: string, k: number): string {
  return `${base}#${k}`;
}

/** The heading whose line is at or above `pos` — "the section `pos` is in" — or null. */
export function headingAt(index: Heading[], pos: number): Heading | null {
  let hit: Heading | null = null;
  for (const h of index) {
    if (h.from <= pos) hit = h;
    else break;
  }
  return hit;
}
