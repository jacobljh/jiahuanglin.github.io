/* flatland.js — the running world of the 3D Vision series.
 *
 * Flatland is 3D vision with one dimension removed: a 2D world (x to the right, z up) seen by 1D
 * pinhole cameras, whose "images" are rows of pixels.  Every idea of the series — rays and parallax,
 * triangulation, rigid motion, ICP, fusion, rendering, volume rendering, radiance fields, splats,
 * priors — survives the loss of a dimension, and becomes small enough to COMPUTE live in a widget.
 *
 * Conventions (used by every lesson):
 *   world:   x to the right, z up.  A point is {x, z}.  Angles are counter-clockwise from +x.
 *   pose:    {a, x, z}  — rotate by a, then translate;  p_world = R(a)·p_local + (x, z).
 *   camera:  {x, z, a, f, W}  at (x, z) looking along heading a (a = PI/2 looks "up", along +z),
 *            focal length f in pixels, W pixels.  Principal point is the image centre (W/2).
 *            Camera axes:  forward = (cos a, sin a),  right = (sin a, -cos a).
 *            A world point p has camera coordinates  xc = (p - pos)·right,  zc = (p - pos)·forward  and
 *            lands on pixel  u = W/2 + f·xc/zc   (pixel i covers u in [i, i+1], centre i + 0.5).
 *   Deterministic: no Math.random, no Date.  Use FL.rng(seed).
 */
