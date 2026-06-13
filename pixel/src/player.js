/* MEGABONK: PIXEL CRYPT — player.js
 * MB.Player (the hero) + MB.CHARACTERS (selectable gothic survivors).
 * Owns the canonical stat baseline (MB.Player.BASE_STATS). The DERIVED stats
 * are (re)written by MB.Upgrades.recomputeStats — this file only seeds sane
 * initial values so the player works before the first recompute.
 *
 * Cross-module references happen at CALL TIME via MB.* and are guarded so a
 * missing/late module never throws.
 */
(function (MB) {
  'use strict';

  /* ------------------------------------------------------------------ *
   * Tuning constants
   * ------------------------------------------------------------------ */
  var BASE_SPEED = 94;   // world px/s at speed=1
  var BASE_MAGNET = 46;  // pickup radius (world px) at magnet=1

  // Canonical stat defaults. recomputeStats starts every stat from here.
  var BASE_STATS = {
    might: 1,         // global damage multiplier
    area: 1,          // weapon size/range multiplier
    cooldownMult: 1,  // weapon cooldown multiplier (lower = faster)
    projSpeed: 1,     // projectile speed multiplier
    duration: 1,      // effect duration multiplier
    amount: 0,        // EXTRA projectiles added to weapons
    speed: 1,         // move speed multiplier
    magnet: 1,        // pickup radius multiplier
    growth: 1,        // XP gain multiplier
    luck: 1,          // drop / 4th-option luck
    armor: 0,         // flat damage reduction per hit
    regen: 0.4,       // hp per second (gentle baseline recovery)
    greed: 1,         // gold multiplier
    revives: 0,       // extra lives
    maxHp: 100        // max health
  };

  /* ------------------------------------------------------------------ *
   * Characters — gothic survivors of the midnight crypt
   * ------------------------------------------------------------------ */
  var CHARACTERS = [
    {
      id: 'bonker',
      name: 'The Bonker',
      sprite: 'hero',
      desc: 'A grave-robbing brute with a cursed maul. Balanced, hits a little harder.',
      startWeapon: 'hammer',
      base: { might: 1.1, maxHp: 110 }
    },
    {
      id: 'hexe',
      name: 'Hexe',
      sprite: 'hero',
      desc: 'A frail graveyard witch. Glass cannon — wider, stronger spells, thin skin.',
      startWeapon: 'wand',
      base: { maxHp: 80, area: 1.2, might: 1.1, speed: 1.05 }
    },
    {
      id: 'revenant',
      name: 'Revenant',
      sprite: 'hero',
      desc: 'A risen assassin. Lightning-fast, hurls an extra blade, but lightly built.',
      startWeapon: 'knife',
      base: { speed: 1.15, amount: 1, maxHp: 90 }
    }
  ];

  /* ------------------------------------------------------------------ *
   * Player
   * ------------------------------------------------------------------ */
  function Player(charDef) {
    charDef = charDef || {};
    var cb = charDef.base || {};

    // position / identity
    this.x = 0;
    this.y = 0;
    this.id = MB.nextId();
    this.sprite = charDef.sprite || 'hero';
    this.charId = charDef.id || 'bonker';

    // per-character stat overrides (recomputeStats re-applies these every time)
    this.charBase = cb;

    // --- seed derived stats: copy BASE_STATS, then apply char overrides ---
    for (var k in BASE_STATS) this[k] = BASE_STATS[k];
    for (var ck in cb) this[ck] = cb[ck];

    // health
    this.maxHp = this.maxHp || 100;
    this.hp = this.maxHp;

    // progression
    this.level = 1;
    this.xp = 0;
    this.xpToNext = (MB.Upgrades && MB.Upgrades.xpForLevel)
      ? MB.Upgrades.xpForLevel(this.level)
      : 5;

    // runtime
    this.weapons = [];
    this.passives = {};
    this.facing = { x: 1, y: 0 };
    this.moving = false;
    this.iframes = 0;
    this.radius = 8;          // contact radius

    // cosmetic clocks (avoids per-frame allocation in draw)
    this._bob = 0;
    this._leveledSfx = false;

    // Let the upgrade system author the authoritative derived stats.
    if (MB.Upgrades && MB.Upgrades.recomputeStats) {
      MB.Upgrades.recomputeStats(this);
    }
  }

  /* ----- per-frame logic ----- */
  Player.prototype.update = function (dt, input) {
    input = input || {};

    // 8-directional input
    var dx = (input.right ? 1 : 0) - (input.left ? 1 : 0);
    var dy = (input.down ? 1 : 0) - (input.up ? 1 : 0);

    // normalize (diagonal correction)
    var len = Math.sqrt(dx * dx + dy * dy);
    if (len > 0) {
      dx /= len;
      dy /= len;
      this.moving = true;
      this.facing.x = dx;
      this.facing.y = dy;
    } else {
      this.moving = false;
    }

    var spd = BASE_SPEED * this.speed;
    this.x += dx * spd * dt;
    this.y += dy * spd * dt;

    // bob clock
    this._bob += dt * (this.moving ? 12 : 3);

    // invulnerability decay
    if (this.iframes > 0) {
      this.iframes -= dt;
      if (this.iframes < 0) this.iframes = 0;
    }

    // regen
    if (this.regen > 0 && this.hp < this.maxHp) {
      this.hp += this.regen * dt;
      if (this.hp > this.maxHp) this.hp = this.maxHp;
    }

    // weapons tick last (they read the now-updated facing/position)
    var ws = this.weapons;
    for (var i = 0; i < ws.length; i++) {
      var w = ws[i];
      if (w && w.update) w.update(dt, this);
    }
  };

  /* ----- render ----- */
  Player.prototype.draw = function (ctx) {
    var t = (MB.State && MB.State.time) || 0;

    // frame: walk-cycle when moving, slow idle breathe otherwise
    var frame = this.moving
      ? (Math.floor(t * 8) % 2)
      : (Math.floor(t * 2) % 2);

    // resolve sprite geometry (for shadow sizing / feet position)
    var spr = (MB.Sprites && MB.Sprites.get) ? MB.Sprites.get('hero', frame) : null;
    var sw = spr ? spr.width : 16;
    var sh = spr ? spr.height : 20;

    var p = MB.cam.worldToScreen(this.x, this.y);
    var sc = MB.VIEW_SCALE;

    // --- soft shadow ellipse at the feet (drawn first, under the hero) ---
    var feetY = p.sy + (sh * 0.5) * sc;
    ctx.save();
    ctx.globalAlpha = 0.32;
    ctx.fillStyle = '#000';
    ctx.beginPath();
    var rw = sw * 0.46 * sc;
    if (ctx.ellipse) {
      ctx.ellipse(p.sx, feetY, rw, rw * 0.42, 0, 0, Math.PI * 2);
    } else {
      ctx.fillRect(p.sx - rw, feetY - rw * 0.42, rw * 2, rw * 0.84);
    }
    ctx.fill();
    ctx.restore();

    // gentle vertical bob
    var bobY = Math.sin(this._bob) * (this.moving ? 1.1 : 0.6);

    // hit-flash: flicker white while invulnerable
    var whiten = 0;
    var alpha = 1;
    if (this.iframes > 0) {
      var on = (Math.floor(t * 22) % 2) === 0;
      whiten = on ? 1 : 0;
      if (!on) alpha = 0.55; // subtle blink between flashes
    }

    MB.drawNamed(ctx, 'hero', frame, this.x, this.y + bobY, {
      flip: this.facing.x < 0,
      whiten: whiten,
      alpha: alpha,
      anchor: 'center'
    });
  };

  /* ----- damage / death ----- */
  Player.prototype.takeDamage = function (n) {
    if (this.iframes > 0) return;

    var dmg = Math.max(1, (n || 0) - this.armor);
    this.hp -= dmg;
    this.iframes = 0.78;

    if (MB.Audio && MB.Audio.sfx) MB.Audio.sfx('hurt');
    MB.spawnParticles(this.x, this.y, '#b5202a', 12, { speed: 130, life: 0.5, size: 2, gravity: 80 });
    MB.spawnDamageText(this.x, this.y - 14, '-' + Math.round(dmg), '#ff5a6e');
    if (MB.shake) MB.shake(5);

    if (this.hp <= 0) {
      if (this.revives > 0) {
        // cheat death
        this.revives -= 1;
        this.hp = this.maxHp * 0.5;
        this.iframes = 2;
        if (MB.Audio && MB.Audio.sfx) MB.Audio.sfx('levelup');
        MB.spawnParticles(this.x, this.y, '#ffe9a8', 40, { speed: 200, life: 0.9, size: 2 });
        MB.spawnParticles(this.x, this.y, '#ffffff', 18, { speed: 110, life: 0.7, size: 2 });
        MB.spawnDamageText(this.x, this.y - 20, 'REVIVE!', '#ffe9a8');
        if (MB.shake) MB.shake(10);
      } else {
        this.hp = 0;
        if (MB.Main && MB.Main.gameOver) MB.Main.gameOver();
      }
    }
  };

  // Contact damage helper (main may call this, or resolve contacts itself).
  Player.prototype.handleContacts = function (enemies) {
    if (this.iframes > 0 || !enemies) return;
    var r = this.radius;
    for (var i = 0; i < enemies.length; i++) {
      var e = enemies[i];
      if (!e || e.dead) continue;
      var rr = r + (e.radius || 6);
      if (MB.dist2(this.x, this.y, e.x, e.y) < rr * rr) {
        this.takeDamage(e.dmg || 0);
        break; // iframes now gate the rest of this frame
      }
    }
  };

  /* ----- progression ----- */
  Player.prototype.gainXp = function (n) {
    this.xp += n * this.growth;
    var leveled = false;
    while (this.xp >= this.xpToNext) {
      this.xp -= this.xpToNext;
      this.level += 1;
      this.xpToNext = (MB.Upgrades && MB.Upgrades.xpForLevel)
        ? MB.Upgrades.xpForLevel(this.level)
        : (this.xpToNext + 10);
      if (MB.Main && MB.Main.queueLevelUp) MB.Main.queueLevelUp();
      leveled = true;
    }
    if (leveled && MB.Audio && MB.Audio.sfx) MB.Audio.sfx('levelup');
  };

  Player.prototype.heal = function (n) {
    if (n <= 0) return;
    this.hp += n;
    if (this.hp > this.maxHp) this.hp = this.maxHp;
  };

  Player.prototype.addGold = function (n) {
    // greed is applied at the drop source (core coin pickup); just bank it.
    MB.State.gold += Math.max(0, Math.round(n));
  };

  Player.prototype.magnetRadius = function () {
    return BASE_MAGNET * this.magnet;
  };

  // Vacuum: mark every gem as collecting so they streak to the player,
  // granting XP on contact (handled by core Gem.update).
  Player.prototype.vacuumGems = function () {
    var gems = MB.State.gems;
    for (var i = 0; i < gems.length; i++) gems[i].collecting = true;
  };

  /* ------------------------------------------------------------------ *
   * Exports
   * ------------------------------------------------------------------ */
  Player.BASE_STATS = BASE_STATS;
  Player.BASE_SPEED = BASE_SPEED;
  Player.BASE_MAGNET = BASE_MAGNET;

  MB.Player = Player;
  MB.CHARACTERS = CHARACTERS;

})(window.MB = window.MB || {});
