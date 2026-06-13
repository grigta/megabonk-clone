/* MEGABONK: PIXEL CRYPT — core.js
 * Foundation: State, constants, utils, camera, drawSprite, SpatialHash,
 * and all world-FX (gems, pickups, particles, damage texts).
 * Everything attaches to the global MB namespace. Load this FIRST.
 */
(function (MB) {
  'use strict';

  /* ------------------------------------------------------------------ *
   * Constants
   * ------------------------------------------------------------------ */
  MB.VIEW_SCALE = 3;
  MB.RUN_DURATION = 900;       // 15 minutes
  MB.WORLD_BG = '#1b1726';

  /* ------------------------------------------------------------------ *
   * Utils
   * ------------------------------------------------------------------ */
  let _id = 1;
  MB.nextId = function () { return _id++; };

  MB.clamp = function (v, a, b) { return v < a ? a : (v > b ? b : v); };
  MB.lerp = function (a, b, t) { return a + (b - a) * t; };
  MB.rand = function (a, b) { if (b === undefined) { b = a; a = 0; } return a + Math.random() * (b - a); };
  MB.randInt = function (a, b) { return Math.floor(MB.rand(a, b + 1)); };
  MB.pick = function (arr) { return arr[(Math.random() * arr.length) | 0]; };
  MB.chance = function (p) { return Math.random() < p; };
  MB.dist2 = function (ax, ay, bx, by) { const dx = bx - ax, dy = by - ay; return dx * dx + dy * dy; };
  MB.dist = function (ax, ay, bx, by) { return Math.sqrt(MB.dist2(ax, ay, bx, by)); };
  MB.angle = function (ax, ay, bx, by) { return Math.atan2(by - ay, bx - ax); };
  MB.norm = function (dx, dy) {
    const l = Math.sqrt(dx * dx + dy * dy);
    if (l < 1e-6) return { x: 0, y: 0 };
    return { x: dx / l, y: dy / l };
  };
  MB.approach = function (cur, target, maxDelta) {
    if (cur < target) return Math.min(cur + maxDelta, target);
    return Math.max(cur - maxDelta, target);
  };

  /* ------------------------------------------------------------------ *
   * State
   * ------------------------------------------------------------------ */
  MB.State = {
    scene: 'start',
    paused: false,
    time: 0,
    dt: 0,
    frame: 0,
    player: null,
    enemies: [],
    projectiles: [],
    gems: [],
    pickups: [],
    particles: [],
    damageTexts: [],
    decor: [],
    kills: 0,
    gold: 0,
    camera: { x: 0, y: 0 },
    screen: { w: 0, h: 0, cx: 0, cy: 0 },
    grid: null,
    char: null,
  };

  MB.reset = function () {
    const S = MB.State;
    S.paused = false;
    S.time = 0;
    S.dt = 0;
    S.frame = 0;
    S.player = null;
    S.enemies.length = 0;
    S.projectiles.length = 0;
    S.gems.length = 0;
    S.pickups.length = 0;
    S.particles.length = 0;
    S.damageTexts.length = 0;
    S.decor.length = 0;
    S.kills = 0;
    S.gold = 0;
    S.camera.x = 0;
    S.camera.y = 0;
    _shake.t = 0;
    _shake.mag = 0;
    if (!S.grid) S.grid = new MB.SpatialHash(48);
  };

  /* ------------------------------------------------------------------ *
   * Camera + screen-shake + world<->screen
   * ------------------------------------------------------------------ */
  const _shake = { t: 0, mag: 0, x: 0, y: 0 };
  MB.shake = function (mag) {
    _shake.mag = Math.max(_shake.mag, mag);
    _shake.t = Math.max(_shake.t, 0.18);
  };
  MB.updateShake = function (dt) {
    if (_shake.t > 0) {
      _shake.t -= dt;
      const m = _shake.mag * (_shake.t > 0 ? 1 : 0);
      _shake.x = (Math.random() * 2 - 1) * m;
      _shake.y = (Math.random() * 2 - 1) * m;
      if (_shake.t <= 0) { _shake.mag = 0; _shake.x = 0; _shake.y = 0; }
    } else { _shake.x = 0; _shake.y = 0; }
  };

  MB.cam = {
    worldToScreen: function (wx, wy) {
      const S = MB.State, sc = MB.VIEW_SCALE;
      return {
        sx: (wx - S.camera.x) * sc + S.screen.cx + _shake.x,
        sy: (wy - S.camera.y) * sc + S.screen.cy + _shake.y,
      };
    },
    // is a world point within (margin px screen) of the view?
    onScreen: function (wx, wy, margin) {
      const p = MB.cam.worldToScreen(wx, wy);
      margin = margin || 64;
      return p.sx > -margin && p.sx < MB.State.screen.w + margin &&
             p.sy > -margin && p.sy < MB.State.screen.h + margin;
    },
    // half view size in world units
    halfViewW: function () { return MB.State.screen.cx / MB.VIEW_SCALE; },
    halfViewH: function () { return MB.State.screen.cy / MB.VIEW_SCALE; },
  };

  /* ------------------------------------------------------------------ *
   * drawSprite — the universal sprite blitter (world space)
   * ------------------------------------------------------------------ */
  MB.drawSprite = function (ctx, sprite, wx, wy, opts) {
    if (!sprite) return;
    opts = opts || {};
    const sc = MB.VIEW_SCALE * (opts.scale || 1);
    const w = sprite.width * sc;
    const h = sprite.height * sc;
    const p = MB.cam.worldToScreen(wx, wy);
    let dx = p.sx - w / 2;
    let dy = (opts.anchor === 'bottom') ? p.sy - h : p.sy - h / 2;
    dx = Math.round(dx); dy = Math.round(dy);

    const a = (opts.alpha === undefined) ? 1 : opts.alpha;
    const prevA = ctx.globalAlpha;
    if (a !== 1) ctx.globalAlpha = a;

    const img = (opts.whiten && MB.Sprites && MB.Sprites.getWhite)
      ? (opts._whiteCanvas || null)
      : null;

    if (opts.rot) {
      ctx.save();
      ctx.translate(Math.round(p.sx), Math.round(p.sy));
      ctx.rotate(opts.rot);
      if (opts.flip) ctx.scale(-1, 1);
      ctx.drawImage(opts.whiten ? (img || sprite) : sprite, -w / 2, -h / 2, w, h);
      ctx.restore();
    } else if (opts.flip) {
      ctx.save();
      ctx.translate(Math.round(p.sx), 0);
      ctx.scale(-1, 1);
      ctx.drawImage(opts.whiten ? (img || sprite) : sprite, -w / 2, dy, w, h);
      ctx.restore();
    } else {
      ctx.drawImage(opts.whiten ? (img || sprite) : sprite, dx, dy, w, h);
    }
    if (a !== 1) ctx.globalAlpha = prevA;
  };

  // Convenience: draw a sprite BY NAME, auto-resolving white variant for flash.
  MB.drawNamed = function (ctx, name, frame, wx, wy, opts) {
    opts = opts || {};
    let sprite;
    if (opts.whiten && MB.Sprites && MB.Sprites.getWhite) {
      sprite = MB.Sprites.getWhite(name, frame || 0);
      opts._whiteCanvas = sprite;
      MB.drawSprite(ctx, sprite, wx, wy, opts);
      return;
    }
    sprite = MB.Sprites ? MB.Sprites.get(name, frame || 0) : null;
    MB.drawSprite(ctx, sprite, wx, wy, opts);
  };

  /* ------------------------------------------------------------------ *
   * SpatialHash — broad-phase for enemies
   * ------------------------------------------------------------------ */
  function SpatialHash(cell) {
    this.cell = cell || 48;
    this.map = new Map();
  }
  SpatialHash.prototype._key = function (cx, cy) { return cx + ',' + cy; };
  SpatialHash.prototype.clear = function () { this.map.clear(); };
  SpatialHash.prototype.insert = function (e) {
    const cx = Math.floor(e.x / this.cell), cy = Math.floor(e.y / this.cell);
    const k = this._key(cx, cy);
    let bucket = this.map.get(k);
    if (!bucket) { bucket = []; this.map.set(k, bucket); }
    bucket.push(e);
  };
  SpatialHash.prototype.query = function (x, y, r) {
    const out = [];
    const c = this.cell;
    const minx = Math.floor((x - r) / c), maxx = Math.floor((x + r) / c);
    const miny = Math.floor((y - r) / c), maxy = Math.floor((y + r) / c);
    for (let cx = minx; cx <= maxx; cx++) {
      for (let cy = miny; cy <= maxy; cy++) {
        const bucket = this.map.get(this._key(cx, cy));
        if (bucket) { for (let i = 0; i < bucket.length; i++) out.push(bucket[i]); }
      }
    }
    return out;
  };
  SpatialHash.prototype.queryRect = function (x, y, w, h) {
    const out = [];
    const c = this.cell;
    const minx = Math.floor(x / c), maxx = Math.floor((x + w) / c);
    const miny = Math.floor(y / c), maxy = Math.floor((y + h) / c);
    for (let cx = minx; cx <= maxx; cx++) {
      for (let cy = miny; cy <= maxy; cy++) {
        const bucket = this.map.get(this._key(cx, cy));
        if (bucket) { for (let i = 0; i < bucket.length; i++) out.push(bucket[i]); }
      }
    }
    return out;
  };
  MB.SpatialHash = SpatialHash;

  /* ------------------------------------------------------------------ *
   * World-FX: Gems
   * ------------------------------------------------------------------ */
  function Gem(x, y, value) {
    this.x = x; this.y = y; this.value = value;
    this.sprite = value >= 25 ? 'gem_red' : (value >= 8 ? 'gem_green' : 'gem_blue');
    this.vx = MB.rand(-30, 30); this.vy = MB.rand(-40, -10);
    this.t = 0; this.collecting = false; this.dead = false;
    this.bob = Math.random() * Math.PI * 2;
  }
  Gem.prototype.update = function (dt, player) {
    this.t += dt; this.bob += dt * 4;
    // initial little pop
    if (this.t < 0.35) {
      this.x += this.vx * dt; this.y += this.vy * dt;
      this.vy += 180 * dt; // gravity for the pop
    }
    if (!player) return;
    const d = MB.dist(this.x, this.y, player.x, player.y);
    const mag = player.magnetRadius ? player.magnetRadius() : 46;
    if (this.collecting || d < mag) {
      this.collecting = true;
      const n = MB.norm(player.x - this.x, player.y - this.y);
      const sp = MB.lerp(120, 520, MB.clamp(1 - d / 220, 0, 1));
      this.x += n.x * sp * dt; this.y += n.y * sp * dt;
      if (d < 10) {
        this.dead = true;
        if (player.gainXp) player.gainXp(this.value);
        if (MB.Audio) MB.Audio.sfx('pickup');
        MB.spawnParticles(this.x, this.y, '#7fd8ff', 4, { speed: 60, life: 0.3, size: 1 });
      }
    }
  };
  Gem.prototype.draw = function (ctx) {
    const oy = Math.sin(this.bob) * 1.2;
    MB.drawNamed(ctx, this.sprite, 0, this.x, this.y + oy, { anchor: 'center' });
  };
  MB.spawnGem = function (x, y, value) {
    if (value <= 0) return;
    // merge cap: if too many gems, fold into nearest big one
    if (MB.State.gems.length > 380) {
      let best = null, bd = 1e9;
      for (let i = 0; i < MB.State.gems.length; i++) {
        const g = MB.State.gems[i];
        const d = MB.dist2(g.x, g.y, x, y);
        if (d < bd) { bd = d; best = g; }
      }
      if (best) { best.value += value; best.sprite = best.value >= 25 ? 'gem_red' : (best.value >= 8 ? 'gem_green' : 'gem_blue'); return; }
    }
    MB.State.gems.push(new Gem(x, y, value));
  };

  /* ------------------------------------------------------------------ *
   * World-FX: Pickups
   * ------------------------------------------------------------------ */
  function Pickup(x, y, type) {
    this.x = x; this.y = y; this.type = type; this.dead = false;
    this.t = 0; this.bob = Math.random() * Math.PI * 2;
    const map = { chest: 'chest', heart: 'heart', magnet: 'magnet', coin: 'coin', bomb: 'bomb' };
    this.sprite = map[type] || 'coin';
    this.collectRadius = (type === 'chest') ? 18 : 16;
  }
  Pickup.prototype.update = function (dt, player) {
    this.t += dt; this.bob += dt * 3;
    if (!player) return;
    const d = MB.dist(this.x, this.y, player.x, player.y);
    // coins/hearts/magnets get vacuumed within magnet radius; chests need closer touch
    const mag = player.magnetRadius ? player.magnetRadius() : 46;
    if (this.type !== 'chest' && d < mag) {
      const n = MB.norm(player.x - this.x, player.y - this.y);
      this.x += n.x * 260 * dt; this.y += n.y * 260 * dt;
    }
    if (d < this.collectRadius) this.collect(player);
  };
  Pickup.prototype.collect = function (player) {
    this.dead = true;
    switch (this.type) {
      case 'chest':
        if (MB.Audio) MB.Audio.sfx('chest');
        if (MB.Upgrades && MB.Upgrades.openChest) MB.Upgrades.openChest(player);
        MB.spawnParticles(this.x, this.y, '#f2c14e', 22, { speed: 130, life: 0.7, size: 2 });
        break;
      case 'heart':
        if (player.heal) player.heal(player.maxHp * 0.3);
        if (MB.Audio) MB.Audio.sfx('pickup');
        MB.spawnDamageText(this.x, this.y - 8, '+HP', '#ff6b8a');
        MB.spawnParticles(this.x, this.y, '#ff6b8a', 10, { speed: 80, life: 0.5, size: 2 });
        break;
      case 'magnet':
        if (player.vacuumGems) player.vacuumGems();
        if (MB.Audio) MB.Audio.sfx('pickup');
        MB.spawnDamageText(this.x, this.y - 8, 'MAGNET', '#8fd0ff');
        break;
      case 'coin': {
        const amt = Math.round(MB.randInt(5, 14) * (player.greed || 1));
        if (player.addGold) player.addGold(amt);
        if (MB.Audio) MB.Audio.sfx('pickup');
        MB.spawnDamageText(this.x, this.y - 8, '+' + amt, '#f2c14e');
        break;
      }
      case 'bomb':
        if (MB.Audio) MB.Audio.sfx('boss');
        MB.shake(10);
        for (let i = 0; i < MB.State.enemies.length; i++) {
          const e = MB.State.enemies[i];
          if (!e.dead && MB.cam.onScreen(e.x, e.y, 40) && e.hit) e.hit(80 + (player.might || 1) * 40, 0, 0, MB.nextId());
        }
        MB.spawnParticles(player.x, player.y, '#ffd86b', 40, { speed: 220, life: 0.6, size: 2 });
        break;
    }
  };
  Pickup.prototype.draw = function (ctx) {
    const oy = Math.sin(this.bob) * 2;
    MB.drawNamed(ctx, this.sprite, 0, this.x, this.y + oy, { anchor: 'center' });
  };
  MB.spawnPickup = function (x, y, type) { MB.State.pickups.push(new Pickup(x, y, type)); };

  /* ------------------------------------------------------------------ *
   * World-FX: Damage texts
   * ------------------------------------------------------------------ */
  function DamageText(x, y, text, color) {
    this.x = x + MB.rand(-3, 3); this.y = y; this.text = '' + text;
    this.color = color || '#ffffff'; this.t = 0; this.life = 0.7; this.dead = false;
    this.vy = -38; this.vx = MB.rand(-12, 12);
  }
  DamageText.prototype.update = function (dt) {
    this.t += dt; this.x += this.vx * dt; this.y += this.vy * dt;
    this.vy += 60 * dt;
    if (this.t >= this.life) this.dead = true;
  };
  DamageText.prototype.draw = function (ctx) {
    const p = MB.cam.worldToScreen(this.x, this.y);
    const a = MB.clamp(1 - this.t / this.life, 0, 1);
    ctx.save();
    ctx.globalAlpha = a;
    ctx.font = '700 13px "Courier New", monospace';
    ctx.textAlign = 'center';
    ctx.fillStyle = '#000';
    ctx.fillText(this.text, p.sx + 1, p.sy + 1);
    ctx.fillStyle = this.color;
    ctx.fillText(this.text, p.sx, p.sy);
    ctx.restore();
  };
  MB.spawnDamageText = function (x, y, text, color) {
    if (MB.State.damageTexts.length > 120) return;
    MB.State.damageTexts.push(new DamageText(x, y, text, color));
  };
  MB.spawnFloatText = MB.spawnDamageText;

  /* ------------------------------------------------------------------ *
   * World-FX: Particles
   * ------------------------------------------------------------------ */
  function Particle(x, y, color, opts) {
    opts = opts || {};
    const sp = opts.speed || 80;
    const a = Math.random() * Math.PI * 2;
    const s = sp * (0.4 + Math.random() * 0.6);
    this.x = x; this.y = y;
    this.vx = Math.cos(a) * s; this.vy = Math.sin(a) * s;
    this.life = (opts.life || 0.5) * (0.7 + Math.random() * 0.6);
    this.t = 0; this.color = color; this.size = opts.size || 2;
    this.gravity = opts.gravity || 0; this.dead = false;
  }
  Particle.prototype.update = function (dt) {
    this.t += dt;
    this.x += this.vx * dt; this.y += this.vy * dt;
    this.vy += this.gravity * dt;
    this.vx *= 0.92; this.vy *= 0.92;
    if (this.t >= this.life) this.dead = true;
  };
  Particle.prototype.draw = function (ctx) {
    const p = MB.cam.worldToScreen(this.x, this.y);
    const a = MB.clamp(1 - this.t / this.life, 0, 1);
    const s = this.size * MB.VIEW_SCALE;
    ctx.globalAlpha = a;
    ctx.fillStyle = this.color;
    ctx.fillRect(Math.round(p.sx - s / 2), Math.round(p.sy - s / 2), s, s);
    ctx.globalAlpha = 1;
  };
  MB.spawnParticles = function (x, y, color, count, opts) {
    if (MB.State.particles.length > 600) count = Math.min(count, 4);
    for (let i = 0; i < count; i++) MB.State.particles.push(new Particle(x, y, color, opts));
  };

  /* ------------------------------------------------------------------ *
   * World-FX update/draw orchestration
   * ------------------------------------------------------------------ */
  function cull(arr) {
    let w = 0;
    for (let i = 0; i < arr.length; i++) { if (!arr[i].dead) arr[w++] = arr[i]; }
    arr.length = w;
  }
  MB.cull = cull;

  MB.updateWorldFX = function (dt, player) {
    const S = MB.State;
    for (let i = 0; i < S.gems.length; i++) S.gems[i].update(dt, player);
    for (let i = 0; i < S.pickups.length; i++) S.pickups[i].update(dt, player);
    for (let i = 0; i < S.particles.length; i++) S.particles[i].update(dt);
    for (let i = 0; i < S.damageTexts.length; i++) S.damageTexts[i].update(dt);
    cull(S.gems); cull(S.pickups); cull(S.particles); cull(S.damageTexts);
  };

  MB.drawGround_FX = function (ctx) {
    const S = MB.State;
    for (let i = 0; i < S.gems.length; i++) if (MB.cam.onScreen(S.gems[i].x, S.gems[i].y, 24)) S.gems[i].draw(ctx);
    for (let i = 0; i < S.pickups.length; i++) if (MB.cam.onScreen(S.pickups[i].x, S.pickups[i].y, 24)) S.pickups[i].draw(ctx);
  };
  MB.drawOver_FX = function (ctx) {
    const S = MB.State;
    for (let i = 0; i < S.particles.length; i++) if (MB.cam.onScreen(S.particles[i].x, S.particles[i].y, 24)) S.particles[i].draw(ctx);
    for (let i = 0; i < S.damageTexts.length; i++) S.damageTexts[i].draw(ctx);
  };
  MB.drawWorldFX = function (ctx) { MB.drawGround_FX(ctx); MB.drawOver_FX(ctx); };

})(window.MB = window.MB || {});
