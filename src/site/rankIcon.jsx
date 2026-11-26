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
  const cells = new Map(); // "x,y" -> row within the glyph (for the bands)
  const put = (g, ox, oy) => g.forEach((row, y) => [...row].forEach((b, x) => { if (b === "1") cells.set(`${x + ox},${y + oy}`, y + oy); }));
  put(letter, 0, 0);
  if (mod) put(mod, 7, Math.round((8 - mod.length) / 2));
  const w = mod ? 13 : 6, h = 8;
  const base = hexRgb(color);
  const has = (x, y) => cells.has(`${x},${y}`);
  // Lit from the top left, like the sun on it: a hard shadow falls down and
  // to the right; edges facing the light are bright, edges facing away dark.
  const out = { w: w + 2, h: h + 2, px: [] };
  for (const k of cells.keys()) {
    const [x, y] = k.split(",").map(Number);
    for (const [dx, dy, a] of [[2, 2, 0.28], [1, 1, 0.6]]) if (!has(x + dx, y + dy)) out.px.push([x + dx, y + dy, `rgba(6,4,18,${a})`]);
  }
  for (const [k, row] of cells) {
    const [x, y] = k.split(",").map(Number);
    const t = row / 7;
    const lit = !has(x, y - 1) || !has(x - 1, y), away = !has(x, y + 1) || !has(x + 1, y);
    let c = t < 0.35 ? mix(base, W, 0.3) : t < 0.7 ? `rgb(${base.join(",")})` : mix(base, K, 0.18);
    if (away) c = mix(base, K, 0.35);
    if (lit) c = mix(base, W, 0.4);
    if (!has(x, y - 1) && !has(x - 1, y)) c = mix(base, W, 0.85);
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
