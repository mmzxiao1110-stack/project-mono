import React, { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { RotateCw, Check, SkipForward, RefreshCw, ChevronLeft, Wifi, Settings2, X, VolumeX } from "lucide-react";

/* ============================================================
   TUNING KNOBS
   ============================================================ */
const COLS = 8;
const ROWS = 16;
const TURNS = 20;
const HAND_SIZE = 4;
const SLOTS = 8;
const COPIES_PER_TYPE = 8;
const REVEAL_MS = 1100;
const AI_THINK_MS = 550;
const TOUCH_LIFT = 2;

const PHONE_W = 440; // column width cap — the game is a phone-shaped app
const DOCK_H = 140; // fixed bottom panel so the board never jumps
const GAP = 2;

const GOLD = "#F2B33D";

const UI = {
  ground: "#0E1216",
  panel: "#151B21",
  line: "#222C35",
  cell: "#171E25",
  text: "#C7D2DC",
  dim: "#6B7A88",
  bad: "#EF6B6B",
};

const PALETTE = [
  "#22D3EE", "#4ADE80", "#A78BFA", "#F472B6",
  "#FB923C", "#F87171", "#60A5FA", "#E2E8F0",
];
const rivalFor = (c) => PALETTE[(PALETTE.indexOf(c) + 4) % PALETTE.length];

/* ============================================================
   BLOCK LIBRARY — SMALL 1-3 · MEDIUM 4-7 · BIG 8-12
   ============================================================ */
const BLOCKS = [
  { name: "DOT", cells: [[0, 0]] },
  { name: "BAR", cells: [[0, 0], [0, 1]] },
  { name: "TWIN", cells: [[0, 0], [1, 1]] },
  { name: "GAP", cells: [[0, 0], [0, 2]] },
  { name: "RUN", cells: [[0, 0], [0, 1], [0, 2]] },
  { name: "ELL", cells: [[0, 0], [1, 0], [1, 1]] },
  { name: "STEP", cells: [[0, 0], [1, 1], [2, 2]] },
  { name: "WEDGE", cells: [[0, 0], [0, 2], [1, 1]] },
  { name: "SPUR", cells: [[0, 0], [1, 0], [1, 2]] },
  { name: "SPRAY", cells: [[0, 0], [1, 2], [2, 0]] },
  { name: "BLOK", cells: [[0, 0], [0, 1], [1, 0], [1, 1]] },
  { name: "TEE", cells: [[0, 0], [0, 1], [0, 2], [1, 1]] },
  { name: "ZIG", cells: [[0, 1], [0, 2], [1, 0], [1, 1]] },
  { name: "LINE", cells: [[0, 0], [0, 1], [0, 2], [0, 3]] },
  { name: "JAY", cells: [[0, 0], [1, 0], [2, 0], [2, 1]] },
  { name: "PINS", cells: [[0, 0], [0, 2], [2, 0], [2, 2]] },
  { name: "CROSS", cells: [[0, 1], [1, 0], [1, 1], [1, 2], [2, 1]] },
  { name: "LANCE", cells: [[0, 0], [0, 1], [0, 2], [0, 3], [0, 4]] },
  { name: "PEE", cells: [[0, 0], [0, 1], [1, 0], [1, 1], [2, 0]] },
  { name: "FORK", cells: [[0, 0], [0, 2], [1, 1], [2, 0], [2, 2]] },
  { name: "SLAB", cells: [[0, 0], [0, 1], [1, 0], [1, 1], [2, 0], [2, 1]] },
  { name: "HOOK", cells: [[0, 0], [1, 0], [2, 0], [2, 1], [2, 2], [1, 2]] },
  { name: "AITCH", cells: [[0, 0], [0, 2], [1, 0], [1, 1], [1, 2], [2, 0], [2, 2]] },
  { name: "CHAIR", cells: [[0, 0], [0, 1], [1, 0], [1, 1], [2, 0], [2, 1], [2, 2]] },
  { name: "RING", cells: [[0, 0], [0, 1], [0, 2], [1, 0], [1, 2], [2, 0], [2, 1], [2, 2]] },
  { name: "BRICK", cells: [[0, 0], [0, 1], [0, 2], [0, 3], [1, 0], [1, 1], [1, 2], [1, 3]] },
  { name: "RAMP", cells: [[0, 0], [1, 0], [1, 1], [2, 0], [2, 1], [2, 2], [3, 0], [3, 1], [3, 2]] },
  { name: "CORE", cells: [[0, 0], [0, 1], [0, 2], [1, 0], [1, 1], [1, 2], [2, 0], [2, 1], [2, 2]] },
  { name: "TOWER", cells: [[0, 0], [0, 1], [1, 0], [1, 1], [2, 0], [2, 1], [3, 0], [3, 1], [4, 0], [4, 1]] },
  { name: "FORT", cells: [[0, 0], [0, 1], [0, 2], [1, 0], [1, 1], [1, 2], [2, 0], [2, 1], [2, 2], [3, 1]] },
  { name: "VAULT", cells: [[0, 0], [0, 1], [0, 2], [1, 0], [1, 1], [1, 2], [2, 0], [2, 1], [2, 2], [3, 0], [3, 1], [3, 2]] },
];

const sizeOf = (n) => (n <= 3 ? "SMALL" : n <= 7 ? "MEDIUM" : "BIG");
const idOf = (name) => BLOCKS.findIndex((b) => b.name === name);
const DEFAULT_LOADOUT = ["DOT", "BAR", "RUN", "ELL", "BLOK", "TEE", "CROSS", "SLAB"].map(idOf);

const LEVELS = ["ROOKIE", "NOVICE", "CASUAL", "STEADY", "SHARP", "TACTICAL", "RUTHLESS", "SURGICAL", "MERCILESS", "ARCHITECT"];

function levelBlurb(n) {
  if (n <= 2) return "Drops blocks almost anywhere they fit.";
  if (n <= 4) return "Always grabs the biggest block available.";
  if (n <= 6) return "Protects the open space it needs to grow.";
  if (n <= 8) return "Pushes hard toward your half of the board.";
  return "Expands, advances, and cuts off your room to build.";
}

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
   RULES ENGINE — pure. Ships to the server unchanged.
   ============================================================ */
const key = (r, c) => r * COLS + c;

function normalize(cells) {
  const minR = Math.min(...cells.map((x) => x[0]));
  const minC = Math.min(...cells.map((x) => x[1]));
  return cells.map(([r, c]) => [r - minR, c - minC]);
}
function rotateCW(cells) {
  const maxR = Math.max(...cells.map((x) => x[0]));
  return normalize(cells.map(([r, c]) => [c, maxR - r]));
}
function rotateN(cells, n) {
  let out = cells;
  for (let i = 0; i < ((n % 4) + 4) % 4; i++) out = rotateCW(out);
  return out;
}
const boundsOf = (cells) => ({
  h: Math.max(...cells.map((x) => x[0])) + 1,
  w: Math.max(...cells.map((x) => x[1])) + 1,
});
const absCells = (cells, pos) => cells.map(([dr, dc]) => [pos[0] + dr, pos[1] + dc]);

function initialBoard() {
  const b = Array.from({ length: ROWS }, () => Array(COLS).fill(null));
  const m = Math.floor(COLS / 2) - 1;
  b[ROWS - 1][m] = "A";
  b[ROWS - 1][m + 1] = "A";
  b[0][m] = "B";
  b[0][m + 1] = "B";
  return b;
}

function isLegal(board, cells, owner) {
  for (const [r, c] of cells) {
    if (r < 0 || c < 0 || r >= ROWS || c >= COLS) return false;
    if (board[r][c] !== null) return false;
  }
  for (const [r, c] of cells)
    for (let dr = -1; dr <= 1; dr++)
      for (let dc = -1; dc <= 1; dc++) {
        if (dr === 0 && dc === 0) continue;
        const nr = r + dr, nc = c + dc;
        if (nr < 0 || nc < 0 || nr >= ROWS || nc >= COLS) continue;
        if (board[nr][nc] === owner) return true;
      }
  return false;
}

function enumerateMoves(board, hand, owner) {
  const out = [];
  const seen = new Set();
  for (let hi = 0; hi < hand.length; hi++) {
    const blockId = hand[hi];
    for (let rot = 0; rot < 4; rot++) {
      const cells = rotateN(BLOCKS[blockId].cells, rot);
      const { h, w } = boundsOf(cells);
      for (let r = 0; r <= ROWS - h; r++)
        for (let c = 0; c <= COLS - w; c++) {
          const abs = absCells(cells, [r, c]);
          if (!isLegal(board, abs, owner)) continue;
          const sig = hi + ":" + abs.map(([a, b]) => key(a, b)).sort((x, y) => x - y).join(",");
          if (seen.has(sig)) continue;
          seen.add(sig);
          out.push({ handIdx: hi, blockId, cells: abs, value: cells.length });
        }
    }
  }
  return out;
}

const hasAnyMove = (board, hand, owner) => enumerateMoves(board, hand, owner).length > 0;

function resolveTurn(board, moveA, moveB) {
  const nb = board.map((row) => [...row]);
  const aCells = moveA ? moveA.cells : [];
  const bCells = moveB ? moveB.cells : [];
  const bKeys = new Set(bCells.map(([r, c]) => key(r, c)));
  const contested = aCells.filter(([r, c]) => bKeys.has(key(r, c)));
  const ck = new Set(contested.map(([r, c]) => key(r, c)));
  for (const [r, c] of aCells) if (!ck.has(key(r, c))) nb[r][c] = "A";
  for (const [r, c] of bCells) if (!ck.has(key(r, c))) nb[r][c] = "B";
  for (const [r, c] of contested) nb[r][c] = "S";
  return { board: nb, contested };
}

function scoreOf(board) {
  let a = 0, b = 0, s = 0;
  for (const row of board)
    for (const v of row) {
      if (v === "A") a++;
      else if (v === "B") b++;
      else if (v === "S") s++;
    }
  return { a, b, s };
}

function shuffled(arr) {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function freshDeal(loadout) {
  const full = [];
  for (const id of loadout) for (let n = 0; n < COPIES_PER_TYPE; n++) full.push(id);
  const deck = shuffled(full);
  return { hand: deck.slice(0, HAND_SIZE), deck: deck.slice(HAND_SIZE) };
}

/* ============================================================
   AI
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
   HOOKS + SHARED UI
   ============================================================ */

/** Measures an element so the board can size itself to whatever space is left. */
function useSize() {
  const ref = useRef(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const read = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    read();
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", read);
      return () => window.removeEventListener("resize", read);
    }
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, size];
}

function BlockGlyph({ blockId, box = 40, color, gap = 1 }) {
  const cells = BLOCKS[blockId].cells;
  const { h, w } = boundsOf(cells);
  const span = Math.max(h, w);
  const size = Math.max(2, Math.floor((box - gap * (span - 1)) / span));
  const filled = new Set(cells.map(([r, c]) => r * 100 + c));
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: `repeat(${w}, ${size}px)`,
        gridTemplateRows: `repeat(${h}, ${size}px)`,
        gap,
        pointerEvents: "none",
      }}
    >
      {Array.from({ length: h * w }).map((_, i) => (
        <div
          key={i}
          style={{
            background: filled.has(Math.floor(i / w) * 100 + (i % w)) ? color : "transparent",
            borderRadius: 1,
          }}
        />
      ))}
    </div>
  );
}

