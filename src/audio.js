/**
 * Soundtrack.
 *
 * Streams through <audio> elements rather than decoding into memory — these are
 * multi-minute compositions and decoding a WAV would cost tens of megabytes of
 * RAM. Each track owns a gain node so crossfades are real ramps, not volume
 * stepping, and a shared analyser lets the visuals move with the music.
 */

/**
 * Add more battle tracks by dropping files in public/music/ and listing them
 * here. One is picked at random per match and the next follows when it ends.
 */
export const TRACKS = {
  menu: "/music/main-menu.mp4",
  battle: [
    "/music/the-lullaby.mp4",
    // "/music/second-piece.wav",
    // "/music/third-piece.wav",
  ],
};

class Music {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.analyser = null;
    this.bins = null;
    this.tracks = new Map(); // url -> { el, src, gain }
    this.current = null;
    this.queue = null;     // active playlist, if any
    this.lastPick = -1;
    this.volume = 0.5;
    this.enabled = true;
    this.unlocked = false;
    this.smooth = 0;
    this.failed = new Set();
  }

  /* Browsers refuse to start audio until the user has interacted. */
  unlock() {
    if (this.unlocked) return;
    this.unlocked = true;
    this.ensure();
    if (this.ctx.state === "suspended") this.ctx.resume();
    if (this.queue) this.playList(this.queue, { fade: 900, force: true });
    else if (this.current) this.play(this.current);
  }

  ensure() {
    if (this.ctx) return;
    try {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      this.master = this.ctx.createGain();
      this.master.gain.value = 1;
      this.analyser = this.ctx.createAnalyser();
      this.analyser.fftSize = 256;
      this.analyser.smoothingTimeConstant = 0.75;
      this.bins = new Uint8Array(this.analyser.frequencyBinCount);
      this.master.connect(this.analyser);
      this.analyser.connect(this.ctx.destination);
    } catch (e) {
      this.ctx = null;
    }
  }

  track(url) {
    if (this.tracks.has(url)) return this.tracks.get(url);
    this.ensure();
    if (!this.ctx) return null;
    try {
      const el = new Audio(url);
      el.preload = "auto";
      el.addEventListener("ended", () => {
        // Only playlists reach here; single tracks loop natively.
        if (this.queue && this.current === url) this.advance(1400);
      });
      el.crossOrigin = "anonymous";
      el.addEventListener("error", () => this.failed.add(url));
      const src = this.ctx.createMediaElementSource(el);
      const gain = this.ctx.createGain();
      gain.gain.value = 0;
      src.connect(gain);
      gain.connect(this.master);
      const t = { el, src, gain };
      this.tracks.set(url, t);
      return t;
    } catch (e) {
      this.failed.add(url);
      return null;
    }
  }

  ramp(gain, to, ms) {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    gain.cancelScheduledValues(now);
    gain.setValueAtTime(Math.max(0.0001, gain.value), now);
    gain.linearRampToValueAtTime(Math.max(0.0001, to), now + ms / 1000);
  }

  /** Picks a track from the list at random and keeps the list running. */
  playList(list, { fade = 1600, force = false } = {}) {
    if (!list || !list.length) return;
    if (!force && this.queue === list && this.current) return; // already running
    this.queue = list;
    this.advance(fade);
  }

  advance(fade) {
    const list = this.queue;
    if (!list || !list.length) return;
    let i = Math.floor(Math.random() * list.length);
    if (list.length > 1 && i === this.lastPick) i = (i + 1) % list.length;
    this.lastPick = i;
    this.play(list[i], { fade, loop: false, keepQueue: true });
  }

  /** Fades the previous track out while the new one fades in. */
  play(url, { fade = 1600, loop = true, keepQueue = false } = {}) {
    if (!keepQueue) this.queue = null;
    if (this.current === url && !keepQueue) return;
    this.current = url;
    if (!this.enabled || !this.unlocked || this.failed.has(url)) return;
    this.ensure();
    if (!this.ctx) return;
    if (this.ctx.state === "suspended") this.ctx.resume();

    for (const [u, t] of this.tracks) {
      if (u === url) continue;
      this.ramp(t.gain.gain, 0, fade);
      setTimeout(() => { if (this.current !== u) { try { t.el.pause(); } catch (e) {} } }, fade + 60);
    }

    const t = this.track(url);
    if (!t) return;
    t.el.loop = loop;
    if (t.el.currentTime > 0 && t.el.ended) t.el.currentTime = 0;
    const p = t.el.play();
    if (p && p.catch) p.catch(() => {});
    this.ramp(t.gain.gain, this.volume, fade);
  }

  stop({ fade = 900 } = {}) {
    this.current = null;
    this.queue = null;
    for (const [, t] of this.tracks) {
      this.ramp(t.gain.gain, 0, fade);
      setTimeout(() => { try { t.el.pause(); } catch (e) {} }, fade + 60);
    }
  }

  setVolume(v) {
    this.volume = v;
    if (!this.ctx || !this.current) return;
    const t = this.tracks.get(this.current);
    if (t) this.ramp(t.gain.gain, this.enabled ? v : 0, 260);
  }

  setEnabled(on) {
    const wasQueue = this.queue;
    this.enabled = on;
    if (!on) { this.stop({ fade: 500 }); this.queue = wasQueue; this.current = null; }
    else if (wasQueue) this.playList(wasQueue, { fade: 900, force: true });
    else if (this.current) this.play(this.current);
  }

  /**
   * Low-end energy, 0..1, smoothed. Returns a slow idle wave when nothing is
   * playing so the visuals never freeze into a still image.
   */
  level() {
    if (!this.analyser || !this.enabled || !this.current) {
      return 0.34 + 0.16 * Math.sin(Date.now() / 1400);
    }
    this.analyser.getByteFrequencyData(this.bins);
    const n = Math.max(4, Math.floor(this.bins.length / 6));
    let sum = 0;
    for (let i = 0; i < n; i++) sum += this.bins[i];
    const raw = sum / (n * 255);
    // Attack fast, release slow — reads as a heartbeat rather than a flicker.
    this.smooth = raw > this.smooth
      ? this.smooth + (raw - this.smooth) * 0.55
      : this.smooth + (raw - this.smooth) * 0.09;
    return Math.min(1, this.smooth * 1.5) || 0.3;
  }
}

