/**
 * SPRINT — clear 40 lines as fast as you can. Keyboard only.
 *
 *   The 7×7 board, the seven tetrominoes from a shuffled 7-bag (each one
 *   once per bag). You hold three and see a fourth, the forecast: the piece
 *   you place is replaced by the forecast, and a new forecast comes from the
 *   bag. Pick a piece and it appears in the middle of the board; move it,
 *   turn it, place it. Nothing falls. Full rows and columns clear, like
 *   Marathon; each counts as a line. 40 lines stops the clock. If none of
 *   your three pieces fits anywhere, turned any way, the run is over.
 *
 * Every piece spawns in one fixed way, symmetric about the middle column
 * where it can be: I upright, T as a T, J and L with the long stem in the
 * middle, S and Z flat, O in the top-right of the centre 3×3.
 */

export const SIZE = 7;
export const HAND = 3;
export const GOAL = 40;
export const NAMES = ["I", "O", "T", "S", "Z", "J", "L"];

// Spawn cells on the board, [row, col]. The centre square is (3, 3).
const SPAWN = {
  I: [[1, 3], [2, 3], [3, 3], [4, 3]],
  O: [[2, 3], [2, 4], [3, 3], [3, 4]],
  T: [[2, 2], [2, 3], [2, 4], [3, 3]],
  S: [[2, 3], [2, 4], [3, 2], [3, 3]],
  Z: [[2, 2], [2, 3], [3, 3], [3, 4]],
  J: [[2, 3], [3, 3], [4, 3], [4, 2]],
  L: [[2, 3], [3, 3], [4, 3], [4, 4]],
};

/** Each piece as a shape in its own box (top-left 0,0), turned 0–3 quarter turns clockwise. */
const BASE = NAMES.map((n) => {
  const cells = SPAWN[n];
  const r0 = Math.min(...cells.map((c) => c[0])), c0 = Math.min(...cells.map((c) => c[1]));
  const norm = cells.map(([r, c]) => [r - r0, c - c0]);
  const h = Math.max(...norm.map((c) => c[0])) + 1, w = Math.max(...norm.map((c) => c[1])) + 1;
  const out = [{ cells: norm, h, w }];
  for (let k = 1; k < 4; k++) {
    const p = out[k - 1];
    out.push({ cells: p.cells.map(([r, c]) => [c, p.h - 1 - r]), h: p.w, w: p.h });
  }
  return { spawn: [r0, c0], shapes: out };
});
export const shapeOf = (id, rot = 0) => BASE[id].shapes[((rot % 4) + 4) % 4];

/* ---------- seeded 7-bag ---------- */

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export const newSprintSeed = () => (Math.random() * 2 ** 31) >>> 0;
function draw(st) {
  if (!st.bag.length) {
    const bag = NAMES.map((_, i) => i);
    for (let i = bag.length - 1; i > 0; i--) { const j = Math.floor(st.rand() * (i + 1)); [bag[i], bag[j]] = [bag[j], bag[i]]; }
    st.bag = bag;
  }
  return st.bag.pop();
}

export function newSprint(seed) {
  const st = {
    seed, rand: rng(seed), bag: [],
    board: Array.from({ length: SIZE }, () => Array(SIZE).fill(null)),
    hand: [], next: null, lines: 0, pieces: 0, over: false, won: false,
  };
  for (let i = 0; i < HAND; i++) st.hand.push(draw(st));
  st.next = draw(st);
  return st;
}

/* ---------- the piece in play ---------- */

/**
 * A piece being moved: which hand slot, how it's turned, and where its
 * centre is. The centre stays put when it turns, so turning back and forth
 * never walks the piece across the board.
 */
export function spawn(st, slot) {
  const id = st.hand[slot];
  const b = BASE[id], s = b.shapes[0];
  return { slot, id, rot: 0, cr: b.spawn[0] + s.h / 2, cc: b.spawn[1] + s.w / 2 };
}
/** The squares a piece would cover around its centre, without keeping it on the board. */
function rawCells(a) {
  const s = shapeOf(a.id, a.rot);
  const r = Math.floor(a.cr - s.h / 2 + 0.5), c = Math.floor(a.cc - s.w / 2 + 0.5);
  return s.cells.map(([dr, dc]) => [r + dr, c + dc]);
}
/**
 * The piece pushed back onto the board if a turn left it poking out. Turning
 * never moves its centre, only how it's shown, so turning back and forth
 * against a wall always comes back to the same squares.
 */