function AmbientField({ loadout, colors }) {
  const [b, setB] = useState(initialBoard);
  const reduced =
    typeof window !== "undefined" && window.matchMedia &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  useEffect(() => {
    if (reduced) return;
    const id = setInterval(() => {
      setB((prev) => {
        let nb = prev, moved = false;
        for (const owner of ["A", "B"]) {
          const moves = enumerateMoves(nb, loadout, owner);
          if (!moves.length) continue;
          const m = moves[Math.floor(Math.random() * moves.length)];
          nb = nb.map((row) => [...row]);
          for (const [r, c] of m.cells) nb[r][c] = owner;
          moved = true;
        }
        return moved ? nb : initialBoard();
      });
    }, 640);
    return () => clearInterval(id);
  }, [reduced, loadout]);

  const ink = { A: colors.you, B: colors.rival };
  return (
    <div aria-hidden="true" className="absolute inset-0 overflow-hidden pointer-events-none" style={{ opacity: 0.13 }}>
      <div style={{ display: "grid", gridTemplateColumns: `repeat(${COLS}, 1fr)`, gap: 4, width: "100%", height: "100%" }}>
        {b.map((row, r) =>
          row.map((v, c) => (
            <div key={key(r, c)} style={{ background: v ? ink[v] : UI.cell, borderRadius: 3, transition: "background 600ms ease" }} />
          ))
        )}
      </div>
    </div>
  );
}

