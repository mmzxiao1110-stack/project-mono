/**
 * MINO — gameplay rules.
 *
 * These live in shared/ rather than src/tuning.js because the SERVER imports
 * them too. If the client and server disagreed, boards would diverge mid-match
 * and legal moves would start bouncing.
 *
 * Restart the server after changing anything here.
 */

export const RULES = {
  /* ----------------------------------------------------------
     MATCH LENGTH
     ---------------------------------------------------------- */
  turns: 30,     // rounds per match
  handSize: 4,   // blocks held at once

  /* ----------------------------------------------------------
     GOLDEN TILE PROPERTY
     What happens to a square both players claim on the same turn.

     "special"     Turns gold. Permanent, unbuildable, counts for nobody.
     "vanish"      The square empties, like a Tetris clear.
     "clearRow"    Wipes the entire row — everyone's ink, both colours.
     "clearColumn" Same, vertically.
     "blast"       Clears a square area around the collision.
     "swap"        The square goes to whoever currently holds LESS turf.
     ---------------------------------------------------------- */
  golden: "vanish",
  blastRadius: 1,   // only used by "blast". 1 = 3x3, 2 = 5x5
  restoreHome: true, // give a wiped-out player their starting domino back

  /* ----------------------------------------------------------
     GOLDEN PIECE
     One slot in your deck charges up. Once charged, that block can be
     played straight over your opponent's ink and converts it to yours.
     ---------------------------------------------------------- */
  goldenSlot: 0,     // which deck slot is the golden one (0 = first)

  // How many times the block must be played before it charges.
  // Bigger blocks cost more, so a large golden piece is a rarer, heavier swing.
  goldenCycle: {
    small: 1,   // 1–3 squares
    medium: 2,  // 4–7 squares
    large: 3,   // 8–12 squares
  },

  // May a charged golden piece overwrite contested/special squares too?
  goldenEatsSpecial: false,
};