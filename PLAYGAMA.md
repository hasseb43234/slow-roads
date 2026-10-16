# Calm Road on Playgama

Build the bundle:

```
python build-playables.py playgama
```

Upload `dist/calm-road-playgama.zip` (index.html at the zip root, 13 files, 0.22 MB). Engine: Plain JS.

## What differs from the YouTube build

- `index.html` loads the Playgama Bridge script (`https://bridge.playgama.com/v2/stable/playgama-bridge.js`) instead of the YouTube SDK. It is the only external request.
- `playgama-bridge-config.json` sits next to index.html. It is empty: no ads, payments or analytics.
- `js/platform.js` picks the backend by itself: YouTube SDK, Playgama Bridge, or plain browser.
  - Settings and best score: `bridge.storage` (one key, `cr_data`). On the Bridge mock platform (local testing) it falls back to localStorage.
  - Pause: `PAUSE_STATE_CHANGED` stops the loop, rendering and audio; resume restarts them.
  - Audio: `AUDIO_STATE_CHANGED` and `isAudioEnabled` mute or unmute the game.
  - `game_ready` is sent once the menu is usable. `level_started`, `level_paused` and `level_resumed` follow DRIVE, menu and RESUME.
- A visible sound button (top right) is shown in the Playgama build only. The M key does the same.
- One-handed play on touch screens: the AUTO button holds the gas (cruise control) while the thumb steers. Brake or handbrake switches it off.
- Fullscreen and landscape are requested on phones. The rotate prompt has a "Play in portrait anyway" button.

## Local test

`python -m http.server 8137 --directory dist/playgama`, open http://localhost:8137/. Bridge runs its mock platform there, so settings use localStorage.

## Text for the Playgama form

Reuse the title, description, how to play and cover images from `calm-road-playables-listing.md`, with these changes:

- Engine: Plain JS.
- Do not paste the YouTube reviewer notes. Use these instead:

> Plain JS and three.js r128 (MIT), all bundled. The only external request is the Playgama Bridge script. Bridge is initialised before the game starts, `game_ready` is sent when the menu is usable, settings and best score are saved with bridge.storage. PAUSE_STATE_CHANGED and AUDIO_STATE_CHANGED are handled (loop, rendering and sound stop and restart). A sound button is always visible. Touch controls are on screen and there is a one-handed AUTO gas button. No ads, no in-app purchases, no analytics, no external links. English only.

## Known gaps

- English only (Playgama asks for easy language selection when a game has several languages).
- No ads. Add them through `bridge.advertisement` if Playgama asks for them.
- Not yet tested on the real Playgama Sandbox.
