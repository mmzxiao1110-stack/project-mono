/**
 * Tesella — game server.
 *
 *   in : hello, signup, login, google, verify, resend, resetRequest, resetConfirm,
 *        logout, setName, queue, unqueue, move, discard, forfeit
 *   out: needAuth, auth, authError, verified, codeSent, resetSent, needVerify,
 *        welcome, nameError, online, searching, found, matchStart, turn, ack,
 *        clock, oppReady, reveal, matchOver, oppDropped, oppReturned, kicked, error
 *
 * Ranked play requires a verified account. Everything before `auth` is
 * anonymous and can do nothing but sign up, log in or reset a password.
 *
 * Every message handler runs inside a try/catch: a bad message costs the
 * sender an error reply, never the server.
 */
import fs from "node:fs";
import { createServer as createHttp } from "node:http";
import { createServer as createHttps } from "node:https";
import { WebSocketServer } from "ws";
import { staticHandler, hasBuild } from "./static.js";
import { sanitizeLoadout } from "../shared/engine.js";
import {
  getProfile, saveProfile, flush, countAccounts, dataFile,
  createAccount, saveAccount, findByUsername, findByEmail, nameTaken,
  findByIdentity, linkIdentity, freeUsername, getAccount,
  createSession, resolveSession, destroySession, destroySessionsFor,
} from "./store.js";
import {
  str, validateSignup, passwordProblem, nameProblem, hashPassword, verifyPassword,
  newCode, hashCode, codeMatches, newSalt,
  verifyGoogle, googleEnabled,
  CODE_TTL_MS, CODE_RESEND_MS, CODE_MAX_TRIES, CODES_PER_DAY,
  throttled, noteFailure, clearFailures,
} from "./auth.js";
import { sendCode, mailConfigured } from "./mail.js";
import {
  signupLimit, mailLimit, authLimit, messageLimit,
  MAX_MESSAGE_BYTES, MAX_SOCKETS_PER_IP, clientIp,
} from "./limits.js";
import { Queue } from "./queue.js";
import { Match } from "./match.js";
import { newRating } from "../shared/glicko.js";
import { randomBytes } from "node:crypto";

const PORT = Number(process.env.PORT) || 8787;
const PROD = process.env.NODE_ENV === "production";
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

const sockets = new Map(); // userId -> socket
const inMatch = new Map(); // userId -> { match, side }
const perIp = new Map();   // ip -> open sockets

const send = (ws, msg) => { if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg)); };
const fail = (ws, msg) => send(ws, { t: "error", msg });
const authError = (ws, msg) => send(ws, { t: "authError", msg });

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
  emailVerified: acct ? !!acct.emailVerified : false,
  provider: acct ? acct.provider : "password",
});

/** Pairs two queued players into a match: ranked, or unranked (no rating change). */
const pairUp = (rated) => (a, b, gap) => {
  const sa = sockets.get(a.playerId);
  const sb = sockets.get(b.playerId);
  if (!sa || !sb) {
    // Someone dropped between being paired and being told. Put the survivor back.
    const alive = sa ? a : sb ? b : null;
    if (alive) { (rated ? queue : casualQueue).add(alive); console.log(`[queue] re-queued ${alive.profile.name}`); }
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
    },
    { rated }
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
};
const queue = new Queue(pairUp(true));         // ranked
const casualQueue = new Queue(pairUp(false));  // unranked: anyone, guests included; ratings don't move
const leaveQueues = (id) => { queue.remove(id); casualQueue.remove(id); };

/* ---------- guests ----------
 * A guest is a name and a random id the browser keeps, nothing more. Guests
 * live in memory only, can play private rooms, and can't play ranked.
 */
const guests = new Map(); // "g:<id>" -> profile-shaped object
const isGuest = (userId) => typeof userId === "string" && userId.startsWith("g:");
const profileOf = (userId) => (isGuest(userId) ? guests.get(userId) : getProfile(userId));