(function (root) {
'use strict';
var FL = {};
var PI = Math.PI;

/* ───────────────────────────── random numbers ───────────────────────────── */
FL.rng = function (seed) {              // mulberry32: tiny, fast, good enough, reproducible
  var a = (seed >>> 0) || 1;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    var t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};
FL.randn = function (rng) {             // N(0,1) by Box–Muller
  var u = 0;
  while (u === 0) u = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * PI * rng());
};

/* ───────────────────────────── SE(2) ───────────────────────────── */
FL.se2 = {
  make: function (a, x, z) { return { a: a, x: x, z: z }; },
  apply: function (T, p) {
    var c = Math.cos(T.a), s = Math.sin(T.a);
    return { x: c * p.x - s * p.z + T.x, z: s * p.x + c * p.z + T.z };
  },
  compose: function (A, B) {            // A∘B : apply B first, then A
    var c = Math.cos(A.a), s = Math.sin(A.a);
    return { a: A.a + B.a, x: c * B.x - s * B.z + A.x, z: s * B.x + c * B.z + A.z };
  },
  inv: function (T) {
    var c = Math.cos(T.a), s = Math.sin(T.a);
    return { a: -T.a, x: -(c * T.x + s * T.z), z: -(-s * T.x + c * T.z) };
  },
  wrap: function (a) { while (a > PI) a -= 2 * PI; while (a < -PI) a += 2 * PI; return a; }
};

/* ───────────────────────────── shapes, scenes, SDFs ───────────────────────────── */
/* A scene is {shapes, light:[lx,lz], amb, bg:[r,g,b], far, stepScale}.  Each shape has an sdf and an
 * albedo.  Colours are [r,g,b] in 0..1.  `stripes` n paints n sinusoidal stripes around the shape's
 * centre so that surfaces carry texture (matching needs texture; NeRF needs something to fit).     */
FL.circle = function (x, z, r, col, o) { o = o || {}; return { type: 'circle', x: x, z: z, r: r, col: col, stripes: o.stripes || 0, sp: o.sp || 0, name: o.name || 'circle' }; };
FL.box = function (x, z, hx, hz, col, o) { o = o || {}; return { type: 'box', x: x, z: z, hx: hx, hz: hz, a: o.a || 0, col: col, stripes: o.stripes || 0, sp: o.sp || 0, name: o.name || 'box' }; };
/* star-shaped blob: boundary radius R(phi) = r·(1 + Σ amp_k cos(k_k·phi + ph_k)).  harm = [[k, amp, phase], …] */
FL.blob = function (x, z, r, harm, col, o) { o = o || {}; return { type: 'blob', x: x, z: z, r: r, harm: harm || [], col: col, stripes: o.stripes || 0, sp: o.sp || 0, name: o.name || 'blob' }; };

FL.blobRadius = function (sh, phi) {
  var rr = 1;
  for (var i = 0; i < sh.harm.length; i++) rr += sh.harm[i][1] * Math.cos(sh.harm[i][0] * phi + sh.harm[i][2]);
  return sh.r * rr;
};

function sdfShape(sh, x, z) {
  var dx, dz;
  switch (sh.type) {
    case 'circle': return Math.sqrt((x - sh.x) * (x - sh.x) + (z - sh.z) * (z - sh.z)) - sh.r;
    case 'box': {
      var c = Math.cos(sh.a), s = Math.sin(sh.a);
      dx = x - sh.x; dz = z - sh.z;
      var lx = c * dx + s * dz, lz = -s * dx + c * dz;
      var qx = Math.abs(lx) - sh.hx, qz = Math.abs(lz) - sh.hz;
      return Math.sqrt(Math.max(qx, 0) * Math.max(qx, 0) + Math.max(qz, 0) * Math.max(qz, 0)) + Math.min(Math.max(qx, qz), 0);
    }
    case 'blob': {
      dx = x - sh.x; dz = z - sh.z;
      return Math.sqrt(dx * dx + dz * dz) - FL.blobRadius(sh, Math.atan2(dz, dx));
    }
  }
  return 1e9;
}
FL.sdfShape = sdfShape;

/* min-distance over the scene; returns the distance, and records the nearest shape in FL._lastId */
FL.sdf = function (scene, x, z) {
  var d = 1e9, id = -1;
  for (var i = 0; i < scene.shapes.length; i++) {
    var di = sdfShape(scene.shapes[i], x, z);
    if (di < d) { d = di; id = i; }
  }
  FL._lastId = id;
  return d;
};
FL.nearest = function (scene, x, z) { var d = FL.sdf(scene, x, z); return { d: d, id: FL._lastId }; };
FL.normal = function (scene, x, z) {
  var h = 1e-3;
  var nx = FL.sdf(scene, x + h, z) - FL.sdf(scene, x - h, z);
  var nz = FL.sdf(scene, x, z + h) - FL.sdf(scene, x, z - h);
  var l = Math.sqrt(nx * nx + nz * nz) || 1;
  return { x: nx / l, z: nz / l };
};

/* albedo at a surface point: base colour modulated by stripes around the shape centre */
FL.albedo = function (sh, x, z) {
  var m = 1;
  if (sh.stripes) {
    var phi = Math.atan2(z - sh.z, x - sh.x);
    m = 0.74 + 0.26 * Math.sin(sh.stripes * phi + sh.sp);
  }
  return [sh.col[0] * m, sh.col[1] * m, sh.col[2] * m];
};

/* sphere tracing: returns {hit, t, x, z, id} */
FL.raycast = function (scene, ox, oz, dx, dz, tmax) {
  tmax = tmax || scene.far || 30;
  var k = scene.stepScale || 0.7, t = 0;
  for (var it = 0; it < 300; it++) {
    var x = ox + dx * t, z = oz + dz * t;
    var d = FL.sdf(scene, x, z), id = FL._lastId;
    if (d < 1e-3) return { hit: true, t: t, x: x, z: z, id: id };
    t += Math.max(d * k, 2e-4);
    if (t > tmax) break;
  }
  return { hit: false, t: tmax, x: ox + dx * tmax, z: oz + dz * tmax, id: -1 };
};

/* ───────────────────────────── preset scenes ───────────────────────────── */
FL.scenes = {};
/* "street": objects at clearly different depths, for parallax and stereo (lessons 1–2) */
FL.scenes.street = function () {
  return {
    name: 'street',
    shapes: [
      FL.box(-2.3, 3.0, 0.55, 0.55, [0.85, 0.35, 0.25], { stripes: 6, name: 'crate' }),
      FL.circle(0.6, 6.0, 0.9, [0.25, 0.65, 0.35], { stripes: 5, name: 'ball' }),
      FL.box(3.2, 11.0, 1.1, 1.1, [0.30, 0.45, 0.85], { stripes: 4, a: 0.3, name: 'tower' })
    ],
    light: [-0.5, 0.85], amb: 0.35, bg: [0.93, 0.94, 0.96], far: 40, stepScale: 0.8
  };
};
/* "room": walls and pillars seen by a planar scanner (lesson 4).  Asymmetric on purpose. */
FL.scenes.room = function () {
  var s = [
    FL.box(0, -0.15, 6.2, 0.15, [0.4, 0.4, 0.45], { name: 'south wall' }),
    FL.box(0, 8.15, 6.2, 0.15, [0.4, 0.4, 0.45], { name: 'north wall' }),
    FL.box(-6.15, 4.0, 0.15, 4.3, [0.4, 0.4, 0.45], { name: 'west wall' }),
    FL.box(6.15, 4.0, 0.15, 4.3, [0.4, 0.4, 0.45], { name: 'east wall' }),
    FL.box(-2.2, 5.2, 0.5, 0.5, [0.8, 0.5, 0.3], { a: 0.4, name: 'pillar A' }),
    FL.circle(2.6, 2.6, 0.7, [0.3, 0.6, 0.4], { name: 'pillar B' }),
    FL.box(3.7, 5.9, 1.3, 0.22, [0.5, 0.4, 0.7], { a: -0.5, name: 'shelf' })
  ];
  return { name: 'room', shapes: s, light: [0, 1], amb: 0.4, bg: [1, 1, 1], far: 30, stepScale: 0.9 };
};
/* "statue": the running object of lessons 6–13 — a lobed, striped blob with a crate and a ball beside it */
FL.scenes.statue = function (o) {
  o = o || {};
  var harm = o.harm || FL.shape.harmonics(FL.shape.statueTheta());     // a typical member of the shape family (see FL.shape)
  return {
    name: 'statue',
    shapes: [
      FL.blob(0.0, 0.0, 1.15, harm, [0.93, 0.55, 0.2], { stripes: 5, name: 'statue' }),
      FL.box(-2.1, 0.55, 0.42, 0.42, [0.3, 0.45, 0.9], { a: 0.35, stripes: 3, name: 'crate' }),
      FL.circle(1.9, -0.9, 0.5, [0.25, 0.7, 0.4], { stripes: 7, name: 'ball' })
    ],
    light: [-0.55, 0.8], amb: 0.3, bg: [0.97, 0.97, 0.99], far: 20, stepScale: 0.6
  };
};

/* ───────────────────────────── cameras ───────────────────────────── */
FL.camera = function (o) {
  return { x: o.x, z: o.z, a: (o.a === undefined ? PI / 2 : o.a), f: o.f || 80, W: o.W || 96 };
};
FL.camAxes = function (cam) {
  var c = Math.cos(cam.a), s = Math.sin(cam.a);
  return { fx: c, fz: s, rx: s, rz: -c };
};
FL.lookAt = function (x, z, tx, tz, o) {
  o = o || {};
  return FL.camera({ x: x, z: z, a: Math.atan2(tz - z, tx - x), f: o.f, W: o.W });
};
/* n cameras on a circle of radius R around (cx, cz), all looking at the centre */
FL.orbit = function (n, R, cx, cz, o) {
  o = o || {};
  var a0 = o.start === undefined ? 0 : o.start, span = o.span === undefined ? 2 * PI : o.span, out = [];
  for (var i = 0; i < n; i++) {
    var th = a0 + span * (o.closed === false ? (n > 1 ? i / (n - 1) : 0) : i / n);
    out.push(FL.lookAt(cx + R * Math.cos(th), cz + R * Math.sin(th), cx, cz, o));
  }
  return out;
};
FL.hfov = function (cam) { return 2 * Math.atan(cam.W / (2 * cam.f)); };
FL.toCam = function (cam, px, pz) {
  var A = FL.camAxes(cam), dx = px - cam.x, dz = pz - cam.z;
  return { xc: dx * A.rx + dz * A.rz, zc: dx * A.fx + dz * A.fz };
};
FL.project = function (cam, px, pz) {
  var c = FL.toCam(cam, px, pz);
  return { u: cam.W / 2 + cam.f * c.xc / c.zc, zc: c.zc, xc: c.xc };
};
/* unit ray through pixel coordinate u (pixel i centre = i + 0.5) */
FL.pixelRay = function (cam, u) {
  var A = FL.camAxes(cam), xc = (u - cam.W / 2) / cam.f, l = Math.sqrt(xc * xc + 1);
  return { ox: cam.x, oz: cam.z, dx: (xc * A.rx + A.fx) / l, dz: (xc * A.rz + A.fz) / l, k: 1 / l };
};
/* world point from pixel u and DEPTH zc (distance along the optical axis, not along the ray) */
FL.backproject = function (cam, u, zc) {
  var A = FL.camAxes(cam), xc = (u - cam.W / 2) / cam.f * zc;
  return { x: cam.x + xc * A.rx + zc * A.fx, z: cam.z + xc * A.rz + zc * A.fz };
};
FL.moved = function (cam, dx, dz, da) {
  return FL.camera({ x: cam.x + dx, z: cam.z + dz, a: cam.a + (da || 0), f: cam.f, W: cam.W });
};

/* ───────────────────────────── rendering ───────────────────────────── */
/* Lambert (+ optional specular) shading of a hit.  opts: flat (albedo only), spec (strength), pow */
FL.shade = function (scene, hit, ray, opts) {
  opts = opts || {};
  var sh = scene.shapes[hit.id], a = FL.albedo(sh, hit.x, hit.z);
  if (opts.flat) return a;
  var n = FL.normal(scene, hit.x, hit.z);
  var L = scene.light, ll = Math.sqrt(L[0] * L[0] + L[1] * L[1]);
  var lx = L[0] / ll, lz = L[1] / ll;
  var diff = Math.max(0, n.x * lx + n.z * lz);
  var amb = scene.amb === undefined ? 0.3 : scene.amb;
  var I = amb + (1 - amb) * diff;
  var out = [a[0] * I, a[1] * I, a[2] * I];
  var ks = opts.spec !== undefined ? opts.spec : (scene.spec || 0);
  if (ks > 0) {
    var hx = lx - ray.dx, hz = lz - ray.dz, hl = Math.sqrt(hx * hx + hz * hz) || 1;
    var nh = Math.max(0, n.x * hx / hl + n.z * hz / hl), sp = ks * Math.pow(nh, opts.pow || 24);
    out[0] += sp; out[1] += sp; out[2] += sp;
  }
  return out;
};

/* render a 1D image.  returns {W, r, g, b (Float32Array W), depth (zc of the hit, 0 if miss), id (-1 miss), hx, hz} */
FL.render = function (scene, cam, opts) {
  opts = opts || {};
  var W = cam.W, A = FL.camAxes(cam);
  var out = { W: W, r: new Float32Array(W), g: new Float32Array(W), b: new Float32Array(W),
              depth: new Float32Array(W), id: new Int16Array(W), hx: new Float32Array(W), hz: new Float32Array(W) };
  var far = opts.far || scene.far || 30, rng = opts.noise ? FL.rng(opts.seed || 7) : null;
  for (var i = 0; i < W; i++) {
    var ray = FL.pixelRay(cam, i + 0.5);
    var h = FL.raycast(scene, ray.ox, ray.oz, ray.dx, ray.dz, far);
    var c;
    if (h.hit) {
      c = FL.shade(scene, h, ray, opts);
      out.depth[i] = (h.x - cam.x) * A.fx + (h.z - cam.z) * A.fz;
      out.id[i] = h.id; out.hx[i] = h.x; out.hz[i] = h.z;
    } else { c = scene.bg; out.depth[i] = 0; out.id[i] = -1; }
    var nz = rng ? opts.noise * FL.randn(rng) : 0;
    out.r[i] = Math.min(1, Math.max(0, c[0] + nz));
    out.g[i] = Math.min(1, Math.max(0, c[1] + nz));
    out.b[i] = Math.min(1, Math.max(0, c[2] + nz));
  }
  return out;
};
FL.mse = function (A, B) {
  var s = 0, n = A.W;
  for (var i = 0; i < n; i++) {
    var dr = A.r[i] - B.r[i], dg = A.g[i] - B.g[i], db = A.b[i] - B.b[i];
    s += (dr * dr + dg * dg + db * db) / 3;
  }
  return s / n;
};
FL.psnr = function (A, B) { var m = FL.mse(A, B); return m < 1e-10 ? 99 : -10 * Math.log10(m); };

/* ───────────────────────────── sensors ───────────────────────────── */
FL.stereo = {
  disparity: function (f, b, Z) { return f * b / Z; },
  depth: function (f, b, d) { return f * b / d; },
  /* first-order depth std for disparity std sd:  σ_Z = Z² σ_d / (f b) */
  sigmaZ: function (f, b, Z, sd) { return Z * Z * sd / (f * b); }
};
/* depth image with an error model.  model: 'stereo' {f,b,sd}  |  'tof' {sigma}  |  'none'.  Returns Float32Array(W) of depth (0 where invalid). */
FL.noisyDepth = function (cam, rend, model, rng) {
  var W = rend.W, d = new Float32Array(W);
  for (var i = 0; i < W; i++) {
    var z = rend.depth[i];
    if (rend.id[i] < 0 || z <= 0) { d[i] = 0; continue; }
    if (!model || model.kind === 'none') d[i] = z;
    else if (model.kind === 'stereo') {            // noise lives in DISPARITY; depth = f b / d
      var disp = model.f * model.b / z + model.sd * FL.randn(rng);
      d[i] = disp > 1e-3 ? model.f * model.b / disp : 0;
    } else if (model.kind === 'tof') d[i] = z + model.sigma * FL.randn(rng);
  }
  return d;
};
/* A planar scanner (a 2D "LiDAR"): n beams over `fov` radians centred on the pose heading.  Returns
 * [{ok, range, a (beam angle in world), x, z (world hit), lx, lz (sensor-frame hit)}]                    */
FL.lidar = function (scene, pose, o) {
  o = o || {};
  var n = o.n || 180, fov = o.fov === undefined ? 2 * PI : o.fov, rmax = o.range || 14, sig = o.sigma || 0, rng = o.rng || FL.rng(3);
  var out = [];
  for (var j = 0; j < n; j++) {
    var ang = pose.a - fov / 2 + fov * (j + 0.5) / n;
    var dx = Math.cos(ang), dz = Math.sin(ang);
    var h = FL.raycast(scene, pose.x, pose.z, dx, dz, rmax);
    if (!h.hit || (o.dropout && rng() < o.dropout)) { out.push({ ok: false, a: ang, range: rmax }); continue; }
    var r = h.t + (sig ? sig * FL.randn(rng) : 0);
    var wx = pose.x + r * dx, wz = pose.z + r * dz;
    // sensor frame: rotate the world offset by -pose.a
    var c = Math.cos(pose.a), s = Math.sin(pose.a), ox = r * dx, oz = r * dz;
    out.push({ ok: true, a: ang, range: r, x: wx, z: wz, lx: c * ox + s * oz, lz: -s * ox + c * oz, id: h.id });
  }
  return out;
};
/* intersect two rays (o + t d) in the plane.  returns {ok, x, z, tA, tB, angle} */
FL.intersect = function (oAx, oAz, dAx, dAz, oBx, oBz, dBx, dBz) {
  var det = dAx * (-dBz) - dAz * (-dBx);            // |dA  -dB|
  if (Math.abs(det) < 1e-9) return { ok: false };
  var rx = oBx - oAx, rz = oBz - oAz;
  var tA = (rx * (-dBz) - rz * (-dBx)) / det;
  var tB = (dAx * rz - dAz * rx) / det;
  var cosang = dAx * dBx + dAz * dBz;
  return { ok: true, x: oAx + tA * dAx, z: oAz + tA * dAz, tA: tA, tB: tB, angle: Math.acos(Math.max(-1, Math.min(1, cosang))) };
};
/* triangulate the same point seen at pixel uA in camA and pixel uB in camB */
FL.triangulate = function (camA, uA, camB, uB) {
  var rA = FL.pixelRay(camA, uA), rB = FL.pixelRay(camB, uB);
  var r = FL.intersect(rA.ox, rA.oz, rA.dx, rA.dz, rB.ox, rB.oz, rB.dx, rB.dz);
  if (r.ok) { var A = FL.camAxes(camA); r.zc = (r.x - camA.x) * A.fx + (r.z - camA.z) * A.fz; }
  return r;
};

/* ───────────────────────────── tiny dense linear algebra ───────────────────────────── */
/* solve A x = b for symmetric positive definite A (n×n, row-major Float64Array/Array) by Cholesky; returns x or null */
FL.solveSPD = function (A, b, n) {
  var L = new Float64Array(n * n), i, j, k, s;
  for (i = 0; i < n; i++) {
    for (j = 0; j <= i; j++) {
      s = A[i * n + j];
      for (k = 0; k < j; k++) s -= L[i * n + k] * L[j * n + k];
      if (i === j) { if (s <= 1e-14) return null; L[i * n + i] = Math.sqrt(s); }
      else L[i * n + j] = s / L[j * n + j];
    }
  }
  var y = new Float64Array(n), x = new Float64Array(n);
  for (i = 0; i < n; i++) { s = b[i]; for (k = 0; k < i; k++) s -= L[i * n + k] * y[k]; y[i] = s / L[i * n + i]; }
  for (i = n - 1; i >= 0; i--) { s = y[i]; for (k = i + 1; k < n; k++) s -= L[k * n + i] * x[k]; x[i] = s / L[i * n + i]; }
  return x;
};
/* Gauss–Jordan with partial pivoting for a general square system */
FL.solve = function (A, b, n) {
  var M = new Float64Array(n * (n + 1)), i, j, k;
  for (i = 0; i < n; i++) { for (j = 0; j < n; j++) M[i * (n + 1) + j] = A[i * n + j]; M[i * (n + 1) + n] = b[i]; }
  for (i = 0; i < n; i++) {
    var p = i, best = Math.abs(M[i * (n + 1) + i]);
    for (k = i + 1; k < n; k++) { var v = Math.abs(M[k * (n + 1) + i]); if (v > best) { best = v; p = k; } }
    if (best < 1e-14) return null;
    if (p !== i) for (j = 0; j <= n; j++) { var t = M[i * (n + 1) + j]; M[i * (n + 1) + j] = M[p * (n + 1) + j]; M[p * (n + 1) + j] = t; }
    var d = M[i * (n + 1) + i];
    for (j = i; j <= n; j++) M[i * (n + 1) + j] /= d;
    for (k = 0; k < n; k++) if (k !== i) {
      var f = M[k * (n + 1) + i];
      if (f !== 0) for (j = i; j <= n; j++) M[k * (n + 1) + j] -= f * M[i * (n + 1) + j];
    }
  }
  var x = new Float64Array(n);
  for (i = 0; i < n; i++) x[i] = M[i * (n + 1) + n];
  return x;
};

/* ───────────────────────────── volume rendering & radiance fields (lessons 8–10) ───────────────────────────── */
FL.vol = {};
var softplus = function (x) { return x > 30 ? x : Math.log(1 + Math.exp(x)); };
var sigmoid = function (x) { return 1 / (1 + Math.exp(-x)); };
FL.vol.softplus = softplus;
FL.vol.sigmoid = sigmoid;

/* Composite ONE ray.  sig[i] ≥ 0 are densities, col[i] = [r,g,b], delta[i] segment lengths, bg = background [r,g,b].
 *   α_i = 1 − exp(−σ_i δ_i),   T_i = Π_{j<i}(1 − α_j),   w_i = T_i α_i,   C = Σ w_i c_i + T_end · bg
 * Returns {C, Ts (length n+1: transmittance before each sample, then after the last), alpha, w}.        */
FL.vol.composite = function (sig, col, delta, bg) {
  var n = sig.length, T = 1, C = [0, 0, 0], Ts = new Float64Array(n + 1), al = new Float64Array(n), w = new Float64Array(n);
  for (var i = 0; i < n; i++) {
    Ts[i] = T;
    var a = 1 - Math.exp(-sig[i] * delta[i]);
    al[i] = a; w[i] = T * a;
    C[0] += w[i] * col[i][0]; C[1] += w[i] * col[i][1]; C[2] += w[i] * col[i][2];
    T *= (1 - a);
  }
  Ts[n] = T;
  if (bg) { C[0] += T * bg[0]; C[1] += T * bg[1]; C[2] += T * bg[2]; }
  return { C: C, Ts: Ts, alpha: al, w: w };
};
/* Gradient of a scalar loss through composite():  given dL/dC, returns dL/dσ_k and dL/dc_k.
 *   ∂C/∂σ_k = δ_k ( T_{k+1} c_k − Σ_{i>k} w_i c_i − T_end·bg )        — "what I add" minus "what I hide"
 *   ∂C/∂c_k = w_k                                                                                       */
FL.vol.compositeGrad = function (sig, col, delta, bg, dLdC, fwd) {
  var n = sig.length, f = fwd || FL.vol.composite(sig, col, delta, bg);
  var dsig = new Float64Array(n), dcol = new Array(n);
  var b0 = bg ? f.Ts[n] * bg[0] : 0, b1 = bg ? f.Ts[n] * bg[1] : 0, b2 = bg ? f.Ts[n] * bg[2] : 0;
  for (var k = n - 1; k >= 0; k--) {
    var Tk1 = f.Ts[k + 1], c = col[k];
    dsig[k] = delta[k] * (dLdC[0] * (Tk1 * c[0] - b0) + dLdC[1] * (Tk1 * c[1] - b1) + dLdC[2] * (Tk1 * c[2] - b2));
    dcol[k] = [f.w[k] * dLdC[0], f.w[k] * dLdC[1], f.w[k] * dLdC[2]];
    b0 += f.w[k] * c[0]; b1 += f.w[k] * c[1]; b2 += f.w[k] * c[2];
  }
  return { dsig: dsig, dcol: dcol };
};

function rayBox(ox, oz, dx, dz, x0, x1, z0, z1) {
  var tmin = 0, tmax = 1e9, t1, t2, s;
  if (Math.abs(dx) < 1e-12) { if (ox < x0 || ox > x1) return null; }
  else { t1 = (x0 - ox) / dx; t2 = (x1 - ox) / dx; if (t1 > t2) { s = t1; t1 = t2; t2 = s; } tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2); }
  if (Math.abs(dz) < 1e-12) { if (oz < z0 || oz > z1) return null; }
  else { t1 = (z0 - oz) / dz; t2 = (z1 - oz) / dz; if (t1 > t2) { s = t1; t1 = t2; t2 = s; } tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2); }
  return tmin < tmax ? [tmin, tmax] : null;
}
FL.vol.rayBox = rayBox;

