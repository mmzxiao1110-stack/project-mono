// Safety features against a running server (Cloudflare dev or Node):
// block (chat + matchmaking, kept across sign-ins), report, delete account.
//   LOG=/path/to/server.log URL=ws://localhost:8897/ws node safetytest.mjs
import WS from "ws";
import fs from "node:fs";
const E = await import("../shared/engine.js");
const URL = process.env.URL || "ws://localhost:8897/ws";
const HTTP = URL.replace(/^ws/, "http").replace(/\/ws$/, "");
const LOG = process.env.LOG;
const [NA, NB] = (process.env.NAMES || "SafeAda,SafeBo").split(",");
const pass = "test-password-1";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ok = (cond, what) => { console.log((cond ? "PASS " : "FAIL ") + what); if (!cond) process.exitCode = 1; };

function client() {
  const ws = new WS(URL);
  const inbox = [], waiters = [];
  ws.on("message", (raw) => {
    const m = JSON.parse(raw);
    const i = waiters.findIndex((w) => w.test(m));
    if (i >= 0) waiters.splice(i, 1)[0].ok(m); else inbox.push(m);
  });
  return {
    ws, inbox,
    send: (o) => ws.send(JSON.stringify(o)),
    wait: (t, ms = 15000) => new Promise((ok, bad) => {
      const test = typeof t === "function" ? t : (m) => m.t === t;
      const j = inbox.findIndex(test);
      if (j >= 0) return ok(inbox.splice(j, 1)[0]);
      const timer = setTimeout(() => bad(new Error(`timeout waiting for ${t}`)), ms);
      waiters.push({ test, ok: (m) => { clearTimeout(timer); ok(m); } });
    }),
    open: () => new Promise((ok) => ws.on("open", ok)),
    drain: (t) => { for (let i = inbox.length - 1; i >= 0; i--) if (inbox[i].t === t) inbox.splice(i, 1); },
  };
}
const codeFor = async (email) => {
  for (let i = 0; i < 30; i++) {
    const m = [...fs.readFileSync(LOG, "utf8").matchAll(new RegExp(`verify code for ${email}: (\\d{5})`, "g"))].pop();
    if (m) return m[1];
    await sleep(300);
  }
  throw new Error("no code in log for " + email);
};
async function signup(name) {
  const c = client(); await c.open();
  const email = `${name.toLowerCase()}@example.test`;
  c.send({ t: "signup", username: name, email, password: pass });
  await c.wait("auth");
  c.send({ t: "verify", code: await codeFor(email) });
  await c.wait("verified");
  return c;
}
async function login(name, password = pass) {
  const c = client(); await c.open();
  c.send({ t: "login", username: name, password });
  const a = await c.wait((m) => m.t === "auth" || m.t === "authError");
  return { c, a };
}
const startMatch = async (a, b) => {
  a.send({ t: "queue", loadout: E.DEFAULT_LOADOUT }); b.send({ t: "queue", loadout: E.DEFAULT_LOADOUT });
  return Promise.all([a.wait("matchStart", 20000), b.wait("matchStart", 20000)]);
};

let A = await signup(NA);
let B = await signup(NB);
ok(true, `${NA} and ${NB} signed up and verified`);

// --- chat + block ---
await startMatch(A, B);
A.send({ t: "chat", text: "hello there" });
ok((await B.wait("chat")).text === "hello there", "chat reaches the opponent");
await A.wait("chat");
B.send({ t: "block", name: NA });
const bl = await B.wait("blocked");
ok(bl.on && bl.list.includes(NA), `${NB} blocked ${NA}`);
A.send({ t: "chat", text: "can you see this" });
ok((await A.wait("chat")).text === "can you see this", "the sender still sees their own line");
await sleep(800);
ok(!B.inbox.some((m) => m.t === "chat"), "a blocked player's chat doesn't arrive");
// --- report (with the chat attached) ---
B.send({ t: "report", name: NA, reason: "chat", note: "test report" });
ok((await B.wait("reported")).name === NA, "report accepted");
await sleep(500);
const log = fs.readFileSync(LOG, "utf8");
ok(/\[report\] .*reported .*\(chat\)/.test(log) && log.includes("can you see this"), "report logged/emailed with the recent chat");
B.send({ t: "report", name: NB, reason: "chat" });
ok(/That's you/.test((await B.wait("error")).msg), "can't report yourself");
A.send({ t: "forfeit" });
await Promise.all([A.wait("matchOver"), B.wait("matchOver")]);

// --- block keeps you out of each other's matches ---
A.send({ t: "queue", loadout: E.DEFAULT_LOADOUT }); B.send({ t: "queue", loadout: E.DEFAULT_LOADOUT });
await sleep(6000);
ok(!A.inbox.some((m) => m.t === "matchStart") && !B.inbox.some((m) => m.t === "matchStart"), "blocked players aren't paired (6 s in the queue together)");
B.send({ t: "unblock", name: NA });
ok(!(await B.wait("blocked")).on, "unblocked");
await Promise.all([A.wait("matchStart", 20000), B.wait("matchStart", 20000)]);
ok(true, "after unblocking they're paired");
A.send({ t: "chat", text: "back again" });
ok((await B.wait("chat")).text === "back again", "chat reaches them again after unblocking");
B.send({ t: "forfeit" });
await Promise.all([A.wait("matchOver"), B.wait("matchOver")]);

// --- blocks are kept with the account ---
B.send({ t: "block", name: NA }); await B.wait("blocked");
B.ws.close(); await sleep(300);
let r = await login(NB); B = r.c;
ok(r.a.t === "auth" && (r.a.blocked || []).includes(NA), "block list comes back after signing in again");

// --- delete account ---
A.send({ t: "deleteAccount", password: "wrong-password" });
ok(/isn't right/.test((await A.wait("deleteError")).msg), "wrong password refused");
A.send({ t: "deleteAccount", password: pass });
await A.wait("accountDeleted");
ok(true, `${NA} deleted`);
r = await login(NA);
ok(r.a.t === "authError", "the deleted account can't sign in");
const res = await fetch(`${HTTP}/api/player/${NA}`);
ok(res.status === 404, `player page is gone (${res.status})`);
r.c.ws.close();
B.ws.close(); await sleep(300);
r = await login(NB);
const recent = r.a.profile.stats.recent || [];
ok(recent.length > 0 && recent.every((m) => m.name === "deleted player"), `${NB}'s match list shows "deleted player" (${recent.map((m) => m.name).join(", ")})`);
ok((r.a.blocked || []).length === 0, "the deleted player drops off block lists");
// Re-registering only needs the name and email to be free (no code needed for that).
const again = client(); await again.open();
again.send({ t: "signup", username: NA, email: `${NA.toLowerCase()}@example.test`, password: pass });
ok((await again.wait((m) => m.t === "auth" || m.t === "authError")).t === "auth", "the name and email are free again");
process.exit();
