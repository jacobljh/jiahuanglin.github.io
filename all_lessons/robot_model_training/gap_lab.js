/* gap_lab.js — lesson 11's private engine: a simulator that is wrong about the plant, and the two things that buy the difference back.
 *
 * The robot's plant is the Bench plant of bench.js (gain g, first-order lag tau, delay d).  The learner trains only in a simulator, where the expert labels any state
 * for free (as in lesson 3): demonstrations first, then rounds in which the clone drives and the expert relabels what it visited.  Every simulated run draws its own
 * plant, lag ~ U[lo, hi]: width 0 is a simulator with one exact lag, and lo = hi = 0 is the plain simulator of lessons 1 to 10.
 *   train     the simulator budget: DEMOS expert runs, then ROUNDS x PER runs of the clone, each relabelled by the expert; "retrain" is "store"
 *   evaluate  the clone on a real plant (a different gain and lag than the simulator was told), gust 0.05, 5 posts, the usual clock
 *   probe     a calibration run on the real robot: 3 s of gentle random steps in free space (commands held 5 steps, +-0.15 rad/s per joint)
 *   identify  least squares for (gain, lag[, delay]) from probe runs: for each candidate lag and delay the unit-gain response of the plant to the logged commands is
 *             computed, the gain is the closed-form least-squares scale, the candidate with the smallest squared error wins
 *   cell      one point of the widget: robot ri, n calibration runs (draw k of K), randomisation width WIDTHS[wi] -> success of the clone trained on that range, 100 runs
 * Everything is a function of its seeds; no Math.random, no Date.
 */
