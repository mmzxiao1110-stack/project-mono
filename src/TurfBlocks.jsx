import React, { useState, useEffect, useMemo, useCallback, useRef, useSyncExternalStore, createContext, useContext, useLayoutEffect } from "react";
import {
  RotateCw, Check, SkipForward, ChevronLeft, Settings2, X,
  BarChart3, Wifi, WifiOff, UserRound, LogOut,
  Palette, Lock, MailCheck, ShieldAlert, BookOpen, ChevronRight,
} from "./pixelIcons.jsx";

/* The rules live in one place and the server imports the same file. */
import {
  COLS, ROWS, TURNS, SLOTS, BLOCKS, DEFAULT_LOADOUT, isCentre,
  sizeOf, key, rotateN, boundsOf, absCells, initialBoard, isLegal,
  hasAnyMove, resolveTurn, scoreOf, newDeck, advanceDeck, currentPiece, currentPass, upcoming, QUEUE_SHOWN,
} from "../shared/engine.js";
import { aiPickMove } from "../shared/ai.js";
import {
  RANKS, PLACEMENT_GAMES, rankIndexFor, rankMin, rankProgress,
} from "../shared/glicko.js";
import { net, SERVER_URL, IS_SECURE, GOOGLE_CLIENT_ID } from "./net.js";
import { FX } from "./tuning.js";
import { RULES } from "../shared/rules.js";
import {
  PRESETS, INKS, STROKES, GRID_GAPS,
  loadTheme, saveTheme, applyPreset, editTheme, themeVars,
} from "./theme.js";
import { ACTIONS, getKeys, subscribeKeys, setKey, resetKeys, actionFor, keyLabel, canBind } from "./keys.js";

/* ============================================================
   PRESENTATION CONSTANTS
   ============================================================ */
const PHONE_W = 440;
const REVEAL_MS = 1100;
const AI_THINK_MS = 550;
const TOUCH_LIFT = 2;
// Google sign-in is built and verified server-side, but parked until launch.
const SHOW_GOOGLE = false;

const GOLD = "var(--tb-special)";
const GOLD_SOFT = "color-mix(in srgb, var(--tb-special) 40%, transparent)";

// Chrome is themeable, so it goes through CSS custom properties: one style
// block changes every surface without re-rendering the tree.
const UI = {
  ground: "var(--tb-ground)",
  panel: "var(--tb-panel)",
  line: "var(--tb-line)",
  cell: "var(--tb-cell)",
  text: "var(--tb-text)",
  dim: "var(--tb-dim)",
  bad: "var(--tb-bad)",
  good: "var(--tb-good)",
  badSoft: "color-mix(in srgb, var(--tb-bad) 34%, transparent)",
  badFaint: "color-mix(in srgb, var(--tb-bad) 10%, transparent)",
};

/* ------------------------------------------------------------
   Pixel art. One pixel size for the whole screen: --p in CSS, usePx()
   in JS, set by the app from the screen size. Every frame, fill, tile,
   icon and letter is made of whole pixels of that size.

   sk(color)      a panel or button: one-pixel edge in `color`, stepped
                  corners, a lit top-left and shaded bottom-right
   skFill(color)  the pressed / primary state: filled with `color`
   ------------------------------------------------------------ */
const PX = "var(--p)";
const px = (n) => `calc(var(--p) * ${n})`;
const PxContext = createContext(3);
const usePx = () => useContext(PxContext);
/**
 * Menus and popups are laid out once at the phone pixel size (BASE_P) and
 * zoomed by exactly P / BASE_P on bigger screens — so a menu at 3 px pixels
 * is the phone menu at 1.5×, every pixel still exactly P on screen.
 */
const BASE_P = 2;
function Scaled({ className = "", style, children }) {
  return (
    <PxContext.Provider value={BASE_P}>
      <div className={`tb-scale ${className}`} style={style}>{children}</div>
    </PxContext.Provider>
  );
}

/** Stepped corners, one pixel per step. */
const CLIP = `polygon(0 ${px(2)}, ${PX} ${px(2)}, ${PX} ${PX}, ${px(2)} ${PX}, ${px(2)} 0, calc(100% - ${px(2)}) 0, calc(100% - ${px(2)}) ${PX}, calc(100% - ${PX}) ${PX}, calc(100% - ${PX}) ${px(2)}, 100% ${px(2)}, 100% calc(100% - ${px(2)}), calc(100% - ${PX}) calc(100% - ${px(2)}), calc(100% - ${PX}) calc(100% - ${PX}), calc(100% - ${px(2)}) calc(100% - ${PX}), calc(100% - ${px(2)}) 100%, ${px(2)} 100%, ${px(2)} calc(100% - ${PX}), ${PX} calc(100% - ${PX}), ${PX} calc(100% - ${px(2)}), 0 calc(100% - ${px(2)}))`;
// Pixel-rounded corners for small squares: one pixel off each corner.
const CLIP1 = `polygon(${PX} 0, calc(100% - ${PX}) 0, calc(100% - ${PX}) ${PX}, 100% ${PX}, 100% calc(100% - ${PX}), calc(100% - ${PX}) calc(100% - ${PX}), calc(100% - ${PX}) 100%, ${PX} 100%, ${PX} calc(100% - ${PX}), 0 calc(100% - ${PX}), 0 ${PX}, ${PX} ${PX})`;
/** A clear glass pane: faintly frosted, lit along the top and left, shaded below. */
const GLASS = {
  background: "color-mix(in srgb, var(--tb-text) 8%, transparent)",
  boxShadow: `inset 0 ${PX} 0 color-mix(in srgb, var(--tb-text) 24%, transparent), inset ${PX} 0 0 color-mix(in srgb, var(--tb-text) 12%, transparent), inset 0 calc(var(--p) * -1) 0 rgba(0,0,0,.28), inset calc(var(--p) * -1) 0 0 rgba(0,0,0,.14)`,
};
/** The glint on a pane: a short streak near the top-left corner, in whole pixels. */
function glassShine(art) {
  const l = (x, y, w, h, a) => `linear-gradient(rgba(255,255,255,${a}), rgba(255,255,255,${a})) calc(var(--p) * ${x}) calc(var(--p) * ${y}) / calc(var(--p) * ${w}) calc(var(--p) * ${h}) no-repeat`;
  if (art >= 9) return [l(2, 2, 3, 1, 0.45), l(2, 3, 1, 1, 0.35), l(art - 3, art - 3, 1, 1, 0.12)].join(", ");
  if (art >= 6) return [l(1, 1, 2, 1, 0.4), l(1, 2, 1, 1, 0.3)].join(", ");
  return l(1, 1, 1, 1, 0.35);
}
const BEVEL = `inset ${PX} ${PX} 0 var(--tb-edge), inset calc(var(--p) * -1) calc(var(--p) * -1) 0 var(--tb-shade)`;

function sk(color = UI.line) {
  return {
    borderWidth: PX, borderStyle: "solid", borderRadius: 0, borderImage: "none",
    borderColor: color,
    clipPath: CLIP,
    boxShadow: BEVEL,
  };
}
function skFill(color = UI.text, { dense = false } = {}) {
  return {
    ...sk(color),
    background: `color-mix(in srgb, ${color} ${dense ? 90 : 34}%, var(--tb-panel-solid))`,
    boxShadow: `inset 0 ${PX} 0 color-mix(in srgb, ${color} 60%, white), inset 0 calc(var(--p) * -1) 0 color-mix(in srgb, ${color} 55%, black)`,
  };
}
/** A dotted pixel rule under (or over) a block: one pixel on, one off. */
const RULE_BELOW = {
  backgroundImage: "linear-gradient(90deg, var(--tb-edge-strong) 50%, transparent 50%)",
  backgroundRepeat: "repeat-x", backgroundPosition: "bottom", backgroundSize: `${px(2)} ${PX}`,
};
const RULE_ABOVE = { ...RULE_BELOW, backgroundPosition: "top" };

/** Tile shades for a colour: the outer ring, inner ring and highlight of a block. */
const shadeCache = new Map();
function tileShades(color) {
  const hit = shadeCache.get(color);
  if (hit) return hit;
  let out;
  const h = /^#([0-9a-f]{6})$/i.exec(color || "");
  if (h) {
    const n = parseInt(h[1], 16), r = n >> 16, g = (n >> 8) & 255, b = n & 255;
    const hex = (a, b2, c) => "#" + [a, b2, c].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("");
    out = {
      base: color,
      dark: hex(r * 0.74, g * 0.71, b * 0.72),
      light: hex(r + (255 - r) * 0.22 + 18, g * 1.15 + 6, b * 1.06 + 4),
      hi: hex(r + (255 - r) * 0.6, g + (255 - g) * 0.55, b + (255 - b) * 0.55),
    };
  } else {
    out = {
      base: color,
      dark: `color-mix(in srgb, ${color} 72%, black)`,
      light: `color-mix(in srgb, ${color} 78%, white)`,
      hi: `color-mix(in srgb, ${color} 42%, white)`,
    };
  }
  shadeCache.set(color, out);
  return out;
}

// AI opponents, weakest first. The names are placeholders: replace each
// string with the opponent's real name. Adding or removing entries changes
// how many levels there are; the AI's strength scales to fit.
const LEVELS = [
  "1", "2", "3", "4", "5", "6", "7", "8", "9", "10",
  "11", "12", "13", "14", "15", "16", "17", "18", "19", "20",
];
const DEFAULT_LEVEL = 7;

function levelBlurb(n) {
  const t = (n - 1) / (LEVELS.length - 1);
  if (t <= 0.15) return "Drops blocks almost anywhere they fit.";
  if (t <= 0.35) return "Always grabs the biggest block available.";
  if (t <= 0.55) return "Protects the open space it needs to grow.";
  if (t <= 0.8) return "Pushes hard toward your half of the board.";
  return "Expands, advances, and cuts off your room to build.";
}

const fmtTime = (s) => {
  if (!s) return "0m";
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h ? `${h}h ${m}m` : `${m}m`;
};

/* ============================================================
   LOCAL STORAGE — identity and preferences only.
   Ranked stats belong to the server.
   ============================================================ */
const _mem = {};
const store = {
  get(k) {
    try { const v = localStorage.getItem(k); return v === null ? _mem[k] ?? null : v; }
    catch (e) { return _mem[k] ?? null; }
  },
  set(k, v) { _mem[k] = v; try { localStorage.setItem(k, v); } catch (e) {} },
};


const loadLoadout = () => {
  try {
    const raw = store.get("tb:loadout");
    const arr = raw ? JSON.parse(raw) : null;
    return Array.isArray(arr) && arr.length === SLOTS ? arr : [...DEFAULT_LOADOUT];
  } catch (e) { return [...DEFAULT_LOADOUT]; }
};
const saveLoadout = (l) => store.set("tb:loadout", JSON.stringify(l));

/* ============================================================
   AI — in shared/ai.js, so test tools play the same opponent.
   ============================================================ */


/* ============================================================
   NET SUBSCRIPTIONS
   useSyncExternalStore, not useState+useEffect: a message that lands between
   a component's first render and its effect firing would otherwise be lost —
   which is exactly what left one player staring at "DEALING".
   ============================================================ */
const subs = {
  match: (cb) => net.on("match", cb),
  status: (cb) => net.on("status", cb),
  profile: (cb) => net.on("profile", cb),
  search: (cb) => net.on("search", cb),
  found: (cb) => net.on("found", cb),
  auth: (cb) => net.on("auth", cb),
  online: (cb) => net.on("online", cb),
  notice: (cb) => net.on("notice", cb),
};
const useKeys = () => useSyncExternalStore(subscribeKeys, getKeys);
// Key hints only make sense where there's a keyboard and a mouse, not on phones.
const HAS_KEYBOARD = typeof window !== "undefined" && !!window.matchMedia?.("(hover: hover) and (pointer: fine)").matches;
const useOnline = () => useSyncExternalStore(subs.online, () => net.online);
const useNotice = () => useSyncExternalStore(subs.notice, () => net.notice);
const useMatch = () => useSyncExternalStore(subs.match, () => net.match);
const useStatus = () => useSyncExternalStore(subs.status, () => net.status);
const useProfile = () => useSyncExternalStore(subs.profile, () => net.profile);
const useSearch = () => useSyncExternalStore(subs.search, () => net.search);
const useFound = () => useSyncExternalStore(subs.found, () => net.found);
// Subscribes to the revision counter, returns the state. Any auth event —
// including busy -> error, which leaves `auth` unchanged — re-renders.
function useAuth() {
  useSyncExternalStore(subs.auth, () => net.authRev);
  return net.auth;
}

/* ============================================================
   HOOKS
   ============================================================ */
function useSize() {
  // Callback ref, not useRef: the measured element may mount later than this
  // hook does, and a plain ref gives the effect nothing to observe.
  const [node, setNode] = useState(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  useEffect(() => {
    if (!node) return;
    const read = () => setSize({ w: node.clientWidth, h: node.clientHeight });
    read();
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", read);
      return () => window.removeEventListener("resize", read);
    }
    const ro = new ResizeObserver(read);
    ro.observe(node);
    return () => ro.disconnect();
  }, [node]);
  return [setNode, size];
}

/**
 * Everything about picking a block and getting it onto the grid. Shared by
 * the local game and the networked one. Two ways in, by input device:
 *
 *   touch  press a card and drag; the piece rides two rows above the finger
 *          so you can see where it lands, and releasing drops it there.
 *   mouse  the piece sticks to the cursor ("holding") — at the start of each
 *          turn, or after clicking its card. Move, rotate with Q/E, then click
 *          the board or LOCK IN. Click the card again, right-click or Esc to put it back.
 */
function usePlacement({ board, owner, hand, enabled, flip = false }) {
  const [sel, setSel] = useState({ handIdx: null, rot: 0, pos: null });
  // Pointer position while a piece is in hand. The piece follows this
  // exactly; only its shadow snaps to the grid. mode: "touch" | "hold".
  const [drag, setDrag] = useState(null);
  const dragging = !!drag && drag.mode === "touch";
  const holding = !!drag && drag.mode === "hold";
  const boardRef = useRef(null);
  const dragRef = useRef({ cells: null, lift: 0, x: 0, y: 0, mode: null });
  const holdCleanup = useRef(null);
  // Where the mouse last was, so a number key can drop a block straight
  // under it. Touch never sets this, so phones keep their own behaviour.
  const lastMouse = useRef(null);
  useEffect(() => {
    const onMove = (e) => { if (e.pointerType === "mouse") lastMouse.current = { x: e.clientX, y: e.clientY }; };
    window.addEventListener("pointermove", onMove);
    return () => window.removeEventListener("pointermove", onMove);
  }, []);

  const endHold = useCallback(() => {
    holdCleanup.current?.();
    holdCleanup.current = null;
  }, []);

  const reset = useCallback(() => {
    endHold();
    setSel({ handIdx: null, rot: 0, pos: null });
    setDrag(null);
  }, [endHold]);

  const rotated = useMemo(() => {
    if (sel.handIdx === null) return null;
    const id = hand[sel.handIdx];
    return id === undefined ? null : rotateN(BLOCKS[id].cells, sel.rot);
  }, [sel.handIdx, sel.rot, hand]);

  const ghost = useMemo(() => (rotated && sel.pos ? absCells(rotated, sel.pos) : null), [rotated, sel.pos]);
  const ghostLegal = useMemo(() => (ghost && board ? isLegal(board, ghost, owner) : false), [ghost, board, owner]);
  const ghostKeys = useMemo(
    () => new Set((enabled && ghost ? ghost : []).map(([r, c]) => key(r, c))),
    [ghost, enabled]
  );

  /**
   * Pointer → piece position and grid shadow. While holding with a mouse the
   * shadow disappears once the cursor leaves the board; a touch drag clamps
   * to the edge instead, because a finger often overhangs it.
   */
  const updateFromPoint = useCallback((clientX, clientY) => {
    const el = boardRef.current;
    const d = dragRef.current;
    if (!el || !d.cells) return;
    d.x = clientX; d.y = clientY;
    setDrag({ x: clientX, y: clientY, lift: d.lift, mode: d.mode });
    const rect = el.getBoundingClientRect();
    const fx = (clientX - rect.left) / rect.width, fy = (clientY - rect.top) / rect.height;
    if (d.mode === "hold") {
      // Off the board the shadow stays where it was, so you can carry the
      // piece over to the buttons and still lock it in.
      const mx = 0.5 / COLS, my = 0.5 / ROWS;
      if (fx < -mx || fx > 1 + mx || fy < -my || fy > 1 + my) return;
    }
    const sc = Math.floor(fx * COLS);
    const sr = Math.floor(fy * ROWS);
    // Screen coords -> board coords. When flipped, up-the-screen is +row.
    const lift = d.lift;
    const col = flip ? COLS - 1 - sc : sc;
    const row = (flip ? ROWS - 1 - sr : sr) + (flip ? lift : -lift);
    const { h, w } = boundsOf(d.cells);
    setSel((s) => ({
      ...s,
      pos: [
        Math.max(0, Math.min(ROWS - h, row - Math.floor(h / 2))),
        Math.max(0, Math.min(COLS - w, col - Math.floor(w / 2))),
      ],
    }));
  }, [flip]);

  // Rotating or swapping blocks while holding: re-fit the shadow under the cursor.
  useEffect(() => {
    if (!holding || !rotated) return;
    dragRef.current.cells = rotated;
    updateFromPoint(dragRef.current.x, dragRef.current.y);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rotated, holding]);

  // Nothing to hold once it's no longer your turn to act.
  useEffect(() => { if (!enabled && holdCleanup.current) reset(); }, [enabled, reset]);
  useEffect(() => endHold, [endHold]);

  const beginDrag = useCallback((e, cells) => {
    endHold();
    dragRef.current = { cells, lift: e.pointerType === "touch" ? TOUCH_LIFT : 0, x: e.clientX, y: e.clientY, mode: "touch" };
    const onMove = (ev) => { ev.preventDefault(); updateFromPoint(ev.clientX, ev.clientY); };
    // Pointer events can't stop the browser reading a finger drag as a scroll.
    // If it does, a fast drag leaves a "fling" running after release, and the
    // next tap — LOCK IN, usually — only stops the fling instead of clicking.
    // Cancelling the touch moves themselves keeps the drag out of the
    // browser's gesture handling entirely.
    const noScroll = (ev) => { if (ev.cancelable) ev.preventDefault(); };
    const onUp = () => {
      // Release is the moment the piece drops onto its shadow.
      setDrag(null);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      window.removeEventListener("touchmove", noScroll);
    };
    window.addEventListener("pointermove", onMove, { passive: false });
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    window.addEventListener("touchmove", noScroll, { passive: false });
    updateFromPoint(e.clientX, e.clientY);
  }, [updateFromPoint, endHold]);

  /** Mouse: the piece sticks to the cursor until placed or put back. */
  const beginHold = useCallback((e, cells) => {
    endHold();
    dragRef.current = { cells, lift: 0, x: e.clientX, y: e.clientY, mode: "hold" };
    const onMove = (ev) => updateFromPoint(ev.clientX, ev.clientY);
    const onMenu = (ev) => { ev.preventDefault(); reset(); }; // right-click puts it back
    window.addEventListener("pointermove", onMove);
    window.addEventListener("contextmenu", onMenu);
    holdCleanup.current = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("contextmenu", onMenu);
      dragRef.current.mode = null;
      setDrag(null);
    };
    updateFromPoint(e.clientX, e.clientY);
  }, [updateFromPoint, endHold, reset]);

  const onCardPointerDown = (e, i) => {
    if (!enabled || e.button > 0) return;
    e.preventDefault();
    if (e.pointerType === "mouse") {
      // Clicking the card you're already holding puts it back.
      if (holding && sel.handIdx === i) return reset();
      setSel({ handIdx: i, rot: 0, pos: null });
      beginHold(e, BLOCKS[hand[i]].cells);
      return;
    }
    setSel({ handIdx: i, rot: 0, pos: null });
    beginDrag(e, BLOCKS[hand[i]].cells);
  };

  /**
   * Board press. While holding, a left click means "place it here" and is
   * handled by the game (it returns true). Otherwise it picks the selected
   * piece back up: held for a mouse, dragged for a finger.
   */
  const onBoardPointerDown = (e, place) => {
    if (!enabled) return;
    if (holding) {
      e.preventDefault();
      if (e.button === 0) place?.();
      return;
    }
    if (!rotated || e.button > 0) return;
    e.preventDefault();
    if (e.pointerType === "mouse") beginHold(e, rotated);
    else beginDrag(e, rotated);
  };

  /** dir 1 = clockwise, -1 = counter-clockwise. */
  const rotate = useCallback((dir = 1) => {
    const step = dir === -1 ? -1 : 1;
    setSel((s) => {
      if (s.handIdx === null) return s;
      const id = hand[s.handIdx];
      if (id === undefined) return s;
      const { h, w } = boundsOf(rotateN(BLOCKS[id].cells, s.rot + step));
      return {
        ...s,
        rot: s.rot + step,
        pos: s.pos ? [Math.max(0, Math.min(ROWS - h, s.pos[0])), Math.max(0, Math.min(COLS - w, s.pos[1]))] : null,
      };
    });
  }, [hand]);

  /**
   * Where a block lands when picked by keyboard: the legal spot nearest the
   * previous shadow, or nearest your home row if there wasn't one. Keyboard
   * players start on a valid square instead of hunting for one.
   */
  const spawnPos = useCallback((blockId, near) => {
    const cells = BLOCKS[blockId].cells;
    const { h, w } = boundsOf(cells);
    const target = near || [owner === "A" ? ROWS - 1 : 0, Math.floor(COLS / 2) - 1];
    let best = null, bestD = Infinity;
    if (board) {
      for (let r = 0; r <= ROWS - h; r++)
        for (let c = 0; c <= COLS - w; c++) {
          if (!isLegal(board, absCells(cells, [r, c]), owner)) continue;
          const d = Math.hypot(r + h / 2 - target[0], c + w / 2 - target[1]);
          if (d < bestD) { bestD = d; best = [r, c]; }
        }
    }
    return best || [Math.max(0, Math.min(ROWS - h, target[0])), Math.max(0, Math.min(COLS - w, target[1]))];
  }, [board, owner]);

  /** Pick hand slot `i` from the keyboard. */
  const select = useCallback((i) => {
    if (!enabled || hand[i] === undefined) return;
    if (holding) {
      // Swap the block under the cursor; the effect above re-fits the shadow.
      setSel((s) => (s.handIdx === i ? s : { ...s, handIdx: i, rot: 0 }));
      return;
    }
    if (lastMouse.current) {
      // Mouse players: the block appears under the cursor at once, held,
      // ready to move, rotate, swap or place — no extra click.
      setSel({ handIdx: i, rot: 0, pos: null });
      beginHold({ clientX: lastMouse.current.x, clientY: lastMouse.current.y }, BLOCKS[hand[i]].cells);
      return;
    }
    // Re-picking the selected block keeps it where it is, unless it has no position yet.
    setSel((s) => (s.handIdx === i && s.pos ? s : { handIdx: i, rot: 0, pos: spawnPos(hand[i], s.pos) }));
  }, [enabled, hand, spawnPos, holding, beginHold]);

  /**
   * Put the selected block on the nearest legal square without touching the
   * selection — for WASD when the held block is off the board.
   */
  const spawnHere = useCallback(() => {
    setSel((s) => (s.handIdx === null || hand[s.handIdx] === undefined ? s : { ...s, pos: spawnPos(hand[s.handIdx], s.pos) }));
  }, [hand, spawnPos]);

  /** ← / →: step to the previous or next block in hand, wrapping. */
  const cycle = useCallback((dir) => {
    if (!enabled) return;
    const filled = hand.map((id, i) => (id === undefined ? -1 : i)).filter((i) => i >= 0);
    if (!filled.length) return;
    const at = filled.indexOf(sel.handIdx);
    const next = at < 0 ? (dir > 0 ? filled[0] : filled[filled.length - 1]) : filled[(at + dir + filled.length) % filled.length];
    select(next);
  }, [enabled, hand, sel.handIdx, select]);

  const nudge = useCallback((dr, dc) => {
    setSel((s) => {
      if (!s.pos || s.handIdx === null) return s;
      const id = hand[s.handIdx];
      if (id === undefined) return s;
      const { h, w } = boundsOf(rotateN(BLOCKS[id].cells, s.rot));
      return {
        ...s,
        pos: [
          Math.max(0, Math.min(ROWS - h, s.pos[0] + dr)),
          Math.max(0, Math.min(COLS - w, s.pos[1] + dc)),
        ],
      };
    });
  }, [hand]);

  return { sel, setSel, reset, rotated, ghost, ghostLegal, ghostKeys, dragging, holding, drag, boardRef, onBoardPointerDown, onCardPointerDown, rotate, nudge, select, cycle, flip, spawnHere };
}

