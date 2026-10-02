/* l10_speed.js — lesson 10, "Speed: grids, hashes and Gaussian splats".  A private engine on top of flatland.js: the sparse-field half of the lesson.
 *
 *   H10.maskField(F)            give a shared-engine FL.vol.Field an occupancy mask: F.mask (cells of the node grid, Uint8Array or null) and F.early
 *                               (stop a ray once its transmittance is below this) make the ray skip samples; F.work counts the samples it really evaluated.
 *                               With no mask and early = 0 it is the shared engine's Field.ray bit for bit (the jitter stream is consumed identically).
 *   H10.occupancy(dens, box, N, tau)   N x N cells over the box; a cell is occupied when the densest of its corners and centre exceeds tau (per metre)
 *   H10.hash(i, j, T)           the Instant-NGP hash in two dimensions, h = (i * 1  xor  j * 2654435761) mod T, in 32-bit unsigned arithmetic
 *   H10.HashField(o)            a multiresolution hashed feature grid with a tiny decoder (the 2-D analogue of Instant-NGP's encoding):
 *                                 level l has res[l] cells per side and (res[l]+1)^2 nodes; when that does not exceed T the level is indexed 1:1, otherwise the node
 *                                 index is hashed into a table of T entries; every entry holds F features; a point's features are bilinear in the four corners of its cell,
 *                                 concatenated over the levels, and a one-hidden-layer ReLU network turns them into (raw density, raw r, g, b).
 *                               methods: ray, step(views, {lr, seed}), renderCam(cam), density(x, z), nParams
 *   H10.fieldDensity(F), H10.hashNodes(F, T), H10.nodesOfCells(cells, N)   the density of a grid field at a point; a field whose node ids go through the hash; the nodes the given cells touch
 *   L10.*                       the splat lab of the widget (second half of this file): the statue exam, surface-initialised Gaussians, training with density control,
 *                               and L10.draw(canvas, run, heldOutIndex), the widget's picture.
 * Conventions as flatland.js: x right, z up, metres; deterministic (seeded generators only); jittered samples as FL.vol.Field.step({jitter: true}).
 */
