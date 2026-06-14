/* MEGABONK: PIXEL CRYPT — headless balance simulator.
 * Loads the real game-logic modules (core/player/weapons/enemies/upgrades/shop)
 * with browser stubs and runs full simulated runs with an AI pilot, so we can
 * batch thousands of games and gather balance statistics. NOT shipped to players.
 *
 *   node tools/sim.js <numRuns> [seedOffset]   (defaults: 200, 0)
 * Prints one JSON line per aggregate (and per-run JSONL on stderr if VERBOSE).
 */
'use strict';
const fs = require('fs');
const path = require('path');

/* ------------------------------------------------------------------ *
 * Browser stubs — enough for the LOGIC modules to load + update.
 * ------------------------------------------------------------------ */
const noop = () => {};
const fakeCtx = new Proxy({}, { get: () => () => fakeCtx, set: () => true });
global.window = global;
global.document = {
  createElement: () => ({ getContext: () => fakeCtx, width: 16, height: 16, style: {}, appendChild: noop }),
  getElementById: () => null,
  addEventListener: noop,
  body: { appendChild: noop },
};
global.performance = global.performance || { now: () => Date.now() };
global.requestAnimationFrame = () => 0;
const _ls = {};
global.localStorage = {
  getItem: (k) => (k in _ls ? _ls[k] : null),
  setItem: (k, v) => { _ls[k] = '' + v; },
  removeItem: (k) => { delete _ls[k]; },
};

const SRC = path.join(__dirname, '..', 'src');
function load(name) { eval(fs.readFileSync(path.join(SRC, name), 'utf8')); }

// order: core first; only the logic modules needed for a run
['core.js', 'player.js', 'weapons.js', 'enemies.js', 'upgrades.js', 'shop.js'].forEach(load);
const MB = global.MB;

/* ------------------------------------------------------------------ *
 * Stub the unloaded modules the update path may (guardedly) touch.
 * ------------------------------------------------------------------ */
const FAKE_SPRITE = { width: 16, height: 16 };
MB.Sprites = { get: () => FAKE_SPRITE, getWhite: () => FAKE_SPRITE, icon: () => FAKE_SPRITE, groundTile: () => FAKE_SPRITE, preload: noop };
MB.Audio = { sfx: noop, init: noop, startMusic: noop, stopMusic: noop, setMuted: noop, muted: false };
MB.UI = { toast: noop, showBossWarning: noop, showLevelUp: noop, updateHUD: noop, _pickByIndex: noop, init: noop, showStart: noop, hideStart: noop, showGameOver: noop, showVictory: noop };

const SIM = { pending: 0, dead: false, won: false, cause: null };
MB.Main = {
  queueLevelUp: () => { SIM.pending++; },
  afterLevelUp: noop,
  gameOver: () => { if (!SIM.dead && !SIM.won) { SIM.dead = true; SIM.cause = 'killed'; } },
  victory: () => { SIM.won = true; SIM.cause = 'victory'; },
  restart: noop, init: noop,
};

/* ------------------------------------------------------------------ *
 * AI pilot + level-up strategies
 * ------------------------------------------------------------------ */
function aiInput(p, enemies, skill) {
  // Skilled survivors kiting: ORBIT the threat centroid at medium range so the
  // weapons keep mowing the swarm (XP farm) while avoiding contact.
  let fx = 0, fy = 0, near = 0, nd = 1e18;
  for (let i = 0; i < enemies.length; i++) {
    const e = enemies[i]; if (e.dead) continue;
    const dx = p.x - e.x, dy = p.y - e.y, d2 = dx * dx + dy * dy;
    if (d2 < nd) nd = d2;
    if (d2 < 260 * 260) { const d = Math.sqrt(d2) || 1; const w = 1 / (d + 12); fx += dx / d * w; fy += dy / d * w; near++; }
  }
  const nearest = Math.sqrt(nd);
  let dx, dy;
  if (near > 0) {
    const l = Math.hypot(fx, fy) || 1; const ax = fx / l, ay = fy / l;   // unit away-from-threat
    if (nearest < 110) { dx = ax - ay * 0.6; dy = ay + ax * 0.6; }        // back out + circle when close
    else { dx = -ax * 0.6; dy = -ay * 0.6; }                             // dive INTO the swarm to farm XP
  } else { dx = Math.cos(p.x * 0.005 + p.y * 0.003); dy = Math.sin(p.y * 0.005 - p.x * 0.002); }
  if (Math.random() > skill) { dx += (Math.random() - 0.5) * 1.0; dy += (Math.random() - 0.5) * 1.0; }
  const t = 0.30;
  return { up: dy < -t, down: dy > t, left: dx < -t, right: dx > t };
}

function pickOption(opts, strat, frameRand, p) {
  if (!opts || !opts.length) return null;
  function find(pred) { for (let i = 0; i < opts.length; i++) if (pred(opts[i])) return opts[i]; return null; }
  const wc = p ? p.weapons.length : 6;
  // passives that some owned weapon evolves with (so 'focus' can chase evolutions)
  let evoPass = null;
  if (p && MB.Weapons && MB.Weapons.DEFS) {
    evoPass = {};
    for (const w of p.weapons) { const d = w.def || MB.Weapons.DEFS[w.id]; if (d && d.evolvePassive) evoPass[d.evolvePassive] = 1; }
  }
  let o = null;
  if (strat === 'dps') {
    o = find(x => x.kind === 'weapon' && x.isNew) || find(x => x.kind === 'weapon')
      || find(x => x.kind === 'stat' && /Damage|Attack|Area|Projectile/.test(x.text || ''))
      || find(x => x.kind === 'passive');
  } else if (strat === 'survival') {
    o = find(x => /Max HP|Armor|Regen|Move Speed/.test((x.text || '') + (x.name || '')))
      || find(x => x.kind === 'weapon' && x.isNew) || find(x => x.kind === 'weapon');
  } else if (strat === 'balanced') {
    o = ((frameRand & 1) ? find(x => x.kind === 'weapon') : find(x => /HP|Armor|Speed|Regen/.test((x.text || '') + (x.name || ''))))
      || find(x => x.kind === 'weapon' && x.isNew);
  } else if (strat === 'focus') {
    // a skilled build: keep ≤4 weapons, MAX them, grab their evolution passives
    o = find(x => x.kind === 'weapon' && !x.isNew)                          // level owned weapons toward max
      || (evoPass && find(x => x.kind === 'passive' && evoPass[x.id]))      // grab evolution catalyst passive
      || (wc < 4 ? find(x => x.kind === 'weapon' && x.isNew) : null)         // a few weapons only
      || find(x => x.kind === 'passive')
      || find(x => x.kind === 'stat' && /Damage|Max HP|Armor/.test(x.text || ''));
  }
  return o || opts[(Math.random() * opts.length) | 0];
}

