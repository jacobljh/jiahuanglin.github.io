/* l09_factory.js — Lesson 9 (replay, checks and leaks): a factory that carries its own evidence.  Load after street.js; browser and node; everything is under SV.l09, nothing in SV changes.
 *
 *   the generator       L.make(pipe, seeds, o)      one frame as the factory writes it: DN image, coverage mask, depth, range, instance ids, label, the logged auto-exposure gain
 *                                                   (the same frame SV.sample draws, plus the metadata a renderer logs); seeds = {scene, look, sensor}; o.cam patches the renderer's camera
 *   the manifest        L.hash64 (FNV-1a, 64 bit), L.digest(rec) -> {hx, hy}, L.row(rec, split), L.cfgHash(pipe), L.manifest(...), L.integrity(...), L.replay(...)
 *   the invariants      L.INV (one pure function of a frame record and the declared program), L.check(rec, decl), L.batch(rows, decl): the contract of Lessons 7-8 as code
 *   the bench           L.FAULTS (the injected faults), L.produce(...), L.run(...): a run of frames as a faulty factory writes it, with the manifest rows it wrote
 *   the canary, the siblings and the memorising learners are further down.
 * Deterministic: no Math.random, no Date.  The checks read the DECLARED camera (frozen at load), never SV.CAM, because a fault may patch SV.CAM for one render. */
