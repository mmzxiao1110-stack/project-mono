/**
 * Profile card options, shared by the client (the picker, the card) and the
 * server (which stores only these, nothing free-form). A card is
 *   { sky, accent, pattern }
 *   sky      one of SKIES: the dithered background, from a theme's colours
 *   accent   0..INK_COUNT-1: the block palette (borders, light, the name glow)
 *   pattern  one of PATTERNS: what drifts across the sky
 */
export const SKIES = {
  aquarium: ["#1B1A21", "#2B2932", "#7CC7BF", "#B4A3EE"],
  dream: ["#0F0C29", "#231C5A", "#5EA0C1", "#DB4F6D"],
  farewell: ["#170D30", "#3A2470", "#B25EC1", "#5EA0C1"],
  summit: ["#1D0E17", "#4A1F2C", "#C18A5E", "#5E63C1"],
  forest: ["#0A1A14", "#1F4030", "#6DC15E", "#C1C15E"],
  abyss: ["#05060F", "#0E1A3A", "#2F6FA8", "#7CC7BF"],
  nebula: ["#120A22", "#341552", "#B25EC1", "#DB4F6D"],
  mono: ["#0C0C0E", "#2A2A30", "#BBBBBB", "#828282"],
};
export const CARD_INKS = ["#B4A3EE", "#EAD6A4", "#7CC7BF", "#DB4F6D", "#C18A5E", "#C1C15E", "#6DC15E", "#5EA0C1", "#5E63C1", "#B25EC1", "#BBBBBB", "#F2E8D2"];
export const PATTERNS = ["waves", "stars", "bubbles", "grid"];
export const CARD_DEFAULT = { sky: "dream", accent: 2, pattern: "waves" };
/** A stored card, made safe: anything unknown falls back to the default. */
export function cleanCard(c) {
  const o = c && typeof c === "object" && !Array.isArray(c) ? c : {};
  return {
    sky: Object.prototype.hasOwnProperty.call(SKIES, o.sky) ? o.sky : CARD_DEFAULT.sky,
    accent: Number.isInteger(o.accent) && o.accent >= 0 && o.accent < CARD_INKS.length ? o.accent : CARD_DEFAULT.accent,
    pattern: PATTERNS.includes(o.pattern) ? o.pattern : CARD_DEFAULT.pattern,
  };
}
