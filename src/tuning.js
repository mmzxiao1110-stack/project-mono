/**
 * MINO — visual tuning.
 *
 * Every number that controls how things look lives here. Change a value, save,
 * and the dev server reloads. Nothing here affects gameplay or the server.
 */

export const FX = {
  /* ----------------------------------------------------------
     SKETCH — how the hand-drawn ink behaves.
     Values are fractions of a square's size, so a board square and a
     tiny preview in the deck editor look like the same pen.
     ---------------------------------------------------------- */
  sketch: {
    inset: 0.1,          // gap between a square's edge and its drawn outline
    jitter: 0.05,        // how far strokes wander off true. 0 = ruler-straight
    hatchPitch: 0.11,    // spacing between hatch strokes. LOWER = denser shading
    hatchWidth: 0.06,    // hatch stroke thickness at the heavy end
    outlineWidth: 0.038, // outline stroke thickness (each pass)

    // --- the pencil itself ---
    grainSize: 0.7,      // paper tooth. HIGHER = finer grain, LOWER = coarse blotches
    grainBite: 2.1,      // how much the tooth breaks the line. 0 = clean ink, 4 = very broken

    gridOpacity: 0.6,    // the pencil grid under the board
    grain: 0.12,         // paper grain over the whole screen. 0 = off
    vignette: 0.45,      // darkening toward the screen edges. 0 = off
  },


  /* ----------------------------------------------------------
     GAME BOARD
     ---------------------------------------------------------- */
  board: {
    // --- the piece under your finger ---
    floatScale: 1.07,     // 1 = same size as the board, 1.2 = noticeably lifted
    floatShadow: "0 10px 14px rgba(0,0,0,.5)",
  },
};
