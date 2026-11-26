// Setup pro vs combo pro, several Blitz games at exactly the same speed.
//   node .lab/duelset.mjs out.json games pps seedBase
import fs from "node:fs";
import { newSprint, place, noteClear, spikeOnMiss, receiveJunk, recordMove, redFull, RED_FLASH_MS, attackLevel } from "../shared/sprint.js";
import { botMoveOP } from "../shared/blitzbot.js";
import { setupMove, setRules, FREE, setBigBonus } from "./setupbot.mjs";
import { placesOf, apply } from "./blitzlab.mjs";
setRules(FREE); setBigBonus(900);
const randomFirst = (inner) => (st) => {
  if (!st.pieces) {
    const all = []; const b = st.board.map((row) => row.reduce((m, v, j) => (v !== null ? m | (1 << j) : m), 0));
    for (let s = 0; s < 2; s++) for (const p of placesOf(st.hand[s])) if (apply(b, p)) all.push({ s, p });
    const { s, p } = all[Math.floor(Math.random() * all.length)];
    return { slot: s, id: st.hand[s], rot: p.rot, cr: p.r + p.h / 2, cc: p.c + p.w / 2 };
  }
  return inner(st);
};
const PROS = { setup: { name: "SETUP PRO", move: randomFirst((st) => setupMove(st)) }, combo: { name: "COMBO PRO", move: randomFirst((st) => botMoveOP(st)) } };
const [out, games = "8", pps = "3", seedBase = "97000"] = process.argv.slice(2);
const DELAY = Math.round(1000 / Number(pps));

function game(seed, aKind, bKind, maxMs = 240000) {
  const kinds = { A: aKind, B: bKind };
  const st = { A: newSprint(seed, Infinity), B: newSprint(seed, Infinity) };
  const next = { A: DELAY, B: DELAY + 50 }, log = [];
  const S = { A: { sent: 0, lv: 0, lines: 0, big: 0, maxCombo: 0 }, B: { sent: 0, lv: 0, lines: 0, big: 0, maxCombo: 0 } };
  const red = { A: 0, B: 0 }, flash = { A: 0, B: 0 };
  const end = (winner, t, reason) => ({ winner, t, reason, log, S, st, kinds });
  for (let t = 0; t < maxMs; t += 10) {
    for (const s of ["A", "B"]) if (flash[s] && t >= flash[s]) {
      if (redFull(st[s].board, red[s])) { log.push([t, s, -3]); return end(s === "A" ? "B" : "A", t, "red"); }
      flash[s] = 0;
    }
    for (const s of ["A", "B"]) {
      if (t < next[s]) continue;
      const o = s === "A" ? "B" : "A";
      const a = PROS[kinds[s]].move(st[s]);
      if (!a) return end(o, t, "stuck");
      const m = recordMove(a, t); place(st[s], a); log.push([t, s, m[1], m[2], m[3], m[4]]);
      const L = st[s].last;
      red[s] = 0; flash[s] = 0;
      if (L.lines) {
        noteClear(st[s], L.lines, t, L.allClear, L.id);
        S[s].lines += L.lines; if (L.lines >= 4) S[s].big++; S[s].maxCombo = Math.max(S[s].maxCombo, st[s].combo);
        red[o] += L.lines; if (!flash[o] && redFull(st[o].board, red[o])) flash[o] = t + RED_FLASH_MS;
      } else {
        const l = spikeOnMiss(st[s]);
        if (l) { receiveJunk(st[o], l); S[s].sent++; S[s].lv += l; log.push([t, o, -1, l]); }
      }
      if (st[s].over) return end(o, t, "stuck");
      next[s] = t + DELAY;
    }
  }
  return end(null, maxMs, "time");
}

