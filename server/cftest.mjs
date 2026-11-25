// Protocol test against a running server (Cloudflare dev or Node): sign-up,
// email codes (read from the server log), ranked match, Marathon save/finish.
//   LOG=/path/to/server.log URL=ws://localhost:8897/ws node cftest.mjs [phase]
// phase "fresh" (default) makes accounts; "again" logs back in to check persistence.
import WS from "ws";
import fs from "node:fs";
const M = await import("../shared/marathon.js");
const E = await import("../shared/engine.js");
const URL = process.env.URL || "ws://localhost:8897/ws";
const LOG = process.env.LOG;
const phase = process.argv[2] || "fresh";
const names = (process.env.NAMES || "CfAlpha,CfBravo").split(",");
const pass = "test-password-1";

function client() {
  const ws = new WS(URL);
  const inbox = [];
  const waiters = [];
  ws.on("message", (raw) => {
    const m = JSON.parse(raw);
    const i = waiters.findIndex((w) => w.test(m));
    if (i >= 0) waiters.splice(i, 1)[0].ok(m); else inbox.push(m);
  });
  const c = {
    ws,
    send: (o) => ws.send(JSON.stringify(o)),
    wait: (t, ms = 15000) => new Promise((ok, bad) => {
      const test = typeof t === "function" ? t : (m) => m.t === t;
      const j = inbox.findIndex(test);
      if (j >= 0) return ok(inbox.splice(j, 1)[0]);
      const timer = setTimeout(() => bad(new Error(`timeout waiting for ${t}`)), ms);
      waiters.push({ test, ok: (m) => { clearTimeout(timer); ok(m); } });
    }),
    open: () => new Promise((ok) => ws.on("open", ok)),
  };
  return c;
}
const codeFor = async (email) => {
  for (let i = 0; i < 30; i++) {
    const m = [...fs.readFileSync(LOG, "utf8").matchAll(new RegExp(`verify code for ${email}: (\\d{5})`, "g"))].pop();
    if (m) return m[1];
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error("no code in log for " + email);
};
const ok = (cond, what) => { console.log((cond ? "PASS " : "FAIL ") + what); if (!cond) process.exitCode = 1; };

const players = [];
for (const name of names) {
  const c = client(); await c.open();
  const email = `${name.toLowerCase()}@example.test`;
  if (phase === "fresh") {
    c.send({ t: "signup", username: name, email, password: pass });
    const a = await c.wait("auth");
    ok(a.profile && !a.profile.emailVerified, `${name}: signed up, not yet verified`);
    const code = await codeFor(email);
    c.send({ t: "verify", code });
    const v = await c.wait("verified");
    ok(v.profile.emailVerified, `${name}: verified with the emailed code`);
  } else {
    c.send({ t: "login", username: name, password: pass });
    const a = await c.wait((m) => m.t === "auth" || m.t === "authError");
    ok(a.t === "auth" && a.profile.emailVerified, `${name}: logged back in after restart (still verified)`);
    c.profile = a.profile;
  }
  players.push(c);
}

if (phase === "again") {
  const [a] = players;
  ok(a.profile.stats.games >= 1, `${names[0]}: ranked games kept (${a.profile.stats.games})`);
  ok(a.profile.marathon && a.profile.marathon.best > 0, `${names[0]}: Marathon best kept (${a.profile.marathon?.best})`);
  ok(a.profile.marathonOpen && a.profile.marathonOpen.score > 0, `${names[0]}: saved Marathon run kept (score ${a.profile.marathonOpen?.score})`);
  a.send({ t: "marathonStart" });
  const seed = await a.wait("marathonSeed");
  ok(seed.resume && seed.moves, "saved Marathon run resumes after restart");
  const api = await fetch(URL.replace(/^ws/, "http").replace(/\/ws$/, "") + `/api/player/${names[0]}`).then((r) => r.json());
  ok(api.games >= 1 && api.marathon?.best > 0, "T-Terminal API shows the kept record");
  process.exit();
}

// Ranked: both queue, then play legal random moves to the end.
for (const c of players) c.send({ t: "queue", loadout: E.DEFAULT_LOADOUT });
const found = await Promise.all(players.map((c) => c.wait("found", 30000)));
ok(found.every((f) => f.opponent), "ranked: both matched");
const sides = await Promise.all(players.map((c) => c.wait("matchStart")));
const over = await Promise.all(players.map((c, i) => (async () => {
  const side = sides[i].you;
  for (;;) {
    const m = await c.wait((x) => x.t === "turn" || x.t === "matchOver", 60000);
    if (m.t === "matchOver") return m;
    const mv = E.enumerateMoves(m.board, [m.piece], side)[0];
    if (mv) c.send({ t: "move", turn: m.turn, rot: mv.rot, pos: mv.pos }); else c.send({ t: "discard", turn: m.turn });
  }
})()));
ok(over.every((o) => o.rating && o.rating.after), `ranked: match over (${over[0].myScore}–${over[0].oppScore}), ratings ${Math.round(over[0].rating.before.r)}→${Math.round(over[0].rating.after.r)} / ${Math.round(over[1].rating.before.r)}→${Math.round(over[1].rating.after.r)}`);

// Marathon: a finished game counts; then a saved, unfinished one.
const a = players[0];
const play = async (stopAt) => {
  a.send({ t: "marathonStart" });
  const { seed } = await a.wait("marathonSeed");
  const st = M.newMarathon(seed); const moves = [];
  while (!st.over && moves.length < stopAt) {
    let m = null;
    for (let s = 0; s < 3 && !m; s++) for (let rot = 0; rot < 4 && !m; rot++) for (let r = 0; r < 7 && !m; r++) for (let col = 0; col < 7 && !m; col++) if (M.fits(st.board, st.hand[s], r, col, rot)) m = [s, r, col, rot];
    M.placePiece(st, ...m); moves.push(m);
  }
  return { seed, st, moves };
};
const g1 = await play(400);
a.send({ t: "marathonEnd", seed: g1.seed, moves: M.encodeMoves(g1.moves) });
const r1 = await a.wait("marathonResult");
ok(r1.saved && r1.score === g1.st.score, `marathon: finished game checked and saved (${r1.score})`);
const g2 = await play(6);
a.send({ t: "marathonSave", seed: g2.seed, moves: M.encodeMoves(g2.moves) });
const r2 = await a.wait("marathonSaved");
ok(r2.ok && r2.score === g2.st.score, `marathon: unfinished run saved (${r2.score})`);
a.send({ t: "marathonEnd", seed: g2.seed + 1, moves: "00" });
const r3 = await a.wait("marathonResult");
ok(!!r3.error, "marathon: a wrong seed is refused");
// Same account logging in elsewhere kicks the old socket.
const dup = client(); await dup.open();
dup.send({ t: "login", username: names[1], password: pass });
await dup.wait("auth");
const kicked = await players[1].wait("kicked");
ok(kicked.t === "kicked", "second login kicks the first socket");
await new Promise((r) => setTimeout(r, 600)); // let the writes land
process.exit();
