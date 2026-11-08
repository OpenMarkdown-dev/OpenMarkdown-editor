import { describe, expect, it } from "vitest";
import { clickFollowsLink } from "./linkGesture";

describe("clickFollowsLink (spec: 链接点击导航)", () => {
  it("live / source: only Cmd/Ctrl+click follows", () => {
    expect(clickFollowsLink(true, false)).toBe(true);
    expect(clickFollowsLink(false, false)).toBe(false);
  });

  it("reading: a plain click follows too", () => {
    expect(clickFollowsLink(false, true)).toBe(true);
    expect(clickFollowsLink(true, true)).toBe(true);
  });
});
