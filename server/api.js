/**
 * The public read-only API behind T-Terminal and the in-game profile popups.
 *
 *   GET /api/overview            players, ranked players, online now, rank spread, top 5
 *   GET /api/leaderboard?page=1  ranked players by TR, 50 a page
 *   GET /api/search?q=name       up to 20 players whose name contains q
 *   GET /api/player/NAME         one player's public profile
 *   GET /api/marathon?page=1     Marathon high scores, 50 a page
 *   GET /api/blitz?page=1        Blitz 1v1 players by Blitz rating, 50 a page
 *   GET /api/sprint?page=1       Sprint (40 lines) fastest times, 50 a page
 *   GET /api/ultra?page=1        Ultra (2 minutes) high scores, 50 a page
 *   GET /api/run/MODE/NAME       a player's best Sprint or Ultra run (seed + timed moves), to replay
 *
 * Only public things go out: names, ratings, stats, recent results. Never an
 * email, an account id or anything about sign-in. Players who haven't
 * verified their email (and so can't play ranked) aren't listed.
 */
import { allProfiles, getAccount } from "./store.js";
import { Limiter, clientIp } from "./limits.js";
import { RANKS, PLACEMENT_GAMES, rankIndexFor } from "../shared/glicko.js";
import { blitzRates } from "./blitz.js";
import { cleanCard } from "../shared/card.js";

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
  const marathon = listed.filter((p) => p.marathon?.best > 0).sort((a, b) => b.marathon.best - a.marathon.best || (a.marathon.at - b.marathon.at));
  const mpos = new Map(marathon.map((p, i) => [p.playerId, i + 1]));
  // Sprint: fastest first. Ultra: highest first.
  const sprint = listed.filter((p) => p.sprint?.best > 0).sort((a, b) => a.sprint.best - b.sprint.best || (a.sprint.at - b.sprint.at));
  const spos = new Map(sprint.map((p, i) => [p.playerId, i + 1]));
  const ultra = listed.filter((p) => p.ultra?.best > 0).sort((a, b) => b.ultra.best - a.ultra.best || (a.ultra.at - b.ultra.at));
  const upos = new Map(ultra.map((p, i) => [p.playerId, i + 1]));
  // Blitz: by Blitz rating, anyone who has played a Blitz match.
  const blitz = listed.filter((p) => p.blitz?.games > 0 && p.blitz.rating).sort((a, b) => b.blitz.rating.r - a.blitz.rating.r);
  const bpos = new Map(blitz.map((p, i) => [p.playerId, i + 1]));
  cache = { at: Date.now(), listed, ladder: ladderList, pos, byName, marathon, mpos, sprint, spos, ultra, upos, blitz, bpos };
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

const brow = (p, c) => ({ name: p.name, position: c.bpos.get(p.playerId), best: Math.round(p.blitz.rating.r), games: p.blitz.games, wins: p.blitz.wins || 0 });
const srow = (p, c) => ({ name: p.name, position: c.spos.get(p.playerId), best: p.sprint.best, pieces: p.sprint.pieces, at: p.sprint.at || null });
const urow = (p, c) => ({ name: p.name, position: c.upos.get(p.playerId), best: p.ultra.best, lines: p.ultra.lines, at: p.ultra.at || null });

/** A row in the Marathon high scores. */
const mrow = (p, c) => ({ name: p.name, position: c.mpos.get(p.playerId), best: p.marathon.best, lines: p.marathon.lines, at: p.marathon.at || null });

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
    played: Math.round((st.seconds || 0) + (p.blitz?.ms || 0) / 1000),
    card: cleanCard(p.card),
    marathon: p.marathon?.best ? { best: p.marathon.best, lines: p.marathon.lines, games: p.marathon.games, at: p.marathon.at, position: c.mpos.get(p.playerId) || null } : null,
    blitz: p.blitz?.games ? { rating: Math.round(p.blitz.rating.r), rd: Math.round(p.blitz.rating.rd), games: p.blitz.games, wins: p.blitz.wins || 0, position: c.bpos.get(p.playerId) || null, best: p.blitz.best || 0, ...blitzRates(p.blitz) } : null,
    sprint: p.sprint?.best ? { best: p.sprint.best, pieces: p.sprint.pieces, games: p.sprint.games, at: p.sprint.at, position: c.spos.get(p.playerId) || null } : null,
    ultra: p.ultra?.best ? { best: p.ultra.best, lines: p.ultra.lines, games: p.ultra.games, at: p.ultra.at, position: c.upos.get(p.playerId) || null } : null,
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

