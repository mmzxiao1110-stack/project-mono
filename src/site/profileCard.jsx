/**
 * The profile card, after tetr.io's: the picture breaking out over the top
 * edge, the name, and big mini-cards for Blitz, Sprint and Ultra breaking
 * out over the bottom edge. The card is a little dithered sky in the colours
 * the player picked (see shared/card.js): waves, stars, bubbles or a grid
 * drifting across it. `p` is the shape /api/player returns.
 */
import { useEffect, useRef, useState } from "react";
import { PLACEMENT_GAMES } from "../../shared/glicko.js";
import { SKIES, CARD_INKS, cleanCard } from "../../shared/card.js";
import { RankIcon } from "./rankIcon.jsx";
import { RANKS, rankIndexFor } from "../../shared/glicko.js";
import { timeAgo } from "./api.js";

const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => (v + 0.5) / 16);
const rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

/** The card's sky: a low-resolution canvas, dithered, scaled up crisp. */
export function CardSky({ card, pixel = 6 }) {
  const ref = useRef(null), box = useRef(null);
  const c = cleanCard(card);
  // Square pixels: as many as fit the card at `pixel` CSS pixels each.
  const [{ w, h }, setDims] = useState({ w: 120, h: 30 });
  useEffect(() => {
    const el = box.current; if (!el) return undefined;
    const fit = () => setDims((d) => {
      const nw = Math.max(16, Math.round(el.clientWidth / pixel)), nh = Math.max(8, Math.round(el.clientHeight / pixel));
      return d.w === nw && d.h === nh ? d : { w: nw, h: nh };
    });
    fit();
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(fit) : null;
    ro?.observe(el);
    return () => ro?.disconnect();
  }, [pixel]);
  useEffect(() => {
    const cv = ref.current; if (!cv) return undefined;
    const ctx = cv.getContext("2d"), img = ctx.createImageData(w, h), d = img.data;
    const [g0, g1, g2, g3] = SKIES[c.sky].map(rgb), ink = rgb(CARD_INKS[c.accent]), white = [255, 255, 255];
    let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const stars = Array.from({ length: Math.round(w * h / 90) }, () => ({ x: Math.floor(rnd() * w), y: Math.floor(rnd() * h * 0.8), p: rnd() * 6 }));
    const bubbles = Array.from({ length: Math.round(w * h / 200) + 4 }, () => ({ x: rnd() * w, y: rnd() * h, v: 2 + rnd() * 4, r: rnd() < 0.3 ? 2 : 1 }));
    const still = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    let raf, last = 0;
    const set = (x, y, col, a = 1) => { if (x < 0 || y < 0 || x >= w || y >= h) return; const o = (y * w + x) * 4; d[o] += (col[0] - d[o]) * a; d[o + 1] += (col[1] - d[o + 1]) * a; d[o + 2] += (col[2] - d[o + 2]) * a; };
    const frame = (now) => {
      if (!still) raf = requestAnimationFrame(frame);
      if (now - last < 80 && last) return; // about 12 frames a second: it drifts, it doesn't race
      last = now;
      const s = now / 1000;
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const o = (y * w + x) * 4, th = BAYER[(y & 3) * 4 + (x & 3)];
        // Deep at the top to lighter at the bottom, with a glow of the sky's colours.
        let col = lerp(g0, g1, Math.min(1, y / h * 1.1));
        const gx = (x - w * 0.78) / w, gy = (y - h * 0.15) / h, glow = Math.max(0, 0.55 - Math.sqrt(gx * gx * 1.6 + gy * gy * 4));
        const lx = (x - w * 0.15) / w, ly = (y - h * 0.95) / h, glow2 = Math.max(0, 0.5 - Math.sqrt(lx * lx * 1.6 + ly * ly * 3));
        if (glow > th * 0.6) col = lerp(col, g2, 0.35);
        if (glow2 > th * 0.6) col = lerp(col, g3, 0.3);
        if (c.pattern === "waves") {
          for (let k = 0; k < 3; k++) {
            const yy = h * (0.45 + k * 0.17) + Math.sin(x * 0.11 + s * (0.8 + k * 0.3) + k) * 2.2;
            const dist = Math.abs(y - yy);
            if (dist < 1.2 && th < 0.75) col = lerp(col, ink, 0.45 - k * 0.1);
            else if (dist < 2.6 && th < 0.25) col = lerp(col, ink, 0.25);
          }
        } else if (c.pattern === "grid") {
          const hz = h * 0.55;
          if (y > hz) {
            const depth = (y - hz) / (h - hz);
            const row = Math.abs(((Math.log(depth + 0.05) * 6 - s * 1.2) % 1 + 1) % 1) < 0.12;
            const colx = Math.abs((((x - w / 2) / (0.2 + depth * 1.8)) % 9 + 9) % 9) < 0.9;
            if ((row || colx) && th < 0.4 + depth * 0.5) col = lerp(col, ink, 0.6);
          } else if (Math.abs(y - hz) < 0.6) col = lerp(col, ink, 0.8);
        }
        d[o] = col[0]; d[o + 1] = col[1]; d[o + 2] = col[2]; d[o + 3] = 255;
      }
      if (c.pattern === "stars" || c.pattern === "grid") for (const st of stars) {
        const tw = 0.5 + 0.5 * Math.sin(s * 2.2 + st.p);
        if (c.pattern === "grid" && st.y > h * 0.5) continue;
        set(st.x, st.y, tw > 0.8 ? white : ink, 0.35 + tw * 0.6);
        if (tw > 0.93) { set(st.x - 1, st.y, white, 0.4); set(st.x + 1, st.y, white, 0.4); set(st.x, st.y - 1, white, 0.4); set(st.x, st.y + 1, white, 0.4); }
      }
      if (c.pattern === "bubbles") for (const b of bubbles) {
        const y = Math.round(((b.y - s * b.v) % h + h) % h), x = Math.round(b.x + Math.sin(s * 1.5 + b.y) * 1.2);
        if (b.r === 1) set(x, y, white, 0.55);
        else { set(x, y - 1, white, 0.5); set(x - 1, y, ink, 0.5); set(x + 1, y, ink, 0.5); set(x, y + 1, ink, 0.4); }
      }
      ctx.putImageData(img, 0, 0);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [c.sky, c.accent, c.pattern, w, h]);
  return (
    <div ref={box} className="absolute inset-0">
      <canvas ref={ref} width={w} height={h} aria-hidden="true" className="absolute inset-0 w-full h-full" style={{ imageRendering: "pixelated" }} />
    </div>
  );
}

/** A player's picture: a little mirrored pixel creature, drawn from their name. */
export function Avatar({ name, size = 48, ring = null }) {
  let h = 2166136261;
  for (const ch of String(name || "?")) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619) >>> 0; }
  const PAL = ["#7cc7bf", "#b4a3ee", "#ead6a4", "#E88FB4", "#6FA8FF", "#A3D98C", "#F2B880", "#6FD3E0"];
  const ink = PAL[h % PAL.length], ink2 = PAL[(h >>> 3) % PAL.length];
  const cells = [];
  let bits = h;
  for (let y = 0; y < 5; y++) for (let x = 0; x < 3; x++) {
    const on = bits & 1;
    bits = Math.imul((bits >>> 1) ^ (y * 31 + x), 2654435761) >>> 0;
    if (on) { cells.push([x + 1, y + 1, y >= 3 ? ink2 : ink]); if (x < 2) cells.push([5 - x, y + 1, y >= 3 ? ink2 : ink]); }
  }
  return (
    <svg role="img" aria-label={`${name}'s picture`} viewBox="0 0 7 7" style={{ width: size, height: size, display: "block", shapeRendering: "crispEdges", flexShrink: 0,
      boxShadow: ring ? `0 0 0 calc(var(--p) * 1) ${ring}, calc(var(--p) * 3) calc(var(--p) * 3) 0 rgba(0,0,0,.45)` : undefined }}>
      <rect width="7" height="7" fill="#1d1b33" />
      <rect width="7" height="1" fill="rgba(255,255,255,.08)" />
      {cells.map(([x, y, c], i) => <rect key={i} x={x} y={y} width="1" height="1" fill={c} />)}
      <rect x="2" y="2" width="1" height="1" fill="#1d1b33" /><rect x="4" y="2" width="1" height="1" fill="#1d1b33" />
    </svg>
  );
}

