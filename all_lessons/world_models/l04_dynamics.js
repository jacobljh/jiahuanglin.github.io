/* l04_dynamics.js — private engine of World Models lesson 04, "Learning the filter and the dynamics".  Global DY; needs courtyard.js (CY) loaded first.
 *
 * What it holds (everything the lesson's widget computes, so that the page script only draws):
 *   - the linear-Gaussian model of ONE axis of free flight (the Courtyard with a small velocity jitter), the Riccati recursion run with CY.kf (steady-state prior
 *     covariance, gain, innovation variance S_inf and the filter's impulse response h_j), and the "filter switched on m readings ago" curve S_m;
 *   - the stream a window predictor is taught by (free flight in a floor with no walls in reach), the Gram matrix of the lag vector, the ridge solution for every
 *     window length m and its mean squared error, both from sufficient statistics only;
 *   - the plain Courtyard as a stream for a recurrent network (walls, curtain, random nudges), the sequences with a loss mask, the training schedule, the hidden-state
 *     probe, the Kalman baseline, the curtain-crossing statistics, the surprise statistic, and the "what if I nudge by a?" question put to the trained network;
 *   - the fork seen through a wide curtain (the post is hidden; where does the ball come out?) as a stream for a second network.
 * Conventions: state of an axis [p, v]; one step = 0.1 s; the filter's F is exact for the friction of the Courtyard (d = exp(-gamma dt), g = (1 - d)/gamma); the world's
 * velocity jitter SV is added to the velocity after each step (CY.step with sigV), so the process noise is diag(0, SV^2).  Everything is deterministic (CY.rng).
 */
