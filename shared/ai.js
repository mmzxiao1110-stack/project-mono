/**
 * MINO — computer opponent.
 *
 * Shared so the client (single-player) and test tools use the same player.
 * One-move lookahead with a weighted score; `level` (1…max) raises the
 * weight on strategy and lowers the randomness.
 *
 * What it weighs for each placement of its one piece:
 *   gain      squares claimed (centre squares count extra)
 *   frontier  empty squares it can build from afterwards
 *   deny      empty squares it takes away from the opponent
 *   lines     line clears: finishing a line that's mostly the opponent's
 *             is good; leaving a line nearly full and mostly its own is a
 *             risk the opponent can cash in
 */
import { ROWS, COLS, key, enumerateMoves, isCentre, fullLines } from "./engine.js";
import { RULES } from "./rules.js";

function frontierSize(board, owner) {
  const s = new Set();
  for (let r = 0; r < ROWS; r++)
    for (let c = 0; c < COLS; c++) {
      if (board[r][c] !== owner) continue;
      for (let dr = -1; dr <= 1; dr++)
        for (let dc = -1; dc <= 1; dc++) {
          const nr = r + dr, nc = c + dc;
          if (nr < 0 || nc < 0 || nr >= ROWS || nc >= COLS) continue;
          if (board[nr][nc] === null) s.add(key(nr, nc));
        }
    }
  return s.size;
}

/** Net squares this player gains (+) or loses (−) from lines that would clear. */
function lineSwing(board, owner) {
  const { rows, cols } = fullLines(board);
  if (!rows.length && !cols.length) return 0;
  const hit = new Set();
  for (const r of rows) for (let c = 0; c < COLS; c++) hit.add(key(r, c));
  for (const c of cols) for (let r = 0; r < ROWS; r++) hit.add(key(r, c));
  let mine = 0, theirs = 0;
  for (const k of hit) {
    const v = board[Math.floor(k / COLS)][k % COLS];
    if (v === owner) mine++; else if (v) theirs++;
  }
  return theirs - mine;
}

/** How exposed this player is: own squares sitting in lines 1–2 squares from full. */
function lineRisk(board, owner) {
  let risk = 0;
  const scan = (cells) => {
    let empty = 0, mine = 0;
    for (const v of cells) { if (v === null) empty++; else if (v === owner) mine++; }
    if (empty >= 1 && empty <= 2) risk += mine * (empty === 1 ? 1 : 0.4);
  };
  for (let r = 0; r < ROWS; r++) scan(board[r]);
  for (let c = 0; c < COLS; c++) scan(board.map((row) => row[c]));
  return risk;
}

export const weightsFor = (level, levels) => {
  const t = levels > 1 ? (level - 1) / (levels - 1) : 1;
  return { front: 0.3 * t, deny: 0.9 * t * t, lines: 1.2 * t, risk: 0.25 * t, noise: 8 * (1 - t) + 0.1 };
};

/** Picks a placement for `piece`, or null to pass. */
export function aiPickMove(board, piece, owner, level, levels) {
  const moves = enumerateMoves(board, [piece], owner);
  if (!moves.length) return null;
  const w = weightsFor(level, levels);
  const opp = owner === "A" ? "B" : "A";
  const oppBefore = frontierSize(board, opp);
  let best = null, bestScore = -Infinity;
  for (const m of moves) {
    const nb = board.map((row) => [...row]);
    let gain = 0;
    for (const [r, c] of m.cells) { nb[r][c] = owner; gain += isCentre(r, c) ? RULES.centreValue : 1; }
    const s =
      gain +
      (w.front ? w.front * frontierSize(nb, owner) : 0) +
      (w.deny ? w.deny * (oppBefore - frontierSize(nb, opp)) : 0) +
      (w.lines ? w.lines * lineSwing(nb, owner) : 0) -
      (w.risk ? w.risk * lineRisk(nb, owner) : 0) +
      Math.random() * w.noise;
    if (s > bestScore) { bestScore = s; best = m; }
  }
  return best;
}
