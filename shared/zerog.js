/**
 * ZERO-G — a falling-block Sprint with no gravity.
 *
 *   A 10-wide, 40-tall board (the bottom 20 rows are the field you see; the
 *   20 above are buffer). The seven tetrominoes come from a 7-bag; you see
 *   the next five and can hold one (swap with it as often as you like).
 *   Pieces spawn above the field and stay where they are until you move
 *   them: nothing falls on its own. Soft drop takes the piece straight down
 *   without locking it (hold it to keep the piece on the floor while you
 *   slide and turn: that's how S, Z and other spins are set up); hard drop
 *   drops it and locks it. Full rows clear at once.
 *
 *   Rotation is SRS: the four states of every piece around its box, the
 *   standard wall kicks, plus a 180 turn with its own short kick list.
 *   T-spins use the three-corner rule (a mini when the front corners aren't
 *   both filled, unless the last kick was used). Every other piece spins too:
 *   turned into a spot it can't move out of (not left, right or up).
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
    st.bags = (st.bags || 0) + 1;
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
  st.cur = { id, rot: 0, x: box === 2 ? 4 : 3, y: TOP - 3 };
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

/** Swap with the held piece (any time, as often as you like). True if it held. */
export function hold(st) {
  if (!st.cur) return false;
  const id = st.cur.id;
  const next = st.hold === null ? st.queue.shift() : st.hold;
  st.hold = id;
  spawn(st, next);
  return true;
}

// A spin: the last move was a turn and the piece is stuck where it is.
// T: three of the four corners of its box are filled (walls count).
// Any other piece: it can't move left, right or up.
function spinOf(st, p) {
  if (!st.lastRot) return null;
  if (NAMES[p.id] !== "T") {
    const stuck = [[-1, 0], [1, 0], [0, -1]].every(([dx, dy]) => !fits(st.board, { ...p, x: p.x + dx, y: p.y + dy }));
    return stuck ? "full" : null;
  }
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
  const spin = spinOf(st, p);
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
  st.last = { lines: n, rows, spin, combo: st.combo, b2b: n ? st.b2b : -1, allClear, name: clearName(n, spin, NAMES[p.id]), piece: p };
  // Locked wholly above the field: topped out.
  const lockOut = cells.every(([, y]) => y < TOP);
  if (st.lines >= st.goal) { st.over = true; st.won = true; st.cur = null; }
  else if (lockOut) { st.over = true; st.cur = null; }
  else spawn(st, st.queue.shift());
  return st.last;
}

export function clearName(n, spin, piece = "T") {
  const word = ["", "SINGLE", "DOUBLE", "TRIPLE", "QUAD"][Math.min(n, 4)] || "";
  if (spin) return `${piece}-SPIN${spin === "mini" ? " MINI" : ""}${word ? ` ${word}` : ""}`;
  return word;
}

/** A copy to change without touching the original (the random source is shared: it only moves forward). */
export const clone = (st) => ({ ...st, board: st.board.map((r) => r.slice()), queue: st.queue.slice(), cur: st.cur && { ...st.cur }, stats: { ...st.stats }, incoming: (st.incoming || []).map((g) => ({ ...g })) });

/* ------------------------------------------------------------------
   ULTRA: 2 minutes, highest score.
   ------------------------------------------------------------------ */
export const ULTRA_MS = 120000;
/**
 * Points for a lock (`st.last`): lines by kind, more for spins; back-to-back
 * ×1.5, +50 per clear in a row, and an all clear adds 3500.
 */
export function scoreOf(L) {
  if (!L || (!L.lines && !L.spin)) return 0;
  const n = Math.min(L.lines, 4);
  let pts = L.spin === "full" ? [400, 800, 1200, 1600][n] : L.spin === "mini" ? [100, 200, 400, 400][n] : [0, 100, 300, 500, 800][n];
  if (L.b2b > 0 && n) pts *= 1.5;
  if (n && L.combo > 0) pts += 50 * L.combo;
  if (L.allClear) pts += 3500;
  return Math.round(pts);
}

/* ------------------------------------------------------------------
   TOWER: the ranked 1v1. Each player has a ZERO-G board (the same pieces);
   clears send garbage rows (full but for one gap) to the other side.
   ------------------------------------------------------------------ */
const COMBO_BONUS = [0, 0, 1, 1, 1, 2, 2, 3, 3, 4, 4, 4, 5];
/** Garbage rows a lock sends, before cancelling what's coming at you. */
export function attackOf(L) {
  if (!L || !L.lines) return 0;
  const n = Math.min(L.lines, 4);
  let a = L.spin === "full" ? 2 * n : L.spin === "mini" ? n - 1 : [0, 0, 1, 2, 4][n];
  if (L.b2b > 0) a += 1;
  a += COMBO_BONUS[Math.min(Math.max(0, L.combo), COMBO_BONUS.length - 1)];
  if (L.allClear) a += 10;
  return a;
}
/** Push `n` garbage rows (gap at column `hole`) in from the bottom. Anything pushed off the top tops you out. */
export function addGarbage(st, n, hole) {
  if (n <= 0) return;
  const off = st.board.slice(0, n);
  if (off.some((row) => row.some((v) => v !== null))) st.over = true;
  const row = () => Array.from({ length: W }, (_, x) => (x === hole ? null : GARBAGE));
  st.board = [...st.board.slice(n), ...Array.from({ length: n }, row)];
  // The piece in play is pushed up with the stack if it would overlap it.
  if (st.cur) {
    let p = st.cur;
    while (!fits(st.board, p) && p.y > 0) p = { ...p, y: p.y - 1 };
    if (!fits(st.board, p)) { st.over = true; st.cur = null; } else st.cur = p;
  }
}
export const GARBAGE = 7; // the colour index garbage squares use

