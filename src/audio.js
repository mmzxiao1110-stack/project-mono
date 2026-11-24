/**
 * Sound effects — all paper.
 *
 * Synthesised, not sampled: every sound is filtered noise shaped by an
 * envelope, the way paper actually makes sound (friction and crackle, no
 * pitch). That keeps the bundle small and leaves nothing to license.
 *
 *   ui         soft fingertip tap on a sheet
 *   pick       a card slid off the pile
 *   rotate     a quick flick of the corner
 *   place      the block pressed down: a small thump and a slap
 *   drop       a block crumpled and tossed
 *   special    two pieces colliding: a short tear
 *   found      a page turned (match found)
 *   end        a page turned and set down (match over)
 *   transition a whole sheet crumpled (screen changes)
 *
 * Tuned warm: the whole mix runs through a gentle low-pass and a little
 * low-shelf lift, crackles sit in the low-mids rather than the hiss range,
 * and nothing starts with a hard click. Paper heard from across a desk,
 * not a microphone pressed against it.
 *
 * There is no background music.
 */

let ctx = null;
let master = null;
let noiseBuf = null;

function ensure() {
  if (ctx) return ctx;
  try {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    master = ctx.createGain();
    master.gain.value = 1;
    // Warmth: roll off the top, lift the body a touch, then a soft compressor
    // so stacked crackles never clip.
    const tame = ctx.createBiquadFilter();
    tame.type = "lowpass";
    tame.frequency.value = 2600;
    tame.Q.value = 0.5;
    const body = ctx.createBiquadFilter();
    body.type = "lowshelf";
    body.frequency.value = 260;
    body.gain.value = 4;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -18;
    comp.knee.value = 12;
    comp.ratio.value = 3;
    master.connect(tame);
    tame.connect(body);
    body.connect(comp);
    comp.connect(ctx.destination);
    // Two seconds of white noise, reused by every sound at random offsets.
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  } catch {
    ctx = null;
  }
  return ctx;
}

/** Browsers start audio suspended until the first tap or key press. */
export function unlockAudio() {
  const c = ensure();
  if (c && c.state === "suspended") c.resume();
}

const rand = (a, b) => a + Math.random() * (b - a);

/**
 * One burst of filtered noise.
 *   filter: "bandpass" | "highpass" | "lowpass"
 *   freq / freqTo: filter frequency, optionally swept over the burst
 */
function burst(t, { dur, vol, filter = "bandpass", freq = 1200, freqTo = null, q = 0.8, attack = 0.012, rate = 1 }) {
  const src = ctx.createBufferSource();
  src.buffer = noiseBuf;
  src.playbackRate.value = rate;
  const f = ctx.createBiquadFilter();
  f.type = filter;
  f.Q.value = q;
  f.frequency.setValueAtTime(freq, t);
  if (freqTo) f.frequency.exponentialRampToValueAtTime(freqTo, t + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(Math.max(0.0002, vol), t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(f);
  f.connect(g);
  g.connect(master);
  src.start(t, rand(0, 1.5), dur + 0.05);
}

/** A soft low knock: a falling sine under a puff of low noise. */
function thump(t, vol) {
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = "sine";
  o.frequency.setValueAtTime(rand(80, 96), t);
  o.frequency.exponentialRampToValueAtTime(44, t + 0.16);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + 0.014);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
  o.connect(g);
  g.connect(master);
  o.start(t);
  o.stop(t + 0.26);
  burst(t, { dur: 0.1, vol: vol * 0.45, filter: "lowpass", freq: 320, q: 0.5, attack: 0.01 });
}

/** Crumpling: many tiny, randomly pitched crackles over `dur` seconds. */
function crackle(t, dur, vol, density = 70) {
  const n = Math.round(dur * density);
  for (let i = 0; i < n; i++) {
    const at = t + Math.pow(Math.random(), 0.8) * dur;
    burst(at, {
      dur: rand(0.012, 0.04),
      vol: vol * rand(0.2, 0.8),
      filter: "bandpass",
      freq: rand(500, 2000),
      q: rand(0.6, 1.4),
      attack: 0.004,
    });
  }
  // The body of the sheet moving underneath the crackle.
  burst(t, { dur, vol: vol * 0.45, filter: "bandpass", freq: 420, freqTo: 900, q: 0.5, attack: 0.05 });
}

/** A sheet sliding across another: swept friction. */
function slide(t, dur, vol, from = 600, to = 1300) {
  burst(t, { dur, vol, filter: "bandpass", freq: from, freqTo: to, q: 0.7, attack: dur * 0.4 });
}

/** @param kind see the list at the top of the file. @param vol 0–1 */
export function sfx(kind, vol = 0.5) {
  if (!vol || !ensure()) return;
  if (ctx.state === "suspended") ctx.resume();
  const t = ctx.currentTime + 0.005;
  const v = Math.min(1, vol);

  switch (kind) {
    case "pick":
      slide(t, rand(0.14, 0.18), v * 0.6, rand(550, 700), rand(1100, 1400));
      break;
    case "rotate":
      // A soft brush of the corner, not a snap.
      burst(t, { dur: 0.07, vol: v * 0.45, filter: "bandpass", freq: rand(900, 1200), q: 0.7, attack: 0.012 });
      burst(t + 0.02, { dur: 0.05, vol: v * 0.2, filter: "lowpass", freq: 700, q: 0.5, attack: 0.01 });
      break;
    case "place":
      thump(t, v * 0.85);
      burst(t + 0.006, { dur: 0.08, vol: v * 0.3, filter: "bandpass", freq: rand(700, 900), q: 0.6, attack: 0.008 });
      break;
    case "drop":
      crackle(t, 0.26, v * 0.45, 55);
      burst(t + 0.22, { dur: 0.12, vol: v * 0.35, filter: "lowpass", freq: 450, q: 0.5, attack: 0.015 });
      break;
    case "special":
      burst(t, { dur: 0.36, vol: v * 0.5, filter: "bandpass", freq: 380, freqTo: 1500, q: 0.9, attack: 0.03 });
      crackle(t + 0.03, 0.3, v * 0.4, 60);
      break;
    case "found":
      slide(t, 0.3, v * 0.6, 350, 1600);
      burst(t + 0.24, { dur: 0.16, vol: v * 0.35, filter: "lowpass", freq: 600, q: 0.5, attack: 0.02 });
      break;
    case "end":
      slide(t, 0.34, v * 0.6, 380, 1500);
      thump(t + 0.3, v * 0.75);
      break;
    case "transition":
      crackle(t, 0.55, v * 0.4, 60);
      slide(t + 0.05, 0.4, v * 0.4, 380, 1000);
      break;
    case "ui":
    default:
      burst(t, { dur: 0.06, vol: v * 0.4, filter: "bandpass", freq: rand(650, 850), q: 0.6, attack: 0.008 });
      burst(t, { dur: 0.07, vol: v * 0.3, filter: "lowpass", freq: 300, q: 0.5, attack: 0.008 });
  }
}
