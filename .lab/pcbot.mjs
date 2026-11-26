// The all-clear bot: it only ever clears by emptying the board.
// It picks a band (2-3 rows or columns), and searches the pieces it can see
// (its two in hand and the forecast) for a way to fill that band exactly, so
// the last piece clears everything at once. It never makes a clear that
// leaves anything behind. Without a full solution in sight it builds in the
// band, keeping the gaps fillable (no pockets too small or oddly sized).
import { SIZE } from "../shared/sprint.js";
import { placesOf, apply } from "./blitzlab.mjs";
import { botMoveOP } from "../shared/blitzbot.js";
const N = SIZE, FULL = (1 << N) - 1;
const toBits = (st) => st.board.map((row) => row.reduce((m, v, j) => (v !== null ? m | (1 << j) : m), 0));
// A target: a set of rows and columns that all fill at once, so their last piece clears
// everything. `tm[r]` is the target's mask on row r; `size` its squares (a multiple of 4).
const inBand = (p, t) => p.m.every((m, i) => (m & ~t.tm[p.r + i]) === 0);
function makeTarget(rows, cols) {
  let cm = 0; for (const c of cols) cm |= 1 << c;
  const tm = Array.from({ length: N }, (_, r) => (rows.includes(r) ? FULL : cm));
  const size = tm.reduce((t, m) => t + popc(m), 0);
  return { rows, cols, tm, size, h: rows.length + cols.length };
}
const popc = (x) => { let c = 0; while (x) { x &= x - 1; c++; } return c; };
const TARGETS = (() => {
  const out = [];
  for (const h of [1, 2, 3, 4]) for (let lo = 0; lo + h <= N; lo++) {
    const set = Array.from({ length: h }, (_, k) => lo + k);
    out.push(makeTarget(set, []), makeTarget([], set));
  }
  const runs = (h) => Array.from({ length: N - h + 1 }, (_, lo) => Array.from({ length: h }, (_, k) => lo + k));
  // Crosses: 2 rows with 2 columns (28 squares), and 2 with 4 either way (40).
  for (const [hr, hc] of [[2, 2], [2, 4], [4, 2]]) for (const R of runs(hr)) for (const C of runs(hc)) out.push(makeTarget(R, C));
  return out.filter((t) => t.size % 4 === 0 && t.size <= 40);
})();
/** Targets that hold every square already on the board, smallest first. */
function bands(b) {
  return TARGETS.filter((t) => b.every((m, r) => (m & ~t.tm[r]) === 0))
    .sort((x, y) => x.size - y.size || Math.abs(x.rows.concat(x.cols).reduce((a, v) => a + v, 0) / Math.max(1, x.h) - 3.5) - Math.abs(y.rows.concat(y.cols).reduce((a, v) => a + v, 0) / Math.max(1, y.h) - 3.5));
}

/** Depth-first: the first move of the shortest sequence that empties the board inside `band`. */
function solve(b, hand, q, band, maxDepth) {
  let best = null;
  const seen = new Set();
  const dfs = (b, hand, q, d, first) => {
    if (best && d >= best.d) return;
    if (d >= maxDepth) return;
    const key = b.join(",") + "|" + hand.join(",") + "|" + d;
    if (seen.has(key)) return; seen.add(key);
    for (let s = 0; s < 2; s++) {
      const id = hand[s]; if (id == null) continue;
      for (const p of placesOf(id)) {
        if (!inBand(p, band)) continue;
        const a = apply(b, p); if (!a) continue;
        const f = first || { s, p };
        if (a.n) { if (a.empty && (!best || d + 1 < best.d)) best = { d: d + 1, first: f }; continue; }
        const h2 = hand.slice(); h2[s] = q[0];
        if (h2[s] == null) continue;
        dfs(a.b, h2, q.slice(1), d + 1, f);
      }
    }
  };
  dfs(b, hand, q, 0, null);
  return best;
}
/** How fillable a band's gaps are: pockets too small, or not a multiple of 4, are bad. */
function gapScore(b, band) {
  const inside = (r, c) => ((band.tm[r] >> c) & 1) === 1;
  const seen = new Set(); let bad = 0, n = 0;
  for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
    if (!inside(r, c) || (b[r] >> c) & 1 || seen.has(r * N + c)) continue;
    let size = 0; const stack = [[r, c]]; seen.add(r * N + c);
    while (stack.length) {
      const [y, x] = stack.pop(); size++;
      for (const [dy, dx] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const yy = y + dy, xx = x + dx;
        if (yy < 0 || xx < 0 || yy >= N || xx >= N || !inside(yy, xx) || (b[yy] >> xx) & 1 || seen.has(yy * N + xx)) continue;
        seen.add(yy * N + xx); stack.push([yy, xx]);
      }
    }
    n++; if (size % 4) bad += 3; if (size < 4) bad += 4;
  }
  return -bad - n * 0.5;
}
/**
 * Plans through every piece in sight (beam search): placements inside `band`,
 * no clear unless it empties the board. Returns the first move of a plan that
 * empties the board if there is one, else of the plan that got furthest with
 * the most fillable gaps.
 */
