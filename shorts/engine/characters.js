// Blocky avatar characters built from rounded boxes, with poses, walk cycle, glow and props.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { faceTexture } from './faces.js';

const geoCache = new Map();
function rbox(w, h, d, r = 0.08) {
  const k = [w, h, d, r].join();
  if (!geoCache.has(k)) geoCache.set(k, new RoundedBoxGeometry(w, h, d, 3, r));
  return geoCache.get(k);
}
const GLOW = new THREE.Color('#ffd98a');
const D2R = Math.PI / 180;

function mat(color, opts = {}) {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.55, metalness: 0.0, ...opts });
}
function mesh(geo, m, x = 0, y = 0, z = 0) {
  const o = new THREE.Mesh(geo, m); o.position.set(x, y, z); o.castShadow = true; o.receiveShadow = true; return o;
}

let haloTex = null;
function getHaloTex() {
  if (haloTex) return haloTex;
  const cv = document.createElement('canvas'); cv.width = cv.height = 128;
  const c = cv.getContext('2d');
  const g = c.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, 'rgba(255,240,190,1)'); g.addColorStop(0.25, 'rgba(255,214,120,0.55)');
  g.addColorStop(0.6, 'rgba(255,190,90,0.15)'); g.addColorStop(1, 'rgba(255,180,80,0)');
  c.fillStyle = g; c.fillRect(0, 0, 128, 128);
  haloTex = new THREE.CanvasTexture(cv); haloTex.colorSpace = THREE.SRGBColorSpace;
  return haloTex;
}

// ---------- props ----------
function labelTex(text, bg, fg, w = 256, h = 128, font = 64) {
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
  const c = cv.getContext('2d'); c.fillStyle = bg; c.fillRect(0, 0, w, h);
  c.fillStyle = fg; c.font = `${font}px "Luckiest Guy", sans-serif`; c.textAlign = 'center'; c.textBaseline = 'middle';
  c.fillText(text, w / 2, h / 2 + 4);
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; return t;
}
export function makeProp(kind) {
  const g = new THREE.Group();
  if (kind === 'pizza') {
    const box = mesh(rbox(2.2, 0.35, 2.2, 0.04), mat('#f5efe3'));
    const lid = new THREE.Mesh(new THREE.PlaneGeometry(1.7, 0.85), new THREE.MeshStandardMaterial({ map: labelTex('PIZZA', '#f5efe3', '#d62828'), roughness: 0.7 }));
    lid.rotation.x = -Math.PI / 2; lid.position.y = 0.18; g.add(box, lid);
  } else if (kind === 'newspaper') {
    const p = mesh(rbox(1.5, 1.9, 0.12, 0.02), mat('#efefe8'));
    const head = new THREE.Mesh(new THREE.PlaneGeometry(1.3, 0.5), new THREE.MeshStandardMaterial({ map: labelTex('NEWS', '#efefe8', '#222'), roughness: 0.8 }));
    head.position.set(0, 0.6, 0.07);
    for (let i = 0; i < 4; i++) g.add(mesh(rbox(1.2, 0.08, 0.02, 0.01), mat('#9a9a9a'), 0, 0.15 - i * 0.28, 0.07));
    g.add(p, head);
  } else if (kind === 'tea') {
    g.add(mesh(new THREE.CylinderGeometry(0.32, 0.26, 0.5, 18), mat('#ffffff', { roughness: 0.3 })));
    const tea = new THREE.Mesh(new THREE.CircleGeometry(0.29, 18), mat('#a0522d')); tea.rotation.x = -Math.PI / 2; tea.position.y = 0.24; g.add(tea);
    const h = mesh(new THREE.TorusGeometry(0.15, 0.05, 8, 14), mat('#ffffff')); h.position.set(0.36, 0, 0); g.add(h);
  } else if (kind === 'photo') {
    g.add(mesh(rbox(1.3, 1.0, 0.1, 0.03), mat('#8b5a2b')));
    const cv = document.createElement('canvas'); cv.width = 128; cv.height = 96;
    const c = cv.getContext('2d'); c.fillStyle = '#e9d8b4'; c.fillRect(0, 0, 128, 96);
    c.fillStyle = '#b48a5a'; c.fillRect(30, 30, 26, 50); c.fillRect(72, 34, 24, 46);
    c.fillStyle = '#d9a27a'; c.fillRect(33, 12, 20, 20); c.fillRect(74, 16, 20, 20);
    const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace;
    const pic = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 0.8), new THREE.MeshStandardMaterial({ map: t, roughness: 0.6 }));
    pic.position.z = 0.06; g.add(pic);
  }
  return g;
}

