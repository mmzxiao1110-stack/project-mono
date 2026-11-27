/**
 * The profile card, after tetr.io's: the picture breaking out over the top
 * edge, the name with TOWER / CONTROL / BLITZ tabs (opening on the player's
 * best), and big mini-cards for that mode breaking out over the bottom edge. The card is a little dithered sky in the colours
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
export function CardSky({ card, pixel = 8, world = null, at = null }) {
  const ref = useRef(null), box = useRef(null);
  const c = cleanCard(card);
  // Square pixels: as many as fit at `pixel` CSS pixels each. With `world`
  // (the whole card's size) every piece of the card draws the same sky and
  // shows its own part of it (`at`), so the gradient runs on unbroken.
  const [own, setDims] = useState({ w: 120, h: 30 });
  const { w, h } = world ? { w: Math.max(16, Math.round(world.w / pixel)), h: Math.max(8, Math.round(world.h / pixel)) } : own;
  useEffect(() => {
    if (world) return undefined;
    const el = box.current; if (!el) return undefined;
    const fit = () => setDims((d) => {
      const nw = Math.max(16, Math.round(el.clientWidth / pixel)), nh = Math.max(8, Math.round(el.clientHeight / pixel));
      return d.w === nw && d.h === nh ? d : { w: nw, h: nh };
    });
    fit();
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(fit) : null;
    ro?.observe(el);
    return () => ro?.disconnect();
  }, [pixel, world]);
  useEffect(() => {
    const cv = ref.current; if (!cv) return undefined;
    const ctx = cv.getContext("2d"), img = ctx.createImageData(w, h), d = img.data;
    const [g0, g1, g2] = SKIES[c.sky].map(rgb), ink = rgb(CARD_INKS[c.accent]);
    // The bands: from the sky's deep to its panel colour to a tint of its light.
    const BANDS = [g0, lerp(g0, g1, 0.35), lerp(g0, g1, 0.7), g1, lerp(g1, g2, 0.2), lerp(g1, g2, 0.38)];
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
        // A pixel-art gradient: a few flat bands, top left to bottom right,
        // dithered into each other only along the seams.
        const t = Math.min(0.999, (y / h) * 0.7 + (x / w) * 0.3);
        const f = t * (BANDS.length - 1), i0 = Math.floor(f);
        let col = BANDS[f - i0 > th ? Math.min(BANDS.length - 1, i0 + 1) : i0];
        if (c.pattern === "waves") {
          for (let k = 0; k < 2; k++) {
            const yy = h * (0.5 + k * 0.22) + Math.sin(x * 0.12 + s * (0.8 + k * 0.3) + k) * 2;
            if (Math.abs(y - yy) < 0.8 && th < 0.6) col = lerp(col, ink, 0.3 - k * 0.08);
          }
        } else if (c.pattern === "grid") {
          const hz = h * 0.6;
          if (y > hz) {
            const depth = (y - hz) / (h - hz);
            const row = Math.abs(((Math.log(depth + 0.05) * 6 - s * 1.2) % 1 + 1) % 1) < 0.12;
            const colx = Math.abs((((x - w / 2) / (0.2 + depth * 1.8)) % 9 + 9) % 9) < 0.9;
            if ((row || colx) && th < 0.3 + depth * 0.4) col = lerp(col, ink, 0.35);
          }
        }
        d[o] = col[0]; d[o + 1] = col[1]; d[o + 2] = col[2]; d[o + 3] = 255;
      }
      if (c.pattern === "stars" || c.pattern === "grid") for (const st of stars) {
        const tw = 0.5 + 0.5 * Math.sin(s * 2.2 + st.p);
        if (c.pattern === "grid" && st.y > h * 0.5) continue;
        set(st.x, st.y, ink, 0.12 + tw * 0.3);
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
    <div ref={box} className="absolute" style={world ? { left: -(at?.x || 0), top: -(at?.y || 0), width: world.w, height: world.h } : { inset: 0 }}>
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
 * One mode's mini-card: a glass bubble over the card's own sky (the same
 * pixels, carried on unbroken). Light from the top left: a bright rim and a
 * glint there, a shade bottom right. No border.
 */
