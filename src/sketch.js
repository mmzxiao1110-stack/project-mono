/**
 * The hand-drawn layer — pencil, not pen.
 *
 * What makes a mark read as graphite rather than ink:
 *   - grain: the paper's tooth breaks every stroke up (an SVG noise mask,
 *     see pencilFilter — applied to every mark, frames included);
 *   - pressure: hatch strokes are tapered flicks, heavy where the lead lands
 *     and trailing off, and no two lines are pressed equally hard;
 *   - passes: outlines are several light strokes, never one confident line.
 *
 * Everything here produces SVG path strings or data URIs. Nothing is random at
 * render time: every stroke comes from a seeded generator, so a square drawn on
 * turn 3 looks identical on turn 30 and React never sees a changing path.
 *
 * Two families of output:
 *   - `inkPaths`  — the marks inside one board square (hatching, outline…).
 *   - `frameUrl`  — a sketched rectangle as a 9-slice border-image, so any
 *                   button or panel gets a pencil frame with one style rule.
 *   - `shadeUrl`  — a tiling patch of pencil shading for filled surfaces.
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
 * A pencil flick from (x1,y1) to (x2,y2) as a filled shape: full width where
 * the lead lands, tapering to a hair where it lifts off.
 */
function flick(x1, y1, x2, y2, w, bow, r) {
  if (r() < 0.25) [x1, y1, x2, y2] = [x2, y2, x1, y1];
  const dx = x2 - x1, dy = y2 - y1, len = Math.hypot(dx, dy) || 1;
  const ux = dx / len, uy = dy / len, nx = -uy, ny = ux;
  const off = (r() - 0.5) * 2 * bow;
  const mx = (x1 + x2) / 2 + nx * off, my = (y1 + y2) / 2 + ny * off;
  const w0 = (w * (0.8 + r() * 0.45)) / 2, wm = w * 0.42, we = w * 0.06;
  return (
    `M${f(x1 + nx * w0)} ${f(y1 + ny * w0)}` +
    `Q${f(mx + nx * wm)} ${f(my + ny * wm)} ${f(x2 + nx * we)} ${f(y2 + ny * we)}` +
    `L${f(x2 - nx * we)} ${f(y2 - ny * we)}` +
    `Q${f(mx - nx * wm)} ${f(my - ny * wm)} ${f(x1 - nx * w0)} ${f(y1 - ny * w0)}` +
    `Q${f(x1 - ux * w0 * 1.3)} ${f(y1 - uy * w0 * 1.3)} ${f(x1 + nx * w0)} ${f(y1 + ny * w0)}Z`
  );
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

/** Flicks for a set of hatch lines, split into three pressure groups. */
function pressed(lines, w, jit, r, weights = [0.95, 0.7, 0.45]) {
  const groups = weights.map(() => "");
  for (const [x1, y1, x2, y2] of lines) {
    const g = Math.floor(r() * groups.length);
    groups[g] += flick(x1, y1, x2, y2, w * (1.15 - g * 0.15), jit * 0.7, r);
  }
  return groups.map((d, g) => ({ d, fill: true, o: weights[g] })).filter((l) => l.d);
}

/**
 * Marks for one square of `size` px, as layers to draw in order.
 *   style: hatch | cross | scribble | shaded | outline   — a claimed square
 *          ghost | slot                                   — guides, not marks
 *   dir:   1 or -1, so the two players hatch in opposite directions and
 *          the board reads without colour.
 * Returns { layers: [{ d, fill?, w?, o, dash? }], grain } — grain picks one of
 * the pencil grain filters so neighbouring squares don't share a pattern.
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
  const w = Math.max(0.7, s * S.hatchWidth);
  const ow = Math.max(0.7, s * S.outlineWidth);
  const pitch = Math.max(2.2, s * S.hatchPitch);
  const box = (k2 = 1, over = 0.05) => roughRect(m, m, s - m, s - m, jit * k2, s * over, r);
  const layers = [];
  // Several light passes rather than one firm line.
  const passes = (n) => {
    const op = [0.8, 0.42, 0.28];
    for (let i = 0; i < n; i++) layers.push({ d: box(1 + i * 0.5, 0.05 - i * 0.01), w: ow * (1 - i * 0.25), o: op[i] });
  };

  const small = s < 8;
  const kind = small && !["ghost", "slot", "outline", "pending"].includes(style) ? "shaded" : style;

  if (kind === "slot") {
    layers.push({ d: roughRect(m, m, s - m, s - m, jit * 0.6, s * 0.03, r), w: ow * 0.7, o: 0.5 });
  } else if (kind === "ghost") {
    layers.push({ d: roughRect(m * 0.6, m * 0.6, s - m * 0.6, s - m * 0.6, jit * 0.5, s * 0.02, r), w: ow * 1.1, o: 0.9, dash: `${f(s * 0.13)} ${f(s * 0.08)}` });
  } else if (kind === "pending") {
    // Placed but not yet revealed: the usual hatching inside a dotted outline.
    layers.push(...pressed(hatchLines(s, m, pitch, dir, jit, r), w, jit, r, [0.6, 0.45, 0.3]));
    layers.push({ d: roughRect(m * 0.5, m * 0.5, s - m * 0.5, s - m * 0.5, jit * 0.4, 0, r), w: ow * 1.6, o: 1, dash: `${f(s * 0.13)} ${f(s * 0.1)}` });
  } else if (kind === "shaded") {
    // Pressed hard and gone over twice: the closest a pencil gets to solid.
    layers.push(...pressed(hatchLines(s, m, pitch * 0.5, dir, jit, r), w * 1.1, jit, r, [0.8, 0.6, 0.45]));
    layers.push(...pressed(hatchLines(s, m, pitch * 0.8, -dir, jit, r), w * 0.9, jit, r, [0.45, 0.3]));
    passes(2);
  } else if (kind === "outline") {
    passes(3);
  } else if (kind === "scribble") {
    const lines = hatchLines(s, m, pitch * 0.85, dir, jit, r);
    let d = "";
    lines.forEach(([x1, y1, x2, y2], i) => {
      const [ax, ay, bx, by] = i % 2 ? [x2, y2, x1, y1] : [x1, y1, x2, y2];
      d += i === 0 ? `M${f(ax)} ${f(ay)}` : `L${f(ax)} ${f(ay)}`;
      d += `L${f(bx)} ${f(by)}`;
    });
    layers.push({ d, w: w * 0.9, o: 0.85 });
    layers.push({ d: box(0.8, 0.02), w: ow * 0.6, o: 0.35 });
  } else {
    layers.push(...pressed(hatchLines(s, m, pitch, dir, jit, r), w, jit, r));
    if (kind === "cross") layers.push(...pressed(hatchLines(s, m, pitch * 1.2, -dir, jit, r), w * 0.9, jit, r, [0.7, 0.45]));
    passes(2);
  }

  const out = { layers, grain: seed % GRAINS };
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
   GRAIN — the paper tooth that breaks a pencil line up.
   Noise becomes an alpha mask: where the paper's ridges are, graphite
   sticks; in the valleys it skips. Used live on the board (as filters in
   the page) and baked into every frame and shading tile.
   ------------------------------------------------------------------ */
export const GRAINS = 4;

/** Filter markup. `id` must be unique in whatever document it lands in. */
export function pencilFilter(id, seed = 1, freq = FX.sketch.grainSize, bite = FX.sketch.grainBite) {
  // alpha = 1.55 - bite·noise: most of the stroke survives, the ridges drop out.
  return (
    `<filter id='${id}' x='-5%' y='-5%' width='110%' height='110%' color-interpolation-filters='sRGB'>` +
    `<feTurbulence type='fractalNoise' baseFrequency='${freq}' numOctaves='2' seed='${seed}' result='n'/>` +
    `<feColorMatrix in='n' type='matrix' values='0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  -${bite} 0 0 0 ${f(0.55 + bite / 2)}' result='m'/>` +
    `<feComposite in='SourceGraphic' in2='m' operator='in'/>` +
    `</filter>`
  );
}

/* ------------------------------------------------------------------
   FRAMES — sketched rectangles as 9-slice border-images.
   Source is a 96×96 drawing; the outer 16px on each side are the slice.
   ------------------------------------------------------------------ */
const FRAME = 96, SLICE = 16;
const frameCache = new Map();

const svgUrl = (body, w = FRAME, h = FRAME) =>
  `url("data:image/svg+xml,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' width='${w}' height='${h}' viewBox='0 0 ${w} ${h}'>${body}</svg>`)}")`;