/* A radiance field on a regular grid: per node a raw density s (σ = softplus(s)) and a raw colour (c = sigmoid).
 * Values between nodes are bilinear.  (A real NeRF stores the same function in an MLP; the loop is identical.)   */
FL.vol.Field = function (o) {
  this.x0 = o.x0; this.x1 = o.x1; this.z0 = o.z0; this.z1 = o.z1; this.nx = o.nx; this.nz = o.nz;
  var n = this.nx * this.nz;
  this.s = new Float64Array(n); this.c = new Float64Array(3 * n);
  var s0 = o.s0 === undefined ? -5 : o.s0;
  for (var i = 0; i < n; i++) this.s[i] = s0;
  this.bg = o.bg || [1, 1, 1];
  this.nsamp = o.nsamp || 48;
  this.ms = new Float64Array(n); this.vs = new Float64Array(n); this.mc = new Float64Array(3 * n); this.vc = new Float64Array(3 * n);
  this.t = 0;
  this.gS = new Float64Array(n); this.gC = new Float64Array(3 * n);
  this._idx = new Int32Array(4 * 512); this._wt = new Float64Array(4 * 512);
};
var Field = FL.vol.Field.prototype;
Field.reset = function (s0) {
  this.s.fill(s0 === undefined ? -5 : s0); this.c.fill(0);
  this.ms.fill(0); this.vs.fill(0); this.mc.fill(0); this.vc.fill(0); this.t = 0;
};
/* bilinear stencil at (x,z): fills idx/wt slots 4m..4m+3 */
Field._stencil = function (x, z, m, idx, wt) {
  var gx = (x - this.x0) / (this.x1 - this.x0) * (this.nx - 1), gz = (z - this.z0) / (this.z1 - this.z0) * (this.nz - 1);
  if (gx < 0) gx = 0; if (gz < 0) gz = 0; if (gx > this.nx - 1) gx = this.nx - 1; if (gz > this.nz - 1) gz = this.nz - 1;
  var i0 = Math.min(Math.floor(gx), this.nx - 2), j0 = Math.min(Math.floor(gz), this.nz - 2);
  var fx = gx - i0, fz = gz - j0, b = m * 4;
  idx[b] = j0 * this.nx + i0; idx[b + 1] = j0 * this.nx + i0 + 1; idx[b + 2] = (j0 + 1) * this.nx + i0; idx[b + 3] = (j0 + 1) * this.nx + i0 + 1;
  wt[b] = (1 - fx) * (1 - fz); wt[b + 1] = fx * (1 - fz); wt[b + 2] = (1 - fx) * fz; wt[b + 3] = fx * fz;
};
/* march one ray; if gt (3-vector) is given, also accumulate gradients (scaled by wgt) and return the squared error */
Field.ray = function (ox, oz, dx, dz, rng, gt, wgt) {
  var hit = rayBox(ox, oz, dx, dz, this.x0, this.x1, this.z0, this.z1);
  if (!hit) { var bgc = this.bg; return gt ? { C: bgc, err: (bgc[0] - gt[0]) * (bgc[0] - gt[0]) + (bgc[1] - gt[1]) * (bgc[1] - gt[1]) + (bgc[2] - gt[2]) * (bgc[2] - gt[2]) } : { C: bgc }; }
  var n = this.nsamp, t0 = hit[0], dt = (hit[1] - hit[0]) / n;
  var idx = this._idx, wt = this._wt, sig = new Float64Array(n), col = new Array(n), delta = new Float64Array(n), craw = new Float64Array(3 * n), sraw = new Float64Array(n);
  for (var m = 0; m < n; m++) {
    var t = t0 + (m + (rng ? rng() : 0.5)) * dt, x = ox + dx * t, z = oz + dz * t;
    this._stencil(x, z, m, idx, wt);
    var s = 0, r = 0, g = 0, b = 0, q = m * 4;
    for (var k = 0; k < 4; k++) {
      var id = idx[q + k], w = wt[q + k];
      s += w * this.s[id]; r += w * this.c[3 * id]; g += w * this.c[3 * id + 1]; b += w * this.c[3 * id + 2];
    }
    sraw[m] = s; craw[3 * m] = r; craw[3 * m + 1] = g; craw[3 * m + 2] = b;
    sig[m] = softplus(s); col[m] = [sigmoid(r), sigmoid(g), sigmoid(b)]; delta[m] = dt;
  }
  var f = FL.vol.composite(sig, col, delta, this.bg);
  if (!gt) return { C: f.C, w: f.w, Ts: f.Ts, t0: t0, dt: dt };
  var e0 = f.C[0] - gt[0], e1 = f.C[1] - gt[1], e2 = f.C[2] - gt[2];
  var dL = [2 * e0 * wgt, 2 * e1 * wgt, 2 * e2 * wgt];
  var gr = FL.vol.compositeGrad(sig, col, delta, this.bg, dL, f);
  for (var mm = 0; mm < n; mm++) {
    var ds = gr.dsig[mm] * sigmoid(sraw[mm]);                       // d softplus / ds = sigmoid(s)
    var dc0 = gr.dcol[mm][0] * col[mm][0] * (1 - col[mm][0]), dc1 = gr.dcol[mm][1] * col[mm][1] * (1 - col[mm][1]), dc2 = gr.dcol[mm][2] * col[mm][2] * (1 - col[mm][2]);
    var qq = mm * 4;
    for (var kk = 0; kk < 4; kk++) {
      var ii = idx[qq + kk], ww = wt[qq + kk];
      this.gS[ii] += ww * ds; this.gC[3 * ii] += ww * dc0; this.gC[3 * ii + 1] += ww * dc1; this.gC[3 * ii + 2] += ww * dc2;
    }
  }
  return { C: f.C, err: e0 * e0 + e1 * e1 + e2 * e2 };
};
/* render a camera: returns {W, r, g, b} */
Field.renderCam = function (cam) {
  var W = cam.W, out = { W: W, r: new Float32Array(W), g: new Float32Array(W), b: new Float32Array(W) };
  for (var i = 0; i < W; i++) {
    var ry = FL.pixelRay(cam, i + 0.5), res = this.ray(ry.ox, ry.oz, ry.dx, ry.dz, null);
    out.r[i] = res.C[0]; out.g[i] = res.C[1]; out.b[i] = res.C[2];
  }
  return out;
};
/* one full-batch Adam step over every pixel of every view.  views = [{cam, img}] (img from FL.render).
 * opts: lr (default 0.15), jitter (stratified sampling), seed, tv (total-variation weight on density), l1 (sparsity on σ)
 * returns the mean-squared photometric loss BEFORE the update.                                                      */
