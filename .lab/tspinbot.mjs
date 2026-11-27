// A TOWER bot that clears lines only with T-spin doubles and T-spin triples.
//
// The shapes it builds are the ones the classic setups (TKI, DT Cannon, STSD, Imperial Cross, C-spin...)
// are made of: a T-spin double slot (a 3-wide gap with an overhang on one side, over a 1-wide hole)
// and a T-spin triple slot (a 1-wide well capped by an overhang, the T kicked in sideways). Rather than
// memorising openers that only work for one piece order, it searches:
//   - every spot a piece can reach with the game's own moves (slide, turn with kicks, soft drop, and
//     slides and turns on the floor: the tucks and spins), found by a breadth-first search from spawn;
//   - a beam over the known piece order (with hold) that never takes a line clear unless it's a full
//     T-spin double or triple, scores those big, and rewards boards with a T-spin slot ready.
//
//   import { planTSpins } from "./tspinbot.mjs"; node .lab/tspinbot.mjs [seed]
import * as Z from "../shared/zerog.js";
import { pieceOrder } from "./pcsolver.mjs";

const { W, H, TOP } = Z;
const T = 2;
const KEYS = { l: "ArrowLeft", r: "ArrowRight", c: "ArrowUp", w: "z", f: "a", d: "ArrowDown" };

/** Every resting spot `id` can reach from spawn on `board`, with the keys to get there and whether the last move was a turn (and its kick). */
export function reachable(board, id) {
  const box = Z.boxOf(id);
  const start = { id, rot: 0, x: box === 2 ? 4 : 3, y: TOP - 3 };
  if (!Z.fits(board, start)) return [];
  const seen = new Map(), out = new Map(), q = [{ p: start, keys: [], rot: false, kick: 0 }];
  const keyOf = (n) => `${n.p.x},${n.p.y},${n.p.rot},${n.rot ? 1 : 0},${n.kick === 4 ? 1 : 0}`;
  seen.set(keyOf(q[0]), true);
  while (q.length) {
    const n = q.shift();
    if (n.keys.length > 14) continue;
    const resting = !Z.fits(board, { ...n.p, y: n.p.y + 1 });
    if (resting) {
      const k = `${n.p.x},${n.p.y},${n.p.rot},${n.rot ? 1 : 0}`;
      if (!out.has(k) || out.get(k).keys.length > n.keys.length) out.set(k, n);
    }
    const next = [];
    for (const [code, dx] of [["l", -1], ["r", 1]]) { const p = { ...n.p, x: n.p.x + dx }; if (Z.fits(board, p)) next.push({ p, code, rot: false, kick: 0 }); }
    { let p = n.p; while (Z.fits(board, { ...p, y: p.y + 1 })) p = { ...p, y: p.y + 1 }; if (p.y !== n.p.y) next.push({ p, code: "d", rot: false, kick: 0 }); }
    for (const [code, dir] of [["c", 1], ["w", -1], ["f", 2]]) {
      const st = { board, cur: { ...n.p } };
      if (Z.rotateOn ? Z.rotateOn(st, dir) : rotate(st, dir)) next.push({ p: st.cur, code, rot: true, kick: st.lastKick });
    }
    for (const m of next) {
      const node = { p: m.p, keys: [...n.keys, m.code], rot: m.rot, kick: m.kick };
      const k = keyOf(node);
      if (seen.has(k)) continue;
      seen.set(k, true); q.push(node);
    }
  }
  return [...out.values()];
}
// The engine's turn, on a small state (board + piece): kicks and all.
function rotate(st, dir) {
  const s = { ...st, lastRot: false, lastKick: 0 };
  const ok = Z.rotate(s, dir);
  st.cur = s.cur; st.lastKick = s.lastKick;
  return ok;
}