(function (root) {
'use strict';
var SV = root.SV, L = {};
SV.l09 = L;
var CAM = SV.CAM, W = CAM.W, H = CAM.H, HW = W * H, DECL = { f: CAM.f, V0: CAM.V0, hc: CAM.hc, u0: CAM.W / 2 };
L.DECL = DECL;
L.VERSION = 'street-1.0';

/* ───────────────────────────── the checksum: FNV-1a, 64 bit, over quantised integers ───────────────────────────── */
function Hash() { this.hi = 0xcbf29ce4; this.lo = 0x84222325; }
Hash.prototype.byte = function (b) {
  var lo = (this.lo ^ (b & 255)) >>> 0, t = lo * 0x1b3, hi = this.hi;                       // multiply (hi:lo) by the prime 2^40 + 0x1b3, modulo 2^64
  this.lo = t % 4294967296;
  this.hi = (Math.imul(hi, 0x1b3) + Math.floor(t / 4294967296) + (lo << 8)) >>> 0;
  return this;
};
Hash.prototype.int = function (v) { v = v | 0; return this.byte(v).byte(v >> 8).byte(v >> 16).byte(v >> 24); };
Hash.prototype.hex = function () { return ('00000000' + this.hi.toString(16)).slice(-8) + ('00000000' + this.lo.toString(16)).slice(-8); };
L.hash64 = function (s) { var h = new Hash(); for (var i = 0; i < s.length; i++) h.byte(s.charCodeAt(i)); return h.hex(); };
L.Hash = Hash;
/* the digest of a frame: pixels (8-bit DN) and labels (label, areas, coverage, instance ids, depth and range in millimetres), quantised so that a last-bit difference of a platform's exp or pow cannot change them */
L.digest = function (rec) {
  var hx = new Hash(), hy = new Hash(), i, x = rec.x, cov = rec.cov, n = x.length;
  for (i = 0; i < n; i++) hx.byte(Math.round(x[i] * 255));
  hy.byte(rec.y).int(Math.round(4 * rec.area)).int(Math.round(4 * rec.full));
  for (i = 0; i < HW; i++) hy.byte(Math.round(cov[i] * 255)).byte(rec.id[i] + 1).int(Math.round(1000 * rec.depth[i])).int(Math.round(1000 * rec.range[i]));
  return { hx: hx.hex(), hy: hy.hex() };
};
L.cfgHash = function (pipe) { return L.hash64(JSON.stringify(pipe)); };

/* ───────────────────────────── the generator: what the factory runs ───────────────────────────── */
function aeGain(rad, cfg) {                                   // the gain the camera's auto-exposure chose (the exposure metadata every frame carries)
  if (!cfg.ae) return 1;
  var s = 0, n = rad.length, i;
  for (i = 0; i < n; i++) s += rad[i];
  var ml = cfg.ev * s / n / cfg.fw;
  return Math.min(cfg.ae.maxGain, Math.max(1, cfg.ae.target / Math.max(ml, 1e-9)));
}
/* run fn with the renderer's camera patched (a fault in the renderer only); the declared camera, DECL, is never touched */
function withCam(patch, fn) {
  var keep = { f: CAM.f, V0: CAM.V0 };
  if (patch) { if (patch.f !== undefined) CAM.f = patch.f; if (patch.V0 !== undefined) CAM.V0 = patch.V0; }
  try { return fn(); } finally { CAM.f = keep.f; CAM.V0 = keep.V0; }
}
/* seeds: {scene, look, sensor} (SV.sample uses one number for all three; siblings share the scene seed and differ in the other two) */
L.make = function (pipe, seeds, o) {
  o = o || {};
  var rs = SV.stream(seeds.scene, 'scene'), rl = SV.stream(seeds.look, 'look'), rn = SV.stream(seeds.sensor, 'sensor');
  var scene = SV.drawScene(pipe.scene, rs, o.want), look = SV.drawLook(pipe.look, scene, rl);
  return withCam(o.cam, function () {
    var ren = SV.render(scene, look), x = SV.sense(ren.rad, pipe.sensor, rn), lab = SV.labels(ren.cov, pipe.label, scene, look);
    return { x: x, cov: ren.cov, depth: ren.depth, range: ren.range, id: ren.id, y: lab.present, area: lab.area, full: lab.full, gain: aeGain(ren.rad, pipe.sensor),
             pedId: scene.ped ? scene.ped.id : -1, seeds: { scene: seeds.scene, look: seeds.look, sensor: seeds.sensor } };
  });
};
L.seedsOf = function (s) { return { scene: s, look: s, sensor: s }; };
/* a program by its four letters (scene, look, sensor, label; a = the naive program, b = the street's setting) */
L.program = function (code) { var p = {}; ['scene', 'look', 'sensor', 'label'].forEach(function (k, i) { p[k] = code.charAt(i); }); return SV.hybrid(SV.SIM0, SV.REAL, p); };

/* ───────────────────────────── the manifest ───────────────────────────── */
/* a row: the three seeds, the split, the checksum of the pixels, the checksum of the labels, and one bit: is there a pedestrian in the scene.  The run header holds the config hash, the code version and a golden digest. */
L.ROW_BYTES = 3 * 4 + 8 + 8 + 1;
L.row = function (rec, split) { var d = L.digest(rec); return { s: [rec.seeds.scene, rec.seeds.look, rec.seeds.sensor], split: split, hx: d.hx, hy: d.hy, ped: rec.full > 0 ? 1 : 0 }; };
L.golden = function (pipe) { return L.digest(L.make(pipe, L.seedsOf(1))).hx; };            // a fingerprint of the generator: the digest of one fixed frame
L.manifest = function (pipe, split, recs) { return { head: { code: L.VERSION, cfg: L.cfgHash(pipe), golden: L.golden(pipe), n: recs.length }, rows: recs.map(function (r) { return L.row(r, split); }) }; };
/* integrity: re-hash the stored frames and compare with the manifest (no render) */
L.integrity = function (rows, recs) {
  var bad = [], i, d;
  for (i = 0; i < rows.length; i++) { d = L.digest(recs[i]); if (d.hx !== rows[i].hx || d.hy !== rows[i].hy) bad.push(i); }
  return bad;
};
/* replay: re-render k rows chosen at random from (config, seeds) with the code as it is now, and compare with the manifest.  gen(seeds) is the code under audit. */
L.replay = function (rows, gen, k, rng) {
  var bad = [], seen = {}, n = rows.length, j, i, d;
  for (j = 0; j < Math.min(k, n); j++) {
    do { i = Math.floor(rng() * n); } while (seen[i]);
    seen[i] = 1;
    d = L.digest(gen({ scene: rows[i].s[0], look: rows[i].s[1], sensor: rows[i].s[2] }));
    if (d.hx !== rows[i].hx || d.hy !== rows[i].hy) bad.push(i);
  }
  return bad;
};


/* ───────────────────────────── the invariants: the contract as code ───────────────────────────── */
/* Each invariant is a pure function of one frame record and the DECLARED program (the pipeline config the factory says it runs); it returns {fail, v, tol}: the statistic, its tolerance, and
 * whether the statistic is outside it.  The tolerance comes from the lab's own numerics (float32 spacing, the integer label rule, the sampling law of a variance, the point-spread function) and never
 * from a bug: see the notes beside each constant. */
L.SKY = { blue: { H: [0.62, 0.75, 0.95], Z: [0.25, 0.45, 0.9] }, grey: { H: [0.6, 0.62, 0.65], Z: [0.5, 0.52, 0.56] }, warm: { H: [0.95, 0.65, 0.4], Z: [0.45, 0.4, 0.6] } };   // the sky palettes the look stage may draw
L.TOL = {
  f32: 1e-6,          // relative: float32 has 2^-23 = 1.2e-7 of spacing; depth and range are products of a few float32 values
  grid: 1e-3,         // DN x 255 must sit this close to an integer (8-bit grid; float32 rounding of k/255 is 1.5e-5)
  minRow: 2,          // centre-ray pixels in a row: where the silhouette is narrower than this the two samplings can differ by two pixels
  sky: 0.06,          // chromaticity distance: the point-spread function lets <= ~11% of the wall into the top row, a palette-to-grey distance of <= 0.2 -> 0.02, plus noise
  level: 0.02,        // relative: exposure control sets the mean linear level to the target; zero-clipping of noise on dark pixels biases it by < 1%
  eMin: 20,           // electrons: below this the zero-clipping of the noise biases the variance
  z: 8                // sigmas for the variance ratio of a flat patch
};
function declSky(decl) { return decl.look && decl.look.sky === 'blue' ? ['blue'] : ['blue', 'grey', 'warm']; }

function invPixels(rec) {
  var x = rec.x, n = x.length, mn = 2, mx = -1, bad = 0, i, v, g;
  for (i = 0; i < n; i++) {
    v = x[i];
    if (!(v >= 0 && v <= 1)) { bad++; continue; }
    g = v * 255; if (Math.abs(g - Math.round(g)) > L.TOL.grid) bad++;
    if (v < mn) mn = v; if (v > mx) mx = v;
  }
  var spread = mx - mn;
  return { fail: bad > 0 || !(spread >= 1 / 255), v: bad > 0 ? bad : spread, tol: 1 / 255 };
}
function invGround(rec) {                          // the ground-plane law z = f hc / (v + 1/2 - V0) on every ground pixel, and no sky at or below the horizon
  var D = DECL, id = rec.id, dp = rec.depth, worst = 0, v, u, q, pred, e, bad = 0;
  for (v = 0; v < H; v++) for (u = 0; u < W; u++) {
    q = v * W + u;
    if (id[q] !== -1) continue;
    if (dp[q] > 0) { pred = D.f * D.hc / (v + 0.5 - D.V0); e = pred > 0 ? Math.abs(dp[q] - pred) / pred : 1; if (e > worst) worst = e; if (!(e <= L.TOL.f32)) bad++; }
    else if (v + 0.5 > D.V0) { bad++; worst = Math.max(worst, 1); }
  }
  return { fail: bad > 0, v: worst, tol: L.TOL.f32 };
}
function invRange(rec) {                           // range = depth sqrt(1 + tan^2 phi + rho^2) on every pixel that hit something
  var D = DECL, dp = rec.depth, rg = rec.range, worst = 0, v, u, q, tp, rho, pred, e;
  for (v = 0; v < H; v++) {
    rho = (D.V0 - v - 0.5) / D.f;
    for (u = 0; u < W; u++) {
      q = v * W + u; if (!(dp[q] > 0)) continue;
      tp = (u + 0.5 - D.u0) / D.f; pred = dp[q] * Math.sqrt(1 + tp * tp + rho * rho); e = Math.abs(rg[q] - pred) / pred; if (e > worst) worst = e;
    }
  }
  return { fail: !(worst <= L.TOL.f32), v: worst, tol: L.TOL.f32 };
}
function invLabel(rec, decl) {                     // the label rule applied to the mask's own area; the visible area cannot exceed the silhouette
  var cov = rec.cov, a = 0, i, lab = decl.label || {}, need = lab.kvis || 0;
  for (i = 0; i < HW; i++) a += cov[i];
  if (rec.full > 0 && lab.rel) need = Math.max(need, lab.rel * rec.full);
  var want = a >= need && a > 0 ? 1 : 0, bad = (Math.abs(a - rec.area) > 1e-6 ? 1 : 0) + (want !== rec.y ? 1 : 0) + (rec.area > rec.full + 1e-6 ? 1 : 0);
  return { fail: bad > 0, v: bad, tol: 0 };
}
function invMask(rec) {                            // the coverage mask (4 rays per pixel) and the instance map (1 ray per pixel) sample one silhouette: where it is two pixels wide, each lies within a pixel of the other
  var cov = rec.cov, id = rec.id, ped = rec.pedId, v, u, q, i, j, pm = new Uint8Array(HW), rowP = new Int32Array(H), bad = 0, used = 0;
  if (ped < 0) { for (q = 0; q < HW; q++) if (cov[q] > 0) return { fail: true, v: 1, tol: 0 }; return { fail: false, v: 0, tol: 0 }; }
  for (v = 0; v < H; v++) for (u = 0; u < W; u++) { q = v * W + u; if (id[q] === ped) { pm[q] = 1; rowP[v]++; } }
  for (v = 0; v < H; v++) {
    if (rowP[v] < L.TOL.minRow) continue;                                            // a row where the silhouette is one pixel wide (the head, a sliver beside the van) can differ by two pixels
    used++;
    for (u = 0; u < W; u++) {
      q = v * W + u;
      if (pm[q] && !(cov[q] > 0)) bad++;                                              // a centre-ray pixel with no coverage
      if (cov[q] > 0) {
        var near = 0;
        for (i = Math.max(0, v - 1); i <= Math.min(H - 1, v + 1) && !near; i++) for (j = Math.max(0, u - 1); j <= Math.min(W - 1, u + 1); j++) if (pm[i * W + j]) { near = 1; break; }
        if (!near) bad++;                                                              // coverage more than a pixel from every centre-ray pixel
      }
    }
  }
  return { fail: bad > 0, v: bad, tol: 0, used: used };
}
function invGain(rec, decl) {                      // the logged gain is inside [1, maxGain] and the mean linear level is what that gain was chosen to give
  var s = decl.sensor, x = rec.x, n = x.length, i, m = 0, ratio, band, v;
  if (!s.ae) return { fail: rec.gain !== 1, v: rec.gain, tol: 1 };
  if (!(rec.gain >= 1 - 1e-9 && rec.gain <= s.ae.maxGain + 1e-9)) return { fail: true, v: rec.gain, tol: s.ae.maxGain };
  for (i = 0; i < n; i++) m += Math.pow(x[i], s.gamma);
  ratio = m / n / s.ae.target;
  if (rec.gain >= s.ae.maxGain - 1e-9) v = Math.max(0, ratio - 1); else if (rec.gain <= 1 + 1e-9) v = Math.max(0, 1 - ratio); else v = Math.abs(ratio - 1);
  return { fail: v > L.TOL.level, v: v, tol: L.TOL.level };
}
function invSky(rec, decl) {                       // the sky is one of the declared palettes at the row's elevation (up to the point-spread function)
  var s = decl.sensor, g = s.gamma, id = rec.id, dp = rec.depth, x = rec.x, pal = declSky(decl), best = Infinity, v, u, q, k, c, nr = 0;
  var rows = [];
  for (v = 0; v < H; v++) {
    var cnt = 0, R = 0, G = 0, B = 0;
    for (u = 0; u < W; u++) { q = v * W + u; if (id[q] === -1 && !(dp[q] > 0)) { cnt++; R += Math.pow(x[q], g); G += Math.pow(x[HW + q], g); B += Math.pow(x[2 * HW + q], g); } }
    if (cnt >= 8) { var t = R + G + B; rows.push({ v: v, w: cnt, r: R / t, g: G / t }); nr += cnt; }
  }
  if (!rows.length) return { fail: false, v: 0, tol: L.TOL.sky };
  pal.forEach(function (name) {
    var P = L.SKY[name], tot = 0;
    rows.forEach(function (rw) {
      var el = Math.min(1, Math.max(0, 6 * (DECL.V0 - rw.v - 0.5) / DECL.f)), r0 = 0, g0 = 0, b0 = 0, t0;
      r0 = P.H[0] * (1 - el) + P.Z[0] * el; g0 = P.H[1] * (1 - el) + P.Z[1] * el; b0 = P.H[2] * (1 - el) + P.Z[2] * el; t0 = r0 + g0 + b0;
      tot += rw.w * Math.hypot(rw.r - r0 / t0, rw.g - g0 / t0);
    });
    if (tot / nr < best) best = tot / nr;
  });
  return { fail: best > L.TOL.sky, v: best, tol: L.TOL.sky };
}
function invNoise(rec, decl) {                     // noise law on a flat patch (the road): var(DN) of neighbouring pixels = the sensor law at the patch's own level
  var s = decl.sensor, x = rec.x, id = rec.id, dp = rec.depth, gnd = new Uint8Array(HW), G = new Uint8Array(HW), v, u, q, a, b, ok, c;
  for (q = 0; q < HW; q++) gnd[q] = id[q] === -1 && dp[q] > 0 ? 1 : 0;
  for (v = 2; v < H - 2; v++) for (u = 2; u < W - 2; u++) {
    ok = 1;
    for (a = -2; a <= 2 && ok; a++) for (b = -2; b <= 2; b++) if (!gnd[(v + a) * W + u + b]) { ok = 0; break; }
    G[v * W + u] = ok;
  }
  var numer = 0, nTot = 0, nz = 0, nAll = 0;
  for (c = 0; c < 3; c++) {
    var o = c * HW, n = 0, mean = 0, nm = 0, d, ds = [];
    for (v = 2; v < H - 2; v++) for (u = 2; u < W - 3; u++) {
      q = v * W + u;
      if (G[q]) { mean += x[o + q]; nm++; }
      if (G[q] && G[q + 1] && (u & 1) === 0) { d = x[o + q + 1] - x[o + q]; ds.push(d); }          // disjoint pairs: independent differences
    }
    if (ds.length < 20) continue;
    if (s.ideal) { ds.forEach(function (e) { nAll++; if (e !== 0) nz++; }); continue; }
    mean /= nm;
    var qb = Math.pow(mean, s.gamma), e = s.fw * qb / rec.gain;
    if (e < L.TOL.eMin) continue;
    var slope = mean / (s.gamma * qb), vq = Math.pow(rec.gain / s.fw, 2) * (e + s.read * s.read), pred = slope * slope * vq + 1 / (12 * 255 * 255), clip = 25 * 2 * pred, sd2 = 0;
    ds.forEach(function (e2) { if (e2 * e2 <= clip) { sd2 += e2 * e2; n++; } });                     // a sub-pixel pole between the centre rays is an outlier, not noise: clip at 5 sigma
    numer += n * (sd2 / (2 * n) / pred); nTot += n;
  }
  if (s.ideal) return { fail: nAll >= 20 && nz / nAll > 0.1, v: nAll ? nz / nAll : 0, tol: 0.1, numer: 0, n: 0 };
  if (nTot < 60) return { fail: false, v: 1, tol: 0, numer: 0, n: 0 };
  var ratio = numer / nTot, tolr = L.TOL.z * Math.sqrt(2 / nTot);
  return { fail: Math.abs(ratio - 1) > tolr, v: ratio, tol: tolr, numer: numer, n: nTot };
}
/* the same law pooled over a batch: the sampling noise of the variance ratio falls as 1/sqrt(n), so the tolerance can be a few per cent: the law itself is good to 3% (quantisation of the DN grid), plus 6 sigma of the pooled sample */
L.POOL_BIAS = 0.03;
L.noisePool = function (recs, decl) {
  var num = 0, n = 0, i, r;
  for (i = 0; i < recs.length; i++) { r = invNoise(recs[i], decl); num += r.numer || 0; n += r.n || 0; }
  if (n < 1000) return { fail: false, v: 1, tol: 0, n: n };
  var tol = L.POOL_BIAS + L.TOL.z * Math.sqrt(2 / n), ratio = num / n;
  return { fail: Math.abs(ratio - 1) > tol, v: ratio, tol: tol, n: n };
};
L.INV = [
  { id: 'pixels', run: invPixels }, { id: 'ground', run: invGround }, { id: 'range', run: invRange }, { id: 'label', run: invLabel },
  { id: 'mask', run: invMask }, { id: 'gain', run: invGain }, { id: 'sky', run: invSky }, { id: 'noise', run: invNoise }
];
/* run every per-frame invariant on a record: the ids that failed */
L.check = function (rec, decl) { var out = []; L.INV.forEach(function (I) { if (I.run(rec, decl).fail) out.push(I.id); }); return out; };
L.stats = function (rec, decl) { var o = {}; L.INV.forEach(function (I) { o[I.id] = I.run(rec, decl); }); return o; };
L.declOf = function (pipe) { return { scene: pipe.scene, look: pipe.look, sensor: pipe.sensor, label: pipe.label }; };


/* ───────────────────────────── the batch checks: a binomial interval and two joins on the manifest ───────────────────────────── */
/* dup: no two rows with the same pair of checksums, the same record twice (any split; the pixel checksum alone also collides for two scenes a noise-free program draws alike); lineage: no scene seed in two splits; rate: the number of rows with a pedestrian lies in the 5-sigma binomial interval of the declared pPed */
L.RATE_Z = 5;
L.batch = function (rows, decl) {
  var seen = {}, scene = {}, dup = 0, mix = 0, ped = 0, i, r, n = rows.length, p = decl.scene.pPed, sd = Math.sqrt(n * p * (1 - p));
  for (i = 0; i < n; i++) {
    r = rows[i];
    if (seen[r.hx + r.hy]) dup++; else seen[r.hx + r.hy] = 1;
    if (scene[r.s[0]] !== undefined && scene[r.s[0]] !== r.split) mix++; else if (scene[r.s[0]] === undefined) scene[r.s[0]] = r.split;
    ped += r.ped;
  }
  var lo = n * p - L.RATE_Z * sd, hi = n * p + L.RATE_Z * sd;
  return { dup: dup, lineage: mix, ped: ped, lo: lo, hi: hi, rate: ped < lo || ped > hi, fail: { dup: dup > 0, lineage: mix > 0, rate: ped < lo || ped > hi } };
};

/* ───────────────────────────── the bench: faults injected into the factory ───────────────────────────── */
function cp(a) { return new Float32Array(a); }
function labelsOf(r) { return { cov: r.cov, depth: r.depth, range: r.range, id: r.id, y: r.y, area: r.area, full: r.full, pedId: r.pedId }; }
function withRec(rec, over) { var o = {}, k; for (k in rec) o[k] = rec[k]; for (k in over) o[k] = over[k]; return o; }
function flipX(x) { var o = new Float32Array(x.length), c, v, u; for (c = 0; c < 3; c++) for (v = 0; v < H; v++) for (u = 0; u < W; u++) o[c * HW + v * W + u] = x[c * HW + v * W + W - 1 - u]; return o; }
function flipY(a, planes) { var o = new a.constructor(a.length), c, v, u; for (c = 0; c < planes; c++) for (v = 0; v < H; v++) for (u = 0; u < W; u++) o[c * HW + v * W + u] = a[c * HW + (H - 1 - v) * W + u]; return o; }
function swapRB(x) { var o = cp(x); o.set(x.subarray(2 * HW, 3 * HW), 0); o.set(x.subarray(0, HW), 2 * HW); return o; }
function shiftMap(a, du, dv) { var o = new a.constructor(a.length), v, u, us, vs; for (v = 0; v < H; v++) for (u = 0; u < W; u++) { us = u - du; vs = v - dv; o[v * W + u] = us >= 0 && us < W && vs >= 0 && vs < H ? a[vs * W + us] : 0; } return o; }
function relabel(rec, kvis, rel) { var need = Math.max(kvis, rec.full > 0 ? rel * rec.full : 0); return rec.area >= need && rec.area > 0 ? 1 : 0; }
function pipeWith(pipe, f) { var q = SV.clone(pipe); f(q); return q; }
var PIPE_FAULT = { read: function (q) { q.sensor.read = 0; }, pped: function (q) { q.scene.pPed = 0.35; }, drift: function (q) { q.sensor.blur = 0.72; }, palette: function (q) { q.look.pedPalette = 'bright'; } };

/* each fault: id, a name, the fraction f of a run's frames it touches, where it acts, and (for a fault in the data path or the generator) gen(pipe, seeds) -> the record the factory writes.
 * where: 'gen' = deterministic, inside the generator (the manifest hashes what was written, so integrity and replay both pass); 'drift' = the code changed after the manifest was written;
 * 'nondet' = the generator is not a function of its seeds for a fraction of frames; 'store' = the stored frames are altered after the manifest was written; 'split' = test rows reuse training seeds;
 * 'stale' = a buffer that is not refilled repeats the previous frame. */
L.FAULTS = [
  { id: 'upside', name: 'frame written upside down', f: 0.25, where: 'gen', gen: function (pipe, sd) { var r = L.make(pipe, sd); return withRec(r, { x: flipY(r.x, 3), cov: flipY(r.cov, 1), depth: flipY(r.depth, 1), range: flipY(r.range, 1), id: flipY(r.id, 1) }); } },
  { id: 'flip',   name: 'image mirrored, mask not', f: 0.5, where: 'gen',   gen: function (pipe, sd) { var r = L.make(pipe, sd); return withRec(r, { x: flipX(r.x) }); } },
  { id: 'swap',   name: 'red and blue swapped', f: 1, where: 'gen',   gen: function (pipe, sd) { var r = L.make(pipe, sd); return withRec(r, { x: swapRB(r.x) }); } },
  { id: 'gamma2', name: 'gamma applied twice', f: 0.1, where: 'gen',   gen: function (pipe, sd) { var r = L.make(pipe, sd), g = pipe.sensor.gamma, x = cp(r.x), i; for (i = 0; i < x.length; i++) x[i] = Math.round(Math.pow(x[i], 1 / g) * 255) / 255; return withRec(r, { x: x }); } },
  { id: 'depth',  name: 'depth pass holds range', f: 1, where: 'gen',   gen: function (pipe, sd) { var r = L.make(pipe, sd); return withRec(r, { depth: cp(r.range) }); } },
  { id: 'focal',  name: 'focal length 8% off in the renderer only', f: 1, where: 'gen',   gen: function (pipe, sd) { return L.make(pipe, sd, { cam: { f: 1.08 * DECL.f } }); } },
  { id: 'mask',   name: 'mask shifted one pixel right', f: 1, where: 'gen',   gen: function (pipe, sd) { var r = L.make(pipe, sd); return withRec(r, { cov: shiftMap(r.cov, 1, 0) }); } },
  { id: 'thresh', name: 'visibility threshold 4 px\u00b2 instead of 1', f: 1, where: 'gen',   gen: function (pipe, sd) { var r = L.make(pipe, sd), lab = pipe.label; return withRec(r, { y: relabel(r, 4 * (lab.kvis || 1), lab.rel || 0) }); } },
  { id: 'centre', name: 'pixel centres at +0, not +1/2', f: 1, where: 'gen',   gen: function (pipe, sd) { return L.make(pipe, sd, { cam: { V0: DECL.V0 + 0.5 } }); } },
  { id: 'read',   name: 'read noise missing in one batch', f: 0.1, where: 'gen',   gen: function (pipe, sd) { return L.make(pipeWith(pipe, PIPE_FAULT.read), sd); } },
  { id: 'pped',   name: 'pedestrian probability 0.35, not 0.5', f: 1, where: 'gen',   gen: function (pipe, sd) { return L.make(pipeWith(pipe, PIPE_FAULT.pped), sd); } },
  { id: 'palette', name: 'clothes palette hard-coded to the bright one', f: 1, where: 'gen',   gen: function (pipe, sd) { return L.make(pipeWith(pipe, PIPE_FAULT.palette), sd); } },
  { id: 'seeds',  name: 'test frames reuse training seeds', f: 0.3, where: 'split' },
  { id: 'stale',  name: 'stale cache repeats a frame', f: 0.05, where: 'stale' },
  { id: 'rows',   name: 'labels of one batch listed in reverse order', f: 0.1, where: 'store' },
  { id: 'drift',  name: 'dependency drift after the manifest', f: 1, where: 'drift' },
  { id: 'nondet', name: 'noise stream unseeded in 10% of frames', f: 0.1, where: 'nondet', gen: function (pipe, sd) { return L.make(pipe, { scene: sd.scene, look: sd.look, sensor: sd.sensor + 7777777 }); } }
];
L.faultById = function (id) { for (var i = 0; i < L.FAULTS.length; i++) if (L.FAULTS[i].id === id) return L.FAULTS[i]; return null; };
L.codeNow = function (pipe, fault) { return fault && fault.where === 'drift' ? pipeWith(pipe, PIPE_FAULT.drift) : pipe; };       // the pipeline the replay audit runs: the same unless the code drifted

/* a run of n frames (80% train, 20% test) as the factory writes it with the fault present: the manifest rows as written, the frames as stored, and which frames the fault touched.
 * affected(i): a shard (contiguous 10%) for faults of one batch, otherwise a Bernoulli(f) draw per frame from a stream of its own. */
L.run = function (pipe, n, seed0, fid) {
  var F = fid ? L.faultById(fid) : null, rows = [], recs = [], hit = [], i, nTrain = Math.round(0.8 * n), prev = null, sd, rec, split, u, aff;
  var shard = F && (F.id === 'read' || F.id === 'rows');
  for (i = 0; i < n; i++) {
    sd = L.seedsOf(seed0 + i); split = i < nTrain ? 'train' : 'test'; u = SV.stream(seed0 + i, 'fault')(); aff = false;
    if (F) aff = shard ? (i >= Math.floor(0.4 * n) && i < Math.floor(0.5 * n)) : u < F.f;
    if (F && aff && F.where === 'split') { if (split === 'test') { var j = Math.floor(SV.stream(seed0 + i, 'pick')() * nTrain); sd = L.seedsOf(seed0 + j); } else aff = false; }
    if (F && aff && (F.where === 'gen' || F.where === 'nondet')) rec = F.gen(pipe, sd);
    else if (F && aff && F.where === 'stale' && prev) rec = prev;
    else { rec = L.make(pipe, sd); if (F && F.where === 'stale') aff = false; }
    if (F && F.where === 'drift') aff = true;
    var row = L.row(rec, split); row.s = [sd.scene, sd.look, sd.sensor];
    rows.push(row); recs.push(rec); hit.push(aff); prev = rec;
  }
  if (F && F.where === 'store') {                                    // after the manifest was written, the label files of one batch are listed in the reverse order of the image files
    var lo = Math.floor(0.4 * n), hi = Math.floor(0.5 * n) - 1, k, old = recs.slice();
    for (k = lo; k <= hi; k++) recs[k] = withRec(old[k], labelsOf(old[lo + hi - k]));
  }
  var run = { rows: rows, recs: recs, hit: hit, fault: F, pipe: pipe, codeNow: L.codeNow(pipe, F) };
  /* the code as it is now, for row i: a deterministic bug in the generator is still there (so a replay reproduces it), a drifted dependency has changed for every row, an unseeded noise stream draws afresh */
  run.regen = function (i) {
    var sd = { scene: rows[i].s[0], look: rows[i].s[1], sensor: rows[i].s[2] };
    if (F && F.where === 'gen' && hit[i]) return F.gen(pipe, sd);
    if (F && F.where === 'nondet' && hit[i]) return L.make(pipe, { scene: sd.scene, look: sd.look, sensor: sd.sensor + 8888888 });
    return L.make(run.codeNow, sd);
  };
  return run;
};
/* the manifest audit of a run: integrity of every stored frame (no render), and the replay of k random rows with the code as it is now */
L.audit = function (run, k, rng) {
  var bad = L.integrity(run.rows, run.recs), rb = [], seen = {}, n = run.rows.length, j, i, d;
  for (j = 0; j < Math.min(k, n); j++) {
    do { i = Math.floor(rng() * n); } while (seen[i]);
    seen[i] = 1; d = L.digest(run.regen(i));
    if (d.hx !== run.rows[i].hx || d.hy !== run.rows[i].hy) rb.push(i);
  }
  return { integrity: bad, replay: rb };
};


/* ───────────────────────────── the canary: a small training run, graded on a fixed handful of street frames ───────────────────────────── */
/* The held-out street frames are labelled once and reused by every run (their cost: nHeld labelled frames, spent once; the frames must never be trained on).  The canary trains the fixed detector on n frames
 * of the run's training split, as stored, and reports the AUC on them. */
L.CANARY = { n: 160, nHeld: 240, held0: 19800000 };
var _held = null;
L.heldOut = function () { return _held || (_held = SV.makeSet(SV.REAL, L.CANARY.nHeld, L.CANARY.held0)); };
function shuffled(n, seed) { var a = [], i, j, t, r = SV.rng(seed); for (i = 0; i < n; i++) a.push(i); for (i = n - 1; i > 0; i--) { j = Math.floor(r() * (i + 1)); t = a[i]; a[i] = a[j]; a[j] = t; } return a; }
L.shuffled = shuffled;
L.scoreAUC = function (model, set) {
  var pos = [], neg = [];
  set.forEach(function (f) { (f.y ? pos : neg).push(SV.score(model, f.x).s); });
  return SV.auc(pos, neg);
};
L.canary = function (recs, nTrain, seed) {
  var pick = shuffled(nTrain, seed * 7919 + 13).slice(0, L.CANARY.n), tr = pick.map(function (i) { return recs[i]; }), model = SV.train(tr, { seed: seed });
  return { auc: L.scoreAUC(model, L.heldOut()), model: model };
};

/* ───────────────────────────── siblings, a memorising learner and the two kinds of split ───────────────────────────── */
/* siblings: one scene seed, several looks and sensor draws: the scene stream is shared, the look and sensor streams are not */
L.sibSeeds = function (sceneSeed, j) { return j === 0 ? L.seedsOf(sceneSeed) : { scene: sceneSeed, look: sceneSeed + 1000003 * j, sensor: sceneSeed + 2000003 * j }; };
L.siblings = function (pipe, nScenes, nSib, seed0) {
  var out = [], s, j;
  for (s = 0; s < nScenes; s++) for (j = 0; j < nSib; j++) out.push({ g: s, j: j, rec: L.make(pipe, L.sibSeeds(seed0 + s, j)) });
  return out;
};
/* the memoriser's fixed feature: for each of the 96 columns the sum over rows of |I(u+1) - I(u-1)| of the luminance (the vertical edges of the scene, whatever its colours), square-rooted, scaled to unit length */
L.feat = function (x) {
  var f = new Float64Array(W), v, u, s, a, b;
  for (v = 0; v < H; v++) for (u = 0; u < W; u++) {
    a = Math.min(W - 1, u + 1); b = Math.max(0, u - 1);
    f[u] += Math.abs((x[v * W + a] + x[HW + v * W + a] + x[2 * HW + v * W + a]) - (x[v * W + b] + x[HW + v * W + b] + x[2 * HW + v * W + b])) / 3;
  }
  for (u = 0, s = 0; u < W; u++) { f[u] = Math.sqrt(f[u]); s += f[u] * f[u]; }
  s = Math.sqrt(s) || 1; for (u = 0; u < W; u++) f[u] /= s;
  return f;
};
/* k nearest neighbours by cosine similarity: the score of a test item is the share of its k neighbours that are positive (ties broken by index) */
L.knn = function (train, test, k) {
  return test.map(function (t) {
    var sims = train.map(function (r, i) { var d = 0, q; for (q = 0; q < W; q++) d += t.f[q] * r.f[q]; return [d, i]; });
    sims.sort(function (p, q) { return q[0] - p[0] || p[1] - q[1]; });
    var pos = 0, i; for (i = 0; i < k; i++) pos += train[sims[i][1]].y;
    return pos / k;
  });
};
/* a split of items {g: group} into 80% train / 20% test: by frame (random) or by group (lineage: all siblings of a scene go to the same side) */
L.split = function (items, kind, seed) {
  var n = items.length, tr = [], te = [], groups = {}, ids = [], i;
  if (kind === 'random') { var p = shuffled(n, seed), cut = Math.round(0.8 * n); for (i = 0; i < n; i++) (i < cut ? tr : te).push(p[i]); return { train: tr, test: te }; }
  for (i = 0; i < n; i++) if (groups[items[i].g] === undefined) { groups[items[i].g] = ids.length; ids.push(items[i].g); }
  var q = shuffled(ids.length, seed), rank = new Array(ids.length), cutg = Math.round(0.8 * ids.length);
  for (i = 0; i < q.length; i++) rank[q[i]] = i;
  for (i = 0; i < n; i++) (rank[groups[items[i].g]] < cutg ? tr : te).push(i);
  return { train: tr, test: te };
};
L.LEARNERS = ['1nn', '10nn', 'detector'];
/* the held-out AUC of one learner on one split of the siblings */
L.leakAUC = function (items, sp, learner, seed) {
  var tr = sp.train.map(function (i) { return items[i]; }), te = sp.test.map(function (i) { return items[i]; }), sc, pos = [], neg = [];
  if (learner === 'detector') {
    var model = SV.train(tr.map(function (t) { return t.rec; }), { seed: seed });
    sc = te.map(function (t) { return SV.score(model, t.rec.x).s; });
  } else {
    sc = L.knn(tr.map(function (t) { return { f: t.f, y: t.rec.y }; }), te.map(function (t) { return { f: t.f }; }), learner === '1nn' ? 1 : 10);
  }
  te.forEach(function (t, i) { (t.rec.y ? pos : neg).push(sc[i]); });
  return SV.auc(pos, neg);
};
L.withFeat = function (items) { items.forEach(function (t) { if (!t.f) t.f = L.feat(t.rec.x); }); return items; };

if (typeof module !== 'undefined' && module.exports) module.exports = L;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
