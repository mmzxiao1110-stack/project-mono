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
    master.gain.value = 0.9;
    // A gentle compressor so stacked crackles don't clip.
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    master.connect(comp);
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
function burst(t, { dur, vol, filter = "bandpass", freq = 2000, freqTo = null, q = 1, attack = 0.004, rate = 1 }) {
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
  o.frequency.setValueAtTime(rand(95, 120), t);
  o.frequency.exponentialRampToValueAtTime(48, t + 0.12);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol * 0.9, t + 0.006);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
  o.connect(g);
  g.connect(master);
  o.start(t);
  o.stop(t + 0.2);
  burst(t, { dur: 0.08, vol: vol * 0.5, filter: "lowpass", freq: 420, q: 0.7 });
}

/** Crumpling: many tiny, randomly pitched crackles over `dur` seconds. */
function crackle(t, dur, vol, density = 70) {
  const n = Math.round(dur * density);
  for (let i = 0; i < n; i++) {
    const at = t + Math.pow(Math.random(), 0.8) * dur;
    burst(at, {
      dur: rand(0.006, 0.03),
      vol: vol * rand(0.25, 1),
      filter: "bandpass",
      freq: rand(1200, 6000),
      q: rand(0.8, 3),
      attack: 0.001,
    });
  }
  // The body of the sheet moving underneath the crackle.
  burst(t, { dur, vol: vol * 0.35, filter: "bandpass", freq: 900, freqTo: 1800, q: 0.6, attack: 0.03 });
}

/** A sheet sliding across another: swept friction. */
function slide(t, dur, vol, from = 1400, to = 2800) {
  burst(t, { dur, vol, filter: "bandpass", freq: from, freqTo: to, q: 1.2, attack: dur * 0.35 });
}

/** @param kind see the list at the top of the file. @param vol 0–1 */
export function sfx(kind, vol = 0.5) {
  if (!vol || !ensure()) return;
  if (ctx.state === "suspended") ctx.resume();
  const t = ctx.currentTime + 0.005;
  const v = Math.min(1, vol);

  switch (kind) {
    case "pick":
      slide(t, rand(0.11, 0.15), v * 0.5, rand(1300, 1700), rand(2600, 3200));
      break;
    case "rotate":
      burst(t, { dur: 0.04, vol: v * 0.55, filter: "highpass", freq: rand(2600, 3400), q: 0.8, attack: 0.002 });
      burst(t + 0.018, { dur: 0.03, vol: v * 0.25, filter: "bandpass", freq: 4200, q: 2, attack: 0.002 });
      break;
    case "place":
      thump(t, v * 0.8);
      burst(t + 0.004, { dur: 0.06, vol: v * 0.45, filter: "bandpass", freq: rand(1800, 2400), q: 0.9, attack: 0.002 });
      break;
    case "drop":
      crackle(t, 0.22, v * 0.5, 80);
      burst(t + 0.2, { dur: 0.09, vol: v * 0.3, filter: "lowpass", freq: 700, q: 0.7 });
      break;
    case "special":
      burst(t, { dur: 0.32, vol: v * 0.6, filter: "bandpass", freq: 700, freqTo: 3800, q: 1.6, attack: 0.01 });
      crackle(t + 0.02, 0.28, v * 0.45, 90);
      break;
    case "found":
      slide(t, 0.26, v * 0.55, 600, 4200);
      burst(t + 0.2, { dur: 0.12, vol: v * 0.35, filter: "lowpass", freq: 1500, q: 0.7 });
      break;
    case "end":
      slide(t, 0.3, v * 0.55, 700, 3800);
      thump(t + 0.28, v * 0.7);
      break;
    case "transition":
      crackle(t, 0.5, v * 0.42, 85);
      slide(t + 0.05, 0.35, v * 0.3, 900, 2200);
      break;
    case "ui":
    default:
      burst(t, { dur: 0.035, vol: v * 0.45, filter: "bandpass", freq: rand(1500, 2100), q: 1.1, attack: 0.002 });
      burst(t, { dur: 0.05, vol: v * 0.25, filter: "lowpass", freq: 380, q: 0.7 });
  }
}
