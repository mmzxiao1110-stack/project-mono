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
  size: 20,        // the board is size × size
  turns: 60,       // rounds per match. Simulated: line clears show up in ~83% of games at 60, every game at 70
  // A match also ends early once neither player can place ANY piece from
  // their deck anywhere ("locked").

  /* ----------------------------------------------------------
     THE QUEUE
     You play exactly one piece per turn: the front of your queue. Your
     8-piece deck comes round in bags, Tetris-style — each pass through it
     deals all eight pieces once, freshly shuffled, so nothing floods and
     nothing goes missing.
     ---------------------------------------------------------- */
  queueShown: 8,   // upcoming pieces shown after the current one (both players see both queues)

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
