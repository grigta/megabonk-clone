/* MEGABONK: PIXEL CRYPT — weapons.js
 * MB.Weapons: weapon roster (DEFS), the MB.Weapon class, projectile objects,
 * stat scaling (statsAt) and evolutions (tryEvolve).
 *
 * Cross-module calls are made at call-time via MB.* and defensively guarded so a
 * missing/late module never throws. Projectiles obey the contract:
 *   { x, y, dead:false, uid:MB.nextId(), update(dt), draw(ctx) }
 * Enemy damage numbers are owned by enemy.hit(); weapons only add impact FX.
 */
(function (MB) {
  'use strict';

  var TWO_PI = Math.PI * 2;

  /* =================================================================== *
   *  SCRATCH / SHARED HELPERS
   * =================================================================== */

  // throttle the 'shoot' sound so a wall of projectiles doesn't deafen
  var _lastShoot = 0;
  function shootSfx() {
    var t = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
    if (t - _lastShoot > 70) { _lastShoot = t; if (MB.Audio && MB.Audio.sfx) MB.Audio.sfx('shoot'); }
  }

  // crit chance from luck (player.luck defaults to 1 → ~4% base) plus a per-weapon bonus
  function rollCrit(player, bonus) {
    var luck = player ? (player.luck || 1) : 1;
    var c = MB.clamp(0.04 * luck + (bonus || 0), 0, 0.85);
    return Math.random() < c;
  }

  /* Apply one hit to an enemy. dirx/diry already scaled to encode this weapon's
   * knockback strength; enemy scales again by its own knockbackMult.
   * Returns true if the hit killed the enemy (so weapons can do on-kill effects). */
  function applyHit(e, dmg, dirx, diry, uid, player, critBonus, weapon) {
    if (!e || e.dead || !e.hit) return false;
    var crit = rollCrit(player, critBonus);
    var d = dmg;
    if (crit) {
      var cm = (weapon && weapon.def && weapon.def.critMult) ? weapon.def.critMult : 2;
      d *= cm;
      if (MB.Audio && MB.Audio.sfx) MB.Audio.sfx('crit');
    }
    d = Math.max(1, Math.round(d));
    return e.hit(d, dirx, diry, uid, crit);
  }

  function drawGlow(ctx, wx, wy, worldR, color, alpha) {
    var p = MB.cam.worldToScreen(wx, wy);
    var r = worldR * MB.VIEW_SCALE;
    var prev = ctx.globalAlpha;
    ctx.globalAlpha = alpha;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(p.sx, p.sy, r, 0, TWO_PI);
    ctx.fill();
    ctx.globalAlpha = prev;
  }

  /* =================================================================== *
   *  STAT SCALING  —  statsAt(def, level, player)
   * =================================================================== */
  // Early-game damage help that DECAYS to 1.0 by ~9 min — it breaks the low-DPS
  // death-spiral while the build is weak, then fades so it never inflates the
  // late-game power spike (which the enemy HP rubber-band is meant to govern).
  function earlyDmgBoost() {
    var t = (MB.State && MB.State.time) || 0;
    return 1 + 0.55 * (1 - Math.min(t / 540, 1));   // peak +55% (offsets the 4-weapon cap), → 1.0 by 9min
  }

  function statsAt(def, level, player) {
    var b = def.base;
    var gn = def.gain || {};
    var L = level - 1;                       // levels gained beyond 1

    var damage   = b.damage   * (1 + (gn.damage   != null ? gn.damage   : 0.20) * L) * earlyDmgBoost();
    var cooldown = b.cooldown * Math.pow((gn.cooldown != null ? gn.cooldown : 0.94), L);
    var area     = b.area     * (1 + (gn.area     != null ? gn.area     : 0.05) * L);
    var speed    = b.speed    * (1 + (gn.speed    != null ? gn.speed    : 0.02) * L);
    var duration = b.duration * (1 + (gn.duration != null ? gn.duration : 0.05) * L);
    var knock    = b.knockback* (1 + (gn.knockback!= null ? gn.knockback: 0.04) * L);
    var count    = b.count;
    var pierce   = b.pierce;

    if (gn.count)  { for (var i = 0; i < gn.count.length;  i++) if (level >= gn.count[i])  count++; }
    if (gn.pierce) { for (var j = 0; j < gn.pierce.length; j++) if (level >= gn.pierce[j]) pierce++; }

    // evolved weapons hit noticeably harder / wider
    if (def.isEvolved) { damage *= 1.25; area *= 1.15; knock *= 1.2; }

    // fold in player multipliers
    if (player) {
      damage   *= (player.might      || 1);
      area     *= (player.area       || 1);
      cooldown *= Math.max(0.4, (player.cooldownMult || 1));
      speed    *= (player.projSpeed  || 1);
      duration *= (player.duration   || 1);
      count    += (player.amount     || 0);
    }

    cooldown = Math.max(0.06, cooldown);
    if (count < 1) count = 1;
    if (pierce < 1) pierce = 1;

    return {
      damage: damage, cooldown: cooldown, count: Math.round(count),
      area: area, speed: speed, pierce: pierce, duration: duration, knockback: knock,
    };
  }

  /* =================================================================== *
   *  PROJECTILES
   * =================================================================== */

  /* ---- Whip slash : a crescent that hits everything in an arc -------- */
  function WhipSlash(cx, cy, dx, dy, s, hitR, weapon, player) {
    this.x = cx; this.y = cy;
    this.dx = dx; this.dy = dy;
    this.hitR = hitR;
    this.dmg = s.damage; this.knock = s.knockback;
    this.life = Math.max(0.16, s.duration); this.t = 0;
    this.dead = false; this.uid = MB.nextId();
    this.struck = null;            // lazily-built dedupe map
    this.weapon = weapon; this.player = player;
  }
  WhipSlash.prototype.update = function (dt) {
    this.t += dt;
    var list = (MB.Enemies && MB.Enemies.queryCircle) ? MB.Enemies.queryCircle(this.x, this.y, this.hitR) : null;
    if (list) {
      var r2 = this.hitR * this.hitR;
      var ks = this.knock * 0.18;
      for (var i = 0; i < list.length; i++) {
        var e = list[i];
        if (e.dead) continue;
        if (this.struck && this.struck[e.id]) continue;
        if (MB.dist2(this.x, this.y, e.x, e.y) > r2) continue;
        if (!this.struck) this.struck = {};
        this.struck[e.id] = 1;
        var killed = applyHit(e, this.dmg, this.dx * ks, this.dy * ks, this.uid, this.player, 0, this.weapon);
        if (killed && this.weapon.def.lifesteal && this.player && this.player.heal) {
          this.player.heal(this.weapon.def.lifesteal);
          MB.spawnParticles(e.x, e.y, '#ff5070', 4, { speed: 70, life: 0.4, size: 1 });
        }
      }
    }
    if (this.t >= this.life) this.dead = true;
  };
  WhipSlash.prototype.draw = function (ctx) {
    var k = this.t / this.life;
    var a = MB.clamp(1 - k, 0, 1);
    var grow = 0.7 + k * 0.5;
    var spr = (MB.Sprites && MB.Sprites.get) ? MB.Sprites.get('whip_slash') : null;
    var sw = spr ? spr.width : 24;
    var rot = Math.atan2(this.dy, this.dx);
    MB.drawNamed(ctx, 'whip_slash', 0, this.x, this.y, {
      alpha: a, flip: this.dx < 0, rot: this.dx < 0 ? (rot - Math.PI) : rot,
      scale: (this.hitR * 2 * grow) / sw,
    });
    drawGlow(ctx, this.x, this.y, this.hitR * 0.5 * grow, this.weapon.def.lifesteal ? '#b5202a' : '#e8e6d8', a * 0.10);
  };

  /* ---- Bolt : homing magic bolt (wand / holywand) ------------------- */
  function Bolt(x, y, ang, s, weapon, player) {
    this.x = x; this.y = y;
    var sp = s.speed;
    this.vx = Math.cos(ang) * sp; this.vy = Math.sin(ang) * sp;
    this.dmg = s.damage; this.pierce = s.pierce; this.knock = s.knockback;
    this.turn = weapon.def.turn || 6;
    this.life = 2.4; this.t = 0;
    this.dead = false; this.uid = MB.nextId();
    this.struck = null;
    this.weapon = weapon; this.player = player;
    this.target = null; this.retarget = 0;
    this.hitR = (weapon.def.hitR || 9) * Math.sqrt(s.area);
  }
  Bolt.prototype.update = function (dt) {
    this.t += dt;
    // re-acquire target
    this.retarget -= dt;
    if (this.retarget <= 0 || !this.target || this.target.dead) {
      this.target = (MB.Enemies && MB.Enemies.nearest) ? MB.Enemies.nearest(this.x, this.y, 720) : null;
      this.retarget = 0.18;
    }
    if (this.target && !this.target.dead) {
      var desired = MB.angle(this.x, this.y, this.target.x, this.target.y);
      var cur = Math.atan2(this.vy, this.vx);
      var diff = desired - cur;
      while (diff > Math.PI) diff -= TWO_PI;
      while (diff < -Math.PI) diff += TWO_PI;
      var step = this.turn * dt;
      if (diff > step) diff = step; else if (diff < -step) diff = -step;
      cur += diff;
      var sp = Math.sqrt(this.vx * this.vx + this.vy * this.vy);
      this.vx = Math.cos(cur) * sp; this.vy = Math.sin(cur) * sp;
    }
    this.x += this.vx * dt; this.y += this.vy * dt;

    var list = (MB.Enemies && MB.Enemies.queryCircle) ? MB.Enemies.queryCircle(this.x, this.y, this.hitR) : null;
    if (list) {
      var r2 = this.hitR * this.hitR;
      var inv = 1 / (Math.sqrt(this.vx * this.vx + this.vy * this.vy) || 1);
      var ks = this.knock * 0.18;
      for (var i = 0; i < list.length; i++) {
        var e = list[i];
        if (e.dead) continue;
        if (this.struck && this.struck[e.id]) continue;
        if (MB.dist2(this.x, this.y, e.x, e.y) > r2) continue;
        if (!this.struck) this.struck = {};
        this.struck[e.id] = 1;
        applyHit(e, this.dmg, this.vx * inv * ks, this.vy * inv * ks, this.uid, this.player, 0, this.weapon);
        MB.spawnParticles(this.x, this.y, '#bcd7e8', 3, { speed: 60, life: 0.25, size: 1 });
        this.pierce--;
        if (this.pierce < 0) { this.dead = true; break; }
      }
    }
    if (this.t >= this.life) this.dead = true;
  };
  Bolt.prototype.draw = function (ctx) {
    var rot = Math.atan2(this.vy, this.vx);
    var col = this.weapon.def.holy ? '#fff2b0' : '#9ad0ff';
    drawGlow(ctx, this.x, this.y, 5, col, 0.35);
    MB.drawNamed(ctx, 'proj_orb', 0, this.x, this.y, { rot: rot, scale: 1 + (this.weapon.def.holy ? 0.3 : 0) });
  };

  /* ---- Knife : straight piercing throw (knife / thousandknives) ----- */
  function Knife(x, y, ang, s, weapon, player) {
    this.x = x; this.y = y; this.ang = ang;
    var sp = s.speed;
    this.vx = Math.cos(ang) * sp; this.vy = Math.sin(ang) * sp;
    this.dmg = s.damage; this.pierce = s.pierce; this.knock = s.knockback;
    this.life = Math.max(0.5, s.duration); this.t = 0;
    this.hitR = (weapon.def.hitR || 9) * Math.sqrt(s.area);
    this.dead = false; this.uid = MB.nextId();
    this.struck = null;
    this.weapon = weapon; this.player = player;
  }
  Knife.prototype.update = function (dt) {
    this.t += dt;
    this.x += this.vx * dt; this.y += this.vy * dt;
    var list = (MB.Enemies && MB.Enemies.queryCircle) ? MB.Enemies.queryCircle(this.x, this.y, this.hitR) : null;
    if (list) {
      var r2 = this.hitR * this.hitR;
      var inv = 1 / (Math.sqrt(this.vx * this.vx + this.vy * this.vy) || 1);
      var ks = this.knock * 0.18;
      for (var i = 0; i < list.length; i++) {
        var e = list[i];
        if (e.dead) continue;
        if (this.struck && this.struck[e.id]) continue;
        if (MB.dist2(this.x, this.y, e.x, e.y) > r2) continue;
        if (!this.struck) this.struck = {};
        this.struck[e.id] = 1;
        applyHit(e, this.dmg, this.vx * inv * ks, this.vy * inv * ks, this.uid, this.player, 0, this.weapon);
        this.pierce--;
        if (this.pierce < 0) { this.dead = true; break; }
      }
    }
    if (this.t >= this.life || !MB.cam.onScreen(this.x, this.y, 160)) this.dead = true;
  };
  Knife.prototype.draw = function (ctx) {
    MB.drawNamed(ctx, 'proj_knife', 0, this.x, this.y, { rot: this.ang });
  };

  /* ---- Orbiting tome (bible / unholyvespers) ------------------------ */
  function OrbitOrb(weapon, player, index) {
    this.weapon = weapon; this.player = player; this.index = index;
    this.x = player.x; this.y = player.y;
    this.dead = false; this.uid = MB.nextId();
    this.tick = MB.rand(0, 0.2); this.spin = Math.random() * TWO_PI;
  }
  OrbitOrb.prototype.update = function (dt) {
    var w = this.weapon, player = this.player;
    if (w._disposed || MB.State.player !== player) { this.dead = true; return; }
    var s = w.curStats; if (!s) return;
    var count = Math.max(1, w.persist.length);
    var radius = (w.def.radius || 34) * s.area;
    var ang = (w._phase || 0) + (this.index / count) * TWO_PI;
    this.x = player.x + Math.cos(ang) * radius;
    this.y = player.y + Math.sin(ang) * radius;
    this.spin += dt * 6;
    this.tick -= dt;
    if (this.tick <= 0) {
      this.tick = w.def.hitInterval || 0.32;
      var hitR = (w.def.hitR || 13) * Math.sqrt(s.area);
      var list = (MB.Enemies && MB.Enemies.queryCircle) ? MB.Enemies.queryCircle(this.x, this.y, hitR) : null;
      if (list) {
        var uid = MB.nextId();           // fresh uid each tick → re-hit allowed
        var r2 = hitR * hitR;
        var ks = s.knockback * 0.16;
        for (var i = 0; i < list.length; i++) {
          var e = list[i];
          if (e.dead) continue;
          if (MB.dist2(this.x, this.y, e.x, e.y) > r2) continue;
          var n = MB.norm(e.x - player.x, e.y - player.y);
          applyHit(e, s.damage, n.x * ks, n.y * ks, uid, player, 0, w);
        }
      }
    }
  };
  OrbitOrb.prototype.draw = function (ctx) {
    drawGlow(ctx, this.x, this.y, 7, this.weapon.def.unholy ? '#8a5cff' : '#d8c7ff', 0.22);
    MB.drawNamed(ctx, 'proj_bible', 0, this.x, this.y, { rot: this.spin });
  };

  /* ---- Garlic aura (garlic / souleater) ----------------------------- */
  function GarlicAura(weapon, player) {
    this.weapon = weapon; this.player = player;
    this.x = player.x; this.y = player.y;
    this.dead = false; this.uid = MB.nextId();
    this.tick = 0; this.pulse = Math.random() * TWO_PI;
  }
  GarlicAura.prototype.radius = function (s) {
    var r = (this.weapon.def.radius || 42) * s.area;
    if (this.weapon.def.growKill) r += Math.min((this.weapon._kills || 0) * 0.05, 34);
    return r;
  };
  GarlicAura.prototype.update = function (dt) {
    var w = this.weapon, player = this.player;
    if (w._disposed || MB.State.player !== player) { this.dead = true; return; }
    this.x = player.x; this.y = player.y;
    this.pulse += dt * 4;
    var s = w.curStats; if (!s) return;
    var radius = this.radius(s);
    this.tick -= dt;
    if (this.tick <= 0) {
      this.tick = Math.max(0.12, s.cooldown);
      var list = (MB.Enemies && MB.Enemies.queryCircle) ? MB.Enemies.queryCircle(player.x, player.y, radius) : null;
      if (list) {
        var uid = MB.nextId();
        var r2 = radius * radius;
        var ks = s.knockback * 0.2;
        for (var i = 0; i < list.length; i++) {
          var e = list[i];
          if (e.dead) continue;
          if (MB.dist2(player.x, player.y, e.x, e.y) > r2) continue;
          var n = MB.norm(e.x - player.x, e.y - player.y);
          var killed = applyHit(e, s.damage, n.x * ks, n.y * ks, uid, player, 0, w);
          if (killed && w.def.lifesteal && player.heal) {
            player.heal(w.def.lifesteal);
            w._kills = (w._kills || 0) + 1;
            MB.spawnParticles(e.x, e.y, '#b478ff', 4, { speed: 80, life: 0.4, size: 1 });
          }
        }
      }
    }
  };
  GarlicAura.prototype.draw = function (ctx) {
    var s = this.weapon.curStats; if (!s) return;
    var radius = this.radius(s);
    var p = MB.cam.worldToScreen(this.x, this.y);
    var r = radius * MB.VIEW_SCALE;
    var pulse = 0.5 + 0.5 * Math.sin(this.pulse);
    var rgb = this.weapon.def.auraRGB || '155,232,106';
    ctx.save();
    var g = ctx.createRadialGradient(p.sx, p.sy, r * 0.25, p.sx, p.sy, r);
    g.addColorStop(0, 'rgba(' + rgb + ',0.015)');
    g.addColorStop(0.65, 'rgba(' + rgb + ',0.09)');
    g.addColorStop(1, 'rgba(' + rgb + ',' + (0.16 + pulse * 0.12).toFixed(3) + ')');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(p.sx, p.sy, r, 0, TWO_PI); ctx.fill();
    ctx.globalAlpha = 0.4 + pulse * 0.35;
    ctx.lineWidth = 2;
    ctx.strokeStyle = 'rgba(' + rgb + ',0.8)';
    ctx.beginPath(); ctx.arc(p.sx, p.sy, r, 0, TWO_PI); ctx.stroke();
    ctx.restore();
  };

  /* ---- Fireball + Burn zone (fireball / hellfire) ------------------- */
  function FireBall(x, y, ang, s, weapon, player) {
    this.x = x; this.y = y; this.ang = ang;
    var sp = s.speed;
    this.vx = Math.cos(ang) * sp; this.vy = Math.sin(ang) * sp;
    this.dmg = s.damage; this.area = s.area; this.dur = s.duration; this.knock = s.knockback;
    this.travel = weapon.def.travel || 0.5; this.t = 0;
    this.hitR = (weapon.def.hitR || 11) * Math.sqrt(s.area);
    this.dead = false; this.uid = MB.nextId();
    this.weapon = weapon; this.player = player; this.spin = 0;
  }
  FireBall.prototype.explode = function () {
    if (this.dead) return;
    this.dead = true;
    var def = this.weapon.def;
    var radius = (def.zoneR || 26) * this.area;
    MB.State.projectiles.push(new BurnZone(this.x, this.y, this.dmg, radius, this.dur, this.weapon, this.player));
    MB.spawnParticles(this.x, this.y, '#ffb24a', def.big ? 22 : 12, { speed: def.big ? 180 : 130, life: 0.5, size: 2 });
    MB.spawnParticles(this.x, this.y, '#ff5a2a', 6, { speed: 90, life: 0.6, size: 2, gravity: -40 });
    if (def.big && MB.shake) MB.shake(5);
  };
  FireBall.prototype.update = function (dt) {
    this.t += dt; this.spin += dt * 14;
    this.x += this.vx * dt; this.y += this.vy * dt;
    var near = (MB.Enemies && MB.Enemies.nearest) ? MB.Enemies.nearest(this.x, this.y, this.hitR) : null;
    if (near) { this.explode(); return; }
    if (this.t >= this.travel) this.explode();
  };
  FireBall.prototype.draw = function (ctx) {
    drawGlow(ctx, this.x, this.y, 8, '#ff7a2a', 0.4);
    MB.drawNamed(ctx, 'proj_fire', 0, this.x, this.y, { rot: this.spin, scale: 0.9 + this.area * 0.15 });
  };

  function BurnZone(x, y, dmg, radius, dur, weapon, player) {
    this.x = x; this.y = y; this.dmg = dmg; this.radius = radius;
    this.life = Math.max(0.8, dur); this.t = 0; this.tick = 0; this.ember = 0;
    this.dead = false; this.uid = MB.nextId();
    this.weapon = weapon; this.player = player;
  }
  BurnZone.prototype.update = function (dt) {
    this.t += dt;
    if (this.t >= this.life) { this.dead = true; return; }
    this.tick -= dt;
    if (this.tick <= 0) {
      this.tick = this.weapon.def.burnInterval || 0.4;
      var list = (MB.Enemies && MB.Enemies.queryCircle) ? MB.Enemies.queryCircle(this.x, this.y, this.radius) : null;
      if (list) {
        var uid = MB.nextId();
        var r2 = this.radius * this.radius;
        for (var i = 0; i < list.length; i++) {
          var e = list[i];
          if (e.dead) continue;
          if (MB.dist2(this.x, this.y, e.x, e.y) > r2) continue;
          var n = MB.norm(e.x - this.x, e.y - this.y);
          applyHit(e, this.dmg, n.x * 0.2, n.y * 0.2, uid, this.player, 0, this.weapon);
        }
      }
    }
    this.ember -= dt;
    if (this.ember <= 0) {
      this.ember = 0.08;
      var a = Math.random() * TWO_PI, rr = Math.random() * this.radius;
      MB.spawnParticles(this.x + Math.cos(a) * rr, this.y + Math.sin(a) * rr, '#ffb24a', 1,
        { speed: 20, life: 0.5, size: 1, gravity: -60 });
    }
  };
  BurnZone.prototype.draw = function (ctx) {
    var p = MB.cam.worldToScreen(this.x, this.y);
    var r = this.radius * MB.VIEW_SCALE;
    var fade = MB.clamp(1 - this.t / this.life, 0, 1);
    var flick = 0.75 + 0.25 * Math.sin(this.t * 26 + this.x * 0.3);
    ctx.save();
    var g = ctx.createRadialGradient(p.sx, p.sy, r * 0.15, p.sx, p.sy, r);
    g.addColorStop(0, 'rgba(255,220,120,' + (0.42 * fade * flick).toFixed(3) + ')');
    g.addColorStop(0.5, 'rgba(255,120,40,' + (0.30 * fade).toFixed(3) + ')');
    g.addColorStop(1, 'rgba(150,30,20,0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(p.sx, p.sy, r, 0, TWO_PI); ctx.fill();
    ctx.restore();
  };

  /* ---- Lightning strike (lightning / thunderloop) ------------------- */
  function Lightning(tx, ty, s, weapon, player, target) {
    this.x = tx; this.y = ty;
    this.life = 0.32; this.t = 0;
    this.dead = false; this.uid = MB.nextId();
    this.weapon = weapon; this.player = player;
    this.aoeR = (weapon.def.aoeR || 30) * s.area;
    this.chainsAt = [];                // points to draw chain arcs to

    // primary AoE strike — applied immediately
    var uid = this.uid;
    var list = (MB.Enemies && MB.Enemies.queryCircle) ? MB.Enemies.queryCircle(tx, ty, this.aoeR) : null;
    var r2 = this.aoeR * this.aoeR;
    if (list) {
      var ks = s.knockback * 0.16;
      for (var i = 0; i < list.length; i++) {
        var e = list[i];
        if (e.dead) continue;
        if (MB.dist2(tx, ty, e.x, e.y) > r2) continue;
        var n = MB.norm(e.x - tx, e.y - ty);
        applyHit(e, s.damage, n.x * ks, n.y * ks, uid, player, weapon.def.critBonus || 0, weapon);
      }
    }
    // chains (thunderloop) — jump to nearby enemies for reduced damage
    var chains = weapon.def.chain || 0;
    if (chains > 0 && MB.Enemies && MB.Enemies.queryCircle) {
      var pool = MB.Enemies.queryCircle(tx, ty, 150);
      var hit = {};
      var cx = tx, cy = ty;
      for (var c = 0; c < chains; c++) {
        var best = null, bd = 1e9;
        for (var k = 0; k < pool.length; k++) {
          var en = pool[k];
          if (en.dead || hit[en.id]) continue;
          var dd = MB.dist2(cx, cy, en.x, en.y);
          if (dd < bd && dd > 4) { bd = dd; best = en; }
        }
        if (!best) break;
        hit[best.id] = 1;
        var nn = MB.norm(best.x - cx, best.y - cy);
        applyHit(best, s.damage * 0.7, nn.x * 0.16, nn.y * 0.16, MB.nextId(), player, weapon.def.critBonus || 0, weapon);
        this.chainsAt.push(cx, cy, best.x, best.y);
        cx = best.x; cy = best.y;
      }
    }

    MB.spawnParticles(tx, ty, '#cfe8ff', 10, { speed: 130, life: 0.4, size: 2 });
    if (MB.shake) MB.shake(weapon.def.big ? 5 : 3);
    if (MB.Audio && MB.Audio.sfx) MB.Audio.sfx('hit');

    // pre-bake a jagged bolt from the sky
    this.seg = [];
    var sx = tx + MB.rand(-12, 12), sy = ty - 210;
    var steps = 7;
    for (var g = 0; g <= steps; g++) {
      var tt = g / steps;
      this.seg.push(MB.lerp(sx, tx, tt) + (g === 0 || g === steps ? 0 : MB.rand(-10, 10)));
      this.seg.push(MB.lerp(sy, ty, tt));
    }
  }
  Lightning.prototype.update = function (dt) {
    this.t += dt;
    if (this.t >= this.life) this.dead = true;
  };
  Lightning.prototype.draw = function (ctx) {
    var a = MB.clamp(1 - this.t / this.life, 0, 1);
    ctx.save();
    // expanding flash ring at strike point
    var pr = MB.cam.worldToScreen(this.x, this.y);
    var rr = (this.aoeR * (0.4 + (1 - a) * 0.9)) * MB.VIEW_SCALE;
    ctx.globalAlpha = a * 0.5;
    ctx.fillStyle = '#eaf4ff';
    ctx.beginPath(); ctx.arc(pr.sx, pr.sy, rr, 0, TWO_PI); ctx.fill();
    // the bolt
    ctx.globalAlpha = a;
    ctx.lineJoin = 'round';
    ctx.lineWidth = 6; ctx.strokeStyle = 'rgba(150,200,255,0.5)';
    this._bolt(ctx, this.seg);
    ctx.lineWidth = 2; ctx.strokeStyle = '#f4faff';
    this._bolt(ctx, this.seg);
    // chain arcs
    if (this.chainsAt.length) {
      ctx.lineWidth = 2; ctx.strokeStyle = 'rgba(190,225,255,' + (a * 0.9) + ')';
      for (var i = 0; i < this.chainsAt.length; i += 4) {
        var p0 = MB.cam.worldToScreen(this.chainsAt[i], this.chainsAt[i + 1]);
        var p1 = MB.cam.worldToScreen(this.chainsAt[i + 2], this.chainsAt[i + 3]);
        ctx.beginPath(); ctx.moveTo(p0.sx, p0.sy); ctx.lineTo(p1.sx, p1.sy); ctx.stroke();
      }
    }
    ctx.restore();
  };
  Lightning.prototype._bolt = function (ctx, seg) {
    ctx.beginPath();
    var p = MB.cam.worldToScreen(seg[0], seg[1]);
    ctx.moveTo(p.sx, p.sy);
    for (var i = 2; i < seg.length; i += 2) {
      p = MB.cam.worldToScreen(seg[i], seg[i + 1]);
      ctx.lineTo(p.sx, p.sy);
    }
    ctx.stroke();
  };

  /* ---- Hammer head : the signature MEGABONK (hammer / megabonk) ------ */
  function HammerHead(weapon, player, index) {
    this.weapon = weapon; this.player = player; this.index = index;
    this.x = player.x; this.y = player.y;
    this.dead = false; this.uid = MB.nextId();
    this.tick = MB.rand(0, 0.25);
    this.ang = 0;
  }
  HammerHead.prototype.update = function (dt) {
    var w = this.weapon, player = this.player;
    if (w._disposed || MB.State.player !== player) { this.dead = true; return; }
    var s = w.curStats; if (!s) return;
    var count = Math.max(1, w.persist.length);
    var radius = (w.def.radius || 32) * s.area;
    this.ang = (w._phase || 0) + (this.index / count) * TWO_PI;
    this.x = player.x + Math.cos(this.ang) * radius;
    this.y = player.y + Math.sin(this.ang) * radius;
    this.tick -= dt;
    if (this.tick <= 0) {
      this.tick = w.def.hitInterval || 0.34;
      var hitR = (w.def.hitR || 20) * Math.sqrt(s.area);
      var list = (MB.Enemies && MB.Enemies.queryCircle) ? MB.Enemies.queryCircle(this.x, this.y, hitR) : null;
      if (list) {
        var uid = MB.nextId();
        var r2 = hitR * hitR;
        var ks = s.knockback * 0.26;       // hammers fling enemies hard
        var bonked = false;
        for (var i = 0; i < list.length; i++) {
          var e = list[i];
          if (e.dead) continue;
          if (MB.dist2(this.x, this.y, e.x, e.y) > r2) continue;
          var n = MB.norm(e.x - this.x, e.y - this.y);
          applyHit(e, s.damage, n.x * ks, n.y * ks, uid, player, w.def.critBonus || 0, w);
          bonked = true;
        }
        if (bonked) {
          MB.spawnParticles(this.x, this.y, '#f2c14e', w.def.big ? 8 : 4, { speed: 110, life: 0.35, size: 2 });
          if (w.def.bonkShake && MB.shake) MB.shake(w.def.bonkShake);
        }
      }
    }
  };
  HammerHead.prototype.draw = function (ctx) {
    var s = this.weapon.curStats;
    var sc = (this.weapon.def.big ? 1.7 : 1.1) * (s ? (0.7 + s.area * 0.3) : 1);
    // swoosh trail
    var p = MB.cam.worldToScreen(this.x, this.y);
    drawGlow(ctx, this.x, this.y, this.weapon.def.big ? 14 : 9, '#f2c14e', 0.12);
    MB.drawNamed(ctx, 'proj_hammer', 0, this.x, this.y, { rot: this.ang + Math.PI / 2, scale: sc });
  };

  /* =================================================================== *
   *  WEAPON CLASS
   * =================================================================== */
  function Weapon(defId) {
    this.id = defId;
    this.def = MB.Weapons.DEFS[defId];
    this.level = 1;
    this.timer = MB.rand(0, 0.35);     // desync transient weapons
    this.evolved = !!(this.def && this.def.isEvolved);
    this.persist = [];                 // live persistent projectiles (orbit/aura/hammer)
    this.curStats = null;
    this._phase = Math.random() * TWO_PI;
    this._disposed = false;
    this._kills = 0;
  }

  Weapon.prototype.stats = function (player) { return statsAt(this.def, this.level, player); };

  Weapon.prototype.levelUp = function () {
    if (!this.def) return;
    this.level = Math.min(this.level + 1, this.def.maxLevel);
    // persistent weapons re-layout automatically next update (count/radius re-read)
  };

  Weapon.prototype.dispose = function () {
    for (var i = 0; i < this.persist.length; i++) this.persist[i].dead = true;
    this.persist.length = 0;
    this._disposed = true;
  };

  Weapon.prototype._ensure = function (player, kind, count) {
    var live = 0, i;
    for (i = 0; i < this.persist.length; i++) if (!this.persist[i].dead) live++;
    if (live === count && this.persist.length === count) return;
    for (i = 0; i < this.persist.length; i++) this.persist[i].dead = true;
    this.persist.length = 0;
    for (i = 0; i < count; i++) {
      var proj;
      if (kind === 'orbit') proj = new OrbitOrb(this, player, i);
      else if (kind === 'aura') proj = new GarlicAura(this, player);
      else proj = new HammerHead(this, player, i);
      this.persist.push(proj);
      MB.State.projectiles.push(proj);
    }
  };

  Weapon.prototype.update = function (dt, player) {
    var def = this.def;
    if (!def) return;
    var kind = def.kind;

    if (kind === 'orbit' || kind === 'aura' || kind === 'hammer') {
      this.curStats = this.stats(player);
      this._phase += this.curStats.speed * dt;
      var count = (kind === 'aura') ? 1 : Math.max(1, this.curStats.count);
      this._ensure(player, kind, count);
      return;
    }

    // transient weapons: countdown + fire
    this.timer -= dt;
    if (this.timer <= 0) {
      this.fire(player);
      var s = this.stats(player);
      this.timer += s.cooldown;
      if (this.timer <= 0) this.timer = s.cooldown;   // never spiral negative
    }
  };

  Weapon.prototype.fire = function (player) {
    var def = this.def;
    var s = this.stats(player);
    var kind = def.kind;
    var count = Math.max(1, s.count);
    var i, fx, fy, n, ang, tgt;

    if (kind === 'whip') {
      fx = (player.facing ? player.facing.x : 1) || 0;
      fy = (player.facing ? player.facing.y : 0) || 0;
      if (fx === 0 && fy === 0) fx = 1;
      n = MB.norm(fx, fy); fx = n.x; fy = n.y;
      var reach = (def.reach || 32) * s.area;
      var hitR = (def.hitR || 28) * s.area;
      for (i = 0; i < count; i++) {
        var dx = fx, dy = fy;
        if (i % 2 === 1) { dx = -fx; dy = -fy; }        // alternate sides
        var px = player.x + dx * reach, py = player.y + dy * reach;
        MB.State.projectiles.push(new WhipSlash(px, py, dx, dy, s, hitR, this, player));
      }
      MB.spawnParticles(player.x + fx * reach, player.y + fy * reach, '#ffe0e0', 4, { speed: 90, life: 0.22, size: 1 });
      shootSfx();

    } else if (kind === 'homing') {
      for (i = 0; i < count; i++) {
        tgt = (MB.Enemies && MB.Enemies.nearest) ? MB.Enemies.nearest(player.x, player.y, 720) : null;
        if (tgt) ang = MB.angle(player.x, player.y, tgt.x, tgt.y);
        else ang = Math.atan2((player.facing && player.facing.y) || 0, (player.facing && player.facing.x) || 1);
        ang += MB.rand(-0.22, 0.22) * i;
        var b = new Bolt(player.x, player.y, ang, s, this, player);
        b.target = tgt;
        MB.State.projectiles.push(b);
      }
      shootSfx();

    } else if (kind === 'projectile') {
      fx = (player.facing ? player.facing.x : 1) || 0;
      fy = (player.facing ? player.facing.y : 0) || 0;
      if (fx === 0 && fy === 0) fx = 1;
      n = MB.norm(fx, fy);
      var baseAng = Math.atan2(n.y, n.x);
      var spread = (def.spread != null) ? def.spread : 0.12;
      for (i = 0; i < count; i++) {
        var off = (count === 1) ? 0 : (i - (count - 1) / 2) * spread;
        MB.State.projectiles.push(new Knife(player.x, player.y, baseAng + off, s, this, player));
      }
      shootSfx();

    } else if (kind === 'drop') {
      for (i = 0; i < count; i++) {
        tgt = (MB.Enemies && MB.Enemies.nearest) ? MB.Enemies.nearest(player.x, player.y, 520) : null;
        if (tgt) ang = MB.angle(player.x, player.y, tgt.x, tgt.y);
        else ang = Math.atan2((player.facing && player.facing.y) || 0, (player.facing && player.facing.x) || 1);
        ang += (count === 1 ? 0 : (i - (count - 1) / 2) * 0.32);
        MB.State.projectiles.push(new FireBall(player.x, player.y, ang, s, this, player));
      }
      shootSfx();

    } else if (kind === 'lightning') {
      for (i = 0; i < count; i++) {
        tgt = (MB.Enemies && MB.Enemies.randomOnScreen) ? MB.Enemies.randomOnScreen() : null;
        if (!tgt) break;
        MB.State.projectiles.push(new Lightning(tgt.x, tgt.y, s, this, player, tgt));
      }
      if (MB.Audio && MB.Audio.sfx) MB.Audio.sfx('shoot');
    }
  };

  MB.Weapon = Weapon;

  /* =================================================================== *
   *  WEAPON DEFINITIONS
   * =================================================================== */
  var DEFS = {

    /* ----- WHIP ----- */
    whip: {
      id: 'whip', name: 'Bone Whip', icon: 'icon_whip', kind: 'whip', maxLevel: 8,
      desc: 'Cracks a crescent in your facing direction, hitting all in the arc.',
      base: { damage: 12, cooldown: 1.15, count: 1, area: 1, speed: 0, pierce: 99, duration: 0.26, knockback: 6 },
      gain: { damage: 0.24, cooldown: 0.93, area: 0.07, knockback: 0.04, count: [3, 6, 8] },
      reach: 30, hitR: 28,
      evolvesTo: 'bloodywhip', evolvePassive: 'hollowheart',
    },
    bloodywhip: {
      id: 'bloodywhip', name: 'Bloody Whip', icon: 'icon_bloodywhip', kind: 'whip', maxLevel: 8, isEvolved: true,
      desc: 'Drinks the dead — heals you for every kill it scores.',
      base: { damage: 22, cooldown: 0.9, count: 2, area: 1.3, speed: 0, pierce: 99, duration: 0.3, knockback: 8 },
      gain: { damage: 0.24, cooldown: 0.93, area: 0.07, knockback: 0.04, count: [4, 7] },
      reach: 34, hitR: 32, lifesteal: 1.5,
      evolvesTo: null, evolvePassive: null,
    },

    /* ----- WAND ----- */
    wand: {
      id: 'wand', name: 'Soul Wand', icon: 'icon_wand', kind: 'homing', maxLevel: 8,
      desc: 'Fires a bolt that seeks the nearest cursed soul.',
      base: { damage: 10, cooldown: 1.0, count: 1, area: 1, speed: 230, pierce: 1, duration: 0, knockback: 4 },
      gain: { damage: 0.22, cooldown: 0.9, speed: 0.04, count: [3, 5, 7] },
      turn: 6, hitR: 9,
      evolvesTo: 'holywand', evolvePassive: 'emptytome',
    },
    holywand: {
      id: 'holywand', name: 'Holy Wand', icon: 'icon_holywand', kind: 'homing', maxLevel: 8, isEvolved: true, holy: true,
      desc: 'No delay. Fires sanctified bolts almost without pause.',
      base: { damage: 14, cooldown: 0.34, count: 2, area: 1, speed: 290, pierce: 2, duration: 0, knockback: 4 },
      gain: { damage: 0.2, cooldown: 0.95, speed: 0.04, count: [4, 7] },
      turn: 12, hitR: 10,
      evolvesTo: null, evolvePassive: null,
    },

    /* ----- KNIFE ----- */
    knife: {
      id: 'knife', name: 'Throwing Knife', icon: 'icon_knife', kind: 'projectile', maxLevel: 8,
      desc: 'Hurls fast piercing knives in the way you face.',
      base: { damage: 12, cooldown: 0.7, count: 2, area: 1, speed: 330, pierce: 1, duration: 1.0, knockback: 3 },
      gain: { damage: 0.2, cooldown: 0.93, speed: 0.05, count: [2, 4, 6, 8], pierce: [5] },
      spread: 0.1, hitR: 9,
      evolvesTo: 'thousandknives', evolvePassive: 'bracer',
    },
    thousandknives: {
      id: 'thousandknives', name: 'Thousand Knives', icon: 'icon_thousandknives', kind: 'projectile', maxLevel: 8, isEvolved: true,
      desc: 'A fan of high-pierce blades that shreds whole columns.',
      base: { damage: 12, cooldown: 0.5, count: 5, area: 1, speed: 370, pierce: 4, duration: 1.1, knockback: 3 },
      gain: { damage: 0.2, cooldown: 0.94, speed: 0.05, count: [4, 7], pierce: [3, 6] },
      spread: 0.16, hitR: 10,
      evolvesTo: null, evolvePassive: null,
    },

    /* ----- BIBLE ----- */
    bible: {
      id: 'bible', name: 'Grave Tome', icon: 'icon_bible', kind: 'orbit', maxLevel: 8,
      desc: 'Cursed tomes orbit you, grinding anything they touch.',
      base: { damage: 9, cooldown: 0, count: 1, area: 1, speed: 2.6, pierce: 0, duration: 0, knockback: 2 },
      gain: { damage: 0.2, area: 0.08, speed: 0.03, count: [2, 4, 6, 8] },
      radius: 34, hitR: 13, hitInterval: 0.3,
      evolvesTo: 'unholyvespers', evolvePassive: 'spellbinder',
    },
    unholyvespers: {
      id: 'unholyvespers', name: 'Unholy Vespers', icon: 'icon_unholyvespers', kind: 'orbit', maxLevel: 8, isEvolved: true, unholy: true,
      desc: 'A wider choir of grinding tomes, faster and deadlier.',
      base: { damage: 18, cooldown: 0, count: 4, area: 1.4, speed: 3.0, pierce: 0, duration: 0, knockback: 3 },
      gain: { damage: 0.2, area: 0.08, speed: 0.03, count: [4, 7] },
      radius: 42, hitR: 15, hitInterval: 0.26,
      evolvesTo: null, evolvePassive: null,
    },

    /* ----- GARLIC ----- */
    garlic: {
      id: 'garlic', name: 'Grave Garlic', icon: 'icon_garlic', kind: 'aura', maxLevel: 8,
      desc: 'A reeking ring that damages and repels everything near you.',
      base: { damage: 6, cooldown: 0.5, count: 1, area: 1, speed: 0, pierce: 0, duration: 0, knockback: 5 },
      gain: { damage: 0.22, cooldown: 0.95, area: 0.1, knockback: 0.04 },
      radius: 42, auraRGB: '155,232,106',
      evolvesTo: 'souleater', evolvePassive: 'pummarola',
    },
    souleater: {
      id: 'souleater', name: 'Soul Eater', icon: 'icon_souleater', kind: 'aura', maxLevel: 8, isEvolved: true,
      desc: 'Feasts on souls — heals on kill and swells as the bodies pile up.',
      base: { damage: 12, cooldown: 0.4, count: 1, area: 1.4, speed: 0, pierce: 0, duration: 0, knockback: 7 },
      gain: { damage: 0.22, cooldown: 0.96, area: 0.1, knockback: 0.04 },
      radius: 48, auraRGB: '180,120,255', lifesteal: 1.0, growKill: true,
      evolvesTo: null, evolvePassive: null,
    },

    /* ----- FIREBALL ----- */
    fireball: {
      id: 'fireball', name: 'Hex Fireball', icon: 'icon_fireball', kind: 'drop', maxLevel: 8,
      desc: 'Lobs a fireball that bursts into a burning patch of ground.',
      base: { damage: 14, cooldown: 1.6, count: 1, area: 1, speed: 190, pierce: 1, duration: 2.0, knockback: 4 },
      gain: { damage: 0.24, cooldown: 0.92, area: 0.1, duration: 0.06, count: [4, 7] },
      travel: 0.5, zoneR: 26, hitR: 11, burnInterval: 0.45,
      evolvesTo: 'hellfire', evolvePassive: 'spellbinder',
    },
    hellfire: {
      id: 'hellfire', name: 'Hellfire', icon: 'icon_hellfire', kind: 'drop', maxLevel: 8, isEvolved: true, big: true,
      desc: 'Giant lingering infernos that scorch the graveyard.',
      base: { damage: 26, cooldown: 1.3, count: 2, area: 1.6, speed: 200, pierce: 1, duration: 3.5, knockback: 5 },
      gain: { damage: 0.24, cooldown: 0.93, area: 0.1, duration: 0.06, count: [4, 7] },
      travel: 0.55, zoneR: 36, hitR: 13, burnInterval: 0.4,
      evolvesTo: null, evolvePassive: null,
    },

    /* ----- LIGHTNING ----- */
    lightning: {
      id: 'lightning', name: 'Storm Curse', icon: 'icon_lightning', kind: 'lightning', maxLevel: 8,
      desc: 'Smites random on-screen foes with bolts from the black sky.',
      base: { damage: 22, cooldown: 2.1, count: 1, area: 1, speed: 0, pierce: 0, duration: 0, knockback: 3 },
      gain: { damage: 0.25, cooldown: 0.9, area: 0.08, count: [2, 4, 6, 8] },
      aoeR: 30,
      evolvesTo: 'thunderloop', evolvePassive: 'duplicator',
    },
    thunderloop: {
      id: 'thunderloop', name: 'Thunder Loop', icon: 'icon_thunderloop', kind: 'lightning', maxLevel: 8, isEvolved: true, big: true,
      desc: 'More strikes — each forks and chains between the dead.',
      base: { damage: 34, cooldown: 1.4, count: 4, area: 1.2, speed: 0, pierce: 0, duration: 0, knockback: 4 },
      gain: { damage: 0.25, cooldown: 0.92, area: 0.08, count: [4, 7] },
      aoeR: 36, chain: 3, critBonus: 0.06,
      evolvesTo: null, evolvePassive: null,
    },

    /* ----- HAMMER (the signature MEGABONK) ----- */
    hammer: {
      id: 'hammer', name: 'Crypt Mallet', icon: 'icon_hammer', kind: 'hammer', maxLevel: 8,
      desc: 'A heavy mallet swings around you — huge knockback, huge bonks.',
      base: { damage: 26, cooldown: 0, count: 1, area: 1, speed: 2.2, pierce: 0, duration: 0, knockback: 7 },
      gain: { damage: 0.25, area: 0.1, speed: 0.03, knockback: 0.05, count: [4, 8] },
      radius: 34, hitR: 22, hitInterval: 0.28,
      evolvesTo: 'megabonk', evolvePassive: 'spinach',
    },
    megabonk: {
      id: 'megabonk', name: 'MEGABONK', icon: 'icon_megabonk', kind: 'hammer', maxLevel: 8, isEvolved: true, big: true,
      desc: 'A colossal mallet. Screen-shaking, crit-laden, catastrophic BONKS.',
      base: { damage: 60, cooldown: 0, count: 2, area: 1.8, speed: 1.7, pierce: 0, duration: 0, knockback: 22 },
      gain: { damage: 0.26, area: 0.1, speed: 0.03, knockback: 0.05, count: [5, 8] },
      radius: 38, hitR: 30, hitInterval: 0.36, critBonus: 0.25, critMult: 2.5, bonkShake: 4.5,
      evolvesTo: null, evolvePassive: null,
    },
  };

  /* attach levelText to every def (describes the NEXT level's gains) */
  function levelTextFor(def, level) {
    var nl = level + 1;
    if (nl > def.maxLevel) return 'Max level';
    var gn = def.gain || {};
    var parts = ['+' + Math.round((gn.damage != null ? gn.damage : 0.2) * 100) + '% damage'];
    if (gn.count && gn.count.indexOf(nl) >= 0) parts.push('+1 projectile');
    if (gn.pierce && gn.pierce.indexOf(nl) >= 0) parts.push('+1 pierce');
    if (parts.length < 3) {
      if (gn.cooldown != null && gn.cooldown < 1 && nl % 2 === 0) parts.push('faster');
      else if (gn.area) parts.push('+area');
    }
    return parts.slice(0, 3).join(', ');
  }
  for (var _k in DEFS) {
    if (DEFS.hasOwnProperty(_k)) {
      (function (d) { d.levelText = function (level) { return levelTextFor(d, level); }; })(DEFS[_k]);
    }
  }

  /* =================================================================== *
   *  EVOLUTION
   * =================================================================== */
  function passiveMaxed(player, passiveId) {
    if (!passiveId) return true;                  // null requirement → only needs maxed weapon
    var have = (player && player.passives) ? (player.passives[passiveId] || 0) : 0;
    if (have <= 0) return false;
    var pdef = (MB.Upgrades && MB.Upgrades.PASSIVE_DEFS) ? MB.Upgrades.PASSIVE_DEFS[passiveId] : null;
    var need = pdef ? pdef.maxLevel : 1;
    return have >= need;
  }

  function tryEvolve(player) {
    if (!player || !player.weapons) return null;
    for (var i = 0; i < player.weapons.length; i++) {
      var w = player.weapons[i];
      var def = w.def;
      if (!def || !def.evolvesTo) continue;
      // weapon need only be well-grown (lvl 6), not fully maxed (8) — so the
      // evolution power-spike is reachable mid-run instead of only by the rare
      // long survivor.
      if (w.level < Math.min(6, def.maxLevel)) continue;
      // evolution catalyst: just OWN the passive (level >= 1), not maxed — keeps
      // evolutions reachable within a real run rather than gating them behind a
      // fully-maxed passive nobody lives long enough to build.
      if (def.evolvePassive) {
        var _pl = (player.passives && player.passives[def.evolvePassive]) || 0;
        if (_pl < 1) continue;
      }

      // perform evolution — the evolved weapon starts already-grown (lvl 5) so
      // it is a clear power SPIKE over the lvl-6 base it replaces (never a
      // temporary downgrade that gets you killed).
      if (w.dispose) w.dispose();
      var evo = new MB.Weapon(def.evolvesTo);
      evo.evolved = true;
      evo.level = Math.min(5, (evo.def && evo.def.maxLevel) || 8);
      player.weapons[i] = evo;

      if (MB.Audio && MB.Audio.sfx) MB.Audio.sfx('evolve');
      MB.spawnParticles(player.x, player.y, '#f2c14e', 44, { speed: 210, life: 1.0, size: 3 });
      MB.spawnParticles(player.x, player.y, '#ffec70', 26, { speed: 120, life: 1.2, size: 2, gravity: -40 });
      if (MB.shake) MB.shake(9);
      var nm = evo.def ? evo.def.name : def.evolvesTo;
      if (MB.UI && MB.UI.toast) MB.UI.toast('EVOLVED: ' + nm);
      if (MB.Upgrades && MB.Upgrades.recomputeStats) MB.Upgrades.recomputeStats(player);
      return evo;
    }
    return null;
  }

  /* =================================================================== *
   *  PUBLIC API
   * =================================================================== */
  MB.Weapons = {
    DEFS: DEFS,
    Weapon: Weapon,
    statsAt: statsAt,
    tryEvolve: tryEvolve,
    rollCrit: rollCrit,
  };

})(window.MB = window.MB || {});
