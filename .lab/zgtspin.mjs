// Plays TOWER Ultra (2 minutes) from a plan made by .lab/tspinbot.mjs (T-spin doubles and triples, then combo spikes
// when the stack is high), with fast realistic taps, and records it in full HD with the game's sound.
//   node .lab/zgtspin.mjs outdir plan.json [stroke]
//   node .lab/zghuman.mjs outdir [stroke]
//   node .lab/zgplay.mjs outdir [pps]
import { createRequire } from "node:module"; import fs from "node:fs";
import * as Z from "../shared/zerog.js";
import { pieceOrder } from "./pcsolver.mjs";
const { chromium } = createRequire(import.meta.url)("playwright");
const [out = ".", planPath, stroke = "pixel"] = process.argv.slice(2);
const PLAN = JSON.parse(fs.readFileSync(planPath, "utf8"));

// Board evaluation (El-Tetris style), plus a small pull towards clearing and keeping a well on the right.
function evalBoard(board, last, landY) {
  let holes = 0, rowT = 0, colT = 0, wells = 0;
  const hts = [];
  for (let x = 0; x < Z.W; x++) {
    let h = 0, seen = false;
    for (let y = 0; y < Z.H; y++) { const f = board[y][x] !== null; if (f && !seen) { seen = true; h = Z.H - y; } else if (!f && seen) holes++; }
    hts.push(h);
  }
  for (let y = 0; y < Z.H; y++) { let prev = true; for (let x = 0; x < Z.W; x++) { const f = board[y][x] !== null; if (f !== prev) rowT++; prev = f; } if (!prev) rowT++; }
  for (let x = 0; x < Z.W; x++) { let prev = false; for (let y = 0; y < Z.H; y++) { const f = board[y][x] !== null; if (f !== prev) colT++; prev = f; } if (!prev) colT++; }
  for (let x = 0; x < Z.W - 1; x++) { const l = x ? hts[x - 1] : 99, r = x < Z.W - 1 ? hts[x + 1] : 99; const d = Math.min(l, r) - hts[x]; if (d > 0) wells += (d * (d + 1)) / 2; }
  const n = last.lines;
  return -4.5 * (Z.H - landY) + 3.4 * n + (n === 4 ? 12 : n >= 2 ? 2 : 0) - 3.2 * rowT - 9.3 * colT - 7.9 * holes * 1.2 - 3.4 * wells + (last.spin === "full" ? 8 : 0)
    - (n < 3 ? 30 * Z.cellsOf(last.piece).filter(([x]) => x === 9).length : 0) + (n === 4 ? 40 : 0) + (n && last.combo >= 1 ? 4 * last.combo : 0);
}
const fresh = (s) => ({ ...s, rand: Math.random, board: s.board.map((r) => r.slice()), queue: s.queue.slice(), cur: { ...s.cur }, stats: { ...s.stats } });
// Every reachable spot: (hold?) turn at spawn, slide, drop. Returns the key plan.
function plan(s) {
  let best = null;
  for (const useHold of [false, true]) {
    if (useHold && s.held) continue;
    for (const turn of [0, 1, 2, -1]) for (let dx = -6; dx <= 6; dx++) {
      const t = fresh(s);
      if (useHold && !Z.hold(t)) continue;
      if (!t.cur) continue;
      if (turn && !Z.rotate(t, turn)) continue;
      let ok = true;
      for (let i = 0; i < Math.abs(dx); i++) if (!Z.shift(t, Math.sign(dx))) { ok = false; break; }
      if (!ok) continue;
      const land = Z.dropped(t.board, t.cur).y;
      const L = Z.hardDrop(t);
      const v = evalBoard(t.board, L, land) + Math.random() * 0.01;
      if (!best || v > best.v) best = { v, useHold, turn, dx };
    }
  }
  return best;
}

