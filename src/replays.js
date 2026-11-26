/**
 * Saved replays, on this device. Each is a few kilobytes (see
 * shared/replay.js), so the newest MAX are kept and older ones drop off.
 */
const KEY = "tb:replays";
const MAX = 250;

function read() {
  try {
    const list = JSON.parse(localStorage.getItem(KEY) || "[]");
    return Array.isArray(list) ? list : [];
  } catch { return []; }
}
/** Saves the list; if the browser's storage is full, the oldest replays make room until it fits. */
function write(list) {
  for (let keep = list.length; keep > 0; keep = Math.floor(keep * 0.9)) {
    try { localStorage.setItem(KEY, JSON.stringify(list.slice(0, keep))); if (keep < list.length) list.length = keep; return; }
    catch { /* too big: try with fewer */ }
  }
}

const listeners = new Set();
let cache = null;
const all = () => (cache ??= read());
const changed = (list) => { cache = list; write(list); listeners.forEach((fn) => fn()); };

export const replays = {
  all,
  subscribe: (fn) => { listeners.add(fn); return () => listeners.delete(fn); },
  /** Saves a replay record; returns its id. */
  save(rec) {
    // A match keeps its turns; a solo run (Sprint, Ultra, Marathon) its seed and moves.
    if (!rec || !((Array.isArray(rec.turns) && rec.turns.length) || (rec.kind && Array.isArray(rec.moves) && rec.moves.length))) return null;
    const id = rec.id || `${rec.date || Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const list = [{ ...rec, id }, ...all().filter((r) => r.id !== id)].slice(0, MAX);
    changed(list);
    return id;
  },
  get: (id) => all().find((r) => r.id === id) || null,
  remove(id) { changed(all().filter((r) => r.id !== id)); },
};
