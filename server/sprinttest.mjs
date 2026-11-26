// Sprint engine checks: spawn shapes, turning (no drift at walls or corners),
// the 7-bag, and that 40 lines is reachable (a simple greedy bot, 300 runs).
//   node server/sprinttest.mjs
const S = await import("../shared/sprint.js");
const ok = (c, w) => { console.log((c ? "PASS " : "FAIL ") + w); if (!c) process.exitCode = 1; };
const key = (cells) => cells.map(([r, c]) => r * S.SIZE + c).sort((a, b) => a - b).join(",");

const N = S.SIZE;
const SPAWNS = { I: [[3,2],[3,3],[3,4],[3,5]], O: [[3,3],[3,4],[4,3],[4,4]], T: [[3,2],[3,3],[3,4],[4,3]], S: [[3,3],[3,4],[4,2],[4,3]], Z: [[3,2],[3,3],[4,3],[4,4]], J: [[3,2],[4,2],[4,3],[4,4]], L: [[3,4],[4,2],[4,3],[4,4]] };
for (const [i, n] of S.NAMES.entries()) ok(key(S.cellsOf(S.spawn({ hand: [i] }, 0))) === key(SPAWNS[n]), `${n} spawns flat in the middle`);

let bad = 0;
for (let id = 0; id < 7; id++) for (const [dr, dc] of [[0, 0], [0, -1], [0, 1], [-1, 0], [1, 0], [-1, -1], [-1, 1], [1, -1], [1, 1]]) for (let k = 0; k < 4; k++) {
  let a = S.shift(S.spawn({ hand: [id] }, 0), dr, dc, true);
  for (let i = 0; i < k; i++) a = S.turn(a, 1);
  const start = key(S.cellsOf(a));
  for (const dir of [1, -1]) { let t = a; for (let i = 0; i < 4; i++) { t = S.turn(t, dir); if (!S.cellsOf(t).every(([r, c]) => r >= 0 && c >= 0 && r < N && c < N)) bad++; } if (key(S.cellsOf(t)) !== start) bad++; }
  if (key(S.cellsOf(S.turn(S.turn(a, 1), -1))) !== start) bad++;
}
ok(bad === 0, "turning stays on the board and never drifts (centre, edges, corners)");

// The bag, as the engine deals it: the opening hand and forecast, then every new forecast.
function dealt(seed, n) {
  const st = S.newSprint(seed), out = [...st.hand, ...st.queue];
  while (out.length < n && !st.over) {
    const m = best(st); if (!m) break;
    S.place(st, { slot: m.slot, id: st.hand[m.slot], rot: m.rot, cr: m.r + m.s.h / 2, cc: m.c + m.s.w / 2 });
    out.push(st.queue[st.queue.length - 1]);
  }
  return out;
}
function best(st) {
  let b = null;
  for (let slot = 0; slot < S.HAND; slot++) for (let rot = 0; rot < 4; rot++) {
    const s = S.shapeOf(st.hand[slot], rot);
    for (let r = 0; r + s.h <= N; r++) for (let c = 0; c + s.w <= N; c++) {
      if (!s.cells.every(([dr, dc]) => st.board[r + dr][c + dc] === null)) continue;
      const bb = st.board.map((row) => row.map((v) => v !== null)); for (const [dr, dc] of s.cells) bb[r + dr][c + dc] = true;
      let lines = 0, holes = 0;
      for (let i = 0; i < N; i++) { if (bb[i].every(Boolean)) lines++; if (bb.every((row) => row[i])) lines++; }
      for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) if (!bb[i][j]) { let n = 0; for (const [x, y] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const ii = i + x, jj = j + y; if (ii < 0 || jj < 0 || ii >= N || jj >= N || bb[ii][jj]) n++; } if (n >= 3) holes++; }
      const score = lines * 50 - holes * 3 + Math.random();
      if (!b || score > b.score) b = { score, slot, rot, r, c, s };
    }
  }
  return b;
}
{
  // Every block of 7 deals (in bag order) holds each tetromino exactly once.
  let ok7 = true, checked = 0;
  for (let g = 0; g < 50; g++) {
    const d = dealt(g + 1000, 63);
    for (let i = 0; i + 7 <= d.length; i += 7) { checked++; if (new Set(d.slice(i, i + 7)).size !== 7) ok7 = false; }
  }
  ok(ok7, `7-bag: every 7 pieces dealt hold all 7 tetrominoes (${checked} bags checked)`);
}

let wins = 0;
for (let g = 0; g < 300; g++) {
  const st = S.newSprint(g * 31 + 7);
  while (!st.over) { const m = best(st); if (!m) break; S.place(st, { slot: m.slot, id: st.hand[m.slot], rot: m.rot, cr: m.r + m.s.h / 2, cc: m.c + m.s.w / 2 }); }
  if (st.won) wins++;
}
ok(wins / 300 > 0.6, `40 lines is reachable: a one-move greedy bot finishes ${wins}/300 runs`);
