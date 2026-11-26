// Ultra on 7x7 vs 8x8: same bot, same pieces per second (so the same number of pieces in 2 minutes).
const S = await import('../shared/sprint.js');
function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function game(N, seed, budget) {
  const rand = rng(seed); let bag = [];
  const draw = () => { if (!bag.length) { bag = [0,1,2,3,4,5,6]; for (let i = 6; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [bag[i], bag[j]] = [bag[j], bag[i]]; } } return bag.pop(); };
  const board = Array.from({ length: N }, () => Array(N).fill(false));
  const hand = [draw(), draw()], queue = [draw(), draw(), draw()];
  let score = 0, combo = 0, lines = 0, pieces = 0, allClears = 0, comboAllClears = 0; const bySize = {};
  while (pieces < budget) {
    let best = null;
    for (let slot = 0; slot < 2; slot++) for (let rot = 0; rot < 4; rot++) {
      const sh = S.shapeOf(hand[slot], rot);
      for (let r = 0; r + sh.h <= N; r++) for (let c = 0; c + sh.w <= N; c++) {
        if (!sh.cells.every(([dr, dc]) => !board[r + dr][c + dc])) continue;
        const b = board.map((row) => row.slice()); for (const [dr, dc] of sh.cells) b[r + dr][c + dc] = true;
        let n = 0; for (let i = 0; i < N; i++) { if (b[i].every(Boolean)) n++; if (b.every((row) => row[i])) n++; }
        let holes = 0, filled = 0;
        for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) { if (b[i][j]) { filled++; continue; } let k = 0; for (const [x, y] of [[1,0],[-1,0],[0,1],[0,-1]]) { const ii = i + x, jj = j + y; if (ii < 0 || jj < 0 || ii >= N || jj >= N || b[ii][jj]) k++; } if (k >= 3) holes++; }
        const pts = n ? S.linePoints(n) * S.comboMult(combo + 1) : 0;
        const v = pts / 50 + n * 4 - holes * 3 - (n ? 0 : filled * 0.02) + rand() * 0.5;
        if (!best || v > best.v) best = { v, slot, sh, r, c };
      }
    }
    if (!best) return { topOut: true, score, lines, pieces, bySize, allClears, comboAllClears };
    for (const [dr, dc] of best.sh.cells) board[best.r + dr][best.c + dc] = true;
    const rows = [], cols = [];
    for (let i = 0; i < N; i++) { if (board[i].every(Boolean)) rows.push(i); if (board.every((row) => row[i])) cols.push(i); }
    for (const i of rows) for (let j = 0; j < N; j++) board[i][j] = false;
    for (const j of cols) for (let i = 0; i < N; i++) board[i][j] = false;
    const n = rows.length + cols.length;
    pieces++; lines += n;
    if (n) { combo++; bySize[n] = (bySize[n] || 0) + 1; score += Math.round(S.linePoints(n) * S.comboMult(combo)); } else combo = 0;
    if (n && board.every((row) => row.every((v) => !v))) { allClears++; if (combo >= 2) comboAllClears++; }
    hand[best.slot] = queue.shift(); queue.push(draw());
  }
  return { topOut: false, score, lines, pieces, bySize, allClears, comboAllClears };
}
const RUNS = 150;
for (const pps of [2, 3]) {
  const budget = pps * 120;
  console.log(`\n=== ${pps} PPS → ${budget} pieces in 2 minutes (${RUNS} runs each) ===`);
  for (const N of [7, 8, 10]) {
    const rs = Array.from({ length: RUNS }, (_, i) => game(N, i * 977 + N, budget));
    const avg = (f) => rs.reduce((a, r) => a + f(r), 0) / RUNS;
    const clears = {}; for (const r of rs) for (const [k, v] of Object.entries(r.bySize)) clears[k] = (clears[k] || 0) + v;
    const tot = Object.values(clears).reduce((a, b) => a + b, 0);
    const mix = ['1','2','3','4'].map((k) => `${k}s: ${((clears[k] || 0) / RUNS).toFixed(2)}/run (${(100 * (clears[k] || 0) / tot).toFixed(1)}%)`).join(' | ') + (Object.keys(clears).some((k) => k > 4) ? ` | 5+: ${(Object.entries(clears).filter(([k]) => k > 4).reduce((a, [, v]) => a + v, 0) / RUNS).toFixed(2)}/run` : '');
    const scores = rs.map((r) => r.score).sort((a, b) => a - b);
    console.log(`${N}x${N}: top-outs ${rs.filter((r) => r.topOut).length}/${RUNS} | pieces placed avg ${avg((r) => r.pieces).toFixed(0)} | lines avg ${avg((r) => r.lines).toFixed(1)} | score avg ${avg((r) => r.score).toFixed(0)}, median ${scores[RUNS >> 1]}, best ${scores[RUNS - 1]}`);
    console.log(`      clears: ${mix}`);
    console.log(`      all clears: ${avg((r) => r.allClears).toFixed(2)}/run (runs with one: ${rs.filter((r) => r.allClears).length}/${RUNS}); at the end of a combo: ${avg((r) => r.comboAllClears).toFixed(2)}/run`);
  }
}