const N = Number(games), rows = [], recs = [];
const tot = { setup: { wins: 0, lv: 0, sent: 0, lines: 0, score: 0, big: 0, ms: 0, maxCombo: 0 }, combo: { wins: 0, lv: 0, sent: 0, lines: 0, score: 0, big: 0, ms: 0, maxCombo: 0 } };
for (let g = 0; g < N; g++) {
  const swap = g % 2 === 1, aKind = swap ? "combo" : "setup", bKind = swap ? "setup" : "combo";
  const r = game(Number(seedBase) + g, aKind, bKind);
  for (const s of ["A", "B"]) {
    const k = r.kinds[s], T = tot[k];
    T.lv += r.S[s].lv; T.sent += r.S[s].sent; T.lines += r.S[s].lines; T.score += r.st[s].score; T.big += r.S[s].big; T.ms += r.t; T.maxCombo = Math.max(T.maxCombo, r.S[s].maxCombo);
    if (r.winner === s) T.wins++;
  }
  const kSide = (k) => (r.kinds.A === k ? "A" : "B");
  rows.push(`| ${g + 1} | ${(r.t / 1000).toFixed(0)} s | ${r.winner ? PROS[r.kinds[r.winner]].name : "—"} (${r.reason}) | ${r.S[kSide("setup")].lv} / ${r.S[kSide("combo")].lv} | ${r.st[kSide("setup")].score.toLocaleString("en-US")} / ${r.st[kSide("combo")].score.toLocaleString("en-US")} | ${r.S[kSide("setup")].big} / ${r.S[kSide("combo")].big} |`);
  recs.push({ id: `pro${g}`, kind: "blitz", seed: Number(seedBase) + g, moves: r.log, you: "A", names: { A: PROS[r.kinds.A].name, B: PROS[r.kinds.B].name }, winner: r.winner, ranked: false, date: Date.now(), name: PROS[r.kinds.A].name, result: { won: r.winner === "A", sent: [r.S.A.sent, r.S.B.sent] }, len: r.t });
  console.error(`game ${g + 1}/${N} done`);
}
const per = (k, f) => (tot[k][f] / N);
const perMin = (k, f) => (tot[k][f] / (tot[k].ms / 60000));
let md = `**Setup pro vs combo pro · ${N} games · both exactly ${pps} pieces a second** (sides alternate)\n\n`;
md += `| | SETUP PRO | COMBO PRO |\n| --- | --- | --- |\n`;
md += `| Wins | ${tot.setup.wins} | ${tot.combo.wins} |\n`;
md += `| Junk sent per game (levels) | ${per("setup", "lv").toFixed(1)} | ${per("combo", "lv").toFixed(1)} |\n`;
md += `| Junk sent per minute (levels) | ${perMin("setup", "lv").toFixed(1)} | ${perMin("combo", "lv").toFixed(1)} |\n`;
md += `| Junk pieces sent per game | ${per("setup", "sent").toFixed(1)} | ${per("combo", "sent").toFixed(1)} |\n`;
md += `| Lines cleared per game | ${per("setup", "lines").toFixed(1)} | ${per("combo", "lines").toFixed(1)} |\n`;
md += `| Ultra score, total (all games) | ${tot.setup.score.toLocaleString("en-US")} | ${tot.combo.score.toLocaleString("en-US")} |\n`;
md += `| Ultra score per minute | ${Math.round(perMin("setup", "score")).toLocaleString("en-US")} | ${Math.round(perMin("combo", "score")).toLocaleString("en-US")} |\n`;
md += `| Big clears (4+ lines), total | ${tot.setup.big} | ${tot.combo.big} |\n`;
md += `| Longest combo | ${tot.setup.maxCombo} | ${tot.combo.maxCombo} |\n\n`;
md += `| Game | Length | Winner | Junk levels (setup / combo) | Ultra score (setup / combo) | Big clears (setup / combo) |\n| --- | --- | --- | --- | --- | --- |\n${rows.join("\n")}\n`;
fs.writeFileSync(out, JSON.stringify(recs));
fs.writeFileSync(out.replace(".json", ".md"), md);
console.log(md);
