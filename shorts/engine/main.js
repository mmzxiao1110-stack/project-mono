// Director: turns a story (beats) + timeline (voice timings) into frames. Every frame is a pure function of t,
// so frames can be rendered in any order, by several browsers at once.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { Character } from './characters.js';
import { Town } from './town.js';
import { drawOverlay } from './overlay.js';

const D2R = Math.PI / 180;
const ease = u => (u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2);
const clamp01 = u => Math.max(0, Math.min(1, u));
const lerp = (a, b, u) => a + (b - a) * u;
const hash = (k) => { const s = Math.sin(k * 12.9898 + 78.233) * 43758.5453; return s - Math.floor(s); };

const TOD = {
  day:   { top: '#3d8bff', bottom: '#cfe8ff', sun: '#fff1d6', sunI: 2.6, sunPos: [40, 60, 30], hemiSky: '#cfe6ff', hemiGround: '#5f8f45', hemiI: 1.25, exp: 1.0, fog: '#cfe8ff', fogD: [90, 330], night: 0, bloom: 0.3 },
  dusk:  { top: '#33407e', bottom: '#ff9a66', sun: '#ffb27a', sunI: 1.9, sunPos: [-70, 22, 25], hemiSky: '#9aa6ff', hemiGround: '#7a5a46', hemiI: 0.85, exp: 1.05, fog: '#e79a7a', fogD: [70, 300], night: 0.35, bloom: 0.4 },
  night: { top: '#0b1638', bottom: '#2c3d78', sun: '#9fb6ff', sunI: 1.15, sunPos: [60, 80, -40], hemiSky: '#5a72c0', hemiGround: '#1d2640', hemiI: 1.3, exp: 1.3, fog: '#16214a', fogD: [60, 260], night: 1, bloom: 0.55 },
};

const params = new URLSearchParams(location.search);
const W = +(params.get('w') || 1080), H = +(params.get('h') || 1920);

const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(1); renderer.setSize(W, H);
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.fog = new THREE.Fog('#cfe8ff', 90, 330);
const camera = new THREE.PerspectiveCamera(42, W / H, 0.1, 900);
const hemi = new THREE.HemisphereLight('#cfe6ff', '#5f8f45', 1.2); scene.add(hemi);
const sun = new THREE.DirectionalLight('#fff1d6', 2.6); sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048); sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.03;
Object.assign(sun.shadow.camera, { left: -30, right: 30, top: 30, bottom: -30, near: 1, far: 260 });
scene.add(sun, sun.target);
const fill = new THREE.PointLight('#b8c8ff', 0, 40, 1.2); scene.add(fill); // soft key light that rides with the camera at night

const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(W / 2, H / 2), 0.5, 0.5, 1.0);
composer.addPass(bloom);
composer.addPass(new OutputPass());

const out = document.createElement('canvas'); out.width = W; out.height = H;
const octx = out.getContext('2d');

let story, timeline, town, cast = {}, crowd = [], thinkSprite;

function resolveBeats() {
  let time = 'day', music = 'playful';
  story.beats.forEach((b, i) => {
    time = b.time || time; music = b.music || music;
    b._time = time; b._music = music; Object.assign(b, { _t: timeline.beats[i] });
  });
}

function groundY(x, z) {
  if (x > 51 && x < 61 && z > -11.2 && z < -7.4) return 0.4;          // Abbott's porch
  if (x > -82 && x < -74 && Math.abs(z) < 5) return 1.4;               // mayor's stage
  if (Math.abs(z) > 4 && Math.abs(z) < 6.6 && x > -72 && x < 68) return 0.3; // sidewalk
  return 0;
}

function makeThinkSprite() {
  const cv = document.createElement('canvas'); cv.width = cv.height = 256;
  const c = cv.getContext('2d');
  c.fillStyle = '#fff'; c.strokeStyle = '#222'; c.lineWidth = 6;
  const blob = (x, y, r) => { c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.fill(); c.stroke(); };
  blob(40, 228, 10); blob(66, 200, 16);
  for (const [x, y, r] of [[100, 120, 52], [150, 90, 56], [190, 130, 46], [140, 150, 50]]) blob(x, y, r);
  c.fillStyle = '#fff'; for (const [x, y, r] of [[100, 120, 49], [150, 90, 53], [190, 130, 43], [140, 150, 47]]) { c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.fill(); }
  // pizza slice
  c.save(); c.translate(146, 118); c.rotate(0.3);
  c.fillStyle = '#e9a23b'; c.beginPath(); c.moveTo(-38, -30); c.lineTo(38, -30); c.lineTo(0, 50); c.closePath(); c.fill();
  c.fillStyle = '#ffd24a'; c.beginPath(); c.moveTo(-32, -22); c.lineTo(32, -22); c.lineTo(0, 42); c.closePath(); c.fill();
  c.fillStyle = '#c0392b'; for (const [x, y] of [[-12, -8], [12, -4], [0, 18]]) { c.beginPath(); c.arc(x, y, 7, 0, Math.PI * 2); c.fill(); }
  c.fillStyle = '#b5651d'; c.fillRect(-40, -38, 80, 12); c.restore();
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, transparent: true, depthTest: false }));
  s.renderOrder = 10; scene.add(s); return s;
}

