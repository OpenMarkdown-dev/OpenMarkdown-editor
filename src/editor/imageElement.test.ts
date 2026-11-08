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

  it("a written size wins over the picture's own width", () => {
    expect(imageBoxStyle({ width: 120 }, 64)).toEqual({ width: "calc(120px * var(--om-content-zoom, 1))" });
  });

  it("an unsized picture: its own pixels, through the same zoom, once it has loaded", () => {
    expect(imageBoxStyle({}, 64)).toEqual({ width: "calc(64px * var(--om-content-zoom, 1))" });
    expect(imageBoxStyle({})).toEqual({});
    expect(imageBoxStyle({}, 0)).toEqual({});
  });
});
