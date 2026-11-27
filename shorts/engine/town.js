// The town set: road, sidewalks, houses (with switchable window lights), trees, lamps, plaza, porch, sky.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
const M = (color, o = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.75, ...o });
function box(w, h, d, m, x, y, z, r = 0.06, shadow = true) {
  const g = r > 0 ? new RoundedBoxGeometry(w, h, d, 2, r) : new THREE.BoxGeometry(w, h, d);
  const o = new THREE.Mesh(g, m); o.position.set(x, y, z); o.castShadow = shadow; o.receiveShadow = true; return o;
}

function signTex(text, bg, fg) {
  const cv = document.createElement('canvas'); cv.width = 512; cv.height = 128;
  const c = cv.getContext('2d'); c.fillStyle = bg; c.fillRect(0, 0, 512, 128);
  c.font = '92px "Luckiest Guy", sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
  c.lineWidth = 10; c.strokeStyle = '#3a1a00'; c.strokeText(text, 256, 70); c.fillStyle = fg; c.fillText(text, 256, 70);
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; return t;
}

export class Town {
  constructor(scene) {
    this.scene = scene;
    this.windowMats = [];   // { mat, abbott }
    this.lampMats = [];
    this.lampLights = [];
    this.root = new THREE.Group(); scene.add(this.root);
    this.buildGround(); this.buildStreet(); this.buildHouses(); this.buildPlaza(); this.buildSky();
  }
  add(o) { this.root.add(o); return o; }

  buildGround() {
    const grass = new THREE.Mesh(new THREE.PlaneGeometry(600, 600), M('#5cb848', { roughness: 0.95 }));
    grass.rotation.x = -Math.PI / 2; grass.receiveShadow = true; grass.userData.keep = true; this.add(grass);
    // grass tufts for texture
    const r = rng(7), tuft = new THREE.BoxGeometry(0.5, 0.25, 0.5), tm = M('#4ea83c', { roughness: 1 });
    const inst = new THREE.InstancedMesh(tuft, tm, 900); const m4 = new THREE.Matrix4();
    for (let i = 0; i < 900; i++) {
      let x = (r() - 0.5) * 200, z = (r() - 0.5) * 120; if (Math.abs(z) < 7.5) z += Math.sign(z || 1) * 8;
      m4.makeRotationY(r() * 3); m4.setPosition(x, 0.1, z); inst.setMatrixAt(i, m4);
    }
    inst.receiveShadow = true; this.add(inst);
  }

  buildStreet() {
    const road = box(140, 0.1, 8, M('#3d4249', { roughness: 0.9 }), -2, 0.05, 0, 0, false); road.castShadow = false; road.userData.keep = true; this.add(road);
    const dash = M('#f2d04b', { roughness: 0.6 });
    for (let x = -70; x < 66; x += 6) this.add(box(2.6, 0.04, 0.3, dash, x, 0.12, 0, 0, false));
    const walk = M('#cfcac2', { roughness: 0.9 }), curb = M('#a9a39b');
    for (const s of [-1, 1]) {
      this.add(box(140, 0.3, 2.6, walk, -2, 0.15, s * 5.3, 0.04)).userData.keep = true;
      for (let x = -71; x < 68; x += 2.5) this.add(box(0.06, 0.02, 2.6, curb, x, 0.31, s * 5.3, 0, false));
    }
    // lamp posts
    const pole = M('#2f343b', { roughness: 0.4, metalness: 0.4 });
    for (let x = -64; x <= 64; x += 16) for (const s of [-1, 1]) {
      const z = s * 6.9;
      this.add(box(0.3, 7, 0.3, pole, x, 3.5, z, 0.05));
      this.add(box(1.6, 0.25, 0.3, pole, x, 7, z - s * 0.6, 0.05));
      const bulbM = new THREE.MeshStandardMaterial({ color: '#fff6d0', emissive: '#ffd27a', emissiveIntensity: 0 });
      this.lampMats.push(bulbM);
      this.add(box(0.7, 0.4, 0.7, bulbM, x, 6.7, z - s * 1.1, 0.08, false));
    }
    // a few lamp lights for night shots (kept to a fixed count for shader stability)
    for (const x of [8, 40, -24]) for (const s of [-1, 1]) {
      const l = new THREE.PointLight(0xffd8a0, 0, 26, 1.5); l.position.set(x, 6.3, s * 5.8); this.add(l); this.lampLights.push(l);
    }
    // hydrants & mailboxes
    const red = M('#d63b2f', { roughness: 0.4 }), blue = M('#2b6cd6', { roughness: 0.4 });
    for (const [x, z] of [[-30, 6.2], [14, -6.2], [46, 6.2]]) { this.add(box(0.6, 1.1, 0.6, red, x, 0.85, z, 0.15)); this.add(box(0.9, 0.25, 0.25, red, x, 1.0, z, 0.06)); }
    for (const [x, z] of [[-16, -7.6], [30, 7.6], [52, -7.6]]) { this.add(box(0.2, 1.3, 0.2, pole, x, 0.65, z, 0.02)); this.add(box(0.7, 0.6, 1.0, blue, x, 1.55, z, 0.12)); }
  }

