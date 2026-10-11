/* Game core: renderer, cars, physics (fixed timestep + interpolation), camera, effects, UI. */
(function (CR) {
  'use strict';
  const THREE = window.THREE;
  const { clamp, lerp, smoothstep, angDiff } = CR.U;
  const W = CR.World, AP = CR.Airport, AU = CR.Audio;
  const TWO_PI = Math.PI * 2, GRAV = 24, H = 1 / 120;
  const $ = (id) => document.getElementById(id);

  /* ------------------------------------------------------------------ renderer */
  const canvas = $('c');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  const MAX_PR = Math.min(window.devicePixelRatio || 1, 1.75);
  let pixelRatio = MAX_PR;
  renderer.setPixelRatio(pixelRatio);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputEncoding = THREE.sRGBEncoding;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(62, 1, 0.5, 2400);
  function resize() {
    const w = window.innerWidth, h = window.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h; camera.updateProjectionMatrix();
  }
  window.addEventListener('resize', resize); resize();

  W.init(scene, renderer);
  scene.add(AP.group);

  /* ------------------------------------------------------------------ cars */
  const carRoot = new THREE.Group();
  carRoot.rotation.order = 'YXZ';
  scene.add(carRoot);
  const models = {};
  for (const id of CR.CAR_ORDER) {
    const spec = CR.CARS[id];
    const m = spec.build();
    m.root.visible = false;
    m.wheels.forEach((w) => { w.rotation.order = 'YXZ'; });
    m.paintIdx = 0;
    carRoot.add(m.root);
    models[id] = m;
  }
  // soft contact shadow under the car (ambient occlusion look)
  const blobCv = document.createElement('canvas'); blobCv.width = blobCv.height = 128;
  { const g = blobCv.getContext('2d'); const gr = g.createRadialGradient(64, 64, 6, 64, 64, 62);
    gr.addColorStop(0, 'rgba(0,0,0,0.85)'); gr.addColorStop(0.55, 'rgba(0,0,0,0.45)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 128, 128); }
  const blob = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({
    map: new THREE.CanvasTexture(blobCv), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -8, polygonOffsetUnits: -8, toneMapped: false }));
  blob.position.y = 0.04; blob.renderOrder = 1; carRoot.add(blob);
  const headL = new THREE.SpotLight(0xfff0cc, 0, 100, 0.55, 0.75, 1), headR = new THREE.SpotLight(0xfff0cc, 0, 100, 0.55, 0.75, 1);
  const headTgt = new THREE.Object3D(); headTgt.position.set(0, -1.6, 24);
  headL.target = headTgt; headR.target = headTgt;
  carRoot.add(headL, headR, headTgt);

  /* ------------------------------------------------------------------ state */
  const keys = { up: false, down: false, left: false, right: false, hand: false };
  const store = { get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : v; } catch (e) { return d; } }, set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* private mode */ } } };
  const sel = { car: 'sedan', loc: 'road', scene: 'sunny', music: store.get('cr_music', 'auto') };
  let musicOn = false;
  const applied = { car: null, loc: null, scene: null };
  let phase = 'menu', mode = 'road', spec = CR.CARS.sedan, model = models.sedan, SC = CR.SCENES[0];
  let cruise = false, cruiseV = 0, camMode = 0, hudHidden = false, started = false;
  const car = {
    s: 200, d: 0, phi: 0, gam: 0, slip: 0, v: 0, steer: 0, steerV: 0, thr: 0, brk: 0, lean: 0, y: 0, vy: 0, air: false,
    pitchV: 0, rollV: 0, pitchW: 0, rollW: 0, pitchAcc: 0, rollAcc: 0, airT: 0, grip: 9, skid: 0, dive: 0, lockVis: 0,
    susp: 0, suspV: 0, odo: 0, crashT: 0, boost: 0, gp: 0, onPad: false, retT: 0, retKind: '', ign: { u: false, d: false, l: false, r: false }
  };
  let teleported = false;
  const prev = { s: 0, d: 0, phi: 0, y: 0, pitchV: 0, rollV: 0, susp: 0 };
  const drift = { pts: 0, active: false, hold: 0, shown: 0 };
  const stunt = { total: 0, best: 0 };
  let shake = 0, simTime = 0, time = 0, rainLevel = 0;

  /* ------------------------------------------------------------------ road / ground abstraction (road mode vs airport mode) */
  const RS = { x: 0, z: 0, th: 0, y: 0, k: 0, rx: -1, rz: 0 };
  function roadAt(s) {
    if (mode === 'road') return W.sampleRoad(s);
    RS.x = 0; RS.z = s; RS.th = 0; RS.y = 0; RS.k = 0; RS.rx = -1; RS.rz = 0;
    return RS;
  }
  function groundAt(s, d) {
    if (mode === 'road') return W.groundAt(s, d);
    return AP.height(-d, s);
  }

  /* ------------------------------------------------------------------ skid marks + tyre smoke */
  const MAXQ = 9000;
  const mW = new Float64Array(MAXQ * 4 * 3), mPos = new Float32Array(MAXQ * 4 * 3), mCol = new Float32Array(MAXQ * 4 * 4);
  const mIdx = new Uint16Array(MAXQ * 6);
  for (let q = 0; q < MAXQ; q++) { const v = q * 4; mIdx.set([v, v + 2, v + 1, v + 1, v + 2, v + 3], q * 6); }
  const markGeo = new THREE.BufferGeometry();
  markGeo.setAttribute('position', new THREE.BufferAttribute(mPos, 3).setUsage(THREE.DynamicDrawUsage));
  markGeo.setAttribute('color', new THREE.BufferAttribute(mCol, 4).setUsage(THREE.DynamicDrawUsage));
  markGeo.setIndex(new THREE.BufferAttribute(mIdx, 1));
  markGeo.setDrawRange(0, 0);
  const markMesh = new THREE.Mesh(markGeo, new THREE.MeshBasicMaterial({
    color: 0xffffff, vertexColors: true, transparent: true, depthWrite: false, side: THREE.DoubleSide,
    polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -6
  }));
  markMesh.frustumCulled = false; markMesh.renderOrder = 2; scene.add(markMesh);
  let markHead = 0, markCount = 0, markDirty = false;
  function refreshMarks() {
    const n = markCount * 4;
    for (let i = 0; i < n; i++) { mPos[i * 3] = mW[i * 3] - W.ax; mPos[i * 3 + 1] = mW[i * 3 + 1]; mPos[i * 3 + 2] = mW[i * 3 + 2] - W.az; }
    markDirty = true;
  }
  function clearMarks() { markHead = 0; markCount = 0; markGeo.setDrawRange(0, 0); for (const m of marks) m.act = false; }
  W.onRebase = refreshMarks;
  function pushQuad(m, nlx, nly, nlz, nrx, nry, nrz, na) {
    const q = markHead; markHead = (markHead + 1) % MAXQ; markCount = Math.min(markCount + 1, MAXQ);
    const v = q * 4;
    const vals = [m.lx, m.ly, m.lz, m.rx, m.ry, m.rz, nlx, nly, nlz, nrx, nry, nrz];
    const al = [m.a, m.a, na, na];
    for (let k = 0; k < 4; k++) {
      const o = (v + k) * 3;
      mW[o] = vals[k * 3]; mW[o + 1] = vals[k * 3 + 1]; mW[o + 2] = vals[k * 3 + 2];
      mPos[o] = mW[o] - W.ax; mPos[o + 1] = mW[o + 1]; mPos[o + 2] = mW[o + 2] - W.az;
      const c = (v + k) * 4; mCol[c] = 0.02; mCol[c + 1] = 0.02; mCol[c + 2] = 0.025; mCol[c + 3] = al[k] * 0.82 * SC.marks;
    }
    m.lx = nlx; m.ly = nly; m.lz = nlz; m.rx = nrx; m.ry = nry; m.rz = nrz; m.a = na;
    markDirty = true;
  }
  const marks = [0, 1, 2, 3].map(() => ({ act: false, lx: 0, ly: 0, lz: 0, rx: 0, ry: 0, rz: 0, a: 0 }));

  const smokeCv = document.createElement('canvas'); smokeCv.width = smokeCv.height = 64;
  { const g = smokeCv.getContext('2d'); const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, 'rgba(255,255,255,0.9)'); gr.addColorStop(0.45, 'rgba(255,255,255,0.35)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 64, 64); }
  const smokeTex = new THREE.CanvasTexture(smokeCv);
  const SMOKE_N = 120, smoke = [];
  for (let i = 0; i < SMOKE_N; i++) {
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: smokeTex, transparent: true, depthWrite: false, opacity: 0 }));
    sp.visible = false; scene.add(sp);
    smoke.push({ sp, life: 0, max: 1, wx: 0, wy: 0, wz: 0, vx: 0, vy: 0, vz: 0, s0: 1, s1: 2, al: 0.5 });
  }
  let smokeIdx = 0, smokeAcc = 0, dayLevel = 1;
  function emitSmoke(wx, wy, wz, vx, vz, power) {
    const p = smoke[smokeIdx]; smokeIdx = (smokeIdx + 1) % SMOKE_N;
    p.life = 0; p.max = 0.9 + Math.random() * 0.8; p.wx = wx; p.wy = wy; p.wz = wz;
    p.vx = vx * 0.35 + (Math.random() - 0.5) * 1.2; p.vz = vz * 0.35 + (Math.random() - 0.5) * 1.2; p.vy = 0.6 + Math.random() * 0.9;
    p.s0 = 0.7 + Math.random() * 0.5; p.s1 = 3.2 + Math.random() * 2.2; p.al = (0.18 + 0.32 * power) * SC.smoke;
    p.sp.visible = true;
  }
  function updateSmoke(dt) {
    const g = 0.25 + 0.7 * dayLevel;
    for (const p of smoke) {
      if (!p.sp.visible) continue;
      p.life += dt;
      if (p.life >= p.max) { p.sp.visible = false; continue; }
      const t = p.life / p.max;
      p.wx += p.vx * dt; p.wy += p.vy * dt; p.wz += p.vz * dt; p.vx *= 0.985; p.vz *= 0.985;
      p.sp.position.set(p.wx - W.ax, p.wy, p.wz - W.az);
      const sc = lerp(p.s0, p.s1, Math.sqrt(t)); p.sp.scale.set(sc, sc, 1);
      p.sp.material.opacity = p.al * (1 - t) * Math.min(1, t * 8);
      p.sp.material.color.setRGB(g, g, g);
    }
  }
  function updateSkid(dt, cwx, cwz, psi, sI, dI, phiI, th) {
    const sk = car.skid, c = Math.cos(psi), sn = Math.sin(psi);
    const active = Math.abs(car.v) > 3.5 && sk > 0.14 && !car.air;
    const onRoad = mode === 'airport' ? (Math.abs(cwx) < 700 && cwz > -300 && cwz < 1000) : Math.abs(dI) < W.HALF_ROAD + 0.7;
    const vdir = th + car.gam;
    const vvx = Math.sin(vdir) * car.v, vvz = Math.cos(vdir) * car.v;
    smokeAcc += dt * 60 * sk;
    const wl = spec.wheels;
    for (let i = 0; i < 4; i++) {
      const wsp = wl[i], m = marks[i];
      const wx = cwx + wsp.x * c + wsp.z * sn, wz = cwz - wsp.x * sn + wsp.z * c;
      const wy = (mode === 'road' ? W.sampleRoad(sI + wsp.z * Math.cos(phiI)).y + 0.1 : 0.14 + groundAt(sI + wsp.z * Math.cos(phiI), dI - wsp.z * Math.sin(phiI)));
      const front = wsp.front;
      const w = front ? (car.brk > 0.5 ? 1 : 0.45) : (car.brk > 0.5 ? 0.85 : 1);
      const a = clamp(sk * 1.15, 0, 1) * w;
      const half = wsp.r * 0.4;
      const ex = c * half, ez = -sn * half;
      if (active && onRoad) {
        if (!m.act) {
          m.act = true; m.a = 0;
          m.lx = wx - ex; m.ly = wy; m.lz = wz - ez; m.rx = wx + ex; m.ry = wy; m.rz = wz + ez;
        } else {
          const dx = wx - (m.lx + m.rx) / 2, dz = wz - (m.lz + m.rz) / 2;
          if (dx * dx + dz * dz > 0.09) pushQuad(m, wx - ex, wy, wz - ez, wx + ex, wy, wz + ez, a);
        }
      } else if (m.act) {
        m.act = false;
        pushQuad(m, wx - ex, wy, wz - ez, wx + ex, wy, wz + ez, 0);
      }
      if ((active || (sk > 0.14 && car.air === false && Math.abs(car.v) > 3.5)) && smokeAcc >= 1 && (!front || car.brk > 0.5 || Math.abs(car.slip) > 0.35)) {
        emitSmoke(wx, wy + 0.15, wz, vvx, vvz, a);
      }
    }
    if (smokeAcc >= 1) smokeAcc = 0;
  }

  /* ------------------------------------------------------------------ reflections: bake the sky + surroundings into an environment map */
  const halfOk = renderer.capabilities.isWebGL2 && renderer.extensions.has('EXT_color_buffer_float');
  const cubeRT = new THREE.WebGLCubeRenderTarget(256, { type: halfOk ? THREE.HalfFloatType : THREE.UnsignedByteType, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter });
  const cubeCam = new THREE.CubeCamera(1, 2400, cubeRT);
  const pmrem = new THREE.PMREMGenerator(renderer);
  let envRT = null;
  function bakeEnv() {
    const hide = [carRoot, markMesh, ...smoke.map((p) => p.sp)], was = hide.map((o) => o.visible);
    hide.forEach((o) => { o.visible = false; });
    const tm = renderer.toneMapping, se = renderer.shadowMap.enabled;
    renderer.toneMapping = THREE.NoToneMapping; renderer.shadowMap.enabled = false;
    scene.environment = null;
    cubeCam.position.set(carRoot.position.x, carRoot.position.y + 2.4, carRoot.position.z);
    cubeCam.update(renderer, scene);
    const rt = pmrem.fromCubemap(cubeRT.texture);
    if (envRT) envRT.dispose();
    envRT = rt; scene.environment = rt.texture;
    renderer.toneMapping = tm; renderer.shadowMap.enabled = se;
    hide.forEach((o, i) => { o.visible = was[i]; });
  }

  /* ------------------------------------------------------------------ messages / HUD */
  let msgTimer = 0, toastTimer = 0;
  function showMsg(title, sub, kind) {
    const el = $('msg'); el.className = 'on ' + (kind || '');
    el.querySelector('b').textContent = title; el.querySelector('small').textContent = sub || '';
    clearTimeout(msgTimer); msgTimer = setTimeout(() => el.classList.remove('on'), 2600);
  }
  function toast(t) {
    const el = $('toast'); el.textContent = t; el.classList.add('on');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('on'), 1500);
  }

  /* ------------------------------------------------------------------ physics */
  const wrapPI = (a) => a - TWO_PI * Math.round(a / TWO_PI);
  function groundPitch() {
    const cs = Math.cos(car.phi), sn = Math.sin(car.phi);
    const L = spec.wheelbase * 0.5;
    const gf = groundAt(car.s + L * cs, car.d - L * sn), gr = groundAt(car.s - L * cs, car.d + L * sn);
    return Math.atan2(gf - gr, spec.wheelbase);
  }
  function startReturn(kind) {
    car.retT = 0.5; car.retKind = kind;
    $('fade').classList.add('on');
    showMsg('OUT OF BOUNDS', kind === 'airport' ? 'returning to the runway' : 'returning to the road', 'bad');
  }
  function performReturn() {
    const kind = car.retKind;
    car.retT = 0; drift.active = false; drift.pts = 0;
    if (kind === 'airport') {
      Object.assign(car, { s: AP.spawn.z, d: 0, v: 0 });
    } else {
      car.d = 0; car.v = Math.min(Math.abs(car.v), 14);
    }
    Object.assign(car, { phi: 0, gam: 0, slip: 0, steer: 0, steerV: 0, air: false, vy: 0, pitchW: 0, rollW: 0, skid: 0, crashT: 0, boost: 0, lean: 0 });
    car.y = groundAt(car.s, car.d); car.pitchV = 0; car.rollV = 0; car.gp = 0;
    for (const m of marks) m.act = false;
    camInit = false; teleported = true;
    $('fade').classList.remove('on');
  }
  function impactFx(strength) {
    shake = Math.max(shake, Math.min(1, strength / 25));
    AU.thud(strength);
  }
  function stepSim(h) {
    const sp = spec, sc = SC, free = mode === 'airport';
    const air = car.air, v0 = car.v;
    let up = keys.up, dn = keys.down;
    const hand = keys.hand && !air;
    if (car.crashT > 0) { car.crashT -= h; up = dn = false; }
    const returning = car.retT > 0;
    if (returning) { up = dn = false; car.retT -= h; if (car.retT <= 0) { performReturn(); return; } }
    let thr = 0, brkI = 0, rev = 0;
    if (!air) {
      if (v0 > 0.5) { thr = up ? 1 : 0; brkI = dn ? 1 : 0; }
      else if (v0 < -0.5) { rev = dn ? 1 : 0; brkI = up ? 1 : 0; }
      else { thr = up ? 1 : 0; rev = (dn && !up) ? 1 : 0; }
    }
    if (cruise && !brkI && !thr && !rev && !air) thr = clamp((cruiseV - v0) * 0.5, 0, 1);
    if (brkI || hand || rev) { cruise = false; $('cruise').classList.remove('on'); }
    car.thr += (thr - car.thr) * Math.min(1, h * (sp.thrResp || 5));
    car.brk += (brkI - car.brk) * Math.min(1, h * (sp.brkResp || 10));
    car.rev = rev;

    const av = Math.abs(v0), sgn = v0 < 0 ? -1 : 1;
    const off = !free && Math.abs(car.d) > W.HALF_ROAD + 0.9;
    const lock = brkI && v0 > 8 && !air;
    let grip = sp.grip;
    if (lock) grip = sp.lockGrip;
    if (hand && av > 3) grip = Math.min(grip, sp.handGrip);
    const pw = sp.pwK > 0 ? car.thr * smoothstep(14, 30, v0) * Math.abs(car.steer) : 0;
    grip = Math.min(grip, sp.grip - sp.pwK * pw);
    const baseGrip = sp.grip * sc.gripMul;
    grip *= sc.gripMul * (off ? 0.8 : 1);
    if (air) grip = 0.1;
    car.grip += (grip - car.grip) * Math.min(1, h * (grip < car.grip ? 16 : 3));
    const dr = air ? 0 : clamp((baseGrip - car.grip) / Math.max(0.5, baseGrip - 0.7), 0, 1);

    let acc = 0;
    if (!air) {
      acc += car.thr * sp.acc * (1 - Math.max(v0, 0) / sp.vmax) * (0.7 + 0.3 * sc.gripMul);
      acc -= rev * sp.revAcc * (1 - Math.max(-v0, 0) / sp.revMax);
      if (brkI) acc -= sgn * sp.brake * sc.brakeMul;
      if (hand && av > 3) acc -= sgn * 3;
      acc -= sgn * (0.25 + sp.cd * av * av);
      if (off) acc -= sgn * (2.5 + 0.12 * av);
      acc -= sgn * Math.abs(Math.sin(car.slip)) * 4.5;
      if (returning) acc -= sgn * 16;
    } else acc = -sgn * 0.0015 * av * av;
    let nv = v0 + acc * h;
    if (v0 * nv < 0 && car.thr < 0.02 && rev < 0.02) nv = 0;
    car.v = nv;
    const v = car.v;

    // steering input (A/D roll the car instead while airborne)
    const tgt = (air || returning) ? 0 : (keys.left ? 1 : 0) - (keys.right ? 1 : 0);
    // critically damped steering: the wheel eases toward the key input instead of snapping (slower at speed)
    const sw = (sp.steerResp || 8) * (tgt === 0 ? 1.3 : 1) / (1 + Math.abs(v) / 70);
    car.steerV += (sw * sw * (tgt - car.steer) - 2 * sw * car.steerV) * h;
    car.steer = clamp(car.steer + car.steerV * h, -1, 1);
    const dMax = sp.steerMax / (1 + (Math.abs(v) / sp.speedRef) * (Math.abs(v) / sp.speedRef));
    let yaw = v * Math.tan(car.steer * dMax) / sp.wheelbase;
    const yawLim = Math.max(1.0, sp.grip * sc.gripMul * 1.6 / Math.max(Math.abs(v), 1));   // tyres can only give so much sideways force
    yaw = clamp(yaw, -yawLim, yawLim);
    if (!air) {
      yaw *= 1 + sp.yawBoost * dr;
      if (hand && Math.abs(v) > 8) yaw += car.steer * 1.0 * smoothstep(8, 16, Math.abs(v)) * (v < 0 ? -1 : 1);
      if (v > 0) yaw -= car.slip * 1.3 * (1 - 0.75 * Math.abs(car.steer));
      // gentle lane-keeping assist (like a relaxed autopilot): holds the road's curve and eases back to the middle when you are not steering
      if (!free && sp.assist > 0 && !returning && v > 0) {
        const gate = smoothstep(2, 10, v) * (1 - Math.min(1, Math.abs(car.steer) * 1.4)) * (1 - smoothstep(0.1, 0.28, Math.abs(car.slip)));
        const phiDes = clamp(car.d * 0.03, -0.2, 0.2) * (1 - smoothstep(9, 22, Math.abs(car.d)));   // pull toward the middle only while near the road
        yaw += sp.assist * gate * (3.0 * (phiDes - car.phi) + roadAt(car.s).k * v);
      }
      yaw = clamp(yaw, -2.1, 2.1);
    } else yaw = 0;

    // integrate (road-relative frame; the airport is the same maths with a straight road, k = 0)
    const ox = -car.d, oz = car.s, oldY = car.y;
    const k = free ? 0 : roadAt(car.s).k;
    const sdot = v * Math.cos(car.gam) / (1 + k * car.d);
    car.phi += (yaw - k * sdot) * h;
    car.gam += (car.grip * (car.phi - car.gam) - k * sdot) * h;
    car.phi = clamp(car.phi, car.gam - 0.95, car.gam + 0.95);
    car.slip = car.phi - car.gam;
    car.d += -v * Math.sin(car.gam) * h;
    car.s += sdot * h;
    car.odo += Math.abs(v) * h;

    if (!free) {
      car.d = clamp(car.d, -(W.LIMIT + 40), W.LIMIT + 40);
      if (!returning && (Math.abs(car.d) > W.LIMIT - 1.4 || (!car.air && car.y < SC.waterLevel + 0.12))) startReturn('road');
      if (car.s < 125) { car.s = 125; car.v = Math.max(car.v, 0) * 0.5; }
      car.y += (groundAt(car.s, car.d) - car.y) * Math.min(1, h * 30);
      car.vy = 0; car.gp += (groundPitch() - car.gp) * Math.min(1, h * 14);
    } else {
      /* ---- airport: walls, bounds, vertical dynamics */
      let nx = -car.d, nz = car.s;
      const b = AP.bounds, lm = AP.limit;
      let hit = 0;
      if (!returning && (nx < lm.x0 + 1.2 || nx > lm.x1 - 1.2 || nz < lm.z0 + 1.2 || nz > lm.z1 - 1.2)) startReturn('airport');
      if (nx < b.x0 || nx > b.x1 || nz < b.z0 || nz > b.z1) {
        nx = clamp(nx, b.x0, b.x1); nz = clamp(nz, b.z0, b.z1); hit = Math.abs(v);
      }
      if (AP.height(nx, nz) - car.y > 0.9) {
        const bx = AP.height(nx, oz) - car.y > 0.9, bz = AP.height(ox, nz) - car.y > 0.9;
        if (!bx && bz) nz = oz; else if (bx && !bz) nx = ox; else { nx = ox; nz = oz; }
        hit = Math.max(hit, Math.abs(v));
      }
      if (hit > 0) {
        if (hit > 6) impactFx(hit);
        car.v = -v * 0.25; car.gam = car.phi;
        car.suspV -= Math.min(2, hit * 0.05);
      }
      car.d = -nx; car.s = nz;
      const gC = AP.height(nx, nz);
      car.gp += (groundPitch() - car.gp) * Math.min(1, h * 25);
      if (!car.air) {
        const gv = (gC - oldY) / h;
        const yff = oldY + car.vy * h - 0.5 * GRAV * h * h;
        if (gC < yff - 0.02 && (car.vy > 1.0 || gC < oldY - 0.15)) {
          car.air = true; car.ign.u = keys.up; car.ign.d = keys.down; car.ign.l = keys.left; car.ign.r = keys.right; car.airT = 0; car.pitchAcc = 0; car.rollAcc = 0; car.pitchW = 0; car.rollW = 0;
          car.pitchV = car.gp;
          car.y = oldY + car.vy * h - 0.5 * GRAV * h * h;
        } else {
          car.y = gC; car.vy = lerp(car.vy, clamp(gv, -40, 40), 0.6);
        }
      }
      if (car.air) {
        car.airT += h;
        car.vy -= GRAV * h; car.y += car.vy * h;
        const ig = car.ign;
        if (!keys.up) ig.u = false; if (!keys.down) ig.d = false; if (!keys.left) ig.l = false; if (!keys.right) ig.r = false;   // keys held at take-off do nothing until re-pressed
        const pin = ((keys.down && !ig.d) ? 1 : 0) - ((keys.up && !ig.u) ? 1 : 0), rin = ((keys.right && !ig.r) ? 1 : 0) - ((keys.left && !ig.l) ? 1 : 0);
        const hs = Math.max(Math.abs(car.v), 1);
        const traj = Math.atan2(car.vy, hs);
        const hgt = car.y - gC;
        const tl = hgt <= 0 ? 0 : (-car.vy + Math.sqrt(car.vy * car.vy + 2 * GRAV * hgt)) / GRAV;   // time to touchdown
        const assist = tl < 0.55;
        if (pin !== 0) car.pitchW += (pin * 7.0 - car.pitchW) * Math.min(1, h * 6);
        else {
          const base = assist ? car.gp : traj;
          const t = base + TWO_PI * Math.round((car.pitchV - base) / TWO_PI);
          car.pitchW += ((t - car.pitchV) * (assist ? 6 : 3) - car.pitchW) * Math.min(1, h * 10);
        }
        if (rin !== 0) car.rollW += (rin * 8.0 - car.rollW) * Math.min(1, h * 6);
        else { const t = TWO_PI * Math.round(car.rollV / TWO_PI); car.rollW += ((t - car.rollV) * (assist ? 6 : 3) - car.rollW) * Math.min(1, h * 10); }
        car.pitchV += car.pitchW * h; car.rollV += car.rollW * h;
        car.pitchAcc += car.pitchW * h; car.rollAcc += car.rollW * h;
        if (car.y <= gC) landing(gC);
      }
      // boost pads
      const pad = !car.air && AP.boostAt(nx, nz);
      if (pad) {
        if (!car.onPad) { AU.boost(); car.onPad = true; }
        if (car.v < 41) car.v = Math.min(41, car.v + 85 * h);
        car.boost = Math.min(1, car.boost + h * 6);
      } else { car.onPad = false; car.boost = Math.max(0, car.boost - h * 1.2); }
    }

    if (!car.air) {                       // body follows the ground when the wheels are down
      car.pitchV += (car.gp - car.pitchV) * Math.min(1, h * 14);
      car.rollV += (0 - car.rollV) * Math.min(1, h * 10);
    }
    // lean + sliding
    car.lean += (yaw * v - car.lean) * Math.min(1, h * 4);
    let sk = 0;
    if (lock) sk = Math.max(sk, clamp((v - 8) / 16, 0.4, 1));
    if (hand && v > 4) sk = Math.max(sk, 1);
    sk = Math.max(sk, smoothstep(0.16, 0.45, Math.abs(car.slip)), pw > 0.25 ? pw * 1.3 : 0);
    if (Math.abs(v) < 3.5 || car.air) sk = 0;
    car.skid += (sk - car.skid) * Math.min(1, h * (sk > car.skid ? 14 : 5));
    car.lockVis += (((lock || (hand && v > 3)) ? 1 : 0) - car.lockVis) * Math.min(1, h * 12);
    const diveT = car.brk * clamp(v / 25, 0, 1) * 0.05 - car.thr * 0.016 * (1 - clamp(v / 40, 0, 1));
    car.dive += (diveT - car.dive) * Math.min(1, h * 6);
    // suspension spring
    car.suspV += (-160 * car.susp - 14 * car.suspV) * h; car.susp = clamp(car.susp + car.suspV * h, -0.35, 0.3);

    // drift score
    const drifting = v > 9 && Math.abs(car.slip) > 0.26 && !car.air && (free || Math.abs(car.d) < W.HALF_ROAD + 2.5);
    if (drifting) { drift.active = true; drift.hold = 0.9; drift.pts += Math.abs(car.slip) * v * h * 9; }
    else if (drift.active) { drift.hold -= h; if (drift.hold <= 0) { drift.active = false; drift.shown = Math.round(drift.pts); drift.pts = 0; } }
  }

  function landing(gC) {
    const impact = -car.vy;
    const gp = car.gp;
    const ep = wrapPI(car.pitchV - gp), er = wrapPI(car.rollV);
    const ok = Math.abs(ep) < 1.05 && Math.abs(er) < 1.05;
    const airT = car.airT;
    const flips = Math.floor(Math.abs(car.pitchAcc) / TWO_PI + 0.22), rolls = Math.floor(Math.abs(car.rollAcc) / TWO_PI + 0.22);
    car.air = false; car.y = gC; car.vy = 0;
    car.pitchV = gp + ep; car.rollV = er; car.pitchW = 0; car.rollW = 0;
    car.suspV -= Math.min(4, impact * 0.18);
    if (airT < 0.35) return;
    if (!ok) {
      car.crashT = 0.9; car.v *= 0.3; impactFx(Math.max(18, impact));
      showMsg('WIPEOUT', 'land on your wheels to score', 'bad');
      return;
    }
    AU.land(impact);
    shake = Math.max(shake, Math.min(0.8, impact / 30));
    if (airT < 0.7 && !flips && !rolls) return;
    const perfect = Math.abs(ep) < 0.28 && Math.abs(er) < 0.28;
    let pts = airT * 120 + flips * 500 + rolls * 400 + Math.min(300, car.v * 3);
    if (perfect) pts *= 1.5;
    pts = Math.round(pts / 5) * 5;
    stunt.total += pts; stunt.best = Math.max(stunt.best, pts);
    const parts = [airT.toFixed(1) + 's air'];
    if (flips) parts.push((car.pitchAcc > 0 ? 'backflip' : 'frontflip') + (flips > 1 ? ' x' + flips : ''));
    if (rolls) parts.push('barrel roll' + (rolls > 1 ? ' x' + rolls : ''));
    if (perfect) parts.push('perfect landing');
    showMsg('+' + pts, parts.join('  ·  '), 'good');
  }

  /* ------------------------------------------------------------------ camera + render */
  let camPsi = 0, camYs = 0, fovNow = 62, camInit = false, orbit = 0;
  const camPos = new THREE.Vector3();
  function respawn(full) {
    const spawnS = mode === 'airport' ? AP.spawn.z : (full ? 200 : car.s);
    Object.assign(car, { d: 0, phi: 0, gam: 0, slip: 0, steer: 0, steerV: 0, air: false, vy: 0, pitchV: 0, rollV: 0, pitchW: 0, rollW: 0, grip: spec.grip, skid: 0, crashT: 0, boost: 0 });
    if (full || mode === 'airport') { car.s = spawnS; car.v = 0; car.odo = full ? 0 : car.odo; }
    car.y = groundAt(car.s, 0);
    camInit = false;
  }

  function render(dt, alpha) {
    const interp = phase === 'play';
    const sI = interp ? lerp(prev.s, car.s, alpha) : car.s;
    const dI = interp ? lerp(prev.d, car.d, alpha) : car.d;
    const phiI = interp ? lerp(prev.phi, car.phi, alpha) : car.phi;
    const yI = interp ? lerp(prev.y, car.y, alpha) : car.y;
    const pitchI = interp ? lerp(prev.pitchV, car.pitchV, alpha) : car.pitchV;
    const rollI = interp ? lerp(prev.rollV, car.rollV, alpha) : car.rollV;
    const suspI = interp ? lerp(prev.susp, car.susp, alpha) : car.susp;

    const r = roadAt(sI);
    const th = r.th;
    const cwx = r.x + r.rx * dI, cwz = r.z + r.rz * dI;
    const psi = th + phiI;
    const camTarget = th + phiI - car.slip * 0.62;
    const velx = Math.sin(th + car.gam) * car.v, velz = Math.cos(th + car.gam) * car.v;

    // keep the streamed world around the car
    if (mode === 'road') W.update(dt, time, { s: sI, wx: cwx, wz: cwz }, camera, { x: velx, z: velz }, { x: cwx - W.ax, y: yI, z: cwz - W.az });
    else W.updateFx(dt, time, camera, { x: velx, z: velz }, { x: cwx - W.ax, y: yI, z: cwz - W.az });
    const px = cwx - W.ax, pz = cwz - W.az;

    // car placement
    carRoot.position.set(px, yI + 0.03 + suspI, pz);
    blob.visible = !car.air;
    carRoot.rotation.set(-pitchI + (car.air ? 0 : car.dive), psi, clamp(car.lean * 0.0026 * (spec.leanK || 1), -0.07, 0.07) * (car.air ? 0 : 1) + rollI, 'YXZ');
    const spin = car.v * dt / spec.wheels[0].r * (1 - 0.93 * car.lockVis);
    wheelSpin += spin;
    const steerVis = car.steer * 0.34;
    model.wheels.forEach((wp, i) => { wp.rotation.x = wheelSpin; wp.rotation.y = spec.wheels[i].front ? steerVis : 0; });
    const brk = car.brk, revOn = car.v < -0.4;
    model.tail.color.setRGB(revOn ? 1 : lerp(0.5, 1, brk), revOn ? 0.95 : lerp(0.05, 0.16, brk), revOn ? 0.9 : lerp(0.04, 0.1, brk));
    const hl = SC.headlights * 1.9;
    headL.intensity = headR.intensity = hl;

    // effects
    dayLevel = clamp(SC.sunI + SC.hemiI * 0.3, 0.2, 1);
    if (interp || car.skid > 0.05) updateSkid(dt, cwx, cwz, psi, sI, dI, phiI, th);
    updateSmoke(dt);
    if (markDirty) { markGeo.attributes.position.needsUpdate = true; markGeo.attributes.color.needsUpdate = true; markGeo.setDrawRange(0, markCount * 6); markDirty = false; }
    if (mode === 'airport') AP.update(dt, { x: -dI, z: sI, y: yI, v: car.v, vx: velx, vz: velz }, time);

    // camera
    if (!camInit) { camPsi = psi; camYs = yI; camInit = true; }
    if (phase === 'menu') {
      orbit += dt * 0.32;
      const rad = spec.camDist * 0.95 + 1.2;
      camera.position.set(px + Math.sin(orbit) * rad, yI + spec.camH * 0.62, pz + Math.cos(orbit) * rad);
      camera.lookAt(px, yI + 0.75, pz);
      camera.fov = lerp(camera.fov, 46, Math.min(1, dt * 4)); camera.updateProjectionMatrix();
    } else {
      camPsi += angDiff(camPsi, camMode === 2 ? psi : camTarget) * (1 - Math.exp(-dt * (camMode === 2 ? 18 : (spec.camRate || 2.6))));
      camYs += (yI - camYs) * Math.min(1, dt * 6);
      const fx = Math.sin(camPsi), fz = Math.cos(camPsi);
      const targetFov = (camMode === 2 ? 72 : 62) + Math.abs(car.v) * (mode === 'road' && spec.id === 'speed' ? 0.22 : 0.32) + car.boost * 14;
      fovNow += (targetFov - fovNow) * Math.min(1, dt * 3);
      if (Math.abs(camera.fov - fovNow) > 0.05) { camera.fov = fovNow; camera.updateProjectionMatrix(); }
      if (camMode === 2) {
        camera.position.set(px + Math.sin(psi) * 0.4, yI + spec.camH * 0.42, pz + Math.cos(psi) * 0.4);
        camera.lookAt(px + fx * 30, yI + spec.camH * 0.4, pz + fz * 30);
      } else {
        const dist = (camMode === 0 ? spec.camDist : spec.camDist * 1.8) + clamp(Math.abs(car.v) * 0.02, 0, 1.2);
        const hgt = camMode === 0 ? spec.camH : spec.camH * 1.8;
        const camGround = groundAt(sI - dist * 1.05, dI) + 1.5;
        camYs = Math.max(camYs, camGround - hgt);
        camera.position.set(px - fx * dist, camYs + hgt, pz - fz * dist);
        camera.lookAt(px + fx * spec.camLook, camYs + spec.lookY, pz + fz * spec.camLook);
      }
      const sh = Math.max(shake, car.skid * (spec.id === 'drift' ? 0.25 : 0.08)) * 0.09 * clamp(Math.abs(car.v) / 18, 0.3, 1);
      if (sh > 0.002) { camera.position.x += (Math.random() - 0.5) * sh; camera.position.y += (Math.random() - 0.5) * sh; camera.position.z += (Math.random() - 0.5) * sh; }
      shake *= Math.exp(-dt * 5);
    }

    // audio + hud
    if (started) {
      AU.update({ v: car.v, thr: car.thr, skid: car.skid, slip: car.slip, engine: spec.engine, wind: SC.ambience.wind * (phase === 'play' ? 1 : 0.3),
        rain: SC.ambience.rain * (mode === 'road' || true ? 1 : 0), air: car.air, revving: false });
    }
    updateHud(dt);
    renderer.render(scene, camera);
  }
  let wheelSpin = 0, hudT = 0;
  function updateHud(dt) {
    hudT -= dt; if (hudT > 0) return; hudT = 0.08;
    $('spd').textContent = Math.round(Math.abs(car.v) * 3.6);
    $('gear').textContent = car.v < -0.4 ? 'R' : '';
    $('dist').textContent = (car.odo / 1000).toFixed(1) + ' km';
    const dEl = $('drift');
    if (drift.active && drift.pts > 25) { $('driftPts').textContent = Math.round(drift.pts); dEl.classList.add('on'); }
    else if (drift.shown > 25) { $('driftPts').textContent = '+' + drift.shown; dEl.classList.add('on'); drift.shown = 0; setTimeout(() => { if (!drift.active) dEl.classList.remove('on'); }, 1800); }
    let edge = 999;
    if (mode === 'road') edge = W.LIMIT - Math.abs(car.d);
    else { const lm = AP.limit, x = -car.d, z = car.s; edge = Math.min(x - lm.x0, lm.x1 - x, z - lm.z0, lm.z1 - z); }
    $('warn').classList.toggle('on', phase === 'play' && edge < 22 && car.retT <= 0);
    if (mode === 'airport') $('stunt').textContent = 'STUNT SCORE ' + stunt.total + '   BEST ' + stunt.best;
  }

  /* ------------------------------------------------------------------ simulation clock */
  let paused = false, acc = 0, last = performance.now(), frameCount = 0, frameTimeSum = 0, qualityCooldown = 0;
  function snapshot() {
    prev.s = car.s; prev.d = car.d; prev.phi = car.phi; prev.y = car.y; prev.pitchV = car.pitchV; prev.rollV = car.rollV; prev.susp = car.susp;
  }
  function frame(now) {
    requestAnimationFrame(frame);
    const dt = Math.min(0.1, (now - last) / 1000); last = now; time += dt;
    adaptQuality(dt);
    let alpha = 1;
    if (phase === 'play' && started && !paused) {
      acc += dt; let n = 0;
      while (acc >= H && n < 14) { snapshot(); stepSim(H); if (teleported) { snapshot(); teleported = false; } acc -= H; n++; simTime += H; }
      if (n === 14) acc = 0;
      alpha = acc / H;
    }
    render(dt, alpha);
  }
  function adaptQuality(dt) {
    frameTimeSum += dt; frameCount++; qualityCooldown -= dt;
    if (frameCount >= 45) {
      const avg = frameTimeSum / frameCount; frameCount = 0; frameTimeSum = 0;
      if (qualityCooldown <= 0) {
        if (avg > 0.026 && pixelRatio > 0.7) { pixelRatio = Math.max(0.7, pixelRatio - 0.15); renderer.setPixelRatio(pixelRatio); resize(); qualityCooldown = 2; }
        else if (avg < 0.0135 && pixelRatio < MAX_PR) { pixelRatio = Math.min(MAX_PR, pixelRatio + 0.1); renderer.setPixelRatio(pixelRatio); resize(); qualityCooldown = 4; }
      }
    }
  }

  /* ------------------------------------------------------------------ session setup (car / location / weather) */
  function applyCar() {
    spec = CR.CARS[sel.car]; model = models[sel.car];
    for (const id of CR.CAR_ORDER) models[id].root.visible = id === sel.car;
    headL.position.set(-spec.spot.x, spec.spot.y, spec.spot.z); headR.position.set(spec.spot.x, spec.spot.y, spec.spot.z);
    blob.scale.set(spec.wheels[0].x * 2.6, spec.wheelbase * 1.75, 1);
    applied.car = sel.car; car.grip = spec.grip;
  }
  function applyWorld(resetCar) {
    SC = CR.sceneById(sel.scene);
    const roadRow = Math.floor(200 / W.DS);
    if (sel.loc === 'airport') {
      mode = 'airport';
      AP.build(); AP.setScene(SC); AP.resetCones();
      W.setScene(SC); W.setVisible(false); AP.setVisible(true);
      W.ax = 0; W.az = 0;
    } else {
      mode = 'road';
      AP.setVisible(false); W.setVisible(true);
      W.setScene(SC, roadRow);
    }
    clearMarks(); refreshMarks(); $('fade').classList.remove('on'); car.retT = 0;
    AU.musicSceneChanged(SC.id);
    applied.loc = sel.loc; applied.scene = sel.scene;
    respawn(true);
    stunt.total = 0; drift.pts = 0; drift.active = false;
    $('scn').textContent = (sel.loc === 'airport' ? 'Airport · ' : '') + SC.name;
    $('sub').textContent = SC.sub;
    $('hint').innerHTML = hintHtml();
    render(0.001, 1); bakeEnv();
  }
  function hintHtml() {
    const base = '<kbd>W</kbd> gas &nbsp; <kbd>S</kbd> brake / reverse &nbsp; <kbd>A D</kbd> steer &nbsp; <kbd>Space</kbd> handbrake &nbsp; <kbd>E</kbd> cruise &nbsp; <kbd>C</kbd> camera &nbsp; <kbd>V</kbd> paint &nbsp; <kbd>R</kbd> reset &nbsp; <kbd>Esc</kbd> menu';
    return mode === 'airport' ? base + ' &nbsp; <b>In the air:</b> <kbd>W S</kbd> flip &nbsp; <kbd>A D</kbd> roll' : base;
  }

  /* ------------------------------------------------------------------ menu UI */
  const menu = $('menu');
  function buildMenu() {
    const cc = $('carCards'); cc.innerHTML = '';
    for (const id of CR.CAR_ORDER) {
      const s = CR.CARS[id];
      const el = document.createElement('button'); el.className = 'card'; el.dataset.id = id;
      el.innerHTML = `<div class="ct"><b>${s.name}</b><span>${s.tag}</span></div>
        <div class="stats">${['speed', 'handling', 'drift'].map((k) => `<label>${k}<i><u style="width:${Math.round(s.stats[k] * 100)}%"></u></i></label>`).join('')}</div>`;
      el.addEventListener('click', () => { sel.car = id; applyCar(); refreshMenu(); });
      cc.appendChild(el);
    }
    const wc = $('wxChips'); wc.innerHTML = '';
    for (const s of CR.SCENES) {
      const el = document.createElement('button'); el.className = 'chip'; el.dataset.id = s.id;
      el.innerHTML = `<span class="sw" style="background:${s.chip}"></span><b>${s.name}</b><small>${s.sub}</small>`;
      el.addEventListener('click', () => { sel.scene = s.id; applyWorld(); refreshMenu(); });
      wc.appendChild(el);
    }
    const mc = $('musChips'); mc.innerHTML = '';
    for (const st of AU.stations) {
      const el = document.createElement('button'); el.className = 'mchip'; el.dataset.id = st.id; el.title = st.sub;
      el.innerHTML = `${st.name}<small>${st.sub}</small>`;
      el.addEventListener('click', () => { sel.music = st.id; store.set('cr_music', st.id); musicOn = true; AU.musicSelect(st.id); refreshMenu(); });
      mc.appendChild(el);
    }
    const vol = $('musVol'); vol.value = Math.round(parseFloat(store.get('cr_vol', '0.5')) * 100); AU.setMusicVolume(vol.value / 100);
    vol.addEventListener('input', () => { AU.setMusicVolume(vol.value / 100); store.set('cr_vol', vol.value / 100); });
    $('musFile').addEventListener('click', () => $('musInput').click());
    AU.onNeedFiles = () => $('musInput').click();
    $('musInput').addEventListener('change', (e) => {
      if (!e.target.files.length) return;
      const n = AU.musicLoadFiles(e.target.files); sel.music = 'mine'; store.set('cr_music', 'mine'); musicOn = true;
      toast(n ? n + ' track' + (n > 1 ? 's' : '') + ' loaded' : 'No audio files found'); refreshMenu();
    });
    AU.onMusicChange = (label) => { $('nowPlaying').textContent = label ? '♪  ' + label : ''; refreshMenu(); };
    document.querySelectorAll('#locSeg button').forEach((b) => b.addEventListener('click', () => { sel.loc = b.dataset.loc; applyWorld(); refreshMenu(); }));
    $('driveBtn').addEventListener('click', drive);
    $('resumeBtn').addEventListener('click', resume);
    $('menuBtn').addEventListener('click', openMenu);
  }
  function refreshMenu() {
    document.querySelectorAll('#carCards .card').forEach((e) => e.classList.toggle('on', e.dataset.id === sel.car));
    document.querySelectorAll('#wxChips .chip').forEach((e) => e.classList.toggle('on', e.dataset.id === sel.scene));
    document.querySelectorAll('#locSeg button').forEach((e) => e.classList.toggle('on', e.dataset.loc === sel.loc));
    document.querySelectorAll('#musChips .mchip').forEach((e) => e.classList.toggle('on', e.dataset.id === sel.music));
  }
  function drive() {
    AU.init(); started = true;
    if (!musicOn) { musicOn = true; AU.musicSelect(sel.music); }
    if (applied.car !== sel.car) applyCar();
    if (applied.loc !== sel.loc || applied.scene !== sel.scene) applyWorld();
    menu.classList.add('gone'); $('hud').classList.remove('hidden');
    phase = 'play'; camInit = false; acc = 0; snapshot();
    $('resumeBtn').style.display = 'none';
    camera.fov = 62; camera.updateProjectionMatrix(); fovNow = 62;
    setTimeout(() => $('hint').classList.add('gone'), 16000);
    $('hint').classList.remove('gone');
  }
  function resume() { menu.classList.add('gone'); phase = 'play'; camInit = false; acc = 0; snapshot(); }
  function openMenu() {
    if (phase !== 'play') return;
    phase = 'menu'; menu.classList.remove('gone'); $('resumeBtn').style.display = '';
    for (const k in keys) keys[k] = false;
  }

  /* ------------------------------------------------------------------ input */
  const MAP = { ArrowUp: 'up', KeyW: 'up', ArrowDown: 'down', KeyS: 'down', ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right', Space: 'hand', ShiftLeft: 'hand', ShiftRight: 'hand' };
  window.addEventListener('keydown', (e) => {
    if (phase === 'menu') {
      if (e.code === 'Enter') { e.preventDefault(); if ($('resumeBtn').style.display === 'none') drive(); else resume(); }
      if (e.code === 'Escape' && $('resumeBtn').style.display !== 'none') resume();
      return;
    }
    const k = MAP[e.code];
    if (k) { keys[k] = true; e.preventDefault(); return; }
    if (e.repeat) return;
    switch (e.code) {
      case 'Escape': case 'KeyP': openMenu(); break;
      case 'KeyE': cruise = !cruise; cruiseV = Math.max(car.v, 8); $('cruise').classList.toggle('on', cruise); break;
      case 'KeyC': camMode = (camMode + 1) % 3; toast(['Chase view', 'Far view', 'Hood view'][camMode]); break;
      case 'KeyV': { const p = spec.paints; model.paintIdx = (model.paintIdx + 1) % p.length; model.body.color.setHex(p[model.paintIdx]); break; }
      case 'KeyN': { musicOn = true; AU.musicNext(); sel.music = AU.musicSelected(); store.set('cr_music', sel.music); toast('♪ ' + AU.musicLabel()); refreshMenu(); break; }
      case 'KeyM': AU.setMuted(!AU.isMuted()); toast(AU.isMuted() ? 'Sound off' : 'Sound on'); break;
      case 'KeyH': hudHidden = !hudHidden; document.body.classList.toggle('nohud', hudHidden); break;
      case 'KeyR': respawn(false); car.v = Math.min(car.v, 14); toast('Back on track'); break;
    }
  });
  window.addEventListener('keyup', (e) => { const k = MAP[e.code]; if (k) keys[k] = false; });
  window.addEventListener('blur', () => { for (const k in keys) keys[k] = false; });
  document.querySelectorAll('#touch button').forEach((b) => {
    const k = b.dataset.k;
    const on = (e) => { e.preventDefault(); keys[k] = true; b.classList.add('down'); };
    const off = (e) => { e.preventDefault(); keys[k] = false; b.classList.remove('down'); };
    b.addEventListener('pointerdown', on); b.addEventListener('pointerup', off); b.addEventListener('pointercancel', off); b.addEventListener('pointerleave', off);
  });

  /* ------------------------------------------------------------------ boot */
  W.onThunder = (delay) => AU.thunder(delay);
  buildMenu();
  applyCar();
  applyWorld();
  refreshMenu();
  $('resumeBtn').style.display = 'none';
  $('loading').classList.add('gone');
  requestAnimationFrame((t) => { last = t; frame(t); });

  // debugging / automated tests
  CR.debug = {
    car, keys, sel, prev, stunt, drift, AP, W,
    get mode() { return mode; }, get phase() { return phase; }, get spec() { return spec; },
    start() { drive(); },
    pause(v) { paused = v; },
    setSel(o) { Object.assign(sel, o); if (o.car) applyCar(); if (o.loc || o.scene) applyWorld(); refreshMenu(); },
    sim(seconds, fn) { const n = Math.round(seconds / H); for (let i = 0; i < n; i++) { if (fn) fn(i * H); snapshot(); stepSim(H); if (teleported) { snapshot(); teleported = false; } } },
    frame(dt, alpha) { render(dt || 0.016, alpha === undefined ? 1 : alpha); },
    respawn
  };
})(window.CR = window.CR || {});
