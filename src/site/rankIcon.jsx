/**
 * Ranks are their letters, like a fighting game's: chunky pixel capitals
 * with two-pixel strokes, banded from a light top to a deep bottom in the
 * rank's colour, a dark outline, a drop shadow and a glint, and the + or −
 * set beside the letter. `size` is the height (a number of px or a CSS length).
 */
import { RANKS } from "../../shared/glicko.js";

const GLYPH = {
  F: ["111111", "111111", "11....", "11111.", "11111.", "11....", "11....", "11...."],
  C: [".11111", "111111", "11....", "11....", "11....", "11....", "111111", ".11111"],
  B: ["11111.", "111111", "11..11", "11111.", "11111.", "11..11", "111111", "11111."],
  A: [".1111.", "111111", "11..11", "11..11", "111111", "111111", "11..11", "11..11"],
  S: [".11111", "111111", "11....", "11111.", ".11111", "....11", "111111", "11111."],
  X: ["11..11", "11..11", ".1111.", "..11..", "..11..", ".1111.", "11..11", "11..11"],
  "?": [".1111.", "111111", "11..11", "...111", "..111.", "..11..", "......", "..11.."],
};
const MOD = { "+": ["..11..", "..11..", "111111", "111111", "..11..", "..11.."], "-": ["11111", "11111"] };
const hexRgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const mix = (a, b, t) => `rgb(${a.map((v, i) => Math.round(v + (b[i] - v) * t)).join(",")})`;
const W = [255, 255, 255], K = [10, 8, 22];

const cache = new Map();
function build(name, color) {
  const key = name + color;
  if (cache.has(key)) return cache.get(key);
  const letter = GLYPH[name[0]] || GLYPH["?"], mod = MOD[name[1]] || null;
  const cells = new Map(); // "x,y" -> row within the glyph (for shading)
  const put = (g, ox, oy) => g.forEach((row, y) => [...row].forEach((b, x) => { if (b === "1") cells.set(`${ox + x},${oy + y}`, y + oy); }));
  // One pixel of margin all round for the outline; the mark sits mid-height beside the letter.
  put(letter, 1, 1);
  if (mod) put(mod, 8, 1 + Math.round((8 - mod.length) / 2));
  const w = mod ? 16 : 9, h = 10;
  const base = hexRgb(color);
  const has = (x, y) => cells.has(`${x},${y}`);
  const out = { w: w + 1, h: h + 1, px: [] };
  // Shadow, outline, then the letter in bands.
  const outline = new Set();
  for (const k of cells.keys()) {
    const [x, y] = k.split(",").map(Number);
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (!has(x + dx, y + dy)) outline.add(`${x + dx},${y + dy}`);
  }
  for (const k of outline) { const [x, y] = k.split(",").map(Number); out.px.push([x + 1, y + 1, "rgba(0,0,0,.45)"]); }
  for (const k of outline) { const [x, y] = k.split(",").map(Number); out.px.push([x, y, mix(base, K, 0.72)]); }
  for (const [k, row] of cells) {
    const [x, y] = k.split(",").map(Number);
    const t = (row - 1) / 7; // 0 top … 1 bottom
    let c = t < 0.2 ? mix(base, W, 0.55) : t < 0.45 ? mix(base, W, 0.25) : t < 0.75 ? `rgb(${base.join(",")})` : mix(base, K, 0.3);
    if (!has(x - 1, y) && !has(x, y - 1)) c = mix(base, W, 0.8); // a glint on each top-left corner
    out.px.push([x, y, c]);
  }
  cache.set(key, out);
  return out;
}

/** A rank as its letter. `rank` is a RANKS entry or a rank's name; null draws a grey "?". */
export function RankIcon({ rank, size = 32, title }) {
  const r = typeof rank === "string" ? RANKS.find((x) => x.name === rank) : rank;
  const g = build(r ? r.name : "?", r ? r.color : "#6E6A86");
  return (
    <svg role="img" aria-label={title || (r ? `Rank ${r.name}` : "Unplaced")} viewBox={`0 0 ${g.w} ${g.h}`}
      style={{ height: size, width: "auto", aspectRatio: `${g.w} / ${g.h}`, display: "block", flexShrink: 0, shapeRendering: "crispEdges", overflow: "visible" }}>
      {g.px.map(([x, y, c], i) => <rect key={i} x={x} y={y} width="1.02" height="1.02" fill={c} />)}
    </svg>
  );
}
