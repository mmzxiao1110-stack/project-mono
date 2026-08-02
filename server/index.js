/**
 * TURF BLOCKS — game server.
 *
 *   in : hello, signup, login, logout, queue, unqueue, move, discard, setName
 *   out: needAuth, auth, authError, welcome, searching, found, matchStart,
 *        turn, ack, oppReady, reveal, matchOver, oppDropped, oppReturned, error
 *
 * Ranked play requires an account. Everything before `auth` is anonymous and
 * can do nothing but sign up or log in.
 */
import fs from "node:fs";
import { createServer as createHttp } from "node:http";
import { createServer as createHttps } from "node:https";
import { WebSocketServer } from "ws";
import { staticHandler, hasBuild } from "./static.js";
import { sanitizeLoadout } from "../shared/engine.js";
import {
  getProfile, saveProfile, flush, countAccounts,
  createAccount, saveAccount, findByUsername, findByEmail,
  findByIdentity, linkIdentity, freeUsername, getAccount,
  createSession, resolveSession, destroySession,
} from "./store.js";
import {
  validateSignup, hashPassword, verifyPassword,
  newCode, hashCode, codeMatches, newSalt,
  verifyGoogle, googleEnabled,
  CODE_TTL_MS, CODE_RESEND_MS, CODE_MAX_TRIES,
  throttled, noteFailure, clearFailures,
} from "./auth.js";
import { sendCode } from "./mail.js";
import { Queue } from "./queue.js";
import { Match } from "./match.js";

const PORT = Number(process.env.PORT) || 8787;
// Closed playtests often have no mail provider yet. Turn this on to let people
// in without a code — and turn it off before anyone you don't know can sign up.
const SKIP_VERIFY = process.env.SKIP_EMAIL_VERIFY === "1";

const sockets = new Map(); // userId -> socket
const inMatch = new Map(); // userId -> { match, side }

const send = (ws, msg) => { if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg)); };
const fail = (ws, msg) => send(ws, { t: "error", msg });

/**
 * Always resolve the CURRENT socket for a player. Caching a socket reference
 * anywhere is a bug: a reconnect swaps it, and messages sent to the old one
 * vanish silently — which looks to the player like the server hung.
 */
const sendTo = (userId, msg) => send(sockets.get(userId), msg);

const publicProfile = (p, acct) => ({
  playerId: p.playerId,
  name: p.name,
  rating: p.rating,
  stats: p.stats,
  createdAt: p.createdAt,
  email: acct ? acct.email : null,
  emailVerified: SKIP_VERIFY || (acct ? !!acct.emailVerified : false),
  provider: acct ? acct.provider : "password",
});

const queue = new Queue((a, b, gap) => {
  const sa = sockets.get(a.playerId);
  const sb = sockets.get(b.playerId);
  if (!sa || !sb) {
    // Someone dropped between being paired and being told. Put the survivor back.
    const alive = sa ? a : sb ? b : null;
    if (alive) { queue.add(alive); console.log(`[queue] re-queued ${alive.profile.name}`); }
    return;
  }

  const match = new Match(
    [
      { profile: a.profile, loadout: a.loadout, socket: sa },
      { profile: b.profile, loadout: b.loadout, socket: sb },
    ],
    (m) => {
      inMatch.delete(m.seats.A.profile.playerId);
      inMatch.delete(m.seats.B.profile.playerId);
      console.log(`[match] ${m.id} finished`);
    }
  );
  inMatch.set(a.profile.playerId, { match, side: "A" });
  inMatch.set(b.profile.playerId, { match, side: "B" });

  sendTo(a.playerId, { t: "found", matchId: match.id, opponent: match.publicSeat("B"), gap: Math.round(gap) });
  sendTo(b.playerId, { t: "found", matchId: match.id, opponent: match.publicSeat("A"), gap: Math.round(gap) });

  console.log(
    `[match] ${match.id}: ${a.profile.name} (${Math.round(a.rating.r)}) vs ` +
    `${b.profile.name} (${Math.round(b.rating.r)}) — ${Math.round(gap)} TR apart`
  );

  setTimeout(() => match.start(), 1400);
});

function authenticate(ws, userId, token) {
  const existing = sockets.get(userId);
  if (existing && existing !== ws) {
    // Distinct type, not a generic error: the old client must know to STOP
    // reconnecting, or the two sockets boot each other in a loop forever.
    send(existing, { t: "kicked" });
    existing.close();
  }
  ws.userId = userId;
  sockets.set(userId, ws);

  const acct = getAccount(userId);
  const profile = getProfile(userId);
  send(ws, { t: "auth", token, profile: publicProfile(profile, acct) });

  const active = inMatch.get(userId);
  if (active) active.match.onReconnect(active.side, ws);
}

