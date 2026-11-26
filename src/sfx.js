/**
 * Sound — every effect in the game, synthesised live with Web Audio.
 * No sound files: nothing to download, and every sound is tuned to the rest.
 *
 * The palette, to match the look:
 *   pixel   — pulse waves (the 8-bit 12.5% / 25% shapes), pitch that moves in
 *             60-a-second steps like an old console, a touch of bit-crush.
 *   aquatic — bubbles (a sine whose pitch leaps upward as it pops), a "water"
 *             low-pass on the whole mix, a watery echo.
 *   space   — a long, dark reverb tail, sonar pings, shimmer high up.
 *
 * Everything is in one key (D major pentatonic), so any two sounds that
 * overlap are in tune with each other.
 */

import { getZgMinor } from "./zgKeys.js";

let ctx = null;
let out = null;        // everything dry goes here
let send = null;       // …and this feeds the echo and the reverb
let master = null;
let sfxVol = null;     // the effects' own volume, ahead of the shared mixer
let comp = null;       // the mixer everything ends in (music too)
let volume = 0.7;      // 0..1 (the slider is 0..10)
let pulse12 = null, pulse25 = null;
let noiseBuf = null;
let crushCurve = null;

const last = {};       // throttles, per sound

/** D major pentatonic, from D2. `note(i)` walks up the scale. */
const SCALE = [0, 2, 4, 7, 9];
const D2 = 38;
const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
const note = (i, base = D2) => mtof(base + 12 * Math.floor(i / 5) + SCALE[((i % 5) + 5) % 5]);
const rand = (a, b) => a + Math.random() * (b - a);
const FRAME = 1 / 60; // one console frame: the step size for "pixel" pitch moves

function pulseWave(c, duty) {
  const n = 64, re = new Float32Array(n), im = new Float32Array(n);
  for (let k = 1; k < n; k++) re[k] = (2 / (k * Math.PI)) * Math.sin(k * Math.PI * duty);
  return c.createPeriodicWave(re, im);
}

/** A dark, wide room: decaying stereo noise with the highs rolled off as it fades. */
function makeReverb(c, seconds = 3.2) {
  const len = Math.floor(c.sampleRate * seconds);
  const buf = c.createBuffer(2, len, c.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    let lp = 0;
    for (let i = 0; i < len; i++) {
      const t = i / len;
      // Smooth the noise more and more as it decays: the tail gets darker.
      const k = 0.55 - 0.45 * t;
      lp += k * ((Math.random() * 2 - 1) - lp);
      d[i] = lp * Math.pow(1 - t, 2.4) * (i < 400 ? i / 400 : 1);
    }
  }
  const conv = c.createConvolver();
  conv.buffer = buf;
  return conv;
}

function ensure() {
  if (ctx) return ctx;
  const AC = typeof window !== "undefined" && (window.AudioContext || window.webkitAudioContext);
  if (!AC) return null;
  try { ctx = new AC({ latencyHint: "interactive" }); } catch { return null; }

  pulse12 = pulseWave(ctx, 0.125);
  pulse25 = pulseWave(ctx, 0.25);

  noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
  const nd = noiseBuf.getChannelData(0);
  for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;

  // Bit-crush: round each sample to one of a few dozen levels. Just a little grit.
  crushCurve = new Float32Array(4096);
  for (let i = 0; i < 4096; i++) {
    const x = (i / 4095) * 2 - 1;
    crushCurve[i] = Math.round(x * 24) / 24;
  }

  master = ctx.createGain();
  master.gain.value = 0.9;
  sfxVol = ctx.createGain();
  sfxVol.gain.value = curve(volume);

  comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -16;
  comp.knee.value = 10;
  comp.ratio.value = 4;
  comp.attack.value = 0.003;
  comp.release.value = 0.18;

  // Underwater: the whole mix sits under a gentle low-pass.
  const water = ctx.createBiquadFilter();
  water.type = "lowpass";
  water.frequency.value = 6800;
  water.Q.value = 0.6;

  out = ctx.createGain();
  out.gain.value = 1;
  const crush = ctx.createWaveShaper();
  crush.curve = crushCurve;
  const crushMix = ctx.createGain();
  crushMix.gain.value = 0.22;
  out.connect(water);
  out.connect(crush); crush.connect(crushMix); crushMix.connect(water);
  water.connect(sfxVol);

  // Space: a watery echo into a long, dark reverb.
  send = ctx.createGain();
  send.gain.value = 1;
  const delay = ctx.createDelay(1);
  delay.delayTime.value = 0.29;
  const fb = ctx.createGain();
  fb.gain.value = 0.3;
  const dly = ctx.createBiquadFilter();
  dly.type = "lowpass";
  dly.frequency.value = 2200;
  send.connect(delay); delay.connect(dly); dly.connect(fb); fb.connect(delay);
  const verb = makeReverb(ctx);
  const verbIn = ctx.createGain();
  verbIn.gain.value = 0.9;
  send.connect(verbIn); dly.connect(verbIn);
  verbIn.connect(verb);
  const wet = ctx.createGain();
  wet.gain.value = 0.42;
  verb.connect(wet);
  const echoOut = ctx.createGain();
  echoOut.gain.value = 0.22;
  dly.connect(echoOut);
  wet.connect(sfxVol);
  echoOut.connect(sfxVol);

  sfxVol.connect(comp);
  comp.connect(master);
  master.connect(ctx.destination);
  return ctx;
}

const curve = (v) => (v <= 0 ? 0 : Math.pow(v, 1.6));

/** The shared audio core, for the music: the context, the mixer, the wave shapes. */
export function core() {
  const c = ensure();
  if (!c) return null;
  return { ctx: c, mix: comp, pulse12, pulse25, noiseBuf, makeReverb };
}

/** Runs `cb` once audio is allowed to play (now, if it already is). */
const readyCbs = new Set();
export function onAudioReady(cb) {
  if (ctx && ctx.state === "running") { cb(); return () => {}; }
  readyCbs.add(cb);
  return () => readyCbs.delete(cb);
}
function fireReady() {
  for (const cb of [...readyCbs]) { readyCbs.delete(cb); try { cb(); } catch { /* keep the others */ } }
}

