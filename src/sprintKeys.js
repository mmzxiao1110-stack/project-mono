/**
 * Sprint controls: their own set, separate from a match's, saved on this
 * device and edited in the game. Keys are KeyboardEvent.key, single
 * characters lowercased, like keys.js.
 *
 * DAS (delayed auto shift): press a direction and the piece steps once;
 * keep holding for `das` milliseconds and it jumps to that edge.
 */
const KEY = "tb:sprintKeys";

export const SPRINT_ACTIONS = [
  { id: "slot1", label: "Piece 1", def: "a" },
  { id: "slot2", label: "Piece 2", def: "s" },
  { id: "slot3", label: "Piece 3", def: "d" },
  { id: "left", label: "Left", def: "ArrowLeft" },
  { id: "right", label: "Right", def: "ArrowRight" },
  { id: "up", label: "Up", def: "ArrowUp" },
  { id: "down", label: "Down", def: "ArrowDown" },
  { id: "ccw", label: "Rotate L", def: "z" },
  { id: "cw", label: "Rotate R", def: "x" },
  { id: "place", label: "Place", def: " " },
  { id: "retry", label: "Retry", def: "r" },
  { id: "forfeit", label: "Forfeit", def: "Escape" },
];
export const DAS_DEFAULT = 120;

export const normalize = (k) => (typeof k === "string" && k.length === 1 ? k.toLowerCase() : k);
// mode: "keyboard" (arrows move the piece) or "mouse" (the piece follows the cursor, click places).
const defaults = () => ({ ...Object.fromEntries(SPRINT_ACTIONS.map((a) => [a.id, a.def])), das: DAS_DEFAULT, mode: "keyboard" });

function load() {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) || "null");
    if (!saved || typeof saved !== "object") return defaults();
    const out = defaults();
    for (const a of SPRINT_ACTIONS) if (typeof saved[a.id] === "string" && saved[a.id]) out[a.id] = saved[a.id];
    if (Number.isFinite(saved.das)) out.das = Math.max(0, Math.min(400, Math.round(saved.das)));
    if (saved.mode === "mouse") out.mode = "mouse";
    return out;
  } catch {
    return defaults();
  }
}
let keys = load();
const subs = new Set();
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(keys)); } catch { /* private mode: this visit only */ } subs.forEach((f) => f()); };

export const getSprintKeys = () => keys;
export const subscribeSprintKeys = (f) => { subs.add(f); return () => subs.delete(f); };
/** Binds `key` to `id`; whatever else had that key loses it (no key does two things). */
export function setSprintKey(id, key) {
  const k = normalize(key);
  const next = { ...keys };
  for (const a of SPRINT_ACTIONS) if (a.id !== id && next[a.id] === k) next[a.id] = "";
  next[id] = k;
  keys = next; save();
}
export function setDas(ms) { keys = { ...keys, das: Math.max(0, Math.min(400, Math.round(ms))) }; save(); }
export function setSprintMode(mode) { keys = { ...keys, mode: mode === "mouse" ? "mouse" : "keyboard" }; save(); }
/** Back to the default keys and delay (the control mode stays as chosen). */
export function resetSprintKeys() { keys = { ...defaults(), mode: keys.mode }; save(); }
/** The action a key press means, or null. */
export function sprintActionFor(key) {
  const k = normalize(key);
  return SPRINT_ACTIONS.find((a) => keys[a.id] === k)?.id || null;
}
