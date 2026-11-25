/**
 * Credentials, verification codes, and Google identity.
 *
 * scrypt from Node's own crypto for passwords — memory-hard, no native modules.
 * Codes are hashed too: a leaked database shouldn't hand out working codes.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { OAuth2Client } from "google-auth-library";

const scrypt = promisify(crypto.scrypt);
const KEYLEN = 64;

/**
 * Reads a field the client sent as a plain string. Anything else — an object,
 * an array, a number — becomes "". Never call String() on client input: an
 * object like {"toString": 1} makes String() throw, and one throw used to
 * take the whole server down.
 */
export const str = (v, max = 512) => (typeof v === "string" ? v.slice(0, max) : "");

export const USERNAME_RE = /^[a-zA-Z0-9_]{3,16}$/;
// Display names may also hold spaces, dots and dashes — still no lookalike
// Unicode, so nobody can pass for someone else with a Cyrillic "а".
export const DISPLAY_RE = /^[a-zA-Z0-9_][a-zA-Z0-9_ .-]{1,14}[a-zA-Z0-9_]$/;

// Names nobody should be able to take, plus names that read like staff.
const RESERVED = /^(admin|administrator|mod|moderator|staff|support|system|server|official|mino|tesella|root|null|undefined|__proto__|proto|prototype|constructor)$/i;

/**
 * Words a name may not contain. Kept short and in its own file so you can
 * extend it without touching code: server/blocklist.txt, one word per line.
 */
const BLOCKLIST = (() => {
  try {
    const f = path.join(path.dirname(fileURLToPath(import.meta.url)), "blocklist.txt");
    return fs.readFileSync(f, "utf8").split(/\r?\n/).map((w) => w.trim().toLowerCase()).filter((w) => w && !w.startsWith("#"));
  } catch {
    return [];
  }
})();

/**
 * Chat text, made safe to relay: plain characters only (no control or
 * zero-width characters), whitespace collapsed, at most CHAT_MAX long, and
 * any blocklisted word masked with asterisks. Returns "" if nothing's left.
 */
export const CHAT_MAX = 120;
// Control and zero-width / direction-flipping characters.
// eslint-disable-next-line no-control-regex -- stripping control characters is the point
const INVISIBLE = /[\u0000-\u001F\u007F-\u009F\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF]/g;
export function cleanChat(text) {
  let t = String(text ?? "").normalize("NFKC")
    .replace(INVISIBLE, "")
    .replace(/\s+/g, " ").trim().slice(0, CHAT_MAX);
  for (const w of BLOCKLIST) {
    if (!w) continue;
    const re = new RegExp(w.split("").map((ch) => ch.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("[^a-z0-9]*"), "gi");
    t = t.replace(re, (m) => "*".repeat(m.length));
  }
  return t;
}

/** Returns an error message if `name` can't be used as a username or display name. */
export function nameProblem(name, { display = false } = {}) {
  const n = str(name, 64);
  if (display ? !DISPLAY_RE.test(n) : !USERNAME_RE.test(n)) {
    return display
      ? "Names are 3–16 letters, numbers, spaces, dots, dashes or underscores."
      : "Username must be 3–16 letters, numbers or underscores.";
  }
  if (RESERVED.test(n) || RESERVED.test(n.replace(/[ ._-]/g, ""))) return "That name is reserved.";
  const flat = n.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (BLOCKLIST.some((w) => flat.includes(w))) return "Pick a different name.";
  return null;
}
// Deliberately permissive. Real validation is "can they read the code we sent".
export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export const CODE_TTL_MS = 15 * 60_000;
export const CODE_RESEND_MS = 60_000;
export const CODE_MAX_TRIES = 5;
// Codes mailed per account per day — verification and reset together.
export const CODES_PER_DAY = 8;

export function validateSignup(username, email, password) {
  const bad = nameProblem(username);
  if (bad) return bad;
  const e = str(email, 320);
  if (!EMAIL_RE.test(e) || e.length > 254) return "That doesn't look like an email address.";
  return passwordProblem(password);
}

export function passwordProblem(password) {
  if (typeof password !== "string" || password.length < 8) return "Password must be at least 8 characters.";
  if (password.length > 200) return "Password is too long.";
  return null;
}

/**
 * scrypt is deliberately expensive (~16 MB and tens of ms each). Unbounded,
 * a burst of logins is a way to run the server out of memory, so at most
 * HASH_SLOTS run at once and the rest wait their turn.
 */
const HASH_SLOTS = 4;
let hashing = 0;
const waiting = [];
async function withSlot(fn) {
  if (hashing >= HASH_SLOTS) await new Promise((r) => waiting.push(r));
  hashing++;
  try { return await fn(); }
  finally { hashing--; waiting.shift()?.(); }
}

export async function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const buf = await withSlot(() => scrypt(password, salt, KEYLEN));
  return { salt, hash: buf.toString("hex") };
}

