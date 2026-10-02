/* tsdf.js — signed-distance fusion in Flatland (lesson 06, "From points to a surface").  A private engine on top of flatland.js.
 *
 * What it holds, in the order the lesson derives it
 *   TS.world()                     the statue scene, the 24 training cameras (ring of radius 6 m), the 24 held-out cameras interleaved with
 *                                  them, all photographs, the true first hit of every held-out pixel, and ~470 true boundary samples
 *   TS.depthMaps(w, sigmaCm, seed) one depth map per training camera from FL.noisyDepth, stereo model: sigma_Z(6 m) = sigmaCm centimetres
 *                                  (so sigma_Z = sigmaCm * (Z / 6)^2, the law of lesson 2)
 *   TS.cloud(w, dm, n)             the points of the first n depth maps, back-projected, each with the colour of its pixel
 *   TS.fuse(w, dm, mu, o)          the lesson's algorithm: every grid node collects, from every view, one truncated signed distance and one
 *                                  weight; D = sum(w d) / sum(w), W = sum(w); prefix sums are kept for n = 1..24 (nested subsets, order TS.ORDER)
 *   TS.field(Fz, n)               {D, W} on the grid for the first n views
 *   TS.sample / TS.normal         bilinear D and its gradient (NaN where a corner node was never observed)
 *   TS.zeroSet                    marching squares: the polyline pieces where D changes sign
 *   TS.trace                      sphere tracing of one ray through D ("what does this ray hit?")
 *   TS.votesAt / TS.probe         every fused view's vote (d, w) at a point: the single-cell version of the loop in TS.fuse; a point on the true surface
 *   TS.trueDist                   exact distance from a point to the true boundary (fine polyline in a bucket grid); TS.surfaceError scores a zero set with it
 *   TS.exam                       the held-out exam for a point cloud and for a fused surface (ray answers and PSNR)
 *   TS.drawWidget / TS.NS         the lesson's canvas (the map, the error curve, the votes, the exam strips) and the view counts of the curve
 * Conventions: x right, z up, D > 0 outside (in front of the surface), D < 0 inside; units are metres unless a name says cm.
 * Deterministic: seeded generators only.
 */
