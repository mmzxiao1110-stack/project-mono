/**
 * Tesella — computer opponent.
 *
 * Shared so the client (single-player) and test tools use the same player.
 * One-move lookahead with a weighted score; `level` (1…max) raises the
 * weight on strategy and lowers the randomness.
 *
 * What it weighs for each placement of its one piece:
 *   gain      squares claimed (centre squares count extra)
 *   frontier  empty squares it can build from afterwards
 *   deny      empty squares it takes away from the opponent
 *   lines     line clears: finishing a line that's mostly the opponent's
 *             is good; leaving a line nearly full and mostly its own is a
 *             risk the opponent can cash in
 */
import { ROWS, COLS, key, enumerateMoves, isCentre, fullLines, resolveTurn, nextMeters, isLegalDelete, isLegalPin, stampOptions } from "./engine.js";
// (aiPickActionDeep also looks one piece ahead: the caller passes the next piece.)
import { RULES } from "./rules.js";

function frontierSize(board, owner) {
  const s = new Set();
  for (let r = 0; r < ROWS; r++)
    for (let c = 0; c < COLS; c++) {
      if (board[r][c] !== owner) continue;
      for (let dr = -1; dr <= 1; dr++)
        for (let dc = -1; dc <= 1; dc++) {
          const nr = r + dr, nc = c + dc;
          if (nr < 0 || nc < 0 || nr >= ROWS || nc >= COLS) continue;
          if (board[nr][nc] === null) s.add(key(nr, nc));
        }
    }
  return s.size;
}

/** Net squares this player gains (+) or loses (−) from lines that would clear. */
function lineSwing(board, owner) {
  const { rows, cols } = fullLines(board);
  if (!rows.length && !cols.length) return 0;
  const hit = new Set();
  for (const r of rows) for (let c = 0; c < COLS; c++) hit.add(key(r, c));
  for (const c of cols) for (let r = 0; r < ROWS; r++) hit.add(key(r, c));
  let mine = 0, theirs = 0;
  for (const k of hit) {
    const v = board[Math.floor(k / COLS)][k % COLS];
    if (v === owner) mine++; else if (v) theirs++;
  }
  return theirs - mine;
}

/** How exposed this player is: own squares sitting in lines 1–2 squares from full. */
function lineRisk(board, owner) {
  let risk = 0;
  const scan = (cells) => {
    let empty = 0, mine = 0;
    for (const v of cells) { if (v === null) empty++; else if (v === owner) mine++; }
    if (empty >= 1 && empty <= 2) risk += mine * (empty === 1 ? 1 : 0.4);
  };
  for (let r = 0; r < ROWS; r++) scan(board[r]);
  for (let c = 0; c < COLS; c++) scan(board.map((row) => row[c]));
  return risk;
}

export const weightsFor = (level, levels) => {
  const t = levels > 1 ? (level - 1) / (levels - 1) : 1;
  return { front: 0.3 * t, deny: 0.9 * t * t, lines: 1.2 * t, risk: 0.25 * t, noise: 8 * (1 - t) + 0.1 };
};

/** Picks a placement for `piece`, or null to pass. */
export function aiPickMove(board, piece, owner, level, levels) {
  const moves = enumerateMoves(board, [piece], owner);
  if (!moves.length) return null;
  const w = weightsFor(level, levels);
  const opp = owner === "A" ? "B" : "A";
  const oppBefore = frontierSize(board, opp);
  let best = null, bestScore = -Infinity;
  for (const m of moves) {
    const nb = board.map((row) => [...row]);
    let gain = 0;
    for (const [r, c] of m.cells) { nb[r][c] = owner; gain += isCentre(r, c) ? RULES.centreValue : 1; }
    const s =
      gain +
      (w.front ? w.front * frontierSize(nb, owner) : 0) +
      (w.deny ? w.deny * (oppBefore - frontierSize(nb, opp)) : 0) +
      (w.lines ? w.lines * lineSwing(nb, owner) : 0) -
      (w.risk ? w.risk * lineRisk(nb, owner) : 0) +
      Math.random() * w.noise;
    if (s > bestScore) { bestScore = s; best = m; }
  }
  return best;
}

