/* MEGABONK: PIXEL CRYPT — world.js
 * MB.World — makes the empty crypt interesting: a procedurally generated FIELD
 * of gothic structures (graveyard clusters, castle ruins) plus interactive
 * ALTARS that grant permanent hero blessings.
 *
 * Self-contained. Draws castles/altars PROCEDURALLY with canvas ops; reuses
 * existing decor sprites ('tombstone','cross','deadtree','skull') only via
 * MB.drawNamed. Builds its OWN scoped DOM overlay (classes prefixed 'mbw-').
 *
 * Every cross-module reference is made at CALL TIME via MB.* and guarded so a
 * missing / late module never throws. Never throws on load or during play.
 *
 * Public API:
 *   MB.World.startRun(player)  — scatter the initial field + altars (call in startGame)
 *   MB.World.reset()           — clear all world state + close any open overlay
 *   MB.World.update(dt, player)— grow the field as the player explores; trigger altars
 *   MB.World.draw(ctx)         — draw structures (call AFTER ground, BEFORE entities)
 *   MB.World._pickAltar(i)     — choose blessing i (1-based) from the open altar overlay
 */
(function (MB) {
  'use strict';

  var TAU = Math.PI * 2;

  /* ------------------------------------------------------------------ *
   * Tuning
   * ------------------------------------------------------------------ */
  var CHUNK = 640;          // world px per generation chunk
  var INIT_R = 3;           // chunks generated around origin at startRun (~4500px field)
  var EXPLORE_R = 2;        // chunks kept generated around the player as they roam
  var INIT_ALTARS = 12;     // minimum altars seeded at startRun
  var MAX_ALTARS = 24;      // cap on LIVE (unconsumed) altars
  var TRIGGER_R = 22;       // world px: walk this close to a live altar to invoke it
  var ALTAR_SPAWN_MIN = 25; // seconds between fresh "explore reward" altars
  var ALTAR_SPAWN_MAX = 40;
  var ALTAR_NEAR_MIN = 300; // offset of a fresh altar from the player
  var ALTAR_NEAR_MAX = 700;

  /* ------------------------------------------------------------------ *
   * Palette (gothic grey stone + themed altar glows)
   * ------------------------------------------------------------------ */
  var STONE   = '#6d6a7c';
  var STONE_L = '#8a8799';
  var STONE_D = '#4c4858';
  var STONE_DD = '#322e3c';
  var WIN     = '#0d0a14';

  // altar themes: [glow, mid, core, runeBase]
  var THEMES = [
    ['#ff5a6e', '#e6313d', '#ffd6db', '#b5202a'], // blood-red
    ['#b58cff', '#7a52c4', '#e9dcff', '#5a3a78'], // bruise-purple
    ['#ffe08a', '#f2c14e', '#fff6d0', '#caa23a']  // gold
  ];

  var GRAVE_SPRITES = ['tombstone', 'tombstone', 'cross', 'cross', 'deadtree', 'skull'];

  /* ------------------------------------------------------------------ *
   * State
   * ------------------------------------------------------------------ */
  var _altars = [];         // { x, y, theme, phase, consumed }
  var _ruins  = [];         // { x, y, w, h, variant, towerSide, windows:[] }
  var _props  = [];         // { x, y, sprite }  graveyard decor
  var _chunks = Object.create(null);  // generated chunk keys

  var _altarTimer = 30;
  var _cleanT = 3;

  // overlay / interaction
  var _overlayOpen = false;
  var _overlayEl = null;
  var _choices = null;
  var _activeAltar = null;
  var _activePlayer = null;

  // recompute wrap
  var _origRecompute = null;

  /* ================================================================== *
   * Permanent altar buff store + recompute wrapping
   * ================================================================== */
  // Each buff mutates the player's cumulative _altar store; the wrapped
  // recompute re-applies that store after upgrades.js resets stats, so altar
  // blessings persist across level-ups WITHOUT editing upgrades.js.
  var BUFFS = [
    { id: 'might',  name: 'Might',     glyph: '†', text: 'Damage +12%',          store: function (a) { a.might *= 1.12; } },
    { id: 'speed',  name: 'Swiftness', glyph: '»', text: 'Move Speed +10%',      store: function (a) { a.speed *= 1.10; } },
    { id: 'haste',  name: 'Frenzy',    glyph: '≫', text: 'Attack Speed +8%',     store: function (a) { a.cooldownMult *= 0.92; } },
    { id: 'vita',   name: 'Vitality',  glyph: '♥', text: 'Max HP +25',           store: function (a) { a.maxHp += 25; }, heal: 25 },
    { id: 'area',   name: 'Reach',     glyph: '◉', text: 'Area +12%',            store: function (a) { a.area *= 1.12; } },
    { id: 'magnet', name: 'Avarice',   glyph: '∪', text: 'Magnet +30%',          store: function (a) { a.magnet *= 1.30; } },
    { id: 'growth', name: 'Wisdom',    glyph: '✦', text: 'XP Gain +12%',         store: function (a) { a.growth *= 1.12; } },
    { id: 'luck',   name: 'Fortune',   glyph: '♣', text: 'Luck +15%',            store: function (a) { a.luck *= 1.15; } },
    { id: 'armor',  name: 'Bulwark',   glyph: '▣', text: 'Armor +2',             store: function (a) { a.armor += 2; } },
    { id: 'amount', name: 'Echo',      glyph: '⁂', text: '+1 Projectile',        store: function (a) { a.amount += 1; }, rare: true },
    { id: 'proj',   name: 'Velocity',  glyph: '➤', text: 'Projectile Speed +12%', store: function (a) { a.projSpeed *= 1.12; } },
    { id: 'regen',  name: 'Renewal',   glyph: '✚', text: 'Regen +0.6/s',         store: function (a) { a.regen += 0.6; } }
  ];

  function ensureAltarStore(player) {
    if (!player) return;
    if (!player._altar) {
      player._altar = {
        might: 1, area: 1, cooldownMult: 1, projSpeed: 1, speed: 1,
        magnet: 1, growth: 1, luck: 1, armor: 0, amount: 0, maxHp: 0, regen: 0
      };
      player._altarPrevMax = player.maxHp || 100;
    }
    installRecomputeWrap();
  }

  function installRecomputeWrap() {
    var U = MB.Upgrades;
    if (!U || typeof U.recomputeStats !== 'function') return;
    if (U.__altarWrapped) return;

    _origRecompute = U.recomputeStats;
    U.recomputeStats = function (player) {
      // No altar store yet → behave exactly like the original.
      if (!player || !player._altar) { _origRecompute(player); return; }

      // Capture hp ratio against the FULL (altar-inclusive) max we last made,
      // so a level-up recompute never silently drains bonus HP.
      var ratio = null;
      var prevFull = player._altarPrevMax;
      if (prevFull && prevFull > 0) ratio = MB.clamp((player.hp || 0) / prevFull, 0, 1);

      // canonical writer: resets stats to base + passives, sets hp/_prevMaxHp.
      _origRecompute(player);

      // re-apply cumulative altar blessings on top.
      var a = player._altar;
      player.might *= a.might;
      player.area *= a.area;
      player.cooldownMult *= a.cooldownMult;
      player.projSpeed *= a.projSpeed;
      player.speed *= a.speed;
      player.magnet *= a.magnet;
      player.growth *= a.growth;
      player.luck *= a.luck;
      player.armor += a.armor;
      player.amount += a.amount;
      player.regen += a.regen;
      if (a.maxHp) player.maxHp += a.maxHp;

      // re-clamp the floors the original enforces.
      if (player.cooldownMult < 0.4) player.cooldownMult = 0.4;
      if (player.speed < 0.4) player.speed = 0.4;
      if (player.duration < 0.5) player.duration = 0.5;
      if (player.amount < 0) player.amount = 0;
      player.maxHp = Math.round(player.maxHp);
      if (player.maxHp < 1) player.maxHp = 1;

      // restore hp against the full max (or just clamp on the very first pass).
      if (ratio !== null) {
        var hp = Math.round(player.maxHp * ratio);
        if (hp > player.maxHp) hp = player.maxHp;
        if (hp < 0) hp = 0;
        if (hp <= 0 && ratio > 0 && player.hp > 0) hp = 1; // don't tweak a living hero to a corpse
        player.hp = hp;
      } else if (player.hp > player.maxHp) {
        player.hp = player.maxHp;
      }

      player._altarPrevMax = player.maxHp;
    };
    U.__altarWrapped = true;
  }

  function applyBuff(player, buff) {
    if (!player || !buff) return;
    ensureAltarStore(player);
    if (buff.store) buff.store(player._altar);
    if (MB.Upgrades && MB.Upgrades.recomputeStats) MB.Upgrades.recomputeStats(player);
    if (buff.heal && player.heal) player.heal(buff.heal);
  }

  function rollBuffs() {
    var pool = [];
    for (var i = 0; i < BUFFS.length; i++) {
      var b = BUFFS[i];
      if (b.rare && Math.random() >= 0.25) continue; // demote rare picks
      pool.push(b);
    }
    // Fisher–Yates shuffle
    for (var j = pool.length - 1; j > 0; j--) {
      var k = (Math.random() * (j + 1)) | 0;
      var t = pool[j]; pool[j] = pool[k]; pool[k] = t;
    }
    return pool.slice(0, 3);
  }

  /* ================================================================== *
   * Field generation
   * ================================================================== */
  function liveAltarCount() {
    var n = 0;
    for (var i = 0; i < _altars.length; i++) if (!_altars[i].consumed) n++;
    return n;
  }

  function addAltar(x, y) {
    _altars.push({
      x: x, y: y,
      theme: MB.randInt(0, THEMES.length - 1),
      phase: Math.random() * TAU,
      consumed: false
    });
  }

  function addGraveyard(cx, cy) {
    var n = MB.randInt(5, 9);
    var tmp = [];
    for (var i = 0; i < n; i++) {
      var a = Math.random() * TAU;
      var rr = MB.rand(0, 62);
      tmp.push({
        x: cx + Math.cos(a) * rr,
        y: cy + Math.sin(a) * rr * 0.7,
        sprite: MB.pick(GRAVE_SPRITES)
      });
    }
    tmp.sort(function (p, q) { return p.y - q.y; }); // crude within-cluster y-order
    for (var j = 0; j < tmp.length; j++) _props.push(tmp[j]);
  }

  function addRuin(x, y) {
    var w = MB.rand(54, 96);
    var h = MB.rand(38, 64);
    var variant = MB.randInt(0, 2);
    var towerSide = MB.chance(0.5) ? -1 : 1;
    var windows = [];
    var nW = MB.randInt(1, 3);
    for (var i = 0; i < nW; i++) {
      var ww = MB.rand(7, 11);
      var wh = MB.rand(10, 16);
      windows.push({
        x: MB.rand(-w / 2 + 8, w / 2 - 8 - ww),  // relative to centre
        y: -h + MB.rand(7, h * 0.5),             // relative to ground (negative = up)
        w: ww, h: wh
      });
    }
    _ruins.push({ x: x, y: y, w: w, h: h, variant: variant, towerSide: towerSide, windows: windows });
  }

  function generateChunk(cx, cy) {
    var key = cx + ',' + cy;
    if (_chunks[key]) return;
    _chunks[key] = true;

    var x0 = cx * CHUNK, y0 = cy * CHUNK;
    var ccx = x0 + CHUNK / 2, ccy = y0 + CHUNK / 2;
    var dOrigin = Math.sqrt(ccx * ccx + ccy * ccy);

    // graveyard cluster (sparser right at the spawn point)
    if (Math.random() < (dOrigin < 300 ? 0.20 : 0.60)) {
      var gx = x0 + MB.rand(80, CHUNK - 80);
      var gy = y0 + MB.rand(80, CHUNK - 80);
      if (gx * gx + gy * gy > 130 * 130) addGraveyard(gx, gy);
    }

    // castle ruin
    if (Math.random() < (dOrigin < 400 ? 0.0 : 0.28)) {
      var rx = x0 + MB.rand(110, CHUNK - 110);
      var ry = y0 + MB.rand(110, CHUNK - 110);
      if (rx * rx + ry * ry > 260 * 260) addRuin(rx, ry);
    }

    // an occasional exploration altar (respect the live cap)
    if (Math.random() < 0.18 && liveAltarCount() < MAX_ALTARS) {
      var ax = x0 + MB.rand(90, CHUNK - 90);
      var ay = y0 + MB.rand(90, CHUNK - 90);
      if (ax * ax + ay * ay > 220 * 220) addAltar(ax, ay);
    }
  }

  function ensureChunksAround(wx, wy, r) {
    var pcx = Math.floor(wx / CHUNK), pcy = Math.floor(wy / CHUNK);
    for (var dx = -r; dx <= r; dx++) {
      for (var dy = -r; dy <= r; dy++) generateChunk(pcx + dx, pcy + dy);
    }
  }

  // drop spent altars that drift far away so the array stays small.
  function cleanupAltars(player) {
    if (!player) return;
    var w = 0, far = 1800 * 1800;
    for (var i = 0; i < _altars.length; i++) {
      var al = _altars[i];
      if (al.consumed && MB.dist2(al.x, al.y, player.x, player.y) > far) continue;
      _altars[w++] = al;
    }
    _altars.length = w;
  }

  /* ================================================================== *
   * Altar interaction
   * ================================================================== */
  function triggerAltar(altar, player) {
    if (_overlayOpen || !altar || !player) return;
    if (!MB.State) return;

    _overlayOpen = true;
    _activeAltar = altar;
    _activePlayer = player;
    _choices = rollBuffs();

    MB.State.scene = 'altar';   // freezes the sim (main only steps in 'playing')
    if (MB.Audio && MB.Audio.sfx) MB.Audio.sfx('chest');
    if (MB.spawnParticles) MB.spawnParticles(altar.x, altar.y - 12, '#ffe9a8', 12, { speed: 90, life: 0.6, size: 2, gravity: -20 });

    buildOverlay();
    window.addEventListener('keydown', onOverlayKey, true);
  }

  function _pickAltar(i) {
    if (!_overlayOpen || !_choices) return;        // guard double-pick
    var idx = (i | 0) - 1;
    if (idx < 0 || idx >= _choices.length) return;

    var buff = _choices[idx];
    var player = _activePlayer || (MB.State && MB.State.player);
    var al = _activeAltar;

    applyBuff(player, buff);

    if (al) {
      al.consumed = true;
      if (MB.spawnParticles) {
        MB.spawnParticles(al.x, al.y - 12, '#ffe9a8', 34, { speed: 170, life: 0.95, size: 2, gravity: -30 });
        MB.spawnParticles(al.x, al.y - 8, '#f2c14e', 18, { speed: 110, life: 0.7, size: 2 });
      }
      if (MB.spawnDamageText) MB.spawnDamageText(al.x, al.y - 26, buff.text, '#ffe9a8');
    }
    if (MB.Audio && MB.Audio.sfx) MB.Audio.sfx('levelup');
    if (MB.shake) MB.shake(6);

    closeOverlay();
    if (MB.State) MB.State.scene = 'playing';      // unfreeze the sim
  }

  function onOverlayKey(e) {
    var c = e.code, n = 0;
    if (c === 'Digit1' || c === 'Numpad1') n = 1;
    else if (c === 'Digit2' || c === 'Numpad2') n = 2;
    else if (c === 'Digit3' || c === 'Numpad3') n = 3;
    else {
      var k = e.key;
      if (k === '1') n = 1; else if (k === '2') n = 2; else if (k === '3') n = 3;
    }
    if (n > 0) {
      if (e.preventDefault) e.preventDefault();
      if (e.stopPropagation) e.stopPropagation();
      _pickAltar(n);
    }
  }

  /* ---------------------- scoped DOM overlay ------------------------ */
  var CSS = [
    '.mbw-overlay{position:fixed;inset:0;z-index:50;display:flex;align-items:center;justify-content:center;',
    'pointer-events:auto;font-family:"Courier New","Courier",Monaco,monospace;color:#e8e6d8;',
    'background:radial-gradient(ellipse at 50% 34%,rgba(181,32,42,.18),transparent 60%),',
    'radial-gradient(ellipse at 50% 120%,rgba(90,58,120,.22),transparent 55%),',
    'linear-gradient(rgba(7,5,11,.74),rgba(7,5,11,.88));animation:mbw-fade .25s ease-out;}',
    '.mbw-frame{width:min(960px,94vw);display:flex;flex-direction:column;align-items:center;gap:14px;padding:18px;text-align:center;}',
    '.mbw-crest{font-size:clamp(16px,3vw,26px);letter-spacing:8px;color:#b5202a;text-shadow:0 0 16px rgba(181,32,42,.8);padding-left:8px;}',
    '.mbw-title{margin:0;font-size:clamp(28px,6vw,60px);font-weight:700;letter-spacing:clamp(2px,1vw,10px);',
    'text-transform:uppercase;color:#f2c14e;text-shadow:3px 3px 0 #000,0 0 26px rgba(242,193,78,.55);',
    'animation:mbw-pop .4s cubic-bezier(.2,1.4,.5,1) both;}',
    '.mbw-sub{font-size:clamp(11px,1.6vw,15px);letter-spacing:3px;color:#b9b6a6;text-transform:uppercase;margin-top:-6px;}',
    '.mbw-cards{display:flex;flex-wrap:wrap;justify-content:center;gap:clamp(10px,1.4vw,18px);width:100%;margin-top:6px;}',
    '.mbw-card{position:relative;display:flex;flex-direction:column;align-items:center;gap:8px;',
    'width:clamp(180px,26vw,240px);padding:20px 14px;cursor:pointer;color:#e8e6d8;font-family:inherit;',
    'background:linear-gradient(180deg,rgba(46,32,58,.72),rgba(14,10,22,.96));border:2px solid #6e1119;',
    'border-radius:4px;box-shadow:4px 4px 0 rgba(0,0,0,.55);outline:none;',
    'transition:transform .12s ease,box-shadow .12s ease,border-color .12s ease;animation:mbw-in .26s ease-out both;}',
    '.mbw-card::before{content:"";position:absolute;inset:4px;border:1px dashed rgba(242,193,78,.22);border-radius:2px;pointer-events:none;}',
    '.mbw-card:hover,.mbw-card:focus-visible{transform:translateY(-6px);border-color:#e6313d;',
    'box-shadow:0 10px 0 rgba(0,0,0,.5),0 0 26px rgba(181,32,42,.55);}',
    '.mbw-key{position:absolute;top:-12px;left:-12px;width:26px;height:26px;line-height:24px;text-align:center;',
    'font-size:14px;font-weight:700;color:#0b0813;background:#f2c14e;border:2px solid #000;border-radius:3px;box-shadow:2px 2px 0 rgba(0,0,0,.5);}',
    '.mbw-glyph{font-size:40px;line-height:1;color:#f2c14e;text-shadow:0 0 14px rgba(242,193,78,.6),2px 2px 0 #000;}',
    '.mbw-name{font-size:clamp(14px,1.7vw,19px);font-weight:700;letter-spacing:1px;text-transform:uppercase;text-shadow:2px 2px 0 #000;}',
    '.mbw-effect{font-size:clamp(11px,1.2vw,13.5px);letter-spacing:1px;color:#e8c98a;}',
    '.mbw-hint{margin-top:6px;font-size:clamp(10px,1.2vw,13px);letter-spacing:2px;color:#6d6a7c;text-transform:uppercase;}',
    '@keyframes mbw-fade{from{opacity:0}to{opacity:1}}',
    '@keyframes mbw-pop{0%{transform:scale(.5) translateY(-10px);opacity:0}100%{transform:scale(1) translateY(0);opacity:1}}',
    '@keyframes mbw-in{0%{transform:translateY(14px);opacity:0}100%{transform:translateY(0);opacity:1}}',
    '@media (prefers-reduced-motion:reduce){.mbw-card,.mbw-title,.mbw-overlay{animation:none!important}}'
  ].join('');

  function injectStyle() {
    if (typeof document === 'undefined') return;
    if (document.getElementById('mbw-style')) return;
    var s = document.createElement('style');
    s.id = 'mbw-style';
    s.textContent = CSS;
    (document.head || document.documentElement).appendChild(s);
  }

  function makeCard(buff, i) {
    var card = document.createElement('button');
    card.className = 'mbw-card';
    card.type = 'button';

    var key = document.createElement('div'); key.className = 'mbw-key'; key.textContent = '' + (i + 1);
    var glyph = document.createElement('div'); glyph.className = 'mbw-glyph'; glyph.textContent = buff.glyph;
    var name = document.createElement('div'); name.className = 'mbw-name'; name.textContent = buff.name;
    var eff = document.createElement('div'); eff.className = 'mbw-effect'; eff.textContent = buff.text;

    card.appendChild(key); card.appendChild(glyph); card.appendChild(name); card.appendChild(eff);
    card.addEventListener('click', function () { _pickAltar(i + 1); });
    return card;
  }

  function buildOverlay() {
    if (typeof document === 'undefined') return;
    injectStyle();
    var root = document.getElementById('ui-root') || document.body;
    if (!root) return;

    var ov = document.createElement('div');
    ov.className = 'mbw-overlay';
    ov.id = 'mbw-overlay';

    var frame = document.createElement('div'); frame.className = 'mbw-frame';

    var crest = document.createElement('div'); crest.className = 'mbw-crest'; crest.textContent = '† † †';
    var title = document.createElement('h2'); title.className = 'mbw-title';
    title.textContent = MB.pick(['An Altar Calls', 'Dark Blessing', 'A Cursed Boon']);
    var sub = document.createElement('div'); sub.className = 'mbw-sub'; sub.textContent = 'Choose one — the grave gives back';

    var cards = document.createElement('div'); cards.className = 'mbw-cards';
    for (var i = 0; i < _choices.length; i++) cards.appendChild(makeCard(_choices[i], i));

    var hint = document.createElement('div'); hint.className = 'mbw-hint'; hint.textContent = 'Press  1 · 2 · 3';

    frame.appendChild(crest); frame.appendChild(title); frame.appendChild(sub);
    frame.appendChild(cards); frame.appendChild(hint);
    ov.appendChild(frame);
    root.appendChild(ov);
    _overlayEl = ov;
  }

  function closeOverlay() {
    if (typeof window !== 'undefined') window.removeEventListener('keydown', onOverlayKey, true);
    if (_overlayEl && _overlayEl.parentNode) _overlayEl.parentNode.removeChild(_overlayEl);
    _overlayEl = null;
    _overlayOpen = false;
    _choices = null;
    _activeAltar = null;
    _activePlayer = null;
  }

  /* ================================================================== *
   * Public lifecycle
   * ================================================================== */
  function reset() {
    _altars.length = 0;
    _ruins.length = 0;
    _props.length = 0;
    _chunks = Object.create(null);
    _altarTimer = MB.rand(ALTAR_SPAWN_MIN, ALTAR_SPAWN_MAX);
    _cleanT = 3;
    if (_overlayOpen) closeOverlay();
  }

  function startRun(player) {
    reset();
    if (player) ensureAltarStore(player);

    // seed the initial field around the origin
    ensureChunksAround(0, 0, INIT_R);

    // guarantee a spread of altars to reward early exploration
    var guard = 0;
    while (liveAltarCount() < INIT_ALTARS && guard++ < 80) {
      var a = Math.random() * TAU;
      var d = MB.rand(360, 1700);
      addAltar(Math.cos(a) * d, Math.sin(a) * d);
    }
  }

  function update(dt, player) {
    if (!player || !MB.State) return;
    if (MB.State.scene !== 'playing') return;       // frozen while overlay (or any non-play) is up

    // keep the field populated as the hero roams
    ensureChunksAround(player.x, player.y, EXPLORE_R);

    // drop a fresh altar near the player every so often
    _altarTimer -= dt;
    if (_altarTimer <= 0) {
      _altarTimer = MB.rand(ALTAR_SPAWN_MIN, ALTAR_SPAWN_MAX);
      if (liveAltarCount() < MAX_ALTARS) {
        var a = Math.random() * TAU;
        var d = MB.rand(ALTAR_NEAR_MIN, ALTAR_NEAR_MAX);
        addAltar(player.x + Math.cos(a) * d, player.y + Math.sin(a) * d);
      }
    }

    // periodic spent-altar cleanup
    _cleanT -= dt;
    if (_cleanT <= 0) { _cleanT = 3; cleanupAltars(player); }

    // proximity trigger (altars are few; a plain loop is cheap)
    if (!_overlayOpen) {
      var rr = TRIGGER_R * TRIGGER_R;
      for (var i = 0; i < _altars.length; i++) {
        var al = _altars[i];
        if (al.consumed) continue;
        if (MB.dist2(al.x, al.y, player.x, player.y) <= rr) {
          triggerAltar(al, player);
          break;
        }
      }
    }
  }

  /* ================================================================== *
   * Drawing — world-space procedural structures (culled off-screen)
   * ================================================================== */
  function fillWorldRect(ctx, wx, wy, ww, wh, color) {
    var sc = MB.VIEW_SCALE;
    var p = MB.cam.worldToScreen(wx, wy);
    ctx.fillStyle = color;
    ctx.fillRect(Math.round(p.sx), Math.round(p.sy),
      Math.max(1, Math.round(ww * sc)), Math.max(1, Math.round(wh * sc)));
  }

  function groundShadow(ctx, wx, wy, rwWorld) {
    var p = MB.cam.worldToScreen(wx, wy);
    var rw = rwWorld * MB.VIEW_SCALE;
    ctx.save();
    ctx.globalAlpha = 0.25;
    ctx.fillStyle = '#000';
    ctx.beginPath();
    if (ctx.ellipse) ctx.ellipse(p.sx, p.sy, rw, rw * 0.4, 0, 0, TAU);
    else ctx.fillRect(p.sx - rw, p.sy - rw * 0.4, rw * 2, rw * 0.8);
    ctx.fill();
    ctx.restore();
  }

  function drawDiamond(ctx, wx, wy, hwWorld, hhWorld, color) {
    var sc = MB.VIEW_SCALE;
    var p = MB.cam.worldToScreen(wx, wy);
    var hw = hwWorld * sc, hh = hhWorld * sc;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(p.sx, p.sy - hh);
    ctx.lineTo(p.sx + hw, p.sy);
    ctx.lineTo(p.sx, p.sy + hh);
    ctx.lineTo(p.sx - hw, p.sy);
    ctx.closePath();
    ctx.fill();
  }

  function drawRuin(ctx, r) {
    var leftX = r.x - r.w / 2;
    var topY = r.y - r.h;

    groundShadow(ctx, r.x, r.y, r.w * 0.55);

    // body + shading strips
    fillWorldRect(ctx, leftX, topY, r.w, r.h, STONE);
    fillWorldRect(ctx, leftX, topY, Math.max(2, r.w * 0.10), r.h, STONE_L);
    fillWorldRect(ctx, leftX + r.w * 0.80, topY, r.w * 0.20, r.h, STONE_D);

    // mortar courses
    for (var cy = topY + 8; cy < r.y - 1; cy += 8) fillWorldRect(ctx, leftX, cy, r.w, 1, STONE_DD);
    fillWorldRect(ctx, leftX + r.w * 0.5, topY, 1, r.h, STONE_DD);

    // crenellations (limited on the crumbled variant)
    var crenelEnd = leftX + r.w * (r.variant === 2 ? 0.6 : 1.0);
    var mw = 9, mh = 7, bx = leftX, idx = 0;
    while (bx < crenelEnd - 0.5) {
      var seg = Math.min(mw, crenelEnd - bx);
      if (idx % 2 === 0) {
        fillWorldRect(ctx, bx, topY - mh, seg, mh, STONE);
        fillWorldRect(ctx, bx, topY - mh, seg, 2, STONE_L);
      }
      bx += mw; idx++;
    }

    // dark windows with a faint ghostly sill-glow
    var sc = MB.VIEW_SCALE;
    for (var i = 0; i < r.windows.length; i++) {
      var wn = r.windows[i];
      var wx = r.x + wn.x, wy = r.y + wn.y;
      fillWorldRect(ctx, wx - 1, wy - 1, wn.w + 2, wn.h + 2, STONE_DD);
      fillWorldRect(ctx, wx, wy, wn.w, wn.h, WIN);
      fillWorldRect(ctx, wx, wy, 1.5, 2, STONE);              // arched top corners
      fillWorldRect(ctx, wx + wn.w - 1.5, wy, 1.5, 2, STONE);
      var gp = MB.cam.worldToScreen(wx, wy + wn.h);
      ctx.save();
      ctx.globalAlpha = 0.22;
      ctx.fillStyle = '#5a3a78';
      ctx.fillRect(Math.round(gp.sx), Math.round(gp.sy - 2 * sc), Math.ceil(wn.w * sc), Math.ceil(2 * sc));
      ctx.restore();
    }

    // variant extras
    if (r.variant === 0) {
      // a watchtower to one side
      var tw = r.w * 0.28, th = r.h * 1.5;
      var tx = (r.towerSide < 0) ? leftX - tw * 0.6 : leftX + r.w - tw * 0.4;
      var ttop = r.y - th;
      fillWorldRect(ctx, tx, ttop, tw, th, STONE);
      fillWorldRect(ctx, tx, ttop, Math.max(2, tw * 0.18), th, STONE_L);
      fillWorldRect(ctx, tx + tw * 0.78, ttop, tw * 0.22, th, STONE_D);
      var tbx = tx, tj = 0;
      while (tbx < tx + tw - 0.5) {
        var s2 = Math.min(6, tx + tw - tbx);
        if (tj % 2 === 0) { fillWorldRect(ctx, tbx, ttop - 5, s2, 5, STONE); fillWorldRect(ctx, tbx, ttop - 5, s2, 1.5, STONE_L); }
        tbx += 6; tj++;
      }
      fillWorldRect(ctx, tx + tw * 0.5 - 2.5, ttop + th * 0.30, 5, 8, STONE_DD);
      fillWorldRect(ctx, tx + tw * 0.5 - 2, ttop + th * 0.30 + 0.5, 4, 7, WIN);
    } else if (r.variant === 1) {
      // a broken gothic archway carved into the centre
      var aw = r.w * 0.30, ah = r.h * 0.62;
      var ax = r.x - aw / 2, ay = r.y - ah;
      fillWorldRect(ctx, ax, ay, aw, ah, WIN);
      fillWorldRect(ctx, ax, ay, aw * 0.22, ah * 0.18, STONE);                 // shoulders
      fillWorldRect(ctx, ax + aw * 0.78, ay, aw * 0.22, ah * 0.18, STONE);
      fillWorldRect(ctx, r.x - 2, ay - 2, 4, 4, STONE_L);                      // keystone
    } else {
      // collapsed top-right corner (carved with the night colour)
      var bw = r.w * 0.40, bh = r.h * 0.45;
      fillWorldRect(ctx, leftX + r.w - bw, topY, bw, bh, MB.WORLD_BG);
      fillWorldRect(ctx, leftX + r.w - bw, topY + bh, bw * 0.55, 7, MB.WORLD_BG);
      fillWorldRect(ctx, leftX + r.w - bw * 0.45, topY + bh - 7, bw * 0.45, 7, MB.WORLD_BG);
    }
  }

  function drawPedestal(ctx, al) {
    fillWorldRect(ctx, al.x - 9, al.y - 4, 18, 4, STONE_D);     // base
    fillWorldRect(ctx, al.x - 8, al.y - 9, 16, 5, STONE);
    fillWorldRect(ctx, al.x - 8, al.y - 9, 16, 1.5, STONE_L);
    fillWorldRect(ctx, al.x - 5, al.y - 16, 10, 7, STONE);      // column
    fillWorldRect(ctx, al.x - 5, al.y - 16, 2, 7, STONE_L);
    fillWorldRect(ctx, al.x + 3, al.y - 16, 2, 7, STONE_D);
    fillWorldRect(ctx, al.x - 7, al.y - 19, 14, 3, STONE);      // top slab
    fillWorldRect(ctx, al.x - 7, al.y - 19, 14, 1.2, STONE_L);
  }

  function drawAltar(ctx, al, t) {
    var sc = MB.VIEW_SCALE;
    groundShadow(ctx, al.x, al.y, 11);
    drawPedestal(ctx, al);

    if (al.consumed) {
      // dimmed + cracked + extinguished rune
      var bp = MB.cam.worldToScreen(al.x - 9, al.y - 19);
      ctx.save();
      ctx.globalAlpha = 0.34;
      ctx.fillStyle = '#000';
      ctx.fillRect(Math.round(bp.sx), Math.round(bp.sy), Math.ceil(18 * sc), Math.ceil(19 * sc));
      ctx.restore();
      drawDiamond(ctx, al.x, al.y - 24, 3, 4, STONE_DD);
      var c0 = MB.cam.worldToScreen(al.x - 1, al.y - 19);
      var c1 = MB.cam.worldToScreen(al.x + 1.5, al.y - 13);
      var c2 = MB.cam.worldToScreen(al.x - 1, al.y - 9);
      ctx.save();
      ctx.strokeStyle = '#1a1622';
      ctx.lineWidth = Math.max(1, sc * 0.5);
      ctx.beginPath();
      ctx.moveTo(c0.sx, c0.sy); ctx.lineTo(c1.sx, c1.sy); ctx.lineTo(c2.sx, c2.sy);
      ctx.stroke();
      ctx.restore();
      return;
    }

    var th = THEMES[al.theme] || THEMES[0];
    var glow = th[0], mid = th[1], core = th[2], runeBase = th[3];

    var pulse = 0.5 + 0.5 * Math.sin(t * 3 + al.phase);
    var bob = Math.sin(t * 2 + al.phase) * 1.5;
    var rcx = al.x;
    var rcy = al.y - 26 + bob;        // floating rune above the slab

    // glow halo (cheap screen-space arcs, no gradient allocation)
    var ps = MB.cam.worldToScreen(rcx, rcy);
    ctx.save();
    ctx.fillStyle = glow;
    ctx.globalAlpha = 0.10 + pulse * 0.12;
    ctx.beginPath(); ctx.arc(ps.sx, ps.sy, (11 + pulse * 6) * sc, 0, TAU); ctx.fill();
    ctx.globalAlpha = 0.16 + pulse * 0.16;
    ctx.beginPath(); ctx.arc(ps.sx, ps.sy, (6 + pulse * 3) * sc, 0, TAU); ctx.fill();
    ctx.restore();

    // rune shard (layered diamonds)
    var hh = 4 + pulse * 1.5;
    drawDiamond(ctx, rcx, rcy, 3.0, hh, runeBase);
    drawDiamond(ctx, rcx, rcy, 1.9, hh * 0.62, mid);
    drawDiamond(ctx, rcx, rcy, 0.9, hh * 0.34, core);

    // rising embers (fade out near the top to hide the wrap)
    ctx.save();
    ctx.fillStyle = glow;
    for (var k = 0; k < 3; k++) {
      var hgt = (t * 7 + k * 5 + al.phase * 3) % 16;
      var ex = rcx + Math.cos(t * 1.5 + al.phase + k * 2.1) * (4 + k);
      var ey = rcy - hgt;
      var ep = MB.cam.worldToScreen(ex, ey);
      ctx.globalAlpha = MB.clamp(1 - hgt / 16, 0, 1) * 0.6 * (0.4 + pulse * 0.6);
      ctx.fillRect(Math.round(ep.sx), Math.round(ep.sy), 2, 2);
    }
    ctx.restore();
  }

  function draw(ctx) {
    if (!ctx || !MB.cam) return;

    // big background structures first
    for (var r = 0; r < _ruins.length; r++) {
      var ru = _ruins[r];
      if (MB.cam.onScreen(ru.x, ru.y, 220)) drawRuin(ctx, ru);
    }

    // graveyard decor (reuse existing sprites)
    for (var p = 0; p < _props.length; p++) {
      var pr = _props[p];
      if (!MB.cam.onScreen(pr.x, pr.y, 96)) continue;
      groundShadow(ctx, pr.x, pr.y, 4.5);
      MB.drawNamed(ctx, pr.sprite, 0, pr.x, pr.y, { anchor: 'bottom' });
    }

    // altars on top of the ground layer (cosmetic clock keeps glowing even
    // while the sim is frozen during the overlay)
    var t = (typeof performance !== 'undefined' && performance.now)
      ? performance.now() / 1000
      : ((MB.State && MB.State.time) || 0);
    for (var a = 0; a < _altars.length; a++) {
      var al = _altars[a];
      if (MB.cam.onScreen(al.x, al.y, 96)) drawAltar(ctx, al, t);
    }
  }

  /* ================================================================== *
   * Public API
   * ================================================================== */
  MB.World = {
    startRun: startRun,
    reset: reset,
    update: update,
    draw: draw,
    _pickAltar: _pickAltar
  };

})(window.MB = window.MB || {});
