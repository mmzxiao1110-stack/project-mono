/**
 * Accounts, sessions and profiles.
 *
 * Still a JSON file — zero dependencies, inspectable while debugging. The
 * shape below is deliberately provider-agnostic so a Google account can be
 * added later as another row in `identities` without touching anything else.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { newRating } from "../shared/glicko.js";
import { newUserId, newToken } from "./auth.js";

const DIR = path.dirname(fileURLToPath(import.meta.url));
const FILE = path.join(DIR, "data.json");
const SESSION_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

let db = { accounts: {}, usernames: {}, emails: {}, identities: {}, sessions: {}, profiles: {} };
let dirty = false;

try {
  if (fs.existsSync(FILE)) {
    db = { accounts: {}, usernames: {}, emails: {}, identities: {}, sessions: {}, profiles: {}, ...JSON.parse(fs.readFileSync(FILE, "utf8")) };
  }
} catch (e) {
  console.error("[store] could not read data.json, starting fresh:", e.message);
}

// Drop expired sessions at boot.
for (const [t, s] of Object.entries(db.sessions)) {
  if (s.expires < Date.now()) delete db.sessions[t];
}

setInterval(() => {
  if (!dirty) return;
  dirty = false;
  fs.writeFile(FILE, JSON.stringify(db, null, 2), (err) => {
    if (err) console.error("[store] write failed:", err.message);
  });
}, 2000).unref();

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

export const findByUsername = (username) => {
  const id = db.usernames[String(username).toLowerCase()];
  return id ? db.accounts[id] : null;
};

export const findByEmail = (email) => {
  const id = db.emails[String(email).toLowerCase()];
  return id ? db.accounts[id] : null;
};

export const findByIdentity = (provider, sub) => {
  const id = db.identities[`${provider}:${sub}`];
  return id ? db.accounts[id] : null;
};

export function linkIdentity(userId, provider, sub) {
  db.identities[`${provider}:${sub}`] = userId;
  dirty = true;
}

/** Google usernames come from the email local part; make it unique. */
export function freeUsername(base) {
  const clean = String(base || "player").replace(/[^a-zA-Z0-9_]/g, "").slice(0, 12) || "player";
  let name = clean.length >= 3 ? clean : `${clean}_p`;
  let n = 1;
  while (db.usernames[name.toLowerCase()]) {
    const suffix = String(n++);
    name = clean.slice(0, 16 - suffix.length) + suffix;
  }
  return name;
}

export function saveAccount(account) {
  db.accounts[account.userId] = account;
  dirty = true;
}

export const getAccount = (userId) => db.accounts[userId] || null;

export function createAccount({ username, email, salt, hash, provider = "password", emailVerified = false }) {
  const userId = newUserId();
  const account = {
    userId,
    username,
    email: email ? String(email).toLowerCase() : null,
    emailVerified,
    provider,
    salt: salt || null,
    hash: hash || null,
    code: null,
    createdAt: Date.now(),
  };
  db.accounts[userId] = account;
  db.usernames[username.toLowerCase()] = userId;
  if (account.email) db.emails[account.email] = userId;
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
  const s = db.sessions[token];
  if (!s) return null;
  if (s.expires < Date.now()) { delete db.sessions[token]; dirty = true; return null; }
  return s.userId;
}

export function destroySession(token) {
  if (db.sessions[token]) { delete db.sessions[token]; dirty = true; }
}

/* ---------- profiles ---------- */

export function getProfile(userId) {
  if (!db.profiles[userId]) {
    const acct = db.accounts[userId];
    db.profiles[userId] = {
      playerId: userId,
      name: acct ? acct.username : userId.slice(0, 6),
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

export function flush() {
  try { fs.writeFileSync(FILE, JSON.stringify(db, null, 2)); }
  catch (e) { console.error("[store] flush failed:", e.message); }
}

export const countAccounts = () => Object.keys(db.accounts).length;