function plan(b, hand, q, band, depth, width = 40) {
  let frontier = [{ b, hand, q, first: null, v: 0 }];
  let best = null;
  for (let d = 0; d < depth; d++) {
    const next = [];
    for (const n of frontier) for (let s = 0; s < 2; s++) {
      const id = n.hand[s]; if (id == null) continue;
      for (const p of placesOf(id)) {
        if (!inBand(p, band)) continue;
        const a = apply(n.b, p); if (!a) continue;
        const first = n.first || { s, p };
        if (a.n) { if (a.empty) return { solved: true, d: d + 1, first }; continue; }
        const h2 = n.hand.slice(); h2[s] = n.q[0];
        next.push({ b: a.b, hand: h2, q: n.q.slice(1), first, v: gapScore(a.b, band) * 10 + (d + 1) * 30 });
      }
    }
    if (!next.length) break;
    // Different firsts survive: don't let one opening crowd out the rest.
    next.sort((x, y) => y.v - x.v);
    const keep = [], seen = new Set();
    for (const x of next) { const k = x.b.join(","); if (seen.has(k)) continue; seen.add(k); keep.push(x); if (keep.length >= width) break; }
    frontier = keep;
    if (!best || frontier[0].v > best.v) best = frontier[0];
  }
  return best ? { solved: false, d: 0, first: best.first, v: best.v } : null;
}

/**
 * How far a board is from an all clear: the fewest squares still to fill so that
 * every row holding blocks is full, or every column is (whichever is fewer), and
 * how fillable those squares are (pockets of 4, 8… are good; odd scraps are not).
 */
function shortfall(b) {
  let any = 0, filled = 0, rowsMask = 0;
  for (let i = 0; i < N; i++) { any |= b[i]; filled += popc(b[i]); if (b[i]) rowsMask |= 1 << i; }
  const nr = popc(rowsMask), nc = popc(any);
  const byRows = nr * N - filled, byCols = nc * N - filled;
  const rows = byRows <= byCols;
  // Pockets of empty squares inside that cover.
  const inside = (r, c) => (rows ? (rowsMask >> r) & 1 : (any >> c) & 1);
  const seen = new Set(); let bad = 0;
  for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
    if (!inside(r, c) || (b[r] >> c) & 1 || seen.has(r * N + c)) continue;
    let size = 0; const stack = [[r, c]]; seen.add(r * N + c);
    while (stack.length) {
      const [y, x] = stack.pop(); size++;
      for (const [dy, dx] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const yy = y + dy, xx = x + dx;
        if (yy < 0 || xx < 0 || yy >= N || xx >= N || !inside(yy, xx) || (b[yy] >> xx) & 1 || seen.has(yy * N + xx)) continue;
        seen.add(yy * N + xx); stack.push([yy, xx]);
      }
    }
    if (size % 4) bad += 2; if (size < 4) bad += 3;
  }
  return { need: Math.min(byRows, byCols), bad, lines: rows ? nr : nc };
}

