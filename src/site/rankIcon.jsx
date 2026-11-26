/**
 * Ranks are their letters, made as flashy as a pixel can be: chunky italic
 * capitals (each row nudged right as it rises), banded like chrome (bright
 * top, a dark horizon line through the middle, a second shine below), lit
 * from the top left with a two-step shadow falling down and right, the + or −
 * as a superscript. `size` is the height.
 */
import { RANKS } from "../../shared/glicko.js";

const GLYPH = {
  F: ["11111111", "11111111", "111.....", "111.....", "1111111.", "1111111.", "111.....", "111.....", "111.....", "111....."],
  C: [".1111111", "11111111", "111.....", "111.....", "111.....", "111.....", "111.....", "111.....", "11111111", ".1111111"],
  B: ["111111..", "1111111.", "111..111", "111..111", "1111111.", "1111111.", "111..111", "111..111", "1111111.", "1111111."],
  A: [".111111.", "11111111", "111..111", "111..111", "111..111", "11111111", "11111111", "111..111", "111..111", "111..111"],
  S: [".1111111", "11111111", "111.....", "111.....", "1111111.", ".1111111", ".....111", ".....111", "11111111", "1111111."],
  X: ["111..111", "111..111", "111..111", ".111111.", "..1111..", "..1111..", ".111111.", "111..111", "111..111", "111..111"],
  "?": [".111111.", "11111111", "111..111", ".....111", "....1111", "...1111.", "...111..", "........", "...111..", "...111.."],
};
const MOD = { "+": ["..11..", "..11..", "111111", "111111", "..11..", "..11.."], "-": ["1111", "1111"] };
const hexRgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const mix = (a, b, t) => `rgb(${a.map((v, i) => Math.round(v + (b[i] - v) * t)).join(",")})`;
const W = [255, 255, 255], K = [10, 8, 22];
// Chrome bands, top to bottom (+ toward white, − toward the dark).
const BANDS = [0.72, 0.5, 0.3, 0.12, 0, -0.16, 0.16, 0.04, -0.1, -0.24];
const ROWS = 10;
const slant = (y) => Math.floor((ROWS - 1 - y) / 3); // italic: a step right every three rows up

const cache = new Map();
function build(name, color) {
  const key = name + color;
  if (cache.has(key)) return cache.get(key);
  const letter = GLYPH[name[0]] || GLYPH["?"], mod = MOD[name[1]] || null;
  const cells = new Map(); // "x,y" -> band index
  if (name[0] === "X") {
    // X is two straight strokes crossing on a leaning axis, drawn as lines, so
    // the notches at the top and bottom come to a sharp V.
    for (let y = 0; y < ROWS; y++) {
      // (2-pixel strokes: on a diagonal they read as heavy as the other letters' 3-pixel ones.)
      const off = (ROWS - 1 - y) / 3, d = (y - (ROWS - 1) / 2) * 0.8;
      for (const e of [4 + d + off, 4 - d + off]) for (let dx = 0; dx < 2; dx++) cells.set(`${Math.round(e - 0.5) + dx + 1},${y + 2}`, y);
    }
  } else letter.forEach((row, y) => [...row].forEach((b, x) => { if (b === "1") cells.set(`${x + slant(y) + 1},${y + 2}`, y); }));
  // The mark as a superscript, top right, banded on its own.
  if (mod) mod.forEach((row, y) => [...row].forEach((b, x) => { if (b === "1") cells.set(`${x + 14},${y + (mod.length === 2 ? 4 : 2)}`, Math.min(ROWS - 1, Math.round((y / (mod.length - 1 || 1)) * (ROWS - 1)))); }));
  const base = hexRgb(color);
  const has = (x, y) => cells.has(`${x},${y}`);
  const xs = [...cells.keys()].map((k) => Number(k.split(",")[0]));
  const out = { w: Math.max(...xs) + 3, h: ROWS + 4, px: [] };
  // A hard shadow down and to the right, in a deep shade of the rank's colour.
  for (const k of cells.keys()) {
    const [x, y] = k.split(",").map(Number);
    if (!has(x + 1, y + 1)) out.px.push([x + 1, y + 1, mix(base, K, 0.7)]);
  }
  for (const [k, band] of cells) {
    const [x, y] = k.split(",").map(Number);
    const t = BANDS[band];
    let c = t > 0 ? mix(base, W, t) : t < 0 ? mix(base, K, -t) : `rgb(${base.join(",")})`;
    if (!has(x, y - 1)) c = mix(base, W, 0.6);                      // top edges catch the light
    if (!has(x, y - 1) && !has(x - 1, y)) c = "rgb(255,255,255)";   // the brightest corner
    out.px.push([x, y, c]);
  }
  // A sparkle over the top right of the letter; bigger on the top ranks.
  cache.set(key, out);
  return out;
}

/** A rank as its letter. `rank` is a RANKS entry or a rank's name; null draws a grey "?". */
export function RankIcon({ rank, size = 32, title }) {
  const r = typeof rank === "string" ? RANKS.find((x) => x.name === rank) : rank;
  const g = build(r ? r.name : "?", r ? r.color : "#7A7694");
  return (
    <svg role="img" aria-label={title || (r ? `Rank ${r.name}` : "Unplaced")} viewBox={`0 0 ${g.w} ${g.h}`}
      style={{ height: size, width: "auto", aspectRatio: `${g.w} / ${g.h}`, display: "block", flexShrink: 0, shapeRendering: "crispEdges", overflow: "visible" }}>
      {g.px.map(([x, y, c], i) => <rect key={i} x={x} y={y} width="1.02" height="1.02" fill={c} />)}
    </svg>
  );
}
