/**
 * The hand-drawn layer.
 *
 * Everything here produces SVG path strings or data URIs. Nothing is random at
 * render time: every stroke comes from a seeded generator, so a square drawn on
 * turn 3 looks identical on turn 30 and React never sees a changing path.
 *
 * Two families of output:
 *   - `inkPaths`  — the marks inside one board square (hatching, outline…).
 *   - `frameUrl`  — a sketched rectangle as a 9-slice border-image, so any
 *                   button or panel gets a pencil frame with one style rule.
 */
import { FX } from "./tuning.js";

/** Small fast PRNG (mulberry32). Same seed, same strokes. */
export function rng(seed) {
  let a = (seed * 2654435761) >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const f = (n) => Math.round(n * 10) / 10;

/** One pencil stroke from (x1,y1) to (x2,y2), bowed slightly off true. */
function stroke(x1, y1, x2, y2, bow, r) {
  const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
  const dx = x2 - x1, dy = y2 - y1;
  const len = Math.hypot(dx, dy) || 1;
  const off = (r() - 0.5) * 2 * bow;
  const cx = mx - (dy / len) * off, cy = my + (dx / len) * off;
  return `M${f(x1)} ${f(y1)}Q${f(cx)} ${f(cy)} ${f(x2)} ${f(y2)}`;
}

/**
 * A rectangle drawn as four separate strokes that overshoot their corners —
 * the way a quick pencil box actually looks.
 */
function roughRect(x0, y0, x1, y1, jit, over, r) {
  const j = () => (r() - 0.5) * 2 * jit;
  const o = () => over * (0.3 + r() * 0.9);
  const c = [[x0 + j(), y0 + j()], [x1 + j(), y0 + j()], [x1 + j(), y1 + j()], [x0 + j(), y1 + j()]];
  let d = "";
  for (let i = 0; i < 4; i++) {
    const [ax, ay] = c[i], [bx, by] = c[(i + 1) % 4];
    const dx = bx - ax, dy = by - ay, len = Math.hypot(dx, dy) || 1;
    const ux = dx / len, uy = dy / len;
    const a = o(), b = o();
    d += stroke(ax - ux * a, ay - uy * a, bx + ux * b, by + uy * b, jit * 0.8, r);
  }
  return d;
}

/** Parallel strokes across the square. dir 1 = "/", -1 = "\". */
function hatchLines(s, m, pitch, dir, jit, r) {
  const lo = m, hi = s - m;
  const lines = [];
  for (let t = 2 * lo + pitch * (0.35 + r() * 0.3); t < 2 * hi; t += pitch) {
    const xa = Math.max(lo, t - hi), xb = Math.min(hi, t - lo);
    if (xb - xa < pitch * 0.45) continue;
    // Strokes start and stop a little loose of the edge, like a real hand.
    const sA = (r() - 0.35) * jit * 2, sB = (r() - 0.35) * jit * 2;
    let x1 = xa - sA, y1 = t - xa + sA, x2 = xb + sB, y2 = t - xb - sB;
    if (dir < 0) { x1 = s - x1; x2 = s - x2; }
    lines.push([x1, y1, x2, y2]);
  }
  return lines;
}

const cache = new Map();

/**
 * Paths for one square of `size` px.
 *   style: hatch | cross | scribble | solid | outline   — a claimed square
 *          ghost | slot                                  — guides, not ink
 *   dir:   1 or -1, so the two players hatch in opposite directions and
 *          the board reads without colour.
 * Returns { fill?, hatch?, outline, w, ow, dash? }.
 */
export function inkPaths(size, style, dir = 1, seed = 0) {
  const k = `${size}|${style}|${dir}|${seed}`;
  const hit = cache.get(k);
  if (hit) return hit;

  const S = FX.sketch;
  const s = size;
  const r = rng(seed * 97 + (dir > 0 ? 7 : 13) + style.length * 31);
  const m = s * S.inset;
  const jit = s * S.jitter;
  const w = Math.max(0.9, s * S.hatchWidth);
  const ow = Math.max(1, s * S.outlineWidth);
  const pitch = Math.max(2.6, s * S.hatchPitch);
  const out = { w, ow };

  const small = s < 8;
  const kind = small && (style === "hatch" || style === "cross" || style === "scribble") ? "solid" : style;

  if (kind === "slot") {
    out.outline = roughRect(m, m, s - m, s - m, jit * 0.6, s * 0.03, r);
    out.ow = Math.max(0.8, ow * 0.7);
  } else if (kind === "ghost") {
    out.outline = roughRect(m * 0.6, m * 0.6, s - m * 0.6, s - m * 0.6, jit * 0.5, s * 0.02, r);
    out.dash = `${f(s * 0.14)} ${f(s * 0.09)}`;
  } else if (kind === "solid") {
    const j = () => (r() - 0.5) * 2 * jit;
    out.fill = `M${f(m + j())} ${f(m + j())}L${f(s - m + j())} ${f(m + j())}L${f(s - m + j())} ${f(s - m + j())}L${f(m + j())} ${f(s - m + j())}Z`;
    out.outline = roughRect(m, m, s - m, s - m, jit, s * 0.03, r);
  } else if (kind === "outline") {
    out.outline = roughRect(m, m, s - m, s - m, jit, s * 0.06, r) + roughRect(m, m, s - m, s - m, jit * 1.3, s * 0.04, r);
  } else if (kind === "scribble") {
    // One continuous back-and-forth stroke: hatch lines joined end to end.
    const lines = hatchLines(s, m, pitch * 0.9, dir, jit, r);
    let d = "";
    lines.forEach(([x1, y1, x2, y2], i) => {
      const [ax, ay, bx, by] = i % 2 ? [x2, y2, x1, y1] : [x1, y1, x2, y2];
      d += i === 0 ? `M${f(ax)} ${f(ay)}` : `L${f(ax)} ${f(ay)}`;
      d += `L${f(bx)} ${f(by)}`;
    });
    out.hatch = d;
    out.outline = roughRect(m, m, s - m, s - m, jit, s * 0.02, r);
    out.ow = ow * 0.7;
  } else {
    const dirs = kind === "cross" ? [dir, -dir] : [dir];
    out.hatch = dirs
      .flatMap((dd, i) => hatchLines(s, m, i ? pitch * 1.15 : pitch, dd, jit, r))
      .map(([x1, y1, x2, y2]) => stroke(x1, y1, x2, y2, jit * 0.7, r))
      .join("");
    out.outline = roughRect(m, m, s - m, s - m, jit, s * 0.05, r);
  }

  if (cache.size > 4000) cache.clear();
  cache.set(k, out);
  return out;
}

/**
 * The board's pencil grid: every row and column line drawn as its own stroke,
 * running a little past the edge of the board.
 */
export function gridPath(cols, rows, cell, gap, seed = 1) {
  const r = rng(seed);
  const W = cols * cell + (cols - 1) * gap;
  const H = rows * cell + (rows - 1) * gap;
  const over = Math.min(7, cell * 0.22);
  const wob = Math.max(0.8, cell * 0.035);
  let inner = "", edge = "";
  for (let c = 0; c <= cols; c++) {
    const x = c === 0 ? -1 : c === cols ? W + 1 : c * (cell + gap) - gap / 2;
    const d = stroke(x + (r() - 0.5) * wob, -over * r(), x + (r() - 0.5) * wob, H + over * r(), wob * 1.5, r);
    if (c === 0 || c === cols) edge += d; else inner += d;
  }
  for (let rr = 0; rr <= rows; rr++) {
    const y = rr === 0 ? -1 : rr === rows ? H + 1 : rr * (cell + gap) - gap / 2;
    const d = stroke(-over * r(), y + (r() - 0.5) * wob, W + over * r(), y + (r() - 0.5) * wob, wob * 1.5, r);
    if (rr === 0 || rr === rows) edge += d; else inner += d;
  }
  // The border gets a second, looser pass so it reads heavier than the grid.
  const W2 = W + 2, H2 = H + 2;
  edge += roughRect(-2, -2, W2, H2, wob * 1.4, over * 0.7, r);
  return { inner, edge, W, H };
}

/* ------------------------------------------------------------------
   FRAMES — sketched rectangles as 9-slice border-images.
   Source is a 96×96 drawing; the outer 16px on each side are the slice.
   ------------------------------------------------------------------ */
const FRAME = 96, SLICE = 16;
const frameCache = new Map();

const svgUrl = (body) =>
  `url("data:image/svg+xml,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' width='${FRAME}' height='${FRAME}' viewBox='0 0 ${FRAME} ${FRAME}'>${body}</svg>`)}")`;

