/**
 * ZERO-G — a falling-block Sprint with no gravity.
 *
 *   A 10-wide, 40-tall board (the bottom 20 rows are the field you see; the
 *   20 above are buffer). The seven tetrominoes come from a 7-bag; you see
 *   the next five and can hold one (once per piece). Pieces spawn above the
 *   field and stay where they are until you move them: nothing falls on its
 *   own. Soft drop moves the piece down, hard drop drops it and locks it.
 *   A piece only locks on a hard drop. Full rows clear at once.
 *
 *   Rotation is SRS: the four states of every piece around its box, the
 *   standard wall kicks, plus a 180 turn with its own short kick list.
 *   T-spins use the three-corner rule (a mini when the front corners aren't
 *   both filled, unless the last kick was used).
 *
 * Coordinates: x is the column (0 left), y is the row (0 top, 39 bottom).
 * Kick tables are written as in the SRS reference (y up) and flipped here.
 */

export const W = 10;
export const H = 40;
export const VISIBLE = 20;        // rows H-VISIBLE … H-1 are the field
export const TOP = H - VISIBLE;   // the first row of the field
export const NEXT = 5;
export const GOAL = 40;
export const NAMES = ["I", "O", "T", "S", "Z", "J", "L"];

// Spawn state (state 0) of each piece in its box, [x, y].
const BOX = { I: 4, O: 2, T: 3, S: 3, Z: 3, J: 3, L: 3 };
const STATE0 = {
  I: [[0, 1], [1, 1], [2, 1], [3, 1]],
  O: [[0, 0], [1, 0], [0, 1], [1, 1]],
  T: [[1, 0], [0, 1], [1, 1], [2, 1]],
  S: [[1, 0], [2, 0], [0, 1], [1, 1]],
  Z: [[0, 0], [1, 0], [1, 1], [2, 1]],
  J: [[0, 0], [0, 1], [1, 1], [2, 1]],
  L: [[2, 0], [0, 1], [1, 1], [2, 1]],
};
// Every state, turning clockwise about the box: (x, y) -> (n-1-y, x).
const SHAPES = NAMES.map((n) => {
  const out = [STATE0[n]];
  for (let r = 1; r < 4; r++) out.push(out[r - 1].map(([x, y]) => [BOX[n] - 1 - y, x]));
  return out;
});
export const shapeCells = (id, rot) => SHAPES[id][rot & 3];
export const boxOf = (id) => BOX[NAMES[id]];

// SRS kicks, y up. Key: `${from}${to}` with states 0, 1 (R), 2, 3 (L).
const JLSTZ = {
  "01": [[0, 0], [-1, 0], [-1, 1], [0, -2], [-1, -2]],
  "10": [[0, 0], [1, 0], [1, -1], [0, 2], [1, 2]],
  "12": [[0, 0], [1, 0], [1, -1], [0, 2], [1, 2]],
  "21": [[0, 0], [-1, 0], [-1, 1], [0, -2], [-1, -2]],
  "23": [[0, 0], [1, 0], [1, 1], [0, -2], [1, -2]],
  "32": [[0, 0], [-1, 0], [-1, -1], [0, 2], [-1, 2]],
  "30": [[0, 0], [-1, 0], [-1, -1], [0, 2], [-1, 2]],
  "03": [[0, 0], [1, 0], [1, 1], [0, -2], [1, -2]],
};
const IKICK = {
  "01": [[0, 0], [-2, 0], [1, 0], [-2, -1], [1, 2]],
  "10": [[0, 0], [2, 0], [-1, 0], [2, 1], [-1, -2]],
  "12": [[0, 0], [-1, 0], [2, 0], [-1, 2], [2, -1]],
  "21": [[0, 0], [1, 0], [-2, 0], [1, -2], [-2, 1]],
  "23": [[0, 0], [2, 0], [-1, 0], [2, 1], [-1, -2]],
  "32": [[0, 0], [-2, 0], [1, 0], [-2, -1], [1, 2]],
  "30": [[0, 0], [1, 0], [-2, 0], [1, -2], [-2, 1]],
  "03": [[0, 0], [-1, 0], [2, 0], [-1, 2], [2, -1]],
};
// The 180 turn: in place, else one up, up-and-across, then across.
const K180 = [[0, 0], [0, 1], [1, 1], [-1, 1], [1, 0], [-1, 0]];

/** A seeded random source (mulberry32), so a run can be replayed from its seed. */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export const newSeed = () => (Math.random() * 2 ** 32) >>> 0;

function refill(st) {
  while (st.queue.length < NEXT + 1) {
    const bag = [0, 1, 2, 3, 4, 5, 6];
    for (let i = bag.length - 1; i > 0; i--) { const j = Math.floor(st.rand() * (i + 1)); [bag[i], bag[j]] = [bag[j], bag[i]]; }
    st.queue.push(...bag);
  }
}

/** A fresh run. The piece in play is `st.cur`: { id, rot, x, y }. */
export function newGame(seed = newSeed(), goal = GOAL) {
  const st = {
    seed, goal, rand: rng(seed),
    board: Array.from({ length: H }, () => Array(W).fill(null)),
    queue: [], hold: null, held: false, cur: null,
    lines: 0, pieces: 0, combo: -1, b2b: -1, over: false, won: false,
    lastRot: false, lastKick: 0, last: null,
    stats: { single: 0, double: 0, triple: 0, quad: 0, tspin: 0, allClear: 0, maxCombo: 0 },
  };
  refill(st);
  spawn(st, st.queue.shift());
  return st;
}

