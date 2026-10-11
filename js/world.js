/* The endless road world: sky, streamed terrain ring-buffer, road, trees, water, precipitation. */
(function (CR) {
  'use strict';
  const THREE = window.THREE;
  const { clamp, lerp, smoothstep, hash2, vnoise, fbm, rgb } = CR.U;

  const DS = 3;                       // metres between road rows
  const R = 320;                      // rows held in the ring buffer (960 m)
  const BEHIND = 40, AHEAD = R - BEHIND - 1;
  const LEAD = 30;                    // rows of look-ahead used to shape road elevation
  const HALF_ROAD = 6.5;
  const LAT_HALF = [0, 3, 6.5, 8.6, 11, 14, 18, 23, 30, 39, 50, 64, 82, 105, 135, 170, 215, 270, 330];
  const LAT = [];
  for (let i = LAT_HALF.length - 1; i > 0; i--) LAT.push(-LAT_HALF[i]);
  for (const v of LAT_HALF) LAT.push(v);
  const C = LAT.length;
  const LAT_MAX = 330;
  const TR = 6, TQ = 26, NTR = Math.ceil(R / TR) + 3, TREE_N = NTR * TQ;
  const CHR = 30, CHQ = 3, NCH = Math.ceil(R / CHR) + 3, CHAL_N = NCH * CHQ;

  const LIMIT = 200;                   // lateral distance of the boundary wall from the road centre
  const W = { DS, R, HALF_ROAD, LIMIT, ax: 0, az: 0, scene: CR.SCENES[0], visible: true, flash: 0, onThunder: null, onRebase: null };
  let SC = CR.SCENES[0];
  let scene3, renderer3;

  /* ------------------------------------------------------------------ road path (generated lazily, forever) */
  const KMAX = 0.0024;
  function curvature(s) {
    const a = vnoise(s / 330 + 100, 3.7) * 2 - 1;
    const b = vnoise(s / 900 + 40, 9.1);
    const dz = 0.12;
    const x = Math.sign(a) * Math.max(0, Math.abs(a) - dz) / (1 - dz);
    return x * KMAX * (0.4 + 0.9 * b) * smoothstep(0, 250, s);
  }
  const P = { px: [0], pz: [0], th: [0], kc: [0], ky: [], y1: 0, y2: 0 };
  function extend(n) {
    while (P.px.length <= n) {
      const i = P.px.length;
      const k = curvature((i - 1) * DS);
      const t0 = P.th[i - 1], t1 = t0 + k * DS, mid = (t0 + t1) / 2;
      P.px.push(P.px[i - 1] + Math.sin(mid) * DS);
      P.pz.push(P.pz[i - 1] + Math.cos(mid) * DS);
      P.th.push(t1);
      P.kc.push(k);
    }
  }

  /* ------------------------------------------------------------------ terrain function (depends on the scene preset) */
  function bigH(wx, wz) {
    const m = vnoise(wx * 0.0006 + 11, wz * 0.0006 + 7);
    const mt = smoothstep(0.3, 0.75, m);
    const amp = (16 + 62 * mt) * SC.amp;
    let h = (fbm(wx * 0.0011, wz * 0.0011, 4) - 0.5) * 4.4 * amp;
    const rid = 1 - Math.abs(2 * fbm(wx * 0.0017 + 50, wz * 0.0017 + 9, 3) - 1);
    h += mt * Math.pow(rid, 2.4) * 85 * SC.peaks;
    return h + SC.bias;
  }
  function terrainH(wx, wz, lat, ry) {
    const a = Math.abs(lat);
    const w = smoothstep(10, 150, a);
    if (w <= 0) return ry;
    const detail = (vnoise(wx * 0.035, wz * 0.035) - 0.5) * 1.4 + (vnoise(wx * 0.011 + 3, wz * 0.011) - 0.5) * 3.5;
    return lerp(ry, bigH(wx, wz), w) + detail * smoothstep(10, 36, a) * (1 - smoothstep(60, 150, a));
  }
  function ensureY(n) {
    while (P.ky.length <= n) {
      const i = P.ky.length;
      extend(i + LEAD);
      const target = bigH(P.px[i + LEAD], P.pz[i + LEAD]);
      if (i === 0) { P.y1 = P.y2 = target; }
      else { P.y1 += (target - P.y1) * 0.07; P.y2 += (P.y1 - P.y2) * 0.07; }
      let y = Math.max(P.y2, SC.waterLevel + 3.6);
      if (i > 0) { const pv = P.ky[i - 1]; y = clamp(y, pv - 0.1 * DS, pv + 0.1 * DS); }
      P.y2 = y;
      P.ky.push(y);
    }
  }
  const S = { x: 0, z: 0, th: 0, y: 0, k: 0, rx: -1, rz: 0 };
  function sampleRoad(s) {
    const f0 = s / DS; const i = Math.floor(f0); const f = f0 - i;
    ensureY(i + 2);
    S.x = lerp(P.px[i], P.px[i + 1], f); S.z = lerp(P.pz[i], P.pz[i + 1], f);
    S.th = lerp(P.th[i], P.th[i + 1], f); S.y = lerp(P.ky[i], P.ky[i + 1], f);
    S.k = P.kc[i + 1];
    S.rx = -Math.cos(S.th); S.rz = Math.sin(S.th);
    return S;
  }
  function groundAt(s, d) {
    sampleRoad(s);
    if (Math.abs(d) < HALF_ROAD + 0.3) return S.y + 0.07;
    return terrainH(S.x + S.rx * d, S.z + S.rz * d, d, S.y);
  }
  W.P = P; W.S = S; W.sampleRoad = sampleRoad; W.groundAt = groundAt; W.ensureY = ensureY;
  W.terrainH = terrainH; W.bigH = bigH;

  /* ------------------------------------------------------------------ ground palette */
  let G = null;
  function setPalette() {
    const g = SC.ground;
    G = { a0: rgb(g.a[0]), a1: rgb(g.a[1]), b0: rgb(g.b[0]), b1: rgb(g.b[1]), c0: rgb(g.c[0]), c1: rgb(g.c[1]),
          dirt: rgb(g.dirt), rock: rgb(g.rock), snow: rgb(g.snow), shore: rgb(g.shore), patch: rgb(g.patch || g.dirt) };
  }
  function groundColor(wx, wz, y, a, out, o) {
    const b = vnoise(wx * 0.0005 + 90, wz * 0.0005 + 10);
    const t1 = smoothstep(0.38, 0.52, b), t2 = smoothstep(0.62, 0.78, b);
    const p = vnoise(wx * 0.018 + 9, wz * 0.018);
    const fine = a < 70 ? 0.93 + 0.14 * vnoise(wx * 0.11, wz * 0.11) : 1;
    const dirtW = 1 - smoothstep(7.4, 11.0, a);
    const rockW = smoothstep(SC.rockLine, SC.rockLine + 16, y);
    const snowW = smoothstep(SC.snowLine, SC.snowLine + 12, y);
    const shoreW = 1 - smoothstep(SC.waterLevel + 0.4, SC.waterLevel + 3.2, y);
    const patchW = SC.patchAmt ? SC.patchAmt * smoothstep(0.58, 0.7, vnoise(wx * 0.037 + 5, wz * 0.037) * 0.65 + vnoise(wx * 0.13, wz * 0.13 + 9) * 0.35) * smoothstep(9, 16, a) : 0;
    for (let ch = 0; ch < 3; ch++) {
      const ca = G.a0[ch] + (G.a1[ch] - G.a0[ch]) * p;
      const cb = G.b0[ch] + (G.b1[ch] - G.b0[ch]) * p;
      const cc = G.c0[ch] + (G.c1[ch] - G.c0[ch]) * p;
      let c = ca + (cb - ca) * t1; c += (cc - c) * t2; c *= fine;
      c += (G.dirt[ch] - c) * dirtW;
      c += (G.rock[ch] - c) * rockW;
      c += (G.snow[ch] - c) * snowW;
      c += (G.patch[ch] - c) * patchW * (1 - rockW);
      c += (G.shore[ch] - c) * shoreW;
      out[o + ch] = c;
    }
  }

  /* ------------------------------------------------------------------ sky dome */
  const skyU = {
    uTop: { value: new THREE.Color() }, uMid: { value: new THREE.Color() }, uHor: { value: new THREE.Color() },
    uSunDir: { value: new THREE.Vector3(0, 1, 0) }, uSunCol: { value: new THREE.Color() },
    uMoonDir: { value: new THREE.Vector3(0, -1, 0) }, uCloud: { value: new THREE.Color() }, uMtn: { value: new THREE.Color() },
    uStars: { value: 0 }, uMoon: { value: 0 }, uAurora: { value: 0 }, uTime: { value: 0 }, uFlash: { value: 0 },
    uGlow: { value: 1 }, uCloudLo: { value: 0.55 }, uCloudHi: { value: 0.8 }, uCloudAmt: { value: 0.8 }, uCloudSpeed: { value: 1 },
    uMtnSnow: { value: 1 }, uMtnH: { value: 0.08 }, uSunUp: { value: 1 }
  };
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(900, 40, 20),
    new THREE.ShaderMaterial({
      uniforms: skyU, side: THREE.BackSide, depthWrite: false, fog: false,
      vertexShader: `varying vec3 vDir;
        void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); gl_Position.z = gl_Position.w; }`,
      fragmentShader: `
        uniform vec3 uTop, uMid, uHor, uSunDir, uMoonDir, uSunCol, uCloud, uMtn;
        uniform float uStars, uMoon, uAurora, uTime, uFlash, uGlow, uCloudLo, uCloudHi, uCloudAmt, uCloudSpeed, uMtnSnow, uMtnH, uSunUp;
        varying vec3 vDir;
        float h21(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
        float n2(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.-2.*f);
          return mix(mix(h21(i),h21(i+vec2(1,0)),f.x), mix(h21(i+vec2(0,1)),h21(i+vec2(1,1)),f.x), f.y); }
        float fbm(vec2 p){ float a=.5, s=0.; for(int i=0;i<5;i++){ s+=a*n2(p); p*=2.03; a*=.5; } return s; }
        float fbm3(vec2 p){ float a=.5, s=0.; for(int i=0;i<3;i++){ s+=a*n2(p); p*=2.1; a*=.5; } return s; }
        float aurora(vec3 d, float off){
          float h = d.y; if (h < 0.02) return 0.0;
          float az = atan(d.z, d.x);
          float wave = fbm3(vec2(az*1.7 + uTime*0.035 + off, uTime*0.02 + off));
          float centre = 0.30 + 0.20*wave + off*0.02;
          float band = exp(-pow((h - centre) * 5.2, 2.0));
          float rays = pow(0.5 + 0.5*sin(az*26.0 + wave*14.0 + uTime*0.45 + off*3.0), 3.0)*0.75 + 0.25;
          float drift = smoothstep(0.18, 0.62, fbm3(vec2(az*2.2 - uTime*0.04 + off*5.0, h*3.0)) + 0.18);
          return band * rays * drift * smoothstep(0.02, 0.14, h);
        }
        void main(){
          vec3 d = normalize(vDir);
          float h = max(d.y, 0.0);
          float hh = pow(h, 0.5);
          vec3 col = mix(uHor, uMid, smoothstep(0.0, 0.34, hh));
          col = mix(col, uTop, smoothstep(0.24, 1.0, hh));

          float sd = max(dot(d, uSunDir), 0.0);
          float above = smoothstep(-0.03, 0.01, d.y);
          vec3 glow = uSunCol * (pow(sd, 900.0) * 4.0 * above + pow(sd, 14.0) * 0.28 * uGlow + pow(sd, 3.0) * 0.10 * uGlow);
          glow += uSunCol * pow(sd, 5.0) * (1.0 - h) * 0.22 * uGlow;
          col += glow * uSunUp;

          float md = dot(d, uMoonDir);
          col += vec3(0.92, 0.95, 1.0) * smoothstep(0.9993, 0.9997, md) * uMoon;
          col += vec3(0.5, 0.6, 0.9) * pow(max(md, 0.0), 60.0) * 0.12 * uMoon;

          if (uStars > 0.0) {
            vec3 sp = d * 520.0; vec3 id = floor(sp);
            float r = fract(sin(dot(id, vec3(12.9898, 78.233, 37.719))) * 43758.5453);
            float star = step(0.9982, r) * smoothstep(0.42, 0.0, length(fract(sp) - 0.5)) * smoothstep(0.02, 0.25, d.y);
            col += vec3(star) * uStars * (0.4 + 0.9 * fract(r * 91.7));
          }
          if (uAurora > 0.0) {
            float a1 = aurora(d, 0.0), a2 = aurora(d, 3.7) * 0.7;
            float a = a1 + a2;
            vec3 ac = mix(vec3(0.0, 1.0, 0.22), vec3(0.62, 0.05, 0.95), smoothstep(0.32, 0.62, d.y));
            ac = mix(ac, vec3(0.2, 1.0, 0.8), smoothstep(0.1, 0.0, d.y - 0.18) * 0.5);
            col += ac * a * uAurora * 0.85;
          }
          if (d.y > 0.0) {
            vec2 uv = d.xz / (d.y + 0.14) * 1.1 + vec2(uTime * 0.012 * uCloudSpeed, uTime * 0.004);
            float c = smoothstep(uCloudLo, uCloudHi, fbm(uv));
            c *= smoothstep(0.0, 0.12, d.y);
            col = mix(col, uCloud, c * uCloudAmt);
          }
          // distant ranges
          float az2 = atan(d.z, d.x); vec2 cc = vec2(cos(az2), sin(az2));
          float f1 = fbm(cc * 2.7 + 7.0), f2 = fbm(cc * 4.6 + 21.0);
          float m1 = 0.010 + uMtnH * (0.2 + 2.3 * max(f1 - 0.28, 0.0));
          float m2 = 0.004 + uMtnH * 0.7 * (0.2 + 2.0 * max(f2 - 0.30, 0.0));
          vec3 farC = mix(uHor, uMtn, 0.55);
          float snowA = smoothstep(m1 * 0.60, m1 * 0.92, d.y) * uMtnSnow;
          farC = mix(farC, mix(vec3(1.0), uHor, 0.3) * (0.7 + 0.3 * uSunUp), snowA * 0.9);
          col = mix(col, farC, smoothstep(m1, m1 - 0.0035, d.y));
          vec3 nearC = mix(uHor, uMtn, 0.82) * 0.9;
          col = mix(col, nearC, smoothstep(m2, m2 - 0.0035, d.y));
          col += vec3(0.85, 0.9, 1.0) * uFlash;
          gl_FragColor = vec4(col, 1.0);
          #ifdef TONE_MAPPING
          gl_FragColor.rgb = toneMapping(gl_FragColor.rgb);
          #endif
          gl_FragColor = linearToOutputTexel(gl_FragColor);
        }`
    })
  );
  sky.renderOrder = -10; sky.frustumCulled = false;

  /* ------------------------------------------------------------------ lights */
  const hemi = new THREE.HemisphereLight(0xcfe4ff, 0x7c9a5c, 0.6);
  const sun = new THREE.DirectionalLight(0xffffff, 1);
  sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048);
  const sc = sun.shadow.camera; sc.left = -26; sc.right = 26; sc.top = 26; sc.bottom = -26; sc.near = 1; sc.far = 260;
  sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.04; sun.shadow.radius = 2.5;
  const sunDir = new THREE.Vector3(0, 1, 0);
  W.sky = sky; W.skyU = skyU; W.hemi = hemi; W.sun = sun; W.sunDir = sunDir;

  /* ------------------------------------------------------------------ terrain + road ring buffers */
  const tPos = new Float32Array(R * C * 3), tCol = new Float32Array(R * C * 3), tNor = new Float32Array(R * C * 3), tEdge = new Float32Array(R * C);
  for (let a = 0; a < R; a++) for (let c = 0; c < C; c++) { tEdge[a * C + c] = smoothstep(0.45, 1.0, Math.abs(LAT[c]) / LAT_MAX); tNor[(a * C + c) * 3 + 1] = 1; }
  const PAIR = (C - 1) * 6;
  const tIdxT = new Uint16Array(R * PAIR), tIdx = new Uint16Array(R * PAIR);
  for (let a = 0; a < R; a++) {
    const b = (a + 1) % R;
    for (let c = 0; c < C - 1; c++) {
      const A = a * C + c, B = b * C + c, Cc = a * C + c + 1, D = b * C + c + 1;
      tIdxT.set([A, Cc, B, B, Cc, D], a * PAIR + c * 6);
    }
  }
  const terrainGeo = new THREE.BufferGeometry();
  terrainGeo.setAttribute('position', new THREE.BufferAttribute(tPos, 3).setUsage(THREE.DynamicDrawUsage));
  terrainGeo.setAttribute('normal', new THREE.BufferAttribute(tNor, 3).setUsage(THREE.DynamicDrawUsage));
  terrainGeo.setAttribute('color', new THREE.BufferAttribute(tCol, 3).setUsage(THREE.DynamicDrawUsage));
  terrainGeo.setAttribute('aEdge', new THREE.BufferAttribute(tEdge, 1));
  terrainGeo.setIndex(new THREE.BufferAttribute(tIdx, 1).setUsage(THREE.DynamicDrawUsage));
  // tileable noise used to break up the flat vertex colours (grass blades, soil, snow crust, gravel)
  function makeDetailTexture() {
    const N = 256, cv = document.createElement('canvas'); cv.width = cv.height = N;
    const g = cv.getContext('2d'), img = g.createImageData(N, N);
    const tn = (x, y, per) => {
      const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
      const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
      const h = (a, b) => hash2(((a % per) + per) % per + 700, ((b % per) + per) % per + 300);
      const a = h(xi, yi), b = h(xi + 1, yi), c = h(xi, yi + 1), d = h(xi + 1, yi + 1);
      return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
    };
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      let v = 0, amp = 0.5, sum = 0;
      for (const f of [4, 8, 16, 32, 64]) { v += amp * tn(x / N * f, y / N * f, f); sum += amp; amp *= 0.55; }
      v = v / sum;
      v = 0.5 + (v - 0.5) * 1.7 + (Math.random() - 0.5) * 0.18;
      const o = (y * N + x) * 4, c = Math.max(0, Math.min(255, v * 255));
      img.data[o] = img.data[o + 1] = img.data[o + 2] = c; img.data[o + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    const t = new THREE.CanvasTexture(cv);
    t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8;
    return t;
  }
  const detailTex = makeDetailTexture();
  const terrainMat = new THREE.MeshStandardMaterial({ vertexColors: true, side: THREE.DoubleSide, roughness: 1.0, metalness: 0, envMapIntensity: 0 });
  terrainMat.onBeforeCompile = (sh) => {
    sh.uniforms.uDetail = { value: detailTex };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aEdge;\nvarying float vEdge;\nvarying vec3 vWP;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvEdge = aEdge;\nvWP = position;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vEdge;\nvarying vec3 vWP;\nuniform sampler2D uDetail;')
      .replace('#include <color_fragment>', `#include <color_fragment>
        {
          vec2 wp = vWP.xz; float dd = length(vViewPosition);
          float n1 = texture2D(uDetail, wp * 0.071).r, n2 = texture2D(uDetail, wp * 0.0113 + 0.37).r;
          float n3 = texture2D(uDetail, wp * 0.52).r, n4 = texture2D(uDetail, wp * 2.3).r;
          float f1 = 1.0 - smoothstep(120.0, 520.0, dd), f2 = 1.0 - smoothstep(6.0, 80.0, dd), f3 = 1.0 - smoothstep(2.0, 20.0, dd);
          float k = (n2 - 0.5) * 0.55 + (n1 - 0.5) * 0.5 * f1 + (n3 - 0.5) * 0.45 * f2 + (n4 - 0.5) * 0.42 * f3;
          diffuseColor.rgb *= 1.0 + k;
        }`)
      .replace('#include <fog_fragment>', '#include <fog_fragment>\n#ifdef USE_FOG\n gl_FragColor.rgb = mix(gl_FragColor.rgb, fogColor, vEdge);\n#endif');
  };
  const terrain = new THREE.Mesh(terrainGeo, terrainMat);
  terrain.frustumCulled = false; terrain.receiveShadow = true;

  const rPos = new Float32Array(R * 2 * 3), rNor = new Float32Array(R * 2 * 3), rUv = new Float32Array(R * 2 * 2);
  for (let i = 0; i < R * 2; i++) rNor[i * 3 + 1] = 1;
  for (let a = 0; a < R; a++) { rUv[a * 4] = 0; rUv[a * 4 + 2] = 1; }
  const RPAIR = 6, rIdxT = new Uint16Array(R * RPAIR), rIdx = new Uint16Array(R * RPAIR);
  for (let a = 0; a < R; a++) {
    const b = (a + 1) % R;
    rIdxT.set([a * 2, a * 2 + 1, b * 2, b * 2, a * 2 + 1, b * 2 + 1], a * RPAIR);
  }
  const roadGeo = new THREE.BufferGeometry();
  roadGeo.setAttribute('position', new THREE.BufferAttribute(rPos, 3).setUsage(THREE.DynamicDrawUsage));
  roadGeo.setAttribute('normal', new THREE.BufferAttribute(rNor, 3));
  roadGeo.setAttribute('uv', new THREE.BufferAttribute(rUv, 2).setUsage(THREE.DynamicDrawUsage));
  roadGeo.setIndex(new THREE.BufferAttribute(rIdx, 1).setUsage(THREE.DynamicDrawUsage));
  function makeRoadTexture(snow) {
    const Wd = 512, Ht = 1024;
    const cv = document.createElement('canvas'); cv.width = Wd; cv.height = Ht;
    const g = cv.getContext('2d');
    g.fillStyle = snow ? '#2d3034' : '#44474c'; g.fillRect(0, 0, Wd, Ht);
    // low-frequency blotches (old repairs, sun-bleached areas)
    for (let k = 0; k < 90; k++) {
      const x = Math.random() * Wd, y = Math.random() * Ht, r = 30 + Math.random() * 120;
      const gr = g.createRadialGradient(x, y, 0, x, y, r);
      const v = Math.random() < 0.5 ? 255 : 0;
      gr.addColorStop(0, `rgba(${v},${v},${v},${0.035 + Math.random() * 0.04})`); gr.addColorStop(1, `rgba(${v},${v},${v},0)`);
      g.fillStyle = gr; g.fillRect(x - r, y - r, r * 2, r * 2);
    }
    // wheel tracks, darker where tyres polish and rubber builds up
    for (const cx of [0.27, 0.73]) {
      const gr = g.createLinearGradient((cx - 0.09) * Wd, 0, (cx + 0.09) * Wd, 0);
      gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(0.5, 'rgba(0,0,0,0.20)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = gr; g.fillRect((cx - 0.09) * Wd, 0, 0.18 * Wd, Ht);
    }
    // aggregate grain
    for (let k = 0; k < 90000; k++) {
      const v = 40 + Math.random() * 85;
      g.fillStyle = `rgba(${v},${v},${v + 3},${0.18 + Math.random() * 0.4})`;
      g.fillRect(Math.random() * Wd, Math.random() * Ht, 1 + Math.random() * 1.6, 1 + Math.random() * 1.6);
    }
    // hairline cracks and tar seams
    g.strokeStyle = 'rgba(10,10,12,0.42)'; g.lineWidth = 1.2;
    for (let k = 0; k < 16; k++) {
      let x = Math.random() * Wd, y = Math.random() * Ht; g.beginPath(); g.moveTo(x, y);
      for (let m = 0; m < 9; m++) { x += (Math.random() - 0.5) * 34; y += 10 + Math.random() * 26; g.lineTo(x, y); }
      g.stroke();
    }
    g.fillStyle = 'rgba(8,8,10,0.30)'; g.fillRect(0, Ht * 0.5 - 2, Wd, 4);                 // transverse joint
    // gravel / worn edges
    for (const [x0, dir] of [[0, 1], [Wd, -1]]) {
      const gr = g.createLinearGradient(x0, 0, x0 + dir * 26, 0);
      gr.addColorStop(0, 'rgba(120,115,105,0.55)'); gr.addColorStop(1, 'rgba(120,115,105,0)');
      g.fillStyle = gr; g.fillRect(dir > 0 ? 0 : Wd - 26, 0, 26, Ht);
    }
    // markings: continuous edge lines, dashed centre line (3 m dash / 9 m gap on a 12 m tile)
    g.fillStyle = 'rgba(236,236,226,0.94)';
    g.fillRect(0.045 * Wd, 0, 6, Ht); g.fillRect(0.955 * Wd - 6, 0, 6, Ht);
    g.fillRect(0.5 * Wd - 3, 0, 6, Ht * 0.25);
    for (let k = 0; k < 6000; k++) {                                                         // worn paint
      g.fillStyle = `rgba(68,71,76,${Math.random() * 0.5})`;
      g.fillRect(Math.random() < 0.5 ? 0.045 * Wd + Math.random() * 6 : 0.955 * Wd - 6 + Math.random() * 6, Math.random() * Ht, 2, 2 + Math.random() * 3);
    }
    if (snow) {
      // compacted snow banked along both edges, a ridge down the middle, clear dark wheel tracks, slush and specks
      const blob = (x, y, r, a) => { const gr = g.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, `rgba(236,241,248,${a})`); gr.addColorStop(0.6, `rgba(232,238,246,${a * 0.75})`); gr.addColorStop(1, 'rgba(232,238,246,0)'); g.fillStyle = gr; g.fillRect(x - r, y - r, r * 2, r * 2); };
      for (let y = 0; y < Ht; y += 5) {
        const wl = 56 + Math.sin(y * 0.013) * 22 + Math.random() * 26, wr = 56 + Math.cos(y * 0.011 + 2) * 22 + Math.random() * 26;
        for (let k = 0; k < 4; k++) { blob(Math.random() * wl, y + Math.random() * 5, 16 + Math.random() * 22, 0.85); blob(Wd - Math.random() * wr, y + Math.random() * 5, 16 + Math.random() * 22, 0.85); }
        if (Math.sin(y * 0.021) + Math.random() * 0.8 > 0.9) blob(Wd * 0.5 + (Math.random() - 0.5) * 26, y, 6 + Math.random() * 8, 0.4);   // centre ridge
        for (const cx of [0.27, 0.73]) if (Math.random() < 0.18) blob(Wd * cx + (Math.random() - 0.5) * 30, y, 6 + Math.random() * 9, 0.35);       // snow creeping into the tracks
      }
      for (let k = 0; k < 260; k++) blob(Math.random() * Wd, Math.random() * Ht, 3 + Math.random() * 9, 0.08 + Math.random() * 0.2);
      g.fillStyle = 'rgba(75,70,64,0.20)';
      for (const cx of [0.27, 0.73]) g.fillRect((cx - 0.05) * Wd, 0, 0.1 * Wd, Ht);      // wet, salted, dark
    }
    const t = new THREE.CanvasTexture(cv);
    t.wrapT = THREE.RepeatWrapping; t.wrapS = THREE.ClampToEdgeWrapping; t.encoding = THREE.sRGBEncoding;
    return t;
  }
  const roadTexSnow = makeRoadTexture(true);
  const roadTex = makeRoadTexture();
  const roadMatDry = new THREE.MeshStandardMaterial({ map: roadTex, roughness: 0.9, metalness: 0, envMapIntensity: 0.35, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  const roadMatWet = new THREE.MeshStandardMaterial({ map: roadTex, color: 0x8d949c, roughness: 0.2, metalness: 0.05, envMapIntensity: 1.5, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  const roadMatSnow = new THREE.MeshStandardMaterial({ map: roadTexSnow, color: 0xd6d9dd, roughness: 0.62, metalness: 0, envMapIntensity: 0.22, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  const road = new THREE.Mesh(roadGeo, roadMatDry);
  road.frustumCulled = false; road.receiveShadow = true;

  let headRow = -1, tailRow = 0, ringDirty = false;
  const slot = (i) => ((i % R) + R) % R;

  function writeRow(i) {
    const a = slot(i), th = P.th[i], rx = -Math.cos(th), rz = Math.sin(th), ry = P.ky[i];
    const cx = P.px[i], cz = P.pz[i];
    for (let c = 0; c < C; c++) {
      const lat = LAT[c], wx = cx + rx * lat, wz = cz + rz * lat;
      const y = terrainH(wx, wz, lat, ry);
      const o = (a * C + c) * 3;
      tPos[o] = wx - W.ax; tPos[o + 1] = y; tPos[o + 2] = wz - W.az;
      groundColor(wx, wz, y, Math.abs(lat), tCol, o);
    }
    const ro = a * 6, v = i / 4;
    rPos[ro] = cx - rx * HALF_ROAD - W.ax; rPos[ro + 1] = ry + 0.07; rPos[ro + 2] = cz - rz * HALF_ROAD - W.az;
    rPos[ro + 3] = cx + rx * HALF_ROAD - W.ax; rPos[ro + 4] = ry + 0.07; rPos[ro + 5] = cz + rz * HALF_ROAD - W.az;
    rUv[a * 4 + 1] = v; rUv[a * 4 + 3] = v;
    for (let side = 0; side < 2; side++) {
      const lat = side === 0 ? -LIMIT : LIMIT, wx = cx + rx * lat, wz = cz + rz * lat;
      const y = terrainH(wx, wz, lat, ry), o = (a * 4 + side * 2) * 3, u = i * DS / 10;
      lPos[o] = wx - W.ax; lPos[o + 1] = y - 0.3; lPos[o + 2] = wz - W.az;
      lPos[o + 3] = wx - W.ax; lPos[o + 4] = y + WALL_H; lPos[o + 5] = wz - W.az;
      lUv[(a * 4 + side * 2) * 2] = u; lUv[(a * 4 + side * 2 + 1) * 2] = u;
    }
  }
  function calcNormalRow(i) {
    const a = slot(i);
    const ap = slot(i > tailRow ? i - 1 : i), an = slot(i < headRow ? i + 1 : i);
    for (let c = 0; c < C; c++) {
      const cl = c > 0 ? c - 1 : c, cr = c < C - 1 ? c + 1 : c;
      const o = (a * C + c) * 3;
      const dxx = tPos[(a * C + cr) * 3] - tPos[(a * C + cl) * 3], dxy = tPos[(a * C + cr) * 3 + 1] - tPos[(a * C + cl) * 3 + 1], dxz = tPos[(a * C + cr) * 3 + 2] - tPos[(a * C + cl) * 3 + 2];
      const dzx = tPos[(an * C + c) * 3] - tPos[(ap * C + c) * 3], dzy = tPos[(an * C + c) * 3 + 1] - tPos[(ap * C + c) * 3 + 1], dzz = tPos[(an * C + c) * 3 + 2] - tPos[(ap * C + c) * 3 + 2];
      let nx = dxy * dzz - dxz * dzy, ny = dxz * dzx - dxx * dzz, nz = dxx * dzy - dxy * dzx;
      const l = Math.hypot(nx, ny, nz) || 1;
      if (ny < 0) { nx = -nx; ny = -ny; nz = -nz; }
      tNor[o] = nx / l; tNor[o + 1] = ny / l; tNor[o + 2] = nz / l;
    }
  }
  function setPairVisible(i, vis) {
    const a = slot(i);
    if (vis) { tIdx.set(tIdxT.subarray(a * PAIR, a * PAIR + PAIR), a * PAIR); rIdx.set(rIdxT.subarray(a * RPAIR, a * RPAIR + RPAIR), a * RPAIR); lIdx.set(lIdxT.subarray(a * LPAIR, a * LPAIR + LPAIR), a * LPAIR); }
    else { tIdx.fill(0, a * PAIR, a * PAIR + PAIR); rIdx.fill(0, a * RPAIR, a * RPAIR + RPAIR); lIdx.fill(0, a * LPAIR, a * LPAIR + LPAIR); }
  }

  /* ------------------------------------------------------------------ boundary wall (translucent, striped base) */
  CR.makeWallTexture = function (repeatU) {
    const cv = document.createElement('canvas'); cv.width = 128; cv.height = 256;
    const g = cv.getContext('2d');
    const grd = g.createLinearGradient(0, 214, 0, 0);
    grd.addColorStop(0, 'rgba(255,70,45,0.62)'); grd.addColorStop(0.55, 'rgba(255,60,40,0.16)'); grd.addColorStop(1, 'rgba(255,60,40,0)');
    g.fillStyle = grd; g.fillRect(0, 0, 128, 214);
    g.fillStyle = 'rgba(255,200,180,0.10)';
    for (let x = 0; x < 128; x += 16) g.fillRect(x, 0, 2, 214);
    g.save(); g.beginPath(); g.rect(0, 214, 128, 42); g.clip();
    g.fillStyle = 'rgba(255,255,255,0.96)'; g.fillRect(0, 214, 128, 42);
    g.fillStyle = 'rgba(230,32,32,0.97)';
    for (let x = -64; x < 192; x += 32) { g.beginPath(); g.moveTo(x, 256); g.lineTo(x + 16, 256); g.lineTo(x + 16 + 42, 214); g.lineTo(x + 42, 214); g.closePath(); g.fill(); }
    g.restore();
    const t = new THREE.CanvasTexture(cv);
    t.wrapS = THREE.RepeatWrapping; t.wrapT = THREE.ClampToEdgeWrapping; t.anisotropy = 4; t.encoding = THREE.sRGBEncoding;
    if (repeatU) t.repeat.set(repeatU, 1);
    return t;
  };
  const WALL_H = 14;
  const lPos = new Float32Array(R * 4 * 3), lUv = new Float32Array(R * 4 * 2);
  const LPAIR = 12, lIdxT = new Uint16Array(R * LPAIR), lIdx = new Uint16Array(R * LPAIR);
  for (let a = 0; a < R; a++) {
    const b = (a + 1) % R;
    for (let side = 0; side < 2; side++) {
      const A = a * 4 + side * 2, B = A + 1, C = b * 4 + side * 2, D = C + 1;
      lIdxT.set([A, C, B, B, C, D], a * LPAIR + side * 6);
    }
    for (let k = 0; k < 4; k++) lUv[(a * 4 + k) * 2 + 1] = k % 2;
  }
  const wallGeo = new THREE.BufferGeometry();
  wallGeo.setAttribute('position', new THREE.BufferAttribute(lPos, 3).setUsage(THREE.DynamicDrawUsage));
  wallGeo.setAttribute('uv', new THREE.BufferAttribute(lUv, 2).setUsage(THREE.DynamicDrawUsage));
  wallGeo.setIndex(new THREE.BufferAttribute(lIdx, 1).setUsage(THREE.DynamicDrawUsage));
  const wall = new THREE.Mesh(wallGeo, new THREE.MeshBasicMaterial({
    map: CR.makeWallTexture(), transparent: true, depthWrite: false, side: THREE.DoubleSide
  }));
  wall.frustumCulled = false; wall.renderOrder = 3;

  /* ------------------------------------------------------------------ trees + chalets (instanced ring buffers) */
  const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);
  function mergeGeos(list) {
    const pos = [], nor = [], col = [], idx = [];
    let off = 0;
    for (const g of list) {
      const p = g.attributes.position, n = g.attributes.normal, c = g.attributes.color;
      for (let k = 0; k < p.count; k++) {
        pos.push(p.getX(k), p.getY(k), p.getZ(k)); nor.push(n.getX(k), n.getY(k), n.getZ(k));
        if (c) col.push(c.getX(k), c.getY(k), c.getZ(k)); else col.push(1, 1, 1);
      }
      const ix = g.index;
      if (ix) for (let k = 0; k < ix.count; k++) idx.push(ix.getX(k) + off); else for (let k = 0; k < p.count; k++) idx.push(k + off);
      off += p.count;
    }
    const m = new THREE.BufferGeometry();
    m.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    m.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    m.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    m.setIndex(idx);
    return m;
  }
  // one conifer tier: ragged skirt, vertex-shaded dark inside / light at the tips
  function pineTier(r, h, yb, seed) {
    const g = new THREE.ConeGeometry(r, h, 11, 3, true);
    g.translate(0, yb + h / 2, 0);
    const p = g.attributes.position, c = new Float32Array(p.count * 3);
    for (let k = 0; k < p.count; k++) {
      let x = p.getX(k), y = p.getY(k), z = p.getZ(k);
      const t = (y - yb) / h, ang = Math.atan2(z, x);
      const wob = 1 + (hash2(Math.round(ang * 5 + seed * 7), seed + Math.round(t * 3)) - 0.5) * 0.3 * (1 - t * 0.6);
      x *= wob; z *= wob; y += (hash2(Math.round(ang * 5), seed * 3) - 0.5) * 0.35 * (1 - t);
      p.setXYZ(k, x, y, z);
      const sh = 0.46 + 0.54 * Math.pow(Math.max(0, t), 0.8) + (t < 0.05 ? 0.08 : 0);
      c[k * 3] = sh; c[k * 3 + 1] = sh; c[k * 3 + 2] = sh;
    }
    g.setAttribute('color', new THREE.BufferAttribute(c, 3));
    g.computeVertexNormals();
    return g;
  }
  const pineG = mergeGeos([pineTier(3.1, 4.8, 1.5, 1), pineTier(2.45, 4.2, 3.5, 2), pineTier(1.8, 3.6, 5.5, 3), pineTier(1.1, 3.0, 7.5, 4)]);
  const trunkGeo = new THREE.CylinderGeometry(0.2, 0.36, 3.2, 6); trunkGeo.translate(0, 1.6, 0);
  const broadG = (() => {
    const g = new THREE.IcosahedronGeometry(2.7, 2);
    g.scale(1.05, 0.82, 1.05); g.translate(0, 5.0, 0);
    const p = g.attributes.position, c = new Float32Array(p.count * 3);
    for (let k = 0; k < p.count; k++) {
      const x = p.getX(k), y = p.getY(k), z = p.getZ(k);
      const n = 1 + (vnoise(x * 0.9 + 11, z * 0.9 + y * 0.7) - 0.5) * 0.5;
      p.setXYZ(k, x * n, y + (n - 1) * 1.2, z * n);
      const t = Math.max(0, Math.min(1, (y - 3.6) / 3.0)), sh = 0.5 + 0.5 * t;
      c[k * 3] = sh; c[k * 3 + 1] = sh; c[k * 3 + 2] = sh;
    }
    g.setAttribute('color', new THREE.BufferAttribute(c, 3));
    g.computeVertexNormals();
    return g;
  })();
  const snowU = { value: 0 };
  const foliageMat = () => {
    const m = new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.95, metalness: 0, envMapIntensity: 0 });
    m.onBeforeCompile = (sh) => {      // clumps of snow settle on upward-facing, noisy parts of the branches
      sh.uniforms.uSnow = snowU; sh.uniforms.uDetailT = { value: detailTex };
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vOP; varying vec3 vON;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvOP = position; vON = normal;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vOP; varying vec3 vON;\nuniform float uSnow; uniform sampler2D uDetailT;')
        .replace('#include <color_fragment>', `#include <color_fragment>
          if (uSnow > 0.001) {
            float n = texture2D(uDetailT, vOP.xz * 0.55 + vOP.y * 0.21).r * 0.6 + texture2D(uDetailT, vOP.xz * 1.9 + vOP.y * 0.7).r * 0.4;
            float up = normalize(vON).y * 0.5 + 0.5;
            float thr = 1.0 - uSnow * 0.62;
            float m = smoothstep(thr, thr + 0.2, up * 0.55 + (n - 0.5) * 1.3 + 0.22 + vOP.y * 0.014);
            diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.80, 0.86, 0.95) * (0.9 + 0.2 * n), m);
          }`);
    };
    return m;
  };
  const treeTrunk = new THREE.InstancedMesh(trunkGeo, new THREE.MeshStandardMaterial({ color: 0x4a3626, roughness: 1, metalness: 0, envMapIntensity: 0 }), TREE_N);
  const treeC1 = new THREE.InstancedMesh(pineG, foliageMat(), TREE_N);
  const treeBr = new THREE.InstancedMesh(broadG, foliageMat(), TREE_N);
  const treeMeshes = [treeTrunk, treeC1, treeBr];
  const tcol = new THREE.Color();
  for (const m of [treeC1, treeBr]) { for (let i = 0; i < TREE_N; i++) m.setColorAt(i, tcol); }
  for (const m of treeMeshes) { m.frustumCulled = false; m.castShadow = true; m.receiveShadow = true; for (let i = 0; i < TREE_N; i++) m.setMatrixAt(i, ZERO); m.instanceMatrix.setUsage(THREE.DynamicDrawUsage); }

  // roadside delineator posts (white post, amber / red reflector), one pair every 30 m
  const PC = 10, NPC = Math.ceil(R / PC) + 3, POST_N = NPC * 2;
  const postBody = new THREE.InstancedMesh(new THREE.BoxGeometry(0.13, 1.15, 0.13).translate(0, 0.575, 0), new THREE.MeshStandardMaterial({ color: 0xe9ebee, roughness: 0.6, metalness: 0, envMapIntensity: 0.2 }), POST_N);
  const postRef = new THREE.InstancedMesh(new THREE.BoxGeometry(0.15, 0.2, 0.05).translate(0, 0.92, 0.07), new THREE.MeshBasicMaterial({ color: 0xffffff }), POST_N);
  for (const m of [postBody, postRef]) { m.frustumCulled = false; for (let i = 0; i < POST_N; i++) m.setMatrixAt(i, ZERO); }
  postBody.castShadow = true;
  for (let i = 0; i < POST_N; i++) postRef.setColorAt(i, tcol);
  let postsDirty = false;
  function writePostChunk(pc) {
    const i = pc * PC + 5, th = P.th[i], base = (((pc % NPC) + NPC) % NPC) * 2;
    for (let side = 0; side < 2; side++) {
      const lat = (side === 0 ? -1 : 1) * (HALF_ROAD + 1.7);
      const wx = P.px[i] - Math.cos(th) * lat, wz = P.pz[i] + Math.sin(th) * lat;
      const y = terrainH(wx, wz, lat, P.ky[i]);
      dummy.position.set(wx - W.ax, y - 0.05, wz - W.az);
      dummy.rotation.set(0, th + (side === 0 ? 0 : Math.PI), 0); dummy.scale.set(1, 1, 1); dummy.updateMatrix();
      postBody.setMatrixAt(base + side, dummy.matrix); postRef.setMatrixAt(base + side, dummy.matrix);
      tcol.setHex(side === 0 ? 0xffffff : 0xff9a1a); postRef.setColorAt(base + side, tcol);
    }
    postsDirty = true;
  }

  // roadside guardrails: random stretches on either side, 6 m per segment
  const RG = 2, NGR = Math.ceil(R / RG) + 3;
  const railMat = new THREE.MeshStandardMaterial({ color: 0xaeb4ba, metalness: 0.85, roughness: 0.34, envMapIntensity: 0.9 });
  const railBeam = new THREE.InstancedMesh(new THREE.BoxGeometry(0.1, 0.32, 6.15).translate(0, 0.62, 0), railMat, NGR * 2);
  const railBeam2 = new THREE.InstancedMesh(new THREE.BoxGeometry(0.06, 0.1, 6.15).translate(0.04, 0.84, 0), railMat, NGR * 2);
  const railPost = new THREE.InstancedMesh(new THREE.BoxGeometry(0.13, 0.95, 0.13).translate(0.12, 0.47, 0), new THREE.MeshStandardMaterial({ color: 0x6f757b, metalness: 0.5, roughness: 0.6, envMapIntensity: 0.3 }), NGR * 4);
  const railSnow = new THREE.InstancedMesh(new THREE.BoxGeometry(0.34, 0.09, 6.1).translate(0.03, 0.9, 0), new THREE.MeshStandardMaterial({ color: 0xf1f5fa, roughness: 1, metalness: 0, envMapIntensity: 0 }), NGR * 2);
  const railMeshes = [railBeam, railBeam2, railPost, railSnow];
  for (const m of railMeshes) { m.frustumCulled = false; m.castShadow = true; for (let i = 0; i < m.count; i++) m.setMatrixAt(i, ZERO); }
  let railDirty = false;
  function writeRailChunk(g) {
    const slot = ((g % NGR) + NGR) % NGR, i = g * RG + 1;
    const th = P.th[i], sn = Math.sin(th), cs = Math.cos(th);
    const pitch = -Math.atan2(P.ky[i + 1] - P.ky[i - 1], 2 * DS);
    for (let side = 0; side < 2; side++) {
      const idx = slot * 2 + side;
      const on = hash2(Math.floor(g / 18) * 7 + side, 4242) < (SC.rails === undefined ? 0.3 : SC.rails);
      if (!on) { for (const m of [railBeam, railBeam2, railSnow]) m.setMatrixAt(idx, ZERO); railPost.setMatrixAt(idx * 2, ZERO); railPost.setMatrixAt(idx * 2 + 1, ZERO); continue; }
      const lat = (side === 0 ? -1 : 1) * (HALF_ROAD + 3.0);
      const wx = P.px[i] - cs * lat, wz = P.pz[i] + sn * lat;
      dummy.position.set(wx - W.ax, P.ky[i] - 0.05, wz - W.az);
      dummy.rotation.set(pitch, th + (side === 0 ? Math.PI : 0), 0); dummy.scale.set(1, 1, 1); dummy.updateMatrix();
      railBeam.setMatrixAt(idx, dummy.matrix); railBeam2.setMatrixAt(idx, dummy.matrix); railSnow.setMatrixAt(idx, dummy.matrix);
      for (let k = 0; k < 2; k++) {
        const off = (k === 0 ? -1 : 1) * 2.6;
        dummy.position.set(wx + sn * off - W.ax, P.ky[i] + Math.tan(-pitch) * off - 0.05, wz + cs * off - W.az);
        dummy.updateMatrix(); railPost.setMatrixAt(idx * 2 + k, dummy.matrix);
      }
    }
    railDirty = true;
  }

  const chBody = new THREE.InstancedMesh(new THREE.BoxGeometry(6.4, 3.4, 8.4).translate(0, 1.7, 0), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, metalness: 0, envMapIntensity: 0 }), CHAL_N);
  const roofG = new THREE.ConeGeometry(6.2, 2.8, 4); roofG.rotateY(Math.PI / 4); roofG.scale(1, 1, 1.3); roofG.translate(0, 4.7, 0);
  const chRoof = new THREE.InstancedMesh(roofG, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85, metalness: 0, envMapIntensity: 0 }), CHAL_N);
  for (const m of [chBody, chRoof]) { m.frustumCulled = false; m.castShadow = true; m.receiveShadow = true; for (let i = 0; i < CHAL_N; i++) { m.setMatrixAt(i, ZERO); m.setColorAt(i, tcol); } }

  const dummy = new THREE.Object3D(); dummy.rotation.order = 'YXZ';
  let tc = null;
  function setTreePalette() {
    const t = SC.trees; tc = { a: rgb(t.a), b: rgb(t.b), c: rgb(t.c) };
  }
  function hideTree(idx) { for (const m of treeMeshes) m.setMatrixAt(idx, ZERO); }
  function writeTreeChunk(tr) {
    const base = (((tr % NTR) + NTR) % NTR) * TQ;
    for (let q = 0; q < TQ; q++) {
      const idx = base + q, key = tr * 53 + q;
      const h1 = hash2(key, 11), h2 = hash2(key, 23), h3 = hash2(key, 37), h4 = hash2(key, 53), h5 = hash2(key, 71), h6 = hash2(key, 89);
      const i = tr * TR + Math.floor(h3 * TR);
      const a = 20 + Math.pow(h2, 1.45) * 175;
      const lat = (h1 < 0.5 ? -1 : 1) * a;
      const th = P.th[i];
      const wx = P.px[i] - Math.cos(th) * lat, wz = P.pz[i] + Math.sin(th) * lat;
      const forest = fbm(wx * 0.004 + 200, wz * 0.004, 2);
      if (h4 > smoothstep(0.44, 0.62, forest) * SC.treeDensity) { hideTree(idx); continue; }
      const bio = vnoise(wx * 0.0005 + 90, wz * 0.0005 + 10);
      if (bio > 0.8) { hideTree(idx); continue; }
      const y = terrainH(wx, wz, lat, P.ky[i]);
      if (y > SC.rockLine - 4 || y < SC.waterLevel + 1.2) { hideTree(idx); continue; }
      const broad = h6 < SC.trees.broad;
      const s = (0.55 + h5 * 0.8) * (broad ? 1.15 : 1);
      dummy.position.set(wx - W.ax, y - 0.15, wz - W.az);
      dummy.rotation.set(0, h5 * 40, 0);
      dummy.scale.set(s, s * (0.85 + h4 * 0.5), s);
      dummy.updateMatrix();
      treeTrunk.setMatrixAt(idx, dummy.matrix);
      if (broad) { treeBr.setMatrixAt(idx, dummy.matrix); treeC1.setMatrixAt(idx, ZERO); }
      else { treeC1.setMatrixAt(idx, dummy.matrix); treeBr.setMatrixAt(idx, ZERO); }
      const t1 = smoothstep(0.38, 0.52, bio), t2 = smoothstep(0.62, 0.78, bio);
      const lt = 0.75 + h5 * 0.5, sn = SC.trees.snow;
      const rr = lerp(lerp(tc.a[0], tc.b[0], t1), tc.c[0], t2) * lt * (broad ? 1.2 : 1);
      const gg = lerp(lerp(tc.a[1], tc.b[1], t1), tc.c[1], t2) * lt * (broad ? 1.15 : 1);
      const bb = lerp(lerp(tc.a[2], tc.b[2], t1), tc.c[2], t2) * lt * (broad ? 0.8 : 1);
      tcol.setRGB(rr, gg, bb);
      treeC1.setColorAt(idx, tcol); treeBr.setColorAt(idx, tcol);
    }
    treesDirty = true;
  }
  let treesDirty = false, chalDirty = false;
  const WOOD = [0x7a5638, 0x8a6240, 0x6d4a2e, 0x9a7650, 0x5e4630];
  const ROOF = [0x4a3b36, 0x3f4549, 0x7a3a2c, 0x56463c];
  function writeChaletChunk(ch) {
    const base = (((ch % NCH) + NCH) % NCH) * CHQ;
    for (let q = 0; q < CHQ; q++) {
      const idx = base + q, key = ch * 97 + q + 5000;
      const h1 = hash2(key, 3), h2 = hash2(key, 7), h3 = hash2(key, 13), h4 = hash2(key, 19);
      let placed = false;
      if (h1 < SC.chalets * 0.45) {
        const i = ch * CHR + Math.floor(h3 * CHR);
        const lat = (h2 < 0.5 ? -1 : 1) * (26 + h4 * 120);
        const th = P.th[i];
        const wx = P.px[i] - Math.cos(th) * lat, wz = P.pz[i] + Math.sin(th) * lat;
        const y = terrainH(wx, wz, lat, P.ky[i]);
        const y2 = terrainH(wx + 5, wz, lat, P.ky[i]), y3 = terrainH(wx, wz + 5, lat, P.ky[i]), y4 = terrainH(wx - 5, wz - 5, lat, P.ky[i]);
        const flat = Math.max(Math.abs(y2 - y), Math.abs(y3 - y), Math.abs(y4 - y));
        if (flat < 1.3 && y > SC.waterLevel + 2 && y < SC.rockLine - 8) {
          dummy.position.set(wx - W.ax, y - 0.3, wz - W.az);
          dummy.rotation.set(0, th + (lat > 0 ? Math.PI / 2 : -Math.PI / 2) + (h4 - 0.5) * 0.4, 0);
          dummy.scale.set(1, 1, 1); dummy.updateMatrix();
          chBody.setMatrixAt(idx, dummy.matrix); chRoof.setMatrixAt(idx, dummy.matrix);
          tcol.setHex(WOOD[Math.floor(h1 * 977) % WOOD.length]); chBody.setColorAt(idx, tcol);
          tcol.setHex(ROOF[Math.floor(h2 * 977) % ROOF.length]);
          if (SC.trees.snow > 0.3) tcol.lerp(new THREE.Color(0xf4f7fb), 0.85);
          chRoof.setColorAt(idx, tcol);
          placed = true;
        }
      }
      if (!placed) { chBody.setMatrixAt(idx, ZERO); chRoof.setMatrixAt(idx, ZERO); }
    }
    chalDirty = true;
  }

  /* ------------------------------------------------------------------ water */
  const waterU = {
    uCam: { value: new THREE.Vector3() }, uDeep: { value: new THREE.Color() }, uShallow: { value: new THREE.Color() },
    uHor: { value: new THREE.Color() }, uTop: { value: new THREE.Color() }, uSunDir: { value: new THREE.Vector3() }, uSunCol: { value: new THREE.Color() },
    uTime: { value: 0 }, uFogNear: { value: 100 }, uFogFar: { value: 800 }, uSunI: { value: 1 }
  };
  const water = new THREE.Mesh(
    new THREE.PlaneGeometry(5000, 5000, 1, 1).rotateX(-Math.PI / 2),
    new THREE.ShaderMaterial({
      uniforms: waterU,
      vertexShader: `varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position,1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
      fragmentShader: `
        uniform vec3 uCam, uDeep, uShallow, uHor, uTop, uSunDir, uSunCol; uniform float uTime, uFogNear, uFogFar, uSunI;
        varying vec3 vW;
        void main(){
          vec2 p = vW.xz; float t = uTime;
          float nx = sin(p.x*0.31 + t*0.8) + 0.6*sin(p.y*0.47 - t*0.6) + 0.35*sin((p.x+p.y)*1.1 + t*1.7) + 0.2*sin(p.x*2.3 - t*2.4);
          float nz = cos(p.y*0.29 + t*0.7) + 0.6*cos(p.x*0.51 + t*0.5) + 0.35*cos((p.x-p.y)*1.3 - t*1.5) + 0.2*cos(p.y*2.1 + t*2.2);
          vec3 n = normalize(vec3(nx*0.045, 1.0, nz*0.045));
          vec3 v = normalize(uCam - vW);
          float fres = pow(1.0 - max(dot(n, v), 0.0), 3.0);
          vec3 r = reflect(-v, n);
          vec3 refl = mix(uHor, uTop, clamp(r.y * 1.4, 0.0, 1.0));
          vec3 col = mix(uDeep, uShallow, 0.3);
          col = mix(col, refl, 0.14 + 0.82 * fres);
          col += uSunCol * pow(max(dot(r, uSunDir), 0.0), 220.0) * 2.2 * uSunI;
          float dist = length(uCam - vW);
          col = mix(col, uHor, clamp((dist - uFogNear) / (uFogFar - uFogNear), 0.0, 1.0));
          gl_FragColor = vec4(col, 1.0);
          #ifdef TONE_MAPPING
          gl_FragColor.rgb = toneMapping(gl_FragColor.rgb);
          #endif
          gl_FragColor = linearToOutputTexel(gl_FragColor);
        }`
    })
  );
  water.frustumCulled = false;

  /* ------------------------------------------------------------------ precipitation (rain streaks / snowflakes) */
  function makeRain() {
    const N = 3000, pos = new Float32Array(N * 2 * 3), end = new Float32Array(N * 2), rnd = new Float32Array(N * 2);
    for (let i = 0; i < N; i++) {
      const x = Math.random(), y = Math.random(), z = Math.random(), r = Math.random();
      for (let k = 0; k < 2; k++) { const j = i * 2 + k; pos[j * 3] = x; pos[j * 3 + 1] = y; pos[j * 3 + 2] = z; end[j] = k; rnd[j] = r; }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aEnd', new THREE.BufferAttribute(end, 1));
    g.setAttribute('aRand', new THREE.BufferAttribute(rnd, 1));
    const m = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, fog: false,
      uniforms: { uTime: { value: 0 }, uCam: { value: new THREE.Vector3() }, uVel: { value: new THREE.Vector3() },
        uBox: { value: new THREE.Vector3(70, 36, 70) }, uLen: { value: 1.3 }, uFall: { value: 24 }, uDensity: { value: 1 }, uColor: { value: new THREE.Color(0xc4d0dc) } },
      vertexShader: `
        attribute float aEnd; attribute float aRand;
        uniform float uTime, uLen, uFall, uDensity; uniform vec3 uCam, uVel, uBox; varying float vA;
        void main(){
          vec3 s = position;
          vec2 xz = mod(s.xz * uBox.xz - uCam.xz + uBox.xz * 0.5, uBox.xz) - uBox.xz * 0.5;
          float y = mod(s.y * uBox.y - uTime * uFall * (0.85 + 0.3 * aRand), uBox.y) - uBox.y * 0.5;
          vec3 p = vec3(uCam.x + xz.x, uCam.y + y, uCam.z + xz.y);
          vec3 dir = normalize(vec3(-uVel.x * 0.55, -uFall, -uVel.z * 0.55));
          p -= dir * uLen * (0.7 + 0.6 * aRand) * aEnd;
          vA = (aRand < uDensity ? 1.0 : 0.0) * (0.22 + 0.5 * aRand) * (1.0 - aEnd * 0.75);
          gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
        }`,
      fragmentShader: `uniform vec3 uColor; varying float vA; void main(){ if (vA < 0.01) discard; gl_FragColor = vec4(uColor, vA); gl_FragColor = linearToOutputTexel(gl_FragColor); }`
    });
    const o = new THREE.LineSegments(g, m); o.frustumCulled = false; o.visible = false; o.renderOrder = 5;
    return o;
  }
  function makeSnow() {
    const N = 3200, pos = new Float32Array(N * 3), rnd = new Float32Array(N);
    for (let i = 0; i < N; i++) { pos[i * 3] = Math.random(); pos[i * 3 + 1] = Math.random(); pos[i * 3 + 2] = Math.random(); rnd[i] = Math.random(); }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aRand', new THREE.BufferAttribute(rnd, 1));
    const m = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, fog: false,
      uniforms: { uTime: { value: 0 }, uCam: { value: new THREE.Vector3() }, uBox: { value: new THREE.Vector3(46, 24, 46) },
        uFall: { value: 1.7 }, uSize: { value: 0.085 }, uScale: { value: 700 }, uDensity: { value: 1 }, uVel: { value: new THREE.Vector3() } },
      vertexShader: `
        attribute float aRand; uniform float uTime, uFall, uSize, uScale, uDensity; uniform vec3 uCam, uBox, uVel; varying float vA;
        void main(){
          vec3 s = position;
          vec2 xz = mod(s.xz * uBox.xz - uCam.xz + uBox.xz * 0.5, uBox.xz) - uBox.xz * 0.5;
          xz += vec2(sin(uTime * 0.6 + aRand * 40.0), cos(uTime * 0.45 + aRand * 55.0)) * 1.1;
          float y = mod(s.y * uBox.y - uTime * uFall * (0.7 + 0.6 * aRand), uBox.y) - uBox.y * 0.5;
          vec3 p = vec3(uCam.x + xz.x, uCam.y + y, uCam.z + xz.y);
          vec4 mv = viewMatrix * vec4(p, 1.0);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = clamp(uSize * (0.55 + 0.9 * aRand) * uScale / max(-mv.z, 0.5), 1.0, 22.0);
          vA = aRand < uDensity ? 1.0 : 0.0;
        }`,
      fragmentShader: `varying float vA; void main(){ float d = length(gl_PointCoord - 0.5); float a = smoothstep(0.5, 0.12, d) * vA; if (a < 0.02) discard; gl_FragColor = linearToOutputTexel(vec4(1.0, 1.0, 1.0, a * 0.92)); }`
    });
    const o = new THREE.Points(g, m); o.frustumCulled = false; o.visible = false; o.renderOrder = 5;
    return o;
  }
  const rain = makeRain(), snow = makeSnow();

  /* ------------------------------------------------------------------ assemble */
  W.group = new THREE.Group();
  W.group.add(terrain, road, wall, treeTrunk, treeC1, treeBr, postBody, postRef, railBeam, railBeam2, railPost, railSnow, chBody, chRoof, water);
  W.rain = rain; W.snow = snow;

  W.init = function (scene, renderer) {
    scene3 = scene; renderer3 = renderer;
    roadTex.anisotropy = roadTexSnow.anisotropy = renderer.capabilities.getMaxAnisotropy();
    scene.fog = new THREE.Fog(0xaed2f4, 70, 760);
    scene.add(sky, hemi, sun, sun.target, W.group, rain, snow);
    W.setScene(SC);
  };

  /* ------------------------------------------------------------------ ring management */
  function fillTreeChunks(from, to) {
    for (let tr = Math.floor(from / TR); tr <= Math.floor(to / TR); tr++) writeTreeChunk(tr);
    for (let ch = Math.floor(from / CHR); ch <= Math.floor(to / CHR); ch++) writeChaletChunk(ch);
    for (let pc = Math.floor(from / PC); pc <= Math.floor(to / PC); pc++) writePostChunk(pc);
    for (let g = Math.max(1, Math.floor(from / RG)); g <= Math.floor(to / RG) - 1; g++) writeRailChunk(g);
  }
  function uploadRing() {
    for (const k of ['position', 'normal', 'color']) terrainGeo.attributes[k].needsUpdate = true;
    terrainGeo.index.needsUpdate = true;
    roadGeo.attributes.position.needsUpdate = true; roadGeo.attributes.uv.needsUpdate = true; roadGeo.index.needsUpdate = true;
    wallGeo.attributes.position.needsUpdate = true; wallGeo.attributes.uv.needsUpdate = true; wallGeo.index.needsUpdate = true;
    if (treesDirty) { for (const m of treeMeshes) m.instanceMatrix.needsUpdate = true; for (const m of [treeC1, treeBr]) m.instanceColor.needsUpdate = true; treesDirty = false; }
    if (railDirty) { for (const m of railMeshes) m.instanceMatrix.needsUpdate = true; railDirty = false; }
    if (postsDirty) { for (const m of [postBody, postRef]) m.instanceMatrix.needsUpdate = true; postRef.instanceColor.needsUpdate = true; postsDirty = false; }
    if (chalDirty) { for (const m of [chBody, chRoof]) { m.instanceMatrix.needsUpdate = true; m.instanceColor.needsUpdate = true; } chalDirty = false; }
  }
  /** Rebuild the whole ring around row index `center` (used on scene change, rebase and reverse). */
  function resetWindow(centerRow) {
    const first = Math.max(0, centerRow - BEHIND);
    ensureY(first + R + 4);
    tailRow = first; headRow = first - 1;
    tIdx.fill(0); rIdx.fill(0); lIdx.fill(0);
    for (let i = first; i < first + R; i++) {
      headRow = i; writeRow(i);
      if (i > first) setPairVisible(i - 1, true);
    }
    setPairVisible(headRow, false);
    tailRow = first;
    for (let i = first; i <= headRow; i++) calcNormalRow(i);
    treeMeshes.forEach((m) => m.count = TREE_N);
    fillTreeChunks(first, headRow);
    uploadRing();
  }
  function advance(targetHead) {
    let moved = false;
    while (headRow < targetHead) {
      const i = headRow + 1;
      ensureY(i + 3);
      setPairVisible(headRow, true);
      headRow = i; tailRow = headRow - R + 1;
      writeRow(i);
      calcNormalRow(i - 1); calcNormalRow(i);
      setPairVisible(headRow, false);
      if ((i + 1) % TR === 0) writeTreeChunk((i - TR + 1) / TR);
      if ((i + 1) % CHR === 0) writeChaletChunk((i - CHR + 1) / CHR);
      if ((i + 1) % PC === 0) writePostChunk((i - PC + 1) / PC);
      if (i % RG === 1) writeRailChunk((i - 1) / RG);
      moved = true;
    }
    if (moved) uploadRing();
  }

  /* ------------------------------------------------------------------ applying a scene preset */
  const fogColor = new THREE.Color();
  W.setScene = function (preset, startRow) {
    SC = preset; W.scene = preset;
    setPalette(); setTreePalette();
    P.ky.length = 0; P.y1 = P.y2 = 0;
    const u = skyU;
    u.uTop.value.setHex(SC.skyTop); u.uMid.value.setHex(SC.skyMid); u.uHor.value.setHex(SC.skyHor);
    u.uSunCol.value.setHex(SC.sunCol); u.uMtn.value.setHex(SC.mtn.col); u.uCloud.value.setHex(SC.clouds.col).multiplyScalar(SC.clouds.bright);
    u.uStars.value = SC.stars; u.uMoon.value = SC.moon; u.uAurora.value = SC.aurora; u.uGlow.value = SC.glow;
    u.uCloudLo.value = SC.clouds.lo; u.uCloudHi.value = SC.clouds.hi; u.uCloudAmt.value = SC.clouds.amt; u.uCloudSpeed.value = SC.clouds.speed;
    u.uMtnSnow.value = SC.mtn.snow; u.uMtnH.value = SC.mtn.h; u.uSunUp.value = SC.sunI > 0.4 || SC.glow > 1 ? 1 : 0.25;
    const skyE = SC.skyE !== undefined ? SC.skyE : SC.sunE;
    u.uSunDir.value.set(Math.cos(skyE) * Math.cos(SC.sunAz), Math.sin(skyE), Math.cos(skyE) * Math.sin(SC.sunAz)).normalize();
    u.uMoonDir.value.set(-0.4, 0.55, -0.7).normalize();
    sunDir.set(Math.cos(SC.sunE) * Math.cos(SC.sunAz), Math.sin(SC.sunE), Math.cos(SC.sunE) * Math.sin(SC.sunAz)).normalize();
    sun.color.setHex(SC.sunCol); sun.intensity = SC.sunI; sun.castShadow = SC.shadows;
    hemi.color.setHex(SC.hemiSky); hemi.groundColor.setHex(SC.hemiGnd); hemi.intensity = SC.hemiI;
    fogColor.setHex(SC.skyHor);
    scene3.fog.color.copy(fogColor); scene3.fog.near = SC.fogNear; scene3.fog.far = SC.fogFar;
    road.material = SC.roadSnow ? roadMatSnow : SC.wet ? roadMatWet : roadMatDry;
    snowU.value = SC.trees.snow;
    for (const m of [railSnow]) m.visible = SC.trees.snow > 0.5;
    snow.material.uniforms.uDensity.value = SC.precip.snow || 1;
    renderer3.toneMappingExposure = SC.exposure || 1;
    waterU.uDeep.value.setHex(SC.waterDeep); waterU.uShallow.value.setHex(SC.waterShallow);
    waterU.uHor.value.copy(fogColor); waterU.uTop.value.setHex(SC.skyTop);
    waterU.uSunDir.value.copy(u.uSunDir.value); waterU.uSunCol.value.setHex(SC.sunCol);
    waterU.uFogNear.value = SC.fogNear; waterU.uFogFar.value = SC.fogFar; waterU.uSunI.value = SC.sunI > 0.4 ? 1 : 0.3;
    rain.visible = SC.precip.rain > 0; snow.visible = SC.precip.snow > 0;
    W.flash = 0; nextFlash = 4 + Math.random() * 6;
    if (startRow !== undefined) { extend(startRow + 4); W.ax = P.px[startRow]; W.az = P.pz[startRow]; W.windowCenter = startRow; resetWindow(startRow); }
  };

  /* ------------------------------------------------------------------ per-frame update */
  let nextFlash = 6, flashT = 0;
  const FLASH_COL = new THREE.Color(0xdbe6ff);
  W.setVisible = function (v) { W.group.visible = v; };
  W.rebaseTo = function (x, z) {
    W.ax = x; W.az = z;
    resetWindow(headRow - AHEAD);
    if (W.onRebase) W.onRebase();
  };
  W.resetAround = function (row) { resetWindow(row); };
  /**
   * @param car   {s, wx, wz}   car road position and world position
   * @param cam   THREE camera
   * @param vel   {x,z}  car velocity in render space
   */
  W.update = function (dt, time, car, cam, vel, carRender) {
    const row = Math.floor(car.s / DS);
    if (row - BEHIND < tailRow + 8 || row + AHEAD < headRow - 4) resetWindow(row);
    else advance(row + AHEAD);
    if (Math.hypot(car.wx - W.ax, car.wz - W.az) > 2600) W.rebaseTo(car.wx, car.wz);
    W.updateFx(dt, time, cam, vel, carRender);
  };
  W.updateFx = function (dt, time, cam, vel, carRender) {
    skyU.uTime.value = time;
    sky.position.copy(cam.position);
    waterU.uTime.value = time; waterU.uCam.value.copy(cam.position);
    water.position.set(cam.position.x, SC.waterLevel, cam.position.z);
    water.visible = SC.waterLevel > -100;

    // lightning
    if (SC.precip.lightning) {
      nextFlash -= dt;
      if (nextFlash <= 0) { flashT = 0.5; nextFlash = 7 + Math.random() * 14; if (W.onThunder) W.onThunder(0.25 + Math.random() * 1.8); }
      if (flashT > 0) {
        flashT -= dt;
        const k = flashT / 0.5;
        W.flash = Math.max(0, (Math.sin(flashT * 60) > -0.2 ? 1 : 0.3) * k * k);
      } else W.flash = 0;
    }
    skyU.uFlash.value = W.flash * 0.55;
    hemi.intensity = SC.hemiI + W.flash * 1.6;
    scene3.fog.color.copy(fogColor).lerp(FLASH_COL, W.flash * 0.5);

    // precipitation follows the camera
    if (rain.visible) {
      const u = rain.material.uniforms; u.uTime.value = time; u.uCam.value.copy(cam.position); u.uVel.value.set(vel.x, 0, vel.z);
    }
    if (snow.visible) {
      const u = snow.material.uniforms; u.uTime.value = time; u.uCam.value.copy(cam.position); u.uVel.value.set(vel.x, 0, vel.z);
      u.uScale.value = renderer3.domElement.height / (2 * Math.tan(cam.fov * Math.PI / 360));
    }

    // sun + shadow camera follow the car
    sun.position.set(carRender.x + sunDir.x * 80, carRender.y + sunDir.y * 80, carRender.z + sunDir.z * 80);
    sun.target.position.set(carRender.x, carRender.y, carRender.z);
  };
  W.carRenderAnchor = () => ({ ax: W.ax, az: W.az });
  W.constants = { DS, HALF_ROAD, BEHIND, AHEAD, LAT_MAX };
  CR.World = W;
})(window.CR = window.CR || {});
