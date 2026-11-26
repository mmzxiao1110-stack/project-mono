// Ultra on 10x10 with a "smart" bot: looks two placements ahead (it sees both
// pieces in hand and the forecast) and is tuned to chase 3- and 4-line clears,
// all clears and combos. Compared with the one-move greedy bot. Equal PPS.
//   node server/ultrasmart.mjs [runs]
const S = await import("../shared/sprint.js");
const N = 10, FULL = (1 << N) - 1;
function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
// Every placement of every piece/turn: [{ r, masks: [rowMask...] (rows r..r+h-1) }]
const PL = [0,1,2,3,4,5,6].map((id) => { const out = [], seen = new Set();
  for (let rot = 0; rot < 4; rot++) { const s = S.shapeOf(id, rot);
    for (let r = 0; r + s.h <= N; r++) for (let c = 0; c + s.w <= N; c++) {
      const m = Array(s.h).fill(0); for (const [dr, dc] of s.cells) m[dr] |= 1 << (c + dc);
      const k = r + ":" + m.join(","); if (seen.has(k)) continue; seen.add(k); out.push({ r, m }); } }
  return out; });
function apply(b, p) { // -> { b, n } or null
  for (let i = 0; i < p.m.length; i++) if (b[p.r + i] & p.m[i]) return null;
  const nb = b.slice(); for (let i = 0; i < p.m.length; i++) nb[p.r + i] |= p.m[i];
  let rows = 0, colAnd = FULL; for (let i = 0; i < N; i++) { if (nb[i] === FULL) rows |= 1 << i; colAnd &= nb[i]; }
  const nr = popc(rows), nc = popc(colAnd); if (!nr && !nc) return { b: nb, n: 0 };
  for (let i = 0; i < N; i++) nb[i] = (rows >> i) & 1 ? 0 : nb[i] & ~colAnd;
  return { b: nb, n: nr + nc };
}
function popc(x) { let c = 0; while (x) { x &= x - 1; c++; } return c; }
const pts = (n, combo, empty) => (n ? (S.linePoints(n) + (empty ? S.ALL_CLEAR : 0)) * S.comboMult(combo) : 0);
const isEmpty = (b) => b.every((x) => !x);
// Board shape: rewards lines that are nearly full together (set-ups for 3s/4s), punishes holes.
function shape(b, W) {
  let filled = 0, holes = 0, near = 0, colAnd = FULL;
  const colCount = Array(N).fill(0);
  for (let i = 0; i < N; i++) { const k = popc(b[i]); filled += k; if (k >= N - 2) near += k === N - 1 ? 2 : 1; for (let j = 0; j < N; j++) if ((b[i] >> j) & 1) colCount[j]++; }
  for (let j = 0; j < N; j++) if (colCount[j] >= N - 2) near += colCount[j] === N - 1 ? 2 : 1;
  for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) if (!((b[i] >> j) & 1)) {
    let k = 0; if (i === 0 || (b[i - 1] >> j) & 1) k++; if (i === N - 1 || (b[i + 1] >> j) & 1) k++; if (j === 0 || (b[i] >> (j - 1)) & 1) k++; if (j === N - 1 || (b[i] >> (j + 1)) & 1) k++; if (k >= 3) holes++; }
  // Fewer squares left is better (all clears), most of all when the board is nearly empty.
  return near * W.near - holes * W.hole - Math.max(0, filled - W.room) * W.crowd - filled * W.clean + (filled <= 8 ? (9 - filled) * W.clean * 6 : 0);
}
function smartMove(b, hand, queue, combo, W) {
  let best = null;
  for (let s = 0; s < 2; s++) for (const p of PL[hand[s]]) {
    const a = apply(b, p); if (!a) continue;
    const c1 = a.n ? combo + 1 : 0, e1 = a.n && isEmpty(a.b);
    let v1 = pts(a.n, c1, e1) + (a.n && a.n < 3 && !e1 ? -W.small * (combo ? 0.3 : 1) : 0);
    // second placement: the other hand piece, or the forecast piece now in this slot
    const hand2 = s === 0 ? [queue[0], hand[1]] : [hand[0], queue[0]];
    let v2 = -1e9;
    for (let s2 = 0; s2 < 2; s2++) for (const q of PL[hand2[s2]]) {
      const a2 = apply(a.b, q); if (!a2) continue;
      const c2 = a2.n ? c1 + 1 : 0, e2 = a2.n && isEmpty(a2.b);
      const v = pts(a2.n, c2, e2) * W.future + shape(a2.b, W);
      if (v > v2) v2 = v;
    }
    if (v2 === -1e9) v2 = -5000; // dead end
    const v = v1 + v2;
    if (!best || v > best.v) best = { v, s, p };
  }
  return best;
}
function greedyMove(b, hand, combo) {
  let best = null;
  for (let s = 0; s < 2; s++) for (const p of PL[hand[s]]) {
    const a = apply(b, p); if (!a) continue;
    let holes = 0; for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) if (!((a.b[i] >> j) & 1)) { let k = 0; if (i === 0 || (a.b[i - 1] >> j) & 1) k++; if (i === N - 1 || (a.b[i + 1] >> j) & 1) k++; if (j === 0 || (a.b[i] >> (j - 1)) & 1) k++; if (j === N - 1 || (a.b[i] >> (j + 1)) & 1) k++; if (k >= 3) holes++; }
    const v = pts(a.n, a.n ? combo + 1 : 0, a.n && isEmpty(a.b)) / 50 + a.n * 4 - holes * 3 + Math.random() * 0.5;
    if (!best || v > best.v) best = { v, s, p };
  }
  return best;
}
function game(seed, budget, bot, W) {
  const rand = rng(seed); let bag = [];
  const draw = () => { if (!bag.length) { bag = [0,1,2,3,4,5,6]; for (let i = 6; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [bag[i], bag[j]] = [bag[j], bag[i]]; } } return bag.pop(); };
  let b = Array(N).fill(0); const hand = [draw(), draw()], queue = [draw(), draw(), draw(), draw(), draw()];
  let score = 0, combo = 0, maxCombo = 0, pieces = 0, lines = 0, ac = 0, comboAc = 0; const by = {};
  while (pieces < budget) {
    const m = bot === "smart" ? smartMove(b, hand, queue, combo, W) : greedyMove(b, hand, combo);
    if (!m) return { top: true, score, pieces, lines, by, ac, comboAc, maxCombo };
    const a = apply(b, m.p); b = a.b; pieces++;
    if (a.n) { combo++; maxCombo = Math.max(maxCombo, combo); lines += a.n; by[a.n] = (by[a.n] || 0) + 1; const e = isEmpty(b); if (e) { ac++; if (combo >= 2) comboAc++; } score += Math.round(pts(a.n, combo, e)); } else combo = 0;
    hand[m.s] = queue.shift(); queue.push(draw());
  }
  return { top: false, score, pieces, lines, by, ac, comboAc, maxCombo };
}
const RUNS = Number(process.argv[2]) || 40;
const W = { near: 40, hole: 60, crowd: 25, room: 55, small: 250, future: 0.8, clean: Number(process.argv[3] ?? 0) };
for (const pps of [2, 3]) {
  const budget = pps * 120;
  console.log(`\n=== 10x10, ${pps} PPS → ${budget} pieces in 2 minutes, ${RUNS} runs each ===`);
  for (const bot of ["greedy", "smart"]) {
    const t0 = Date.now();
    const rs = Array.from({ length: RUNS }, (_, i) => game(i * 7919 + 3, budget, bot, W));
    const avg = (f) => rs.reduce((x, r) => x + f(r), 0) / RUNS;
    const by = {}; for (const r of rs) for (const [k, v] of Object.entries(r.by)) by[k] = (by[k] || 0) + v;
    const sc = rs.map((r) => r.score).sort((a, b) => a - b);
    console.log(`${bot.padEnd(6)}: top-outs ${rs.filter((r) => r.top).length}/${RUNS} | score avg ${avg((r) => r.score).toFixed(0)}, median ${sc[RUNS >> 1]}, best ${sc[RUNS - 1]} | lines ${avg((r) => r.lines).toFixed(1)} | longest combo avg ${avg((r) => r.maxCombo).toFixed(1)}  (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
    console.log(`        per run: 1s ${((by[1] || 0) / RUNS).toFixed(1)} | 2s ${((by[2] || 0) / RUNS).toFixed(1)} | 3s ${((by[3] || 0) / RUNS).toFixed(2)} | 4s ${((by[4] || 0) / RUNS).toFixed(2)} | 5+ ${(Object.entries(by).filter(([k]) => k > 4).reduce((x, [, v]) => x + v, 0) / RUNS).toFixed(2)} | all clears ${avg((r) => r.ac).toFixed(2)} (in ${rs.filter((r) => r.ac).length}/${RUNS} runs), ending a combo ${avg((r) => r.comboAc).toFixed(2)}`);
  }
}
