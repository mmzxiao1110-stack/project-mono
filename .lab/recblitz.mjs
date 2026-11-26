// Records Blitz replays with the game's SAVE VIDEO: node .lab/recblitz.mjs recs.json outdir
import { createRequire } from "node:module"; import fs from "node:fs";
const { chromium } = createRequire(import.meta.url)("playwright");
const [recsPath, out] = process.argv.slice(2);
const recs = JSON.parse(fs.readFileSync(recsPath, "utf8"));
const b = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
for (const [i, rec] of recs.entries()) {
  const ctx = await b.newContext({ viewport: { width: 1440, height: 860 }, acceptDownloads: true });
  const p = await ctx.newPage();
  await p.goto("http://localhost:8896");
  await p.evaluate((r) => { localStorage.setItem("tb:replays", JSON.stringify([r])); localStorage.setItem("tb:replayTab", "blitz"); }, rec);
  await p.reload(); await p.waitForTimeout(1200); await p.mouse.click(5, 5);
  await p.getByRole("button", { name: /REPLAYS/i }).first().click({ force: true }); await p.waitForTimeout(900);
  await p.locator("button", { hasText: "vs" }).first().click({ force: true }); await p.waitForTimeout(800);
  const end = rec.moves[rec.moves.length - 1][0];
  const dl = p.waitForEvent("download", { timeout: end + 60000 });
  await p.getByRole("button", { name: "SAVE VIDEO" }).click();
  const d = await dl; await d.saveAs(`${out}/blitz-${i + 1}.webm`);
  console.log("recorded", i + 1, rec.names.A, "vs", rec.names.B);
  await ctx.close();
}
await b.close();
