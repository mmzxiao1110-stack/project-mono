// Blitz, bot vs bot, recorded (1080p60 + the game's sound, music off, cut to the start).
// Right: the game's own VS BOT at skill 10 (the strongest bot, ~3 pieces a second).
// Left: the same bot, played like a person at the mouse and keyboard: the cursor
// glides to each spot on a curved, slightly overshooting path, a right click swaps,
// S / D / A turn, a left click places; about 3 pieces a second, never metronomic.
//   node .lab/blitzvs.mjs outdir [name]     (with `npx vite --port 8896` running)
import { createRequire } from "node:module"; import fs from "node:fs";
import { botMoveOP } from "../shared/blitzbot.js";
const { chromium } = createRequire(import.meta.url)("playwright");
const [out = ".", name = "blitz-bots"] = process.argv.slice(2);
const PPS = 3;

const b = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
const ctx = await b.newContext({ viewport: { width: 1920, height: 1080 } });
await ctx.addInitScript(() => {
  // Tee the game's sound to a recorder.
  const orig = AudioNode.prototype.connect;
  AudioNode.prototype.connect = function (dest, ...rest) {
    if (dest instanceof AudioDestinationNode) {
      const c = this.context;
      if (!c.__tap) { c.__tap = c.createMediaStreamDestination(); const rec = new MediaRecorder(c.__tap.stream, { mimeType: "audio/webm" }); const parts = []; rec.ondataavailable = (e) => parts.push(e.data); window.__audio = { rec, parts, t0: 0 }; window.__audioStart = () => { window.__audio.t0 = performance.now(); rec.start(250); }; }
      orig.call(this, c.__tap);
    }
    return orig.call(this, dest, ...rest);
  };
  window.__stopAudio = () => new Promise((res) => { const a = window.__audio; if (!a) return res(null); a.rec.onstop = async () => { const buf = await new Blob(a.parts).arrayBuffer(); let s = ""; const u = new Uint8Array(buf); for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000)); res({ b64: btoa(s), t0: a.t0 }); }; a.rec.stop(); });
  // A cursor you can see in the video (screen captures leave the real one out): a classic arrow.
  addEventListener("DOMContentLoaded", () => {
    const c = document.createElement("div");
    c.innerHTML = '<svg width="22" height="32" viewBox="0 0 11 16" shape-rendering="crispEdges"><path d="M0 0h1v1h1v1h1v1h1v1h1v1h1v1h1v1h1v1h1v1h1v1H7v1h1v1h1v2H8v1H6v-1H5v-2H4v-1H3v1H2v1H1v1H0z" fill="#000"/><path d="M1 2v11h1v-1h1v-1h1v1h1v2h1v1h1v-1h1v-1H7v-2H6V9h3V8H8V7H7V6H6V5H5V4H4V3H3V2H2V1H1z" fill="#fff"/></svg>';
    Object.assign(c.style, { position: "fixed", left: "0", top: "0", zIndex: "2147483647", pointerEvents: "none", transform: "translate(-100px,-100px)" });
    document.body.appendChild(c);
    addEventListener("pointermove", (e) => { c.style.transform = `translate(${e.clientX}px, ${e.clientY}px)`; }, true);
  });
});
const p = await ctx.newPage();
await p.goto("http://localhost:8896");
await p.evaluate(() => { const t = JSON.parse(localStorage.getItem("tb:theme:v8") || "{}"); t.music = 0; localStorage.setItem("tb:theme:v8", JSON.stringify(t)); localStorage.setItem("tb:botSkill", "10"); });
await p.reload();
await p.waitForTimeout(1500); await p.mouse.click(5, 5);
await p.evaluate(() => { window.__labMyName = "BOT · SKILL 10"; });
await p.getByRole("button", { name: /^PLAY/ }).first().click({ force: true }); await p.waitForTimeout(900);
await p.getByText("VS BOT", { exact: true }).first().click({ force: true }); // Blitz's VS BOT (the left column)
await p.waitForFunction(() => window.__blitz, null, { timeout: 15000 });
await p.waitForTimeout(1500);
await p.getByRole("button", { name: "START", exact: true }).click({ force: true });
// Park the cursor beside the board; the run starts after the 3-2-1.
await p.evaluate(() => dispatchEvent(new PointerEvent("pointermove", { clientX: 560, clientY: 640, bubbles: true })));
const startIn = await p.evaluate(() => window.__blitz.live.current.startAt - performance.now());
await p.waitForTimeout(Math.max(0, startIn - 600));