/**
 * A pencil frame in `color` (any CSS colour that works inside a standalone SVG,
 * so hex or rgba — not var()): three light passes, grained.
 */
export function frameUrl(color, { weight = 1.3, seed = 3 } = {}) {
  const k = `${color}|${weight}|${seed}`;
  const hit = frameCache.get(k);
  if (hit) return hit;
  const r = rng(seed);
  const e0 = 4, e1 = FRAME - 4;
  const pass = (jit, over, w, o) =>
    `<path d='${roughRect(e0, e0, e1, e1, jit, over, r)}' fill='none' stroke='${color}' stroke-width='${f(w)}' stroke-opacity='${o}' stroke-linecap='round'/>`;
  const body =
    pencilFilter("g", seed, 0.8, 2.6) +
    `<g filter='url(#g)'>${pass(1.3, 3.5, weight, 0.9)}${pass(1.8, 2.5, weight * 0.75, 0.5)}${pass(2.2, 1.5, weight * 0.6, 0.3)}</g>`;
  const url = svgUrl(body);
  frameCache.set(k, url);
  return url;
}

/** The border-image declaration that goes with a frameUrl. */
export const frameImage = (url) => `${url} ${SLICE} / ${SLICE}px / 0 stretch`;

/**
 * A seamless tile of pencil shading. 45° lines spaced so they meet
 * themselves across the tile edge; each line keeps its own pressure.
 *   dense: gone over in both directions, for swatches and solid fills.
 */
