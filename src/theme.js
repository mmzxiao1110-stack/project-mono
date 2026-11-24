/**
 * Theming — pixel glass.
 *
 * Entirely client-side: nothing here is sent to the server, and your opponent
 * never sees your choices.
 *
 * Chrome colours become CSS custom properties so a change repaints everything
 * without React re-rendering the tree. Ink colours stay plain hex in JS because
 * the UI mixes them (color-mix) per element.
 *
 * The look: frosted, translucent panels with stepped pixel corners floating
 * over a slowly moving pixelated sky. `panel` is the tint of the glass;
 * the CSS turns it see-through.
 */

export const PRESETS = {
  neon: {
    label: "NEON",
    ground: "#0A0A1F", panel: "#1C1F4A", line: "#3A3F7A", cell: "#14163A",
    text: "#EAF2FF", dim: "#8B93C9",
    you: "#43E8FF", rival: "#FF4FD8", special: "#FFD447",
  },
  sunset: {
    label: "SUNSET",
    ground: "#170A1C", panel: "#3A1A3E", line: "#6B3460", cell: "#24102A",
    text: "#FFEFF6", dim: "#C58DB0",
    you: "#FFB547", rival: "#8F7BFF", special: "#FFE45C",
  },
  mint: {
    label: "MINT",
    ground: "#061614", panel: "#123A34", line: "#24605A", cell: "#0C2420",
    text: "#E8FFF7", dim: "#7FB9AA",
    you: "#4DFFB0", rival: "#FF6B7A", special: "#FFE45C",
  },
  ember: {
    label: "EMBER",
    ground: "#140A06", panel: "#3A1C10", line: "#6E3A22", cell: "#22110A",
    text: "#FFF1E6", dim: "#C99A7E",
    you: "#FF8A3D", rival: "#46C8FF", special: "#FFE066",
  },
  frost: {
    label: "FROST",
    ground: "#C9D6F0", panel: "#FFFFFF", line: "#8EA0C8", cell: "#B4C3E4",
    text: "#141B33", dim: "#4F5B82",
    you: "#2F6BFF", rival: "#FF3D71", special: "#E59A00",
  },
  mono: {
    label: "MONO",
    ground: "#0B0B0D", panel: "#26262C", line: "#45454F", cell: "#16161A",
    text: "#F4F4F6", dim: "#9A9AA6",
    you: "#F4F4F6", rival: "#7E7E8C", special: "#FFD447",
  },
};

/** Ink swatches offered in the customiser. */
export const INKS = [
  "#43E8FF", "#FF4FD8", "#FFD447", "#4DFFB0", "#FF8A3D", "#8F7BFF",
  "#FF6B7A", "#46C8FF", "#2F6BFF", "#FF3D71", "#F4F4F6", "#7E7E8C",
];

/** How a claimed square is drawn. */
export const STROKES = {
  glass: { label: "GLASS" },
  solid: { label: "SOLID" },
  outline: { label: "OUTLINE" },
};

export const GRID_GAPS = [0, 1, 2, 3, 4];

export const defaultTheme = () => ({
  preset: "neon",
  ...stripLabel(PRESETS.neon),
  stroke: "glass",
  gap: 2,
  colorblind: false,
  motion: true,
  haptics: true,
  showTimer: true,
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

// v5: pixel glass. Older saves were for looks that no longer exist.
const KEY = "tb:theme:v5";

export function loadTheme() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return defaultTheme();
    const t = { ...defaultTheme(), ...JSON.parse(raw) };
    if (!STROKES[t.stroke]) t.stroke = "glass";
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
    --tb-panel: color-mix(in srgb, ${t.panel} ${light ? 62 : 58}%, transparent);
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
