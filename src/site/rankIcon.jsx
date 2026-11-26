/**
 * Rank emblems, as 16×16 pixel art in shades of each rank's colour. Each tier
 * has its own shape, getting grander as you climb:
 *   F  a plain plate        C  a shield          B  a crested shield
 *   A  a winged shield      S  a crowned shield  X  a shining diamond
 * with the letter, and the + or −, drawn in.
 */
import { RANKS } from "../../shared/glicko.js";

const N = 16, C = 7.5;
const hexRgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const mix = (a, b, t) => `rgb(${a.map((v, i) => Math.round(v + (b[i] - v) * t)).join(",")})`;
const W = [255, 255, 255], K = [12, 10, 24];

const shield = (x, y) => {
  if (y < 1 || y > 14) return false;
  const w = y <= 8 ? 6 : 6 - (y - 8) * 1.05;
  return Math.abs(x - C) <= w;
};
const SHAPES = {
  F: (x, y) => Math.abs(x - C) <= 5.5 && Math.abs(y - C) <= 5.5 && !(Math.abs(x - C) > 4.5 && Math.abs(y - C) > 4.5),
  C: shield,
  // B: a shield with a notched crest along the top.
  B: (x, y) => shield(x, y) && !(y === 1 && (x === 5 || x === 10)),
  // A: a shield with a wing either side.
  A: (x, y) => {
    if (shield(x, y) && Math.abs(x - C) <= 4.5) return true;
    const dx = Math.abs(x - C);
    return dx > 4.5 && dx <= 7.5 && y >= 2 + (dx - 4.5) && y <= 9 - (dx - 4.5) * 0.6;
  },
  // S: a shield wearing a three-pointed crown.
  S: (x, y) => (y >= 3 && shield(x, y)) || (y < 3 && [3, 4, 7, 8, 11, 12].includes(x) && (y >= 1 || x === 7 || x === 8)),
  // X: a diamond.
  X: (x, y) => Math.abs(x - C) + Math.abs(y - C) <= 7.6,
};
// 3×5 letters, and 3×3 marks for + and −.
const GLYPH = {
  F: ["111", "100", "110", "100", "100"], C: ["011", "100", "100", "100", "011"], B: ["110", "101", "110", "101", "110"],
  A: ["010", "101", "111", "101", "101"], S: ["011", "100", "010", "001", "110"], X: ["101", "101", "010", "101", "101"],
};
const MARK = { "+": ["010", "111", "010"], "-": ["000", "111", "000"] };

const cache = new Map();
function pixels(name, color) {
  const key = `${name}${color}`;
  if (cache.has(key)) return cache.get(key);
  const tier = name[0], mod = name[1] || "";
  const inside = SHAPES[tier] || SHAPES.F;
  const base = hexRgb(color);
  const m = (x, y) => x >= 0 && y >= 0 && x < N && y < N && inside(x, y);
  const out = [];
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    if (!m(x, y)) continue;
    const edge = !m(x - 1, y) || !m(x + 1, y) || !m(x, y - 1) || !m(x, y + 1);
    const t = (x + y) / (2 * N);
    let c;
    if (edge) c = mix(base, K, 0.6);
    else if (!m(x - 1, y - 1) || (!m(x, y - 2) && x < C)) c = mix(base, W, 0.55);   // the lit rim, top left
    else if (t < 0.38) c = mix(base, W, 0.22);
    else if (t > 0.66) c = mix(base, K, 0.28);
    else c = `rgb(${base.join(",")})`;
    out.push([x, y, c]);
  }
  // The letter (and its shadow), with the + or − beside it.
  const gx = mod ? 4 : 6, gy = tier === "S" ? 6 : 5;
  // Light letters on dark badges, dark letters on light ones (S, X).
  const lum = 0.2126 * base[0] + 0.7152 * base[1] + 0.0722 * base[2];
  const ink = lum > 165 ? mix(base, K, 0.78) : mix(base, W, 0.88), shade = lum > 165 ? mix(base, W, 0.6) : mix(base, K, 0.55);
  const stamp = (g, ox, oy) => g.forEach((row, j) => [...row].forEach((bit, i) => {
    if (bit === "1") { out.push([ox + i + 1, oy + j + 1, shade]); }
  }));
  const paint = (g, ox, oy) => g.forEach((row, j) => [...row].forEach((bit, i) => { if (bit === "1") out.push([ox + i, oy + j, ink]); }));
  stamp(GLYPH[tier] || GLYPH.F, gx, gy); paint(GLYPH[tier] || GLYPH.F, gx, gy);
  if (mod) { stamp(MARK[mod], 9, gy + 1); paint(MARK[mod], 9, gy + 1); }
  // X shines: a few sparkle pixels around it.
  if (tier === "X") for (const [x, y] of [[0, 0], [15, 2], [1, 14], [14, 15], [15, 0]]) out.push([x, y, mix(base, W, 0.8)]);
  if (tier === "S") for (const [x, y] of [[7, 0], [8, 0]]) out.push([x, y, mix(base, W, 0.7)]);
  cache.set(key, out);
  return out;
}

/** A rank's emblem. `rank` is a RANKS entry or a rank's name; null draws an unplaced (grey) plate. */
export function RankIcon({ rank, size = 32, title }) {
  const r = typeof rank === "string" ? RANKS.find((x) => x.name === rank) : rank;
  const name = r ? r.name : "F", color = r ? r.color : "#55526A";
  const px = pixels(r ? name : "F", color);
  return (
    <svg role="img" aria-label={title || (r ? `Rank ${name}` : "Unplaced")} viewBox={`0 0 ${N} ${N}`}
      style={{ width: size, height: size, display: "block", flexShrink: 0, shapeRendering: "crispEdges", opacity: r ? 1 : 0.6 }}>
      {px.map(([x, y, c], i) => <rect key={i} x={x} y={y} width="1" height="1" fill={c} />)}
    </svg>
  );
}
