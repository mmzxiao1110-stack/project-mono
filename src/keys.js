/**
 * Keyboard controls.
 *
 * One binding per action, stored on this device. Keys are stored as
 * KeyboardEvent.key, lowercased for single characters, so what Settings
 * shows ("W", "Enter") is what the player presses on their own layout.
 *
 * You play one piece per turn, so there's a single "pick up" key.
 */

export const ACTIONS = [
  { id: "slot1", label: "Pick up piece", def: "1" },
  { id: "up", label: "Move up", def: "w" },
  { id: "left", label: "Move left", def: "a" },
  { id: "down", label: "Move down", def: "s" },
  { id: "right", label: "Move right", def: "d" },
  { id: "ccw", label: "Rotate left", def: "q" },
  { id: "cw", label: "Rotate right", def: "e" },
  { id: "commit", label: "Lock in", def: "Enter" },
  { id: "discard", label: "Pass", def: "x" },
];

// Keys that can't be bound: ones the browser or the rebinding screen itself needs.
const RESERVED = new Set(["Escape", "Tab", "Shift", "Control", "Alt", "Meta", "CapsLock"]);

const KEY = "tb:keys";
const defaults = () => Object.fromEntries(ACTIONS.map((a) => [a.id, a.def]));

/** "W" and "w" are the same key; "Enter" stays "Enter". */
export const normalize = (k) => (typeof k === "string" && k.length === 1 ? k.toLowerCase() : k);

function load() {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) || "null");
    if (!saved || typeof saved !== "object") return defaults();
    // Keep only actions that still exist (older saves had four block slots).
    const known = Object.fromEntries(ACTIONS.filter((a) => saved[a.id]).map((a) => [a.id, saved[a.id]]));
    return { ...defaults(), ...known };
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