(function (root) {
'use strict';
var FL = root.FL || (typeof require === 'function' ? require('./flatland.js') : null);
var TS = {};
var PI = Math.PI;

TS.F = 56; TS.W = 64; TS.R = 6; TS.NV = 24;          // photograph cameras: focal length (px), pixels, ring radius (m), number of training views
TS.ZREF = 6;                                          // range at which the noise slider is quoted (m)
TS.FB = 28;                                           // focal length x baseline of the stereo head (px m), i.e. b = 0.5 m
TS.ORDER = [0, 12, 6, 18, 3, 9, 15, 21, 1, 13, 7, 19, 4, 10, 16, 22, 2, 14, 8, 20, 5, 11, 17, 23];   // the first n are spread round the ring
TS.X0 = -3.4; TS.H = 0.05; TS.NG = 137;               // grid nodes at X0 + i*H, i = 0..136
TS.TOL = 0.05;                                        // a ray's answer is right when its first hit is within 5 cm of the true one

var _world = null;
TS.world = function () {
  if (_world) return _world;
  var sc = FL.scenes.statue(), o = { f: TS.F, W: TS.W };
  var train = FL.orbit(TS.NV, TS.R, 0, 0, { f: TS.F, W: TS.W, start: 0.13 });
  var test = FL.orbit(24, TS.R, 0, 0, { f: TS.F, W: TS.W, start: 0.13 + PI / 24 * 0.9 });
  var w = { scene: sc, train: train, test: test, o: o };
  w.rend = train.map(function (c) { return FL.render(sc, c); });
  w.photo = test.map(function (c) { return FL.render(sc, c); });
  w.tTrue = test.map(function (c) {                    // first hit along the unit ray of each held-out pixel (-1 = the ray leaves the scene)
    var t = new Float64Array(c.W);
    for (var i = 0; i < c.W; i++) { var r = FL.pixelRay(c, i + 0.5), h = FL.raycast(sc, r.ox, r.oz, r.dx, r.dz, 20); t[i] = h.hit ? h.t : -1; }
    return t;
  });
  w.bnd = TS.boundarySamples(sc, 0.03);
  _world = w;
  return w;
};

/* points on the true boundary of every shape, equally spaced in arclength (spacing `step` m); id = index of the shape */
TS.boundarySamples = function (sc, step) {
  var xs = [], zs = [], ids = [];
  sc.shapes.forEach(function (sh, id) {
    var P = FL.boundary(sh, 4000), cum = [0], k;
    for (k = 1; k <= P.length; k++) { var a = P[k - 1], b = P[k % P.length]; cum.push(cum[k - 1] + Math.hypot(b.x - a.x, b.z - a.z)); }
    var m = Math.round(cum[P.length] / step), seg = 0;
    for (k = 0; k < m; k++) {
      var s = (k + 0.5) * cum[P.length] / m;
      while (cum[seg + 1] < s) seg++;
      var f = (s - cum[seg]) / (cum[seg + 1] - cum[seg]), p = P[seg], q = P[(seg + 1) % P.length];
      xs.push(p.x + f * (q.x - p.x)); zs.push(p.z + f * (q.z - p.z)); ids.push(id);
    }
  });
  return { x: Float64Array.from(xs), z: Float64Array.from(zs), id: Int8Array.from(ids), n: xs.length };
};

/* distance from (x, z) to the true boundary: the nearest piece of a 4000-segment polyline per shape (about a millimetre a piece), found through a grid of
 * 10 cm buckets searched ring by ring.  TS.lastId = the shape it belongs to. */
var _bidx = null;
function boundaryIndex(sc) {
  if (_bidx && _bidx.sc === sc) return _bidx;
  var BK = 0.1, OFF = 4.5, BN = 90, seg = [], cell = {};
  sc.shapes.forEach(function (sh, id) {
    var P = FL.boundary(sh, 4000), k, a, b, s, i, j, i0, i1, j0, j1, key;
    for (k = 0; k < P.length; k++) {
      a = P[k]; b = P[(k + 1) % P.length]; s = seg.length; seg.push([a.x, a.z, b.x, b.z, id]);
      i0 = Math.floor((Math.min(a.x, b.x) + OFF) / BK); i1 = Math.floor((Math.max(a.x, b.x) + OFF) / BK);
      j0 = Math.floor((Math.min(a.z, b.z) + OFF) / BK); j1 = Math.floor((Math.max(a.z, b.z) + OFF) / BK);
      for (j = j0; j <= j1; j++) for (i = i0; i <= i1; i++) { key = j * BN + i; (cell[key] = cell[key] || []).push(s); }
    }
  });
  return (_bidx = { sc: sc, seg: seg, cell: cell, BK: BK, OFF: OFF, BN: BN });
}
TS.trueDist = function (sc, x, z) {
  var B = boundaryIndex(sc), ci = Math.floor((x + B.OFF) / B.BK), cj = Math.floor((z + B.OFF) / B.BK), best = Infinity, id = -1, r, i, j, L, m, g, dx, dz, t, d;
  for (r = 0; r <= B.BN; r++) {
    for (j = cj - r; j <= cj + r; j++) for (i = ci - r; i <= ci + r; i++) {
      if (Math.max(Math.abs(i - ci), Math.abs(j - cj)) !== r || i < 0 || j < 0 || i >= B.BN || j >= B.BN) continue;
      L = B.cell[j * B.BN + i];
      if (!L) continue;
      for (m = 0; m < L.length; m++) {
        g = B.seg[L[m]]; dx = g[2] - g[0]; dz = g[3] - g[1];
        t = Math.max(0, Math.min(1, ((x - g[0]) * dx + (z - g[1]) * dz) / (dx * dx + dz * dz)));
        d = Math.hypot(x - g[0] - t * dx, z - g[1] - t * dz);
        if (d < best) { best = d; id = g[4]; }
      }
    }
    if (best <= r * B.BK) break;                   // everything not yet looked at is at least r buckets away
  }
  TS.lastId = id;
  return best;
};

/* ───────────────────────────── the sensor ───────────────────────────── */
/* depth maps of the 24 training cameras.  Disparity noise sd (px) gives sigma_Z = Z^2 sd / (f b); we ask for sigma_Z = sigmaCm at Z = 6 m. */
TS.depthMaps = function (w, sigmaCm, seed) {
  var sd = sigmaCm / 100 * TS.FB / (TS.ZREF * TS.ZREF);
  return w.train.map(function (c, v) { return FL.noisyDepth(c, w.rend[v], { kind: 'stereo', f: TS.F, b: TS.FB / TS.F, sd: sd }, FL.rng((seed || 1000) + v)); });
};

/* ───────────────────────────── points (lesson 2's cloud) ───────────────────────────── */
TS.cloud = function (w, dm, n) {
  var xs = [], zs = [], rs = [], gs = [], bs = [];
  for (var k = 0; k < n; k++) {
    var v = TS.ORDER[k], cam = w.train[v], img = w.rend[v];
    for (var i = 0; i < cam.W; i++) {
      if (dm[v][i] <= 0) continue;
      var p = FL.backproject(cam, i + 0.5, dm[v][i]);
      xs.push(p.x); zs.push(p.z); rs.push(img.r[i]); gs.push(img.g[i]); bs.push(img.b[i]);
    }
  }
  return { n: xs.length, x: Float64Array.from(xs), z: Float64Array.from(zs), r: Float32Array.from(rs), g: Float32Array.from(gs), b: Float32Array.from(bs) };
};

/* z-buffered splats of `ws` pixels width seen from `cam`.  Returns {W, r, g, b, t (unit-ray distance of the nearest splat, -1 = empty)} */
TS.renderPoints = function (w, P, cam, ws) {
  var W = cam.W, A = FL.camAxes(cam), zb = new Float64Array(W).fill(Infinity), out = { W: W, r: new Float32Array(W), g: new Float32Array(W), b: new Float32Array(W), t: new Float64Array(W).fill(-1), zc: new Float64Array(W) };
  var bg = w.scene.bg, i, k;
  for (i = 0; i < W; i++) { out.r[i] = bg[0]; out.g[i] = bg[1]; out.b[i] = bg[2]; }
  for (k = 0; k < P.n; k++) {
    var dx = P.x[k] - cam.x, dz = P.z[k] - cam.z, zc = dx * A.fx + dz * A.fz;
    if (zc < 0.3) continue;
    var u = W / 2 + cam.f * (dx * A.rx + dz * A.rz) / zc;
    var i0 = Math.ceil(u - ws / 2 - 0.5), i1 = Math.floor(u + ws / 2 - 0.5);
    for (i = Math.max(0, i0); i <= Math.min(W - 1, i1); i++) {
      if (zc < zb[i]) { zb[i] = zc; out.r[i] = P.r[k]; out.g[i] = P.g[k]; out.b[i] = P.b[k]; out.zc[i] = zc; }
    }
  }
  for (i = 0; i < W; i++) if (zb[i] < Infinity) { var xc = (i + 0.5 - W / 2) / cam.f; out.t[i] = zb[i] * Math.sqrt(1 + xc * xc); }
  return out;
};

/* ───────────────────────────── fusion ───────────────────────────── */
/* One view's vote on the point (x, z): null when the view cannot speak (outside the picture, no depth, or hidden by more than mu behind the
 * surface it measured), else {d: signed distance along the ray, clipped to mu in front; w: inverse variance of a stereo depth, (6 m / Z)^4}. */
TS.voteAt = function (w, dm, mu, v, x, z, uniform) {
  var cam = w.train[v], A = FL.camAxes(cam), dx = x - cam.x, dz = z - cam.z, zc = dx * A.fx + dz * A.fz;
  if (zc < 0.3) return null;
  var u = cam.W / 2 + cam.f * (dx * A.rx + dz * A.rz) / zc, px = Math.floor(u);
  if (px < 0 || px >= cam.W || dm[v][px] <= 0) return null;
  var zm = dm[v][px], d = zm - zc;
  if (d < -mu) return null;
  var r = TS.ZREF / zm;
  return { d: d > mu ? mu : d, w: uniform ? 1 : r * r * r * r };
};

TS.fuse = function (w, dm, mu, o) {
  o = o || {};
  var NG = TS.NG, M = NG * NG, X0 = TS.X0, H = TS.H, S1 = [], S0 = [], a1 = new Float64Array(M), a0 = new Float64Array(M), ZR = TS.ZREF;
  for (var k = 0; k < w.train.length; k++) {
    var v = TS.ORDER[k], cam = w.train[v], A = FL.camAxes(cam), dep = dm[v], Wp = cam.W, f = cam.f;
    for (var j = 0; j < NG; j++) {
      var z = X0 + j * H, dz = z - cam.z;
      for (var i = 0; i < NG; i++) {
        var dx = X0 + i * H - cam.x, zc = dx * A.fx + dz * A.fz;
        if (zc < 0.3) continue;
        var px = Math.floor(Wp / 2 + f * (dx * A.rx + dz * A.rz) / zc);
        if (px < 0 || px >= Wp || dep[px] <= 0) continue;
        var d = dep[px] - zc;
        if (d < -mu) continue;
        if (d > mu) d = mu;
        var r = ZR / dep[px], wt = o.uniform ? 1 : r * r * r * r;
        a1[j * NG + i] += wt * d; a0[j * NG + i] += wt;
      }
    }
    S1.push(Float32Array.from(a1)); S0.push(Float32Array.from(a0));
  }
  return { mu: mu, S1: S1, S0: S0 };
};

TS.field = function (Fz, n) {
  var Wt = Fz.S0[n - 1], S = Fz.S1[n - 1], M = Wt.length, D = new Float32Array(M);
  for (var k = 0; k < M; k++) {
    D[k] = Wt[k] > 0 ? S[k] / Wt[k] : 0;
  }
  return { D: D, W: Wt, mu: Fz.mu, n: n };
};

/* ───────────────────────────── reading the field ───────────────────────────── */
/* bilinear D at (x, z); NaN when any of the four corner nodes was never observed (W = 0) or the point is outside the grid */
TS.sample = function (fld, x, z) {
  var NG = TS.NG, H = TS.H, gx = (x - TS.X0) / H, gz = (z - TS.X0) / H;
  if (!(gx >= 0 && gz >= 0 && gx < NG - 1 && gz < NG - 1)) return NaN;
  var i = Math.floor(gx), j = Math.floor(gz), fx = gx - i, fz = gz - j, a = j * NG + i, W = fld.W, D = fld.D;
  if (W[a] <= 0 || W[a + 1] <= 0 || W[a + NG] <= 0 || W[a + NG + 1] <= 0) return NaN;
  return (1 - fz) * ((1 - fx) * D[a] + fx * D[a + 1]) + fz * ((1 - fx) * D[a + NG] + fx * D[a + NG + 1]);
};
/* the normal: the unit gradient of D (it points out of the object), by central differences one cell either side; g is the gradient's length.  null where unobserved. */
TS.normal = function (fld, x, z) {
  var H = TS.H, a = TS.sample(fld, x + H, z), b = TS.sample(fld, x - H, z), c = TS.sample(fld, x, z + H), d = TS.sample(fld, x, z - H);
  if (a !== a || b !== b || c !== c || d !== d) return null;
  var gx = (a - b) / (2 * H), gz = (c - d) / (2 * H), l = Math.hypot(gx, gz) || 1;
  return { x: gx / l, z: gz / l, g: l };
};
/* the points where D changes sign along a grid edge (both end nodes observed): one point per edge, by linear interpolation.  Flat array [x, z, x, z, ...]. */
TS.crossings = function (fld) {
  var NG = TS.NG, H = TS.H, X0 = TS.X0, D = fld.D, W = fld.W, out = [];
  for (var j = 0; j < NG; j++) for (var i = 0; i < NG; i++) {
    var a = j * NG + i;
    if (W[a] <= 0) continue;
    if (i + 1 < NG && W[a + 1] > 0 && (D[a] < 0) !== (D[a + 1] < 0)) out.push(X0 + H * (i + D[a] / (D[a] - D[a + 1])), X0 + H * j);
    if (j + 1 < NG && W[a + NG] > 0 && (D[a] < 0) !== (D[a + NG] < 0)) out.push(X0 + H * i, X0 + H * (j + D[a] / (D[a] - D[a + NG])));
  }
  return out;
};

/* marching squares on the nodes with W > 0.  Returns segments [x1, z1, x2, z2, ...] (flat array); a cell with a saddle (two diagonal corners inside)
 * is split by the sign of the cell-centre average, the usual resolution of the ambiguity. */
TS.zeroSet = function (fld) {
  var NG = TS.NG, H = TS.H, X0 = TS.X0, D = fld.D, W = fld.W, seg = [];
  for (var j = 0; j < NG - 1; j++) for (var i = 0; i < NG - 1; i++) {
    var a0 = j * NG + i, a1 = a0 + 1, a2 = a0 + NG + 1, a3 = a0 + NG;
    if (W[a0] <= 0 || W[a1] <= 0 || W[a2] <= 0 || W[a3] <= 0) continue;
    var v0 = D[a0], v1 = D[a1], v2 = D[a2], v3 = D[a3], x = X0 + i * H, z = X0 + j * H, p = [];
    if ((v0 < 0) !== (v1 < 0)) p.push(x + H * v0 / (v0 - v1), z);                 // bottom edge
    if ((v1 < 0) !== (v2 < 0)) p.push(x + H, z + H * v1 / (v1 - v2));             // right edge
    if ((v3 < 0) !== (v2 < 0)) p.push(x + H * v3 / (v3 - v2), z + H);             // top edge
    if ((v0 < 0) !== (v3 < 0)) p.push(x, z + H * v0 / (v0 - v3));                 // left edge
    if (p.length === 4) seg.push(p[0], p[1], p[2], p[3]);
    else if (p.length === 8) {                                                      // saddle: edges are bottom, right, top, left
      var c = (v0 + v1 + v2 + v3) / 4;
      if ((c < 0) === (v0 < 0)) seg.push(p[0], p[1], p[2], p[3], p[4], p[5], p[6], p[7]);   // corners 0 and 2 are joined through the middle: cut off 1 and 3
      else seg.push(p[0], p[1], p[6], p[7], p[2], p[3], p[4], p[5]);                      // corners 0 and 2 are islands
    }
  }
  return seg;
};

/* sphere tracing of the ray o + t d (d a unit vector) through the fused field: step by 0.8 of the field value (never less than half a cell, never more
 * than mu, which is as far as a truncated field can vouch for), stop at the first sign change and refine it by bisection.  Unobserved space is crossed
 * blindly in steps of mu/2.  Returns {hit, t, x, z}. */
TS.trace = function (fld, ox, oz, dx, dz, tmax) {
  var X0 = TS.X0, X1 = TS.X0 + (TS.NG - 1) * TS.H, rb = FL.vol.rayBox(ox, oz, dx, dz, X0, X1, X0, X1);
  if (!rb) return { hit: false, t: -1, x: 0, z: 0 };
  var t = rb[0] + 1e-6, te = Math.min(tmax, rb[1]), mu = fld.mu, prevT = -1, prevD = NaN;
  while (t < te) {
    var D = TS.sample(fld, ox + dx * t, oz + dz * t);
    if (D !== D) { prevD = NaN; t += 0.5 * mu; continue; }
    if (D <= 0) {
      var lo = prevD === prevD ? prevT : t, hi = t;
      if (prevD === prevD) for (var it = 0; it < 12; it++) { var m = (lo + hi) / 2; if (TS.sample(fld, ox + dx * m, oz + dz * m) > 0) lo = m; else hi = m; }
      return { hit: true, t: hi, x: ox + dx * hi, z: oz + dz * hi };
    }
    prevT = t; prevD = D;
    t += Math.min(mu, Math.max(0.8 * D, 0.5 * TS.H));
  }
  return { hit: false, t: -1, x: 0, z: 0 };
};

/* one view's votes at a point, for the first n views: [{v, d, w}], plus the fused value D = sum(w d) / sum(w) and W = sum(w) (D is NaN when nobody votes) */
TS.votesAt = function (w, dm, mu, n, x, z, uniform) {
  var list = [], s1 = 0, s0 = 0;
  for (var k = 0; k < n; k++) {
    var vt = TS.voteAt(w, dm, mu, TS.ORDER[k], x, z, uniform);
    if (vt) { list.push({ v: TS.ORDER[k], d: vt.d, w: vt.w }); s1 += vt.w * vt.d; s0 += vt.w; }
  }
  return { votes: list, D: s0 > 0 ? s1 / s0 : NaN, W: s0 };
};

/* where the optical axis of held-out camera c first meets the scene (a point on the true surface that the camera looks straight at) */
TS.probe = function (w, c) {
  var cam = w.test[c], r = FL.pixelRay(cam, cam.W / 2), h = FL.raycast(w.scene, r.ox, r.oz, r.dx, r.dz, 20);
  return { x: h.x, z: h.z, id: h.id };
};

/* ───────────────────────────── the exam ───────────────────────────── */
function psnrOf(se, n) { var m = se / n; return m < 1e-10 ? 99 : -10 * Math.log10(m); }
function pixelErr(img, ph, i) { var a = img.r[i] - ph.r[i], b = img.g[i] - ph.g[i], c = img.b[i] - ph.b[i]; return (a * a + b * b + c * c) / 3; }

/* The mean colour of the pixels that show an object, over the first n training photographs: the best single colour for a colourless surface. */
TS.meanColour = function (w, n) {
  var s = [0, 0, 0], c = 0;
  for (var k = 0; k < n; k++) { var img = w.rend[TS.ORDER[k]]; for (var i = 0; i < img.W; i++) if (img.id[i] >= 0) { s[0] += img.r[i]; s[1] += img.g[i]; s[2] += img.b[i]; c++; } }
  return c ? [s[0] / c, s[1] / c, s[2] / c] : [0.5, 0.5, 0.5];
};

/* The surface seen from a held-out camera: for every pixel, trace the ray; paint the hit with paint(hit) or leave the background.  Returns {W, r, g, b, t}. */
TS.renderSurface = function (w, fld, cam, paint) {
  var W = cam.W, out = { W: W, r: new Float32Array(W), g: new Float32Array(W), b: new Float32Array(W), t: new Float64Array(W).fill(-1) }, bg = w.scene.bg;
  for (var i = 0; i < W; i++) {
    var ray = FL.pixelRay(cam, i + 0.5), h = TS.trace(fld, ray.ox, ray.oz, ray.dx, ray.dz, 14), c = bg;
    if (h.hit) { out.t[i] = h.t; c = paint(h); }
    out.r[i] = c[0]; out.g[i] = c[1]; out.b[i] = c[2];
  }
  return out;
};

/* The colour of a surface point copied from the training photograph (among the first n) whose camera is nearest to the held-out camera.  No visibility test. */
TS.copyColour = function (w, n, cam, h, fallback) {
  var best = -1, bd = 1e9;
  for (var k = 0; k < n; k++) { var v = TS.ORDER[k], c = w.train[v], d = (c.x - cam.x) * (c.x - cam.x) + (c.z - cam.z) * (c.z - cam.z); if (d < bd) { bd = d; best = v; } }
  var tc = w.train[best], p = FL.project(tc, h.x, h.z), px = Math.floor(p.u);
  if (p.zc <= 0 || px < 0 || px >= tc.W) return fallback;
  var img = w.rend[best];
  return [img.r[px], img.g[px], img.b[px]];
};

/* How one pixel's answer compares with the truth: 0 right (or a correct "nothing"), 1 an answer behind the true first hit (the ray saw through),
 * 2 an answer in front of it, 3 no answer where something is, 4 an answer where nothing is. */
TS.classify = function (tt, tm) {
  if (tt < 0) return tm < 0 ? 0 : 4;
  if (tm < 0) return 3;
  return Math.abs(tm - tt) <= TS.TOL ? 0 : (tm > tt ? 1 : 2);
};

/* The exam of one model on all 24 held-out cameras.  model = {kind: 'points', P, ws} | {kind: 'const' | 'copy', fld} | {kind: 'trueconst' | 'truecopy'}.
 * Returns {nHit, far, near, empty, phantom, wrong (% of the rays that truly hit that got a wrong answer or none), psnr (the exam of lesson 7: the PSNR of each held-out camera, averaged over the cameras), per: renderings}. */
TS.exam = function (w, model, n) {
  var cnt = [0, 0, 0, 0, 0], nHit = 0, ps = 0, per = [], mc = TS.meanColour(w, n);
  for (var c = 0; c < w.test.length; c++) {
    var cam = w.test[c], ph = w.photo[c], img;
    if (model.kind === 'points') img = TS.renderPoints(w, model.P, cam, model.ws || 1);
    else if (model.kind === 'const') img = TS.renderSurface(w, model.fld, cam, function () { return mc; });
    else if (model.kind === 'copy') img = TS.renderSurface(w, model.fld, cam, function (h) { return TS.copyColour(w, n, cam, h, mc); });
    else {                                                  // the true surface: the first hit of the real scene, painted by the same two rules
      img = { W: cam.W, r: new Float32Array(cam.W), g: new Float32Array(cam.W), b: new Float32Array(cam.W), t: Float64Array.from(w.tTrue[c]) };
      for (var q = 0; q < cam.W; q++) {
        var col = w.scene.bg, ry = FL.pixelRay(cam, q + 0.5);
        if (img.t[q] >= 0) col = model.kind === 'trueconst' ? mc : TS.copyColour(w, n, cam, { x: ry.ox + ry.dx * img.t[q], z: ry.oz + ry.dz * img.t[q] }, mc);
        img.r[q] = col[0]; img.g[q] = col[1]; img.b[q] = col[2];
      }
    }
    img.cls = new Uint8Array(cam.W);
    var seCam = 0;
    for (var i = 0; i < cam.W; i++) {
      var tt = w.tTrue[c][i], k = TS.classify(tt, img.t[i]);
      img.cls[i] = k; cnt[k]++; if (tt >= 0) nHit++;
      seCam += pixelErr(img, ph, i);
    }
    ps += psnrOf(seCam, cam.W);                           // the exam of lesson 7: the PSNR of each held-out camera, averaged over the cameras
    per.push(img);
  }
  return { nHit: nHit, far: cnt[1], near: cnt[2], empty: cnt[3], phantom: cnt[4], wrong: 100 * (cnt[1] + cnt[2] + cnt[3]) / nHit, psnr: ps / w.test.length, per: per };
};

/* ───────────────────────────── error measures of a fused surface ───────────────────────────── */
/* distance of every zero crossing (TS.crossings) to the true boundary.  stat = RMS over the crossings whose nearest shape is the statue (cm),
 * all = RMS over all of them (cm), worst = the largest distance anywhere (cm). */
TS.surfaceError = function (w, pts) {
  var s = 0, c = 0, sa = 0, ca = 0, mx = 0;
  for (var k = 0; k < pts.length; k += 2) {
    var d = TS.trueDist(w.scene, pts[k], pts[k + 1]);
    if (TS.lastId === 0) { s += d * d; c++; }
    sa += d * d; ca++; if (d > mx) mx = d;
  }
  return { stat: c ? 100 * Math.sqrt(s / c) : NaN, all: ca ? 100 * Math.sqrt(sa / ca) : NaN, worst: 100 * mx, nv: ca };
};
/* holes: % of the true boundary samples that have a never-observed node among the four corners of their cell */
TS.holes = function (w, fld) {
  var B = w.bnd, NG = TS.NG, H = TS.H, miss = 0;
  for (var k = 0; k < B.n; k++) {
    var gx = (B.x[k] - TS.X0) / H, gz = (B.z[k] - TS.X0) / H, i = Math.floor(gx), j = Math.floor(gz), a = j * NG + i;
    if (fld.W[a] <= 0 || fld.W[a + 1] <= 0 || fld.W[a + NG] <= 0 || fld.W[a + NG + 1] <= 0) miss++;
  }
  return 100 * miss / B.n;
};
/* the error of the fused surface after n = ns[0], ns[1], ... views: [{n, stat, all, worst}] */
TS.curve = function (w, Fz, ns) {
  return ns.map(function (n) { var e = TS.surfaceError(w, TS.crossings(TS.field(Fz, n))); e.n = n; return e; });
};

/* ───────────────────────────── the widget's drawing ───────────────────────────── */
TS.NS = [1, 2, 3, 4, 6, 8, 12, 16, 20, 24];             // the numbers of views at which the error curve is evaluated

/* Draw the lesson's canvas.  S = the page's state: {fld, seg, P, n, c, mu, sg, dm, err, curve, floor, ep, ec, ek}; exam = show the held-out exam
 * (the amber camera's photograph and what each model makes of it) instead of the fused field and its two plots. */
TS.drawWidget = function (cv, S, exam) {
  var D = FL.draw, C = FL.C, W = TS.world(), NG = TS.NG, HH = TS.H, X0 = TS.X0, NS = TS.NS;
  var CLS = [C.green, C.red, C.amber, C.ink, C.violet];          // 0 right, 1 sees through, 2 answered in front, 3 no answer, 4 answer where nothing is
  var LUT = [], q;                                                // colour of D/mu from -1 (orange) to +1 (blue)
  for (q = 0; q <= 32; q++) {
    var t = q / 16 - 1;
    LUT.push(t >= 0 ? 'rgb(' + Math.round(255 - 110 * t) + ',' + Math.round(255 - 70 * t) + ',' + Math.round(255 - 20 * t) + ')'
                    : 'rgb(' + Math.round(255 + 20 * t) + ',' + Math.round(255 + 90 * t) + ',' + Math.round(255 + 160 * t) + ')');
  }

  /* the map: D on the grid, the true outline, the points, the zero set, the cameras */
  function drawMap(ctx, bx, by, bs) {
    var v = D.view(bx, by, bs, bs, -3.5, 3.5, -3.5, 3.5), px = HH * v.s + 0.6, i, j, a, k, fw = S.fld.W, fd = S.fld.D;
    D.frame(ctx, bx, by, bs, bs, C.white);
    for (j = 0; j < NG; j++) for (i = 0; i < NG; i++) {
      a = j * NG + i;
      ctx.fillStyle = fw[a] > 0 ? LUT[Math.round(16 + 16 * Math.max(-1, Math.min(1, fd[a] / S.mu)))] : '#eef0f4';
      ctx.fillRect(v.X(X0 + i * HH) - px / 2, v.Y(X0 + j * HH) - px / 2, px, px);
    }
    D.scene(ctx, W.scene, v, { fillAlpha: 0, lineWidth: 1.4 });
    ctx.save(); ctx.fillStyle = 'rgba(31,36,48,0.5)';
    for (k = 0; k < S.P.n; k++) ctx.fillRect(v.X(S.P.x[k]) - 1, v.Y(S.P.z[k]) - 1, 2, 2);
    ctx.strokeStyle = C.ink; ctx.lineWidth = 2; ctx.beginPath();
    for (k = 0; k < S.seg.length; k += 4) { ctx.moveTo(v.X(S.seg[k]), v.Y(S.seg[k + 1])); ctx.lineTo(v.X(S.seg[k + 2]), v.Y(S.seg[k + 3])); }
    ctx.stroke(); ctx.restore();
    function glyph(cam, color) { var th = Math.atan2(cam.z, cam.x); D.camera(ctx, FL.camera({ x: 3.3 * Math.cos(th), z: 3.3 * Math.sin(th), a: th + Math.PI, f: 56, W: 64 }), v, { color: color, fov: false }); }
    for (k = 0; k < S.n; k++) glyph(W.train[TS.ORDER[k]], C.blue);
    var hc = W.test[S.c], pr = TS.probe(W, S.c), th = Math.atan2(hc.z, hc.x);
    glyph(hc, C.amber);
    D.wline(ctx, v, 3.3 * Math.cos(th), 3.3 * Math.sin(th), pr.x, pr.z, C.amber, 1, [4, 3]);
    D.dot(ctx, v.X(pr.x), v.Y(pr.z), 4, C.amber, C.white);
    return v;
  }
  /* exam view: the amber camera's 64 rays, coloured by the surface's answer */
  function drawRays(ctx, v) {
    var cam = W.test[S.c], cls = S.ec.per[S.c].cls, hi = X0 + (NG - 1) * HH, i;
    for (i = 0; i < cam.W; i++) {
      var r = FL.pixelRay(cam, i + 0.5), rb = FL.vol.rayBox(r.ox, r.oz, r.dx, r.dz, X0, hi, X0, hi), tt = W.tTrue[S.c][i];
      if (!rb) continue;
      var te = tt >= 0 ? tt : rb[1], k = cls[i];
      D.wline(ctx, v, r.ox + r.dx * rb[0], r.oz + r.dz * rb[0], r.ox + r.dx * te, r.oz + r.dz * te, k ? CLS[k] : (tt >= 0 ? 'rgba(22,163,74,0.45)' : 'rgba(148,163,184,0.3)'), k ? 1.4 : 0.8);
    }
  }
  /* error of the statue's zero set against the number of views, on logarithmic axes */
  function drawPlot(ctx, x, y, w, h) {
    var lx = x + 34, rx = x + w - 10, ty = y + 32, by = y + h - 20;
    var X = function (n) { return lx + Math.log(n) / Math.log(24) * (rx - lx); };
    var Y = function (e) { return by - Math.log(Math.max(0.25, Math.min(8, e)) / 0.25) / Math.log(32) * (by - ty); };
    D.frame(ctx, x, y, w, h, C.white);
    [0.5, 1, 2, 4, 8].forEach(function (g) { D.line(ctx, lx, Y(g), rx, Y(g), C.grid, 1); D.mono(ctx, '' + g, lx - 4, Y(g), C.mute, 9, 'right'); });
    [1, 2, 4, 8, 16, 24].forEach(function (n) { D.mono(ctx, '' + n, X(n), by + 10, C.mute, 9, 'center'); });
    var me = [], fl = [], ln = [];
    NS.forEach(function (n, i) { me.push([X(n), Y(S.curve[i].stat)]); fl.push([X(n), Y(S.floor[i].stat)]); ln.push([X(n), Y(S.sg / Math.sqrt(n))]); });
    D.path(ctx, fl, C.dim, 1.6, [5, 3]); D.path(ctx, ln, C.blue, 1.6, [2, 3]); D.path(ctx, me, C.amber, 2.4);
    D.dot(ctx, X(S.n), Y(S.err.stat), 4.5, C.amber, C.white);
    D.mono(ctx, 'statue error (cm) against views fused', x + 8, y + 9, C.mute, 9);
    D.mono(ctx, 'measured', x + 8, y + 21, C.amber, 9); D.mono(ctx, 'σ = 0 (the pixel grid)', x + 70, y + 21, C.mute, 9); D.mono(ctx, 'σ/√n', x + 200, y + 21, C.blue, 9);
  }
  /* the votes of the fused views at the point the amber camera looks at */
  function drawVotes(ctx, x, y, w, h) {
    var pr = TS.probe(W, S.c), V = TS.votesAt(W, S.dm, S.mu, S.n, pr.x, pr.z), lo = x + 12, hi = x + w - 12, R = 0.15, top = y + 32;
    var X = function (d) { return lo + (Math.max(-R, Math.min(R, d)) + R) / (2 * R) * (hi - lo); };
    D.frame(ctx, x, y, w, h, C.white);
    D.mono(ctx, 'votes at the amber point, on the true surface (cm)', x + 8, y + 9, C.mute, 9);
    D.mono(ctx, V.votes.length ? 'D = ' + (100 * V.D).toFixed(2) + ' cm from ' + V.votes.length + (V.votes.length === 1 ? ' vote' : ' votes') + ', W = ' + V.W.toFixed(1) : 'no fused view has seen this point', x + 8, y + 21, C.amber, 9);
    [-10, 0, 10].forEach(function (c) { D.line(ctx, X(c / 100), top, X(c / 100), y + h - 20, c ? C.grid : C.ink, c ? 1 : 1.4); D.mono(ctx, (c > 0 ? '+' : '') + c, X(c / 100), y + h - 10, C.mute, 9, 'center'); });
    V.votes.forEach(function (q, i) { D.dot(ctx, X(q.d), top + 8 + i * Math.min(10, (h - 72) / Math.max(1, V.votes.length)), 2 + 2.2 * Math.sqrt(q.w), C.blue, C.white); });
    if (V.votes.length) D.line(ctx, X(V.D), top, X(V.D), y + h - 20, C.amber, 2.4);
  }
  /* the exam on the amber camera: photograph, cloud, surface in one colour, surface with copied colours */
  function drawExam(ctx, x, y, w) {
    var c = S.c, sh = 24, gap = 34, rows = [
      [W.photo[c], 'photograph, held-out camera ' + (c + 1), null],
      [S.ep.per[c], 'cloud, nearest point (exam ' + S.ep.psnr.toFixed(1) + ' dB)', S.ep.per[c].cls],
      [S.ec.per[c], 'surface, one colour (exam ' + S.ec.psnr.toFixed(1) + ' dB)', S.ec.per[c].cls],
      [S.ek.per[c], 'surface, copied colours (exam ' + S.ek.psnr.toFixed(1) + ' dB)', S.ek.per[c].cls]], cw = w / 64, i, r;
    for (r = 0; r < rows.length; r++) {
      var yy = y + 14 + r * (sh + gap);
      D.strip(ctx, rows[r][0], x, yy, w, sh, { label: rows[r][1] });
      if (rows[r][2]) for (i = 0; i < 64; i++) if (rows[r][2][i]) { ctx.fillStyle = CLS[rows[r][2][i]]; ctx.fillRect(x + i * cw, yy + sh + 2, Math.max(2, cw - 1), 6); }
    }
    var ye = y + 14 + rows.length * (sh + gap);
    D.errorStrip(ctx, S.ek.per[c], W.photo[c], x, ye, w, sh, { label: 'error of the copied colours' });
    D.mono(ctx, 'ticks under a strip:', x, ye + sh + 18, C.mute, 9);
    [[1, 'sees through'], [2, 'answered in front'], [3, 'no answer'], [4, 'answer where nothing is']].forEach(function (e, j) {
      var kx = x + (j % 2) * Math.round(w / 2), ky = ye + sh + 30 + Math.floor(j / 2) * 12;
      ctx.fillStyle = CLS[e[0]]; ctx.fillRect(kx, ky - 3, 6, 6); D.mono(ctx, e[1], kx + 10, ky, C.mute, 9);
    });
  }

  cv.style.height = (cv.clientWidth < 600 ? 840 : 560) + 'px';
  var Sx = D.setup(cv), ctx = Sx.ctx, w = Sx.w, h = Sx.h, narrow = w < 600;
  var bs = narrow ? w - 16 : Math.min(h - 16, (exam ? 0.4 : 0.5) * w), v = drawMap(ctx, 8, 8, bs);
  var rx = narrow ? 8 : bs + 24, ry = narrow ? bs + 20 : 8, rw = narrow ? w - 16 : w - rx - 8;
  if (exam) { drawRays(ctx, v); drawExam(ctx, rx, ry + 8, rw); }
  else { var ph = narrow ? 220 : Math.round((h - 24) * 0.5); drawPlot(ctx, rx, ry, rw, ph); drawVotes(ctx, rx, ry + ph + 14, rw, narrow ? 220 : h - ph - 30); }
};

if (typeof module !== 'undefined' && module.exports) module.exports = TS;
root.TS = TS;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
