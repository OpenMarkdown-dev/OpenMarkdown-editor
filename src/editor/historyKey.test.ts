import { describe, expect, it } from "vitest";
import { historyKeymap, redo, undo } from "@codemirror/commands";
import { historyKeyOf } from "./historyKey";

/**
 * The in-place table cell input owns every key inside the widget (design D3), so
 * `Cmd+Z` has to be recognised and forwarded by hand (change: table-cell-edit-undo
 * / design D1). That means this predicate is a SECOND COPY of what `historyKeymap`
 * declares — and a second copy drifts silently. These tests read the real keymap
 * and assert agreement, so drift is a red test rather than a dead shortcut.
 */

/** Build the event shape a binding string like `Mod-Shift-z` describes. */
function eventFor(spec: string, mac: boolean) {
  const parts = spec.split("-");
  const key = parts.pop()!;
  const has = (m: string) => parts.includes(m);
  return {
    key,
    metaKey: mac ? has("Mod") || has("Cmd") : has("Cmd"),
    ctrlKey: mac ? has("Ctrl") : has("Mod") || has("Ctrl"),
    shiftKey: has("Shift"),
    altKey: has("Alt"),
  };
}

/** The binding string `historyKeymap` uses on the given platform, if any. */
function specFor(b: (typeof historyKeymap)[number], mac: boolean): string | null {
  return (mac ? (b.mac ?? b.key) : (b.key ?? b.linux)) ?? null;
}

describe("historyKeyOf — mirrors @codemirror/commands historyKeymap", () => {
  for (const mac of [true, false]) {
    const platform = mac ? "mac" : "non-mac";

    it(`agrees with every document-history binding (${platform})`, () => {
      const seen: string[] = [];
      for (const b of historyKeymap) {
        const spec = specFor(b, mac);
        if (!spec) continue;
        const want = b.run === undo ? "undo" : b.run === redo ? "redo" : null;
        if (!want) continue; // undoSelection / redoSelection — see the next test
        seen.push(spec);
        expect(historyKeyOf(eventFor(spec, mac), mac)).toBe(want);
      }
      expect(seen.length).toBeGreaterThan(0); // the keymap moved out from under us
    });

    it(`claims neither selection-history binding (${platform})`, () => {
      for (const b of historyKeymap) {
        const spec = specFor(b, mac);
        if (!spec || b.run === undo || b.run === redo) continue;
        expect(historyKeyOf(eventFor(spec, mac), mac)).toBeNull();
      }
    });

    it(`ignores keys that are not history at all (${platform})`, () => {
      expect(historyKeyOf(eventFor("z", mac), mac)).toBeNull(); // no modifier
      expect(historyKeyOf(eventFor("Mod-b", mac), mac)).toBeNull();
      expect(historyKeyOf(eventFor("Mod-Alt-z", mac), mac)).toBeNull();
    });
  }

  it("treats the linux redo binding as redo on every non-mac platform", () => {
    // `historyKeymap` scopes `Ctrl-Shift-z` to linux; we widen it to all non-mac
    // because that is what users of the shortcut expect, and the widening only
    // ever turns a key we would otherwise ignore into redo.
    expect(historyKeyOf(eventFor("Ctrl-Shift-z", false), false)).toBe("redo");
  });

  it("reads the key case-insensitively (Shift uppercases it in real events)", () => {
    expect(historyKeyOf({ key: "Z", metaKey: true, ctrlKey: false, shiftKey: true, altKey: false }, true)).toBe("redo");
  });
});
