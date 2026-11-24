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

// The single square: only dealt when RULES.monoPiece is on.
export const MONO = BLOCKS.push({ name: "M", cells: [[0, 0]] }) - 1;

// Everyone plays the same pieces: there's no deck to build.
export const DEFAULT_LOADOUT = BLOCKS.map((_, i) => i).filter((i) => i !== MONO || RULES.monoPiece);

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

// Home pairs sit on the edge of the live board (the real edge until overtime shrinks it).
const homeCells = (owner, board) => {
  const m = Math.floor(COLS / 2) - 1;
  const k = board ? deadRingsOf(board) : 0;
  const r = owner === "A" ? ROWS - 1 - k : k;
  return [[r, m], [r, m + 1]];
};
function deadRingsOf(board) { let k = 0; while (k < ROWS / 2 && board[k][k] === "X") k++; return k; }

/** Nobody should be left with no ink to build from. */
function restoreHomes(nb) {
  for (const owner of ["A", "B"]) {
    let has = false;
    for (const row of nb) { if (row.includes(owner)) { has = true; break; } }
    if (!has) for (const [r, c] of homeCells(owner, nb)) nb[r][c] = owner;
  }
}

/** Full rows and columns, as { rows: [r…], cols: [c…] }. */
export function fullLines(board) {
  // Only the live zone counts: in overtime the dead rings (and the anchors
  // on them) are outside every line.
  let k = 0;
  while (k < ROWS / 2 && board[k][k] === "X") k++;
  const rows = [], cols = [];
  const lo = k, hi = ROWS - 1 - k;
  if (RULES.clearRows) for (let r = lo; r <= hi; r++) {
    let full = true;
    for (let c = lo; c <= hi; c++) if (board[r][c] === null) { full = false; break; }
    if (full) rows.push(r);
  }
  if (RULES.clearColumns) for (let c = lo; c <= hi; c++) {
    let full = true;
    for (let r = lo; r <= hi; r++) if (board[r][c] === null) { full = false; break; }
    if (full) cols.push(c);
  }
  return { rows, cols };
}

/* ---------- delete and pin ---------- */

export const emptyPins = () => Array.from({ length: ROWS }, () => Array(COLS).fill(false));
const isPinned = (pins, r, c) => !!(pins && pins[r] && pins[r][c]);

/** Are these squares one connected shape (sides only, or corners too per RULES.connectDiagonal)? */
export function connected(cells) {
  if (!cells.length) return false;
  const want = new Set(cells.map(([r, c]) => key(r, c)));
  const seen = new Set([key(...cells[0])]);
  const stack = [cells[0]];
  while (stack.length) {
    const [r, c] = stack.pop();
    for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
      if (!dr && !dc) continue;
      if (dr && dc && !RULES.connectDiagonal) continue;
      const k = key(r + dr, c + dc);
      if (r + dr < 0 || c + dc < 0 || r + dr >= ROWS || c + dc >= COLS) continue;
      if (want.has(k) && !seen.has(k)) { seen.add(k); stack.push([r + dr, c + dc]); }
    }
  }
  return seen.size === want.size;
}

const distinctOnBoard = (cells) => {
  if (!Array.isArray(cells)) return false;
  const ks = new Set();
  for (const p of cells) {
    if (!Array.isArray(p)) return false;
    const [r, c] = p;
    if (!Number.isInteger(r) || !Number.isInteger(c) || r < 0 || c < 0 || r >= ROWS || c >= COLS) return false;
    ks.add(key(r, c));
  }
  return ks.size === cells.length;
};

/** 1–4 connected squares with ink, none of them pinned. */
export function isLegalDelete(board, pins, cells) {
  if (!RULES.actions || !distinctOnBoard(cells) || cells.length < 1 || cells.length > RULES.deleteMax) return false;
  for (const [r, c] of cells) if (board[r][c] === null || board[r][c] === "X" || isPinned(pins, r, c)) return false;
  return connected(cells);
}

