/* Platform layer. Talks to the YouTube Playables SDK when the game runs inside Playables
   (window.ytgame.IN_PLAYABLES_ENV) and falls back to the plain browser everywhere else.
   - settings and best score are kept with ytgame.game.saveData / loadData (browser: localStorage)
   - pause / resume and the YouTube mute button are forwarded to the game
   - firstFrameReady is sent while the loading screen is up, gameReady once the menu is usable */
(function (CR) {
  'use strict';
  const yt = window.ytgame;
  const IN = !!(yt && yt.IN_PLAYABLES_ENV);
  const P = CR.platform = {
    inPlayables: IN, data: {}, paused: false, audioOn: true,
    onPause: null, onResume: null, onAudio: null
  };
  const safe = (fn) => { try { return fn(); } catch (e) { return undefined; } };
  let canSave = !IN, dirty = false, saveTimer = 0;

  P.get = (k, d) => (Object.prototype.hasOwnProperty.call(P.data, k) ? P.data[k] : d);
  P.set = (k, v) => { if (P.data[k] === v) return; P.data[k] = v; dirty = true; clearTimeout(saveTimer); saveTimer = setTimeout(save, 1200); };
  function save() {
    if (!dirty || !canSave) return;
    dirty = false;
    const text = JSON.stringify(P.data);
    if (IN) safe(() => { const r = yt.game.saveData(text); if (r && r.catch) r.catch(() => { dirty = true; }); });
    else safe(() => localStorage.setItem('cr_data', text));
  }
  P.flush = save;

  P.loaded = new Promise((resolve) => {
    if (!IN) {
      safe(() => { P.data = JSON.parse(localStorage.getItem('cr_data') || '{}') || {}; });
      resolve(); return;
    }
    safe(() => {
      P.audioOn = !!yt.system.isAudioEnabled();
      yt.system.onAudioEnabledChange((on) => { P.audioOn = !!on; if (P.onAudio) P.onAudio(P.audioOn); });
      yt.system.onPause(() => { P.paused = true; save(); if (P.onPause) P.onPause(); });
      yt.system.onResume(() => { P.paused = false; if (P.onResume) P.onResume(); });
    });
    let opened = false;
    const open = () => { if (!opened) { opened = true; resolve(); } };
    setTimeout(open, 4000);                       // never leave the player on the loading screen
    let r;
    try { r = yt.game.loadData(); } catch (e) { r = null; }
    if (r && r.then) {
      r.then((text) => { try { P.data = text ? (JSON.parse(text) || {}) : {}; } catch (e) { P.data = {}; } canSave = true; open(); })
       .catch(() => { canSave = true; open(); });  // saveData is only allowed after loadData has settled
    } else { canSave = true; open(); }
  });

  P.firstFrameReady = () => { if (IN) safe(() => yt.game.firstFrameReady()); };
  P.gameReady = () => { if (IN) safe(() => yt.game.gameReady()); };
  P.sendScore = (value) => { if (IN) safe(() => yt.engagement.sendScore({ value: Math.round(value) })); };

  // the loading screen is already on screen: tell YouTube the first frame can be shown
  requestAnimationFrame(() => P.firstFrameReady());
})(window.CR = window.CR || {});
