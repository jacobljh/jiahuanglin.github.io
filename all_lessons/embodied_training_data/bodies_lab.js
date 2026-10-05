/* bodies_lab.js — lesson 8's private engine: demonstrations from other bodies, and what one of them is worth to your arm.
 *
 * Your arm A has a few demonstrated layouts of its own; another laboratory's arm B has many.  A layout is (shift, tilt) of the row of posts, a demonstration is one calm run of an
 * expert on one layout, and the policy is the lookup of lessons 6 and 7: copy the frames of the demonstrated layout nearest to this one, a chunk of H absolute targets at a time,
 * tracked by the stiff controller u = K (target - q).  What changes here is only what a stored target IS:
 *   joint  the joint angles the demonstrator's own arm was in (what the other laboratory's file contains);
 *   hand   the place the demonstrator's hand was, in metres; the executing arm turns it into its own joint angles with its own inverse kinematics.
 * A foreign layout counts 1/w times as far away as an own one (w = 0: foreign data are ignored, which is what a body tag does to a lookup; w = 1: trusted like your own).
 * The exchange rate is read off the success curve of your own data: how many extra own layouts give the success the foreign ones gave.
 * Deterministic: every draw comes from BN.rng.  Test layout k runs with BN.rng(1000 EVSEED + k + 1) for its start offset and its gusts.  Rollouts are memoised
 * per (demonstration, label space, test layout): the same lookup always gives the same run.
 */
