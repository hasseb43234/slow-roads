# Calm Road

An endless, relaxing driving game that runs in the browser. No install, no build step.

Inspired by the calm feel of [slowroads.io](https://slowroads.io/). This is an independent project and is not affiliated with it.

## Features
- **Three cars:** Normal Car (smooth everyday sedan), Speed Car (long-tail GT racer), Drift Car (slides, skid marks and tyre smoke).
- **Four worlds:** Switzerland (sunny), Norway (golden twilight and aurora), Rain (storm, wet road, lightning), Snowfall (frozen pines, clear winter day).
- **Two locations:** the endless Open Road, and an Airport stunt park with ramps, a jump over a parked airliner, boost pads, a quarter-pipe, cones, flips and rolls.
- **Driving feel:** fixed-timestep physics with smoothing, a gentle lane-keeping assist, reverse gear, handbrake drifting.
- **Boundaries:** glowing limit walls; reach one and the car fades back onto the road (or the runway).
- **Phones:** touch controls, automatic fullscreen landscape on Android, a "turn your phone sideways" prompt elsewhere, and a Graphics setting (Auto, High, Low).
- **Music:** five generated stations, an Auto mode that follows the weather, volume control, and loading your own tracks.

## Controls
| Key | Action |
|---|---|
| W / S | gas / brake, hold S when stopped to reverse |
| A / D | steer |
| Space | handbrake (drift) |
| E | cruise control |
| C | change camera |
| V | change car paint |
| N | next song |
| M | mute |
| R | reset onto the road |
| Esc | menu |
| In the air (airport) | W/S flip, A/D barrel roll |

Touch controls appear on phones and tablets.

## Run locally
Open `index.html` in a browser, or serve the folder:

```
python -m http.server 8000
```

then visit http://localhost:8000. three.js is loaded from cdnjs, so an internet connection is needed.

## YouTube Playables
See [PLAYABLES.md](PLAYABLES.md). `python build-playables.py` makes the upload zip.

## Put it online
See [DEPLOY.md](DEPLOY.md). GitHub Pages works out of the box: Settings, Pages, deploy from the `main` branch, root folder.

## Project layout
```
index.html        page and menu markup
css/style.css     HUD and menu styling
js/util.js        maths, noise, colour handling
js/scenes.js      weather and region presets
js/cars.js        car models and handling specs
js/world.js       sky, streamed terrain, road, trees, water, weather
js/airport.js     stunt-park arena, ramps, boost pads, cones
js/audio.js       engine and ambient sound, generative music
js/game.js        physics, camera, effects, menu, main loop
```
