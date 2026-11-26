import { newSprint, NAMES } from "../shared/sprint.js";
import * as P from "./pcbot.mjs";
for (const seed of [5000, 5001, 5002]) for (const depth of [6, 7]) {
  const st = newSprint(seed, Infinity);
  const t0 = Date.now();
  const r = P.solveExactExport(st.board.map(() => 0), st.hand.slice(), st.queue.slice(), depth);
  console.log(`seed ${seed} pieces ${st.hand.map((x) => NAMES[x]).join("")}+${st.queue.slice(0, 5).map((x) => NAMES[x]).join("")} depth ${depth}: ${r ? `AC in ${r.d}` : "none"} (${Date.now() - t0} ms)`);
}
