// Films Control replays in the real replay viewer: node .lab/recctrl.mjs recs.json outdir
import { createRequire } from "node:module"; import fs from "node:fs";
const { chromium } = createRequire(import.meta.url)("playwright");
const [recsPath, out] = process.argv.slice(2);
const recs = JSON.parse(fs.readFileSync(recsPath, "utf8"));
const b = await chromium.launch();
for (const [i, rec] of recs.entries()) {
  const ctx = await b.newContext({ viewport: { width: 1280, height: 720 }, recordVideo: { dir: out, size: { width: 1280, height: 720 } } });
  const p = await ctx.newPage();
  await p.goto("http://localhost:8896");
  await p.evaluate((r) => { localStorage.setItem("tb:replays", JSON.stringify([{ ...r, id: "lab" }])); localStorage.setItem("tb:replayTab", "match"); }, rec);
  await p.reload(); await p.waitForTimeout(1200); await p.mouse.click(5, 5);
  const t0 = Date.now();
  await p.getByRole("button", { name: /REPLAYS/i }).first().click({ force: true }); await p.waitForTimeout(900);
  await p.locator("button", { hasText: "vs" }).first().click({ force: true }); await p.waitForTimeout(800);
  const startAt = (Date.now() - t0) / 1000 + 1.2;
  await p.getByRole("button", { name: "Play", exact: true }).click({ force: true });
  await p.waitForTimeout(rec.turns.length * 900 + 3000);
  const v = p.video(); await ctx.close();
  const file = await v.path();
  fs.renameSync(file, `${out}/control-${i + 1}.webm`);
  fs.writeFileSync(`${out}/control-${i + 1}.start`, String(startAt));
  console.log("filmed", i + 1, rec.players.A.name, "vs", rec.players.B.name, `${rec.result.a}-${rec.result.b}`);
}
await b.close();
