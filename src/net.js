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
 */
const SERVER_URL =
  (typeof import.meta !== "undefined" && import.meta.env?.VITE_SERVER_URL) ||
  (isDev ? `ws://${host}:8787` : `${secure ? "wss" : "ws"}://${origin}`);

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
    this.attempt = 0;
    this.outbox = [];
    this.closing = false;
    this.listeners = new Map();
  }

  /* ---------- events ---------- */

  on(evt, fn) {
    if (!this.listeners.has(evt)) this.listeners.set(evt, new Set());
    this.listeners.get(evt).add(fn);
    return () => this.listeners.get(evt)?.delete(fn);
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
      this.raw({ t: "hello", token: this.token });
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
    if (this.ws && this.ws.readyState === 1) this.raw(obj);
    else this.outbox.push(obj);
  }

  queue(loadout) {
    this.search = { band: 40, elapsed: 0, queued: 1 };
    this.found = null;
    this.match = null;
    this.emit("search", this.search);
    this.send({ t: "queue", loadout });
  }

  unqueue() {
    this.search = null;
    this.found = null;
    this.emit("search", null);
    this.send({ t: "unqueue" });
  }

  setName(name) {
    this.send({ t: "setName", name });
  }

  signup(username, email, password) {
    this.authBusy = true;
    this.authError = null;
    this.emit("auth", this.auth);
    this.send({ t: "signup", username, email, password });
  }

  google(credential) {
    this.authBusy = true;
    this.authError = null;
    this.emit("auth", this.auth);
    this.send({ t: "google", credential });
  }

  verify(code) {
    this.authBusy = true;
    this.authError = null;
    this.emit("auth", this.auth);
    this.send({ t: "verify", code, token: this.token });
  }

  resend() {
    this.authError = null;
    this.codeSent = false;
    this.send({ t: "resend", token: this.token });
  }

  login(username, password) {
    this.authBusy = true;
    this.authError = null;
    this.emit("auth", this.auth);
    this.send({ t: "login", username, password });
  }

  logout() {
    this.send({ t: "logout", token: this.token });
    this.token = null;
    this.auth = "anon";
    this.profile = null;
    this.match = null;
    this.search = null;
    this.found = null;
    this.emit("profile", null);
    this.emit("match", null);
    this.emit("auth", this.auth);
  }

  move({ turn, handIdx, rot, pos }) {
    this.send({ t: "move", turn, handIdx, rot, pos });
  }

  discard({ turn, handIdx }) {
    this.send({ t: "discard", turn, handIdx });
  }

  /* ---------- inbound ---------- */

  patch(fields) {
    this.match = { ...this.match, ...fields };
    this.emit("match", this.match);
  }

  handle(m) {
    switch (m.t) {
      case "needAuth":
        this.auth = "anon";
        this.authBusy = false;
        this.profile = null;
        this.setStatus("online");
        this.emit("profile", null);
        this.emit("auth", this.auth);
        break;

      case "auth":
        this.token = m.token;
        this.auth = "authed";
        this.authBusy = false;
        this.authError = null;
        this.profile = m.profile;
        this.setStatus("online");
        this.emit("token", m.token);
        this.emit("profile", this.profile);
        this.emit("auth", this.auth);
        break;

      case "authError":
        this.authBusy = false;
        this.authError = m.msg;
        this.emit("auth", this.auth);
        break;

      case "verified":
        this.authBusy = false;
        this.authError = null;
        this.profile = m.profile;
        this.emit("profile", this.profile);
        this.emit("auth", this.auth);
        break;

      case "codeSent":
        this.codeSent = true;
        this.authError = null;
        this.emit("auth", this.auth);
        break;

      case "needVerify":
        this.authError = "Verify your email first.";
        this.emit("auth", this.auth);
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

      case "found":
        this.found = { opponent: m.opponent, gap: m.gap, matchId: m.matchId };
        this.search = null;
        this.emit("found", this.found);
        break;

      case "matchStart":
        this.match = {
          matchId: m.matchId,
          you: m.you,
          opponent: m.opponent,
          turns: m.turns,
          turn: 0,
          board: null,
          hand: [],
          deckLeft: 0,
          oppHandCount: 0,
          deadline: 0,
          submitted: false,
          oppReady: false,
          reveal: null,
          over: null,
          oppDropped: false,
          resumed: !!m.resumed,
        };
        this.emit("match", this.match);
        break;

      case "turn":
        this.patch({
          turn: m.turn,
          board: m.board,
          hand: m.hand,
          deckLeft: m.deckLeft,
          oppHandCount: m.oppHandCount,
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
          reveal: { moves: m.moves, contested: m.contested, score: m.score, turn: m.turn },
          submitted: false,
          oppReady: false,
        });
        break;

      case "matchOver":
        this.patch({ over: m });
        if (m.profile) {
          this.profile = { ...this.profile, ...m.profile };
          this.emit("profile", this.profile);
        }
        break;

      case "oppDropped":
        this.patch({ oppDropped: true, graceMs: m.grace });
        break;

      case "oppReturned":
        this.patch({ oppDropped: false });
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