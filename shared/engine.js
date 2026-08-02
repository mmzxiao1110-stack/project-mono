/**
 * TURF BLOCKS — rules engine.
 *
 * Pure functions only. No React, no DOM, no Node APIs.
 * The client imports this to render and predict; the server imports the
 * SAME FILE to be the referee. If these ever disagree, players desync.
 */

export const COLS = 8;
export const ROWS = 16;
export const TURNS = 20;
export const HAND_SIZE = 4;
export const SLOTS = 8;
export const COPIES_PER_TYPE = 8;

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

/** Every square empty, and at least one square touching your own ink (8-way). */
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

export function enumerateMoves(board, hand, owner) {
  const out = [];
  const seen = new Set();
  for (let hi = 0; hi < hand.length; hi++) {
    const blockId = hand[hi];
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

export const hasAnyMove = (board, hand, owner) => enumerateMoves(board, hand, owner).length > 0;

/** Simultaneous resolution. Squares both players claim this turn go SPECIAL. */
export function resolveTurn(board, moveA, moveB) {
  const nb = board.map((row) => [...row]);
  const aCells = moveA ? moveA.cells : [];
  const bCells = moveB ? moveB.cells : [];
  const bKeys = new Set(bCells.map(([r, c]) => key(r, c)));
  const contested = aCells.filter(([r, c]) => bKeys.has(key(r, c)));
  const ck = new Set(contested.map(([r, c]) => key(r, c)));
  for (const [r, c] of aCells) if (!ck.has(key(r, c))) nb[r][c] = "A";
  for (const [r, c] of bCells) if (!ck.has(key(r, c))) nb[r][c] = "B";
  for (const [r, c] of contested) nb[r][c] = "S";
  return { board: nb, contested };
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

export function dealFrom(loadout, rand = Math.random) {
  const full = [];
  for (const id of loadout) for (let n = 0; n < COPIES_PER_TYPE; n++) full.push(id);
  const deck = shuffled(full, rand);
  return { hand: deck.slice(0, HAND_SIZE), deck: deck.slice(HAND_SIZE) };
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
