// A perfect-clear (PC) solver for TOWER, in the spirit of sfinder / Hydra: instead of a list of memorised
// setups it searches every way to place the known pieces (with hold) inside the bottom 4 rows until the
// board is empty. Placements are hard-drop only (turn at the top, slide, drop), so the game's keys can
// always make them. Pruned hard: every empty pocket must hold a whole number of pieces.
//
//   import { pieceOrder, solvePC } from "./pcsolver.mjs"
//   node .lab/pcsolver.mjs [games]   — how many 40-line runs of ten 4-line PCs it can find
import * as Z from "../shared/zerog.js";

/** The game's piece order for a seed: the same random source and 7-bag shuffle as shared/zerog.js. */
export function pieceOrder(seed, n) {
  let a = seed >>> 0;
  const rand = () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const out = [];
  while (out.length < n) {
    const bag = [0, 1, 2, 3, 4, 5, 6];
    for (let i = bag.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [bag[i], bag[j]] = [bag[j], bag[i]]; }
    out.push(...bag);
  }
  return out.slice(0, n);
}

const W = 10, FULL = (1 << W) - 1;
// Each piece, each turn: its cells as [column, row-from-bottom] relative to the box, plus the box x range.
const SHAPES = Array.from({ length: 7 }, (_, id) => [0, 1, 2, 3].map((rot) => {
  const cells = Z.shapeCells(id, rot);
  const maxY = Math.max(...cells.map(([, y]) => y));
  const xs = cells.map(([x]) => x);
  return { rot, cells: cells.map(([x, y]) => [x, maxY - y]), minX: -Math.min(...xs), maxX: W - 1 - Math.max(...xs) };
}));
const SPAWN_X = (id) => (id === 1 ? 4 : 3);
const TURN = [0, 1, 2, -1]; // the key for each rotation state from spawn: none, cw, 180, ccw

/** Hard-drop `id` at turn `rot`, box x `x`, on rows (bottom first). The rows after, cleared, or null if it pokes above `h`. */
function drop(rows, h, id, rot, x) {
  const { cells } = SHAPES[id][rot];
  const fits = (b) => cells.every(([cx, cy]) => { const r = b + cy; return r >= 0 && (r >= rows.length || !(rows[r] >> (x + cx) & 1)); });
  let b = h + 2;
  while (b > 0 && fits(b - 1)) b--;
  if (!fits(b)) return null;
  const next = rows.slice();
  while (next.length < h) next.push(0);
  for (const [cx, cy] of cells) { const r = b + cy; if (r >= h) return null; next[r] |= 1 << (x + cx); }
  const kept = next.filter((m) => m !== FULL);
  return { rows: kept, h: h - (next.length - kept.length) };
}

/** Every empty pocket (below h) must hold a whole number of pieces: 4 squares each. */
function solvable(rows, h) {
  const seen = new Set();
  for (let r = 0; r < h; r++) for (let c = 0; c < W; c++) {
    if ((rows[r] || 0) >> c & 1 || seen.has(r * W + c)) continue;
    let size = 0;
    const stack = [[r, c]]; seen.add(r * W + c);
    while (stack.length) {
      const [y, x] = stack.pop(); size++;
      for (const [dy, dx] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const ny = y + dy, nx = x + dx;
        if (ny < 0 || ny >= h || nx < 0 || nx >= W || ((rows[ny] || 0) >> nx & 1) || seen.has(ny * W + nx)) continue;
        seen.add(ny * W + nx); stack.push([ny, nx]);
      }
    }
    if (size % 4) return false;
  }
  return true;
}

/**
 * A 4-line PC from an empty board: `seq` is the pieces from the current one on, `hold` the held piece
 * (or null). Returns the moves ({ hold, id, rot, x, turn, dx }) and what's left (index, hold), or null.
 */
export function solvePC(seq, hold, h = 4, budget = 400000) {
  const failed = new Set();
  let nodes = 0;
  const go = (rows, hh, i, hd) => {
    if (!hh) return [];
    if (++nodes > budget) return null;
    const key = `${rows.join(",")}|${hh}|${i}|${hd}`;
    if (failed.has(key)) return null;
    // The choices: place the current piece, or swap with hold (an empty hold takes the next piece too).
    const options = [{ id: seq[i], i: i + 1, hd, hold: false }];
    if (hd != null) { if (hd !== seq[i]) options.push({ id: hd, i: i + 1, hd: seq[i], hold: true }); }
    else if (i + 1 < seq.length) options.push({ id: seq[i + 1], i: i + 2, hd: seq[i], hold: true });
    for (const o of options) {
      if (o.i > seq.length) continue;
      const tried = new Set();
      for (const s of SHAPES[o.id]) for (let x = s.minX; x <= s.maxX; x++) {
        const res = drop(rows, hh, o.id, s.rot, x);
        if (!res) continue;
        const k = res.rows.join(",") + "|" + res.h;
        if (tried.has(k)) continue; // the same result from another turn: one is enough
        tried.add(k);
        if (!solvable(res.rows, res.h)) continue;
        const rest = go(res.rows, res.h, o.i, o.hd);
        if (rest) return [{ hold: o.hold, id: o.id, rot: s.rot, x, turn: TURN[s.rot], dx: x - SPAWN_X(o.id) }, ...rest];
      }
    }
    failed.add(key);
    return null;
  };
  const moves = go([], h, 0, hold);
  if (!moves) return null;
  // Where the sequence stands afterwards.
  let i = 0, hd = hold;
  for (const m of moves) {
    if (!m.hold) i++;
    else if (hd != null) { hd = seq[i]; i++; }
    else { hd = seq[i]; i += 2; }
  }
  return { moves, used: i, hold: hd };
}

// Run as a script: how often it finds ten PCs in a row (a 40-line run of only PCs).
if (import.meta.url === `file://${process.argv[1]}`) {
  const games = Number(process.argv[2]) || 20;
  let ok = 0;
  const t0 = Date.now();
  for (let g = 0; g < games; g++) {
    const seed = 1000 + g * 7919;
    const seq = pieceOrder(seed, 200);
    let at = 0, hold = null, pcs = 0;
    while (pcs < 10) {
      const r = solvePC(seq.slice(at), hold);
      if (!r) break;
      at += r.used; hold = r.hold; pcs++;
    }
    if (pcs === 10) ok++;
    console.log(`seed ${seed}: ${pcs} PCs in a row`);
  }
  console.log(`${ok}/${games} runs with ten PCs · ${((Date.now() - t0) / games / 1000).toFixed(2)} s a run`);
}
