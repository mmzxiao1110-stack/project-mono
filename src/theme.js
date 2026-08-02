/**
 * Theming. Entirely client-side — nothing here is ever sent to the server, and
 * your opponent never sees your choices.
 *
 * Chrome colours become CSS custom properties so a change repaints everything
 * without React re-rendering the tree. Ink colours stay plain hex in JS because
 * the UI does alpha maths on them (`${ink}22`), which CSS vars can't do.
 */

export const PRESETS = {
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
  "#22D3EE", "#4ADE80", "#A78BFA", "#F472B6", "#FB923C",
  "#F87171", "#60A5FA", "#FDE047", "#2DD4BF", "#E2E8F0",
  "#0F766E", "#B91C1C",
];

/** How a claimed square is drawn. */
export const SHAPES = {
  square: { label: "SQUARE", radius: 0, inset: 0, hollow: false },
  soft: { label: "SOFT", radius: 2, inset: 0, hollow: false },
  round: { label: "ROUND", radius: 5, inset: 0, hollow: false },
  pill: { label: "PILL", radius: 999, inset: 0, hollow: false },
  inset: { label: "INSET", radius: 3, inset: 2, hollow: false },
  outline: { label: "OUTLINE", radius: 2, inset: 0, hollow: true },
};

export const GRID_GAPS = [0, 1, 2, 3, 5];

export const defaultTheme = () => ({
  preset: "slate",
  ...stripLabel(PRESETS.slate),
  shape: "soft",
  gap: 2,
  frame: false,       // false = only the slots, no board behind them
  staticField: false, // true = backdrop frozen at full pulse (low-power devices)
  colorblind: false,
  motion: true,
  haptics: true,
  showTimer: true,
  boardGlow: false,
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

const KEY = "tb:theme";

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

/** The CSS the app injects. Chrome only — inks stay in JS. */
export function themeVars(t) {
  return `
    --tb-ground: ${t.ground};
    --tb-panel: ${t.panel};
    --tb-line: ${t.line};
    --tb-cell: ${t.cell};
    --tb-text: ${t.text};
    --tb-dim: ${t.dim};
    --tb-bad: #EF6B6B;
    --tb-good: #5CAF83;
    --tb-special: ${t.special};
  `;
}