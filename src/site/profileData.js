import { RANKS, PLACEMENT_GAMES, rankIndexFor } from "../../shared/glicko.js";

/** A profile card's colours when the player hasn't picked their own. */
export const CARD_DEFAULT = ["#2B3D6B", "#6B4C9C"];

/** Your own profile (as the server sends it to you), in /api/player's shape. */
export function cardFromProfile(profile) {
  if (!profile) return null;
  const st = profile.stats || { games: 0 };
  const placed = st.games >= PLACEMENT_GAMES;
  const tr = profile.rating ? Math.round(profile.rating.r) : null;
  const b = profile.blitz;
  return {
    name: profile.name, joined: profile.createdAt || null, card: profile.card || null,
    tr: placed ? tr : null, rank: placed && tr != null ? RANKS[rankIndexFor(tr)].name : null, placementLeft: placed ? null : PLACEMENT_GAMES - (st.games || 0),
    blitz: b?.games ? { rating: Math.round(b.rating.r), rd: Math.round(b.rating.rd), games: b.games, wins: b.wins || 0, pps: b.pps ?? null, apm: b.apm ?? null, vs: b.vs ?? null } : null,
    sprint: profile.sprint?.best ? profile.sprint : null, ultra: profile.ultra?.best ? profile.ultra : null, marathon: profile.marathon?.best ? profile.marathon : null,
  };
}