(function (root) {
'use strict';
var CY = root.CY || (typeof require !== 'undefined' ? require('./courtyard.js') : null);
var DY = {};

DY.SV = 0.08; DY.SO = 0.1; DY.LMAX = 14; DY.NH = 16; DY.T = 40;
var W0 = CY.world({});
DY.d = Math.exp(-W0.gamma * W0.dt); DY.g = (1 - DY.d) / W0.gamma;

/* ───────────── the model of one axis, and the Riccati recursion ───────────── */
DY.model = function () { return { n: 2, m: 1, F: [1, DY.g, 0, DY.d], H: [1, 0], Q: [0, 0, 0, DY.SV * DY.SV], R: [DY.SO * DY.SO] }; };
/* Run predict/update from a flat prior on [position, velocity].  S[k] = variance of the next reading after k readings (S[k] is the error of the best k-window
 * linear predictor); after `iters` steps the prior covariance Pm is the steady state.  K = Pm[:,0]/S_inf; h[j] = H F M^j K with M = (I - K H) F is the weight the
 * steady-state predictor puts on the reading j steps old. */
DY.riccati = function (model, iters, nh) {
  var st = { x: new Float64Array(2), P: Float64Array.from([1e6, 0, 0, 1e6]) }, S = [], k, pr, up;
  for (k = 0; k < iters; k++) {
    pr = CY.kf.predict(model, st); S.push(pr.P[0] + model.R[0]);
    up = CY.kf.update(model, pr, [0]); st = { x: up.x, P: up.P };
  }
  pr = CY.kf.predict(model, st);
  var Sinf = pr.P[0] + model.R[0], K = [pr.P[0] / Sinf, pr.P[2] / Sinf], F = model.F, g = F[1], d = F[3];
  var M = [(1 - K[0]), (1 - K[0]) * g, -K[1], -K[1] * g + d], h = [], v = [K[0], K[1]], j;
  for (j = 0; j < nh; j++) { h.push(v[0] + g * v[1]); v = [M[0] * v[0] + M[1] * v[1], M[2] * v[0] + M[3] * v[1]]; }
  up = CY.kf.update(model, pr, [0]);
  return { S: S, Sinf: Sinf, Pm: pr.P, K: K, h: h, post: [Math.sqrt(up.P[0]), Math.sqrt(up.P[3])] };
};

/* ───────────── the stream of free flight, the Gram matrix, the ridge solution for every window ───────────── */
/* n launches in a floor 60 m wide (no wall within reach), start anywhere in a 20 m box, speed 2-3 m/s, any direction; the sensor reads each axis with noise SO.
 * Returns one Float64Array of T readings per axis (positions measured from the middle of the box), x and y pooled. */
DY.freeClips = function (n, seed, T) {
  var w = CY.world({ W: 60, H: 60, curtain: null, sigV: DY.SV }), rng = CY.rng(seed), out = [], i, t;
  for (i = 0; i < n; i++) {
    var sp = 2 + rng(), th = 2 * Math.PI * rng(), s = [20 + 20 * rng(), 20 + 20 * rng(), sp * Math.cos(th), sp * Math.sin(th)];
    var zx = new Float64Array(T), zy = new Float64Array(T);
    for (t = 0; t < T; t++) { zx[t] = s[0] + DY.SO * CY.randn(rng) - 30; zy[t] = s[1] + DY.SO * CY.randn(rng) - 30; s = CY.step(w, s, null, rng); }
    out.push(zx, zy);
  }
  return out;
};
/* Gram matrix of the vector [z_t, z_{t-1}, ..., z_{t-L+1}, z_{t+1}] over every window of every sequence: all a ridge fit or an error needs. */
DY.gram = function (seqs, L) {
  var D = L + 1, G = new Float64Array(D * D), N = 0, phi = new Float64Array(D), q, t, a, b, k;
  for (q = 0; q < seqs.length; q++) {
    var z = seqs[q];
    for (t = L - 1; t < z.length - 1; t++) {
      for (k = 0; k < L; k++) phi[k] = z[t - k];
      phi[L] = z[t + 1];
      for (a = 0; a < D; a++) for (b = a; b < D; b++) G[a * D + b] += phi[a] * phi[b];
      N++;
    }
  }
  for (a = 0; a < D; a++) for (b = 0; b < a; b++) G[a * D + b] = G[b * D + a];
  return { G: G, N: N, D: D, L: L };
};
/* ridge regression of the next reading on the last m readings:  (G_mm + lam I) w = G_{m,target} */
DY.window = function (gm, m, lam) {
  var D = gm.D, A = new Float64Array(m * m), b = new Float64Array(m), i, j;
  for (i = 0; i < m; i++) { for (j = 0; j < m; j++) A[i * m + j] = gm.G[i * D + j]; A[i * m + i] += lam; b[i] = gm.G[i * D + gm.L]; }
  return CY.la.solve(A, b, m);
};
DY.windowMSE = function (gm, w, m) {                    // mean over windows of (z_{t+1} - w . window)^2, from the Gram matrix alone
  var D = gm.D, q = gm.G[gm.L * D + gm.L], i, j;
  for (i = 0; i < m; i++) { q -= 2 * w[i] * gm.G[i * D + gm.L]; for (j = 0; j < m; j++) q += w[i] * w[j] * gm.G[i * D + j]; }
  return q / gm.N;
};

/* everything the window experiment quotes: the Riccati quantities, and for m = 1..LMAX the ridge weights (trained on one set of launches), their test error and
 * their distance from the filter's impulse response (relative L2 over the first m lags) */
DY.linear = function () {
  var R = DY.riccati(DY.model(), 600, DY.LMAX), tr = DY.gram(DY.freeClips(1500, 21, 40), DY.LMAX), te = DY.gram(DY.freeClips(6000, 22, 40), DY.LMAX), W = [], mse = [], rel = [], m, i;
  for (m = 1; m <= DY.LMAX; m++) {
    var w = DY.window(tr, m, 1e-6), a = 0, b = 0;
    for (i = 0; i < m; i++) { a += (w[i] - R.h[i]) * (w[i] - R.h[i]); b += R.h[i] * R.h[i]; }
    W.push(w); mse.push(DY.windowMSE(te, w, m)); rel.push(Math.sqrt(a / b));
  }
  return { R: R, W: W, mse: mse, rel: rel, N: tr.N };
};
/* the prediction of the reading at t+1 from the last m readings with weights w (both axes), or null when one of the m readings is missing */
DY.windowPredict = function (ep, w, m, t) {
  if (t < m - 1) return null;
  var px = 0, py = 0, k;
  for (k = 0; k < m; k++) { var z = ep.Z[t - k]; if (!z) return null; px += w[k] * z[0]; py += w[k] * z[1]; }
  return [px, py];
};
DY.windowCoverage = function (eps, m) {                // share of the steps at which a window of m readings is complete
  var have = 0, tot = 0, i, t;
  for (i = 0; i < eps.length; i++) for (t = 0; t < eps[i].T; t++) { tot++; if (DY.windowPredict(eps[i], [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1], m, t)) have++; }
  return have / tot;
};

/* ───────────── the plain Courtyard as a stream for a recurrent network ───────────── */
DY.PA = 0.08; DY.AMIN = 0.5; DY.AMAX = 2.5;               // the logged nudges: probability per step, size range (m/s), direction uniform
DY.courtyard = function () { return CY.world({ sigV: DY.SV }); };
/* one episode: states S[t], readings Z[t] (null behind the curtain), nudges A[t] (null or [ax, ay], applied at the start of step t -> t+1), T+1 entries each.  o.nudges:false = none;
 * o.hidden = {t, a}: an extra push at step t that the world feels and the log does not record. */
DY.episode = function (w, seed, o) {
  o = o || {};
  var T = o.T || DY.T, rng = CY.rng(seed), s = CY.launch(w, rng), S = [], Z = [], A = [], t;
  for (t = 0; t <= T; t++) {
    S.push(s); Z.push(CY.observe(w, s, rng));
    var a = null;
    if (o.nudges !== false && t < T && rng() < DY.PA) { var an = 2 * Math.PI * rng(), am = DY.AMIN + (DY.AMAX - DY.AMIN) * rng(); a = [am * Math.cos(an), am * Math.sin(an)]; }
    A.push(a);
    if (o.hidden && t === o.hidden.t) a = [(a ? a[0] : 0) + o.hidden.a[0], (a ? a[1] : 0) + o.hidden.a[1]];          // an unannounced push: the world feels it, the log does not record it
    if (t < T) s = CY.step(w, s, a, rng);
  }
  return { S: S, Z: Z, A: A, T: T };
};
/* network input at step t: the reading (zero behind the curtain), a "visible" flag, the nudge; scales: 4 m for positions, 3 m/s for nudges */
DY.xin = function (z, a) { return [z ? (z[0] - 4) / 4 : 0, z ? (z[1] - 2.5) / 4 : 0, z ? 1 : 0, a ? a[0] / 3 : 0, a ? a[1] / 3 : 0]; };
/* the training sequence of an episode: input x_t, target = the NEXT reading, loss mask m_t = 1 only when that reading exists */
DY.seq = function (ep) {
  var x = [], y = [], m = [], t;
  for (t = 0; t < ep.T; t++) { var zn = ep.Z[t + 1]; x.push(DY.xin(ep.Z[t], ep.A[t])); y.push(zn ? [(zn[0] - 4) / 4, (zn[1] - 2.5) / 4] : [0, 0]); m.push(zn ? 1 : 0); }
  return { x: x, y: y, m: m };
};
DY.newNet = function (seed) { return new CY.RNN(5, DY.NH, 2, seed); };
/* 10-epoch chunks of Adam (one sequence per update); the step size halves every 100 epochs and never falls below LRMIN.  `done` = epochs already run; returns the new total. */
DY.LR0 = 0.002; DY.HALF = 100; DY.LRMIN = 2e-4;
DY.train = function (net, seqs, done, epochs) {
  var e = 0, lr;
  while (e < epochs) {
    lr = Math.max(DY.LRMIN, DY.LR0 * Math.pow(0.5, (done + e) / DY.HALF));
    net.fit(seqs, { epochs: 10, batch: 1, lr: lr, seed: 3 + done + e }); e += 10;
  }
  return done + epochs;
};
/* run the network over an episode: hidden state after each step and its prediction of the next reading, in metres */
DY.run = function (net, ep) {
  var sq = DY.seq(ep), r = net.run(sq.x), pred = [], t;
  for (t = 0; t < ep.T; t++) pred.push([r.ys[t][0] * 4 + 4, r.ys[t][1] * 4 + 2.5]);
  return { h: r.hs.slice(1), pred: pred };
};

/* ───────────── what the trained network is asked ───────────── */
DY.nearWall = function (w, s) { return s[0] < 0.6 || s[0] > w.W - 0.6 || s[1] < 0.6 || s[1] > w.H - 0.6; };
/* a step where the Kalman floor applies: the eight readings before it exist, no nudge, and the ball stayed 0.6 m from the walls */
DY.settled = function (w, ep, t) {
  if (t < 9) return false;
  for (var u = t - 8; u <= t; u++) if (!ep.Z[u] || ep.A[u] || DY.nearWall(w, ep.S[u]) || DY.nearWall(w, ep.S[Math.min(ep.T, u + 1)])) return false;
  return true;
};
/* mean squared error (m^2 per axis) of the one-step prediction over all steps with a target (all) and over the settled steps */
DY.stepMSE = function (w, eps, runs) {
  var all = 0, na = 0, st = 0, ns = 0, i, t;
  for (i = 0; i < eps.length; i++) for (t = 0; t < eps[i].T; t++) {
    var zn = eps[i].Z[t + 1]; if (!zn) continue;
    var p = runs[i].pred[t], e = ((p[0] - zn[0]) * (p[0] - zn[0]) + (p[1] - zn[1]) * (p[1] - zn[1])) / 2;
    all += e; na++; if (DY.settled(w, eps[i], t)) { st += e; ns++; }
  }
  return { all: all / na, settled: st / ns, nSettled: ns };
};
/* the two-axis Kalman filter (the lesson-2 machine, told the true model and the nudges) run over an episode.  pred[t] = its prediction of the reading at t+1 and var[t] the
 * variance it claims for it; post[t] = its mean for the state after the reading at t and the nudge at t.  The first reading starts it with a flat velocity (sd 3 m/s). */
DY.kfRun = function (ep) {
  var model = DY.model(), st = [null, null], pred = [], vr = [], post = [], t, ax, a, z;
  for (t = 0; t < ep.T; t++) {
    z = ep.Z[t]; a = ep.A[t] || [0, 0]; var pp = [], vv = [], ps = [0, 0, 0, 0];
    for (ax = 0; ax < 2; ax++) {
      var s = st[ax];
      if (s === null) s = { x: Float64Array.from([z ? z[ax] : (ax ? 2.5 : 0.5), 0]), P: Float64Array.from([z ? DY.SO * DY.SO : 1, 0, 0, 9]) };
      else if (z) { var up = CY.kf.update(model, s, [z[ax]]); s = { x: up.x, P: up.P }; }
      ps[ax] = s.x[0]; ps[2 + ax] = s.x[1] + a[ax];
      var nx = CY.kf.predict(model, { x: Float64Array.from([s.x[0], s.x[1] + a[ax]]), P: s.P });
      st[ax] = nx; pp.push(nx.x[0]); vv.push(nx.P[0] + DY.SO * DY.SO);
    }
    pred.push(pp); vr.push(vv); post.push(ps);
  }
  return { pred: pred, var: vr, post: post };
};
/* the linear probe: ridge regression from features to the state the next step starts from, [x, y, vx + ax, vy + ay], fitted on one set of episodes (steps t >= 3) */
DY.stateOf = function (ep, t) { var s = ep.S[t], a = ep.A[t] || [0, 0]; return [s[0], s[1], s[2] + a[0], s[3] + a[1]]; };
DY.featH = function (ep, run, t) { return Array.from(run.h[t]).concat([1]); };
DY.featZ = function (ep, run, t) { var z = ep.Z[t]; return [z ? z[0] : 0, z ? z[1] : 0, z ? 1 : 0, 1]; };
DY.probeFit = function (eps, runs, feat) {
  var X = [], Y = [], i, t, p, q = 4;
  for (i = 0; i < eps.length; i++) for (t = 3; t < eps[i].T; t++) { X.push(feat(eps[i], runs[i], t)); Y.push(DY.stateOf(eps[i], t)); }
  p = X[0].length;
  var Xf = new Float64Array(X.length * p), Yf = new Float64Array(X.length * q), n;
  for (n = 0; n < X.length; n++) { for (i = 0; i < p; i++) Xf[n * p + i] = X[n][i]; for (i = 0; i < q; i++) Yf[n * q + i] = Y[n][i]; }
  return { W: CY.la.ridge(Xf, X.length, p, Yf, q, 1e-3), p: p };
};
DY.probeApply = function (pr, x) { var o = [0, 0, 0, 0], c, j; for (c = 0; c < 4; c++) for (j = 0; j < pr.p; j++) o[c] += x[j] * pr.W[j * 4 + c]; return o; };
/* RMS error per axis of position (m) and of velocity (m/s) of an estimator est(i, t) -> [x, y, vx, vy] over the settled steps of the episodes */
DY.stateError = function (w, eps, est) {
  var sp = 0, sv = 0, n = 0, i, t;
  for (i = 0; i < eps.length; i++) for (t = 0; t < eps[i].T; t++) {
    if (!DY.settled(w, eps[i], t)) continue;
    var e = est(i, t), s = DY.stateOf(eps[i], t);
    sp += ((e[0] - s[0]) * (e[0] - s[0]) + (e[1] - s[1]) * (e[1] - s[1])) / 2; sv += ((e[2] - s[2]) * (e[2] - s[2]) + (e[3] - s[3]) * (e[3] - s[3])) / 2; n++;
  }
  return { pos: Math.sqrt(sp / n), vel: Math.sqrt(sv / n), n: n };
};
/* clean curtain crossings: the first gap of 2-5 hidden steps, eight readings before it, six after, no nudge around it, the ball between y = 1 and y = 4 throughout */
DY.crossings = function (eps) {
  var out = [], i, t, u;
  for (i = 0; i < eps.length; i++) {
    var ep = eps[i], a0 = -1, b1, ok = true;
    for (t = 1; t < ep.T; t++) if (!ep.Z[t] && ep.Z[t - 1]) { a0 = t; break; }
    if (a0 < 8) continue;
    b1 = a0; while (b1 < ep.T && !ep.Z[b1]) b1++;
    if (b1 - a0 < 2 || b1 - a0 > 5 || b1 + 6 >= ep.T) continue;
    for (u = a0 - 8; u <= b1 + 6; u++) if (ep.A[u] || ep.S[u][1] < 1 || ep.S[u][1] > 4) ok = false;
    if (ok) out.push({ i: i, a0: a0, b1: b1 });
  }
  return out;
};
/* error of the one-step prediction made k steps after the ball comes out of the curtain, k = 0..K (k = 0: the first reading after the gap); net and Kalman filter */
DY.gapStats = function (eps, runs, kfs, cr, K) {
  var net = [], kf = [], kv = [], k, c, n = cr.length;
  for (k = 0; k <= K; k++) { net.push(0); kf.push(0); kv.push(0); }
  for (c = 0; c < n; c++) for (k = 0; k <= K; k++) {
    var ep = eps[cr[c].i], t = cr[c].b1 + k - 1, zn = ep.Z[t + 1], p = runs[cr[c].i].pred[t];
    net[k] += ((p[0] - zn[0]) * (p[0] - zn[0]) + (p[1] - zn[1]) * (p[1] - zn[1])) / 2 / n;
    if (!kfs) continue;
    var q = kfs[cr[c].i];
    kf[k] += ((q.pred[t][0] - zn[0]) * (q.pred[t][0] - zn[0]) + (q.pred[t][1] - zn[1]) * (q.pred[t][1] - zn[1])) / 2 / n;
    kv[k] += (q.var[t][0] + q.var[t][1]) / 2 / n;
  }
  return { net: net, kf: kf, kfVar: kv, n: n };
};
/* surprise: the squared miss of the one-step prediction in units of the miss it makes in free flight, summed over the two axes and halved (mean 1 when the world is as modelled) */
DY.surprise = function (pred, ep, ref) {
  var s = [], t;
  for (t = 0; t < ep.T; t++) { var zn = ep.Z[t + 1]; s.push(zn ? ((pred[t][0] - zn[0]) * (pred[t][0] - zn[0]) + (pred[t][1] - zn[1]) * (pred[t][1] - zn[1])) / 2 / ref : NaN); }
  return s;
};
/* "what if I nudge by a?": run the network over the true stream up to step t0, then put the nudge in at t0 and let it imagine K steps on its own predictions (its predicted
 * reading is fed back as the next input).  Returns the K imagined positions after step t0 (null nudge = the imagined future without it). */
DY.dream = function (net, run, ep, t0, a, K) {
  var h = run.h[t0 - 1], x = DY.xin(ep.Z[t0], a), out = [], k, r;
  for (k = 0; k < K; k++) { r = net.step(h, x); h = r.h; out.push([r.y[0] * 4 + 4, r.y[1] * 4 + 2.5]); x = [r.y[0], r.y[1], 1, 0, 0]; }
  return out;
};
/* what the simulator says the nudge does: the same state with and without it, no jitter, k steps later (free flight: g a (1 - d^k)/(1 - d) = a (1 - d^k)/gamma) */
DY.trueEffect = function (s, a, K) {
  var w = CY.world({ W: 1e3, H: 1e3, curtain: null }), p = CY.step(w, s, a), q = CY.step(w, s, null), out = [[p[0] - q[0], p[1] - q[1]]], k;
  for (k = 1; k < K; k++) { p = CY.step(w, p, null); q = CY.step(w, q, null); out.push([p[0] - q[0], p[1] - q[1]]); }
  return out;
};

/* the data of the Courtyard experiment: 200 logged episodes to train on (nudges at random), 400 nudge-free launches to test on, 200 more to fit the probe on */
DY.plainSets = function () {
  var w = DY.courtyard(), tr = [], te = [], pb = [], i;
  for (i = 0; i < 200; i++) tr.push(DY.episode(w, 1000 + i));
  for (i = 0; i < 400; i++) te.push(DY.episode(w, 7000 + i, { nudges: false }));
  for (i = 0; i < 200; i++) pb.push(DY.episode(w, 5000 + i, { nudges: false }));
  return { w: w, seqs: tr.map(DY.seq), te: te, pb: pb, cr: DY.crossings(te) };
};
/* what the lesson quotes about a trained network: its one-step error in free flight (against the floor Sinf), what a linear probe can read from its hidden state,
 * and its error at and after the curtain's edge (clean crossings) */
DY.plainReport = function (net, S, Sinf) {
  var runs = S.te.map(function (ep) { return DY.run(net, ep); }), pbRuns = S.pb.map(function (ep) { return DY.run(net, ep); }), m = DY.stepMSE(S.w, S.te, runs);
  var prH = DY.probeFit(S.pb, pbRuns, DY.featH), prZ = DY.probeFit(S.pb, pbRuns, DY.featZ);
  var eH = DY.stateError(S.w, S.te, function (i, t) { return DY.probeApply(prH, DY.featH(S.te[i], runs[i], t)); });
  var eZ = DY.stateError(S.w, S.te, function (i, t) { return DY.probeApply(prZ, DY.featZ(S.te[i], runs[i], t)); });
  return { runs: runs, ref: m.settled, ratio: m.settled / Sinf, all: m.all, probeH: eH, probeZ: eZ, gap: DY.gapStats(S.te, runs, null, S.cr, 5).net.map(function (v) { return v / Sinf; }) };
};
/* the launches the what-if question is put to: in free flight at step 18 (the five readings before it exist, 0.6 m from the walls, height between 1 and 4 m, moving) */
DY.whatIfOK = function (S, i) {
  var ep = S.te[i], t0 = 18;
  return !(ep.Z.slice(t0 - 4, t0 + 1).some(function (z) { return !z; }) || DY.nearWall(S.w, ep.S[t0]) || ep.S[t0][1] < 1 || ep.S[t0][1] > 4 || Math.hypot(ep.S[t0][2], ep.S[t0][3]) < 0.5);
};
/* "what if I nudge sideways by amp?" over those launches: mean (and spread) over launches of the ratio of the imagined effect to the true one, and the relative size of the
 * error of the effect, at k = 1 .. 5 steps */
DY.whatIfStats = function (net, S, runs, amp) {
  var proj = [[], [], [], [], []], err = [0, 0, 0, 0, 0], eff = [0, 0, 0, 0, 0], n = 0, idx = [], i, k;
  for (i = 0; i < S.te.length; i++) {
    if (!DY.whatIfOK(S, i)) continue;
    var ep = S.te[i], t0 = 18, a = [0, (i % 2 ? 1 : -1) * amp], d1 = DY.dream(net, runs[i], ep, t0, a, 5), d0 = DY.dream(net, runs[i], ep, t0, null, 5), tt = DY.trueEffect(ep.S[t0], a, 5);
    for (k = 0; k < 5; k++) {
      var ne = [d1[k][0] - d0[k][0], d1[k][1] - d0[k][1]], te = tt[k];
      proj[k].push((ne[0] * te[0] + ne[1] * te[1]) / (te[0] * te[0] + te[1] * te[1]));
      err[k] += Math.hypot(ne[0] - te[0], ne[1] - te[1]); eff[k] += Math.hypot(te[0], te[1]);
    }
    n++; idx.push(i);
  }
  var mean = function (a) { return a.reduce(function (x, y) { return x + y; }, 0) / a.length; };
  return { n: n, idx: idx, ratio: proj.map(mean), spread: proj.map(function (p) { var m = mean(p); return Math.sqrt(mean(p.map(function (v) { return (v - m) * (v - m); }))); }), rel: err.map(function (e, j) { return e / eff[j]; }) };
};
/* one launch of the what-if experiment as five-point paths from step 18: the ball itself (no nudge), what the simulator says the nudge does (the ball plus the exact effect),
 * and what the network imagines with the nudge and without it */
DY.nudgeScene = function (net, run, ep, a) {
  var t0 = 18, tt = DY.trueEffect(ep.S[t0], a, 5), real = [ep.S[t0]], truth = [ep.S[t0]], k;
  for (k = 0; k < 5; k++) { real.push(ep.S[t0 + 1 + k]); truth.push([ep.S[t0 + 1 + k][0] + tt[k][0], ep.S[t0 + 1 + k][1] + tt[k][1]]); }
  return { real: real, truth: truth, imag1: [ep.S[t0]].concat(DY.dream(net, run, ep, t0, a, 5)), imag0: [ep.S[t0]].concat(DY.dream(net, run, ep, t0, null, 5)) };
};
/* an unannounced push of size amp (sideways) at step 22 on the launches that are in free flight then: the mean surprise of the prediction made at steps 22 .. 22 + K - 1 */
DY.pushStats = function (net, S, ref, amp, K) {
  var acc = [], n = 0, ex = null, i, k;
  for (k = 0; k < K; k++) acc.push(0);
  for (i = 0; i < S.te.length; i++) {
    var ep = DY.episode(S.w, 7000 + i, { nudges: false, hidden: { t: 22, a: [0, (i % 2 ? 1 : -1) * amp] } });
    if (!DY.settled(S.w, ep, 21) || ep.S[22][1] < 1.5 || ep.S[22][1] > 3.5) continue;
    var run = DY.run(net, ep), s = DY.surprise(run.pred, ep, ref);
    for (k = 0; k < K; k++) acc[k] += s[22 + k]; n++;
    if (!ex) ex = { ep: ep, pred: run.pred, s: s, a: [0, (i % 2 ? 1 : -1) * amp] };
  }
  return { n: n, ex: ex, s: acc.map(function (v) { return v / n; }) };
};

/* ───────────── the fork ───────────── */
DY.AIM = 0.15; DY.VX = 2.4;
/* the fork scene (the diamond post just after the curtain, soft post) with an optional curtain [c0, c1] and the velocity jitter o.sigV (default none) */
DY.forkWorld = function (curtain, sigV) { return CY.scenes.fork({ curtain: curtain || [2.6, 3.4], sigV: sigV || 0 }); };
/* one launch: the aim error b ~ N(0, AIM^2) is the only hidden number (speed fixed at VX); readings with the sensor noise, null behind the curtain */
DY.forkEpisode = function (w, seed, T) {
  T = T || DY.FT || 32;
  var rng = CY.rng(seed), b = DY.AIM * CY.randn(rng), s = [0.5, 2.5 + b, DY.VX, 0], S = [], Z = [], A = [], t;
  for (t = 0; t <= T; t++) { S.push(s); Z.push(CY.observe(w, s, rng)); A.push(null); if (t < T) s = CY.step(w, s, null, rng); }
  return { S: S, Z: Z, A: A, T: T, b: b };
};
DY.post = { x: 4.4, y: 2.5, h: 0.6 };
/* how far inside the diamond a point is, as lesson 5 measures it: the half-diagonal minus |x - x0| - |y - y0| (m): 0 on the post's edge, 0.6 at its centre, negative outside */
DY.depth = function (x, y) { return DY.post.h - Math.abs(x - DY.post.x) - Math.abs(y - DY.post.y); };
/* first step at which the ball touches the post (circumscribed test; -1 if never) */
DY.contactStep = function (ep) {
  for (var t = 0; t <= ep.T; t++) if (Math.abs(ep.S[t][0] - DY.post.x) + Math.abs(ep.S[t][1] - DY.post.y) <= DY.post.h + 0.1 * Math.SQRT2 + 0.01) return t;
  return -1;
};

/* the fork behind a wide curtain.  The curtain runs from FC[0] to FC[1] (it hides the approach and the post); the sensor sees the ball once, at the launcher (step 0),
 * and again when it comes out at x = FC[1].  The only hidden number is the aim error b; its posterior after one reading z' (height above the centre line) is
 * N(s2 z'/SO^2, s2) with 1/s2 = 1/AIM^2 + 1/SO^2 (the same as lesson 5). */
DY.FC = [0.6, 4.0]; DY.FT = 32;
DY.forkEmergence = function (ep) { for (var t = 15; t <= ep.T; t++) if (ep.Z[t] && !ep.Z[t - 1]) return t; return -1; };
/* for b on a grid: the step at which the ball comes out of the curtain and where it is then (the deterministic physics) */
DY.forkTable = function (w) {
  var tab = [], i, t, s, e;
  for (i = -450; i <= 450; i++) {
    s = [0.5, 2.5 + i / 1000, DY.VX, 0]; e = null;
    for (t = 0; t <= DY.FT && !e; t++) { if (t > 14 && !CY.occluded(w, s)) e = { t: t, x: s[0], y: s[1] }; s = CY.step(w, s, null); }
    tab.push({ b: i / 1000, e: e });
  }
  return tab;
};
DY.forkPosterior = function (zp, n) { var s2 = 1 / (1 / (DY.AIM * DY.AIM) + n / (DY.SO * DY.SO)); return { m: s2 * n * zp / (DY.SO * DY.SO), s2: s2 }; };
/* what the best possible predictor of the reading at the coming-out step tstar would say, from the posterior of b: mean and variance (readings include the sensor noise) */
DY.forkCond = function (tab, post, tstar) {
  var Z = 0, mx = 0, my = 0, mxx = 0, myy = 0, i;
  for (i = 0; i < tab.length; i++) {
    var e = tab[i].e; if (!e || e.t !== tstar) continue;
    var wt = Math.exp(-0.5 * (tab[i].b - post.m) * (tab[i].b - post.m) / post.s2);
    Z += wt; mx += wt * e.x; my += wt * e.y; mxx += wt * e.x * e.x; myy += wt * e.y * e.y;
  }
  if (Z === 0) return null;
  mx /= Z; my /= Z;
  return { mx: mx, my: my, vx: mxx / Z - mx * mx + DY.SO * DY.SO, vy: myy / Z - my * my + DY.SO * DY.SO };
};
/* the stream a network sees when the first reading is 2.5 + zp and then the curtain falls: Z = [reading, null, null, ...] */
DY.forkStream = function (zp) { var Z = [], A = [], S = [], t; for (t = 0; t <= DY.FT; t++) { Z.push(t === 0 ? [0.5, 2.5 + zp] : null); A.push(null); S.push([0.5, 2.5, DY.VX, 0]); } return { S: S, Z: Z, A: A, T: DY.FT, b: 0 }; };
/* real outcomes for that stream: n draws of b from the posterior (standard normals E), each run through the physics until the ball comes out; {t, x, y} or null */
DY.forkCloud = function (w, zp, E) {
  var post = DY.forkPosterior(zp, 1), out = [], i, t, s, e;
  for (i = 0; i < E.length; i++) {
    s = [0.5, 2.5 + post.m + Math.sqrt(post.s2) * E[i], DY.VX, 0]; e = null;
    for (t = 0; t <= DY.FT && !e; t++) { if (t > 14 && !CY.occluded(w, s)) e = { t: t, x: s[0], y: s[1] }; s = CY.step(w, s, null); }
    if (e) out.push(e);
  }
  return out;
};
/* the network's answer to "where will I see the ball when it comes out at step tstar?" for that stream: its output after step tstar - 1 */
DY.forkAnswer = function (net, zp, tstar) { return DY.run(net, DY.forkStream(zp)).pred[tstar - 1]; };
/* error of the network at the coming-out frame against the best possible (from the posterior), and elsewhere; all launches, and those whose one reading is within 5 cm of the centre line */
DY.forkStats = function (net, tab, eps) {
  var o = { n: 0, em: 0, irr: 0, els: 0, nels: 0, dev: 0, an: 0, aem: 0, airr: 0 }, i, t;
  for (i = 0; i < eps.length; i++) {
    var ep = eps[i], run = DY.run(net, ep), te = DY.forkEmergence(ep);
    for (t = 0; t < ep.T; t++) {
      var zn = ep.Z[t + 1]; if (!zn) continue;
      var p = run.pred[t], e = ((p[0] - zn[0]) * (p[0] - zn[0]) + (p[1] - zn[1]) * (p[1] - zn[1])) / 2;
      if (t + 1 !== te) { o.els += e; o.nels++; continue; }
      var c = DY.forkCond(tab, DY.forkPosterior(ep.Z[0][1] - 2.5, 1), te); if (!c) continue;
      o.em += e; o.irr += (c.vx + c.vy) / 2; o.dev += ((p[0] - c.mx) * (p[0] - c.mx) + (p[1] - c.my) * (p[1] - c.my)) / 2; o.n++;
      if (Math.abs(ep.Z[0][1] - 2.5) < 0.05) { o.aem += e; o.airr += (c.vx + c.vy) / 2; o.an++; }
    }
  }
  return { n: o.n, em: o.em / o.n, irr: o.irr / o.n, els: o.els / o.nels, dev: Math.sqrt(o.dev / o.n), an: o.an, aem: o.aem / o.an, airr: o.airr / o.an };
};

/* one reading z' (height above the centre line) and then the curtain: the real coming-out points (E = standard normals for the draws of b from the posterior), the step at which
 * most of them come out (ts), the best possible answer at that step (cond) and, given a trained network, its answer (pred), how deep inside the diamond that is (depth, m, positive
 * inside) and the share of the real coming-out points within 0.3 m of it. */
DY.forkCase = function (w, tab, net, zp, E) {
  var cl = DY.forkCloud(w, zp, E), cnt = {}, ts = 0, k, o = { cloud: cl, share: cl.length / E.length };
  cl.forEach(function (e) { cnt[e.t] = (cnt[e.t] || 0) + 1; });
  for (k in cnt) if (!ts || cnt[k] > cnt[ts] || (cnt[k] === cnt[ts] && +k < ts)) ts = +k;
  o.ts = ts; o.cond = ts ? DY.forkCond(tab, DY.forkPosterior(zp, 1), ts) : null;
  if (net && ts) {
    o.pred = DY.forkAnswer(net, zp, ts); o.depth = DY.depth(o.pred[0], o.pred[1]);
    o.near = cl.filter(function (e) { return Math.hypot(e.x - o.pred[0], e.y - o.pred[1]) < 0.3; }).length / cl.length;
  }
  return o;
};
/* the fork, zoomed: the post, the curtain's edge at x = FC[1], the real coming-out points (cyan), the best possible answer (ring) and the network's (red cross) */
DY.forkView = function (ctx, box, w, fc, title) {
  var D = CY.draw, C = CY.C, v = D.view(box[0] + 4, box[1] + 20, box[2] - 8, box[3] - 24, 3.2, 5.4, 0.8, 4.2), pt = function (p) { return [v.X(p[0]), v.Y(p[1])]; };
  D.frame(ctx, box[0], box[1], box[2], box[3], C.white);
  D.mono(ctx, title, box[0] + 8, box[1] + 11, C.mute, 9);
  ctx.save(); ctx.beginPath(); ctx.rect(box[0] + 1, box[1] + 18, box[2] - 2, box[3] - 19); ctx.clip();
  D.arena(ctx, v, w, { goal: false });
  fc.cloud.forEach(function (e) { D.dot(ctx, v.X(e.x), v.Y(e.y), 2.2, 'rgba(8,145,178,0.6)'); });
  if (fc.cond) { var q = pt([fc.cond.mx, fc.cond.my]); ctx.beginPath(); ctx.arc(q[0], q[1], 7, 0, 2 * Math.PI); ctx.strokeStyle = C.ink; ctx.lineWidth = 1.5; ctx.stroke(); }
  if (fc.pred) { var r = pt(fc.pred); D.line(ctx, r[0] - 6, r[1] - 6, r[0] + 6, r[1] + 6, C.red, 2.4); D.line(ctx, r[0] - 6, r[1] + 6, r[0] + 6, r[1] - 6, C.red, 2.4); }
  ctx.restore();
  return v;
};

/* ───────────── small plotting helpers: a framed chart with axes, polylines with gaps, bars ───────────── */
DY.chart = function (ctx, box, o) {
  var D = CY.draw, C = CY.C, bx = box[0] + 38, by = box[1] + 24, bw = box[2] - 50, bh = box[3] - 52;
  D.frame(ctx, box[0], box[1], box[2], box[3], C.white);
  D.mono(ctx, o.title, box[0] + 8, box[1] + 12, C.mute, 9);
  var X = function (x) { return bx + (x - o.x0) / (o.x1 - o.x0) * bw; }, Y = function (y) { return by + bh - (y - o.y0) / (o.y1 - o.y0) * bh; };
  (o.yt || []).forEach(function (v) { D.line(ctx, bx, Y(v), bx + bw, Y(v), C.grid, 1); D.mono(ctx, '' + v, bx - 5, Y(v), C.mute, 9, 'right'); });
  (o.xt || []).forEach(function (v) { D.mono(ctx, '' + v, X(v), by + bh + 11, C.mute, 9, 'center'); });
  if (o.xl) D.mono(ctx, o.xl, bx + bw / 2, by + bh + 24, C.mute, 9, 'center');
  return { X: X, Y: Y, bx: bx, by: by, bw: bw, bh: bh };
};
DY.lines = function (ctx, ch, xs, ys, color, width, dash, dots) {         // polyline in data coordinates; NaN or null breaks the line
  var pts = [], i;
  var flush = function () { if (pts.length > 1) CY.draw.path(ctx, pts, color, width, dash); pts = []; };
  for (i = 0; i < xs.length; i++) {
    if (ys[i] === null || isNaN(ys[i])) { flush(); continue; }
    pts.push([ch.X(xs[i]), ch.Y(ys[i])]); if (dots) CY.draw.dot(ctx, ch.X(xs[i]), ch.Y(ys[i]), dots, color);
  }
  flush();
};

/* a bar chart in a framed box.  o: title, labels[], vals[] (null = no bar), err[] (optional +- whiskers), y0, y1, yt (tick values), colors[] or color, fmt(v), marks [{v, text, color}] (dashed horizontal lines) */
DY.bars = function (ctx, box, o) {
  var D = CY.draw, C = CY.C, n = o.vals.length, ch = DY.chart(ctx, box, { title: o.title, x0: 0, x1: n, y0: o.y0 || 0, y1: o.y1, yt: o.yt }), bw = 0.56 * ch.bw / n, lx = box[0] + box[2] - 8;
  (o.marks || []).forEach(function (mk) {                       // dashed reference lines, named in the title row
    D.line(ctx, ch.bx, ch.Y(mk.v), ch.bx + ch.bw, ch.Y(mk.v), mk.color, 1.5, [4, 3]);
    D.mono(ctx, mk.text, lx, box[1] + 11, mk.color, 9, 'right'); lx -= mk.text.length * 5.6 + 6; D.line(ctx, lx - 14, box[1] + 11, lx, box[1] + 11, mk.color, 1.5, [4, 3]); lx -= 22;
  });
  o.vals.forEach(function (v, i) {
    ('' + o.labels[i]).split('\n').forEach(function (s, k) { D.mono(ctx, s, ch.X(i + 0.5), ch.by + ch.bh + 11 + 11 * k, C.mute, 9, 'center'); });
    if (v === null || isNaN(v)) return;
    var x = ch.X(i + 0.5), top = ch.Y(Math.min(v, o.y1)), base = ch.Y(o.y0 || 0), e = o.err ? o.err[i] : 0, txt = o.fmt ? o.fmt(v) : v.toFixed(2), ty = Math.min(top, ch.Y(Math.min(v + e, o.y1))) - 7;
    ctx.fillStyle = (o.colors && o.colors[i]) || o.color || C.purple; ctx.fillRect(x - bw / 2, Math.min(top, base), bw, Math.abs(base - top));
    if (o.err) D.line(ctx, x, ch.Y(v - e), x, ch.Y(v + e), C.ink, 1.5);
    ctx.fillStyle = C.white; ctx.fillRect(x - txt.length * 2.9 - 1, ty - 6, txt.length * 5.8 + 2, 12);
    D.mono(ctx, txt, x, ty, C.ink, 9, 'center');
  });
  return ch;
};
/* a framed box with a one-line message (a panel whose experiment needs something the reader has not done yet) */
DY.note = function (ctx, box, text, title) {
  CY.draw.frame(ctx, box[0], box[1], box[2], box[3], CY.C.white);
  CY.draw.mono(ctx, title || '', box[0] + 8, box[1] + 11, CY.C.mute, 9);
  CY.draw.mono(ctx, text, box[0] + box[2] / 2, box[1] + box[3] / 2, CY.C.mute, 10, 'center');
};
/* the arena with one episode over steps t0..t1: the true path (grey line), the readings (cyan dots), the network's one-step predictions (purple rings, at the place it expects
 * the next reading) and, when o.win = {w, m} is given, the window predictor's (amber crosses, only where all m readings exist).  Returns the view. */
DY.trace = function (ctx, box, w, ep, o) {
  var D = CY.draw, C = CY.C, v = D.view(box[0] + 4, box[1] + 20, box[2] - 8, box[3] - 24, o.x0 === undefined ? 0 : o.x0, o.x1 || w.W, o.y0 === undefined ? 0 : o.y0, o.y1 || w.H), t, p;
  D.frame(ctx, box[0], box[1], box[2], box[3], C.white);
  D.mono(ctx, o.title, box[0] + 8, box[1] + 11, C.mute, 9);
  ctx.save(); ctx.beginPath(); ctx.rect(box[0] + 1, box[1] + 18, box[2] - 2, box[3] - 19); ctx.clip();
  D.arena(ctx, v, w, { goal: false });
  D.path(ctx, ep.S.slice(o.t0, o.t1 + 1).map(function (s) { return [v.X(s[0]), v.Y(s[1])]; }), C.dim, 1.5);
  for (t = o.t0; t <= o.t1; t++) {
    if (ep.Z[t]) D.dot(ctx, v.X(ep.Z[t][0]), v.Y(ep.Z[t][1]), 2.5, C.cyan);
    if (o.pred && t < ep.T) { p = o.pred[t]; ctx.beginPath(); ctx.arc(v.X(p[0]), v.Y(p[1]), 4, 0, 2 * Math.PI); ctx.strokeStyle = C.purple; ctx.lineWidth = 1.5; ctx.stroke(); }
    p = o.win ? DY.windowPredict(ep, o.win.w, o.win.m, t) : null;
    if (p) { D.line(ctx, v.X(p[0]) - 3.5, v.Y(p[1]) - 3.5, v.X(p[0]) + 3.5, v.Y(p[1]) + 3.5, C.amber, 1.5); D.line(ctx, v.X(p[0]) - 3.5, v.Y(p[1]) + 3.5, v.X(p[0]) + 3.5, v.Y(p[1]) - 3.5, C.amber, 1.5); }
  }
  ctx.restore();
  return v;
};

/* ───────────── the widget's four panels ───────────── */
/* st = { L: DY.linear(), S: DY.plainSets(), net, rep: DY.plainReport() or null, FW: the fork world, fst: DY.forkStats() or null, iN: index of the launch of the what-if scene };
 * T = the controls: m (window), mode (cross | nudge | push | fork), sv (second slider), amp = sv / 10, and what the mode needs: cr (a clean crossing), wi (what-if statistics),
 * ps (push statistics), fc (the fork case).  A: the launch or the fork.  B: window error against length.  C: the weights against the filter's impulse response.  D: the experiment. */
DY.paint = function (ctx, w, h, st, T) {
  var D = CY.draw, C = CY.C, L = st.L, R = L.R, S = st.S, rep = st.rep, fst = st.fst, narrow = w < 600, ms = [], lags = [], j, ep, run, v, sc;
  for (j = 1; j <= DY.LMAX; j++) { ms.push(j); lags.push(j - 1); }
  var A = narrow ? [8, 8, w - 16, 250] : [8, 8, Math.round(w * 0.48), 280], B = narrow ? [8, 270, w - 16, 190] : [A[0] + A[2] + 10, 8, w - A[0] - A[2] - 18, 280];
  var Cb = narrow ? [8, 472, w - 16, 190] : [8, 298, A[2], h - 306], Dd = narrow ? [8, 674, w - 16, 250] : [B[0], 298, B[2], h - 306];
  var why = !rep ? 'train the Courtyard net first (first button)' : 'move the second slider off zero', zoom = function (p, left, right, dy, shift) { return { x0: p[0] - left, x1: p[0] + right, y0: p[1] + shift - dy, y1: p[1] + shift + dy }; };
  if (T.mode === 'fork') DY.forkView(ctx, A, st.FW, T.fc, 'cyan: real coming-out points · ring: best possible · cross: net');
  else if (T.mode === 'cross') {
    ep = S.te[T.cr.i]; run = rep && rep.runs[T.cr.i];
    var t0 = Math.max(0, T.cr.a0 - 8), t1 = Math.min(ep.T, T.cr.b1 + 8), bx0 = 9, bx1 = -9, by0 = 9, by1 = -9;        // the view: eight steps before the curtain to eight after it
    for (j = t0; j <= t1; j++) { bx0 = Math.min(bx0, ep.S[j][0]); bx1 = Math.max(bx1, ep.S[j][0]); by0 = Math.min(by0, ep.S[j][1]); by1 = Math.max(by1, ep.S[j][1]); }
    DY.trace(ctx, A, S.w, ep, { title: 'readings (cyan), window guess (×), net guess (○)', x0: bx0 - 0.3, x1: bx1 + 0.3, y0: by0 - 0.15, y1: by1 + 0.15, t0: t0, t1: t1, pred: run && run.pred, win: { w: L.W[T.m - 1], m: T.m } });
  }
  else if (T.mode === 'nudge') {
    ep = S.te[st.iN]; run = rep && rep.runs[st.iN];
    v = DY.trace(ctx, A, S.w, ep, Object.assign(zoom(ep.S[18], 2.4, 1.6, 1.35, 0), { title: 'grey: real · purple: imagined · dashed: with the nudge', t0: 6, t1: 18, pred: run && run.pred }));
    sc = rep && T.sv ? DY.nudgeScene(st.net, run, ep, [0, T.amp]) : null;
    if (sc) [[sc.real, C.dim, null], [sc.truth, C.dim, [4, 3]], [sc.imag0, C.purple, null], [sc.imag1, C.purple, [4, 3]]].forEach(function (q) { D.path(ctx, q[0].map(function (p) { return [v.X(p[0]), v.Y(p[1])]; }), q[1], 2, q[2]); });
  } else if (T.mode === 'push' && T.ps) {
    ep = T.ps.ex.ep; sc = ep.S[22];
    v = DY.trace(ctx, A, S.w, ep, Object.assign(zoom(sc, 2, 2.2, 1.8, 0.9 * Math.sign(T.ps.ex.a[1])), { title: 'readings, net guesses · arrow: the unlogged push', t0: 14, t1: 28, pred: T.ps.ex.pred }));
    D.arrow(ctx, v.X(sc[0]), v.Y(sc[1]), v.X(sc[0]), v.Y(sc[1] + 0.5 * Math.sign(T.ps.ex.a[1])), C.red, 2, 6);
  } else DY.note(ctx, A, why);
  var fit = L.mse.map(function (x) { return x / R.Sinf; }), ch = DY.chart(ctx, B, { title: 'next-reading error ÷ floor, by window length', x0: 0.5, x1: 14.5, y0: 1, y1: 2, xt: [1, 2, 4, 6, 8, 10, 12, 14], yt: [1, 1.25, 1.5, 1.75, 2], xl: 'window length m (readings)' });
  DY.lines(ctx, ch, ms, ms.map(function (m) { var x = R.S[m] / R.Sinf; return x <= 2 ? x : NaN; }), C.dim, 1.5, [4, 3]);
  DY.lines(ctx, ch, ms, fit, C.amber, 2.2, null, 2.5);
  if (rep) { D.line(ctx, ch.bx, ch.Y(rep.ratio), ch.bx + ch.bw, ch.Y(rep.ratio), C.purple, 2, [6, 3]); D.mono(ctx, 'recurrent net', ch.bx + ch.bw - 4, ch.Y(rep.ratio) - 7, C.purple, 9, 'right'); }
  D.dot(ctx, ch.X(T.m), ch.Y(fit[T.m - 1]), 6, C.amber, C.ink);
  D.mono(ctx, 'fitted window', ch.X(1.3), ch.Y(1.93), C.amber, 9); D.mono(ctx, 'filter started cold', ch.X(4.4), ch.Y(1.7), C.dim, 9);
  var wm = L.W[T.m - 1], hi = Math.max(0.45, 1.1 * Math.max.apply(null, wm)), lo = Math.min(-0.1, 1.15 * Math.min.apply(null, wm));
  var cw = DY.chart(ctx, Cb, { title: 'weights on the reading j steps old (bars) · filter h_j (line)', x0: -0.6, x1: 13.6, y0: lo, y1: hi, xt: [0, 2, 4, 6, 8, 10, 12], yt: [-0.2, 0, 0.2, 0.4, 0.6, 0.8, 1].filter(function (t) { return t >= lo && t <= hi; }), xl: 'lag j (steps)' });
  for (j = 0; j < T.m; j++) { ctx.fillStyle = C.amber; ctx.fillRect(cw.X(j) - 5, Math.min(cw.Y(0), cw.Y(wm[j])), 10, Math.abs(cw.Y(wm[j]) - cw.Y(0))); }
  DY.lines(ctx, cw, lags, R.h, C.ink, 1.6, null, 2.5);
  if (T.mode === 'cross' && rep) DY.bars(ctx, Dd, { title: 'net error after the curtain ÷ floor', labels: ['0', '1', '2', '3', '4', '5'], vals: rep.gap, y1: 3.5, yt: [0, 1, 2, 3], color: C.purple, marks: [{ v: 1, text: 'floor', color: C.green }, { v: rep.ratio, text: 'free flight', color: C.purple }] });
  else if (T.mode === 'nudge' && T.wi) DY.bars(ctx, Dd, { title: 'imagined ÷ true effect of the nudge, k steps later', labels: ['1', '2', '3', '4', '5'], vals: T.wi.ratio, err: T.wi.spread, y1: 1.6, yt: [0, 0.5, 1, 1.5], color: C.purple, marks: [{ v: 1, text: 'exact', color: C.green }] });
  else if (T.mode === 'push' && T.ps) DY.bars(ctx, Dd, { title: 'surprise at the frames after the push', labels: ['0', '1', '2', '3', '4', '5'], vals: T.ps.s, y1: 5, yt: [0, 1, 2, 3, 4, 5], color: C.red, marks: [{ v: 1, text: 'free flight', color: C.green }] });
  else if (T.mode === 'fork') DY.bars(ctx, Dd, { title: 'fork, m² per axis · out = coming-out frame · * = |z′| < 5 cm', labels: ['elsewhere\nnet', 'out\nnet', 'out\nbest', 'out *\nnet', 'out *\nbest'], vals: fst ? [fst.els, fst.em, fst.irr, fst.aem, fst.airr] : [null, null, null, null, null], y1: 0.16, yt: [0, 0.05, 0.1, 0.15], colors: [C.dim, C.purple, C.green, C.purple, C.green], fmt: function (x) { return x.toFixed(3); } });
  else DY.note(ctx, Dd, T.mode === 'cross' ? 'press "Train Courtyard net" to fill this panel' : why);
};

root.DY = DY;
if (typeof module !== 'undefined' && module.exports) module.exports = DY;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