/** Mints a fresh code, stores only its hash, and mails it. */
async function issueCode(acct) {
  const code = newCode();
  const salt = newSalt();
  acct.code = { salt, hash: hashCode(code, salt), expires: Date.now() + CODE_TTL_MS, sentAt: Date.now(), tries: 0 };
  saveAccount(acct);
  try {
    await sendCode(acct.email, code, acct.username);
  } catch (e) {
    console.error("[mail] send failed:", e.message);
  }
}

/**
 * One HTTP(S) server does both jobs: it serves the built client and hosts the
 * WebSocket. Behind a platform that terminates TLS (Render, Fly, Railway) plain
 * HTTP here is correct — the encrypted hop is theirs. Set TLS_CERT/TLS_KEY only
 * when this process is itself the edge.
 */
const { TLS_CERT, TLS_KEY, HOST } = process.env;
const useTls = !!(TLS_CERT && TLS_KEY);

const httpServer = useTls
  ? createHttps({ cert: fs.readFileSync(TLS_CERT), key: fs.readFileSync(TLS_KEY) }, staticHandler)
  : createHttp(staticHandler);

const wss = new WebSocketServer({ server: httpServer });

httpServer.listen(PORT, HOST || "0.0.0.0", () => {
  const scheme = useTls ? "https" : "http";
  console.log(`[server] ${scheme}://${HOST || "0.0.0.0"}:${PORT} — ${countAccounts()} accounts`);
  console.log(`[server] client build: ${hasBuild() ? "serving ../dist" : "not built (use the Vite dev server)"}`);
  console.log(`[server] google sign-in: ${googleEnabled() ? "enabled" : "not configured"}`);
  if (SKIP_VERIFY) console.warn("[server] ⚠  SKIP_EMAIL_VERIFY is on — accounts are usable without a code.");
  if (!useTls && !process.env.BEHIND_PROXY && HOST && HOST !== "127.0.0.1" && HOST !== "localhost") {
    console.warn(
      "[server] ⚠  No TLS on a public interface. If nothing is terminating HTTPS\n" +
      "[server] ⚠  in front of this, passwords are travelling in plaintext."
    );
  }
});