/** Browsers start audio only after a tap or key. Called from those. */
export function unlock() {
  const c = ensure();
  if (!c) return;
  if (c.state === "suspended") c.resume().then(fireReady).catch(() => {});
  else if (c.state === "running") fireReady();
}

/** 0..10, the settings slider. */
export function setVolume(v) {
  volume = Math.max(0, Math.min(10, Number(v) || 0)) / 10;
  if (sfxVol && ctx) sfxVol.gain.setTargetAtTime(curve(volume), ctx.currentTime, 0.02);
}

function ready() {
  if (volume <= 0) return null;
  const c = ensure();
  if (!c || c.state !== "running") return null;
  return c;
}

/** Did `name` play in the last `ms`? */
function recent(name, ms) {
  return !!last[name] && performance.now() - last[name] < ms;
}

/** Only one of `name` per `ms`: drags and hovers fire far more often than ears want. */
function throttle(name, ms) {
  const now = performance.now();
  if (last[name] && now - last[name] < ms) return false;
  last[name] = now;
  return true;
}

/* ------------------------------------------------------------------
   Voices
   ------------------------------------------------------------------ */

function panner(c, pan) {
  if (!pan || !c.createStereoPanner) return null;
  const p = c.createStereoPanner();
  p.pan.value = Math.max(-1, Math.min(1, pan));
  return p;
}

/** Route a voice: dry to the mix, plus `wet` of it into the echo and reverb. */
function route(c, node, { pan = 0, wet = 0.2 } = {}) {
  const p = panner(c, pan);
  const head = p || node;
  if (p) node.connect(p);
  head.connect(out);
  if (wet > 0) {
    const s = c.createGain();
    s.gain.value = wet;
    head.connect(s);
    s.connect(send);
  }
}

/**
 * One note.
 *   wave    "sine" | "triangle" | "square" | "p12" | "p25"
 *   f, to   start and end pitch; `steps` moves between them in console frames
 *   a, d    attack and decay (s); `hold` before the decay
 *   lp      an optional low-pass that closes from lp[0] to lp[1]
 */
function tone(c, t, { wave = "p25", f = 440, to = null, glide = 0.1, steps = false, vol = 0.2, a = 0.003, hold = 0, d = 0.2, pan = 0, wet = 0.2, lp = null, vib = 0, detune = 0 }) {
  const o = c.createOscillator();
  if (wave === "p12") o.setPeriodicWave(pulse12);
  else if (wave === "p25") o.setPeriodicWave(pulse25);
  else o.type = wave;
  o.detune.value = detune;
  o.frequency.setValueAtTime(f, t);
  if (to) {
    if (steps) {
      // Pixel pitch: jump frame by frame instead of gliding.
      const n = Math.max(1, Math.round(glide / FRAME));
      for (let i = 1; i <= n; i++) o.frequency.setValueAtTime(f * Math.pow(to / f, i / n), t + i * FRAME);
    } else {
      o.frequency.exponentialRampToValueAtTime(Math.max(20, to), t + glide);
    }
  }
  if (vib) {
    const l = c.createOscillator(), lg = c.createGain();
    l.frequency.value = 5.5;
    lg.gain.setValueAtTime(0, t);
    lg.gain.linearRampToValueAtTime(f * vib, t + hold + 0.15);
    l.connect(lg); lg.connect(o.frequency);
    l.start(t); l.stop(t + a + hold + d + 0.05);
  }
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(vol, t + a);
  if (hold) g.gain.setValueAtTime(vol, t + a + hold);
  g.gain.exponentialRampToValueAtTime(0.0001, t + a + hold + d);
  let head = o;
  if (lp) {
    const fl = c.createBiquadFilter();
    fl.type = "lowpass";
    fl.Q.value = lp[2] ?? 4;
    fl.frequency.setValueAtTime(lp[0], t);
    fl.frequency.exponentialRampToValueAtTime(lp[1], t + a + hold + d);
    o.connect(fl);
    head = fl;
  }
  head.connect(g);
  route(c, g, { pan, wet });
  o.start(t);
  o.stop(t + a + hold + d + 0.05);
}

/** Filtered noise: splashes, whooshes, crunches. */
function hiss(c, t, { type = "bandpass", f = 1200, to = null, q = 1.2, vol = 0.15, a = 0.005, hold = 0, d = 0.2, pan = 0, wet = 0.25, crush = false }) {
  const src = c.createBufferSource();
  src.buffer = noiseBuf;
  src.loop = true;
  src.playbackRate.value = crush ? 0.25 : 1; // slowed noise = chunky, pixel-y grit
  const fl = c.createBiquadFilter();
  fl.type = type;
  fl.Q.value = q;
  fl.frequency.setValueAtTime(f, t);
  if (to) fl.frequency.exponentialRampToValueAtTime(to, t + a + hold + d);
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(vol, t + a);
  if (hold) g.gain.setValueAtTime(vol, t + a + hold);
  g.gain.exponentialRampToValueAtTime(0.0001, t + a + hold + d);
  src.connect(fl); fl.connect(g);
  route(c, g, { pan, wet });
  src.start(t, Math.random() * 0.5);
  src.stop(t + a + hold + d + 0.05);
}

/** A bubble: a pure tone whose pitch leaps up as it pops. */
function bubble(c, t, f = 700, vol = 0.12, pan = 0, wet = 0.3) {
  const len = rand(0.045, 0.075);
  tone(c, t, { wave: "sine", f, to: f * rand(2.2, 3.0), glide: len, vol, a: 0.002, d: len + 0.02, pan, wet });
}

/** A low thump: the weight of something landing in water. */
function thump(c, t, { f = 150, to = 46, vol = 0.45, d = 0.22 } = {}) {
  tone(c, t, { wave: "sine", f, to, glide: d * 0.7, vol, a: 0.002, d, wet: 0.05 });
}

