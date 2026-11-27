// Plays TOWER Sprint like a fast player (one tap per step, held keys, uneven gaps) and records it (video + game audio).
//   node .lab/zghuman.mjs outdir [stroke]
//   node .lab/zgplay.mjs outdir [pps]
import { createRequire } from "node:module"; import fs from "node:fs";
import * as Z from "../shared/zerog.js";
const { chromium } = createRequire(import.meta.url)("playwright");
const [out = ".", stroke = "pixel"] = process.argv.slice(2);

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
const ctx = await b.newContext({ viewport: { width: 1280, height: 800 }, recordVideo: { dir: out, size: { width: 1280, height: 800 } } });
// Tee everything the page plays to a recorder, so the video can have the game's sound.
await ctx.addInitScript(() => {
  const orig = AudioNode.prototype.connect;
  AudioNode.prototype.connect = function (dest, ...rest) {
    if (dest instanceof AudioDestinationNode) {
      const c = this.context;
      if (!c.__tap) { c.__tap = c.createMediaStreamDestination(); const rec = new MediaRecorder(c.__tap.stream, { mimeType: "audio/webm" }); const parts = []; rec.ondataavailable = (e) => parts.push(e.data); rec.start(250); window.__audio = { rec, parts, t0: performance.now() }; }
      orig.call(this, c.__tap);
    }
    return orig.call(this, dest, ...rest);
  };
  window.__stopAudio = () => new Promise((res) => { const a = window.__audio; if (!a) return res(null); a.rec.onstop = async () => { const buf = await new Blob(a.parts).arrayBuffer(); let s = ""; const u = new Uint8Array(buf); for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000)); res({ b64: btoa(s), t0: a.t0 }); }; a.rec.stop(); });
});
const p = await ctx.newPage();
const t0 = Date.now();
await p.goto("http://localhost:8896");
await p.evaluate((st) => { const t = JSON.parse(localStorage.getItem("tb:theme:v8") || "{}"); t.stroke = st; localStorage.setItem("tb:theme:v8", JSON.stringify(t)); }, stroke);
await p.reload();
await p.waitForTimeout(1500); await p.mouse.click(5, 5);
await p.getByRole("button", { name: /^PLAY/ }).first().click({ force: true }); await p.waitForTimeout(800);
await p.getByText("SPRINT", { exact: true }).nth(1).click({ force: true }); // TOWER's Sprint (the middle column)
await p.waitForFunction(() => window.__zg && window.__zg.current.st.cur, null, { timeout: 15000 });
const tStart = Date.now();
await p.waitForTimeout(1200);
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
let s = await play([]);
let n = 0;
while (s && s.cur && n < 400) {
  const m = plan(s);
  const keys = [];
  if (m.useHold) keys.push("c");
  if (m.turn === 1) keys.push("ArrowUp"); else if (m.turn === -1) keys.push("z"); else if (m.turn === 2) keys.push("a");
  for (let i = 0; i < Math.abs(m.dx); i++) keys.push(m.dx < 0 ? "ArrowLeft" : "ArrowRight");
  keys.push(" ");
  s = await play(keys);
  n++;
}
await p.waitForTimeout(500);
const res = await p.evaluate(() => { const r = window.__zg?.current; return r && { result: r.result, ms: r.endAt - r.startAt, st: { lines: r.st.lines, pieces: r.st.pieces, stats: r.st.stats } }; });
await p.waitForTimeout(4000); // the wave and the end screen
const audio = await p.evaluate(() => window.__stopAudio());
const vid = p.video();
await ctx.close(); await b.close();
const vpath = await vid.path();
fs.renameSync(vpath, `${out}/zerog.webm`);
if (audio) { fs.writeFileSync(`${out}/zerog-audio.webm`, Buffer.from(audio.b64, "base64")); }
fs.writeFileSync(`${out}/zerog.json`, JSON.stringify({ res, audioOffsetMs: audio ? Math.round(audio.t0) : null, navMs: tStart - t0 }, null, 1));
console.log(JSON.stringify(res));
