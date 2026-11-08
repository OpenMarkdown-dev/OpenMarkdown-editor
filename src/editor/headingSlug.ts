/**
 * GitHub-style heading slugs, for `#fragment` links written for GitHub
 * (`[jump](#second-part)` → "## Second part").
 *
 * The rule GitHub's renderer uses: the heading's visible text, lowercased; every
 * character that is not a letter, mark, digit, `_`, `-` or space dropped; spaces
 * become `-`. A repeated slug gets `-1`, `-2`, … in document order. Inline
 * markup is reduced to its visible text first (link text, code, emphasis
 * markers), so `` ## The `setDoc` call `` → `the-setdoc-call`.
 *
 * Only link navigation reads this; the heading model's own anchors
 * (`headingIndex.ts`, shared with the Rust disk path) are unchanged.
 */

/** A heading's visible text: link text kept, URLs, code ticks and emphasis markers dropped. */
function visibleText(text: string): string {
  return text
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/`+/g, "")
    .replace(/(\*+|~~|(?<![\p{L}\p{N}])_+|_+(?![\p{L}\p{N}]))/gu, "");
}

/** One heading text's slug, before duplicates are numbered. */
export function githubSlug(text: string): string {
  return visibleText(text)
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}\p{Pc}\- ]/gu, "")
    .replace(/ /g, "-");
}

/** The slugs of a document's headings, in order, with repeats numbered as GitHub does. */
export function githubSlugs(texts: readonly string[]): string[] {
  const seen = new Map<string, number>();
  return texts.map((text) => {
    const base = githubSlug(text);
    let slug = base;
    let n = seen.get(base) ?? 0;
    while (seen.has(slug)) slug = `${base}-${++n}`;
    seen.set(base, n);
    seen.set(slug, seen.get(slug) ?? 0);
    return slug;
  });
}
