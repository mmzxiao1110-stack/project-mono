// The T bot: it only ever clears with a T, and only with a "full" T: the most
// lines one T can clear (5: both its rows and all three of its columns; 4 if
// 5 can't be had). Every other piece goes down without clearing anything.
// It looks a few placements ahead, building toward a ready T slot while
// keeping room for every piece; it holds a T in hand until a slot is ready.
import { SIZE, T_ID } from "../shared/sprint.js";
import { placesOf, apply } from "./blitzlab.mjs";
import { botMoveOP } from "../shared/blitzbot.js";
const N = SIZE;
const popc = (x) => { let c = 0; while (x) { x &= x - 1; c++; } return c; };
const toBits = (st) => st.board.map((row) => row.reduce((m, v, j) => (v !== null ? m | (1 << j) : m), 0));
/** The most lines a T could clear on this board right now. */
function tReady(b) {
  let best = 0;
  for (const p of placesOf(T_ID)) { const a = apply(b, p); if (a && a.n > best) best = a.n; }
  return best;
}
/** Room for each piece: how many places each non-T piece fits without clearing (capped). */
function room(b) {
  let total = 0, dead = 0;
  for (let id = 0; id < 7; id++) {
    if (id === T_ID) continue;
    let n = 0;
    for (const p of placesOf(id)) { const a = apply(b, p); if (a && !a.n) { n++; if (n >= 8) break; } }
    total += n; if (!n) dead++;
  }
  return { total, dead };
}
export function tMove(st, { depth = 3, width = 40, need = 4, stats, w5 = 2200, w4 = 700, ready = [0, 0, 5, 20, 70, 180], fillAt = 48, fillW = 14, deadW = 260 } = {}) {
  const b0 = toBits(st);
  // Only full T clears — unless the board is nearly full, when any T clear beats dying.
  const ok = (id, a, filledBefore) => (id === T_ID ? !a.n || a.n >= need || filledBefore >= 48 : !a.n);
  let frontier = [{ b: b0, hand: st.hand.slice(), q: st.queue.slice(), score: 0, first: null }];
  let best = null;
  for (let d = 0; d < depth; d++) {
    const next = [];
    for (const n of frontier) {
      let fb = 0; for (const m of n.b) fb += popc(m);
      for (let s = 0; s < 2; s++) {
      const id = n.hand[s]; if (id == null) continue;
      for (const p of placesOf(id)) {
        const a = apply(n.b, p); if (!a || !ok(id, a, fb)) continue;
        const first = n.first || { s, p, tClear: id === T_ID && a.n > 0, lines: a.n };
        let gain = 0;
        if (id === T_ID) gain = a.n >= 5 ? w5 : a.n === 4 ? w4 : a.n ? 150 : -300; // a T spent without a clear is a waste
        const h2 = n.hand.slice(); h2[s] = n.q[0];
        next.push({ b: a.b, hand: h2, q: n.q.slice(1), score: n.score + gain * Math.pow(0.85, d), first });
      }
      }
    }
    if (!next.length) break;
    for (const x of next) {
      let filled = 0; for (const m of x.b) filled += popc(m);
      const r = room(x.b), tr = tReady(x.b);
      const tSoon = x.hand.includes(T_ID) || x.q[0] === T_ID;
      x.v = x.score + ready[Math.min(5, tr)] * (tSoon ? 2.5 : 1) + r.total * 2 - r.dead * deadW - Math.max(0, filled - fillAt) * fillW;
    }
    next.sort((x, y) => y.v - x.v);
    frontier = next.slice(0, width);
    best = frontier[0];
  }
  const out = (s, p) => { st.botComboOpen = false; return { slot: s, id: st.hand[s], rot: p.rot, cr: p.r + p.h / 2, cc: p.c + p.w / 2 }; };
  if (best?.first) {
    if (stats) stats[best.first.tClear ? "tclear" : "build"]++;
    return out(best.first.s, best.first.p);
  }
  if (stats) stats.fallback++;
  return botMoveOP(st);
}
