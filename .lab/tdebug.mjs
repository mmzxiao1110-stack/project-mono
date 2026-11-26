import { newSprint, place, T_ID, NAMES } from "../shared/sprint.js";
import { tMove } from "./tbot.mjs";
const st = newSprint(6000, Infinity);
for (let i = 0; i < 40 && !st.over; i++) {
  const a = tMove(st, {});
  place(st, a);
  const filled = st.board.flat().filter((v) => v !== null).length;
  process.stdout.write(`${NAMES[a.id]}${st.last.lines ? `(${st.last.lines})` : ""}:${filled} `);
}
console.log("\nover:", st.over, "hand", st.hand.map((x) => NAMES[x]));
console.log(st.board.map((r) => r.map((v) => (v === null ? "." : "#")).join("")).join("\n"));
