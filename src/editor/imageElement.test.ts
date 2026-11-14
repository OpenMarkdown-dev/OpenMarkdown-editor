import { describe, expect, it } from "vitest";
import { imageBoxStyle } from "./imageElement";

// Spec: live-preview-editor / 图片按尺寸写法显示 (change: image-resize, design D1).
describe("imageBoxStyle", () => {
  it("a written size goes through the content zoom, the ratio only when both are written", () => {
    expect(imageBoxStyle({ width: 120 })).toEqual({ width: "calc(120px * var(--om-content-zoom, 1))" });
    expect(imageBoxStyle({ width: 120, height: 60 })).toEqual({
      width: "calc(120px * var(--om-content-zoom, 1))",
      aspectRatio: "120 / 60",
    });
  });

  it("a written width wins over the picture's own width; the picture's ratio holds its height", () => {
    expect(imageBoxStyle({ width: 120 }, { width: 64, height: 32 })).toEqual({
      width: "calc(120px * var(--om-content-zoom, 1))",
      aspectRatio: "64 / 32",
    });
    // Both written: the written ratio wins over the picture's.
    expect(imageBoxStyle({ width: 120, height: 60 }, { width: 64, height: 64 }).aspectRatio).toBe("120 / 60");
  });

  it("an unsized picture: its own pixels, through the same zoom, once its size is known", () => {
    expect(imageBoxStyle({}, { width: 64, height: 48 })).toEqual({
      width: "calc(64px * var(--om-content-zoom, 1))",
      aspectRatio: "64 / 48",
    });
    expect(imageBoxStyle({})).toEqual({});
    expect(imageBoxStyle({}, { width: 0, height: 0 })).toEqual({});
  });
});
