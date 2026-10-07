/* l08_blender.js — Lesson 8 (the contract in a real renderer): the Street-side half of the comparison with Blender.   Load after street.js (and streetview.js).  Namespace SV.l08.
 *
 * Blender 5.2.2 is run by tools/syn_blender (Python, headless); this file is everything that does not need it: the scene description handed to Blender, the Street's answer to the same description,
 * the closed-form truth of each conformance test, the measurement that turns what Blender returned into an error, the decoder of the frames recorded in l08_data.js, and the whole-frame comparison.
 * What Blender returned is DATA here (l08_data.js, recorded by tools/chain/verify/engine/build_l08.js); nothing in this file starts Blender.  Browser and node; no Math.random, no Date. */
(function (root) {
'use strict';
var SV = root.SV, L = {};
SV.l08 = L;
var C = SV.CAM, W = C.W, H = C.H, HW = W * H, F = C.f, V0 = C.V0, HC = C.hc;
L.GROUND = 1.0e5;                                                    // half-size of the ground plane the Blender builder uses (a plane, so the horizon sits V0 + F*HC/GROUND below row V0)
L.TOL = { px: 0.05, rad: 0.01, fRel: 0.005, area: 0.05, move: 0.001 };   // tolerances: positions 0.05 px, radiance 1 % of full scale, focal length 0.5 %, areas 5 %; a pixel has moved when it changes by 0.1 %

/* ───────────── the program whose renderer is replaced: the exact-stage program bbba (the street's scene, light and camera; the program's own label rule) ───────────── */
L.program = function () { return SV.hybrid(SV.SIM0, SV.REAL, { scene: 'b', look: 'b', sensor: 'b', label: 'a' }); };

/* ───────────── a scene as a plain description: parts with kind, position, size, height range and look (the Street's coordinates: x right, y up, z forward, metres) ───────────── */
L.fromStreet = function (scene, look, seed) {
  var parts = scene.parts.map(function (p) {
    var o = { pid: p.pid, id: p.id, cls: p.cls, role: p.role || null, kind: p.kind === 'circle' ? 'cyl' : 'box', x: p.x, z: p.z, y0: p.y0, y1: p.y1, col: look.col[p.pid], stripe: look.stripe[p.pid] || 0, ph: look.ph[p.pid] || 0, win: p.cls === 'wall' ? look.win : 0 };
    if (p.kind === 'circle') o.r = p.r; else { o.hx = p.hx; o.hz = p.hz; }
    return o;
  });
  return { seed: seed, parts: parts, l: look.l, amb: look.amb, lum: look.lum, ground: look.ground, skyH: look.skyH, skyZ: look.skyZ, winPhase: look.winPhase, ped: !!scene.ped, mode: scene.mode || null };
};
L.describe = function (seed, pipe) {
  pipe = pipe || L.program();
  var scene = SV.drawScene(pipe.scene, SV.stream(seed, 'scene')), look = SV.drawLook(pipe.look, scene, SV.stream(seed, 'look'));
  return L.fromStreet(scene, look, seed);
};
/* the Street's own answer to a description: the object the Street renderer takes */
L.toStreet = function (d) {
  var parts = d.parts.map(function (p) {
    var q = { id: p.id, pid: p.pid, cls: p.cls, role: p.role || undefined, kind: p.kind === 'cyl' ? 'circle' : 'box', x: p.x, z: p.z, y0: p.y0, y1: p.y1 };
    if (p.kind === 'cyl') q.r = p.r; else { q.hx = p.hx; q.hz = p.hz; }
    return q;
  });
  var look = { l: d.l, amb: d.amb, lum: d.lum, col: {}, stripe: {}, ph: {}, ground: d.ground, skyH: d.skyH, skyZ: d.skyZ, win: 0, winPhase: d.winPhase };
  d.parts.forEach(function (p) { look.col[p.pid] = p.col; look.stripe[p.pid] = p.stripe || 0; look.ph[p.pid] = p.ph || 0; if (p.cls === 'wall') look.win = p.win || 0; });
  return { scene: { parts: parts, insts: [], ped: null, van: null, mode: d.mode }, look: look };
};
/* the Street's radiance of a description with n x n rays per pixel: n = 2 is the program's own pixel, a large n is the area integral that the contract asks of a pixel */
L.streetRender = function (d, n, o) { var s = L.toStreet(d); return SV.render(s.scene, s.look, { SSh: n || 2, SSv: n || 2, only: o && o.only, maps: !(o && o.maps === false) }); };

/* ───────────── reading what the Python side wrote (node): a .json header and a raw little-endian float32 .bin ───────────── */
L.readBin = function (prefix) {
  var fs = require('fs'), hdr = JSON.parse(fs.readFileSync(prefix + '.json', 'utf8')), buf = fs.readFileSync(prefix + '.bin'), out = { meta: hdr.meta };
  Object.keys(hdr.arrays).forEach(function (k) {
    var a = hdr.arrays[k], n = a.shape.reduce(function (x, y) { return x * y; }, 1), f = new Float32Array(n);
    for (var i = 0; i < n; i++) f[i] = buf.readFloatLE(a.offset + 4 * i);
    out[k] = { shape: a.shape, data: f };
  });
  return out;
};

/* ───────────── decoding recorded arrays: base64 (no atob in the page's headless host), float32 arrays, and 12-bit radiance frames ───────────── */
var B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/', B64I = null;
L.b64bytes = function (s) {
  if (!B64I) { B64I = {}; for (var i = 0; i < 64; i++) B64I[B64.charAt(i)] = i; }
  var n = s.length, pad = s.charAt(n - 1) === '=' ? (s.charAt(n - 2) === '=' ? 2 : 1) : 0, out = new Uint8Array(n / 4 * 3 - pad), j = 0, q, k;
  for (k = 0; k < n; k += 4) {
    q = (B64I[s.charAt(k)] << 18) | (B64I[s.charAt(k + 1)] << 12) | ((B64I[s.charAt(k + 2)] || 0) << 6) | (B64I[s.charAt(k + 3)] || 0);
    if (j < out.length) out[j++] = (q >> 16) & 255; if (j < out.length) out[j++] = (q >> 8) & 255; if (j < out.length) out[j++] = q & 255;
  }
  return out;
};
L.b64f32 = function (s) { var b = L.b64bytes(s), n = b.length >> 2, f = new Float32Array(n), dv = new DataView(b.buffer, b.byteOffset, b.length); for (var i = 0; i < n; i++) f[i] = dv.getFloat32(4 * i, true); return f; };
/* a radiance frame is stored as 12-bit codes of the display value L^(1/2.2), two codes in three bytes: step 1/4095 in the display value, a few 1e-4 in radiance */
L.unpack12 = function (bytes, n) {
  var out = new Float32Array(n), i, o, a, b;
  for (i = 0; i < n; i += 2) {
    o = i * 1.5; a = (bytes[o] << 4) | (bytes[o + 1] >> 4); b = ((bytes[o + 1] & 15) << 8) | bytes[o + 2];
    out[i] = Math.pow(a / 4095, 2.2); if (i + 1 < n) out[i + 1] = Math.pow(b / 4095, 2.2);
  }
  return out;
};
L.frameAt = function (D, scene, step) { return L.unpack12(L.b64bytes(D.frames.data[scene][D.frames.index[scene][step]]), 3 * HW); };

/* ───────────── whole-frame comparison: the error of a radiance frame against another, per pixel (mean over the three channels, in radiance units: 1 = full scale) ───────────── */
L.errMap = function (a, b) { var e = new Float32Array(HW), q; for (q = 0; q < HW; q++) e[q] = (Math.abs(a[q] - b[q]) + Math.abs(a[HW + q] - b[HW + q]) + Math.abs(a[2 * HW + q] - b[2 * HW + q])) / 3; return e; };
L.stats = function (errs) {                                          // errs: an array of per-pixel error maps (one or many frames)
  var all = [], s = 0, n = 0, i, q, over = 0;
  for (i = 0; i < errs.length; i++) for (q = 0; q < errs[i].length; q++) { var v = errs[i][q]; all.push(v); s += v; n++; if (v > L.TOL.rad) over++; }
  all.sort(function (x, y) { return x - y; });
  return { mean: s / n, p99: all[Math.floor(0.99 * n)], max: all[n - 1], over: over / n, n: n };
};
L.changed = function (a, b) { var e = L.errMap(a, b), k = 0, q; for (q = 0; q < HW; q++) if (e[q] > L.TOL.move) k++; return k / HW; };

/* ───────────── the clauses of the contract, in the order they fail (loudest first), with the Blender default each one tests ───────────── */
L.CLAUSES = [
  { id: 'axes', name: 'axes and camera pose', dflt: 'camera looks down the −Z axis', unit: 'px' },
  { id: 'rows', name: 'row order of the pixel buffer', dflt: 'bottom row first', unit: 'px' },
  { id: 'lens', name: 'focal length (lens, sensor fit)', dflt: '50 mm, 36 mm, auto fit', unit: '%' },
  { id: 'shift', name: 'principal point (shift)', dflt: 'centred: horizon on row 12', unit: 'px' },
  { id: 'centre', name: 'pixel centres', dflt: 'corner convention, centre at +½', unit: 'px' },
  { id: 'shapes', name: 'shapes: origin, normals, polygons', dflt: 'origin at the centre, flat normals, 32 sides', unit: 'px' },
  { id: 'output', name: 'what a pixel holds (view transform, format)', dflt: '8-bit PNG through AgX', unit: '%' },
  { id: 'filter', name: 'pixel filter', dflt: 'Blackman-Harris, 1.5 px', unit: '' },
  { id: 'sampler', name: 'sampler (adaptive, denoiser, seed)', dflt: '4096 samples, adaptive, denoiser on', unit: '%' },
  { id: 'depth', name: 'depth pass', dflt: 'distance along the axis', unit: '%' },
  { id: 'mask', name: 'object masks', dflt: 'Object Index, one sample per pixel', unit: '%' },
  { id: 'units', name: 'units', dflt: 'metric, scale 1', unit: 'm' }
];

/* ───────────── the tests: closed-form truth and the error each recorded measurement gives (T = the recorded suite, l08_data.js: SV.L08.suite) ───────────── */
function sum(a, i0, i1) { var s = 0, i; for (i = i0 || 0; i < (i1 === undefined ? a.length : i1); i++) s += a[i]; return s; }
function centroid(cs) { var s = 0, m = 0, u; for (u = 0; u < cs.length; u++) { s += cs[u]; m += cs[u] * (u + 0.5); } return s > 1e-3 ? m / s : null; }
/* the centre column of the silhouette of a vertical box: the extremes of the corners' projections (a convex solid's silhouette is the hull of its corners) */
L.boxCentre = function (x, z, hx, hz) { var us = [], a, b; for (a = -1; a <= 1; a += 2) for (b = -1; b <= 1; b += 2) us.push(W / 2 + F * (x + a * hx) / (z + b * hz)); return (Math.min.apply(null, us) + Math.max.apply(null, us)) / 2; };
L.horizon = function () { return V0 + F * HC / L.GROUND; };
function relErr(a, b) { return Math.abs(a / b - 1); }

var M = {};
M.axes = function (T) {                                              // a green post at x = +2, z = 10 and a red one at x = -2, z = 5: where do their centres land?
  var tg = L.boxCentre(2, 10, 0.15, 0.15), tr = L.boxCentre(-2, 5, 0.15, 0.15);
  function err(v) { var g = centroid(v.green), r = centroid(v.red); return g === null || r === null ? null : Math.max(Math.abs(g - tg), Math.abs(r - tr)); }
  return { d: err(T.default_camera), s: err(T.street), mirrored: err(T.mirrored), tol: L.TOL.px, unit: 'px', truthGreen: tg, truthRed: tr, seen: sum(T.default_camera.green) + sum(T.default_camera.red) };
};
M.lens = function (T) {                                              // two slabs, edges at x = -x0 and +x0, z = 10: the edges are 2 f x0 / 10 pixels apart
  function f(v, x0) { var Wd = v.red.length, dl = sum(v.red), dr = Wd - sum(v.green); return (dr - dl) * 10 / (2 * x0); }
  var fd = f(T.default, 1.5), fs = f(T.set, 1.5);
  return { d: relErr(fd, F), s: relErr(fs, F), fDefault: fd, fSet: fs, tol: L.TOL.fRel, unit: '%', portraitAuto: f(T.portrait_auto, 0.8), portraitHorizontal: f(T.portrait_horizontal, 0.8) };
};
M.shift = function (T) { var t = L.horizon(), d = sum(T.default), s = sum(T.set); return { d: Math.abs(d - t), s: Math.abs(s - t), vDefault: d, vSet: s, truth: t, tol: L.TOL.px, unit: 'px' }; };
M.rows = function (T) {                                              // the sky-ground boundary measured from the top of the buffer as read
  function v(col) { var n = 0, s = 0; while (n < col.length && col[n] > 0.5) { s += col[n]; n++; } return s; }
  var t = L.horizon(); return { d: Math.abs(v(T.default) - t), s: Math.abs(v(T.set) - t), vDefault: v(T.default), vSet: v(T.set), tol: L.TOL.px, unit: 'px' };
};
M.centre = function (T) { var ue = W - sum(T.set), t = 40.25; return { d: Math.abs(ue - t), s: Math.abs(ue - t), edge: ue, truth: t, tol: L.TOL.px, unit: 'px' }; };
/* the edge-spread function of a filter: pixel (34 + j) with the edge at 40 + k/16 sits at x = j - 5.5 - k/16 from it; it is the filter's CDF on a regular 1/16 grid, and the density is taken to be uniform inside each interval (exact for a box) */
L.esf = function (esf) {
  var pts = [], i;
  esf.forEach(function (row, k) { row.forEach(function (v, j) { pts.push([j - 5.5 - k / 16, v]); }); });
  pts.sort(function (a, b) { return a[0] - b[0]; });
  var m1 = 0, m2 = 0, tot = 0;
  for (i = 1; i < pts.length; i++) { var dG = pts[i][1] - pts[i - 1][1], x0 = pts[i - 1][0], x1 = pts[i][0]; tot += dG; m1 += dG * (x0 + x1) / 2; m2 += dG * (x0 * x0 + x0 * x1 + x1 * x1) / 3; }
  return { sigma: Math.sqrt(m2 - m1 * m1), leak: esf[0][5], mass: tot };
};
M.filter = function (T) {
  var bh = L.esf(T.bh15.esf), bx = L.esf(T.box10.esf);
  return { d: bh.leak, s: bx.leak, sigmaDefault: bh.sigma, sigmaSet: bx.sigma, sigmaExtra: Math.sqrt(bh.sigma * bh.sigma - bx.sigma * bx.sigma), tol: L.TOL.rad, unit: '', sliverPeakDefault: Math.max.apply(null, T.bh15.sliver), sliverPeakSet: Math.max.apply(null, T.box10.sliver),
           sliverSumDefault: sum(T.bh15.sliver), sliverSumSet: sum(T.box10.sliver), sigmaBox15: L.esf(T.box15.esf).sigma, sigmaBh10: L.esf(T.bh10.esf).sigma, sigmaGauss: L.esf(T.gauss15.esf).sigma, leakBox15: T.box15.esf[0][5] };
};
M.output = function (T) {
  var R = [0.02, 0.05, 0.18, 0.5, 0.95];
  function e(p) { var m = 0, k; for (k = 0; k < R.length; k++) m = Math.max(m, Math.abs(p[k][0] / R[k] - 1)); return m; }
  return { d: e(T.png8_agx), s: e(T.exr32), standard: e(T.png8_standard), agxAt095: T.png8_agx[4][0] / R[4] - 1, agxAt018: T.png8_agx[2][0] / R[2] - 1, tol: L.TOL.rad, unit: '%' };
};
var W40 = [0, 0, 0, 0, 0.75, 1, 1, 1, 1], W20 = [0, 0, 0, 0, 0.3, 0, 0, 0, 0];
function winErr(v) { var m = 0, k; for (k = 0; k < 9; k++) m = Math.max(m, Math.abs(v.w40[k] - W40[k]), Math.abs(v.w20[k] - W20[k])); return m; }
M.sampler = function (T) {
  return { d: winErr(T.default), s: winErr(T.set), denoiseOnly: winErr(T.denoise_only), adaptiveOnly: winErr(T.adaptive_only), spp1: winErr(T.spp1), spp4: winErr(T.spp4), spp16: winErr(T.spp16), spp64: winErr(T.set), spp256: winErr(T.spp256), spp1024: winErr(T.spp1024),
           secDefault: T.default.sec, secSet: T.set.sec, overshoot: T.default.w40[5] - 1, tol: L.TOL.rad, unit: '%' };
};
function rowsOfCol(c) { var f = 0, l = c.length - 1; while (f < c.length && c[f] < 1e-9) f++; while (l >= 0 && c[l] < 1e-9) l--; return { top: f + (1 - c[f]), bottom: l + c[l], height: sum(c) }; }
M.shapes = function (T) {
  var r = 0.25, front = 10 - r, tt = V0 - F * (1.7 - HC) / front, tb = V0 + F * HC / front;
  function pe(c) { var e = rowsOfCol(c); return { top: e.top, bottom: e.bottom, err: Math.max(Math.abs(e.top - tt), Math.abs(e.bottom - tb)), height: e.height }; }
  function shade(v) {                                                // radiance across a wide cylinder against the Street's own render of it (16 x 16 rays per pixel), interior pixels only
    var s = L.streetRender(v.desc, 16), mx = 0, sm = 0, n = 0, u, q;
    for (u = 1; u < W - 1; u++) { q = 11 * W + u; if (s.id[q] === 0 && s.id[q - 1] === 0 && s.id[q + 1] === 0 && s.id[q - W] === 0 && s.id[q + W] === 0) { var e = Math.abs(v.row[u] - s.rad[q]) / s.rad[q]; mx = Math.max(mx, e); sm += e; n++; } }
    return { max: mx, mean: sm / n, n: n };
  }
  function width(row) { return sum(row); }
  var ex = 2 * F * Math.tan(Math.asin(2 / 15)), pb = pe(T.placement_base.col), pc = pe(T.placement_centre.col), sf = shade(T.shading_flat), ss = shade(T.shading_smooth);
  return { d: pb.err, s: pc.err, placementBase: pb, placementCentre: pc, shadeFlat: sf, shadeSmooth: ss, topTruth: tt, bottomTruth: tb, tol: L.TOL.px, unit: 'px',
           w8: relErr(width(T.vertices_8.row), ex), w16: relErr(width(T.vertices_16.row), ex), w32: relErr(width(T.vertices_32.row), ex), w128: relErr(width(T.vertices_128.row), ex),
           w32signed: width(T.vertices_32.row) / ex - 1, widthExact: ex, bound32: 1 - Math.cos(Math.PI / 32) };
};
M.depth = function (T) {
  var z = L.b64f32(T.z), m = L.b64f32(T.mist), wall = 20 - 0.05, g = 0, wl = 0, rc = 0, mr = 0, mz = 0, v, u, k, kk, ng = 0, nw = 0, kmax = 1;
  function quad(r) { var t = Math.min(1, Math.max(0, (r - T.mist_start) / T.mist_depth)); return t * t; }
  for (v = 0; v < H; v++) for (u = 0; u < W; u++) {
    var q = v * W + u, tp = (u + 0.5 - W / 2) / F, rho = (V0 - (v + 0.5)) / F; kk = Math.sqrt(1 + tp * tp + rho * rho);
    if (v + 0.5 - V0 > F * HC / wall) { var zg = F * HC / (v + 0.5 - V0); g = Math.max(g, Math.abs(z[q] / zg - 1)); rc = Math.max(rc, 1 - 1 / kk); ng++; }
    else { wl = Math.max(wl, Math.abs(z[q] - wall)); mr = Math.max(mr, Math.abs(m[q] - quad(wall * kk))); mz = Math.max(mz, Math.abs(m[q] - quad(wall))); nw++; kmax = Math.max(kmax, kk); }
  }
  return { d: g, s: g, ground: g, wall: wl, rangeConfusion: rc, mistVsRange: mr, mistVsDepth: mz, nGround: ng, nWall: nw, tol: L.TOL.rad, unit: '%', skyZ: T.sky ? T.sky.z : null };
};
M.mask = function (T) {
  var h = F * 3 / 20, tr = [0.3 * h, 0.3 * h, 2.3 * h];                // slabs 0.3, 0.3 and 2.3 px wide and 3 m tall at z = 20: height in pixels = 3 f / 20
  function areas(w) { return [sum(w.A.reduce(function (a, r) { return a.concat(r); }, [])), sum(w.B.reduce(function (a, r) { return a.concat(r); }, [])), sum(w.C.reduce(function (a, r) { return a.concat(r); }, []))]; }
  function err(a) { return Math.max(Math.abs(a[0] / tr[0] - 1), Math.abs(a[1] / tr[1] - 1), Math.abs(a[2] / tr[2] - 1)); }
  var ai = areas(T.object_index), ah = areas(T.holdout_alpha), ac = areas(T.cryptomatte);
  return { d: err(ai), s: err(ah), index: ai, alpha: ah, crypto: ac, truth: tr, tol: L.TOL.area, unit: '%', cryptoVsAlpha: Math.max(Math.abs(ac[0] - ah[0]), Math.abs(ac[1] - ah[1]), Math.abs(ac[2] - ah[2])) };
};
M.units = function (T) { var t = 9.95; return { d: Math.abs(T.metre.z_centre - t), s: Math.abs(T.metre.z_centre - t), z: T.metre.z_centre, zCm: T.centimetre.z_centre, tol: L.TOL.px, unit: 'm' }; };
L.measure = function (S) {
  var out = {};
  Object.keys(M).forEach(function (k) { out[k] = M[k](S[k]); });
  return out;
};
L.measures = M;
/* a clause fails at Blender's default when its error there is over its tolerance (or the test cannot even see the object) */
L.fails = function (m) { return m.d === null || m.d > m.tol; };

if (typeof module !== 'undefined' && module.exports) module.exports = L;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
