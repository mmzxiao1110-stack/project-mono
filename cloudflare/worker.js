/**
 * Tesella on Cloudflare.
 *
 *   /ws, /api/*   → the game (one Durable Object, see game.js)
 *   terminal.* hosts, at their root → T-Terminal's page
 *   /music/*      → the song, in byte ranges (so a song can start mid-track)
 *   /.well-known/assetlinks.json → proves the Android app is ours (no browser bar in it)
 *   /, /terminal  → the page, with its link-preview URLs made absolute
 *   everything else is the built site (dist/), served by Cloudflare's static
 *   assets without running this code at all.
 */
/* global HTMLRewriter -- a Workers runtime global */
export { Game } from "./game.js";
import assetLinks from "../public/.well-known/assetlinks.json";

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (url.pathname === "/ws" || url.pathname.startsWith("/api/")) {
      return env.GAME.get(env.GAME.idFromName("world")).fetch(req);
    }
    // terminal.tesella.io (or any terminal.* host) opens T-Terminal at its root.
    if (url.pathname === "/" && url.hostname.startsWith("terminal.")) {
      return withLinkCard(await env.ASSETS.fetch(new Request(new URL("/terminal", url), req)), url);
    }
    if (url.pathname === "/" || url.pathname === "/terminal") return withLinkCard(await env.ASSETS.fetch(req), url);
    if (url.pathname.startsWith("/music/")) return ranged(req, env);
    // Served from here, not left to static assets: a dot-folder may be skipped on upload.
    if (url.pathname === "/.well-known/assetlinks.json") {
      return new Response(JSON.stringify(assetLinks), { headers: { "content-type": "application/json", "cache-control": "public, max-age=300", "access-control-allow-origin": "*" } });
    }
    return env.ASSETS.fetch(req);
  },
};

/**
 * A shared link's preview card: link previewers (Discord, iMessage, WhatsApp,
 * X...) want absolute URLs, so the page's og:image / og:url / twitter:image
 * are filled in with whatever host the page was served from.
 */
function withLinkCard(res, url) {
  if (!res.ok || !(res.headers.get("content-type") || "").includes("text/html")) return res;
  const abs = (attr) => ({ element(el) { const v = el.getAttribute(attr); if (v && v.startsWith("/")) el.setAttribute(attr, new URL(v, url.origin).href); } });
  return new HTMLRewriter()
    .on('meta[property="og:image"]', abs("content"))
    .on('meta[name="twitter:image"]', abs("content"))
    .on('meta[property="og:url"]', { element(el) { el.setAttribute("content", url.origin + url.pathname); } })
    .transform(res);
}

/**
 * Static assets answer a Range request with the whole file; the music player
 * needs the part it asked for (206), or it can't start a song from its middle.
 */
async function ranged(req, env) {
  const res = await env.ASSETS.fetch(new Request(req.url, { method: "GET" }));
  const m = /^bytes=(\d*)-(\d*)$/.exec(req.headers.get("range") || "");
  if (!res.ok || !m || (m[1] === "" && m[2] === "")) {
    const h = new Headers(res.headers);
    h.set("accept-ranges", "bytes");
    return new Response(req.method === "HEAD" ? null : res.body, { status: res.status, headers: h });
  }
  const buf = await res.arrayBuffer();
  const size = buf.byteLength;
  let start = m[1] === "" ? size - Number(m[2]) : Number(m[1]);
  let end = m[1] !== "" && m[2] !== "" ? Number(m[2]) : size - 1;
  start = Math.max(0, start); end = Math.min(size - 1, end);
  if (!(start <= end)) return new Response(null, { status: 416, headers: { "content-range": `bytes */${size}` } });
  const h = new Headers(res.headers);
  h.set("accept-ranges", "bytes");
  h.set("content-range", `bytes ${start}-${end}/${size}`);
  h.set("content-length", String(end - start + 1));
  h.set("cache-control", "public, max-age=86400");
  return new Response(req.method === "HEAD" ? null : buf.slice(start, end + 1), { status: 206, headers: h });
}