function makeCrowd(n) {
  const shirts = ['#ef4444', '#f97316', '#22c55e', '#06b6d4', '#8b5cf6', '#eab308', '#14b8a6', '#f43f5e'];
  const hairs = ['short', 'long', 'cap', 'pigtails', 'bun', 'short'];
  const skins = ['#f5c9a0', '#c68642', '#8d5524', '#ffdbac', '#e0ac69'];
  for (let i = 0; i < n; i++) {
    const r = k => hash(i * 7.3 + k);
    const c = new Character('extra' + i, {
      skin: skins[Math.floor(r(1) * skins.length)], shirt: shirts[i % shirts.length], pants: ['#1f2937', '#334155', '#1e3a8a', '#78350f'][i % 4],
      hair: hairs[Math.floor(r(2) * hairs.length)], hairColor: ['#2a1a10', '#7c2d12', '#111', '#f6d365'][Math.floor(r(3) * 4)], capColor: shirts[(i + 3) % 8],
      scale: 0.75 + r(4) * 0.3,
    });
    c.crowd = { lane: i % 2 ? 5.3 : -5.3, dir: i % 2 ? -1 : 1, speed: 1.6 + r(5) * 1.2, off: r(6) * 60, glowy: r(7) };
    c.root.visible = false; scene.add(c.root); crowd.push(c);
  }
}

window.setup = async (storyName) => {
  const ff = new FontFace('Luckiest Guy', 'url(/node_modules/@fontsource/luckiest-guy/files/luckiest-guy-latin-400-normal.woff2)');
  document.fonts.add(await ff.load());
  story = await (await fetch(`/stories/${storyName}.json`)).json();
  timeline = await (await fetch(`/out/${storyName}/timeline.json`)).json();
  resolveBeats();
  town = new Town(scene);
  for (const [id, look] of Object.entries(story.cast)) { const c = new Character(id, look); c.root.visible = false; scene.add(c.root); cast[id] = c; }
  makeCrowd(8);
  thinkSprite = makeThinkSprite();
  // warm-up compile so the first frame is not slow
  renderAt(0.01);
  return { duration: timeline.duration, beats: timeline.beats.length };
};

function beatAt(t) {
  let i = 0;
  while (i < story.beats.length - 1 && t >= story.beats[i + 1]._t.start) i++;
  return story.beats[i];
}

function glowValue(a, u, lt, id) {
  let g = a.glow ?? 0;
  if (a.glowFrom !== undefined) g = lerp(a.glowFrom, g, ease(clamp01((u - 0.15) / 0.6)));
  if (a.flicker) {
    const k = Math.floor(lt * 11), h = hash(k + id.length * 17);
    g *= h > 0.42 ? 0.6 + 0.6 * h : 0.05;
  } else if (g > 0) g *= 1 + Math.sin(lt * 3 + id.length) * 0.05;
  return g;
}

