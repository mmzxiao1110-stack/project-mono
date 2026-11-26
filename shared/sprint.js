/**
 * SPRINT — clear 40 lines as fast as you can. Keyboard only.
 *
 *   The 8×8 board, the seven tetrominoes from a shuffled 7-bag (each one
 *   once per bag). You hold two and see the next three: the piece you place
 *   is replaced by the first of those, and a new one joins the end from the
 *   bag. One of your two is always in play, in the middle of the board; swap
 *   to the other with one key. Move it, turn it, place it. Nothing falls.
 *   Full rows and columns clear, like Marathon; each counts as a line.
 *   40 lines stops the clock. If neither piece fits anywhere, turned any
 *   way, the run is over.
 *
 * Every piece spawns lying flat in the middle of the board.
 */

export const SIZE = 8;
export const HAND = 2;
export const FORECAST = 5;
export const GOAL = 40;
export const NAMES = ["I", "O", "T", "S", "Z", "J", "L"];

/**
 * ULTRA (2 minutes, highest score) scores every clear: more lines at once
 * pay far more (1 < 2 < 3 < 4 …), and a combo (clears on consecutive
 * placements) multiplies it: ×1, ×1.5, ×2, ×2.5 … A placement that clears
 * nothing ends the combo.
 */
export const ULTRA_MS = 120000;
export const linePoints = (n) => (n <= 0 ? 0 : n === 1 ? 100 : n === 2 ? 300 : n === 3 ? 500 : 800 + 400 * (n - 4));
export const comboMult = (combo) => 1 + 0.5 * Math.max(0, combo - 1);
/** An ALL CLEAR (the board left empty): a big bonus, times the combo it ends. */
export const ALL_CLEAR = 3000;

