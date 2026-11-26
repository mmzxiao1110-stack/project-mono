import React, { useState, useEffect, useMemo, useCallback, useRef, useSyncExternalStore, createContext, useContext, useLayoutEffect } from "react";
import {
  RotateCw, Check, SkipForward, ChevronLeft, Settings2, X,
  Wifi, WifiOff, UserRound, LogOut,
  Palette, Lock, MailCheck, ShieldAlert, BookOpen, ChevronRight, Eraser, Pin, Film, Play, Pause, First,
  Chat, Terminal as TerminalIcon,
  Trophy, Stack, People, Robot, Clock, RefreshCw, Flag,
} from "./pixelIcons.jsx";
import { PlayerRecord } from "./site/terminal.jsx";
import { apiGet } from "./site/api.js";
import { ACCENTS } from "./site/colors.js";
import { PixelWord } from "./site/kit.jsx";
import { Avatar, ProfileCard } from "./site/profileCard.jsx";
import { RankIcon } from "./site/rankIcon.jsx";
import { cardFromProfile } from "./site/profileData.js";
import { cleanCard } from "../shared/card.js";

/* The rules live in one place and the server imports the same file. */
import {
  COLS, ROWS, TURNS, BLOCKS, DEFAULT_LOADOUT, isCentre,
  key, rotateN, boundsOf, absCells, initialBoard, isLegal,
  hasAnyMove, resolveTurn, scoreOf, newDeck, advanceDeck, currentPiece, currentPass, upcoming, QUEUE_SHOWN, newSeed,
  emptyPins, nextMeters, isLegalDelete, isLegalPin, normalizeAction, stampHits,
  isCheckTurn, shrinkBoard,
} from "../shared/engine.js";
import { aiPickAction, aiPickActionDeep } from "../shared/ai.js";
import {
  SIZE as M_SIZE, PIECES as M_PIECES, newMarathon, newMarathonSeed, placePiece as mPlace, fits as mFits,
  fitsAnywhere as mFitsAnywhere, levelOf as mLevelOf, encodeMoves, decodeMoves, TUNING as M_TUNING, shapeOf as mShape,
} from "../shared/marathon.js";
import { encodeAction, encodeTurn } from "../shared/notation.js";
import { REPLAY_VERSION, buildFrames, exportReplay, importReplay } from "../shared/replay.js";
import { replays } from "./replays.js";
import {
  RANKS, PLACEMENT_GAMES, rankIndexFor, rankMin, rankProgress,
} from "../shared/glicko.js";
import { net, SERVER_URL, IS_SECURE, GOOGLE_CLIENT_ID } from "./net.js";
import { FX } from "./tuning.js";
import { SkyCanvas, sky, rgbOf, mixRgb, BAYER } from "./sky.jsx";
import { VERSION_LABEL } from "./version.js";
import { sfx, setVolume, installUiSounds, core, unlock } from "./sfx.js";
import { music } from "./music.js";
import { RULES } from "../shared/rules.js";
import {
  PRESETS, INKS, STROKES, GRID_GAPS,
  loadTheme, saveTheme, applyPreset, editTheme, themeVars,
} from "./theme.js";
import { ACTIONS, getKeys, subscribeKeys, setKey, resetKeys, actionFor, keyLabel, canBind } from "./keys.js";
import { ZG_ACTIONS, HANDLING, SDF_MAX, zgSubscribe, getZgKeys, getZgHandling, setZgKey, setZgHandling, resetZg, zgActionFor } from "./zgKeys.js";
import {
  W as Z_W, TOP as Z_TOP, VISIBLE as Z_VISIBLE, NEXT as Z_NEXT, GOAL as Z_GOAL, NAMES as Z_NAMES, newGame as zNewGame, shapeCells as zShapeCells,
  cellsOf as zCellsOf, dropped as zDropped, shift as zShift, down as zDown, rotate as zRotate, hold as zHold, hardDrop as zHardDrop,
} from "../shared/zerog.js";
import { SPRINT_ACTIONS, getSprintKeys, subscribeSprintKeys, setSprintKey, resetSprintKeys, sprintActionFor, mouseName, mouseLabel } from "./sprintKeys.js";
import {
  SIZE as S_SIZE, GOAL as S_GOAL, NAMES as S_NAMES, newSprint, newSprintSeed, shapeOf as sShapeOf, spawn as sSpawn, cellsOf as sCellsOf,
  turn as sTurn, canPlace as sCanPlace, place as sPlace, at as sAt,
  recordMove as sRecordMove,
  isJunk as sIsJunk, junkLevel as sJunkLevel, FORECAST as S_FORECAST, JUNK as S_JUNK, noteClear as sNoteClear, spikeOnMiss as sSpikeOnMiss, receiveJunk as sReceiveJunk, redCells as sRedCells, redFull as sRedFull, RED_FLASH_MS as S_RED_FLASH_MS, ULTRA_MS as S_ULTRA_MS, comboMult as sComboMult,
} from "../shared/sprint.js";
import { botMove, botPps, botDelay } from "../shared/blitzbot.js";

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
    // Tinted glass: the sky shows through.
    background: `color-mix(in srgb, ${color} ${dense ? 80 : 30}%, transparent)`,
    boxShadow: `inset 0 ${PX} 0 color-mix(in srgb, ${color} 60%, white), inset 0 calc(var(--p) * -1) 0 color-mix(in srgb, ${color} 55%, black)`,
  };
}
/** A framed pane of clear glass: the frame of `sk`, a faint frosted fill. */
function glass(color = UI.line) {
  return { ...sk(color), background: "color-mix(in srgb, var(--tb-text) 7%, transparent)" };
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
// AI strength 1–10 (10 plays at full strength; see aiPickAction).
const LEVELS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10"];
const DEFAULT_LEVEL = 4;


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


// Everyone plays the seven tetrominoes; old saved decks are ignored.
const loadLoadout = () => [...DEFAULT_LOADOUT];
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
  room: (cb) => net.on("room", cb),
};
const useKeys = () => useSyncExternalStore(subscribeKeys, getKeys);
// Key hints only make sense where there's a keyboard and a mouse, not on phones.
const HAS_KEYBOARD = typeof window !== "undefined" && !!window.matchMedia?.("(hover: hover) and (pointer: fine)").matches;
const useOnline = () => useSyncExternalStore(subs.online, () => net.online);
const useNotice = () => useSyncExternalStore(subs.notice, () => net.notice);
const useMatch = () => useSyncExternalStore(subs.match, () => net.match);
const useStatus = () => useSyncExternalStore(subs.status, () => net.status);
const useProfile = () => useSyncExternalStore(subs.profile, () => net.profile);
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
 * Delete and pin: which mode you're in, the shape you've traced, and pins
 * waiting to ride along with your move.
 *
 * In delete or pin mode, press on the board and drag: every square the
 * pointer passes over joins the shape, as long as it touches a square
 * already in it — drag straight for an I, trace an S, or run along three
 * and step off the middle for a T. Up to four squares (pins: up to your
 * meter). Press again to start over.
 */
function useActions({ board, pins, owner, meter, enabled, boardRef, flip = false, onLeavePlace }) {
  const [mode, setModeState] = useState("place");
  const [trace, setTrace] = useState([]);
  const [staged, setStaged] = useState(null); // free pins, confirmed, riding along with the move
  const pinsSafe = pins || EMPTY_PINS;

  // Pins: no more than the meter, the per-pin limit, and what you may still hold.
  const held = useMemo(() => {
    if (!board || !Number.isFinite(RULES.pinHoldMax)) return 0;
    let n = 0;
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) if (pinsSafe[r][c] && board[r][c] === owner) n++;
    return n;
  }, [board, pinsSafe, owner]);
  const max = mode === "delete" ? RULES.deleteMax
    : Math.max(0, Math.min(RULES.pinMax, meter, Number.isFinite(RULES.pinHoldMax) ? RULES.pinHoldMax - held : Infinity));
  // Scattered pins (RULES.pinConnected off): squares needn't touch.
  const loose = mode === "pin" && !RULES.pinConnected;
  const stagedKeys = useMemo(() => new Set((staged || []).map(([r, c]) => key(r, c))), [staged]);
  const ok = useCallback((r, c) => {
    if (!board || r < 0 || c < 0 || r >= ROWS || c >= COLS) return false;
    const v = board[r][c];
    if (v === null || pinsSafe[r][c]) return false;
    if (mode === "delete") return !stagedKeys.has(key(r, c));
    return !RULES.pinOwnOnly || v === owner;
  }, [board, pinsSafe, mode, owner, stagedKeys]);

  const cellAt = useCallback((x, y) => {
    const el = boardRef.current;
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    const sc = Math.floor(((x - rect.left) / rect.width) * COLS), sr = Math.floor(((y - rect.top) / rect.height) * ROWS);
    if (sc < 0 || sr < 0 || sc >= COLS || sr >= ROWS) return null;
    return flip ? [ROWS - 1 - sr, COLS - 1 - sc] : [sr, sc];
  }, [boardRef, flip]);

  const touches = (cells, [r, c]) => cells.some(([a, b]) => {
    const dr = Math.abs(a - r), dc = Math.abs(b - c);
    return RULES.connectDiagonal ? Math.max(dr, dc) === 1 : dr + dc === 1;
  });

  /** Grow the shape toward the pointer, one square at a time, so fast drags don't skip. */
  const grow = useCallback((cells, target) => {
    let cur = cells;
    for (let guard = 0; guard < 8; guard++) {
      if (cur.length >= max || cur.some(([a, b]) => a === target[0] && b === target[1])) return cur;
      if (loose || touches(cur, target)) return ok(...target) ? [...cur, target] : cur;
      // Step from the nearest square in the shape toward the target, the long way first.
      let near = cur[0], nd = Infinity;
      for (const q of cur) { const d = Math.abs(q[0] - target[0]) + Math.abs(q[1] - target[1]); if (d < nd) { nd = d; near = q; } }
      const dr = target[0] - near[0], dc = target[1] - near[1];
      const step = Math.abs(dr) >= Math.abs(dc) ? [near[0] + Math.sign(dr), near[1]] : [near[0], near[1] + Math.sign(dc)];
      if (cur.some(([a, b]) => a === step[0] && b === step[1]) || !ok(...step)) return cur;
      cur = [...cur, step];
    }
    return cur;
  }, [max, ok, loose]);

  const onPointerDown = useCallback((e) => {
    if (!enabled || mode === "place" || e.button > 0) return;
    e.preventDefault();
    const start = cellAt(e.clientX, e.clientY);
    if (!start || !ok(...start) || max < 1) { if (!loose) setTrace([]); return; }
    // Scattered pins: a tap adds or removes one square; a drag adds more.
    let cur;
    if (loose) {
      const had = trace.some(([a, b]) => a === start[0] && b === start[1]);
      cur = had ? trace.filter(([a, b]) => a !== start[0] || b !== start[1]) : trace.length < max ? [...trace, start] : trace;
    } else cur = [start];
    setTrace(cur);
    const onMove = (ev) => {
      ev.preventDefault();
      const c = cellAt(ev.clientX, ev.clientY);
      if (!c) return;
      const next = grow(cur, c);
      if (next !== cur) { cur = next; setTrace(cur); }
    };
    const noScroll = (ev) => { if (ev.cancelable) ev.preventDefault(); };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      window.removeEventListener("touchmove", noScroll);
    };
    window.addEventListener("pointermove", onMove, { passive: false });
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    window.addEventListener("touchmove", noScroll, { passive: false });
  }, [enabled, mode, cellAt, ok, grow, max, loose, trace]);

  /** 1 / 2 / 3: switch modes. Pressing the mode you're in again goes back to placing. */
  const setMode = useCallback((m) => {
    const next = m === mode && m !== "place" ? "place" : m;
    if (next === "pin" && (meter < 1 || !RULES.actions)) return;
    if (next === "delete" && !RULES.actions) return;
    if (next !== "place") onLeavePlace?.();
    setTrace([]);
    setModeState(next);
  }, [mode, meter, onLeavePlace]);

  const deleteValid = mode === "delete" && !!board && isLegalDelete(board, pinsSafe, trace);
  const pinValid = mode === "pin" && !!board && isLegalPin(board, pinsSafe, trace, owner, meter);

  /** Free pins: keep the traced squares for this turn's move and go back to placing. */
  const confirmPins = useCallback(() => {
    if (!pinValid) return false;
    setStaged(trace);
    setTrace([]);
    setModeState("place");
    return true;
  }, [pinValid, trace]);

  const reset = useCallback(() => { setModeState("place"); setTrace([]); setStaged(null); }, []);

  return { mode, setMode, trace, staged, onPointerDown, deleteValid, pinValid, confirmPins, reset, setStaged };
}
const EMPTY_SET = new Set();
const EMPTY_PINS = Array.from({ length: ROWS }, () => Array(COLS).fill(false));

/**
 * Stamps (RULES.stamp): in delete or pin mode your current piece becomes a
 * stamp. It moves and turns like a placement, but can go anywhere; what it
 * covers is what it deletes (any ink, never pinned) or pins (your own).
 */
function useStamp({ board, pins, owner, meter, act, pl }) {
  const on = RULES.stamp && act.mode !== "place";
  const foot = on && pl.ghost ? pl.ghost : null;
  const pinsSafe = pins || EMPTY_PINS;
  const hits = foot && board ? stampHits(board, pinsSafe, foot, act.mode === "delete" ? "delete" : "pin", owner) : [];
  const ok = !!foot && hits.length > 0 && (act.mode === "delete" || hits.length <= meter);
  const stagedHits = RULES.stamp && act.staged && board ? stampHits(board, pinsSafe, act.staged, "pin", owner) : act.staged || [];
  return { on, foot, hits, ok, stagedHits };
}

/**
 * Keyboard play, shared by the local and ranked games. Movement is relative
 * to the screen, so on a board rotated for seat B, "up" still means up.
 */
function useGameKeys(pl, { enabled, onCommit, onDiscard, onMode, mode = "place" }) {
  // Handlers change every render; the listener reads the latest through a ref
  // instead of re-binding on every keystroke.
  const ref = useRef(null);
  const modeRef = useRef(mode);
  useLayoutEffect(() => { ref.current = { pl, enabled, onCommit, onDiscard, onMode }; modeRef.current = mode; });

  useEffect(() => {
    const onKey = (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      if (!ref.current) return;
      const { pl, enabled, onCommit, onDiscard, onMode } = ref.current;
      if (e.key === "Escape" && pl.holding) { e.preventDefault(); return pl.reset(); }
      const action = actionFor(e.key);
      if (!action) return;
      e.preventDefault();
      if (!enabled || pl.dragging) return;

      if (action === "erase") return onMode?.("delete");
      if (action === "pinmode") return onMode?.("pin");
      if (action === "slot1") { onMode?.("place"); return pl.select(0); }
      if (action === "commit" && modeRef.current !== "place") return onCommit();
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

function PixelSky({ theme }) {
  return <SkyCanvas theme={theme} px={usePx()} />;
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
    if (n >= 3) {
      // A bubble: a bright glint top-left, a speck of light top-right, the
      // top half lit, the bottom and right edges curving into shade.
      const less = (k) => `calc(100% - ${px(k)})`;
      const band = Math.max(2, Math.floor(art * 0.42));
      L.push(
        layer("rgba(255,255,255,.9)", px(2), px(2), px(2), PX),
        layer("rgba(255,255,255,.65)", px(2), px(3), PX, PX),
        layer("rgba(255,255,255,.45)", less(3), px(2), PX, PX),
        layer(c.dark, less(2), px(3), PX, less(5)),
        layer(c.dark, px(3), less(2), less(5), PX),
        layer(c.light, px(2), PX, less(4), PX),
        layer(`color-mix(in srgb, ${c.light} 55%, ${c.base})`, PX, PX, less(2), px(band)),
        layer(c.base, PX, PX, less(2), less(2)),
        c.dark,
      );
      return L.join(", ");
    }
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

// The longest piece any glyph has to fit, in squares.
const GLYPH_SPAN = Math.max(...BLOCKS.map((b) => { const { h, w } = boundsOf(b.cells); return Math.max(h, w); }));

/** A block's silhouette, drawn in ink. Used on cards, in the deck and the tutorial. */
function BlockGlyph({ blockId, box = 40, color, gap: _gap, glow = false }) {
  const P = usePx();
  const cells = BLOCKS[blockId].cells;
  const { h, w } = boundsOf(cells);
  // Every glyph uses the same square size (sized for the longest piece), so an
  // O isn't drawn with bigger squares than an I. Whole pixels, no gap.
  const gap = 0;
  const size = Math.max(1, Math.floor(box / GLYPH_SPAN / P)) * P;
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

// Colourblind marks, 5×5 pixels: shape, not just hue. Yours are rings,
// theirs are crosses, contested squares are diamonds.
const CB_MARKS = {
  ring: ["01110", "10001", "10001", "10001", "01110"],
  cross: ["10001", "01010", "00100", "01010", "10001"],
  diamond: ["00100", "01110", "11111", "01110", "00100"],
};
function CbMark({ shape, color, art }) {
  const P = usePx();
  const at = Math.floor((art - 5) / 2) * P; // on the pixel grid, not half a pixel off
  return (
    <span className="absolute pointer-events-none" style={{ left: at, top: at }}>
      <svg aria-hidden="true" width={5 * P} height={5 * P} style={{ display: "block" }} viewBox="0 0 5 5" shapeRendering="crispEdges">
        {CB_MARKS[shape].flatMap((row, y) => row.split("").map((v, x) => (v === "1"
          ? <rect key={`${x}-${y}`} x={x} y={y} width={1} height={1} fill={color} /> : null)))}
      </svg>
    </span>
  );
}

function BoardGrid({
  board, cell, ink, ghostKeys, ghostLegal, ghostInk, contestedKeys,
  boardRef, onPointerDown, theme, youSide = "A", ghostGolden = false,
  pendingKeys = null, pendingInk = null,
  pins = null, traceKeys = null, traceKind = null, traceOk = false, stagedKeys = null, ghostPinned = false,
  otFlash = null, marks = null,
}) {
  const P = usePx();
  const gap = (theme.gap ?? 1) * P;
  const cb = theme.colorblind;
  // Every square is its own little pane of glass with pixel-rounded corners.
  const art = Math.round(cell / P);
  const clip = art >= 9 ? CLIP : CLIP1;
  const shine = glassShine(art);
  // A pinned square wears a fine chessboard: one-pixel checks.
  const q = P;
  const CHESS = `repeating-conic-gradient(rgba(255,255,255,.26) 0 25%, rgba(0,0,0,.30) 0 50%) 0 0 / ${2 * q}px ${2 * q}px`;
  const DITHER = (col) => `repeating-conic-gradient(${col} 0 25%, transparent 0 50%) 0 0 / ${2 * P}px ${2 * P}px`;

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
          if (v === "X") {
            // Dead (overtime squeezed the board past it): dark, with a pixel X.
            return (
              <div key={k} style={{ position: "relative", clipPath: clip, background: "rgba(8,8,12,.55)", boxShadow: `inset 0 0 0 ${P}px rgba(255,255,255,.05)` }}>
                <CbMark shape="cross" art={art} color="rgba(255,255,255,.16)" />
              </div>
            );
          }
          const isGhost = ghostKeys.has(k);
          const owner = isGhost ? youSide : v;
          const seed = r * COLS + c;

          let mark = null;
          if (cb && owner && cell >= 7 * P) {
            const shape = owner === "S" ? "diamond" : owner === youSide ? "ring" : "cross";
            // Dark on a claimed square; in the player's colour on a shadow.
            mark = <CbMark shape={shape} art={art} color={isGhost && !v ? ghostInk : "rgba(12,10,20,.78)"} />;
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
              {isGhost && ghostPinned && (
                // PIN is on: the piece will land pinned.
                <span aria-hidden="true" style={{ position: "absolute", inset: 0, pointerEvents: "none", background: CHESS, opacity: ghostLegal ? 0.7 : 0.3 }} />
              )}
              {v && pins?.[r]?.[c] && (
                <span aria-hidden="true" style={{ position: "absolute", inset: 0, pointerEvents: "none", background: CHESS, boxShadow: `inset 0 0 0 ${P}px rgba(255,255,255,.45)` }} />
              )}
              {stagedKeys?.has(k) && (
                // Pins riding along with this move: the chessboard, dimmed until it lands.
                <span aria-hidden="true" style={{ position: "absolute", inset: 0, pointerEvents: "none", background: CHESS, opacity: 0.6, boxShadow: `inset 0 0 0 ${P}px ${UI.text}` }} />
              )}
              {traceKeys?.has(k) && (
                <span aria-hidden="true" style={{
                  position: "absolute", inset: 0, pointerEvents: "none",
                  background: traceKind === "pin" ? CHESS : DITHER("rgba(255,90,110,.75)"),
                  boxShadow: `inset 0 0 0 ${P}px ${traceOk ? (traceKind === "pin" ? UI.text : UI.bad) : UI.dim}`,
                }} />
              )}
              {marks?.has(k) && (
                // Replays: what changed on this turn, outlined in whose move it was.
                <span aria-hidden="true" style={{ position: "absolute", inset: 0, pointerEvents: "none", zIndex: 2,
                  boxShadow: `inset 0 0 0 ${2 * P}px ${marks.get(k)}` }} />
              )}
              <span aria-hidden="true" style={{ position: "absolute", inset: 0, pointerEvents: "none", background: shine }} />
              {mark}
            </div>
          );
        })
      )}
      {otFlash && (
        <div aria-live="polite" className="absolute inset-0 flex items-center justify-center pointer-events-none" style={{ zIndex: 3 }}>
          <div className="tb-t tb-b tb-rise" style={{
            padding: `${3 * P}px ${8 * P}px`, color: "var(--tb-text)", letterSpacing: 2 * P,
            background: "color-mix(in srgb, var(--tb-special) 45%, #05040d)", boxShadow: `inset 0 ${P}px 0 rgba(255,255,255,.3), 0 0 0 ${P}px var(--tb-special)`, clipPath: CLIP,
          }}>{otFlash}</div>
        </div>
      )}
    </div>
  );
}

/* ---------- In-game buttons: panes of tinted glass with pixel-rounded corners ---------- */

// How far each of the top rows is pulled in at the corners: a pixel rounded rectangle.
const PAD_CORNER = [2, 1];

/** Rows of a pixel rounded rectangle `w`×`h` (in pixels): [y, x0, x1). */
function padRows(w, h) {
  const rows = [];
  for (let y = 0; y < h; y++) {
    const fromEdge = Math.min(y, h - 1 - y);
    const inset = fromEdge < PAD_CORNER.length ? PAD_CORNER[fromEdge] : 0;
    rows.push([y, inset, w - inset]);
  }
  return rows;
}

/** The glass itself, in whole pixels: a rim, a see-through tinted body, light on top, shade below. */
function BubbleShape({ w, h, tint, fill = 14 }) {
  const P = usePx();
  const outer = padRows(w, h);
  const inner = padRows(w - 2, h - 2).map(([y, a, b]) => [y + 1, a + 1, b + 1]);
  return (
    <svg aria-hidden="true" width={w * P} height={h * P} viewBox={`0 0 ${w} ${h}`} shapeRendering="crispEdges"
      style={{ position: "absolute", left: 0, top: 0, pointerEvents: "none" }}>
      {/* Rim: the outer shape's edge pixels, wherever the body doesn't reach. */}
      {outer.flatMap(([y, a, b]) => {
        const inn = inner.find(([iy]) => iy === y);
        const rim = `color-mix(in srgb, ${tint} 70%, transparent)`;
        if (!inn) return [<rect key={`o${y}`} x={a} y={y} width={b - a} height={1} style={{ fill: rim }} />];
        return [
          <rect key={`l${y}`} x={a} y={y} width={inn[1] - a} height={1} style={{ fill: rim }} />,
          <rect key={`r${y}`} x={inn[2]} y={y} width={b - inn[2]} height={1} style={{ fill: rim }} />,
        ];
      })}
      {inner.map(([y, a, b]) => <rect key={`i${y}`} x={a} y={y} width={b - a} height={1} style={{ fill: `color-mix(in srgb, ${tint} ${fill}%, rgba(255,255,255,.04))` }} />)}
      <rect x={inner[0][1] + 1} y={1} width={inner[0][2] - inner[0][1] - 2} height={1} fill="rgba(255,255,255,.32)" />
      <rect x={1} y={3} width={1} height={Math.max(1, h - 6)} fill="rgba(255,255,255,.12)" />
      <rect x={inner[0][1] + 1} y={h - 2} width={inner[0][2] - inner[0][1] - 2} height={1} fill="rgba(0,0,0,.28)" />
      <rect x={2} y={2} width={2} height={1} fill="rgba(255,255,255,.55)" />
    </svg>
  );
}

/** Button size in pixels: a fingertip (a little less in the phone's crowded row), and odd, so a 9-pixel icon sits dead centre. */
function useBubble(compact = false) {
  const P = usePx();
  const d = Math.max(13, Math.ceil((compact ? 36 : 40) / P));
  return d % 2 ? d : d + 1;
}

const ICON = 9; // every pixel icon is 9×9

function Bubble({ w, h, tint = UI.text, fill, label, children, className = "", style, ...rest }) {
  const P = usePx();
  return (
    <button aria-label={label} title={label} {...rest}
      className={`relative shrink-0 disabled:opacity-35 ${className}`}
      style={{ width: w * P, height: h * P, color: tint, padding: 0, ...style }}>
      <BubbleShape w={w} h={h} tint={tint} fill={fill} />
      {/* Placed by pixel, not by flexbox, so the icon is exactly centred on the grid. */}
      <span className="absolute flex" style={{ left: Math.floor((w - ICON) / 2) * P, top: Math.floor((h - ICON) / 2) * P, width: ICON * P, height: ICON * P }}>
        {children}
      </span>
    </button>
  );
}

/** Delete and pin mode buttons; the pin button carries your pin count. */
function ModeButtons({ d, mode, onMode, meter, enabled }) {
  const P = usePx();
  if (!RULES.actions) return null;
  return (
    <>
      <Bubble w={d} h={d} label="Delete" tint={mode === "delete" ? UI.bad : UI.dim} fill={mode === "delete" ? 34 : 10}
        onClick={() => onMode("delete")} disabled={!enabled} aria-pressed={mode === "delete"}><Eraser /></Bubble>
      <div className="relative shrink-0">
        <Bubble w={d} h={d} label={`Pin (${meter})`} tint={mode === "pin" ? UI.text : UI.dim} fill={mode === "pin" ? 30 : 10}
          onClick={() => onMode("pin")} disabled={!enabled || meter < 1} aria-pressed={mode === "pin"}><Pin /></Bubble>
        <span className="absolute tb-t tb-b tabular-nums pointer-events-none" aria-hidden="true"
          style={{ right: -P, bottom: -2 * P, color: meter ? GOLD : UI.dim, textShadow: `${P}px ${P}px 0 rgba(0,0,0,.6)` }}>{meter}</span>
      </div>
    </>
  );
}

/**
 * The right rail: TURN, LOCK IN (the tall one) and PASS at the top, the
 * turn number in the middle, FORFEIT at the bottom.
 */
function ActionRail({
  height, ink, onRotate, onCommit, onDiscard, canRotate, canCommit, canDiscard,
  turn, waiting = false, timer = null, forfeit, mode = "place", onMode, meter = 0, canMode = false, ot = false, bag = null,
}) {
  const P = usePx();
  const d = useBubble();
  return (
    <div className="shrink-0 flex flex-col items-center justify-between" style={{ width: d * P, height }}>
      <div className="flex flex-col items-center" style={{ gap: 2 * P }}>
        <Bubble w={d} h={d} label="Turn" onClick={onRotate} disabled={!canRotate}><RotateCw /></Bubble>
        <Bubble w={d} h={d + 8} label="LOCK IN" tint={canCommit || waiting ? ink : UI.dim} fill={canCommit ? 40 : 10}
          onClick={onCommit} disabled={!canCommit} className={waiting ? "tb-pulse" : undefined}
          style={{ color: canCommit ? UI.text : undefined }}>
          <Check />
        </Bubble>
        <ModeButtons d={d} mode={mode} onMode={onMode} meter={meter} enabled={canMode} />
        <Bubble w={d} h={d} label="Pass" tint={UI.dim} onClick={onDiscard} disabled={!canDiscard}><SkipForward /></Bubble>
      </div>
      <div className="flex flex-col items-center" style={{ gap: 2 * P }}>
        {ot && <span className="tb-t tb-b" style={{ color: GOLD }}>OT</span>}
        <NumBox value={bag ? `${turn}/${bag}` : turn} color={ot ? GOLD : LAVENDER} label={ot ? `Overtime, turn ${turn}` : `Turn ${turn}`} />
        {timer}
      </div>
      <ForfeitButton {...forfeit} />
    </div>
  );
}

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
 * One side's tag beside the forecast: name, rank and rating (when they have
 * one), and pins. Phones get just the rating and pins.
 */
function PlayerTag({ name, ink, meter, rating, right = false, compact = false, busy = false, onOpen = null }) {
  const P = usePx();
  const tr = rating ? Math.round(rating) : null;
  const rank = tr !== null ? RANKS[rankIndexFor(tr)] : null;
  // With a profile to show, the whole tag is a button.
  const Tag = onOpen ? "button" : "div";
  return (
    <Tag {...(onOpen ? { onClick: onOpen, "aria-label": `${name}: profile`, title: "View profile" } : null)}
      className={`flex flex-col min-w-0 flex-1 ${right ? "items-end text-right" : "items-start"} ${busy ? "tb-pulse" : ""}`}
      style={{ gap: P, ...(onOpen ? { background: "none", border: "none", padding: 0, color: "inherit" } : null) }}>
      {!compact && <div className="tb-t truncate max-w-full" style={{ color: ink }}>{name}</div>}
      {rank && (
        <div className={`flex items-center tb-t tabular-nums ${right ? "flex-row-reverse" : ""}`} style={{ gap: 2 * P, color: UI.dim }}>
          <span className="tb-b" style={{ color: rank.color }}>{rank.name}</span>{compact ? null : <span>{tr}</span>}
        </div>
      )}
      {RULES.actions && (
        <span className={`flex items-center tb-t tabular-nums ${right ? "flex-row-reverse" : ""}`} title={`${meter} pins`} style={{ gap: P, color: meter ? GOLD : UI.dim }}>
          <Pin />{meter}
        </span>
      )}
    </Tag>
  );
}

/** The top row: one shared forecast in the middle, each player's tag beside it. */
function TopBar({ width, pane, compact = false, ink, dir = 1, now, queue, card = null, left, right }) {
  const P = usePx();
  const soon = (queue || []).slice(0, QUEUE_SHOWN);
  return (
    <div className="shrink-0 flex items-center justify-between" style={{ width, gap: 3 * P }}>
      <PlayerTag {...left} compact={compact} />
      <div aria-label="Next pieces" className="flex items-end shrink-0" style={{ gap: P }}>
        {card || <PiecePane id={now} size={pane} ink={ink} dir={dir} />}
        {soon.map((id, i) => <PiecePane key={i} id={id} size={pane} ink={ink} dir={dir} dim={1 - i * 0.12} />)}
      </div>
      <PlayerTag {...right} compact={compact} right />
    </div>
  );
}

/** The title block: the logo a third of the way down, the mode under it, faint. */
function GameTitle({ mode }) {
  const P = usePx();
  return (
    <div className="flex flex-col items-center shrink-0" style={{ gap: 2 * P }}>
      <PixelLogo small />
      <div className="tb-t" style={{ color: UI.text, opacity: 0.35, letterSpacing: 2 * P }}>({mode}) <span style={{ letterSpacing: 0, opacity: 0.8 }}>{VERSION_LABEL}</span></div>
    </div>
  );
}

/** A thin line of light under the board. */
function BoardLine({ width }) {
  const P = usePx();
  return (
    <div aria-hidden="true" style={{
      width, height: P, flexShrink: 0,
      background: "linear-gradient(90deg, transparent, rgba(255,255,255,.75) 18%, rgba(255,255,255,.9) 50%, rgba(255,255,255,.75) 82%, transparent)",
      boxShadow: `0 0 ${3 * P}px rgba(255,255,255,.35)`,
    }} />
  );
}

/** Your current piece, as the pane you pick it up from. */
function NowCard({ id, ink, dir, selected, dragging, onPress, disabled, spent, pane }) {
  return (
    <PiecePane id={id} size={pane} ink={ink} dir={dir} lit={selected}
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

/* ---------- Numbers in the HUD: bold pixel type, no frame ---------- */

/** The turn number's colour. */
const LAVENDER = "#B4A3EE";

/** Height of a HUD number's line, in UI pixels. */
const NUMBOX_H = 10;

/** A HUD number (bag, turn, square counts): bold pixel digits, nothing around them. */
function NumBox({ value, color = UI.text, label, minW = 0 }) {
  const P = usePx();
  return (
    <span role="img" aria-label={label} title={label}
      className="tb-t tb-b tabular-nums shrink-0 text-center"
      style={{ color, minWidth: minW * P, textShadow: `${P}px ${P}px 0 rgba(0,0,0,.45)` }}>
      {value}
    </span>
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

/**
 * True when a menu panel has room to spread sideways (a computer screen):
 * then Theme, Settings and How to play lay out in columns instead of a long
 * scroll. Only on the menu; a popup over a game stays narrow.
 */
function useWideScreen() {
  const get = () => typeof window !== "undefined" && window.innerWidth >= 900 && window.innerHeight >= 560;
  const [w, setW] = useState(get);
  useEffect(() => {
    const on = () => setW(get());
    window.addEventListener("resize", on);
    return () => window.removeEventListener("resize", on);
  }, []);
  return w;
}
function useWidePanel() {
  const inline = !!useContext(InlineCtx);
  return useWideScreen() && inline;
}
/** Tighter rows (settings laid out in columns). */
const DenseCtx = createContext(false);

/** Width of the desktop meter column (room for a three-digit count), in UI pixels. */
const METER_COL_W = 16;

/** Desktop: their square count on top, the meter, your count at the bottom. */
function MeterColumn({ a, b, inkA, inkB, height }) {
  const P = usePx();
  const gap = 2 * P;
  return (
    <div className="shrink-0 flex flex-col items-center" style={{ width: METER_COL_W * P, height, gap }}>
      <NumBox value={b} color={inkB} label={`Their squares: ${b}`} />
      <VMeter a={a} b={b} inkA={inkA} inkB={inkB} height={height - 2 * (NUMBOX_H * P + gap)} />
      <NumBox value={a} color={inkA} label={`Your squares: ${a}`} />
    </div>
  );
}

/** Phone: the meter lies on its side under the forecast — yours fills from the left. */
function HMeter({ a, b, inkA, inkB, width }) {
  const P = usePx();
  const boxW = 16 * P, gap = 2 * P;
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
      <NumBox value={a} color={inkA} minW={16} label={`Your squares: ${a}`} />
      <div aria-label={`Score ${a} to ${b}`} className="relative flex-1"
        style={{ height: 8 * P, ...sk(UI.dim), background: "color-mix(in srgb, var(--tb-ground) 50%, black)", boxSizing: "border-box" }}>
        <div className="absolute" style={{ top: P, bottom: P, left: P, width: wA, ...bar(inkA) }} />
        <div className="absolute" style={{ top: P, bottom: P, right: P, width: wB, ...bar(inkB) }} />
      </div>
      <NumBox value={b} color={inkB} minW={16} label={`Their squares: ${b}`} />
    </div>
  );
}

/** Phone: the buttons in one row under the board — turn, lock in (wide), pass · turn number · forfeit. */
function ActionRow({
  width, ink, onRotate, onCommit, onDiscard, canRotate, canCommit, canDiscard, turn, waiting = false, timer = null, forfeit,
  mode = "place", onMode, meter = 0, canMode = false, ot = false, bag = null,
}) {
  const P = usePx();
  const d = useBubble(true);
  return (
    <div className="flex items-center justify-between shrink-0" style={{ width }}>
      <div className="flex items-center" style={{ gap: P }}>
        <Bubble w={d} h={d} label="Turn" onClick={onRotate} disabled={!canRotate}><RotateCw /></Bubble>
        <Bubble w={d + 4} h={d} label="LOCK IN" tint={canCommit || waiting ? ink : UI.dim} fill={canCommit ? 40 : 10}
          onClick={onCommit} disabled={!canCommit} className={waiting ? "tb-pulse" : undefined}
          style={{ color: canCommit ? UI.text : undefined }}>
          <Check />
        </Bubble>
        <ModeButtons d={d} mode={mode} onMode={onMode} meter={meter} enabled={canMode} />
        <Bubble w={d} h={d} label="Pass" tint={UI.dim} onClick={onDiscard} disabled={!canDiscard}><SkipForward /></Bubble>
      </div>
      <div className="flex items-center" style={{ gap: P }}>
        {timer}
        <NumBox value={bag ? `${turn}/${bag}` : turn} color={ot ? GOLD : LAVENDER} label={ot ? `Overtime, turn ${turn}` : `Turn ${turn}`} />
        <ForfeitButton {...forfeit} compact />
      </div>
    </div>
  );
}

/** The title block above the game (logo, mode label, spacing), in pixels. */
const TITLE_H = 40;
/** Room for each player tag beside the forecast, in pixels. */
const TAG_W = 36, TAG_W_COMPACT = 20;

/** Space around the board, by layout. Everything is in whole UI pixels. */
function gameLayout(stage, theme, P, d, compact) {
  const g = (theme.gap ?? 1) * P;
  const side = 4 * P;
  const railW = d * P;
  const wRes = compact ? 0 : METER_COL_W * P + railW + 2 * side;
  // The forecast row counts as one more row of squares (its panes are a
  // square plus two pixels), plus its name line on desktop.
  // Reserved: the title block above, the gaps, the glow line under the board,
  // and on phones the meter and the button row.
  const fixedH = TITLE_H * P + 2 * P + 3 * P + 5 * P + (compact ? (NUMBOX_H + 3) * P + (d + 3) * P + 4 * P : 0);
  // Capped, so a big window gets a comfortable board rather than a huge one.
  const cellArt = Math.max(5, Math.min(15, Math.floor(Math.min(
    (stage.w - wRes - g * (COLS - 1)) / COLS,
    (stage.h - fixedH - g * (ROWS - 1)) / (ROWS + 1)
  ) / P)));
  const cell = cellArt * P;
  const boardW = cell * COLS + g * (COLS - 1);
  const boardH = cell * ROWS + g * (ROWS - 1);
  const groupW = compact ? boardW : boardW + METER_COL_W * P + railW + 2 * side;
  // Forecast panes: one size for all ten, a touch bigger than a board square,
  // as long as both rows and the bag number fit across the board's width.
  // One forecast (both players share the sequence) between the two player tags.
  const tagW = compact ? TAG_W_COMPACT : TAG_W;
  const fit = Math.floor((groupW / P - 2 * tagW - 4 * 2 - 4) / (QUEUE_SHOWN + 1));
  const pane = Math.max(6, Math.min(cellArt + 2, fit));
  return { g, side, railW, cell, boardW, boardH, groupW, pane };
}

/**
 * The menu backdrop: blocks spreading outward from the centre of an open
 * field. The field is larger than the screen (and slightly turned), so it
 * has no visible edge. Each new block touches what's already there and
 * prefers spots near the middle, so the shape grows like a game of Tesella
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

/**
 * On the main menu, popups aren't popups: the title stays, the buttons under
 * it sink away, and the popup's contents rise into their place, straight on
 * the menu's moving background, bobbing gently as if afloat. The menu
 * provides { leaving } (true while they're sinking back out).
 * Anywhere else (in a game, in replays) they float over the screen on glass.
 */
const InlineCtx = createContext(null);

/** Translucent white glass over whatever moves behind it, lit along the top. */
const GLASS_PANE = {
  ...sk("color-mix(in srgb, white 38%, transparent)"),
  background:
    "linear-gradient(180deg, rgba(255,255,255,.2), rgba(255,255,255,.1) 24%, rgba(255,255,255,.07)), " +
    "linear-gradient(color-mix(in srgb, var(--tb-ground) 34%, transparent), color-mix(in srgb, var(--tb-ground) 46%, transparent))",
  boxShadow: `inset 0 ${PX} 0 rgba(255,255,255,.5), inset ${PX} 0 0 rgba(255,255,255,.22), inset 0 calc(var(--p) * -1) 0 rgba(0,0,0,.3), inset calc(var(--p) * -1) 0 0 rgba(0,0,0,.16)`,
  // Frosted: whatever moves behind it softens into colour.
  backdropFilter: "blur(7px) saturate(1.15)", WebkitBackdropFilter: "blur(7px) saturate(1.15)",
};

/** The arrival: a light ripple runs down the glass and a few pixel bubbles drift up. Plays once. */
function Arrival({ ripple = true }) {
  const bubbles = useMemo(() => Array.from({ length: 11 }, (_, i) => ({
    left: 6 + ((i * 37) % 88), size: 1 + (i % 3), delay: (i * 83) % 520, dur: 900 + ((i * 131) % 700),
  })), []);
  return (
    <span aria-hidden="true" className="absolute inset-0 pointer-events-none overflow-hidden" style={{ zIndex: 2 }}>
      {ripple && <span className="tb-ripple absolute inset-x-0" />}
      {bubbles.map((b, i) => (
        <span key={i} className="tb-bubble absolute" style={{
          left: `${b.left}%`, bottom: 0, width: `calc(var(--p) * ${b.size})`, height: `calc(var(--p) * ${b.size})`,
          animationDelay: `${b.delay}ms`, animationDuration: `${b.dur}ms`,
        }} />
      ))}
    </span>
  );
}

/**
 * The menu's stand-in for a popup: from where the buttons were down to the
 * bottom of the screen, no box, just the contents. Each block rises in on its
 * own beat and drifts on the water (see .tb-flow).
 */
function InlineFrame({ title, aside, onClose, maxW = 430, pinned, children, label }) {
  const { leaving } = useContext(InlineCtx);
  return (
    <div className="absolute inset-x-0 bottom-0 z-40 flex justify-center" role="dialog" aria-label={label || title}
      style={{ top: "var(--menu-top, 0px)", padding: "0 clamp(16px, 5vw, 96px)", paddingBottom: "max(14px, env(safe-area-inset-bottom, 0px))" }}
      onPointerDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <PxContext.Provider value={BASE_P}>
        <div className="tb-scale tb-calm relative w-full flex flex-col" style={{ maxWidth: maxW, maxHeight: "100%", color: UI.text }}>
          {!leaving && <Arrival ripple={false} />}
          <div className={`tb-flow${leaving ? " out" : ""} tb-scroll flex-1 min-h-0 overflow-y-auto overflow-x-hidden`} style={{ padding: "0 3px 10px" }}>
            <div className="flex items-center justify-between gap-3 h-10 mb-1" style={RULE_BELOW}>
              <button onClick={onClose} className="flex items-center gap-1.5 tb-t py-2 -ml-1 pr-2" style={{ color: UI.text }} aria-label="Back to menu">
                <ChevronLeft size={15} style={{ color: UI.dim }} />{title}
              </button>
              {aside}
            </div>
            {pinned && <div className="pt-2">{pinned}</div>}
            {children}
          </div>
        </div>
      </PxContext.Provider>
    </div>
  );
}

function Popup({ title, onClose, children, pinned, maxW = 430, wideW }) {
  const inline = !!useContext(InlineCtx);
  const wide = useWidePanel();
  useEffect(() => {
    sfx.open();
    if (inline) return undefined;
    sky.paused++; music.duck(true);
    return () => { sky.paused--; music.duck(false); };
  }, [inline]);
  useEffect(() => {
    if (!inline) return undefined;
    const k = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [inline, onClose]);
  if (inline) return <InlineFrame title={title} onClose={onClose} maxW={wide && wideW ? wideW : maxW} pinned={pinned}>{children}</InlineFrame>;
  return (
    <div
      className="fixed tb-fade inset-0 z-40 flex items-center justify-center"
      style={{
        // Over a game: dimmed with a pixel dither (the sky behind is paused).
        background: "repeating-conic-gradient(rgba(0,0,0,.55) 0 25%, rgba(0,0,0,.25) 0 50%) 0 0 / calc(var(--p) * 2) calc(var(--p) * 2)",
        padding: "clamp(14px, 5vw, 56px) clamp(14px, 5vw, 56px)",
        paddingTop: "max(clamp(14px,5vw,56px), env(safe-area-inset-top,0px))",
        paddingBottom: "max(clamp(14px,5vw,56px), env(safe-area-inset-bottom,0px))",
      }}
      onPointerDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <PxContext.Provider value={BASE_P}>
      <div className="tb-dive tb-scale tb-calm relative w-full flex flex-col overflow-hidden"
        style={{ maxWidth: maxW, maxHeight: "100%", ...GLASS_PANE, color: UI.text }}>
        <Arrival />
        <div className="flex items-center justify-between px-4 h-11 shrink-0 mx-2" style={RULE_BELOW}>
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
   PROFILES — a player's record, from the same API as T-Terminal
   ============================================================ */
/**
 * Report and block, for another player. Block: their chat no longer reaches
 * you and you're never matched with them (kept on your account). Report: sent
 * to the moderators with the recent chat between you.
 */
const REPORT_REASONS = [["chat", "OFFENSIVE CHAT"], ["name", "OFFENSIVE NAME"], ["cheating", "CHEATING"], ["other", "SOMETHING ELSE"]];
function SafetyActions({ name }) {
  const P = usePx();
  const status = useStatus();
  const [blocked, setBlocked] = useState(() => net.isBlocked(name));
  const [reporting, setReporting] = useState(false);
  const [reason, setReason] = useState(null);
  const [note, setNote] = useState("");
  const [done, setDone] = useState(null);
  useEffect(() => net.on("blocked", (set) => setBlocked(set.has(name))), [name]);
  useEffect(() => net.on("reported", (who) => { if (who === name) { setReporting(false); setDone("Thanks. We'll review your report."); } }), [name]);
  const me = net.profile?.name;
  if (status !== "online" || !name || name === me) return null;
  const small = { height: 34, ...glass(UI.line) };
  return (
    <div className="flex flex-col" style={{ gap: 2 * P }}>
      <div className="flex" style={{ gap: 2 * P }}>
        <button onClick={() => net.block(name, !blocked)} className="flex-1 tb-t" aria-pressed={blocked}
          style={{ ...small, color: blocked ? GOLD : UI.dim }}>{blocked ? "UNBLOCK" : "BLOCK"}</button>
        <button onClick={() => { setReporting(!reporting); setDone(null); }} className="flex-1 tb-t" aria-expanded={reporting}
          style={{ ...small, color: reporting ? UI.text : UI.bad }}>REPORT</button>
      </div>
      {blocked && <div className="tb-t" style={{ color: UI.dim }}>Blocked: their chat is hidden and you won't be matched with them.</div>}
      {done && <div className="tb-t" style={{ color: UI.good }}>{done}</div>}
      {reporting && (
        <div className="flex flex-col" style={{ gap: 2 * P }}>
          <div className="tb-t" style={{ color: UI.dim }}>What's wrong?</div>
          <div className="grid grid-cols-2" style={{ gap: 2 * P }}>
            {REPORT_REASONS.map(([k, label]) => (
              <button key={k} onClick={() => setReason(k)} aria-pressed={reason === k} className="tb-t"
                style={{ height: 32, ...(reason === k ? skFill(UI.text) : glass(UI.line)), color: reason === k ? UI.text : UI.dim }}>{label}</button>
            ))}
          </div>
          <input value={note} onChange={(e) => setNote(e.target.value.slice(0, 300))} placeholder="Anything else? (optional)" aria-label="Report details"
            className="tb-t px-2" style={{ height: 34, ...glass(UI.line), color: UI.text, outline: "none" }} />
          <button disabled={!reason} onClick={() => net.report(name, reason, note)} className="tb-t disabled:opacity-35"
            style={{ height: 36, ...skFill(UI.bad), color: UI.text }}>SEND REPORT</button>
        </div>
      )}
    </div>
  );
}

function ProfilePopup({ name, guest = false, onClose }) {
  const P = usePx();
  // The popup can follow links to other players (their recent opponents).
  const [who, setWho] = useState(name);
  const [res, setRes] = useState({ who: null });
  const isGuest = guest && who === name;
  useEffect(() => {
    if (isGuest) return;
    let live = true;
    apiGet(`/api/player/${encodeURIComponent(who)}`)
      .then((data) => live && setRes({ who, data }))
      .catch((e) => live && setRes({ who, error: e.message }));
    return () => { live = false; };
  }, [who, isGuest]);
  const loading = !isGuest && res.who !== who;
  return (
    <Popup title="PLAYER" onClose={onClose} maxW={820}>
      <div className="pt-4 pb-1 flex flex-col" style={{ gap: 4 * P }}>
        {who !== name && (
          <button onClick={() => setWho(name)} className="tb-t text-left flex items-center gap-1" style={{ color: UI.dim }}>
            <ChevronLeft /> BACK TO {name.toUpperCase()}
          </button>
        )}
        {isGuest ? (
          <div className="tb-t" style={{ color: UI.dim }}>
            <span style={{ color: UI.text }}>{name}</span> is playing as a guest. Guests don't have a record.
          </div>
        ) : loading ? (
          <div className="tb-t tb-pulse" style={{ color: UI.dim }}>LOADING…</div>
        ) : res.error ? (
          <div className="tb-t" style={{ color: UI.dim }}>{res.error}</div>
        ) : (
          <>
            <ProfileCard p={res.data} href={`/terminal#/player/${encodeURIComponent(who)}`} />
            <PlayerRecord p={res.data} onOpen={setWho} />
          </>
        )}
        {!isGuest && (
          // A new tab: never pull someone out of a match.
          <a href={`/terminal#/player/${encodeURIComponent(who)}`} target="_blank" rel="noopener"
            className="tb-t flex items-center justify-center gap-2 no-underline" style={{ height: 40, ...skFill(ACCENTS.terminal), color: UI.text }}>
            <span style={{ color: ACCENTS.terminal, display: "flex" }}><TerminalIcon /></span> OPEN IN T-TERMINAL
          </a>
        )}
        <SafetyActions name={who} />
      </div>
    </Popup>
  );
}

/* ============================================================
   CHAT — online matches only; relayed by the server, never stored
   ============================================================ */
const CHAT_MAX = 120;
function ChatDock({ m, colors }) {
  const P = usePx();
  const [open, setOpen] = useState(false);
  const [safety, setSafety] = useState(false);
  const [draft, setDraft] = useState("");
  const [muted, setMuted] = useState(() => store.get("tb:chatMuted") === "1");
  const [seen, setSeen] = useState(0);
  const listRef = useRef(null);
  const chat = m.chat || [];
  const theirs = chat.filter((l) => l.side !== m.you);
  const shown = muted ? chat.filter((l) => l.side === m.you) : chat;
  const unread = open || muted ? 0 : Math.max(0, theirs.length - seen);
  const latest = theirs[theirs.length - 1];
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  // A new line from them pops up for a few seconds while the panel's shut.
  const toast = !open && !muted && latest && now - latest.got < 5000 ? latest : null;

  const lastCount = useRef(theirs.length);
  useEffect(() => {
    if (theirs.length > lastCount.current && !muted) sfx.chat();
    lastCount.current = theirs.length;
  }, [theirs.length, muted]);
  useEffect(() => { if (open && listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight; }, [open, shown.length]);

  const toggle = () => { setSeen(theirs.length); setOpen(!open); };
  const send = () => { const t = draft.trim(); if (!t) return; net.chat(t); setDraft(""); };
  const setMute = (v) => { setMuted(v); store.set("tb:chatMuted", v ? "1" : ""); };
  const inkOf = (side) => (side === m.you ? colors.you : colors.rival);

  return (
    <div className="fixed z-30 flex flex-col items-end" style={{ top: "calc(env(safe-area-inset-top, 0px) + 10px)", right: "calc(env(safe-area-inset-right, 0px) + 10px)", gap: 2 * P }}>
      <button onClick={toggle} aria-label={open ? "Close chat" : `Chat${unread ? ` (${unread} new)` : ""}`} aria-expanded={open}
        className="relative flex items-center justify-center" style={{ width: 13 * P, height: 13 * P, ...glass(open ? UI.text : UI.line), color: unread ? UI.text : UI.dim }}>
        <Chat />
        {unread > 0 && (
          <span className="absolute tb-t tb-b tabular-nums" style={{ right: -P, top: -2 * P, color: GOLD, textShadow: `${P}px ${P}px 0 rgba(0,0,0,.6)` }}>{unread}</span>
        )}
      </button>
      {toast && (
        <button onClick={toggle} className="tb-t text-left tb-fade" style={{ maxWidth: "min(300px, 80vw)", padding: `${2 * P}px ${3 * P}px`, ...glass(colors.rival), color: UI.text }}>
          <span style={{ color: colors.rival }}>{toast.name}: </span>{toast.text}
        </button>
      )}
      {open && (
        <div className="tb-fade flex flex-col" style={{ width: "min(360px, calc(100vw - 20px))", height: "min(60vh, 440px)", padding: 3 * P, gap: 2 * P,
          background: "color-mix(in srgb, var(--tb-panel-solid) 88%, transparent)", ...sk(UI.line) }}>
          <div className="flex items-center justify-between" style={{ gap: 2 * P }}>
            <span className="tb-t" style={{ color: UI.text }}>CHAT</span>
            <button onClick={() => setMute(!muted)} className="tb-t" aria-pressed={muted} title="Hide your opponent's messages" style={{ color: muted ? GOLD : UI.dim }}>
              {muted ? "MUTED" : "MUTE"}
            </button>
          </div>
          {/* The rules, always in view, with a way to act on them. */}
          <div className="flex items-center justify-between" style={{ gap: 2 * P }}>
            <span className="tb-t" style={{ color: UI.dim, opacity: 0.8 }}>Be respectful to everyone.</span>
            {m.opponent?.name && (
              <button onClick={() => setSafety(!safety)} className="tb-t shrink-0" aria-expanded={safety} style={{ color: safety ? UI.text : UI.bad }}>
                REPORT / BLOCK
              </button>
            )}
          </div>
          {safety && m.opponent?.name && <SafetyActions name={m.opponent.name} />}
          <div ref={listRef} className="tb-scroll flex-1 min-h-0 overflow-y-auto flex flex-col" style={{ gap: P }}>
            {!shown.length && <div className="tb-t" style={{ color: UI.dim, opacity: 0.6 }}>{muted ? "Their messages are hidden." : "No messages yet. Say good luck!"}</div>}
            {shown.map((l, i) => (
              <div key={i} className="tb-t" style={{ wordBreak: "break-word" }}>
                <span style={{ color: inkOf(l.side) }}>{l.side === m.you ? "YOU" : l.name}: </span>
                <span style={{ color: UI.text }}>{l.text}</span>
              </div>
            ))}
          </div>
          {m.chatError && <div className="tb-t" style={{ color: GOLD }}>{m.chatError}</div>}
          <form className="flex" style={{ gap: 2 * P }} onSubmit={(e) => { e.preventDefault(); send(); }}>
            <input value={draft} onChange={(e) => setDraft(e.target.value.slice(0, CHAT_MAX))} maxLength={CHAT_MAX} autoFocus
              onKeyDown={(e) => { if (e.key === "Escape") toggle(); }}
              placeholder="gl hf…" aria-label="Chat message" className="tb-t flex-1 min-w-0 px-2"
              style={{ height: 15 * P, ...glass(UI.line), color: UI.text, outline: "none" }} />
            <button type="submit" disabled={!draft.trim()} className="tb-t px-2 disabled:opacity-40" style={{ height: 15 * P, ...skFill(UI.text), color: UI.text }}>SEND</button>
          </form>
        </div>
      )}
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

  const wide = useWidePanel();
  const handle = (
    <>
      <div className="tb-t mb-2">HANDLE</div>
      <input value={draft} maxLength={16}
        onChange={(e) => { setDraft(e.target.value); setNameErr(null); }} onBlur={() => rename(draft)}
        onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
        className={`w-full rounded px-3 ${nameErr ? "mb-2" : wide ? "mb-4" : "mb-7"} tb-t font-mono`}
        style={{ height: wide ? 38 : 44, background: UI.ground, ...sk(nameErr ? UI.badSoft : UI.line), color: UI.text, outline: "none" }} />
      {nameErr && <div className="tb-t mb-4" style={{ color: UI.bad }}>{nameErr}</div>}
    </>
  );
  const sound = (
    <>
      <div className="tb-t mb-1" style={{ color: UI.dim }}>SOUND</div>
      <Row label="VOLUME">
        <PixelSlider min={0} max={10} value={theme.sound ?? 7} onChange={(v) => set({ sound: v })} ink={UI.text} label="Volume" style={{ width: wide ? 130 : 150 }} />
        <span className="tb-t tabular-nums text-right" style={{ width: 30, color: theme.sound ? UI.text : UI.dim }}>{theme.sound ? theme.sound : "OFF"}</span>
      </Row>
      <Row label="MUSIC">
        <PixelSlider min={0} max={10} value={theme.music ?? 5} onChange={(v) => set({ music: v })} ink={UI.text} label="Music" style={{ width: wide ? 130 : 150 }} />
        <span className="tb-t tabular-nums text-right" style={{ width: 30, color: theme.music ? UI.text : UI.dim }}>{theme.music ? theme.music : "OFF"}</span>
      </Row>
    </>
  );
  const access = (
    <>
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
      <div className={`tb-t mt-2 ${wide ? "mb-4" : "mb-7"}`} style={{ color: UI.dim }}>
        Marks put O on your squares
        and X on your opponent's, so the board reads without colour.
      </div>
    </>
  );
  // Which server you're on: accounts live on one server, so two devices on
  // different ones (an old address, a stale link) see different accounts.
  const serverLine = status === "online" && (
    <div className="tb-t mb-2" style={{ color: net.serverHost === "cloudflare" ? UI.dim : GOLD }}>
      {net.serverHost === "cloudflare" ? "SERVER: CLOUDFLARE" : net.serverHost === "node" ? "SERVER: NODE (RENDER / LOCAL)" : "SERVER: OLD VERSION"}
      {" · "}{typeof location !== "undefined" ? location.host : ""}
    </div>
  );
  const connection = wide ? (
    // Columns: just the essentials, on one line.
    <>
      <div className="tb-t mb-2" style={{ color: UI.dim }}>CONNECTION</div>
      <div className="flex items-center flex-wrap gap-x-3 gap-y-1 tb-t mb-2">
        <span className="flex items-center gap-1.5" style={{ color: status === "online" ? UI.good : UI.dim }}>
          {status === "online" ? <Wifi size={12} /> : <WifiOff size={12} />}{status.toUpperCase()}
        </span>
        <span className="flex items-center gap-1.5" style={{ color: IS_SECURE ? UI.good : GOLD }} title={SERVER_URL}>
          {IS_SECURE ? <Lock size={12} /> : <ShieldAlert size={12} />}{IS_SECURE ? "ENCRYPTED" : "NOT ENCRYPTED"}
        </span>
        {status === "online" && (
          <span style={{ color: net.serverHost === "cloudflare" ? UI.dim : GOLD }} title={typeof location !== "undefined" ? location.host : ""}>
            {net.serverHost === "cloudflare" ? "CLOUDFLARE" : net.serverHost === "node" ? "NODE SERVER" : "OLD SERVER"}
          </span>
        )}
      </div>
      <LegalLinks />
    </>
  ) : (
    <>
      <div className="tb-t mb-2" style={{ color: UI.dim }}>CONNECTION</div>
      <div className="flex items-center gap-2 tb-t mb-1" style={{ color: status === "online" ? UI.good : UI.dim }}>
        {status === "online" ? <Wifi size={12} /> : <WifiOff size={12} />}
        SERVER {status.toUpperCase()}
      </div>
      {serverLine}
      <div className="flex items-center gap-2 tb-t mb-1.5" style={{ color: IS_SECURE ? UI.good : GOLD }}>
        {IS_SECURE ? <Lock size={12} /> : <ShieldAlert size={12} />}
        {IS_SECURE ? "ENCRYPTED (TLS)" : "NOT ENCRYPTED"}
      </div>
      <div className="tb-t pb-2 break-all" style={{ color: UI.dim }}>
        {SERVER_URL}
        {!IS_SECURE && " — fine on your own machine, unsafe over a real network."}
      </div>
      <div className="pt-3 pb-2"><LegalLinks /></div>
    </>
  );

  return (
    <Popup title="SETTINGS" onClose={onClose} wideW={HAS_KEYBOARD ? 1120 : 720}>
      {wide ? (
        // A computer: everything at once, in columns.
        <DenseCtx.Provider value={true}>
        <div className="tb-cols grid gap-7 pt-3" style={{ gridTemplateColumns: HAS_KEYBOARD ? "1fr 1.45fr 1fr" : "1fr 1fr" }}>
          <div className="min-w-0">{handle}{sound}<div className="mt-4"><SprintControlsSection /></div><div className="mt-4"><ZgControlsSection /></div></div>
          {HAS_KEYBOARD && <div className="min-w-0"><ControlsSection /></div>}
          <div className="min-w-0">{access}{connection}</div>
        </div>
        </DenseCtx.Provider>
      ) : (
        <div className="pt-4">
          {handle}
          {sound}
          <div className="mb-7" />
          {HAS_KEYBOARD && <ControlsSection />}
          {HAS_KEYBOARD && <div className="mb-7"><SprintControlsSection /></div>}
          {HAS_KEYBOARD && <div className="mb-7"><ZgControlsSection /></div>}
          {access}
          {connection}
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
    <div className="rounded px-3 py-2.5 min-w-0 break-words" style={{ ...glass(UI.line) }}>
      <div className="tb-t mb-1.5" style={{ color: UI.dim }}>{label}</div>
      <div className="tb-t" style={{ color: color || UI.text }}>{value}</div>
      {sub && <div className="tb-t mt-1.5" style={{ color: UI.dim }}>{sub}</div>}
    </div>
  );
}

/**
 * Your card, and how it looks: a sky, an accent and a pattern, each picked
 * from a fixed set (like the theme's colours). Changes show at once and are
 * saved to your account.
 */
function CardEditor({ profile }) {
  const [sel, setSel] = useState(() => cleanCard(profile.card));
  const [api, setApi] = useState(null);
  useEffect(() => {
    let live = true;
    apiGet(`/api/player/${encodeURIComponent(profile.name)}`).then((d) => live && setApi(d)).catch(() => {});
    return () => { live = false; };
  }, [profile.name]);
  const edit = (next) => { const c = cleanCard(next); setSel(c); net.setCard(c); sfx.pick(); };
  const p = { ...(api || cardFromProfile(profile)), card: sel };
  return (
    <div className="mt-2">
      <ProfileCard p={p} href={`/terminal#/player/${encodeURIComponent(profile.name)}`} onEdit={edit} />
    </div>
  );
}

function StatsModal({ profile, status, onClose, onLogout, onDelete }) {
  const wide = useWidePanel();
  // No profile has two very different causes. Saying "offline" for both sent
  // people hunting a server problem when they simply weren't signed in.
  // (Guests have a name but no ranked stats.)
  if (!profile || !profile.stats) {
    const connected = status === "online";
    return (
      <Popup title="RANKED STATS" onClose={onClose}>
        <div className="rounded p-6 mt-6 text-center" style={{ ...glass(UI.line) }}>
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
  const mar = profile.marathon;

  const who = <CardEditor profile={profile} />;

  const rankCard = (
    <div className="mt-3 rounded p-4" style={{ ...glass(UI.line) }}>
      <div className="flex items-center gap-4">
        <RankIcon rank={placed ? rank : null} size={74} />
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
  );
  const ladder = (
    <div className="mt-4">
      <div className="tb-t mb-2" style={{ color: UI.dim }}>LADDER</div>
      <div className="flex gap-[3px]">
        {RANKS.map((r, i) => {
          const here = placed && i === ri;
          const past = placed && i < ri;
          return (
            <div key={r.name} className="flex-1 flex flex-col items-center gap-1.5">
              <div style={{ opacity: here ? 1 : past ? 0.75 : 0.35, filter: here ? "none" : "saturate(.6)" }}>
                <RankIcon rank={r} size={here ? 30 : 20} />
              </div>
              <span className="tb-t" style={{ color: here ? r.color : UI.dim, opacity: here ? 1 : 0.5 }}>{r.name}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
  const trend = st.history.length > 1 && (
    <div className={`${wide ? "" : "mt-5 "}rounded p-3`} style={{ ...glass(UI.line) }}>
      <div className="flex items-center justify-between mb-1">
        <span className="tb-t" style={{ color: UI.dim }}>TR · LAST {st.history.length}</span>
        <span className="tb-t" style={{ color: UI.dim }}>{Math.min(...st.history)} – {Math.max(...st.history)}</span>
      </div>
      <Sparkline values={st.history} color={rank.color} height={wide ? 44 : 58} />
    </div>
  );
  const cells = (
    <div className={`grid ${wide ? "grid-cols-3" : "grid-cols-2"} gap-2 ${wide ? (trend ? "mt-3" : "") : "mt-4"}`}>
      <StatCell label="RECORD" value={`${st.wins}–${st.losses}`} sub={`${st.games} ${st.games === 1 ? "match" : "matches"}`} />
      <StatCell label="WIN RATE" value={`${winRate}%`} sub={st.games ? `${st.wins} ${st.wins === 1 ? "win" : "wins"}` : "no data"} color={winRate >= 50 ? UI.good : UI.text} />
      <StatCell label="PEAK" value={st.peakRank !== null ? RANKS[st.peakRank].name : "–"} sub={st.peakRank !== null ? `${st.peakTr} TR` : "none"} color={st.peakRank !== null ? RANKS[st.peakRank].color : UI.dim} />
      <StatCell label="PLAYTIME" value={fmtTime(st.seconds)} sub={st.games ? `~${Math.round(st.seconds / st.games / 60)}m ${wide ? "each" : "per match"}` : "no data"} />
      <StatCell label="STREAK" value={st.streak > 0 ? `W${st.streak}` : st.streak < 0 ? `L${-st.streak}` : "–"} sub={`best W${st.bestStreak}`} color={st.streak > 0 ? UI.good : st.streak < 0 ? UI.bad : UI.text} />
      <StatCell label="AVG TURF" value={st.squares ? st.squares.toFixed(1) : "–"} sub={st.special ? `${st.special.toFixed(1)} special` : "no data"} />
    </div>
  );
  const marathon = (
    // Marathon: your best, also on T-Terminal.
    <div className={wide ? "mt-4" : "mt-5"}>
      <div className="tb-t mb-2" style={{ color: UI.dim }}>MARATHON</div>
      <div className="grid grid-cols-3 gap-2">
        <StatCell label="BEST" value={mar?.best ? mar.best.toLocaleString("en-US") : "–"} sub={mar?.at ? new Date(mar.at).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "no score yet"} color={GOLD} />
        <StatCell label="LINES" value={mar?.lines ?? "–"} sub={wide ? "in best" : "in your best"} />
        <StatCell label="GAMES" value={mar?.games ?? 0} sub={profile.marathonOpen ? (wide ? "run saved" : `run saved · ${profile.marathonOpen.score}`) : "finished"} />
      </div>
    </div>
  );
  // On a computer the list has a column to itself, so it shows as many as fit without scrolling.
  const shown = wide ? st.recent.slice(0, 6) : st.recent;
  const recent = (
    <div className={wide ? "" : "mt-5 mb-2"}>
      <div className="tb-t mb-2" style={{ color: UI.dim }}>RECENT MATCHES</div>
      {st.recent.length === 0 ? (
        <div className="rounded p-4 text-center tb-t" style={{ ...glass(UI.line), color: UI.dim }}>
          No ranked matches yet.
        </div>
      ) : (
        <div className="space-y-1">
          {shown.map((m, i) => (
            <div key={i} className={`flex items-center gap-2.5 rounded px-3 ${wide ? "py-1.5" : "py-2"}`} style={{ ...glass(UI.line) }}>
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
          {shown.length < st.recent.length && (
            <a href={`/terminal#/player/${encodeURIComponent(profile.name)}`} className="block tb-t pt-1" style={{ color: ACCENTS.terminal }}>
              ALL MATCHES ON T-TERMINAL ›
            </a>
          )}
        </div>
      )}
    </div>
  );
  const note = (
    <div className="tb-t pt-3 pb-2" style={{ color: UI.dim, ...RULE_ABOVE }}>
      Rating is Glicko-2 and computed on the server. TR is your rating;
      ± is how sure the system is about it, and it narrows as you play.
    </div>
  );
  const signOut = onLogout && (
    <>
      <button onClick={onLogout} className="w-full rounded tb-t flex items-center justify-center gap-2 mt-2 mb-1"
        style={{ height: wide ? 38 : 44, ...sk(UI.line), color: UI.dim }}>
        <LogOut size={13} /> SIGN OUT
      </button>
      {onDelete && <button onClick={onDelete} className="w-full tb-t py-2" style={{ color: UI.bad, opacity: 0.75 }}>DELETE ACCOUNT</button>}
    </>
  );

  return (
    <Popup title="ACCOUNT" onClose={onClose} wideW={980}>
      {wide && who}
      {wide ? (
        // A computer: your card across the top; then your rank, how you play, who you played.
        <div className="tb-cols grid gap-6 pt-3 items-start" style={{ gridTemplateColumns: "1fr 1.4fr 1fr" }}>
          <div className="min-w-0">{rankCard}{ladder}<div className="mt-5">{signOut}</div></div>
          <div className="min-w-0">{trend}{cells}{marathon}</div>
          <div className="min-w-0">{recent}<div className="mt-4">{note}</div></div>
        </div>
      ) : (
        <>
          {who}{rankCard}{ladder}{trend}{cells}{marathon}{recent}{note}{signOut}
        </>
      )}
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
  const dense = useContext(DenseCtx);
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
    <div className={dense ? "mb-2" : "mb-7"}>
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
            <div key={a.id} className={`flex items-center justify-between gap-2 ${dense ? "py-1" : "py-1.5"}`} style={RULE_BELOW}>
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
  const dense = useContext(DenseCtx);
  return (
    <div className={`flex items-center justify-between gap-3 ${dense ? "py-1.5" : "py-2.5"}`} style={{ ...RULE_BELOW }}>
      <span className="tb-t shrink-0" style={{ color: UI.dim }}>{label}</span>
      <div className="flex items-center gap-1.5 flex-wrap justify-end">{children}</div>
    </div>
  );
}

/**
 * A slider drawn in pixels: a glass tube that fills with your colour, a glass
 * bubble for the handle, a pixel notch under every step (when there are few).
 * Snaps by whole pixels; drag, tap, or use the arrow keys.
 */
const THUMB_W = 7, THUMB_H = 11, TUBE_H = 5;
function PixelSlider({ min = 0, max, step = 1, value, onChange, ink = UI.text, label, className = "", style }) {
  const P = usePx();
  const node = useRef(null);
  const [sizeRef, size] = useSize();
  const [drag, setDrag] = useState(false);
  const [focus, setFocus] = useState(false);
  const range = Math.max(step, max - min);
  const steps = Math.round(range / step);
  const cols = Math.max(THUMB_W + 2, Math.floor(size.w / P));
  const travel = cols - THUMB_W;
  const frac = Math.max(0, Math.min(1, (value - min) / range));
  const tx = Math.round(frac * travel);
  const mid = tx + Math.floor(THUMB_W / 2);
  const ticks = steps <= 20;
  const H = THUMB_H + (ticks ? 3 : 0);
  const ty = Math.floor((THUMB_H - TUBE_H) / 2);

  const set = (v) => {
    const nv = Math.max(min, Math.min(max, min + Math.round((v - min) / step) * step));
    if (nv === value) return;
    sfx.slider((nv - min) / range);
    onChange(nv);
  };
  const fromX = (clientX) => {
    const el = node.current;
    if (!el || !size.w) return;
    const r = el.getBoundingClientRect();
    const zoom = r.width / (cols * P || 1);           // menus are zoomed: measure in screen px
    const th = THUMB_W * P * zoom;
    const f = (clientX - r.left - th / 2) / Math.max(1, r.width - th);
    set(min + Math.max(0, Math.min(1, f)) * range);
  };
  const onKey = (e) => {
    const big = Math.max(step, Math.round(range / 10 / step) * step);
    const d = { ArrowLeft: -step, ArrowDown: -step, ArrowRight: step, ArrowUp: step, PageDown: -big, PageUp: big }[e.key];
    if (d) { e.preventDefault(); set(value + d); }
    else if (e.key === "Home") { e.preventDefault(); set(min); }
    else if (e.key === "End") { e.preventDefault(); set(max); }
  };

  // Rows of the tube: the corners cut one pixel, like every other pane.
  const tube = [[0, 1, cols - 1], [1, 0, cols], [2, 0, cols], [3, 0, cols], [4, 1, cols - 1]];
  const inkMix = (pct) => `color-mix(in srgb, ${ink} ${pct}%, transparent)`;
  return (
    <div ref={(n) => { node.current = n; sizeRef(n); }}
      role="slider" tabIndex={0} aria-label={label} aria-valuemin={min} aria-valuemax={max} aria-valuenow={value}
      className={`relative select-none ${className}`}
      style={{ height: H * P, touchAction: "none", cursor: drag ? "grabbing" : "pointer", outline: "none", ...style }}
      onKeyDown={onKey} onFocus={() => setFocus(true)} onBlur={() => setFocus(false)}
      onPointerDown={(e) => { e.currentTarget.setPointerCapture?.(e.pointerId); setDrag(true); fromX(e.clientX); }}
      onPointerMove={(e) => { if (drag) fromX(e.clientX); }}
      onPointerUp={() => setDrag(false)} onPointerCancel={() => setDrag(false)}>
      {size.w > 0 && (
        <svg aria-hidden="true" width={cols * P} height={H * P} viewBox={`0 0 ${cols} ${H}`} shapeRendering="crispEdges"
          style={{ position: "absolute", left: 0, top: 0, pointerEvents: "none" }}>
          {/* The glass tube. */}
          {tube.map(([y, a, b]) => <rect key={`t${y}`} x={a} y={ty + y} width={b - a} height={1} style={{ fill: "color-mix(in srgb, var(--tb-text) 9%, transparent)" }} />)}
          <rect x={1} y={ty} width={cols - 2} height={1} style={{ fill: "color-mix(in srgb, var(--tb-text) 26%, transparent)" }} />
          <rect x={1} y={ty + TUBE_H - 1} width={cols - 2} height={1} fill="rgba(0,0,0,.3)" />
          {/* Filled up to the handle, with bubbles drifting in it. */}
          <rect x={1} y={ty + 1} width={Math.max(0, mid - 1)} height={TUBE_H - 2} style={{ fill: inkMix(55) }} />
          <rect x={1} y={ty + 1} width={Math.max(0, mid - 1)} height={1} style={{ fill: `color-mix(in srgb, ${ink} 70%, white)` }} />
          {Array.from({ length: Math.max(0, Math.floor((mid - 3) / 5)) }, (_, i) => (
            <rect key={`b${i}`} x={3 + i * 5} y={ty + 2 + (i % 2)} width={1} height={1} fill="rgba(255,255,255,.45)" />
          ))}
          {/* A notch under every step. */}
          {ticks && Array.from({ length: steps + 1 }, (_, i) => {
            const x = Math.round((i / steps) * travel) + Math.floor(THUMB_W / 2);
            return <rect key={`k${i}`} x={x} y={THUMB_H + 1} width={1} height={i === 0 || i === steps ? 2 : 1}
              style={{ fill: x <= mid ? inkMix(80) : "color-mix(in srgb, var(--tb-text) 30%, transparent)" }} />;
          })}
        </svg>
      )}
      {size.w > 0 && (
        <div className="absolute pointer-events-none" style={{ left: tx * P, top: drag ? -P : 0, width: THUMB_W * P, height: THUMB_H * P }}>
          <BubbleShape w={THUMB_W} h={THUMB_H} tint={focus || drag ? UI.text : ink} fill={drag ? 60 : 42} />
        </div>
      )}
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

  const wide = useWidePanel();
  const preview = (
    <BoardGrid
      board={previewBoard} cell={wide ? 21 : 12}
      ink={{ A: theme.you, B: theme.rival, S: theme.special }}
      theme={theme} youSide="A"
      ghostKeys={new Set()} ghostLegal={false} ghostInk={theme.you}
      contestedKeys={new Set()} boardRef={null} onPointerDown={undefined}
    />
  );
  const footnote = (
    <div className={`tb-t ${wide ? "pt-3 mt-1" : "pt-4 mt-2"}`} style={{ color: UI.dim, ...RULE_ABOVE }}>
      Themes are stored on this device only. Your opponent sees their own.
    </div>
  );
  const controls = (
    <>
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
        <div className={`grid ${wide ? "grid-cols-3" : "grid-cols-2"} gap-2 pb-2`}>
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
            <div className={`rounded p-2.5 ${wide ? "col-span-3" : "col-span-2"} tb-t`}
              style={{ ...sk(UI.line), color: UI.dim }}>
              CUSTOM: edited from a preset
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
          <div className={`tb-t ${wide ? "mt-3 mb-1" : "mt-4 mb-2"}`} style={{ color: UI.dim }}>SURFACES</div>
          <div className={wide ? "grid grid-cols-3 gap-x-5" : undefined}>
            {[["BACKGROUND", "ground"], ["PANELS", "panel"], ["EMPTY CELL", "cell"], ["LINES", "line"], ["TEXT", "text"]].map(([label, k]) => (
              <Row key={k} label={label}>
                <input type="color" value={theme[k]} onChange={(e) => set({ [k]: e.target.value })}
                  style={{ width: 44, height: 26, background: "transparent", ...sk(UI.line), borderRadius: 5, padding: 0 }} />
                {!wide && <span className="tb-t tabular-nums" style={{ color: UI.dim }}>{theme[k]}</span>}
              </Row>
            ))}
          </div>
        </div>
      )}

      {tab === "blocks" && (
        <div className="pb-2">
          <div className="tb-t mb-2" style={{ color: UI.dim }}>STROKE</div>
          <div className={`grid grid-cols-3 gap-2 ${wide ? "mb-3" : "mb-5"}`}>
            {Object.entries(STROKES).map(([k, st]) => {
              const on = theme.stroke === k;
              return (
                <button key={k} onClick={() => set({ stroke: k })}
                  className={`flex flex-col items-center justify-center gap-2 ${wide ? "py-2" : "py-3"}`}
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
            Marks put O on your squares, X on your opponent's and a diamond on contested ones,
            so the board reads without relying on colour.
          </div>
        </div>
      )}

    </>
  );

  return (
    <Popup title="THEME" onClose={onClose} maxW={420} wideW={900}>
      {wide ? (
        // A computer: the board on the left, everything you change on the right.
        <div className="tb-cols grid gap-8 pt-3 items-start" style={{ gridTemplateColumns: "auto 1fr" }}>
          <div className="flex flex-col items-center" style={{ width: 250 }}>{preview}</div>
          <DenseCtx.Provider value={true}><div className="min-w-0">{controls}{footnote}</div></DenseCtx.Provider>
        </div>
      ) : (
        <>
          <div className="mt-3 mb-4 flex justify-center">{preview}</div>
          {controls}
          {footnote}
        </>
      )}
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
function AccountModal({ profile, onLogout, onClose, onDelete }) {
  if (profile && profile.guest) {
    return (
      <Popup title="ACCOUNT" onClose={onClose} maxW={380}>
        <div className="pt-6 pb-2 text-center tb-t">
          <div className="mb-2">Playing as <span style={{ color: "var(--tb-you)" }}>{profile.name}</span> (guest)</div>
          <div className="mb-5" style={{ color: UI.dim }}>Guests can play private and unranked games. Make an account to play ranked.</div>
          <button onClick={onLogout} className="tb-t px-5" style={{ height: 44, ...glass(UI.line), color: UI.dim }}>STOP BEING A GUEST</button>
        </div>
      </Popup>
    );
  }
  if (!profile) {
    return (
      <Popup title="ACCOUNT" onClose={onClose} maxW={380}>
        <div className="py-10 text-center tb-t" style={{ color: UI.dim }}>Signed out.</div>
      </Popup>
    );
  }
  // Signed in: your account and your stats are one page.
  if (profile.stats) return <StatsModal profile={profile} status="online" onClose={onClose} onLogout={onLogout} onDelete={onDelete} />;
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
          <RankIcon rank={placed ? rank : null} size={62} />
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
        {onDelete && <button onClick={onDelete} className="w-full tb-t py-2 mt-1" style={{ color: UI.bad, opacity: 0.75 }}>DELETE ACCOUNT</button>}
      </div>
    </Popup>
  );
}

/**
 * Deleting your account, for good: the account, sign-ins, ratings, stats and
 * Marathon scores. Confirmed with the password (or, for Google sign-in, by
 * typing the username).
 */
function DeleteAccountModal({ profile, onClose }) {
  const P = usePx();
  const [value, setValue] = useState("");
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => net.on("deleteError", (m) => { setErr(m); setBusy(false); }), []);
  const google = profile?.provider === "google";
  const go = () => {
    if (!value.trim() || busy) return;
    setBusy(true); setErr(null);
    net.deleteAccount(google ? { confirm: value.trim() } : { password: value });
  };
  return (
    <Popup title="DELETE ACCOUNT" onClose={onClose} maxW={380}>
      <form className="pt-4 pb-1 flex flex-col" style={{ gap: 3 * P }} onSubmit={(e) => { e.preventDefault(); go(); }}>
        <div className="tb-t" style={{ color: UI.text }}>
          This permanently deletes <span style={{ color: UI.bad }}>{profile?.name}</span>: your account, email, ratings, stats and Marathon scores.
          Other players' match lists will show "deleted player". This can't be undone.
        </div>
        <label className="tb-t" style={{ color: UI.dim }}>{google ? "TYPE YOUR USERNAME TO CONFIRM" : "YOUR PASSWORD"}</label>
        <input type={google ? "text" : "password"} value={value} onChange={(e) => { setValue(e.target.value); setErr(null); }} autoComplete={google ? "off" : "current-password"}
          aria-label={google ? "Username" : "Password"} className="tb-t px-3" style={{ ...fieldStyle, height: 44 }} />
        {err && <div className="tb-t" style={{ color: UI.bad }}>{err}</div>}
        <div className="flex" style={{ gap: 2 * P }}>
          <button type="button" onClick={onClose} className="flex-1 tb-t" style={{ height: 44, ...sk(UI.line), color: UI.dim }}>KEEP IT</button>
          <button type="submit" disabled={!value.trim() || busy} className="flex-1 tb-t disabled:opacity-35" style={{ height: 44, ...skFill(UI.bad), color: UI.text }}>
            {busy ? "DELETING…" : "DELETE FOREVER"}
          </button>
        </div>
      </form>
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
        if (v && ink[v]) return <Ink key={i} size={size} color={ink[v]} seed={i} />;
        return <Ink key={i} size={size} stroke="slot" color={UI.line} seed={i} />;
      })}
    </div>
  );
}

function HowToModal({ colors, loadout, onClose }) {
  const [page, setPage] = useState(0);
  const [mode, setModeNow] = useState(() => (["blitz", "sprint", "marathon"].includes(store.get("tb:howMode")) ? store.get("tb:howMode") : "control"));
  const setMode = (m) => { setModeNow(m); setPage(0); store.set("tb:howMode", m); };
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
      body: `You don't choose from a hand. You play the piece at the front of your queue — rotate it and place it, or pass. The next ${QUEUE_SHOWN} are shown, so plan ahead.`,
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
    ...(RULES.actions ? [{
      title: "DELETE AND PIN",
      art: (
        <div className="flex items-center justify-center gap-4" style={{ color: UI.dim }}>
          <span className="flex items-center gap-1.5 tb-t"><Eraser /> 2</span>
          <span className="flex items-center gap-1.5 tb-t"><Pin /> 3</span>
        </div>
      ),
      body: RULES.pinToggle
        ? "Instead of placing, you can DELETE: press 2 and your piece becomes a stamp — put it anywhere and everything under it is wiped, yours or theirs. But every turn your opponent deletes earns you a pin charge. Press 3 to switch PIN on: the piece you place next lands pinned. Pinned squares can't be deleted — but a full line still wipes them."
        : RULES.stamp
        ? `Instead of placing, you can DELETE: press 2 and your piece becomes a stamp — put it anywhere and everything under it is wiped, yours or theirs. But any delete gives your opponent ${RULES.pinsPerDeleteTurn || "a"} pins. Press 3 to PIN: stamp your piece over your own squares (one pin each), then place as usual. Pinned squares can't be deleted — but a full line still wipes them.`
        : `Instead of placing, you can DELETE up to ${RULES.deleteMax} connected squares — anyone's. Press 2 and drag across them. But every square you delete gives your opponent a pin. ${RULES.pinIsFree ? "Pins ride along with your move:" : "Pinning takes your turn:"} press 3 and drag over your own squares to make them permanent — deletes can't touch them${RULES.pinsSurviveClears ? ", nor can line clears" : ", though a full line still wipes them"}.`,
    }] : []),
    {
      title: "THE PIECES",
      art: (
        <div className="flex flex-wrap items-center justify-center gap-2.5">
          {loadout.map((id, i) => <BlockGlyph key={i} blockId={id} box={26} color={colors.you} />)}
        </div>
      ),
      body: `The seven tetrominoes, dealt in bags like Tetris: every bag deals all seven once, freshly shuffled.${RULES.sharedSequence ? " You and your opponent are dealt the exact same pieces in the same order — the difference is what you do with them." : " Your opponent sees your queue, and you see theirs."}`,
    },
  ];


  // Blitz: its own pages (the pieces are drawn in Blitz's colours).
  const B = { I: 0, O: 1, T: 2, S: 3, Z: 4, J: 5, L: 6 };
  const bInk = { I: S_INK[B.I], O: S_INK[B.O], T: S_INK[B.T], L: S_INK[B.L], J: S_INK[B.J] };
  const blitzPages = [
    {
      title: "BLITZ: A RACE",
      art: (
        <div className="flex items-center justify-center gap-3">
          <MiniBoard w={8} h={8} size={10} ink={bInk} cells={{ "7,0": "I", "7,1": "I", "7,2": "I", "7,3": "I", "6,0": "O", "6,1": "O", "5,0": "O", "5,1": "O", "7,6": "L", "7,7": "L", "6,7": "L", "5,7": "L" }} />
          <span className="tb-t" style={{ color: UI.dim }}>vs</span>
          <MiniBoard w={8} h={8} size={10} ink={bInk} cells={{ "7,0": "T", "7,1": "T", "7,2": "T", "6,1": "T", "7,4": "J", "7,5": "J", "6,5": "J", "6,4": "J" }} />
        </div>
      ),
      body: "Two players, two 8×8 boards, the same pieces in the same order. Nobody takes turns: place as fast as you can. Fill a row or a column and it clears. When nothing in your hand fits anywhere, you lose.",
    },
    {
      title: "YOUR TWO PIECES",
      art: (
        <div className="flex items-center justify-center gap-4">
          <div style={{ padding: 6, ...glass(UI.text) }}><SPiece id={B.T} cell={8} gap={2} /></div>
          <div style={{ padding: 6, ...glass(UI.line), opacity: 0.7 }}><SPiece id={B.S} cell={8} gap={2} /></div>
          <div className="flex flex-col gap-1">{[B.I, B.O, B.L, B.Z, B.J].map((id, k) => <Ink key={k} size={10} color={S_INK[id]} />)}</div>
        </div>
      ),
      body: "You hold two pieces and see the next five. The piece in play follows your mouse: click to place it, right click to swap to the other one, S / D / A to turn it left, right or halfway round. Every key can be changed in Settings.",
    },
    {
      title: "SPIKES",
      art: (
        <div className="tb-t grid gap-x-4 gap-y-1" style={{ gridTemplateColumns: "auto auto auto auto" }}>
          {[["1 line", "0 · combo 1"], ["T S Z O · 4", "10"], ["2 lines", "2 · combo 3"], ["I J L · 4", "8"], ["3 lines", "4"], ["5 lines", "15"], ["all clear", "20"]].map(([a, b]) => (
            <React.Fragment key={a}><span style={{ color: UI.dim }}>{a}</span><span className="tb-b" style={{ color: GOLD }}>{b}</span></React.Fragment>
          ))}
        </div>
      ),
      body: "Every clear adds to your spike; clears in a row (a combo) keep adding, and the first piece that clears nothing sends the whole spike as one junk piece. A single on its own sends nothing; big clears send far more.",
    },
    {
      title: "JUNK",
      art: (
        <div className="flex items-end justify-center gap-4">
          {[1, 3, 4, 8, 12].map((lv) => <div key={lv} className="flex flex-col items-center gap-1"><SPiece id={S_JUNK + lv} cell={8} gap={2} /><span className="tb-t" style={{ color: UI.dim }}>{lv}</span></div>)}
        </div>
      ),
      body: "A spike lands in your opponent's forecast as one grey junk piece, sixth in line, and it grows with its level: one square, then a diagonal, a corner, a block, then ring after ring. They have to place it like any other piece. Send big ones; don't let them build.",
    },
    {
      title: "RED SQUARES",
      art: <MiniBoard w={8} h={4} size={10} ink={{ ...bInk, R: "#7A2330" }} cells={{ "0,0": "R", "0,1": "R", "0,2": "R", "0,3": "R", "0,4": "R", "0,5": "R", "0,6": "R", "0,7": "R", "1,7": "R", "1,6": "R", "2,0": "I", "2,1": "I", "2,2": "I", "2,3": "I" }} />,
      body: "Every line your opponent clears lights one of your empty squares dark red, from the top left in a zigzag down. Placing a piece clears all your red. If red ever covers every empty square, it flashes for a second and you lose — so keep moving.",
    },
    {
      title: "RANKED AND PRACTICE",
      art: (
        <div className="flex items-center justify-center gap-4 tb-t">
          <span className="tb-b" style={{ color: "#F29A4A" }}>BLITZ</span>
          <span style={{ color: UI.dim }}>·</span>
          <span className="tb-b" style={{ color: UI.text }}>VS BOT</span>
        </div>
      ),
      body: "BLITZ is ranked 1v1 online, with its own rating on T-Terminal; the server checks every placement. VS BOT is the same game against a bot from skill 1 (about one piece every two seconds) to 10 (about three a second, and it hunts combos). Every match is saved in REPLAYS.",
    },
  ];
  // Blitz pages go deeper: combos, junk, defence.
  blitzPages.splice(3, 0, {
    title: "COMBOS AND T-SPINS",
    art: (
      <div className="flex items-center justify-center gap-3">
        <MiniBoard w={8} h={4} size={10} ink={bInk} cells={{ "3,0": "I", "3,1": "I", "3,2": "I", "3,3": "I", "3,5": "L", "3,6": "L", "3,7": "L", "2,7": "L", "2,0": "O", "2,1": "O", "1,0": "O", "1,1": "O" }} />
        <span className="tb-t tb-b" style={{ color: GOLD }}>→ ×</span>
      </div>
    ),
    body: "Clear with piece after piece and it's a combo: every clear adds to one spike, and the first piece that clears nothing sends it. Inside a combo a single adds 1 and a double 3. Big clears are the heavy hitters, combo or not: four lines send 10 with a T, S, Z or O and 8 with an I, J or L; five lines send 15; an all clear 20.",
  }, {
    title: "DEFENCE",
    art: (
      <div className="flex items-end justify-center gap-4">
        <SPiece id={S_JUNK + 6} cell={7} gap={1} />
        <span className="tb-t" style={{ color: UI.dim }}>place it where it costs least</span>
      </div>
    ),
    body: "Junk arrives sixth in your forecast, so you see it coming five pieces ahead. Leave room for it: an open corner or edge fits most junk. A big junk piece placed well can even finish a line for you. If your board fills past half, take any clear you can — singles included — to dig out.",
  });
  const sInk = { I: S_INK[0], O: S_INK[1], T: S_INK[2], L: S_INK[6], J: S_INK[5] };
  const sprintPages = [
    {
      title: "SPRINT: 40 LINES",
      art: <MiniBoard w={8} h={8} size={10} ink={sInk} cells={{ "7,0": "I", "7,1": "I", "7,2": "I", "7,3": "I", "7,4": "O", "7,5": "O", "6,4": "O", "6,5": "O", "7,6": "L", "7,7": "L", "6,7": "L", "5,7": "L" }} />,
      body: "Clear 40 lines as fast as you can on an 8×8 board. Rows and columns both count. The clock starts on your first move. Same pieces for everyone on a ranked run: the server checks every placement and its time.",
    },
    {
      title: "THE CONTROLS",
      art: (
        <div className="tb-t grid gap-x-5 gap-y-1" style={{ gridTemplateColumns: "auto auto" }}>
          {[["move", "mouse"], ["place", "left click / C"], ["swap piece", "right click"], ["turn", "S · D · A (180)"], ["retry", "R"], ["forfeit", "Esc"]].map(([a, b]) => (
            <React.Fragment key={a}><span style={{ color: UI.dim }}>{a}</span><span className="tb-b">{b}</span></React.Fragment>
          ))}
        </div>
      ),
      body: "The piece follows your mouse and always stays on the board. You hold two pieces: swap between them, turn the one in play, click to drop it. The next five are on the right. Every key and mouse button can be rebound in Settings.",
    },
    {
      title: "ULTRA: 2 MINUTES",
      art: (
        <div className="tb-t grid gap-x-5 gap-y-1" style={{ gridTemplateColumns: "auto auto" }}>
          {[["1 line", "100"], ["2 lines", "300"], ["3 lines", "500"], ["4 lines", "800"], ["each more", "+400"], ["all clear", "3000 × combo"]].map(([a, b]) => (
            <React.Fragment key={a}><span style={{ color: UI.dim }}>{a}</span><span className="tb-b" style={{ color: GOLD }}>{b}</span></React.Fragment>
          ))}
        </div>
      ),
      body: "Score as much as you can in two minutes. Clearing on back-to-back pieces builds a combo that multiplies every clear (×1.5, ×2, ×2.5…); a piece that clears nothing ends it. Big clears and all clears inside a long combo are where the points are.",
    },
    {
      title: "RECORDS AND REPLAYS",
      art: <div className="tb-t tb-b" style={{ color: ACCENTS.terminal }}>T-TERMINAL</div>,
      body: "Signed in, your best Sprint time and Ultra score go on the T-Terminal leaderboards once the server has replayed them. Every finished run is kept in REPLAYS with its real timing — watch it back, or save it as a video.",
    },
  ];
  const mInk = { A: colors.you, B: colors.special, S: colors.rival };
  const marathonPages = [
    {
      title: "MARATHON",
      art: <MiniBoard w={7} h={7} size={12} ink={mInk} cells={{ "6,0": "A", "6,1": "A", "6,2": "A", "5,0": "A", "6,4": "B", "6,5": "B", "5,5": "B", "5,6": "B", "4,3": "S", "4,4": "S" }} />,
      body: "A solo puzzle for high scores on a 7×7 board. You hold three pieces; place any of them anywhere it fits, turned any way. Fill a row or a column and it clears. It ends when none of your three pieces fits anywhere.",
    },
    {
      title: "SCORING",
      art: (
        <div className="tb-t grid gap-x-5 gap-y-1" style={{ gridTemplateColumns: "auto auto" }}>
          {[["placing", "1 per square"], ["clearing", "10 per square"], ["× lines", "cleared at once"], ["× streak", "clears in a row"], ["× level", "+10% a level"]].map(([a, b]) => (
            <React.Fragment key={a}><span style={{ color: UI.dim }}>{a}</span><span className="tb-b" style={{ color: GOLD }}>{b}</span></React.Fragment>
          ))}
        </div>
      ),
      body: "Clears pay far more than placing. Clearing two lines at once doubles them; a clear within three moves of the last keeps your streak going and multiplies again. The level rises every 10 lines and every clear pays 10% more per level.",
    },
    {
      title: "SURVIVING",
      art: <div className="flex items-center justify-center gap-3"><Stack style={{ color: MODE_INK.marathon, width: 40, height: 40 }} /></div>,
      body: "From level 3, each new bag carries more big, awkward pieces, so the board always closes in. Keep the middle open, keep a place for the long pieces, and don't fill a line you can't finish. On a phone, drag a piece to the board and tap the big turn button with your other hand.",
    },
  ];
  // More on Control: the rating.
  pages.push({
    title: "RANKED AND RATING",
    art: <div className="flex items-center justify-center gap-2">{RANKS.filter((_, i) => i % 2 === 1 || i === RANKS.length - 1).map((r) => <RankIcon key={r.name} rank={r} size={34} />)}</div>,
    body: `Ranked Control and Blitz each have a Glicko-2 rating. After ${PLACEMENT_GAMES} placement matches you get a rank, from F up through C, B, A and S to X. The ± is how sure the rating is; it narrows as you play. Win against stronger players to climb faster.`,
  });
  const BOOKS = { control: pages, blitz: blitzPages, sprint: sprintPages, marathon: marathonPages };
  const TAB_INK = { control: MODE_INK.ranked, blitz: MODE_INK.blitz, sprint: MODE_INK.sprint, marathon: MODE_INK.marathon };
  const list = BOOKS[mode] || pages;
  const p = list[page];
  const last = page === list.length - 1;

  const wide = useWidePanel();
  const progress = (
    <div className="flex gap-1 mb-4">
      {list.map((_, i) => (
        <div key={i} style={{
          flex: 1, height: 2, borderRadius: 2,
          background: i <= page ? TAB_INK[mode] : UI.line,
          transition: "background 200ms",
        }} />
      ))}
    </div>
  );
  const tabs = (
    <div className="flex flex-wrap gap-1.5">
      {[["control", "CONTROL"], ["blitz", "BLITZ"], ["sprint", "SPRINT · ULTRA"], ["marathon", "MARATHON"]].map(([k, label]) => (
        <button key={k} onClick={() => setMode(k)} aria-pressed={mode === k} className="tb-t px-3"
          style={{ height: 30, ...(mode === k ? skFill(TAB_INK[k]) : glass(UI.line)), color: mode === k ? UI.text : UI.dim }}>{label}</button>
      ))}
    </div>
  );
  const art = (
    <div className="rounded py-5 flex items-center justify-center"
      style={{ background: UI.ground, ...sk(UI.line), minHeight: wide ? 170 : 104 }}>
      <div style={wide ? { zoom: 1.3 } : undefined}>{p.art}</div>
    </div>
  );
  const buttons = (
    <div className="flex gap-2">
      <button
        onClick={() => setPage((n) => Math.max(0, n - 1))}
        disabled={page === 0}
        className="rounded tb-t disabled:opacity-30"
        style={{ height: wide ? 40 : 46, flex: 1, ...sk(UI.line), color: UI.dim }}
      >
        BACK
      </button>
      <button
        onClick={() => (last ? onClose() : setPage((n) => n + 1))}
        className="rounded tb-t"
        style={{ height: wide ? 40 : 46, flex: 1.6, ...skFill(UI.text), color: UI.text }}
      >
        {last ? "GOT IT" : "NEXT"}
      </button>
    </div>
  );

  return (
    <Popup title="HOW TO PLAY" onClose={onClose} maxW={380} wideW={780}>
      {wide ? (
        // A computer: the picture on the left, the words and the buttons on the right.
        <div className="pt-4 pb-1">
          <div className="mb-3">{tabs}</div>
          {progress}
          <div className="tb-cols grid gap-7 items-stretch" style={{ gridTemplateColumns: "1.1fr 1fr" }}>
            {art}
            <div className="flex flex-col min-w-0">
              <div className="tb-t mb-3" style={{ color: UI.dim }}>{p.title}</div>
              <div className="tb-t flex-1 mb-4">{p.body}</div>
              {buttons}
            </div>
          </div>
        </div>
      ) : (
        <div className="pt-4 pb-1">
          <div className="mb-3">{tabs}</div>
          {progress}
          <div className="tb-t mb-2" style={{ color: UI.dim }}>{p.title}</div>
          <div className="mb-3">{art}</div>
          <div className="tb-t mb-3" style={{ minHeight: 96 }}>{p.body}</div>
          {buttons}
        </div>
      )}
    </Popup>
  );
}

/* ============================================================
   MENU
   ============================================================ */
/** The title: TESELLA in the game's font, bold capitals. */

function PixelLogo({ small = false }) {
  return (
    <div className={small ? "flex justify-center" : "flex justify-center tb-bob"}>
      <PixelWord text="TESELLA" from="var(--tb-you)" to="var(--tb-rival)" scale={small ? 2 : 3} />
    </div>
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
const SINK_MS = 300;

function Menu({ onPick, loadout, colors, profile, status, name, rename, onLogout, theme, setTheme, initialModal = null }) {
  const [modal, setShown] = useState(initialModal);
  // Where the menu is heading: set the moment a page is asked for, so the
  // title starts gliding up while the buttons are still sinking.
  const [pending, setPending] = useState(initialModal);
  // While true, whatever is showing under the title is sinking out.
  const [leaving, setLeaving] = useState(false);
  const swap = useRef(null);
  const still = !theme.motion || (typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches);
  const setModal = useCallback((next) => {
    clearTimeout(swap.current);
    setPending(next);
    if (still) { setShown(next); setLeaving(false); return; }
    setLeaving(true);
    swap.current = setTimeout(() => { setShown(next); setLeaving(false); }, SINK_MS);
  }, [still]);
  useEffect(() => () => clearTimeout(swap.current), []);

  // The menu sits centred. Opening a page lifts the title (and the slot
  // under it) up near the top of the screen, so the page gets the room;
  // closing glides it back. `lift` is how far, in screen pixels.
  const rootRef = useRef(null), slotRef = useRef(null), liftRef = useRef(0);
  const [lift, setLift] = useState(0);
  const [base, setBase] = useState({ top: 0, slot: 0 });
  useLayoutEffect(() => {
    const root = rootRef.current, slot = slotRef.current, head = slot?.parentElement;
    if (!root || !slot || !head) return undefined;
    const place = () => {
      const r = root.getBoundingClientRect();
      // Measured as if not lifted (the lift is a transform, so it shows up in the rects).
      const top = head.getBoundingClientRect().top - r.top + liftRef.current;
      const slotTop = slot.getBoundingClientRect().top - r.top + liftRef.current;
      setBase((b) => (Math.abs(b.top - top) < 1 && Math.abs(b.slot - slotTop) < 1 ? b : { top, slot: slotTop }));
    };
    place();
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(place) : null;
    ro?.observe(root); ro?.observe(slot);
    window.addEventListener("resize", place);
    return () => { ro?.disconnect(); window.removeEventListener("resize", place); };
  }, []);
  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    // Up to a little below the top edge (and the notch): 7% of the height, 18–90 px.
    const target = Math.min(90, Math.max(18, root.clientHeight * 0.07));
    const want = pending ? Math.max(0, Math.round(base.top - target)) : 0;
    liftRef.current = want;
    setLift(want);
    // The page hangs from the lifted slot. While one sinks away it keeps its
    // place, so only move the anchor once nothing is showing.
    if (pending || !modal) root.style.setProperty("--menu-top", `${Math.round(base.slot - want)}px`);
  }, [pending, base, modal]);
  const authed = useAuth() === "authed";
  const verified = !!profile?.emailVerified;
  const online = useOnline();
  const notice = useNotice();

  return (
    <div ref={rootRef} className="tb-screen tb-safe relative w-full flex items-center justify-center px-5 font-mono overflow-hidden" style={{ color: UI.text }}>
      <AmbientField colors={colors} theme={theme} paused={false} />
      <div className="absolute inset-0 pointer-events-none" style={{ background: "radial-gradient(ellipse at 50% 46%, color-mix(in srgb, var(--tb-ground) 45%, transparent) 0%, color-mix(in srgb, var(--tb-ground) 20%, transparent) 50%, transparent 80%)" }} />

      {/* Water over the sky while a panel is open: soft drifting light, no dark in it. */}
      <div aria-hidden="true" className="tb-tide absolute inset-0 pointer-events-none" style={{ opacity: modal && !leaving ? 1 : 0 }} />

      <div className="relative w-full flex justify-center" style={{
        transform: lift ? `translateY(${-lift}px)` : "none",
        transition: still ? "none" : "transform .75s cubic-bezier(.45,.05,.2,1)",
      }}>
      <Scaled className="tb-calm relative w-full" style={{ maxWidth: 316 }}>
        {/* The title glides up for a page and back down for the menu. */}
        <div className="text-center mb-7">
          <PixelLogo />
          <PixelRule />
          <div className="tb-t mt-2" style={{ color: UI.dim, opacity: 0.6 }}>{VERSION_LABEL}</div>
        </div>

        {/* The buttons. Hidden (not removed) while a panel is open, so the title stays put. */}
        <div ref={slotRef} style={{ visibility: modal ? "hidden" : "visible" }}>
        <div key={modal ? "away" : "here"} className={`tb-flow${leaving && !modal ? " out" : ""}`}>

        {/* One big way in: PLAY opens the modes. */}
        <button onClick={() => setModal("PLAY")}
          className="w-full rounded flex flex-col items-center justify-center gap-1.5 mb-2"
          style={{ height: 86, paddingTop: 4, ...skFill("var(--tb-you)") }}>
          <PixelWord text="PLAY" from="var(--tb-text)" to="var(--tb-you)" />
          {status === "online" && online !== null ? (
            <span className="tb-t" style={{ color: UI.dim }}>{online === 1 ? "just you online right now" : `${online} people online`}</span>
          ) : (
            <span className="tb-t" style={{ color: UI.dim }}>{status === "connecting" ? "connecting…" : "offline: marathon and turn based still work"}</span>
          )}
        </button>

        {notice && (
          <button onClick={() => net.setNotice(null)} className="w-full text-left tb-t px-3 py-2 mb-2.5"
            style={{ ...sk(GOLD_SOFT), color: GOLD }}>
            {notice} <span style={{ color: UI.dim }}>(tap to dismiss)</span>
          </button>
        )}

        <div className="flex gap-2 mb-2">
          {/* Replays (yellow) and T-TERMINAL, the player hub. */}
          <button onClick={() => onPick("REPLAYS")} aria-label="Replays"
            className="flex-1 rounded flex items-center justify-center gap-2 min-w-0 px-2"
            style={{ height: 38, ...skFill(GOLD), color: UI.text }}>
            <span style={{ color: GOLD, display: "flex" }}><Film /></span>
            <span className="tb-t">REPLAYS</span>
          </button>
          <a href="/terminal" className="flex-1 rounded flex items-center justify-center gap-2 no-underline"
            style={{ height: 38, ...skFill(ACCENTS.terminal), color: UI.text }}>
            <span style={{ color: ACCENTS.terminal, display: "flex" }}><TerminalIcon /></span>
            <span className="tb-t">T-TERMINAL</span>
          </a>
        </div>

        {/* Four, evenly: theme, replays, how to play, settings. */}
        <div className="grid grid-cols-4 gap-2">
          {/* Your account: who you're signed in as (gold until verified), or a way to sign in. */}
          {[["THEME", "Theme", Palette], ["ACCOUNT", "Account", UserRound], ["HOWTO", "How to play", BookOpen], ["SETTINGS", "Settings", Settings2]].map(([k, label, Icon]) => (
            <button key={k} onClick={() => (k === "ACCOUNT" ? setModal(authed || profile?.guest ? "ACCOUNT" : "login") : setModal(k))} aria-label={label}
              title={k === "ACCOUNT" ? (authed ? profile?.name : profile?.guest ? `${profile.name} (guest)` : "Log in") : label}
              className="rounded flex items-center justify-center" style={{ height: 38, ...glass(k === "ACCOUNT" && authed && !verified ? GOLD_SOFT : UI.line) }}>
              <Icon size={16} style={{ color: k === "ACCOUNT" && authed && !verified ? GOLD : k === "ACCOUNT" && authed ? UI.text : UI.dim }} />
            </button>
          ))}
        </div>

        {/* The site: each page in its own colour. */}
        <div className="grid grid-cols-4 gap-2 mt-2">
          {[["about", "ABOUT"], ["news", "NEWS"], ["download", "APP"], ["help", "HELP"]].map(([k, label]) => (
            <a key={k} href={`/${k}`} className="rounded flex items-center justify-center no-underline"
              style={{ height: 38, ...glass(`color-mix(in srgb, ${ACCENTS[k]} 55%, transparent)`), color: ACCENTS[k] }}>
              <span className="tb-t">{label}</span>
            </a>
          ))}
        </div>
        </div>
        </div>
      </Scaled>
      </div>

      <InlineCtx.Provider value={{ leaving }}>
      {(modal === "login" || modal === "signup") && (
        <AuthModal mode={modal} onClose={() => setModal(null)} onSwitch={setModal} />
      )}
      {modal === "reset" && <ResetModal onClose={() => setModal(null)} onBack={() => setModal("login")} />}
      {modal === "VERIFY" && profile && <VerifyModal profile={profile} onClose={() => setModal(null)} />}
      {modal === "THEME" && <ThemeModal theme={theme} setTheme={setTheme} onClose={() => setModal(null)} />}
      {modal === "HOWTO" && <HowToModal colors={colors} loadout={loadout} onClose={() => setModal(null)} />}
      {modal === "ACCOUNT" && (
        <AccountModal profile={profile} onLogout={() => { setModal(null); onLogout(); }} onClose={() => setModal(null)} onDelete={() => setModal("DELETE")} />
      )}
      {modal === "SETTINGS" && <SettingsModal name={name} rename={rename} status={status} theme={theme} setTheme={setTheme} onClose={() => setModal(null)} />}
      {modal === "STATS" && <StatsModal profile={profile} status={status} onClose={() => setModal(null)} />}
      {modal === "DELETE" && (profile && !profile.guest
        ? <DeleteAccountModal profile={profile} onClose={() => setModal("ACCOUNT")} />
        : <Popup title="ACCOUNT DELETED" onClose={() => setModal(null)} maxW={360}>
            <div className="pt-4 pb-2 tb-t" style={{ color: UI.text }}>Your account and everything stored with it has been deleted.</div>
          </Popup>)}
      {modal === "PLAY" && (
        <PlayModal status={status} authed={authed} verified={verified} profile={profile}
          onClose={() => setModal(null)}
          onPick={(t) => {
            if (t === "MATCHMAKING" || t === "BLITZ") {
              if (status !== "online") return;
              if (!authed) return setModal("login");
              if (!verified) return setModal("VERIFY");
              // Ranked: its own lobby, in place of PLAY.
              return setModal(t === "BLITZ" ? "LOBBY:blitz" : "LOBBY:control");
            }
            setModal(null);
            onPick(t);
          }} />
      )}
      {modal?.startsWith("LOBBY:") && <RankedLobby mode={modal.slice(6)} profile={profile} loadout={loadout} onClose={() => setModal("PLAY")} />}
      {!modal?.startsWith("LOBBY:") && <QueuePill onOpen={() => setModal(`LOBBY:${qstore.mode || qstore.found || "blitz"}`)} />}
      </InlineCtx.Provider>
    </div>
  );
}

/* ============================================================
   PLAY — every way to play, in a little underwater night sky
   ============================================================ */
// Ranked: dark green. The AIs: grey. Sprint yellow, Ultra red, Marathon blue, private purple.
const MODE_INK = { blitz: "#F29A4A", ranked: "#2FA36B", ai: "#A9A7B4", sprint: "#F2D45C", ultra: "#F0606A", marathon: "#5C9DF2", turns: "#EC93B8", private: "#A68BF0", zerog: "#7FE3F0" };

/** A mode: a pane of clear, lightly tinted glass, like a board square. Light sweeps it on hover. */
function ModeCard({ big = false, ink, icon: Icon, title, sub, note, noteInk, onClick, disabled, delay = 0, h, style }) {
  const tint = (n) => `color-mix(in srgb, ${ink} ${n}%, transparent)`;
  return (
    <button onClick={onClick} disabled={disabled} aria-label={title}
      className="tb-card tb-float relative w-full text-left flex flex-col overflow-hidden disabled:opacity-35"
      style={{
        animationDelay: `${delay}ms`,
        minHeight: h, padding: big ? "10px 12px 9px" : "8px 10px 7px", gap: big ? 4 : 3,
        borderWidth: "var(--p)", borderStyle: "solid", borderColor: tint(big ? 75 : 55), clipPath: CLIP,
        // Clear glass: the sky shows through, faintly tinted, lit along the top.
        background: `color-mix(in srgb, ${ink} ${big ? 16 : 12}%, color-mix(in srgb, var(--tb-text) 8%, transparent))`,
        boxShadow: `inset 0 var(--p) 0 color-mix(in srgb, var(--tb-text) 30%, transparent), inset var(--p) 0 0 color-mix(in srgb, var(--tb-text) 14%, transparent)`,
        ...style,
      }}>
      {big ? (
        <>
          <span className="flex justify-between items-start gap-2">
            <Icon style={{ color: ink, width: "calc(var(--p) * 13)", height: "calc(var(--p) * 13)" }} />
            {note && <span className="tb-t tb-b text-right" style={{ color: noteInk || ink }}>{note}</span>}
          </span>
          <span className="flex-1" />
          <PixelWord text={title} from="var(--tb-text)" to={ink} scale={1.6} />
        </>
      ) : (
        // Small cards: the icon sits beside the title, one line saved.
        <>
          <span className="flex-1" />
          <span className="flex items-center gap-2"><Icon style={{ color: ink, flexShrink: 0 }} /><span className="tb-t" style={{ color: ink }}>{title}</span></span>
        </>
      )}
      <span className="tb-t" style={{ color: UI.text, opacity: 0.8 }}>{sub}</span>
    </button>
  );
}

function PlayModal({ status, authed, verified, profile, onPick, onClose }) {
  const phone = useCompact();
  const q = useQueueMode(), found = useQueueFound();
  useEffect(() => { sfx.open(); }, []);
  useEffect(() => { const k = (e) => e.key === "Escape" && onClose(); window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k); }, [onClose]);
  const online = status === "online";
  const count = useOnline();
  const best = Math.max(Number(store.get("tb:marathonBest")) || 0, net.profile?.marathon?.best || 0);
  const open = net.profile?.marathonOpen;
  const off = online ? null : "needs the server";
  // While you search for (or have found) a ranked match, everything else waits.
  const busy = !!(q || found);
  const now = useTick(1000, !!q);
  const lock = (mode) => busy && q !== mode && found !== mode;
  const ranked = (mode) => {
    if (!online) return { sub: phone ? "offline" : "needs the server" };
    if (!authed) return { sub: phone ? "needs an account" : "account required" };
    if (!verified) return { sub: "verify your email" };
    if (q === mode) return { sub: `searching · ${fmtWait(now - qstore.since)}`, note: "…" };
    const i = rankedInfo(mode, profile);
    return i.placed ? { sub: `${i.tr} glicko ±${i.rd}`, note: i.rank.name, noteInk: i.rank.color } : { sub: `${Math.min(i.games, PLACEMENT_GAMES)}/${PLACEMENT_GAMES} placement matches`, note: "UNPLACED" };
  };
  const rb = ranked("blitz"), rc = ranked("control");
  const half = (a, b) => (
    <div className="flex w-full" style={{ gap: 8 }}>
      <div style={{ flex: 1, minWidth: 0 }}>{a}</div>
      <div style={{ flex: 1, minWidth: 0 }}>{b}</div>
    </div>
  );
  return (
    // In place of the menu's buttons: just the modes.
    <InlineFrame title="PLAY" label="Play" onClose={onClose} maxW={phone ? 480 : 600}
      aside={<span className="tb-t text-right" style={{ color: UI.text, opacity: 0.6 }}>{!online ? "offline" : count ? `${count} online` : ""}</span>}>
            {/* Two families: BLITZ (speed) on the left, CONTROL (thinking) on the right. */}
            <div className="flex items-start" style={{ gap: phone ? 10 : 18 }}>
              <div className="flex flex-col min-w-0" style={{ flex: 1, gap: 8 }}>
                {phone ? (
                  // On a phone Marathon is the Blitz mode.
                  <ModeCard big ink={MODE_INK.marathon} icon={Stack} title="MARATHON" h={96} delay={0} disabled={lock()}
                    sub={open ? `resume · ${open.score.toLocaleString("en-US")}` : "solo, 7×7"}
                    note={best ? `BEST ${best.toLocaleString("en-US")}` : null} onClick={() => onPick("MARATHON")} />
                ) : (
                  <>
                    <ModeCard big ink={MODE_INK.ranked} icon={Clock} title="BLITZ" h={100} delay={0}
                      sub={rb.sub} note={rb.note} noteInk={rb.noteInk}
                      disabled={!online || lock("blitz")} onClick={() => onPick("BLITZ")} />
                    {half(
                      <ModeCard ink={MODE_INK.ai} icon={Robot} title="VS BOT" sub="skill 1–10" h={56} delay={200} disabled={lock()} onClick={() => onPick("BLITZBOT")} />,
                      <ModeCard ink={MODE_INK.marathon} icon={Stack} title="MARATHON" h={56} delay={300} disabled={lock()}
                        sub={open ? `resume · ${open.score.toLocaleString("en-US")}` : best ? `best ${best.toLocaleString("en-US")}` : "solo high score"} onClick={() => onPick("MARATHON")} />,
                    )}
                    {half(
                      <ModeCard ink={MODE_INK.sprint} icon={Clock} title="SPRINT" sub={sprintBest.get() ? `best ${fmtClock(sprintBest.get())}` : "40 lines"} h={56} delay={400} disabled={lock()} onClick={() => onPick("SPRINT")} />,
                      <ModeCard ink={MODE_INK.ultra} icon={Flag} title="ULTRA" sub={ultraBest.get() ? `best ${ultraBest.get().toLocaleString("en-US")}` : "2 min"} h={56} delay={600} disabled={lock()} onClick={() => onPick("ULTRA")} />,
                    )}
                    <ModeCard ink={MODE_INK.zerog} icon={Stack} title="ZERO-G" sub={zgBest.get() ? `best ${fmtClock(zgBest.get())}` : "falling blocks, no gravity · 40 lines"} h={56} delay={700} disabled={lock()} onClick={() => onPick("ZEROG")} />
                  </>
                )}
              </div>
              <div className="flex flex-col min-w-0 items-end" style={{ flex: 1, gap: 8 }}>
                <ModeCard big ink={MODE_INK.ranked} icon={Trophy} title="CONTROL" h={phone ? 96 : 100} delay={500}
                  sub={rc.sub} note={rc.note} noteInk={rc.noteInk}
                  disabled={!online || lock("control")} onClick={() => onPick("MATCHMAKING")} />
                {half(
                  <ModeCard ink={MODE_INK.ai} icon={Robot} title="VS AI" sub="strength 1–10" h={56} delay={800} disabled={lock()} onClick={() => onPick("DIFFICULTY")} />,
                  <ModeCard ink={MODE_INK.private} icon={Lock} title="PRIVATE" sub={off || "a room code"} h={56} delay={650} disabled={!online || lock()} onClick={() => onPick("PRIVATE")} />,
                )}
                {/* Pass-and-play only makes sense on one phone in two hands. */}
                {phone && <div className="w-full"><ModeCard ink={MODE_INK.turns} icon={People} title="TURN BASED" sub="1 device" h={56} delay={300} disabled={lock()} onClick={() => onPick("TURNBASED")} /></div>}
              </div>
            </div>
    </InlineFrame>
  );
}

/* ============================================================
   RANKED QUEUE — kept while you wander the menu
   ============================================================ */
const qstore = { mode: null, since: 0, found: null, subs: new Set() };
const qemit = () => qstore.subs.forEach((f) => f());
const useQueueMode = () => useSyncExternalStore((f) => { qstore.subs.add(f); return () => qstore.subs.delete(f); }, () => qstore.mode);
const useQueueFound = () => useSyncExternalStore((f) => { qstore.subs.add(f); return () => qstore.subs.delete(f); }, () => qstore.found);
function startQueue(mode, loadout) {
  if (qstore.mode || qstore.found) return;
  if (mode === "blitz") net.blitzQueue(); else net.queue(loadout, false);
  qstore.mode = mode; qstore.since = Date.now(); qemit();
  sfx.pick();
}
function stopQueue() {
  if (!qstore.mode) return;
  if (qstore.mode === "blitz") net.blitzCancel(); else net.unqueue();
  qstore.mode = null; qemit();
}
const useLobby = () => useSyncExternalStore(subs.online, () => net.lobby);
/** The time now, refreshed every `ms` while `on`. */
function useTick(ms, on = true) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { if (!on) return undefined; const h = setInterval(() => setNow(Date.now()), ms); return () => clearInterval(h); }, [ms, on]);
  return now;
}
const fmtWait = (ms) => { const s = Math.max(0, Math.floor(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; };

/** A ranked mode's standing for a player: rating, rank, placement. */
function rankedInfo(mode, profile) {
  const r = mode === "blitz" ? profile?.blitz?.rating : profile?.rating;
  const games = mode === "blitz" ? (profile?.blitz?.games || 0) : (profile?.stats?.games || 0);
  const tr = r ? Math.round(r.r) : 1500;
  return { tr, rd: r ? Math.round(r.rd) : 350, games, placed: games >= PLACEMENT_GAMES, rank: RANKS[rankIndexFor(tr)] };
}


/**
 * A ranked mode's lobby, in place of the menu's buttons (like PLAY): your
 * rank and rating, who's around, and one big PLAY. Queueing carries on if
 * you leave this for the menu, settings or a theme; only other games wait.
 */
function RankedLobby({ mode, profile, loadout, onClose }) {
  const P = usePx();
  const q = useQueueMode(), found = useQueueFound();
  const now = useTick(500, !!q);
  const lobby = useLobby(), online = useOnline();
  useEffect(() => { sfx.open(); }, []);
  useEffect(() => { const k = (e) => e.key === "Escape" && onClose(); window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k); }, [onClose]);
  const info = rankedInfo(mode, profile);
  const mine = q === mode, other = q && q !== mode, matched = found === mode;
  const ink = MODE_INK.ranked;
  const count = (k) => lobby?.[k]?.[mode] ?? 0;
  const games = mode === "blitz" ? profile?.blitz : profile?.stats;
  return (
    <InlineFrame title={mode === "blitz" ? "BLITZ" : "CONTROL"} label={`${mode} ranked`} onClose={onClose} maxW={440}
      aside={<span className="tb-t text-right" style={{ color: UI.text, opacity: 0.6 }}>{online ? `${online} online` : ""}</span>}>
      <div className="flex flex-col items-center text-center" style={{ gap: 5 * P, paddingTop: 4 * P }}>
        <div className="tb-t" style={{ color: UI.dim }}>{mode === "blitz" ? "8×8 race · spikes send junk" : "simultaneous turns · own the board"}</div>
        {/* Your standing. */}
        <div className="flex items-center" style={{ gap: 5 * P }}>
          <div className="flex flex-col items-center" style={{ gap: 2 * P }}>
            <RankIcon rank={info.placed ? info.rank : null} size={28 * P} />
            <span className="tb-t tb-b" style={{ color: info.placed ? info.rank.color : UI.dim }}>{info.placed ? info.rank.name : "UNPLACED"}</span>
          </div>
          <div className="flex flex-col items-start" style={{ gap: P }}>
            {info.placed ? (
              <>
                <span className="tb-t tb-b tabular-nums" style={{ fontSize: "2em", lineHeight: 1.1 }}>{info.tr}</span>
                <span className="tb-t" style={{ color: UI.dim }}>GLICKO ±{info.rd}</span>
              </>
            ) : (
              <>
                <span className="tb-t tb-b tabular-nums" style={{ fontSize: "2em", lineHeight: 1.1 }}>{Math.min(info.games, PLACEMENT_GAMES)}/{PLACEMENT_GAMES}</span>
                <span className="tb-t" style={{ color: UI.dim }}>PLACEMENT MATCHES</span>
              </>
            )}
            <span className="tb-t" style={{ color: UI.dim }}>{games?.games || 0} played · {games?.wins || 0} won</span>
          </div>
        </div>
        {/* The one button. */}
        <button onClick={() => (matched ? null : mine ? stopQueue() : !other && startQueue(mode, loadout))} disabled={!!other || matched}
          aria-label={mine ? "Cancel search" : "Play"}
          className={`flex flex-col items-center justify-center ${mine ? "tb-pulse" : ""} disabled:opacity-40`}
          style={{ width: 210, height: 110, gap: 6, ...skFill(ink), color: UI.text, clipPath: CLIP }}>
          {mine || matched
            ? <span style={{ fontFamily: '"Silkscreen", monospace', fontWeight: 700, fontSize: "calc(var(--p) * 13)", lineHeight: 1 }}>{matched ? "FOUND" : "SEARCHING"}</span>
            : <PixelWord text="PLAY" from="var(--tb-text)" to={ink} scale={2} />}
          <span className="tb-t" style={{ color: UI.text, opacity: 0.85 }}>
            {matched ? "match found" : mine ? `${fmtWait(now - qstore.since)} · click to cancel` : `${mode === "blitz" ? "ranked blitz" : "ranked control"}`}
          </span>
        </button>
        {other && <div className="tb-t" style={{ color: GOLD }}>You're searching for {q === "blitz" ? "Blitz" : "Control"}. Cancel that first.</div>}
        <div className="flex justify-center tb-t" style={{ gap: 6 * P, color: UI.dim }}>
          <span><span className="tb-b" style={{ color: UI.text }}>{count("playing")}</span> in game</span>
          <span><span className="tb-b" style={{ color: UI.text }}>{count("queueing")}</span> searching</span>
        </div>
        <div className="tb-t" style={{ color: UI.dim, opacity: 0.7 }}>You can leave this screen while you search.</div>
      </div>
    </InlineFrame>
  );
}

/** Over the menu while you search: how long, and back to the lobby. */
function QueuePill({ onOpen }) {
  const P = usePx();
  const q = useQueueMode(), found = useQueueFound();
  const now = useTick(500, !!q);
  if (!q && !found) return null;
  return (
    <button onClick={onOpen} className="absolute tb-t tb-pulse" style={{ top: `calc(env(safe-area-inset-top, 0px) + ${4 * P}px)`, left: "50%", transform: "translateX(-50%)", zIndex: 30,
      padding: `${2 * P}px ${5 * P}px`, ...skFill(MODE_INK.ranked), color: UI.text }}>
      {found ? "MATCH FOUND" : `SEARCHING ${q === "blitz" ? "BLITZ" : "CONTROL"} · ${fmtWait(now - qstore.since)}`}
    </button>
  );
}

/* ============================================================
   COUNTDOWN — 3, 2, 1 before every game, in bold type
   ============================================================ */
let wipeDoneAt = 0; // when the wave on screen (if any) will have rolled away
/** When a game started now should say GO: three seconds after any wave has passed. */
const goTime = (ms = 3000) => Math.max(performance.now(), wipeDoneAt - 250) + ms;
function Countdown({ goAt, block = true }) {
  const [now, setNow] = useState(() => performance.now());
  useEffect(() => {
    let raf;
    const f = () => { const t = performance.now(); setNow(t); if (t < goAt + 700) raf = requestAnimationFrame(f); };
    raf = requestAnimationFrame(f);
    return () => cancelAnimationFrame(raf);
  }, [goAt]);
  const left = goAt - now;
  const waiting = left > 0;
  // Nothing moves until GO.
  useEffect(() => {
    if (!waiting || !block) return undefined;
    const stop = (e) => { if (e.key !== "Escape") { e.stopPropagation(); e.preventDefault(); } };
    window.addEventListener("keydown", stop, true);
    return () => window.removeEventListener("keydown", stop, true);
  }, [waiting, block]);
  const n = Math.ceil(left / 1000);
  useEffect(() => { if (n >= 1 && n <= 3) sfx.rotate(1); else if (n === 0) sfx.pick(); }, [n]);
  if (left < -600) return null;
  return (
    <div className="fixed inset-0 flex items-center justify-center" style={{ zIndex: 55, pointerEvents: waiting && block ? "all" : "none" }}
      onPointerDown={(e) => { if (waiting) { e.stopPropagation(); e.preventDefault(); } }}>
      {left <= 3000 && (
        <span key={n} className="tb-dive" style={{
          fontFamily: '"Silkscreen", ui-monospace, monospace', fontWeight: 700, fontSize: "calc(var(--p) * 48)", lineHeight: 1,
          color: n > 0 ? "var(--tb-text)" : GOLD, textShadow: "calc(var(--p) * 2) calc(var(--p) * 2) 0 rgba(0,0,0,.45)",
        }}>{n > 0 ? n : "GO"}</span>
      )}
    </div>
  );
}

/* ============================================================
   MATCH FOUND — a ping, the screen goes white, the tide; the two of
   you either side of a wave; it parts on the board; 3, 2, 1.
   ============================================================ */
const INTRO = { ping: 1000, show: 3000, part: 600, count: 3000 };
function VersusIntro({ intro, wipe, onScreen, onDone }) {
  const P = usePx();
  const [phase, setPhase] = useState("ping"); // ping → white → show → part → count
  const [profileOf, setProfileOf] = useState(null);
  useEffect(() => {
    sfx.sonar();
    const ts = [];
    ts.push(setTimeout(() => {
      setPhase("white");
      wipe(() => { onScreen(); setPhase("show"); ts.push(setTimeout(() => setPhase("part"), INTRO.show)); ts.push(setTimeout(() => setPhase("count"), INTRO.show + INTRO.part)); });
    }, INTRO.ping));
    return () => ts.forEach(clearTimeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const goAt = intro.goAt;
  useEffect(() => {
    if (phase !== "count") return undefined;
    const t = setTimeout(onDone, Math.max(0, goAt - performance.now()) + 700);
    return () => clearTimeout(t);
  }, [phase, goAt, onDone]);
  const side = (p, right) => (
    <div className="flex flex-col items-center" style={{ gap: 3 * P }}>
      <button onClick={() => setProfileOf(p.name)} aria-label={`${p.name}'s profile`} className="tb-dive" style={{ animationDelay: right ? "180ms" : "0ms" }}>
        <Avatar name={p.name} size={46 * P} ring={right ? "var(--tb-rival)" : "var(--tb-you)"} />
      </button>
      <span style={{ fontFamily: '"Silkscreen", monospace', fontWeight: 700, fontSize: "calc(var(--p) * 14)", color: "#1d1b33" }}>{p.name}</span>
      <span className="tb-t tb-b" style={{ color: p.rank ? p.rank.color : "#5b587a", textShadow: "0 0 0 #000" }}>
        {p.placed && p.rank ? `${p.rank.name} · ` : ""}{p.rating ?? "—"}
      </span>
    </div>
  );
  const parting = phase === "part" || phase === "count";
  const half = (which) => ({
    position: "absolute", inset: 0, background: "#F4F6FB",
    clipPath: which === "a" ? "polygon(0 0, 100% 0, 100% 38%, 0 62%)" : "polygon(0 62%, 100% 38%, 100% 100%, 0 100%)",
    transform: parting ? (which === "a" ? "translateY(-70%)" : "translateY(70%)") : "none",
    transition: `transform ${INTRO.part}ms cubic-bezier(.6,0,.4,1)`,
  });
  return (
    <>
      {phase === "white" && <div className="fixed inset-0 tb-fade" style={{ zIndex: 58, background: "#F4F6FB" }} />}
      {(phase === "show" || phase === "part") && (
        <div className="fixed inset-0 font-mono" style={{ zIndex: 57, overflow: "hidden" }}>
          <div style={half("a")}>
            <div className="absolute flex items-center justify-center" style={{ left: 0, top: 0, width: "60%", height: "52%" }}>{side(intro.me, false)}</div>
          </div>
          <div style={half("b")}>
            <div className="absolute flex items-center justify-center" style={{ right: 0, bottom: 0, width: "60%", height: "52%" }}>{side(intro.opp, true)}</div>
          </div>
          {/* The wave slashing between you. */}
          <svg className="absolute inset-0 w-full h-full pointer-events-none" viewBox="0 0 100 100" preserveAspectRatio="none"
            style={{ opacity: parting ? 0 : 1, transition: `opacity ${INTRO.part}ms`, shapeRendering: "crispEdges" }}>
            <defs>
              <linearGradient id="vsSea" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0" stopColor="var(--tb-you)" /><stop offset=".5" stopColor="var(--tb-special)" /><stop offset="1" stopColor="var(--tb-rival)" />
              </linearGradient>
            </defs>
            <path className="tb-vswave" fill="url(#vsSea)"
              d="M-10 63 Q 5 58 15 60 T 40 54 T 65 48 T 90 41 T 115 36 L 115 32 Q 100 36 90 35 T 65 42 T 40 48 T 15 54 T -10 58 Z" />
            <path className="tb-vswave2" fill="rgba(255,255,255,.75)"
              d="M-10 60 Q 5 56 15 57 T 40 51 T 65 45 T 90 38 T 115 33 L 115 34 Q 100 37 90 37 T 65 44 T 40 50 T 15 56 T -10 61 Z" />
          </svg>
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none" style={{ opacity: parting ? 0 : 1, transition: "opacity 200ms" }}>
            <span style={{ fontFamily: '"Silkscreen", monospace', fontWeight: 700, fontSize: "calc(var(--p) * 22)", color: "#fff", textShadow: "calc(var(--p) * 1.5) calc(var(--p) * 1.5) 0 rgba(29,27,51,.6)", transform: "rotate(-12deg)" }}>VS</span>
          </div>
          <div className="absolute inset-x-0 flex justify-center tb-t" style={{ bottom: `calc(env(safe-area-inset-bottom, 0px) + ${4 * P}px)`, color: "#5b587a" }}>
            {intro.mode === "blitz" ? "RANKED BLITZ" : "RANKED CONTROL"} · click a player to see their profile
          </div>
        </div>
      )}
      {phase === "count" && <Countdown goAt={goAt} />}
      {profileOf && <div style={{ position: "fixed", inset: 0, zIndex: 59 }}><ProfilePopup name={profileOf} onClose={() => setProfileOf(null)} /></div>}
    </>
  );
}

/* ============================================================
   DIFFICULTY
   ============================================================ */
function Difficulty({ onStart, onBack, colors }) {
  const P = usePx();
  const [lv, setLv] = useState(DEFAULT_LEVEL);
  return (
    <div className="tb-screen tb-safe w-full flex items-center justify-center px-5 font-mono" style={{ color: UI.text }}>
      <Scaled className="w-full" style={{ maxWidth: 330 }}>
        <button onClick={onBack} className="flex items-center gap-1 tb-t mb-6 py-2" style={{ color: UI.dim }}>
          <ChevronLeft size={13} /> MENU
        </button>
        <div className="flex items-baseline justify-between mb-3">
          <span className="tb-t" style={{ color: UI.dim }}>AI</span>
          <span className="tb-t tb-b tabular-nums" style={{ color: colors.rival, textShadow: `${P}px ${P}px 0 rgba(0,0,0,.45)` }}>{lv}</span>
        </div>
        <PixelSlider min={1} max={LEVELS.length} value={lv} onChange={setLv} ink={colors.rival} label="AI strength" className="w-full mb-2" />
        <div className="flex justify-between tb-t mb-6" style={{ color: UI.dim, opacity: 0.7 }}>
          <span>1</span><span>{LEVELS.length}</span>
        </div>
        <button onClick={() => onStart(lv)} className="w-full rounded tb-t" style={{ height: 50, ...skFill(UI.text), color: UI.text }}>
          START MATCH
        </button>
      </Scaled>
    </div>
  );
}

/** The FORFEIT bubble (red): asks before ending the match. */
function ForfeitButton({ onConfirm, ranked = false, disabled = false, compact = false }) {
  const [asking, setAsking] = useState(false);
  const d = useBubble(compact);
  return (
    <>
      <Bubble w={d} h={d} label="Forfeit" tint="#DB4F6D" fill={22} onClick={() => setAsking(true)} disabled={disabled}>
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
/* ============================================================
   MARATHON — solo high-score mode (shared/marathon.js)
   ============================================================ */
const M_INKS = ["#7CC7BF", "#EAD6A4", "#B4A3EE", "#E88FB4", "#C18A5E", "#A3D98C", "#6FA8FF", "#F2B880"];
// Board squares remember which piece made them: each piece has its colour.
const M_INK = Object.fromEntries(M_PIECES.map((_, i) => [i, M_INKS[i % M_INKS.length]]));
const localBest = { get: () => Number(store.get("tb:marathonBest")) || 0, set: (n) => store.set("tb:marathonBest", String(n)) };
const cloneMarathon = (s) => ({ ...s, board: s.board.map((r) => r.slice()), hand: s.hand.slice(), bag: s.bag.slice() });

/** A piece drawn small, for the tray (and, at full size, under your finger). */
function MPiece({ id, rot = 0, cell, gap, ink, faint = false }) {
  const p = mShape(id, rot);
  return (
    <div className="relative" style={{ width: p.w * cell + (p.w - 1) * gap, height: p.h * cell + (p.h - 1) * gap, opacity: faint ? 0.35 : 1 }}>
      {p.cells.map(([r, c]) => (
        <div key={`${r},${c}`} className="absolute" style={{ left: c * (cell + gap), top: r * (cell + gap) }}>
          <Ink size={cell} color={ink} />
        </div>
      ))}
    </div>
  );
}

function MarathonGame({ theme, onExit }) {
  useEffect(() => { sky.slow = true; return () => { sky.slow = false; }; }, []);
  const [goAt] = useState(() => goTime()); // 3-2-1 before the first move
  const P = usePx();
  const wipe = useContext(WipeCtx);
  const compact = useCompact();
  const railD = useBubble(compact);
  const [stageRef, stage] = useSize();
  const boardRef = useRef(null);
  // A seed from the server makes the score count on T-Terminal; offline, a local one.
  const [game, setGame] = useState(null);           // { st, seed, official }
  const [sel, setSel] = useState(null);             // hand slot picked up
  const [rots, setRots] = useState([0, 0, 0]);      // how each piece in hand is turned
  const [ptr, setPtr] = useState(null);             // { x, y, touch, drag } while a piece is held
  const [vanish, setVanish] = useState(null);       // cleared squares, animating
  const [flash, setFlash] = useState(null);         // "+120 · COMBO ×3"
  const [levelUp, setLevelUp] = useState(null);     // { level, key }: the LEVEL UP moment
  const [ended, setEnded] = useState(null);         // { reason } once over
  const [showEnd, setShowEnd] = useState(false);
  const [result, setResult] = useState(null);       // the server's reply to our score
  const movesRef = useRef([]);
  const [best, setBest] = useState(() => Math.max(localBest.get(), net.profile?.marathon?.best || 0));

  useEffect(() => {
    let done = false;
    const begin = (seed, official, saved = null) => {
      if (done) return; done = true;
      const st0 = newMarathon(seed);
      // Coming back to a game you left: replay its moves to where you were.
      const moves = saved ? decodeMoves(saved) || [] : [];
      for (const m of moves) if (!mPlace(st0, m[0], m[1], m[2], m[3] ?? 0)) break;
      movesRef.current = moves.slice(0, st0.moves);
      setGame({ st: st0, seed, official, resumedAt: moves.length ? st0.moves : null });
    };
    const canPost = net.status === "online" && net.auth === "authed" && net.profile?.emailVerified;
    if (!canPost) { begin(newMarathonSeed(), false); return; }
    const off = net.on("marathonSeed", (m) => begin(m.seed, true, m.resume ? m.moves : null));
    net.marathonStart();
    const t = setTimeout(() => begin(newMarathonSeed(), false), 2500); // no answer: play offline
    return () => { off(); clearTimeout(t); };
  }, []);
  useEffect(() => net.on("marathonResult", (m) => { setResult(m); if (m.best) setBest((b) => Math.max(b, m.best)); }), []);
  useGameMusic();

  const st = game?.st;
  const over = !!ended;

  // Layout: the board as big as fits, the tray to its right (desktop) or under it (phone).
  const g = Math.max(P, (theme.gap ?? 1) * P);
  // The tray's three boxes together are as long as the board (beside it on
  // a computer, under it on a phone), so the board gets 3/4 of that side.
  const availW = stage.w - 8 * P;
  const availH = stage.h - (TITLE_H + 26) * P - (railD + 6) * P;
  const fitW = compact ? availW : (availW - 4 * P) * 3 / 4;
  const fitH = compact ? (availH - 4 * P) * 3 / 4 : availH;
  const cellArt = Math.max(6, Math.min(18, Math.floor(Math.min((fitW - 6 * g) / M_SIZE, (fitH - 6 * g) / M_SIZE) / P)));
  const cell = cellArt * P;
  const boardW = cell * M_SIZE + g * (M_SIZE - 1);
  const slotPx = Math.floor((boardW - 6 * P) / 3);
  // Tray pieces: half a board square, or less if a five-long piece wouldn't fit its box.
  // Half the board's square (with its gap: a tray piece is exactly half the size of a placed one).
  const trayCell = Math.max(P, Math.min(Math.floor((cell + g) / 2 / P) * P - P, Math.floor((slotPx - 4 * P) / 5 / P) * P));

  // Where the held piece would land: centred under the pointer (lifted above a finger).
  const ghost = useMemo(() => {
    if (!st || sel === null || !ptr || !ptr.rect) return null;
    const rect = ptr.rect;
    const scale = rect.width / boardW || 1;
    const rot = rots[sel];
    const p = mShape(st.hand[sel], rot);
    const lift = ptr.touch ? 3 * cell * scale : 0;
    const x = (ptr.x - rect.left) / scale, y = (ptr.y - lift - rect.top) / scale;
    // Only over the board itself: beside it, nothing is shown (or placed).
    if (x < 0 || y < 0 || x >= boardW || y >= boardW) return null;
    const c0 = Math.floor(x / (cell + g)) - Math.floor((p.w - 1) / 2), r0 = Math.floor(y / (cell + g)) - Math.floor((p.h - 1) / 2);
    return { r: r0, c: c0, ok: mFits(st.board, st.hand[sel], r0, c0, rot), cells: p.cells.map(([dr, dc]) => [r0 + dr, c0 + dc]) };
  }, [st, sel, ptr, cell, g, boardW, rots]);

  const finish = (reason, s) => {
    setEnded({ reason });
    setSel(null); setPtr(null);
    if (s.score > localBest.get()) localBest.set(s.score);
    setBest((b) => Math.max(b, s.score));
    if (game.official) net.marathonEnd(game.seed, encodeMoves(movesRef.current));
    if (movesRef.current.length) replays.save({ kind: "marathon", seed: game.seed, moves: movesRef.current.slice(), date: Date.now(), name: net.profile?.name || "YOU", result: { score: s.score, lines: s.lines } });
    setTimeout(() => wipe(() => setShowEnd(true)), reason === "forfeit" ? 0 : 1100);
  };

  const place = (slot, r, c) => {
    if (!st || over) return false;
    const next = cloneMarathon(st);
    const rot = rots[slot];
    if (!mPlace(next, slot, r, c, rot)) { sfx.illegal(); return false; }
    movesRef.current.push([slot, r, c, rot]);
    setRots((rs) => rs.map((x, i) => (i === slot ? 0 : x))); // the new piece arrives unturned
    const L = next.last;
    sfx.lockIn("place");
    if (L.cleared.length) {
      sfx.reveal({ lines: L.rows.length + L.cols.length });
      setVanish({ cleared: L.cleared, key: next.moves });
      setTimeout(() => setVanish((v) => (v && v.key === next.moves ? null : v)), 700);
      setFlash({ text: `+${L.points}${L.combo > 1 ? ` · COMBO ×${L.combo}` : ""}`, key: next.moves });
      setTimeout(() => setFlash((f) => (f && f.key === next.moves ? null : f)), 1300);
    }
    const lv = mLevelOf(next.lines);
    if (lv > mLevelOf(st.lines)) {
      setTimeout(() => sfx.levelUp(), 350);
      setLevelUp({ level: lv, key: next.moves });
      setTimeout(() => setLevelUp((u) => (u && u.key === next.moves ? null : u)), 1900);
    }
    setGame({ ...game, st: next });
    setSel(null); setPtr(null);
    if (next.over) finish("stuck", next);
    else if (game.official && next.moves % 5 === 0) net.marathonSave(game.seed, encodeMoves(movesRef.current)); // quietly, in case the tab closes
    return true;
  };

  // Holding a piece: follow the pointer anywhere on screen; let go over the board to place it.
  useEffect(() => {
    if (sel === null) return;
    const move = (e) => {
      const rect = boardRef.current?.getBoundingClientRect() || null;
      // It's a drag only while the button (or finger) is still down after picking up.
      // Only the finger holding the piece moves it: a second finger (turning) doesn't.
      setPtr((p) => (p && p.id != null && p.down !== false && p.touch && e.pointerId !== p.id ? p : { ...p, x: e.clientX, y: e.clientY, rect, touch: e.pointerType !== "mouse", drag: p?.drag || (!!p?.down && Math.hypot(e.clientX - p.sx, e.clientY - p.sy) > 6), sx: p?.sx ?? e.clientX, sy: p?.sy ?? e.clientY }));
    };
    window.addEventListener("pointermove", move);
    return () => window.removeEventListener("pointermove", move);
  }, [sel]);
  const release = (e) => {
    if (sel === null || !ptr) return;
    // Lifting the turning finger mustn't drop the piece the other one holds.
    if (ptr.touch && ptr.id != null && e && e.pointerId !== ptr.id) return;
    if (ptr.drag && ghost) { if (!place(sel, ghost.r, ghost.c)) { if (ptr.touch) { setSel(null); setPtr(null); } else setPtr((p) => ({ ...p, down: false, drag: false })); } }
    else if (ptr.drag) { if (ptr.touch) { setSel(null); setPtr(null); } else setPtr((p) => ({ ...p, down: false, drag: false })); }
    else setPtr((p) => (p ? { ...p, down: false } : p));
  };
  useEffect(() => {
    if (sel === null) return;
    window.addEventListener("pointerup", release);
    return () => window.removeEventListener("pointerup", release);
  });

  // Turning: R / Q / E, the turn button, or (with a mouse) clicking the piece
  // you already picked. On a touch screen only the turn button turns: a
  // second tap on a piece is usually the start of a drag, not a request.
  const lastSlot = useRef(0); // the piece the turn button turns when none is held
  const turn = (slot, dir = 1) => {
    if (slot === null || slot === undefined) return;
    setRots((rs) => rs.map((x, i) => (i === slot ? (x + dir + 4) % 4 : x)));
    sfx.rotate(dir);
  };
  // Keys: 1–3 pick a piece; your rotate keys (Q / E by default) and R turn it;
  // your lock-in key (Space) drops it where the shadow is; Esc puts it down.
  useEffect(() => {
    const onKey = (e) => {
      const t = e.target;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA")) return;
      if (["1", "2", "3"].includes(e.key) && st && !over) { const i = Number(e.key) - 1; lastSlot.current = i; setSel(i); sfx.pick(); setPtr((p) => p || null); }
      const a = actionFor(e.key);
      const dir = a === "ccw" ? -1 : a === "cw" || e.key === "r" || e.key === "R" ? 1 : 0;
      if (dir && st && !over) { e.preventDefault(); turn(sel ?? 0, dir); if (sel === null) setSel(0); }
      if (a === "commit" && st && !over && sel !== null && ghost) { e.preventDefault(); place(sel, ghost.r, ghost.c); }
      if (e.key === "Escape") { setSel(null); setPtr(null); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const pickUp = (slot, e) => {
    if (!st || over) return;
    e.preventDefault();
    lastSlot.current = slot;
    if (sel === slot && e.pointerType === "mouse" && !(ptr && ptr.drag)) { turn(slot); setPtr({ id: e.pointerId, x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, rect: boardRef.current?.getBoundingClientRect() || null, touch: false, drag: false }); return; }
    setSel(slot);
    sfx.pick();
    setPtr({ id: e.pointerId, x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, rect: boardRef.current?.getBoundingClientRect() || null, touch: e.pointerType !== "mouse", drag: false, down: true });
  };
  // Leave: signed in, the game is kept on the server to come back to;
  // otherwise it's gone, so ask first.
  const [confirmLeave, setConfirmLeave] = useState(false);
  const leave = () => {
    if (!st || over) return;
    if (game.official) {
      if (st.moves) net.marathonSave(game.seed, encodeMoves(movesRef.current));
      sfx.back();
      onExit();
    } else setConfirmLeave(true);
  };
  const onBoardDown = (e) => {
    if (sel === null || !ghost) return;
    if (ptr && !ptr.drag) { e.preventDefault(); place(sel, ghost.r, ghost.c); }
  };

  if (showEnd && st) {
    const newBest = st.score > 0 && st.score >= best && (!result || result.newBest !== false);
    const note = [
      `${st.lines} lines · level ${mLevelOf(st.lines)}`,
      game.official ? (result ? (result.saved ? "saved to T-Terminal" : result.error || "not saved") : "saving…") : "log in to post high scores",
    ].join(" · ");
    return (
      <EndScreen verdict={newBest ? "NEW BEST" : "GAME OVER"} ink={newBest ? GOLD : UI.text} note={note}
        left={{ name: "SCORE", score: st.score, ink: "var(--tb-you)" }} right={{ name: "BEST", score: Math.max(best, st.score), ink: GOLD }}
        actions={[{ label: "MENU", onClick: () => onExit() }, { label: "AGAIN", onClick: () => onExit("again"), main: true }]} />
    );
  }

  // Only squares actually on the board: one off the edge mustn't reappear on the far side.
  const ghostKeys = new Set((ghost?.cells || []).filter(([r, c]) => r >= 0 && c >= 0 && r < M_SIZE && c < M_SIZE).map(([r, c]) => r * M_SIZE + c));
  const tray = st && (
    <div className={`flex ${compact ? "flex-row" : "flex-col"} items-center`} style={{ gap: 3 * P, ...(compact ? { width: boardW, justifyContent: "center" } : null) }}>
      <div className={`flex ${compact ? "flex-row" : "flex-col"}`} style={{ gap: 3 * P }}>
        {st.hand.map((id, i) => {
          const can = mFitsAnywhere(st.board, id);
          const held = sel === i;
          return (
            <button key={i} aria-label={`Piece ${i + 1}${can ? "" : " (doesn't fit)"}`} onPointerDown={(e) => pickUp(i, e)}
              className="relative flex items-center justify-center" style={{ width: slotPx, height: slotPx, touchAction: "none", ...glass(held ? UI.text : UI.line), opacity: over ? 0.5 : 1 }}>
              <span style={{ opacity: held && ptr?.drag ? 0.45 : 1, display: "flex" }}><MPiece id={id} rot={rots[i]} cell={trayCell} gap={P} ink={M_INK[id]} faint={!can} /></span>
              {!compact && <span className="absolute tb-t" style={{ left: 2 * P, top: P, color: UI.dim, opacity: 0.6 }}>{i + 1}</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
  // The turn button acts the moment it's pressed (not on release), so a
  // second finger can turn the piece the first one is dragging.
  const onTurnPress = (e) => {
    e.preventDefault(); e.stopPropagation();
    if (over || !st) return;
    const slot = sel ?? lastSlot.current;
    if (sel === null) setSel(slot);
    turn(slot);
  };
  // Phone: a big TURN pad across the bottom, for the thumb that isn't dragging.
  const turnPad = st && compact && (
    <button aria-label="Turn piece" onPointerDown={onTurnPress} disabled={over}
      className="tb-t flex items-center justify-center gap-2 select-none disabled:opacity-35"
      style={{ flex: 1, height: railD * P * 1.5, touchAction: "none", ...skFill(UI.text), color: UI.text }}>
      <RotateCw /> TURN
    </button>
  );
  // Turn, leave and forfeit: a row at the bottom right, under the board.
  const controls = st && (
    <div className="flex items-center shrink-0" style={{ gap: 3 * P }}>
      {!compact && <Bubble w={railD} h={railD} label="Turn piece (R)" onPointerDown={onTurnPress} disabled={over}><RotateCw /></Bubble>}
      <Bubble w={railD} h={railD} label={game?.official ? "Leave (saved)" : "Leave"} onClick={leave} disabled={over}><LogOut /></Bubble>
      <ForfeitButton compact={compact} disabled={over} onConfirm={() => { sfx.forfeit(); finish("forfeit", st); }} />
    </div>
  );

  return (
    <div className="tb-screen tb-safe w-full flex flex-col font-mono select-none" style={{ color: UI.text, ...(compact ? { touchAction: "none" } : null) }}>
      <Countdown goAt={goAt} />
      <div className="tb-col relative flex-1 min-h-0 flex flex-col w-full mx-auto px-3" style={{ maxWidth: PHONE_W }}>
        <div ref={stageRef} className="flex-1 min-h-0 flex flex-col items-center">
          <div style={{ flex: 1, minHeight: 4 * P }} />
          <GameTitle mode="MARATHON" />
          <div style={{ flex: 1, minHeight: 4 * P }} />
          {st && (
            <div className="flex flex-col items-center" style={{ gap: 3 * P }}>
              {/* The high score on top, like the scores in a match. */}
              <div className="flex items-end justify-between tb-t" style={{ width: compact ? boardW : boardW + slotPx + 3 * P, gap: 3 * P }}>
                <div className="flex flex-col"><span style={{ color: UI.dim }}>SCORE</span><span className="tb-b tabular-nums" style={{ color: "var(--tb-you)" }}>{st.score.toLocaleString("en-US")}</span></div>
                <div className="flex flex-col items-center">
                  <span style={{ color: UI.text }}>LEVEL {mLevelOf(st.lines)}{mLevelOf(st.lines) > 1 && <span style={{ color: GOLD }}> ×{(1 + M_TUNING.levelBonus * (mLevelOf(st.lines) - 1)).toFixed(1)}</span>}</span>
                  {/* Always a near goal in view. */}
                  <span className="tabular-nums" style={{ color: UI.dim }}>NEXT IN {M_TUNING.levelLines - (st.lines % M_TUNING.levelLines)} {M_TUNING.levelLines - (st.lines % M_TUNING.levelLines) === 1 ? "LINE" : "LINES"}</span>
                </div>
                <div className="flex flex-col items-end"><span style={{ color: UI.dim }}>BEST</span><span className="tb-b tabular-nums" style={{ color: GOLD }}>{Math.max(best, st.score).toLocaleString("en-US")}</span></div>
              </div>
              <div className={`flex ${compact ? "flex-col" : "flex-row"} items-start`} style={{ gap: 4 * P }}>
                <div className="relative" style={{ width: boardW, height: boardW }}>
                  <div ref={boardRef} onPointerDown={onBoardDown} style={{ display: "grid", gridTemplateColumns: `repeat(${M_SIZE}, ${cell}px)`, gap: g, touchAction: "none" }}>
                    {st.board.map((row, r) => row.map((v, c) => {
                      const k = r * M_SIZE + c, gh = ghostKeys.has(k);
                      return (
                        <div key={k} className={v !== null ? "tb-drop" : undefined} style={{ position: "relative", width: cell, height: cell, clipPath: Math.round(cell / P) >= 9 ? CLIP : CLIP1, ...(v === null ? GLASS : null) }}>
                          {v !== null && <Ink size={cell} color={M_INK[v]} />}
                          {gh && v === null && <div className="absolute inset-0" style={{ opacity: ghost.ok ? 0.55 : 0.6 }}><Ink size={cell} color={ghost.ok ? M_INK[st.hand[sel]] : UI.bad} stroke="ghost" /></div>}
                          {/* Over a placed block: dim the block and draw the ghost on it in red, so the
                              whole shape shows and it's clear it can't go there. */}
                          {gh && v !== null && (
                            <>
                              <div className="absolute inset-0" style={{ background: "rgba(8,6,16,.62)" }} />
                              <div className="absolute inset-0" style={{ opacity: 0.9 }}><Ink size={cell} color={UI.bad} stroke="ghost" /></div>
                            </>
                          )}
                        </div>
                      );
                    }))}
                  </div>
                  {vanish && <VanishLayer key={vanish.key} cleared={vanish.cleared} cell={cell} gap={g} ink={M_INK} />}
                  {flash && (
                    // Phones have the tray right under the board, so the points pop up on the board instead.
                    <div key={flash.key} className="absolute flex pointer-events-none tb-rise"
                      style={compact ? { left: 0, right: 0, bottom: 4 * P, justifyContent: "center", zIndex: 4 } : { left: 0, bottom: -11 * P, zIndex: 4 }}>
                      <span className="tb-t tb-b" style={{ color: GOLD, textShadow: `${P}px ${P}px 0 rgba(0,0,0,.6)`,
                        ...(compact ? { padding: `${P}px ${3 * P}px`, background: "color-mix(in srgb, var(--tb-panel-solid) 82%, transparent)", clipPath: CLIP1 } : null) }}>{flash.text}</span>
                    </div>
                  )}
                  {levelUp && (
                    // LEVEL UP: the board lights up and the new level drops in.
                    <div key={levelUp.key} className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none tb-fade" style={{ zIndex: 5,
                      background: "radial-gradient(closest-side, color-mix(in srgb, var(--tb-special) 30%, transparent), transparent)" }}>
                      <div className="flex flex-col items-center tb-rise" style={{ gap: 2 * P, padding: `${5 * P}px ${7 * P}px`, clipPath: CLIP,
                        background: "color-mix(in srgb, var(--tb-panel-solid) 88%, transparent)", boxShadow: `inset 0 0 0 ${P}px var(--tb-special)` }}>
                        <PixelWord text="LEVEL UP" from="var(--tb-text)" to="var(--tb-special)" />
                        <span className="tb-t" style={{ color: GOLD }}>LEVEL {levelUp.level} · CLEARS ×{(1 + M_TUNING.levelBonus * (levelUp.level - 1)).toFixed(1)}</span>
                      </div>
                    </div>
                  )}
                  {/* The streak steps aside while a clear's points show: on a phone they'd overlap. */}
                  {st.combo > 1 && !over && !flash && (
                    <div className="absolute tb-t" style={{ right: 0, bottom: -11 * P, color: GOLD, opacity: 0.8 }}>STREAK ×{st.combo}</div>
                  )}
                </div>
                {tray}
              </div>
              {compact ? (
                <div className="flex flex-col" style={{ width: boardW, gap: 3 * P, marginTop: 2 * P }}>
                  {over && <div className="tb-t" style={{ color: UI.dim }}>NO ROOM LEFT</div>}
                  <div className="flex items-center" style={{ gap: 3 * P }}>{turnPad}{controls}</div>
                </div>
              ) : (
                <div className="flex items-center justify-between" style={{ width: boardW + slotPx + 3 * P, gap: 4 * P, marginTop: 2 * P }}>
                  <div className="tb-t min-w-0" style={{ color: UI.dim }}>{over ? "NO ROOM LEFT" : ""}</div>
                  {controls}
                </div>
              )}
            </div>
          )}
          <div style={{ flex: 2, minHeight: 4 * P }} />
        </div>
      </div>
      {confirmLeave && (
        <Popup title="LEAVE?" onClose={() => setConfirmLeave(false)} maxW={330}>
          <div className="pt-4 pb-1">
            <div className="tb-t mb-5" style={{ color: UI.dim }}>Only signed-in games are saved to come back to. This one will be lost.</div>
            <div className="flex gap-2">
              <button onClick={() => setConfirmLeave(false)} className="flex-1 tb-t" style={{ height: 44, ...sk(UI.line), color: UI.dim }}>KEEP PLAYING</button>
              <button onClick={() => { setConfirmLeave(false); onExit(); }} className="flex-1 tb-t" style={{ height: 44, ...skFill(UI.text), color: UI.bad }}>LEAVE</button>
            </div>
          </div>
        </Popup>
      )}
      {game?.resumedAt && st && st.moves === game.resumedAt && !over && (
        <div className="fixed left-1/2 tb-t tb-fade pointer-events-none" style={{ top: "calc(env(safe-area-inset-top, 0px) + 12px)", transform: "translateX(-50%)", color: GOLD, zIndex: 20 }}>
          WELCOME BACK · RESUMED AT {st.score.toLocaleString("en-US")}
        </div>
      )}
      {/* The piece in hand follows the pointer while dragging. */}
      {st && sel !== null && ptr?.drag && (
        <div className="fixed pointer-events-none" style={{ left: ptr.x, top: ptr.y - (ptr.touch ? 3 * cell : 0), transform: "translate(-50%, -50%)", zIndex: 50, opacity: ghost?.ok ? 0.35 : 0.85 }}>
          <MPiece id={st.hand[sel]} rot={rots[sel]} cell={cell} gap={g} ink={M_INK[st.hand[sel]]} />
        </div>
      )}
    </div>
  );
}

/* ============================================================
   SPRINT — 40 lines, keyboard only, against the clock
   ============================================================ */
const S_INK = ["#6FD3E0", "#EAD6A4", "#B4A3EE", "#A3D98C", "#E88FB4", "#6FA8FF", "#F2B880"]; // I O T S Z J L
// Tetromino colours plus junk (grey), indexed by any piece id (for the clear animation).
const S_INK_ALL = new Proxy(S_INK, { get: (t, k) => (Number(k) >= 100 ? "#8E8A99" : t[k]) });
const sprintBest = { get: () => Number(store.get("tb:sprintBest")) || 0, set: (ms) => store.set("tb:sprintBest", String(ms)) };
const comboMultOf = (c) => { const m = sComboMult(c); return Number.isInteger(m) ? m : m.toFixed(1); };
const ultraBest = { get: () => Number(store.get("tb:ultraBest")) || 0, set: (n) => store.set("tb:ultraBest", String(n)) };
const fmtClock = (ms) => {
  const m = Math.floor(ms / 60000), s = Math.floor((ms % 60000) / 1000), cs = Math.floor((ms % 1000) / 10);
  return `${m}:${String(s).padStart(2, "0")}.${String(cs).padStart(2, "0")}`;
};

/** A tetromino in its spawn shape, small: for the hand and the forecast. */
function SPiece({ id, cell, gap }) {
  const s = sShapeOf(id, 0);
  return (
    <div className="relative" style={{ width: s.w * cell + (s.w - 1) * gap, height: s.h * cell + (s.h - 1) * gap }}>
      {s.cells.map(([r, c]) => (
        <div key={`${r},${c}`} className="absolute" style={{ left: c * (cell + gap), top: r * (cell + gap) }}><Ink size={cell} color={S_INK_ALL[id]} /></div>
      ))}
    </div>
  );
}

/** Sprint's controls, edited in the game: click an action, press its new key. */
const bindLabel = (k) => (!k ? "—" : mouseLabel(k) || keyLabel(k));

/** Sprint and Ultra controls, in Settings: click an action, then press a key or a mouse button. */
function SprintControlsSection() {
  const P = usePx();
  const keys = useSyncExternalStore(subscribeSprintKeys, getSprintKeys);
  const [listening, setListening] = useState(null);
  useEffect(() => {
    if (!listening) return undefined;
    const bind = (k) => { setSprintKey(listening, k); setListening(null); };
    const onKey = (e) => { e.preventDefault(); e.stopPropagation(); if (e.key !== "Tab") bind(e.key); };
    // Mouse buttons bind too; the click that started listening has already finished.
    const onMouse = (e) => { e.preventDefault(); e.stopPropagation(); bind(mouseName(e.button)); };
    const noMenu = (e) => e.preventDefault();
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("mousedown", onMouse, true);
    window.addEventListener("contextmenu", noMenu, true);
    return () => { window.removeEventListener("keydown", onKey, true); window.removeEventListener("mousedown", onMouse, true); window.removeEventListener("contextmenu", noMenu, true); };
  }, [listening]);
  return (
    <div className="flex flex-col" style={{ gap: P }}>
      <div className="flex items-center justify-between">
        <span className="tb-t">SPRINT / ULTRA</span>
        <button onClick={() => { resetSprintKeys(); setListening(null); }} className="tb-t py-1" style={{ color: UI.dim }}>RESET</button>
      </div>
      <div className="grid grid-cols-2 gap-x-4">
        {SPRINT_ACTIONS.map((a) => {
          const on = listening === a.id;
          return (
            <div key={a.id} className="flex items-center justify-between gap-2 py-1" style={RULE_BELOW}>
              <span className="tb-t" style={{ color: UI.dim }}>{a.label}</span>
              <button onClick={() => setListening(on ? null : a.id)} className={`tb-t ${on ? "tb-pulse" : ""}`} aria-label={`${a.label}: ${keys[a.id] ? bindLabel(keys[a.id]) : "unbound"}`}
                style={{ minWidth: 52, height: 28, padding: "0 6px", ...(on ? skFill(UI.text) : sk(UI.line)), color: keys[a.id] ? UI.text : UI.bad }}>
                {on ? "…" : bindLabel(keys[a.id])}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** A copy of a Sprint game to change (the bag's random source is shared: it only moves forward). */
const cloneSprint = (st) => ({ ...st, board: st.board.map((row) => row.slice()), hand: st.hand.slice(), bag: st.bag.slice() });
// A piece is always in play: the first of your two, in the middle, from the start.
// A run: its seed (from the server when you're signed in, so it can be ranked) and every placement, timed.
const freshSprint = (ultra = false, seed = newSprintSeed(), official = false) => {
  const st = newSprint(seed, ultra ? Infinity : S_GOAL);
  return { st, seed, official, moves: [], act: sSpawn(st, 0), startAt: 0, endAt: 0, result: null, newBest: false, vanish: null, pop: null };
};
const canRank = () => net.status === "online" && net.auth === "authed" && !!net.profile?.emailVerified;

/** SPRINT (40 lines, fastest time) and ULTRA (2 minutes, highest score): same board, same controls. */
function SprintGame({ onExit, ultra = false }) {
  useGameMusic();
  useEffect(() => { sky.slow = true; return () => { sky.slow = false; }; }, []);
  const P = usePx();
  const [stageRef, stage] = useSize();
  const keys = useSyncExternalStore(subscribeSprintKeys, getSprintKeys);
  // In on the tide, no countdown: the clock starts on your first move.
  const [r, setRun] = useState(() => freshSprint(ultra));
  // Key handlers read and write this copy at once, so two presses in one frame both count.
  const live = useRef(r);
  const commit = useCallback((next) => { live.current = next; setRun(next); }, []);
  const record = ultra ? ultraBest : sprintBest;
  const [best, setBest] = useState(() => record.get());
  const [clock, setClock] = useState(0);
  // A finished run: the wave, then the end screen (as after a Control match).
  const wipe = useContext(WipeCtx);
  const [showEnd, setShowEnd] = useState(false);

  // The clock: ticks every frame while a run is going.
  useEffect(() => {
    let raf;
    const loop = () => {
      raf = requestAnimationFrame(loop);
      const c = live.current, t = performance.now();
      if (!c.startAt && !c.result && c.goAt && t >= c.goAt) { commit({ ...c, startAt: c.goAt }); return; }
      if (c.startAt && !c.endAt) setClock(t);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [commit]);

  const mode = ultra ? "ultra" : "sprint";
  const [ranked, setRanked] = useState(null); // the server's answer about the last run
  const askSeed = useCallback(() => { if (canRank()) net.soloStart(mode); }, [mode]);
  // A seed from the server replaces the local one, as long as the run hasn't started.
  useEffect(() => net.on("soloSeed", (m) => {
    const c = live.current;
    if (m.mode === mode && !c.startAt && !c.result) commit({ ...freshSprint(ultra, m.seed, true), goAt: c.goAt });
  }), [mode, ultra, commit]);
  useEffect(() => net.on("soloResult", (m) => setRanked(m)), []);
  useEffect(() => { askSeed(); }, [askSeed]);
  const retry = useCallback(() => { setRanked(null); setShowEnd(false); commit(freshSprint(ultra)); askSeed(); sfx.pick(); }, [commit, ultra, askSeed]);
  const finish = useCallback((cur, result) => {
    const endAt = ultra && result === "time" ? cur.startAt + S_ULTRA_MS : performance.now();
    let newBest = false;
    if (!ultra && result === "done") {
      const ms = Math.round(endAt - cur.startAt);
      const pb = sprintBest.get();
      if (!pb || ms < pb) { sprintBest.set(ms); setBest(ms); newBest = true; }
    }
    // Ultra: the score counts when time runs out or the board fills, not on a forfeit.
    if (ultra && result !== "forfeit" && cur.st.score > ultraBest.get()) { ultraBest.set(cur.st.score); setBest(cur.st.score); newBest = true; }
    if (result === "forfeit") sfx.forfeit(); else sfx.levelUp();
    // A finished run is kept as a replay here, and sent to be ranked if it can be.
    const counts = ultra ? result !== "forfeit" : result === "done";
    if (counts && cur.moves.length) {
      replays.save({ kind: mode, seed: cur.seed, moves: cur.moves, date: Date.now(), name: net.profile?.name || "YOU",
        result: ultra ? { score: cur.st.score, lines: cur.st.lines } : { ms: Math.round(endAt - cur.startAt), pieces: cur.st.pieces } });
      if (cur.official) net.soloEnd(mode, cur.seed, cur.moves);
    }
    commit({ ...cur, endAt, result, newBest, act: null });
  }, [commit, ultra, mode]);
  useEffect(() => {
    if (!r.result) return undefined;
    const t = setTimeout(() => wipe(() => { if (live.current.result) setShowEnd(true); }), r.result === "forfeit" ? 0 : 600);
    return () => clearTimeout(t);
  }, [r.result, wipe]);
  // Ultra: two minutes, then it's over.
  useEffect(() => {
    if (!ultra || !r.startAt || r.endAt) return undefined;
    const t = setTimeout(() => { const c = live.current; if (c.startAt && !c.endAt) finish(c, "time"); }, Math.max(0, r.startAt + S_ULTRA_MS - performance.now()));
    return () => clearTimeout(t);
  }, [ultra, r.startAt, r.endAt, finish]);

  // The piece follows the cursor, always wholly on the board, as near the
  // cursor as it can be (past an edge it sits against that edge).
  const boardEl = useRef(null);
  const mouse = useRef(null); // the last cursor position, { x, y }
  const toMouse = useCallback((a) => {
    const el = boardEl.current, m = mouse.current;
    if (!a || !el || !m) return a;
    const rect = el.getBoundingClientRect();
    const step = rect.width / S_SIZE;
    return sAt(a, (m.y - rect.top) / step, (m.x - rect.left) / step);
  }, []);
  // Places the piece in play; the same slot comes straight back with the forecast piece, at the cursor.
  const placeNow = useCallback(() => {
    let cur = live.current;
    if (cur.result || !cur.act) return;
    if (!cur.startAt) cur = { ...cur, startAt: performance.now() };
    if (!sCanPlace(cur.st, cur.act)) { sfx.illegal(); return; }
    const st = cloneSprint(cur.st);
    const slot = cur.act.slot;
    cur = { ...cur, moves: [...cur.moves, sRecordMove(cur.act, performance.now() - cur.startAt)] };
    sPlace(st, cur.act);
    const L = st.last;
    sfx.lockIn("place");
    let vanish = cur.vanish, pop = cur.pop;
    if (L.lines) {
      sfx.reveal({ lines: L.lines });
      vanish = { cleared: L.cleared, key: st.pieces };
      if (ultra) pop = { text: `+${L.points.toLocaleString("en-US")}${L.combo > 1 ? ` · COMBO ×${comboMultOf(L.combo)}` : ""}`, key: st.pieces };
      setTimeout(() => { const c = live.current; if (c.vanish && c.vanish.key === st.pieces) commit({ ...c, vanish: null, pop: c.pop && c.pop.key === st.pieces ? null : c.pop }); }, ultra ? 1100 : 650);
    }
    const act = st.over ? null : toMouse(sSpawn(st, slot));
    const next = { ...cur, st, act, vanish, pop };
    if (st.over) finish(next, st.won ? "done" : "stuck"); else commit(next);
  }, [commit, finish, toMouse, ultra]);

  // One place for every action, from a key or a mouse button.
  const act = useCallback((a) => {
    let cur = live.current;
    if (a === "retry") { retry(); return; }
    if (cur.result) return;
    if (a === "forfeit") { finish(cur, "forfeit"); return; }
    if (!cur.act) return;
    if (!cur.startAt) cur = { ...cur, startAt: performance.now() }; // the clock starts on your first action
    if (a === "swap") { commit({ ...cur, act: toMouse(sSpawn(cur.st, 1 - cur.act.slot)) }); sfx.pick(); return; }
    if (a === "cw" || a === "ccw" || a === "r180") {
      const dir = a === "cw" ? 1 : a === "ccw" ? -1 : 2;
      commit({ ...cur, act: toMouse(sTurn(cur.act, dir)) });
      sfx.rotate(dir === -1 ? -1 : 1);
      return;
    }
    if (a === "place") { live.current = cur; placeNow(); }
  }, [retry, finish, commit, toMouse, placeNow]);

  useEffect(() => {
    const onKey = (e) => {
      const t = e.target;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA")) return;
      const a = sprintActionFor(e.key);
      if (!a) return;
      e.preventDefault();
      if (!e.repeat) act(a);
    };
    const onMove = (e) => {
      mouse.current = { x: e.clientX, y: e.clientY };
      const cur = live.current;
      if (!cur.act || cur.result) return;
      const a = toMouse(cur.act);
      if (a.cr !== cur.act.cr || a.cc !== cur.act.cc) commit({ ...cur, act: a });
    };
    const onDown = (e) => {
      if (e.target instanceof Element && e.target.closest("button, a, input, [role=dialog]")) return;
      const a = sprintActionFor(mouseName(e.button)) || (e.button === 0 ? "place" : null);
      if (!a) return;
      e.preventDefault();
      act(a);
    };
    const noMenu = (e) => e.preventDefault(); // right click is a game button here, not the browser menu
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerdown", onDown);
    window.addEventListener("contextmenu", noMenu);
    return () => {
      window.removeEventListener("keydown", onKey); window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerdown", onDown); window.removeEventListener("contextmenu", noMenu);
    };
  }, [act, toMouse, commit]);

  const st = r.st;
  const ms = r.startAt ? Math.max(0, (r.endAt || clock) - r.startAt) : 0;
  const left = Math.max(0, S_ULTRA_MS - ms);
  const pps = ms > 0 ? st.pieces / (ms / 1000) : 0;
  const vanish = r.vanish;
  const railD = useBubble(false);
  const keyOf = (id) => bindLabel(keys[id]);

  // The board in the middle, as big as fits, the timer above it and the
  // score and lines under it. Left: your first piece, then the other stats.
  // Right: your second piece, then the next three as plain colour squares.
  const g = P;
  const availH = stage.h - (TITLE_H + 12) * P - 60;

  // Sized as a 10×10 board would be, then shared among 8 squares: the board stays the same size on screen.
  const cell10 = Math.max(4 * P, Math.min(24 * P, Math.floor(Math.min((stage.w - 12 * P) / 15.8, availH / 12.2) / P) * P));
  const cell = Math.floor((10 * cell10 + 2 * g) / S_SIZE / P) * P;
  const boardW = cell * S_SIZE + g * (S_SIZE - 1);
  const half = Math.max(P, Math.floor((cell + g) / 2 / P) * P - P);
  const colW = Math.round(cell * 2.3);
  const boxH = Math.round(cell * 1.4);
  const actCells = r.act ? sCellsOf(r.act) : [];
  const actKeys = new Set(actCells.map(([a, b]) => a * S_SIZE + b));
  const legal = r.act ? sCanPlace(st, r.act) : false;
  const fullW = boardW + 2 * colW + 12 * P;
  const stat = (label, value, ink = UI.text) => (
    <div className="flex flex-col" style={{ gap: P }}><span style={{ color: UI.dim }}>{label}</span><span className="tb-b tabular-nums" style={{ color: ink }}>{value}</span></div>
  );
  const handBox = (i) => {
    const id = st.hand[i], picked = r.act && r.act.slot === i;
    return (
      <div role="img" aria-label={`Piece ${i + 1}: ${S_NAMES[id]}${picked ? " (in play)" : ""}`} className="flex items-center justify-center"
        style={{ height: boxH, ...glass(picked ? UI.text : UI.line), opacity: picked ? 1 : 0.7 }}>
        <SPiece id={id} cell={half} gap={P} />
      </div>
    );
  };
  const sq = cell; // the forecast squares are full size

  if (showEnd && r.result) {
    const good = r.newBest || r.result === "done" || r.result === "time";
    const bestText = best ? (ultra ? best.toLocaleString("en-US") : fmtClock(best)) : "—";
    const counts = ultra ? r.result !== "forfeit" : r.result === "done";
    return (
      <EndScreen
        verdict={r.newBest ? "NEW BEST" : r.result === "done" ? "FINISHED" : r.result === "time" ? "TIME UP" : r.result === "stuck" ? "NO ROOM" : "FORFEIT"}
        ink={good ? GOLD : UI.bad} sound={good ? "win" : "lose"} compare={false}
        note={`${st.lines} lines · ${st.pieces} pieces · ${pps.toFixed(2)} PPS`}
        left={ultra ? { name: "SCORE", score: st.score.toLocaleString("en-US"), ink: "var(--tb-you)", won: r.newBest }
          : { name: r.result === "done" ? "TIME" : "LINES", score: r.result === "done" ? fmtClock(r.endAt - r.startAt) : `${Math.min(st.lines, S_GOAL)}/${S_GOAL}`, ink: "var(--tb-you)", won: r.newBest }}
        right={{ name: "BEST", score: bestText, ink: GOLD }}
        actions={[{ label: "MENU", onClick: onExit }, { label: `RETRY (${keyOf("retry")})`, onClick: retry, main: true }]}>
        {/* Whether the run went on T-Terminal. */}
        {counts && (
          <div className="tb-t tb-rise" style={{ color: ranked?.saved ? UI.good : ranked?.error ? UI.bad : UI.dim, animationDelay: "200ms" }}>
            {!r.official ? "sign in to rank your runs on T-Terminal"
              : !ranked ? "checking…"
              : ranked.error ? ranked.error
              : ranked.newBest ? "new personal best on T-Terminal" : "checked · saved to your record"}
          </div>
        )}
      </EndScreen>
    );
  }

  return (
    <div className="tb-screen tb-safe w-full flex flex-col font-mono select-none" style={{ color: UI.text, cursor: "crosshair" }}>
      <div ref={stageRef} className="relative flex-1 min-h-0 flex flex-col items-center w-full mx-auto px-3" style={{ maxWidth: 1600 }}>
        <div style={{ flex: 1, minHeight: 2 * P }} />
        <GameTitle mode={ultra ? "ULTRA" : "SPRINT"} />
        <div style={{ flex: 1, minHeight: 2 * P }} />
        <div className="flex items-start" style={{ gap: 6 * P }}>
          <div className="flex flex-col tb-t" style={{ width: colW, gap: 5 * P, marginTop: cell }}>
            {handBox(0)}
            <div className="flex flex-col" style={{ gap: 4 * P, marginTop: cell }}>
              {ultra && stat("COMBO", st.combo > 1 ? `×${comboMultOf(st.combo)}` : "—", st.combo > 1 ? GOLD : UI.dim)}
              {stat("PIECES", st.pieces)}
              {stat("PPS", pps.toFixed(2))}
              {stat("BEST", best ? (ultra ? best.toLocaleString("en-US") : fmtClock(best)) : "—", GOLD)}
            </div>
          </div>
          <div className="flex flex-col items-center" style={{ gap: 2 * P }}>
            {/* The clock, over the board. */}
            <span className="tb-t tb-b tabular-nums" style={{ height: cell - 2 * P, display: "flex", alignItems: "center", fontSize: "1.4em",
              color: ultra && left < 10000 ? UI.bad : "var(--tb-you)" }}>{fmtClock(ultra ? left : ms)}</span>
            <div ref={boardEl} className="relative" style={{ width: boardW, height: boardW }}>
              <div style={{ display: "grid", gridTemplateColumns: `repeat(${S_SIZE}, ${cell}px)`, gap: g }}>
                {st.board.map((row, ri) => row.map((v, ci) => {
                  const k = ri * S_SIZE + ci, on = actKeys.has(k);
                  return (
                    <div key={k} data-v={v ?? ""} style={{ position: "relative", width: cell, height: cell, clipPath: Math.round(cell / P) >= 9 ? CLIP : CLIP1, ...(v === null ? GLASS : null) }}>
                      {v !== null && <Ink size={cell} color={S_INK[v]} />}
                      {on && v === null && <div className="absolute inset-0" style={{ opacity: legal ? 0.9 : 0.6 }}><Ink size={cell} color={legal ? S_INK[r.act.id] : UI.bad} {...(legal ? null : { stroke: "ghost" })} /></div>}
                      {on && v !== null && (
                        <>
                          <div className="absolute inset-0" style={{ background: "rgba(8,6,16,.62)" }} />
                          <div className="absolute inset-0" style={{ opacity: 0.9 }}><Ink size={cell} color={UI.bad} stroke="ghost" /></div>
                        </>
                      )}
                    </div>
                  );
                }))}
              </div>
              {vanish && <VanishLayer key={vanish.key} cleared={vanish.cleared} cell={cell} gap={g} ink={S_INK} />}
              {!r.startAt && !r.result && (
                <div className="absolute inset-x-0 flex justify-center pointer-events-none" style={{ top: 2 * P }}>
                  <span className="tb-t" style={{ color: UI.text, padding: `${P}px ${3 * P}px`, background: "color-mix(in srgb, var(--tb-panel-solid) 80%, transparent)" }}>
                    {ultra ? "2 MINUTES · THE CLOCK STARTS ON YOUR FIRST MOVE" : "THE CLOCK STARTS ON YOUR FIRST MOVE"}
                  </span>
                </div>
              )}
              {r.pop && (
                <div key={r.pop.key} className="absolute flex justify-center pointer-events-none tb-rise" style={{ left: 0, right: 0, bottom: 4 * P, zIndex: 4 }}>
                  <span className="tb-t tb-b" style={{ color: GOLD, padding: `${P}px ${3 * P}px`, background: "color-mix(in srgb, var(--tb-panel-solid) 82%, transparent)", clipPath: CLIP1, textShadow: `${P}px ${P}px 0 rgba(0,0,0,.6)` }}>{r.pop.text}</span>
                </div>
              )}
            </div>
            {/* Score and lines, under the board. */}
            <div className="flex justify-center tb-t" style={{ gap: 10 * P, marginTop: 2 * P }}>
              {ultra && <div className="flex flex-col items-center" style={{ gap: P }}><span style={{ color: UI.dim }}>SCORE</span><span className="tb-b tabular-nums">{st.score.toLocaleString("en-US")}</span></div>}
              <div className="flex flex-col items-center" style={{ gap: P }}><span style={{ color: UI.dim }}>LINES</span><span className="tb-b tabular-nums">{ultra ? st.lines : `${Math.min(st.lines, S_GOAL)} / ${S_GOAL}`}</span></div>
            </div>
          </div>
          <div className="flex flex-col items-start" style={{ width: colW, gap: 5 * P, marginTop: cell }}>
            <div className="w-full">{handBox(1)}</div>
            {/* The next five: just their colours, in one narrow strip against the board. */}
            <div aria-label="Next pieces" className="flex flex-col items-center" style={{ gap: 2 * P, padding: `${3 * P}px ${3 * P}px`, ...glass(UI.line) }}>
              {st.queue.map((id, i) => (
                <div key={i} role="img" aria-label={`Next ${i + 1}: ${S_NAMES[id]}`} style={{ opacity: i ? Math.max(0.45, 0.85 - i * 0.1) : 1 }}>
                  <Ink size={sq} color={S_INK[id]} />
                </div>
              ))}
            </div>
          </div>
        </div>
        <div className="flex items-center justify-end" style={{ width: fullW, gap: 3 * P, marginTop: P }}>
          <Bubble w={railD} h={railD} label={`Retry (${keyOf("retry")})`} onClick={retry}><RefreshCw /></Bubble>
          {r.result
            ? <Bubble w={railD} h={railD} label="Menu" onClick={onExit}><LogOut /></Bubble>
            : <ForfeitButton disabled={!!r.result} onConfirm={() => finish(live.current, "forfeit")} />}
        </div>
        <div style={{ flex: 2, minHeight: 4 * P }} />
      </div>
    </div>
  );
}

/* ============================================================
   ZERO-G — a falling-block Sprint with no gravity (10×40, hold,
   five next, SRS turns with 180, T-spins). See shared/zerog.js.
   ============================================================ */
const zgBest = { get: () => Number(store.get("tb:zgBest")) || 0, set: (ms) => store.set("tb:zgBest", String(ms)) };
const ZG_SHOW = Z_VISIBLE + 2; // the field and the two buffer rows the pieces spawn in

/** A piece drawn on its own (hold and next), in its spawn state. */
function ZPiece({ id, cell, gap, dim = false }) {
  const cells = zShapeCells(id, 0);
  const xs = cells.map((c) => c[0]), ys = cells.map((c) => c[1]);
  const x0 = Math.min(...xs), y0 = Math.min(...ys);
  const w = Math.max(...xs) - x0 + 1, h = Math.max(...ys) - y0 + 1;
  return (
    <div className="relative" style={{ width: w * cell + (w - 1) * gap, height: h * cell + (h - 1) * gap, opacity: dim ? 0.35 : 1 }}>
      {cells.map(([x, y]) => (
        <div key={`${x},${y}`} className="absolute" style={{ left: (x - x0) * (cell + gap), top: (y - y0) * (cell + gap) }}><Ink size={cell} color={S_INK[id]} /></div>
      ))}
    </div>
  );
}

/** ZERO-G keys and handling (DAS, ARR, soft drop speed, DCD), in Settings and in the game. */
function ZgControlsSection() {
  const P = usePx();
  const keys = useSyncExternalStore(zgSubscribe, getZgKeys);
  const hd = useSyncExternalStore(zgSubscribe, getZgHandling);
  const [listening, setListening] = useState(null);
  useEffect(() => {
    if (!listening) return undefined;
    const onKey = (e) => { e.preventDefault(); e.stopPropagation(); if (e.key !== "Tab") { setZgKey(listening, e.key); setListening(null); } };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [listening]);
  const show = (k) => (k === " " ? "SPACE" : bindLabel(k));
  return (
    <div className="flex flex-col" style={{ gap: P }}>
      <div className="flex items-center justify-between">
        <span className="tb-t">ZERO-G</span>
        <button onClick={() => { resetZg(); setListening(null); }} className="tb-t py-1" style={{ color: UI.dim }}>RESET</button>
      </div>
      <div className="grid grid-cols-2 gap-x-4">
        {ZG_ACTIONS.map((a) => {
          const on = listening === a.id;
          return (
            <div key={a.id} className="flex items-center justify-between gap-2 py-1" style={RULE_BELOW}>
              <span className="tb-t" style={{ color: UI.dim }}>{a.label}</span>
              <button onClick={() => setListening(on ? null : a.id)} className={`tb-t ${on ? "tb-pulse" : ""}`} aria-label={`${a.label}: ${keys[a.id] ? show(keys[a.id]) : "unbound"}`}
                style={{ minWidth: 52, height: 28, padding: "0 6px", ...(on ? skFill(UI.text) : sk(UI.line)), color: keys[a.id] ? UI.text : UI.bad }}>
                {on ? "…" : show(keys[a.id])}
              </button>
            </div>
          );
        })}
      </div>
      <div className="flex flex-col" style={{ gap: 2 * P, marginTop: 2 * P }}>
        {HANDLING.map((h) => (
          <div key={h.id} className="flex flex-col" style={{ gap: P }}>
            <div className="flex items-center justify-between tb-t">
              <span>{h.label} <span style={{ color: UI.dim }}>· {h.hint}</span></span>
              <span className="tabular-nums" style={{ color: UI.dim }}>{h.id === "sdf" && hd.sdf >= SDF_MAX ? "INSTANT" : `${hd[h.id]} ${h.unit}`}</span>
            </div>
            <PixelSlider min={h.min} max={h.max} step={h.step} value={hd[h.id]} onChange={(v) => setZgHandling(h.id, v)} label={h.label} />
          </div>
        ))}
      </div>
    </div>
  );
}

/** The run clock, written straight into the page every frame (no re-render). */
function ZgClock({ run, style }) {
  const el = useRef(null);
  useEffect(() => {
    let raf;
    const loop = () => {
      raf = requestAnimationFrame(loop);
      const r = run.current;
      if (el.current) el.current.textContent = fmtClock(r.startAt ? (r.endAt || performance.now()) - r.startAt : 0);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [run]);
  return <span ref={el} className="tb-t tb-b tabular-nums" style={style}>0:00.00</span>;
}

const freshZg = () => ({ st: zNewGame(), startAt: 0, endAt: 0, result: null, newBest: false, flash: null, pop: null });

/** ZERO-G SPRINT: 40 lines on a 10×40 board, falling-block rules, no gravity. */
function ZeroGGame({ onExit }) {
  useGameMusic();
  useEffect(() => { sky.slow = true; return () => { sky.slow = false; }; }, []);
  const P = usePx();
  const [stageRef, stage] = useSize();
  const keys = useSyncExternalStore(zgSubscribe, getZgKeys);
  const wipe = useContext(WipeCtx);
  // The live run (key handlers change it at once) and what's drawn: a copy, taken whenever something changes.
  const [first] = useState(freshZg);
  const run = useRef(first);
  const [r, setSnap] = useState(() => ({ ...first, now: 0 }));
  const bump = useCallback(() => setSnap({ ...run.current, now: performance.now() }), []);
  const [best, setBest] = useState(zgBest.get);
  const [showEnd, setShowEnd] = useState(false);
  const [opts, setOpts] = useState(false);
  // Held keys: which way the piece slides, since when, and the soft drop.
  const hold = useRef({ left: false, right: false, dir: 0, dasAt: 0, step: 0, soft: false, softStep: 0, dcd: 0 });

  const finish = useCallback((result) => {
    const r = run.current;
    if (r.result) return;
    r.endAt = performance.now(); r.result = result;
    if (result === "done") {
      const ms = Math.round(r.endAt - r.startAt);
      if (!zgBest.get() || ms < zgBest.get()) { zgBest.set(ms); setBest(ms); r.newBest = true; }
      sfx.levelUp();
    } else if (result === "forfeit") sfx.forfeit();
    else sfx.lose();
    bump();
    setTimeout(() => wipe(() => { if (run.current.result) setShowEnd(true); }), result === "forfeit" ? 0 : 700);
  }, [bump, wipe]);
  const retry = useCallback(() => { run.current = freshZg(); setShowEnd(false); sfx.pick(); bump(); }, [bump]);
  const start = () => { const r = run.current; if (!r.startAt) r.startAt = performance.now(); };

  const doHard = useCallback(() => {
    const r = run.current, st = r.st;
    if (!st.cur) return;
    start();
    const L = zHardDrop(st);
    sfx.zgDrop();
    if (L.lines) {
      const at = st.pieces;
      r.flash = { rows: L.rows, key: at };
      sfx.zgClear({ lines: L.lines, spin: L.spin, b2b: L.b2b, allClear: L.allClear });
      if (L.combo >= 1) sfx.zgCombo(L.combo);
      r.pop = { name: L.name, combo: L.combo, b2b: L.b2b, allClear: L.allClear, key: at };
      setTimeout(() => { const c = run.current; if (c.flash && c.flash.key === at) { c.flash = null; bump(); } }, 200);
      setTimeout(() => { const c = run.current; if (c.pop && c.pop.key === at) { c.pop = null; bump(); } }, 1400);
    } else if (L.spin) {
      r.pop = { name: L.name, combo: -1, b2b: -1, key: st.pieces };
    }
    hold.current.dcd = performance.now() + getZgHandling().dcd;
    if (st.over) finish(st.won ? "done" : "stuck");
    bump();
  }, [bump, finish]);

  const press = useCallback((a) => {
    if (a === "retry") { retry(); return; }
    const r = run.current, st = r.st, h = hold.current, now = performance.now();
    if (r.result) return;
    if (a === "forfeit") { finish("forfeit"); return; }
    if (!st.cur) return;
    if (a === "left" || a === "right") {
      h[a] = true; h.dir = a === "left" ? -1 : 1; h.dasAt = now; h.step = 0;
      start();
      if (zShift(st, h.dir)) { sfx.zgMove(); bump(); }
      return;
    }
    if (a === "soft") {
      h.soft = true; h.softStep = now;
      start();
      let moved = false;
      if (getZgHandling().sdf >= SDF_MAX) { while (zDown(st)) moved = true; } else moved = zDown(st);
      if (moved) { if (getZgHandling().sdf >= SDF_MAX) sfx.zgLand(); bump(); }
      return;
    }
    if (a === "hard") { doHard(); return; }
    if (a === "cw" || a === "ccw" || a === "r180") {
      start();
      const dir = a === "cw" ? 1 : a === "ccw" ? -1 : 2;
      if (zRotate(st, dir)) { sfx.zgRotate(dir); h.dcd = now + getZgHandling().dcd; bump(); }
      return;
    }
    if (a === "hold") {
      start();
      if (zHold(st)) { sfx.zgHold(); h.dcd = now + getZgHandling().dcd; if (st.over) finish("stuck"); bump(); }
    }
  }, [retry, finish, doHard, bump]);

  const release = useCallback((a) => {
    const h = hold.current;
    if (a === "left" || a === "right") {
      h[a] = false;
      const other = a === "left" ? "right" : "left";
      if (h[other]) { h.dir = other === "left" ? -1 : 1; h.dasAt = performance.now(); h.step = 0; } else h.dir = 0;
    }
    if (a === "soft") h.soft = false;
  }, []);

  // Held keys, every frame: DAS then ARR sideways, and the soft drop.
  useEffect(() => {
    let raf;
    const loop = () => {
      raf = requestAnimationFrame(loop);
      const r = run.current, st = r.st, h = hold.current;
      if (!st.cur || r.result) return;
      const hd = getZgHandling(), now = performance.now();
      let moved = false;
      if (h.dir && now - h.dasAt >= hd.das && now >= h.dcd) {
        if (hd.arr <= 0) { while (zShift(st, h.dir)) moved = true; }
        else {
          if (!h.step) h.step = h.dasAt + hd.das - hd.arr;
          for (let i = 0; i < 10 && now - h.step >= hd.arr; i++) { h.step += hd.arr; if (zShift(st, h.dir)) moved = true; else { h.step = now; break; } }
        }
        if (moved) sfx.zgMove();
      }
      if (h.soft) {
        if (hd.sdf >= SDF_MAX) { while (zDown(st)) moved = true; }
        else {
          const every = 1000 / hd.sdf;
          for (let i = 0; i < 10 && now - h.softStep >= every; i++) { h.softStep += every; if (zDown(st)) moved = true; else { h.softStep = now; break; } }
        }
      }
      if (moved) bump();
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [bump]);

  useEffect(() => {
    if (opts) return undefined;
    const typing = (e) => e.target && (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA");
    const down = (e) => {
      if (typing(e)) return;
      const a = zgActionFor(e.key);
      if (!a) return;
      e.preventDefault();
      if (!e.repeat) press(a);
    };
    const up = (e) => { const a = zgActionFor(e.key); if (a) release(a); };
    const blur = () => { const h = hold.current; h.left = h.right = h.soft = false; h.dir = 0; };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", blur);
    return () => { window.removeEventListener("keydown", down); window.removeEventListener("keyup", up); window.removeEventListener("blur", blur); };
  }, [press, release, opts]);
  // For the playtest bot (and anyone curious): the run, read-only.
  useEffect(() => { window.__zg = run; return () => { if (window.__zg === run) delete window.__zg; }; }, []);

  const st = r.st;
  const ms = r.startAt ? (r.endAt || r.now) - r.startAt : 0;
  const pps = ms > 0 ? st.pieces / (ms / 1000) : 0;
  const keyOf = (id) => (keys[id] === " " ? "SPACE" : bindLabel(keys[id]));
  const railD = useBubble(false);

  if (showEnd && r.result) {
    const good = r.result === "done";
    return (
      <EndScreen verdict={r.newBest ? "NEW BEST" : good ? "FINISHED" : r.result === "stuck" ? "TOPPED OUT" : "FORFEIT"}
        ink={good ? GOLD : UI.bad} sound={good ? "win" : "lose"} compare={false}
        note={`${st.lines} lines · ${st.pieces} pieces · ${pps.toFixed(2)} PPS · ${st.stats.quad} quads · ${st.stats.tspin} T-spins · max combo ${Math.max(0, st.stats.maxCombo)}`}
        left={{ name: good ? "TIME" : "LINES", score: good ? fmtClock(r.endAt - r.startAt) : `${st.lines}/${Z_GOAL}`, ink: "var(--tb-you)", won: r.newBest }}
        right={{ name: "BEST", score: best ? fmtClock(best) : "—", ink: GOLD }}
        actions={[{ label: "MENU", onClick: onExit }, { label: `RETRY (${keyOf("retry")})`, onClick: retry, main: true }]} />
    );
  }

  // The field: 10 wide, the 20 visible rows plus the 2 spawn rows above them.
  const g = P;
  const clockH = 10 * P, countH = 10 * P; // the clock above the board, the line count under it
  const availH = stage.h - (TITLE_H + 12) * P - clockH - countH - 12 * P;
  const fitW = (stage.w - 24 * P - 9 * g) / 18.5; // the board plus both side columns must fit across
  const cell = Math.max(4 * P, Math.min(16 * P, Math.floor(Math.min((availH - (ZG_SHOW - 1) * g) / ZG_SHOW, fitW) / P) * P));
  const boardW = Z_W * cell + (Z_W - 1) * g;
  const boardH = ZG_SHOW * cell + (ZG_SHOW - 1) * g;
  const small = Math.max(2 * P, Math.floor(cell * 0.6 / P) * P);
  const colW = Math.max(small * 4 + 8 * P, Math.round(cell * 4.2), 40 * P);
  const sideTop = clockH + 2 * P + 2 * (cell + g); // the side columns start level with the field's top row
  const sideH = boardH - 2 * (cell + g);
  const top0 = Z_TOP - 2;
  const curCells = st.cur ? zCellsOf(st.cur) : [];
  const ghost = st.cur ? zCellsOf(zDropped(st.board, st.cur)) : [];
  const at = new Map();
  for (const [x, y] of ghost) at.set(y * Z_W + x, "ghost");
  for (const [x, y] of curCells) at.set(y * Z_W + x, "cur");
  const flashRows = new Set(r.flash ? r.flash.rows : []);
  const stat = (label, value, ink = UI.text) => (
    <div className="flex flex-col" style={{ gap: P }}><span style={{ color: UI.dim }}>{label}</span><span className="tb-b tabular-nums" style={{ color: ink }}>{value}</span></div>
  );
  const pop = r.pop;

  return (
    <div className="tb-screen tb-safe w-full flex flex-col font-mono select-none" style={{ color: UI.text }}>
      <div ref={stageRef} className="relative flex-1 min-h-0 flex flex-col items-center w-full mx-auto px-3" style={{ maxWidth: 1600 }}>
        <div style={{ flex: 1, minHeight: 2 * P }} />
        <GameTitle mode="ZERO-G" />
        <div style={{ flex: 1, minHeight: 2 * P }} />
        <div className="flex items-start">
          {/* Left: hold, flush against the board, then the stats and the last clear. */}
          <div className="flex flex-col items-start tb-t" style={{ width: colW, gap: 4 * P, marginTop: sideTop }}>
            <div className="flex flex-col items-center w-full" style={{ gap: 2 * P, padding: 3 * P, ...glass(UI.line) }}>
              <span style={{ color: UI.dim }}>HOLD ({keyOf("hold")})</span>
              <div className="flex items-center justify-center" style={{ height: small * 2 + P + 2 * P }}>
                {st.hold !== null && <ZPiece id={st.hold} cell={small} gap={P} dim={st.held} />}
              </div>
            </div>
            <div className="flex flex-col w-full" style={{ gap: 3 * P, marginTop: 2 * P, paddingLeft: 3 * P }}>
              {stat("PIECES", st.pieces)}
              {stat("PPS", pps.toFixed(2))}
              {stat("BEST", best ? fmtClock(best) : "—", GOLD)}
            </div>
            {/* The last clear: its name, the combo, back-to-back. */}
            <div className="flex flex-col items-start" style={{ gap: P, minHeight: 14 * P, marginTop: 2 * P, paddingLeft: 3 * P }}>
              {pop && (
                <div key={pop.key} className="flex flex-col items-start tb-rise" style={{ gap: P }}>
                  {pop.b2b > 0 && <span className="tb-b" style={{ color: GOLD }}>B2B ×{pop.b2b}</span>}
                  {pop.name && <span className="tb-b" style={{ color: pop.name.startsWith("T-SPIN") ? S_INK[2] : pop.name === "QUAD" ? S_INK[0] : UI.text, fontSize: "1.2em" }}>{pop.name}</span>}
                  {pop.combo >= 1 && <span className="tb-b" style={{ color: "var(--tb-you)" }}>{pop.combo} COMBO</span>}
                  {pop.allClear && <span className="tb-b" style={{ color: GOLD, fontSize: "1.2em" }}>ALL CLEAR</span>}
                </div>
              )}
            </div>
          </div>
          {/* The board, the clock above it, the line count under it. */}
          <div className="flex flex-col items-center" style={{ gap: 2 * P }}>
            <div className="flex items-center" style={{ height: clockH }}><ZgClock run={run} style={{ fontSize: "1.4em", color: "var(--tb-you)" }} /></div>
            <div className="relative" style={{ width: boardW, height: boardH, padding: 0 }}>
              <div style={{ display: "grid", gridTemplateColumns: `repeat(${Z_W}, ${cell}px)`, gap: g }}>
                {Array.from({ length: ZG_SHOW }, (_, i) => top0 + i).map((y) => st.board[y].map((v, x) => {
                  const k = y * Z_W + x, mark = at.get(k), buffer = y < Z_TOP;
                  return (
                    <div key={k} style={{ position: "relative", width: cell, height: cell, ...(v === null && !buffer ? GLASS : null) }}>
                      {v !== null && <Ink size={cell} color={S_INK[v]} />}
                      {v === null && mark === "cur" && <Ink size={cell} color={S_INK[st.cur.id]} />}
                      {v === null && mark === "ghost" && <div className="absolute inset-0" style={{ opacity: 0.28 }}><Ink size={cell} color={S_INK[st.cur.id]} /></div>}
                    </div>
                  );
                }))}
              </div>
              {/* A clear: the rows flash and fade in under a fifth of a second. */}
              {r.flash && [...flashRows].filter((y) => y >= top0).map((y) => (
                <div key={`${r.flash.key}-${y}`} className="absolute pointer-events-none tb-zgflash" style={{ left: 0, width: boardW, top: (y - top0) * (cell + g), height: cell }} />
              ))}
              {!r.startAt && !r.result && (
                <div className="absolute inset-x-0 flex justify-center pointer-events-none" style={{ top: 3 * (cell + g) }}>
                  <span className="tb-t" style={{ color: UI.text, padding: `${P}px ${3 * P}px`, background: "color-mix(in srgb, var(--tb-panel-solid) 80%, transparent)" }}>
                    NO GRAVITY · THE CLOCK STARTS ON YOUR FIRST MOVE
                  </span>
                </div>
              )}
            </div>
            <div className="flex items-center tb-t" style={{ height: countH }}>
              <span className="tb-b tabular-nums">{Math.min(st.lines, Z_GOAL)} / {Z_GOAL}</span>
            </div>
          </div>
          {/* Right: the next five, flush against the board; the buttons in a column at its bottom. */}
          <div className="flex flex-col items-start tb-t" style={{ width: colW, marginTop: sideTop, height: sideH }}>
            <div aria-label="Next pieces" className="flex flex-col items-center w-full" style={{ gap: 3 * P, padding: 3 * P, ...glass(UI.line) }}>
              <span style={{ color: UI.dim }}>NEXT</span>
              {st.queue.slice(0, Z_NEXT).map((id, i) => (
                <div key={i} role="img" aria-label={`Next ${i + 1}: ${Z_NAMES[id]}`} className="flex items-center justify-center" style={{ height: small * 2 + P, opacity: i ? 0.8 : 1 }}>
                  <ZPiece id={id} cell={small} gap={P} />
                </div>
              ))}
            </div>
            <div className="flex flex-col items-start" style={{ marginTop: "auto", gap: 3 * P }}>
              <Bubble w={railD} h={railD} label="Controls and handling" onClick={() => setOpts(true)}><Settings2 /></Bubble>
              <Bubble w={railD} h={railD} label={`Retry (${keyOf("retry")})`} onClick={retry}><RefreshCw /></Bubble>
              {r.result
                ? <Bubble w={railD} h={railD} label="Menu" onClick={onExit}><LogOut /></Bubble>
                : <ForfeitButton onConfirm={() => finish("forfeit")} />}
            </div>
          </div>
        </div>
        <div style={{ flex: 2, minHeight: 4 * P }} />
      </div>
      {opts && <Popup title="HANDLING" onClose={() => setOpts(false)} maxW={520}><ZgControlsSection /></Popup>}
    </div>
  );
}

/* ============================================================
   BLITZ 1v1 — two boards side by side; spikes send junk pieces
   (against a bot for now; online comes with the server side)
   ============================================================ */
const JUNK_INK = "#8E8A99";
// A square lit red by the opponent's lines: dark red, a pixel lighter along the top.
const RED_SQ = { background: "#5A1622", boxShadow: "inset 0 var(--p) 0 #7A2330, inset 0 calc(var(--p) * -1) 0 #3A0C14" };
const blitzName = (id) => (sIsJunk(id) ? `junk ${sJunkLevel(id)}` : S_NAMES[id]);
const BLITZ_COUNTDOWN = 3;
const blitzSkill = { get: () => Math.max(1, Math.min(10, Number(store.get("tb:botSkill")) || 6)), set: (n) => store.set("tb:botSkill", String(n)) };
const cloneSt = (st) => ({ ...st, board: st.board.map((row) => row.slice()), hand: st.hand.slice(), queue: st.queue.slice(), bag: st.bag ? st.bag.slice() : [] });

/**
 * BLITZ: your board and your opponent's, side by side.
 *   online  ranked 1v1, run by the server: it checks every placement and
 *           times every spike; your board updates at once and is corrected
 *           by the server's copy if they ever disagree.
 *   vs bot  the same game against the Blitz bot, skill 1-10 (speed and smarts).
 */
function BlitzGame({ onExit, online = false, colors, onRequeue }) {
  useGameMusic();
  useEffect(() => { sky.slow = true; return () => { sky.slow = false; }; }, []);
  const P = usePx();
  const railD = useBubble(false);
  const wipe = useContext(WipeCtx);
  const [stageRef, stage] = useSize();
  const keys = useSyncExternalStore(subscribeSprintKeys, getSprintKeys);
  const [skill, setSkill] = useState(blitzSkill.get);
  // A game: both sides start from the same seed, so they get the same pieces.
  // `log` is the match in time order, for the replay (see server/blitz.js).
  const fresh = (seed, startIn) => {
    const me = newSprint(seed, Infinity), bot = newSprint(seed, Infinity);
    return { seed, me, bot, act: sSpawn(me, 0), startAt: performance.now() + startIn, result: null, red: { me: 0, bot: 0 }, redFlash: { me: 0, bot: 0 }, reason: null, sent: { me: 0, bot: 0 }, flash: null, vanish: { me: null, bot: null }, ratings: null, log: [] };
  };
  // vs bot: waits on the skill picker. Online: the match found in the lobby (its intro has played).
  const joining = () => { const b = net.blitz; return online && b && !b.over && b.seed != null ? b : null; };
  const [g, setG] = useState(() => { const b = joining(); return b ? fresh(b.seed, Math.max(0, b.countdown - (Date.now() - b.got))) : null; });
  const live = useRef(g);
  const commit = useCallback((next) => { live.current = next; setG(next); }, []);
  const [now, setNow] = useState(() => performance.now());
  const [chatM, setChatM] = useState(joining);
  const [showEnd, setShowEnd] = useState(false);
  const [profileOf, setProfileOf] = useState(null); // a player's card, opened from their name
  const boardEl = useRef(null);
  const mouse = useRef(null);
  const toMouse = useCallback((a) => {
    const el = boardEl.current, m = mouse.current;
    if (!a || !el || !m) return a;
    const rect = el.getBoundingClientRect(), step = rect.width / S_SIZE;
    return sAt(a, (m.y - rect.top) / step, (m.x - rect.left) / step);
  }, []);
  const playing = (c) => c && !c.result && performance.now() >= c.startAt;
  const startBot = useCallback(() => { blitzSkill.set(skill); setShowEnd(false); commit(fresh(newSprintSeed(), BLITZ_COUNTDOWN * 1000)); }, [skill, commit]);
  const findMatch = useCallback(() => { onRequeue?.(); }, [onRequeue]);
  const oppName = online ? (chatM?.opponent?.name || "OPPONENT") : `BOT · SKILL ${blitzSkill.get()}`;
  const myName = net.profile?.name || "YOU";

  // Online: the server's messages.
  useEffect(() => {
    if (!online) return undefined;
    const offs = [
      net.on("blitzStart", (b) => { setShowEnd(false); commit(fresh(b.seed, b.countdown)); setChatM(b); }),
      net.on("blitz", (b) => setChatM(b)),
      net.on("blitzState", (m) => {
        const c = live.current; if (!c || !net.blitz) return;
        if (m.side === net.blitz.you) {
          // The server's copy of your board: taken when it has seen as many placements as you've made.
          const red = { ...c.red, me: m.red || 0 }, redFlash = { ...c.redFlash, me: m.flash ? 1 : 0 };
          if (m.pieces === c.me.pieces) commit({ ...c, me: { ...c.me, board: m.board, hand: m.hand, queue: m.queue, lines: m.lines }, sent: { ...c.sent, me: m.sent }, red, redFlash });
          else commit({ ...c, sent: { ...c.sent, me: m.sent }, red, redFlash });
        } else {
          commit({ ...c, bot: { ...c.bot, board: m.board, hand: m.hand, queue: m.queue, pieces: m.pieces, lines: m.lines, spike: m.spike, lastClearAt: performance.now() }, sent: { ...c.sent, bot: m.sent },
            red: { ...c.red, bot: m.red || 0 }, redFlash: { ...c.redFlash, bot: m.flash ? 1 : 0 } });
        }
      }),
      net.on("blitzJunk", (m) => {
        const c = live.current; if (!c) return;
        const me = cloneSt(c.me);
        me.queue.splice(Math.max(0, Math.min(me.queue.length, S_FORECAST - (me.pieces - m.at))), 0, S_JUNK + m.level);
        commit({ ...c, me, flash: { who: "me", level: m.level, key: performance.now() } });
        sfx.reveal({ lines: Math.min(4, m.level) });
      }),
      net.on("blitzEnd", (m) => {
        const c = live.current; if (!c) return;
        const won = m.winner === m.you;
        const other = m.you === "A" ? "B" : "A";
        // The server's log is the whole match, both sides, timed: that's the replay.
        if (Array.isArray(m.log) && m.log.length) {
          replays.save({ kind: "blitz", seed: m.seed ?? c.seed, moves: m.log, you: m.you, names: { [m.you]: myName, [other]: c.oppName || "OPPONENT" },
            winner: m.winner, ranked: !!m.ratings, date: Date.now(), name: myName, result: { won, sent: m.sent ? [m.sent[m.you], m.sent[other]] : [c.sent.me, c.sent.bot] } });
        }
        commit({ ...c, result: won ? "win" : "lose", reason: m.reason, ratings: m.ratings ? m.ratings[m.you] : null, act: null,
          sent: m.sent ? { me: m.sent[m.you], bot: m.sent[other] } : c.sent });
      }),
    ];
    return () => { offs.forEach((f) => f()); };
  }, [online, commit, myName]);
  // The opponent's name, kept with the game for the replay.
  useEffect(() => { if (g && online && chatM?.opponent?.name && g.oppName !== chatM.opponent.name) commit({ ...live.current, oppName: chatM.opponent.name }); }, [g, online, chatM, commit]);

  // A finished game: the wave, then the end screen (as after a Control match).
  // vs bot, the game is saved as a replay here.
  const result = g?.result;
  useEffect(() => {
    if (!result) return undefined;
    const c = live.current;
    c.endedAt ??= performance.now();
    if (!online && c.log.length && !c.saved) {
      c.saved = true;
      replays.save({ kind: "blitz", seed: c.seed, moves: c.log.slice(), you: "A", names: { A: myName, B: `BOT ${blitzSkill.get()}` },
        winner: result === "win" ? "A" : "B", ranked: false, date: Date.now(), name: myName, result: { won: result === "win", sent: [c.sent.me, c.sent.bot] } });
    }
    const t = setTimeout(() => wipe(() => { if (live.current?.result) setShowEnd(true); }), c.reason === "forfeit" ? 0 : 700);
    return () => clearTimeout(t);
  }, [result, online, wipe, myName]);

  // A placement on either side: clears feed that side's spike; a dead board loses.
  const placeOn = useCallback((c, who, a) => {
    const st = cloneSt(c[who]);
    const t = performance.now();
    if (!sPlace(st, a)) return null;
    if (!online) { const mv = sRecordMove(a, t - c.startAt); c.log.push([mv[0], who === "me" ? "A" : "B", mv[1], mv[2], mv[3], mv[4]]); }
    const L = st.last;
    const other = who === "me" ? "bot" : "me";
    // A clear adds to the combo's spike; a piece that clears nothing ends the combo and
    // (vs bot; online the server does it) sends the spike as one junk piece.
    let junkTo = null;
    if (L.lines) sNoteClear(st, L.lines, t, L.allClear, L.id);
    else {
      const level = sSpikeOnMiss(st);
      if (level && !online) {
        junkTo = { ...c[other], queue: c[other].queue.slice() };
        sReceiveJunk(junkTo, level);
        c.log.push([Math.max(0, Math.round(t - c.startAt)), other === "me" ? "A" : "B", -1, level]);
        sfx.reveal({ lines: Math.min(4, level) });
        junkTo.__level = level;
      }
    }
    const vanish = L.lines ? { ...c.vanish, [who]: { cleared: L.cleared, key: `${who}${st.pieces}` } } : c.vanish;
    // Placing clears your red; your lines light the opponent's (one square a line).
    const red = { ...c.red, [who]: 0 }, redFlash = { ...c.redFlash, [who]: 0 };
    if (L.lines) {
      red[other] = (red[other] || 0) + L.lines;
      if (!redFlash[other] && sRedFull(c[other].board, red[other])) redFlash[other] = t + S_RED_FLASH_MS;
    }
    let next = { ...c, [who]: st, vanish, red, redFlash };
    if (junkTo) {
      const level = junkTo.__level; delete junkTo.__level;
      next = { ...next, [other]: junkTo, sent: { ...c.sent, [who]: c.sent[who] + 1 }, flash: { who: other, level, key: t } };
    }
    // Online, the server decides the result.
    if (st.over && !online) next = { ...next, result: who === "me" ? "lose" : "win", reason: "stuck" };
    return next;
  }, [online]);

  // The clock: countdown, spikes landing (vs bot), the bot playing.
  useEffect(() => {
    let raf, nextBot = 0;
    const loop = () => {
      raf = requestAnimationFrame(loop);
      const t = performance.now();
      setNow(t);
      let c = live.current;
      if (!c || c.result || t < c.startAt) return;
      let changed = false;
      if (!online) {
        for (const who of ["me", "bot"]) {
          const f = c.redFlash?.[who];
          if (!f || t < f) continue;
          if (sRedFull(c[who].board, c.red[who])) {
            c.log.push([Math.max(0, Math.round(t - c.startAt)), who === "me" ? "A" : "B", -3]);
            c = { ...c, result: who === "me" ? "lose" : "win", reason: "red" }; changed = true;
          } else c = { ...c, redFlash: { ...c.redFlash, [who]: 0 } };
        }
        if (c.result) { commit(c); return; }
        if (t >= nextBot) {
          const bot = { ...c.bot };
          const a = botMove(bot, blitzSkill.get());
          if (a) { const n = placeOn({ ...c, bot }, "bot", a); if (n) { c = n; changed = true; } }
          else { c = { ...c, result: "win", reason: "stuck" }; changed = true; }
          nextBot = t + botDelay(bot, blitzSkill.get());
        }
      }
      if (changed) commit(c);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [commit, placeOn, online]);

  const act = useCallback((a) => {
    const c = live.current;
    if (a === "retry") { if (online) { if (!c || c.result) findMatch(); } else if (c) { setShowEnd(false); commit(fresh(newSprintSeed(), BLITZ_COUNTDOWN * 1000)); } return; }
    if (a === "forfeit") { if (c && !c.result) { if (online) net.forfeit(); else commit({ ...c, result: "lose", reason: "forfeit" }); } return; }
    if (!playing(c) || !c.act) return;
    if (a === "swap") { commit({ ...c, act: toMouse(sSpawn(c.me, 1 - c.act.slot)) }); sfx.pick(); return; }
    if (a === "cw" || a === "ccw" || a === "r180") { const d = a === "cw" ? 1 : a === "ccw" ? -1 : 2; commit({ ...c, act: toMouse(sTurn(c.act, d)) }); sfx.rotate(d === -1 ? -1 : 1); return; }
    if (a === "place") {
      if (!sCanPlace(c.me, c.act)) { sfx.illegal(); return; }
      const mv = sRecordMove(c.act, 0);
      const n = placeOn(c, "me", c.act);
      if (!n) return;
      if (online) net.blitzPlace(mv[1], mv[2], mv[3], mv[4]);
      sfx.lockIn("place");
      if (n.me.last.lines) sfx.reveal({ lines: n.me.last.lines });
      commit({ ...n, act: n.result || n.me.over ? null : toMouse(sSpawn(n.me, c.act.slot)) });
    }
  }, [commit, placeOn, toMouse, online, findMatch]);

  useEffect(() => {
    const onKey = (e) => { const t = e.target; if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA")) return; const a = sprintActionFor(e.key); if (!a) return; e.preventDefault(); if (!e.repeat) act(a); };
    const onMove = (e) => {
      mouse.current = { x: e.clientX, y: e.clientY };
      const c = live.current;
      if (!c || !c.act || c.result) return;
      const a = toMouse(c.act);
      if (a.cr !== c.act.cr || a.cc !== c.act.cc) commit({ ...c, act: a });
    };
    const onDown = (e) => {
      if (e.target instanceof Element && e.target.closest("button, a, input, [role=dialog], form")) return;
      const a = sprintActionFor(mouseName(e.button)) || (e.button === 0 ? "place" : null);
      if (!a) return;
      e.preventDefault(); act(a);
    };
    const noMenu = (e) => e.preventDefault();
    window.addEventListener("keydown", onKey); window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerdown", onDown); window.addEventListener("contextmenu", noMenu);
    return () => { window.removeEventListener("keydown", onKey); window.removeEventListener("pointermove", onMove); window.removeEventListener("pointerdown", onDown); window.removeEventListener("contextmenu", noMenu); };
  }, [act, toMouse, commit]);

  const keyOf = (id) => bindLabel(keys[id]);

  if (showEnd && g?.result) {
    const won = g.result === "win";
    const note = g.reason === "red" ? (won ? "their board went red" : "your board went red — keep placing")
      : g.reason === "forfeit" ? (won ? "opponent forfeited" : "you forfeited")
      : g.reason === "left" ? (won ? "opponent left" : "you left")
      : won ? "their pieces ran out of room" : "your pieces ran out of room";
    return (
      <EndScreen verdict={won ? "VICTORY" : "DEFEAT"} ink={won ? colors.you : colors.rival}
        note={`${note} · junk sent`} compare
        left={{ name: "YOU", score: g.sent.me, ink: colors.you }}
        right={{ name: oppName, score: g.sent.bot, ink: colors.rival }}
        actions={[{ label: "MENU", onClick: onExit }, { label: `${online ? "NEW MATCH" : "REMATCH"} (${keyOf("retry")})`, onClick: () => act("retry"), main: true }]}>
        <div className="tb-t tb-rise" style={{ color: UI.dim, animationDelay: "160ms" }}>
          {g.me.pieces} pieces · {g.me.lines} lines · {(g.me.pieces / Math.max(1, ((g.endedAt || now) - g.startAt) / 1000)).toFixed(2)} PPS
        </div>
        {g.ratings && <RatingPanel from={g.ratings.before} to={g.ratings.after} rdFrom={g.ratings.rdBefore} rdTo={g.ratings.rdAfter} />}
      </EndScreen>
    );
  }

  // Sizes: each side is laid out like Sprint (a piece and the stats on the
  // left, the board, a piece and the forecast on the right), side by side.
  const gap = P;
  // The side columns never get narrower than their longest label.
  const colOf = (c) => Math.max(Math.round(c * 2.3), 30 * P);
  const sideOf = (c) => c * S_SIZE + gap * (S_SIZE - 1) + 2 * colOf(c) + 8 * P;
  let cell = Math.max(4 * P, Math.min(14 * P, Math.floor(Math.min((stage.w - 40 * P) / (2 * (S_SIZE + 4.6) + 1.5), (stage.h - (TITLE_H + 34) * P - 70) / (S_SIZE + 2.4)) / P) * P));
  while (cell > 4 * P && 2 * sideOf(cell) + 10 * P > stage.w - 8 * P) cell -= P;
  const boardW = cell * S_SIZE + gap * (S_SIZE - 1);
  const half = Math.max(P, Math.floor((cell + gap) / 2 / P) * P - P);
  const colW = colOf(cell), boxH = Math.round(cell * 1.4);
  const sideW = sideOf(cell);
  const inkOf = (id) => (sIsJunk(id) ? JUNK_INK : S_INK[id]);
  const elapsed = g && now > g.startAt ? (now - g.startAt) / 1000 : 0;

  const panel = (who) => {
    const st = g[who], mine = who === "me";
    const a = mine ? g.act : null;
    const cells = a ? sCellsOf(a) : [];
    const on = new Set(cells.map(([r, c]) => r * S_SIZE + c));
    const legal = a ? sCanPlace(st, a) : false;
    const spiking = st.spike > 0; // a combo is open: its spike goes out when it ends
    const reds = sRedCells(st.board, g.red?.[who] || 0), redFlash = !!g.redFlash?.[who];
    const handBox = (i) => {
      const id = st.hand[i], picked = mine && a && a.slot === i;
      return (
        <div role="img" aria-label={`${who} piece ${i + 1}: ${blitzName(id)}${picked ? " (in play)" : ""}`} className="flex items-center justify-center"
          style={{ height: boxH, ...glass(picked ? UI.text : UI.line), opacity: picked || !mine ? 1 : 0.7 }}>
          <SPiece id={id} cell={sIsJunk(id) ? Math.max(P, Math.floor(half / 2 / P) * P) : half} gap={P} />
        </div>
      );
    };
    const stat = (label, value, ink = UI.text) => (
      <div className="flex flex-col" style={{ gap: P }}><span style={{ color: UI.dim }}>{label}</span><span className="tb-b tabular-nums" style={{ color: ink }}>{value}</span></div>
    );
    const sq = Math.round(cell * 0.8);
    return (
      <div className="flex items-start" style={{ gap: 4 * P, width: sideW }}>
        <div className="flex flex-col tb-t" style={{ width: colW, gap: 5 * P, marginTop: cell }}>
          {handBox(0)}
          <div className="flex flex-col" style={{ gap: 3 * P, marginTop: P * 2 }}>
            {stat("SENT", g.sent[who], spiking ? GOLD : UI.text)}
            {stat("PIECES", st.pieces)}
            {stat("PPS", (elapsed > 0 ? st.pieces / elapsed : 0).toFixed(2))}
            {stat("LINES", st.lines)}
          </div>
        </div>
        <div className="flex flex-col items-center" style={{ gap: 2 * P }}>
          {/* Who this board is, and the spike building on it. */}
          <div className="flex items-center justify-between tb-t" style={{ width: boardW, height: cell - 2 * P }}>
            {(mine ? net.profile?.name : online && chatM?.opponent?.name)
              ? <button onClick={() => setProfileOf(mine ? { name: net.profile.name } : { name: chatM.opponent.name, guest: !!chatM.opponent.guest })} className="truncate tb-t text-left"
                  title="See their profile" style={{ color: mine ? "var(--tb-you)" : "var(--tb-rival)", textDecoration: "underline", textDecorationStyle: "dotted", textUnderlineOffset: 3 }}>{mine ? myName : oppName}</button>
              : <span className="truncate" style={{ color: mine ? "var(--tb-you)" : "var(--tb-rival)" }}>{mine ? myName : oppName}</span>}
            {spiking ? <span className="tb-b" style={{ color: GOLD }}>SPIKE {st.spike}</span> : null}
          </div>
          <div ref={mine ? boardEl : undefined} className="relative" style={{ width: boardW, height: boardW }}>
            <div style={{ display: "grid", gridTemplateColumns: `repeat(${S_SIZE}, ${cell}px)`, gap }}>
              {st.board.map((row, ri) => row.map((v, ci) => {
                const k = ri * S_SIZE + ci, hit = on.has(k);
                return (
                  <div key={k} data-v={mine ? v ?? "" : undefined} className={v === null && reds.has(k) && redFlash ? "tb-redflash" : undefined}
                    style={{ position: "relative", width: cell, height: cell, clipPath: Math.round(cell / P) >= 9 ? CLIP : CLIP1, ...(v === null ? (reds.has(k) ? RED_SQ : GLASS) : null) }}>
                    {v !== null && <Ink size={cell} color={inkOf(v)} />}
                    {hit && v === null && <div className="absolute inset-0" style={{ opacity: legal ? 0.9 : 0.6 }}><Ink size={cell} color={legal ? inkOf(a.id) : UI.bad} {...(legal ? null : { stroke: "ghost" })} /></div>}
                    {hit && v !== null && (<><div className="absolute inset-0" style={{ background: "rgba(8,6,16,.62)" }} /><div className="absolute inset-0" style={{ opacity: 0.9 }}><Ink size={cell} color={UI.bad} stroke="ghost" /></div></>)}
                  </div>
                );
              }))}
            </div>
            {g.vanish[who] && <VanishLayer key={g.vanish[who].key} cleared={g.vanish[who].cleared} cell={cell} gap={gap} ink={S_INK_ALL} />}
            {g.flash && g.flash.who === who && now - g.flash.key < 900 && (
              <div className="absolute inset-x-0 flex justify-center pointer-events-none tb-rise" style={{ top: 4 * P, zIndex: 4 }}>
                <span className="tb-t tb-b" style={{ color: UI.bad, padding: `${P}px ${3 * P}px`, background: "color-mix(in srgb, var(--tb-panel-solid) 82%, transparent)", clipPath: CLIP1 }}>+ JUNK {g.flash.level}</span>
              </div>
            )}
          </div>
        </div>
        <div className="flex flex-col items-start" style={{ width: colW, gap: 5 * P, marginTop: cell }}>
          <div className="w-full">{handBox(1)}</div>
          {/* The forecast: colours in a strip against the board; junk shows grey with its level. */}
          <div aria-label={`${who} forecast`} className="flex flex-col items-center" style={{ gap: 2 * P, padding: 2 * P, ...glass(UI.line) }}>
            {st.queue.slice(0, S_FORECAST + 1).map((id, i) => (
              <div key={i} role="img" aria-label={`${who} next ${i + 1}: ${blitzName(id)}`} className="relative flex items-center justify-center" style={{ opacity: i ? Math.max(0.5, 0.9 - i * 0.08) : 1 }}>
                <Ink size={sq} color={inkOf(id)} />
                {sIsJunk(id) && <span className="absolute tb-t tb-b" style={{ color: UI.text }}>{sJunkLevel(id)}</span>}
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="tb-screen tb-safe w-full flex flex-col font-mono select-none" style={{ color: UI.text, cursor: g && !g.result ? "crosshair" : undefined }}>
      <div ref={stageRef} className="relative flex-1 min-h-0 flex flex-col items-center w-full mx-auto px-3" style={{ maxWidth: 1600 }}>
        <div style={{ flex: 1, minHeight: 2 * P }} />
        <GameTitle mode={online ? "BLITZ" : "VS BOT"} />
        <div style={{ flex: 1, minHeight: 2 * P }} />
        {g ? (
          <div className="flex items-start" style={{ gap: 10 * P }}>
            {panel("me")}
            {panel("bot")}
          </div>
        ) : online ? (
          // Looking for an opponent.
          <div className="flex flex-col items-center tb-t" style={{ gap: 4 * P }}>
            <span className="tb-pulse" style={{ color: UI.dim }}>JOINING THE MATCH…</span>
            <button onClick={onExit} className="tb-t px-4" style={{ height: 38, ...sk(UI.line), color: UI.dim }}>MENU</button>
          </div>
        ) : (
          // The bot's skill: 1 (~0.6 a second, careless) to 10 (~3 a second, hunts big spikes).
          <div className="flex flex-col items-center tb-t" style={{ gap: 4 * P, width: 300 }}>
            <div className="flex items-baseline justify-between w-full"><span style={{ color: UI.dim }}>BOT SKILL</span><span className="tb-b" style={{ color: "#F29A4A" }}>{skill}</span></div>
            <PixelSlider min={1} max={10} value={skill} onChange={setSkill} ink="#F29A4A" label="Bot skill" className="w-full" />
            <span style={{ color: UI.dim }}>about {botPps(skill).toFixed(1)} pieces a second · {skill >= 8 ? "hunts combos and big spikes" : skill >= 5 ? "looks ahead" : "plays loosely"}</span>
            <button onClick={startBot} className="tb-t px-6" style={{ height: 40, ...skFill("#F29A4A"), color: UI.text }}>START</button>
          </div>
        )}
        <div className="flex items-center justify-end" style={{ width: "100%", maxWidth: 2 * sideW + 10 * P, gap: 3 * P, marginTop: 3 * P }}>
          {g && <Bubble w={railD} h={railD} label={`${online ? "New match" : "Retry"} (${keyOf("retry")})`} onClick={() => act("retry")}><RefreshCw /></Bubble>}
          {!g || g.result ? <Bubble w={railD} h={railD} label="Menu" onClick={onExit}><LogOut /></Bubble>
            : <ForfeitButton ranked={online} onConfirm={() => act("forfeit")} />}
        </div>
        <div style={{ flex: 2, minHeight: 2 * P }} />
        {/* vs bot: 3-2-1 here. Online, the match-found intro counts down. */}
        {g && !online && !g.result && <Countdown key={g.startAt} goAt={g.startAt} block={false} />}
      </div>
      {online && g && chatM && <ChatDock m={{ chat: chatM.chat || [], you: chatM.you, opponent: chatM.opponent, chatError: chatM.chatError }} colors={colors} />}
      {profileOf && <ProfilePopup name={profileOf.name} guest={profileOf.guest} onClose={() => setProfileOf(null)} />}
    </div>
  );
}

/* ============================================================
   GAME SOUNDS — what the hands do (turn, slide, pick up, switch modes)
   and what the board does when a turn resolves.
   ============================================================ */
function useGameSfx({ pl, act, canAct, turnKey }) {
  const prev = useRef({ rot: 0, idx: null, pos: null, mode: act.mode, staged: null, dragging: false });
  useEffect(() => {
    const p = prev.current;
    const { rot, handIdx, pos } = pl.sel;
    if (canAct) {
      if (handIdx !== null && p.idx !== null && rot !== p.rot) sfx.rotate(rot > p.rot ? 1 : -1);
      const pk = pos ? `${pos[0]},${pos[1]}` : null;
      if (pk && p.pos && pk !== p.pos && handIdx !== null) sfx.move(RULES.stamp && act.mode !== "place" ? true : pl.ghostLegal);
      if (pl.dragging && !p.dragging) sfx.pick();
      if (act.staged && act.staged !== p.staged) sfx.pinStage();
      else if (act.mode !== p.mode && !sfx.recent("lockIn", 250)) sfx.mode(act.mode);
    }
    prev.current = { rot, idx: handIdx, pos: pos ? `${pos[0]},${pos[1]}` : null, mode: act.mode, staged: act.staged, dragging: pl.dragging };
  });
  // Your move: a ping (after the reveal has had its moment).
  useEffect(() => {
    if (!canAct) return;
    const t = setTimeout(() => sfx.yourTurn(), 120);
    return () => clearTimeout(t);
  }, [canAct, turnKey]);
}

/** A resolved turn, as the sound engine wants it. */
function revealSound(moves, { contested = [], lines, shrink = null }) {
  const ms = moves.filter(Boolean);
  const kind = (m) => m.type || "place";
  sfx.reveal({
    placed: ms.filter((m) => kind(m) === "place").length,
    deleted: ms.filter((m) => kind(m) === "delete").length,
    pinned: ms.filter((m) => m.pin || (m.pins && m.pins.length)).length,
    contested: contested.length,
    lines: lines ? (lines.rows?.length || 0) + (lines.cols?.length || 0) : 0,
    shrink,
  });
}
/** Matches and Marathon are played in silence: the menu's music fades away. */
function useGameMusic() {
  useEffect(() => { music.stop(); }, []);
}
const lockKind = (raw) => (!raw || raw.type === "pass" ? "pass" : raw.type === "delete" ? "delete" : "place");

function LocalGame({ mode, aiLevel, loadout, colors, theme, onExit, onRestart }) {
  useEffect(() => { sky.slow = true; return () => { sky.slow = false; }; }, []);
  const [goAt] = useState(() => goTime()); // 3-2-1 before the first move
  const solo = mode === "SOLO";
  // TURN BASED is pass-and-play under the normal rules: both choose, then reveal.
  const turnBased = mode === "TURNBASED";
  const INK = useMemo(() => ({ A: colors.you, B: colors.rival, S: colors.special }), [colors]);

  const [board, setBoard] = useState(initialBoard);
  const [pins, setPins] = useState(emptyPins);          // permanent squares
  const [meters, setMeters] = useState({ A: 0, B: 0 }); // pins each side may spend
  const [ot, setOt] = useState(false);          // in overtime?
  const [otFlash, setOtFlash] = useState(null); // banner for this reveal: "OVERTIME" / "SHRINK"
  const [decided, setDecided] = useState(false); // this turn's check settled the match
  const [turn, setTurn] = useState(1);
  const [phase, setPhase] = useState("PLAY_A");
  // Same seed, same pieces in the same order (RULES.sharedSequence). Kept for the replay.
  const [seeds] = useState(() => { const sd = newSeed(); return { A: sd, B: RULES.sharedSequence ? sd : newSeed() }; });
  const [decks, setDecks] = useState(() => ({ A: newDeck(loadout, seeds.A), B: newDeck(loadout, seeds.B) }));
  // The game in Tesella notation, for the replay; and player 1's action as sent, this turn.
  const logRef = useRef([]);
  const rawARef = useRef(null);
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
  const act = useActions({ board, pins, owner: player, meter: meters[player], enabled: inPlay, boardRef: pl.boardRef, onLeavePlace: RULES.stamp ? undefined : pl.reset });
  const stamp = useStamp({ board, pins, owner: player, meter: meters[player], act, pl });
  useGameSfx({ pl, act, canAct: inPlay, turnKey: `${turn}${player}` });
  // PIN switched on: the piece you place next lands pinned (spends a charge).
  // Tied to the turn it was switched on in, so it switches itself off after.
  const [pinFor, setPinFor] = useState(null);
  const pinKey = `${turn}${player}`;
  const pinOn = pinFor === pinKey;
  const setPinOn = (on) => setPinFor(on ? pinKey : null);
  useGameMusic();
  useEffect(() => {
    if (reveal) revealSound([reveal.a, reveal.b], { contested: reveal.contested, lines: reveal.lines, shrink: otFlash });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reveal]);
  const contestedKeys = useMemo(() => new Set((reveal ? reveal.contested : []).map(([r, c]) => key(r, c))), [reveal]);
  const stuck = useMemo(() => (inPlay ? !hasAnyMove(board, hand, player) : false), [board, hand, player, inPlay]);

  const P = usePx();
  const compact = useCompact();
  const railD = useBubble(compact);
  const { g, side, cell, boardW, boardH, groupW, pane } = gameLayout(stage, theme, P, railD, compact);

  // The match is over: keep it as a replay.
  useEffect(() => {
    if (phase !== "DONE" || !logRef.current.length) return;
    const sc = scoreOf(board);
    replays.save({
      v: REPLAY_VERSION, date: Date.now(), mode: solo ? "solo" : "hotseat", you: solo ? "A" : null,
      players: { A: { name: solo ? "YOU" : "P1" }, B: { name: solo ? oppName : "P2" } },
      seeds, turns: logRef.current,
      result: { a: sc.a, b: sc.b, reason: forfeitBy ? "forfeit" : lockedOut ? "locked" : ot ? "overtime" : "turns", forfeitBy },
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

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
    const res = resolveTurn(board, mA, mB, pins);
    // Scoring check: a tie starts (or continues) overtime — the outer live
    // ring dies. Down to the centre 2×2, those four squares decide it.
    let settled = false, flash = null;
    if (isCheckTurn(turn)) {
      const sc = scoreOf(res.board);
      if (sc.a !== sc.b || !RULES.overtime) settled = true;
      else {
        flash = ot ? "SHRINK" : "OVERTIME";
        const { cleared, live } = shrinkBoard(res.board, res.pins);
        res.cleared.push(...cleared);
        setOt(true);
        if (live <= 2) settled = true;
      }
    }
    setDecided(settled);
    setOtFlash(flash);
    setBoard(res.board);
    setPins(res.pins);
    setMeters((m) => nextMeters(m, mA, mB, res.deleted));
    setReveal({ contested: res.contested, cleared: res.cleared, lines: res.lines, a: mA, b: mB });
    setPhase("REVEAL");
  };

  const handOver = (move) => { setPendingA(move); setPhase(solo ? "AI_THINK" : "HANDOFF"); };

  // Pins riding along with this move (when pinning is free).
  const extra = act.staged && RULES.pinIsFree ? { pins: act.staged } : null;
  const canCommit = inPlay && (stamp.on ? stamp.ok : act.mode === "delete" ? act.deleteValid : act.mode === "pin" ? act.pinValid : pl.ghostLegal);
  const send = (raw) => {
    // Stamps arrive as footprints; the engine turns them into what they hit.
    const { move, error } = normalizeAction(board, pins, meters[player], player, piece, raw);
    if (error) { sfx.illegal(); return; }
    sfx.lockIn(lockKind(raw));
    if (player === "A") rawARef.current = { raw, piece };
    else logRef.current.push(encodeTurn(encodeAction(rawARef.current?.raw, rawARef.current?.piece), encodeAction(raw, piece)));
    advance(player);
    if (player === "A") handOver(move); else finish(pendingA, move);
    pl.reset();
    act.reset();
    setPinOn(false);
  };
  const commit = () => {
    if (!inPlay) return;
    if (stamp.on) {
      if (!stamp.ok) { sfx.illegal(); return; }
      if (act.mode === "delete") send({ type: "delete", cells: stamp.foot, ...extra });
      else { act.setStaged(stamp.foot); act.setMode("place"); }
      return;
    }
    if (act.mode === "delete") {
      if (act.deleteValid) send({ type: "delete", cells: act.trace, ...extra });
      return;
    }
    if (act.mode === "pin") {
      if (!act.pinValid) return;
      if (RULES.pinIsFree) { act.confirmPins(); pl.select(0); } else send({ type: "pin", cells: act.trace });
      return;
    }
    if (pl.sel.handIdx === null || !pl.ghost || !pl.ghostLegal) { sfx.illegal(); return; }
    if (pinOn) sfx.pinStage();
    send({ type: "place", cells: pl.ghost, value: BLOCKS[piece].cells.length, blockId: piece, ...extra, ...(pinOn ? { pin: true } : null) });
  };

  // Passing spends the current piece without placing it (free pins still land).
  const discard = () => send(extra ? { type: "pass", ...extra } : null);

  const onMode = (m) => {
    if (RULES.pinToggle && m === "pin") {
      if (!pinOn && meters[player] < 1) { sfx.illegal(); return; }
      if (pinOn) sfx.toggle(false); else sfx.mode("pin");
      setPinOn(!pinOn);
      if (act.mode !== "place") act.setMode("place");
      setTimeout(() => pl.select(0), 0);
      return;
    }
    if (RULES.pinToggle && m === "delete") setPinOn(false);
    act.setMode(m); if (RULES.stamp || m === "place" || m === act.mode) setTimeout(() => pl.select(0), 0);
  };
  const shownMode = pinOn && act.mode === "place" ? "pin" : act.mode;
  useGameKeys(pl, { enabled: inPlay, onCommit: commit, onDiscard: discard, onMode, mode: shownMode });

  // Each turn starts with the piece already in hand: under the cursor with a
  // mouse, on the nearest legal square on a touch screen.
  useEffect(() => {
    if (inPlay && !stuck) pl.select(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inPlay, turn, player]);

  useEffect(() => {
    if (phase !== "AI_THINK") return;
    const t = setTimeout(() => {
      const pieceB = currentPiece(decks.B);
      // The top strength plays the turn as simultaneous: it predicts your reply (see aiPickActionDeep).
      const raw = aiLevel >= LEVELS.length
        ? aiPickActionDeep({ board, pins, meters }, pieceB, "B", currentPiece(decks.A), { next: upcoming(decks.B)[0] })
        : aiPickAction({ board, pins, meters }, pieceB, "B", aiLevel, LEVELS.length);
      // Stamps → what they hit (an AI pin stamp only pins its own squares, and pays for those).
      const move = raw ? normalizeAction(board, pins, meters.B, "B", pieceB, raw).move || null : null;
      logRef.current.push(encodeTurn(encodeAction(rawARef.current?.raw, rawARef.current?.piece), encodeAction(move ? raw : null, pieceB)));
      advance("B");
      finish(pendingA, move);
    }, AI_THINK_MS);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  useEffect(() => {
    if (phase !== "REVEAL") return;
    const t = setTimeout(() => {
      setReveal(null);
      setPendingA(null);
      // Locked: neither player can place any piece of their deck anywhere
      // (and, with deleting on, there's nothing left to delete).
      const deletable = RULES.actions && board.some((row, r) => row.some((v, c) => v !== null && v !== "X" && !pins[r][c]));
      const locked = !deletable && !hasAnyMove(board, loadout, "A") && !hasAnyMove(board, loadout, "B");
      setOtFlash(null);
      if (locked || decided) {
        setLockedOut(locked);
        setPhase("DONE");
      }
      else { setTurn((t2) => t2 + 1); setPhase("PLAY_A"); }
    }, REVEAL_MS);
    return () => clearTimeout(t);
  }, [phase, board, pins, turn, loadout, decided]);

  if (showEnd) {
    // A forfeit decides it regardless of the score.
    const winner = forfeitBy ? (forfeitBy === "A" ? "B" : "A") : score.a > score.b ? "A" : score.b > score.a ? "B" : null;
    const verdict = !winner ? "DRAW"
      : winner === "A" ? (solo ? "VICTORY" : "PLAYER 1 WINS")
      : solo ? "DEFEAT" : "PLAYER 2 WINS";
    const note = forfeitBy ? (solo ? "you forfeited" : `player ${forfeitBy === "A" ? 1 : 2} forfeited`)
      : lockedOut ? "board locked — no legal moves left"
      : ot ? (winner ? `decided in overtime, turn ${turn}` : "still tied at the centre") : null;
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

  const traceKeys = new Set((stamp.on ? stamp.foot || [] : act.trace).map(([r, c]) => key(r, c)));
  const stagedKeys = new Set(stamp.stagedHits.map(([r, c]) => key(r, c)));
  const cur = inPlay ? player : "A"; // whose pieces the forecast shows
  const rail = {
    ink: INK[player], turn, ot, bag: currentPass(decks[cur]),
    onRotate: () => pl.rotate(1), onCommit: commit, onDiscard: discard,
    canRotate: inPlay && act.mode === "place" && pl.sel.handIdx !== null, canCommit, canDiscard: inPlay,
    mode: shownMode, onMode, meter: meters[player], canMode: inPlay,
    forfeit: {
      disabled: phase === "DONE",
      onConfirm: () => { sfx.forfeit(); pl.reset(); setForfeitBy(solo ? "A" : player); setPhase("DONE"); },
    },
  };

  return (
    <div className="tb-screen tb-safe w-full flex flex-col font-mono" style={{ color: UI.text }}>
      <Countdown goAt={goAt} />
      <div className="tb-col relative flex-1 min-h-0 flex flex-col w-full mx-auto px-3" style={{ maxWidth: PHONE_W }}>
        <div ref={stageRef} className="flex-1 min-h-0 flex flex-col items-center">
          <div style={{ flex: 1, minHeight: 4 * P }} />
          <GameTitle mode={turnBased ? "TURN BASED" : solo ? "AI" : "LAN"} />
          <div style={{ flex: 2, minHeight: 4 * P }} />
          <div className="flex flex-col items-center" style={{ gap: 3 * P }}>
            {/* One forecast: both players are dealt the same pieces. It follows whoever is to move. */}
            <TopBar
              width={groupW} compact={compact} pane={pane}
              ink={INK[cur]} dir={cur === "B" ? -1 : 1} now={currentPiece(decks[cur])} queue={upcoming(decks[cur])}
              card={inPlay ? (
                <NowCard pane={pane} id={piece} ink={INK[player]} dir={player === "B" ? -1 : 1} selected={pl.sel.handIdx === 0}
                  dragging={pl.dragging || pl.holding} onPress={pl.onCardPointerDown} />
              ) : null}
              left={{ name: solo ? "YOU" : "P1", ink: INK.A, meter: meters.A, rating: solo ? net.profile?.rating?.r : null }}
              right={{ name: oppName, ink: INK.B, meter: meters.B, busy: phase === "AI_THINK" }}
            />
            {compact && <HMeter a={score.a} b={score.b} inkA={INK.A} inkB={INK.B} width={boardW} />}

            <div className="flex items-center" style={{ gap: side }}>
              {!compact && <MeterColumn a={score.a} b={score.b} inkA={INK.A} inkB={INK.B} height={boardH} />}
              <div className="relative" style={{ width: boardW, height: boardH }}>
                <BoardGrid
                  board={board} cell={cell} ink={INK} theme={theme} youSide={player}
                  pendingKeys={phase === "AI_THINK" && pendingA ? new Set(pendingA.cells.map(([r, c]) => key(r, c))) : null}
                  pendingInk={INK.A}
                  ghostKeys={stamp.on ? EMPTY_SET : pl.ghostKeys} ghostLegal={pl.ghostLegal}
                  ghostInk={INK[player]} ghostPinned={pinOn && act.mode === "place"}
                  contestedKeys={contestedKeys} boardRef={pl.boardRef}
                  onPointerDown={(e) => (act.mode === "place" || RULES.stamp ? pl.onBoardPointerDown(e, commit) : act.onPointerDown(e))}
                  otFlash={phase === "REVEAL" ? otFlash : null}
                  pins={pins} traceKeys={traceKeys} traceKind={act.mode} traceOk={stamp.on ? stamp.ok : act.deleteValid || act.pinValid} stagedKeys={stagedKeys}
                />

                {reveal && (
                  <VanishLayer contested={reveal.contested} cleared={reveal.cleared} cell={cell} gap={g} ink={INK} />
                )}

                {pl.drag && pl.rotated && (
                  <FloatingPiece
                    cells={pl.rotated} cell={cell} gap={g}
                    color={stamp.on ? (act.mode === "delete" ? UI.bad : UI.text) : INK[player]} legal={stamp.on ? stamp.ok : pl.ghostLegal}
                    dir={player === "B" ? -1 : 1}
                    x={pl.drag.x} y={pl.drag.y} lift={pl.drag.lift} faint={pl.holding && !!pl.sel.pos}
                  />
                )}

                {phase === "HANDOFF" && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center text-center px-5"
                    style={{ background: "repeating-conic-gradient(rgba(10,9,16,.62) 0 25%, rgba(10,9,16,.42) 0 50%) 0 0 / calc(var(--p) * 2) calc(var(--p) * 2)", zIndex: 4 }}>
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

            <BoardLine width={boardW} />
            {compact && <ActionRow width={boardW} {...rail} />}
          </div>
          <div style={{ flex: 3, minHeight: 4 * P }} />
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
  const [profileOf, setProfileOf] = useState(null); // { name, guest } — a player's profile popup
  // What you locked in this turn, shown until the reveal replaces it.
  const [placed, setPlaced] = useState(null);
  const [now, setNow] = useState(Date.now());
  const [stageRef, stage] = useSize();

  useEffect(() => {
    const offE = net.on("error", (e) => { sfx.error(); setErr(e); setTimeout(() => setErr(null), 2500); });
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
  const pins = m?.pins || EMPTY_PINS;
  const meter = m?.meters?.me ?? 0;
  const act = useActions({ board, pins, owner: you, meter, enabled: canAct, boardRef: pl.boardRef, flip, onLeavePlace: RULES.stamp ? undefined : pl.reset });
  const stamp = useStamp({ board, pins, owner: you, meter, act, pl });
  useGameSfx({ pl, act, canAct, turnKey: m?.turn });
  const [pinFor, setPinFor] = useState(null);
  const pinOn = pinFor !== null && pinFor === m?.turn;
  const setPinOn = (on) => setPinFor(on ? m?.turn : null);
  useGameMusic();
  useEffect(() => {
    const rv = m?.reveal;
    if (rv) revealSound([rv.moves?.A, rv.moves?.B], { contested: rv.contested, lines: rv.lines, shrink: m.shrunk ? (m.otStarted ? "OVERTIME" : "SHRINK") : null });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [m?.reveal]);
  useEffect(() => { if (m?.oppReady) sfx.oppReady(); }, [m?.oppReady]);
  // A private room has no matchmaking screen: the match itself is the arrival.
  const arrival = useRef(!!m?.room && !m?.resumed);
  useEffect(() => { if (arrival.current) sfx.matchFound(); }, []);
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
  const railD = useBubble(compact);
  const { g, side, cell, boardW, boardH, groupW, pane } = gameLayout(stage, theme, P, railD, compact);

  const secsLeft = m?.deadline ? Math.max(0, Math.ceil((m.deadline - now) / 1000)) : null;
  // The last five seconds tick.
  useEffect(() => { if (canAct && secsLeft !== null && secsLeft > 0 && secsLeft <= 5) sfx.tick(secsLeft); }, [secsLeft, canAct]);
  const graceLeft = m?.graceUntil ? Math.max(0, Math.ceil((m.graceUntil - now) / 1000)) : null;

  // Pins riding along with this move (when pinning is free).
  const pinsOut = act.staged && RULES.pinIsFree ? act.staged : undefined;
  const canCommit = canAct && (stamp.on ? stamp.ok : act.mode === "delete" ? act.deleteValid : act.mode === "pin" ? act.pinValid : pl.ghostLegal);
  const commit = () => {
    if (!canAct) return;
    if (stamp.on) {
      if (!stamp.ok) { sfx.illegal(); return; }
      if (act.mode === "pin") { act.setStaged(stamp.foot); act.setMode("place"); return; }
      sfx.lockIn("delete");
      setPlaced({ turn: m.turn, cells: [], handIdx: 0 });
      net.erase({ turn: m.turn, cells: stamp.foot, pins: pinsOut });
      pl.reset(); act.reset();
      return;
    }
    if (act.mode === "delete") {
      if (!act.deleteValid) { sfx.illegal(); return; }
      sfx.lockIn("delete");
      setPlaced({ turn: m.turn, cells: [], handIdx: 0 });
      net.erase({ turn: m.turn, cells: act.trace, pins: pinsOut });
    } else if (act.mode === "pin") {
      if (!act.pinValid) return;
      if (RULES.pinIsFree) { act.confirmPins(); pl.select(0); return; }
      setPlaced({ turn: m.turn, cells: [], handIdx: 0 });
      net.send({ t: "pin", turn: m.turn, cells: act.trace });
    } else {
      if (!pl.ghostLegal || pl.sel.handIdx === null) { sfx.illegal(); return; }
      sfx.lockIn("place");
      if (pinOn) sfx.pinStage();
      // Show the block where it went (dotted, not yet real) until the turn resolves.
      setPlaced({ turn: m.turn, cells: pl.ghost, handIdx: pl.sel.handIdx });
      net.move({ turn: m.turn, handIdx: pl.sel.handIdx, rot: ((pl.sel.rot % 4) + 4) % 4, pos: pl.sel.pos, pins: pinsOut, pin: pinOn });
      setPinOn(false);
    }
    pl.reset();
    act.reset();
  };

  // With nothing picked (the drop key), the first block in hand goes.
  const discard = () => {
    const idx = pl.sel.handIdx ?? hand.findIndex((id) => id !== undefined);
    if (idx < 0) return;
    sfx.lockIn("pass");
    setPlaced({ turn: m.turn, cells: [], handIdx: idx });
    net.discard({ turn: m.turn, handIdx: idx, pins: pinsOut });
    pl.reset();
    act.reset();
  };

  const onMode = (md) => {
    if (RULES.pinToggle && md === "pin") {
      if (!pinOn && meter < 1) { sfx.illegal(); return; }
      if (pinOn) sfx.toggle(false); else sfx.mode("pin");
      setPinOn(!pinOn);
      if (act.mode !== "place") act.setMode("place");
      setTimeout(() => pl.select(0), 0);
      return;
    }
    if (RULES.pinToggle && md === "delete") setPinOn(false);
    act.setMode(md); if (RULES.stamp || md === "place" || md === act.mode) setTimeout(() => pl.select(0), 0);
  };
  const shownMode = pinOn && act.mode === "place" ? "pin" : act.mode;
  useGameKeys(pl, { enabled: canAct, onCommit: commit, onDiscard: discard, onMode, mode: shownMode });

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
    ink: colors.you, turn: m.turn, ot: !!m.ot, bag: m.pass || 1,
    onRotate: () => pl.rotate(1), onCommit: commit, onDiscard: discard,
    canRotate: canAct && act.mode === "place" && pl.sel.handIdx !== null, canCommit, canDiscard: canAct,
    mode: shownMode, onMode, meter, canMode: canAct,
    waiting: !!m.submitted && !m.reveal,
    timer: graceLeft !== null ? (
      <NumBox value={graceLeft} color={GOLD} label={`Reconnect: ${graceLeft}s`} />
    ) : theme.showTimer && secsLeft !== null ? (
      <NumBox value={secsLeft} color={secsLeft <= 5 ? UI.bad : GOLD} label={`${secsLeft}s left`} />
    ) : null,
    forfeit: { ranked: m.rated !== false, disabled: !m || !!m.over, onConfirm: () => { sfx.forfeit(); net.forfeit(); } },
  };

  return (
    <div className="tb-screen tb-safe w-full flex flex-col font-mono" style={{ color: UI.text }}>
      <div className="tb-col relative flex-1 min-h-0 flex flex-col w-full mx-auto px-3" style={{ maxWidth: PHONE_W }}>
        <div ref={stageRef} className="flex-1 min-h-0 flex flex-col items-center">
          <div style={{ flex: 1, minHeight: 4 * P }} />
          <GameTitle mode={m.room ? "PRIVATE" : m.rated === false ? "UNRANKED" : "COMPETITIVE"} />
          <div style={{ flex: 2, minHeight: 4 * P }} />
          <div className="flex flex-col items-center" style={{ gap: 3 * P }}>
            {/* One forecast: both players are dealt the same pieces. */}
            <TopBar
              width={groupW} compact={compact} pane={pane}
              ink={colors.you} dir={you === "B" ? -1 : 1} queue={m.queue || []}
              card={(
                <NowCard pane={pane} id={piece} ink={colors.you} dir={you === "B" ? -1 : 1}
                  selected={pl.sel.handIdx === 0} dragging={pl.dragging || pl.holding}
                  onPress={pl.onCardPointerDown} disabled={!canAct} spent={!!pending} />
              )}
              left={{ name: "YOU", ink: colors.you, meter, rating: net.profile?.guest ? null : net.profile?.rating?.r,
                onOpen: net.profile?.name ? () => setProfileOf({ name: net.profile.name, guest: !!net.profile.guest }) : null }}
              right={{
                name: err || `${m.opponent.name}${m.oppReady ? " ✓" : ""}`, ink: err ? UI.bad : colors.rival,
                meter: m.meters?.opp ?? 0, rating: m.opponent.guest ? null : m.opponent.rating, busy: !!m.oppReady,
                onOpen: () => setProfileOf({ name: m.opponent.name, guest: !!m.opponent.guest }),
              }}
            />
            {compact && <HMeter a={myScore} b={theirScore} inkA={colors.you} inkB={colors.rival} width={boardW} />}

            <div className="flex items-center" style={{ gap: side }}>
              {!compact && <MeterColumn a={myScore} b={theirScore} inkA={colors.you} inkB={colors.rival} height={boardH} />}
              <div className="relative" style={{ width: boardW, height: boardH }}>
                <div className="relative" style={{ transform: flip ? "rotate(180deg)" : "none" }}>
                  <BoardGrid
                    board={board} cell={cell} ink={INK} theme={theme} youSide={you}
                    ghostKeys={stamp.on ? EMPTY_SET : pl.ghostKeys} ghostLegal={pl.ghostLegal} ghostInk={colors.you} ghostPinned={pinOn && act.mode === "place"}
                    pendingKeys={pendingKeys} pendingInk={colors.you}
                    contestedKeys={contestedKeys} boardRef={pl.boardRef}
                    onPointerDown={(e) => (act.mode === "place" || RULES.stamp ? pl.onBoardPointerDown(e, commit) : act.onPointerDown(e))}
                    otFlash={m.reveal && m.shrunk ? (m.otStarted ? "OVERTIME" : "SHRINK") : null}
                    pins={pins} traceKeys={new Set((stamp.on ? stamp.foot || [] : act.trace).map(([r, c]) => key(r, c)))} traceKind={act.mode}
                    traceOk={stamp.on ? stamp.ok : act.deleteValid || act.pinValid} stagedKeys={new Set(stamp.stagedHits.map(([r, c]) => key(r, c)))}
                  />
                  {m.reveal && (
                    <VanishLayer contested={m.reveal.contested} cleared={m.reveal.cleared} cell={cell} gap={g} ink={INK} />
                  )}
                </div>

                {pl.drag && pl.rotated && (
                  <FloatingPiece
                    cells={pl.rotated} cell={cell} gap={g}
                    color={stamp.on ? (act.mode === "delete" ? UI.bad : UI.text) : colors.you} legal={stamp.on ? stamp.ok : pl.ghostLegal} flip={flip}
                    dir={you === "B" ? -1 : 1}
                    x={pl.drag.x} y={pl.drag.y} lift={pl.drag.lift} faint={pl.holding && !!pl.sel.pos}
                  />
                )}

                {m.oppDropped && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center text-center px-5"
                    style={{ background: "color-mix(in srgb, var(--tb-ground) 94%, transparent)" }}>
                    <div className="tb-t mb-3" style={{ color: GOLD }}>OPPONENT DROPPED</div>
                    {graceLeft !== null && <div className="mb-3"><NumBox value={graceLeft} color={GOLD} label={`${graceLeft}s`} /></div>}
                    <div className="tb-t" style={{ color: UI.dim }}>
                      Holding their seat. If they don't return, you take the win.
                    </div>
                  </div>
                )}
              </div>
              {!compact && <ActionRail height={boardH} {...rail} />}
            </div>

            <BoardLine width={boardW} />
            {compact && <ActionRow width={boardW} {...rail} />}
          </div>
          <div style={{ flex: 3, minHeight: 4 * P }} />
        </div>
      </div>
      <ChatDock m={m} colors={colors} />
      {profileOf && <ProfilePopup name={profileOf.name} guest={profileOf.guest} onClose={() => setProfileOf(null)} />}
    </div>
  );
}

/* ============================================================
   WIPE — the wave that washes from the match to its result
   ============================================================ */
/** `wipe(atMiddle)`: runs the wave, calling `atMiddle` once the screen is covered. */
const WipeCtx = createContext((fn) => fn());

const WIPE_IN_MS = 1000, WIPE_HOLD_MS = 260, WIPE_OUT_MS = 1100;

/**
 * A pixel tide: a wavy front of foam rolls down the screen (and a little to
 * the right), deep water behind it fading from lavender to sea-green to the
 * dark, with bubbles rising through. Then it rolls on and uncovers what's next.
 */
function Wipe({ theme, onMiddle, onDone }) {
  const ref = useRef(null);
  const P = usePx();
  useEffect(() => {
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    sfx.wipe();
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
    const bubbles = Array.from({ length: Math.round(W * H / 1800) + 6 }, () => ({ x: Math.random() * W, y: Math.random() * H, v: 10 + Math.random() * 18, p: Math.random() * 6 }));
    const ease = (k) => (k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2);
    const F_END = 1.25; // where the incoming front stops: past the bottom-right corner
    const wave = new Float32Array(W);

    // Our own clock: a slow frame (the result screen mounting underneath)
    // just slows the tide for a moment instead of making it jump.
    let raf, clock = 0, last = null, middled = false;
    const frame = (t) => {
      clock += last === null ? 0 : Math.min(34, t - last);
      last = t;
      const el = clock;
      const out = el > WIPE_IN_MS + WIPE_HOLD_MS;
      if (!middled && el >= WIPE_IN_MS) { middled = true; onMiddle(); }
      if (el > WIPE_IN_MS + WIPE_HOLD_MS + WIPE_OUT_MS) { onDone(); return; }
      const kIn = ease(Math.min(1, el / WIPE_IN_MS));
      const kOut = out ? ease(Math.min(1, (el - WIPE_IN_MS - WIPE_HOLD_MS) / WIPE_OUT_MS)) : 0;
      const fIn = -0.2 + kIn * (F_END + 0.2);   // leading front
      const fOut = -0.2 + kOut * (F_END + 0.2); // trailing front, once the tide moves on
      const s = el / 1000;
      for (let x = 0; x < W; x++) wave[x] = Math.sin((x * P) * 0.012 + s * 3.2) * 0.035 + Math.sin((x * P) * 0.005 - s * 1.7) * 0.03;
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          // Mostly top to bottom, a little left to right, and wavy.
          const v = (y / H) * 0.8 + (x / W) * 0.2 + wave[x];
          const o = (y * W + x) * 4;
          const depth = fIn - v;   // how far behind the leading front
          const tail = v - fOut;   // how far ahead of the trailing front
          if (depth < 0 || (out && tail < 0)) { d[o + 3] = 0; continue; }
          const th = BAYER[(y & 3) * 4 + (x & 3)];
          // Foam at either front, then lavender, sea-green and the deep — one
          // dithered gradient that holds still while the tide passes.
          const edge = out ? Math.min(depth, tail) : depth;
          let c;
          if (edge < 0.025) c = th < 0.75 ? foam : lav;
          else if (edge < 0.06 && th < 0.25) c = foam;
          else {
            const z = Math.max(0, Math.min(STOPS.length - 1.001, (depth - 0.06) / 0.28));
            const i = Math.floor(z);
            c = th < z - i ? STOPS[i + 1] : STOPS[i];
          }
          d[o] = c[0]; d[o + 1] = c[1]; d[o + 2] = c[2]; d[o + 3] = 255;
        }
      }
      // Bubbles: soft rings drifting up through the water.
      const blend = (x, y, a) => {
        if (x < 0 || y < 0 || x >= W || y >= H) return;
        const o = (y * W + x) * 4;
        if (!d[o + 3]) return;
        d[o] += (foam[0] - d[o]) * a; d[o + 1] += (foam[1] - d[o + 1]) * a; d[o + 2] += (foam[2] - d[o + 2]) * a;
      };
      for (const b of bubbles) {
        b.y -= b.v * 0.016; if (b.y < -2) { b.y = H + 2; b.x = Math.random() * W; }
        const x = Math.floor(b.x + Math.sin(b.p + s * 2) * 1.5), y = Math.floor(b.y);
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
      <NumBox value={score} color={ink} label={`${name}: ${score}`} />
    </div>
  );
}

function EndScreen({ verdict, ink, note, left, right, special = 0, children, actions, sound = null, compare = true }) {
  const P = usePx();
  useEffect(() => {
    const kind = sound || (verdict === "DRAW" || verdict === "GAME OVER" ? "draw" : verdict === "DEFEAT" ? "lose" : "win");
    const t = setTimeout(() => (kind === "draw" ? sfx.draw() : kind === "lose" ? sfx.lose() : sfx.win()), 150);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <div className="tb-screen tb-safe w-full flex flex-col items-center justify-center px-6 font-mono" style={{ color: UI.text }}>
      <Scaled className="relative w-full" style={{ maxWidth: 400 }}>
        <div className="flex flex-col items-center text-center tb-rise" style={{
          gap: 6 * P, padding: `${10 * P}px ${8 * P}px`,
          // See-through, like the game's buttons: tinted glass over the sky.
          background: "color-mix(in srgb, var(--tb-text) 6%, color-mix(in srgb, var(--tb-panel-solid) 22%, transparent))",
          boxShadow: `inset 0 ${P}px 0 color-mix(in srgb, var(--tb-text) 30%, transparent), inset 0 -${P}px 0 rgba(0,0,0,.3), inset ${P}px 0 0 color-mix(in srgb, var(--tb-text) 12%, transparent), inset -${P}px 0 0 rgba(0,0,0,.2)`,
          clipPath: CLIP,
        }}>
          <div className="flex items-center tb-bob" style={{ gap: 4 * P }}>
            <Ink size={6 * P} color={ink} />
            <div className="tb-t tb-b" style={{ color: ink, letterSpacing: P, textShadow: `${P}px ${P}px 0 rgba(0,0,0,.5)` }}>{verdict}</div>
            <Ink size={6 * P} color={ink} />
          </div>
          <PixelRule />
          <div className="flex items-stretch w-full" style={{ gap: 3 * P }}>
            <EndSide {...left} won={compare ? left.score > right.score : !!left.won} />
            <div className="flex items-center tb-t" style={{ color: UI.dim }}>{compare ? "vs" : "·"}</div>
            <EndSide {...right} won={compare ? right.score > left.score : !!right.won} />
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
   PRIVATE ROOM — 1v1 a friend with a code; guests welcome
   ============================================================ */
const useRoom = () => useSyncExternalStore(subs.room, () => net.room);
// Re-render on room errors / guest errors too (they ride the same event).
const useRoomRev = () => { const [, bump] = useState(0); useEffect(() => net.on("room", () => bump((n) => n + 1)), []); };

/** Step one for anyone without an account: a name, and you're a guest. */
function GuestNameForm() {
  useRoomRev();
  const [guestName, setGuestName] = useState(() => net.guestInfo?.name || "");
  const field = { height: 46, ...glass(UI.line), color: UI.text, background: "color-mix(in srgb, var(--tb-text) 6%, transparent)", outline: "none" };
  return (
    <form onSubmit={(e) => { e.preventDefault(); if (guestName.trim()) net.playAsGuest(guestName.trim()); }} className="flex flex-col gap-2.5">
      <div className="tb-t" style={{ color: UI.dim }}>Pick a name to play as a guest.</div>
      <input value={guestName} onChange={(e) => setGuestName(e.target.value)} maxLength={16} autoFocus
        placeholder="your name" className="tb-t px-3 w-full" style={field} aria-label="Guest name" />
      {net.guestError && <div className="tb-t" style={{ color: UI.bad }}>{net.guestError}</div>}
      <button type="submit" disabled={!guestName.trim()} className="tb-t disabled:opacity-40" style={{ height: 46, ...skFill(UI.text), color: UI.text }}>PLAY AS GUEST</button>
      <div className="tb-t text-center" style={{ color: UI.dim, opacity: 0.8 }}>Have an account? Log in from the menu instead.</div>
    </form>
  );
}

/** Unranked: anyone (guests too) against whoever's searching. Ratings don't move. */
/** The link a friend opens to land straight in your room. */
const roomLink = (code) => `${location.origin}${location.pathname}?room=${code}`;

function PrivateRoom({ status, onBack, pendingCode, clearPending }) {
  const P = usePx();
  useRoomRev();
  const room = useRoom();
  const auth = useAuth();
  const profile = useProfile();
  const [code, setCode] = useState(pendingCode || "");
  const [copied, setCopied] = useState(false);
  const known = auth === "authed" || auth === "guest";
  const online = status === "online";

  // Opened from an invite link: join as soon as we have a name.
  useEffect(() => {
    if (known && online && pendingCode && !room) { net.joinRoom(pendingCode); clearPending(); }
  }, [known, online, pendingCode, room, clearPending]);

  const field = { height: 46, ...glass(UI.line), color: UI.text, background: "color-mix(in srgb, var(--tb-text) 6%, transparent)", outline: "none" };
  const big = (main) => ({ height: 46, ...(main ? skFill(UI.text) : glass(UI.line)), color: main ? UI.text : UI.dim });
  const leave = () => { net.leaveRoom(); onBack(); };

  let body;
  if (!online) {
    body = <div className="tb-t text-center py-6" style={{ color: UI.dim }}>Connecting to the server…</div>;
  } else if (!known) {
    // Step 1: a name. Guests need nothing else.
    body = <GuestNameForm />;
  } else if (!room) {
    // Step 2: make a room, or join one.
    body = (
      <div className="flex flex-col gap-2.5">
        <button onClick={() => net.createRoom()} className="tb-t" style={big(true)}>CREATE ROOM</button>
        <div className="flex items-center gap-2 tb-t" style={{ color: UI.dim }}>
          <span className="flex-1" style={{ ...RULE_BELOW, height: P }} /> or join <span className="flex-1" style={{ ...RULE_BELOW, height: P }} />
        </div>
        <form onSubmit={(e) => { e.preventDefault(); if (code.trim()) net.joinRoom(code.trim()); }} className="flex gap-2">
          <input value={code} onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 5))}
            placeholder="CODE" className="tb-t tb-b px-3 flex-1 min-w-0 text-center" style={{ ...field, letterSpacing: 3 * P }} aria-label="Room code"
            autoCapitalize="characters" autoComplete="off" spellCheck={false} />
          <button type="submit" disabled={code.length < 5} className="tb-t px-4 disabled:opacity-40" style={big(false)}>JOIN</button>
        </form>
        {net.roomError && <div className="tb-t" style={{ color: UI.bad }}>{net.roomError}</div>}
      </div>
    );
  } else {
    // Step 3: the room — share the code, wait, or ask for a rematch.
    const share = async () => {
      const text = `Play me in Tesella — room ${room.code}`;
      try {
        if (navigator.share) await navigator.share({ title: "Tesella", text, url: roomLink(room.code) });
        else { await navigator.clipboard.writeText(roomLink(room.code)); setCopied(true); setTimeout(() => setCopied(false), 1600); }
      } catch { /* cancelled */ }
    };
    const copyCode = async () => { try { await navigator.clipboard.writeText(room.code); setCopied(true); setTimeout(() => setCopied(false), 1600); } catch { /* no clipboard */ } };
    body = (
      <div className="flex flex-col items-center gap-3 text-center">
        <div className="tb-t" style={{ color: UI.dim }}>{room.host ? "Your room. Send this code to a friend:" : "In room"}</div>
        <button onClick={copyCode} title="Copy code" className="tb-t tb-b w-full" aria-label={`Room code ${room.code}, tap to copy`}
          style={{ ...glass(UI.text), padding: `${4 * P}px 0`, letterSpacing: 4 * P, color: UI.text }}>
          {room.code.split("").map((ch, i) => <span key={i} style={{ display: "inline-block" }}>{ch}</span>)}
        </button>
        <div className="flex gap-2 w-full">
          <button onClick={copyCode} className="tb-t flex-1" style={big(false)}>{copied ? "COPIED" : "COPY CODE"}</button>
          <button onClick={share} className="tb-t flex-1" style={big(false)}>SHARE LINK</button>
        </div>
        {!room.opponent ? (
          <div className="tb-t tb-pulse py-2" style={{ color: UI.dim }}>Waiting for your friend…</div>
        ) : room.playing ? (
          <div className="tb-t py-2" style={{ color: UI.dim }}>Starting…</div>
        ) : (
          <>
            <div className="tb-t py-1">vs <span style={{ color: "var(--tb-rival)" }}>{room.opponent.name}</span>{room.opponent.guest ? <span style={{ color: UI.dim }}> (guest)</span> : null}</div>
            <button onClick={() => net.rematch()} disabled={room.rematch.me} className="tb-t w-full disabled:opacity-60" style={big(true)}>
              {room.rematch.me ? (room.rematch.them ? "STARTING…" : "WAITING FOR THEM…") : room.rematch.them ? "THEY WANT A REMATCH — PLAY" : "REMATCH"}
            </button>
          </>
        )}
        {net.roomError && <div className="tb-t" style={{ color: UI.bad }}>{net.roomError}</div>}
      </div>
    );
  }

  return (
    <div className="tb-screen tb-safe w-full flex flex-col items-center justify-center px-5 font-mono" style={{ color: UI.text }}>
      <Scaled className="w-full" style={{ maxWidth: 340 }}>
        <div className="flex items-center justify-between mb-4">
          <button onClick={room ? leave : onBack} className="flex items-center gap-1 tb-t py-2" style={{ color: UI.dim }}>
            <ChevronLeft size={13} /> {room ? "LEAVE" : "MENU"}
          </button>
          <div className="tb-t" style={{ color: UI.dim }}>
            PRIVATE{profile?.name ? <span> · {profile.name}{auth === "guest" ? " (guest)" : ""}</span> : null}
          </div>
        </div>
        <div style={{ padding: 6 * P, ...glass(UI.line) }}>{body}</div>
        <div className="tb-t text-center mt-3" style={{ color: UI.dim, opacity: 0.75 }}>Private games are unrated.</div>
      </Scaled>
    </div>
  );
}

/* ============================================================
   REPLAYS — every game you play, kept on this device
   ============================================================ */
const useReplayList = () => useSyncExternalStore(replays.subscribe, replays.all);
const MODE_LABEL = { ranked: "RANKED", unranked: "UNRANKED", private: "PRIVATE", solo: "SOLO", hotseat: "TAKE TURNS" };
const fmtDate = (t) => { try { return new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric" }) + " " + new Date(t).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" }); } catch { return ""; } };

/** Names from the viewer's side: "you" on the left when there's a you. */
function replaySides(rec) {
  const me = rec.you || "A", them = me === "A" ? "B" : "A";
  return { me, them, meName: rec.you ? "YOU" : rec.players.A.name, themName: rec.players[them].name };
}

const REPLAY_TABS = [["all", "ALL"], ["match", "CONTROL"], ["blitz", "BLITZ"], ["sprint", "SPRINT"], ["ultra", "ULTRA"], ["marathon", "MARATHON"]];
function ReplayList({ onOpen, onBack }) {
  const P = usePx();
  const all = useReplayList();
  const [tab, setTab] = useState(() => store.get("tb:replayTab") || "all");
  const pick = (k) => { setTab(k); store.set("tb:replayTab", k); };
  const list = all.filter((r) => tab === "all" || (tab === "match" ? !r.kind : r.kind === tab));
  const [code, setCode] = useState("");
  const [err, setErr] = useState(null);
  const doImport = () => {
    try { const id = replays.save({ ...importReplay(code), id: undefined }); setCode(""); setErr(null); onOpen(id); }
    catch (e) { setErr(e.message); }
  };
  return (
    <div className="tb-screen tb-safe w-full flex flex-col items-center px-5 font-mono" style={{ color: UI.text }}>
      <Scaled className="w-full flex flex-col" style={{ maxWidth: 380, height: "100%", paddingTop: 24, paddingBottom: 16 }}>
        <div className="flex items-center justify-between mb-3 shrink-0">
          <button onClick={onBack} className="flex items-center gap-1 tb-t py-2" style={{ color: UI.dim }}><ChevronLeft size={13} /> MENU</button>
          <div className="tb-t" style={{ color: UI.dim }}>REPLAYS</div>
        </div>
        <form onSubmit={(e) => { e.preventDefault(); if (code.trim()) doImport(); }} className="flex gap-2 mb-1 shrink-0">
          <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="paste a replay code" aria-label="Replay code"
            className="tb-t px-3 flex-1 min-w-0" style={{ height: 40, ...glass(UI.line), color: UI.text, outline: "none" }} />
          <button type="submit" disabled={!code.trim()} className="tb-t px-3 disabled:opacity-40" style={{ height: 40, ...glass(UI.line), color: UI.dim }}>OPEN</button>
        </form>
        {err && <div className="tb-t mb-1" style={{ color: UI.bad }}>{err}</div>}
        {/* What to show. */}
        <div className="flex flex-wrap gap-1.5 mt-2 shrink-0">
          {REPLAY_TABS.map(([k, label]) => (
            <button key={k} onClick={() => pick(k)} aria-pressed={tab === k} className="tb-t px-2"
              style={{ height: 30, ...(tab === k ? skFill(GOLD) : glass(UI.line)), color: tab === k ? UI.text : UI.dim }}>{label}</button>
          ))}
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto mt-2 flex flex-col gap-2 pr-1">
          {!list.length && <div className="tb-t text-center py-10" style={{ color: UI.dim }}>No replays here yet. Every game you finish is saved here.</div>}
          {list.map((rec) => {
            if (rec.kind === "blitz") {
              const them = rec.you === "A" ? "B" : "A";
              const won = rec.winner === rec.you;
              return (
                <button key={rec.id} onClick={() => onOpen(rec.id)} className="w-full text-left flex items-center gap-3 px-3 py-2" style={{ ...glass(UI.line) }}>
                  <div className="flex-1 min-w-0">
                    <div className="tb-t truncate">{rec.names?.[rec.you] || "YOU"} <span style={{ color: UI.dim }}>vs</span> {rec.names?.[them] || "?"}</div>
                    <div className="tb-t truncate" style={{ color: UI.dim }}>{rec.ranked ? "BLITZ · RANKED" : rec.names?.[them]?.startsWith("BOT") ? "BLITZ · VS BOT" : "BLITZ"} · {fmtDate(rec.date)}</div>
                  </div>
                  <div className="tb-t tb-b shrink-0" style={{ color: won ? "var(--tb-you)" : "var(--tb-rival)" }}>{won ? "WIN" : "LOSS"}</div>
                </button>
              );
            }
            if (rec.kind) {
              const main = rec.kind === "sprint" ? fmtClock(rec.result?.ms || 0) : (rec.result?.score || 0).toLocaleString("en-US");
              return (
                <button key={rec.id} onClick={() => onOpen(rec.id)} className="w-full text-left flex items-center gap-3 px-3 py-2" style={{ ...glass(UI.line) }}>
                  <div className="flex-1 min-w-0">
                    <div className="tb-t truncate">{rec.kind.toUpperCase()}</div>
                    <div className="tb-t truncate" style={{ color: UI.dim }}>{rec.moves.length} pieces · {fmtDate(rec.date)}</div>
                  </div>
                  <div className="tb-t tb-b tabular-nums shrink-0" style={{ color: "var(--tb-you)" }}>{main}</div>
                </button>
              );
            }
            const { me, them, meName, themName } = replaySides(rec);
            const my = rec.result?.[me.toLowerCase()] ?? 0, their = rec.result?.[them.toLowerCase()] ?? 0;
            const ink = my > their ? "var(--tb-you)" : my < their ? "var(--tb-rival)" : UI.dim;
            return (
              <button key={rec.id} onClick={() => onOpen(rec.id)} className="w-full text-left flex items-center gap-3 px-3 py-2" style={{ ...glass(UI.line) }}>
                <div className="flex-1 min-w-0">
                  <div className="tb-t truncate">{meName} <span style={{ color: UI.dim }}>vs</span> {themName}</div>
                  <div className="tb-t truncate" style={{ color: UI.dim }}>{MODE_LABEL[rec.mode] || "GAME"} · {rec.turns.length} turns · {fmtDate(rec.date)}</div>
                </div>
                <div className="tb-t tb-b tabular-nums shrink-0" style={{ color: ink, textShadow: `${P}px ${P}px 0 rgba(0,0,0,.4)` }}>{my}–{their}</div>
              </button>
            );
          })}
        </div>
      </Scaled>
    </div>
  );
}

/* ============================================================
   REPLAY SOUND AND VIDEO — Sprint, Ultra, Marathon and Blitz
   ============================================================ */
/** The sounds a frame made in the game: the piece locking in, a clear, junk landing. */
function replayFrameSound(prev, f, blitz) {
  if (!prev || !f) return;
  if (blitz) {
    if (f.junk) { sfx.reveal({ lines: Math.min(4, f.junk) }); return; }
    if (f.redOut) { sfx.forfeit(); return; }
    if (!f.side) return;
    sfx.lockIn("place");
    const lines = f[f.side].lines - prev[f.side].lines;
    if (lines > 0) sfx.reveal({ lines });
    return;
  }
  if (!f.cells) return;
  sfx.lockIn("place");
  const lines = (f.lines || 0) - (prev.lines || 0);
  if (lines > 0) sfx.reveal({ lines });
}
/** Plays the sounds of the frames a playing replay just passed (the newest few, at high speeds). */
function useReplaySfx(frames, i, playing, blitz) {
  const lastRef = useRef(i);
  useEffect(() => {
    const from = lastRef.current;
    lastRef.current = i;
    if (!playing || i <= from || i - from > 8) return;
    for (let k = Math.max(from + 1, i - 2); k <= i; k++) replayFrameSound(frames[k - 1], frames[k], blitz);
  }, [i, playing, frames, blitz]);
}
const frameAt = (frames, time) => { let i = 0; while (i + 1 < frames.length && frames[i + 1].t <= time) i++; return i; };

/** Draws one moment of a replay onto a 1280×720 canvas, in the game's colours and font. */
function paintReplay(ctx, rec, frames, time, look) {
  const W = 1280, H = 720;
  const i = frameAt(frames, time), f = frames[i];
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, look.top); g.addColorStop(1, look.bottom);
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  ctx.textBaseline = "middle";
  const text = (s, x, y, color, size = 20, align = "left") => { ctx.font = `${size}px Silkscreen, monospace`; ctx.textAlign = align; ctx.fillStyle = color; ctx.fillText(s, x, y); };
  const tile = (x, y, s, color, alpha = 1) => {
    ctx.globalAlpha = alpha;
    ctx.fillStyle = color; ctx.fillRect(x, y, s, s);
    ctx.fillStyle = "rgba(255,255,255,.28)"; ctx.fillRect(x, y, s, Math.max(1, s / 9)); ctx.fillRect(x, y, Math.max(1, s / 9), s);
    ctx.fillStyle = "rgba(0,0,0,.25)"; ctx.fillRect(x, y + s - Math.max(1, s / 9), s, Math.max(1, s / 9)); ctx.fillRect(x + s - Math.max(1, s / 9), y, Math.max(1, s / 9), s);
    ctx.globalAlpha = 1;
  };
  const slot = (x, y, s) => { ctx.fillStyle = "rgba(255,255,255,.07)"; ctx.fillRect(x, y, s, s); ctx.fillStyle = "rgba(0,0,0,.18)"; ctx.fillRect(x, y + s - 2, s, 2); };
  const board = (x, y, cell, gap, b, ink, just, reds = null) => {
    const n = b.length;
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
      const px = x + c * (cell + gap), py = y + r * (cell + gap), v = b[r][c];
      if ((v === null || v === undefined) && reds?.has(r * n + c)) { ctx.fillStyle = "#5A1622"; ctx.fillRect(px, py, cell, cell); ctx.fillStyle = "#7A2330"; ctx.fillRect(px, py, cell, 2); }
      else if (v === null || v === undefined) slot(px, py, cell); else tile(px, py, cell, ink(v));
      if (just && just.has(r * n + c)) { ctx.strokeStyle = look.text; ctx.lineWidth = 3; ctx.strokeRect(px + 1.5, py + 1.5, cell - 3, cell - 3); }
    }
  };
  const piece = (cx, cy, id, s, gap) => {
    const sh = sShapeOf(id, 0);
    const w = sh.w * s + (sh.w - 1) * gap, h = sh.h * s + (sh.h - 1) * gap;
    for (const [r, c] of sh.cells) tile(cx - w / 2 + c * (s + gap), cy - h / 2 + r * (s + gap), s, S_INK_ALL[id]);
  };
  const box = (x, y, w, h) => { ctx.fillStyle = "rgba(255,255,255,.06)"; ctx.fillRect(x, y, w, h); ctx.strokeStyle = "rgba(255,255,255,.18)"; ctx.lineWidth = 2; ctx.strokeRect(x + 1, y + 1, w - 2, h - 2); };
  const kind = rec.kind;
  text("TESELLA", W / 2, 44, look.text, 34, "center");
  if (kind === "blitz") {
    const me = rec.you || "A", them = me === "A" ? "B" : "A";
    text(`BLITZ · ${fmtClock(time)}`, W / 2, 86, "#F29A4A", 22, "center");
    const lastOf = (s) => { for (let k = i; k > 0; k--) if (frames[k].side === s && frames[k].cells) return frames[k]; return null; };
    const cell = 50, gap = 4, bw = 8 * cell + 7 * gap;
    [me, them].forEach((s, k) => {
      const ox = k === 0 ? 40 : W / 2 + 20, oy = 150;
      const b = f[s], lp = lastOf(s);
      const just = new Set(lp && time - lp.t < 400 ? lp.cells.map(([r, c]) => r * 8 + c) : []);
      text(`${rec.names?.[s] || s}${rec.winner === s && time >= frames[frames.length - 1].t ? " ★" : ""}`, ox, oy - 22, s === me ? look.you : look.rival, 20);
      if (f.side === s && f.junk && time - f.t < 700) text(`+ JUNK ${f.junk}`, ox + bw, oy - 22, look.bad, 20, "right");
      board(ox, oy, cell, gap, b.board, (v) => (sIsJunk(v) ? JUNK_INK : S_INK[v]), just, sRedCells(b.board, f.red?.[s] || 0));
      const sx = ox + bw + 16;
      b.hand.forEach((id, h) => { box(sx, oy + h * 76, 120, 68); piece(sx + 60, oy + h * 76 + 34, id, sIsJunk(id) ? 7 : 14, 2); });
      b.queue.forEach((id, q) => { tile(sx, oy + 160 + q * 40, 32, sIsJunk(id) ? JUNK_INK : S_INK[id], q ? 0.85 : 1); if (sIsJunk(id)) text(String(sJunkLevel(id)), sx + 16, oy + 176 + q * 40, look.text, 16, "center"); });
      const secs = Math.max(0.001, time / 1000);
      text(`SENT ${f.sent[s]}   PIECES ${b.pieces}   PPS ${(b.pieces / secs).toFixed(2)}`, ox, oy + bw + 30, look.dim, 18);
    });
    return;
  }
  const marathon = kind === "marathon";
  const N = marathon ? M_SIZE : S_SIZE;
  const cell = Math.floor(470 / N) - 4, gap = 4, bw = N * cell + (N - 1) * gap;
  const ox = (W - bw) / 2, oy = 130;
  text(marathon ? `MARATHON · ${f.score.toLocaleString("en-US")}` : `${kind.toUpperCase()} · ${fmtClock(kind === "ultra" ? Math.max(0, S_ULTRA_MS - time) : time)}`, W / 2, 90, look.you, 24, "center");
  const lp = f.cells && time - f.t < 400 ? new Set(f.cells.map(([r, c]) => r * N + c)) : null;
  board(ox, oy, cell, gap, f.board, (v) => (marathon ? M_INK[v] : S_INK_ALL[v]), lp);
  if (!marathon) {
    const sx = ox + bw + 24;
    f.hand.forEach((id, h) => { box(sx, oy + h * 86, 140, 76); piece(sx + 70, oy + h * 86 + 38, id, 16, 2); });
    f.queue.forEach((id, q) => tile(sx, oy + 184 + q * 46, 36, S_INK_ALL[id], q ? 0.85 : 1));
  }
  const stats = [kind === "ultra" || marathon ? `SCORE ${f.score.toLocaleString("en-US")}` : null, `LINES ${f.lines}`, f.pieces != null ? `PIECES ${f.pieces}` : null].filter(Boolean);
  text(stats.join("    "), W / 2, oy + bw + 34, look.dim, 20, "center");
  if (rec.name) text(rec.name, ox, oy - 22, look.you, 18);
}

/**
 * Records a replay to a video file: the replay is drawn on a canvas in real
 * time, its sounds mixed in, and the browser's recorder makes an MP4 (or a
 * WebM where MP4 can't be recorded).
 */
async function recordReplayVideo(rec, frames, { onProgress, stopRef }) {
  if (typeof MediaRecorder === "undefined") throw new Error("This browser can't record video.");
  try { await document.fonts.load("20px Silkscreen"); } catch { /* the fallback font will do */ }
  const css = getComputedStyle(document.documentElement);
  const v = (n, d) => css.getPropertyValue(n).trim() || d;
  const look = { top: v("--tb-ground", "#1c1b33"), bottom: v("--tb-panel-solid", "#26304a"), text: v("--tb-text", "#f4f1ff"), dim: v("--tb-dim", "#a99fd0"), you: v("--tb-you", "#7cc7bf"), rival: v("--tb-rival", "#e88fb4"), bad: "#ff6b7a" };
  const canvas = document.createElement("canvas");
  canvas.width = 1280; canvas.height = 720;
  const ctx = canvas.getContext("2d");
  const stream = canvas.captureStream(30);
  // The game's sounds go into the video too.
  const audio = core();
  let tap = null;
  if (audio) { tap = audio.ctx.createMediaStreamDestination(); audio.mix.connect(tap); tap.stream.getAudioTracks().forEach((t) => stream.addTrack(t)); unlock(); }
  const types = ["video/mp4;codecs=avc1.42E01E,mp4a.40.2", "video/mp4;codecs=avc1.42E01E", "video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm"];
  const mimeType = types.find((t) => MediaRecorder.isTypeSupported(t)) || "";
  const rec2 = new MediaRecorder(stream, mimeType ? { mimeType, videoBitsPerSecond: 6_000_000 } : undefined);
  const chunks = [];
  rec2.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
  const done = new Promise((res) => { rec2.onstop = res; });
  const blitz = rec.kind === "blitz";
  const end = frames[frames.length - 1].t + 1500; // a moment on the final board
  paintReplay(ctx, rec, frames, 0, look);
  rec2.start(500);
  const t0 = performance.now();
  let last = 0;
  await new Promise((res) => {
    const id = setInterval(() => {
      const time = Math.min(end, performance.now() - t0);
      const i = frameAt(frames, time);
      for (let k = last + 1; k <= i; k++) replayFrameSound(frames[k - 1], frames[k], blitz);
      last = i;
      paintReplay(ctx, rec, frames, time, look);
      onProgress?.(time / end);
      if (time >= end || stopRef.current) { clearInterval(id); res(); }
    }, 1000 / 30);
  });
  rec2.stop();
  await done;
  if (tap) { try { audio.mix.disconnect(tap); } catch { /* already gone */ } }
  stream.getTracks().forEach((t) => t.stop());
  if (stopRef.current) return null;
  const type = rec2.mimeType || mimeType || "video/webm";
  return { blob: new Blob(chunks, { type }), ext: type.includes("mp4") ? "mp4" : "webm" };
}

/** The SAVE VIDEO button for a replay, with progress and cancel. */
function VideoButton({ rec, frames, onStart }) {
  const P = usePx();
  const [state, setState] = useState(null); // null | { p } while recording | { error }
  const stopRef = useRef(false);
  const go = async () => {
    stopRef.current = false;
    onStart?.();
    setState({ p: 0 });
    try {
      const out = await recordReplayVideo(rec, frames, { onProgress: (p) => setState({ p }), stopRef });
      if (out) {
        const a = document.createElement("a");
        a.href = URL.createObjectURL(out.blob);
        a.download = `tesella-${rec.kind}-${new Date(rec.date || Date.now()).toISOString().slice(0, 10)}.${out.ext}`;
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 10000);
      }
      setState(null);
    } catch (e) { setState({ error: e.message || "Couldn't record." }); }
  };
  if (state && state.p != null) {
    return (
      <button onClick={() => { stopRef.current = true; }} className="tb-t px-3" title="Cancel" style={{ height: 32, ...skFill(GOLD), color: UI.text }}>
        RECORDING {Math.round(state.p * 100)}% · CANCEL
      </button>
    );
  }
  return (
    <span className="flex items-center" style={{ gap: 2 * P }}>
      <button onClick={go} className="tb-t px-3" title="Records the replay at normal speed, with sound, and downloads it" style={{ height: 32, ...glass(GOLD), color: GOLD }}>SAVE VIDEO</button>
      {state?.error && <span className="tb-t" style={{ color: UI.bad }}>{state.error}</span>}
    </span>
  );
}

const SPEEDS = [0.5, 1, 2, 4];

/**
 * A solo replay (Sprint, Ultra, Marathon): the run rebuilt from its seed,
 * placement by placement. Sprint and Ultra play back at their real speed
 * (every placement's time was recorded); Marathon at a steady pace.
 */
function soloFrames(rec) {
  if (rec.kind === "marathon") {
    const st = newMarathon(rec.seed), out = [{ t: 0, board: st.board.map((r) => r.slice()), score: 0, lines: 0 }];
    rec.moves.forEach((m, i) => {
      if (!mPlace(st, m[0], m[1], m[2], m[3] ?? 0)) return;
      out.push({ t: (i + 1) * 450, board: st.board.map((r) => r.slice()), score: st.score, lines: st.lines, cells: st.last.cells });
    });
    return out;
  }
  const st = newSprint(rec.seed, rec.kind === "ultra" ? Infinity : S_GOAL);
  const snap = (t, cells) => ({ t, board: st.board.map((r) => r.slice()), hand: st.hand.slice(), queue: st.queue.slice(0, 5), score: st.score, lines: st.lines, pieces: st.pieces, cells });
  const out = [snap(0)];
  for (const [t, slot, rot, r, c] of rec.moves) {
    const s = sShapeOf(st.hand[slot], rot);
    if (!sPlace(st, { slot, id: st.hand[slot], rot, cr: r + s.h / 2, cc: c + s.w / 2 })) break;
    out.push(snap(t, st.last.cells));
  }
  return out;
}

/** Playback over real time, shared by the solo and Blitz replays. */
function useTimedPlayback(end) {
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [speed, setSpeed] = useState(1);
  const live = useRef({ time: 0 });
  useEffect(() => {
    if (!playing) return undefined;
    let raf, last = performance.now();
    const loop = (now) => {
      raf = requestAnimationFrame(loop);
      const t = Math.min(end, live.current.time + (now - last) * speed);
      last = now; live.current.time = t; setTime(t);
      if (t >= end) setPlaying(false);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [playing, speed, end]);
  const seek = useCallback((t) => { live.current.time = Math.max(0, Math.min(end, t)); setTime(live.current.time); }, [end]);
  useEffect(() => {
    const on = (e) => {
      if (e.target && e.target.tagName === "INPUT") return;
      if (e.key === " ") { e.preventDefault(); if (live.current.time >= end) { seek(0); setPlaying(true); } else setPlaying((p) => !p); }
      else if (e.key === "ArrowRight") { e.preventDefault(); seek(live.current.time + 2000); }
      else if (e.key === "ArrowLeft") { e.preventDefault(); seek(live.current.time - 2000); }
    };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, [end, seek]);
  return { time, playing, setPlaying, speed, setSpeed, seek };
}

/** The page every replay uses: a header, the boards as big as fit, the transport at the bottom. */
function ReplayPage({ onBack, head, aside, stageRef, children, pb, rec, frames, ink, label }) {
  const P = usePx();
  const compact = useCompact();
  const d = useBubble(compact);
  const { time, playing, setPlaying, speed, setSpeed, seek } = pb;
  const end = frames[frames.length - 1].t;
  return (
    <div className="tb-screen tb-safe w-full flex flex-col font-mono" style={{ color: UI.text }}>
      <div className="relative flex-1 min-h-0 flex flex-col w-full mx-auto px-3" style={{ maxWidth: 1500 }}>
        <div className="flex items-center justify-between shrink-0 pt-3 pb-1 gap-2">
          <button onClick={onBack} className="flex items-center gap-1 tb-t py-2" style={{ color: UI.dim }}><ChevronLeft size={13} /> REPLAYS</button>
          <div className="tb-t truncate text-center" style={{ color: UI.dim }}>{head}</div>
          <div className="flex items-center gap-1 shrink-0">{aside}</div>
        </div>
        <div ref={stageRef} className="flex-1 min-h-0 flex items-center justify-center">{children}</div>
        {/* Transport: start · back · play · forward · end, speed, a scrubber, and the video. */}
        <div className="shrink-0 flex flex-col items-center gap-2 pt-2 pb-3">
          <PixelSlider min={0} max={Math.max(1, Math.ceil(end / 100))} value={Math.round(time / 100)} onChange={(v) => { setPlaying(false); seek(v * 100); }}
            ink={ink} label="Replay position" className="w-full" style={{ maxWidth: 720 }} />
          <div className="flex items-center justify-center flex-wrap" style={{ gap: 2 * P }}>
            <Bubble w={d} h={d} label="Start" onClick={() => { setPlaying(false); seek(0); }}><First /></Bubble>
            <Bubble w={d} h={d} label="Back 2 seconds" onClick={() => seek(time - 2000)}><ChevronLeft /></Bubble>
            <Bubble w={d + 8} h={d} label={playing ? "Pause" : "Play"} tint={ink} fill={30}
              onClick={() => { if (time >= end) { seek(0); setPlaying(true); } else setPlaying(!playing); }}>{playing ? <Pause /> : <Play />}</Bubble>
            <Bubble w={d} h={d} label="Forward 2 seconds" onClick={() => seek(time + 2000)}><ChevronRight /></Bubble>
            <Bubble w={d} h={d} label="End" onClick={() => { setPlaying(false); seek(end); }}><span style={{ display: "inline-flex", transform: "scaleX(-1)" }}><First /></span></Bubble>
            <div className="flex items-center" style={{ gap: P, marginLeft: 2 * P }}>
              {SPEEDS.map((sp) => (
                <button key={sp} onClick={() => setSpeed(sp)} className="tb-t px-1.5"
                  style={{ height: d * P, ...(speed === sp ? skFill(UI.text) : glass(UI.line)), color: speed === sp ? UI.text : UI.dim }}>{sp}×</button>
              ))}
            </div>
            <VideoButton rec={rec} frames={frames} onStart={() => setPlaying(false)} />
          </div>
          <div className="tb-t tabular-nums" style={{ color: UI.dim }}>{label}</div>
        </div>
      </div>
    </div>
  );
}

function SoloReplayViewer({ rec, onBack }) {
  const P = usePx();
  const frames = useMemo(() => soloFrames(rec), [rec]);
  const end = frames[frames.length - 1].t;
  const pb = useTimedPlayback(end);
  const { time, playing } = pb;
  const i = frameAt(frames, time);
  const f = frames[i];
  useReplaySfx(frames, i, playing, false);
  const [stageRef, stage] = useSize();
  const marathon = rec.kind === "marathon";
  const N = marathon ? M_SIZE : S_SIZE, gap = P;
  // As big as the stage allows: the board, and beside it the pieces in hand and next.
  const cols = N + (marathon ? 0 : 3.4);
  const cell = Math.max(4 * P, Math.min(26 * P, Math.floor(Math.min((stage.w - 16 * P) / cols, (stage.h - 30 * P) / N) / P) * P));
  const ink = (v) => (marathon ? M_INK[v] : S_INK_ALL[v]);
  const just = new Set((f.cells || []).map(([r, c]) => r * N + c));
  const clock = marathon ? f.score.toLocaleString("en-US") : fmtClock(rec.kind === "ultra" ? Math.max(0, S_ULTRA_MS - time) : time);
  const half = Math.max(P, Math.floor(cell / 2 / P) * P - P);
  return (
    <ReplayPage onBack={onBack} stageRef={stageRef} pb={pb} rec={rec} frames={frames} ink={marathon ? MODE_INK.marathon : rec.kind === "ultra" ? MODE_INK.ultra : MODE_INK.sprint}
      head={<>{rec.kind.toUpperCase()}{rec.name ? ` · ${rec.name}` : ""} · {fmtDate(rec.date)}</>}
      label={[rec.kind === "ultra" || marathon ? `score ${f.score.toLocaleString("en-US")}` : null, `${f.lines} lines`, !marathon ? `${f.pieces} pieces` : null].filter(Boolean).join(" · ")}>
      <div className="flex flex-col items-center" style={{ gap: 3 * P }}>
        <span className="tb-t tb-b tabular-nums" style={{ color: "var(--tb-you)", fontSize: "1.4em" }}>{clock}</span>
        <div className="flex items-start" style={{ gap: 4 * P }}>
          <div style={{ display: "grid", gridTemplateColumns: `repeat(${N}, ${cell}px)`, gap }}>
            {f.board.map((row, r) => row.map((v, c) => (
              <div key={r * N + c} style={{ width: cell, height: cell, position: "relative", clipPath: Math.round(cell / P) >= 9 ? CLIP : CLIP1, ...(v === null ? GLASS : null) }}>
                {v !== null && <Ink size={cell} color={ink(v)} />}
                {just.has(r * N + c) && <div className="absolute inset-0" style={{ boxShadow: `inset 0 0 0 ${P}px ${UI.text}` }} />}
              </div>
            )))}
          </div>
          {!marathon && (
            <div className="flex flex-col items-start" style={{ gap: 2 * P }}>
              {f.hand.map((id, k) => <div key={k} className="flex items-center justify-center" style={{ width: Math.round(cell * 2.3), height: Math.round(cell * 1.4), ...glass(UI.line) }}><SPiece id={id} cell={half} gap={P} /></div>)}
              <div className="flex flex-col items-center" style={{ gap: 2 * P, padding: 2 * P, ...glass(UI.line) }}>
                {f.queue.map((id, k) => <Ink key={k} size={Math.round(cell * 0.8)} color={S_INK_ALL[id]} />)}
              </div>
            </div>
          )}
        </div>
      </div>
    </ReplayPage>
  );
}


/**
 * A Blitz replay: both boards rebuilt from the seed and the match log, in
 * real time. The log has every placement and every junk landing with its
 * time, so nothing is re-simulated: what you see is what happened.
 */
function blitzFrames(rec) {
  const st = { A: newSprint(rec.seed, Infinity), B: newSprint(rec.seed, Infinity) };
  const sent = { A: 0, B: 0 }, red = { A: 0, B: 0 };
  const snap = (t, side, cells, junk) => ({
    t, side, cells, junk, sent: { ...sent }, red: { ...red },
    A: { board: st.A.board.map((r) => r.slice()), hand: st.A.hand.slice(), queue: st.A.queue.slice(0, S_FORECAST + 1), pieces: st.A.pieces, lines: st.A.lines },
    B: { board: st.B.board.map((r) => r.slice()), hand: st.B.hand.slice(), queue: st.B.queue.slice(0, S_FORECAST + 1), pieces: st.B.pieces, lines: st.B.lines },
  });
  const out = [snap(0)];
  for (const e of rec.moves) {
    const [t, side, slot] = e;
    const s = st[side];
    if (!s) break;
    if (slot === -3) { out.push({ ...snap(t, side, null), redOut: side }); continue; }
    if (slot === -1) {
      sReceiveJunk(s, e[3]);
      sent[side === "A" ? "B" : "A"]++;
      out.push(snap(t, side, null, e[3]));
      continue;
    }
    const [, , , rot, r, c] = e;
    const sh = sShapeOf(s.hand[slot], rot);
    if (!sPlace(s, { slot, id: s.hand[slot], rot, cr: r + sh.h / 2, cc: c + sh.w / 2 })) break;
    red[side] = 0;
    if (s.last.lines) red[side === "A" ? "B" : "A"] += s.last.lines;
    out.push(snap(t, side, s.last.cells));
  }
  return out;
}

function BlitzReplayViewer({ rec, colors, onBack }) {
  const P = usePx();
  const frames = useMemo(() => blitzFrames(rec), [rec]);
  const end = frames[frames.length - 1].t;
  const pb = useTimedPlayback(end);
  const { time, playing } = pb;
  const i = frameAt(frames, time);
  const f = frames[i];
  useReplaySfx(frames, i, playing, true);
  const [stageRef, stage] = useSize();
  const me = rec.you || "A", them = me === "A" ? "B" : "A";
  const gap = P;
  // Two boards with their strips, as big as fit side by side.
  const cell = Math.max(4 * P, Math.min(20 * P, Math.floor(Math.min((stage.w - 24 * P) / (2 * (S_SIZE + 3.2) + 1), (stage.h - 30 * P) / (S_SIZE + 1.6)) / P) * P));
  const half = Math.max(P, Math.floor(cell / 2 / P) * P - P);
  const inkOf = (id) => (sIsJunk(id) ? JUNK_INK : S_INK[id]);
  const lastOf = (side) => { for (let k = i; k > 0; k--) if (frames[k].side === side && frames[k].cells) return frames[k]; return null; };
  const side = (s) => {
    const b = f[s], lp = lastOf(s);
    const just = new Set(lp && time - lp.t < 400 ? lp.cells.map(([r, c]) => r * S_SIZE + c) : []);
    const reds = sRedCells(b.board, f.red?.[s] || 0), redFlash = f.redOut === s || sRedFull(b.board, f.red?.[s] || 0);
    const junkNow = f.side === s && f.junk && time - f.t < 700;
    const secs = Math.max(0.001, time / 1000);
    const bw = S_SIZE * (cell + gap) - gap;
    return (
      <div className="flex flex-col" style={{ gap: 2 * P }}>
        <div className="flex items-center justify-between tb-t" style={{ width: bw }}>
          <span className="truncate" style={{ color: s === me ? colors.you : colors.rival }}>{rec.names?.[s] || s}{rec.winner === s && time >= end ? " ★" : ""}</span>
          {junkNow && <span className="tb-b" style={{ color: UI.bad }}>+ JUNK {f.junk}</span>}
        </div>
        <div className="flex items-start" style={{ gap: 3 * P }}>
          <div style={{ display: "grid", gridTemplateColumns: `repeat(${S_SIZE}, ${cell}px)`, gap }}>
            {b.board.map((row, r) => row.map((v, c) => (
              <div key={r * S_SIZE + c} className={v === null && redFlash && reds.has(r * S_SIZE + c) ? "tb-redflash" : undefined}
                style={{ width: cell, height: cell, position: "relative", clipPath: Math.round(cell / P) >= 9 ? CLIP : CLIP1, ...(v === null ? (reds.has(r * S_SIZE + c) ? RED_SQ : GLASS) : null) }}>
                {v !== null && <Ink size={cell} color={inkOf(v)} />}
                {just.has(r * S_SIZE + c) && <div className="absolute inset-0" style={{ boxShadow: `inset 0 0 0 ${P}px ${UI.text}` }} />}
              </div>
            )))}
          </div>
          <div className="flex flex-col items-start" style={{ gap: 2 * P }}>
            {b.hand.map((id, k) => <div key={k} className="flex items-center justify-center" style={{ width: Math.round(cell * 2.2), height: Math.round(cell * 1.3), ...glass(UI.line) }}><SPiece id={id} cell={sIsJunk(id) ? Math.max(P, Math.floor(half / 2 / P) * P) : half} gap={P} /></div>)}
            <div className="flex flex-col items-center" style={{ gap: 2 * P, padding: 2 * P, ...glass(UI.line) }}>
              {b.queue.map((id, k) => (
                <div key={k} className="relative flex items-center justify-center"><Ink size={Math.round(cell * 0.7)} color={inkOf(id)} />{sIsJunk(id) && <span className="absolute tb-t" style={{ color: UI.text }}>{sJunkLevel(id)}</span>}</div>
              ))}
            </div>
          </div>
        </div>
        <div className="flex tb-t" style={{ gap: 5 * P, color: UI.dim }}>
          <span>SENT <span className="tb-b" style={{ color: UI.text }}>{f.sent[s]}</span></span>
          <span>PIECES <span className="tb-b" style={{ color: UI.text }}>{b.pieces}</span></span>
          <span>PPS <span className="tb-b" style={{ color: UI.text }}>{(b.pieces / secs).toFixed(2)}</span></span>
        </div>
      </div>
    );
  };
  return (
    <ReplayPage onBack={onBack} stageRef={stageRef} pb={pb} rec={rec} frames={frames} ink={MODE_INK.ranked}
      head={<><span style={{ color: colors.you }}>{rec.names?.[me] || "YOU"}</span> vs <span style={{ color: colors.rival }}>{rec.names?.[them] || "?"}</span> · {rec.ranked ? "BLITZ · RANKED" : "BLITZ"} · {fmtDate(rec.date)}</>}
      label={fmtClock(time)}>
      <div className="flex items-start" style={{ gap: 10 * P }}>{side(me)}{side(them)}</div>
    </ReplayPage>
  );
}

function ReplayViewer({ id, theme, colors, onBack }) {
  const P = usePx();
  const rec = useMemo(() => replays.get(id), [id]);
  const [profileOf, setProfileOf] = useState(null); // { name, guest } — a player's profile popup
  const { frames, error } = useMemo(() => (rec ? buildFrames(rec) : { frames: [], error: "Replay not found." }), [rec]);
  const last = Math.max(0, frames.length - 1);
  const [t, setT] = useState(last ? 0 : 0);
  const [playRequested, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  // Playing stops by itself at the last turn.
  const playing = playRequested && t < last;
  const [copied, setCopied] = useState(false);
  const [stageRef, stage] = useSize();
  const compact = useCompact();
  const d = useBubble(compact);

  // Each turn sounds as it did in the match, while playing.
  const heard = useRef(t);
  useEffect(() => {
    const from = heard.current;
    heard.current = t;
    if (!playing || t !== from + 1) return;
    const pl = frames[t]?.played;
    if (pl) revealSound([pl.moves?.A, pl.moves?.B], { contested: pl.res?.contested || [], lines: pl.res?.lines });
  }, [t, playing, frames]);
  // Play: one turn every 900 ms at 1×.
  useEffect(() => {
    if (!playing) return;
    const h = setTimeout(() => setT((x) => Math.min(last, x + 1)), 900 / speed);
    return () => clearTimeout(h);
  }, [playing, t, last, speed]);
  // Keyboard: ← → step, space play/pause, Home/End.
  useEffect(() => {
    const on = (e) => {
      if (e.target && e.target.tagName === "INPUT") return;
      if (e.key === "ArrowRight") { e.preventDefault(); setPlaying(false); setT((x) => Math.min(last, x + 1)); }
      else if (e.key === "ArrowLeft") { e.preventDefault(); setPlaying(false); setT((x) => Math.max(0, x - 1)); }
      else if (e.key === " ") { e.preventDefault(); if (t >= last) { setT(0); setPlaying(true); } else setPlaying(!playing); }
      else if (e.key === "Home") setT(0);
      else if (e.key === "End") setT(last);
    };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, [last, t, playing]);

  if (!rec || !frames.length) {
    return (
      <div className="tb-screen tb-safe w-full flex items-center justify-center font-mono" style={{ color: UI.dim }}>
        <div className="text-center"><div className="tb-t mb-4">{error || "Replay not found."}</div>
          <button onClick={onBack} className="tb-t px-4" style={{ height: 44, ...glass(UI.line), color: UI.dim }}>BACK</button></div>
      </div>
    );
  }

  const f = frames[t];
  const { meName, themName } = replaySides(rec);
  const INK = { A: rec.you === "B" ? colors.rival : colors.you, B: rec.you === "B" ? colors.you : colors.rival, S: colors.special };
  const nameA = rec.you === "B" ? themName : meName, nameB = rec.you === "B" ? meName : themName;
  // Online games name real players: tap a tag for their profile.
  const online = ["ranked", "unranked", "private"].includes(rec.mode);
  const openerFor = (side) => (online && rec.players?.[side]?.name
    ? () => setProfileOf({ name: rec.players[side].name, guest: !!rec.players[side].guest }) : null);

  // What changed on this turn: placed squares, deletes, new pins — outlined in the mover's colour.
  const marks = new Map();
  if (f.played) {
    for (const side of ["A", "B"]) {
      const m = f.played.moves[side];
      if (!m) continue;
      if (m.type === "place") for (const [r, c] of m.cells) if (f.board[r][c] === side) marks.set(key(r, c), INK[side]);
      if (m.type === "delete") for (const [r, c] of m.cells) marks.set(key(r, c), UI.bad);
      for (const [r, c] of m.pins || []) marks.set(key(r, c), "var(--tb-text)");
    }
  }

  // Layout: the board, centred, sized like a game.
  const area = { w: stage.w, h: stage.h + TITLE_H * P }; // no title block here
  const { cell, boardW, boardH, groupW, pane } = gameLayout(area, theme, P, d, true);
  const step = (dx) => { setPlaying(false); setT((x) => Math.max(0, Math.min(last, x + dx))); };
  const copy = async () => { try { await navigator.clipboard.writeText(exportReplay(rec)); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* no clipboard */ } };
  const res = rec.result || {};
  // The whole game in Tesella notation, as a text file.
  const download = () => {
    const lines = [
      "Tesella replay",
      `${nameA} (bottom) vs ${nameB} (top) · ${MODE_LABEL[rec.mode] || rec.mode} · ${new Date(rec.date).toISOString()}`,
      `Result: ${res.a}–${res.b}${res.reason ? ` (${res.reason})` : ""}`,
      `Seeds: ${rec.seeds.A} ${rec.seeds.B}`,
      "",
      "Squares a–j left to right, 1–10 from the bottom player's side. Piece.square.rotation (0 R 2 L);",
      "x = delete stamp, + = pin stamp, - = pass. Each line: bottom player / top player.",
      "",
      ...rec.turns.map((tt, i) => `${i + 1}. ${tt}`),
      "",
      `Replay code: ${exportReplay(rec)}`,
    ];
    const blob = new Blob([lines.join("\n") + "\n"], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const el = document.createElement("a");
    el.href = url;
    el.download = `tesella-${new Date(rec.date).toISOString().slice(0, 16).replace(/[:T]/g, "-")}.txt`;
    document.body.appendChild(el); el.click(); el.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return (
    <div className="tb-screen tb-safe w-full flex flex-col font-mono" style={{ color: UI.text }}>
      <div className="tb-col relative flex-1 min-h-0 flex flex-col w-full mx-auto px-3" style={{ maxWidth: 900 }}>
        <div className="flex items-center justify-between shrink-0 pt-3 pb-1 gap-2">
          <button onClick={onBack} className="flex items-center gap-1 tb-t py-2" style={{ color: UI.dim }}><ChevronLeft size={13} /> REPLAYS</button>
          <div className="tb-t truncate text-center" style={{ color: UI.dim }}>
            <span style={{ color: INK.A }}>{nameA}</span> {res.a}–{res.b} <span style={{ color: INK.B }}>{nameB}</span>
            {!compact && <span> · {MODE_LABEL[rec.mode] || ""} · {fmtDate(rec.date)}</span>}
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <button onClick={download} className="tb-t px-2 py-2" style={{ color: UI.dim }} title="Download the moves as a text file">DOWNLOAD MOVES</button>
            <button onClick={copy} className="tb-t px-2 py-2" style={{ color: UI.dim }} title="Copy a code a friend can paste into REPLAYS">{copied ? "COPIED" : "COPY CODE"}</button>
          </div>
        </div>

        <div ref={stageRef} className="flex-1 min-h-0 flex items-center justify-center">
          <div className="flex flex-col items-center" style={{ gap: 3 * P }}>
            <TopBar width={groupW} compact pane={pane} ink={INK.A} now={f.pieces.A} queue={f.queues.A}
              left={{ name: nameA, ink: INK.A, meter: f.meters.A, onOpen: openerFor("A") }}
              right={{ name: nameB, ink: INK.B, meter: f.meters.B, onOpen: openerFor("B") }} />
            <HMeter a={f.score.a} b={f.score.b} inkA={INK.A} inkB={INK.B} width={boardW} />
            <div className="relative" style={{ width: boardW, height: boardH }}>
              <BoardGrid board={f.board} pins={f.pins} cell={cell} ink={INK} theme={theme}
                ghostKeys={EMPTY_SET} ghostLegal={false} ghostInk={INK.A}
                contestedKeys={new Set((f.played?.res.contested || []).map(([r, c]) => key(r, c)))}
                boardRef={{ current: null }} onPointerDown={() => {}}
                marks={marks} otFlash={f.played?.flash || null} />
            </div>
            <BoardLine width={boardW} />
          </div>
        </div>

        {/* Transport: start · back · play · forward · end, speed, and a scrubber. */}
        <div className="shrink-0 flex flex-col items-center gap-2 pt-2 pb-3">
          <PixelSlider min={0} max={Math.max(1, last)} value={t} onChange={(v) => { setPlaying(false); setT(Math.min(last, v)); }}
            ink={colors.you} label="Turn" className="w-full" style={{ maxWidth: Math.max(groupW, 280) }} />
          <div className="flex items-center justify-center flex-wrap" style={{ gap: 2 * P }}>
            <Bubble w={d} h={d} label="Start" onClick={() => { setPlaying(false); setT(0); }}><First /></Bubble>
            <Bubble w={d} h={d} label="Back one turn" onClick={() => step(-1)}><ChevronLeft /></Bubble>
            <Bubble w={d + 8} h={d} label={playing ? "Pause" : "Play"} tint={colors.you} fill={30}
              onClick={() => { if (t >= last) { setT(0); setPlaying(true); } else setPlaying(!playing); }}>{playing ? <Pause /> : <Play />}</Bubble>
            <Bubble w={d} h={d} label="Forward one turn" onClick={() => step(1)}><ChevronRight /></Bubble>
            <Bubble w={d} h={d} label="End" onClick={() => { setPlaying(false); setT(last); }}><span style={{ display: "inline-flex", transform: "scaleX(-1)" }}><First /></span></Bubble>
            <div className="flex items-center" style={{ gap: P, marginLeft: 2 * P }}>
              {SPEEDS.map((sp) => (
                <button key={sp} onClick={() => setSpeed(sp)} className="tb-t px-1.5"
                  style={{ height: d * P, ...(speed === sp ? skFill(UI.text) : glass(UI.line)), color: speed === sp ? UI.text : UI.dim }}>{sp}×</button>
              ))}
            </div>
          </div>
          <div className="tb-t tabular-nums" style={{ color: UI.dim }}>
            {t === 0 ? "start" : `turn ${t} / ${last}`}{t > 0 ? ` · ${f.played.text[0]} / ${f.played.text[1]}` : ""}{f.ot ? " · overtime" : ""}{t === last && res.reason === "forfeit" ? " · forfeit" : ""}
          </div>
          {error && <div className="tb-t" style={{ color: UI.bad }}>{error}</div>}
        </div>
      </div>
      {profileOf && <ProfilePopup name={profileOf.name} guest={profileOf.guest} onClose={() => setProfileOf(null)} />}
    </div>
  );
}

/* ============================================================
   RESULT — ranked
   ============================================================ */
function Result(props) {
  return props.over?.rated === false ? <PrivateResult {...props} /> : <RankedResult {...props} />;
}

/** Private rooms are unrated: the result, and a rematch. */
function PrivateResult({ over, colors, onQueue, onMenu }) {
  const { won, drew, forfeit, reason, myScore, oppScore, special, opponent, room } = over;
  const note = forfeit ? "opponent forfeited" : reason === "forfeit" ? "you forfeited"
    : reason === "locked" ? "board locked — no legal moves left"
    : reason === "overtime" ? (drew ? "still tied at the centre" : "decided in overtime")
    : room ? "private game · unrated" : "unranked";
  return (
    <EndScreen
      verdict={drew ? "DRAW" : won ? "VICTORY" : "DEFEAT"} ink={drew ? UI.text : won ? colors.you : colors.rival} note={note} special={special}
      left={{ name: "YOU", score: myScore, ink: colors.you }}
      right={{ name: opponent.name, score: oppScore, ink: colors.rival }}
      actions={[
        { label: "MENU", onClick: onMenu },
        { label: room ? "REMATCH" : "PLAY AGAIN", onClick: onQueue, main: true },
      ]}
    />
  );
}

/**
 * The rating after a rated match: the rank, the number counting from old to
 * new, the change, progress to the next rank, and a banner on a promotion.
 */
function RatingPanel({ from, to, rdFrom, rdTo }) {
  const P = usePx();
  const trFrom = Math.round(from), trTo = Math.round(to);
  const delta = trTo - trFrom;
  const riFrom = rankIndexFor(trFrom);
  const riTo = rankIndexFor(trTo);
  const rank = RANKS[riTo];
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

  const progress = rankProgress(shown);
  const BAR = 40; // pixels
  return (
    <>
      <div className="w-full tb-rise" style={{ padding: 4 * P, ...GLASS, clipPath: CLIP, animationDelay: "200ms" }}>
        <div className="flex items-center" style={{ gap: 4 * P }}>
          <div className="flex flex-col items-center shrink-0" style={{ gap: 2 * P }}>
            <RankIcon rank={rank} size={20 * P} />
            <span className="tb-t" style={{ color: rank.color }}>{rank.name}</span>
          </div>
          <div className="flex-1 min-w-0 flex flex-col items-start" style={{ gap: 3 * P }}>
            <div className="flex items-end" style={{ gap: 4 * P }}>
              <NumBox value={shown} color={UI.text} label={`Rating ${shown}`} />
              <NumBox value={`${delta >= 0 ? "+" : "−"}${Math.abs(delta)}`} color={deltaInk} label={`Change ${delta}`} />
            </div>
            {/* Progress to the next rank, in whole pixels. */}
            <div aria-label={`${Math.round(progress * 100)}% to next rank`}
              style={{ width: BAR * P, height: 5 * P, ...sk(UI.dim), background: "color-mix(in srgb, var(--tb-ground) 60%, black)", position: "relative" }}>
              <div style={{
                position: "absolute", left: P, top: P, bottom: P, width: Math.round(progress * (BAR - 2)) * P,
                background: rank.color, boxShadow: `inset 0 ${P}px 0 rgba(255,255,255,.3)`,
              }} />
            </div>
            {rdTo != null && <div className="tb-t" style={{ color: UI.dim }}>±{Math.round(rdTo)} {rdFrom != null && <span style={{ opacity: 0.6 }}>from ±{Math.round(rdFrom)}</span>}</div>}
          </div>
        </div>
      </div>
      {riTo !== riFrom && (
        <div className="w-full tb-t text-center tb-rise" style={{ padding: 3 * P, ...skFill(rank.color), color: UI.text, animationDelay: "260ms" }}>
          {riTo > riFrom ? `PROMOTED TO ${rank.name}` : `DEMOTED TO ${rank.name}`}
        </div>
      )}
    </>
  );
}

function RankedResult({ over, colors, onQueue, onMenu }) {
  const { won, drew, forfeit, reason, myScore, oppScore, special, opponent, rating } = over;
  const verdictInk = drew ? UI.text : won ? colors.you : colors.rival;
  const note = forfeit ? "opponent forfeited" : reason === "forfeit" ? "you forfeited"
    : reason === "locked" ? "board locked — no legal moves left"
    : reason === "overtime" ? (drew ? "still tied at the centre" : "decided in overtime") : null;
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
      <RatingPanel from={rating.before.r} to={rating.after.r} rdFrom={rating.before.rd} rdTo={rating.after.rd} />
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
  useEffect(() => { installUiSounds(); }, []);
  useEffect(() => { setVolume(theme.sound ?? 7); }, [theme.sound]);
  useEffect(() => { music.setVolume(theme.music ?? 5); }, [theme.music]);
  // One pixel size for everything, from the screen: ~2 px on phones, 3 on
  // laptops, up to 5 on big monitors, so text stays readable and the board fits.
  // One pixel size for everything: 2 on phones and small windows, 3 on
  // laptops, 4 only on very large screens.
  const pickPx = () => (typeof window === "undefined" ? 2 :
    window.innerWidth >= 1700 && window.innerHeight >= 1100 ? 4 :
    window.innerWidth >= 900 && window.innerHeight >= 700 ? 3 : 2);
  const [P, setP] = useState(pickPx);
  useEffect(() => {
    const on = () => setP(pickPx());
    window.addEventListener("resize", on);
    return () => window.removeEventListener("resize", on);
  }, []);
  const [over, setOver] = useState(null);
  const [replayId, setReplayId] = useState(null);
  // The wave between a finished match and its result screen.
  const [wipeRun, setWipeRun] = useState(null);
  const wipe = useCallback((atMiddle) => setWipeRun((cur) => {
    if (cur) return cur;
    wipeDoneAt = performance.now() + WIPE_IN_MS + WIPE_HOLD_MS + WIPE_OUT_MS;
    return { id: Date.now(), atMiddle };
  }), []);
  // A ranked match found: the ping, the white, the tide, the two of you, 3-2-1.
  const [intro, setIntro] = useState(null);
  const [menuModal, setMenuModal] = useState(null); // the panel the menu opens on (back from a match: the lobby)
  useEffect(() => {
    const begin = (mode, opp) => {
      if (qstore.mode !== mode) return false;
      qstore.mode = null; qstore.found = mode; qemit();
      const me = net.profile, mi = rankedInfo(mode, me);
      const or = opp?.rating ?? null;
      const oi = or != null ? RANKS[rankIndexFor(or)] : null;
      setIntro({
        id: Date.now(), mode, goAt: performance.now() + INTRO.ping + WIPE_IN_MS + INTRO.show + INTRO.part + INTRO.count,
        me: { name: me?.name || "YOU", rating: mi.tr, rank: mi.rank, placed: mi.placed },
        opp: { name: opp?.name || "OPPONENT", rating: or, rank: oi, placed: false },
      });
      return true;
    };
    const offF = net.on("found", (f) => { if (f && !f.room) begin("control", f.opponent); });
    const offB = net.on("blitzStart", (b) => {
      if (b.resume) { setScreen("BLITZ"); return; }
      begin("blitz", b.opponent);
    });
    return () => { offF(); offB(); };
  }, [setScreen]);

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
    const offD = net.on("accountDeleted", () => { store.set("tb:token", ""); setScreen("MENU"); });
    const offM = net.on("match", (m) => {
      if (m && m.board && !m.over && !qstore.found) setScreen((cur) => (cur === "RESULT" ? cur : "RANKED"));
    });
    return () => { offT(); offM(); offD(); };
  }, [setScreen]);

  const guest = useAuth() === "guest";
  useEffect(() => {
    if (!authed && screen === "MATCHMAKING") setScreen("MENU");
    if (!authed && !guest && screen === "RANKED") setScreen("MENU");
  }, [authed, guest, screen, setScreen]);

  // An invite link (?room=CODE) opens the private screen with that code ready.
  const [pendingRoom, setPendingRoom] = useState(() => {
    try { const c = new URLSearchParams(location.search).get("room"); return c ? c.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 5) : null; } catch { return null; }
  });
  const clearPendingRoom = useCallback(() => {
    setPendingRoom(null);
    try { history.replaceState(null, "", location.pathname); } catch { /* fine */ }
  }, []);
  useEffect(() => { if (pendingRoom) setScreen("PRIVATE"); }, [pendingRoom, setScreen]);

  const setTheme = (t) => { saveTheme(t); setThemeState(t); };
  const setLoadout = (updater) => setLoadoutState((prev) => {
    const next = typeof updater === "function" ? updater(prev) : updater;
    saveLoadout(next);
    return next;
  });
  const rename = (n) => { const v = n.trim().slice(0, 16); if (v && v !== net.profile?.name) net.setName(v); };
  const logout = () => { store.set("tb:token", ""); net.logout(); setScreen("MENU"); };

  // Music on the menu screens only; matches, Marathon and results are silent.
  useEffect(() => {
    if (["MENU", "DIFFICULTY", "REPLAYS", "UNRANKED", "PRIVATE", "MATCHMAKING"].includes(screen)) music.play("menu");
    else if (screen === "RESULT" || screen === "REPLAY") music.stop(); // a replay plays its own sounds
  }, [screen]);

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

      /* Type: Silkscreen, a pixel face on an 8-unit em — so at 8 pixels,
         every pixel of every letter is exactly one pixel of the game. All
         text uses that one size, like a pixel-art game would. */
      .font-mono { font-family: "Silkscreen", ui-monospace, monospace; font-weight: 400; font-synthesis: none; -webkit-font-smoothing: none; }
      .tb-t { font-size: calc(var(--p) * 8); line-height: calc(var(--p) * 10); letter-spacing: 0; }
      .tb-b { font-weight: 700; }
      .font-mono .italic, .font-mono em { font-style: normal; opacity: .8; }
      .tb-display { font-family: "Silkscreen", ui-monospace, monospace; font-weight: 400; }
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
      .tb-zgflash { background: linear-gradient(90deg, rgba(200,250,255,.0), rgba(220,252,255,.95) 20%, rgba(255,255,255,1) 50%, rgba(220,252,255,.95) 80%, rgba(200,250,255,0)); animation: tbZgFlash 190ms ease-out both; }
      @keyframes tbZgFlash { 0% { opacity: 1; transform: scaleY(1); } 100% { opacity: 0; transform: scaleY(.15); } }
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
      /* PLAY: cards float a pixel up and down; light sweeps a card under the pointer. */
      @keyframes tbFloat { 0%,100% { transform: none } 50% { transform: translateY(calc(var(--p) * -1)) } }
      .tb-float { animation: tbFloat 2.4s steps(1) infinite; }
      .tb-card:not(:disabled):hover { filter: brightness(1.15); }
      @keyframes tbSheen { from { left: -40px } to { left: calc(100% + 40px) } }
      .tb-card:not(:disabled):hover .tb-sheen { animation: tbSheen .9s steps(9) 1; }
      @keyframes tbTwinkle { 0%,100% { opacity: 0; transform: scale(.4) } 50% { opacity: 1; transform: scale(1) } }
      .tb-twinkle { animation: tbTwinkle 2s steps(4) infinite; }
      @keyframes tbDropIn { 0% { transform: translateY(-14px); opacity: 0 } 15% { opacity: 1 } 60%,100% { transform: translateY(22px); opacity: 1 } }
      .tb-drop-in { animation: tbDropIn 2.6s steps(6) infinite; }
      .tb-pop { animation: tbPop .2s steps(4) both; }
      /* Panels surface like something rising through water: up out of a blur, brightening as they come. */
      @keyframes tbDive {
        0% { opacity: 0; transform: translateY(calc(var(--p) * 7)) scale(.975); filter: blur(4px) brightness(1.5) saturate(1.3) }
        55% { opacity: 1; filter: blur(0) brightness(1.12) }
        100% { opacity: 1; transform: none; filter: none }
      }
      .tb-dive { animation: tbDive .5s cubic-bezier(.16,.84,.3,1) both; }
      /* Menu panels. Each block (a row of buttons, a section of a panel) rises
         in on its own beat, then drifts as if floating on water; going away,
         they sink back down into the blur, top first. */
      @keyframes tbWater {
        0%,100% { translate: 0 0 }
        25% { translate: calc(var(--p) * .5) calc(var(--p) * -1) }
        50% { translate: 0 calc(var(--p) * -1.6) }
        75% { translate: calc(var(--p) * -.5) calc(var(--p) * -.7) }
      }
      @keyframes tbSink { to { opacity: 0; transform: translateY(calc(var(--p) * 7)) scale(.97); filter: blur(5px) brightness(1.5) } }
      .tb-flow > * { animation: tbDive .6s cubic-bezier(.16,.84,.3,1) both, tbWater 7s ease-in-out infinite; }
      ${Array.from({ length: 10 }, (_, i) => `.tb-flow > :nth-child(${i + 1}) { animation-delay: ${i * 55}ms, ${-(i * 1.3).toFixed(1)}s }`).join("\n      ")}
      .tb-flow.out > * { animation: tbSink ${SINK_MS}ms cubic-bezier(.5,0,.8,.4) both; }
      /* Side-by-side columns: each column rises and drifts on its own, not the row as one. */
      .tb-flow > .tb-cols { animation: none; }
      .tb-cols > * { animation: tbDive .6s cubic-bezier(.16,.84,.3,1) both, tbWater 7s ease-in-out infinite; }
      ${Array.from({ length: 4 }, (_, i) => `.tb-cols > :nth-child(${i + 1}) { animation-delay: ${80 + i * 90}ms, ${-(2 + i * 2.1).toFixed(1)}s }`).join("\n      ")}
      .tb-flow.out .tb-cols > * { animation: tbSink ${SINK_MS}ms cubic-bezier(.5,0,.8,.4) both; }
      ${Array.from({ length: 10 }, (_, i) => `.tb-flow.out > :nth-child(${i + 1}) { animation-delay: ${Math.min(i * 25, 120)}ms }`).join("\n      ")}
      /* The tide: soft light drifting across the menu while a panel is open. */
      @keyframes tbTide { 0% { background-position: 0% 0%, 100% 30%, 50% 100% } 50% { background-position: 60% 40%, 40% 70%, 20% 60% } 100% { background-position: 0% 0%, 100% 30%, 50% 100% } }
      .tb-tide {
        transition: opacity .7s ease;
        background:
          radial-gradient(60% 45% at 30% 35%, color-mix(in srgb, var(--tb-you) 22%, transparent), transparent 70%),
          radial-gradient(55% 50% at 75% 60%, color-mix(in srgb, var(--tb-special) 16%, transparent), transparent 70%),
          radial-gradient(70% 40% at 50% 90%, rgba(255,255,255,.10), transparent 70%);
        background-size: 160% 160%, 170% 170%, 150% 150%;
        animation: tbTide 16s ease-in-out infinite;
      }
      /* A full red board: it flashes for its last second. */
      @keyframes tbRedFlash { 0%,100% { filter: none } 50% { filter: brightness(2.2) saturate(1.4) } }
      .tb-redflash { animation: tbRedFlash .25s steps(2) infinite; }
      /* The wave between the two players before a ranked match. */
      @keyframes tbVsWave { 0%,100% { transform: translate(0, 0) } 50% { transform: translate(-3px, 1.2px) } }
      .tb-vswave { animation: tbVsWave 1.6s ease-in-out infinite; }
      .tb-vswave2 { animation: tbVsWave 1.1s ease-in-out infinite reverse; }
      /* A band of light runs down the glass once, like a caustic. */
      @keyframes tbRipple { from { top: -30%; opacity: .9 } to { top: 110%; opacity: 0 } }
      .tb-ripple { height: 26%; background: linear-gradient(180deg, transparent, rgba(255,255,255,.13) 45%, color-mix(in srgb, var(--tb-you) 20%, transparent) 55%, transparent); animation: tbRipple .8s cubic-bezier(.3,.6,.4,1) .05s both; }
      /* Pixel bubbles drifting up and out, twinkling like stars. */
      @keyframes tbBubble {
        0% { transform: translateY(0); opacity: 0 }
        15% { opacity: .9 }
        100% { transform: translateY(calc(var(--p) * -60)); opacity: 0 }
      }
      .tb-bubble { background: color-mix(in srgb, white 75%, var(--tb-you)); box-shadow: 0 0 calc(var(--p) * 2) color-mix(in srgb, var(--tb-you) 70%, transparent); animation-name: tbBubble; animation-timing-function: steps(14); animation-fill-mode: both; }
      ${theme.motion ? "" : ".tb-contest,.tb-drop,.tb-fadein,.tb-pulse,.tb-fade,.tb-pop,.tb-shine,.tb-bob,.tb-runner,.tb-line,.tb-vanish,.tb-rise,.tb-float,.tb-twinkle,.tb-drop-in,.tb-sheen,.tb-dive,.tb-flow > *,.tb-cols > *,.tb-tide { animation: none !important } .tb-ripple,.tb-bubble { display: none }"}
      @media (prefers-reduced-motion: reduce) {
        .tb-contest,.tb-drop,.tb-fadein,.tb-pulse,.tb-fade,.tb-pop,.tb-shine,.tb-bob,.tb-runner,.tb-line,.tb-rise,.tb-dive,.tb-flow > *,.tb-cols > *,.tb-tide { animation: none !important }
        .tb-ripple,.tb-bubble { display: none }
      }
      /* Menus and popups: phone layout at BASE_P, zoomed by P / BASE_P (see Scaled). */
      .tb-scale { --p: ${BASE_P}px; zoom: var(--pz); }
      /* The menu and its panels: a little smaller than everything else on big screens. */
      .tb-scale.tb-calm { zoom: max(1, calc(var(--pz) * .8)); }
      /* Big screens: the game column gets room for a bigger board. */
      @media (min-width: 1000px) and (min-height: 760px) {
        .tb-col { max-width: 680px !important; }
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
        initialModal={menuModal}
        onPick={(t) => {
          setMenuModal(null);
          if (t === "DIFFICULTY") setScreen("DIFFICULTY");
          else if (t === "PRIVATE") setScreen("PRIVATE");
          else if (t === "REPLAYS") setScreen("REPLAYS");
          // Every game mode: in on the tide (the game then counts down from 3).
          else if (["MARATHON", "SPRINT", "ULTRA", "ZEROG", "BLITZBOT", "TURNBASED", "HOTSEAT"].includes(t)) wipe(() => { setSeed((s) => s + 1); setScreen(t); });
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
        onStart={(lv) => wipe(() => { setAiLevel(lv); setSeed((s) => s + 1); setScreen("SOLO"); })} />
    );
  else if (screen === "REPLAYS")
    view = <ReplayList onOpen={(id) => { setReplayId(id); setScreen("REPLAY"); }} onBack={() => setScreen("MENU")} />;
  else if (screen === "REPLAY")
    view = replays.get(replayId)?.kind === "blitz"
      ? <BlitzReplayViewer rec={replays.get(replayId)} colors={colors} onBack={() => setScreen("REPLAYS")} />
      : replays.get(replayId)?.kind
      ? <SoloReplayViewer rec={replays.get(replayId)} onBack={() => setScreen("REPLAYS")} />
      : <ReplayViewer id={replayId} theme={theme} colors={colors} onBack={() => setScreen("REPLAYS")} />;
  else if (screen === "PRIVATE")
    view = (
      <PrivateRoom status={status} onBack={() => setScreen("MENU")}
        pendingCode={pendingRoom} clearPending={clearPendingRoom} />
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
        onMenu={() => { net.clearMatch(); if (over?.room) net.leaveRoom(); setScreen("MENU"); }}
        onQueue={() => {
          net.clearMatch();
          // Private: back to the room and ask for a rematch. Ranked: queue again.
          if (over?.rated === false && over.room) { net.rematch(); setScreen("PRIVATE"); }
          else { startQueue("control", loadout); setMenuModal("LOBBY:control"); setScreen("MENU"); }
        }} />
    );
  else if (screen === "BLITZ" || screen === "BLITZBOT")
    view = <BlitzGame key={`${screen}${seed}`} online={screen === "BLITZ"} colors={colors} onExit={() => setScreen("MENU")}
      onRequeue={() => { startQueue("blitz", loadout); setMenuModal("LOBBY:blitz"); setScreen("MENU"); }} />;
  else if (screen === "SPRINT" || screen === "ULTRA")
    view = <SprintGame key={`${screen}${seed}`} ultra={screen === "ULTRA"} onExit={() => setScreen("MENU")} />;
  else if (screen === "ZEROG")
    view = <ZeroGGame key={`${screen}${seed}`} onExit={() => setScreen("MENU")} />;
  else if (screen === "MARATHON")
    view = <MarathonGame key={seed} theme={theme} onExit={(again) => (again ? setSeed((s) => s + 1) : setScreen("MENU"))} />;
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
      {intro && (
        <VersusIntro key={intro.id} intro={intro} wipe={wipe}
          onScreen={() => { qstore.found = null; qemit(); setMenuModal(null); setScreen(intro.mode === "blitz" ? "BLITZ" : "RANKED"); }}
          onDone={() => setIntro(null)} />
      )}
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