import React, { useState, useEffect, useMemo, useCallback, useRef, useSyncExternalStore, createContext, useContext, useLayoutEffect } from "react";
import {
  RotateCw, Check, SkipForward, RefreshCw, ChevronLeft, Settings2, X, Flag,
  BarChart3, Wifi, WifiOff, Clock, UserRound, LogOut,
  Palette, Lock, MailCheck, ShieldAlert, BookOpen, ChevronRight,
} from "lucide-react";

/* The rules live in one place and the server imports the same file. */
import {
  COLS, ROWS, TURNS, SLOTS, BLOCKS, DEFAULT_LOADOUT, isCentre,
  sizeOf, key, rotateN, boundsOf, absCells, initialBoard, isLegal,
  hasAnyMove, resolveTurn, scoreOf, newDeck, advanceDeck, currentPiece, currentPass, upcoming,
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
  loadTheme, saveTheme, applyPreset, editTheme, themeVars, frameUrl, frameImage,
} from "./theme.js";
import { inkPaths, gridPath, shadeUrl, pencilFilter, GRAINS } from "./sketch.js";
import { ACTIONS, getKeys, subscribeKeys, setKey, resetKeys, actionFor, keyLabel, canBind } from "./keys.js";

/* ============================================================
   PRESENTATION CONSTANTS
   ============================================================ */
const PHONE_W = 440;
const DOCK_H = 140;
const GAP = 2;
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
   Sketched frames. Every bordered surface goes through sk(): it swaps
   the straight CSS border for a pencil-drawn border-image. Theme colours
   use frames prebuilt in themeVars(); any other hex is drawn on demand.
   ------------------------------------------------------------ */
const SK_VAR = {
  [UI.line]: "line", [UI.dim]: "dim", [UI.text]: "text",
  [GOLD]: "special", [GOLD_SOFT]: "special-soft", [UI.badSoft]: "bad",
};
const SHADE_VAR = { [UI.text]: "text", [UI.dim]: "dim" };

function sk(color = UI.line) {
  const name = SK_VAR[color];
  const src = name ? `var(--tb-sk-${name})` : frameUrl(color);
  return { borderWidth: 1, borderStyle: "solid", borderColor: "transparent", borderImage: frameImage(src), borderRadius: 0 };
}
/**
 * A pencil-shaded surface: the "pressed" or primary state. Light enough to
 * write over, so text on it stays in the normal text colour. `dense` goes
 * over it twice, for swatches and small solid marks.
 */
function skFill(color = UI.text, { dense = false } = {}) {
  const name = SHADE_VAR[color];
  const shade = name ? `var(--tb-shade-${name}${dense ? "-dense" : ""})` : shadeUrl(color, { dense });
  // Shading runs a touch past the drawn frame, the way it does on paper.
  return { ...sk(color), background: `${shade} 0 0 / 36px 36px`, backgroundClip: "padding-box" };
}
/** A drawn rule under (or over) a block, in place of a 1px border. */
const RULE_BELOW = { backgroundImage: "var(--tb-rule)", backgroundRepeat: "no-repeat", backgroundPosition: "bottom", backgroundSize: "100% 8px" };
const RULE_ABOVE = { ...RULE_BELOW, backgroundPosition: "top" };

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
 *   mouse  click a card and the piece sticks to the cursor ("holding"). Move,
 *          rotate with Q/E, swap blocks with 1–4, then click the board to
 *          place it. Click the card again, right-click or press Esc to put it back.
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
      const mx = 0.5 / COLS, my = 0.5 / ROWS;
      if (fx < -mx || fx > 1 + mx || fy < -my || fy > 1 + my) {
        setSel((s) => (s.pos ? { ...s, pos: null } : s));
        return;
      }
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
   SHARED VIEWS
   ============================================================ */
/** The stroke style the player picked in Theme. Read by every Ink. */
const InkStyle = createContext("hatch");

/** How an owner's squares are inked: players hatch in opposite directions. */
const inkOf = (owner) => (owner === "S" ? { stroke: "cross", dir: 1 } : { stroke: undefined, dir: owner === "B" ? -1 : 1 });

/**
 * The pencil grain filters, mounted once per page. Ink picks one by seed so
 * neighbouring squares don't share a grain pattern.
 */
function PencilDefs() {
  const markup = useMemo(
    () => Array.from({ length: GRAINS }, (_, i) => pencilFilter(`tb-pencil-${i}`, i * 17 + 3)).join(""),
    []
  );
  return (
    <svg aria-hidden="true" width="0" height="0" style={{ position: "absolute" }}>
      <defs dangerouslySetInnerHTML={{ __html: markup }} />
    </svg>
  );
}

/**
 * One pencil-drawn square. Paths come from sketch.js, seeded, so the same
 * square always gets the same strokes. `fluid` stretches it to its box.
 */
function Ink({ size, color, stroke, dir = 1, seed = 0, fluid = false, className, style }) {
  const picked = useContext(InkStyle);
  const p = inkPaths(size, stroke || picked, dir, seed);
  return (
    <svg
      aria-hidden="true" className={className}
      width={fluid ? "100%" : size} height={fluid ? "100%" : size}
      viewBox={`0 0 ${size} ${size}`} preserveAspectRatio={fluid ? "none" : undefined}
      style={{ display: "block", overflow: "visible", pointerEvents: "none", ...style }}
    >
      <g filter={`url(#tb-pencil-${p.grain})`}>
        {p.layers.map((l, i) => l.fill
          ? <path key={i} d={l.d} style={{ fill: color }} opacity={l.o} />
          : <path key={i} d={l.d} fill="none" style={{ stroke: color }} strokeWidth={l.w} opacity={l.o}
              strokeLinecap="round" strokeLinejoin="round" strokeDasharray={l.dash} />
        )}
      </g>
    </svg>
  );
}

/** A block's silhouette, drawn in ink. Used on cards, in the deck and the tutorial. */
function BlockGlyph({ blockId, box = 40, color, gap = 1, glow = false, dir = 1 }) {
  const cells = BLOCKS[blockId].cells;
  const { h, w } = boundsOf(cells);
  const span = Math.max(h, w);
  const size = Math.max(4, Math.floor((box - gap * (span - 1)) / span));
  const filled = new Set(cells.map(([r, c]) => r * 100 + c));
  return (
    <div className={glow ? "tb-boil" : undefined} style={{
      display: "grid",
      gridTemplateColumns: `repeat(${w}, ${size}px)`,
      gridTemplateRows: `repeat(${h}, ${size}px)`,
      gap, pointerEvents: "none",
    }}>
      {Array.from({ length: h * w }).map((_, i) => (
        filled.has(Math.floor(i / w) * 100 + (i % w))
          ? <Ink key={i} size={size} color={color} dir={dir} seed={blockId * 11 + i} stroke={glow ? "cross" : undefined} />
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
      className={golden ? "tb-boil" : undefined}
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
          ? <Ink key={i} size={cell} color={color} dir={dir} seed={i * 5 + 1} stroke={golden ? "cross" : undefined} />
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
  const gap = theme.gap;
  const cb = theme.colorblind;
  const markSize = Math.max(7, Math.round(cell * 0.5));
  const grid = useMemo(() => gridPath(COLS, ROWS, cell, gap), [cell, gap]);

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
      <svg aria-hidden="true" width={grid.W} height={grid.H}
        style={{ position: "absolute", left: 0, top: 0, overflow: "visible", pointerEvents: "none" }}>
        <g filter="url(#tb-pencil-0)" fill="none" strokeLinecap="round">
          <path d={grid.inner} style={{ stroke: UI.line }} strokeWidth={0.9} opacity={FX.sketch.gridOpacity} />
          <path d={grid.edge} style={{ stroke: UI.dim }} strokeWidth={1.1} opacity={0.8} />
        </g>
      </svg>
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
              style={{ position: "relative" }}
            >
              {v && (
                <Ink size={cell} color={ink[v]} {...inkOf(v)} seed={seed}
                  style={isGhost ? { opacity: 0.3 } : undefined} />
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
                  className={ghostGolden && ghostLegal ? "tb-boil" : undefined}
                  style={{ position: "absolute", inset: 0 }} />
              )}
              {mark}
            </div>
          );
        })
      )}
    </div>
  );
}

/**
 * Your queue: the piece you play this turn, then the next QUEUE_SHOWN in
 * order, and which pass through your deck you're on. The current piece is
 * the card you pick up (click, key 1, or drag on a phone).
 */
