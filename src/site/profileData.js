import { RANKS, PLACEMENT_GAMES, rankIndexFor } from "../../shared/glicko.js";

/** Your own profile (as the server sends it to you), in /api/player's shape. */
export function cardFromProfile(profile) {
  if (!profile) return null;
  const st = profile.stats || { games: 0 };
  const placed = st.games >= PLACEMENT_GAMES;
  const tr = profile.rating ? Math.round(profile.rating.r) : null;
  const b = profile.blitz, t = profile.tower;
  return {
    name: profile.name, joined: profile.createdAt || null, card: profile.card || null, played: Math.round(st.seconds || 0),
    tr: placed ? tr : null, rank: placed && tr != null ? RANKS[rankIndexFor(tr)].name : null, placementLeft: placed ? null : PLACEMENT_GAMES - (st.games || 0),
    blitz: b?.games ? { rating: Math.round(b.rating.r), rd: Math.round(b.rating.rd), games: b.games, wins: b.wins || 0, pps: b.pps ?? null, apm: b.apm ?? null, vs: b.vs ?? null } : null,
    tower: t?.games ? { rating: Math.round(t.rating.r), rd: Math.round(t.rating.rd), games: t.games, wins: t.wins || 0, pps: t.pps ?? null, apm: t.apm ?? null } : null,
    games: st.games || 0, wins: st.wins || 0, rd: profile.rating ? Math.round(profile.rating.rd) : null,
    sprint: profile.sprint?.best ? profile.sprint : null, ultra: profile.ultra?.best ? profile.ultra : null, marathon: profile.marathon?.best ? profile.marathon : null,
  };
}
