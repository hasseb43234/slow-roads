/* Weather / region presets. Every look-and-feel number lives here. */
(function (CR) {
  'use strict';

  CR.SCENES = [
    {
      id: 'sunny', name: 'Switzerland', sub: 'Sunny alpine day',
      chip: 'linear-gradient(180deg,#2a78dc 0%,#bfe0fa 62%,#6aa83a 63%,#3c7a2a 100%)',
      sunE: 0.62, sunAz: 0.7, sunCol: 0xfff2dc, sunI: 1.05, shadows: true, exposure: 1.0,
      skyTop: 0x2776da, skyMid: 0x66a8ea, skyHor: 0xbddcf6,
      hemiSky: 0xcfe4ff, hemiGnd: 0x7c9a5c, hemiI: 0.62,
      fogNear: 110, fogFar: 820,
      clouds: { lo: 0.56, hi: 0.84, amt: 0.82, col: 0xffffff, bright: 1.0, speed: 1.0 },
      stars: 0, aurora: 0, moon: 0, glow: 1.0,
      mtn: { col: 0x8ca9c8, snow: 1.0, h: 0.085 },
      amp: 1.3, bias: 0, peaks: 1.0, waterLevel: -22, waterDeep: 0x137a9a, waterShallow: 0x3fc0cf,
      snowLine: 78, rockLine: 52,
      ground: {
        a: [0x3a7a2a, 0x6aaa3a], b: [0x468a2e, 0x7bb546], c: [0x7c9a3a, 0xaec25a],
        dirt: 0x8d806a, rock: 0x8c8982, snow: 0xf4f6fa, shore: 0xb9b19b
      },
      trees: { a: 0x1e5a2c, b: 0x2d7436, c: 0x58802e, snow: 0, broad: 0.35 },
      chalets: 0.9, treeDensity: 1.0,
      precip: { rain: 0, snow: 0, lightning: 0 },
      wet: 0, gripMul: 1.0, brakeMul: 1.0, headlights: 0,
      ambience: { wind: 0.7, rain: 0 },
      cam: { fov: 62 }, marks: 0.82, smoke: 1.0
    },
    {
      id: 'norway', name: 'Norway', sub: 'Golden twilight and aurora',
      chip: 'linear-gradient(180deg,#0b2a3a 0%,#1d8a62 28%,#14214f 50%,#f0a860 68%,#1d4a63 69%,#101a2a 100%)',
      sunE: 0.075, sunAz: -1.15, sunCol: 0xffc690, sunI: 0.9, shadows: true, exposure: 1.3,
      skyTop: 0x0a1233, skyMid: 0x4a3a78, skyHor: 0xf2a85c,
      hemiSky: 0x6674b8, hemiGnd: 0x3a3042, hemiI: 0.64,
      fogNear: 70, fogFar: 800,
      clouds: { lo: 0.6, hi: 0.9, amt: 0.5, col: 0xf0b6a0, bright: 0.9, speed: 0.6 },
      stars: 0.75, aurora: 1.0, moon: 0, glow: 1.9, skyE: -0.035,
      mtn: { col: 0x2a2f5c, snow: 1.0, h: 0.115 },
      amp: 1.75, bias: -7, peaks: 1.7, waterLevel: -15, waterDeep: 0x0b2c44, waterShallow: 0x2f6f86,
      snowLine: 26, rockLine: 15,
      ground: {
        a: [0x233e2a, 0x3b5f38], b: [0x2c4a30, 0x4f7048], c: [0x56553e, 0x78754f],
        dirt: 0x5b5449, rock: 0x7b808a, snow: 0xe9eefa, shore: 0x6a6a62
      },
      trees: { a: 0x0e3322, b: 0x154228, c: 0x33502a, snow: 0.08, broad: 0.1 },
      chalets: 0.35, treeDensity: 1.0,
      precip: { rain: 0, snow: 0, lightning: 0 },
      wet: 0, gripMul: 1.0, brakeMul: 1.0, headlights: 1.0,
      ambience: { wind: 0.5, rain: 0 },
      cam: { fov: 62 }, marks: 0.9, smoke: 0.9
    },
    {
      id: 'rain', name: 'Rain', sub: 'Heavy storm, wet road',
      chip: 'linear-gradient(180deg,#4a545f 0%,#8b959d 60%,#3d6a34 61%,#2b4f26 100%)',
      sunE: 0.42, sunAz: 0.4, sunCol: 0xb9c6d4, sunI: 0.35, shadows: false, exposure: 1.1,
      skyTop: 0x4d5760, skyMid: 0x6b7680, skyHor: 0x939da5,
      hemiSky: 0x9aa7b4, hemiGnd: 0x4a5a48, hemiI: 0.82,
      fogNear: 20, fogFar: 430,
      clouds: { lo: 0.1, hi: 0.5, amt: 0.97, col: 0x5f6973, bright: 0.8, speed: 2.2 },
      stars: 0, aurora: 0, moon: 0, glow: 0.0,
      mtn: { col: 0x6d7a87, snow: 0.2, h: 0.07 },
      amp: 1.0, bias: 0, peaks: 0.8, waterLevel: -22, waterDeep: 0x2d4a56, waterShallow: 0x4d6a72,
      snowLine: 90, rockLine: 55,
      ground: {
        a: [0x2c5726, 0x46783a], b: [0x32602a, 0x52853c], c: [0x536c38, 0x759150],
        dirt: 0x6f6454, rock: 0x6c6e70, snow: 0xdfe4ea, shore: 0x8a8672
      },
      trees: { a: 0x1a4a28, b: 0x275f30, c: 0x4a6b2e, snow: 0, broad: 0.45 },
      chalets: 0.4, treeDensity: 1.0,
      precip: { rain: 1, snow: 0, lightning: 1 },
      wet: 1, gripMul: 0.8, brakeMul: 0.82, headlights: 0.85,
      ambience: { wind: 0.6, rain: 1 },
      cam: { fov: 62 }, marks: 0.5, smoke: 0.7
    },
    {
      id: 'snow', name: 'Snowfall', sub: 'Frozen pines, clear winter day',
      chip: 'linear-gradient(180deg,#2f7fd8 0%,#cfe0f1 58%,#f4f8fc 59%,#d7e1ee 100%)',
      sunE: 0.3, sunAz: -0.55, sunCol: 0xfff0e0, sunI: 1.25, shadows: true, exposure: 0.98,
      skyTop: 0x2c7bd6, skyMid: 0x7db4ec, skyHor: 0xe3edf6,
      hemiSky: 0xb9d4f4, hemiGnd: 0xe6edf6, hemiI: 0.85,
      fogNear: 80, fogFar: 780,
      clouds: { lo: 0.6, hi: 0.9, amt: 0.32, col: 0xffffff, bright: 1.0, speed: 0.6 },
      stars: 0, aurora: 0, moon: 0, glow: 0.7,
      mtn: { col: 0x9db3cc, snow: 1.0, h: 0.09 },
      amp: 1.25, bias: 0, peaks: 1.1, waterLevel: -24, waterDeep: 0x9fb8cc, waterShallow: 0xdce8f2,
      snowLine: -999, rockLine: 70,
      ground: {
        a: [0xdbe5f1, 0xf8fbff], b: [0xd2deec, 0xf0f5fb], c: [0xc8d5e5, 0xe8eff8],
        dirt: 0x6f6b66, rock: 0x7d828a, snow: 0xffffff, shore: 0xdde7f1, patch: 0x4a3f35
      },
      patchAmt: 0.55,
      trees: { a: 0x0f3324, b: 0x15402c, c: 0x1e4a34, snow: 0.7, broad: 0.0 },
      chalets: 0.5, treeDensity: 1.25, rails: 0.55,
      precip: { rain: 0, snow: 0.3, lightning: 0 },
      wet: 0, roadSnow: 1, gripMul: 0.66, brakeMul: 0.7, headlights: 0.15,
      ambience: { wind: 0.8, rain: 0 },
      cam: { fov: 62 }, marks: 0.6, smoke: 0.5
    }
  ];

  CR.sceneById = (id) => CR.SCENES.find((s) => s.id === id) || CR.SCENES[0];
})(window.CR = window.CR || {});
