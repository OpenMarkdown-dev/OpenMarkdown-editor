import { describe, expect, it } from "vitest";
import { attemptRender, attemptRenderAsync, failedSourceMark, failureReason, isPending, pending } from "./render";

describe("attemptRender — the one place a render error is caught (change: block-fallback, D1)", () => {
  it("passes a rendered value through", () => {
    expect(attemptRender(() => "<math/>")).toEqual({ kind: "rendered", value: "<math/>" });
  });

  it("passes pending ('mine, not yet') through, apart from null (change: render-placeholder-size, D1)", async () => {
    expect(attemptRender(() => pending())).toEqual({ kind: "pending" });
    const content = { key: "k", build: () => ({}) as HTMLElement };
    expect(attemptRender(() => pending({ content }))).toEqual({ kind: "pending", content });
    expect(await attemptRenderAsync(async () => pending())).toEqual({ kind: "pending" });
    expect(await attemptRenderAsync(async () => null)).toEqual({ kind: "source" });
    expect(isPending(pending())).toBe(true);
    expect(isPending(null)).toBe(false);
    expect(isPending({ content: undefined })).toBe(false);
  });

  it("treats null as 'not mine': source, no failure", () => {
    expect(attemptRender(() => null)).toEqual({ kind: "source" });
  });

  it("turns a throw into a failure with the renderer's own first line", () => {
    const out = attemptRender(() => {
      throw new Error("  Unexpected end of input: \\frac{1}{\n\\frac{1}{̲  ");
    });
    expect(out).toEqual({ kind: "failed", reason: "Unexpected end of input: \\frac{1}{" });
  });

  it("accepts a non-Error throw", () => {
    expect(failureReason("bad")).toBe("bad");
    expect(attemptRender(() => {
      throw "bad";
    })).toEqual({ kind: "failed", reason: "bad" });
  });

  it("marks the exact source range, with the reason on hover", () => {
    const r = failedSourceMark(3, 12, "why");
    expect([r.from, r.to]).toEqual([3, 12]);
    const spec = r.value.spec as { class: string; attributes: Record<string, string> };
    expect(spec.class).toBe("om-render-failed");
    expect(spec.attributes["data-tip"]).toContain("why");
    expect("data-om-render-failed" in spec.attributes).toBe(true);
  });
});
