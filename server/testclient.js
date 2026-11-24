/**
 * Test harness: signs up two bots, queues both, plays a full ranked match.
 *
 * Verifies the server without touching the UI. If this prints a final score
 * and two rating changes, signup, matchmaking, hidden moves, resolution,
 * scoring and Glicko all work.
 *
 * Start the server with SKIP_EMAIL_VERIFY=1 (the bots can't read email), then:
 *   npm run test:match
 *   URL=wss://your-app.onrender.com npm run test:match   # against a deployment
 *
 * Against a real deployment this creates two accounts. Only do that on a
 * staging copy, or with SKIP_EMAIL_VERIFY on for a closed test.
 */
import { WebSocket } from "ws";
import { enumerateMoves, DEFAULT_LOADOUT } from "../shared/engine.js";

const URL = process.env.URL || "ws://localhost:8787";
const tag = Date.now().toString(36).slice(-5);

function bot(name) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(URL);
    const send = (o) => ws.send(JSON.stringify(o));
    let side = null;
    const fail = (why) => { ws.close(); reject(new Error(`[${name}] ${why}`)); };
    const timer = setTimeout(() => fail("timed out"), 5 * 60_000);

    ws.on("open", () => send({ t: "signup", username: name, email: `${name}@example.test`, password: "test-password-1" }));
    ws.on("error", (e) => fail(e.message));

    ws.on("message", (raw) => {
      const m = JSON.parse(raw);
      switch (m.t) {
        case "auth":
          if (!m.profile.emailVerified) return fail("email not verified — start the server with SKIP_EMAIL_VERIFY=1");
          console.log(`[${name}] signed in, rating ${Math.round(m.profile.rating.r)}`);
          send({ t: "queue", loadout: DEFAULT_LOADOUT });
          break;
        case "authError":
          return fail(`auth error: ${m.msg}`);
        case "found":
          console.log(`[${name}] matched with ${m.opponent.name} (${m.gap} TR apart)`);
          break;
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
          console.log(
            `[${name}] ${m.drew ? "DREW" : m.won ? "WON" : "LOST"} ${m.myScore}–${m.oppScore} ` +
            `(${m.reason}), rating ${Math.round(m.rating.before.r)} → ${Math.round(m.rating.after.r)}`
          );
          ws.close();
          resolve(m);
          break;
      }
    });
  });
}

try {
  await Promise.all([bot(`bot_a_${tag}`), bot(`bot_b_${tag}`)]);
  console.log("\nOK — a full ranked match completed.");
  process.exit(0);
} catch (e) {
  console.error("\nFAILED:", e.message);
  process.exit(1);
}
