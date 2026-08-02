import React, { useState, useEffect, useMemo, useCallback, useRef, useSyncExternalStore } from "react";
import {
  RotateCw, Check, SkipForward, RefreshCw, ChevronLeft, Settings2, X,
  VolumeX, BarChart3, Wifi, WifiOff, Clock, UserRound, LogOut,
  Palette, Lock, MailCheck, ShieldAlert,
} from "lucide-react";

/* The rules live in one place and the server imports the same file. */
import {
  COLS, ROWS, TURNS, HAND_SIZE, SLOTS, BLOCKS, DEFAULT_LOADOUT, sizeOf, key,
  rotateN, boundsOf, absCells, initialBoard, isLegal, enumerateMoves,
  hasAnyMove, resolveTurn, scoreOf, dealFrom,
} from "../shared/engine.js";
import {
  RANKS, PLACEMENT_GAMES, rankIndexFor, rankMin, rankProgress,
} from "../shared/glicko.js";
import { net, SERVER_URL, IS_SECURE, GOOGLE_CLIENT_ID } from "./net.js";
import {
  PRESETS, INKS, SHAPES, GRID_GAPS,
  loadTheme, saveTheme, applyPreset, editTheme, themeVars, isLight,
} from "./theme.js";

/* ============================================================
   PRESENTATION CONSTANTS
   ============================================================ */
const PHONE_W = 440;
const DOCK_H = 140;
const GAP = 2;
const REVEAL_MS = 1100;
const AI_THINK_MS = 550;
const TOUCH_LIFT = 2;
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

const LEVELS = ["ROOKIE", "NOVICE", "CASUAL", "STEADY", "SHARP", "TACTICAL", "RUTHLESS", "SURGICAL", "MERCILESS", "ARCHITECT"];

function levelBlurb(n) {
  if (n <= 2) return "Drops blocks almost anywhere they fit.";
  if (n <= 4) return "Always grabs the biggest block available.";
  if (n <= 6) return "Protects the open space it needs to grow.";
  if (n <= 8) return "Pushes hard toward your half of the board.";
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
   AUDIO
   ============================================================ */
let audioCtx = null;
function blip(freq, vol, dur = 0.09) {
  if (!vol) return;
  try {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === "suspended") audioCtx.resume();
    const t = audioCtx.currentTime;
    const o = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    o.type = "triangle";
    o.frequency.setValueAtTime(freq, t);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, vol * 0.12), t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g);
    g.connect(audioCtx.destination);
    o.start(t);
    o.stop(t + dur + 0.03);
  } catch (e) {}
}

/* ============================================================
   AI — client only. Ranked opponents are real people.
   ============================================================ */
function frontierSize(board, owner) {
  const s = new Set();
  for (let r = 0; r < ROWS; r++)
    for (let c = 0; c < COLS; c++) {
      if (board[r][c] !== owner) continue;
      for (let dr = -1; dr <= 1; dr++)
        for (let dc = -1; dc <= 1; dc++) {
          const nr = r + dr, nc = c + dc;
          if (nr < 0 || nc < 0 || nr >= ROWS || nc >= COLS) continue;
          if (board[nr][nc] === null) s.add(key(nr, nc));
        }
    }
  return s.size;
}

const weightsFor = (level) => {
  const t = (level - 1) / 9;
  return { gain: 1, front: 0.35 * t, deny: 1.1 * t * t, adv: 0.3 * t, noise: 9 * (1 - t) + 0.15 };
};

function aiPickMove(board, hand, owner, level) {
  const moves = enumerateMoves(board, hand, owner);
  if (!moves.length) return null;
  const w = weightsFor(level);
  const opp = owner === "A" ? "B" : "A";
  const oppBefore = frontierSize(board, opp);
  const homeRow = owner === "A" ? ROWS - 1 : 0;
  let best = null, bestScore = -Infinity;
  for (const m of moves) {
    const nb = board.map((row) => [...row]);
    for (const [r, c] of m.cells) nb[r][c] = owner;
    const mine = w.front > 0 ? frontierSize(nb, owner) : 0;
    const deny = w.deny > 0 ? oppBefore - frontierSize(nb, opp) : 0;
    const avgR = m.cells.reduce((s, x) => s + x[0], 0) / m.cells.length;
    const advance = owner === "A" ? homeRow - avgR : avgR;
    const s = w.gain * m.value + w.front * mine + w.deny * deny + w.adv * advance + Math.random() * w.noise;
    if (s > bestScore) { bestScore = s; best = m; }
  }
  return best;
}

function aiPickDiscard(hand) {
  let idx = 0, big = -1;
  hand.forEach((id, i) => {
    const v = BLOCKS[id].cells.length;
    if (v > big) { big = v; idx = i; }
  });
  return idx;
}

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
};
const useMatch = () => useSyncExternalStore(subs.match, () => net.match);
const useStatus = () => useSyncExternalStore(subs.status, () => net.status);
const useProfile = () => useSyncExternalStore(subs.profile, () => net.profile);
const useSearch = () => useSyncExternalStore(subs.search, () => net.search);
const useFound = () => useSyncExternalStore(subs.found, () => net.found);
const useAuth = () => useSyncExternalStore(subs.auth, () => net.auth);

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

/** Everything about picking a block and dragging it onto the grid.
 *  Shared by the local game and the networked one. */