const Mini = ({ card, world, at, label, big, lead, tag, sub, size = 1, style, boxRef }) => {
  const ink = CARD_INKS[card.accent];
  return (
    <div ref={boxRef} className="relative" style={{ ...style, filter: `drop-shadow(${px(3)} ${px(3)} 0 rgba(0,0,0,.5))` }}>
      <div className="relative" style={{ clipPath: STEP(1) }}>
      {world && at && <CardSky card={card} world={world} at={at} />}
      <div className="relative flex flex-col items-center text-center" style={{
        padding: `${px(3 + 2 * size)} ${px(3)}`, gap: px(1 + size), minWidth: 0,
      }}>
        <span className="tb-t" style={{ color: "rgba(255,255,255,.65)", letterSpacing: px(1) }}>{label}</span>
        <div className="flex items-center justify-center flex-wrap" style={{ gap: px(2) }}>
          {lead}
          <span style={{ ...BIG, fontSize: px(size >= 2 ? 22 : 14) }}>{big}</span>
          <Tag n={tag} ink={ink} />
        </div>
        {sub && <span className="tb-t" style={{ color: "rgba(255,255,255,.75)" }}>{sub}</span>}
      </div>
      </div>
    </div>
  );
};

/** The card's options, behind the pencil (your own card only): see-through glass. */
function CardOptions({ card, onChange, onClose }) {
  const pick = (patch) => onChange({ ...card, ...patch });
  const ink = CARD_INKS[card.accent];
  const head = (t) => <span className="tb-t" style={{ color: "rgba(255,255,255,.6)", letterSpacing: px(1) }}>{t}</span>;
  const frame = (on) => (on ? { boxShadow: `0 0 0 ${px(1)} #fff, ${px(1)} ${px(1)} 0 ${px(1)} rgba(0,0,0,.4)` } : { boxShadow: `${px(1)} ${px(1)} 0 rgba(0,0,0,.35)` });
  return (
    <div className="absolute flex flex-col" onClick={(e) => e.stopPropagation()} style={{ right: px(6), top: px(5), zIndex: 6, gap: px(3), padding: px(5), width: px(118),
      background: `color-mix(in srgb, ${ink} 10%, rgba(10,8,28,.78))`, clipPath: STEP(1),
      boxShadow: `inset ${px(1)} ${px(1)} 0 rgba(255,255,255,.28), inset ${px(-1)} ${px(-1)} 0 rgba(0,0,0,.3)` }}>
      <div className="flex items-center justify-between">
        <span className="tb-t tb-b" style={{ color: "#fff", letterSpacing: px(1) }}>YOUR CARD</span>
        <button onClick={onClose} aria-label="Close" className="tb-t tb-b" style={{ color: "#fff", padding: `0 ${px(2)}`, background: "rgba(255,255,255,.12)", clipPath: STEP(0.5) }}>✕</button>
      </div>
      {head("SKY")}
      <div className="grid" style={{ gridTemplateColumns: "repeat(4, 1fr)", gap: px(2) }}>
        {Object.entries(SKIES).map(([k, c]) => (
          <button key={k} aria-label={`Sky ${k}`} aria-pressed={card.sky === k} onClick={() => pick({ sky: k })} title={k}
            style={{ height: px(11), background: `linear-gradient(180deg, ${c[0]} 0 40%, ${c[1]} 40% 75%, ${c[2]} 75% 88%, ${c[3]} 88%)`, ...frame(card.sky === k) }} />
        ))}
      </div>
      {head("ACCENT")}
      <div className="grid" style={{ gridTemplateColumns: "repeat(6, 1fr)", gap: px(2) }}>
        {CARD_INKS.map((c, i) => (
          <button key={c} aria-label={`Accent ${i + 1}`} aria-pressed={card.accent === i} onClick={() => pick({ accent: i })}
            style={{ height: px(9), background: `linear-gradient(180deg, color-mix(in srgb, ${c} 70%, white) 0 25%, ${c} 25% 75%, color-mix(in srgb, ${c} 75%, black) 75%)`, ...frame(card.accent === i) }} />
        ))}
      </div>
      {head("PATTERN")}
      <div className="grid" style={{ gridTemplateColumns: "repeat(2, 1fr)", gap: px(2) }}>
        {PATTERNS.map((k) => (
          <button key={k} aria-pressed={card.pattern === k} onClick={() => pick({ pattern: k })} className="tb-t"
            style={{ padding: `${px(1)} 0`, color: card.pattern === k ? "#fff" : "rgba(255,255,255,.6)", background: card.pattern === k ? `color-mix(in srgb, ${ink} 40%, transparent)` : "rgba(255,255,255,.07)", clipPath: STEP(0.5) }}>{k.toUpperCase()}</button>
        ))}
      </div>
    </div>
  );
}

