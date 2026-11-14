import { frontmatterRange } from "./headingIndex";
/**
 * Frontmatter → Properties rows (change: properties-block, design D1; spec:
 * live-preview-editor / Properties 块).
 *
 * NOT a YAML parser. What the Properties block needs is not YAML's VALUES but
 * WHERE each top-level single-line property's name and value sit in the file, so
 * an edit replaces exactly those bytes and nothing else (spec: 只改动到的字节).
 * A line scanner gives that with no dependency. It is deliberately conservative:
 * anything it cannot place with certainty is either a read-only row or — if the
 * block's shape is off — a parse failure, and the block then shows as source.
 *
 * It is also the one WRITING of a property (change: write-back-valid):
 * `writeScalar` produces the YAML for every name and value the editor writes,
 * and `readScalar` — which `parseProps` reads names and values through — is its
 * inverse. Reader and writer live together and are tested as a pair (the
 * round-trip table in `frontmatterProps.test.ts`).
 * Pure: no EditorView, unit-tested in node (CLAUDE.md).
 */

export interface Prop {
  /** The name's text: decoded (`readScalar`) when it was quoted. */
  key: string;
  /** The name's bytes, between its quotes when quoted. */
  keyFrom: number;
  keyTo: number;
  /** Quote style the name was written with. */
  keyQuote: QuoteStyle;
  /**
   * The value's text — decoded (`readScalar`) when it was quoted; "" when
   * absent. For a read-only row it is the value as written.
   */
  value: string;
  /** The value's bytes, between its quotes when quoted. */
  valueFrom: number;
  valueTo: number;
  /** Quote style the value was written with (null for a read-only row). */
  quote: QuoteStyle;
  /** Can be edited in place (a single-line value). */
  editable: boolean;
  /** Document range of every line the property occupies (for delete). */
  linesFrom: number;
  linesTo: number;
}

export interface ParsedProps {
  /** Doc offset of the opening `---` line and the end of the closing one. */
  from: number;
  to: number;
  /** Start of the closing `---` line — where a new property is inserted. */
  closeFrom: number;
  props: Prop[];
}

/**
 * A top-level `name:` — the name is whatever precedes the first `:` that is
 * followed by a space or the line end. YAML allows any text there (Chinese,
 * spaces), and `作者: 张三` is common in the frontmatter of Chinese notes; an
 * ASCII-only rule sent such blocks straight to source. The name must not start
 * with a YAML indicator (`- ` list item, `#`, quotes, flow brackets, …).
 * A quoted name (`"a: b":`) is read by `readName`, not by this pattern.
 */
