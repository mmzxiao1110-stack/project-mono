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
  turns: 50,       // rounds per match: about 8–15 minutes. The board never clogs; longer games rank skill better (simulated)
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
       delete  stamp your piece's shape anywhere: every square with ink
               under it is wiped — anyone's, never pinned ones.
               Any delete gives your OPPONENT 2 pins.
     and you may also
       pin     stamp your piece's shape over your own squares to pin them,
               one pin per square. Pinned squares can't be deleted — but a
               full line still wipes them.
     So: pins beat deletes, deletes beat line clears (break the line),
     line clears beat pins.
     Order within a turn: pins, then deletes, then placements, then lines.
     (Every number here was chosen by simulation; see the notes beside each.)
     ---------------------------------------------------------- */
  actions: true,          // false = place-only (the old game)
  deleteMax: 4,
  connectDiagonal: false, // may a delete/pin shape join at corners?
  pinOwnOnly: true,       // pin only your own squares (else any square with ink)
  pinCap: 8,              // most pins you can bank
  pinPerDelete: 1,        // pins your opponent gets for each square you delete
  pinsPerDeleteTurn: 2,   // a flat 2 pins for any delete, however many squares (0 = per square)
  pinMax: 4,              // most squares one pin covers
  pinConnected: true,     // must pinned squares touch each other?
  pinHoldMax: Infinity,   // most pinned squares one player may hold at once
  pinsSurviveClears: false, // full lines wipe pinned squares too: pins beat deletes, deletes beat clears, clears beat pins
  stamp: true,            // delete/pin with your current piece's shape, placed anywhere (fewer, readable options)
  pinIsFree: true,        // pins ride along with your action instead of taking the turn (simulated: as a turn of its own, pinning was never worth it)
  monoPiece: false,       // add the single square to the bag (8 pieces)

  /* ----------------------------------------------------------
     OVERTIME
     Tied after the last turn? Overtime: the board's outer ring dies
     (greyed out; its squares are gone and nobody can play there) and the
     game goes on. Every RULES.overtimeEvery turns it's checked again;
     still tied, the next ring dies: 10×10 → 8×8 → 6×6 → 4×4 → 2×2.
     When only the centre 2×2 is left, those four squares decide it — or
     it's a draw.
     ---------------------------------------------------------- */
  overtime: true,
  overtimeEvery: 20,

  /* ----------------------------------------------------------
     THE CENTRE
     The middle 2×2 squares are worth extra at the end.
     ---------------------------------------------------------- */
  centreValue: 2,  // points per centre square (ordinary squares are worth 1)
};
