import { commonmarkLanguage } from "@codemirror/lang-markdown";
import { foldNodeProp } from "@codemirror/language";
import { GFM, type MarkdownExtension, type MarkdownParser } from "@lezer/markdown";
import { mathMarkdown } from "./math";
import { frontmatterMarkdown } from "./frontmatterParse";
import { strikethrough } from "./strikethrough";

/**
 * The editor's markdown grammar: CommonMark + GFM + exactly the parse-level
 * dialects in the registry (spec: markdown-dialect / 方言登记表是唯一真源).
 *
 * Built on `commonmarkLanguage`, NOT `markdownLanguage`. The latter is GFM
 * **plus** Subscript (`~x~`), Superscript (`^x^`) and Emoji (`:smile:`) — three
 * dialects nobody chose, which rode in with the library and got their `~` / `^`
 * marks painted muted like real markup (change: markdown-dialect, design D5).
 * Adding a parse extension here means adding a registry row first.
 *
 * GFM's own `Strikethrough` is swapped for `./strikethrough`: openmd strikes
 * only on exactly two tildes (registry row `strike-double-tilde`, a declared
 * difference from GitHub) and the library's parser struck `~~~x~~~`.
 * `dialectParser.test.ts` pins that against this assembled grammar.
 *
 * Folds: the editor's fold ranges come from exactly two places — headings
 * (`headingFold.ts`) and list items (`listFold.ts`; spec: live-preview-editor
 * / 折叠范围只有两处来源). The library gives EVERY block (quote, callout,
 * paragraph, code, math…) a fold range of its own, so ⌘⌥[ folded any quote or
 * paragraph and fold-all folded them all; each block's fold is switched off
 * here, except the table's, which `markdownLanguage` carried and fold commands
 * keep (change: callout-suffix, design D2). The fold gate checks this
 * behaviourally.
 */
const blockFolds: MarkdownExtension = {
  props: [
    foldNodeProp.add((type) => {
      if (type.name === "Table") return (tree, state) => ({ from: state.doc.lineAt(tree.from).to, to: tree.to });
      return type.is("Block") ? () => null : undefined;
    }),
  ],
};

export const dialectBase = commonmarkLanguage;
export const dialectExtensions: MarkdownExtension[] = [
  GFM,
  { remove: ["Strikethrough"] },
  strikethrough,
  blockFolds,
  mathMarkdown,
  frontmatterMarkdown,
];

/**
 * The assembled grammar as a bare parser, for code that parses markdown outside
 * an editor state — the table widget's cells (change: cell-tree). The one place
 * a markdown parser is configured: `parser.gate.test.ts` fails on any other.
 */
export const dialectMarkdownParser: MarkdownParser = (dialectBase.parser as MarkdownParser).configure(dialectExtensions);
