/**
 * MARATHON — a solo block puzzle for high scores.
 *
 *   A 7×7 board, empty to start. You hold three pieces; place any of them
 *   anywhere it fits (no rotating). Only the slot you used is refilled, from
 *   a shuffled bag, like the 1v1 queue. Fill a row or a column and it clears.
 *   The game ends when none of your three pieces fits anywhere.
 *
 * Scoring:
 *   placing       1 point per square placed
 *   clearing      10 points per square cleared, × the lines cleared at once,
 *                 × your combo (1 + the clears in your current streak)
 *   streak        a clear continues the streak; three moves in a row without
 *                 a clear end it
 *
 * Every LEVEL_LINES lines the level goes up, and each new bag carries more
 * of the big, awkward pieces — so the board always closes in eventually.
 *
 * Deterministic from the seed: the server replays a game's moves to check
 * its score (see server/index.js), and the client plays the same code.
 */

export const SIZE = 7;
export const HAND = 3;
/**
 * The difficulty ramp, chosen by simulation (a bot that looks two moves
 * ahead, 120 games each, capped at 20,000 moves):
 *   no ramp            median 1077 moves, longest 9528: near-endless for strong play
 *   +2/level, max 12   median  227, longest 1101
 *   +2/level, max 40   median  209, longest  440   ← this: typical games the
 *                      same, but no endless runs. Past level 20 most of every
 *                      bag is big pieces, and the board always closes in.
 */
export const TUNING = {
  levelLines: 10,     // lines per level
  extraPerLevel: 2,   // extra hard pieces per bag, per level after the first
  maxExtra: 40,       // most extra hard pieces per bag
  grace: 3,           // moves without a clear before the streak ends
};
export const LEVEL_LINES = TUNING.levelLines;

/* ---------- pieces (each orientation is its own piece: no rotating) ---------- */

const P = (name, rows, hard = false) => {
  const cells = [];
  rows.forEach((row, r) => [...row].forEach((ch, c) => { if (ch === "#") cells.push([r, c]); }));
  return { name, cells, hard, h: rows.length, w: Math.max(...rows.map((x) => x.length)) };
};
export const PIECES = [
  P("dot", ["#"]),
  P("i2h", ["##"]), P("i2v", ["#", "#"]),
  P("i3h", ["###"]), P("i3v", ["#", "#", "#"]),
  P("i4h", ["####"]), P("i4v", ["#", "#", "#", "#"]),
  P("i5h", ["#####"], true), P("i5v", ["#", "#", "#", "#", "#"], true),
  P("o2", ["##", "##"]),
  P("o3", ["###", "###", "###"], true),
  P("r23", ["###", "###"], true), P("r32", ["##", "##", "##"], true),
  P("c3a", ["##", "#."]), P("c3b", ["##", ".#"]), P("c3c", ["#.", "##"]), P("c3d", [".#", "##"]),
  P("ta", ["###", ".#."]), P("tb", [".#.", "###"]), P("tc", ["#.", "##", "#."]), P("td", [".#", "##", ".#"]),
  P("sh", [".##", "##."]), P("zh", ["##.", ".##"]), P("sv", ["#.", "##", ".#"]), P("zv", [".#", "##", "#."]),
  P("la", ["#.", "#.", "##"]), P("lb", ["###", "#.."]), P("lc", ["##", ".#", ".#"]), P("ld", ["..#", "###"]),
  P("ja", [".#", ".#", "##"]), P("jb", ["#..", "###"]), P("jc", ["##", "#.", "#."]), P("jd", ["###", "..#"]),
  P("big1", ["###", "#..", "#.."], true), P("big2", ["###", "..#", "..#"], true),
  P("big3", ["#..", "#..", "###"], true), P("big4", ["..#", "..#", "###"], true),
];
const HARD = PIECES.map((p, i) => (p.hard ? i : -1)).filter((i) => i >= 0);

/* ---------- seeded randomness ---------- */

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

export const newMarathonSeed = () => (Math.random() * 2 ** 31) >>> 0;
export const levelOf = (lines) => 1 + Math.floor(lines / TUNING.levelLines);

/** A fresh bag for this level: every piece once, plus extra hard ones, shuffled. */
function fillBag(st) {
  const extra = Math.min(TUNING.maxExtra, TUNING.extraPerLevel * (levelOf(st.lines) - 1));
  const bag = PIECES.map((_, i) => i);
  for (let k = 0; k < extra; k++) bag.push(HARD[Math.floor(st.rand() * HARD.length)]);
  for (let i = bag.length - 1; i > 0; i--) { const j = Math.floor(st.rand() * (i + 1)); [bag[i], bag[j]] = [bag[j], bag[i]]; }
  st.bag = bag;
}
function draw(st) {
  if (!st.bag.length) fillBag(st);
  return st.bag.pop();
}