function applyActor(c, a, b, lt, u, night) {
  c.root.visible = true;
  const [x0, z0] = a.at, [x1, z1] = a.to || a.at;
  const mu = a.to ? ease(clamp01(u / 0.92)) : 0;
  const x = lerp(x0, x1, mu), z = lerp(z0, z1, mu);
  const moving = a.to ? Math.min(1, Math.sin(Math.PI * clamp01(u / 0.92)) * 2.2) : 0;
  c.root.position.set(x, a.pose === 'sit' ? 0 : groundY(x, z), z);
  let face = a.face ?? 0;
  if (face === 'move') face = Math.atan2(x1 - x0, z1 - z0) / D2R;
  else if (typeof face === 'string' && cast[face]) { const p = cast[face].root.position; face = Math.atan2(p.x - x, p.z - z) / D2R; }
  c.root.rotation.y = (typeof face === 'number' ? face : 0) * D2R;
  const pose = a.pose || (a.think ? 'think' : 'idle');
  const seatTop = a.seat ?? 1.575;
  c.pose(pose, lt, moving, { prop: a.prop, sitDrop: 1.5 * c.scale - seatTop });
  c.setProp(a.prop);
  let expr = a.expr || 'smile';
  if (a.talk) {
    const w = b._t.words.find(w => lt >= w.s && lt < w.e);
    if (w && (lt - w.s) / (w.e - w.s) < 0.65) expr = 'talk';
  }
  c.setExpr(expr);
  c.setGlow(glowValue(a, u, lt, c.id), night > 0.5);
  if (a.podium) {
    const f = c.root.rotation.y; town.podium.visible = true;
    town.podium.position.set(x + Math.sin(f) * 1.7, groundY(x, z), z + Math.cos(f) * 1.7); town.podium.rotation.y = f;
  }
  if (a.think) {
    const pop = clamp01((u - 0.12) / 0.12); const s = 3.6 * (pop < 1 ? pop * (1.25 - 0.25 * pop) : 1);
    c.root.updateMatrixWorld(true); const hp = new THREE.Vector3(); c.head.getWorldPosition(hp);
    thinkSprite.visible = pop > 0; thinkSprite.scale.set(s, s, 1);
    const side = new THREE.Vector3(Math.cos(c.root.rotation.y), 0, -Math.sin(c.root.rotation.y));
    thinkSprite.position.copy(hp).addScaledVector(side, -1.9).add(new THREE.Vector3(0, 2.2, 0));
  }
}

function headPos(c) { c.root.updateMatrixWorld(true); const v = new THREE.Vector3(); c.head.getWorldPosition(v); return v; }

const ray = new THREE.Raycaster(); let hidden = [];
// Anything between the camera and the subject gets hidden for this frame (film-set "wild walls").
function clearOccluders(look, keep) {
  for (const o of hidden) o.visible = true; hidden = [];
  const targets = [look, look.clone().add(new THREE.Vector3(0, 1.6, 0)), look.clone().add(new THREE.Vector3(0, -1.2, 0))];
  for (const id of keep) if (cast[id] && cast[id].root.visible) targets.push(headPos(cast[id]));
  for (const p of targets) {
    const dir = camera.position.clone().sub(p); const dist = dir.length(); dir.normalize();
    ray.set(p, dir); ray.far = dist - 0.2; ray.camera = camera;
    for (const h of ray.intersectObject(town.root, true)) {
      const o = h.object; if (o.userData.keep || !o.visible || o.isInstancedMesh) continue;
      o.visible = false; hidden.push(o);
    }
    for (const c of Object.values(cast)) {
      if (!c.root.visible || keep.includes(c.id)) continue;
      if (ray.intersectObject(c.root, true).length) { c.root.visible = false; hidden.push(c.root); }
    }
  }
}

function placeCamera(b, lt, u, t) {
  const cam = b.cam || {};
  const e = ease(u);
  let pos, look;
  if (cam.pos) {
    pos = new THREE.Vector3(...cam.pos); look = new THREE.Vector3(...cam.look);
    if (cam.move === 'track' && cam.on && cast[cam.on]) {
      const a = b.actors[cam.on], p = cast[cam.on].root.position;
      pos.x += p.x - a.at[0]; look.set(p.x, p.y + 2.4, p.z);
    }
    const off = pos.clone().sub(look);
    if (cam.move === 'push') off.multiplyScalar(lerp(1.08, 0.86, e));
    if (cam.move === 'pullback') { off.multiplyScalar(lerp(0.75, 2.6, e)); off.y += e * 4; }
    if (cam.move === 'orbit') off.applyAxisAngle(new THREE.Vector3(0, 1, 0), lerp(-12, 12, u) * D2R);
    pos = look.clone().add(off);
  } else {
    const c = cast[cam.on]; const hp = headPos(c);
    const fy = c.root.rotation.y + (cam.angle || 0) * D2R;
    const dir = new THREE.Vector3(Math.sin(fy), 0, Math.cos(fy));
    let d, cy, ly;
    switch (cam.shot) {
      case 'close': d = 6.4; cy = hp.y + 0.1; ly = hp.y - 1.15; break;
      case 'medium': d = 10.5; cy = hp.y - 0.4; ly = hp.y - 1.9; break;
      case 'wide': d = 20; cy = hp.y + 4; ly = hp.y - 2; break;
      case 'low': d = 9; cy = c.root.position.y + 1.0; ly = hp.y + 0.2; break;
      case 'ots': {
        const tgt = headPos(cast[cam.look]);
        const back = hp.clone().sub(tgt).setY(0).normalize();
        const right = new THREE.Vector3(-back.z, 0, back.x);
        pos = hp.clone().addScaledVector(back, 4.6).addScaledVector(right, 2.9).add(new THREE.Vector3(0, 0.7, 0));
        look = tgt.clone().add(new THREE.Vector3(0, -0.5, 0));
        const off = pos.clone().sub(look).multiplyScalar(cam.move === 'push' ? lerp(1.05, 0.9, e) : 1);
        pos = look.clone().add(off);
        break;
      }
      default: d = 10; cy = hp.y; ly = hp.y - 1;
    }
    if (!pos) {
      let ang = 0;
      if (cam.move === 'push') d *= lerp(1.12, 0.88, e);
      if (cam.move === 'pullback') d *= lerp(0.8, 2.2, e);
      if (cam.move === 'orbit') ang = lerp(-12, 12, u) * D2R;
      if (cam.move === 'static') d *= 1 - 0.03 * u;
      dir.applyAxisAngle(new THREE.Vector3(0, 1, 0), ang);
      pos = new THREE.Vector3(hp.x, cy, hp.z).addScaledVector(dir, d);
      look = new THREE.Vector3(hp.x, ly, hp.z);
    }
  }
  // gentle handheld drift
  pos.x += Math.sin(t * 0.9) * 0.05; pos.y += Math.sin(t * 1.3 + 1) * 0.04;
  camera.position.copy(pos); camera.lookAt(look);
  return look;
}

