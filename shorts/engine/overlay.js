// 2D layer on top of the 3D frame: word-by-word captions, pop-up stamps, vignette, fades.
const FONT = '"Luckiest Guy", "Arial Black", sans-serif';
const clamp01 = u => Math.max(0, Math.min(1, u));
const popScale = (p) => (p >= 1 ? 1 : p < 0 ? 0 : 0.6 + 0.4 * p + Math.sin(p * Math.PI) * 0.28);

function chunks(words) {
  const out = []; let cur = [];
  for (const w of words) {
    cur.push(w);
    const len = cur.reduce((n, x) => n + x.w.length, 0);
    if (cur.length >= 3 || /[,.!?;:]$/.test(w.w) || len > 14) { out.push(cur); cur = []; }
  }
  if (cur.length) out.push(cur);
  return out;
}

function captions(ctx, W, H, beat, lt) {
  const words = beat._t.words; if (!words.length) return;
  const groups = chunks(words);
  let g = groups.find(gr => lt < gr[gr.length - 1].e + 0.02) || groups[groups.length - 1];
  if (lt < words[0].s) g = groups[0];
  const start = g[0].s, pop = popScale(clamp01((lt - start) / 0.14));
  const fs = Math.round(W * 0.105);
  ctx.save();
  ctx.font = `${fs}px ${FONT}`; ctx.textBaseline = 'middle'; ctx.lineJoin = 'round';
  const texts = g.map(w => w.w.toUpperCase().replace(/[.,;:]$/, ''));
  const space = fs * 0.28;
  const widths = texts.map(s => ctx.measureText(s).width);
  // wrap into lines that fit 88% of the width
  const lines = [[]]; let lw = 0;
  texts.forEach((s, i) => {
    if (lw + widths[i] > W * 0.86 && lines[lines.length - 1].length) { lines.push([]); lw = 0; }
    lines[lines.length - 1].push(i); lw += widths[i] + space;
  });
  const cy = H * 0.66, lh = fs * 1.08;
  ctx.translate(W / 2, cy); ctx.scale(pop, pop); ctx.rotate(-0.015);
  lines.forEach((ln, li) => {
    const total = ln.reduce((n, i) => n + widths[i], 0) + space * (ln.length - 1);
    let x = -total / 2; const y = (li - (lines.length - 1) / 2) * lh;
    for (const i of ln) {
      const w = g[i], active = lt >= w.s && lt < w.e + 0.05;
      const sc = active ? 1.12 : 1;
      ctx.save(); ctx.translate(x + widths[i] / 2, y); ctx.scale(sc, sc);
      ctx.lineWidth = fs * 0.2; ctx.strokeStyle = '#000'; ctx.strokeText(texts[i], -widths[i] / 2, fs * 0.06);
      ctx.fillStyle = active ? '#ffe14d' : '#ffffff';
      ctx.shadowColor = 'rgba(0,0,0,0.5)'; ctx.shadowOffsetY = fs * 0.08;
      ctx.fillText(texts[i], -widths[i] / 2, fs * 0.06);
      ctx.restore();
      x += widths[i] + space;
    }
  });
  ctx.restore();
}

function stamp(ctx, W, H, beat, lt) {
  const o = beat.overlay; if (!o) return;
  const t0 = (o.at || 0) * beat._t.dur; if (lt < t0) return;
  const p = clamp01((lt - t0) / 0.18), s = popScale(p);
  const fs = Math.round(W * (o.size || 0.13));
  ctx.save();
  ctx.translate(W / 2, H * 0.13); ctx.rotate(-0.07); ctx.scale(s, s);
  const shake = p < 1 ? 0 : Math.sin(lt * 40) * 1.5;
  ctx.translate(shake, 0);
  ctx.font = `${fs}px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  const tw = ctx.measureText(o.text).width, pw = tw + fs * 0.9, ph = fs * 1.45;
  ctx.fillStyle = o.bg || '#e11d48';
  ctx.strokeStyle = '#000'; ctx.lineWidth = fs * 0.12;
  roundRect(ctx, -pw / 2, -ph / 2, pw, ph, fs * 0.3); ctx.fill(); ctx.stroke();
  ctx.lineWidth = fs * 0.16; ctx.lineJoin = 'round'; ctx.strokeText(o.text, 0, fs * 0.07);
  ctx.fillStyle = o.color || '#fff'; ctx.fillText(o.text, 0, fs * 0.07);
  ctx.restore();
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}

export function drawOverlay(ctx, W, H, { beat, lt, u, night, first, last }) {
  // vignette
  const g = ctx.createRadialGradient(W / 2, H * 0.48, H * 0.28, W / 2, H * 0.5, H * 0.72);
  g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, `rgba(0,0,0,${0.35 + night * 0.2})`);
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  // a quick white flash on cuts flagged with a whoosh
  if (beat.sfx && beat.sfx.some(s => s.name === 'whoosh' && (s.at || 0) === 0) && lt < 0.12) {
    ctx.fillStyle = `rgba(255,255,255,${0.55 * (1 - lt / 0.12)})`; ctx.fillRect(0, 0, W, H);
  }
  stamp(ctx, W, H, beat, lt);
  captions(ctx, W, H, beat, lt);
  if (first && lt < 0.25) { ctx.fillStyle = `rgba(0,0,0,${1 - lt / 0.25})`; ctx.fillRect(0, 0, W, H); }
  if (last && u > 0.82) { ctx.fillStyle = `rgba(0,0,0,${clamp01((u - 0.82) / 0.18)})`; ctx.fillRect(0, 0, W, H); }
}
