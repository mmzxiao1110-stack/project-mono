import { newSprint, place, T_ID } from "../shared/sprint.js";
import { tMove } from "./tbot.mjs";
const pieces = Number(process.argv[2]) || 300;
const opts = JSON.parse(process.argv[3] || '{}');
const stats = { tclear: 0, build: 0, fallback: 0 };
let tc = 0, tLines = [0, 0, 0, 0, 0, 0], other = 0, placed = 0, deaths = 0; const t0 = Date.now();
for (let g = 0; g < 4; g++) {
  const st = newSprint(6000 + g, Infinity);
  for (let i = 0; i < pieces / 4; i++) {
    const a = tMove(st, { stats, ...opts }); if (!a) { deaths++; break; }
    place(st, a); placed++;
    if (st.last.lines) { if (a.id === T_ID) { tc++; tLines[Math.min(5, st.last.lines)]++; } else other++; }
    if (st.over) { deaths++; break; }
  }
}
console.log(`${JSON.stringify(opts)} ${placed} pieces: ${tc} T clears (lines: 5→${tLines[5]}, 4→${tLines[4]}, fewer→${tLines[1] + tLines[2] + tLines[3]}), ${other} other clears, ${deaths} deaths · ${JSON.stringify(stats)} · ${((Date.now() - t0) / placed).toFixed(0)} ms/move`);
