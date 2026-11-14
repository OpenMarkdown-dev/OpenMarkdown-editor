import { describe, expect, it } from "vitest";
import { parseCallout, parseCalloutType, calloutTitle, CALLOUT_TYPES } from "./callout";

describe("parseCalloutType", () => {
  it("recognizes all five GitHub types", () => {
    expect(parseCalloutType("[!NOTE]")).toBe("note");
    expect(parseCalloutType("[!TIP]")).toBe("tip");
    expect(parseCalloutType("[!IMPORTANT]")).toBe("important");
    expect(parseCalloutType("[!WARNING]")).toBe("warning");
    expect(parseCalloutType("[!CAUTION]")).toBe("caution");
  });

  it("is case-insensitive on the type keyword, returning canonical lowercase", () => {
    expect(parseCalloutType("[!note]")).toBe("note");
    expect(parseCalloutType("[!Note]")).toBe("note");
    expect(parseCalloutType("[!wArNiNg]")).toBe("warning");
  });

  it("tolerates surrounding whitespace but requires the marker alone on the line", () => {
    expect(parseCalloutType("  [!TIP]")).toBe("tip");
    expect(parseCalloutType("[!WARNING]   ")).toBe("warning");
    expect(parseCalloutType("\t[!NOTE]\t")).toBe("note");
  });

  it("rejects a marker with trailing content (GitHub: not an alert)", () => {
    expect(parseCalloutType("[!NOTE] extra title")).toBeNull();
    expect(parseCalloutType("[!TIP] here is a tip")).toBeNull();
  });

  it("rejects unknown types", () => {
    expect(parseCalloutType("[!FOOBAR]")).toBeNull();
    expect(parseCalloutType("[!INFO]")).toBeNull();
    expect(parseCalloutType("[!]")).toBeNull();
  });

  it("rejects plain blockquote text", () => {
    expect(parseCalloutType("just a quote")).toBeNull();
    expect(parseCalloutType("")).toBeNull();
    expect(parseCalloutType("NOTE: not bracketed")).toBeNull();
    expect(parseCalloutType("[NOTE]")).toBeNull(); // missing `!`
  });
});

describe("calloutTitle", () => {
  it("capitalizes the canonical keyword for each type", () => {
    expect(calloutTitle("note")).toBe("Note");
    expect(calloutTitle("tip")).toBe("Tip");
    expect(calloutTitle("important")).toBe("Important");
    expect(calloutTitle("warning")).toBe("Warning");
    expect(calloutTitle("caution")).toBe("Caution");
  });

  it("covers every declared type", () => {
    for (const t of CALLOUT_TYPES) {
      expect(calloutTitle(t)).toMatch(/^[A-Z][a-z]+$/);
    }
  });
});

describe("parseCallout — the suffix (registry row callout-fold; recognised, never folded)", () => {
  it("reads a `-` or `+` glued to `]` as part of the marker", () => {
    expect(parseCallout("[!note]-")).toEqual({ type: "note", suffix: "-" });
    expect(parseCallout("[!NOTE]+")).toEqual({ type: "note", suffix: "+" });
    expect(parseCallout("  [!tip]-  ")).toEqual({ type: "tip", suffix: "-" });
    expect(parseCallout("[!warning]")).toEqual({ type: "warning", suffix: null });
  });

  it("requires the suffix glued to `]` and alone", () => {
    for (const t of ["[!note] -", "[!note]--", "[!note]- 标题", "[!note]+-", "[!note]-x"]) {
      expect(parseCallout(t), t).toBeNull();
      expect(parseCalloutType(t), t).toBeNull();
    }
  });
});

/**
 * Gate (spec: live-preview-editor / callout 类型只有一个登记处; change:
 * write-back-valid, design D7). The five types are listed once, `CALLOUT_TYPES`
 * in `callout.ts`; recognition, rendering, the insert command and the HTML
 * render read it. Fails, with file:line, on a non-test source file in `src/`
 * other than `callout.ts` holding two or more type keywords in one regex
 * alternation / union (`note|tip`, `"note" | "tip"`) or one array literal
 * (`["note", "tip"]`).
 *
 * Limits (stated, not hidden): textual and per line. Comments are stripped; an
 * array spread over several lines, one keyword each, is not seen; the browser
 * harness and fixtures are not scanned.
 */
describe("callout registry gate", () => {
  const KW = "(?:note|tip|important|warning|caution)";
  const ALTERNATION = new RegExp(`["'\`]?\\b${KW}\\b["'\`]?\\s*\\|\\s*["'\`]?\\b${KW}\\b`, "i");
  const QUOTED = new RegExp(`["'\`]${KW}["'\`]`, "gi");

  const strip = (code: string) =>
    code.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " ")).replace(/(^|[^:"'`\\])\/\/.*$/gm, "$1");

  function violations(files: { path: string; code: string }[]): string[] {
    const found: string[] = [];
    for (const { path, code } of files) {
      if (path === "editor/callout.ts" || path.startsWith("dev/harness/")) continue;
      strip(code)
        .split("\n")
        .forEach((line, i) => {
          const arrays = line.match(/\[[^[\]]*\]/g) ?? [];
          const listed = arrays.some((a) => (a.match(QUOTED) ?? []).length >= 2);
          if (listed || ALTERNATION.test(line)) found.push(`${path}:${i + 1}: a second list of callout types`);
        });
    }
    return found;
  }

  it("callout types are listed in src/editor/callout.ts and nowhere else", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const { listFiles, repoPath } = await import("../../scripts/lib/repoFiles.mjs");
    const SRC = join(__dirname, "..");
    const files = listFiles(SRC, { include: /\.tsx?$/, exclude: /\.test\.tsx?$/ }).map((p: string) => ({
      path: repoPath(SRC, p),
      code: readFileSync(p, "utf8"),
    }));
    expect(files.some((f) => f.path === "editor/callout.ts")).toBe(true);
    expect(violations(files)).toEqual([]);
  });

  it("catches each shape of a second list, and leaves single mentions alone", () => {
    const probe = (code: string) => violations([{ path: "editor/x.ts", code }]);
    expect(probe("const re = /\\[!(note|tip|warning)\\]/i;")).toEqual(["editor/x.ts:1: a second list of callout types"]);
    expect(probe('const TYPES = ["note", "tip"];')).toHaveLength(1);
    expect(probe('type T = "warning" | "caution";')).toHaveLength(1);
    expect(probe('"cmd.insertCalloutNote": "插入 Callout:Note",')).toEqual([]);
    expect(probe('if (kind === "note") return;')).toEqual([]);
    expect(probe("// note | tip in a comment")).toEqual([]);
    expect(violations([{ path: "editor/callout.ts", code: 'const CALLOUT_TYPES = ["note", "tip"];' }])).toEqual([]);
  });
});
