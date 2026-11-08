import { describe, expect, it } from "vitest";
import { relativePath } from "./relativePath";

describe("relativePath", () => {
  it("returns a bare filename for a target in the same directory", () => {
    expect(relativePath("/Users/x/notes", "/Users/x/notes/a.md")).toBe("a.md");
  });

  it("descends into a subdirectory", () => {
    expect(relativePath("/Users/x/notes", "/Users/x/notes/sub/b.md")).toBe("sub/b.md");
  });

  it("ascends to a parent directory", () => {
    expect(relativePath("/Users/x/notes/sub", "/Users/x/notes/x.md")).toBe("../x.md");
  });

  it("crosses to a sibling branch", () => {
    expect(relativePath("/Users/x/notes/sub", "/Users/x/notes/a/b.md")).toBe("../a/b.md");
  });

  it("ascends multiple levels", () => {
    expect(relativePath("/a/b/c", "/a/x/y.md")).toBe("../../x/y.md");
  });

  it("normalizes a trailing slash on fromDir", () => {
    expect(relativePath("/Users/x/notes/", "/Users/x/notes/a.md")).toBe("a.md");
  });

  it("normalizes . and .. segments in fromDir", () => {
    expect(relativePath("/Users/x/notes/./sub", "/Users/x/notes/sub/a.md")).toBe("a.md");
    expect(relativePath("/Users/x/notes/sub/..", "/Users/x/notes/a.md")).toBe("a.md");
  });

  it("does not treat a name-prefix sibling dir as nested", () => {
    // fromDir /a/b, target under /a/bc → must ascend, not read as nested
    expect(relativePath("/a/b", "/a/bc/d.md")).toBe("../bc/d.md");
  });

  it("returns . for identical paths", () => {
    expect(relativePath("/notes", "/notes")).toBe(".");
  });
});
