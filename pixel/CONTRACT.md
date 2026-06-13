# MEGABONK: PIXEL CRYPT — Architecture Contract

A pixel-art **Vampire Survivors clone**. Setting: **gothic horror** — a cursed midnight
graveyard. Top-down, character auto-attacks, hordes of pixel monsters, XP gems, level-up
upgrade picks, weapon evolutions, 15-minute run ending with an unkillable Reaper.

Pure vanilla JS + HTML5 Canvas. **No build step, no dependencies.** Opens by double-clicking
`index.html` (so we use classic `<script>` tags, NOT ES modules — `file://` blocks modules).

## Global namespace pattern (MANDATORY)

Every module attaches to a single global `MB`. No ES `import`/`export`.

```js
(function (MB) {
  'use strict';
  // ... module code ...
  MB.Weapons = { /* public API */ };
})(window.MB = window.MB || {});
```

Cross-module references use `MB.Foo` **at call time** (inside functions), never at top-level
load time. So script load order only needs `core.js` first and `main.js` last.

### Script load order (index.html)
1. `src/core.js`      — State, constants, utils, world-FX factories, SpatialHash, camera, drawSprite
2. `src/sprites.js`   — MB.Sprites: procedural pixel-art canvases
3. `src/audio.js`     — MB.Audio: WebAudio SFX + music
4. `src/player.js`    — MB.Player class + char defs
5. `src/weapons.js`   — MB.Weapons: weapon defs, Weapon class, projectiles, evolutions
6. `src/enemies.js`   — MB.Enemies: enemy defs, spawn director, Enemy class
7. `src/upgrades.js`  — MB.Upgrades: level-up options, passives, recomputeStats
8. `src/ui.js`        — MB.UI: HUD, screens, level-up modal
9. `src/main.js`      — MB.Main.init(): boots everything, the game loop

---

## Coordinate system & rendering

- One canvas `#game`, fills the window. `ctx.imageSmoothingEnabled = false` (crisp pixels).
- World units = "world pixels". Camera centers on the player.
- `MB.VIEW_SCALE = 3`: every sprite is blitted 3× → chunky pixels. Sprites authored at 1× (~10–24px).
- World→screen: `sx = (wx - cam.x) * VIEW_SCALE + screen.cx`, `sy = (wy - cam.y) * VIEW_SCALE + screen.cy`.
- `MB.cam.worldToScreen(wx, wy) -> {sx, sy}` provided by core.
- World is effectively unbounded; enemies spawn just off-screen, despawn when very far.
- Y-sorting: entities drawn in order of increasing `y` so lower ones overlap correctly (main.js handles).

### `MB.drawSprite(ctx, sprite, wx, wy, opts)` — provided by core
Draws a 1× sprite canvas centered at world (wx, wy), scaled by VIEW_SCALE.
`opts` (all optional): `{ flip:false, anchor:'center'|'bottom', alpha:1, whiten:0..1, scale:1, rot:0 }`.
- `flip` mirrors horizontally. `anchor:'bottom'` puts wy at the sprite's feet.
- `whiten>0` → draw the white-silhouette variant (`MB.Sprites.getWhite(name)`) for hit-flash.
- `scale` multiplies VIEW_SCALE (for pulsing/auras). `rot` radians (used by some projectiles).
Sprites passed in are canvases from `MB.Sprites.get(...)`.

---

## `MB` core API (core.js implements ALL of this)

### Constants
- `MB.VIEW_SCALE = 3`
- `MB.RUN_DURATION = 900` (seconds; Reaper spawns at the end)
- `MB.WORLD_BG = '#1b1726'` (canvas clear color, dark purple night)

### State (single mutable object `MB.State`)
```
MB.State = {
  scene: 'start'|'playing'|'levelup'|'gameover'|'victory',
  paused: false,
  time: 0,            // elapsed run seconds (does not advance while paused/levelup)
  dt: 0,              // last frame delta seconds (clamped <= 0.05)
  frame: 0,
  player: null,       // MB.Player instance
  enemies: [],        // MB.Enemy[]
  projectiles: [],    // weapon projectiles/effects (each has update(dt), draw(ctx), dead)
  gems: [],           // XP gems (core-owned)
  pickups: [],        // chest/heart/magnet/coin/bomb (core-owned)
  particles: [],      // core-owned
  damageTexts: [],    // core-owned
  decor: [],          // static graveyard props {x,y,sprite} (main/enemies may seed)
  kills: 0,
  gold: 0,
  camera: { x:0, y:0 },
  screen: { w:0, h:0, cx:0, cy:0 },  // cx,cy = w/2, h/2
  grid: null,         // MB.SpatialHash of enemies, rebuilt each frame by main
  char: null,         // chosen character def
}
```