export const music = new Music();

/* ============================================================
   SFX — a small synthesised piano.
   Notes are drawn from a pentatonic scale, so whatever fires lands in key
   with the soundtrack instead of fighting it.
   ============================================================ */

let sfxMaster = null;

function ensureSfx() {
  music.ensure();
  if (!music.ctx) return null;
  if (!sfxMaster) {
    sfxMaster = music.ctx.createGain();
    sfxMaster.gain.value = 1;
    // Straight to the output, bypassing the analyser — clicks shouldn't
    // make the background jump.
    sfxMaster.connect(music.ctx.destination);
  }
  return music.ctx;
}

// C major pentatonic across three octaves, in semitones from C3.
const PENTA = [-23];
const SCALE = [];
for (let oct = 0; oct < 4; oct++) for (const p of PENTA) SCALE.push(p + oct * 12);
const C3 = 130.81;
const freqAt = (i) => C3 * Math.pow(2, SCALE[Math.max(0, Math.min(SCALE.length - 1, i))] / 12);

let lastPick = -1;
function pick(lo, hi) {
  let i = lo + Math.floor(Math.random() * (hi - lo));
  if (i === lastPick) i = lo + Math.floor(Math.random() * (hi - lo));
  lastPick = i;
  return i;
}

/**
 * One struck note. Four detuned partials with independent decays under a
 * closing lowpass — the upper harmonics dying first is what reads as a
 * hammer rather than a beep.
 */
function strike(freq, vol, delay = 0, dur = 1.15, bright = 1) {
  const ctx = ensureSfx();
  if (!ctx || !vol) return;
  if (ctx.state === "suspended") ctx.resume();
  const t = ctx.currentTime + delay;

  const bus = ctx.createGain();
  bus.gain.value = 1;
  const filt = ctx.createBiquadFilter();
  filt.type = "lowpass";
  filt.Q.value = 0.7;
  filt.frequency.setValueAtTime(Math.min(11000, freq * 9 * bright), t);
  filt.frequency.exponentialRampToValueAtTime(Math.max(300, freq * 1.8), t + dur * 0.75);
  bus.connect(filt);
  filt.connect(sfxMaster);

  const partials = [[1, 1], [2.001, 0.32], [3.004, 0.13], [4.01, 0.06]];
  for (const [mult, amp] of partials) {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = "sine";
    o.frequency.setValueAtTime(freq * mult, t);
    const peak = Math.max(0.0002, vol * amp * 0.34);
    const life = dur * (1 - 0.16 * Math.log2(mult + 1));
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + life);
    o.connect(g);
    g.connect(bus);
    o.start(t);
    o.stop(t + life + 0.05);
  }
}

/** @param kind ui | place | drop | special | found | end */
export function sfx(kind, vol = 0.5) {
  if (!vol) return;
  switch (kind) {
    case "place":
      strike(freqAt(pick(6, 14)), vol, 0, 1.2);
      break;
    case "drop":
      strike(freqAt(pick(0, 5)), vol * 0.8, 0, 0.9, 0.55);
      break;
    case "special": {
      const i = pick(13, 18);
      strike(freqAt(i), vol, 0, 1.5, 1.3);
      strike(freqAt(i + 3), vol * 0.7, 0.055, 1.5, 1.3);
      break;
    }
    case "found":
      [0, 0.09, 0.18].forEach((d, n) => strike(freqAt(8 + n * 2), vol * 0.8, d, 1.0));
      break;
    case "end":
      [0, 0.11, 0.22, 0.33].forEach((d, n) => strike(freqAt(5 + n * 3), vol * 0.85, d, 1.6));
      break;
    case "ui":
    default:
      strike(freqAt(pick(9, 17)), vol * 0.5, 0, 0.55, 1.2);
  }
}