/* MEGABONK: PIXEL CRYPT — upgrades.js
 * MB.Upgrades — passives, XP curve, the single derived-stat writer,
 * level-up option rolling, apply, and chest opening.
 *
 * Cross-module references are made ONLY at call-time via MB.* and guarded.
 * This module never writes core.js / player / weapons — it only reads their
 * public surface (MB.Player.BASE_STATS, MB.Weapon, MB.Weapons.DEFS/tryEvolve).
 */
(function (MB) {
  'use strict';

  /* ------------------------------------------------------------------ *
   * Canonical fallback baseline (player.js owns the real one). Used only
   * if recompute is called before player.js loads — never throws.
   * ------------------------------------------------------------------ */
  var FALLBACK_BASE = {
    might: 1, area: 1, cooldownMult: 1, projSpeed: 1, duration: 1, amount: 0,
    speed: 1, magnet: 1, growth: 1, luck: 1, armor: 0, regen: 0, greed: 1,
    revives: 0, maxHp: 100,
  };

  // The derived-stat keys recompute is allowed to (re)write. Order-independent.
  var STAT_KEYS = [
    'might', 'area', 'cooldownMult', 'projSpeed', 'duration', 'amount',
    'speed', 'magnet', 'growth', 'luck', 'armor', 'regen', 'greed',
    'revives', 'maxHp',
  ];

  function baseStats() {
    return (MB.Player && MB.Player.BASE_STATS) ? MB.Player.BASE_STATS : FALLBACK_BASE;
  }

  function safeText(fn, lvl) {
    if (typeof fn !== 'function') return '';
    try { return '' + fn(lvl); } catch (e) { return ''; }
  }

  /* ------------------------------------------------------------------ *
   * PASSIVE_DEFS — all 15 ids referenced by weapon evolutions.
   * apply(player, level) MUTATES stats for the OWNED level (called once
   * per recompute with the full level), so each effect is "× level".
   * ------------------------------------------------------------------ */
  var PASSIVE_DEFS = {
    spinach: {
      id: 'spinach', name: 'Spinach', icon: 'icon_spinach', maxLevel: 5,
      desc: 'Raw might. Everything hits harder.',
      apply: function (p, l) { p.might += 0.10 * l; },
      levelText: function () { return 'Might +10%'; },
    },
    armor: {
      id: 'armor', name: 'Armor', icon: 'icon_armor', maxLevel: 5,
      desc: 'Plated bone. Reduce damage taken.',
      apply: function (p, l) { p.armor += 1 * l; },
      levelText: function () { return 'Armor +1'; },
    },
    wings: {
      id: 'wings', name: 'Wings', icon: 'icon_wings', maxLevel: 5,
      desc: 'Tattered wings. Move faster.',
      apply: function (p, l) { p.speed += 0.10 * l; },
      levelText: function () { return 'Move Speed +10%'; },
    },
    emptytome: {
      id: 'emptytome', name: 'Empty Tome', icon: 'icon_emptytome', maxLevel: 5,
      desc: 'Blank pages. Weapons cool down faster.',
      apply: function (p, l) { p.cooldownMult -= 0.08 * l; },
      levelText: function () { return 'Cooldown -8%'; },
    },
    candelabrador: {
      id: 'candelabrador', name: 'Candelabrador', icon: 'icon_candelabrador', maxLevel: 5,
      desc: 'Guttering candles. Larger area.',
      apply: function (p, l) { p.area += 0.10 * l; },
      levelText: function () { return 'Area +10%'; },
    },
    duplicator: {
      id: 'duplicator', name: 'Duplicator', icon: 'icon_duplicator', maxLevel: 2,
      desc: 'Echoes. Weapons fire extra projectiles.',
      apply: function (p, l) { p.amount += 1 * l; },
      levelText: function () { return '+1 Projectile'; },
    },
    bracer: {
      id: 'bracer', name: 'Bracer', icon: 'icon_bracer', maxLevel: 5,
      desc: 'Steady grip. Projectiles fly faster.',
      apply: function (p, l) { p.projSpeed += 0.10 * l; },
      levelText: function () { return 'Projectile Speed +10%'; },
    },
    spellbinder: {
      id: 'spellbinder', name: 'Spellbinder', icon: 'icon_spellbinder', maxLevel: 5,
      desc: 'Lingering hexes. Effects last longer.',
      apply: function (p, l) { p.duration += 0.10 * l; },
      levelText: function () { return 'Effect Duration +10%'; },
    },
    attractorb: {
      id: 'attractorb', name: 'Attractorb', icon: 'icon_attractorb', maxLevel: 5,
      desc: 'A hungry charm. Wider pickup range.',
      apply: function (p, l) { p.magnet += 0.25 * l; },
      levelText: function () { return 'Pickup Radius +25%'; },
    },
    crown: {
      id: 'crown', name: 'Crown', icon: 'icon_crown', maxLevel: 5,
      desc: 'A dead king’s crown. More experience.',
      apply: function (p, l) { p.growth += 0.08 * l; },
      levelText: function () { return 'XP Gain +8%'; },
    },
    clover: {
      id: 'clover', name: 'Clover', icon: 'icon_clover', maxLevel: 5,
      desc: 'Grave-grown luck. Better odds.',
      apply: function (p, l) { p.luck += 0.10 * l; },
      levelText: function () { return 'Luck +10%'; },
    },
    hollowheart: {
      id: 'hollowheart', name: 'Hollow Heart', icon: 'icon_hollowheart', maxLevel: 5,
      desc: 'A heart that won’t quit. More max HP.',
      apply: function (p, l) { p.maxHp *= (1 + 0.15 * l); },
      levelText: function () { return 'Max HP +15%'; },
    },
    pummarola: {
      id: 'pummarola', name: 'Pummarola', icon: 'icon_pummarola', maxLevel: 5,
      desc: 'Cursed fruit. Regenerate health.',
      apply: function (p, l) { p.regen += 0.4 * l; },
      levelText: function () { return 'Regen +0.4 HP/s'; },
    },
    tiragisu: {
      id: 'tiragisu', name: 'Tiragisu', icon: 'icon_tiragisu', maxLevel: 2,
      desc: 'One more bite of life. Extra revive.',
      apply: function (p, l) { p.revives += 1 * l; },
      levelText: function () { return '+1 Revive'; },
    },
    stonemask: {
      id: 'stonemask', name: 'Stone Mask', icon: 'icon_stonemask', maxLevel: 5,
      desc: 'A greedy visage. More gold.',
      apply: function (p, l) { p.greed += 0.10 * l; },
      levelText: function () { return 'Gold +10%'; },
    },
  };

  /* ------------------------------------------------------------------ *
   * STAT_UPGRADES — repeatable "stat shard" level-up choices. Unlike
   * passives they have no slot limit and stack forever, letting players
   * scale move speed / attack speed / might / etc. directly as they level.
   * Applied each recompute from player.statShards (id -> stack count).
   * ------------------------------------------------------------------ */
  var STAT_UPGRADES = {
    s_might:   { id: 's_might',   name: 'Power Shard', icon: 'icon_spinach',       text: 'Might +7%',
                 apply: function (p, c) { p.might *= (1 + 0.07 * c); } },
    s_speed:   { id: 's_speed',   name: 'Swift Boots', icon: 'icon_wings',         text: 'Move Speed +6%',
                 apply: function (p, c) { p.speed *= (1 + 0.06 * c); } },
    s_haste:   { id: 's_haste',   name: 'Quick Hands', icon: 'icon_emptytome',     text: 'Attack Speed +5%',
                 apply: function (p, c) { p.cooldownMult *= Math.pow(0.95, c); } },
    s_area:    { id: 's_area',    name: 'Wide Reach',  icon: 'icon_candelabrador', text: 'Area +6%',
                 apply: function (p, c) { p.area *= (1 + 0.06 * c); } },
    s_hp:      { id: 's_hp',      name: 'Vital Surge', icon: 'icon_hollowheart',   text: 'Max HP +18',
                 apply: function (p, c) { p.maxHp += 18 * c; } },
    s_magnet:  { id: 's_magnet',  name: 'Lodestone',   icon: 'icon_attractorb',    text: 'Pickup Range +15%',
                 apply: function (p, c) { p.magnet *= (1 + 0.15 * c); } },
    s_growth:  { id: 's_growth',  name: 'Wisdom',      icon: 'icon_crown',         text: 'XP Gain +6%',
                 apply: function (p, c) { p.growth *= (1 + 0.06 * c); } },
    s_luck:    { id: 's_luck',    name: 'Fortune',     icon: 'icon_clover',        text: 'Luck +8%',
                 apply: function (p, c) { p.luck *= (1 + 0.08 * c); } },
    s_armor:   { id: 's_armor',   name: 'Iron Skin',   icon: 'icon_armor',         text: 'Armor +1',
                 apply: function (p, c) { p.armor += 1 * c; } },
    s_proj:    { id: 's_proj',    name: 'Swift Shots', icon: 'icon_bracer',        text: 'Projectile Speed +8%',
                 apply: function (p, c) { p.projSpeed *= (1 + 0.08 * c); } },
  };

  /* ------------------------------------------------------------------ *
   * XP curve — PROGRESSIVE: every level costs more than the last, and the
   * per-level increment itself grows (quadratic term), so blitzing into the
   * late game is impossible. Early game still ramps quickly to stay fun.
   *   lvl1->2 = 5, lvl5 ~ 63, lvl10 ~ 207, lvl20 ~ 735,
   *   lvl50 ~ 4.2k, lvl100 ~ 16.5k, lvl150 ~ 36.5k.
   * (Cumulative XP to reach lvl50 ~ 75k — what previously rocketed you to
   *  ~lvl150 now lands you around lvl50.)
   * ------------------------------------------------------------------ */
  function xpForLevel(level) {
    level = (level | 0); if (level < 1) level = 1;
    var n = level - 1;
    var xp = 5 + n * 6 + n * n * 1.0;   // linear (brisk early) + quadratic (grindy late)
    xp = Math.round(xp);
    return xp < 1 ? 1 : xp;
  }

  /* ------------------------------------------------------------------ *
   * recomputeStats — THE single writer of derived stats (protocol #1).
   * ------------------------------------------------------------------ */
  function recomputeStats(player) {
    if (!player) return;
    var BASE = baseStats();

    // Capture hp ratio BEFORE we clobber maxHp.
    var hadPrev = (player._prevMaxHp !== undefined && player._prevMaxHp !== null);
    var prevMax = hadPrev ? player._prevMaxHp : 0;
    var ratio = (hadPrev && prevMax > 0)
      ? MB.clamp((player.hp || 0) / prevMax, 0, 1)
      : 1;

    // 1) copy BASE_STATS onto the player.
    for (var i = 0; i < STAT_KEYS.length; i++) {
      var k = STAT_KEYS[i];
      player[k] = (BASE[k] !== undefined) ? BASE[k] : FALLBACK_BASE[k];
    }

    // 2) per-character overrides = REPLACEMENTS of the base value.
    var cb = player.charBase || {};
    for (var ck in cb) {
      if (!Object.prototype.hasOwnProperty.call(cb, ck)) continue;
      if (player[ck] !== undefined && STAT_KEYS.indexOf(ck) !== -1) {
        player[ck] = cb[ck];
      }
    }

    // 3) apply every owned passive at its owned level.
    var passives = player.passives || {};
    for (var id in passives) {
      if (!Object.prototype.hasOwnProperty.call(passives, id)) continue;
      var lvl = passives[id];
      var def = PASSIVE_DEFS[id];
      if (lvl > 0 && def && typeof def.apply === 'function') def.apply(player, lvl);
    }

    // 3b) repeatable stat shards (level-up stat choices: speed/haste/etc).
    var shards = player.statShards || {};
    for (var sid in shards) {
      if (!Object.prototype.hasOwnProperty.call(shards, sid)) continue;
      var sc = shards[sid];
      var sdef = STAT_UPGRADES[sid];
      if (sc > 0 && sdef && typeof sdef.apply === 'function') sdef.apply(player, sc);
    }

    // 3c) permanent meta-progression bought in the coin shop.
    if (MB.Shop && typeof MB.Shop.applyStats === 'function') {
      try { MB.Shop.applyStats(player); } catch (e) { /* never break recompute */ }
    }

    // (weapon-count effects: none defined — weapons read player.* directly.)

    // 4) clamps.
    if (player.cooldownMult < 0.4) player.cooldownMult = 0.4;
    if (player.speed < 0.4) player.speed = 0.4;
    if (player.duration < 0.5) player.duration = 0.5;
    if (player.amount < 0) player.amount = 0;
    if (player.maxHp < 1) player.maxHp = 1;

    // 5) round maxHp & preserve hp ratio (or fill on first call).
    player.maxHp = Math.round(player.maxHp);
    if (player.maxHp < 1) player.maxHp = 1;
    if (!hadPrev || player.hp === undefined || player.hp === null) {
      player.hp = player.maxHp;
    } else {
      var hp = Math.round(player.maxHp * ratio);
      if (hp > player.maxHp) hp = player.maxHp;
      if (hp < 0) hp = 0;
      // a living player should not be rounded down to a corpse by a stat tweak
      if (hp <= 0 && ratio > 0 && player.hp > 0) hp = 1;
      player.hp = hp;
    }

    player._prevMaxHp = player.maxHp;
  }

  /* ------------------------------------------------------------------ *
   * Option pool builders
   * ------------------------------------------------------------------ */
  function weaponDefs() { return (MB.Weapons && MB.Weapons.DEFS) ? MB.Weapons.DEFS : {}; }

  // ids that are evolution-forms (targets of some weapon's evolvesTo) — never
  // offered as fresh level-up picks; they come from chests only.
  function evolutionTargets(defs) {
    var set = {};
    for (var id in defs) {
      if (!Object.prototype.hasOwnProperty.call(defs, id)) continue;
      var d = defs[id];
      if (d && d.evolvesTo) set[d.evolvesTo] = true;
    }
    return set;
  }

  function buildPool(player) {
    var pool = [];
    var defs = weaponDefs();
    var evoTargets = evolutionTargets(defs);

    var owned = player.weapons || [];
    var ownedIds = {};
    for (var i = 0; i < owned.length; i++) ownedIds[owned[i].id] = true;

    // Upgrades for owned, non-maxed weapons.
    for (var w = 0; w < owned.length; w++) {
      var wp = owned[w];
      var wdef = wp.def || defs[wp.id];
      if (!wdef) continue;
      var wMax = wdef.maxLevel || 8;
      if (wp.level < wMax) {
        pool.push({
          kind: 'weapon', id: wp.id, level: wp.level + 1, isNew: false,
          name: wdef.name || wp.id, icon: wdef.icon || ('icon_' + wp.id),
          text: safeText(wdef.levelText, wp.level + 1) || 'Level up',
          weight: 1.0 * (0.7 + Math.random() * 0.6),
        });
      }
    }

    // New weapons (base only) if there's a free weapon slot (<6).
    if (owned.length < 6) {
      for (var nid in defs) {
        if (!Object.prototype.hasOwnProperty.call(defs, nid)) continue;
        if (ownedIds[nid] || evoTargets[nid]) continue;
        var nd = defs[nid];
        if (!nd) continue;
        pool.push({
          kind: 'weapon', id: nid, level: 1, isNew: true,
          name: nd.name || nid, icon: nd.icon || ('icon_' + nid),
          text: safeText(nd.levelText, 1) || nd.desc || 'New weapon',
          weight: 0.9 * (0.7 + Math.random() * 0.6),
        });
      }
    }

    // Upgrades for owned, non-maxed passives.
    var pass = player.passives || {};
    var passCount = 0;
    for (var pid in pass) {
      if (!Object.prototype.hasOwnProperty.call(pass, pid)) continue;
      passCount++;
      var pdef = PASSIVE_DEFS[pid];
      if (!pdef) continue;
      var pMax = pdef.maxLevel || 5;
      var plvl = pass[pid];
      if (plvl < pMax) {
        pool.push({
          kind: 'passive', id: pid, level: plvl + 1, isNew: false,
          name: pdef.name, icon: pdef.icon,
          text: safeText(pdef.levelText, plvl + 1),
          weight: 1.0 * (0.7 + Math.random() * 0.6),
        });
      }
    }

    // New passives if there's a free passive slot (<6).
    if (passCount < 6) {
      for (var apid in PASSIVE_DEFS) {
        if (!Object.prototype.hasOwnProperty.call(PASSIVE_DEFS, apid)) continue;
        if (pass[apid] !== undefined) continue;
        var apd = PASSIVE_DEFS[apid];
        pool.push({
          kind: 'passive', id: apid, level: 1, isNew: true,
          name: apd.name, icon: apd.icon,
          text: safeText(apd.levelText, 1),
          weight: 0.8 * (0.7 + Math.random() * 0.6),
        });
      }
    }

    // Repeatable stat shards — always available, no slot/level cap, so the
    // player can keep scaling move speed / attack speed / might / etc.
    var shards = player.statShards || {};
    for (var suid in STAT_UPGRADES) {
      if (!Object.prototype.hasOwnProperty.call(STAT_UPGRADES, suid)) continue;
      var su = STAT_UPGRADES[suid];
      var cur = shards[suid] || 0;
      pool.push({
        kind: 'stat', id: suid, level: cur + 1, isNew: cur === 0,
        name: su.name, icon: su.icon, text: su.text,
        weight: 0.55 * (0.7 + Math.random() * 0.6),
      });
    }

    return pool;
  }

  function fillerOption() {
    return {
      kind: 'heal', id: 'refund', name: 'Treasure',
      text: '+30 gold & heal', icon: 'coin', level: 0, isNew: false,
    };
  }

  /* ------------------------------------------------------------------ *
   * rollOptions — 3 choices (4 with luck), weighted, no duplicates.
   * ------------------------------------------------------------------ */
  function rollOptions(player) {
    if (!player) return [fillerOption()];

    var pool = buildPool(player);
    if (pool.length === 0) return [fillerOption()];

    var count = 3;
    var luckBonus = MB.clamp((player.luck || 1) - 1, 0, 1) * 0.5;
    if (Math.random() < luckBonus) count = 4;
    if (count > pool.length) count = pool.length;

    // weighted sample without replacement
    var avail = pool.slice();
    var chosen = [];
    for (var n = 0; n < count && avail.length > 0; n++) {
      var total = 0;
      for (var i = 0; i < avail.length; i++) total += avail[i].weight;
      var r = Math.random() * total;
      var idx = 0;
      for (var j = 0; j < avail.length; j++) {
        r -= avail[j].weight;
        if (r <= 0) { idx = j; break; }
      }
      chosen.push(avail[idx]);
      avail.splice(idx, 1);
    }
    return chosen;
  }

  /* ------------------------------------------------------------------ *
   * apply — add/upgrade the chosen option, then recompute.
   * ------------------------------------------------------------------ */
  function apply(player, option) {
    if (!player || !option) return;

    if (option.kind === 'weapon') {
      if (option.isNew) {
        if (MB.Weapon) player.weapons.push(new MB.Weapon(option.id));
      } else {
        for (var i = 0; i < player.weapons.length; i++) {
          if (player.weapons[i].id === option.id) {
            if (typeof player.weapons[i].levelUp === 'function') player.weapons[i].levelUp();
            else player.weapons[i].level = (player.weapons[i].level || 1) + 1;
            break;
          }
        }
      }
    } else if (option.kind === 'passive') {
      player.passives[option.id] = (player.passives[option.id] || 0) + 1;
    } else if (option.kind === 'stat') {
      if (!player.statShards) player.statShards = {};
      player.statShards[option.id] = (player.statShards[option.id] || 0) + 1;
    } else {
      // heal / refund / treasure filler
      if (player.addGold) player.addGold(30);
      if (player.heal) player.heal(player.maxHp * 0.3);
    }

    recomputeStats(player);
    if (MB.Audio && MB.Audio.sfx) MB.Audio.sfx('select');
  }

  /* ------------------------------------------------------------------ *
   * openChest — try a weapon evolution, else grant an upgrade or gold.
   * ------------------------------------------------------------------ */
  function openChest(player) {
    if (!player) return;
    if (MB.Audio && MB.Audio.sfx) MB.Audio.sfx('chest');

    var evo = (MB.Weapons && MB.Weapons.tryEvolve) ? MB.Weapons.tryEvolve(player) : null;
    if (evo) return; // tryEvolve handles its own toast / fanfare

    var options = rollOptions(player);
    if (options && options.length && options[0].kind !== 'heal') {
      apply(player, options[0]);
      if (MB.UI && MB.UI.toast) MB.UI.toast('Treasure! ' + (options[0].name || 'Upgrade'));
    } else {
      if (player.addGold) player.addGold(50);
      if (MB.UI && MB.UI.toast) MB.UI.toast('Treasure! +gold');
    }
  }

  /* ------------------------------------------------------------------ *
   * Public API
   * ------------------------------------------------------------------ */
  MB.Upgrades = {
    PASSIVE_DEFS: PASSIVE_DEFS,
    xpForLevel: xpForLevel,
    recomputeStats: recomputeStats,
    rollOptions: rollOptions,
    apply: apply,
    openChest: openChest,
  };

})(window.MB = window.MB || {});
