// Blitz bot vs bot: each plays at its own speed; junk travels as in a real match.
//   node server/blitzsim.mjs
const S = await import("../shared/sprint.js");
const B = await import("../shared/blitzbot.js");
function match(skA, skB, seed) {
  const st = { A: S.newSprint(seed, Infinity), B: S.newSprint(seed, Infinity) };
  const sk = { A: skA, B: skB }, next = { A: 0, B: 0 }, by = { A: {}, B: {} }, sent = { A: [], B: [] };
  const other = (x) => (x === "A" ? "B" : "A");
  for (let t = 0; t < 600000; t += 10) {
    for (const x of ["A", "B"]) {
      const lvl = S.spikeDue(st[x], t); if (lvl) { S.receiveJunk(st[other(x)], lvl); sent[x].push(lvl); }
      if (t >= next[x]) {
        const a = B.botMove(st[x], sk[x]);
        next[x] = t + B.botDelay(st[x], sk[x]);
        if (!a) return { winner: other(x), t, by, sent };
        S.place(st[x], a);
        const L = st[x].last; if (L.lines) { by[x][L.lines] = (by[x][L.lines] || 0) + 1; S.noteClear(st[x], L.lines, t, L.allClear, L.id); }
        if (st[x].over) return { winner: other(x), t, by, sent };
      }
    }
  }
  return { winner: null, t: 600000, by, sent };
}
const RUNS = Number(process.argv[2]) || 20;
for (const [a, b] of [[10, 10], [10, 7], [10, 4], [7, 4], [10, 1]]) {
  let wa = 0, wb = 0, draws = 0, len = 0; const spikes = [], mix = {};
  for (let i = 0; i < RUNS; i++) {
    const r = match(a, b, 9000 + i);
    if (r.winner === "A") wa++; else if (r.winner === "B") wb++; else draws++;
    len += r.t; spikes.push(...r.sent.A);
    for (const [k, v] of Object.entries(r.by.A)) mix[k] = (mix[k] || 0) + v;
  }
  const big = spikes.filter((x) => x >= 6).length;
  console.log(`skill ${a} vs ${b}: ${wa}-${wb}${draws ? ` (${draws} timed out)` : ""} | match ${(len / RUNS / 1000).toFixed(0)} s avg | A's spikes ${spikes.length} (avg level ${(spikes.reduce((x, y) => x + y, 0) / Math.max(1, spikes.length)).toFixed(1)}, ${big} of 6+) | A's clears by size ${JSON.stringify(mix)}`);
}