wss.on("connection", (ws) => {
  ws.isAlive = true;
  ws.userId = null;
  ws.on("pong", () => { ws.isAlive = true; });

  ws.on("message", async (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch (e) { return fail(ws, "Malformed request."); }
    if (!msg || typeof msg.t !== "string") return fail(ws, "Missing type.");

    const open = ["hello", "signup", "login", "google", "verify", "resend"].includes(msg.t);
    if (!open && !ws.userId) return send(ws, { t: "needAuth" });

    switch (msg.t) {
      /* ---------- auth ---------- */

      case "hello": {
        const userId = msg.token ? resolveSession(msg.token) : null;
        if (!userId || !getAccount(userId)) return send(ws, { t: "needAuth" });
        authenticate(ws, userId, msg.token);
        break;
      }

      case "signup": {
        const err = validateSignup(msg.username, msg.email, msg.password);
        if (err) return send(ws, { t: "authError", msg: err });
        if (findByUsername(msg.username)) return send(ws, { t: "authError", msg: "That username is taken." });
        if (findByEmail(msg.email)) return send(ws, { t: "authError", msg: "That email is already registered." });

        const { salt, hash } = await hashPassword(msg.password);
        const acct = createAccount({ username: String(msg.username), email: String(msg.email), salt, hash });
        await issueCode(acct);
        const token = createSession(acct.userId);
        console.log(`[auth] new account: ${acct.username} <${acct.email}>`);
        authenticate(ws, acct.userId, token);
        break;
      }

      case "google": {
        if (!googleEnabled()) return send(ws, { t: "authError", msg: "Google sign-in isn't configured on this server." });
        let g;
        try { g = await verifyGoogle(msg.credential); }
        catch (e) { return send(ws, { t: "authError", msg: e.message }); }

        let acct = findByIdentity("google", g.sub);
        if (!acct && g.email) {
          // Same person, existing password account — link rather than duplicate.
          acct = findByEmail(g.email);
          if (acct) {
            linkIdentity(acct.userId, "google", g.sub);
            if (g.emailVerified) { acct.emailVerified = true; saveAccount(acct); }
          }
        }
        if (!acct) {
          const username = freeUsername((g.email || "player").split("@")[0]);
          acct = createAccount({
            username, email: g.email, provider: "google", emailVerified: g.emailVerified,
          });
          linkIdentity(acct.userId, "google", g.sub);
          console.log(`[auth] new Google account: ${acct.username} <${acct.email}>`);
        }
        authenticate(ws, acct.userId, createSession(acct.userId));
        break;
      }

      case "verify": {
        const userId = ws.userId || (msg.token ? resolveSession(msg.token) : null);
        const acct = userId && getAccount(userId);
        if (!acct) return send(ws, { t: "needAuth" });
        if (acct.emailVerified) return send(ws, { t: "verified", profile: publicProfile(getProfile(userId), acct) });

        const c = acct.code;
        if (!c) return send(ws, { t: "authError", msg: "No code outstanding — request a new one." });
        if (Date.now() > c.expires) return send(ws, { t: "authError", msg: "That code expired. Request a new one." });
        if (c.tries >= CODE_MAX_TRIES) return send(ws, { t: "authError", msg: "Too many wrong codes. Request a new one." });

        if (!codeMatches(String(msg.code || ""), c.salt, c.hash)) {
          c.tries++;
          saveAccount(acct);
          return send(ws, { t: "authError", msg: `Wrong code. ${CODE_MAX_TRIES - c.tries} tries left.` });
        }
        acct.emailVerified = true;
        acct.code = null;
        saveAccount(acct);
        console.log(`[auth] verified: ${acct.username}`);
        send(ws, { t: "verified", profile: publicProfile(getProfile(userId), acct) });
        break;
      }

      case "resend": {
        const userId = ws.userId || (msg.token ? resolveSession(msg.token) : null);
        const acct = userId && getAccount(userId);
        if (!acct) return send(ws, { t: "needAuth" });
        if (acct.emailVerified) return;
        const since = acct.code ? Date.now() - acct.code.sentAt : Infinity;
        if (since < CODE_RESEND_MS) {
          return send(ws, { t: "authError", msg: `Wait ${Math.ceil((CODE_RESEND_MS - since) / 1000)}s before resending.` });
        }
        await issueCode(acct);
        send(ws, { t: "codeSent" });
        break;
      }

      case "login": {
        const uname = String(msg.username || "");
        const lower = uname.toLowerCase();
        const wait = throttled(lower);
        if (wait) {
          return send(ws, { t: "authError", msg: `Too many attempts. Try again in ${Math.ceil(wait / 60)} min.` });
        }
        const acct = findByUsername(uname);
        // Same message either way — don't leak which usernames exist.
        const ok = acct && (await verifyPassword(String(msg.password || ""), acct.salt, acct.hash));
        if (!ok) {
          noteFailure(lower);
          return send(ws, { t: "authError", msg: "Wrong username or password." });
        }
        clearFailures(lower);
        const token = createSession(acct.userId);
        authenticate(ws, acct.userId, token);
        break;
      }

      case "logout": {
        if (msg.token) destroySession(msg.token);
        queue.remove(ws.userId);
        sockets.delete(ws.userId);
        ws.userId = null;
        send(ws, { t: "needAuth" });
        break;
      }

      /* ---------- game ---------- */

      case "setName": {
        const profile = getProfile(ws.userId);
        const clean = String(msg.name || "").trim().slice(0, 16);
        if (clean) { profile.name = clean; saveProfile(profile); }
        send(ws, { t: "welcome", profile: publicProfile(profile, getAccount(ws.userId)) });
        break;
      }

      case "queue": {
        const acct = getAccount(ws.userId);
        if (!acct || (!acct.emailVerified && !SKIP_VERIFY)) return send(ws, { t: "needVerify" });
        if (inMatch.has(ws.userId)) return fail(ws, "Already in a match.");
        if (queue.has(ws.userId)) return;
        const profile = getProfile(ws.userId);
        const uid = ws.userId;
        queue.add({
          playerId: uid,
          profile,
          rating: profile.rating,
          loadout: sanitizeLoadout(msg.loadout),
          onProgress: (p) => sendTo(uid, { t: "searching", ...p }),
        });
        console.log(`[queue] + ${profile.name} (${Math.round(profile.rating.r)}) — ${queue.size} waiting`);
        break;
      }

      case "unqueue":
        if (queue.has(ws.userId)) console.log(`[queue] - ${ws.userId} (cancelled)`);
        queue.remove(ws.userId);
        break;

      case "move":
      case "discard": {
        const active = inMatch.get(ws.userId);
        if (!active) return fail(ws, "Not in a match.");
        const err = msg.t === "move"
          ? active.match.submitMove(active.side, msg)
          : active.match.submitDiscard(active.side, msg);
        if (err) fail(ws, err);
        break;
      }

      default:
        fail(ws, `Unknown type: ${msg.t}`);
    }
  });

  ws.on("close", () => {
    const id = ws.userId;
    if (!id) return;
    // Only clear the map if this socket is still the live one — a reconnect
    // may already have replaced it, and deleting would orphan the new session.
    if (sockets.get(id) !== ws) return;
    sockets.delete(id);
    if (queue.has(id)) console.log(`[queue] - ${id} (disconnected)`);
    queue.remove(id);
    const active = inMatch.get(id);
    if (active) active.match.onDisconnect(active.side);
  });

  ws.on("error", (e) => console.error("[ws]", e.message));
});

const heartbeat = setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) { ws.terminate(); continue; }
    ws.isAlive = false;
    ws.ping();
  }
}, 30_000);

const shutdown = () => {
  clearInterval(heartbeat);
  flush();
  console.log("\n[server] saved and exiting");
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);