/**
 * Keyboard play, shared by the local and ranked games. Movement is relative
 * to the screen, so on a board rotated for seat B, "up" still means up.
 */
function useGameKeys(pl, { enabled, onCommit, onDiscard }) {
  // Handlers change every render; the listener reads the latest through a ref
  // instead of re-binding on every keystroke.
  const ref = useRef(null);
  useLayoutEffect(() => { ref.current = { pl, enabled, onCommit, onDiscard }; });

  useEffect(() => {
    const onKey = (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      if (!ref.current) return;
      const { pl, enabled, onCommit, onDiscard } = ref.current;
      if (e.key === "Escape" && pl.holding) { e.preventDefault(); return pl.reset(); }
      const action = actionFor(e.key);
      if (!action) return;
      e.preventDefault();
      if (!enabled || pl.dragging) return;

      if (action === "slot1") return pl.select(0);
      // Passing is always available, picked up or not.
      if (action === "discard") return onDiscard();
      if (pl.sel.handIdx === null) return;

      const f = pl.flip ? -1 : 1;
      const move = { up: [-f, 0], down: [f, 0], left: [0, -f], right: [0, f] }[action];
      if (move) {
        // No square yet (picked by tapping its card, or held off the board):
        // start it on the nearest legal one.
        if (!pl.sel.pos) return pl.spawnHere();
        return pl.nudge(move[0], move[1]);
      }
      if (action === "cw") return pl.rotate(1);
      if (action === "ccw") return pl.rotate(-1);
      if (action === "commit") return onCommit();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}

/* ============================================================
   PIXEL SKY — the animated background behind every screen
   ============================================================ */
/**
 * `paused` counts open popups (their frosted glass would otherwise re-blur
 * a moving picture every frame); `slow` is set during matches, when the
 * sky should stay out of the way.
 */
const sky = { paused: 0, slow: false };

/**
 * A night sky in the style of Celeste's later chapters, drawn pixel by
 * pixel at the screen's pixel size: colour bands from deep top to warmer
 * horizon with ordered dithering between them, two dithered nebulae in the
 * theme's colours drifting slowly, pastel stars twinkling and a little wind.
 * About 10 fps, half that in a match, paused while hidden or under a popup.
 */
// Pastel star colours, shared by the sky and the dream-block board.
const rgbOf = (hex) => { const n = parseInt(String(hex).replace("#", ""), 16); return [n >> 16, (n >> 8) & 255, n & 255]; };
const mixRgb = (a, b, t) => [0, 1, 2].map((i) => Math.round(a[i] + (b[i] - a[i]) * t));
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => (v + 0.5) / 16);

/** The sky is drawn in pixels this many times the UI pixel, so it reads soft and far away. */
const SKY_SCALE = 2;

/**
 * The backdrop: deep water in space. Dithered bands of colour that ripple
 * like water, two slow glows drifting through, and a few bubbles rising.
 * Drawn at low resolution and scaled up with hard edges.
 */
function PixelSky({ theme }) {
  const ref = useRef(null);
  const P = usePx() * SKY_SCALE;
  const { ground, you, special, panel, motion } = theme;

  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    const ctx = cv.getContext("2d", { alpha: false });
    let W = 1, H = 1, img = null;
    const size = () => {
      W = Math.max(1, Math.ceil(window.innerWidth / P));
      H = Math.max(1, Math.ceil(window.innerHeight / P));
      cv.width = W; cv.height = H;
      cv.style.width = `${W * P}px`; cv.style.height = `${H * P}px`;
      img = ctx.createImageData(W, H);
    };
    size();
    window.addEventListener("resize", size);

    // Bands, top to bottom: deep dark down to a lavender haze.
    const g = rgbOf(ground), pa = rgbOf(panel), yo = rgbOf(you), sp = rgbOf(special);
    const BANDS = 9;
    const band = Array.from({ length: BANDS }, (_, i) => {
      const t = i / (BANDS - 1);
      return t < 0.55 ? mixRgb(mixRgb(g, [0, 0, 0], 0.3), pa, t / 0.55) : mixRgb(pa, mixRgb(pa, yo, 0.45), (t - 0.55) / 0.45);
    });
    const glows = [
      { c: yo, x: 0.28, y: 0.35, r: 0.42, vx: 0.004, vy: 0.002 },
      { c: sp, x: 0.72, y: 0.65, r: 0.38, vx: -0.003, vy: -0.0025 },
    ];
    const bubbles = Array.from({ length: 9 }, () => ({
      x: Math.random(), y: Math.random(), v: 0.012 + Math.random() * 0.02, p: Math.random() * 6.28, big: Math.random() < 0.4,
    }));
    const cream = rgbOf("#F2E8D2");

    const put = (x, y, c, a) => {
      if (x < 0 || y < 0 || x >= W || y >= H) return;
      const o = (y * W + x) * 4, d = img.data;
      d[o] += (c[0] - d[o]) * a; d[o + 1] += (c[1] - d[o + 1]) * a; d[o + 2] += (c[2] - d[o + 2]) * a;
    };

    const draw = (t) => {
      const d = img.data;
      const s = t * 0.001;
      // Per-column wave, worked out once a frame.
      const wave = new Float32Array(W);
      for (let x = 0; x < W; x++) wave[x] = Math.sin(x * 0.16 + s * 1.3) * 0.32 + Math.sin(x * 0.05 - s * 0.7) * 0.28;
      for (let y = 0; y < H; y++) {
        const fy0 = (y / Math.max(1, H - 1)) * (BANDS - 1);
        for (let x = 0; x < W; x++) {
          const th = BAYER[(y & 3) * 4 + (x & 3)];
          // The band edge rides the wave, with a dithered step between neighbours.
          const bi = Math.max(0, Math.min(BANDS - 1, Math.floor(fy0 + wave[x] + th)));
          let c = band[bi];
          for (const n of glows) {
            const dx = (x / W - n.x) * (W / Math.max(W, H)), dy = (y / H - n.y) * (H / Math.max(W, H));
            const v = 1 - Math.sqrt(dx * dx + dy * dy) / n.r;
            if (v <= 0) continue;
            const lvl = Math.floor(v * 3 + th);
            if (lvl > 0) c = mixRgb(c, n.c, Math.min(3, lvl) * 0.1);
          }
          const o = (y * W + x) * 4;
          d[o] = c[0]; d[o + 1] = c[1]; d[o + 2] = c[2]; d[o + 3] = 255;
        }
      }
      for (const b of bubbles) {
        const x = Math.floor(b.x * W + Math.sin(b.p + s * 1.6) * 1.5), y = Math.floor(b.y * H);
        if (b.big) {
          put(x, y - 1, cream, 0.22); put(x - 1, y, cream, 0.22); put(x + 1, y, cream, 0.16); put(x, y + 1, cream, 0.16);
          put(x - 1, y - 1, cream, 0.1);
        } else put(x, y, cream, 0.2);
      }
      ctx.putImageData(img, 0, 0);
    };

    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (!motion || reduced) { draw(0); return () => window.removeEventListener("resize", size); }

    let raf, last = 0;
    const loop = (t) => {
      raf = requestAnimationFrame(loop);
      const every = sky.slow ? 160 : 80;
      if (t - last < every || sky.paused > 0 || document.hidden) return;
      const dt = Math.min(0.3, (t - last) / 1000);
      last = t;
      for (const n of glows) {
        n.x += n.vx * dt; n.y += n.vy * dt;
        if (n.x < 0.1 || n.x > 0.9) n.vx *= -1;
        if (n.y < 0.15 || n.y > 0.85) n.vy *= -1;
      }
      for (const b of bubbles) {
        b.y -= b.v * dt;
        if (b.y < -0.02) { b.y = 1.02; b.x = Math.random(); }
      }
      draw(t);
    };
    raf = requestAnimationFrame(loop);
    return () => { cancelAnimationFrame(raf); window.removeEventListener("resize", size); };
  }, [ground, you, special, panel, motion, P]);

  return (
    <canvas ref={ref} aria-hidden="true"
      style={{ position: "fixed", left: 0, top: 0, imageRendering: "pixelated", zIndex: 0, pointerEvents: "none" }} />
  );
}

/* ============================================================
   SHARED VIEWS
   ============================================================ */
/** The stroke style the player picked in Theme. Read by every Ink. */
const InkStyle = createContext("hatch");

/** How an owner's squares are inked: players hatch in opposite directions. */
const inkOf = (owner) => (owner === "S" ? { stroke: "cross", dir: 1 } : { stroke: undefined, dir: owner === "B" ? -1 : 1 });

/**
 * One square of a piece, drawn as a pixel tile. At full size (8+ pixels)
 * it's the block from the art: a dark outer ring, a bright inner ring, a
 * three-pixel highlight in the top-left and a flat fill. Smaller tiles drop
 * rings until only the fill and one highlight pixel are left.
 *   stroke: pixel | flat | outline   — a claimed square (theme picks the default)
 *           ghost                    — landing guide
 *           slot                     — faint empty square
 *           pending                  — placed this turn, not yet revealed (dithered)
 * `size` is in screen px and should be a whole number of pixels (usePx).
 * `fluid` fills its box instead.
 */
function Ink({ size, color, stroke, fluid = false, className, style }) {
  const picked = useContext(InkStyle);
  const P = usePx();
  const kind = stroke || picked;
  const art = Math.max(1, Math.round(size / P)); // tile width in pixels
  const box = fluid ? "100%" : size;
  const base = { width: box, height: box, boxSizing: "border-box", pointerEvents: "none", flexShrink: 0 };
  const c = tileShades(color);
  const layer = (col, x, y, w, h) => `linear-gradient(${col}, ${col}) ${x} ${y} / ${w} ${h} no-repeat`;
  const rings = (n) => {
    // n = how many of: outer ring, inner ring, highlight the tile has room for
    const L = [];
    if (n >= 3) L.push(layer(c.hi, PX, PX, px(2), PX), layer(c.hi, PX, px(2), PX, PX));
    else if (n >= 1) L.push(layer(c.hi, n >= 2 ? PX : 0, n >= 2 ? PX : 0, PX, PX));
    if (n >= 2) {
      L.push(layer(c.base, px(2), px(2), `calc(100% - ${px(4)})`, `calc(100% - ${px(4)})`));
      L.push(layer(c.light, PX, PX, `calc(100% - ${px(2)})`, `calc(100% - ${px(2)})`));
      L.push(c.dark);
    } else {
      L.push(layer(c.base, 0, 0, `calc(100% - ${PX})`, `calc(100% - ${PX})`), c.dark);
    }
    return L.join(", ");
  };
  // Pixel dither (every other pixel): the pixel-art way to say "not quite there".
  const dither = (col) => `repeating-conic-gradient(${col} 0 25%, transparent 0 50%) 0 0 / ${px(2)} ${px(2)}`;

  let look;
  if (kind === "ghost") {
    look = { background: dither(`color-mix(in srgb, ${color} 55%, transparent)`), boxShadow: `inset 0 0 0 ${PX} ${color}` };
  } else if (kind === "slot") {
    look = { background: `color-mix(in srgb, ${color} 14%, transparent)`, boxShadow: `inset 0 0 0 ${PX} color-mix(in srgb, ${color} 40%, transparent)` };
  } else if (kind === "pending") {
    look = { background: `${dither("rgba(0,0,0,.45)")}, ${rings(art >= 8 ? 3 : art >= 5 ? 2 : 1)}` };
  } else if (kind === "outline") {
    look = { boxShadow: `inset 0 0 0 ${PX} ${c.light}, inset 0 0 0 ${px(2)} ${c.dark}`, background: `color-mix(in srgb, ${color} 14%, transparent)` };
  } else if (kind === "flat") {
    look = { background: `${layer(c.base, 0, 0, `calc(100% - ${PX})`, `calc(100% - ${PX})`)}, ${c.dark}` };
  } else {
    look = { background: rings(art >= 8 ? 3 : art >= 5 ? 2 : 1) };
  }
  return <div aria-hidden="true" className={className} style={{ ...base, ...look, ...style }} />;
}

/** A block's silhouette, drawn in ink. Used on cards, in the deck and the tutorial. */
function BlockGlyph({ blockId, box = 40, color, gap: _gap, glow = false }) {
  const P = usePx();
  const cells = BLOCKS[blockId].cells;
  const { h, w } = boundsOf(cells);
  const span = Math.max(h, w);
  // Whole pixels only: each square is k pixels with no gap — the tile rings separate them.
  const gap = 0;
  const size = Math.max(1, Math.floor(box / span / P)) * P;
  const filled = new Set(cells.map(([r, c]) => r * 100 + c));
  return (
    <div className={glow ? "tb-shine" : undefined} style={{
      display: "grid",
      gridTemplateColumns: `repeat(${w}, ${size}px)`,
      gridTemplateRows: `repeat(${h}, ${size}px)`,
      gap, pointerEvents: "none",
    }}>
      {Array.from({ length: h * w }).map((_, i) => (
        filled.has(Math.floor(i / w) * 100 + (i % w))
          ? <Ink key={i} size={size} color={color} />
          : <div key={i} />
      ))}
    </div>
  );
}

/** Squares being scribbled out after a collision. */
function VanishLayer({ contested = [], cleared = [], cell, gap, ink }) {
  const origin = contested.length ? contested : cleared.map(([r, c]) => [r, c]);
  const delayFor = (r, c) => {
    if (!origin.length) return 0;
    let best = Infinity;
    for (const [orr, oc] of origin) best = Math.min(best, Math.hypot(orr - r, oc - c));
    return Math.round(best * 42);
  };
  const items = [
    ...contested.map(([r, c]) => ({ r, c, owner: "S", color: GOLD, delay: delayFor(r, c) })),
    ...cleared.map(([r, c, owner]) => ({ r, c, owner, color: ink[owner] || ink.A, delay: delayFor(r, c) })),
  ];
  if (!items.length) return null;
  return (
    <div className="absolute inset-0 pointer-events-none" style={{ zIndex: 3 }}>
      {items.map((it, i) => (
        <div key={i} className="tb-vanish" style={{
          position: "absolute",
          left: it.c * (cell + gap),
          top: it.r * (cell + gap),
          width: cell, height: cell,
          animationDelay: `${it.delay}ms`,
        }}>
          <Ink size={cell} color={it.color} {...inkOf(it.owner)} seed={it.r * COLS + it.c} />
        </div>
      ))}
    </div>
  );
}

/** The piece in hand: follows the pointer exactly, never snaps. */
function FloatingPiece({ cells, cell, gap, color, x, y, lift, legal, flip = false, golden = false, dir = 1, faint = false }) {
  const { h, w } = boundsOf(cells);
  const filled = new Set(cells.map(([r, c]) => r * 100 + c));
  return (
    <div
      
      style={{
        position: "fixed",
        left: x,
        top: y - lift * (cell + gap),
        // Seat B plays on a board rotated 180°, so the piece in hand has to
        // match or an L lands mirrored from its own shadow.
        transform: `translate(-50%, -50%) rotate(${flip ? 180 : 0}deg) scale(${FX.board.floatScale})`,
        pointerEvents: "none",
        zIndex: 30,
        display: "grid",
        gridTemplateColumns: `repeat(${w}, ${cell}px)`,
        gridTemplateRows: `repeat(${h}, ${cell}px)`,
        gap,
        filter: `drop-shadow(${FX.board.floatShadow})`,
        opacity: faint ? 0.55 : legal ? 1 : 0.7,
      }}
    >
      {Array.from({ length: h * w }).map((_, i) => (
        filled.has(Math.floor(i / w) * 100 + (i % w))
          ? <Ink key={i} size={cell} color={color} />
          : <div key={i} />
      ))}
    </div>
  );
}

function BoardGrid({
  board, cell, ink, ghostKeys, ghostLegal, ghostInk, contestedKeys,
  boardRef, onPointerDown, theme, youSide = "A", ghostGolden = false,
  pendingKeys = null, pendingInk = null,
}) {
  const P = usePx();
  const gap = (theme.gap ?? 1) * P;
  const cb = theme.colorblind;
  const markSize = Math.max(7, Math.round(cell * 0.5));
  // Every square is its own little pane of glass with pixel-rounded corners.
  const art = Math.round(cell / P);
  const clip = art >= 9 ? CLIP : CLIP1;
  const shine = glassShine(art);

  return (
    <div
      ref={boardRef}
      onPointerDown={onPointerDown}
      style={{
        position: "relative",
        display: "grid",
        gridTemplateColumns: `repeat(${COLS}, ${cell}px)`,
        gridTemplateRows: `repeat(${ROWS}, ${cell}px)`,
        gap, touchAction: "none",
      }}
    >
      {board.map((row, r) =>
        row.map((v, c) => {
          const k = key(r, c);
          const isGhost = ghostKeys.has(k);
          const owner = isGhost ? youSide : v;
          const seed = r * COLS + c;

          // Colourblind marks: shape, not just hue. Yours are circles, theirs
          // are crosses, contested squares are diamonds.
          let mark = null;
          if (cb && owner && cell >= 11) {
            const glyph = owner === "S" ? "◆" : owner === youSide ? "○" : "✕";
            const base = owner === "S" ? ink.S : owner === youSide ? (isGhost ? ghostInk : ink[owner]) : ink[owner];
            mark = (
              <span style={{
                position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: markSize, lineHeight: 1, fontWeight: 700, color: base,
                textShadow: "0 0 3px var(--tb-ground), 0 0 3px var(--tb-ground), 0 0 1px var(--tb-ground)",
                pointerEvents: "none", userSelect: "none",
              }}>{glyph}</span>
            );
          }

          return (
            <div
              key={k}
              className={contestedKeys.has(k) ? "tb-contest" : v ? "tb-drop" : undefined}
              style={{
                position: "relative",
                clipPath: clip,
                // Empty: clear glass, the water showing through.
                ...(v ? null : GLASS),
              }}
            >
              {v && (
                <Ink size={cell} color={ink[v]} {...inkOf(v)} seed={seed}
                  style={{ opacity: isGhost ? 0.3 : 0.9 }} />
              )}
              {isCentre(r, c) && (
                // The centre: worth more, so it's marked whether or not it's taken.
                <>
                  <Ink size={cell} stroke="ghost" color={GOLD} seed={seed + 3}
                    style={{ position: "absolute", inset: 0, opacity: v ? 0.85 : 0.6 }} />
                  {!v && cell >= 14 && (
                    <span className="absolute inset-0 flex items-center justify-center pointer-events-none"
                      style={{ color: GOLD, fontSize: Math.max(8, cell * 0.42), opacity: 0.75 }}>×2</span>
                  )}
                </>
              )}
              {pendingKeys?.has(k) && (
                // Locked in, not yet revealed: inked, but with a dotted outline.
                <Ink size={cell} stroke="pending" color={pendingInk} dir={youSide === "B" ? -1 : 1} seed={seed}
                  style={{ position: "absolute", inset: 0, opacity: 0.9 }} />
              )}
              {isGhost && (
                <Ink size={cell} stroke="ghost" seed={seed}
                  color={ghostLegal ? ghostInk : UI.bad}
                  
                  style={{ position: "absolute", inset: 0 }} />
              )}
              <span aria-hidden="true" style={{ position: "absolute", inset: 0, pointerEvents: "none", background: shine }} />
              {mark}
            </div>
          );
        })
      )}
    </div>
  );
}

/* ---------- Bubbles: every in-game button is a round pane of glass ---------- */

/** Rows of a pixel capsule `w` wide and `h` tall (art pixels): [y, x0, x1). */
function capsuleRows(w, h, inset = 0) {
  const W = w - 2 * inset, H = h - 2 * inset, R = Math.min(W, H) / 2, rows = [];
  for (let y = 0; y < H; y++) {
    const yc = y + 0.5;
    const dy = yc < R ? R - yc : yc > H - R ? yc - (H - R) : 0;
    if (dy >= R) continue;
    const hw = Math.sqrt(R * R - dy * dy);
    // Works lying down too: the straight run sits between the two end caps.
    const x0 = Math.round(R - hw), x1 = Math.round(W - R + hw);
    if (x1 > x0) rows.push([y + inset, x0 + inset, x1 + inset]);
  }
  return rows;
}

