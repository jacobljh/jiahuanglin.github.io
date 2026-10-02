/* ba3.js — the private engine of 3D lesson 05, "Pose by agreement II: images alone".
 *
 * True 3-D, built on geom3.js (G3): the epipolar constraint is empty in a plane, so this lesson leaves Flatland.
 * Deterministic: no Math.random, no Date.  Every random number comes from FL.rng / FL.randn (flatland.js).
 *
 *   scene            BA.scene, BA.camAt          cameras on an arc looking at a cloud of points (Halton, so every prefix is evenly spread)
 *   pixels           BA.noiseField, BA.observe, BA.matches, BA.outlierPlan
 *   two views        BA.eight, BA.decomposeE, BA.recoverPose, BA.sampson, BA.trials, BA.ransac, BA.relError, BA.twoView
 *   bundle adjust.   BA.state, BA.perturb, BA.residuals, BA.linearize, BA.lmStep, BA.run, BA.spectrum, BA.bundle
 *   gauge            BA.fixedIdx, BA.similarity, BA.applySimilarity, BA.toTruthFrame
 *
 * Conventions.  A camera is  x_cam = R X + t  (x right, y down, z forward), pixel  u = cx + f·x/z,  v = cy + f·y/z.
 * A residual is  r = prediction − observation  (pixels).  A camera is updated by a twist  xi = (rho, omega):
 *   T_i ← exp(xi_i) ∘ T_i   (lesson 3),  a point by  X_j ← X_j + dX_j.   Unknown vector layout:
 *   [ xi_0 (6), xi_1 (6), … , X_0 (3), X_1 (3), … ].
 * A note on geom3.js.  G3.svd3 divides by the smallest singular value as soon as it exceeds 1e-12, which is wrong for the exactly
 * rank-2 essential matrix (G3.decomposeE then returns a non-rotation for about 4 inputs in 10); BA.svd3s never divides by it.
 */
