/**
 * A Blitz 1v1, run by the server. Both players get the same seed (the same
 * pieces), so only play differs. Every placement is checked here against
 * this copy of each board; spikes are timed here; junk is sent from here.
 * The match ends when a player has nothing that fits, forfeits or leaves.
 *
 * To clients:
 *   blitzStart { id, you, seed, opponent: { name, rating }, countdown }
 *   blitzState { side, board, hand, queue, pieces, lines, spike, sent }
 *   blitzJunk  { level, at }   junk you received, inserted when you had placed `at` pieces
 *   blitzEnd   { winner, reason, ratings? }
 *   chat       (as in a Control match)
 */
import { randomBytes } from "node:crypto";
import { newSprint, newSprintSeed, place, shapeOf, noteClear, spikeDue, receiveJunk, HAND } from "../shared/sprint.js";
import { glickoUpdate } from "../shared/glicko.js";
import { saveProfile } from "./store.js";
import { unref } from "./timers.js";

export const COUNTDOWN_MS = 3000;
const GRACE_MS = 15000;

export class BlitzMatch {
  constructor(seats, onEnd, { rated = true } = {}) {
    this.id = "b" + randomBytes(5).toString("hex");
    this.rated = rated;
    this.seats = { A: { ...seats[0], connected: true }, B: { ...seats[1], connected: true } };
    this.seed = newSprintSeed();
    this.st = { A: newSprint(this.seed, Infinity), B: newSprint(this.seed, Infinity) };
    this.sent = { A: 0, B: 0 };
    this.onEnd = onEnd;
    this.over = false;
    this.grace = {};
  }
  other(side) { return side === "A" ? "B" : "A"; }
  send(side, msg) { const s = this.seats[side].socket; if (s && s.readyState === 1) s.send(JSON.stringify(msg)); }
  rating(side) { return this.seats[side].profile.blitz?.rating || null; }

  start() {
    this.startsAt = Date.now() + COUNTDOWN_MS;
    for (const side of ["A", "B"]) {
      const o = this.seats[this.other(side)].profile;
      this.send(side, { t: "blitzStart", id: this.id, you: side, seed: this.seed, countdown: COUNTDOWN_MS,
        opponent: { name: o.name, guest: !!o.guest, rating: o.blitz?.rating ? Math.round(o.blitz.rating.r) : null } });
    }
    this.timer = unref(setInterval(() => this.tick(), 50));
  }
  view(side) {
    const st = this.st[side];
    return { t: "blitzState", side, board: st.board, hand: st.hand, queue: st.queue.slice(0, 8), pieces: st.pieces, lines: st.lines, spike: st.spike || 0, sent: this.sent[side] };
  }
  broadcast(side) { const v = this.view(side); this.send("A", v); this.send("B", v); }
  tick() {
    if (this.over) return;
    const now = Date.now();
    for (const side of ["A", "B"]) {
      const level = spikeDue(this.st[side], now);
      if (!level) continue;
      const to = this.other(side);
      receiveJunk(this.st[to], level);
      this.sent[side]++;
      this.send(to, { t: "blitzJunk", level, at: this.st[to].pieces });
      this.broadcast(to);
    }
  }
  /** A placement: { slot, rot, r, c } (top-left of where it went). */
  submit(side, msg) {
    if (this.over) return "The match is over.";
    if (Date.now() < this.startsAt - 150) return "Not started yet.";
    const st = this.st[side];
    const { slot, rot, r, c } = msg;
    if (![slot, rot, r, c].every(Number.isInteger) || slot < 0 || slot >= HAND || rot < 0 || rot > 3) return "Bad placement.";
    const s = shapeOf(st.hand[slot], rot);
    if (!place(st, { slot, id: st.hand[slot], rot, cr: r + s.h / 2, cc: c + s.w / 2 })) {
      this.send(side, this.view(side)); // out of step: here's the real board
      return null;
    }
    const L = st.last;
    if (L.lines) noteClear(st, L.lines, Date.now(), L.allClear, L.id);
    this.broadcast(side);
    if (st.over) this.end(side, "stuck");
    return null;
  }
  chat(side, text) {
    const msg = { t: "chat", side, name: this.seats[side].profile.name, text, at: Date.now() };
    (this.chatLog ||= []).push({ name: msg.name, text, at: msg.at });
    if (this.chatLog.length > 30) this.chatLog.shift();
    this.send(side, msg);
    const other = this.other(side);
    if (!this.seats[other].socket?.blocked?.has(this.seats[side].profile.playerId)) this.send(other, msg);
  }
  /** `loser` lost (stuck, forfeit, left). */
  end(loser, reason = "forfeit") {
    if (this.over) return;
    this.over = true;
    clearInterval(this.timer);
    for (const k of Object.keys(this.grace)) clearTimeout(this.grace[k]);
    const winner = this.other(loser);
    let ratings = null;
    if (this.rated) {
      const ra = this.seats.A.profile.blitz?.rating || { r: 1500, rd: 350, vol: 0.06 };
      const rb = this.seats.B.profile.blitz?.rating || { r: 1500, rd: 350, vol: 0.06 };
      const sA = winner === "A" ? 1 : 0;
      const next = { A: glickoUpdate(ra, [{ ...rb, s: sA }]), B: glickoUpdate(rb, [{ ...ra, s: 1 - sA }]) };
      ratings = {};
      for (const side of ["A", "B"]) {
        const p = this.seats[side].profile;
        const b = p.blitz || { games: 0, wins: 0 };
        const before = Math.round((side === "A" ? ra : rb).r);
        p.blitz = { ...b, rating: next[side], games: (b.games || 0) + 1, wins: (b.wins || 0) + (side === winner ? 1 : 0), at: Date.now() };
        saveProfile(p);
        ratings[side] = { before, after: Math.round(next[side].r) };
      }
    }
    for (const side of ["A", "B"]) this.send(side, { t: "blitzEnd", id: this.id, winner, you: side, reason, ratings, sent: this.sent });
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
    const o = this.seats[this.other(side)].profile;
    this.send(side, { t: "blitzStart", id: this.id, you: side, seed: this.seed, countdown: Math.max(0, this.startsAt - Date.now()), resume: true,
      opponent: { name: o.name, guest: !!o.guest, rating: o.blitz?.rating ? Math.round(o.blitz.rating.r) : null } });
    this.send(side, this.view(side)); this.send(side, this.view(this.other(side)));
    return true;
  }
  // A Control-match message reaching a Blitz match does nothing.
  submitMove() { return "Not in this mode."; }
  submitDiscard() { return "Not in this mode."; }
  submitAction() { return "Not in this mode."; }
}