const TILE = 36;
export function shadeUrl(color, { dir = 1, dense = false, light = false } = {}) {
  const k = `shade|${color}|${dir}|${dense}|${light}`;
  const hit = frameCache.get(k);
  if (hit) return hit;
  const r = rng(dense ? 11 : 7);
  const lines = (d, gap, w, base) => {
    const n = TILE / gap;
    const press = Array.from({ length: n }, () => base * (0.55 + r() * 0.45));
    let out = "";
    for (let i = -n; i < 2 * n; i++) {
      const t = i * gap;
      const [x1, y1, x2, y2] = d > 0 ? [t - TILE, TILE * 2, t + TILE, 0] : [t - TILE, -TILE, t + TILE, TILE];
      out += `<line x1='${f(x1)}' y1='${f(y1)}' x2='${f(x2)}' y2='${f(y2)}' stroke='${color}' stroke-width='${w}' stroke-opacity='${f(press[((i % n) + n) % n])}'/>`;
    }
    return out;
  };
  const base = light ? 0.5 : 0.85;
  const marks = lines(dir, dense ? 2.4 : 3.6, dense ? 1.1 : 0.9, base) + (dense ? lines(-dir, 3, 0.9, base * 0.7) : "");
  const url = svgUrl(pencilFilter("g", dense ? 5 : 2, 0.85, 2.6) + `<g filter='url(#g)'>${marks}</g>`, TILE, TILE);
  frameCache.set(k, url);
  return url;
}

/** A single drawn horizontal rule, for dividers: two passes, grained. */
export function ruleUrl(color, seed = 5) {
  const k = `rule|${color}|${seed}`;
  const hit = frameCache.get(k);
  if (hit) return hit;
  const r = rng(seed);
  const a = stroke(1, 8 + (r() - 0.5) * 2, 299, 8 + (r() - 0.5) * 2, 1.6, r);
  const b = stroke(6, 8.6, 294, 8.2, 1.2, r);
  const body =
    pencilFilter("g", seed, 0.8, 2.4) +
    `<g filter='url(#g)' fill='none' stroke='${color}' stroke-linecap='round'>` +
    `<path d='${a}' stroke-width='1.2' stroke-opacity='.85'/><path d='${b}' stroke-width='.8' stroke-opacity='.4'/></g>`;
  const url = `url("data:image/svg+xml,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' width='300' height='16' viewBox='0 0 300 16' preserveAspectRatio='none'>${body}</svg>`)}")`;
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
