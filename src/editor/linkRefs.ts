import type { SyntaxNode, Tree } from "@lezer/common";

/**
 * Is this pair of brackets a link? — the ONE answer (spec: live-preview-editor /
 * 方括号是否成链接只有一个判定; change: write-back-valid, design D5).
 *
 * Lezer marks every `[text]` as a `Link` with two `LinkMark`s, whether or not a
 * `[text]: url` definition exists, and leaves resolving it to the consumer. So a
 * bracket pair is a link only when it has a destination (`[a](u)`, even an
 * empty `[a]()`) or names a
 * reference defined in the document (`[a][r]`, `[r][]`, `[r]`). Anything else is
 * text and its brackets stay: `> [!FOOBAR]`, `> [!note]- Folded`, an undefined
 * `see [foo] here`. Live preview, reading mode, plain copy and the HTML renderer
 * all ask here; `linkRefs.gate.test.ts` fails on a `LinkMark` hidden elsewhere.
 *
 * Pure: a tree and a way to read its text; no state, no view (CLAUDE.md).
 */

/** Reads the source text of `[from, to)`. */
export type SourceReader = (from: number, to: number) => string;

/** CommonMark link-label normalisation: trim, collapse inner whitespace, case-fold. */
export const labelKey = (label: string): string => label.trim().replace(/\s+/g, " ").toLowerCase();

/** The block containers a reference definition can sit in (CommonMark). */
const CONTAINERS = new Set(["Document", "Blockquote", "BulletList", "OrderedList", "ListItem"]);

const cache = new WeakMap<Tree, Map<string, SyntaxNode>>();

/**
 * Every reference definition (`[label]: url`) in `tree`, by normalised label —
 * the first one wins, as CommonMark says. A definition the tree has not reached
 * yet is not here, so references to it read as text until the parse gets there:
 * more brackets shown, never text hidden. Memoised per tree: a tree belongs to
 * one document version, and live preview asks again on every rebuild.
 */
export function referenceDefinitions(tree: Tree, read: SourceReader): ReadonlyMap<string, SyntaxNode> {
  const cached = cache.get(tree);
  if (cached) return cached;
  const defs = new Map<string, SyntaxNode>();
  tree.iterate({
    enter: (node) => {
      if (node.name === "LinkReference") {
        const label = node.node.getChild("LinkLabel");
        if (label && node.node.getChild("URL")) {
          const key = labelKey(read(label.from, label.to).slice(1, -1));
          if (!defs.has(key)) defs.set(key, node.node);
        }
        return false;
      }
      return CONTAINERS.has(node.name);
    },
  });
  cache.set(tree, defs);
  return defs;
}

/** The labels `referenceDefinitions` defines — what `isLink` looks a reference up in. */
export type ReferenceLabels = { has(label: string): boolean };

/** The defined labels of `tree` (`referenceDefinitions`, as a lookup). */
export function referenceLabels(tree: Tree, read: SourceReader): ReferenceLabels {
  return referenceDefinitions(tree, read);
}

/**
 * The label a destination-less `Link` names: its `[r]` LinkLabel, or — for
 * `[r]` and `[r][]` — its own text between the first `[` and the `]` after it.
 */
export function referenceLabelOf(link: SyntaxNode, read: SourceReader): string | null {
  const marks = link.getChildren("LinkMark");
  const open = marks[0];
  const close = marks.find((m, i) => i > 0 && read(m.from, m.to) === "]");
  if (!open || !close) return null;
  const own = read(open.to, close.from);
  const ref = link.getChild("LinkLabel");
  return labelKey(ref ? read(ref.from, ref.to).slice(1, -1) || own : own);
}

/**
 * Does `link` (a `Link` / `Image` node) carry an inline destination `(…)`? Its
 * marks hold `(` then `)`. Lezer gives an empty destination — `[a]()`,
 * `[a]( )` — no `URL` child, yet CommonMark makes it a link (`href=""`), so
 * the marks, not the `URL` child, are what say so.
 */
export function hasDestination(link: SyntaxNode, read: SourceReader): boolean {
  const marks = link.getChildren("LinkMark").map((m) => read(m.from, m.to));
  const open = marks.indexOf("(");
  return open > 0 && marks.indexOf(")", open + 1) > open;
}

/** True when `link` (a `Link` node) is a link: it has a destination, or names a defined reference. */
export function isLink(link: SyntaxNode, read: SourceReader, labels: ReferenceLabels): boolean {
  if (link.getChild("URL") || hasDestination(link, read)) return true;
  const label = referenceLabelOf(link, read);
  return label !== null && labels.has(label);
}

/**
 * May a view hide this `LinkMark`? A mark of a `Link` only when that bracket
 * pair `isLink`; the marks of an image, an autolink (`<…>`) or a definition
 * line (`[r]:`) as they always were — those are links by their syntax alone.
 */
export function linkMarkConcealable(mark: SyntaxNode, read: SourceReader, labels: ReferenceLabels): boolean {
  const parent = mark.parent;
  if (!parent) return false;
  return parent.name !== "Link" || isLink(parent, read, labels);
}
