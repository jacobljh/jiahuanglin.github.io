/* l03_state.js — private engine of World Models lesson 03, "What should a state keep?".  Global L3 (needs courtyard.js first).
 *
 * THE STREAM.  A clip is three consecutive pictures (index 0,1,2) of the Courtyard in free flight.  Start state: x in [0.35,7.65], y in [0.35,4.65],
 * speed U[0.5,3] m/s, direction U[0,2pi) (so position and velocity are independent); states 1 and 2 follow by CY.step; a start is redrawn until the ball
 * is in view (not behind the curtain) in all three.  Picture = CY.img.render(world, state, {sigma:1.5, band}) times a per-frame gain.  Nuisance level lam:
 * band peak 0.8*lam, width 0.4 m; gain = 1 + 0.1*lam*N(0,1).  kind 'flicker': band centre redrawn every frame; kind 'drift': centre c0 + 0.15*t m.
 * Draw order per clip (always all draws, so lam and kind never change the ball): start state (rejection loop: x,y,speed,angle), c0, then for t=0..2:
 * centre U*7+0.5, then one CY.randn for the gain.  Train stream seed 1 (200 clips), test stream seed 2 (200 clips).
 *
 * THE CODES (all read the picture at index 1; k = code size).
 *   PCA   : the k leading principal components of the 200 training pictures (Gram matrix of the centred pictures, exact symmetric eigensolver).
 *   w     : the M = 32 leading PCs of every picture, whitened with their second moments over the pictures that enter the loss (t = 0, 1, 1, 2).
 *   pairs : every consecutive pair in both orders (0>1, 1>0, 1>2, 2>1): a ball launched backwards is as likely as one launched forwards.  Then the input and
 *           target second moments are both exactly I in w-coordinates, and the lag-1 moment S = E[w_next w_now'] is exactly symmetric.
 *   CF    : the closed form of the next-code loss under unit variance + decorrelation: the eigenvectors of S ranked by |rho|; loss = 1 - mean rho^2.
 *   gu/gg : the same loss by full-batch Adam on E (k x M) and A (k x k), without / with the variance + covariance guard (covariance form, exact gradient).
 *   reward: tanh bottleneck network [M,k,16,1] trained on 600 labelled pictures to predict -distance to goal A; its k tanh units are the code.
 * THE READOUT.  10-nearest-neighbours in code space (every code number read with noise 0.05, seeded), average of the training targets; score = squared
 * correlation with the truth.  Eigenvectors are sign-normalised (largest component positive) so that the noise draws are reproducible.
 * THE PAINTER (L3.paint) draws the five panels of the lesson's widget; it only displays numbers computed above.
 */