export async function verifyPassword(password, salt, hash) {
  try {
    if (typeof password !== "string" || !salt || !hash) return false;
    const buf = await withSlot(() => scrypt(password, salt, KEYLEN));
    const known = Buffer.from(hash, "hex");
    return known.length === buf.length && crypto.timingSafeEqual(known, buf);
  } catch {
    return false;
  }
}

/* ---------- verification codes ---------- */

export const newCode = () => String(crypto.randomInt(10000, 100000)); // always 5 digits

export const hashCode = (code, salt) =>
  crypto.createHash("sha256").update(`${salt}:${code}`).digest("hex");

export function codeMatches(code, salt, hash) {
  const test = Buffer.from(hashCode(code, salt), "hex");
  const known = Buffer.from(hash, "hex");
  return known.length === test.length && crypto.timingSafeEqual(known, test);
}

export const newToken = () => crypto.randomBytes(32).toString("hex");
export const newUserId = () => "u_" + crypto.randomBytes(9).toString("hex");
export const newSalt = () => crypto.randomBytes(8).toString("hex");

/* ---------- google ---------- */

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || "";
const googleClient = GOOGLE_CLIENT_ID ? new OAuth2Client(GOOGLE_CLIENT_ID) : null;
export const googleEnabled = () => !!googleClient;

/** Verifies the ID token's signature against Google's keys. Never trust the client's word. */
export async function verifyGoogle(credential) {
  if (!googleClient) throw new Error("Google sign-in is not configured on this server.");
  const ticket = await googleClient.verifyIdToken({
    idToken: String(credential || ""),
    audience: GOOGLE_CLIENT_ID,
  });
  const p = ticket.getPayload();
  if (!p || !p.sub) throw new Error("Google rejected that sign-in.");
  return { sub: p.sub, email: p.email, emailVerified: !!p.email_verified, name: p.name };
}

/* ---------- throttling ---------- */
/**
 * Failed logins, keyed by username AND by IP separately. Keying only by
 * username let anyone lock a stranger out by typing their name wrong eight
 * times; now a wrong password from your IP slows down your IP, and a
 * username only locks after many failures from many places.
 */
const attempts = new Map();
const WINDOW = 15 * 60_000;
function check(k, max) {
  const a = attempts.get(k);
  if (!a) return 0;
  if (Date.now() - a.at > WINDOW) { attempts.delete(k); return 0; }
  return a.n >= max ? Math.ceil((a.at + WINDOW - Date.now()) / 1000) : 0;
}
export const throttled = (username, ip) => Math.max(check(`u:${username}`, 30), check(`ip:${ip}`, 10), check(`ui:${ip}:${username}`, 6));
export function noteFailure(username, ip) {
  for (const k of [`u:${username}`, `ip:${ip}`, `ui:${ip}:${username}`]) {
    const a = attempts.get(k) || { n: 0, at: Date.now() };
    a.n++; a.at = Date.now();
    attempts.set(k, a);
  }
}
export const clearFailures = (username, ip) => { attempts.delete(`ui:${ip}:${username}`); };
setInterval(() => {
  const now = Date.now();
  for (const [k, a] of attempts) if (now - a.at > WINDOW) attempts.delete(k);
}, WINDOW).unref();
