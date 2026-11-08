/**
 * The LANDING FLASH, the script half (spec: app-chrome / 落地闪是注意力,不是状态;
 * change flat-states, design D12). "You were moved here" is attention, not a
 * state: it is not "I am selected", so it must never look like the selected
 * fill. Its look has ONE definition in src/index.css (`[data-flash]`): a bloom
 * that fades out, coloured by who moved you. An element only declares
 * `data-flash="agent" | "human"` and drops it after FLASH_MS.
 */

/** Who moved the user here — the only thing that decides the flash colour. */
export type FlashActor = "agent" | "human";

/** The attribute the one definition keys on. */
export const FLASH_ATTR = "data-flash";

/**
 * How long the attribute stays: a little over the 1.5s bloom in index.css, so
 * the animation finishes, and the reduced-motion static tint (no animation, so
 * no animationend) is still cleared on the same path.
 */
export const FLASH_MS = 1600;
