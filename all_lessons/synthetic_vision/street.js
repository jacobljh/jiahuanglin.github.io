/* street.js — the running world of the Synthetic Vision Data series.
 *
 * The Street is a small, honest laboratory for the question "what does a model learn from data a program made?".  A shuttle's camera (1.4 m above the
 * road, looking along +z) sees a street: a parked van, poles, trees, a far wall of buildings, and, sometimes, a pedestrian who stands in the open or
 * steps out from behind the van.  The world is a Flatland seen from above (x to the right, z forward, metres) whose objects are vertical extrusions with
 * a height range [y0, y1]; the camera is a pinhole with W x H pixels (96 x 24) and a focal length f in pixels; an image is H rows of W columns of three
 * colour channels.  Every claim of the series is a computation on such images.
 *
 * The data-generating process is a PIPELINE of stages, each with its own configuration:
 *     scene  (what exists, and where)      drawScene(cfg.scene)
 *     look   (light, colours, textures)    drawLook(cfg.look)
 *     sensor (radiance -> numbers)         sense(radiance, cfg.sensor)
 *     label  (what counts as truth)        labels(coverage, cfg.label)
 * SV.SIM0 is the first, naive simulator a team writes; SV.REAL is the world the model is graded on.  A lesson page reaches REAL only through SV.real
 * (a labelled test set, a labelled budget, unlabelled frames): reality is a data source, not something whose parameters a page may read.  The one
 * exception is lesson 2's swap test, which says so.
 *
 * Conventions: pixel (u, v), u to the right, v down, pixel centres at +0.5; principal point (W/2, V0).  A pixel ray has tan(phi) = (u - W/2)/f
 * horizontally and rho = (V0 - v)/f vertically.  depth = distance along the optical axis (z), range = Euclidean distance.  Radiance is linear, 0..~1;
 * DN (the sensor's output) is 0..1 after gamma.  Deterministic: no Math.random, no Date; pass SV.rng(seed).
 */