(function (root) {
'use strict';
var CY = root.CY || (typeof require === 'function' ? require('./courtyard.js') : null);
var L3 = {};
var D = 360, M = 32, NTR = 200, NTE = 200, SIG = 1.5, AMP = 0.8, GAIN = 0.1, BW = 0.4, STEP = 0.15, MARG = 0.35, KNN = 10, FLOOR = 0.05;
var W = CY.world({});
L3.C = { D: D, M: M, N: NTR, SIG: SIG, AMP: AMP, GAIN: GAIN, BW: BW, STEP: STEP, KNN: KNN, FLOOR: FLOOR, GOAL: [6.6, 2.5], GOAL2: [4.5, 4.2], KS: [2, 4, 6, 8, 12, 16, 24], LEVELS: [0, 0.5, 1, 1.5, 2, 3], STEPS: 200, LR: 0.02, SEED: 3 };
L3.world = W;

/* ───────── exact symmetric eigensolver: Householder tridiagonalisation + implicit QL (EISPACK tred2/tql2).  vals descending, vecs[k] = k-th eigenvector ───────── */
L3.eigSym = function (A, n) {
  var V = Float64Array.from(A), d = new Float64Array(n), e = new Float64Array(n), i, j, k, f, g, h;
  for (j = 0; j < n; j++) d[j] = V[(n - 1) * n + j];
  for (i = n - 1; i > 0; i--) {
    var scale = 0; h = 0;
    for (k = 0; k < i; k++) scale += Math.abs(d[k]);
    if (scale === 0) {
      e[i] = d[i - 1];
      for (j = 0; j < i; j++) { d[j] = V[(i - 1) * n + j]; V[i * n + j] = 0; V[j * n + i] = 0; }
    } else {
      for (k = 0; k < i; k++) { d[k] /= scale; h += d[k] * d[k]; }
      f = d[i - 1]; g = Math.sqrt(h); if (f > 0) g = -g;
      e[i] = scale * g; h -= f * g; d[i - 1] = f - g;
      for (j = 0; j < i; j++) e[j] = 0;
      for (j = 0; j < i; j++) {
        f = d[j]; V[j * n + i] = f; g = e[j] + V[j * n + j] * f;
        for (k = j + 1; k <= i - 1; k++) { g += V[k * n + j] * d[k]; e[k] += V[k * n + j] * f; }
        e[j] = g;
      }
      f = 0;
      for (j = 0; j < i; j++) { e[j] /= h; f += e[j] * d[j]; }
      var hh = f / (h + h);
      for (j = 0; j < i; j++) e[j] -= hh * d[j];
      for (j = 0; j < i; j++) {
        f = d[j]; g = e[j];
        for (k = j; k <= i - 1; k++) V[k * n + j] -= f * e[k] + g * d[k];
        d[j] = V[(i - 1) * n + j]; V[i * n + j] = 0;
      }
    }
    d[i] = h;
  }
  for (i = 0; i < n - 1; i++) {
    V[(n - 1) * n + i] = V[i * n + i]; V[i * n + i] = 1;
    h = d[i + 1];
    if (h !== 0) {
      for (k = 0; k <= i; k++) d[k] = V[k * n + i + 1] / h;
      for (j = 0; j <= i; j++) {
        g = 0;
        for (k = 0; k <= i; k++) g += V[k * n + i + 1] * V[k * n + j];
        for (k = 0; k <= i; k++) V[k * n + j] -= g * d[k];
      }
    }
    for (k = 0; k <= i; k++) V[k * n + i + 1] = 0;
  }
  for (j = 0; j < n; j++) { d[j] = V[(n - 1) * n + j]; V[(n - 1) * n + j] = 0; }
  V[(n - 1) * n + n - 1] = 1; e[0] = 0;
  var VT = new Float64Array(n * n);                                    // VT[i*n+k] = V[k*n+i]: the QL rotations below work on contiguous rows
  for (i = 0; i < n; i++) for (k = 0; k < n; k++) VT[i * n + k] = V[k * n + i];
  for (i = 1; i < n; i++) e[i - 1] = e[i];
  e[n - 1] = 0;
  var ff = 0, tst1 = 0, eps = Math.pow(2, -52);
  for (var l = 0; l < n; l++) {
    tst1 = Math.max(tst1, Math.abs(d[l]) + Math.abs(e[l]));
    var m = l;
    while (m < n) { if (Math.abs(e[m]) <= eps * tst1) break; m++; }
    if (m > l) {
      do {
        g = d[l];
        var p = (d[l + 1] - g) / (2 * e[l]), r = Math.hypot(p, 1);
        if (p < 0) r = -r;
        d[l] = e[l] / (p + r); d[l + 1] = e[l] * (p + r);
        var dl1 = d[l + 1]; h = g - d[l];
        for (i = l + 2; i < n; i++) d[i] -= h;
        ff += h; p = d[m];
        var c = 1, c2 = c, c3 = c, el1 = e[l + 1], s = 0, s2 = 0;
        for (i = m - 1; i >= l; i--) {
          c3 = c2; c2 = c; s2 = s;
          g = c * e[i]; h = c * p; r = Math.hypot(p, e[i]);
          e[i + 1] = s * r; s = e[i] / r; c = p / r;
          p = c * d[i] - s * g; d[i + 1] = h + s * (c * g + s * d[i]);
          for (k = 0; k < n; k++) { h = VT[(i + 1) * n + k]; VT[(i + 1) * n + k] = s * VT[i * n + k] + c * h; VT[i * n + k] = c * VT[i * n + k] - s * h; }
        }
        p = -s * s2 * c3 * el1 * e[l] / dl1;
        e[l] = s * p; d[l] = c * p;
      } while (Math.abs(e[l]) > eps * tst1);
    }
    d[l] += ff; e[l] = 0;
  }
  var idx = []; for (i = 0; i < n; i++) idx.push(i);
  idx.sort(function (a, b) { return d[b] - d[a]; });
  var vals = new Float64Array(n), vecs = [];
  idx.forEach(function (id, q) { vals[q] = d[id]; vecs.push(signed(VT.slice(id * n, (id + 1) * n))); });
  return { vals: vals, vecs: vecs };
};
function signed(v) {                                                   // an eigenvector is defined up to its sign: make its largest component positive
  var j, b = 0; for (j = 1; j < v.length; j++) if (Math.abs(v[j]) > Math.abs(v[b])) b = j;
  if (v[b] < 0) for (j = 0; j < v.length; j++) v[j] = -v[j];
  return v;
}

/* ───────── the stream ───────── */
L3.stream = function (n, seed, lam, kind) {
  var rng = CY.rng(seed), S = new Float64Array(n * 12), F = new Float64Array(n * 3 * D), B = new Float64Array(n * 3), i, t, p, st;
  for (i = 0; i < n; i++) {
    for (;;) {
      var x = MARG + (W.W - 2 * MARG) * rng(), y = MARG + (W.H - 2 * MARG) * rng(), sp = 0.5 + 2.5 * rng(), th = 2 * Math.PI * rng();
      var a = [x, y, sp * Math.cos(th), sp * Math.sin(th)], b = CY.step(W, a, null), c = CY.step(W, b, null);
      if (!CY.occluded(W, a) && !CY.occluded(W, b) && !CY.occluded(W, c)) { st = [a, b, c]; break; }
    }
    var c0 = 1 + 6 * rng();
    for (t = 0; t < 3; t++) {
      var cr = 0.5 + 7 * rng(), g = 1 + GAIN * lam * CY.randn(rng), cx = kind === 'drift' ? c0 + STEP * t : cr;
      var fr = CY.img.render(W, st[t], { sigma: SIG, band: lam > 0 ? { cx: cx, width: BW, amp: AMP * lam } : null, gain: 1 });
      for (p = 0; p < D; p++) F[(i * 3 + t) * D + p] = fr[p] * g;
      B[i * 3 + t] = cx;
      for (p = 0; p < 4; p++) S[(i * 3 + t) * 4 + p] = st[t][p];
    }
  }
  return { n: n, lam: lam, kind: kind, S: S, F: F, B: B };
};
function frameMat(sm, t) { var X = new Float64Array(sm.n * D), i; for (i = 0; i < sm.n; i++) X.set(sm.F.subarray((i * 3 + t) * D, (i * 3 + t + 1) * D), i * D); return X; }
function totalVar(X, n) {
  var mean = new Float64Array(D), i, j, s = 0;
  for (i = 0; i < n; i++) for (j = 0; j < D; j++) mean[j] += X[i * D + j] / n;
  for (i = 0; i < n; i++) for (j = 0; j < D; j++) s += (X[i * D + j] - mean[j]) * (X[i * D + j] - mean[j]);
  return s / (n - 1);
}
L3.ballVar = function () { var sm = L3.stream(NTR, 1, 0, 'flicker'); return totalVar(frameMat(sm, 1), NTR); };

/* ───────── PCA by the Gram matrix ───────── */
function pcaOf(X, n, m) {
  var mean = new Float64Array(D), Xc = new Float64Array(n * D), G = new Float64Array(n * n), i, j, a, b, s;
  for (i = 0; i < n; i++) for (j = 0; j < D; j++) mean[j] += X[i * D + j] / n;
  for (i = 0; i < n; i++) for (j = 0; j < D; j++) Xc[i * D + j] = X[i * D + j] - mean[j];
  for (a = 0; a < n; a++) for (b = a; b < n; b++) { s = 0; for (j = 0; j < D; j++) s += Xc[a * D + j] * Xc[b * D + j]; s /= n - 1; G[a * n + b] = s; G[b * n + a] = s; }
  var e = L3.eigSym(G, n), U = [], total = 0;
  for (i = 0; i < n; i++) total += G[i * n + i];
  for (a = 0; a < m; a++) {
    var u = new Float64Array(D), v = e.vecs[a], nm = 0;
    for (i = 0; i < n; i++) for (j = 0; j < D; j++) u[j] += Xc[i * D + j] * v[i];
    for (j = 0; j < D; j++) nm += u[j] * u[j];
    nm = Math.sqrt(nm); for (j = 0; j < D; j++) u[j] /= nm;
    U.push(signed(u));
  }
  return { mean: mean, U: U, vals: e.vals, total: total };
}
function project(X, n, p) {
  var Y = new Float64Array(n * M), i, a, j, s;
  for (i = 0; i < n; i++) for (a = 0; a < M; a++) { s = 0; for (j = 0; j < D; j++) s += (X[i * D + j] - p.mean[j]) * p.U[a][j]; Y[i * M + a] = s; }
  return Y;
}
function targetsOf(sm) {
  var n = sm.n, T = { pos: new Float64Array(n * 2), vel: new Float64Array(n * 2), band: new Float64Array(n), rew: new Float64Array(n), rew2: new Float64Array(n) }, i, g = L3.C.GOAL, g2 = L3.C.GOAL2;
  for (i = 0; i < n; i++) {
    var o = (i * 3 + 1) * 4, x = sm.S[o], y = sm.S[o + 1];
    T.pos[2 * i] = x; T.pos[2 * i + 1] = y; T.vel[2 * i] = sm.S[o + 2]; T.vel[2 * i + 1] = sm.S[o + 3];
    T.band[i] = sm.B[i * 3 + 1]; T.rew[i] = -Math.hypot(x - g[0], y - g[1]); T.rew2[i] = -Math.hypot(x - g2[0], y - g2[1]);
  }
  return T;
}

/* ───────── everything that depends only on (lam, kind) ───────── */
var cache = {};
L3.model = function (lam, kind) {
  var key = lam + '/' + kind;
  if (cache[key]) return cache[key];
  var tr = L3.stream(NTR, 1, lam, kind), te = L3.stream(NTE, 2, lam, kind), n = NTR, t, i, a, b, c;
  var pc = pcaOf(frameMat(tr, 1), n, M), Ytr = [], Yte = [], Wtr = [], Wte = [];
  for (t = 0; t < 3; t++) { Ytr.push(project(frameMat(tr, t), n, pc)); Yte.push(project(frameMat(te, t), NTE, pc)); }
  var Sg = new Float64Array(M * M);                                   // second moments of the PC coordinates over the pictures that enter the loss: t = 0, 1, 1, 2 (a middle picture is an input once and a target once)
  for (t = 0; t < 3; t++) for (i = 0; i < n; i++) for (a = 0; a < M; a++) for (b = 0; b < M; b++) Sg[a * M + b] += (t === 1 ? 2 : 1) * Ytr[t][i * M + a] * Ytr[t][i * M + b] / (4 * n);
  var es = L3.eigSym(Sg, M), R = new Float64Array(M * M);              // R = Sg^(-1/2)
  for (a = 0; a < M; a++) for (b = 0; b < M; b++) { var s = 0; for (c = 0; c < M; c++) s += es.vecs[c][a] * es.vecs[c][b] / Math.sqrt(es.vals[c]); R[a * M + b] = s; }
  function whiten(Y, nn) { var Z = new Float64Array(nn * M), q, r, u; for (q = 0; q < nn; q++) for (r = 0; r < M; r++) { u = 0; for (c = 0; c < M; c++) u += R[r * M + c] * Y[q * M + c]; Z[q * M + r] = u; } return Z; }
  for (t = 0; t < 3; t++) { Wtr.push(whiten(Ytr[t], n)); Wte.push(whiten(Yte[t], NTE)); }
  var C00 = new Float64Array(M * M), C11 = new Float64Array(M * M), M10 = new Float64Array(M * M), M10T = new Float64Array(M * M), rho = new Float64Array(M);
  [[0, 1], [1, 0], [1, 2], [2, 1]].forEach(function (pr) {            // every consecutive pair, in both orders: a ball launched backwards is as likely as one launched forwards
    for (i = 0; i < n; i++) for (a = 0; a < M; a++) for (b = 0; b < M; b++) {
      var u0 = Wtr[pr[0]][i * M + a], v0 = Wtr[pr[0]][i * M + b], u1 = Wtr[pr[1]][i * M + a], v1 = Wtr[pr[1]][i * M + b];
      C00[a * M + b] += u0 * v0 / (4 * n); C11[a * M + b] += u1 * v1 / (4 * n); M10[a * M + b] += u1 * v0 / (4 * n);
    }
  });
  for (a = 0; a < M; a++) for (b = 0; b < M; b++) M10T[a * M + b] = M10[b * M + a];
  for (a = 0; a < M; a++) { var sxy = 0, sxx = 0; for (i = 0; i < n; i++) { sxy += Ytr[0][i * M + a] * Ytr[1][i * M + a] + Ytr[1][i * M + a] * Ytr[2][i * M + a]; sxx += Ytr[0][i * M + a] * Ytr[0][i * M + a] + 2 * Ytr[1][i * M + a] * Ytr[1][i * M + a] + Ytr[2][i * M + a] * Ytr[2][i * M + a]; } rho[a] = 2 * sxy / sxx; }
  var Ssym = new Float64Array(M * M); for (a = 0; a < M; a++) for (b = 0; b < M; b++) Ssym[a * M + b] = 0.5 * (M10[a * M + b] + M10[b * M + a]);
  var ec = L3.eigSym(Ssym, M), ord = []; for (a = 0; a < M; a++) ord.push(a);
  ord.sort(function (p, q) { return Math.abs(ec.vals[q]) - Math.abs(ec.vals[p]); });
  var mo = { lam: lam, kind: kind, n: n, tr: tr, te: te, pca: pc, Ytr: Ytr, Yte: Yte, Wtr: Wtr, Wte: Wte, R: R, mx: { C00: C00, C11: C11, M10: M10, M10T: M10T },
             rho: rho, cf: { val: ord.map(function (q) { return ec.vals[q]; }), vec: ord.map(function (q) { return ec.vecs[q]; }) },
             T: { tr: targetsOf(tr), te: targetsOf(te) }, k0: {}, gc: {}, rw: {} };
  cache[key] = mo;
  return mo;
};

/* ───────── latent prediction by gradient, in covariance form: loss(E,A) = mean_k E|E w1 - A E w0|^2 (+ guard) ───────── */
function lossGrad(E, A, k, mx, guard) {
  var mul = CY.la.mul, T = CY.la.T, i, j, Et = T(E, k, M), At = T(A, k, k);
  var EC0 = mul(E, k, M, mx.C00, M), G0 = mul(EC0, k, M, Et, k), EC1 = mul(E, k, M, mx.C11, M), G1 = mul(EC1, k, M, Et, k);
  var H = mul(mul(E, k, M, mx.M10, M), k, M, Et, k);                  // H = E[z1 z0']
  var AG0 = mul(A, k, k, G0, k), AH = mul(A, k, k, T(H, k, k), k), AG0At = mul(AG0, k, k, At, k), pred = 0;
  for (i = 0; i < k; i++) pred += G1[i * k + i] - 2 * AH[i * k + i] + AG0At[i * k + i];
  pred /= k;
  var AE = mul(A, k, k, E, M), AtE = mul(At, k, k, E, M);
  var t1 = mul(AtE, k, M, mx.M10, M), t2 = mul(AE, k, M, mx.M10T, M), t3 = mul(mul(mul(At, k, k, A, k), k, k, E, M), k, M, mx.C00, M);
  var gE = new Float64Array(k * M), gA = new Float64Array(k * k), V = 0, Cv = 0;
  for (i = 0; i < k * M; i++) gE[i] = (2 * EC1[i] - 2 * (t1[i] + t2[i]) + 2 * t3[i]) / k;
  for (i = 0; i < k * k; i++) gA[i] = (-2 * H[i] + 2 * AG0[i]) / k;
  if (guard) {
    [[G0, EC0], [G1, EC1]].forEach(function (pr) {
      var G = pr[0], Gam = new Float64Array(k * k), GE;
      for (j = 0; j < k; j++) { var v = Math.sqrt(G[j * k + j] + 1e-4), h = Math.max(0, 1 - v); V += h * h / k / 2; if (h > 0) Gam[j * k + j] += guard.v * (-h / (k * v)) / 2; }
      for (i = 0; i < k; i++) for (j = 0; j < k; j++) if (i !== j) { Cv += G[i * k + j] * G[i * k + j] / k / 2; Gam[i * k + j] += guard.c * (G[i * k + j] / k); }
      GE = mul(Gam, k, k, pr[1], M); for (i = 0; i < k * M; i++) gE[i] += 2 * GE[i];
    });
  }
  return { pred: pred, V: V, Cv: Cv, gE: gE, gA: gA, G0: G0 };
}
L3.lossGrad = lossGrad;
/* the loss of a given code E with its own best predictor A = H G0^-1 (the loss the gradient runs descend, without the guard) */
L3.lossOf = function (mo, E, k) {
  var mul = CY.la.mul, T = CY.la.T, Et = T(E, k, M), G0 = mul(mul(E, k, M, mo.mx.C00, M), k, M, Et, k), H = mul(mul(E, k, M, mo.mx.M10, M), k, M, Et, k);
  return lossGrad(E, T(CY.la.solve(G0, T(H, k, k), k), k, k), k, mo.mx).pred;
};
L3.gd = function (mo, k, guard, steps, seed) {
  var rng = CY.rng(seed), E = new Float64Array(k * M), A = new Float64Array(k * k), i, t, tr = { t: [], pred: [], std: [], rank: [] };
  for (i = 0; i < E.length; i++) E[i] = CY.randn(rng) / Math.sqrt(M);
  for (i = 0; i < k; i++) A[i * k + i] = 1;
  var mE = new Float64Array(E.length), vE = new Float64Array(E.length), mA = new Float64Array(A.length), vA = new Float64Array(A.length), b1 = 0.9, b2 = 0.999, lr = L3.C.LR;
  for (t = 0; t <= steps; t++) {
    var r = lossGrad(E, A, k, mo.mx, guard);
    if (t % 5 === 0) { var st = codeStats(apply(E, k, mo.Wtr[1], mo.n), mo.n, k); tr.t.push(t); tr.pred.push(r.pred); tr.std.push(st.std); tr.rank.push(st.rank); }
    if (t === steps) break;
    var c1 = 1 - Math.pow(b1, t + 1), c2 = 1 - Math.pow(b2, t + 1);
    for (i = 0; i < E.length; i++) { mE[i] = b1 * mE[i] + (1 - b1) * r.gE[i]; vE[i] = b2 * vE[i] + (1 - b2) * r.gE[i] * r.gE[i]; E[i] -= lr * (mE[i] / c1) / (Math.sqrt(vE[i] / c2) + 1e-8); }
    for (i = 0; i < A.length; i++) { mA[i] = b1 * mA[i] + (1 - b1) * r.gA[i]; vA[i] = b2 * vA[i] + (1 - b2) * r.gA[i] * r.gA[i]; A[i] -= lr * (mA[i] / c1) / (Math.sqrt(vA[i] / c2) + 1e-8); }
  }
  return { E: E, A: A, trace: tr };
};

/* ───────── codes and the readout ───────── */
function apply(E, k, Wm, n) { var Z = new Float64Array(n * k), i, a, b, s; for (i = 0; i < n; i++) for (a = 0; a < k; a++) { s = 0; for (b = 0; b < M; b++) s += E[a * M + b] * Wm[i * M + b]; Z[i * k + a] = s; } return Z; }
function cols(Y, n, k) { var Z = new Float64Array(n * k), i, a; for (i = 0; i < n; i++) for (a = 0; a < k; a++) Z[i * k + a] = Y[i * M + a]; return Z; }
function codeStats(Z, n, k) {                                           // mean standard deviation of the k code numbers, and the effective rank (participation ratio) of their covariance
  var mean = new Float64Array(k), C = new Float64Array(k * k), i, a, b, sd = 0, s1 = 0, s2 = 0;
  for (i = 0; i < n; i++) for (a = 0; a < k; a++) mean[a] += Z[i * k + a] / n;
  for (i = 0; i < n; i++) for (a = 0; a < k; a++) for (b = 0; b < k; b++) C[a * k + b] += (Z[i * k + a] - mean[a]) * (Z[i * k + b] - mean[b]) / n;
  for (a = 0; a < k; a++) sd += Math.sqrt(C[a * k + a]) / k;
  var ev = L3.eigSym(C, k).vals;
  for (a = 0; a < k; a++) { var e = Math.max(ev[a], 0); s1 += e; s2 += e * e; }
  return { std: sd, rank: s1 * s1 / Math.max(s2, 1e-300) };
}
function floor(Z, sd, seed) { var r = CY.rng(seed), O = Float64Array.from(Z), i; for (i = 0; i < O.length; i++) O[i] += sd * CY.randn(r); return O; }
function knnIdx(Ztr, Zte, ntr, nte, k) {                               // the KNN nearest training codes of every test code
  var idx = new Int32Array(nte * KNN), bd = new Float64Array(KNN), bj = new Int32Array(KNN), i, j, a, r;
  for (i = 0; i < nte; i++) {
    for (r = 0; r < KNN; r++) { bd[r] = Infinity; bj[r] = -1; }
    for (j = 0; j < ntr; j++) {
      var s = 0; for (a = 0; a < k; a++) { var d = Zte[i * k + a] - Ztr[j * k + a]; s += d * d; }
      if (s < bd[KNN - 1]) { r = KNN - 1; while (r > 0 && bd[r - 1] > s) { bd[r] = bd[r - 1]; bj[r] = bj[r - 1]; r--; } bd[r] = s; bj[r] = j; }
    }
    for (r = 0; r < KNN; r++) idx[i * KNN + r] = bj[r];
  }
  return idx;
}
function r2c(p, t, n) {                                                 // squared correlation between a readout and the truth
  var mp = 0, mt = 0, i, sxy = 0, sxx = 0, syy = 0;
  for (i = 0; i < n; i++) { mp += p[i] / n; mt += t[i] / n; }
  for (i = 0; i < n; i++) { var u = p[i] - mp, v = t[i] - mt; sxy += u * v; sxx += u * u; syy += v * v; }
  return sxy * sxy / Math.max(sxx * syy, 1e-300);
}
L3.read = function (mo, Ztr0, Zte0, k, fl) {
  var nt = mo.te.n, f = fl === undefined ? FLOOR : fl, Ztr = floor(Ztr0, f, 11), Zte = floor(Zte0, f, 12), idx = knnIdx(Ztr, Zte, mo.n, nt, k), out = {};
  ['pos', 'vel', 'band', 'rew', 'rew2'].forEach(function (key) {      // the readout resolves differences of the code no smaller than FLOOR
    var q = key === 'pos' || key === 'vel' ? 2 : 1, s = 0, c, i, r, p = new Float64Array(nt), t = new Float64Array(nt);
    for (c = 0; c < q; c++) {
      for (i = 0; i < nt; i++) { var m = 0; for (r = 0; r < KNN; r++) m += mo.T.tr[key][idx[i * KNN + r] * q + c] / KNN; p[i] = m; t[i] = mo.T.te[key][i * q + c]; }
      s += r2c(p, t, nt) / q;
    }
    out[key] = s;
  });
  return out;
};
/* what a code can rebuild: the best linear picture from the code numbers (standardised, plus an intercept), ridge-fitted on the training pictures */
function decoder(mo, Ztr, k) {
  var n = mo.n, mu = new Float64Array(k), sd = new Float64Array(k), A = new Float64Array(n * (k + 1)), Y = new Float64Array(n * D), i, a;
  for (a = 0; a < k; a++) {
    for (i = 0; i < n; i++) mu[a] += Ztr[i * k + a] / n;
    for (i = 0; i < n; i++) sd[a] += Math.pow(Ztr[i * k + a] - mu[a], 2) / n;
    sd[a] = Math.sqrt(sd[a]) + 1e-12;
  }
  for (i = 0; i < n; i++) {
    for (a = 0; a < k; a++) A[i * (k + 1) + a] = (Ztr[i * k + a] - mu[a]) / sd[a];
    A[i * (k + 1) + k] = 1; Y.set(mo.tr.F.subarray((i * 3 + 1) * D, (i * 3 + 2) * D), i * D);
  }
  return { W: CY.la.ridge(A, n, k + 1, Y, D, 1e-3), mu: mu, sd: sd, k: k };
}
L3.rebuild = function (dc, z) {
  var out = new Float64Array(D), k = dc.k, a, j;
  for (j = 0; j < D; j++) { var s = dc.W[k * D + j]; for (a = 0; a < k; a++) s += dc.W[a * D + j] * (z[a] - dc.mu[a]) / dc.sd[a]; out[j] = s; }
  return out;
};
function rebuilt(mo, dc, Zte, k) {                                      // share of the held-out pixel variance that the rebuilt pictures explain
  var nt = mo.te.n, mean = new Float64Array(D), sse = 0, sst = 0, i, j;
  for (i = 0; i < nt; i++) for (j = 0; j < D; j++) mean[j] += mo.te.F[(i * 3 + 1) * D + j] / nt;
  for (i = 0; i < nt; i++) {
    var x = L3.rebuild(dc, Zte.subarray(i * k, (i + 1) * k));
    for (j = 0; j < D; j++) { var y = mo.te.F[(i * 3 + 1) * D + j]; sse += (x[j] - y) * (x[j] - y); sst += (y - mean[j]) * (y - mean[j]); }
  }
  return 1 - sse / sst;
}
function pack(mo, Ztr, Zte, k, extra) {                                  // the probe scores at once; spread, rank, rebuild and decoder are computed when first asked for
  var o = { Ztr: Ztr, Zte: Zte, r2: L3.read(mo, Ztr, Zte, k) }, st = null, dc = null, rc = null, q;
  var stats = function () { return st || (st = codeStats(Ztr, mo.n, k)); }, dec = function () { return dc || (dc = decoder(mo, Ztr, k)); };
  Object.defineProperties(o, {
    std: { get: function () { return stats().std; }, enumerable: true }, rank: { get: function () { return stats().rank; }, enumerable: true },
    dec: { get: dec, enumerable: true }, rec: { get: function () { return rc === null ? (rc = rebuilt(mo, dec(), Zte, k)) : rc; }, enumerable: true }
  });
  for (q in extra) o[q] = extra[q];
  return o;
}
/* reconstruction (PCA) and the closed-form predictive code: both come from one decomposition, for every k */
L3.cheap = function (mo, k) {
  if (mo.k0[k]) return mo.k0[k];
  var cf = new Float64Array(k * M), a, b;
  for (a = 0; a < k; a++) for (b = 0; b < M; b++) cf[a * M + b] = mo.cf.vec[a][b];
  mo.k0[k] = { pca: pack(mo, cols(mo.Ytr[1], mo.n, k), cols(mo.Yte[1], mo.te.n, k), k, {}), cf: pack(mo, apply(cf, k, mo.Wtr[1], mo.n), apply(cf, k, mo.Wte[1], mo.te.n), k, { E: cf }) };
  return mo.k0[k];
};
/* ... and the same loss by gradient: which = 'gu' (no guard) or 'gg' (variance + covariance guard); cached per model and k */
L3.grad = function (mo, k, which) {
  var key = which + k;
  if (mo.gc[key]) return mo.gc[key];
  var r = L3.gd(mo, k, which === 'gg' ? { v: 1, c: 1 } : null, L3.C.STEPS, L3.C.SEED);
  mo.gc[key] = pack(mo, apply(r.E, k, mo.Wtr[1], mo.n), apply(r.E, k, mo.Wte[1], mo.te.n), k, { E: r.E, trace: r.trace });
  return mo.gc[key];
};
/* the reward-predictive code: a tanh bottleneck of k units followed by a head, trained on the 600 labelled pictures of the training clips */
L3.reward = function (mo, k) {
  if (mo.rw[k]) return mo.rw[k];
  var n = mo.n, X = [], Y = [], t, i, g = L3.C.GOAL, rs = 0, rm = 0, net = new CY.MLP([M, k, 16, 1], 7);
  function rew(sm, ti, ii) { var o = (ii * 3 + ti) * 4; return -Math.hypot(sm.S[o] - g[0], sm.S[o + 1] - g[1]); }
  for (t = 0; t < 3; t++) for (i = 0; i < n; i++) rm += rew(mo.tr, t, i) / (3 * n);
  for (t = 0; t < 3; t++) for (i = 0; i < n; i++) rs += Math.pow(rew(mo.tr, t, i) - rm, 2) / (3 * n);
  rs = Math.sqrt(rs);
  for (i = 0; i < n; i++) for (t = 0; t < 3; t++) { X.push(Array.from(mo.Wtr[t].subarray(i * M, (i + 1) * M))); Y.push([(rew(mo.tr, t, i) - rm) / rs]); }
  net.fit(X, Y, { epochs: 150, batch: 50, lr: 0.01, seed: 3 });
  function z(Wm, nn) { var Z = new Float64Array(nn * k), q, c, h; for (q = 0; q < nn; q++) { h = net.forward(Array.from(Wm.subarray(q * M, (q + 1) * M)))[1]; for (c = 0; c < k; c++) Z[q * k + c] = h[c]; } return Z; }
  var Ztr = z(mo.Wtr[1], n), Zte = z(mo.Wte[1], mo.te.n), sse = 0, sst = 0, mt = 0, o;
  for (i = 0; i < mo.te.n; i++) mt += mo.T.te.rew[i] / mo.te.n;
  for (i = 0; i < mo.te.n; i++) { o = net.predict(Array.from(mo.Wte[1].subarray(i * M, (i + 1) * M)))[0] * rs + rm; sse += Math.pow(o - mo.T.te.rew[i], 2); sst += Math.pow(mo.T.te.rew[i] - mt, 2); }
  mo.rw[k] = pack(mo, Ztr, Zte, k, { head: 1 - sse / sst });
  return mo.rw[k];
};
/* smallest k in the grid whose position score reaches 0.9, or 0 when none does (reconstruction and the closed form only) */
L3.kStar = function (mo, which) {
  var ks = L3.C.KS, i;
  for (i = 0; i < ks.length; i++) if (L3.cheap(mo, ks[i])[which].r2.pos >= 0.9) return ks[i];
  return 0;
};


/* ───────── the painter: the five panels of the lesson's widget (pure drawing; every number it shows is computed above) ───────── */
var CLIP = 5, clean = null;
L3.layout = function (w) {
  var g = 10, inner = w - 16;
  if (w < 600) return { h: 1116, P1: [8, 8, inner, 282], P2: [8, 300, inner, 196], P3: [8, 506, inner, 196], P4: [8, 712, inner, 196], P5: [8, 918, inner, 190] };
  var w1 = Math.round((inner - 2 * g) * 0.4), w2 = Math.round((inner - 2 * g) * 0.27), wh = Math.round((inner - g) / 2);
  return { h: 600, P1: [8, 8, w1, 296], P2: [8 + w1 + g, 8, w2, 296], P3: [8 + w1 + w2 + 2 * g, 8, inner - 2 * g - w1 - w2, 296], P4: [8, 314, wh, 278], P5: [8 + wh + g, 314, inner - wh - g, 278] };
};
function sci(v) { return v < 0.01 ? v.toExponential(1) : v.toFixed(3); }
L3.sci = sci;
/* s = {nu, k, kind, code, mo}; res = the selected code's result or null (a trained code not yet trained); cv = the canvas */
L3.paint = function (cv, s, res) {
  var D = CY.draw, C = CY.C, KS = L3.C.KS;
  if (!clean) clean = L3.stream(CLIP + 1, 2, 0, 'flicker');           // the first test clips with no nuisance: the ball alone
  function panel(ctx, b, title) {                                // frame + title, cut with an ellipsis at the panel's own edge
    D.frame(ctx, b[0], b[1], b[2], b[3], C.white);
    var t = String(title), n = t.length, m, w;
    if (ctx.measureText) {
      ctx.font = '9px "SF Mono", Menlo, Consolas, monospace';
      for (; n > 4; n--) { m = ctx.measureText(n < t.length ? t.slice(0, n) + '\u2026' : t); w = m && m.width; if (!(w > b[2] - 14)) break; }
    }
    D.mono(ctx, n < t.length ? t.slice(0, n) + '\u2026' : t, b[0] + 8, b[1] + 12, C.mute, 9);
  }
  function pic(ctx, a, x, y, w, ball, tick) {                          // a 24 x 15 picture; the true ball is ringed, the band's centre ticked on the top edge
    var h = w * 15 / 24;
    D.image(ctx, a, 24, 15, x, y, w, h, { vmin: 0, vmax: 1.3 });
    if (ball) D.dot(ctx, x + ball[0] / 8 * w, y + (1 - ball[1] / 5) * h, 5, 'rgba(0,0,0,0)', C.cyan);
    if (tick !== null) D.line(ctx, x + tick / 8 * w, y, x + tick / 8 * w, y + 6, C.amber, 3);
  }
  function axes(ctx, x, y, w, h, ymax) {                               // an empty plot area with y ticks at 0, 0.5, 1
    D.line(ctx, x, y + h, x + w, y + h, C.dim, 1); D.line(ctx, x, y, x, y + h, C.dim, 1);
    [0, 0.5, 1].forEach(function (v) { D.mono(ctx, v.toFixed(1), x - 6, y + h - v / ymax * h, C.mute, 9, 'right'); });
  }
  cv.style.height = L3.layout(cv.clientWidth).h + 'px';
  var S = D.setup(cv), ctx = S.ctx, L = L3.layout(S.w), te = s.mo.te, k = s.k, i, t, qi = KS.indexOf(k);
  /* A: three consecutive pictures; what the code rebuilds of the middle one, what it leaves out; the ball alone; the code itself */
  var b = L.P1, gap = 6, iw = (b[2] - 16 - 2 * gap) / 3, ih = iw * 15 / 24, x0 = b[0] + 8, y1 = b[1] + 22, y2 = y1 + ih + 24, y3 = y2 + ih + 24, o;
  panel(ctx, b, 'pictures · rebuilt · left out · the code');
  for (t = 0; t < 3; t++) {
    o = (CLIP * 3 + t) * 4;
    pic(ctx, te.F.subarray((CLIP * 3 + t) * 360, (CLIP * 3 + t + 1) * 360), x0 + t * (iw + gap), y1, iw, [te.S[o], te.S[o + 1]], s.nu > 0 ? te.B[CLIP * 3 + t] : null);
    D.mono(ctx, 'picture t' + ['−1', '', '+1'][t], x0 + t * (iw + gap), y1 + ih + 11, C.mute, 9);
  }
  var mid = te.F.subarray((CLIP * 3 + 1) * 360, (CLIP * 3 + 2) * 360), o1 = (CLIP * 3 + 1) * 4;
  pic(ctx, clean.F.subarray((CLIP * 3 + 1) * 360, (CLIP * 3 + 2) * 360), x0 + 2 * (iw + gap), y2, iw, [te.S[o1], te.S[o1 + 1]], null);
  D.mono(ctx, 'ball alone', x0 + 2 * (iw + gap), y2 + ih + 11, C.mute, 9);
  if (res) {
    var z = res.Zte.subarray(CLIP * k, (CLIP + 1) * k), rb = L3.rebuild(res.dec, z), left = new Float64Array(360), bw = b[2] - 16, bar = bw / k, base = y3 + 26;
    for (i = 0; i < 360; i++) left[i] = 0.5 + (mid[i] - rb[i]) / 2;
    pic(ctx, rb, x0, y2, iw, null, null);
    D.image(ctx, left, 24, 15, x0 + iw + gap, y2, iw, ih, { vmin: 0, vmax: 1, map: 'diverge' });
    D.mono(ctx, 'rebuilt', x0, y2 + ih + 11, C.mute, 9); D.mono(ctx, 'left out', x0 + iw + gap, y2 + ih + 11, C.mute, 9);
    D.line(ctx, x0, base, x0 + bw, base, C.dim, 1);
    for (i = 0; i < k; i++) { var hh = Math.max(-26, Math.min(26, z[i] * 9)); ctx.fillStyle = C.purple; ctx.fillRect(x0 + i * bar + 1, hh > 0 ? base - hh : base, Math.max(1, bar - 2), Math.abs(hh)); }
    D.mono(ctx, 'the code of picture t: ' + k + ' numbers, full height = ±3', x0, y3 + 58, C.mute, 9);
  } else D.mono(ctx, 'press Train to compute this code', x0, y2 + 20, C.red, 10);

  /* B: variance of each principal component, coloured by how well one picture predicts the next */
  b = L.P2; panel(ctx, b, 'variance of each principal component');
  var sx = b[0] + 10, sw = b[2] - 20, sy = b[1] + 62, sh = b[3] - 96, top = s.mo.pca.vals[0];
  for (i = 0; i < 24; i++) { var r = s.mo.rho[i], bh = s.mo.pca.vals[i] / top * sh; ctx.fillStyle = r >= 0.7 ? C.green : (r >= 0.3 ? C.dim : C.amber); ctx.fillRect(sx + i * sw / 24 + 1, sy + sh - bh, Math.max(1, sw / 24 - 2), bh); }
  D.line(ctx, sx, sy + sh, sx + sw, sy + sh, C.dim, 1);
  [1, 8, 16, 24].forEach(function (q) { D.mono(ctx, String(q), sx + (q - 0.5) * sw / 24, sy + sh + 11, C.mute, 9, 'center'); });
  D.mono(ctx, 'component; first = ' + top.toFixed(2), sx, sy + sh + 25, C.mute, 9);
  D.mono(ctx, 'amber: next picture misses it', sx, b[1] + 26, C.amber, 9); D.mono(ctx, 'green: persists (corr ≥ 0.7)', sx, b[1] + 38, C.green, 9);
  if (s.code === 'pca') { D.line(ctx, sx, sy - 4, sx + Math.min(k, 24) * sw / 24, sy - 4, C.ink, 2); D.mono(ctx, 'kept', sx + 2, sy - 11, C.ink, 9); }

  /* C: what a probe reads out of the code */
  b = L.P3; panel(ctx, b, 'r² of what the probe reads from the code');
  var rows = [['ball position', res && res.r2.pos, C.cyan], ['ball velocity', res && res.r2.vel, C.cyan], ['band position', res && s.nu > 0 ? res.r2.band : null, C.amber],
              ['reward, goal A (6.6, 2.5)', res && res.r2.rew, C.purple], ['reward, goal B (4.5, 4.2)', res && res.r2.rew2, C.purple], ['pixel variance rebuilt (%)', res && res.rec, C.dim]];
  var rx = b[0] + 10, rw = b[2] - 64, rh = (b[3] - 30) / 6;
  rows.forEach(function (rr, j) {
    var yy = b[1] + 24 + j * rh, v = rr[1], bt = Math.min(14, rh - 19);
    D.mono(ctx, rr[0], rx, yy + 7, C.mute, 9); ctx.fillStyle = C.grid; ctx.fillRect(rx, yy + 14, rw, bt);
    if (typeof v === 'number') { ctx.fillStyle = rr[2]; ctx.fillRect(rx, yy + 14, Math.max(0, Math.min(1, v)) * rw, bt); D.mono(ctx, j === 5 ? (100 * v).toFixed(0) : v.toFixed(2), rx + rw + 6, yy + 14 + bt / 2, C.ink, 10); }
    else D.mono(ctx, '—', rx + rw + 6, yy + 14 + bt / 2, C.mute, 10);
  });
  D.line(ctx, rx + 0.9 * rw, b[1] + 32, rx + 0.9 * rw, b[1] + b[3] - 6, C.dim, 1, [3, 3]);

  /* D: ball position r² against code size, for the two closed-form codes */
  b = L.P4; panel(ctx, b, 'ball position r² against code size k (η = ' + s.nu + ', band ' + (s.kind === 'drift' ? 'drifts' : 'hops') + ')');
  var px = b[0] + 36, py = b[1] + 26, pw = b[2] - 50, ph = b[3] - 62, X = function (q) { return px + q / 6 * pw; }, Y = function (v) { return py + ph - Math.max(0, Math.min(1, v)) * ph; }, pa = [], pf = [];
  axes(ctx, px, py, pw, ph, 1); D.line(ctx, px, Y(0.9), px + pw, Y(0.9), C.dim, 1, [4, 3]);
  KS.forEach(function (kk, q) { var cc = L3.cheap(s.mo, kk); pa.push([X(q), Y(cc.pca.r2.pos)]); pf.push([X(q), Y(cc.cf.r2.pos)]); D.mono(ctx, String(kk), X(q), py + ph + 11, C.mute, 9, 'center'); });
  D.path(ctx, pa, C.amber, 2.4); D.path(ctx, pf, C.green, 2.4);
  pa.forEach(function (p) { D.dot(ctx, p[0], p[1], 3, C.amber, C.white); }); pf.forEach(function (p) { D.dot(ctx, p[0], p[1], 3, C.green, C.white); });
  D.line(ctx, X(qi), py, X(qi), py + ph, C.purple, 1, [2, 3]);
  if (res && s.code !== 'pca' && s.code !== 'cf') D.dot(ctx, X(qi), Y(res.r2.pos), 5, s.code === 'gu' ? C.red : C.purple, C.white);
  D.mono(ctx, 'k;  amber: reconstruction  green: predictive  dashed: 0.9', px, b[1] + b[3] - 8, C.mute, 9);

  /* E: the same loss by gradient: the spread of the code over 200 steps */
  b = L.P5; panel(ctx, b, 'next-code loss by gradient: spread of the code');
  var qx = b[0] + 36, qy = b[1] + 26, qw = b[2] - 50, qh = b[3] - 76;
  axes(ctx, qx, qy, qw, qh, 1.1);
  D.mono(ctx, '0', qx, qy + qh + 11, C.mute, 9, 'center'); D.mono(ctx, '200', qx + qw, qy + qh + 11, C.mute, 9, 'right');
  [['gu', C.red, 'no guard'], ['gg', C.green, 'with guard']].forEach(function (g, j) {
    var q = s.mo.gc[g[0] + k]; if (!q) return;
    D.path(ctx, q.trace.t.map(function (tt, n) { return [qx + tt / 200 * qw, qy + qh - Math.min(1.1, q.trace.std[n]) / 1.1 * qh]; }), g[1], 2.4);
    D.mono(ctx, g[2] + ': loss ' + sci(q.trace.pred[q.trace.pred.length - 1]) + ', spread ' + q.std.toFixed(3) + ', rank ' + q.rank.toFixed(1), qx, b[1] + b[3] - 18 + j * 11, g[1], 9);
  });
  if (!s.mo.gc['gu' + k] && !s.mo.gc['gg' + k]) { D.mono(ctx, 'select a gradient code', qx + qw / 2, qy + qh / 2 - 7, C.mute, 10, 'center'); D.mono(ctx, 'and press Train', qx + qw / 2, qy + qh / 2 + 7, C.mute, 10, 'center'); }
};

root.L3 = L3;
if (typeof module !== 'undefined' && module.exports) module.exports = L3;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
