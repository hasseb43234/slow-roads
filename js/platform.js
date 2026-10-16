/* Platform layer. One interface, three backends:
     yt   YouTube Playables SDK  (window.ytgame.IN_PLAYABLES_ENV)
     pg   Playgama Bridge SDK    (window.bridge, loaded by the Playgama build's index.html)
     web  plain browser          (localStorage, page visibility)
   The game only talks to CR.platform: settings storage, ready signals, pause/resume, audio on/off, score. */
(function (CR) {
  'use strict';
  const yt = window.ytgame;
  const IN = !!(yt && yt.IN_PLAYABLES_ENV);
  const pg = !IN && window.bridge && typeof window.bridge.initialize === 'function' ? window.bridge : null;
  const P = CR.platform = {
    kind: IN ? 'yt' : pg ? 'pg' : 'web',
    inPlayables: IN,                        // YouTube Playables only (drives the YouTube-specific UI rules)
    data: {}, paused: false, audioOn: true,
    onPause: null, onResume: null, onAudio: null
  };
  P.bridge = pg;                              // exposed for tests
  const safe = (fn) => { try { return fn(); } catch (e) { P.lastError = String(e); return undefined; } };
  let canSave = P.kind === 'web', dirty = false, saveTimer = 0, useLocal = true;

  /* ---------------------------------------------------------------- settings storage */
  P.get = (k, d) => (Object.prototype.hasOwnProperty.call(P.data, k) ? P.data[k] : d);
  P.set = (k, v) => { if (P.data[k] === v) return; P.data[k] = v; dirty = true; clearTimeout(saveTimer); saveTimer = setTimeout(save, 1200); };
  function save() {
    if (!dirty || !canSave) return;
    dirty = false;
    const text = JSON.stringify(P.data);
    if (IN) safe(() => { const r = yt.game.saveData(text); if (r && r.catch) r.catch(() => { dirty = true; }); });
    else if (pg && !useLocal) safe(() => { const r = pg.storage.set(['cr_data'], [text]); if (r && r.catch) r.catch(() => { dirty = true; }); });
    else safe(() => localStorage.setItem('cr_data', text));
  }
  P.flush = save;
  const readLocal = () => { try { return JSON.parse(localStorage.getItem('cr_data') || '{}') || {}; } catch (e) { return {}; } };
  const parse = (t) => { try { return t ? (JSON.parse(t) || {}) : {}; } catch (e) { return {}; } };

  /* ---------------------------------------------------------------- load + wire events */
  P.loaded = new Promise((resolve) => {
    let opened = false;
    const open = () => { if (!opened) { opened = true; resolve(); } };

    if (IN) {
      safe(() => {
        P.audioOn = !!yt.system.isAudioEnabled();
        yt.system.onAudioEnabledChange((on) => { P.audioOn = !!on; if (P.onAudio) P.onAudio(P.audioOn); });
        yt.system.onPause(() => { P.paused = true; save(); if (P.onPause) P.onPause(); });
        yt.system.onResume(() => { P.paused = false; if (P.onResume) P.onResume(); });
      });
      setTimeout(open, 4000);                     // never leave the player on the loading screen
      let r; try { r = yt.game.loadData(); } catch (e) { r = null; }
      if (r && r.then) r.then((t) => { P.data = parse(t); canSave = true; open(); }).catch(() => { canSave = true; open(); });
      else { canSave = true; open(); }
      return;
    }

    if (pg) {
      setTimeout(() => { if (!opened) { P.data = readLocal(); canSave = true; open(); } }, 5000);
      pg.initialize().then(() => {
        const mock = safe(() => pg.platform.id) === 'mock';      // not running on a real platform (local testing)
        useLocal = mock;
        safe(() => {
          P.audioOn = pg.platform.isAudioEnabled !== false;
          pg.platform.on(pg.EVENT_NAME.AUDIO_STATE_CHANGED, (on) => { P.audioOn = !!on; if (P.onAudio) P.onAudio(P.audioOn); });
          pg.platform.on(pg.EVENT_NAME.PAUSE_STATE_CHANGED, (isPaused) => {
            P.paused = !!isPaused;
            if (isPaused) { save(); if (P.onPause) P.onPause(); } else if (P.onResume) P.onResume();
          });
        });
        if (mock) { P.data = readLocal(); canSave = true; open(); return; }
        pg.storage.get(['cr_data'])
          .then((arr) => { P.data = parse(arr && arr[0]); canSave = true; open(); })
          .catch(() => { canSave = true; open(); });
      }).catch(() => { P.data = readLocal(); canSave = true; open(); });
      return;
    }

    P.data = readLocal(); open();
  });

  /* ---------------------------------------------------------------- ready signals, messages, score */
  P.firstFrameReady = () => { if (IN) safe(() => yt.game.firstFrameReady()); };
  P.gameReady = () => {
    if (IN) safe(() => yt.game.gameReady());
    else if (pg) safe(() => pg.platform.sendMessage('game_ready'));      // Playgama: first playable frame is on screen
  };
  P.message = (name) => { if (pg) safe(() => pg.platform.sendMessage(name)); };   // level_started / level_paused / level_resumed
  P.sendScore = (value) => { if (IN) safe(() => yt.engagement.sendScore({ value: Math.round(value) })); };

  // plain browser: stop sound and the loop when the tab is hidden (the platforms have their own pause events)
  if (P.kind === 'web') {
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) { P.paused = true; save(); if (P.onPause) P.onPause(); }
      else { P.paused = false; if (P.onResume) P.onResume(); }
    });
  }

  // the loading screen is already on screen: tell YouTube the first frame can be shown
  requestAnimationFrame(() => P.firstFrameReady());
})(window.CR = window.CR || {});
