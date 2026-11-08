/**
 * Chrome typography (spec: app-chrome / 图标与字号只有语义档).
 *
 * Three tiers for INTERFACE text. Document prose and code are not chrome —
 * their sizing belongs to the editor (`live-preview-editor` / `theme.ts`) and
 * is deliberately absent from this table.
 *
 * Like the icon tiers, the values live only here. Call sites name a tier.
 *
 *   body  — primary interface text: menu rows, dialog copy, tab labels
 *   label — secondary text: section headings, row metadata
 *   note  — trailing marks: keycaps, "default" / "not installed" tags, badges
 */
export const TEXT = {
  body: "text-sm",
  label: "text-xs",
  note: "text-[11px]",
} as const;

export type TextTier = keyof typeof TEXT;

/**
 * The same tiers as numbers (px), for the editor core: it draws its chrome with
 * its own classes, not Tailwind's (change: editor-style-tokens, design D5).
 * `leading` is what the Tailwind class sets; `null` = the class sets no line
 * height (an arbitrary `text-[11px]`), so the element keeps its inherited one.
 * ui.test.ts asserts each row against its class.
 */
export const TEXT_METRICS: Record<TextTier, { size: number; leading: number | null }> = {
  body: { size: 14, leading: 20 },
  label: { size: 12, leading: 16 },
  note: { size: 11, leading: null },
};