function QueueBar({ piece, queue, pass, selected, dragging, ink, onPress, disabled, dir = 1, spent = false }) {
  const keys = useKeys();
  return (
    <div className="flex items-stretch gap-1.5 mb-1.5" style={{ height: 66 }}>
      <div
        onPointerDown={(e) => !disabled && onPress(e, 0)}
        className="relative flex flex-col items-center justify-center gap-1 select-none shrink-0"
        style={{
          width: 92,
          ...sk(selected ? ink : UI.line),
          ...(spent ? { borderImage: "none", border: `1.5px dashed ${UI.dim}` } : null),
          background: spent ? "color-mix(in srgb, var(--tb-ground) 70%, black)" : selected ? UI.panel : "transparent",
          touchAction: "none",
          opacity: spent ? 0.3 : disabled ? 0.35 : selected && dragging ? 0.25 : 1,
          transform: selected && !dragging ? "rotate(-1.2deg) translateY(-2px)" : "none",
          transition: "transform 140ms ease-out",
        }}
      >
        {HAS_KEYBOARD && (
          <span className="absolute text-[10px]" style={{ top: 5, left: 8, color: UI.dim, opacity: 0.8 }}>
            {keyLabel(keys.slot1)}
          </span>
        )}
        <BlockGlyph blockId={piece} box={34} color={ink} dir={dir} />
        <div className="text-[11px] tracking-wider" style={{ color: UI.dim }}>
          {BLOCKS[piece].name} · {BLOCKS[piece].cells.length}
        </div>
      </div>
      <div className="flex-1 min-w-0 flex flex-col justify-center px-2" style={{ ...sk(UI.line) }}>
        <div className="flex items-center justify-between text-[10px] tracking-[0.2em] mb-1" style={{ color: UI.dim }}>
          <span>NEXT</span>
          <span>PASS {pass}</span>
        </div>
        <div className="flex items-center justify-between gap-1">
          {queue.map((id, i) => (
            <div key={i} className="flex items-center justify-center" style={{ width: 22, height: 22, opacity: 1 - i * 0.07 }}>
              <BlockGlyph blockId={id} box={20} color={ink} dir={dir} gap={0.5} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/** The opponent's piece this turn and what follows — both queues are public. */
function OppQueue({ piece, queue, ink, dir }) {
  if (piece === undefined || piece === null) return null;
  return (
    <div className="flex items-center gap-2 shrink-0 pb-1.5 text-[10px] tracking-[0.2em]" style={{ color: UI.dim }}>
      <span>THEM</span>
      <BlockGlyph blockId={piece} box={18} color={ink} dir={dir} />
      <span style={{ opacity: 0.6 }}>then</span>
      <div className="flex items-center gap-1" style={{ opacity: 0.7 }}>
        {(queue || []).slice(0, 4).map((id, i) => <BlockGlyph key={i} blockId={id} box={13} color={ink} dir={dir} gap={0.5} />)}
      </div>
    </div>
  );
}

function ActionBar({ onRotate, onCommit, onDiscard, canRotate, canCommit, canDiscard, ink }) {
  return (
    <div className="flex items-center gap-1.5 mb-1">
      <button onClick={onRotate} disabled={!canRotate}
        className="flex items-center justify-center gap-1.5 text-[12px] tracking-widest disabled:opacity-30 flex-1"
        style={{ height: 42, ...sk() }}>
        <RotateCw size={13} /> TURN
      </button>
      <button onClick={onCommit} disabled={!canCommit}
        className="flex items-center justify-center gap-1.5 text-[12px] tracking-widest disabled:opacity-40"
        style={{ height: 42, flex: 1.4, ...(canCommit ? skFill(ink) : sk(UI.line)), color: canCommit ? UI.text : UI.dim }}>
        <Check size={13} /> LOCK IN
      </button>
      <button onClick={onDiscard} disabled={!canDiscard}
        className="flex items-center justify-center gap-1.5 text-[12px] tracking-widest disabled:opacity-30 flex-1"
        style={{ height: 42, ...sk(), color: UI.dim }}>
        <SkipForward size={13} /> PASS
      </button>
    </div>
  );
}

/** Territory as three pencil-shaded strips over a drawn baseline. */
const shadeBg = (color, dir = 1, dense = false) => `${shadeUrl(color, { dir, dense })} 0 0 / 36px 36px`;

function ScoreBar({ score, turn, turns, inkA, inkB, specialHex, labelA, labelB }) {
  const pct = (n) => (n / (ROWS * COLS)) * 100;
  return (
    <div className="shrink-0 pb-2">
      <div className="flex items-end justify-between mb-1">
        <span className="flex items-baseline gap-1.5" style={{ color: inkA }}>
          <span className="text-[24px] leading-none tabular-nums">{score.a}</span>
          <span className="text-[11px] tracking-[0.25em]">{labelA}</span>
        </span>
        <span className="text-[13px] italic pb-0.5" style={{ color: UI.dim }}>
          turn {Math.min(turn, turns)} of {turns}
          {score.s > 0 && <span style={{ color: GOLD }}> · {score.s}◆</span>}
        </span>
        <span className="flex items-baseline gap-1.5" style={{ color: inkB }}>
          <span className="text-[11px] tracking-[0.25em]">{labelB}</span>
          <span className="text-[24px] leading-none tabular-nums">{score.b}</span>
        </span>
      </div>
      <div className="flex w-full" style={{ height: 7 }}>
        <div style={{ width: `${pct(score.a)}%`, background: shadeBg(inkA, 1, true), transition: "width 300ms ease-out" }} />
        <div style={{ width: `${pct(score.s)}%`, background: shadeBg(specialHex, 1, true) }} />
        <div style={{ marginLeft: "auto", width: `${pct(score.b)}%`, background: shadeBg(inkB, -1, true), transition: "width 300ms ease-out" }} />
      </div>
      <div style={{ height: 8, ...RULE_BELOW, backgroundPosition: "top" }} />
    </div>
  );
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
  const size = FIELD_CELL - 6;

  return (
    <div aria-hidden="true" className="absolute inset-0 overflow-hidden pointer-events-none">
      <div style={{
        position: "absolute", left: "50%", top: "50%",
        width: dims.cols * FIELD_CELL, height: dims.rows * FIELD_CELL,
        transform: "translate(-50%, -50%) rotate(-14deg)",
        opacity: field.fading ? 0 : 0.34,
        transition: "opacity 1400ms ease",
      }}>
        {[...field.cells].map(([k, v]) => {
          const r = Math.floor(k / 100), c = k % 100;
          return (
            // Every square fades in once, when it first appears, at its own pace.
            <div key={k} className={animate ? "tb-fadein" : undefined}
              style={{ position: "absolute", left: c * FIELD_CELL + 3, top: r * FIELD_CELL + 3, width: size, height: size }}>
              <Ink size={size} color={ink[v.owner]} {...inkOf(v.owner)} seed={r * 7 + c} />
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Popup({ title, onClose, children, pinned, maxW = 430 }) {
  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center tb-fade"
      style={{
        // Opaque on purpose: a translucent backdrop re-samples whatever moves
        // behind it every frame, which reads as flicker.
        background: "var(--tb-ground)",
        padding: "clamp(14px, 5vw, 56px) clamp(14px, 5vw, 56px)",
        paddingTop: "max(clamp(14px,5vw,56px), env(safe-area-inset-top,0px))",
        paddingBottom: "max(clamp(14px,5vw,56px), env(safe-area-inset-bottom,0px))",
      }}
      onPointerDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="tb-pop w-full flex flex-col overflow-hidden"
        style={{
          maxWidth: maxW,
          maxHeight: "100%",
          background: UI.panel,
          ...sk(UI.dim),
          boxShadow: "0 18px 40px rgba(0,0,0,.35)",
        }}
      >
        <div className="flex items-center justify-between px-4 h-12 shrink-0 mx-2" style={RULE_BELOW}>
          <span className="text-[13px] tracking-[0.3em]" style={{ color: UI.text }}>{title}</span>
          <button onClick={onClose} style={{ color: UI.dim }} aria-label="Close" className="p-2 -mr-2"><X size={17} /></button>
        </div>
        {pinned && <div className="px-4 pt-3 shrink-0">{pinned}</div>}
        <div className="tb-scroll flex-1 min-h-0 overflow-y-auto px-4 pb-5">{children}</div>
      </div>
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
        <div className="text-[13px] tracking-[0.2em] mb-3">HANDLE</div>
        <input value={draft} maxLength={16}
          onChange={(e) => { setDraft(e.target.value); setNameErr(null); }} onBlur={() => rename(draft)}
          onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
          className={`w-full rounded px-3 ${nameErr ? "mb-2" : "mb-7"} text-sm font-mono`}
          style={{ height: 44, background: UI.ground, ...sk(nameErr ? UI.badSoft : UI.line), color: UI.text, outline: "none" }} />
        {nameErr && <div className="text-[12px] mb-6" style={{ color: UI.bad }}>{nameErr}</div>}

        {HAS_KEYBOARD && <ControlsSection />}

        <div className="text-[11px] tracking-[0.24em] mb-1" style={{ color: UI.dim }}>ACCESSIBILITY</div>
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
        <div className="text-[11px] leading-relaxed mt-2 mb-7" style={{ color: UI.dim }}>
          Marks put ○ on your squares
          and ✕ on your opponent's, so the board reads without colour.
        </div>

        <div className="text-[11px] tracking-[0.24em] mb-2" style={{ color: UI.dim }}>CONNECTION</div>
        <div className="flex items-center gap-2 text-[12px] mb-1" style={{ color: status === "online" ? UI.good : UI.dim }}>
          {status === "online" ? <Wifi size={12} /> : <WifiOff size={12} />}
          SERVER {status.toUpperCase()}
        </div>
        <div className="flex items-center gap-2 text-[12px] mb-1.5" style={{ color: IS_SECURE ? UI.good : GOLD }}>
          {IS_SECURE ? <Lock size={12} /> : <ShieldAlert size={12} />}
          {IS_SECURE ? "ENCRYPTED (TLS)" : "NOT ENCRYPTED"}
        </div>
        <div className="text-[11px] leading-relaxed pb-2" style={{ color: UI.dim }}>
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
              <span className="text-[9px] tracking-wider" style={{ color: UI.dim }}>
                {BLOCKS[blockId].name}
              </span>
            </div>
          );
        })}
      </div>
      <div className="text-[11px] leading-relaxed pt-2 pb-1" style={{ color: UI.dim }}>
        You play one piece per turn, straight from the front of your queue. These
        eight come round once per pass, shuffled each time — and your opponent can see them.
      </div>
    </>
  );

  return (
    <Popup title="YOUR BLOCKS" onClose={onClose} pinned={pinned}>
      <div className="text-[12px] leading-relaxed pt-3 pb-4" style={{ color: UI.dim }}>
        Hold a block for a moment, then drag it up into a slot.
      </div>
      {["SMALL", "MEDIUM", "BIG"].map((g) => (
        <div key={g} className="mb-5">
          <div className="text-[12px] tracking-[0.2em] mb-2" style={{ color: UI.dim }}>
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
                  <span className="text-[9px] tracking-wider" style={{ color: UI.dim }}>
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
      <div className="text-[10px] tracking-[0.24em] mb-1.5" style={{ color: UI.dim }}>{label}</div>
      <div className="text-lg leading-none" style={{ color: color || UI.text }}>{value}</div>
      {sub && <div className="text-[11px] mt-1.5" style={{ color: UI.dim }}>{sub}</div>}
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
          <div className="text-[13px] leading-relaxed" style={{ color: UI.dim }}>
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
            <span className="text-3xl leading-none" style={{ color: placed ? rank.color : UI.dim }}>{placed ? rank.name : "–"}</span>
          </div>
          <div className="min-w-0 flex-1">
            {placed ? (
              <>
                <div className="flex items-baseline gap-1.5">
                  <span className="text-2xl leading-none">{tr}</span>
                  <span className="text-[12px]" style={{ color: UI.dim }}>TR ±{Math.round(profile.rating.rd)}</span>
                </div>
                <div className="text-[11px] tracking-[0.2em] mt-2 mb-1.5" style={{ color: UI.dim }}>
                  {next ? `${toNext} TR TO ${next.name}` : "TOP OF THE LADDER"}
                </div>
                <div className="h-1 w-full rounded overflow-hidden" style={{ background: UI.cell }}>
                  <div style={{ width: `${prog * 100}%`, height: "100%", background: rank.color }} />
                </div>
              </>
            ) : (
              <>
                <div className="text-sm mb-1">UNRANKED</div>
                <div className="text-[12px] leading-relaxed" style={{ color: UI.dim }}>
                  {PLACEMENT_GAMES - st.games} more ranked {PLACEMENT_GAMES - st.games === 1 ? "match" : "matches"} to place.
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      <div className="mt-4">
        <div className="text-[11px] tracking-[0.24em] mb-2" style={{ color: UI.dim }}>LADDER</div>
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
                <span className="text-[9px]" style={{ color: here ? r.color : UI.dim, opacity: here ? 1 : 0.5 }}>{r.name}</span>
              </div>
            );
          })}
        </div>
      </div>

      {st.history.length > 1 && (
        <div className="mt-5 rounded p-3" style={{ background: UI.panel, ...sk(UI.line) }}>
          <div className="flex items-center justify-between mb-1">
            <span className="text-[11px] tracking-[0.24em]" style={{ color: UI.dim }}>TR · LAST {st.history.length}</span>
            <span className="text-[11px]" style={{ color: UI.dim }}>{Math.min(...st.history)} – {Math.max(...st.history)}</span>
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
        <div className="text-[11px] tracking-[0.24em] mb-2" style={{ color: UI.dim }}>RECENT MATCHES</div>
        {st.recent.length === 0 ? (
          <div className="rounded p-4 text-center text-[12px] leading-relaxed" style={{ background: UI.panel, ...sk(UI.line), color: UI.dim }}>
            No ranked matches yet.
          </div>
        ) : (
          <div className="space-y-1">
            {st.recent.map((m, i) => (
              <div key={i} className="flex items-center gap-2.5 rounded px-3 py-2" style={{ background: UI.panel, ...sk(UI.line) }}>
                <span className="text-[12px] w-4 shrink-0" style={{ color: m.drew ? UI.dim : m.won ? UI.good : UI.bad }}>
                  {m.drew ? "D" : m.won ? "W" : "L"}
                </span>
                <span className="text-[13px] flex-1 truncate">{m.name}</span>
                <span className="text-[11px]" style={{ color: UI.dim }}>{m.score[0]}–{m.score[1]}</span>
                <span className="text-[11px] w-8 text-right" style={{ color: UI.dim }}>{fmtTime(m.seconds)}</span>
                <span className="text-[12px] w-9 text-right" style={{ color: m.delta > 0 ? UI.good : UI.bad }}>
                  {m.delta > 0 ? "+" : ""}{m.delta}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="text-[11px] leading-relaxed pt-3 pb-2" style={{ color: UI.dim, ...RULE_ABOVE }}>
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
        <span className="text-[13px] tracking-[0.2em]">CONTROLS</span>
        <button onClick={() => { resetKeys(); setListening(null); setWarn(null); }}
          className="text-[11px] tracking-[0.2em] py-1" style={{ color: UI.dim }}>RESET</button>
      </div>
      <div className="text-[11px] leading-relaxed mb-2" style={{ color: UI.dim }}>
        Click a key, then press the new one. Esc cancels.
      </div>
      <div className="grid grid-cols-2 gap-x-4">
        {ACTIONS.map((a) => {
          const on = listening === a.id;
          return (
            <div key={a.id} className="flex items-center justify-between py-1.5" style={RULE_BELOW}>
              <span className="text-[12px]" style={{ color: UI.dim }}>{a.label}</span>
              <button onClick={() => { setWarn(null); setListening(on ? null : a.id); }}
                className={`text-[12px] ${on ? "tb-pulse" : ""}`}
                style={{ minWidth: 52, height: 30, padding: "0 8px", ...(on ? skFill(UI.text) : sk(UI.line)), color: UI.text }}>
                {on ? "…" : keyLabel(keys[a.id])}
              </button>
            </div>
          );
        })}
      </div>
      {warn && <div className="text-[12px] mt-2" style={{ color: UI.bad }}>{warn}</div>}
    </div>
  );
}

function Row({ label, children }) {
  return (
    <div className="flex items-center justify-between gap-3 py-2.5" style={{ ...RULE_BELOW }}>
      <span className="text-[12px] tracking-[0.2em] shrink-0" style={{ color: UI.dim }}>{label}</span>
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
    const moves = [["A", [[13, 2], [13, 3], [14, 2]]], ["B", [[1, 4], [1, 5], [2, 5]]],
["A", [[10, 4], [11, 4]]], ["B", [[4, 2], [4, 3]]]];
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
            className="flex-1 rounded text-[11px] tracking-[0.2em]"
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
                <div className="text-[11px] tracking-[0.2em]" style={{ color: p.text }}>{p.label}</div>
              </button>
            );
          })}
          {theme.preset === "custom" && (
            <div className="rounded p-2.5 col-span-2 text-[11px] tracking-[0.2em]"
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
          <div className="text-[11px] tracking-[0.2em] mt-4 mb-2" style={{ color: UI.dim }}>SURFACES</div>
          {[["BACKGROUND", "ground"], ["PANELS", "panel"], ["EMPTY CELL", "cell"], ["LINES", "line"], ["TEXT", "text"]].map(([label, k]) => (
            <Row key={k} label={label}>
              <input type="color" value={theme[k]} onChange={(e) => set({ [k]: e.target.value })}
                style={{ width: 44, height: 26, background: "transparent", ...sk(UI.line), borderRadius: 5, padding: 0 }} />
              <span className="text-[11px] tabular-nums" style={{ color: UI.dim }}>{theme[k]}</span>
            </Row>
          ))}
        </div>
      )}

      {tab === "blocks" && (
        <div className="pb-2">
          <div className="text-[11px] tracking-[0.2em] mb-2" style={{ color: UI.dim }}>STROKE</div>
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
                  <span className="text-[10px] tracking-wider" style={{ color: on ? UI.text : UI.dim }}>{st.label}</span>
                </button>
              );
            })}
          </div>

          <Row label="GRID GAP">
            {GRID_GAPS.map((g) => (
              <button key={g} onClick={() => set({ gap: g })}
                className="rounded text-[12px] tabular-nums"
                style={{
                  width: 34, height: 30,

                  color: theme.gap === g ? UI.text : UI.dim,
                  ...(theme.gap === g ? skFill(UI.text) : sk(UI.line)),
                }}>{g}</button>
            ))}
          </Row>
          <Row label="COLOURBLIND MARKS"><Toggle on={theme.colorblind} onClick={() => set({ colorblind: !theme.colorblind })} /></Row>
          <div className="text-[11px] leading-relaxed pt-3" style={{ color: UI.dim }}>
            Marks put ○ on your squares, ✕ on your opponent's and ◆ on contested ones,
            so the board reads without relying on colour.
          </div>
        </div>
      )}

      <div className="text-[11px] leading-relaxed pt-4 mt-2" style={{ color: UI.dim, ...RULE_ABOVE }}>
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
        <span className="text-[11px] tracking-[0.2em]" style={{ color: UI.dim }}>OR</span>
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
        <div className="text-[11px] tracking-[0.24em] mb-2" style={{ color: UI.dim }}>USERNAME</div>
        <input value={username} autoCapitalize="none" autoCorrect="off" maxLength={16}
          onChange={(e) => setUsername(e.target.value)} onKeyDown={(e) => e.key === "Enter" && submit()}
          className="w-full px-3 mb-4 text-sm font-mono" style={fieldStyle} />

        {signup && (
          <>
            <div className="text-[11px] tracking-[0.24em] mb-2" style={{ color: UI.dim }}>EMAIL</div>
            <input value={email} type="email" autoCapitalize="none" autoCorrect="off"
              onChange={(e) => setEmail(e.target.value)} onKeyDown={(e) => e.key === "Enter" && submit()}
              className="w-full px-3 mb-4 text-sm font-mono" style={fieldStyle} />
          </>
        )}

        <div className="text-[11px] tracking-[0.24em] mb-2" style={{ color: UI.dim }}>PASSWORD</div>
        <input type="password" value={password} autoCapitalize="none"
          onChange={(e) => setPassword(e.target.value)} onKeyDown={(e) => e.key === "Enter" && submit()}
          className="w-full px-3 mb-4 text-sm font-mono" style={fieldStyle} />

        {signup && (
          <>
            <div className="text-[11px] tracking-[0.24em] mb-2" style={{ color: UI.dim }}>CONFIRM PASSWORD</div>
            <input type="password" value={confirm} autoCapitalize="none"
              onChange={(e) => setConfirm(e.target.value)} onKeyDown={(e) => e.key === "Enter" && submit()}
              className="w-full px-3 mb-4 text-sm font-mono" style={fieldStyle} />
            <div className="text-[11px] leading-relaxed mb-4" style={{ color: UI.dim }}>
              3–16 letters, numbers or underscores. Password at least 8 characters.
              We'll email you a 5-digit code.
            </div>
          </>
        )}

        {err && (
          <div className="text-[12px] leading-relaxed mb-4 rounded px-3 py-2"
            style={{ color: UI.bad, ...sk(UI.badSoft), background: UI.badFaint }}>{err}</div>
        )}

        <button onClick={submit} disabled={net.authBusy}
          className="w-full rounded text-[12px] tracking-[0.3em] disabled:opacity-40"
          style={{ height: 48, ...skFill(UI.text), color: UI.text }}>
          {net.authBusy ? "…" : signup ? "CREATE ACCOUNT" : "LOG IN"}
        </button>

        <GoogleButton onCredential={(c) => net.google(c)} />

        <button onClick={() => onSwitch(signup ? "login" : "signup")}
          className="w-full text-[12px] tracking-[0.2em] mt-4 py-2" style={{ color: UI.dim }}>
          {signup ? "I ALREADY HAVE AN ACCOUNT" : "CREATE AN ACCOUNT"}
        </button>
        {!signup && (
          <button onClick={() => { net.authError = null; net.resetSent = false; onSwitch("reset"); }}
            className="w-full text-[12px] tracking-[0.2em] py-2" style={{ color: UI.dim }}>
            FORGOT PASSWORD?
          </button>
        )}
        {signup && <div className="text-center mt-2"><LegalLinks prefix="By creating an account you agree to the " /></div>}

        <div className="flex items-center gap-2 text-[11px] mt-4 pt-4"
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
    <div className="text-[11px] leading-relaxed" style={{ color: UI.dim }}>
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
  const label = (t) => <div className="text-[11px] tracking-[0.24em] mb-2" style={{ color: UI.dim }}>{t}</div>;

  return (
    <Popup title="RESET PASSWORD" onClose={onClose} maxW={360}>
      <div className="pt-4 pb-1">
        {!sent ? (
          <>
            <div className="text-[12px] leading-relaxed mb-4" style={{ color: UI.dim }}>
              Enter the email on your account and we'll send a 5-digit code.
            </div>
            {label("EMAIL")}
            <input value={email} type="email" autoCapitalize="none" autoCorrect="off" autoFocus
              onChange={(e) => setEmail(e.target.value)} onKeyDown={(e) => e.key === "Enter" && request()}
              className="w-full px-3 mb-4 text-sm font-mono" style={fieldStyle} />
          </>
        ) : (
          <>
            <div className="text-[12px] leading-relaxed mb-4" style={{ color: UI.dim }}>
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
              className="w-full px-3 mb-4 text-sm font-mono" style={fieldStyle} />
            {label("CONFIRM PASSWORD")}
            <input type="password" value={confirm} autoCapitalize="none"
              onChange={(e) => setConfirm(e.target.value)} onKeyDown={(e) => e.key === "Enter" && confirmReset()}
              className="w-full px-3 mb-4 text-sm font-mono" style={fieldStyle} />
          </>
        )}

        {err && (
          <div className="text-[12px] leading-relaxed mb-4 px-3 py-2"
            style={{ color: UI.bad, ...sk(UI.badSoft), background: UI.badFaint }}>{err}</div>
        )}

        <button onClick={sent ? confirmReset : request} disabled={net.authBusy}
          className="w-full text-[12px] tracking-[0.3em] disabled:opacity-40"
          style={{ height: 48, ...skFill(UI.text), color: UI.text }}>
          {net.authBusy ? "…" : sent ? "SET NEW PASSWORD" : "SEND CODE"}
        </button>

        {sent && (
          <button onClick={() => { net.resetSent = false; setCode(""); net.bumpAuth(); }}
            className="w-full text-[12px] tracking-[0.2em] mt-3 py-2" style={{ color: UI.dim }}>
            DIDN'T GET IT? SEND AGAIN
          </button>
        )}
        <button onClick={onBack} className="w-full text-[12px] tracking-[0.2em] mt-2 py-2" style={{ color: UI.dim }}>
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
        <div className="text-[13px] leading-relaxed mb-1">We sent a 5-digit code to</div>
        <div className="text-sm mb-6">{profile.email}</div>

        <input
          value={digits} inputMode="numeric" autoFocus maxLength={5}
          onChange={(e) => onChange(e.target.value)}
          className="w-full text-center font-mono mb-4"
          style={{ ...fieldStyle, height: 58, fontSize: 26, letterSpacing: "0.5em", textIndent: "0.5em" }}
        />

        {net.authError && (
          <div className="text-[12px] leading-relaxed mb-4 rounded px-3 py-2"
            style={{ color: UI.bad, ...sk(UI.badSoft), background: UI.badFaint }}>
            {net.authError}
          </div>
        )}
        {net.codeSent && !net.authError && (
          <div className="text-[12px] mb-4" style={{ color: UI.good }}>New code sent.</div>
        )}

        <button onClick={() => submit(digits)} disabled={digits.length !== 5 || net.authBusy}
          className="w-full rounded text-[12px] tracking-[0.3em] disabled:opacity-40 mb-3"
          style={{ height: 48, ...skFill(UI.text), color: UI.text }}>VERIFY</button>

        <button onClick={() => { net.resend(); setCooldown(60); }} disabled={cooldown > 0}
          className="w-full text-[12px] tracking-[0.2em] py-2 disabled:opacity-40" style={{ color: UI.dim }}>
          {cooldown > 0 ? `RESEND IN ${cooldown}s` : "RESEND CODE"}
        </button>

        <div className="text-[11px] leading-relaxed mt-4 pt-4" style={{ color: UI.dim, ...RULE_ABOVE }}>
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
        <div className="py-10 text-center text-[13px]" style={{ color: UI.dim }}>Signed out.</div>
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
            <span className="text-2xl" style={{ color: placed ? rank.color : UI.dim }}>{placed ? rank.name : "–"}</span>
          </div>
          <div className="min-w-0">
            <div className="text-lg truncate">{profile.name}</div>
            <div className="text-[12px] mt-1" style={{ color: UI.dim }}>
              {placed ? `${tr} TR ±${Math.round(profile.rating.rd)}` : `${PLACEMENT_GAMES - st.games} matches to place`}
            </div>
            <div className="text-[11px] mt-0.5" style={{ color: UI.dim }}>member since {since}</div>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-2 mb-5">
          {[
            ["WIN RATE", `${winRate}%`, winRate >= 50 ? UI.good : UI.text],
            ["RECORD", `${st.wins}–${st.losses}`, UI.text],
            ["PLAYED", fmtTime(st.seconds), UI.text],
          ].map(([label, value, color]) => (
            <div key={label} className="rounded p-2.5" style={{ background: UI.ground, ...sk(UI.line) }}>
              <div className="text-[10px] tracking-[0.2em] mb-1.5" style={{ color: UI.dim }}>{label}</div>
              <div className="text-sm leading-none" style={{ color }}>{value}</div>
            </div>
          ))}
        </div>

        <div className="grid grid-cols-2 gap-2 mb-6">
          <div className="rounded p-2.5" style={{ background: UI.ground, ...sk(UI.line) }}>
            <div className="text-[10px] tracking-[0.2em] mb-1.5" style={{ color: UI.dim }}>PEAK</div>
            <div className="text-sm leading-none" style={{ color: st.peakRank !== null ? RANKS[st.peakRank].color : UI.dim }}>
              {st.peakRank !== null ? `${RANKS[st.peakRank].name} · ${st.peakTr}` : "unplaced"}
            </div>
          </div>
          <div className="rounded p-2.5" style={{ background: UI.ground, ...sk(UI.line) }}>
            <div className="text-[10px] tracking-[0.2em] mb-1.5" style={{ color: UI.dim }}>BEST STREAK</div>
            <div className="text-sm leading-none">W{st.bestStreak}</div>
          </div>
        </div>

        <button onClick={onLogout}
          className="w-full rounded text-[12px] tracking-[0.25em] flex items-center justify-center gap-2"
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

        <div className="text-[12px] tracking-[0.3em] mb-4" style={{ color: UI.dim }}>{p.title}</div>

        <div className="rounded py-5 mb-4 flex items-center justify-center"
          style={{ background: UI.ground, ...sk(UI.line), minHeight: 132 }}>
          {p.art}
        </div>

        <div className="text-[13px] leading-relaxed mb-5" style={{ minHeight: 76 }}>{p.body}</div>

        <div className="flex gap-2">
          <button
            onClick={() => setPage((n) => Math.max(0, n - 1))}
            disabled={page === 0}
            className="rounded text-[12px] tracking-[0.25em] disabled:opacity-30"
            style={{ height: 46, flex: 1, ...sk(UI.line), color: UI.dim }}
          >
            BACK
          </button>
          <button
            onClick={() => (last ? onClose() : setPage((n) => n + 1))}
            className="rounded text-[12px] tracking-[0.25em]"
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
function Flourish({ width = 160 }) {
  return (
    <svg aria-hidden="true" width={width} height="16" viewBox="0 0 160 16" style={{ display: "block", margin: "6px auto 0", overflow: "visible" }}>
      <path d="M6 9 C 40 4, 70 12, 96 8 S 140 5, 154 8" fill="none" style={{ stroke: UI.text }} strokeWidth="1.6" strokeLinecap="round" />
      <path d="M22 11.5 C 55 8, 92 13.5, 136 9.5" fill="none" style={{ stroke: UI.dim }} strokeWidth="1" strokeLinecap="round" />
      <path d="M150 4.5 l7 3.4 -7 3.2" fill="none" style={{ stroke: UI.text }} strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
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
    <div className="tb-screen tb-safe relative w-full flex items-center justify-center px-5 font-mono overflow-hidden" style={{ background: UI.ground, color: UI.text }}>
      <AmbientField colors={colors} theme={theme} paused={!!modal} />
      <div className="absolute inset-0 pointer-events-none" style={{ background: "radial-gradient(ellipse at 50% 46%, color-mix(in srgb, var(--tb-ground) 45%, transparent) 0%, color-mix(in srgb, var(--tb-ground) 20%, transparent) 50%, transparent 80%)" }} />

      <div className="relative w-full" style={{ maxWidth: 330 }}>
        <div className="text-center mb-9">
          <div className="tb-display text-[68px] leading-none tracking-[0.16em]"
            style={{ marginRight: "-0.16em", color: UI.text }}>MINO</div>
          <Flourish width={170} />
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
          <span className="text-[11px] tracking-[0.28em]" style={{ color: UI.dim }}>
            {status !== "online" ? (status === "connecting" ? "CONNECTING…" : "SERVER OFFLINE")
              : !authed ? "ACCOUNT REQUIRED"
              : !verified ? "VERIFY YOUR EMAIL"
              : placed ? `RANKED · ${rank.name} · ${tr}` : "RANKED · UNPLACED"}
          </span>
          <span className="text-base tracking-[0.28em]" style={{ textDecoration: authed && verified ? "none" : "line-through", textDecorationThickness: 1 }}>
            MULTIPLAYER
          </span>
          {status === "online" && online !== null && (
            <span className="text-[11px] italic" style={{ color: UI.dim }}>
              {online === 1 ? "just you online right now" : `${online} people online`}
            </span>
          )}
        </button>

        {notice && (
          <button onClick={() => net.setNotice(null)} className="w-full text-left text-[12px] leading-relaxed px-3 py-2 mb-2.5"
            style={{ ...sk(GOLD_SOFT), color: GOLD }}>
            {notice} <span style={{ color: UI.dim }}>(tap to dismiss)</span>
          </button>
        )}

        {!authed && (
          <div className="flex gap-2.5 mb-2.5">
            <button onClick={() => setModal("login")} disabled={status !== "online"}
              className="flex-1 rounded flex items-center justify-center disabled:opacity-40"
              style={{ height: 44, background: UI.panel, ...sk(UI.line) }}>
              <span className="text-[13px] tracking-[0.24em]">LOGIN</span>
            </button>
            <button onClick={() => setModal("signup")} disabled={status !== "online"}
              className="flex-1 rounded flex items-center justify-center disabled:opacity-40"
              style={{ height: 44, ...skFill(UI.text), color: UI.text }}>
              <span className="text-[13px] tracking-[0.24em]">NEW PLAYER</span>
            </button>
          </div>
        )}

        <div className="flex gap-2.5 mb-2.5">
          <button onClick={() => { onPick("DIFFICULTY"); }} className="flex-1 rounded flex items-center justify-center" style={{ height: 44, background: UI.panel, ...sk(UI.line) }}>
            <span className="text-sm tracking-[0.28em]">SP</span>
          </button>
          <button onClick={() => { onPick("HOTSEAT"); }} className="flex-1 rounded flex items-center justify-center" style={{ height: 44, background: UI.panel, ...sk(UI.line) }}>
            <span className="text-sm tracking-[0.2em]">TAKE TURNS</span>
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
      </div>

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
    <div className="tb-screen tb-safe w-full flex items-center justify-center px-5 font-mono" style={{ background: UI.ground, color: UI.text }}>
      <div className="w-full" style={{ maxWidth: 330 }}>
        <button onClick={onBack} className="flex items-center gap-1 text-[12px] tracking-[0.25em] mb-6 py-2" style={{ color: UI.dim }}>
          <ChevronLeft size={13} /> MENU
        </button>
        <div className="text-[12px] tracking-[0.28em] mb-3" style={{ color: UI.dim }}>OPPONENT STRENGTH</div>
        <div className="grid grid-cols-5 gap-1.5 mb-4">
          {LEVELS.map((nm, i) => {
            const n = i + 1, on = lv === n;
            return (
              <button key={n} onClick={() => { setLv(n); }}
                className="rounded flex items-center justify-center text-sm"
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
          <div className="text-sm tracking-[0.22em] mb-1" style={{ color: colors.rival }}>{LEVELS[lv - 1]}</div>
          <div className="text-[13px] leading-relaxed" style={{ color: UI.dim }}>{levelBlurb(lv)}</div>
        </div>
        <button onClick={() => onStart(lv)} className="w-full rounded text-[13px] tracking-[0.3em]" style={{ height: 50, ...skFill(UI.text), color: UI.text }}>
          START MATCH
        </button>
      </div>
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
    <div className="tb-screen tb-safe w-full flex flex-col items-center justify-center px-6 font-mono" style={{ background: UI.ground, color: UI.text }}>
      <div className="w-full" style={{ maxWidth: 330 }}>
        {!found ? (
          <>
            <div className="text-center mb-8">
              <div className="text-[12px] tracking-[0.28em] tb-pulse mb-2" style={{ color: colors.you }}>SEARCHING</div>
              <div className="text-[28px] leading-none tabular-nums">{elapsed.toFixed(1)}s</div>
            </div>

            <div className="mb-6">
              <div className="flex justify-between text-[11px] mb-2" style={{ color: UI.dim }}>
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
              <div className="text-center text-[11px] mt-2 flex items-center justify-center gap-1.5"
                style={{ color: status === "online" ? UI.dim : GOLD }}>
                {status !== "online" && <WifiOff size={11} />}
                {tr} TR · {rank.name}
              </div>
            </div>

            <div className="text-[12px] leading-relaxed text-center mb-8" style={{ color: UI.dim }}>
              {status === "online"
                ? null
                : status === "kicked"
                ? "You signed in somewhere else. Reload to take this session back."
                : "Lost the server — reconnecting. You'll rejoin the queue automatically."}
            </div>

            {elapsed >= LONELY_AFTER_S && (
              <div className="mb-3 tb-fade">
                <div className="text-[12px] italic text-center mb-2" style={{ color: UI.dim }}>
                  Quiet right now. Play the AI instead? Ranked can wait.
                </div>
                <button onClick={() => { net.unqueue(); onPlayAi(); }} className="w-full text-[12px] tracking-[0.3em]"
                  style={{ height: 46, ...skFill(UI.text), color: UI.text }}>
                  PLAY THE AI
                </button>
              </div>
            )}
            <button onClick={() => { net.unqueue(); onCancel(); }} className="w-full rounded text-[12px] tracking-[0.3em]" style={{ height: 46, ...sk(UI.line), color: UI.dim }}>
              CANCEL
            </button>
          </>
        ) : (
          <div className="text-center">
            <div className="text-[12px] tracking-[0.28em] mb-7" style={{ color: UI.dim }}>MATCH FOUND</div>
            <div className="flex items-center justify-center gap-4 mb-6">
              <div className="flex-1">
                <div className="rounded mx-auto flex items-center justify-center mb-2" style={{ width: 52, height: 52, background: `${rank.color}1F`, ...sk(rank.color) }}>
                  <span className="text-xl" style={{ color: rank.color }}>{rank.name}</span>
                </div>
                <div className="text-[12px] truncate">{profile.name}</div>
                <div className="text-[11px]" style={{ color: UI.dim }}>{tr}</div>
              </div>
              <span className="text-[12px] tracking-[0.2em]" style={{ color: UI.dim }}>VS</span>
              <div className="flex-1">
                <div className="rounded mx-auto flex items-center justify-center mb-2" style={{ width: 52, height: 52, background: `${oppRank.color}1F`, ...sk(oppRank.color) }}>
                  <span className="text-xl" style={{ color: oppRank.color }}>{oppRank.name}</span>
                </div>
                <div className="text-[12px] truncate">{found.opponent.name}</div>
                <div className="text-[11px]" style={{ color: UI.dim }}>{found.opponent.rating}</div>
              </div>
            </div>
            <div className="text-[11px]" style={{ color: UI.dim }}>{found.gap} TR apart</div>
          </div>
        )}
      </div>
    </div>
  );
}

/** A small FORFEIT link that asks before ending the match. */
function ForfeitButton({ onConfirm, ranked = false, disabled = false }) {
  const [asking, setAsking] = useState(false);
  return (
    <>
      <button onClick={() => setAsking(true)} disabled={disabled}
        className="flex items-center gap-1 text-[12px] tracking-[0.25em] py-2 disabled:opacity-30" style={{ color: UI.dim }}>
        <Flag size={12} /> FORFEIT
      </button>
      {asking && (
        <Popup title="FORFEIT?" onClose={() => setAsking(false)} maxW={320}>
          <div className="pt-4 pb-1">
            <div className="text-[13px] leading-relaxed mb-5" style={{ color: UI.dim }}>
              {ranked ? "You'll lose this match and the rating that goes with it." : "This match ends now and counts as a loss."}
            </div>
            <div className="flex gap-2">
              <button onClick={() => setAsking(false)} className="flex-1 text-[12px] tracking-[0.25em]"
                style={{ height: 44, ...sk(UI.line), color: UI.dim }}>KEEP PLAYING</button>
              <button onClick={() => { setAsking(false); onConfirm(); }} className="flex-1 text-[12px] tracking-[0.25em]"
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
  const them = player === "A" ? "B" : "A";
  // One piece per turn: the front of your queue.
  const piece = currentPiece(decks[player]);
  const hand = useMemo(() => [piece], [piece]);
  const inPlay = phase === "PLAY_A" || phase === "PLAY_B";
  const score = useMemo(() => scoreOf(board), [board]);
  const oppName = solo ? `AI ${LEVELS[aiLevel - 1]}` : "PLAYER 2";

  const pl = usePlacement({ board, owner: player, hand, enabled: inPlay });
  const contestedKeys = useMemo(() => new Set((reveal ? reveal.contested : []).map(([r, c]) => key(r, c))), [reveal]);
  const stuck = useMemo(() => (inPlay ? !hasAnyMove(board, hand, player) : false), [board, hand, player, inPlay]);

  const g = theme.gap;
  const cell = Math.max(6, Math.floor(Math.min(
    (stage.w - g * (COLS + 1)) / COLS,
    (stage.h - g * (ROWS + 1)) / ROWS
  )));
  const boardH = cell * ROWS + g * (ROWS + 1);

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

  return (
    <div className="tb-screen tb-safe w-full flex flex-col font-mono" style={{ background: UI.ground, color: UI.text }}>
      <div className="relative flex-1 min-h-0 flex flex-col w-full mx-auto px-3" style={{ maxWidth: PHONE_W }}>
        <div className="flex items-center justify-between h-9 shrink-0">
          <button onClick={onExit} className="flex items-center gap-1 text-[12px] tracking-[0.25em] py-2 -ml-1" style={{ color: UI.dim }}>
            <ChevronLeft size={13} /> MENU
          </button>
          <div className="text-[12px] tracking-[0.2em]" style={{ color: UI.dim }}>{solo ? oppName : "TAKE TURNS"}</div>
          <ForfeitButton disabled={phase === "DONE"}
            onConfirm={() => { pl.reset(); setForfeitBy(solo ? "A" : player); setPhase("DONE"); }} />
        </div>

        <ScoreBar score={score} turn={turn} turns={TURNS} inkA={INK.A} inkB={INK.B} specialHex={INK.S} labelA="P1" labelB={solo ? "AI" : "P2"} />
        {inPlay && (
          <OppQueue piece={currentPiece(decks[them])} queue={upcoming(decks[them])} ink={INK[them]} dir={them === "B" ? -1 : 1} />
        )}

        <div ref={stageRef} className="flex-1 min-h-0 flex items-center justify-center">
          <div className="relative" style={{ width: cell * COLS + g * (COLS + 1), height: boardH }}>
            <BoardGrid
              board={board} cell={cell} ink={INK} theme={theme} youSide={player}
              pendingKeys={phase === "AI_THINK" && pendingA ? new Set(pendingA.cells.map(([r, c]) => key(r, c))) : null}
              pendingInk={INK.A}
              ghostKeys={pl.ghostKeys} ghostLegal={pl.ghostLegal}
              ghostInk={INK[player]}
              contestedKeys={contestedKeys} boardRef={pl.boardRef} onPointerDown={(e) => pl.onBoardPointerDown(e, commit)}
            />

            {reveal && (
              <VanishLayer
                contested={reveal.contested} cleared={reveal.cleared}
                cell={cell} gap={g} ink={INK}
              />
            )}

            {pl.drag && pl.rotated && (
              <FloatingPiece
                cells={pl.rotated} cell={cell} gap={theme.gap}
                color={INK[player]} legal={pl.ghostLegal}
                dir={player === "B" ? -1 : 1}
                x={pl.drag.x} y={pl.drag.y} lift={pl.drag.lift} faint={pl.holding && !!pl.sel.pos}
              />
            )}

            {phase === "HANDOFF" && (
              <div className="absolute inset-0 flex flex-col items-center justify-center text-center px-5 rounded" style={{ background: UI.ground }}>
                <div className="text-[12px] tracking-[0.3em] mb-2" style={{ color: UI.dim }}>MOVE LOCKED IN</div>
                <div className="text-sm mb-6 leading-relaxed">Hand the device to <span style={{ color: INK.B }}>Player 2</span>.</div>
                <button onClick={() => setPhase("PLAY_B")} className="px-5 rounded text-[13px] tracking-widest" style={{ height: 44, ...skFill(INK.B), color: UI.text }}>
                  I'M PLAYER 2
                </button>
              </div>
            )}

            {phase === "DONE" && (
              <div className="absolute inset-0 flex flex-col items-center justify-center text-center px-4 rounded" style={{ background: "color-mix(in srgb, var(--tb-ground) 94%, transparent)" }}>
                <div className="text-[11px] tracking-[0.3em] mb-3" style={{ color: lockedOut || forfeitBy ? GOLD : UI.dim }}>
                  {forfeitBy ? (solo ? "YOU FORFEITED" : `PLAYER ${forfeitBy === "A" ? 1 : 2} FORFEITED`) : lockedOut ? "BOARD LOCKED" : "MATCH OVER"}
                </div>
                <div className="text-xl mb-1.5 tracking-wider">
                  {(() => {
                    // A forfeit decides it regardless of the score.
                    const winner = forfeitBy ? (forfeitBy === "A" ? "B" : "A") : score.a > score.b ? "A" : score.b > score.a ? "B" : null;
                    if (!winner) return "DRAW";
                    return (
                      <span style={{ color: INK[winner] }}>
                        {winner === "A" ? (solo ? "YOU WIN" : "PLAYER 1 WINS") : solo ? "AI WINS" : "PLAYER 2 WINS"}
                      </span>
                    );
                  })()}
                </div>
                <div className="text-xs mb-6" style={{ color: UI.dim }}>
                  {score.a} — {score.b}{score.s > 0 && <span style={{ color: GOLD }}> · {score.s}◆</span>}
                </div>
                <div className="flex gap-2">
                  <button onClick={onExit} className="px-4 rounded text-[12px] tracking-widest" style={{ height: 40, ...sk(UI.line), color: UI.dim }}>MENU</button>
                  <button onClick={onRestart} className="flex items-center gap-1.5 px-4 rounded text-[12px] tracking-widest" style={{ height: 40, ...skFill(UI.text), color: UI.text }}>
                    <RefreshCw size={12} /> AGAIN
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="shrink-0 flex flex-col justify-end" style={{ height: DOCK_H }}>
          {inPlay && (
            <>
              <QueueBar piece={piece} queue={upcoming(decks[player])} pass={currentPass(decks[player])}
                selected={pl.sel.handIdx === 0} dragging={pl.dragging || pl.holding} ink={INK[player]}
                onPress={pl.onCardPointerDown} dir={player === "B" ? -1 : 1} />
              <ActionBar
                ink={INK[player]}
                onRotate={pl.rotate} onCommit={commit} onDiscard={discard}
                canRotate={pl.sel.handIdx !== null} canCommit={pl.ghostLegal} canDiscard={inPlay}
              />
              <div className="text-[12px] truncate" style={{ color: UI.dim, height: 14 }}>
                {stuck ? <span style={{ color: UI.bad }}>No room for this piece — pass.</span>
                  : pl.sel.handIdx === null ? "Pick up your piece and place it."
                  : !pl.sel.pos ? "Drag it onto the grid."
                  : !pl.ghostLegal ? <span style={{ color: UI.bad }}>Must touch your own ink.</span>
                  : "Drag to adjust, then lock in."}
              </div>
            </>
          )}

          {phase === "AI_THINK" && (
            <div className="text-[13px] tracking-[0.25em] tb-pulse pb-4" style={{ color: INK.B }}>{oppName} IS THINKING</div>
          )}

          {phase === "REVEAL" && reveal && (
            <div className="text-[12px] space-y-1.5 pb-4">
              {[["A", reveal.a, "P1"], ["B", reveal.b, solo ? "AI" : "P2"]].map(([side, mv, label]) => (
                <div key={side} className="flex items-center gap-2.5">
                  <span style={{ color: INK[side], width: 20 }}>{label}</span>
                  {mv ? (<><BlockGlyph blockId={mv.blockId} box={20} color={INK[side]} /><span style={{ color: UI.dim }}>{BLOCKS[mv.blockId].name}</span></>)
                    : <span style={{ color: UI.dim }}>dropped</span>}
                </div>
              ))}
              {reveal.contested.length > 0 && <div style={{ color: GOLD }}>{reveal.contested.length} went special</div>}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ============================================================
   NET GAME — ranked. The server owns the board; we render it.
   ============================================================ */
function NetGame({ colors, theme, onResult, onAbort }) {
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

  const g = theme.gap;
  const cell = Math.max(6, Math.floor(Math.min(
    (stage.w - g * (COLS + 1)) / COLS,
    (stage.h - g * (ROWS + 1)) / ROWS
  )));

  // null until one player locks in; the server then broadcasts a deadline.
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

  if (!m || !board) {
    return (
      <div className="tb-screen tb-safe w-full flex items-center justify-center font-mono" style={{ background: UI.ground, color: UI.dim }}>
        <div className="text-[13px] tracking-[0.3em] tb-pulse">DEALING…</div>
      </div>
    );
  }

  const myScore = you === "A" ? score.a : score.b;
  const theirScore = you === "A" ? score.b : score.a;

  return (
    <div className="tb-screen tb-safe w-full flex flex-col font-mono" style={{ background: UI.ground, color: UI.text }}>
      <div className="relative flex-1 min-h-0 flex flex-col w-full mx-auto px-3" style={{ maxWidth: PHONE_W }}>
        <div className="flex items-center justify-between h-9 shrink-0">
          <ForfeitButton ranked disabled={!m || !!m.over} onConfirm={() => net.forfeit()} />
          <div className="flex items-center gap-2">
            {graceLeft !== null && (
              <span className="flex items-center gap-1 text-[12px] tabular-nums" style={{ color: GOLD }}>
                <Clock size={11} /> {graceLeft}
              </span>
            )}
            {theme.showTimer && secsLeft !== null && graceLeft === null && (
              <span className="flex items-center gap-1 text-[12px] tabular-nums" style={{ color: secsLeft <= 5 ? UI.bad : GOLD }}>
                <Clock size={11} /> {secsLeft}
              </span>
            )}
            <span className="text-[12px] tracking-[0.2em]" style={{ color: UI.dim }}>
              {m.opponent.name} · {m.opponent.rating}
            </span>
          </div>
        </div>

        <ScoreBar
          score={{ a: myScore, b: theirScore, s: score.s }}
          turn={m.turn} turns={m.turns}
          inkA={colors.you} inkB={colors.rival} specialHex={colors.special} labelA="YOU" labelB="OPP"
        />
        {m.opp && <OppQueue piece={m.opp.piece} queue={m.opp.queue} ink={colors.rival} dir={them === "B" ? -1 : 1} />}

        <div ref={stageRef} className="flex-1 min-h-0 flex items-center justify-center">
          <div className="relative" style={{ width: cell * COLS + g * (COLS + 1), height: cell * ROWS + g * (ROWS + 1) }}>
            <div className="relative" style={{ transform: flip ? "rotate(180deg)" : "none" }}>
              <BoardGrid
                board={board} cell={cell} ink={INK} theme={theme} youSide={you}
                ghostKeys={pl.ghostKeys} ghostLegal={pl.ghostLegal} ghostInk={colors.you}
                pendingKeys={pendingKeys} pendingInk={colors.you}
                contestedKeys={contestedKeys} boardRef={pl.boardRef} onPointerDown={(e) => pl.onBoardPointerDown(e, commit)}
              />
              {m.reveal && (
                <VanishLayer
                  contested={m.reveal.contested} cleared={m.reveal.cleared}
                  cell={cell} gap={g} ink={INK}
                />
              )}
            </div>

            {pl.drag && pl.rotated && (
              <FloatingPiece
                cells={pl.rotated} cell={cell} gap={theme.gap}
                color={colors.you} legal={pl.ghostLegal} flip={flip}
                dir={you === "B" ? -1 : 1}
                x={pl.drag.x} y={pl.drag.y} lift={pl.drag.lift} faint={pl.holding && !!pl.sel.pos}
              />
            )}

            {m.oppDropped && (
              <div className="absolute inset-0 flex flex-col items-center justify-center text-center px-5 rounded"
                style={{ background: "color-mix(in srgb, var(--tb-ground) 94%, transparent)" }}>
                <div className="text-[12px] tracking-[0.3em] mb-3" style={{ color: GOLD }}>OPPONENT DROPPED</div>
                {graceLeft !== null && (
                  <div className="text-[38px] leading-none tabular-nums mb-3" style={{ color: GOLD }}>{graceLeft}</div>
                )}
                <div className="text-[13px] leading-relaxed" style={{ color: UI.dim }}>
                  Holding their seat. If they don't return, you take the win.
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="shrink-0 flex flex-col justify-end" style={{ height: DOCK_H }}>
          <QueueBar
            piece={piece} queue={m.queue || []} pass={m.pass || 1}
            selected={pl.sel.handIdx === 0} dragging={pl.dragging || pl.holding}
            ink={colors.you} onPress={pl.onCardPointerDown} disabled={!canAct} spent={!!pending}
            dir={you === "B" ? -1 : 1}
          />
          <ActionBar
            ink={colors.you}
            onRotate={pl.rotate} onCommit={commit} onDiscard={discard}
            canRotate={canAct && pl.sel.handIdx !== null}
            canCommit={canAct && pl.ghostLegal}
            canDiscard={canAct}
          />
          <div className="text-[12px] truncate" style={{ color: UI.dim, height: 14 }}>
            {err ? <span style={{ color: UI.bad }}>{err}</span>
              : m.reveal ? (
                m.reveal.contested.length
                  ? <span style={{ color: GOLD }}>{m.reveal.contested.length} went special</span>
                  : "Turn resolved."
              )
              : m.submitted ? <span className="tb-pulse">Locked in — waiting for {m.opponent.name}…</span>
              : m.oppReady ? <span style={{ color: GOLD }}>They've locked in. Your move.</span>
              : stuck ? <span style={{ color: UI.bad }}>No room for this piece — pass.</span>
              : pl.sel.handIdx === null ? "Pick up your piece and place it."
              : !pl.sel.pos ? "Drag it onto the grid."
              : !pl.ghostLegal ? <span style={{ color: UI.bad }}>Must touch your own ink.</span>
              : "Drag to adjust, then lock in."}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ============================================================
   RESULT
   ============================================================ */
function Result({ over, colors, onQueue, onMenu }) {
  const { won, drew, forfeit, reason, myScore, oppScore, special, opponent, rating } = over;
  const trFrom = Math.round(rating.before.r);
  const trTo = Math.round(rating.after.r);
  const delta = trTo - trFrom;
  const riFrom = rankIndexFor(trFrom);
  const riTo = rankIndexFor(trTo);
  const rank = RANKS[riTo];
  // Verdict and rating movement use your own palette, not fixed red/green.
  const verdictInk = drew ? UI.text : won ? colors.you : colors.rival;
  const deltaInk = delta >= 0 ? colors.you : colors.rival;

  const [shown, setShown] = useState(trFrom);
  useEffect(() => {
    const dur = 950;
    const t0 = performance.now();
    let raf;
    const step = (t) => {
      const k = Math.min(1, (t - t0) / dur);
      setShown(Math.round(trFrom + (trTo - trFrom) * (1 - Math.pow(1 - k, 3))));
      if (k < 1) raf = requestAnimationFrame(step);
    };
    const delay = setTimeout(() => { raf = requestAnimationFrame(step); }, 420);
    return () => { clearTimeout(delay); cancelAnimationFrame(raf); };
  }, [trFrom, trTo]);

  return (
    <div className="tb-screen tb-safe w-full flex flex-col items-center justify-center px-6 font-mono" style={{ background: UI.ground, color: UI.text }}>
      <div
        aria-hidden="true"
        className="absolute inset-0 pointer-events-none"
        style={{
          background: `radial-gradient(ellipse at 50% 34%, color-mix(in srgb, ${verdictInk} 26%, transparent) 0%, transparent 62%)`,
        }}
      />
      <div className="relative w-full" style={{ maxWidth: 330 }}>
        <div className="text-center mb-7">
          <div className="text-[32px] leading-none tracking-[0.15em]" style={{ color: verdictInk }}>
            {drew ? "DRAW" : won ? "VICTORY" : "DEFEAT"}
          </div>
          <div className="text-[13px] mt-3" style={{ color: UI.dim }}>
            {myScore} — {oppScore} vs {opponent.name}
            {special > 0 && <span style={{ color: GOLD }}> · {special}◆</span>}
          </div>
          {forfeit ? (
            <div className="text-[12px] mt-1.5" style={{ color: GOLD }}>opponent forfeited</div>
          ) : reason === "forfeit" ? (
            <div className="text-[12px] mt-1.5" style={{ color: GOLD }}>you forfeited</div>
          ) : reason === "locked" ? (
            <div className="text-[12px] mt-1.5" style={{ color: GOLD }}>board locked — no legal moves left</div>
          ) : null}
        </div>

        <div className="rounded p-4 mb-4" style={{ background: UI.panel, ...sk(UI.line) }}>
          <div className="flex items-center gap-3.5 mb-4">
            <div className="rounded flex items-center justify-center shrink-0" style={{ width: 58, height: 58, background: `${rank.color}1F`, ...sk(rank.color) }}>
              <span className="text-2xl" style={{ color: rank.color }}>{rank.name}</span>
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-baseline gap-2">
                <span className="text-2xl leading-none tabular-nums">{shown}</span>
                <span className="text-sm tabular-nums" style={{ color: deltaInk }}>
                  {delta >= 0 ? "+" : ""}{delta}
                </span>
              </div>
              <div className="h-1 w-full rounded overflow-hidden mt-3" style={{ background: UI.cell }}>
                <div style={{ width: `${rankProgress(shown) * 100}%`, height: "100%", background: rank.color, transition: "width 120ms linear" }} />
              </div>
            </div>
          </div>
          <div className="flex justify-between text-[11px]" style={{ color: UI.dim }}>
            <span>DEVIATION ±{Math.round(rating.after.rd)}</span>
            <span>from ±{Math.round(rating.before.rd)}</span>
          </div>
        </div>

        {riTo !== riFrom && (
          <div className="rounded px-3.5 py-2.5 mb-4 text-[12px] tracking-[0.2em] text-center"
            style={{ background: `${rank.color}14`, ...sk(rank.color), color: rank.color }}>
            {riTo > riFrom ? `PROMOTED TO ${rank.name}` : `DEMOTED TO ${rank.name}`}
          </div>
        )}

        <div className="flex gap-2.5">
          <button onClick={onMenu} className="flex-1 rounded text-[12px] tracking-[0.25em]" style={{ height: 48, ...sk(UI.line), color: UI.dim }}>MENU</button>
          <button onClick={onQueue} className="rounded text-[12px] tracking-[0.25em]" style={{ height: 48, flex: 1.5, ...skFill(UI.text), color: UI.text }}>QUEUE AGAIN</button>
        </div>
      </div>
    </div>
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
  const [over, setOver] = useState(null);

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
      :root { ${themeVars(theme)} }
      .tb-screen { height: 100vh; height: 100dvh; overscroll-behavior: none; position: relative; }
      .tb-safe {
        padding-top: env(safe-area-inset-top, 0px);
        padding-bottom: env(safe-area-inset-bottom, 0px);
        padding-left: env(safe-area-inset-left, 0px);
        padding-right: env(safe-area-inset-right, 0px);
      }
      .tb-scroll { -webkit-overflow-scrolling: touch; scrollbar-width: none; }
      .tb-scroll::-webkit-scrollbar { width: 0; height: 0; display: none; }
      /* Type: Indie Flower, a handwritten face, everywhere. The class name is
         historical. It has one weight and no italic, so the browser is told not
         to fake bold or slanted versions, which smear handwriting. */
      .font-mono { font-family: "Indie Flower", "Comic Neue", "Chalkboard SE", cursive; font-synthesis: none; }
      .font-mono .italic, .font-mono em { font-style: normal; opacity: .85; }
      .tb-display { font-family: "Indie Flower", cursive; font-weight: 400; }
      .lucide { stroke-width: 1.6; }

      /* Paper: grain and a vignette over everything, drawn once, never animated. */
      body::after {
        content: ""; position: fixed; inset: 0; pointer-events: none; z-index: 60;
        background: radial-gradient(ellipse at 50% 45%, transparent 52%, rgba(0,0,0, calc(var(--tb-vignette) * .55)) 100%);
      }
      body::before {
        content: ""; position: fixed; inset: 0; pointer-events: none; z-index: 60;
        background: var(--tb-grain); background-size: 330px 330px;
        opacity: var(--tb-grain-o);
      }

      /* Ink going down: the strokes are wiped on left to right, like a pen pass. */
      @keyframes tbDrop { from { clip-path: inset(0 100% 0 0) } to { clip-path: inset(0 0 0 0) } }
      .tb-drop { animation: tbDrop .24s cubic-bezier(.3,.7,.4,1) both; }
      @keyframes tbFadeIn { from { opacity: 0; transform: scale(.94) } to { opacity: 1; transform: none } }
      .tb-fadein { animation: tbFadeIn 1.8s ease-out both; }
      @keyframes tbBoot { from { clip-path: inset(0 100% 0 0); opacity: 0 } to { clip-path: inset(0 0 0 0); opacity: 1 } }
      .tb-boot { animation: tbBoot 900ms ease-out both; }
      /* A collision: the square shudders. */
      @keyframes tbContest {
        0%,100% { transform: none } 20% { transform: translate(-1.5px, 1px) rotate(-4deg) }
        40% { transform: translate(1.5px, -1px) rotate(3deg) } 60% { transform: translate(-1px, -1px) rotate(-2deg) }
        80% { transform: translate(1px, 1px) rotate(1deg) }
      }
      .tb-contest { animation: tbContest .42s steps(5) 2; z-index: 2; }
      /* Erased: the ink lifts, twists and fades like a rubbed-out mark. */
      @keyframes tbVanish {
        0%   { transform: none; opacity: 1 }
        35%  { transform: rotate(-6deg) scale(1.08); opacity: .9 }
        100% { transform: rotate(14deg) scale(.55); opacity: 0 }
      }
      .tb-vanish { animation: tbVanish 560ms cubic-bezier(.32,0,.2,1) both; }
      /* Line boil: a held drawing redrawn a few times a second. Marks charged things. */
      @keyframes tbBoil {
        0%   { transform: translate(0, 0) rotate(0) }
        33%  { transform: translate(.6px, -.4px) rotate(.5deg) }
        66%  { transform: translate(-.5px, .5px) rotate(-.4deg) }
      }
      .tb-boil { animation: tbBoil .42s steps(1) infinite; }
      @keyframes tbPulse { 0%,100% { opacity:.45 } 50% { opacity:1 } }
      .tb-pulse { animation: tbPulse 1.4s ease-in-out infinite; }
      @keyframes tbFade { from { opacity: 0 } to { opacity: 1 } }
      .tb-fade { animation: tbFade .16s ease-out both; }
      /* Cards land like a sheet of paper dropped on a desk. */
      @keyframes tbPop { from { opacity: 0; transform: rotate(-1.4deg) translateY(10px) } to { opacity: 1; transform: none } }
      .tb-pop { animation: tbPop .22s cubic-bezier(.2,.9,.3,1) both; }
      ${theme.motion ? "" : ".tb-contest,.tb-drop,.tb-boot,.tb-fadein,.tb-pulse,.tb-fade,.tb-pop,.tb-boil { animation: none !important }"}
      @media (prefers-reduced-motion: reduce) {
        .tb-contest,.tb-drop,.tb-boot,.tb-fadein,.tb-pulse,.tb-fade,.tb-pop,.tb-boil { animation: none }
      }
      button { cursor: pointer; }
      /* A phone held sideways leaves the 8×16 board too short to aim at. */
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
        onResult={(o) => { setOver(o); setScreen("RESULT"); }}
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
    <InkStyle.Provider value={theme.stroke}>
      <PencilDefs />{shell}{view}
      <div className="tb-rotate font-mono" aria-live="polite">
        <RotateCw size={26} style={{ color: UI.dim }} />
        <div className="text-[16px]">Turn your phone upright</div>
        <div className="text-[12px]" style={{ color: UI.dim }}>The board needs the height. Your game is still here.</div>
      </div>
    </InkStyle.Provider>
  );
}