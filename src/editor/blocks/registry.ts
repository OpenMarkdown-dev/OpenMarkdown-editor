import { blockMathEntry } from "./math";
import { mermaidEntry } from "./mermaid";
import { frontmatterEntry } from "./properties";
import { tableEntry } from "./table";
import type { BlockEntry } from "./types";

/**
 * Every block the editor knows, and which of the three ways it is edited in
 * (spec: block-editing / 块类型表 — this list and that table must agree; the
 * gate in registry.test.ts holds them together).
 *
 * C entries are declarations only: callouts, code blocks and blockquotes are
 * line decorations from the inline preview plugin, never replaced, so there is
 * nothing for the framework to build — but they are blocks, and saying so here
 * is what lets the gate catch a C block quietly turning into a replacement.
 */
export const BLOCKS: readonly BlockEntry[] = [
  blockMathEntry,
  frontmatterEntry,
  tableEntry,
  mermaidEntry,
  { id: "callout", mode: "C" },
  { id: "code-block", mode: "C" },
  { id: "blockquote", mode: "C" },
];

export const BLOCKS_BY_NODE: ReadonlyMap<string, BlockEntry> = new Map(
  BLOCKS.filter((b) => b.node).map((b) => [b.node!, b]),
);

export const blockEntry = (id: string): BlockEntry | undefined => BLOCKS.find((b) => b.id === id);
