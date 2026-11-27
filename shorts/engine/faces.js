// Face textures: one canvas per expression, drawn flat in the classic blocky-avatar style.
import * as THREE from 'three';

const S = 256;
const cache = new Map();

function eye(ctx, x, y, w, h, opts = {}) {
  ctx.fillStyle = '#141414';
  ctx.beginPath(); ctx.ellipse(x, y, w, h, 0, 0, Math.PI * 2); ctx.fill();
  if (!opts.noShine) {
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.ellipse(x - w * 0.3, y - h * 0.35, w * 0.32, h * 0.25, 0, 0, Math.PI * 2); ctx.fill();
  }
}
function brow(ctx, x, y, ang, len = 34) {
  ctx.save(); ctx.translate(x, y); ctx.rotate(ang);
  ctx.fillStyle = '#141414'; ctx.fillRect(-len / 2, -5, len, 10); ctx.restore();
}
function arc(ctx, cx, cy, r, a0, a1, lw = 9) {
  ctx.strokeStyle = '#141414'; ctx.lineWidth = lw; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.arc(cx, cy, r, a0, a1); ctx.stroke();
}
function openMouth(ctx, cx, cy, w, h, tongue = true) {
  ctx.fillStyle = '#2a0d0d';
  ctx.beginPath(); ctx.ellipse(cx, cy, w, h, 0, 0, Math.PI * 2); ctx.fill();
  if (tongue) {
    ctx.fillStyle = '#e0556b';
    ctx.beginPath(); ctx.ellipse(cx, cy + h * 0.45, w * 0.6, h * 0.4, 0, 0, Math.PI * 2); ctx.fill();
  }
}
function grinMouth(ctx, cx, cy, w, h) {
  ctx.fillStyle = '#2a0d0d';
  ctx.beginPath(); ctx.moveTo(cx - w, cy); ctx.quadraticCurveTo(cx, cy + h * 2.1, cx + w, cy); ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#fff'; ctx.fillRect(cx - w * 0.75, cy, w * 1.5, h * 0.35);
}
function tear(ctx, x, y) {
  ctx.fillStyle = '#5ec8ff';
  ctx.beginPath(); ctx.moveTo(x, y); ctx.quadraticCurveTo(x + 12, y + 26, x, y + 34); ctx.quadraticCurveTo(x - 12, y + 26, x, y); ctx.fill();
}
function blush(ctx) {
  ctx.fillStyle = 'rgba(255,110,120,0.35)';
  ctx.beginPath(); ctx.ellipse(62, 150, 22, 12, 0, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.ellipse(194, 150, 22, 12, 0, 0, Math.PI * 2); ctx.fill();
}

const DRAW = {
  smile(c) { eye(c, 92, 104, 15, 22); eye(c, 164, 104, 15, 22); arc(c, 128, 140, 44, 0.2 * Math.PI, 0.8 * Math.PI); },
  smallsmile(c) { eye(c, 92, 106, 14, 20); eye(c, 164, 106, 14, 20); arc(c, 128, 150, 28, 0.25 * Math.PI, 0.75 * Math.PI, 8); },
  grin(c) { eye(c, 92, 100, 15, 22); eye(c, 164, 100, 15, 22); grinMouth(c, 128, 154, 46, 26); blush(c); },
  laugh(c) {
    arc(c, 92, 110, 16, 1.15 * Math.PI, 1.85 * Math.PI, 10); arc(c, 164, 110, 16, 1.15 * Math.PI, 1.85 * Math.PI, 10);
    grinMouth(c, 128, 148, 50, 30);
  },
  sad(c) {
    eye(c, 92, 110, 13, 18); eye(c, 164, 110, 13, 18);
    brow(c, 92, 78, 0.35); brow(c, 164, 78, -0.35);
    arc(c, 128, 196, 34, 1.25 * Math.PI, 1.75 * Math.PI, 8);
  },
  cry(c) { DRAW.sad(c); tear(c, 84, 132); tear(c, 172, 132); },
  teary(c) {
    eye(c, 92, 104, 16, 23); eye(c, 164, 104, 16, 23);
    c.fillStyle = 'rgba(120,210,255,0.85)'; c.fillRect(78, 124, 28, 7); c.fillRect(150, 124, 28, 7);
    arc(c, 128, 140, 40, 0.22 * Math.PI, 0.78 * Math.PI); tear(c, 82, 134);
  },
  meh(c) {
    eye(c, 92, 108, 13, 15); eye(c, 164, 108, 13, 15);
    c.fillStyle = '#141414'; c.fillRect(70, 86, 44, 9); c.fillRect(142, 86, 44, 9);
    c.fillRect(104, 160, 48, 9);
  },
  dreamy(c) {
    arc(c, 92, 104, 15, 1.1 * Math.PI, 1.9 * Math.PI, 9); arc(c, 164, 104, 15, 1.1 * Math.PI, 1.9 * Math.PI, 9);
    arc(c, 128, 140, 36, 0.2 * Math.PI, 0.8 * Math.PI); blush(c);
    c.fillStyle = '#7fd0ff'; c.beginPath(); c.ellipse(160, 178, 6, 10, 0, 0, Math.PI * 2); c.fill();
  },
  squint(c) {
    c.fillStyle = '#141414'; c.fillRect(74, 104, 38, 9); c.fillRect(146, 104, 38, 9);
    brow(c, 92, 84, 0.3); brow(c, 164, 84, -0.3);
    c.fillRect(108, 160, 40, 9);
  },
  surprised(c) {
    eye(c, 92, 100, 17, 25); eye(c, 164, 100, 17, 25);
    brow(c, 92, 64, -0.15); brow(c, 164, 64, 0.15);
    openMouth(c, 128, 166, 16, 20, false);
  },
  determined(c) {
    eye(c, 92, 108, 14, 19); eye(c, 164, 108, 14, 19);
    brow(c, 92, 80, 0.32); brow(c, 164, 80, -0.32);
    c.fillStyle = '#141414'; c.fillRect(106, 158, 44, 9);
  },
  talk(c) { eye(c, 92, 104, 15, 22); eye(c, 164, 104, 15, 22); openMouth(c, 128, 156, 24, 17); },
};

export const EXPRESSIONS = Object.keys(DRAW);

export function faceTexture(expr, extras = {}) {
  const key = expr + JSON.stringify(extras);
  if (cache.has(key)) return cache.get(key);
  const cv = document.createElement('canvas'); cv.width = cv.height = S;
  const c = cv.getContext('2d');
  (DRAW[expr] || DRAW.smile)(c);
  if (extras.mustache) {
    c.fillStyle = extras.mustacheColor || '#d6d6d6';
    c.beginPath(); c.ellipse(108, 134, 26, 10, 0.15, 0, Math.PI * 2); c.ellipse(148, 134, 26, 10, -0.15, 0, Math.PI * 2); c.fill();
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  cache.set(key, tex);
  return tex;
}