Field.step = function (views, opts) {
  opts = opts || {};
  var lr = opts.lr || 0.15, rng = opts.jitter ? FL.rng((opts.seed || 1) + this.t * 7919) : null;
  this.gS.fill(0); this.gC.fill(0);
  var P = 0, v, i;
  for (v = 0; v < views.length; v++) P += views[v].cam.W;
  var wgt = 1 / (3 * P), loss = 0;
  for (v = 0; v < views.length; v++) {
    var cam = views[v].cam, img = views[v].img;
    for (i = 0; i < cam.W; i++) {
      var ry = FL.pixelRay(cam, i + 0.5);
      var res = this.ray(ry.ox, ry.oz, ry.dx, ry.dz, rng, [img.r[i], img.g[i], img.b[i]], wgt);
      loss += res.err / (3 * P);
    }
  }
  if (opts.tv) {                                        // smoothness prior on raw density: λ Σ (s_i − s_neighbour)²
    var nx = this.nx, nz = this.nz, lam = opts.tv, jj, ii;
    for (jj = 0; jj < nz; jj++) for (ii = 0; ii < nx; ii++) {
      var id = jj * nx + ii;
      if (ii + 1 < nx) { var d1 = this.s[id] - this.s[id + 1]; loss += lam * d1 * d1 / (nx * nz); this.gS[id] += 2 * lam * d1 / (nx * nz); this.gS[id + 1] -= 2 * lam * d1 / (nx * nz); }
      if (jj + 1 < nz) { var d2 = this.s[id] - this.s[id + nx]; loss += lam * d2 * d2 / (nx * nz); this.gS[id] += 2 * lam * d2 / (nx * nz); this.gS[id + nx] -= 2 * lam * d2 / (nx * nz); }
    }
  }
  this.t++;
  var b1 = 0.9, b2 = 0.999, c1 = 1 - Math.pow(b1, this.t), c2 = 1 - Math.pow(b2, this.t), N = this.s.length, k;
  for (k = 0; k < N; k++) {
    var g = this.gS[k];
    this.ms[k] = b1 * this.ms[k] + (1 - b1) * g; this.vs[k] = b2 * this.vs[k] + (1 - b2) * g * g;
    this.s[k] -= lr * (this.ms[k] / c1) / (Math.sqrt(this.vs[k] / c2) + 1e-8);
  }
  for (k = 0; k < 3 * N; k++) {
    var gc = this.gC[k];
    this.mc[k] = b1 * this.mc[k] + (1 - b1) * gc; this.vc[k] = b2 * this.vc[k] + (1 - b2) * gc * gc;
    this.c[k] -= lr * (this.mc[k] / c1) / (Math.sqrt(this.vc[k] / c2) + 1e-8);
  }
  return loss;
};
/* peak density over a ray-sampled grid, for drawing: returns Float32Array(nx*nz) of σ */
Field.density = function () {
  var d = new Float32Array(this.s.length);
  for (var i = 0; i < d.length; i++) d[i] = softplus(this.s[i]);
  return d;
};
Field.color = function (i) { return [sigmoid(this.c[3 * i]), sigmoid(this.c[3 * i + 1]), sigmoid(this.c[3 * i + 2])]; };

/* ───────────────────────────── Gaussian splats (lesson 10) ───────────────────────────── */
/* A splat set in Flatland: K anisotropic 2D Gaussians.  Per Gaussian, 9 raw parameters:
 *   [x, z,  ls1, ls2,  th,  ol,  cr, cg, cb]      position, log-scales, orientation, opacity logit, colour logits
 * covariance  Σ = R(th) diag(s1², s2²) R(th)ᵀ   (PSD by construction),   o = sigmoid(ol),   c = sigmoid(cr..).
 * A camera maps the 2D Gaussian to a 1D Gaussian on the image line:
 *   mean  m = W/2 + f·xc/zc            variance  v = J Σ_cam Jᵀ + dil,   J = [ f/zc,  −f·xc/zc² ]
 * (the 1-D analogue of the EWA projection  Σ' = J W Σ Wᵀ Jᵀ).  Pixels composite the Gaussians front to back with
 * the SAME α-compositing rule as volume rendering:  α = o·exp(−(u−m)²/2v),  C = Σ T α c + T_end·bg.             */
FL.gs = {};
var GP = 9;
FL.gs.P = GP;
FL.gs.make = function (K) {
  return { K: K, p: new Float64Array(K * GP), m: new Float64Array(K * GP), v: new Float64Array(K * GP), t: 0,
           dmSum: new Float64Array(K), dmCnt: new Float64Array(K), dil: 0.3, bg: [1, 1, 1] };
};
/* seed splats at given world points (e.g. the sparse points an SfM run produced).  pts = [{x,z}]  */
FL.gs.fromPoints = function (pts, o, rng) {
  o = o || {};
  var S = FL.gs.make(pts.length), s0 = Math.log(o.scale || 0.25);
  S.bg = o.bg || [1, 1, 1];
  for (var k = 0; k < pts.length; k++) {
    var b = k * GP;
    S.p[b] = pts[k].x; S.p[b + 1] = pts[k].z; S.p[b + 2] = s0; S.p[b + 3] = s0;
    S.p[b + 4] = rng ? rng() * Math.PI : 0;
    S.p[b + 5] = o.ol === undefined ? 0 : o.ol;
    S.p[b + 6] = S.p[b + 7] = S.p[b + 8] = 0;
  }
  return S;
};
FL.gs.opacity = function (S, k) { return sigmoid(S.p[k * GP + 5]); };
FL.gs.color = function (S, k) { var b = k * GP; return [sigmoid(S.p[b + 6]), sigmoid(S.p[b + 7]), sigmoid(S.p[b + 8])]; };
FL.gs.scales = function (S, k) { return [Math.exp(S.p[k * GP + 2]), Math.exp(S.p[k * GP + 3])]; };

/* geometry of one Gaussian for one camera.  p5 = [x, z, ls1, ls2, th].  out = {ok, m, v, zc} */
function gsGeom(x, z, ls1, ls2, th, cam, A, dil, out) {
  var dx = x - cam.x, dz = z - cam.z;
  var xc = dx * A.rx + dz * A.rz, zc = dx * A.fx + dz * A.fz;
  out.zc = zc;
  if (zc < 0.25) { out.ok = false; out.m = 0; out.v = 1; return out; }
  var s1 = Math.exp(ls1), s2 = Math.exp(ls2), c = Math.cos(th), s = Math.sin(th);
  var a11 = c * c * s1 * s1 + s * s * s2 * s2, a12 = c * s * (s1 * s1 - s2 * s2), a22 = s * s * s1 * s1 + c * c * s2 * s2;
  var b11 = A.rx * A.rx * a11 + 2 * A.rx * A.rz * a12 + A.rz * A.rz * a22;
  var b12 = A.rx * A.fx * a11 + (A.rx * A.fz + A.rz * A.fx) * a12 + A.rz * A.fz * a22;
  var b22 = A.fx * A.fx * a11 + 2 * A.fx * A.fz * a12 + A.fz * A.fz * a22;
  var j0 = cam.f / zc, j1 = -cam.f * xc / (zc * zc);
  out.v = j0 * j0 * b11 + 2 * j0 * j1 * b12 + j1 * j1 * b22 + dil;
  out.m = cam.W / 2 + cam.f * xc / zc;
  out.ok = true;
  return out;
}
FL.gs.geom = function (S, k, cam) {
  var b = k * GP;
  return gsGeom(S.p[b], S.p[b + 1], S.p[b + 2], S.p[b + 3], S.p[b + 4], cam, FL.camAxes(cam), S.dil, {});
};