// Capture: every painted frame (JPEG 95) with its time, and the sound from the same moment.
fs.mkdirSync(`${out}/frames`, { recursive: true });
for (const f of fs.readdirSync(`${out}/frames`)) fs.unlinkSync(`${out}/frames/${f}`);
const cdp = await ctx.newCDPSession(p);
const frames = [];
cdp.on("Page.screencastFrame", (f) => {
  frames.push(f.metadata.timestamp);
  fs.writeFileSync(`${out}/frames/${String(frames.length).padStart(6, "0")}.jpg`, Buffer.from(f.data, "base64"));
  cdp.send("Page.screencastFrameAck", { sessionId: f.sessionId }).catch(() => {});
});
await cdp.send("Page.startScreencast", { format: "jpeg", quality: 95, maxWidth: 1920, maxHeight: 1080, everyNthFrame: 1 });
await p.evaluate(() => window.__audioStart?.());
await p.waitForFunction(() => performance.now() >= window.__blitz.live.current.startAt);

/**
 * One piece, the way a hand does it, played in the page on timers (so the automation adds no lag):
 * a beat to read the board, the swap and the turn while the cursor sets off, a curved glide that
 * overshoots a hair and settles, a click. Resolves with the state after it (or null when the game is over).
 */
const playPiece = (plan) => p.evaluate((plan) => new Promise((done) => {
  const { live, boardEl } = window.__blitz;
  const rect = boardEl.current.getBoundingClientRect(), step = rect.width / 8;
  const R = Math.random;
  const tx = rect.left + plan.cc * step + (R() - 0.5) * 0.5 * step, ty = rect.top + plan.cr * step + (R() - 0.5) * 0.5 * step;
  const from = window.__cur || { x: tx - 200, y: ty + 120 };
  const move = (x, y) => { window.__cur = { x, y }; dispatchEvent(new PointerEvent("pointermove", { clientX: x, clientY: y, bubbles: true })); };
  const key = (k) => { dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true })); setTimeout(() => dispatchEvent(new KeyboardEvent("keyup", { key: k, bubbles: true })), 25 + R() * 25); };
  const click = (button) => { const c = window.__cur; dispatchEvent(new PointerEvent("pointerdown", { clientX: c.x, clientY: c.y, button, buttons: button === 2 ? 2 : 1, bubbles: true })); setTimeout(() => dispatchEvent(new PointerEvent("pointerup", { clientX: c.x, clientY: c.y, button, bubbles: true })), 30 + R() * 40); };
  let t = plan.think;
  if (plan.swap) { setTimeout(() => click(2), t); t += 35 + R() * 30; }
  if (plan.turn) { const k = plan.turn; setTimeout(() => key(k), t); t += 30 + R() * 25; }
  // The glide: a bent path (a control point off to one side), eased, overshooting slightly, then a settle.
  const t0 = plan.think * 0.6, dur = plan.glide;
  const dx = tx - from.x, dy = tx === from.x && ty === from.y ? 0 : ty - from.y, len = Math.hypot(dx, dy) || 1;
  const bend = (R() - 0.5) * 0.35 * len, cx = (from.x + tx) / 2 - (dy / len) * bend, cy = (from.y + ty) / 2 + (dx / len) * bend;
  const over = 1 + 0.03 + R() * 0.05;
  const N = Math.max(6, Math.round(dur / 8));
  for (let i = 1; i <= N; i++) {
    const u = i / N, e = u < 1 ? 1 - Math.pow(1 - u, 3) : 1; // fast start, soft landing
    const s = Math.min(1, e * over); // a little past...
    const q = (1 - s) * (1 - s), m = 2 * (1 - s) * s, w = s * s;
    const ex = e * over > 1 ? tx + dx * (e * over - 1) * 0.6 : q * from.x + m * cx + w * tx;
    const ey = e * over > 1 ? ty + dy * (e * over - 1) * 0.6 : q * from.y + m * cy + w * ty;
    setTimeout(() => move(ex + (R() - 0.5) * 0.8, ey + (R() - 0.5) * 0.8), t0 + (u * dur));
  }
  // ...and back onto the spot.
  const land = t0 + dur + 14 + R() * 10;
  setTimeout(() => move(tx, ty), land);
  const at = Math.max(t, land) + plan.settle;
  setTimeout(() => click(0), at);
  setTimeout(() => {
    const c = live.current;
    done(c.result ? null : { board: c.me.board, hand: c.me.hand, queue: c.me.queue, pieces: c.me.pieces, act: c.act });
  }, at + 25);
}), plan);