/* ------------------------------------------------------------------ *
 * One run
 * ------------------------------------------------------------------ */
const DT = 1 / 30;                 // coarse sim step (statistical)
const MAX_T = 20 * 60;             // hard cap (s) — beyond reaper anyway

function runOnce(charId, strat, skill, shopLevels) {
  SIM.pending = 0; SIM.dead = false; SIM.won = false; SIM.cause = null;
  for (const k in _ls) delete _ls[k];
  // inject meta-shop progression for this run
  if (shopLevels) localStorage.setItem('mb_shop_v1', JSON.stringify({ wallet: 0, levels: shopLevels }));

  MB.reset();
  const S = MB.State;
  S.screen = { w: 1280, h: 720, cx: 640, cy: 360 };
  S.scene = 'playing';
  const charDef = MB.CHARACTERS.find(c => c.id === charId) || MB.CHARACTERS[0];
  S.char = charDef;
  const p = new MB.Player(charDef);
  S.player = p;
  if (MB.Weapon && charDef.startWeapon) p.weapons.push(new MB.Weapon(charDef.startWeapon));
  MB.Upgrades.recomputeStats(p);
  MB.Enemies.startRun();

  let maxEnemies = 0, chestsOpened = 0, evolves = 0, frame = 0;
  const grid = S.grid;
  const startWeapons = p.weapons.length;

  while (!SIM.dead && !SIM.won && S.time < MAX_T) {
    S.time += DT; S.frame = ++frame;
    grid.clear();
    const en = S.enemies;
    for (let i = 0; i < en.length; i++) if (!en[i].dead) grid.insert(en[i]);
    p.update(DT, aiInput(p, en, skill));
    MB.Enemies.update(DT, p);
    for (let i = 0; i < en.length; i++) { const e = en[i]; if (!e.dead && e.update) e.update(DT, p); }
    const pr = S.projectiles;
    for (let i = 0; i < pr.length; i++) { const q = pr[i]; if (q && !q.dead && q.update) q.update(DT); }
    MB.updateWorldFX(DT, p);
    p.handleContacts(en);
    if (en.length > maxEnemies) maxEnemies = en.length;
    MB.cull(en); MB.cull(pr);

    // resolve level-ups (mirror main, applied instantly)
    let guard = 0;
    while (SIM.pending > 0 && guard++ < 50) {
      SIM.pending--;
      const opts = MB.Upgrades.rollOptions(p);
      const choice = pickOption(opts, strat, frame, p);
      if (choice) MB.Upgrades.apply(p, choice);
    }
    // open chests the AI walked over already handled via pickups; count via gold/evos below
  }

  evolves = p.weapons.filter(w => w.evolved || (w.def && w.def.isEvolved)).length;
  return {
    char: charId, strat, skill: +skill.toFixed(2),
    time: +S.time.toFixed(1), level: p.level, kills: S.kills, gold: S.gold,
    weapons: p.weapons.length, newWeapons: p.weapons.length - startWeapons, evolves,
    maxEnemies, won: SIM.won, cause: SIM.cause || (S.time >= MAX_T ? 'timeout' : 'alive'),
    passives: Object.keys(p.passives || {}).length,
    shards: Object.keys(p.statShards || {}).length,
    finalMaxHp: Math.round(p.maxHp), finalMight: +p.might.toFixed(2),
  };
}

/* ------------------------------------------------------------------ *
 * Batch
 * ------------------------------------------------------------------ */
const N = parseInt(process.argv[2] || '200', 10);
const seedOff = parseInt(process.argv[3] || '0', 10);
const CHARS = ['bonker', 'hexe', 'revenant'];
const STRATS = ['focus', 'dps', 'survival', 'balanced'];
const VERBOSE = process.env.VERBOSE === '1';

const results = [];
for (let i = 0; i < N; i++) {
  const charId = CHARS[(i + seedOff) % CHARS.length];
  const strat = STRATS[((i + seedOff) / CHARS.length | 0) % STRATS.length];
  const skill = 0.45 + Math.random() * 0.5;
  // ~40% of runs carry some meta-shop progression
  let shop = null;
  if (Math.random() < 0.4) {
    shop = { might: (Math.random() * 6) | 0, maxHp: (Math.random() * 6) | 0, armor: (Math.random() * 4) | 0,
             speed: (Math.random() * 4) | 0, cooldownMult: (Math.random() * 4) | 0, amount: (Math.random() * 2) | 0 };
  }
  const r = runOnce(charId, strat, skill, shop);
  r.shop = shop ? 1 : 0;
  results.push(r);
  if (VERBOSE) process.stderr.write(JSON.stringify(r) + '\n');
}
process.stdout.write(JSON.stringify(results) + '\n');
