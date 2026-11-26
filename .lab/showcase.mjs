// Plays showcase Blitz matches and writes replay records: node .lab/showcase.mjs out.json
import fs from "node:fs";
import { match, base } from "./blitzlab.mjs";
import { botMoveOP } from "../shared/blitzbot.js";
const op = (st) => botMoveOP(st);
const games = [
  ["OP BOT", "OP BOT II", op, op],
  ["OP BOT", "SKILL 10 (OLD)", op, base],
  ["OP BOT", "OP BOT II", op, op],
];
const recs = [];
for (const [i, [na, nb, a, b]] of games.entries()) {
  // Long enough to show off, short enough to watch: retry seeds until it lasts 45-150 s.
  let r, seed;
  for (let k = 0; k < 30; k++) { seed = 91000 + i * 100 + k; r = match(a, b, seed, { maxMs: 150000 }); if (r.winner && r.t > 45000) break; }
  const diverge = r.log.findIndex((e, j) => j > 0 && e[2] !== -1);
  recs.push({ id: `show${i}`, kind: "blitz", seed, moves: r.log, you: "A", names: { A: na, B: nb }, winner: r.winner, ranked: false, date: Date.now(), name: na, result: { won: r.winner === "A", sent: [r.sent.A, r.sent.B] } });
  const pieces = (s) => r.log.filter((e) => e[1] === s && e[2] !== -1).length;
  console.log(`${na} vs ${nb}: winner ${r.winner} after ${(r.t / 1000).toFixed(0)} s · pieces ${pieces("A")}/${pieces("B")} · attack ${r.lv.A}/${r.lv.B} lv`);
}
fs.writeFileSync(process.argv[2], JSON.stringify(recs));
