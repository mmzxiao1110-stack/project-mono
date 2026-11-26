/**
 * ZERO-G controls and handling, saved on this device.
 *
 * Handling:
 *   das  delayed auto shift: how long (ms) you hold left/right before the
 *        piece starts sliding on its own
 *   arr  auto repeat rate: ms between steps once it slides (0: straight to the wall)
 *   dcd  DAS cut delay: after a turn or a new piece, a held slide waits this long (ms)
 *   shade  how dark the board is behind the pieces (0 clear, 100 nearly black)
 */
const KEY = "tb:zgKeys1";
const HKEY = "tb:zgHandling1";

export const ZG_ACTIONS = [
  { id: "left", label: "Left", def: "ArrowLeft" },
  { id: "right", label: "Right", def: "ArrowRight" },
  { id: "soft", label: "Soft drop", def: "ArrowDown" }, // instant: straight to the floor, without locking
  { id: "hard", label: "Hard drop", def: " " },
  { id: "ccw", label: "Turn L", def: "z" },
  { id: "cw", label: "Turn R", def: "ArrowUp" },
  { id: "r180", label: "Turn 180", def: "a" },
  { id: "hold", label: "Hold", def: "c" },
  { id: "retry", label: "Retry", def: "r" },
  { id: "forfeit", label: "Forfeit", def: "Escape" },
];

export const HANDLING = [
  { id: "das", label: "DAS", unit: "ms", min: 0, max: 300, step: 1, def: 120, hint: "hold before sliding" },
  { id: "arr", label: "ARR", unit: "ms", min: 0, max: 80, step: 1, def: 0, hint: "between slide steps · 0 = instant" },
  { id: "shade", label: "BOARD SHADE", unit: "%", min: 0, max: 100, step: 1, def: 30, hint: "darker behind the board" },
  { id: "dcd", label: "DCD", unit: "ms", min: 0, max: 100, step: 1, def: 0, hint: "slide pause after a turn" },
];

const norm = (k) => (typeof k === "string" && k.length === 1 ? k.toLowerCase() : k);
const defKeys = () => Object.fromEntries(ZG_ACTIONS.map((a) => [a.id, a.def]));
const defHandling = () => Object.fromEntries(HANDLING.map((h) => [h.id, h.def]));

function read(key, defs, ok) {
  try {
    const saved = JSON.parse(localStorage.getItem(key) || "null");
    const out = defs();
    if (saved && typeof saved === "object") for (const k of Object.keys(out)) if (ok(saved[k])) out[k] = saved[k];
    return out;
  } catch {
    return defs();
  }
}
let keys = read(KEY, defKeys, (v) => typeof v === "string");
let handling = read(HKEY, defHandling, (v) => Number.isFinite(v));
const subs = new Set();
const save = () => {
  try { localStorage.setItem(KEY, JSON.stringify(keys)); localStorage.setItem(HKEY, JSON.stringify(handling)); } catch { /* private mode */ }
  subs.forEach((f) => f());
};

export const zgSubscribe = (f) => { subs.add(f); return () => subs.delete(f); };
export const getZgKeys = () => keys;
export const getZgHandling = () => handling;
export function setZgKey(id, key) {
  const k = norm(key);
  const next = { ...keys };
  for (const a of ZG_ACTIONS) if (a.id !== id && next[a.id] === k) next[a.id] = "";
  next[id] = k;
  keys = next; save();
}
export function setZgHandling(id, v) { handling = { ...handling, [id]: v }; save(); }
export function resetZg() { keys = defKeys(); handling = defHandling(); save(); }
// The key ZERO-G's sounds play in: D major, or D minor with this on.
const MKEY = "tb:zgMinor";
let minor = (() => { try { return localStorage.getItem(MKEY) === "1"; } catch { return false; } })();
export const getZgMinor = () => minor;
export function setZgMinor(on) { minor = !!on; try { localStorage.setItem(MKEY, minor ? "1" : "0"); } catch { /* private mode */ } subs.forEach((f) => f()); }
export const zgActionFor = (key) => { const k = norm(key); return ZG_ACTIONS.find((a) => keys[a.id] === k)?.id || null; };
