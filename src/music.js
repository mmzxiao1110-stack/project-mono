/**
 * Music — four pieces, composed for Tesella and played live by a small
 * synth band in Web Audio. No audio files.
 *
 *   TIDE POOL      the menu. Slow and dreamy: glass bells, a warm pad,
 *                  a music-box tune. D major with a lydian lift.
 *   KELP LATTICE   in game. Bouncy and adventurous: an 8-bit bass that
 *                  jumps octaves, a pulse-wave lead. A minor.
 *   DEEP SIGNAL    in game. Spacious and wistful: half-time drums, sonar
 *                  pings, a soft flute-like lead. F# minor.
 *   STARFALL REEF  in game. Bright and driving: fast arpeggios, a steady
 *                  beat, a lead doubled an octave up. E major.
 *
 * Each piece is 32 bars (four 8-bar sections, the first one without its
 * tune) and loops; each pass through adds or trades a layer so the loop
 * doesn't wear thin. Overtime (`setIntensity(1)`) opens the filter and
 * brings the drums in harder.
 */
import { core, onAudioReady } from "./sfx.js";

/* ------------------------------------------------------------------
   Notes
   ------------------------------------------------------------------ */
const PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
/** "F#4" → 66 (MIDI). */
function midi(name) {
  const m = /^([A-G])([#b]?)(-?\d)$/.exec(name);
  if (!m) throw new Error(`bad note ${name}`);
  return 12 * (Number(m[3]) + 1) + PC[m[1]] + (m[2] === "#" ? 1 : m[2] === "b" ? -1 : 0);
}
const hz = (m) => 440 * Math.pow(2, (m - 69) / 12);
const chord = (s) => s.split(" ").map(midi);

/**
 * A tune, one token per eighth note, bars split by "|":
 *   F#5  a note   -  hold the one before   .  rest
 * Returns, per bar, [stepIn16ths, midi, lengthIn16ths].
 */
function tune(src) {
  return src.split("|").map((bar) => {
    const toks = bar.trim().split(/\s+/);
    const out = [];
    toks.forEach((tk, i) => {
      if (tk === "-") { if (out.length && out[out.length - 1].open) out[out.length - 1][2] += 2; return; }
      if (out.length) out[out.length - 1].open = false;
      if (tk === ".") return;
      const ev = [i * 2, midi(tk), 2];
      ev.open = true;
      out.push(ev);
    });
    return out.map(([s, n, l]) => [s, n, l]);
  });
}

/* ------------------------------------------------------------------
   The band
   ------------------------------------------------------------------ */
let A = null;          // the audio core
let bus = null;        // music in → filter → volume → mixer
let busFilter = null;
let busVol = null;
let echo = null;       // tempo-synced echo
let verbSend = null;
let volume = 0.5;
let intensity = 0;

const curve = (v) => (v <= 0 ? 0 : Math.pow(v, 1.7) * 0.55);

function build() {
  if (bus) return true;
  A = core();
  if (!A) return false;
  const c = A.ctx;
  bus = c.createGain();
  busFilter = c.createBiquadFilter();
  busFilter.type = "lowpass";
  busFilter.frequency.value = 5200;
  busFilter.Q.value = 0.5;
  busVol = c.createGain();
  busVol.gain.value = 0;
  bus.connect(busFilter); busFilter.connect(busVol); busVol.connect(A.mix);

  // Space: an echo on the beat and a long reverb, both inside the music volume.
  verbSend = c.createGain();
  const verb = A.makeReverb(c, 4.2);
  const wet = c.createGain();
  wet.gain.value = 0.55;
  verbSend.connect(verb); verb.connect(wet); wet.connect(busFilter);

  echo = c.createDelay(2);
  const fb = c.createGain();
  fb.gain.value = 0.34;
  const ef = c.createBiquadFilter();
  ef.type = "lowpass";
  ef.frequency.value = 2400;
  echo.connect(ef); ef.connect(fb); fb.connect(echo);
  const echoOut = c.createGain();
  echoOut.gain.value = 0.3;
  ef.connect(echoOut); echoOut.connect(busFilter); ef.connect(verbSend);
  echo.input = c.createGain();
  echo.input.connect(echo);
  return true;
}

/** Send a voice out: dry, plus some into the reverb and the echo. */
function out(node, { verb = 0.3, dly = 0, pan = 0 } = {}) {
  const c = A.ctx;
  let head = node;
  if (pan && c.createStereoPanner) {
    const p = c.createStereoPanner();
    p.pan.value = pan;
    node.connect(p);
    head = p;
  }
  head.connect(bus);
  if (verb) { const g = c.createGain(); g.gain.value = verb; head.connect(g); g.connect(verbSend); }
  if (dly) { const g = c.createGain(); g.gain.value = dly; head.connect(g); g.connect(echo.input); }
}

function osc(wave, f, t) {
  const o = A.ctx.createOscillator();
  if (wave === "p12") o.setPeriodicWave(A.pulse12);
  else if (wave === "p25") o.setPeriodicWave(A.pulse25);
  else o.type = wave;
  o.frequency.setValueAtTime(f, t);
  return o;
}

/** An envelope: attack, hold, release. Returns the gain node. */
function env(t, vol, a, hold, r) {
  const g = A.ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(vol, t + a);
  g.gain.setValueAtTime(vol, t + a + hold);
  g.gain.exponentialRampToValueAtTime(0.0001, t + a + hold + r);
  return g;
}

const I = {
  /** A warm pad: two soft waves a few cents apart under a slow filter. */
  pad(t, notes, dur, { vol = 0.022, cut = 1400 } = {}) {
    const c = A.ctx;
    const f = c.createBiquadFilter();
    f.type = "lowpass";
    f.frequency.setValueAtTime(cut * 0.6, t);
    f.frequency.linearRampToValueAtTime(cut, t + dur * 0.5);
    f.frequency.linearRampToValueAtTime(cut * 0.7, t + dur + 1);
    f.Q.value = 0.7;
    const g = env(t, 1, Math.min(0.9, dur * 0.4), Math.max(0, dur - 0.9), 1.4);
    f.connect(g);
    out(g, { verb: 0.55 });
    for (const n of notes) {
      for (const [wave, det, v] of [["triangle", -7, 1], ["sawtooth", 7, 0.35]]) {
        const o = osc(wave, hz(n), t);
        o.detune.value = det;
        const og = c.createGain();
        og.gain.value = vol * v;
        o.connect(og); og.connect(f);
        o.start(t); o.stop(t + dur + 2.6);
      }
    }
  },

  /** Glass bell: a sine and its bell partial, ringing into the echo. */
  bell(t, n, { vol = 0.05, d = 1.1, pan = 0, dly = 0.35 } = {}) {
    const g = env(t, vol, 0.004, 0, d);
    const g2 = env(t, vol * 0.22, 0.002, 0, d * 0.4);
    const o = osc("sine", hz(n), t), o2 = osc("sine", hz(n) * 2.76, t);
    o.connect(g); o2.connect(g2);
    out(g, { verb: 0.45, dly, pan }); out(g2, { verb: 0.45, dly, pan });
    o.start(t); o.stop(t + d + 0.1); o2.start(t); o2.stop(t + d + 0.1);
  },

  /** A pixel pluck: a pulse wave with a filter snapping shut. */
  pluck(t, n, { wave = "p12", vol = 0.03, d = 0.16, pan = 0, dly = 0.2, cut = 3200 } = {}) {
    const f = A.ctx.createBiquadFilter();
    f.type = "lowpass";
    f.Q.value = 3;
    f.frequency.setValueAtTime(cut, t);
    f.frequency.exponentialRampToValueAtTime(400, t + d);
    const g = env(t, vol, 0.002, 0, d);
    const o = osc(wave, hz(n), t);
    o.connect(f); f.connect(g);
    out(g, { verb: 0.25, dly, pan });
    o.start(t); o.stop(t + d + 0.05);
  },

  /** Bass. Triangle is the old-console bass; sine is a deep sub. */
  bass(t, n, dur, { wave = "triangle", vol = 0.13, r = 0.08, cut = 0 } = {}) {
    const g = env(t, vol, 0.006, Math.max(0, dur - 0.02), r);
    const o = osc(wave, hz(n), t);
    if (cut) {
      const f = A.ctx.createBiquadFilter();
      f.type = "lowpass"; f.frequency.value = cut; f.Q.value = 2;
      o.connect(f); f.connect(g);
    } else o.connect(g);
    out(g, { verb: 0.05 });
    o.start(t); o.stop(t + dur + r + 0.05);
  },

  /** A singing lead: vibrato that grows in, a little slide into each note. */
  lead(t, n, dur, { wave = "p25", vol = 0.045, cut = 3600, vib = 0.012, dly = 0.3, verb = 0.35, pan = 0, slide = true } = {}) {
    const c = A.ctx;
    const f0 = hz(n);
    const o = osc(wave, slide ? f0 * 0.985 : f0, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(f0, t + 0.05);
    const l = c.createOscillator(), lg = c.createGain();
    l.frequency.value = 5.2;
    lg.gain.setValueAtTime(0, t);
    lg.gain.linearRampToValueAtTime(f0 * vib, t + Math.min(dur, 0.45));
    l.connect(lg); lg.connect(o.frequency);
    const f = c.createBiquadFilter();
    f.type = "lowpass"; f.frequency.value = cut; f.Q.value = 0.8;
    const g = env(t, vol, 0.012, Math.max(0, dur - 0.04), 0.16);
    o.connect(f); f.connect(g);
    out(g, { verb, dly, pan });
    o.start(t); o.stop(t + dur + 0.25); l.start(t); l.stop(t + dur + 0.25);
  },

  kick(t, vol = 0.22) {
    const g = env(t, vol, 0.002, 0, 0.2);
    const o = osc("sine", 130, t);
    o.frequency.exponentialRampToValueAtTime(42, t + 0.14);
    o.connect(g); out(g, { verb: 0.04 });
    o.start(t); o.stop(t + 0.25);
  },

  snare(t, vol = 0.07) {
    const c = A.ctx;
    const src = c.createBufferSource();
    src.buffer = A.noiseBuf;
    const f = c.createBiquadFilter();
    f.type = "bandpass"; f.frequency.value = 1900; f.Q.value = 0.9;
    const g = env(t, vol, 0.002, 0, 0.14);
    src.connect(f); f.connect(g); out(g, { verb: 0.35 });
    src.start(t, Math.random() * 0.5); src.stop(t + 0.2);
    const o = osc("triangle", 190, t);
    o.frequency.exponentialRampToValueAtTime(120, t + 0.06);
    const g2 = env(t, vol * 0.8, 0.002, 0, 0.07);
    o.connect(g2); out(g2, { verb: 0.2 });
    o.start(t); o.stop(t + 0.1);
  },

  hat(t, vol = 0.018, open = false, pan = 0) {
    const c = A.ctx;
    const src = c.createBufferSource();
    src.buffer = A.noiseBuf;
    const f = c.createBiquadFilter();
    f.type = "highpass"; f.frequency.value = 7200;
    const g = env(t, vol, 0.001, 0, open ? 0.14 : 0.035);
    src.connect(f); f.connect(g); out(g, { verb: 0.15, pan });
    src.start(t, Math.random() * 0.5); src.stop(t + 0.2);
  },

  /** Percussion from the water: a single bubble. */
  bubble(t, f = 800, vol = 0.03, pan = 0) {
    const len = 0.05 + Math.random() * 0.03;
    const o = osc("sine", f, t);
    o.frequency.exponentialRampToValueAtTime(f * 2.6, t + len);
    const g = env(t, vol, 0.002, 0, len + 0.02);
    o.connect(g); out(g, { verb: 0.4, dly: 0.2, pan });
    o.start(t); o.stop(t + len + 0.05);
  },

  /** A sonar ping far out in the dark. */
  sonar(t, n, vol = 0.035) {
    const g = env(t, vol, 0.01, 0.05, 2.4);
    const o = osc("sine", hz(n), t);
    o.connect(g); out(g, { verb: 0.9, dly: 0.6, pan: Math.random() * 0.8 - 0.4 });
    o.start(t); o.stop(t + 2.6);
  },
};

/** Arpeggio note `i` of a chord: walks up its tones, then the next octave. */
const arpNote = (ch, i) => ch[i % ch.length] + 12 * Math.floor(i / ch.length);
const rnd = (a, b) => a + Math.random() * (b - a);
const pick = (xs) => xs[Math.floor(Math.random() * xs.length)];

/* ------------------------------------------------------------------
   The pieces. Each `play(x)` is called once per sixteenth note with:
     bar (within the 32), s (0–15), pass (times looped), t (start time),
     st (one sixteenth, seconds), sec (section index 0–3)
   ------------------------------------------------------------------ */

const TIDE_POOL = (() => {
  const A1 = ["D3 A3 C#4 E4 F#4", "B2 F#3 A3 C#4 D4", "G2 D3 F#3 B3 C#4", "A2 E3 B3 C#4 F#4",
              "D3 A3 C#4 E4 F#4", "F#2 C#3 E3 A3 C#4", "G2 D3 F#3 B3 C#4", "A2 E3 A3 C#4 E4"].map(chord);
  const B1 = ["E2 B2 D3 F#3 G3", "G2 D3 F#3 A3 B3", "F#2 A3 D4 F#4", "B2 F#3 A3 C#4 D4",
              "E2 B2 D3 F#3 G3", "G2 D3 F#3 A3 B3", "A2 E3 B3 D4", "A2 E3 A3 C#4 E4"].map(chord);
  const tA = tune(`F#5 - E5 - A5 - - - | F#5 - E5 - D5 - - - | B4 - C#5 - D5 - E5 - | C#5 - - - B4 - A4 - |
                   F#5 - E5 - A5 - - B5 | C#6 - - - A5 - - - | B5 - A5 - F#5 - E5 - | E5 - - - - - . .`);
  const tB = tune(`G5 - F#5 - E5 - B4 - | D5 - - - E5 - F#5 - | A5 - - - F#5 - D5 - | E5 - - - C#5 - D5 - |
                   B5 - A5 - G5 - E5 - | F#5 - - - D5 - B4 - | E5 - - - F#5 - G5 - | E5 - - - C#5 - - - `);
  const form = ["A", "A", "B", "A"];
  const ARP = [0, 2, 1, 3, 2, 4, 3, 5];
  return {
    title: "TIDE POOL", bpm: 76,
    play({ bar, s, pass, t, st, sec }) {
      const sect = form[sec], b = bar % 8;
      const ch = (sect === "A" ? A1 : B1)[b];
      const barLen = 16 * st;
      if (s === 0) {
        I.pad(t, ch.slice(1), barLen, { vol: 0.02, cut: 1300 });
        I.bass(t, ch[0] - 12, barLen * 0.5, { wave: "sine", vol: 0.12, r: 0.6 });
      }
      if (s === 8) I.bass(t, ch[0] - 12 + 7, barLen * 0.4, { wave: "sine", vol: 0.07, r: 0.6 });
      // Glass bells, every eighth; sixteenths join on later passes.
      const sixteenths = sec >= 2 || pass % 2 === 1;
      if (s % 2 === 0 || (sixteenths && s % 4 === 3)) {
        const i = ARP[(s >> 1) % 8];
        I.bell(t, arpNote(ch.slice(1), i) + 12, { vol: s % 4 === 0 ? 0.035 : 0.025, d: 1.0, pan: (s / 16 - 0.5) * 0.7 });
      }
      // The tune: a music box (bells an octave up, a soft lead under it on the last section).
      if (sec > 0) {
        for (const [at, n, len] of (sect === "A" ? tA : tB)[b]) {
          if (at !== s) continue;
          const up = sec === 3 && pass % 2 === 1 ? 12 : 0;
          I.bell(t, n + up, { vol: 0.07, d: 1.6 + len * st, dly: 0.4 });
          if (sec === 3) I.lead(t, n - 12, len * st, { wave: "triangle", vol: 0.03, cut: 2200, vib: 0.008, dly: 0.2 });
        }
      }
      // Bubbles drifting up, now and then.
      if (s % 4 === 2 && Math.random() < 0.18) I.bubble(t, rnd(500, 1300), 0.022, rnd(-0.6, 0.6));
      if (bar % 4 === 3 && s === 12) I.sonar(t, pick([86, 88, 93]), 0.02);
    },
  };
})();

const KELP_LATTICE = (() => {
  const cA = ["A3 C4 E4", "F3 A3 C4", "C4 E4 G4", "G3 B3 D4", "A3 C4 E4", "F3 A3 C4", "G3 B3 D4", "E3 G#3 B3"].map(chord);
  const cB = ["D3 F3 A3", "F3 A3 C4", "C4 E4 G4", "G3 B3 D4", "D3 F3 A3", "F3 A3 C4", "E3 G#3 B3", "E3 G#3 B3"].map(chord);
  const roots = { A: [45, 41, 48, 43, 45, 41, 43, 40], B: [38, 41, 48, 43, 38, 41, 40, 40] };
  const tA = tune(`A4 - C5 - E5 - D5 C5 | C5 - - A4 - - G4 A4 | G4 - E4 - G4 - C5 - | B4 - - - D5 - B4 - |
                   A4 - C5 - E5 - A5 G5 | F5 - E5 - C5 - A4 - | B4 - D5 - G5 - F5 D5 | E5 - - - G#4 - B4 - `);
  const tB = tune(`D5 - F5 - A5 - - - | G5 - F5 - E5 - C5 - | E5 - - D5 C5 - G4 - | B4 - C5 - D5 - - - |
                   F5 - E5 - D5 - A4 - | C5 - A4 - C5 - F5 - | E5 - - - D5 - B4 - | G#4 - - - - - . . `);
  const form = ["A", "A", "B", "A"];
  // Bass: root and octave, bouncing, with the fifth before the turn.
  const BASS = [[0, 0], [2, 12], [4, 0], [6, 12], [8, 0], [10, 12], [12, 7], [14, 12]];
  const ARP = [0, 1, 2, 3, 2, 1, 2, 3];
  return {
    title: "KELP LATTICE", bpm: 104,
    play({ bar, s, pass, t, st, sec }) {
      const sect = form[sec], b = bar % 8;
      const ch = (sect === "A" ? cA : cB)[b];
      const root = roots[sect][b];
      if (s === 0) I.pad(t, ch, 16 * st, { vol: 0.013, cut: 1100 });
      const bs = BASS.find(([at]) => at === s);
      if (bs) I.bass(t, root + bs[1], st * 1.6, { wave: "triangle", vol: 0.12 });
      I.pluck(t, arpNote(ch, ARP[s % 8]) + 12, { wave: "p12", vol: s % 4 === 0 ? 0.022 : 0.014, d: 0.12, pan: s % 2 ? 0.3 : -0.3, dly: 0.12 });
      // Drums: in from the fifth bar.
      const drums = bar >= 4 || pass > 0;
      if (drums) {
        if (s === 0 || s === 8 || s === 10 || (intensity && s === 4)) I.kick(t, 0.2);
        if (s === 4 || s === 12) I.snare(t, 0.06);
        if (s % 2 === 0) I.hat(t, s % 4 === 2 ? 0.02 : 0.012);
        if (intensity && s % 2 === 1) I.hat(t, 0.008);
      }
      if (sec > 0) {
        for (const [at, n, len] of (sect === "A" ? tA : tB)[b]) {
          if (at !== s) continue;
          I.lead(t, n, len * st, { wave: "p25", vol: 0.04, cut: 3000 });
          // Last section on later passes: an echo of the tune an octave up.
          if (sec === 3 && pass % 2 === 1) I.lead(t, n + 12, len * st, { wave: "p12", vol: 0.014, cut: 4000, dly: 0.4 });
        }
      }
      if (s === 14 && Math.random() < 0.25) I.bubble(t, rnd(700, 1500), 0.022, rnd(-0.5, 0.5));
    },
  };
})();

const DEEP_SIGNAL = (() => {
  const cA = ["F#3 A3 C#4 E4 G#4", "D3 F#3 A3 C#4 F#4", "A3 C#4 E4 G#4", "E3 G#3 B3 F#4",
              "F#3 A3 C#4 E4 G#4", "D3 F#3 A3 C#4 F#4", "A3 C#4 E4 G#4", "E3 G#3 B3 F#4"].map(chord);
  const cB = ["B2 F#3 A3 C#4 D4", "D3 F#3 A3 C#4 F#4", "F#3 A3 C#4 E4 G#4", "E3 G#3 B3 C#4",
              "B2 F#3 A3 C#4 D4", "D3 F#3 A3 C#4 F#4", "F#3 A3 C#4 E4 G#4", "E3 G#3 B3 F#4"].map(chord);
  const roots = { A: [42, 38, 45, 40, 42, 38, 45, 40], B: [35, 38, 42, 40, 35, 38, 42, 40] };
  const tA = tune(`C#5 - - - E5 - G#5 - | F#5 - - - - - E5 - | C#5 - - - E5 - B4 - | G#4 - - - - - . . |
                   C#5 - - - E5 - A5 - | G#5 - - F#5 - - E5 - | E5 - C#5 - B4 - C#5 - | B4 - - - - - . . `);
  const tB = tune(`D5 - - - F#5 - A5 - | C#6 - - - A5 - F#5 - | G#5 - - - F#5 - C#5 - | E5 - - - - - . . |
                   D5 - F#5 - A5 - B5 - | C#6 - - - E6 - C#6 - | A5 - - G#5 F#5 - E5 - | F#5 - - - - - . . `);
  const form = ["A", "A", "B", "A"];
  const ARP = [0, 2, 4, 1, 3, 2, 4, 3];
  return {
    title: "DEEP SIGNAL", bpm: 88,
    play({ bar, s, pass, t, st, sec }) {
      const sect = form[sec], b = bar % 8;
      const ch = (sect === "A" ? cA : cB)[b];
      const root = roots[sect][b];
      if (s === 0) {
        I.pad(t, ch, 16 * st, { vol: 0.019, cut: 1500 });
        I.bass(t, root - 12, 10 * st, { wave: "sine", vol: 0.14, r: 0.5 });
      }
      if (s === 10) I.bass(t, root - 12, 5 * st, { wave: "sine", vol: 0.09, r: 0.4 });
      if (s === 6 || s === 14) I.pluck(t, root, { wave: "p25", vol: 0.03, d: 0.2, cut: 1600, dly: 0.3 });
      // Slow bells, deep in the echo.
      if (s % 2 === 0) I.bell(t, arpNote(ch, ARP[(s >> 1) % 8]) + 12, { vol: 0.022, d: 1.3, pan: (s / 16 - 0.5) * 0.9, dly: 0.45 });
      // Half-time drums from the second section; a shaker on later passes.
      if (sec > 0 || pass > 0) {
        if (s === 0 || (s === 11 && b % 2 === 1) || (intensity && s === 6)) I.kick(t, 0.2);
        if (s === 8) I.snare(t, 0.055);
        if (s % 4 === 2) I.hat(t, 0.014, s === 14);
        if ((pass > 0 || intensity) && s % 2 === 1) I.hat(t, 0.007, false, 0.4);
      }
      if (sec > 0) {
        for (const [at, n, len] of (sect === "A" ? tA : tB)[b]) {
          if (at !== s) continue;
          I.lead(t, n, len * st, { wave: "triangle", vol: 0.06, cut: 2600, vib: 0.01, dly: 0.35, verb: 0.5 });
          I.lead(t, n, len * st, { wave: "sine", vol: 0.03, cut: 5000, vib: 0.01, dly: 0, verb: 0.3, slide: false });
        }
      }
      if (b % 4 === 0 && s === 4) I.sonar(t, pick([78, 85, 90]), 0.03);
      if (s % 4 === 1 && Math.random() < 0.12) I.bubble(t, rnd(400, 1100), 0.02, rnd(-0.7, 0.7));
    },
  };
})();

const STARFALL_REEF = (() => {
  const cA = ["E3 G#3 B3 E4", "C#3 G#3 C#4 E4", "A3 C#4 E4", "F#3 B3 D#4 F#4",
              "E3 G#3 B3 E4", "G#3 B3 D#4", "A3 C#4 E4", "F#3 B3 D#4 F#4"].map(chord);
  const cB = ["A3 C#4 E4", "F#3 B3 D#4 F#4", "G#3 B3 D#4", "C#3 G#3 C#4 E4",
              "A3 C#4 E4", "F#3 B3 D#4 F#4", "E3 G#3 B3 E4", "E3 G#3 B3 E4"].map(chord);
  const roots = { A: [40, 37, 45, 47, 40, 44, 45, 47], B: [45, 47, 44, 37, 45, 47, 40, 40] };
  const tA = tune(`B4 - E5 - G#5 - F#5 E5 | F#5 - E5 - C#5 - - - | E5 - - C#5 E5 - F#5 - | D#5 - - - B4 - - - |
                   B4 - E5 - G#5 - B5 A5 | G#5 - F#5 - D#5 - B4 - | C#5 - E5 - A5 - G#5 - | F#5 - - - D#5 - F#5 - `);
  const tB = tune(`E5 - - - C#5 - E5 - | F#5 - - - D#5 - F#5 - | G#5 - B5 - G#5 - F#5 - | E5 - - - C#5 - - - |
                   A5 - G#5 - F#5 - E5 - | F#5 - G#5 - A5 - B5 - | G#5 - - - E5 - B4 - | E5 - - - . . . . `);
  const form = ["A", "A", "B", "A"];
  const ARP = [0, 1, 2, 3, 4, 3, 2, 1];
  return {
    title: "STARFALL REEF", bpm: 116,
    play({ bar, s, pass, t, st, sec }) {
      const sect = form[sec], b = bar % 8;
      const ch = (sect === "A" ? cA : cB)[b];
      const root = roots[sect][b];
      if (s === 0) I.pad(t, ch, 16 * st, { vol: 0.012, cut: 1800 });
      // Driving eighths: root, octave on the off-beats.
      if (s % 2 === 0) I.bass(t, root + (s % 4 === 2 ? 12 : 0) - 12, st * 1.5, { wave: "p25", vol: 0.07, cut: 900 });
      if (s % 4 === 0) I.bass(t, root - 12, st * 1.2, { wave: "triangle", vol: 0.08 });
      I.pluck(t, arpNote(ch, ARP[s % 8]) + 12, { wave: s % 2 ? "p12" : "p25", vol: 0.018, d: 0.1, pan: Math.sin(s / 2.5) * 0.5, dly: 0.15, cut: 4200 });
      const drums = bar >= 2 || pass > 0;
      if (drums) {
        if (s % 4 === 0) I.kick(t, s === 0 ? 0.21 : 0.16);
        if (s === 4 || s === 12) I.snare(t, 0.065);
        I.hat(t, s % 4 === 2 ? 0.02 : 0.01, s === 14 && b % 2 === 1, s % 2 ? 0.25 : -0.25);
        if (intensity && s === 15) I.snare(t, 0.03);
      }
      if (sec > 0) {
        for (const [at, n, len] of (sect === "A" ? tA : tB)[b]) {
          if (at !== s) continue;
          I.lead(t, n, len * st, { wave: "p25", vol: 0.038, cut: 3400 });
          if (sec >= 2) I.lead(t, n + 12, len * st, { wave: "p12", vol: 0.013, cut: 5000, dly: 0.35, verb: 0.5 });
        }
      }
      // A star falling now and then: a high bell run.
      if (b === 7 && s === 8 && sec !== 0) [0, 1, 2, 3].forEach((k) => I.bell(t + k * st * 0.5, arpNote(ch, 7 - k) + 12, { vol: 0.018, d: 0.9 }));
      if (s % 8 === 6 && Math.random() < 0.2) I.bubble(t, rnd(800, 1700), 0.02, rnd(-0.6, 0.6));
    },
  };
})();

export const TRACKS = {
  menu: TIDE_POOL,
  kelp: KELP_LATTICE,
  signal: DEEP_SIGNAL,
  reef: STARFALL_REEF,
};
export const GAME_TRACKS = ["kelp", "signal", "reef"];

/* ------------------------------------------------------------------
   The player: a look-ahead sequencer, with crossfades between pieces.
   ------------------------------------------------------------------ */
const AHEAD = 0.18;      // schedule this far ahead (s)
const TICK_MS = 25;
let want = null;         // the piece that should be playing
let cur = null;          // { name, step, next }
let timer = null;
let hidden = false;

function tick(ahead = AHEAD) {
  if (!cur || !A) return;
  const c = A.ctx;
  const tr = TRACKS[cur.name];
  const st = 60 / tr.bpm / 4;
  // If we fell far behind (the tab slept), skip ahead instead of bursting.
  if (cur.next < c.currentTime - 0.1) cur.next = c.currentTime + 0.05;
  while (cur.next < c.currentTime + ahead) {
    const bar = Math.floor(cur.step / 16);
    try {
      tr.play({ bar: bar % 32, s: cur.step % 16, pass: Math.floor(bar / 32), sec: Math.floor((bar % 32) / 8), t: cur.next, st });
    } catch { /* a bad note never stops the music */ }
    cur.step++;
    cur.next += st;
  }
}

function startTimer() {
  if (!timer) timer = setInterval(() => tick(), TICK_MS);
}

function begin(name) {
  if (!build()) return;
  const c = A.ctx;
  if (c.state !== "running") return;
  const tr = TRACKS[name];
  echo.delayTime.setValueAtTime((60 / tr.bpm) * 0.75, c.currentTime); // a dotted eighth
  cur = { name, step: 0, next: c.currentTime + 0.12 };
  busVol.gain.cancelScheduledValues(c.currentTime);
  busVol.gain.setValueAtTime(0.0001, c.currentTime);
  busVol.gain.linearRampToValueAtTime(curve(volume), c.currentTime + 1.5);
  startTimer();
}

/** Fade the current piece out, then call `then`. */
function fadeOut(sec, then) {
  if (!cur || !A) { then?.(); return; }
  const c = A.ctx, g = busVol.gain;
  g.cancelScheduledValues(c.currentTime);
  g.setValueAtTime(g.value, c.currentTime);
  g.linearRampToValueAtTime(0.0001, c.currentTime + sec);
  const was = cur;
  setTimeout(() => {
    if (cur === was) { cur = null; }
    then?.();
  }, sec * 1000 + 30);
}

let pendingReady = null;
function apply() {
  if (hidden) return;
  const name = want;
  if (cur && cur.name === name) return;
  const go = () => {
    if (want !== name || hidden) return;
    if (!name || volume <= 0) { cur = null; return; }
    begin(name);
  };
  if (!A || A.ctx.state !== "running") {
    pendingReady?.();
    pendingReady = onAudioReady(() => apply());
    return;
  }
  if (cur) fadeOut(1.1, go); else go();
}

export const music = {
  /** Play a piece (crossfading from whatever is on), or null to fade out. */
  play(name) {
    if (name && !TRACKS[name]) return;
    if (want === name) return;
    want = name;
    if (name) { build(); intensity = 0; }
    apply();
  },
  stop() { music.play(null); },
  /** 0..10. */
  setVolume(v) {
    const nv = Math.max(0, Math.min(10, Number(v) || 0)) / 10;
    const was = volume;
    volume = nv;
    if (!A || !busVol) return;
    if (volume <= 0) { fadeOut(0.3); return; }
    if (was <= 0 || !cur) { apply(); return; }
    busVol.gain.setTargetAtTime(curve(volume), A.ctx.currentTime, 0.05);
  },
  /** 0 normal, 1 overtime: the filter opens, the drums push. */
  setIntensity(x) {
    intensity = x ? 1 : 0;
    if (busFilter && A) busFilter.frequency.setTargetAtTime(intensity ? 9000 : 5200, A.ctx.currentTime, 0.5);
  },
  /** A popup or the result screen: tuck the music under the water for a moment. */
  duck(on) {
    if (!busFilter || !A) return;
    busFilter.frequency.setTargetAtTime(on ? 900 : intensity ? 9000 : 5200, A.ctx.currentTime, 0.15);
  },
  get playing() { return cur?.name || null; },
  /** Schedule `sec` seconds at once (for rendering a preview offline). */
  scheduleAhead(sec) { tick(sec); },
};

/** A pause in the tab pauses the music (timers sleep there anyway). */
if (typeof document !== "undefined") {
  document.addEventListener("visibilitychange", () => {
    hidden = document.hidden;
    if (hidden) { if (cur) fadeOut(0.2); }
    else apply();
  });
}

/** Which in-game piece next: the one chosen, or each in turn. */
let rotation = Math.floor(Math.random() * GAME_TRACKS.length);
export function nextGameTrack(choice) {
  if (GAME_TRACKS.includes(choice)) return choice;
  rotation = (rotation + 1) % GAME_TRACKS.length;
  return GAME_TRACKS[rotation];
}
