/**
 * Recognise the document-history shortcuts from a raw keydown (change:
 * table-cell-edit-undo / design D1).
 *
 * Normally nobody needs this — `historyKeymap` is in the editor's keymap and CM
 * routes the key itself. The table's in-place cell editor is the exception: its
 * widget returns `true` from `ignoreEvent()`, so CodeMirror's
 * `eventBelongsToEditor` excludes EVERY event inside the widget and the keymap
 * never runs (that is deliberate — it is what keeps focus and IME composition
 * alive while typing in a cell). The cell's own key handler therefore has to
 * recognise undo / redo and invoke the commands directly.
 *
 * That makes this a second copy of what `historyKeymap` declares, which is the
 * kind of thing that drifts in silence. `historyKey.test.ts` reads the real
 * keymap and asserts agreement, so drift shows up as a red test.
 *
 * Scope is deliberately narrow: DOCUMENT history only. `Mod-u` / `Mod-Shift-u`
 * (selection history) stay with the widget, as does everything else — see the
 * design note on why the widget keeps owning its keys instead of letting the
 * whole keymap reach a caret the user cannot see.
 */

/** The fields of a `KeyboardEvent` this predicate reads (so node can test it). */
export interface HistoryKeyEvent {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}

/** True on Apple platforms, where CodeMirror's `Mod-` means Cmd rather than Ctrl. */
export const MOD_IS_META = typeof navigator !== "undefined" && /Mac|iP(hone|ad|od)/.test(navigator.platform);

/**
 * Which document-history command this keydown asks for, or null.
 *
 * `mac` is injectable so both platform branches are testable in node.
 */
export function historyKeyOf(e: HistoryKeyEvent, mac: boolean = MOD_IS_META): "undo" | "redo" | null {
  // Alt is never part of a history binding; letting it through would steal
  // Alt-combinations the cell input (or the IME) may want.
  if (e.altKey) return null;
  const mod = mac ? e.metaKey : e.ctrlKey;
  if (!mod) return null;
  const key = e.key.toLowerCase();
  // Mod-z / Mod-Shift-z. On non-mac `historyKeymap` scopes Ctrl-Shift-z to linux;
  // widening it to all non-mac only ever turns a key we would otherwise ignore
  // into redo (asserted in the test).
  if (key === "z") return e.shiftKey ? "redo" : "undo";
  // Mod-y is the non-mac redo; on mac that slot is Mod-Shift-z, handled above.
  if (!mac && key === "y" && !e.shiftKey) return "redo";
  return null;
}
