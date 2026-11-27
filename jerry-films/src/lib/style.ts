// Jerry Films house look: soft clay-like shading on a cool blue-grey backdrop.
export const W = 1080;
export const H = 1920;
export const FPS = 30;

export const C = {
  bgTop: "#9fb9cc",
  bgBottom: "#4f6a80",
  skin: "#e9b59a",
  lip: "#c46a66",
  mouth: "#3a0e14",
  hair: "#3b2a22",
  duck: "#ffcc1a",
  beak: "#ff7b1c",
  flesh: "#d9707f",
  fleshDeep: "#a8435a",
  acid: "#a5e63a",
};

export const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
export const smooth = (x: number) => {
  const t = clamp01(x);
  return t * t * (3 - 2 * t);
};
// 0 → 1 → 0 pulse centred on `at` (seconds), half-width `w`.
export const pulse = (t: number, at: number, w: number) => {
  const d = Math.abs(t - at) / w;
  return d >= 1 ? 0 : 0.5 + 0.5 * Math.cos(Math.PI * d);
};
// Deterministic pseudo-random in [0,1).
export const rand = (i: number) => {
  const x = Math.sin(i * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
};