/** Full-screen sheet. Header pinned, body scrolls, scrollbar hidden. */
function Sheet({ title, onClose, children, pinned }) {
  return (
    <div className="tb-screen tb-safe fixed inset-0 z-40 flex flex-col" style={{ background: UI.ground, color: UI.text }}>
      <div className="w-full mx-auto flex flex-col min-h-0 flex-1" style={{ maxWidth: PHONE_W }}>
        <div className="flex items-center justify-between px-4 h-12 shrink-0" style={{ borderBottom: `1px solid ${UI.line}` }}>
          <span className="text-[10px] tracking-[0.3em]" style={{ color: UI.dim }}>{title}</span>
          <button onClick={onClose} style={{ color: UI.dim }} aria-label="Close" className="p-2 -mr-2">
            <X size={17} />
          </button>
        </div>
        {pinned && <div className="px-4 pt-3 shrink-0">{pinned}</div>}
        <div className="tb-scroll flex-1 min-h-0 overflow-y-auto px-4 pb-6">{children}</div>
      </div>
    </div>
  );
}

/* ============================================================
   SETTINGS — tap segments, no slider
   ============================================================ */
function SettingsModal({ volume, setVolume, onClose }) {
  const steps = 10;
  const cur = Math.round(volume * steps);
  return (
    <Sheet title="SETTINGS" onClose={onClose}>
      <div className="pt-4">
        <div className="flex items-center justify-between mb-3">
          <span className="text-[11px] tracking-[0.2em]">VOLUME</span>
          <span className="text-[11px]" style={{ color: UI.dim }}>{cur * 10}</span>
        </div>
        <div className="flex gap-1.5 mb-3">
          {Array.from({ length: steps }).map((_, i) => {
            const on = i < cur;
            return (
              <button
                key={i}
                onClick={() => { const v = (i + 1) / steps; setVolume(v); blip(560 + i * 40, v, 0.06); }}
                aria-label={`Volume ${(i + 1) * 10}`}
                className="flex-1 rounded"
                style={{ height: 40, background: on ? UI.text : UI.panel, border: `1px solid ${on ? UI.text : UI.line}` }}
              />
            );
          })}
        </div>
        <button
          onClick={() => setVolume(0)}
          className="flex items-center gap-2 px-3 rounded text-[10px] tracking-[0.2em]"
          style={{ height: 36, border: `1px solid ${UI.line}`, color: volume === 0 ? UI.text : UI.dim }}
        >
          <VolumeX size={13} /> MUTE
        </button>

        <div className="text-[10px] mt-8 pt-4 leading-relaxed" style={{ color: UI.dim, borderTop: `1px solid ${UI.line}` }}>
          Room for more rows here later — haptics, animation speed, colourblind palette.
        </div>
      </div>
    </Sheet>
  );
}

