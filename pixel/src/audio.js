/* MEGABONK: PIXEL CRYPT — audio.js
 * MB.Audio: fully synthesized retro WebAudio. No files, no deps.
 * Lazy-inits an AudioContext on the first user gesture (the Start button).
 * Public API (exact):
 *   MB.Audio.init()                      create AudioContext + master gain (safe to call repeatedly)
 *   MB.Audio.sfx(name)                   one-shot synthesized sound effect (rate-limited, voice-capped)
 *   MB.Audio.startMusic()/.stopMusic()   looping gothic chiptune via a lookahead step sequencer
 *   MB.Audio.setMuted(bool)              master gain -> ~0 when muted
 *   MB.Audio.muted                       current mute flag (bool)
 * Never throws if the context is missing, suspended, or unsupported.
 */
(function (MB) {
  'use strict';

  var AC = window.AudioContext || window.webkitAudioContext || null;

  /* ---- nodes / state -------------------------------------------------- */
  var ctx = null;
  var master = null;          // master gain -> destination
  var sfxBus = null;          // all sfx -> master
  var musicBus = null;        // all music -> master (faded on stop)
  var musicDelay = null, musicFeedback = null, musicDelayMix = null;
  var noiseBuffer = null;

  var muted = false;
  var MASTER_VOL = 0.55;
  var MUSIC_VOL = 0.12;       // atmospheric, low

  // rate-limit identical sounds: ignore if < 30ms since same name last played
  var lastPlayed = Object.create(null);
  var RATE_LIMIT = 0.030;

  // voice cap so mass hits/shoots can't overload the graph
  var activeVoices = 0;
  var MAX_VOICES = 32;

  /* ---- helpers -------------------------------------------------------- */
  function mtof(m) { return 440 * Math.pow(2, (m - 69) / 12); }

  function makeNoise() {
    var sr = (ctx.sampleRate || 44100);
    var len = Math.floor(sr * 0.5);
    var buf = ctx.createBuffer(1, len, sr);
    var d = buf.getChannelData(0);
    for (var i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  function ensureCtx() {
    if (ctx) return true;
    if (!AC) return false;
    try { ctx = new AC(); } catch (e) { ctx = null; return false; }

    master = ctx.createGain();
    master.gain.value = muted ? 0 : MASTER_VOL;
    master.connect(ctx.destination);

    sfxBus = ctx.createGain();
    sfxBus.gain.value = 1;
    sfxBus.connect(master);

    musicBus = ctx.createGain();
    musicBus.gain.value = 1;
    musicBus.connect(master);

    // gentle feedback echo gives the music some crypt-y space
    try {
      musicDelay = ctx.createDelay(1.0);
      musicDelay.delayTime.value = 0.34;
      musicFeedback = ctx.createGain();
      musicFeedback.gain.value = 0.27;
      musicDelayMix = ctx.createGain();
      musicDelayMix.gain.value = 0.35;
      musicDelay.connect(musicFeedback);
      musicFeedback.connect(musicDelay);
      musicDelay.connect(musicDelayMix);
      musicDelayMix.connect(musicBus);
    } catch (e) { musicDelay = null; }

    try { noiseBuffer = makeNoise(); } catch (e) { noiseBuffer = null; }
    return true;
  }

  function track(node) {
    activeVoices++;
    node.onended = function () { activeVoices--; node.onended = null; };
  }

  // one enveloped oscillator voice (-> sfxBus by default)
  function osc(type, freq, t0, dur, peak, opts) {
    opts = opts || {};
    var o = ctx.createOscillator();
    var g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t0);
    if (opts.slideTo) {
      try { o.frequency.exponentialRampToValueAtTime(Math.max(1, opts.slideTo), t0 + dur); }
      catch (e) {}
    }
    if (opts.detune) o.detune.setValueAtTime(opts.detune, t0);
    var atk = (opts.attack != null) ? opts.attack : 0.005;
    if (atk >= dur) atk = dur * 0.3;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(peak, t0 + atk);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    var out = opts.dest || sfxBus;
    if (opts.filter) {
      var f = ctx.createBiquadFilter();
      f.type = opts.filter;
      f.frequency.setValueAtTime(opts.filterFreq || 1200, t0);
      o.connect(g); g.connect(f); f.connect(out);
    } else {
      o.connect(g); g.connect(out);
    }
    o.start(t0);
    o.stop(t0 + dur + 0.02);
    track(o);
    return o;
  }

  // a short noise burst (for ticks / thuds)
  function noise(t0, dur, peak, filterType, filterFreq, dest) {
    if (!noiseBuffer) return null;
    var s = ctx.createBufferSource();
    s.buffer = noiseBuffer;
    s.loop = true;
    var g = ctx.createGain();
    g.gain.setValueAtTime(peak, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    if (filterType) {
      var f = ctx.createBiquadFilter();
      f.type = filterType;
      f.frequency.value = filterFreq || 2000;
      s.connect(f); f.connect(g);
    } else {
      s.connect(g);
    }
    g.connect(dest || sfxBus);
    s.start(t0);
    s.stop(t0 + dur + 0.02);
    track(s);
    return s;
  }

  /* ---- public: init --------------------------------------------------- */
  function init() {
    if (!ensureCtx()) return;
    if (ctx.state === 'suspended' && ctx.resume) {
      try { ctx.resume(); } catch (e) {}
    }
  }

  /* ---- public: sfx ---------------------------------------------------- */
  function sfx(name) {
    if (!ctx || muted) return;
    var t = ctx.currentTime;
    var last = lastPlayed[name];
    if (last !== undefined && t - last < RATE_LIMIT) return;
    lastPlayed[name] = t;
    if (activeVoices > MAX_VOICES) return;

    switch (name) {
      case 'shoot': // soft descending blip
        osc('square', 720, t, 0.07, 0.16, { slideTo: 470, attack: 0.002, filter: 'lowpass', filterFreq: 2000 });
        break;

      case 'hit': // short noisy tick
        noise(t, 0.05, 0.22, 'highpass', 1500);
        osc('square', 320, t, 0.045, 0.10, { slideTo: 170, attack: 0.001 });
        break;

      case 'crit': // brighter, sharper hit
        noise(t, 0.06, 0.28, 'bandpass', 2700);
        osc('square', 900, t, 0.08, 0.15, { slideTo: 540, attack: 0.001 });
        osc('square', 1350, t, 0.06, 0.09, { slideTo: 920, attack: 0.001 });
        break;

      case 'levelup': { // rising A-minor arpeggio chime
        var lu = [69, 72, 76, 81]; // A C E A
        for (var i = 0; i < lu.length; i++)
          osc('triangle', mtof(lu[i]), t + i * 0.062, 0.18, 0.20,
            { attack: 0.005, filter: 'lowpass', filterFreq: 3200 });
        osc('square', mtof(88), t + 0.26, 0.18, 0.08, { attack: 0.002 });
        break;
      }

      case 'pickup': // coin-y double ping
        osc('square', mtof(83), t, 0.05, 0.16, { attack: 0.001 });
        osc('square', mtof(88), t + 0.05, 0.12, 0.16, { attack: 0.001 });
        break;

      case 'hurt': // low buzz / thud
        osc('sawtooth', 125, t, 0.22, 0.26, { slideTo: 58, attack: 0.003, filter: 'lowpass', filterFreq: 650 });
        noise(t, 0.12, 0.16, 'lowpass', 520);
        break;

      case 'death': // tiny downward blip
        osc('square', 440, t, 0.18, 0.15, { slideTo: 88, attack: 0.002, filter: 'lowpass', filterFreq: 1600 });
        break;

      case 'chest': { // sparkly major chord
        var ch = [60, 64, 67, 72]; // C E G C
        for (var c = 0; c < ch.length; c++)
          osc('triangle', mtof(ch[c]), t, 0.5, 0.13, { attack: 0.01, filter: 'lowpass', filterFreq: 4200 });
        for (var s = 0; s < 4; s++)
          osc('square', mtof(84 + s * 3), t + 0.10 + s * 0.06, 0.12, 0.07, { attack: 0.002 });
        break;
      }

      case 'evolve': { // big triumphant sweep + chord
        osc('sawtooth', 175, t, 0.7, 0.16, { slideTo: 720, attack: 0.02, filter: 'lowpass', filterFreq: 3200 });
        var ev = [69, 73, 76, 81]; // A C# E A (bright)
        for (var e = 0; e < ev.length; e++)
          osc('square', mtof(ev[e]), t + 0.08 + e * 0.07, 0.42, 0.12, { attack: 0.005, filter: 'lowpass', filterFreq: 3600 });
        osc('triangle', mtof(85), t + 0.40, 0.5, 0.12, { attack: 0.01 });
        noise(t, 0.10, 0.12, 'highpass', 3000);
        break;
      }

      case 'boss': // ominous low drone hit
        osc('sawtooth', 55, t, 1.2, 0.30, { slideTo: 41, attack: 0.05, filter: 'lowpass', filterFreq: 420 });
        osc('sine', 82, t, 1.0, 0.18, { attack: 0.05, filter: 'lowpass', filterFreq: 320 });
        noise(t, 0.3, 0.20, 'lowpass', 300);
        break;

      case 'select': // crisp UI click
        osc('square', 660, t, 0.045, 0.14, { slideTo: 900, attack: 0.001 });
        break;

      case 'gameover': { // slow descending minor lament
        var go = [69, 67, 65, 64, 62, 60]; // A G F E D C
        for (var k = 0; k < go.length; k++)
          osc('triangle', mtof(go[k]), t + k * 0.19, 0.42, 0.17, { attack: 0.01, filter: 'lowpass', filterFreq: 1800 });
        osc('sawtooth', mtof(33), t, 1.4, 0.12, { attack: 0.06, filter: 'lowpass', filterFreq: 300 });
        break;
      }

      case 'victory': { // bright fanfare
        var vt = [0, 0.12, 0.24, 0.42];
        var vic = [72, 76, 79, 84]; // C E G C
        for (var v = 0; v < vic.length; v++) {
          osc('square', mtof(vic[v]), t + vt[v], 0.5, 0.17, { attack: 0.004, filter: 'lowpass', filterFreq: 4200 });
          osc('triangle', mtof(vic[v] - 12), t + vt[v], 0.5, 0.10, { attack: 0.006 });
        }
        break;
      }

      default:
        // unknown sfx — soft neutral blip, never throw
        osc('square', 520, t, 0.05, 0.10, { attack: 0.002 });
        break;
    }
  }

  /* ---- music: lookahead step sequencer -------------------------------- */
  // Slow gothic loop in A natural minor: Am - F - C - G (i - VI - III - VII).
  var TEMPO = 92;                 // BPM
  var STEP_DUR = 60 / TEMPO / 2;  // 8th note
  var SCHED_AHEAD = 0.12;         // schedule this far ahead (s)
  var SCHED_TICK = 25;            // scheduler poll (ms)

  var musicPlaying = false;
  var schedTimer = null;
  var nextNoteTime = 0;
  var step = 0;
  var musicNodes = [];            // live oscillators (for clean stop)

  // chord roots (low bass midi) + arpeggio tone pool per chord
  var CHORDS = [
    { bass: 33, tones: [57, 60, 64, 69] }, // Am : A1  | A3 C4 E4 A4
    { bass: 29, tones: [53, 57, 60, 65] }, // F  : F1  | F3 A3 C4 F4
    { bass: 36, tones: [60, 64, 67, 72] }, // C  : C2  | C4 E4 G4 C5
    { bass: 31, tones: [55, 59, 62, 67] }, // G  : G1  | G3 B3 D4 G4
  ];
  // sparse 16-step arpeggio pattern (tone index, -1 = rest)
  var ARP = [0, -1, 2, 1, 3, -1, 1, 2, 0, 2, -1, 3, 1, -1, 2, -1];

  function musicNote(type, freq, t0, dur, peak, filterFreq, toDelay) {
    var o = ctx.createOscillator();
    var g = ctx.createGain();
    o.type = type;
    o.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(peak, t0 + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    var f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = filterFreq || 2000;
    o.connect(g); g.connect(f);
    f.connect(musicBus);
    if (toDelay && musicDelay) f.connect(musicDelay);
    o.start(t0);
    o.stop(t0 + dur + 0.05);
    activeVoices++;
    musicNodes.push(o);
    o.onended = function () {
      activeVoices--;
      var idx = musicNodes.indexOf(o);
      if (idx >= 0) musicNodes.splice(idx, 1);
      o.onended = null;
    };
    return o;
  }

  function scheduleStep(stepIndex, time) {
    var ci = (Math.floor(stepIndex / 4)) % CHORDS.length;
    var chord = CHORDS[ci];
    // bass note on each chord downbeat — warm triangle, long & low
    if (stepIndex % 4 === 0) {
      musicNote('triangle', mtof(chord.bass), time, STEP_DUR * 3.5, MUSIC_VOL * 0.95, 420, false);
      // soft octave shimmer above the root
      musicNote('square', mtof(chord.bass + 12), time, STEP_DUR * 1.6, MUSIC_VOL * 0.22, 700, false);
    }
    // sparse arpeggio
    var ti = ARP[stepIndex % 16];
    if (ti >= 0) {
      musicNote('square', mtof(chord.tones[ti]), time, STEP_DUR * 0.9, MUSIC_VOL * 0.42, 2600, true);
    }
  }

  function scheduler() {
    if (!ctx || !musicPlaying) return;
    var horizon = ctx.currentTime + SCHED_AHEAD;
    while (nextNoteTime < horizon) {
      scheduleStep(step, nextNoteTime);
      nextNoteTime += STEP_DUR;
      step = (step + 1) % 16;
    }
  }

  function startMusic() {
    if (!ensureCtx()) return;
    if (musicPlaying) return;
    if (ctx.state === 'suspended' && ctx.resume) { try { ctx.resume(); } catch (e) {} }
    musicPlaying = true;
    step = 0;
    nextNoteTime = ctx.currentTime + 0.08;
    try {
      var now = ctx.currentTime;
      musicBus.gain.cancelScheduledValues(now);
      musicBus.gain.setValueAtTime(1, now);
    } catch (e) {}
    if (schedTimer) clearInterval(schedTimer);
    schedTimer = setInterval(scheduler, SCHED_TICK);
    scheduler(); // prime immediately
  }

  function stopMusic() {
    musicPlaying = false;
    if (schedTimer) { clearInterval(schedTimer); schedTimer = null; }
    if (!ctx) return;
    var now = ctx.currentTime;
    try {
      musicBus.gain.cancelScheduledValues(now);
      musicBus.gain.setValueAtTime(musicBus.gain.value, now);
      musicBus.gain.exponentialRampToValueAtTime(0.0001, now + 0.12);
    } catch (e) {}
    var nodes = musicNodes.slice();
    for (var i = 0; i < nodes.length; i++) {
      try { nodes[i].stop(now + 0.14); } catch (e) {}
    }
  }

  /* ---- mute ----------------------------------------------------------- */
  function setMuted(m) {
    muted = !!m;
    MB.Audio.muted = muted;
    if (master && ctx) {
      try {
        var now = ctx.currentTime;
        master.gain.cancelScheduledValues(now);
        master.gain.setValueAtTime(master.gain.value, now);
        master.gain.linearRampToValueAtTime(muted ? 0 : MASTER_VOL, now + 0.05);
      } catch (e) {}
    }
  }

  /* ---- public surface (all guarded so nothing ever throws) ------------ */
  MB.Audio = {
    init: function () { try { init(); } catch (e) {} },
    sfx: function (name) { try { sfx(name); } catch (e) {} },
    startMusic: function () { try { startMusic(); } catch (e) {} },
    stopMusic: function () { try { stopMusic(); } catch (e) {} },
    setMuted: function (m) { try { setMuted(m); } catch (e) {} },
    muted: false,
  };

})(window.MB = window.MB || {});
