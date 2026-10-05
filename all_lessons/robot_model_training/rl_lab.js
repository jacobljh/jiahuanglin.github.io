/* rl_lab.js — lesson 12's private engine: improving a policy from a score alone, on the Bench.
 *
 * The score of one attempt is 1 if the cup reaches the mat, touches no post and stays on the table (the table's edge is EDGE = 15 cm either side of the row of posts), else 0;
 * the "plus progress" score adds the share of the course covered.  An attempt costs RL.PRICE = 30 s of robot time, the reset included.
 *   Table      a policy that is a table of joint velocities on a grid of joint angles (spacing s over RL.BOX), read by bilinear interpolation; its d = 2 x nodes numbers are theta.
 *   makePrior  the lesson-1 clone (20 calm demonstrations, nearest-demo regression) stored as a fine lookup table, so that it costs one table read per step.
 *   makeAct    the three starts: scratch  u = table(q; theta);   free  u = prior(q) + table(q; theta);   residual  u = prior(q) + clip(table(q; theta), +-rho).
 *   Learner    the estimator of the lesson: N mirrored pairs theta +- sigma eps (both members of a pair meet the same gusts), each scored by one attempt;
 *              theta += eta sigma (1/N) sum_k z_k eps_k with z_k = (R+ - R-) / (2 S), S the spread of the 2N scores (no update when every score is equal).
 *              Every CK attempts the mean policy is scored on a fixed set of EVAL_N runs; that is the learning curve.
 * Deterministic: BN.rng only.
 */
