/**
 * Music — the game's soundtrack, streamed from /music/*.mp3.
 *
 *   BUTTERFLY      the menu
 *   INITIAL WAVE, LULLABY, WATER LIGHT, WAVE EFFECT   in game
 *
 * The in-game songs start from the middle of their tracks, so a match drops
 * you inside the music; the menu song plays from its beginning. Everything
 * fades in and out slowly. When an in-game song ends, the next one takes
 * over (again from its middle); the menu song comes round again.
 *
 * Everything runs through one music bus: a volume, and a filter that muffles
 * the music under popups and opens it up in overtime.
 */
import { core, onAudioReady } from "./sfx.js";

export const TRACKS = {
  menu: { title: "BUTTERFLY", src: "/music/butterfly.mp3", startAt: 0 }, // the menu song plays from its start
  wave: { title: "INITIAL WAVE", src: "/music/initial-wave.mp3" },
  lullaby: { title: "LULLABY", src: "/music/lullaby.mp3" },
  light: { title: "WATER LIGHT", src: "/music/water-light.mp3" },
  effect: { title: "WAVE EFFECT", src: "/music/wave-effect.mp3" },
};
export const GAME_TRACKS = ["wave", "lullaby", "light", "effect"];

const FADE_IN = 7;     // seconds: a long, slow swell
const FADE_OUT = 5;    // seconds, when the music changes or stops
const TAIL = 6;        // seconds before a song's end that the next one starts fading in
const START_AT = 0.5;  // where each song starts, as a share of its length

let A = null;          // the audio core
let busFilter = null, busVol = null;
let volume = 0.5;
let intensity = 0;
let ducked = false;
let want = null;       // the piece that should be playing (a TRACKS key), or null
let cur = null;        // the voice playing now: { name, audio, gain, timer }
let hidden = typeof document !== "undefined" && document.hidden;

const curve = (v) => (v <= 0 ? 0 : Math.pow(v, 1.7) * 0.9);

function build() {
  if (busVol) return true;
  A = core();
  if (!A) return false;
  const c = A.ctx;
  busFilter = c.createBiquadFilter();
  busFilter.type = "lowpass";
  busFilter.frequency.value = 18000;
  busFilter.Q.value = 0.5;
  busVol = c.createGain();
  busVol.gain.value = curve(volume);
  busFilter.connect(busVol); busVol.connect(A.mix);
  return true;
}

const cutoff = () => (ducked ? 900 : intensity ? 20000 : 18000);

/** Fades a voice out and lets it go. */
function release(v, sec = FADE_OUT) {
  if (!v) return;
  clearInterval(v.timer);
  const now = A.ctx.currentTime;
  v.gain.gain.cancelScheduledValues(now);
  v.gain.gain.setValueAtTime(v.gain.gain.value, now);
  v.gain.gain.linearRampToValueAtTime(0.0001, now + sec);
  setTimeout(() => { try { v.audio.pause(); v.src.disconnect(); v.audio.removeAttribute("src"); v.audio.load(); } catch { /* gone */ } }, sec * 1000 + 100);
}

/** Starts `name` from the middle of its track, swelling in. */
function voice(name) {
  const c = A.ctx;
  const audio = new Audio();
  audio.crossOrigin = "anonymous";
  audio.preload = "auto";
  audio.src = TRACKS[name].src;
  const src = c.createMediaElementSource(audio);
  const gain = c.createGain();
  gain.gain.value = 0.0001;
  src.connect(gain); gain.connect(busFilter);
  const v = { name, audio, src, gain, timer: null, started: false };
  const start = () => {
    if (v.started) return;
    v.started = true;
    const at = TRACKS[name].startAt ?? START_AT;
    if (at && Number.isFinite(audio.duration)) audio.currentTime = audio.duration * at;
    audio.play().then(() => {
      const now = c.currentTime;
      gain.gain.cancelScheduledValues(now);
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.linearRampToValueAtTime(1, now + FADE_IN);
    }).catch(() => { /* blocked until a tap: onAudioReady retries */ });
    // Near the end, hand over to the next song.
    v.timer = setInterval(() => {
      if (cur !== v || !Number.isFinite(audio.duration)) return;
      if (audio.duration - audio.currentTime < TAIL) next();
    }, 500);
  };
  audio.addEventListener("loadedmetadata", start, { once: true });
  if (audio.readyState >= 1) start();
  return v;
}

/** The song after this one: the next in-game track, or the menu song again. */
function next() {
  if (!cur) return;
  const name = cur.name === "menu" ? "menu" : GAME_TRACKS[(GAME_TRACKS.indexOf(cur.name) + 1) % GAME_TRACKS.length];
  release(cur, TAIL);
  cur = voice(name);
  if (want !== "menu") want = name;
}

let waiting = null;
function apply() {
  if (hidden) return;
  if (!A || A.ctx.state !== "running") {
    waiting?.();
    waiting = onAudioReady(() => { waiting = null; apply(); });
    return;
  }
  if (!want || volume <= 0) { if (cur) { release(cur); cur = null; } return; }
  if (cur && cur.name === want) return;
  if (cur) release(cur);
  cur = voice(want);
}

export const music = {
  /** Play a song (fading out whatever is on), or null to fade out. */
  play(name) {
    if (name && !TRACKS[name]) return;
    if (want === name && cur) return;
    want = name;
    if (name) build();
    intensity = 0;
    if (busFilter) busFilter.frequency.setTargetAtTime(cutoff(), A.ctx.currentTime, 0.3);
    apply();
  },
  stop() { music.play(null); },
  /** 0..10. */
  setVolume(v) {
    volume = Math.max(0, Math.min(10, Number(v) || 0)) / 10;
    if (!busVol) return;
    busVol.gain.setTargetAtTime(curve(volume), A.ctx.currentTime, 0.1);
    if (volume <= 0 && cur) { release(cur, 0.5); cur = null; }
    else if (volume > 0 && !cur) apply();
  },
  /** 0 normal, 1 overtime: a little brighter. */
  setIntensity(x) {
    intensity = x ? 1 : 0;
    if (busFilter) busFilter.frequency.setTargetAtTime(cutoff(), A.ctx.currentTime, 0.5);
  },
  /** A popup: the music goes under the water for a moment. */
  duck(on) {
    ducked = !!on;
    if (busFilter) busFilter.frequency.setTargetAtTime(cutoff(), A.ctx.currentTime, 0.2);
  },
  get playing() { return cur?.name || null; },
};

/** Hiding the tab fades the music away; coming back brings it in again. */
if (typeof document !== "undefined") {
  document.addEventListener("visibilitychange", () => {
    hidden = document.hidden;
    if (hidden) { if (cur) { release(cur, 0.4); cur = null; } }
    else apply();
  });
}

/** Which in-game song next: the one chosen, or each in turn. */
let rotation = Math.floor(Math.random() * GAME_TRACKS.length);
export function nextGameTrack(choice) {
  if (GAME_TRACKS.includes(choice)) return choice;
  rotation = (rotation + 1) % GAME_TRACKS.length;
  return GAME_TRACKS[rotation];
}