### Utils (on `MB`)
`clamp(v,a,b)`, `lerp(a,b,t)`, `rand(a,b)` (float), `randInt(a,b)` (incl), `pick(arr)`,
`chance(p)` (0..1), `dist2(ax,ay,bx,by)`, `dist(ax,ay,bx,by)`, `angle(ax,ay,bx,by)` (radians from a→b),
`norm(dx,dy) -> {x,y}` (unit vec, {0,0} if zero), `approach(cur,target,maxDelta)`, `nextId()` (incrementing int).

### SpatialHash (`MB.SpatialHash`, cell size 48)
`new MB.SpatialHash(cell=48)`; `.clear()`; `.insert(e)` (uses e.x,e.y); `.query(x,y,r) -> e[]`
(all inserted entities whose cell is within radius r — caller does precise distance check);
`.queryRect(x,y,w,h)->e[]`.

### World-FX factories (core owns these arrays + classes)
- `MB.spawnGem(x, y, value)` — value in XP. Color auto: blue(small)/green/red(big). Gems drift to
  player when within player's magnet radius, collected on contact → `player.gainXp(value)` + sfx 'pickup'.
- `MB.spawnPickup(x, y, type)` — type ∈ `'chest'|'heart'|'magnet'|'coin'|'bomb'`. On pickup:
  chest→`MB.Upgrades.openChest()`; heart→heal 30% maxHp; magnet→vacuum all gems; coin→gold; bomb→damage all on screen.
- `MB.spawnDamageText(x, y, text, color)` — floating combat number, rises & fades.
- `MB.spawnParticles(x, y, color, count, opts)` — burst of pixel particles. opts `{speed,life,size,gravity}`.
- `MB.spawnFloatText` alias of spawnDamageText.
- Update/draw of all four world-FX arrays handled by `MB.updateWorldFX(dt, player)` and
  `MB.drawWorldFX(ctx)` (gems+pickups+particles+damageTexts). main.js calls these.
- Gems & pickups are drawn UNDER entities; damageTexts & particles OVER. core exposes
  `MB.drawGround_FX(ctx)` (gems, pickups) and `MB.drawOver_FX(ctx)` (particles, texts) if main wants
  finer ordering; also keep the combined `MB.drawWorldFX` that calls both in order.

### `MB.reset()` — clears all arrays, resets State for a new run (main calls before startGame).

---

## Sprites (sprites.js → `MB.Sprites`)

All sprites are procedurally drawn pixel art onto offscreen canvases (no external images).
Gothic palette: bone white `#e8e6d8`, blood `#b5202a`, bruise purple `#5a3a78`, grave grey
`#6d6a7c`, slime green `#7bbf4a`, gold `#f2c14e`, night `#1b1726`, ghost `#bcd7e8`.

API:
- `MB.Sprites.preload()` — build & cache every sprite. Called once by main before the run.
- `MB.Sprites.get(name, frame=0) -> HTMLCanvasElement` (1× pixel art).
- `MB.Sprites.getWhite(name, frame=0) -> canvas` — all-white silhouette (hit flash).
- `MB.Sprites.groundTile() -> canvas` — one tileable graveyard-ground tile (~32×32) for the background.
- `MB.Sprites.icon(name) -> canvas` — small icon for UI weapon/passive slots (can reuse weapon/passive art).

Required sprite names (each with sane frames where noted):
- Player: `'hero'` frames 0..1 (idle/walk bob). 16×20-ish, faces right by default (drawSprite flips for left).
- Enemies: `'bat'`(0,1 wing flap), `'zombie'`(0,1), `'skeleton'`(0,1), `'ghost'`(0,1 float),
  `'slime'`(0,1 squash), `'bigbat'`(elite), `'reaper'`(boss, ~28×32).
