import { ViewPlugin, type EditorView } from "@codemirror/view";
import { editorString } from "./strings";
import type { ImageLabel } from "./imageAlt";
import { editorIconButton } from "./controls";
import { zoomed } from "./contentZoom";
import { clearPending, imageSizeKey, markPending, rememberSize, rememberedSize } from "./blocks/pending";

/**
 * The ONE rendered image element (spec: live-preview-editor / 图片元素只有一处
 * 生成; change: table-cell-images, design D1). The body image (`ImageWidget` in
 * `widgets.ts`) and the table-cell image (`inlineCell.ts`) both get their
 * element here: the frame, `img.om-image` with its size values, the
 * load-failure notice. A leaf module so the cell renderer can use it without
 * importing `widgets.ts` (which imports the cell renderer). Gate:
 * `imageElement.gate.test.ts`.
 *
 * The alt and the size come in already read (`imageAlt.ts`, the one reading);
 * the box rule is `.om-image` / `.om-image-frame` in `theme.ts`, once.
 */

/**
 * The per-image numbers of a written size (spec: live-preview-editor / 图片按尺寸
 * 写法显示; change: image-size, design D3). Only VALUES go on the element; the
 * box rule — capped at the column (`maxWidth: 100%`), height following the
 * ratio (`height: auto`) — is `.om-image` in `theme.ts`, once.
 *
 * - width → `zoomed("<w>px")`: the document scales by font size, so a written
 *   pixel is a document pixel and goes through the content zoom's one door;
 * - width and height → also `aspect-ratio: w / h`: the written ratio wins over
 *   the picture's own (stretched, never cropped), and the box is reserved
 *   before the picture loads.
 *
 * Larger than the picture is honoured (upscaled); the column cap still holds.
 *
 * - no written height, the picture's own size `natural` known (it has loaded,
 *   now or earlier this session — change: render-placeholder-size, design D6)
 *   → also `aspect-ratio` from it, so the box holds the picture's height before
 *   its pixels arrive; and with no written width, `zoomed("<natural>px")` too:
 *   a picture pixel is a document pixel, so an unsized picture scales with the
 *   text like a sized one (change: image-resize, design D1). Unknown: nothing,
 *   the picture's own size (the frame is the placeholder meanwhile).
 */
export function imageBoxStyle(
  size: Pick<ImageLabel, "width" | "height">,
  natural?: { width: number; height: number },
): { width?: string; aspectRatio?: string } {
  if (size.width !== undefined && size.height !== undefined) {
    return { width: zoomed(`${size.width}px`), aspectRatio: `${size.width} / ${size.height}` };
  }
  const known = natural && natural.width > 0 && natural.height > 0 ? natural : undefined;
  const ratio = known ? { aspectRatio: `${known.width} / ${known.height}` } : {};
  if (size.width !== undefined) return { width: zoomed(`${size.width}px`), ...ratio };
  return known ? { width: zoomed(`${known.width}px`), ...ratio } : {};
}

/** The placeholder's floor for a picture of unknown size (design D6, the minimum). */
export const IMAGE_PENDING_MIN = { height: "8em", width: "8em" };

/** The resize handle's class: drag-to-resize's one grip (`imageResize.ts`, shown by `theme.ts`). */
export const IMAGE_HANDLE_CLASS = "om-image-handle";

/**
 * A rendered image: a frame (inline, never wider than its column — a cell in a
 * table) holding `img.om-image` and the resize handle (an empty grip, shown only
 * while an editable image is hovered or dragged — `theme.ts`). A failed load
 * replaces the frame's content with the notice 「⚠ 图片加载失败: alt」 (the alt
 * without its size), so a broken picture has no handle.
 */
export function imageElement(src: string, label: ImageLabel): HTMLElement {
  const frame = document.createElement("span");
  frame.className = "om-image-frame";
  const img = document.createElement("img");
  img.className = "om-image";
  img.src = src;
  img.alt = label.alt;
  // The one size order (`blocks/pending.ts`, design D6): the written size; else
  // the picture's natural size remembered from an earlier load this session
  // (by resolved `src`); else the frame is the placeholder until it arrives.
  const key = imageSizeKey(src);
  const stated = label.width !== undefined && label.height !== undefined;
  const remembered = stated ? undefined : rememberedSize(key);
  const natural = remembered?.width ? { width: remembered.width, height: remembered.height } : undefined;
  Object.assign(img.style, imageBoxStyle(label, natural));
  const arrived = () => {
    if (img.naturalWidth > 0 && img.naturalHeight > 0) {
      const size = { width: img.naturalWidth, height: img.naturalHeight };
      rememberSize(key, size);
      if (!stated) Object.assign(img.style, imageBoxStyle(label, size));
    }
    clearPending(frame);
  };
  // A picture already in the memory cache is known at once; otherwise on load.
  if (img.complete && img.naturalWidth > 0) arrived();
  else {
    if (!stated && !natural) markPending(frame, IMAGE_PENDING_MIN.height, label.width === undefined ? IMAGE_PENDING_MIN.width : undefined);
    img.addEventListener("load", arrived, { once: true });
  }
  img.onerror = () => {
    clearPending(frame);
    frame.textContent = editorString("widget.imageLoadFailed", { src: label.alt || src });
    frame.className = "om-image-broken";
  };
  // The grip is an md ghost icon button from the editor's one factory (change:
  // editor-controls, D5): the `imageResize` role (lucide move-diagonal-2, ↖↘ —
  // a proportional resize), the ruler's 24px square, `.ome-state`'s hover and
  // the `aria-pressed` the plugin declares while dragging. A pointer
  // affordance only — out of the tab order and the accessibility tree; theme.ts
  // only places it, shows it, and gives it the --muted surface.
  const handle = editorIconButton({
    glyph: "imageResize",
    size: "md",
    title: editorString("widget.resizeImage"),
    className: IMAGE_HANDLE_CLASS,
    tabIndex: -1,
    ariaHidden: true,
  });
  frame.append(img, handle);
  return frame;
}

/**
 * Re-measure when an image inside this editor loads or fails (design D4): the
 * layout changed and CodeMirror was not told — no DOM mutation, no resize of
 * its scroller — so its height map kept the old height and clicks below drifted
 * until the next update. `load` / `error` do not bubble, but they do pass every
 * ancestor in the CAPTURE phase, so one listener on the editor's root hears
 * every image in it: body images, table cells, and an editing cell's nested
 * editor (whose own copy of this plugin re-measures the nested editor too).
 * Installed once per editor: the main editor's base and `nestedEditorBase()`.
 */
export const imageLoadMeasure = ViewPlugin.fromClass(
  class {
    private readonly onSettle = (e: Event) => {
      if (e.target instanceof HTMLImageElement) this.view.requestMeasure();
    };
    constructor(private readonly view: EditorView) {
      view.dom.addEventListener("load", this.onSettle, true);
      view.dom.addEventListener("error", this.onSettle, true);
    }
    destroy() {
      this.view.dom.removeEventListener("load", this.onSettle, true);
      this.view.dom.removeEventListener("error", this.onSettle, true);
    }
  },
);
