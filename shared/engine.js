/**
 * MINO — rules engine.
 *
 * Pure functions only. No React, no DOM, no Node APIs.
 * The client imports this to render and predict; the server imports the
 * SAME FILE to be the referee. If these ever disagree, players desync.
 */

import { RULES } from "./rules.js";

export const COLS = RULES.size;
export const ROWS = RULES.size;
export const TURNS = RULES.turns;
export const SLOTS = 7;
export const QUEUE_SHOWN = RULES.queueShown;

/** The middle 2×2 squares, worth RULES.centreValue each. */
const MID = Math.floor(RULES.size / 2) - 1;
export const CENTRE = [[MID, MID], [MID, MID + 1], [MID + 1, MID], [MID + 1, MID + 1]];
export const isCentre = (r, c) => (r === MID || r === MID + 1) && (c === MID || c === MID + 1);

// The seven tetrominoes, as in Tetris. Rotation gives every orientation;
// S/Z and J/L are mirror pairs, so all seven are distinct.
export const BLOCKS = [
  { name: "I", cells: [[0, 0], [0, 1], [0, 2], [0, 3]] },
  { name: "O", cells: [[0, 0], [0, 1], [1, 0], [1, 1]] },
  { name: "T", cells: [[0, 0], [0, 1], [0, 2], [1, 1]] },
  { name: "S", cells: [[0, 1], [0, 2], [1, 0], [1, 1]] },
  { name: "Z", cells: [[0, 0], [0, 1], [1, 1], [1, 2]] },
  { name: "J", cells: [[0, 0], [1, 0], [1, 1], [1, 2]] },
  { name: "L", cells: [[0, 2], [1, 0], [1, 1], [1, 2]] },
];

// Everyone plays all seven: there's no deck to build.
export const DEFAULT_LOADOUT = BLOCKS.map((_, i) => i);

export const sizeOf = (n) => (n <= 3 ? "SMALL" : n <= 7 ? "MEDIUM" : "BIG");

export const key = (r, c) => r * COLS + c;

/* ---------- geometry ---------- */

export function normalize(cells) {
  const minR = Math.min(...cells.map((x) => x[0]));
  const minC = Math.min(...cells.map((x) => x[1]));
  return cells.map(([r, c]) => [r - minR, c - minC]);
}

export function rotateCW(cells) {
  const maxR = Math.max(...cells.map((x) => x[0]));
  return normalize(cells.map(([r, c]) => [c, maxR - r]));
}

export function rotateN(cells, n) {
  let out = cells;
  for (let i = 0; i < ((n % 4) + 4) % 4; i++) out = rotateCW(out);
  return out;
}

export const boundsOf = (cells) => ({
  h: Math.max(...cells.map((x) => x[0])) + 1,
  w: Math.max(...cells.map((x) => x[1])) + 1,
});

export const absCells = (cells, pos) => cells.map(([dr, dc]) => [pos[0] + dr, pos[1] + dc]);

/* ---------- board ---------- */

export function initialBoard() {
  const b = Array.from({ length: ROWS }, () => Array(COLS).fill(null));
  const m = Math.floor(COLS / 2) - 1;
  b[ROWS - 1][m] = "A";
  b[ROWS - 1][m + 1] = "A";
  b[0][m] = "B";
  b[0][m + 1] = "B";
  return b;
}

/** Every square must be free, and at least one must touch your own ink (8-way). */
export function isLegal(board, cells, owner) {
  for (const [r, c] of cells) {
    if (!Number.isInteger(r) || !Number.isInteger(c)) return false;
    if (r < 0 || c < 0 || r >= ROWS || c >= COLS) return false;
    if (board[r][c] !== null) return false;
  }
  for (const [r, c] of cells)
    for (let dr = -1; dr <= 1; dr++)
      for (let dc = -1; dc <= 1; dc++) {
        if (dr === 0 && dc === 0) continue;
        const nr = r + dr, nc = c + dc;
        if (nr < 0 || nc < 0 || nr >= ROWS || nc >= COLS) continue;
        if (board[nr][nc] === owner) return true;
      }
  return false;
}

/**
 * Every legal placement of the given pieces. In a match you hold one piece,
 * so `pieces` is usually [current]; the whole deck is passed to ask "can
 * this player still place anything at all?".
 */
export function enumerateMoves(board, pieces, owner) {
  const out = [];
  const seen = new Set();
  for (let hi = 0; hi < pieces.length; hi++) {
    const blockId = pieces[hi];
    for (let rot = 0; rot < 4; rot++) {
      const cells = rotateN(BLOCKS[blockId].cells, rot);
      const { h, w } = boundsOf(cells);
      for (let r = 0; r <= ROWS - h; r++)
        for (let c = 0; c <= COLS - w; c++) {
          const abs = absCells(cells, [r, c]);
          if (!isLegal(board, abs, owner)) continue;
          const sig = hi + ":" + abs.map(([a, b]) => key(a, b)).sort((x, y) => x - y).join(",");
          if (seen.has(sig)) continue;
          seen.add(sig);
          out.push({ handIdx: hi, blockId, rot, pos: [r, c], cells: abs, value: cells.length });
        }
    }
  }
  return out;
}

/** Cheaper than enumerateMoves when you only need a yes or no. */
export function hasAnyMove(board, pieces, owner) {
  for (const blockId of new Set(pieces)) {
    for (let rot = 0; rot < 4; rot++) {
      const cells = rotateN(BLOCKS[blockId].cells, rot);
      const { h, w } = boundsOf(cells);
      for (let r = 0; r <= ROWS - h; r++)
        for (let c = 0; c <= COLS - w; c++)
          if (isLegal(board, absCells(cells, [r, c]), owner)) return true;
    }
  }
  return false;
}