/** Up to min(RULES.pinMax, your meter) squares (connected, if the rules say), yours (or any ink), not already pinned. */
export function isLegalPin(board, pins, cells, owner, meter) {
  if (!RULES.actions || !distinctOnBoard(cells) || cells.length < 1 || cells.length > Math.min(RULES.pinMax, meter)) return false;
  for (const [r, c] of cells) {
    const v = board[r][c];
    if (v === null || v === "X" || isPinned(pins, r, c)) return false;
    if (RULES.pinOwnOnly && v !== owner) return false;
  }
  if (Number.isFinite(RULES.pinHoldMax)) {
    let held = 0;
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) if (isPinned(pins, r, c) && board[r][c] === owner) held++;
    if (held + cells.length > RULES.pinHoldMax) return false;
  }
  return !RULES.pinConnected || connected(cells);
}

/**
 * Simultaneous resolution. A move is { type: "place", cells } (a plain
 * { cells } is a placement too), { type: "delete", cells },
 * { type: "pin", cells }, or null for a pass. In order:
 *   1. Pins set.
 *   2. Deletes remove ink (never pinned squares).
 *   3. Both pieces land. A square both claimed stays empty.
 *   4. Every full row and column is wiped — both colours, except pinned squares.
 *   5. A player left with no ink gets their starting domino back.
 * Returns the new board and pins, the contested squares, the cleared lines,
 * every square that lost its ink (with the colour it had) for the client to
 * animate, and how many squares each side deleted (which feeds the OTHER
 * side's pin meter).
 */
export function resolveTurn(board, moveA, moveB, pins = null) {
  const kind = (m) => (!m ? null : m.type || "place");
  const nb = board.map((row) => [...row]);
  const np = pins ? pins.map((row) => [...row]) : emptyPins();

  // A pin action, or (RULES.pinIsFree) pins added on top of any action.
  for (const m of [moveA, moveB]) {
    if (kind(m) === "pin") for (const [r, c] of m.cells) np[r][c] = true;
    if (m && m.pins) for (const [r, c] of m.pins) np[r][c] = true;
  }

  const deleted = { A: 0, B: 0 };
  const gone = [];
  [["A", moveA], ["B", moveB]].forEach(([side, m]) => {
    if (kind(m) !== "delete") return;
    for (const [r, c] of m.cells) {
      if (np[r][c] || nb[r][c] === null || nb[r][c] === "X") continue; // pinned (even this very turn) holds; nothing to delete
      deleted[side]++;
      gone.push([r, c, nb[r][c]]); nb[r][c] = null;
    }
  });

  const aCells = kind(moveA) === "place" ? moveA.cells : [];
  const bCells = kind(moveB) === "place" ? moveB.cells : [];
  const bKeys = new Set(bCells.map(([r, c]) => key(r, c)));
  const contested = aCells.filter(([r, c]) => bKeys.has(key(r, c)));
  const ck = new Set(contested.map(([r, c]) => key(r, c)));
  for (const [r, c] of aCells) if (!ck.has(key(r, c))) nb[r][c] = "A";
  for (const [r, c] of bCells) if (!ck.has(key(r, c))) nb[r][c] = "B";

  // Snapshot after both pieces land, so a piece placed and immediately
  // cleared is still seen appearing and then going.
  const staged = nb.map((row) => [...row]);

  const lines = fullLines(nb);
  // Pinned squares survive line clears unless the rules say clears beat pins.
  const wipe = (r, c) => { if (nb[r][c] !== "X" && (!np[r][c] || !RULES.pinsSurviveClears)) { nb[r][c] = null; np[r][c] = false; } };
  let lk = 0; while (lk < ROWS / 2 && nb[lk][lk] === "X") lk++; // dead rings: lines stop at the live zone
  for (const r of lines.rows) for (let c = lk; c < COLS - lk; c++) wipe(r, c);
  for (const c of lines.cols) for (let r = lk; r < ROWS - lk; r++) wipe(r, c);

  if (RULES.restoreHome) restoreHomes(nb);

  const cleared = [...gone];
  for (let r = 0; r < ROWS; r++)
    for (let c = 0; c < COLS; c++)
      if (staged[r][c] !== null && nb[r][c] === null) cleared.push([r, c, staged[r][c]]);

  return { board: nb, pins: np, contested, lines, cleared, deleted };
}

/* ---------- stamps ---------- */

