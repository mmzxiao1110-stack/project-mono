/**
 * A TOWER 1v1 (ranked ZERO-G), run by the server. Both players get the same
 * seed (the same pieces). Every lock is checked here against this copy of
 * each board; clears send garbage rows (full but for one gap) to the other
 * side. The match ends when a player tops out, forfeits or leaves.
 *
 * Players send their moves, not their boards: every shift, turn, hold and
 * drop, timed from GO (see the move list in shared/zerog.js). The server plays
 * them on its own copy of the game, so every piece is checked exactly as it
 * was played (where it could reach, whether a spin was a spin), and passes
 * them on to the opponent, whose screen replays them on its copy.
 *
 * To clients:
 *   towerStart       { id, you, seed, opponent: { name, rating }, countdown }
 *   towerOps         { side, ops }        the opponent's moves
 *   towerGarbage     { n, hole, i }       garbage coming at you (the i-th you've been sent)
 *   towerOppGarbage  { n, hole, i }       garbage you sent, for your copy of the opponent's game
 *   towerBoard       { side, fix, ... }   a side's whole game (on reconnect), to resync from
 *   towerEnd         { winner, you, reason, ratings?, sent, seed, log }
 *                    log: [t, side, ...move] for every move, [t, side, "G", n, hole, i] for garbage sent to side
 * From clients:
 *   towerOps         { ops }   your moves since the last message
 */
import { randomBytes } from "node:crypto";
import { newGame, newSeed, applyOp, cleanOp, towerLock, incomingRows } from "../shared/zerog.js";
import { glickoUpdate } from "../shared/glicko.js";
import { saveProfile } from "./store.js";

// From the match being found to the first piece: the intro, then 3-2-1 (as Blitz).
export const COUNTDOWN_MS = 8600;
const GRACE_MS = 15000;
const LOG_MAX = 60000;

/** A player's TOWER rates over all their games: pieces a second, attack (rows sent) a minute. */
export function towerRates(t) {
  const min = (t?.ms || 0) / 60000;
  if (!min) return { pps: null, apm: null };
  const r = (x) => Math.round(x * 100) / 100;
  return { pps: r(t.pieces / (t.ms / 1000)), apm: r(t.sent / min) };
}

