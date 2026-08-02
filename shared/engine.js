/**
 * TURF BLOCKS — rules engine.
 *
 * Pure functions only. No React, no DOM, no Node APIs.
 * The client imports this to render and predict; the server imports the
 * SAME FILE to be the referee. If these ever disagree, players desync.
 */

import { RULES } from "./rules.js";

export const COLS = 8;
export const ROWS = 16;
export const TURNS = RULES.turns;
export const HAND_SIZE = RULES.handSize;
export const SLOTS = 8;
export const GOLDEN_SLOT = RULES.goldenSlot;

export const BLOCKS = [
  // SMALL 1–3
  { name: "DOT", cells: [[0, 0]] },
  { name: "BAR", cells: [[0, 0], [0, 1]] },
  { name: "TWIN", cells: [[0, 0], [1, 1]] },
  { name: "GAP", cells: [[0, 0], [0, 2]] },
  { name: "RUN", cells: [[0, 0], [0, 1], [0, 2]] },
  { name: "ELL", cells: [[0, 0], [1, 0], [1, 1]] },
  { name: "STEP", cells: [[0, 0], [1, 1], [2, 2]] },
  { name: "WEDGE", cells: [[0, 0], [0, 2], [1, 1]] },
  { name: "SPUR", cells: [[0, 0], [1, 0], [1, 2]] },
  { name: "SPRAY", cells: [[0, 0], [1, 2], [2, 0]] },
  // MEDIUM 4–7
  { name: "BLOK", cells: [[0, 0], [0, 1], [1, 0], [1, 1]] },
  { name: "TEE", cells: [[0, 0], [0, 1], [0, 2], [1, 1]] },
  { name: "ZIG", cells: [[0, 1], [0, 2], [1, 0], [1, 1]] },
  { name: "LINE", cells: [[0, 0], [0, 1], [0, 2], [0, 3]] },
  { name: "JAY", cells: [[0, 0], [1, 0], [2, 0], [2, 1]] },
  { name: "PINS", cells: [[0, 0], [0, 2], [2, 0], [2, 2]] },
  { name: "CROSS", cells: [[0, 1], [1, 0], [1, 1], [1, 2], [2, 1]] },
  { name: "LANCE", cells: [[0, 0], [0, 1], [0, 2], [0, 3], [0, 4]] },
  { name: "PEE", cells: [[0, 0], [0, 1], [1, 0], [1, 1], [2, 0]] },
  { name: "FORK", cells: [[0, 0], [0, 2], [1, 1], [2, 0], [2, 2]] },
  { name: "SLAB", cells: [[0, 0], [0, 1], [1, 0], [1, 1], [2, 0], [2, 1]] },
  { name: "HOOK", cells: [[0, 0], [1, 0], [2, 0], [2, 1], [2, 2], [1, 2]] },
  { name: "AITCH", cells: [[0, 0], [0, 2], [1, 0], [1, 1], [1, 2], [2, 0], [2, 2]] },
  { name: "CHAIR", cells: [[0, 0], [0, 1], [1, 0], [1, 1], [2, 0], [2, 1], [2, 2]] },
  // BIG 8–12
  { name: "RING", cells: [[0, 0], [0, 1], [0, 2], [1, 0], [1, 2], [2, 0], [2, 1], [2, 2]] },
  { name: "BRICK", cells: [[0, 0], [0, 1], [0, 2], [0, 3], [1, 0], [1, 1], [1, 2], [1, 3]] },
  { name: "RAMP", cells: [[0, 0], [1, 0], [1, 1], [2, 0], [2, 1], [2, 2], [3, 0], [3, 1], [3, 2]] },
  { name: "CORE", cells: [[0, 0], [0, 1], [0, 2], [1, 0], [1, 1], [1, 2], [2, 0], [2, 1], [2, 2]] },
  { name: "TOWER", cells: [[0, 0], [0, 1], [1, 0], [1, 1], [2, 0], [2, 1], [3, 0], [3, 1], [4, 0], [4, 1]] },
  { name: "FORT", cells: [[0, 0], [0, 1], [0, 2], [1, 0], [1, 1], [1, 2], [2, 0], [2, 1], [2, 2], [3, 1]] },
  { name: "VAULT", cells: [[0, 0], [0, 1], [0, 2], [1, 0], [1, 1], [1, 2], [2, 0], [2, 1], [2, 2], [3, 0], [3, 1], [3, 2]] },
];

export const DEFAULT_LOADOUT = ["DOT", "BAR", "RUN", "ELL", "BLOK", "TEE", "CROSS", "SLAB"]
  .map((n) => BLOCKS.findIndex((b) => b.name === n));

export const sizeOf = (n) => (n <= 3 ? "SMALL" : n <= 7 ? "MEDIUM" : "BIG");

/** Plays needed before the golden slot charges, by block size. */
export function goldenCycleFor(blockId) {
  const s = sizeOf(BLOCKS[blockId].cells.length);
  const c = RULES.goldenCycle;
  return s === "SMALL" ? c.small : s === "MEDIUM" ? c.medium : c.large;
}
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

/**
 * Every square must be free, and at least one must touch your own ink (8-way).
 * A charged golden piece may also land on the opponent's ink, converting it.
 */
