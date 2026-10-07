/* l10_reality.js — Lesson 10 (a little reality): what a real labelled frame is worth, by what it is spent on.  Namespace SV.l10.  Browser and node; load after street.js.
 * The calibration also needs evidence.js, l03_camera.js, l04_light.js, l05_cases.js and l05_data.js (the ruler's two constants); the page needs only the last two.
 *
 * THE BUDGET.  A project holds unlimited renders, unlimited unlabelled logs (SV.evidence.logs), one bench session of the camera (SV.l03.kit) and M real labelled frames (SV.real.labeled).
 * A labelled frame can be spent on three things, and each one outputs something different:
 *   grade       a number: the miss rate and its interval (Wilson), on frames the detector never saw       SV.l10.wilson, halfWidth, pedsFor, framesFor, pairedSd, thrDraw
 *   calibrate   a program: the scene's few parameters read off the outlines by Lesson 5's ruler, the camera and the light read off free evidence (Lessons 3 and 4)    SV.l10.evidence, calibrate
 *   fine-tune   a detector: the M frames join the synthetic frames in one weighted training       SV.l10.mix, trainMix
 * and the exchange rate between a real and a synthetic frame is read off the learning curves:  SV.l10.fitCurve (real-only miss against M) and realEq (the real-only size that matches a miss rate).
 * The last part is one worked calculation, the exit: the exam's miss rate is per frame, the shuttle needs a probability per approach (stopDistance, framesBefore, noDetect).
 * Deterministic: no Math.random, no Date.  Seeds of this lesson: 20,000,000 and up (SV.l10.SEED). */
