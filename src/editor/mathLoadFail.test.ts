import { describe, expect, it, vi } from "vitest";

// The converter's import rejects (network gone, chunk missing).
vi.mock("temml", () => {
  throw new Error("chunk missing");
});
vi.mock("@/lib/log", () => ({ logError: () => {} }));

import { ensureMath, isMathReady, mathLoadFailed, mathState, renderFormula } from "./math";
import { isPending } from "./blocks/render";

/**
 * A failed load ends the wait (change: render-placeholder-size, design D5):
 * waiters are told, so placeholders turn back into source; formulas then answer
 * "not mine" (null), never "not yet". Its own file: the load is once per module.
 */
describe("the formula converter fails to load", () => {
  it("before: formulas are pending; after: waiters are called, not ready, failed, formulas → null", async () => {
    expect(isPending(renderFormula("x", false))).toBe(true);
    expect(mathState()).toBe("loading");
    const waiters = [vi.fn(), vi.fn()];
    await new Promise<void>((resolve) => {
      ensureMath(waiters[0]);
      ensureMath(() => {
        waiters[1]();
        resolve();
      });
    });
    expect(waiters[0]).toHaveBeenCalledTimes(1);
    expect(waiters[1]).toHaveBeenCalledTimes(1);
    expect(isMathReady()).toBe(false);
    expect(mathLoadFailed()).toBe(true);
    expect(mathState()).toBe("failed");
    expect(renderFormula("x", false)).toBeNull();
  });
});
