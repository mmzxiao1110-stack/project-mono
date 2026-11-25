/**
 * The public read-only API behind T-Terminal and the in-game profile popups.
 *
 *   GET /api/overview            players, ranked players, online now, rank spread, top 5
 *   GET /api/leaderboard?page=1  ranked players by TR, 50 a page
 *   GET /api/search?q=name       up to 20 players whose name contains q
 *   GET /api/player/NAME         one player's public profile
 *
 * Only public things go out: names, ratings, stats, recent results. Never an
 * email, an account id or anything about sign-in. Players who haven't
 * verified their email (and so can't play ranked) aren't listed.
 */
import { allProfiles, getAccount } from "./store.js";
import { Limiter, clientIp } from "./limits.js";
import { RANKS, PLACEMENT_GAMES, rankIndexFor } from "../shared/glicko.js";

const apiLimit = new Limiter({ burst: 60, perMinute: 120 });
const PAGE = 50;
const CACHE_MS = 15_000;

let onlineNow = () => null;
/** index.js tells us how to count who's connected. */
export const setOnlineCounter = (fn) => { onlineNow = fn; };

const tr = (p) => Math.round(p.rating?.r ?? 1500);
const placed = (p) => (p.stats?.games || 0) >= PLACEMENT_GAMES;

// The sorted ladder, rebuilt at most every few seconds.
let cache = { at: 0, listed: [], ladder: [], pos: new Map(), byName: new Map() };
function ladder() {
  if (Date.now() - cache.at < CACHE_MS) return cache;
  const listed = allProfiles().filter((p) => {
    const acct = getAccount(p.playerId);
    return acct && acct.emailVerified;
  });
  const ladderList = listed.filter(placed).sort((a, b) => tr(b) - tr(a) || (a.rating.rd - b.rating.rd));
  const pos = new Map(ladderList.map((p, i) => [p.playerId, i + 1]));
  const byName = new Map(listed.map((p) => [p.name.toLowerCase(), p]));
  cache = { at: Date.now(), listed, ladder: ladderList, pos, byName };
  return cache;
}

/** A row in a list. */
function row(p, c) {
  const st = p.stats || {};
  const isPlaced = placed(p);
  return {
    name: p.name,
    tr: isPlaced ? tr(p) : null,
    rank: isPlaced ? RANKS[rankIndexFor(tr(p))].name : null,
    position: c.pos.get(p.playerId) || null,
    games: st.games || 0,
    wins: st.wins || 0,
  };
}

/** Everything public about one player. */
function card(p, c) {
  const st = p.stats || {};
  const isPlaced = placed(p);
  return {
    ...row(p, c),
    rd: Math.round(p.rating?.rd ?? 350),
    placementLeft: isPlaced ? 0 : PLACEMENT_GAMES - (st.games || 0),
    losses: st.losses || 0,
    draws: Math.max(0, (st.games || 0) - (st.wins || 0) - (st.losses || 0)),
    streak: st.streak || 0,
    bestStreak: st.bestStreak || 0,
    peakTr: isPlaced ? Math.round(st.peakTr || tr(p)) : null,
    peakRank: isPlaced && st.peakRank != null ? RANKS[st.peakRank]?.name || null : null,
    seconds: Math.round(st.seconds || 0),
    history: (st.history || []).map((x) => Math.round(x)),
    recent: (st.recent || []).map((m) => ({
      name: m.name, won: !!m.won, drew: !!m.drew, delta: m.delta ?? 0, score: m.score || null, seconds: m.seconds || 0, at: m.at || null,
    })),
    joined: p.createdAt || null,
  };
}

function reply(res, code, body) {
  res.writeHead(code, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "public, max-age=10",
    // Public data: other sites (and the dev server) may read it.
    "access-control-allow-origin": "*",
    "x-content-type-options": "nosniff",
  });
  res.end(JSON.stringify(body));
}

/** Answers /api/… requests; returns false for anything else. */
export function apiHandler(req, res) {
  const url = new URL(req.url || "/", "http://x");
  if (!url.pathname.startsWith("/api/")) return false;
  if (req.method !== "GET" && req.method !== "HEAD") { reply(res, 405, { error: "read only" }); return true; }
  if (!apiLimit.take(clientIp(req))) { reply(res, 429, { error: "slow down" }); return true; }
  const c = ladder();
  const parts = url.pathname.split("/").filter(Boolean); // ["api", ...]

  if (parts[1] === "overview") {
    const spread = RANKS.map((r) => ({ rank: r.name, color: r.color, players: 0 }));
    for (const p of c.ladder) spread[rankIndexFor(tr(p))].players++;
    reply(res, 200, {
      players: c.listed.length, ranked: c.ladder.length, online: onlineNow(),
      spread, top: c.ladder.slice(0, 5).map((p) => row(p, c)),
    });
    return true;
  }
  if (parts[1] === "leaderboard") {
    const page = Math.max(1, Math.min(10_000, Number(url.searchParams.get("page")) || 1));
    const slice = c.ladder.slice((page - 1) * PAGE, page * PAGE);
    reply(res, 200, { page, pages: Math.max(1, Math.ceil(c.ladder.length / PAGE)), total: c.ladder.length, players: slice.map((p) => row(p, c)) });
    return true;
  }
  if (parts[1] === "search") {
    const q = String(url.searchParams.get("q") || "").trim().toLowerCase().slice(0, 32);
    if (!q) { reply(res, 200, { players: [] }); return true; }
    const hits = c.listed.filter((p) => p.name.toLowerCase().includes(q));
    hits.sort((a, b) => (b.name.toLowerCase().startsWith(q) - a.name.toLowerCase().startsWith(q)) || tr(b) - tr(a));
    reply(res, 200, { players: hits.slice(0, 20).map((p) => row(p, c)) });
    return true;
  }
  if (parts[1] === "player" && parts[2]) {
    let name = "";
    try { name = decodeURIComponent(parts[2]).slice(0, 32).toLowerCase(); } catch { /* bad escape */ }
    const p = c.byName.get(name);
    if (!p) { reply(res, 404, { error: "No player by that name." }); return true; }
    reply(res, 200, card(p, c));
    return true;
  }
  reply(res, 404, { error: "Unknown endpoint." });
  return true;
}
