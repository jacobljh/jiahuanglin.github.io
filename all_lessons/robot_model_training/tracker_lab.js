/* tracker_lab.js — lesson 6's private engine: what a chunk contains, and what executes it.
 *
 * One table of stored frames (the 20 calm demonstrations of lessons 1 and 2, five posts), one lookup (the stored frame nearest to the arm, in joint space), and three
 * ways to turn the chunk stored with that frame into motion for the next H steps:
 *   vel   the H joint-velocity commands the expert gave, applied open loop;
 *   rel   the same commands integrated into positions that start at the arm's pose now, tracked by a controller;
 *   abs   the H poses the demonstrated arm was in next, in the world's own coordinates, tracked by the same controller.
 * The controller is u = K (target - q), clipped at 1.5 rad/s; k = K dt gain is the share of the error one step removes.
 * Rollouts never stop at a collision: the policy does not see the posts, so a run that touched one is the same run with the touch recorded.  The outcome is read afterwards
 * and the drift statistics are not biased towards the runs that lasted.  Rollout number i uses the generator BN.rng(1000 SEED + i + 1).
 */
(function (root) {
'use strict';
var BN = root.BN || require('./bench.js');
var TL = {};
var DT = 0.05, BW = 0.02, CELL = 3 * BW, CONTACT = 0.05, VMAX = 1.5, XMIN = -0.56, XBIN = 0.001, NXB = 1200;
TL.DT = DT; TL.JIT = 0.01; TL.NROLL = 200; TL.SEED = 5; TL.NDEMO = 20; TL.NPOSTS = 5; TL.SHOW = 14;
TL.CHUNKS = [1, 2, 4, 8, 16, 32, 64, 0];                 // chunk lengths in steps; 0 stands for the whole course in one chunk
TL.KINDS = ['vel', 'rel', 'abs'];

/* the stored frames: every pair (joint angles, command) of the demonstrations, the poses that followed, and a grid of cells for the lookup */
TL.table = function (n, m) {
  var w = BN.slalom.world(n), runs = BN.demos(w, m, BN.rng(1), { noise: 0, jit: TL.JIT });
  var tab = { w: w, n: n, m: m, T: BN.slalom.horizon(w), xe: BN.slalom.xEnd(w), S: [], A: [], L: [], Ls: [], FX: [], FY: [], RID: [], RT: [], PX: [], PY: [], cells: {} }, id = 0, t, i, k;
  runs.forEach(function (ro, r) {
    var L = ro.A.length, Ls = ro.S.length, S = new Float64Array(2 * Ls), A = new Float64Array(2 * L);
    for (t = 0; t < Ls; t++) { S[2 * t] = ro.S[t][0]; S[2 * t + 1] = ro.S[t][1]; }
    for (t = 0; t < L; t++) { A[2 * t] = ro.A[t][0]; A[2 * t + 1] = ro.A[t][1]; }
    tab.S.push(S); tab.A.push(A); tab.L.push(L); tab.Ls.push(Ls);
    for (t = 0; t < L; t++) {
      var key = (Math.floor(S[2 * t] / CELL) + 512) * 1024 + Math.floor(S[2 * t + 1] / CELL) + 512;
      tab.FX.push(S[2 * t]); tab.FY.push(S[2 * t + 1]); tab.RID.push(r); tab.RT.push(t);
      (tab.cells[key] || (tab.cells[key] = [])).push(id++);
    }
    for (t = 0; t < Ls; t++) { var c = BN.arm.fk([S[2 * t], S[2 * t + 1]], w.body); tab.PX.push(c[0]); tab.PY.push(c[1]); }
  });
  tab.nf = id; tab.FX = Float64Array.from(tab.FX); tab.FY = Float64Array.from(tab.FY);
  /* the path the demonstrations took: the mean height of the cup in 1 mm bins of x (the path is a graph over x), gaps filled by straight lines */
  var sum = new Float64Array(NXB + 1), cnt = new Float64Array(NXB + 1), yd = new Float64Array(NXB + 1), last = -1, first = -1;
  for (i = 0; i < tab.PX.length; i++) { var ib = Math.round((tab.PX[i] - XMIN) / XBIN); if (ib >= 0 && ib <= NXB) { sum[ib] += tab.PY[i]; cnt[ib]++; } }
  for (i = 0; i <= NXB; i++) if (cnt[i] > 0) {
    yd[i] = sum[i] / cnt[i]; if (first < 0) first = i;
    if (last >= 0) for (k = last + 1; k < i; k++) yd[k] = yd[last] + (yd[i] - yd[last]) * (k - last) / (i - last);
    last = i;
  }
  for (i = 0; i < first; i++) yd[i] = yd[first];
  for (i = last + 1; i <= NXB; i++) yd[i] = yd[last];
  tab.yd = yd;
  /* the size of the arm along the demonstrated path (cup metres per radian of joint motion, both joints in quadrature) and how far the cup moves per step */
  var js = 0, jn = 0, ss = 0, sn = 0, c0 = 0;
  tab.S.forEach(function (S, r) {
    for (t = 0; t < tab.Ls[r]; t++) { var J = BN.arm.jac([S[2 * t], S[2 * t + 1]], w.body); js += Math.sqrt(J[0] * J[0] + J[1] * J[1] + J[2] * J[2] + J[3] * J[3]); jn++; }
    for (t = 0; t + 1 < tab.Ls[r] && t < tab.L[r]; t++) { var a = BN.arm.fk([S[2 * t], S[2 * t + 1]], w.body), b2 = BN.arm.fk([S[2 * t + 2], S[2 * t + 3]], w.body); ss += Math.hypot(b2[0] - a[0], b2[1] - a[1]); sn++; }
  });
  tab.rho = js / jn; tab.vstep = ss / sn;
  return tab;
};
/* height of the demonstrated path at x */
TL.pathY = function (tab, x) { var f = (x - XMIN) / XBIN, i = Math.max(0, Math.min(NXB - 1, Math.floor(f))), a = f - i; return tab.yd[i] * (1 - a) + tab.yd[i + 1] * a; };
/* the demonstrated path's clearance from the posts when the whole row stands `shift` metres higher: the closest any demonstration comes to a post centre, minus the contact distance */
TL.clearance = function (tab, shift) {
  var best = 9, i, j;
  for (j = 0; j < tab.w.posts.length; j++) for (i = 0; i < tab.PX.length; i++) { var d = Math.hypot(tab.PX[i] - tab.w.posts[j][0], tab.PY[i] - (tab.w.posts[j][1] + shift)); if (d < best) best = d; }
  return best - CONTACT;
};

/* the stored frame nearest to the joint state q: look in the cells around q, and scan every frame when nothing lies within three bandwidths */
TL.nearest = function (tab, q) {
  var cx = Math.floor(q[0] / CELL), cy = Math.floor(q[1] / CELL), best = -1, bd = 1e30, i, j, a, t, id, dx, dy, e;
  for (i = -1; i <= 1; i++) for (j = -1; j <= 1; j++) {
    a = tab.cells[(cx + i + 512) * 1024 + cy + j + 512];
    if (a) for (t = 0; t < a.length; t++) { id = a[t]; dx = tab.FX[id] - q[0]; dy = tab.FY[id] - q[1]; e = dx * dx + dy * dy; if (e < bd) { bd = e; best = id; } }
  }
  if (best >= 0 && bd <= 9 * BW * BW) return best;
  bd = 1e30;
  for (id = 0; id < tab.nf; id++) { dx = tab.FX[id] - q[0]; dy = tab.FY[id] - q[1]; e = dx * dx + dy * dy; if (e < bd) { bd = e; best = id; } }
  return best;
};
/* what the chunk of frame (r, t0) says at its step j: the command the expert gave j steps later, and the pose the demonstrated arm was in after j + 1 steps */
TL.cmd = function (tab, r, t0, j, out) { var t = t0 + j; if (t < tab.L[r]) { out[0] = tab.A[r][2 * t]; out[1] = tab.A[r][2 * t + 1]; } else { out[0] = 0; out[1] = 0; } };
TL.pose = function (tab, r, t0, j, out) { var t = Math.min(t0 + j + 1, tab.Ls[r] - 1); out[0] = tab.S[r][2 * t]; out[1] = tab.S[r][2 * t + 1]; };
/* the largest k = K dt gain that is stable when the plant answers d steps late: the loop e(t+1) = e(t) - k e(t-d) is stable for k below 2 sin(pi / (4d + 2)) */
TL.kcrit = function (d) { return 2 * Math.sin(Math.PI / (4 * d + 2)); };

TL.newAcc = function () { return { ok: 0, co: 0, to: 0, n: 0, s2: 0, sn: 0, e2: 0, en: 0, paths: [], hits: [] }; };
/* one rollout of `kind` with chunks of H steps (0 = the whole course).  K: stiffness of the tracker, pl: {gain, noise, delay}, posts: the posts of the world driven in.
 * Folds its outcome into acc: ok / co / to count successes, collisions, timeouts; s2 / sn sum the squared distance, at the cup, between where each completed chunk meant
 * the arm to be and where it is; e2 / en sum the squared height of the cup above the demonstrated path at the end of the run. */
TL.rollout = function (tab, kind, H, K, pl, rng, posts, acc, keep) {
  var T = tab.T, xr = tab.xe - 0.02, g = pl.gain === undefined ? 1 : pl.gain, sg = pl.noise || 0, d = pl.delay || 0, b = tab.w.body, h = H > 0 ? H : T, C2 = CONTACT * CONTACT;
  var q = BN.slalom.startQ(tab.w, TL.JIT * BN.randn(rng)).slice(), ref = [0, 0], u = [0, 0], z = [0, 0], bq0 = new Float64Array(d || 1), bq1 = new Float64Array(d || 1);
  var r = 0, t0 = 0, coll = -1, done = -1, path = keep ? [] : null, t, j, k, px, py, e, ua0, ua1, id, dx, dy;
  for (t = 0; t < T; t++) {
    px = b.L1 * Math.cos(q[0]) + b.L2 * Math.cos(q[0] + q[1]); py = b.L1 * Math.sin(q[0]) + b.L2 * Math.sin(q[0] + q[1]);
    if (keep) path.push([px, py]);
    if (coll < 0) for (k = 0; k < posts.length; k++) { dx = px - posts[k][0]; dy = py - posts[k][1]; if (dx * dx + dy * dy < C2) { coll = t; break; } }
    if (px > xr) { done = t; break; }
    j = t % h;
    if (j === 0) {                                                    // a new chunk: copy the one stored with the frame nearest to where the arm is
      if (t > 0) { e = BN.arm.fk(ref, b); acc.s2 += (px - e[0]) * (px - e[0]) + (py - e[1]) * (py - e[1]); acc.sn++; }
      id = TL.nearest(tab, q); r = tab.RID[id]; t0 = tab.RT[id]; ref[0] = q[0]; ref[1] = q[1];
    }
    if (kind === 'vel') { TL.cmd(tab, r, t0, j, u); ref[0] += DT * u[0]; ref[1] += DT * u[1]; }
    else {
      if (kind === 'rel') { TL.cmd(tab, r, t0, j, z); ref[0] += DT * z[0]; ref[1] += DT * z[1]; } else TL.pose(tab, r, t0, j, ref);
      u[0] = K * (ref[0] - q[0]); u[1] = K * (ref[1] - q[1]);
    }
    if (d === 0) { ua0 = u[0]; ua1 = u[1]; } else { k = t % d; ua0 = bq0[k]; ua1 = bq1[k]; bq0[k] = u[0]; bq1[k] = u[1]; }
    q[0] += DT * (Math.max(-VMAX, Math.min(VMAX, ua0)) * g + (sg ? sg * BN.randn(rng) : 0));
    q[1] += DT * (Math.max(-VMAX, Math.min(VMAX, ua1)) * g + (sg ? sg * BN.randn(rng) : 0));
  }
  var p = BN.arm.fk(q, b);
  if (H === 0) { e = BN.arm.fk(ref, b); acc.s2 += (p[0] - e[0]) * (p[0] - e[0]) + (p[1] - e[1]) * (p[1] - e[1]); acc.sn++; }   // the whole course is one chunk: measure where it ends
  var dv = p[1] - TL.pathY(tab, p[0]); acc.e2 += dv * dv; acc.en++;
  if (done >= 0 && (coll < 0 || coll > done)) acc.ok++; else if (coll >= 0) acc.co++; else acc.to++;
  acc.n++;
  if (keep) acc.paths.push({ P: path, coll: coll, done: done });
  return acc;
};
/* rollouts from..to of one setting {kind, H, K, plant, shift}, folded into acc */
TL.evaluate = function (tab, s, from, to, acc, keep) {
  var posts = tab.w.posts.map(function (p) { return [p[0], p[1] + (s.shift || 0)]; });
  for (var i = from; i < to; i++) TL.rollout(tab, s.kind, s.H, s.K, s.plant, BN.rng(1000 * TL.SEED + i + 1), posts, acc, keep && i < TL.SHOW);
  return acc;
};
/* the numbers of an accumulator: success, collision and timeout rates with the Wilson interval, drift after a chunk and distance from the path at the end (cm) */
TL.summary = function (acc) {
  var n = Math.max(1, acc.n);
  return { n: acc.n, succ: acc.ok / n, coll: acc.co / n, tout: acc.to / n, ci: BN.stats.wilson(acc.ok, Math.max(1, acc.n)),
           drift: acc.sn ? Math.sqrt(acc.s2 / acc.sn) * 100 : NaN, endDev: acc.en ? Math.sqrt(acc.e2 / acc.en) * 100 : NaN };
};
TL.run = function (tab, s, N) { var acc = TL.newAcc(); TL.evaluate(tab, s, 0, N || TL.NROLL, acc, false); return TL.summary(acc); };

root.TL = TL;
if (typeof module !== 'undefined' && module.exports) module.exports = TL;
})(typeof window !== 'undefined' ? window : globalThis);