/**
 * After a lock in TOWER: the attack cancels incoming garbage first; what's
 * left is sent. A lock that clears nothing lets up to 8 waiting rows in.
 * Only garbage the player has seen (`seen` entries of `st.incoming`) counts,
 * so the server and the player's own copy always agree.
 */
export function towerLock(st, L, seen = Infinity) {
  st.incoming ||= [];
  let atk = attackOf(L);
  const ready = () => st.incoming.findIndex((g) => g.n > 0 && g.i < seen);
  for (let k; atk > 0 && (k = ready()) >= 0;) { const g = st.incoming[k], c = Math.min(atk, g.n); g.n -= c; atk -= c; }
  if (!L.lines) {
    let cap = 8;
    for (let k; cap > 0 && (k = ready()) >= 0;) { const g = st.incoming[k], c = Math.min(cap, g.n); addGarbage(st, c, g.hole); g.n -= c; cap -= c; }
  }
  st.incoming = st.incoming.filter((g) => g.n > 0);
  return atk;
}
/** Garbage waiting for you (rows). */
export const incomingRows = (st) => (st.incoming || []).reduce((a, g) => a + g.n, 0);

/**
 * A lock as sent over the network: { holds, id, rot, x, y, spin, kick }.
 * `holds`: how many times hold was pressed for this piece (each press swaps
 * with the held piece, the first with an empty hold takes the next); `spin` and
 * `kick` say the last move was a turn and which kick it used. Applies it to
 * `st` if it's a real resting spot for that piece; returns `st.last`, or null.
 */
export function applyLock(st, m) {
  if (!st.cur || !m || ![m.id, m.rot, m.x, m.y].every(Number.isInteger) || m.rot < 0 || m.rot > 3) return null;
  const holds = Number.isInteger(m.holds) ? m.holds : m.hold ? 1 : 0;
  if (holds < 0 || holds > 50) return null;
  for (let i = 0; i < holds; i++) hold(st);
  if (!st.cur || st.cur.id !== m.id) return null;
  const p = { id: m.id, rot: m.rot, x: m.x, y: m.y };
  if (!fits(st.board, p) || fits(st.board, { ...p, y: p.y + 1 })) return null;
  st.cur = p; st.lastRot = !!m.spin; st.lastKick = Number.isInteger(m.kick) ? m.kick : 0;
  return hardDrop(st);
}

/**
 * Makes `st` (a game from `seed`) match the server's copy: the same bags
 * drawn from the random source, then its board, pieces and counters.
 */
export function syncTo(seed, fix, goal = Infinity) {
  const st = newGame(seed, goal);
  while ((st.bags || 0) < fix.bags) { const bag = [0, 1, 2, 3, 4, 5, 6]; for (let i = bag.length - 1; i > 0; i--) { const j = Math.floor(st.rand() * (i + 1)); [bag[i], bag[j]] = [bag[j], bag[i]]; } st.bags++; }
  Object.assign(st, { board: fix.board.map((r) => r.slice()), queue: fix.queue.slice(), hold: fix.hold, cur: fix.cur && { ...fix.cur },
    pieces: fix.pieces, lines: fix.lines, combo: fix.combo, b2b: fix.b2b, incoming: (fix.list || []).map((g) => ({ ...g })), over: false });
  return st;
}

/* ------------------------------------------------------------------
   Moves as sent over the network (TOWER) and kept in replays: every
   change a player makes, timed in ms from GO.
     [t, "l"] [t, "r"]   one column left / right
     [t, "d"]            soft drop: straight to the floor (no lock)
     [t, "c"] [t, "w"] [t, "f"]   turn clockwise / counter-clockwise / 180
     [t, "h"]            hold (swap with the held piece)
     [t, "H", seen]      hard drop; `seen`: garbage messages received so far
   Replaying the same moves on the same seed gives the same game, so the
   server checks every piece by playing it, and the other player (and a
   replay) sees it exactly as it was played.
   ------------------------------------------------------------------ */
export const OPS = "lrdcwfhH";
/** Applies one move to `st`. True if it changed anything (a hard drop always does); `st.last` after "H". */
export function applyOp(st, op) {
  if (!st.cur || !Array.isArray(op)) return false;
  switch (op[1]) {
    case "l": return shift(st, -1);
    case "r": return shift(st, 1);
    case "d": { let moved = false; while (down(st)) moved = true; return moved; }
    case "c": return rotate(st, 1);
    case "w": return rotate(st, -1);
    case "f": return rotate(st, 2);
    case "h": return hold(st);
    case "H": return !!hardDrop(st);
    case "P": return !!applyLock(st, op[2]); // a whole placement at once (the bot's, in a local replay)
    default: return false;
  }
}
/** A move from the network, checked: [t, code] or [t, "H", seen]. */
export function cleanOp(op) {
  if (!Array.isArray(op) || !Number.isFinite(op[0]) || typeof op[1] !== "string" || op[1].length !== 1 || !OPS.includes(op[1])) return null;
  const t = Math.max(0, Math.round(op[0]));
  return op[1] === "H" ? [t, "H", Number.isInteger(op[2]) && op[2] >= 0 ? op[2] : 0] : [t, op[1]];
}
