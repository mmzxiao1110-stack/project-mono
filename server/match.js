/**
 * One authoritative match.
 *
 * The server owns the shuffle, both queues, the board, and the clock.
 * A client can only ever say "I play my current piece, rotated once, at (4,6)"
 * or "I pass".
 * Everything else is derived here, which is what makes the simultaneous
 * reveal safe: neither player's move is transmitted until both have landed.
 */
import {
  BLOCKS, TURNS, initialBoard, isLegal, rotateN, absCells, boundsOf,
  resolveTurn, scoreOf, newDeck, advanceDeck, currentPiece, currentPass, upcoming,
  hasAnyMove, ROWS, COLS, newSeed, emptyPins, checkAction, nextMeters,
} from "../shared/engine.js";
import { RULES } from "../shared/rules.js";
import { glickoUpdate, rankIndexFor } from "../shared/glicko.js";
import { saveProfile } from "./store.js";

/** Squares from a client: a short list of [row, col] integer pairs, or null. */
function cleanCells(v) {
  if (!Array.isArray(v) || v.length < 1 || v.length > Math.max(RULES.deleteMax, RULES.pinMax)) return null;
  const out = [];
  for (const p of v) {
    if (!Array.isArray(p) || p.length !== 2 || !Number.isInteger(p[0]) || !Number.isInteger(p[1])) return null;
    out.push([p[0], p[1]]);
  }
  return out;
}

/**
 * No clock runs while both players are still thinking. The moment one of them
 * locks in, the other gets SHOT_CLOCK_MS to answer — so the timer is pressure
 * applied by your opponent, not by the server.
 */
export const SHOT_CLOCK_MS = 15_000;
export const REVEAL_MS = 1_100;  // must match the client animation
const DISCONNECT_GRACE_MS = 30_000;
// Backstop: if neither side moves at all, don't hold the match open forever.
const IDLE_MS = 180_000;

let nextId = 1;

// Client numbers arrive as JSON: accept real numbers only. Number() on an
// object can throw, and a string like "1e400" is not a position.
const num = (v) => (typeof v === "number" ? v : NaN);

export class Match {
  /**
   * @param seats [{ profile, loadout, socket }, ...] — index 0 is seat A.
   * @param onEnd called with this match once it's finished, for cleanup.
   */
  constructor(seats, onEnd) {
    this.id = `m${nextId++}`;
    this.onEnd = onEnd;
    this.over = false;
    this.startedAt = Date.now();
    this.turn = 1;
    this.board = initialBoard();
    this.pins = emptyPins();        // permanent squares
    this.meters = { A: 0, B: 0 };   // pins each side may spend
    this.pending = { A: undefined, B: undefined };
    this.timer = null;
    this.graceTimers = { A: null, B: null };

    // One seed for both queues when the rules say so: the same pieces, in the same order.
    const seed = newSeed();
    this.seats = {
      A: { ...seats[0], side: "A", connected: true, deck: newDeck(seats[0].loadout, seed) },
      B: { ...seats[1], side: "B", connected: true, deck: newDeck(seats[1].loadout, RULES.sharedSequence ? seed : newSeed()) },
    };

    // Snapshot ratings at match start — this is what Glicko scores against.
    this.ratingAtStart = {
      A: { ...this.seats.A.profile.rating },
      B: { ...this.seats.B.profile.rating },
    };
  }

  other(side) {
    return side === "A" ? "B" : "A";
  }

  send(side, msg) {
    const s = this.seats[side];
    if (s.socket && s.socket.readyState === 1) {
      s.socket.send(JSON.stringify(msg));
    }
  }

  both(msgFor) {
    this.send("A", msgFor("A"));
    this.send("B", msgFor("B"));
  }

  publicSeat(side) {
    const p = this.seats[side].profile;
    return {
      name: p.name,
      rating: Math.round(p.rating.r),
      rd: Math.round(p.rating.rd),
      loadout: this.seats[side].loadout,
    };
  }

  /** A seat's queue as the client sees it — both players see both queues. */
  queueOf(side) {
    const d = this.seats[side].deck;
    return { piece: currentPiece(d), queue: upcoming(d), pass: currentPass(d) };
  }

  start() {
    this.both((side) => ({
      t: "matchStart",
      matchId: this.id,
      you: side,
      opponent: this.publicSeat(this.other(side)),
      loadout: this.seats[side].loadout,
      turns: TURNS,
    }));
    this.sendTurn();
  }

  turnMessage(side) {
    const mine = this.queueOf(side);
    return {
      t: "turn",
      matchId: this.id,
      turn: this.turn,
      board: this.board,
      piece: mine.piece,
      hand: [mine.piece],          // older clients read the hand; one piece now
      queue: mine.queue,
      pass: mine.pass,
      opp: this.queueOf(this.other(side)),
      pins: this.pins,
      meters: { me: this.meters[side], opp: this.meters[this.other(side)] },
      deadline: this.deadline || null,
    };
  }