/**
 * A pencil frame in `color` (any CSS colour that works inside a standalone SVG,
 * so hex or rgba — not var()). `fill` makes it a solid chalk block instead.
 */
export function frameUrl(color, { fill = false, weight = 1.5, seed = 3 } = {}) {
  const k = `${color}|${fill}|${weight}|${seed}`;
  const hit = frameCache.get(k);
  if (hit) return hit;
  const r = rng(seed);
  const e0 = 4, e1 = FRAME - 4;
  let body;
  if (fill) {
    const j = () => (r() - 0.5) * 2.4;
    body =
      `<path d='M${f(e0 + j())} ${f(e0 + j())}Q48 ${f(e0 - 1 + j())} ${f(e1 + j())} ${f(e0 + j())}Q${f(e1 + 1 + j())} 48 ${f(e1 + j())} ${f(e1 + j())}Q48 ${f(e1 + 1 + j())} ${f(e0 + j())} ${f(e1 + j())}Q${f(e0 - 1 + j())} 48 ${f(e0 + j())} ${f(e0 + j())}Z' fill='${color}'/>` +
      `<path d='${roughRect(e0, e0, e1, e1, 1.2, 3, r)}' fill='none' stroke='${color}' stroke-width='${weight}' stroke-linecap='round'/>`;
  } else {
    body =
      `<path d='${roughRect(e0, e0, e1, e1, 1.3, 3.5, r)}' fill='none' stroke='${color}' stroke-width='${weight}' stroke-linecap='round'/>` +
      `<path d='${roughRect(e0 + 0.6, e0 + 0.4, e1 - 0.4, e1 - 0.6, 1.6, 2.5, r)}' fill='none' stroke='${color}' stroke-opacity='.45' stroke-width='${f(weight * 0.7)}' stroke-linecap='round'/>`;
  }
  const url = svgUrl(body);
  frameCache.set(k, url);
  return url;
}

