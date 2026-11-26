/**
 * The Blitz bot, shared by VS BOT (in the browser) and simulations.
 * skill 1..10 sets both its speed (on average 0.6 pieces a second at 1, 3 at 10,
 * at an uneven, human pace)
 * and how well it plays: at the top it looks two placements ahead, goes for
 * combos and big spikes (3s, 4s, T set-ups, all clears), and only takes a
 * lone single line to dig out when its board is in danger (downstacking).
 */
import { SIZE, shapeOf, attackLevel, SPIKE_MS } from "./sprint.js";

const N = SIZE, FULL = (1 << N) - 1;
export const botPps = (skill) => 0.6 + (Math.max(1, Math.min(10, skill)) - 1) * (2.4 / 9);
/**
 * Milliseconds until the bot's next placement. A skilled bot speeds up while
 * a combo is open (like a human chasing the 500 ms window), then rests.
 */
export function botDelay(st, skill, rand = Math.random) {
  const base = 1000 / botPps(skill);
  // Chasing a combo: quick, but not metronome-quick.
  if (skill >= 6 && st.botComboOpen) return Math.round(Math.min(base * 0.55, 300 - (skill - 6) * 25) * (0.8 + rand() * 0.4));
  // Otherwise an uneven rhythm: mostly quick placements, now and then a
  // longer think. Averages out to `base`.
  const f = rand() < 0.18 ? 1.4 + rand() : 0.5 + rand() * 0.7;
  return Math.max(120, Math.round(base * f));
}
const popc = (x) => { let c = 0; while (x) { x &= x - 1; c++; } return c; };

const placements = new Map(); // piece id -> [{ rot, r, c, h, w, m: [rowMasks] }]
function placesOf(id) {
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
  placements.set(id, out);
  return out;
}
function apply(b, p) {
  for (let i = 0; i < p.m.length; i++) if (b[p.r + i] & p.m[i]) return null;
  const nb = b.slice(); for (let i = 0; i < p.m.length; i++) nb[p.r + i] |= p.m[i];
  let rows = 0, cols = FULL;
  for (let i = 0; i < N; i++) { if (nb[i] === FULL) rows |= 1 << i; cols &= nb[i]; }
  const n = popc(rows) + popc(cols);
  if (!n) return { b: nb, n: 0, empty: false };
  for (let i = 0; i < N; i++) nb[i] = (rows >> i) & 1 ? 0 : nb[i] & ~cols;
  return { b: nb, n, empty: nb.every((x) => !x) };
}
function shape(b) {
  let filled = 0, holes = 0, near = 0;
  const col = Array(N).fill(0);
  for (let i = 0; i < N; i++) {
    const k = popc(b[i]); filled += k; if (k >= N - 2) near += k === N - 1 ? 2 : 1;
    for (let j = 0; j < N; j++) if ((b[i] >> j) & 1) col[j]++;
  }
  for (let j = 0; j < N; j++) if (col[j] >= N - 2) near += col[j] === N - 1 ? 2 : 1;
  for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) if (!((b[i] >> j) & 1)) {
    let k = 0;
    if (i === 0 || (b[i - 1] >> j) & 1) k++; if (i === N - 1 || (b[i + 1] >> j) & 1) k++;
    if (j === 0 || (b[i] >> (j - 1)) & 1) k++; if (j === N - 1 || (b[i] >> (j + 1)) & 1) k++;
    if (k >= 3) holes++;
  }
  return { filled, holes, near };
}
/** Worth of one placement's clear: big spikes count for much more; lone singles cost, unless digging out. */
function clearValue(a, piece, combo, danger) {
  if (!a.n) return 0;
  const lvl = attackLevel(a.n, { allClear: a.empty, piece, combo });
  const lone = a.n === 1 && !combo && !a.empty;
  if (lone) return danger ? 20 : -60;
  return Math.pow(lvl, 1.35) * 25;
}
function evalBoard(b) {
  const { filled, holes, near } = shape(b);
  const danger = filled > N * N * 0.55;
  return near * 14 - holes * 30 - Math.max(0, filled - N * N * 0.45) * 12 - (danger ? 120 : 0);
}

