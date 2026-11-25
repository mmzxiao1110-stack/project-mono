/**
 * Serves the built client from ../dist alongside the WebSocket.
 *
 * One process, one port, one origin — which means the browser upgrades the
 * socket to wss:// automatically wherever the page is served over https://,
 * with no configuration to get wrong.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { clientIp } from "./limits.js";

const DIR = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.resolve(DIR, "..", "dist");

// Sent with every response. No CSP: React's inline styles would need
// 'unsafe-inline' anyway, and these cover the cheap, real risks.
const SECURITY = {
  "x-content-type-options": "nosniff",
  "referrer-policy": "strict-origin-when-cross-origin",
  "x-frame-options": "DENY",
  "permissions-policy": "camera=(), microphone=(), geolocation=()",
};

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".webmanifest": "application/manifest+json",
  ".txt": "text/plain; charset=utf-8",
};

export const hasBuild = () => fs.existsSync(path.join(DIST, "index.html"));

function sendIndex(res, code = 200) {
  fs.readFile(path.join(DIST, "index.html"), (err, html) => {
    if (err) {
      res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      return res.end(
        "No client build found.\n\nRun `npm run build` in the project root, " +
        "or open the Vite dev server on :5173 instead."
      );
    }
    res.writeHead(code, { ...SECURITY, "content-type": TYPES[".html"], "cache-control": "no-cache" });
    res.end(html);
  });
}

export function staticHandler(req, res) {
  let urlPath = (req.url || "/").split("?")[0];
  // Render's health check. Answers without touching the disk.
  if (urlPath === "/healthz") {
    res.writeHead(200, { "content-type": "text/plain", "cache-control": "no-store" });
    return res.end("ok");
  }
  // The address the per-network limits will count you as. Open it on two
  // devices on different networks: they should differ. Shows only your own.
  if (urlPath === "/whoami") {
    res.writeHead(200, { "content-type": "text/plain", "cache-control": "no-store" });
    return res.end(`${clientIp(req)}\n`);
  }
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.writeHead(405, { allow: "GET, HEAD" });
    return res.end();
  }
  try { urlPath = decodeURIComponent(urlPath); } catch { /* keep raw */ }
  // terminal.tesella.io (or any terminal.* host) opens T-Terminal at its root.
  const host = String(req.headers.host || "").toLowerCase();
  if (urlPath === "/" && host.startsWith("terminal.")) urlPath = "/terminal.html";
  if (urlPath.endsWith("/")) urlPath += "index.html";

  const target = path.normalize(path.join(DIST, urlPath));
  // Never serve anything outside dist, whatever the URL claims. The separator
  // matters: without it, "/x/dist-old/secret" passes a check for "/x/dist".
  if (target !== DIST && !target.startsWith(DIST + path.sep)) {
    res.writeHead(403, { "content-type": "text/plain" });
    return res.end("forbidden");
  }

  fs.readFile(target, (err, buf) => {
    // "/privacy" serves privacy.html, so the links can be clean.
    if (err && !path.extname(target)) {
      return fs.readFile(target + ".html", (err2, page) => {
        if (err2) return sendIndex(res);
        res.writeHead(200, { ...SECURITY, "content-type": TYPES[".html"], "cache-control": "no-cache" });
        res.end(page);
      });
    }
    if (err) return sendIndex(res); // SPA fallback: unknown routes get the app
    const ext = path.extname(target).toLowerCase();
    // Vite fingerprints filenames under /assets, so those can cache forever.
    const immutable = urlPath.startsWith("/assets/");
    res.writeHead(200, {
      ...SECURITY,
      "content-type": TYPES[ext] || "application/octet-stream",
      "cache-control": immutable ? "public, max-age=31536000, immutable" : "no-cache",
    });
    res.end(buf);
  });
}