const clock = (ms) => { const m = Math.floor(ms / 60000), s = Math.floor((ms % 60000) / 1000), cs = Math.floor((ms % 1000) / 10); return `${m}:${String(s).padStart(2, "0")}.${String(cs).padStart(2, "0")}`; };
const px = (n) => `calc(var(--p) * ${n})`;
const BIG = { fontFamily: '"Silkscreen", monospace', fontWeight: 700, lineHeight: 1, color: "#fff", textShadow: `${px(1)} ${px(1)} 0 rgba(0,0,0,.55)` };

/** A ranking tag: "#12 GLOBAL". */
function Tag({ n, ink }) {
  if (!n) return null;
  return (
    <span className="tb-t tb-b inline-flex flex-col items-center" style={{ padding: `${px(1)} ${px(3)}`, background: `color-mix(in srgb, ${ink} 30%, rgba(8,6,20,.75))`, boxShadow: `inset 0 0 0 ${px(1)} ${ink}`, color: "#fff", lineHeight: 1.1 }}>
      <span style={{ opacity: 0.7, fontWeight: 400 }}>GLOBAL</span>#{n}
    </span>
  );
}

/** One mode's mini-card. */
function Mini({ label, ink, sky, big, lead, tag, sub, compact }) {
  return (
    <div className="relative flex flex-col items-center text-center" style={{
      padding: `${px(compact ? 3 : 4)} ${px(3)}`, gap: px(2), minWidth: 0,
      background: `linear-gradient(180deg, color-mix(in srgb, ${sky[1]} 92%, white 8%), ${sky[0]})`,
      boxShadow: `inset 0 0 0 ${px(1)} ${ink}, inset 0 ${px(2)} 0 rgba(255,255,255,.15), ${px(3)} ${px(3)} 0 rgba(0,0,0,.4)`,
    }}>
      <span className="tb-t" style={{ color: "rgba(255,255,255,.6)", letterSpacing: px(1) }}>{label}</span>
      <div className="flex items-center justify-center flex-wrap" style={{ gap: px(2) }}>
        {lead}
        <span style={{ ...BIG, fontSize: px(compact ? 13 : 17) }}>{big}</span>
        <Tag n={tag} ink={ink} />
      </div>
      {sub && <span className="tb-t" style={{ color: "rgba(255,255,255,.7)" }}>{sub}</span>}
    </div>
  );
}

