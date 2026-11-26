// Solo test: how often the all-clear bot clears, and how many of its clears are all clears.
import { newSprint, place, recordMove } from "../shared/sprint.js";
import { pcMove } from "./pcbot.mjs";
const pieces = Number(process.argv[2]) || 400;
let ac = 0, other = 0, t0 = Date.now(), stats = { solved: 0, built: 0, spread: 0, fallback: 0 }, deaths = 0, placed = 0;
for (let g = 0; g < 5; g++) {
  const st = newSprint(5000 + g, Infinity);
  for (let i = 0; i < pieces / 5; i++) {
    const a = pcMove(st, { stats }); if (!a) { deaths++; break; }
    place(st, a); placed++;
    if (st.last.lines) { if (st.last.allClear) ac++; else other++; }
    if (st.over) { deaths++; break; }
  }
}
console.log(`${placed} pieces: ${ac} all clears (one every ${(placed / Math.max(1, ac)).toFixed(1)} pieces), ${other} other clears, ${deaths} deaths · moves: ${JSON.stringify(stats)} · ${((Date.now() - t0) / placed).toFixed(1)} ms/move`);