/**
 * An /api/… request, whatever the host: { status, body }. `url` is a URL,
 * `ip` the caller's address (for the rate limit).
 */
export function apiRoute(method, url, ip) {
  if (method !== "GET" && method !== "HEAD") return { status: 405, body: { error: "read only" } };
  if (!apiLimit.take(ip)) return { status: 429, body: { error: "slow down" } };
  const c = ladder();
  const parts = url.pathname.split("/").filter(Boolean); // ["api", ...]

  if (parts[1] === "overview") {
    const spread = RANKS.map((r) => ({ rank: r.name, color: r.color, players: 0 }));
    for (const p of c.ladder) spread[rankIndexFor(tr(p))].players++;
    return { status: 200, body: {
      players: c.listed.length, ranked: c.ladder.length, online: onlineNow(),
      spread, top: c.ladder.slice(0, 5).map((p) => row(p, c)),
      marathon: c.marathon.slice(0, 5).map((p) => mrow(p, c)),
      blitz: c.blitz.slice(0, 5).map((p) => brow(p, c)),
      sprint: c.sprint.slice(0, 5).map((p) => srow(p, c)),
      ultra: c.ultra.slice(0, 5).map((p) => urow(p, c)),
    } };
  }
  if (parts[1] === "leaderboard") {
    const page = Math.max(1, Math.min(10_000, Number(url.searchParams.get("page")) || 1));
    const slice = c.ladder.slice((page - 1) * PAGE, page * PAGE);
    return { status: 200, body: { page, pages: Math.max(1, Math.ceil(c.ladder.length / PAGE)), total: c.ladder.length, players: slice.map((p) => row(p, c)) } };
  }
  if (parts[1] === "marathon") {
    const page = Math.max(1, Math.min(10_000, Number(url.searchParams.get("page")) || 1));
    const slice = c.marathon.slice((page - 1) * PAGE, page * PAGE);
    return { status: 200, body: { page, pages: Math.max(1, Math.ceil(c.marathon.length / PAGE)), total: c.marathon.length, players: slice.map((p) => mrow(p, c)) } };
  }
  if (parts[1] === "sprint" || parts[1] === "ultra" || parts[1] === "blitz") {
    const list = c[parts[1]], fmt = parts[1] === "sprint" ? srow : parts[1] === "ultra" ? urow : brow;
    const page = Math.max(1, Math.min(10_000, Number(url.searchParams.get("page")) || 1));
    const slice = list.slice((page - 1) * PAGE, page * PAGE);
    return { status: 200, body: { page, pages: Math.max(1, Math.ceil(list.length / PAGE)), total: list.length, players: slice.map((p) => fmt(p, c)) } };
  }
  // A player's best Sprint or Ultra run, to watch: /api/run/sprint/<name>
  if (parts[1] === "run" && (parts[2] === "sprint" || parts[2] === "ultra") && parts[3]) {
    const p = c.byName.get(decodeURIComponent(parts[3]).toLowerCase());
    const rec = p && p[parts[2]];
    if (!rec || !rec.run) return { status: 404, body: { error: "No run." } };
    return { status: 200, body: { name: p.name, mode: parts[2], best: rec.best, at: rec.at, seed: rec.run.seed, moves: rec.run.moves } };
  }
  if (parts[1] === "search") {
    const q = String(url.searchParams.get("q") || "").trim().toLowerCase().slice(0, 32);
    if (!q) { return { status: 200, body: { players: [] } }; }
    const hits = c.listed.filter((p) => p.name.toLowerCase().includes(q));
    hits.sort((a, b) => (b.name.toLowerCase().startsWith(q) - a.name.toLowerCase().startsWith(q)) || tr(b) - tr(a));
    return { status: 200, body: { players: hits.slice(0, 20).map((p) => row(p, c)) } };
  }
  if (parts[1] === "player" && parts[2]) {
    let name = "";
    try { name = decodeURIComponent(parts[2]).slice(0, 32).toLowerCase(); } catch { /* bad escape */ }
    const p = c.byName.get(name);
    if (!p) { return { status: 404, body: { error: "No player by that name." } }; }
    return { status: 200, body: card(p, c) };
  }
  return { status: 404, body: { error: "Unknown endpoint." } };
}

/** Node: answers /api/… requests on a plain http server; returns false for anything else. */
export function apiHandler(req, res) {
  const url = new URL(req.url || "/", "http://x");
  if (!url.pathname.startsWith("/api/")) return false;
  const { status, body } = apiRoute(req.method, url, clientIp(req));
  reply(res, status, body);
  return true;
}
