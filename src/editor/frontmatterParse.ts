import type { Input } from "@lezer/common";
import type { BlockContext, Line, MarkdownConfig } from "@lezer/markdown";
import { frontmatterRange, isFenceLine } from "./headingIndex";

/**
 * A `@lezer/markdown` extension that parses a leading YAML frontmatter block as
 * its own `Frontmatter` node, so the markdown grammar never treats its lines as
 * ordinary markdown.
 *
 * Why: without it, the last content line before the closing `---` (e.g.
 * `description: …`) parses as a Setext heading (`text` + `---` underline) and
 * gets heading-sized/bold styling whenever the frontmatter is revealed for
 * editing (skill card click / chip touch) — a giant `description` line. As a
 * plain `Frontmatter` node (no highlight tag) it renders at normal size.
 *
 * The `Frontmatter` node carries no tag, so it is invisible to the highlight
 * style; the hand-scanned chip/card (`decorateFrontmatter`) and section ops are
 * text-based and unaffected.
 */

/**
 * WHERE the frontmatter is comes from the one frontmatter rule
 * (`frontmatterRange` in `headingIndex.ts`; change: heading-model): the same
 * rule the section engine, the Properties block and the Rust disk path use, so
 * the editor never renders as YAML what an agent's read treats as markdown, or
 * the reverse. It needs the document text; `input` is a field BlockContext sets
 * but does not declare — without it there is no Frontmatter node (the leading
 * `---` keeps its thematic-break reading).
 */
function rangeOf(cx: BlockContext) {
  const input = (cx as unknown as { input?: Input }).input;
  return input ? frontmatterRange(input.read(0, input.length)) : null;
}

const frontmatterParser = {
  name: "Frontmatter",
  // Run before HorizontalRule so a leading `---` isn't grabbed as a thematic
  // break first.
  before: "HorizontalRule",
  parse(cx: BlockContext, line: Line): boolean {
    // Only a block at the very top of the document.
    if (cx.lineStart !== 0 || !isFenceLine(line.text)) return false;
    const range = rangeOf(cx);
    if (!range) return false;
    // Consume through the closing fence (line `closeLine`, 1-based).
    for (let n = 1; n < range.closeLine; n++) if (!cx.nextLine()) break;
    cx.addElement(cx.elt("Frontmatter", 0, range.to));
    cx.nextLine();
    return true;
  },
};

export const frontmatterMarkdown: MarkdownConfig = {
  defineNodes: [{ name: "Frontmatter", block: true }],
  parseBlock: [frontmatterParser],
};
