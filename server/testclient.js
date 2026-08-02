/**
 * Test harness: spins up two bots, queues both, plays a full match.
 *
 * This is how you verify the server without touching the UI. If this prints
 * a final score and two rating deltas, matchmaking, hidden moves, resolution,
 * scoring and Glicko all work.
 *
 *   node testclient.js
 */
import { WebSocket } from "ws";
import { enumerateMoves, DEFAULT_LOADOUT } from "../shared/engine.js";

const URL = process.env.URL || "ws://localhost:8787";

function bot(playerId, name) {
  const ws = new WebSocket(URL);
  let side = null;
  let done = false;

  const send = (o) => ws.send(JSON.stringify(o));

  ws.on("open", () => {
    send({ t: "hello", playerId, name });
    send({ t: "queue", loadout: DEFAULT_LOADOUT });
  });

  ws.on("message", (raw) => {
    const m = JSON.parse(raw);

    switch (m.t) {
      case "welcome":
        console.log(`[${name}] rating ${Math.round(m.profile.rating.r)} ±${Math.round(m.profile.rating.rd)}, ${m.profile.stats.games} games`);
        break;

      case "searching":
        if (Math.round(m.elapsed * 10) % 10 === 0) {
          console.log(`[${name}] searching ±${m.band}`);
        }
        break;

      case "found":
        console.log(`[${name}] matched vs ${m.opponent.name} (${m.opponent.rating}) — ${m.gap} TR apart`);
        break;

      case "matchStart":
        side = m.you;
        console.log(`[${name}] seat ${side}`);
        break;

      case "turn": {
        const moves = enumerateMoves(m.board, m.hand, side);
        if (!moves.length) {
          send({ t: "discard", turn: m.turn, handIdx: 0 });
        } else {
          // Greedy: biggest block that fits. Enough to exercise the server.
          moves.sort((a, b) => b.value - a.value);
          const pick = moves[Math.floor(Math.random() * Math.min(3, moves.length))];
          send({ t: "move", turn: m.turn, handIdx: pick.handIdx, rot: pick.rot, pos: pick.pos });
        }
        break;
      }

      case "reveal":
        if (side === "A") {
          console.log(`  turn ${String(m.turn).padStart(2)}  A:${m.score.a}  B:${m.score.b}  special:${m.score.s}`);
        }
        break;

      case "matchOver": {
        done = true;
        const d = Math.round(m.rating.after.r) - Math.round(m.rating.before.r);
        console.log(
          `[${name}] ${m.drew ? "DRAW" : m.won ? "WIN " : "LOSS"}  ${m.myScore}-${m.oppScore}  ` +
          `${Math.round(m.rating.before.r)} → ${Math.round(m.rating.after.r)} (${d >= 0 ? "+" : ""}${d})  ` +
          `±${Math.round(m.rating.before.rd)} → ±${Math.round(m.rating.after.rd)}`
        );
        ws.close();
        break;
      }

      case "error":
        console.error(`[${name}] ERROR: ${m.msg}`);
        break;
    }
  });

  ws.on("close", () => {
    if (!done) console.log(`[${name}] disconnected before the match ended`);
  });

  ws.on("error", (e) => console.error(`[${name}] socket error:`, e.message));
}

const stamp = Date.now();
bot(`test-alpha-${stamp}`, "alpha");
bot(`test-beta-${stamp}`, "beta");