(function (root) {
'use strict';
var isNode = typeof module !== 'undefined' && module.exports;
var G3 = isNode ? require('./geom3.js') : root.G3;
var FLe = isNode ? require('./flatland.js') : root.FL;
var m3 = G3.m3, v3 = G3.v3, se3 = G3.se3, PI = Math.PI;
var BA = {};

function halton(i, b) { var f = 1, r = 0; while (i > 0) { f /= b; r += f * (i % b); i = Math.floor(i / b); } return r; }
function mean(a) { var s = 0; for (var i = 0; i < a.length; i++) s += a[i]; return s / a.length; }

/* ───────────────────────────── scene and pixels ───────────────────────────── */
/* nCam cameras on an arc of ±arc degrees, radius D, all looking at (0,0,D); nPts points of a 6 × 3.6 × 4 m box around that centre */
BA.camAt = function (sc, deg) {
  var phi = deg * PI / 180, D = sc.D;
  return G3.lookAt([D * Math.sin(phi), 0, D - D * Math.cos(phi)], [0, 0, D], [0, -1, 0], { f: sc.f, cx: sc.cx, cy: sc.cy });
};
BA.scene = function (o) {
  o = o || {};
  var sc = { f: o.f || 520, W: 640, H: 480, cx: 320, cy: 240, D: o.D || 7, arc: o.arc || 28, nCam: o.nCam || 5, nPts: o.nPts || 80, cams: [], X: [] }, i, k;
  for (i = 0; i < sc.nCam; i++) sc.cams.push(BA.camAt(sc, sc.nCam > 1 ? -sc.arc + 2 * sc.arc * i / (sc.nCam - 1) : 0));
  for (k = 1; k <= sc.nPts; k++) sc.X.push([(halton(k, 2) - 0.5) * 6, (halton(k, 3) - 0.5) * 3.6, sc.D + (halton(k, 5) - 0.5) * 4]);
  return sc;
};
BA.noiseField = function (n, seed) { var rng = FLe.rng(seed), z = new Float64Array(n); for (var i = 0; i < n; i++) z[i] = FLe.randn(rng); return z; };
/* obs[i][j] = [u, v] of point j in camera i: exact projection + sigma·z (z is a fixed field, so a slider scales one noise draw) */
BA.observe = function (sc, sigma, z, nUse) {
  var obs = [], c = 0, i, j;
  for (i = 0; i < sc.nCam; i++) { var row = []; for (j = 0; j < nUse; j++) { var q = G3.project(sc.cams[i], sc.X[j]); row.push([q[0] + sigma * z[c++], q[1] + sigma * z[c++]]); } obs.push(row); }
  return obs;
};
BA.toNorm = function (sc, uv) { return uv.map(function (p) { return [(p[0] - sc.cx) / sc.f, (p[1] - sc.cy) / sc.f]; }); };

/* ───────────────────────────── a rank-2-safe 3×3 SVD ───────────────────────────── */
/* A = U diag(S) Vᵀ with U, V rotations and S[2] carrying the sign; the third column of U is a cross product,
 * so nothing is divided by the smallest singular value (G3.svd3 does, and breaks on exactly rank-2 matrices). */
BA.svd3s = function (A) {
  var e = G3.eigSym(m3.mul(m3.T(A), A), 3), V = [e.vecs[0][0], e.vecs[1][0], e.vecs[2][0], e.vecs[0][1], e.vecs[1][1], e.vecs[2][1], e.vecs[0][2], e.vecs[1][2], e.vecs[2][2]];
  if (m3.det(V) < 0) { V[2] = -V[2]; V[5] = -V[5]; V[8] = -V[8]; }
  var S0 = Math.sqrt(Math.max(0, e.vals[0])), S1 = Math.sqrt(Math.max(0, e.vals[1])), S2 = Math.sqrt(Math.max(0, e.vals[2]));
  var c0 = m3.mulv(A, [V[0], V[3], V[6]]), c1 = m3.mulv(A, [V[1], V[4], V[7]]), c2 = m3.mulv(A, [V[2], V[5], V[8]]);
  var u1 = S0 > 1e-300 ? v3.scale(c0, 1 / S0) : [1, 0, 0], u2 = S1 > 1e-300 ? v3.scale(c1, 1 / S1) : [0, 1, 0];
  var u3 = v3.cross(u1, u2);
  if (v3.dot(u3, c2) < 0) S2 = -S2;
  return { U: [u1[0], u2[0], u3[0], u1[1], u2[1], u3[1], u1[2], u2[2], u3[2]], S: [S0, S1, S2], V: V };
};

/* ───────────────────────────── two views ───────────────────────────── */
/* linear eight-point on normalised coordinates (one row  p2 ⊗ p1  per match, null vector of AᵀA), then the nearest essential matrix (σ, σ, 0) */
BA.eight = function (x1, x2) { return G3.eightPoint(x1, x2); };
/* the four (R, t) candidates of an essential matrix:  E = U diag(1,1,0) Vᵀ,  t = ±u3,  R = U W Vᵀ  or  U Wᵀ Vᵀ */
BA.decomposeE = function (E) {
  var s = BA.svd3s(E), U = s.U, Vt = m3.T(s.V), W = [0, -1, 0, 1, 0, 0, 0, 0, 1];
  var R1 = m3.mul(U, m3.mul(W, Vt)), R2 = m3.mul(U, m3.mul(m3.T(W), Vt)), t = [U[2], U[5], U[8]];
  return [{ R: R1, t: t }, { R: R1, t: v3.scale(t, -1) }, { R: R2, t: t }, { R: R2, t: v3.scale(t, -1) }];
};
/* cheirality: triangulate every match with each candidate and count the points in front of both cameras */
BA.recoverPose = function (E, x1, x2) {
  var cands = BA.decomposeE(E), best = null, bestN = -1;
  cands.forEach(function (c) {
    var n = 0;
    for (var i = 0; i < x1.length; i++) { var X = G3.triangulate2(x1[i], x2[i], c.R, c.t), Xc = se3.apply({ R: c.R, t: c.t }, X); if (X[2] > 0 && Xc[2] > 0) n++; }
    c.front = n; if (n > bestN) { bestN = n; best = c; }
  });
  return { R: best.R, t: best.t, front: bestN, candidates: cands };
};
/* distance, in pixels, that a match must move for its two rays to meet (first order):  |x2ᵀ E x1| / ‖gradient‖ */
BA.sampson = function (E, a, b, f) {
  var Ea = m3.mulv(E, [a[0], a[1], 1]), Etb = m3.mulv(m3.T(E), [b[0], b[1], 1]);
  var num = b[0] * Ea[0] + b[1] * Ea[1] + Ea[2], den = Ea[0] * Ea[0] + Ea[1] * Ea[1] + Etb[0] * Etb[0] + Etb[1] * Etb[1];
  return f * Math.abs(num) / Math.sqrt(den + 1e-300);
};
/* number of random minimal samples of size s that makes the chance of at least one clean sample at least p, when a fraction w of the matches is right */
BA.trials = function (w, s, p) { var q = Math.pow(w, s); return q >= 1 ? 1 : Math.ceil(Math.log(1 - p) / Math.log(1 - q)); };
/* error of a recovered relative pose against the truth: rotation angle and angle between the translation directions (degrees) */
BA.relError = function (R, t, Rt, tt) {
  var d = v3.dot(v3.normalize(t), v3.normalize(tt));
  return { rot: m3.dist(R, Rt) * 180 / PI, dir: Math.acos(Math.max(-1, Math.min(1, d))) * 180 / PI };
};
/* the true pose of camera j relative to camera i:  x_j = R x_i + t */
BA.truthRel = function (sc, i, j) { var A = sc.cams[i], B = sc.cams[j], R = m3.mul(B.R, m3.T(A.R)); return { R: R, t: v3.sub(B.t, m3.mulv(R, A.t)) }; };
/* the wrong matches: a fixed plan (an order and a replacement pixel for every match), so the set of wrong matches only grows with frac */
BA.outlierPlan = function (n, seed) {
  var rng = FLe.rng(seed), perm = [], pos = [], i;
  for (i = 0; i < n; i++) perm.push(i);
  for (i = n - 1; i > 0; i--) { var j = Math.floor(rng() * (i + 1)), t = perm[i]; perm[i] = perm[j]; perm[j] = t; }
  for (i = 0; i < n; i++) pos.push([0.15 + 0.7 * rng(), 0.15 + 0.7 * rng()]);
  return { perm: perm, pos: pos };
};
/* matches of cameras I and J (z has 4 normals per match); round(frac·n) of them get a wrong second pixel */
BA.matches = function (sc, I, J, sigma, z, frac, plan, n) {
  var u1 = [], u2 = [], bad = [], k, c = 0, nbad = Math.round(frac * n);
  for (k = 0; k < n; k++) {
    var a = G3.project(sc.cams[I], sc.X[k]), b = G3.project(sc.cams[J], sc.X[k]);
    u1.push([a[0] + sigma * z[c++], a[1] + sigma * z[c++]]); u2.push([b[0] + sigma * z[c++], b[1] + sigma * z[c++]]); bad.push(false);
  }
  for (k = 0; k < nbad; k++) { var id = plan.perm[k]; bad[id] = true; u2[id] = [sc.W * plan.pos[id][0], sc.H * plan.pos[id][1]]; }
  return { u1: u1, u2: u2, x1: BA.toNorm(sc, u1), x2: BA.toNorm(sc, u2), bad: bad, nbad: nbad };
};
function pick(a, idx) { return idx.map(function (j) { return a[j]; }); }
function fitE(x1, x2, idx) { return BA.eight(pick(x1, idx), pick(x2, idx)); }
function consensus(E, x1, x2, f, thr) { var out = []; for (var j = 0; j < x1.length; j++) if (BA.sampson(E, x1[j], x2[j], f) < thr) out.push(j); return out; }
/* RANSAC with the eight-point as the hypothesis generator.  A trial draws 8 distinct matches, fits E, and counts the matches within thr pixels
 * of satisfying it.  A new best hypothesis is refitted on its own consensus set until that set stops growing.  The loop stops when the number
 * of trials reaches BA.trials(best inlier fraction, 8, p).  o: {f, thr, p, seed, maxIter, fixedN} */
BA.ransac = function (x1, x2, o) {
  var n = x1.length, rng = FLe.rng(o.seed || 1), p = o.p || 0.99, maxIter = o.maxIter || 3000, N = o.fixedN || maxIter, it = 0, bestE = null, bestInl = [], f = o.f;
  while (it < N && it < maxIter) {
    it++;
    var idx = []; while (idx.length < 8) { var j = Math.floor(rng() * n); if (idx.indexOf(j) < 0) idx.push(j); }
    var E = fitE(x1, x2, idx), inl = consensus(E, x1, x2, f, o.thr);
    if (inl.length > bestInl.length) {
      for (var r = 0; r < 8 && inl.length >= 8; r++) { var E2 = fitE(x1, x2, inl), inl2 = consensus(E2, x1, x2, f, o.thr); if (inl2.length <= inl.length) { if (inl2.length === inl.length) { E = E2; inl = inl2; } break; } E = E2; inl = inl2; }
      bestE = E; bestInl = inl;
      if (!o.fixedN) N = Math.min(maxIter, BA.trials(inl.length / n, 8, p));
    }
  }
  return { E: bestE, inl: bestInl, iters: it, N: N };
};
/* the whole two-view experiment of the widget.  o: {I, J, sig, z, frac, plan, robust, thr, seed} */
BA.twoView = function (sc, o) {
  var n = sc.nPts, m = BA.matches(sc, o.I, o.J, o.sig, o.z, o.frac, o.plan, n), all = [], k, rs = null, E, inl;
  for (k = 0; k < n; k++) all.push(k);
  if (o.robust) rs = BA.ransac(m.x1, m.x2, { f: sc.f, thr: o.thr || 4, seed: o.seed || 1, p: 0.99, maxIter: 1500 });
  if (rs && rs.E && rs.inl.length >= 8) { E = rs.E; inl = rs.inl; } else { E = BA.eight(m.x1, m.x2); inl = all; }
  var pose = BA.recoverPose(E, pick(m.x1, inl), pick(m.x2, inl)), tr = BA.truthRel(sc, o.I, o.J), err = BA.relError(pose.R, pose.t, tr.R, tr.t);
  var right = all.filter(function (j) { return !m.bad[j]; });
  var Et = m3.mul(m3.skew(v3.normalize(tr.t)), tr.R), rmsOf = function (M) { return Math.sqrt(mean(right.map(function (j) { var d = BA.sampson(M, m.x1[j], m.x2[j], sc.f); return d * d; }))); };
  var samp = rmsOf(E), sampTrue = rmsOf(Et);
  var X = m.x1.map(function (a, j) { return G3.triangulate2(a, m.x2[j], pose.R, pose.t); });
  var S = BA.similarity(pick(X, right), pick(sc.X, right));
  return { m: m, E: E, inl: inl, rs: rs, pose: pose, err: err, samp: samp, sampTrue: sampTrue, X: X, S: S, right: right,
           counts: pose.candidates.map(function (c) { return c.front; }).sort(function (a, b) { return b - a; }) };
};

/* ───────────────────────────── bundle adjustment ───────────────────────────── */
BA.state = function (sc, nUse) { return { cams: sc.cams.map(function (c) { return { R: c.R.slice(), t: c.t.slice() }; }), X: sc.X.slice(0, nUse).map(function (p) { return p.slice(); }) }; };
BA.clone = function (st) { return { cams: st.cams.map(function (c) { return { R: c.R.slice(), t: c.t.slice() }; }), X: st.X.map(function (p) { return p.slice(); }) }; };
/* the truth moved by a fixed random twist per camera and a random shift per point; eps scales every perturbation.
 * z has 6·nCam + 3·nPts standard normals;  rho in metres (camera frame), omega in radians, points in metres */
BA.perturb = function (st, eps, z) {
  var out = BA.clone(st), i, j, c = 0;
  for (i = 0; i < out.cams.length; i++) {
    out.cams[i] = se3.compose(se3.exp([eps * 0.12 * z[c], eps * 0.12 * z[c + 1], eps * 0.12 * z[c + 2], eps * 0.02 * z[c + 3], eps * 0.02 * z[c + 4], eps * 0.02 * z[c + 5]]), out.cams[i]); c += 6;
  }
  for (j = 0; j < out.X.length; j++) { out.X[j] = [out.X[j][0] + eps * 0.12 * z[c], out.X[j][1] + eps * 0.12 * z[c + 1], out.X[j][2] + eps * 0.12 * z[c + 2]]; c += 3; }
  return out;
};
/* explain, then compare:  r = prediction − observation, as [[ru, rv] per point] per camera */
BA.residuals = function (sc, st, obs) {
  var out = [], i, j;
  for (i = 0; i < st.cams.length; i++) { var row = []; for (j = 0; j < st.X.length; j++) { var Xc = se3.apply(st.cams[i], st.X[j]); row.push([sc.cx + sc.f * Xc[0] / Xc[2] - obs[i][j][0], sc.cy + sc.f * Xc[1] / Xc[2] - obs[i][j][1]]); } out.push(row); }
  return out;
};
BA.cost = function (sc, st, obs) { var r = BA.residuals(sc, st, obs), s = 0; for (var i = 0; i < r.length; i++) for (var j = 0; j < r[i].length; j++) s += r[i][j][0] * r[i][j][0] + r[i][j][1] * r[i][j][1]; return 0.5 * s; };
BA.rms = function (sc, st, obs) { return Math.sqrt(2 * BA.cost(sc, st, obs) / (2 * st.cams.length * st.X.length)); };
/* the normal equations  H = JᵀJ,  g = Jᵀr  at the current estimate, assembled observation by observation (analytic Jacobian):
 *   d r / d rho = Jp,   d r / d omega = −Jp [Xc]×,   d r / d X = Jp R,    Jp = f/z · [[1, 0, −x/z], [0, 1, −y/z]] */
BA.linearize = function (sc, st, obs) {
  var m = st.cams.length, p = st.X.length, n = 6 * m + 3 * p, H = new Float64Array(n * n), g = new Float64Array(n), cost = 0, i, j, a, b, row, f = sc.f;
  for (i = 0; i < m; i++) for (j = 0; j < p; j++) {
    var T = st.cams[i], Xc = se3.apply(T, st.X[j]), x = Xc[0], y = Xc[1], z = Xc[2], iz = 1 / z;
    var r = [sc.cx + f * x * iz - obs[i][j][0], sc.cy + f * y * iz - obs[i][j][1]];
    var Jp = [[f * iz, 0, -f * x * iz * iz], [0, f * iz, -f * y * iz * iz]], ci = 6 * i, pj = 6 * m + 3 * j;
    for (row = 0; row < 2; row++) {
      var q = Jp[row], jc = [q[0], q[1], q[2], y * q[2] - z * q[1], z * q[0] - x * q[2], x * q[1] - y * q[0]];
      var jx = [q[0] * T.R[0] + q[1] * T.R[3] + q[2] * T.R[6], q[0] * T.R[1] + q[1] * T.R[4] + q[2] * T.R[7], q[0] * T.R[2] + q[1] * T.R[5] + q[2] * T.R[8]];
      for (a = 0; a < 6; a++) {
        g[ci + a] += jc[a] * r[row];
        for (b = 0; b < 6; b++) H[(ci + a) * n + ci + b] += jc[a] * jc[b];
        for (b = 0; b < 3; b++) { var v = jc[a] * jx[b]; H[(ci + a) * n + pj + b] += v; H[(pj + b) * n + ci + a] += v; }
      }
      for (a = 0; a < 3; a++) { g[pj + a] += jx[a] * r[row]; for (b = 0; b < 3; b++) H[(pj + a) * n + pj + b] += jx[a] * jx[b]; }
      cost += 0.5 * r[row] * r[row];
    }
  }
  return { H: H, g: g, cost: cost, n: n };
};
/* update: apply a step d (indexed over the free unknowns) — a twist through the exponential for every camera, plain addition for every point */
BA.retract = function (st, d, free, n) {
  var full = new Float64Array(n), k, out = BA.clone(st), m = st.cams.length, i, j;
  for (k = 0; k < free.length; k++) full[free[k]] = d[k];
  for (i = 0; i < m; i++) out.cams[i] = se3.compose(se3.exp([full[6 * i], full[6 * i + 1], full[6 * i + 2], full[6 * i + 3], full[6 * i + 4], full[6 * i + 5]]), st.cams[i]);
  for (j = 0; j < st.X.length; j++) { var o = 6 * m + 3 * j; out.X[j] = [st.X[j][0] + full[o], st.X[j][1] + full[o + 1], st.X[j][2] + full[o + 2]]; }
  return out;
};
/* the gauge: holding camera 0 (6 numbers) and one component of camera 1's translation (the scale) removes the 7 free directions */
BA.fixedIdx = function (mode) { return mode === 'fixed' ? [0, 1, 2, 3, 4, 5, 6] : []; };
function freeOf(n, fixed) { var free = [], i, skip = {}; fixed.forEach(function (k) { skip[k] = true; }); for (i = 0; i < n; i++) if (!skip[i]) free.push(i); return free; }
function submatrix(H, n, free) { var m = free.length, S = new Float64Array(m * m), a, b; for (a = 0; a < m; a++) for (b = 0; b < m; b++) S[a * m + b] = H[free[a] * n + free[b]]; return S; }
/* one Levenberg–Marquardt iteration: solve (H + λ diag H) d = −g, apply d through the tangent-space update, keep it if the pixels agree better */
BA.lmStep = function (sc, st, obs, lam, fixed) {
  var L = BA.linearize(sc, st, obs), free = freeOf(L.n, fixed || []), m = free.length, S = submatrix(L.H, L.n, free), rhs = new Float64Array(m), k, tries;
  for (k = 0; k < m; k++) rhs[k] = -L.g[free[k]];
  for (tries = 0; tries < 16; tries++) {
    var Hd = Float64Array.from(S); for (k = 0; k < m; k++) Hd[k * m + k] += lam * (S[k * m + k] + 1e-12);
    var d = G3._solveSPD(Hd, rhs, m);
    if (d) {
      var st2 = BA.retract(st, d, free, L.n), c2 = BA.cost(sc, st2, obs);
      if (c2 < L.cost) return { st: st2, cost: c2, lam: Math.max(lam / 3, 1e-12), ok: true };
    }
    lam *= 4;
  }
  return { st: st, cost: L.cost, lam: lam, ok: false };
};
/* up to `iters` LM iterations from st;  trace[k] = RMS reprojection error (pixels) after k accepted iterations */
BA.run = function (sc, st, obs, iters, mode, lam0) {
  var lam = lam0 || 1e-3, cur = st, trace = [BA.rms(sc, st, obs)], fixed = BA.fixedIdx(mode), k, nres = 2 * st.cams.length * st.X.length;
  for (k = 0; k < iters; k++) { var r = BA.lmStep(sc, cur, obs, lam, fixed); if (!r.ok) break; cur = r.st; lam = r.lam; trace.push(Math.sqrt(2 * r.cost / nres)); }
  return { st: cur, trace: trace, lam: lam };
};
/* eigenvalues of JᵀJ over the free unknowns, descending */
BA.spectrum = function (sc, st, obs, mode) {
  var L = BA.linearize(sc, st, obs), free = freeOf(L.n, BA.fixedIdx(mode));
  return G3.eigSym(submatrix(L.H, L.n, free), free.length).vals;
};
/* RMS residual a fit can reach on pure noise sigma: sqrt((residuals − free unknowns) / residuals) · sigma */
BA.floor = function (sigma, m, p) { var nres = 2 * m * p; return sigma * Math.sqrt((nres - (6 * m + 3 * p - 7)) / nres); };

/* ───────────────────────────── gauge and evaluation ───────────────────────────── */
/* s, R, t minimising Σ |Q_k − (s R P_k + t)|²  (lesson 4's closed form, with a scale) */
BA.similarity = function (P, Q) {
  var n = P.length, mp = [0, 0, 0], mq = [0, 0, 0], k, a, b;
  for (k = 0; k < n; k++) for (a = 0; a < 3; a++) { mp[a] += P[k][a] / n; mq[a] += Q[k][a] / n; }
  var C = [0, 0, 0, 0, 0, 0, 0, 0, 0], vp = 0;
  for (k = 0; k < n; k++) { for (a = 0; a < 3; a++) for (b = 0; b < 3; b++) C[3 * a + b] += (Q[k][a] - mq[a]) * (P[k][b] - mp[b]) / n; vp += ((P[k][0] - mp[0]) * (P[k][0] - mp[0]) + (P[k][1] - mp[1]) * (P[k][1] - mp[1]) + (P[k][2] - mp[2]) * (P[k][2] - mp[2])) / n; }
  var s = BA.svd3s(C), R = m3.mul(s.U, m3.mul([1, 0, 0, 0, 1, 0, 0, 0, s.S[2] < 0 ? -1 : 1], m3.T(s.V))), c = (s.S[0] + s.S[1] + s.S[2]) / vp;
  return { s: c, R: R, t: v3.sub(mq, v3.scale(m3.mulv(R, mp), c)) };
};
BA.mapPoint = function (S, X) { return v3.add(v3.scale(m3.mulv(S.R, X), S.s), S.t); };
/* move a whole reconstruction by  X' = s Q X + c  (cameras: R' = R Qᵀ, t' = s t − R Qᵀ c): every pixel stays where it was */
BA.applySimilarity = function (st, S) {
  var Qt = m3.T(S.R);
  return { cams: st.cams.map(function (T) { var Rn = m3.mul(T.R, Qt); return { R: Rn, t: v3.sub(v3.scale(T.t, S.s), m3.mulv(Rn, S.t)) }; }),
           X: st.X.map(function (X) { return BA.mapPoint(S, X); }) };
};
/* express an estimate in the frame of the true scene: the similarity that takes the estimated points onto the true points */
BA.toTruthFrame = function (sc, st) {
  var S = BA.similarity(st.X, sc.X.slice(0, st.X.length));
  return { st: BA.applySimilarity(st, S), S: S };
};
/* the whole bundle-adjustment experiment of the widget.  o: {nUse, sig, zb, start, zp, gauge, k, held} */
BA.bundle = function (sc, o) {
  var truth = BA.state(sc, o.nUse), obs = BA.observe(sc, o.sig, o.zb, o.nUse), st0 = BA.perturb(truth, o.start, o.zp);
  var res = BA.run(sc, st0, obs, o.k, o.gauge), ev = BA.spectrum(sc, res.st, obs, o.gauge), al = BA.toTruthFrame(sc, res.st);
  var rel = function (st) { var A = st.cams[0], B = st.cams[2], R = m3.mul(B.R, m3.T(A.R)), t = v3.sub(B.t, m3.mulv(R, A.t)), tr = BA.truthRel(sc, 0, 2); return BA.relError(R, t, tr.R, tr.t); };
  var zeros = ev.filter(function (v) { return Math.abs(v) < 1e-9 * ev[0]; }).length, nz = ev.filter(function (v) { return Math.abs(v) >= 1e-9 * ev[0]; });
  var pred = al.st.X.map(function (X) { return G3.project(o.held, X); }), tru = sc.X.slice(0, o.nUse).map(function (X) { return G3.project(o.held, X); });
  var heldRms = Math.sqrt(mean(pred.map(function (q, j) { return (q[0] - tru[j][0]) * (q[0] - tru[j][0]) + (q[1] - tru[j][1]) * (q[1] - tru[j][1]); })));
  var c0 = G3.center(st0.cams[0]), c1 = G3.center(res.st.cams[0]);
  return { truth: truth, obs: obs, st0: st0, st: res.st, trace: res.trace, aligned: al.st, S: al.S, ev: ev, zeros: zeros, nextEig: nz[nz.length - 1], minEig: ev[ev.length - 1],
           rel: rel(res.st), rel0: rel(st0), pred: pred, tru: tru, heldRms: heldRms, moved: v3.norm(v3.sub(c1, c0)) };
};

/* page plumbing: a camera glyph from a pose x_cam = R X + t (optionally seen through a similarity S), and the piece of the line a u + b v + c = 0 inside the image */
BA.glyph = function (sc, R, t, S) {
  var c = v3.scale(m3.mulv(m3.T(R), t), -1), z = [R[6], R[7], R[8]];
  if (S) { c = BA.mapPoint(S, c); z = m3.mulv(S.R, z); }
  return { x: c[0], z: c[2], a: Math.atan2(z[2], z[0]), f: sc.f, W: sc.W };
};
BA.clipLine = function (sc, a, b, c) {
  var pts = [], W = sc.W, H = sc.H;
  [0, W].forEach(function (u) { if (Math.abs(b) > 1e-12) { var v = -(a * u + c) / b; if (v >= 0 && v <= H) pts.push([u, v]); } });
  [0, H].forEach(function (v) { if (Math.abs(a) > 1e-12) { var u = -(b * v + c) / a; if (u >= 0 && u <= W) pts.push([u, v]); } });
  return pts.length >= 2 ? [pts[0], pts[1]] : null;
};

/* ───────────────────────────── the widget's panels (drawing only) ───────────────────────────── */
function panel(ctx, r, title) { var D = FLe.draw, C = FLe.C; D.frame(ctx, r[0], r[1], r[2], r[3], C.white); D.mono(ctx, title, r[0] + 5, r[1] + 9, C.mute, 9); }
function imgBox(ctx, sc, r, title) {
  var D = FLe.draw, C = FLe.C, k = Math.min(r[2] / sc.W, (r[3] - 14) / sc.H), ox = r[0] + (r[2] - k * sc.W) / 2, oy = r[1] + 14;
  D.frame(ctx, ox, oy, k * sc.W, k * sc.H, C.white); D.mono(ctx, title, r[0] + 2, r[1] + 6, C.mute, 9);
  return { X: function (u) { return ox + k * u; }, Y: function (v) { return oy + k * v; }, k: k };
}
function worldView(ctx, r, title) { panel(ctx, r, title); return FLe.draw.view(r[0], r[1] + 14, r[2], r[3] - 14, -4.4, 4.4, -1, 10.2); }
/* two views: the world from above and camera 2 with the epipolar lines.  sc = BA.scene, T = a BA.twoView result */
BA.drawTwo = function (ctx, w, h, narrow, sc, T) {
  var D = FLe.draw, C = FLe.C;
  function glyph(R, t, S) { return BA.glyph(sc, R, t, S); }
  var rw = narrow ? [8, 8, w - 16, 250] : [8, 8, w * 0.42, h - 16], ri = narrow ? [8, 266, w - 16, h - 274] : [rw[2] + 16, 8, w - rw[2] - 24, h - 16];
  var v = worldView(ctx, rw, 'from above: truth grey, estimate colour'), j, G;
  sc.X.forEach(function (p) { D.wdot(ctx, v, p[0], p[2], 2.4, null, C.dim); });
  T.X.forEach(function (X, i) { var q = BA.mapPoint(T.S, X); D.wdot(ctx, v, q[0], q[2], 2, T.m.bad[i] ? C.red : C.green); });
  [0, 2].forEach(function (i, k) {
    G = glyph(sc.cams[i].R, sc.cams[i].t); D.camera(ctx, G, v, { color: C.mute, label: String(i), len: 1.2 });
    G = k ? glyph(T.pose.R, T.pose.t, T.S) : glyph(m3.id(), [0, 0, 0], T.S); D.camera(ctx, G, v, { color: C.blue, fov: false });
  });
  var m = imgBox(ctx, sc, ri, 'camera 2: matches and epipolar lines of E'), f = sc.f, Ec = T.E;
  for (j = 0; j < sc.nPts; j += 5) {
    var l = m3.mulv(Ec, [T.m.x1[j][0], T.m.x1[j][1], 1]), seg = BA.clipLine(sc, l[0], l[1], l[2] * f - l[0] * sc.cx - l[1] * sc.cy);
    if (seg) D.line(ctx, m.X(seg[0][0]), m.Y(seg[0][1]), m.X(seg[1][0]), m.Y(seg[1][1]), 'rgba(37,99,235,0.35)', 1);
  }
  T.m.u2.forEach(function (q, i) { D.dot(ctx, m.X(q[0]), m.Y(q[1]), T.m.bad[i] ? 3 : 2.2, T.m.bad[i] ? C.red : C.green); });
};

/* five views: the world from above, camera 1 (observed against predicted), the held-out camera, RMS per iteration, the smallest eigenvalues of JtJ.
 * sc = BA.scene, T = a BA.bundle result, opt = {NU: points used, held: the held-out camera, sig: pixel noise, gauge: 'fixed' | 'free'} */
BA.drawBundle = function (ctx, w, h, narrow, sc, T, opt) {
  var D = FLe.draw, C = FLe.C;
  function glyph(R, t, S) { return BA.glyph(sc, R, t, S); }
  var g = 8, cw = narrow ? w - 2 * g : (w - 4 * g) / 3, ph = cw * 0.75 + 14, rects;
  rects = narrow ? { world: [g, g, cw, 270], img: [g, 286, cw, ph], held: [g, 294 + ph, cw, ph] }
                 : { world: [g, g, cw, ph], img: [2 * g + cw, g, cw, ph], held: [3 * g + 2 * cw, g, cw, ph] };
  var by = narrow ? rects.held[1] + ph + g : ph + 2 * g, bh = narrow ? 150 : h - by - g;
  rects.rms = narrow ? [g, by, w - 2 * g, bh] : [g, by, w * 0.5 - 1.5 * g, bh];
  rects.eig = narrow ? [g, by + bh + g, w - 2 * g, bh] : [w * 0.5 + 0.5 * g, by, w * 0.5 - 1.5 * g, bh];
  var v = worldView(ctx, rects.world, 'from above: truth grey, fit blue'), i, j;
  for (j = 0; j < opt.NU; j++) { D.wline(ctx, v, sc.X[j][0], sc.X[j][2], T.aligned.X[j][0], T.aligned.X[j][2], C.dim, 1); D.wdot(ctx, v, sc.X[j][0], sc.X[j][2], 2.4, null, C.dim); D.wdot(ctx, v, T.aligned.X[j][0], T.aligned.X[j][2], 2, C.blue); }
  for (i = 0; i < sc.nCam; i++) { D.camera(ctx, glyph(sc.cams[i].R, sc.cams[i].t), v, { color: C.mute, len: 0.9, fov: false }); D.camera(ctx, glyph(T.aligned.cams[i].R, T.aligned.cams[i].t), v, { color: C.blue, len: 0.9, fov: false }); }
  D.camera(ctx, glyph(opt.held.R, opt.held.t), v, { color: C.violet, len: 1.2, label: 'H' });
  var m = imgBox(ctx, sc, rects.img, 'camera 1: observed dot, predicted ring'), res = BA.residuals(sc, T.st, T.obs)[1];
  for (j = 0; j < opt.NU; j++) { var o = T.obs[1][j], pu = o[0] + res[j][0], pv = o[1] + res[j][1]; D.line(ctx, m.X(o[0]), m.Y(o[1]), m.X(pu), m.Y(pv), C.red, 1); D.dot(ctx, m.X(o[0]), m.Y(o[1]), 2, C.ink); D.dot(ctx, m.X(pu), m.Y(pv), 3, null, C.blue); }
  var hm = imgBox(ctx, sc, rects.held, 'held-out camera: 20 of ' + (sc.W * sc.H).toLocaleString('en-US') + ' pixels');
  for (j = 0; j < opt.NU; j++) { D.line(ctx, hm.X(T.tru[j][0]), hm.Y(T.tru[j][1]), hm.X(T.pred[j][0]), hm.Y(T.pred[j][1]), C.red, 1); D.dot(ctx, hm.X(T.tru[j][0]), hm.Y(T.tru[j][1]), 2.5, null, C.dim); D.dot(ctx, hm.X(T.pred[j][0]), hm.Y(T.pred[j][1]), 2, C.violet); }
  D.mono(ctx, 'model → metres: ×' + T.S.s.toFixed(2), hm.X(8), hm.Y(sc.H - 10), C.mute, 9);
  /* RMS per iteration, log scale */
  var rr = rects.rms; panel(ctx, rr, 'reprojection RMS per iteration (px, log scale)');
  var n = Math.max(10, T.trace.length - 1), X = function (k) { return rr[0] + 28 + k / n * (rr[2] - 40); }, Y = function (e) { return rr[1] + 18 + (2 - Math.log(Math.max(e, 1e-14)) / Math.LN10) / 16 * (rr[3] - 30); };
  [-12, -6, 0].forEach(function (e) { D.line(ctx, rr[0] + 28, Y(Math.pow(10, e)), rr[0] + rr[2] - 12, Y(Math.pow(10, e)), C.grid, 1); D.mono(ctx, '1e' + e, rr[0] + 3, Y(Math.pow(10, e)), C.mute, 8); });
  var sg = opt.sig, fl = BA.floor(sg, sc.nCam, opt.NU);
  if (sg > 0) { D.line(ctx, rr[0] + 28, Y(fl), rr[0] + rr[2] - 12, Y(fl), C.amber, 1.2, [4, 3]); D.mono(ctx, 'σ√((m − k)/m) = ' + fl.toFixed(2), rr[0] + rr[2] - 14, Y(fl) - 7, C.amber, 9, 'right'); }
  D.path(ctx, T.trace.map(function (e, k) { return [X(k), Y(e)]; }), C.blue, 1.6);
  T.trace.forEach(function (e, k) { D.dot(ctx, X(k), Y(e), 2.5, C.blue); });
  /* the 12 smallest eigenvalues of JtJ, log scale */
  var re = rects.eig; panel(ctx, re, 'smallest eigenvalues of JᵀJ (log scale)');
  var low = T.ev.slice(-12).reverse(), bw = (re[2] - 40) / 12, Z = function (e) { return (Math.log(Math.max(Math.abs(e), 1e-13)) / Math.LN10 + 13) / 17; };
  D.line(ctx, re[0] + 24, re[1] + re[3] - 14, re[0] + re[2] - 8, re[1] + re[3] - 14, C.grid, 1);
  low.forEach(function (e, k) { var hh = Z(e) * (re[3] - 36), zero = Math.abs(e) < 1e-9 * T.ev[0]; ctx.fillStyle = zero ? C.red : C.blue; ctx.fillRect(re[0] + 28 + k * bw, re[1] + re[3] - 14 - hh, bw * 0.8, Math.max(hh, 1.5)); });
  D.mono(ctx, '1e-13', re[0] + 3, re[1] + re[3] - 14, C.mute, 8); D.mono(ctx, '1e4', re[0] + 3, re[1] + 18, C.mute, 8);
  D.mono(ctx, (opt.gauge === 'free' ? 'gauge free: ' : 'gauge fixed: ') + T.zeros + ' zero eigenvalues (red)', re[0] + re[2] - 8, re[1] + 19, T.zeros ? C.red : C.mute, 9, 'right');   // on its own row: with the title it overran a phone
};

root.BA = BA;
if (isNode) module.exports = BA;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
