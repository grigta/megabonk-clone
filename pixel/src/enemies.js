/* MEGABONK: PIXEL CRYPT — enemies.js
 * MB.Enemies: enemy definitions, the Enemy class, lookup helpers (used by weapons),
 * and the spawn Director (wave table, elite swarms, despawn/recycle, the Reaper).
 *
 * Attaches to the global MB namespace. Loads AFTER core.js. All cross-module
 * references happen at call time and are guarded defensively.
 */
(function (MB) {
  'use strict';

  MB.Enemies = MB.Enemies || {};

  /* ================================================================== *
   * Enemy definitions
   * type -> { type,name,sprite,hp,speed,dmg,xp,radius,knockbackMult,color,
   *           boss?,elite?,behavior, animSpeed?, split? }
   * behavior ∈ 'chase' | 'straight' | 'floaty' | 'charger'
   * ================================================================== */
  const DEFS = {
    bat: {
      type: 'bat', name: 'Crypt Bat', sprite: 'bat',
      hp: 8, speed: 60, dmg: 4, xp: 1, radius: 6,
      knockbackMult: 1.25, color: '#5a3a78', behavior: 'chase', animSpeed: 12,
    },
    zombie: {
      type: 'zombie', name: 'Grave Ghoul', sprite: 'zombie',
      hp: 30, speed: 30, dmg: 8, xp: 3, radius: 8,
      knockbackMult: 0.6, color: '#4d6b3a', behavior: 'chase', animSpeed: 4,
    },
    skeleton: {
      type: 'skeleton', name: 'Bone Stalker', sprite: 'skeleton',
      hp: 17, speed: 44, dmg: 6, xp: 2, radius: 7,
      knockbackMult: 1.0, color: '#cfcbb6', behavior: 'charger', animSpeed: 6,
    },
    ghost: {
      type: 'ghost', name: 'Wailing Wraith', sprite: 'ghost',
      hp: 12, speed: 50, dmg: 7, xp: 2, radius: 7,
      knockbackMult: 0.85, color: '#bcd7e8', behavior: 'floaty', animSpeed: 5,
    },
    slime: {
      type: 'slime', name: 'Grave Ooze', sprite: 'slime',
      hp: 22, speed: 34, dmg: 6, xp: 3, radius: 8,
      knockbackMult: 0.8, color: '#7bbf4a', behavior: 'chase', animSpeed: 5,
      split: 'slime_small',
    },
    slime_small: {
      type: 'slime_small', name: 'Spawnling', sprite: 'slime',
      hp: 7, speed: 48, dmg: 5, xp: 1, radius: 5,
      knockbackMult: 1.1, color: '#7bbf4a', behavior: 'chase', animSpeed: 7,
      small: true,
    },
    bigbat: {
      type: 'bigbat', name: 'Dread Bat', sprite: 'bigbat',
      hp: 130, speed: 64, dmg: 12, xp: 18, radius: 11,
      knockbackMult: 0.5, color: '#b5202a', behavior: 'chase', animSpeed: 11,
      elite: true,
    },
    // ---- BOSS ROSTER (periodic, escalating; spawned ~every 3 min) ----
    // Base hp here is the "wall" chunk; difficulty().hpMul scales it further at
    // spawn so a boss is always sized to the current run. Speed/dmg inflation is
    // capped for bosses (see BOSS_*_CAP) so they stay menacing but fair.
    gravelord: {
      type: 'gravelord', name: 'GRAVELORD', sprite: 'gravelord',
      hp: 760, speed: 52, dmg: 16, xp: 220, radius: 16,
      knockbackMult: 0.0, color: '#6d8a4a', behavior: 'chase', animSpeed: 4,
      boss: true,
    },
    bonelord: {
      type: 'bonelord', name: 'BONELORD', sprite: 'bonelord',
      hp: 1300, speed: 58, dmg: 20, xp: 340, radius: 16,
      knockbackMult: 0.0, color: '#e8e6d8', behavior: 'chase', animSpeed: 5,
      boss: true,
    },
    batking: {
      type: 'batking', name: 'DREAD SOVEREIGN', sprite: 'batking',
      hp: 2000, speed: 80, dmg: 22, xp: 480, radius: 15,
      knockbackMult: 0.0, color: '#5a3a78', behavior: 'floaty', animSpeed: 9,
      boss: true,
    },
    crypt_tyrant: {
      type: 'crypt_tyrant', name: 'CRYPT TYRANT', sprite: 'crypt_tyrant',
      hp: 2900, speed: 68, dmg: 30, xp: 720, radius: 17,
      knockbackMult: 0.0, color: '#7d1620', behavior: 'chase', animSpeed: 4,
      boss: true,
    },
    reaper: {
      type: 'reaper', name: 'THE REAPER', sprite: 'reaper',
      hp: 4200, speed: 74, dmg: 42, xp: 500, radius: 18,
      knockbackMult: 0.0, color: '#b5202a', behavior: 'chase', animSpeed: 4,
      boss: true,
    },
  };
  MB.Enemies.DEFS = DEFS;

  /* ================================================================== *
   * COHESIVE PROGRESSIVE + ADAPTIVE DIFFICULTY
   * One source of truth that blends run TIME with the hero's POWER so the
   * game stays a real threat no matter how strong the build gets.
   * All weights are named constants below for easy tuning.
   * ================================================================== */

  // ---- playerPower weights (how much each stat counts toward "strength") ----
  const P_LEVEL        = 1.0;   // per hero level above 1
  const P_WEAPON_LEVEL = 1.15;  // per weapon level above 1 (summed across weapons)
  const P_WEAPON_COUNT = 4.0;   // per extra equipped weapon beyond the first
  const P_MIGHT        = 30;    // per +1.00 might
  const P_AREA         = 12;    // per +1.00 area
  const P_HP           = 8;     // per +100 maxHp
  const P_COOLDOWN     = 26;    // per 1.00 of cooldown reduction
  const P_AMOUNT       = 4.5;   // per extra projectile

  // playerPower ≈ 0 at run start, growing as the build snowballs.
  function playerPower(player) {
    if (!player) return 0;
    const lvl = (player.level || 1) - 1;
    const ws = player.weapons;
    let wPow = 0, wCount = 0;
    if (ws) {
      wCount = ws.length;
      for (let i = 0; i < ws.length; i++) { const w = ws[i]; if (w) wPow += (w.level || 1) - 1; }
    }
    const extraWeapons = wCount > 1 ? wCount - 1 : 0;
    const might  = (player.might || 1) - 1;
    const area   = (player.area || 1) - 1;
    const hp     = ((player.maxHp || 100) - 100) / 100;
    const cd     = 1 - (player.cooldownMult || 1);   // faster cooldown => positive
    const amount = player.amount || 0;
    const p = lvl * P_LEVEL + wPow * P_WEAPON_LEVEL + extraWeapons * P_WEAPON_COUNT
            + might * P_MIGHT + area * P_AREA + hp * P_HP + cd * P_COOLDOWN + amount * P_AMOUNT;
    return p > 0 ? p : 0;
  }

  // ---- difficulty tuning: time term + power term, each blended in ----
  const POWER_REF       = 100;   // playerPower that counts as "fully powered" (~term 1.0)

  const HP_PER_MIN      = 0.60;  // hp-mul gained per run-minute (linear time term)
  const HP_PER_MIN2     = 0.022; // hp-mul gained per minute^2 (ACCELERATING — late game gets tanky)
  const HP_PER_POWER    = 4.4;   // hp-mul gained per unit of power-term
  const HP_SYNERGY      = 0.05;  // extra hp when BOTH time AND power are high (rubber-band)
  const HP_MUL_CAP      = 28;    // absolute ceiling

  const DMG_PER_MIN     = 0.085;
  const DMG_PER_POWER   = 0.72;
  const DMG_MUL_CAP     = 3.6;

  const SPEED_PER_MIN   = 0.014;
  const SPEED_PER_POWER = 0.10;
  const SPEED_MUL_CAP   = 1.40;  // keep movement mild so it stays readable

  const SPAWN_PER_MIN   = 0.022;
  const SPAWN_PER_POWER = 0.13;
  const SPAWN_MUL_CAP   = 1.60;

  // Bosses: hp may scale fully, but speed/dmg inflation is capped (stay fair).
  const BOSS_DMG_CAP    = 2.2;
  const BOSS_SPEED_CAP  = 1.15;
  const BOSS_HP_MUL_CAP = 28;

  // Cached per-frame so a whole spawn-batch shares one cheap computation.
  let _diffFrame = -1;
  const _diffVal = { hpMul: 1, dmgMul: 1, speedMul: 1, spawnMul: 1, tier: 0, power: 0 };

  MB.Enemies.playerPower = playerPower;
  MB.Enemies.difficulty = function (player) {
    const S = MB.State;
    const fr = S ? S.frame : 0;
    if (fr === _diffFrame) return _diffVal;   // reuse this frame's result (no alloc)
    _diffFrame = fr;

    const minute = ((S && S.time) || 0) / 60;
    const power = playerPower(player || (S && S.player));
    const pt = power / POWER_REF;

    let hp = 1 + minute * HP_PER_MIN + minute * minute * HP_PER_MIN2
              + pt * HP_PER_POWER + minute * pt * HP_SYNERGY;
    if (hp > HP_MUL_CAP) hp = HP_MUL_CAP;
    let dmg = 1 + minute * DMG_PER_MIN + pt * DMG_PER_POWER;
    if (dmg > DMG_MUL_CAP) dmg = DMG_MUL_CAP;
    let sp = 1 + minute * SPEED_PER_MIN + pt * SPEED_PER_POWER;
    if (sp > SPEED_MUL_CAP) sp = SPEED_MUL_CAP;
    let spawn = 1 + minute * SPAWN_PER_MIN + pt * SPAWN_PER_POWER;
    if (spawn > SPAWN_MUL_CAP) spawn = SPAWN_MUL_CAP;

    _diffVal.hpMul = hp;
    _diffVal.dmgMul = dmg;
    _diffVal.speedMul = sp;
    _diffVal.spawnMul = spawn;
    _diffVal.tier = ((minute / 2) | 0) + ((pt * 1.5) | 0);
    _diffVal.power = power;
    return _diffVal;
  };

  // Escalating boss roster — periodic mini-bosses ahead of the Reaper finale.
  const BOSS_SCHEDULE = [
    { t: 180, type: 'gravelord' },     // 3:00 — giant ghoul
    { t: 360, type: 'bonelord' },      // 6:00 — giant skeleton king
    { t: 540, type: 'batking' },       // 9:00 — Dread Sovereign (bat king)
    { t: 720, type: 'crypt_tyrant' },  // 12:00 — mini-reaper
  ];

  /* ================================================================== *
   * Director state (module-scoped; reset by startRun)
   * ================================================================== */
  const _director = {
    spawnAcc: 0,
    eliteTimer: 100,
    milestones: null,
    bossIdx: 0,
    reaperSpawned: false,
    reaperDead: false,
  };

  const CAP = 520;          // hard live-enemy cap (true bullet-heaven wall)
  const HARD_CAP = 580;     // absolute cap incl. slime splits

  /* ================================================================== *
   * Enemy class
   * ================================================================== */
  function Enemy(type, x, y) {
    const def = DEFS[type] || DEFS.bat;
    this.id = MB.nextId();
    this.type = def.type;
    this.def = def;
    this.x = x;
    this.y = y;

    // Cohesive progressive + adaptive scaling, applied once AT SPAWN.
    // hp/dmg/speed blend run time with player power (see difficulty()).
    const diff = MB.Enemies.difficulty(MB.State.player);
    let hpMul = diff.hpMul, dmgMul = diff.dmgMul, spMul = diff.speedMul;
    if (def.boss) {                                 // keep bosses menacing but fair
      if (hpMul > BOSS_HP_MUL_CAP) hpMul = BOSS_HP_MUL_CAP;
      if (dmgMul > BOSS_DMG_CAP) dmgMul = BOSS_DMG_CAP;
      if (spMul > BOSS_SPEED_CAP) spMul = BOSS_SPEED_CAP;
    }
    this.maxHp = Math.max(1, Math.round(def.hp * hpMul));
    this.hp = this.maxHp;

    this.speed = def.speed * spMul;
    this.dmg = def.dmg * dmgMul;
    this.xp = def.xp;
    this.radius = def.radius;
    this.sprite = def.sprite;
    this.boss = !!def.boss;
    this.elite = !!def.elite;

    this.dead = false;
    this.flash = 0;

    // scratch / movement
    this.vx = 0; this.vy = 0;
    this.kbx = 0; this.kby = 0;        // knockback velocity (decays)
    this.facing = 1;

    // behavior state
    this.phase = Math.random() * Math.PI * 2;   // floaty sine + anim desync
    this.dirx = 0; this.diry = 0;               // locked dir for 'straight'/dash
    this.charging = false;
    this.chargeT = MB.rand(0.5, 1.2);           // charger wind-up timer
    this.hitThrottle = 0;
  }

  Enemy.prototype.update = function (dt, player) {
    if (this.flash > 0) { this.flash -= dt; if (this.flash < 0) this.flash = 0; }
    if (this.hitThrottle > 0) this.hitThrottle -= dt;

    if (player) {
      const def = this.def;
      const dx = player.x - this.x, dy = player.y - this.y;
      let dlen = Math.sqrt(dx * dx + dy * dy);
      if (dlen < 1e-4) dlen = 1e-4;
      const nx = dx / dlen, ny = dy / dlen;

      let mvx = nx, mvy = ny;
      let sp = this.speed;

      switch (def.behavior) {
        case 'straight': {
          if (this.dirx === 0 && this.diry === 0) { this.dirx = nx; this.diry = ny; }
          mvx = this.dirx; mvy = this.diry;
          break;
        }
        case 'floaty': {
          this.phase += dt * 3.2;
          const px = -ny, py = nx;                  // perpendicular
          const w = Math.sin(this.phase) * 0.7;
          mvx = nx + px * w; mvy = ny + py * w;
          const l = Math.sqrt(mvx * mvx + mvy * mvy) || 1;
          mvx /= l; mvy /= l;
          break;
        }
        case 'charger': {
          this.chargeT -= dt;
          if (this.chargeT <= 0) {
            this.charging = !this.charging;
            if (this.charging) {                    // begin dash: lock direction
              this.dirx = nx; this.diry = ny;
              this.chargeT = 0.5;
            } else {
              this.chargeT = MB.rand(0.7, 1.4);     // wind-up pause
            }
          }
          if (this.charging) { mvx = this.dirx; mvy = this.diry; sp = this.speed * 2.7; }
          else { mvx = nx * 0.22; mvy = ny * 0.22; } // creep while winding up
          break;
        }
        case 'chase':
        default:
          mvx = nx; mvy = ny;
          break;
      }

      this.x += mvx * sp * dt;
      this.y += mvy * sp * dt;

      if (dx < -1) this.facing = -1; else if (dx > 1) this.facing = 1;

      // knockback integrate + decay
      if (this.kbx !== 0 || this.kby !== 0) {
        this.x += this.kbx * dt;
        this.y += this.kby * dt;
        const decay = Math.exp(-9 * dt);
        this.kbx *= decay; this.kby *= decay;
        if (this.kbx > -1 && this.kbx < 1 && this.kby > -1 && this.kby < 1) {
          this.kbx = 0; this.kby = 0;
        }
      }

      // light separation — staggered across frames to halve cost
      if (!this.boss && (((this.id + MB.State.frame) & 1) === 0)) this._separate();
    }
  };

  // Nudge away from a couple of overlapping neighbours so they don't fully stack.
  Enemy.prototype._separate = function () {
    const grid = MB.State.grid;
    if (!grid) return;
    const r = this.radius + 8;
    const near = grid.query(this.x, this.y, r);
    let pushed = 0;
    for (let i = 0; i < near.length; i++) {
      const o = near[i];
      if (o === this || o.dead) continue;
      const dx = this.x - o.x, dy = this.y - o.y;
      const d2 = dx * dx + dy * dy;
      const minD = this.radius + o.radius;
      if (d2 < minD * minD && d2 > 1e-4) {
        const d = Math.sqrt(d2);
        const push = (minD - d) * 0.5;
        const inv = 1 / d;
        this.x += dx * inv * push;
        this.y += dy * inv * push;
        if (++pushed >= 3) break;          // cap iterations
      }
    }
  };

  // dmg number; kx,ky = knockback DIRECTION (enemy scales by its own resistance);
  // srcUid = projectile id (dedupe handled weapon-side); crit toggles number color.
  Enemy.prototype.hit = function (dmg, kx, ky, srcUid, crit) {
    if (this.dead) return false;
    this.hp -= dmg;
    this.flash = 0.09;

    // knockback: normalize incoming direction, scale by this enemy's resistance
    const kmag = this.def.knockbackMult * (this.boss ? 0.2 : 1) * 130;
    if (kmag > 0) {
      let kl = Math.sqrt(kx * kx + ky * ky);
      if (kl > 1e-4) {
        const inv = 1 / kl;
        this.kbx += kx * inv * kmag;
        this.kby += ky * inv * kmag;
        const KMAX = this.boss ? 50 : 280;
        const cl = Math.sqrt(this.kbx * this.kbx + this.kby * this.kby);
        if (cl > KMAX) { const f = KMAX / cl; this.kbx *= f; this.kby *= f; }
      }
    }

    // blood + floating number (Enemy is the single source of truth for these)
    MB.spawnParticles(this.x, this.y - this.radius * 0.4, '#b5202a', 4,
      { speed: 95, life: 0.32, size: 1.6, gravity: 130 });
    MB.spawnDamageText(this.x, this.y - this.radius, Math.round(dmg),
      crit ? '#ffec70' : '#ffffff');

    // throttled SFX so mass hits don't clip
    if (this.hitThrottle <= 0) {
      if (MB.Audio && MB.Audio.sfx) MB.Audio.sfx(crit ? 'crit' : 'hit');
      this.hitThrottle = 0.035;
    }

    if (this.hp <= 0 && !this.dead) { this.die(); return true; }
    return false;
  };

  Enemy.prototype.die = function () {
    if (this.dead) return;
    this.dead = true;
    MB.State.kills++;

    const def = this.def;
    const player = MB.State.player;
    const luck = (player && player.luck) ? player.luck : 1;

    // slimes split into two smaller slimes (in addition to their gem)
    if (def.split && MB.State.enemies.length < HARD_CAP) {
      for (let i = 0; i < 2; i++) {
        if (MB.State.enemies.length >= HARD_CAP) break;
        const a = Math.random() * Math.PI * 2;
        const off = this.radius + 4;
        const s = new Enemy(def.split, this.x + Math.cos(a) * off, this.y + Math.sin(a) * off);
        s.kbx = Math.cos(a) * 90; s.kby = Math.sin(a) * 90;
        MB.State.enemies.push(s);
      }
    }

    // XP gem
    MB.spawnGem(this.x, this.y, this.xp);

    // death puff
    MB.spawnParticles(this.x, this.y - this.radius * 0.3, def.color || '#6d6a7c',
      this.boss ? 34 : 6,
      { speed: this.boss ? 220 : 75, life: this.boss ? 0.8 : 0.5, size: this.boss ? 3 : 1.6, gravity: 40 });

    if (this.boss) {
      // headline reward: chest + a shower of coins/gold + a heart + golden burst
      MB.spawnPickup(this.x, this.y, 'chest');
      MB.spawnPickup(this.x - 12, this.y + 2, 'coin');
      MB.spawnPickup(this.x + 12, this.y + 2, 'coin');
      MB.spawnPickup(this.x, this.y - 8, 'heart');
      if (player && player.addGold) player.addGold(60 + Math.round((this.xp || 0) * 0.5));
      else MB.State.gold += 80;
      MB.spawnParticles(this.x, this.y - this.radius * 0.3, '#ffe9a8', 22,
        { speed: 240, life: 1.0, size: 2.4, gravity: 30 });
      MB.shake(16);
      if (MB.Audio && MB.Audio.sfx) MB.Audio.sfx('boss');
      if (this.type === 'reaper') {
        _director.reaperDead = true;
        if (MB.Main && MB.Main.victory) MB.Main.victory();
      }
    } else if (this.elite) {
      MB.spawnPickup(this.x, this.y, 'coin');
      if (MB.chance(0.35 * luck)) MB.spawnPickup(this.x + 6, this.y, 'chest');
      MB.shake(5);
      if (MB.Audio && MB.Audio.sfx) MB.Audio.sfx('death');
    } else {
      // luck-scaled trickle of bonus drops
      const r = Math.random();
      if (r < 0.010 * luck) MB.spawnPickup(this.x, this.y, 'heart');
      else if (r < 0.024 * luck) MB.spawnPickup(this.x, this.y, 'coin');
      else if (r < 0.030 * luck) MB.spawnPickup(this.x, this.y, 'magnet');
      else if (r < 0.0325 * luck) MB.spawnPickup(this.x, this.y, 'chest');
      if (MB.Audio && MB.Audio.sfx) MB.Audio.sfx('death');
    }
  };

  Enemy.prototype.draw = function (ctx) {
    const def = this.def;

    // ground shadow (ellipse under feet)
    drawShadow(ctx, this.x, this.y, this.radius, this.boss ? 1.4 : 1);

    // walk/flap frame, desynced per-enemy
    const fps = def.animSpeed || 6;
    const frame = ((((MB.State.time * fps) | 0) + (this.id & 1)) & 1);

    // floaty enemies hover above their shadow
    let drawY = this.y;
    if (def.behavior === 'floaty') {
      drawY = this.y + Math.sin(this.phase + MB.State.time * 4) * 2 - 3;
    }

    const opts = { anchor: 'bottom', flip: this.facing < 0 };
    if (this.flash > 0) opts.whiten = true;
    MB.drawNamed(ctx, this.sprite, frame, this.x, drawY, opts);

    if (this.boss || this.elite) drawHpBar(ctx, this);
  };

  MB.Enemy = Enemy;

  /* ------------------------------------------------------------------ *
   * Draw helpers (no per-call allocation beyond grid usage)
   * ------------------------------------------------------------------ */
  function drawShadow(ctx, wx, wy, r, mult) {
    const p = MB.cam.worldToScreen(wx, wy);
    const sc = MB.VIEW_SCALE;
    ctx.save();
    ctx.globalAlpha = 0.26;
    ctx.fillStyle = '#000000';
    ctx.beginPath();
    ctx.ellipse(p.sx, p.sy, r * sc * 0.55 * mult, r * sc * 0.26 * mult, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function drawHpBar(ctx, e) {
    const p = MB.cam.worldToScreen(e.x, e.y);
    const sc = MB.VIEW_SCALE;
    let sprH = e.radius * 2 * sc;
    if (MB.Sprites && MB.Sprites.get) {
      const spr = MB.Sprites.get(e.sprite, 0);
      if (spr) sprH = spr.height * sc;
    }
    const name = (e.def && e.def.name) ? e.def.name : 'BOSS';
    const w = e.boss ? Math.max(72, name.length * 7) : 26;
    const h = e.boss ? 6 : 3;
    const x = Math.round(p.sx - w / 2);
    const y = Math.round(p.sy - sprH - (e.boss ? 12 : 6));
    const frac = MB.clamp(e.hp / e.maxHp, 0, 1);

    ctx.fillStyle = '#0c0a12';
    ctx.fillRect(x - 1, y - 1, w + 2, h + 2);
    ctx.fillStyle = e.boss ? '#3a0d12' : '#2a200f';
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = e.boss ? '#e23b2e' : '#f2c14e';
    ctx.fillRect(x, y, Math.round(w * frac), h);

    if (e.boss) {
      ctx.save();
      ctx.font = '700 9px "Courier New", monospace';
      ctx.textAlign = 'center';
      ctx.fillStyle = '#000';
      ctx.fillText(name, p.sx + 1, y - 3);
      ctx.fillStyle = '#e8e6d8';
      ctx.fillText(name, p.sx, y - 4);
      ctx.restore();
    }
  }

  /* ================================================================== *
   * Lookup helpers (consumed by weapons.js) — protocol #3
   * ================================================================== */
  MB.Enemies.nearest = function (x, y, maxDist) {
    const grid = MB.State.grid;
    if (!grid) return null;
    const cand = grid.query(x, y, maxDist);
    let best = null, bd = maxDist * maxDist;
    for (let i = 0; i < cand.length; i++) {
      const e = cand[i];
      if (e.dead) continue;
      const d2 = MB.dist2(x, y, e.x, e.y);
      if (d2 < bd) { bd = d2; best = e; }
    }
    return best;
  };

  MB.Enemies.queryCircle = function (x, y, r) {
    const out = [];
    const grid = MB.State.grid;
    if (!grid) return out;
    const cand = grid.query(x, y, r);
    const r2 = r * r;
    for (let i = 0; i < cand.length; i++) {
      const e = cand[i];
      if (e.dead) continue;
      if (MB.dist2(x, y, e.x, e.y) <= r2) out.push(e);
    }
    return out;
  };

  MB.Enemies.randomOnScreen = function () {
    const arr = MB.State.enemies;
    if (!arr.length) return null;
    // fast path: a few random probes
    for (let tries = 0; tries < 24; tries++) {
      const e = arr[(Math.random() * arr.length) | 0];
      if (!e.dead && MB.cam.onScreen(e.x, e.y, 20)) return e;
    }
    // fallback: reservoir over all on-screen live enemies
    let pick = null, seen = 0;
    for (let i = 0; i < arr.length; i++) {
      const e = arr[i];
      if (!e.dead && MB.cam.onScreen(e.x, e.y, 20)) {
        seen++;
        if (Math.random() < 1 / seen) pick = e;
      }
    }
    return pick;
  };

  /* ================================================================== *
   * Spawn ring (just outside the view)
   * ================================================================== */
  MB.Enemies.spawnRingPos = function (player) {
    const hw = MB.cam.halfViewW();
    const hh = MB.cam.halfViewH();
    const radius = Math.sqrt(hw * hw + hh * hh) + 40;
    const a = Math.random() * Math.PI * 2;
    const cx = player ? player.x : MB.State.camera.x;
    const cy = player ? player.y : MB.State.camera.y;
    return { x: cx + Math.cos(a) * radius, y: cy + Math.sin(a) * radius };
  };

  /* ================================================================== *
   * Director — wave table + escalation
   * ================================================================== */
  MB.Enemies.startRun = function () {
    _director.spawnAcc = 0;
    _director.eliteTimer = 100;       // first elite swarm ~1.5 min in
    _director.milestones = {};
    _director.bossIdx = 0;            // reset escalating boss schedule
    _director.reaperSpawned = false;
    _director.reaperDead = false;
    _diffFrame = -1;                  // force a fresh difficulty calc next frame
  };

  // Spawn a roster boss just off-screen with full fanfare.
  function spawnBoss(player, type) {
    const S = MB.State;
    const def = DEFS[type] || DEFS.reaper;
    const pos = MB.Enemies.spawnRingPos(player);
    S.enemies.push(new Enemy(type, pos.x, pos.y));
    if (MB.UI && MB.UI.toast) MB.UI.toast((def.name || 'A BOSS') + ' awakens!', 3000);
    if (MB.Audio && MB.Audio.sfx) MB.Audio.sfx('boss');
    if (MB.shake) MB.shake(13);
  }

  // Weighted enemy-type roll based on the current minute.
  function rollType(minute) {
    let wBat = minute > 6 ? 6 : 10;
    const wZombie = minute >= 1.0 ? 4 + minute * 0.6 : 0;
    const wSkel = minute >= 1.5 ? 3 + minute * 0.5 : 0;
    const wGhost = minute >= 3.0 ? 3 + minute * 0.4 : 0;
    const wSlime = minute >= 4.0 ? 2.5 + minute * 0.3 : 0;
    const wBig = minute >= 6.0 ? minute * 0.18 : 0;   // rare elite trickle late

    let r = Math.random() * (wBat + wZombie + wSkel + wGhost + wSlime + wBig);
    if ((r -= wBat) < 0) return 'bat';
    if ((r -= wZombie) < 0) return 'zombie';
    if ((r -= wSkel) < 0) return 'skeleton';
    if ((r -= wGhost) < 0) return 'ghost';
    if ((r -= wSlime) < 0) return 'slime';
    return 'bigbat';
  }

  function spawnCluster(player, type, n) {
    const S = MB.State;
    const base = MB.Enemies.spawnRingPos(player);
    for (let i = 0; i < n; i++) {
      if (S.enemies.length >= CAP) break;
      S.enemies.push(new Enemy(type, base.x + MB.rand(-32, 32), base.y + MB.rand(-32, 32)));
    }
  }

  function spawnDenseRing(player, count, types) {
    const S = MB.State;
    const hw = MB.cam.halfViewW(), hh = MB.cam.halfViewH();
    const rad = Math.sqrt(hw * hw + hh * hh) + 30;
    for (let i = 0; i < count; i++) {
      if (S.enemies.length >= CAP) break;
      const a = (i / count) * Math.PI * 2;
      const type = MB.pick(types);
      S.enemies.push(new Enemy(type, player.x + Math.cos(a) * rad, player.y + Math.sin(a) * rad));
    }
  }

  MB.Enemies.update = function (dt, player) {
    if (!player) return;
    const S = MB.State;
    const t = S.time;
    const minute = t / 60;

    const diff = MB.Enemies.difficulty(player);

    // ---- The Reaper (end of run) ----
    if (t >= MB.RUN_DURATION && !_director.reaperSpawned) {
      _director.reaperSpawned = true;
      if (MB.UI && MB.UI.showBossWarning) MB.UI.showBossWarning();
      if (MB.Audio && MB.Audio.sfx) MB.Audio.sfx('boss');
      MB.shake(16);
      const pos = MB.Enemies.spawnRingPos(player);
      S.enemies.push(new Enemy('reaper', pos.x, pos.y));
    }

    // ---- periodic escalating BOSSES (~every 3 min, before the finale) ----
    if (_director.bossIdx < BOSS_SCHEDULE.length
        && t >= BOSS_SCHEDULE[_director.bossIdx].t && t < MB.RUN_DURATION) {
      spawnBoss(player, BOSS_SCHEDULE[_director.bossIdx].type);
      _director.bossIdx++;
    }

    let live = S.enemies.length;

    // ---- continuous trickle, escalating with time AND adaptive spawnMul ----
    const rate = MB.lerp(3, 40, MB.clamp(minute / 8, 0, 1)) * (1 + minute * 0.18) * diff.spawnMul;
    _director.spawnAcc += dt * rate;
    let budget = _director.spawnAcc | 0;
    if (budget > 0) {
      _director.spawnAcc -= budget;
      if (live + budget > CAP) budget = CAP - live;
      for (let i = 0; i < budget; i++) {
        const pos = MB.Enemies.spawnRingPos(player);
        S.enemies.push(new Enemy(rollType(minute), pos.x, pos.y));
      }
      live = S.enemies.length;
    }

    // ---- periodic ELITE swarms (~every 2 min) ----
    _director.eliteTimer -= dt;
    if (minute >= 1.5 && _director.eliteTimer <= 0 && live < CAP - 20) {
      _director.eliteTimer = 95;
      spawnCluster(player, 'bigbat', 5 + ((minute / 3) | 0));
      if (MB.UI && MB.UI.toast) MB.UI.toast('A swarm approaches...');
      if (MB.Audio && MB.Audio.sfx) MB.Audio.sfx('boss');
    }

    // ---- mini-boss feel: dense rings at 5 / 10 / 13 min ----
    const mm = Math.floor(minute);
    if ((mm === 5 || mm === 10 || mm === 13) && _director.milestones && !_director.milestones[mm]) {
      _director.milestones[mm] = true;
      if (MB.UI && MB.UI.toast) MB.UI.toast('The horde descends!');
      MB.shake(8);
      if (mm >= 10) spawnDenseRing(player, 38, ['zombie', 'skeleton', 'bigbat']);
      else spawnDenseRing(player, 26, ['zombie', 'skeleton', 'slime']);
    }

    // ---- despawn very-far enemies (recycle, NO drops) ----
    const hw = MB.cam.halfViewW(), hh = MB.cam.halfViewH();
    const viewR = Math.sqrt(hw * hw + hh * hh);
    const maxR2 = (viewR * 1.6 + 80) * (viewR * 1.6 + 80);
    const ex = player.x, ey = player.y;
    const list = S.enemies;
    for (let i = 0; i < list.length; i++) {
      const e = list[i];
      if (e.dead || e.boss) continue;
      const dx = e.x - ex, dy = e.y - ey;
      if (dx * dx + dy * dy > maxR2) e.dead = true;   // recycle, no die()/drops
    }
  };

})(window.MB = window.MB || {});
