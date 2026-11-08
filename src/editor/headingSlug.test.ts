import { describe, expect, it } from "vitest";
import { githubSlug, githubSlugs } from "./headingSlug";

describe("githubSlug", () => {
  it.each([
    ["Second part", "second-part"],
    ["What's new in v0.1?", "whats-new-in-v01"],
    ["The `setDoc` call", "the-setdoc-call"],
    ["**Bold** and _em_", "bold-and-em"],
    ["See [the guide](./guide.md)", "see-the-guide"],
    ["snake_case_name", "snake_case_name"],
    ["总结 与 下一步", "总结-与-下一步"],
    ["Café déjà vu", "café-déjà-vu"],
    ["  Trim me  ", "trim-me"],
    ["A -- B", "a----b"],
  ])("%s → %s", (text, slug) => {
    expect(githubSlug(text)).toBe(slug);
  });
});

describe("githubSlugs numbers repeats in document order", () => {
  it("adds -1, -2 to repeats", () => {
    expect(githubSlugs(["Usage", "Usage", "Usage"])).toEqual(["usage", "usage-1", "usage-2"]);
  });

  it("skips a suffix a real heading already took", () => {
    expect(githubSlugs(["Usage", "Usage 1", "Usage"])).toEqual(["usage", "usage-1", "usage-2"]);
  });
});

describe("findFragmentHeading (a #fragment link's target)", async () => {
  const { EditorState } = await import("@codemirror/state");
  const { findFragmentHeading } = await import("./outline");
  const state = EditorState.create({ doc: "# Intro\n\n## Second part\n\ntext\n\n## Usage\n\n## Usage\n" });

  it("matches the heading text, as before", () => {
    expect(findFragmentHeading(state, "Second part")?.text).toBe("Second part");
  });

  it("matches a GitHub-style slug", () => {
    expect(findFragmentHeading(state, "second-part")?.text).toBe("Second part");
  });

  it("numbers repeats the way GitHub does", () => {
    const second = findFragmentHeading(state, "usage-1");
    expect(second?.text).toBe("Usage");
    expect(second?.from).toBe(state.doc.toString().lastIndexOf("## Usage"));
  });

  it("finds nothing for an unknown fragment", () => {
    expect(findFragmentHeading(state, "nowhere")).toBeNull();
  });
});
