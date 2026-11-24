/**
 * Theming. Entirely client-side — nothing here is ever sent to the server, and
 * your opponent never sees your choices.
 *
 * Chrome colours become CSS custom properties so a change repaints everything
 * without React re-rendering the tree. Ink colours stay plain hex in JS because
 * the UI does alpha maths on them (`${ink}22`), which CSS vars can't do.
 */

import { frameUrl, frameImage, ruleUrl, shadeUrl, withAlpha, GRAIN_URL } from "./sketch.js";
import { FX } from "./tuning.js";

export const PRESETS = {
  // Default: soft graphite and coloured pencil on black paper.
  graphite: {
    label: "GRAPHITE",
    ground: "#161514", panel: "#1C1B19", line: "#4B4843", cell: "#1F1E1B",
    text: "#D6D2CA", dim: "#8B8780",
    you: "#CFCAC0", rival: "#C65A4D", special: "#C99B48",
  },
  // Pencil the way it usually is: grey lead on cream paper.
  sketchbook: {
    label: "SKETCHBOOK",
    ground: "#ECE7DC", panel: "#F2EEE5", line: "#B5AEA1", cell: "#E3DDD0",
    text: "#383632", dim: "#7D776C",
    you: "#3D3B37", rival: "#B4463D", special: "#A97A22",
  },
  sepia: {
    label: "SEPIA",
    ground: "#1A130D", panel: "#22190F", line: "#5A4632", cell: "#251B12",
    text: "#E4D2B2", dim: "#9C8466",
    you: "#E0CBA6", rival: "#6FA3B5", special: "#D9A441",
  },
  // Blue lead and red pencil on drafting paper.
  blueprint: {
    label: "DRAFTING",
    ground: "#E9ECEA", panel: "#F1F3F1", line: "#AEB9C0", cell: "#DFE4E3",
    text: "#2F3A44", dim: "#6E7C88",
    you: "#2F5D8A", rival: "#B4463D", special: "#B0872D",
  },
  slate: {
    label: "SLATE",
    ground: "#0E1216", panel: "#151B21", line: "#222C35", cell: "#171E25",
    text: "#C7D2DC", dim: "#6B7A88",
    you: "#22D3EE", rival: "#F472B6", special: "#F2B33D",
  },
  carbon: {
    label: "CARBON",
    ground: "#0A0A0B", panel: "#141416", line: "#26262A", cell: "#1A1A1D",
    text: "#E4E4E7", dim: "#71717A",
    you: "#FAFAFA", rival: "#F87171", special: "#FBBF24",
  },
  moss: {
    label: "MOSS",
    ground: "#0C1310", panel: "#131D18", line: "#20302A", cell: "#16211C",
    text: "#CFE0D6", dim: "#6E8579",
    you: "#4ADE80", rival: "#FB923C", special: "#FDE047",
  },
  ultra: {
    label: "ULTRA",
    ground: "#0B0A18", panel: "#141227", line: "#241F42", cell: "#181530",
    text: "#D6D2F0", dim: "#7A72A8",
    you: "#A78BFA", rival: "#22D3EE", special: "#F472B6",
  },
  ember: {
    label: "EMBER",
    ground: "#140D0B", panel: "#1E1512", line: "#33231D", cell: "#241914",
    text: "#EBD9CF", dim: "#96796C",
    you: "#FB923C", rival: "#60A5FA", special: "#FCD34D",
  },
  paper: {
    label: "PAPER",
    ground: "#F2EFE8", panel: "#FBFAF7", line: "#D8D2C6", cell: "#E5E0D5",
    text: "#26231F", dim: "#7C746A",
    you: "#0F766E", rival: "#B91C1C", special: "#A16207",
  },
  mono: {
    label: "MONO",
    ground: "#101010", panel: "#181818", line: "#2A2A2A", cell: "#1D1D1D",
    text: "#EDEDED", dim: "#767676",
    you: "#EDEDED", rival: "#6E6E6E", special: "#B8B8B8",
  },
};

/** Ink swatches offered in the customiser. */
export const INKS = [
  "#CFCAC0", "#3D3B37", "#C65A4D", "#C99B48", "#2F5D8A", "#6FA3B5",
  "#22D3EE", "#4ADE80", "#A78BFA", "#F472B6", "#FB923C",
  "#F87171", "#60A5FA", "#FDE047", "#2DD4BF", "#E2E8F0",
  "#0F766E", "#B91C1C",
];

/**
 * How a claimed square is inked. The two players always stroke in opposite
 * directions, so the board reads by texture as well as by colour.
 */
export const STROKES = {
  hatch: { label: "HATCH" },
  cross: { label: "CROSS" },
  scribble: { label: "SCRIBBLE" },
  shaded: { label: "SHADED" },
  outline: { label: "OUTLINE" },
};

export const GRID_GAPS = [0, 1, 2, 3, 5];

export const defaultTheme = () => ({
  preset: "graphite",
  ...stripLabel(PRESETS.graphite),
  stroke: "hatch",
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

// v3: pencil. Older saves were for looks that no longer exist.
const KEY = "tb:theme:v3";

export function loadTheme() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return defaultTheme();
    return { ...defaultTheme(), ...JSON.parse(raw) };
  } catch (e) {
    return defaultTheme();
  }
}

export function saveTheme(t) {
  try { localStorage.setItem(KEY, JSON.stringify(t)); } catch (e) {}
}

/** Perceived luminance — used to pick readable marks on top of ink. */
export function isLight(hex) {
  const h = String(hex).replace("#", "");
  if (h.length < 6) return false;
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.6;
}

/**
 * The CSS the app injects. Chrome only — inks stay in JS.
 *
 * Sketched frames can't take var() inside their SVG, so each one is baked here
 * from the theme's hex values and handed to CSS as a ready-made image.
 */
export function themeVars(t) {
  const S = FX.sketch;
  const frame = (name, color, opts) => `--tb-sk-${name}: ${frameUrl(color, opts)};`;
  return `
    --tb-ground: ${t.ground};
    --tb-panel: ${t.panel};
    --tb-line: ${t.line};
    --tb-cell: ${t.cell};
    --tb-text: ${t.text};
    --tb-dim: ${t.dim};
    --tb-bad: #D9574B;
    --tb-good: #7FA77A;
    --tb-special: ${t.special};
    ${frame("line", t.line)}
    ${frame("dim", t.dim)}
    ${frame("text", t.text, { weight: 1.6 })}
    ${frame("special", t.special, { weight: 1.6 })}
    ${frame("special-soft", withAlpha(t.special, 0.55))}
    ${frame("bad", withAlpha("#D9574B", 0.7))}
    --tb-shade-text: ${shadeUrl(t.text)};
    --tb-shade-dim: ${shadeUrl(t.dim, { light: true })};
    --tb-shade-text-dense: ${shadeUrl(t.text, { dense: true })};
    --tb-shade-dim-dense: ${shadeUrl(t.dim, { dense: true })};
    --tb-rule: ${ruleUrl(t.line)};
    --tb-grain: ${GRAIN_URL};
    --tb-grain-o: ${S.grain};
    --tb-vignette: ${S.vignette};
  `;
}

export { frameUrl, frameImage };