  house(x, side, opts = {}) {
    const r = rng(Math.abs(x * 31 + side * 7) + 3);
    const palette = ['#f4a6a6', '#9fd3f5', '#ffe08a', '#b8e6a3', '#d9b8f2', '#ffc38a', '#a8e6df', '#f7f1e3'];
    const wall = M(opts.wall || palette[Math.floor(r() * palette.length)], { roughness: 0.85 });
    const roofC = opts.roof || ['#c0392b', '#34495e', '#7f5539', '#2d6a4f', '#5e548e'][Math.floor(r() * 5)];
    const W = 11, H = 6.5, D = 9, zc = side * 15.5, f = -side; // f = direction the front faces (+z for side -1)
    const g = new THREE.Group(); g.position.set(x, 0, zc); this.add(g);
    g.add(box(W, H, D, wall, 0, H / 2, 0, 0.1));
    g.add(box(W + 0.4, 0.5, D + 0.4, M('#8c8279'), 0, 0.25, 0, 0.05));
    // roof: two slanted slabs
    const rm = M(roofC, { roughness: 0.7 });
    for (const s of [-1, 1]) {
      const slab = box(W + 1.2, 0.5, D / 2 + 1.4, rm, 0, H + 1.6, s * (D / 4 + 0.2), 0.08);
      slab.rotation.x = s * 0.62; g.add(slab);
    }
    const tri = new THREE.Shape(); tri.moveTo(-D / 2, 0); tri.lineTo(D / 2, 0); tri.lineTo(0, 3.1); tri.closePath();
    const gable = new THREE.Mesh(new THREE.ExtrudeGeometry(tri, { depth: W - 0.2, bevelEnabled: false }), wall);
    gable.rotation.y = Math.PI / 2; gable.position.set(-(W - 0.2) / 2, H, 0); gable.castShadow = true; g.add(gable);
    // chimney
    g.add(box(1.2, 3, 1.2, M('#8e4b3a'), W / 3, H + 2.6, D / 6, 0.05));
    // door
    const doorM = M(opts.door || ['#7a4a2a', '#2b4c7e', '#a12d2d', '#2f6b3f'][Math.floor(r() * 4)], { roughness: 0.5 });
    g.add(box(1.9, 3.4, 0.3, doorM, -2.2, 1.95, f * (D / 2 + 0.05), 0.06));
    g.add(box(0.25, 0.25, 0.2, M('#e8c547', { metalness: 0.7, roughness: 0.3 }), -1.6, 2, f * (D / 2 + 0.25), 0.05));
    // windows
    const winM = new THREE.MeshStandardMaterial({ color: '#2a3b55', emissive: '#ffcf7a', emissiveIntensity: 0, roughness: 0.2 });
    this.windowMats.push({ mat: winM, abbott: !!opts.abbott });
    const frame = M('#ffffff');
    for (const [wx, wy] of [[1.4, 2.4], [3.6, 2.4], [1.4, 5.0], [3.6, 5.0], [-2.2, 5.0]]) {
      g.add(box(1.8, 1.7, 0.2, frame, wx, wy, f * (D / 2 + 0.05), 0.04));
      g.add(box(1.4, 1.3, 0.2, winM, wx, wy, f * (D / 2 + 0.12), 0, false));
      g.add(box(0.12, 1.3, 0.1, frame, wx, wy, f * (D / 2 + 0.24), 0, false));
    }
    // walkway + bushes
    g.add(box(2, 0.12, 6.4 - 0.5, M('#bdb6ac'), -2.2, 0.06, f * (D / 2 + 3), 0, false));
    const bush = M('#3f9a3a', { roughness: 0.9 });
    for (const bx of [0.8, 3.4, -4.4]) g.add(box(1.6, 1.1, 1.2, bush, bx, 0.55, f * (D / 2 + 0.9), 0.3));
    if (opts.sign) {
      const s = new THREE.Mesh(new THREE.PlaneGeometry(6, 1.5), new THREE.MeshStandardMaterial({ map: signTex(opts.sign, '#ffe08a', '#d62828'), roughness: 0.6 }));
      s.position.set(1.4, H - 0.4, f * (D / 2 + 0.3)); if (f < 0) s.rotation.y = Math.PI; g.add(s);
    }
    if (opts.porch) this.buildPorch(g, f, D);
    return g;
  }

