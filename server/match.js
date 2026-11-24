/**
 * One authoritative match.
 *
 * The server owns the shuffle, both hands, the board, and the clock.
 * A client can only ever say "I play hand slot 2, rotated once, at (4,6)".
 * Everything else is derived here, which is what makes the simultaneous
 * reveal safe: neither player's move is transmitted until both have landed.
 */
import {
  BLOCKS, TURNS, GOLDEN_SLOT, initialBoard, isLegal, rotateN, absCells, boundsOf,
  resolveTurn, scoreOf, newDeck, cycleHand, hasAnyMove, goldenCycleFor, ROWS, COLS,
} from "../shared/engine.js";
import { glickoUpdate, rankIndexFor } from "../shared/glicko.js";
import { saveProfile } from "./store.js";

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
// object can throw, and a string like "1e400" is not a hand slot.
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
    this.pending = { A: undefined, B: undefined };
    this.timer = null;
    this.graceTimers = { A: null, B: null };

    this.seats = {
      A: { ...seats[0], side: "A", connected: true, deck: newDeck(seats[0].loadout), goldenPlays: 0 },
      B: { ...seats[1], side: "B", connected: true, deck: newDeck(seats[1].loadout), goldenPlays: 0 },
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
      // Both players get to study each other's eight blocks.
      loadout: this.seats[side].loadout,
    };
  }

  goldenBlock(side) {
    return this.seats[side].loadout[GOLDEN_SLOT];
  }

  /** Charged AND actually holding it — a charge you can't play isn't a threat. */
  goldenArmed(side) {
    const seat = this.seats[side];
    const id = this.goldenBlock(side);
    return seat.goldenPlays >= goldenCycleFor(id) && seat.deck.hand.includes(id);
  }

  start() {
    this.both((side) => ({
      t: "matchStart",
      matchId: this.id,
      you: side,
      opponent: this.publicSeat(this.other(side)),
      loadout: this.seats[side].loadout,
      goldenSlot: GOLDEN_SLOT,
      turns: TURNS,
    }));
    this.sendTurn();
  }

  /** Each player sees their own hand and only a count of the opponent's. */
  sendTurn() {
    if (this.over) return;
    this.deadline = null;
    this.both((side) => ({
      t: "turn",
      matchId: this.id,
      turn: this.turn,
      board: this.board,
      hand: this.seats[side].deck.hand,
      bagLeft: this.seats[side].deck.bag.length,
      oppHandCount: this.seats[this.other(side)].deck.hand.length,
      golden: {
        blockId: this.goldenBlock(side),
        plays: this.seats[side].goldenPlays,
        need: goldenCycleFor(this.goldenBlock(side)),
        armed: this.goldenArmed(side),
        oppArmed: this.goldenArmed(this.other(side)),
      },
      deadline: null,
    }));

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
      if (this.pending[side] === undefined) this.applyDiscard(side, 0, true);
    }
    this.maybeResolve();
  }

  /** Neither player has touched anything for minutes. Move it along. */
  onIdle() {
    if (this.over) return;
    for (const side of ["A", "B"]) {
      if (this.pending[side] === undefined) this.applyDiscard(side, 0, true);
    }
    this.maybeResolve();
  }

  /** Validates and stores a placement. Returns an error string, or null. */
  submitMove(side, msg) {
    if (this.over) return "match is over";
    if (msg.turn !== this.turn) return "wrong turn";
    if (this.pending[side] !== undefined) return "already submitted";

    const seat = this.seats[side];
    const handIdx = num(msg.handIdx);
    if (!Number.isInteger(handIdx) || handIdx < 0 || handIdx >= seat.deck.hand.length) {
      return "no such card";
    }

    const blockId = seat.deck.hand[handIdx];
    const rot = Number.isInteger(msg.rot) ? msg.rot : 0;
    const pos = msg.pos;
    if (!Array.isArray(pos) || pos.length !== 2) return "bad position";

    const shape = rotateN(BLOCKS[blockId].cells, rot);
    const { h, w } = boundsOf(shape);
    const [r, c] = [num(pos[0]), num(pos[1])];
    if (!Number.isInteger(r) || !Number.isInteger(c)) return "bad position";
    if (r < 0 || c < 0 || r + h > ROWS || c + w > COLS) return "off the board";

    // Golden status is decided here, never taken from the client.
    const golden = blockId === this.goldenBlock(side) && this.goldenArmed(side);

    const cells = absCells(shape, [r, c]);
    if (!isLegal(this.board, cells, side, { golden })) return "illegal placement";

    this.pending[side] = { handIdx, blockId, cells, golden, value: BLOCKS[blockId].cells.length };
    this.send(side, { t: "ack", turn: this.turn });
    this.send(this.other(side), { t: "oppReady", turn: this.turn });
    this.startShotClock();
    this.maybeResolve();
    return null;
  }

  submitDiscard(side, msg) {
    if (this.over) return "match is over";
    if (msg.turn !== this.turn) return "wrong turn";
    if (this.pending[side] !== undefined) return "already submitted";
    const err = this.applyDiscard(side, num(msg.handIdx));
    if (err) return err;
    this.send(side, { t: "ack", turn: this.turn });
    this.send(this.other(side), { t: "oppReady", turn: this.turn });
    this.startShotClock();
    this.maybeResolve();
    return null;
  }

  applyDiscard(side, handIdx, silent = false) {
    const seat = this.seats[side];
    if (!seat.deck.hand.length) { this.pending[side] = null; return null; }
    if (!Number.isInteger(handIdx) || handIdx < 0 || handIdx >= seat.deck.hand.length) {
      if (!silent) return "no such card";
      handIdx = 0;
    }
    this.pending[side] = null; // null = passed, undefined = still thinking
    this.pending[side + "_discard"] = handIdx;
    return null;
  }

  maybeResolve() {
    if (this.pending.A === undefined || this.pending.B === undefined) return;
    clearTimeout(this.timer);
    this.deadline = null;

    const res = resolveTurn(this.board, this.pending.A, this.pending.B);
    this.board = res.board;

    // Consume the played or discarded block, then draw from the bag.
    for (const side of ["A", "B"]) {
      const seat = this.seats[side];
      const move = this.pending[side];
      const idx = move ? move.handIdx : this.pending[side + "_discard"] ?? 0;
      const played = seat.deck.hand[idx];

      if (move && played === this.goldenBlock(side)) {
        // Spending a charged golden piece resets it; otherwise it charges.
        seat.goldenPlays = move.golden ? 0 : seat.goldenPlays + 1;
      }
      if (seat.deck.hand.length) seat.deck = cycleHand(seat.deck, idx, seat.loadout);
    }

    const moves = {
      A: this.pending.A ? { blockId: this.pending.A.blockId, cells: this.pending.A.cells, golden: this.pending.A.golden } : null,
      B: this.pending.B ? { blockId: this.pending.B.blockId, cells: this.pending.B.cells, golden: this.pending.B.golden } : null,
    };
    const score = scoreOf(this.board);

    this.both(() => ({
      t: "reveal",
      matchId: this.id,
      turn: this.turn,
      board: this.board,
      moves,
      contested: res.contested,
      cleared: res.cleared,
      score,
    }));

    this.pending = { A: undefined, B: undefined };

    const stuck =
      !hasAnyMove(this.board, this.seats.A.deck.hand, "A", { goldenBlockId: this.goldenArmed("A") ? this.goldenBlock("A") : null }) &&
      !hasAnyMove(this.board, this.seats.B.deck.hand, "B", { goldenBlockId: this.goldenArmed("B") ? this.goldenBlock("B") : null });

    if (stuck) {
      // Neither side can legally place anything — including with a charged
      // golden piece. Nothing left to play for; call it here.
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
      goldenSlot: GOLDEN_SLOT,
      turns: TURNS,
      resumed: true,
    });
    this.send(side, {
      t: "turn",
      matchId: this.id,
      turn: this.turn,
      board: this.board,
      hand: this.seats[side].deck.hand,
      bagLeft: this.seats[side].deck.bag.length,
      oppHandCount: this.seats[this.other(side)].deck.hand.length,
      golden: {
        blockId: this.goldenBlock(side),
        plays: this.seats[side].goldenPlays,
        need: goldenCycleFor(this.goldenBlock(side)),
        armed: this.goldenArmed(side),
        oppArmed: this.goldenArmed(this.other(side)),
      },
      deadline: this.deadline,
      alreadyMoved: this.pending[side] !== undefined,
    });
    return true;
  }
}