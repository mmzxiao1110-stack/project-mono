/* eslint-disable react-refresh/only-export-components -- a shared kit: components plus the helpers that go with them */
import { useEffect, useRef } from "react";

/* ============================================================
   PIXEL SKY — the animated background behind every screen
   ============================================================ */
/**
 * `paused` counts open popups (their frosted glass would otherwise re-blur
 * a moving picture every frame); `slow` is set during matches, when the
 * sky should stay out of the way.
 */
export const sky = { paused: 0, slow: false };

/**
 * A night sky in the style of Celeste's later chapters, drawn pixel by
 * pixel at the screen's pixel size: colour bands from deep top to warmer
 * horizon with ordered dithering between them, two dithered nebulae in the
 * theme's colours drifting slowly, pastel stars twinkling and a little wind.
 * About 10 fps, half that in a match, paused while hidden or under a popup.
 */
// Pastel star colours, shared by the sky and the dream-block board.
export const rgbOf = (hex) => { const n = parseInt(String(hex).replace("#", ""), 16); return [n >> 16, (n >> 8) & 255, n & 255]; };
export const mixRgb = (a, b, t) => [0, 1, 2].map((i) => Math.round(a[i] + (b[i] - a[i]) * t));
export const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => (v + 0.5) / 16);

/** The sky is drawn in pixels this many times the UI pixel, so it reads soft and far away. */
const SKY_SCALE = 2;

/**
 * The backdrop: deep water in space. Dithered bands of colour that ripple
 * like water, two slow glows drifting through, and a few bubbles rising.
 * Drawn at low resolution and scaled up with hard edges.
 */
export function SkyCanvas({ theme, px = 2 }) {
  const ref = useRef(null);
  const P = px * SKY_SCALE;
  const { ground, you, special, panel, motion } = theme;

  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    const ctx = cv.getContext("2d", { alpha: false });
    let W = 1, H = 1, img = null;
    const size = () => {
      W = Math.max(1, Math.ceil(window.innerWidth / P));
      H = Math.max(1, Math.ceil(window.innerHeight / P));
      cv.width = W; cv.height = H;
      cv.style.width = `${W * P}px`; cv.style.height = `${H * P}px`;
      img = ctx.createImageData(W, H);
    };
    size();
    // A resize clears the canvas: repaint at once (with animation off nothing else would).
    const onResize = () => { size(); draw(performance.now()); };
    window.addEventListener("resize", onResize);

    // Bands, top to bottom: deep dark down to a lavender haze.
    const g = rgbOf(ground), pa = rgbOf(panel), yo = rgbOf(you), sp = rgbOf(special);
    const BANDS = 9;
    const band = Array.from({ length: BANDS }, (_, i) => {
      const t = i / (BANDS - 1);
      return t < 0.55 ? mixRgb(mixRgb(g, [0, 0, 0], 0.3), pa, t / 0.55) : mixRgb(pa, mixRgb(pa, yo, 0.45), (t - 0.55) / 0.45);
    });
    const glows = [
      { c: yo, x: 0.28, y: 0.35, r: 0.42, vx: 0.004, vy: 0.002 },
      { c: sp, x: 0.72, y: 0.65, r: 0.38, vx: -0.003, vy: -0.0025 },
    ];
    const bubbles = Array.from({ length: 9 }, () => ({
      x: Math.random(), y: Math.random(), v: 0.012 + Math.random() * 0.02, p: Math.random() * 6.28, big: Math.random() < 0.4,
    }));
    const cream = rgbOf("#F2E8D2");

    const put = (x, y, c, a) => {
      if (x < 0 || y < 0 || x >= W || y >= H) return;
      const o = (y * W + x) * 4, d = img.data;
      d[o] += (c[0] - d[o]) * a; d[o + 1] += (c[1] - d[o + 1]) * a; d[o + 2] += (c[2] - d[o + 2]) * a;
    };

    const draw = (t) => {
      const d = img.data;
      const s = t * 0.001;
      // Per-column wave, worked out once a frame.
      const wave = new Float32Array(W);
      for (let x = 0; x < W; x++) wave[x] = Math.sin(x * 0.16 + s * 1.3) * 0.32 + Math.sin(x * 0.05 - s * 0.7) * 0.28;
      for (let y = 0; y < H; y++) {
        const fy0 = (y / Math.max(1, H - 1)) * (BANDS - 1);
        for (let x = 0; x < W; x++) {
          const th = BAYER[(y & 3) * 4 + (x & 3)];
          // The band edge rides the wave, with a dithered step between neighbours.
          const bi = Math.max(0, Math.min(BANDS - 1, Math.floor(fy0 + wave[x] + th)));
          let c = band[bi];
          for (const n of glows) {
            const dx = (x / W - n.x) * (W / Math.max(W, H)), dy = (y / H - n.y) * (H / Math.max(W, H));
            const v = 1 - Math.sqrt(dx * dx + dy * dy) / n.r;
            if (v <= 0) continue;
            const lvl = Math.floor(v * 3 + th);
            if (lvl > 0) c = mixRgb(c, n.c, Math.min(3, lvl) * 0.1);
          }
          const o = (y * W + x) * 4;
          d[o] = c[0]; d[o + 1] = c[1]; d[o + 2] = c[2]; d[o + 3] = 255;
        }
      }
      for (const b of bubbles) {
        const x = Math.floor(b.x * W + Math.sin(b.p + s * 1.6) * 1.5), y = Math.floor(b.y * H);
        if (b.big) {
          put(x, y - 1, cream, 0.22); put(x - 1, y, cream, 0.22); put(x + 1, y, cream, 0.16); put(x, y + 1, cream, 0.16);
          put(x - 1, y - 1, cream, 0.1);
        } else put(x, y, cream, 0.2);
      }
      ctx.putImageData(img, 0, 0);
    };

    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    // Draw one frame right away: a colour change (or resize) resets the canvas,
    // and while a popup has the sky paused the loop below wouldn't repaint it.
    draw(performance.now());
    if (!motion || reduced) { return () => window.removeEventListener("resize", onResize); }

    let raf, last = 0;
    const loop = (t) => {
      raf = requestAnimationFrame(loop);
      const every = sky.slow ? 160 : 80;
      if (t - last < every || sky.paused > 0 || document.hidden) return;
      const dt = Math.min(0.3, (t - last) / 1000);
      last = t;
      for (const n of glows) {
        n.x += n.vx * dt; n.y += n.vy * dt;
        if (n.x < 0.1 || n.x > 0.9) n.vx *= -1;
        if (n.y < 0.15 || n.y > 0.85) n.vy *= -1;
      }
      for (const b of bubbles) {
        b.y -= b.v * dt;
        if (b.y < -0.02) { b.y = 1.02; b.x = Math.random(); }
      }
      draw(t);
    };
    raf = requestAnimationFrame(loop);
    return () => { cancelAnimationFrame(raf); window.removeEventListener("resize", onResize); };
  }, [ground, you, special, panel, motion, P]);

  return (
    <canvas ref={ref} aria-hidden="true"
      style={{ position: "fixed", left: 0, top: 0, imageRendering: "pixelated", zIndex: 0, pointerEvents: "none" }} />
  );
}
