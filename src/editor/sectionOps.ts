/**
 * Section-level read/write on plain markdown text (spec: section-write).
 *
 * Pure string functions — no CodeMirror imports — so vitest can assert the
 * shared vectors in `fixtures/section-write/` (the arbitration source this
 * implementation and the Rust mirror `src-tauri/src/section.rs` must both
 * satisfy). The algorithm is deliberately identical on both sides: a
 * fence/frontmatter-aware ATX line scan, NOT the Lezer tree — Lezer also
 * yields headings inside blockquotes/lists and knows no YAML frontmatter,
 * neither of which may anchor a write (design D1/D3). Everything here is
 * synchronous, so the bridge can verify-compute-dispatch in one JS task
 * (design D4 re-verify invariant). Which lines are headings, where sections
 * end, paths, anchors and matching all come from the one heading model
 * (`headingIndex.ts`; change: heading-model).
 */

import { frontmatterRange, headingIndex, resolveHeading, splitLines, type Heading } from "./headingIndex";

/** A section is a heading of the one heading model (`headingIndex.ts`). */
export type Section = Heading;

export type WriteOperation = "append" | "prepend" | "replace";

export interface WriteArgs {
  heading?: string;
  operation: string;
  content: string;
  baseHash?: string;
}

export interface WritePlan {
  from: number;
  to: number;
  insert: string;
}

export type WriteResult =
  | {
      ok: true;
      plan: WritePlan;
      newText: string;
      /** Absent when the written content itself re-anchors ambiguously. */
      newBaseHash?: string;
    }
  | { ok: false; code: string; params: Record<string, string> };

export type ReadResult =
  | {
      ok: true;
      content: string;
      baseHash: string;
      range?: { fromLine: number; toLine: number };
      outline?: string[];
    }
  | { ok: false; code: string; params: Record<string, string> };

/** Mirror of the document store's normalization (content fidelity). */
export function normalizeEol(raw: string): string {
  return raw.includes("\r\n") ? raw.replaceAll("\r\n", "\n") : raw;
}

/**
 * FNV-1a 64 over UTF-8 bytes, lowercase hex, 16 digits. Opaque token on the
 * wire (design D2: the spec promises no algorithm); shared vectors pin the
 * TS/Rust pair to identical output.
 */
export function fnv1a64(text: string): string {
  const PRIME = 0x100000001b3n;
  const MASK = 0xffffffffffffffffn;
  let hash = 0xcbf29ce484222325n;
  for (const byte of new TextEncoder().encode(text)) {
    hash ^= BigInt(byte);
    hash = (hash * PRIME) & MASK;
  }
  return hash.toString(16).padStart(16, "0");
}

/** Char offset where document-level content starts (after frontmatter). */
export function bodyStart(text: string): number {
  return frontmatterRange(text)?.bodyFrom ?? 0;
}

/** Every section of `text` — the heading index (spec: 一个标题模型). */
export function parseSections(text: string): Section[] {
  return headingIndex(text);
}

type AnchorHit =
  | { kind: "hit"; section: Section }
  | { kind: "ambiguous"; candidates: string[] }
  | { kind: "notFound" };

/**
 * Anchor resolution — the heading model's (`resolveHeading`); a write never
 * guesses, so several matches are refused with every candidate's anchor.
 */
function resolveAnchor(sections: Section[], query: string): AnchorHit {
  const hit = resolveHeading(sections, query);
  if (hit.kind === "hit") return { kind: "hit", section: hit.heading };
  // A candidate always has text (it matched a non-empty last segment), so an anchor.
  if (hit.kind === "ambiguous") return { kind: "ambiguous", candidates: hit.candidates.map((h) => h.anchor!) };
  return { kind: "notFound" };
}

function trailingNewlines(s: string): number {
  let n = 0;
  while (n < s.length && s[s.length - 1 - n] === "\n") n++;
  return n;
}

function leadingNewlines(s: string): number {
  let n = 0;
  while (n < s.length && s[n] === "\n") n++;
  return n;
}

function isBlank(lineText: string): boolean {
  return lineText.trim().length === 0;
}

/** Offset after the last non-blank line inside [from,to) — or `from`. */
function appendAt(text: string, from: number, to: number): number {
  const region = splitLines(text.slice(from, to));
  for (let i = region.length - 1; i >= 0; i--) {
    if (!isBlank(region[i].text)) {
      return Math.min(from + region[i].start + region[i].text.length + 1, to);
    }
  }
  return from;
}

/** Offset of the first non-blank line inside [from,to) — or `from`. */
function prependAt(text: string, from: number, to: number): number {
  const region = splitLines(text.slice(from, to));
  for (const line of region) {
    if (!isBlank(line.text)) return from + line.start;
  }
  return from;
}

/**
 * Separator rule (design open question 2, pinned by the vectors): one blank
 * line between the block and existing content on each side; the block always
 * ends its line. Blocks arrive stripped of leading/trailing newline runs.
 */
