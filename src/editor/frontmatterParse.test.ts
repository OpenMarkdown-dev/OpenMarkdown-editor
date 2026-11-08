import { describe, expect, it } from "vitest";
import { EditorState } from "@codemirror/state";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { progressiveTree, withCompleteTree } from "./syntax";
import { frontmatterMarkdown } from "./frontmatterParse";

function nodeNames(doc: string): string[] {
  const state = withCompleteTree(
    EditorState.create({
      doc,
      extensions: [markdown({ base: markdownLanguage, extensions: [frontmatterMarkdown] })],
    }),
  );
  const names: string[] = [];
  progressiveTree(state).iterate({ enter: (n) => void names.push(n.name) });
  return names;
}

describe("frontmatterMarkdown", () => {
  it("parses a leading frontmatter block as a Frontmatter node, not a Setext heading", () => {
    const names = nodeNames(`---\nname: pdf\ndescription: a skill\n---\n\n# Body\n`);
    expect(names).toContain("Frontmatter");
    // The `description:` line + closing `---` must NOT become a Setext heading.
    expect(names.some((n) => /Setext/.test(n))).toBe(false);
    // A real body heading still parses normally.
    expect(names).toContain("ATXHeading1");
  });

  it("handles an empty frontmatter block", () => {
    expect(nodeNames(`---\n---\n`)).toContain("Frontmatter");
  });

  it("handles frontmatter with a single key", () => {
    expect(nodeNames(`---\nname: x\n---\n`)).toContain("Frontmatter");
  });

  it("does NOT eat a stray leading `---` whose next line is content (thematic break)", () => {
    const names = nodeNames(`---\n# Heading\ncontent\n`);
    expect(names).not.toContain("Frontmatter");
    expect(names).toContain("HorizontalRule");
    expect(names).toContain("ATXHeading1");
  });

  it("takes a leading `#` comment as YAML when the block closes", () => {
    // fixtures/properties/mixed.md opens this way; 按源码编辑 showed it as an H1.
    const names = nodeNames(`---\n# 注释\ntitle: x\n---\n\nbody\n`);
    expect(names).toContain("Frontmatter");
    expect(names).not.toContain("ATXHeading1");
  });

  it("takes a non-ASCII first key as YAML", () => {
    expect(nodeNames(`---\n作者: 张三\n---\n`)).toContain("Frontmatter");
  });

  it("no frontmatter for a plain document", () => {
    const names = nodeNames(`# Just a heading\n\ntext\n`);
    expect(names).not.toContain("Frontmatter");
    expect(names).toContain("ATXHeading1");
  });

  it("an unclosed `---` block is not frontmatter: the rest stays markdown (the one rule)", () => {
    const names = nodeNames(`---\ntitle: x\n# Heading\n`);
    expect(names).not.toContain("Frontmatter");
    expect(names).toContain("ATXHeading1");
  });

  it("allows trailing spaces on both fences", () => {
    expect(nodeNames(`--- \ntitle: x\n---\t\n\nbody\n`)).toContain("Frontmatter");
  });
});
