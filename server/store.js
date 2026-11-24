/**
 * Accounts, sessions and profiles.
 *
 * Still a JSON file — zero dependencies, inspectable while debugging — but
 * written so it can't eat itself:
 *
 *   - Writes go to a temp file, are fsynced, then renamed over the real one.
 *     A rename is atomic, so a crash leaves either the old file or the new
 *     one on disk, never half of each.
 *   - Rolling backups (hourly, last 48 kept) sit next to it.
 *   - If the file can't be read, it is set aside (never overwritten) and the
 *     newest readable backup is restored in its place. If no backup reads
 *     either, the server refuses to start. The old behaviour — start empty
 *     and overwrite the file two seconds later — turned one bad write into
 *     every account gone.
 *
 * Every lookup table is a null-prototype object, so a username like
 * "__proto__" or "constructor" is just a key, not a trip into Object.prototype.
 *
 * The file lives in DATA_DIR (default: this folder). On Render, point DATA_DIR
 * at the persistent disk or every deploy starts from nothing.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { newRating } from "../shared/glicko.js";
import { newUserId, newToken } from "./auth.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const DATA_DIR = path.resolve(process.env.DATA_DIR || HERE);
const FILE = path.join(DATA_DIR, "data.json");
const TMP = FILE + ".tmp";
const BACKUP_DIR = path.join(DATA_DIR, "backups");
const BACKUP_EVERY_MS = 60 * 60 * 1000;
const BACKUPS_KEPT = 48;
const SESSION_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const TABLES = ["accounts", "usernames", "emails", "identities", "sessions", "profiles"];

const table = (src = {}) => Object.assign(Object.create(null), src);
const has = (t, k) => Object.prototype.hasOwnProperty.call(t, k);

function emptyDb() {
  const db = {};
  for (const t of TABLES) db[t] = table();
  return db;
}

function parse(raw) {
  const parsed = JSON.parse(raw);
  const db = emptyDb();
  for (const t of TABLES) Object.assign(db[t], parsed[t] || {});
  return db;
}

function load() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  // A leftover temp file means a write was interrupted. The real file is
  // still the last good copy, so the temp one is just discarded.
  if (fs.existsSync(TMP)) fs.rmSync(TMP);
  if (!fs.existsSync(FILE)) return emptyDb();

  const raw = fs.readFileSync(FILE, "utf8");
  // A zero-byte file is a fresh install (the repo used to ship one), not damage.
  if (!raw.trim()) return emptyDb();
  try {
    return parse(raw);
  } catch (e) {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const aside = path.join(DATA_DIR, `data.corrupt-${stamp}.json`);
    fs.renameSync(FILE, aside);
    console.error(`[store] ${FILE} is unreadable (${e.message}). Moved it to ${aside}.`);

    const backups = fs.existsSync(BACKUP_DIR)
      ? fs.readdirSync(BACKUP_DIR).filter((f) => f.startsWith("data-")).sort().reverse()
      : [];
    for (const f of backups) {
      try {
        const full = path.join(BACKUP_DIR, f);
        const db = parse(fs.readFileSync(full, "utf8"));
        fs.copyFileSync(full, FILE);
        console.error(`[store] Restored ${f} — anything saved after that backup is lost.`);
        return db;
      } catch {
        console.error(`[store] Backup ${f} is unreadable too, trying an older one.`);
      }
    }
    console.error(`[store] No readable backup in ${BACKUP_DIR}. Refusing to start rather than lose accounts.`);
    process.exit(1);
  }
}

let db = load();
let dirty = false;
let writing = false;

// Drop expired sessions at boot, and hourly after that.
function pruneSessions() {
  const now = Date.now();
  for (const [t, s] of Object.entries(db.sessions)) {
    if (s.expires < now) { delete db.sessions[t]; dirty = true; }
  }
}
pruneSessions();
setInterval(pruneSessions, 60 * 60 * 1000).unref();

function writeAtomic(json) {
  const fd = fs.openSync(TMP, "w");
  try {
    fs.writeSync(fd, json);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(TMP, FILE);
}

function save() {
  if (!dirty || writing) return;
  writing = true;
  dirty = false;
  try {
    writeAtomic(JSON.stringify(db));
  } catch (e) {
    dirty = true; // try again next tick
    console.error("[store] write failed:", e.message);
  } finally {
    writing = false;
  }
}
setInterval(save, 2000).unref();

function backup() {
  if (!fs.existsSync(FILE)) return;
  try {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    fs.copyFileSync(FILE, path.join(BACKUP_DIR, `data-${stamp}.json`));
    const old = fs.readdirSync(BACKUP_DIR).filter((f) => f.startsWith("data-")).sort();
    for (const f of old.slice(0, Math.max(0, old.length - BACKUPS_KEPT))) fs.rmSync(path.join(BACKUP_DIR, f));
  } catch (e) {
    console.error("[store] backup failed:", e.message);
  }
}
backup();
setInterval(backup, BACKUP_EVERY_MS).unref();

const emptyStats = () => ({
  games: 0, wins: 0, losses: 0,
  seconds: 0,
  streak: 0, bestStreak: 0,
  peakTr: 1500, peakRank: null,
  squares: 0, special: 0,
  history: [],
  recent: [],
});

/* ---------- accounts ---------- */

