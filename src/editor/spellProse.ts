import type { EditorState } from "@codemirror/state";
import type { SyntaxNode } from "@lezer/common";
import { progressiveTree } from "./syntax";

/**
 * WHICH TEXT IS PROSE — the one place that decides what the spell checker sees
 * (spec: spellcheck / 只查正文,判定只在一处; change `spellcheck`, design D3).
 * Read from the syntax tree only (`syntax.ts`); used by the red-line module
 * (`spellcheck.ts`) alone — `spellcheck.gate.test.ts` (S4) fails any other
 * importer, and any node name of these tables spelled out in that module or in
 * the front door (`lib/spell.ts`).
 *
 * A unit is one prose block (a paragraph, a heading, a task item's text), sent
 * whole: the system checker identifies the language per paragraph, so the unit
 * IS a paragraph, soft-wrapped lines included. Inside it, every non-prose span
 * is blanked to spaces (line breaks kept) rather than cut out: offsets stay
 * the block's own, and a URL or a code span never sways the language guess.
 * Markup punctuation (`**`, `#`, `[`) stays — the checker skips punctuation.
 */

/**
 * Prose blocks are the grammar's LEAF blocks — the blocks that hold inline text
 * (paragraphs, headings, a task item's text) — minus the non-prose ones below.
 * Asked through the grammar's own node group rather than a list of names, so a
 * leaf block a dialect adds is prose unless it is named non-prose here (and
 * which lines are headings stays the heading model's business, gate #14).
 */
const LEAF_BLOCK = "LeafBlock";

/**
 * Blocks nothing inside of which is checked. `Table` is here because the outer
 * document never checks a table: its cells are drawn by the table widget, and a
 * cell being edited is a nested editor that checks itself (see `proseContextAt`).
 */
export const NON_PROSE_BLOCKS: ReadonlySet<string> = new Set([
  "FencedCode",
  "CodeBlock",
  "HTMLBlock",
  "CommentBlock",
  "ProcessingInstructionBlock",
  "BlockMath",
  "Frontmatter",
  "LinkReference",
  "Table",
]);

/** Inline spans blanked out of a prose block. `URL` covers link targets, bare URLs, autolinks and e-mail addresses. */
export const NON_PROSE_INLINE: ReadonlySet<string> = new Set([
  "InlineCode",
  "URL",
  "Autolink",
  "HTMLTag",
  "Comment",
  "InlineMath",
  "LinkLabel",
  "LinkTitle",
]);

/** A paragraph to check: where it starts, and its text with non-prose blanked (same length). */
export interface ProseUnit {
  from: number;
  text: string;
}

/** Blank `[from, to)` of `chars` (relative), keeping line breaks. */
function blank(chars: string[], from: number, to: number): void {
  for (let i = Math.max(0, from); i < Math.min(chars.length, to); i++) {
    if (chars[i] !== "\n" && chars[i] !== "\r") chars[i] = " ";
  }
}

function insideNonProse(node: SyntaxNode): boolean {
  for (let p: SyntaxNode | null = node.parent; p; p = p.parent) {
    if (NON_PROSE_BLOCKS.has(p.name)) return true;
  }
  return false;
}

/** The text of one prose block, non-prose spans blanked. */
function unitOf(state: EditorState, node: SyntaxNode): ProseUnit {
  // Code units, not code points: offsets must be UTF-16 like the checker's.
  const raw = state.sliceDoc(node.from, node.to);
  const chars = raw.split("");
  const cursor = node.cursor();
  if (cursor.firstChild()) {
    const walk = (): void => {
      do {
        if (NON_PROSE_INLINE.has(cursor.name)) {
          blank(chars, cursor.from - node.from, cursor.to - node.from);
        } else if (cursor.firstChild()) {
          walk();
          cursor.parent();
        }
      } while (cursor.nextSibling());
    };
    walk();
  }
  return { from: node.from, text: chars.join("") };
}

/**
 * The prose blocks overlapping `[from, to)`, each whole (a block that only
 * starts or ends in the range is included entirely), in document order.
 * Blocks that hold no letters at all are left out.
 */
export function proseUnits(state: EditorState, from: number, to: number): ProseUnit[] {
  const out: ProseUnit[] = [];
  progressiveTree(state).iterate({
    from,
    to,
    enter: (ref) => {
      if (NON_PROSE_BLOCKS.has(ref.name)) return false;
      if (!ref.type.is(LEAF_BLOCK)) return undefined;
      const node = ref.node;
      if (!insideNonProse(node)) {
        const unit = unitOf(state, node);
        if (/\p{L}/u.test(unit.text)) out.push(unit);
      }
      return false;
    },
  });
  return out;
}

/**
 * Is `pos` of the outer document a prose context — should an editor nested
 * there (a table cell, a frontmatter value being edited) check its own text?
 * A table is prose context (its cells are text); everything in the non-prose
 * tables is not, so a frontmatter value is never checked.
 */
export function proseContextAt(state: EditorState, pos: number): boolean {
  const tree = progressiveTree(state);
  for (let n: SyntaxNode | null = tree.resolveInner(pos, 1); n; n = n.parent) {
    if (n.name === "Table") return true;
    if (NON_PROSE_BLOCKS.has(n.name) || NON_PROSE_INLINE.has(n.name)) return false;
  }
  return true;
}
