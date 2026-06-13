/* MEGABONK: PIXEL CRYPT — main.js
 * MB.Main — the integrator: boots every module, owns input, the camera, the
 * fixed render pipeline and the requestAnimationFrame game loop, and drives the
 * level-up / game-over / victory flow.
 *
 * Loads LAST. Every cross-module call is made at CALL TIME via MB.* and guarded
 * defensively so a missing / late module can never throw.
 *
 * Render pipeline (each frame, even while paused / leveling up):
 *   clear(WORLD_BG) -> tiling ground -> decor -> ground-FX(gems/pickups)
 *   -> entities (enemies + player) Y-sorted -> projectiles -> over-FX(particles/text)
 *   -> low-HP danger vignette -> UI.updateHUD
 */
(function (MB) {
  'use strict';

  /* ------------------------------------------------------------------ *
   * Module-scoped state (no per-frame allocation in the hot path)
   * ------------------------------------------------------------------ */
  var _canvas = null;
  var _ctx = null;
  var _last = 0;                 // last rAF timestamp (ms)
  var _pending = 0;             // queued level-ups awaiting a pick
  var _nodes = {};              // cached non-UI DOM nodes (pause hint)

  // held movement state — mutated by key events, read by player.update
  var _input = { up: false, down: false, left: false, right: false };

  // reusable Y-sort scratch list (cleared & refilled every frame)
  var _renderList = [];
  function _byY(a, b) { return a.y - b.y; }

  // ground tile geometry (1x tile is ~32px, blitted at VIEW_SCALE)
  var GROUND_TILE = 32;

  /* ================================================================== *
   * Canvas sizing
   * ================================================================== */
  function resize() {
    if (!_canvas) return;
    var w = window.innerWidth || document.documentElement.clientWidth || 960;
    var h = window.innerHeight || document.documentElement.clientHeight || 540;
    _canvas.width = w;
    _canvas.height = h;
    // resizing a canvas resets ALL 2d context state — restore crisp pixels
    if (_ctx) _ctx.imageSmoothingEnabled = false;
    var S = MB.State.screen;
    S.w = w; S.h = h; S.cx = w / 2; S.cy = h / 2;
  }

  /* ================================================================== *
   * Input
   * ================================================================== */
  // returns true if the event was a movement key (and updates _input)
  function applyMove(e, down) {
    switch (e.code) {
      case 'KeyW': case 'ArrowUp':    _input.up = down;    return true;
      case 'KeyS': case 'ArrowDown':  _input.down = down;  return true;
      case 'KeyA': case 'ArrowLeft':  _input.left = down;  return true;
      case 'KeyD': case 'ArrowRight': _input.right = down; return true;
    }
    // fallback for layouts / browsers without reliable e.code
    var k = (e.key || '').toLowerCase();
    if (k === 'w' || k === 'arrowup')    { _input.up = down;    return true; }
    if (k === 's' || k === 'arrowdown')  { _input.down = down;  return true; }
    if (k === 'a' || k === 'arrowleft')  { _input.left = down;  return true; }
    if (k === 'd' || k === 'arrowright') { _input.right = down; return true; }
    return false;
  }

  function clearInput() {
    _input.up = _input.down = _input.left = _input.right = false;
  }

  function togglePause() {
    var S = MB.State;
    if (S.scene !== 'playing') return;     // only pause during active play
    S.paused = !S.paused;
    if (_nodes.pauseHint) _nodes.pauseHint.classList.toggle('hidden', !S.paused);
  }

  function toggleMute() {
    if (!MB.Audio) return;
    if (MB.Audio.init) { try { MB.Audio.init(); } catch (e) {} }
    var next = !MB.Audio.muted;
    if (MB.Audio.setMuted) MB.Audio.setMuted(next);
    if (!next && MB.Audio.sfx) MB.Audio.sfx('select');
  }

  // forward number keys to whichever choice modal is open (1-based)
  function pickLevelUp(n) {
    var sc = MB.State.scene;
    if (sc === 'levelup' && MB.UI && MB.UI._pickByIndex) MB.UI._pickByIndex(n);
    else if (sc === 'altar' && MB.World && MB.World._pickAltar) MB.World._pickAltar(n);
  }

  function onKeyDown(e) {
    // movement first — swallow arrows so the page never scrolls
    if (applyMove(e, true)) { e.preventDefault(); return; }
    if (e.repeat) return;                  // ignore auto-repeat for toggles

    switch (e.code) {
      case 'KeyP': case 'Escape': togglePause(); e.preventDefault(); return;
      case 'KeyM': toggleMute(); return;
      case 'Digit1': case 'Numpad1': pickLevelUp(1); return;
      case 'Digit2': case 'Numpad2': pickLevelUp(2); return;
      case 'Digit3': case 'Numpad3': pickLevelUp(3); return;
      case 'Digit4': case 'Numpad4': pickLevelUp(4); return;
    }
    // key fallback (no usable e.code)
    var k = (e.key || '').toLowerCase();
    if (k === 'p' || k === 'escape') { togglePause(); e.preventDefault(); }
    else if (k === 'm') { toggleMute(); }
    else if (k >= '1' && k <= '4') { pickLevelUp(parseInt(k, 10)); }
  }

  function onKeyUp(e) { applyMove(e, false); }

  /* ================================================================== *
   * Decor seeding — scatter graveyard props around the origin
   * ================================================================== */
  var DECOR_SPRITES = ['tombstone', 'cross', 'deadtree', 'tombstone', 'cross', 'skull'];
  function seedDecor() {
    var decor = MB.State.decor;
    decor.length = 0;
    var N = 48;
    for (var i = 0; i < N; i++) {
      var a = Math.random() * Math.PI * 2;
      var r = MB.rand(72, 780);                 // keep the spawn point clear
      decor.push({
        x: Math.cos(a) * r,
        y: Math.sin(a) * r,
        sprite: MB.pick(DECOR_SPRITES),
      });
    }
    decor.sort(_byY);                            // static: sort once
  }

  /* ================================================================== *
   * Game start / lifecycle
   * ================================================================== */
  function startGame(charDef) {
    if (MB.Audio && MB.Audio.init) { try { MB.Audio.init(); } catch (e) {} }

    MB.reset();
    var S = MB.State;
    S.char = charDef || null;

    // create the hero + their starting weapon, then author derived stats
    S.player = new MB.Player(charDef);
    if (MB.Weapon && charDef && charDef.startWeapon) {
      S.player.weapons.push(new MB.Weapon(charDef.startWeapon));
    }
    if (MB.Upgrades && MB.Upgrades.recomputeStats) MB.Upgrades.recomputeStats(S.player);

    if (MB.Enemies && MB.Enemies.startRun) MB.Enemies.startRun();
    if (MB.Audio && MB.Audio.startMusic) MB.Audio.startMusic();

    seedDecor();
    if (MB.World && MB.World.startRun) { try { MB.World.startRun(S.player); } catch (e) {} }
    if (MB.Biomes && MB.Biomes.startRun) { try { MB.Biomes.startRun(S.player); } catch (e) {} }

    _pending = 0;
    S.paused = false;
    S.scene = 'playing';

    // snap camera onto the hero so the first frame is centered
    S.camera.x = S.player.x;
    S.camera.y = S.player.y;

    clearInput();
    if (MB.UI && MB.UI.hideStart) MB.UI.hideStart();
    if (_nodes.pauseHint) _nodes.pauseHint.classList.add('hidden');
  }

  function gameOver() {
    var S = MB.State;
    if (S.scene === 'gameover' || S.scene === 'victory') return;
    S.scene = 'gameover';
    S.paused = false;
    if (MB.Shop && MB.Shop.deposit) { try { MB.Shop.deposit(S.gold); } catch (e) {} }
    if (MB.Audio) {
      if (MB.Audio.stopMusic) MB.Audio.stopMusic();
      if (MB.Audio.sfx) MB.Audio.sfx('gameover');
    }
    if (_nodes.pauseHint) _nodes.pauseHint.classList.add('hidden');
    var p = S.player;
    if (MB.UI && MB.UI.showGameOver) {
      MB.UI.showGameOver({
        time: S.time, level: p ? p.level : 1, kills: S.kills, gold: S.gold,
      }, restart);
    }
  }

  function victory() {
    var S = MB.State;
    if (S.scene === 'victory') return;
    S.scene = 'victory';
    S.paused = false;
    if (MB.Shop && MB.Shop.deposit) { try { MB.Shop.deposit(S.gold); } catch (e) {} }
    if (MB.Audio) {
      if (MB.Audio.stopMusic) MB.Audio.stopMusic();
      if (MB.Audio.sfx) MB.Audio.sfx('victory');
    }
    if (_nodes.pauseHint) _nodes.pauseHint.classList.add('hidden');
    var p = S.player;
    if (MB.UI && MB.UI.showVictory) {
      MB.UI.showVictory({
        time: S.time, level: p ? p.level : 1, kills: S.kills, gold: S.gold,
      }, restart);
    }
  }

  function restart() {
    if (MB.Audio && MB.Audio.stopMusic) MB.Audio.stopMusic();
    MB.reset();
    MB.State.scene = 'start';
    _pending = 0;
    clearInput();
    if (_nodes.pauseHint) _nodes.pauseHint.classList.add('hidden');
    if (MB.UI && MB.UI.showStart) MB.UI.showStart(MB.CHARACTERS, startGame);
    if (MB.Shop && MB.Shop.mountStartButton) { try { MB.Shop.mountStartButton(); } catch (e) {} }
  }

  /* ================================================================== *
   * Level-up flow
   * ================================================================== */
  function queueLevelUp() { _pending++; }

  function enterLevelUp() {
    var S = MB.State;
    S.scene = 'levelup';
    var player = S.player;
    var options = (MB.Upgrades && MB.Upgrades.rollOptions)
      ? MB.Upgrades.rollOptions(player) : [];

    if (MB.UI && MB.UI.showLevelUp) {
      MB.UI.showLevelUp(options, function (pick) {
        if (pick && MB.Upgrades && MB.Upgrades.apply) MB.Upgrades.apply(player, pick);
        afterLevelUp();
      });
    } else {
      // no UI present — auto-take the first option and carry on
      if (options.length && MB.Upgrades && MB.Upgrades.apply) MB.Upgrades.apply(player, options[0]);
      afterLevelUp();
    }
  }

  function afterLevelUp() {
    _pending = _pending > 0 ? _pending - 1 : 0;
    if (_pending > 0) {
      enterLevelUp();          // chain straight into the next queued level
    } else {
      MB.State.scene = 'playing';
    }
  }

  /* ================================================================== *
   * Simulation step
   * ================================================================== */
  function update(dt) {
    var S = MB.State;
    var player = S.player;
    if (!player) return;

    S.time += dt;
    S.frame++;

    // rebuild the enemy broad-phase grid (weapons + separation read it)
    var grid = S.grid;
    grid.clear();
    var enemies = S.enemies;
    var i, e;
    for (i = 0; i < enemies.length; i++) {
      e = enemies[i];
      if (!e.dead) grid.insert(e);
    }

    // hero moves + ticks its weapons (weapons spawn into S.projectiles)
    player.update(dt, _input);

    // spawn director, then per-enemy AI
    if (MB.Enemies && MB.Enemies.update) MB.Enemies.update(dt, player);
    for (i = 0; i < enemies.length; i++) {
      e = enemies[i];
      if (!e.dead && e.update) e.update(dt, player);
    }

    // projectiles (collision handled inside each)
    var projs = S.projectiles;
    var pr;
    for (i = 0; i < projs.length; i++) {
      pr = projs[i];
      if (pr && !pr.dead && pr.update) pr.update(dt);
    }

    // gems / pickups / particles / damage numbers
    MB.updateWorldFX(dt, player);

    // player <-> enemy contact damage (iframe-gated inside)
    player.handleContacts(enemies);

    // world structures / altars (may open an altar-choice → scene='altar')
    if (MB.World && MB.World.update) MB.World.update(dt, player);
    if (MB.Biomes && MB.Biomes.update) MB.Biomes.update(dt, player);

    // recycle the dead
    MB.cull(enemies);
    MB.cull(projs);

    // smooth, frame-rate-independent camera follow
    var cam = S.camera;
    var f = dt * 16; if (f > 1) f = 1;
    cam.x += (player.x - cam.x) * f;
    cam.y += (player.y - cam.y) * f;
  }

  /* ================================================================== *
   * Rendering
   * ================================================================== */
  function drawGround(ctx) {
    // biome system owns the ground when present (multiple textures per region)
    if (MB.Biomes && MB.Biomes.drawGround) { MB.Biomes.drawGround(ctx); return; }
    var tile = (MB.Sprites && MB.Sprites.groundTile) ? MB.Sprites.groundTile() : null;
    if (!tile) return;
    var S = MB.State;
    var sc = MB.VIEW_SCALE;
    var tw = GROUND_TILE;
    var tilePx = tw * sc;                       // integer screen size per tile

    // world extents of the current viewport
    var worldLeft = S.camera.x - S.screen.cx / sc;
    var worldTop = S.camera.y - S.screen.cy / sc;
    var worldRight = S.camera.x + S.screen.cx / sc;
    var worldBottom = S.camera.y + S.screen.cy / sc;

    var startTX = Math.floor(worldLeft / tw) * tw;
    var startTY = Math.floor(worldTop / tw) * tw;

    // one extra ring of tiles on every side covers rounding + screen-shake
    for (var ty = startTY - tw; ty <= worldBottom + tw; ty += tw) {
      for (var tx = startTX - tw; tx <= worldRight + tw; tx += tw) {
        var p = MB.cam.worldToScreen(tx, ty);
        ctx.drawImage(tile, Math.floor(p.sx), Math.floor(p.sy), tilePx, tilePx);
      }
    }
  }

  function groundShadow(ctx, wx, wy, rw) {
    var p = MB.cam.worldToScreen(wx, wy);
    ctx.globalAlpha = 0.22;
    ctx.fillStyle = '#000000';
    ctx.beginPath();
    if (ctx.ellipse) ctx.ellipse(p.sx, p.sy, rw, rw * 0.4, 0, 0, Math.PI * 2);
    else ctx.fillRect(p.sx - rw, p.sy - rw * 0.4, rw * 2, rw * 0.8);
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  function drawDecor(ctx) {
    var decor = MB.State.decor;
    for (var i = 0; i < decor.length; i++) {
      var d = decor[i];
      if (!MB.cam.onScreen(d.x, d.y, 96)) continue;
      groundShadow(ctx, d.x, d.y, 9 * MB.VIEW_SCALE * 0.5);
      MB.drawNamed(ctx, d.sprite, 0, d.x, d.y, { anchor: 'bottom' });
    }
  }

  function drawEntities(ctx) {
    var S = MB.State;
    var list = _renderList;
    list.length = 0;

    var enemies = S.enemies;
    for (var i = 0; i < enemies.length; i++) {
      var e = enemies[i];
      if (e.dead) continue;
      if (MB.cam.onScreen(e.x, e.y, 64)) list.push(e);
    }
    if (S.player) list.push(S.player);

    list.sort(_byY);                            // painter's order: lower = in front
    for (var j = 0; j < list.length; j++) list[j].draw(ctx);
  }

  function drawProjectiles(ctx) {
    var projs = MB.State.projectiles;
    for (var i = 0; i < projs.length; i++) {
      var p = projs[i];
      if (!p || p.dead || !p.draw) continue;
      // strike point on-screen (clips the rest); auras sit on the player → always in
      if (MB.cam.onScreen(p.x, p.y, 280)) p.draw(ctx);
    }
  }

  // pulsing red edge-glow when the hero is in mortal danger
  function drawLowHpVignette(ctx) {
    var S = MB.State;
    var p = S.player;
    if (!p || p.maxHp <= 0) return;
    var frac = p.hp / p.maxHp;
    if (frac >= 0.30) return;

    var sw = S.screen.w, sh = S.screen.h;
    var pulse = 0.5 + 0.5 * Math.sin(S.time * 6);
    var a = ((0.30 - frac) / 0.30) * (0.22 + pulse * 0.18);
    var g = ctx.createRadialGradient(
      sw / 2, sh / 2, Math.min(sw, sh) * 0.34,
      sw / 2, sh / 2, Math.max(sw, sh) * 0.62);
    g.addColorStop(0, 'rgba(140,12,20,0)');
    g.addColorStop(1, 'rgba(150,14,22,' + a.toFixed(3) + ')');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, sw, sh);
  }

  function render() {
    var ctx = _ctx;
    if (!ctx) return;
    var S = MB.State;

    // clear to the night sky
    ctx.fillStyle = MB.WORLD_BG;
    ctx.fillRect(0, 0, S.screen.w, S.screen.h);

    drawGround(ctx);

    if (S.player) {
      if (MB.Biomes && MB.Biomes.draw) MB.Biomes.draw(ctx);   // biome ground details (bones/mushrooms/etc)
      if (MB.World && MB.World.draw) MB.World.draw(ctx);   // graveyards/castles/altars under entities
      drawDecor(ctx);
      MB.drawGround_FX(ctx);     // gems + pickups (under entities)
      drawEntities(ctx);          // enemies + hero, Y-sorted
      drawProjectiles(ctx);       // weapon effects on top
      MB.drawOver_FX(ctx);        // particles + floating damage numbers
      if (MB.Biomes && MB.Biomes.drawAmbient) MB.Biomes.drawAmbient(ctx);  // fog/embers/snow + biome tint
      drawLowHpVignette(ctx);     // danger pulse
    }

    if (MB.UI && MB.UI.updateHUD) MB.UI.updateHUD(S);
  }

  /* ================================================================== *
   * The loop
   * ================================================================== */
  function loop(ts) {
    var S = MB.State;
    if (!_last) _last = ts;
    var dt = (ts - _last) / 1000;
    _last = ts;
    dt = MB.clamp(dt, 0, 0.05);                 // never simulate huge steps
    S.dt = dt;

    MB.updateShake(dt);

    if (S.scene === 'playing' && !S.paused) {
      update(dt);
      // a level-up may have been queued during this step — enter it now
      if (_pending > 0 && S.scene === 'playing') enterLevelUp();
    }

    render();
    requestAnimationFrame(loop);
  }

  /* ================================================================== *
   * Boot
   * ================================================================== */
  function init() {
    _canvas = document.getElementById('game');
    if (!_canvas) return;
    _ctx = _canvas.getContext('2d');
    _ctx.imageSmoothingEnabled = false;

    resize();
    window.addEventListener('resize', resize);

    // build all pixel art up front so the first frame is instant
    if (MB.Sprites && MB.Sprites.preload) { try { MB.Sprites.preload(); } catch (e) {} }
    if (MB.UI && MB.UI.init) { try { MB.UI.init(); } catch (e) {} }

    _nodes.pauseHint = document.getElementById('pause-hint');

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', clearInput);   // avoid stuck keys on focus loss

    // coin shop (meta-progression) — build overlay once
    if (MB.Shop && MB.Shop.mount) { try { MB.Shop.mount(); } catch (e) {} }

    // character select → startGame(charDef)
    if (MB.UI && MB.UI.showStart) MB.UI.showStart(MB.CHARACTERS, startGame);
    if (MB.Shop && MB.Shop.mountStartButton) { try { MB.Shop.mountStartButton(); } catch (e) {} }

    _last = 0;
    requestAnimationFrame(loop);
  }

  /* ================================================================== *
   * Public API
   * ================================================================== */
  MB.Main = {
    init: init,
    queueLevelUp: queueLevelUp,
    afterLevelUp: afterLevelUp,
    gameOver: gameOver,
    victory: victory,
    restart: restart,
  };

  // bind boot to DOM readiness (or run now if the DOM is already parsed)
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})(window.MB = window.MB || {});
