/**
 * GitHub callout (alert) recognition. A callout is a blockquote whose first
 * content line is exactly `[!TYPE]` — one of the five GitHub types, alone on the
 * line (nothing after `]` but whitespace). Anything else is a plain blockquote.
 *
 * Pure (unit-tested; an `EditorView` can't be built in node — see CLAUDE.md).
 * The live-preview layer (`livePreview.ts`) strips the blockquote `> ` marker
 * from the first line and passes the remaining content here.
 */
export const CALLOUT_TYPES = ["note", "tip", "important", "warning", "caution"] as const;
export type CalloutType = (typeof CALLOUT_TYPES)[number];

// `[!TYPE]` must occupy the whole content line (GitHub: `[!NOTE] extra` is NOT an
// alert), save for ONE fold suffix glued to the `]` — registry row
// `callout-fold`: `-` / `+` are Obsidian's fold marks. openmd recognises them as
// part of the marker so such a callout renders like any other, and does NOT
// fold it: a callout only colours and marks a region (user's decision, change
// callout-suffix). `[!note] -`, `[!note]--` and `[!note]- title` are not
// callouts. Case-insensitive on the type keyword; surrounding whitespace
// tolerated. The one reading of the marker: everything else goes through
// `parseCallout` (via `insets/stack.ts` calloutOf). Built from `CALLOUT_TYPES`,
// the one registry of types (spec: callout 类型只有一个登记处; change:
// write-back-valid) — the gate in `callout.test.ts` fails on a second list.
const CALLOUT_RE = new RegExp(`^\\s*\\[!(${CALLOUT_TYPES.join("|")})\\]([-+])?\\s*$`, "i");

/** The fold suffix as written (`-` / `+`), or null. Part of the marker only: nothing folds on it. */
export type CalloutSuffix = "-" | "+" | null;

/** The callout type and written suffix of a blockquote's first content line, or null if not a callout. */
export function parseCallout(firstLineText: string): { type: CalloutType; suffix: CalloutSuffix } | null {
  const m = CALLOUT_RE.exec(firstLineText);
  if (!m) return null;
  return { type: m[1].toLowerCase() as CalloutType, suffix: (m[2] as CalloutSuffix | undefined) ?? null };
}

/** The callout type of a blockquote's first content line, or null if not a callout. */
export function parseCalloutType(firstLineText: string): CalloutType | null {
  return parseCallout(firstLineText)?.type ?? null;
}

/** Display title shown in the rendered header — the canonical GitHub keyword. */
export function calloutTitle(type: CalloutType): string {
  return type.charAt(0).toUpperCase() + type.slice(1);
}