/** The border-image declaration that goes with a frameUrl. */
export const frameImage = (url, fill = false) => `${url} ${SLICE} ${fill ? "fill " : ""}/ ${SLICE}px / 0 stretch`;

/** A single drawn horizontal rule, for dividers. */
export function ruleUrl(color, seed = 5) {
  const k = `rule|${color}|${seed}`;
  const hit = frameCache.get(k);
  if (hit) return hit;
  const r = rng(seed);
  const d = stroke(1, 8 + (r() - 0.5) * 2, 299, 8 + (r() - 0.5) * 2, 1.6, r) + stroke(6, 8.6, 294, 8.2, 1.2, r);
  const url = `url("data:image/svg+xml,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' width='300' height='16' viewBox='0 0 300 16' preserveAspectRatio='none'><path d='${d}' fill='none' stroke='${color}' stroke-width='1.1' stroke-opacity='.8' stroke-linecap='round' vector-effect='non-scaling-stroke'/></svg>`)}")`;
  frameCache.set(k, url);
  return url;
}

/** Paper grain, rendered once by the browser as a tiling image. */
export const GRAIN_URL = `url("data:image/svg+xml,${encodeURIComponent(
  "<svg xmlns='http://www.w3.org/2000/svg' width='220' height='220'>" +
  "<filter id='n'><feTurbulence type='fractalNoise' baseFrequency='.85' numOctaves='3' stitchTiles='stitch'/>" +
  "<feColorMatrix values='0 0 0 0 .5  0 0 0 0 .5  0 0 0 0 .5  0 0 0 1.6 -.55'/></filter>" +
  "<rect width='100%' height='100%' filter='url(#n)'/></svg>"
).replace(/%2523/g, "%23")}")`;

/** Hex + alpha for use inside SVG data URIs, where color-mix() isn't available. */
export function withAlpha(hex, a) {
  const h = String(hex).replace("#", "");
  if (h.length < 6) return hex;
  const n = (i) => parseInt(h.slice(i, i + 2), 16);
  return `rgba(${n(0)},${n(2)},${n(4)},${a})`;
}
