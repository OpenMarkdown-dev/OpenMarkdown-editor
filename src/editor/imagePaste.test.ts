import { describe, expect, it } from "vitest";
import type { EditorView } from "@codemirror/view";
import { fileLabel, fileLinkInsertText, imageInsertText, storeAndInsert, unsupportedPasteReason } from "./imagePaste";

describe("imageInsertText", () => {
  it("builds a markdown image with an empty alt and the relative path", () => {
    expect(imageInsertText("attachments/img-abc.png")).toBe("![](attachments/img-abc.png)");
  });
  it("preserves the exact relative path returned by write_attachment", () => {
    expect(imageInsertText("attachments/img-00ff.jpg")).toBe("![](attachments/img-00ff.jpg)");
  });
});

describe("fileLinkInsertText", () => {
  it("labels a same-dir markdown file with its base name (no .md)", () => {
    expect(fileLinkInsertText("b.md")).toBe("[b](b.md)");
  });
  it("keeps the subdirectory in the target but labels with the base name", () => {
    expect(fileLinkInsertText("sub/b.md")).toBe("[b](sub/b.md)");
  });
  it("keeps an ascending relative target", () => {
    expect(fileLinkInsertText("../notes.md")).toBe("[notes](../notes.md)");
  });
  it("preserves non-markdown extensions in the label", () => {
    expect(fileLinkInsertText("./data.csv")).toBe("[data.csv](./data.csv)");
  });
  it("strips only the trailing .md, not earlier dots", () => {
    expect(fileLinkInsertText("a.b.md")).toBe("[a.b](a.b.md)");
  });
  it("handles an extensionless file name", () => {
    expect(fileLinkInsertText("README")).toBe("[README](README)");
  });
});

describe("fileLabel", () => {
  // Shared naming rule for every "link to a file" entry point (drag + Cmd+K/[[).
  it("strips a trailing .md from the base name", () => {
    expect(fileLabel("sub/b.md")).toBe("b");
  });
  it("keeps a non-markdown extension", () => {
    expect(fileLabel("./data.csv")).toBe("data.csv");
  });
  it("strips only the trailing .md, not earlier dots", () => {
    expect(fileLabel("a.b.md")).toBe("a.b");
  });
  it("handles an ascending path and an extensionless name", () => {
    expect(fileLabel("../notes.md")).toBe("notes");
    expect(fileLabel("README")).toBe("README");
  });
});

describe("fileLinkInsertText — an image row embeds (change image-viewer)", () => {
  it("dragging a listed image from the tree inserts ![](rel), not a link", () => {
    expect(fileLinkInsertText("attachments/chart.PNG")).toBe("![](attachments/chart.PNG)");
    expect(fileLinkInsertText("../d.svg")).toBe("![](../d.svg)");
  });
});

// spec: editor-host / 宿主可选地获知被丢弃的图片 — silence stays the contract;
// the host may opt into a notice.
describe("an image the host cannot store", () => {
  const save = async () => "attachments/a.png";
  const png = { type: "image/png", name: "a.png", arrayBuffer: async () => new ArrayBuffer(1) } as unknown as File;
  // The no-capability path returns before it touches the view.
  const noView = {} as EditorView;

  it("names why, the missing save first", () => {
    expect(unsupportedPasteReason("/n/a.md", undefined)).toBe("no-save-attachment");
    expect(unsupportedPasteReason(null, undefined)).toBe("no-save-attachment");
    expect(unsupportedPasteReason(null, save)).toBe("no-doc-path");
    expect(unsupportedPasteReason("/n/a.md", save)).toBeNull();
  });

  it("tells onUnsupportedPaste, with the count, and inserts nothing", async () => {
    const heard: [string, number][] = [];
    await storeAndInsert(noView, [png, png], "/n/a.md", undefined, 0, (r, n) => heard.push([r, n]));
    await storeAndInsert(noView, [png], null, save, 0, (r, n) => heard.push([r, n]));
    expect(heard).toEqual([["no-save-attachment", 2], ["no-doc-path", 1]]);
  });

  it("stays silent without the hook (no throw)", async () => {
    await expect(storeAndInsert(noView, [png], "/n/a.md", undefined, 0)).resolves.toBeUndefined();
  });
});