/** Is `cells` the current piece, in some rotation, somewhere on the board? */
export function isPieceFootprint(cells, blockId) {
  if (!distinctOnBoard(cells) || !BLOCKS[blockId] || cells.length !== BLOCKS[blockId].cells.length) return false;
  const want = new Set(cells.map(([r, c]) => key(r, c)));
  const r0 = Math.min(...cells.map(([r]) => r)), c0 = Math.min(...cells.map(([, c]) => c));
  for (let rot = 0; rot < 4; rot++) {
    const shape = rotateN(BLOCKS[blockId].cells, rot);
    if (shape.every(([dr, dc]) => want.has(key(r0 + dr, c0 + dc)))) return true;
  }
  return false;
}

/** What a stamp actually touches: ink under it (delete) or your own squares under it (pin), never pinned ones. */
export function stampHits(board, pins, cells, kind, owner) {
  return cells.filter(([r, c]) => {
    const v = board[r][c];
    if (v === null || v === "X" || isPinned(pins, r, c)) return false;
    return kind === "delete" ? true : !RULES.pinOwnOnly || v === owner;
  });
}

/** Every stamp placement of a piece: [{ cells: footprint, hits }], one per distinct set of hits. */
export function stampOptions(board, pins, blockId, kind, owner) {
  const out = [], seen = new Set();
  for (let rot = 0; rot < 4; rot++) {
    const shape = rotateN(BLOCKS[blockId].cells, rot);
    const { h, w } = boundsOf(shape);
    for (let r = 0; r <= ROWS - h; r++) for (let c = 0; c <= COLS - w; c++) {
      const cells = absCells(shape, [r, c]);
      const hits = stampHits(board, pins, cells, kind, owner);
      if (!hits.length) continue;
      const sig = hits.map(([a, b]) => key(a, b)).sort((x, y) => x - y).join(",");
      if (seen.has(sig)) continue;
      seen.add(sig);
      out.push({ cells, hits });
    }
  }
  return out;
}

/**
 * Checks an action and turns stamps into what they hit. Returns
 * { move } (ready for resolveTurn) or { error }.
 *   With RULES.stamp on, a delete's `cells` and a move's `pins` are the
 *   FOOTPRINT of the current piece (`blockId`), placed anywhere; they become
 *   the squares it actually deletes / pins.
 */
export function normalizeAction(board, pins, meter, side, blockId, move) {
  if (!move || !RULES.stamp) {
    const error = checkAction(board, pins, meter, side, move);
    return error ? { error } : { move };
  }
  let out = { ...move };
  if (move.type === "delete") {
    if (!isPieceFootprint(move.cells, blockId)) return { error: "a delete must be your piece's shape" };
    const hits = stampHits(board, pins, move.cells, "delete", side);
    if (!hits.length) return { error: "nothing to delete there" };
    out.cells = hits;
  } else if (move.type === "pin") {
    return { error: "pins ride along with a move" };
  } else if (move.type !== "place" && move.type !== "pass") return { error: "unknown action" };
  if (move.pins) {
    if (!RULES.pinIsFree) return { error: "pinning takes your turn" };
    if (!isPieceFootprint(move.pins, blockId)) return { error: "a pin must be your piece's shape" };
    let hits = stampHits(board, pins, move.pins, "pin", side);
    if (out.type === "delete") hits = hits.filter(([r, c]) => !out.cells.some(([a, b]) => a === r && b === c));
    if (!hits.length) return { error: "nothing of yours to pin there" };
    if (hits.length > meter) return { error: "not enough pins" };
    if (Number.isFinite(RULES.pinHoldMax)) {
      let held = 0;
      for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) if (isPinned(pins, r, c) && board[r][c] === side) held++;
      if (held + hits.length > RULES.pinHoldMax) return { error: "too many pinned squares" };
    }
    out.pins = hits;
  }
  return { move: out };
}

/**
 * Checks a whole action against the board. Returns an error string, or null.
 * move: { type: "place"|"delete"|"pin"|"pass", cells, pins? }. Placements
 * are checked by the caller (they come as rotation + position); here they
 * only need their extra pins checked.
 */
