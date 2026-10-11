/* Airport stunt park: a flat free-roam arena with a height-field of ramps, ramps, boxes, pads and knockable cones. */
(function (CR) {
  'use strict';
  const THREE = window.THREE;
  const { clamp, lerp } = CR.U;

  const A = {
    group: new THREE.Group(),
    spawn: { x: 0, z: 40, heading: 0 },
    bounds: { x0: -1260, x1: 1260, z0: -640, z1: 1560 },
    limit: { x0: -1200, x1: 1200, z0: -580, z1: 1500 },
    features: [], boosts: [], cones: [], ready: false
  };
  const group = A.group;

  /* ------------------------------------------------------------------ height-field features */
  function prep(f) {
    f.cos = Math.cos(f.rot || 0); f.sin = Math.sin(f.rot || 0);
    f.br = f.type === 'cyl' ? f.r : Math.hypot(f.w, f.l) / 2 + 1;
    return f;
  }
  const box = (x, z, w, l, h, rot) => A.features.push(prep({ type: 'box', x, z, w, l, h, rot: rot || 0 }));
  const cyl = (x, z, r, h) => A.features.push(prep({ type: 'cyl', x, z, r, h }));
  function ramp(x, z, w, l, h, rot, kind, R) {
    const f = prep({ type: 'ramp', x, z, w, l, h, rot: rot || 0, kind: kind || 'lin', R: R || 0 });
    A.features.push(f); return f;
  }
  A.height = function (x, z) {
    let best = 0;
    const fs = A.features;
    for (let i = 0; i < fs.length; i++) {
      const f = fs[i];
      const dx = x - f.x, dz = z - f.z;
      if (dx > f.br || dx < -f.br || dz > f.br || dz < -f.br) continue;
      if (f.type === 'cyl') { if (dx * dx + dz * dz <= f.r * f.r && f.h > best) best = f.h; continue; }
      const lx = dx * f.cos - dz * f.sin, lz = dx * f.sin + dz * f.cos;
      if (lx > f.w / 2 || lx < -f.w / 2 || lz > f.l / 2 || lz < -f.l / 2) continue;
      let h = f.h;
      if (f.type === 'ramp') {
        const u = lz + f.l / 2;
        h = f.kind === 'q' ? f.R - Math.sqrt(Math.max(f.R * f.R - u * u, 0)) : f.h * (u / f.l);
      }
      if (h > best) best = h;
    }
    return best;
  };
  A.boostAt = function (x, z) {
    for (const b of A.boosts) if (Math.abs(x - b.x) < b.w / 2 && Math.abs(z - b.z) < b.l / 2) return b;
    return null;
  };

  /* ------------------------------------------------------------------ materials / textures */
  function noiseTex(base, var_, size, repeat, lines) {
    const cv = document.createElement('canvas'); cv.width = cv.height = size;
    const g = cv.getContext('2d');
    g.fillStyle = base; g.fillRect(0, 0, size, size);
    for (let i = 0; i < size * size / 5; i++) {
      const v = (Math.random() - 0.5) * var_;
      g.fillStyle = v > 0 ? `rgba(255,255,255,${v / 255})` : `rgba(0,0,0,${-v / 255})`;
      g.fillRect(Math.random() * size, Math.random() * size, 2, 2);
    }
    if (lines) { g.strokeStyle = 'rgba(0,0,0,.22)'; g.lineWidth = 2; g.strokeRect(1, 1, size - 2, size - 2); }
    const t = new THREE.CanvasTexture(cv);
    t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(repeat[0], repeat[1]); t.anisotropy = 8; t.encoding = THREE.sRGBEncoding;
    return t;
  }
  const mats = {};
  function mk(color, extra) { return new THREE.MeshLambertMaterial(Object.assign({ color }, extra || {})); }
  const polyOff = (k) => ({ polygonOffset: true, polygonOffsetFactor: -k, polygonOffsetUnits: -k });

  /* ------------------------------------------------------------------ mesh helpers */
  function rampGeometry(f) {
    const N = 16, hw = f.w / 2, pts = [];
    for (let j = 0; j <= N; j++) {
      const u = j / N, z = -f.l / 2 + u * f.l;
      const y = f.kind === 'q' ? f.R - Math.sqrt(Math.max(f.R * f.R - (u * f.l) * (u * f.l), 0)) : f.h * u;
      pts.push([z, y]);
    }
    const pos = [], col = [];
    const top = [0.66, 0.68, 0.72], side = [0.42, 0.44, 0.48];
    const L2 = (c) => Math.pow(c, 2.2);
    const tri = (a, b, c, k) => { for (const p of [a, b, c]) { pos.push(p[0], p[1], p[2]); col.push(L2(k[0]), L2(k[1]), L2(k[2])); } };
    for (let j = 0; j < N; j++) {
      const a = pts[j], b = pts[j + 1];
      tri([-hw, a[1], a[0]], [hw, a[1], a[0]], [hw, b[1], b[0]], top);
      tri([-hw, a[1], a[0]], [hw, b[1], b[0]], [-hw, b[1], b[0]], top);
      for (const sx of [-hw, hw]) {
        tri([sx, 0, a[0]], [sx, 0, b[0]], [sx, b[1], b[0]], side);
        tri([sx, 0, a[0]], [sx, b[1], b[0]], [sx, a[1], a[0]], side);
      }
    }
    const e = pts[N], zb = f.l / 2;
    tri([-hw, 0, zb], [hw, 0, zb], [hw, e[1], zb], side);
    tri([-hw, 0, zb], [hw, e[1], zb], [-hw, e[1], zb], side);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.computeVertexNormals();
    return g;
  }
  const rampMat = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
  function place(mesh, x, y, z, rot) { mesh.position.set(x, y, z); mesh.rotation.y = rot || 0; group.add(mesh); mesh.castShadow = true; mesh.receiveShadow = true; return mesh; }
  function addRamp(f) {
    const m = new THREE.Mesh(rampGeometry(f), rampMat);
    place(m, f.x, 0, f.z, f.rot);
    // hazard lip
    const lip = new THREE.Mesh(new THREE.BoxGeometry(f.w, 0.14, 0.7), mats.hazard);
    lip.position.set(0, f.kind === 'q' ? f.h : f.h, f.l / 2 - 0.45); lip.castShadow = false; m.add(lip);
    return m;
  }

  /* merged cone geometry (cone + base plate) with painted stripes */
  function coneGeometry() {
    const cone = new THREE.ConeGeometry(0.3, 0.75, 14, 4, true).toNonIndexed();
    cone.translate(0, 0.42, 0);
    const base = new THREE.BoxGeometry(0.66, 0.05, 0.66).toNonIndexed(); base.translate(0, 0.025, 0);
    const parts = [cone, base], pos = [], nor = [], col = [];
    parts.forEach((g, gi) => {
      const p = g.attributes.position.array, n = g.attributes.normal.array;
      for (let i = 0; i < p.length; i += 3) {
        pos.push(p[i], p[i + 1], p[i + 2]); nor.push(n[i], n[i + 1], n[i + 2]);
        const y = p[i + 1];
        if (gi === 1) col.push(0.014, 0.014, 0.015);
        else if (y > 0.42 && y < 0.58) col.push(0.9, 0.9, 0.9);
        else col.push(1.0, 0.15, 0.003);
      }
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    return g;
  }

  /* ------------------------------------------------------------------ airliner model */
  function buildAirliner(tailColor, scale) {
    const g = new THREE.Group();
    const white = new THREE.MeshStandardMaterial({ color: 0xeef0f2, roughness: 0.34, metalness: 0.25, envMapIntensity: 1 }), grey = new THREE.MeshStandardMaterial({ color: 0x9aa0a8, roughness: 0.4, metalness: 0.6, envMapIntensity: 1 }), dark = new THREE.MeshStandardMaterial({ color: 0x0a0e12, roughness: 0.08, metalness: 0.3, envMapIntensity: 1.5 }), tail = new THREE.MeshStandardMaterial({ color: tailColor, roughness: 0.4, metalness: 0.2, envMapIntensity: 0.8 });
    const fus = new THREE.CylinderGeometry(2.4, 2.4, 30, 18); fus.rotateZ(Math.PI / 2);
    const f = new THREE.Mesh(fus, white); f.position.y = 3.2; g.add(f);
    const nose = new THREE.SphereGeometry(2.4, 18, 12); nose.scale(2.1, 1, 1);
    const n = new THREE.Mesh(nose, white); n.position.set(15, 3.2, 0); g.add(n);
    const aft = new THREE.CylinderGeometry(2.4, 0.7, 10, 16); aft.rotateZ(Math.PI / 2);
    const a = new THREE.Mesh(aft, white); a.position.set(-19.5, 3.7, 0); g.add(a);
    for (const s of [-1, 1]) {
      const w = new THREE.Mesh(new THREE.BoxGeometry(8, 0.5, 15), grey);
      w.position.set(-1, 2.2, s * 8.5); w.rotation.y = s * -0.42; g.add(w);
      const eng = new THREE.CylinderGeometry(1.1, 1.0, 4, 14); eng.rotateZ(Math.PI / 2);
      const e = new THREE.Mesh(eng, grey); e.position.set(1.5, 0.9, s * 7); g.add(e);
      const hs = new THREE.Mesh(new THREE.BoxGeometry(4, 0.3, 6), grey); hs.position.set(-22, 4.1, s * 3.6); hs.rotation.y = s * -0.4; g.add(hs);
    }
    const fin = new THREE.Mesh(new THREE.BoxGeometry(6, 8, 0.5), tail); fin.position.set(-21, 8.2, 0); fin.rotation.z = 0.0; g.add(fin);
    const win = new THREE.Mesh(new THREE.BoxGeometry(24, 0.5, 4.82), dark); win.position.set(0, 4.2, 0); win.scale.set(1, 1, 1); g.add(win);
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(30, 0.35, 4.84), tail); stripe.position.set(-1, 3.3, 0); g.add(stripe);
    g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    if (scale) g.scale.setScalar(scale);
    return g;
  }

  /* ------------------------------------------------------------------ build everything once */
  let groundMat, apronMat, runwayMat, apron, ground, runway, windsock, lightsInst, hazardTex;
  const coneState = [];
  let coneMesh = null, coneDirty = false;
  const dummy = new THREE.Object3D();

  A.build = function () {
    if (A.ready) return;
    A.ready = true;
    mats.hazard = new THREE.MeshLambertMaterial({ color: 0xf2c500 });
    mats.line = new THREE.MeshLambertMaterial({ color: 0xf2f2ea, ...polyOff(2) });
    mats.yellow = new THREE.MeshLambertMaterial({ color: 0xf0c020, ...polyOff(2) });

    // ground, apron, runway
    groundMat = new THREE.MeshLambertMaterial({ map: noiseTex('#5f9a3c', 60, 256, [260, 260]) });
    ground = new THREE.Mesh(new THREE.PlaneGeometry(7000, 7000).rotateX(-Math.PI / 2), groundMat);
    ground.position.set(0, 0, 350); ground.receiveShadow = true; group.add(ground);
    apronMat = new THREE.MeshLambertMaterial({ map: noiseTex('#9a9da2', 36, 256, [260, 230], true), ...polyOff(1) });
    apron = new THREE.Mesh(new THREE.PlaneGeometry(2600, 2300).rotateX(-Math.PI / 2), apronMat);
    apron.position.set(0, 0.03, 460); apron.receiveShadow = true; group.add(apron);
    runwayMat = new THREE.MeshLambertMaterial({ map: noiseTex('#3a3d41', 30, 256, [4, 104]), ...polyOff(2) });
    runway = new THREE.Mesh(new THREE.PlaneGeometry(54, 1040).rotateX(-Math.PI / 2), runwayMat);
    runway.position.set(0, 0.06, 440); runway.receiveShadow = true; group.add(runway);

    // runway markings
    const strip = (w, l, x, z, mat, y) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, 0.02, l), mat || mats.line); m.position.set(x, y || 0.075, z); group.add(m); return m; };
    for (let z = -40; z < 940; z += 36) strip(0.9, 18, 0, z + 9);
    strip(0.5, 1020, -26, 440); strip(0.5, 1020, 26, 440);
    for (const z of [-60, 930]) for (let i = -4; i <= 4; i++) { if (i === 0) continue; strip(1.6, 22, i * 5.4, z + (z < 0 ? 12 : -12)); }
    for (let i = -10; i <= 10; i++) strip(0.5, 3, i * 2.4, 620);        // touchdown bars
    // taxiways (yellow)
    strip(0.7, 520, 90, 260, mats.yellow); strip(0.7, 520, -90, 260, mats.yellow);
    strip(120, 0.7, 150, -20, mats.yellow); strip(120, 0.7, -150, -20, mats.yellow);
    for (const zz of [80, 140, 200, 260, 320, 380, 440]) { strip(60, 0.5, 120, zz, mats.line); strip(60, 0.5, -120, zz, mats.line); }
    // drift pad
    const dp = new THREE.Mesh(new THREE.RingGeometry(55, 56.2, 80).rotateX(-Math.PI / 2), mats.line); dp.position.set(-170, 0.08, 170); group.add(dp);
    const dp2 = new THREE.Mesh(new THREE.RingGeometry(16, 17, 60).rotateX(-Math.PI / 2), mats.yellow); dp2.position.set(-170, 0.08, 170); group.add(dp2);
    const dp3 = new THREE.Mesh(new THREE.RingGeometry(34, 34.6, 70).rotateX(-Math.PI / 2), mats.line); dp3.position.set(-170, 0.08, 170); group.add(dp3);

    // boost pads
    const chev = document.createElement('canvas'); chev.width = 128; chev.height = 256;
    { const g = chev.getContext('2d'); g.fillStyle = '#0a1a24'; g.fillRect(0, 0, 128, 256);
      for (let i = 0; i < 4; i++) { g.strokeStyle = i % 2 ? '#32f0ff' : '#7dffa8'; g.lineWidth = 16; g.beginPath(); g.moveTo(14, 236 - i * 62); g.lineTo(64, 190 - i * 62); g.lineTo(114, 236 - i * 62); g.stroke(); } }
    const chevTex = new THREE.CanvasTexture(chev);
    mats.boost = new THREE.MeshBasicMaterial({ map: chevTex, ...polyOff(3) });
    const addBoost = (x, z) => {
      const b = { x, z, w: 14, l: 16 }; A.boosts.push(b);
      const m = new THREE.Mesh(new THREE.PlaneGeometry(b.w, b.l).rotateX(-Math.PI / 2), mats.boost); m.position.set(x, 0.1, z); group.add(m);
      const edge = new THREE.Mesh(new THREE.BoxGeometry(b.w + 0.8, 0.05, b.l + 0.8), mats.hazard); edge.position.set(x, 0.08, z); group.add(edge);
    };
    addBoost(0, 70); addBoost(0, 205); addBoost(150, 40); addBoost(-60, 20);

    // ---- stunt features
    const r1 = ramp(0, 251, 18, 22, 6.5, 0);                  // plane-jump launch
    const r2 = ramp(0, 303, 18, 26, 3.5, Math.PI);            // landing slope
    const qp = ramp(0, 953.5, 50, 13.08, 9, 0, 'q', 14);     // runway-end quarter pipe
    box(0, 970, 50, 20, 9, 0);                                // deck behind it
    const k1 = ramp(-12, 514, 8, 12, 2.6, 0), k2 = ramp(-12, 528, 8, 12, 2.6, Math.PI);
    const k3 = ramp(12, 514, 8, 12, 2.6, 0), k4 = ramp(12, 528, 8, 12, 2.6, Math.PI);
    const kick = [70, 100, 130].map((x) => ramp(x, 215, 7, 10, 2.0, 0));
    const cj = ramp(90, 40, 8, 14, 4.2, 0);
    const sp1 = ramp(150, 108, 8, 14, 3.0, 0), sp2 = ramp(150, 122, 8, 14, 3.0, Math.PI);
    for (const f of [r1, r2, qp, k1, k2, k3, k4, ...kick, cj, sp1, sp2]) addRamp(f);
    const deck = new THREE.Mesh(new THREE.BoxGeometry(50, 9, 20), new THREE.MeshLambertMaterial({ color: 0x6a6f78 })); deck.position.set(0, 4.5, 970); group.add(deck);
    // container jump + yard
    const contColors = [0xb03a2e, 0x2e5e9e, 0xd88a1e, 0x2f7a4e, 0x7a7f86, 0x8e3a6e];
    const addContainer = (x, z, rot, c, tall) => {
      const h = tall ? 5.2 : 2.6;
      box(x, z, 2.45, 12.2, h, rot);
      const m = new THREE.Mesh(new THREE.BoxGeometry(2.45, h, 12.2), mk(contColors[c % contColors.length]));
      place(m, x, h / 2, z, rot);
      const r = new THREE.Mesh(new THREE.BoxGeometry(2.5, 0.12, 12.25), mk(0x222428)); r.position.set(0, h / 2 - 0.1, 0); m.add(r);
    };
    for (const dx of [-1.25, 1.25]) addContainer(90 + dx, 80, 0, 0, false);
    for (let i = 0; i < 6; i++) addContainer(-60 + (i % 3) * 2.6, -70 - Math.floor(i / 3) * 13, 0, i + 1, i % 2 === 1);
    for (let i = 0; i < 4; i++) addContainer(-120 + i * 2.6, -150, Math.PI / 2, i + 2, false);

    // plane across the runway (gap jump) + parked planes
    const jet = buildAirliner(0xc8202a); jet.position.set(0, 0, 283); jet.rotation.y = 0; group.add(jet);
    box(0, 283, 4.9, 36, 5.2, Math.PI / 2);                     // fuselage (long axis along world x)
    box(0, 283.5, 9, 30, 2.0, Math.PI / 2);                     // wings
    const jet2 = buildAirliner(0x1f5fd1); jet2.position.set(300, 0, 70); jet2.rotation.y = 0.5; group.add(jet2);
    box(300, 70, 4.9, 36, 5.2, 0.5 + Math.PI / 2);
    const jet3 = buildAirliner(0x2f7a4e); jet3.position.set(310, 0, -40); jet3.rotation.y = -0.7; group.add(jet3);
    box(310, -40, 4.9, 36, 5.2, -0.7 + Math.PI / 2);

    // buildings
    const hangar = (x, z) => {
      box(x, z, 70, 40, 12, 0);
      const body = new THREE.Mesh(new THREE.BoxGeometry(70, 9, 40), mk(0xb9bec6)); place(body, x, 4.5, z);
      const arch = new THREE.CylinderGeometry(20, 20, 70, 24, 1, false, 0, Math.PI); arch.rotateZ(Math.PI / 2); arch.scale(1, 0.4, 1);
      const roof = new THREE.Mesh(arch, mk(0x8a9099)); roof.rotation.y = 0; place(roof, x, 9, z);
      const door = new THREE.Mesh(new THREE.BoxGeometry(50, 7, 0.4), mk(0x4a5058)); door.position.set(0, -1.2, 20.1); body.add(door);
    };
    hangar(-190, -120); hangar(-190, -190);
    box(60, -190, 90, 24, 11, 0);
    place(new THREE.Mesh(new THREE.BoxGeometry(90, 11, 24), mk(0xd4d8de)), 60, 5.5, -190);
    place(new THREE.Mesh(new THREE.BoxGeometry(90.4, 3.2, 24.4), new THREE.MeshPhongMaterial({ color: 0x1c2a36, specular: 0x88aacc, shininess: 90 })), 60, 7, -190);
    box(150, -140, 9, 9, 26, 0);
    place(new THREE.Mesh(new THREE.BoxGeometry(9, 26, 9), mk(0xdfe3e8)), 150, 13, -140);
    place(new THREE.Mesh(new THREE.CylinderGeometry(7.5, 5.5, 5, 8), new THREE.MeshPhongMaterial({ color: 0x20323f, specular: 0xaaccee, shininess: 100 })), 150, 28.5, -140);
    place(new THREE.Mesh(new THREE.CylinderGeometry(8, 8, 0.8, 8), mk(0xdfe3e8)), 150, 31.4, -140);
    for (let i = 0; i < 3; i++) { cyl(240, -120 + i * 18, 7, 9); place(new THREE.Mesh(new THREE.CylinderGeometry(7, 7, 9, 20), mk(0xe8e4d8)), 240, 4.5, -120 + i * 18); }

    // tyre walls round the drift pad
    const tyreG = new THREE.CylinderGeometry(0.75, 0.75, 1.3, 14);
    const tyres = new THREE.InstancedMesh(tyreG, new THREE.MeshLambertMaterial({ color: 0xffffff }), 44);
    const col = new THREE.Color();
    for (let i = 0; i < 44; i++) {
      const a = i / 44 * Math.PI * 2, x = -170 + Math.cos(a) * 62, z = 170 + Math.sin(a) * 62;
      cyl(x, z, 0.8, 1.3);
      dummy.position.set(x, 0.65, z); dummy.rotation.set(0, 0, 0); dummy.scale.set(1, 1, 1); dummy.updateMatrix();
      tyres.setMatrixAt(i, dummy.matrix); col.setHex(i % 2 ? 0xd32f2f : 0xf2f2f2); tyres.setColorAt(i, col);
    }
    tyres.castShadow = true; group.add(tyres);

    // cones: slalom + circle
    const spawns = [];
    for (let i = 0; i < 20; i++) spawns.push([-70 + (i % 2 ? 6 : -6), 80 + i * 20]);
    for (let i = 0; i < 24; i++) { const a = i / 24 * Math.PI * 2; spawns.push([-170 + Math.cos(a) * 24, 170 + Math.sin(a) * 24]); }
    for (let i = 0; i < 14; i++) spawns.push([200 + (i % 2 ? 7 : -7), 150 + i * 18]);
    coneMesh = new THREE.InstancedMesh(coneGeometry(), new THREE.MeshLambertMaterial({ vertexColors: true }), spawns.length);
    spawns.forEach(([x, z], i) => {
      coneState.push({ hx: x, hz: z, x, z, y: 0, vx: 0, vz: 0, vy: 0, rx: 0, rz: 0, wx: 0, wz: 0, state: 0, t: 0 });
      writeCone(i);
    });
    coneMesh.castShadow = true; coneMesh.frustumCulled = false; group.add(coneMesh);

    // runway edge lights + fence + trees + windsock
    const lampG = new THREE.CylinderGeometry(0.22, 0.28, 0.45, 8);
    lightsInst = new THREE.InstancedMesh(lampG, new THREE.MeshBasicMaterial({ color: 0xffe9b0 }), 160);
    let li = 0;
    for (let z = -40; z <= 940; z += 25) for (const x of [-27.5, 27.5]) { dummy.position.set(x, 0.3, z); dummy.scale.set(1, 1, 1); dummy.rotation.set(0, 0, 0); dummy.updateMatrix(); lightsInst.setMatrixAt(li++, dummy.matrix); }
    lightsInst.count = li; group.add(lightsInst);
    const bl = A.bounds, fenceMat = mk(0x6a6f76);
    const postG = new THREE.BoxGeometry(0.25, 2.4, 0.25), posts = new THREE.InstancedMesh(postG, fenceMat, 900);
    let pi = 0;
    const addPost = (x, z) => { if (pi >= 900) return; dummy.position.set(x, 1.2, z); dummy.updateMatrix(); posts.setMatrixAt(pi++, dummy.matrix); };
    for (let x = bl.x0; x <= bl.x1; x += 14) { addPost(x, bl.z0 - 10); addPost(x, bl.z1 + 14); }
    for (let z = bl.z0; z <= bl.z1; z += 14) { addPost(bl.x0 - 10, z); addPost(bl.x1 + 10, z); }
    posts.count = pi; group.add(posts);
    for (const y of [0.9, 1.9]) {
      for (const [x, z, w, l] of [[0, bl.z0 - 10, bl.x1 - bl.x0 + 20, 0.1], [0, bl.z1 + 14, bl.x1 - bl.x0 + 20, 0.1], [bl.x0 - 10, (bl.z0 + bl.z1) / 2 + 2, 0.1, bl.z1 - bl.z0 + 24], [bl.x1 + 10, (bl.z0 + bl.z1) / 2 + 2, 0.1, bl.z1 - bl.z0 + 24]]) {
        const m = new THREE.Mesh(new THREE.BoxGeometry(w, 0.08, l), fenceMat); m.position.set(x, y, z); group.add(m);
      }
    }
    // glowing boundary wall just inside the fence
    const L = A.limit, WH = 9, wallMat = (rep) => new THREE.MeshBasicMaterial({ map: CR.makeWallTexture(rep), transparent: true, depthWrite: false, side: THREE.DoubleSide });
    const addWall = (len, x, z, rotY) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(len, WH), wallMat(len / 10));
      m.position.set(x, WH / 2 - 0.3, z); m.rotation.y = rotY; m.renderOrder = 3; group.add(m);
    };
    addWall(L.x1 - L.x0, 0, L.z0, 0); addWall(L.x1 - L.x0, 0, L.z1, 0);
    addWall(L.z1 - L.z0, L.x0, (L.z0 + L.z1) / 2, Math.PI / 2); addWall(L.z1 - L.z0, L.x1, (L.z0 + L.z1) / 2, Math.PI / 2);
    // pine ring outside the fence
    const trunkG = new THREE.CylinderGeometry(0.25, 0.4, 2.6, 6); trunkG.translate(0, 1.3, 0);
    const pineG = new THREE.ConeGeometry(3, 11, 8); pineG.translate(0, 7, 0);
    const NT = 900, ptr = new THREE.InstancedMesh(trunkG, mk(0x4a3626), NT), ppn = new THREE.InstancedMesh(pineG, new THREE.MeshLambertMaterial({ color: 0xffffff }), NT);
    for (let i = 0; i < NT; i++) {
      const side = i % 4, t = Math.random();
      let x, z;
      const off = 30 + Math.random() * 220;
      if (side === 0) { x = lerp(bl.x0, bl.x1, t); z = bl.z0 - off; }
      else if (side === 1) { x = lerp(bl.x0, bl.x1, t); z = bl.z1 + off; }
      else if (side === 2) { x = bl.x0 - off; z = lerp(bl.z0, bl.z1, t); }
      else { x = bl.x1 + off; z = lerp(bl.z0, bl.z1, t); }
      const s = 0.8 + Math.random() * 1.1;
      dummy.position.set(x, 0, z); dummy.rotation.set(0, Math.random() * 6, 0); dummy.scale.set(s, s * (0.9 + Math.random() * 0.4), s); dummy.updateMatrix();
      ptr.setMatrixAt(i, dummy.matrix); ppn.setMatrixAt(i, dummy.matrix);
      col.setRGB(0.1 + Math.random() * 0.06, 0.3 + Math.random() * 0.1, 0.15); ppn.setColorAt(i, col);
    }
    group.add(ptr, ppn); A.pines = ppn;
    // windsock
    windsock = new THREE.Group();
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.12, 7, 6), mk(0xdddddd)); pole.position.y = 3.5; windsock.add(pole);
    const sock = new THREE.Mesh(new THREE.ConeGeometry(0.7, 3.4, 10, 1, true), new THREE.MeshLambertMaterial({ color: 0xff6a1a, side: THREE.DoubleSide })); sock.rotation.z = Math.PI / 2; sock.position.set(1.8, 6.6, 0); windsock.add(sock);
    windsock.position.set(45, 0, 20); group.add(windsock); A.sock = windsock;
    group.traverse((o) => { if (o.isMesh && o.material && o.material.map && o.material.map.isCanvasTexture) o.receiveShadow = true; });
    A.chevTex = chevTex;
  };

  /* ------------------------------------------------------------------ cones */
  function writeCone(i) {
    const c = coneState[i];
    dummy.position.set(c.x, c.y, c.z); dummy.rotation.set(c.rx, 0, c.rz); dummy.scale.set(1, 1, 1); dummy.updateMatrix();
    coneMesh.setMatrixAt(i, dummy.matrix); coneDirty = true;
  }
  A.resetCones = function () { coneState.forEach((c, i) => { Object.assign(c, { x: c.hx, z: c.hz, y: 0, vx: 0, vz: 0, vy: 0, rx: 0, rz: 0, wx: 0, wz: 0, state: 0, t: 0 }); writeCone(i); }); };
  A.update = function (dt, car, time) {
    if (!A.ready) return;
    if (A.chevTex) A.chevTex.offset.y = -((time * 0.6) % 1);
    if (A.sock) A.sock.rotation.y = Math.sin(time * 0.6) * 0.5 - 0.6;
    let hit = 0;
    for (let i = 0; i < coneState.length; i++) {
      const c = coneState[i];
      if (c.state === 0) {
        const dx = c.x - car.x, dz = c.z - car.z;
        if (dx * dx + dz * dz < 2.6 && Math.abs(car.v) > 2 && car.y < 1.4) {
          c.state = 1; c.t = 0;
          const k = 0.75 * Math.abs(car.v);
          c.vx = car.vx * 0.9 + (Math.random() - 0.5) * 3; c.vz = car.vz * 0.9 + (Math.random() - 0.5) * 3;
          c.vy = 3 + Math.random() * 0.7 * Math.min(8, k * 0.25);
          c.wx = (Math.random() - 0.5) * 14; c.wz = (Math.random() - 0.5) * 14; hit++;
        }
      } else if (c.state === 1) {
        c.t += dt; c.vy -= 22 * dt;
        c.x += c.vx * dt; c.z += c.vz * dt; c.y += c.vy * dt; c.rx += c.wx * dt; c.rz += c.wz * dt;
        if (c.y <= 0) {
          c.y = 0; c.vy = Math.abs(c.vy) > 3 ? -c.vy * 0.35 : 0; c.vx *= 0.7; c.vz *= 0.7; c.wx *= 0.5; c.wz *= 0.5;
          if (c.vy === 0 && Math.hypot(c.vx, c.vz) < 0.6) { c.state = 2; c.t = 0; c.rx = Math.round(c.rx / 1.5708) * 1.5708; c.rz = Math.round(c.rz / 1.5708) * 1.5708; }
        }
        writeCone(i);
      } else if (c.state === 2) {
        c.t += dt;
        const far = Math.hypot(c.hx - car.x, c.hz - car.z) > 22;
        if (c.t > 9 && far) { c.state = 0; c.x = c.hx; c.z = c.hz; c.y = 0; c.rx = 0; c.rz = 0; writeCone(i); }
      }
    }
    if (coneDirty) { coneMesh.instanceMatrix.needsUpdate = true; coneDirty = false; }
    return hit;
  };

  /* ------------------------------------------------------------------ scene look */
  A.setScene = function (SC) {
    if (!A.ready) return;
    const g = SC.ground;
    const gc = new THREE.Color(g.a[1]).lerp(new THREE.Color(g.b[0]), 0.35);
    groundMat.color.copy(gc).multiplyScalar(1.0);
    groundMat.needsUpdate = true;
    const snow = SC.trees.snow > 0.3, wet = SC.wet;
    apronMat.color.setHex(snow ? 0xe0e6ee : wet ? 0x9aa0a8 : SC.id === 'norway' ? 0xa4aab8 : 0xffffff);
    runwayMat.color.setHex(snow ? 0xc8ced6 : wet ? 0x9aa0a8 : 0xffffff);
    if (A.pines) { /* tint pines per scene */
      const c = new THREE.Color();
      for (let i = 0; i < A.pines.count; i++) {
        const k = SC.trees.snow;
        c.setRGB(0.1 + (i % 7) * 0.008, 0.28 + (i % 5) * 0.02, 0.15).lerp(new THREE.Color(0xf2f6fb), k * 0.8);
        A.pines.setColorAt(i, c);
      }
      A.pines.instanceColor.needsUpdate = true;
    }
  };
  A.setVisible = (v) => { group.visible = v; };
  group.visible = false;
  CR.Airport = A;
})(window.CR = window.CR || {});