  buildPorch(g, f, D) {
    const wood = M('#a0754d', { roughness: 0.8 }), dark = M('#6b4a2e');
    const zf = f * (D / 2 + 1.75);
    g.add(box(10, 0.4, 3.5, wood, 0, 0.2, zf, 0.04)); g.children.at(-1).userData.keep = true;
    for (const px of [-4.7, 4.7]) g.add(box(0.35, 6, 0.35, dark, px, 3.2, f * (D / 2 + 3.3), 0.04));
    g.add(box(10.6, 0.35, 4.2, M('#5b3a29'), 0, 6.3, f * (D / 2 + 1.9), 0.05));
    // railing
    for (let px = -4.6; px <= 4.6; px += 0.6) if (Math.abs(px + 2.2) > 1.2) g.add(box(0.12, 1.1, 0.12, M('#f1ead8'), px, 0.95, f * (D / 2 + 3.3), 0.02));
    g.add(box(9.6, 0.15, 0.2, M('#f1ead8'), 0, 1.5, f * (D / 2 + 3.3), 0.02));
    // bench (seat top at y = 1.55, centred on x = 0 → world x 56)
    g.add(box(5.4, 0.25, 1.3, wood, 0, 1.45, f * (D / 2 + 1.0), 0.05)); g.children.at(-1).userData.keep = true;
    g.add(box(5.4, 1.4, 0.2, wood, 0, 2.3, f * (D / 2 + 0.4), 0.05));
    for (const bx of [-2.5, 2.5]) g.add(box(0.25, 1.2, 1.2, dark, bx, 0.9, f * (D / 2 + 1.0), 0.03));
    // little table for tea
    g.add(box(1.2, 1.2, 1.2, dark, 3.6, 1.0, f * (D / 2 + 1.0), 0.06));
    // hanging porch light (stays dark when the power is out)
    const lm = new THREE.MeshStandardMaterial({ color: '#fff2c4', emissive: '#ffcf7a', emissiveIntensity: 0 });
    this.lampMats.push(lm); this.abbottLamp = lm;
    g.add(box(0.5, 0.6, 0.5, lm, 3.6, 5.8, f * (D / 2 + 1.9), 0.1, false));
  }

  buildHouses() {
    const xs = [-56, -40, -24, -8, 8, 24, 40];
    for (const x of xs) for (const s of [-1, 1]) this.house(x, s, x === 24 && s === 1 ? { sign: 'PIZZA', wall: '#ffd29a' } : {});
    this.house(56, 1, {});
    this.abbott = this.house(56, -1, { wall: '#b9b2a3', roof: '#4a4a4a', door: '#5a4632', abbott: true, porch: true });
    // trees between houses
    const trunk = M('#7a5230'), leaf = [M('#3e9e3a', { roughness: 0.9 }), M('#4fb345', { roughness: 0.9 }), M('#2f8a35', { roughness: 0.9 })];
    const r = rng(42);
    for (let x = -64; x <= 64; x += 16) for (const s of [-1, 1]) {
      if (x === 64 && s === -1) continue;
      const z = s * 10.8, tx = x + (r() - 0.5) * 1.5, h = 3 + r() * 1.5;
      this.add(box(0.9, h, 0.9, trunk, tx, h / 2, z, 0.05));
      const L = leaf[Math.floor(r() * 3)];
      this.add(box(3.6, 3, 3.6, L, tx, h + 1.2, z, 0.25)); this.add(box(2.4, 2, 2.4, L, tx + 0.4, h + 3.0, z - 0.3, 0.25));
    }
    // back-row houses for depth
    for (let x = -90; x <= 90; x += 14) for (const s of [-1, 1]) {
      const rr = rng(x * 13 + s);
      const m = M(['#e9b0a0', '#a9cfe8', '#efe0a0', '#c6e2b5'][Math.floor(rr() * 4)]);
      this.add(box(10, 6 + rr() * 3, 8, m, x, 3.5, s * 34, 0.1));
      this.add(box(11, 0.6, 9, M('#6b4f4f'), x, 8.6 + rr(), s * 34, 0.1));
    }
  }