// ---------- the character ----------
export class Character {
  constructor(id, look) {
    this.id = id; this.look = look;
    this.scale = look.scale || 1;
    this.root = new THREE.Group(); this.root.name = id;
    const L = look;
    this.mats = {
      skin: mat(L.skin || '#f5c9a0'), shirt: mat(L.shirt || '#3b82f6'), pants: mat(L.pants || '#334155'),
      hair: mat(L.hairColor || '#3a2a1a', { roughness: 0.7 }),
    };
    this.allMats = Object.values(this.mats);
    const body = new THREE.Group(); this.body = body; body.scale.setScalar(this.scale); this.root.add(body);

    // legs (pivot at hip, y = 2)
    this.legL = new THREE.Group(); this.legL.position.set(-0.5, 2, 0);
    this.legR = new THREE.Group(); this.legR.position.set(0.5, 2, 0);
    for (const leg of [this.legL, this.legR]) {
      leg.add(mesh(rbox(0.96, 2, 1), this.mats.pants, 0, -1, 0));
      body.add(leg);
    }
    // upper body pivots at the hips so it can hunch
    this.upper = new THREE.Group(); this.upper.position.y = 2; body.add(this.upper);
    this.upper.add(mesh(rbox(2, 2, 1, 0.1), this.mats.shirt, 0, 1, 0));
    if (L.tie) {
      const tie = mesh(rbox(0.3, 1.3, 0.08, 0.03), mat(L.tie), 0, 1.25, 0.52); this.upper.add(tie);
    }
    // arms (pivot at shoulder)
    this.armL = new THREE.Group(); this.armL.position.set(-1.5, 1.85, 0);
    this.armR = new THREE.Group(); this.armR.position.set(1.5, 1.85, 0);
    for (const arm of [this.armL, this.armR]) {
      arm.add(mesh(rbox(0.96, 1.4, 1, 0.08), this.mats.shirt, 0, -0.55, 0));
      arm.add(mesh(rbox(0.92, 0.62, 0.96, 0.08), this.mats.skin, 0, -1.55, 0));
      this.upper.add(arm);
    }
    // head
    this.head = new THREE.Group(); this.head.position.y = 2.72; this.upper.add(this.head);
    this.head.add(mesh(rbox(1.36, 1.36, 1.36, 0.3), this.mats.skin));
    this.faceMat = new THREE.MeshBasicMaterial({ map: faceTexture('smile', this.faceExtras()), transparent: true, depthWrite: false, toneMapped: true });
    this.face = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 1.2), this.faceMat);
    this.face.position.z = 0.69; this.head.add(this.face);
    this.buildHair(L);
    if (L.glasses || L.sunglasses) this.buildGlasses(!!L.sunglasses);

    // glow: emissive + halo sprite + point light
    this.halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: getHaloTex(), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0 }));
    this.halo.position.y = 3.2 * this.scale; this.root.add(this.halo);
    this.light = new THREE.PointLight(0xffc870, 0, 16, 1.6); this.light.position.set(0, 3.4 * this.scale, 1.2); this.root.add(this.light);

    this.propHolder = new THREE.Group(); this.upper.add(this.propHolder);
    this.props = {};
    this.expr = null; this.setExpr('smile');
  }

  faceExtras() { return this.look.mustache ? { mustache: true, mustacheColor: this.look.hairColor } : {}; }

  buildHair(L) {
    const h = this.head, m = this.mats.hair;
    const add = (w, hh, d, x, y, z, r = 0.12, mm = m) => h.add(mesh(rbox(w, hh, d, r), mm, x, y, z));
    switch (L.hair) {
      case 'short': add(1.46, 0.42, 1.46, 0, 0.6, -0.02); add(1.46, 0.6, 0.3, 0, 0.25, -0.6); add(0.28, 0.5, 1.2, -0.62, 0.3, -0.1); add(0.28, 0.5, 1.2, 0.62, 0.3, -0.1); break;
      case 'long': add(1.48, 0.42, 1.48, 0, 0.6, -0.02); add(1.5, 1.7, 0.35, 0, -0.2, -0.6); add(0.3, 1.4, 1.2, -0.66, -0.1, -0.1); add(0.3, 1.4, 1.2, 0.66, -0.1, -0.1); break;
      case 'bun': add(1.46, 0.4, 1.46, 0, 0.6, -0.02); add(1.46, 0.7, 0.3, 0, 0.2, -0.6); add(0.7, 0.7, 0.7, 0, 0.95, -0.35, 0.3); break;
      case 'pigtails': add(1.46, 0.4, 1.46, 0, 0.6, -0.02); add(1.46, 0.6, 0.3, 0, 0.25, -0.6); add(0.5, 0.9, 0.5, -0.9, 0.1, -0.2, 0.2); add(0.5, 0.9, 0.5, 0.9, 0.1, -0.2, 0.2); break;
      case 'bald': add(0.25, 0.6, 1.0, -0.66, 0.1, -0.15); add(0.25, 0.6, 1.0, 0.66, 0.1, -0.15); add(1.4, 0.5, 0.25, 0, 0.05, -0.64); break;
      case 'cap': {
        const cm = mat(L.capColor || '#dc2626');
        add(1.48, 0.45, 1.48, 0, 0.62, 0, 0.14, cm); add(1.3, 0.1, 0.8, 0, 0.42, 0.9, 0.04, cm);
        add(1.46, 0.4, 0.3, 0, 0.25, -0.6); break;
      }
      case 'tophat': {
        const hm = mat('#111827', { roughness: 0.4 });
        h.add(mesh(new THREE.CylinderGeometry(1.0, 1.0, 0.12, 24), hm, 0, 0.72, 0));
        h.add(mesh(new THREE.CylinderGeometry(0.62, 0.62, 1.1, 24), hm, 0, 1.3, 0));
        h.add(mesh(new THREE.CylinderGeometry(0.64, 0.64, 0.18, 24), mat('#b91c1c'), 0, 0.88, 0));
        break;
      }
    }
  }
  buildGlasses(sun) {
    const fm = mat(sun ? '#0b0b0b' : '#2b2b2b', { roughness: 0.3, metalness: sun ? 0.3 : 0 });
    const g = new THREE.Group(); g.position.set(0, 0.08, 0.72);
    if (sun) {
      g.add(mesh(rbox(0.5, 0.32, 0.06, 0.05), fm, -0.3, 0.04, 0)); g.add(mesh(rbox(0.5, 0.32, 0.06, 0.05), fm, 0.3, 0.04, 0));
      g.add(mesh(rbox(1.36, 0.08, 0.05, 0.02), fm, 0, 0.17, 0));
    } else {
      const lens = new THREE.MeshStandardMaterial({ color: '#cfe8ff', transparent: true, opacity: 0.25, roughness: 0.1 });
      for (const x of [-0.3, 0.3]) {
        const f = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.035, 6, 4), fm); f.rotation.z = Math.PI / 4; f.position.x = x; g.add(f);
        const l = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.3), lens); l.position.set(x, 0, -0.01); g.add(l);
      }
      g.add(mesh(rbox(0.22, 0.04, 0.03, 0.01), fm, 0, 0.04, 0));
    }
    this.head.add(g);
  }

  setExpr(e) {
    if (e === this.expr) return;
    this.expr = e; this.faceMat.map = faceTexture(e, this.faceExtras()); this.faceMat.needsUpdate = true;
  }
  setProp(kind) {
    for (const k in this.props) this.props[k].visible = false;
    if (!kind) return;
    if (!this.props[kind]) { this.props[kind] = makeProp(kind); this.propHolder.add(this.props[kind]); }
    this.props[kind].visible = true;
    return this.props[kind];
  }
  setGlow(g, isNight) {
    const e = Math.max(0, g);
    for (const m of this.allMats) { m.emissive.copy(GLOW); m.emissiveIntensity = e * 0.14; }
    this.halo.material.opacity = Math.min(0.55, e * 0.3);
    const s = (4.5 + e * 3) * this.scale; this.halo.scale.set(s, s * 1.15, 1);
    this.light.intensity = e * (isNight ? 16 : 5);
  }

  // Pose the limbs. lt = local time in seconds, moving = walking speed (0..1)
  pose(name, lt, moving, opts = {}) {
    const b = this;
    const rz = (o, v) => (o.rotation.z = v), rx = (o, v) => (o.rotation.x = v);
    [b.armL, b.armR, b.legL, b.legR, b.upper, b.head].forEach(o => o.rotation.set(0, 0, 0));
    b.body.position.set(0, 0, 0);
    const breathe = Math.sin(lt * 2.2 + b.id.length) * 0.02;
    b.upper.position.y = 2 + breathe;
    b.upper.rotation.x = b.look.hunch || 0;
    b.head.rotation.x = -(b.look.hunch || 0) * 0.8;
    // idle arm sway
    rz(b.armL, -0.06 - breathe); rz(b.armR, 0.06 + breathe);
    if (moving > 0.01) {
      const ph = lt * 9.5, sw = 0.7 * moving;
      rx(b.legL, Math.sin(ph) * sw); rx(b.legR, -Math.sin(ph) * sw);
      rx(b.armL, -Math.sin(ph) * sw * 0.9); rx(b.armR, Math.sin(ph) * sw * 0.9);
      b.body.position.y = Math.abs(Math.cos(ph)) * 0.18 * moving;
    }
    b.propHolder.position.set(0, 0, 0); b.propHolder.rotation.set(0, 0, 0);
    switch (name) {
      case 'wave': rz(b.armR, 2.6 + Math.sin(lt * 9) * 0.35); break;
      case 'point': rx(b.armR, -1.5); rz(b.armR, 0.1); b.upper.rotation.y = 0.15; break;
      case 'speech':
        rx(b.armR, -1.6 + Math.sin(lt * 3.1) * 0.35); rz(b.armR, -0.25);
        rx(b.armL, -0.8 + Math.sin(lt * 2.3 + 1) * 0.2); break;
      case 'sit':
        rx(b.legL, -Math.PI / 2); rx(b.legR, -Math.PI / 2);
        b.body.position.y = -(opts.sitDrop ?? 0.5);
        break;
      case 'hold': rx(b.armL, -1.2); rx(b.armR, -1.2); rz(b.armL, 0.12); rz(b.armR, -0.12); break;
      case 'shoulder': rx(b.armR, -0.25); rz(b.armR, 1.25); break;
      case 'think': rx(b.armR, -2.2); rz(b.armR, 0.45); b.head.rotation.z = 0.12; break;
    }
    if (name === 'sit' && opts.prop === 'tea') { rx(b.armR, -0.6); }
    // place prop in front of the hands
    const pk = opts.prop;
    if (pk === 'pizza') { rx(b.armL, -1.25); rx(b.armR, -1.25); rz(b.armL, 0.1); rz(b.armR, -0.1); b.propHolder.position.set(0, 0.2, 1.6); }
    else if (pk === 'newspaper') b.propHolder.position.set(0, 0.25, 1.55);
    else if (pk === 'tea') b.propHolder.position.set(1.5, 0.45, 1.2);
    else if (pk === 'photo') { rx(b.armL, -0.9); rx(b.armR, -0.9); b.propHolder.position.set(0, 0.55, 1.3); b.propHolder.rotation.x = -0.6; b.head.rotation.x += 0.35; }
  }
}