(function (root) {
'use strict';
var FL = root.FL || (typeof require === 'function' ? require('./flatland.js') : null);
var H10 = {};
var softplus = FL.vol.softplus, sigmoid = FL.vol.sigmoid;

/* ── occupancy ── */
H10.occupancy = function (dens, box, N, tau) {
  var m = new Uint8Array(N * N), k = 0, h = (box[1] - box[0]) / N, i, j, c, d, q, offs = [[0.5, 0.5], [0, 0], [1, 0], [0, 1], [1, 1]];
  for (j = 0; j < N; j++) for (i = 0; i < N; i++) {
    d = 0;
    for (q = 0; q < 5; q++) { c = dens(box[0] + (i + offs[q][0]) * h, box[2] + (j + offs[q][1]) * h); if (c > d) d = c; }
    if (d > tau) { m[j * N + i] = 1; k++; }
  }
  m.count = k; m.N = N; m.box = box;
  return m;
};
H10.maskAt = function (m, x, z) {
  var N = m.N, b = m.box, i = Math.floor((x - b[0]) / (b[1] - b[0]) * N), j = Math.floor((z - b[2]) / (b[3] - b[2]) * N);
  if (i < 0) i = 0; if (j < 0) j = 0; if (i > N - 1) i = N - 1; if (j > N - 1) j = N - 1;
  return m[j * N + i] === 1;
};
/* the density of a grid field at a point: bilinear in the raw values of the four corner nodes (through its own stencil, hashed or not), then softplus */
H10.fieldDensity = function (F) {
  var idx = new Int32Array(4), wt = new Float64Array(4);
  return function (x, z) {
    F._stencil(x, z, 0, idx, wt);
    return softplus(wt[0] * F.s[idx[0]] + wt[1] * F.s[idx[1]] + wt[2] * F.s[idx[2]] + wt[3] * F.s[idx[3]]);
  };
};
/* a single-level hashed grid with one value per slot: the shared Field whose node ids are sent through the hash into T slots (T >= nodes: no hashing) */
H10.hashNodes = function (F, T) {
  var nx = F.nx, nz = F.nz, slot = new Int32Array(nx * nz), i, j, base = Object.getPrototypeOf(F)._stencil;
  for (j = 0; j < nz; j++) for (i = 0; i < nx; i++) slot[j * nx + i] = T >= nx * nz ? j * nx + i : H10.hash(i, j, T);
  F._stencil = function (x, z, m, idx, wt) { base.call(this, x, z, m, idx, wt); for (var k = 0; k < 4; k++) idx[4 * m + k] = slot[idx[4 * m + k]]; };
  F.slot = slot; F.T = T;
  return F;
};

/* ── a shared-engine field whose ray skips what is empty ── */
H10.maskField = function (F) {
  F.mask = null; F.early = 0; F.work = 0;
  F.ray = function (ox, oz, dx, dz, rng, gt, wgt) {
    var hit = FL.vol.rayBox(ox, oz, dx, dz, this.x0, this.x1, this.z0, this.z1), bgc = this.bg;
    if (!hit) return gt ? { C: bgc, err: (bgc[0] - gt[0]) * (bgc[0] - gt[0]) + (bgc[1] - gt[1]) * (bgc[1] - gt[1]) + (bgc[2] - gt[2]) * (bgc[2] - gt[2]) } : { C: bgc };
    var n = this.nsamp, t0 = hit[0], dt = (hit[1] - hit[0]) / n, m, k, T = 1;
    var sig = new Float64Array(n), col = new Array(n), delta = new Float64Array(n), sraw = new Float64Array(n), idx = new Int32Array(4 * n), wt = new Float64Array(4 * n), used = new Uint8Array(n);
    for (m = 0; m < n; m++) {
      var u = rng ? rng() : 0.5;                                    // one draw per sample, skipped or not: the stream is the engine's
      delta[m] = dt; col[m] = [0, 0, 0];
      if (this.early && T < this.early) continue;
      var t = t0 + (m + u) * dt, x = ox + dx * t, z = oz + dz * t;
      if (this.mask && !H10.maskAt(this.mask, x, z)) continue;
      this._stencil(x, z, m, idx, wt);
      var s = 0, r = 0, g = 0, b = 0, q = m * 4;
      for (k = 0; k < 4; k++) { var id = idx[q + k], w = wt[q + k]; s += w * this.s[id]; r += w * this.c[3 * id]; g += w * this.c[3 * id + 1]; b += w * this.c[3 * id + 2]; }
      sraw[m] = s; sig[m] = softplus(s); col[m] = [sigmoid(r), sigmoid(g), sigmoid(b)]; used[m] = 1; this.work++;
      T *= Math.exp(-sig[m] * dt);
    }
    var f = FL.vol.composite(sig, col, delta, this.bg);
    if (!gt) return { C: f.C, w: f.w, Ts: f.Ts, used: used };
    var e0 = f.C[0] - gt[0], e1 = f.C[1] - gt[1], e2 = f.C[2] - gt[2];
    var gr = FL.vol.compositeGrad(sig, col, delta, this.bg, [2 * e0 * wgt, 2 * e1 * wgt, 2 * e2 * wgt], f);
    for (m = 0; m < n; m++) {
      if (!used[m]) continue;
      var ds = gr.dsig[m] * sigmoid(sraw[m]), c = col[m], qq = m * 4;
      var d0 = gr.dcol[m][0] * c[0] * (1 - c[0]), d1 = gr.dcol[m][1] * c[1] * (1 - c[1]), d2 = gr.dcol[m][2] * c[2] * (1 - c[2]);
      for (k = 0; k < 4; k++) { var ii = idx[qq + k], ww = wt[qq + k]; this.gS[ii] += ww * ds; this.gC[3 * ii] += ww * d0; this.gC[3 * ii + 1] += ww * d1; this.gC[3 * ii + 2] += ww * d2; }
    }
    return { C: f.C, err: e0 * e0 + e1 * e1 + e2 * e2 };
  };
  return F;
};

/* ── the Instant-NGP hash, in two dimensions ── */
H10.hash = function (i, j, T) { return (((i * 1) ^ Math.imul(j, 2654435761)) >>> 0) % T; };

H10.HashField = function (o) {
  var L = o.res.length, l;
  this.x0 = o.x0; this.x1 = o.x1; this.z0 = o.z0; this.z1 = o.z1; this.res = o.res; this.L = L; this.F = o.F || 2; this.T = o.T; this.H = o.H || 16;
  this.nsamp = o.nsamp; this.bg = o.bg;
  this.dense = []; this.size = []; this.off = [];
  var acc = 0;
  for (l = 0; l < L; l++) {
    var nodes = (o.res[l] + 1) * (o.res[l] + 1), isDense = nodes <= o.T;
    this.dense.push(isDense); this.size.push(isDense ? nodes : o.T); this.off.push(acc); acc += this.size[l] * this.F;
  }
  this.nTab = acc; this.nIn = L * this.F;
  this.map = [];                                                                  // node -> table slot, per level: the hash evaluated once per node
  for (l = 0; l < L; l++) {
    var Nl = o.res[l], mp = new Int32Array((Nl + 1) * (Nl + 1)), ii, jj;
    for (jj = 0; jj <= Nl; jj++) for (ii = 0; ii <= Nl; ii++) mp[jj * (Nl + 1) + ii] = this.dense[l] ? jj * (Nl + 1) + ii : H10.hash(ii, jj, o.T);
    this.map.push(mp);
  }
  var nW1 = this.H * this.nIn, nb1 = this.H, nW2 = 4 * this.H;
  this.oW1 = acc; this.ob1 = this.oW1 + nW1; this.oW2 = this.ob1 + nb1; this.ob2 = this.oW2 + nW2;
  this.nParams = this.ob2 + 4;
  var n = this.nParams;
  this.p = new Float64Array(n); this.g = new Float64Array(n); this.m = new Float64Array(n); this.v = new Float64Array(n); this.t = 0;
  var rng = FL.rng(o.seed || 11), k;
  for (k = 0; k < this.nTab; k++) this.p[k] = (rng() * 2 - 1) * 1e-4;          // Instant-NGP initialises the tables uniformly in ±1e-4
  var s1 = Math.sqrt(2 / this.nIn), s2 = Math.sqrt(1 / this.H);
  for (k = 0; k < nW1; k++) this.p[this.oW1 + k] = FL.randn(rng) * s1;
  for (k = 0; k < nW2; k++) this.p[this.oW2 + k] = FL.randn(rng) * s2 * 0.5;
  this.p[this.ob2] = o.s0 === undefined ? -5 : o.s0;                              // raw density -5: 0.0067 per metre, as the shared Field starts
  this.mask = null; this.work = 0;
  this.z = new Float64Array(this.nIn); this.h = new Float64Array(this.H); this.out = new Float64Array(4);
  this.sl = new Int32Array(L * 4); this.wt = new Float64Array(L * 4);
  this.bz = new Float64Array(o.nsamp * this.nIn); this.bh = new Float64Array(o.nsamp * this.H); this.bo = new Float64Array(o.nsamp * 4);
  this.bs = new Int32Array(o.nsamp * L * 4); this.bw = new Float64Array(o.nsamp * L * 4);
};
var HF = H10.HashField.prototype;
HF.index = function (l, i, j) { return this.map[l][j * (this.res[l] + 1) + i]; };
/* features of the point (x, zq) at every level: z[zo + l*F + f]; the table slots and bilinear weights are kept in sl/wt (4 per level) from offset so */
HF.encode = function (x, zq, z, zo, sl, wt, so) {
  var F = this.F, P = this.p, l, f;
  for (l = 0; l < this.L; l++) {
    var N = this.res[l], gx = (x - this.x0) / (this.x1 - this.x0) * N, gz = (zq - this.z0) / (this.z1 - this.z0) * N;
    if (gx < 0) gx = 0; if (gz < 0) gz = 0; if (gx > N) gx = N; if (gz > N) gz = N;
    var i0 = Math.min(Math.floor(gx), N - 1), j0 = Math.min(Math.floor(gz), N - 1), fx = gx - i0, fz = gz - j0, q = so + l * 4, base = this.off[l];
    sl[q] = this.index(l, i0, j0); sl[q + 1] = this.index(l, i0 + 1, j0); sl[q + 2] = this.index(l, i0, j0 + 1); sl[q + 3] = this.index(l, i0 + 1, j0 + 1);
    wt[q] = (1 - fx) * (1 - fz); wt[q + 1] = fx * (1 - fz); wt[q + 2] = (1 - fx) * fz; wt[q + 3] = fx * fz;
    for (f = 0; f < F; f++) z[zo + l * F + f] = wt[q] * P[base + sl[q] * F + f] + wt[q + 1] * P[base + sl[q + 1] * F + f] + wt[q + 2] * P[base + sl[q + 2] * F + f] + wt[q + 3] * P[base + sl[q + 3] * F + f];
  }
};
HF.decode = function (z, zo, h, ho, out, oo) {
  var P = this.p, H = this.H, nIn = this.nIn, j, k, mm, a, r;
  for (j = 0; j < H; j++) { a = P[this.ob1 + j]; r = this.oW1 + j * nIn; for (k = 0; k < nIn; k++) a += P[r + k] * z[zo + k]; h[ho + j] = a > 0 ? a : 0; }
  for (mm = 0; mm < 4; mm++) { a = P[this.ob2 + mm]; r = this.oW2 + mm * H; for (j = 0; j < H; j++) a += P[r + j] * h[ho + j]; out[oo + mm] = a; }
};
HF.density = function (x, zq) { this.encode(x, zq, this.z, 0, this.sl, this.wt, 0); this.decode(this.z, 0, this.h, 0, this.out, 0); return softplus(this.out[0]); };
/* march one ray; with gt it also back-propagates (gradients accumulate in this.g).  Same box clipping, jitter and compositing as FL.vol.Field.ray. */
HF.ray = function (ox, oz, dx, dz, rng, gt, wgt) {
  var hit = FL.vol.rayBox(ox, oz, dx, dz, this.x0, this.x1, this.z0, this.z1), bgc = this.bg;
  if (!hit) return gt ? { C: bgc, err: (bgc[0] - gt[0]) * (bgc[0] - gt[0]) + (bgc[1] - gt[1]) * (bgc[1] - gt[1]) + (bgc[2] - gt[2]) * (bgc[2] - gt[2]) } : { C: bgc };
  var n = this.nsamp, t0 = hit[0], dt = (hit[1] - hit[0]) / n, L = this.L, nIn = this.nIn, H = this.H, F = this.F, m, k, l, f, j;
  var sig = new Float64Array(n), col = new Array(n), delta = new Float64Array(n), used = new Uint8Array(n);
  for (m = 0; m < n; m++) {
    var u = rng ? rng() : 0.5;
    delta[m] = dt; col[m] = [0, 0, 0];
    var t = t0 + (m + u) * dt, x = ox + dx * t, z = oz + dz * t;
    if (this.mask && !H10.maskAt(this.mask, x, z)) continue;
    used[m] = 1; this.work++;
    this.encode(x, z, this.bz, m * nIn, this.bs, this.bw, m * L * 4);
    this.decode(this.bz, m * nIn, this.bh, m * H, this.bo, m * 4);
    var oo = m * 4;
    sig[m] = softplus(this.bo[oo]); col[m] = [sigmoid(this.bo[oo + 1]), sigmoid(this.bo[oo + 2]), sigmoid(this.bo[oo + 3])];
  }
  var fw = FL.vol.composite(sig, col, delta, this.bg);
  if (!gt) return { C: fw.C, w: fw.w, Ts: fw.Ts, used: used };
  var e0 = fw.C[0] - gt[0], e1 = fw.C[1] - gt[1], e2 = fw.C[2] - gt[2];
  var gr = FL.vol.compositeGrad(sig, col, delta, this.bg, [2 * e0 * wgt, 2 * e1 * wgt, 2 * e2 * wgt], fw);
  var P = this.p, G = this.g, dzf = new Float64Array(nIn), dh = new Float64Array(H), dout = new Float64Array(4), q, r;
  for (m = 0; m < n; m++) {
    if (!used[m]) continue;
    var zo = m * nIn, hoff = m * H, c = col[m], BZ = this.bz, BH = this.bh;
    dout[0] = gr.dsig[m] * sigmoid(this.bo[m * 4]); dout[1] = gr.dcol[m][0] * c[0] * (1 - c[0]); dout[2] = gr.dcol[m][1] * c[1] * (1 - c[1]); dout[3] = gr.dcol[m][2] * c[2] * (1 - c[2]);
    for (q = 0; q < 4; q++) G[this.ob2 + q] += dout[q];
    for (j = 0; j < H; j++) dh[j] = 0;
    for (q = 0; q < 4; q++) { r = this.oW2 + q * H; for (j = 0; j < H; j++) { G[r + j] += dout[q] * BH[hoff + j]; dh[j] += P[r + j] * dout[q]; } }
    for (k = 0; k < nIn; k++) dzf[k] = 0;
    for (j = 0; j < H; j++) {
      if (BH[hoff + j] <= 0) continue;                                           // ReLU gate
      r = this.oW1 + j * nIn; G[this.ob1 + j] += dh[j];
      for (k = 0; k < nIn; k++) { G[r + k] += dh[j] * BZ[zo + k]; dzf[k] += P[r + k] * dh[j]; }
    }
    for (l = 0; l < L; l++) {
      q = m * L * 4 + l * 4; var base = this.off[l];
      for (f = 0; f < F; f++) { var d = dzf[l * F + f]; for (k = 0; k < 4; k++) G[base + this.bs[q + k] * F + f] += this.bw[q + k] * d; }
    }
  }
  return { C: fw.C, err: e0 * e0 + e1 * e1 + e2 * e2 };
};
/* one full-batch Adam step over every pixel of every view (jittered samples, like FL.vol.Field.step({jitter: true})); returns the loss before the step */
HF.step = function (views, o) {
  o = o || {};
  var lr = o.lr || 0.05, rng = FL.rng((o.seed || 1) + this.t * 7919), P = 0, v, i, k;
  this.g.fill(0);
  for (v = 0; v < views.length; v++) P += views[v].cam.W;
  var wgt = 1 / (3 * P), loss = 0;
  for (v = 0; v < views.length; v++) for (i = 0; i < views[v].cam.W; i++) {
    var ry = FL.pixelRay(views[v].cam, i + 0.5), img = views[v].img;
    loss += this.ray(ry.ox, ry.oz, ry.dx, ry.dz, rng, [img.r[i], img.g[i], img.b[i]], wgt).err * wgt;
  }
  this.t++;
  var b1 = 0.9, b2 = 0.99, c1 = 1 - Math.pow(b1, this.t), c2 = 1 - Math.pow(b2, this.t), p = this.p, g = this.g, m = this.m, vv = this.v;
  for (k = 0; k < this.nParams; k++) { m[k] = b1 * m[k] + (1 - b1) * g[k]; vv[k] = b2 * vv[k] + (1 - b2) * g[k] * g[k]; p[k] -= lr * (m[k] / c1) / (Math.sqrt(vv[k] / c2) + 1e-10); }
  return loss;
};
HF.renderCam = function (cam) {
  var W = cam.W, out = { W: W, r: new Float32Array(W), g: new Float32Array(W), b: new Float32Array(W) }, i;
  for (i = 0; i < W; i++) { var ry = FL.pixelRay(cam, i + 0.5), res = this.ray(ry.ox, ry.oz, ry.dx, ry.dz, null); out.r[i] = res.C[0]; out.g[i] = res.C[1]; out.b[i] = res.C[2]; }
  return out;
};
/* the nodes of level l that the cells of an occupancy mask touch (for counting collisions): returns the list of (i, j) */
H10.nodesOfCells = function (cells, N) {
  var seen = {}, out = [], q;
  cells.forEach(function (c) {
    for (q = 0; q < 4; q++) { var i = c[0] + (q & 1), j = c[1] + (q >> 1), key = j * (N + 1) + i; if (!seen[key]) { seen[key] = 1; out.push([i, j]); } }
  });
  return out;
};

/* ═══════════════════════════ the splat lab (the widget's engine) ═══════════════════════════
 *   L10.views(n)               n data cameras on the ring of lessons 6-9 (radius 6 m, f = 56 px, 64 pixels, start 0.13) and their photographs
 *   L10.init(views, K0, seed)  K0 Gaussians seeded at points the cameras saw (the stand-in for lesson 5's sparse cloud: first hits, 8 cm of noise), coloured by the
 *                              pixel that produced the point; 0.3 m wide, half opaque
 *   L10.Run(n, K0, seed)       an experiment: .train(k) takes k Adam steps, .grow() clones and splits, .measure() scores the exam; .curve keeps (step, train dB, held-out dB)
 */
var L10 = {};
L10.F = 56; L10.W = 64; L10.R = 6; L10.HELD = 24;
var _lab = null;
L10.world = function () {
  if (_lab) return _lab;
  var sc = FL.scenes.statue(), held = FL.orbit(L10.HELD, L10.R, 0, 0, { f: L10.F, W: L10.W, start: 0.13 + Math.PI / 24 * 0.9 });
  _lab = { sc: sc, held: held, heldImg: held.map(function (c) { return FL.render(sc, c); }) };
  return _lab;
};
L10.views = function (n) {
  var sc = L10.world().sc;
  return FL.orbit(n, L10.R, 0, 0, { f: L10.F, W: L10.W, start: 0.13 }).map(function (c) { return { cam: c, img: FL.render(sc, c) }; });
};
var logit = function (p) { p = Math.min(0.995, Math.max(0.005, p)); return Math.log(p / (1 - p)); };
L10.init = function (views, K0, seed) {
  var pts = [], v, i, k, rng = FL.rng(seed || 7);
  for (v = 0; v < views.length; v++) for (i = 0; i < views[v].cam.W; i++) {
    var im = views[v].img;
    if (im.id[i] >= 0) pts.push({ x: im.hx[i], z: im.hz[i], c: [im.r[i], im.g[i], im.b[i]] });
  }
  var chosen = [];
  for (k = 0; k < K0; k++) { var p = pts[Math.floor((k + 0.5) * pts.length / K0)]; chosen.push({ x: p.x + 0.08 * FL.randn(rng), z: p.z + 0.08 * FL.randn(rng), c: p.c }); }
  var S = FL.gs.fromPoints(chosen, { scale: 0.3, ol: 0, bg: L10.world().sc.bg }, rng);
  for (k = 0; k < K0; k++) for (i = 0; i < 3; i++) S.p[k * FL.gs.P + 6 + i] = logit(chosen[k].c[i]);
  return S;
};
L10.Run = function (n, K0, seed) {
  this.n = n; this.K0 = K0; this.seed = seed || 7;
  this.views = L10.views(n); this.S = L10.init(this.views, K0, this.seed);
  this.steps = 0; this.curve = []; this.marks = []; this.loss = []; this.rng = FL.rng(100 + this.seed); this.fresh = 0;
  this.measure();
};
var RP = L10.Run.prototype;
RP.train = function (k) {
  for (var i = 0; i < k; i++) { this.loss.push(FL.gs.step(this.S, this.views, {})); this.steps++; if (this.steps % 50 === 0) this.measure(); }
  if (this.steps % 50) this.measure();
};
/* clone the small Gaussians and split the large ones among the 40 % with the largest mean position gradient, then drop the nearly transparent */
RP.grow = function () {
  var d = FL.gs.densify(this.S, { frac: 0.4, big: 0.35, maxK: 400, rng: this.rng }), fresh = d.cloned + 2 * d.split, K1 = this.S.K, G = FL.gs.P, q = this.S.p, bad = 0, k, b;
  for (k = K1 - fresh; k < K1; k++) { b = k * G; if (!(sigmoid(q[b + 5]) >= 0.02 && Math.exp(q[b + 2]) < 1.2 && Math.exp(q[b + 3]) < 1.2)) bad++; }
  var p = FL.gs.prune(this.S, { minOpacity: 0.02 });
  this.marks.push(this.steps); this.fresh = fresh - bad;           // the newest `fresh` Gaussians are the ones this round added (the widget outlines them)
  return { cloned: d.cloned, split: d.split, removed: p.removed, K: this.S.K };
};
RP.measure = function () {
  var w = L10.world(), tr = 0, ho = 0, pairs = 0, k, r;
  for (k = 0; k < this.views.length; k++) { r = FL.gs.render(this.S, this.views[k].cam); tr += FL.psnr(this.views[k].img, r); pairs += r.pairs; }
  for (k = 0; k < w.held.length; k++) ho += FL.psnr(w.heldImg[k], FL.gs.render(this.S, w.held[k]));
  this.tr = tr / this.views.length; this.ho = ho / w.held.length; this.pairs = pairs / this.views.length;
  var last = this.curve[this.curve.length - 1];
  if (last && last[0] === this.steps) this.curve.pop();
  this.curve.push([this.steps, this.tr, this.ho]);
};
L10.Run.fit = function (n, K0, steps, seed) { var r = new L10.Run(n, K0, seed); r.train(steps || 400); return r; };

/* ── the widget's picture (kept here so that the page carries only the wiring) ──
 *   left: the scene from above, the true outlines, every Gaussian as the 2-sigma ellipse of its covariance in its own colour (amber outline: added by the last densify),
 *         the data cameras (blue, drawn on the border of the view) and one held-out camera (amber) with its field of view;
 *   right: that camera's photograph, the render, their difference, and the exam score against the steps;   bottom: the work of one camera, lesson 9's field against these Gaussians. */
L10.draw = function (cv, run, hi) {
  var D = FL.draw, C = FL.C, wl = L10.world(), S = run.S, G = FL.gs.P, hcam = wl.held[hi], k;
  cv.style.height = (cv.clientWidth < 600 ? 832 : 440) + 'px';
  var Sx = D.setup(cv), ctx = Sx.ctx, w = Sx.w, narrow = w < 600;
  var lw = narrow ? Math.min(w - 16, 420) : Math.min(330, Math.floor(w * 0.47)), rx = narrow ? 8 : lw + 28, rw = narrow ? w - 16 : w - rx - 8, ry = narrow ? lw + 52 : 30;
  var cy = ry + 150, ch = narrow ? 150 : lw + 8 - cy, by = narrow ? cy + ch + 56 : lw + 56;
  var v = D.view(8, 8, lw, lw, -4, 4, -4, 4);
  D.frame(ctx, 8, 8, lw, lw, C.panel); D.grid(ctx, v, 1);
  ctx.save(); ctx.beginPath(); ctx.rect(8, 8, lw, lw); ctx.clip();
  for (k = 0; k < S.K; k++) {
    var b = k * G, o = FL.gs.opacity(S, k), added = k >= S.K - run.fresh;
    ctx.beginPath(); ctx.ellipse(v.X(S.p[b]), v.Y(S.p[b + 1]), 2 * Math.exp(S.p[b + 2]) * v.s, 2 * Math.exp(S.p[b + 3]) * v.s, -S.p[b + 4], 0, 2 * Math.PI);
    ctx.fillStyle = D.rgb(FL.gs.color(S, k), 0.12 + 0.5 * o); ctx.fill();
    ctx.strokeStyle = added ? C.amber : 'rgba(31,36,48,0.5)'; ctx.lineWidth = added ? 1.6 : 0.8; ctx.stroke();
  }
  D.scene(ctx, wl.sc, v, { fillAlpha: 0, lineWidth: 1.4 });
  var edge = function (c) { var a = Math.atan2(c.z, c.x); return Object.assign({}, c, { x: 3.5 * Math.cos(a), z: 3.5 * Math.sin(a) }); };
  run.views.forEach(function (vw) { D.camera(ctx, edge(vw.cam), v, { color: C.blue, fov: false }); });
  D.camera(ctx, edge(hcam), v, { color: C.amber, len: 7, label: 'held-out ' + hi });
  ctx.restore();
  D.mono(ctx, 'blue: data cameras · amber: held-out camera', 10, lw + 18, C.mute, 9);
  D.mono(ctx, run.fresh ? 'ellipses: 2σ · amber outline: just added' : 'ellipses: 2σ · lines: the true surface', 10, lw + 30, C.mute, 9);
  var pred = FL.gs.render(S, hcam), truth = wl.heldImg[hi], sh = 16;
  D.strip(ctx, truth, rx, ry, rw, sh, { label: 'photograph, held-out camera ' + hi });
  D.strip(ctx, pred, rx, ry + 40, rw, sh, { label: 'the Gaussians’ render' });
  D.errorStrip(ctx, pred, truth, rx, ry + 80, rw, sh, { label: 'where they disagree: ' + FL.psnr(pred, truth).toFixed(1) + ' dB' });
  var xm = Math.max(400, Math.ceil(run.steps / 100) * 100), cx0 = rx + 24, cx1 = rx + rw - 6;
  var X = function (s) { return cx0 + s / xm * (cx1 - cx0); }, Y = function (db) { return cy + ch - Math.max(0, Math.min(40, db)) / 40 * ch; };
  D.frame(ctx, rx, cy, rw, ch, C.white);
  [0, 10, 20, 30, 40].forEach(function (db) { D.line(ctx, cx0, Y(db), cx1, Y(db), C.grid, 1); D.mono(ctx, String(db), rx + 3, Y(db), C.mute, 9); });
  for (k = 0; k <= xm; k += 100) D.mono(ctx, String(k), X(k), cy + ch + 11, C.mute, 9, 'center');
  D.path(ctx, run.curve.map(function (p) { return [X(p[0]), Y(p[1])]; }), C.blue, 2);
  D.path(ctx, run.curve.map(function (p) { return [X(p[0]), Y(p[2])]; }), C.amber, 2);
  run.marks.forEach(function (m) { D.line(ctx, X(m), cy + ch - 9, X(m), cy + ch, C.green, 2); });
  D.mono(ctx, 'exam score (dB) against steps', rx, cy - 22, C.mute, 9);
  D.mono(ctx, 'blue: data · amber: held-out · green: densify', rx, cy - 10, C.mute, 9);
  var per = L10.W * 48, bw = w - 16 - 120, f = bw / per;
  D.mono(ctx, 'work of one camera: lesson 9’s field samples, against splat–pixel pairs', 8, by - 12, C.mute, 9);
  ctx.fillStyle = C.dim; ctx.fillRect(8, by, bw, 14); ctx.fillStyle = C.blue; ctx.fillRect(8, by + 22, Math.max(1, run.pairs * f), 14);
  D.mono(ctx, per + ' samples', 16 + bw, by + 7, C.mute, 10); D.mono(ctx, Math.round(run.pairs) + ' pairs', 16 + bw, by + 29, C.mute, 10);
};

if (typeof module !== 'undefined' && module.exports) { module.exports = H10; H10.L10 = L10; }
root.H10 = H10; root.L10 = L10;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
