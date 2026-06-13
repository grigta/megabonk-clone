/* MEGABONK: PIXEL CRYPT — ui.js
 * MB.UI: the HTML overlay layer — HUD, start/character-select, level-up modal,
 * game-over / victory screens, toasts and the boss warning banner.
 *
 * Owns the look of every DOM overlay (styles live in ../styles.css). Renders
 * crisp pixel-art sprite canvases (from MB.Sprites) into cards & slots.
 *
 * All cross-module references happen at CALL TIME via MB.* and are guarded so a
 * missing / late module never throws.
 */
(function (MB) {
  'use strict';

  /* ------------------------------------------------------------------ *
   * Cached DOM nodes
   * ------------------------------------------------------------------ */
  var nodes = {};

  /* per-frame HUD value cache (only touch the DOM when something changes) */
  var _c = {
    timeSec: -1, level: -1, xpW: -1, hpW: -1, hpText: '',
    kills: -1, gold: -1, loadSig: ''
  };
  function resetCache() {
    _c.timeSec = -1; _c.level = -1; _c.xpW = -1; _c.hpW = -1;
    _c.hpText = ''; _c.kills = -1; _c.gold = -1; _c.loadSig = '';
  }

  var _toastTimer = 0;

  /* ------------------------------------------------------------------ *
   * tiny DOM helpers
   * ------------------------------------------------------------------ */
  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function show(n) { if (n) n.classList.remove('hidden'); }
  function hide(n) { if (n) n.classList.add('hidden'); }

  function fmtTime(sec) {
    sec = Math.max(0, Math.floor(sec || 0));
    var m = (sec / 60) | 0, s = sec % 60;
    return (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s;
  }

  /* ------------------------------------------------------------------ *
   * Pixel-art canvas factory — upscales a 1x sprite with NO smoothing.
   * Never throws; returns a labeled fallback box for missing art.
   * ------------------------------------------------------------------ */
  function scaledPixelCanvas(src, box, label) {
    var c = document.createElement('canvas');
    c.className = 'pix';
    var w = box, h = box;
    if (src && src.width) {
      var scale = Math.max(1, Math.floor(box / Math.max(src.width, src.height)));
      w = src.width * scale;
      h = src.height * scale;
    }
    c.width = w; c.height = h;
    var cx = c.getContext('2d');
    cx.imageSmoothingEnabled = false;
    if (src && src.width) {
      cx.drawImage(src, 0, 0, w, h);
    } else {
      // labeled fallback plaque
      cx.fillStyle = '#3a2233'; cx.fillRect(0, 0, w, h);
      cx.fillStyle = '#1b1726'; cx.fillRect(2, 2, w - 4, h - 4);
      cx.fillStyle = '#b5202a'; cx.fillRect(2, 2, w - 4, 2);
      cx.fillStyle = '#e8e6d8';
      cx.font = '700 ' + Math.floor(w * 0.5) + 'px "Courier New", monospace';
      cx.textAlign = 'center'; cx.textBaseline = 'middle';
      var raw = ('' + (label || '?')).replace(/^icon_/, '');
      cx.fillText((raw.charAt(0) || '?').toUpperCase(), w / 2, h / 2 + 1);
    }
    return c;
  }

  function iconCanvas(name, box) {
    var src = null;
    if (MB.Sprites && MB.Sprites.icon) { try { src = MB.Sprites.icon(name); } catch (e) { src = null; } }
    return scaledPixelCanvas(src, box, name);
  }
  function spriteCanvas(name, frame, box) {
    var src = null;
    if (MB.Sprites && MB.Sprites.get) { try { src = MB.Sprites.get(name, frame || 0); } catch (e) { src = null; } }
    return scaledPixelCanvas(src, box, name);
  }

  /* ------------------------------------------------------------------ *
   * The UI object
   * ------------------------------------------------------------------ */
  var UI = {
    _started: false,
    _lvOptions: null,
    _lvPick: null,
    _lvLocked: false,
    _endLocked: false
  };

  /* ----------------------------- init ----------------------------- */
  UI.init = function () {
    nodes.uiRoot = document.getElementById('ui-root');
    nodes.hud = document.getElementById('hud');
    nodes.timer = document.getElementById('timer');
    nodes.kills = document.getElementById('kills');
    nodes.gold = document.getElementById('gold');
    nodes.xpFill = document.getElementById('xp-fill');
    nodes.levelText = document.getElementById('level-text');
    nodes.hpBar = document.getElementById('hp-bar');
    nodes.hpFill = document.getElementById('hp-fill');
    nodes.hpText = document.getElementById('hp-text');
    nodes.weaponIcons = document.getElementById('weapon-icons');
    nodes.passiveIcons = document.getElementById('passive-icons');
    nodes.start = document.getElementById('start-screen');
    nodes.levelup = document.getElementById('levelup-screen');
    nodes.gameover = document.getElementById('gameover-screen');
    nodes.toast = document.getElementById('toast');
    nodes.pauseHint = document.getElementById('pause-hint');

    // inject a vignette/scanline overlay UNDER the hud & panels
    if (nodes.uiRoot && !document.getElementById('vignette')) {
      var v = document.createElement('div');
      v.id = 'vignette';
      nodes.uiRoot.insertBefore(v, nodes.uiRoot.firstChild);
    }

    resetCache();

    // self-contained number-key picker (backup to main forwarding _pickByIndex)
    document.addEventListener('keydown', onKeyDown);
  };

  function onKeyDown(e) {
    if (!nodes.levelup || nodes.levelup.classList.contains('hidden')) return;
    var k = e.key;
    if (k >= '1' && k <= '9') {
      var idx = parseInt(k, 10) - 1;
      if (UI._lvOptions && idx >= 0 && idx < UI._lvOptions.length) chooseOption(idx);
    }
  }

  /* -------------------------- start screen ------------------------ */
  UI.showStart = function (characters, onStart) {
    characters = characters || (MB.CHARACTERS || []);
    UI._started = false;

    var root = nodes.start;
    if (!root) return;
    root.innerHTML = '';

    var inner = el('div', 'ss-inner');

    var crest = el('div', 'ss-crest', '☥');
    inner.appendChild(crest);
    inner.appendChild(el('h1', 'title', 'MEGABONK'));
    inner.appendChild(el('div', 'subtitle', 'PIXEL CRYPT'));
    inner.appendChild(el('div', 'ss-tag', '— choose the soul you will damn —'));

    var row = el('div', 'char-row');
    for (var i = 0; i < characters.length; i++) {
      row.appendChild(buildCharCard(characters[i], onStart));
    }
    inner.appendChild(row);

    var controls = el('div', 'ss-controls');
    controls.innerHTML =
      '<b>WASD</b> / <b>ARROWS</b> move' +
      '<span class="dot">·</span>attacks are <b>automatic</b>' +
      '<span class="dot">·</span><b>P</b> pause' +
      '<span class="dot">·</span><b>1–4</b> pick upgrade';
    inner.appendChild(controls);

    var bottom = el('div', 'ss-bottom');
    var mute = el('button', 'btn mute-btn');
    updateMuteLabel(mute);
    mute.addEventListener('click', function (ev) {
      ev.stopPropagation();
      if (MB.Audio && MB.Audio.init) { try { MB.Audio.init(); } catch (e) {} }
      var next = !(MB.Audio && MB.Audio.muted);
      if (MB.Audio && MB.Audio.setMuted) MB.Audio.setMuted(next);
      updateMuteLabel(mute);
      if (!next && MB.Audio && MB.Audio.sfx) MB.Audio.sfx('select');
    });
    bottom.appendChild(mute);
    inner.appendChild(bottom);

    root.appendChild(inner);

    // unhide start, hide everything else, hide the in-run HUD
    show(root);
    hide(nodes.levelup);
    hide(nodes.gameover);
    hide(nodes.toast);
    hide(nodes.pauseHint);
    hide(nodes.hud);
  };

  function updateMuteLabel(btn) {
    var muted = !!(MB.Audio && MB.Audio.muted);
    btn.textContent = muted ? '♪  SOUND: OFF' : '♪  SOUND: ON';
    btn.classList.toggle('muted', muted);
  }

  function buildCharCard(ch, onStart) {
    var card = el('div', 'char-card');
    card.setAttribute('role', 'button');
    card.tabIndex = 0;

    var por = el('div', 'cc-portrait');
    por.appendChild(spriteCanvas(ch.sprite || 'hero', 0, 64));
    card.appendChild(por);

    card.appendChild(el('div', 'cc-name', ch.name || ch.id || 'Soul'));

    // starting weapon name + icon
    var wid = ch.startWeapon;
    var wdef = (MB.Weapons && MB.Weapons.DEFS && MB.Weapons.DEFS[wid]) || null;
    var wname = (wdef && wdef.name) || (wid ? ('' + wid) : '—');
    var wicon = (wdef && wdef.icon) || ('icon_' + wid);
    var wrow = el('div', 'cc-weapon');
    wrow.appendChild(iconCanvas(wicon, 18));
    wrow.appendChild(el('span', 'cc-weapon-name', ('' + wname).toUpperCase()));
    card.appendChild(wrow);

    card.appendChild(el('div', 'cc-desc', ch.desc || ''));
    card.appendChild(el('div', 'cc-pick', 'ENTER THE CRYPT'));

    var choose = function (ev) {
      if (ev) ev.stopPropagation();
      if (UI._started) return;
      UI._started = true;
      if (MB.Audio && MB.Audio.init) { try { MB.Audio.init(); } catch (e) {} }
      if (MB.Audio && MB.Audio.sfx) MB.Audio.sfx('select');
      if (onStart) onStart(ch);
    };
    card.addEventListener('click', choose);
    card.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); choose(e); }
    });
    return card;
  }

  UI.hideStart = function () {
    hide(nodes.start);
    resetCache();
    show(nodes.hud);
  };

  /* ------------------------------ HUD ----------------------------- */
  UI.updateHUD = function (state) {
    state = state || MB.State;
    if (!state) return;
    var p = state.player;
    if (!p) return;

    // timer (mm:ss) — only reformat on a whole-second change
    var sec = Math.floor(state.time);
    if (sec !== _c.timeSec) { _c.timeSec = sec; if (nodes.timer) nodes.timer.textContent = fmtTime(sec); }

    // level
    if (p.level !== _c.level) { _c.level = p.level; if (nodes.levelText) nodes.levelText.textContent = 'Lv ' + p.level; }

    // xp bar
    var xp = (p.xpToNext > 0) ? (p.xp / p.xpToNext) : 0;
    xp = MB.clamp(xp, 0, 1);
    var xpw = Math.round(xp * 1000);
    if (xpw !== _c.xpW) { _c.xpW = xpw; if (nodes.xpFill) nodes.xpFill.style.width = (xpw / 10).toFixed(1) + '%'; }

    // hp bar + number
    var hp = (p.maxHp > 0) ? (p.hp / p.maxHp) : 0;
    hp = MB.clamp(hp, 0, 1);
    var hpw = Math.round(hp * 1000);
    if (hpw !== _c.hpW) {
      _c.hpW = hpw;
      if (nodes.hpFill) nodes.hpFill.style.width = (hpw / 10).toFixed(1) + '%';
      if (nodes.hpBar) {
        if (hp <= 0.30) nodes.hpBar.classList.add('low');
        else nodes.hpBar.classList.remove('low');
      }
    }
    var hpText = Math.max(0, Math.ceil(p.hp)) + '/' + Math.round(p.maxHp);
    if (hpText !== _c.hpText) { _c.hpText = hpText; if (nodes.hpText) nodes.hpText.textContent = hpText; }

    // kills / gold
    if (state.kills !== _c.kills) { _c.kills = state.kills; if (nodes.kills) nodes.kills.textContent = '☠ ' + state.kills; }
    if (state.gold !== _c.gold) { _c.gold = state.gold; if (nodes.gold) nodes.gold.textContent = '⊙ ' + state.gold; }

    // loadout (rebuild only when the set / levels changed)
    var sig = loadoutSig(p);
    if (sig !== _c.loadSig) { _c.loadSig = sig; rebuildLoadout(p); }
  };

  function loadoutSig(p) {
    var s = 'w';
    var ws = p.weapons || [];
    for (var i = 0; i < ws.length; i++) {
      var w = ws[i];
      s += (w.id || (w.def && w.def.id) || '?') + (w.level || 1) + ',';
    }
    s += '|p';
    var ps = p.passives || {};
    for (var k in ps) s += k + ps[k] + ',';
    return s;
  }

  function rebuildLoadout(p) {
    if (nodes.weaponIcons) {
      nodes.weaponIcons.innerHTML = '';
      var ws = p.weapons || [];
      for (var i = 0; i < ws.length; i++) {
        var w = ws[i];
        var def = w.def || (MB.Weapons && MB.Weapons.DEFS && MB.Weapons.DEFS[w.id]) || {};
        nodes.weaponIcons.appendChild(
          makeSlot(def.icon || w.id, w.level || 1, def.maxLevel || 8, def.name || w.id, 'weapon'));
      }
    }
    if (nodes.passiveIcons) {
      nodes.passiveIcons.innerHTML = '';
      var ps = p.passives || {};
      var defs = (MB.Upgrades && MB.Upgrades.PASSIVE_DEFS) || null;
      for (var key in ps) {
        var pdef = (defs && defs[key]) || {};
        nodes.passiveIcons.appendChild(
          makeSlot(pdef.icon || key, ps[key], pdef.maxLevel || 5, pdef.name || key, 'passive'));
      }
    }
  }

  function makeSlot(iconName, level, maxLevel, name, kind) {
    var slot = el('div', 'slot ' + kind);
    slot.title = (name || '') + (level ? ('  ·  Lv ' + level + '/' + maxLevel) : '');
    slot.appendChild(iconCanvas(iconName, 30));
    var maxed = level >= maxLevel;
    var lv = el('span', 'slot-lv' + (maxed ? ' max' : ''), maxed ? '★' : ('' + level));
    if (maxed) slot.classList.add('maxed');
    slot.appendChild(lv);
    return slot;
  }

  /* --------------------------- level up --------------------------- */
  UI.showLevelUp = function (options, onPick) {
    options = options || [];
    UI._lvOptions = options;
    UI._lvPick = onPick || null;
    UI._lvLocked = false;

    var root = nodes.levelup;
    if (!root) return;
    root.innerHTML = '';

    var inner = el('div', 'lv-inner');
    inner.appendChild(el('div', 'lv-header', 'LEVEL UP!'));
    inner.appendChild(el('div', 'lv-sub', 'Claim a dark boon'));

    var list = el('div', 'lv-options');
    for (var i = 0; i < options.length; i++) list.appendChild(buildOptionCard(options[i], i));
    inner.appendChild(list);

    inner.appendChild(el('div', 'lv-hint', 'CLICK A CARD · OR PRESS 1–' + Math.max(1, options.length)));
    root.appendChild(inner);

    show(root);
  };

  function buildOptionCard(opt, idx) {
    opt = opt || {};
    var card = el('div', 'opt-card ' + (opt.kind === 'passive' ? 'opt-passive' : 'opt-weapon'));
    card.tabIndex = 0;

    card.appendChild(el('div', 'opt-key', '' + (idx + 1)));

    var icw = el('div', 'opt-icon');
    icw.appendChild(iconCanvas(opt.icon || opt.id, 48));
    card.appendChild(icw);

    var body = el('div', 'opt-body');

    var head = el('div', 'opt-head');
    head.appendChild(el('span', 'opt-name', ('' + (opt.name || opt.id || 'Boon')).toUpperCase()));
    if (opt.isNew) head.appendChild(el('span', 'opt-badge new', 'NEW!'));
    else head.appendChild(el('span', 'opt-badge lv', 'Lv ' + (opt.level || 1)));
    body.appendChild(head);

    body.appendChild(el('div', 'opt-kind', opt.kind === 'passive' ? 'PASSIVE' : 'WEAPON'));
    body.appendChild(el('div', 'opt-text', opt.text || ''));
    card.appendChild(body);

    card.addEventListener('click', function () { chooseOption(idx); });
    card.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); chooseOption(idx); }
    });
    return card;
  }

  function chooseOption(idx) {
    if (UI._lvLocked) return;
    var opts = UI._lvOptions;
    if (!opts || idx < 0 || idx >= opts.length) return;
    UI._lvLocked = true;

    var opt = opts[idx];
    var cb = UI._lvPick;
    UI._lvOptions = null;
    UI._lvPick = null;

    // hide FIRST so a chained showLevelUp (next queued level) can re-open cleanly
    hide(nodes.levelup);
    if (MB.Audio && MB.Audio.sfx) MB.Audio.sfx('select');
    if (cb) cb(opt);
  }

  // main forwards number keys here (1-based, matching the on-card labels)
  UI._pickByIndex = function (i) {
    var n = parseInt(i, 10);
    if (isNaN(n)) return;
    chooseOption(n - 1);
  };

  /* ----------------------- game over / victory -------------------- */
  function buildEnd(title, isVictory, stats, onRestart) {
    var root = nodes.gameover;
    if (!root) return;
    root.innerHTML = '';
    root.classList.toggle('victory', !!isVictory);
    root.classList.toggle('defeat', !isVictory);

    UI._endLocked = false;
    stats = stats || {};

    var inner = el('div', 'end-inner');

    inner.appendChild(el('div', 'end-crest', isVictory ? '☀' : '☠'));
    var t = el('div', 'end-title ' + (isVictory ? 'win' : 'lose'));
    t.textContent = title;
    inner.appendChild(t);

    var grid = el('div', 'end-stats');
    addStat(grid, 'TIME SURVIVED', fmtTime(stats.time || 0));
    addStat(grid, 'LEVEL REACHED', 'Lv ' + (stats.level || 1));
    addStat(grid, 'SOULS REAPED', '☠ ' + (stats.kills || 0));
    addStat(grid, 'GOLD GATHERED', '⊙ ' + (stats.gold || 0));
    inner.appendChild(grid);

    var btn = el('button', 'btn restart-btn', isVictory ? 'PLAY AGAIN' : 'RISE AGAIN');
    btn.addEventListener('click', function (ev) {
      ev.stopPropagation();
      if (UI._endLocked) return;
      UI._endLocked = true;
      if (MB.Audio && MB.Audio.sfx) MB.Audio.sfx('select');
      hide(root);
      if (onRestart) onRestart();
    });
    inner.appendChild(btn);

    root.appendChild(inner);
    show(root);
    hide(nodes.levelup);
    hide(nodes.pauseHint);
  }

  function addStat(grid, label, val) {
    var s = el('div', 'stat');
    s.appendChild(el('span', 'stat-label', label));
    s.appendChild(el('span', 'stat-val', val));
    grid.appendChild(s);
  }

  UI.showGameOver = function (stats, onRestart) {
    if (MB.Audio && MB.Audio.sfx) MB.Audio.sfx('gameover');
    buildEnd('YOU DIED', false, stats, onRestart);
  };

  UI.showVictory = function (stats, onRestart) {
    if (MB.Audio && MB.Audio.sfx) MB.Audio.sfx('victory');
    buildEnd('DAWN BREAKS — YOU SURVIVED', true, stats, onRestart);
  };

  /* ----------------------------- toast ---------------------------- */
  function showToast(text, ms, variant) {
    var t = nodes.toast;
    if (!t) return;
    if (_toastTimer) { clearTimeout(_toastTimer); _toastTimer = 0; }
    t.textContent = text;
    t.classList.remove('hidden', 'show', 'boss');
    // force reflow so the entrance animation restarts on repeated toasts
    void t.offsetWidth;
    t.classList.add('show');
    if (variant) t.classList.add(variant);
    _toastTimer = setTimeout(function () {
      t.classList.add('hidden');
      t.classList.remove('show', 'boss');
      _toastTimer = 0;
    }, ms);
  }

  UI.toast = function (text, ms) { showToast(text, ms || 1800, null); };

  UI.showBossWarning = function () {
    if (MB.Audio && MB.Audio.sfx) MB.Audio.sfx('boss');
    if (MB.shake) MB.shake(8);
    showToast('⚠  THE REAPER COMES  ⚠', 3400, 'boss');
  };

  /* ------------------------------------------------------------------ *
   * Export
   * ------------------------------------------------------------------ */
  MB.UI = UI;

})(window.MB = window.MB || {});
