/**
 * MINO — visual tuning.
 *
 * Every number that controls how things look lives here. Change a value, save,
 * and the dev server reloads. Nothing here affects gameplay or the server.
 */

export const FX = {
  /* ----------------------------------------------------------
     HEXAGON FIELD (the backdrop during a match)
     ---------------------------------------------------------- */
  hex: {
    // Grid density. FEWER columns = BIGGER hexagons in the same space.
    columns: 15,
    rows: 15,

    // Overall size of the clump. Bigger = spreads further toward the edges.
    fieldSize: "min(100vmin, 900px)",

    // --- the glass rim ---
    // Thickness of the border, as a fraction of the hexagon.
    // 0 = no rim at all · 0.16 = default · 0.35 = very thick
    rimWidth: 0.10,
    // How pale the rim is: % of your ink mixed with white.
    // 0 = same colour as the fill · 62 = default · 100 = pure white
    rimTint: 50,
    // Opacity of the pane inside the rim, in %. Lower = more see-through.
    glassOpacity: 2,
    // Strength of the diagonal highlight. 0 = flat, 1 = mirror-bright.
    sheen: 0,

    // --- how much the pulse moves a hexagon ---
    minScale: 0.4,      // size at rest
    pulseScale: 0.5,    // added size at full pulse — RAISE FOR BIGGER PULSING
    pulseOpacity: 0.2,  // added opacity at full pulse
    brightnessBase: 0.4, // brightness at rest
    brightnessGain: 0.8,// added brightness at full pulse

    // --- cursor / finger repulsion ---
    hoverShrink: 0.9,    // 0 = no effect · 0.9 = shrink to a tenth · 1 = vanish
    hoverRadius: 0.27,   // fraction of field width the effect reaches

    // How aggressively hexagons go missing toward the edge.
    // 0 = none missing · 0.92 = default · 1 = edges nearly empty
    thinning: 0.5,

    // Share of hexagons drawn in the opponent's colour instead of yours.
    rivalShare: 0.5,
  },

  /* ----------------------------------------------------------
     RIPPLES
     ---------------------------------------------------------- */
  ripple: {
    beatMs: 3000,     // guaranteed ripple every N ms, music or not
    travelMs: 1000,    // time for a ripple to reach the edge. LOWER = faster
    frontWidth: 0.2, // thickness of the wave. HIGHER = broader, softer
    beatAmp: 0.5,    // strength of the heartbeat ripple
    onsetAmp: 3,    // multiplier for music-triggered ripples
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
     BOARD SLOTS
     Used when Theme -> BLOCKS -> BOARD FRAME is off.
     ---------------------------------------------------------- */
  board: {
    slotBorderWidth: 1,  // px
    slotBorderColor: "color-mix(in srgb, var(--tb-line) 70%, transparent)",
    slotFill: 24,        // % opacity of an empty slot
    pieceOpacity: 90,    // % opacity of a claimed square
  },
};