const read = () => p.evaluate(() => { const c = window.__blitz.live.current; return c.result ? null : { board: c.me.board, hand: c.me.hand, queue: c.me.queue, pieces: c.me.pieces, act: c.act }; });
let s = await read();
const tStart = Date.now();
const lag = await p.evaluate(() => { const c = window.__blitz.live.current; return { late: Math.round(performance.now() - c.startAt), right: c.bot.pieces }; });
if (lag.late > 1000) { console.error(`the left side started ${lag.late} ms late: not a fair recording, run it again`); process.exit(2); }
let comboOpen = false, n = 0, misses = 0;
const turnKey = { 1: "d", 3: "s", 2: "a" };
const LIMIT = Number(process.env.LIMIT) || 2000;
while (s && n < LIMIT) {
  const st = { board: s.board, hand: s.hand, queue: s.queue, pieces: s.pieces, botComboOpen: comboOpen };
  const m = botMoveOP(st);
  if (!m) break;
  comboOpen = st.botComboOpen;
  // The rhythm: a target time per piece at 3 a second, each piece's beats a little uneven.
  const due = tStart + (n + 1) * (1000 / PPS) + (Math.random() - 0.5) * 120;
  const budget = Math.max(170, due - Date.now());
  const think = Math.max(15, budget * (0.12 + Math.random() * 0.1));
  const glide = Math.max(70, budget * (0.5 + Math.random() * 0.12));
  const settle = 10 + Math.random() * 20;
  const before = s.pieces;
  s = await playPiece({ cr: m.cr, cc: m.cc, swap: m.slot !== s.act?.slot, turn: turnKey[m.rot] || null, think, glide, settle });
  if (s && s.pieces === before) { misses++; } // didn't land (a rare wrong spot): read again and replan
  else n++;
  if (n % 25 === 0 && s && s.pieces !== before) {
    const o = await p.evaluate(() => { const c = window.__blitz.live.current; return { bot: c.bot.pieces, sent: c.sent }; });
    console.log(`${((Date.now() - tStart) / 1000).toFixed(1)} s: left ${n} pieces (${misses} misses), right ${o.bot}, sent ${o.sent.me}-${o.sent.bot}`);
  }
}
console.log(`placed ${n} pieces, ${misses} misses, ${((Date.now() - tStart) / 1000).toFixed(1)} s`);
await p.waitForTimeout(4500); // the wave and the end screen
await cdp.send("Page.stopScreencast");
const audio = await p.evaluate(() => window.__stopAudio());
const res = await p.evaluate(() => { const c = window.__blitz?.live.current; return c && { result: c.result, reason: c.reason, sent: c.sent, me: { pieces: c.me.pieces, lines: c.me.lines }, bot: { pieces: c.bot.pieces, lines: c.bot.lines }, secs: ((c.endedAt || performance.now()) - c.startAt) / 1000 }; }).catch(() => null);
await ctx.close(); await b.close();
if (audio) fs.writeFileSync(`${out}/${name}-audio.webm`, Buffer.from(audio.b64, "base64"));
const lines = [];
for (let i = 0; i < frames.length; i++) {
  lines.push(`file 'frames/${String(i + 1).padStart(6, "0")}.jpg'`);
  lines.push(`duration ${Math.max(0.001, (frames[i + 1] ?? frames[i] + 0.04) - frames[i]).toFixed(4)}`);
}
lines.push(`file 'frames/${String(frames.length).padStart(6, "0")}.jpg'`);
fs.writeFileSync(`${out}/frames.txt`, lines.join("\n"));
const { execFileSync } = await import("node:child_process");
execFileSync("ffmpeg", ["-loglevel", "error", "-y", "-f", "concat", "-safe", "0", "-i", `${out}/frames.txt`, ...(audio ? ["-i", `${out}/${name}-audio.webm`] : []),
  "-vf", "fps=60,format=yuv420p", "-c:v", "libx264", "-preset", "slow", "-crf", "14", "-tune", "animation",
  ...(audio ? ["-c:a", "aac", "-b:a", "192k", "-shortest"] : []), "-movflags", "+faststart", `${out}/${name}.mp4`]);
console.log(JSON.stringify(res));