/** The glass shape itself, drawn in whole pixels: rim, tinted body, glint. */
function BubbleShape({ w, h, tint, fill = 18 }) {
  const P = usePx();
  const outer = capsuleRows(w, h), inner = capsuleRows(w, h, 1);
  const g = Math.max(1, Math.round(w * 0.2));
  return (
    <svg aria-hidden="true" width={w * P} height={h * P} viewBox={`0 0 ${w} ${h}`} shapeRendering="crispEdges"
      style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
      {outer.map(([y, a, b]) => <rect key={`o${y}`} x={a} y={y} width={b - a} height={1} style={{ fill: `color-mix(in srgb, ${tint} 75%, transparent)` }} />)}
      {inner.map(([y, a, b]) => <rect key={`i${y}`} x={a} y={y} width={b - a} height={1} style={{ fill: `color-mix(in srgb, ${tint} ${fill}%, rgba(10,10,16,.55))` }} />)}
      <rect x={Math.round(w * 0.26)} y={2} width={g} height={1} fill="rgba(255,255,255,.55)" />
      <rect x={Math.round(w * 0.2)} y={3} width={1} height={Math.max(1, Math.round(h * 0.12))} fill="rgba(255,255,255,.4)" />
      <rect x={w - 1 - Math.round(w * 0.3)} y={h - 3} width={Math.max(1, Math.round(w * 0.12))} height={1} fill="rgba(255,255,255,.18)" />
    </svg>
  );
}

/** Bubble size in art pixels: never smaller than a fingertip. */
function useBubble() {
  const P = usePx();
  const d = Math.max(15, Math.ceil(40 / P));
  return d + (d % 2); // even, so the circle is symmetric
}

function Bubble({ w, h, tint = UI.text, fill, label, children, className = "", style, ...rest }) {
  const P = usePx();
  return (
    <button aria-label={label} title={label} {...rest}
      className={`relative flex items-center justify-center shrink-0 disabled:opacity-35 ${className}`}
      style={{ width: w * P, height: h * P, color: tint, ...style }}>
      <BubbleShape w={w} h={h} tint={tint} fill={fill} />
      <span className="relative flex items-center justify-center">{children}</span>
    </button>
  );
}

/**
 * The right rail: TURN, LOCK IN (the tall one) and PASS at the top, the
 * turn number in the middle, FORFEIT at the bottom.
 */
function ActionRail({
  height, ink, onRotate, onCommit, onDiscard, canRotate, canCommit, canDiscard,
  turn, waiting = false, timer = null, forfeit,
}) {
  const P = usePx();
  const d = useBubble();
  return (
    <div className="shrink-0 flex flex-col items-center justify-between" style={{ width: Math.max(d, 19) * P, height }}>
      <div className="flex flex-col items-center" style={{ gap: 2 * P }}>
        <Bubble w={d} h={d} label="Turn" onClick={onRotate} disabled={!canRotate}><RotateCw /></Bubble>
        <Bubble w={d} h={Math.round(d * 2.2)} label="LOCK IN" tint={canCommit || waiting ? ink : UI.dim} fill={canCommit ? 55 : 18}
          onClick={onCommit} disabled={!canCommit} className={waiting ? "tb-pulse" : undefined}
          style={{ color: canCommit ? UI.text : undefined }}>
          <Check />
        </Bubble>
        <Bubble w={d} h={d} label="Pass" tint={UI.dim} onClick={onDiscard} disabled={!canDiscard}><SkipForward /></Bubble>
      </div>
      <div className="flex flex-col items-center" style={{ gap: 2 * P }}>
        <NumBox value={turn} color={UI.dim} label={`Turn ${turn}`} />
        {timer}
      </div>
      <ForfeitButton {...forfeit} />
    </div>
  );
}

/** Width in pixels of the current-piece pane and of each upcoming one. */
const NOW_W = 16, SOON_W = 12;
/** Smaller panes on very narrow phones, so both forecasts and the bag fit in one row. */
const paneSizes = () => (typeof window !== "undefined" && window.innerWidth < 360 ? [13, 10] : [NOW_W, SOON_W]);

/** A small glass pane holding one piece. */
function PiecePane({ id, size, ink, dir, dim = 1, lit = false, ...rest }) {
  const P = usePx();
  return (
    <div {...rest} className="relative flex items-center justify-center shrink-0 select-none"
      style={{
        width: size * P, height: size * P, ...GLASS, clipPath: CLIP1, opacity: dim,
        ...(lit ? { boxShadow: `inset 0 0 0 ${P}px color-mix(in srgb, ${ink} 80%, transparent)` } : null),
        ...rest.style,
      }}>
      {id !== undefined && id !== null && <BlockGlyph blockId={id} box={(size - 4) * P} color={ink} dir={dir} />}
    </div>
  );
}

/**
 * One player's side of the top row: name and score, then the piece they play
 * now and the next four. Mirrored for the player on the right.
 */
function ForecastSide({ name, ink, now, queue, dir = 1, right = false, card = null, busy = false, compact = false }) {
  const P = usePx();
  const [nowW, soonW] = paneSizes();
  const soon = (queue || []).slice(0, QUEUE_SHOWN);
  const panes = [
    card || <PiecePane key="now" id={now} size={nowW} ink={ink} dir={dir} />,
    ...soon.map((id, i) => <PiecePane key={i} id={id} size={soonW} ink={ink} dir={dir} dim={1 - i * 0.12} />),
  ];
  return (
    <div className={`flex flex-col min-w-0 ${right ? "items-end" : "items-start"} ${busy ? "tb-pulse" : ""}`} style={{ gap: P }}>
      {!compact && (
        <div className="tb-t truncate max-w-full" style={{ color: ink }}>{name}</div>
      )}
      <div className={`flex items-end ${right ? "flex-row-reverse" : ""}`} style={{ gap: P }}>{panes}</div>
    </div>
  );
}

/** The top row, sitting on the board: your forecast left, theirs right, the bag number between. */
function ForecastRow({ left, right, bag, width, compact = false }) {
  const P = usePx();
  return (
    <div className="shrink-0 flex items-end justify-between" style={{ width, gap: 2 * P }}>
      <ForecastSide {...left} compact={compact} />
      <NumBox value={bag} color={UI.dim} label={`Bag ${bag}`} />
      <ForecastSide {...right} compact={compact} right />
    </div>
  );
}

/** Your current piece, as the pane you pick it up from. */
function NowCard({ id, ink, dir, selected, dragging, onPress, disabled, spent }) {
  return (
    <PiecePane id={id} size={paneSizes()[0]} ink={ink} dir={dir} lit={selected}
      data-queue-card="" aria-label={`Your piece: ${BLOCKS[id].name}`}
      onPointerDown={(e) => !disabled && onPress(e, 0)}
      dim={spent ? 0.3 : disabled ? 0.45 : selected && dragging ? 0.4 : 1}
      style={{ touchAction: "none", cursor: disabled ? "default" : "grab" }} />
  );
}

/** Territory as three pencil-shaded strips over a drawn baseline. */
const METER_W = 8; // pixels wide

/**
 * The score meter, standing beside the board: the bottom player's share
 * fills up from the bottom, the top player's down from the top, meeting
 * where the scores stand. Heights step in whole pixels.
 */
function VMeter({ a, b, inkA, inkB, height }) {
  const P = usePx();
  const inner = Math.max(0, height - 4 * P);
  const total = Math.max(1, a + b);
  const hA = Math.round(((a / total) * inner) / P) * P;
  const hB = Math.round(((b / total) * inner) / P) * P;
  const bar = (color) => ({
    background: tileShades(color).base,
    boxShadow: `inset ${P}px 0 0 ${tileShades(color).light}, inset -${P}px 0 0 ${tileShades(color).dark}`,
    transition: "height 400ms steps(6)",
  });
  return (
    <div aria-label={`Score ${a} to ${b}`} className="relative shrink-0"
      style={{ width: METER_W * P, height, padding: 2 * P - P, ...sk(UI.dim), background: "color-mix(in srgb, var(--tb-ground) 50%, black)", boxSizing: "border-box" }}>
      <div className="absolute" style={{ left: P, right: P, top: P, height: hB, ...bar(inkB) }} />
      <div className="absolute" style={{ left: P, right: P, bottom: P, height: hA, ...bar(inkA) }} />
    </div>
  );
}

/* ---------- Pixel numbers and the glass boxes that hold them ---------- */

// A 3×5 pixel digit font: each string is five rows of three.
const DIGITS = {
  0: "111101101101111", 1: "010110010010111", 2: "111001111100111", 3: "111001111001111",
  4: "101101111001001", 5: "111100111001111", 6: "111100111101111", 7: "111001010010010",
  8: "111101111101111", 9: "111101111001111", "+": "000010111010000", "-": "000000111000000",
};

/** A number drawn in big pixels (`dot` UI pixels each), with a one-dot shadow. */
function PixelNum({ value, dot = 2, color = "currentColor", shadow = true }) {
  const P = usePx();
  const chars = String(value).split("").filter((ch) => DIGITS[ch]);
  const w = Math.max(1, chars.length * 4 - 1), h = 5;
  const rects = [];
  chars.forEach((ch, i) => {
    const bits = DIGITS[ch];
    for (let y = 0; y < 5; y++) {
      let x = 0;
      while (x < 3) {
        if (bits[y * 3 + x] !== "1") { x++; continue; }
        const st = x;
        while (x < 3 && bits[y * 3 + x] === "1") x++;
        rects.push([i * 4 + st, y, x - st]);
      }
    }
  });
  const s = dot * P;
  return (
    <svg aria-hidden="true" width={(w + (shadow ? 0.5 : 0)) * s} height={(h + (shadow ? 0.5 : 0)) * s}
      viewBox={`0 0 ${w + (shadow ? 0.5 : 0)} ${h + (shadow ? 0.5 : 0)}`} shapeRendering="crispEdges" style={{ display: "block", overflow: "visible" }}>
      {shadow && rects.map(([x, y, l], k) => <rect key={`s${k}`} x={x + 0.5} y={y + 0.5} width={l} height={1} fill="rgba(0,0,0,.4)" />)}
      {rects.map(([x, y, l], k) => <rect key={k} x={x} y={y} width={l} height={1} fill={color} />)}
    </svg>
  );
}

/** Height of a number box, in UI pixels. */
const NUMBOX_H = 17;

/** A number in a pane of glass, a size up from the board's squares. */
function NumBox({ value, color = UI.text, label, minW = NUMBOX_H, tint }) {
  const P = usePx();
  return (
    <div role="img" aria-label={label} title={label}
      className="relative flex items-center justify-center shrink-0"
      style={{
        height: NUMBOX_H * P, minWidth: minW * P, padding: `0 ${3 * P}px`, boxSizing: "border-box",
        ...GLASS, clipPath: CLIP,
        ...(tint ? { background: `color-mix(in srgb, ${tint} 14%, color-mix(in srgb, var(--tb-text) 6%, transparent))` } : null),
      }}>
      <PixelNum value={value} color={color} />
    </div>
  );
}

/** True on phone-sized screens, where the game uses its compact, symbols-only layout. */
function useCompact() {
  const get = () => typeof window !== "undefined" && window.innerWidth < 640;
  const [c, setC] = useState(get);
  useEffect(() => {
    const on = () => setC(get());
    window.addEventListener("resize", on);
    return () => window.removeEventListener("resize", on);
  }, []);
  return c;
}

/** Width of the desktop meter column (room for a three-digit count), in UI pixels. */
const METER_COL_W = 27;

/** Desktop: their square count on top, the meter, your count at the bottom. */
function MeterColumn({ a, b, inkA, inkB, height }) {
  const P = usePx();
  const gap = 2 * P;
  return (
    <div className="shrink-0 flex flex-col items-center" style={{ width: METER_COL_W * P, height, gap }}>
      <NumBox value={b} color={inkB} tint={inkB} label={`Their squares: ${b}`} />
      <VMeter a={a} b={b} inkA={inkA} inkB={inkB} height={height - 2 * (NUMBOX_H * P + gap)} />
      <NumBox value={a} color={inkA} tint={inkA} label={`Your squares: ${a}`} />
    </div>
  );
}

/** Phone: the meter lies on its side under the forecast — yours fills from the left. */
function HMeter({ a, b, inkA, inkB, width }) {
  const P = usePx();
  const boxW = 22 * P, gap = 2 * P;
  const inner = Math.max(0, width - 2 * (boxW + gap) - 2 * P);
  const total = Math.max(1, a + b);
  const wA = Math.round(((a / total) * inner) / P) * P;
  const wB = Math.round(((b / total) * inner) / P) * P;
  const bar = (color) => ({
    background: tileShades(color).base,
    boxShadow: `inset 0 ${P}px 0 ${tileShades(color).light}, inset 0 -${P}px 0 ${tileShades(color).dark}`,
    transition: "width 400ms steps(6)",
  });
  return (
    <div className="flex items-center shrink-0" style={{ width, gap }}>
      <NumBox value={a} color={inkA} tint={inkA} minW={22} label={`Your squares: ${a}`} />
      <div aria-label={`Score ${a} to ${b}`} className="relative flex-1"
        style={{ height: 8 * P, ...sk(UI.dim), background: "color-mix(in srgb, var(--tb-ground) 50%, black)", boxSizing: "border-box" }}>
        <div className="absolute" style={{ top: P, bottom: P, left: P, width: wA, ...bar(inkA) }} />
        <div className="absolute" style={{ top: P, bottom: P, right: P, width: wB, ...bar(inkB) }} />
      </div>
      <NumBox value={b} color={inkB} tint={inkB} minW={22} label={`Their squares: ${b}`} />
    </div>
  );
}

/** Phone: the buttons in one row under the board — turn, lock in (wide), pass · turn number · forfeit. */
function ActionRow({
  width, ink, onRotate, onCommit, onDiscard, canRotate, canCommit, canDiscard, turn, waiting = false, timer = null, forfeit,
}) {
  const P = usePx();
  const d = useBubble();
  return (
    <div className="flex items-center justify-between shrink-0" style={{ width }}>
      <div className="flex items-center" style={{ gap: 2 * P }}>
        <Bubble w={d} h={d} label="Turn" onClick={onRotate} disabled={!canRotate}><RotateCw /></Bubble>
        <Bubble w={Math.round(d * 2.2)} h={d} label="LOCK IN" tint={canCommit || waiting ? ink : UI.dim} fill={canCommit ? 55 : 18}
          onClick={onCommit} disabled={!canCommit} className={waiting ? "tb-pulse" : undefined}
          style={{ color: canCommit ? UI.text : undefined }}>
          <Check />
        </Bubble>
        <Bubble w={d} h={d} label="Pass" tint={UI.dim} onClick={onDiscard} disabled={!canDiscard}><SkipForward /></Bubble>
      </div>
      <div className="flex items-center" style={{ gap: 2 * P }}>
        {timer}
        <NumBox value={turn} color={UI.dim} label={`Turn ${turn}`} />
        <ForfeitButton {...forfeit} />
      </div>
    </div>
  );
}

/** Space around the board, by layout. Everything is in whole UI pixels. */
function gameLayout(stage, theme, P, d, compact) {
  const g = (theme.gap ?? 1) * P;
  const side = 4 * P;
  const railW = Math.max(d, 19) * P;
  const forecastH = compact ? 22 * P : 34 * P;
  const wRes = compact ? 0 : METER_COL_W * P + railW + 2 * side;
  const hRes = compact ? forecastH + (NUMBOX_H + 3) * P + (d + 3) * P + 6 * P : forecastH + 3 * P;
  const cellArt = Math.max(5, Math.floor(Math.min(
    (stage.w - wRes - g * (COLS - 1)) / COLS,
    (stage.h - hRes - g * (ROWS - 1)) / ROWS
  ) / P));
  const cell = cellArt * P;
  const boardW = cell * COLS + g * (COLS - 1);
  const boardH = cell * ROWS + g * (ROWS - 1);
  const groupW = compact ? boardW : boardW + METER_COL_W * P + railW + 2 * side;
  return { g, side, railW, cell, boardW, boardH, groupW };
}

/**
 * The menu backdrop: blocks spreading outward from the centre of an open
 * field. The field is larger than the screen (and slightly turned), so it
 * has no visible edge. Each new block touches what's already there and
 * prefers spots near the middle, so the shape grows like a game of MINO
 * with no board. Once enough is covered it fades out and starts over.
 */
const FIELD_CELL = 60;       // px per square. HIGHER = more zoomed in
const FIELD_TICK_MS = 650;   // one new block per tick, sometimes two
const FIELD_FILL = 0.7;      // fraction of the visible screen covered before it fades and restarts
// The field is wider than the 8-column game board, so it keys its own squares.
const fk = (r, c) => r * 100 + c;

function seedField(cols, rows) {
  const cells = new Map();
  const mid = [Math.floor(rows / 2), Math.floor(cols / 2)];
  // One block of each colour, side by side at the centre.
  cells.set(fk(mid[0], mid[1] - 1), { owner: "A", born: 0 });
  cells.set(fk(mid[0], mid[1]), { owner: "B", born: 0 });
  return { cells, gen: 0, fading: 0, misses: 0 };
}

/** Places one random block touching the cluster, nearest the centre wins (with noise). */
function growField(field, cols, rows) {
  const { cells } = field;
  const cr = rows / 2, cc = cols / 2;
  // The empty squares touching the cluster: every new block starts on one.
  const edge = [];
  for (const k of cells.keys()) {
    const r = Math.floor(k / 100), c = k % 100;
    for (const [dr, dc] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
      const nr = r + dr, nc = c + dc;
      if (nr >= 0 && nc >= 0 && nr < rows && nc < cols && !cells.has(fk(nr, nc))) edge.push([nr, nc]);
    }
  }
  if (!edge.length) return false;
  let best = null, bestScore = Infinity;
  for (let tries = 0; tries < 60; tries++) {
    const [ar, ac] = edge[Math.floor(Math.random() * edge.length)];
    const id = Math.floor(Math.random() * BLOCKS.length);
    const shape = rotateN(BLOCKS[id].cells, Math.floor(Math.random() * 4));
    const [sr, sc] = shape[Math.floor(Math.random() * shape.length)];
    const placed = shape.map(([r, c]) => [ar + r - sr, ac + c - sc]);
    if (placed.some(([r, c]) => r < 0 || c < 0 || r >= rows || c >= cols || cells.has(fk(r, c)))) continue;
    const score = placed.reduce((sum, [r, c]) => sum + Math.hypot(r - cr, (c - cc) * 1.15), 0) / placed.length + Math.random() * 3;
    if (score < bestScore) { bestScore = score; best = placed; }
  }
  if (!best) return false;
  const owner = Math.random() < 0.5 ? "A" : "B";
  for (const [r, c] of best) cells.set(fk(r, c), { owner, born: field.gen + 1 });
  return true;
}

