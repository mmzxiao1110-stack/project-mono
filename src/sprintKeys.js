/**
 * Sprint controls (mouse mode: the piece follows the cursor). Saved on this
 * device and edited in the game. A binding is a KeyboardEvent.key (single
 * characters lowercased) or a mouse button: "Mouse1" left, "Mouse2" right,
 * "Mouse3" middle, "Mouse4" back, "Mouse5" forward.
 */
const KEY = "tb:sprintKeys2";

export const SPRINT_ACTIONS = [
  { id: "swap", label: "Swap", def: "Mouse2" },
  { id: "ccw", label: "Rotate L", def: "s" },
  { id: "cw", label: "Rotate R", def: "d" },
  { id: "r180", label: "Rotate 180", def: "a" },
  { id: "place", label: "Place", def: "c" },
  { id: "retry", label: "Retry", def: "r" },
  { id: "forfeit", label: "Forfeit", def: "Escape" },
];

export const normalize = (k) => (typeof k === "string" && k.length === 1 ? k.toLowerCase() : k);
/** A mouse button as a binding name (MouseEvent.button: 0 left, 1 middle, 2 right, 3 back, 4 forward). */
export const mouseName = (button) => ["Mouse1", "Mouse3", "Mouse2", "Mouse4", "Mouse5"][button] || `Mouse${button + 1}`;
const MOUSE_LABELS = { Mouse1: "LEFT CLICK", Mouse2: "RIGHT CLICK", Mouse3: "MIDDLE CLICK", Mouse4: "MOUSE BACK", Mouse5: "MOUSE FWD" };
export const mouseLabel = (k) => MOUSE_LABELS[k] || null;
const defaults = () => Object.fromEntries(SPRINT_ACTIONS.map((a) => [a.id, a.def]));

function load() {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) || "null");
    if (!saved || typeof saved !== "object") return defaults();
    const out = defaults();
    for (const a of SPRINT_ACTIONS) if (typeof saved[a.id] === "string") out[a.id] = saved[a.id];
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
export function resetSprintKeys() { keys = defaults(); save(); }
/** The action a key press or mouse button means, or null. */
export function sprintActionFor(key) {
  const k = normalize(key);
  return SPRINT_ACTIONS.find((a) => keys[a.id] === k)?.id || null;
}