/* per-camera preparation: projected means/variances, depth order, activated opacity and colour */
function gsPrep(S, cam) {
  var K = S.K, A = FL.camAxes(cam), g = {}, m = new Float64Array(K), v = new Float64Array(K), zc = new Float64Array(K);
  var o = new Float64Array(K), col = new Float64Array(3 * K), ok = new Uint8Array(K), order = [];
  for (var k = 0; k < K; k++) {
    var b = k * GP;
    gsGeom(S.p[b], S.p[b + 1], S.p[b + 2], S.p[b + 3], S.p[b + 4], cam, A, S.dil, g);
    m[k] = g.m; v[k] = g.v; zc[k] = g.zc; ok[k] = g.ok ? 1 : 0;
    o[k] = sigmoid(S.p[b + 5]);
    col[3 * k] = sigmoid(S.p[b + 6]); col[3 * k + 1] = sigmoid(S.p[b + 7]); col[3 * k + 2] = sigmoid(S.p[b + 8]);
    if (g.ok) order.push(k);
  }
  order.sort(function (a, b2) { return zc[a] - zc[b2]; });
  return { m: m, v: v, zc: zc, o: o, col: col, ok: ok, order: order, A: A };
}
/* forward one pixel; if `list` is an array, push (k, α, g, T_before, clamped) for the backward pass */
function gsPixel(S, pr, u, list, out) {
  var T = 1, C0 = 0, C1 = 0, C2 = 0, ord = pr.order, n = ord.length;
  for (var j = 0; j < n; j++) {
    var k = ord[j], d = u - pr.m[k], v = pr.v[k];
    if (d * d > 24 * v) continue;                         // beyond ~5σ: α < o·e^{-12}
    var g = Math.exp(-d * d / (2 * v)), a = pr.o[k] * g, clamped = 0;
    if (a > 0.99) { a = 0.99; clamped = 1; }
    if (a < 1e-5) continue;
    var w = T * a;
    C0 += w * pr.col[3 * k]; C1 += w * pr.col[3 * k + 1]; C2 += w * pr.col[3 * k + 2];
    if (list) list.push(k, a, g, T, clamped);
    T *= (1 - a);
    if (T < 1e-4) break;
  }
  out[0] = C0 + T * S.bg[0]; out[1] = C1 + T * S.bg[1]; out[2] = C2 + T * S.bg[2]; out[3] = T;
  return out;
}
/* render a camera → {W, r, g, b, count (contributing (splat,pixel) pairs — the real work of the rasteriser)} */
FL.gs.render = function (S, cam) {
  var pr = gsPrep(S, cam), W = cam.W, out = { W: W, r: new Float32Array(W), g: new Float32Array(W), b: new Float32Array(W), pairs: 0 }, c = [0, 0, 0, 0];
  for (var i = 0; i < W; i++) {
    var list = [];
    gsPixel(S, pr, i + 0.5, list, c);
    out.r[i] = c[0]; out.g[i] = c[1]; out.b[i] = c[2]; out.pairs += list.length / 5;
  }
  return out;
};

/* loss + gradient over views.  views = [{cam, img}].  Returns {loss, grad (Float64Array K*9)} and updates the
 * densification statistics S.dmSum / S.dmCnt (mean |dL/dm|, the screen-space position gradient).                 */
FL.gs.grad = function (S, views) {
  var K = S.K, grad = new Float64Array(K * GP), P = 0, v, i, k;
  for (v = 0; v < views.length; v++) P += views[v].cam.W;
  var wgt = 1 / (3 * P), loss = 0;
  var tmp = {}, h = 1e-5;
  for (v = 0; v < views.length; v++) {
    var cam = views[v].cam, img = views[v].img, pr = gsPrep(S, cam), W = cam.W;
    var dM = new Float64Array(K), dV = new Float64Array(K), dO = new Float64Array(K), dCol = new Float64Array(3 * K), seen = new Uint8Array(K);
    var c = [0, 0, 0, 0];
    for (i = 0; i < W; i++) {
      var list = [], u = i + 0.5;
      gsPixel(S, pr, u, list, c);
      var e0 = c[0] - img.r[i], e1 = c[1] - img.g[i], e2 = c[2] - img.b[i];
      loss += (e0 * e0 + e1 * e1 + e2 * e2) * wgt;
      var dL0 = 2 * e0 * wgt, dL1 = 2 * e1 * wgt, dL2 = 2 * e2 * wgt;
      var b0 = c[3] * S.bg[0], b1 = c[3] * S.bg[1], b2 = c[3] * S.bg[2];       // "colour behind" accumulator
      for (var j = list.length / 5 - 1; j >= 0; j--) {
        var q = j * 5, kk = list[q], a = list[q + 1], g = list[q + 2], Tj = list[q + 3], clamped = list[q + 4];
        var w = Tj * a, c0 = pr.col[3 * kk], c1 = pr.col[3 * kk + 1], c2 = pr.col[3 * kk + 2];
        dCol[3 * kk] += w * dL0; dCol[3 * kk + 1] += w * dL1; dCol[3 * kk + 2] += w * dL2;
        if (!clamped) {
          var dLda = dL0 * (Tj * c0 - b0 / (1 - a)) + dL1 * (Tj * c1 - b1 / (1 - a)) + dL2 * (Tj * c2 - b2 / (1 - a));
          dO[kk] += dLda * g;
          var dLdg = dLda * pr.o[kk], d = u - pr.m[kk], vv = pr.v[kk];
          dM[kk] += dLdg * g * d / vv;
          dV[kk] += dLdg * g * d * d / (2 * vv * vv);
          seen[kk] = 1;
        }
        b0 += w * c0; b1 += w * c1; b2 += w * c2;
      }
    }
    // chain through the geometry map (m, v) ← (x, z, ls1, ls2, th) with central differences
    for (k = 0; k < K; k++) {
      var base = k * GP;
      if (!pr.ok[k]) continue;
      // colours and opacity (exact)
      grad[base + 5] += dO[k] * pr.o[k] * (1 - pr.o[k]);
      for (var ch = 0; ch < 3; ch++) { var cc = pr.col[3 * k + ch]; grad[base + 6 + ch] += dCol[3 * k + ch] * cc * (1 - cc); }
      if (dM[k] === 0 && dV[k] === 0) continue;
      for (var pi = 0; pi < 5; pi++) {
        var save = S.p[base + pi], hp = h * (1 + Math.abs(save));
        S.p[base + pi] = save + hp;
        gsGeom(S.p[base], S.p[base + 1], S.p[base + 2], S.p[base + 3], S.p[base + 4], cam, pr.A, S.dil, tmp);
        var mp = tmp.m, vp = tmp.v;
        S.p[base + pi] = save - hp;
        gsGeom(S.p[base], S.p[base + 1], S.p[base + 2], S.p[base + 3], S.p[base + 4], cam, pr.A, S.dil, tmp);
        var mm = tmp.m, vm = tmp.v;
        S.p[base + pi] = save;
        grad[base + pi] += dM[k] * (mp - mm) / (2 * hp) + dV[k] * (vp - vm) / (2 * hp);
      }
      if (seen[k]) { S.dmSum[k] += Math.abs(dM[k]); S.dmCnt[k] += 1; }
    }
  }
  return { loss: loss, grad: grad };
};
/* one Adam step on all parameters.  lr: {pos, scale, rot, opa, col} (defaults below) */
FL.gs.step = function (S, views, opts) {
  opts = opts || {};
  var lrs = { pos: 0.01, scale: 0.02, rot: 0.02, opa: 0.05, col: 0.05 };
  if (opts.lr) for (var key in opts.lr) lrs[key] = opts.lr[key];
  var r = FL.gs.grad(S, views), K = S.K, b1 = 0.9, b2 = 0.999;
  S.t++;
  var c1 = 1 - Math.pow(b1, S.t), c2 = 1 - Math.pow(b2, S.t);
  for (var k = 0; k < K; k++) for (var q = 0; q < GP; q++) {
    var idx = k * GP + q, g = r.grad[idx];
    S.m[idx] = b1 * S.m[idx] + (1 - b1) * g; S.v[idx] = b2 * S.v[idx] + (1 - b2) * g * g;
    var lr = q < 2 ? lrs.pos : q < 4 ? lrs.scale : q === 4 ? lrs.rot : q === 5 ? lrs.opa : lrs.col;
    S.p[idx] -= lr * (S.m[idx] / c1) / (Math.sqrt(S.v[idx] / c2) + 1e-8);
    if (q === 2 || q === 3) S.p[idx] = Math.max(Math.log(0.02), Math.min(Math.log(1.5), S.p[idx]));
  }
  return r.loss;
};
function gsResize(S, keep, extra) {                 // rebuild arrays: keep = indices to keep, extra = new param vectors
  var K2 = keep.length + extra.length, p = new Float64Array(K2 * GP);
  for (var i = 0; i < keep.length; i++) for (var q = 0; q < GP; q++) p[i * GP + q] = S.p[keep[i] * GP + q];
  for (var j = 0; j < extra.length; j++) for (var q2 = 0; q2 < GP; q2++) p[(keep.length + j) * GP + q2] = extra[j][q2];
  S.K = K2; S.p = p; S.m = new Float64Array(K2 * GP); S.v = new Float64Array(K2 * GP); S.t = 0;
  S.dmSum = new Float64Array(K2); S.dmCnt = new Float64Array(K2);
}
/* adaptive density control.  Gaussians whose mean screen-space position gradient exceeds `thresh` are densified:
 * small ones are CLONED (under-reconstruction), large ones are SPLIT in two (over-reconstruction).  returns counts. */