function settle(a) {
  const cells = rawCells(a);
  const minR = Math.min(...cells.map((c) => c[0])), maxR = Math.max(...cells.map((c) => c[0]));
  const minC = Math.min(...cells.map((c) => c[1])), maxC = Math.max(...cells.map((c) => c[1]));
  const dr = minR < 0 ? -minR : maxR >= SIZE ? SIZE - 1 - maxR : 0;
  const dc = minC < 0 ? -minC : maxC >= SIZE ? SIZE - 1 - maxC : 0;
  return dr || dc ? { ...a, cr: a.cr + dr, cc: a.cc + dc } : a;
}
/** The squares a moving piece covers (always on the board). */
export const cellsOf = (a) => rawCells(settle(a));
const inside = (cells) => cells.every(([r, c]) => r >= 0 && c >= 0 && r < SIZE && c < SIZE);

/** Moves by (dr, dc), only while it stays on the board. With `far`, as far as it can go. */
export function shift(a, dr, dc, far = false) {
  // Moving makes any push from the wall real: it moves from where you see it.
  let cur = settle(a);
  for (let i = 0; i < (far ? SIZE : 1); i++) {
    const nxt = { ...cur, cr: cur.cr + dr, cc: cur.cc + dc };
    if (!inside(rawCells(nxt))) break;
    cur = nxt;
  }
  return cur;
}
/**
 * Puts a piece as near as it can get to a point on the board (in squares,
 * fractions allowed, e.g. from the mouse), always wholly on the board: past
 * an edge, it sits against that edge.
 */
export function at(a, row, col) {
  const s = shapeOf(a.id, a.rot);
  const clamp = (v, max) => Math.max(0, Math.min(max, v));
  const r = clamp(Math.round(row - s.h / 2), SIZE - s.h);
  const c = clamp(Math.round(col - s.w / 2), SIZE - s.w);
  return { ...a, cr: r + s.h / 2, cc: c + s.w / 2 };
}

/** Turns a quarter turn (dir 1 clockwise, -1 counter-clockwise) about its centre; shown pushed onto the board if it pokes out. */
export const turn = (a, dir) => ({ ...a, rot: (a.rot + dir + 4) % 4 });
export const canPlace = (st, a) => cellsOf(a).every(([r, c]) => st.board[r][c] === null);

/** Is there any place, turned any way, for any piece in hand? */
export function anyFits(st) {
  for (const id of st.hand) for (let rot = 0; rot < 4; rot++) {
    const s = shapeOf(id, rot);
    for (let r = 0; r + s.h <= SIZE; r++) for (let c = 0; c + s.w <= SIZE; c++) {
      if (s.cells.every(([dr, dc]) => st.board[r + dr][c + dc] === null)) return true;
    }
  }
  return false;
}

/**
 * Places the moving piece. Mutates and returns `st` with `st.last`
 * ({ cells, cleared, lines }), or null if it doesn't fit. The used slot takes
 * the forecast; the forecast takes the next piece from the bag.
 */
export function place(st, a) {
  if (st.over || !canPlace(st, a)) return null;
  const cells = cellsOf(a);
  for (const [r, c] of cells) st.board[r][c] = a.id;
  const rows = [], cols = [];
  for (let i = 0; i < SIZE; i++) {
    if (st.board[i].every((v) => v !== null)) rows.push(i);
    if (st.board.every((row) => row[i] !== null)) cols.push(i);
  }
  const cleared = [], seen = new Set();
  const wipe = (r, c) => { const k = r * SIZE + c; if (!seen.has(k)) { seen.add(k); cleared.push([r, c, st.board[r][c]]); } };
  for (const r of rows) for (let c = 0; c < SIZE; c++) wipe(r, c);
  for (const c of cols) for (let r = 0; r < SIZE; r++) wipe(r, c);
  for (const [r, c] of cleared) st.board[r][c] = null;
  st.lines += rows.length + cols.length;
  st.pieces += 1;
  st.hand[a.slot] = st.next;
  st.next = draw(st);
  st.last = { cells, cleared, lines: rows.length + cols.length, id: a.id };
  if (st.lines >= GOAL) { st.over = true; st.won = true; }
  else if (!anyFits(st)) st.over = true;
  return st;
}
