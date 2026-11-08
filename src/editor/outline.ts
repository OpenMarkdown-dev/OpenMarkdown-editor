import type { EditorState, Text } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { headingAt, headingIndex, resolveHeading, type Heading } from "./headingIndex";
import { githubSlugs } from "./headingSlug";

/**
 * One heading of the document, as `EditorHost.onOutline` reports it: its text,
 * level, line range and offsets.
 */
// The editor's view of the one heading model (spec: reveal / 标题定位与滚动;
// section-write / 一个标题模型; change: heading-model). Every heading the app
// shows or jumps to — outline panel, palette `@`, overlay, reveal, link
// navigation, link completion, get_context, the sidebar chip, the signpost,
// heading folds — is an entry of `headingIndex`, the same index
// read/write_section anchor on. A line scan, not the syntax tree: it is total
// (no parse budget) and the Rust disk path implements it identically.
export type OutlineItem = Heading;

const byDoc = new WeakMap<Text, Heading[]>();

/** The document's headings, in order. One scan per document version. */
export function outlineOf(state: EditorState): Heading[] {
  let index = byDoc.get(state.doc);
  if (!index) {
    index = headingIndex(state.doc.toString());
    byDoc.set(state.doc, index);
  }
  return index;
}

/** The heading `pos` sits under ("the section you are in"), or null above the first. */
export function headingAtPos(state: EditorState, pos: number): Heading | null {
  return headingAt(outlineOf(state), pos);
}

/**
 * Locate a heading for NAVIGATION (reveal, `#heading` links): the heading
 * model's match (exact → case-insensitive over the `::` path, `#k` ordinal,
 * never by prefix). Several matches scroll to the first in document order — a
 * scroll is harmless; a write in the same situation is refused.
 */
export function findHeading(state: EditorState, query: string): Heading | null {
  const hit = resolveHeading(outlineOf(state), query);
  if (hit.kind === "hit") return hit.heading;
  if (hit.kind === "ambiguous") return hit.candidates[0];
  return null;
}

/**
 * The heading a `#fragment` link points at: the heading model's match first
 * (`findHeading`), then a GitHub-style slug (`second-part` → "Second part"), so
 * links written for GitHub work here too.
 */
export function findFragmentHeading(state: EditorState, fragment: string): Heading | null {
  const byText = findHeading(state, fragment);
  if (byText) return byText;
  const headings = outlineOf(state);
  const at = githubSlugs(headings.map((h) => h.text)).indexOf(fragment.toLowerCase());
  return at === -1 ? null : headings[at];
}

/**
 * The AGENT's reveal (spec: caret-rules R4; reveal / 标题定位与滚动): the heading
 * line lands at the top of the viewport. Scroll only — caret, selection and focus
 * stay the user's. Only `src/lib/reveal.ts` calls it (gate: `caret.gate.test.ts`);
 * a user's jump to a heading moves the caret too and goes through `navigateTo`
 * (`caret.ts`, R3).
 */
export function revealHeadingAt(view: EditorView, from: number): void {
  view.dispatch({
    effects: EditorView.scrollIntoView(from, { y: "start" }),
  });
}
