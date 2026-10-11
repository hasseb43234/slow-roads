/* Shared maths + deterministic noise. */
(function (CR) {
  'use strict';
  const U = {};
  U.clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
  U.lerp = (a, b, t) => a + (b - a) * t;
  U.smoothstep = (e0, e1, x) => { const t = U.clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); };
  U.angDiff = (a, b) => {
    let d = (b - a) % (Math.PI * 2);
    if (d > Math.PI) d -= Math.PI * 2;
    if (d < -Math.PI) d += Math.PI * 2;
    return d;
  };
  // sRGB <-> linear. The whole game is authored in sRGB hex values; lighting is done in linear light.
  U.s2l = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
  U.rgb = (h) => [U.s2l(((h >> 16) & 255) / 255), U.s2l(((h >> 8) & 255) / 255), U.s2l((h & 255) / 255)];
  if (window.THREE && !window.THREE.Color.prototype.__linearHex) {
    // every hex colour handed to three.js is treated as sRGB and converted to linear automatically
    window.THREE.Color.prototype.setHex = function (hex) {
      hex = Math.floor(hex);
      this.r = U.s2l(((hex >> 16) & 255) / 255); this.g = U.s2l(((hex >> 8) & 255) / 255); this.b = U.s2l((hex & 255) / 255);
      return this;
    };
    window.THREE.Color.prototype.__linearHex = true;
  }
  U.sign = (x) => (x < 0 ? -1 : 1);

  const SEED = 1337;
  U.hash2 = function (x, y) {
    let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(SEED, 1442695041)) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  };
  const hash2 = U.hash2;
  U.vnoise = function (x, y) {
    const xi = Math.floor(x), yi = Math.floor(y);
    const xf = x - xi, yf = y - yi;
    const u = xf * xf * xf * (xf * (xf * 6 - 15) + 10);
    const v = yf * yf * yf * (yf * (yf * 6 - 15) + 10);
    const a = hash2(xi, yi), b = hash2(xi + 1, yi), c = hash2(xi, yi + 1), d = hash2(xi + 1, yi + 1);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  };
  const vnoise = U.vnoise;
  U.fbm = function (x, y, o) {
    let s = 0, a = 0.5, n = 0;
    for (let i = 0; i < o; i++) { s += a * vnoise(x, y); n += a; x = x * 2.03 + 31.7; y = y * 2.03 + 17.3; a *= 0.5; }
    return s / n;
  };
  CR.U = U;
})(window.CR = window.CR || {});