/* ---------- private rooms ----------
 * The host gets a short code to share; whoever joins with it plays them,
 * unrated. After a match either player can ask for a rematch; both asking
 * starts it. A room closes when either player leaves it (or drops for more
 * than ROOM_GRACE_MS outside a match), or after ROOM_IDLE_MS with nobody.
 */
const rooms = new Map();   // code -> { code, host, guest, match, rematch: Set, touched, leaveTimer }
const roomOf = new Map();  // userId -> code
const ROOM_GRACE_MS = 45_000;
const ROOM_IDLE_MS = 30 * 60_000;
const CODE_CHARS = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // no 0/O, 1/I/L
function newRoomCode() {
  for (;;) {
    const bytes = randomBytes(5);
    const code = Array.from(bytes, (b) => CODE_CHARS[b % CODE_CHARS.length]).join("");
    if (!rooms.has(code)) return code;
  }
}
const roomView = (room, userId) => {
  const otherId = room.host === userId ? room.guest : room.host;
  const other = otherId ? profileOf(otherId) : null;
  return {
    t: "room", code: room.code, host: room.host === userId,
    opponent: other ? { name: other.name, guest: !!other.guest } : null,
    rematch: { me: room.rematch.has(userId), them: !!otherId && room.rematch.has(otherId) },
    playing: !!room.match,
  };
};
const tellRoom = (room) => { for (const id of [room.host, room.guest]) if (id) sendTo(id, roomView(room, id)); };

function closeRoom(room, why) {
  rooms.delete(room.code);
  clearTimeout(room.leaveTimer);
  for (const id of [room.host, room.guest]) {
    if (!id) continue;
    roomOf.delete(id);
    sendTo(id, { t: "roomClosed", why });
  }
}

function leaveRoom(userId, why = "Your friend left the room.") {
  const code = roomOf.get(userId);
  const room = code && rooms.get(code);
  if (!room) return;
  if (room.match && !room.match.over) {
    // Leaving mid-match is a forfeit, same as ranked.
    const active = inMatch.get(userId);
    if (active) active.match.end(active.side);
  }
  roomOf.delete(userId);
  if (room.host === userId) closeRoom(room, why);
  else { room.guest = null; room.rematch.clear(); tellRoom(room); }
}

function startRoomMatch(room) {
  const sa = sockets.get(room.host), sb = sockets.get(room.guest);
  if (!sa || !sb) return;
  room.rematch.clear();
  // Take turns being the bottom seat: the joiner starts on the bottom.
  room.games = (room.games || 0) + 1;
  const [a, b] = room.games % 2 ? [room.guest, room.host] : [room.host, room.guest];
  const match = new Match(
    [
      { profile: profileOf(a), loadout: sanitizeLoadout(), socket: sockets.get(a) },
      { profile: profileOf(b), loadout: sanitizeLoadout(), socket: sockets.get(b) },
    ],
    (m) => {
      inMatch.delete(a); inMatch.delete(b);
      if (rooms.get(room.code) === room) { room.match = null; room.touched = Date.now(); tellRoom(room); }
      console.log(`[room] ${room.code}: ${m.id} finished`);
    },
    { rated: false, room: room.code }
  );
  room.match = match;
  room.touched = Date.now();
  inMatch.set(a, { match, side: "A" });
  inMatch.set(b, { match, side: "B" });
  sendTo(a, { t: "found", matchId: match.id, opponent: match.publicSeat("B"), gap: 0, room: room.code });
  sendTo(b, { t: "found", matchId: match.id, opponent: match.publicSeat("A"), gap: 0, room: room.code });
  console.log(`[room] ${room.code}: ${profileOf(a).name} vs ${profileOf(b).name}`);
  setTimeout(() => match.start(), 1400);
}

/** After (re)connecting: put a player back in their room, if they had one. */
function resumeRoom(userId) {
  const code = roomOf.get(userId);
  const room = code && rooms.get(code);
  if (!room) return;
  clearTimeout(room.leaveTimer);
  sendTo(userId, roomView(room, userId));
}