(function (root) {
'use strict';
var BN = root.BN || require('./bench.js');
var RL = {};
var cos = Math.cos, sin = Math.sin, sqrt = Math.sqrt, log = Math.log, floor = Math.floor, ceil = Math.ceil, imul = Math.imul, max = Math.max, min = Math.min, abs = Math.abs, PI = Math.PI;
RL.DT = 0.05; RL.JIT = 0.01; RL.GUST = 0.05; RL.EDGE = 0.15; RL.PRICE = 30;
RL.BOX = { lo: [-0.1, 1.1], hi: [1.7, 2.3] };             // the joint angles every table covers (the expert's own states lie inside, with margin)
RL.EVAL_N = 100; RL.EVAL_SEED = 9000; RL.CK = 60; RL.MAXATT = 3000; RL.TARGET = 0.9;
RL.PRIOR_S = 0.01;                                         // spacing of the lookup table that stores the clone (rad)

/* the Bench's generator and Gaussian, copied with local function references (identical numbers, several times faster where globals are slow) */
RL.rng = function (seed) {
  var a = (seed >>> 0) || 1;
  return function () { a = (a + 0x6D2B79F5) >>> 0; var t = a; t = imul(t ^ (t >>> 15), t | 1); t ^= t + imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
};
RL.randn = function (rng) { var u = 0; while (u === 0) u = rng(); return sqrt(-2 * log(u)) * cos(2 * PI * rng()); };

/* the course as the learner meets it: n posts, the row shifted up by `shift` metres */
RL.course = function (n, shift) {
  var w = BN.slalom.world(n, { shift: shift || 0 });
  return { w: w, n: n, shift: shift || 0, T: BN.slalom.horizon(w), xs: BN.slalom.xStart(), xe: BN.slalom.xEnd(w), row: w.posts[0][1], rc: BN.slalom.W.postR + BN.slalom.W.grip };
};
/* one attempt from a jittered start under the gust.  act(q, u) writes the command into u.  edge: leaving the table ends the attempt.
 * Returns {done, hit, out, prog}; with trace (an array) the end-effector positions are pushed into it. */
RL.attempt = function (C, act, seed, edge, trace) {
  var rng = RL.rng(seed), w = C.w, L1 = w.body.L1, L2 = w.body.L2, posts = w.posts, np = posts.length, rc = C.rc, noise = RL.GUST, dt = RL.DT;
  var q = BN.slalom.startQ(w, RL.JIT * RL.randn(rng)).slice(), u = [0, 0], xmax = -9, done = false, hit = false, out = false, t;
  for (t = 0; t < C.T; t++) {
    var px = L1 * cos(q[0]) + L2 * cos(q[0] + q[1]), py = L1 * sin(q[0]) + L2 * sin(q[0] + q[1]);
    if (trace) trace.push([px, py]);
    for (var i = 0; i < np; i++) { var dx = px - posts[i][0], dy = py - posts[i][1]; if (dx * dx + dy * dy < rc * rc) { hit = true; break; } }
    if (hit) break;
    if (edge && abs(py - C.row) > RL.EDGE) { out = true; break; }
    if (px > C.xe - 0.02) { done = true; break; }
    if (px > xmax) xmax = px;
    act(q, u);
    q[0] += dt * (max(-1.5, min(1.5, u[0])) + noise * RL.randn(rng));
    q[1] += dt * (max(-1.5, min(1.5, u[1])) + noise * RL.randn(rng));
  }
  return { done: done, hit: hit, out: out, prog: max(0, min(1, (xmax - C.xs) / (C.xe - 0.02 - C.xs))), steps: t };
};
RL.score = function (r, kind) { return kind === 'sparse' ? (r.done ? 1 : 0) : r.prog + (r.done ? 1 : 0); };
RL.evalSeeds = function () { var a = [], k; for (k = 0; k < RL.EVAL_N; k++) a.push(RL.EVAL_SEED + k); return a; };
RL.success = function (C, act, seeds, edge) { var ok = 0, k; for (k = 0; k < seeds.length; k++) if (RL.attempt(C, act, seeds[k], edge).done) ok++; return ok / seeds.length; };

/* a table of 2-vectors on a grid of joint angles with spacing s; theta holds nodes row by row, 2 numbers per node */
RL.Table = function (s, box) {
  box = box || RL.BOX; this.lo = box.lo; this.s = s;
  this.nx = ceil((box.hi[0] - box.lo[0]) / s - 1e-9) + 1; this.ny = ceil((box.hi[1] - box.lo[1]) / s - 1e-9) + 1; this.d = 2 * this.nx * this.ny;
};
RL.Table.prototype.read = function (th, q, u) {
  var s = this.s, nx = this.nx, ny = this.ny, fx = (q[0] - this.lo[0]) / s, fy = (q[1] - this.lo[1]) / s;
  if (fx < 0) fx = 0; else if (fx > nx - 1.000001) fx = nx - 1.000001;
  if (fy < 0) fy = 0; else if (fy > ny - 1.000001) fy = ny - 1.000001;
  var i = floor(fx), j = floor(fy), tx = fx - i, ty = fy - j, k = 2 * (i * ny + j), k2 = k + 2 * ny;
  var a = (1 - tx) * (1 - ty), b = (1 - tx) * ty, c = tx * (1 - ty), e = tx * ty;
  u[0] = a * th[k] + b * th[k + 2] + c * th[k2] + e * th[k2 + 2];
  u[1] = a * th[k + 1] + b * th[k + 3] + c * th[k2 + 1] + e * th[k2 + 3];
};

/* the lesson-1 clone: 20 calm demonstrations on the n-post course, nearest-demo regression (h = 0.02 rad), tabulated every RL.PRIOR_S rad */
RL.makePrior = function (n) {
  var w = BN.slalom.world(n), nw = new BN.NW([0.02, 0.02]), runs = BN.demos(w, 20, BN.rng(1), { noise: 0, jit: RL.JIT }), tb = new RL.Table(RL.PRIOR_S), th = new Float64Array(tb.d), i, j, t;
  runs.forEach(function (ro) { for (t = 0; t < ro.A.length; t++) nw.add(ro.S[t], ro.A[t]); });
  for (i = 0; i < tb.nx; i++) for (j = 0; j < tb.ny; j++) { var a = nw.predict([tb.lo[0] + i * tb.s, tb.lo[1] + j * tb.s]), k = 2 * (i * tb.ny + j); th[k] = a[0]; th[k + 1] = a[1]; }
  return { tb: tb, th: th, n: n, frames: nw.n };
};
/* start: 'scratch' | 'free' | 'residual'.  th is read at call time, so one closure serves every update. */
RL.makeAct = function (start, tb, th, rho, prior) {
  var v = [0, 0], p = [0, 0];
  return function (q, u) {
    tb.read(th, q, v);
    if (start === 'scratch') { u[0] = v[0]; u[1] = v[1]; return; }
    if (start === 'residual') { v[0] = max(-rho, min(rho, v[0])); v[1] = max(-rho, min(rho, v[1])); }
    prior.tb.read(prior.th, q, p); u[0] = p[0] + v[0]; u[1] = p[1] + v[1];
  };
};

/* the learner.  cfg: C (course), edge, s (table spacing), start, reward ('sparse'|'plus'), sigma, eta, N, rho, prior, seed, snap (keep a copy of theta at every checkpoint, default true) */
RL.Learner = function (cfg) {
  this.cfg = cfg; this.tb = new RL.Table(cfg.s); this.d = this.tb.d; var d = this.d, k;
  this.th = new Float64Array(d); this.tp = new Float64Array(d); this.tm = new Float64Array(d);
  this.eps = []; for (k = 0; k < cfg.N; k++) this.eps.push(new Float64Array(d));
  this.rng = RL.rng(cfg.seed * 7919 + 13); this.att = 0; this.wins = 0; this.first = -1; this.winlog = []; this.nextCk = 0; this.seeds = RL.evalSeeds();
  this.actP = RL.makeAct(cfg.start, this.tb, this.tp, cfg.rho, cfg.prior); this.actM = RL.makeAct(cfg.start, this.tb, this.tm, cfg.rho, cfg.prior); this.actMean = RL.makeAct(cfg.start, this.tb, this.th, cfg.rho, cfg.prior);
  this.curve = []; this.snaps = []; this.R = new Float64Array(2 * cfg.N); this.checkpoint();
};
RL.Learner.prototype.checkpoint = function () {
  this.curve.push([this.att, RL.success(this.cfg.C, this.actMean, this.seeds, this.cfg.edge)]); if (this.cfg.snap !== false) this.snaps.push(Float64Array.from(this.th)); this.winlog.push(this.wins); this.nextCk += RL.CK;
};
RL.Learner.prototype.step = function () {
  var c = this.cfg, N = c.N, sig = c.sigma, d = this.d, th = this.th, tp = this.tp, tm = this.tm, R = this.R, i, k;
  for (k = 0; k < N; k++) {
    var e = this.eps[k], sd = 100000 + c.seed * 1000003 + this.att + 2 * k;
    for (i = 0; i < d; i++) { e[i] = RL.randn(this.rng); tp[i] = th[i] + sig * e[i]; tm[i] = th[i] - sig * e[i]; }
    var rp = RL.attempt(c.C, this.actP, sd, c.edge), rm = RL.attempt(c.C, this.actM, sd, c.edge);
    R[2 * k] = RL.score(rp, c.reward); R[2 * k + 1] = RL.score(rm, c.reward); this.wins += (rp.done ? 1 : 0) + (rm.done ? 1 : 0);
  }
  this.att += 2 * N; if (this.first < 0 && this.wins > 0) this.first = this.att;
  var m = 0, v = 0; for (i = 0; i < 2 * N; i++) m += R[i]; m /= 2 * N; for (i = 0; i < 2 * N; i++) v += (R[i] - m) * (R[i] - m);
  var S = sqrt(v / (2 * N)); if (S < 1e-9) return;                       // every attempt scored the same: nothing to keep
  for (k = 0; k < N; k++) { var z = (R[2 * k] - R[2 * k + 1]) / (2 * S), a = c.eta * sig * z / N, ek = this.eps[k]; for (i = 0; i < d; i++) th[i] += a * ek[i]; }
};
RL.Learner.prototype.advance = function (target) {
  target = min(target, RL.MAXATT);
  while (this.att < target) { this.step(); if (this.att >= this.nextCk) this.checkpoint(); }
};
/* first checkpoint at which the mean policy completes at least `frac` of the evaluation runs (Infinity if none yet) */
RL.attemptsTo = function (curve, frac) { for (var i = 0; i < curve.length; i++) if (curve[i][1] >= (frac || RL.TARGET) - 1e-9) return curve[i][0]; return Infinity; };

/* the estimator on its own: mirrored pairs on any scalar function f of a parameter vector; returns the estimate of the gradient of the smoothed score */
RL.gradient = function (f, theta, sigma, N, rng) {
  var d = theta.length, g = new Float64Array(d), tp = new Float64Array(d), tm = new Float64Array(d), e = new Float64Array(d), i, k;
  for (k = 0; k < N; k++) {
    for (i = 0; i < d; i++) { e[i] = RL.randn(rng); tp[i] = theta[i] + sigma * e[i]; tm[i] = theta[i] - sigma * e[i]; }
    var z = (f(tp) - f(tm)) / (2 * sigma * N); for (i = 0; i < d; i++) g[i] += z * e[i];
  }
  return g;
};

root.RL = RL;
if (typeof module !== 'undefined' && module.exports) module.exports = RL;
})(typeof window !== 'undefined' ? window : globalThis);
