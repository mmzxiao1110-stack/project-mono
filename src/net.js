import { replays } from "./replays.js";
/**
 * Client half of the wire protocol.
 *
 * Keeps a snapshot of server state on `net.profile`, `net.search`, `net.found`
 * and `net.match`, and emits an event whenever one changes. Components read the
 * snapshot on mount and subscribe for updates — so a component that mounts a
 * beat late never misses a message that was already delivered.
 */

const secure = typeof location !== "undefined" && location.protocol === "https:";
const isDev = typeof import.meta !== "undefined" && import.meta.env?.DEV;
const host = typeof location !== "undefined" ? location.hostname : "localhost";
const origin = typeof location !== "undefined" ? location.host : "localhost:8787";

/**
 * In dev the client runs on Vite's port and the server on 8787.
 * In a build the server serves the client too, so same-origin is correct —
 * which also means https pages get wss automatically, with nothing to configure.
 * The socket lives at /ws (on Cloudflare the site root is plain static files).
 */
const SERVER_URL =
  (typeof import.meta !== "undefined" && import.meta.env?.VITE_SERVER_URL) ||
  (isDev ? `ws://${host}:8787/ws` : `${secure ? "wss" : "ws"}://${origin}/ws`);
// A quiet message now and then: hosts (Cloudflare among them) close a socket that stays silent.
const KEEPALIVE_MS = 25_000;

export const IS_SECURE = SERVER_URL.startsWith("wss://");
export const GOOGLE_CLIENT_ID =
  (typeof import.meta !== "undefined" && import.meta.env?.VITE_GOOGLE_CLIENT_ID) || "";

const RETRY_MS = [800, 1500, 3000, 5000, 10000];

class Net {
  constructor() {
    this.url = SERVER_URL;
    this.ws = null;
    this.status = "offline"; // offline | connecting | online
    this.profile = null;
    this.search = null; // { band, elapsed, queued }
    this.found = null; // { opponent, gap }
    this.match = null;
    this.lastError = null;

    this.token = null;
    this.auth = "anon"; // anon | authed
    this.authError = null;
    this.authBusy = false;
    this.codeSent = false;
    this.resetSent = false;
    this.online = null;   // people connected right now, from the server
    this.notice = null;   // one-off message for the menu (e.g. a match was interrupted)
    // Bumped on every auth-related change. `auth` alone is not enough: a failed
    // login goes anon -> anon, so the snapshot never changes and React skips
    // the re-render that would show the error.
    this.authRev = 0;
    this.attempt = 0;
    this.outbox = [];
    this.closing = false;
    this.queued = false;
    this.lastLoadout = null;
    this.listeners = new Map();
    // Guests: a name and an id this browser keeps, to come back as the same guest.
    this.guestInfo = readGuest();
    this.room = null;       // private room: { code, host, opponent, rematch, playing }
    this.roomError = null;
    this.guestError = null;
  }

  /* ---------- events ---------- */

  on(evt, fn) {
    if (!this.listeners.has(evt)) this.listeners.set(evt, new Set());
    this.listeners.get(evt).add(fn);
    return () => this.listeners.get(evt)?.delete(fn);
  }

  bumpAuth() {
    this.authRev++;
    this.emit("auth", this.authRev);
  }

  emit(evt, data) {
    this.listeners.get(evt)?.forEach((fn) => {
      try { fn(data); } catch (e) { console.error("[net] listener threw:", e); }
    });
  }

  setStatus(s) {
    if (this.status === s) return;
    this.status = s;
    this.emit("status", s);
  }

  /* ---------- connection ---------- */

  connect(token) {
    this.token = token || null;
    this.closing = false;
    this.attempt = 0;
    this.open();
  }

  open() {
    if (this.ws && (this.ws.readyState === 0 || this.ws.readyState === 1)) return;
    this.setStatus("connecting");

    let ws;
    try {
      ws = new WebSocket(this.url);
    } catch (e) {
      return this.scheduleRetry();
    }
    this.ws = ws;

    ws.onopen = () => {
      this.attempt = 0;
      clearInterval(this.keepalive);
      this.keepalive = setInterval(() => { if (this.ws === ws && ws.readyState === 1) ws.send('{"t":"ping"}'); }, KEEPALIVE_MS);
      // Signed in, or a guest coming back (e.g. after a refresh, mid-room).
      if (!this.token && this.guestInfo) this.raw({ t: "guest", name: this.guestInfo.name, gid: this.guestInfo.gid });
      else this.raw({ t: "hello", token: this.token });
      // A dropped socket removes you from the server queue. If we still think
      // we're searching, get back in line rather than waiting on a dead entry.
      if (this.queued && this.lastLoadout) this.raw({ t: "queue", loadout: this.lastLoadout, unranked: !!this.lastUnranked });
      const pending = this.outbox;
      this.outbox = [];
      pending.forEach((m) => this.raw(m));
    };

    ws.onmessage = (ev) => {
      let m;
      try { m = JSON.parse(ev.data); } catch (e) { return; }
      this.handle(m);
    };

    ws.onclose = () => {
      if (this.ws === ws) clearInterval(this.keepalive);
      this.setStatus("offline");
      if (!this.closing) this.scheduleRetry();
    };

    ws.onerror = () => { /* onclose always follows */ };
  }

