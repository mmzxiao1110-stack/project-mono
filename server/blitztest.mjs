// Blitz 1v1 over the wire: two accounts, queue, play with the bot brain,
// check the server's copy of each board matches the client's, junk flows,
// and the match ends with ratings.
//   URL=ws://localhost:8896/ws NAMES=Kelpie,Bramble node server/blitztest.mjs
import WS from "ws";
const S = await import("../shared/sprint.js");
const B = await import("../shared/blitzbot.js");
const URL = process.env.URL || "ws://localhost:8896/ws";
const names = (process.env.NAMES || "Kelpie,Bramble").split(",");
const ok = (c, w) => { console.log((c ? "PASS " : "FAIL ") + w); if (!c) process.exitCode = 1; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function client(name, skill) {
  const ws = new WS(URL), me = { name, skill, ws, inbox: [], mismatches: 0, junkIn: 0, sentSeen: 0, errors: [] };
  ws.on("message", (raw) => {
    const m = JSON.parse(raw); me.inbox.push(m);
    if (m.t === "blitzStart") { me.you = m.you; me.st = S.newSprint(m.seed, Infinity); me.startAt = Date.now() + m.countdown; }
    if (m.t === "blitzJunk" && me.st) { me.st.queue.splice(Math.max(0, Math.min(me.st.queue.length, S.FORECAST - (me.st.pieces - m.at))), 0, S.JUNK + m.level); me.junkIn++; }
    if (m.t === "blitzState" && m.side === me.you && me.st) {
      me.sentSeen = m.sent;
      if (m.pieces === me.st.pieces && (JSON.stringify(m.board) !== JSON.stringify(me.st.board) || JSON.stringify(m.hand) !== JSON.stringify(me.st.hand))) { me.mismatches++; me.st.board = m.board; me.st.hand = m.hand; me.st.queue = m.queue; }
    }
    if (m.t === "blitzEnd") me.end = m;
    if (m.t === "error") me.errors.push(m.msg);
  });
  return me;
}
const login = (c) => new Promise((res) => { c.ws.on("open", () => { c.ws.send(JSON.stringify({ t: "login", username: c.name, password: "test-password-1" })); }); const t = setInterval(() => { if (c.inbox.some((m) => m.t === "auth")) { clearInterval(t); res(); } }, 50); });
const A = client(names[0], 10), Bc = client(names[1], 4);
await Promise.all([login(A), login(Bc)]);
for (const c of [A, Bc]) c.ws.send(JSON.stringify({ t: "blitzQueue" }));
for (let i = 0; i < 100 && !(A.st && Bc.st); i++) await sleep(100);
ok(A.st && Bc.st && A.you !== Bc.you, `matched (${A.name} ${A.you}, ${Bc.name} ${Bc.you})`);
await sleep(3100);
const next = { A: 0, B: 0 };
const t0 = Date.now();
while (!A.end && Date.now() - t0 < 300000) {
  for (const c of [A, Bc]) {
    if (c.end || Date.now() < next[c.name] || c.st.over) continue;
    const a = B.botMove(c.st, c.skill);
    next[c.name] = Date.now() + B.botDelay(c.st, c.skill);
    if (!a) continue;
    const mv = S.recordMove(a, 0);
    S.place(c.st, a);
    const L = c.st.last; if (L.lines) S.noteClear(c.st, L.lines, Date.now(), L.allClear, L.id);
    c.ws.send(JSON.stringify({ t: "blitzPlace", slot: mv[1], rot: mv[2], r: mv[3], c: mv[4] }));
  }
  await sleep(20);
}
await sleep(500);
ok(!!A.end && !!Bc.end, `match ended after ${((Date.now() - t0) / 1000).toFixed(0)} s: winner ${A.end?.winner} (${A.end?.reason})`);
ok(A.mismatches + Bc.mismatches === 0, `client and server boards always agreed (mismatches ${A.mismatches}/${Bc.mismatches})`);
ok(A.junkIn + Bc.junkIn > 0, `junk received: ${A.name} ${A.junkIn}, ${Bc.name} ${Bc.junkIn}; sent ${JSON.stringify(A.end?.sent)}`);
ok(!!A.end?.ratings, `ratings: ${JSON.stringify(A.end?.ratings)}`);
ok(A.errors.length + Bc.errors.length === 0, `no server errors (${[...A.errors, ...Bc.errors].slice(0, 3).join(" | ")})`);
process.exit();
