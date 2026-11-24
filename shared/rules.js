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
     BOARD AND MATCH LENGTH
     ---------------------------------------------------------- */
  size: 10,        // the board is size × size
  turns: 15,       // rounds per match. Simulated on 10×10: ~1.5 line clears and ~2.6 forced passes a game; 15 and 18 rank skill equally well
  // A match also ends early once neither player can place ANY piece from
  // their deck anywhere ("locked").

  /* ----------------------------------------------------------
     THE QUEUE
     The seven tetrominoes, dealt in a 7-bag like Tetris: each pass deals
     all seven once, freshly shuffled. You play exactly one piece per turn:
     the front of your queue.
     ---------------------------------------------------------- */
  queueShown: 4,   // upcoming pieces shown after the current one (both players see both queues)
  sharedSequence: true, // both players are dealt the exact same sequence: less luck, ranks skill better (simulated)

  /* ----------------------------------------------------------
     COLLISIONS
     A square both players claim on the same turn stays empty.
     ---------------------------------------------------------- */

  /* ----------------------------------------------------------
     LINE CLEARS
     Any row or column that is completely full — whatever the colours — is
     wiped for both players. Building too close to a full line invites your
     opponent to finish it for you.
     ---------------------------------------------------------- */
  clearRows: true,
  clearColumns: true,
  restoreHome: true, // a player wiped to nothing gets their starting domino back

  /* ----------------------------------------------------------
     THE CENTRE
     The middle 2×2 squares are worth extra at the end.
     ---------------------------------------------------------- */
  centreValue: 2,  // points per centre square (ordinary squares are worth 1)
};
