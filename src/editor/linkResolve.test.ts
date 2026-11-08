import { describe, expect, it } from "vitest";
import { resolveLinkTarget } from "./linkResolve";

describe("resolveLinkTarget", () => {
  const dir = "/Users/x/notes";

  it("classifies scheme URLs as external (unchanged)", () => {
    expect(resolveLinkTarget("https://github.com", dir)).toEqual({
      kind: "external",
      url: "https://github.com",
    });
    expect(resolveLinkTarget("mailto:a@b.com", dir)).toEqual({
      kind: "external",
      url: "mailto:a@b.com",
    });
    // No docDir must not change an external URL's classification.
    expect(resolveLinkTarget("http://example.com/p", null)).toEqual({
      kind: "external",
      url: "http://example.com/p",
    });
  });

  it("classifies a pure #anchor as a same-document anchor", () => {
    expect(resolveLinkTarget("#总结", dir)).toEqual({ kind: "anchor", heading: "总结" });
    // Percent-encoded anchors decode.
    expect(resolveLinkTarget("#my%20heading", dir)).toEqual({
      kind: "anchor",
      heading: "my heading",
    });
    // An anchor resolves without a docDir (no path involved).
    expect(resolveLinkTarget("#top", null)).toEqual({ kind: "anchor", heading: "top" });
  });

  it("resolves a relative path against docDir to an absolute local target", () => {
    expect(resolveLinkTarget("./other.md", dir)).toEqual({
      kind: "local",
      absPath: "/Users/x/notes/other.md",
      heading: null,
    });
    expect(resolveLinkTarget("sub/deep.md", dir)).toEqual({
      kind: "local",
      absPath: "/Users/x/notes/sub/deep.md",
      heading: null,
    });
  });

  it("carries a #fragment on a local path as heading (path resolved, frag separate)", () => {
    expect(resolveLinkTarget("./plan.md#决策", dir)).toEqual({
      kind: "local",
      absPath: "/Users/x/notes/plan.md",
      heading: "决策",
    });
  });

  it("treats an absolute path as a local target", () => {
    expect(resolveLinkTarget("/abs/x.md", dir)).toEqual({
      kind: "local",
      absPath: "/abs/x.md",
      heading: null,
    });
    // Absolute resolution does not need a docDir.
    expect(resolveLinkTarget("/abs/x.md", null)).toEqual({
      kind: "local",
      absPath: "/abs/x.md",
      heading: null,
    });
  });

  it("marks a relative path as unresolvable when there is no docDir", () => {
    expect(resolveLinkTarget("./other.md", null)).toEqual({ kind: "unresolvable" });
    expect(resolveLinkTarget("sub/deep.md", null)).toEqual({ kind: "unresolvable" });
  });

  it("decodes %20 spaces in the path before resolving", () => {
    expect(resolveLinkTarget("./my%20note.md", dir)).toEqual({
      kind: "local",
      absPath: "/Users/x/notes/my note.md",
      heading: null,
    });
  });

  it("allows ../ escaping docDir (no security clamp, unlike images)", () => {
    expect(resolveLinkTarget("../sibling.md", dir)).toEqual({
      kind: "local",
      absPath: "/Users/x/sibling.md",
      heading: null,
    });
    expect(resolveLinkTarget("../../up/x.md", dir)).toEqual({
      kind: "local",
      absPath: "/Users/up/x.md",
      heading: null,
    });
  });

  it("treats blank / whitespace href as unresolvable", () => {
    expect(resolveLinkTarget("   ", dir)).toEqual({ kind: "unresolvable" });
    expect(resolveLinkTarget("", dir)).toEqual({ kind: "unresolvable" });
  });
});