/* ------------------------------------------------------------------
   Three actions: place, delete, and (free) pins.
   Weights found by self-play tuning (see the simulation notes in
   rules.js). The level scales the weights and the noise like above.
   ------------------------------------------------------------------ */

const TUNED = { front: 0.2, risk: 0.19, meter: 0.25, pin: 0.42, charge: 1.0 };
const N8 = [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]];
const N4 = [[-1, 0], [1, 0], [0, -1], [0, 1]];
const val = (r, c) => (isCentre(r, c) ? RULES.centreValue : 1);
const other = (o) => (o === "A" ? "B" : "A");

/** Own squares exposed to a line clear (in rows/columns with 1–2 gaps), unpinned. */
function exposure(b, pins, o) {
  let e = 0;
  const scan = (cells) => {
    let empty = 0;
    for (const [r, c] of cells) if (b[r][c] === null) empty++;
    if (empty < 1 || empty > 2) return;
    for (const [r, c] of cells) if (b[r][c] === o && !pins[r][c]) e += empty === 1 ? 1 : 0.4;
  };
  for (let r = 0; r < ROWS; r++) scan(Array.from({ length: COLS }, (_, c) => [r, c]));
  for (let c = 0; c < COLS; c++) scan(Array.from({ length: ROWS }, (_, r) => [r, c]));
  return e;
}

/** How much a square of yours is worth protecting: the centre, and squares the enemy touches. */
function threat(b, r, c, o) {
  let t = isCentre(r, c) ? 2 : 0;
  for (const [dr, dc] of N8) { const v = b[r + dr]?.[c + dc]; if (v && v !== o && v !== "X") t += 0.5; }
  return t;
}

function evalState(b, pins, meters, o, w) {
  let me = 0, them = 0, pinMe = 0;
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
    const v = b[r][c]; if (!v || v === "X") continue; // empty or dead (overtime)
    if (v === o) {
      me += val(r, c);
      // With the pin toggle, a pin is worth what it protects; a charge is worth a whole piece's pins.
      if (pins[r][c]) pinMe += RULES.pinToggle ? threat(b, r, c, o) : 1;
    } else them += val(r, c);
  }
  return (me - them) + w.front * (frontierSize(b, o) - frontierSize(b, other(o)))
    - w.risk * (exposure(b, pins, o) - exposure(b, pins, other(o)))
    + (RULES.pinToggle ? w.charge : w.meter) * (meters[o] - meters[other(o)]) + w.pin * pinMe;
}

/** Connected sets of 1..max squares where ok(r, c). */
export function shapesWhere(ok, max) {
  const out = [], seen = new Set();
  const dirs = RULES.connectDiagonal ? N8 : N4;
  const grow = (set) => {
    const sig = set.map(([r, c]) => r * COLS + c).sort((a, b) => a - b).join(",");
    if (seen.has(sig)) return; seen.add(sig); out.push(set);
    if (set.length >= max) return;
    for (const [r, c] of set) for (const [dr, dc] of dirs) {
      const nr = r + dr, nc = c + dc;
      if (nr < 0 || nc < 0 || nr >= ROWS || nc >= COLS || !ok(nr, nc) || set.some(([a, b2]) => a === nr && b2 === nc)) continue;
      grow([...set, [nr, nc]]);
    }
  };
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) if (ok(r, c)) grow([[r, c]]);
  return out;
}

