import { describe, expect, it } from "vitest";
import { InvalidUtf8Error, openMarkdownFile, saveMarkdownFile, type MarkdownFile } from "./fileBytes";

// spec: editor-package / 随包提供文件字节适配器 (change: editor-integration-fixes, D4).

const enc = (s: string) => new TextEncoder().encode(s);
const dec = (b: Uint8Array) => new TextDecoder("utf-8", { ignoreBOM: true }).decode(b);
const BOM = "\uFEFF";

/** Open, do not edit, save: the bytes that come back. */
const roundTrip = (bytes: Uint8Array) => {
  const f = openMarkdownFile(bytes);
  return saveMarkdownFile(f.text, f);
};

describe("openMarkdownFile", () => {
  it("LF: text as is, ending LF, not mixed, no BOM", () => {
    const f = openMarkdownFile(enc("# A\n\nb\n"));
    expect(f).toMatchObject({ text: "# A\n\nb\n", bom: false, ending: "\n", mixed: false });
  });

  it("CRLF: text in \\n, ending CRLF", () => {
    const f = openMarkdownFile(enc("# A\r\n\r\nb\r\n"));
    expect(f).toMatchObject({ text: "# A\n\nb\n", ending: "\r\n", mixed: false });
  });

  it("lone CR: text in \\n, ending CR", () => {
    const f = openMarkdownFile(enc("# A\r\rb\r"));
    expect(f).toMatchObject({ text: "# A\n\nb\n", ending: "\r", mixed: false });
  });

  it("BOM: noted and stripped from the text", () => {
    const f = openMarkdownFile(enc(`${BOM}# A\n`));
    expect(f.bom).toBe(true);
    expect(f.text).toBe("# A\n");
  });

  it("only a leading U+FEFF is a BOM", () => {
    const f = openMarkdownFile(enc(`a${BOM}b\n`));
    expect(f.bom).toBe(false);
    expect(f.text).toBe(`a${BOM}b\n`);
  });

  it("no line break: ending defaults to LF", () => {
    expect(openMarkdownFile(enc("one line"))).toMatchObject({ text: "one line", ending: "\n", mixed: false });
    expect(openMarkdownFile(new Uint8Array())).toMatchObject({ text: "", ending: "\n", mixed: false, bom: false });
  });

  it("mixed: the most frequent ending is dominant", () => {
    const f = openMarkdownFile(enc("a\nb\r\nc\r\nd\re\r\n"));
    expect(f).toMatchObject({ text: "a\nb\nc\nd\ne\n", ending: "\r\n", mixed: true });
  });

  it("mixed tie: the ending that comes first wins", () => {
    expect(openMarkdownFile(enc("a\r\nb\nc\r\nd\n")).ending).toBe("\r\n");
    expect(openMarkdownFile(enc("a\nb\r\nc\nd\r\n")).ending).toBe("\n");
    expect(openMarkdownFile(enc("a\rb\nc")).ending).toBe("\r");
  });

  it("CR LF is one CRLF, LF CR is two breaks", () => {
    expect(openMarkdownFile(enc("a\r\nb")).text).toBe("a\nb");
    const f = openMarkdownFile(enc("a\n\rb"));
    expect(f).toMatchObject({ text: "a\n\nb", mixed: true, ending: "\n" });
  });

  it("keeps Unicode as written: composed and decomposed are not normalized", () => {
    const nfc = "café\n";
    const nfd = "café\n";
    expect(openMarkdownFile(enc(nfc)).text).toBe(nfc);
    expect(openMarkdownFile(enc(nfd)).text).toBe(nfd);
  });

  it("keeps a copy of the bytes, not the caller's array", () => {
    const b = enc("a\n");
    const f = openMarkdownFile(b);
    b[0] = 0x7a;
    expect(dec(f.bytes)).toBe("a\n");
  });

  it("invalid UTF-8 throws InvalidUtf8Error with code INVALID_UTF8", () => {
    for (const bad of [
      new Uint8Array([0x61, 0xff, 0x62]), // never valid
      new Uint8Array([0xc3]), // truncated sequence
      new Uint8Array([0xc0, 0xaf]), // overlong
      new Uint8Array([0xed, 0xa0, 0x80]), // surrogate
      new Uint8Array([0xef, 0xbb, 0xbf, 0x80]), // BOM then a stray continuation byte
    ]) {
      let err: unknown;
      try {
        openMarkdownFile(bad);
      } catch (e) {
        err = e;
      }
      expect(err).toBeInstanceOf(InvalidUtf8Error);
      expect(err).toBeInstanceOf(Error);
      expect((err as InvalidUtf8Error).code).toBe("INVALID_UTF8");
      expect((err as InvalidUtf8Error).name).toBe("InvalidUtf8Error");
      expect((err as InvalidUtf8Error).cause).toBeDefined();
    }
  });
});

