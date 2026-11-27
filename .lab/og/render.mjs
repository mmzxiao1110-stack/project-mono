// Renders .lab/og/index.html to public/og.png (1200×630), the picture a shared link shows.
import { createRequire } from "node:module";
const { chromium } = createRequire(import.meta.url)("playwright");
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
await p.goto("http://localhost:8896/.lab/og/index.html");
await p.waitForFunction(() => window.__ready);
await p.locator("#card").screenshot({ path: process.argv[2] || "public/og.png" });
await b.close();
