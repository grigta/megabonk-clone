/* MEGABONK: PIXEL CRYPT — shop.js
 * MB.Shop — a persistent (localStorage) between-runs meta-progression shop.
 * VS-PowerUp style: bank gold earned across runs, spend it on permanent
 * stat boons that are applied to the player every recompute.
 *
 * Self-contained: owns its own scoped CSS (prefix `.mbshop-`) and its own
 * full-screen gothic overlay. Loaded AFTER core.js, BEFORE main.js.
 *
 * Cross-module references happen at CALL TIME via MB.* and are guarded so a
 * missing / late module (Audio, Sprites, UI) never throws. localStorage is
 * wrapped in try/catch and falls back to an in-memory store.
 *
 * Integration seams:
 *   - main.js deposits run gold at run end:  MB.Shop.deposit(MB.State.gold)
 *   - upgrades.recomputeStats applies owned levels via the hook:
 *       if (MB.Shop && MB.Shop.applyStats) MB.Shop.applyStats(player)
 *   - ui.showStart can refresh the start-screen button:  MB.Shop.mountStartButton()
 */
(function (MB) {
  'use strict';

  var STORAGE_KEY = 'mb_shop_v1';

  /* ------------------------------------------------------------------ *
   * Upgrade definitions — id, name, icon, desc, maxLevel, baseCost,
   * costGrowth, and apply(player, level). Each apply is a PURE function of
   * (player, ownedLevel): it only reads `level` and mutates one player stat,
   * so it is idempotent across recompute calls (recompute reseeds the base
   * first, then re-runs every owned upgrade).
   *
   * Cost(level) = round(baseCost * (1 + level * costGrowth)) where `level`
   * is the number of levels already owned (0-based for the NEXT purchase).
   * ------------------------------------------------------------------ */
  var UPGRADES = [
    {
      id: 'might', name: 'Cursed Edge', icon: 'icon_spinach',
      desc: 'Permanent damage. Everything bleeds a little more.',
      maxLevel: 8, baseCost: 60, costGrowth: 0.80,
      apply: function (p, l) { p.might *= (1 + 0.06 * l); },
    },
    {
      id: 'armor', name: 'Bone Plating', icon: 'icon_armor',
      desc: 'Flat damage reduction soldered to your ribs.',
      maxLevel: 5, baseCost: 70, costGrowth: 0.90,
      apply: function (p, l) { p.armor += 1 * l; },
    },
    {
      id: 'maxHp', name: 'Black Vitality', icon: 'icon_hollowheart',
      desc: 'A fuller, colder heart. Raises maximum health.',
      maxLevel: 8, baseCost: 50, costGrowth: 0.70,
      apply: function (p, l) { p.maxHp += 20 * l; },
    },
    {
      id: 'speed', name: 'Grave Swiftness', icon: 'icon_wings',
      desc: 'Lighter on your rotting feet. Move faster.',
      maxLevel: 5, baseCost: 80, costGrowth: 1.00,
      apply: function (p, l) { p.speed *= (1 + 0.04 * l); },
    },
    {
      id: 'cooldownMult', name: 'Frenzy', icon: 'icon_emptytome',
      desc: 'Weapons recover faster between strikes.',
      maxLevel: 5, baseCost: 100, costGrowth: 1.00,
      apply: function (p, l) { p.cooldownMult *= (1 - 0.04 * l); },
    },
    {
      id: 'amount', name: 'Echoing Souls', icon: 'icon_duplicator',
      desc: 'Your weapons hurl extra projectiles. Rare and dear.',
      maxLevel: 2, baseCost: 300, costGrowth: 1.50,
      apply: function (p, l) { p.amount += 1 * l; },
    },
    {
      id: 'growth', name: 'Dead King’s Wisdom', icon: 'icon_crown',
      desc: 'Reap more experience from every soul.',
      maxLevel: 5, baseCost: 70, costGrowth: 0.80,
      apply: function (p, l) { p.growth *= (1 + 0.05 * l); },
    },
    {
      id: 'magnet', name: 'Hungry Charm', icon: 'icon_attractorb',
      desc: 'Wider pull on gems and loot.',
      maxLevel: 5, baseCost: 50, costGrowth: 0.70,
      apply: function (p, l) { p.magnet *= (1 + 0.10 * l); },
    },
    {
      id: 'luck', name: 'Grave Clover', icon: 'icon_clover',
      desc: 'The crypt favours you. Better odds and offers.',
      maxLevel: 5, baseCost: 90, costGrowth: 1.00,
      apply: function (p, l) { p.luck *= (1 + 0.05 * l); },
    },
    {
      id: 'greed', name: 'Avarice', icon: 'icon_stonemask',
      desc: 'A greedier visage. Gather more gold per run.',
      maxLevel: 5, baseCost: 60, costGrowth: 0.80,
      apply: function (p, l) { p.greed *= (1 + 0.08 * l); },
    },
    {
      id: 'regen', name: 'Cursed Mending', icon: 'icon_pummarola',
      desc: 'Flesh knits itself. Regenerate health over time.',
      maxLevel: 5, baseCost: 70, costGrowth: 0.80,
      apply: function (p, l) { p.regen += 0.3 * l; },
    },
    {
      id: 'revives', name: 'One More Breath', icon: 'icon_tiragisu',
      desc: 'Cheat death. Begin each run with extra lives.',
      maxLevel: 2, baseCost: 250, costGrowth: 1.50,
      apply: function (p, l) { p.revives += 1 * l; },
    },
    {
      id: 'area', name: 'Wider Reach', icon: 'icon_candelabrador',
      desc: 'Bigger swings, broader auras. Larger weapon area.',
      maxLevel: 5, baseCost: 90, costGrowth: 1.00,
      apply: function (p, l) { p.area *= (1 + 0.05 * l); },
    },
    {
      id: 'projSpeed', name: 'Swift Iron', icon: 'icon_bracer',
      desc: 'Projectiles fly faster and farther.',
      maxLevel: 5, baseCost: 70, costGrowth: 0.80,
      apply: function (p, l) { p.projSpeed *= (1 + 0.06 * l); },
    },
    {
      id: 'duration', name: 'Lingering Hex', icon: 'icon_spellbinder',
      desc: 'Zones, auras and effects last longer.',
      maxLevel: 5, baseCost: 70, costGrowth: 0.80,
      apply: function (p, l) { p.duration *= (1 + 0.06 * l); },
    },
  ];

  // id -> def lookup (built once).
  var DEFS = Object.create(null);
  for (var di = 0; di < UPGRADES.length; di++) DEFS[UPGRADES[di].id] = UPGRADES[di];

  /* ------------------------------------------------------------------ *
   * Persistence
   * ------------------------------------------------------------------ */
  var _data = null;     // { wallet:int, levels:{id:level} }
  var _loaded = false;
  var _storageOK = true; // flips false if localStorage throws — in-memory fallback

  function freshData() { return { wallet: 0, levels: {} }; }

  function load() {
    var data = freshData();
    try {
      var raw = (typeof localStorage !== 'undefined') ? localStorage.getItem(STORAGE_KEY) : null;
      if (raw) {
        var parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') {
          var w = parsed.wallet;
          data.wallet = (typeof w === 'number' && isFinite(w)) ? Math.max(0, Math.floor(w)) : 0;
          var lv = parsed.levels;
          if (lv && typeof lv === 'object') {
            for (var id in lv) {
              if (!Object.prototype.hasOwnProperty.call(lv, id)) continue;
              if (!DEFS[id]) continue; // drop unknown / removed ids
              var n = lv[id] | 0;
              if (n < 0) n = 0;
              var max = DEFS[id].maxLevel || 0;
              if (n > max) n = max;
              if (n > 0) data.levels[id] = n;
            }
          }
        }
      }
    } catch (e) {
      _storageOK = false; // disk unavailable / corrupt — fall back to memory
    }
    _data = data;
    _loaded = true;
    return _data;
  }

  function ensureLoaded() {
    if (!_loaded || !_data) load();
    return _data;
  }

  function save() {
    ensureLoaded();
    if (!_storageOK) return; // memory-only mode; nothing to persist
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(_data));
      }
    } catch (e) {
      _storageOK = false; // quota / privacy mode — stop trying, keep in memory
    }
  }

  /* ------------------------------------------------------------------ *
   * Economy API
   * ------------------------------------------------------------------ */
  function wallet() { return ensureLoaded().wallet | 0; }

  function deposit(n) {
    var d = ensureLoaded();
    n = Math.floor(n || 0);
    if (n > 0) { d.wallet += n; save(); refreshUI(); }
    return d.wallet;
  }

  function levelOf(id) {
    var d = ensureLoaded();
    return d.levels[id] | 0;
  }

  function costOf(id) {
    var def = DEFS[id];
    if (!def) return null;
    var lvl = levelOf(id);
    if (lvl >= (def.maxLevel || 0)) return null; // maxed
    return Math.round(def.baseCost * (1 + lvl * def.costGrowth));
  }

  function canBuy(id) {
    var c = costOf(id);
    if (c == null) return false;
    return wallet() >= c;
  }

  function buy(id) {
    if (!canBuy(id)) return false;
    var d = ensureLoaded();
    var c = costOf(id);
    d.wallet -= c;
    d.levels[id] = (d.levels[id] | 0) + 1;
    save();
    sfx('select');
    refreshUI();
    return true;
  }

  /* ------------------------------------------------------------------ *
   * applyStats — mutate player stats by every owned upgrade level.
   * Called from MB.Upgrades.recomputeStats (after base + char + passives,
   * before clamps). PURE: only READS shop state + WRITES player stats.
   * Does NOT recompute or clamp.
   * ------------------------------------------------------------------ */
  function applyStats(player) {
    if (!player) return;
    var d = ensureLoaded();
    var levels = d.levels;
    for (var i = 0; i < UPGRADES.length; i++) {
      var def = UPGRADES[i];
      var lvl = levels[def.id] | 0;
      if (lvl > 0 && typeof def.apply === 'function') {
        try { def.apply(player, lvl); } catch (e) { /* never break recompute */ }
      }
    }
  }

  /* ------------------------------------------------------------------ *
   * Small guarded helpers
   * ------------------------------------------------------------------ */
  function sfx(name) {
    if (MB.Audio && MB.Audio.sfx) { try { MB.Audio.sfx(name); } catch (e) {} }
  }
  function initAudio() {
    if (MB.Audio && MB.Audio.init) { try { MB.Audio.init(); } catch (e) {} }
  }

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  // Upscale a 1x sprite icon with no smoothing; labeled fallback if missing.
  function iconCanvas(name, box) {
    var src = null;
    if (MB.Sprites && MB.Sprites.icon) { try { src = MB.Sprites.icon(name); } catch (e) { src = null; } }
    var c = document.createElement('canvas');
    c.className = 'mbshop-pix';
    var w = box, h = box;
    if (src && src.width) {
      var scale = Math.max(1, Math.floor(box / Math.max(src.width, src.height)));
      w = src.width * scale; h = src.height * scale;
    }
    c.width = w; c.height = h;
    var cx = c.getContext('2d');
    cx.imageSmoothingEnabled = false;
    if (src && src.width) {
      cx.drawImage(src, 0, 0, w, h);
    } else {
      cx.fillStyle = '#3a2233'; cx.fillRect(0, 0, w, h);
      cx.fillStyle = '#1b1726'; cx.fillRect(2, 2, w - 4, h - 4);
      cx.fillStyle = '#b5202a'; cx.fillRect(2, 2, w - 4, 2);
      cx.fillStyle = '#e8e6d8';
      cx.font = '700 ' + Math.floor(w * 0.5) + 'px "Courier New", monospace';
      cx.textAlign = 'center'; cx.textBaseline = 'middle';
      var raw = ('' + (name || '?')).replace(/^icon_/, '');
      cx.fillText((raw.charAt(0) || '?').toUpperCase(), w / 2, h / 2 + 1);
    }
    return c;
  }

  // Build an icon node: sprite canvas for `icon_*`, otherwise an emoji glyph.
  function iconNode(def, box) {
    var name = def.icon || '';
    if (/^icon_/.test(name) || /^(proj_|aura_|whip_)/.test(name)) {
      return iconCanvas(name, box);
    }
    // emoji / glyph fallback
    var g = el('span', 'mbshop-glyph', name || '?');
    return g;
  }

  /* ------------------------------------------------------------------ *
   * Scoped CSS — injected once. Uses the global gothic palette vars from
   * styles.css with hard fallbacks so it still reads if styles are absent.
   * ------------------------------------------------------------------ */
  var CSS =
  '#mbshop-overlay{position:fixed;inset:0;z-index:55;display:none;flex-direction:column;' +
    'align-items:center;padding:clamp(10px,2.4vw,34px);overflow:auto;pointer-events:auto;' +
    'font-family:"Courier New","Courier",monospace;color:var(--bone,#e8e6d8);' +
    'background:radial-gradient(ellipse at 50% 16%,rgba(242,193,78,.14),transparent 58%),' +
    'radial-gradient(ellipse at 50% 120%,rgba(181,32,42,.18),transparent 55%),' +
    'linear-gradient(rgba(8,6,13,.95),rgba(8,6,13,.98));}' +
  '#mbshop-overlay.mbshop-open{display:flex;animation:mbshop-fade .26s ease-out;}' +
  '@keyframes mbshop-fade{from{opacity:0;}to{opacity:1;}}' +

  '.mbshop-inner{width:min(1180px,98vw);margin:0 auto;display:flex;flex-direction:column;' +
    'align-items:center;gap:clamp(8px,1.6vh,18px);}' +

  '.mbshop-head{display:flex;flex-direction:column;align-items:center;gap:4px;width:100%;}' +
  '.mbshop-crest{font-size:clamp(20px,3.4vw,34px);color:var(--blood,#b5202a);' +
    'text-shadow:0 0 16px rgba(181,32,42,.8);}' +
  '.mbshop-title{font-size:clamp(26px,5.4vw,58px);font-weight:700;letter-spacing:clamp(2px,.8vw,8px);' +
    'text-transform:uppercase;color:var(--bone,#e8e6d8);margin:0;line-height:.95;' +
    'text-shadow:0 0 2px #000,3px 3px 0 #000,6px 6px 0 var(--blood-deep,#6e1119),0 0 26px rgba(181,32,42,.5);}' +
  '.mbshop-sub{font-size:clamp(10px,1.5vw,14px);letter-spacing:3px;text-transform:uppercase;' +
    'color:var(--bone-dim,#b9b6a6);opacity:.9;}' +

  '.mbshop-bar{display:flex;align-items:center;justify-content:space-between;gap:14px;' +
    'width:100%;flex-wrap:wrap;margin-top:6px;}' +
  '.mbshop-wallet{font-size:clamp(18px,2.6vw,30px);font-weight:700;letter-spacing:2px;' +
    'color:var(--gold,#f2c14e);padding:6px 18px;border:2px solid var(--gold,#f2c14e);border-radius:3px;' +
    'background:linear-gradient(180deg,rgba(34,27,48,.9),rgba(11,8,19,.9));' +
    'text-shadow:2px 2px 0 #000;box-shadow:4px 4px 0 rgba(0,0,0,.55),0 0 18px rgba(242,193,78,.3);}' +
  '.mbshop-wallet .mbshop-coin{color:var(--gold-bright,#ffdb7a);}' +

  '.mbshop-grid{display:grid;width:100%;gap:clamp(8px,1.2vw,14px);' +
    'grid-template-columns:repeat(auto-fill,minmax(248px,1fr));margin-top:4px;}' +

  '.mbshop-card{position:relative;display:flex;gap:10px;padding:clamp(9px,1vw,13px);' +
    'background:linear-gradient(180deg,rgba(46,32,58,.72),rgba(16,12,24,.95));' +
    'border:2px solid var(--blood-deep,#6e1119);border-radius:4px;' +
    'box-shadow:4px 4px 0 rgba(0,0,0,.55),inset 0 0 0 1px rgba(232,230,216,.05);text-align:left;}' +
  '.mbshop-card.mbshop-maxed{border-color:var(--gold,#f2c14e);' +
    'box-shadow:4px 4px 0 rgba(0,0,0,.55),inset 0 0 0 1px rgba(242,193,78,.35),0 0 16px rgba(242,193,78,.25);}' +

  '.mbshop-ic{flex:0 0 auto;display:flex;align-items:center;justify-content:center;' +
    'width:clamp(50px,5.4vw,62px);height:clamp(50px,5.4vw,62px);' +
    'background:radial-gradient(circle at 50% 40%,rgba(242,193,78,.18),transparent 62%),' +
    'linear-gradient(180deg,#241b30,#120d1d);border:2px solid #000;border-radius:3px;' +
    'box-shadow:inset 0 0 12px rgba(0,0,0,.6);}' +
  '.mbshop-ic canvas{width:80%;height:80%;image-rendering:pixelated;image-rendering:crisp-edges;' +
    'filter:drop-shadow(2px 2px 0 rgba(0,0,0,.5));}' +
  '.mbshop-glyph{font-size:clamp(24px,3vw,34px);line-height:1;filter:drop-shadow(2px 2px 0 rgba(0,0,0,.5));}' +

  '.mbshop-body{flex:1 1 auto;min-width:0;display:flex;flex-direction:column;gap:3px;}' +
  '.mbshop-name{font-size:clamp(13px,1.5vw,16px);font-weight:700;letter-spacing:1px;' +
    'text-transform:uppercase;color:var(--bone,#e8e6d8);text-shadow:2px 2px 0 #000;}' +
  '.mbshop-desc{font-size:clamp(10px,1vw,12px);line-height:1.4;color:var(--bone-dim,#b9b6a6);min-height:2.6em;}' +

  '.mbshop-pips{display:flex;align-items:center;gap:3px;flex-wrap:wrap;margin:2px 0 1px;}' +
  '.mbshop-pip{width:9px;height:9px;border:1px solid #000;border-radius:1px;' +
    'background:linear-gradient(180deg,#271d33,#130e1d);box-shadow:inset 0 0 0 1px rgba(232,230,216,.06);}' +
  '.mbshop-pip.on{background:linear-gradient(180deg,var(--gold-bright,#ffdb7a),var(--gold,#f2c14e));' +
    'box-shadow:0 0 5px rgba(242,193,78,.6);}' +
  '.mbshop-lvtxt{margin-left:5px;font-size:10px;letter-spacing:1px;color:var(--bone-dim,#b9b6a6);}' +

  '.mbshop-foot{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-top:auto;}' +
  '.mbshop-cost{font-size:clamp(12px,1.3vw,15px);font-weight:700;letter-spacing:1px;' +
    'color:var(--gold,#f2c14e);text-shadow:1px 1px 0 #000;}' +
  '.mbshop-cost.mbshop-cant{color:var(--blood-bright,#e6313d);}' +
  '.mbshop-cost.mbshop-done{color:var(--ok,#7bbf4a);}' +

  '.mbshop-buy{font-family:inherit;font-size:clamp(11px,1.2vw,13px);font-weight:700;letter-spacing:2px;' +
    'text-transform:uppercase;color:var(--night-3,#0b0813);cursor:pointer;padding:6px 14px;border-radius:3px;' +
    'border:2px solid var(--blood,#b5202a);' +
    'background:linear-gradient(180deg,var(--gold-bright,#ffdb7a),var(--gold,#f2c14e));' +
    'box-shadow:3px 3px 0 rgba(0,0,0,.5);transition:transform .1s ease,box-shadow .1s ease,filter .1s ease;}' +
  '.mbshop-buy:hover{transform:translateY(-2px);box-shadow:0 5px 0 rgba(0,0,0,.5),0 0 16px rgba(242,193,78,.55);' +
    'filter:brightness(1.08);}' +
  '.mbshop-buy:active{transform:translateY(0);box-shadow:2px 2px 0 rgba(0,0,0,.5);}' +
  '.mbshop-buy:disabled{cursor:not-allowed;color:var(--bone-dim,#b9b6a6);' +
    'background:linear-gradient(180deg,#2c2238,#161021);border-color:#3a3050;box-shadow:2px 2px 0 rgba(0,0,0,.5);' +
    'filter:none;transform:none;}' +

  '.mbshop-foot-btns{display:flex;gap:10px;align-items:center;}' +
  '.mbshop-close{font-family:inherit;font-size:clamp(12px,1.5vw,16px);font-weight:700;letter-spacing:2px;' +
    'text-transform:uppercase;color:var(--bone,#e8e6d8);cursor:pointer;padding:10px 26px;border-radius:3px;' +
    'border:2px solid var(--blood,#b5202a);' +
    'background:linear-gradient(180deg,var(--panel-2,#2c2238),var(--night-2,#120e1b));' +
    'box-shadow:4px 4px 0 rgba(0,0,0,.55);transition:transform .1s ease,box-shadow .1s ease,background .1s ease,color .1s ease;}' +
  '.mbshop-close:hover{transform:translateY(-2px);color:var(--night-3,#0b0813);' +
    'background:linear-gradient(180deg,var(--gold-bright,#ffdb7a),var(--gold,#f2c14e));border-color:var(--gold-bright,#ffdb7a);' +
    'box-shadow:0 6px 0 rgba(0,0,0,.5),0 0 22px rgba(242,193,78,.55);}' +
  '.mbshop-hint{font-size:clamp(9px,1.1vw,12px);letter-spacing:2px;text-transform:uppercase;color:var(--grave,#6d6a7c);}' +
  '.mbshop-fo-wrap{display:flex;flex-direction:column;align-items:center;gap:8px;margin-top:6px;padding-bottom:8px;}' +

  '.mbshop-pix{image-rendering:pixelated;image-rendering:crisp-edges;display:block;}' +
  '.mbshop-start-btn .mbshop-coin{color:var(--gold-bright,#ffdb7a);}' +
  '@media (prefers-reduced-motion: reduce){#mbshop-overlay.mbshop-open{animation:none;}}';

  function injectCSS() {
    if (document.getElementById('mbshop-styles')) return;
    var s = document.createElement('style');
    s.id = 'mbshop-styles';
    s.type = 'text/css';
    s.appendChild(document.createTextNode(CSS));
    (document.head || document.documentElement).appendChild(s);
  }

  /* ------------------------------------------------------------------ *
   * Overlay UI
   * ------------------------------------------------------------------ */
  var _mounted = false;
  var _overlay = null;
  var _gridNode = null;
  var _walletNode = null;
  var _open = false;

  function mount() {
    if (_mounted) return;
    if (typeof document === 'undefined') return;
    injectCSS();

    var host = document.getElementById('ui-root') || document.body;
    if (!host) return;

    var ov = el('div');
    ov.id = 'mbshop-overlay';

    var inner = el('div', 'mbshop-inner');

    // header
    var head = el('div', 'mbshop-head');
    head.appendChild(el('div', 'mbshop-crest', '⚰'));
    head.appendChild(el('div', 'mbshop-title', 'THE BONE MERCHANT'));
    head.appendChild(el('div', 'mbshop-sub', '— spend the gold of the dead —'));
    inner.appendChild(head);

    // wallet bar
    var bar = el('div', 'mbshop-bar');
    var spacerL = el('div'); spacerL.style.flex = '1 1 0';
    var w = el('div', 'mbshop-wallet');
    _walletNode = w;
    var spacerR = el('div'); spacerR.style.flex = '1 1 0';
    bar.appendChild(spacerL);
    bar.appendChild(w);
    bar.appendChild(spacerR);
    inner.appendChild(bar);

    // grid of upgrade cards
    var grid = el('div', 'mbshop-grid');
    _gridNode = grid;
    inner.appendChild(grid);

    // footer: close button + hint
    var foot = el('div', 'mbshop-foot-btns');
    var close = el('button', 'mbshop-close', 'CLOSE  ✕');
    close.addEventListener('click', function (ev) { ev.stopPropagation(); closeShop(); });
    foot.appendChild(close);

    var fwrap = el('div', 'mbshop-fo-wrap');
    fwrap.appendChild(foot);
    fwrap.appendChild(el('div', 'mbshop-hint', 'Boons are permanent · Press ESC to leave'));
    inner.appendChild(fwrap);

    ov.appendChild(inner);
    host.appendChild(ov);
    _overlay = ov;
    _mounted = true;

    // ESC closes while open
    document.addEventListener('keydown', onShopKey);

    renderCards();
    renderWallet();
  }

  function onShopKey(e) {
    if (!_open) return;
    if (e.key === 'Escape' || e.key === 'Esc') {
      e.preventDefault();
      closeShop();
    }
  }

  function renderWallet() {
    if (_walletNode) {
      _walletNode.innerHTML = '';
      var coin = el('span', 'mbshop-coin', '⊙ ');
      _walletNode.appendChild(coin);
      _walletNode.appendChild(document.createTextNode('' + wallet()));
    }
  }

  function buildCard(def) {
    var lvl = levelOf(def.id);
    var max = def.maxLevel || 0;
    var maxed = lvl >= max;
    var cost = costOf(def.id);
    var affordable = canBuy(def.id);

    var card = el('div', 'mbshop-card' + (maxed ? ' mbshop-maxed' : ''));

    var ic = el('div', 'mbshop-ic');
    ic.appendChild(iconNode(def, 48));
    card.appendChild(ic);

    var body = el('div', 'mbshop-body');
    body.appendChild(el('div', 'mbshop-name', def.name || def.id));
    body.appendChild(el('div', 'mbshop-desc', def.desc || ''));

    // level pips
    var pips = el('div', 'mbshop-pips');
    for (var i = 0; i < max; i++) {
      pips.appendChild(el('span', 'mbshop-pip' + (i < lvl ? ' on' : '')));
    }
    pips.appendChild(el('span', 'mbshop-lvtxt', lvl + '/' + max));
    body.appendChild(pips);

    // footer: cost + buy button
    var foot = el('div', 'mbshop-foot');
    var costNode;
    if (maxed) {
      costNode = el('div', 'mbshop-cost mbshop-done', 'MAXED ★');
    } else {
      costNode = el('div', 'mbshop-cost' + (affordable ? '' : ' mbshop-cant'));
      costNode.appendChild(el('span', 'mbshop-coin', '⊙ '));
      costNode.appendChild(document.createTextNode('' + cost));
    }
    foot.appendChild(costNode);

    var buyBtn = el('button', 'mbshop-buy', maxed ? 'MAX' : 'BUY');
    buyBtn.disabled = maxed || !affordable;
    (function (id) {
      buyBtn.addEventListener('click', function (ev) {
        ev.stopPropagation();
        initAudio();
        if (buy(id)) {
          // buy() already calls refreshUI(); add a little juice
          if (MB.spawnFloatText && false) { /* world-space FX not relevant in menu */ }
        } else {
          sfx('hurt');
        }
      });
    })(def.id);
    foot.appendChild(buyBtn);

    body.appendChild(foot);
    card.appendChild(body);
    return card;
  }

  function renderCards() {
    if (!_gridNode) return;
    _gridNode.innerHTML = '';
    for (var i = 0; i < UPGRADES.length; i++) {
      _gridNode.appendChild(buildCard(UPGRADES[i]));
    }
  }

  // Live-refresh everything that displays shop state.
  function refreshUI() {
    if (_mounted && _open) {
      renderCards();
      renderWallet();
    } else if (_mounted) {
      renderWallet();
    }
    // keep the start-screen button label (wallet) current
    refreshStartButtonLabel();
  }

  function openShop() {
    mount();
    if (!_overlay) return;
    initAudio();
    renderCards();
    renderWallet();
    _overlay.classList.add('mbshop-open');
    _open = true;
    sfx('select');
  }

  function closeShop() {
    if (_overlay) _overlay.classList.remove('mbshop-open');
    _open = false;
    sfx('select');
    refreshStartButtonLabel();
  }

  function isOpen() { return _open; }

  /* ------------------------------------------------------------------ *
   * Start-screen button — added/refreshed onto #start-screen.
   * Idempotent: showStart() wipes the panel each render, so this re-adds.
   * ------------------------------------------------------------------ */
  function startButtonLabel() {
    return '⊙ SHOP · ' + wallet();
  }

  function refreshStartButtonLabel() {
    if (typeof document === 'undefined') return;
    var b = document.getElementById('mbshop-start-btn');
    if (b) b.textContent = startButtonLabel();
  }

  function mountStartButton() {
    if (typeof document === 'undefined') return;
    var start = document.getElementById('start-screen');
    if (!start) return; // no-op if absent
    injectCSS();

    // already present? just refresh its wallet label.
    var existing = document.getElementById('mbshop-start-btn');
    if (existing && start.contains(existing)) {
      existing.textContent = startButtonLabel();
      return existing;
    }

    var btn = el('button', 'btn mbshop-start-btn');
    btn.id = 'mbshop-start-btn';
    btn.textContent = startButtonLabel();
    btn.addEventListener('click', function (ev) {
      ev.stopPropagation();
      initAudio();
      openShop();
    });

    // Prefer to sit alongside the mute button in `.ss-bottom`; else append to panel.
    var bottom = start.querySelector('.ss-bottom');
    if (bottom) {
      bottom.appendChild(btn);
    } else {
      start.appendChild(btn);
    }
    return btn;
  }

  /* ------------------------------------------------------------------ *
   * Public API
   * ------------------------------------------------------------------ */
  MB.Shop = {
    // persistence
    load: load,
    save: save,
    // economy
    wallet: wallet,
    deposit: deposit,
    levelOf: levelOf,
    costOf: costOf,
    canBuy: canBuy,
    buy: buy,
    // stat application (recomputeStats hook)
    applyStats: applyStats,
    // UI
    mount: mount,
    openShop: openShop,
    closeShop: closeShop,
    isOpen: isOpen,
    mountStartButton: mountStartButton,
    // data
    UPGRADES: UPGRADES,
  };

})(window.MB = window.MB || {});
