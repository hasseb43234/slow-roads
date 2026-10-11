/* Procedural audio: engine (per car), wind, rain, tyre squeal, thunder, impacts. */
(function (CR) {
  'use strict';
  let ctx = null, master = null, muted = false, N = null, noiseBuf = null;

  function makeNoise(c) {
    const len = c.sampleRate * 2, buf = c.createBuffer(1, len, c.sampleRate), ch = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) { last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02; ch[i] = last * 3.5; }
    return buf;
  }
  function makeWhite(c) {
    const len = c.sampleRate * 2, buf = c.createBuffer(1, len, c.sampleRate), ch = buf.getChannelData(0);
    for (let i = 0; i < len; i++) ch[i] = Math.random() * 2 - 1;
    return buf;
  }
  function loopSrc(buf, rate) { const s = ctx.createBufferSource(); s.buffer = buf; s.loop = true; if (rate) s.playbackRate.value = rate; s.start(); return s; }

  const A = {};
  A.init = function () {
    if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
    ctx = new AC();
    master = ctx.createGain(); master.gain.value = muted ? 0 : 0.6; master.connect(ctx.destination);
    const brown = makeNoise(ctx), white = makeWhite(ctx); noiseBuf = { brown, white };
    N = {};
    // engine
    N.o1 = ctx.createOscillator(); N.o1.type = 'sawtooth';
    N.o2 = ctx.createOscillator(); N.o2.type = 'triangle';
    N.o3 = ctx.createOscillator(); N.o3.type = 'sine';
    N.lp = ctx.createBiquadFilter(); N.lp.type = 'lowpass'; N.lp.frequency.value = 300; N.lp.Q.value = 1.1;
    N.eg = ctx.createGain(); N.eg.gain.value = 0;
    N.wg = ctx.createGain(); N.wg.gain.value = 0;
    N.o1.connect(N.lp); N.o2.connect(N.lp); N.lp.connect(N.eg); N.eg.connect(master);
    N.o3.connect(N.wg); N.wg.connect(master);
    N.o1.start(); N.o2.start(); N.o3.start();
    // wind
    N.wind = ctx.createGain(); N.wind.gain.value = 0;
    N.windBp = ctx.createBiquadFilter(); N.windBp.type = 'bandpass'; N.windBp.frequency.value = 500; N.windBp.Q.value = 0.4;
    loopSrc(brown).connect(N.windBp); N.windBp.connect(N.wind); N.wind.connect(master);
    // rain
    N.rain = ctx.createGain(); N.rain.gain.value = 0;
    const rhp = ctx.createBiquadFilter(); rhp.type = 'highpass'; rhp.frequency.value = 1800;
    const rlp = ctx.createBiquadFilter(); rlp.type = 'lowpass'; rlp.frequency.value = 9000;
    loopSrc(white, 1).connect(rhp); rhp.connect(rlp); rlp.connect(N.rain); N.rain.connect(master);
    // squeal
    N.sq = ctx.createBiquadFilter(); N.sq.type = 'bandpass'; N.sq.frequency.value = 1400; N.sq.Q.value = 7;
    N.sg = ctx.createGain(); N.sg.gain.value = 0;
    loopSrc(brown, 3).connect(N.sq); N.sq.connect(N.sg); N.sg.connect(master);
  };
  A.setMuted = function (m) { muted = m; if (master) master.gain.value = m ? 0 : 0.6; };
  A.isMuted = () => muted;

  A.update = function (s) {
    if (!ctx || !N) return;
    const t = ctx.currentTime, v = Math.abs(s.v), e = s.engine;
    const f = e.base + v * e.ratio + (s.revving ? 10 : 0);
    N.o1.frequency.setTargetAtTime(f, t, 0.06); N.o2.frequency.setTargetAtTime(f * 2.01, t, 0.06);
    N.o3.frequency.setTargetAtTime(500 + v * 14, t, 0.08);
    N.lp.frequency.setTargetAtTime((170 + v * 16 + s.thr * 240) * e.lp, t, 0.1);
    N.eg.gain.setTargetAtTime((0.03 + 0.035 * s.thr) * (e.gain / 0.06) * (s.air ? 0.6 : 1), t, 0.12);
    N.wg.gain.setTargetAtTime(e.whine ? Math.min(0.022, v / 90 * 0.02) * (0.4 + s.thr) : 0, t, 0.1);
    N.wind.gain.setTargetAtTime(Math.min(0.55, (0.02 + v / 70 * 0.5)) * s.wind, t, 0.25);
    N.windBp.frequency.setTargetAtTime(380 + v * 18, t, 0.25);
    N.rain.gain.setTargetAtTime(s.rain * 0.22, t, 0.5);
    N.sg.gain.setTargetAtTime(Math.min(0.5, s.skid * 0.5) * (v > 3 ? 1 : 0), t, 0.05);
    N.sq.frequency.setTargetAtTime(1100 + Math.abs(s.slip) * 700 + v * 12, t, 0.08);
  };
  function burst(opts) {
    if (!ctx || !noiseBuf) return;
    const src = ctx.createBufferSource(); src.buffer = opts.white ? noiseBuf.white : noiseBuf.brown;
    const f = ctx.createBiquadFilter(); f.type = opts.type || 'lowpass'; f.frequency.value = opts.freq;
    if (opts.sweep) f.frequency.exponentialRampToValueAtTime(opts.sweep, ctx.currentTime + opts.dur);
    const g = ctx.createGain(), t0 = ctx.currentTime + (opts.delay || 0);
    g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(opts.gain, t0 + (opts.attack || 0.01));
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + opts.dur);
    src.connect(f); f.connect(g); g.connect(master); src.start(t0, Math.random()); src.stop(t0 + opts.dur + 0.1);
  }
  A.thunder = (delay) => { burst({ freq: 420, sweep: 80, dur: 3.2, gain: 1.2, attack: 0.25, delay }); burst({ freq: 180, dur: 2.0, gain: 0.7, attack: 0.1, delay: delay + 0.3 }); };
  A.thud = (k) => burst({ freq: 260, dur: 0.35, gain: Math.min(1.1, 0.25 + k * 0.08) });
  A.land = (k) => { burst({ freq: 220, dur: 0.45, gain: Math.min(1.2, 0.3 + k * 0.05) }); burst({ freq: 3000, type: 'highpass', white: true, dur: 0.2, gain: 0.12 }); };
  A.boost = () => burst({ freq: 400, sweep: 3200, type: 'bandpass', white: true, dur: 0.7, gain: 0.35, attack: 0.15 });
  A.cone = () => burst({ freq: 900, dur: 0.12, gain: 0.25, white: true, type: 'bandpass' });
  A.whoosh = () => burst({ freq: 600, sweep: 200, type: 'bandpass', white: true, dur: 0.5, gain: 0.15, attack: 0.2 });
  /* ================================================================== generative music */
  const F = (m) => 440 * Math.pow(2, (m - 69) / 12);
  const pick = (a) => a[Math.floor(Math.random() * a.length)];
  let musicGain = null, reverbIn = null, musicVol = 0.5;
  let cur = null, selId = 'auto', sceneForAuto = 'sunny', mine = { files: [], idx: 0, el: null, node: null };

  A.stations = [
    { id: 'auto', name: 'Auto', sub: 'matches the weather' },
    { id: 'highway', name: 'Open Highway', sub: 'bright road-trip groove' },
    { id: 'lofi', name: 'Sunrise Lo-fi', sub: 'dusty chill beats' },
    { id: 'synth', name: 'Night Drive', sub: 'neon synthwave' },
    { id: 'ambient', name: 'Calm Horizon', sub: 'slow ambient pads' },
    { id: 'piano', name: 'Piano Rain', sub: 'soft piano, gentle reverb' },
    { id: 'mine', name: 'My Music', sub: 'play your own files' },
    { id: 'off', name: 'Off', sub: 'engine and nature only' }
  ];
  const AUTO_MAP = { sunny: 'highway', norway: 'ambient', rain: 'piano', snow: 'lofi' };
  const ROTATION = ['highway', 'lofi', 'synth', 'ambient', 'piano'];

  function ensureMusic() {
    A.init();
    if (!ctx || musicGain) return !!ctx;
    musicGain = ctx.createGain(); musicGain.gain.value = musicVol; musicGain.connect(master);
    const len = Math.floor(ctx.sampleRate * 2.8), buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) { const d = buf.getChannelData(c); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.4); }
    const conv = ctx.createConvolver(); conv.buffer = buf;
    reverbIn = ctx.createGain(); reverbIn.gain.value = 1;
    const out = ctx.createGain(); out.gain.value = 0.55;
    reverbIn.connect(conv); conv.connect(out); out.connect(musicGain);
    return true;
  }

  /* one voice: attack -> hold -> release, optional lowpass and reverb send */
  function tone(bus, o) {
    const t = o.t, osc = ctx.createOscillator(); osc.type = o.type || 'sine';
    osc.frequency.setValueAtTime(o.f, t); if (o.detune) osc.detune.value = o.detune;
    const g = ctx.createGain(), a = o.a || 0.01, hold = o.hold || 0, rel = o.rel || 0.3, peak = Math.max(0.0002, o.g || 0.1);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(peak, t + a);
    if (hold > 0) g.gain.setValueAtTime(peak, t + a + hold);
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + hold + rel);
    if (o.lp) { const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = o.lp; f.Q.value = o.q || 0.7; osc.connect(f); f.connect(g); } else osc.connect(g);
    g.connect(bus);
    if (o.send) { const s = ctx.createGain(); s.gain.value = o.send; g.connect(s); s.connect(reverbIn); }
    if (o.echo) g.connect(o.echo);
    osc.start(t); osc.stop(t + a + hold + rel + 0.05);
  }
  function noiseHit(bus, t, o) {
    const src = ctx.createBufferSource(); src.buffer = noiseBuf.white;
    const f = ctx.createBiquadFilter(); f.type = o.type; f.frequency.value = o.freq; f.Q.value = o.q || 0.8;
    const g = ctx.createGain(); g.gain.setValueAtTime(o.g, t); g.gain.exponentialRampToValueAtTime(0.0001, t + o.d);
    src.connect(f); f.connect(g); g.connect(bus);
    if (o.send) { const s = ctx.createGain(); s.gain.value = o.send; g.connect(s); s.connect(reverbIn); }
    src.start(t, Math.random()); src.stop(t + o.d + 0.05);
  }
  function makeKit(bus, stepDur, echo) {
    const M = { stepDur, echo };
    M.tone = (o) => tone(bus, Object.assign({ echo }, o));
    M.kick = (t, v) => {
      const osc = ctx.createOscillator(), g = ctx.createGain();
      osc.frequency.setValueAtTime(150, t); osc.frequency.exponentialRampToValueAtTime(42, t + 0.14);
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.9 * v, t + 0.004); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
      osc.connect(g); g.connect(bus); osc.start(t); osc.stop(t + 0.32);
    };
    M.snare = (t, v) => { noiseHit(bus, t, { type: 'bandpass', freq: 1900, q: 0.9, g: 0.55 * v, d: 0.16, send: 0.25 }); tone(bus, { t, f: 190, type: 'triangle', g: 0.22 * v, a: 0.002, rel: 0.1 }); };
    M.clap = (t, v) => { for (let k = 0; k < 3; k++) noiseHit(bus, t + k * 0.011, { type: 'bandpass', freq: 1300, q: 1.1, g: 0.3 * v, d: 0.09 + k * 0.03, send: 0.3 }); };
    M.hat = (t, v, open) => noiseHit(bus, t, { type: 'highpass', freq: 7200, q: 0.5, g: v, d: open ? 0.2 : 0.04 });
    M.crackle = (t) => noiseHit(bus, t, { type: 'highpass', freq: 3000, q: 0.5, g: 0.05 + Math.random() * 0.06, d: 0.012 });
    M.rhodes = (f, t, dur, g) => { M.tone({ t, f, type: 'sine', g, a: 0.008, hold: 0, rel: dur, lp: 2400, send: 0.28 }); M.tone({ t, f: f * 2.005, type: 'sine', g: g * 0.3, a: 0.004, rel: dur * 0.35, send: 0.2 }); };
    M.bell = (f, t, g, dec) => { M.tone({ t, f, type: 'sine', g, a: 0.004, rel: dec || 1.6, send: 0.55 }); M.tone({ t, f: f * 3.01, type: 'sine', g: g * 0.12, a: 0.003, rel: (dec || 1.6) * 0.5, send: 0.4 }); };
    M.pad = (f, t, dur, g, lp) => { for (const d of [-10, 0, 10]) M.tone({ t, f, type: 'sawtooth', detune: d, g: g / 3, a: 0.5, hold: Math.max(0.1, dur - 0.6), rel: 1.0, lp: lp || 1300, send: 0.3 }); };
    M.softPad = (f, t, dur, g) => { for (const d of [-7, 7]) { M.tone({ t, f, type: 'triangle', detune: d, g: g / 2, a: 2.6, hold: Math.max(0.1, dur - 2.5), rel: 3.2, lp: 900, send: 0.6 }); } M.tone({ t, f: f / 2, type: 'sine', g: g * 0.7, a: 2.6, hold: Math.max(0.1, dur - 2.5), rel: 3.2 }); };
    M.piano = (f, t, g) => { M.tone({ t, f, type: 'sine', g, a: 0.004, rel: 2.0, lp: 3600, send: 0.42 }); M.tone({ t, f: f * 2, type: 'triangle', g: g * 0.3, a: 0.003, rel: 0.9, lp: 3000, send: 0.3 }); M.tone({ t, f: f * 3.01, type: 'sine', g: g * 0.08, a: 0.002, rel: 0.4 }); };
    M.pluck = (f, t, g, dec) => M.tone({ t, f, type: 'sawtooth', g, a: 0.003, rel: dec || 0.32, lp: 2800, send: 0.2 });
    return M;
  }

  /* ---- station definitions (bpm, swing, step callback called once per 16th note) */
  const LOFI_CH = [[48, 55, 59, 64], [45, 52, 55, 60], [50, 57, 60, 65], [43, 50, 53, 59]];
  const SYNTH_CH = [[57, 60, 64], [53, 57, 60], [48, 52, 55], [55, 59, 62]];
  const AMB_CH = [[50, 57, 62, 64], [47, 54, 59, 62], [43, 50, 55, 62], [45, 52, 57, 64]];
  const HWY_CH = [[55, 59, 62, 67], [50, 57, 62, 66], [52, 55, 59, 64], [48, 55, 60, 64]];
  const HWY_ROOT = [43, 38, 40, 36];
  const PIANO_CH = [[45, 52, 57, 60, 64], [41, 48, 53, 57, 60], [48, 55, 60, 64, 67], [43, 50, 55, 59, 62]];
  const PIANO_ARP = [0, 2, 3, 4, 3, 2, 3, 1];

  const STATIONS = {
    lofi: {
      bpm: 76, swing: 0.28, echoTime: 3, echoFb: 0.34,
      on(step, t, M) {
        const b = Math.floor(step / 16) % 4, s = step % 16, ch = LOFI_CH[b];
        if (s === 0 || s === 10) ch.forEach((n, i) => M.rhodes(F(n + 12), t + i * 0.013, s === 0 ? 2.2 : 0.8, s === 0 ? 0.07 : 0.05));
        if (s === 0) M.tone({ t, f: F(ch[0] - 12), type: 'sine', g: 0.3, a: 0.012, hold: M.stepDur * 3, rel: 0.5, lp: 320 });
        if (s === 11) M.tone({ t, f: F(ch[0] - 12), type: 'sine', g: 0.16, a: 0.01, hold: 0, rel: 0.25, lp: 300 });
        if (s === 0 || s === 7 || s === 10) M.kick(t, s === 0 ? 0.75 : 0.5);
        if (s === 4 || s === 12) M.snare(t, 0.3);
        if (s % 2 === 0) M.hat(t, (s % 4 === 2 ? 0.1 : 0.06) * (0.8 + Math.random() * 0.4), false);
        if (s % 4 === 0 && Math.random() < 0.42) M.bell(F(pick([72, 74, 76, 79, 81, 84])), t + (Math.random() < 0.5 ? M.stepDur : 0), 0.05, 1.5);
        if (Math.random() < 0.05) M.crackle(t);
      }
    },
    synth: {
      bpm: 100, swing: 0, echoTime: 3, echoFb: 0.3,
      on(step, t, M) {
        const b = Math.floor(step / 16) % 4, s = step % 16, ch = SYNTH_CH[b];
        if (s === 0) ch.forEach((n) => M.pad(F(n + 12), t, M.stepDur * 16, 0.07, 1500));
        if (s % 2 === 0) M.tone({ t, f: F(ch[0] - 24), type: 'sawtooth', g: 0.14, a: 0.004, hold: M.stepDur * 0.9, rel: 0.1, lp: 420 + (s % 8 === 0 ? 220 : 0) });
        const arp = [0, 1, 2, 1, 0, 2, 1, 2][s % 8], oct = s % 8 > 3 ? 24 : 12;
        M.tone({ t, f: F(ch[arp] + oct), type: 'square', g: 0.04, a: 0.003, rel: 0.14, lp: 2400, send: 0.2 });
        if (s % 4 === 0) M.kick(t, 0.85);
        if (s === 4 || s === 12) { M.snare(t, 0.4); M.clap(t, 0.5); }
        if (s % 4 === 2) M.hat(t, 0.08, true); else if (s % 2 === 1) M.hat(t, 0.035, false);
        if (b === 3 && s === 8) M.tone({ t, f: F(79), type: 'sawtooth', g: 0.05, a: 0.02, hold: M.stepDur * 6, rel: 0.5, lp: 2600, send: 0.45 });
      }
    },
    ambient: {
      bpm: 60, swing: 0, echoTime: 6, echoFb: 0.45,
      on(step, t, M) {
        const b = Math.floor(step / 32) % 4, s = step % 32, ch = AMB_CH[b];
        if (s === 0) { ch.forEach((n, i) => M.softPad(F(n + (i === 0 ? 0 : 12)), t + i * 0.2, M.stepDur * 32, 0.085)); M.tone({ t, f: F(ch[0] - 12), type: 'sine', g: 0.1, a: 3, hold: 4.5, rel: 3.5 }); }
        if (Math.random() < 0.07) M.bell(F(pick([74, 76, 78, 81, 83, 86, 88])), t, 0.04 + Math.random() * 0.03, 3.4);
      }
    },
    highway: {
      bpm: 116, swing: 0.08, echoTime: 3, echoFb: 0.22,
      on(step, t, M) {
        const b = Math.floor(step / 16) % 4, s = step % 16, ch = HWY_CH[b];
        if ([0, 3, 6, 8, 11, 14].includes(s)) {
          const down = s % 6 !== 3 && s !== 11;
          const order = down ? ch : ch.slice().reverse();
          order.forEach((n, i) => M.pluck(F(n + (s === 0 ? 0 : 12)), t + i * 0.012, s === 0 ? 0.075 : 0.055, 0.3));
        }
        if (s === 0 || s === 8) M.tone({ t, f: F(HWY_ROOT[b] + (s === 8 ? 7 : 0)), type: 'sawtooth', g: 0.17, a: 0.005, hold: M.stepDur * 1.2, rel: 0.12, lp: 460 });
        if (s === 6 || s === 14) M.tone({ t, f: F(HWY_ROOT[b] + 12), type: 'sawtooth', g: 0.09, a: 0.005, rel: 0.12, lp: 520 });
        if (s === 0 || s === 8 || s === 10) M.kick(t, s === 10 ? 0.55 : 0.8);
        if (s === 4 || s === 12) { M.snare(t, 0.45); M.clap(t, 0.4); }
        if (s % 2 === 0) M.hat(t, 0.06 + (s % 4 === 2 ? 0.03 : 0), false);
        if (Math.floor(step / 16) % 2 === 1) {
          const hook = { 0: 79, 3: 83, 6: 81, 8: 79, 12: 76 }[s];
          if (hook) M.tone({ t, f: F(hook + (b === 3 ? -5 : 0)), type: 'square', g: 0.04, a: 0.01, rel: 0.28, lp: 2300, send: 0.3 });
        }
      }
    },
    piano: {
      bpm: 66, swing: 0, echoTime: 6, echoFb: 0.3,
      on(step, t, M) {
        const b = Math.floor(step / 32) % 4, s = step % 32, ch = PIANO_CH[b];
        if (s === 0) { M.softPad(F(ch[0] + 12), t, M.stepDur * 32, 0.06); M.piano(F(ch[0] - 12), t, 0.3); }
        if (s % 2 === 0) { const n = ch[PIANO_ARP[(s / 2) % 8] % ch.length]; M.piano(F(n + (s % 8 === 0 ? 12 : 12)), t + (Math.random() - 0.5) * 0.01, 0.17 * (0.75 + Math.random() * 0.4)); }
        if ((s === 12 || s === 28) && Math.random() < 0.7) M.piano(F(pick([81, 84, 88, 91])), t + M.stepDur * 0.5, 0.13);
      }
    }
  };

  function startStation(id) {
    const def = STATIONS[id]; if (!def || !ensureMusic()) return null;
    const bus = ctx.createGain(); bus.gain.value = 0.0001; bus.connect(musicGain);
    const stepDur = 60 / def.bpm / 4;
    // tempo-synced echo for this station only
    const echo = ctx.createDelay(4); echo.delayTime.value = stepDur * def.echoTime;
    const fb = ctx.createGain(); fb.gain.value = def.echoFb; const elp = ctx.createBiquadFilter(); elp.type = 'lowpass'; elp.frequency.value = 2400;
    const eo = ctx.createGain(); eo.gain.value = 0.22;
    echo.connect(elp); elp.connect(fb); fb.connect(echo); elp.connect(eo); eo.connect(bus);
    const M = makeKit(bus, stepDur, echo);
    const st = { id, bus, echo, step: 0, next: ctx.currentTime + 0.12, alive: true, timer: 0 };
    const tick = () => {
      if (!st.alive) return;
      while (st.next < ctx.currentTime + 0.2) {
        const sw = (st.step % 2 === 1) ? def.swing * stepDur : 0;
        def.on(st.step, st.next + sw, M);
        st.step++; st.next += stepDur;
      }
    };
    st.timer = setInterval(tick, 40); tick();
    bus.gain.setTargetAtTime(1, ctx.currentTime, 0.7);
    st.stop = () => {
      st.alive = false; clearInterval(st.timer);
      bus.gain.setTargetAtTime(0, ctx.currentTime, 0.35);
      setTimeout(() => { try { bus.disconnect(); echo.disconnect(); } catch (e) { /* already gone */ } }, 2500);
    };
    return st;
  }
  function stopCurrent() {
    if (cur) { if (cur.stop) cur.stop(); cur = null; }
    if (mine.el) { mine.el.pause(); if (mine.node) { try { mine.node.disconnect(); } catch (e) { /* ok */ } } mine.el = null; mine.node = null; }
  }
  function playMine() {
    if (!mine.files.length) { if (A.onNeedFiles) A.onNeedFiles(); return null; }
    if (!ensureMusic()) return null;
    const f = mine.files[mine.idx % mine.files.length];
    const el = new Audio(); el.src = f.url; el.loop = mine.files.length === 1;
    const node = ctx.createMediaElementSource(el);
    const bus = ctx.createGain(); bus.gain.value = 1; node.connect(bus); bus.connect(musicGain);
    el.addEventListener('ended', () => { mine.idx++; if (selId === 'mine') { stopCurrent(); cur = playMine(); notify(); } });
    el.play().catch(() => {});
    mine.el = el; mine.node = node;
    return { id: 'mine', title: f.name, stop() { el.pause(); try { bus.disconnect(); } catch (e) { /* ok */ } } };
  }
  function resolved() { return selId === 'auto' ? (AUTO_MAP[sceneForAuto] || 'highway') : selId; }
  function notify() { if (A.onMusicChange) A.onMusicChange(A.musicLabel()); }
  function applySelection() {
    stopCurrent();
    const id = resolved();
    if (id === 'off') { notify(); return; }
    if (id === 'mine') cur = playMine(); else cur = startStation(id);
    notify();
  }
  A.musicLabel = () => {
    const id = resolved();
    if (id === 'off') return 'Music off';
    if (id === 'mine') return cur && cur.title ? cur.title : 'My Music';
    const s = A.stations.find((x) => x.id === id); return s ? s.name : '';
  };
  A.musicSelected = () => selId;
  A.musicSelect = (id) => { selId = id; if (!ensureMusic()) return; applySelection(); };
  A.musicSceneChanged = (sceneId) => { sceneForAuto = sceneId; if (selId === 'auto' && musicGain) applySelection(); };
  A.musicNext = () => {
    if (!ensureMusic()) return;
    if (resolved() === 'mine' && mine.files.length > 1) { mine.idx++; applySelection(); return; }
    const order = mine.files.length ? ROTATION.concat('mine') : ROTATION;
    const i = order.indexOf(resolved());
    selId = order[(i + 1) % order.length]; applySelection();
  };
  A.setMusicVolume = (v) => { musicVol = v; if (musicGain) musicGain.gain.setTargetAtTime(v, ctx.currentTime, 0.05); };
  A.musicVolume = () => musicVol;
  A.musicLoadFiles = (list) => {
    mine.files = Array.from(list).filter((f) => /audio|ogg|mp3|wav|m4a/i.test(f.type + f.name)).map((f) => ({ name: f.name.replace(/\.[^.]+$/, ''), url: URL.createObjectURL(f) }));
    mine.idx = 0;
    selId = 'mine'; if (ensureMusic()) applySelection();
    return mine.files.length;
  };
  A._dbg = () => ({ ctx, master, musicGain, cur });
  A.musicResume = () => { if (musicGain && !cur && resolved() !== 'off') applySelection(); };

  CR.Audio = A;
})(window.CR = window.CR || {});
