/**
 * Credentials, verification codes, and Google identity.
 *
 * scrypt from Node's own crypto for passwords — memory-hard, no native modules.
 * Codes are hashed too: a leaked database shouldn't hand out working codes.
 */
import crypto from "node:crypto";
import { promisify } from "node:util";
import { OAuth2Client } from "google-auth-library";

const scrypt = promisify(crypto.scrypt);
const KEYLEN = 64;

export const USERNAME_RE = /^[a-zA-Z0-9_]{3,16}$/;
// Deliberately permissive. Real validation is "can they read the code we sent".
export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export const CODE_TTL_MS = 15 * 60_000;
export const CODE_RESEND_MS = 60_000;
export const CODE_MAX_TRIES = 5;

export function validateSignup(username, email, password) {
  if (!USERNAME_RE.test(String(username || ""))) {
    return "Username must be 3–16 letters, numbers or underscores.";
  }
  if (!EMAIL_RE.test(String(email || ""))) return "That doesn't look like an email address.";
  const p = String(password || "");
  if (p.length < 8) return "Password must be at least 8 characters.";
  if (p.length > 200) return "Password is too long.";
  return null;
}

export async function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const buf = await scrypt(password, salt, KEYLEN);
  return { salt, hash: buf.toString("hex") };
}

export async function verifyPassword(password, salt, hash) {
  try {
    const buf = await scrypt(password, salt, KEYLEN);
    const known = Buffer.from(hash, "hex");
    return known.length === buf.length && crypto.timingSafeEqual(known, buf);
  } catch (e) {
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

const attempts = new Map();
export function throttled(k) {
  const a = attempts.get(k);
  if (!a) return 0;
  if (Date.now() - a.at > 15 * 60_000) { attempts.delete(k); return 0; }
  return a.n >= 8 ? Math.ceil((a.at + 15 * 60_000 - Date.now()) / 1000) : 0;
}
export function noteFailure(k) {
  const a = attempts.get(k) || { n: 0, at: Date.now() };
  a.n++; a.at = Date.now();
  attempts.set(k, a);
}
export const clearFailures = (k) => attempts.delete(k);