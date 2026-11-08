import { StateEffect, StateField, type EditorState } from "@codemirror/state";

/**
 * Re-run the host's `resolveImage` for every image (`MarkdownEditor.refreshImages`),
 * for a host whose image policy changed — the reader approved remote images, say.
 *
 * Each refresh bumps an epoch. The inline preview and the block field rebuild
 * when it moves, and a rendered table carries it in its `eq`, so images inside
 * table cells are resolved again too.
 */
export const refreshImagesEffect = StateEffect.define<null>();

export const imageEpochField = StateField.define<number>({
  create: () => 0,
  update: (epoch, tr) => (tr.effects.some((e) => e.is(refreshImagesEffect)) ? epoch + 1 : epoch),
});

/** The state's image epoch (0 where the preview is not installed). */
export function imageEpoch(state: EditorState): number {
  return state.field(imageEpochField, false) ?? 0;
}
