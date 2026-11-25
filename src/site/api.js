/** The server's public API, for T-Terminal and the game's profile popups. */
import { RANKS } from "../../shared/glicko.js";

/**
 * Where the API lives: the page's own server in production (one origin),
 * the game server on :8787 next to the Vite dev server, or VITE_SERVER_URL.
 */
export function apiBase() {
  const env = typeof import.meta !== "undefined" ? import.meta.env?.VITE_SERVER_URL : null;
  if (env) return env.replace(/^ws/, "http").replace(/\/$/, "");
  if (typeof location === "undefined") return "";
  return import.meta.env?.DEV ? `${location.protocol}//${location.hostname}:8787` : "";
}

export async function apiGet(path) {
  let res;
  try { res = await fetch(apiBase() + path, { headers: { accept: "application/json" } }); }
  catch { throw new Error("Can't reach the server. Try again in a moment."); }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || (res.status === 429 ? "Too many requests — slow down." : `Server error (${res.status}).`));
  return body;
}

export const rankColor = (name) => RANKS.find((r) => r.name === name)?.color || "var(--tb-dim)";

export function timeAgo(t) {
  const s = Math.max(0, (Date.now() - t) / 1000);
  if (s < 90) return "NOW";
  if (s < 3600) return `${Math.round(s / 60)}M AGO`;
  if (s < 86400) return `${Math.round(s / 3600)}H AGO`;
  return `${Math.round(s / 86400)}D AGO`;
}

export function playtime(sec) {
  const h = Math.floor(sec / 3600), m = Math.round((sec % 3600) / 60);
  return h ? `${h}H ${m}M` : `${m}M`;
}