export const cellsOf = (p) => shapeCells(p.id, p.rot).map(([x, y]) => [p.x + x, p.y + y]);
const free = (board, x, y) => x >= 0 && x < W && y >= 0 && y < H && board[y][x] === null;
export const fits = (board, p) => cellsOf(p).every(([x, y]) => free(board, x, y));

/** A new piece just above the field, centred. Blocked: the run is over. */
function spawn(st, id) {
  refill(st);
  const box = BOX[NAMES[id]];
  st.cur = { id, rot: 0, x: box === 2 ? 4 : 3, y: TOP - 2 };
  st.lastRot = false; st.lastKick = 0;
  if (!fits(st.board, st.cur)) { st.over = true; st.cur = null; }
}

/** Shift sideways by dx (one column). True if it moved. */
export function shift(st, dx) {
  if (!st.cur) return false;
  const p = { ...st.cur, x: st.cur.x + dx };
  if (!fits(st.board, p)) return false;
  st.cur = p; st.lastRot = false;
  return true;
}
/** Down one row (soft drop). True if it moved. */
export function down(st) {
  if (!st.cur) return false;
  const p = { ...st.cur, y: st.cur.y + 1 };
  if (!fits(st.board, p)) return false;
  st.cur = p; st.lastRot = false;
  return true;
}
/** Where a hard drop would land: the ghost. */
export function dropped(board, p) {
  let q = p;
  while (fits(board, { ...q, y: q.y + 1 })) q = { ...q, y: q.y + 1 };
  return q;
}

/** Turn by 1 (clockwise), -1 (counter-clockwise) or 2 (180), with kicks. True if it turned. */
export function rotate(st, dir) {
  const p = st.cur;
  if (!p) return false;
  const name = NAMES[p.id];
  if (name === "O") return false;
  const to = (p.rot + (dir === 2 ? 2 : dir) + 4) & 3;
  const kicks = dir === 2 ? K180 : (name === "I" ? IKICK : JLSTZ)[`${p.rot}${to}`];
  for (let i = 0; i < kicks.length; i++) {
    const [kx, ky] = kicks[i];
    const q = { ...p, rot: to, x: p.x + kx, y: p.y - ky };
    if (fits(st.board, q)) { st.cur = q; st.lastRot = true; st.lastKick = i; return true; }
  }
  return false;
}

/** Swap with the held piece (once per piece). True if it held. */
export function hold(st) {
  if (!st.cur || st.held) return false;
  const id = st.cur.id;
  const next = st.hold === null ? st.queue.shift() : st.hold;
  st.hold = id; st.held = true;
  spawn(st, next);
  return true;
}

// T-spin: three of the four corners of the T's box are filled (walls count).
function tSpin(st, p) {
  if (NAMES[p.id] !== "T" || !st.lastRot) return null;
  const at = ([dx, dy]) => !free(st.board, p.x + dx, p.y + dy);
  const corners = [[0, 0], [2, 0], [2, 2], [0, 2]]; // clockwise from top left
  const filled = corners.map(at);
  if (filled.filter(Boolean).length < 3) return null;
  // The two corners the T points at, for each state.
  const front = [[0, 1], [1, 2], [2, 3], [3, 0]][p.rot];
  return front.every((i) => filled[i]) || st.lastKick === 4 ? "full" : "mini";
}

/**
 * Hard drop: down as far as it goes, lock, clear full rows.
 * `st.last` describes what happened: { lines, rows, spin, combo, b2b, allClear, name }.
 */
export function hardDrop(st) {
  if (!st.cur) return null;
  const p = dropped(st.board, st.cur);
  if (p.y !== st.cur.y) st.lastRot = false;
  const spin = tSpin(st, p);
  const cells = cellsOf(p);
  for (const [x, y] of cells) st.board[y][x] = p.id;
  st.pieces++;
  const rows = [];
  for (let y = 0; y < H; y++) if (st.board[y].every((v) => v !== null)) rows.push(y);
  if (rows.length) {
    const keep = st.board.filter((_, y) => !rows.includes(y));
    st.board = [...Array.from({ length: rows.length }, () => Array(W).fill(null)), ...keep];
  }
  const n = rows.length;
  const allClear = n > 0 && st.board.every((row) => row.every((v) => v === null));
  const special = n === 4 || (spin && n > 0);
  if (n) {
    st.combo++;
    st.b2b = special ? st.b2b + 1 : -1;
    st.lines += n;
    st.stats[["single", "double", "triple", "quad"][Math.min(n, 4) - 1]]++;
    if (spin) st.stats.tspin++;
    if (allClear) st.stats.allClear++;
    st.stats.maxCombo = Math.max(st.stats.maxCombo, st.combo);
  } else {
    st.combo = -1;
  }
  st.last = { lines: n, rows, spin, combo: st.combo, b2b: n ? st.b2b : -1, allClear, name: clearName(n, spin), piece: p };
  st.held = false;
  // Locked wholly above the field: topped out.
  const lockOut = cells.every(([, y]) => y < TOP);
  if (st.lines >= st.goal) { st.over = true; st.won = true; st.cur = null; }
  else if (lockOut) { st.over = true; st.cur = null; }
  else spawn(st, st.queue.shift());
  return st.last;
}

export function clearName(n, spin) {
  const word = ["", "SINGLE", "DOUBLE", "TRIPLE", "QUAD"][Math.min(n, 4)] || "";
  if (spin) return `${spin === "mini" ? "T-SPIN MINI" : "T-SPIN"}${word ? ` ${word}` : ""}`;
  return word;
}

/** A copy to change without touching the original (the random source is shared: it only moves forward). */
export const clone = (st) => ({ ...st, board: st.board.map((r) => r.slice()), queue: st.queue.slice(), cur: st.cur && { ...st.cur }, stats: { ...st.stats } });