const PENCIL = ["......11", ".....111", "....111.", "...111..", "..111...", ".111....", "111.....", "11......"];
const hours = (sec) => (!sec ? "0 HOURS" : sec < 3600 ? `${Math.max(1, Math.round(sec / 60))} MIN` : `${Math.round(sec / 3600).toLocaleString("en-US")} HOURS`);

/**
 * The mode the card opens on: the one the player is best at. Placed ratings
 * beat unplaced ones; then the highest rating (all three are on one scale).
 * Nothing played: Blitz.
 */
function bestMode(p) {
  const opts = [
    ["blitz", p.blitz?.games ? p.blitz.rating : null, (p.blitz?.games || 0) >= PLACEMENT_GAMES],
    ["tower", p.tower?.games ? p.tower.rating : null, (p.tower?.games || 0) >= PLACEMENT_GAMES],
    ["control", p.tr ?? null, p.tr != null],
  ].filter(([, r]) => r != null);
  if (!opts.length) return "blitz";
  opts.sort((a, b) => (b[2] - a[2]) || (b[1] - a[1]));
  return opts[0][0];
}
const MODES = [["tower", "TOWER"], ["control", "CONTROL"], ["blitz", "BLITZ"]];
const pct = (w, g) => (g ? `${Math.round((100 * w) / g)}%` : "—");