export function ProfileCard({ p, compact = false, href = null }) {
  const card = cleanCard(p.card), sky = SKIES[card.sky], ink = CARD_INKS[card.accent];
  const bz = p.blitz;
  const bRank = bz && bz.games >= PLACEMENT_GAMES ? RANKS[rankIndexFor(bz.rating)] : null;
  const cRank = p.rank ? RANKS.find((r) => r.name === p.rank) : null;
  const av = compact ? 64 : 96, over = compact ? 18 : 28;   // how far the picture breaks out over the top
  const miniH = compact ? 34 : 44;                           // how far the mini-cards break out below
  return (
    <div className="relative w-full font-mono" style={{ paddingTop: px(over + 2) }}>
      <div className="relative w-full" style={{ boxShadow: `inset 0 0 0 ${px(1)} ${ink}, ${px(4)} ${px(4)} 0 rgba(0,0,0,.35)`, overflow: "visible" }}>
        <div className="absolute inset-0 overflow-hidden"><CardSky card={card} /></div>
        <div className="relative flex items-start" style={{ padding: `${px(compact ? 4 : 6)} ${px(compact ? 4 : 6)} ${px(miniH / 2 + (compact ? 8 : 12))}`, gap: px(4) }}>
          <div style={{ width: av, flexShrink: 0 }} />
          <div className="flex flex-col min-w-0 flex-1" style={{ gap: px(2) }}>
            <span className="truncate" style={{ ...BIG, fontSize: px(compact ? 14 : 20), textShadow: `${px(1)} ${px(1)} 0 rgba(0,0,0,.55), 0 0 ${px(6)} ${ink}` }}>{p.name}</span>
            {p.joined && <span className="tb-t" style={{ color: "rgba(255,255,255,.7)" }}>JOINED {timeAgo(p.joined).toUpperCase()}</span>}
          </div>
          {/* Control, small in the corner. */}
          <div className="flex items-center shrink-0" style={{ gap: px(2), padding: `${px(1)} ${px(3)}`, background: "rgba(6,4,16,.55)", boxShadow: `inset 0 0 0 ${px(1)} rgba(255,255,255,.15)` }}>
            <span className="tb-t" style={{ color: "rgba(255,255,255,.6)" }}>CONTROL</span>
            {cRank ? <RankIcon rank={cRank} size={px(10)} /> : null}
            <span className="tb-t tb-b" style={{ color: "#fff" }}>{p.tr != null ? p.tr : p.placementLeft != null ? `${PLACEMENT_GAMES - p.placementLeft}/${PLACEMENT_GAMES}` : "—"}</span>
          </div>
        </div>
        {/* The picture, breaking out over the top edge. */}
        <div className="absolute" style={{ left: px(compact ? 4 : 6), top: px(-over) }}><Avatar name={p.name} size={av} ring={ink} /></div>
      </div>
      {/* The three modes, breaking out over the bottom edge. */}
      <div className="relative grid" style={{ margin: `${px(-miniH / 2)} ${px(compact ? 2 : 4)} 0`, gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: px(compact ? 2 : 4), zIndex: 1 }}>
          <Mini label="BLITZ" ink={ink} sky={sky} compact={compact}
            lead={bz ? <RankIcon rank={bRank} size={px(compact ? 14 : 20)} /> : null}
            big={bz ? bz.rating : "—"} tag={bz?.position}
            sub={bz ? (bz.pps != null ? `${bz.apm?.toFixed(1)} APM · ${bz.pps.toFixed(2)} PPS · ${bz.vs?.toFixed(1)} VS` : `${bz.games} games`) : "unplayed"} />
          <Mini label="SPRINT · 40L" ink={ink} sky={sky} compact={compact}
            big={p.sprint ? clock(p.sprint.best) : "—"} tag={p.sprint?.position} sub={p.sprint?.at ? timeAgo(p.sprint.at).toUpperCase() : "no run yet"} />
          <Mini label="ULTRA · 2 MIN" ink={ink} sky={sky} compact={compact}
            big={p.ultra ? p.ultra.best.toLocaleString("en-US") : "—"} tag={p.ultra?.position} sub={p.ultra?.at ? timeAgo(p.ultra.at).toUpperCase() : "no run yet"} />
        </div>
      {href && (
        <a href={href} target="_blank" rel="noopener" className="tb-t flex items-center justify-center no-underline"
          style={{ marginTop: px(6), gap: px(2), color: "#fff", letterSpacing: px(1) }}>↗ VIEW FULL PROFILE</a>
      )}
    </div>
  );
}
