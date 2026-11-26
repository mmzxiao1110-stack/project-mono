/**
 * The profile card, after tetr.io's: the picture breaking out over the top
 * edge, the name, and big mini-cards for Blitz, Sprint and Ultra breaking
 * out over the bottom edge. The card is a little dithered sky in the colours
 * the player picked (see shared/card.js): waves, stars, bubbles or a grid
 * drifting across it. `p` is the shape /api/player returns.
 */
import { useEffect, useRef, useState } from "react";
import { PLACEMENT_GAMES } from "../../shared/glicko.js";
import { SKIES, CARD_INKS, PATTERNS, cleanCard } from "../../shared/card.js";
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
    const [g0, g1, g2, g3] = SKIES[c.sky].map(rgb), ink = rgb(CARD_INKS[c.accent]);
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
        set(st.x, st.y, ink, 0.2 + tw * 0.45);
      }
      if (c.pattern === "bubbles") for (const b of bubbles) {
        const y = Math.round(((b.y - s * b.v) % h + h) % h), x = Math.round(b.x + Math.sin(s * 1.5 + b.y) * 1.2);
        if (b.r === 1) set(x, y, ink, 0.4);
        else { set(x, y - 1, ink, 0.45); set(x - 1, y, ink, 0.35); set(x + 1, y, ink, 0.35); set(x, y + 1, ink, 0.3); }
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

/**
 * A player's default picture, like GitHub's: a 5×5 pattern mirrored down the
 * middle, in one colour from their name, on pale grey. Pixels, nothing smooth.
 */
export function Avatar({ name, size = 48 }) {
  let h = 2166136261;
  for (const ch of String(name || "?")) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619) >>> 0; }
  const hue = h % 360, sat = 45 + ((h >>> 9) % 20), lit = 52 + ((h >>> 14) % 14);
  const ink = `hsl(${hue} ${sat}% ${lit}%)`;
  const cells = [];
  let bits = Math.imul(h ^ 0x9e3779b9, 2246822519) >>> 0;
  for (let y = 0; y < 5; y++) for (let x = 0; x < 3; x++) {
    if ((bits >>> (y * 3 + x)) & 1) { cells.push([x, y]); if (x < 2) cells.push([4 - x, y]); }
  }
  if (!cells.length) cells.push([2, 2]);
  return (
    <svg role="img" aria-label={`${name}'s picture`} viewBox="0 0 12 12" style={{ width: size, height: size, display: "block", shapeRendering: "crispEdges", flexShrink: 0 }}>
      <rect width="12" height="12" fill="#F0F0F0" />
      {cells.map(([x, y], i) => <rect key={i} x={1 + x * 2} y={1 + y * 2} width="2" height="2" fill={ink} />)}
      {/* a hard pixel shadow inside the frame, bottom and right */}
      <rect x="0" y="11" width="12" height="1" fill="rgba(0,0,0,.18)" /><rect x="11" y="0" width="1" height="12" fill="rgba(0,0,0,.18)" />
    </svg>
  );
}

const clock = (ms) => { const m = Math.floor(ms / 60000), s = Math.floor((ms % 60000) / 1000), cs = Math.floor((ms % 1000) / 10); return `${m}:${String(s).padStart(2, "0")}.${String(cs).padStart(2, "0")}`; };
const px = (n) => `calc(var(--p) * ${n})`;
const BIG = { fontFamily: '"Silkscreen", monospace', fontWeight: 700, lineHeight: 1, color: "#fff", textShadow: `${px(1)} ${px(1)} 0 rgba(0,0,0,.55)` };

// Corners cut in pixel steps (two steps), for glass and the card.
const STEP = (n) => `polygon(0 calc(var(--p) * ${2 * n}), calc(var(--p) * ${n}) calc(var(--p) * ${2 * n}), calc(var(--p) * ${n}) calc(var(--p) * ${n}), calc(var(--p) * ${2 * n}) calc(var(--p) * ${n}), calc(var(--p) * ${2 * n}) 0, calc(100% - var(--p) * ${2 * n}) 0, calc(100% - var(--p) * ${2 * n}) calc(var(--p) * ${n}), calc(100% - var(--p) * ${n}) calc(var(--p) * ${n}), calc(100% - var(--p) * ${n}) calc(var(--p) * ${2 * n}), 100% calc(var(--p) * ${2 * n}), 100% calc(100% - var(--p) * ${2 * n}), calc(100% - var(--p) * ${n}) calc(100% - var(--p) * ${2 * n}), calc(100% - var(--p) * ${n}) calc(100% - var(--p) * ${n}), calc(100% - var(--p) * ${2 * n}) calc(100% - var(--p) * ${n}), calc(100% - var(--p) * ${2 * n}) 100%, calc(var(--p) * ${2 * n}) 100%, calc(var(--p) * ${2 * n}) calc(100% - var(--p) * ${n}), calc(var(--p) * ${n}) calc(100% - var(--p) * ${n}), calc(var(--p) * ${n}) calc(100% - var(--p) * ${2 * n}), 0 calc(100% - var(--p) * ${2 * n}))`;