/** A run of bubbles rising: `n` of them over `span` seconds. */
function fizz(c, t, n = 5, span = 0.12, { lo = 500, hi = 1500, vol = 0.08, pan = 0, spread = 0.5 } = {}) {
  for (let i = 0; i < n; i++) {
    bubble(c, t + (i / n) * span + rand(0, span / n), rand(lo, hi), vol * rand(0.6, 1), pan + rand(-spread, spread));
  }
}

/** A chord, arpeggiated frame by frame, the old-console way. */
function arp(c, t, notes, { wave = "p25", step = 0.045, vol = 0.1, d = 0.25, pan = 0, wet = 0.35, lp = null } = {}) {
  notes.forEach((f, i) => tone(c, t + i * step, { wave, f, vol, d, pan, wet, lp }));
}

/* ------------------------------------------------------------------
   The game's sounds
   ------------------------------------------------------------------ */

function play(name, ms, fn) {
  const c = ready();
  if (!c) return;
  if (ms && !throttle(name, ms)) return;
  fn(c, c.currentTime + 0.005);
}

/* ------------------------------------------------------------------
   ZERO-G sounds: bubbles, a low harp, an aquatic chip voice and a soft
   high piano far back in the reverb. All in A major (A minor with the
   MINOR KEY setting on).
   ------------------------------------------------------------------ */

const ZG_MAJOR = [0, 2, 4, 5, 7, 9, 11];
const ZG_MINOR = [0, 2, 3, 5, 7, 8, 10];
const A3 = 57, A5 = 81;
/** Scale degree `d` above `base` (an A) as a MIDI note, in the key the player picked. */
const za = (d, base = A3) => base + 12 * Math.floor(d / 7) + (getZgMinor() ? ZG_MINOR : ZG_MAJOR)[((d % 7) + 7) % 7];
const spread = (i, n) => (n > 1 ? (i / (n - 1)) * 1.2 - 0.6 : 0);
const COMBO_TOP = 7; // the combo melody climbs one octave of the scale, A to A

/** The chip voice: a pulse wave in a deep, watery room (a low-pass that closes, a little wobble, lots of echo). */
function chip(c, t, m, { vol = 0.03, d = 0.45, duty = "p25", pan = 0, wet = 0.7, steps = null, a = 0.002 } = {}) {
  const f = mtof(m);
  tone(c, t, { wave: duty, f, to: steps ? mtof(steps) : null, glide: 3 * FRAME, steps: !!steps, vol, a, d, pan, wet, lp: [7000, 1400, 1.2], vib: 0.0035 });
  tone(c, t, { wave: "sine", f: f / 2, vol: vol * 0.35, a: a * 2, d: d * 0.8, pan: -pan, wet });
}
/** A low harp string: a soft pluck that darkens as it rings, with a slightly detuned twin. */
function harp(c, t, m, { vol = 0.05, d = 1.6, pan = 0, wet = 0.5 } = {}) {
  const f = mtof(m);
  tone(c, t, { wave: "triangle", f, vol, a: 0.002, d, pan, wet, lp: [Math.min(9000, f * 9), f * 1.3, 0.7] });
  tone(c, t, { wave: "sine", f, vol: vol * 0.5, a: 0.003, d: d * 1.1, pan: -pan, wet, detune: 8 });
}
/**
 * The piano, high and far away: stretched overtones (a real string's are
 * slightly sharp), a pair of detuned strings for the beating, a felt hammer,
 * a fast first decay into a long tail, and nearly all of it sent to the reverb.
 */
function piano(c, t, m, { vol = 0.018, d = 3, pan = 0, wet = 1 } = {}) {
  const f = mtof(m), B = 0.0003;
  [[1, 1], [2, 0.42], [3, 0.2], [4, 0.1], [5, 0.05], [6, 0.03]].forEach(([n, g]) => {
    const fn = n * f * Math.sqrt(1 + B * n * n);
    if (fn > 16000) return;
    tone(c, t, { wave: "sine", f: fn, vol: vol * g, a: 0.002, d: d / Math.pow(n, 0.7), pan, wet });
    if (n === 1) {
      tone(c, t, { wave: "sine", f: fn, vol: vol * 0.55, a: 0.002, d, pan: -pan, wet, detune: 3 });
      tone(c, t, { wave: "sine", f: fn, vol: vol * 0.6, a: 0.002, d: 0.18, pan, wet: wet * 0.5 }); // the bright first moment
    }
  });
  hiss(c, t, { type: "lowpass", f: 2200, q: 0.7, vol: vol * 0.5, d: 0.025, pan, wet: 0.4 });
}
/** The crisp stab: a bright chip A over its third, ringing out under water (`base` moves it by octaves). */
function stab(c, t, { vol = 0.036, base = A5, a = 0.002 } = {}) {
  chip(c, t, za(7, base), { vol, d: 0.7, a });
  chip(c, t, za(4, base), { vol: vol * 0.6, d: 0.7, a });
}
/** A rolled run on the harp through the scale from degree a to b. */
function harpRun(c, t, a, b, { step = 0.04, base = A3, vol = 0.04, d = 1.4 } = {}) {
  const dir = b >= a ? 1 : -1, n = Math.abs(b - a) + 1;
  for (let i = 0; i < n; i++) harp(c, t + i * step, za(a + dir * i, base), { vol, d, pan: spread(i, n) * 0.7 });
  return t + n * step;
}
/** The muffled underwater thump of a piece landing, with a pixel step down in pitch. */
function muffle(c, t, { vol = 0.3, f = 150 } = {}) {
  tone(c, t, { wave: "sine", f, to: f * 0.35, glide: 0.09, vol, a: 0.002, d: 0.16, wet: 0.08 });
  tone(c, t, { wave: "p25", f: f * 0.75, to: f * 0.4, glide: 4 * FRAME, steps: true, vol: vol * 0.12, a: 0.002, d: 0.1, wet: 0.15, lp: [700, 180, 1] });
  hiss(c, t, { type: "lowpass", f: 500, to: 150, q: 1, vol: vol * 0.25, d: 0.1, wet: 0.2 });
}

