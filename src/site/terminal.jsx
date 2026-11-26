/**
 * T-TERMINAL — Tesella's player hub, in blue. Like a stats channel:
 *   #/                 overview: players, online now, rank spread, top players, search
 *   #/rankings/2       the ranked ladder, 50 a page
 *   #/search/name      players whose name contains it
 *   #/player/name      one player's record
 *   #/marathon/2       Marathon high scores
 *   #/sprint/1         Sprint: fastest 40 lines
 *   #/ultra/1          Ultra: highest 2-minute scores
 * Reads the server's public API (server/api.js).
 */
import { useEffect, useState } from "react";
import { SiteShell, PixelWord, Panel, glass, glassFill } from "./kit.jsx";
import { RANKS, PLACEMENT_GAMES } from "../../shared/glicko.js";
import { VERSION_LABEL } from "../version.js";
import { apiGet, rankColor, timeAgo, playtime } from "./api.js";
import { ProfileCard } from "./profileCard.jsx";
import { RankIcon } from "./rankIcon.jsx";

const px = (n) => `calc(var(--p) * ${n})`;

function useHash() {
  const [h, setH] = useState(() => location.hash.slice(1) || "/");
  useEffect(() => { const on = () => { setH(location.hash.slice(1) || "/"); window.scrollTo(0, 0); }; window.addEventListener("hashchange", on); return () => window.removeEventListener("hashchange", on); }, []);
  return h;
}

/** Fetches `path` from the API: { data, error, loading }. */
function useApi(path) {
  const [st, setSt] = useState({ data: null, error: null, loading: true, path: null });
  useEffect(() => {
    let live = true;
    apiGet(path).then((data) => live && setSt({ data, error: null, loading: false, path }))
      .catch((e) => live && setSt({ data: null, error: e.message, loading: false, path }));
    return () => { live = false; };
  }, [path]);
  return st.path === path ? st : { data: null, error: null, loading: true };
}

const Status = ({ st }) => (st.loading ? <div className="tb-t tb-pulse text-center" style={{ color: "var(--tb-dim)", padding: px(10) }}>LOADING…</div>
  : st.error ? <div className="tb-t text-center" style={{ color: "var(--tb-bad)", padding: px(10) }}>{st.error}</div> : null);

/** A rank as a little badge in its colour. */
export function RankBadge({ rank }) {
  if (!rank) return <span className="tb-t" style={{ color: "var(--tb-dim)" }}>—</span>;
  const c = rankColor(rank);
  return (
    <span className="tb-t tb-b inline-flex items-center" style={{ gap: px(1), color: c }}>
      <RankIcon rank={rank} size={`calc(var(--p) * 14)`} />{rank}
    </span>
  );
}

const playerHref = (name) => `#/player/${encodeURIComponent(name)}`;

function SearchBox({ initial = "" }) {
  const [q, setQ] = useState(initial);
  return (
    <form className="flex w-full" style={{ gap: px(2) }} onSubmit={(e) => { e.preventDefault(); if (q.trim()) location.hash = `#/search/${encodeURIComponent(q.trim())}`; }}>
      <input value={q} onChange={(e) => setQ(e.target.value)} maxLength={32} placeholder="search a player…" aria-label="Search players"
        className="tb-t flex-1 min-w-0" style={{ height: px(18), padding: `0 ${px(4)}`, color: "var(--tb-text)", ...glass(), outline: "none", fontFamily: "inherit" }} />
      <button className="tb-t" style={{ height: px(18), padding: `0 ${px(6)}`, color: "var(--tb-text)", ...glassFill("var(--tb-you)") }}>SEARCH</button>
    </form>
  );
}