function usePlacement({ board, owner, hand, enabled, flip = false }) {
  const [sel, setSel] = useState({ handIdx: null, rot: 0, pos: null });
  const [dragging, setDragging] = useState(false);
  const boardRef = useRef(null);
  const dragRef = useRef({ cells: null, lift: 0 });

  const reset = useCallback(() => setSel({ handIdx: null, rot: 0, pos: null }), []);

  const rotated = useMemo(() => {
    if (sel.handIdx === null) return null;
    const id = hand[sel.handIdx];
    return id === undefined ? null : rotateN(BLOCKS[id].cells, sel.rot);
  }, [sel.handIdx, sel.rot, hand]);

  const ghost = useMemo(() => (rotated && sel.pos ? absCells(rotated, sel.pos) : null), [rotated, sel.pos]);
  const ghostLegal = useMemo(
    () => (ghost && board ? isLegal(board, ghost, owner) : false),
    [ghost, board, owner]
  );
  const ghostKeys = useMemo(
    () => new Set((enabled && ghost ? ghost : []).map(([r, c]) => key(r, c))),
    [ghost, enabled]
  );

  const updateFromPoint = useCallback((clientX, clientY) => {
    const el = boardRef.current;
    const cells = dragRef.current.cells;
    if (!el || !cells) return;
    const rect = el.getBoundingClientRect();
    const sc = Math.floor(((clientX - rect.left) / rect.width) * COLS);
    const sr = Math.floor(((clientY - rect.top) / rect.height) * ROWS);
    // Screen coords -> board coords. When flipped, up-the-screen is +row.
    const lift = dragRef.current.lift;
    const col = flip ? COLS - 1 - sc : sc;
    const row = (flip ? ROWS - 1 - sr : sr) + (flip ? lift : -lift);
    const { h, w } = boundsOf(cells);
    setSel((s) => ({
      ...s,
      pos: [
        Math.max(0, Math.min(ROWS - h, row - Math.floor(h / 2))),
        Math.max(0, Math.min(COLS - w, col - Math.floor(w / 2))),
      ],
    }));
  }, [flip]);

  const beginDrag = useCallback((e, cells) => {
    dragRef.current = { cells, lift: e.pointerType === "touch" ? TOUCH_LIFT : 0 };
    setDragging(true);
    const onMove = (ev) => { ev.preventDefault(); updateFromPoint(ev.clientX, ev.clientY); };
    const onUp = () => {
      setDragging(false);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
    window.addEventListener("pointermove", onMove, { passive: false });
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    updateFromPoint(e.clientX, e.clientY);
  }, [updateFromPoint]);

  const onCardPointerDown = (e, i) => {
    if (!enabled) return;
    e.preventDefault();
    setSel({ handIdx: i, rot: 0, pos: null });
    beginDrag(e, BLOCKS[hand[i]].cells);
  };

  const onBoardPointerDown = (e) => {
    if (!enabled || !rotated) return;
    e.preventDefault();
    beginDrag(e, rotated);
  };

  const rotate = useCallback(() => {
    setSel((s) => {
      if (s.handIdx === null) return s;
      const id = hand[s.handIdx];
      if (id === undefined) return s;
      const { h, w } = boundsOf(rotateN(BLOCKS[id].cells, s.rot + 1));
      return {
        ...s,
        rot: s.rot + 1,
        pos: s.pos ? [Math.max(0, Math.min(ROWS - h, s.pos[0])), Math.max(0, Math.min(COLS - w, s.pos[1]))] : null,
      };
    });
  }, [hand]);

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

  return { sel, setSel, reset, rotated, ghost, ghostLegal, ghostKeys, dragging, boardRef, onBoardPointerDown, onCardPointerDown, rotate, nudge };
}

/* ============================================================
   SHARED VIEWS
   ============================================================ */
function BlockGlyph({ blockId, box = 40, color, gap = 1 }) {
  const cells = BLOCKS[blockId].cells;
  const { h, w } = boundsOf(cells);
  const span = Math.max(h, w);
  const size = Math.max(2, Math.floor((box - gap * (span - 1)) / span));
  const filled = new Set(cells.map(([r, c]) => r * 100 + c));
  return (
    <div style={{
      display: "grid",
      gridTemplateColumns: `repeat(${w}, ${size}px)`,
      gridTemplateRows: `repeat(${h}, ${size}px)`,
      gap, pointerEvents: "none",
    }}>
      {Array.from({ length: h * w }).map((_, i) => (
        <div key={i} style={{
          background: filled.has(Math.floor(i / w) * 100 + (i % w)) ? color : "transparent",
          borderRadius: 1,
        }} />
      ))}
    </div>
  );
}

function BoardGrid({
  board, cell, ink, ghostKeys, ghostLegal, ghostInk, contestedKeys,
  boardRef, onPointerDown, theme, youSide = "A",
}) {
  const shape = SHAPES[theme.shape] || SHAPES.soft;
  const gap = theme.gap;
  const cb = theme.colorblind;
  const markSize = Math.max(6, Math.round(cell * 0.56));

  return (
    <div
      ref={boardRef}
      onPointerDown={onPointerDown}
      style={{
        display: "grid",
        gridTemplateColumns: `repeat(${COLS}, ${cell}px)`,
        gridTemplateRows: `repeat(${ROWS}, ${cell}px)`,
        gap, background: UI.line, padding: Math.max(gap, 1),
        borderRadius: 4, touchAction: "none",
      }}
    >
      {board.map((row, r) =>
        row.map((v, c) => {
          const k = key(r, c);
          const isGhost = ghostKeys.has(k);
          const owner = isGhost ? youSide : v;
          let bg = UI.cell;
          let opacity = 1;
          let boxShadow = "none";
          let border = "none";

          if (v) bg = ink[v];
          if (v && shape.hollow) {
            border = `2px solid ${ink[v]}`;
            bg = "transparent";
          }
          if (v === "S" && !shape.hollow) boxShadow = "inset 0 0 0 2px rgba(0,0,0,.4)";
          if (isGhost) {
            bg = ghostInk;
            border = "none";
            opacity = ghostLegal ? 0.55 : 0.2;
            boxShadow = `inset 0 0 0 1px ${ghostLegal ? ghostInk : UI.bad}`;
          }

          // Colourblind marks: shape, not just hue. Yours are circles, theirs
          // are crosses, contested squares are diamonds.
          let mark = null;
          if (cb && owner && cell >= 11) {
            const glyph = owner === "S" ? "◆" : owner === youSide ? "○" : "✕";
            const base = owner === "S" ? ink.S : owner === youSide ? (isGhost ? ghostInk : ink[owner]) : ink[owner];
            mark = (
              <span style={{
                fontSize: markSize,
                lineHeight: 1,
                fontWeight: 700,
                color: isLight(base) ? "rgba(0,0,0,.62)" : "rgba(255,255,255,.72)",
                pointerEvents: "none",
                userSelect: "none",
              }}>{glyph}</span>
            );
          }

          return (
            <div
              key={k}
              className={contestedKeys.has(k) ? "tb-contest" : v ? "tb-drop" : ""}
              style={{
                background: bg, opacity, boxShadow, border,
                borderRadius: shape.radius,
                margin: shape.inset,
                display: mark ? "flex" : undefined,
                alignItems: "center",
                justifyContent: "center",
              }}
            >{mark}</div>
          );
        })
      )}
    </div>
  );
}

function HandRow({ hand, selIdx, dragging, ink, onPress, disabled }) {
  return (
    <div className="grid grid-cols-4 gap-1.5 mb-1.5">
      {Array.from({ length: HAND_SIZE }).map((_, i) => {
        const blockId = hand[i];
        if (blockId === undefined) {
          return <div key={i} className="rounded" style={{ height: 66, border: `1px dashed ${UI.line}`, opacity: 0.4 }} />;
        }
        const active = selIdx === i;
        return (
          <div
            key={i}
            onPointerDown={(e) => !disabled && onPress(e, i)}
            className="flex flex-col items-center justify-center gap-1 rounded select-none"
            style={{
              height: 66,
              background: active ? UI.panel : "transparent",
              border: `1px solid ${active ? ink : UI.line}`,
              touchAction: "none",
              opacity: disabled ? 0.35 : active && dragging ? 0.4 : 1,
            }}
          >
            <BlockGlyph blockId={blockId} box={32} color={ink} />
            <div className="text-[7px] tracking-wider" style={{ color: UI.dim }}>
              {BLOCKS[blockId].name} · {BLOCKS[blockId].cells.length}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function ActionBar({ onRotate, onCommit, onDiscard, canRotate, canCommit, canDiscard, ink }) {
  return (
    <div className="flex items-center gap-1.5 mb-1">
      <button onClick={onRotate} disabled={!canRotate}
        className="flex items-center justify-center gap-1 rounded text-[10px] tracking-widest disabled:opacity-30 flex-1"
        style={{ height: 42, border: `1px solid ${UI.line}` }}>
        <RotateCw size={13} /> TURN
      </button>
      <button onClick={onCommit} disabled={!canCommit}
        className="flex items-center justify-center gap-1 rounded text-[10px] tracking-widest disabled:opacity-25"
        style={{ height: 42, flex: 1.4, background: canCommit ? ink : UI.panel, color: canCommit ? UI.ground : UI.dim }}>
        <Check size={13} /> LOCK IN
      </button>
      <button onClick={onDiscard} disabled={!canDiscard}
        className="flex items-center justify-center gap-1 rounded text-[10px] tracking-widest disabled:opacity-30 flex-1"
        style={{ height: 42, border: `1px solid ${UI.line}`, color: UI.dim }}>
        <SkipForward size={13} /> DROP
      </button>
    </div>
  );
}

function ScoreBar({ score, turn, turns, inkA, inkB, labelA, labelB }) {
  const pct = (n) => Math.round((n / (ROWS * COLS)) * 100);
  return (
    <div className="shrink-0 pb-2">
      <div className="flex justify-between text-[10px] mb-1">
        <span style={{ color: inkA }}>{labelA} {score.a}</span>
        <span style={{ color: UI.dim }}>
          {Math.min(turn, turns)}/{turns}
          {score.s > 0 && <span style={{ color: GOLD }}> · {score.s}◆</span>}
        </span>
        <span style={{ color: inkB }}>{score.b} {labelB}</span>
      </div>
      <div className="h-1 w-full flex rounded overflow-hidden" style={{ background: UI.cell }}>
        <div style={{ width: `${pct(score.a)}%`, background: inkA }} />
        <div style={{ width: `${pct(score.s)}%`, background: GOLD }} />
        <div style={{ marginLeft: "auto", width: `${pct(score.b)}%`, background: inkB }} />
      </div>
    </div>
  );
}

function AmbientField({ loadout, colors, theme }) {
  const [field, setField] = useState(() => ({ board: initialBoard(), fresh: new Set(), gen: 0 }));
  const reduced =
    typeof window !== "undefined" && window.matchMedia &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const animate = theme.motion && !reduced;

  useEffect(() => {
    if (!animate) return;
    const id = setInterval(() => {
      setField((prev) => {
        let nb = prev.board;
        const fresh = new Set();
        for (const owner of ["A", "B"]) {
          const moves = enumerateMoves(nb, loadout, owner);
          if (!moves.length) continue;
          const m = moves[Math.floor(Math.random() * moves.length)];
          nb = nb.map((row) => [...row]);
          for (const [r, c] of m.cells) { nb[r][c] = owner; fresh.add(key(r, c)); }
        }
        if (!fresh.size) return { board: initialBoard(), fresh: new Set(), gen: prev.gen + 1 };
        return { board: nb, fresh, gen: prev.gen + 1 };
      });
    }, 520);
    return () => clearInterval(id);
  }, [animate, loadout]);

  const ink = { A: colors.you, B: colors.rival, S: colors.special };

  return (
    <div aria-hidden="true" className="absolute inset-0 overflow-hidden pointer-events-none">
      {/* the field itself */}
      <div style={{ position: "absolute", inset: 0, opacity: 0.34 }}>
        <div style={{ display: "grid", gridTemplateColumns: `repeat(${COLS}, 1fr)`, gap: 4, width: "100%", height: "100%" }}>
          {field.board.map((row, r) =>
            row.map((v, c) => {
              const k = key(r, c);
              const isFresh = field.fresh.has(k);
              return (
                <div
                  key={k}
                  className={isFresh && animate ? "tb-boot" : ""}
                  style={{
                    background: v ? ink[v] : "transparent",
                    border: v ? "none" : `1px solid color-mix(in srgb, var(--tb-line) 60%, transparent)`,
                    borderRadius: 3,
                    boxShadow: v ? `0 0 14px ${ink[v]}55, inset 0 0 8px rgba(255,255,255,.14)` : "none",
                    transition: "background 700ms ease, box-shadow 700ms ease",
                  }}
                />
              );
            })
          )}
        </div>
      </div>

      {/* scan sweep */}
      {animate && (
        <div
          className="tb-sweep"
          style={{
            position: "absolute", left: 0, right: 0, height: "38%",
            background: `linear-gradient(to bottom, transparent, ${colors.you}30 45%, ${colors.you}66 50%, ${colors.you}30 55%, transparent)`,
            mixBlendMode: "screen",
          }}
        />
      )}

      {/* horizon lines + CRT texture */}
      <div style={{
        position: "absolute", inset: 0, opacity: 0.5,
        background: "repeating-linear-gradient(to bottom, transparent 0 3px, rgba(0,0,0,.22) 3px 4px)",
      }} />
      <div className={animate ? "tb-drift" : ""} style={{
        position: "absolute", inset: "-20%",
        background: `radial-gradient(circle at 30% 20%, ${colors.you}14, transparent 55%),
                     radial-gradient(circle at 72% 78%, ${colors.rival}14, transparent 55%)`,
      }} />
    </div>
  );
}

function Popup({ title, onClose, children, pinned, maxW = 430 }) {
  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center tb-fade"
      style={{
        background: "rgba(5,8,11,.74)",
        backdropFilter: "blur(4px)",
        WebkitBackdropFilter: "blur(4px)",
        padding: "clamp(14px, 5vw, 56px) clamp(14px, 5vw, 56px)",
        paddingTop: "max(clamp(14px,5vw,56px), env(safe-area-inset-top,0px))",
        paddingBottom: "max(clamp(14px,5vw,56px), env(safe-area-inset-bottom,0px))",
      }}
      onPointerDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="tb-pop w-full flex flex-col rounded-xl overflow-hidden"
        style={{
          maxWidth: maxW,
          maxHeight: "100%",
          background: UI.panel,
          border: `1px solid ${UI.line}`,
          boxShadow: "0 28px 70px rgba(0,0,0,.6)",
        }}
      >
        <div className="flex items-center justify-between px-4 h-12 shrink-0" style={{ borderBottom: `1px solid ${UI.line}` }}>
          <span className="text-[10px] tracking-[0.3em]" style={{ color: UI.dim }}>{title}</span>
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
function SettingsModal({ volume, setVolume, name, rename, status, theme, setTheme, onClose }) {
  const steps = 10;
  const cur = Math.round(volume * steps);
  const [draft, setDraft] = useState(name);
  const set = (patch) => setTheme({ ...theme, ...patch });

  return (
    <Popup title="SETTINGS" onClose={onClose}>
      <div className="pt-4">
        <div className="text-[11px] tracking-[0.2em] mb-3">HANDLE</div>
        <input value={draft} maxLength={16}
          onChange={(e) => setDraft(e.target.value)} onBlur={() => rename(draft)}
          className="w-full rounded px-3 mb-7 text-sm font-mono"
          style={{ height: 44, background: UI.ground, border: `1px solid ${UI.line}`, color: UI.text, outline: "none" }} />

        <div className="flex items-center justify-between mb-3">
          <span className="text-[11px] tracking-[0.2em]">VOLUME</span>
          <span className="text-[11px]" style={{ color: UI.dim }}>{cur * 10}</span>
        </div>
        <div className="flex gap-1.5 mb-3">
          {Array.from({ length: steps }).map((_, i) => {
            const on = i < cur;
            return (
              <button key={i} aria-label={`Volume ${(i + 1) * 10}`}
                onClick={() => { const v = (i + 1) / steps; setVolume(v); blip(560 + i * 40, v, 0.06); }}
                className="flex-1 rounded"
                style={{ height: 40, background: on ? UI.text : UI.cell, border: `1px solid ${on ? UI.text : UI.line}` }} />
            );
          })}
        </div>
        <button onClick={() => setVolume(0)}
          className="flex items-center gap-2 px-3 rounded text-[10px] tracking-[0.2em] mb-7"
          style={{ height: 36, border: `1px solid ${UI.line}`, color: volume === 0 ? UI.text : UI.dim }}>
          <VolumeX size={13} /> MUTE
        </button>

        <div className="text-[9px] tracking-[0.24em] mb-1" style={{ color: UI.dim }}>ACCESSIBILITY</div>
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
        <div className="text-[9px] leading-relaxed mt-2 mb-7" style={{ color: UI.dim }}>
          Marks put ○ on your squares and ✕ on your opponent's, so the board reads
          without colour. Everything else lives in THEME.
        </div>

        <div className="text-[9px] tracking-[0.24em] mb-2" style={{ color: UI.dim }}>CONNECTION</div>
        <div className="flex items-center gap-2 text-[10px] mb-1" style={{ color: status === "online" ? UI.good : UI.dim }}>
          {status === "online" ? <Wifi size={12} /> : <WifiOff size={12} />}
          SERVER {status.toUpperCase()}
        </div>
        <div className="flex items-center gap-2 text-[10px] mb-1.5" style={{ color: IS_SECURE ? UI.good : GOLD }}>
          {IS_SECURE ? <Lock size={12} /> : <ShieldAlert size={12} />}
          {IS_SECURE ? "ENCRYPTED (TLS)" : "NOT ENCRYPTED"}
        </div>
        <div className="text-[9px] leading-relaxed pb-2" style={{ color: UI.dim }}>
          {SERVER_URL}
          {!IS_SECURE && " — fine on your own machine, unsafe over a real network."}
        </div>
      </div>
    </Popup>
  );
}

/* ============================================================
   DECK
   ============================================================ */
function DeckModal({ loadout, setLoadout, color, volume, onClose }) {
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
    blip(700, volume, 0.07);
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
  }, [volume]);

  const onPress = (e, blockId, from, instant) => {
    const sx = e.clientX, sy = e.clientY;
    if (instant || e.pointerType === "mouse") {
      e.preventDefault();
      beginDrag(blockId, from, sx, sy);
      return;
    }
    let armed = false;
    const timer = setTimeout(() => { armed = true; cleanup(); beginDrag(blockId, from, sx, sy); }, 240);
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
      <div className="grid grid-cols-4 gap-1.5 pb-3" style={{ borderBottom: `1px solid ${UI.line}` }}>
        {loadout.map((blockId, i) => {
          const hot = drag && drag.over === i;
          return (
            <div key={i} ref={(el) => (slotRefs.current[i] = el)}
              onPointerDown={(e) => onPress(e, blockId, i, true)}
              className="rounded flex flex-col items-center justify-center gap-1 select-none"
              style={{
                height: 62, background: hot ? UI.cell : "transparent",
                border: `1px solid ${hot ? color : UI.line}`, touchAction: "none",
                opacity: drag && drag.from === i ? 0.35 : 1,
              }}>
              <BlockGlyph blockId={blockId} box={28} color={color} />
              <span className="text-[7px] tracking-wider" style={{ color: UI.dim }}>{BLOCKS[blockId].name}</span>
            </div>
          );
        })}
      </div>
    </>
  );

  return (
    <Popup title="YOUR BLOCKS" onClose={onClose} pinned={pinned}>
      <div className="text-[10px] leading-relaxed pt-3 pb-4" style={{ color: UI.dim }}>
        Hold a block, then drag it up into a slot. Solo and take-turns give your opponent
        the same deck; in ranked, everyone brings their own.
      </div>
      {["SMALL", "MEDIUM", "BIG"].map((g) => (
        <div key={g} className="mb-5">
          <div className="text-[10px] tracking-[0.2em] mb-2" style={{ color: UI.dim }}>
            {g} · {g === "SMALL" ? "1–3" : g === "MEDIUM" ? "4–7" : "8–12"}
          </div>
          <div className="grid grid-cols-4 gap-1.5">
            {groups[g].map((blockId) => {
              const inDeck = loadout.includes(blockId);
              return (
                <div key={blockId} onPointerDown={(e) => onPress(e, blockId, "lib", false)}
                  className="rounded flex flex-col items-center justify-center gap-1 select-none"
                  style={{ height: 68, background: inDeck ? UI.cell : "transparent", border: `1px solid ${inDeck ? color : UI.line}` }}>
                  <BlockGlyph blockId={blockId} box={30} color={inDeck ? color : UI.dim} />
                  <span className="text-[7px] tracking-wider" style={{ color: UI.dim }}>
                    {BLOCKS[blockId].name} · {BLOCKS[blockId].cells.length}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      ))}
      {drag && (
        <div className="fixed z-50 pointer-events-none" style={{ left: drag.x, top: drag.y, transform: "translate(-50%,-50%)" }}>
          <div className="rounded p-2" style={{ background: UI.panel, border: `1px solid ${color}` }}>
            <BlockGlyph blockId={drag.blockId} box={34} color={color} />
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
    <div className="rounded p-2.5" style={{ background: UI.panel, border: `1px solid ${UI.line}` }}>
      <div className="text-[8px] tracking-[0.24em] mb-1.5" style={{ color: UI.dim }}>{label}</div>
      <div className="text-lg leading-none" style={{ color: color || UI.text }}>{value}</div>
      {sub && <div className="text-[9px] mt-1.5" style={{ color: UI.dim }}>{sub}</div>}
    </div>
  );
}

function StatsModal({ profile, status, onClose }) {
  if (!profile) {
    return (
      <Popup title="RANKED STATS" onClose={onClose}>
        <div className="rounded p-6 mt-6 text-center" style={{ background: UI.panel, border: `1px dashed ${UI.line}` }}>
          <WifiOff size={20} style={{ color: UI.dim, margin: "0 auto 12px" }} />
          <div className="text-[11px] leading-relaxed" style={{ color: UI.dim }}>
            {status === "connecting" ? "Connecting to the server…" : "Server offline."}
            <br />Ranked stats live on the server, not on this device.
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
      <div className="mt-4 rounded p-4" style={{ background: UI.panel, border: `1px solid ${UI.line}` }}>
        <div className="flex items-center gap-4">
          <div className="rounded flex items-center justify-center shrink-0"
            style={{ width: 74, height: 74, background: placed ? `${rank.color}1F` : UI.cell, border: `1.5px solid ${placed ? rank.color : UI.line}` }}>
            <span className="text-3xl leading-none" style={{ color: placed ? rank.color : UI.dim }}>{placed ? rank.name : "–"}</span>
          </div>
          <div className="min-w-0 flex-1">
            {placed ? (
              <>
                <div className="flex items-baseline gap-1.5">
                  <span className="text-2xl leading-none">{tr}</span>
                  <span className="text-[10px]" style={{ color: UI.dim }}>TR ±{Math.round(profile.rating.rd)}</span>
                </div>
                <div className="text-[9px] tracking-[0.2em] mt-2 mb-1.5" style={{ color: UI.dim }}>
                  {next ? `${toNext} TR TO ${next.name}` : "TOP OF THE LADDER"}
                </div>
                <div className="h-1 w-full rounded overflow-hidden" style={{ background: UI.cell }}>
                  <div style={{ width: `${prog * 100}%`, height: "100%", background: rank.color }} />
                </div>
              </>
            ) : (
              <>
                <div className="text-sm mb-1">UNRANKED</div>
                <div className="text-[10px] leading-relaxed" style={{ color: UI.dim }}>
                  {PLACEMENT_GAMES - st.games} more ranked {PLACEMENT_GAMES - st.games === 1 ? "match" : "matches"} to place.
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      <div className="mt-4">
        <div className="text-[9px] tracking-[0.24em] mb-2" style={{ color: UI.dim }}>LADDER</div>
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
                <span className="text-[7px]" style={{ color: here ? r.color : UI.dim, opacity: here ? 1 : 0.5 }}>{r.name}</span>
              </div>
            );
          })}
        </div>
      </div>

      {st.history.length > 1 && (
        <div className="mt-5 rounded p-3" style={{ background: UI.panel, border: `1px solid ${UI.line}` }}>
          <div className="flex items-center justify-between mb-1">
            <span className="text-[9px] tracking-[0.24em]" style={{ color: UI.dim }}>TR · LAST {st.history.length}</span>
            <span className="text-[9px]" style={{ color: UI.dim }}>{Math.min(...st.history)} – {Math.max(...st.history)}</span>
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
        <div className="text-[9px] tracking-[0.24em] mb-2" style={{ color: UI.dim }}>RECENT MATCHES</div>
        {st.recent.length === 0 ? (
          <div className="rounded p-4 text-center text-[10px] leading-relaxed" style={{ background: UI.panel, border: `1px dashed ${UI.line}`, color: UI.dim }}>
            No ranked matches yet.
          </div>
        ) : (
          <div className="space-y-1">
            {st.recent.map((m, i) => (
              <div key={i} className="flex items-center gap-2.5 rounded px-3 py-2" style={{ background: UI.panel, border: `1px solid ${UI.line}` }}>
                <span className="text-[10px] w-4 shrink-0" style={{ color: m.drew ? UI.dim : m.won ? UI.good : UI.bad }}>
                  {m.drew ? "D" : m.won ? "W" : "L"}
                </span>
                <span className="text-[11px] flex-1 truncate">{m.name}</span>
                <span className="text-[9px]" style={{ color: UI.dim }}>{m.score[0]}–{m.score[1]}</span>
                <span className="text-[9px] w-8 text-right" style={{ color: UI.dim }}>{fmtTime(m.seconds)}</span>
                <span className="text-[10px] w-9 text-right" style={{ color: m.delta > 0 ? UI.good : UI.bad }}>
                  {m.delta > 0 ? "+" : ""}{m.delta}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="text-[9px] leading-relaxed pt-3 pb-2" style={{ color: UI.dim, borderTop: `1px solid ${UI.line}` }}>
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
        width: size, height: size, borderRadius: 6, background: color,
        outline: on ? `2px solid ${UI.text}` : `1px solid ${UI.line}`,
        outlineOffset: on ? 2 : 0,
      }} />
  );
}

function Row({ label, children }) {
  return (
    <div className="flex items-center justify-between gap-3 py-2.5" style={{ borderBottom: `1px solid ${UI.line}` }}>
      <span className="text-[10px] tracking-[0.2em] shrink-0" style={{ color: UI.dim }}>{label}</span>
      <div className="flex items-center gap-1.5 flex-wrap justify-end">{children}</div>
    </div>
  );
}

function Toggle({ on, onClick }) {
  return (
    <button onClick={onClick} role="switch" aria-checked={on}
      className="rounded-full shrink-0"
      style={{
        width: 44, height: 24, background: on ? UI.text : UI.cell,
        border: `1px solid ${on ? UI.text : UI.line}`, padding: 2,
        display: "flex", justifyContent: on ? "flex-end" : "flex-start",
        transition: "justify-content 120ms",
      }}>
      <span style={{ width: 18, height: 18, borderRadius: 999, background: on ? UI.ground : UI.dim, display: "block" }} />
    </button>
  );
}

function ThemeModal({ theme, setTheme, onClose }) {
  const [tab, setTab] = useState("preset");
  const set = (patch) => setTheme(editTheme(theme, patch));

  const previewBoard = useMemo(() => {
    const b = initialBoard();
    const moves = [["A", [[13, 2], [13, 3], [14, 2]]], ["B", [[1, 4], [1, 5], [2, 5]]],
      ["S", [[7, 3], [7, 4]]], ["A", [[10, 4], [11, 4]]], ["B", [[4, 2], [4, 3]]]];
    for (const [who, cells] of moves) for (const [r, c] of cells) b[r][c] = who;
    return b;
  }, []);

  return (
    <Popup title="THEME" onClose={onClose} maxW={420}>
      {/* live preview */}
      <div className="mt-3 mb-4 rounded p-3 flex justify-center" style={{ background: UI.ground, border: `1px solid ${UI.line}` }}>
        <div style={{ transform: "scale(1)", transformOrigin: "top center" }}>
          <BoardGrid
            board={previewBoard} cell={13}
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
            className="flex-1 rounded text-[9px] tracking-[0.2em]"
            style={{
              height: 34,
              background: tab === k ? UI.text : "transparent",
              color: tab === k ? UI.ground : UI.dim,
              border: `1px solid ${tab === k ? UI.text : UI.line}`,
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
                style={{ background: p.ground, border: `1px solid ${on ? p.you : UI.line}` }}>
                <div className="flex gap-1 mb-2">
                  {[p.you, p.rival, p.special, p.cell].map((c, i) => (
                    <span key={i} style={{ width: 16, height: 16, borderRadius: 3, background: c, display: "block" }} />
                  ))}
                </div>
                <div className="text-[9px] tracking-[0.2em]" style={{ color: p.text }}>{p.label}</div>
              </button>
            );
          })}
          {theme.preset === "custom" && (
            <div className="rounded p-2.5 col-span-2 text-[9px] tracking-[0.2em]"
              style={{ border: `1px dashed ${UI.line}`, color: UI.dim }}>
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
          <Row label="CONTESTED">
            {INKS.map((c) => <Swatch key={c} color={c} on={theme.special === c} onClick={() => set({ special: c })} />)}
          </Row>
          <div className="text-[9px] tracking-[0.2em] mt-4 mb-2" style={{ color: UI.dim }}>SURFACES</div>
          {[["BACKGROUND", "ground"], ["PANELS", "panel"], ["EMPTY CELL", "cell"], ["LINES", "line"], ["TEXT", "text"]].map(([label, k]) => (
            <Row key={k} label={label}>
              <input type="color" value={theme[k]} onChange={(e) => set({ [k]: e.target.value })}
                style={{ width: 44, height: 26, background: "transparent", border: `1px solid ${UI.line}`, borderRadius: 5, padding: 0 }} />
              <span className="text-[9px] tabular-nums" style={{ color: UI.dim }}>{theme[k]}</span>
            </Row>
          ))}
        </div>
      )}

      {tab === "blocks" && (
        <div className="pb-2">
          <div className="text-[9px] tracking-[0.2em] mb-2" style={{ color: UI.dim }}>SHAPE</div>
          <div className="grid grid-cols-3 gap-2 mb-5">
            {Object.entries(SHAPES).map(([k, sh]) => {
              const on = theme.shape === k;
              return (
                <button key={k} onClick={() => set({ shape: k })}
                  className="rounded flex flex-col items-center justify-center gap-2 py-3"
                  style={{ background: on ? UI.cell : "transparent", border: `1px solid ${on ? theme.you : UI.line}` }}>
                  <div style={{
                    width: 22, height: 22, borderRadius: sh.radius,
                    background: sh.hollow ? "transparent" : theme.you,
                    border: sh.hollow ? `2px solid ${theme.you}` : "none",
                  }} />
                  <span className="text-[8px] tracking-wider" style={{ color: UI.dim }}>{sh.label}</span>
                </button>
              );
            })}
          </div>

          <Row label="GRID GAP">
            {GRID_GAPS.map((g) => (
              <button key={g} onClick={() => set({ gap: g })}
                className="rounded text-[10px] tabular-nums"
                style={{
                  width: 34, height: 30,
                  background: theme.gap === g ? UI.text : "transparent",
                  color: theme.gap === g ? UI.ground : UI.dim,
                  border: `1px solid ${theme.gap === g ? UI.text : UI.line}`,
                }}>{g}</button>
            ))}
          </Row>
          <Row label="COLOURBLIND MARKS"><Toggle on={theme.colorblind} onClick={() => set({ colorblind: !theme.colorblind })} /></Row>
          <div className="text-[9px] leading-relaxed pt-3" style={{ color: UI.dim }}>
            Marks put ○ on your squares, ✕ on your opponent's and ◆ on contested ones,
            so the board reads without relying on colour.
          </div>
        </div>
      )}

      <div className="text-[9px] leading-relaxed pt-4 mt-2" style={{ color: UI.dim, borderTop: `1px solid ${UI.line}` }}>
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
    if (!GOOGLE_CLIENT_ID || !box.current) return;
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

  if (!GOOGLE_CLIENT_ID) return null;
  return (
    <>
      <div className="flex items-center gap-3 my-4">
        <span className="flex-1 h-px" style={{ background: UI.line }} />
        <span className="text-[9px] tracking-[0.2em]" style={{ color: UI.dim }}>OR</span>
        <span className="flex-1 h-px" style={{ background: UI.line }} />
      </div>
      <div ref={box} className="flex justify-center" />
    </>
  );
}

const fieldStyle = {
  height: 46, background: UI.ground, border: `1px solid ${UI.line}`,
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
        <div className="text-[9px] tracking-[0.24em] mb-2" style={{ color: UI.dim }}>USERNAME</div>
        <input value={username} autoCapitalize="none" autoCorrect="off" maxLength={16}
          onChange={(e) => setUsername(e.target.value)} onKeyDown={(e) => e.key === "Enter" && submit()}
          className="w-full px-3 mb-4 text-sm font-mono" style={fieldStyle} />

        {signup && (
          <>
            <div className="text-[9px] tracking-[0.24em] mb-2" style={{ color: UI.dim }}>EMAIL</div>
            <input value={email} type="email" autoCapitalize="none" autoCorrect="off"
              onChange={(e) => setEmail(e.target.value)} onKeyDown={(e) => e.key === "Enter" && submit()}
              className="w-full px-3 mb-4 text-sm font-mono" style={fieldStyle} />
          </>
        )}

        <div className="text-[9px] tracking-[0.24em] mb-2" style={{ color: UI.dim }}>PASSWORD</div>
        <input type="password" value={password} autoCapitalize="none"
          onChange={(e) => setPassword(e.target.value)} onKeyDown={(e) => e.key === "Enter" && submit()}
          className="w-full px-3 mb-4 text-sm font-mono" style={fieldStyle} />

        {signup && (
          <>
            <div className="text-[9px] tracking-[0.24em] mb-2" style={{ color: UI.dim }}>CONFIRM PASSWORD</div>
            <input type="password" value={confirm} autoCapitalize="none"
              onChange={(e) => setConfirm(e.target.value)} onKeyDown={(e) => e.key === "Enter" && submit()}
              className="w-full px-3 mb-4 text-sm font-mono" style={fieldStyle} />
            <div className="text-[9px] leading-relaxed mb-4" style={{ color: UI.dim }}>
              3–16 letters, numbers or underscores. Password at least 8 characters.
              We'll email you a 5-digit code.
            </div>
          </>
        )}

        {err && (
          <div className="text-[10px] leading-relaxed mb-4 rounded px-3 py-2"
            style={{ color: UI.bad, border: `1px solid ${UI.badSoft}`, background: UI.badFaint }}>{err}</div>
        )}

        <button onClick={submit} disabled={net.authBusy}
          className="w-full rounded text-[10px] tracking-[0.3em] disabled:opacity-40"
          style={{ height: 48, background: UI.text, color: UI.ground }}>
          {net.authBusy ? "…" : signup ? "CREATE ACCOUNT" : "LOG IN"}
        </button>

        <GoogleButton onCredential={(c) => net.google(c)} />

        <button onClick={() => onSwitch(signup ? "login" : "signup")}
          className="w-full text-[10px] tracking-[0.2em] mt-4 py-2" style={{ color: UI.dim }}>
          {signup ? "I ALREADY HAVE AN ACCOUNT" : "CREATE AN ACCOUNT"}
        </button>

        <div className="flex items-center gap-2 text-[9px] mt-4 pt-4"
          style={{ color: IS_SECURE ? UI.dim : GOLD, borderTop: `1px solid ${UI.line}` }}>
          {IS_SECURE ? <Lock size={11} /> : <ShieldAlert size={11} />}
          {IS_SECURE ? "Encrypted connection." : "Unencrypted connection — local testing only."}
        </div>
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
        <div className="text-[11px] leading-relaxed mb-1">We sent a 5-digit code to</div>
        <div className="text-sm mb-6">{profile.email}</div>

        <input
          value={digits} inputMode="numeric" autoFocus maxLength={5}
          onChange={(e) => onChange(e.target.value)}
          className="w-full text-center font-mono mb-4"
          style={{ ...fieldStyle, height: 58, fontSize: 26, letterSpacing: "0.5em", textIndent: "0.5em" }}
        />

        {net.authError && (
          <div className="text-[10px] leading-relaxed mb-4 rounded px-3 py-2"
            style={{ color: UI.bad, border: `1px solid ${UI.badSoft}`, background: UI.badFaint }}>
            {net.authError}
          </div>
        )}
        {net.codeSent && !net.authError && (
          <div className="text-[10px] mb-4" style={{ color: UI.good }}>New code sent.</div>
        )}

        <button onClick={() => submit(digits)} disabled={digits.length !== 5 || net.authBusy}
          className="w-full rounded text-[10px] tracking-[0.3em] disabled:opacity-40 mb-3"
          style={{ height: 48, background: UI.text, color: UI.ground }}>VERIFY</button>

        <button onClick={() => { net.resend(); setCooldown(60); }} disabled={cooldown > 0}
          className="w-full text-[10px] tracking-[0.2em] py-2 disabled:opacity-40" style={{ color: UI.dim }}>
          {cooldown > 0 ? `RESEND IN ${cooldown}s` : "RESEND CODE"}
        </button>

        <div className="text-[9px] leading-relaxed mt-4 pt-4" style={{ color: UI.dim, borderTop: `1px solid ${UI.line}` }}>
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
            style={{ width: 62, height: 62, background: placed ? `${rank.color}1F` : UI.ground, border: `1.5px solid ${placed ? rank.color : UI.line}` }}>
            <span className="text-2xl" style={{ color: placed ? rank.color : UI.dim }}>{placed ? rank.name : "–"}</span>
          </div>
          <div className="min-w-0">
            <div className="text-lg truncate">{profile.name}</div>
            <div className="text-[10px] mt-1" style={{ color: UI.dim }}>
              {placed ? `${tr} TR ±${Math.round(profile.rating.rd)}` : `${PLACEMENT_GAMES - st.games} matches to place`}
            </div>
            <div className="text-[9px] mt-0.5" style={{ color: UI.dim }}>member since {since}</div>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-2 mb-5">
          {[
            ["WIN RATE", `${winRate}%`, winRate >= 50 ? UI.good : UI.text],
            ["RECORD", `${st.wins}–${st.losses}`, UI.text],
            ["PLAYED", fmtTime(st.seconds), UI.text],
          ].map(([label, value, color]) => (
            <div key={label} className="rounded p-2.5" style={{ background: UI.ground, border: `1px solid ${UI.line}` }}>
              <div className="text-[8px] tracking-[0.2em] mb-1.5" style={{ color: UI.dim }}>{label}</div>
              <div className="text-sm leading-none" style={{ color }}>{value}</div>
            </div>
          ))}
        </div>

        <div className="grid grid-cols-2 gap-2 mb-6">
          <div className="rounded p-2.5" style={{ background: UI.ground, border: `1px solid ${UI.line}` }}>
            <div className="text-[8px] tracking-[0.2em] mb-1.5" style={{ color: UI.dim }}>PEAK</div>
            <div className="text-sm leading-none" style={{ color: st.peakRank !== null ? RANKS[st.peakRank].color : UI.dim }}>
              {st.peakRank !== null ? `${RANKS[st.peakRank].name} · ${st.peakTr}` : "unplaced"}
            </div>
          </div>
          <div className="rounded p-2.5" style={{ background: UI.ground, border: `1px solid ${UI.line}` }}>
            <div className="text-[8px] tracking-[0.2em] mb-1.5" style={{ color: UI.dim }}>BEST STREAK</div>
            <div className="text-sm leading-none">W{st.bestStreak}</div>
          </div>
        </div>

        <button onClick={onLogout}
          className="w-full rounded text-[10px] tracking-[0.25em] flex items-center justify-center gap-2"
          style={{ height: 44, border: `1px solid ${UI.line}`, color: UI.dim }}>
          <LogOut size={13} /> SIGN OUT
        </button>
      </div>
    </Popup>
  );
}

/* ============================================================
   MENU
   ============================================================ */
function Menu({ onPick, loadout, setLoadout, volume, setVolume, colors, profile, status, name, rename, onLogout, theme, setTheme }) {
  const [modal, setModal] = useState(null);
  const authed = useAuth() === "authed";
  const verified = !!profile?.emailVerified;
  const color = theme.you;
  const tr = profile ? Math.round(profile.rating.r) : null;
  const placed = profile && profile.stats.games >= PLACEMENT_GAMES;
  const rank = tr !== null ? RANKS[rankIndexFor(tr)] : null;

  return (
    <div className="tb-screen tb-safe relative w-full flex items-center justify-center px-5 font-mono overflow-hidden" style={{ background: UI.ground, color: UI.text }}>
      <AmbientField loadout={loadout} colors={colors} theme={theme} />
      <div className="absolute inset-0 pointer-events-none" style={{ background: "radial-gradient(ellipse at 50% 46%, color-mix(in srgb, var(--tb-ground) 62%, transparent) 0%, color-mix(in srgb, var(--tb-ground) 88%, transparent) 46%, var(--tb-ground) 82%)" }} />

      <div className="relative w-full" style={{ maxWidth: 330 }}>
        <div className="text-center mb-8">
          <div className="text-[9px] tracking-[0.42em] mb-2.5" style={{ color: UI.dim }}>{COLS} × {ROWS} · {TURNS} TURNS</div>
          <div className="text-[28px] leading-tight tracking-[0.2em]">TURF BLOCKS</div>
        </div>

        <button
          onClick={() => {
            if (status !== "online") return;
            if (!authed) return setModal("login");
            if (!verified) return setModal("VERIFY");
            onPick("MATCHMAKING"); blip(400, volume);
          }}
          disabled={status !== "online"}
          className="w-full rounded flex flex-col items-center justify-center gap-1 mb-2.5 disabled:opacity-40"
          style={{ height: 88, background: UI.panel, border: `1px solid ${authed && verified && placed ? rank.color : UI.line}` }}
        >
          <span className="text-[9px] tracking-[0.35em]" style={{ color: UI.dim }}>
            {status !== "online" ? (status === "connecting" ? "CONNECTING…" : "SERVER OFFLINE")
              : !authed ? "ACCOUNT REQUIRED"
              : !verified ? "VERIFY YOUR EMAIL"
              : placed ? `RANKED · ${rank.name} · ${tr}` : "RANKED · UNPLACED"}
          </span>
          <span className="text-base tracking-[0.28em]" style={{ textDecoration: authed && verified ? "none" : "line-through", textDecorationThickness: 1 }}>
            MULTIPLAYER
          </span>
        </button>

        {!authed && (
          <div className="flex gap-2.5 mb-2.5">
            <button onClick={() => setModal("login")} disabled={status !== "online"}
              className="flex-1 rounded flex items-center justify-center disabled:opacity-40"
              style={{ height: 44, background: UI.panel, border: `1px solid ${UI.line}` }}>
              <span className="text-[11px] tracking-[0.24em]">LOGIN</span>
            </button>
            <button onClick={() => setModal("signup")} disabled={status !== "online"}
              className="flex-1 rounded flex items-center justify-center disabled:opacity-40"
              style={{ height: 44, background: UI.text, color: UI.ground }}>
              <span className="text-[11px] tracking-[0.24em]">NEW PLAYER</span>
            </button>
          </div>
        )}

        <div className="flex gap-2.5 mb-2.5">
          <button onClick={() => { onPick("DIFFICULTY"); blip(520, volume); }} className="flex-1 rounded flex items-center justify-center" style={{ height: 44, background: UI.panel, border: `1px solid ${UI.line}` }}>
            <span className="text-sm tracking-[0.28em]">SP</span>
          </button>
          <button onClick={() => { onPick("HOTSEAT"); blip(520, volume); }} className="flex-1 rounded flex items-center justify-center" style={{ height: 44, background: UI.panel, border: `1px solid ${UI.line}` }}>
            <span className="text-sm tracking-[0.2em]">TAKE TURNS</span>
          </button>
        </div>

        <div className="flex justify-between">
          <div className="flex gap-2.5">
            <button onClick={() => setModal("DECK")} aria-label="Your blocks" className="rounded flex items-center justify-center" style={{ width: 44, height: 44, background: color }}>
              <div style={{ display: "grid", gridTemplateColumns: "8px 8px", gap: 2 }}>
                {[0, 1, 2, 3].map((i) => (
                  <div key={i} style={{ background: i === 1 ? "transparent" : UI.ground, borderRadius: 1, height: 8 }} />
                ))}
              </div>
            </button>
            <button onClick={() => setModal("THEME")} aria-label="Theme"
              className="rounded flex items-center justify-center"
              style={{ width: 44, height: 44, background: UI.panel, border: `1px solid ${UI.line}` }}>
              <Palette size={17} style={{ color: UI.dim }} />
            </button>
          </div>
          <div className="flex gap-2.5">
            <button onClick={() => setModal(authed ? "ACCOUNT" : "login")} aria-label="Account"
              className="rounded flex items-center justify-center"
              style={{ width: 44, height: 44, background: UI.panel, border: `1px solid ${authed && verified ? UI.line : GOLD_SOFT}` }}>
              <UserRound size={17} style={{ color: authed && verified ? UI.dim : GOLD }} />
            </button>
            <button onClick={() => setModal("STATS")} aria-label="Stats" className="rounded flex items-center justify-center" style={{ width: 44, height: 44, background: UI.panel, border: `1px solid ${UI.line}` }}>
              <BarChart3 size={17} style={{ color: UI.dim }} />
            </button>
            <button onClick={() => setModal("SETTINGS")} aria-label="Settings" className="rounded flex items-center justify-center" style={{ width: 44, height: 44, background: UI.panel, border: `1px solid ${UI.line}` }}>
              <Settings2 size={17} style={{ color: UI.dim }} />
            </button>
          </div>
        </div>
      </div>

      {(modal === "login" || modal === "signup") && (
        <AuthModal mode={modal} onClose={() => setModal(null)} onSwitch={setModal} />
      )}
      {modal === "VERIFY" && profile && <VerifyModal profile={profile} onClose={() => setModal(null)} />}
      {modal === "THEME" && <ThemeModal theme={theme} setTheme={setTheme} onClose={() => setModal(null)} />}
      {modal === "ACCOUNT" && profile && (
        <AccountModal profile={profile} onLogout={() => { setModal(null); onLogout(); }} onClose={() => setModal(null)} />
      )}
      {modal === "SETTINGS" && <SettingsModal volume={volume} setVolume={setVolume} name={name} rename={rename} status={status} theme={theme} setTheme={setTheme} onClose={() => setModal(null)} />}
      {modal === "STATS" && <StatsModal profile={profile} status={status} onClose={() => setModal(null)} />}
      {modal === "DECK" && <DeckModal loadout={loadout} setLoadout={setLoadout} color={color} volume={volume} onClose={() => setModal(null)} />}
    </div>
  );
}

/* ============================================================
   DIFFICULTY
   ============================================================ */
function Difficulty({ onStart, onBack, colors, volume }) {
  const [lv, setLv] = useState(4);
  return (
    <div className="tb-screen tb-safe w-full flex items-center justify-center px-5 font-mono" style={{ background: UI.ground, color: UI.text }}>
      <div className="w-full" style={{ maxWidth: 330 }}>
        <button onClick={onBack} className="flex items-center gap-1 text-[10px] tracking-[0.25em] mb-6 py-2" style={{ color: UI.dim }}>
          <ChevronLeft size={13} /> MENU
        </button>
        <div className="text-[10px] tracking-[0.35em] mb-3" style={{ color: UI.dim }}>OPPONENT STRENGTH</div>
        <div className="grid grid-cols-5 gap-1.5 mb-4">
          {LEVELS.map((nm, i) => {
            const n = i + 1, on = lv === n;
            return (
              <button key={n} onClick={() => { setLv(n); blip(480 + n * 30, volume, 0.05); }}
                className="rounded flex items-center justify-center text-sm"
                style={{
                  height: 44, background: on ? colors.rival : UI.panel,
                  color: on ? UI.ground : UI.text,
                  border: `1px solid ${on ? colors.rival : UI.line}`,
                  opacity: on ? 1 : 0.45 + (n / 10) * 0.5,
                }}>{n}</button>
            );
          })}
        </div>
        <div className="rounded p-3 mb-4" style={{ background: UI.panel, border: `1px solid ${UI.line}`, minHeight: 76 }}>
          <div className="text-sm tracking-[0.22em] mb-1" style={{ color: colors.rival }}>{LEVELS[lv - 1]}</div>
          <div className="text-[11px] leading-relaxed" style={{ color: UI.dim }}>{levelBlurb(lv)}</div>
        </div>
        <button onClick={() => onStart(lv)} className="w-full rounded text-[11px] tracking-[0.3em]" style={{ height: 50, background: UI.text, color: UI.ground }}>
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

function Matchmaking({ profile, loadout, colors, volume, onCancel }) {
  const search = useSearch();
  const found = useFound();

  useEffect(() => {
    net.queue(loadout);
    const offF = net.on("found", () => blip(880, volume, 0.18));
    return () => offF();
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
              <div className="text-[10px] tracking-[0.35em] tb-pulse mb-2" style={{ color: colors.you }}>SEARCHING</div>
              <div className="text-[28px] leading-none tabular-nums">{elapsed.toFixed(1)}s</div>
            </div>

            <div className="mb-6">
              <div className="flex justify-between text-[9px] mb-2" style={{ color: UI.dim }}>
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
              <div className="text-center text-[9px] mt-2" style={{ color: UI.dim }}>{tr} TR · {rank.name}</div>
            </div>

            <div className="text-[10px] leading-relaxed text-center mb-8" style={{ color: UI.dim }}>
              Closest rating first. The window widens the longer you wait.
            </div>

            <button onClick={() => { net.unqueue(); onCancel(); }} className="w-full rounded text-[10px] tracking-[0.3em]" style={{ height: 46, border: `1px solid ${UI.line}`, color: UI.dim }}>
              CANCEL
            </button>
          </>
        ) : (
          <div className="text-center">
            <div className="text-[10px] tracking-[0.35em] mb-7" style={{ color: UI.dim }}>MATCH FOUND</div>
            <div className="flex items-center justify-center gap-4 mb-6">
              <div className="flex-1">
                <div className="rounded mx-auto flex items-center justify-center mb-2" style={{ width: 52, height: 52, background: `${rank.color}1F`, border: `1.5px solid ${rank.color}` }}>
                  <span className="text-xl" style={{ color: rank.color }}>{rank.name}</span>
                </div>
                <div className="text-[10px] truncate">{profile.name}</div>
                <div className="text-[9px]" style={{ color: UI.dim }}>{tr}</div>
              </div>
              <span className="text-[10px] tracking-[0.2em]" style={{ color: UI.dim }}>VS</span>
              <div className="flex-1">
                <div className="rounded mx-auto flex items-center justify-center mb-2" style={{ width: 52, height: 52, background: `${oppRank.color}1F`, border: `1.5px solid ${oppRank.color}` }}>
                  <span className="text-xl" style={{ color: oppRank.color }}>{oppRank.name}</span>
                </div>
                <div className="text-[10px] truncate">{found.opponent.name}</div>
                <div className="text-[9px]" style={{ color: UI.dim }}>{found.opponent.rating}</div>
              </div>
            </div>
            <div className="text-[9px]" style={{ color: UI.dim }}>{found.gap} TR apart</div>
          </div>
        )}
      </div>
    </div>
  );
}

/* ============================================================
   LOCAL GAME — hotseat and solo. Client owns everything.
   ============================================================ */
function LocalGame({ mode, aiLevel, loadout, colors, volume, theme, onExit, onRestart }) {
  const solo = mode === "SOLO";
  const INK = useMemo(() => ({ A: colors.you, B: colors.rival, S: colors.special }), [colors]);

  const [board, setBoard] = useState(initialBoard);
  const [turn, setTurn] = useState(1);
  const [phase, setPhase] = useState("PLAY_A");
  const [decks, setDecks] = useState(() => ({ A: dealFrom(loadout), B: dealFrom(loadout) }));
  const [pendingA, setPendingA] = useState(null);
  const [reveal, setReveal] = useState(null);
  const [stageRef, stage] = useSize();

  const player = phase === "PLAY_B" ? "B" : "A";
  const hand = decks[player].hand;
  const inPlay = phase === "PLAY_A" || phase === "PLAY_B";
  const score = useMemo(() => scoreOf(board), [board]);
  const oppName = solo ? `LV${aiLevel} ${LEVELS[aiLevel - 1]}` : "PLAYER 2";

  const pl = usePlacement({ board, owner: player, hand, enabled: inPlay });
  const contestedKeys = useMemo(() => new Set((reveal ? reveal.contested : []).map(([r, c]) => key(r, c))), [reveal]);
  const stuck = useMemo(() => (inPlay ? !hasAnyMove(board, hand, player) : false), [board, hand, player, inPlay]);

  const g = theme.gap;
  const cell = Math.max(6, Math.floor(Math.min(
    (stage.w - g * (COLS + 1)) / COLS,
    (stage.h - g * (ROWS + 1)) / ROWS
  )));

  const drawInto = (side, handIdx) => {
    setDecks((st) => {
      const p = st[side];
      const nextHand = p.hand.filter((_, i) => i !== handIdx);
      const nextDeck = [...p.deck];
      if (nextDeck.length) nextHand.push(nextDeck.shift());
      return { ...st, [side]: { hand: nextHand, deck: nextDeck } };
    });
  };

  const finish = (mA, mB) => {
    const res = resolveTurn(board, mA, mB);
    setBoard(res.board);
    setReveal({ contested: res.contested, a: mA, b: mB });
    setPhase("REVEAL");
    if (res.contested.length) blip(1050, volume, 0.16);
  };

  const handOver = (move) => { setPendingA(move); setPhase(solo ? "AI_THINK" : "HANDOFF"); };

  const commit = () => {
    if (pl.sel.handIdx === null || !pl.ghost || !pl.ghostLegal) return;
    const id = hand[pl.sel.handIdx];
    blip(560, volume);
    drawInto(player, pl.sel.handIdx);
    const move = { cells: pl.ghost, value: BLOCKS[id].cells.length, blockId: id };
    if (player === "A") handOver(move); else finish(pendingA, move);
    pl.reset();
  };

  const discard = () => {
    if (pl.sel.handIdx === null) return;
    blip(300, volume);
    drawInto(player, pl.sel.handIdx);
    if (player === "A") handOver(null); else finish(pendingA, null);
    pl.reset();
  };

  useEffect(() => {
    if (phase !== "AI_THINK") return;
    const t = setTimeout(() => {
      const aiHand = decks.B.hand;
      const move = aiPickMove(board, aiHand, "B", aiLevel);
      if (move) {
        drawInto("B", move.handIdx);
        finish(pendingA, { cells: move.cells, value: move.value, blockId: move.blockId });
      } else {
        drawInto("B", aiPickDiscard(aiHand));
        finish(pendingA, null);
      }
    }, AI_THINK_MS);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  useEffect(() => {
    if (phase !== "REVEAL") return;
    const t = setTimeout(() => {
      setReveal(null);
      setPendingA(null);
      const bothStuck = !hasAnyMove(board, decks.A.hand, "A") && !hasAnyMove(board, decks.B.hand, "B");
      if (turn >= TURNS || bothStuck) { setPhase("DONE"); blip(880, volume, 0.3); }
      else { setTurn((t2) => t2 + 1); setPhase("PLAY_A"); }
    }, REVEAL_MS);
    return () => clearTimeout(t);
  }, [phase, board, decks, turn, volume]);

  return (
    <div className="tb-screen tb-safe w-full flex flex-col font-mono" style={{ background: UI.ground, color: UI.text }}>
      <div className="flex-1 min-h-0 flex flex-col w-full mx-auto px-3" style={{ maxWidth: PHONE_W }}>
        <div className="flex items-center justify-between h-9 shrink-0">
          <button onClick={onExit} className="flex items-center gap-1 text-[10px] tracking-[0.25em] py-2 -ml-1" style={{ color: UI.dim }}>
            <ChevronLeft size={13} /> MENU
          </button>
          <div className="text-[10px] tracking-[0.2em]" style={{ color: UI.dim }}>{solo ? oppName : "TAKE TURNS"}</div>
        </div>

        <ScoreBar score={score} turn={turn} turns={TURNS} inkA={INK.A} inkB={INK.B} labelA="P1" labelB={solo ? "AI" : "P2"} />

        <div ref={stageRef} className="flex-1 min-h-0 flex items-center justify-center">
          <div className="relative" style={{ width: cell * COLS + g * (COLS + 1), height: cell * ROWS + g * (ROWS + 1) }}>
            <BoardGrid
              board={board} cell={cell} ink={INK} theme={theme} youSide={player}
              ghostKeys={pl.ghostKeys} ghostLegal={pl.ghostLegal} ghostInk={INK[player]}
              contestedKeys={contestedKeys} boardRef={pl.boardRef} onPointerDown={pl.onBoardPointerDown}
            />

            {phase === "HANDOFF" && (
              <div className="absolute inset-0 flex flex-col items-center justify-center text-center px-5 rounded" style={{ background: UI.ground }}>
                <div className="text-[10px] tracking-[0.3em] mb-2" style={{ color: UI.dim }}>MOVE LOCKED IN</div>
                <div className="text-sm mb-6 leading-relaxed">Hand the device to <span style={{ color: INK.B }}>Player 2</span>.</div>
                <button onClick={() => setPhase("PLAY_B")} className="px-5 rounded text-[11px] tracking-widest" style={{ height: 44, background: INK.B, color: UI.ground }}>
                  I'M PLAYER 2
                </button>
              </div>
            )}

            {phase === "DONE" && (
              <div className="absolute inset-0 flex flex-col items-center justify-center text-center px-4 rounded" style={{ background: "rgba(14,18,22,.93)" }}>
                <div className="text-[9px] tracking-[0.3em] mb-3" style={{ color: UI.dim }}>MATCH OVER</div>
                <div className="text-xl mb-1.5 tracking-wider">
                  {score.a === score.b ? "DRAW" : (
                    <span style={{ color: score.a > score.b ? INK.A : INK.B }}>
                      {score.a > score.b ? "YOU WIN" : solo ? "AI WINS" : "PLAYER 2 WINS"}
                    </span>
                  )}
                </div>
                <div className="text-xs mb-6" style={{ color: UI.dim }}>
                  {score.a} — {score.b}{score.s > 0 && <span style={{ color: GOLD }}> · {score.s}◆</span>}
                </div>
                <div className="flex gap-2">
                  <button onClick={onExit} className="px-4 rounded text-[10px] tracking-widest" style={{ height: 40, border: `1px solid ${UI.line}`, color: UI.dim }}>MENU</button>
                  <button onClick={onRestart} className="flex items-center gap-1.5 px-4 rounded text-[10px] tracking-widest" style={{ height: 40, background: UI.text, color: UI.ground }}>
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
              <HandRow hand={hand} selIdx={pl.sel.handIdx} dragging={pl.dragging} ink={INK[player]} onPress={pl.onCardPointerDown} />
              <ActionBar
                ink={INK[player]}
                onRotate={pl.rotate} onCommit={commit} onDiscard={discard}
                canRotate={pl.sel.handIdx !== null} canCommit={pl.ghostLegal} canDiscard={pl.sel.handIdx !== null}
              />
              <div className="text-[10px] truncate" style={{ color: UI.dim, height: 14 }}>
                {stuck ? <span style={{ color: UI.bad }}>Nowhere to play — drop a block.</span>
                  : pl.sel.handIdx === null ? "Drag a block onto the grid."
                  : !pl.sel.pos ? "Drag it onto the grid."
                  : !pl.ghostLegal ? <span style={{ color: UI.bad }}>Must touch your own ink.</span>
                  : "Drag to adjust, then lock in."}
              </div>
            </>
          )}

          {phase === "AI_THINK" && (
            <div className="text-[11px] tracking-[0.25em] tb-pulse pb-4" style={{ color: INK.B }}>{oppName} IS THINKING</div>
          )}

          {phase === "REVEAL" && reveal && (
            <div className="text-[10px] space-y-1.5 pb-4">
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
function NetGame({ colors, volume, theme, onResult }) {
  const m = useMatch();
  const [err, setErr] = useState(null);
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
  const hand = m?.hand ?? [];
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
  const stuck = useMemo(() => (canAct && board ? !hasAnyMove(board, hand, you) : false), [canAct, board, hand, you]);

  const g = theme.gap;
  const cell = Math.max(6, Math.floor(Math.min(
    (stage.w - g * (COLS + 1)) / COLS,
    (stage.h - g * (ROWS + 1)) / ROWS
  )));

  // null until one player locks in; the server then broadcasts a deadline.
  const secsLeft = m?.deadline ? Math.max(0, Math.ceil((m.deadline - now) / 1000)) : null;

  const commit = () => {
    if (!pl.ghostLegal || pl.sel.handIdx === null) return;
    blip(560, volume);
    net.move({ turn: m.turn, handIdx: pl.sel.handIdx, rot: ((pl.sel.rot % 4) + 4) % 4, pos: pl.sel.pos });
    pl.reset();
  };

  const discard = () => {
    if (pl.sel.handIdx === null) return;
    blip(300, volume);
    net.discard({ turn: m.turn, handIdx: pl.sel.handIdx });
    pl.reset();
  };

  useEffect(() => {
    if (m?.reveal?.contested?.length) blip(1050, volume, 0.16);
  }, [m?.reveal, volume]);

  if (!m || !board) {
    return (
      <div className="tb-screen tb-safe w-full flex items-center justify-center font-mono" style={{ background: UI.ground, color: UI.dim }}>
        <div className="text-[11px] tracking-[0.3em] tb-pulse">DEALING…</div>
      </div>
    );
  }

  const myScore = you === "A" ? score.a : score.b;
  const theirScore = you === "A" ? score.b : score.a;

  return (
    <div className="tb-screen tb-safe w-full flex flex-col font-mono" style={{ background: UI.ground, color: UI.text }}>
      <div className="flex-1 min-h-0 flex flex-col w-full mx-auto px-3" style={{ maxWidth: PHONE_W }}>
        <div className="flex items-center justify-between h-9 shrink-0">
          <div className="text-[10px] tracking-[0.25em]" style={{ color: UI.dim }}>RANKED</div>
          <div className="flex items-center gap-2">
            {theme.showTimer && secsLeft !== null && (
              <span className="flex items-center gap-1 text-[10px] tabular-nums" style={{ color: secsLeft <= 5 ? UI.bad : GOLD }}>
                <Clock size={11} /> {secsLeft}
              </span>
            )}
            <span className="text-[10px] tracking-[0.2em]" style={{ color: UI.dim }}>
              {m.opponent.name} · {m.opponent.rating}
            </span>
          </div>
        </div>

        <ScoreBar
          score={{ a: myScore, b: theirScore, s: score.s }}
          turn={m.turn} turns={m.turns}
          inkA={colors.you} inkB={colors.rival} labelA="YOU" labelB="OPP"
        />

        <div ref={stageRef} className="flex-1 min-h-0 flex items-center justify-center">
          <div className="relative" style={{ width: cell * COLS + g * (COLS + 1), height: cell * ROWS + g * (ROWS + 1) }}>
            <div style={{ transform: flip ? "rotate(180deg)" : "none" }}>
              <BoardGrid
                board={board} cell={cell} ink={INK} theme={theme} youSide={you}
                ghostKeys={pl.ghostKeys} ghostLegal={pl.ghostLegal} ghostInk={colors.you}
                contestedKeys={contestedKeys} boardRef={pl.boardRef} onPointerDown={pl.onBoardPointerDown}
              />
            </div>
            {m.oppDropped && (
              <div className="absolute inset-0 flex flex-col items-center justify-center text-center px-5 rounded" style={{ background: "rgba(14,18,22,.92)" }}>
                <div className="text-[10px] tracking-[0.3em] mb-2" style={{ color: GOLD }}>OPPONENT DROPPED</div>
                <div className="text-[11px] leading-relaxed" style={{ color: UI.dim }}>
                  Holding their seat for a moment. If they don't return, you take the win.
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="shrink-0 flex flex-col justify-end" style={{ height: DOCK_H }}>
          <HandRow
            hand={hand} selIdx={pl.sel.handIdx} dragging={pl.dragging}
            ink={colors.you} onPress={pl.onCardPointerDown} disabled={!canAct}
          />
          <ActionBar
            ink={colors.you}
            onRotate={pl.rotate} onCommit={commit} onDiscard={discard}
            canRotate={canAct && pl.sel.handIdx !== null}
            canCommit={canAct && pl.ghostLegal}
            canDiscard={canAct && pl.sel.handIdx !== null}
          />
          <div className="text-[10px] truncate" style={{ color: UI.dim, height: 14 }}>
            {err ? <span style={{ color: UI.bad }}>{err}</span>
              : m.reveal ? (
                m.reveal.contested.length
                  ? <span style={{ color: GOLD }}>{m.reveal.contested.length} went special</span>
                  : "Turn resolved."
              )
              : m.submitted ? <span className="tb-pulse">Locked in — waiting for {m.opponent.name}…</span>
              : m.oppReady ? <span style={{ color: GOLD }}>They've locked in. Your move.</span>
              : stuck ? <span style={{ color: UI.bad }}>Nowhere to play — drop a block.</span>
              : pl.sel.handIdx === null ? "Drag a block onto the grid."
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
  const { won, drew, forfeit, myScore, oppScore, special, opponent, rating } = over;
  const trFrom = Math.round(rating.before.r);
  const trTo = Math.round(rating.after.r);
  const delta = trTo - trFrom;
  const riFrom = rankIndexFor(trFrom);
  const riTo = rankIndexFor(trTo);
  const rank = RANKS[riTo];

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
      <div className="w-full" style={{ maxWidth: 330 }}>
        <div className="text-center mb-7">
          <div className="text-[32px] leading-none tracking-[0.15em]" style={{ color: drew ? UI.text : won ? colors.you : UI.bad }}>
            {drew ? "DRAW" : won ? "VICTORY" : "DEFEAT"}
          </div>
          <div className="text-[11px] mt-3" style={{ color: UI.dim }}>
            {myScore} — {oppScore} vs {opponent.name}
            {special > 0 && <span style={{ color: GOLD }}> · {special}◆</span>}
          </div>
          {forfeit && <div className="text-[10px] mt-1.5" style={{ color: GOLD }}>opponent forfeited</div>}
        </div>

        <div className="rounded p-4 mb-4" style={{ background: UI.panel, border: `1px solid ${UI.line}` }}>
          <div className="flex items-center gap-3.5 mb-4">
            <div className="rounded flex items-center justify-center shrink-0" style={{ width: 58, height: 58, background: `${rank.color}1F`, border: `1.5px solid ${rank.color}` }}>
              <span className="text-2xl" style={{ color: rank.color }}>{rank.name}</span>
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-baseline gap-2">
                <span className="text-2xl leading-none tabular-nums">{shown}</span>
                <span className="text-sm tabular-nums" style={{ color: delta >= 0 ? UI.good : UI.bad }}>
                  {delta >= 0 ? "+" : ""}{delta}
                </span>
              </div>
              <div className="h-1 w-full rounded overflow-hidden mt-3" style={{ background: UI.cell }}>
                <div style={{ width: `${rankProgress(shown) * 100}%`, height: "100%", background: rank.color, transition: "width 120ms linear" }} />
              </div>
            </div>
          </div>
          <div className="flex justify-between text-[9px]" style={{ color: UI.dim }}>
            <span>DEVIATION ±{Math.round(rating.after.rd)}</span>
            <span>from ±{Math.round(rating.before.rd)}</span>
          </div>
        </div>

        {riTo !== riFrom && (
          <div className="rounded px-3.5 py-2.5 mb-4 text-[10px] tracking-[0.2em] text-center"
            style={{ background: `${rank.color}14`, border: `1px solid ${rank.color}`, color: rank.color }}>
            {riTo > riFrom ? `PROMOTED TO ${rank.name}` : `DEMOTED TO ${rank.name}`}
          </div>
        )}

        <div className="flex gap-2.5">
          <button onClick={onMenu} className="flex-1 rounded text-[10px] tracking-[0.25em]" style={{ height: 48, border: `1px solid ${UI.line}`, color: UI.dim }}>MENU</button>
          <button onClick={onQueue} className="rounded text-[10px] tracking-[0.25em]" style={{ height: 48, flex: 1.5, background: UI.text, color: UI.ground }}>QUEUE AGAIN</button>
        </div>
      </div>
    </div>
  );
}

/* ============================================================
   ROOT
   ============================================================ */
export default function TurfBlocks() {
  const [screen, setScreen] = useState("MENU");
  const [aiLevel, setAiLevel] = useState(4);
  const [seed, setSeed] = useState(0);
  const [loadout, setLoadoutState] = useState(loadLoadout);
  const [volume, setVolumeState] = useState(() => Number(store.get("tb:vol") ?? 0.5));
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
  }, []);

  useEffect(() => {
    if (!authed && (screen === "MATCHMAKING" || screen === "RANKED")) setScreen("MENU");
  }, [authed, screen]);

  const setTheme = (t) => { saveTheme(t); setThemeState(t); };
  const setLoadout = (updater) => setLoadoutState((prev) => {
    const next = typeof updater === "function" ? updater(prev) : updater;
    saveLoadout(next);
    return next;
  });
  const setVolume = (v) => { store.set("tb:vol", String(v)); setVolumeState(v); };
  const rename = (n) => { const v = n.trim().slice(0, 16); if (v) net.setName(v); };
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
      @keyframes tbContest { 0%,100% { transform: scale(1) } 45% { transform: scale(1.35) } }
      .tb-contest { animation: tbContest .38s ease-in-out 2; z-index: 2; }
      @keyframes tbDrop { from { transform: scale(.5) } to { transform: scale(1) } }
      .tb-drop { animation: tbDrop .16s ease-out both; }
      @keyframes tbPulse { 0%,100% { opacity:.4 } 50% { opacity:1 } }
      .tb-pulse { animation: tbPulse 1s ease-in-out infinite; }
      @keyframes tbBoot {
        0%   { filter: brightness(3.2) saturate(.4); transform: scale(.4); opacity: 0 }
        35%  { filter: brightness(2.4); transform: scale(1.14); opacity: 1 }
        100% { filter: brightness(1); transform: scale(1) }
      }
      .tb-boot { animation: tbBoot 820ms cubic-bezier(.2,.9,.3,1) both; }
      @keyframes tbSweep {
        0%   { transform: translateY(-140%) }
        100% { transform: translateY(320%) }
      }
      .tb-sweep { animation: tbSweep 5.2s linear infinite; }
      @keyframes tbDrift {
        0%,100% { transform: translate3d(0,0,0) }
        50%     { transform: translate3d(3%, -3%, 0) }
      }
      .tb-drift { animation: tbDrift 18s ease-in-out infinite; }
      @keyframes tbFade { from { opacity: 0 } to { opacity: 1 } }
      .tb-fade { animation: tbFade .14s ease-out both; }
      @keyframes tbPop { from { opacity: 0; transform: scale(.94) translateY(8px) } to { opacity: 1; transform: none } }
      .tb-pop { animation: tbPop .18s cubic-bezier(.2,.9,.3,1) both; }
      ${theme.motion ? "" : ".tb-contest,.tb-drop,.tb-pulse,.tb-fade,.tb-pop,.tb-boot,.tb-sweep,.tb-drift { animation: none !important }"}
      @media (prefers-reduced-motion: reduce) {
        .tb-contest,.tb-drop,.tb-pulse,.tb-fade,.tb-pop,.tb-boot,.tb-sweep,.tb-drift { animation: none }
      }
      button { -webkit-tap-highlight-color: transparent; }
      button:focus-visible { outline: 2px solid var(--tb-text); outline-offset: 2px; }
      input:focus { border-color: var(--tb-dim) !important; }
      input[type=color] { -webkit-appearance: none; cursor: pointer; }
      input[type=color]::-webkit-color-swatch-wrapper { padding: 2px; }
      input[type=color]::-webkit-color-swatch { border: none; border-radius: 3px; }
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
        volume={volume} setVolume={setVolume}
        colors={colors} profile={profile} status={status}
        name={name} rename={rename} onLogout={logout}
        theme={theme} setTheme={setTheme}
      />
    );
  else if (screen === "DIFFICULTY")
    view = (
      <Difficulty colors={colors} volume={volume}
        onBack={() => setScreen("MENU")}
        onStart={(lv) => { setAiLevel(lv); setSeed((s) => s + 1); setScreen("SOLO"); }} />
    );
  else if (screen === "MATCHMAKING")
    view = (
      <Matchmaking profile={profile} loadout={loadout} colors={colors} volume={volume}
        onCancel={() => setScreen("MENU")} />
    );
  else if (screen === "RANKED")
    view = <NetGame colors={colors} volume={volume} theme={theme} onResult={(o) => { setOver(o); setScreen("RESULT"); }} />;
  else if (screen === "RESULT")
    view = (
      <Result over={over} colors={colors}
        onMenu={() => { net.clearMatch(); setScreen("MENU"); }}
        onQueue={() => { net.clearMatch(); setScreen("MATCHMAKING"); }} />
    );
  else
    view = (
      <LocalGame key={seed} mode={screen} aiLevel={aiLevel} loadout={loadout}
        colors={colors} volume={volume} theme={theme}
        onExit={() => setScreen("MENU")}
        onRestart={() => setSeed((s) => s + 1)} />
    );

  return (<>{shell}{view}</>);
}