/** Plans through every piece in sight, anywhere on the board, never clearing unless the board empties. */
function planFree(b, hand, q, depth, width = 60) {
  let frontier = [{ b, hand, q, first: null }];
  let best = null;
  for (let d = 0; d < depth; d++) {
    const next = [];
    for (const n of frontier) for (let s = 0; s < 2; s++) {
      const id = n.hand[s]; if (id == null) continue;
      for (const p of placesOf(id)) {
        const a = apply(n.b, p); if (!a) continue;
        const first = n.first || { s, p };
        if (a.n) { if (a.empty) return { solved: true, d: d + 1, first }; continue; }
        const h2 = n.hand.slice(); h2[s] = n.q[0];
        const f = shortfall(a.b);
        // Close to an all clear, fillable, in few lines; going deeper is progress too.
        next.push({ b: a.b, hand: h2, q: n.q.slice(1), first, v: -f.need * 3 - f.bad * 12 - f.lines * 6 + d * 4 });
      }
    }
    if (!next.length) break;
    next.sort((x, y) => y.v - x.v);
    const keep = [], seen = new Set();
    for (const x of next) { const k = x.b.join(",") + x.hand.join(","); if (seen.has(k)) continue; seen.add(k); keep.push(x); if (keep.length >= width) break; }
    frontier = keep;
    best = frontier[0];
  }
  return best ? { solved: false, first: best.first } : null;
}

/** The fewest squares still to fill so that every block sits in a full line (rows and columns mixed). */
function need(b) {
  let any = 0, filled = 0;
  for (let i = 0; i < N; i++) { any |= b[i]; filled += popc(b[i]); }
  if (!filled) return 0;
  let best = Infinity;
  // Choose which occupied columns to complete; the rest of the blocks need their rows.
  for (let cm = any; ; cm = (cm - 1) & any) {
    let rows = 0;
    for (let i = 0; i < N; i++) if (b[i] & ~cm) rows++;
    const nc = popc(cm), size = rows * N + nc * N - rows * nc;
    if (size - filled < best) best = size - filled;
    if (cm === 0) break;
  }
  return best;
}

/** Exact search: the first move of the shortest way (within `depth` pieces) to empty the board. */
export function solveExactExport(b, hand, q, depth) { return solveExact(b, hand, q, depth); }
function solveExact(b, hand, q, depth) {
  const memo = new Set();
  let found = null;
  const dfs = (b, hand, q, d, first) => {
    if (found && d + 1 >= found.d) return;
    const left = depth - d;
    if (left <= 0) return;
    if (need(b) > 4 * left) return; // can't get there in time
    const key = b.join(",") + "|" + hand.join(",") + "|" + d;
    if (memo.has(key)) return; memo.add(key);
    for (let s = 0; s < 2; s++) {
      const id = hand[s]; if (id == null) continue;
      for (const p of placesOf(id)) {
        const a = apply(b, p); if (!a) continue;
        const f = first || { s, p };
        if (a.n) { if (a.empty && (!found || d + 1 < found.d)) found = { d: d + 1, first: f }; continue; }
        if (left - 1 <= 0) continue;
        if (need(a.b) > 4 * (left - 1)) continue;
        const h2 = hand.slice(); h2[s] = q[0];
        if (h2[s] == null) continue;
        dfs(a.b, h2, q.slice(1), d + 1, f);
      }
    }
  };
  dfs(b, hand, q, 0, null);
  return found;
}