/** Pins for this turn: the most threatened of your squares (the centre, then those touching the enemy). */
function pickPins(st, o, move, piece) {
  const { board: b, pins } = st;
  let held = 0;
  if (Number.isFinite(RULES.pinHoldMax)) for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) if (pins[r][c] && b[r][c] === o) held++;
  const n = Math.min(st.meters[o], RULES.pinMax, Number.isFinite(RULES.pinHoldMax) ? RULES.pinHoldMax - held : Infinity);
  if (n <= 0) return null;
  const thr = (r, c) => (isCentre(r, c) ? 3 : 0) + N8.filter(([dr, dc]) => { const v = b[r + dr]?.[c + dc]; return v && v !== o; }).length * 0.5 + Math.random() * 0.1;
  const banned = new Set(move && move.type === "delete" ? move.cells.map(([r, c]) => key(r, c)) : []);
  const mine = (r, c) => b[r][c] === o && !pins[r][c] && !banned.has(key(r, c));
  if (RULES.stamp) {
    // A pin stamp: the piece's shape over your own squares; returns the footprint.
    const opts = stampOptions(b, pins, piece, "pin", o)
      .map((x) => ({ ...x, hits: x.hits.filter(([r, c]) => !banned.has(key(r, c))) }))
      .filter((x) => x.hits.length && x.hits.length <= n);
    if (!opts.length) return null;
    const score = (x) => x.hits.reduce((s, [r, c]) => s + thr(r, c), 0);
    return opts.reduce((x, y) => (score(y) > score(x) ? y : x)).cells;
  }
  if (!RULES.pinConnected) {
    const all = [];
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) if (mine(r, c)) all.push([thr(r, c), [r, c]]);
    all.sort((x, y) => y[0] - x[0]);
    return all.length ? all.slice(0, n).map((x) => x[1]) : null;
  }
  const opts = shapesWhere(mine, Math.min(n, 4));
  if (!opts.length) return null;
  const score = (cells) => cells.reduce((s, [r, c]) => s + thr(r, c), 0);
  return opts.reduce((x, y) => (score(y) > score(x) ? y : x));
}

/**
 * Picks this turn's action: { type: "place" | "delete", cells, blockId?, pins? },
 * or null to pass. `st` is { board, pins, meters }. With stamps, a delete's
 * cells are what it hits and `pins` is a footprint: run it through
 * normalizeAction before resolving.
 */
export function aiPickAction(st, piece, owner, level, levels) {
  if (!RULES.actions) {
    const m = aiPickMove(st.board, piece, owner, level, levels);
    return m ? { type: "place", cells: m.cells, blockId: m.blockId } : null;
  }
  const t = levels > 1 ? (level - 1) / (levels - 1) : 1;
  const w = { front: TUNED.front * t, risk: TUNED.risk * t, meter: TUNED.meter * t, pin: TUNED.pin * t, charge: TUNED.charge * t };
  const noise = 8 * (1 - t) + 0.05;
  const { board: b, pins, meters } = st;
  const list = enumerateMoves(b, [piece], owner).map((m) => ({ type: "place", cells: m.cells, blockId: m.blockId }));
  // With a charge, each placement can also go down pinned.
  if (RULES.pinToggle && meters[owner] >= 1) for (const m of list.slice()) list.push({ ...m, pin: true });
  // Deletes: drawn shapes, or stamps of the current piece (kept as what they hit).
  const dels = RULES.stamp
    ? stampOptions(b, pins, piece, "delete", owner)
    : shapesWhere((r, c) => b[r][c] !== null && !pins[r][c], RULES.deleteMax).map((cells) => ({ cells, hits: cells }));
  const q = (x) => x.hits.reduce((s, [r, c]) => s + (b[r][c] === owner ? -val(r, c) : val(r, c)), 0);
  dels.sort((x, y) => q(y) - q(x));
  // Evaluated on what it hits; handed back as the footprint (see normalizeAction).
  for (const d of dels.slice(0, 12)) list.push({ type: "delete", cells: d.hits, foot: d.cells });
  if (!list.length) return null;
  let best = null, bs = -Infinity;
  for (const m of list) {
    const res = resolveTurn(b, owner === "A" ? m : null, owner === "B" ? m : null, pins);
    const nm = nextMeters(meters, owner === "A" ? m : null, owner === "B" ? m : null, res.deleted);
    const s = evalState(res.board, res.pins, nm, owner, w) + Math.random() * noise;
    if (s > bs) { bs = s; best = m; }
  }
  // Weaker players forget to pin. (Pins only ride along when pinning is free.)
  if (best && RULES.pinIsFree && !RULES.pinToggle && Math.random() < 0.3 + 0.7 * t) {
    const p = pickPins(st, owner, best, piece);
    if (p && (RULES.stamp || isLegalPin(b, pins, p, owner, meters[owner]))) best = { ...best, pins: p };
  }
  if (best && best.type === "delete" && !RULES.stamp && !isLegalDelete(b, pins, best.cells)) return null;
  if (best && best.foot) { const { foot, ...rest } = best; best = RULES.stamp ? { ...rest, cells: foot } : rest; }
  return best;
}