function authenticateGuest(ws, userId, profile, gid) {
  const existing = sockets.get(userId);
  if (existing && existing !== ws) { send(existing, { t: "kicked" }); existing.close(); }
  ws.userId = userId;
  sockets.set(userId, ws);
  const active = inMatch.get(userId);
  send(ws, { t: "guestOk", gid, profile: { playerId: userId, name: profile.name, guest: true }, inMatch: !!active });
  if (active) active.match.onReconnect(active.side, ws);
  resumeRoom(userId);
}

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
  const active = inMatch.get(userId);
  // `inMatch` lets a client that was mid-match before a server restart learn
  // that the match is gone, instead of waiting on it forever.
  send(ws, { t: "auth", token, profile: publicProfile(profile, acct), inMatch: !!active });
  if (active) active.match.onReconnect(active.side, ws);
  resumeRoom(userId);
}

/**
 * Mints a fresh code of the given kind, stores only its hash, and mails it.
 * Returns false (and mails nothing) if this account or this IP has had too
 * many codes — the cap that stops the server being used to spam inboxes.
 */
async function issueCode(acct, purpose, ip) {
  const now = Date.now();
  acct.mailLog = (acct.mailLog || []).filter((t) => now - t < 24 * 60 * 60 * 1000);
  if (acct.mailLog.length >= CODES_PER_DAY || !mailLimit.take(ip)) {
    console.warn(`[mail] limit reached for ${acct.username} from ${ip}`);
    return false;
  }
  acct.mailLog.push(now);
  const code = newCode();
  const salt = newSalt();
  const record = { salt, hash: hashCode(code, salt), expires: now + CODE_TTL_MS, sentAt: now, tries: 0 };
  if (purpose === "reset") acct.reset = record; else acct.code = record;
  saveAccount(acct);
  try {
    await sendCode(acct.email, code, acct.username, purpose);
  } catch (e) {
    console.error("[mail] send failed:", e.message);
  }
  return true;
}

/** Checks a submitted code against a stored record. Returns an error message or null. */
function checkCode(acct, record, code) {
  if (!record) return "No code outstanding — request a new one.";
  if (Date.now() > record.expires) return "That code expired. Request a new one.";
  if (record.tries >= CODE_MAX_TRIES) return "Too many wrong codes. Request a new one.";
  if (!codeMatches(str(code, 10), record.salt, record.hash)) {
    record.tries++;
    saveAccount(acct);
    return `Wrong code. ${CODE_MAX_TRIES - record.tries} tries left.`;
  }
  return null;
}

/* ============================================================
   HTTP + WebSocket
   ============================================================ */
/**
 * One HTTP(S) server does both jobs: it serves the built client and hosts the
 * WebSocket. Behind a platform that terminates TLS (Render) plain HTTP here is
 * correct — the encrypted hop is theirs. Set TLS_CERT/TLS_KEY only when this
 * process is itself the edge.
 */
const { TLS_CERT, TLS_KEY, HOST } = process.env;
const useTls = !!(TLS_CERT && TLS_KEY);

const httpServer = useTls
  ? createHttps({ cert: fs.readFileSync(TLS_CERT), key: fs.readFileSync(TLS_KEY) }, staticHandler)
  : createHttp(staticHandler);

// maxPayload: the ws default is 100 MB per message. Nothing legitimate is
// bigger than a couple of KB.
const wss = new WebSocketServer({ server: httpServer, maxPayload: MAX_MESSAGE_BYTES });

httpServer.listen(PORT, HOST || "0.0.0.0", () => {
  const scheme = useTls ? "https" : "http";
  console.log(`[server] ${scheme}://${HOST || "0.0.0.0"}:${PORT} — ${countAccounts()} accounts in ${dataFile()}`);
  console.log(`[server] client build: ${hasBuild() ? "serving ../dist" : "not built (use the Vite dev server)"}`);
  console.log(`[server] google sign-in: ${googleEnabled() ? "enabled" : "not configured"}`);
  if (PROD && !process.env.DATA_DIR) {
    console.warn("[server] ⚠  DATA_DIR is not set. On Render, accounts are wiped on every deploy unless it points at a disk.");
  }
});