  scheduleRetry() {
    const wait = RETRY_MS[Math.min(this.attempt, RETRY_MS.length - 1)];
    this.attempt++;
    setTimeout(() => { if (!this.closing) this.open(); }, wait);
  }

  disconnect() {
    this.closing = true;
    this.ws?.close();
  }

  /* ---------- outbound ---------- */

  raw(obj) {
    if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(obj));
  }

  send(obj) {
    if (this.ws && this.ws.readyState === 1) return this.raw(obj);
    // Auth requests are time-sensitive: queueing them silently looks like a hang.
    if (["signup", "login", "google", "verify", "resend", "resetRequest", "resetConfirm"].includes(obj.t)) {
      this.authBusy = false;
      this.authError = "Can't reach the server. Check your connection and try again.";
      this.bumpAuth();
      this.open();
      return;
    }
    this.outbox.push(obj);
  }

  queue(loadout, unranked = false) {
    this.queued = true;
    this.lastLoadout = loadout;
    this.lastUnranked = unranked;
    this.search = { band: 40, elapsed: 0, queued: 1 };
    this.found = null;
    this.match = null;
    this.emit("search", this.search);
    this.send({ t: "queue", loadout, unranked });
  }

  unqueue() {
    this.queued = false;
    this.search = null;
    this.found = null;
    this.emit("search", null);
    this.send({ t: "unqueue" });
  }

  /* ---------- guests and private rooms ---------- */

  playAsGuest(name) {
    this.guestError = null;
    this.emit("room", this.room);
    this.send({ t: "guest", name, gid: this.guestInfo?.gid });
  }

  createRoom() {
    this.roomError = null;
    this.send({ t: "createRoom" });
  }

  joinRoom(code) {
    this.roomError = null;
    this.emit("room", this.room);
    this.send({ t: "joinRoom", code });
  }

  leaveRoom() {
    this.room = null;
    this.emit("room", null);
    this.send({ t: "leaveRoom" });
  }

  rematch() {
    this.send({ t: "rematch" });
  }

  setName(name) {
    this.send({ t: "setName", name });
  }

  signup(username, email, password) {
    this.authBusy = true;
    this.authError = null;
    this.bumpAuth();
    this.send({ t: "signup", username, email, password });
  }

  google(credential) {
    this.authBusy = true;
    this.authError = null;
    this.bumpAuth();
    this.send({ t: "google", credential });
  }

  verify(code) {
    this.authBusy = true;
    this.authError = null;
    this.bumpAuth();
    this.send({ t: "verify", code, token: this.token });
  }

  resend() {
    this.authError = null;
    this.codeSent = false;
    this.bumpAuth();
    this.send({ t: "resend", token: this.token });
  }

  requestReset(email) {
    this.authBusy = true;
    this.authError = null;
    this.resetSent = false;
    this.bumpAuth();
    this.send({ t: "resetRequest", email });
  }

  confirmReset(email, code, password) {
    this.authBusy = true;
    this.authError = null;
    this.bumpAuth();
    this.send({ t: "resetConfirm", email, code, password });
  }

  setNotice(msg) {
    this.notice = msg;
    this.emit("notice", msg);
  }

  login(username, password) {
    this.authBusy = true;
    this.authError = null;
    this.bumpAuth();
    this.send({ t: "login", username, password });
  }

  logout() {
    if (this.auth === "guest") { this.guestInfo = null; writeGuest(null); }
    this.room = null;
    this.emit("room", null);
    this.send({ t: "logout", token: this.token });
    this.token = null;
    this.auth = "anon";
    this.profile = null;
    this.match = null;
    this.search = null;
    this.found = null;
    this.emit("profile", null);
    this.emit("match", null);
    this.bumpAuth();
  }

  move({ turn, handIdx, rot, pos, pins, pin }) {
    this.send({ t: "move", turn, handIdx, rot, pos, ...(pins ? { pins } : null), ...(pin ? { pin: true } : null) });
  }

  /** Delete 1–4 connected squares; may carry free pins. */
  erase({ turn, cells, pins }) {
    this.send({ t: "delete", turn, cells, ...(pins ? { pins } : null) });
  }

  /* ---------- safety ---------- */

  /** Block or unblock a player by name: their chat stops reaching you and queues never pair you. */
  block(name, on = true) { this.send({ t: on ? "block" : "unblock", name }); }
  isBlocked(name) { return !!name && (this.blocked || new Set()).has(name); }
  /** Report a player: reason is chat | name | cheating | other. */
  report(name, reason, note = "") { this.send({ t: "report", name, reason, note: String(note).slice(0, 300) }); }
  /** Deletes the signed-in account for good: password accounts confirm with the password, Google ones with the username. */
  deleteAccount({ password, confirm }) { this.send({ t: "deleteAccount", password, confirm }); }

  /** A line of chat to your opponent (the server filters it and echoes it back). */
  chat(text) {
    const t = String(text || "").trim().slice(0, 120);
    if (t) this.send({ t: "chat", text: t });
  }

  /** Marathon: ask for a seed (the server checks the finished game against it). */
  marathonStart() { this.send({ t: "marathonStart" }); }
  /* ---------- Blitz 1v1 ---------- */
  blitzQueue() { this.blitz = null; this.send({ t: "blitzQueue" }); }
  blitzCancel() { this.send({ t: "unqueue" }); }
  setCard(card) { this.send({ t: "setCard", card }); }
  blitzPlace(slot, rot, r, c) { this.send({ t: "blitzPlace", slot, rot, r, c }); }
  patchBlitz(p) { this.blitz = { ...(this.blitz || {}), ...p }; this.emit("blitz", this.blitz); }

  /** Sprint/Ultra: ask for a seed (the finished run is replayed against it to rank it). */
  soloStart(mode) { this.send({ t: "soloStart", mode }); }
  soloEnd(mode, seed, moves) { this.send({ t: "soloEnd", mode, seed, moves }); }
  /** Marathon: the finished game, as its moves (see shared/marathon.js encodeMoves). */
  marathonEnd(seed, moves) { this.send({ t: "marathonEnd", seed, moves }); }
  /** Marathon: keep this unfinished game on the server to come back to (signed in only). */
  marathonSave(seed, moves) { this.send({ t: "marathonSave", seed, moves }); }

  forfeit() {
    this.send({ t: "forfeit" });
  }

  discard({ turn, handIdx, pins }) {
    this.send({ t: "discard", turn, handIdx, ...(pins ? { pins } : null) });
  }

  /* ---------- inbound ---------- */

  patch(fields) {
    this.match = { ...this.match, ...fields };
    this.emit("match", this.match);
  }

  handle(m) {
    switch (m.t) {
      case "guestOk":
        this.auth = "guest";
        this.authBusy = false;
        this.guestError = null;
        this.profile = { ...m.profile, guest: true };
        this.guestInfo = { gid: m.gid, name: m.profile.name };
        writeGuest(this.guestInfo);
        this.setStatus("online");
        this.emit("profile", this.profile);
        this.emit("room", this.room);
        this.bumpAuth();
        if (!m.inMatch && this.match && !this.match.over) {
          this.match = null;
          this.setNotice("Your last match ended while you were away.");
          this.emit("match", null);
        }
        break;

      case "guestError":
        this.guestError = m.msg;
        this.emit("room", this.room);
        break;

      case "room":
        this.room = { code: m.code, host: m.host, opponent: m.opponent, rematch: m.rematch, playing: m.playing };
        this.roomError = null;
        this.emit("room", this.room);
        break;

      case "roomError":
        this.roomError = m.msg;
        this.emit("room", this.room);
        break;

      case "roomClosed":
        this.room = null;
        this.roomError = m.why || null;
        this.emit("room", null);
        break;

      case "needAuth":
        this.auth = "anon";
        this.authBusy = false;
        this.profile = null;
        this.setStatus("online");
        this.emit("profile", null);
        this.bumpAuth();
        break;

      case "auth":
        // We thought we were mid-match, but the server has no record of it:
        // it restarted (usually a deploy). Say so instead of hanging.
        if (this.match && !this.match.over && !m.inMatch) {
          this.match = null;
          this.found = null;
          this.emit("match", null);
          this.setNotice("Your match was interrupted by a server restart and didn't count.");
        }
        this.blocked = new Set(m.blocked || []);
        this.emit("blocked", this.blocked);
        this.token = m.token;
        this.auth = "authed";
        this.authBusy = false;
        this.authError = null;
        this.profile = m.profile;
        this.setStatus("online");
        this.emit("token", m.token);
        this.emit("profile", this.profile);
        this.bumpAuth();
        break;

      case "authError":
        this.authBusy = false;
        this.authError = m.msg;
        this.bumpAuth();
        break;

      case "profile":
        // Your profile after a change you made (e.g. your card's colours).
        if (m.profile) { this.profile = m.profile; this.emit("profile", this.profile); }
        break;

      case "verified":
        this.authBusy = false;
        this.authError = null;
        this.profile = m.profile;
        this.emit("profile", this.profile);
        this.bumpAuth();
        break;

      case "resetSent":
        this.authBusy = false;
        this.resetSent = true;
        this.bumpAuth();
        break;

      case "online":
        // Which server answered (older servers don't say).
        if (m.host) this.serverHost = m.host;
        this.online = m.n;
        // How many are queueing and playing each ranked mode (for the lobbies).
        if (m.queueing) this.lobby = { queueing: m.queueing, playing: m.playing };
        this.emit("online", m.n);
        break;

      case "nameError":
        this.emit("nameError", m.msg);
        break;

      case "codeSent":
        this.codeSent = true;
        this.authError = null;
        this.bumpAuth();
        break;

      case "needVerify":
        this.authError = "Verify your email first.";
        this.bumpAuth();
        break;

      case "welcome":
        this.profile = m.profile;
        this.setStatus("online");
        this.emit("profile", this.profile);
        break;

      case "searching":
        this.search = { band: m.band, elapsed: m.elapsed, queued: m.queued };
        this.emit("search", this.search);
        break;

      case "marathonSeed":
        this.emit("marathonSeed", m);
        break;

      case "marathonSaved":
        if (m.ok && this.profile) {
          this.profile = { ...this.profile, marathonOpen: { score: m.score, lines: m.lines, at: Date.now() } };
          this.emit("profile", this.profile);
        }
        break;

      case "blitzStart":
        this.blitz = { id: m.id, you: m.you, seed: m.seed, countdown: m.countdown, opponent: m.opponent, resume: !!m.resume, chat: this.blitz?.id === m.id ? this.blitz.chat : [], chatError: null, over: false, got: Date.now() };
        this.emit("blitzStart", this.blitz);
        this.emit("blitz", this.blitz);
        break;
      case "blitzState":
        this.emit("blitzState", m);
        break;
      case "blitzJunk":
        this.emit("blitzJunk", m);
        break;
      case "blitzEnd":
        if (this.blitz) this.patchBlitz({ over: true });
        if (m.ratings && this.profile) {
          const after = m.ratings[m.you]?.after;
          this.profile = { ...this.profile, blitz: { ...(this.profile.blitz || {}), rating: { ...(this.profile.blitz?.rating || {}), r: after } } };
          this.emit("profile", this.profile);
        }
        this.emit("blitzEnd", m);
        break;

      case "soloSeed":
        this.emit("soloSeed", m);
        break;

      case "soloResult":
        if (m.saved && m.mode && this.profile) {
          const prev = this.profile[m.mode] || {};
          this.profile = { ...this.profile, [m.mode]: { ...prev, best: m.best } };
          this.emit("profile", this.profile);
        }
        this.emit("soloResult", m);
        break;

      case "marathonResult":
        if (this.profile) this.profile = { ...this.profile, marathonOpen: null };
        if (m.saved && this.profile) {
          this.profile = { ...this.profile, marathon: { ...(this.profile.marathon || {}), best: Math.max(m.best || 0, this.profile.marathon?.best || 0) } };
          this.emit("profile", this.profile);
        }
        this.emit("marathonResult", m);
        break;

      case "found":
        this.queued = false;
        this.found = { opponent: m.opponent, gap: m.gap, matchId: m.matchId, room: m.room || null, at: Date.now() };
        this.search = null;
        this.emit("found", this.found);
        break;

      case "matchStart":
        this.match = {
          matchId: m.matchId,
          you: m.you,
          opponent: m.opponent,
          loadout: m.loadout,
          turns: m.turns,
          rated: m.rated !== false,
          room: m.room || null,
          turn: 0,
          board: null,
          hand: [],
          piece: null,
          queue: [],
          pass: 1,
          opp: null,
          deadline: 0,
          submitted: false,
          oppReady: false,
          reveal: null,
          over: null,
          oppDropped: false,
          resumed: !!m.resumed,
          chat: [],           // this match's chat, oldest first (never stored on the server)
          chatError: null,
        };
        this.emit("match", this.match);
        break;

      case "turn":
        this.patch({
          turn: m.turn,
          board: m.board,
          hand: m.hand,
          piece: m.piece,     // the one piece you play this turn
          queue: m.queue,     // your next pieces, in order
          pass: m.pass,       // which pass through your deck
          opp: m.opp,         // { piece, queue, pass } — both queues are public
          pins: m.pins || null,     // permanent squares
          meters: m.meters || { me: 0, opp: 0 },
          ot: !!m.ot,
          deadline: m.deadline,
          submitted: !!m.alreadyMoved,
          oppReady: false,
          reveal: null,
        });
        break;

      case "ack":
        this.patch({ submitted: true });
        break;

      case "clock":
        this.patch({ deadline: m.deadline });
        break;

      case "oppReady":
        this.patch({ oppReady: true });
        break;

      case "reveal":
        this.patch({
          board: m.board,
          pins: m.pins || this.match?.pins || null,
          meters: m.meters || this.match?.meters,
          ot: m.ot ?? this.match?.ot,
          otStarted: !!m.otStarted,
          shrunk: !!m.shrunk,
          reveal: { moves: m.moves, contested: m.contested, cleared: m.cleared || [], lines: m.lines || { rows: [], cols: [] }, score: m.score, turn: m.turn },
          submitted: false,
          oppReady: false,
        });
        break;

      case "matchOver":
        // Every online match is kept as a replay on this device.
        if (m.replay) replays.save(m.replay);
        this.patch({ over: m });
        if (m.profile) {
          this.profile = { ...this.profile, ...m.profile };
          this.emit("profile", this.profile);
        }
        break;

      case "blocked":
        this.blocked = new Set(m.list || []);
        this.emit("blocked", this.blocked);
        break;

      case "reported":
        this.emit("reported", m.name);
        break;

      case "deleteError":
        this.emit("deleteError", m.msg);
        break;

      case "accountDeleted":
        // Gone on the server: forget it here too, without asking the server to log out.
        this.token = null;
        this.auth = "anon";
        this.profile = null;
        this.blocked = new Set();
        this.emit("profile", null);
        this.emit("accountDeleted");
        this.bumpAuth();
        break;

      case "chat":
        // A Blitz match has its own chat.
        if (this.blitz && !this.blitz.over) {
          if (this.isBlocked(m.name) && this.blitz.you !== m.side) break;
          this.patchBlitz({ chat: [...(this.blitz.chat || []), { side: m.side, name: m.name, text: m.text, at: m.at, got: Date.now() }].slice(-60), chatError: null });
          break;
        }
        // Lines from someone you blocked are dropped here too (the server already stops them).
        if (this.match && this.isBlocked(m.name) && this.match.you !== m.side) break;
        if (this.match) this.patch({ chat: [...(this.match.chat || []), { side: m.side, name: m.name, text: m.text, at: m.at, got: Date.now() }].slice(-60), chatError: null });
        break;

      case "chatError":
        if (this.blitz && !this.blitz.over) { this.patchBlitz({ chatError: m.msg }); break; }
        if (this.match) this.patch({ chatError: m.msg });
        break;

      case "oppDropped":
        this.patch({ oppDropped: true, graceUntil: Date.now() + (m.grace || 30000) });
        break;

      case "oppReturned":
        this.patch({ oppDropped: false, graceUntil: null });
        break;

      case "kicked":
        // Another session took over this account. Stop reconnecting, or the
        // two clients boot each other back and forth indefinitely.
        this.closing = true;
        this.queued = false;
        this.setStatus("kicked");
        this.emit("error", "Signed in somewhere else.");
        break;

      case "error":
        this.lastError = m.msg;
        this.emit("error", m.msg);
        console.warn("[net] server said:", m.msg);
        break;

      default:
        break;
    }
  }

  clearMatch() {
    this.match = null;
    this.found = null;
    this.emit("match", null);
  }
}

export const net = new Net();
export { SERVER_URL };

/* Guests are remembered per browser: a name and a random id, nothing else. */
function readGuest() {
  try {
    const g = JSON.parse(localStorage.getItem("tb:guest") || "null");
    return g && typeof g.gid === "string" && typeof g.name === "string" ? g : null;
  } catch { return null; }
}
function writeGuest(g) {
  try { if (g) localStorage.setItem("tb:guest", JSON.stringify(g)); else localStorage.removeItem("tb:guest"); } catch { /* private mode */ }
}