const b = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
// Full HD; frames are captured straight from the browser (see below), not with the low-bitrate built-in recorder.
const ctx = await b.newContext({ viewport: { width: 1920, height: 1080 } });
// Tee everything the page plays to a recorder, so the video can have the game's sound.
await ctx.addInitScript(() => {
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
});
const p = await ctx.newPage();
const t0 = Date.now();
await p.goto("http://localhost:8896");
// The block style, and no music: just the game's sound effects.
await p.evaluate((st) => { const t = JSON.parse(localStorage.getItem("tb:theme:v8") || "{}"); t.stroke = st; t.music = 0; localStorage.setItem("tb:theme:v8", JSON.stringify(t)); }, stroke);
await p.reload();
await p.waitForTimeout(1500); await p.mouse.click(5, 5);
await p.getByRole("button", { name: /^PLAY/ }).first().click({ force: true }); await p.waitForTimeout(800);
await p.evaluate((seed) => { window.__zgNextSeed = seed; }, PLAN.seed); // the run's piece order: the one the plan was made for
await p.getByText("ULTRA", { exact: true }).nth(1).click({ force: true }); // TOWER's Ultra (the middle column): 2 minutes
await p.waitForFunction(() => window.__zg && window.__zg.current.st.cur, null, { timeout: 15000 });
const tStart = Date.now();
await p.waitForTimeout(2500); // the wave settles; then the recording starts, right as the run does
// Capture: every frame the page paints (JPEG, quality 95) with its time, and the game's audio from the same moment.
fs.mkdirSync(`${out}/frames`, { recursive: true });
const cdp = await ctx.newCDPSession(p);
const frames = [];
cdp.on("Page.screencastFrame", async (f) => {
  frames.push(f.metadata.timestamp);
  fs.writeFileSync(`${out}/frames/${String(frames.length).padStart(6, "0")}.jpg`, Buffer.from(f.data, "base64"));
  cdp.send("Page.screencastFrameAck", { sessionId: f.sessionId }).catch(() => {});
});
await cdp.send("Page.startScreencast", { format: "jpeg", quality: 95, maxWidth: 1920, maxHeight: 1080, everyNthFrame: 1 });
await p.evaluate(() => window.__audioStart?.());
// A fast player at the keyboard: no pauses to think, just a quick, slightly uneven stream of taps. Every
// step sideways is its own tap (nothing slides into the wall at once), every key is held for a moment.
// The page plays each piece's taps itself, on a timer (so the browser automation adds no lag): every key
// held ~20-30 ms, the next tap ~50-70 ms after the last. Then it hands back the board for the next piece.
const play = (keys) => p.evaluate((keys) => new Promise((done) => {
  let at = 0;
  for (const k of keys) {
    const hold = 20 + Math.random() * 10, gap = 50 + Math.random() * 20;
    setTimeout(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: k })), at);
    setTimeout(() => window.dispatchEvent(new KeyboardEvent("keyup", { key: k })), at + hold);
    at += gap;
  }
  setTimeout(() => {
    const r = window.__zg.current, st = r.st;
    done(r.result ? null : { board: st.board, cur: st.cur, hold: st.hold, held: st.held, queue: st.queue, lines: st.lines, pieces: st.pieces, combo: st.combo, b2b: st.b2b, goal: st.goal, stats: st.stats, over: st.over });
  }, at + 5);
}), keys);
await play([]);
// Play the plan: each piece's keys (hold, then its path: slides, turns, soft drops, the tucks and spins), then the drop.
// After every piece, check the board is the one the plan expects (the same game played in node).
const KEY = { l: "ArrowLeft", r: "ArrowRight", c: "ArrowUp", w: "z", f: "a", d: "ArrowDown" };
const sim = Object.assign(Z.newGame(PLAN.seed, Infinity), { incoming: [] });
let k = 0;
for (const m of PLAN.moves) {
  const keys = [...(m.hold ? ["c"] : []), ...m.keys.map((c) => KEY[c]), " "];
  if (m.hold) Z.hold(sim);
  for (const c of m.keys) Z.applyOp(sim, [0, c]);
  Z.hardDrop(sim);
  const s = await play(keys);
  if (!s) break; // the two minutes are up
  if (JSON.stringify(s.board) !== JSON.stringify(sim.board)) { console.log(`off plan at piece ${k}`); break; }
  k++;
}
console.log(`played ${k} pieces of the plan`);
await p.waitForTimeout(500);
const res = await p.evaluate(() => { const r = window.__zg?.current; return r && { result: r.result, ms: r.endAt - r.startAt, st: { lines: r.st.lines, pieces: r.st.pieces, stats: r.st.stats } }; });
await p.waitForTimeout(3500); // the wave and the end screen
await cdp.send("Page.stopScreencast");
const audio = await p.evaluate(() => window.__stopAudio());
await ctx.close(); await b.close();
if (audio) { fs.writeFileSync(`${out}/zerog-audio.webm`, Buffer.from(audio.b64, "base64")); }
// The frames with how long each was on screen, for ffmpeg; then encode at 60 fps, high quality, with the sound.
const lines = [];
for (let i = 0; i < frames.length; i++) {
  lines.push(`file 'frames/${String(i + 1).padStart(6, "0")}.jpg'`);
  lines.push(`duration ${Math.max(0.001, (frames[i + 1] ?? frames[i] + 0.04) - frames[i]).toFixed(4)}`);
}
lines.push(`file 'frames/${String(frames.length).padStart(6, "0")}.jpg'`);
fs.writeFileSync(`${out}/frames.txt`, lines.join("\n"));
const { execFileSync } = await import("node:child_process");
execFileSync("ffmpeg", ["-loglevel", "error", "-y", "-f", "concat", "-safe", "0", "-i", `${out}/frames.txt`, ...(audio ? ["-i", `${out}/zerog-audio.webm`] : []),
  "-vf", "fps=60,format=yuv420p", "-c:v", "libx264", "-preset", "slow", "-crf", "14", "-tune", "animation",
  ...(audio ? ["-c:a", "aac", "-b:a", "192k", "-shortest"] : []), "-movflags", "+faststart", `${out}/tower-ultra-tspins.mp4`]);
fs.writeFileSync(`${out}/zerog.json`, JSON.stringify({ res, audioOffsetMs: audio ? Math.round(audio.t0) : null, navMs: tStart - t0 }, null, 1));
console.log(JSON.stringify(res));