/** A table of players: position, name, rank, TR, games, win rate. */
function PlayerTable({ players, showPos = true }) {
  if (!players.length) return <div className="tb-t text-center" style={{ color: "var(--tb-dim)", padding: px(6) }}>NOBODY HERE YET</div>;
  return (
    <div className="flex flex-col" style={{ gap: px(1) }}>
      <div className="tb-t grid" style={{ gridTemplateColumns: showPos ? "3.2em 1fr 3.5em 4em 3.6em" : "1fr 3.5em 4em 3.6em", gap: px(2), color: "var(--tb-dim)", padding: `0 ${px(3)}` }}>
        {showPos && <span>#</span>}<span>PLAYER</span><span>RANK</span><span className="text-right">TR</span><span className="text-right">WIN%</span>
      </div>
      {players.map((p, i) => (
        <a key={p.name} href={playerHref(p.name)} className="tb-t grid items-center no-underline"
          style={{ gridTemplateColumns: showPos ? "3.2em 1fr 3.5em 4em 3.6em" : "1fr 3.5em 4em 3.6em", gap: px(2), padding: `${px(2)} ${px(3)}`, color: "var(--tb-text)",
            background: i % 2 ? "transparent" : "color-mix(in srgb, var(--tb-text) 5%, transparent)" }}>
          {showPos && <span style={{ color: p.position && p.position <= 3 ? "var(--tb-special)" : "var(--tb-dim)" }}>{p.position ?? "—"}</span>}
          <span className="truncate">{p.name}</span>
          <span><RankBadge rank={p.rank} /></span>
          <span className="text-right tabular-nums">{p.tr ?? "—"}</span>
          <span className="text-right tabular-nums" style={{ color: "var(--tb-dim)" }}>{p.games ? Math.round((100 * p.wins) / p.games) : 0}</span>
        </a>
      ))}
    </div>
  );
}

const clock = (ms) => `${Math.floor(ms / 60000)}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, "0")}.${String(Math.floor((ms % 1000) / 10)).padStart(2, "0")}`;
const BOARDS = {
  blitz: { title: "BLITZ 1V1 · RATING", head: ["RATING", "W / G"], value: (p) => p.best, extra: (p) => `${p.wins}/${p.games}` },
  marathon: { title: "MARATHON HIGH SCORES", head: ["SCORE", "LINES"], value: (p) => p.best.toLocaleString("en-US"), extra: (p) => p.lines },
  sprint: { title: "SPRINT · 40 LINES", head: ["TIME", "PIECES"], value: (p) => clock(p.best), extra: (p) => p.pieces ?? "—" },
  ultra: { title: "ULTRA · 2 MINUTES", head: ["SCORE", "LINES"], value: (p) => p.best.toLocaleString("en-US"), extra: (p) => p.lines ?? "—" },
};

/** A records table: position, name, the record, and one more number. */
function ScoreTable({ players, kind = "marathon" }) {
  const B = BOARDS[kind];
  if (!players.length) return <div className="tb-t text-center" style={{ color: "var(--tb-dim)", padding: px(6) }}>NO SCORES YET</div>;
  const cols = "3.2em 1fr 6em 3.6em";
  return (
    <div className="flex flex-col" style={{ gap: px(1) }}>
      <div className="tb-t grid" style={{ gridTemplateColumns: cols, gap: px(2), color: "var(--tb-dim)", padding: `0 ${px(3)}` }}>
        <span>#</span><span>PLAYER</span><span className="text-right">{B.head[0]}</span><span className="text-right">{B.head[1]}</span>
      </div>
      {players.map((p, i) => (
        <a key={p.name} href={playerHref(p.name)} className="tb-t grid items-center no-underline"
          style={{ gridTemplateColumns: cols, gap: px(2), padding: `${px(2)} ${px(3)}`, color: "var(--tb-text)",
            background: i % 2 ? "transparent" : "color-mix(in srgb, var(--tb-text) 5%, transparent)" }}>
          <span style={{ color: p.position <= 3 ? "var(--tb-special)" : "var(--tb-dim)" }}>{p.position}</span>
          <span className="truncate">{p.name}</span>
          <span className="text-right tabular-nums" style={{ color: "var(--tb-special)" }}>{B.value(p)}</span>
          <span className="text-right tabular-nums" style={{ color: "var(--tb-dim)" }}>{B.extra(p)}</span>
        </a>
      ))}
    </div>
  );
}

function RecordBoard({ kind, page }) {
  const st = useApi(`/api/${kind}?page=${page}`);
  const d = st.data;
  const nav = (n) => { location.hash = `#/${kind}/${n}`; };
  return (
    <Panel>
      <div className="flex justify-between items-baseline" style={{ marginBottom: px(4) }}>
        <span className="tb-t tb-b" style={{ color: "var(--tb-you)" }}>{BOARDS[kind].title}</span>
        {d && <span className="tb-t" style={{ color: "var(--tb-dim)" }}>{d.total} PLAYERS</span>}
      </div>
      <Status st={st} />
      {d && <ScoreTable players={d.players} kind={kind} />}
      {d && d.pages > 1 && (
        <div className="flex justify-center items-center tb-t" style={{ gap: px(4), marginTop: px(5) }}>
          <button disabled={page <= 1} onClick={() => nav(page - 1)} className="tb-t disabled:opacity-30" style={{ height: px(14), padding: `0 ${px(4)}`, color: "var(--tb-text)", ...glass() }}>‹ PREV</button>
          <span style={{ color: "var(--tb-dim)" }}>{page} / {d.pages}</span>
          <button disabled={page >= d.pages} onClick={() => nav(page + 1)} className="tb-t disabled:opacity-30" style={{ height: px(14), padding: `0 ${px(4)}`, color: "var(--tb-text)", ...glass() }}>NEXT ›</button>
        </div>
      )}
      <div className="tb-t text-center" style={{ color: "var(--tb-dim)", marginTop: px(4) }}>Every score is checked by replaying the game on the server.</div>
    </Panel>
  );
}

/* ------------------------------------------------------------------ */

function Home() {
  const st = useApi("/api/overview");
  const o = st.data;
  const maxN = o ? Math.max(1, ...o.spread.map((s) => s.players)) : 1;
  return (
    <div className="flex flex-col" style={{ gap: px(5) }}>
      <SearchBox />
      <Status st={st} />
      {o && (
        <>
          <div className="grid grid-cols-3" style={{ gap: px(3) }}>
            {[["PLAYERS", o.players], ["RANKED", o.ranked], ["ONLINE", o.online ?? "—"]].map(([k, v]) => (
              <Panel key={k} style={{ padding: px(4), textAlign: "center" }}>
                <div className="tb-t" style={{ color: "var(--tb-dim)" }}>{k}</div>
                <div className="tb-t tb-b tabular-nums" style={{ color: k === "ONLINE" ? "var(--tb-special)" : "var(--tb-text)" }}>{v}</div>
              </Panel>
            ))}
          </div>
          <Panel>
            <div className="flex justify-between items-baseline" style={{ marginBottom: px(4) }}>
              <span className="tb-t tb-b" style={{ color: "var(--tb-you)" }}>TOP PLAYERS</span>
              <a href="#/rankings/1" className="tb-t" style={{ color: "var(--tb-you)" }}>ALL RANKINGS ›</a>
            </div>
            <PlayerTable players={o.top} />
          </Panel>
          {["blitz", "sprint", "ultra", "marathon"].map((k) => (
            <Panel key={k}>
              <div className="flex justify-between items-baseline" style={{ marginBottom: px(4) }}>
                <span className="tb-t tb-b" style={{ color: "var(--tb-you)" }}>{BOARDS[k].title}</span>
                <a href={`#/${k}/1`} className="tb-t" style={{ color: "var(--tb-you)" }}>ALL ›</a>
              </div>
              <ScoreTable players={o[k] || []} kind={k} />
            </Panel>
          ))}
          <Panel>
            <div className="tb-t tb-b" style={{ color: "var(--tb-you)", marginBottom: px(4) }}>RANK SPREAD</div>
            {/* One pixel bar per rank, F to X. */}
            <div className="flex items-end" style={{ gap: px(2), height: px(40) }}>
              {o.spread.map((s) => (
                <div key={s.rank} className="flex-1 flex flex-col items-center justify-end h-full" title={`${s.rank}: ${s.players}`}>
                  <span className="tb-t tabular-nums" style={{ color: "var(--tb-dim)" }}>{s.players || ""}</span>
                  <div style={{ width: "100%", height: `calc(var(--p) * ${Math.max(1, Math.round((s.players / maxN) * 26))})`, background: s.color, boxShadow: `inset 0 var(--p) 0 rgba(255,255,255,.4)` }} />
                </div>
              ))}
            </div>
            <div className="flex" style={{ gap: px(2), marginTop: px(2) }}>
              {o.spread.map((s) => <span key={s.rank} className="flex-1 text-center tb-t" style={{ color: s.color }}>{s.rank}</span>)}
            </div>
          </Panel>
        </>
      )}
    </div>
  );
}

function Rankings({ page }) {
  const st = useApi(`/api/leaderboard?page=${page}`);
  const d = st.data;
  const nav = (n) => { location.hash = `#/rankings/${n}`; };
  return (
    <Panel>
      <div className="flex justify-between items-baseline" style={{ marginBottom: px(4) }}>
        <span className="tb-t tb-b" style={{ color: "var(--tb-you)" }}>RANKINGS</span>
        {d && <span className="tb-t" style={{ color: "var(--tb-dim)" }}>{d.total} RANKED</span>}
      </div>
      <Status st={st} />
      {d && <PlayerTable players={d.players} />}
      {d && d.pages > 1 && (
        <div className="flex justify-center items-center tb-t" style={{ gap: px(4), marginTop: px(5) }}>
          <button disabled={page <= 1} onClick={() => nav(page - 1)} className="tb-t disabled:opacity-30" style={{ height: px(14), padding: `0 ${px(4)}`, color: "var(--tb-text)", ...glass() }}>‹ PREV</button>
          <span style={{ color: "var(--tb-dim)" }}>{page} / {d.pages}</span>
          <button disabled={page >= d.pages} onClick={() => nav(page + 1)} className="tb-t disabled:opacity-30" style={{ height: px(14), padding: `0 ${px(4)}`, color: "var(--tb-text)", ...glass() }}>NEXT ›</button>
        </div>
      )}
      <div className="tb-t text-center" style={{ color: "var(--tb-dim)", marginTop: px(4) }}>Players appear after {PLACEMENT_GAMES} ranked games.</div>
    </Panel>
  );
}

function Search({ q }) {
  const st = useApi(`/api/search?q=${encodeURIComponent(q)}`);
  return (
    <div className="flex flex-col" style={{ gap: px(5) }}>
      <SearchBox initial={q} />
      <Panel>
        <div className="tb-t tb-b" style={{ color: "var(--tb-you)", marginBottom: px(4) }}>RESULTS FOR “{q.toUpperCase()}”</div>
        <Status st={st} />
        {st.data && <PlayerTable players={st.data.players} />}
      </Panel>
    </div>
  );
}

/** TR over the last games: a column of pixels per game. */
export function HistoryBars({ history }) {
  if (!history || history.length < 2) return <div className="tb-t" style={{ color: "var(--tb-dim)" }}>Not enough ranked games yet.</div>;
  const lo = Math.min(...history) - 20, hi = Math.max(...history) + 20;
  const H = 30;
  return (
    <svg viewBox={`0 0 ${history.length * 3} ${H}`} preserveAspectRatio="none" style={{ width: "100%", height: px(H), shapeRendering: "crispEdges", display: "block" }}>
      {history.map((v, i) => {
        const h = Math.max(1, Math.round(((v - lo) / (hi - lo)) * H));
        const up = i === 0 || v >= history[i - 1];
        return (
          <g key={i}>
            <rect x={i * 3} y={H - h} width={2} height={h} style={{ fill: `color-mix(in srgb, ${up ? "var(--tb-you)" : "var(--tb-dim)"} 55%, transparent)` }} />
            <rect x={i * 3} y={H - h} width={2} height={1} style={{ fill: up ? "var(--tb-special)" : "var(--tb-bad)" }} />
          </g>
        );
      })}
    </svg>
  );
}

/** The record card. Shared by T-Terminal's player page and the game's profile popup. */
export function PlayerRecord({ p, onOpen }) {
  const winRate = p.games ? Math.round((100 * p.wins) / p.games) : 0;
  const cell = (k, v, c) => (
    <div style={{ ...glass(), padding: px(3) }}>
      <div className="tb-t" style={{ color: "var(--tb-dim)" }}>{k}</div>
      <div className="tb-t tb-b tabular-nums" style={{ color: c || "var(--tb-text)" }}>{v}</div>
    </div>
  );
  return (
    <div className="flex flex-col" style={{ gap: px(4) }}>
      <div className="flex items-center justify-between flex-wrap" style={{ gap: px(3) }}>
        <div className="flex items-center" style={{ gap: px(3) }}>
          <RankBadge rank={p.rank} />
          <span className="tb-t tb-b" style={{ color: "var(--tb-text)" }}>{p.name}</span>
        </div>
        <span className="tb-t tabular-nums" style={{ color: p.rank ? rankColor(p.rank) : "var(--tb-dim)" }}>
          {p.tr != null ? `${p.tr} TR ±${p.rd}` : `PLACEMENT · ${p.placementLeft} TO GO`}
        </span>
      </div>
      <div className="grid grid-cols-3" style={{ gap: px(2) }}>
        {cell("POSITION", p.position ? `#${p.position}` : "—", "var(--tb-special)")}
        {cell("GAMES", p.games)}
        {cell("WIN RATE", `${winRate}%`)}
        {cell("W / L / D", `${p.wins}/${p.losses}/${p.draws}`)}
        {cell("BEST STREAK", p.bestStreak)}
        {cell("PEAK", p.peakTr != null ? `${p.peakTr}${p.peakRank ? ` ${p.peakRank}` : ""}` : "—")}
      </div>
      {p.blitz && (
        <div className="grid grid-cols-4" style={{ gap: px(2) }}>
          {cell("BLITZ GLICKO", `${p.blitz.rating}${p.blitz.rd != null ? ` ±${p.blitz.rd}` : ""}`, "var(--tb-special)")}
          {cell("BLITZ #", p.blitz.position ? `#${p.blitz.position}` : "—")}
          {cell("BLITZ W / G", `${p.blitz.wins}/${p.blitz.games}`)}
          {cell("WIN RATE", `${p.blitz.games ? Math.round((100 * p.blitz.wins) / p.blitz.games) : 0}%`)}
          {cell("PPS", p.blitz.pps != null ? p.blitz.pps.toFixed(2) : "—")}
          {cell("APM", p.blitz.apm != null ? p.blitz.apm.toFixed(1) : "—")}
          {cell("VS", p.blitz.vs != null ? p.blitz.vs.toFixed(1) : "—")}
          {cell("BEST ATTACK", p.blitz.best ? `${p.blitz.best} lv` : "—")}
        </div>
      )}
      {(p.sprint || p.ultra) && (
        <div className="grid grid-cols-2" style={{ gap: px(2) }}>
          {cell("SPRINT BEST", p.sprint ? `${clock(p.sprint.best)}${p.sprint.position ? ` · #${p.sprint.position}` : ""}` : "—", "var(--tb-special)")}
          {cell("ULTRA BEST", p.ultra ? `${p.ultra.best.toLocaleString("en-US")}${p.ultra.position ? ` · #${p.ultra.position}` : ""}` : "—", "var(--tb-special)")}
        </div>
      )}
      {p.marathon && (
        <div className="grid grid-cols-3" style={{ gap: px(2) }}>
          {cell("MARATHON BEST", p.marathon.best.toLocaleString("en-US"), "var(--tb-special)")}
          {cell("MARATHON #", p.marathon.position ? `#${p.marathon.position}` : "—")}
          {cell("LINES", p.marathon.lines)}
        </div>
      )}
      <div>
        <div className="tb-t" style={{ color: "var(--tb-dim)", marginBottom: px(2) }}>TR, LAST {Math.min(40, p.history.length)} GAMES</div>
        <HistoryBars history={p.history} />
      </div>
      <div>
        <div className="tb-t" style={{ color: "var(--tb-dim)", marginBottom: px(2) }}>RECENT MATCHES</div>
        {!p.recent.length && <div className="tb-t" style={{ color: "var(--tb-dim)" }}>None yet.</div>}
        <div className="flex flex-col" style={{ gap: px(1) }}>
          {p.recent.map((m, i) => (
            <div key={i} className="tb-t grid items-center" style={{ gridTemplateColumns: "2.2em 1fr auto auto", gap: px(3), padding: `${px(1)} ${px(2)}`, background: i % 2 ? "transparent" : "color-mix(in srgb, var(--tb-text) 5%, transparent)" }}>
              <span className="tb-b" style={{ color: m.drew ? "var(--tb-dim)" : m.won ? "var(--tb-good)" : "var(--tb-bad)" }}>{m.drew ? "D" : m.won ? "W" : "L"}</span>
              {onOpen ? <button onClick={() => onOpen(m.name)} className="tb-t text-left truncate" style={{ color: "var(--tb-text)", background: "none", border: "none", padding: 0 }}>vs {m.name}</button>
                : <a href={playerHref(m.name)} className="truncate" style={{ color: "var(--tb-text)" }}>vs {m.name}</a>}
              <span className="tabular-nums" style={{ color: "var(--tb-dim)" }}>{m.score ? `${m.score[0]}–${m.score[1]}` : ""} {m.at ? `· ${timeAgo(m.at)}` : ""}</span>
              <span className="tabular-nums text-right" style={{ color: m.delta >= 0 ? "var(--tb-good)" : "var(--tb-bad)", minWidth: "3em" }}>{m.delta >= 0 ? "+" : ""}{m.delta}</span>
            </div>
          ))}
        </div>
      </div>
      <div className="tb-t flex flex-wrap justify-between" style={{ color: "var(--tb-dim)", gap: px(3) }}>
        <span>PLAYED {playtime(p.seconds)}</span>
        {p.joined && <span>JOINED {new Date(p.joined).toLocaleDateString(undefined, { year: "numeric", month: "short" }).toUpperCase()}</span>}
      </div>
    </div>
  );
}

function Player({ name }) {
  const st = useApi(`/api/player/${encodeURIComponent(name)}`);
  return (
    <div className="flex flex-col" style={{ gap: px(5) }}>
      <SearchBox />
      <Panel color={st.data?.rank ? rankColor(st.data.rank) : undefined}>
        <Status st={st} />
        {st.data && <ProfileCard p={st.data} compact />}
        {st.data && <PlayerRecord p={st.data} />}
      </Panel>
    </div>
  );
}

export default function Terminal() {
  const h = useHash();
  const [, route, arg = ""] = h.split("/");
  let arg2 = arg;
  try { arg2 = decodeURIComponent(arg); } catch { /* keep raw */ }
  useEffect(() => { document.title = route === "player" && arg2 ? `${arg2} · T-Terminal` : "T-Terminal · Tesella"; }, [route, arg2]);
  return (
    <SiteShell page="terminal">
      <a href="#/" className="no-underline flex flex-col items-center" style={{ gap: px(2), marginBottom: px(8) }}>
        <div className="flex items-end" style={{ gap: px(3) }}>
          <PixelWord text="T-TERMINAL" from="#A8CBFF" to="#3D6FD6" />
          <span className="tb-t" style={{ color: "var(--tb-dim)", opacity: 0.6 }}>{VERSION_LABEL}</span>
        </div>
        <span className="tb-t" style={{ color: "var(--tb-dim)" }}>PLAYERS · RANKINGS · RECORDS</span>
      </a>
      <div className="flex justify-center" style={{ gap: px(2), marginBottom: px(5) }}>
        {[["#/", "OVERVIEW", ""], ["#/blitz/1", "BLITZ", "blitz"], ["#/rankings/1", "CONTROL", "rankings"], ["#/sprint/1", "SPRINT", "sprint"], ["#/ultra/1", "ULTRA", "ultra"], ["#/marathon/1", "MARATHON", "marathon"]].map(([href, label, r]) => (
          <a key={label} href={href} className="tb-t no-underline flex items-center" style={{ height: px(14), padding: `0 ${px(4)}`, color: "var(--tb-text)",
            ...((route || "") === r || (!route && r === "") ? glassFill("var(--tb-you)") : glass()) }}>{label}</a>
        ))}
      </div>
      {route === "rankings" ? <Rankings page={Math.max(1, Number(arg2) || 1)} />
        : route === "marathon" || route === "sprint" || route === "ultra" || route === "blitz" ? <RecordBoard key={route} kind={route} page={Math.max(1, Number(arg2) || 1)} />
        : route === "search" ? <Search q={arg2} />
        : route === "player" ? <Player name={arg2} />
        : <Home />}
      <div className="flex flex-wrap justify-center tb-t" style={{ gap: px(4), marginTop: px(8) }}>
        {RANKS.slice().reverse().map((r) => <span key={r.name} style={{ color: r.color }}>{r.name}</span>)}
      </div>
    </SiteShell>
  );
}