/* ============================================================
   DECK — slots pinned, library scrolls vertically
   ============================================================ */
function DeckModal({ loadout, setLoadout, color, setColor, volume, onClose }) {
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

  /** Once armed we block native scrolling by preventing touchmove. */
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

  /** Mouse drags start instantly. Touch needs a short hold so the list can still scroll. */
  const onPress = (e, blockId, from, instant) => {
    const sx = e.clientX, sy = e.clientY;
    if (instant || e.pointerType === "mouse") {
      e.preventDefault();
      beginDrag(blockId, from, sx, sy);
      return;
    }
    let armed = false;
    const timer = setTimeout(() => {
      armed = true;
      cleanup();
      beginDrag(blockId, from, sx, sy);
    }, 240);
    const watch = (ev) => {
      if (armed) return;
      if (Math.abs(ev.clientX - sx) > 9 || Math.abs(ev.clientY - sy) > 9) {
        clearTimeout(timer);
        cleanup();
      }
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
      <div className="flex items-center justify-between mb-3">
        {PALETTE.map((c) => (
          <button
            key={c}
            onClick={() => { setColor(c); blip(760, volume, 0.05); }}
            aria-label={`colour ${c}`}
            style={{
              width: 22, height: 22, borderRadius: 5, background: c,
              outline: color === c ? `2px solid ${UI.text}` : "none", outlineOffset: 2,
            }}
          />
        ))}
      </div>
      <div className="grid grid-cols-4 gap-1.5 pb-3" style={{ borderBottom: `1px solid ${UI.line}` }}>
        {loadout.map((blockId, i) => {
          const hot = drag && drag.over === i;
          return (
            <div
              key={i}
              ref={(el) => (slotRefs.current[i] = el)}
              onPointerDown={(e) => onPress(e, blockId, i, true)}
              className="rounded flex flex-col items-center justify-center gap-1 select-none"
              style={{
                height: 62,
                background: hot ? UI.cell : "transparent",
                border: `1px solid ${hot ? color : UI.line}`,
                touchAction: "none",
                opacity: drag && drag.from === i ? 0.35 : 1,
              }}
            >
              <BlockGlyph blockId={blockId} box={28} color={color} />
              <span className="text-[7px] tracking-wider" style={{ color: UI.dim }}>{BLOCKS[blockId].name}</span>
            </div>
          );
        })}
      </div>
    </>
  );

  return (
    <Sheet title="YOUR BLOCKS" onClose={onClose} pinned={pinned}>
      <div className="text-[10px] leading-relaxed pt-3 pb-4" style={{ color: UI.dim }}>
        Hold a block, then drag it up into a slot. Solo and take-turns matches give your
        opponent the same deck.
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
                <div
                  key={blockId}
                  onPointerDown={(e) => onPress(e, blockId, "lib", false)}
                  className="rounded flex flex-col items-center justify-center gap-1 select-none"
                  style={{
                    height: 68,
                    background: inDeck ? UI.cell : "transparent",
                    border: `1px solid ${inDeck ? color : UI.line}`,
                  }}
                >
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
    </Sheet>
  );
}

/* ============================================================
   MENU
   ============================================================ */
function Menu({ onPick, loadout, setLoadout, color, setColor, volume, setVolume, colors }) {
  const [modal, setModal] = useState(null);
  const [note, setNote] = useState(false);

  return (
    <div className="tb-screen tb-safe relative w-full flex items-center justify-center px-5 font-mono overflow-hidden" style={{ background: UI.ground, color: UI.text }}>
      <AmbientField loadout={loadout} colors={colors} />
      <div className="absolute inset-0 pointer-events-none" style={{ background: `radial-gradient(ellipse at center, ${UI.ground}CC 0%, ${UI.ground} 72%)` }} />

      <div className="relative w-full" style={{ maxWidth: 330 }}>
        <div className="text-center mb-8">
          <div className="text-[9px] tracking-[0.42em] mb-2.5" style={{ color: UI.dim }}>8 × 16 · 20 TURNS</div>
          <div className="text-[28px] leading-tight tracking-[0.2em]">TURF BLOCKS</div>
        </div>

        <button
          onClick={() => { setNote(true); blip(400, volume); }}
          className="w-full rounded flex flex-col items-center justify-center gap-1.5 mb-2.5"
          style={{ height: 88, background: UI.panel, border: `1px solid ${UI.line}` }}
        >
          <span className="text-[9px] tracking-[0.35em]" style={{ color: UI.dim }}>RANKED</span>
          <span className="text-base tracking-[0.28em]">MULTIPLAYER</span>
        </button>

        <div className="flex gap-2.5 mb-2.5">
          <button onClick={() => { onPick("DIFFICULTY"); blip(520, volume); }} className="flex-1 rounded flex items-center justify-center" style={{ height: 44, background: UI.panel, border: `1px solid ${UI.line}` }}>
            <span className="text-sm tracking-[0.28em]">SP</span>
          </button>
          <button onClick={() => { onPick("HOTSEAT"); blip(520, volume); }} className="flex-1 rounded flex items-center justify-center" style={{ height: 44, background: UI.panel, border: `1px solid ${UI.line}` }}>
            <span className="text-sm tracking-[0.2em]">TAKE TURNS</span>
          </button>
        </div>

        <div className="flex justify-between">
          <button onClick={() => setModal("DECK")} aria-label="Your blocks" className="rounded flex items-center justify-center" style={{ width: 44, height: 44, background: color }}>
            <div style={{ display: "grid", gridTemplateColumns: "8px 8px", gap: 2 }}>
              {[0, 1, 2, 3].map((i) => (
                <div key={i} style={{ background: i === 1 ? "transparent" : UI.ground, borderRadius: 1, height: 8 }} />
              ))}
            </div>
          </button>
          <button onClick={() => setModal("SETTINGS")} aria-label="Settings" className="rounded flex items-center justify-center" style={{ width: 44, height: 44, background: UI.panel, border: `1px solid ${UI.line}` }}>
            <Settings2 size={17} style={{ color: UI.dim }} />
          </button>
        </div>

        {note && (
          <div className="mt-4 rounded p-3 text-[10px] leading-relaxed" style={{ background: UI.panel, border: `1px solid ${UI.line}`, color: UI.dim }}>
            <div className="flex items-center gap-2 mb-1" style={{ color: GOLD }}>
              <Wifi size={12} /> NO SERVER YET
            </div>
            Ranked needs matchmaking and a referee that owns turn state. It's also where two
            players can bring different decks.
          </div>
        )}
      </div>

      {modal === "SETTINGS" && <SettingsModal volume={volume} setVolume={setVolume} onClose={() => setModal(null)} />}
      {modal === "DECK" && (
        <DeckModal loadout={loadout} setLoadout={setLoadout} color={color} setColor={setColor} volume={volume} onClose={() => setModal(null)} />
      )}
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
          {LEVELS.map((name, i) => {
            const n = i + 1, on = lv === n;
            return (
              <button
                key={n}
                onClick={() => { setLv(n); blip(480 + n * 30, volume, 0.05); }}
                className="rounded flex items-center justify-center text-sm"
                style={{
                  height: 44,
                  background: on ? colors.rival : UI.panel,
                  color: on ? UI.ground : UI.text,
                  border: `1px solid ${on ? colors.rival : UI.line}`,
                  opacity: on ? 1 : 0.45 + (n / 10) * 0.5,
                }}
              >
                {n}
              </button>
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
   GAME
   ============================================================ */
function Game({ mode, aiLevel, loadout, colors, volume, onExit, onRestart }) {
  const solo = mode === "SOLO";
  const INK = useMemo(() => ({ A: colors.you, B: colors.rival, S: GOLD }), [colors]);

  const [board, setBoard] = useState(initialBoard);
  const [turn, setTurn] = useState(1);
  const [phase, setPhase] = useState("PLAY_A");
  const [decks, setDecks] = useState(() => ({ A: freshDeal(loadout), B: freshDeal(loadout) }));
  const [pendingA, setPendingA] = useState(null);
  const [reveal, setReveal] = useState(null);
  const [sel, setSel] = useState({ handIdx: null, rot: 0, pos: null });
  const [dragging, setDragging] = useState(false);

  const boardRef = useRef(null);
  const dragRef = useRef({ cells: null, lift: 0 });
  const [stageRef, stage] = useSize();

  /* board sizes itself to whatever space is left over */
  const cell = Math.max(6, Math.floor(Math.min(
    (stage.w - GAP * (COLS + 1)) / COLS,
    (stage.h - GAP * (ROWS + 1)) / ROWS
  )));
  const boardW = cell * COLS + GAP * (COLS + 1);
  const boardH = cell * ROWS + GAP * (ROWS + 1);

  const player = phase === "PLAY_B" ? "B" : "A";
  const hand = decks[player].hand;
  const inPlay = phase === "PLAY_A" || phase === "PLAY_B";
  const score = useMemo(() => scoreOf(board), [board]);
  const oppName = solo ? `LV${aiLevel} ${LEVELS[aiLevel - 1]}` : "PLAYER 2";

  const rotated = useMemo(() => {
    if (sel.handIdx === null) return null;
    const id = hand[sel.handIdx];
    return id === undefined ? null : rotateN(BLOCKS[id].cells, sel.rot);
  }, [sel.handIdx, sel.rot, hand]);

  const ghost = useMemo(() => (rotated && sel.pos ? absCells(rotated, sel.pos) : null), [rotated, sel.pos]);
  const ghostLegal = useMemo(() => (ghost ? isLegal(board, ghost, player) : false), [ghost, board, player]);
  const ghostKeys = useMemo(() => new Set((inPlay && ghost ? ghost : []).map(([r, c]) => key(r, c))), [ghost, inPlay]);
  const contestedKeys = useMemo(() => new Set((reveal ? reveal.contested : []).map(([r, c]) => key(r, c))), [reveal]);
  const stuck = useMemo(() => (inPlay ? !hasAnyMove(board, hand, player) : false), [board, hand, player, inPlay]);

  const resetSel = () => setSel({ handIdx: null, rot: 0, pos: null });

  const updateFromPoint = useCallback((clientX, clientY) => {
    const el = boardRef.current;
    const cells = dragRef.current.cells;
    if (!el || !cells) return;
    const rect = el.getBoundingClientRect();
    const col = Math.floor(((clientX - rect.left) / rect.width) * COLS);
    const row = Math.floor(((clientY - rect.top) / rect.height) * ROWS) - dragRef.current.lift;
    const { h, w } = boundsOf(cells);
    setSel((s) => ({
      ...s,
      pos: [
        Math.max(0, Math.min(ROWS - h, row - Math.floor(h / 2))),
        Math.max(0, Math.min(COLS - w, col - Math.floor(w / 2))),
      ],
    }));
  }, []);

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
    if (!inPlay) return;
    e.preventDefault();
    setSel({ handIdx: i, rot: 0, pos: null });
    beginDrag(e, BLOCKS[hand[i]].cells);
  };

  const onBoardPointerDown = (e) => {
    if (!inPlay || !rotated) return;
    e.preventDefault();
    beginDrag(e, rotated);
  };

  const rotate = useCallback(() => {
    setSel((s) => {
      if (s.handIdx === null) return s;
      const id = decks[phase === "PLAY_B" ? "B" : "A"].hand[s.handIdx];
      if (id === undefined) return s;
      const { h, w } = boundsOf(rotateN(BLOCKS[id].cells, s.rot + 1));
      return {
        ...s,
        rot: s.rot + 1,
        pos: s.pos ? [Math.max(0, Math.min(ROWS - h, s.pos[0])), Math.max(0, Math.min(COLS - w, s.pos[1]))] : null,
      };
    });
  }, [decks, phase]);

  const nudge = useCallback((dr, dc) => {
    setSel((s) => {
      if (!s.pos || s.handIdx === null) return s;
      const id = decks[phase === "PLAY_B" ? "B" : "A"].hand[s.handIdx];
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
  }, [decks, phase]);

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

  const handOver = (move) => {
    setPendingA(move);
    setPhase(solo ? "AI_THINK" : "HANDOFF");
  };

  const commit = () => {
    if (sel.handIdx === null || !ghost || !ghostLegal) return;
    const id = hand[sel.handIdx];
    blip(560, volume);
    drawInto(player, sel.handIdx);
    const move = { cells: ghost, value: BLOCKS[id].cells.length, blockId: id };
    if (player === "A") handOver(move);
    else finish(pendingA, move);
    resetSel();
  };

  const discard = () => {
    if (sel.handIdx === null) return;
    blip(300, volume);
    drawInto(player, sel.handIdx);
    if (player === "A") handOver(null);
    else finish(pendingA, null);
    resetSel();
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

  useEffect(() => {
    const onKey = (e) => {
      if (!inPlay) return;
      if (e.key === "ArrowUp") { e.preventDefault(); nudge(-1, 0); }
      else if (e.key === "ArrowDown") { e.preventDefault(); nudge(1, 0); }
      else if (e.key === "ArrowLeft") { e.preventDefault(); nudge(0, -1); }
      else if (e.key === "ArrowRight") { e.preventDefault(); nudge(0, 1); }
      else if (e.key.toLowerCase() === "r") { e.preventDefault(); rotate(); }
      else if (e.key === "Enter") { e.preventDefault(); commit(); }
      else if (e.key >= "1" && e.key <= "4") {
        const i = Number(e.key) - 1;
        if (i < hand.length) setSel({ handIdx: i, rot: 0, pos: null });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const pct = (n) => Math.round((n / (ROWS * COLS)) * 100);

  return (
    <div className="tb-screen tb-safe w-full flex flex-col font-mono" style={{ background: UI.ground, color: UI.text }}>
      <div className="flex-1 min-h-0 flex flex-col w-full mx-auto px-3" style={{ maxWidth: PHONE_W }}>
        {/* header */}
        <div className="flex items-center justify-between h-9 shrink-0">
          <button onClick={onExit} className="flex items-center gap-1 text-[10px] tracking-[0.25em] py-2 -ml-1" style={{ color: UI.dim }}>
            <ChevronLeft size={13} /> MENU
          </button>
          <div className="text-[10px] tracking-[0.2em]" style={{ color: UI.dim }}>{solo ? oppName : "TAKE TURNS"}</div>
        </div>

        {/* score */}
        <div className="shrink-0 pb-2">
          <div className="flex justify-between text-[10px] mb-1">
            <span style={{ color: INK.A }}>P1 {score.a}</span>
            <span style={{ color: UI.dim }}>
              {Math.min(turn, TURNS)}/{TURNS}
              {score.s > 0 && <span style={{ color: GOLD }}> · {score.s}◆</span>}
            </span>
            <span style={{ color: INK.B }}>{score.b} {solo ? "AI" : "P2"}</span>
          </div>
          <div className="h-1 w-full flex rounded overflow-hidden" style={{ background: UI.cell }}>
            <div style={{ width: `${pct(score.a)}%`, background: INK.A }} />
            <div style={{ width: `${pct(score.s)}%`, background: GOLD }} />
            <div style={{ marginLeft: "auto", width: `${pct(score.b)}%`, background: INK.B }} />
          </div>
        </div>

        {/* board fills whatever is left */}
        <div ref={stageRef} className="flex-1 min-h-0 flex items-center justify-center">
          <div className="relative" style={{ width: boardW, height: boardH }}>
            <div
              ref={boardRef}
              onPointerDown={onBoardPointerDown}
              style={{
                display: "grid",
                gridTemplateColumns: `repeat(${COLS}, ${cell}px)`,
                gridTemplateRows: `repeat(${ROWS}, ${cell}px)`,
                gap: GAP,
                background: UI.line,
                padding: GAP,
                borderRadius: 4,
                touchAction: "none",
              }}
            >
              {board.map((row, r) =>
                row.map((v, c) => {
                  const k = key(r, c);
                  const isGhost = ghostKeys.has(k);
                  let bg = UI.cell, opacity = 1, boxShadow = "none";
                  if (v) bg = INK[v];
                  if (v === "S") boxShadow = "inset 0 0 0 2px rgba(14,18,22,.55)";
                  if (isGhost) {
                    bg = INK[player];
                    opacity = ghostLegal ? 0.55 : 0.2;
                    boxShadow = `inset 0 0 0 1px ${ghostLegal ? INK[player] : UI.bad}`;
                  }
                  return (
                    <div
                      key={k}
                      className={contestedKeys.has(k) ? "tb-contest" : v ? "tb-drop" : ""}
                      style={{ background: bg, opacity, boxShadow, borderRadius: 2 }}
                    />
                  );
                })
              )}
            </div>

            {phase === "HANDOFF" && (
              <div className="absolute inset-0 flex flex-col items-center justify-center text-center px-5 rounded" style={{ background: UI.ground }}>
                <div className="text-[10px] tracking-[0.3em] mb-2" style={{ color: UI.dim }}>MOVE LOCKED IN</div>
                <div className="text-sm mb-6 leading-relaxed">
                  Hand the device to <span style={{ color: INK.B }}>Player 2</span>.
                </div>
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
                  {score.a} — {score.b}
                  {score.s > 0 && <span style={{ color: GOLD }}> · {score.s}◆</span>}
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

        {/* dock — fixed height so the board never resizes mid-match */}
        <div className="shrink-0 flex flex-col justify-end" style={{ height: DOCK_H }}>
          {inPlay && (
            <>
              <div className="grid grid-cols-4 gap-1.5 mb-1.5">
                {hand.map((blockId, i) => {
                  const active = sel.handIdx === i;
                  return (
                    <div
                      key={i}
                      onPointerDown={(e) => onCardPointerDown(e, i)}
                      className="flex flex-col items-center justify-center gap-1 rounded select-none"
                      style={{
                        height: 66,
                        background: active ? UI.panel : "transparent",
                        border: `1px solid ${active ? INK[player] : UI.line}`,
                        touchAction: "none",
                        opacity: active && dragging ? 0.4 : 1,
                      }}
                    >
                      <BlockGlyph blockId={blockId} box={32} color={INK[player]} />
                      <div className="text-[7px] tracking-wider" style={{ color: UI.dim }}>
                        {BLOCKS[blockId].name} · {BLOCKS[blockId].cells.length}
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="flex items-center gap-1.5 mb-1">
                <button onClick={rotate} disabled={sel.handIdx === null} className="flex items-center justify-center gap-1 rounded text-[10px] tracking-widest disabled:opacity-30 flex-1" style={{ height: 42, border: `1px solid ${UI.line}` }}>
                  <RotateCw size={13} /> TURN
                </button>
                <button onClick={commit} disabled={!ghostLegal} className="flex items-center justify-center gap-1 rounded text-[10px] tracking-widest disabled:opacity-25" style={{ height: 42, flex: 1.4, background: ghostLegal ? INK[player] : UI.panel, color: ghostLegal ? UI.ground : UI.dim }}>
                  <Check size={13} /> LOCK IN
                </button>
                <button onClick={discard} disabled={sel.handIdx === null} className="flex items-center justify-center gap-1 rounded text-[10px] tracking-widest disabled:opacity-30 flex-1" style={{ height: 42, border: `1px solid ${UI.line}`, color: UI.dim }}>
                  <SkipForward size={13} /> DROP
                </button>
              </div>

              <div className="text-[10px] truncate" style={{ color: UI.dim, height: 14 }}>
                {stuck ? (
                  <span style={{ color: UI.bad }}>Nowhere to play — drop a block.</span>
                ) : sel.handIdx === null ? "Drag a block onto the grid."
                  : !sel.pos ? "Drag it onto the grid."
                  : !ghostLegal ? <span style={{ color: UI.bad }}>Must touch your own ink.</span>
                  : "Drag to adjust, then lock in."}
              </div>
            </>
          )}

          {phase === "AI_THINK" && (
            <div className="text-[11px] tracking-[0.25em] tb-pulse pb-4" style={{ color: INK.B }}>
              {oppName} IS THINKING
            </div>
          )}

          {phase === "HANDOFF" && (
            <div className="text-[10px] leading-relaxed pb-4" style={{ color: UI.dim }}>
              Player 1's block stays hidden until both sides commit — the same reason the
              server has to own turn state later.
            </div>
          )}

          {phase === "REVEAL" && reveal && (
            <div className="text-[10px] space-y-1.5 pb-4">
              {[["A", reveal.a, "P1"], ["B", reveal.b, solo ? "AI" : "P2"]].map(([side, mv, label]) => (
                <div key={side} className="flex items-center gap-2.5">
                  <span style={{ color: INK[side], width: 20 }}>{label}</span>
                  {mv ? (
                    <>
                      <BlockGlyph blockId={mv.blockId} box={20} color={INK[side]} />
                      <span style={{ color: UI.dim }}>{BLOCKS[mv.blockId].name}</span>
                    </>
                  ) : <span style={{ color: UI.dim }}>dropped</span>}
                </div>
              ))}
              {reveal.contested.length > 0 && (
                <div style={{ color: GOLD }}>{reveal.contested.length} went special</div>
              )}
            </div>
          )}
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
  const [loadout, setLoadout] = useState(DEFAULT_LOADOUT);
  const [color, setColor] = useState(PALETTE[0]);
  const [volume, setVolume] = useState(0.5);

  const colors = useMemo(() => ({ you: color, rival: rivalFor(color) }), [color]);

  const shell = (
    <style>{`
      .tb-screen { height: 100vh; height: 100dvh; overscroll-behavior: none; }
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
      @media (prefers-reduced-motion: reduce) { .tb-contest,.tb-drop,.tb-pulse { animation: none } }
      button { -webkit-tap-highlight-color: transparent; }
      button:focus-visible { outline: 2px solid #fff; outline-offset: 2px; }
    `}</style>
  );

  let view;
  if (screen === "MENU")
    view = (
      <Menu
        onPick={(t) => { if (t === "DIFFICULTY") setScreen("DIFFICULTY"); else { setSeed((s) => s + 1); setScreen("HOTSEAT"); } }}
        loadout={loadout} setLoadout={setLoadout}
        color={color} setColor={setColor}
        volume={volume} setVolume={setVolume}
        colors={colors}
      />
    );
  else if (screen === "DIFFICULTY")
    view = (
      <Difficulty
        colors={colors} volume={volume}
        onBack={() => setScreen("MENU")}
        onStart={(lv) => { setAiLevel(lv); setSeed((s) => s + 1); setScreen("SOLO"); }}
      />
    );
  else
    view = (
      <Game
        key={seed} mode={screen} aiLevel={aiLevel} loadout={loadout}
        colors={colors} volume={volume}
        onExit={() => setScreen("MENU")}
        onRestart={() => setSeed((s) => s + 1)}
      />
    );

  return (
    <>
      {shell}
      {view}
    </>
  );
}
