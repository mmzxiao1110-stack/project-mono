import { labMove, BASE_W, match, base } from "./blitzlab.mjs";
const STRATS = {
  s0_base_clone: {},
  s1_beam3: { depth: 3, beam: 8 },
  s2_mobility: { depth: 2, mob: 3 },
  s3_junkaware: { depth: 2, junkFit: 250 },
  s4_combo: { depth: 2, pow: 1.6, comboBonus: 40, near1: 20 },
  s5_defense: { depth: 2, holes: 45, overAt: 0.4, danger: 200 },
  r1_beam3combo: { depth: 3, beam: 8, pow: 1.6, comboBonus: 40, near1: 20 },
  r2_beam3w12: { depth: 3, beam: 12, pow: 1.6, comboBonus: 40, near1: 20 },
  r3_beam4: { depth: 4, beam: 6, pow: 1.6, comboBonus: 40, near1: 20 },
  r4_beam3combo_hot: { depth: 3, beam: 8, pow: 1.8, comboBonus: 80, near1: 24, lone: -90 },
  s7_mix_wide: { depth: 3, beam: 12, mob: 3, junkFit: 250, pow: 1.5, comboBonus: 30, near1: 18 },
  s8_mix_deep: { depth: 4, beam: 5, mob: 3, junkFit: 250, pow: 1.5, comboBonus: 30, near1: 18 },
  s9_mix_hot: { depth: 3, beam: 8, mob: 3, junkFit: 250, pow: 1.8, comboBonus: 70, near1: 24, lone: -90 },
  s10_mix_mob: { depth: 3, beam: 8, mob: 6, junkFit: 400, pow: 1.5, comboBonus: 30, near1: 18, holes: 38 },
  s6_mix: { depth: 3, beam: 8, mob: 3, junkFit: 250, pow: 1.5, comboBonus: 30, near1: 18 },
};
const name = process.argv[2], games = Number(process.argv[3]) || 16, vsName = process.argv[4];
const W = { ...BASE_W, ...STRATS[name] };
const me = (st) => labMove(st, W);
const opp = vsName ? ((W2) => (st) => labMove(st, W2))({ ...BASE_W, ...STRATS[vsName] }) : base;
let wins = 0, losses = 0, len = 0, lvMe = 0, lvThem = 0, ms = 0;
for (let g = 0; g < games; g++) {
  const seed = 7000 + g, t0 = Date.now();
  const swap = g % 2;
  const r = swap ? match(opp, me, seed) : match(me, opp, seed);
  const mine = swap ? "B" : "A", theirs = swap ? "A" : "B";
  if (r.winner === mine) wins++; else if (r.winner === theirs) losses++;
  len += r.t; lvMe += r.lv[mine]; lvThem += r.lv[theirs]; ms += Date.now() - t0;
}
console.log(`${name.padEnd(18)} ${wins}-${losses} vs ${vsName || 'skill10'} | ${(len / games / 1000).toFixed(0)} s/game | attack/game ${(lvMe / games).toFixed(0)} vs ${(lvThem / games).toFixed(0)} | ${(ms / games / 1000).toFixed(1)} s cpu/game`);