  sendTurn() {
    if (this.over) return;
    this.deadline = null;
    this.both((side) => this.turnMessage(side));
    clearTimeout(this.timer);
    // Nobody is on the clock yet — only the idle backstop is armed.
    this.timer = setTimeout(() => this.onIdle(), IDLE_MS);
  }

  /** First lock-in of the turn starts the shot clock for the other player. */
  startShotClock() {
    if (this.over || this.deadline) return;
    this.deadline = Date.now() + SHOT_CLOCK_MS;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.onTimeout(), SHOT_CLOCK_MS + 400);
    this.both(() => ({ t: "clock", turn: this.turn, deadline: this.deadline }));
  }

  onTimeout() {
    if (this.over) return;
    for (const side of ["A", "B"]) {
      if (this.pending[side] === undefined) this.applyDiscard(side);
    }
    this.maybeResolve();
  }

  /** Neither player has touched anything for minutes. Move it along. */
  onIdle() {
    if (this.over) return;
    for (const side of ["A", "B"]) {
      if (this.pending[side] === undefined) this.applyDiscard(side);
    }
    this.maybeResolve();
  }

  /** Validates and stores a placement of the current piece. Returns an error string, or null. */
  submitMove(side, msg) {
    if (this.over) return "match is over";
    if (msg.turn !== this.turn) return "wrong turn";
    if (this.pending[side] !== undefined) return "already submitted";

    const seat = this.seats[side];
    const blockId = currentPiece(seat.deck);
    const rot = Number.isInteger(msg.rot) ? msg.rot : 0;
    const pos = msg.pos;
    if (!Array.isArray(pos) || pos.length !== 2) return "bad position";

    const shape = rotateN(BLOCKS[blockId].cells, rot);
    const { h, w } = boundsOf(shape);
    const [r, c] = [num(pos[0]), num(pos[1])];
    if (!Number.isInteger(r) || !Number.isInteger(c)) return "bad position";
    if (r < 0 || c < 0 || r + h > ROWS || c + w > COLS) return "off the board";

    const cells = absCells(shape, [r, c]);
    if (!isLegal(this.board, cells, side)) return "illegal placement";

    return this.accept(side, { type: "place", blockId, cells, value: BLOCKS[blockId].cells.length }, msg.pins);
  }

  /** Delete 1–4 connected squares (anyone's, never pinned), or pin (when pinning is a turn of its own). */
  submitAction(side, msg, type) {
    if (this.over) return "match is over";
    if (msg.turn !== this.turn) return "wrong turn";
    if (this.pending[side] !== undefined) return "already submitted";
    const cells = cleanCells(msg.cells);
    if (!cells) return "bad squares";
    return this.accept(side, { type, cells }, msg.pins);
  }

  /** Final check (including any free pins) and lock it in. */
  accept(side, move, rawPins) {
    if (rawPins !== undefined && rawPins !== null) {
      const pins = cleanCells(rawPins);
      if (!pins) return "bad squares";
      move = { ...move, pins };
    }
    const err = checkAction(this.board, this.pins, this.meters[side], side, move);
    if (err) return err;
    this.pending[side] = move;
    this.send(side, { t: "ack", turn: this.turn });
    this.send(this.other(side), { t: "oppReady", turn: this.turn });
    this.startShotClock();
    this.maybeResolve();
    return null;
  }

  /** Passing: the current piece is spent without being placed. */
  submitDiscard(side, msg) {
    if (this.over) return "match is over";
    if (msg.turn !== this.turn) return "wrong turn";
    if (this.pending[side] !== undefined) return "already submitted";
    // Passing may still carry free pins.
    if (msg.pins) return this.accept(side, { type: "pass" }, msg.pins);
    this.applyDiscard(side);
    this.send(side, { t: "ack", turn: this.turn });
    this.send(this.other(side), { t: "oppReady", turn: this.turn });
    this.startShotClock();
    this.maybeResolve();
    return null;
  }

  applyDiscard(side) {
    this.pending[side] = null; // null = passed, undefined = still thinking
    return null;
  }

  maybeResolve() {
    if (this.pending.A === undefined || this.pending.B === undefined) return;
    clearTimeout(this.timer);
    this.deadline = null;

    const res = resolveTurn(this.board, this.pending.A, this.pending.B, this.pins);
    this.board = res.board;
    this.pins = res.pins;
    this.meters = nextMeters(this.meters, this.pending.A, this.pending.B, res.deleted);

    // Played or passed, the current piece is spent and the queue moves on.
    for (const side of ["A", "B"]) {
      const seat = this.seats[side];
      seat.deck = advanceDeck(seat.deck, seat.loadout);
    }

    const pub = (m) => (m ? { type: m.type || "place", blockId: m.blockId, cells: m.cells, pins: m.pins || null } : null);
    const moves = { A: pub(this.pending.A), B: pub(this.pending.B) };
    const score = scoreOf(this.board);

    this.both((side) => ({
      t: "reveal",
      matchId: this.id,
      turn: this.turn,
      board: this.board,
      pins: this.pins,
      meters: { me: this.meters[side], opp: this.meters[this.other(side)] },
      moves,
      contested: res.contested,
      lines: res.lines,
      cleared: res.cleared,
      score,
    }));

    this.pending = { A: undefined, B: undefined };

    // Locked: neither player can place any piece of their deck anywhere
    // (and, with deleting on, there's nothing left to delete either).
    const deletable = RULES.actions && this.board.some((row, r) => row.some((v, c) => v !== null && !this.pins[r][c]));
    const locked = !deletable &&
      !hasAnyMove(this.board, this.seats.A.loadout, "A") &&
      !hasAnyMove(this.board, this.seats.B.loadout, "B");

    if (locked) {
      this.endReason = "locked";
      setTimeout(() => this.end(), REVEAL_MS);
    } else if (this.turn >= TURNS) {
      this.endReason = "turns";
      setTimeout(() => this.end(), REVEAL_MS);
    } else {
      this.turn++;
      setTimeout(() => this.sendTurn(), REVEAL_MS);
    }
  }

  /** @param forfeitBy side that quit, if any */
  end(forfeitBy = null) {
    if (this.over) return;
    this.over = true;
    if (forfeitBy) this.endReason = "forfeit";
    clearTimeout(this.timer);
    clearTimeout(this.graceTimers.A);
    clearTimeout(this.graceTimers.B);

    const score = scoreOf(this.board);
    const seconds = Math.round((Date.now() - this.startedAt) / 1000);

    let sA;
    if (forfeitBy === "A") sA = 0;
    else if (forfeitBy === "B") sA = 1;
    else sA = score.a > score.b ? 1 : score.a < score.b ? 0 : 0.5;

    const nextRating = {
      A: glickoUpdate(this.ratingAtStart.A, [{ ...this.ratingAtStart.B, s: sA }]),
      B: glickoUpdate(this.ratingAtStart.B, [{ ...this.ratingAtStart.A, s: 1 - sA }]),
    };

    for (const side of ["A", "B"]) {
      const seat = this.seats[side];
      const p = seat.profile;
      const before = this.ratingAtStart[side];
      const after = nextRating[side];
      const tr = Math.round(after.r);
      const mine = side === "A" ? score.a : score.b;
      const theirs = side === "A" ? score.b : score.a;
      const won = side === "A" ? sA === 1 : sA === 0;
      const drew = sA === 0.5;

      const st = p.stats;
      const games = st.games + 1;
      const streak = drew ? 0 : won ? Math.max(1, st.streak + 1) : Math.min(-1, st.streak - 1);

      p.rating = after;
      p.stats = {
        ...st,
        games,
        wins: st.wins + (won ? 1 : 0),
        losses: st.losses + (!won && !drew ? 1 : 0),
        seconds: st.seconds + seconds,
        streak,
        bestStreak: Math.max(st.bestStreak, streak),
        peakTr: Math.max(st.peakTr, tr),
        peakRank: Math.max(st.peakRank ?? 0, rankIndexFor(tr)),
        squares: (st.squares * st.games + mine) / games,
        special: (st.special * st.games + score.s) / games,
        history: [...st.history, tr].slice(-40),
        recent: [
          {
            name: this.seats[this.other(side)].profile.name,
            won, drew,
            delta: tr - Math.round(before.r),
            seconds,
            score: [mine, theirs],
          },
          ...st.recent,
        ].slice(0, 8),
      };
      saveProfile(p);

      this.send(side, {
        t: "matchOver",
        matchId: this.id,
        won, drew,
        forfeit: forfeitBy ? forfeitBy !== side : false,
        reason: this.endReason || "turns",
        myScore: mine,
        oppScore: theirs,
        special: score.s,
        seconds,
        opponent: this.publicSeat(this.other(side)),
        rating: { before, after },
        profile: { name: p.name, rating: p.rating, stats: p.stats },
      });
    }

    this.onEnd(this);
  }

  /** Player dropped. Hold their seat briefly before awarding the forfeit. */
  onDisconnect(side) {
    if (this.over) return;
    this.seats[side].connected = false;
    this.send(this.other(side), { t: "oppDropped", grace: DISCONNECT_GRACE_MS });
    this.graceTimers[side] = setTimeout(() => {
      if (!this.over && !this.seats[side].connected) this.end(side);
    }, DISCONNECT_GRACE_MS);
  }

  onReconnect(side, socket) {
    if (this.over) return false;
    clearTimeout(this.graceTimers[side]);
    this.seats[side].socket = socket;
    this.seats[side].connected = true;
    this.send(this.other(side), { t: "oppReturned" });
    this.send(side, {
      t: "matchStart",
      matchId: this.id,
      you: side,
      opponent: this.publicSeat(this.other(side)),
      loadout: this.seats[side].loadout,
      turns: TURNS,
      resumed: true,
    });
    this.send(side, { ...this.turnMessage(side), alreadyMoved: this.pending[side] !== undefined });
    return true;
  }
}