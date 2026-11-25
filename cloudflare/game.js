/**
 * The game, on Cloudflare: one Durable Object ("world") hosts the same core
 * as the Node server (server/core.js) — every socket, queue, room and match.
 *
 * Storage is the Durable Object's own (SQLite-backed), one record per key:
 * "accounts:<id>", "profiles:<id>", "sessions:<token>", "usernames:<name>"…
 * Everything is read into memory when the object starts; each change the
 * store reports is written back within a moment. Updates and restarts keep
 * every account: nothing lives on a disk that a deploy could wipe.
 */
import { DurableObject } from "cloudflare:workers";
import { attachStore, dbFrom, recordOf, TABLES, pruneSessions } from "../server/store.js";
import { apiRoute } from "../server/api.js";
import { setBlocklist } from "../server/auth.js";
import { cfIp } from "../server/limits.js";
import { describeMail } from "../server/mail.js";
import * as core from "../server/core.js";
import blocklist from "../server/blocklist.txt";

const BATCH = 128; // most keys one storage call may write

export class Game extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.dirty = new Set();
    this.flushTimer = null;
    setBlocklist(blocklist);
    // Nothing is handled until every record is back in memory.
    ctx.blockConcurrencyWhile(async () => {
      const all = await ctx.storage.list();
      const parsed = Object.fromEntries(TABLES.map((t) => [t, {}]));
      for (const [key, value] of all) {
        const i = key.indexOf(":");
        const t = key.slice(0, i);
        if (parsed[t]) parsed[t][key.slice(i + 1)] = value;
      }
      attachStore(dbFrom(parsed), (t, k) => this.mark(t, k), () => this.flush());
      core.startTimers();
      setInterval(pruneSessions, 60 * 60 * 1000);
      console.log(`[game] started with ${Object.keys(parsed.accounts).length} accounts; mail: ${describeMail()}`);
    });
  }

  /** A record changed: write it soon (changes made together are written together). */
  mark(table, key) {
    this.dirty.add(`${table}:${key}`);
    if (!this.flushTimer) this.flushTimer = setTimeout(() => this.flush(), 50);
  }

  async flush() {
    clearTimeout(this.flushTimer);
    this.flushTimer = null;
    const keys = [...this.dirty];
    this.dirty.clear();
    const puts = [], dels = [];
    for (const k of keys) {
      const i = k.indexOf(":");
      const v = recordOf(k.slice(0, i), k.slice(i + 1));
      if (v === undefined) dels.push(k); else puts.push([k, v]);
    }
    try {
      for (let i = 0; i < puts.length; i += BATCH) await this.ctx.storage.put(Object.fromEntries(puts.slice(i, i + BATCH)));
      for (let i = 0; i < dels.length; i += BATCH) await this.ctx.storage.delete(dels.slice(i, i + BATCH));
    } catch (e) {
      console.error("[game] save failed, retrying:", e.message);
      for (const k of keys) this.dirty.add(k);
      if (!this.flushTimer) this.flushTimer = setTimeout(() => this.flush(), 1000);
    }
  }

  async fetch(req) {
    const url = new URL(req.url);
    const ip = cfIp(req.headers);

    if (url.pathname.startsWith("/api/")) {
      const { status, body } = apiRoute(req.method, url, ip);
      return new Response(JSON.stringify(body), {
        status,
        headers: {
          "content-type": "application/json; charset=utf-8",
          "cache-control": "public, max-age=10",
          "access-control-allow-origin": "*",
          "x-content-type-options": "nosniff",
        },
      });
    }

    if (req.headers.get("Upgrade") !== "websocket") return new Response("Expected a WebSocket.", { status: 426 });
    const [client, server] = Object.values(new WebSocketPair());
    server.accept();
    // What the core needs from a socket (see server/core.js).
    const conn = {
      send: (text) => { try { server.send(text); } catch { /* closing */ } },
      close: (code = 1000, reason = "") => {
        try { server.close(code, reason); } catch { /* already closed */ }
        core.disconnect(conn);
      },
      get readyState() { return server.readyState; },
    };
    if (core.connect(conn, ip)) {
      server.addEventListener("message", (e) => core.message(conn, typeof e.data === "string" ? e.data : new TextDecoder().decode(e.data)));
      server.addEventListener("close", () => core.disconnect(conn));
      server.addEventListener("error", () => core.disconnect(conn));
    }
    return new Response(null, { status: 101, webSocket: client });
  }
}
