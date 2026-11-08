/**
 * Icon sizing (spec: app-chrome / 图标与字号只有语义档) — the NUMBERS, as a pure
 * leaf (change: editor-style-tokens, design D5). `Icon.tsx` re-exports them
 * beside the component; the editor core reads them here, so it reaches the one
 * copy without dragging React and the icon set into its import closure.
 *
 * Four tiers, and the pixel values exist ONLY here — same discipline as the
 * colour tokens, for the same reason: a second copy drifts. Call sites choose a
 * tier by name and never pass a number.
 *
 *   chrome  — window-level controls: the header, settings rows
 *   control — controls inside a panel or sidebar, and row actions
 *   inline  — marks that ride along with text: chips, badges, row glyphs
 *   empty   — the panel empty state's main icon, and NOTHING else (change
 *             chrome-followups, design D3): 24 is lucide's own grid, where
 *             ICON_STROKE is the drawn stroke. A tier with no admission rule
 *             becomes "one size up"; `check-app-surface`
 *             (empty-tier-outside-empty-state) holds it to PanelEmpty.
 *
 * ONE STROKE WIDTH for every glyph, in the icon set's 24-unit viewBox, also
 * only here. lucide's default 2 reads heavy at 12–16px; 1.5 matches the
 * hairline chrome around it. The editor's raw-DOM glyphs (no React there)
 * interpolate the same constant into their SVG strings rather than writing
 * their own.
 */
export const ICON_SIZE = { chrome: 16, control: 14, inline: 12, empty: 24 } as const;
export type IconTier = keyof typeof ICON_SIZE;
export const ICON_STROKE = 1.5;
