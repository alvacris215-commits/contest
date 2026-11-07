'use strict';

/** All sounds are synthesised with WebAudio, so no audio files and no internet are needed. */
const Sound = (() => {
  let ac = null, master = null, echo = null, enabled = true;

  function ctx() {
    if (!ac) {
      ac = new (window.AudioContext || window.webkitAudioContext)();
      master = ac.createGain();
      master.gain.value = 0.55;
      master.connect(ac.destination);
      // small echo for a magical shimmer
      echo = ac.createDelay(1);
      echo.delayTime.value = 0.17;
      const fb = ac.createGain(); fb.gain.value = 0.38;
      const wet = ac.createGain(); wet.gain.value = 0.5;
      echo.connect(fb); fb.connect(echo); echo.connect(wet); wet.connect(master);
    }
    if (ac.state === 'suspended') ac.resume();
    return ac;
  }

  function tone({ f = 440, f2 = null, type = 'sine', t = 0, dur = 0.2, vol = 0.2, attack = 0.005, wet = false }) {
    if (!enabled) return;
    const a = ctx();
    const o = a.createOscillator(), g = a.createGain();
    const st = a.currentTime + t;
    o.type = type;
    o.frequency.setValueAtTime(f, st);
    if (f2) o.frequency.exponentialRampToValueAtTime(f2, st + dur);
    g.gain.setValueAtTime(0.0001, st);
    g.gain.exponentialRampToValueAtTime(vol, st + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, st + dur);
    o.connect(g); g.connect(master);
    if (wet) g.connect(echo);
    o.start(st); o.stop(st + dur + 0.05);
  }

  function noise({ dur = 0.5, t = 0, vol = 0.2, f1 = 400, f2 = 4000, q = 1.2, peak = 0.6 }) {
    if (!enabled) return;
    const a = ctx();
    const len = Math.floor(a.sampleRate * dur);
    const buf = a.createBuffer(1, len, a.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    const src = a.createBufferSource(); src.buffer = buf;
    const bp = a.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = q;
    const st = a.currentTime + t;
    bp.frequency.setValueAtTime(f1, st);
    bp.frequency.exponentialRampToValueAtTime(f2, st + dur);
    const g = a.createGain();
    g.gain.setValueAtTime(0.0001, st);
    g.gain.exponentialRampToValueAtTime(vol, st + dur * peak);
    g.gain.exponentialRampToValueAtTime(0.0001, st + dur);
    src.connect(bp); bp.connect(g); g.connect(master);
    src.start(st); src.stop(st + dur + 0.05);
  }

  const S = {
    setEnabled(v) { enabled = !!v; },
    get enabled() { return enabled; },
    unlock() { try { ctx(); } catch (e) { /* no audio */ } },
    tick() { tone({ f: 1500 + Math.random() * 500, type: 'square', dur: 0.025, vol: 0.035 }); },
    softTick() { tone({ f: 900 + Math.random() * 200, type: 'triangle', dur: 0.04, vol: 0.07 }); },
    lock() {
      tone({ f: 880, type: 'sine', dur: 0.25, vol: 0.2, wet: true });
      tone({ f: 1320, type: 'sine', t: 0.1, dur: 0.4, vol: 0.18, wet: true });
    },
    whoosh() { noise({ dur: 0.7, vol: 0.18, f1: 200, f2: 3000 }); },
    rise() {
      noise({ dur: 0.75, vol: 0.25, f1: 300, f2: 7000, peak: 0.9 });
      tone({ f: 160, f2: 1300, type: 'sawtooth', dur: 0.7, vol: 0.045, attack: 0.3 });
      tone({ f: 320, f2: 2000, type: 'sine', dur: 0.7, vol: 0.08, attack: 0.3 });
    },
    /** Twinkling shimmer that swells for about 1.7 s (the title sparks gathering). */
    magic() {
      for (let i = 0; i < 24; i++)
        tone({ f: 1400 + Math.random() * 2800, type: 'triangle', t: i * 0.07, dur: 0.32, vol: 0.022 + i * 0.0012, wet: true });
      tone({ f: 220, f2: 880, type: 'sine', dur: 1.8, vol: 0.07, attack: 1.2, wet: true });
      tone({ f: 330, f2: 1320, type: 'triangle', dur: 1.8, vol: 0.03, attack: 1.2, wet: true });
    },
    boom() {
      tone({ f: 150, f2: 35, type: 'sine', dur: 1.1, vol: 0.7 });
      noise({ dur: 0.6, vol: 0.3, f1: 3000, f2: 150, peak: 0.05 });
    },
    chime() {
      [523.25, 659.25, 783.99, 1046.5, 1318.5, 1568].forEach((f, i) =>
        tone({ f, type: 'sine', t: i * 0.075, dur: 1.6, vol: 0.13, wet: true }));
      for (let i = 0; i < 8; i++)
        tone({ f: 2200 + Math.random() * 2400, type: 'triangle', t: 0.3 + i * 0.06, dur: 0.35, vol: 0.035, wet: true });
    },
    fanfare() {
      [[523.25, 0], [659.25, 0.13], [783.99, 0.26], [1046.5, 0.39]].forEach(([f, t]) => {
        tone({ f, type: 'triangle', t, dur: t === 0.39 ? 1.3 : 0.25, vol: 0.16, wet: true });
        tone({ f: f / 2, type: 'sawtooth', t, dur: t === 0.39 ? 1.1 : 0.2, vol: 0.03 });
      });
    },
    start() {
      tone({ f: 523.25, type: 'triangle', dur: 0.18, vol: 0.18 });
      tone({ f: 783.99, type: 'triangle', t: 0.14, dur: 0.4, vol: 0.18, wet: true });
    },
    beep(last) { tone({ f: last ? 1320 : 880, type: 'square', dur: 0.14, vol: 0.09 }); },
    gong() {
      [98, 196.6, 294.5, 395, 523].forEach((f, i) =>
        tone({ f, type: 'sine', dur: 3 - i * 0.3, vol: 0.32 / (i + 1), attack: 0.01, wet: i > 1 }));
      noise({ dur: 0.4, vol: 0.12, f1: 1500, f2: 300, peak: 0.05 });
    },
  };
  return S;
})();
