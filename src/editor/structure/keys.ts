/** The six keys the structure entry owns (spec: structure-input / 结构键只有一个入口). */
export const STRUCTURE_KEYS = ["Enter", "Tab", "Shift-Tab", "Backspace", "Mod-]", "Mod-["] as const;

export type StructureKey = (typeof STRUCTURE_KEYS)[number];
