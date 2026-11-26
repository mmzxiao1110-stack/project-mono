// The setup bot, for Ultra: every clear must be its piece's biggest —
//   T 4-5 lines · I 4-5 · O 4 · S, Z, J, L 5
// — except small clears (1-3 lines) when they make an all clear, or when a
// combo is already 3 long. It plans 3 placements ahead in Ultra points
// (lines x combo, all clears), building so that its pieces have big clears
// ready, keeping room for every piece, and the board from filling.
import { SIZE, T_ID, linePoints, comboMult, ALL_CLEAR } from "../shared/sprint.js";
import { placesOf, apply } from "./blitzlab.mjs";
const N = SIZE;
const popc = (x) => { let c = 0; while (x) { x &= x - 1; c++; } return c; };
const toBits = (st) => st.board.map((row) => row.reduce((m, v, j) => (v !== null ? m | (1 << j) : m), 0));
// I O T S Z J L
export const MIN_BIG = [4, 4, 4, 5, 5, 5, 5];
export const RELAXED = [4, 4, 4, 4, 4, 4, 4];
let MIN = MIN_BIG;
export const setRules = (r) => { MIN = r; };
export const FREE = null;
export function allowed(id, a, comboBefore) {
  if (!a.n || a.empty || MIN === null) return true;
  if (a.n <= 3) return comboBefore >= 3;
  return a.n >= MIN[id];
}
/** Progress toward big clears: lines close to full count for more the closer they are. */
function building(b) {
  let v = 0, any = 0;
  for (let i = 0; i < N; i++) { const k = popc(b[i]); if (k >= 4) v += (k - 3) * (k - 3); any |= b[i]; }
  for (let j = 0; j < N; j++) { let k = 0; for (let i = 0; i < N; i++) k += (b[i] >> j) & 1; if (k >= 4) v += (k - 3) * (k - 3); }
  return v;
}
/** For each piece type: can it make an allowed big clear on this board right now? */
function ready(b) {
  let n = 0, best = 0;
  for (let id = 0; id < 7; id++) for (const p of placesOf(id)) {
    const a = apply(b, p);
    if (a && a.n >= (MIN ? MIN[id] : 4)) { n++; best = Math.max(best, a.n); break; }
  }
  return { n, best };
}
function room(b) {
  let total = 0, dead = 0;
  for (let id = 0; id < 7; id++) {
    let k = 0;
    for (const p of placesOf(id)) { const a = apply(b, p); if (a && !a.n) { if (++k >= 6) break; } }
    total += k; if (!k) dead++;
  }
  return { total, dead };
}
export function setupMove(st, { depth = 3, width = 30, stats } = {}) {
  const b0 = toBits(st);
  let frontier = [{ b: b0, hand: st.hand.slice(), q: st.queue.slice(), combo: st.combo || 0, score: 0, first: null }];
  let best = null;
  for (let d = 0; d < depth; d++) {
    const next = [];
    for (const n of frontier) for (let s = 0; s < 2; s++) {
      const id = n.hand[s]; if (id == null) continue;
      for (const p of placesOf(id)) {
        const a = apply(n.b, p); if (!a || !allowed(id, a, n.combo)) continue;
        const combo = a.n ? n.combo + 1 : 0;
        const pts = a.n ? Math.round((linePoints(a.n) + (a.empty ? ALL_CLEAR : 0)) * comboMult(combo)) : 0;
        const h2 = n.hand.slice(); h2[s] = n.q[0];
        next.push({ b: a.b, hand: h2, q: n.q.slice(1), combo, score: n.score + pts * Math.pow(0.9, d), first: n.first || { s, p } });
      }
    }
    if (!next.length) break;
    for (const x of next) {
      let filled = 0; for (const m of x.b) filled += popc(m);
      const r = room(x.b), rd = ready(x.b);
      // Points, plus being ready to cash big clears (more so mid-combo), room, and not filling up.
      x.v = x.score + rd.n * (60 + 25 * Math.min(x.combo, 6)) + rd.best * 40 + building(x.b) * 6 + r.total * 2 - r.dead * 300 - Math.max(0, filled - 46) * 18;
    }
    next.sort((x, y) => y.v - x.v);
    frontier = next.slice(0, width);
    best = frontier[0];
  }
  if (!best?.first) { if (stats) stats.stuck++; return null; }
  const { s, p } = best.first;
  return { slot: s, id: st.hand[s], rot: p.rot, cr: p.r + p.h / 2, cc: p.c + p.w / 2 };
}
