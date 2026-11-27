// Render a story to video with headless Chromium + three.js.
//   node pipeline/render.mjs glow                 → out/glow/video.mp4 (silent)
//   node pipeline/render.mjs glow --stills        → out/glow/stills/NN.jpg (one frame per beat, for review)
//   options: --fps 30 --w 1080 --h 1920 --workers 3 --from 0 --to <sec>
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const story = args[0];
const opt = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
const flag = k => args.includes('--' + k);
const FPS = +opt('fps', 30), W = +opt('w', 1080), H = +opt('h', 1920), WORKERS = +opt('workers', 3);
const OUT = path.join(ROOT, 'out', story);

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.woff2': 'font/woff2', '.wav': 'audio/wav' };
function serve() {
  return new Promise(res => {
    const srv = http.createServer((req, rsp) => {
      const p = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]));
      if (!p.startsWith(ROOT) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { rsp.writeHead(404); return rsp.end(); }
      rsp.writeHead(200, { 'content-type': TYPES[path.extname(p)] || 'application/octet-stream' });
      fs.createReadStream(p).pipe(rsp);
    }).listen(0, () => res(srv));
  });
}

async function openPage(browser, port) {
  const page = await browser.newPage({ viewport: { width: W, height: H } });
  page.on('console', m => { if (m.type() === 'error') console.error('[page]', m.text()); });
  page.on('pageerror', e => console.error('[page error]', e.message));
  await page.goto(`http://localhost:${port}/engine/index.html?w=${W}&h=${H}`);
  await page.waitForFunction(() => window.setup);
  const info = await page.evaluate(s => window.setup(s), story);
  return { page, info };
}

const b64 = d => Buffer.from(d.slice(d.indexOf(',') + 1), 'base64');

async function main() {
  const srv = await serve(); const port = srv.address().port;
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const timeline = JSON.parse(fs.readFileSync(path.join(OUT, 'timeline.json')));

  if (flag('stills')) {
    const dir = path.join(OUT, 'stills'); fs.mkdirSync(dir, { recursive: true });
    const { page } = await openPage(browser, port);
    const only = opt('beat', null);
    for (const b of timeline.beats) {
      if (only !== null && +only !== b.i) continue;
      const t = b.start + b.dur * +(opt('at', 0.6));
      const t0 = Date.now();
      fs.writeFileSync(path.join(dir, `${String(b.i).padStart(2, '0')}.jpg`), b64(await page.evaluate(([t]) => window.frameAt(t, 0.88), [t])));
      console.log(`still ${b.i} @${t.toFixed(2)}s  ${Date.now() - t0}ms`);
    }
    await browser.close(); srv.close(); return;
  }

  const from = +opt('from', 0), to = +opt('to', timeline.duration);
  const total = Math.ceil((to - from) * FPS);
  const per = Math.ceil(total / WORKERS);
  const parts = [];
  const started = Date.now(); let done = 0;
  await Promise.all(Array.from({ length: WORKERS }, async (_, w) => {
    const a = w * per, b = Math.min(total, a + per); if (a >= b) return;
    const file = path.join(OUT, `part${w}.mp4`); parts[w] = file;
    const ff = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'mjpeg', '-i', '-',
      '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p', file], { stdio: ['pipe', 'inherit', 'inherit'] });
    const { page } = await openPage(browser, port);
    for (let f = a; f < b; f++) {
      const t = from + f / FPS;
      const buf = b64(await page.evaluate(([t]) => window.frameAt(t, 0.93), [t]));
      if (!ff.stdin.write(buf)) await new Promise(r => ff.stdin.once('drain', r));
      done++;
      if (done % 30 === 0) {
        const el = (Date.now() - started) / 1000, eta = el / done * (total - done);
        console.log(`${done}/${total} frames  ${(el / done * 1000).toFixed(0)}ms/frame  eta ${Math.round(eta)}s`);
      }
    }
    ff.stdin.end(); await new Promise(r => ff.on('close', r));
    await page.close();
  }));
  const list = path.join(OUT, 'parts.txt');
  fs.writeFileSync(list, parts.filter(Boolean).map(p => `file '${p}'`).join('\n'));
  await new Promise((r, j) => spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', path.join(OUT, 'video.mp4')], { stdio: 'inherit' }).on('close', c => c ? j(c) : r()));
  parts.filter(Boolean).forEach(p => fs.unlinkSync(p)); fs.unlinkSync(list);
  console.log(`video → ${path.join(OUT, 'video.mp4')}  (${((Date.now() - started) / 1000).toFixed(0)}s)`);
  await browser.close(); srv.close();
}
main().catch(e => { console.error(e); process.exit(1); });
