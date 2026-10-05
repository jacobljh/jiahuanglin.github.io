/* bench.js — the running world of the Robot Model and Embodied Data series.
 *
 * The Bench is a small, honest laboratory for learning a controller from demonstrations.  A planar two-link arm (links 0.5 m + 0.5 m,
 * base at the origin, x to the right, y up) carries a cup through a row of vases ("posts") standing on the table.  The arm is driven by
 * joint-velocity commands at 20 Hz (one step = 0.05 s) through a plant that may be noisy, lagged or delayed; an expert (a controller with
 * a Jacobian and a path) can demonstrate; learners (a nearest-demo kernel regressor, random-feature ridge, a small tanh network) are
 * trained from what the expert did; and every claim of the series is a computation done on rollouts of these policies.
 *
 * Conventions: q = [q1, q2] joint angles (rad), u = [u1, u2] joint-velocity command (rad/s), EE = end-effector (the cup) in metres.
 * Deterministic: no Math.random, no Date; pass BN.rng(seed).
 */
(function (root) {
'use strict';
var BN = {};
var PI = Math.PI;

/* ───────────────────────────── random numbers ───────────────────────────── */
BN.rng = function (seed) {
  var a = (seed >>> 0) || 1;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    var t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};
BN.randn = function (rng) { var u = 0; while (u === 0) u = rng(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * PI * rng()); };
BN.shuffle = function (arr, rng) { for (var i = arr.length - 1; i > 0; i--) { var j = Math.floor(rng() * (i + 1)), t = arr[i]; arr[i] = arr[j]; arr[j] = t; } return arr; };

/* ───────────────────────────── small linear algebra and statistics ───────────────────────────── */
BN.la = {};
BN.la.solve = function (A, b, n) {               // Gauss–Jordan, partial pivoting; b is n×m (row-major), returns n×m or null
  var m = b.length / n, w = n + m, M = new Float64Array(n * w), i, j, k;
  for (i = 0; i < n; i++) { for (j = 0; j < n; j++) M[i * w + j] = A[i * n + j]; for (j = 0; j < m; j++) M[i * w + n + j] = b[i * m + j]; }
  for (i = 0; i < n; i++) {
    var p = i, best = Math.abs(M[i * w + i]);
    for (k = i + 1; k < n; k++) { var v = Math.abs(M[k * w + i]); if (v > best) { best = v; p = k; } }
    if (best < 1e-13) return null;
    if (p !== i) for (j = 0; j < w; j++) { var t = M[i * w + j]; M[i * w + j] = M[p * w + j]; M[p * w + j] = t; }
    var d = M[i * w + i]; for (j = i; j < w; j++) M[i * w + j] /= d;
    for (k = 0; k < n; k++) if (k !== i) { var f = M[k * w + i]; if (f !== 0) for (j = i; j < w; j++) M[k * w + j] -= f * M[i * w + j]; }
  }
  var X = new Float64Array(n * m);
  for (i = 0; i < n; i++) for (j = 0; j < m; j++) X[i * m + j] = M[i * w + n + j];
  return X;
};

BN.stats = {
  mean: function (a) { var s = 0; for (var i = 0; i < a.length; i++) s += a[i]; return s / a.length; },
  std: function (a) { var m = BN.stats.mean(a), s = 0; for (var i = 0; i < a.length; i++) s += (a[i] - m) * (a[i] - m); return Math.sqrt(s / Math.max(1, a.length - 1)); },
  ncdf: function (x) { var t = 1 / (1 + 0.3275911 * Math.abs(x) / Math.SQRT2), y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x / 2); return 0.5 * (1 + (x >= 0 ? y : -y)); },
  quantile: function (a, q) { var b = a.slice().sort(function (x, y) { return x - y; }); return b[Math.min(b.length - 1, Math.max(0, Math.floor(q * b.length)))]; },
  /* Wilson score interval for k successes in n trials (z = 1.96 gives 95 %) */
  wilson: function (k, n, z) {
    z = z || 1.96; if (n <= 0) return [0, 1];
    var p = k / n, z2 = z * z, den = 1 + z2 / n, c = (p + z2 / (2 * n)) / den, h = z * Math.sqrt(p * (1 - p) / n + z2 / (4 * n * n)) / den;
    return [Math.max(0, c - h), Math.min(1, c + h)];
  },
  /* least-squares line y = a + b x; returns {slope, intercept, r2} */
  linfit: function (xs, ys) {
    var n = xs.length, mx = BN.stats.mean(xs), my = BN.stats.mean(ys), sxx = 0, sxy = 0, syy = 0, i;
    for (i = 0; i < n; i++) { sxx += (xs[i] - mx) * (xs[i] - mx); sxy += (xs[i] - mx) * (ys[i] - my); syy += (ys[i] - my) * (ys[i] - my); }
    var b = sxy / sxx; return { slope: b, intercept: my - b * mx, r2: syy > 0 ? sxy * sxy / (sxx * syy) : 1 };
  },
  /* slope of log y against log x (the exponent of a power law), points with x,y <= 0 skipped */
  logslope: function (xs, ys) {
    var lx = [], ly = [], i; for (i = 0; i < xs.length; i++) if (xs[i] > 0 && ys[i] > 0) { lx.push(Math.log(xs[i])); ly.push(Math.log(ys[i])); }
    return BN.stats.linfit(lx, ly);
  }
};

/* ───────────────────────────── the arm ───────────────────────────── */
/* A body is {L1, L2}; BN.arm.A is the default arm.  Forward kinematics, Jacobian (row-major 2×2), inverse kinematics (two elbow branches),
 * and a damped least-squares solve that turns a desired end-effector velocity into joint velocities. */
BN.arm = {};
BN.arm.A = { L1: 0.5, L2: 0.5 };
BN.arm.body = function (L1, L2) { return { L1: L1, L2: L2 }; };
BN.arm.fk = function (q, b) {
  b = b || BN.arm.A;
  return [b.L1 * Math.cos(q[0]) + b.L2 * Math.cos(q[0] + q[1]), b.L1 * Math.sin(q[0]) + b.L2 * Math.sin(q[0] + q[1])];
};
BN.arm.jac = function (q, b) {
  b = b || BN.arm.A;
  var s1 = Math.sin(q[0]), c1 = Math.cos(q[0]), s12 = Math.sin(q[0] + q[1]), c12 = Math.cos(q[0] + q[1]);
  return [-b.L1 * s1 - b.L2 * s12, -b.L2 * s12, b.L1 * c1 + b.L2 * c12, b.L2 * c12];
};
BN.arm.ik = function (p, elbow, b) {
  b = b || BN.arm.A;
  var d2 = p[0] * p[0] + p[1] * p[1], c2 = (d2 - b.L1 * b.L1 - b.L2 * b.L2) / (2 * b.L1 * b.L2);
  c2 = Math.max(-1, Math.min(1, c2));
  var q2 = (elbow || 1) * Math.acos(c2);
  return [Math.atan2(p[1], p[0]) - Math.atan2(b.L2 * Math.sin(q2), b.L1 + b.L2 * Math.cos(q2)), q2];
};
BN.arm.dls = function (J, v, lam) {                                  // u = Jᵀ (J Jᵀ + λI)⁻¹ v
  var a = J[0], b = J[1], c = J[2], d = J[3], m00 = a * a + b * b + lam, m01 = a * c + b * d, m11 = c * c + d * d + lam, det = m00 * m11 - m01 * m01;
  var w0 = (m11 * v[0] - m01 * v[1]) / det, w1 = (-m01 * v[0] + m00 * v[1]) / det;
  return [a * w0 + c * w1, b * w0 + d * w1];
};

/* ───────────────────────────── the plant: how a command becomes motion ───────────────────────────── */
/* P: dt (0.05 s), gain (1: what the arm does per unit command), lag (first-order time constant in s, 0 = none), delay (steps between
 * command and effect), noise (std of rad/s added to the joint velocity every step), vmax (command clip, 1.5 rad/s). */
BN.plant = function (P) {
  P = P || {};
  var dt = P.dt || 0.05, gain = P.gain === undefined ? 1 : P.gain, lag = P.lag || 0, delay = P.delay || 0, noise = P.noise || 0, vmax = P.vmax || 1.5;
  var s = { q: [0, 0], v: [0, 0], buf: [], dt: dt, P: P };
  s.reset = function (q0) { s.q = [q0[0], q0[1]]; s.v = [0, 0]; s.buf = []; for (var i = 0; i < delay; i++) s.buf.push([0, 0]); return s; };
  s.step = function (u, rng) {
    s.buf.push(u); var ua = s.buf.shift(), k, c = [0, 0];
    for (k = 0; k < 2; k++) c[k] = Math.max(-vmax, Math.min(vmax, ua[k])) * gain;
    for (k = 0; k < 2; k++) {
      s.v[k] = lag > 0 ? s.v[k] + (dt / (lag + dt)) * (c[k] - s.v[k]) : c[k];
      s.q[k] += dt * (s.v[k] + (noise && rng ? noise * BN.randn(rng) : 0));
    }
    return s.q;
  };
  return s;
};

/* ───────────────────────────── the slalom: a row of vases and an expert ───────────────────────────── */
/* n posts stand 0.2 m apart on a line at height baseY.  The cup starts 20 cm before the first post and must reach 10 cm past
 * the last without touching one (the cup and a post touch when their centres are closer than postR + grip = 5 cm).  The expert's path
 * passes each post on alternating sides, 10 cm off its centre, so the margin is 5 cm.  A layout shifts the whole row by `shift` metres and
 * tilts it by `tilt` (m of height per m along the row).  s0 = +1 passes the first post above it, −1 below. */
BN.slalom = {};
var SW = BN.slalom.W = { baseY: 0.55, postR: 0.035, grip: 0.015, spacing: 0.2, x0: -0.3, off: 0.10, speed: 0.15, look: 0.06, runIn: 0.2, runOut: 0.1 };
BN.slalom.world = function (n, o) {
  o = o || {};
  var w = { n: n, shift: o.shift || 0, tilt: o.tilt || 0, s0: o.s0 === undefined ? 1 : o.s0, body: o.body || BN.arm.A, posts: [], via: null }, i;
  for (i = 0; i < n; i++) { var x = SW.x0 + SW.spacing * i; w.posts.push([x, SW.baseY + w.shift + w.tilt * (x - SW.x0 - SW.spacing * (n - 1) / 2)]); }
  var v = [[SW.x0 - SW.runIn, w.posts[0][1]]], s = w.s0;
  for (i = 0; i < n; i++) { v.push([w.posts[i][0], w.posts[i][1] + s * SW.off]); s = -s; }
  v.push([SW.x0 + SW.spacing * (n - 1) + SW.runOut, w.posts[n - 1][1]]);
  w.via = v;
  return w;
};
BN.slalom.xStart = function () { return SW.x0 - SW.runIn; };
BN.slalom.xEnd = function (w) { return SW.x0 + SW.spacing * (w.n - 1) + SW.runOut; };
BN.slalom.yref = function (w, x) {                                   // the expert's path: smooth S-curves between the via points, a quarter wave at each end
  var v = w.via, n = w.n, xf = v[1][0], xl = v[n][0], t;
  if (x <= xf) { t = Math.max(0, (x - v[0][0]) / (xf - v[0][0])); return v[0][1] + (v[1][1] - v[0][1]) * Math.sin(PI * t / 2); }
  if (x >= xl) { t = Math.min(1, (x - xl) / (v[n + 1][0] - xl)); return v[n + 1][1] + (v[n][1] - v[n + 1][1]) * Math.cos(PI * t / 2); }
  var j = 1; while (j < n && x > v[j + 1][0]) j++;
  t = (x - v[j][0]) / (v[j + 1][0] - v[j][0]);
  return v[j][1] + (v[j + 1][1] - v[j][1]) * (1 - Math.cos(PI * t)) / 2;
};
BN.slalom.dev = function (w, p) { return Math.abs(p[1] - BN.slalom.yref(w, p[0])); };          // vertical distance from the expert's path (the path is a graph over x)
BN.slalom.collide = function (w, p) {
  for (var i = 0; i < w.posts.length; i++) if (Math.hypot(p[0] - w.posts[i][0], p[1] - w.posts[i][1]) < SW.postR + SW.grip) return true;
  return false;
};
BN.slalom.horizon = function (w) { return Math.ceil((BN.slalom.xEnd(w) - BN.slalom.xStart()) / (SW.speed * 0.05) * 1.6); };   // 1.6 × the expert's time
BN.slalom.startQ = function (w, dy) { var x = BN.slalom.xStart(); return BN.arm.ik([x, BN.slalom.yref(w, x) + (dy || 0)], 1, w.body); };
/* the expert: aim at the point 6 cm further along the path and move there at 15 cm/s (a carrot on a stick), slowing at the end; joint velocities by damped least squares */
BN.slalom.expertAct = function (w, q) {
  var p = BN.arm.fk(q, w.body), xe = BN.slalom.xEnd(w), xa = Math.min(xe, p[0] + SW.look), tgt = [xa, BN.slalom.yref(w, xa)];
  var v = [tgt[0] - p[0], tgt[1] - p[1]], d = Math.hypot(v[0], v[1]) || 1e-9, sp = SW.speed * Math.min(1, Math.max(0, (xe - p[0]) / 0.06 + 0.1));
  return BN.arm.dls(BN.arm.jac(q, w.body), [v[0] / d * sp, v[1] / d * sp], 1e-4);
};

/* ───────────────────────────── rollouts, datasets, evaluation ───────────────────────────── */
/* BN.rollout(w, policy, rng, o): policy(q, t) → [u1, u2].  o: plant (params for BN.plant) or noise (std rad/s), jit (std of the start offset in m),
 * q0, T (steps), kick {t, dq} (a shove of the joints at step t), onStep(t, q, p) (for animations).
 * Returns {S: joint states, P: end-effector positions, A: commands, dev: distance from the expert's path, coll, done, steps, T}. */
BN.rollout = function (w, policy, rng, o) {
  o = o || {};
  var pl = BN.plant(o.plant || { noise: o.noise || 0 }), T = o.T || BN.slalom.horizon(w);
  pl.reset(o.q0 || BN.slalom.startQ(w, o.jit ? o.jit * BN.randn(rng) : 0));
  var S = [], P = [], A = [], dev = [], coll = false, done = false, steps = T, xe = BN.slalom.xEnd(w);
  for (var t = 0; t < T; t++) {
    var q = pl.q, p = BN.arm.fk(q, w.body);
    S.push([q[0], q[1]]); P.push(p); dev.push(BN.slalom.dev(w, p));
    if (BN.slalom.collide(w, p)) { coll = true; steps = t; break; }
    if (p[0] > xe - 0.02) { done = true; steps = t; break; }
    var u = policy([q[0], q[1]], t); A.push(u);
    if (o.onStep) o.onStep(t, q, p);
    if (o.kick && o.kick.t === t) { pl.q[0] += o.kick.dq[0]; pl.q[1] += o.kick.dq[1]; }
    pl.step(u, rng);
  }
  return { S: S, P: P, A: A, dev: dev, coll: coll, done: done, steps: steps, T: T };
};
BN.expertPolicy = function (w) { return function (q) { return BN.slalom.expertAct(w, q); }; };
/* run the expert `count` times from jittered starts; returns the rollouts */
BN.demos = function (w, count, rng, o) {
  o = o || {}; var out = [];
  for (var k = 0; k < count; k++) out.push(BN.rollout(w, BN.expertPolicy(w), rng, { noise: o.noise, plant: o.plant, jit: o.jit === undefined ? 0.01 : o.jit }));
  return out;
};
/* evaluate a policy on N fresh rollouts (seeded): success, collision, timeout rates with a Wilson interval, plus the mean per-step distance
 * from the expert's path.  o as for BN.rollout; o.world(rng, k) may return a different world per rollout. */
BN.evaluate = function (w, policy, N, seed, o) {
  o = o || {}; var rng = BN.rng(seed), ok = 0, co = 0, rolls = [], devsum = 0, devn = 0, T = o.T || BN.slalom.horizon(w), k;
  for (k = 0; k < N; k++) {
    var wk = o.world ? o.world(rng, k) : w, ro = BN.rollout(wk, policy(wk, k), rng, { noise: o.noise, plant: o.plant, jit: o.jit, T: T, kick: o.kick });
    if (ro.done) ok++; if (ro.coll) co++; rolls.push(ro);
    for (var t = 0; t < ro.dev.length; t++) { devsum += ro.dev[t]; devn++; }
  }
  var ci = BN.stats.wilson(ok, N);
  return { N: N, succ: ok / N, coll: co / N, timeout: 1 - (ok + co) / N, ci: ci, meanDev: devsum / Math.max(1, devn), rolls: rolls, T: T };
};
/* cumulative cost curve C(t): expected number of the first t steps that were lost, where a step is lost if the cup has collided (absorbing),
 * or, when tube is given, if it is farther than `tube` metres from the expert's path.  rolls from BN.evaluate. */
BN.costCurve = function (rolls, T, tube) {
  var C = new Float64Array(T + 1), n = rolls.length, i, t;
  for (i = 0; i < n; i++) {
    var ro = rolls[i], lost = 0;
    for (t = 0; t < T; t++) {
      var bad = ro.coll && t >= ro.steps;
      if (!bad && tube !== undefined && t < ro.dev.length && ro.dev[t] > tube) bad = true;
      if (!bad && !ro.done && !ro.coll && t >= ro.dev.length) bad = true;
      if (bad) lost++;
      C[t + 1] += lost / n;
    }
  }
  return C;
};

/* ───────────────────────────── learners ───────────────────────────── */
/* NW: the nearest-demo policy, a Nadaraya–Watson kernel regressor.  Training is storing the data; a prediction is the average of the stored outputs
 * of the stored inputs near the query, weighted by exp(−½ Σ((xᵢ−qᵢ)/hᵢ)²) and cut to zero beyond three bandwidths (Σ(...)² > 9).  h is one bandwidth per input
 * dimension.  A query with nothing stored within three bandwidths copies the single nearest stored input (far:'nearest', the default) or returns zeros (far:'zero'). */
BN.NW = function (h) {
  this.h = h.slice(); this.d = h.length; this.cell = h.map(function (v) { return 3 * v; }); this.X = []; this.Y = []; this.g = {}; this.brute = h.length > 4;
};
var NW = BN.NW.prototype;
NW.key = function (c) { var k = 0; for (var i = 0; i < c.length; i++) k = k * 2048 + (c[i] + 1024); return k; };
NW.add = function (x, y) {
  var id = this.X.length; this.X.push(x); this.Y.push(y);
  if (this.brute) return id;
  var k = this.key(x.map(function (v, i) { return Math.floor(v / this.cell[i]); }, this)), a = this.g[k];
  if (!a) this.g[k] = a = []; a.push(id); return id;
};
NW.each = function (x, fn) {                                          // visit every stored input in the cells around x
  var d = this.d, i, a, t;
  if (this.brute) { for (i = 0; i < this.X.length; i++) fn(i); return; }
  if (d === 2) {
    var c0 = Math.floor(x[0] / this.cell[0]) + 1024, c1 = Math.floor(x[1] / this.cell[1]) + 1024;
    for (var i0 = -1; i0 <= 1; i0++) for (var i1 = -1; i1 <= 1; i1++) { a = this.g[(c0 + i0) * 2048 + c1 + i1]; if (a) for (t = 0; t < a.length; t++) fn(a[t]); }
    return;
  }
  var c = x.map(function (v, j) { return Math.floor(v / this.cell[j]); }, this), idx = [], self = this;
  var rec = function (j) {
    if (j === d) { a = self.g[self.key(c.map(function (v, m) { return v + idx[m]; }))]; if (a) for (var u = 0; u < a.length; u++) fn(a[u]); return; }
    for (var o = -1; o <= 1; o++) { idx[j] = o; rec(j + 1); }
  };
  rec(0);
};
NW.dist2 = function (id, x) { var s = this.X[id], e = 0; for (var i = 0; i < this.d; i++) { var z = (s[i] - x[i]) / this.h[i]; e += z * z; } return e; };
NW.weights = function (x) {
  var ids = [], ws = [], tot = 0, self = this;
  this.each(x, function (id) { var e = self.dist2(id, x); if (e <= 9) { var w = Math.exp(-0.5 * e); ids.push(id); ws.push(w); tot += w; } });
  return { ids: ids, ws: ws, tot: tot };
};
NW.nearest = function (x) {
  var best = -1, bd = Infinity, i;
  for (i = 0; i < this.X.length; i++) { var e = this.dist2(i, x); if (e < bd) { bd = e; best = i; } }
  return best;
};
NW.predict = function (x, o) {
  var dy = this.Y.length ? this.Y[0].length : 0, out = new Array(dy), tot = 0, self = this, j;
  for (j = 0; j < dy; j++) out[j] = 0;
  this.each(x, function (id) {
    var e = self.dist2(id, x); if (e > 9) return;
    var w = Math.exp(-0.5 * e), y = self.Y[id]; tot += w; for (var m = 0; m < dy; m++) out[m] += w * y[m];
  });
  if (tot < 1e-12) {
    if (o && o.far === 'zero') return out;
    var nb = this.nearest(x); return nb < 0 ? out : this.Y[nb].slice();
  }
  for (j = 0; j < dy; j++) out[j] /= tot;
  return out;
};
NW.sample = function (x, rng) {                                       // pick one stored example with probability ∝ kernel weight (−1 if none near)
  var r = this.weights(x); if (r.tot < 1e-12) return -1;
  var u = rng() * r.tot, k = 0; while (k < r.ws.length - 1 && u > r.ws[k]) { u -= r.ws[k]; k++; }
  return r.ids[k];
};
Object.defineProperty(NW, 'n', { get: function () { return this.X.length; } });

/* RFF: ridge regression on p random Fourier features cos(Wx + b), the smooth contrast to NW.  Normal equations are accumulated, so adding data
 * is cheap and solve() is one Cholesky.  lam is the ridge strength per 1000 samples. */
BN.RFF = function (din, dout, p, bw, lam, seed) {
  var r = BN.rng(seed || 1), i;
  this.din = din; this.dout = dout; this.p = p; this.lam = lam; this.Wf = new Float64Array(p * din); this.bf = new Float64Array(p);
  for (i = 0; i < p * din; i++) this.Wf[i] = BN.randn(r) / bw; for (i = 0; i < p; i++) this.bf[i] = 2 * PI * r();
  this.A = new Float64Array((p + 1) * (p + 1)); this.B = new Float64Array((p + 1) * dout); this.n = 0; this.coef = null; this.scale = Math.sqrt(2 / p);
};
var RF = BN.RFF.prototype;
RF.feat = function (x, out) {
  var p = this.p, din = this.din; out = out || new Float64Array(p + 1);
  for (var j = 0; j < p; j++) { var s = this.bf[j]; for (var i = 0; i < din; i++) s += this.Wf[j * din + i] * x[i]; out[j] = this.scale * Math.cos(s); }
  out[p] = 1; return out;
};
RF.add = function (X, Y) {
  var P = this.p + 1, f = new Float64Array(P), n, a, b, k;
  for (n = 0; n < X.length; n++) {
    this.feat(X[n], f);
    for (a = 0; a < P; a++) { var fa = f[a], row = a * P; for (b = a; b < P; b++) this.A[row + b] += fa * f[b]; for (k = 0; k < this.dout; k++) this.B[a * this.dout + k] += fa * Y[n][k]; }
    this.n++;
  }
  this.coef = null;
};
RF.solve = function () {
  var P = this.p + 1, d = this.dout, L = new Float64Array(P * P), A = this.A, ridge = this.lam * Math.max(1, this.n) / 1000, i, j, k;
  for (i = 0; i < P; i++) for (j = 0; j <= i; j++) {
    var s = A[j * P + i] + (i === j ? ridge : 0); for (k = 0; k < j; k++) s -= L[i * P + k] * L[j * P + k];
    L[i * P + j] = i === j ? Math.sqrt(Math.max(s, 1e-12)) : s / L[j * P + j];
  }
  var C = new Float64Array(P * d);
  for (k = 0; k < d; k++) {
    var y = new Float64Array(P);
    for (i = 0; i < P; i++) { var t = this.B[i * d + k]; for (j = 0; j < i; j++) t -= L[i * P + j] * y[j]; y[i] = t / L[i * P + i]; }
    for (i = P - 1; i >= 0; i--) { var u = y[i]; for (j = i + 1; j < P; j++) u -= L[j * P + i] * C[j * d + k]; C[i * d + k] = u / L[i * P + i]; }
  }
  this.coef = C;
};
RF.predict = function (x) {
  if (!this.coef) this.solve();
  var P = this.p + 1, d = this.dout, f = this.feat(x), out = new Float64Array(d), k, i;
  for (k = 0; k < d; k++) { var s = 0; for (i = 0; i < P; i++) s += f[i] * this.coef[i * d + k]; out[k] = s; }
  return out;
};

/* MLP: tanh network with Adam, from a seed.  sizes = [in, h1, …, out]. */
BN.MLP = function (sizes, seed) {
  var rng = BN.rng(seed || 1), L = sizes.length - 1;
  this.sizes = sizes; this.L = L; this.W = []; this.b = []; this.mW = []; this.vW = []; this.mb = []; this.vb = []; this.t = 0;
  for (var l = 0; l < L; l++) {
    var fi = sizes[l], fo = sizes[l + 1], sc = Math.sqrt(2 / (fi + fo)), W = new Float64Array(fi * fo);
    for (var i = 0; i < W.length; i++) W[i] = sc * BN.randn(rng);
    this.W.push(W); this.b.push(new Float64Array(fo)); this.mW.push(new Float64Array(fi * fo)); this.vW.push(new Float64Array(fi * fo)); this.mb.push(new Float64Array(fo)); this.vb.push(new Float64Array(fo));
  }
};
var MLP = BN.MLP.prototype;
MLP.forward = function (x) {
  var acts = [Float64Array.from(x)], L = this.L;
  for (var l = 0; l < L; l++) {
    var fi = this.sizes[l], fo = this.sizes[l + 1], a = acts[l], W = this.W[l], b = this.b[l], y = new Float64Array(fo);
    for (var j = 0; j < fo; j++) { var s = b[j]; for (var i = 0; i < fi; i++) s += a[i] * W[i * fo + j]; y[j] = l < L - 1 ? Math.tanh(s) : s; }
    acts.push(y);
  }
  return acts;
};
MLP.predict = function (x) { return this.forward(x)[this.L]; };
MLP.backward = function (acts, dOut, g) {
  var L = this.L, d = Float64Array.from(dOut);
  for (var l = L - 1; l >= 0; l--) {
    var fi = this.sizes[l], fo = this.sizes[l + 1], a = acts[l], gW = g.W[l], gb = g.b[l], W = this.W[l];
    for (var j = 0; j < fo; j++) { gb[j] += d[j]; for (var i = 0; i < fi; i++) gW[i * fo + j] += a[i] * d[j]; }
    if (l > 0) { var nd = new Float64Array(fi); for (var i2 = 0; i2 < fi; i2++) { var s = 0; for (var j2 = 0; j2 < fo; j2++) s += W[i2 * fo + j2] * d[j2]; nd[i2] = s * (1 - a[i2] * a[i2]); } d = nd; }
  }
};
MLP.zeroGrad = function () { var g = { W: [], b: [] }; for (var l = 0; l < this.L; l++) { g.W.push(new Float64Array(this.W[l].length)); g.b.push(new Float64Array(this.b[l].length)); } return g; };
MLP.adam = function (g, lr, scale) {
  var b1 = 0.9, b2 = 0.999; this.t++;
  var c1 = 1 - Math.pow(b1, this.t), c2 = 1 - Math.pow(b2, this.t), s = scale === undefined ? 1 : scale;
  for (var l = 0; l < this.L; l++) {
    var W = this.W[l], gw = g.W[l], mW = this.mW[l], vW = this.vW[l], i;
    for (i = 0; i < W.length; i++) { var gi = gw[i] * s; mW[i] = b1 * mW[i] + (1 - b1) * gi; vW[i] = b2 * vW[i] + (1 - b2) * gi * gi; W[i] -= lr * (mW[i] / c1) / (Math.sqrt(vW[i] / c2) + 1e-8); }
    var bb = this.b[l], gb = g.b[l], mb = this.mb[l], vb = this.vb[l];
    for (i = 0; i < bb.length; i++) { var gj = gb[i] * s; mb[i] = b1 * mb[i] + (1 - b1) * gj; vb[i] = b2 * vb[i] + (1 - b2) * gj * gj; bb[i] -= lr * (mb[i] / c1) / (Math.sqrt(vb[i] / c2) + 1e-8); }
  }
};
MLP.fit = function (X, Y, opts) {
  opts = opts || {};
  var n = X.length, epochs = opts.epochs || 100, batch = Math.min(opts.batch || 32, n), lr = opts.lr || 0.01, rng = BN.rng(opts.seed || 7), hist = [], idx = [], i;
  for (i = 0; i < n; i++) idx.push(i);
  for (var ep = 0; ep < epochs; ep++) {
    BN.shuffle(idx, rng); var tot = 0;
    for (var s = 0; s < n; s += batch) {
      var g = this.zeroGrad(), cnt = Math.min(batch, n - s);
      for (var k = 0; k < cnt; k++) {
        var id = idx[s + k], acts = this.forward(X[id]), out = acts[this.L], d = new Float64Array(out.length);
        for (var q = 0; q < out.length; q++) { var e = out[q] - Y[id][q]; d[q] = 2 * e / out.length; tot += e * e / out.length; }
        this.backward(acts, d, g);
      }
      this.adam(g, lr, 1 / cnt);
    }
    hist.push(tot / n);
  }
  return hist;
};

/* k-means (k-means++ seeding, Lloyd iterations): a codebook of prototypes.  X: arrays of equal length. Returns {centers, assign, inertia}. */
BN.kmeans = function (X, K, o) {
  o = o || {};
  var rng = BN.rng(o.seed || 3), n = X.length, d = X[0].length, iters = o.iters || 25, i, k, j;
  var d2 = function (a, b) { var s = 0; for (var q = 0; q < d; q++) { var t = a[q] - b[q]; s += t * t; } return s; };
  var centers = [Float64Array.from(X[Math.floor(rng() * n)])], dist = new Float64Array(n).fill(Infinity);
  while (centers.length < K) {
    var last = centers[centers.length - 1], tot = 0;
    for (i = 0; i < n; i++) { var dd = d2(X[i], last); if (dd < dist[i]) dist[i] = dd; tot += dist[i]; }
    var r = rng() * tot, acc = 0, pick = n - 1;
    for (i = 0; i < n; i++) { acc += dist[i]; if (acc >= r) { pick = i; break; } }
    centers.push(Float64Array.from(X[pick]));
  }
  var assign = new Int32Array(n), inertia = 0;
  for (var it = 0; it < iters; it++) {
    inertia = 0;
    for (i = 0; i < n; i++) { var best = 0, bd = Infinity; for (k = 0; k < K; k++) { var e = d2(X[i], centers[k]); if (e < bd) { bd = e; best = k; } } assign[i] = best; inertia += bd; }
    var sum = [], cnt = new Int32Array(K);
    for (k = 0; k < K; k++) sum.push(new Float64Array(d));
    for (i = 0; i < n; i++) { cnt[assign[i]]++; for (j = 0; j < d; j++) sum[assign[i]][j] += X[i][j]; }
    for (k = 0; k < K; k++) if (cnt[k] > 0) for (j = 0; j < d; j++) centers[k][j] = sum[k][j] / cnt[k];
  }
  return { centers: centers, assign: assign, inertia: inertia };
};

/* ───────────────────────────── drawing ───────────────────────────── */
BN.C = { ink: '#20202a', mute: '#626273', dim: '#9a98aa', grid: '#e7e5ef', teal: '#0f766e', tealSoft: '#d3efe9', purple: '#6d4aff', purpleSoft: '#dcd6ff',
         cyan: '#0891b2', cyanSoft: '#cceef4', amber: '#d97706', amberSoft: '#fde7c6', green: '#15935a', greenSoft: '#d5f2e2', red: '#dc3f55', redSoft: '#f9d8df',
         white: '#ffffff', panel: '#f8f8fc', code: '#f2f1f7' };
BN.draw = {};
var D = BN.draw;
D.setup = function (canvas) {
  var dpr = Math.min((typeof window !== 'undefined' && window.devicePixelRatio) || 1, 3);
  var w = Math.max(280, canvas.clientWidth || 640), h = Math.max(120, canvas.clientHeight || 300), rw = Math.round(w * dpr), rh = Math.round(h * dpr);
  if (canvas.width !== rw || canvas.height !== rh) { canvas.width = rw; canvas.height = rh; }
  var ctx = canvas.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, w, h); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.__w = w;                                                      // logical width: D.text shrinks a label that would run off the canvas
  return { ctx: ctx, w: w, h: h };
};
D.view = function (bx, by, bw, bh, x0, x1, y0, y1) {                 // world (x right, y UP) → canvas
  var s = Math.min(bw / (x1 - x0), bh / (y1 - y0)), ox = bx + (bw - s * (x1 - x0)) / 2, oy = by + (bh - s * (y1 - y0)) / 2;
  return { s: s, ox: ox, oy: oy, bx: bx, by: by, bw: bw, bh: bh, X: function (x) { return ox + (x - x0) * s; }, Y: function (y) { return oy + (y1 - y) * s; },
           ix: function (px) { return x0 + (px - ox) / s; }, iy: function (py) { return y1 - (py - oy) / s; } };
};
D.line = function (ctx, x1, y1, x2, y2, color, width, dash) { ctx.save(); ctx.strokeStyle = color || BN.C.ink; ctx.lineWidth = width || 1; ctx.setLineDash(dash || []); ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke(); ctx.restore(); };
D.dot = function (ctx, x, y, r, fill, stroke) { ctx.beginPath(); ctx.arc(x, y, r, 0, 2 * PI); ctx.fillStyle = fill || BN.C.ink; ctx.fill(); if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 1; ctx.stroke(); } };
D.put = function (ctx, s, x, y, size, align, font) {             // draws s with font(size); a label wider than the room left on the canvas is shrunk (to 70 %), then cut with an ellipsis
  ctx.font = font(size); ctx.textAlign = align || 'left'; ctx.textBaseline = 'middle';
  var W = ctx.__w;
  if (W && typeof ctx.measureText === 'function') {
    var m = ctx.measureText(s), tw = m && m.width, avail = align === 'right' ? x - 3 : align === 'center' ? 2 * Math.min(x, W - x) - 6 : W - x - 3;
    if (tw > 0 && tw > avail && avail > 30) {
      var z = size * avail / tw * 0.97;
      if (z >= size * 0.7) { ctx.font = font(z); for (var i = 0; i < 6 && ctx.measureText(s).width > avail; i++) { z *= 0.96; ctx.font = font(z); } }
      else { ctx.font = font(size * 0.7); while (s.length > 4 && ctx.measureText(s + '…').width > avail) s = s.slice(0, -1); s += '…'; }
    }
  }
  ctx.fillText(s, x, y);
};
D.text = function (ctx, s, x, y, color, size, align, weight) {
  ctx.fillStyle = color || BN.C.ink;
  D.put(ctx, s, x, y, size || 12, align, function (z) { return (weight || 500) + ' ' + z + 'px -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, sans-serif'; });
};
D.mono = function (ctx, s, x, y, color, size, align) {
  ctx.fillStyle = color || BN.C.mute;
  D.put(ctx, s, x, y, size || 10, align, function (z) { return z + 'px "SF Mono", Menlo, Consolas, monospace'; });
};
D.frame = function (ctx, x, y, w, h, fill, stroke) { ctx.save(); ctx.fillStyle = fill || BN.C.panel; ctx.strokeStyle = stroke || BN.C.grid; ctx.lineWidth = 1; ctx.fillRect(x, y, w, h); ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1); ctx.restore(); };
D.path = function (ctx, pts, color, width, dash, alpha) {
  if (pts.length < 2) return; ctx.save(); ctx.strokeStyle = color; ctx.lineWidth = width || 2; ctx.setLineDash(dash || []); if (alpha !== undefined) ctx.globalAlpha = alpha;
  ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]); for (var i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]); ctx.stroke(); ctx.restore();
};
/* the table: posts with their 5 cm halo, the expert's path (dashed), start and goal.  v from D.view */
D.workspace = function (ctx, v, w, o) {
  o = o || {};
  var C = BN.C, i, x;
  ctx.save(); ctx.fillStyle = '#fbfbfe'; ctx.fillRect(v.bx, v.by, v.bw, v.bh); ctx.strokeStyle = C.grid; ctx.lineWidth = 1; ctx.strokeRect(v.bx + 0.5, v.by + 0.5, v.bw - 1, v.bh - 1); ctx.restore();
  if (o.path !== false) {
    var pts = [], x0 = BN.slalom.xStart(), x1 = BN.slalom.xEnd(w);
    for (x = x0; x <= x1 + 1e-9; x += 0.005) pts.push([v.X(x), v.Y(BN.slalom.yref(w, x))]);
    D.path(ctx, pts, C.dim, 1.5, [5, 4]);
  }
  for (i = 0; i < w.posts.length; i++) {
    var p = w.posts[i];
    ctx.save(); ctx.strokeStyle = C.red; ctx.globalAlpha = 0.45; ctx.setLineDash([3, 3]); ctx.beginPath(); ctx.arc(v.X(p[0]), v.Y(p[1]), (SW.postR + SW.grip) * v.s, 0, 2 * PI); ctx.stroke(); ctx.restore();
    D.dot(ctx, v.X(p[0]), v.Y(p[1]), SW.postR * v.s, '#c9c6da', C.dim);
  }
  var q0 = BN.slalom.startQ(w), e0 = BN.arm.fk(q0, w.body);
  D.dot(ctx, v.X(e0[0]), v.Y(e0[1]), 4, C.green); D.mono(ctx, 'start', v.X(e0[0]), v.Y(e0[1]) + 12, C.green, 10, 'center');
  D.dot(ctx, v.X(BN.slalom.xEnd(w)), v.Y(w.posts[w.n - 1][1]), 4, C.teal); D.mono(ctx, 'goal', v.X(BN.slalom.xEnd(w)), v.Y(w.posts[w.n - 1][1]) + 12, C.teal, 10, 'center');
};
D.arm = function (ctx, v, q, body, color, width) {
  body = body || BN.arm.A; var c = color || BN.C.ink, j = [v.X(0), v.Y(0)], e = [body.L1 * Math.cos(q[0]), body.L1 * Math.sin(q[0])], t = BN.arm.fk(q, body);
  ctx.save(); ctx.beginPath(); ctx.rect(v.bx, v.by, v.bw, v.bh); ctx.clip();
  D.path(ctx, [j, [v.X(e[0]), v.Y(e[1])], [v.X(t[0]), v.Y(t[1])]], c, width || 3);
  D.dot(ctx, j[0], j[1], 5, c); D.dot(ctx, v.X(e[0]), v.Y(e[1]), 4, '#ffffff', c); D.dot(ctx, v.X(t[0]), v.Y(t[1]), 5, c);
  ctx.restore();
};
D.trace = function (ctx, v, P, color, width, alpha, dash) { D.path(ctx, P.map(function (p) { return [v.X(p[0]), v.Y(p[1])]; }), color, width, dash, alpha); };
/* a labelled plot with optional log axes.  series: [{xs, ys, color, width, dash, dots, label}].  o: xmin xmax ymin ymax logx logy xticks yticks xlabel ylabel fmtx fmty */
D.plot = function (ctx, series, bx, by, bw, bh, o) {
  o = o || {};
  var C = BN.C, lx = o.logx ? Math.log : function (a) { return a; }, ly = o.logy ? Math.log : function (a) { return a; };
  var X = function (x) { return bx + (lx(x) - lx(o.xmin)) / (lx(o.xmax) - lx(o.xmin)) * bw; }, Y = function (y) { return by + bh - (ly(y) - ly(o.ymin)) / (ly(o.ymax) - ly(o.ymin)) * bh; };
  D.frame(ctx, bx, by, bw, bh, C.white);
  var i, t;
  (o.xticks || []).forEach(function (t) { var px = X(t); D.line(ctx, px, by, px, by + bh, C.grid, 1); D.mono(ctx, (o.fmtx ? o.fmtx(t) : String(t)), px, by + bh + 10, C.mute, 10, 'center'); });
  (o.yticks || []).forEach(function (t) { var py = Y(t); D.line(ctx, bx, py, bx + bw, py, C.grid, 1); D.mono(ctx, (o.fmty ? o.fmty(t) : String(t)), bx - 4, py, C.mute, 10, 'right'); });
  ctx.save(); ctx.beginPath(); ctx.rect(bx, by, bw, bh); ctx.clip();
  series.forEach(function (s) {
    if (s.xs.length > 1 && !s.dotsOnly) { ctx.strokeStyle = s.color || C.teal; ctx.lineWidth = s.width || 2; ctx.setLineDash(s.dash || []); ctx.beginPath(); for (i = 0; i < s.xs.length; i++) { if (i) ctx.lineTo(X(s.xs[i]), Y(s.ys[i])); else ctx.moveTo(X(s.xs[i]), Y(s.ys[i])); } ctx.stroke(); }
    if (s.dots || s.dotsOnly) for (i = 0; i < s.xs.length; i++) D.dot(ctx, X(s.xs[i]), Y(s.ys[i]), s.r || 3, s.color || C.teal);
  });
  ctx.restore();
  if (o.xlabel) D.text(ctx, o.xlabel, bx + bw / 2, by + bh + 26, C.mute, 11, 'center');
  if (o.ylabel) D.text(ctx, o.ylabel, bx, by - 8, C.mute, 11, 'left');
  return { X: X, Y: Y };
};

root.BN = BN;
if (typeof module !== 'undefined' && module.exports) module.exports = BN;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
