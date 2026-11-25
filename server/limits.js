/**
 * Abuse limits.
 *
 * Everything here is in memory and per process, which is right for one
 * server. They reset on restart; that's fine — they exist to blunt floods,
 * not to keep score.
 */
import { unref } from "./timers.js";

/**
 * Token buckets. `take(key)` spends one token and says whether there was
 * one to spend. Each bucket refills continuously at `perMinute`.
 */
export class Limiter {
  constructor({ burst, perMinute }) {
    this.burst = burst;
    this.rate = perMinute / 60_000;
    this.buckets = new Map();
    this.sweeper = null; // started on first use (no timers at load: Cloudflare forbids them)
  }

  refill(key) {
    if (!this.sweeper) this.sweeper = unref(setInterval(() => this.sweep(), 10 * 60_000));
    const now = Date.now();
    let b = this.buckets.get(key);
    if (!b) { b = { tokens: this.burst, at: now }; this.buckets.set(key, b); }
    b.tokens = Math.min(this.burst, b.tokens + (now - b.at) * this.rate);
    b.at = now;
    return b;
  }

  /** Is there a token, without spending it? */
  has(key, cost = 1) {
    return this.refill(key).tokens >= cost;
  }

  take(key, cost = 1) {
    const b = this.refill(key);
    if (b.tokens < cost) return false;
    b.tokens -= cost;
    return true;
  }

  sweep() {
    const now = Date.now();
    for (const [k, b] of this.buckets) {
      if (b.tokens + (now - b.at) * this.rate >= this.burst) this.buckets.delete(k);
    }
  }
}

// Per IP. Generous for a household sharing one connection, useless to a script.
// New accounts per network: 10 at once, then 10 an hour. Only accounts that
// actually get created count; typos and taken names don't.
export const signupLimit = new Limiter({ burst: 10, perMinute: 10 / 60 });
export const mailLimit = new Limiter({ burst: 5, perMinute: 5 / 60 });    // emails sent, any kind
export const authLimit = new Limiter({ burst: 20, perMinute: 10 });       // login/verify/reset attempts
// Per socket: a client legitimately sends a few messages a second at most.
export const chatLimit = new Limiter({ burst: 4, perMinute: 20 });    // chat lines per player
export const messageLimit = { burst: 40, perSecond: 20 };

export const MAX_MESSAGE_BYTES = 16 * 1024;
export const MAX_SOCKETS_PER_IP = 8;

/**
 * The visitor's address, for the per-network limits above.
 *
 * On Render, every request comes through Cloudflare, then Render's own proxy.
 * Cloudflare puts the visitor's real address in CF-Connecting-IP and
 * overwrites any value the visitor sends, so that's the one to trust. The
 * last X-Forwarded-For entry is a Cloudflare server shared by many visitors:
 * counting by it put strangers in one bucket, so a few sign-ups anywhere
 * blocked everyone.
 *
 *   TRUST_PROXY set   behind a proxy (Render): CF-Connecting-IP, else the
 *                     X-Forwarded-For entry TRUST_PROXY hops from the right
 *   unset             no proxy (local): the socket address; headers ignored,
 *                     since anyone could write them
 */
/** The visitor's address from Cloudflare's header (when the server runs on Cloudflare itself). */
export const cfIp = (headers) => (headers.get("cf-connecting-ip") || "").trim() || "unknown";

export function clientIp(req) {
  const hops = Number(process.env.TRUST_PROXY) || 0;
  if (hops > 0) {
    const cf = req.headers["cf-connecting-ip"];
    if (typeof cf === "string" && cf.trim()) return cf.trim();
    const xff = req.headers["x-forwarded-for"];
    if (typeof xff === "string" && xff) {
      const parts = xff.split(",").map((s) => s.trim()).filter(Boolean);
      const ip = parts[parts.length - hops];
      if (ip) return ip;
    }
  }
  return req.socket.remoteAddress || "unknown";
}
