/**
 * Theming — pixel art.
 *
 * Entirely client-side: nothing here is sent to the server, and your opponent
 * never sees your choices.
 *
 * Chrome colours become CSS custom properties so a change repaints everything
 * without React re-rendering the tree. Ink colours stay plain hex in JS because
 * the UI mixes them (color-mix) per element.
 *
 * The look: everything is drawn in one pixel size (--p, set by the app from
 * the screen size) over a dithered pixel sky. Palettes lean on Celeste's
 * night levels; ink swatches are the block palette.
 */

export const PRESETS = {
  aquarium: {
    label: "AQUARIUM",
    ground: "#1B1A21", panel: "#2B2932", line: "#4A4656", cell: "#232129",
    text: "#F2E8D2", dim: "#ABA1CF",
    you: "#B4A3EE", rival: "#EAD6A4", special: "#7CC7BF",
  },
  dream: {
    label: "DREAM",
    ground: "#0F0C29", panel: "#231C5A", line: "#3D3488", cell: "#1A1546",
    text: "#F4F0FF", dim: "#9C93D6",
    you: "#5EA0C1", rival: "#DB4F6D", special: "#C1C15E",
  },
  farewell: {
    label: "FAREWELL",
    ground: "#170D30", panel: "#3A2470", line: "#5E3FA0", cell: "#23164A",
    text: "#FFF0FA", dim: "#B79AD8",
    you: "#B25EC1", rival: "#5EA0C1", special: "#C1C15E",
  },
  summit: {
    label: "SUMMIT",
    ground: "#1D0E17", panel: "#4A1F2C", line: "#7A3A45", cell: "#2A121C",
    text: "#FFF1E6", dim: "#D09A8E",
    you: "#C18A5E", rival: "#5E63C1", special: "#C1C15E",
  },
  forest: {
    label: "FOREST",
    ground: "#0A1A14", panel: "#1F4030", line: "#2F6046", cell: "#11261C",
    text: "#EFFFF0", dim: "#8FBFA2",
    you: "#6DC15E", rival: "#DB4F6D", special: "#C1C15E",
  },
  snow: {
    label: "SNOW",
    ground: "#B9C4E4", panel: "#E8ECF8", line: "#8F99C2", cell: "#A9B4D8",
    text: "#1A1F3A", dim: "#4C5584",
    you: "#5E63C1", rival: "#DB4F6D", special: "#C18A5E",
  },
  mono: {
    label: "MONO",
    ground: "#0C0C0E", panel: "#2A2A30", line: "#4A4A52", cell: "#18181C",
    text: "#F2F2F2", dim: "#9A9AA2",
    you: "#BBBBBB", rival: "#828282", special: "#C1C15E",
  },
};

/** Ink swatches offered in the customiser — the block palette. */
export const INKS = [
  "#B4A3EE", "#EAD6A4", "#7CC7BF", "#DB4F6D", "#C18A5E", "#C1C15E", "#6DC15E", "#5EA0C1",
  "#5E63C1", "#B25EC1", "#BBBBBB", "#828282",
];

/** How a claimed square is drawn. */
export const STROKES = {
  pixel: { label: "PIXEL" },
  flat: { label: "FLAT" },
  outline: { label: "OUTLINE" },
};

// Space between squares, in pixel units (--p), not screen px. Squares never touch.
export const GRID_GAPS = [1, 2, 3];

export const defaultTheme = () => ({
  preset: "aquarium",
  ...stripLabel(PRESETS.aquarium),
  stroke: "pixel",
  gap: 1,
  colorblind: false,
  motion: true,
  haptics: true,
  showTimer: true,
  sound: 7,          // 0 (off) to 10
});

function stripLabel(p) {
  const { label, ...rest } = p;
  return rest;
}

export function applyPreset(theme, key) {
  return { ...theme, preset: key, ...stripLabel(PRESETS[key]) };
}

/** Any manual colour edit drops the preset label — it isn't that preset any more. */
export const editTheme = (theme, patch) => ({ ...theme, ...patch, preset: "custom" });

// v7: aquarium palette and glass board. Older saves start fresh on it.
const KEY = "tb:theme:v7";

export function loadTheme() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return defaultTheme();
    const t = { ...defaultTheme(), ...JSON.parse(raw) };
    if (!STROKES[t.stroke]) t.stroke = "pixel";
    if (!GRID_GAPS.includes(t.gap)) t.gap = 1;
    return t;
  } catch {
    return defaultTheme();
  }
}

export function saveTheme(t) {
  try { localStorage.setItem(KEY, JSON.stringify(t)); } catch { /* private mode: keep it for this session */ }
}

/** Perceived luminance — light themes get dark glass edges instead of light ones. */
export function isLight(hex) {
  const h = String(hex).replace("#", "");
  if (h.length < 6) return false;
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.6;
}

/** The CSS custom properties the app injects. */
export function themeVars(t) {
  const light = isLight(t.ground);
  // On a dark sky glass catches white light; on a pale one it reads as tinted shade.
  const shine = light ? "255,255,255" : "255,255,255";
  const shade = light ? "20,27,51" : "0,0,0";
  return `
    --tb-ground: ${t.ground};
    --tb-panel: color-mix(in srgb, ${t.panel} ${light ? 88 : 80}%, transparent);
    --tb-panel-solid: ${t.panel};
    --tb-line: ${t.line};
    --tb-cell: color-mix(in srgb, ${t.cell} 55%, transparent);
    --tb-text: ${t.text};
    --tb-dim: ${t.dim};
    --tb-bad: #FF5A6E;
    --tb-good: #4DFFB0;
    --tb-special: ${t.special};
    --tb-you: ${t.you};
    --tb-rival: ${t.rival};
    --tb-edge: rgba(${shine}, ${light ? 0.75 : 0.16});
    --tb-edge-strong: rgba(${shine}, ${light ? 0.95 : 0.32});
    --tb-shade: rgba(${shade}, ${light ? 0.16 : 0.35});
    --tb-glow-a: ${light ? 0.25 : 0.55};
  `;
}
