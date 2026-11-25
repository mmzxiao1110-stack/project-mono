/**
 * Test harness: two guest bots open a private room and play a full match.
 *
 * Verifies the server without touching the UI. If this prints a final score,
 * guests, rooms, hidden moves, resolution and scoring all work. (Ranked play
 * needs verified accounts, which bots can't do: every account verifies its
 * email.)
 *
 *   npm run test:match
 *   URL=wss://your-app.onrender.com npm run test:match   # against a deployment
 */
import { WebSocket } from "ws";
import { enumerateMoves } from "../shared/engine.js";

const URL = process.env.URL || "ws://localhost:8787";
const tag = Date.now().toString(36).slice(-5);

let roomCode = null;
const waiting = [];

function bot(name, host) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(URL);
    const send = (o) => ws.send(JSON.stringify(o));
    let side = null;
    const fail = (why) => { ws.close(); reject(new Error(`[${name}] ${why}`)); };
    const timer = setTimeout(() => fail("timed out"), 5 * 60_000);

    ws.on("open", () => send({ t: "guest", name }));
    ws.on("error", (e) => fail(e.message));

    ws.on("message", (raw) => {
      const m = JSON.parse(raw);
      switch (m.t) {
        case "guestOk":
          console.log(`[${name}] in as a guest`);
          if (host) send({ t: "createRoom" });
          else if (roomCode) send({ t: "joinRoom", code: roomCode });
          else waiting.push(() => send({ t: "joinRoom", code: roomCode }));
          break;
        case "guestError":
          return fail(`guest error: ${m.msg}`);
        case "room":
          if (host && !roomCode) {
            roomCode = m.code;
            console.log(`[${name}] opened room ${roomCode}`);
            waiting.splice(0).forEach((go) => go());
          }
          break;
        case "roomError":
          return fail(`room error: ${m.msg}`);
        case "matchStart":
          side = m.you;
          break;
        case "turn": {
          // One piece per turn: place the current piece somewhere legal, or pass.
          const moves = enumerateMoves(m.board, [m.piece], side);
          if (moves.length) {
            const mv = moves[Math.floor(Math.random() * moves.length)];
            send({ t: "move", turn: m.turn, rot: mv.rot, pos: mv.pos });
          } else {
            send({ t: "discard", turn: m.turn });
          }
          break;
        }
        case "error":
          console.log(`[${name}] server error: ${m.msg}`);
          break;
        case "matchOver":
          clearTimeout(timer);
          console.log(`[${name}] ${m.drew ? "DREW" : m.won ? "WON" : "LOST"} ${m.myScore}–${m.oppScore} (${m.reason})`);
          ws.close();
          resolve(m);
          break;
      }
    });
  });
}

try {
  await Promise.all([bot(`bot_a_${tag}`, true), bot(`bot_b_${tag}`, false)]);
  console.log("\nOK — a full match completed.");
  process.exit(0);
} catch (e) {
  console.error("\nFAILED:", e.message);
  process.exit(1);
}
