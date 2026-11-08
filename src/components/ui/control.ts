/**
 * THE CONTROL RULER (spec: app-chrome / 控件只有一把尺子; change
 * control-ruler, design D1).
 *
 * Three tiers, and each tier is ONE HEIGHT — never a height that content,
 * padding or a border happens to push out. Before this table, `md` rendered
 * 24px as a ghost button, 26px as an outline button or a `Select` (their 1px
 * border on top), and the icon buttons had their own padding table (28 / 22 /
 * 16px) that matched no text tier at all. A border now sits INSIDE the height
 * (Tailwind's preflight is border-box), so a tier is the same height in every
 * weight.
 *
 *   tier  height  type          x-pad  icon (square icon-only buttons)
 *   sm    20px    TEXT.note     6px    inline
 *   md    24px    TEXT.label    8px    control
 *   lg    32px    TEXT.body     12px   chrome
 *
 * Read by Button, IconButton, Select, the single-line fields that line up with
 * them, and both tab implementations; the panel tab strip's arithmetic reads
 * `px` (× and ∨ footprints). That last reader is a pure module, which is why
 * the ruler lives HERE and not in Button.tsx: importing a component file
 * would drag JSX into a no-React calculation.
 *
 * `px` and `h` say the same thing twice because Tailwind only generates
 * classes it finds written out in source — a class built from the number at
 * runtime would have no CSS. ui.test.ts asserts the two agree (`h-5` = 20px:
 * Tailwind v4's spacing step is 4px). `padPx` is `x` as a number and `type`
 * names `text`'s tier, for the same reason: the editor core draws its controls
 * with its OWN classes (it ships to hosts with no Tailwind; change:
 * editor-style-tokens, design D5) and reads the ruler as numbers — this table
 * stays the one ruler for both.
 *
 * The corner is not here: a control's corner is `--radius-state`, given by
 * `.om-state` / `.om-field` in index.css (design D2).
 */
import { TEXT } from "./type";

export const CONTROL_SIZE = {
  sm: { px: 20, h: "h-5", square: "size-5", text: TEXT.note, type: "note", x: "px-1.5", padPx: 6, icon: "inline" },
  md: { px: 24, h: "h-6", square: "size-6", text: TEXT.label, type: "label", x: "px-2", padPx: 8, icon: "control" },
  lg: { px: 32, h: "h-8", square: "size-8", text: TEXT.body, type: "body", x: "px-3", padPx: 12, icon: "chrome" },
} as const;

export type ControlSize = keyof typeof CONTROL_SIZE;