FL.gs.densify = function (S, o) {
  o = o || {};
  var big = o.big || 0.35, maxK = o.maxK || 400, rng = o.rng || FL.rng(5);
  var stats = [];
  for (var q = 0; q < S.K; q++) stats.push(S.dmCnt[q] ? S.dmSum[q] / S.dmCnt[q] : 0);
  var thresh = o.thresh;
  if (thresh === undefined) {                           // default: densify the top `frac` of Gaussians by position-gradient
    var sorted = stats.slice().sort(function (a, b) { return a - b; }), fr = o.frac === undefined ? 0.25 : o.frac;
    thresh = sorted[Math.min(sorted.length - 1, Math.floor((1 - fr) * sorted.length))];
  }
  var extra = [], cloned = 0, split = 0, keep = [];
  for (var k = 0; k < S.K; k++) {
    var stat = stats[k], b = k * GP, s1 = Math.exp(S.p[b + 2]), s2 = Math.exp(S.p[b + 3]);
    if (stat > thresh && stat > 0 && S.K + extra.length < maxK) {
      var smax = Math.max(s1, s2);
      if (smax > big) {                                   // split: replace by two smaller Gaussians along the major axis
        var ang = s1 >= s2 ? S.p[b + 4] : S.p[b + 4] + Math.PI / 2, off = 0.5 * smax;
        var a = S.p.slice(b, b + GP), c = S.p.slice(b, b + GP);
        a[0] += off * Math.cos(ang); a[1] += off * Math.sin(ang); c[0] -= off * Math.cos(ang); c[1] -= off * Math.sin(ang);
        a[2] -= Math.log(1.6); a[3] -= Math.log(1.6); c[2] -= Math.log(1.6); c[3] -= Math.log(1.6);
        extra.push(a); extra.push(c); split++;
      } else {                                            // clone: copy and nudge
        var cl = S.p.slice(b, b + GP), phi = rng() * 2 * Math.PI;
        cl[0] += 0.6 * smax * Math.cos(phi); cl[1] += 0.6 * smax * Math.sin(phi);
        keep.push(k); extra.push(cl); cloned++;
      }
    } else keep.push(k);
  }
  gsResize(S, keep, extra);
  return { cloned: cloned, split: split, K: S.K };
};
FL.gs.prune = function (S, o) {
  o = o || {};
  var minO = o.minOpacity === undefined ? 0.02 : o.minOpacity, maxS = o.maxScale || 1.2, keep = [];
  for (var k = 0; k < S.K; k++) {
    var b = k * GP;
    if (sigmoid(S.p[b + 5]) >= minO && Math.exp(S.p[b + 2]) < maxS && Math.exp(S.p[b + 3]) < maxS) keep.push(k);
  }
  var removed = S.K - keep.length;
  if (removed) gsResize(S, keep, []);
  return { removed: removed, K: S.K };
};

/* ───────────────────────────── shape inference with priors (lessons 11 and 13) ───────────────────────────── */
/* A star-shaped object is its radial profile  R(φ) = 1 + Σ_{k=1..K} (a_k cos kφ + b_k sin kφ)  (times a scale r).
 * θ = [a_1, b_1, a_2, b_2, …] ∈ ℝ^{2K} (K = 5).  A depth camera looking at the object from azimuth α sees the FRONT arc
 * φ ∈ [α − half, α + half]: it measures R at those angles, so a view is a LINEAR measurement  y = A θ + noise.
 * Linear measurement + Gaussian prior ⇒ the posterior is Gaussian, in closed form:
 *     Σ_post = (Λ⁻¹ + AᵀA/σ²)⁻¹ ,   μ_post = Σ_post (Λ⁻¹ μ₀ + Aᵀ(y − 1)/σ²)                                              */
FL.shape = {};
var SH = FL.shape;
SH.K = 5; SH.dim = 10;
SH.radius = function (th, phi) {
  var r = 1;
  for (var k = 1; k <= SH.K; k++) r += th[2 * k - 2] * Math.cos(k * phi) + th[2 * k - 1] * Math.sin(k * phi);
  return r;
};
/* design matrix rows for angles phis: row = [cos φ, sin φ, cos 2φ, sin 2φ, …]   (returns Float64Array n×dim) */
SH.design = function (phis) {
  var n = phis.length, A = new Float64Array(n * SH.dim);
  for (var j = 0; j < n; j++) for (var k = 1; k <= SH.K; k++) { A[j * SH.dim + 2 * k - 2] = Math.cos(k * phis[j]); A[j * SH.dim + 2 * k - 1] = Math.sin(k * phis[j]); }
  return A;
};
/* the angles one view at azimuth α measures: n samples across the front arc of half-width `half` */
SH.arc = function (alpha, n, half) {
  var out = [];
  for (var j = 0; j < n; j++) out.push(alpha + half * (n > 1 ? 2 * j / (n - 1) - 1 : 0));
  return out;
};
/* which of a set of probe angles lie within `half` of some view azimuth (i.e. were SEEN) */
SH.seen = function (phi, alphas, half) {
  for (var i = 0; i < alphas.length; i++) { var d = Math.abs(FL.se2.wrap(phi - alphas[i])); if (d <= half + 1e-9) return true; }
  return false;
};
/* convert θ to FL.blob harmonics [[k, amp, phase], …]  (amp cos(kφ+ph) = a cos kφ + b sin kφ ⇒ a = amp cos ph, b = −amp sin ph) */
SH.harmonics = function (th) {
  var h = [];
  for (var k = 1; k <= SH.K; k++) { var a = th[2 * k - 2], b = th[2 * k - 1]; h.push([k, Math.sqrt(a * a + b * b), Math.atan2(-b, a)]); }
  return h;
};
SH.fromHarmonics = function (harm) {
  var th = new Float64Array(SH.dim);
  harm.forEach(function (h) { th[2 * h[0] - 2] += h[1] * Math.cos(h[2]); th[2 * h[0] - 1] += -h[1] * Math.sin(h[2]); });
  return th;
};
/* ── the family the world draws shapes from: three latent factors (elongation, triangularity, lopsidedness) + a little noise */
SH.M = [   // rows = [a1 b1 a2 b2 a3 b3 a4 b4 a5 b5],  one row per factor
  [0, 0, 0.125, 0.02, 0, 0, 0.045, 0.01, 0, 0],
  [0, 0, 0, 0, 0.045, 0.06, 0, 0, -0.022, 0.025],
  [0.10, 0.04, 0.025, 0, 0, 0, 0, 0, 0, 0]
];
SH.famNoise = 0.012;
SH.sampleFamily = function (rng, scale) {
  var z = [FL.randn(rng) * (scale || 1), FL.randn(rng) * (scale || 1), FL.randn(rng) * (scale || 1)], th = new Float64Array(SH.dim);
  for (var i = 0; i < SH.dim; i++) { th[i] = SH.famNoise * FL.randn(rng); for (var f = 0; f < 3; f++) th[i] += z[f] * SH.M[f][i]; }
  return th;
};
/* ── small matrix helpers (row-major) */
function mmul(A, ar, ac, B, bc) { var C = new Float64Array(ar * bc); for (var i = 0; i < ar; i++) for (var k = 0; k < ac; k++) { var a = A[i * ac + k]; if (a === 0) continue; for (var j = 0; j < bc; j++) C[i * bc + j] += a * B[k * bc + j]; } return C; }
function mT(A, r, c) { var B = new Float64Array(r * c); for (var i = 0; i < r; i++) for (var j = 0; j < c; j++) B[j * r + i] = A[i * c + j]; return B; }
function minv(A, n) { var I = new Float64Array(n * n); for (var i = 0; i < n; i++) I[i * n + i] = 1; var cols = new Float64Array(n * n), out = new Float64Array(n * n);
  for (var j = 0; j < n; j++) { var e = new Float64Array(n); e[j] = 1; var x = FL.solve(A, e, n); if (!x) return null; for (var i2 = 0; i2 < n; i2++) out[i2 * n + j] = x[i2]; } return out; }
SH.mmul = mmul; SH.mT = mT; SH.minv = minv;
function chol(A, n) {
  var L = new Float64Array(n * n);
  for (var i = 0; i < n; i++) for (var j = 0; j <= i; j++) {
    var s = A[i * n + j]; for (var k = 0; k < j; k++) s -= L[i * n + k] * L[j * n + k];
    if (i === j) L[i * n + i] = Math.sqrt(Math.max(s, 1e-14)); else L[i * n + j] = s / L[j * n + j];
  }
  return L;
}
/* priors: {mu (dim), Lam (dim×dim covariance)}.
 *  'broad'  – almost no prior (min-norm least squares in disguise)
 *  'smooth' – independent harmonics with σ_k = s0 / k^p  (the hand-made "rounded shapes are likelier" prior)
 *  'learned' – the empirical mean and covariance of n shapes drawn from the family (what training on a dataset gives you) */
SH.prior = function (kind, o) {
  o = o || {}; var d = SH.dim, mu = new Float64Array(d), Lam = new Float64Array(d * d), k, i;
  if (kind === 'broad') { for (i = 0; i < d; i++) Lam[i * d + i] = 1; }
  else if (kind === 'smooth') {
    var s0 = o.s0 || 0.12, p = o.p === undefined ? 1.0 : o.p;
    for (k = 1; k <= SH.K; k++) { var v = Math.pow(s0 / Math.pow(k, p), 2); Lam[(2 * k - 2) * d + 2 * k - 2] = v; Lam[(2 * k - 1) * d + 2 * k - 1] = v; }
  } else if (kind === 'learned') {
    var rng = FL.rng(o.seed || 99), n = o.n || 400, X = new Float64Array(n * d), r;
    for (r = 0; r < n; r++) { var th = SH.sampleFamily(rng); for (i = 0; i < d; i++) X[r * d + i] = th[i]; }
    for (r = 0; r < n; r++) for (i = 0; i < d; i++) mu[i] += X[r * d + i] / n;
    for (r = 0; r < n; r++) for (i = 0; i < d; i++) for (var j = 0; j < d; j++) Lam[i * d + j] += (X[r * d + i] - mu[i]) * (X[r * d + j] - mu[j]) / (n - 1);
    for (i = 0; i < d; i++) Lam[i * d + i] += 1e-6;
  }
  return { mu: mu, Lam: Lam };
};
/* posterior of θ given measurements y at angles phis with noise σ:  returns {mean, cov, A} */
SH.posterior = function (phis, y, sigma, prior) {
  var d = SH.dim, n = phis.length, A = SH.design(phis), At = mT(A, n, d);
  var LamInv = minv(prior.Lam, d), P = mmul(At, d, n, A, d), i;
  for (i = 0; i < d * d; i++) P[i] = LamInv[i] + P[i] / (sigma * sigma);
  var cov = minv(P, d), rhs = new Float64Array(d);
  var LmMu = mmul(LamInv, d, d, prior.mu, 1), r = new Float64Array(n);
  for (i = 0; i < n; i++) r[i] = y[i] - 1;
  var Atr = mmul(At, d, n, r, 1);
  for (i = 0; i < d; i++) rhs[i] = LmMu[i] + Atr[i] / (sigma * sigma);
  var mean = mmul(cov, d, d, rhs, 1);
  return { mean: mean, cov: cov, A: A };
};
/* the prior alone (no data) in the same format */
SH.priorAsPosterior = function (prior) { return { mean: prior.mu, cov: prior.Lam }; };
/* pointwise mean and std of R(φ) under a Gaussian over θ */
SH.profile = function (post, phis) {
  var d = SH.dim, n = phis.length, A = SH.design(phis), m = new Float64Array(n), s = new Float64Array(n);
  for (var j = 0; j < n; j++) {
    var row = A.subarray(j * d, (j + 1) * d), mv = 1, i, k;
    for (i = 0; i < d; i++) mv += row[i] * post.mean[i];
    var v = 0; for (i = 0; i < d; i++) for (k = 0; k < d; k++) v += row[i] * post.cov[i * d + k] * row[k];
    m[j] = mv; s[j] = Math.sqrt(Math.max(v, 0));
  }
  return { mean: m, std: s };
};
SH.sample = function (post, rng, n) {
  var d = SH.dim, L = chol(post.cov, d), out = [];
  for (var s = 0; s < n; s++) {
    var z = new Float64Array(d), th = new Float64Array(d), i, j;
    for (i = 0; i < d; i++) z[i] = FL.randn(rng);
    for (i = 0; i < d; i++) { var v = post.mean[i]; for (j = 0; j <= i; j++) v += L[i * d + j] * z[j]; th[i] = v; }
    out.push(th);
  }
  return out;
};
/* measure a TRUE shape θ from views at azimuths alphas: returns {phis, y} with Gaussian noise */
SH.measure = function (th, alphas, n, half, sigma, rng) {
  var phis = [], y = [];
  alphas.forEach(function (a) { SH.arc(a, n, half).forEach(function (p) { phis.push(p); y.push(SH.radius(th, p) + sigma * FL.randn(rng)); }); });
  return { phis: phis, y: y };
};

