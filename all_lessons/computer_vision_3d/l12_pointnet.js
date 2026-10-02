/* l12_pointnet.js — the private engine of 3D lesson 12, "Networks that eat 3D".
 *
 * Tiny networks, written out, trained with Adam, for point sets in Flatland.  Nothing here is a library call.
 *
 *   PN.make(kind, o, seed)       a network.  kind 'mlp': one vector in, {n: points, hid: [..], K}.
 *                                kind 'set': shared per-point layers phi, a symmetric pool, then rho; {phi: [..], rho: [..], K, pool: 'max'|'mean'|'sum'}
 *   PN.forward(net, X, n)        X = Float64Array(2n) of coordinates (x0, z0, x1, z1, ...) in ANY order; returns {out, c}
 *   PN.lossGrad(net, batch, g)   mean loss over [{x, n, y}] and its gradient (accumulated into g); 'ce' for class labels, 'mse' for target vectors
 *   PN.adam / PN.train           Adam steps; train(net, sampler, steps, o) draws a fresh batch per step from sampler(rng, B)
 *   PN.probs / PN.accuracy       softmax class probabilities; accuracy over a list of clouds
 *   PN.critical(net, X, n)       the points that win the max in at least one channel (the "critical set"), pool 'max' only
 *   PN.shape(c, rng) / PN.cloud  the data: a shape from class c of FL.shape.classes() (0 oval, 1 trefoil) and n points on its boundary (any arc)
 *   PN.shuffle / PN.subset       a permuted copy of a cloud / the cloud restricted to some indices
 *   PN.testSet / PN.fitMLP / PN.fitSet / PN.fitBack   the recipes the lesson uses: a fixed test set, the plain MLP, the PointNet, the regression net
 *   PN.front / PN.ambiguous / PN.zOf / PN.thetaOf / PN.dist   the exit: a front view of an object, fronts that fit two kinds of object, the (elongation, triangularity) scores
 *   PN.scan / PN.grid / PN.layer / PN.depth   a planar scan of the room, its occupancy, and the multiply-add counts of dense, sparse and submanifold convolution
 *   PN.lab()                     the three trained networks and every number the widget prints (views: a set, a scan, the hidden back)
 *
 * Deterministic: no Math.random, no Date.  Depends on FL (flatland.js) for FL.rng, FL.randn, FL.lidar and FL.shape.
 */