(function (root) {
'use strict';
var SV = root.SV, L = {};
SV.l10 = L;

/* the seed blocks of this lesson, one afternoon (replicate r = 0, 1, 2) per block:  bench kit -> SV.l03.kit(1, KIT + r);  logs; labelled stream; synthetic training frames; pools */
L.SEED = { kit: 140, logs: 21000000, labelled: 22000000, train: 23000000, negPool: 24000000, pedPool: 25000000, step: 10000 };
L.M = [25, 50, 100, 200, 400, 800, 1600];            // the budgets of the learning curves (M = 0 means no labelled frame: only what needs none)
L.N = 1600;                                          // synthetic frames in every synthetic training set
L.Z95 = 1.959964;                                    // the 97.5th percentile of the standard normal distribution

/* ───────────────────────────── grading: a miss rate is a binomial proportion over the pedestrians that count ───────────────────────────── */
/* Wilson's score interval for k misses among n pedestrians (Wilson, 1927): the p that a sample of n puts within z standard errors of k/n; it does not collapse at 0 or n */
L.wilson = function (k, n, z) {
  z = z || L.Z95;
  var p = k / n, z2 = z * z, d = 1 + z2 / n, c = (p + z2 / (2 * n)) / d, h = z * Math.sqrt(p * (1 - p) / n + z2 / (4 * n * n)) / d;
  return [c - h, c + h];
};
L.halfWidth = function (p, n, z) { return (z || L.Z95) * Math.sqrt(p * (1 - p) / n); };            // the normal-approximation half-width z sqrt(p (1 - p) / n)
L.pedsFor = function (p, h, z) { z = z || L.Z95; return z * z * p * (1 - p) / (h * h); };            // pedestrians that make the half-width h
L.framesFor = function (p, h, ppf) { return L.pedsFor(p, h) / ppf; };                                // frames, when a labelled frame holds ppf counted pedestrians on average
/* the difference of two miss rates graded on the SAME pedestrians: hits ha, hb (0/1 per pedestrian).  Their difference is a mean of paired values, so its variance is
 * (b + c)/n^2 - (b - c)^2/n^3, b and c = the pedestrians one detector finds and the other misses; two independent samples would give the sum of the two binomial variances. */
L.pairedSd = function (ha, hb) {
  var n = ha.length, b = 0, c = 0, i;
  for (i = 0; i < n; i++) { if (ha[i] && !hb[i]) b++; if (!ha[i] && hb[i]) c++; }
  return Math.sqrt((b + c) / (n * n) - Math.pow(b - c, 2) / (n * n * n));
};
L.unpairedSd = function (pa, pb, n) { return Math.sqrt(pa * (1 - pa) / n + pb * (1 - pb) / n); };
/* the threshold of the exam is a quantile of the pedestrian-free scores: draw m0 of them (with replacement, from a pool) and take the score that lets a tenth alarm */
L.thrDraw = function (pool, m0, rng, fa) {
  var s = new Array(m0), i;
  for (i = 0; i < m0; i++) s[i] = pool[Math.floor(rng() * pool.length)];
  return SV.thrAtFPR(s, fa === undefined ? SV.EXAM.fa : fa);
};
L.missAt = function (scores, thr) { var k = 0, i; for (i = 0; i < scores.length; i++) if (!(scores[i] > thr)) k++; return k / scores.length; };

/* ───────────────────────────── calibrating: the program's parameters from evidence ───────────────────────────── */
/* The evidence of replicate r: a bench session of size 1 (11 exposures of a card, an edge, 30 exposure-log frames), 1,000 unlabelled logs and a stream of labelled frames of which a
 * project holds the first M.  Each function returns only what a project would hold: frames and the camera's gain for the logs, outlines for the labelled frames. */
L.evidence = function (r, M, o) {
  o = o || {};
  var S = L.SEED, ev = {};
  ev.kit = SV.l03.kit(1, S.kit + r);
  ev.logs = SV.evidence.logs(o.logs || 1000, S.logs + S.step * r);
  ev.labelled = M > 0 ? SV.real.labeled(M, S.labelled + S.step * r) : [];
  return ev;
};
/* the labelled stream of afternoon r, drawn lazily: grow(n) renders frames until n are held and keeps only what a project keeps of them, the outline and the ruler's reading of each */
L.stream = function (r) {
  var S = { rs: [] };
  S.grow = function (n) {
    while (S.rs.length < n) S.rs.push(SV.l05.ruler(SV.l05.labelSample(SV.sample(SV.REAL, L.SEED.labelled + L.SEED.step * r + S.rs.length))));
    return S;
  };
  return S;
};
/* the scene settings the labelled frames support: the labeller turns the maps into outlines (Lesson 5), the ruler reads the foot row of each pedestrian, and the estimate keeps the nearest
 * and farthest open pedestrian and the step-out probability; bias and kappa are the ruler's two constants, measured once on the PROGRAM's own frames (SV.L05.calib) */
L.sceneFrom = function (frames, calib) {
  var c = calib || SV.L05.calib, rs = frames.map(function (fr) { return SV.l05.ruler(SV.l05.labelSample(fr)); });
  return SV.l05.estimate(rs, { bias: c.bias, kappa: c.kappa });
};
/* the calibrated program: the naive program (SIM0) with the camera read from the bench session, the brightness range read from the logs, and the pedestrians' distance range and
 * step-out probability read from the labelled frames.  Whatever the evidence does not reach (the clutter, the van, the label rule) stays the naive program's. */
L.calibrate = function (ev) {
  var est = {}, pipe = { name: 'calibrated', scene: SV.clone(SV.SIM0.scene), look: SV.clone(SV.SIM0.look), sensor: SV.clone(SV.SIM0.sensor), label: SV.clone(SV.SIM0.label) };
  est.cam = SV.l03.calibrate(ev.kit.flats, ev.kit.edges, ev.kit.logs);
  pipe.sensor = SV.l03.camOf(est.cam);
  est.light = SV.l04.estimate(ev.logs);
  pipe.look = SV.l04.estimatedLook(est.light, ['lum']);
  if (ev.labelled && ev.labelled.length) {
    est.scene = L.sceneFrom(ev.labelled);
    pipe = SV.l05.scenePipe(pipe, { z: [est.scene.zlo, est.scene.zhi], pEmerge: est.scene.pEmerge });
  }
  return { pipe: pipe, est: est };
};

/* ───────────────────────────── fine-tuning: real frames join the synthetic ones in one weighted training ───────────────────────────── */
/* weights: a synthetic frame 1; a real frame wReal.  The rule of the lesson: the real frames weigh as much in total as the synthetic ones, wReal = nSyn / nReal. */
L.balance = function (nSyn, nReal) { return nSyn / nReal; };
L.mix = function (syn, real, wReal) {
  var w = new Array(syn.length + real.length), i;
  for (i = 0; i < syn.length; i++) w[i] = 1;
  for (i = 0; i < real.length; i++) w[syn.length + i] = wReal === undefined ? L.balance(syn.length, real.length) : wReal;
  return { frames: syn.concat(real), weights: w };
};
L.trainMix = function (syn, real, o) {
  o = o || {};
  var m = L.mix(syn, real, o.wReal);
  return SV.train(m.frames, { seed: o.seed || 1, weights: m.weights });
};

/* ───────────────────────────── the exchange rate: a learning curve and its inverse ───────────────────────────── */
/* the real-only learning curve  miss(M) = a + b M^(-c)  fitted to points (M_i, miss_i) by least squares: for each exponent c on a grid the two linear parameters are solved exactly */
L.fitCurve = function (Ms, miss) {
  var best = null, c, n = Ms.length, i;
  for (c = 0.05; c <= 2.0001; c += 0.005) {
    var x = Ms.map(function (m) { return Math.pow(m, -c); }), sx = 0, sy = 0, sxx = 0, sxy = 0;
    for (i = 0; i < n; i++) { sx += x[i]; sy += miss[i]; sxx += x[i] * x[i]; sxy += x[i] * miss[i]; }
    var det = n * sxx - sx * sx, b = (n * sxy - sx * sy) / det, a = (sy - b * sx) / n, e = 0;
    for (i = 0; i < n; i++) { var d = miss[i] - a - b * x[i]; e += d * d; }
    if (b > 0 && a >= 0 && (!best || e < best.sse)) best = { a: a, b: b, c: c, sse: e, n: n };
  }
  return best;
};
L.curveAt = function (f, M) { return f.a + f.b * Math.pow(M, -f.c); };
/* the number of real-only frames at which the curve reaches miss rate m; Infinity if m is at or below the curve's floor a */
L.realEq = function (f, m) { return m <= f.a ? Infinity : Math.pow((m - f.a) / f.b, -1 / f.c); };
/* the first budget at which a curve (points Ms, values ys, linear in log M between points) is at or below the level m: null if it never is */
L.crossing = function (Ms, ys, m) {
  var i;
  if (ys[0] <= m) return Ms[0];
  for (i = 1; i < Ms.length; i++) if (ys[i] <= m) { var t = (ys[i - 1] - m) / (ys[i - 1] - ys[i]); return Math.exp(Math.log(Ms[i - 1]) + t * (Math.log(Ms[i]) - Math.log(Ms[i - 1]))); }
  return null;
};

/* a curve through the points (Ms[i], ys[i]), linear in log M between them and flat beyond the ends */
L.interp = function (Ms, ys, M) {
  var i;
  if (M <= Ms[0]) return ys[0];
  for (i = 1; i < Ms.length; i++) if (M <= Ms[i]) { var t = (Math.log(M) - Math.log(Ms[i - 1])) / (Math.log(Ms[i]) - Math.log(Ms[i - 1])); return ys[i - 1] + t * (ys[i] - ys[i - 1]); }
  return ys[ys.length - 1];
};
/* what G held-out labelled frames can certify about a detector whose miss rate is p: the upper end of the 95% interval, from the pedestrians that count (ppf of them per frame) */
L.certify = function (p, G, ppf) {
  var n = ppf * G;
  return n < 1 ? 1 : Math.min(1, p + L.halfWidth(p, n));
};
/* the split of a budget M into training frames Mt and grading frames M - Mt that certifies the strictest bound, among the training budgets the lab measured (grid);
 * curve(Mt) = the miss rate of the best detector trained with Mt frames */
L.bestSplit = function (curve, M, ppf, grid) {
  var best = null, i;
  for (i = 0; i < grid.length; i++) {
    var Mt = grid[i], p = curve(Mt), b = L.certify(p, M - Mt, ppf);
    if (Mt < M && (!best || b < best.bound)) best = { train: Mt, grade: M - Mt, p: p, bound: b };
  }
  return best;
};
/* the fewest labelled frames, trained on one of the measured budgets and graded on the rest, that certify the miss rate is at most t */
L.framesToCertify = function (curve, t, ppf, grid) {
  var best = null, i;
  for (i = 0; i < grid.length; i++) {
    var Mt = grid[i], p = curve(Mt), m = t - p;
    if (m <= 0) continue;
    var G = Math.ceil(L.pedsFor(p, m) / ppf);
    if (!best || Mt + G < best.total) best = { train: Mt, grade: G, p: p, total: Mt + G };
  }
  return best;
};

/* ───────────────────────────── the exit: a rate per frame is not a probability per approach ───────────────────────────── */
/* the shuttle holds speed v until it decides, brakes after a latency tau and then decelerates at a: it stops after  v tau + v^2 / (2 a)  metres */
L.stopDistance = function (v, a, tau) { return v * tau + v * v / (2 * a); };
/* a pedestrian first seen at depth z0 (the distance to the pedestrian's near surface) must be detected while the shuttle is still farther away than the stopping distance; the camera takes a frame
 * every dt seconds and the shuttle moves v dt metres between frames, so the frames available at or before the last useful moment number  floor((z0 - dStop) / (v dt)) + 1  */
L.framesBefore = function (z0, v, a, tau, dt) {
  var d = z0 - L.stopDistance(v, a, tau);
  return d < 0 ? 0 : Math.floor(d / (v * dt) + 1e-9) + 1;
};
/* the chance that every one of k frames misses, each with probability p: independent misses give p^k; perfectly correlated ones (the same pedestrian is missed in all frames or in none) give p */
L.noDetect = function (p, k) { return { independent: Math.pow(p, k), correlated: k > 0 ? p : 1 }; };
/* between the two: every pedestrian has their own miss probability q (some are easy, some hard), the same in every frame of one approach, with mean p and correlation rho between the misses of two frames of the same pedestrian;
 * for q ~ Beta(a, b), a = p (1 - rho) / rho, b = (1 - p) (1 - rho) / rho, the chance that all k frames miss is E[q^k] = prod over i < k of (a + i) / (a + b + i) */
L.noDetectBeta = function (p, k, rho) {
  if (rho <= 0) return Math.pow(p, k);
  if (rho >= 1) return p;
  var a = p * (1 - rho) / rho, b = (1 - p) * (1 - rho) / rho, v = 1, i;
  for (i = 0; i < k; i++) v *= (a + i) / (a + b + i);
  return v;
};

if (typeof module !== 'undefined' && module.exports) module.exports = L;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