/* the statue: a typical member of the family (latent factors z = [1.0, 1.1, −0.3]), no noise */
SH.statueTheta = function () {
  var z = [1.0, 1.1, -0.3], th = new Float64Array(SH.dim);
  for (var f = 0; f < 3; f++) for (var i = 0; i < SH.dim; i++) th[i] += z[f] * SH.M[f][i];
  return th;
};
/* ── mixtures: two kinds of object.  A class = {name, pi, mu, Lam}.  Class "oval" leans on the elongation factor, "trefoil" on triangularity. */
SH.classes = function () {
  var d = SH.dim, out = [], names = ['oval', 'trefoil'];
  for (var c = 0; c < 2; c++) {
    var mu = new Float64Array(d), Lam = new Float64Array(d * d), i, j, f = SH.M[c], sz = 0.35;
    for (i = 0; i < d; i++) mu[i] = 1.6 * f[i];
    for (i = 0; i < d; i++) for (j = 0; j < d; j++) Lam[i * d + j] = sz * sz * f[i] * f[j];
    for (i = 0; i < d; i++) Lam[i * d + i] += SH.famNoise * SH.famNoise * 4;
    out.push({ name: names[c], pi: 0.5, mu: mu, Lam: Lam });
  }
  return out;
};
/* posterior of a mixture prior: each class gives a Gaussian posterior and a weight ∝ π_c · N(y; Aμ_c + 1, AΛ_cAᵀ + σ²I) */
SH.mixturePosterior = function (phis, y, sigma, comps) {
  var d = SH.dim, n = phis.length, A = SH.design(phis), At = mT(A, n, d), res = [], logw = [], mx = -1e300, c, i, j;
  for (c = 0; c < comps.length; c++) {
    var post = SH.posterior(phis, y, sigma, comps[c]);
    var S = mmul(mmul(A, n, d, comps[c].Lam, d), n, d, At, n);
    for (i = 0; i < n; i++) S[i * n + i] += sigma * sigma;
    var Am = mmul(A, n, d, comps[c].mu, 1), r = new Float64Array(n);
    for (i = 0; i < n; i++) r[i] = y[i] - 1 - Am[i];
    var L = chol(S, n), z = new Float64Array(n), logdet = 0, q = 0;
    for (i = 0; i < n; i++) { var s = r[i]; for (j = 0; j < i; j++) s -= L[i * n + j] * z[j]; z[i] = s / L[i * n + i]; q += z[i] * z[i]; logdet += 2 * Math.log(L[i * n + i]); }
    var lw = Math.log(comps[c].pi) - 0.5 * (q + logdet + n * Math.log(2 * Math.PI));
    logw.push(lw); if (lw > mx) mx = lw;
    res.push({ name: comps[c].name, mean: post.mean, cov: post.cov });
  }
  var Z = 0; for (c = 0; c < res.length; c++) { res[c].w = Math.exp(logw[c] - mx); Z += res[c].w; }
  for (c = 0; c < res.length; c++) res[c].w /= Z;
  return res;
};
SH.sampleMixture = function (mp, rng, n) {
  var out = [];
  for (var s = 0; s < n; s++) {
    var u = rng(), acc = 0, c = 0;
    for (c = 0; c < mp.length; c++) { acc += mp[c].w; if (u <= acc) break; }
    if (c >= mp.length) c = mp.length - 1;
    var th = SH.sample(mp[c], rng, 1)[0]; th.cls = c; out.push(th);
  }
  return out;
};
/* mean of the mixture posterior (the "regression" answer: it can fall BETWEEN the classes) */
SH.mixtureMean = function (mp) {
  var m = new Float64Array(SH.dim);
  for (var c = 0; c < mp.length; c++) for (var i = 0; i < SH.dim; i++) m[i] += mp[c].w * mp[c].mean[i];
  return m;
};

/* ───────────────────────────── drawing helpers (canvas 2D) ───────────────────────────── */
FL.C = { ink: '#1f2430', mute: '#5b6573', dim: '#94a3b8', grid: '#e3e7ee', blue: '#2563eb', blueSoft: '#dbe7ff',
         amber: '#d97706', amberSoft: '#fdebc8', green: '#16a34a', greenSoft: '#d8f3e0', red: '#dc2626', redSoft: '#fbdada',
         violet: '#7c3aed', violetSoft: '#e9defd', panel: '#f7f8fa', code: '#f1f3f7', white: '#ffffff' };
FL.draw = {};
var D = FL.draw;
function rgb(c, a) {
  var r = Math.round(255 * Math.min(1, Math.max(0, c[0]))), g = Math.round(255 * Math.min(1, Math.max(0, c[1]))), b = Math.round(255 * Math.min(1, Math.max(0, c[2])));
  return a === undefined ? 'rgb(' + r + ',' + g + ',' + b + ')' : 'rgba(' + r + ',' + g + ',' + b + ',' + a + ')';
}
D.rgb = rgb;
/* DPR-aware canvas setup; returns {ctx, w, h} in CSS pixels */
D.setup = function (canvas) {
  var dpr = Math.min((typeof window !== 'undefined' && window.devicePixelRatio) || 1, 3);
  var w = Math.max(280, canvas.clientWidth || 640), h = Math.max(120, canvas.clientHeight || 300);
  var rw = Math.round(w * dpr), rh = Math.round(h * dpr);
  if (canvas.width !== rw || canvas.height !== rh) { canvas.width = rw; canvas.height = rh; }
  var ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  return { ctx: ctx, w: w, h: h };
};
/* world → canvas mapping that keeps the aspect ratio and has z pointing UP.  rect = [x0,x1,z0,z1] in a box (bx,by,bw,bh) */
D.view = function (bx, by, bw, bh, x0, x1, z0, z1) {
  var s = Math.min(bw / (x1 - x0), bh / (z1 - z0)), ox = bx + (bw - s * (x1 - x0)) / 2, oy = by + (bh - s * (z1 - z0)) / 2;
  return { s: s, x0: x0, z1: z1, ox: ox, oy: oy, bx: bx, by: by, bw: bw, bh: bh,
           X: function (x) { return ox + (x - x0) * s; }, Y: function (z) { return oy + (z1 - z) * s; },
           ix: function (px) { return x0 + (px - ox) / s; }, iz: function (py) { return z1 - (py - oy) / s; } };
};
D.line = function (ctx, x1, y1, x2, y2, color, width, dash) {
  ctx.save(); ctx.strokeStyle = color || FL.C.ink; ctx.lineWidth = width || 1; ctx.setLineDash(dash || []);
  ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke(); ctx.restore();
};
D.dot = function (ctx, x, y, r, fill, stroke) {
  ctx.beginPath(); ctx.arc(x, y, r, 0, 2 * PI); ctx.fillStyle = fill || FL.C.ink; ctx.fill();
  if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 1; ctx.stroke(); }
};
/* Text that cannot leave the canvas: shrink the font (to 75 %, at least 7 px), then truncate with an ellipsis.  Every label in every
 * widget passes through D.text / D.mono / D.label, so narrow screens clip nothing at the canvas edge. */
