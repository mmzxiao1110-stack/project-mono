// A Blitz duel between two different bots, with a full log of clears and combos.
//   node .lab/duel.mjs out.json
import fs from "node:fs";
import { newSprint, place, noteClear, spikeDue, receiveJunk, recordMove, NAMES, isJunk, junkLevel } from "../shared/sprint.js";
import { botDelay, botMoveOP } from "../shared/blitzbot.js";
import { setupMove, setRules, FREE } from "./setupbot.mjs";
import { placesOf, apply } from "./blitzlab.mjs";
setRules(FREE);
// Both open with a random first piece, so they play different games from the start.
const randomFirst = (inner) => (st) => {
  if (!st.pieces) {
    const all = []; const b = st.board.map((row) => row.reduce((m, v, j) => (v !== null ? m | (1 << j) : m), 0));
    for (let s = 0; s < 2; s++) for (const p of placesOf(st.hand[s])) if (apply(b, p)) all.push({ s, p });
    const { s, p } = all[Math.floor(Math.random() * all.length)];
    st.botComboOpen = false;
    return { slot: s, id: st.hand[s], rot: p.rot, cr: p.r + p.h / 2, cc: p.c + p.w / 2 };
  }
  return inner(st);
};
const bots = {
  A: { name: "COMBO PLANNER", move: randomFirst((st) => setupMove(st)) },
  B: { name: "SKILL 10", move: randomFirst((st) => botMoveOP(st)) },
};
function duel(seed, maxMs = 150000) {
  const st = { A: newSprint(seed, Infinity), B: newSprint(seed, Infinity) };
  const next = { A: 300, B: 450 }, sent = { A: 0, B: 0 }, lv = { A: 0, B: 0 }, log = [];
  const clears = { A: {}, B: {} }, combos = { A: {}, B: {} }, streak = { A: 0, B: 0 };
  const endStreak = (s) => { if (streak[s]) combos[s][streak[s]] = (combos[s][streak[s]] || 0) + 1; streak[s] = 0; };
  for (let t = 0; t < maxMs; t += 10) {
    for (const s of ["A", "B"]) { const o = s === "A" ? "B" : "A"; const l = spikeDue(st[s], t); if (l) { receiveJunk(st[o], l); sent[s]++; lv[s] += l; log.push([t, o, -1, l]); } }
    for (const s of ["A", "B"]) {
      if (t < next[s]) continue;
      const o = s === "A" ? "B" : "A";
      const a = bots[s].move(st[s]);
      if (!a) { endStreak("A"); endStreak("B"); return { winner: o, t, log, sent, lv, clears, combos, st }; }
      const m = recordMove(a, t); place(st[s], a); log.push([t, s, m[1], m[2], m[3], m[4]]);
      const L = st[s].last;
      if (L.lines) {
        const piece = isJunk(a.id) ? `junk ${junkLevel(a.id)}` : NAMES[a.id];
        const k = `${piece}|${L.lines}${L.allClear ? "|AC" : ""}`;
        clears[s][k] = (clears[s][k] || 0) + 1;
        streak[s]++;
        noteClear(st[s], L.lines, t, L.allClear, L.id);
      } else endStreak(s);
      if (st[s].over) { endStreak("A"); endStreak("B"); return { winner: o, t, log, sent, lv, clears, combos, st }; }
      next[s] = t + botDelay(st[s], 10);
    }
  }
  endStreak("A"); endStreak("B");
  return { winner: null, t: maxMs, log, sent, lv, clears, combos, st };
}
// A match long enough to show off: retry seeds until one lasts 50-150 s with a winner.
let r, seed;
for (let k = 0; k < 20; k++) { seed = 93000 + k; r = duel(seed); if (r.winner && r.t > 50000) break; }
const rec = { id: "duel", kind: "blitz", seed, moves: r.log, you: "A", names: { A: bots.A.name, B: bots.B.name }, winner: r.winner, ranked: false, date: Date.now(), name: bots.A.name, result: { won: r.winner === "A", sent: [r.sent.A, r.sent.B] } };
fs.writeFileSync(process.argv[2], JSON.stringify([rec]));
// The tables.
const pieceOrder = ["I", "O", "T", "S", "Z", "J", "L"];
const keys = new Set([...Object.keys(r.clears.A), ...Object.keys(r.clears.B)]);
const rows = [];
for (const p of pieceOrder) for (let n = 1; n <= 5; n++) rows.push(`${p}|${n}`);
const extra = [...keys].filter((k) => !rows.includes(k)).sort();
const all = [...rows, ...extra];
const sum = (s) => Object.values(r.clears[s]).reduce((a, b) => a + b, 0);
let md = `| Clear | ${bots.A.name} | ${bots.B.name} |\n| --- | --- | --- |\n`;
for (const k of all) {
  const [p, n, ac] = k.split("|");
  md += `| ${p} · ${n} line${n === "1" ? "" : "s"}${ac ? " · ALL CLEAR" : ""} | ${r.clears.A[k] || 0} | ${r.clears.B[k] || 0} |\n`;
}
md += `| **Total clears** | **${sum("A")}** | **${sum("B")}** |\n`;
const maxC = Math.max(1, ...Object.keys(r.combos.A).map(Number), ...Object.keys(r.combos.B).map(Number));
let cm = `| Combo length | ${bots.A.name} | ${bots.B.name} |\n| --- | --- | --- |\n`;
for (let n = 1; n <= maxC; n++) cm += `| ${n} | ${r.combos.A[n] || 0} | ${r.combos.B[n] || 0} |\n`;
const pieces = (s) => r.log.filter((e) => e[1] === s && e[2] !== -1).length;
const summary = `Seed ${seed} · ${(r.t / 1000).toFixed(1)} s · winner ${r.winner ? bots[r.winner].name : "none"} · pieces ${pieces("A")} / ${pieces("B")} · junk sent ${r.sent.A} (${r.lv.A} levels) / ${r.sent.B} (${r.lv.B} levels)`;
fs.writeFileSync(process.argv[2].replace(".json", ".md"), `${summary}\n\n${md}\n${cm}`);
console.log(summary); console.log(md); console.log(cm);