(function (root) {
'use strict';
var FL = root.FL || (typeof require !== 'undefined' ? require('./flatland.js') : null);
var SH = FL.shape;
var PN = { N0: 32, SD: 0.02, CM: 115, ALPHA: Math.PI / 3, HALF: 25 * Math.PI / 180, FSD: 0.04 };

/* ───────────────────────────── dense layers in one flat parameter vector ───────────────────────────── */
function stack(sizes, off0) {
  var L = [], off = off0 || 0;
  for (var l = 0; l + 1 < sizes.length; l++) { L.push({ ni: sizes[l], no: sizes[l + 1], o: off }); off += sizes[l + 1] * (sizes[l] + 1); }
  return { L: L, end: off };
}
function lin(p, ly, X, R, relu) {                       // Y = X Wᵀ + b over R rows, optional ReLU
  var ni = ly.ni, no = ly.no, bo = ly.o + no * ni, Y = new Float64Array(R * no), r, j, i, s;
  for (r = 0; r < R; r++) for (j = 0; j < no; j++) {
    s = p[bo + j];
    for (i = 0; i < ni; i++) s += p[ly.o + j * ni + i] * X[r * ni + i];
    Y[r * no + j] = relu && s < 0 ? 0 : s;
  }
  return Y;
}
function linBack(p, g, ly, X, R, Y, dY, relu) {         // adds dW, db into g; returns dX
  var ni = ly.ni, no = ly.no, bo = ly.o + no * ni, dX = new Float64Array(R * ni), r, j, i, d;
  for (r = 0; r < R; r++) for (j = 0; j < no; j++) {
    d = dY[r * no + j];
    if (d === 0 || (relu && Y[r * no + j] <= 0)) continue;
    g[bo + j] += d;
    for (i = 0; i < ni; i++) { g[ly.o + j * ni + i] += d * X[r * ni + i]; dX[r * ni + i] += d * p[ly.o + j * ni + i]; }
  }
  return dX;
}

/* ───────────────────────────── networks ───────────────────────────── */
PN.make = function (kind, o, seed) {
  var net = { kind: kind, K: o.K, loss: o.loss || 'ce', pool: o.pool || 'max', n: o.n || 0 };
  if (kind === 'mlp') net.phi = stack([2 * o.n].concat(o.hid, [o.K]));
  else {
    net.phi = stack([2].concat(o.phi));
    net.F = o.phi[o.phi.length - 1];
    net.rho = stack([net.F].concat(o.rho, [o.K]), net.phi.end);
  }
  var total = kind === 'mlp' ? net.phi.end : net.rho.end, rng = FL.rng(seed || 1);
  net.p = new Float64Array(total); net.m = new Float64Array(total); net.v = new Float64Array(total); net.t = 0;
  [net.phi, net.rho].forEach(function (st) {
    if (!st) return;
    st.L.forEach(function (ly) { var sd = Math.sqrt(2 / ly.ni); for (var i = 0; i < ly.no * ly.ni; i++) net.p[ly.o + i] = sd * FL.randn(rng); });
  });
  return net;
};

PN.forward = function (net, X, n) {
  var p = net.p, c = { X: X, n: n }, l, h, L;
  if (net.kind === 'mlp') {
    h = X; c.H = [X]; L = net.phi.L;
    for (l = 0; l < L.length; l++) { h = lin(p, L[l], h, 1, l < L.length - 1); c.H.push(h); }
    c.out = h; return { out: h, c: c };
  }
  h = X; c.H = [X]; L = net.phi.L;
  for (l = 0; l < L.length; l++) { h = lin(p, L[l], h, n, true); c.H.push(h); }         // per-point features phi(x_i), n × F
  var F = net.F, g = new Float64Array(F), arg = new Int32Array(F), i, f;
  if (net.pool === 'max') {
    for (f = 0; f < F; f++) { var best = -Infinity, bi = 0; for (i = 0; i < n; i++) if (h[i * F + f] > best) { best = h[i * F + f]; bi = i; } g[f] = n ? best : 0; arg[f] = bi; }
  } else {
    for (f = 0; f < F; f++) { var s = 0; for (i = 0; i < n; i++) s += h[i * F + f]; g[f] = net.pool === 'mean' ? s / Math.max(n, 1) : s; }
  }
  c.g = g; c.arg = arg; c.G = [g]; h = g; L = net.rho.L;
  for (l = 0; l < L.length; l++) { h = lin(p, L[l], h, 1, l < L.length - 1); c.G.push(h); }
  c.out = h;
  return { out: h, c: c };
};

function backward(net, c, dOut, g) {
  var p = net.p, l, L, d = dOut;
  if (net.kind === 'mlp') {
    L = net.phi.L;
    for (l = L.length - 1; l >= 0; l--) d = linBack(p, g, L[l], c.H[l], 1, c.H[l + 1], d, l < L.length - 1);
    return;
  }
  L = net.rho.L;
  for (l = L.length - 1; l >= 0; l--) d = linBack(p, g, L[l], c.G[l], 1, c.G[l + 1], d, l < L.length - 1);
  var F = net.F, n = c.n, dH = new Float64Array(n * F), i, f;                           // d is now dL/dg
  if (net.pool === 'max') { for (f = 0; f < F; f++) if (n) dH[c.arg[f] * F + f] += d[f]; }
  else for (i = 0; i < n; i++) for (f = 0; f < F; f++) dH[i * F + f] = net.pool === 'mean' ? d[f] / n : d[f];
  L = net.phi.L; d = dH;
  for (l = L.length - 1; l >= 0; l--) d = linBack(p, g, L[l], c.H[l], n, c.H[l + 1], d, true);
}

function softmax(z) { var m = Math.max.apply(null, z), s = 0, o = [], i; for (i = 0; i < z.length; i++) { o[i] = Math.exp(z[i] - m); s += o[i]; } for (i = 0; i < z.length; i++) o[i] /= s; return o; }
PN.softmax = softmax;
PN.lossGrad = function (net, batch, g) {
  var loss = 0, B = batch.length, b, k;
  for (b = 0; b < B; b++) {
    var it = batch[b], f = PN.forward(net, it.x, it.n), dOut = new Float64Array(net.K);
    if (net.loss === 'ce') { var pr = softmax(f.out); loss -= Math.log(Math.max(pr[it.y], 1e-12)); for (k = 0; k < net.K; k++) dOut[k] = (pr[k] - (k === it.y ? 1 : 0)) / B; }
    else { for (k = 0; k < net.K; k++) { var e = f.out[k] - it.y[k]; loss += e * e / net.K; dOut[k] = 2 * e / net.K / B; } }
    backward(net, f.c, dOut, g);
  }
  return loss / B;
};
PN.adam = function (net, g, lr) {
  var b1 = 0.9, b2 = 0.999, t = ++net.t, c1 = 1 - Math.pow(b1, t), c2 = 1 - Math.pow(b2, t);
  for (var i = 0; i < g.length; i++) {
    net.m[i] = b1 * net.m[i] + (1 - b1) * g[i]; net.v[i] = b2 * net.v[i] + (1 - b2) * g[i] * g[i];
    net.p[i] -= lr * (net.m[i] / c1) / (Math.sqrt(net.v[i] / c2) + 1e-8);
  }
};
/* steps of Adam; sampler(rng, B) → a batch.  o: {B, lr, seed} */
PN.train = function (net, sampler, steps, o) {
  o = o || {};
  var rng = FL.rng((o.seed || 5) + net.t), B = o.B || 16, lr = o.lr || 0.01, last = 0;
  for (var s = 0; s < steps; s++) {
    var g = new Float64Array(net.p.length);
    last = PN.lossGrad(net, sampler(rng, B), g);
    PN.adam(net, g, lr);
  }
  return last;
};
PN.probs = function (net, x, n) { return softmax(PN.forward(net, x, n).out); };
PN.accuracy = function (net, clouds) { var ok = 0; clouds.forEach(function (c) { var o = PN.forward(net, c.x, c.n).out; if ((o[1] > o[0] ? 1 : 0) === c.y) ok++; }); return ok / clouds.length; };

/* the critical set: the points that attain the max of at least one (non-dead) channel */
PN.critical = function (net, X, n) {
  var f = PN.forward(net, X, n), c = f.c, F = net.F, seen = {}, out = [], h = c.H[c.H.length - 1];
  for (var k = 0; k < F; k++) if (n && h[c.arg[k] * F + k] > 1e-12 && !seen[c.arg[k]]) { seen[c.arg[k]] = 1; out.push(c.arg[k]); }
  return out.sort(function (a, b) { return a - b; });
};

/* ───────────────────────────── data: boundary clouds of the two kinds of statue ───────────────────────────── */
var CLS = null;
PN.classes = function () { return CLS || (CLS = SH.classes()); };
PN.shape = function (c, rng) { var k = PN.classes()[c]; return SH.sample({ mean: k.mu, cov: k.Lam }, rng, 1)[0]; };
/* n points on the boundary of θ at random angles in [lo, hi] (full circle by default); radial noise sd; o.sorted: ascending angle (scan order) */
PN.cloud = function (th, n, rng, o) {
  o = o || {};
  var lo = o.lo === undefined ? 0 : o.lo, hi = o.hi === undefined ? 2 * Math.PI : o.hi, ang = [], X = new Float64Array(2 * n), i;
  for (i = 0; i < n; i++) ang.push(lo + (hi - lo) * rng());
  if (o.sorted) ang.sort(function (a, b) { return a - b; });
  for (i = 0; i < n; i++) { var r = SH.radius(th, ang[i]) + (o.sd ? o.sd * FL.randn(rng) : 0); X[2 * i] = r * Math.cos(ang[i]); X[2 * i + 1] = r * Math.sin(ang[i]); }
  return { x: X, n: n, ang: ang };
};
PN.shuffle = function (cl, rng) {
  var idx = [], i, n = cl.n; for (i = 0; i < n; i++) idx.push(i);
  for (i = n - 1; i > 0; i--) { var j = Math.floor(rng() * (i + 1)), t = idx[i]; idx[i] = idx[j]; idx[j] = t; }
  return PN.subset(cl, idx);
};
PN.subset = function (cl, idx) {
  var X = new Float64Array(2 * idx.length), ang = [];
  idx.forEach(function (k, i) { X[2 * i] = cl.x[2 * k]; X[2 * i + 1] = cl.x[2 * k + 1]; ang.push(cl.ang ? cl.ang[k] : 0); });
  var o = {}; for (var key in cl) o[key] = cl[key];
  o.x = X; o.n = idx.length; o.ang = ang; return o;
};

/* ───────────────────────────── the recipes of the lesson ───────────────────────────── */
/* a fixed test set: n clouds of N points, alternating oval / trefoil, in scan order (ascending angle) */
PN.testSet = function (seed, n, N) {
  var rng = FL.rng(seed), out = [];
  for (var i = 0; i < n; i++) { var y = i % 2, th = PN.shape(y, rng); out.push(Object.assign(PN.cloud(th, N || PN.N0, rng, { sd: PN.SD, sorted: true }), { y: y, th: th })); }
  return out;
};
/* the plain network: a list of 2·N0 numbers in.  Trained in scan order, or (o.shuffle) on shuffled lists */
PN.fitMLP = function (seed, steps, o) {
  o = o || {};
  var net = PN.make('mlp', { n: PN.N0, hid: o.hid || [32, 16], K: 2 }, seed);
  PN.train(net, function (rng, B) {
    var out = [];
    for (var b = 0; b < B; b++) {
      var y = rng() < 0.5 ? 0 : 1, c = PN.cloud(PN.shape(y, rng), PN.N0, rng, { sd: PN.SD, sorted: true });
      if (o.shuffle) c = PN.shuffle(c, rng);
      out.push({ x: c.x, n: c.n, y: y });
    }
    return out;
  }, steps, { B: 16, lr: o.lr || 0.01 });
  return net;
};
/* the symmetric network, trained on clouds of 12 to 48 points in any order */
PN.fitSet = function (seed, steps, o) {
  o = o || {};
  var net = PN.make('set', { phi: o.phi || [16, 32], rho: [16], K: 2, pool: o.pool || 'max' }, seed);
  PN.train(net, function (rng, B) {
    var out = [];
    for (var b = 0; b < B; b++) {
      var y = rng() < 0.5 ? 0 : 1, n = o.fixed ? PN.N0 : 12 + Math.floor(rng() * 37), c = PN.shuffle(PN.cloud(PN.shape(y, rng), n, rng, { sd: PN.SD }), rng);
      out.push({ x: c.x, n: c.n, y: y });
    }
    return out;
  }, steps, { B: 16, lr: 0.01 });
  return net;
};

/* ───────────────────────────── the exit: a front view, and two objects that share it ───────────────────────────── */
/* an object seen from azimuth ALPHA: n points on the arc ±HALF it faces, radial noise FSD.  The camera cannot see the rest. */
PN.front = function (th, n, rng) { return PN.cloud(th, n, rng, { lo: PN.ALPHA - PN.HALF, hi: PN.ALPHA + PN.HALF, sd: PN.FSD }); };
/* the two scores that summarise a member of the world: how elongated (row 0 of SH.M) and how three-lobed (row 1) */
PN.zOf = function (th) {
  var z = [0, 0];
  for (var c = 0; c < 2; c++) { var s = 0, q = 0; for (var i = 0; i < SH.dim; i++) { s += th[i] * SH.M[c][i]; q += SH.M[c][i] * SH.M[c][i]; } z[c] = s / q; }
  return z;
};
PN.thetaOf = function (z) {
  var th = new Float64Array(SH.dim);
  for (var i = 0; i < SH.dim; i++) th[i] = z[0] * SH.M[0][i] + z[1] * SH.M[1][i];
  return th;
};
/* distance between two outlines over the directions the camera did not face: rms radius difference, in centimetres of the 1.15 m statue */
PN.probes = (function () { var p = []; for (var q = 0; q < 72; q++) p.push(-Math.PI + 2 * Math.PI * (q + 0.5) / 72); return p; })();
PN.unseen = PN.probes.filter(function (p) { return !SH.seen(p, [PN.ALPHA], PN.HALF); });
PN.dist = function (a, b) { var s = 0; PN.unseen.forEach(function (p) { var d = SH.radius(a, p) - SH.radius(b, p); s += d * d; }); return PN.CM * Math.sqrt(s / PN.unseen.length); };
/* the regression net: front cloud (6 to 24 points) in, the two scores out, squared error */
PN.fitBack = function (seed, steps) {
  var net = PN.make('set', { phi: [24, 48], rho: [32], K: 2, pool: 'max', loss: 'mse' }, seed);
  PN.train(net, PN.backSampler, steps, { B: 16, lr: 0.005 });
  return net;
};
PN.backSampler = function (rng, B) {
  var out = [];
  for (var b = 0; b < B; b++) { var th = PN.shape(rng() < 0.5 ? 0 : 1, rng), c = PN.front(th, 6 + Math.floor(rng() * 19), rng); out.push({ x: c.x, n: c.n, y: PN.zOf(th) }); }
  return out;
};
/* fronts that fit an oval and a trefoil about equally well.  Draws objects alternately from the two kinds and takes the front cloud of each; for each kind it
 * finds the member that explains the front best (lesson 11's Gaussian posterior mean, with that kind's mean and covariance as the prior) and how likely the
 * two explanations are.  Returns the `count` fronts whose two explanations are the most nearly equally likely: [{cl, th, c, oval, tref, w}] (w: weight of the oval) */
PN.ambiguous = function (seed, draws, count) {
  var rng = FL.rng(seed), items = [], i, k;
  for (i = 0; i < draws; i++) {
    var c = i % 2, th = PN.shape(c, rng), cl = PN.front(th, 16, rng), rad = [];
    for (k = 0; k < cl.n; k++) rad.push(Math.hypot(cl.x[2 * k], cl.x[2 * k + 1]));
    var mp = SH.mixturePosterior(cl.ang, rad, PN.FSD, PN.classes());
    items.push({ cl: cl, th: th, c: c, oval: mp[0].mean, tref: mp[1].mean, w: mp[0].w });
  }
  items.sort(function (a, b) { return Math.abs(a.w - 0.5) - Math.abs(b.w - 0.5); });
  return items.slice(0, count);
};

/* ───────────────────────────── a planar scan, its occupancy grid, and what a convolution costs ───────────────────────────── */
PN.BOX = [-6.6, 6.6, -0.6, 8.6];
PN.scan = function (n, seed) {
  var hits = FL.lidar(FL.scenes.room(), { a: 0, x: -1.0, z: 3.0 }, { n: n, fov: 2 * Math.PI, range: 14, sigma: 0.02, rng: FL.rng(seed || 3) });
  return hits.filter(function (h) { return h.ok; }).map(function (h) { return { x: h.x, z: h.z }; });
};
/* occupancy of a point set on square cells of side h over PN.BOX */
PN.grid = function (pts, h) {
  var B = PN.BOX, gx = Math.ceil((B[1] - B[0]) / h), gz = Math.ceil((B[3] - B[2]) / h), occ = new Uint8Array(gx * gz), n = 0;
  pts.forEach(function (p) {
    var i = Math.floor((p.x - B[0]) / h), j = Math.floor((p.z - B[2]) / h);
    if (i >= 0 && i < gx && j >= 0 && j < gz && !occ[j * gx + i]) { occ[j * gx + i] = 1; n++; }
  });
  return { gx: gx, gz: gz, h: h, occ: occ, n: n };
};
/* one k×k convolution layer on an occupancy set, counting multiply-adds per (input channel, output channel) pair.
 *   dense      every cell is an output: gx·gz·k²
 *   sparse     one multiply-add per (active input, window offset) that lands inside the grid; the outputs are every site an active input reaches
 *   submanifold  outputs only at the active sites; a multiply-add for each (active output, offset) whose input is active too      */
PN.layer = function (G, k, mode) {
  var gx = G.gx, gz = G.gz, r = (k - 1) / 2, out = new Uint8Array(gx * gz), macs = 0, n = 0, i, j, di, dj;
  if (mode === 'dense') { out.fill(1); return { macs: gx * gz * k * k, occ: out, n: gx * gz, gx: gx, gz: gz }; }
  for (j = 0; j < gz; j++) for (i = 0; i < gx; i++) {
    if (!G.occ[j * gx + i]) continue;
    if (mode === 'submanifold') { out[j * gx + i] = 1; n++; }
    for (dj = -r; dj <= r; dj++) for (di = -r; di <= r; di++) {
      var a = i + di, b = j + dj;
      if (a < 0 || a >= gx || b < 0 || b >= gz) continue;
      if (mode === 'sparse') { macs++; if (!out[b * gx + a]) { out[b * gx + a] = 1; n++; } }
      else if (G.occ[b * gx + a]) macs++;
    }
  }
  return { macs: macs, occ: out, n: n, gx: gx, gz: gz };
};
/* L layers in a row: the number of active sites after each (sparse grows by the window every layer, submanifold stays) and the multiply-adds of each */
PN.depth = function (G, k, mode, L) {
  var cur = G, sites = [G.n], macs = [];
  for (var l = 0; l < L; l++) { var o = PN.layer(cur, k, mode); macs.push(o.macs); sites.push(o.n); cur = { gx: G.gx, gz: G.gz, h: G.h, occ: o.occ, n: o.n }; }
  return { sites: sites, macs: macs };
};

/* ───────────────────────────── the lab behind the widget ───────────────────────────── */
/* The three networks (trained once, fixed seeds) and every number the widget's three views print.
 *   L.set(i, how, f)      view 1: test cloud i with a fraction f of its points deleted (how: 'non' critical-free first | 'rand' | 'cri' critical first)
 *   L.curve(how)          PointNet accuracy over the 100 test clouds at 0, 5, ..., 90 % deleted
 *   L.scanAt(f, h)        view 2: the room scan with a fraction f of its returns dropped, on cells of side h: dense, sparse and submanifold counts
 *   L.backAt(i, f)        view 3: the i-th front that fits an oval and a trefoil equally well, with a fraction f of its points deleted, and the network's answer */
PN.lab = function () {
  var L = { test: PN.testSet(777, 100, PN.N0), mlp: PN.fitMLP(1, 300), net: PN.fitSet(1, 300, { phi: [16, 16] }), back: null, amb: null, world: null, curves: {} };
  var rs = FL.rng(99), i, k;
  L.shuf = L.test.map(function (c) { var s = PN.shuffle(c, rs); s.y = c.y; return s; });
  L.acc = { mlp: PN.accuracy(L.mlp, L.test), mlpShuf: PN.accuracy(L.mlp, L.shuf) };
  function perm(n, seed) { var r = FL.rng(seed), idx = [], j, t; for (var q = 0; q < n; q++) idx.push(q); for (q = n - 1; q > 0; q--) { j = Math.floor(r() * (q + 1)); t = idx[q]; idx[q] = idx[j]; idx[j] = t; } return idx; }
  L.rank = L.test.map(function (c, i) {                          // a fixed random order of deletion for each cloud, and the three policies built on it
    var idx = perm(c.n, 500 + i), crit = PN.critical(L.net, c.x, c.n), isC = function (q) { return crit.indexOf(q) >= 0; };
    return { rand: idx, non: idx.filter(function (q) { return !isC(q); }).concat(idx.filter(isC)), cri: idx.filter(isC).concat(idx.filter(function (q) { return !isC(q); })) };
  });
  function dropped(order, n, f) { var gone = {}, keep = [], q; order.slice(0, Math.round(f * n)).forEach(function (t) { gone[t] = 1; }); for (q = 0; q < n; q++) if (!gone[q]) keep.push(q); return keep; }
  L.pad = function (cl) { var X = new Float64Array(2 * PN.N0); X.set(cl.x.subarray(0, 2 * Math.min(cl.n, PN.N0))); return X; };      // the plain MLP needs a fixed-length list: missing points become zeros
  L.curve = function (how) {
    if (L.curves[how]) return L.curves[how];
    var out = [], f, ok;
    for (f = 0; f <= 0.9001; f += 0.05) {
      ok = 0;
      L.test.forEach(function (c, i) { var s = PN.subset(c, dropped(L.rank[i][how], c.n, f)); s.y = c.y; ok += PN.accuracy(L.net, [s]); });
      out.push(ok / L.test.length);
    }
    return (L.curves[how] = out);
  };
  L.set = function (idx, how, f) {
    var c = L.test[idx], keep = dropped(L.rank[idx][how], c.n, f), K = PN.subset(c, keep), full = PN.forward(L.net, c.x, c.n).c.g, kc = PN.forward(L.net, K.x, K.n);
    var p0 = PN.softmax(kc.out)[1], pm0 = PN.softmax(PN.forward(L.mlp, L.pad(K), PN.N0).out)[1], r = FL.rng(1000 + idx), dm = 0, dp = 0, dots = [], q, num = 0, den = 0;
    for (q = 0; q < 24; q++) {                                    // the same points in 24 random orders
      var Ks = PN.shuffle(K, r), pm = PN.softmax(PN.forward(L.mlp, L.pad(Ks), PN.N0).out)[1], pp = PN.softmax(PN.forward(L.net, Ks.x, Ks.n).out)[1];
      dm += Math.abs(pm - pm0) / 24; dp += Math.abs(pp - p0) / 24; dots.push([pm, pp]);
    }
    for (q = 0; q < kc.c.g.length; q++) { num += (kc.c.g[q] - full[q]) * (kc.c.g[q] - full[q]); den += full[q] * full[q]; }
    return { c: c, keep: keep, K: K, crit: PN.critical(L.net, K.x, K.n), p0: p0, pm0: pm0, dm: dm, dp: dp, dots: dots, dg: Math.sqrt(num / den), acc: L.curve(how)[Math.round(f / 0.05)] };
  };
  L.scan = PN.scan(720, 3); L.scanOrder = perm(L.scan.length, 77);
  L.scanAt = function (f, h) {
    var gone = {}, pts = [], G, k;
    L.scanOrder.slice(0, Math.round(f * L.scan.length)).forEach(function (q) { gone[q] = 1; });
    L.scan.forEach(function (p, q) { if (!gone[q]) pts.push(p); });
    G = PN.grid(pts, h);
    return { pts: pts, G: G, d: PN.layer(G, 3, 'dense'), s: PN.layer(G, 3, 'sparse'), m: PN.layer(G, 3, 'submanifold'), ds: PN.depth(G, 3, 'sparse', 4), dm: PN.depth(G, 3, 'submanifold', 4) };
  };
  L.backAt = function (i, f) {
    if (!L.back) {
      L.back = PN.fitBack(3, 800); L.amb = PN.ambiguous(11, 400, 8); L.world = []; var r = FL.rng(31337);
      for (k = 0; k < 4000; k++) L.world.push(PN.zOf(PN.shape(k % 2, r)));
      L.rare = L.world.filter(function (z) { return z[0] > 0.8 && z[1] > 0.8; }).length;
    }
    var a = L.amb[i % L.amb.length], K = PN.subset(a.cl, dropped(perm(a.cl.n, 900 + i % L.amb.length), a.cl.n, f).sort(function (p, q) { return p - q; }));
    var z = Array.from(PN.forward(L.back, K.x, K.n).out), th = PN.thetaOf(z);
    return { a: a, K: K, z: z, th: th, dO: PN.dist(th, a.oval), dT: PN.dist(th, a.tref), dOT: PN.dist(a.oval, a.tref), rare: L.rare };
  };
  return L;
};

root.PN = PN;
if (typeof module !== 'undefined' && module.exports) module.exports = PN;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
