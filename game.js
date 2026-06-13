// MEGABONK — three.js clone
// Single-module game engine. 3D survivor-like: move, auto-attack, collect XP, level up, survive.
import * as THREE from 'three';

// ============================================================================
// CONFIG / BALANCE
// ============================================================================
const CFG = {
  arenaRadius: 200,           // visual ground radius (big open field → horizon)
  playRadius: 120,            // how far the player can roam before the soft wall
  camHeight: 22,
  camDist: 18,
  camLerp: 10,
  playerRadius: 0.9,
  playerBaseSpeed: 9.5,
  playerBaseHP: 120,
  basePickupRadius: 8,
  dashSpeed: 38,
  dashTime: 0.16,
  dashCooldown: 1.4,
  spawnStartInterval: 1.4,    // seconds between spawn pulses
  spawnMinInterval: 0.22,
  maxEnemies: 220,
  enemyDespawnDist: 90,
  bossInterval: 60,           // boss every 60s
  runDuration: 600,           // 10-minute run (research-confirmed)
  contactIFrame: 0.65,
  worldUp: new THREE.Vector3(0, 1, 0),
};

// ============================================================================
// SMALL UTILS
// ============================================================================
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const rand = (a, b) => a + Math.random() * (b - a);
const randInt = (a, b) => Math.floor(rand(a, b + 1));
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const TAU = Math.PI * 2;
const fmtTime = (s) => {
  s = Math.max(0, Math.floor(s));
  const m = Math.floor(s / 60);
  const ss = s % 60;
  return `${String(m).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
};

// reusable temp vectors (avoid per-frame allocation)
const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();

// ============================================================================
// DOM REFS
// ============================================================================
const $ = (id) => document.getElementById(id);
const dom = {
  game: $('game'), hud: $('hud'),
  xpFill: $('xpbar').querySelector('.fill'), lvl: $('lvl'),
  hpFill: $('hpbar').querySelector('.fill'), hpLabel: $('hpbar').querySelector('.label'),
  timer: $('timer'), kills: $('stats').querySelector('.kills'), gold: $('stats').querySelector('.gold'),
  bossbar: $('bossbar'), bossFill: $('bossbar').querySelector('.fill'), bossLabel: $('bossbar').querySelector('.label'),
  tray: $('tray'), dashFill: $('dash').querySelector('.fill'),
  fx: $('fx'), flash: $('flash'), toast: $('toast'),
  menu: $('menu'), chars: $('chars'), play: $('play'),
  levelup: $('levelup'), cards: $('cards'),
  pause: $('pause'), resume: $('resume'), quit: $('quit'),
  gameover: $('gameover'), goStats: $('goStats'), goTitle: $('goTitle'), goQuip: $('goQuip'), again: $('again'),
};

// ============================================================================
// AUDIO — tiny WebAudio synth for juice (no assets)
// ============================================================================
const Audio = (() => {
  let ctx = null;
  const ensure = () => { if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)(); return ctx; };
  function blip(freq, dur, type = 'square', vol = 0.08, slideTo = null) {
    try {
      const c = ensure();
      const o = c.createOscillator(), g = c.createGain();
      o.type = type; o.frequency.setValueAtTime(freq, c.currentTime);
      if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, c.currentTime + dur);
      g.gain.setValueAtTime(vol, c.currentTime);
      g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + dur);
      o.connect(g); g.connect(c.destination);
      o.start(); o.stop(c.currentTime + dur);
    } catch (e) {}
  }
  return {
    resume: () => { try { ensure().resume(); } catch (e) {} },
    shoot: () => blip(620, 0.07, 'square', 0.03, 320),
    hit: () => blip(180, 0.05, 'sawtooth', 0.025),
    enemyDie: () => blip(140, 0.12, 'triangle', 0.05, 60),
    pickup: () => blip(880, 0.06, 'sine', 0.04, 1200),
    levelup: () => { blip(523, 0.1, 'square', 0.06); setTimeout(() => blip(784, 0.16, 'square', 0.06), 90); },
    hurt: () => blip(120, 0.18, 'sawtooth', 0.09, 50),
    nova: () => blip(300, 0.25, 'sine', 0.06, 90),
    boss: () => { blip(90, 0.5, 'sawtooth', 0.12, 60); },
    gold: () => blip(1000, 0.05, 'sine', 0.03, 1500),
  };
})();

// ============================================================================
// THREE.JS WORLD
// ============================================================================
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
dom.game.appendChild(renderer.domElement);

const scene = new THREE.Scene();
// vertical gradient sky (canvas texture) — gives the world a real horizon
function makeSky(top, bottom) {
  const c = document.createElement('canvas'); c.width = 4; c.height = 256;
  const g = c.getContext('2d').createLinearGradient(0, 0, 0, 256);
  g.addColorStop(0, top); g.addColorStop(1, bottom);
  const ctx = c.getContext('2d'); ctx.fillStyle = g; ctx.fillRect(0, 0, 4, 256);
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; return tex;
}
scene.background = makeSky('#3aa0ff', '#bfe3ff');
scene.fog = new THREE.Fog(0xbfe3ff, 90, 230);

const camera = new THREE.PerspectiveCamera(80, window.innerWidth / window.innerHeight, 0.1, 400);

// lights
const hemi = new THREE.HemisphereLight(0xdcefff, 0x5a7a3a, 1.15);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xfff4dd, 1.7);
sun.position.set(20, 40, 12);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.near = 1; sun.shadow.camera.far = 160;
const sc = 70;
sun.shadow.camera.left = -sc; sun.shadow.camera.right = sc;
sun.shadow.camera.top = sc; sun.shadow.camera.bottom = -sc;
sun.shadow.bias = -0.0005;
scene.add(sun);
scene.add(sun.target);

// ground — big grassy disc reaching to the horizon
const groundGeo = new THREE.CircleGeometry(CFG.arenaRadius, 80);
groundGeo.rotateX(-Math.PI / 2);
const groundMat = new THREE.MeshStandardMaterial({ color: 0x5aa64b, roughness: 1, metalness: 0 });
const ground = new THREE.Mesh(groundGeo, groundMat);
ground.receiveShadow = true;
scene.add(ground);

// subtle grid in the central play area for a sense of speed/scale
const grid = new THREE.GridHelper(CFG.playRadius * 2, 60, 0x3f7a37, 0x4f8c45);
grid.material.transparent = true; grid.material.opacity = 0.35;
grid.position.y = 0.02;
scene.add(grid);

// horizon ring of low-poly mountains — sells the 3D depth
function buildMountains() {
  const g = new THREE.Group();
  const mat1 = new THREE.MeshStandardMaterial({ color: 0x3c6b4a, roughness: 1, flatShading: true });
  const mat2 = new THREE.MeshStandardMaterial({ color: 0x6f7f8a, roughness: 1, flatShading: true });
  const count = 70;
  for (let i = 0; i < count; i++) {
    const a = (i / count) * TAU + rand(-0.03, 0.03);
    const r = rand(CFG.arenaRadius * 0.74, CFG.arenaRadius * 0.92);
    const h = rand(16, 46);
    const rad = rand(14, 30);
    const m = new THREE.Mesh(new THREE.ConeGeometry(rad, h, rand(4, 7) | 0, 1), Math.random() < 0.4 ? mat2 : mat1);
    m.position.set(Math.cos(a) * r, h / 2 - 1, Math.sin(a) * r);
    m.rotation.y = rand(0, TAU);
    g.add(m);
  }
  scene.add(g);
}
buildMountains();

// scatter some low-poly trees/rocks for depth
function scatterDecor() {
  const tree = (x, z) => {
    const g = new THREE.Group();
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.35, 1.4, 6),
      new THREE.MeshStandardMaterial({ color: 0x6b4a2b, roughness: 1 }));
    trunk.position.y = 0.7; trunk.castShadow = true;
    const leaves = new THREE.Mesh(new THREE.IcosahedronGeometry(1.4, 0),
      new THREE.MeshStandardMaterial({ color: 0x2f7d3a, roughness: 1, flatShading: true }));
    leaves.position.y = 2.1; leaves.castShadow = true;
    g.add(trunk, leaves); g.position.set(x, 0, z);
    g.scale.setScalar(rand(1.4, 2.8));
    return g;
  };
  const rock = (x, z) => {
    const m = new THREE.Mesh(new THREE.DodecahedronGeometry(rand(1.0, 2.2), 0),
      new THREE.MeshStandardMaterial({ color: 0x7d8694, roughness: 1, flatShading: true }));
    m.position.set(x, rand(0.1, 0.4), z); m.rotation.set(rand(0, 3), rand(0, 3), rand(0, 3));
    m.castShadow = true; return m;
  };
  for (let i = 0; i < 120; i++) {
    const a = rand(0, TAU), r = rand(8, CFG.playRadius + 20);
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    scene.add(Math.random() < 0.62 ? tree(x, z) : rock(x, z));
  }
}
scatterDecor();

// ============================================================================
// SHARED GEOMETRY / MATERIAL FACTORIES
// ============================================================================
const GEO = {
  sphere: new THREE.SphereGeometry(1, 16, 12),
  lowSphere: new THREE.IcosahedronGeometry(1, 0),
  box: new THREE.BoxGeometry(1, 1, 1),
  cone: new THREE.ConeGeometry(1, 1, 6),
  octa: new THREE.OctahedronGeometry(1, 0),
  eyeWhite: new THREE.SphereGeometry(0.18, 10, 8),
  pupil: new THREE.SphereGeometry(0.09, 8, 6),
  bolt: new THREE.SphereGeometry(0.32, 10, 8),
  gem: new THREE.OctahedronGeometry(0.34, 0),
  coin: new THREE.CylinderGeometry(0.28, 0.28, 0.08, 12),
};
const EYE_WHITE_MAT = new THREE.MeshBasicMaterial({ color: 0xffffff });
const PUPIL_MAT = new THREE.MeshBasicMaterial({ color: 0x111111 });

// attach two googly eyes to a group facing +Z
function addEyes(group, y, spread, fwd, scale = 1) {
  for (const sx of [-1, 1]) {
    const w = new THREE.Mesh(GEO.eyeWhite, EYE_WHITE_MAT);
    w.scale.setScalar(scale);
    w.position.set(sx * spread, y, fwd);
    const p = new THREE.Mesh(GEO.pupil, PUPIL_MAT);
    p.scale.setScalar(scale);
    p.position.set(sx * spread, y, fwd + 0.12 * scale);
    group.add(w, p);
  }
}

// ============================================================================
// INPUT
// ============================================================================
const keys = {};
const KEYMAP = {
  KeyW: 'up', ArrowUp: 'up', KeyS: 'down', ArrowDown: 'down',
  KeyA: 'left', ArrowLeft: 'left', KeyD: 'right', ArrowRight: 'right',
};
window.addEventListener('keydown', (e) => {
  Audio.resume();
  if (KEYMAP[e.code]) { keys[KEYMAP[e.code]] = true; e.preventDefault(); }
  if (e.code === 'Space') { keys.dash = true; e.preventDefault(); }
  if (e.code === 'KeyP') togglePause();
  if (Game.state === 'levelup') {
    if (e.code === 'Digit1') chooseCard(0);
    if (e.code === 'Digit2') chooseCard(1);
    if (e.code === 'Digit3') chooseCard(2);
  }
});
window.addEventListener('keyup', (e) => {
  if (KEYMAP[e.code]) keys[KEYMAP[e.code]] = false;
  if (e.code === 'Space') keys.dash = false;
});
window.addEventListener('blur', () => { for (const k in keys) keys[k] = false; });

// --- third-person camera with mouse look ---
// Click the scene to capture the mouse, then move it left/right to turn around. Esc releases.
// Movement stays relative to the camera and is verified non-inverted (W=into view, D=screen-right).
const cam = { yaw: 0, pitch: 0.52, dist: 15, sens: 0.0024 };
const canvasEl = renderer.domElement;
canvasEl.addEventListener('click', () => {
  Audio.resume();
  if (Game.state === 'playing' && document.pointerLockElement !== canvasEl) canvasEl.requestPointerLock?.();
});
document.addEventListener('mousemove', (e) => {
  if (document.pointerLockElement === canvasEl) {
    cam.yaw -= e.movementX * cam.sens;                                   // mouse right → turn right
    cam.pitch = clamp(cam.pitch - e.movementY * cam.sens * 0.6, 0.32, 1.05); // mouse up → look up a bit
  }
});
// Q / E also turn the view without capturing the mouse
window.addEventListener('keydown', (e) => {
  if (e.code === 'KeyQ') cam.yaw += 0.2;
  if (e.code === 'KeyE') cam.yaw -= 0.2;
});
function releasePointerLock() { if (document.pointerLockElement === canvasEl) document.exitPointerLock?.(); }

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ============================================================================
// CHARACTERS
// ============================================================================
const CHARACTERS = [
  { id: 'frog', name: 'Bonk', emoji: '🐸', color: 0x57c84d, desc: 'Balanced starter. Magic Bolt.', mods: {}, weapon: 'bolt' },
  { id: 'cat', name: 'Whiskers', emoji: '🐱', color: 0xff9f43, desc: '+15% speed, -10% HP. Fast hands.', mods: { speed: 1.15, hp: 0.9 }, weapon: 'spread' },
  { id: 'bot', name: 'Clank', emoji: '🤖', color: 0x9aa7ff, desc: '+25% HP, slower. Orbiting orbs.', mods: { speed: 0.9, hp: 1.25 }, weapon: 'orb' },
];
let selectedChar = CHARACTERS[0];

// ============================================================================
// PLAYER
// ============================================================================
const player = {
  group: new THREE.Group(),
  pos: new THREE.Vector3(0, 0, 0),
  vel: new THREE.Vector3(),
  facing: 0,
  isMoving: false,
  hp: 100, maxHp: 100,
  speed: CFG.playerBaseSpeed,
  level: 1, xp: 0, xpToNext: 5,
  gold: 0, kills: 0,
  pickupRadius: CFG.basePickupRadius,
  iframe: 0,
  dash: { t: 0, cd: 0, dir: new THREE.Vector3() },
  // multiplicative stats
  stats: {
    damage: 1, fireRate: 1, projSpeed: 1, projSize: 1, pierce: 0,
    crit: 0.05, critMult: 2, regen: 0, goldMult: 1, area: 1, xpMult: 1,
  },
  weapons: {},   // id -> { level, timer }
  passives: {},  // id -> level
  bobT: 0,
};
scene.add(player.group);

function buildPlayerMesh(char) {
  player.group.clear();
  const bodyMat = new THREE.MeshStandardMaterial({ color: char.color, roughness: 0.6, flatShading: true });
  const body = new THREE.Mesh(GEO.lowSphere, bodyMat);
  body.scale.set(0.95, 0.8, 0.95);
  body.position.y = 0.85;
  body.castShadow = true;
  player.group.add(body);
  // belly
  const belly = new THREE.Mesh(GEO.sphere, new THREE.MeshStandardMaterial({ color: 0xfdf3d0, roughness: 0.7 }));
  belly.scale.set(0.55, 0.45, 0.35); belly.position.set(0, 0.7, 0.6);
  player.group.add(belly);
  addEyes(player.group, 1.15, 0.32, 0.62, 1.1);
  // feet
  for (const sx of [-1, 1]) {
    const f = new THREE.Mesh(GEO.lowSphere, bodyMat);
    f.scale.set(0.3, 0.18, 0.42); f.position.set(sx * 0.4, 0.16, 0.2); f.castShadow = true;
    player.group.add(f);
  }
  player.group.scale.setScalar(1.5);
  player.bodyMat = bodyMat;
}

// ============================================================================
// OBJECT POOLS
// ============================================================================
function makePool(factory) {
  const all = [], free = [];
  return {
    all,
    get() {
      let o = free.pop();
      if (!o) { o = factory(); all.push(o); }
      o.active = true;
      return o;
    },
    release(o) {
      o.active = false;
      if (o.mesh) o.mesh.visible = false;
      free.push(o);
    },
  };
}

// --- enemies ---
const ENEMY_TYPES = {
  grunt: { color: 0xe24b4b, shape: 'lowSphere', size: 0.85, hp: 11, speed: 4.2, dmg: 7, xp: 1, gold: 0.05, scaleY: 0.9 },
  fast:  { color: 0xf2c94c, shape: 'cone',      size: 0.7,  hp: 7,  speed: 7.0, dmg: 6, xp: 1, gold: 0.05, scaleY: 1.2 },
  tank:  { color: 0x9b51e0, shape: 'box',       size: 1.25, hp: 48, speed: 2.7, dmg: 13, xp: 3, gold: 0.15, scaleY: 1.0 },
  swarm: { color: 0x56ccf2, shape: 'octa',      size: 0.55, hp: 4,  speed: 6.0, dmg: 4, xp: 1, gold: 0.02, scaleY: 1.0 },
  boss:  { color: 0x7a1230, shape: 'lowSphere', size: 2.6,  hp: 900, speed: 3.0, dmg: 30, xp: 40, gold: 3, scaleY: 1.0, boss: true },
};
const enemyPool = makePool(() => {
  const mesh = new THREE.Group();
  const bodyMat = new THREE.MeshStandardMaterial({ flatShading: true, roughness: 0.7 });
  const body = new THREE.Mesh(GEO.lowSphere, bodyMat);
  body.castShadow = true;
  mesh.add(body);
  addEyes(mesh, 0, 0, 0); // placeholder eyes; repositioned on spawn
  scene.add(mesh);
  return { mesh, body, bodyMat, active: false, hp: 0, maxHp: 0, type: null, def: null,
           radius: 1, speed: 0, dmg: 0, contactCd: 0, hitFlash: 0, wobble: 0 };
});
const enemies = enemyPool.all;

function spawnEnemy(typeKey, scaleHP, scaleSpd) {
  if (countActive(enemies) >= CFG.maxEnemies) return null;
  const def = ENEMY_TYPES[typeKey];
  const e = enemyPool.get();
  e.type = typeKey; e.def = def;
  e.maxHp = Math.round(def.hp * scaleHP);
  e.hp = e.maxHp;
  e.speed = def.speed * scaleSpd;
  e.dmg = def.dmg;
  e.radius = def.size;
  e.contactCd = 0; e.hitFlash = 0; e.wobble = rand(0, TAU);
  e.mesh.scale.setScalar(1);
  // rebuild body shape
  e.body.geometry = GEO[def.shape];
  e.bodyMat.color.setHex(def.color);
  e.body.scale.set(def.size, def.size * def.scaleY, def.size);
  e.body.position.y = def.size * def.scaleY;
  // reposition eyes — children 1..4 are eye meshes (w,p,w,p) from addEyes()
  const eyeY = def.size * def.scaleY + def.size * 0.4;
  const sp = def.size * 0.4, fw = def.size * 0.85;
  const eyes = e.mesh.children.slice(1, 5);
  const es = def.size * 0.9;
  if (eyes[0]) { eyes[0].scale.setScalar(es); eyes[0].position.set(-sp, eyeY, fw); }
  if (eyes[1]) { eyes[1].scale.setScalar(es); eyes[1].position.set(-sp, eyeY, fw + 0.12 * es); }
  if (eyes[2]) { eyes[2].scale.setScalar(es); eyes[2].position.set(sp, eyeY, fw); }
  if (eyes[3]) { eyes[3].scale.setScalar(es); eyes[3].position.set(sp, eyeY, fw + 0.12 * es); }
  // spawn position offscreen around player — 40% biased toward player's heading (predictive)
  let dx, dz;
  if (player.isMoving && Math.random() < 0.4) {
    const j = rand(-0.6, 0.6), fx = Math.sin(player.facing), fz = Math.cos(player.facing);
    const cs = Math.cos(j), sn = Math.sin(j);
    dx = fx * cs - fz * sn; dz = fx * sn + fz * cs;
  } else {
    const a = rand(0, TAU); dx = Math.cos(a); dz = Math.sin(a);
  }
  const r = rand(34, 42);
  e.mesh.position.set(player.pos.x + dx * r, 0, player.pos.z + dz * r);
  e.mesh.visible = true;
  if (def.boss) { Audio.boss(); toast(`⚠ BOSS INCOMING`, '#ff5e7a'); }
  return e;
}

// --- projectiles ---
const projPool = makePool(() => {
  const mesh = new THREE.Mesh(GEO.bolt, new THREE.MeshBasicMaterial({ color: 0x7ee3ff }));
  mesh.castShadow = false;
  scene.add(mesh);
  return { mesh, active: false, vel: new THREE.Vector3(), dmg: 0, pierce: 0, life: 0, radius: 0.4, hitIds: new Set(), color: 0x7ee3ff, homing: 0, target: null, speed: 26, explodeR: 0, explodeDmg: 0 };
});
const projectiles = projPool.all;
let projIdCounter = 1;

function fireProjectile(from, dir, opts) {
  const p = projPool.get();
  p.mesh.material.color.setHex(opts.color ?? 0x7ee3ff);
  const size = (opts.size ?? 1) * player.stats.projSize;
  p.mesh.scale.setScalar(size);
  p.radius = 0.4 * size;
  p.mesh.position.copy(from); p.mesh.position.y = 1.1;
  const spd = (opts.speed ?? 26) * player.stats.projSpeed;
  p.speed = spd;
  p.vel.copy(dir).normalize().multiplyScalar(spd);
  p.dmg = opts.dmg;
  p.pierce = opts.pierce ?? player.stats.pierce;
  p.life = opts.life ?? 1.5;
  p.hitIds.clear();
  p.crit = opts.crit ?? false;
  p.homing = opts.homing ?? 0;
  p.target = opts.homing ? (opts.target ?? null) : null;
  p.mesh.visible = true;
}

// --- xp gems / coins / pickups ---
const gemPool = makePool(() => {
  const mesh = new THREE.Mesh(GEO.gem, new THREE.MeshStandardMaterial({ color: 0x41d1ff, emissive: 0x1170aa, emissiveIntensity: 0.8, flatShading: true }));
  scene.add(mesh);
  return { mesh, active: false, value: 1, kind: 'xp', vy: 0, spin: rand(1, 3), homing: false };
});
const gems = gemPool.all;

function dropGem(pos, value, kind = 'xp') {
  const g = gemPool.get();
  g.value = value; g.kind = kind; g.homing = false; g.vy = rand(3, 5); g.spin = rand(2, 5);
  g.mesh.position.set(pos.x + rand(-0.5, 0.5), 1.0, pos.z + rand(-0.5, 0.5));
  if (kind === 'xp') {
    g.mesh.geometry = GEO.gem;
    const c = value >= 5 ? 0xffd23f : (value >= 3 ? 0x9b51e0 : 0x41d1ff);
    g.mesh.material.color.setHex(c);
    g.mesh.material.emissive.setHex(c).multiplyScalar(0.4);
    g.mesh.scale.setScalar(value >= 5 ? 1.4 : (value >= 3 ? 1.15 : 1));
  } else if (kind === 'gold') {
    g.mesh.geometry = GEO.coin;
    g.mesh.material.color.setHex(0xffd23f);
    g.mesh.material.emissive.setHex(0x806000);
    g.mesh.scale.setScalar(1);
  } else if (kind === 'heal') {
    g.mesh.geometry = GEO.lowSphere;
    g.mesh.material.color.setHex(0xff4d6d);
    g.mesh.material.emissive.setHex(0x801030);
    g.mesh.scale.setScalar(0.6);
  }
  g.mesh.visible = true;
}

// --- particles ---
const particlePool = makePool(() => {
  const mesh = new THREE.Mesh(GEO.box, new THREE.MeshBasicMaterial({ color: 0xffffff }));
  scene.add(mesh);
  return { mesh, active: false, vel: new THREE.Vector3(), life: 0, maxLife: 0, size: 1, grav: -18 };
});
const particles = particlePool.all;

function burst(pos, color, count, spd = 8, sizeBase = 0.3, grav = -18) {
  for (let i = 0; i < count; i++) {
    if (countActive(particles) > 260) break;
    const p = particlePool.get();
    p.mesh.material.color.setHex(color);
    p.mesh.position.set(pos.x, (pos.y ?? 1) , pos.z);
    const a = rand(0, TAU), up = rand(0.2, 1);
    p.vel.set(Math.cos(a) * rand(2, spd), up * rand(3, spd), Math.sin(a) * rand(2, spd));
    p.life = p.maxLife = rand(0.3, 0.6);
    p.size = sizeBase * rand(0.6, 1.3);
    p.grav = grav;
    p.mesh.scale.setScalar(p.size);
    p.mesh.visible = true;
  }
}

// expanding ring + filled aura flash (nova / katana / shockwaves) — bright, thick, clearly around the hero
const ringFx = [];
const ringFxGeo = new THREE.RingGeometry(0.55, 1.0, 48);   // thick band
ringFxGeo.rotateX(-Math.PI / 2);
function spawnRing(pos, maxR, color) {
  let r = ringFx.find((x) => !x.active);
  if (!r) {
    const mesh = new THREE.Mesh(ringFxGeo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false }));
    mesh.renderOrder = 3; scene.add(mesh); r = { mesh, active: false, t: 0, maxR: 1 }; ringFx.push(r);
  }
  r.active = true; r.t = 0; r.maxR = maxR; r.mesh.material.color.setHex(color);
  r.mesh.position.set(pos.x, 0.6, pos.z); r.mesh.visible = true; r.mesh.scale.setScalar(0.5);
}
// filled translucent disc that flashes out — reads as an aura/shockwave around the player
const auraFx = [];
const auraGeo = new THREE.CircleGeometry(1, 48);
auraGeo.rotateX(-Math.PI / 2);
function spawnAura(pos, maxR, color) {
  let a = auraFx.find((x) => !x.active);
  if (!a) {
    const mesh = new THREE.Mesh(auraGeo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.4, side: THREE.DoubleSide, depthWrite: false }));
    mesh.renderOrder = 2; scene.add(mesh); a = { mesh, active: false, t: 0, maxR: 1 }; auraFx.push(a);
  }
  a.active = true; a.t = 0; a.maxR = maxR; a.mesh.material.color.setHex(color);
  a.mesh.position.set(pos.x, 0.35, pos.z); a.mesh.visible = true; a.mesh.scale.setScalar(0.3);
}

// orbiting orb meshes (managed separately, tied to weapon level)
const orbGroup = new THREE.Group();
scene.add(orbGroup);
const orbs = []; // {mesh, contactCd:Map}

function countActive(arr) { let n = 0; for (const o of arr) if (o.active) n++; return n; }

// ============================================================================
// WEAPONS
// ============================================================================
// Each weapon: tick(e, dt) called every frame; uses player.weapons[id].level
function nearestEnemy(maxDist = 999) {
  let best = null, bd = maxDist * maxDist;
  for (const e of enemies) {
    if (!e.active) continue;
    const d = e.mesh.position.distanceToSquared(player.pos);
    if (d < bd) { bd = d; best = e; }
  }
  return best;
}
// nearest enemy to a projectile, skipping ones it already hit (so homing+pierce keeps finding fresh targets)
function nearestEnemyExcluding(skip, fromX, fromZ, maxDist = 999) {
  let best = null, bd = maxDist * maxDist;
  for (const e of enemies) {
    if (!e.active || skip.has(e)) continue;
    const d = distXZsq(e.mesh.position.x, e.mesh.position.z, fromX, fromZ);
    if (d < bd) { bd = d; best = e; }
  }
  return best;
}
// horizontal (XZ-plane) squared distance — combat happens on the ground plane,
// so we must ignore the Y offset of projectiles/orbs/gems or hits barely register.
function distXZsq(ax, az, bx, bz) { const dx = ax - bx, dz = az - bz; return dx * dx + dz * dz; }
function enemiesInRange(pos, radius) {
  const out = []; const r2 = radius * radius;
  for (const e of enemies) {
    if (!e.active) continue;
    if (distXZsq(e.mesh.position.x, e.mesh.position.z, pos.x, pos.z) <= r2) out.push(e);
  }
  return out;
}

const WEAPONS = {
  bolt: {
    name: 'Magic Bolt', emoji: '🔮', max: 8,
    desc: (l) => l === 0 ? 'Auto-fire a homing bolt at the nearest foe.' : `+1 bolt / +damage (now ${1 + Math.floor(l / 2)} bolts)`,
    cooldown: (l) => Math.max(0.16, 0.42 - l * 0.025) / player.stats.fireRate,
    fire(l) {
      const target = nearestEnemy(40);
      if (!target) return;
      const count = 1 + Math.floor(l / 2);
      const baseDmg = (11 + l * 5) * player.stats.damage;
      const dir = _v1.copy(target.mesh.position).sub(player.pos).setY(0).normalize();
      const spread = 0.22;
      for (let i = 0; i < count; i++) {
        const off = (i - (count - 1) / 2) * spread;
        const d = _v2.copy(dir).applyAxisAngle(CFG.worldUp, off);
        const crit = Math.random() < player.stats.crit;
        fireProjectile(player.pos, d, { dmg: crit ? baseDmg * player.stats.critMult : baseDmg, color: 0x7ee3ff, speed: 30, crit, size: 1, homing: 6, target, pierce: 2 + player.stats.pierce });
      }
      Audio.shoot();
    },
  },
  spread: {
    name: 'Scatter Shot', emoji: '🎇', max: 8,
    desc: (l) => l === 0 ? 'Fire a fan of pellets forward.' : `+pellets & damage (now ${3 + l} pellets)`,
    cooldown: (l) => Math.max(0.35, 0.9 - l * 0.05) / player.stats.fireRate,
    fire(l) {
      const target = nearestEnemy(36) || { mesh: { position: _v3.copy(player.pos).add(_v1.set(Math.sin(player.facing), 0, Math.cos(player.facing))) } };
      const count = 3 + l;
      const baseDmg = (5 + l * 2.5) * player.stats.damage;
      const dir = _v1.copy(target.mesh.position).sub(player.pos).setY(0).normalize();
      const arc = 0.7;
      for (let i = 0; i < count; i++) {
        const off = (i - (count - 1) / 2) * (arc / count);
        const d = _v2.copy(dir).applyAxisAngle(CFG.worldUp, off);
        const crit = Math.random() < player.stats.crit;
        fireProjectile(player.pos, d, { dmg: crit ? baseDmg * player.stats.critMult : baseDmg, color: 0xffc857, speed: 24, crit, life: 0.8, size: 0.85 });
      }
      Audio.shoot();
    },
  },
  nova: {
    name: 'Nova Pulse', emoji: '💥', max: 8,
    desc: (l) => l === 0 ? 'Release a shockwave that damages all nearby.' : `+radius & damage (r=${(5 + l).toFixed(0)})`,
    cooldown: (l) => Math.max(1.2, 3.0 - l * 0.18) / player.stats.fireRate,
    fire(l) {
      const radius = (5 + l) * player.stats.area;
      const dmg = (14 + l * 7) * player.stats.damage;
      spawnAura(player.pos, radius, 0xff7ae0);
      spawnRing(player.pos, radius, 0xff7ae0);
      for (const e of enemiesInRange(player.pos, radius)) {
        damageEnemy(e, dmg, false);
        const kb = _v1.copy(e.mesh.position).sub(player.pos).setY(0).normalize().multiplyScalar(2);
        e.mesh.position.add(kb);
      }
      Audio.nova();
    },
  },
  orb: {
    name: 'Orbit Orbs', emoji: '🟣', max: 8,
    desc: (l) => l === 0 ? 'Orbs circle you, smashing foes they touch.' : `+orbs & damage (now ${2 + l} orbs)`,
    cooldown: () => 999, // handled continuously, not by cooldown
    fire() {},
  },
  katana: {
    name: 'Katana', emoji: '🗡️', max: 8,
    desc: (l) => l === 0 ? 'Slash all foes around you.' : `+damage & radius (r=${(3.4 + l * 0.5).toFixed(1)})`,
    cooldown: (l) => Math.max(0.35, 0.85 - l * 0.05) / player.stats.fireRate,
    fire(l) {
      const radius = (3.4 + l * 0.5) * player.stats.area;
      const dmg = (13 + l * 6) * player.stats.damage;
      for (const e of enemiesInRange(player.pos, radius)) {
        const crit = Math.random() < player.stats.crit;
        damageEnemy(e, crit ? dmg * player.stats.critMult : dmg, crit);
        const kb = _v1.copy(e.mesh.position).sub(player.pos).setY(0).normalize().multiplyScalar(1.2);
        e.mesh.position.add(kb);
      }
      spawnAura(player.pos, radius * 1.05, 0x9be7ff);
      spawnRing(player.pos, radius * 1.05, 0xffffff);
      Audio.hit();
    },
  },
  firestaff: {
    name: 'Firestaff', emoji: '🔥', max: 8,
    desc: (l) => l === 0 ? 'Lob a fireball that explodes on impact.' : `+blast damage & size`,
    cooldown: (l) => Math.max(0.8, 1.9 - l * 0.13) / player.stats.fireRate,
    fire(l) {
      const target = nearestEnemy(42);
      if (!target) return;
      const dir = _v1.copy(target.mesh.position).sub(player.pos).setY(0).normalize();
      fireProjectile(player.pos, dir, {
        dmg: (10 + l * 5) * player.stats.damage, color: 0xff7a2d, speed: 18, size: 1.5,
        homing: 2.5, target, life: 2.5,
        explodeR: (3 + l * 0.4) * player.stats.area, explodeDmg: (16 + l * 8) * player.stats.damage,
      });
      Audio.shoot();
    },
  },
  lightning: {
    name: 'Chain Bolt', emoji: '⚡', max: 8,
    desc: (l) => l === 0 ? 'Zap the nearest foe; arcs to others nearby.' : `+chains & damage (now ${2 + l} targets)`,
    cooldown: (l) => Math.max(0.7, 1.8 - l * 0.12) / player.stats.fireRate,
    fire(l) {
      const first = nearestEnemy(34);
      if (!first) return;
      const chains = 2 + l;
      const dmg = (10 + l * 5) * player.stats.damage;
      let cur = first; const hit = new Set();
      let from = player.pos;
      for (let i = 0; i < chains && cur; i++) {
        damageEnemy(cur, dmg, false);
        hit.add(cur);
        drawZap(from, cur.mesh.position);
        from = cur.mesh.position.clone();
        // next nearest unhit within 10
        let best = null, bd = 100;
        for (const e of enemies) {
          if (!e.active || hit.has(e)) continue;
          const d = e.mesh.position.distanceToSquared(from);
          if (d < bd) { bd = d; best = e; }
        }
        cur = best;
      }
      Audio.hit();
    },
  },
};

// lightning visual
const zaps = [];
function drawZap(a, b) {
  let z = zaps.find((x) => !x.active);
  if (!z) {
    const geo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
    const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0x9be7ff, transparent: true, opacity: 0.9 }));
    scene.add(line); z = { line, active: false, t: 0 }; zaps.push(z);
  }
  z.active = true; z.t = 0.12;
  const pts = z.line.geometry.attributes.position.array;
  pts[0] = a.x; pts[1] = 1.1; pts[2] = a.z;
  pts[3] = b.x; pts[4] = 1.1; pts[5] = b.z;
  z.line.geometry.attributes.position.needsUpdate = true;
  z.line.visible = true;
}

// ============================================================================
// UPGRADES (cards). Includes weapon acquire/level + passives.
// ============================================================================
// research-confirmed rarity colors + weights; rarity scales the numeric effect
const RARITY = { common: '#5fd35f', uncommon: '#4aa3ff', rare: '#d24ad2', legendary: '#ffd23f' };
const RARITY_MULT = { common: 1, uncommon: 1.3, rare: 1.7, legendary: 2.2 };
const RARITY_W = [['common', 60], ['uncommon', 25], ['rare', 12], ['legendary', 3]];
function rollRarity() {
  let r = Math.random() * 100;
  for (const [name, w] of RARITY_W) { if (r < w) return name; r -= w; }
  return 'common';
}
const pct = (v) => `${Math.round(v * 100)}%`;

// each passive: base value (at common); rarity multiplies it; apply(v) uses the scaled value
const PASSIVES = {
  speed:    { name: 'Swift Boots', emoji: '👟', max: 5, base: 0.14, desc: v => `+${pct(v)} move speed`, apply: v => { player.speed *= 1 + v; } },
  damage:   { name: 'Power Crystal', emoji: '🔺', max: 8, base: 0.22, desc: v => `+${pct(v)} damage`, apply: v => { player.stats.damage *= 1 + v; } },
  firerate: { name: 'Rapid Core', emoji: '⏩', max: 6, base: 0.16, desc: v => `+${pct(v)} attack speed`, apply: v => { player.stats.fireRate *= 1 + v; } },
  maxhp:    { name: 'Vitality', emoji: '❤️', max: 6, base: 30, desc: v => `+${Math.round(v)} max HP & heal`, apply: v => { const a = Math.round(v); player.maxHp += a; player.hp = Math.min(player.maxHp, player.hp + a); } },
  magnet:   { name: 'Magnet', emoji: '🧲', max: 5, base: 0.3, desc: v => `+${pct(v)} pickup range`, apply: v => { player.pickupRadius *= 1 + v; } },
  regen:    { name: 'Regrowth', emoji: '🌱', max: 5, base: 1.0, desc: v => `+${v.toFixed(1)} HP/s regen`, apply: v => { player.stats.regen += v; } },
  crit:     { name: 'Sharp Eyes', emoji: '🎯', max: 6, base: 0.07, desc: v => `+${pct(v)} crit chance`, apply: v => { player.stats.crit = Math.min(1, player.stats.crit + v); } },
  critdmg:  { name: 'Brutal', emoji: '🩸', max: 5, base: 0.4, desc: v => `+${pct(v)} crit damage`, apply: v => { player.stats.critMult += v; } },
  projsize: { name: "Giant's Might", emoji: '🔵', max: 5, base: 0.2, desc: v => `+${pct(v)} proj size, +1 pierce`, apply: v => { player.stats.projSize *= 1 + v; player.stats.pierce += 1; } },
  projspeed:{ name: 'Haste Rune', emoji: '🌀', max: 5, base: 0.18, desc: v => `+${pct(v)} projectile speed`, apply: v => { player.stats.projSpeed *= 1 + v; } },
  area:     { name: 'Wide Aura', emoji: '⭕', max: 5, base: 0.18, desc: v => `+${pct(v)} area size`, apply: v => { player.stats.area *= 1 + v; } },
  armor:    { name: 'Iron Hide', emoji: '🛡️', max: 5, base: 3, desc: v => `-${Math.round(v)} damage taken / hit`, apply: v => { player.stats.armor += Math.round(v); } },
  greed:    { name: 'Greed', emoji: '💰', max: 5, base: 0.3, desc: v => `+${pct(v)} gold gain`, apply: v => { player.stats.goldMult *= 1 + v; } },
  wisdom:   { name: 'Wisdom', emoji: '📘', max: 5, base: 0.2, desc: v => `+${pct(v)} XP gain`, apply: v => { player.stats.xpMult *= 1 + v; } },
};

// build candidate pool for level up
function rollCards() {
  const pool = [];
  // weapon options
  for (const id in WEAPONS) {
    const owned = player.weapons[id];
    const lvl = owned ? owned.level : 0;
    if (lvl >= WEAPONS[id].max) continue;
    const isNew = !owned;
    // limit to max 5 weapons owned
    const ownedCount = Object.keys(player.weapons).length;
    if (isNew && ownedCount >= 5) continue;
    pool.push({ kind: 'weapon', id, isNew, level: lvl,
      name: WEAPONS[id].name, emoji: WEAPONS[id].emoji,
      desc: WEAPONS[id].desc(lvl), rar: isNew ? 'rare' : 'common',
      tag: isNew ? 'New Weapon' : `Weapon Lv ${lvl} → ${lvl + 1}` });
  }
  // passive options — each rolls its own rarity, which scales the effect
  for (const id in PASSIVES) {
    const lvl = player.passives[id] || 0;
    if (lvl >= PASSIVES[id].max) continue;
    const rar = rollRarity();
    const value = PASSIVES[id].base * RARITY_MULT[rar];
    pool.push({ kind: 'passive', id, level: lvl, value, rar,
      name: PASSIVES[id].name, emoji: PASSIVES[id].emoji,
      desc: PASSIVES[id].desc(value),
      tag: `Passive Lv ${lvl} → ${lvl + 1}` });
  }
  // pick 3 weighted (favor new weapons slightly)
  const chosen = [];
  const weights = pool.map((c) => (c.isNew ? 2.2 : 1) * (c.kind === 'weapon' ? 1.2 : 1));
  for (let n = 0; n < 3 && pool.length; n++) {
    let total = weights.reduce((a, b) => a + b, 0);
    let r = Math.random() * total, idx = 0;
    while (r > weights[idx]) { r -= weights[idx]; idx++; }
    chosen.push(pool[idx]);
    pool.splice(idx, 1); weights.splice(idx, 1);
  }
  // fallback: a heal if nothing left
  if (chosen.length === 0) {
    chosen.push({ kind: 'heal', name: 'Full Heal', emoji: '✨', desc: () => 'Restore all HP', rar: 'legendary', tag: 'Bonus', applyHeal: true });
  }
  return chosen;
}

function applyCard(c) {
  if (c.kind === 'weapon') {
    if (player.weapons[c.id]) player.weapons[c.id].level++;
    else player.weapons[c.id] = { level: 1, timer: 0 };
    if (c.id === 'orb') rebuildOrbs();
  } else if (c.kind === 'passive') {
    player.passives[c.id] = (player.passives[c.id] || 0) + 1;
    PASSIVES[c.id].apply(c.value);
  } else if (c.applyHeal) {
    player.hp = player.maxHp;
  }
  updateTray();
}

function rebuildOrbs() {
  const lvl = player.weapons.orb ? player.weapons.orb.level : 0;
  const want = lvl ? 2 + lvl : 0;
  // clear
  for (const o of orbs) { orbGroup.remove(o.mesh); }
  orbs.length = 0;
  for (let i = 0; i < want; i++) {
    const m = new THREE.Mesh(GEO.lowSphere, new THREE.MeshStandardMaterial({ color: 0xc98bff, emissive: 0x9b3bff, emissiveIntensity: 1.4, flatShading: true }));
    m.scale.setScalar(0.8 * player.stats.area);
    m.castShadow = true;
    orbGroup.add(m);
    orbs.push({ mesh: m, contactCd: new Map() });
  }
}

// ============================================================================
// COMBAT RESOLUTION
// ============================================================================
function damageEnemy(e, dmg, crit) {
  if (!e.active) return;
  e.hp -= dmg;
  e.hitFlash = 0.18;
  spawnDamageNumber(e.mesh.position, Math.round(dmg), crit);
  if (e.hp <= 0) killEnemy(e);
}

function killEnemy(e) {
  if (!e.active) return;
  const def = e.def;
  player.kills++;
  if (e === activeBoss) { activeBoss = null; dom.bossbar.classList.add('hidden'); toast('BOSS DOWN! 💀', '#ffd23f'); }
  burst(e.mesh.position, def.color, def.boss ? 40 : 10, def.boss ? 14 : 8, def.boss ? 0.5 : 0.3);
  Audio.enemyDie();
  // drops
  const xpVal = def.xp;
  if (def.boss) {
    for (let i = 0; i < 8; i++) dropGem(e.mesh.position, 5, 'xp');
    for (let i = 0; i < 6; i++) dropGem(e.mesh.position, 1, 'gold');
    dropGem(e.mesh.position, 1, 'heal');
    spawnRing(e.mesh.position, 8, 0xffd23f);
    addShake(0.6);
  } else {
    dropGem(e.mesh.position, xpVal, 'xp');
    if (Math.random() < def.gold) dropGem(e.mesh.position, 1, 'gold');
  }
  enemyPool.release(e);
}

function hurtPlayer(dmg) {
  if (player.iframe > 0 || Game.state !== 'playing') return;
  player.hp -= Math.max(1, dmg - player.stats.armor);
  player.iframe = CFG.contactIFrame;
  Audio.hurt();
  flashScreen();
  addShake(0.35);
  if (player.bodyMat) player.bodyMat.emissive = new THREE.Color(0xff0000);
  if (player.hp <= 0) { player.hp = 0; gameOver(); }
  updateHUD();
}

// ============================================================================
// DAMAGE NUMBERS (pooled DOM)
// ============================================================================
const dmgPool = [];
function spawnDamageNumber(worldPos, value, crit) {
  let el = dmgPool.find((d) => !d._active);
  if (!el) {
    el = document.createElement('div');
    el.className = 'dmg';
    dom.fx.appendChild(el); dmgPool.push(el);
  }
  el._active = true; el._t = 0; el._life = 0.7;
  el.className = 'dmg' + (crit ? ' crit' : '');
  el.textContent = value;
  el.style.color = crit ? '#ffd23f' : '#ffffff';
  el._wp = worldPos.clone(); el._wp.y = (worldPos.y || 1) + 1.4;
  el._driftX = rand(-20, 20);
  el.style.display = 'block';
}
function updateDamageNumbers(dt) {
  for (const el of dmgPool) {
    if (!el._active) continue;
    el._t += dt;
    const k = el._t / el._life;
    if (k >= 1) { el._active = false; el.style.display = 'none'; continue; }
    _v1.copy(el._wp); _v1.y += k * 1.2;
    const sp = worldToScreen(_v1);
    el.style.transform = `translate(-50%,-50%) translate(${sp.x + el._driftX * k}px, ${sp.y}px) scale(${1 + (el.classList.contains('crit') ? 0.3 : 0) - k * 0.2})`;
    el.style.opacity = String(1 - k * k);
  }
}
function worldToScreen(v) {
  _v2.copy(v).project(camera);
  return { x: (_v2.x * 0.5 + 0.5) * window.innerWidth, y: (-_v2.y * 0.5 + 0.5) * window.innerHeight };
}

// ============================================================================
// SCREEN SHAKE + FLASH
// ============================================================================
let shake = 0;
function addShake(amount) { shake = Math.min(1.2, shake + amount); }
let flashT = 0;
function flashScreen() { flashT = 0.25; dom.flash.style.opacity = '1'; }

// ============================================================================
// TOASTS
// ============================================================================
function toast(text, color = '#fff') {
  const el = document.createElement('div');
  el.className = 'toast-msg'; el.textContent = text; el.style.color = color;
  dom.toast.appendChild(el);
  requestAnimationFrame(() => el.classList.add('show'));
  setTimeout(() => { el.classList.remove('show'); setTimeout(() => el.remove(), 300); }, 1800);
}

// ============================================================================
// SPAWN DIRECTOR
// ============================================================================
let activeBoss = null;
const Director = {
  spawnTimer: 0,
  nextBoss: CFG.bossInterval,
  reset() {
    this.spawnTimer = 0;
    this.nextBoss = CFG.bossInterval;
    this.spikes = [{ at: 120, count: 40, done: false }, { at: 420, count: 70, done: false }];
  },
  update(dt, t) {
    // difficulty scaling
    const hpScale = 1 + t / 48;          // enemy HP grows with time
    const spdScale = 1 + t / 240;        // small speed growth
    const interval = lerp(CFG.spawnStartInterval, CFG.spawnMinInterval, clamp(t / 300, 0, 1));
    const batch = 2 + Math.floor(t / 20);

    this.spawnTimer -= dt;
    if (this.spawnTimer <= 0) {
      this.spawnTimer = interval;
      for (let i = 0; i < batch; i++) {
        spawnEnemy(this.rollType(t), hpScale, spdScale);
      }
    }
    // scripted swarm spikes (research: ~2:00 and ~7:00)
    for (const spike of this.spikes) {
      if (!spike.done && t >= spike.at) {
        spike.done = true;
        toast('⚠ SWARM INCOMING!', '#ff8a3d');
        for (let i = 0; i < spike.count; i++) spawnEnemy(this.rollType(t), hpScale * 1.1, spdScale);
      }
    }
    // boss
    if (t >= this.nextBoss) {
      this.nextBoss += CFG.bossInterval;
      const bossHpScale = 1 + t / 55;
      const b = spawnEnemy('boss', bossHpScale, 1);
      if (b) activeBoss = b;
    }
  },
  spikes: [],
  rollType(t) {
    const r = Math.random();
    if (t < 30) return r < 0.8 ? 'grunt' : 'fast';
    if (t < 90) {
      if (r < 0.5) return 'grunt';
      if (r < 0.75) return 'fast';
      if (r < 0.92) return 'swarm';
      return 'tank';
    }
    // late
    if (r < 0.32) return 'grunt';
    if (r < 0.55) return 'fast';
    if (r < 0.8) return 'swarm';
    return 'tank';
  },
};

// ============================================================================
// GAME STATE
// ============================================================================
const Game = {
  state: 'menu', // menu | playing | levelup | paused | gameover
  time: 0,
  pendingLevelUps: 0,
};

function startGame(char) {
  selectedChar = char;
  // reset player
  player.pos.set(0, 0, 0);
  player.vel.set(0, 0, 0);
  player.facing = 0;
  player.maxHp = Math.round(CFG.playerBaseHP * (char.mods.hp || 1));
  player.hp = player.maxHp;
  player.speed = CFG.playerBaseSpeed * (char.mods.speed || 1);
  player.level = 1; player.xp = 0; player.xpToNext = 5;
  player.gold = 0; player.kills = 0;
  player.pickupRadius = CFG.basePickupRadius;
  player.iframe = 0;
  player.dash = { t: 0, cd: 0, dir: new THREE.Vector3() };
  player.stats = { damage: 1, fireRate: 1, projSpeed: 1, projSize: 1, pierce: 0, crit: 0.05, critMult: 2, regen: 0, goldMult: 1, area: 1, xpMult: 1, armor: 0 };
  player.weapons = {};
  player.passives = {};
  player.weapons[char.weapon] = { level: 1, timer: 0 };
  buildPlayerMesh(char);
  if (char.weapon === 'orb') rebuildOrbs(); else { for (const o of orbs) orbGroup.remove(o.mesh); orbs.length = 0; }

  // clear field
  for (const e of enemies) if (e.active) enemyPool.release(e);
  for (const p of projectiles) if (p.active) projPool.release(p);
  for (const g of gems) if (g.active) gemPool.release(g);
  for (const p of particles) if (p.active) particlePool.release(p);

  Director.reset();
  activeBoss = null;
  cam.yaw = 0; cam.pitch = 0.52;
  Game.time = 0;
  Game.pendingLevelUps = 0;
  Game.state = 'playing';
  dom.menu.classList.add('hidden');
  dom.gameover.classList.add('hidden');
  dom.levelup.classList.add('hidden');
  dom.pause.classList.add('hidden');
  dom.bossbar.classList.add('hidden');
  dom.hud.classList.remove('hidden');
  updateTray();
  updateHUD();
}

function gainXP(v) {
  player.xp += v * player.stats.xpMult;
  while (player.xp >= player.xpToNext) {
    player.xp -= player.xpToNext;
    player.level++;
    player.xpToNext = Math.round(4 + player.level * 3 + Math.pow(player.level, 1.5));
    Game.pendingLevelUps++;
  }
  if (Game.pendingLevelUps > 0 && Game.state === 'playing') openLevelUp();
  updateHUD();
}

function gainGold(v) {
  player.gold += Math.round(v * player.stats.goldMult);
  updateHUD();
}

// --- level up flow ---
let currentCards = [];
function openLevelUp() {
  Game.state = 'levelup';
  releasePointerLock();
  Audio.levelup();
  currentCards = rollCards();
  dom.cards.innerHTML = '';
  currentCards.forEach((c, i) => {
    const el = document.createElement('div');
    el.className = 'card' + (c.isNew ? ' new' : '');
    el.style.borderColor = RARITY[c.rar] || RARITY.common;
    el.innerHTML = `
      <div class="key">${i + 1}</div>
      <div class="em">${c.emoji}</div>
      <div class="nm">${c.name}</div>
      <div class="rar" style="color:${RARITY[c.rar]}">${c.rar}</div>
      <div class="ds">${typeof c.desc === 'function' ? c.desc() : c.desc}</div>
      <div class="tag">${c.tag || ''}</div>`;
    el.onclick = () => chooseCard(i);
    dom.cards.appendChild(el);
  });
  dom.levelup.classList.remove('hidden');
}
function chooseCard(i) {
  if (Game.state !== 'levelup' || !currentCards[i]) return;
  applyCard(currentCards[i]);
  toast(`Got ${currentCards[i].name}!`, RARITY[currentCards[i].rar]);
  Game.pendingLevelUps--;
  dom.levelup.classList.add('hidden');
  if (Game.pendingLevelUps > 0) { openLevelUp(); }
  else { Game.state = 'playing'; }
  updateHUD();
}

function togglePause() {
  if (Game.state === 'playing') { Game.state = 'paused'; releasePointerLock(); dom.pause.classList.remove('hidden'); }
  else if (Game.state === 'paused') { Game.state = 'playing'; dom.pause.classList.add('hidden'); }
}
dom.resume.onclick = togglePause;
dom.quit.onclick = () => { dom.pause.classList.add('hidden'); dom.hud.classList.add('hidden'); dom.menu.classList.remove('hidden'); Game.state = 'menu'; };

const DEATH_QUIPS = ['skill issue', 'get bonked', 'oof', 'L + ratio', 'you fell off', 'have you tried not dying?', 'bonk too strong'];
function endRun(win) {
  Game.state = 'gameover';
  releasePointerLock();
  activeBoss = null;
  dom.bossbar.classList.add('hidden');
  dom.goTitle.textContent = win ? 'SURVIVED!' : 'YOU DIED';
  dom.goTitle.style.color = win ? '#ffd23f' : '#ff3d6e';
  dom.goQuip.textContent = win ? 'you actually made it. respect.' : DEATH_QUIPS[Math.floor(Math.random() * DEATH_QUIPS.length)];
  dom.goStats.innerHTML = `
    <div>Survived <span class="v">${fmtTime(Game.time)}</span></div>
    <div>Level <span class="v">${player.level}</span></div>
    <div>Kills <span class="v">${player.kills}</span></div>
    <div>Gold <span class="v">${player.gold}</span></div>`;
  dom.gameover.classList.remove('hidden');
  burst(player.pos, win ? 0xffd23f : selectedChar.color, 40, 14, 0.5);
  addShake(0.8);
}
function gameOver() { endRun(false); }
function winGame() { endRun(true); }
dom.again.onclick = () => startGame(selectedChar);

// ============================================================================
// HUD UPDATES
// ============================================================================
function updateHUD() {
  dom.xpFill.style.transform = `scaleX(${clamp(player.xp / player.xpToNext, 0, 1)})`;
  dom.lvl.textContent = `LV ${player.level}`;
  const hpPct = clamp(player.hp / player.maxHp, 0, 1);
  dom.hpFill.style.transform = `scaleX(${hpPct})`;
  dom.hpLabel.textContent = `${Math.ceil(player.hp)} / ${player.maxHp}`;
  dom.kills.textContent = `☠ ${player.kills}`;
  dom.gold.textContent = `⬤ ${player.gold}`;
}
function updateTray() {
  dom.tray.innerHTML = '';
  const add = (cls, emoji, name, pip) => {
    const s = document.createElement('div'); s.className = 'slot ' + cls;
    s.innerHTML = `<span class="ic">${emoji}</span><span class="nm">${name}</span><span class="pip">${pip}</span>`;
    dom.tray.appendChild(s);
  };
  for (const id in player.weapons) add('wpn', WEAPONS[id].emoji, WEAPONS[id].name, 'Lv' + player.weapons[id].level);
  for (const id in player.passives) add('pas', PASSIVES[id].emoji, PASSIVES[id].name, '×' + player.passives[id]);
}

// ============================================================================
// UPDATE LOOP
// ============================================================================
function updatePlayer(dt) {
  // movement input (camera-relative)
  const fwdIn = (keys.up ? 1 : 0) - (keys.down ? 1 : 0);
  const rightIn = (keys.right ? 1 : 0) - (keys.left ? 1 : 0);
  // forward = (sin yaw, cos yaw); screen-right = forward rotated -90° = (-cos yaw, sin yaw)
  const sy = Math.sin(cam.yaw), cy = Math.cos(cam.yaw);
  let ix = sy * fwdIn - cy * rightIn;
  let iz = cy * fwdIn + sy * rightIn;
  const moving = ix !== 0 || iz !== 0;
  player.isMoving = moving;
  if (moving) {
    const len = Math.hypot(ix, iz); ix /= len; iz /= len;
    player.facing = Math.atan2(ix, iz);
  }
  // dash
  player.dash.cd -= dt;
  if (keys.dash && player.dash.cd <= 0 && player.dash.t <= 0 && moving) {
    player.dash.t = CFG.dashTime; player.dash.cd = CFG.dashCooldown;
    player.dash.dir.set(ix, 0, iz);
    player.iframe = Math.max(player.iframe, CFG.dashTime + 0.05);
    burst(player.pos, 0x7ee3ff, 8, 6, 0.25);
  }
  if (player.dash.t > 0) {
    player.dash.t -= dt;
    player.pos.x += player.dash.dir.x * CFG.dashSpeed * dt;
    player.pos.z += player.dash.dir.z * CFG.dashSpeed * dt;
  } else if (moving) {
    player.pos.x += ix * player.speed * dt;
    player.pos.z += iz * player.speed * dt;
  }
  // clamp to arena
  const distC = Math.hypot(player.pos.x, player.pos.z);
  const maxC = CFG.playRadius;
  if (distC > maxC) { player.pos.x *= maxC / distC; player.pos.z *= maxC / distC; }

  player.group.position.copy(player.pos);
  // face & bob
  player.group.rotation.y = lerp(player.group.rotation.y, player.facing, 1 - Math.pow(0.001, dt));
  player.bobT += dt * (moving ? 12 : 4);
  player.group.position.y = Math.abs(Math.sin(player.bobT)) * (moving ? 0.18 : 0.05);

  // iframe / emissive recover
  if (player.iframe > 0) {
    player.iframe -= dt;
    if (player.bodyMat) player.bodyMat.emissive.setRGB(0.4 * Math.max(0, player.iframe / CFG.contactIFrame), 0, 0);
    player.group.visible = Math.floor(player.iframe * 20) % 2 === 0 ? true : (player.dash.t <= 0);
  } else {
    player.group.visible = true;
    if (player.bodyMat) player.bodyMat.emissive.setRGB(0, 0, 0);
  }
  // regen
  if (player.stats.regen > 0 && player.hp < player.maxHp) {
    player.hp = Math.min(player.maxHp, player.hp + player.stats.regen * dt);
    updateHUD();
  }
}

function updateWeapons(dt) {
  for (const id in player.weapons) {
    if (id === 'orb') continue;
    const w = WEAPONS[id]; const slot = player.weapons[id];
    slot.timer -= dt;
    if (slot.timer <= 0) {
      slot.timer = w.cooldown(slot.level);
      w.fire(slot.level);
    }
  }
  // orbs (continuous)
  if (orbs.length) {
    const lvl = player.weapons.orb.level;
    const dmg = (8 + lvl * 4) * player.stats.damage;
    const radius = 2.6 * player.stats.area;
    const t = Game.time * 2.4;
    orbGroup.position.copy(player.group.position);
    orbs.forEach((o, i) => {
      const a = t + (i / orbs.length) * TAU;
      o.mesh.position.set(Math.cos(a) * radius, 1.0, Math.sin(a) * radius);
      // decay contact cooldowns
      for (const [e, cd] of o.contactCd) { const n = cd - dt; if (n <= 0 || !e.active) o.contactCd.delete(e); else o.contactCd.set(e, n); }
      const wx = o.mesh.position.x + orbGroup.position.x, wz = o.mesh.position.z + orbGroup.position.z;
      for (const e of enemies) {
        if (!e.active || o.contactCd.has(e)) continue;
        const rr = e.radius + 0.9;
        if (distXZsq(wx, wz, e.mesh.position.x, e.mesh.position.z) < rr * rr) {
          damageEnemy(e, dmg, false);
          o.contactCd.set(e, 0.4);
        }
      }
    });
  }
}

function updateProjectiles(dt) {
  for (const p of projectiles) {
    if (!p.active) continue;
    p.life -= dt;
    // homing: steer velocity toward a target enemy (retarget once the current one is gone or already hit)
    if (p.homing > 0) {
      if (!p.target || !p.target.active || p.hitIds.has(p.target)) p.target = nearestEnemyExcluding(p.hitIds, p.mesh.position.x, p.mesh.position.z, 45);
      if (p.target) {
        _v1.copy(p.target.mesh.position).sub(p.mesh.position); _v1.y = 0;
        if (_v1.lengthSq() > 0.001) {
          _v1.normalize().multiplyScalar(p.speed);
          p.vel.lerp(_v1, clamp(p.homing * dt, 0, 1));
          p.vel.setLength(p.speed);
        }
      }
    }
    p.mesh.position.addScaledVector(p.vel, dt);
    if (p.life <= 0) { projPool.release(p); continue; }
    // hit test (XZ plane, with a little generosity so fast crowds register)
    for (const e of enemies) {
      if (!e.active || p.hitIds.has(e)) continue;
      const rr = e.radius + p.radius + 0.45;
      if (distXZsq(p.mesh.position.x, p.mesh.position.z, e.mesh.position.x, e.mesh.position.z) < rr * rr) {
        damageEnemy(e, p.dmg, p.crit);
        burst(p.mesh.position, p.color ?? 0x7ee3ff, 5, 6, 0.2, -4);
        // knockback for punchy feel
        _v1.set(e.mesh.position.x - p.mesh.position.x, 0, e.mesh.position.z - p.mesh.position.z);
        if (_v1.lengthSq() > 0.0001) e.mesh.position.add(_v1.normalize().multiplyScalar(e.def.boss ? 0.15 : 0.7));
        p.hitIds.add(e);
        if (p.explodeR > 0) {
          spawnRing(p.mesh.position, p.explodeR, p.color);
          burst(p.mesh.position, p.color, 16, 10, 0.45);
          for (const e2 of enemiesInRange(p.mesh.position, p.explodeR)) damageEnemy(e2, p.explodeDmg, false);
          addShake(0.2); Audio.nova();
          projPool.release(p); break;
        }
        if (p.pierce <= 0) { projPool.release(p); break; }
        p.pierce--;
      }
    }
  }
}

function updateEnemies(dt) {
  const pr = CFG.playerRadius;
  for (const e of enemies) {
    if (!e.active) continue;
    // move toward player
    _v1.copy(player.pos).sub(e.mesh.position); _v1.y = 0;
    const dist = _v1.length();
    if (dist > 0.001) _v1.multiplyScalar(1 / dist);
    // simple separation jitter so they don't perfectly stack
    e.wobble += dt;
    const perp = _v2.set(-_v1.z, 0, _v1.x).multiplyScalar(Math.sin(e.wobble * 3 + e.mesh.id) * 0.25);
    e.mesh.position.x += (_v1.x * e.speed + perp.x) * dt;
    e.mesh.position.z += (_v1.z * e.speed + perp.z) * dt;
    // face player & waddle
    e.mesh.rotation.y = Math.atan2(_v1.x, _v1.z);
    e.body.position.y = e.radius * e.def.scaleY + Math.abs(Math.sin(e.wobble * 8)) * 0.12;
    // contact damage
    e.contactCd -= dt;
    if (dist < e.radius + pr) {
      if (e.contactCd <= 0) { hurtPlayer(e.dmg); e.contactCd = 0.6; }
    }
    // hit flash + scale punch for juicy registration
    if (e.hitFlash > 0) {
      e.hitFlash -= dt;
      const f = clamp(e.hitFlash / 0.18, 0, 1);
      e.bodyMat.emissive.setRGB(1, 1, 1).multiplyScalar(f);
      e.mesh.scale.setScalar(1 + 0.3 * f);
    } else {
      e.bodyMat.emissive.setRGB(0, 0, 0);
      if (e.mesh.scale.x !== 1) e.mesh.scale.setScalar(1);
    }
    // despawn if absurdly far (shouldn't happen since they chase)
    if (e.mesh.position.distanceToSquared(player.pos) > CFG.enemyDespawnDist ** 2) enemyPool.release(e);
  }
}

function updateGems(dt) {
  const pr2 = player.pickupRadius * player.pickupRadius;
  const collect2 = 1.3 * 1.3;
  for (const g of gems) {
    if (!g.active) continue;
    // falling/settle
    if (g.mesh.position.y > 0.5 || g.vy > 0) {
      g.vy -= 22 * dt; g.mesh.position.y += g.vy * dt;
      if (g.mesh.position.y < 0.5) { g.mesh.position.y = 0.5; g.vy = 0; }
    }
    g.mesh.rotation.y += g.spin * dt;
    const d2 = distXZsq(g.mesh.position.x, g.mesh.position.z, player.pos.x, player.pos.z);
    if (d2 < pr2 || g.homing) {
      g.homing = true;
      _v1.copy(player.pos).sub(g.mesh.position); _v1.y = 0;
      const d = _v1.length();
      const pull = clamp(18 - d * 0.5, 8, 26);
      _v1.normalize();
      g.mesh.position.x += _v1.x * pull * dt;
      g.mesh.position.z += _v1.z * pull * dt;
      g.mesh.position.y = lerp(g.mesh.position.y, 1.0, dt * 6);
    }
    if (d2 < collect2) {
      if (g.kind === 'xp') { gainXP(g.value); Audio.pickup(); }
      else if (g.kind === 'gold') { gainGold(5); Audio.gold(); }
      else if (g.kind === 'heal') { player.hp = Math.min(player.maxHp, player.hp + player.maxHp * 0.3); Audio.pickup(); flashHeal(); }
      burst(g.mesh.position, g.kind === 'gold' ? 0xffd23f : (g.kind === 'heal' ? 0xff4d6d : 0x41d1ff), 5, 4, 0.2, -2);
      gemPool.release(g);
    }
  }
}
function flashHeal() { dom.flash.style.background = 'radial-gradient(circle, transparent 40%, rgba(0,255,90,.4))'; flashScreen(); setTimeout(() => { dom.flash.style.background = ''; }, 200); }

function updateParticles(dt) {
  for (const p of particles) {
    if (!p.active) continue;
    p.life -= dt;
    if (p.life <= 0) { particlePool.release(p); continue; }
    p.vel.y += p.grav * dt;
    p.mesh.position.addScaledVector(p.vel, dt);
    if (p.mesh.position.y < 0.05) { p.mesh.position.y = 0.05; p.vel.y *= -0.4; p.vel.x *= 0.7; p.vel.z *= 0.7; }
    const k = p.life / p.maxLife;
    p.mesh.scale.setScalar(p.size * k);
    p.mesh.rotation.x += dt * 8; p.mesh.rotation.y += dt * 6;
  }
}

function updateFX(dt) {
  // rings
  for (const r of ringFx) {
    if (!r.active) continue;
    r.t += dt;
    const k = r.t / 0.5;
    if (k >= 1) { r.active = false; r.mesh.visible = false; continue; }
    r.mesh.scale.setScalar(lerp(0.5, r.maxR, k));
    r.mesh.material.opacity = 0.9 * (1 - k);
  }
  // filled aura flashes
  for (const a of auraFx) {
    if (!a.active) continue;
    a.t += dt;
    const k = a.t / 0.4;
    if (k >= 1) { a.active = false; a.mesh.visible = false; continue; }
    a.mesh.scale.setScalar(lerp(0.3, a.maxR, k));
    a.mesh.material.opacity = 0.45 * (1 - k);
  }
  // zaps
  for (const z of zaps) {
    if (!z.active) continue;
    z.t -= dt;
    z.line.material.opacity = clamp(z.t / 0.12, 0, 1) * 0.9;
    if (z.t <= 0) { z.active = false; z.line.visible = false; }
  }
  // flash fade
  if (flashT > 0) { flashT -= dt; if (flashT <= 0) dom.flash.style.opacity = '0'; }
  // gems decoration spin handled in updateGems
}

function updateCamera(dt) {
  // third-person orbit: behind & above player, controlled by cam.yaw / cam.pitch
  const horiz = Math.cos(cam.pitch) * cam.dist;
  const vert = Math.sin(cam.pitch) * cam.dist;
  _v1.set(
    player.pos.x - Math.sin(cam.yaw) * horiz,
    vert,
    player.pos.z - Math.cos(cam.yaw) * horiz
  );
  // snap (no rotation lag) so the view always matches cam.yaw → camera-relative movement never feels off
  camera.position.copy(_v1);
  // shake
  if (shake > 0) {
    shake = Math.max(0, shake - dt * 2.4);
    camera.position.x += rand(-1, 1) * shake;
    camera.position.y += rand(-1, 1) * shake;
    camera.position.z += rand(-1, 1) * shake;
  }
  // look slightly ahead of the player along the camera's forward so you see where you're going
  camera.lookAt(player.pos.x + Math.sin(cam.yaw) * 6, 2.0, player.pos.z + Math.cos(cam.yaw) * 6);
  // keep sun shadow centered on player
  sun.position.set(player.pos.x + 20, 40, player.pos.z + 12);
  sun.target.position.copy(player.pos);
}

// ============================================================================
// MAIN LOOP
// ============================================================================
const clock = new THREE.Clock();
let hudTick = 0;

// one simulation step (decoupled from rendering so it can be driven deterministically)
function stepSim(dt) {
  Game.time += dt;
  Director.update(dt, Game.time);
  updatePlayer(dt);
  updateWeapons(dt);
  updateProjectiles(dt);
  updateEnemies(dt);
  updateGems(dt);
  updateParticles(dt);
  updateFX(dt);
  if (activeBoss && activeBoss.active) {
    dom.bossbar.classList.remove('hidden');
    dom.bossFill.style.transform = `scaleX(${clamp(activeBoss.hp / activeBoss.maxHp, 0, 1)})`;
  }
  if (Game.time >= CFG.runDuration) winGame();
}

function animate() {
  requestAnimationFrame(animate);
  let dt = clock.getDelta();
  dt = Math.min(dt, 0.05);

  if (Game.state === 'playing') {
    stepSim(dt);
    // timer (throttled text)
    hudTick += dt;
    if (hudTick > 0.1) { hudTick = 0; dom.timer.textContent = fmtTime(CFG.runDuration - Game.time); }
    // dash cd bar
    dom.dashFill.style.transform = `scaleX(${clamp(1 - Math.max(0, player.dash.cd) / CFG.dashCooldown, 0, 1)})`;
  } else if (Game.state === 'paused' || Game.state === 'levelup') {
    // keep particles/fx subtle? freeze sim. still update damage numbers fade lightly.
    updateParticles(dt);
    updateFX(dt);
  } else {
    updateParticles(dt);
    updateFX(dt);
  }

  updateDamageNumbers(dt);
  updateCamera(dt);
  renderer.render(scene, camera);
}

// ============================================================================
// MENU SETUP
// ============================================================================
function buildCharSelect() {
  dom.chars.innerHTML = '';
  CHARACTERS.forEach((c, i) => {
    const el = document.createElement('div');
    el.className = 'char' + (c === selectedChar ? ' sel' : '');
    el.innerHTML = `<div class="em">${c.emoji}</div><div class="nm">${c.name}</div><div class="ds">${c.desc}</div>`;
    el.onclick = () => { selectedChar = c; buildCharSelect(); };
    dom.chars.appendChild(el);
  });
}
buildCharSelect();
dom.play.onclick = () => { Audio.resume(); startGame(selectedChar); };

// build an idle preview player on the menu
buildPlayerMesh(selectedChar);
player.group.position.set(0, 0, 0);

animate();

// expose for debugging / deterministic testing
window.__game = {
  Game, player, enemies, projectiles, gems, CFG, cam, camera, startGame, chooseCard, applyCard, PASSIVES, WEAPONS,
  setKeys: (obj) => { Object.assign(keys, obj); },
  tick: (dt = 1 / 60, n = 1) => { for (let i = 0; i < n; i++) if (Game.state === 'playing') stepSim(dt); },
  renderOnce: () => { updateCamera(1); renderer.render(scene, camera); },
};