export class TowerMatch {
  constructor(seats, onEnd, { rated = true } = {}) {
    this.id = "t" + randomBytes(5).toString("hex");
    this.rated = rated;
    this.seats = { A: { ...seats[0], connected: true }, B: { ...seats[1], connected: true } };
    this.seed = newSeed();
    this.st = { A: newGame(this.seed, Infinity), B: newGame(this.seed, Infinity) };
    this.st.A.incoming = []; this.st.B.incoming = [];
    this.given = { A: 0, B: 0 }; // garbage messages sent to each side so far
    this.sent = { A: 0, B: 0 };   // rows each side has sent
    this.onEnd = onEnd;
    this.over = false;
    this.grace = {};
    this.log = [];
    this.lastT = { A: 0, B: 0 };
  }
  other(side) { return side === "A" ? "B" : "A"; }
  send(side, msg) { const s = this.seats[side].socket; if (s && s.readyState === 1) s.send(JSON.stringify(msg)); }
  hello(side, resume = false) {
    const o = this.seats[this.other(side)].profile;
    this.send(side, { t: "towerStart", id: this.id, you: side, seed: this.seed, countdown: Math.max(0, this.startsAt - Date.now()), resume,
      opponent: { name: o.name, guest: !!o.guest, rating: o.tower?.rating ? Math.round(o.tower.rating.r) : null } });
  }
  start() {
    this.startsAt = Date.now() + COUNTDOWN_MS;
    this.hello("A"); this.hello("B");
  }
  board(side, fix = false) {
    const st = this.st[side], L = st.last;
    return { t: "towerBoard", side, board: st.board, incoming: incomingRows(st), pieces: st.pieces, lines: st.lines, sent: this.sent[side], fix,
      hold: st.hold, queue: st.queue.slice(0, 5), cur: st.cur,
      last: L ? { lines: L.lines, rows: L.rows, spin: L.spin, name: L.name, combo: L.combo, b2b: L.b2b, allClear: L.allClear, piece: L.piece?.id } : null,
      ...(fix ? { queue: st.queue, bags: st.bags, combo: st.combo, b2b: st.b2b, list: st.incoming } : null) };
  }
  /** A batch of moves from `side`: played here, passed on, garbage sent. */
  ops(side, msg) {
    if (this.over) return null; // moves still in flight when it ended
    if (Date.now() < this.startsAt - 150) return "Not started yet.";
    if (!Array.isArray(msg.ops) || msg.ops.length > 400) return "Bad moves.";
    const st = this.st[side], other = this.other(side), now = Date.now() - this.startsAt;
    const played = [];
    for (const raw of msg.ops) {
      const op = cleanOp(raw);
      if (!op) continue;
      // Time only moves forward, and never past now (with a little slack for clocks).
      op[0] = Math.min(Math.max(op[0], this.lastT[side]), now + 1000);
      this.lastT[side] = op[0];
      if (op[1] === "H") op[2] = Math.min(op[2], this.given[side]);
      const before = st.pieces;
      if (!applyOp(st, op)) continue;
      played.push(op);
      if (this.log.length < LOG_MAX) this.log.push([op[0], side, ...op.slice(1)]);
      if (op[1] === "H" && st.pieces > before) {
        const atk = towerLock(st, st.last, op[2]);
        if (atk > 0) {
          const g = { n: atk, hole: Math.floor(Math.random() * 10), i: this.given[other]++ };
          this.st[other].incoming.push({ ...g });
          this.sent[side] += atk;
          if (this.log.length < LOG_MAX) this.log.push([op[0], other, "G", g.n, g.hole, g.i]);
          this.send(other, { t: "towerGarbage", ...g });
          this.send(side, { t: "towerOppGarbage", ...g });
        }
        if (st.over) break;
      }
    }
    if (played.length) this.send(other, { t: "towerOps", side, ops: played });
    if (st.over) this.end(side, "stuck");
    return null;
  }
  chat(side, text) {
    const msg = { t: "chat", side, name: this.seats[side].profile.name, text, at: Date.now() };
    this.send(side, msg);
    const other = this.other(side);
    if (!this.seats[other].socket?.blocked?.has(this.seats[side].profile.playerId)) this.send(other, msg);
  }
  /** `loser` lost (topped out, forfeit, left). */
  end(loser, reason = "forfeit") {
    if (this.over) return;
    this.over = true;
    for (const k of Object.keys(this.grace)) clearTimeout(this.grace[k]);
    const winner = this.other(loser);
    let ratings = null;
    if (this.rated) {
      const ra = this.seats.A.profile.tower?.rating || { r: 1500, rd: 350, vol: 0.06 };
      const rb = this.seats.B.profile.tower?.rating || { r: 1500, rd: 350, vol: 0.06 };
      const sA = winner === "A" ? 1 : 0;
      const next = { A: glickoUpdate(ra, [{ ...rb, s: sA }]), B: glickoUpdate(rb, [{ ...ra, s: 1 - sA }]) };
      ratings = {};
      for (const side of ["A", "B"]) {
        const p = this.seats[side].profile;
        const t = p.tower || { games: 0, wins: 0 };
        const before = side === "A" ? ra : rb;
        const ms = Math.max(0, Date.now() - this.startsAt);
        p.tower = { ...t, rating: next[side], games: (t.games || 0) + 1, wins: (t.wins || 0) + (side === winner ? 1 : 0), at: Date.now(),
          pieces: (t.pieces || 0) + this.st[side].pieces, ms: (t.ms || 0) + ms, sent: (t.sent || 0) + this.sent[side], best: Math.max(t.best || 0, this.sent[side]) };
        saveProfile(p);
        ratings[side] = { before: Math.round(before.r), after: Math.round(next[side].r), rdBefore: Math.round(before.rd), rdAfter: Math.round(next[side].rd) };
      }
    }
    for (const side of ["A", "B"]) this.send(side, { t: "towerEnd", id: this.id, winner, you: side, reason, ratings, sent: this.sent, seed: this.seed, log: this.log,
      names: { A: this.seats.A.profile.name, B: this.seats.B.profile.name } });
    this.onEnd(this);
  }
  onDisconnect(side) {
    if (this.over) return;
    this.seats[side].connected = false;
    this.grace[side] = setTimeout(() => { if (!this.over && !this.seats[side].connected) this.end(side, "left"); }, GRACE_MS);
  }
  onReconnect(side, socket) {
    if (this.over) return false;
    clearTimeout(this.grace[side]);
    this.seats[side].socket = socket;
    this.seats[side].connected = true;
    this.hello(side, true);
    this.send(side, this.board(side, true)); this.send(side, this.board(this.other(side), true));
    return true;
  }
  // A Control-match message reaching a TOWER match does nothing.
  submitMove() { return "Not in this mode."; }
  submitDiscard() { return "Not in this mode."; }
  submitAction() { return "Not in this mode."; }
}