- Gems: `'gem_blue'`, `'gem_green'`, `'gem_red'`.
- Pickups: `'chest'`, `'heart'`, `'magnet'`, `'coin'`, `'bomb'`.
- Decor: `'tombstone'`, `'cross'`, `'deadtree'`, `'skull'`.
- Weapon/passive icons referenced by id in WEAPON_DEFS / PASSIVE_DEFS `.icon` (see below). Provide an
  icon for every weapon & passive id, e.g. `'icon_whip'`, `'icon_wand'`, ... If an icon is missing,
  `MB.Sprites.icon` must return a labeled fallback box (never crash).
- Projectile bits used by weapons: `'proj_knife'`, `'proj_bone'`, `'proj_bible'`, `'proj_fire'`,
  `'proj_bolt'`(lightning), `'aura_garlic'`(soft ring), `'whip_slash'`, `'proj_orb'`, `'proj_hammer'`.

`MB.Sprites` must never throw for an unknown name — return a 8×8 magenta placeholder.

---

## Audio (audio.js → `MB.Audio`)

WebAudio, fully synthesized (no files). Bit-crushy/retro. Must lazy-init on first user gesture.
- `MB.Audio.init()` — create AudioContext (call from the Start button click).
- `MB.Audio.sfx(name)` — name ∈ `'shoot'|'hit'|'crit'|'levelup'|'pickup'|'hurt'|'death'|'chest'|'evolve'|'boss'|'select'|'gameover'|'victory'`.
- `MB.Audio.startMusic()` / `MB.Audio.stopMusic()` — looping minor-key gothic chiptune (a couple oscillators + a step sequence). Keep it subtle.
- `MB.Audio.setMuted(bool)`, `MB.Audio.muted`. Never throw if context missing.

---

## Player (player.js → `MB.Player`, `MB.CHARACTERS`)

`MB.CHARACTERS` = array of `{ id, name, sprite:'hero', desc, startWeapon:<weaponId>, base:{...stat overrides...} }`.
Provide at least 3: e.g. **Bonker** (hammer/whip, balanced), **Hexe** (wand, +area/-hp), **Revenant** (knife, +speed/+amount).

`new MB.Player(charDef)` creates the player at world (0,0). Fields (the **stat model** — weapons read these):
```
x, y, id,
hp, maxHp,
level=1, xp=0, xpToNext,                  // xpToNext via MB.Upgrades.xpForLevel(level)
// --- derived stats (recomputed by MB.Upgrades.recomputeStats) ---
might=1,          // global damage multiplier
area=1,           // weapon size/range multiplier
cooldownMult=1,   // weapon cooldown multiplier (lower = faster), clamp >= 0.4
projSpeed=1,      // projectile speed multiplier
duration=1,       // effect duration multiplier
amount=0,         // EXTRA projectiles added to weapons
speed=1,          // move speed multiplier (base move px/s = MB.Player.BASE_SPEED * speed)
magnet=1,         // pickup radius multiplier (base radius ~ 46)
growth=1,         // XP gain multiplier
luck=1,           // affects drops & 4th upgrade choice
armor=0,          // flat damage reduction per hit
regen=0,          // hp per second
greed=1,          // gold multiplier
revives=0,        // extra lives
// --- runtime ---
weapons=[],       // MB.Weapon[]
passives={},      // id -> level
facing={x:1,y:0}, // last nonzero move dir (for directional weapons)
moving=false,
iframes=0,        // invulnerability seconds remaining
```
Methods:
- `update(dt, input)` — input `{up,down,left,right}` booleans (from main). Moves (normalized,
  diagonal-corrected), updates facing/moving, ticks iframes, applies regen, ticks each weapon's `update(dt, this)`.
- `draw(ctx)` — draws hero sprite (bob frame by moving), flashes white while iframes active.
- `takeDamage(n)` — applies armor (`max(1, n-armor)`), ignores if iframes>0; sets iframes (~0.5s),
  sfx 'hurt', red particles, screen shake (`MB.shake(...)` if present). On hp<=0: if revives>0 →
  consume, heal 50%; else `MB.Main.gameOver()`.
- `gainXp(n)` — `xp += n*growth`; while `xp>=xpToNext` → level up: `level++`, carry remainder,
  recompute xpToNext, push a pending level-up (`MB.Main.queueLevelUp()`), sfx 'levelup'.
- `heal(n)`, `addGold(n)`, `magnetRadius()` (returns world px), `vacuumGems()`.
- `MB.Player.BASE_SPEED = 78` (world px/s), `MB.Player.BASE_MAGNET = 46`.