const homeCells = (owner) => {
  const m = Math.floor(COLS / 2) - 1;
  const r = owner === "A" ? ROWS - 1 : 0;
  return [[r, m], [r, m + 1]];
};

/** Nobody should be left with no ink to build from. */
function restoreHomes(nb) {
  for (const owner of ["A", "B"]) {
    let has = false;
    for (const row of nb) { if (row.includes(owner)) { has = true; break; } }
    if (!has) for (const [r, c] of homeCells(owner)) nb[r][c] = owner;
  }
}

/** Full rows and columns, as { rows: [r…], cols: [c…] }. */
export function fullLines(board) {
  const rows = [], cols = [];
  if (RULES.clearRows) for (let r = 0; r < ROWS; r++) if (board[r].every((v) => v !== null)) rows.push(r);
  if (RULES.clearColumns) for (let c = 0; c < COLS; c++) if (board.every((row) => row[c] !== null)) cols.push(c);
  return { rows, cols };
}

/**
 * Simultaneous resolution, in order:
 *   1. Both pieces land. A square both claimed stays empty.
 *   2. Every full row and column is wiped — both colours.
 *   3. A player left with no ink gets their starting domino back.
 * Returns the new board, the contested squares, the cleared lines, and every
 * square that lost its ink (with the colour it had) for the client to animate.
 */
export function resolveTurn(board, moveA, moveB) {
  const nb = board.map((row) => [...row]);
  const aCells = moveA ? moveA.cells : [];
  const bCells = moveB ? moveB.cells : [];
  const bKeys = new Set(bCells.map(([r, c]) => key(r, c)));
  const contested = aCells.filter(([r, c]) => bKeys.has(key(r, c)));
  const ck = new Set(contested.map(([r, c]) => key(r, c)));
  for (const [r, c] of aCells) if (!ck.has(key(r, c))) nb[r][c] = "A";
  for (const [r, c] of bCells) if (!ck.has(key(r, c))) nb[r][c] = "B";

  // Snapshot after both pieces land, so a piece placed and immediately
  // cleared is still seen appearing and then going.
  const staged = nb.map((row) => [...row]);

  const lines = fullLines(nb);
  for (const r of lines.rows) for (let c = 0; c < COLS; c++) nb[r][c] = null;
  for (const c of lines.cols) for (let r = 0; r < ROWS; r++) nb[r][c] = null;

  if (RULES.restoreHome) restoreHomes(nb);

  const cleared = [];
  for (let r = 0; r < ROWS; r++)
    for (let c = 0; c < COLS; c++)
      if (staged[r][c] !== null && nb[r][c] === null) cleared.push([r, c, staged[r][c]]);

  return { board: nb, contested, lines, cleared };
}

/** Points: one per square you own, RULES.centreValue for each centre square. */
export function scoreOf(board) {
  let a = 0, b = 0;
  for (let r = 0; r < ROWS; r++)
    for (let c = 0; c < COLS; c++) {
      const v = board[r][c];
      if (v !== "A" && v !== "B") continue;
      const pts = isCentre(r, c) ? RULES.centreValue : 1;
      if (v === "A") a += pts; else b += pts;
    }
  return { a, b, s: 0 };
}

/* ---------- decks ---------- */

export function shuffled(arr, rand = Math.random) {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** A small seeded generator (mulberry32): the same seed deals the same pieces. */
function nextRand(state) {
  const s = (state + 0x6d2b79f5) | 0;
  let t = Math.imul(s ^ (s >>> 15), 1 | s);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return [((t ^ (t >>> 14)) >>> 0) / 4294967296, s];
}
export const newSeed = () => Math.floor(Math.random() * 4294967296) | 0;

/**
 * The queue: a 7-bag, as in Tetris. Each pass deals all seven pieces once,
 * freshly shuffled, so nothing floods and nothing goes missing. The front of
 * the queue is the piece you play this turn; the queue is kept topped up so
 * the next QUEUE_SHOWN pieces are always known (to both players).
 *
 * A deck is { queue: [{ id, pass }], passes, seed } — `pass` counts from 1.
 * The seed carries the shuffle, so two decks started from the same seed deal
 * exactly the same sequence (see RULES.sharedSequence).
 */
function topUp(deck, loadout) {
  let { queue, passes, seed } = deck;
  while (queue.length < QUEUE_SHOWN + 1) {
    passes += 1;
    const rand = () => { const [v, s2] = nextRand(seed); seed = s2; return v; };
    queue = [...queue, ...shuffled(loadout, rand).map((id) => ({ id, pass: passes }))];
  }
  return { queue, passes, seed };
}

export function newDeck(loadout = DEFAULT_LOADOUT, seed = newSeed()) {
  return topUp({ queue: [], passes: 0, seed }, loadout);
}

/** Plays (or skips) the current piece and moves the queue on. */
export function advanceDeck(deck, loadout = DEFAULT_LOADOUT) {
  return topUp({ queue: deck.queue.slice(1), passes: deck.passes, seed: deck.seed }, loadout);
}

export const currentPiece = (deck) => deck.queue[0].id;
export const currentPass = (deck) => deck.queue[0].pass;
export const upcoming = (deck) => deck.queue.slice(1, QUEUE_SHOWN + 1).map((q) => q.id);

/** Every player plays the same seven pieces, whatever a client sends. */
export function sanitizeLoadout() {
  return [...DEFAULT_LOADOUT];
}
