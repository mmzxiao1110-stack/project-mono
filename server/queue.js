/**
 * Matchmaking.
 *
 * Everyone in the queue carries a search band that widens the longer they wait.
 * A pair is legal only when the gap fits inside BOTH bands — otherwise a patient
 * veteran would get dumped on a newcomer who's only been waiting two seconds.
 * Among all legal pairs we take the closest first, so good matches aren't
 * consumed by mediocre ones.
 */

export const BAND_START = 40;   // TR
export const BAND_GROWTH = 55;  // TR per second
export const BAND_CAP = 600;
const TICK_MS = 200;

export const bandFor = (waitedSec) =>
  Math.min(BAND_CAP, BAND_START + waitedSec * BAND_GROWTH);

export class Queue {
  constructor(onPair) {
    this.entries = new Map(); // playerId -> entry
    this.onPair = onPair;
    this.timer = null; // started with the first player (no timers at load: Cloudflare forbids them)
  }

  add(entry) {
    if (!this.timer) { this.timer = setInterval(() => this.tick(), TICK_MS); this.timer.unref?.(); }
    entry.joinedAt = Date.now();
    this.entries.set(entry.playerId, entry);
  }

  remove(playerId) {
    this.entries.delete(playerId);
  }

  has(playerId) {
    return this.entries.has(playerId);
  }

  get size() {
    return this.entries.size;
  }

  tick() {
    const now = Date.now();
    const list = [...this.entries.values()];

    for (const e of list) {
      const waited = (now - e.joinedAt) / 1000;
      e.band = bandFor(waited);
      e.onProgress?.({
        band: Math.round(e.band),
        elapsed: waited,
        queued: list.length,
      });
    }

    // Greedy closest-pair. Fine well past the point you'd need a real
    // matchmaking service; revisit above a few hundred concurrent players.
    const pairs = [];
    for (let i = 0; i < list.length; i++)
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i], b = list[j];
        const gap = Math.abs(a.rating.r - b.rating.r);
        if (gap <= Math.min(a.band, b.band)) pairs.push({ a, b, gap });
      }
    pairs.sort((x, y) => x.gap - y.gap);

    const used = new Set();
    for (const { a, b, gap } of pairs) {
      if (used.has(a.playerId) || used.has(b.playerId)) continue;
      used.add(a.playerId);
      used.add(b.playerId);
      this.entries.delete(a.playerId);
      this.entries.delete(b.playerId);
      this.onPair(a, b, gap);
    }
  }

  stop() {
    clearInterval(this.timer);
  }
}