const lower = (s) => String(s).toLowerCase();

export const findByUsername = (username) => {
  const k = lower(username);
  return has(db.usernames, k) ? db.accounts[db.usernames[k]] || null : null;
};

export const findByEmail = (email) => {
  const k = lower(email);
  return has(db.emails, k) ? db.accounts[db.emails[k]] || null : null;
};

export const findByIdentity = (provider, sub) => {
  const k = `${provider}:${sub}`;
  return has(db.identities, k) ? db.accounts[db.identities[k]] || null : null;
};

/** True if `name` is someone's username or display name, other than `exceptUserId`'s. */
export function nameTaken(name, exceptUserId = null) {
  const k = lower(name);
  if (has(db.usernames, k) && db.usernames[k] !== exceptUserId) return true;
  for (const p of Object.values(db.profiles)) {
    if (p.playerId !== exceptUserId && lower(p.name) === k) return true;
  }
  return false;
}

export function linkIdentity(userId, provider, sub) {
  db.identities[`${provider}:${sub}`] = userId;
  dirty = true;
}

/** Google usernames come from the email local part; make it unique. */
export function freeUsername(base) {
  const clean = String(base || "player").replace(/[^a-zA-Z0-9_]/g, "").slice(0, 12) || "player";
  let name = clean.length >= 3 ? clean : `${clean}_p`;
  let n = 1;
  while (nameTaken(name)) {
    const suffix = String(n++);
    name = clean.slice(0, 16 - suffix.length) + suffix;
  }
  return name;
}

export function saveAccount(account) {
  db.accounts[account.userId] = account;
  dirty = true;
}

export const getAccount = (userId) => (userId && has(db.accounts, userId) ? db.accounts[userId] : null);

/**
 * Creates an account, or returns null if the username or email was claimed
 * in the meantime. Callers check first for a friendly message, but signup
 * awaits password hashing between that check and this call, so two people
 * racing for one name both pass it — this is the check that counts.
 */
export function createAccount({ username, email, salt, hash, provider = "password", emailVerified = false }) {
  const mail = email ? lower(email) : null;
  if (nameTaken(username) || (mail && has(db.emails, mail))) return null;
  const userId = newUserId();
  const account = {
    userId,
    username,
    email: mail,
    emailVerified,
    provider,
    salt: salt || null,
    hash: hash || null,
    code: null,
    reset: null,
    createdAt: Date.now(),
  };
  db.accounts[userId] = account;
  db.usernames[lower(username)] = userId;
  if (mail) db.emails[mail] = userId;
  db.profiles[userId] = {
    playerId: userId,
    name: username,
    rating: newRating(),
    stats: emptyStats(),
    createdAt: Date.now(),
  };
  dirty = true;
  return account;
}

/* ---------- sessions ---------- */

export function createSession(userId) {
  const token = newToken();
  db.sessions[token] = { userId, expires: Date.now() + SESSION_MS };
  dirty = true;
  return token;
}

export function resolveSession(token) {
  if (typeof token !== "string" || !has(db.sessions, token)) return null;
  const s = db.sessions[token];
  if (s.expires < Date.now()) { delete db.sessions[token]; dirty = true; return null; }
  return s.userId;
}

export function destroySession(token) {
  if (typeof token === "string" && has(db.sessions, token)) { delete db.sessions[token]; dirty = true; }
}

/** Signs a user out everywhere — used after a password reset. */
export function destroySessionsFor(userId) {
  for (const [t, s] of Object.entries(db.sessions)) {
    if (s.userId === userId) delete db.sessions[t];
  }
  dirty = true;
}

/* ---------- profiles ---------- */

export function getProfile(userId) {
  if (!has(db.profiles, userId)) {
    const acct = getAccount(userId);
    db.profiles[userId] = {
      playerId: userId,
      name: acct ? acct.username : String(userId).slice(0, 6),
      rating: newRating(),
      stats: emptyStats(),
      createdAt: Date.now(),
    };
    dirty = true;
  }
  const p = db.profiles[userId];
  if (!p.rating) p.rating = newRating();
  if (!p.stats) p.stats = emptyStats();
  return p;
}

export function saveProfile(profile) {
  db.profiles[profile.playerId] = profile;
  dirty = true;
}

/** Synchronous final save, for shutdown. */
export function flush() {
  dirty = true;
  writing = false;
  save();
}

export const countAccounts = () => Object.keys(db.accounts).length;
export const dataFile = () => FILE;
