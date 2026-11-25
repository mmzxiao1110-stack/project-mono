/**
 * Saved replays, on this device. Each is a few kilobytes (see
 * shared/replay.js), so the newest MAX are kept and older ones drop off.
 */
const KEY = "tb:replays";
const MAX = 40;

function read() {
  try {
    const list = JSON.parse(localStorage.getItem(KEY) || "[]");
    return Array.isArray(list) ? list : [];
  } catch { return []; }
}
function write(list) {
  try { localStorage.setItem(KEY, JSON.stringify(list)); } catch { /* full or private mode: keep what fits */ }
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
    if (!rec || !Array.isArray(rec.turns) || !rec.turns.length) return null;
    const id = rec.id || `${rec.date || Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const list = [{ ...rec, id }, ...all().filter((r) => r.id !== id)].slice(0, MAX);
    changed(list);
    return id;
  },
  get: (id) => all().find((r) => r.id === id) || null,
  remove(id) { changed(all().filter((r) => r.id !== id)); },
};