(function (root) {
'use strict';
var BN = root.BN || require('./bench.js');
var BL = {};
var DT = 0.05, VMAX = 1.5, C2 = 0.05 * 0.05, JIT = 0.01, NP = 5;
BL.H = 16; BL.K = 20; BL.GUST = 0.08; BL.NTEST = 1000; BL.TSEED = 99; BL.EVSEED = 5; BL.OWNSEED = 1011; BL.FORSEED = 2024; BL.NFILE = 256;
BL.BOX = { s: 0.10, t: 0.20 };                                           // layouts: shift in +-10 cm, tilt in +-0.2 m per m
BL.GRID = [1, 2, 4, 8, 12, 16, 24, 32, 48, 64, 96, 128, 192, 256];       // own-layout counts of the calibration curve
BL.MS = [0, 4, 8, 16, 32, 64, 128, 256];                                 // foreign layouts the widget offers

/* the bodies: link lengths (m) and the plant's gain when the body runs; rgain, lag and noise describe the plant that recorded its demonstrations (default: the calm expert, gain 1) */
BL.bodies = {
  A:     { name: 'your arm A', L1: 0.50, L2: 0.50, gain: 0.85 },
  twin:  { name: 'same make as A', L1: 0.50, L2: 0.50, gain: 0.85 },
  close: { name: 'links 0.51 + 0.49', L1: 0.51, L2: 0.49, gain: 0.85 },
  near:  { name: 'links 0.55 + 0.45', L1: 0.55, L2: 0.45, gain: 0.85 },
  old:   { name: 'an older arm', L1: 0.50, L2: 0.50, gain: 0.85, rgain: 0.85, lag: 0.1, noise: 0.12 }
};
BL.BODYKEYS = ['twin', 'close', 'near', 'old'];

/* layouts drawn uniformly from the box; the distance between two layouts is the largest displacement of any of the five posts (m) */
BL.layouts = function (n, seed) { var r = BN.rng(seed), out = [], i; for (i = 0; i < n; i++) out.push([(2 * r() - 1) * BL.BOX.s, (2 * r() - 1) * BL.BOX.t]); return out; };
BL.dist = function (a, b) { var m = 0, i, d; for (i = 0; i < NP; i++) { d = Math.abs((a[0] - b[0]) + (a[1] - b[1]) * 0.2 * (i - 2)); if (d > m) m = d; } return m; };

BL.world = function (theta, body) { return BN.slalom.world(NP, { shift: theta[0], tilt: theta[1], body: { L1: body.L1, L2: body.L2 } }); };

/* one demonstration: the expert of lesson 1 on the body's own links, from a start offset of 1 cm, on the plant that recorded it.  Stored: joint angles Q and hand positions P of every frame */
BL.demo = function (body, theta, seed) {
  var w = BL.world(theta, body), ro = BN.rollout(w, function (q) { return BN.slalom.expertAct(w, q); }, BN.rng(seed),
    { plant: { gain: body.rgain || 1, lag: body.lag || 0, noise: body.noise || 0 }, jit: JIT, T: 2 * BN.slalom.horizon(w) });
  var n = ro.S.length, Q = new Float64Array(2 * n), P = new Float64Array(2 * n), i;
  for (i = 0; i < n; i++) { Q[2 * i] = ro.S[i][0]; Q[2 * i + 1] = ro.S[i][1]; P[2 * i] = ro.P[i][0]; P[2 * i + 1] = ro.P[i][1]; }
  return { theta: theta, Q: Q, P: P, n: n, ok: ro.done && !ro.coll, body: body };
};
/* a body's file: it attempts the first m layouts of the list (demonstration k has seed 500 + k) and keeps the runs that succeeded, as a laboratory would; dm.k is the layout's index */
BL.collect = function (body, thetas, m) {
  var out = [], k, d; for (k = 0; k < m && k < thetas.length; k++) { d = BL.demo(body, thetas[k], 500 + k); if (d.ok) { d.k = k; d.id = body.name + '#' + k; out.push(d); } }
  return out;
};
BL.files = {};
BL.file = function (key) {
  if (!BL.files[key]) BL.files[key] = BL.collect(BL.bodies[key], BL.layouts(BL.NFILE, key === 'A' ? BL.OWNSEED : BL.FORSEED), BL.NFILE);
  return BL.files[key];
};
BL.tests = null;
BL.testSet = function () { return BL.tests || (BL.tests = BL.layouts(BL.NTEST, BL.TSEED)); };

/* the layout-conditioned policy: of all stored layouts pick the one nearest to this layout (a foreign layout counts 1/w times as far; w = 0 never picks it) */
BL.pick = function (own, foreign, wf, theta) {
  var best = null, bd = Infinity, i, d;
  for (i = 0; i < own.length; i++) { d = BL.dist(theta, own[i].theta); if (d < bd) { bd = d; best = own[i]; } }
  if (wf > 0) for (i = 0; i < foreign.length; i++) { d = BL.dist(theta, foreign[i].theta) / wf; if (d < bd) { bd = d; best = foreign[i]; } }
  return best;
};
/* one rollout of the executing body `me` on the test world w, following demonstration `dm`.  Every H steps look up the stored frame nearest to the arm (joint space: by joint
 * angles; hand space: by hand position), then track the next H stored targets.  Returns {done, coll, steps, P}. */
BL.execute = function (me, w, dm, space, rng, keep) {
  var H = BL.H, K = BL.K, g = me.gain, gust = BL.GUST, T = BN.slalom.horizon(w), xr = BN.slalom.xEnd(w) - 0.02, posts = w.posts, L1 = me.L1, L2 = me.L2;
  var q = BN.slalom.startQ(w, JIT * BN.randn(rng)).slice(), i0 = 0, t, i, j, px, py, e, bd, tq, el, u0, u1, P = keep ? [] : null, coll = false, done = false, dx, dy;
  var Q = dm.Q, PP = dm.P, n = dm.n, A = space === 'joint' ? Q : PP;
  for (t = 0; t < T; t++) {
    px = L1 * Math.cos(q[0]) + L2 * Math.cos(q[0] + q[1]); py = L1 * Math.sin(q[0]) + L2 * Math.sin(q[0] + q[1]);
    if (P) P.push([px, py]);
    for (j = 0; j < posts.length; j++) { dx = px - posts[j][0]; dy = py - posts[j][1]; if (dx * dx + dy * dy < C2) { coll = true; break; } }
    if (coll) break;
    if (px > xr) { done = true; break; }
    j = t % H;
    if (j === 0) {
      bd = Infinity; i0 = 0;
      for (i = 0; i < n; i++) {
        if (space === 'joint') { dx = A[2 * i] - q[0]; dy = A[2 * i + 1] - q[1]; } else { dx = A[2 * i] - px; dy = A[2 * i + 1] - py; }
        e = dx * dx + dy * dy; if (e < bd) { bd = e; i0 = i; }
      }
    }
    i = Math.min(i0 + j + 1, n - 1);
    if (space === 'joint') tq = [Q[2 * i], Q[2 * i + 1]];
    else { el = q[1] >= 0 ? 1 : -1; tq = BN.arm.ik([PP[2 * i], PP[2 * i + 1]], el, me); }          // the executing arm's own inverse kinematics
    u0 = Math.max(-VMAX, Math.min(VMAX, K * (tq[0] - q[0]))); u1 = Math.max(-VMAX, Math.min(VMAX, K * (tq[1] - q[1])));
    q[0] += DT * (u0 * g + gust * BN.randn(rng)); q[1] += DT * (u1 * g + gust * BN.randn(rng));
  }
  return { done: done, coll: coll, steps: t, P: P };
};
/* success of a pooled data set on the fixed test layouts: test k runs with BN.rng(1000 EVSEED + k + 1); outcomes are memoised per (demonstration, space, k) */
BL.cache = {};
BL.run = function (own, foreign, wf, space) {
  var tests = BL.testSet(), me = BL.bodies.A, ok = 0, co = 0, used = 0, k, th, dm, key, r, ro, N = tests.length;
  for (k = 0; k < N; k++) {
    th = tests[k]; dm = BL.pick(own, foreign, wf, th);
    key = dm.id + '|' + space + '|' + k; r = BL.cache[key];
    if (!r) { ro = BL.execute(me, BL.world(th, me), dm, space, BN.rng(1000 * BL.EVSEED + k + 1)); r = BL.cache[key] = ro.done ? 1 : (ro.coll ? 2 : 3); }
    if (r === 1) ok++; else if (r === 2) co++;
    if (dm.body.name !== me.name) used++;
  }
  return { N: N, ok: ok, succ: ok / N, coll: co / N, tout: (N - ok - co) / N, used: used / N, ci: BN.stats.wilson(ok, N) };
};
/* the setting {na, body, m, w, space}: your na own demonstrations plus the demonstrations of the other body's first m attempted layouts */
BL.setting = function (s) {
  var own = BL.file('A').slice(0, s.na), fd = s.m > 0 ? BL.file(s.body).filter(function (d) { return d.k < s.m; }) : [];
  var r = BL.run(own, fd, s.w, s.space); r.kept = fd.length; return r;
};

/* the cost of a label: the executing arm tracks the stored JOINT angles of another arm; where does its hand go, against where the other hand went?  Mean and largest over the demonstration (m) */
BL.labelError = function (me, dm) {
  var s = 0, mx = 0, i, a, d;
  for (i = 0; i < dm.n; i++) { a = BN.arm.fk([dm.Q[2 * i], dm.Q[2 * i + 1]], me); d = Math.hypot(a[0] - dm.P[2 * i], a[1] - dm.P[2 * i + 1]); s += d; if (d > mx) mx = d; }
  return { mean: s / dm.n, max: mx };
};

/* THE EXCHANGE RATE.  curve: your own success against your own number of layouts, {N: [...], s: [...]}, N increasing, measured on the SAME test layouts.  A pooled set of nOwn own
 * layouts plus m foreign ones reached success sPooled.  The own-layout count that would have given that success is read off the curve by linear interpolation (the origin below
 * the first point, the last segment extended above the last); the exchange rate is the number of own layouts one foreign layout is worth: (Neq - nOwn) / m.
 * 1: as good as your own data; 0: worthless; negative: harmful. */
BL.equivalentOwn = function (curve, sPooled) {
  var N = [0].concat(curve.N), s = [0], i;
  for (i = 0; i < curve.s.length; i++) s.push(Math.max(s[i], curve.s[i]));                       // the curve can only rise
  if (sPooled <= 0) return 0;
  for (i = 1; i < N.length; i++) if (sPooled <= s[i]) return N[i - 1] + (N[i] - N[i - 1]) * (sPooled - s[i - 1]) / Math.max(1e-12, s[i] - s[i - 1]);
  var a = N.length - 1, sl = (N[a] - N[a - 1]) / Math.max(1e-12, s[a] - s[a - 1]);
  return N[a] + sl * (sPooled - s[a]);
};
BL.exchangeRate = function (curve, nOwn, m, sPooled) { return m > 0 ? (BL.equivalentOwn(curve, sPooled) - nOwn) / m : NaN; };
/* your own curve on the fixed test layouts, with your own frames looked up in the given label space */
BL.curves = {};
BL.ownCurve = function (space) {
  if (BL.curves[space]) return BL.curves[space];
  var own = BL.file('A');
  return (BL.curves[space] = { N: BL.GRID.slice(), s: BL.GRID.map(function (n) { return BL.run(own.slice(0, n), [], 0, space).succ; }) });
};
/* the mean gap (m) between where another body's hand was and where A's hand goes when A tracks that body's stored joint angles, over the body's first 16 kept demonstrations */
BL.gap = function (key) {
  var f = BL.file(key).slice(0, 16), s = 0, i; for (i = 0; i < f.length; i++) s += BL.labelError(BL.bodies.A, f[i]).mean;
  return s / f.length;
};

root.BL = BL;
if (typeof module !== 'undefined' && module.exports) module.exports = BL;
})(typeof window !== 'undefined' ? window : globalThis);