/**
 * The bot's next placement for game state `st` (hand of two, queue), as a
 * piece in play { slot, id, rot, cr, cc }, or null if nothing fits.
 * comboOpen: its last placement cleared and it plays fast enough to chain.
 */
export function botMove(st, skill = 10, rand = Math.random) {
  // Skill 10 is the strongest bot found by simulation (see botMoveOP below).
  if (skill >= 10) return botMoveOP(st, OP_W, rand);
  const smart = (Math.max(1, Math.min(10, skill)) - 1) / 9;
  const chains = skill >= 6 || 1000 / botPps(skill) <= SPIKE_MS;
  const comboOpen = chains && !!st.botComboOpen;
  const b = st.board.map((row) => row.reduce((m, v, j) => (v !== null ? m | (1 << j) : m), 0));
  const danger = shape(b).filled > N * N * 0.55;
  // The first piece goes anywhere it fits, at random: two bots with the same
  // pieces then play different games. After that it plays its best.
  if (!st.pieces) {
    const all = [];
    for (let s = 0; s < 2; s++) for (const p of placesOf(st.hand[s])) if (apply(b, p)) all.push({ s, p });
    if (all.length) {
      const { s, p } = all[Math.floor(rand() * all.length)];
      st.botComboOpen = false;
      return { slot: s, id: st.hand[s], rot: p.rot, cr: p.r + p.h / 2, cc: p.c + p.w / 2 };
    }
  }
  let best = null;
  for (let s = 0; s < 2; s++) for (const p of placesOf(st.hand[s])) {
    const a = apply(b, p); if (!a) continue;
    let v = clearValue(a, st.hand[s], comboOpen, danger);
    if (smart >= 0.5) {
      // Look one placement further: the other piece, or the next one into this slot.
      const hand2 = s === 0 ? [st.queue[0], st.hand[1]] : [st.hand[0], st.queue[0]];
      const c2 = chains && a.n > 0;
      let v2 = -1e9;
      for (let s2 = 0; s2 < 2; s2++) for (const q of placesOf(hand2[s2])) {
        const a2 = apply(a.b, q); if (!a2) continue;
        const w = clearValue(a2, hand2[s2], c2, danger) * 0.8 + evalBoard(a2.b);
        if (w > v2) v2 = w;
      }
      v += v2 === -1e9 ? -4000 : v2 * (0.6 + 0.4 * smart);
    } else v += evalBoard(a.b);
    v += (rand() - 0.5) * 400 * (1 - smart) * (1 - smart);
    if (!best || v > best.v) best = { v, s, p, cleared: a.n > 0 };
  }
  if (!best) return null;
  st.botComboOpen = best.cleared;
  const { s, p } = best;
  return { slot: s, id: st.hand[s], rot: p.rot, cr: p.r + p.h / 2, cc: p.c + p.w / 2 };
}

/* ---------- skill 10: the strongest bot (found by simulation, see .lab/) ----------
 * A beam search three placements deep through its two pieces and the queue
 * (junk included), valuing big spikes and combos, keeping lines one or two
 * squares from full, and keeping the board open: it counts how many ways
 * each piece still fits (mobility) and whether the junk it can see coming
 * will fit at all.
 */