// Every tetromino orientation as cell offsets, anchored on its first cell in reading order.
const SHAPES = (() => {
  const seen = new Set(), out = [];
  for (let id = 0; id < 7; id++) for (const p of placesOf(id)) {
    const cells = [];
    p.m.forEach((m, i) => { for (let c = 0; c < N; c++) if ((m >> c) & 1) cells.push([p.r + i, c]); });
    cells.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const [r0, c0] = cells[0];
    const rel = cells.map(([r, c]) => [r - r0, c - c0]);
    const k = JSON.stringify(rel); if (seen.has(k)) continue; seen.add(k); out.push(rel);
  }
  return out;
})();
/** Can the empty squares of `t` on board `b` be tiled exactly by tetrominoes (any kinds)? */
const tileMemo = new Map();
function tileable(b, t) {
  const empty = b.map((m, r) => t.tm[r] & ~m);
  const key = empty.join(",");
  if (tileMemo.has(key)) return tileMemo.get(key);
  let r = 0; while (r < N && !empty[r]) r++;
  let ok;
  if (r === N) ok = true;
  else {
    const c = 31 - Math.clz32(empty[r] & -empty[r]);
    ok = false;
    for (const rel of SHAPES) {
      let fits = true;
      for (const [dr, dc] of rel) { const rr = r + dr, cc = c + dc; if (rr >= N || cc < 0 || cc >= N || !((empty[rr] >> cc) & 1)) { fits = false; break; } }
      if (!fits) continue;
      const nb = b.slice(); for (const [dr, dc] of rel) nb[r + dr] |= 1 << (c + dc);
      if (tileable(nb, t)) { ok = true; break; }
    }
  }
  if (tileMemo.size > 200000) tileMemo.clear();
  tileMemo.set(key, ok);
  return ok;
}

/**
 * Inside target `t`: the shortest way through the pieces in sight to fill it (an
 * all clear), or failing that the line of play that places the most pieces
 * while the rest of the target stays tileable. Returns its first move.
 */
function solveIn(b, hand, q, t, depth) {
  let found = null, deepest = null;
  const memo = new Set();
  const dfs = (b, hand, q, d, first) => {
    if (found && d + 1 >= found.d) return;
    if (!deepest || d > deepest.d) deepest = { d, first };
    if (d >= depth) return;
    const key = b.join(",") + "|" + hand.join(",");
    if (memo.has(key)) return; memo.add(key);
    for (let s = 0; s < 2; s++) {
      const id = hand[s]; if (id == null || id >= 100) continue;
      for (const p of placesOf(id)) {
        if (!inBand(p, t)) continue;
        const a = apply(b, p); if (!a) continue;
        const f = first || { s, p };
        if (a.n) { if (a.empty && (!found || d + 1 < found.d)) found = { d: d + 1, first: f }; continue; }
        if (!tileable(a.b, t)) continue;
        const h2 = hand.slice(); h2[s] = q[0];
        dfs(a.b, h2, q.slice(1), d + 1, f);
      }
    }
  };
  dfs(b, hand, q, 0, null);
  return found ? { solved: true, d: found.d, first: found.first } : deepest?.first ? { solved: false, d: deepest.d, first: deepest.first } : null;
}

export function pcMove(st, { depth = 7, stats } = {}) {
  const b = toBits(st);
  const out = (s, p) => { st.botComboOpen = false; return { slot: s, id: st.hand[s], rot: p.rot, cr: p.r + p.h / 2, cc: p.c + p.w / 2 }; };
  const visible = Math.min(depth, 2 + st.queue.length);
  let best = null;
  for (const t of bands(b)) {
    if (!tileable(b, t)) continue;
    const r = solveIn(b, st.hand.slice(), st.queue.slice(), t, visible);
    if (!r) continue;
    // An all clear soonest; else the plan that places the most pieces, in the smallest target.
    const v = r.solved ? 1000 - r.d * 10 : r.d * 10 - t.size * 0.5;
    if (!best || v > best.v) best = { v, r };
    if (r.solved && r.d <= 2) break;
  }
  if (best) { if (stats) stats[best.r.solved ? "solved" : "built"]++; return out(best.r.first.s, best.r.first.p); }
  // Nothing fits a target (junk, usually): anywhere that doesn't clear, keeping the board compact.
  let spot = null;
  for (let s = 0; s < 2; s++) for (const p of placesOf(st.hand[s])) {
    const a = apply(b, p); if (!a || (a.n && !a.empty)) continue;
    const v = (a.empty ? 1000 : 0) - need(a.b);
    if (!spot || v > spot.v) spot = { v, s, p };
  }
  if (spot) { if (stats) stats.spread++; return out(spot.s, spot.p); }
  if (stats) stats.fallback++;
  return botMoveOP(st);
}
