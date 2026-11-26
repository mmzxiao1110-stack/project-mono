import { bots, play } from "./controllab.mjs";
const [x, y, games = 10, caution = 0.35, mine = 10, theirs = 8] = process.argv.slice(2);
const o = { caution: Number(caution), mine: Number(mine), theirs: Number(theirs) };
let w = 0, l = 0, d = 0, margin = 0; const t0 = Date.now();
for (let g = 0; g < Number(games); g++) {
  const swap = g % 2, seed = 300 + g;
  const r = swap ? play(bots[y], bots[x], seed, null, o) : play(bots[x], bots[y], seed, o, null);
  const me = swap ? r.b : r.a, them = swap ? r.a : r.b;
  if (me > them) w++; else if (me < them) l++; else d++; margin += me - them;
}
console.log(`${x}(c=${caution},m=${mine},t=${theirs}) vs ${y}: ${w}-${l}-${d}, avg margin ${(margin / games).toFixed(1)}, ${((Date.now() - t0) / games / 1000).toFixed(1)} s/game`);
