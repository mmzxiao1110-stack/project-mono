/**
 * MINO — visual tuning.
 *
 * Every number that controls how things look lives here. Change a value, save,
 * and the dev server reloads. Nothing here affects gameplay or the server.
 */

export const FX = {
  /* ----------------------------------------------------------
     MOSAIC FIELD (the backdrop during a match)
     ---------------------------------------------------------- */
  hex: {
    // Tile shape: "hex" | "square" | "diamond" | "triangle"
    shape: "square",
    // Corner rounding in px — only used by "square".
    squareRadius: 10,

    // Grid density. FEWER columns = BIGGER tiles in the same space.
    columns: 17,
    rows: 17,

    // Overall size of the clump. Bigger = spreads further toward the edges.
    fieldSize: "min(100vmin, 900px)",

    // --- the glass rim ---
    // Thickness of the border, as a fraction of the tile.
    // 0 = no rim at all · 0.16 = thick · 0.05 = hairline
    rimWidth: 0.10,
    // How pale the rim is: % of your ink mixed with white.
    // 0 = same colour as the fill · 100 = pure white
    rimTint: 50,
    // Opacity of the pane inside the rim, in %. Lower = more see-through.
    glassOpacity: 2,
    // Strength of the diagonal highlight. 0 = flat, 1 = mirror-bright.
    sheen: 0,

    // --- how much a ripple moves a tile ---
    minScale: 0.4,       // size at rest
    pulseScale: 0.5,     // added size at full pulse — RAISE FOR BIGGER PULSING
    pulseOpacity: 0.2,   // added opacity at full pulse
    brightnessBase: 0.4, // brightness at rest
    brightnessGain: 0.8, // added brightness at full pulse

    // Frozen value used when Settings -> STATIC BACKDROP is on.
    staticPulse: 1.0,

    // --- cursor / finger repulsion ---
    hoverShrink: 0.9,    // 0 = no effect · 0.9 = shrink to a tenth · 1 = vanish
    hoverRadius: 0.27,   // fraction of field width the effect reaches

    // How aggressively tiles go missing toward the edge.
    // 0 = none missing · 1 = edges nearly empty
    thinning: 0.5,

    // Share of tiles drawn in the opponent's colour instead of yours.
    rivalShare: 0.5,
  },

  /* ----------------------------------------------------------
     RIPPLES
     Purely periodic — the soundtrack no longer drives these.
     ---------------------------------------------------------- */
  ripple: {
    rest: 0.35,       // level between ripples
    beatMs: 3000,     // one ripple every N ms
    travelMs: 1000,   // time to reach the edge. LOWER = faster
    frontWidth: 0.2,  // thickness of the wave. HIGHER = broader, softer
    beatAmp: 0.5,     // strength of each ripple
    rings: 10,        // resolution of the wave. More = smoother, slightly costlier
  },

  /* ----------------------------------------------------------
     CENTRE GLOW
     ---------------------------------------------------------- */
  glow: {
    size: "min(170vmax, 1500px)",
    baseScale: 0.55,
    scaleGain: 0.55,
    opacity: 0.5,
  },

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