/** A ranking tag: "#12". */
function Tag({ n, ink }) {
  if (!n) return null;
  return <span className="tb-t tb-b" style={{ padding: `0 ${px(2)}`, color: "#fff", background: `color-mix(in srgb, ${ink} 45%, transparent)`, clipPath: STEP(0.5) }}>#{n}</span>;
}

/**
 * One mode's mini-card: a glass bubble over the same sky as the card. Light
 * from the top left: a bright rim and a glint there, a shade bottom right.
 */
function Mini({ card, label, big, lead, tag, sub, size = 1, style }) {
  const ink = CARD_INKS[card.accent];
  return (
    <div className="relative" style={{ clipPath: STEP(1), ...style }}>
      <CardSky card={card} />
      <div className="relative flex flex-col items-center text-center" style={{
        padding: `${px(3 + 2 * size)} ${px(3)} ${px(3 + 2 * size)}`, gap: px(1 + size), minWidth: 0,
        background: `color-mix(in srgb, ${ink} 12%, rgba(255,255,255,.07))`,
        boxShadow: `inset ${px(1)} ${px(1)} 0 rgba(255,255,255,.32), inset ${px(-1)} ${px(-1)} 0 rgba(0,0,0,.25), inset ${px(2)} ${px(2)} 0 rgba(255,255,255,.08)`,
      }}>
        {/* the glint */}
        <span aria-hidden="true" className="absolute" style={{ left: px(3), top: px(3), width: px(3), height: px(1), background: "rgba(255,255,255,.55)" }} />
        <span aria-hidden="true" className="absolute" style={{ left: px(3), top: px(4), width: px(1), height: px(2), background: "rgba(255,255,255,.4)" }} />
        <span className="tb-t" style={{ color: "rgba(255,255,255,.65)", letterSpacing: px(1) }}>{label}</span>
        <div className="flex items-center justify-center flex-wrap" style={{ gap: px(2) }}>
          {lead}
          <span style={{ ...BIG, fontSize: px(size >= 2 ? 22 : 14) }}>{big}</span>
          <Tag n={tag} ink={ink} />
        </div>
        {sub && <span className="tb-t" style={{ color: "rgba(255,255,255,.75)" }}>{sub}</span>}
      </div>
    </div>
  );
}

/** The card's options, behind the pencil (your own card only). */
function CardOptions({ card, onChange, onClose }) {
  const pick = (patch) => onChange({ ...card, ...patch });
  const row = (label, kids) => (
    <div className="flex items-center flex-wrap" style={{ gap: px(2) }}>
      <span className="tb-t" style={{ color: "rgba(255,255,255,.7)", width: px(44), flexShrink: 0 }}>{label}</span>{kids}
    </div>
  );
  const sq = (on) => ({ width: px(9), height: px(9), clipPath: STEP(0.5), boxShadow: on ? `inset 0 0 0 ${px(1)} #fff` : "none", outline: "none" });
  return (
    <div className="absolute flex flex-col" onClick={(e) => e.stopPropagation()} style={{ right: px(4), top: px(4), zIndex: 5, gap: px(2), padding: px(4),
      background: "rgba(8,6,22,.82)", clipPath: STEP(1) }}>
      {row("SKY", Object.entries(SKIES).map(([k, c]) => (
        <button key={k} aria-label={`Sky ${k}`} aria-pressed={card.sky === k} onClick={() => pick({ sky: k })}
          style={{ ...sq(card.sky === k), width: px(12), background: `linear-gradient(180deg, ${c[0]} 0 50%, ${c[1]} 50% 80%, ${c[2]} 80%)` }} />
      )))}
      {row("ACCENT", CARD_INKS.map((c, i) => (
        <button key={c} aria-label={`Accent ${i + 1}`} aria-pressed={card.accent === i} onClick={() => pick({ accent: i })} style={{ ...sq(card.accent === i), background: c }} />
      )))}
      {row("PATTERN", PATTERNS.map((k) => (
        <button key={k} aria-pressed={card.pattern === k} onClick={() => pick({ pattern: k })} className="tb-t"
          style={{ padding: `0 ${px(2)}`, color: card.pattern === k ? "#fff" : "rgba(255,255,255,.55)", background: card.pattern === k ? `color-mix(in srgb, ${CARD_INKS[card.accent]} 45%, transparent)` : "rgba(255,255,255,.08)", clipPath: STEP(0.5) }}>{k.toUpperCase()}</button>
      )))}
      <button onClick={onClose} className="tb-t self-end" style={{ color: "rgba(255,255,255,.75)" }}>DONE</button>
    </div>
  );
}

const PENCIL = ["......11", ".....111", "....111.", "...111..", "..111...", ".111....", "111.....", "11......"];

