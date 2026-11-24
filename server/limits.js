/**
 * Abuse limits.
 *
 * Everything here is in memory and per process, which is right for one
 * server. They reset on restart; that's fine — they exist to blunt floods,
 * not to keep score.
 */

/**
 * Token buckets. `take(key)` spends one token and says whether there was
 * one to spend. Each bucket refills continuously at `perMinute`.
 */
export class Limiter {
  constructor({ burst, perMinute }) {
    this.burst = burst;
    this.rate = perMinute / 60_000;
    this.buckets = new Map();
    setInterval(() => this.sweep(), 10 * 60_000).unref();
  }

  take(key, cost = 1) {
    const now = Date.now();
    let b = this.buckets.get(key);
    if (!b) { b = { tokens: this.burst, at: now }; this.buckets.set(key, b); }
    b.tokens = Math.min(this.burst, b.tokens + (now - b.at) * this.rate);
    b.at = now;
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
export const signupLimit = new Limiter({ burst: 3, perMinute: 3 / 60 });  // 3, then 3 an hour
export const mailLimit = new Limiter({ burst: 5, perMinute: 5 / 60 });    // emails sent, any kind
export const authLimit = new Limiter({ burst: 20, perMinute: 10 });       // login/verify/reset attempts
// Per socket: a client legitimately sends a few messages a second at most.
export const messageLimit = { burst: 40, perSecond: 20 };

export const MAX_MESSAGE_BYTES = 16 * 1024;
export const MAX_SOCKETS_PER_IP = 8;

/**
 * The visitor's address. Behind Render the socket address is Render's proxy,
 * so read X-Forwarded-For — but only when told how many proxies to trust,
 * because each proxy APPENDS the address it saw, and everything to the left
 * of those is whatever the client chose to claim.
 *
 *   TRUST_PROXY=1  Render alone (Render appends the visitor's address)
 *   TRUST_PROXY=2  Cloudflare in front of Render
 *   unset          no proxy: use the socket address
 */
export function clientIp(req) {
  const hops = Number(process.env.TRUST_PROXY) || 0;
  const xff = req.headers["x-forwarded-for"];
  if (hops > 0 && typeof xff === "string" && xff) {
    const parts = xff.split(",").map((s) => s.trim()).filter(Boolean);
    const ip = parts[parts.length - hops];
    if (ip) return ip;
  }
  return req.socket.remoteAddress || "unknown";
}
