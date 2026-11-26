import { newSprint, place, NAMES } from "../shared/sprint.js";
import { pcMove } from "./pcbot.mjs";
const st = newSprint(5000, Infinity);
const show = () => console.log(st.board.map((r) => r.map((v) => (v === null ? "." : v >= 100 ? "j" : NAMES[v])).join("")).join("\n"));
for (let i = 0; i < 60; i++) {
  const stats = { solved: 0, built: 0, spread: 0, fallback: 0 };
  const before = JSON.stringify(st.board);
  const a = pcMove(st, { stats });
  const kind = Object.keys(stats).find((k) => stats[k]);
  console.log(`#${i} hand ${st.hand.map((x) => NAMES[x] || x)} next ${st.queue.slice(0, 5).map((x) => NAMES[x] || x).join("")} → ${kind} ${NAMES[a.id]}`);
  if (i === 15 || kind === "fallback") { console.log("board before:"); console.log(JSON.parse(before).map((r) => r.map((v) => (v === null ? "." : "#")).join("")).join("\n")); break; }
  place(st, a);
  if (st.last.lines) console.log(st.last.allClear ? "ALL CLEAR" : `clear ${st.last.lines}`);
}