describe("saveMarkdownFile, unedited: the original bytes", () => {
  it.each([
    ["LF", "# A\n\nb\n"],
    ["CRLF", "# A\r\n\r\nb\r\n"],
    ["lone CR", "# A\r\rb\r"],
    ["BOM + CRLF", `${BOM}# A\r\nb\r\n`],
    ["BOM + mixed", `${BOM}a\nb\r\nc\rd\r\n`],
    ["no final newline", "a\r\nb"],
    ["empty", ""],
    ["BOM only", BOM],
    ["NFD", "café\r\n"],
    ["whitespace, tabs, escapes", "a  \n\tb\\*\n__c__  \r\n"],
  ])("%s", (_name, s) => {
    const bytes = enc(s);
    expect([...roundTrip(bytes)]).toEqual([...bytes]);
  });

  it("returns the file's own bytes", () => {
    const f = openMarkdownFile(enc("a\r\n"));
    expect(saveMarkdownFile(f.text, f)).toBe(f.bytes);
  });

  it("a mixed file keeps its mix while unedited", () => {
    const f = openMarkdownFile(enc("a\nb\r\nc\r"));
    expect(dec(saveMarkdownFile(f.text, f))).toBe("a\nb\r\nc\r");
  });
});

describe("saveMarkdownFile, edited", () => {
  const edit = (s: string, from: string, to: string) => {
    const f = openMarkdownFile(enc(s));
    return dec(saveMarkdownFile(f.text.replace(from, to), f));
  };

  it("LF stays LF", () => expect(edit("a\nb\n", "b", "B")).toBe("a\nB\n"));
  it("CRLF is written back", () => expect(edit("a\r\nb\r\n", "b", "B\nc")).toBe("a\r\nB\r\nc\r\n"));
  it("lone CR is written back", () => expect(edit("a\rb\r", "b", "B")).toBe("a\rB\r"));
  it("the BOM is written back", () => expect(edit(`${BOM}a\r\n`, "a", "A")).toBe(`${BOM}A\r\n`));
  it("no BOM is added", () => expect(edit("a\n", "a", "A")).toBe("A\n"));
  it("no final newline is added", () => expect(edit("a\r\nb", "b", "B")).toBe("a\r\nB"));
  it("a mixed file gets the dominant ending everywhere", () =>
    expect(edit("a\nb\r\nc\r\nd", "d", "D")).toBe("a\r\nb\r\nc\r\nD"));
  it("decomposed Unicode is written as it is", () => expect(edit("café\n", "c", "C")).toBe("Café\n"));

  it("a doc with stray CR / CRLF breaks is not doubled", () => {
    const f = openMarkdownFile(enc("a\r\nb\r\n"));
    expect(dec(saveMarkdownFile("a\r\nb\rc\n", f))).toBe("a\r\nb\r\nc\r\n");
  });

  it("is UTF-8", () => {
    const f: MarkdownFile = openMarkdownFile(enc("x\n"));
    expect([...saveMarkdownFile("é\n", f)]).toEqual([0xc3, 0xa9, 0x0a]);
  });
});
