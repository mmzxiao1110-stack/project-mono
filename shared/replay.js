/**
 * Replays. A replay is the two players' piece-sequence seeds plus every
 * turn in MINO notation (see notation.js). Because the rules are
 * deterministic, re-running those turns rebuilds every board exactly.
 *
 * playTurn() is the turn order the server and the local game use — kept
 * here so a replay can never disagree with the match it came from.
 *
 * A replay record:
 *   { v: 1, date, mode, you, players: { A: { name }, B: { name } },
 *     seeds: { A, B }, turns: ["T.e3.R / xS.f8.L", …],
 *     result: { a, b, reason, forfeitBy } }
 */
import {
  initialBoard, emptyPins, newDeck, advanceDeck, currentPiece, upcoming, currentPass,
  resolveTurn, nextMeters, normalizeAction, isCheckTurn, shrinkBoard, scoreOf, DEFAULT_LOADOUT,
} from "./engine.js";
import { RULES } from "./rules.js";
import { decodeAction, splitTurn } from "./notation.js";

export const REPLAY_VERSION = 1;

export function startState(seeds) {
  return {
    turn: 1, board: initialBoard(), pins: emptyPins(), meters: { A: 0, B: 0 }, ot: false,
    decks: { A: newDeck(DEFAULT_LOADOUT, seeds.A), B: newDeck(DEFAULT_LOADOUT, seeds.B) },
  };
}

/**
 * One turn from raw actions. Returns { state, res, moves, decided, flash }:
 * `moves` are the normalized actions (what each actually did), `decided` is
 * whether this turn's check ended the match, `flash` "OVERTIME" / "SHRINK".
 */
export function playTurn(st, rawA, rawB) {
  const pieceA = currentPiece(st.decks.A), pieceB = currentPiece(st.decks.B);
  const norm = (raw, side, piece) => {
    if (!raw) return null;
    const { move } = normalizeAction(st.board, st.pins, st.meters[side], side, piece, raw);
    return move || null; // an illegal action counts as a pass
  };
  const mA = norm(rawA, "A", pieceA), mB = norm(rawB, "B", pieceB);
  const res = resolveTurn(st.board, mA, mB, st.pins);
  const meters = nextMeters(st.meters, mA, mB, res.deleted);
  let ot = st.ot, decided = false, flash = null;
  if (isCheckTurn(st.turn)) {
    const sc = scoreOf(res.board);
    if (sc.a !== sc.b || !RULES.overtime) decided = true;
    else {
      flash = ot ? "SHRINK" : "OVERTIME";
      const { cleared, live } = shrinkBoard(res.board, res.pins);
      res.cleared.push(...cleared);
      ot = true;
      if (live <= 2) decided = true;
    }
  }
  return {
    state: {
      turn: st.turn + 1, board: res.board, pins: res.pins, meters, ot,
      decks: { A: advanceDeck(st.decks.A), B: advanceDeck(st.decks.B) },
    },
    res, moves: { A: mA, B: mB }, raw: { A: rawA, B: rawB }, pieces: { A: pieceA, B: pieceB }, decided, flash,
  };
}

/**
 * Every position of a replay: frames[0] is the start, frames[t] the board
 * after turn t, with what happened on that turn. Stops early if a turn
 * doesn't parse (a damaged or foreign replay).
 */
export function buildFrames(rec) {
  let st = startState(rec.seeds);
  const view = (s) => ({
    turn: s.turn, board: s.board, pins: s.pins, meters: s.meters, ot: s.ot, score: scoreOf(s.board),
    pieces: { A: currentPiece(s.decks.A), B: currentPiece(s.decks.B) },
    queues: { A: upcoming(s.decks.A), B: upcoming(s.decks.B) },
    bag: currentPass(s.decks.A),
  });
  const frames = [{ ...view(st), played: null }];
  let error = null;
  for (let i = 0; i < rec.turns.length; i++) {
    try {
      const [ta, tb] = splitTurn(rec.turns[i]);
      const rawA = decodeAction(ta, currentPiece(st.decks.A));
      const rawB = decodeAction(tb, currentPiece(st.decks.B));
      const out = playTurn(st, rawA, rawB);
      st = out.state;
      frames.push({ ...view(st), played: { text: [ta, tb], moves: out.moves, res: out.res, pieces: out.pieces, flash: out.flash, decided: out.decided } });
    } catch (e) {
      error = `Turn ${i + 1}: ${e.message}`;
      break;
    }
  }
  return { frames, error };
}

/** A replay as a share code (base64 of its JSON), and back. */
export function exportReplay(rec) {
  const json = JSON.stringify(rec);
  const b64 = typeof btoa === "function" ? btoa(unescape(encodeURIComponent(json))) : globalThis.Buffer.from(json, "utf8").toString("base64");
  return `MINO1:${b64}`;
}
export function importReplay(code) {
  const m = /^MINO1:([A-Za-z0-9+/=\s]+)$/.exec(String(code || "").trim());
  if (!m) throw new Error("That isn't a MINO replay code.");
  const b64 = m[1].replace(/\s+/g, "");
  const json = typeof atob === "function" ? decodeURIComponent(escape(atob(b64))) : globalThis.Buffer.from(b64, "base64").toString("utf8");
  const rec = JSON.parse(json);
  if (!rec || rec.v !== REPLAY_VERSION || !rec.seeds || !Array.isArray(rec.turns)) throw new Error("That replay is damaged or from another version.");
  return rec;
}