D.fit = function (ctx, s, x, align, size, fontOf) {
  var cv = ctx.canvas, cw = cv && cv.clientWidth, sz = size, w, t, n, m;
  s = String(s); t = s;
  ctx.font = fontOf(sz);
  if (!cw || !ctx.measureText) return { s: s, size: sz };
  var avail = align === 'right' ? x - 2 : align === 'center' ? 2 * Math.min(x - 2, cw - 2 - x) : cw - 2 - x;
  m = ctx.measureText(s); w = m && m.width;
  if (!(w > avail)) return { s: s, size: sz };
  while (w > avail && sz > Math.max(7, size * 0.75)) { sz -= 0.5; ctx.font = fontOf(sz); m = ctx.measureText(s); w = m && m.width; }
  for (n = s.length; w > avail && n > 3; ) { n--; t = s.slice(0, n) + '\u2026'; m = ctx.measureText(t); w = m && m.width; }
  return { s: n < s.length ? t : s, size: sz };
};
D.text = function (ctx, s, x, y, color, size, align, weight) {
  var f = function (z) { return (weight || 500) + ' ' + z + 'px -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, sans-serif'; }, r = D.fit(ctx, s, x, align || 'left', size || 12, f);
  ctx.fillStyle = color || FL.C.ink; ctx.font = f(r.size);
  ctx.textAlign = align || 'left'; ctx.textBaseline = 'middle'; ctx.fillText(r.s, x, y);
};
D.mono = function (ctx, s, x, y, color, size, align) {
  var f = function (z) { return z + 'px "SF Mono", Menlo, Consolas, monospace'; }, r = D.fit(ctx, s, x, align || 'left', size || 10, f);
  ctx.fillStyle = color || FL.C.mute; ctx.font = f(r.size);
  ctx.textAlign = align || 'left'; ctx.textBaseline = 'middle'; ctx.fillText(r.s, x, y);
};
/* a polyline through canvas points [[x,y],...] */
D.path = function (ctx, pts, color, width, dash) {
  if (pts.length < 2) return;
  ctx.save(); ctx.strokeStyle = color || FL.C.ink; ctx.lineWidth = width || 2; ctx.setLineDash(dash || []); ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]);
  for (var i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  ctx.stroke(); ctx.restore();
};
/* mono label with a white halo, readable over lines and fills */
D.label = function (ctx, s, x, y, color, size, align) {
  var f = function (z) { return z + 'px "SF Mono", Menlo, Consolas, monospace'; }, r = D.fit(ctx, s, x, align || 'left', size || 10, f);
  ctx.save(); ctx.font = f(r.size); ctx.textAlign = align || 'left'; ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round'; ctx.lineWidth = 3.5; ctx.strokeStyle = 'rgba(255,255,255,0.92)'; ctx.strokeText(r.s, x, y);
  ctx.fillStyle = color || FL.C.mute; ctx.fillText(r.s, x, y); ctx.restore();
};
D.arrow = function (ctx, x1, y1, x2, y2, color, width) {
  D.line(ctx, x1, y1, x2, y2, color, width || 1.5);
  var a = Math.atan2(y2 - y1, x2 - x1), s = 6;
  ctx.save(); ctx.fillStyle = color || FL.C.ink; ctx.beginPath(); ctx.moveTo(x2, y2);
  ctx.lineTo(x2 - s * Math.cos(a - 0.45), y2 - s * Math.sin(a - 0.45)); ctx.lineTo(x2 - s * Math.cos(a + 0.45), y2 - s * Math.sin(a + 0.45));
  ctx.closePath(); ctx.fill(); ctx.restore();
};
D.frame = function (ctx, x, y, w, h, fill, stroke) {
  ctx.save(); ctx.fillStyle = fill || FL.C.panel; ctx.strokeStyle = stroke || FL.C.grid; ctx.lineWidth = 1;
  ctx.fillRect(x, y, w, h); ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1); ctx.restore();
};
/* light grid + axis ticks for a world view */
D.grid = function (ctx, v, step) {
  step = step || 1;
  var x0 = Math.ceil(v.ix(v.bx) / step) * step, x1 = v.ix(v.bx + v.bw), z0 = Math.ceil(v.iz(v.by + v.bh) / step) * step, z1 = v.iz(v.by);
  var x, z;
  ctx.save(); ctx.strokeStyle = FL.C.grid; ctx.lineWidth = 1;
  for (x = x0; x <= x1 + 1e-9; x += step) { ctx.beginPath(); ctx.moveTo(v.X(x), v.by); ctx.lineTo(v.X(x), v.by + v.bh); ctx.stroke(); }
  for (z = z0; z <= z1 + 1e-9; z += step) { ctx.beginPath(); ctx.moveTo(v.bx, v.Y(z)); ctx.lineTo(v.bx + v.bw, v.Y(z)); ctx.stroke(); }
  ctx.restore();
};
/* boundary point of a star-shaped shape in direction phi (bisection on its SDF) */
function boundaryPoint(sh, phi) {
  var lo = 0, hi = 12, c = Math.cos(phi), s = Math.sin(phi);
  for (var i = 0; i < 40; i++) { var mid = (lo + hi) / 2; if (sdfShape(sh, sh.x + mid * c, sh.z + mid * s) < 0) lo = mid; else hi = mid; }
  return { x: sh.x + lo * c, z: sh.z + lo * s };
}
FL.boundary = function (sh, n) {
  var pts = [];
  for (var i = 0; i < n; i++) pts.push(boundaryPoint(sh, 2 * PI * i / n));
  return pts;
};
/* top-down scene: soft fill + a textured outline (so surfaces visibly carry colour) */
D.scene = function (ctx, scene, v, o) {
  o = o || {};
  for (var si = 0; si < scene.shapes.length; si++) {
    var sh = scene.shapes[si], pts = FL.boundary(sh, 120), i;
    ctx.save();
    ctx.beginPath();
    for (i = 0; i < pts.length; i++) { var X = v.X(pts[i].x), Y = v.Y(pts[i].z); if (i) ctx.lineTo(X, Y); else ctx.moveTo(X, Y); }
    ctx.closePath(); ctx.fillStyle = rgb(sh.col, o.fillAlpha === undefined ? 0.22 : o.fillAlpha); ctx.fill();
    ctx.lineWidth = o.lineWidth || 3.5;
    for (i = 0; i < pts.length; i++) {
      var p = pts[i], q = pts[(i + 1) % pts.length], col = FL.albedo(sh, p.x, p.z);
      ctx.strokeStyle = rgb(col); ctx.beginPath(); ctx.moveTo(v.X(p.x), v.Y(p.z)); ctx.lineTo(v.X(q.x), v.Y(q.z)); ctx.stroke();
    }
    ctx.restore();
  }
};
/* a camera: small body, optic axis, field-of-view wedge.  o: color, label, fov (draw wedge, default true), len */
D.camera = function (ctx, cam, v, o) {
  o = o || {};
  var col = o.color || FL.C.blue, A = FL.camAxes(cam), x = v.X(cam.x), y = v.Y(cam.z), half = FL.hfov(cam) / 2, len = (o.len || 1.6);
  if (o.fov !== false) {
    ctx.save(); ctx.strokeStyle = col; ctx.globalAlpha = 0.45; ctx.lineWidth = 1;
    [-half, half].forEach(function (s) {
      var da = cam.a + s;
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(v.X(cam.x + len * Math.cos(da)), v.Y(cam.z + len * Math.sin(da))); ctx.stroke();
    });
    ctx.restore();
  }
  ctx.save(); ctx.fillStyle = col; ctx.beginPath();
  var ux = A.fx, uy = -A.fz, px = A.rx, py = -A.rz;                     // canvas y points down
  ctx.moveTo(x + 8 * ux, y + 8 * uy); ctx.lineTo(x - 5 * ux + 5 * px, y - 5 * uy + 5 * py); ctx.lineTo(x - 5 * ux - 5 * px, y - 5 * uy - 5 * py);
  ctx.closePath(); ctx.fill(); ctx.restore();
  if (o.label) D.text(ctx, o.label, x - 7 * ux + 9 * px, y - 7 * uy + 9 * py + 2, col, 11, 'center', 600);
};
/* a world-space segment */
D.wline = function (ctx, v, x1, z1, x2, z2, color, width, dash) { D.line(ctx, v.X(x1), v.Y(z1), v.X(x2), v.Y(z2), color, width, dash); };
D.wdot = function (ctx, v, x, z, r, fill, stroke) { D.dot(ctx, v.X(x), v.Y(z), r, fill, stroke); };
/* a 1D image drawn as a row of coloured cells.  img = {W, r, g, b}.  o: label, border */
D.strip = function (ctx, img, x, y, w, h, o) {
  o = o || {};
  var W = img.W, cw = w / W;
  for (var i = 0; i < W; i++) {
    ctx.fillStyle = rgb([img.r[i], img.g[i], img.b[i]]);
    ctx.fillRect(x + i * cw, y, Math.ceil(cw) + 0.5, h);
  }
  ctx.strokeStyle = o.border || FL.C.grid; ctx.lineWidth = 1; ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
  if (o.label) D.mono(ctx, o.label, x, y - 7, FL.C.mute, 10);
};
/* signed error strip: |A−B| per pixel as a grey→red ramp */
D.errorStrip = function (ctx, A, B, x, y, w, h, o) {
  o = o || {};
  var W = A.W, cw = w / W;
  for (var i = 0; i < W; i++) {
    var e = Math.sqrt(((A.r[i] - B.r[i]) * (A.r[i] - B.r[i]) + (A.g[i] - B.g[i]) * (A.g[i] - B.g[i]) + (A.b[i] - B.b[i]) * (A.b[i] - B.b[i])) / 3);
    var t = Math.min(1, e * (o.gain || 3));
    ctx.fillStyle = 'rgb(' + Math.round(255 - 35 * t) + ',' + Math.round(255 - 215 * t) + ',' + Math.round(255 - 215 * t) + ')';
    ctx.fillRect(x + i * cw, y, Math.ceil(cw) + 0.5, h);
  }
  ctx.strokeStyle = FL.C.grid; ctx.lineWidth = 1; ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
  if (o.label) D.mono(ctx, o.label, x, y - 7, FL.C.mute, 10);
};
/* a simple line plot of ys over xs inside a box; returns the mapping.  o: color, ymin, ymax, label */
D.plot = function (ctx, xs, ys, bx, by, bw, bh, o) {
  o = o || {};
  var xmin = o.xmin !== undefined ? o.xmin : Math.min.apply(null, xs), xmax = o.xmax !== undefined ? o.xmax : Math.max.apply(null, xs);
  var ymin = o.ymin !== undefined ? o.ymin : Math.min.apply(null, ys), ymax = o.ymax !== undefined ? o.ymax : Math.max.apply(null, ys);
  if (ymax === ymin) ymax = ymin + 1;
  var X = function (x) { return bx + (x - xmin) / (xmax - xmin || 1) * bw; }, Y = function (y) { return by + bh - (y - ymin) / (ymax - ymin) * bh; };
  if (!o.noframe) D.frame(ctx, bx, by, bw, bh, o.fill || FL.C.white);
  ctx.save(); ctx.strokeStyle = o.color || FL.C.blue; ctx.lineWidth = o.width || 2; ctx.setLineDash(o.dash || []); ctx.beginPath();
  for (var i = 0; i < xs.length; i++) { if (i) ctx.lineTo(X(xs[i]), Y(ys[i])); else ctx.moveTo(X(xs[i]), Y(ys[i])); }
  ctx.stroke(); ctx.restore();
  return { X: X, Y: Y };
};

root.FL = FL;
if (typeof module !== 'undefined' && module.exports) module.exports = FL;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
