/**
 * MINO — visual tuning.
 *
 * Every number that controls how things look lives here. Change a value, save,
 * and the dev server reloads. Nothing here affects gameplay or the server.
 */

export const FX = {
  /* ----------------------------------------------------------
     GAME BOARD
     ---------------------------------------------------------- */
  board: {
    // --- frameless mode (Theme -> BLOCKS -> BOARD FRAME off) ---
    slotBorderWidth: 1,   // px outline around each empty slot
    slotBorderColor: "color-mix(in srgb, var(--tb-line) 70%, transparent)",
    slotFill: 100,         // % opacity of an empty slot

    // --- framed mode ---
    frameColor: "color-mix(in srgb, var(--tb-line) 42%, transparent)",
    frameRadius: 4,       // px corner rounding of the whole board
    frameBlur: 2,         // px backdrop blur behind the board. 0 = off
    cellFill: 46,         // % opacity of an empty cell

    // --- pieces ---
    pieceOpacity: 90,     // % opacity of a claimed square
    specialRing: 2,       // px dark inset on contested squares. 0 = off

    // --- landing shadow while dragging ---
    ghostFill: 20,        // % opacity of the shadow's fill
    ghostBorderWidth: 1.5,// px outline of the shadow

    // --- the floating piece under your finger ---
    floatScale: 1.07,     // 1 = same size as the board, 1.2 = noticeably lifted
    floatShadow: "0 8px 16px rgba(0,0,0,.55)",
  },
};