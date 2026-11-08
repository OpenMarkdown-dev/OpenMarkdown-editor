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
 * Pure: no EditorView, unit-tested in node (CLAUDE.md).
 */

export interface Prop {
  /** The name as written (without quotes when it was quoted). */
  key: string;
  keyFrom: number;
  keyTo: number;
  /** The value as written, between its quotes when quoted; "" when absent. */
  value: string;
  valueFrom: number;
  valueTo: number;
  /** Quote style the value was written with. */
  quote: '"' | "'" | null;
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
    const m = KEY.exec(text);
    if (!m) return null; // a top-level line that is not `key:` — not ours to guess at
    const key = m[1];
    const keyFrom = lineFrom;
    const keyTo = lineFrom + key.length;
    const rest = text.slice(m[0].length);
    const lead = rest.length - rest.trimStart().length;
    const valueStart = lineFrom + m[0].length + lead;
    const body = rest.trim();
    const prop: Prop = {
      key,
      keyFrom,
      keyTo,
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
      prop.quote = q;
      prop.valueFrom = valueStart + 1;
      prop.valueTo = valueStart + end;
      prop.value = body.slice(1, end);
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

/**
 * What to write for an edited value when its edit ends (spec: 值需要引号时只给它
 * 加引号). Quoted values keep their quote style with the needed escapes; a plain
 * value that would no longer read back as the same plain scalar gets double
 * quotes. Returns the replacement for the value's WHOLE written span (quotes
 * included) and whether anything changed.
 */
export function finalizeValue(value: string, quote: '"' | "'" | null): string {
  // Existing escapes (`\n`, `\"`) are the author's and stay; only a bare `"`
  // typed into the value is escaped.
  if (quote === '"') return `"${value.replace(/(?<!\\)"/g, '\\"')}"`;
  // `''` is already an escaped quote; a lone `'` becomes one.
  if (quote === "'") return `'${value.replace(/''|'/g, "''")}'`;
  return needsQuotes(value) ? `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"` : value;
}

/**
 * Would this text, written bare after `key: `, read back as something other than
 * the same one-line string? Conservative: true for anything YAML gives meaning to.
 * An inline list (`[a, b]`) is left alone — it is a list on purpose.
 */
export function needsQuotes(v: string): boolean {
  if (v === "") return false;
  if (/^\[.*\]$/.test(v)) return false;
  if (v !== v.trim()) return true;
  if (/^[-?:,\[\]{}#&*!|>'"%@`]/.test(v)) return true;
  return /:\s|\s#|:$/.test(v);
}
