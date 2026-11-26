/**
 * The Blitz bot, shared by VS BOT (in the browser) and simulations.
 * skill 1..10 sets both its speed (1 piece per 2 s at 1, 2 a second at 10)
 * and how well it plays: at the top it looks two placements ahead, goes for
 * combos and big spikes (3s, 4s, T set-ups, all clears), and only takes a
 * lone single line to dig out when its board is in danger (downstacking).
 */
import { SIZE, shapeOf, attackLevel, SPIKE_MS } from "./sprint.js";

const N = SIZE, FULL = (1 << N) - 1;
export const botPps = (skill) => 0.5 + (Math.max(1, Math.min(10, skill)) - 1) * (1.5 / 9);
/**
 * Milliseconds until the bot's next placement. A skilled bot speeds up while
 * a combo is open (like a human chasing the 500 ms window), then rests.
 */
export function botDelay(st, skill) {
  const base = 1000 / botPps(skill);
  if (skill >= 6 && st.botComboOpen) return Math.min(base, 380 - (skill - 6) * 30);
  return base;
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
  const smart = (Math.max(1, Math.min(10, skill)) - 1) / 9;
  const chains = skill >= 6 || 1000 / botPps(skill) <= SPIKE_MS;
  const comboOpen = chains && !!st.botComboOpen;
  const b = st.board.map((row) => row.reduce((m, v, j) => (v !== null ? m | (1 << j) : m), 0));
  const danger = shape(b).filled > N * N * 0.55;
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
