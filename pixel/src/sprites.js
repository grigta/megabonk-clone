/* MEGABONK: PIXEL CRYPT — sprites.js
 * MB.Sprites — ALL pixel art, drawn procedurally onto offscreen canvases.
 * No image files. A tiny string-grid painter + per-sprite builders + caches.
 *
 * Public API (exact):
 *   MB.Sprites.preload()
 *   MB.Sprites.get(name, frame=0)      -> HTMLCanvasElement (1x art)
 *   MB.Sprites.getWhite(name, frame=0) -> all-white silhouette (hit-flash)
 *   MB.Sprites.groundTile()            -> ~32x32 seamless graveyard tile
 *   MB.Sprites.icon(name)              -> ~16x16 UI icon (never throws)
 *
 * Load order: AFTER core.js. References other modules only at call-time.
 */
(function (MB) {
  'use strict';

  /* ================================================================== *
   * Master gothic palette  (char -> css color). ' ' and '.' = transparent
   * ================================================================== */
  var PAL = {
    o: '#e8e6d8', O: '#b9b7a6',   // bone / bone-shade
    r: '#b5202a', R: '#7d1620',   // blood / deepblood
    u: '#5a3a78', U: '#3c2754',   // bruise / bruise2
    g: '#6d6a7c', G: '#4a4754',   // grave grey / grave-dark
    s: '#7bbf4a', S: '#4f8f33',   // slime / slime-dark
    y: '#f2c14e', Y: '#c0892c',   // gold / gold-dark
    n: '#1b1726',                 // night
    h: '#bcd7e8', H: '#8fb4cc',   // ghost / ghost-dark
    e: '#ff4040',                 // red-eye
    k: '#0d0a14',                 // near-black outline
    w: '#ffffff',                 // white
    b: '#6e4a2b', B: '#432a16', l: '#9c6a3c', // wood / dark / light
    f: '#cd9d6f', F: '#9c6f47',   // flesh / flesh-shade
    i: '#f07418', I: '#ffe089',   // fire-orange / light-yellow
    z: '#aee4ff',                 // lightning bolt
    m: '#9aa6b4', M: '#5a6470',   // metal / metal-dark
    c: '#2a2236', C: '#46395e',   // cloak-dark / cloak-mid
    p: '#d7c3ad', P: '#ab987f',   // pale skin / shade
    d: '#191522',                 // dirt-dark
    t: '#f4f2e6',                 // bright bone (teeth)
    v: '#a6e05a',                 // poison highlight
    q: '#8a9a55', Q: '#5e6b38',   // zombie sick-green / shade
    x: '#3aa0d8', X: '#1d4a66'    // magic blue / dark
  };

  /* ================================================================== *
   * BIOME palette — extends PAL with biome-specific colors (new chars only,
   * never collides with the master palette). Used by all biome decor +
   * ground tiles. Decor builders paint with BPAL so they can reach both
   * the gothic master colors AND these biome accents.
   *   digits 0-9  -> SWAMP (mud / water / reeds / mushrooms)
   *   D E j J     -> ASH   (volcanic ash / ember orange)
   *   L N T       -> BONE  (ivory dust / bone shadow)
   *   V W Z       -> BLOOD (crimson moor)
   *   a A         -> FROST (ice blue / pale ice)
   * ================================================================== */
  var BPAL = (function () {
    var o = {}, k;
    for (k in PAL) o[k] = PAL[k];
    // SWAMP
    o['1'] = '#1d3328'; o['2'] = '#2f5d4a'; o['3'] = '#3a7d5a';
    o['4'] = '#244f4a'; o['5'] = '#3a6d63'; o['6'] = '#6b8f3a';
    o['7'] = '#a83a3a'; o['8'] = '#7d2828'; o['9'] = '#3a6db0'; o['0'] = '#6fa0e0';
    // ASH
    o['D'] = '#1c1a1e'; o['E'] = '#3a3438'; o['j'] = '#4f4a50'; o['J'] = '#ff7a30';
    // BONE
    o['L'] = '#d8d2bc'; o['N'] = '#b8b09a'; o['T'] = '#8c856f';
    // BLOOD
    o['V'] = '#3a0e14'; o['W'] = '#5a1820'; o['Z'] = '#7d1620';
    // FROST
    o['a'] = '#9fc7e8'; o['A'] = '#cfe6f5';
    return o;
  })();

  /* ================================================================== *
   * Canvas + paint helpers
   * ================================================================== */
  function makeCanvas(w, h) {
    var c = document.createElement('canvas');
    c.width = Math.max(1, w | 0);
    c.height = Math.max(1, h | 0);
    return c;
  }

  // Paint an array of row-strings using a palette map. scale defaults to 1.
  // Out-of-range chars / unknown chars / ' ' / '.' are transparent.
  function paint(rows, pal, scale) {
    pal = pal || PAL;
    scale = scale || 1;
    var h = rows.length, w = 0, y, x, row, ch, col;
    for (y = 0; y < h; y++) if (rows[y].length > w) w = rows[y].length;
    var c = makeCanvas(w * scale, h * scale);
    var ctx = c.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    for (y = 0; y < h; y++) {
      row = rows[y];
      for (x = 0; x < row.length; x++) {
        ch = row.charAt(x);
        if (ch === ' ' || ch === '.') continue;
        col = pal[ch];
        if (!col) continue;
        ctx.fillStyle = col;
        ctx.fillRect(x * scale, y * scale, scale, scale);
      }
    }
    return c;
  }

  // All-white silhouette of a source canvas (alpha preserved). Robust pixel read.
  function whitenCanvas(src) {
    var c = makeCanvas(src.width, src.height);
    var ctx = c.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(src, 0, 0);
    try {
      var img = ctx.getImageData(0, 0, c.width, c.height);
      var d = img.data;
      for (var i = 0; i < d.length; i += 4) {
        if (d[i + 3] > 0) { d[i] = 255; d[i + 1] = 255; d[i + 2] = 255; }
      }
      ctx.putImageData(img, 0, 0);
    } catch (err) { /* tainted canvas should never happen here */ }
    return c;
  }

  var _placeholder = null;
  function placeholder() {
    if (_placeholder) return _placeholder;
    var c = makeCanvas(8, 8), ctx = c.getContext('2d');
    ctx.fillStyle = '#ff00ff'; ctx.fillRect(0, 0, 8, 8);
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, 4, 4); ctx.fillRect(4, 4, 4, 4);
    _placeholder = c;
    return c;
  }

  /* ================================================================== *
   * Builder registry + caches  (2-level cache => no per-call string alloc)
   * ================================================================== */
  var builders = Object.create(null);   // name -> function(frame) -> canvas
  var cache = Object.create(null);      // name -> [frame] canvas
  var whiteCache = Object.create(null); // name -> [frame] canvas
  var iconCache = Object.create(null);  // iconName -> canvas

  function reg(name, fn) { builders[name] = fn; }

  function get(name, frame) {
    frame = frame ? (frame | 0) : 0;
    var arr = cache[name];
    if (arr) { var hit = arr[frame]; if (hit) return hit; }
    else { arr = cache[name] = []; }
    var b = builders[name], c;
    try { c = b ? (b(frame) || placeholder()) : placeholder(); }
    catch (err) { c = placeholder(); }
    arr[frame] = c;
    return c;
  }

  function getWhite(name, frame) {
    frame = frame ? (frame | 0) : 0;
    var arr = whiteCache[name];
    if (arr) { var hit = arr[frame]; if (hit) return hit; }
    else { arr = whiteCache[name] = []; }
    var c = whitenCanvas(get(name, frame));
    arr[frame] = c;
    return c;
  }

  /* ================================================================== *
   * Helper for rows-based builders + simple frame switching
   * ================================================================== */
  function fromRows(rows, pal) { return paint(rows, pal || PAL, 1); }
  function framed(framesArr, pal) {
    return function (frame) { return paint(framesArr[frame] || framesArr[0], pal || PAL, 1); };
  }

  /* ================================================================== *
   * HERO  (16x20-ish, faces right, hat + cloak + blood scarf)
   * ================================================================== */
  reg('hero', framed([
    [ // frame 0 — feet together
      '     kkkk     ',
      '    kCCCCk    ',
      '   kCCCCCCk   ',
      '  kCCCCCCCCk  ',
      ' kGGGGGGGGGGk ',
      '   pppppppp   ',
      '   ppkppkpp   ',
      '   pppppppp   ',
      '   PppppppP   ',
      '  rrCCCCCCrr  ',
      ' cCCCCCCCCCCc ',
      ' cCCCkCCkCCCc ',
      ' cCCCCCCCCCCc ',
      ' cCCCCCCCCCCc ',
      '  cCCCCCCCCc  ',
      '   kk    kk   ',
      '   BB    BB   '
    ],
    [ // frame 1 — walk stride (feet apart, scarf sway)
      '     kkkk     ',
      '    kCCCCk    ',
      '   kCCCCCCk   ',
      '  kCCCCCCCCk  ',
      ' kGGGGGGGGGGk ',
      '   pppppppp   ',
      '   ppkppkpp   ',
      '   pppppppp   ',
      '   PppppppP   ',
      '  rrCCCCCCrr  ',
      ' cCCCCCCCCCCc ',
      ' cCCCkCCkCCCc ',
      ' cCCCCCCCCCCc ',
      ' cCCCCCCCCCCc ',
      ' cCCCCCCCCCCc ',
      '  kk      kk  ',
      '  BB      BB  '
    ]
  ]));

  /* ================================================================== *
   * BAT  (11x7, wing flap)
   * ================================================================== */
  reg('bat', framed([
    [ // wings up
      'k.k.....k.k',
      'kuk.....kuk',
      'kuukkkkkuuk',
      '.kuUeUeUuk.',
      '..kuUUUuk..',
      '...kuuuk...',
      '....kkk....'
    ],
    [ // wings down
      '...........',
      '.k.......k.',
      'kuk.....kuk',
      '.kuukkkuuk.',
      '..kuUeeUuk.',
      '...kuuuk...',
      '....kkk....'
    ]
  ]));

  /* ================================================================== *
   * BIGBAT  (elite — bigger, fiercer, red eyes)
   * ================================================================== */
  reg('bigbat', framed([
    [
      'uk          ku',
      'uuk        kuu',
      'uukk      kkuu',
      '.uukk    kkuu.',
      '..uukkkkkkuu..',
      '..uuUeUUeUuu..',
      '...kuUUUUuk...',
      '....kuUUuk....',
      '.....kuuk.....'
    ],
    [
      '..............',
      'uk          ku',
      '.ukk      kku.',
      '..ukk    kku..',
      '...ukkkkkku...',
      '..uuUeUUeUuu..',
      '...kuUUUUuk...',
      '....kuUUuk....',
      '.....kuuk.....'
    ]
  ]));

  /* ================================================================== *
   * ZOMBIE  (sickly green, shambling, arms out)
   * ================================================================== */
  reg('zombie', framed([
    [
      '    kkkk    ',
      '   kqqqqk   ',
      '  kqqqqqqk  ',
      '  kqIqqIqk  ',
      '  kqqqqqqk  ',
      '  kQqRRqQk  ',
      '   kqqqqk   ',
      ' kkkGGGGkkk ',
      'kqqkGGGGkqqk',
      'kqqkGrGGkqqk',
      ' .kGGGGGGk. ',
      '  kGGrGGGk  ',
      '  kGGGGGGk  ',
      '  kqq..qqk  ',
      '  kqq..qqk  ',
      '  kBB..BBk  '
    ],
    [
      '    kkkk    ',
      '   kqqqqk   ',
      '  kqqqqqqk  ',
      '  kqIqqIqk  ',
      '  kqqqqqqk  ',
      '  kQqRRqQk  ',
      '   kqqqqk   ',
      ' kkkGGGGkkk ',
      'kqqkGGGGkqqk',
      'kqqkGrGGkqqk',
      ' .kGGGGGGk. ',
      '  kGGrGGGk  ',
      '  kGGGGGGk  ',
      '  kqq..qqk  ',
      '   kq..qk   ',
      '  kBB..BBk  '
    ]
  ]));

  /* ================================================================== *
   * SKELETON  (bone, ribcage, hollow sockets)
   * ================================================================== */
  reg('skeleton', framed([
    [
      '   kkkk   ',
      '  koooook ',
      ' koooooook',
      ' kokkokkok',
      ' koooooook',
      ' kokwwkook',
      '  kooook  ',
      '   kkkk   ',
      '  kooook  ',
      ' kkooookkk',
      'koOooooOoOk',
      'k.koooook.k',
      '  kooook  ',
      '  kokkook ',
      '  koooook ',
      '  ko..ok  ',
      '  kB..Bk  '
    ],
    [
      '   kkkk   ',
      '  koooook ',
      ' koooooook',
      ' kokkokkok',
      ' koooooook',
      ' kokwwkook',
      '  kooook  ',
      '   kkkk   ',
      '  kooook  ',
      'kkkooookkk',
      'koOooooOok',
      'k.koooook.k',
      '  kooook  ',
      '  kokkook ',
      '  koooook ',
      '  ko..ok  ',
      '  kB..Bk  '
    ]
  ]));

  /* ================================================================== *
   * GHOST  (floaty, translucent look via pale palette, wispy tail)
   * ================================================================== */
  reg('ghost', framed([
    [
      '   HHHH   ',
      '  hhhhhh  ',
      ' hhhhhhhh ',
      ' hhkkhhkk ',
      ' hhhhhhhh ',
      ' hHhhhhHh ',
      ' hhhhhhhh ',
      ' hhhhhhhh ',
      ' h.hh.hh. ',
      '  h..h..  '
    ],
    [
      '   HHHH   ',
      '  hhhhhh  ',
      ' hhhhhhhh ',
      ' hhkkhhkk ',
      ' hhhhhhhh ',
      ' hHhhhhHh ',
      ' hhhhhhhh ',
      ' hhhhhhhh ',
      ' .hh.hh.h ',
      '  ..h..h  '
    ]
  ]));

  /* ================================================================== *
   * SLIME  (green blob, squash anim)
   * ================================================================== */
  reg('slime', framed([
    [ // tall
      '  ssssss  ',
      ' sSssssSs ',
      'sSssssssSs',
      'ssskksskss',
      'ssssssssss',
      'sSssssssSs',
      ' sSSSSSSs ',
      '  sSSSSs  '
    ],
    [ // squashed
      '          ',
      ' ssssssss ',
      'sSssssssSs',
      'sskksskkss',
      'sSssssssSs',
      'sSSSSSSSSs',
      ' sSSSSSSs ',
      '          '
    ]
  ]));

  /* ================================================================== *
   * REAPER  (boss ~26x30 — hooded cloak, glowing eyes, scythe)
   * ================================================================== */
  reg('reaper', function () {
    var rows = [
      '.................mm.......',
      '...............mmMM.......',
      '.............mmMMm.b......',
      '...........mmMMm..b......',
      '..........mMMm....b......',
      '.........mMm.....b.......',
      '........mMm......b.......',
      '.....kkkkkkk....b........',
      '...kkcccccckk..b........',
      '..kcccccccccck.b........',
      '..kcccccccccckb.........',
      '.kCCCCCCCCCCCCk.b.......',
      '.kCkkkkkkkkkkCkb........',
      '.kCk.e.kk.e.kCk.........',
      '.kCkkkkkkkkkkCk.........',
      '.kCCCCCCCCCCCCk.........',
      '.kCCCCCCCCCCCCkoo.......',
      'kCCCCCCCCCCCCCCko.......',
      'kCCCCkCCCCkCCCCk........',
      'kCCCCkCCCCkCCCCk........',
      'kCCCCCCCCCCCCCCk........',
      'kCCCCkCCCCkCCCCk........',
      '.kCCCCCCCCCCCCk.........',
      '.kCCCkCCCCkCCCk.........',
      '.kCCCCCCCCCCCCk.........',
      '..kCCkCCkCCkCCk.........',
      '..kCk.kCk.kCk.k........',
      '..kk..kk..kk..k........',
      '.....................',
      '......................'
    ];
    return paint(rows, PAL, 1);
  });

  /* ================================================================== *
   * BOSSES  (large gothic horrors, ~26-32px, anchored at the feet)
   * Each is a periodic mini-boss in the escalating roster. getWhite()
   * auto-handles the hit-flash, so they only need a coloured frame.
   * ================================================================== */

  // GRAVELORD — a hulking horned ghoul lord (giant rotting ogre, belly wound)
  reg('gravelord', function () {
    return paint([
      '......k..........k........',
      '.....kqk........kqk.......',
      '.....kqqk......kqqk.......',
      '......kqkkkkkkkkqk........',
      '.....kkqqqqqqqqqqkk.......',
      '....kqqqqqqqqqqqqqqk......',
      '....kqQqqqqqqqqqqQqk......',
      '....kqeqqqqqqqqqqeqk......',
      '....kqqqqqQQQQqqqqqk......',
      '....kqqqkttttttkqqqk......',
      '...kkqqqqqqqqqqqqqqkk.....',
      '.kkqGqqqqqqqqqqqqqqGqkk...',
      'kqGGGqqqqqqqqqqqqqqGGGqk..',
      'kqqGqqqqqqqQQQQqqqqqGqqk..',
      'kqqkqqqqqqQrrrrQqqqqqkqqk.',
      'kQqkqqqqqqQrRRrQqqqqqkqQk.',
      'kQqkqqqqqqQrrrrQqqqqqkqQk.',
      'kqqkqqqqqqqQQQQqqqqqqkqqk.',
      '.kqkqqqqqqqqqqqqqqqqqkqk..',
      '.kokqqqqqqqqqqqqqqqqqkok..',
      '.kookqqqqqqqqqqqqqqqkook..',
      '.kook.kqqqqqqqqqqqk.kook..',
      '.oo....kqqqqqqqqqk....oo..',
      '.o.....kqqkkkkqqk.....o...',
      '......kqqk....kqqk........',
      '......kqqk....kqqk........',
      '......kQqk....kQqk........',
      '......kook....kook........',
      '.....kkkk......kkkk.......'
    ], PAL, 1);
  });

  // BONELORD — a crowned giant skeleton king (ribcage, bone arms, red sockets)
  reg('bonelord', function () {
    return paint([
      '...y..y..y..y..y.........',
      '...kykykykykyk...........',
      '...kyyyyyyyyyk...........',
      '....kooooooook...........',
      '...koooooooooook.........',
      '..koooooooooooook........',
      '..kookkooookkook.........',
      '..koekookookeook.........',
      '..kooooooooooook.........',
      '..koooottttooook.........',
      '..kkooottttoookk.........',
      '...kkooooooookk..........',
      '....kkkooookkk...........',
      '..kkooo.oo.ooookk........',
      '.koooo.kooook.ooook......',
      'koooo.koOOOOok.ooook.....',
      'koook.koooooook.koook....',
      '.kok.koOoooOook..kok.....',
      '.kok.kooooooook..kok.....',
      '.kok.koOoooOook..kok.....',
      '.kok.kkooooookk..kok.....',
      '.ook..kkooookk...koo.....',
      '.oo....kooook.....oo.....',
      '.......kokkok............',
      '......koo..ook...........',
      '......kok..kok...........',
      '......kok..kok...........',
      '......koo..ook...........',
      '.....koook.koook.........',
      '.....kkkk...kkkk.........'
    ], PAL, 1);
  });

  // DREAD SOVEREIGN — the crowned bat king (huge membranous wings, fangs)
  reg('batking', framed([
    [ // wings up / spread
      '.u..........yyyy..........u.',
      '.uk........kyyyyk........ku.',
      '.uuk......ku.UU.uk......kuu.',
      'uuuuk....kuuUeeUuuk....kuuuu',
      'uUUuuk..kuuUUUUUUuuk..kuuUUu',
      'uUUUuukkkuuUUUUUUuuukkkuuUUu',
      '.uUUUuuuuuuUUUUUUuuuuuuuUUu.',
      '..uUUUuuuuuttttttuuuuuUUUu..',
      '...uUUuuuukttttttkuuuuUUu...',
      '....kuUuuuukttttkuuuuUuk....',
      '......kuUuuuukkkkuuuuUuk....',
      '.......kuuUuuuuuuuuUuuk.....',
      '.........kuuUUUUUUuuk.......',
      '...........kuuUUuuk.........',
      '.............kuuuk..........',
      '..............kuk...........'
    ],
    [ // wings down
      '............yyyy............',
      '.u.........kyyyyk.........u.',
      '.uk.......ku.UU.uk.......ku.',
      '.uuk.....kuuUeeUuuk.....kuu.',
      '..uuk...kuuUUUUUUuuk...kuu..',
      'uuUuuk.kuuUUUUUUUUuuk.kuuUuu',
      'uUUUuukuuuUUUUUUuuuukuuUUUUu',
      '.uUUUuuuuuuttttttuuuuuUUUu..',
      '..uUUuuuuukttttttkuuuuUUu...',
      '...kuUuuuukttttkuuuuUuk.....',
      '.....kuUuuuukkkkuuuuUuk.....',
      '......kuuUuuuuuuuuUuuk......',
      '........kuuUUUUUUuuk........',
      '..........kuuUUuuk.........',
      '............kuuuk..........',
      '.............kuk...........'
    ]
  ]));

  // CRYPT TYRANT — a red-robed mini-reaper with a bare skull and scythe
  reg('crypt_tyrant', function () {
    return paint([
      '.................mm...',
      '...............mmMM...',
      '.............mmMMm.b..',
      '...........mmMMm..b...',
      '..........mMMm...b....',
      '.........mMm....b.....',
      '....rrkkkkkkrr.b......',
      '..rrkCCCCCCCCkrrb.....',
      '.rkCCcccccccccCkr.....',
      '.kCccooooooooocCk.....',
      '.kCcoOoooooooOocCk....',
      '.kCcoe.oooo.eocCk.....',
      '.kCcoooooooooocCk.....',
      '.kCccootttttooccCk....',
      '.kCCCkkkkkkkkCCCk.....',
      'rkCCCCCCCCCCCCCCkr....',
      'kCCCCCkCCCCkCCCCCk....',
      'kCCCCCkCCCCkCCCCCk....',
      'rkCCCCCCCCCCCCCCkr....',
      '.kCCCCkCCCCkCCCCk.....',
      '.kCCCCCCCCCCCCCCk.....',
      '.kCCCkCCCCCCkCCCk.....',
      '.kCCCCCCCCCCCCCCk.....',
      '..kCCkCCCCCCkCCk.....',
      '..kCCCCkCCkCCCCk.....',
      '..kCk.kCk.kCk.k.....',
      '..kk..kk..kk..k.....'
    ], PAL, 1);
  });

  /* ================================================================== *
   * GEMS  (faceted; parametric palette per color)
   * ================================================================== */
  var GEM_ROWS = [
    '..kkkk..',
    '.kawwbk.',
    'kaawwbbk',
    'kaabbbck',
    'kabbbcck',
    '.kbbcck.',
    '..kcck..',
    '...kk...'
  ];
  function buildGem(a, b, c) {
    return paint(GEM_ROWS, { k: PAL.k, w: '#ffffff', a: a, b: b, c: c }, 1);
  }
  reg('gem_blue', function () { return buildGem('#bfe6ff', '#3f8fd8', '#24508c'); });
  reg('gem_green', function () { return buildGem('#bdf08a', '#7bbf4a', '#3f7a28'); });
  reg('gem_red', function () { return buildGem('#ff9a9a', '#d63b46', '#7d1620'); });

  /* ================================================================== *
   * PICKUPS
   * ================================================================== */
  reg('chest', function () {
    return fromRows([
      '  yyyyyyyy  ',
      ' ybBBBBBBby ',
      ' yBlllllllyB',
      ' yBlbbbbblyB',
      'kyyyyyyyyyyk',
      'kbyyYYyyYybk',  // gold band + lock
      'kblbbkkbblbk',
      'kbllbyybllbk',
      'kbllbBBbllbk',
      'kbbbbbbbbbbk',
      ' kkkkkkkkkk '
    ]);
  });

  reg('heart', function () {
    return fromRows([
      '.kk..kk.',
      'kwrkkrrk',
      'krrrrrrk',
      'krrrrrrk',
      '.krrrrk.',
      '..krrk..',
      '...kk...'
    ]);
  });

  reg('magnet', function () {
    return fromRows([
      '.krrrrrrk.',
      'krRRRRRRrk',
      'krRkkkkRrk',
      'krRk..kRrk',
      'krRk..kRrk',
      'krwk..kwrk',
      'kkwk..kwkk',
      '.kk....kk.'
    ]);
  });

  reg('coin', framed([
    [
      '..kkkk..',
      '.kyyyyk.',
      'kyYIIYyk',
      'kyIwwIyk',
      'kyIwwIyk',
      'kyYIIYyk',
      '.kyyyyk.',
      '..kkkk..'
    ],
    [
      '..kk..',
      '..ky..',
      '..kY..',
      '..kY..',
      '..kY..',
      '..kY..',
      '..ky..',
      '..kk..'
    ]
  ]));

  reg('bomb', framed([
    [
      '......I.....',
      '.....i......',
      '....l.......',
      '...l........',
      '..kkkk......',
      '.kGGGGkk....',
      'kGGGGGGGk...',
      'kGgggGGGk...',
      'kGwgggGGk...',
      'kGGGGGGGk...',
      '.kGGGGGk....',
      '..kkkkk.....'
    ],
    [
      '....i.II....',
      '....iIi.....',
      '....l.......',
      '...l........',
      '..kkkk......',
      '.kGGGGkk....',
      'kGGGGGGGk...',
      'kGgggGGGk...',
      'kGwgggGGk...',
      'kGGGGGGGk...',
      '.kGGGGGk....',
      '..kkkkk.....'
    ]
  ]));

  /* ================================================================== *
   * DECOR
   * ================================================================== */
  reg('tombstone', function () {
    return fromRows([
      '  .kkkk.  ',
      ' kkggggkk ',
      'kggggggggk',
      'kgggGGgggk',
      'kggGGGGggk',
      'kgggGGgggk',
      'kggggggggk',
      'kgggkkgggk',  // R . I . P hint
      'kggggggggk',
      'kggggggggk',
      'GggggggggG',
      'kGGGGGGGGk',
      ' BBBBBBBB ',
      ' .BBBBBB. '
    ]);
  });

  reg('cross', function () {
    return fromRows([
      '...kk...',
      '..gGGg..',
      '..gGGg..',
      'kgGGGGgk',
      'gGGGGGGG',
      'kgGGGGgk',
      '..gGGg..',
      '..gGGg..',
      '..gGGg..',
      '..gGGg..',
      '..gGGg..',
      '..gGGg..',
      '..kGGk..',
      '..dddd..'
    ]);
  });

  reg('deadtree', function () {
    return fromRows([
      '..k....k...k..',
      '.kBk..kBk.kBk.',
      'kBBk.kBBkkBBk.',
      '.kBBkkBBBBBk..',
      '..kBBBbBBBk...',
      '...kBbbbBk....',
      '....kbBbk.....',
      '....kBbBk.....',
      '....kbBbk.....',
      '....kBbBk.....',
      '....kbBbk.....',
      '...kBbbbBk....',
      '...kBBbBBk....',
      '..kBBdddBBk...',
      '.kdddddddddk..'
    ]);
  });

  reg('skull', function () {
    return fromRows([
      '.kkkk.',
      'koooook',
      'koooook',
      'kokkokk',
      'koooook',
      'kowwook',
      '.koook.',
      '.kkkk.'
    ]);
  });

  /* ================================================================== *
   * BIOME DECOR — gothic props for the 6 biomes. All painted with BPAL,
   * authored as upright sprites (callers draw anchor:'bottom'). Single-
   * frame ones via decor(); flame-flicker ones (brazier/lantern_post/
   * bonfire) via decorF([frame0, frame1]). getWhite() works on every one.
   * ================================================================== */
  function decor(rows) { return function () { return paint(rows, BPAL, 1); }; }
  function decorF(frames) { return function (frame) { return paint(frames[frame] || frames[0], BPAL, 1); }; }

  /* ---- SWAMP ---- */
  reg('reed', decor([
    '.....6.....',
    '....6.6....',
    '....6.6....',
    '...6..6....',
    '...6..6.6..',
    '...6.b6.6..',
    '..6.bB6.6..',
    '..6.bB6.6..',
    '..6.bb6.6..',
    '..6..6..6..',
    '..6..6..6..',
    '.26..6..62.',
    '.26..6.662.',
    '.12..6.621.',
    '.12.26.621.',
    '.122632211.',
    '..1122211..',
    '...11211...'
  ]));

  reg('lilypad', decor([
    '....333.....',
    '..3322233...',
    '.332222233..',
    '.32222r2223.',
    '.322222.223.',
    '.3222222.3..',
    '..33222223..',
    '...333333...'
  ]));

  reg('mushroom', decor([
    '..77777..',
    '.7777777.',
    '7t7777t7.',
    '77t77777.',
    '7777t7t7.',
    '.8888888.',
    '...ppp...',
    '...pPp...',
    '...ppp...',
    '...pPp...',
    '..ppppp..',
    '..kPPPk..'
  ]));

  reg('mushroom_blue', decor([
    '..99999..',
    '.9909099.',
    '9A9999A9.',
    '990999X9.',
    '9999A999.',
    '.XXXXXXX.',
    '...ppp...',
    '...pPp...',
    '...ppp...',
    '...pPp...',
    '..ppppp..',
    '..kPPPk..'
  ]));

  reg('swamp_log', decor([
    '.kkkkkkkkkkkk..',
    'k3333222222b3k.',
    'kB22b22222b22Bk',
    'kB2bB222b222bBk',
    'kB2222222222bBk',
    'kB22b2222b222Bk',
    '.kBBBBBBBBBBBk.',
    '..kkkkkkkkkkk..'
  ]));

  /* ---- ASH ---- */
  reg('charred_stump', decor([
    '.kkk..kkk..',
    'kEEEkkEEEk.',
    'kEDEkEDEk..',
    '.kEEDEEEk..',
    '..kEEEEEk..',
    '..kEDEDEk..',
    '..kEEEEEk..',
    '..kEDEDEk..',
    '..jEEEEEj..',
    '..jEJiJEj..',
    '..kDDDDDk..',
    '...kkkkk...'
  ]));

  reg('brazier', decorF([
    [ // flame tall
      '....J....',
      '...JiJ...',
      '..JiIiJ..',
      '..JirIJ..',
      '...JiJ...',
      '....J....',
      'mmmmmmmmm',
      'mMgIiIgMm',
      'mMMMMMMMm',
      '.M.....M.',
      '.M.....M.',
      '.k.....k.',
      'kkk...kkk'
    ],
    [ // flame leaning
      '...J.....',
      '..JiJ....',
      '..JiIJ...',
      '.JirIiJ..',
      '..JiIJ...',
      '...iJ....',
      'mmmmmmmmm',
      'mMgiIigMm',
      'mMMMMMMMm',
      '.M.....M.',
      '.M.....M.',
      '.k.....k.',
      'kkk...kkk'
    ]
  ]));

  reg('ember_rock', decor([
    '...kkkk.....',
    '..kEEEEk....',
    '.kEEDEEEk...',
    'kEEJEDEEk...',
    'kEDEEJEDEk..',
    'kEEEJEEEEk..',
    '.kEDEEDEk...',
    '..kEEEEk....',
    '...kkkk.....'
  ]));

  reg('obelisk', decor([
    '...kkk...',
    '..kuGuk..',
    '..kGGGk..',
    '..gGGGg..',
    '.kgGGGgk.',
    '.gGGuGGg.',
    '.gGGGGGg.',
    '.gGuGuGg.',
    '.gGGGGGg.',
    '.gGGuGGg.',
    '.gGGGGGg.',
    '.gGuGuGg.',
    '.gGGGGGg.',
    '.gGGuGGg.',
    '.gGGGGGg.',
    '.gGGGGGg.',
    'kgGGGGGgk',
    'kGGGGGGGk',
    'kgGGGGGgk',
    'kkkkkkkkk'
  ]));

  /* ---- BONE ---- */
  reg('bone_pile', decor([
    '.....kk.......',
    '....koook.....',
    '...koOook.kk..',
    '...kokkok.ooo.',
    '..k.koook.ook.',
    '.ooo..oo.ooo..',
    'oTooTooooTooo.',
    'TooTooTooooToo',
    '.TTTTTTTTTTTT.'
  ]));

  reg('ribcage', decor([
    '......O......',
    '.....oOo.....',
    '...oo.O.oo...',
    '..o..oOo..o..',
    '.o..o.O.o..o.',
    '.o.o..O..o.o.',
    '.o.o..O..o.o.',
    '.o..o.O.o..o.',
    '..o..oOo..o..',
    '...TT.O.TT...',
    '.....TTT.....'
  ]));

  reg('bone_spike', decor([
    '..o....',
    '..oo...',
    '.toO...',
    '.ooO...',
    '.toO...',
    '.ooO...',
    '.toO...',
    '.ooOk..',
    'kooOOk.',
    'koOOOk.',
    'kTTTTk.',
    '.kkkk..'
  ]));

  /* ---- BLOOD ---- */
  reg('thorn_bush', decor([
    '.k..k...k...',
    'kBkkBk.kBk..',
    '.bBbbBb.Bk..',
    'kBbVVbBbBbk.',
    '.bBVZVbVZbk.',
    'kBbVVbVVbBk.',
    '.bBbVbVbBb..',
    'kBbBbVbBbBk.',
    '.kBBbVbBBk..',
    '..kkBBBkk...'
  ]));

  reg('blood_pool', decor([
    '...VWWWWV....',
    '..VWrrrrWV...',
    '.VWrrZrrrWV..',
    'VWrrrrrrZrWV.',
    '.VWrrrZrrWV..',
    '..VWrrrrWV...',
    '...VWWWWV....'
  ]));

  reg('dead_red_grass', decor([
    '.Z..Z..Z...',
    '.Z.WZ.WZ.W.',
    'WZ.WZ.WZ.WZ',
    'WZWWZWWZWWZ',
    'ZWWZWWZWWZW',
    '.WWZWWZWWZ.',
    '..VWWVWWV..',
    '...VVVVV...'
  ]));

  reg('hanged_cage', decor([
    'kkkkkkkkk....',
    'kbbbbbbbk....',
    '....mk.......',
    '....km.......',
    '....mk.......',
    '..mmmmmmm....',
    '.m.......m...',
    'm.koook..m...',
    'm.kokok..m...',
    'm.koook..m...',
    'm..ooo...m...',
    'm.o.o.o..m...',
    'm.ooooo..m...',
    'm..ooo...m...',
    'm.o.o.o..m...',
    '.m.....m.....',
    '.mmmmmmm.....',
    '..mm.mm......',
    '...mkm.......'
  ]));

  /* ---- FROST ---- */
  reg('ice_shard', decor([
    '...A.....',
    '..AaA....',
    '..AaaA...',
    '.AaaaA...',
    '.AahaA...',
    '.AahaA...',
    '.aahaaA..',
    '.aahaaA..',
    'aaahaaaA.',
    'aahhhaaA.',
    'aahHhaaA.',
    '.ahHha...',
    '.aHHHa...',
    '..aHHa...'
  ]));

  reg('frozen_grave', decor([
    '..aakkaa...',
    '.aakggkaa..',
    'aakgggggkaa',
    'akgggGGgkAa',
    'akggGGGGgka',
    'akgaGGGagka',
    'akgggGGgkAa',
    'akgggkkggka',
    'akgggGGggka',
    'akAgggggAka',
    'aakgggggkaa',
    '.akGGGGGka.',
    '.aakkkkkaa.',
    '..AAAAAA...',
    '...AAAA....'
  ]));

  reg('snow_mound', decor([
    '....wwww....',
    '..wwAAAAww..',
    '.wAAAAAAAAw.',
    'wAAwAAAAwAAw',
    'wAAAAAAAAAAw',
    '.aAAAAAAAAa.',
    '..aaaaaaaa..'
  ]));

  reg('icicle_rock', decor([
    '..kkkkkk....',
    '.kggGGggk...',
    'kgGGggGGgk..',
    'kgGgggggGk..',
    'kGggGGgggk..',
    'kgGggggGgk..',
    '.kgGGggGk...',
    '.kAkAkAkA...',
    '..A.A.A.a...',
    '..A.A.a.....',
    '..a...a.....',
    '..a.........'
  ]));

  /* ---- SHARED GOTHIC LANDMARKS (used across biomes) ---- */
  reg('statue', decor([
    '......kkkk......',
    '.....kgggk......',
    '.....gGGgg......',
    '.....gGGGg......',
    '.kk..gGGGg..kk..',
    'kggk.kgggk.kggk.',
    'kgGgkgGGGgkgGgk.',
    'kgGGgGGGGgGGgk..',
    '.kgGGGGGGGGgk...',
    '.gGGgGGGGgGGg...',
    '.gGGGGGGGGGGg...',
    '..gGGGGGGGGg....',
    '..gGGGGGGGGg....',
    '..gGG3GGGGGg....',
    '..gGGGGG3GGg....',
    '..gGGGGGGGGg....',
    '..gGGgGGgGGg....',
    '..gGGGGGGGGg....',
    '..gGG3GGGGGg....',
    '.kgGGGGGGGGgk...',
    '.gGGGGGGGGGGg...',
    'kGGGGGGGGGGGGk..',
    'kgGGGGGGGGGGgk..',
    'kkkkkkkkkkkkk...'
  ]));

  reg('mausoleum', decor([
    '.......kk.........',
    '......kGGk........',
    '..kkkkkkkkkkkk....',
    '.kGGGGGGGGGGGGk...',
    'kGGGGGGGGGGGGGGk..',
    'kgGGGGGGGGGGGGgk..',
    'kgGggggggggggGgk..',
    'kgGgGGGGGGGGgGgk..',
    'kgGgGkkkkkGGgGgk..',
    'kgGgGkccckGGgGgk..',
    'kgGgGkcuckGGgGgk..',
    'kgGgGkcuckGGgGgk..',
    'kgGgGkccckGGgGgk..',
    'kgGggkcccgGGgGgk..',
    'kGGGGkcccGGGGGGk..',
    'kGGGGkcccGGGGGGk..',
    'kGGGGGGGGGGGGGGk..',
    'kkkkkkkkkkkkkkkk..'
  ]));

  reg('stone_pillar', decor([
    '..g..gg...',
    '.kggkggk..',
    '.gGgGgGg..',
    '.gGgGgGg..',
    '.gGgGgGg..',
    '.gGgGgGg..',
    '.gGgGgGg..',
    '.gGgGgGg..',
    '.gGgGgGg..',
    '.gGgGgGg..',
    '.gGgGgGg..',
    '.gGgGgGg..',
    'kgGgGgGgk.',
    'kgggggggk.',
    'kGGGGGGGk.',
    'kgGGGGGgk.',
    'kkkkkkkkk.'
  ]));

  reg('lantern_post', decorF([
    [
      '..mmmm...',
      '..mIImk..',
      '.kmmmmk..',
      '.mIyyIm..',
      '.mIyiIm..',
      '.mIyyIm..',
      '.mIyyIm..',
      '.kmmmmk..',
      '...mm....',
      '...mm....',
      '...mm....',
      '...mm....',
      '...mm....',
      '...mm....',
      '...mm....',
      '..kmmk...',
      '.kMMMMk..',
      '.kkkkkk..'
    ],
    [
      '..mmmm...',
      '..mIImk..',
      '.kmmmmk..',
      '.mIyyIm..',
      '.mIiyIm..',
      '.mIyyIm..',
      '.mIyyIm..',
      '.kmmmmk..',
      '...mm....',
      '...mm....',
      '...mm....',
      '...mm....',
      '...mm....',
      '...mm....',
      '...mm....',
      '..kmmk...',
      '.kMMMMk..',
      '.kkkkkk..'
    ]
  ]));

  reg('bonfire', decorF([
    [
      '.....J......',
      '....JiJ.....',
      '...JiIiJ....',
      '..JiIyIiJ...',
      '..JirIyiJ...',
      '.JiIyIyIiJ..',
      '.JirIyrIiJ..',
      '..JiIyIiJ...',
      '..bBJiJBb...',
      '.bBBbiBBBb..',
      'bBbBBBBBbBb.',
      '.bBBBBBBBb..',
      '..kkkkkkk...'
    ],
    [
      '....J.......',
      '...JiJ......',
      '..JiIiJ.....',
      '..JiIyIJ....',
      '.JiIyIiJ....',
      '.JiyIyIiJ...',
      '.JiIyrIiJ...',
      '..JiyIiJ....',
      '..bBiJiBb...',
      '.bBBbIBBBb..',
      'bBbBBBBBbBb.',
      '.bBBBBBBBb..',
      '..kkkkkkk...'
    ]
  ]));

  /* ================================================================== *
   * PROJECTILES
   * ================================================================== */
  reg('proj_knife', function () {
    return fromRows([
      '    kkkkkm',
      'kbboommmmM',
      'kbboommmmM',
      '    kkkkkm'
    ]);
  });

  reg('proj_bone', function () {
    return fromRows([
      'oo......oo',
      'koo....ook',
      '.koooooook',
      '.koooooook',
      'koo....ook',
      'oo......oo'
    ]);
  });

  reg('proj_bible', function () {
    return fromRows([
      '.uuuuuuuu.',
      'uUyyyyyyUu',
      'uUuuuuuuUu',
      'uUuwwwwuUu',
      'uUuwkwwuUu',
      'uUuwwwwuUu',
      'uUuuuuuuUu',
      'uUyyyyyyUu',
      '.uuuuuuuu.'
    ]);
  });

  reg('proj_fire', framed([
    [
      '....I.....',
      '...iIi....',
      '..iiIii...',
      '..irIii...',
      '.iirIiii..',
      '.irrIrii..',
      'iirrrrrii.',
      '.irrRrri..',
      '..iRRRi...',
      '...rrr....'
    ],
    [
      '...I......',
      '..iIi.....',
      '..iIii....',
      '.iirIii...',
      '.irIrii...',
      'iirrIrii..',
      'iirrrrri..',
      '.irrRri...',
      '..iRRi....',
      '...rr.....'
    ]
  ]));

  reg('proj_bolt', function () {
    return fromRows([
      '   zz   ',
      '   zw   ',
      '  zzw   ',
      '  zw    ',
      ' zzw    ',
      ' zw     ',
      'zzwzz   ',
      '  zzw   ',
      '   zw   ',
      '   zzw  ',
      '    zw  ',
      '    zzw ',
      '     zw ',
      '     zz '
    ]);
  });

  reg('proj_orb', framed([
    [
      '   xxxx   ',
      '  xXwwXx  ',
      ' xXwwwwXx ',
      ' xwwhhwwx ',
      'xXwhhhhwXx',
      'xXwhhhhwXx',
      ' xwwhhwwx ',
      ' xXwwwwXx ',
      '  xXwwXx  ',
      '   xxxx   '
    ],
    [
      '          ',
      '   xxxx   ',
      '  xXwwXx  ',
      ' xwwhhwwx ',
      ' xwhhhhwx ',
      ' xwhhhhwx ',
      ' xwwhhwwx ',
      '  xXwwXx  ',
      '   xxxx   ',
      '          '
    ]
  ]));

  reg('proj_hammer', function () {
    return fromRows([
      ' mmmmmmmmmm ',
      'mMMMMMMMMMMm',
      'mMggggggggMm',
      'mMgwwggwwgMm',
      'mMggggggggMm',
      'mMMMMMMMMMMm',
      ' mmmmmmmmmm ',
      '    kbbk    ',
      '    kllk    ',
      '    kbbk    ',
      '    kllk    ',
      '    kbbk    ',
      '    kllk    ',
      '    kbbk    ',
      '    kBBk    '
    ]);
  });

  reg('whip_slash', function () {
    return fromRows([
      '         woo    ',
      '       wooooo   ',
      '     wooo  roo  ',
      '    woo     roo ',
      '   woo       ro ',
      '   wo        ro ',
      '   wo       roo ',
      '   woo     roo  ',
      '    wooo  roo   ',
      '     woooooo    ',
      '      wooo      '
    ]);
  });

  // GARLIC AURA — soft translucent ring (~40x40), drawn with canvas ops.
  reg('aura_garlic', function () {
    var S = 40, c = makeCanvas(S, S), ctx = c.getContext('2d');
    var cx = S / 2, cy = S / 2;
    var grad = ctx.createRadialGradient(cx, cy, 3, cx, cy, 19);
    grad.addColorStop(0, 'rgba(120,190,255,0.05)');
    grad.addColorStop(0.65, 'rgba(140,205,255,0.10)');
    grad.addColorStop(0.92, 'rgba(170,220,255,0.18)');
    grad.addColorStop(1, 'rgba(170,220,255,0)');
    ctx.fillStyle = grad;
    ctx.beginPath(); ctx.arc(cx, cy, 19, 0, Math.PI * 2); ctx.fill();
    for (var i = 0; i < 3; i++) {
      ctx.beginPath();
      ctx.strokeStyle = 'rgba(190,230,255,' + (0.10 + i * 0.05) + ')';
      ctx.lineWidth = 4 - i * 1.1;
      ctx.arc(cx, cy, 16 - i, 0, Math.PI * 2);
      ctx.stroke();
    }
    return c;
  });

  /* ================================================================== *
   * ICON compose sources (small art reused by Sprites.icon)
   * ================================================================== */
  reg('icon_garlic_bulb', function () {
    return fromRows([
      '....s.....',
      '...sSs....',
      '....o.....',
      '...ooo....',
      '..ooooo...',
      '.ooooooo..',
      '.oOooOoo..',
      '.ooooooo..',
      '..oOoOo...',
      '...ooo....'
    ]);
  });

  reg('icon_vial', function () {
    return fromRows([
      '...bb....',
      '...bb....',
      '..hooh...',
      '.hooooh..',
      '.hxxxxh..',
      '.hxxxxh..',
      '.hxXXxh..',
      '.hxxxxh..',
      '.hooooh..',
      '..hhhh...'
    ]);
  });

  /* ================================================================== *
   * Passive icons — authored ~12x12 glyphs, framed by glyphIcon()
   * ================================================================== */
  var PASSIVE_GLYPHS = {
    icon_spinach: [
      '....s.......',
      '...sSs......',
      '..sSsSs.....',
      '.sSsssSs....',
      'sSssssssS...',
      '.sSsssSsS...',
      '..sSsSsS....',
      '...sSsS.....',
      '....SS......',
      '....S.......'
    ],
    icon_armor: [
      '.mmmmmmm.',
      'mMMMMMMMm',
      'mMmmmmmMm',
      'mMmwwwmMm',
      'mMmmwmmMm',
      'mMmwwwmMm',
      '.mMMMMMm.',
      '..mMMMm..',
      '...mMm...',
      '....m....'
    ],
    icon_wings: [
      '......h.',
      '....hhh.',
      '..hhhhh.',
      '.hhhwhh.',
      'hhhwhhh.',
      '.hhhhh..',
      '..hhh...',
      '...h....'
    ],
    icon_emptytome: [
      '.gggggggg.',
      'gGgggggGGg',
      'gGgwwwwgGg',
      'gGgggggGGg',
      'gGgwwwwgGg',
      'gGgggggGGg',
      'gGgwwwwgGg',
      'gGGGGGGGGg',
      '.gggggggg.'
    ],
    icon_candelabrador: [
      '....i.....',
      '...III....',
      '....I.....',
      '....k.....',
      '...oooo...',
      '...oOOo...',
      '...oOOo...',
      '...oOOo...',
      '..bbbbbb..',
      '...bBBb...'
    ],
    icon_duplicator: [
      '.wwww...',
      '.w..w...',
      '.w..wwww',
      '.wwwwIIw',
      '....wIIw',
      '....wwww'
    ],
    icon_bracer: [
      '....z....',
      '...zzz...',
      '..zzzzz..',
      '.zz.z.zz.',
      '....z....',
      '...zzz...',
      '..zzzzz..',
      '....z....'
    ],
    icon_spellbinder: [
      'oooooooo',
      '.kwwwwk.',
      '..kwwk..',
      '...yy...',
      '...yy...',
      '..kyyk..',
      '.kyyyyk.',
      'oooooooo'
    ],
    icon_crown: [
      '.y...y...y.',
      '.yy.yy.yy..',
      '.yyyyyyyy..',
      '.yeyyhyyey.',
      '.yyyyyyyy..',
      '.YYYYYYYY..'
    ],
    icon_clover: [
      '..ss..ss..',
      '.sSss.ssS.',
      '.sssssssS.',
      '..ssSSss..',
      '.sssssssS.',
      '.sSss.ssS.',
      '..ss..ss..',
      '....SS....',
      '....S.....'
    ],
    icon_pummarola: [
      '...s.s....',
      '..sSsSs...',
      '.rrrrrr...',
      'rrwrrrrr..',
      'rrrrrrrr..',
      'rrrrrrrr..',
      '.rRRRRr...',
      '..rrrr....'
    ],
    icon_tiragisu: [
      '..yyyy....',
      '.y....y...',
      '..wwww....',
      '.wwwwww...',
      'wwwwwww...',
      '.wwwww....',
      '..www.....',
      '...w......'
    ],
    icon_stonemask: [
      '.kyyyyk.',
      'kyyyyyyk',
      'kykyykyk',
      'kyyyyyyk',
      'kyyrryyk',
      'kyyyyyyk',
      '.kyyyyk.',
      '..kyyk..'
    ]
  };

  /* ================================================================== *
   * Icon framing / composition
   * ================================================================== */
  function frameBox(ctx, w, h, border, inner) {
    ctx.fillStyle = inner; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = border;
    ctx.fillRect(0, 0, w, 1); ctx.fillRect(0, h - 1, w, 1);
    ctx.fillRect(0, 0, 1, h); ctx.fillRect(w - 1, 0, 1, h);
    // soft inner corner darkening for a beveled feel
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.fillRect(1, h - 2, w - 2, 1);
    ctx.fillRect(w - 2, 1, 1, h - 2);
  }

  // Center a source canvas into a framed 16x16 icon (upscales small art a touch).
  function composeIcon(src, evolved) {
    var c = makeCanvas(16, 16), ctx = c.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    frameBox(ctx, 16, 16,
      evolved ? PAL.y : PAL.G,
      evolved ? '#2e2440' : '#221d2e');
    var maxd = 13;
    var s = Math.min(maxd / src.width, maxd / src.height);
    if (s > 2) s = 2;
    var dw = Math.max(1, Math.round(src.width * s));
    var dh = Math.max(1, Math.round(src.height * s));
    ctx.drawImage(src, Math.floor((16 - dw) / 2), Math.floor((16 - dh) / 2), dw, dh);
    if (evolved) {
      ctx.fillStyle = PAL.I;
      ctx.fillRect(2, 2, 1, 1); ctx.fillRect(13, 13, 1, 1);
    }
    return c;
  }

  function glyphIcon(rows, evolved) {
    return composeIcon(paint(rows, PAL, 1), !!evolved);
  }

  function fallbackIcon(name) {
    var c = makeCanvas(16, 16), ctx = c.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    var hsh = 0, i;
    for (i = 0; i < name.length; i++) hsh = (hsh * 31 + name.charCodeAt(i)) >>> 0;
    var hue = hsh % 360;
    frameBox(ctx, 16, 16, PAL.g, 'hsl(' + hue + ',32%,26%)');
    var label = name.replace(/^icon_/, '').slice(0, 2).toUpperCase();
    ctx.fillStyle = '#000';
    ctx.font = '700 9px "Courier New", monospace';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(label, 9, 10);
    ctx.fillStyle = '#fff';
    ctx.fillText(label, 8, 9);
    return c;
  }

  // Weapon/evolution icons that compose from existing art: name -> {art, evo}
  var ICON_SRC = {
    icon_whip:           { art: 'whip_slash',       evo: false },
    icon_bloodywhip:     { art: 'whip_slash',       evo: true  },
    icon_wand:           { art: 'proj_orb',         evo: false },
    icon_holywand:       { art: 'proj_orb',         evo: true  },
    icon_knife:          { art: 'proj_knife',       evo: false },
    icon_thousandknives: { art: 'proj_knife',       evo: true  },
    icon_bible:          { art: 'proj_bible',       evo: false },
    icon_unholyvespers:  { art: 'proj_bible',       evo: true  },
    icon_garlic:         { art: 'icon_garlic_bulb', evo: false },
    icon_souleater:      { art: 'skull',            evo: true  },
    icon_fireball:       { art: 'proj_fire',        evo: false },
    icon_hellfire:       { art: 'proj_fire',        evo: true  },
    icon_santawater:     { art: 'icon_vial',        evo: false },
    icon_lightning:      { art: 'proj_bolt',        evo: false },
    icon_thunderloop:    { art: 'proj_bolt',        evo: true  },
    icon_hammer:         { art: 'proj_hammer',      evo: false },
    icon_megabonk:       { art: 'proj_hammer',      evo: true  },
    // passives that reuse pickup art
    icon_attractorb:     { art: 'magnet',           evo: false },
    icon_hollowheart:    { art: 'heart',            evo: false }
  };

  // Register passive glyph icons as direct icon builders (already framed 16x16).
  (function registerPassiveIcons() {
    Object.keys(PASSIVE_GLYPHS).forEach(function (name) {
      var rows = PASSIVE_GLYPHS[name];
      reg(name, function () { return glyphIcon(rows, false); });
    });
  })();

  function icon(name) {
    if (!name) name = '?';
    var cached = iconCache[name];
    if (cached) return cached;
    var out;
    try {
      if (builders[name]) {
        out = get(name);
        // ensure 16x16 framed result for anything that isn't already
        if (out.width !== 16 || out.height !== 16) out = composeIcon(out, false);
      } else if (ICON_SRC[name]) {
        var spec = ICON_SRC[name];
        out = composeIcon(get(spec.art), spec.evo);
      } else {
        out = fallbackIcon(name);
      }
    } catch (err) {
      out = fallbackIcon(name);
    }
    iconCache[name] = out;
    return out;
  }

  /* ================================================================== *
   * GROUND TILES — seamless ~32x32 tiles for all 6 biomes, 2-3 noise
   * variants each. Cached by (biome,variant). Base is per-pixel noise
   * (inherently seamless); features wrap with pset() so nothing cuts at
   * the tile edge. groundTile() with no/unknown args => graveyard v0
   * (backward compat for main.js).
   * ================================================================== */

  // Per-biome ground configs: weighted base colors + scatter specks + flags.
  var GROUND = {
    graveyard: {
      bases: ['#221d2b', '#241f2d', '#26212f', '#201b29'],
      specks: [['#33402c', 24], ['#3c4a30', 9], ['#191522', 16], ['#2f2d3c', 8], ['#15111d', 6]]
    },
    swamp: {
      bases: ['#1c2f26', '#21392e', '#1a2b23', '#243f31'],
      specks: [['#2f5d4a', 20], ['#3a7d5a', 10], ['#152019', 16], ['#46734a', 8], ['#0f1814', 8]],
      water: true
    },
    ash: {
      bases: ['#242025', '#1c1a1e', '#2a262b', '#201d22'],
      specks: [['#3a3438', 18], ['#4f4a50', 8], ['#0d0b0e', 16], ['#5a3028', 6], ['#ff7a30', 4]],
      cracks: ['#0d0b0e', '#ff7a30']
    },
    bone: {
      bases: ['#c9c2ab', '#d2cbb4', '#beb79f', '#d8d2bc'],
      specks: [['#b8b09a', 20], ['#8c856f', 12], ['#e6e0cc', 10], ['#9a9078', 8], ['#6f6a58', 5]],
      bones: true
    },
    blood: {
      bases: ['#2a1018', '#33141c', '#241016', '#2e1218'],
      specks: [['#5a1820', 18], ['#7d1620', 9], ['#160a0e', 16], ['#3a0e14', 10], ['#8a2028', 5]],
      pools: true
    },
    frost: {
      bases: ['#cfe0ec', '#d8e6f2', '#c3d6e4', '#dfeaf4'],
      specks: [['#9fc7e8', 18], ['#b3d4ee', 10], ['#aebfcd', 12], ['#ffffff', 8], ['#7fa6c4', 6]],
      cracks: ['#eef6ff', '#9fc7e8']
    }
  };

  // Wrapping single-pixel plot (keeps every feature seamless across edges).
  function pset(ctx, S, x, y, col) {
    x = ((x % S) + S) % S; y = ((y % S) + S) % S;
    ctx.fillStyle = col; ctx.fillRect(x, y, 1, 1);
  }
  function blob(ctx, S, cx, cy, rad, fill, edge) {
    var a, b, d, rr = rad * rad, ri = (rad - 1) * (rad - 1);
    for (a = -rad; a <= rad; a++) for (b = -rad; b <= rad; b++) {
      d = a * a + b * b; if (d > rr) continue;
      pset(ctx, S, cx + a, cy + b, d > ri ? edge : fill);
    }
  }
  function gWater(ctx, S, n) {
    for (var i = 0; i < n; i++) {
      var cx = (Math.random() * S) | 0, cy = (Math.random() * S) | 0, rad = 3 + ((Math.random() * 3) | 0);
      blob(ctx, S, cx, cy, rad, '#234c47', '#1a3833');
      pset(ctx, S, cx - 1, cy - 1, '#3a6d63'); pset(ctx, S, cx + 1, cy, '#34635a');
    }
  }
  function gPools(ctx, S, n) {
    for (var i = 0; i < n; i++) {
      var cx = (Math.random() * S) | 0, cy = (Math.random() * S) | 0, rad = 3 + ((Math.random() * 3) | 0);
      blob(ctx, S, cx, cy, rad, '#4a141c', '#2a0c12');
      pset(ctx, S, cx, cy, '#7d1620'); pset(ctx, S, cx + 1, cy - 1, '#9a2028');
    }
  }
  function gBones(ctx, S, n) {
    for (var i = 0; i < n; i++) {
      var x = (Math.random() * S) | 0, y = (Math.random() * S) | 0;
      pset(ctx, S, x, y + 1, '#6f6a58');
      if (Math.random() < 0.5) {
        pset(ctx, S, x, y, '#e6e0cc'); pset(ctx, S, x + 1, y, '#d8d2bc');
        pset(ctx, S, x + 2, y, '#e6e0cc'); pset(ctx, S, x + 3, y + 1, '#6f6a58');
      } else {
        pset(ctx, S, x, y, '#e6e0cc'); pset(ctx, S, x, y + 1, '#d8d2bc'); pset(ctx, S, x, y + 2, '#e6e0cc');
      }
    }
  }
  function gCracks(ctx, S, n, dark, glow) {
    for (var i = 0; i < n; i++) {
      var x = (Math.random() * S) | 0, y = (Math.random() * S) | 0;
      var dx = Math.random() < 0.5 ? 1 : -1, len = 6 + ((Math.random() * 8) | 0), s;
      for (s = 0; s < len; s++) {
        pset(ctx, S, x, y, dark);
        if (Math.random() < 0.18) pset(ctx, S, x, y, glow);
        x += dx; if (Math.random() < 0.4) y += (Math.random() < 0.5 ? 1 : -1);
        if (Math.random() < 0.25) dx = -dx;
      }
    }
  }

  function buildGroundBiome(biome, variant) {
    var cfg = GROUND[biome] || GROUND.graveyard;
    var S = 32, c = makeCanvas(S, S), ctx = c.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    var bases = cfg.bases, x, y, r, i, j;
    for (y = 0; y < S; y++) for (x = 0; x < S; x++) {
      r = Math.random();
      ctx.fillStyle = r < 0.45 ? bases[0] : (r < 0.74 ? bases[1] : (r < 0.9 ? bases[2] : bases[3]));
      ctx.fillRect(x, y, 1, 1);
    }
    var sp = cfg.specks, vMul = 1 + variant * 0.12;
    for (i = 0; i < sp.length; i++) {
      ctx.fillStyle = sp[i][0];
      var n = (sp[i][1] * vMul) | 0;
      for (j = 0; j < n; j++) {
        var px = (Math.random() * S) | 0, py = (Math.random() * S) | 0;
        ctx.fillRect(px, py, 1, 1);
        if (Math.random() < 0.25) ctx.fillRect((px + 1) % S, py, 1, 1);
      }
    }
    if (cfg.water) gWater(ctx, S, 2 + (variant % 2));
    if (cfg.pools) gPools(ctx, S, 2 + (variant % 2));
    if (cfg.bones) gBones(ctx, S, 3 + variant);
    if (cfg.cracks) gCracks(ctx, S, 3, cfg.cracks[0], cfg.cracks[1]);
    return c;
  }

  var groundCache = Object.create(null);   // (biome+variant) -> canvas
  function groundTile(biome, variant) {
    if (!biome || !GROUND[biome]) biome = 'graveyard';
    variant = variant ? (variant | 0) : 0;
    if (variant < 0) variant = 0;
    var key = biome + variant;
    var hit = groundCache[key];
    if (hit) return hit;
    var c = buildGroundBiome(biome, variant);
    groundCache[key] = c;
    return c;
  }

  /* ================================================================== *
   * PRELOAD — build & cache everything once
   * ================================================================== */
  var FRAME_COUNTS = {
    hero: 2, bat: 2, bigbat: 2, zombie: 2, skeleton: 2, ghost: 2, slime: 2, reaper: 1,
    gravelord: 1, bonelord: 1, batking: 2, crypt_tyrant: 1,
    gem_blue: 1, gem_green: 1, gem_red: 1,
    chest: 1, heart: 1, magnet: 1, coin: 2, bomb: 2,
    tombstone: 1, cross: 1, deadtree: 1, skull: 1,
    proj_knife: 1, proj_bone: 1, proj_bible: 1, proj_fire: 2, proj_bolt: 1,
    aura_garlic: 1, whip_slash: 1, proj_orb: 2, proj_hammer: 1,
    icon_garlic_bulb: 1, icon_vial: 1
  };

  var WHITE_SET = ['hero', 'bat', 'bigbat', 'zombie', 'skeleton', 'ghost', 'slime', 'reaper',
    'gravelord', 'bonelord', 'batking', 'crypt_tyrant'];

  // Biome decor (single + flame-flicker frames). Built in preload; getWhite lazy.
  var DECOR_NAMES = [
    'reed', 'lilypad', 'mushroom', 'mushroom_blue', 'swamp_log',
    'charred_stump', 'brazier', 'ember_rock', 'obelisk',
    'bone_pile', 'ribcage', 'bone_spike',
    'thorn_bush', 'blood_pool', 'dead_red_grass', 'hanged_cage',
    'ice_shard', 'frozen_grave', 'snow_mound', 'icicle_rock',
    'statue', 'mausoleum', 'stone_pillar', 'lantern_post', 'bonfire'
  ];
  var DECOR_FRAMES = { brazier: 2, lantern_post: 2, bonfire: 2 };
  var BIOME_KEYS = ['graveyard', 'swamp', 'ash', 'bone', 'blood', 'frost'];

  var ALL_ICON_NAMES = [
    'icon_whip', 'icon_wand', 'icon_knife', 'icon_bible', 'icon_garlic',
    'icon_fireball', 'icon_santawater', 'icon_lightning', 'icon_hammer',
    'icon_bloodywhip', 'icon_holywand', 'icon_thousandknives', 'icon_unholyvespers',
    'icon_souleater', 'icon_hellfire', 'icon_thunderloop', 'icon_megabonk',
    'icon_spinach', 'icon_armor', 'icon_wings', 'icon_emptytome', 'icon_candelabrador',
    'icon_duplicator', 'icon_bracer', 'icon_spellbinder', 'icon_attractorb',
    'icon_crown', 'icon_clover', 'icon_hollowheart', 'icon_pummarola',
    'icon_tiragisu', 'icon_stonemask'
  ];

  function preload() {
    var name, frame, n;
    for (name in FRAME_COUNTS) {
      n = FRAME_COUNTS[name];
      for (frame = 0; frame < n; frame++) get(name, frame);
    }
    for (var i = 0; i < WHITE_SET.length; i++) {
      name = WHITE_SET[i];
      n = FRAME_COUNTS[name] || 1;
      for (frame = 0; frame < n; frame++) getWhite(name, frame);
    }
    for (var j = 0; j < ALL_ICON_NAMES.length; j++) icon(ALL_ICON_NAMES[j]);
    // biome decor (all frames)
    for (var d = 0; d < DECOR_NAMES.length; d++) {
      var dn = DECOR_NAMES[d], fc = DECOR_FRAMES[dn] || 1;
      for (frame = 0; frame < fc; frame++) get(dn, frame);
    }
    // all biome ground tiles (6 biomes x 3 variants), graveyard v0 first
    for (var bi = 0; bi < BIOME_KEYS.length; bi++) {
      for (var vv = 0; vv < 3; vv++) groundTile(BIOME_KEYS[bi], vv);
    }
  }

  /* ================================================================== *
   * Public API
   * ================================================================== */
  MB.Sprites = {
    preload: preload,
    get: get,
    getWhite: getWhite,
    groundTile: groundTile,
    icon: icon,
    PALETTE: PAL   // exposed for any module that wants matching colors
  };

})(window.MB = window.MB || {});
