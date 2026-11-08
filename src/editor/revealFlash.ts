import { StateEffect, StateField } from "@codemirror/state";
import { Decoration, EditorView } from "@codemirror/view";
import type { DecorationSet } from "@codemirror/view";
import { FLASH_ATTR, FLASH_MS, type FlashActor } from "@/lib/landingFlash";

/**
 * Flash the reveal landing line (spec: reveal / 标题定位与滚动): a brief bloom
 * on the heading a reveal scrolled to, coloured by who moved the user there —
 * today every caller is the agent's hand (--agent). The look is the ONE landing
 * flash in src/index.css (`[data-flash]`, spec: app-chrome / 落地闪是注意力,
 * 不是状态); this file only puts the attribute on the line and takes it off.
 * Pure decoration — no document change, no cursor/selection move, nothing in
 * undo history.
 */

/** Carries the heading line's document position and who moved the user. */
const setFlash = StateEffect.define<{ pos: number; actor: FlashActor }>({
  map: (v, change) => ({ ...v, pos: change.mapPos(v.pos) }),
});
const clearFlash = StateEffect.define<void>();

const flashLine = {
  agent: Decoration.line({ attributes: { [FLASH_ATTR]: "agent" } }),
  human: Decoration.line({ attributes: { [FLASH_ATTR]: "human" } }),
} satisfies Record<FlashActor, Decoration>;

const flashField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(deco, tr) {
    // Ride along document edits; a deleted line drops its decoration.
    deco = deco.map(tr.changes);
    for (const effect of tr.effects) {
      if (effect.is(clearFlash)) deco = Decoration.none;
      if (effect.is(setFlash)) {
        const line = tr.state.doc.lineAt(effect.value.pos);
        deco = Decoration.set([flashLine[effect.value.actor].range(line.from)]);
      }
    }
    return deco;
  },
  provide: (field) => EditorView.decorations.from(field),
});

/** Shared across all three editor modes — line decorations follow CM6's own layout. */
export const revealFlash = [flashField];

/** Module-level singleton: a new flash replaces the previous one's cleanup. */
let flashTimer: ReturnType<typeof setTimeout> | undefined;

/**
 * Flash the line at `from` (design D2): clear, then set on the next frame —
 * the attribute must leave the DOM before it returns so the CSS animation
 * restarts on consecutive reveals. One FLASH_MS timer clears both the animated
 * and the reduced-motion (static) variants through the same path.
 */
export function flashHeadingLine(view: EditorView, from: number, actor: FlashActor): void {
  if (flashTimer !== undefined) {
    clearTimeout(flashTimer);
    flashTimer = undefined;
  }
  if (!view.dom.isConnected) return;
  view.dispatch({ effects: clearFlash.of() });
  requestAnimationFrame(() => {
    if (!view.dom.isConnected) return;
    view.dispatch({ effects: setFlash.of({ pos: from, actor }) });
    if (flashTimer !== undefined) clearTimeout(flashTimer);
    flashTimer = setTimeout(() => {
      flashTimer = undefined;
      if (!view.dom.isConnected) return;
      view.dispatch({ effects: clearFlash.of() });
    }, FLASH_MS);
  });
}
