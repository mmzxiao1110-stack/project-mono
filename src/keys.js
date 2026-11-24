/**
 * Keyboard controls.
 *
 * One binding per action, stored on this device. Keys are stored as
 * KeyboardEvent.key, lowercased for single characters, so what Settings
 * shows ("W", "Enter") is what the player presses on their own layout.
 *
 * ← and → always cycle through the hand. They're fixed, not rebindable, so
 * there's always a way to pick a block even after a bad rebind.
 */

export const ACTIONS = [
  { id: "slot1", label: "Block 1", def: "1" },
  { id: "slot2", label: "Block 2", def: "2" },
  { id: "slot3", label: "Block 3", def: "3" },
  { id: "slot4", label: "Block 4", def: "4" },
  { id: "up", label: "Move up", def: "w" },
  { id: "left", label: "Move left", def: "a" },
  { id: "down", label: "Move down", def: "s" },
  { id: "right", label: "Move right", def: "d" },
  { id: "ccw", label: "Rotate left", def: "q" },
  { id: "cw", label: "Rotate right", def: "e" },
  { id: "commit", label: "Lock in", def: "Enter" },
  { id: "discard", label: "Drop block", def: "x" },
];

export const FIXED = { ArrowLeft: "prev", ArrowRight: "next" };
// Keys that can't be bound: the fixed ones, and keys the browser or the
// rebinding screen itself needs.
const RESERVED = new Set(["ArrowLeft", "ArrowRight", "Escape", "Tab", "Shift", "Control", "Alt", "Meta", "CapsLock"]);

const KEY = "tb:keys";
const defaults = () => Object.fromEntries(ACTIONS.map((a) => [a.id, a.def]));

/** "W" and "w" are the same key; "Enter" stays "Enter". */
export const normalize = (k) => (typeof k === "string" && k.length === 1 ? k.toLowerCase() : k);

function load() {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) || "null");
    return saved && typeof saved === "object" ? { ...defaults(), ...saved } : defaults();
  } catch {
    return defaults();
  }
}

let map = load();
const listeners = new Set();

function commit(next) {
  map = next;
  try { localStorage.setItem(KEY, JSON.stringify(map)); } catch { /* private mode: keep it for this session */ }
  listeners.forEach((fn) => fn());
}

export const getKeys = () => map;
export const subscribeKeys = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
export const canBind = (key) => !RESERVED.has(key);

/**
 * Binds `key` to `action`. If another action already had that key, the two
 * swap, so nothing is ever left bound twice.
 */
export function setKey(action, rawKey) {
  const key = normalize(rawKey);
  if (!canBind(key)) return false;
  const next = { ...map };
  const clash = Object.keys(next).find((a) => a !== action && next[a] === key);
  if (clash) next[clash] = map[action];
  next[action] = key;
  commit(next);
  return true;
}

export const resetKeys = () => commit(defaults());

/** The action a key press means, or null. */
export function actionFor(rawKey) {
  if (FIXED[rawKey]) return FIXED[rawKey];
  const key = normalize(rawKey);
  for (const a of ACTIONS) if (map[a.id] === key) return a.id;
  return null;
}

/** How a key is written in the UI. */
export function keyLabel(k) {
  if (!k) return "—";
  if (k === " ") return "Space";
  const arrows = { ArrowUp: "↑", ArrowDown: "↓", ArrowLeft: "←", ArrowRight: "→" };
  if (arrows[k]) return arrows[k];
  return k.length === 1 ? k.toUpperCase() : k;
}
