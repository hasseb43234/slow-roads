/* Car models (procedural, lofted bodies) and their handling specs. */
(function (CR) {
  'use strict';
  const THREE = window.THREE;
  const { clamp, lerp } = CR.U;

  /* ---------------------------------------------------------------- loft helpers */
  function catmull(p0, p1, p2, p3, t) {
    const t2 = t * t, t3 = t2 * t;
    return 0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
  }
  function sampleStations(st, z) {
    let i = 0; while (i < st.length - 2 && z > st[i + 1].z) i++;
    const a = st[Math.max(0, i - 1)], b = st[i], c = st[i + 1], d = st[Math.min(st.length - 1, i + 2)];
    const t = clamp((z - b.z) / (c.z - b.z), 0, 1);
    return { w: catmull(a.w, b.w, c.w, d.w, t), yb: catmull(a.yb, b.yb, c.yb, d.yb, t), yt: catmull(a.yt, b.yt, c.yt, d.yt, t) };
  }
  function loft(st, rings, seg, pw, pt) {
    const pos = [], idx = [];
    const z0 = st[0].z, z1 = st[st.length - 1].z;
    for (let r = 0; r < rings; r++) {
      const z = lerp(z0, z1, 0.5 - 0.5 * Math.cos(Math.PI * r / (rings - 1)));
      const q = sampleStations(st, z);
      for (let k = 0; k < seg; k++) {
        const t = k / seg * Math.PI * 2, c = Math.cos(t), sn = Math.sin(t);
        const x = q.w * Math.sign(c) * Math.pow(Math.abs(c), pw);
        const yh = (q.yt - q.yb) / 2;
        const y = (q.yt + q.yb) / 2 + yh * Math.sign(sn) * Math.pow(Math.abs(sn), pt);
        pos.push(x, y, z);
      }
    }
    for (let r = 0; r < rings - 1; r++) for (let k = 0; k < seg; k++) {
      const A = r * seg + k, B = r * seg + (k + 1) % seg, Cc = (r + 1) * seg + k, D = (r + 1) * seg + (k + 1) % seg;
      idx.push(A, B, Cc, B, D, Cc);
    }
    for (const [r, flip] of [[0, true], [rings - 1, false]]) {
      const ci = pos.length / 3; let cy = 0;
      for (let k = 0; k < seg; k++) cy += pos[(r * seg + k) * 3 + 1];
      pos.push(0, cy / seg, pos[(r * seg) * 3 + 2]);
      for (let k = 0; k < seg; k++) {
        const a = r * seg + k, b = r * seg + (k + 1) % seg;
        if (flip) idx.push(ci, b, a); else idx.push(ci, a, b);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    return g;
  }

  /* ---------------------------------------------------------------- shared materials / parts */
  const M = {
    dark: new THREE.MeshLambertMaterial({ color: 0x0f1115 }),
    carbon: new THREE.MeshStandardMaterial({ color: 0x15171b, metalness: 0.35, roughness: 0.42 }),
    glass: new THREE.MeshPhysicalMaterial({ color: 0x05080c, metalness: 0.2, roughness: 0.03, envMapIntensity: 1.7 }),
    silver: new THREE.MeshStandardMaterial({ color: 0xc9ced6, metalness: 1.0, roughness: 0.22 }),
    chrome: new THREE.MeshStandardMaterial({ color: 0xe6e9ee, metalness: 1.0, roughness: 0.07 }),
    tyre: new THREE.MeshStandardMaterial({ color: 0x0b0b0d, metalness: 0.0, roughness: 0.96 }),
    rim: new THREE.MeshStandardMaterial({ color: 0x2a2d33, metalness: 0.85, roughness: 0.35 }),
    stripe: new THREE.MeshStandardMaterial({ color: 0x1a4fc4, metalness: 0.3, roughness: 0.3 }),
    red: new THREE.MeshStandardMaterial({ color: 0xc8202a, metalness: 0.3, roughness: 0.4 }),
    head: new THREE.MeshBasicMaterial({ color: 0xfff6dc })
  };
  function paint(color, metal, rough) {
    return new THREE.MeshPhysicalMaterial({ color, metalness: metal, roughness: rough, clearcoat: 1.0, clearcoatRoughness: 0.05, envMapIntensity: 1.2 });
  }
  function add(group, geo, mat, x, y, z, cast) {
    const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = cast !== false; group.add(m); return m;
  }
  function box(w, h, d) { return new THREE.BoxGeometry(w, h, d); }

  function makeWheel(group, x, y, z, o) {
    const piv = new THREE.Group(); piv.position.set(x, y, z);
    const tg = new THREE.CylinderGeometry(o.r, o.r, o.w, o.seg || 22); tg.rotateZ(Math.PI / 2);
    const t = new THREE.Mesh(tg, M.tyre); t.castShadow = true; piv.add(t);
    const rg = new THREE.CylinderGeometry(o.r * 0.72, o.r * 0.72, o.w + 0.01, 18); rg.rotateZ(Math.PI / 2);
    piv.add(new THREE.Mesh(rg, M.rim));
    const sg = new THREE.BoxGeometry(o.w + 0.04, o.r * 1.25, o.sw || 0.055);
    for (let i = 0; i < o.spokes; i++) {
      const sp = new THREE.Mesh(sg, o.spokeMat || M.silver); sp.rotation.x = i * Math.PI * 2 / o.spokes; piv.add(sp);
    }
    if (o.nut) {
      const ng = new THREE.CylinderGeometry(o.r * 0.14, o.r * 0.14, o.w + 0.05, 8); ng.rotateZ(Math.PI / 2);
      piv.add(new THREE.Mesh(ng, M.chrome));
    }
    if (o.caliper) {
      const cg = new THREE.BoxGeometry(0.06, o.r * 0.55, o.r * 0.38);
      const side = x > 0 ? -1 : 1;
      const c = new THREE.Mesh(cg, M.red); c.position.set(side * (o.w * 0.5 - 0.02), 0, o.r * 0.28); piv.add(c);
    }
    group.add(piv);
    return piv;
  }

  /* ---------------------------------------------------------------- DRIFT CAR (wide-body wedge with wing) */
  const DRIFT_BODY = [
    { z: -2.25, w: 0.80, yb: 0.30, yt: 0.74 }, { z: -2.05, w: 0.92, yb: 0.26, yt: 0.92 },
    { z: -1.40, w: 0.99, yb: 0.24, yt: 1.00 }, { z: -0.40, w: 0.95, yb: 0.22, yt: 0.86 },
    { z: 0.55, w: 0.92, yb: 0.22, yt: 0.72 }, { z: 1.40, w: 0.88, yb: 0.22, yt: 0.58 },
    { z: 2.00, w: 0.78, yb: 0.24, yt: 0.46 }, { z: 2.26, w: 0.60, yb: 0.28, yt: 0.38 }
  ];
  const DRIFT_CAB = [
    { z: -1.30, w: 0.52, yb: 0.84, yt: 0.90 }, { z: -1.00, w: 0.70, yb: 0.84, yt: 1.14 },
    { z: -0.30, w: 0.76, yb: 0.78, yt: 1.24 }, { z: 0.35, w: 0.74, yb: 0.70, yt: 1.18 },
    { z: 0.85, w: 0.68, yb: 0.62, yt: 0.96 }, { z: 1.12, w: 0.58, yb: 0.58, yt: 0.70 }
  ];
  function buildDrift() {
    const g = new THREE.Group();
    const body = paint(0xd7191f, 0.5, 0.3);
    add(g, loft(DRIFT_BODY, 44, 28, 0.42, 0.55), body, 0, 0, 0);
    add(g, loft(DRIFT_CAB, 28, 24, 0.55, 0.6), M.glass, 0, 0, 0);
    add(g, box(1.7, 0.1, 4.0), M.dark, 0, 0.2, 0, false);
    add(g, box(1.7, 0.035, 0.4), M.carbon, 0, 0.255, 2.12);
    add(g, box(1.45, 0.14, 0.3), M.carbon, 0, 0.31, -2.14);
    for (const sx of [-1, 1]) {
      add(g, box(0.05, 0.1, 1.9), M.carbon, sx * 0.93, 0.3, 0.1);
      add(g, box(0.07, 0.24, 0.55), M.dark, sx * 0.955, 0.6, -0.85);
      add(g, box(0.26, 0.09, 0.14), body, sx * 0.9, 0.99, 0.5);
      add(g, box(0.05, 0.1, 0.05), M.carbon, sx * 0.78, 0.94, 0.52, false);
      add(g, box(0.34, 0.03, 0.26), M.carbon, sx * 0.82, 0.3, 2.0);                 // canards
      add(g, box(0.05, 0.3, 0.12), M.carbon, sx * 0.55, 1.05, -1.95);
      add(g, box(0.04, 0.14, 0.46), M.carbon, sx * 0.87, 1.2, -2.0);
    }
    add(g, box(1.74, 0.045, 0.44), M.carbon, 0, 1.2, -2.0);
    const ex = new THREE.CylinderGeometry(0.065, 0.065, 0.2, 10); ex.rotateX(Math.PI / 2);
    for (const sx of [-0.34, 0.34]) add(g, ex, M.silver, sx, 0.38, -2.25, false);
    const wheels = [];
    for (const [x, z] of [[0.92, 1.38], [-0.92, 1.38], [0.93, -1.35], [-0.93, -1.35]])
      wheels.push(makeWheel(g, x, 0.37, z, { r: 0.37, w: 0.3, spokes: 5 }));
    const tail = new THREE.MeshBasicMaterial({ color: 0xff2418 });
    add(g, box(1.3, 0.065, 0.05), tail, 0, 0.70, -2.265, false);
    for (const sx of [-1, 1]) {
      add(g, box(0.32, 0.05, 0.05), tail, sx * 0.62, 0.62, -2.25, false);
      const hl = add(g, box(0.34, 0.06, 0.2), M.head, sx * 0.54, 0.45, 2.0, false); hl.rotation.x = -0.28;
    }
    return { root: g, wheels, tail, body };
  }

  /* ---------------------------------------------------------------- SPEED CAR (long-tail GT racer: forward canopy, spine fin, louvred engine deck) */
  const SPEED_BODY = [
    { z: -2.45, w: 0.60, yb: 0.30, yt: 0.60 }, { z: -2.25, w: 0.84, yb: 0.27, yt: 0.78 },
    { z: -1.80, w: 1.00, yb: 0.25, yt: 0.94 }, { z: -1.00, w: 1.02, yb: 0.24, yt: 0.96 },
    { z: -0.20, w: 0.94, yb: 0.23, yt: 0.78 }, { z: 0.60, w: 0.90, yb: 0.22, yt: 0.60 },
    { z: 1.50, w: 0.84, yb: 0.22, yt: 0.45 }, { z: 2.20, w: 0.64, yb: 0.24, yt: 0.35 },
    { z: 2.47, w: 0.40, yb: 0.27, yt: 0.29 }
  ];
  const SPEED_CAB = [
    { z: -0.95, w: 0.40, yb: 0.78, yt: 0.84 }, { z: -0.60, w: 0.62, yb: 0.74, yt: 1.06 },
    { z: -0.05, w: 0.70, yb: 0.68, yt: 1.14 }, { z: 0.50, w: 0.66, yb: 0.60, yt: 1.02 },
    { z: 0.98, w: 0.52, yb: 0.52, yt: 0.74 }, { z: 1.30, w: 0.38, yb: 0.46, yt: 0.54 }
  ];
  function buildSpeed() {
    const g = new THREE.Group();
    const body = paint(0xf1f1ed, 0.38, 0.24);
    add(g, loft(SPEED_BODY, 52, 30, 0.44, 0.52), body, 0, 0, 0);
    add(g, loft(SPEED_CAB, 32, 26, 0.62, 0.6), M.glass, 0, 0, 0);
    add(g, box(1.78, 0.1, 4.5), M.dark, 0, 0.2, 0, false);
    add(g, box(1.86, 0.03, 0.55), M.carbon, 0, 0.25, 2.3);                       // front splitter
    add(g, box(1.6, 0.18, 0.4), M.carbon, 0, 0.34, -2.35);                       // diffuser
    for (let k = -3; k <= 3; k++) add(g, box(0.025, 0.16, 0.4), M.dark, k * 0.2, 0.36, -2.42, false);
    // louvred engine deck (slats follow the body line), spine fin and ducktail
    for (let z = -2.05; z <= -1.15; z += 0.15) {
      const yt = sampleStations(SPEED_BODY, z).yt;
      add(g, box(0.92, 0.035, 0.07), M.dark, 0, yt + 0.004, z, false);
    }
    const fin = add(g, box(0.045, 0.27, 1.5), body, 0, 1.075, -1.6); fin.rotation.x = 0.07;
    add(g, box(1.5, 0.05, 0.28), body, 0, 0.84, -2.32).rotation.x = 0.18;
    // hood vents + racing stripes
    for (const sx of [-0.36, 0.36]) add(g, box(0.3, 0.02, 0.32), M.dark, sx, sampleStations(SPEED_BODY, 1.1).yt + 0.006, 1.1, false);
    for (const z of [1.55, 1.9, 2.2]) {
      const yt = sampleStations(SPEED_BODY, z).yt;
      for (const sx of [-0.12, 0.12]) add(g, box(0.09, 0.012, 0.36), M.stripe, sx, yt + 0.004, z, false);
    }
    for (const z of [-2.0, -1.55, -1.1]) for (const sx of [-0.1, 0.1]) {
      const yt = sampleStations(SPEED_BODY, z).yt;
      add(g, box(0.07, 0.01, 0.44), M.stripe, sx, yt + 0.047, z, false);
    }
    for (const sx of [-1, 1]) {
      add(g, box(0.07, 0.3, 0.8), M.dark, sx * 1.0, 0.62, -1.15);               // big rear air intakes
      add(g, box(0.05, 0.08, 0.5), M.carbon, sx * 0.95, 0.42, 0.8);              // side blades
      add(g, box(0.18, 0.07, 0.14), body, sx * 0.76, 0.9, 0.35);                  // mirrors
      add(g, box(0.03, 0.12, 0.5), M.carbon, sx * 1.04, 0.5, 1.3).rotation.y = sx * 0.2;   // front fender fins
    }
    const ex = new THREE.CylinderGeometry(0.085, 0.085, 0.24, 14); ex.rotateX(Math.PI / 2);
    for (const sx of [-0.2, 0.2]) add(g, ex, M.chrome, sx, 0.52, -2.5, false);
    const wheels = [];
    for (const [x, z] of [[0.94, 1.5], [-0.94, 1.5], [0.97, -1.45], [-0.97, -1.45]])
      wheels.push(makeWheel(g, x, 0.38, z, { r: 0.38, w: 0.32, spokes: 12, sw: 0.03, caliper: true, seg: 28, nut: true }));
    const tail = new THREE.MeshBasicMaterial({ color: 0xff2418 });
    add(g, box(1.28, 0.05, 0.05), tail, 0, 0.7, -2.4, false);                  // full-width LED bar
    add(g, box(0.16, 0.16, 0.05), tail, -0.7, 0.58, -2.31, false);
    add(g, box(0.16, 0.16, 0.05), tail, 0.7, 0.58, -2.31, false);
    const drl = new THREE.MeshBasicMaterial({ color: 0xe8f4ff });
    for (const sx of [-1, 1]) {
      const hl = add(g, box(0.44, 0.035, 0.12), M.head, sx * 0.36, 0.31, 2.28, false); hl.rotation.set(-0.3, sx * -0.35, 0);
      add(g, box(0.26, 0.02, 0.05), drl, sx * 0.66, 0.29, 2.18, false).rotation.y = sx * -0.5;
    }
    return { root: g, wheels, tail, body };
  }

  /* ---------------------------------------------------------------- SEDAN (calm everyday car) */
  const SEDAN_BODY = [
    { z: -2.38, w: 0.86, yb: 0.36, yt: 0.92 }, { z: -2.20, w: 0.92, yb: 0.31, yt: 0.97 },
    { z: -1.50, w: 0.94, yb: 0.29, yt: 0.97 }, { z: -0.60, w: 0.94, yb: 0.28, yt: 0.90 },
    { z: 0.40, w: 0.93, yb: 0.28, yt: 0.86 }, { z: 1.30, w: 0.92, yb: 0.28, yt: 0.82 },
    { z: 2.00, w: 0.88, yb: 0.30, yt: 0.70 }, { z: 2.34, w: 0.78, yb: 0.34, yt: 0.58 }
  ];
  const SEDAN_CAB = [
    { z: -1.45, w: 0.74, yb: 0.93, yt: 1.06 }, { z: -0.90, w: 0.82, yb: 0.90, yt: 1.34 },
    { z: -0.10, w: 0.84, yb: 0.86, yt: 1.43 }, { z: 0.60, w: 0.82, yb: 0.84, yt: 1.42 },
    { z: 1.05, w: 0.78, yb: 0.82, yt: 1.15 }, { z: 1.45, w: 0.68, yb: 0.82, yt: 0.88 }
  ];
  const SEDAN_ROOF = [
    { z: -0.85, w: 0.66, yb: 1.27, yt: 1.36 }, { z: -0.10, w: 0.76, yb: 1.35, yt: 1.455 },
    { z: 0.55, w: 0.74, yb: 1.33, yt: 1.445 }, { z: 0.90, w: 0.64, yb: 1.12, yt: 1.22 }
  ];
  function buildSedan() {
    const g = new THREE.Group();
    const body = paint(0xb7bcc4, 0.46, 0.3);
    add(g, loft(SEDAN_BODY, 50, 30, 0.3, 0.42), body, 0, 0, 0);
    add(g, loft(SEDAN_CAB, 32, 26, 0.55, 0.62), M.glass, 0, 0, 0);
    add(g, loft(SEDAN_ROOF, 24, 22, 0.55, 0.6), body, 0, 0, 0);
    add(g, box(1.7, 0.12, 4.2), M.dark, 0, 0.26, 0, false);
    for (const sx of [-1, 1]) {
      add(g, box(0.05, 0.13, 2.7), body, sx * 0.93, 0.36, 0.0);                    // side skirts
      add(g, box(0.02, 0.5, 0.012), M.dark, sx * 0.925, 0.66, -0.55, false);        // door shut lines
      add(g, box(0.02, 0.5, 0.012), M.dark, sx * 0.925, 0.66, 0.55, false);
      add(g, box(0.035, 0.03, 0.2), M.chrome, sx * 0.935, 0.92, -0.15, false);       // door handles
      add(g, box(0.035, 0.03, 0.2), M.chrome, sx * 0.935, 0.92, 0.7, false);
      add(g, box(0.2, 0.1, 0.14), body, sx * 0.9, 1.0, 0.82);                        // mirrors
      add(g, box(0.02, 0.025, 2.35), M.chrome, sx * 0.8, 0.865, -0.1, false);        // window trim
      const hl = add(g, box(0.5, 0.06, 0.12), M.head, sx * 0.6, 0.62, 2.17, false); hl.rotation.set(-0.35, sx * -0.3, 0);
      add(g, box(0.5, 0.05, 0.05), M.head, sx * 0.58, 0.55, 2.23, false);
    }
    add(g, box(1.1, 0.14, 0.08), M.dark, 0, 0.45, 2.27, false);                   // grille
    add(g, box(1.0, 0.035, 0.05), M.chrome, 0, 0.53, 2.29, false);
    add(g, box(1.5, 0.12, 0.1), M.dark, 0, 0.36, 2.28, false);                    // lower intake
    add(g, box(0.5, 0.12, 0.02), mk(0xf0f0f0), 0, 0.58, -2.37, false);            // plate
    const ex = new THREE.CylinderGeometry(0.055, 0.055, 0.14, 12); ex.rotateX(Math.PI / 2);
    for (const sx of [-0.55, 0.55]) add(g, ex, M.chrome, sx, 0.4, -2.36, false);
    const wheels = [];
    for (const [x, z] of [[0.88, 1.42], [-0.88, 1.42], [0.88, -1.38], [-0.88, -1.38]])
      wheels.push(makeWheel(g, x, 0.33, z, { r: 0.33, w: 0.22, spokes: 5, sw: 0.075, seg: 24 }));
    const tail = new THREE.MeshBasicMaterial({ color: 0xff2418 });
    for (const sx of [-1, 1]) add(g, box(0.52, 0.07, 0.05), tail, sx * 0.6, 0.82, -2.32, false).rotation.y = sx * 0.1;
    add(g, box(0.5, 0.025, 0.04), tail, 0, 0.84, -2.34, false);
    return { root: g, wheels, tail, body };
  }
  function mk(color) { return new THREE.MeshStandardMaterial({ color, roughness: 0.6, metalness: 0 }); }

  /* ---------------------------------------------------------------- specs */
  const WH = (r, xf, zf, xr, zr) => [
    { x: xf, z: zf, front: true, r }, { x: -xf, z: zf, front: true, r },
    { x: xr, z: zr, front: false, r }, { x: -xr, z: zr, front: false, r }
  ];

  CR.CARS = {
    sedan: {
      id: 'sedan', name: 'Normal Car', tag: 'Calm, smooth, effortless to drive',
      stats: { speed: 0.5, handling: 0.85, drift: 0.12 },
      vmax: 50, acc: 6.8, brake: 14, cd: 0.0014, revMax: 9, revAcc: 3.6,
      grip: 10, lockGrip: 7, handGrip: 3.2, pwK: 0.0, yawBoost: 0.35, wheelbase: 2.8, steerMax: 0.5, speedRef: 17,
      steerResp: 6.2, thrResp: 3.0, brkResp: 6, assist: 0.9, leanK: 0.7, camRate: 2.0,
      camDist: 7.4, camH: 2.8, camLook: 12, lookY: 1.3,
      wheels: WH(0.33, 0.88, 1.42, 0.88, -1.38),
      spot: { x: 0.6, y: 1.0, z: 2.1 }, shadow: 14,
      engine: { base: 28, ratio: 1.9, lp: 0.8, gain: 0.04, whine: 0 },
      paints: [0xb7bcc4, 0x24406e, 0x6b1f2a, 0x2f4f3a, 0xeeeeea, 0x1b1d21],
      build: buildSedan
    },
    speed: {
      id: 'speed', name: 'Speed Car', tag: 'Long-tail GT racer, planted and very fast',
      stats: { speed: 1.0, handling: 0.9, drift: 0.12 },
      vmax: 92, acc: 11.8, brake: 25, cd: 0.0006, revMax: 11, revAcc: 4.5,
      grip: 12.5, lockGrip: 10, handGrip: 4.8, pwK: 0.0, yawBoost: 0.25, wheelbase: 3.3, steerMax: 0.5, speedRef: 24,
      steerResp: 8, thrResp: 4.5, brkResp: 9, assist: 0.6, leanK: 0.8, camRate: 2.4,
      camDist: 8.2, camH: 3.0, camLook: 12, lookY: 1.2,
      wheels: WH(0.38, 0.94, 1.5, 0.97, -1.45),
      spot: { x: 0.5, y: 1.0, z: 2.2 }, shadow: 14,
      engine: { base: 46, ratio: 2.9, lp: 1.3, gain: 0.05, whine: 1 },
      paints: [0xf1f1ed, 0x1f5fd1, 0xd7191f, 0xf0b400, 0x1b1d21, 0x1f9d6b],
      build: buildSpeed
    },
    drift: {
      id: 'drift', name: 'Drift Car', tag: 'Loose rear, built to slide',
      stats: { speed: 0.66, handling: 0.62, drift: 1.0 },
      vmax: 62, acc: 10.2, brake: 17, cd: 0.0018, revMax: 10, revAcc: 4.0,
      grip: 9, lockGrip: 3.6, handGrip: 0.75, pwK: 7.4, yawBoost: 1.3, wheelbase: 3.5, steerMax: 0.5, speedRef: 12,
      steerResp: 12, thrResp: 6, brkResp: 12, assist: 0.22, leanK: 1.0, camRate: 2.6,
      camDist: 7.8, camH: 3.1, camLook: 10, lookY: 1.2,
      wheels: WH(0.37, 0.92, 1.38, 0.93, -1.35),
      spot: { x: 0.55, y: 1.2, z: 1.9 }, shadow: 14,
      engine: { base: 36, ratio: 2.2, lp: 1.0, gain: 0.06, whine: 0 },
      paints: [0xd7191f, 0xf0b400, 0x1f5fd1, 0xeeeeea, 0xe8590c, 0x1b1d21, 0x1f9d6b],
      build: buildDrift
    }
  };
  CR.CAR_ORDER = ['sedan', 'speed', 'drift'];
})(window.CR = window.CR || {});
