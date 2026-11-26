/**
 * Accounts, sessions and profiles: the in-memory model.
 *
 * This module only holds the data and reports every change; where it's kept
 * is up to a persister:
 *   server/filestore.js   Node (Render, local): one JSON file, atomic writes,
 *                         rolling backups
 *   cloudflare/game.js    Cloudflare: the Durable Object's own storage,
 *                         record by record
 * attachStore(db, onChange) hands it the loaded data and a callback that's
 * told (table, key) whenever a record is created, changed or deleted.
 *
 * Every lookup table is a null-prototype object, so a username like
 * "__proto__" or "constructor" is just a key, not a trip into Object.prototype.
 */
import { newRating } from "../shared/glicko.js";
import { newUserId, newToken } from "./auth.js";

const SESSION_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
export const TABLES = ["accounts", "usernames", "emails", "identities", "sessions", "profiles", "reports"];

const table = (src = {}) => Object.assign(Object.create(null), src);
const has = (t, k) => Object.prototype.hasOwnProperty.call(t, k);

export function emptyDb() {
  const db = {};
  for (const t of TABLES) db[t] = table();
  return db;
}

/** A db from plain objects (a parsed JSON file, or records read back one by one). */
export function dbFrom(parsed) {
  const db = emptyDb();
  for (const t of TABLES) Object.assign(db[t], (parsed && parsed[t]) || {});
  return db;
}

let db = emptyDb();
let onChange = () => {};
let flusher = () => {};
const mark = (t, k) => onChange(t, k);

/** Installs the loaded data and the change callback (and optionally a flush hook for shutdown). */
export function attachStore(loaded, changed, flush = () => {}) {
  db = loaded;
  onChange = changed;
  flusher = flush;
  pruneSessions();
}

/** The whole db, for persisters that write it out in one piece. */
export const snapshot = () => db;
/** A record as stored now, or undefined if it was deleted. */
export const recordOf = (t, k) => (has(db[t], k) ? db[t][k] : undefined);

/** Drops expired sessions (at start, then hourly by whoever hosts the store). */
export function pruneSessions() {
  const now = Date.now();
  for (const [t, s] of Object.entries(db.sessions)) {
    if (s.expires < now) { delete db.sessions[t]; mark("sessions", t); }
  }
}

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
  mark("identities", `${provider}:${sub}`);
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
  mark("accounts", account.userId);
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
  mark("accounts", userId);
  mark("usernames", lower(username));
  if (mail) mark("emails", mail);
  db.profiles[userId] = {
    playerId: userId,
    name: username,
    rating: newRating(),
    stats: emptyStats(),
    createdAt: Date.now(),
  };
  mark("profiles", userId);
  return account;
}

/* ---------- sessions ---------- */

export function createSession(userId) {
  const token = newToken();
  db.sessions[token] = { userId, expires: Date.now() + SESSION_MS };
  mark("sessions", token);
  return token;
}

export function resolveSession(token) {
  if (typeof token !== "string" || !has(db.sessions, token)) return null;
  const s = db.sessions[token];
  if (s.expires < Date.now()) { delete db.sessions[token]; mark("sessions", token); return null; }
  return s.userId;
}

export function destroySession(token) {
  if (typeof token === "string" && has(db.sessions, token)) { delete db.sessions[token]; mark("sessions", token); }
}

/** Signs a user out everywhere — used after a password reset. */
export function destroySessionsFor(userId) {
  for (const [t, s] of Object.entries(db.sessions)) {
    if (s.userId === userId) { delete db.sessions[t]; mark("sessions", t); }
  }
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
    mark("profiles", userId);
  }
  const p = db.profiles[userId];
  if (!p.rating) p.rating = newRating();
  if (!p.stats) p.stats = emptyStats();
  return p;
}

export function saveProfile(profile) {
  db.profiles[profile.playerId] = profile;
  mark("profiles", profile.playerId);
}

/** Final save, for shutdown (whatever the persister does). */
export const flush = () => flusher();

/* ---------- deleting an account ---------- */

/**
 * Removes everything stored for `userId`: the account, its name and email
 * claims, linked sign-ins, sessions and profile (ratings, stats, Marathon).
 * Other players' match lists keep the match but no longer name them.
 */
export function deleteAccountData(userId) {
  const acct = getAccount(userId);
  if (!acct) return false;
  const name = (db.profiles[userId] && db.profiles[userId].name) || acct.username;
  for (const [k, v] of Object.entries(db.usernames)) if (v === userId) { delete db.usernames[k]; mark("usernames", k); }
  for (const [k, v] of Object.entries(db.emails)) if (v === userId) { delete db.emails[k]; mark("emails", k); }
  for (const [k, v] of Object.entries(db.identities)) if (v === userId) { delete db.identities[k]; mark("identities", k); }
  destroySessionsFor(userId);
  delete db.accounts[userId]; mark("accounts", userId);
  delete db.profiles[userId]; mark("profiles", userId);
  for (const a of Object.values(db.accounts)) {
    if (a.blocked && a.blocked.includes(userId)) { a.blocked = a.blocked.filter((id) => id !== userId); mark("accounts", a.userId); }
  }
  for (const p of Object.values(db.profiles)) {
    const recent = p.stats && p.stats.recent;
    if (!recent || !recent.some((m) => m.name === name)) continue;
    p.stats.recent = recent.map((m) => (m.name === name ? { ...m, name: "deleted player" } : m));
    mark("profiles", p.playerId);
  }
  return true;
}

/* ---------- reports ---------- */

/** Keeps a player report (who, about whom, why, and the chat around it). */
export function saveReport(report) {
  const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  db.reports[id] = { id, ...report };
  mark("reports", id);
  return db.reports[id];
}

/** Every stored profile (for the leaderboard and player search). Read-only use. */
export const allProfiles = () => Object.values(db.profiles);
/** A profile if there is one; unlike getProfile, never creates it. */
export const peekProfile = (userId) => (userId && has(db.profiles, userId) ? db.profiles[userId] : null);

export const countAccounts = () => Object.keys(db.accounts).length;