const KEY = /^([^\s#\-?:,[\]{}&*!|>'"%@`][^:]*?|-[^\s:][^:]*?)(\s*):(?=\s|$)/;

/**
 * Parse the frontmatter at the very start of `doc`, or null when there is none
 * or its shape is not one we can edit safely. `doc` is the whole document text.
 */
export function parseProps(doc: string): ParsedProps | null {
  // WHERE the frontmatter is comes from the one rule (change: heading-model);
  // this function only decides whether its shape is one we can edit.
  const range = frontmatterRange(doc);
  if (!range) return null;
  const lines = doc.split("\n");
  const close = range.closeLine - 1;

  const starts: number[] = [];
  let pos = 0;
  for (const l of lines) {
    starts.push(pos);
    pos += l.length + 1;
  }

  const props: Prop[] = [];
  let current: Prop | null = null;
  for (let i = 1; i < close; i++) {
    const text = lines[i];
    const lineFrom = starts[i];
    const lineTo = lineFrom + text.length;
    if (text.trim() === "" || /^\s*#/.test(text)) {
      // Blank / comment lines are kept in the file but are not rows. A blank or
      // comment INSIDE an indented continuation does not end it.
      continue;
    }
    if (/^\s/.test(text)) {
      // Indented: only meaningful as the continuation of the property above
      // (block scalar, nested map, block list). Anywhere else the shape is off.
      if (!current) return null;
      current.editable = false;
      current.linesTo = lineTo;
      continue;
    }
    const name = readName(text);
    if (!name) return null; // a top-level line that is not `key:` — not ours to guess at
    const rest = text.slice(name.end);
    const lead = rest.length - rest.trimStart().length;
    const valueStart = lineFrom + name.end + lead;
    const body = rest.trim();
    const prop: Prop = {
      key: name.text,
      keyFrom: lineFrom + name.from,
      keyTo: lineFrom + name.to,
      keyQuote: name.style,
      value: "",
      valueFrom: valueStart,
      valueTo: valueStart,
      quote: null,
      editable: true,
      linesFrom: lineFrom,
      linesTo: lineTo,
    };
    if (body === "") {
      // `key:` with nothing after: an empty value, or the head of an indented
      // block below (decided by the next lines). An empty value is edited by
      // writing after `key: `, so valueFrom sits after a single space we add.
      prop.valueFrom = prop.valueTo = lineTo;
    } else if (/^[|>]/.test(body) || /^[&*!]/.test(body) || body.startsWith("{")) {
      // Block scalar head, anchor, alias, tag, flow map: show, don't edit.
      prop.editable = false;
      prop.value = body;
      prop.valueTo = valueStart + body.length;
    } else if (body[0] === '"' || body[0] === "'") {
      const q = body[0] as '"' | "'";
      const end = closingQuote(body, q);
      if (end === -1) return null; // unterminated quote on one line — not ours
      const after = body.slice(end + 1).trim();
      if (after !== "" && !after.startsWith("#")) return null;
      const read = readScalar(body.slice(0, end + 1));
      if (read) {
        prop.quote = q;
        prop.valueFrom = valueStart + 1;
        prop.valueTo = valueStart + end;
        prop.value = read.text;
      } else {
        // An escape a one-line editor cannot round-trip (`\n`, `\t`, …): shown
        // as written, edited through 按源码编辑 (design D3).
        prop.editable = false;
        prop.value = body.slice(0, end + 1);
        prop.valueTo = valueStart + end + 1;
      }
    } else {
      // Plain scalar or inline list; a ` #` starts a trailing comment.
      const hash = body.search(/\s#/);
      const v = hash === -1 ? body : body.slice(0, hash).trimEnd();
      prop.value = v;
      prop.valueTo = valueStart + v.length;
    }
    props.push(prop);
    current = prop;
  }
  return { from: 0, to: starts[close] + lines[close].length, closeFrom: starts[close], props };
}

/**
 * The name at the start of a top-level line: its decoded text, its bytes
 * (between the quotes when quoted) and where the line continues after the `:`.
 * Null when the line does not start with a name YAML would read as one: a
 * plain name holding ` #` is a name cut short by a comment.
 */
function readName(line: string): { text: string; style: QuoteStyle; from: number; to: number; end: number } | null {
  const q = line[0];
  if (q === '"' || q === "'") {
    const close = closingQuote(line, q);
    if (close === -1) return null;
    const colon = /^\s*:(?=\s|$)/.exec(line.slice(close + 1));
    const read = colon && readScalar(line.slice(0, close + 1));
    if (!colon || !read) return null;
    return { text: read.text, style: q, from: 1, to: close, end: close + 1 + colon[0].length };
  }
  const m = KEY.exec(line);
  if (!m || /\s#/.test(m[1])) return null;
  return { text: m[1], style: null, from: 0, to: m[1].length, end: m[0].length };
}

/** Index of the quote closing a quoted scalar that starts at body[0], or -1. */
function closingQuote(body: string, q: '"' | "'"): number {
  for (let i = 1; i < body.length; i++) {
    if (q === '"' && body[i] === "\\") {
      i++;
      continue;
    }
    if (body[i] === q) {
      if (q === "'" && body[i + 1] === "'") {
        i++; // '' is an escaped single quote
        continue;
      }
      return i;
    }
  }
  return -1;
}

// --- the one writing (spec: frontmatter 的属性只有一个写法) ------------------------

/** How a name or value is written: double-quoted, single-quoted, or bare (plain). */
export type QuoteStyle = '"' | "'" | null;

/**
 * The YAML text for one property name (`role` "key") or value (`role` "value"),
 * the ONE writing of a property (change: write-back-valid, design D1). Every
 * name and value the editor writes into frontmatter comes from here, so the
 * file is valid YAML after every keystroke, and `readScalar` is its inverse:
 * `readScalar(writeScalar(t, r, s)).text === t` for any one-line `t`.
 *
 * - `'"'` writes `"…"`, escaping `\` and `"` (and, outside the one-line domain,
 *   a line break as `\n` so the line stays one line);
 * - `"'"` writes `'…'`, doubling `'`;
 * - `null` writes the text bare when YAML reads it back as the same string
 *   (`plainSafe`), and `"…"` otherwise.
 *
 * Never quotes for TYPE (design D4): `true`, `42` and `[a, b]` typed bare stay
 * bare, exactly as an author would write them by hand.
 */
export function writeScalar(text: string, role: "key" | "value", style: QuoteStyle): string {
  if (style === "'" && !/[\n\r]/.test(text)) return `'${text.replace(/'/g, "''")}'`;
  if (style === null && plainSafe(text, role)) return text;
  const body = text.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n").replace(/\r/g, "\\r");
  return `"${body}"`;
}

/** The line a new, empty property named `name` is written as (「+ 添加属性」 / 「添加属性」). */
export function newPropertyLine(name: string): string {
  return `${writeScalar(name, "key", null)}: \n`;
}

/**
 * The text and quote style of one written name or value — the inverse of
 * `writeScalar`. Null for a quoted scalar this one-line editor cannot
 * round-trip: unterminated, or a double-quoted body with any escape other than
 * `\"` and `\\` (`\n`, `\t`, `\u…`; design D3). Such a value is read-only.
 */
export function readScalar(written: string): { text: string; style: QuoteStyle } | null {
  const q = written[0];
  if (q !== '"' && q !== "'") return { text: written, style: null };
  if (written.length < 2 || closingQuote(written, q) !== written.length - 1) return null;
  const body = written.slice(1, -1);
  if (q === "'") return { text: body.replace(/''/g, "'"), style: "'" };
  let text = "";
  for (let i = 0; i < body.length; i++) {
    if (body[i] !== "\\") {
      text += body[i];
      continue;
    }
    const next = body[i + 1];
    if (next !== '"' && next !== "\\") return null;
    text += next;
    i++;
  }
  return { text, style: '"' };
}

/**
 * Is `inner` (a `[...]` value without its brackets, already free of `[]{}"'#`)
 * a flat list of plain items, so `[inner]` reads back as that list? `[]` is the
 * empty list. Every item, trimmed, must be non-empty, must not start with a
 * YAML indicator (`-x` is plain, `-` / `- x` are not) and must not end with `:`
 * or hold `: ` (both make a mapping). Anything else is quoted whole.
 */
function flatListSafe(inner: string): boolean {
  if (inner.trim() === "") return true;
  return inner.split(",").every((raw) => {
    const item = raw.trim();
    if (item === "" || /:$|:\s/.test(item)) return false;
    if (/^-(\s|$)/.test(item)) return false;
    return !/^[?:,&*!|>%@`]/.test(item);
  });
}

/**
 * Would `text`, written bare as a name (`key: …`) or a value (`… : text`), read
 * back — by YAML and by `parseProps` — as exactly this one-line string?
 * Conservative: false for anything YAML gives meaning to. A value that is a
 * flat inline list (`[a, b]`) stays bare on purpose: it is a list (design D4).
 */
function plainSafe(text: string, role: "key" | "value"): boolean {
  if (text === "") return role === "value"; // an empty value is `key:`; an empty name needs `""`
  if (text !== text.trim() || /[\n\r]/.test(text)) return false;
  if (/:\s|\s#|:$/.test(text)) return false;
  // `-` starts a list item only before a space or the end; `-dash` is plain.
  if (/^-(\s|$)/.test(text)) return false;
  if (role === "key") return !/[#:]/.test(text) && !/^[?:,[\]{}&*!|>'"%@`]/.test(text);
  if (/^\[[^[\]{}"'#]*\]$/.test(text)) return flatListSafe(text.slice(1, -1));
  return !/^[#?:,[\]{}&*!|>'"%@`]/.test(text);
}