/** Locks `node` on a copy of the planning state; returns the new state and what the lock did, or null. */
function lockOn(state, node, seq) {
  const st = {
    board: state.board.map((r) => r.slice()), cur: { ...node.p }, lastRot: node.rot, lastKick: node.kick,
    queue: seq.slice(state.i, state.i + 8), rand: Math.random, hold: state.hold, held: false,
    lines: state.lines, pieces: 0, combo: state.combo, b2b: state.b2b, goal: Infinity, over: false, won: false,
    stats: { single: 0, double: 0, triple: 0, quad: 0, tspin: 0, allClear: 0, maxCombo: 0 },
  };
  const L = Z.hardDrop(st);
  if (!L) return null;
  return { st, L };
}

/**
 * How far along the best T-spin double slot on the board is. The slot, T pointing down into it:
 *   row r-1:  an overhang (the roof) over one side of the 3-wide gap, the other side open to come in
 *   row r:    full except the 3-wide gap x-1..x+1
 *   row r+1:  full except the 1-wide hole at x
 * The more of those two rows are filled (and the roof there), the higher the score.
 */
function slotScore(board) {
  let best = 0;
  const filled = (x, y) => x < 0 || x >= W || y >= H || (y >= 0 && board[y][x] !== null);
  for (let r = TOP + 1; r < H - 1; r++) {
    for (let x = 1; x < W - 1; x++) {
      if (filled(x - 1, r) || filled(x, r) || filled(x + 1, r) || filled(x, r + 1)) continue;
      let fb = 0, ft = 0;
      for (let c = 0; c < W; c++) { if (c !== x && filled(c, r + 1)) fb++; if ((c < x - 1 || c > x + 1) && filled(c, r)) ft++; }
      if (fb < 4) continue;
      for (const side of [-1, 1]) {
        const roof = filled(x + side, r - 1), open = !filled(x - side, r - 1) && !filled(x, r - 1);
        if (!open) continue;
        const s = 40 * (fb / 9) ** 3 + 40 * (ft / 7) ** 3 + (roof ? 18 : 0);
        if (s > best) best = s;
      }
    }
  }
  return best;
}

// The board, scored: low and smooth, few covered holes, and a T-spin slot ready.
function evalBoard(board, nextHasT) {
  const hts = [];
  let holes = 0;
  for (let x = 0; x < W; x++) {
    let h = 0, seen = false;
    for (let y = 0; y < H; y++) { const f = board[y][x] !== null; if (f && !seen) { seen = true; h = H - y; } else if (!f && seen) holes++; }
    hts.push(h);
  }
  let bump = 0;
  for (let x = 0; x < W - 1; x++) bump += Math.abs(hts[x] - hts[x + 1]);
  const maxH = Math.max(...hts);
  let score = -2.5 * holes - 0.6 * bump - 0.4 * hts.reduce((a, b) => a + b, 0) / W - (maxH > 12 ? 8 * (maxH - 12) : 0) + slotScore(board);
  // A T-spin slot, ready now: try the T on this board.
  if (nextHasT) {
    let best = 0;
    for (const n of reachable(board, T)) {
      if (!n.rot) continue;
      const r = lockOn({ board, i: 0, hold: null, lines: 0, combo: -1, b2b: -1 }, n, [T, T, T, T, T, T, T, T]);
      if (r && r.L.spin === "full" && r.L.lines >= 2) best = Math.max(best, r.L.lines === 3 ? 30 : 20);
    }
    score += best;
  }
  return score;
}

/**
 * Plans a whole run: `seq` is the piece order (from the seed), `goal` the lines. Every line clear is a
 * full T-spin double or triple. Returns the placements ({ hold, keys, id, x, y, rot }) or the best partial.
 */