const isJunkId = (id) => id >= 100;
const fitsAt = (b, p) => { for (let i = 0; i < p.m.length; i++) if (b[p.r + i] & p.m[i]) return false; return true; };
function features(b) {
  let filled = 0, holes = 0, near1 = 0, near2 = 0;
  const col = Array(N).fill(0);
  for (let i = 0; i < N; i++) { const k = popc(b[i]); filled += k; if (k === N - 1) near1++; else if (k === N - 2) near2++; for (let j = 0; j < N; j++) if ((b[i] >> j) & 1) col[j]++; }
  for (let j = 0; j < N; j++) { if (col[j] === N - 1) near1++; else if (col[j] === N - 2) near2++; }
  for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) if (!((b[i] >> j) & 1)) {
    let k = 0;
    if (i === 0 || (b[i - 1] >> j) & 1) k++; if (i === N - 1 || (b[i + 1] >> j) & 1) k++;
    if (j === 0 || (b[i] >> (j - 1)) & 1) k++; if (j === N - 1 || (b[i] >> (j + 1)) & 1) k++;
    if (k >= 3) holes++; if (k === 4) holes += 2;
  }
  return { filled, holes, near1, near2 };
}
export const OP_W = { near1: 18, near2: 6, holes: 30, over: 12, overAt: 0.45, danger: 120, mob: 3, junkFit: 250, lone: -60, lonePanic: 20, pow: 1.5, k: 25, depth: 3, beam: 8, disc: 0.8, comboBonus: 30 };
function opClear(W, a, piece, combo, danger) {
  if (!a.n) return 0;
  const lvl = attackLevel(a.n, { allClear: a.empty, piece, combo });
  if (a.n === 1 && !combo && !a.empty) return danger ? W.lonePanic : W.lone;
  return Math.pow(lvl, W.pow) * W.k + (combo ? W.comboBonus : 0);
}
function opEval(W, b, upcoming) {
  const f = features(b);
  const danger = f.filled > N * N * 0.55;
  let v = f.near1 * W.near1 + f.near2 * W.near2 - f.holes * W.holes - Math.max(0, f.filled - N * N * W.overAt) * W.over - (danger ? W.danger : 0);
  if (W.mob) { let m = 0; for (let id = 0; id < 7; id++) { let n = 0; for (const p of placesOf(id)) { if (fitsAt(b, p) && ++n >= 6) break; } m += n; } v += m * W.mob; }
  if (W.junkFit && upcoming) for (const id of upcoming) if (isJunkId(id) && !placesOf(id).some((p) => fitsAt(b, p))) v -= W.junkFit;
  return v;
}
export function botMoveOP(st, W = OP_W, rand = Math.random) {
  const b0 = st.board.map((row) => row.reduce((m, v, j) => (v !== null ? m | (1 << j) : m), 0));
  if (!st.pieces) {
    const all = []; for (let s = 0; s < 2; s++) for (const p of placesOf(st.hand[s])) if (apply(b0, p)) all.push({ s, p });
    if (all.length) { const { s, p } = all[Math.floor(rand() * all.length)]; st.botComboOpen = false; return { slot: s, id: st.hand[s], rot: p.rot, cr: p.r + p.h / 2, cc: p.c + p.w / 2 }; }
  }
  const danger0 = features(b0).filled > N * N * 0.55;
  let frontier = [{ b: b0, hand: st.hand.slice(), q: st.queue.slice(), combo: !!st.botComboOpen, score: 0, first: null }];
  for (let d = 0; d < W.depth; d++) {
    const next = [];
    for (const n of frontier) for (let s = 0; s < 2; s++) {
      const id = n.hand[s]; if (id == null) continue;
      const danger = d === 0 ? danger0 : features(n.b).filled > N * N * 0.55;
      for (const p of placesOf(id)) {
        const a = apply(n.b, p); if (!a) continue;
        const hand = n.hand.slice(); hand[s] = n.q[0];
        next.push({ b: a.b, hand, q: n.q.slice(1), combo: a.n > 0, score: n.score + opClear(W, a, id, n.combo, danger) * Math.pow(W.disc, d), first: n.first || { s, p, cleared: a.n > 0 } });
      }
    }
    if (!next.length) break;
    const last = d === W.depth - 1;
    for (const x of next) x.v = x.score + opEval(W, x.b, last ? x.q.slice(0, 3) : null) * (last ? 1 : 0.3);
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
