// Ultra, solo: points per piece for a bot, and what 2 minutes would score at a few speeds.
import { newSprint, place } from "../shared/sprint.js";
import { setupMove, setRules, RELAXED, FREE } from "./setupbot.mjs";
import { botMoveOP } from "../shared/blitzbot.js";
const which = process.argv[2] || "setup", pieces = Number(process.argv[3]) || 360, games = Number(process.argv[4]) || 4;
if (which === "relaxed") setRules(RELAXED);
if (which === "free") setRules(FREE);
const move = which === "setup" || which === "relaxed" || which === "free" ? (st) => setupMove(st) : (st) => botMoveOP(st);
let total = 0, placed = 0, died = 0, acs = 0, big = 0, small = 0, maxCombo = 0; const t0 = Date.now();
const perGame = [];
for (let g = 0; g < games; g++) {
  const st = newSprint(7100 + g, Infinity);
  let k = 0;
  for (; k < pieces; k++) {
    const a = move(st); if (!a) { died++; break; }
    place(st, a); placed++;
    if (st.last.lines) { if (st.last.allClear) acs++; if (st.last.lines >= 4) big++; else small++; maxCombo = Math.max(maxCombo, st.combo); }
    if (st.over) { died++; break; }
  }
  perGame.push(`${st.score.toLocaleString("en-US")} in ${k + 1}`);
  total += st.score;
}
const ppp = total / placed;
console.log(`${which}: ${(ppp).toFixed(0)} points/piece · games ${perGame.join(", ")} · deaths ${died}/${games} · all clears ${acs}, big clears ${big}, small ${small}, best combo ${maxCombo} · ${((Date.now() - t0) / placed).toFixed(0)} ms/move`);
for (const pps of [2, 3, 5]) console.log(`  at ${pps} PPS (${pps * 120} pieces): ~${Math.round(ppp * pps * 120).toLocaleString("en-US")} if it survives`);