export function ProfileCard({ p, compact = false, href = null, onEdit = null }) {
  const card = cleanCard(p.card);
  const [editing, setEditing] = useState(false);
  // The tab picked on this player's card; until then (or for another player), their best.
  const [pick, setPick] = useState(null);
  const mode = pick && pick.name === p.name ? pick.k : bestMode(p);
  const setMode = (k) => setPick({ name: p.name, k });
  const bz = p.blitz, tw = p.tower;
  const bRank = bz && bz.games >= PLACEMENT_GAMES ? RANKS[rankIndexFor(bz.rating)] : null;
  const tRank = tw && tw.games >= PLACEMENT_GAMES ? RANKS[rankIndexFor(tw.rating)] : null;
  const cRank = p.rank ? RANKS.find((r) => r.name === p.rank) : null;
  const ink = CARD_INKS[card.accent];
  const k = compact ? 0.8 : 1;
  const av = Math.round(64 * k);
  const SIDE = 3, BOTTOM = 0; // how far (in pixels of --p) the picture hangs over the left edge: a little
  // Where the card and each mini-card sit, so they can all show the same sky.
  const root = useRef(null), body = useRef(null), m0 = useRef(null), m1 = useRef(null), m2 = useRef(null), m3 = useRef(null);
  const [geo, setGeo] = useState(null);
  useEffect(() => {
    const el = root.current; if (!el) return undefined;
    const measure = () => {
      const r = el.getBoundingClientRect();
      const at = (x) => { const b = x.current?.getBoundingClientRect(); return b ? { x: b.left - r.left, y: b.top - r.top } : null; };
      setGeo({ world: { w: Math.round(r.width), h: Math.round(r.height) }, body: at(body), minis: [at(m0), at(m1), at(m2), at(m3)] });
    };
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : null;
    ro?.observe(el);
    const raf = requestAnimationFrame(measure);
    return () => { ro?.disconnect(); cancelAnimationFrame(raf); };
  }, [mode]);
  // The four mini-cards for the chosen mode: left, middle (the rating, biggest), right, and top right.
  const rates = (x) => (x?.pps != null ? `${x.apm?.toFixed(1)} APM · ${x.pps.toFixed(2)} PPS${x.vs != null ? ` · ${x.vs.toFixed(1)} VS` : ""}` : null);
  const minis = {
    blitz: [
      { label: "SPRINT · 40L", big: p.sprint ? clock(p.sprint.best) : "—", tag: p.sprint?.position, sub: p.sprint?.at ? timeAgo(p.sprint.at).toUpperCase() : "no run yet" },
      { label: "BLITZ", lead: bz ? <RankIcon rank={bRank} size={px(compact ? 14 : 22)} /> : null, big: bz ? bz.rating : "—", tag: bz?.position, sub: bz ? rates(bz) || `${bz.games} games` : "unplayed" },
      { label: "ULTRA · 2 MIN", big: p.ultra ? p.ultra.best.toLocaleString("en-US") : "—", tag: p.ultra?.position, sub: p.ultra?.at ? timeAgo(p.ultra.at).toUpperCase() : "no run yet" },
      { label: "MARATHON", big: p.marathon ? p.marathon.best.toLocaleString("en-US") : "—", tag: p.marathon?.position, sub: p.marathon?.at ? timeAgo(p.marathon.at).toUpperCase() : "no game yet" },
    ],
    tower: [
      { label: "WIN RATE", big: tw ? pct(tw.wins, tw.games) : "—", sub: tw ? `${tw.wins} / ${tw.games} WON` : "no match yet" },
      { label: "TOWER", lead: tw ? <RankIcon rank={tRank} size={px(compact ? 14 : 22)} /> : null, big: tw ? tw.rating : "—", tag: tw?.position,
        sub: tw ? rates(tw) || `${tw.games} games` : "unplayed" },
      { label: "BEST SENT", big: tw?.best ? tw.best : "—", sub: tw?.best ? "rows in a match" : "no match yet" },
      { label: "MATCHES", big: tw ? tw.games : "—", sub: tw ? (tw.games < PLACEMENT_GAMES ? `${tw.games}/${PLACEMENT_GAMES} placement` : `±${tw.rd ?? "—"} RD`) : "none yet" },
    ],
    control: [
      { label: "WIN RATE", big: p.games ? pct(p.wins, p.games) : "—", sub: p.games ? `${p.wins} / ${p.games} WON` : "no match yet" },
      { label: "CONTROL", lead: cRank ? <RankIcon rank={cRank} size={px(compact ? 14 : 22)} /> : null, big: p.tr != null ? p.tr : "—", tag: p.position,
        sub: p.tr != null ? (p.rd != null ? `±${p.rd} RD` : "ranked") : p.placementLeft != null ? `${PLACEMENT_GAMES - p.placementLeft}/${PLACEMENT_GAMES} placement` : "unplayed" },
      { label: "PEAK", big: p.peakTr ?? "—", sub: p.peakRank ? `RANK ${p.peakRank}` : p.peakTr != null ? "HIGHEST TR" : "not placed yet" },
      { label: "BEST STREAK", big: p.bestStreak ?? "—", sub: p.streak ? `${p.streak} in a row now` : "wins in a row" },
    ],
  }[mode];
  return (
    <div className="w-full font-mono">
    <div ref={root} className="relative w-full tb-pcard" style={{ padding: `0 ${px(SIDE)} ${px(BOTTOM)}` }}>
      <style>{`.tb-pcard .tb-pencil { opacity: 0; transition: opacity .15s steps(3); } .tb-pcard:hover .tb-pencil, .tb-pcard:focus-within .tb-pencil { opacity: 1; } @media (hover: none) { .tb-pcard .tb-pencil { opacity: .8; } }`}</style>
      {/* The card itself, its sky behind everything. */}
      <div ref={body} className="absolute overflow-hidden" style={{ left: px(SIDE), right: px(SIDE), top: 0, bottom: px(BOTTOM), clipPath: STEP(1) }}>
        {geo && <CardSky card={card} world={geo.world} at={geo.body} />}
      </div>
      <div className="relative" style={{ padding: `${px(compact ? 7 : 10)} ${px(6)} ${px(compact ? 7 : 9)}` }}>
        {/* Two rows on the same three columns: the picture over Sprint, the name over Blitz,
            joined / played and Marathon over Ultra; then Sprint, Blitz (biggest) and Ultra. */}
        <div className="grid" style={{ margin: `0 ${px(compact ? 2 : 4)}`, gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1.4fr) minmax(0, 1fr)", columnGap: px(compact ? 5 : 8), rowGap: px(compact ? 4 : 6), alignItems: "end" }}>
          <div className="flex justify-center" style={{ gridColumn: 1, gridRow: 1 }}>
            <div style={{ boxShadow: `${px(2)} ${px(2)} 0 rgba(0,0,0,.35)` }}><Avatar name={p.name} size={px(av)} /></div>
          </div>
          <div className="flex flex-col items-center text-center min-w-0" style={{ gridColumn: 2, gridRow: 1, gap: px(2), paddingBottom: px(2) }}>
            <span className="truncate max-w-full" style={{ ...BIG, fontSize: px(compact ? 15 : 22), textShadow: `${px(1)} ${px(1)} 0 rgba(0,0,0,.55)` }}>{p.name}</span>
          </div>
          <div className="flex flex-col min-w-0" style={{ gridColumn: 3, gridRow: 1, gap: px(3) }}>
            <div className="flex flex-col items-end text-right" style={{ gap: px(1), marginRight: onEdit ? px(12) : 0 }}>
              {p.joined && <span className="tb-t" style={{ color: "rgba(255,255,255,.75)" }}>JOINED {timeAgo(p.joined).toUpperCase()}</span>}
              <span className="tb-t" style={{ color: "rgba(255,255,255,.75)" }}>{hours(p.played ?? p.seconds)} PLAYED</span>
            </div>
            <Mini boxRef={m3} card={card} world={geo?.world} at={geo?.minis[3]} {...minis[3]} />
          </div>
          {/* The three game families: the card shows one; it opens on the player's best. */}
          <div role="tablist" aria-label="Mode" className="flex justify-center" style={{ gridColumn: "1 / 4", gridRow: 2, gap: px(3) }}>
            {MODES.map(([k, label]) => (
              <button key={k} role="tab" aria-selected={mode === k} onClick={(e) => { e.stopPropagation(); setMode(k); }} className="tb-t tb-b"
                style={{ padding: `${px(1.5)} ${px(compact ? 4 : 6)}`, letterSpacing: px(0.5), clipPath: STEP(0.5),
                  color: mode === k ? "#fff" : "rgba(255,255,255,.6)",
                  background: mode === k ? `color-mix(in srgb, ${ink} 50%, transparent)` : "rgba(255,255,255,.08)",
                  boxShadow: mode === k ? `inset ${px(1)} ${px(1)} 0 rgba(255,255,255,.3), inset ${px(-1)} ${px(-1)} 0 rgba(0,0,0,.3)` : "none" }}>{label}</button>
            ))}
          </div>
          <Mini boxRef={m0} card={card} world={geo?.world} at={geo?.minis[0]} {...minis[0]} style={{ gridColumn: 1, gridRow: 3, alignSelf: "start", marginTop: px(compact ? 3 : 5) }} />
          <Mini boxRef={m1} card={card} world={geo?.world} at={geo?.minis[1]} {...minis[1]} size={compact ? 1 : 2} style={{ gridColumn: 2, gridRow: 3, alignSelf: "start" }} />
          <Mini boxRef={m2} card={card} world={geo?.world} at={geo?.minis[2]} {...minis[2]} style={{ gridColumn: 3, gridRow: 3, alignSelf: "start", marginTop: px(compact ? 2 : 3) }} />
        </div>
      </div>
      {onEdit && (
        <button className="tb-pencil absolute" aria-label="Edit card colours" onClick={() => setEditing((e) => !e)}
          style={{ right: px(SIDE + 4), top: px(4), padding: px(2), background: "rgba(255,255,255,.16)", clipPath: STEP(0.5), zIndex: 5 }}>
          <svg viewBox="0 0 8 8" style={{ width: px(8), height: px(8), display: "block", shapeRendering: "crispEdges" }}>
            {PENCIL.flatMap((row, y) => [...row].map((b, x) => (b === "1" ? <rect key={`${x},${y}`} x={x} y={y} width="1" height="1" fill="rgba(255,255,255,.85)" /> : null)))}
          </svg>
        </button>
      )}
      {editing && onEdit && <CardOptions card={card} onChange={onEdit} onClose={() => setEditing(false)} />}
    </div>
      {href && (
        <a href={href} target="_blank" rel="noopener" className="tb-t flex items-center justify-center no-underline"
          style={{ marginTop: px(5), gap: px(2), color: "#fff", letterSpacing: px(1) }}>↗ VIEW FULL PROFILE</a>
      )}
    </div>
  );
}
