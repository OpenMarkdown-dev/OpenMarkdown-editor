import { EditorState, type Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { Language, LanguageDescription, LanguageSupport, ParseContext } from "@codemirror/language";
import { commonmarkLanguage, pasteURLAsLink } from "@codemirror/lang-markdown";
import { Parser, type Input, type PartialParse, type TreeFragment } from "@lezer/common";
import { parseCode } from "@lezer/markdown";
import { logError } from "@/lib/log";
import { dialectParserNesting } from "./dialectParser";

/**
 * The editor's Markdown language support (change: editor-lean-deps, design
 * D3) — what `@codemirror/lang-markdown`'s `markdown()` gives, assembled here
 * so that nothing the first paint needs reaches a second language:
 *
 * - **HTML inside Markdown loads lazily.** `markdown()` imports
 *   `@codemirror/lang-html` (and with it the JavaScript and CSS grammars)
 *   statically, about a third of the first load. Here an HTML block or tag
 *   is parsed by `lazyHtml`, which asks for `@codemirror/lang-html` the first
 *   time a document holds HTML and has CodeMirror reparse that range once it
 *   arrives — the same mechanism a fenced code block's language uses. Until
 *   then the HTML shows unhighlighted; `autoCloseTags` (typing `>` closes the
 *   tag) is the loaded package's own.
 * - **Code-block languages are the host's.** `codeLanguages` (a list such as
 *   `@codemirror/language-data`'s `languages`) highlights fenced code; none
 *   given, fenced code is plain. The package never imports `language-data`, so
 *   it lands in a host's lockfile only when the host asks for it.
 *
 * The grammar itself — CommonMark, GFM and the registered dialects — is
 * `dialectParser.ts`'s, unchanged. Heading folds are `headingFold.ts`'s alone
 * (spec: live-preview-editor / 折叠范围只有两处来源); `markdown()`'s own heading
 * fold service is not installed. Every editor (body, part, tests' golden
 * state) builds its language here.
 */
export function markdownSupport(codeLanguages?: readonly LanguageDescription[]): LanguageSupport {
  const codeParser = codeLanguages?.length ? codeParserOf(codeLanguages) : undefined;
  const parser = dialectParserNesting(parseCode({ codeParser, htmlParser: lazyHtml }));
  // The same language data as lang-markdown's own languages, so its exported
  // helpers (`pasteURLAsLink`, which asks `markdownLanguage.isActiveAt`) see this
  // language as Markdown.
  const language = new Language(commonmarkLanguage.data, parser, [], "markdown");
  return new LanguageSupport(language, [pasteURLAsLink, htmlAutoClose]);
}

/** The parser for a fence's info string, from the host's list — lang-markdown's own rule. */
function codeParserOf(languages: readonly LanguageDescription[]) {
  return (info: string): Parser | null => {
    const found = LanguageDescription.matchLanguageName(languages, /\S*/.exec(info)?.[0] ?? "", true);
    if (!found) return null;
    return found.support ? found.support.language.parser : ParseContext.getSkippingParser(found.load());
  };
}

// --- HTML, on demand -----------------------------------------------------------

type InputHandler = (view: EditorView, from: number, to: number, text: string, insert: () => unknown) => boolean;
let html: { parser: Parser; autoClose: InputHandler | null } | null = null;
let htmlLoad: Promise<void> | null = null;
let htmlFailed = false;

/** Load `@codemirror/lang-html` once; resolves when it is in (or failed). */
export function loadHtml(): Promise<void> {
  return (htmlLoad ??= import("@codemirror/lang-html").then(
    (m) => {
      const support = m.html({ matchClosingTags: false });
      // The package's own input handler, read back from its extension.
      const handlers = EditorState.create({ extensions: m.autoCloseTags }).facet(EditorView.inputHandler);
      html = { parser: support.language.parser, autoClose: (handlers[0] as InputHandler | undefined) ?? null };
    },
    (e: unknown) => {
      // HTML stays unhighlighted text; the document is untouched.
      logError("HTML grammar load", e);
      htmlFailed = true;
    },
  ));
}

/**
 * The HTML parser Markdown nests: the real one once loaded; before that a
 * parser that skips the range and schedules its reparse on the load (the
 * CodeMirror mechanism for languages that arrive later); after a failed load
 * one that skips it for good.
 */
class LazyHtmlParser extends Parser {
  createParse(input: Input, fragments: readonly TreeFragment[], ranges: readonly { from: number; to: number }[]): PartialParse {
    if (html) return html.parser.createParse(input, fragments, ranges);
    return ParseContext.getSkippingParser(htmlFailed ? undefined : loadHtml()).createParse(input, fragments, ranges);
  }
}
const lazyHtml = new LazyHtmlParser();

/** Typing `>` or `/` in an HTML tag closes it — lang-html's `autoCloseTags`, once loaded. */
const htmlAutoClose: Extension = EditorView.inputHandler.of(
  (view, from, to, text, insert) => html?.autoClose?.(view, from, to, text, insert) ?? false,
);