(function (root) {
'use strict';
var BN = root.BN || require('./bench.js');
var exp = Math.exp, floor = Math.floor;                     // local names: a page that runs inside a test harness looks globals up slowly
var GL = {};
GL.H = [0.02, 0.02];
GL.JIT = 0.01; GL.GUST = 0.05; GL.DT = 0.05;
GL.POSTS = 5; GL.NEVAL = 200; GL.SEED = 5;                 // evaluation: 200 runs, jittered starts, gust 0.05, as in lessons 1 to 3
GL.DEMOS = 20; GL.ROUNDS = 4; GL.PER = 5;                  // the simulator budget: 20 demonstrations + 4 rounds of 5 clone runs = 40 simulated runs
GL.TRAIN_SEED = 1;
GL.NOMINAL = { gain: 1, lag: 0 };                          // the simulator before anyone measures anything
GL.PROBE_STEPS = 60; GL.HOLD = 5; GL.AMP = 0.15;           // a calibration run: 60 steps (3 s), the command redrawn every 5 steps, uniform in +-0.15 rad/s per joint
GL.TAUS = []; for (var i = 0; i <= 120; i++) GL.TAUS.push(i * 0.005);   // candidate lags 0 to 0.6 s in steps of 5 ms
/* the widget: four robots that differ in lag (all with gain 0.9), seven widths, five calibration sizes, K repeated calibrations of each, 100 runs per point */
GL.FLEET = [0, 0.1, 0.2, 0.25]; GL.FLEET_GAIN = 0.9;
GL.WIDTHS = [0, 0.05, 0.1, 0.15, 0.2, 0.3, 0.45]; GL.CALN = [0, 1, 3, 10]; GL.K = 5; GL.NPOINT = 100;

GL.world = function () { return BN.slalom.world(GL.POSTS); };
/* the clone's lookup: the kernel-weighted mean of the stored commands within three bandwidths, the nearest stored frame when there is none (the arithmetic of BN.NW.predict, without the closures) */
GL.predict = function (nw, x) {
  var c0 = floor(x[0] / nw.cell[0]) + 1024, c1 = floor(x[1] / nw.cell[1]) + 1024, tot = 0, o0 = 0, o1 = 0, i0, i1, a, t, s, z0, z1, e, wt, y;
  for (i0 = -1; i0 <= 1; i0++) for (i1 = -1; i1 <= 1; i1++) {
    a = nw.g[(c0 + i0) * 2048 + c1 + i1]; if (!a) continue;
    for (t = 0; t < a.length; t++) {
      s = nw.X[a[t]]; z0 = (s[0] - x[0]) / nw.h[0]; z1 = (s[1] - x[1]) / nw.h[1]; e = z0 * z0 + z1 * z1;
      if (e > 9) continue;
      wt = exp(-0.5 * e); y = nw.Y[a[t]]; tot += wt; o0 += wt * y[0]; o1 += wt * y[1];
    }
  }
  if (tot < 1e-12) { var nb = nw.nearest(x); return nb < 0 ? [0, 0] : nw.Y[nb].slice(); }
  return [o0 / tot, o1 / tot];
};
GL.plant = function (p) { return { gain: p.gain === undefined ? 1 : p.gain, lag: p.lag || 0, delay: p.delay || 0, noise: GL.GUST }; };
/* the simulator's plant for one simulated run: gain and delay as calibrated, lag drawn from the randomised range {gain, delay, lo, hi} */
GL.drawPlant = function (range, rng) {
  return GL.plant({ gain: range.gain, delay: range.delay, lag: range.lo + (range.hi - range.lo) * rng() });
};
GL.range = function (centre, width) {                       // centre {gain, lag, delay}: the lags the simulator may draw are lag +- width, never below 0
  return { gain: centre.gain, delay: centre.delay || 0, lo: Math.max(0, centre.lag - width), hi: centre.lag + width };
};

/* train in the simulator; returns the clone (a BN.NW) */
GL.train = function (w, range, seed, budget) {
  var b = budget || { demos: GL.DEMOS, rounds: GL.ROUNDS, per: GL.PER }, rng = BN.rng(seed || GL.TRAIN_SEED), nw = new BN.NW(GL.H), T = BN.slalom.horizon(w), r, i;
  function store(ro, relabel) {
    for (var t = 0; t < ro.S.length; t++) if (relabel || t < ro.A.length) nw.add(ro.S[t], relabel ? BN.slalom.expertAct(w, ro.S[t]) : ro.A[t]);
  }
  for (i = 0; i < b.demos; i++) store(BN.rollout(w, BN.expertPolicy(w), rng, { plant: GL.drawPlant(range, rng), jit: GL.JIT, T: T }), false);
  for (r = 0; r < b.rounds; r++)
    for (i = 0; i < b.per; i++) store(BN.rollout(w, function (q) { return GL.predict(nw, q); }, rng, { plant: GL.drawPlant(range, rng), jit: GL.JIT, T: T }), true);
  return nw;
};
GL.evaluate = function (w, nw, real, N, seed) {
  return BN.evaluate(w, function () { return function (q) { return GL.predict(nw, q); }; }, N || GL.NEVAL, seed || GL.SEED, { plant: GL.plant(real), jit: GL.JIT });
};
/* the expert itself on a real plant; pace in cm/s scales its commands (15 is the Bench's expert), T optionally overrides the clock */
GL.evaluateExpert = function (w, real, N, seed, pace, T) {
  var k = (pace || 15) / 15;
  return BN.evaluate(w, function () { return function (q) { var u = BN.slalom.expertAct(w, q); return [u[0] * k, u[1] * k]; }; }, N || GL.NEVAL, seed || GL.SEED, { plant: GL.plant(real), jit: GL.JIT, T: T });
};

/* one calibration run on the real robot: gentle random steps in free space; returns the commands U and the measured joint velocities Y = (q[t+1] - q[t]) / dt */
GL.probe = function (real, rng) {
  var pl = BN.plant(GL.plant(real)).reset([0.3, 1.2]), U = [], Y = [], u = [0, 0], t, q0;
  for (t = 0; t < GL.PROBE_STEPS; t++) {
    if (t % GL.HOLD === 0) u = [GL.AMP * (2 * rng() - 1), GL.AMP * (2 * rng() - 1)];
    q0 = [pl.q[0], pl.q[1]]; pl.step(u, rng); U.push(u); Y.push([(pl.q[0] - q0[0]) / GL.DT, (pl.q[1] - q0[1]) / GL.DT]);
  }
  return { U: U, Y: Y };
};
/* the plant's unit-gain response of one joint to the logged commands, for lag tau and delay d (the recursion of BN.plant) */
GL.response = function (U, j, tau, d) {
  var k = GL.DT / (tau + GL.DT), f = new Float64Array(U.length), v = 0, t, c;
  for (t = 0; t < U.length; t++) { c = t >= d ? Math.max(-1.5, Math.min(1.5, U[t - d][j])) : 0; v = tau > 0 ? v + k * (c - v) : c; f[t] = v; }
  return f;
};
/* least squares: the best (gain, lag, delay) over the candidate lags and delays; delays = [0] fits gain and lag only */
GL.identify = function (runs, delays) {
  var best = null, di, ti, ri, j, t, d, tau, f, sfy, sff, syy, g, sse;
  for (di = 0; di < delays.length; di++) for (ti = 0; ti < GL.TAUS.length; ti++) {
    d = delays[di]; tau = GL.TAUS[ti]; sfy = 0; sff = 0; syy = 0;
    for (ri = 0; ri < runs.length; ri++) for (j = 0; j < 2; j++) {
      f = GL.response(runs[ri].U, j, tau, d);
      for (t = 0; t < f.length; t++) { sfy += f[t] * runs[ri].Y[t][j]; sff += f[t] * f[t]; syy += runs[ri].Y[t][j] * runs[ri].Y[t][j]; }
    }
    g = sfy / sff; sse = syy - g * sfy;
    if (!best || sse < best.sse) best = { gain: g, lag: tau, delay: d, sse: sse };
  }
  return best;
};
/* calibrate on n real runs (n = 0: nobody measured anything, the simulator stays nominal) */
GL.calibrate = function (n, real, seed, delays) {
  if (n <= 0) return { gain: GL.NOMINAL.gain, lag: GL.NOMINAL.lag, delay: 0 };
  var rng = BN.rng(seed), runs = [], i;
  for (i = 0; i < n; i++) runs.push(GL.probe(real, rng));
  return GL.identify(runs, delays || [0]);
};
/* the scatter of the fit over m repeated calibrations of n runs: mean and standard deviation of the lag and the gain */
GL.scatter = function (n, real, m, seed0, delays) {
  var lags = [], gains = [], k, c;
  for (k = 0; k < m; k++) { c = GL.calibrate(n, real, seed0 + k, delays); lags.push(c.lag); gains.push(c.gain); }
  return { lag: BN.stats.mean(lags), lagSd: BN.stats.std(lags), gain: BN.stats.mean(gains), gainSd: BN.stats.std(gains) };
};

/* ───────── the widget's points, cached ───────── */
var cache = {}, W5 = null;
GL.realOf = function (ri) { return { gain: GL.FLEET_GAIN, lag: GL.FLEET[ri] }; };
GL.calOf = function (n, ri, k) {
  var key = 'c' + n + '|' + ri + '|' + (n ? k : 0);
  return cache[key] || (cache[key] = GL.calibrate(n, GL.realOf(ri), 1 + k));
};
GL.cell = function (n, ri, k, wi) {
  var cal = GL.calOf(n, ri, k), key = 'p' + cal.gain + '|' + cal.lag + '|' + GL.WIDTHS[wi] + '|' + ri;
  if (cache[key]) return cache[key];
  W5 = W5 || GL.world();
  var rg = GL.range(cal, GL.WIDTHS[wi]), nw = GL.train(W5, rg), r = GL.evaluate(W5, nw, GL.realOf(ri), GL.NPOINT);
  return (cache[key] = { cal: cal, range: rg, succ: r.succ, ci: r.ci, frames: nw.n, covers: rg.lo <= GL.FLEET[ri] && GL.FLEET[ri] <= rg.hi });
};
/* a point already computed, or null (the widget draws what exists and fills the rest) */
GL.peek = function (n, ri, k, wi) {
  var cal = GL.calOf(n, ri, k); return cache['p' + cal.gain + '|' + cal.lag + '|' + GL.WIDTHS[wi] + '|' + ri] || null;
};
/* the K repeated calibrations (one when n = 0) of robot ri at width wi */
GL.cells = function (n, ri, wi) {
  var out = [], K = n ? GL.K : 1, k;
  for (k = 0; k < K; k++) out.push(GL.cell(n, ri, k, wi));
  return out;
};
GL.sd = function (n, ri) {                                  // scatter of the lag fit for n runs on robot ri, 20 repeated calibrations
  var key = 's' + n + '|' + ri; return cache[key] || (cache[key] = GL.scatter(n, GL.realOf(ri), 20, 500));
};

root.GL = GL;
if (typeof module !== 'undefined' && module.exports) module.exports = GL;
})(typeof window !== 'undefined' ? window : globalThis);
