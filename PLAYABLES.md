# Calm Road on YouTube Playables

## Build the upload zip
```
python build-playables.py
```
This creates `dist/calm-road-playables.zip` (index.html at the zip root, 12 files, about 0.22 MB zipped) and prints a report.
The script fails if a Playables rule is broken (external URL, bad file name, oversized file, service worker, eval, worker).

## What the Playables build does differently
- Loads the YouTube SDK first (`https://www.youtube.com/game_api/v1`), the only external URL.
- three.js r128 is bundled in `js/vendor/` (Playables blocks outside network requests, so no CDN).
- Settings and the best stunt score are saved with `ytgame.game.saveData` and read with `loadData`
  (saving waits until loading has finished). The best score is also sent with `sendScore` and always equals the saved best.
- `firstFrameReady()` is sent while the loading screen shows, `gameReady()` once the menu is usable.
- `onPause` stops the game loop, rendering and audio; `onResume` restarts them.
- YouTube's mute button silences all sound and cannot be overridden from the game.
- Never locks orientation, no fullscreen button, no rotate prompt, no service worker, no local file picker.
- Mouse, touch and keyboard all work (on-screen pedals and steering are shown for mouse players too).
- The menu button is called SETTINGS and sits top-left, away from YouTube's own controls. There is no quit button.
- Lightning is one soft fade, never a strobe.

## Test it locally the way YouTube serves it
Serve `dist/playables/` with the Content-Security-Policy from the
[test suite guide](https://developers.google.com/youtube/gaming/playables/reference/test_suite_guide)
(Chrome DevTools > Sources > Overrides), then run the Playables SDK Test Suite against it.

## Before you submit
- Run Google's SDK Test Suite on the build.
- Check it on a real phone (the game should reach the menu in under about 5 seconds, peak memory must stay under 512 MB).
- Playables access is managed by YouTube: see https://developers.google.com/youtube/gaming/playables
  and the Developer Portal for the upload step.

Known soft recommendations: `three.min.js` is 589 KiB (guideline is under 512 KiB per file; the hard limit is 30 MiB).