export function isLegal(board, cells, owner, { golden = false } = {}) {
  const opp = owner === "A" ? "B" : "A";
  for (const [r, c] of cells) {
    if (!Number.isInteger(r) || !Number.isInteger(c)) return false;
    if (r < 0 || c < 0 || r >= ROWS || c >= COLS) return false;
    const v = board[r][c];
    if (v === null) continue;
    if (golden && v === opp) continue;
    if (golden && v === "S" && RULES.goldenEatsSpecial) continue;
    return false;
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

/** @param goldenBlockId if that block is in hand it is enumerated as golden. */
export function enumerateMoves(board, hand, owner, { goldenBlockId = null } = {}) {
  const out = [];
  const seen = new Set();
  for (let hi = 0; hi < hand.length; hi++) {
    const blockId = hand[hi];
    const golden = goldenBlockId !== null && blockId === goldenBlockId;
    for (let rot = 0; rot < 4; rot++) {
      const cells = rotateN(BLOCKS[blockId].cells, rot);
      const { h, w } = boundsOf(cells);
      for (let r = 0; r <= ROWS - h; r++)
        for (let c = 0; c <= COLS - w; c++) {
          const abs = absCells(cells, [r, c]);
          if (!isLegal(board, abs, owner, { golden })) continue;
          const sig = hi + ":" + abs.map(([a, b]) => key(a, b)).sort((x, y) => x - y).join(",");
          if (seen.has(sig)) continue;
          seen.add(sig);
          out.push({ handIdx: hi, blockId, rot, pos: [r, c], cells: abs, value: cells.length, golden });
        }
    }
  }
  return out;
}

export const hasAnyMove = (board, hand, owner, opts) => enumerateMoves(board, hand, owner, opts).length > 0;

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

/**
 * Simultaneous resolution. Both moves land at once; squares claimed by both
 * are resolved by RULES.golden.
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

  // Snapshot AFTER both moves land. A block placed this turn and immediately
  // wiped by clearRow still needs to be seen appearing and then destroyed.
  const staged = nb.map((row) => [...row]);

  const wipe = (r, c) => { if (r >= 0 && c >= 0 && r < ROWS && c < COLS) nb[r][c] = null; };

  switch (RULES.golden) {
    case "vanish":
      for (const [r, c] of contested) wipe(r, c);
      break;

    case "clearRow":
      for (const [r] of contested) for (let c = 0; c < COLS; c++) wipe(r, c);
      break;

    case "clearColumn":
      for (const [, c] of contested) for (let r = 0; r < ROWS; r++) wipe(r, c);
      break;

    case "blast": {
      const rad = Math.max(0, RULES.blastRadius | 0);
      for (const [r, c] of contested)
        for (let dr = -rad; dr <= rad; dr++)
          for (let dc = -rad; dc <= rad; dc++) wipe(r + dr, c + dc);
      break;
    }

    case "swap": {
      // Whoever is behind on turf takes the contested squares.
      const s = scoreOf(nb);
      const winner = s.a === s.b ? (Math.random() < 0.5 ? "A" : "B") : s.a < s.b ? "A" : "B";
      for (const [r, c] of contested) nb[r][c] = winner;
      break;
    }

    case "special":
    default:
      for (const [r, c] of contested) nb[r][c] = "S";
  }

  if (RULES.restoreHome && contested.length) restoreHomes(nb);

  // Everything that lost its ink this turn, with the colour it used to be —
  // the client animates these rippling out of existence.
  const cleared = [];
  for (let r = 0; r < ROWS; r++)
    for (let c = 0; c < COLS; c++)
      if (staged[r][c] !== null && nb[r][c] === null) cleared.push([r, c, staged[r][c]]);

  return { board: nb, contested, cleared };
}

export function scoreOf(board) {
  let a = 0, b = 0, s = 0;
  for (const row of board)
    for (const v of row) {
      if (v === "A") a++;
      else if (v === "B") b++;
      else if (v === "S") s++;
    }
  return { a, b, s };
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

/**
 * Bag randomiser, Tetris-style. Each bag is one shuffled copy of your eight
 * blocks, so across any eight draws you see each block exactly once — no
 * droughts, no floods, but the order inside a bag is still a surprise.
 * The opening hand comes off the first bag, so it's a fair random four.
 */
export function newDeck(loadout, rand = Math.random) {
  const bag = shuffled(loadout, rand);
  return { hand: bag.slice(0, HAND_SIZE), bag: bag.slice(HAND_SIZE) };
}

/** Removes the played block and draws one, refilling the bag when it empties. */
export function cycleHand(deck, handIdx, loadout, rand = Math.random) {
  const hand = deck.hand.filter((_, i) => i !== handIdx);
  let bag = [...deck.bag];
  if (!bag.length) bag = shuffled(loadout, rand);
  const next = bag.shift();
  if (next !== undefined) hand.push(next);
  return { hand, bag };
}

/** Never trust a client-supplied loadout. */
export function sanitizeLoadout(input) {
  if (!Array.isArray(input)) return [...DEFAULT_LOADOUT];
  const seen = new Set();
  const out = [];
  for (const v of input) {
    const i = Number(v);
    if (!Number.isInteger(i) || i < 0 || i >= BLOCKS.length || seen.has(i)) continue;
    seen.add(i);
    out.push(i);
    if (out.length === SLOTS) break;
  }
  for (const d of DEFAULT_LOADOUT) {
    if (out.length === SLOTS) break;
    if (!seen.has(d)) { seen.add(d); out.push(d); }
  }
  return out;
}