Contact damage: main.js (or player) checks enemies overlapping the player each frame and calls
`player.takeDamage(enemy.dmg)` with the iframe gate. Keep contact handling in player via
`player.handleContacts(enemies)` OR in main — **main.js owns the call**, player provides `takeDamage`.

---

## Weapons (weapons.js → `MB.Weapons`)

### `MB.Weapons.DEFS` — map weaponId -> definition
```
{
  id, name, icon:'icon_whip', desc,
  maxLevel: 8,
  // base stats at level 1; per-level deltas applied in statsAt(level)
  base: { damage, cooldown, count, area, speed, pierce, duration, knockback },
  // returns concrete stats for a level (apply growth per level)
  // (implement statsAt inside the def or a shared helper)
  kind: 'whip'|'projectile'|'orbit'|'aura'|'drop'|'homing'|'lightning'|'nova'|'hammer',
  evolvesTo: <weaponId>|null,
  evolvePassive: <passiveId>|null,   // required maxed passive to evolve (null = level-only/gift)
  levelText(level) -> string,        // what the next level adds (for UI)
}
```
Provide a rich roster (≈8 base + evolutions). Suggested:
- `whip` (horizontal slashes in facing dir) → evolve `bloodywhip` (+lifesteal) [passive: hollowheart]
- `wand` (homing bolts at nearest) → `holywand` (fires nonstop) [passive: emptytome]
- `knife` (fast piercing in facing dir) → `thousandknives` [passive: bracer]
- `bible` (orbiting tomes) → `unholyvespers` [passive: spellbinder]
- `garlic` (damaging aura ring + knockback) → `souleater` (heal on kill) [passive: pummarola]
- `fireball`/`santawater` (drops damaging zones) → `hellfire` [passive: spellbinder/candelabrador]
- `lightning` (random strikes on enemies) → `thunderloop` [passive: duplicator]
- `hammer` (the MEGABONK — big slow arcs / orbiting mace, signature weapon) → `megabonk` [passive: spinach]

### `MB.Weapon` class
`new MB.Weapon(defId)` → `{ def, id, level:1, timer:0 }`.
- `update(dt, player)` — decrement timer by dt; when ≤0, `fire(player)` and reset timer to
  `statsAt(level).cooldown * player.cooldownMult` (clamped). Auras/orbits may instead maintain a
  persistent projectile and just refresh it — implement per kind.