function applyTime(b, lt) {
  const P = TOD[b._time];
  town.skyU.top.value.set(P.top); town.skyU.bottom.value.set(P.bottom);
  scene.fog.color.set(P.fog); scene.fog.near = P.fogD[0]; scene.fog.far = P.fogD[1];
  hemi.color.set(P.hemiSky); hemi.groundColor.set(P.hemiGround); hemi.intensity = P.hemiI;
  sun.color.set(P.sun); sun.intensity = P.sunI; renderer.toneMappingExposure = P.exp;
  bloom.strength = P.bloom;
  let power = 1;
  if (b.lightsOut !== undefined) {
    const cut = b.lightsOut * b._t.dur;
    if (lt >= cut) power = 0;
    else if (lt > cut - 0.35) power = hash(Math.floor(lt * 30)) > 0.5 ? 1 : 0.2; // flicker before the blackout
    if (power === 0) { hemi.intensity *= 0.7; sun.intensity *= 0.6; }
  }
  town.update({ night: P.night, powerOn: power, abbottDark: !!b.abbottDark, t: lt + b._t.start });
  return P;
}

window.renderAt = (t) => {
  const b = beatAt(t), bt = b._t;
  const lt = Math.max(0, t - bt.start), u = clamp01(lt / bt.dur);
  const P = applyTime(b, lt);
  for (const c of Object.values(cast)) { c.root.visible = false; c.setGlow(0, false); }
  for (const c of crowd) { c.root.visible = false; c.setGlow(0, false); }
  town.podium.visible = false; thinkSprite.visible = false;
  for (const [id, a] of Object.entries(b.actors || {})) applyActor(cast[id], a, b, lt, u, P.night);
  if (b.crowd) {
    const n = Math.min(crowd.length, b.crowd.count);
    for (let i = 0; i < n; i++) {
      const c = crowd[i], k = c.crowd;
      const x = ((k.off + k.dir * k.speed * t) % 60 + 60) % 60 - 30;
      c.root.visible = true; c.root.position.set(x, 0.3, k.lane + (i % 3) * 0.3);
      c.root.rotation.y = (k.dir > 0 ? 90 : -90) * D2R;
      c.pose('idle', t + i, 1); c.setExpr(i % 3 ? 'smile' : 'grin');
      c.setGlow(k.glowy > 0.35 ? b.crowd.glow * (0.6 + k.glowy) : 0, P.night > 0.5);
    }
  }
  const look = placeCamera(b, lt, u, t);
  clearOccluders(look, b.cam ? [b.cam.on, b.cam.look].filter(k => typeof k === 'string') : []);
  fill.position.copy(camera.position); fill.intensity = P.night * 45;
  // keep the shadow camera on what we are looking at
  sun.position.set(look.x + P.sunPos[0], P.sunPos[1], look.z + P.sunPos[2]); sun.target.position.copy(look);
  composer.render();
  octx.drawImage(renderer.domElement, 0, 0);
  drawOverlay(octx, W, H, { beat: b, lt, u, t, night: P.night, first: b === story.beats[0], last: b === story.beats[story.beats.length - 1] });
};

window.frameAt = (t, q = 0.9) => { window.renderAt(t); return out.toDataURL('image/jpeg', q); };
window.showOutput = () => { document.body.innerHTML = ''; document.body.appendChild(out); };
