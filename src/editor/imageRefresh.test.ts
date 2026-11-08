import { describe, expect, it } from "vitest";
import { EditorState } from "@codemirror/state";
import { imageEpoch, imageEpochField, refreshImagesEffect } from "./imageRefresh";
import { TableWidget } from "./widgets";

describe("refreshImages (the image epoch)", () => {
  it("each refresh moves the epoch; other transactions do not", () => {
    let state = EditorState.create({ doc: "![](a.png)", extensions: imageEpochField });
    expect(imageEpoch(state)).toBe(0);
    state = state.update({ changes: { from: 0, insert: "x" } }).state;
    expect(imageEpoch(state)).toBe(0);
    state = state.update({ effects: refreshImagesEffect.of(null) }).state;
    state = state.update({ effects: refreshImagesEffect.of(null) }).state;
    expect(imageEpoch(state)).toBe(2);
  });

  it("is 0 without the preview installed", () => {
    expect(imageEpoch(EditorState.create({ doc: "" }))).toBe(0);
  });

  it("a table built at a new epoch is redrawn, so its images resolve again", () => {
    const src = "| a |\n| - |\n| ![](x.png) |";
    expect(new TableWidget(src, 0, null, false, 0).eq(new TableWidget(src, 0, null, false, 0))).toBe(true);
    expect(new TableWidget(src, 0, null, false, 1).eq(new TableWidget(src, 0, null, false, 0))).toBe(false);
  });
});