- `fire(player)` — spawn the appropriate projectile object(s) into `MB.State.projectiles`.
  Respect `player.might` (damage), `player.area` (size), `player.amount` (+count), `player.projSpeed`,
  `player.duration`. sfx 'shoot' (throttle so it isn't deafening).
- `levelUp()` — `level = min(level+1, def.maxLevel)`.

### Projectile contract (objects pushed into `MB.State.projectiles`)
Each projectile is a plain object/instance with:
- `x, y`, `dead:false`
- `update(dt)` — move, age, handle collisions: query `MB.State.grid` for nearby enemies, for each
  within hit range call `enemy.hit(dmg, kx, ky, this.uid)` **once** (track a `hitSet`/`Set` of enemy
  ids for piercing; auras re-hit on an interval). Set `dead=true` when spent (lifetime/pierce gone).
- `draw(ctx)` — uses `MB.drawSprite` or raw canvas ops in WORLD space via `MB.cam`.
- `uid` — `MB.nextId()` so enemies can dedupe hits.
- Damage helper: weapons apply crit via player.luck optionally; call `MB.spawnDamageText` on hit and
  `MB.Audio.sfx('hit')` (throttled). Knockback vector (kx,ky) is normalized * knockback.

### Evolution
- `MB.Weapons.tryEvolve(player)` — called when a chest is opened. For each weapon at maxLevel whose
  `evolvePassive` is owned (and maxed, or null), with a free check, replace it with `evolvesTo`
  (new Weapon at level 1 but evolved flag → strong stats). Return the evolved weapon or null.
  sfx 'evolve', big particles, toast via `MB.UI.toast`.
- Only evolve ONE per chest unless you choose otherwise.

---

## Enemies (enemies.js → `MB.Enemies`)

### `MB.Enemies.DEFS` — map type -> `{ type, name, sprite, hp, speed, dmg, xp, radius, knockbackMult, color, boss?, elite?, behavior }`
behavior ∈ `'chase'`(homing) | `'straight'`(fixed dir) | `'floaty'`(sine weave) | `'charger'`.
Types: `bat`(fast weak), `zombie`(slow tanky), `skeleton`(medium), `ghost`(floaty, phases),
`slime`(splits into 2 small slimes on death — optional), `bigbat`(elite), `reaper`(boss).

### `MB.Enemy` class
`new MB.Enemy(type, x, y)` with `id=MB.nextId()`, `dead=false`, `hp`, `flash=0` (white-flash timer).
- `update(dt, player)` — move per behavior toward/around player; light separation from neighbors via
  grid is nice-to-have; decay flash; if within `radius+player.radius` of player → contact handled by
  main (don't double-apply here). HP-scaling by time can be applied at spawn.
- `hit(dmg, kx, ky, srcUid)` — subtract hp, set flash, apply knockback (scaled by knockbackMult,
  bosses resist), spawn small blood particles + `MB.spawnDamageText`. If hp<=0 → `die()`.
- `die()` — `dead=true`, `MB.State.kills++`, drop `MB.spawnGem(x,y,xp)`; luck-based bonus drops
  (heart/coin/magnet/chest for bosses) via `MB.chance`. Bosses always drop a `'chest'`. sfx 'death' (throttled).
- `draw(ctx)` — sprite via `MB.drawSprite`, flip toward player, `whiten` while flash>0; HP bar for bosses/elites.

### Spawn director `MB.Enemies.Director`
- `MB.Enemies.startRun()` — reset wave state.
- `MB.Enemies.update(dt, player)` — spawn enemies in a ring just outside the view based on a
  **wave table keyed by run time** (escalating count/types each minute). Cap live enemies (~350) for
  perf; despawn enemies far off-screen (recycle). Spawn **bosses/elites** at minute marks
  (e.g. elite swarms ~ every 2 min, mini-boss at 5/10 min). At `MB.State.time >= MB.RUN_DURATION`
  spawn the **Reaper** (huge hp, fast) and trigger end sequence (main shows victory when it dies, or
  the Reaper is unkillable and kills the player — pick: Reaper is beatable for a win screen).
- Provide `MB.Enemies.spawnRingPos(player) -> {x,y}` helper.

---

## Upgrades (upgrades.js → `MB.Upgrades`)

- `MB.Upgrades.PASSIVE_DEFS` — map passiveId -> `{ id, name, icon, maxLevel, desc, apply(player,level), levelText(level) }`.
  Passive ids referenced by weapon evolutions: `spinach`(might), `armor`, `wings`(speed),
  `emptytome`(cooldown), `candelabrador`(area), `duplicator`(amount), `bracer`(projSpeed),
  `spellbinder`(duration), `attractorb`(magnet), `crown`(growth), `clover`(luck),
  `hollowheart`(maxHp), `pummarola`(regen), `tiragisu`(revive), `stonemask`(greed).
- `MB.Upgrades.xpForLevel(level) -> xp` needed to go from `level` → `level+1`
  (VS-like: lvl1→2 = 5, then +10 per level early, gentler scaling fine).
- `MB.Upgrades.recomputeStats(player)` — reset player derived stats to char base, then apply every
  owned passive at its level, then apply weapon-count effects. Call after any weapon/passive change.
- `MB.Upgrades.rollOptions(player) -> option[]` — produce 3 (or 4 if luck) choices. An option is
  `{ kind:'weapon'|'passive', id, level, isNew, name, icon, text }`. Rules: offer new weapons only if
  weapon slots < 6; new passives only if passive slots < 6; otherwise upgrades of owned items;
  never offer maxed items; if nothing to offer, give a "Refund: +20 gold/heal" filler option.
- `MB.Upgrades.apply(player, option)` — add/upgrade the weapon or passive, `recomputeStats`, sfx 'select'.
- `MB.Upgrades.openChest(player)` — try evolve (MB.Weapons.tryEvolve); if no evolution, grant a random
  upgrade or gold; sfx 'chest'.

main.js drives the level-up flow: on `queueLevelUp`, after current frame, set scene='levelup',
pause, call `MB.UI.showLevelUp(MB.Upgrades.rollOptions(player), choice => { MB.Upgrades.apply(player, choice); resume })`.

---

## UI (ui.js → `MB.UI`) — owns styles.css too

DOM skeleton ids exist in index.html (see below). UI styles them (pixel font, gothic frame) and wires them.
- `MB.UI.init()` — cache nodes.
- `MB.UI.showStart(characters, onStart)` — render character-select cards on `#start-screen`; `onStart(charDef)` on click; also a mute toggle. Hides other screens.
- `MB.UI.hideStart()`.
- `MB.UI.updateHUD(state)` — every frame: timer `mm:ss` from `state.time`, level, XP bar fill
  (`player.xp/player.xpToNext`), HP bar (`player.hp/player.maxHp` + number), kills, gold, and the
  weapon/passive icon rows (icon + level pips). Keep it cheap (only touch DOM when values change).
- `MB.UI.showLevelUp(options, onPick)` — fill `#levelup-screen` with option cards (icon, name,
  NEW/Lv, text). Click or number keys 1–4 pick. Calls `onPick(option)` then hides. Show "LEVEL UP!".
- `MB.UI.showGameOver(stats, onRestart)` / `MB.UI.showVictory(stats, onRestart)` — stats:
  `{time, level, kills, gold}`. Restart button → onRestart().
- `MB.UI.toast(text, ms=1800)` — transient centered banner (evolutions, boss warnings).
- `MB.UI.showBossWarning()` — optional red flashing "⚠ THE REAPER COMES".

### index.html DOM ids (provided by the foundation; UI must use these)
`#game` (canvas), `#ui-root` (overlay), `#hud` with children `#timer #level-text #xp-bar #xp-fill
#hp-bar #hp-fill #hp-text #kills #gold #weapon-icons #passive-icons`, plus full-screen panels
`#start-screen #levelup-screen #gameover-screen #toast`. UI may add inner nodes freely.

---

## Main (main.js → `MB.Main`)

- `MB.Main.init()` — on DOMContentLoaded: get canvas/ctx, `imageSmoothingEnabled=false`, size to
  window (+resize handler updating `State.screen`), `MB.Sprites.preload()`, `MB.UI.init()`,
  keyboard input listeners (WASD/arrows, P pause, M mute, 1–4 for level-up, Esc), then
  `MB.UI.showStart(MB.CHARACTERS, startGame)`. Begin `requestAnimationFrame(loop)`.
- `startGame(charDef)` — `MB.Audio.init()`, `MB.reset()`, set `State.char`, create player, give start
  weapon, `MB.Upgrades.recomputeStats`, `MB.Enemies.startRun()`, `MB.Audio.startMusic()`,
  scene='playing', hide screens.
- `loop(ts)` — compute dt (clamp ≤0.05), if scene==='playing' && !paused: advance `State.time+=dt`;
  rebuild enemy grid; update player (with input), weapons (via player.update), enemies director +
  enemies, projectiles, world FX (`MB.updateWorldFX`); resolve player↔enemy contacts; cull dead from
  arrays; update camera to player (optional slight smoothing + screen shake). Then RENDER regardless
  of pause: clear (WORLD_BG), draw ground tiling, decor, ground-FX (gems/pickups), entities Y-sorted
  (enemies + player), projectiles, over-FX (particles/texts), then `MB.UI.updateHUD`. Always
  `requestAnimationFrame(loop)`.
- `queueLevelUp()` — set a pending counter; between frames, if pending>0 and scene==='playing', enter
  level-up: scene='levelup', show modal; on pick → apply, pending--, if more pending show next else resume.
- `gameOver()` — scene='gameover', stop music, `MB.UI.showGameOver(stats, restart)`.
- `victory()` — scene='victory', `MB.UI.showVictory(...)`.
- Helpers main may expose: `MB.shake(amount)` (camera shake), `MB.Main.restart()`.

---

## INTEGRATION PROTOCOLS (resolve all cross-module coupling — obey exactly)

These pin the seams between modules so independently-written files slot together.

1. **Stat baseline ownership.** `player.js` defines the canonical defaults:
   `MB.Player.BASE_STATS = { might:1, area:1, cooldownMult:1, projSpeed:1, duration:1, amount:0,
   speed:1, magnet:1, growth:1, luck:1, armor:0, regen:0, greed:1, revives:0, maxHp:100 }`.
   The Player constructor stores `player.charBase = charDef.base || {}` (per-character overrides,
   e.g. `{maxHp:120, might:1.1}`). `MB.Upgrades.recomputeStats(player)` is the SINGLE writer of derived
   stats: it starts each stat from `BASE_STATS`, multiplies/adds `charBase` overrides, then applies
   every owned passive (`PASSIVE_DEFS[id].apply(player, level)`), then weapon-count effects, then
   clamps (`cooldownMult>=0.4`, `speed>=0.4`, etc.). It must preserve current `hp` ratio when `maxHp`
   changes. Recompute is called: after construction, and after every weapon/passive add or level.

2. **`enemy.hit(dmg, kx, ky, srcUid)`** — exact signature. `dmg` number; `kx,ky` = knockback DIRECTION
   (unit-ish vector, enemy scales by its own knockback + def.knockbackMult); `srcUid` = projectile uid
   for piercing dedupe. Returns `true` if this hit killed the enemy (so weapons can do on-kill effects
   like lifesteal/soul-eater heal). Crit handling lives in the WEAPON (roll via player.luck, multiply
   dmg, pass a flag is unnecessary — weapon calls `MB.spawnDamageText` with a crit color itself).
   Enemy.hit still spawns its own blood particles + the damage number is spawned by the ENEMY (one
   source of truth) — weapons MUST NOT also spawn damage text. (Enemy owns: flash, knockback, hp,
   blood particles, `MB.spawnDamageText(x,y,dmg, crit?'#ffec70':'#ffffff')`, death.)
   → weapon passes an optional 5th arg `crit` (bool) to `hit` for the number color: full signature is
   `enemy.hit(dmg, kx, ky, srcUid, crit)`. `crit` defaults false.

3. **Enemy lookup helpers (enemies.js provides, weapons.js consumes):**
   - `MB.Enemies.nearest(x, y, maxDist) -> Enemy|null` (nearest live enemy within maxDist, via grid).
   - `MB.Enemies.queryCircle(x, y, r) -> Enemy[]` (live enemies within r, via grid).
   - `MB.Enemies.randomOnScreen() -> Enemy|null` (for lightning targeting).
   These use `MB.State.grid` (rebuilt each frame by main BEFORE updates). Weapons rely on these
   instead of touching the grid directly.

4. **Projectile minimal interface** (objects in `MB.State.projectiles`): `{ x, y, dead:false,
   uid:MB.nextId(), update(dt), draw(ctx) }`. main culls `dead`. Lifetime/pierce → set `dead=true`.

5. **Weapon ticking.** `player.update(dt,input)` ends by `for (const w of this.weapons) w.update(dt, this)`.
   Persistent weapons (orbit/aura) keep their projectile alive and reposition it in `update`/projectile
   `update` rather than re-firing; transient weapons spawn-and-forget on cooldown.

6. **Level-up flow.** `player.gainXp` calls `MB.Main.queueLevelUp()` (may queue several). main enters
   the `levelup` scene, calls `MB.UI.showLevelUp(MB.Upgrades.rollOptions(player), pick => { MB.Upgrades.apply(player, pick); MB.Main.afterLevelUp(); })`.
   `afterLevelUp` shows the next queued level-up or resumes play. Number keys 1–4 select (main forwards
   to a handler UI registers, e.g. `MB.UI._pickByIndex(i)`).

7. **Character start weapon.** `startGame` does `player.weapons.push(new MB.Weapon(charDef.startWeapon))`
   then `recomputeStats`. Weapon ids in CHARACTERS must exist in `MB.Weapons.DEFS`.

8. **Audio throttling.** `MB.Audio.sfx` internally rate-limits identical sounds (e.g. ≥30ms apart) so
   mass 'hit'/'shoot' don't clip. Callers may spam it safely.

9. **No per-frame allocation in hot loops** (enemy/projectile update, collision). Reuse scratch vars.
   Use `MB.State.grid` for all enemy proximity. Target 300+ enemies at 60fps.

10. **Defensive guards.** Every cross-module call site guards existence (`MB.Audio && MB.Audio.sfx(...)`,
    `MB.Sprites ? ... : placeholder`). A missing/late module must never throw.

## Quality bar
- 60 FPS with 300+ enemies (use the grid; avoid per-frame allocations in hot loops; reuse vectors).
- Juicy: hit flashes, knockback, blood particles, floating damage numbers, screen shake on big hits,
  level-up fanfare, evolution toast, gem-collect sparkle, boss warning.
- Readable gothic pixel art, cohesive dark palette, subtle CRT/vignette optional.
- Never crash on missing sprite/icon/audio. Defensive: guard `MB.X &&`.
- All numbers tuned for a fun 15-minute escalation: trickle → swarm → bullet-heaven screen-clear.
