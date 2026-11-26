// Control lab: bots play whole matches through the real turn resolution; logs replays.
import { startState, playTurn, REPLAY_VERSION } from "../shared/replay.js";
import { currentPiece, scoreOf, upcoming } from "../shared/engine.js";
import { encodeAction, encodeTurn } from "../shared/notation.js";
import { aiPickAction, aiPickActionDeep } from "../shared/ai.js";
import { RULES } from "../shared/rules.js";
export const LEVELS = 10;
export const bots = {
  l10: (st, side) => aiPickAction(st, currentPiece(st.decks[side]), side, 10, LEVELS),
  l7: (st, side) => aiPickAction(st, currentPiece(st.decks[side]), side, 7, LEVELS),
  deep: (st, side, o) => aiPickActionDeep(st, currentPiece(st.decks[side]), side, currentPiece(st.decks[side === "A" ? "B" : "A"]), o),
  deep2: (st, side, o) => aiPickActionDeep(st, currentPiece(st.decks[side]), side, currentPiece(st.decks[side === "A" ? "B" : "A"]), { ...o, next: upcoming(st.decks[side])[0] }),
};
export function play(botA, botB, seed, optsA, optsB) {
  let st = startState({ A: seed, B: RULES.sharedSequence ? seed : seed + 1 });
  const turns = [];
  for (let i = 0; i < 400; i++) {
    const a = botA(st, "A", optsA), b = botB(st, "B", optsB);
    const pa = currentPiece(st.decks.A), pb = currentPiece(st.decks.B);
    turns.push(encodeTurn(encodeAction(a, pa), encodeAction(b, pb)));
    const out = playTurn(st, a, b);
    st = out.state;
    if (out.decided) break;
  }
  const sc = scoreOf(st.board);
  return { a: sc.a, b: sc.b, turns, seeds: { A: seed, B: RULES.sharedSequence ? seed : seed + 1 } };
}
export const record = (g, nameA, nameB) => ({ v: REPLAY_VERSION, date: Date.now(), mode: "solo", you: null,
  players: { A: { name: nameA }, B: { name: nameB } }, seeds: g.seeds, turns: g.turns, result: { a: g.a, b: g.b, reason: "turns" } });
