/**
 * Tesella — the Node host (Render, and local development).
 *
 * The game itself is server/core.js. This file gives it:
 *   - storage: one JSON file (server/filestore.js)
 *   - an HTTP(S) server: the read-only API, then the built site (../dist)
 *   - a WebSocket server (the `ws` package), any path (the client uses /ws)
 *
 * The same core also runs on Cloudflare (cloudflare/), with Cloudflare's
 * storage and sockets instead.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer as createHttp } from "node:http";
import { createServer as createHttps } from "node:https";
import { WebSocketServer } from "ws";
import { staticHandler, hasBuild } from "./static.js";
import { apiHandler } from "./api.js";
import { openFileStore, dataFile, DATA_DIR } from "./filestore.js";
import { flush, countAccounts } from "./store.js";
import { setBlocklist, googleEnabled } from "./auth.js";
import { mailConfigured, describeMail } from "./mail.js";
import { MAX_MESSAGE_BYTES, clientIp } from "./limits.js";
import * as core from "./core.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 8787;
const PROD = process.env.NODE_ENV === "production";

openFileStore();
try { setBlocklist(fs.readFileSync(path.join(HERE, "blocklist.txt"), "utf8")); } catch { /* no list: nothing blocked */ }

console.log(`[mail] ${describeMail()}`);
// Every account verifies its email; there is no way to skip it. Without
// Resend the codes can't be emailed, so sign-ups can't finish (guests still
// play) — loud in the logs, but the game stays up.
if (PROD && !mailConfigured()) {
  console.error(
    "[server] ⚠  NODE_ENV=production but RESEND_API_KEY is not set: verification\n" +
    "[server] codes can't be emailed, so nobody can finish signing up (they print\n" +
    "[server] in this log instead). Set RESEND_API_KEY and MAIL_FROM."
  );
}

/**
 * One HTTP(S) server does both jobs: it serves the built client and hosts the
 * WebSocket. Behind a platform that terminates TLS (Render) plain HTTP here is
 * correct — the encrypted hop is theirs. Set TLS_CERT/TLS_KEY only when this
 * process is itself the edge.
 */
const { TLS_CERT, TLS_KEY, HOST } = process.env;
const useTls = !!(TLS_CERT && TLS_KEY);

// The read-only API (T-Terminal, profile popups) first, then the built site.
const handleHttp = (req, res) => { if (!apiHandler(req, res)) staticHandler(req, res); };
const httpServer = useTls
  ? createHttps({ cert: fs.readFileSync(TLS_CERT), key: fs.readFileSync(TLS_KEY) }, handleHttp)
  : createHttp(handleHttp);

// maxPayload: the ws default is 100 MB per message. Nothing legitimate is
// bigger than a couple of KB.
const wss = new WebSocketServer({ server: httpServer, maxPayload: MAX_MESSAGE_BYTES });

httpServer.listen(PORT, HOST || "0.0.0.0", () => {
  const scheme = useTls ? "https" : "http";
  console.log(`[server] ${scheme}://${HOST || "0.0.0.0"}:${PORT} — ${countAccounts()} accounts in ${dataFile()}`);
  console.log(`[server] client build: ${hasBuild() ? "serving ../dist" : "not built (use the Vite dev server)"}`);
  console.log(`[server] google sign-in: ${googleEnabled() ? "enabled" : "not configured"}`);
  if (PROD && !process.env.DATA_DIR) {
    console.warn(`[server] ⚠  DATA_DIR is not set (using ${DATA_DIR}). On Render, accounts are wiped on every deploy unless it points at a disk.`);
  }
});

wss.on("connection", (ws, req) => {
  if (!core.connect(ws, clientIp(req))) return;
  ws.on("pong", () => { ws.isAlive = true; });
  ws.on("message", (raw) => core.message(ws, raw.toString()));
  ws.on("close", () => core.disconnect(ws));
  ws.on("error", (e) => console.error("[ws]", e.message));
});

core.startTimers();

/* ============================================================
   Shutdown and last-resort error handling
   ============================================================ */
let stopping = false;
function shutdown(code = 0) {
  if (stopping) return;
  stopping = true;
  core.stopTimers();
  flush();
  console.log("[server] saved and exiting");
  process.exit(code);
}
process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0)); // Render sends this before every deploy

// A bug in a timer (not a message handler) still mustn't lose data: save,
// log, and exit so the host restarts a clean process.
process.on("uncaughtException", (e) => {
  console.error("[server] uncaught exception:", e);
  shutdown(1);
});
process.on("unhandledRejection", (e) => {
  console.error("[server] unhandled rejection:", e);
});
