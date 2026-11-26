/**
 * The profile card: a solid, horizontal card in the player's own two colours,
 * dithered like the sky behind the menu. Their picture, name and the numbers
 * that matter at a glance: Control and Blitz ratings, Blitz PPS / APM / VS,
 * Sprint, Ultra and Marathon bests. Used in the game (your account page, a
 * player's popup) and at the top of a player's page on T-Terminal.
 *
 * `p` is the shape /api/player returns.
 */
import { RANKS, PLACEMENT_GAMES, rankIndexFor } from "../../shared/glicko.js";
import { CARD_DEFAULT } from "./profileData.js";

const hex = (c) => (/^#[0-9a-f]{6}$/i.test(c || "") ? c : null);

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
      boxShadow: ring ? `0 0 0 calc(var(--p) * 1) ${ring}` : undefined }}>
      <rect width="7" height="7" fill="#1d1b33" />
      <rect width="7" height="1" fill="rgba(255,255,255,.08)" />
      {cells.map(([x, y, c], i) => <rect key={i} x={x} y={y} width="1" height="1" fill={c} />)}
      <rect x="2" y="2" width="1" height="1" fill="#1d1b33" /><rect x="4" y="2" width="1" height="1" fill="#1d1b33" />
    </svg>
  );
}

const clock = (ms) => { const m = Math.floor(ms / 60000), s = Math.floor((ms % 60000) / 1000), cs = Math.floor((ms % 1000) / 10); return `${m}:${String(s).padStart(2, "0")}.${String(cs).padStart(2, "0")}`; };

export function ProfileCard({ p, compact = false, children }) {
  const [a, b] = [hex(p.card?.[0]) || CARD_DEFAULT[0], hex(p.card?.[1]) || CARD_DEFAULT[1]];
  const px = (n) => `calc(var(--p) * ${n})`;
  const rk = (name) => RANKS.find((r) => r.name === name) || null;
  const control = p.tr != null ? { rank: rk(p.rank), value: p.tr } : null;
  const bz = p.blitz;
  const bPlaced = bz && bz.games >= PLACEMENT_GAMES;
  const bRank = bPlaced ? RANKS[rankIndexFor(bz.rating)] : null;
  const tile = (k, v, c) => (
    <div style={{ background: "rgba(10,8,24,.34)", padding: `${px(2)} ${px(3)}`, minWidth: 0 }}>
      <div className="tb-t" style={{ color: "rgba(255,255,255,.62)" }}>{k}</div>
      <div className="tb-t tb-b tabular-nums truncate" style={{ color: c || "#fff" }}>{v}</div>
    </div>
  );
  const ladder = (label, r, value, left) => (
    <div className="tb-t flex items-center" style={{ gap: px(2), color: "#fff" }}>
      <span style={{ display: "inline-block", width: px(5), height: px(5), background: r ? r.color : "rgba(255,255,255,.35)", boxShadow: "inset 0 calc(var(--p) * -1) 0 rgba(0,0,0,.3)" }} />
      <span style={{ color: "rgba(255,255,255,.7)" }}>{label}</span>
      <span className="tb-b">{r ? `${r.name} · ${value}` : left}</span>
    </div>
  );
  return (
    <div className="relative w-full" style={{
      // Solid: the player's two colours, a soft light, and the sky's dither over it.
      background: `radial-gradient(70% 90% at 18% 20%, rgba(255,255,255,.16), transparent 60%), radial-gradient(60% 80% at 85% 90%, rgba(0,0,0,.25), transparent 70%), linear-gradient(115deg, ${a}, ${b})`,
      boxShadow: `inset 0 ${px(1)} 0 rgba(255,255,255,.35), inset 0 ${px(-1)} 0 rgba(0,0,0,.35)`,
      padding: compact ? px(4) : px(6), overflow: "hidden",
    }}>
      <div aria-hidden="true" className="absolute inset-0 pointer-events-none" style={{ opacity: 0.22,
        background: `repeating-conic-gradient(rgba(0,0,0,.5) 0 25%, transparent 0 50%) 0 0 / ${px(2)} ${px(2)}`,
        maskImage: "linear-gradient(180deg, transparent 0%, black 100%)", WebkitMaskImage: "linear-gradient(180deg, transparent 0%, black 100%)" }} />
      <div className="relative flex flex-wrap items-center" style={{ gap: compact ? px(4) : px(6) }}>
        <Avatar name={p.name} size={compact ? 64 : 96} ring="rgba(255,255,255,.55)" />
        <div className="flex flex-col min-w-0" style={{ gap: px(2), flex: "1 1 160px" }}>
          <span className="truncate" style={{ fontFamily: '"Silkscreen", monospace', fontWeight: 700, fontSize: px(compact ? 13 : 16), lineHeight: 1, color: "#fff",
            textShadow: `${px(1)} ${px(1)} 0 rgba(0,0,0,.45)` }}>{p.name}</span>
          {p.joined && <span className="tb-t" style={{ color: "rgba(255,255,255,.65)" }}>JOINED {new Date(p.joined).toLocaleDateString(undefined, { year: "numeric", month: "short" }).toUpperCase()}</span>}
          {ladder("CONTROL", control?.rank, control?.value, p.placementLeft != null ? `${PLACEMENT_GAMES - p.placementLeft}/${PLACEMENT_GAMES} placement` : "unranked")}
          {ladder("BLITZ", bRank, bz?.rating, bz ? `${Math.min(bz.games, PLACEMENT_GAMES)}/${PLACEMENT_GAMES} placement` : "unranked")}
        </div>
        <div className="grid" style={{ gridTemplateColumns: `repeat(${compact ? 3 : 4}, minmax(0, 1fr))`, gap: px(1), flex: "2 1 300px" }}>
          {tile("BLITZ", bz ? `${bz.rating}${bz.rd != null ? ` ±${bz.rd}` : ""}` : "—", bRank?.color)}
          {tile("PPS", bz?.pps != null ? bz.pps.toFixed(2) : "—")}
          {tile("APM", bz?.apm != null ? bz.apm.toFixed(1) : "—")}
          {tile("VS", bz?.vs != null ? bz.vs.toFixed(1) : "—")}
          {tile("SPRINT", p.sprint ? clock(p.sprint.best) : "—")}
          {tile("ULTRA", p.ultra ? p.ultra.best.toLocaleString("en-US") : "—")}
          {tile("MARATHON", p.marathon ? p.marathon.best.toLocaleString("en-US") : "—")}
          {tile("CONTROL", p.tr != null ? `${p.tr}` : "—", control?.rank?.color)}
        </div>
      </div>
      {children && <div className="relative" style={{ marginTop: px(4) }}>{children}</div>}
    </div>
  );
}

