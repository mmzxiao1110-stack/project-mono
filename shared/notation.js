/**
 * Tesella notation — every move as a short string, like chess's algebraic
 * notation, so a whole game can be written down and replayed exactly.
 *
 * Squares: columns a–j from the left, rows 1–10 from the BOTTOM player's
 * side (so the bottom player's home is on row 1).
 *
 * An action is a piece, the square of its top-left corner (as the board is
 * drawn), and its rotation — 0, R (a quarter turn clockwise), 2, L:
 *     T.e3.R        place a T at e3, turned right
 *     xS.f8.L       delete: stamp an S at f8, turned left
 *     -             pass
 * A pinned placement ends in "+":
 *     T.e3.R+           place a T at e3, turned right, pinned
 * (Older games, from when pins were stamps, wrote the stamp after the "+":
 *     T.e3.R+O.d1.0     place, and pin with an O at d1)
 * A turn is both players' actions, bottom player first:
 *     12. T.e3.R+O.d1.0 / xS.f8.L
 *
 * The piece letter is redundant (the shared sequence fixes it) but makes the
 * text readable and lets a replay check itself.
 */
import { BLOCKS, ROWS, COLS, rotateN, absCells } from "./engine.js";

const FILES = "abcdefghij";
const ROT = ["0", "R", "2", "L"];

/** [row, col] (row 0 = top, as stored) → "e3". */
export const squareName = (r, c) => `${FILES[c]}${ROWS - r}`;

/** "e3" → [row, col], or null. */
export function parseSquare(s) {
  const m = /^([a-j])(10|[1-9])$/.exec(s || "");
  if (!m) return null;
  const c = FILES.indexOf(m[1]), r = ROWS - Number(m[2]);
  return r >= 0 && r < ROWS && c >= 0 && c < COLS ? [r, c] : null;
}

/** The rotation and top-left square of a piece footprint, or null if it isn't that piece. */
export function stampOf(cells, blockId) {
  if (!cells || !cells.length || !BLOCKS[blockId]) return null;
  const r0 = Math.min(...cells.map(([r]) => r)), c0 = Math.min(...cells.map(([, c]) => c));
  const want = new Set(cells.map(([r, c]) => r * COLS + c));
  for (let rot = 0; rot < 4; rot++) {
    const shape = rotateN(BLOCKS[blockId].cells, rot);
    if (shape.length === cells.length && shape.every(([dr, dc]) => want.has((r0 + dr) * COLS + (c0 + dc)))) return { rot, r: r0, c: c0 };
  }
  return null;
}

const stampText = (cells, blockId) => {
  const s = stampOf(cells, blockId);
  return s ? `${BLOCKS[blockId].name}.${squareName(s.r, s.c)}.${ROT[s.rot]}` : null;
};

/**
 * One player's action as text. `move` is the RAW action (as sent: a delete's
 * and a pin's cells are the stamp footprints), `blockId` the piece in hand.
 */
export function encodeAction(move, blockId) {
  let main = "-";
  if (move && (move.type === "place" || (!move.type && move.cells))) main = stampText(move.cells, blockId) || "-";
  else if (move && move.type === "delete") main = "x" + (stampText(move.cells, blockId) || "?");
  if (move && move.pin && main !== "-" && !main.startsWith("x")) main += "+";
  if (move && move.pins && move.pins.length) {
    const p = stampText(move.pins, blockId);
    if (p) main += "+" + p;
  }
  return main;
}

/** Text → a raw action for `blockId` ({ type, cells, pins? }), or null for a pass. Throws on nonsense. */
export function decodeAction(text, blockId) {
  const t = String(text || "-").trim();
  const [mainPart, pinPart] = t.split("+");
  const stamp = (s) => {
    const m = /^([A-Z])\.([a-j](?:10|[1-9]))\.([0R2L])$/.exec(s);
    if (!m) throw new Error(`bad stamp "${s}"`);
    if (BLOCKS[blockId].name !== m[1]) throw new Error(`expected ${BLOCKS[blockId].name}, got ${m[1]}`);
    const [r, c] = parseSquare(m[2]);
    return absCells(rotateN(BLOCKS[blockId].cells, ROT.indexOf(m[3])), [r, c]);
  };
  const pins = pinPart ? stamp(pinPart) : null;
  const pin = t.endsWith("+"); // "T.e3.R+": a pinned placement
  if (mainPart === "-" || mainPart === "") return pins ? { type: "pass", pins } : null;
  if (mainPart.startsWith("x")) return { type: "delete", cells: stamp(mainPart.slice(1)), ...(pins ? { pins } : null) };
  return { type: "place", cells: stamp(mainPart), blockId, ...(pins ? { pins } : null), ...(pin ? { pin: true } : null) };
}

/** A whole turn: "T.e3.R / xS.f8.L" (bottom player first). */
export const encodeTurn = (a, b) => `${a} / ${b}`;
export function splitTurn(text) {
  const [a, b] = String(text).replace(/^\d+\.\s*/, "").split("/").map((s) => s.trim());
  return [a || "-", b || "-"];
}
