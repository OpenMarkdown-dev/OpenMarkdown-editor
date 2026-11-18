import { describe, expect, it, vi } from "vitest";

// The converter's import rejects (network gone, chunk missing).
vi.mock("temml", () => {
  throw new Error("chunk missing");
});
vi.mock("@/lib/log", () => ({ logError: () => {}, loadWithoutWarning: (_w: string, load: () => Promise<unknown>) => load() }));

import { ensureMath, isMathReady, mathLoadFailed, mathLoader, mathState, renderFormula } from "./math";
import { importTemml } from "./mathImport";
import { EditorState } from "@codemirror/state";
import { isPending } from "./blocks/render";

/**
 * A failed load ends the wait (change: render-placeholder-size, design D5):
 * waiters are told, so placeholders turn back into source; formulas then answer
 * "not mine" (null), never "not yet". Its own file: the load is once per module.
 */
describe("the formula converter fails to load", () => {
  // A state that renders with the built-in converter, as the full entry's do.
  const state = EditorState.create({ extensions: mathLoader.of(importTemml) });
  it("before: formulas are pending; after: waiters are called, not ready, failed, formulas → null", async () => {
    expect(isPending(renderFormula(state, "x", false))).toBe(true);
    expect(mathState(state)).toBe("loading");
    const waiters = [vi.fn(), vi.fn()];
    await new Promise<void>((resolve) => {
      ensureMath(importTemml, waiters[0]);
      ensureMath(importTemml, () => {
        waiters[1]();
        resolve();
      });
    });
    expect(waiters[0]).toHaveBeenCalledTimes(1);
    expect(waiters[1]).toHaveBeenCalledTimes(1);
    expect(isMathReady()).toBe(false);
    expect(mathLoadFailed()).toBe(true);
    expect(mathState(state)).toBe("failed");
    expect(renderFormula(state, "x", false)).toBeNull();
  });
});
