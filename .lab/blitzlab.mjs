// Blitz bot lab: configurable bots, beam search, tournaments at equal speed.
import { SIZE, shapeOf, attackLevel, SPIKE_MS, newSprint, place, noteClear, spikeDue, receiveJunk, recordMove, isJunk } from "../shared/sprint.js";
import { botMove as baseMove, botDelay } from "../shared/blitzbot.js";
const N = SIZE, FULL = (1 << N) - 1;
const popc = (x) => { let c = 0; while (x) { x &= x - 1; c++; } return c; };
const placements = new Map();
export function placesOf(id) {
  if (placements.has(id)) return placements.get(id);
  const out = [], seen = new Set();
  for (let rot = 0; rot < 4; rot++) {
    const s = shapeOf(id, rot);
    for (let r = 0; r + s.h <= N; r++) for (let c = 0; c + s.w <= N; c++) {
      const m = Array(s.h).fill(0); for (const [dr, dc] of s.cells) m[dr] |= 1 << (c + dc);
      const k = `${r}:${m.join(",")}`; if (seen.has(k)) continue; seen.add(k);
      out.push({ rot, r, c, h: s.h, w: s.w, m });
    }
  }
  placements.set(id, out); return out;
}
export function apply(b, p) {
  for (let i = 0; i < p.m.length; i++) if (b[p.r + i] & p.m[i]) return null;
  const nb = b.slice(); for (let i = 0; i < p.m.length; i++) nb[p.r + i] |= p.m[i];
  let rows = 0, cols = FULL;
  for (let i = 0; i < N; i++) { if (nb[i] === FULL) rows |= 1 << i; cols &= nb[i]; }
  const n = popc(rows) + popc(cols);
  if (!n) return { b: nb, n: 0, empty: false };
  for (let i = 0; i < N; i++) nb[i] = (rows >> i) & 1 ? 0 : nb[i] & ~cols;
  return { b: nb, n, empty: nb.every((x) => !x) };
}
const fits = (b, id) => placesOf(id).some((p) => { for (let i = 0; i < p.m.length; i++) if (b[p.r + i] & p.m[i]) return false; return true; });
const countFits = (b, id) => { let n = 0; for (const p of placesOf(id)) { let ok = true; for (let i = 0; i < p.m.length; i++) if (b[p.r + i] & p.m[i]) { ok = false; break; } if (ok) n++; } return n; };
function features(b) {
  let filled = 0, holes = 0, near1 = 0, near2 = 0, rough = 0;
  const col = Array(N).fill(0);
  for (let i = 0; i < N; i++) { const k = popc(b[i]); filled += k; if (k === N - 1) near1++; else if (k === N - 2) near2++; for (let j = 0; j < N; j++) if ((b[i] >> j) & 1) col[j]++; }
  for (let j = 0; j < N; j++) { if (col[j] === N - 1) near1++; else if (col[j] === N - 2) near2++; }
  for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) if (!((b[i] >> j) & 1)) {
    let k = 0;
    if (i === 0 || (b[i - 1] >> j) & 1) k++; if (i === N - 1 || (b[i + 1] >> j) & 1) k++;
    if (j === 0 || (b[i] >> (j - 1)) & 1) k++; if (j === N - 1 || (b[i] >> (j + 1)) & 1) k++;
    if (k >= 3) holes++; if (k === 4) holes += 2;
    if (i < N - 1 && ((b[i + 1] >> j) & 1)) rough++;
  }
  return { filled, holes, near1, near2, rough };
}
// W: the weights of a strategy.
export const BASE_W = { near1: 14, near2: 6, holes: 30, over: 12, overAt: 0.45, danger: 120, mob: 0, junkFit: 0, lone: -60, lonePanic: 20, pow: 1.35, k: 25, depth: 2, beam: 1, disc: 0.8, comboBonus: 0 };
function clearValue(W, a, piece, combo, danger) {
  if (!a.n) return 0;
  const lvl = attackLevel(a.n, { allClear: a.empty, piece, combo });
  const lone = a.n === 1 && !combo && !a.empty;
  if (lone) return danger ? W.lonePanic : W.lone;
  return Math.pow(lvl, W.pow) * W.k + (combo ? W.comboBonus : 0);
}
function evalBoard(W, b, upcoming) {
  const f = features(b);
  const danger = f.filled > N * N * 0.55;
  let v = f.near1 * W.near1 + f.near2 * W.near2 - f.holes * W.holes - Math.max(0, f.filled - N * N * W.overAt) * W.over - (danger ? W.danger : 0);
  if (W.mob) { let m = 0; for (let id = 0; id < 7; id++) m += Math.min(6, countFits(b, id)); v += m * W.mob; }
  if (W.junkFit && upcoming) for (const id of upcoming) if (isJunk(id) && !fits(b, id)) v -= W.junkFit;
  return v;
}
/** A strategy's move: beam search over (slot, placement) sequences through the hand and queue. */
export function labMove(st, W) {
  const b0 = st.board.map((row) => row.reduce((m, v, j) => (v !== null ? m | (1 << j) : m), 0));
  const danger0 = features(b0).filled > N * N * 0.55;
  if (!st.pieces && W.randomOpen !== false) {
    const all = []; for (let s = 0; s < 2; s++) for (const p of placesOf(st.hand[s])) if (apply(b0, p)) all.push({ s, p });
    if (all.length) { const { s, p } = all[Math.floor(Math.random() * all.length)]; st.botComboOpen = false; return { slot: s, id: st.hand[s], rot: p.rot, cr: p.r + p.h / 2, cc: p.c + p.w / 2 }; }
  }
  // nodes: { b, hand, q, combo, score, first }
  let frontier = [{ b: b0, hand: st.hand.slice(), q: st.queue.slice(), combo: !!st.botComboOpen, score: 0, first: null }];
  for (let d = 0; d < W.depth; d++) {
    const next = [];
    for (const n of frontier) for (let s = 0; s < 2; s++) {
      const id = n.hand[s]; if (id == null) continue;
      for (const p of placesOf(id)) {
        const a = apply(n.b, p); if (!a) continue;
        const danger = d === 0 ? danger0 : features(n.b).filled > N * N * 0.55;
        const cv = clearValue(W, a, id, n.combo, danger) * Math.pow(W.disc, d);
        const hand = n.hand.slice(); hand[s] = n.q[0]; const q = n.q.slice(1);
        next.push({ b: a.b, hand, q, combo: a.n > 0, score: n.score + cv, first: n.first || { s, p, cleared: a.n > 0 } });
      }
    }
    if (!next.length) break;
    const last = d === W.depth - 1;
    for (const x of next) x.v = x.score + evalBoard(W, x.b, last ? x.q.slice(0, 3) : null) * (last ? 1 : 0.3);
    next.sort((x, y) => y.v - x.v);
    frontier = last ? next : next.slice(0, W.beam * (d === 0 ? 4 : 1));
    if (last) break;
  }
  const best = frontier[0];
  if (!best || !best.first) return null;
  st.botComboOpen = best.first.cleared;
  const { s, p } = best.first;
  return { slot: s, id: st.hand[s], rot: p.rot, cr: p.r + p.h / 2, cc: p.c + p.w / 2 };
}
/** One match: two movers at skill-10 timing. Returns the winner and the log (for a replay). */
export function match(moveA, moveB, seed, { skill = 10, maxMs = 240000 } = {}) {
  const st = { A: newSprint(seed, Infinity), B: newSprint(seed, Infinity) };
  const mv = { A: moveA, B: moveB }, next = { A: 300 + Math.random() * 200, B: 300 + Math.random() * 200 }, sent = { A: 0, B: 0 }, log = [], lv = { A: 0, B: 0 };
  for (let t = 0; t < maxMs; t += 10) {
    for (const s of ["A", "B"]) { const o = s === "A" ? "B" : "A"; const l = spikeDue(st[s], t); if (l) { receiveJunk(st[o], l); sent[s]++; lv[s] += l; log.push([t, o, -1, l]); } }
    for (const s of ["A", "B"]) {
      if (t < next[s]) continue;
      const o = s === "A" ? "B" : "A";
      const a = mv[s](st[s]);
      if (!a) return { winner: o, t, log, sent, lv, st };
      const m = recordMove(a, t); place(st[s], a); log.push([t, s, m[1], m[2], m[3], m[4]]);
      const L = st[s].last; if (L.lines) noteClear(st[s], L.lines, t, L.allClear, L.id);
      if (st[s].over) return { winner: o, t, log, sent, lv, st };
      next[s] = t + botDelay(st[s], skill);
    }
  }
  return { winner: null, t: maxMs, log, sent, lv, st };
}
export const base = (st) => baseMove(st, 10);