/**
 * The strongest player: it plays the turn as what it is — simultaneous.
 * It shortlists its own best actions, predicts the opponent's likeliest
 * replies (with the piece they really hold), and scores each of its actions
 * by how it fares across those replies after the real turn resolution
 * (contested squares, deletes, clears): mostly the average, partly the worst.
 */
export function aiPickActionDeep(st, piece, owner, oppPiece, { mine = 10, theirs = 8, caution = 0.35, w: wIn, next = null, ahead = 0.5 } = {}) {
  const w = wIn || { ...TUNED };
  const opp = other(owner);
  const { board: b, pins, meters } = st;
  const candidates = (side, pc) => {
    const list = enumerateMoves(b, [pc], side).map((m) => ({ type: "place", cells: m.cells, blockId: m.blockId }));
    if (RULES.pinToggle && meters[side] >= 1) for (const m of list.slice()) list.push({ ...m, pin: true });
    const dels = RULES.stamp
      ? stampOptions(b, pins, pc, "delete", side)
      : shapesWhere((r, c) => b[r][c] !== null && !pins[r][c], RULES.deleteMax).map((cells) => ({ cells, hits: cells }));
    const q = (x) => x.hits.reduce((s, [r, c]) => s + (b[r][c] === side ? -val(r, c) : val(r, c)), 0);
    dels.sort((x, y) => q(y) - q(x));
    for (const d of dels.slice(0, 10)) list.push({ type: "delete", cells: d.hits, foot: d.cells });
    // 1-ply: as if the other side passed.
    for (const m of list) {
      const res = resolveTurn(b, side === "A" ? m : null, side === "B" ? m : null, pins);
      const nm = nextMeters(meters, side === "A" ? m : null, side === "B" ? m : null, res.deleted);
      m.v1 = evalState(res.board, res.pins, nm, side, w);
    }
    return list.sort((x, y) => y.v1 - x.v1);
  };
  const my = candidates(owner, piece).slice(0, mine);
  if (!my.length) return null;
  const their = oppPiece != null ? candidates(opp, oppPiece).slice(0, theirs) : [];
  if (!their.length) their.push(null);
  let best = null, bs = -Infinity;
  for (const m of my) {
    let sum = 0, worst = Infinity;
    for (const o of their) {
      const A = owner === "A" ? m : o, B = owner === "B" ? m : o;
      const res = resolveTurn(b, A, B, pins);
      const nm = nextMeters(meters, A, B, res.deleted);
      let v = evalState(res.board, res.pins, nm, owner, w);
      // One piece further: the best this leaves for your next piece.
      if (next != null && ahead > 0) {
        let bn = -Infinity;
        for (const n of enumerateMoves(res.board, [next], owner)) {
          const r2 = resolveTurn(res.board, owner === "A" ? n : null, owner === "B" ? n : null, res.pins);
          const e = evalState(r2.board, r2.pins, nm, owner, w);
          if (e > bn) bn = e;
        }
        if (bn > -Infinity) v = (1 - ahead) * v + ahead * bn;
      }
      sum += v; if (v < worst) worst = v;
    }
    const s = (1 - caution) * (sum / their.length) + caution * worst;
    if (s > bs) { bs = s; best = m; }
  }
  if (best && RULES.pinIsFree && !RULES.pinToggle) {
    const p = pickPins(st, owner, best, piece);
    if (p && (RULES.stamp || isLegalPin(b, pins, p, owner, meters[owner]))) best = { ...best, pins: p };
  }
  if (best && best.type === "delete" && !RULES.stamp && !isLegalDelete(b, pins, best.cells)) return null;
  if (best && best.foot) { const { foot, ...rest } = best; best = RULES.stamp ? { ...rest, cells: foot } : rest; }
  // (scores used for ranking only)
  if (best) { delete best.v1; }
  return best;
}