  buildPlaza() {
    const tile = M('#e3d9c6', { roughness: 0.9 });
    this.add(box(28, 0.2, 30, tile, -82, 0.1, 0, 0, false)).userData.keep = true;
    const stage = M('#8b5a3c');
    this.add(box(8, 1.2, 10, stage, -78, 0.6, 0, 0.08)).userData.keep = true;
    this.add(box(8.4, 0.3, 10.4, M('#c0392b'), -78, 1.25, 0, 0.05));
    // bunting backdrop
    this.add(box(0.4, 9, 0.4, M('#444'), -81.5, 4.5, -4.8, 0.05)); this.add(box(0.4, 9, 0.4, M('#444'), -81.5, 4.5, 4.8, 0.05));
    const banner = new THREE.Mesh(new THREE.PlaneGeometry(9.2, 2.2), new THREE.MeshStandardMaterial({ map: signTex('VOTE ME', '#1e3a8a', '#ffe14d'), roughness: 0.7 }));
    banner.position.set(-81.4, 7.6, 0); banner.rotation.y = Math.PI / 2; this.add(banner);
    this.podium = new THREE.Group();
    this.podium.add(box(1.8, 2.6, 1.2, M('#5b3a29'), 0, 1.3, 0, 0.06));
    this.podium.add(box(0.1, 1.2, 0.1, M('#222'), 0, 3.1, 0.3, 0)); this.podium.add(box(0.3, 0.4, 0.3, M('#111'), 0, 3.75, 0.4, 0.1));
    this.podium.visible = false; this.add(this.podium);
  }

  buildSky() {
    this.skyU = { top: { value: new THREE.Color() }, bottom: { value: new THREE.Color() } };
    const sky = new THREE.Mesh(new THREE.SphereGeometry(400, 32, 16), new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, uniforms: this.skyU,
      vertexShader: 'varying vec3 vp; void main(){ vp = normalize(position); gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }',
      fragmentShader: 'uniform vec3 top; uniform vec3 bottom; varying vec3 vp; void main(){ float h = clamp(vp.y*1.6+0.05,0.,1.); gl_FragColor = vec4(mix(bottom, top, pow(h,0.8)),1.);\n#include <colorspace_fragment>\n}',
    }));
    this.scene.add(sky); this.sky = sky;
    // clouds
    this.clouds = new THREE.Group(); const cm = M('#ffffff', { roughness: 1, emissive: '#ffffff', emissiveIntensity: 0.25 });
    const r = rng(9);
    for (let i = 0; i < 14; i++) {
      const c = new THREE.Group(); c.position.set((r() - 0.5) * 300, 45 + r() * 25, -60 - r() * 120);
      for (let j = 0; j < 4; j++) c.add(box(8 + r() * 8, 4 + r() * 3, 6 + r() * 4, cm, j * 6 - 9, r() * 2, r() * 3, 1.5, false));
      this.clouds.add(c);
    }
    for (let i = 0; i < 8; i++) {
      const c = this.clouds.children[i].clone(); c.position.z *= -1; this.clouds.add(c);
    }
    this.scene.add(this.clouds);
    // stars + moon
    const sp = []; const sr = rng(3);
    for (let i = 0; i < 700; i++) { const th = sr() * Math.PI * 2, ph = sr() * 1.3; sp.push(Math.cos(th) * Math.cos(ph) * 380, Math.sin(ph) * 380 + 20, Math.sin(th) * Math.cos(ph) * 380); }
    const sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.Float32BufferAttribute(sp, 3));
    this.stars = new THREE.Points(sg, new THREE.PointsMaterial({ color: '#ffffff', size: 1.6, sizeAttenuation: false, transparent: true, opacity: 0 }));
    this.scene.add(this.stars);
    this.moon = new THREE.Mesh(new THREE.SphereGeometry(10, 24, 16), new THREE.MeshBasicMaterial({ color: '#fff7d6' }));
    this.moon.position.set(120, 140, -260); this.scene.add(this.moon);
  }

  // night: 0..1, powerOn: 0..1 (lamps & windows), t: seconds (cloud drift)
  update({ night, powerOn, abbottDark, t }) {
    for (const { mat, abbott } of this.windowMats) mat.emissiveIntensity = (abbott && abbottDark ? 0 : 1) * night * powerOn * 2.2;
    for (const m of this.lampMats) m.emissiveIntensity = (m === this.abbottLamp && abbottDark ? 0 : 1) * night * powerOn * 4;
    for (const l of this.lampLights) l.intensity = night * powerOn * 90;
    this.stars.material.opacity = night;
    this.moon.visible = night > 0.5;
    this.clouds.position.x = t * 0.8;
    this.clouds.visible = night < 0.6;
  }
}