/* ---------- the game ---------- */

export function newMarathon(seed) {
  const st = {
    seed, rand: rng(seed), bag: [],
    board: Array.from({ length: SIZE }, () => Array(SIZE).fill(null)),
    hand: [], score: 0, lines: 0, moves: 0, combo: 0, sinceClear: 0, over: false,
  };
  for (let i = 0; i < HAND; i++) st.hand.push(draw(st));
  st.over = !anyFits(st);
  return st;
}

export function fits(board, piece, r, c) {
  const p = PIECES[piece];
  if (r < 0 || c < 0 || r + p.h > SIZE || c + p.w > SIZE) return false;
  return p.cells.every(([dr, dc]) => board[r + dr][c + dc] === null);
}

export function fitsAnywhere(board, piece) {
  const p = PIECES[piece];
  for (let r = 0; r + p.h <= SIZE; r++) for (let c = 0; c + p.w <= SIZE; c++) if (fits(board, piece, r, c)) return true;
  return false;
}

export const anyFits = (st) => st.hand.some((id) => id !== null && fitsAnywhere(st.board, id));

/**
 * Places hand slot `slot` with its top-left at (r, c). Mutates and returns
 * `st`, with `st.last` describing the move ({ cells, cleared, rows, cols,
 * points, combo }), or returns null if the move isn't legal.
 */
export function placePiece(st, slot, r, c, colour = null) {
  if (st.over || !Number.isInteger(slot) || slot < 0 || slot >= HAND) return null;
  const id = st.hand[slot];
  if (id === null || id === undefined || !Number.isInteger(r) || !Number.isInteger(c) || !fits(st.board, id, r, c)) return null;
  const p = PIECES[id];
  const cells = p.cells.map(([dr, dc]) => [r + dr, c + dc]);
  for (const [a, b] of cells) st.board[a][b] = colour ?? id;

  const rows = [], cols = [];
  for (let i = 0; i < SIZE; i++) {
    if (st.board[i].every((v) => v !== null)) rows.push(i);
    if (st.board.every((row) => row[i] !== null)) cols.push(i);
  }
  const cleared = [];
  const seen = new Set();
  const wipe = (a, b) => { const k = a * SIZE + b; if (seen.has(k)) return; seen.add(k); cleared.push([a, b, st.board[a][b]]); };
  for (const i of rows) for (let j = 0; j < SIZE; j++) wipe(i, j);
  for (const j of cols) for (let i = 0; i < SIZE; i++) wipe(i, j);
  for (const [a, b] of cleared) st.board[a][b] = null;

  const lines = rows.length + cols.length;
  let points = cells.length;
  if (lines) {
    st.combo += 1;
    st.sinceClear = 0;
    points += 10 * cleared.length * lines * st.combo;
  } else if (++st.sinceClear >= TUNING.grace) st.combo = 0;
  st.score += points;
  st.lines += lines;
  st.moves += 1;
  st.hand[slot] = draw(st);
  st.over = !anyFits(st);
  st.last = { slot, piece: id, cells, cleared, rows, cols, points, combo: lines ? st.combo : 0 };
  return st;
}

/** Moves as text for the wire: two base-36 characters each (slot·49 + row·7 + column). */
export const encodeMoves = (moves) => moves.map(([s, r, c]) => (s * 49 + r * 7 + c).toString(36).padStart(2, "0")).join("");
export function decodeMoves(text) {
  if (typeof text !== "string" || text.length % 2 || !/^[0-9a-z]*$/.test(text)) return null;
  const out = [];
  for (let i = 0; i < text.length; i += 2) {
    const n = parseInt(text.slice(i, i + 2), 36);
    if (!(n >= 0 && n < HAND * 49)) return null;
    out.push([Math.floor(n / 49), Math.floor((n % 49) / 7), n % 7]);
  }
  return out;
}

/**
 * Replays a whole game from its seed and moves ([slot, r, c] each). Returns
 * { score, lines, moves, over } or { error } at the first illegal move.
 * The server uses this to check a submitted score.
 */
export function replayMarathon(seed, moves) {
  if (!Number.isInteger(seed) || seed < 0 || !Array.isArray(moves) || moves.length > 100000) return { error: "bad game" };
  const st = newMarathon(seed);
  for (let i = 0; i < moves.length; i++) {
    const m = moves[i];
    if (!Array.isArray(m) || m.length !== 3 || !placePiece(st, m[0], m[1], m[2])) return { error: `illegal move ${i + 1}` };
  }
  return { score: st.score, lines: st.lines, moves: st.moves, over: st.over };
}
