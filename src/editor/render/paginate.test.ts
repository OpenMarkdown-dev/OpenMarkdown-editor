import { describe, expect, it } from "vitest";
import { fitScale, pageCount, paginateScript, pdfPage, pushDown } from "./paginate";
import { buildHtmlDocument } from "./document";

// Pages of pitch 1000 with a 100 margin: printable bands [100, 900), [1100, 1900), …
const P = 1000;
const M = 100;

describe("pushDown", () => {
  it("a block inside a band stays", () => {
    expect(pushDown(100, 400, P, M)).toBe(0);
    expect(pushDown(1500, 1900, P, M)).toBe(0);
  });

  it("a block crossing the band end moves to the next band start", () => {
    expect(pushDown(800, 950, P, M)).toBe(1100 - 800);
  });

  it("a block starting in a margin moves to the band start", () => {
    expect(pushDown(0, 50, P, M)).toBe(100);
    expect(pushDown(950, 1000, P, M)).toBe(1100 - 950);
    expect(pushDown(1020, 1100, P, M)).toBe(80);
  });

  it("a block taller than a band asks to be split", () => {
    expect(pushDown(100, 901, P, M)).toBe("split");
  });

  it("a block exactly one band tall fits at the band start", () => {
    expect(pushDown(100, 900, P, M)).toBe(0);
    expect(pushDown(300, 1100, P, M)).toBe(800);
  });
});

describe("pageCount", () => {
  it("counts whole pages, at least one", () => {
    expect(pageCount(0, P)).toBe(1);
    expect(pageCount(1000, P)).toBe(1);
    expect(pageCount(1001, P)).toBe(2);
    expect(pageCount(2999.7, P)).toBe(3);
  });
});

describe("pdfPage", () => {
  const html = buildHtmlDocument("# Hi\n\nbody\n", { title: "Hi", math: () => null });

  it("adds the paginate script before </body>, once", () => {
    const page = pdfPage(html);
    expect(page.match(/<script>/g)?.length).toBe(1);
    expect(page.indexOf("<script>")).toBeLessThan(page.lastIndexOf("</body>"));
    expect(page.replace(/<script>[\s\S]*<\/script>\n/, "")).toBe(html);
  });

  it("the script is valid JavaScript that defines __omPaginate", () => {
    const win: Record<string, unknown> = {};
    new Function("window", "document", paginateScript())(win, {});
    expect(typeof win.__omPaginate).toBe("function");
  });
});

describe("fitScale", () => {
  it("shrinks only what is wider than the band", () => {
    expect(fitScale(400, 500)).toBe(1);
    expect(fitScale(500.3, 500)).toBe(1);
    expect(fitScale(1000, 500)).toBe(0.5);
  });
});