const PUBLIC = new Set(["hello", "signup", "login", "google", "verify", "resend", "resetRequest", "resetConfirm", "guest"]);

async function handle(ws, msg) {
  if (!msg || typeof msg !== "object" || typeof msg.t !== "string") return fail(ws, "Malformed request.");
  if (!PUBLIC.has(msg.t) && !ws.userId) return send(ws, { t: "needAuth" });
  const ip = ws.ip;

  switch (msg.t) {
    /* ---------- auth ---------- */

    case "hello": {
      const token = str(msg.token, 128);
      const userId = token ? resolveSession(token) : null;
      if (!userId || !getAccount(userId)) return send(ws, { t: "needAuth" });
      authenticate(ws, userId, token);
      break;
    }

    case "signup": {
      if (!signupLimit.has(ip)) return authError(ws, "Too many new accounts from your network. Try again in an hour.");
      const username = str(msg.username, 32);
      const email = str(msg.email, 320).trim();
      const err = validateSignup(username, email, msg.password);
      if (err) return authError(ws, err);
      if (nameTaken(username)) return authError(ws, "That username is taken.");
      if (findByEmail(email)) return authError(ws, "That email is already registered.");

      const { salt, hash } = await hashPassword(msg.password);
      const acct = createAccount({ username, email, salt, hash });
      if (!acct) return authError(ws, "That username or email was just taken. Try another.");
      signupLimit.take(ip); // only successful sign-ups count toward the limit
      await issueCode(acct, "verify", ip);
      console.log(`[auth] new account: ${acct.username}`);
      authenticate(ws, acct.userId, createSession(acct.userId));
      break;
    }

    case "google": {
      if (!googleEnabled()) return authError(ws, "Google sign-in isn't configured on this server.");
      if (!authLimit.take(ip)) return authError(ws, "Too many attempts. Wait a minute and try again.");
      let g;
      try { g = await verifyGoogle(str(msg.credential, 4096)); }
      catch { return authError(ws, "Google sign-in failed. Try again."); }

      let acct = findByIdentity("google", g.sub);
      if (!acct && g.email && g.emailVerified) {
        // Same person, existing password account — link rather than duplicate.
        // Only on a Google-verified address, or anyone could claim an account
        // by putting its email on a Google profile.
        acct = findByEmail(g.email);
        if (acct) {
          linkIdentity(acct.userId, "google", g.sub);
          acct.emailVerified = true;
          saveAccount(acct);
        }
      }
      if (!acct) {
        acct = createAccount({
          username: freeUsername((g.email || "player").split("@")[0]),
          email: g.email, provider: "google", emailVerified: g.emailVerified,
        });
        if (!acct) return authError(ws, "Couldn't create that account. Try again.");
        linkIdentity(acct.userId, "google", g.sub);
        console.log(`[auth] new Google account: ${acct.username}`);
      }
      authenticate(ws, acct.userId, createSession(acct.userId));
      break;
    }

    case "verify": {
      if (!authLimit.take(ip)) return authError(ws, "Too many attempts. Wait a minute and try again.");
      const userId = ws.userId || resolveSession(str(msg.token, 128));
      const acct = getAccount(userId);
      if (!acct) return send(ws, { t: "needAuth" });
      if (acct.emailVerified) return send(ws, { t: "verified", profile: publicProfile(getProfile(userId), acct) });
      const err = checkCode(acct, acct.code, msg.code);
      if (err) return authError(ws, err);
      acct.emailVerified = true;
      acct.code = null;
      saveAccount(acct);
      console.log(`[auth] verified: ${acct.username}`);
      send(ws, { t: "verified", profile: publicProfile(getProfile(userId), acct) });
      break;
    }

    case "resend": {
      const userId = ws.userId || resolveSession(str(msg.token, 128));
      const acct = getAccount(userId);
      if (!acct) return send(ws, { t: "needAuth" });
      if (acct.emailVerified) return;
      const since = acct.code ? Date.now() - acct.code.sentAt : Infinity;
      if (since < CODE_RESEND_MS) {
        return authError(ws, `Wait ${Math.ceil((CODE_RESEND_MS - since) / 1000)}s before resending.`);
      }
      if (!(await issueCode(acct, "verify", ip))) return authError(ws, "That's a lot of codes. Try again tomorrow.");
      send(ws, { t: "codeSent" });
      break;
    }

    case "resetRequest": {
      if (!authLimit.take(ip)) return authError(ws, "Too many attempts. Wait a minute and try again.");
      const acct = findByEmail(str(msg.email, 320).trim());
      // Same answer whether or not the address has an account, so this can't
      // be used to find out who plays.
      if (acct && acct.email) {
        const since = acct.reset ? Date.now() - acct.reset.sentAt : Infinity;
        if (since >= CODE_RESEND_MS) await issueCode(acct, "reset", ip);
      }
      send(ws, { t: "resetSent" });
      break;
    }

    case "resetConfirm": {
      if (!authLimit.take(ip)) return authError(ws, "Too many attempts. Wait a minute and try again.");
      const pwErr = passwordProblem(msg.password);
      if (pwErr) return authError(ws, pwErr);
      const acct = findByEmail(str(msg.email, 320).trim());
      if (!acct) return authError(ws, "That code is wrong or has expired.");
      const err = checkCode(acct, acct.reset, msg.code);
      if (err) return authError(ws, err);
      const { salt, hash } = await hashPassword(msg.password);
      acct.salt = salt;
      acct.hash = hash;
      acct.reset = null;
      acct.emailVerified = true; // they just proved they read that inbox
      saveAccount(acct);
      destroySessionsFor(acct.userId);
      console.log(`[auth] password reset: ${acct.username}`);
      authenticate(ws, acct.userId, createSession(acct.userId));
      break;
    }

    case "login": {
      const uname = str(msg.username, 32);
      const lower = uname.toLowerCase();
      const wait = throttled(lower, ip);
      if (wait || !authLimit.take(ip)) {
        return authError(ws, `Too many attempts. Try again in ${Math.max(1, Math.ceil(wait / 60))} min, or reset your password.`);
      }
      const acct = findByUsername(uname);
      // Same message either way — don't leak which usernames exist.
      const ok = acct && (await verifyPassword(msg.password, acct.salt, acct.hash));
      if (!ok) {
        noteFailure(lower, ip);
        return authError(ws, "Wrong username or password.");
      }
      clearFailures(lower, ip);
      authenticate(ws, acct.userId, createSession(acct.userId));
      break;
    }

    case "logout": {
      destroySession(str(msg.token, 128));
      leaveQueues(ws.userId);
      leaveRoom(ws.userId);
      if (isGuest(ws.userId)) guests.delete(ws.userId);
      sockets.delete(ws.userId);
      ws.userId = null;
      send(ws, { t: "needAuth" });
      break;
    }

    /* ---------- game ---------- */

    case "setName": {
      if (isGuest(ws.userId)) return fail(ws, "Make an account to keep a name.");
      const profile = getProfile(ws.userId);
      const clean = str(msg.name, 64).trim().replace(/\s+/g, " ");
      const err = clean === profile.name ? null : nameProblem(clean, { display: true }) || (nameTaken(clean, ws.userId) ? "Someone already uses that name." : null);
      if (err) {
        send(ws, { t: "nameError", msg: err });
      } else {
        profile.name = clean;
        saveProfile(profile);
      }
      send(ws, { t: "welcome", profile: publicProfile(profile, getAccount(ws.userId)) });
      break;
    }

    /* ---------- guests and private rooms ---------- */

    case "guest": {
      // Play as a guest: just a name. The browser keeps `gid` to come back as the same guest.
      if (ws.userId && !isGuest(ws.userId)) return fail(ws, "You're already signed in.");
      const name = str(msg.name, 32).trim().replace(/\s+/g, " ");
      const problem = nameProblem(name, { display: true }) || (nameTaken(name) ? "A player already has that name — pick another." : null);
      if (problem) return send(ws, { t: "guestError", msg: problem });
      let gid = str(msg.gid, 40);
      if (!/^[a-z0-9]{16,40}$/.test(gid)) gid = randomBytes(12).toString("hex");
      const userId = `g:${gid}`;
      const prev = guests.get(userId);
      // Mid-match, the name stays as the opponent saw it.
      const profile = prev && inMatch.has(userId) ? prev : { playerId: userId, name, guest: true, rating: newRating(), stats: null };
      guests.set(userId, profile);
      authenticateGuest(ws, userId, profile, gid);
      break;
    }

    case "createRoom": {
      if (inMatch.has(ws.userId)) return fail(ws, "Finish your match first.");
      leaveQueues(ws.userId);
      leaveRoom(ws.userId);
      const room = { code: newRoomCode(), host: ws.userId, guest: null, match: null, rematch: new Set(), touched: Date.now(), leaveTimer: null };
      rooms.set(room.code, room);
      roomOf.set(ws.userId, room.code);
      tellRoom(room);
      console.log(`[room] ${room.code} opened by ${profileOf(ws.userId).name}`);
      break;
    }

    case "joinRoom": {
      const code = str(msg.code, 12).toUpperCase().replace(/[^A-Z0-9]/g, "");
      const room = rooms.get(code);
      if (!room) return send(ws, { t: "roomError", msg: "No room with that code. Check it and try again." });
      if (room.host === ws.userId) return tellRoom(room);
      if (room.guest && room.guest !== ws.userId) return send(ws, { t: "roomError", msg: "That room is already full." });
      if (inMatch.has(ws.userId)) return fail(ws, "Finish your match first.");
      leaveQueues(ws.userId);
      if (roomOf.get(ws.userId) !== code) leaveRoom(ws.userId);
      room.guest = ws.userId;
      roomOf.set(ws.userId, code);
      tellRoom(room);
      startRoomMatch(room);
      break;
    }

    case "leaveRoom":
      leaveRoom(ws.userId);
      break;

    case "rematch": {
      const room = rooms.get(roomOf.get(ws.userId));
      if (!room || room.match || !room.guest) return;
      room.rematch.add(ws.userId);
      if (room.rematch.has(room.host) && room.rematch.has(room.guest)) startRoomMatch(room);
      else tellRoom(room);
      break;
    }

    case "queue": {
      if (msg.unranked) {
        // Unranked: no account or verified email needed; ratings don't move.
        if (inMatch.has(ws.userId)) return fail(ws, "Already in a match.");
        if (casualQueue.has(ws.userId)) return;
        leaveQueues(ws.userId);
        leaveRoom(ws.userId);
        const profile = profileOf(ws.userId);
        const uid = ws.userId;
        casualQueue.add({
          playerId: uid, profile, rating: profile.rating, loadout: sanitizeLoadout(),
          onProgress: (p) => sendTo(uid, { t: "searching", ...p }),
        });
        console.log(`[queue] + ${profile.name} (unranked) — ${casualQueue.size} waiting`);
        break;
      }
      if (isGuest(ws.userId)) return fail(ws, "Make an account to play ranked.");
      const acct = getAccount(ws.userId);
      if (!acct || !acct.emailVerified) return send(ws, { t: "needVerify" });
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
      leaveQueues(ws.userId);
      break;

    case "move":
    case "delete":
    case "pin":
    case "discard": {
      const active = inMatch.get(ws.userId);
      if (!active) return fail(ws, "Not in a match.");
      const err = msg.t === "move"
        ? active.match.submitMove(active.side, msg)
        : msg.t === "discard"
          ? active.match.submitDiscard(active.side, msg)
          : active.match.submitAction(active.side, msg, msg.t);
      if (err) fail(ws, err);
      break;
    }

    case "forfeit": {
      // Giving up counts as a loss, exactly like leaving and not coming back.
      const active = inMatch.get(ws.userId);
      if (!active) return fail(ws, "Not in a match.");
      console.log(`[match] ${active.match.id}: ${ws.userId} forfeited`);
      active.match.end(active.side);
      break;
    }

    default:
      fail(ws, "Unknown request.");
  }
}

wss.on("connection", (ws, req) => {
  const ip = clientIp(req);
  const open = (perIp.get(ip) || 0) + 1;
  if (open > MAX_SOCKETS_PER_IP) {
    ws.close(1008, "Too many connections");
    return;
  }
  perIp.set(ip, open);

  ws.ip = ip;
  ws.isAlive = true;
  ws.userId = null;
  ws.tokens = messageLimit.burst;
  ws.tokensAt = Date.now();
  ws.on("pong", () => { ws.isAlive = true; });
  send(ws, { t: "online", n: wss.clients.size });

  ws.on("message", (raw) => {
    // Per-socket flood control: a real client sends a handful a second.
    const now = Date.now();
    ws.tokens = Math.min(messageLimit.burst, ws.tokens + ((now - ws.tokensAt) / 1000) * messageLimit.perSecond);
    ws.tokensAt = now;
    if (ws.tokens < 1) { ws.terminate(); return; }
    ws.tokens--;

    let msg;
    try { msg = JSON.parse(raw); } catch { return fail(ws, "Malformed request."); }
    handle(ws, msg).catch((e) => {
      console.error(`[ws] ${msg && msg.t} from ${ws.userId || ip} threw:`, e);
      fail(ws, "Something went wrong on our side.");
    });
  });

  ws.on("close", () => {
    const left = (perIp.get(ip) || 1) - 1;
    if (left > 0) perIp.set(ip, left); else perIp.delete(ip);

    const id = ws.userId;
    if (!id) return;
    // Only clear the map if this socket is still the live one — a reconnect
    // may already have replaced it, and deleting would orphan the new session.
    if (sockets.get(id) !== ws) return;
    sockets.delete(id);
    leaveQueues(id);
    const active = inMatch.get(id);
    if (active) active.match.onDisconnect(active.side);
    // Out of a match, a room waits a little for a refresh or a flaky connection.
    const room = rooms.get(roomOf.get(id));
    if (room && !active) {
      clearTimeout(room.leaveTimer);
      room.leaveTimer = setTimeout(() => { if (!sockets.has(id)) leaveRoom(id); }, ROOM_GRACE_MS);
    }
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

// "N online" on the menu, so nobody queues into an empty lobby blind.
let lastOnline = -1;
// Rooms nobody is using, and guests nobody is playing as, are let go.
const roomSweeper = setInterval(() => {
  const now = Date.now();
  for (const room of rooms.values()) {
    if (!room.match && now - room.touched > ROOM_IDLE_MS) closeRoom(room, "The room closed after a while with no games.");
  }
  for (const id of guests.keys()) {
    if (!sockets.has(id) && !inMatch.has(id) && !roomOf.has(id)) guests.delete(id);
  }
}, 60_000);

const onlineTicker = setInterval(() => {
  const n = wss.clients.size;
  if (n === lastOnline) return;
  lastOnline = n;
  for (const ws of wss.clients) send(ws, { t: "online", n });
}, 5_000);

/* ============================================================
   Shutdown and last-resort error handling
   ============================================================ */
let stopping = false;
function shutdown(code = 0) {
  if (stopping) return;
  stopping = true;
  clearInterval(heartbeat);
  clearInterval(onlineTicker);
  clearInterval(roomSweeper);
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