// Spawn cells on the board, [row, col]: every piece lying flat, in the
// middle of the 8×8 board (rows 3–4, around columns 3–4).
const SPAWN = {
  I: [[3, 2], [3, 3], [3, 4], [3, 5]],
  O: [[3, 3], [3, 4], [4, 3], [4, 4]],
  T: [[3, 2], [3, 3], [3, 4], [4, 3]],
  S: [[3, 3], [3, 4], [4, 2], [4, 3]],
  Z: [[3, 2], [3, 3], [4, 3], [4, 4]],
  J: [[3, 2], [4, 2], [4, 3], [4, 4]],
  L: [[3, 4], [4, 2], [4, 3], [4, 4]],
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
export const shapeOf = (id, rot = 0) => (id >= 100 ? junkShape(id, ((rot % 4) + 4) % 4) : BASE[id].shapes[((rot % 4) + 4) % 4]);

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

export function newSprint(seed, goal = GOAL) {
  const st = {
    seed, goal, rand: rng(seed), bag: [], score: 0, combo: 0,
    board: Array.from({ length: SIZE }, () => Array(SIZE).fill(null)),
    hand: [], queue: [], lines: 0, pieces: 0, over: false, won: false,
  };
  for (let i = 0; i < HAND; i++) st.hand.push(draw(st));
  for (let i = 0; i < FORECAST; i++) st.queue.push(draw(st));
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
  const s = shapeOf(id, 0);
  // Junk spawns in the middle of the board; tetrominoes where SPAWN puts them.
  const at = id >= 100 ? [Math.floor((SIZE - s.h) / 2), Math.floor((SIZE - s.w) / 2)] : BASE[id].spawn;
  return { slot, id, rot: 0, cr: at[0] + s.h / 2, cc: at[1] + s.w / 2 };
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
 * the first forecast piece; a new one from the bag joins the end.
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
  const n = rows.length + cols.length;
  st.lines += n;
  st.pieces += 1;
  st.combo = n ? st.combo + 1 : 0;
  const allClear = n > 0 && st.board.every((row) => row.every((v) => v === null));
  const points = n ? Math.round((linePoints(n) + (allClear ? ALL_CLEAR : 0)) * comboMult(st.combo)) : 0;
  st.score += points;
  st.hand[a.slot] = st.queue.shift();
  st.queue.push(draw(st));
  st.last = { cells, cleared, lines: n, id: a.id, points, combo: n ? st.combo : 0, allClear };
  if (st.lines >= st.goal) { st.over = true; st.won = true; }
  else if (!anyFits(st)) st.over = true;
  return st;
}

/* ============================================================
   BLITZ 1v1: junk pieces
   ============================================================ */

/**
 * A junk piece grows with the attack's level, like a tumour, from the middle out:
 *   1 one square · 2 two diagonal · 3 a small L · 4 a 2×2
 *   5–8   a diagonal spike at each corner, one at a time, counter-clockwise
 *         (top-left, bottom-left, bottom-right, top-right): 5 is the kite
 *   9–12  the gaps between the spikes filled, one side at a time → 4×4
 *   then the same again around that: spikes 13–16, sides 17–20 → 6×6,
 *   spikes 21–24, sides 25–28 → 8×8 (the most it can grow).
 * Junk ids are JUNK + level, so a board square remembers what it was.
 */
export const JUNK = 100;
export const JUNK_MAX = 28;
export const isJunk = (id) => id >= JUNK;
export const junkLevel = (id) => id - JUNK;
export function junkCells(level) {
  const L = Math.max(1, Math.min(JUNK_MAX, level));
  const cells = [[3, 3]];
  if (L >= 2) cells.push([4, 4]);
  if (L >= 3) cells.push([4, 3]);
  if (L >= 4) cells.push([3, 4]);
  let lv = 4;
  for (let r = 1; r <= 3 && lv < L; r++) {
    const lo = 3 - r, hi = 4 + r;
    for (const c of [[lo, lo], [hi, lo], [hi, hi], [lo, hi]]) { if (lv >= L) break; cells.push(c); lv++; }
    const sides = [
      Array.from({ length: hi - lo - 1 }, (_, i) => [lo + 1 + i, lo]),
      Array.from({ length: hi - lo - 1 }, (_, i) => [hi, lo + 1 + i]),
      Array.from({ length: hi - lo - 1 }, (_, i) => [lo + 1 + i, hi]),
      Array.from({ length: hi - lo - 1 }, (_, i) => [lo, lo + 1 + i]),
    ];
    for (const side of sides) { if (lv >= L) break; cells.push(...side); lv++; }
  }
  const r0 = Math.min(...cells.map((c) => c[0])), c0 = Math.min(...cells.map((c) => c[1]));
  return cells.map(([r, c]) => [r - r0, c - c0]);
}
const junkShapes = new Map();
function junkShape(id, rot) {
  const k = `${id}:${rot}`;
  if (!junkShapes.has(k)) {
    let cells = junkCells(junkLevel(id));
    let h = Math.max(...cells.map((c) => c[0])) + 1, w = Math.max(...cells.map((c) => c[1])) + 1;
    for (let i = 0; i < rot; i++) { cells = cells.map(([r, c]) => [c, h - 1 - r]); [h, w] = [w, h]; }
    junkShapes.set(k, { cells, h, w });
  }
  return junkShapes.get(k);
}

/**
 * A spike: clears that come within SPIKE_MS of the one before (pieces that
 * clear nothing in between don't break it). Each clear adds its lines to the
 * level. When the spike ends, one junk piece of that level goes to the
 * opponent, into their forecast right after the five they can see.
 * Levels add up linearly: a 4-line clear is 4, another 4 in the same
 * spike makes 8. An ALL CLEAR (the board left empty) counts as 10 on its
 * own, or adds 10 to the spike it ends. Single lines send single squares
 * ("cheese"): legal, but weak, and they can help the opponent.
 */
export const SPIKE_MS = 500;
export const ALL_CLEAR_LEVELS = 10;
export function noteClear(st, lines, now, allClear = false) {
  if (!lines) return;
  const add = allClear ? ALL_CLEAR_LEVELS : lines;
  st.spike = st.spike && now - st.lastClearAt <= SPIKE_MS ? st.spike + add : add;
  st.lastClearAt = now;
}
/** The junk level to send now (and resets the spike), or 0. */
export function spikeDue(st, now) {
  if (!st.spike || now - st.lastClearAt <= SPIKE_MS) return 0;
  const level = Math.min(JUNK_MAX, st.spike);
  st.spike = 0;
  return level;
}
/** A junk piece arriving: into the forecast, just after the five on show. */
export function receiveJunk(st, level) {
  st.queue.splice(Math.min(FORECAST, st.queue.length), 0, JUNK + level);
}