export function planTSpins(seq, { goal = 40, beam = 24, maxPieces = 260, log = false, spike = false, high = 11, low = 4 } = {}) {
  let states = [{ board: Array.from({ length: H }, () => Array(W).fill(null)), i: 0, hold: null, lines: 0, combo: -1, b2b: -1, score: 0, moves: [], tsd: 0, tst: 0 }];
  for (let step = 0; step < maxPieces; step++) {
    const done = states.find((s) => s.lines >= goal);
    if (done) return done;
    const kids = [], loose = [];
    for (const s of states) {
      // The stack's height: in spike mode, past `high` it digs down in one long combo (until `low`), then builds again.
      const h0 = s.board.findIndex((row) => row.some((v) => v !== null));
      const height = h0 < 0 ? 0 : H - h0;
      const digging = spike && (height >= high || (s.digging && height > low));
      const options = [{ id: seq[s.i], i: s.i + 1, hold: s.hold, held: false }];
      if (s.hold != null && s.hold !== seq[s.i]) options.push({ id: s.hold, i: s.i + 1, hold: seq[s.i], held: true });
      else if (s.hold == null) options.push({ id: seq[s.i + 1], i: s.i + 2, hold: seq[s.i], held: true });
      for (const o of options) {
        const tSoon = [o.hold, seq[o.i], seq[o.i + 1]].includes(T);
        for (const n of reachable(s.board, o.id)) {
          const r = lockOn({ ...s, i: o.i, hold: o.hold }, n, seq);
          if (!r || r.st.over) continue;
          const L = r.L;
          let gain = 0, plain = false;
          if (L.lines) {
            if (o.id === T && L.spin === "full" && L.lines >= 2) gain = (L.lines === 3 ? 260 : 160) + (L.b2b > 0 ? 40 : 0);
            else if (digging) gain = 30 * L.lines + 45 * Math.max(0, L.combo); // the spike: clears in a row, the longer the better
            else plain = true; // building: only T-spins clear lines (unless nothing else is possible)
          } else if (o.id === T && L.spin) continue; // no wasted T-spins without lines
          if (digging && !L.lines && s.combo >= 0) gain -= 60; // a break in the combo
          // Don't spend a T unless it's for a T-spin.
          if (o.id === T && !L.lines) gain -= 25;
          if (r.st.board.slice(0, TOP).some((row) => row.some((v) => v !== null))) continue; // above the field: no
          (plain ? loose : kids).push({
            board: r.st.board, i: o.i, hold: o.hold, lines: s.lines + L.lines, combo: r.st.combo, b2b: r.st.b2b, digging,
            score0: (s.score0 || 0) + Z.scoreOf(L), maxCombo: Math.max(s.maxCombo || 0, L.lines ? r.st.combo : 0),
            tsd: s.tsd + (L.lines === 2 ? 1 : 0), tst: s.tst + (L.lines === 3 ? 1 : 0),
            base: s.score + gain - (plain ? 120 : 0), tSoon,
            moves: [...s.moves, { hold: o.held, keys: n.keys, id: o.id, x: n.p.x, y: n.p.y, rot: n.p.rot, clear: L.lines ? L.name : null }],
          });
        }
      }
    }
    if (!kids.length) kids.push(...loose); // stuck on the strict rules: the least bad plain clear
    if (!kids.length) break;
    // Score the children: what they've earned plus how good the board is (the T-slot check only for the best few).
    for (const k of kids) k.score = k.base + evalBoard(k.board, false);
    kids.sort((a, b) => b.score - a.score);
    const top = kids.slice(0, beam * 3);
    for (const k of top) if (k.tSoon) k.score = k.base + evalBoard(k.board, true);
    top.sort((a, b) => b.score - a.score);
    // Keep the beam varied: one child per distinct board.
    const seenB = new Set();
    states = [];
    for (const k of top) { const key = k.board.map((r) => r.map((v) => (v === null ? 0 : 1)).join("")).join("") + k.hold; if (seenB.has(key)) continue; seenB.add(key); states.push(k); if (states.length >= beam) break; }
    if (log && step % 25 === 0) console.log(`piece ${step}: lines ${states[0].lines} (TSD ${states[0].tsd}, TST ${states[0].tst}) score ${states[0].score0} max combo ${states[0].maxCombo}`);
  }
  return states.sort((a, b) => b.lines - a.lines)[0];
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const seed = Number(process.argv[2]) || 4242;
  const t0 = Date.now();
  const best = planTSpins(pieceOrder(seed, 400), { log: true });
  console.log(`seed ${seed}: ${best.lines} lines, ${best.tsd} TSD, ${best.tst} TST, ${best.moves.length} pieces · ${((Date.now() - t0) / 1000).toFixed(1)} s`);
}