export function ProfileCard({ p, compact = false, href = null, onEdit = null }) {
  const card = cleanCard(p.card);
  const [editing, setEditing] = useState(false);
  const bz = p.blitz;
  const bRank = bz && bz.games >= PLACEMENT_GAMES ? RANKS[rankIndexFor(bz.rating)] : null;
  const cRank = p.rank ? RANKS.find((r) => r.name === p.rank) : null;
  const k = compact ? 0.75 : 1;
  const av = Math.round(30 * k), bleed = Math.round(6 * k);   // picture size and how far it hangs over the corner (in pixels of --p)
  return (
    <div className="relative w-full font-mono tb-pcard" style={{ padding: `${px(bleed)} ${px(bleed)} 0` }}>
      <style>{`.tb-pcard .tb-pencil { opacity: 0; transition: opacity .15s steps(3); } .tb-pcard:hover .tb-pencil, .tb-pcard:focus-within .tb-pencil { opacity: 1; } @media (hover: none) { .tb-pcard .tb-pencil { opacity: .8; } }`}</style>
      <div className="relative w-full" style={{ clipPath: STEP(1) }}>
        <CardSky card={card} />
        <div className="relative flex items-start" style={{ padding: `${px(4)} ${px(5)} ${px(Math.round(30 * k))} ${px(av - bleed + 5)}`, gap: px(4), minHeight: px(av + 10) }}>
          <div className="flex flex-col min-w-0 flex-1" style={{ gap: px(2) }}>
            <span className="truncate" style={{ ...BIG, fontSize: px(compact ? 14 : 20), textShadow: `${px(1)} ${px(1)} 0 rgba(0,0,0,.55)` }}>{p.name}</span>
            {p.joined && <span className="tb-t" style={{ color: "rgba(255,255,255,.7)" }}>JOINED {timeAgo(p.joined).toUpperCase()}</span>}
            <span className="tb-t flex items-center" style={{ gap: px(2), color: "rgba(255,255,255,.7)" }}>
              CONTROL {cRank ? <RankIcon rank={cRank} size={px(9)} /> : null}
              <span className="tb-b" style={{ color: "#fff" }}>{p.tr != null ? p.tr : p.placementLeft != null ? `${PLACEMENT_GAMES - p.placementLeft}/${PLACEMENT_GAMES} placement` : "—"}</span>
            </span>
          </div>
          {onEdit && (
            <button className="tb-pencil absolute" aria-label="Edit card colours" onClick={() => setEditing((e) => !e)}
              style={{ right: px(4), top: px(4), padding: px(2), background: "rgba(255,255,255,.16)", clipPath: STEP(0.5), zIndex: 4 }}>
              <svg viewBox="0 0 8 8" style={{ width: px(8), height: px(8), display: "block", shapeRendering: "crispEdges" }}>
                {PENCIL.flatMap((row, y) => [...row].map((b, x) => (b === "1" ? <rect key={`${x},${y}`} x={x} y={y} width="1" height="1" fill="rgba(255,255,255,.85)" /> : null)))}
              </svg>
            </button>
          )}
          {editing && onEdit && <CardOptions card={card} onChange={onEdit} onClose={() => setEditing(false)} />}
        </div>
      </div>
      {/* The picture, on the corner: it hangs over the top and the left by the same amount. */}
      <div className="absolute" style={{ left: 0, top: 0, boxShadow: `${px(2)} ${px(2)} 0 rgba(0,0,0,.35)` }}><Avatar name={p.name} size={px(av)} /></div>
      {/* The three modes: Blitz biggest in the middle, Sprint and Ultra lower, covering the bottom corners. */}
      <div className="relative grid items-start" style={{ margin: `${px(Math.round(-26 * k))} ${px(-bleed)} 0`, gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1.45fr) minmax(0, 1fr)", gap: px(compact ? 4 : 7), zIndex: 1 }}>
        <Mini card={card} label="SPRINT · 40L" style={{ marginTop: px(Math.round(16 * k)) }}
          big={p.sprint ? clock(p.sprint.best) : "—"} tag={p.sprint?.position} sub={p.sprint?.at ? timeAgo(p.sprint.at).toUpperCase() : "no run yet"} />
        <Mini card={card} label="BLITZ" size={compact ? 1 : 2}
          lead={bz ? <RankIcon rank={bRank} size={px(compact ? 14 : 22)} /> : null}
          big={bz ? bz.rating : "—"} tag={bz?.position}
          sub={bz ? (bz.pps != null ? `${bz.apm?.toFixed(1)} APM · ${bz.pps.toFixed(2)} PPS · ${bz.vs?.toFixed(1)} VS` : `${bz.games} games`) : "unplayed"} />
        <Mini card={card} label="ULTRA · 2 MIN" style={{ marginTop: px(Math.round(9 * k)) }}
          big={p.ultra ? p.ultra.best.toLocaleString("en-US") : "—"} tag={p.ultra?.position} sub={p.ultra?.at ? timeAgo(p.ultra.at).toUpperCase() : "no run yet"} />
      </div>
      {href && (
        <a href={href} target="_blank" rel="noopener" className="tb-t flex items-center justify-center no-underline"
          style={{ marginTop: px(5), gap: px(2), color: "#fff", letterSpacing: px(1) }}>↗ VIEW FULL PROFILE</a>
      )}
    </div>
  );
}