(function (root) {
'use strict';
var SV = {};
var PI = Math.PI;

SV.CAM = { W: 96, H: 24, f: 83.1, V0: 9, hc: 1.4 };       // 60 degrees horizontal field of view; the horizon is on row 9

/* ───────────────────────────── random numbers ───────────────────────────── */
SV.rng = function (seed) {
  var a = (seed >>> 0) || 1;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    var t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};
SV.randn = function (rng) { var u = 0; while (u === 0) u = rng(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * PI * rng()); };
SV.uni = function (rng, lo, hi) { return lo + (hi - lo) * rng(); };
SV.poisson = function (rng, lam) { var L = Math.exp(-lam), k = 0, p = 1; do { k++; p *= rng(); } while (p > L); return k - 1; };
/* a child stream: independent seeds for the independent stages of one sample */
SV.stream = function (seed, name) {
  var h = 2166136261 >>> 0, s = String(seed) + ':' + name;
  for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return SV.rng(h);
};

/* ───────────────────────────── colour helpers ───────────────────────────── */
function hsv(h, s, v) {
  h = h - Math.floor(h);
  var i = Math.floor(h * 6), f = h * 6 - i, p = v * (1 - s), q = v * (1 - f * s), t = v * (1 - (1 - f) * s);
  switch (i % 6) { case 0: return [v, t, p]; case 1: return [q, v, p]; case 2: return [p, v, t]; case 3: return [p, q, v]; case 4: return [t, p, v]; default: return [v, p, q]; }
}
SV.hsv = hsv;
function gray(v) { return [v, v, v]; }

/* ───────────────────────────── geometry: vertical extrusions of circles and boxes ───────────────────────────── */
/* part: {id (instance), pid (unique), cls, role, kind:'circle'|'box', x, z, r | hx, hz, y0, y1}.  An instance may have several parts (a pedestrian: legs,
 * torso, head).  A horizontal ray from the camera along the unit direction (dx, dz) enters a part's footprint at PATH.tin and leaves it at PATH.tout. */
var PATH = { tin: 0, tout: 0, nx: 0, nz: 0 };
function pathCircle(dx, dz, cx, cz, r) {
  var b = -(cx * dx + cz * dz), c = cx * cx + cz * cz - r * r, disc = b * b - c;
  if (disc <= 0) return false;
  var s = Math.sqrt(disc), t1 = -b - s, t2 = -b + s;
  if (t2 <= 1e-6 || t1 <= 1e-6) return false;              // the camera is never inside a footprint
  PATH.tin = t1; PATH.tout = t2; PATH.nx = (dx * t1 - cx) / r; PATH.nz = (dz * t1 - cz) / r;
  return true;
}
function pathBox(dx, dz, cx, cz, hx, hz) {
  var tmin = -Infinity, tmax = Infinity, nx = 0, nz = 0, t1, t2, q;
  if (Math.abs(dx) < 1e-12) { if (-cx < -hx || -cx > hx) return false; }
  else {
    t1 = (cx - hx) / dx; t2 = (cx + hx) / dx; var sx = -1; if (t1 > t2) { q = t1; t1 = t2; t2 = q; sx = 1; }
    if (t1 > tmin) { tmin = t1; nx = sx; nz = 0; } if (t2 < tmax) tmax = t2;
  }
  if (Math.abs(dz) < 1e-12) { if (-cz < -hz || -cz > hz) return false; }
  else {
    t1 = (cz - hz) / dz; t2 = (cz + hz) / dz; var sz = -1; if (t1 > t2) { q = t1; t1 = t2; t2 = q; sz = 1; }
    if (t1 > tmin) { tmin = t1; nx = 0; nz = sz; } if (t2 < tmax) tmax = t2;
  }
  if (tmin > tmax || tmax <= 1e-6 || tmin <= 1e-6) return false;
  PATH.tin = tmin; PATH.tout = tmax; PATH.nx = nx; PATH.nz = nz;
  return true;
}

/* ───────────────────────────── the stage configurations ───────────────────────────── */
SV.SIM0 = {
  name: 'sim0',
  scene: { pPed: 0.5, pEmerge: 0, z: [8, 16], r: [0.23, 0.27], h: [1.7, 1.8], pVan: 1, van: { x: [2.7, 2.9], z: [8, 12], hx: [0.95, 1.0], hz: [2.2, 2.4], h: [2.1, 2.2] },
           clutter: 0.5, pRed: 0, pTree: 0.4, wallZ: 50 },
  look: { sunEl: [55, 55], sunAz: [0, 0], amb: [0.45, 0.45], lum: [1, 1], pedPalette: 'bright', vanPalette: 'white', sky: 'blue', ground: [0.3, 0.3], windows: 0, stripe: [0.2, 0.2] },
  sensor: { ideal: true, ev: 600, fw: 4000, read: 0, blur: 0, gamma: 2.2, bits: 8 },
  label: { kvis: 1 }
};
SV.REAL = {
  name: 'real',
  scene: { pPed: 0.5, pEmerge: 0.35, z: [8, 24], r: [0.2, 0.28], h: [1.5, 1.9], pVan: 0.8, van: { x: [2.3, 3.3], z: [5, 18], hx: [0.85, 1.1], hz: [1.8, 3.6], h: [1.9, 2.6] },
           clutter: 1.0, pRed: 0.1, pTree: 0.4, wallZ: 50 },
  look: { sunEl: [12, 65], sunAz: [-150, 150], amb: [0.2, 0.5], lum: [0.12, 1], pedPalette: 'wide', vanPalette: 'mixed', sky: 'varied', ground: [0.15, 0.45], windows: 0.3, stripe: [0.05, 0.35] },
  sensor: { ideal: false, ev: 600, fw: 4000, read: 3, blur: 0.7, gamma: 2.2, bits: 8, ae: { target: 0.12, maxGain: 8 } },
  label: { kvis: 1, rel: 0.15 }
};
SV.clone = function (o) { return JSON.parse(JSON.stringify(o)); };
/* a hybrid pipeline: take each stage from `a` or from `b`.  pick = {scene:'a'|'b', look:..., sensor:..., label:...} */
SV.hybrid = function (a, b, pick) {
  var out = { name: 'hybrid' };
  ['scene', 'look', 'sensor', 'label'].forEach(function (k) { out[k] = SV.clone((pick[k] === 'b' ? b : a)[k]); });
  return out;
};

/* ───────────────────────────── drawing a scene ───────────────────────────── */
/* want: optional {ped: true|false, mode: 'open'|'emerge', vis: visible width in px} forces a composition (used for test slices and for oversampling) */
SV.drawScene = function (cfg, rng, want) {
  want = want || {};
  var C = SV.CAM, parts = [], insts = [], id = 0, i;
  function inst(cls, pp) { var o = { id: id++, cls: cls, parts: [] }; pp.forEach(function (p) { p.id = o.id; p.pid = parts.length; p.cls = cls; o.parts.push(p); parts.push(p); }); insts.push(o); return o; }
  inst('wall', [{ kind: 'box', x: 0, z: cfg.wallZ + 0.5, hx: 90, hz: 0.5, y0: 0, y1: 6 }]);
  var van = null;
  if (cfg.pVan >= 1 || rng() < cfg.pVan || want.mode === 'emerge') {
    var vc = cfg.van;
    van = inst('van', [{ kind: 'box', x: SV.uni(rng, vc.x[0], vc.x[1]), z: SV.uni(rng, vc.z[0], vc.z[1]), hx: SV.uni(rng, vc.hx[0], vc.hx[1]), hz: SV.uni(rng, vc.hz[0], vc.hz[1]), y0: 0, y1: SV.uni(rng, vc.h[0], vc.h[1]) }]);
  }
  var n = cfg.clutter ? SV.poisson(rng, cfg.clutter) : 0;
  for (i = 0; i < n; i++) {
    var tree = rng() < (cfg.pTree === undefined ? 0.4 : cfg.pTree), side = rng() < 0.6 ? 1 : -1, x = side * SV.uni(rng, 3.3, 6), z = SV.uni(rng, 5, 40);
    if (van) { var vp = van.parts[0]; if (Math.abs(x - vp.x) < vp.hx + 0.6 && Math.abs(z - vp.z) < vp.hz + 0.6) x = side * SV.uni(rng, 4.4, 6.2); }
    if (tree) {
      var tr = SV.uni(rng, 0.08, 0.14), cr = SV.uni(rng, 0.7, 1.2);
      inst('tree', [{ kind: 'circle', x: x, z: z, r: tr, y0: 0, y1: 2.3 }, { kind: 'circle', x: x, z: z, r: cr, y0: 2.3, y1: 4.8 }]);
    } else {
      var o = inst('pole', [{ kind: 'circle', x: x, z: z, r: SV.uni(rng, 0.06, 0.13), y0: 0, y1: SV.uni(rng, 3.5, 6) }]); o.red = rng() < cfg.pRed;
    }
  }
  var present = want.ped !== undefined ? want.ped : rng() < cfg.pPed;
  var ped = null, mode = null;
  if (present) {
    mode = want.mode || (van && rng() < cfg.pEmerge ? 'emerge' : 'open');
    if (mode === 'emerge' && !van) mode = 'open';
    var r = SV.uni(rng, cfg.r[0], cfg.r[1]), H = SV.uni(rng, cfg.h[0], cfg.h[1]), zp, xp;
    if (mode === 'emerge') {
      var vq = van.parts[0], xe = vq.x - vq.hx, ze = vq.z + vq.hz;      // the van's road-side far corner: the edge of its shadow
      zp = ze + SV.uni(rng, 0.8, 9);
      var ue = C.f * xe / ze, wpx = 2 * C.f * r / zp;                    // shadow edge (pixels right of the axis) and the pedestrian's full width
      var v = want.vis !== undefined ? want.vis : SV.uni(rng, 0, 1) * wpx;
      v = Math.min(v, wpx);
      xp = (ue - v) * zp / C.f + r;                                      // the pedestrian's left boundary sits v pixels left of the shadow edge
    } else {
      zp = SV.uni(rng, cfg.z[0], cfg.z[1]);
      xp = SV.uni(rng, -2.6, 1.0);
    }
    ped = inst('ped', [{ role: 'legs', kind: 'circle', x: xp, z: zp, r: r * 0.85, y0: 0, y1: H * 0.5 }, { role: 'torso', kind: 'circle', x: xp, z: zp, r: r, y0: H * 0.5, y1: H * 0.86 }, { role: 'head', kind: 'circle', x: xp, z: zp, r: r * 0.5, y0: H * 0.86, y1: H }]);
  }
  return { insts: insts, parts: parts, ped: ped, van: van, mode: mode };
};

/* ───────────────────────────── drawing a look ───────────────────────────── */
SV.drawLook = function (cfg, scene, rng) {
  var L = { amb: SV.uni(rng, cfg.amb[0], cfg.amb[1]), lum: SV.uni(rng, cfg.lum[0], cfg.lum[1]), col: {}, stripe: {}, ph: {} };
  var el = SV.uni(rng, cfg.sunEl[0], cfg.sunEl[1]) * PI / 180, az = SV.uni(rng, cfg.sunAz[0], cfg.sunAz[1]) * PI / 180;
  L.l = [Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el)];      // direction TOWARDS the sun; az = 0 puts it behind the camera
  var drawn = {};
  scene.parts.forEach(function (p) {
    var c, o = scene.insts[p.id], d = drawn[p.id];
    if (!d) {
      d = drawn[p.id] = {};
      switch (o.cls) {
        case 'ped':
          if (cfg.pedPalette === 'bright') {
            d.shirt = hsv(SV.uni(rng, 0.0, 0.13), SV.uni(rng, 0.55, 0.9), SV.uni(rng, 0.7, 0.95));
            d.legs = hsv(0.6, SV.uni(rng, 0.4, 0.6), SV.uni(rng, 0.2, 0.35));
          } else {
            d.shirt = hsv(rng(), SV.uni(rng, 0.1, 0.9), SV.uni(rng, 0.12, 0.92));
            d.legs = rng() < 0.6 ? hsv(SV.uni(rng, 0.55, 0.65), SV.uni(rng, 0.3, 0.6), SV.uni(rng, 0.15, 0.45)) : gray(SV.uni(rng, 0.06, 0.6));
          }
          d.skin = hsv(0.07, SV.uni(rng, 0.25, 0.5), SV.uni(rng, 0.4, 0.85));
          break;
        case 'van': d.body = cfg.vanPalette === 'white' ? gray(0.8) : (rng() < 0.6 ? gray(SV.uni(rng, 0.15, 0.9)) : hsv(rng(), SV.uni(rng, 0.2, 0.7), SV.uni(rng, 0.3, 0.8))); break;
        case 'pole': d.body = o.red ? hsv(SV.uni(rng, 0, 0.1), 0.8, 0.85) : gray(SV.uni(rng, 0.12, 0.5)); break;
        case 'tree': d.trunk = hsv(SV.uni(rng, 0.05, 0.1), 0.5, SV.uni(rng, 0.15, 0.35)); d.crown = hsv(SV.uni(rng, 0.2, 0.33), SV.uni(rng, 0.3, 0.7), SV.uni(rng, 0.2, 0.5)); break;
        default: d.body = gray(SV.uni(rng, 0.4, 0.65));
      }
      d.ph = rng() * 2 * PI; d.stripe = o.cls === 'ped' ? SV.uni(rng, cfg.stripe[0], cfg.stripe[1]) : 0;
    }
    switch (o.cls) {
      case 'ped': c = p.role === 'head' ? d.skin : p.role === 'torso' ? d.shirt : d.legs; break;
      case 'tree': c = p.y0 >= 2.3 ? d.crown : d.trunk; break;
      default: c = d.body;
    }
    L.col[p.pid] = c; L.stripe[p.pid] = (o.cls === 'ped' && p.role === 'torso') ? d.stripe : 0; L.ph[p.pid] = d.ph;
  });
  L.ground = SV.uni(rng, cfg.ground[0], cfg.ground[1]);
  var sk = cfg.sky === 'blue' ? 0 : Math.floor(rng() * 3);                    // 0 blue, 1 grey, 2 warm
  L.skyH = sk === 0 ? [0.62, 0.75, 0.95] : sk === 1 ? [0.6, 0.62, 0.65] : [0.95, 0.65, 0.4];
  L.skyZ = sk === 0 ? [0.25, 0.45, 0.9] : sk === 1 ? [0.5, 0.52, 0.56] : [0.45, 0.4, 0.6];
  L.win = cfg.windows; L.winPhase = rng() * 6.28;
  return L;
};

/* ───────────────────────────── the renderer ───────────────────────────── */
/* render(scene, look, o) -> {rad: Float32Array(3*H*W) [r-plane, g-plane, b-plane], cov: pedestrian coverage (H*W, 0..1), depth (z), range, id (instance, -1 = ground
 * or sky)}.  o: {SSh, SSv, only: 'ped', maps: false}.  Colour and coverage average SSh x SSv rays per pixel (a pixel integrates over its area); depth, range and
 * id come from one extra ray through the pixel's centre.  Radiance = albedo * lum * (amb + (1 - amb) * max(0, n.l)) * texture. */
SV.render = function (scene, look, o) {
  o = o || {};
  var C = SV.CAM, W = C.W, H = C.H, f = C.f, V0 = C.V0, hc = C.hc, SSh = o.SSh || 2, SSv = o.SSv || 2, parts = scene.parts, np = parts.length, wantMaps = o.maps !== false;
  if (o.only) { parts = parts.filter(function (q) { return q.cls === o.only; }); np = parts.length; }
  var HW = H * W, rad = new Float32Array(3 * HW), cov = new Float32Array(HW), depth = new Float32Array(HW), rng_ = new Float32Array(HW), idm = new Int16Array(HW).fill(-1);
  var l = look.l, amb = look.amb, lum = look.lum, i, j, a, b, k, inv_n = 1 / (SSh * SSv);
  var tin = new Float64Array(np), tout = new Float64Array(np), nxs = new Float64Array(np), nzs = new Float64Array(np), ok = new Uint8Array(np);
  var accR = new Float64Array(H), accG = new Float64Array(H), accB = new Float64Array(H), accC = new Float64Array(H);
  for (i = 0; i < W; i++) {
    accR.fill(0); accG.fill(0); accB.fill(0); accC.fill(0);
    for (a = 0; a <= (wantMaps ? SSh : SSh - 1); a++) {
      var cen = a === SSh,                                                   // the extra pass: one ray per pixel, through its centre
          tp = (i + (cen ? 0.5 : (a + 0.5) / SSh) - W / 2) / f, cph = 1 / Math.sqrt(1 + tp * tp), dx = tp * cph, dz = cph;
      for (k = 0; k < np; k++) {
        var p = parts[k], hit = p.kind === 'circle' ? pathCircle(dx, dz, p.x, p.z, p.r) : pathBox(dx, dz, p.x, p.z, p.hx, p.hz);
        ok[k] = hit ? 1 : 0;
        if (hit) { tin[k] = PATH.tin; tout[k] = PATH.tout; nxs[k] = PATH.nx; nzs[k] = PATH.nz; }
      }
      for (j = 0; j < H; j++) {
        for (b = cen ? SSv : 0; b < (cen ? SSv + 1 : SSv); b++) {
          var rho = (V0 - (j + (cen ? 0.5 : (b + 0.5) / SSv))) / f, s = rho * cph;       // dh/dt along the horizontal ray
          var best = Infinity, bk = -1, bnx = 0, bny = 0, bnz = 0;
          if (s < 0) { best = -hc / s; bk = -2; bny = 1; }                  // the ground
          for (k = 0; k < np; k++) {
            if (!ok[k]) continue;
            var pk = parts[k], h1 = hc + s * tin[k];
            if (tin[k] < best && h1 >= pk.y0 && h1 <= pk.y1) { best = tin[k]; bk = k; bnx = nxs[k]; bny = 0; bnz = nzs[k]; }
            else if (s > 0 && h1 < pk.y0) { var tu = (pk.y0 - hc) / s; if (tu <= tout[k] && tu < best) { best = tu; bk = k; bnx = 0; bny = -1; bnz = 0; } }
            else if (s < 0 && h1 > pk.y1) { var tt = (pk.y1 - hc) / s; if (tt <= tout[k] && tt < best) { best = tt; bk = k; bnx = 0; bny = 1; bnz = 0; } }
          }
          if (cen) {
            var q = j * W + i;
            if (bk === -1) { depth[q] = 0; rng_[q] = 0; idm[q] = -1; }
            else { depth[q] = best * cph; rng_[q] = best * Math.sqrt(1 + s * s); idm[q] = bk >= 0 ? parts[bk].id : -1; }
            continue;
          }
          var R, G, B;
          if (bk === -1) {                                                    // sky
            var el = Math.min(1, Math.max(0, rho * 6));
            R = (look.skyH[0] * (1 - el) + look.skyZ[0] * el) * lum; G = (look.skyH[1] * (1 - el) + look.skyZ[1] * el) * lum; B = (look.skyH[2] * (1 - el) + look.skyZ[2] * el) * lum;
          } else {
            var alb, m = 1, hh = hc + s * best, cls;
            if (bk === -2) { alb = gray(look.ground); cls = 'ground'; }
            else {
              var pp = parts[bk]; cls = pp.cls; alb = look.col[pp.pid];
              if (look.stripe[pp.pid]) m = 1 + look.stripe[pp.pid] * Math.sin(3 * Math.atan2(bnz, bnx) + look.ph[pp.pid] + 6 * hh);
              else if (cls === 'wall' && look.win) { var gx = Math.floor(dx * best / 1.6 + look.winPhase), gy = Math.floor(hh / 1.8); m = ((gx * 7 + gy * 13) & 3) === 0 ? 1 - look.win : 1; }
            }
            var nd = bk === -2 ? l[1] : (bnx * l[0] + bny * l[1] + bnz * l[2]);
            var I = lum * (amb + (1 - amb) * Math.max(0, nd)) * m;
            R = alb[0] * I; G = alb[1] * I; B = alb[2] * I;
          }
          accR[j] += R; accG[j] += G; accB[j] += B;
          if (bk >= 0 && parts[bk].cls === 'ped') accC[j] += 1;
        }
      }
    }
    for (j = 0; j < H; j++) { var q2 = j * W + i; rad[q2] = accR[j] * inv_n; rad[HW + q2] = accG[j] * inv_n; rad[2 * HW + q2] = accB[j] * inv_n; cov[q2] = accC[j] * inv_n; }
  }
  return { rad: rad, cov: cov, depth: depth, range: rng_, id: idm };
};

/* ───────────────────────────── the sensor ───────────────────────────── */
/* radiance -> PSF blur -> electrons (gain ev) -> shot noise (var = e) + read noise -> analog gain (auto-exposure) -> clip at full well -> gamma -> quantise.
 * ideal: skip noise and blur.  ae: {target, maxGain}: a gain that brings the mean linear level to `target`, up to maxGain. */
SV.sense = function (rad, cfg, rng) {
  var C = SV.CAM, W = C.W, H = C.H, HW = H * W, out = new Float32Array(3 * HW), c, i, j, u, v;
  var blur = cfg.blur, kern = null, kh = 0;
  if (!cfg.ideal && blur > 0) {
    kh = Math.ceil(2.5 * blur); kern = new Float32Array(2 * kh + 1); var s = 0;
    for (u = -kh; u <= kh; u++) { kern[u + kh] = Math.exp(-u * u / (2 * blur * blur)); s += kern[u + kh]; }
    for (u = 0; u < kern.length; u++) kern[u] /= s;
  }
  var tmp = new Float32Array(HW), tmp2 = new Float32Array(HW), levels = (1 << cfg.bits) - 1, ig = 1 / cfg.gamma, gain = 1;
  if (cfg.ae) {
    var ml = 0; for (i = 0; i < 3 * HW; i++) ml += rad[i];
    ml = cfg.ev * ml / (3 * HW) / cfg.fw;
    gain = Math.min(cfg.ae.maxGain, Math.max(1, cfg.ae.target / Math.max(ml, 1e-9)));
  }
  for (c = 0; c < 3; c++) {
    var pl = rad.subarray(c * HW, (c + 1) * HW), src = pl;
    if (kern) {                                                           // separable Gaussian PSF
      for (j = 0; j < H; j++) for (i = 0; i < W; i++) { var t = 0; for (u = -kh; u <= kh; u++) t += kern[u + kh] * pl[j * W + Math.min(W - 1, Math.max(0, i + u))]; tmp[j * W + i] = t; }
      for (j = 0; j < H; j++) for (i = 0; i < W; i++) { var t2 = 0; for (v = -kh; v <= kh; v++) t2 += kern[v + kh] * tmp[Math.min(H - 1, Math.max(0, j + v)) * W + i]; tmp2[j * W + i] = t2; }
      src = tmp2;
    }
    for (i = 0; i < HW; i++) {
      var e = cfg.ev * src[i];
      if (!cfg.ideal) e = e + Math.sqrt(Math.max(e, 0)) * SV.randn(rng) + cfg.read * SV.randn(rng);
      var q = Math.min(1, Math.max(0, gain * e / cfg.fw));
      out[c * HW + i] = Math.round(Math.pow(q, ig) * levels) / levels;
    }
  }
  return out;
};

/* ───────────────────────────── labels ───────────────────────────── */
/* present = the visible area (pixels of coverage) reaches the convention's threshold: kvis pixels, or rel x the pedestrian's full (amodal) silhouette */
SV.labels = function (cov, cfg, scene, look) {
  var a = 0, i, need = cfg.kvis || 0, full = 0;
  for (i = 0; i < cov.length; i++) a += cov[i];
  if (scene && scene.ped) {
    var am = SV.render(scene, look, { only: 'ped', maps: false }).cov;
    for (i = 0; i < am.length; i++) full += am[i];
    if (cfg.rel) need = Math.max(need, cfg.rel * full);
  }
  return { area: a, full: full, present: a >= need && a > 0 ? 1 : 0 };
};

/* ───────────────────────────── one sample ───────────────────────────── */
/* seed: a number; the three random streams (scene, look, sensor) are derived from it, so a sample can be re-rendered with another look or sensor */
SV.sample = function (pipe, seed, want) {
  var rs = SV.stream(seed, 'scene'), rl = SV.stream(seed, 'look'), rn = SV.stream(seed, 'sensor');
  var scene = SV.drawScene(pipe.scene, rs, want), look = SV.drawLook(pipe.look, scene, rl);
  var ren = SV.render(scene, look), x = SV.sense(ren.rad, pipe.sensor, rn), lab = SV.labels(ren.cov, pipe.label, scene, look);
  return { x: x, cov: ren.cov, depth: ren.depth, range: ren.range, id: ren.id, y: lab.present, area: lab.area, full: lab.full, scene: scene, look: look, mode: scene.mode, seed: seed };
};
SV.makeSet = function (pipe, n, seed0, want) {
  var out = new Array(n);
  for (var i = 0; i < n; i++) out[i] = SV.sample(pipe, seed0 + i, want ? (typeof want === 'function' ? want(i) : want) : undefined);
  return out;
};

/* ───────────────────────────── the detector: a fixed bank of oriented filters and a logistic head ───────────────────────────── */
/* The detector is deliberately classical, and small enough to train in seconds.  A FIXED bank of vertical bar filters (second derivative of a Gaussian
 * across, a box along) and step-edge filters (first derivative across), at three widths and three heights, applied to luminance and two colour-difference
 * channels, gives every cell of a stride-2 grid a vector of 2 x 54 + 2 features (both polarities after a ReLU, plus the cell's row).  The head is a
 * logistic regression on those features, trained on per-cell labels (the exact mask the renderer provides) with one round of hard-negative mining.
 * An image's score is the largest cell logit.  Nothing about the detector changes between experiments, so whatever changes in a result came from the data. */
var SIG = [0.8, 1.8, 2.7], LEN = [3, 11, 15];
function gk(sig, order) {
  var half = Math.ceil(3 * sig), k = new Float64Array(2 * half + 1), i, t = 0, m = 0;
  for (i = -half; i <= half; i++) { var g = Math.exp(-i * i / (2 * sig * sig)); k[i + half] = order === 2 ? (i * i / (sig * sig * sig * sig) - 1 / (sig * sig)) * g : -i / (sig * sig) * g; }
  if (order === 2) { for (i = 0; i < k.length; i++) m += k[i]; m /= k.length; for (i = 0; i < k.length; i++) k[i] -= m; }
  for (i = 0; i < k.length; i++) t += Math.abs(k[i]);
  for (i = 0; i < k.length; i++) k[i] /= t;
  return { k: k, h: half };
}
var HBAR = SIG.map(function (s) { return gk(s, 2); }), HSTEP = SIG.map(function (s) { return gk(s, 1); });
SV.SIG = SIG; SV.LEN = LEN;
SV.NFILT = 3 * SIG.length * LEN.length * 2;             // channels x widths x heights x (bar, step)
SV.DIM = 2 * SV.NFILT + 2;
SV.STEP = 2;
var _ch = [new Float32Array(SV.CAM.W * SV.CAM.H), new Float32Array(SV.CAM.W * SV.CAM.H), new Float32Array(SV.CAM.W * SV.CAM.H)];
var _hb = [], _hs = [];
(function () { for (var c = 0; c < 3; c++) { _hb.push(SIG.map(function () { return new Float32Array(SV.CAM.W * SV.CAM.H); })); _hs.push(SIG.map(function () { return new Float32Array(SV.CAM.W * SV.CAM.H); })); } })();
function hconv(src, kk, out) {
  var W = SV.CAM.W, H = SV.CAM.H, k = kk.k, h = kk.h, i, j, q;
  for (j = 0; j < H; j++) for (i = 0; i < W; i++) {
    var t = 0, b = j * W;
    if (i >= h && i < W - h) { for (q = -h; q <= h; q++) t += k[q + h] * src[b + i + q]; }
    else for (q = -h; q <= h; q++) t += k[q + h] * src[b + Math.min(W - 1, Math.max(0, i + q))];
    out[b + i] = t;
  }
}
/* features on the stride-STEP grid: {F, nu, nv}, F[(jv * nu + iu) * DIM + ...] */
SV.featureMap = function (x) {
  var C = SV.CAM, W = C.W, H = C.H, HW = W * H, st = SV.STEP, nu = Math.ceil(W / st), nv = Math.ceil(H / st), dim = SV.DIM, F = new Float32Array(nu * nv * dim), i, c, si, li, jv, iu;
  for (i = 0; i < HW; i++) { var r = x[i], g = x[HW + i], b = x[2 * HW + i]; _ch[0][i] = (r + g + b) / 3; _ch[1][i] = r - g; _ch[2][i] = b - (r + g) / 2; }
  for (c = 0; c < 3; c++) for (si = 0; si < SIG.length; si++) { hconv(_ch[c], HBAR[si], _hb[c][si]); hconv(_ch[c], HSTEP[si], _hs[c][si]); }
  for (jv = 0; jv < nv; jv++) for (iu = 0; iu < nu; iu++) {
    var u = Math.min(W - 1, iu * st + 1), v = Math.min(H - 1, jv * st + 1), o = (jv * nu + iu) * dim, f = 0;
    for (c = 0; c < 3; c++) for (si = 0; si < SIG.length; si++) for (li = 0; li < LEN.length; li++) {
      var L = LEN[li], a0 = v - ((L - 1) >> 1), zb = 0, zs = 0, hb = _hb[c][si], hs = _hs[c][si];
      for (var q = 0; q < L; q++) { var rr = Math.min(H - 1, Math.max(0, a0 + q)) * W + u; zb += hb[rr]; zs += hs[rr]; }
      zb /= L; zs /= L;
      F[o + 2 * f] = zb > 0 ? zb : 0; F[o + 2 * f + 1] = zb < 0 ? -zb : 0; f++;
      F[o + 2 * f] = zs > 0 ? zs : 0; F[o + 2 * f + 1] = zs < 0 ? -zs : 0; f++;
    }
    F[o + 2 * SV.NFILT] = v / H; F[o + 2 * SV.NFILT + 1] = (v / H) * (v / H);
  }
  return { F: F, nu: nu, nv: nv };
};

/* the cells of one image: `near` = within 2 cells of the pedestrian (never sampled as plain negatives), `lab` = 1 on the pedestrian (the cell's pixel has
 * coverage >= 0.5) provided the image counts as containing a pedestrian under its label convention */
function cellInfo(s) {
  var C = SV.CAM, W = C.W, H = C.H, st = SV.STEP, nu = Math.ceil(W / st), nv = Math.ceil(H / st), near = new Uint8Array(nu * nv), lab = new Uint8Array(nu * nv), iu, jv, d, e;
  for (jv = 0; jv < nv; jv++) for (iu = 0; iu < nu; iu++) {
    var u = Math.min(W - 1, iu * st + 1), v = Math.min(H - 1, jv * st + 1), c = Math.max(s.cov[v * W + u], s.cov[Math.max(0, v - 1) * W + u]);
    lab[jv * nu + iu] = (c >= 0.5 && s.y) ? 1 : 0;
    if (c > 0.05) for (d = -2; d <= 2; d++) for (e = -2; e <= 2; e++) { var a = iu + d, b = jv + e; if (a >= 0 && a < nu && b >= 0 && b < nv) near[b * nu + a] = 1; }
  }
  return { nu: nu, nv: nv, near: near, lab: lab };
}
function pack(fm, cells, lab, wt) {
  var dim = SV.DIM, F = new Float32Array(cells.length * dim), Y = new Uint8Array(cells.length);
  for (var i = 0; i < cells.length; i++) { var ci = cells[i]; for (var j = 0; j < dim; j++) F[i * dim + j] = fm.F[ci * dim + j]; Y[i] = lab[ci]; }
  return { F: F, Y: Y, n: cells.length, wt: wt === undefined ? 1 : wt };
}
function cellLogit(m, F, c) { var dim = m.dim, z = m.w[dim]; for (var j = 0; j < dim; j++) z += m.w[j] * (F[c * dim + j] - m.mu[j]) / m.sd[j]; return z; }

/* weighted logistic regression by Newton steps with L2 on standardised features; parts[i].wt weights every sample of part i.  returns {w, mu, sd, dim, n} */
SV.fitHead = function (parts, dim, o) {
  o = o || {};
  var lam = o.lam === undefined ? 1.0 : o.lam, iters = o.iters || 6, n = 0, i, j, k;
  parts.forEach(function (p) { n += p.n; });
  var X = new Float32Array(n * dim), Y = new Uint8Array(n), Wt = new Float32Array(n), r = 0, wsum = 0;
  parts.forEach(function (p) { X.set(p.F, r * dim); Y.set(p.Y, r); for (var q = 0; q < p.n; q++) { Wt[r + q] = p.wt === undefined ? 1 : p.wt; wsum += Wt[r + q]; } r += p.n; });
  var mu = new Float64Array(dim), sd = new Float64Array(dim);
  for (i = 0; i < n; i++) for (j = 0; j < dim; j++) mu[j] += Wt[i] * X[i * dim + j];
  for (j = 0; j < dim; j++) mu[j] /= wsum;
  for (i = 0; i < n; i++) for (j = 0; j < dim; j++) { var d = X[i * dim + j] - mu[j]; sd[j] += Wt[i] * d * d; }
  for (j = 0; j < dim; j++) sd[j] = Math.sqrt(sd[j] / wsum) + 1e-6;
  for (i = 0; i < n; i++) for (j = 0; j < dim; j++) X[i * dim + j] = (X[i * dim + j] - mu[j]) / sd[j];
  var D = dim + 1, w = new Float64Array(D), p = new Float64Array(n), H = new Float64Array(D * D), g = new Float64Array(D), scale = n / wsum;
  for (var it = 0; it < iters; it++) {
    for (i = 0; i < n; i++) { var z = w[dim]; for (j = 0; j < dim; j++) z += w[j] * X[i * dim + j]; p[i] = 1 / (1 + Math.exp(-z)); }
    H.fill(0); g.fill(0);
    for (i = 0; i < n; i++) {
      var wt = Wt[i] * scale, wi = (p[i] * (1 - p[i]) + 1e-6) * wt, ei = (p[i] - Y[i]) * wt, row = i * dim;
      for (j = 0; j < dim; j++) {
        var xj = X[row + j]; g[j] += ei * xj;
        var hj = wi * xj, Hrow = j * D;
        for (k = j; k < dim; k++) H[Hrow + k] += hj * X[row + k];
        H[Hrow + dim] += hj;
      }
      g[dim] += ei; H[dim * D + dim] += wi;
    }
    for (j = 0; j < dim; j++) { g[j] += lam * w[j]; H[j * D + j] += lam; }
    for (j = 0; j < D; j++) for (k = 0; k < j; k++) H[j * D + k] = H[k * D + j];
    var step = SV.solve(H, g, D);
    if (!step) break;
    var maxs = 0;
    for (j = 0; j < D; j++) { w[j] -= step[j]; maxs = Math.max(maxs, Math.abs(step[j])); }
    if (maxs < 1e-4) break;
  }
  return { w: w, dim: dim, mu: mu, sd: sd, n: n };
};
SV.solve = function (A0, b0, n) {
  var A = Float64Array.from(A0), b = Float64Array.from(b0), i, j, k;
  for (i = 0; i < n; i++) {
    var piv = i, best = Math.abs(A[i * n + i]);
    for (k = i + 1; k < n; k++) if (Math.abs(A[k * n + i]) > best) { best = Math.abs(A[k * n + i]); piv = k; }
    if (best < 1e-12) return null;
    if (piv !== i) { for (j = 0; j < n; j++) { var t = A[i * n + j]; A[i * n + j] = A[piv * n + j]; A[piv * n + j] = t; } var tb = b[i]; b[i] = b[piv]; b[piv] = tb; }
    for (k = i + 1; k < n; k++) {
      var f = A[k * n + i] / A[i * n + i];
      if (f !== 0) { for (j = i; j < n; j++) A[k * n + j] -= f * A[i * n + j]; b[k] -= f * b[i]; }
    }
  }
  var x = new Float64Array(n);
  for (i = n - 1; i >= 0; i--) { var s = b[i]; for (j = i + 1; j < n; j++) s -= A[i * n + j] * x[j]; x[i] = s / A[i * n + i]; }
  return x;
};

/* the per-cell logit map (nv x nu) and the image score (largest logit) */
SV.logits = function (model, x) {
  var fm = SV.featureMap(x), n = fm.nu * fm.nv, out = new Float32Array(n);
  for (var c = 0; c < n; c++) out[c] = cellLogit(model, fm.F, c);
  return { z: out, nu: fm.nu, nv: fm.nv };
};
SV.score = function (model, x) {
  var fm = SV.featureMap(x), n = fm.nu * fm.nv, m = -Infinity, am = 0;
  for (var c = 0; c < n; c++) { var z = cellLogit(model, fm.F, c); if (z > m) { m = z; am = c; } }
  return { s: m, cell: am, nu: fm.nu };
};
SV.scoreSet = function (model, strips) { return strips.map(function (s) { return SV.score(model, s.x).s; }); };

/* train(strips, {nneg: random negative cells per image, mine: rounds of hard-negative mining, K: false-positive cells added per image and round, lam, weights: per-image weights}) */
SV.train = function (strips, o) {
  o = o || {};
  var rng = SV.rng(o.seed || 5), nneg = o.nneg === undefined ? 16 : o.nneg, rounds = o.mine === undefined ? 1 : o.mine, K = o.K || 6, dim = SV.DIM, keep = strips.length * 288 * dim <= 7e7;
  var maps = [], cis = [];
  var parts = strips.map(function (s, si) {
    var fm = SV.featureMap(s.x), ci = cellInfo(s), cells = [], c;
    for (c = 0; c < ci.nu * ci.nv; c++) if (ci.near[c]) cells.push(c);
    for (var k = 0; k < nneg; k++) { var c2 = Math.floor(rng() * ci.nu * ci.nv); if (!ci.near[c2]) { ci.near[c2] = 1; cells.push(c2); } }
    if (keep) { maps.push(fm); cis.push(ci); }
    return pack(fm, cells, ci.lab, o.weights ? o.weights[si] : 1);
  });
  var m = SV.fitHead(parts, dim, o);
  for (var r = 0; r < rounds; r++) {
    var extra = strips.map(function (s, si) {
      var fm = keep ? maps[si] : SV.featureMap(s.x), ci = cellInfo(s), sc = [], c;
      for (c = 0; c < ci.nu * ci.nv; c++) if (!ci.near[c]) sc.push([cellLogit(m, fm.F, c), c]);
      sc.sort(function (a, b) { return b[0] - a[0]; });
      return pack(fm, sc.slice(0, K).map(function (x) { return x[1]; }), new Uint8Array(ci.nu * ci.nv), o.weights ? o.weights[si] : 1);
    });
    parts = parts.concat(extra);
    m = SV.fitHead(parts, dim, o);
  }
  return m;
};

/* ───────────────────────────── metrics ───────────────────────────── */
SV.auc = function (pos, neg) {
  var all = [], i; for (i = 0; i < pos.length; i++) all.push([pos[i], 1]); for (i = 0; i < neg.length; i++) all.push([neg[i], 0]);
  all.sort(function (a, b) { return a[0] - b[0]; });
  var sumPos = 0, k = 0;
  while (k < all.length) { var j = k; while (j + 1 < all.length && all[j + 1][0] === all[k][0]) j++; var avg = (k + j) / 2 + 1; for (var q = k; q <= j; q++) if (all[q][1]) sumPos += avg; k = j + 1; }
  return (sumPos - pos.length * (pos.length + 1) / 2) / (pos.length * neg.length);
};
/* the threshold at which a fraction alpha of the negatives score above it */
SV.thrAtFPR = function (negScores, alpha) { var s = negScores.slice().sort(function (a, b) { return a - b; }); return s[Math.min(s.length - 1, Math.floor((1 - alpha) * s.length))]; };
SV.rate = function (scores, thr) { var k = 0; for (var i = 0; i < scores.length; i++) if (scores[i] > thr) k++; return k / scores.length; };
/* the exam: the threshold lets 1 pedestrian-free frame in 10 alarm (FA); the miss rate is taken over pedestrians with at least minArea visible pixels */
SV.EXAM = { fa: 0.1, minArea: 6 };
SV.exam = function (set, scores, o) {
  o = o || {}; var fa = o.fa === undefined ? SV.EXAM.fa : o.fa, minA = o.minArea === undefined ? SV.EXAM.minArea : o.minArea, thr = o.thr;
  var pos = [], neg = [], i;
  for (i = 0; i < set.length; i++) { if (set[i].y) pos.push(i); else neg.push(i); }
  var negS = neg.map(function (j) { return scores[j]; });
  if (thr === undefined) thr = SV.thrAtFPR(negS, fa);
  var hit = 0, n = 0, hitF = 0, nF = 0, hitP = 0, nP = 0;
  pos.forEach(function (j) {
    var a = set[j].area;
    if (a >= minA) { n++; if (scores[j] > thr) hit++; }
    if (a >= 15) { nF++; if (scores[j] > thr) hitF++; } else if (a >= 6) { nP++; if (scores[j] > thr) hitP++; }
  });
  return { thr: thr, miss: 1 - hit / n, missFull: 1 - hitF / nF, missPartial: 1 - hitP / nP, n: n, auc: SV.auc(pos.map(function (j) { return scores[j]; }), negS), fa: SV.rate(negS, thr) };
};

/* ───────────────────────────── reality, as a data source ───────────────────────────── */
SV.SEEDS = { train: 1, labeled: 500000, val: 600000, logs: 400000, test: 800000, simVal: 700000, simTest: 900000 };
SV.real = {
  test: function (n, seed0) { return SV.makeSet(SV.REAL, n, seed0 === undefined ? SV.SEEDS.test : seed0); },          // labelled, never trained on
  val: function (n, seed0) { return SV.makeSet(SV.REAL, n, seed0 === undefined ? SV.SEEDS.val : seed0); },            // labelled, for thresholds and choices
  labeled: function (n, seed0) { return SV.makeSet(SV.REAL, n, seed0 === undefined ? SV.SEEDS.labeled : seed0); },    // the small labelled budget
  logs: function (n, seed0) {                                                                                           // unlabelled frames: ordinary driving, pedestrians rare
    var p = SV.clone(SV.REAL); p.scene.pPed = 0.02; return SV.makeSet(p, n, seed0 === undefined ? SV.SEEDS.logs : seed0);
  }
};

root.SV = SV;
if (typeof module !== 'undefined' && module.exports) module.exports = SV;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