function AmbientField({ colors, theme, paused }) {
  const reduced =
    typeof window !== "undefined" && window.matchMedia &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const animate = theme.motion && !reduced && !paused;

  // Big enough to cover the screen even turned at an angle.
  const [dims] = useState(() => {
    const w = typeof window === "undefined" ? 1200 : window.innerWidth;
    const h = typeof window === "undefined" ? 800 : window.innerHeight;
    const n = Math.min(99, Math.ceil((Math.max(w, h) * 1.45) / FIELD_CELL));
    // Restart once roughly FIELD_FILL of what's on screen is covered.
    // Small screens hold few squares at this zoom, so give them a floor or
    // the field resets every few seconds.
    const limit = Math.min(900, Math.max(120, Math.round(((w * h) / (FIELD_CELL * FIELD_CELL)) * FIELD_FILL)));
    return { cols: n, rows: n, limit };
  });
  const [field, setField] = useState(() => seedField(dims.cols, dims.rows));

  useEffect(() => {
    if (!animate) return;
    const id = setInterval(() => {
      setField((prev) => {
        // Fading out: wait for the fade to finish, then start again from the centre.
        if (prev.fading) return prev.fading >= 3 ? seedField(dims.cols, dims.rows) : { ...prev, fading: prev.fading + 1 };
        const next = { cells: new Map(prev.cells), gen: prev.gen + 1, fading: 0, misses: prev.misses };
        const grew = growField(next, dims.cols, dims.rows);
        if (grew && Math.random() < 0.35) growField(next, dims.cols, dims.rows);
        // A crowded spot can refuse a block; only give up after a run of refusals.
        next.misses = grew ? 0 : prev.misses + 1;
        if (next.misses >= 6 || next.cells.size >= dims.limit) return { ...prev, fading: 1 };
        return next;
      });
    }, FIELD_TICK_MS);
    return () => clearInterval(id);
  }, [animate, dims]);

  const ink = { A: colors.you, B: colors.rival, S: colors.special };
  // Snapped to the pixel grid: squares sit on whole pixels, no tilt.
  const P = usePx();
  const cellPx = Math.round(FIELD_CELL / P) * P;
  const size = cellPx - 2 * P;
  const W = dims.cols * cellPx, H = dims.rows * cellPx;
  const vw = typeof window === "undefined" ? 1200 : window.innerWidth;
  const vh = typeof window === "undefined" ? 800 : window.innerHeight;
  const ox = Math.round((vw - W) / 2 / P) * P, oy = Math.round((vh - H) / 2 / P) * P;

  return (
    <div aria-hidden="true" className="absolute inset-0 overflow-hidden pointer-events-none">
      <div style={{
        position: "absolute", left: ox, top: oy, width: W, height: H,
        opacity: field.fading ? 0 : 0.2,
        transition: "opacity 1400ms ease",
      }}>
        {[...field.cells].map(([k, v]) => {
          const r = Math.floor(k / 100), c = k % 100;
          return (
            // Every square fades in once, when it first appears, at its own pace.
            <div key={k} className={animate ? "tb-fadein" : undefined}
              style={{ position: "absolute", left: c * cellPx + P, top: r * cellPx + P, width: size, height: size }}>
              <Ink size={size} color={ink[v.owner]} {...inkOf(v.owner)} seed={r * 7 + c} />
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Popup({ title, onClose, children, pinned, maxW = 430 }) {
  useEffect(() => { sky.paused++; return () => { sky.paused--; }; }, []);
  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center tb-fade"
      style={{
        // A dimmed, see-through backdrop. The sky behind is paused while a
        // popup is open (see PixelSky), so the frosted panel isn't re-blurring
        // a moving picture every frame.
        // Dimmed with a pixel dither rather than a blur.
        background: "repeating-conic-gradient(rgba(0,0,0,.55) 0 25%, rgba(0,0,0,.25) 0 50%) 0 0 / calc(var(--p) * 2) calc(var(--p) * 2)",
        padding: "clamp(14px, 5vw, 56px) clamp(14px, 5vw, 56px)",
        paddingTop: "max(clamp(14px,5vw,56px), env(safe-area-inset-top,0px))",
        paddingBottom: "max(clamp(14px,5vw,56px), env(safe-area-inset-bottom,0px))",
      }}
      onPointerDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <PxContext.Provider value={BASE_P}>
      <div
        className="tb-pop tb-scale w-full flex flex-col overflow-hidden"
        style={{
          maxWidth: maxW,
          maxHeight: "100%",
          background: "color-mix(in srgb, var(--tb-panel-solid) 92%, black)",
          ...sk("var(--tb-text)"),
        }}
      >
        <div className="flex items-center justify-between px-4 h-12 shrink-0 mx-2" style={RULE_BELOW}>
          <span className="tb-t" style={{ color: UI.text }}>{title}</span>
          <button onClick={onClose} style={{ color: UI.dim }} aria-label="Close" className="p-2 -mr-2"><X size={17} /></button>
        </div>
        {pinned && <div className="px-4 pt-3 shrink-0">{pinned}</div>}
        <div className="tb-scroll flex-1 min-h-0 overflow-y-auto px-4 pb-5">{children}</div>
      </div>
      </PxContext.Provider>
    </div>
  );
}

/* ============================================================
   SETTINGS
   ============================================================ */
function SettingsModal({ name, rename, status, theme, setTheme, onClose }) {
  const [draft, setDraft] = useState(name);
  const [nameErr, setNameErr] = useState(null);
  const set = (patch) => setTheme({ ...theme, ...patch });

  // The server has the final say on names (taken, reserved, bad characters).
  useEffect(() => net.on("nameError", (msg) => { setNameErr(msg); setDraft(net.profile?.name ?? name); }), [name]);

  return (
    <Popup title="SETTINGS" onClose={onClose}>
      <div className="pt-4">
        <div className="tb-t mb-3">HANDLE</div>
        <input value={draft} maxLength={16}
          onChange={(e) => { setDraft(e.target.value); setNameErr(null); }} onBlur={() => rename(draft)}
          onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
          className={`w-full rounded px-3 ${nameErr ? "mb-2" : "mb-7"} tb-t font-mono`}
          style={{ height: 44, background: UI.ground, ...sk(nameErr ? UI.badSoft : UI.line), color: UI.text, outline: "none" }} />
        {nameErr && <div className="tb-t mb-6" style={{ color: UI.bad }}>{nameErr}</div>}

        {HAS_KEYBOARD && <ControlsSection />}

        <div className="tb-t mb-1" style={{ color: UI.dim }}>ACCESSIBILITY</div>
        <Row label="COLOURBLIND MARKS">
          <Toggle on={theme.colorblind} onClick={() => set({ colorblind: !theme.colorblind })} />
        </Row>
        <Row label="ANIMATION">
          <Toggle on={theme.motion} onClick={() => set({ motion: !theme.motion })} />
        </Row>
        <Row label="HAPTICS">
          <Toggle on={theme.haptics} onClick={() => set({ haptics: !theme.haptics })} />
        </Row>
        <Row label="SHOW TURN CLOCK">
          <Toggle on={theme.showTimer} onClick={() => set({ showTimer: !theme.showTimer })} />
        </Row>
        <div className="tb-t mt-2 mb-7" style={{ color: UI.dim }}>
          Marks put ○ on your squares
          and ✕ on your opponent's, so the board reads without colour.
        </div>

        <div className="tb-t mb-2" style={{ color: UI.dim }}>CONNECTION</div>
        <div className="flex items-center gap-2 tb-t mb-1" style={{ color: status === "online" ? UI.good : UI.dim }}>
          {status === "online" ? <Wifi size={12} /> : <WifiOff size={12} />}
          SERVER {status.toUpperCase()}
        </div>
        <div className="flex items-center gap-2 tb-t mb-1.5" style={{ color: IS_SECURE ? UI.good : GOLD }}>
          {IS_SECURE ? <Lock size={12} /> : <ShieldAlert size={12} />}
          {IS_SECURE ? "ENCRYPTED (TLS)" : "NOT ENCRYPTED"}
        </div>
        <div className="tb-t pb-2" style={{ color: UI.dim }}>
          {SERVER_URL}
          {!IS_SECURE && " — fine on your own machine, unsafe over a real network."}
        </div>
        <div className="pt-3 pb-2"><LegalLinks /></div>
      </div>
    </Popup>
  );
}

/* ============================================================
   DECK
   ============================================================ */
function DeckModal({ loadout, setLoadout, color, onClose }) {
  const slotRefs = useRef([]);
  const dragRef = useRef(null);
  const [drag, setDrag] = useState(null);

  const groups = useMemo(() => {
    const g = { SMALL: [], MEDIUM: [], BIG: [] };
    BLOCKS.forEach((b, i) => g[sizeOf(b.cells.length)].push(i));
    return g;
  }, []);

  const hitSlot = (x, y) =>
    slotRefs.current.findIndex((el) => {
      if (!el) return false;
      const r = el.getBoundingClientRect();
      return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
    });

  const applyDrop = (blockId, from, slot) => {
    setLoadout((prev) => {
      const next = [...prev];
      if (typeof from === "number") {
        [next[from], next[slot]] = [next[slot], next[from]];
      } else {
        const existing = next.indexOf(blockId);
        if (existing === slot) return prev;
        if (existing >= 0) next[existing] = next[slot];
        next[slot] = blockId;
      }
      return next;
    });
  };

  const beginDrag = useCallback((blockId, from, x, y) => {
    dragRef.current = { blockId, from, x, y, over: null };
    setDrag({ ...dragRef.current });
    if (navigator.vibrate) try { navigator.vibrate(8); } catch (e) {}
    const block = (ev) => ev.preventDefault();
    const onMove = (ev) => {
      if (!dragRef.current) return;
      const over = hitSlot(ev.clientX, ev.clientY);
      dragRef.current = { ...dragRef.current, x: ev.clientX, y: ev.clientY, over: over >= 0 ? over : null };
      setDrag({ ...dragRef.current });
    };
    const stop = (commit) => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
      window.removeEventListener("touchmove", block);
      const d = dragRef.current;
      dragRef.current = null;
      setDrag(null);
      if (commit && d && d.over !== null) applyDrop(d.blockId, d.from, d.over);
    };
    const onUp = () => stop(true);
    const onCancel = () => stop(false);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
    window.addEventListener("touchmove", block, { passive: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onPress = (e, blockId, from, instant) => {
    const sx = e.clientX, sy = e.clientY;
    if (instant || e.pointerType === "mouse") {
      e.preventDefault();
      beginDrag(blockId, from, sx, sy);
      return;
    }
    let armed = false;
    const timer = setTimeout(() => { armed = true; cleanup(); beginDrag(blockId, from, sx, sy); }, 170);
    const watch = (ev) => {
      if (armed) return;
      if (Math.abs(ev.clientX - sx) > 9 || Math.abs(ev.clientY - sy) > 9) { clearTimeout(timer); cleanup(); }
    };
    const release = () => { clearTimeout(timer); cleanup(); };
    function cleanup() {
      window.removeEventListener("pointermove", watch);
      window.removeEventListener("pointerup", release);
      window.removeEventListener("pointercancel", release);
    }
    window.addEventListener("pointermove", watch);
    window.addEventListener("pointerup", release);
    window.addEventListener("pointercancel", release);
  };

  const pinned = (
    <>
      <div className="grid grid-cols-4 gap-1.5 pb-3" style={{ ...RULE_BELOW }}>
        {loadout.map((blockId, i) => {
          const hot = drag && drag.over === i;
          return (
            <div key={i} ref={(el) => (slotRefs.current[i] = el)}
              onPointerDown={(e) => onPress(e, blockId, i, true)}
              className="rounded flex flex-col items-center justify-center gap-1 select-none relative"
              style={{
                height: 62,
                background: hot ? UI.cell : "transparent",
                ...sk(hot ? color : UI.line),
                touchAction: "none",
                transform: hot ? "scale(1.06)" : "none",
                transition: "transform 120ms ease-out",
                opacity: drag && drag.from === i ? 0.25 : 1,
              }}>
              <BlockGlyph blockId={blockId} box={28} color={color} />
              <span className="tb-t" style={{ color: UI.dim }}>
                {BLOCKS[blockId].name}
              </span>
            </div>
          );
        })}
      </div>
      <div className="tb-t pt-2 pb-1" style={{ color: UI.dim }}>
        You play one piece per turn, straight from the front of your queue. These
        eight come round once per pass, shuffled each time — and your opponent can see them.
      </div>
    </>
  );

  return (
    <Popup title="YOUR BLOCKS" onClose={onClose} pinned={pinned}>
      <div className="tb-t pt-3 pb-4" style={{ color: UI.dim }}>
        Hold a block for a moment, then drag it up into a slot.
      </div>
      {["SMALL", "MEDIUM", "BIG"].map((g) => (
        <div key={g} className="mb-5">
          <div className="tb-t mb-2" style={{ color: UI.dim }}>
            {g} · {g === "SMALL" ? "1–3" : g === "MEDIUM" ? "4–7" : "8–12"}
          </div>
          <div className="grid grid-cols-4 gap-1.5">
            {groups[g].map((blockId) => {
              const inDeck = loadout.includes(blockId);
              return (
                <div key={blockId} onPointerDown={(e) => onPress(e, blockId, "lib", false)}
                  className="rounded flex flex-col items-center justify-center gap-1 select-none"
                  style={{ height: 68, background: inDeck ? UI.cell : "transparent", ...sk(inDeck ? color : UI.line) }}>
                  <BlockGlyph blockId={blockId} box={30} color={inDeck ? color : UI.dim} />
                  <span className="tb-t" style={{ color: UI.dim }}>
                    {BLOCKS[blockId].name} · {BLOCKS[blockId].cells.length}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      ))}
      {drag && (
        <div className="fixed z-50 pointer-events-none"
          style={{ left: drag.x, top: drag.y - 34, transform: "translate(-50%,-50%) scale(1.12)" }}>
          <div className="p-2.5"
            style={{
              background: UI.panel,
              ...sk(drag.over !== null ? GOLD : color),
              boxShadow: "0 10px 26px rgba(0,0,0,.6)",
            }}>
            <BlockGlyph blockId={drag.blockId} box={46} color={color} />
          </div>
        </div>
      )}
    </Popup>
  );
}

/* ============================================================
   STATS
   ============================================================ */
function Sparkline({ values, color, height = 58 }) {
  if (values.length < 2) return null;
  const w = 100;
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const span = Math.max(1, hi - lo);
  const pts = values.map((v, i) => [
    (i / (values.length - 1)) * w,
    height - 6 - ((v - lo) / span) * (height - 14),
  ]);
  const line = pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(2)},${y.toFixed(2)}`).join(" ");
  return (
    <svg viewBox={`0 0 ${w} ${height}`} preserveAspectRatio="none" style={{ width: "100%", height }}>
      <defs>
        <linearGradient id="tbSpark" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.28" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={`${line} L${w},${height} L0,${height} Z`} fill="url(#tbSpark)" />
      <path d={line} fill="none" stroke={color} strokeWidth="1.4" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
    </svg>
  );
}

function StatCell({ label, value, sub, color }) {
  return (
    <div className="rounded p-2.5" style={{ background: UI.panel, ...sk(UI.line) }}>
      <div className="tb-t mb-1.5" style={{ color: UI.dim }}>{label}</div>
      <div className="tb-t" style={{ color: color || UI.text }}>{value}</div>
      {sub && <div className="tb-t mt-1.5" style={{ color: UI.dim }}>{sub}</div>}
    </div>
  );
}

function StatsModal({ profile, status, onClose }) {
  // No profile has two very different causes. Saying "offline" for both sent
  // people hunting a server problem when they simply weren't signed in.
  if (!profile) {
    const connected = status === "online";
    return (
      <Popup title="RANKED STATS" onClose={onClose}>
        <div className="rounded p-6 mt-6 text-center" style={{ background: UI.panel, ...sk(UI.line) }}>
          {connected
            ? <UserRound size={20} style={{ color: UI.dim, margin: "0 auto 12px" }} />
            : <WifiOff size={20} style={{ color: UI.dim, margin: "0 auto 12px" }} />}
          <div className="tb-t" style={{ color: UI.dim }}>
            {connected ? (
              <>Sign in to see your ranked stats.<br />Solo and take-turns matches aren't ranked.</>
            ) : status === "connecting" ? (
              <>Connecting to the server…</>
            ) : (
              <>Server offline.<br />Ranked stats live on the server, not on this device.</>
            )}
          </div>
        </div>
      </Popup>
    );
  }

  const st = profile.stats;
  const placed = st.games >= PLACEMENT_GAMES;
  const tr = Math.round(profile.rating.r);
  const ri = rankIndexFor(tr);
  const rank = RANKS[ri];
  const prog = rankProgress(tr);
  const next = ri < RANKS.length - 1 ? RANKS[ri + 1] : null;
  const toNext = next ? Math.max(0, Math.ceil(rankMin(ri + 1) - tr)) : 0;
  const winRate = st.games ? Math.round((st.wins / st.games) * 100) : 0;

  return (
    <Popup title="RANKED STATS" onClose={onClose}>
      <div className="mt-4 rounded p-4" style={{ background: UI.panel, ...sk(UI.line) }}>
        <div className="flex items-center gap-4">
          <div className="rounded flex items-center justify-center shrink-0"
            style={{ width: 74, height: 74, background: placed ? `${rank.color}1F` : UI.cell, ...sk(placed ? rank.color : UI.line) }}>
            <span className="text-3xl" style={{ color: placed ? rank.color : UI.dim }}>{placed ? rank.name : "–"}</span>
          </div>
          <div className="min-w-0 flex-1">
            {placed ? (
              <>
                <div className="flex items-baseline gap-1.5">
                  <span className="tb-t">{tr}</span>
                  <span className="tb-t" style={{ color: UI.dim }}>TR ±{Math.round(profile.rating.rd)}</span>
                </div>
                <div className="tb-t mt-2 mb-1.5" style={{ color: UI.dim }}>
                  {next ? `${toNext} TR TO ${next.name}` : "TOP OF THE LADDER"}
                </div>
                <div className="h-1 w-full rounded overflow-hidden" style={{ background: UI.cell }}>
                  <div style={{ width: `${prog * 100}%`, height: "100%", background: rank.color }} />
                </div>
              </>
            ) : (
              <>
                <div className="tb-t mb-1">UNRANKED</div>
                <div className="tb-t" style={{ color: UI.dim }}>
                  {PLACEMENT_GAMES - st.games} more ranked {PLACEMENT_GAMES - st.games === 1 ? "match" : "matches"} to place.
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      <div className="mt-4">
        <div className="tb-t mb-2" style={{ color: UI.dim }}>LADDER</div>
        <div className="flex gap-[3px]">
          {RANKS.map((r, i) => {
            const here = placed && i === ri;
            const past = placed && i < ri;
            return (
              <div key={r.name} className="flex-1 flex flex-col items-center gap-1.5">
                <div className="w-full rounded-sm" style={{
                  height: here ? 22 : 12,
                  background: here ? r.color : past ? `${r.color}66` : UI.cell,
                  transition: "height 180ms ease",
                }} />
                <span className="tb-t" style={{ color: here ? r.color : UI.dim, opacity: here ? 1 : 0.5 }}>{r.name}</span>
              </div>
            );
          })}
        </div>
      </div>

      {st.history.length > 1 && (
        <div className="mt-5 rounded p-3" style={{ background: UI.panel, ...sk(UI.line) }}>
          <div className="flex items-center justify-between mb-1">
            <span className="tb-t" style={{ color: UI.dim }}>TR · LAST {st.history.length}</span>
            <span className="tb-t" style={{ color: UI.dim }}>{Math.min(...st.history)} – {Math.max(...st.history)}</span>
          </div>
          <Sparkline values={st.history} color={rank.color} />
        </div>
      )}

      <div className="grid grid-cols-2 gap-2 mt-4">
        <StatCell label="RECORD" value={`${st.wins}–${st.losses}`} sub={`${st.games} matches`} />
        <StatCell label="WIN RATE" value={`${winRate}%`} sub={st.games ? `${st.wins} wins` : "no data"} color={winRate >= 50 ? UI.good : UI.text} />
        <StatCell label="PEAK" value={st.peakRank !== null ? RANKS[st.peakRank].name : "–"} sub={st.peakRank !== null ? `${st.peakTr} TR` : "unplaced"} color={st.peakRank !== null ? RANKS[st.peakRank].color : UI.dim} />
        <StatCell label="PLAYTIME" value={fmtTime(st.seconds)} sub={st.games ? `~${Math.round(st.seconds / st.games / 60)}m per match` : "no data"} />
        <StatCell label="STREAK" value={st.streak > 0 ? `W${st.streak}` : st.streak < 0 ? `L${-st.streak}` : "–"} sub={`best W${st.bestStreak}`} color={st.streak > 0 ? UI.good : st.streak < 0 ? UI.bad : UI.text} />
        <StatCell label="AVG TURF" value={st.squares ? st.squares.toFixed(1) : "–"} sub={st.special ? `${st.special.toFixed(1)} special` : "no data"} />
      </div>

      <div className="mt-5 mb-2">
        <div className="tb-t mb-2" style={{ color: UI.dim }}>RECENT MATCHES</div>
        {st.recent.length === 0 ? (
          <div className="rounded p-4 text-center tb-t" style={{ background: UI.panel, ...sk(UI.line), color: UI.dim }}>
            No ranked matches yet.
          </div>
        ) : (
          <div className="space-y-1">
            {st.recent.map((m, i) => (
              <div key={i} className="flex items-center gap-2.5 rounded px-3 py-2" style={{ background: UI.panel, ...sk(UI.line) }}>
                <span className="tb-t w-4 shrink-0" style={{ color: m.drew ? UI.dim : m.won ? UI.good : UI.bad }}>
                  {m.drew ? "D" : m.won ? "W" : "L"}
                </span>
                <span className="tb-t flex-1 truncate">{m.name}</span>
                <span className="tb-t" style={{ color: UI.dim }}>{m.score[0]}–{m.score[1]}</span>
                <span className="tb-t w-8 text-right" style={{ color: UI.dim }}>{fmtTime(m.seconds)}</span>
                <span className="tb-t w-9 text-right" style={{ color: m.delta > 0 ? UI.good : UI.bad }}>
                  {m.delta > 0 ? "+" : ""}{m.delta}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="tb-t pt-3 pb-2" style={{ color: UI.dim, ...RULE_ABOVE }}>
        Ranked only. Rating is Glicko-2 and computed on the server — TR is your rating,
        ± is how sure the system is about it. It narrows as you play.
      </div>
    </Popup>
  );
}

/* ============================================================
   THEME — everything here stays on this device
   ============================================================ */
function Swatch({ color, on, onClick, size = 24 }) {
  return (
    <button onClick={onClick} aria-label={color}
      style={{
        width: size, height: size, ...skFill(color, { dense: true }),
        outline: on ? `2px solid ${UI.text}` : `1px solid ${UI.line}`,
        outlineOffset: on ? 2 : 0,
      }} />
  );
}

/** Settings → Controls: click a key, press the new one. Escape cancels. */
function ControlsSection() {
  const keys = useKeys();
  const [listening, setListening] = useState(null);
  const [warn, setWarn] = useState(null);

  useEffect(() => {
    if (!listening) return;
    const onKey = (e) => {
      // Capture phase + stop: this press is a binding, not a game or form action.
      e.preventDefault();
      e.stopPropagation();
      if (e.key === "Escape") { setListening(null); return; }
      if (!canBind(e.key)) { setWarn(`${keyLabel(e.key)} can't be bound.`); return; }
      setKey(listening, e.key);
      setWarn(null);
      setListening(null);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [listening]);

  return (
    <div className="mb-7">
      <div className="flex items-center justify-between mb-1">
        <span className="tb-t">CONTROLS</span>
        <button onClick={() => { resetKeys(); setListening(null); setWarn(null); }}
          className="tb-t py-1" style={{ color: UI.dim }}>RESET</button>
      </div>
      <div className="tb-t mb-2" style={{ color: UI.dim }}>
        Click a key, then press the new one. Esc cancels.
      </div>
      <div className="grid grid-cols-2 gap-x-4">
        {ACTIONS.map((a) => {
          const on = listening === a.id;
          return (
            <div key={a.id} className="flex items-center justify-between py-1.5" style={RULE_BELOW}>
              <span className="tb-t" style={{ color: UI.dim }}>{a.label}</span>
              <button onClick={() => { setWarn(null); setListening(on ? null : a.id); }}
                className={`tb-t ${on ? "tb-pulse" : ""}`}
                style={{ minWidth: 52, height: 30, padding: "0 8px", ...(on ? skFill(UI.text) : sk(UI.line)), color: UI.text }}>
                {on ? "…" : keyLabel(keys[a.id])}
              </button>
            </div>
          );
        })}
      </div>
      {warn && <div className="tb-t mt-2" style={{ color: UI.bad }}>{warn}</div>}
    </div>
  );
}

function Row({ label, children }) {
  return (
    <div className="flex items-center justify-between gap-3 py-2.5" style={{ ...RULE_BELOW }}>
      <span className="tb-t shrink-0" style={{ color: UI.dim }}>{label}</span>
      <div className="flex items-center gap-1.5 flex-wrap justify-end">{children}</div>
    </div>
  );
}

function Toggle({ on, onClick }) {
  return (
    <button onClick={onClick} role="switch" aria-checked={on}
      className="shrink-0"
      style={{
        width: 46, height: 26, ...sk(on ? UI.text : UI.line), padding: 4,
        display: "flex", justifyContent: on ? "flex-end" : "flex-start",
      }}>
      <span style={{ width: 16, height: "100%", display: "block", ...skFill(on ? UI.text : UI.dim, { dense: true }), opacity: on ? 1 : 0.6 }} />
    </button>
  );
}

function ThemeModal({ theme, setTheme, onClose }) {
  const [tab, setTab] = useState("preset");
  const set = (patch) => setTheme(editTheme(theme, patch));

  const previewBoard = useMemo(() => {
    const b = initialBoard();
    // A few squares each, within the smallest board the game uses.
    const last = ROWS - 1;
    const moves = [["A", [[last - 1, 4], [last - 1, 5], [last - 2, 4]]], ["B", [[1, 5], [1, 6], [2, 6]]],
      ["A", [[last - 3, 3], [last - 4, 3]]], ["B", [[3, 7], [3, 8]]]];
    for (const [who, cells] of moves) for (const [r, c] of cells) b[r][c] = who;
    return b;
  }, []);

  return (
    <Popup title="THEME" onClose={onClose} maxW={420}>
      {/* live preview */}
      <div className="mt-3 mb-4 rounded p-3 flex justify-center" style={{ background: UI.ground, ...sk(UI.line) }}>
        <div style={{ transform: "scale(1)", transformOrigin: "top center" }}>
          <BoardGrid
            board={previewBoard} cell={15}
            ink={{ A: theme.you, B: theme.rival, S: theme.special }}
            theme={theme} youSide="A"
            ghostKeys={new Set()} ghostLegal={false} ghostInk={theme.you}
            contestedKeys={new Set()} boardRef={null} onPointerDown={undefined}
          />
        </div>
      </div>

      <div className="flex gap-1.5 mb-3">
        {[["preset", "PRESETS"], ["colour", "COLOURS"], ["blocks", "BLOCKS"]].map(([k, label]) => (
          <button key={k} onClick={() => setTab(k)}
            className="flex-1 rounded tb-t"
            style={{
              height: 34,
              color: tab === k ? UI.text : UI.dim,
              ...(tab === k ? skFill(UI.text) : sk(UI.line)),
            }}>{label}</button>
        ))}
      </div>

      {tab === "preset" && (
        <div className="grid grid-cols-2 gap-2 pb-2">
          {Object.entries(PRESETS).map(([k, p]) => {
            const on = theme.preset === k;
            return (
              <button key={k} onClick={() => setTheme(applyPreset(theme, k))}
                className="rounded p-2.5 text-left"
                style={{ background: p.ground, ...sk(on ? p.you : UI.line) }}>
                <div className="flex gap-1 mb-2">
                  {[p.you, p.rival, p.special, p.cell].map((c, i) => (
                    <span key={i} style={{ width: 16, height: 16, borderRadius: 3, background: c, display: "block" }} />
                  ))}
                </div>
                <div className="tb-t" style={{ color: p.text }}>{p.label}</div>
              </button>
            );
          })}
          {theme.preset === "custom" && (
            <div className="rounded p-2.5 col-span-2 tb-t"
              style={{ ...sk(UI.line), color: UI.dim }}>
              CUSTOM — edited from a preset
            </div>
          )}
        </div>
      )}

      {tab === "colour" && (
        <div className="pb-2">
          <Row label="YOUR INK">
            {INKS.map((c) => <Swatch key={c} color={c} on={theme.you === c} onClick={() => set({ you: c })} />)}
          </Row>
          <Row label="OPPONENT">
            {INKS.map((c) => <Swatch key={c} color={c} on={theme.rival === c} onClick={() => set({ rival: c })} />)}
          </Row>
          <Row label="CENTRE">
            {INKS.map((c) => <Swatch key={c} color={c} on={theme.special === c} onClick={() => set({ special: c })} />)}
          </Row>
          <div className="tb-t mt-4 mb-2" style={{ color: UI.dim }}>SURFACES</div>
          {[["BACKGROUND", "ground"], ["PANELS", "panel"], ["EMPTY CELL", "cell"], ["LINES", "line"], ["TEXT", "text"]].map(([label, k]) => (
            <Row key={k} label={label}>
              <input type="color" value={theme[k]} onChange={(e) => set({ [k]: e.target.value })}
                style={{ width: 44, height: 26, background: "transparent", ...sk(UI.line), borderRadius: 5, padding: 0 }} />
              <span className="tb-t tabular-nums" style={{ color: UI.dim }}>{theme[k]}</span>
            </Row>
          ))}
        </div>
      )}

      {tab === "blocks" && (
        <div className="pb-2">
          <div className="tb-t mb-2" style={{ color: UI.dim }}>STROKE</div>
          <div className="grid grid-cols-3 gap-2 mb-5">
            {Object.entries(STROKES).map(([k, st]) => {
              const on = theme.stroke === k;
              return (
                <button key={k} onClick={() => set({ stroke: k })}
                  className="flex flex-col items-center justify-center gap-2 py-3"
                  style={{ background: on ? UI.cell : "transparent", ...sk(on ? UI.text : UI.line) }}>
                  <div className="flex gap-1">
                    <Ink size={22} color={theme.you} stroke={k} dir={1} seed={2} />
                    <Ink size={22} color={theme.rival} stroke={k} dir={-1} seed={5} />
                  </div>
                  <span className="tb-t" style={{ color: on ? UI.text : UI.dim }}>{st.label}</span>
                </button>
              );
            })}
          </div>

          <Row label="GRID GAP">
            {GRID_GAPS.map((g) => (
              <button key={g} onClick={() => set({ gap: g })}
                className="rounded tb-t tabular-nums"
                style={{
                  width: 34, height: 30,

                  color: theme.gap === g ? UI.text : UI.dim,
                  ...(theme.gap === g ? skFill(UI.text) : sk(UI.line)),
                }}>{g}</button>
            ))}
          </Row>
          <Row label="COLOURBLIND MARKS"><Toggle on={theme.colorblind} onClick={() => set({ colorblind: !theme.colorblind })} /></Row>
          <div className="tb-t pt-3" style={{ color: UI.dim }}>
            Marks put ○ on your squares, ✕ on your opponent's and ◆ on contested ones,
            so the board reads without relying on colour.
          </div>
        </div>
      )}

      <div className="tb-t pt-4 mt-2" style={{ color: UI.dim, ...RULE_ABOVE }}>
        Themes are stored on this device only. Your opponent sees their own.
      </div>
    </Popup>
  );
}

/* ============================================================
   AUTH — sign in / sign up
   ============================================================ */
function GoogleButton({ onCredential }) {
  const box = useRef(null);
  useEffect(() => {
    if (!GOOGLE_CLIENT_ID || !SHOW_GOOGLE || !box.current) return;
    let cancelled = false;
    const render = () => {
      if (cancelled || !window.google?.accounts?.id || !box.current) return;
      window.google.accounts.id.initialize({
        client_id: GOOGLE_CLIENT_ID,
        callback: (res) => onCredential(res.credential),
      });
      window.google.accounts.id.renderButton(box.current, {
        theme: "filled_black", size: "large", width: 300, shape: "rectangular",
        text: "continue_with",
      });
    };
    if (window.google?.accounts?.id) { render(); return; }
    const existing = document.getElementById("gsi-script");
    if (existing) { existing.addEventListener("load", render); return () => existing.removeEventListener("load", render); }
    const sc = document.createElement("script");
    sc.src = "https://accounts.google.com/gsi/client";
    sc.async = true;
    sc.id = "gsi-script";
    sc.onload = render;
    document.head.appendChild(sc);
    return () => { cancelled = true; };
  }, [onCredential]);

  if (!GOOGLE_CLIENT_ID || !SHOW_GOOGLE) return null;
  return (
    <>
      <div className="flex items-center gap-3 my-4">
        <span className="flex-1 h-px" style={{ background: UI.line }} />
        <span className="tb-t" style={{ color: UI.dim }}>OR</span>
        <span className="flex-1 h-px" style={{ background: UI.line }} />
      </div>
      <div ref={box} className="flex justify-center" />
    </>
  );
}

const fieldStyle = {
  height: 46, background: UI.ground, ...sk(UI.line),
  color: UI.text, outline: "none", borderRadius: 6,
};

function AuthModal({ mode, onClose, onSwitch }) {
  const authState = useAuth();
  const profile = useProfile();
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [local, setLocal] = useState(null);
  const signup = mode === "signup";

  // Signed in AND verified: nothing left to do here.
  useEffect(() => {
    if (authState === "authed" && profile?.emailVerified) onClose();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authState, profile?.emailVerified]);

  if (authState === "authed" && profile && !profile.emailVerified) {
    return <VerifyModal profile={profile} onClose={onClose} />;
  }

  const submit = () => {
    setLocal(null);
    if (!username.trim() || !password) return setLocal("Fill in every field.");
    if (signup && !email.trim()) return setLocal("We need an email to verify your account.");
    if (signup && password !== confirm) return setLocal("Passwords don't match.");
    if (signup) net.signup(username.trim(), email.trim(), password);
    else net.login(username.trim(), password);
  };

  const err = local || net.authError;

  return (
    <Popup title={signup ? "NEW PLAYER" : "LOG IN"} onClose={onClose} maxW={360}>
      <div className="pt-4 pb-1">
        <div className="tb-t mb-2" style={{ color: UI.dim }}>USERNAME</div>
        <input value={username} autoCapitalize="none" autoCorrect="off" maxLength={16}
          onChange={(e) => setUsername(e.target.value)} onKeyDown={(e) => e.key === "Enter" && submit()}
          className="w-full px-3 mb-4 tb-t font-mono" style={fieldStyle} />

        {signup && (
          <>
            <div className="tb-t mb-2" style={{ color: UI.dim }}>EMAIL</div>
            <input value={email} type="email" autoCapitalize="none" autoCorrect="off"
              onChange={(e) => setEmail(e.target.value)} onKeyDown={(e) => e.key === "Enter" && submit()}
              className="w-full px-3 mb-4 tb-t font-mono" style={fieldStyle} />
          </>
        )}

        <div className="tb-t mb-2" style={{ color: UI.dim }}>PASSWORD</div>
        <input type="password" value={password} autoCapitalize="none"
          onChange={(e) => setPassword(e.target.value)} onKeyDown={(e) => e.key === "Enter" && submit()}
          className="w-full px-3 mb-4 tb-t font-mono" style={fieldStyle} />

        {signup && (
          <>
            <div className="tb-t mb-2" style={{ color: UI.dim }}>CONFIRM PASSWORD</div>
            <input type="password" value={confirm} autoCapitalize="none"
              onChange={(e) => setConfirm(e.target.value)} onKeyDown={(e) => e.key === "Enter" && submit()}
              className="w-full px-3 mb-4 tb-t font-mono" style={fieldStyle} />
            <div className="tb-t mb-4" style={{ color: UI.dim }}>
              3–16 letters, numbers or underscores. Password at least 8 characters.
              We'll email you a 5-digit code.
            </div>
          </>
        )}

        {err && (
          <div className="tb-t mb-4 rounded px-3 py-2"
            style={{ color: UI.bad, ...sk(UI.badSoft), background: UI.badFaint }}>{err}</div>
        )}

        <button onClick={submit} disabled={net.authBusy}
          className="w-full rounded tb-t disabled:opacity-40"
          style={{ height: 48, ...skFill(UI.text), color: UI.text }}>
          {net.authBusy ? "…" : signup ? "CREATE ACCOUNT" : "LOG IN"}
        </button>

        <GoogleButton onCredential={(c) => net.google(c)} />

        <button onClick={() => onSwitch(signup ? "login" : "signup")}
          className="w-full tb-t mt-4 py-2" style={{ color: UI.dim }}>
          {signup ? "I ALREADY HAVE AN ACCOUNT" : "CREATE AN ACCOUNT"}
        </button>
        {!signup && (
          <button onClick={() => { net.authError = null; net.resetSent = false; onSwitch("reset"); }}
            className="w-full tb-t py-2" style={{ color: UI.dim }}>
            FORGOT PASSWORD?
          </button>
        )}
        {signup && <div className="text-center mt-2"><LegalLinks prefix="By creating an account you agree to the " /></div>}

        <div className="flex items-center gap-2 tb-t mt-4 pt-4"
          style={{ color: IS_SECURE ? UI.dim : GOLD, ...RULE_ABOVE }}>
          {IS_SECURE ? <Lock size={11} /> : <ShieldAlert size={11} />}
          {IS_SECURE ? "Encrypted connection." : "Unencrypted connection — local testing only."}
        </div>
      </div>
    </Popup>
  );
}

/** Links to the policy pages served next to the app (public/privacy.html, public/terms.html). */
function LegalLinks({ prefix = null }) {
  const a = { color: UI.dim, textDecoration: "underline", textUnderlineOffset: 2 };
  return (
    <div className="tb-t" style={{ color: UI.dim }}>
      {prefix}
      <a href="/terms" target="_blank" rel="noopener" style={a}>Terms</a>
      {prefix ? " and " : " · "}
      <a href="/privacy" target="_blank" rel="noopener" style={a}>{prefix ? "Privacy Policy" : "Privacy"}</a>
      {prefix ? "." : null}
    </div>
  );
}

/* ============================================================
   RESET — forgot password: email → code → new password
   ============================================================ */
function ResetModal({ onClose, onBack }) {
  const authState = useAuth();
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [local, setLocal] = useState(null);

  // A successful reset signs you straight in.
  useEffect(() => {
    if (authState === "authed") onClose();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authState]);

  const sent = net.resetSent;
  const err = local || net.authError;

  const request = () => {
    setLocal(null);
    if (!email.trim()) return setLocal("Enter the email you signed up with.");
    net.requestReset(email.trim());
  };
  const confirmReset = () => {
    setLocal(null);
    if (code.length !== 5) return setLocal("Enter the 5-digit code from the email.");
    if (password.length < 8) return setLocal("Password must be at least 8 characters.");
    if (password !== confirm) return setLocal("Passwords don't match.");
    net.confirmReset(email.trim(), code, password);
  };
  const label = (t) => <div className="tb-t mb-2" style={{ color: UI.dim }}>{t}</div>;

  return (
    <Popup title="RESET PASSWORD" onClose={onClose} maxW={360}>
      <div className="pt-4 pb-1">
        {!sent ? (
          <>
            <div className="tb-t mb-4" style={{ color: UI.dim }}>
              Enter the email on your account and we'll send a 5-digit code.
            </div>
            {label("EMAIL")}
            <input value={email} type="email" autoCapitalize="none" autoCorrect="off" autoFocus
              onChange={(e) => setEmail(e.target.value)} onKeyDown={(e) => e.key === "Enter" && request()}
              className="w-full px-3 mb-4 tb-t font-mono" style={fieldStyle} />
          </>
        ) : (
          <>
            <div className="tb-t mb-4" style={{ color: UI.dim }}>
              If <span style={{ color: UI.text }}>{email.trim()}</span> has an account, a code is on its way.
              It expires in 15 minutes.
            </div>
            {label("CODE")}
            <input value={code} inputMode="numeric" maxLength={5} autoFocus
              onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 5))}
              className="w-full px-3 mb-4 font-mono" style={{ ...fieldStyle, fontSize: 20, letterSpacing: "0.4em" }} />
            {label("NEW PASSWORD")}
            <input type="password" value={password} autoCapitalize="none"
              onChange={(e) => setPassword(e.target.value)}
              className="w-full px-3 mb-4 tb-t font-mono" style={fieldStyle} />
            {label("CONFIRM PASSWORD")}
            <input type="password" value={confirm} autoCapitalize="none"
              onChange={(e) => setConfirm(e.target.value)} onKeyDown={(e) => e.key === "Enter" && confirmReset()}
              className="w-full px-3 mb-4 tb-t font-mono" style={fieldStyle} />
          </>
        )}

        {err && (
          <div className="tb-t mb-4 px-3 py-2"
            style={{ color: UI.bad, ...sk(UI.badSoft), background: UI.badFaint }}>{err}</div>
        )}

        <button onClick={sent ? confirmReset : request} disabled={net.authBusy}
          className="w-full tb-t disabled:opacity-40"
          style={{ height: 48, ...skFill(UI.text), color: UI.text }}>
          {net.authBusy ? "…" : sent ? "SET NEW PASSWORD" : "SEND CODE"}
        </button>

        {sent && (
          <button onClick={() => { net.resetSent = false; setCode(""); net.bumpAuth(); }}
            className="w-full tb-t mt-3 py-2" style={{ color: UI.dim }}>
            DIDN'T GET IT? SEND AGAIN
          </button>
        )}
        <button onClick={onBack} className="w-full tb-t mt-2 py-2" style={{ color: UI.dim }}>
          BACK TO LOG IN
        </button>
      </div>
    </Popup>
  );
}

/* ============================================================
   VERIFY — 5-digit email code
   ============================================================ */
function VerifyModal({ profile, onClose }) {
  useAuth();
  const [digits, setDigits] = useState("");
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (!cooldown) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  const submit = (code) => { if (code.length === 5) net.verify(code); };
  const onChange = (v) => {
    const clean = v.replace(/\D/g, "").slice(0, 5);
    setDigits(clean);
    if (clean.length === 5) submit(clean);
  };

  return (
    <Popup title="VERIFY EMAIL" onClose={onClose} maxW={340}>
      <div className="pt-5 pb-1 text-center">
        <MailCheck size={24} style={{ color: UI.dim, margin: "0 auto 14px" }} />
        <div className="tb-t mb-1">We sent a 5-digit code to</div>
        <div className="tb-t mb-6">{profile.email}</div>

        <input
          value={digits} inputMode="numeric" autoFocus maxLength={5}
          onChange={(e) => onChange(e.target.value)}
          className="w-full text-center font-mono mb-4"
          style={{ ...fieldStyle, height: 58, fontSize: 26, letterSpacing: "0.5em", textIndent: "0.5em" }}
        />

        {net.authError && (
          <div className="tb-t mb-4 rounded px-3 py-2"
            style={{ color: UI.bad, ...sk(UI.badSoft), background: UI.badFaint }}>
            {net.authError}
          </div>
        )}
        {net.codeSent && !net.authError && (
          <div className="tb-t mb-4" style={{ color: UI.good }}>New code sent.</div>
        )}

        <button onClick={() => submit(digits)} disabled={digits.length !== 5 || net.authBusy}
          className="w-full rounded tb-t disabled:opacity-40 mb-3"
          style={{ height: 48, ...skFill(UI.text), color: UI.text }}>VERIFY</button>

        <button onClick={() => { net.resend(); setCooldown(60); }} disabled={cooldown > 0}
          className="w-full tb-t py-2 disabled:opacity-40" style={{ color: UI.dim }}>
          {cooldown > 0 ? `RESEND IN ${cooldown}s` : "RESEND CODE"}
        </button>

        <div className="tb-t mt-4 pt-4" style={{ color: UI.dim, ...RULE_ABOVE }}>
          Ranked play unlocks once your email is verified. Solo and take-turns work now.
        </div>
      </div>
    </Popup>
  );
}

/* ============================================================
   ACCOUNT — who you are
   ============================================================ */
function AccountModal({ profile, onLogout, onClose }) {
  if (!profile) {
    return (
      <Popup title="ACCOUNT" onClose={onClose} maxW={380}>
        <div className="py-10 text-center tb-t" style={{ color: UI.dim }}>Signed out.</div>
      </Popup>
    );
  }
  const st = profile.stats;
  const tr = Math.round(profile.rating.r);
  const placed = st.games >= PLACEMENT_GAMES;
  const rank = RANKS[rankIndexFor(tr)];
  const winRate = st.games ? Math.round((st.wins / st.games) * 100) : 0;
  const since = profile.createdAt
    ? new Date(profile.createdAt).toLocaleDateString(undefined, { month: "short", year: "numeric" })
    : "—";

  return (
    <Popup title="ACCOUNT" onClose={onClose} maxW={380}>
      <div className="pt-4">
        <div className="flex items-center gap-4 mb-5">
          <div className="rounded flex items-center justify-center shrink-0"
            style={{ width: 62, height: 62, background: placed ? `${rank.color}1F` : UI.ground, ...sk(placed ? rank.color : UI.line) }}>
            <span className="tb-t" style={{ color: placed ? rank.color : UI.dim }}>{placed ? rank.name : "–"}</span>
          </div>
          <div className="min-w-0">
            <div className="tb-t truncate">{profile.name}</div>
            <div className="tb-t mt-1" style={{ color: UI.dim }}>
              {placed ? `${tr} TR ±${Math.round(profile.rating.rd)}` : `${PLACEMENT_GAMES - st.games} matches to place`}
            </div>
            <div className="tb-t mt-0.5" style={{ color: UI.dim }}>member since {since}</div>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-2 mb-5">
          {[
            ["WIN RATE", `${winRate}%`, winRate >= 50 ? UI.good : UI.text],
            ["RECORD", `${st.wins}–${st.losses}`, UI.text],
            ["PLAYED", fmtTime(st.seconds), UI.text],
          ].map(([label, value, color]) => (
            <div key={label} className="rounded p-2.5" style={{ background: UI.ground, ...sk(UI.line) }}>
              <div className="tb-t mb-1.5" style={{ color: UI.dim }}>{label}</div>
              <div className="tb-t" style={{ color }}>{value}</div>
            </div>
          ))}
        </div>

        <div className="grid grid-cols-2 gap-2 mb-6">
          <div className="rounded p-2.5" style={{ background: UI.ground, ...sk(UI.line) }}>
            <div className="tb-t mb-1.5" style={{ color: UI.dim }}>PEAK</div>
            <div className="tb-t" style={{ color: st.peakRank !== null ? RANKS[st.peakRank].color : UI.dim }}>
              {st.peakRank !== null ? `${RANKS[st.peakRank].name} · ${st.peakTr}` : "unplaced"}
            </div>
          </div>
          <div className="rounded p-2.5" style={{ background: UI.ground, ...sk(UI.line) }}>
            <div className="tb-t mb-1.5" style={{ color: UI.dim }}>BEST STREAK</div>
            <div className="tb-t">W{st.bestStreak}</div>
          </div>
        </div>

        <button onClick={onLogout}
          className="w-full rounded tb-t flex items-center justify-center gap-2"
          style={{ height: 44, ...sk(UI.line), color: UI.dim }}>
          <LogOut size={13} /> SIGN OUT
        </button>
      </div>
    </Popup>
  );
}

/* ============================================================
   HOW TO PLAY
   ============================================================ */
function MiniBoard({ w, h, cells, size = 15, ink }) {
  return (
    <div style={{
      display: "grid",
      gridTemplateColumns: `repeat(${w}, ${size}px)`,
      gridTemplateRows: `repeat(${h}, ${size}px)`,
      gap: 2, padding: 2, margin: "0 auto",
    }}>
      {Array.from({ length: w * h }).map((_, i) => {
        const r = Math.floor(i / w), c = i % w;
        const v = cells[`${r},${c}`];
        if (v === "A" || v === "B" || v === "S") return <Ink key={i} size={size} color={ink[v]} {...inkOf(v)} seed={i} />;
        if (v === "ok" || v === "no") return <Ink key={i} size={size} stroke="ghost" color={v === "ok" ? ink.A : UI.bad} seed={i} />;
        return <Ink key={i} size={size} stroke="slot" color={UI.line} seed={i} />;
      })}
    </div>
  );
}

function HowToModal({ colors, loadout, onClose }) {
  const [page, setPage] = useState(0);
  const ink = { A: colors.you, B: colors.rival, S: colors.special };

  const pages = [
    {
      title: "THE GOAL",
      art: <MiniBoard w={6} h={6} ink={ink} cells={{
        "0,2": "B", "0,3": "B", "1,2": "B", "1,3": "B", "1,4": "B", "2,4": "B",
        "5,2": "A", "5,3": "A", "4,1": "A", "4,2": "A", "4,3": "A", "3,1": "A",
      }} />,
      body: `Own more of the ${COLS}×${ROWS} board than your opponent after ${TURNS} turns. Each square is a point; the four centre squares are worth ${RULES.centreValue}.`,
    },
    {
      title: "ONE PIECE A TURN",
      art: (
        <div className="flex items-center justify-center gap-3">
          <BlockGlyph blockId={loadout[0]} box={40} color={colors.you} />
          <ChevronRight size={16} style={{ color: UI.dim }} />
          {loadout.slice(1, 5).map((id, i) => <BlockGlyph key={i} blockId={id} box={20} color={colors.you} />)}
        </div>
      ),
      body: "You don't choose from a hand. You play the piece at the front of your queue — rotate it and place it, or pass. Your whole queue is shown, so plan ahead.",
    },
    {
      title: "PLACING",
      art: <MiniBoard w={6} h={5} ink={ink} cells={{
        "2,2": "A", "2,3": "A",
        "1,4": "ok", "3,1": "no",
      }} />,
      body: "A piece must land on empty squares AND touch ink you already own. Corners count, so diagonal contact is enough. The red one is floating on its own — illegal.",
    },
    {
      title: "BOTH AT ONCE",
      art: <MiniBoard w={6} h={5} ink={ink} cells={{
        "3,1": "A", "3,2": "A", "4,1": "A",
        "1,4": "B", "1,3": "B", "0,4": "B",
      }} />,
      body: "There are no alternating turns. You both choose in secret and the moves land together. If you both grab the same square, it stays empty.",
    },
    {
      title: "FULL LINES CLEAR",
      art: <MiniBoard w={6} h={4} ink={ink} cells={{
        "1,0": "A", "1,1": "A", "1,2": "B", "1,3": "A", "1,4": "A", "1,5": "ok",
        "0,1": "A", "2,4": "B", "3,2": "B",
      }} />,
      body: "Any row or column that fills up completely is wiped — both colours. Build too close to a full line and your opponent can finish it for you and delete your squares.",
    },
    {
      title: "YOUR DECK",
      art: (
        <div className="flex flex-wrap items-center justify-center gap-2.5">
          {loadout.map((id, i) => <BlockGlyph key={i} blockId={id} box={26} color={colors.you} />)}
        </div>
      ),
      body: "Pick eight pieces in the deck editor. They come round in passes, like Tetris bags: every pass deals all eight once, freshly shuffled. Your opponent sees your queue, and you see theirs.",
    },
  ];

  const p = pages[page];
  const last = page === pages.length - 1;

  return (
    <Popup title="HOW TO PLAY" onClose={onClose} maxW={380}>
      <div className="pt-4 pb-1">
        <div className="flex gap-1 mb-4">
          {pages.map((_, i) => (
            <div key={i} style={{
              flex: 1, height: 2, borderRadius: 2,
              background: i <= page ? colors.you : UI.line,
              transition: "background 200ms",
            }} />
          ))}
        </div>

        <div className="tb-t mb-4" style={{ color: UI.dim }}>{p.title}</div>

        <div className="rounded py-5 mb-4 flex items-center justify-center"
          style={{ background: UI.ground, ...sk(UI.line), minHeight: 132 }}>
          {p.art}
        </div>

        <div className="tb-t mb-5" style={{ minHeight: 76 }}>{p.body}</div>

        <div className="flex gap-2">
          <button
            onClick={() => setPage((n) => Math.max(0, n - 1))}
            disabled={page === 0}
            className="rounded tb-t disabled:opacity-30"
            style={{ height: 46, flex: 1, ...sk(UI.line), color: UI.dim }}
          >
            BACK
          </button>
          <button
            onClick={() => (last ? onClose() : setPage((n) => n + 1))}
            className="rounded tb-t"
            style={{ height: 46, flex: 1.6, ...skFill(UI.text), color: UI.text }}
          >
            {last ? "GOT IT" : "NEXT"}
          </button>
        </div>
      </div>
    </Popup>
  );
}

/* ============================================================
   MENU
   ============================================================ */
/** A pen underline that tapers at both ends: two loose strokes, never quite parallel. */
/**
 * The title, drawn as pixel art rather than set in a font: a bigger font
 * would mean bigger pixels. Letters are 19×25 pixels with thin 2-pixel
 * strokes, shaded in bands from your colour to your rival's.
 */
const LOGO_W = 19, LOGO_H = 25;
const LOGO = (() => {
  const W = LOGO_W, H = LOGO_H, mid = Math.floor(W / 2);
  const glyph = (paint) => { const g = Array.from({ length: H }, () => Array(W).fill(0)); paint((x, y) => { if (x >= 0 && y >= 0 && x < W && y < H) g[y][x] = 1; }); return g; };
  const rect = (set, x0, y0, w, h) => { for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) set(x, y); };
  const diag = (set, x0, y0, x1, y1) => {
    const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
    for (let i = 0; i <= n; i++) { const x = Math.round(x0 + ((x1 - x0) * i) / n), y = Math.round(y0 + ((y1 - y0) * i) / n); set(x, y); set(x + 1, y); }
  };
  return [
    glyph((s2) => { rect(s2, 0, 0, 2, H); rect(s2, W - 2, 0, 2, H); diag(s2, 1, 1, mid - 1, 13); diag(s2, W - 3, 1, mid, 13); }), // M
    glyph((s2) => { rect(s2, 4, 0, W - 8, 2); rect(s2, 4, H - 2, W - 8, 2); rect(s2, mid - 1, 0, 2, H); }),                      // I
    glyph((s2) => { rect(s2, 0, 0, 2, H); rect(s2, W - 2, 0, 2, H); diag(s2, 1, 1, W - 4, H - 2); }),                             // N
    glyph((s2) => { rect(s2, 2, 0, W - 4, 2); rect(s2, 2, H - 2, W - 4, 2); rect(s2, 0, 2, 2, H - 4); rect(s2, W - 2, 2, 2, H - 4);
      s2(1, 1); s2(W - 2, 1); s2(1, H - 2); s2(W - 2, H - 2); }),                                                               // O
  ];
})();

function PixelLogo() {
  const P = usePx();
  const W = LOGO_W, H = LOGO_H, GAP = 5;
  const total = LOGO.length * W + (LOGO.length - 1) * GAP;
  // One rect per horizontal run, per row band colour.
  const runs = [];
  LOGO.forEach((g, li) => g.forEach((row, y) => {
    let x = 0;
    while (x < W) {
      if (!row[x]) { x++; continue; }
      const st = x; while (x < W && row[x]) x++;
      runs.push([li * (W + GAP) + st, y, x - st]);
    }
  }));
  const BANDS = 6;
  return (
    <svg aria-label="MINO" role="img" className="tb-bob" viewBox={`0 0 ${total + 1} ${H + 1}`}
      style={{ width: (total + 1) * P, height: (H + 1) * P, display: "block", margin: "0 auto", shapeRendering: "crispEdges" }}>
      {runs.map(([x, y, w], i) => <rect key={`s${i}`} x={x + 1} y={y + 1} width={w} height={1} fill="rgba(0,0,0,.55)" />)}
      {runs.map(([x, y, w], i) => {
        const band = Math.min(BANDS - 1, Math.floor((y / H) * BANDS));
        return <rect key={i} x={x} y={y} width={w} height={1}
          style={{ fill: `color-mix(in srgb, var(--tb-you) ${100 - band * 19}%, var(--tb-rival))` }} />;
      })}
      {/* A one-pixel highlight along the top of each letter. */}
      {runs.filter(([, y]) => y === 0).map(([x, y, w], i) => <rect key={`h${i}`} x={x} y={y} width={w} height={1} fill="rgba(255,255,255,.75)" />)}
    </svg>
  );
}

/** Under the title: a row of pixels with a light running along it. */
function PixelRule({ count = 18 }) {
  return (
    <div aria-hidden="true" className="relative flex justify-center gap-[3px] mt-3 mx-auto" style={{ width: count * 9 }}>
      {Array.from({ length: count }).map((_, i) => {
        const t = i / (count - 1);
        return (
          <span key={i} style={{
            width: 6, height: 6, display: "block",
            background: `color-mix(in srgb, var(--tb-you) ${Math.round((1 - t) * 100)}%, var(--tb-rival))`,
            opacity: 0.35 + 0.65 * Math.sin(Math.PI * t),
            boxShadow: "0 0 6px color-mix(in srgb, var(--tb-you) 50%, transparent)",
          }} />
        );
      })}
      <span className="tb-runner" />
    </div>
  );
}
function Menu({ onPick, loadout, setLoadout, colors, profile, status, name, rename, onLogout, theme, setTheme }) {
  const [modal, setModal] = useState(null);
  const authed = useAuth() === "authed";
  const verified = !!profile?.emailVerified;
  const color = theme.you;
  const tr = profile ? Math.round(profile.rating.r) : null;
  const placed = profile && profile.stats.games >= PLACEMENT_GAMES;
  const rank = tr !== null ? RANKS[rankIndexFor(tr)] : null;
  const online = useOnline();
  const notice = useNotice();

  return (
    <div className="tb-screen tb-safe relative w-full flex items-center justify-center px-5 font-mono overflow-hidden" style={{ color: UI.text }}>
      <AmbientField colors={colors} theme={theme} paused={!!modal} />
      <div className="absolute inset-0 pointer-events-none" style={{ background: "radial-gradient(ellipse at 50% 46%, color-mix(in srgb, var(--tb-ground) 45%, transparent) 0%, color-mix(in srgb, var(--tb-ground) 20%, transparent) 50%, transparent 80%)" }} />

      <Scaled className="relative w-full" style={{ maxWidth: 330 }}>
        <div className="text-center mb-9">
          <PixelLogo />
          <PixelRule />
        </div>

        <button
          onClick={() => {
            if (status !== "online") return;
            if (!authed) return setModal("login");
            if (!verified) return setModal("VERIFY");
            onPick("MATCHMAKING");
          }}
          disabled={status !== "online"}
          className="w-full rounded flex flex-col items-center justify-center gap-1 mb-2.5 disabled:opacity-40"
          style={{ height: 98, background: UI.panel, ...sk(authed && verified && placed ? rank.color : UI.line) }}
        >
          <span className="tb-t" style={{ color: UI.dim }}>
            {status !== "online" ? (status === "connecting" ? "CONNECTING…" : "SERVER OFFLINE")
              : !authed ? "ACCOUNT REQUIRED"
              : !verified ? "VERIFY YOUR EMAIL"
              : placed ? `RANKED · ${rank.name} · ${tr}` : "RANKED · UNPLACED"}
          </span>
          <span className="tb-t" style={{ textDecoration: authed && verified ? "none" : "line-through", textDecorationThickness: 1 }}>
            MULTIPLAYER
          </span>
          {status === "online" && online !== null && (
            <span className="tb-t italic" style={{ color: UI.dim }}>
              {online === 1 ? "just you online right now" : `${online} people online`}
            </span>
          )}
        </button>

        {notice && (
          <button onClick={() => net.setNotice(null)} className="w-full text-left tb-t px-3 py-2 mb-2.5"
            style={{ ...sk(GOLD_SOFT), color: GOLD }}>
            {notice} <span style={{ color: UI.dim }}>(tap to dismiss)</span>
          </button>
        )}

        {!authed && (
          <div className="flex gap-2.5 mb-2.5">
            <button onClick={() => setModal("login")} disabled={status !== "online"}
              className="flex-1 rounded flex items-center justify-center disabled:opacity-40"
              style={{ height: 44, background: UI.panel, ...sk(UI.line) }}>
              <span className="tb-t">LOGIN</span>
            </button>
            <button onClick={() => setModal("signup")} disabled={status !== "online"}
              className="flex-1 rounded flex items-center justify-center disabled:opacity-40"
              style={{ height: 44, ...skFill(UI.text), color: UI.text }}>
              <span className="tb-t">NEW PLAYER</span>
            </button>
          </div>
        )}

        <div className="flex gap-2.5 mb-2.5">
          <button onClick={() => { onPick("DIFFICULTY"); }} className="flex-1 rounded flex items-center justify-center" style={{ height: 44, background: UI.panel, ...sk(UI.line) }}>
            <span className="tb-t">SP</span>
          </button>
          <button onClick={() => { onPick("HOTSEAT"); }} className="flex-1 rounded flex items-center justify-center" style={{ height: 44, background: UI.panel, ...sk(UI.line) }}>
            <span className="tb-t">TAKE TURNS</span>
          </button>
        </div>

        <div className="flex justify-between">
          <div className="flex gap-2.5">
            <button onClick={() => setModal("DECK")} aria-label="Your blocks" className="flex items-center justify-center" style={{ width: 44, height: 44, ...skFill(color) }}>
              <div style={{ display: "grid", gridTemplateColumns: "8px 8px", gap: 2 }}>
                {[0, 1, 2, 3].map((i) => (
                  <div key={i} style={{ background: i === 1 ? "transparent" : color, opacity: 0.85, height: 8 }} />
                ))}
              </div>
            </button>
            <button onClick={() => setModal("HOWTO")} aria-label="How to play"
              className="rounded flex items-center justify-center"
              style={{ width: 44, height: 44, background: UI.panel, ...sk(UI.line) }}>
              <BookOpen size={17} style={{ color: UI.dim }} />
            </button>
            <button onClick={() => setModal("THEME")} aria-label="Theme"
              className="rounded flex items-center justify-center"
              style={{ width: 44, height: 44, background: UI.panel, ...sk(UI.line) }}>
              <Palette size={17} style={{ color: UI.dim }} />
            </button>
          </div>
          <div className="flex gap-2.5">
            <button onClick={() => setModal(authed ? "ACCOUNT" : "login")} aria-label="Account"
              className="rounded flex items-center justify-center"
              style={{ width: 44, height: 44, background: UI.panel, ...sk(authed && verified ? UI.line : GOLD_SOFT) }}>
              <UserRound size={17} style={{ color: authed && verified ? UI.dim : GOLD }} />
            </button>
            <button onClick={() => setModal("STATS")} aria-label="Stats" className="rounded flex items-center justify-center" style={{ width: 44, height: 44, background: UI.panel, ...sk(UI.line) }}>
              <BarChart3 size={17} style={{ color: UI.dim }} />
            </button>
            <button onClick={() => setModal("SETTINGS")} aria-label="Settings" className="rounded flex items-center justify-center" style={{ width: 44, height: 44, background: UI.panel, ...sk(UI.line) }}>
              <Settings2 size={17} style={{ color: UI.dim }} />
            </button>
          </div>
        </div>
      </Scaled>

      {(modal === "login" || modal === "signup") && (
        <AuthModal mode={modal} onClose={() => setModal(null)} onSwitch={setModal} />
      )}
      {modal === "reset" && <ResetModal onClose={() => setModal(null)} onBack={() => setModal("login")} />}
      {modal === "VERIFY" && profile && <VerifyModal profile={profile} onClose={() => setModal(null)} />}
      {modal === "THEME" && <ThemeModal theme={theme} setTheme={setTheme} onClose={() => setModal(null)} />}
      {modal === "HOWTO" && <HowToModal colors={colors} loadout={loadout} onClose={() => setModal(null)} />}
      {modal === "ACCOUNT" && (
        <AccountModal profile={profile} onLogout={() => { setModal(null); onLogout(); }} onClose={() => setModal(null)} />
      )}
      {modal === "SETTINGS" && <SettingsModal name={name} rename={rename} status={status} theme={theme} setTheme={setTheme} onClose={() => setModal(null)} />}
      {modal === "STATS" && <StatsModal profile={profile} status={status} onClose={() => setModal(null)} />}
      {modal === "DECK" && <DeckModal loadout={loadout} setLoadout={setLoadout} color={color} onClose={() => setModal(null)} />}
    </div>
  );
}

/* ============================================================
   DIFFICULTY
   ============================================================ */
function Difficulty({ onStart, onBack, colors }) {
  const [lv, setLv] = useState(DEFAULT_LEVEL);
  return (
    <div className="tb-screen tb-safe w-full flex items-center justify-center px-5 font-mono" style={{ color: UI.text }}>
      <Scaled className="w-full" style={{ maxWidth: 330 }}>
        <button onClick={onBack} className="flex items-center gap-1 tb-t mb-6 py-2" style={{ color: UI.dim }}>
          <ChevronLeft size={13} /> MENU
        </button>
        <div className="tb-t mb-3" style={{ color: UI.dim }}>OPPONENT STRENGTH</div>
        <div className="grid grid-cols-5 gap-1.5 mb-4">
          {LEVELS.map((nm, i) => {
            const n = i + 1, on = lv === n;
            return (
              <button key={n} onClick={() => { setLv(n); }}
                className="rounded flex items-center justify-center tb-t"
                style={{
                  height: 44,
                  color: UI.text,
                  ...(on ? skFill(colors.rival) : sk(UI.line)),
                  opacity: on ? 1 : 0.45 + (n / LEVELS.length) * 0.5,
                }}>{n}</button>
            );
          })}
        </div>
        <div className="rounded p-3 mb-4" style={{ background: UI.panel, ...sk(UI.line), minHeight: 76 }}>
          <div className="tb-t mb-1" style={{ color: colors.rival }}>{LEVELS[lv - 1]}</div>
          <div className="tb-t" style={{ color: UI.dim }}>{levelBlurb(lv)}</div>
        </div>
        <button onClick={() => onStart(lv)} className="w-full rounded tb-t" style={{ height: 50, ...skFill(UI.text), color: UI.text }}>
          START MATCH
        </button>
      </Scaled>
    </div>
  );
}

/* ============================================================
   MATCHMAKING — driven by the server queue
   ============================================================ */
const BAND_CAP = 600;

// After this long with no opponent, offer the AI instead of a longer wait.
const LONELY_AFTER_S = 30;

function Matchmaking({ profile, loadout, colors, onCancel, onPlayAi }) {
  const search = useSearch();
  const found = useFound();
  const status = useStatus();

  useEffect(() => {
    net.queue(loadout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const tr = Math.round(profile.rating.r);
  const rank = RANKS[rankIndexFor(tr)];
  const oppRank = found ? RANKS[rankIndexFor(found.opponent.rating)] : null;
  const band = search?.band ?? 40;
  const elapsed = search?.elapsed ?? 0;

  return (
    <div className="tb-screen tb-safe w-full flex flex-col items-center justify-center px-6 font-mono" style={{ color: UI.text }}>
      <Scaled className="w-full" style={{ maxWidth: 330 }}>
        {!found ? (
          <>
            <div className="text-center mb-8">
              <div className="tb-t tb-pulse mb-2" style={{ color: colors.you }}>SEARCHING</div>
              <div className="tb-t tabular-nums">{elapsed.toFixed(1)}s</div>
            </div>

            <div className="mb-6">
              <div className="flex justify-between tb-t mb-2" style={{ color: UI.dim }}>
                <span>±{band} TR</span>
                <span>{search?.queued ?? 1} in queue</span>
              </div>
              <div className="relative h-9 rounded overflow-hidden" style={{ background: UI.cell }}>
                <div className="absolute inset-y-0" style={{
                  left: `${Math.max(0, 50 - (band / (BAND_CAP * 2)) * 100)}%`,
                  right: `${Math.max(0, 50 - (band / (BAND_CAP * 2)) * 100)}%`,
                  background: `${colors.you}22`,
                  borderLeft: `1px solid ${colors.you}88`,
                  borderRight: `1px solid ${colors.you}88`,
                  transition: "left 200ms linear, right 200ms linear",
                }} />
                <div className="absolute inset-y-0" style={{ left: "50%", width: 2, background: colors.you, transform: "translateX(-1px)" }} />
              </div>
              <div className="text-center tb-t mt-2 flex items-center justify-center gap-1.5"
                style={{ color: status === "online" ? UI.dim : GOLD }}>
                {status !== "online" && <WifiOff size={11} />}
                {tr} TR · {rank.name}
              </div>
            </div>

            <div className="tb-t text-center mb-8" style={{ color: UI.dim }}>
              {status === "online"
                ? null
                : status === "kicked"
                ? "You signed in somewhere else. Reload to take this session back."
                : "Lost the server — reconnecting. You'll rejoin the queue automatically."}
            </div>

            {elapsed >= LONELY_AFTER_S && (
              <div className="mb-3 tb-fade">
                <div className="tb-t italic text-center mb-2" style={{ color: UI.dim }}>
                  Quiet right now. Play the AI instead? Ranked can wait.
                </div>
                <button onClick={() => { net.unqueue(); onPlayAi(); }} className="w-full tb-t"
                  style={{ height: 46, ...skFill(UI.text), color: UI.text }}>
                  PLAY THE AI
                </button>
              </div>
            )}
            <button onClick={() => { net.unqueue(); onCancel(); }} className="w-full rounded tb-t" style={{ height: 46, ...sk(UI.line), color: UI.dim }}>
              CANCEL
            </button>
          </>
        ) : (
          <div className="text-center">
            <div className="tb-t mb-7" style={{ color: UI.dim }}>MATCH FOUND</div>
            <div className="flex items-center justify-center gap-4 mb-6">
              <div className="flex-1">
                <div className="rounded mx-auto flex items-center justify-center mb-2" style={{ width: 52, height: 52, background: `${rank.color}1F`, ...sk(rank.color) }}>
                  <span className="tb-t" style={{ color: rank.color }}>{rank.name}</span>
                </div>
                <div className="tb-t truncate">{profile.name}</div>
                <div className="tb-t" style={{ color: UI.dim }}>{tr}</div>
              </div>
              <span className="tb-t" style={{ color: UI.dim }}>VS</span>
              <div className="flex-1">
                <div className="rounded mx-auto flex items-center justify-center mb-2" style={{ width: 52, height: 52, background: `${oppRank.color}1F`, ...sk(oppRank.color) }}>
                  <span className="tb-t" style={{ color: oppRank.color }}>{oppRank.name}</span>
                </div>
                <div className="tb-t truncate">{found.opponent.name}</div>
                <div className="tb-t" style={{ color: UI.dim }}>{found.opponent.rating}</div>
              </div>
            </div>
            <div className="tb-t" style={{ color: UI.dim }}>{found.gap} TR apart</div>
          </div>
        )}
      </Scaled>
    </div>
  );
}

/** The FORFEIT bubble (red): asks before ending the match. */
function ForfeitButton({ onConfirm, ranked = false, disabled = false }) {
  const [asking, setAsking] = useState(false);
  const d = useBubble();
  return (
    <>
      <Bubble w={d} h={d} label="Forfeit" tint="#DB4F6D" fill={30} onClick={() => setAsking(true)} disabled={disabled}>
        <X />
      </Bubble>
      {asking && (
        <Popup title="FORFEIT?" onClose={() => setAsking(false)} maxW={320}>
          <div className="pt-4 pb-1">
            <div className="tb-t mb-5" style={{ color: UI.dim }}>
              {ranked ? "You'll lose this match and the rating that goes with it." : "This match ends now and counts as a loss."}
            </div>
            <div className="flex gap-2">
              <button onClick={() => setAsking(false)} className="flex-1 tb-t"
                style={{ height: 44, ...sk(UI.line), color: UI.dim }}>KEEP PLAYING</button>
              <button onClick={() => { setAsking(false); onConfirm(); }} className="flex-1 tb-t"
                style={{ height: 44, ...skFill(UI.text), color: UI.bad }}>FORFEIT</button>
            </div>
          </div>
        </Popup>
      )}
    </>
  );
}

/* ============================================================
   LOCAL GAME — hotseat and solo. Client owns everything.
   ============================================================ */
function LocalGame({ mode, aiLevel, loadout, colors, theme, onExit, onRestart }) {
  useEffect(() => { sky.slow = true; return () => { sky.slow = false; }; }, []);
  const solo = mode === "SOLO";
  const INK = useMemo(() => ({ A: colors.you, B: colors.rival, S: colors.special }), [colors]);

  const [board, setBoard] = useState(initialBoard);
  const [turn, setTurn] = useState(1);
  const [phase, setPhase] = useState("PLAY_A");
  const [decks, setDecks] = useState(() => ({ A: newDeck(loadout), B: newDeck(loadout) }));
  const [pendingA, setPendingA] = useState(null);
  const [reveal, setReveal] = useState(null);
  const [lockedOut, setLockedOut] = useState(false);
  const [forfeitBy, setForfeitBy] = useState(null); // "A" | "B" — whoever gave up
  const [stageRef, stage] = useSize();

  const player = phase === "PLAY_B" ? "B" : "A";
  // One piece per turn: the front of your queue.
  const piece = currentPiece(decks[player]);
  const hand = useMemo(() => [piece], [piece]);
  const inPlay = phase === "PLAY_A" || phase === "PLAY_B";
  const score = useMemo(() => scoreOf(board), [board]);
  const oppName = solo ? `AI ${LEVELS[aiLevel - 1]}` : "PLAYER 2";

  const pl = usePlacement({ board, owner: player, hand, enabled: inPlay });
  const contestedKeys = useMemo(() => new Set((reveal ? reveal.contested : []).map(([r, c]) => key(r, c))), [reveal]);
  const stuck = useMemo(() => (inPlay ? !hasAnyMove(board, hand, player) : false), [board, hand, player, inPlay]);

  const P = usePx();
  const compact = useCompact();
  const railD = useBubble();
  const { g, side, cell, boardW, boardH, groupW } = gameLayout(stage, theme, P, railD, compact);

  // The match is over: wash to the result screen.
  const wipe = useContext(WipeCtx);
  const [showEnd, setShowEnd] = useState(false);
  useEffect(() => {
    if (phase !== "DONE") return;
    const t = setTimeout(() => wipe(() => setShowEnd(true)), forfeitBy ? 0 : 500);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  // Played or passed, the current piece is spent and the queue moves on.
  const advance = (side) => setDecks((st) => ({ ...st, [side]: advanceDeck(st[side], loadout) }));

  const finish = (mA, mB) => {
    const res = resolveTurn(board, mA, mB);
    setBoard(res.board);
    setReveal({ contested: res.contested, cleared: res.cleared, lines: res.lines, a: mA, b: mB });
    setPhase("REVEAL");
  };

  const handOver = (move) => { setPendingA(move); setPhase(solo ? "AI_THINK" : "HANDOFF"); };

  const commit = () => {
    if (pl.sel.handIdx === null || !pl.ghost || !pl.ghostLegal) return;
    advance(player);
    const move = { cells: pl.ghost, value: BLOCKS[piece].cells.length, blockId: piece };
    if (player === "A") handOver(move); else finish(pendingA, move);
    pl.reset();
  };

  // Passing spends the current piece without placing it.
  const discard = () => {
    advance(player);
    if (player === "A") handOver(null); else finish(pendingA, null);
    pl.reset();
  };

  useGameKeys(pl, { enabled: inPlay, onCommit: commit, onDiscard: discard });

  // Each turn starts with the piece already in hand: under the cursor with a
  // mouse, on the nearest legal square on a touch screen.
  useEffect(() => {
    if (inPlay && !stuck) pl.select(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inPlay, turn, player]);

  useEffect(() => {
    if (phase !== "AI_THINK") return;
    const t = setTimeout(() => {
      const move = aiPickMove(board, currentPiece(decks.B), "B", aiLevel, LEVELS.length);
      advance("B");
      finish(pendingA, move ? { cells: move.cells, value: move.value, blockId: move.blockId } : null);
    }, AI_THINK_MS);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  useEffect(() => {
    if (phase !== "REVEAL") return;
    const t = setTimeout(() => {
      setReveal(null);
      setPendingA(null);
      // Locked: neither player can place any piece of their deck anywhere.
      const locked = !hasAnyMove(board, loadout, "A") && !hasAnyMove(board, loadout, "B");
      if (locked || turn >= TURNS) {
        setLockedOut(locked);
        setPhase("DONE");
      }
      else { setTurn((t2) => t2 + 1); setPhase("PLAY_A"); }
    }, REVEAL_MS);
    return () => clearTimeout(t);
  }, [phase, board, turn, loadout]);

  if (showEnd) {
    // A forfeit decides it regardless of the score.
    const winner = forfeitBy ? (forfeitBy === "A" ? "B" : "A") : score.a > score.b ? "A" : score.b > score.a ? "B" : null;
    const verdict = !winner ? "DRAW"
      : winner === "A" ? (solo ? "VICTORY" : "PLAYER 1 WINS")
      : solo ? "DEFEAT" : "PLAYER 2 WINS";
    const note = forfeitBy ? (solo ? "you forfeited" : `player ${forfeitBy === "A" ? 1 : 2} forfeited`)
      : lockedOut ? "board locked — no legal moves left" : null;
    return (
      <EndScreen
        verdict={verdict} ink={winner ? INK[winner] : UI.text} note={note}
        left={{ name: solo ? "YOU" : "P1", score: score.a, ink: INK.A }}
        right={{ name: solo ? oppName : "P2", score: score.b, ink: INK.B }}
        special={score.s}
        actions={[
          { label: "MENU", onClick: onExit },
          { label: "AGAIN", onClick: onRestart, main: true },
        ]}
      />
    );
  }

  const rail = {
    ink: INK[player], turn: Math.min(turn, TURNS),
    onRotate: () => pl.rotate(1), onCommit: commit, onDiscard: discard,
    canRotate: inPlay && pl.sel.handIdx !== null, canCommit: inPlay && pl.ghostLegal, canDiscard: inPlay,
    forfeit: {
      disabled: phase === "DONE",
      onConfirm: () => { pl.reset(); setForfeitBy(solo ? "A" : player); setPhase("DONE"); },
    },
  };

  return (
    <div className="tb-screen tb-safe w-full flex flex-col font-mono" style={{ color: UI.text }}>
      <div className="tb-col relative flex-1 min-h-0 flex flex-col w-full mx-auto px-3" style={{ maxWidth: PHONE_W }}>
        <div ref={stageRef} className="flex-1 min-h-0 flex items-center justify-center py-2">
          <div className="flex flex-col items-center" style={{ gap: 3 * P }}>
            <ForecastRow
              width={groupW} compact={compact}
              bag={currentPass(decks[inPlay ? player : "A"])}
              left={{
                name: "P1", ink: INK.A, now: currentPiece(decks.A), queue: upcoming(decks.A),
                card: inPlay && player === "A" ? (
                  <NowCard key="now" id={piece} ink={INK.A} selected={pl.sel.handIdx === 0}
                    dragging={pl.dragging || pl.holding} onPress={pl.onCardPointerDown} />
                ) : null,
              }}
              right={{
                name: oppName, ink: INK.B, dir: -1, now: currentPiece(decks.B), queue: upcoming(decks.B),
                busy: phase === "AI_THINK",
                card: inPlay && player === "B" ? (
                  <NowCard key="now" id={piece} ink={INK.B} dir={-1} selected={pl.sel.handIdx === 0}
                    dragging={pl.dragging || pl.holding} onPress={pl.onCardPointerDown} />
                ) : null,
              }}
            />
            {compact && <HMeter a={score.a} b={score.b} inkA={INK.A} inkB={INK.B} width={boardW} />}

            <div className="flex items-center" style={{ gap: side }}>
              {!compact && <MeterColumn a={score.a} b={score.b} inkA={INK.A} inkB={INK.B} height={boardH} />}
              <div className="relative" style={{ width: boardW, height: boardH }}>
                <BoardGrid
                  board={board} cell={cell} ink={INK} theme={theme} youSide={player}
                  pendingKeys={phase === "AI_THINK" && pendingA ? new Set(pendingA.cells.map(([r, c]) => key(r, c))) : null}
                  pendingInk={INK.A}
                  ghostKeys={pl.ghostKeys} ghostLegal={pl.ghostLegal}
                  ghostInk={INK[player]}
                  contestedKeys={contestedKeys} boardRef={pl.boardRef} onPointerDown={(e) => pl.onBoardPointerDown(e, commit)}
                />

                {reveal && (
                  <VanishLayer contested={reveal.contested} cleared={reveal.cleared} cell={cell} gap={g} ink={INK} />
                )}

                {pl.drag && pl.rotated && (
                  <FloatingPiece
                    cells={pl.rotated} cell={cell} gap={g}
                    color={INK[player]} legal={pl.ghostLegal}
                    dir={player === "B" ? -1 : 1}
                    x={pl.drag.x} y={pl.drag.y} lift={pl.drag.lift} faint={pl.holding && !!pl.sel.pos}
                  />
                )}

                {phase === "HANDOFF" && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center text-center px-5" style={{ background: UI.ground }}>
                    <div className="tb-t mb-2" style={{ color: UI.dim }}>MOVE LOCKED IN</div>
                    <div className="tb-t mb-6">Hand the device to <span style={{ color: INK.B }}>Player 2</span>.</div>
                    <button onClick={() => setPhase("PLAY_B")} className="px-5 tb-t" style={{ height: 44, ...skFill(INK.B), color: UI.text }}>
                      I'M PLAYER 2
                    </button>
                  </div>
                )}
              </div>
              {!compact && <ActionRail height={boardH} {...rail} />}
            </div>

            {compact && <ActionRow width={boardW} {...rail} />}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ============================================================
   NET GAME — ranked. The server owns the board; we render it.
   ============================================================ */
function NetGame({ colors, theme, onResult, onAbort }) {
  useEffect(() => { sky.slow = true; return () => { sky.slow = false; }; }, []);
  const m = useMatch();

  // The match vanished without finishing (server restart): back to the menu,
  // where net.notice explains what happened.
  useEffect(() => {
    if (!m) onAbort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [m]);
  const [err, setErr] = useState(null);
  // What you locked in this turn, shown until the reveal replaces it.
  const [placed, setPlaced] = useState(null);
  const [now, setNow] = useState(Date.now());
  const [stageRef, stage] = useSize();

  useEffect(() => {
    const offE = net.on("error", (e) => { setErr(e); setTimeout(() => setErr(null), 2500); });
    const tick = setInterval(() => setNow(Date.now()), 250);
    return () => { offE(); clearInterval(tick); };
  }, []);

  useEffect(() => {
    if (m?.over) onResult(m.over);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [m?.over]);

  const you = m?.you ?? "A";
  const them = you === "A" ? "B" : "A";
  const INK = useMemo(
    () => ({ [you]: colors.you, [them]: colors.rival, S: colors.special }),
    [colors, you, them]
  );

  const board = m?.board ?? null;
  // One piece per turn: the front of your queue.
  const piece = m?.piece ?? m?.hand?.[0] ?? null;
  const hand = useMemo(() => (piece === null ? [] : [piece]), [piece]);
  const canAct = !!board && !m.submitted && !m.reveal && !m.over;

  // Seat B's home row is row 0 — the top. Rotate their view so both players
  // always build upward from the bottom of their own screen.
  const flip = you === "B";

  const pl = usePlacement({ board, owner: you, hand, enabled: canAct, flip });
  const contestedKeys = useMemo(
    () => new Set((m?.reveal ? m.reveal.contested : []).map(([r, c]) => key(r, c))),
    [m?.reveal]
  );
  const score = useMemo(() => (board ? scoreOf(board) : { a: 0, b: 0, s: 0 }), [board]);
  const pending = placed && m && placed.turn === m.turn && m.submitted && !m.reveal ? placed : null;
  const pendingKeys = useMemo(() => new Set((pending?.cells || []).map(([r, c]) => key(r, c))), [pending]);
  const stuck = useMemo(() => (canAct && board ? !hasAnyMove(board, hand, you) : false), [canAct, board, hand, you]);

  const P = usePx();
  const compact = useCompact();
  const railD = useBubble();
  const { g, side, cell, boardW, boardH, groupW } = gameLayout(stage, theme, P, railD, compact);

  const secsLeft = m?.deadline ? Math.max(0, Math.ceil((m.deadline - now) / 1000)) : null;
  const graceLeft = m?.graceUntil ? Math.max(0, Math.ceil((m.graceUntil - now) / 1000)) : null;

  const commit = () => {
    if (!pl.ghostLegal || pl.sel.handIdx === null) return;
    // Show the block where it went (dotted, not yet real) until the turn resolves.
    setPlaced({ turn: m.turn, cells: pl.ghost, handIdx: pl.sel.handIdx });
    net.move({ turn: m.turn, handIdx: pl.sel.handIdx, rot: ((pl.sel.rot % 4) + 4) % 4, pos: pl.sel.pos });
    pl.reset();
  };

  // With nothing picked (the drop key), the first block in hand goes.
  const discard = () => {
    const idx = pl.sel.handIdx ?? hand.findIndex((id) => id !== undefined);
    if (idx < 0) return;
    setPlaced({ turn: m.turn, cells: [], handIdx: idx });
    net.discard({ turn: m.turn, handIdx: idx });
    pl.reset();
  };

  useGameKeys(pl, { enabled: canAct, onCommit: commit, onDiscard: discard });

  // Each turn starts with the piece already in hand (see LocalGame).
  useEffect(() => {
    if (canAct && !stuck) pl.select(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canAct, m?.turn]);

  if (!m || !board) {
    return (
      <div className="tb-screen tb-safe w-full flex items-center justify-center font-mono" style={{ color: UI.dim }}>
        <div className="tb-t tb-pulse">DEALING…</div>
      </div>
    );
  }

  const myScore = you === "A" ? score.a : score.b;
  const theirScore = you === "A" ? score.b : score.a;

  const rail = {
    ink: colors.you, turn: Math.min(m.turn, m.turns),
    onRotate: () => pl.rotate(1), onCommit: commit, onDiscard: discard,
    canRotate: canAct && pl.sel.handIdx !== null, canCommit: canAct && pl.ghostLegal, canDiscard: canAct,
    waiting: !!m.submitted && !m.reveal,
    timer: graceLeft !== null ? (
      <NumBox value={graceLeft} color={GOLD} label={`Reconnect: ${graceLeft}s`} />
    ) : theme.showTimer && secsLeft !== null ? (
      <NumBox value={secsLeft} color={secsLeft <= 5 ? UI.bad : GOLD} label={`${secsLeft}s left`} />
    ) : null,
    forfeit: { ranked: true, disabled: !m || !!m.over, onConfirm: () => net.forfeit() },
  };

  return (
    <div className="tb-screen tb-safe w-full flex flex-col font-mono" style={{ color: UI.text }}>
      <div className="tb-col relative flex-1 min-h-0 flex flex-col w-full mx-auto px-3" style={{ maxWidth: PHONE_W }}>
        <div ref={stageRef} className="flex-1 min-h-0 flex items-center justify-center py-2">
          <div className="flex flex-col items-center" style={{ gap: 3 * P }}>
            <ForecastRow
              width={groupW} compact={compact}
              bag={m.pass || 1}
              left={{
                name: "YOU", ink: colors.you, dir: you === "B" ? -1 : 1, queue: m.queue || [],
                card: (
                  <NowCard key="now" id={piece} ink={colors.you} dir={you === "B" ? -1 : 1}
                    selected={pl.sel.handIdx === 0} dragging={pl.dragging || pl.holding}
                    onPress={pl.onCardPointerDown} disabled={!canAct} spent={!!pending} />
                ),
              }}
              right={{
                name: err || `${m.opponent.name}${m.oppReady ? " ✓" : ""}`,
                ink: err ? UI.bad : colors.rival, dir: them === "B" ? -1 : 1,
                now: m.opp?.piece, queue: m.opp?.queue || [], busy: !!m.oppReady,
              }}
            />
            {compact && <HMeter a={myScore} b={theirScore} inkA={colors.you} inkB={colors.rival} width={boardW} />}

            <div className="flex items-center" style={{ gap: side }}>
              {!compact && <MeterColumn a={myScore} b={theirScore} inkA={colors.you} inkB={colors.rival} height={boardH} />}
              <div className="relative" style={{ width: boardW, height: boardH }}>
                <div className="relative" style={{ transform: flip ? "rotate(180deg)" : "none" }}>
                  <BoardGrid
                    board={board} cell={cell} ink={INK} theme={theme} youSide={you}
                    ghostKeys={pl.ghostKeys} ghostLegal={pl.ghostLegal} ghostInk={colors.you}
                    pendingKeys={pendingKeys} pendingInk={colors.you}
                    contestedKeys={contestedKeys} boardRef={pl.boardRef} onPointerDown={(e) => pl.onBoardPointerDown(e, commit)}
                  />
                  {m.reveal && (
                    <VanishLayer contested={m.reveal.contested} cleared={m.reveal.cleared} cell={cell} gap={g} ink={INK} />
                  )}
                </div>

                {pl.drag && pl.rotated && (
                  <FloatingPiece
                    cells={pl.rotated} cell={cell} gap={g}
                    color={colors.you} legal={pl.ghostLegal} flip={flip}
                    dir={you === "B" ? -1 : 1}
                    x={pl.drag.x} y={pl.drag.y} lift={pl.drag.lift} faint={pl.holding && !!pl.sel.pos}
                  />
                )}

                {m.oppDropped && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center text-center px-5"
                    style={{ background: "color-mix(in srgb, var(--tb-ground) 94%, transparent)" }}>
                    <div className="tb-t mb-3" style={{ color: GOLD }}>OPPONENT DROPPED</div>
                    {graceLeft !== null && <div className="mb-3"><PixelNum value={graceLeft} color={GOLD} /></div>}
                    <div className="tb-t" style={{ color: UI.dim }}>
                      Holding their seat. If they don't return, you take the win.
                    </div>
                  </div>
                )}
              </div>
              {!compact && <ActionRail height={boardH} {...rail} />}
            </div>

            {compact && <ActionRow width={boardW} {...rail} />}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ============================================================
   WIPE — the wave that washes from the match to its result
   ============================================================ */
/** `wipe(atMiddle)`: runs the wave, calling `atMiddle` once the screen is covered. */
const WipeCtx = createContext((fn) => fn());

const WIPE_IN_MS = 1000, WIPE_HOLD_MS = 180, WIPE_OUT_MS = 1100;

/**
 * A pixel tide: a wavy front of foam rolls down the screen (and a little to
 * the right), deep water behind it fading from lavender to sea-green to the
 * dark, with bubbles rising through. Then it rolls on and uncovers what's next.
 */
function Wipe({ theme, onMiddle, onDone }) {
  const ref = useRef(null);
  const P = usePx() * SKY_SCALE;
  useEffect(() => {
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (!theme.motion || reduced) { onMiddle(); onDone(); return; }
    const cv = ref.current;
    const ctx = cv.getContext("2d");
    const W = Math.max(1, Math.ceil(window.innerWidth / P)), H = Math.max(1, Math.ceil(window.innerHeight / P));
    cv.width = W; cv.height = H;
    cv.style.width = `${W * P}px`; cv.style.height = `${H * P}px`;
    const img = ctx.createImageData(W, H), d = img.data;
    const foam = rgbOf(theme.text), lav = rgbOf(theme.you), sea = rgbOf(theme.special);
    const deep = mixRgb(rgbOf(theme.ground), [0, 0, 0], 0.2), panel = rgbOf(theme.panel);
    const STOPS = [lav, mixRgb(lav, sea, 0.5), sea, mixRgb(sea, panel, 0.55), mixRgb(panel, deep, 0.4), deep];
    const bubbles = Array.from({ length: Math.round(W * H / 1800) + 6 }, () => ({ x: Math.random() * W, y: Math.random() * H, v: 5 + Math.random() * 9, p: Math.random() * 6 }));
    const ease = (k) => k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
    let raf, t0 = performance.now(), mid0 = false, last = t0;
    const frame = (t) => {
      const el = t - t0, dt = (t - last) / 1000; last = t;
      const out = el > WIPE_IN_MS + WIPE_HOLD_MS;
      if (!mid0 && el >= WIPE_IN_MS) { mid0 = true; onMiddle(); }
      if (el > WIPE_IN_MS + WIPE_HOLD_MS + WIPE_OUT_MS) { onDone(); return; }
      const k = out ? ease(Math.min(1, (el - WIPE_IN_MS - WIPE_HOLD_MS) / WIPE_OUT_MS)) : ease(Math.min(1, el / WIPE_IN_MS));
      const f = -0.2 + k * 1.45; // the front, in "depth" units
      const s = t / 1000;
      // Long, rolling swells, worked out once per column.
      const wave = new Float32Array(W);
      for (let x = 0; x < W; x++) wave[x] = Math.sin(x * 0.09 + s * 3.2) * 0.035 + Math.sin(x * 0.035 - s * 1.7) * 0.03;
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          // Mostly top to bottom, a little left to right, and wavy.
          const v = (y / H) * 0.8 + (x / W) * 0.2 + wave[x];
          const depth = out ? v - f : f - v; // how far behind the front
          const o = (y * W + x) * 4;
          if (depth < 0) { d[o + 3] = 0; continue; }
          const th = BAYER[(y & 3) * 4 + (x & 3)];
          // Foam at the front, then lavender, sea-green and the deep — a
          // dithered gradient all the way back.
          let c;
          if (depth < 0.025) c = th < 0.75 ? foam : lav;
          else if (depth < 0.06) c = th < 0.25 ? foam : lav;
          else {
            const z = Math.min(STOPS.length - 1.001, (depth - 0.06) / 0.28);
            const i = Math.floor(z);
            c = th < z - i ? STOPS[i + 1] : STOPS[i];
          }
          d[o] = c[0]; d[o + 1] = c[1]; d[o + 2] = c[2]; d[o + 3] = 255;
        }
      }
      // Bubbles: soft three-pixel rings drifting up through the water.
      const blend = (x, y, a) => {
        if (x < 0 || y < 0 || x >= W || y >= H) return;
        const o = (y * W + x) * 4;
        if (!d[o + 3]) return;
        d[o] += (foam[0] - d[o]) * a; d[o + 1] += (foam[1] - d[o + 1]) * a; d[o + 2] += (foam[2] - d[o + 2]) * a;
      };
      for (const b of bubbles) {
        b.y -= b.v * dt; if (b.y < -2) { b.y = H + 2; b.x = Math.random() * W; }
        const x = Math.floor(b.x + Math.sin(b.p + s * 2) * 1.2), y = Math.floor(b.y);
        blend(x, y - 1, 0.35); blend(x - 1, y, 0.3); blend(x + 1, y, 0.2); blend(x, y + 1, 0.2);
      }
      ctx.putImageData(img, 0, 0);
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <canvas ref={ref} aria-hidden="true"
      style={{ position: "fixed", left: 0, top: 0, zIndex: 60, imageRendering: "pixelated", pointerEvents: "all" }} />
  );
}

/* ============================================================
   END SCREEN — shared by ranked results and local matches
   ============================================================ */
/** One side of the final score: name over a big pixel number, in a pane of glass. */
function EndSide({ name, score, ink, won }) {
  const P = usePx();
  return (
    <div className="flex-1 min-w-0 flex flex-col items-center tb-rise" style={{
      padding: `${4 * P}px ${3 * P}px`, gap: 3 * P, ...GLASS, clipPath: CLIP,
      background: `color-mix(in srgb, ${ink} ${won ? 22 : 10}%, color-mix(in srgb, var(--tb-text) 6%, transparent))`,
    }}>
      <div className="tb-t truncate max-w-full" style={{ color: ink }}>{name}</div>
      <PixelNum value={score} dot={3} color={ink} />
    </div>
  );
}

function EndScreen({ verdict, ink, note, left, right, special = 0, children, actions }) {
  const P = usePx();
  return (
    <div className="tb-screen tb-safe w-full flex flex-col items-center justify-center px-6 font-mono" style={{ color: UI.text }}>
      <Scaled className="relative w-full" style={{ maxWidth: 400 }}>
        <div className="flex flex-col items-center text-center tb-rise" style={{
          gap: 6 * P, padding: `${10 * P}px ${8 * P}px`,
          background: "color-mix(in srgb, var(--tb-panel-solid) 55%, transparent)",
          boxShadow: `inset 0 ${P}px 0 color-mix(in srgb, var(--tb-text) 30%, transparent), inset 0 -${P}px 0 rgba(0,0,0,.3), inset ${P}px 0 0 color-mix(in srgb, var(--tb-text) 12%, transparent), inset -${P}px 0 0 rgba(0,0,0,.2)`,
          clipPath: CLIP,
        }}>
          <div className="tb-t2 tb-bob" style={{ color: ink }}>{verdict}</div>
          <PixelRule />
          <div className="flex items-stretch w-full" style={{ gap: 3 * P }}>
            <EndSide {...left} won={left.score > right.score} />
            <div className="flex items-center tb-t" style={{ color: UI.dim }}>vs</div>
            <EndSide {...right} won={right.score > left.score} />
          </div>
          {(note || special > 0) && (
            <div className="tb-t tb-rise" style={{ color: GOLD, animationDelay: "120ms" }}>
              {note}{note && special > 0 ? " · " : ""}{special > 0 ? `${special} special` : ""}
            </div>
          )}
          {children}
          <div className="flex w-full tb-rise" style={{ gap: 3 * P, animationDelay: "320ms" }}>
            {actions.map((a) => (
              <button key={a.label} onClick={a.onClick} className="tb-t"
                style={{ height: 48, flex: a.main ? 1.5 : 1, ...(a.main ? skFill(UI.text) : sk(UI.line)), color: a.main ? UI.text : UI.dim }}>
                {a.label}
              </button>
            ))}
          </div>
        </div>
      </Scaled>
    </div>
  );
}

/* ============================================================
   RESULT — ranked
   ============================================================ */
function Result({ over, colors, onQueue, onMenu }) {
  const P = usePx();
  const { won, drew, forfeit, reason, myScore, oppScore, special, opponent, rating } = over;
  const trFrom = Math.round(rating.before.r);
  const trTo = Math.round(rating.after.r);
  const delta = trTo - trFrom;
  const riFrom = rankIndexFor(trFrom);
  const riTo = rankIndexFor(trTo);
  const rank = RANKS[riTo];
  const verdictInk = drew ? UI.text : won ? colors.you : colors.rival;
  const deltaInk = delta >= 0 ? UI.good : UI.bad;

  // The rating counts from old to new once the screen has settled.
  const [shown, setShown] = useState(trFrom);
  useEffect(() => {
    const dur = 1100;
    let raf, t0;
    const step = (t) => {
      t0 ??= t;
      const k = Math.min(1, (t - t0) / dur);
      setShown(Math.round(trFrom + (trTo - trFrom) * (1 - Math.pow(1 - k, 3))));
      if (k < 1) raf = requestAnimationFrame(step);
    };
    const delay = setTimeout(() => { raf = requestAnimationFrame(step); }, 700);
    return () => { clearTimeout(delay); cancelAnimationFrame(raf); };
  }, [trFrom, trTo]);

  const note = forfeit ? "opponent forfeited" : reason === "forfeit" ? "you forfeited"
    : reason === "locked" ? "board locked — no legal moves left" : null;
  const progress = rankProgress(shown);
  const BAR = 40; // pixels

  return (
    <EndScreen
      verdict={drew ? "DRAW" : won ? "VICTORY" : "DEFEAT"} ink={verdictInk} note={note} special={special}
      left={{ name: "YOU", score: myScore, ink: colors.you }}
      right={{ name: opponent.name, score: oppScore, ink: colors.rival }}
      actions={[
        { label: "MENU", onClick: onMenu },
        { label: "QUEUE AGAIN", onClick: onQueue, main: true },
      ]}
    >
      <div className="w-full tb-rise" style={{ padding: 4 * P, ...GLASS, clipPath: CLIP, animationDelay: "200ms" }}>
        <div className="flex items-center" style={{ gap: 4 * P }}>
          <div className="flex flex-col items-center shrink-0" style={{ gap: 2 * P }}>
            <Ink size={14 * P} color={rank.color} />
            <span className="tb-t" style={{ color: rank.color }}>{rank.name}</span>
          </div>
          <div className="flex-1 min-w-0 flex flex-col items-start" style={{ gap: 3 * P }}>
            <div className="flex items-end" style={{ gap: 4 * P }}>
              <PixelNum value={shown} dot={3} color={UI.text} />
              <PixelNum value={`${delta >= 0 ? "+" : "-"}${Math.abs(delta)}`} dot={2} color={deltaInk} />
            </div>
            {/* Progress to the next rank, in whole pixels. */}
            <div aria-label={`${Math.round(progress * 100)}% to next rank`}
              style={{ width: BAR * P, height: 5 * P, ...sk(UI.dim), background: "color-mix(in srgb, var(--tb-ground) 60%, black)", position: "relative" }}>
              <div style={{
                position: "absolute", left: P, top: P, bottom: P, width: Math.round(progress * (BAR - 2)) * P,
                background: rank.color, boxShadow: `inset 0 ${P}px 0 rgba(255,255,255,.3)`,
              }} />
            </div>
            <div className="tb-t" style={{ color: UI.dim }}>±{Math.round(rating.after.rd)} <span style={{ opacity: 0.6 }}>from ±{Math.round(rating.before.rd)}</span></div>
          </div>
        </div>
      </div>
      {riTo !== riFrom && (
        <div className="w-full tb-t text-center tb-rise" style={{ padding: 3 * P, ...skFill(rank.color), color: UI.text, animationDelay: "260ms" }}>
          {riTo > riFrom ? `PROMOTED TO ${rank.name}` : `DEMOTED TO ${rank.name}`}
        </div>
      )}
    </EndScreen>
  );
}

/* ============================================================
   ROOT
   ============================================================ */
export default function TurfBlocks() {
  const [screen, setScreenNow] = useState("MENU");
  const screenRef = useRef("MENU");
  useEffect(() => { screenRef.current = screen; }, [screen]);
  // Only a real change: the ranked game re-asserts its screen on every turn.
  const setScreen = useCallback((next) => {
    const target = typeof next === "function" ? next(screenRef.current) : next;
    if (target === screenRef.current) return;
    screenRef.current = target;
    setScreenNow(target);
  }, []);
  const [aiLevel, setAiLevel] = useState(DEFAULT_LEVEL);
  const [seed, setSeed] = useState(0);
  const [loadout, setLoadoutState] = useState(loadLoadout);
  const [theme, setThemeState] = useState(loadTheme);
  // One pixel size for everything, from the screen: ~2 px on phones, 3 on
  // laptops, up to 5 on big monitors, so text stays readable and the board fits.
  const pickPx = () => (typeof window === "undefined" ? 3 :
    Math.max(2, Math.min(5, Math.round(Math.min(window.innerWidth, window.innerHeight * 0.6) / 180))));
  const [P, setP] = useState(pickPx);
  useEffect(() => {
    const on = () => setP(pickPx());
    window.addEventListener("resize", on);
    return () => window.removeEventListener("resize", on);
  }, []);
  const [over, setOver] = useState(null);
  // The wave between a finished match and its result screen.
  const [wipeRun, setWipeRun] = useState(null);
  const wipe = useCallback((atMiddle) => setWipeRun((cur) => cur || { id: Date.now(), atMiddle }), []);

  const status = useStatus();
  const profile = useProfile();
  const authed = useAuth() === "authed";
  const colors = useMemo(
    () => ({ you: theme.you, rival: theme.rival, special: theme.special }),
    [theme.you, theme.rival, theme.special]
  );
  const name = profile?.name ?? "";

  useEffect(() => {
    net.connect(store.get("tb:token"));
    const offT = net.on("token", (t) => store.set("tb:token", t));
    const offM = net.on("match", (m) => {
      if (m && m.board && !m.over) setScreen((cur) => (cur === "RESULT" ? cur : "RANKED"));
    });
    return () => { offT(); offM(); };
  }, [setScreen]);

  useEffect(() => {
    if (!authed && (screen === "MATCHMAKING" || screen === "RANKED")) setScreen("MENU");
  }, [authed, screen, setScreen]);

  const setTheme = (t) => { saveTheme(t); setThemeState(t); };
  const setLoadout = (updater) => setLoadoutState((prev) => {
    const next = typeof updater === "function" ? updater(prev) : updater;
    saveLoadout(next);
    return next;
  });
  const rename = (n) => { const v = n.trim().slice(0, 16); if (v && v !== net.profile?.name) net.setName(v); };
  const logout = () => { store.set("tb:token", ""); net.logout(); setScreen("MENU"); };

  const shell = (
    <style>{`
      :root { ${themeVars(theme)} --p: ${P}px; --pz: ${P / BASE_P}; }
      html, body, #root { background: var(--tb-ground); }
      .tb-screen { height: 100vh; height: 100dvh; overscroll-behavior: none; position: relative; z-index: 1; }
      .tb-safe {
        padding-top: env(safe-area-inset-top, 0px);
        padding-bottom: env(safe-area-inset-bottom, 0px);
        padding-left: env(safe-area-inset-left, 0px);
        padding-right: env(safe-area-inset-right, 0px);
      }
      .tb-scroll { -webkit-overflow-scrolling: touch; scrollbar-width: none; }
      .tb-scroll::-webkit-scrollbar { width: 0; height: 0; display: none; }

      /* Type: Bitcount Single, a pixel face whose dots sit on a grid of one
         tenth of the font size — so at 10 pixels, every dot is exactly one
         pixel. All text uses that one size, like a pixel-art game would. */
      .font-mono { font-family: "Bitcount Single", ui-monospace, monospace; font-weight: 400; font-synthesis: none; }
      .tb-t { font-size: calc(var(--p) * 10); line-height: calc(var(--p) * 11); letter-spacing: 0; }
      /* Twice the size: every dot is exactly two pixels. */
      .tb-t2 { font-size: calc(var(--p) * 20); line-height: calc(var(--p) * 22); letter-spacing: 0; }
      .font-mono .italic, .font-mono em { font-style: normal; opacity: .8; }
      .tb-display { font-family: "Bitcount Single", ui-monospace, monospace; font-weight: 400; }
      .tb-num { font-weight: 400; }
      /* The logo bobs one pixel up and down, like a title screen. */
      @keyframes tbBob { 0%,100% { transform: none } 50% { transform: translateY(calc(var(--p) * -1)) } }
      .tb-bob { animation: tbBob 1.6s steps(1) infinite; }
      /* A point of light running along the pixel rule under the title. */
      .tb-runner {
        position: absolute; top: 0; left: 0; width: calc(var(--p) * 2); height: calc(var(--p) * 2); background: #fff;
        animation: tbRun 2.6s steps(18) infinite;
      }
      @keyframes tbRun { from { left: 0 } to { left: calc(100% - var(--p) * 2) } }
      canvas, svg { image-rendering: pixelated; }

      /* Animations step rather than glide: motion in whole pixels. */
      @keyframes tbDrop {
        0%   { transform: scale(.25); filter: brightness(2.4) }
        60%  { transform: scale(1.15); filter: brightness(1.4) }
        100% { transform: none; filter: none }
      }
      .tb-drop { animation: tbDrop .3s steps(5) both; }
      @keyframes tbFadeIn { from { opacity: 0; transform: scale(.6) } to { opacity: 1; transform: none } }
      .tb-fadein { animation: tbFadeIn 1.6s steps(8) both; }
      /* The end screen's panels rise into place, four pixels in four steps. */
      @keyframes tbRise { from { opacity: 0; transform: translateY(calc(var(--p) * 4)) } to { opacity: 1; transform: none } }
      .tb-rise { animation: tbRise 480ms steps(4) both; }
      /* A collision: the square glitches side to side. */
      @keyframes tbContest {
        0%,100% { transform: none } 25% { transform: translateX(calc(var(--p) * -1)) } 50% { transform: translateX(var(--p)) }
        75% { transform: translateY(calc(var(--p) * -1)) }
      }
      .tb-contest { animation: tbContest .4s steps(5) 2; z-index: 2; }
      /* Cleared: a white flash, then the square breaks down to nothing. */
      @keyframes tbVanish {
        0%   { transform: none; opacity: 1; filter: none }
        25%  { transform: scale(1.12); filter: brightness(3) saturate(0) }
        100% { transform: scale(0); opacity: 0; filter: brightness(2) }
      }
      .tb-vanish { animation: tbVanish 600ms steps(6) both; }
      /* A full line about to clear: a bar of light sweeps along it. */
      @keyframes tbLine {
        0%   { transform: scaleX(0); opacity: 0 }
        30%  { transform: scaleX(1); opacity: 1 }
        100% { transform: scaleX(1); opacity: 0 }
      }
      .tb-line { animation: tbLine 700ms steps(7) both; transform-origin: left center; }
      @keyframes tbShine { 0%,100% { filter: none } 50% { filter: brightness(1.5) } }
      .tb-shine { animation: tbShine 1.2s steps(4) infinite; }
      @keyframes tbPulse { 0%,100% { opacity:.45 } 50% { opacity:1 } }
      .tb-pulse { animation: tbPulse 1.2s steps(4) infinite; }
      @keyframes tbFade { from { opacity: 0 } to { opacity: 1 } }
      .tb-fade { animation: tbFade .18s steps(3) both; }
      /* Popups open like a window on an old screen: a quick stepped scale-in. */
      @keyframes tbPop { from { opacity: 0; transform: scale(.9) } to { opacity: 1; transform: none } }
      .tb-pop { animation: tbPop .2s steps(4) both; }
      ${theme.motion ? "" : ".tb-contest,.tb-drop,.tb-fadein,.tb-pulse,.tb-fade,.tb-pop,.tb-shine,.tb-bob,.tb-runner,.tb-line,.tb-vanish,.tb-rise { animation: none !important }"}
      @media (prefers-reduced-motion: reduce) {
        .tb-contest,.tb-drop,.tb-fadein,.tb-pulse,.tb-fade,.tb-pop,.tb-shine,.tb-bob,.tb-runner,.tb-line,.tb-rise { animation: none }
      }
      /* Menus and popups: phone layout at BASE_P, zoomed by P / BASE_P (see Scaled). */
      .tb-scale { --p: ${BASE_P}px; zoom: var(--pz); }
      /* Big screens: the game column gets room for a bigger board. */
      @media (min-width: 1000px) and (min-height: 760px) {
        .tb-col { max-width: 780px !important; }
      }
      /* Buttons light up under the pointer and press down one pixel. */
      button:not(:disabled) { transition: filter 120ms steps(2); }
      button:not(:disabled):hover { filter: brightness(1.2); }
      button:not(:disabled):active { transform: translateY(var(--p)); }
      button { cursor: pointer; }
      /* A phone held sideways leaves the board too short to aim at. */
      .tb-rotate { display: none; }
      @media (orientation: landscape) and (max-height: 500px) and (pointer: coarse) {
        .tb-rotate {
          display: flex; position: fixed; inset: 0; z-index: 70;
          align-items: center; justify-content: center; flex-direction: column; gap: 10px;
          background: var(--tb-ground); color: var(--tb-text); text-align: center; padding: 24px;
        }
      }
      button { -webkit-tap-highlight-color: transparent; }
      button:focus-visible { outline: 2px solid var(--tb-text); outline-offset: 2px; }
      input:focus { border-color: var(--tb-dim) !important; }
      input[type=color] { -webkit-appearance: none; cursor: pointer; }
      input[type=color]::-webkit-color-swatch-wrapper { padding: 2px; }
      input[type=color]::-webkit-color-swatch { border: none; border-radius: 0; }
      input::placeholder { color: var(--tb-dim); font-style: italic; }
    `}</style>
  );

  let view;
  if (screen === "MENU")
    view = (
      <Menu
        onPick={(t) => {
          if (t === "DIFFICULTY") setScreen("DIFFICULTY");
          else if (t === "MATCHMAKING") setScreen("MATCHMAKING");
          else { setSeed((s) => s + 1); setScreen("HOTSEAT"); }
        }}
        loadout={loadout} setLoadout={setLoadout}
        colors={colors} profile={profile} status={status}
        name={name} rename={rename} onLogout={logout}
        theme={theme} setTheme={setTheme}
      />
    );
  else if (screen === "DIFFICULTY")
    view = (
      <Difficulty colors={colors}
        onBack={() => setScreen("MENU")}
        onStart={(lv) => { setAiLevel(lv); setSeed((s) => s + 1); setScreen("SOLO"); }} />
    );
  else if (screen === "MATCHMAKING")
    view = (
      <Matchmaking profile={profile} loadout={loadout} colors={colors}
        onCancel={() => setScreen("MENU")} onPlayAi={() => setScreen("DIFFICULTY")} />
    );
  else if (screen === "RANKED")
    view = (
      <NetGame colors={colors} theme={theme}
        onResult={(o) => wipe(() => { setOver(o); setScreen("RESULT"); })}
        onAbort={() => setScreen("MENU")} />
    );
  else if (screen === "RESULT")
    view = (
      <Result over={over} colors={colors}
        onMenu={() => { net.clearMatch(); setScreen("MENU"); }}
        onQueue={() => { net.clearMatch(); setScreen("MATCHMAKING"); }} />
    );
  else
    view = (
      <LocalGame key={seed} mode={screen} aiLevel={aiLevel} loadout={loadout}
        colors={colors} theme={theme}
        onExit={() => setScreen("MENU")}
        onRestart={() => setSeed((s) => s + 1)} />
    );

  return (
    <PxContext.Provider value={P}>
    <WipeCtx.Provider value={wipe}>
    <InkStyle.Provider value={theme.stroke}>
      <PixelSky theme={theme} />{shell}{view}
      {wipeRun && (
        <Wipe key={wipeRun.id} theme={theme} onMiddle={wipeRun.atMiddle} onDone={() => setWipeRun(null)} />
      )}
      <div className="tb-rotate font-mono" aria-live="polite">
        <RotateCw size={26} style={{ color: UI.dim }} />
        <div className="tb-t">Turn your phone upright</div>
        <div className="tb-t" style={{ color: UI.dim }}>The board needs the height. Your game is still here.</div>
      </div>
    </InkStyle.Provider>
    </WipeCtx.Provider>
    </PxContext.Provider>
  );
}