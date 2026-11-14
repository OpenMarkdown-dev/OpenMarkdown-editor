import { describe, expect, it } from "vitest";
import { imageBoxStyle } from "./imageElement";
import { zoomed } from "./contentZoom";

/** spec: live-preview-editor / 图片按尺寸写法显示 — the per-image values (design D3). */
describe("imageBoxStyle", () => {
  it("no size, no values: the picture keeps today's box", () => {
    expect(imageBoxStyle({})).toEqual({});
  });

  it("a width is a document pixel, through the content zoom", () => {
    expect(imageBoxStyle({ width: 300 })).toEqual({ width: zoomed("300px") });
  });

  it("a width and a height also fix the written ratio", () => {
    expect(imageBoxStyle({ width: 300, height: 200 })).toEqual({ width: zoomed("300px"), aspectRatio: "300 / 200" });
  });

  it("larger than the picture is honoured (the column cap is the theme's)", () => {
    expect(imageBoxStyle({ width: 5000 })).toEqual({ width: zoomed("5000px") });
  });

  it("width only plus a size remembered from an earlier load → the remembered ratio reserves the height (change: render-placeholder-size, D6)", () => {
    // The demo picture: 1600×1107, written |480.
    expect(imageBoxStyle({ width: 480 }, { width: 1600, height: 1107 })).toEqual({
      width: zoomed("480px"),
      aspectRatio: "1600 / 1107",
    });
  });
});