export const sfx = {
  recent,

  /** The pointer moving onto a button: barely there, a soft round tick (no buzz). */
  hover() {
    play("hover", 90, (c, t) => {
      tone(c, t, { wave: "sine", f: note(15), vol: 0.008, a: 0.004, d: 0.035, wet: 0.08, pan: rand(-0.15, 0.15) });
    });
  },

  /** Any button pressed: a bubble and a click. */
  tap() {
    play("tap", 30, (c, t) => {
      bubble(c, t, rand(620, 760), 0.1, 0, 0.18);
      tone(c, t, { wave: "p12", f: note(15), to: note(17), glide: 2 * FRAME, steps: true, vol: 0.04, d: 0.04, wet: 0.1 });
    });
  },

  /** Back / close: the bubble sinks instead. */
  back() {
    play("back", 40, (c, t) => {
      tone(c, t, { wave: "sine", f: 900, to: 380, glide: 0.07, vol: 0.09, d: 0.09, wet: 0.25 });
      tone(c, t + 0.01, { wave: "p12", f: note(14), to: note(11), glide: 3 * FRAME, steps: true, vol: 0.035, d: 0.06, wet: 0.2 });
    });
  },

  /** A popup or panel opening: a bubble rising with a little shimmer. */
  open() {
    play("open", 60, (c, t) => {
      tone(c, t, { wave: "sine", f: 300, to: 1100, glide: 0.11, vol: 0.09, d: 0.14, wet: 0.35 });
      fizz(c, t + 0.04, 3, 0.1, { lo: 900, hi: 1800, vol: 0.045 });
    });
  },

  /** A switch flipping on (up a fifth) or off (down). */
  toggle(on) {
    play("toggle", 40, (c, t) => {
      const [a, b] = on ? [note(12), note(15)] : [note(15), note(12)];
      tone(c, t, { wave: "p25", f: a, vol: 0.06, d: 0.05, wet: 0.2 });
      tone(c, t + 2 * FRAME, { wave: "p25", f: b, vol: 0.06, d: 0.1, wet: 0.3 });
      bubble(c, t, on ? 800 : 520, 0.06);
    });
  },

  /** A slider moving a notch. `frac` 0..1 walks up the scale, so it plays a tune. */
  slider(frac) {
    play("slider", 28, (c, t) => {
      const i = 10 + Math.round(Math.max(0, Math.min(1, frac)) * 10);
      tone(c, t, { wave: "p25", f: note(i), vol: 0.085, d: 0.07, wet: 0.25, lp: [4000, 1400, 2] });
      bubble(c, t, note(i + 5), 0.06, 0, 0.2);
    });
  },

  /** Picking the piece up. */
  pick() {
    play("pick", 60, (c, t) => {
      tone(c, t, { wave: "sine", f: 340, to: 900, glide: 0.08, vol: 0.1, d: 0.1, wet: 0.2 });
      tone(c, t + 0.02, { wave: "p12", f: note(17), vol: 0.025, d: 0.05, wet: 0.3 });
    });
  },

  /** The held piece sliding to another square: a faint drip. */
  move(legal = true) {
    play("move", 34, (c, t) => {
      const f = legal ? rand(1250, 1450) : rand(500, 560);
      tone(c, t, { wave: "sine", f, to: f * 0.7, glide: 0.025, vol: legal ? 0.03 : 0.022, d: 0.035, wet: 0.12 });
    });
  },

  /** Turning the piece: a three-frame arpeggio and a puff of water. */
  rotate(dir = 1) {
    play("rotate", 40, (c, t) => {
      const base = dir > 0 ? 12 : 14;
      const run = dir > 0 ? [base, base + 1, base + 2] : [base, base - 1, base - 2];
      run.forEach((i, k) => tone(c, t + k * 1.5 * FRAME, { wave: "p25", f: note(i), vol: 0.07, d: 0.05, wet: 0.2, pan: dir * 0.1 }));
      hiss(c, t, { f: 2400, to: 900, q: 2, vol: 0.03, d: 0.07, wet: 0.1 });
    });
  },

  /** Not allowed there: a dull, muffled bonk. */
  illegal() {
    play("illegal", 120, (c, t) => {
      tone(c, t, { wave: "square", f: 98, to: 82, glide: 3 * FRAME, steps: true, vol: 0.06, d: 0.13, wet: 0.05, lp: [900, 300, 1] });
      tone(c, t + 0.06, { wave: "square", f: 82, vol: 0.04, d: 0.1, wet: 0.05, lp: [700, 250, 1] });
    });
  },

  /** Switching to place, delete or pin. */
  mode(kind) {
    play("mode", 60, (c, t) => {
      if (kind === "delete") {
        // A crunchy zap falling away.
        tone(c, t, { wave: "p12", f: note(17), to: note(7), glide: 6 * FRAME, steps: true, vol: 0.09, d: 0.12, wet: 0.2 });
        hiss(c, t, { f: 3000, to: 600, q: 3, vol: 0.08, d: 0.12, crush: true, wet: 0.1 });
      } else if (kind === "pin") {
        // A small bell in a big dark room.
        tone(c, t, { wave: "triangle", f: note(20), vol: 0.045, d: 0.6, wet: 0.6 });
        tone(c, t + 0.004, { wave: "sine", f: note(20) * 2.76, vol: 0.014, d: 0.3, wet: 0.6 });
      } else {
        tone(c, t, { wave: "p25", f: note(12), to: note(14), glide: 2 * FRAME, steps: true, vol: 0.05, d: 0.07, wet: 0.2 });
        bubble(c, t, 640, 0.06);
      }
    });
  },

  /** Pins set on squares (they go with your move). */
  pinStage() {
    play("pinStage", 80, (c, t) => {
      [20, 22, 24].forEach((i, k) => {
        tone(c, t + k * 0.05, { wave: "triangle", f: note(i), vol: 0.03, d: 0.7, wet: 0.6 });
        tone(c, t + k * 0.05, { wave: "sine", f: note(i) * 2.76, vol: 0.009, d: 0.35, wet: 0.7 });
      });
    });
  },

  /**
   * LOCK IN — the one you hear most, so it gets the most care: a deep thump
   * into the water, a pixel chord that closes like it's sinking, a burst of
   * bubbles, and a glint far up in the reverb.
   */
  lockIn(kind = "place") {
    play("lockIn", 120, (c, t) => {
      if (kind === "pass") {
        tone(c, t, { wave: "p25", f: note(12), to: note(9), glide: 3 * FRAME, steps: true, vol: 0.06, d: 0.14, wet: 0.3 });
        fizz(c, t + 0.03, 3, 0.12, { lo: 400, hi: 800, vol: 0.05 });
        return;
      }
      thump(c, t, kind === "delete" ? { f: 120, to: 38, vol: 0.42, d: 0.26 } : { f: 160, to: 48, vol: 0.5, d: 0.24 });
      if (kind === "delete") {
        hiss(c, t, { f: 2600, to: 280, q: 1.6, vol: 0.16, d: 0.24, crush: true, wet: 0.2 });
        tone(c, t, { wave: "p12", f: note(12), to: note(2), glide: 8 * FRAME, steps: true, vol: 0.08, d: 0.2, wet: 0.25 });
      } else {
        // root, fifth, octave — the pixel stab, low-passed shut like sinking.
        [10, 13, 15].forEach((i) => tone(c, t, { wave: "p25", f: note(i), vol: 0.065, d: 0.32, wet: 0.3, lp: [5200, 500, 3] }));
        tone(c, t + 0.05, { wave: "triangle", f: note(25), vol: 0.035, d: 0.5, wet: 0.75 });
      }
      fizz(c, t + 0.015, 6, 0.16, { lo: 480, hi: 1500, vol: 0.075, spread: 0.6 });
    });
  },

  /* ---------- ZERO-G (the falling-block Sprint) ---------- */

  /** Left or right: a small tick, under water. */
  zgMove() {
    play("zgMove", 22, (c, t) => {
      tone(c, t, { wave: "sine", f: rand(1500, 1700), to: 900, glide: 0.02, vol: 0.022, a: 0.001, d: 0.03, wet: 0.15, lp: [2400, 1200, 1] });
    });
  },
  /** A turn: one small bubble. */
  zgRotate(dir = 1) {
    play("zgRotate", 25, (c, t) => bubble(c, t, dir === 2 ? rand(820, 900) : dir > 0 ? rand(700, 760) : rand(600, 660), 0.05, dir === 2 ? 0 : dir * 0.25, 0.35));
  },
  /** Hold: two bubbles. */
  zgHold() {
    play("zgHold", 50, (c, t) => { bubble(c, t, rand(520, 580), 0.045, -0.2, 0.35); bubble(c, t + 0.05, rand(760, 820), 0.04, 0.2, 0.35); });
  },
  /** Soft drop reaching the floor: a small muffled thump. */
  zgLand() {
    play("zgLand", 50, (c, t) => muffle(c, t, { vol: 0.18, f: 170 }));
  },
  /** Hard drop: the muffled thump, a little heavier, and a bubble. */
  zgDrop() {
    play("zgDrop", 20, (c, t) => { muffle(c, t, { vol: 0.3, f: 150 }); bubble(c, t + 0.03, rand(500, 700), 0.025, rand(-0.3, 0.3), 0.3); });
  },
  /**
   * A clear (or a spin). `combo` counts clears in a row from 0.
   *   1–3 lines  a low harp, bubbles, and the chip on A, a step higher in
   *              the scale for every clear in a row; from the second, the harp
   *              rolls from A up to that note, and at the top of the octave it
   *              runs fast from A to A.
   *   quad, spin double, spin triple (any piece)  their own sharp chip figures.
   *   The piano answers from far back.
   */
  zgClear({ lines = 0, spin = null, combo = 0, b2b = 0, allClear = false } = {}) { // every piece's spin sounds the same
    play("zgClear", 30, (c, t) => {
      // The combo is a scale: A, then one step higher for each clear in a row, peaking on the high A.
      const step = Math.max(0, Math.min(combo, COMBO_TOP));
      const note = za(step, A5);
      // The low harp, by lines.
      if (lines) [0, 4, 7].slice(0, Math.min(lines, 3)).forEach((d, i) => harp(c, t + i * 0.05, za(d, 45), { vol: 0.06, d: 1.8, pan: spread(i, 3) * 0.5 }));
      // The harp rolls up the scale from A to the combo note, and the chip lands on it as the roll arrives
      // (at the top: a fast run all the way from A to the high A).
      let land = t;
      if (lines && combo >= 1) land = harpRun(c, t + 0.02, 0, step, { base: A5, step: step >= COMBO_TOP ? 0.022 : 0.04, vol: 0.03, d: 1.1 }) - 0.02;
      if (spin) {
        // Every spin, any piece: small blips rising into the crisp stab.
        const big = lines >= 2;
        const pre = lines >= 3 ? [0, 2, 4] : lines === 2 ? [2, 4] : [4];
        pre.forEach((d, i) => chip(c, t + i * 0.055, za(d, A5), { vol: 0.024, d: 0.09, duty: "p12" }));
        const at = t + pre.length * 0.055;
        stab(c, at, { vol: big ? 0.04 : 0.03 });
        if (lines >= 3) for (let i = 0; i <= 7; i++) chip(c, at + 0.1 + i * 0.03, za(7 + i, A5), { vol: 0.014, d: 0.12, duty: "p12", pan: spread(i, 8) });
        if (big) harp(c, at, za(0, 33), { vol: 0.07, d: 2.4 });
        if (lines) chip(c, land, note, { vol: 0.026, d: 0.55 });
      } else if (lines >= 4) {
        // The quad: a fast staccato chip run straight up the scale to the high A.
        for (let i = 0; i <= 7; i++) chip(c, t + i * 0.035, za(i, A5), { vol: 0.026, d: i === 7 ? 0.6 : 0.08, duty: "p12", pan: spread(i, 8) * 0.6 });
        harp(c, t + 0.25, za(0, 33), { vol: 0.07, d: 2.2 });
      } else if (lines) {
        chip(c, land, note, { vol: 0.032, d: 0.55 });
      }
      if (lines) {
        fizz(c, t + 0.02, 2 + Math.min(lines, 4), 0.18, { lo: 450, hi: 1400, vol: 0.045 });
        // The piano, far back: a chord tone two octaves over the harp.
        piano(c, land + 0.02, za(step + 7, A5), { vol: 0.014 }); // the combo note again, an octave up
      }
      if (b2b > 0) chip(c, t + 0.12, za(14, A5), { vol: 0.012, d: 0.6, duty: "p12" });
      if (allClear) {
        const end = harpRun(c, t + 0.2, 0, 7, { step: 0.025, vol: 0.035, d: 1 });
        harpRun(c, end, 7, 14, { step: 0.025, vol: 0.035, d: 1.2 });
        [0, 4, 7, 11, 14].forEach((d, i) => piano(c, end + i * 0.08, za(d, 81), { vol: 0.016 }));
        fizz(c, end, 12, 0.8, { lo: 500, hi: 1800, vol: 0.04, spread: 0.8 });
      }
    });
  },
  /**
   * A big combo has ended (`n` clears in a row): a short melody, 3 to 5
   * notes by size, on the chip with the piano doubling it from far back.
   */
  zgComboEnd(n) {
    play("zgComboEnd", 200, (c, t) => {
      const tunes = [[4, 7, 9], [7, 4, 9], [2, 4, 7, 9], [4, 2, 7, 11], [0, 4, 7, 9, 14], [7, 9, 11, 9, 14]];
      const len = n >= 10 ? 5 : n >= 7 ? 4 : 3;
      const pick = tunes.filter((m) => m.length === len);
      const tune = pick[Math.floor(Math.random() * pick.length)];
      harp(c, t, za(0, 45), { vol: 0.06, d: 2.4 });
      harp(c, t + 0.05, za(4, 45), { vol: 0.045, d: 2.2 });
      tune.forEach((d, i) => {
        const last = i === tune.length - 1;
        chip(c, t + 0.08 + i * 0.14, za(d, A5), { vol: 0.03, d: last ? 0.9 : 0.16 });
        piano(c, t + 0.08 + i * 0.14, za(d, 69), { vol: 0.02, d: last ? 3.5 : 2 });
      });
      fizz(c, t + 0.1, 6, 0.6, { lo: 500, hi: 1500, vol: 0.035, spread: 0.7 });
    });
  },
  /** Forty lines: the harp runs A to A twice, the chip and the piano finish on A. */
  zgFinish() {
    play("zgFinish", 200, (c, t) => {
      const mid = harpRun(c, t, 0, 7, { step: 0.03, vol: 0.04 });
      const end = harpRun(c, mid, 7, 14, { step: 0.03, vol: 0.04 });
      [0, 4, 7, 14].forEach((d, i) => chip(c, end + i * 0.1, za(d, A5), { vol: 0.03, d: i === 3 ? 1 : 0.15 }));
      piano(c, end + 0.3, za(14, 69), { vol: 0.024, d: 4 });
      fizz(c, end, 10, 0.8, { lo: 500, hi: 1600, vol: 0.04, spread: 0.8 });
    });
  },
  /** Topped out: the chip sinking down the minor scale, slowly, under water. */
  zgTopOut() {
    play("zgTopOut", 200, (c, t) => {
      [7, 5, 3, 2, 0].forEach((d, i) => chip(c, t + i * 0.16, A5 + 12 * Math.floor(d / 7) + ZG_MINOR[d % 7], { vol: 0.03, d: 0.4 }));
      harp(c, t + 0.8, 45, { vol: 0.07, d: 2.5 });
      muffle(c, t, { vol: 0.3, f: 110 });
    });
  },
  /** Danger: the stab two octaves down, fading in softly, every 2 seconds while your stack is near the top. */
  zgAlarm() {
    play("zgAlarm", 1000, (c, t) => {
      stab(c, t, { vol: 0.04, base: A3 - 12, a: 0.06 });
      tone(c, t, { wave: "sine", f: mtof(33), vol: 0.06, a: 0.07, d: 0.35, wet: 0.2 });
    });
  },
  /** A sample of the key, when MINOR KEY is switched. */
  zgKeyPreview() {
    play("zgKeyPreview", 200, (c, t) => {
      const end = harpRun(c, t, 0, 4, { step: 0.05, vol: 0.04 });
      chip(c, end, za(4, A5), { vol: 0.03, d: 0.6 });
      piano(c, end + 0.05, za(2, 81), { vol: 0.016 });
    });
  },

  /** Your opponent has locked in: a soft double blip, far off. */
  oppReady() {
    play("oppReady", 200, (c, t) => {
      tone(c, t, { wave: "p12", f: note(19), vol: 0.06, d: 0.05, wet: 0.5, pan: 0.35 });
      tone(c, t + 0.07, { wave: "p12", f: note(22), vol: 0.06, d: 0.08, wet: 0.5, pan: 0.35 });
    });
  },

  /**
   * The turn resolving. Plays as a little sequence:
   *   land      the moves splash down (yours left, theirs right)
   *   contested clashing squares pop
   *   deleted   crunches
   *   pinned    a bell
   *   lines     a cleared line sweeps upward — more lines, higher and longer
   *   shrink    the board closing in: a sonar alarm and a deep rumble
   */
  reveal({ placed = 0, contested = 0, deleted = 0, pinned = 0, lines = 0, shrink = null } = {}) {
    play("reveal", 200, (c, t) => {
      if (placed) {
        thump(c, t, { f: 120, to: 50, vol: 0.28, d: 0.18 });
        fizz(c, t + 0.01, 2 + 2 * placed, 0.14, { lo: 420, hi: 1200, vol: 0.06, spread: 0.7 });
      }
      let at = t + 0.12;
      for (let i = 0; i < Math.min(5, contested); i++) {
        const tt = at + i * 0.055;
        hiss(c, tt, { type: "highpass", f: 2400, q: 0.7, vol: 0.06, d: 0.03, wet: 0.1 });
        bubble(c, tt, rand(1300, 1900), 0.08, rand(-0.4, 0.4));
      }
      if (contested) at += 0.06 * Math.min(5, contested);
      if (deleted) {
        hiss(c, at, { f: 2200, to: 260, q: 1.4, vol: 0.12, d: 0.22, crush: true, wet: 0.2 });
        tone(c, at, { wave: "p12", f: note(9), to: note(1), glide: 6 * FRAME, steps: true, vol: 0.05, d: 0.16, wet: 0.2 });
        at += 0.08;
      }
      if (pinned) {
        tone(c, at, { wave: "triangle", f: note(22), vol: 0.06, d: 0.8, wet: 0.7 });
        tone(c, at, { wave: "sine", f: note(22) * 2.76, vol: 0.016, d: 0.4, wet: 0.7 });
        at += 0.05;
      }
      if (lines) {
        const n = Math.min(4, lines);
        // A sweep up the scale in console frames, a rush of water behind it,
        // then a chord ringing out into space.
        const len = 6 + 3 * n;
        for (let i = 0; i < len; i++) {
          tone(c, at + i * 2 * FRAME, { wave: i % 2 ? "p12" : "p25", f: note(10 + i + n), vol: 0.06, d: 0.09, wet: 0.35, pan: (i / len - 0.5) * 0.8 });
        }
        hiss(c, at, { f: 400, to: 5000, q: 1, vol: 0.08, d: len * 2 * FRAME + 0.1, wet: 0.3 });
        const top = at + len * 2 * FRAME;
        [15, 17, 20, 22].slice(0, 2 + Math.min(2, n)).forEach((i, k) =>
          tone(c, top + k * 0.01, { wave: "triangle", f: note(i + n), vol: 0.07, hold: 0.04, d: 1.1, wet: 0.7, vib: 0.006 }));
        fizz(c, top, 6 + 3 * n, 0.4, { lo: 700, hi: 2200, vol: 0.06, spread: 0.8 });
        thump(c, at, { f: 90, to: 40, vol: 0.3, d: 0.3 });
        at = top + 0.1;
      }
      if (shrink) {
        // The walls closing in.
        const s = Math.max(at, t + 0.3);
        tone(c, s, { wave: "sine", f: note(15), vol: 0.12, d: 1.2, wet: 0.8 });
        tone(c, s + 0.35, { wave: "sine", f: note(15), vol: 0.06, d: 1.0, wet: 0.8 });
        tone(c, s, { wave: "p25", f: note(5), to: note(0), glide: 0.6, vol: 0.08, d: 0.9, wet: 0.3, lp: [2000, 300, 2] });
        hiss(c, s, { type: "lowpass", f: 300, to: 90, q: 0.8, vol: 0.18, a: 0.1, d: 1.0, wet: 0.2 });
        if (shrink === "OVERTIME") arp(c, s + 0.05, [note(12), note(16), note(12), note(16)], { wave: "p12", step: 0.12, vol: 0.05, d: 0.1 });
      }
    });
  },

  /** Your move again: a gentle sonar ping. */
  yourTurn() {
    play("yourTurn", 300, (c, t) => {
      tone(c, t, { wave: "sine", f: note(20), vol: 0.05, d: 0.35, wet: 0.7 });
      tone(c, t, { wave: "p12", f: note(20), vol: 0.012, d: 0.05, wet: 0.3 });
    });
  },

  /** The last seconds on the clock. */
  tick(secs) {
    play("tick", 300, (c, t) => {
      const hi = secs <= 3;
      tone(c, t, { wave: "p12", f: hi ? note(22) : note(17), vol: hi ? 0.08 : 0.06, d: 0.04, wet: 0.2 });
      bubble(c, t, hi ? 1500 : 1100, 0.035);
    });
  },

  /** Marathon: a new level — a rising run, a chord, a rush of bubbles. */
  levelUp() {
    play("levelUp", 800, (c, t) => {
      [10, 12, 13, 15, 17, 20].forEach((i, k) => tone(c, t + k * 0.06, { wave: "p25", f: note(i), vol: 0.06, d: 0.16, wet: 0.35, pan: (k / 5 - 0.5) * 0.6 }));
      [15, 17, 20].forEach((i, k) => tone(c, t + 0.38 + k * 0.012, { wave: "triangle", f: note(i), vol: 0.06, hold: 0.15, d: 1.1, wet: 0.7, vib: 0.006 }));
      fizz(c, t + 0.38, 12, 0.8, { lo: 700, hi: 2200, vol: 0.05, spread: 0.8 });
    });
  },

  /** A chat line from your opponent: two soft bubbles. */
  chat() {
    play("chat", 250, (c, t) => {
      bubble(c, t, 900, 0.06, 0.3);
      bubble(c, t + 0.07, 1250, 0.05, 0.3);
    });
  },

  /** An opponent found: three pings rising out of the deep, then a chord. */
  matchFound() {
    play("matchFound", 500, (c, t) => {
      [12, 15, 17].forEach((i, k) => tone(c, t + k * 0.12, { wave: "sine", f: note(i + 5), vol: 0.1, d: 0.5, wet: 0.6 }));
      [10, 12, 15, 19].forEach((i) => tone(c, t + 0.38, { wave: "p25", f: note(i), vol: 0.04, hold: 0.05, d: 0.7, wet: 0.5, lp: [4000, 900, 2] }));
      fizz(c, t + 0.38, 8, 0.4, { lo: 600, hi: 1800, vol: 0.05, spread: 0.8 });
    });
  },

  /** A match is found: a sonar ping, and its echo coming back off the deep. */
  sonar() {
    play("sonar", 900, (c, t) => {
      tone(c, t, { wave: "sine", f: 1320, to: 1250, glide: 0.4, vol: 0.2, a: 0.004, d: 1.4, wet: 0.85 });
      tone(c, t, { wave: "sine", f: 2640, vol: 0.04, a: 0.004, d: 0.5, wet: 0.7 });
      tone(c, t + 0.55, { wave: "sine", f: 1320, to: 1260, glide: 0.4, vol: 0.06, a: 0.01, d: 1.1, wet: 0.95 });
      fizz(c, t + 0.1, 5, 0.5, { lo: 500, hi: 1300, vol: 0.03, spread: 0.9 });
    });
  },

  /** The tide washing over the screen. */
  wipe() {
    play("wipe", 800, (c, t) => {
      hiss(c, t, { f: 220, to: 2600, q: 0.9, vol: 0.12, a: 0.5, hold: 0.2, d: 1.3, wet: 0.4 });
      hiss(c, t + 0.1, { type: "lowpass", f: 180, to: 90, q: 0.5, vol: 0.14, a: 0.6, d: 1.2, wet: 0.2 });
      fizz(c, t + 0.25, 16, 1.4, { lo: 350, hi: 1700, vol: 0.05, spread: 0.9 });
    });
  },

  /** Victory: a pixel fanfare climbing out of the water into space. */
  win() {
    play("end", 1000, (c, t) => {
      const run = [10, 12, 13, 15, 17, 18, 20];
      run.forEach((i, k) => tone(c, t + k * 0.075, { wave: "p25", f: note(i), vol: 0.07, d: 0.18, wet: 0.35, pan: (k / run.length - 0.5) * 0.6 }));
      const top = t + run.length * 0.075;
      [15, 17, 20, 22].forEach((i, k) => {
        tone(c, top + k * 0.015, { wave: "triangle", f: note(i), vol: 0.075, hold: 0.25, d: 1.6, wet: 0.7, vib: 0.007 });
        tone(c, top + k * 0.015, { wave: "p12", f: note(i), vol: 0.02, hold: 0.1, d: 0.6, wet: 0.5 });
      });
      thump(c, top, { f: 110, to: 44, vol: 0.35, d: 0.4 });
      fizz(c, top, 18, 1.4, { lo: 700, hi: 2600, vol: 0.05, spread: 0.9 });
      tone(c, top + 0.3, { wave: "sine", f: note(27), vol: 0.03, d: 1.4, wet: 0.9 });
    });
  },

  /** Defeat: sinking — notes falling, the water closing over them. */
  lose() {
    play("end", 1000, (c, t) => {
      [17, 15, 12, 10, 7].forEach((i, k) =>
        tone(c, t + k * 0.16, { wave: "triangle", f: note(i), vol: 0.13, d: 0.5, wet: 0.55, lp: [3000 - k * 500, 400, 1] }));
      tone(c, t + 0.8, { wave: "p25", f: note(5), to: note(0), glide: 1.0, vol: 0.08, d: 1.3, wet: 0.5, lp: [1200, 200, 2] });
      hiss(c, t + 0.6, { type: "lowpass", f: 600, to: 120, q: 0.6, vol: 0.08, a: 0.3, d: 1.4, wet: 0.3 });
      fizz(c, t + 0.4, 7, 1.6, { lo: 250, hi: 700, vol: 0.05, spread: 0.6 });
    });
  },

  /** A draw: a suspended chord that never resolves. */
  draw() {
    play("end", 1000, (c, t) => {
      [10, 13, 16].forEach((i, k) => tone(c, t + k * 0.12, { wave: "p25", f: note(i), vol: 0.06, d: 0.3, wet: 0.4 }));
      [11, 13, 16].forEach((i) => tone(c, t + 0.4, { wave: "triangle", f: note(i), vol: 0.06, hold: 0.2, d: 1.3, wet: 0.7, vib: 0.005 }));
      fizz(c, t + 0.4, 8, 1, { lo: 500, hi: 1400, vol: 0.045 });
    });
  },

  /** Giving up: a falling buzz and a heavy splash. */
  forfeit() {
    play("forfeit", 500, (c, t) => {
      tone(c, t, { wave: "p25", f: note(15), to: note(0), glide: 0.4, steps: true, vol: 0.05, d: 0.45, wet: 0.3 });
      thump(c, t + 0.3, { f: 130, to: 36, vol: 0.26, d: 0.35 });
      fizz(c, t + 0.32, 8, 0.4, { lo: 300, hi: 900, vol: 0.06 });
    });
  },

  /** Something went wrong (a server error, a bad code). */
  error() {
    play("error", 300, (c, t) => {
      tone(c, t, { wave: "p25", f: note(7), vol: 0.06, d: 0.08, wet: 0.2, lp: [2000, 600, 1] });
      tone(c, t + 0.09, { wave: "p25", f: note(6) * 0.94, vol: 0.06, d: 0.16, wet: 0.2, lp: [2000, 500, 1] });
    });
  },
};

/**
 * App-wide: the first tap starts audio, every button taps, and buttons
 * tick under the mouse. Call once.
 */
let installed = false;
export function installUiSounds() {
  if (installed || typeof document === "undefined") return;
  installed = true;
  const isButton = (el) => el && el.closest && el.closest("button, [role=button], a[href], summary, select");
  document.addEventListener("pointerdown", (e) => {
    unlock();
    const b = isButton(e.target);
    if (!b || b.disabled || b.getAttribute("aria-disabled") === "true" || b.dataset.sfx === "none") return;
    if (b.getAttribute("role") === "switch") sfx.toggle(b.getAttribute("aria-checked") !== "true");
    else if (/^(back|close|menu|cancel)$/i.test((b.getAttribute("aria-label") || b.textContent || "").trim())) sfx.back();
    else sfx.tap();
  }, true);
  document.addEventListener("keydown", unlock, true);
  let hovered = null;
  document.addEventListener("pointerover", (e) => {
    if (e.pointerType !== "mouse") return;
    const b = isButton(e.target);
    if (b === hovered) return;
    hovered = b;
    if (b && !b.disabled && b.dataset.sfx !== "none") sfx.hover();
  }, true);
}
