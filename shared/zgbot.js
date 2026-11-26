/**
 * A ZERO-G bot: tries every spot it can reach from the spawn (with or
 * without a swap from hold, any turn, any slide, then a hard drop) and picks
 * the one that leaves the best board. Used for TOWER's VS BOT.
 *
 * The board score is a classic hand-tuned one (landing height, row and
 * column transitions, holes, wells), plus a pull towards keeping the right
 * column open for quads, towards clearing when garbage is coming, and away
 * from a tall stack.
 */
import { W, H, NAMES, hold, rotate, shift, dropped, hardDrop, cellsOf, incomingRows } from "./zerog.js";

function evalBoard(board, L, landY, danger) {
  let holes = 0, rowT = 0, colT = 0, wells = 0, top = H;
  const hts = [];
  for (let x = 0; x < W; x++) {
    let h = 0, seen = false;
    for (let y = 0; y < H; y++) { const f = board[y][x] !== null; if (f && !seen) { seen = true; h = H - y; } else if (!f && seen) holes++; }
    hts.push(h); top = Math.min(top, H - h);
  }
  for (let y = 0; y < H; y++) { let prev = true; for (let x = 0; x < W; x++) { const f = board[y][x] !== null; if (f !== prev) rowT++; prev = f; } if (!prev) rowT++; }
  for (let x = 0; x < W; x++) { let prev = false; for (let y = 0; y < H; y++) { const f = board[y][x] !== null; if (f !== prev) colT++; prev = f; } if (!prev) colT++; }
  for (let x = 0; x < W - 1; x++) { const l = x ? hts[x - 1] : 99, r = hts[x + 1]; const d = Math.min(l, r) - hts[x]; if (d > 0) wells += (d * (d + 1)) / 2; }
  const n = L.lines, maxH = Math.max(...hts);
  const inWell = n < 3 ? cellsOf(L.piece).filter(([x]) => x === W - 1).length : 0;
  return -4.5 * (H - landY) + 3.4 * n + (n === 4 ? 40 : 0) + (danger && n ? 12 * n : 0) - 3.2 * rowT - 9.3 * colT - 9.5 * holes - 3.4 * wells
    - (danger || maxH > 12 ? 0 : 30 * inWell) - (maxH > 14 ? 6 * (maxH - 14) : 0) + (L.combo > 0 ? 4 * L.combo : 0);
}
const copy = (s) => ({ ...s, rand: Math.random, board: s.board.map((r) => r.slice()), queue: s.queue.slice(), cur: s.cur && { ...s.cur }, stats: { ...s.stats }, incoming: [] });

/** The bot's next lock for `st`, as applyLock takes it, or null if it has no move. */
export function botLock(st) {
  if (!st.cur) return null;
  const danger = incomingRows(st) >= 4;
  let best = null;
  for (const useHold of [false, true]) {
    for (const turn of [0, 1, 2, -1]) for (let dx = -6; dx <= 6; dx++) {
      const t = copy(st);
      if (useHold && !hold(t)) continue;
      if (!t.cur) continue;
      if (turn && !rotate(t, turn)) continue;
      let ok = true;
      for (let i = 0; i < Math.abs(dx); i++) if (!shift(t, Math.sign(dx))) { ok = false; break; }
      if (!ok) continue;
      const land = dropped(t.board, t.cur);
      const move = { holds: useHold ? 1 : 0, id: t.cur.id, rot: land.rot, x: land.x, y: land.y, spin: false, kick: 0 };
      const L = hardDrop(t);
      const v = evalBoard(t.board, L, land.y, danger) + Math.random() * 0.01;
      if (!best || v > best.v) best = { v, move };
    }
  }
  return best && best.move;
}
/** Pieces a second for skill 1–10. */
export const zgBotPps = (skill) => 0.5 + 0.3 * (Math.max(1, Math.min(10, skill)) - 1);
export { NAMES };