function insertionBetween(before: string, after: string, block: string): string {
  const sepBefore =
    before.length === 0 ? "" : "\n".repeat(Math.max(0, 2 - trailingNewlines(before)));
  const sepAfter =
    after.length === 0 ? "\n" : "\n".repeat(Math.max(1, 2 - leadingNewlines(after)));
  return sepBefore + block + sepAfter;
}

function err(code: string, params: Record<string, string> = {}): {
  ok: false;
  code: string;
  params: Record<string, string>;
} {
  return { ok: false, code, params };
}

/**
 * Section read (spec: 节级读). No heading = document level: outline (every
 * section's anchor, directly usable as the heading), whole content, whole-text hash.
 */
export function readSection(text: string, heading?: string): ReadResult {
  const sections = parseSections(text);
  if (heading === undefined || heading.trim() === "") {
    return {
      ok: true,
      // Every entry reads back its section; a heading with no text names nothing.
      outline: sections.flatMap((s) => (s.anchor === null ? [] : [s.anchor])),
      content: text,
      baseHash: fnv1a64(text),
    };
  }
  const hit = resolveAnchor(sections, heading);
  if (hit.kind === "notFound") return err("NOT_FOUND", { heading });
  if (hit.kind === "ambiguous") {
    return err("AMBIGUOUS_HEADING", { candidates: JSON.stringify(hit.candidates) });
  }
  const sec = hit.section;
  const content = text.slice(sec.from, sec.to);
  return {
    ok: true,
    content,
    baseHash: fnv1a64(content),
    range: { fromLine: sec.fromLine, toLine: sec.toLine },
  };
}

/**
 * Plan a section write against normalized text (spec: 写操作语义 / 乐观并发).
 * Returns the precise change for a CM6 dispatch plus the resulting text —
 * pure computation, no side effects; both the live-buffer and the disk path
 * consume the plan.
 */
export function planWrite(text: string, args: WriteArgs): WriteResult {
  const { heading, operation, baseHash } = args;
  if (operation !== "append" && operation !== "prepend" && operation !== "replace") {
    return err("INVALID_ARGS", { detail: `unknown operation: ${operation}` });
  }

  // Leading/trailing newline runs are separator territory (insertionBetween
  // owns them); internal structure passes through verbatim.
  const block = normalizeEol(args.content).replace(/^\n+/, "").replace(/\n+$/, "");
  if (block === "" && operation !== "replace") {
    return err("INVALID_ARGS", { detail: "content is empty" });
  }

  const sections = parseSections(text);
  let region: { from: number; to: number };
  let hashRegion: { from: number; to: number };
  let anchor: string | undefined;

  if (heading === undefined || heading.trim() === "") {
    // Document-level anchor: whole-file replace is exactly the shape this
    // capability exists to eliminate (spec: 文档级 replace 被拒绝).
    if (operation === "replace") {
      return err("INVALID_ARGS", { detail: "document-level replace is not allowed" });
    }
    region = { from: bodyStart(text), to: text.length };
    hashRegion = { from: 0, to: text.length };
  } else {
    const hit = resolveAnchor(sections, heading);
    if (hit.kind === "notFound") return err("NOT_FOUND", { heading });
    if (hit.kind === "ambiguous") {
      return err("AMBIGUOUS_HEADING", { candidates: JSON.stringify(hit.candidates) });
    }
    anchor = heading;
    region = { from: hit.section.bodyFrom, to: hit.section.to };
    hashRegion = { from: hit.section.from, to: hit.section.to };
  }

  if (operation === "replace" && !baseHash) {
    return err("INVALID_ARGS", { detail: "replace requires baseHash" });
  }
  if (baseHash) {
    const current = text.slice(hashRegion.from, hashRegion.to);
    const currentHash = fnv1a64(current);
    if (currentHash !== baseHash) {
      return err("CONFLICT", { content: current, baseHash: currentHash });
    }
  }

  let plan: WritePlan;
  if (operation === "replace") {
    const insert =
      block === ""
        ? ""
        : insertionBetween(text.slice(0, region.from), text.slice(region.to), block);
    plan = { from: region.from, to: region.to, insert };
  } else {
    const at =
      operation === "append"
        ? appendAt(text, region.from, region.to)
        : prependAt(text, region.from, region.to);
    plan = {
      from: at,
      to: at,
      insert: insertionBetween(text.slice(0, at), text.slice(at), block),
    };
  }

  const newText = text.slice(0, plan.from) + plan.insert + text.slice(plan.to);

  // Re-anchor in the result for the fresh token; written content may itself
  // introduce a colliding heading — then no honest hash exists and the agent
  // re-reads (returning a wrong-region hash would be worse than none).
  let newBaseHash: string | undefined;
  if (anchor === undefined) {
    newBaseHash = fnv1a64(newText);
  } else {
    const reHit = resolveAnchor(parseSections(newText), anchor);
    if (reHit.kind === "hit") {
      newBaseHash = fnv1a64(newText.slice(reHit.section.from, reHit.section.to));
    }
  }
  return { ok: true, plan, newText, newBaseHash };
}
