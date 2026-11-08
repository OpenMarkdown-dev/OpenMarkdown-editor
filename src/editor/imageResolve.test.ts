import { describe, expect, it } from "vitest";
import { isRemoteSrc, normalizePosix, withinDir, resolveImageSrc } from "./imageResolve";

describe("isRemoteSrc", () => {
  it("treats scheme URLs as remote", () => {
    expect(isRemoteSrc("https://example.com/x.png")).toBe(true);
    expect(isRemoteSrc("http://example.com/x.png")).toBe(true);
    expect(isRemoteSrc("data:image/png;base64,AAAA")).toBe(true);
    expect(isRemoteSrc("file:///Users/x/a.png")).toBe(true);
  });
  it("treats relative / bare paths as local", () => {
    expect(isRemoteSrc("./pic.png")).toBe(false);
    expect(isRemoteSrc("pic.png")).toBe(false);
    expect(isRemoteSrc("sub/pic.png")).toBe(false);
    expect(isRemoteSrc("../up.png")).toBe(false);
    expect(isRemoteSrc("/abs/pic.png")).toBe(false);
  });
});

describe("normalizePosix", () => {
  it("collapses . and .. segments", () => {
    expect(normalizePosix("/a/b/../c/./d.png")).toBe("/a/c/d.png");
    expect(normalizePosix("a/./b.png")).toBe("a/b.png");
    expect(normalizePosix("a/../../b.png")).toBe("../b.png");
    expect(normalizePosix("/a/../../b.png")).toBe("/b.png");
  });
});

describe("withinDir", () => {
  it("accepts the dir itself and nested paths", () => {
    expect(withinDir("/a/b", "/a/b")).toBe(true);
    expect(withinDir("/a/b/c.png", "/a/b")).toBe(true);
    expect(withinDir("/a/b/sub/c.png", "/a/b")).toBe(true);
  });
  it("rejects siblings and ancestors", () => {
    expect(withinDir("/a/other/c.png", "/a/b")).toBe(false);
    expect(withinDir("/a/c.png", "/a/b")).toBe(false);
    expect(withinDir("/a/bc/c.png", "/a/b")).toBe(false); // prefix but not nested
  });
});

describe("resolveImageSrc", () => {
  const dir = "/Users/x/notes";
  const asset = (abs: string) => `asset://localhost/${abs}`;

  it("passes remote and data URLs through unchanged", () => {
    expect(resolveImageSrc("https://e.com/a.png", dir, asset)).toBe("https://e.com/a.png");
    expect(resolveImageSrc("data:image/png;base64,AA", dir, asset)).toBe(
      "data:image/png;base64,AA",
    );
  });

  it("resolves a relative local path within the doc dir to an asset URL", () => {
    expect(resolveImageSrc("./pic.png", dir, asset)).toBe(
      "asset://localhost//Users/x/notes/pic.png",
    );
    expect(resolveImageSrc("attachments/img.png", dir, asset)).toBe(
      "asset://localhost//Users/x/notes/attachments/img.png",
    );
  });

  it("resolves an absolute path inside the doc dir", () => {
    expect(resolveImageSrc("/Users/x/notes/a.png", dir, asset)).toBe(
      "asset://localhost//Users/x/notes/a.png",
    );
  });

  it("degrades to source (null) for paths outside the whitelist", () => {
    expect(resolveImageSrc("../secret.png", dir, asset)).toBeNull();
    expect(resolveImageSrc("/etc/passwd", dir, asset)).toBeNull();
    expect(resolveImageSrc("/Users/x/other/a.png", dir, asset)).toBeNull();
  });

  it("degrades to source (null) when there is no doc dir", () => {
    expect(resolveImageSrc("./pic.png", null, asset)).toBeNull();
  });

  it("returns null for empty src", () => {
    expect(resolveImageSrc("   ", dir, asset)).toBeNull();
  });
});
