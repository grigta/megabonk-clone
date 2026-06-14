/* MEGABONK: PIXEL CRYPT — biomes.js
 * MB.Biomes — a procedural, multi-biome overworld layer that makes the crypt
 * feel like a vast, saturated, ever-changing gothic wasteland.
 *
 *   6 biomes: graveyard · swamp · ash · bone · blood · frost
 *   - biomeAt(wx,wy)  deterministic biome from a coarse value-region hash
 *   - drawGround(ctx) biome-aware tiled ground (REPLACES main's single tile)
 *   - draw(ctx)       lush scattered detail props (UNDER entities), chunked
 *   - drawAmbient(ctx)atmospheric particles + tint + vignette (OVER entities)
 *   - update(dt,p)    grow scatter, advance ambient, track Biomes.current
 *   - startRun(p) / reset()
 *
 * Loads AFTER core.js + sprites.js. Every cross-module reference is made at
 * CALL TIME via MB.* and guarded so a missing/late module can never throw.
 * Allocation-light in all hot loops; everything culled to the viewport.
 */
(function (MB) {
  'use strict';

  /* ================================================================== *
   * Biome identity
   * ================================================================== */
  var BIOMES = ['graveyard', 'swamp', 'ash', 'bone', 'blood', 'frost'];

  var LABEL = {
    graveyard: 'The Graveyard',
    swamp: 'Fetid Swamp',
    ash: 'Ashen Wastes',
    bone: 'The Bonefields',
    blood: 'Crimson Moor',
    frost: 'Frozen Hollow'
  };

  // accent colors (seam dithering) — straight from the shared biome contract
  var ACCENT = {
    graveyard: '#5a3a78', swamp: '#3a7d5a', ash: '#ff7a30',
    bone: '#b8b09a', blood: '#7d1620', frost: '#cfe6f5'
  };

  // ambient mood per biome: tint overlay + vignette + particle defaults
  var AMB = {
    graveyard: { sub: 'mote',  count: 50,  color: '#9a86c8', add: true,  rise: false, tint: '#241b33', tintA: 0.05 },
    swamp:     { sub: 'mote',  count: 62,  color: '#7fd08a', add: true,  rise: false, tint: '#16321f', tintA: 0.14, fog: '#2f5d4a' },
    ash:       { sub: 'ember', count: 96,  color: '#ff8a3a', add: true,  rise: true,  tint: '#2a0f06', tintA: 0.13 },
    bone:      { sub: 'mote',  count: 58,  color: '#e8e2c8', add: true,  rise: false, tint: '#26241c', tintA: 0.08 },
    blood:     { sub: 'mote',  count: 60,  color: '#b8404e', add: true,  rise: true,  tint: '#2a0810', tintA: 0.15 },
    frost:     { sub: 'snow',  count: 116, color: '#dfeefb', add: false, rise: false, tint: '#16263a', tintA: 0.13 }
  };

  /* ================================================================== *
   * Scatter catalogs (weight by repetition) + grand props (any biome)
   * ================================================================== */
  var SCATTER = {
    graveyard: ['tombstone', 'tombstone', 'cross', 'cross', 'deadtree', 'deadtree', 'skull', 'bone_pile', 'obelisk'],
    swamp:     ['reed', 'reed', 'reed', 'lilypad', 'lilypad', 'mushroom', 'mushroom', 'mushroom_blue', 'swamp_log'],
    ash:       ['ember_rock', 'ember_rock', 'charred_stump', 'charred_stump', 'ember_rock', 'brazier'],
    bone:      ['bone_pile', 'bone_pile', 'ribcage', 'skull', 'skull', 'bone_spike', 'bone_spike'],
    blood:     ['dead_red_grass', 'dead_red_grass', 'thorn_bush', 'thorn_bush', 'blood_pool', 'hanged_cage'],
    frost:     ['snow_mound', 'snow_mound', 'ice_shard', 'ice_shard', 'frozen_grave', 'icicle_rock']
  };
  var GRAND = ['statue', 'mausoleum', 'stone_pillar', 'lantern_post', 'bonfire', 'obelisk'];

  // per-512px-chunk base prop count by biome
  var DENSITY = { graveyard: 13, swamp: 18, ash: 12, bone: 17, blood: 14, frost: 15 };

  // baked-once render metadata per prop name
  var PROP_META = {
    tombstone: { shadow: 5 }, cross: { shadow: 4 }, deadtree: { shadow: 6 }, skull: { shadow: 3 },
    obelisk: { shadow: 6 }, statue: { shadow: 6 }, mausoleum: { shadow: 11 }, stone_pillar: { shadow: 5 },
    reed: { shadow: 2 }, lilypad: { flat: true }, mushroom: { shadow: 2 }, mushroom_blue: { shadow: 2 }, swamp_log: { shadow: 6 },
    charred_stump: { shadow: 5 }, ember_rock: { shadow: 3, glow: 13, glowCol: '#ff6a20' },
    brazier: { shadow: 3, anim: 2, afps: 8, glow: 30, glowCol: '#ff8a3a' },
    bone_pile: { shadow: 4 }, ribcage: { shadow: 5 }, bone_spike: { shadow: 2 },
    thorn_bush: { shadow: 4 }, blood_pool: { flat: true }, dead_red_grass: { shadow: 1 }, hanged_cage: { shadow: 4 },
    ice_shard: { shadow: 3 }, frozen_grave: { shadow: 4 }, snow_mound: { shadow: 5 }, icicle_rock: { shadow: 3 },
    lantern_post: { shadow: 3, anim: 2, afps: 6, glow: 26, glowCol: '#ffb24d' },
    bonfire: { shadow: 5, anim: 2, afps: 7, glow: 46, glowCol: '#ff8a3a' }
  };
  var DEF_META = { shadow: 3 };

  /* ================================================================== *
   * Tunables
   * ================================================================== */
  var REGION = 1100;        // local biome cell (px)
  var SUPER = 3300;         // super-region (~3 cells) for big contiguous blobs
  var SAFE2 = 900 * 900;    // graveyard guaranteed within this radius of origin
  var TILE = 32;            // ground tile world px (matches main + sprites)

  var CHUNK = 512;          // scatter generation chunk (px)
  var INIT_R = 3;           // chunks generated around player at startRun
  var EXPLORE_R = 2;        // chunks kept generated around the roaming player
  var MAX_CHUNKS = 140;     // memory cap before far chunks are pruned
  var AMB_MAX = 120;        // hard ambient particle cap

  /* ================================================================== *
   * Module state
   * ================================================================== */
  var _chunks = Object.create(null);   // key -> { cx2, cy2, props[], hasLight }
  var _chunkCount = 0;

  var _vis = [];            // reusable per-frame visible prop list (y-sorted)
  var _lights = [];         // reusable per-frame visible light props
  function _byY(a, b) { return a.y - b.y; }

  var _amb = null;          // ambient particle pool (created once)
  var _ambInit = false;
  var _activeCount = 0;     // currently rendered ambient particles

  var _current = 'graveyard';
  var _lastToast = -999;

  // cached vignette gradient (rebuilt only on size/biome change)
  var _vg = { g: null, w: 0, h: 0, b: '' };

  /* ================================================================== *
   * Integer hash (deterministic, allocation-free)
   * ================================================================== */
  function hash(x, y, s) {
    var h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(s | 0, 2246822519 | 0)) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    h ^= h >>> 16;
    return h >>> 0;
  }

  /* ================================================================== *
   * Smooth value noise (deterministic, allocation-free) — used to warp the
   * biome lattice so regions are organic blobs, not axis-aligned rectangles.
   * ================================================================== */
  function fade(t) { return t * t * (3 - 2 * t); }
  function h01(ix, iy, s) { return (hash(ix, iy, s) & 0xffff) / 65536; }
  function vnoise(x, y, s) {
    var xi = Math.floor(x), yi = Math.floor(y);
    var xf = x - xi, yf = y - yi;
    var u = fade(xf), v = fade(yf);
    var n00 = h01(xi, yi, s), n10 = h01(xi + 1, yi, s);
    var n01 = h01(xi, yi + 1, s), n11 = h01(xi + 1, yi + 1, s);
    var nx0 = n00 + (n10 - n00) * u;
    var nx1 = n01 + (n11 - n01) * u;
    return nx0 + (nx1 - nx0) * v;        // [0,1)
  }

  /* ================================================================== *
   * biomeAt — value-region biome with a cohesive graveyard origin, but the
   * sample point is DOMAIN-WARPED by low-frequency noise so the borders
   * between biomes are wavy/organic instead of straight rectangle edges.
   *  - 3300px super-regions give large, walk-through swaths
   *  - ~22% of 1100px cells become a different "pocket" for organic variety
   * ================================================================== */
  var WARP_F = 0.00125;     // warp frequency (~1 cycle / 800px)
  var WARP_A = 560;         // warp amplitude (px) — ~half a region
  function biomeAt(wx, wy) {
    if (wx * wx + wy * wy < SAFE2) return 'graveyard';
    // push the sample point around with smooth noise → organic region shapes
    var ax = (vnoise(wx * WARP_F, wy * WARP_F, 101) - 0.5) * 2 * WARP_A;
    var ay = (vnoise(wx * WARP_F + 5.2, wy * WARP_F + 1.7, 202) - 0.5) * 2 * WARP_A;
    var nx = wx + ax, ny = wy + ay;
    var rx = Math.floor(nx / REGION), ry = Math.floor(ny / REGION);
    if ((hash(rx, ry, 7) & 255) < 56) {
      return BIOMES[hash(rx, ry, 19) % 6];
    }
    var sx = Math.floor(nx / SUPER), sy = Math.floor(ny / SUPER);
    return BIOMES[hash(sx, sy, 3) % 6];
  }

  /* biomeGround — what the GROUND renderer samples: biomeAt plus a short
   * high-frequency jitter so the seam between two biomes BLEEDS across a few
   * tiles (a dithered transition band) instead of one hard line. */
  var BLEED_F = 0.010;      // jitter frequency (~1 cycle / 100px) — per-tile variation
  var BLEED_A = 132;        // jitter amplitude (px) → ~4 tile interlaced bleed band
  function biomeGround(wx, wy) {
    var jx = wx + (vnoise(wx * BLEED_F, wy * BLEED_F, 303) - 0.5) * 2 * BLEED_A;
    var jy = wy + (vnoise(wx * BLEED_F + 3.3, wy * BLEED_F + 9.1, 404) - 0.5) * 2 * BLEED_A;
    return biomeAt(jx, jy);
  }

  /* ================================================================== *
   * small drawing helpers
   * ================================================================== */
  function hexA(hex, a) {
    if (!hex || hex.charAt(0) !== '#' || hex.length < 7) return 'rgba(0,0,0,' + (a || 0) + ')';
    var r = parseInt(hex.substr(1, 2), 16);
    var g = parseInt(hex.substr(3, 2), 16);
    var b = parseInt(hex.substr(5, 2), 16);
    if (r !== r) r = 0; if (g !== g) g = 0; if (b !== b) b = 0;
    return 'rgba(' + r + ',' + g + ',' + b + ',' + a.toFixed(3) + ')';
  }

  function groundShadow(ctx, wx, wy, rScreen) {
    var p = MB.cam.worldToScreen(wx, wy);
    ctx.globalAlpha = 0.22;
    ctx.fillStyle = '#000000';
    ctx.beginPath();
    if (ctx.ellipse) ctx.ellipse(p.sx, p.sy, rScreen, rScreen * 0.4, 0, 0, 6.2832);
    else ctx.fillRect(p.sx - rScreen, p.sy - rScreen * 0.4, rScreen * 2, rScreen * 0.8);
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  function drawGlow(ctx, wx, wy, rWorld, col, alpha) {
    var p = MB.cam.worldToScreen(wx, wy);
    var r = rWorld * MB.VIEW_SCALE;
    var g = ctx.createRadialGradient(p.sx, p.sy, 1, p.sx, p.sy, r);
    g.addColorStop(0, hexA(col, alpha));
    g.addColorStop(0.5, hexA(col, alpha * 0.5));
    g.addColorStop(1, hexA(col, 0));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(p.sx, p.sy, r, 0, 6.2832);
    ctx.fill();
  }

  /* ================================================================== *
   * Scatter chunk generation
   * ================================================================== */
  function makeProp(x, y, name) {
    var m = PROP_META[name] || DEF_META;
    return {
      x: x, y: y, name: name,
      shadow: m.shadow || 0, flat: !!m.flat,
      anim: m.anim || 0, afps: m.afps || 0,
      glow: m.glow || 0, glowCol: m.glowCol || '#ff8a3a',
      gphase: (x * 0.13 + y * 0.07)
    };
  }

  function generateChunk(cx, cy) {
    var key = cx + ',' + cy;
    if (_chunks[key]) return;

    var x0 = cx * CHUNK, y0 = cy * CHUNK;
    var baseBiome = biomeAt(x0 + CHUNK / 2, y0 + CHUNK / 2);
    var n = DENSITY[baseBiome] || 13;

    var props = [];
    var hasLight = false;
    var i, x, y, b, name, p;

    for (i = 0; i < n; i++) {
      x = x0 + MB.rand(6, CHUNK - 6);
      y = y0 + MB.rand(6, CHUNK - 6);
      if (x * x + y * y < 120 * 120) continue;          // keep the spawn clear
      b = biomeAt(x, y);
      name = MB.pick(SCATTER[b] || SCATTER.graveyard);
      p = makeProp(x, y, name);
      if (p.glow) hasLight = true;
      props.push(p);
    }

    // an occasional grand monument for vertical drama (any biome)
    if (MB.chance(0.55)) {
      x = x0 + MB.rand(40, CHUNK - 40);
      y = y0 + MB.rand(40, CHUNK - 40);
      if (x * x + y * y > 200 * 200) {
        p = makeProp(x, y, MB.pick(GRAND));
        if (p.glow) hasLight = true;
        props.push(p);
      }
    }

    props.sort(_byY);
    _chunks[key] = { cx2: x0 + CHUNK / 2, cy2: y0 + CHUNK / 2, props: props, hasLight: hasLight };
    _chunkCount++;
  }

  function ensureChunksAround(wx, wy, r) {
    var pcx = Math.floor(wx / CHUNK), pcy = Math.floor(wy / CHUNK);
    for (var dx = -r; dx <= r; dx++) {
      for (var dy = -r; dy <= r; dy++) generateChunk(pcx + dx, pcy + dy);
    }
  }

  function pruneChunks(player) {
    if (_chunkCount <= MAX_CHUNKS || !player) return;
    var keep2 = 2600 * 2600;
    for (var key in _chunks) {
      var ch = _chunks[key];
      if (MB.dist2(ch.cx2, ch.cy2, player.x, player.y) > keep2) {
        delete _chunks[key];
        _chunkCount--;
      }
    }
  }

  /* ================================================================== *
   * Ambient particles (screen-space — they ride the camera like weather)
   * ================================================================== */
  function spawnAmb(p, biome, fresh) {
    var S = MB.State;
    var w = S.screen.w || 960, h = S.screen.h || 540;
    var d = AMB[biome] || AMB.graveyard;
    var sub = d.sub;

    if (biome === 'swamp') {
      var rr = Math.random();
      sub = rr < 0.12 ? 'fog' : (rr < 0.40 ? 'firefly' : 'mote');
    }

    p.sub = sub;
    p.t = 0;
    p.phase = Math.random() * 6.2832;

    if (sub === 'ember') {
      p.x = Math.random() * w;
      p.y = fresh ? Math.random() * h : h + Math.random() * 24;
      p.vx = (Math.random() * 2 - 1) * 8;
      p.vy = -(20 + Math.random() * 32);
      p.size = 1 + (Math.random() * 2 | 0);
      p.life = 2.2 + Math.random() * 2.6;
      p.amp = 10 + Math.random() * 14; p.swf = 1.4 + Math.random();
      p.col = Math.random() < 0.5 ? '#ff7a30' : '#ffc24d';
      p.add = true;
    } else if (sub === 'snow') {
      p.x = Math.random() * w;
      p.y = fresh ? Math.random() * h : -8 - Math.random() * 24;
      p.vx = (Math.random() * 2 - 1) * 10;
      p.vy = 18 + Math.random() * 42;
      p.size = 1 + (Math.random() < 0.4 ? 1 : 0);
      p.life = 99;
      p.amp = 14 + Math.random() * 16; p.swf = 0.6 + Math.random() * 0.8;
      p.col = '#e6f1fb';
      p.add = false;
    } else if (sub === 'firefly') {
      p.x = Math.random() * w; p.y = Math.random() * h;
      p.vx = (Math.random() * 2 - 1) * 14;
      p.vy = (Math.random() * 2 - 1) * 10;
      p.size = 1;
      p.life = 2.4 + Math.random() * 2.6;
      p.amp = 8; p.swf = 2 + Math.random() * 2;
      p.col = '#c8ff6e';
      p.add = true;
    } else if (sub === 'fog') {
      p.x = Math.random() * w;
      p.y = h * 0.35 + Math.random() * h * 0.65;
      p.vx = (Math.random() * 2 - 1) * 9;
      p.vy = -2 - Math.random() * 3;
      p.r = 44 + Math.random() * 64;
      p.life = 6 + Math.random() * 5;
      p.amp = 6; p.swf = 0.4 + Math.random() * 0.4;
      p.col = d.fog || '#2f5d4a';
      p.add = false;
    } else { // mote / dust / haze
      p.x = Math.random() * w; p.y = Math.random() * h;
      p.vx = (Math.random() * 2 - 1) * 12;
      p.vy = d.rise ? -(4 + Math.random() * 8) : (Math.random() * 2 - 1) * 6;
      p.size = 1 + (Math.random() < 0.3 ? 1 : 0);
      p.life = 3 + Math.random() * 3;
      p.amp = 6 + Math.random() * 8; p.swf = 0.5 + Math.random();
      p.col = d.color;
      p.add = !!d.add;
    }
  }

  function initAmbient() {
    if (!_amb) {
      _amb = new Array(AMB_MAX);
      for (var i = 0; i < AMB_MAX; i++) _amb[i] = {};
    }
    for (var j = 0; j < AMB_MAX; j++) spawnAmb(_amb[j], _current, true);
    _activeCount = Math.min(AMB_MAX, (AMB[_current] || AMB.graveyard).count);
    _ambInit = true;
  }

  function updateAmbient(dt) {
    if (!_ambInit) initAmbient();
    var S = MB.State;
    var w = S.screen.w || 960, h = S.screen.h || 540;

    var target = Math.min(AMB_MAX, (AMB[_current] || AMB.graveyard).count);
    if (_activeCount < target) _activeCount++;
    else if (_activeCount > target) _activeCount--;

    for (var i = 0; i < _activeCount; i++) {
      var p = _amb[i];
      if (!p.sub) { spawnAmb(p, _current, true); continue; }
      p.t += dt;
      p.x += (p.vx + Math.sin((p.t + p.phase) * p.swf) * p.amp) * dt;
      p.y += p.vy * dt;
      if (p.t > p.life || p.x < -40 || p.x > w + 40 || p.y < -40 || p.y > h + 40) {
        spawnAmb(p, _current, false);
      }
    }
  }

  function drawAmbParticle(ctx, p) {
    var fade = (p.life >= 90) ? 1 : MB.clamp(Math.min(p.t, p.life - p.t) / 0.8, 0, 1);

    if (p.sub === 'fog') {
      ctx.globalCompositeOperation = 'source-over';
      var g = ctx.createRadialGradient(p.x, p.y, 1, p.x, p.y, p.r);
      g.addColorStop(0, hexA(p.col, 0.16 * fade));
      g.addColorStop(1, hexA(p.col, 0));
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, 6.2832);
      ctx.fill();
      return;
    }

    ctx.globalCompositeOperation = p.add ? 'lighter' : 'source-over';

    if (p.sub === 'firefly') {
      var fl = 0.5 + 0.5 * Math.sin((p.t + p.phase) * 4);
      ctx.globalAlpha = fade * fl;
      ctx.fillStyle = p.col;
      ctx.fillRect((p.x | 0) - 1, (p.y | 0) - 1, 3, 3);
      ctx.globalAlpha = fade * fl * 0.85;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(p.x | 0, p.y | 0, 1, 1);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
      return;
    }

    var flick = (p.sub === 'ember') ? (0.6 + 0.4 * Math.sin((p.t + p.phase) * 6)) : 1;
    ctx.globalAlpha = fade * 0.85 * flick;
    ctx.fillStyle = p.col;
    var s = p.size * 2;
    ctx.fillRect((p.x - s / 2) | 0, (p.y - s / 2) | 0, s, s);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  function drawVignette(ctx, w, h, d) {
    if (_vg.w !== w || _vg.h !== h || _vg.b !== _current) {
      var g = ctx.createRadialGradient(
        w / 2, h / 2, Math.min(w, h) * 0.30,
        w / 2, h / 2, Math.max(w, h) * 0.72);
      g.addColorStop(0, 'rgba(0,0,0,0)');
      g.addColorStop(1, hexA(d.tint, 0.5));
      _vg.g = g; _vg.w = w; _vg.h = h; _vg.b = _current;
    }
    ctx.fillStyle = _vg.g;
    ctx.fillRect(0, 0, w, h);
  }

  /* ================================================================== *
   * PUBLIC: drawGround — biome-aware tiled ground (REPLACES main tiling)
   * ================================================================== */
  function edgeDither(ctx, x, y, len, vert, biome) {
    var col = ACCENT[biome] || '#000000';
    var pa = ctx.globalAlpha;
    ctx.globalAlpha = 0.4;
    ctx.fillStyle = col;
    var i;
    if (vert) {
      for (i = 0; i < len; i += 3) if (((i >> 1) & 1) === 0) ctx.fillRect(x - 1, y + i, 2, 2);
    } else {
      for (i = 0; i < len; i += 3) if (((i >> 1) & 1) === 0) ctx.fillRect(x + i, y - 1, 2, 2);
    }
    ctx.globalAlpha = pa;
  }

  function drawGround(ctx) {
    try {
      if (!MB.cam || !MB.State.screen) return;
      var S = MB.State, sc = MB.VIEW_SCALE, tw = TILE, tp = tw * sc;
      var hasG = MB.Sprites && MB.Sprites.groundTile;

      var wl = S.camera.x - S.screen.cx / sc;
      var wt = S.camera.y - S.screen.cy / sc;
      var wr = S.camera.x + S.screen.cx / sc;
      var wb = S.camera.y + S.screen.cy / sc;
      var sX = Math.floor(wl / tw) * tw;
      var sY = Math.floor(wt / tw) * tw;

      for (var ty = sY - tw; ty <= wb + tw; ty += tw) {
        for (var tx = sX - tw; tx <= wr + tw; tx += tw) {
          var b = biomeGround(tx + 16, ty + 16);
          var v = hash(tx / tw, ty / tw, 11) % 3;
          var tile = hasG ? MB.Sprites.groundTile(b, v) : null;
          var p = MB.cam.worldToScreen(tx, ty);
          var dx = Math.floor(p.sx), dy = Math.floor(p.sy);

          if (tile) ctx.drawImage(tile, dx, dy, tp + 1, tp + 1);
          else { ctx.fillStyle = '#221d2b'; ctx.fillRect(dx, dy, tp + 1, tp + 1); }

          // subtle 1px-stipple transition where neighbours change biome
          var br = biomeGround(tx + tw + 16, ty + 16);
          if (br !== b) edgeDither(ctx, dx + tp, dy, tp, true, br);
          var bb = biomeGround(tx + 16, ty + tw + 16);
          if (bb !== b) edgeDither(ctx, dx, dy + tp, tp, false, bb);
        }
      }
    } catch (e) { /* never throw mid-render */ }
  }

  /* ================================================================== *
   * PUBLIC: draw — scattered biome detail props (UNDER entities)
   * ================================================================== */
  function draw(ctx) {
    try {
      if (!MB.cam || !MB.State.player) return;
      var vis = _vis, lights = _lights;
      vis.length = 0; lights.length = 0;

      var key, ch, ps, i, p;
      for (key in _chunks) {
        ch = _chunks[key];
        if (!MB.cam.onScreen(ch.cx2, ch.cy2, 820)) continue;
        ps = ch.props;
        for (i = 0; i < ps.length; i++) {
          p = ps[i];
          if (!MB.cam.onScreen(p.x, p.y, 96)) continue;
          vis.push(p);
          if (p.glow) lights.push(p);
        }
      }

      var t = MB.State.time || 0;
      var sc = MB.VIEW_SCALE;

      // warm light pools first (additive, beneath the props)
      if (lights.length) {
        ctx.globalCompositeOperation = 'lighter';
        for (i = 0; i < lights.length; i++) {
          p = lights[i];
          var lf = 0.7 + 0.3 * Math.sin(t * 7 + p.gphase);
          drawGlow(ctx, p.x, p.y - 8, p.glow, p.glowCol, 0.5 * lf);
        }
        ctx.globalCompositeOperation = 'source-over';
      }

      vis.sort(_byY);
      for (i = 0; i < vis.length; i++) {
        p = vis[i];
        if (!p.flat && p.shadow) groundShadow(ctx, p.x, p.y, p.shadow * sc * 0.55);
        var frame = p.anim ? (Math.floor(t * p.afps) % p.anim) : 0;
        if (MB.drawNamed) {
          MB.drawNamed(ctx, p.name, frame, p.x, p.y, { anchor: p.flat ? 'center' : 'bottom' });
        }
      }
    } catch (e) { /* never throw mid-render */ }
  }

  /* ================================================================== *
   * PUBLIC: drawAmbient — particles + tint + vignette (OVER entities)
   * ================================================================== */
  function drawAmbient(ctx) {
    try {
      var S = MB.State;
      var w = S.screen.w || 960, h = S.screen.h || 540;
      if (!_ambInit) initAmbient();

      var n = _activeCount | 0;
      for (var i = 0; i < n; i++) {
        var p = _amb[i];
        if (p.sub) drawAmbParticle(ctx, p);
      }
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;

      var d = AMB[_current] || AMB.graveyard;
      if (d.tintA > 0) {
        var pa = ctx.globalAlpha;
        ctx.globalAlpha = d.tintA;
        ctx.fillStyle = d.tint;
        ctx.fillRect(0, 0, w, h);
        ctx.globalAlpha = pa;
      }
      drawVignette(ctx, w, h, d);
    } catch (e) {
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
    }
  }

  /* ================================================================== *
   * PUBLIC: update — grow scatter, advance ambient, track current biome
   * ================================================================== */
  function update(dt, player) {
    try {
      if (!player) return;
      ensureChunksAround(player.x, player.y, EXPLORE_R);
      pruneChunks(player);
      updateAmbient(dt);

      var nb = biomeAt(player.x, player.y);
      if (nb !== _current) {
        _current = nb;
        API.current = nb;
        var now = MB.State.time || 0;
        if (now - _lastToast > 0.9 && MB.UI && MB.UI.toast) {
          _lastToast = now;
          try { MB.UI.toast(LABEL[nb] || nb, 1500); } catch (e2) {}
        }
      }
    } catch (e) { /* never throw mid-sim */ }
  }

  /* ================================================================== *
   * PUBLIC: lifecycle
   * ================================================================== */
  function reset() {
    _chunks = Object.create(null);
    _chunkCount = 0;
    _vis.length = 0;
    _lights.length = 0;
    _ambInit = false;
    _activeCount = 0;
    _current = 'graveyard';
    _lastToast = -999;
    _vg.g = null; _vg.w = 0; _vg.h = 0; _vg.b = '';
    API.current = 'graveyard';
  }

  function startRun(player) {
    try {
      reset();
      if (player) {
        _current = biomeAt(player.x, player.y);
        API.current = _current;
        ensureChunksAround(player.x, player.y, INIT_R);
      } else {
        ensureChunksAround(0, 0, INIT_R);
      }
      initAmbient();
      _lastToast = MB.State.time || 0;
    } catch (e) { /* never throw on boot */ }
  }

  /* ================================================================== *
   * Public API
   * ================================================================== */
  var API = {
    biomeAt: biomeAt,
    startRun: startRun,
    reset: reset,
    drawGround: drawGround,
    draw: draw,
    drawAmbient: drawAmbient,
    update: update,
    current: 'graveyard'
  };
  MB.Biomes = API;

})(window.MB = window.MB || {});