export function checkAction(board, pins, meter, side, move) {
  if (!move) return null;
  const extra = move.pins || null;
  if (move.type === "delete") {
    if (!isLegalDelete(board, pins, move.cells)) return "illegal delete";
  } else if (move.type === "pin") {
    if (RULES.pinIsFree) return "pins ride along with a move";
    if (!isLegalPin(board, pins, move.cells, side, meter)) return "illegal pin";
  } else if (move.type !== "place" && move.type !== "pass") return "unknown action";
  if (extra) {
    if (!RULES.pinIsFree) return "pinning takes your turn";
    if (!isLegalPin(board, pins, extra, side, meter)) return "illegal pin";
    if (move.type === "delete" && extra.some(([r, c]) => move.cells.some(([a, b]) => a === r && b === c))) return "can't pin what you delete";
  }
  return null;
}

/** Pin meters after a turn: what each side deleted goes to the other; pins spent come off. */
export function nextMeters(meters, moveA, moveB, deleted) {
  // Per square deleted, or a flat amount for any delete at all.
  const gained = (n) => (RULES.pinsPerDeleteTurn ? (n > 0 ? RULES.pinsPerDeleteTurn : 0) : n * RULES.pinPerDelete);
  const spent = (m) => (m && m.type === "pin" ? m.cells.length : 0) + (m && m.pins ? m.pins.length : 0);
  return {
    A: Math.min(RULES.pinCap, meters.A - spent(moveA) + gained(deleted.B)),
    B: Math.min(RULES.pinCap, meters.B - spent(moveB) + gained(deleted.A)),
  };
}

/* ---------- overtime ---------- */

/** A dead square: overtime has shrunk the board past it. Nobody can play or delete there. */
export const DEAD = "X";

/** How many rings of the board are dead (0 before overtime). */
export function deadRings(board) {
  let k = 0;
  while (k < ROWS / 2 && board[k][k] === DEAD) k++;
  return k;
}

/** Is the end of this turn a scoring check? The last turn, then every RULES.overtimeEvery turns. */
export function isCheckTurn(t) {
  if (t < TURNS) return false;
  if (t === TURNS || !RULES.overtime) return true;
  return (t - TURNS) % RULES.overtimeEvery === 0;
}

/**
 * Overtime's squeeze: the outermost live ring dies — except each player's
 * home pair, which stays on that ring as a pinned anchor just outside the
 * live zone (so it takes no room inside it, and you can still build in from
 * it). The previous anchors die with the rest. Mutates board and pins.
 * Returns { cleared, live } — `live` is the side of the board still in play.
 */
export function shrinkBoard(board, pins) {
  const k = deadRings(board);
  const cleared = [];
  const kill = (r, c) => {
    if (board[r][c] === "A" || board[r][c] === "B") cleared.push([r, c, board[r][c]]);
    board[r][c] = DEAD;
    if (pins) pins[r][c] = false;
  };
  // The ring dies, and so do the old anchors one ring out.
  for (let r = k; r < ROWS - k; r++) for (let c = k; c < COLS - k; c++)
    if (r === k || r === ROWS - 1 - k || c === k || c === COLS - 1 - k) kill(r, c);
  if (k > 0) for (const owner of ["A", "B"]) for (const [r, c] of homeAt(owner, k - 1)) kill(r, c);
  // The anchors, on the ring that just died, touching the live zone.
  for (const owner of ["A", "B"]) for (const [r, c] of homeAt(owner, k)) {
    board[r][c] = owner;
    if (pins) pins[r][c] = true;
    const i = cleared.findIndex(([a2, b2]) => a2 === r && b2 === c);
    if (i >= 0) cleared.splice(i, 1);
  }
  return { cleared, live: ROWS - 2 * (k + 1) };
}

/** A player's home pair on ring k (the real edge for k = 0). */
function homeAt(owner, k) {
  const m = Math.floor(COLS / 2) - 1;
  const r = owner === "A" ? ROWS - 1 - k : k;
  return [[r, m], [r, m + 1]];
}

/** Score of the live zone only — overtime's final check at the centre. */
export function liveScoreOf(board) {
  const k = deadRings(board);
  let a = 0, b = 0;
  for (let r = k; r < ROWS - k; r++) for (let c = k; c < COLS - k; c++) {
    const v = board[r][c];
    const pts = isCentre(r, c) ? RULES.centreValue : 1;
    if (v === "A") a += pts; else if (v === "B") b += pts;
  }
  return { a, b, s: 0 };
}

/** Points: one per square you own, RULES.centreValue for each centre square. Dead squares score nothing. */
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
