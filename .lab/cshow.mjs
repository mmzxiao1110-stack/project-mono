import fs from "node:fs";
import { bots, play, record } from "./controllab.mjs";
const out = [];
const pick = (a, b, na, nb, oa, ob, seeds) => {
  for (const s of seeds) { const g = play(a, b, s, oa, ob); if (g.a !== g.b) { out.push(record(g, na, nb)); console.log(`${na} vs ${nb}: ${g.a}-${g.b} in ${g.turns.length} turns (seed ${s})`); return; } }
};
pick(bots.deep2, bots.deep2, "DEEP BOT", "DEEP BOT II", { caution: 0.7 }, { caution: 0.35 }, [811, 812, 813, 814]);
pick(bots.deep2, bots.l10, "DEEP BOT", "LEVEL 10 (OLD)", {}, null, [821, 822, 823, 824]);
fs.writeFileSync(process.argv[2], JSON.stringify(out));
