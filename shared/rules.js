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
  turns: 25,       // rounds per match. With delete and pin the board never clogs; 25 ranks skill well (simulated) and keeps draws near 12%
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
     THREE ACTIONS
     Each turn you place OR delete, and it uses up your current piece:
       place   your piece, as always
       delete  1–4 connected squares — anyone's, but never pinned ones.
               Every square you delete gives your OPPONENT one pin.
     and you may also
       pin     up to 4 connected squares of yours, paid from your pin
               meter. Pinned squares are permanent: line clears and
               deletes skip them. (With pinIsFree off, pinning is a turn
               of its own instead.)
     Order within a turn: pins, then deletes, then placements, then lines.
     ---------------------------------------------------------- */
  actions: true,          // false = place-only (the old game)
  deleteMax: 4,
  connectDiagonal: false, // may a delete/pin shape join at corners?
  pinOwnOnly: true,       // pin only your own squares (else any square with ink)
  pinCap: 8,              // most pins you can bank
  pinPerDelete: 1,        // pins your opponent gets for each square you delete
  pinMax: 4,              // most squares one pin covers
  pinConnected: true,     // must pinned squares touch each other?
  pinHoldMax: Infinity,   // most pinned squares one player may hold at once
  pinsSurviveClears: true, // false: full lines wipe pinned squares too (pins only stop deletes)
  stamp: false,           // delete/pin with your current piece's shape, placed anywhere
  pinIsFree: true,        // pins ride along with your action instead of taking the turn (simulated: as a turn of its own, pinning was never worth it)
  monoPiece: false,       // add the single square to the bag (8 pieces)

  /* ----------------------------------------------------------
     THE CENTRE
     The middle 2×2 squares are worth extra at the end.
     ---------------------------------------------------------- */
  centreValue: 2,  // points per centre square (ordinary squares are worth 1)
};
