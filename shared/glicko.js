/**
 * Glicko-2 and the rank ladder. Pure.
 *
 * The client imports this to DISPLAY ratings.
 * The server imports it to DECIDE them. Only the server's answer counts.
 */

export const GLICKO = {
  TAU: 0.5,
  SCALE: 173.7178,
  BASE: 1500,
  START_RD: 350,
  START_VOL: 0.06,
};

export const PLACEMENT_GAMES = 10;
export const RANK_FLOOR = 1100;

export const RANKS = [
  { name: "F", color: "#5A6572" },
  { name: "C-", color: "#8A6A44" },
  { name: "C", color: "#A8834E" },
  { name: "C+", color: "#C49C5C" },
  { name: "B-", color: "#4E8C6A" },
  { name: "B", color: "#5CAF83" },
  { name: "B+", color: "#72CB9B" },
  { name: "A-", color: "#B85450" },
  { name: "A", color: "#D4635F" },
  { name: "A+", color: "#EC7A72" },
  { name: "S", color: "#E8B923" },
  { name: "X", color: "#7DD3FC" },
];

export const rankMin = (i) => (i === 0 ? -Infinity : RANK_FLOOR + (i - 1) * 100);

export function rankIndexFor(tr) {
  for (let i = RANKS.length - 1; i >= 0; i--) if (tr >= rankMin(i)) return i;
  return 0;
}

export function rankProgress(tr) {
  const i = rankIndexFor(tr);
  if (i === 0 || i === RANKS.length - 1) return 1;
  return Math.max(0, Math.min(1, (tr - rankMin(i)) / 100));
}

export const newRating = () => ({ r: GLICKO.BASE, rd: GLICKO.START_RD, vol: GLICKO.START_VOL });

/**
 * One Glicko-2 rating period.
 * @param player  { r, rd, vol }
 * @param results [{ r, rd, s }]  s = 1 win / 0.5 draw / 0 loss
 */
export function glickoUpdate(player, results) {
  const { TAU, SCALE, BASE } = GLICKO;
  const phi = player.rd / SCALE;

  // No games this period: uncertainty widens, rating holds.
  if (!results.length) {
    const phiStar = Math.sqrt(phi * phi + player.vol * player.vol);
    return { r: player.r, rd: Math.min(GLICKO.START_RD, phiStar * SCALE), vol: player.vol };
  }

  const mu = (player.r - BASE) / SCALE;
  const g = (p) => 1 / Math.sqrt(1 + (3 * p * p) / (Math.PI * Math.PI));
  const expect = (m, mj, pj) => 1 / (1 + Math.exp(-g(pj) * (m - mj)));

  let vInv = 0;
  let deltaSum = 0;
  for (const o of results) {
    const muj = (o.r - BASE) / SCALE;
    const phij = o.rd / SCALE;
    const gj = g(phij);
    const ej = expect(mu, muj, phij);
    vInv += gj * gj * ej * (1 - ej);
    deltaSum += gj * (o.s - ej);
  }
  const v = 1 / vInv;
  const delta = v * deltaSum;

  // Volatility via the Illinois variant of regula falsi (Glickman's appendix).
  const a = Math.log(player.vol * player.vol);
  const f = (x) => {
    const ex = Math.exp(x);
    const num = ex * (delta * delta - phi * phi - v - ex);
    const den = 2 * Math.pow(phi * phi + v + ex, 2);
    return num / den - (x - a) / (TAU * TAU);
  };

  let A = a;
  let B;
  if (delta * delta > phi * phi + v) {
    B = Math.log(delta * delta - phi * phi - v);
  } else {
    let k = 1;
    while (f(a - k * TAU) < 0 && k < 100) k++;
    B = a - k * TAU;
  }
  let fA = f(A);
  let fB = f(B);
  let guard = 0;
  while (Math.abs(B - A) > 1e-6 && guard++ < 100) {
    const C = A + ((A - B) * fA) / (fB - fA);
    const fC = f(C);
    if (fC * fB <= 0) { A = B; fA = fB; } else { fA = fA / 2; }
    B = C;
    fB = fC;
  }

  const newVol = Math.exp(A / 2);
  const phiStar = Math.sqrt(phi * phi + newVol * newVol);
  const newPhi = 1 / Math.sqrt(1 / (phiStar * phiStar) + 1 / v);
  const newMu = mu + newPhi * newPhi * deltaSum;

  return { r: newMu * SCALE + BASE, rd: newPhi * SCALE, vol: newVol };
}
