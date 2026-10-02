/* l13_things.js — private engine of World Models lesson 13, "Things: a world made of objects".  Global L13; needs courtyard.js (CY) loaded first.
 *
 * What it holds (everything the lesson's widget computes, so that the page script only draws and wires controls):
 *   the world   the Soft Courtyard: N identical unit-mass balls in the 8 x 5 m court.  Friction as in the Courtyard (0.35 per second).  Contact is smooth and
 *               conservative: every ball carries a soft shell of radius RHO = 0.25 m; two overlapping shells, or a shell overlapping a wall, push apart along the line of
 *               centres with force k * overlap^2 (so a collision takes about two steps and nothing is lost in it).  The effects of different neighbours ADD.
 *   models      both learn the RESIDUAL: what happens to a ball beyond what the exact one-ball model (stepAlone, the model of lessons 1-6 per ball) says.
 *                 Flat   one network reads the other balls of a receiver side by side, in index order (4(N-1) numbers), and writes the receiver's residual;
 *                 Pair   one small network phi reads ONE sender at a time, seen from the receiver, and the answers are SUMMED over the senders.
 *               Both read the same array (pairRows): rows of 4(N-1) for Flat, rows of 4 for Pair.  Adam, tanh, hidden width 16, seeds fixed.
 *   the exam    scenes of N balls dropped into the 2.4 x 1.6 m training room (nested: scene q of N+1 balls is scene q of N balls plus one ball), followed for 10 steps;
 *               one-step and ten-step mean position error in cm; permutation sensitivity.
 *   binding     two (or more) balls enter the curtain strip from opposite sides, interact out of sight and come out; a bag of noisy detections; slots with a belief from the
 *               visible past; three priors (map, free flight, interaction-aware) and three assignment rules (nearest, competition, optimal).
 *   the exit    video of nudged balls with and without the nudge labels.
 *   lab         the widget's state: data, the two models, training clicks, cached exams.
 * Conventions: state s = [x, y, vx, vy] (m, m/s), a scene is the flat array of its N states; one step = 0.1 s; everything is deterministic (CY.rng).
 */
(function (root) {
'use strict';
var CY = root.CY || (typeof require !== 'undefined' ? require('./courtyard.js') : null);
var L13 = {};

/* ───────── the Soft Courtyard ───────── */
L13.W = 8; L13.H = 5; L13.DT = 0.1; L13.SUB = 20; L13.GAMMA = 0.35;
L13.RHO = 0.25;                         // shell radius: balls touch when their centres are closer than 2 RHO, a ball touches a wall when it is closer than RHO
L13.KB = 300; L13.KW = 600;             // contact stiffness (ball-ball, ball-wall): force k * overlap^2
var W = L13.W, H = L13.H;

function accel(S, N, ax, ay, alone) {
  var RHO = L13.RHO, KB = L13.KB, KW = L13.KW, i, j, d;
  for (i = 0; i < N; i++) {
    var x = S[4 * i], y = S[4 * i + 1];
    ax[i] = 0; ay[i] = 0;
    d = RHO - x; if (d > 0) ax[i] += KW * d * d;
    d = RHO - (W - x); if (d > 0) ax[i] -= KW * d * d;
    d = RHO - y; if (d > 0) ay[i] += KW * d * d;
    d = RHO - (H - y); if (d > 0) ay[i] -= KW * d * d;
  }
  if (alone) return;
  var R2 = 4 * RHO * RHO;
  for (i = 0; i < N; i++) for (j = i + 1; j < N; j++) {
    var dx = S[4 * i] - S[4 * j], dy = S[4 * i + 1] - S[4 * j + 1], d2 = dx * dx + dy * dy;
    if (d2 < R2 && d2 > 1e-18) { var dd = Math.sqrt(d2), ov = 2 * RHO - dd, f = KB * ov * ov / dd; ax[i] += f * dx; ay[i] += f * dy; ax[j] -= f * dx; ay[j] -= f * dy; }
  }
}
/* one control step (0.1 s) of the true world.  S: flat [x,y,vx,vy] x N; returns a NEW flat array.  o.alone: switch the ball-ball contact off; o.gamma: friction */
L13.step = function (S, N, o) {
  var gm = o && o.gamma !== undefined ? o.gamma : L13.GAMMA, h = L13.DT / L13.SUB, damp = Math.exp(-gm * h), glide = gm > 1e-12 ? (1 - damp) / gm : h;
  var T = Float64Array.from(S), ax = new Float64Array(N), ay = new Float64Array(N), s, i;
  for (s = 0; s < L13.SUB; s++) {
    accel(T, N, ax, ay, o && o.alone);
    for (i = 0; i < N; i++) { T[4 * i + 2] += ax[i] * h; T[4 * i + 3] += ay[i] * h; T[4 * i] += T[4 * i + 2] * glide; T[4 * i + 1] += T[4 * i + 3] * glide; T[4 * i + 2] *= damp; T[4 * i + 3] *= damp; }
  }
  return T;
};
/* the same world with every ball alone: the best that a model of ONE ball can say (the one-ball model of lessons 1-6, applied to each ball) */
var ALONE = { alone: true };
L13.stepAlone = function (S, N) { return L13.step(S, N, ALONE); };
L13.stepAloneB = function (SB, B, N) {                 // B scenes at once
  var out = new Float64Array(SB.length), b, q;
  for (b = 0; b < B; b++) { q = L13.step(SB.subarray(4 * N * b, 4 * N * (b + 1)), N, ALONE); out.set(q, 4 * N * b); }
  return out;
};
L13.rollout = function (S0, N, T, stepFn) {
  var tr = [Float64Array.from(S0)], s = tr[0], f = stepFn || L13.step, t;
  for (t = 0; t < T; t++) { s = f(s, N); tr.push(s); }
  return tr;
};
/* kinetic + contact energy (the conserved quantity when friction is off) */
L13.energy = function (S, N) {
  var E = 0, i, j, d, dl;
  for (i = 0; i < N; i++) E += 0.5 * (S[4 * i + 2] * S[4 * i + 2] + S[4 * i + 3] * S[4 * i + 3]);
  for (i = 0; i < N; i++) for (j = i + 1; j < N; j++) { d = Math.hypot(S[4 * i] - S[4 * j], S[4 * i + 1] - S[4 * j + 1]); dl = 2 * L13.RHO - d; if (dl > 0) E += L13.KB * dl * dl * dl / 3; }
  for (i = 0; i < N; i++) [S[4 * i], W - S[4 * i], S[4 * i + 1], H - S[4 * i + 1]].forEach(function (dw) { var o = L13.RHO - dw; if (o > 0) E += L13.KW * o * o * o / 3; });
  return E;
};
/* N balls dropped uniformly into a room (ww x wh), speed uniform in [v0, v1], random direction, no two closer than dmin.  The draws are made ball after ball,
 * so the first N balls of a scene of N + 1 are the scene of N. */
L13.WIN = { ww: 2.4, wh: 1.6, fixed: true };           // the training room, centred in the court
L13.scene = function (N, rng, o) {
  o = o || L13.WIN;
  var ww = o.ww || 2.4, wh = o.wh || 1.6, v0 = o.v0 === undefined ? 0.3 : o.v0, v1 = o.v1 === undefined ? 1.8 : o.v1, dmin = o.dmin || 0.3;
  var x0 = o.fixed ? (W - ww) / 2 : 0.3 + (W - ww - 0.6) * rng(), y0 = o.fixed ? (H - wh) / 2 : 0.3 + (H - wh - 0.6) * rng(), S = new Float64Array(4 * N), i, k, tries;
  for (i = 0; i < N; i++) {
    for (tries = 0; tries < 200; tries++) {
      var x = x0 + ww * rng(), y = y0 + wh * rng(), ok = true;
      for (k = 0; k < i; k++) if (Math.hypot(x - S[4 * k], y - S[4 * k + 1]) < dmin) { ok = false; break; }
      if (ok) { S[4 * i] = x; S[4 * i + 1] = y; break; }
    }
    var a = 2 * Math.PI * rng(), sp = v0 + (v1 - v0) * rng();
    S[4 * i + 2] = sp * Math.cos(a); S[4 * i + 3] = sp * Math.sin(a);
  }
  return S;
};

/* ───────── a small batched network (CY.MLP works one sample at a time and has no input gradient) ───────── */
function Net(sizes, seed) {
  var rng = CY.rng(seed || 1), L = sizes.length - 1, l, i;
  this.sizes = sizes; this.L = L; this.W = []; this.b = []; this.gW = []; this.gb = []; this.mW = []; this.vW = []; this.mb = []; this.vb = []; this.t = 0;
  for (l = 0; l < L; l++) {
    var fi = sizes[l], fo = sizes[l + 1], sc = Math.sqrt(2 / (fi + fo)), w = new Float64Array(fi * fo);
    for (i = 0; i < w.length; i++) w[i] = sc * CY.randn(rng);
    this.W.push(w); this.b.push(new Float64Array(fo));
    this.gW.push(new Float64Array(fi * fo)); this.gb.push(new Float64Array(fo));
    this.mW.push(new Float64Array(fi * fo)); this.vW.push(new Float64Array(fi * fo)); this.mb.push(new Float64Array(fo)); this.vb.push(new Float64Array(fo));
  }
}
Net.prototype.nParams = function () { var n = 0, l; for (l = 0; l < this.L; l++) n += this.W[l].length + this.b[l].length; return n; };
/* X: n x in (row-major); keeps the activations for backward(); returns n x out */
Net.prototype.forward = function (X, n) {
  var A = [X], l, r, i, j;
  for (l = 0; l < this.L; l++) {
    var fi = this.sizes[l], fo = this.sizes[l + 1], a = A[l], w = this.W[l], b = this.b[l], y = new Float64Array(n * fo), last = l === this.L - 1;
    for (r = 0; r < n; r++) {
      var ro = r * fo, ri = r * fi;
      for (j = 0; j < fo; j++) y[ro + j] = b[j];
      for (i = 0; i < fi; i++) { var ai = a[ri + i]; if (ai !== 0) { var wo = i * fo; for (j = 0; j < fo; j++) y[ro + j] += ai * w[wo + j]; } }
      if (!last) for (j = 0; j < fo; j++) y[ro + j] = Math.tanh(y[ro + j]);
    }
    A.push(y);
  }
  this.A = A; this.n = n;
  return A[this.L];
};
/* dY: n x out.  Accumulates the parameter gradients; returns dX (n x in) */
Net.prototype.backward = function (dY) {
  var n = this.n, d = dY, l, r, i, j;
  for (l = this.L - 1; l >= 0; l--) {
    var fi = this.sizes[l], fo = this.sizes[l + 1], a = this.A[l], w = this.W[l], gw = this.gW[l], gb = this.gb[l], dx = new Float64Array(n * fi);
    for (r = 0; r < n; r++) {
      var ro = r * fo, ri = r * fi;
      for (j = 0; j < fo; j++) gb[j] += d[ro + j];
      for (i = 0; i < fi; i++) {
        var ai = a[ri + i], wo = i * fo, s = 0;
        for (j = 0; j < fo; j++) { var dj = d[ro + j]; gw[wo + j] += ai * dj; s += w[wo + j] * dj; }
        dx[ri + i] = l > 0 ? s * (1 - ai * ai) : s;
      }
    }
    d = dx;
  }
  return d;
};
Net.prototype.zero = function () { var l; for (l = 0; l < this.L; l++) { this.gW[l].fill(0); this.gb[l].fill(0); } };
Net.prototype.adam = function (lr) {
  var b1 = 0.9, b2 = 0.999, l, i; this.t++;
  var c1 = 1 - Math.pow(b1, this.t), c2 = 1 - Math.pow(b2, this.t);
  for (l = 0; l < this.L; l++) {
    var W_ = this.W[l], g = this.gW[l], m = this.mW[l], v = this.vW[l], bb = this.b[l], gb = this.gb[l], mb = this.mb[l], vb = this.vb[l];
    for (i = 0; i < W_.length; i++) { m[i] = b1 * m[i] + (1 - b1) * g[i]; v[i] = b2 * v[i] + (1 - b2) * g[i] * g[i]; W_[i] -= lr * (m[i] / c1) / (Math.sqrt(v[i] / c2) + 1e-8); }
    for (i = 0; i < bb.length; i++) { mb[i] = b1 * mb[i] + (1 - b1) * gb[i]; vb[i] = b2 * vb[i] + (1 - b2) * gb[i] * gb[i]; bb[i] -= lr * (mb[i] / c1) / (Math.sqrt(vb[i] / c2) + 1e-8); }
  }
  this.zero();
};

/* ───────── the pair rows: what a receiver sees of each sender ───────── */
/* sender j seen from receiver i: (position difference) / 0.5 m, (velocity difference) / 1.5 m/s.  Contact depends on nothing else. */
function pairFeat(S, i, j, out, o) {
  out[o] = (S[4 * j] - S[4 * i]) / 0.5; out[o + 1] = (S[4 * j + 1] - S[4 * i + 1]) / 0.5; out[o + 2] = (S[4 * j + 2] - S[4 * i + 2]) / 1.5; out[o + 3] = (S[4 * j + 3] - S[4 * i + 3]) / 1.5;
}
/* One row per (scene b, receiver i, sender j != i), in that order.  The SAME array is read two ways:
 *   flat    a receiver's N-1 senders side by side, in index order: B*N rows of 4(N-1) numbers, one network;
 *   pair    each sender alone: B*N*(N-1) rows of 4 numbers, one shared network phi, then summed over the senders. */
L13.pairRows = function (SB, B, N) {
  var X = new Float64Array(B * N * (N - 1) * 4), r = 0, b, i, j;
  for (b = 0; b < B; b++) for (i = 0; i < N; i++) for (j = 0; j < N; j++) if (j !== i) { pairFeat(SB.subarray(4 * N * b, 4 * N * (b + 1)), i, j, X, 4 * r); r++; }
  return X;
};
/* targets: what happened to every ball beyond the one-ball model, in units of [0.02 m, 0.02 m, 0.3 m/s, 0.3 m/s] */
var RX = 0.02, RV = 0.3;
L13.residRows = function (SB, S1B, AB) {
  var n = SB.length / 4, Y = new Float64Array(SB.length), k;
  for (k = 0; k < n; k++) { Y[4 * k] = (S1B[4 * k] - AB[4 * k]) / RX; Y[4 * k + 1] = (S1B[4 * k + 1] - AB[4 * k + 1]) / RX; Y[4 * k + 2] = (S1B[4 * k + 2] - AB[4 * k + 2]) / RV; Y[4 * k + 3] = (S1B[4 * k + 3] - AB[4 * k + 3]) / RV; }
  return Y;
};
function addResid(A, Y, T) {                           // T = A + residual (un-normalised)
  var n = A.length / 4, k;
  for (k = 0; k < n; k++) { T[4 * k] = A[4 * k] + RX * Y[4 * k]; T[4 * k + 1] = A[4 * k + 1] + RX * Y[4 * k + 1]; T[4 * k + 2] = A[4 * k + 2] + RV * Y[4 * k + 2]; T[4 * k + 3] = A[4 * k + 3] + RV * Y[4 * k + 3]; }
  return T;
}

/* ───────── model 1: the flat state ───────── */
function Flat(N, hid, seed) { this.N = N; this.net = new Net([4 * (N - 1), hid, hid, 4], seed); }
Flat.prototype.nParams = function () { return this.net.nParams(); };
Flat.prototype.fit = function (X, Y, B, lr) {            // X: pairRows of B scenes of this.N balls, read as B*N rows of 4(N-1)
  var out = this.net.forward(X, B * this.N), d = new Float64Array(Y.length), k, loss = 0;
  for (k = 0; k < Y.length; k++) { var e = out[k] - Y[k]; d[k] = 2 * e / Y.length; loss += e * e / Y.length; }
  this.net.backward(d); this.net.adam(lr);
  return loss;
};
/* B scenes of N balls -> next states.  For N other than the model's own N each receiver keeps its first N0-1 senders (crop) or is given far-away senders (pad). */
Flat.prototype.predictB = function (SB, B, N) {
  var K = this.N - 1, X = new Float64Array(B * N * K * 4), b, i, j, k, o, S;
  for (b = 0; b < B; b++) {
    S = SB.subarray(4 * N * b, 4 * N * (b + 1));
    for (i = 0; i < N; i++) {
      o = (b * N + i) * K * 4; k = 0;
      for (j = 0; j < N && k < K; j++) if (j !== i) { pairFeat(S, i, j, X, o + 4 * k); k++; }
      for (; k < K; k++) { X[o + 4 * k] = 3.2; X[o + 4 * k + 1] = 2; }
    }
  }
  return addResid(L13.stepAloneB(SB, B, N), this.net.forward(X, B * N), new Float64Array(SB.length));
};
Flat.prototype.predict = function (S, N) { return this.predictB(S, 1, N || this.N); };

/* ───────── model 2: the pairwise interaction network ───────── */
function Pair(hid, seed, agg) { this.hid = hid; this.agg = agg || 'sum'; this.phi = new Net([4, hid, hid, 4], seed * 5 + 1); }
Pair.prototype.nParams = function () { return this.phi.nParams(); };
Pair.prototype.messages = function (X, B, N) {           // phi on every sender alone, then the sum over each receiver's N-1 senders: B*N x 4
  var M = this.phi.forward(X, B * N * (N - 1)), E = new Float64Array(B * N * 4), k, r, c, w = this.agg === 'mean' ? 1 / (N - 1) : 1;
  for (k = 0; k < B * N; k++) for (r = 0; r < N - 1; r++) for (c = 0; c < 4; c++) E[4 * k + c] += w * M[4 * (k * (N - 1) + r) + c];
  return E;
};
Pair.prototype.fit = function (X, Y, B, N, lr) {
  var E = this.messages(X, B, N), d = new Float64Array(Y.length), dM = new Float64Array(B * N * (N - 1) * 4), k, r, c, loss = 0;
  for (k = 0; k < Y.length; k++) { var e = E[k] - Y[k]; d[k] = 2 * e / Y.length; loss += e * e / Y.length; }
  var w = this.agg === 'mean' ? 1 / (N - 1) : 1;
  for (k = 0; k < B * N; k++) for (r = 0; r < N - 1; r++) for (c = 0; c < 4; c++) dM[4 * (k * (N - 1) + r) + c] = w * d[4 * k + c];
  this.phi.backward(dM); this.phi.adam(lr);
  return loss;
};
Pair.prototype.predictB = function (SB, B, N) { return addResid(L13.stepAloneB(SB, B, N), this.messages(L13.pairRows(SB, B, N), B, N), new Float64Array(SB.length)); };
Pair.prototype.predict = function (S, N) { return this.predictB(S, 1, N); };

/* multiply-adds in the weight matrices for one step of N balls */
Flat.prototype.macs = function (N) { var h = this.net.sizes[1]; return N * (4 * (N - 1) * h + h * h + h * 4); };
Pair.prototype.macs = function (N) { var h = this.hid; return N * (N - 1) * (4 * h + h * h + h * 4); };
L13.Net = Net; L13.Flat = Flat; L13.Pair = Pair;

/* ───────── data and training ───────── */
/* nScenes scenes of N balls, each followed for `len` steps: n = nScenes*len transitions, with the pair rows and the residual targets precomputed */
L13.makeData = function (N, nScenes, len, seed, o) {
  var rng = CY.rng(seed), S = [], S1 = [], q, t, s, ns;
  for (q = 0; q < nScenes; q++) {
    s = L13.scene(N, rng, o);
    for (t = 0; t < len; t++) { ns = L13.step(s, N); S.push(s); S1.push(ns); s = ns; }
  }
  var n = S.length, A = new Float64Array(n * 4 * N), A1 = new Float64Array(n * 4 * N), q2;
  for (q2 = 0; q2 < n; q2++) { A.set(S[q2], q2 * 4 * N); A1.set(S1[q2], q2 * 4 * N); }
  return { S: A, S1: A1, X: L13.pairRows(A, n, N), Y: L13.residRows(A, A1, L13.stepAloneB(A, n, N)), n: n, N: N };
};
/* `steps` Adam steps on random minibatches of B transitions.  The learning rate starts at lr and falls by the factor `decay` over `total` steps of the model's life. */
L13.train = function (model, D, steps, o) {
  o = o || {};
  var B = o.batch || 32, N = D.N, rng = CY.rng((o.seed || 1) * 7919 + (model.t0 || 0)), loss = 0, k, t, rb = N * (N - 1) * 4, nb = N * 4, flat = model instanceof Flat;
  for (t = 0; t < steps; t++) {
    var X = new Float64Array(B * rb), Y = new Float64Array(B * nb), id;
    for (k = 0; k < B; k++) { id = Math.floor(rng() * D.n); X.set(D.X.subarray(id * rb, (id + 1) * rb), k * rb); Y.set(D.Y.subarray(id * nb, (id + 1) * nb), k * nb); }
    var lr = (o.lr || 0.02) * Math.pow(o.decay === undefined ? 0.1 : o.decay, Math.min(1, ((model.t0 || 0) + t) / (o.total || 6000)));
    loss = flat ? model.fit(X, Y, B, lr) : model.fit(X, Y, B, N, lr);
  }
  model.t0 = (model.t0 || 0) + steps;
  return loss;
};

/* ───────── the exam ───────── */
/* nSc nested scenes of N balls in the training room, followed for 10 steps (scene q is the same for every N, with ball N+1 added) */
L13.scenes = function (N, nSc, seed) {
  var out = [], q;
  for (q = 0; q < nSc; q++) out.push(L13.rollout(L13.scene(N, CY.rng(seed * 1009 + q + 1), L13.WIN), N, 10));
  return out;
};
/* mean position error (cm) of a batched one-step predictor predB(SB, B) over the scenes: one-step (teacher forced, every step) and ten-step (free running from the first state) */
L13.exam = function (predB, N, scenes) {
  var B = scenes.length, q, t, i, k, e1 = 0, e10 = 0, SB = new Float64Array(B * 10 * 4 * N), P, S0 = new Float64Array(B * 4 * N);
  for (q = 0; q < B; q++) { for (t = 0; t < 10; t++) SB.set(scenes[q][t], (q * 10 + t) * 4 * N); S0.set(scenes[q][0], q * 4 * N); }
  P = predB(SB, B * 10);
  for (q = 0; q < B; q++) for (t = 0; t < 10; t++) for (i = 0; i < N; i++) { k = (q * 10 + t) * 4 * N + 4 * i; e1 += Math.hypot(P[k] - scenes[q][t + 1][4 * i], P[k + 1] - scenes[q][t + 1][4 * i + 1]); }
  for (t = 0; t < 10; t++) S0 = predB(S0, B);
  for (q = 0; q < B; q++) for (i = 0; i < N; i++) { k = q * 4 * N + 4 * i; e10 += Math.hypot(S0[k] - scenes[q][10][4 * i], S0[k + 1] - scenes[q][10][4 * i + 1]); }
  return { one: 100 * e1 / (B * 10 * N), ten: 100 * e10 / (B * N) };
};
/* relabel the balls of S: new ball k is old ball perm[k] */
L13.relabel = function (S, perm) { var T = new Float64Array(S.length), k; for (k = 0; k < perm.length; k++) for (var c = 0; c < 4; c++) T[4 * k + c] = S[4 * perm[k] + c]; return T; };
/* permutation sensitivity: relabel the balls at random, predict, relabel the answer back, compare.  RMS velocity difference (cm/s) over the states in which two balls are within 0.6 m. */
L13.permSens = function (pred, N, scenes, seed) {
  var rng = CY.rng(seed || 3), s2 = 0, n = 0, q, t, i, j, k;
  for (q = 0; q < scenes.length; q++) for (t = 0; t < 10; t++) {
    var S = scenes[q][t], near = false;
    for (i = 0; i < N; i++) for (j = i + 1; j < N; j++) if (Math.hypot(S[4 * i] - S[4 * j], S[4 * i + 1] - S[4 * j + 1]) < 0.6) near = true;
    if (!near) continue;
    var perm = []; for (k = 0; k < N; k++) perm.push(k); CY.shuffle(perm, rng);
    var a = pred(S), b = pred(L13.relabel(S, perm));
    for (k = 0; k < N; k++) { s2 += Math.pow(b[4 * k + 2] - a[4 * perm[k] + 2], 2) + Math.pow(b[4 * k + 3] - a[4 * perm[k] + 3], 2); n++; }
  }
  return 100 * Math.sqrt(s2 / Math.max(1, n));
};

/* ───────── binding: who is who after the curtain ───────── */
L13.CURT = [2.6, 3.4]; L13.SO = 0.1; L13.BM = 6; L13.XL = 1.4;         // the curtain strip, the detector's noise (m), the number of past detections the belief fits
function hidden(x) { return x > L13.CURT[0] && x < L13.CURT[1]; }
/* N = 2: A comes from the left, B from the right, their paths offset by b metres in y; N > 2: half from each side at random heights.  T steps, then the detections. */
L13.idTrial = function (N, b, rng, T) {
  T = T || 60;
  var S = new Float64Array(4 * N), i, left, v0 = 1.0 + 0.8 * rng();
  for (i = 0; i < N; i++) {
    left = i < N / 2;
    S[4 * i] = left ? L13.XL : 6 - L13.XL;
    S[4 * i + 1] = N === 2 ? 2.5 + (left ? -b / 2 : b / 2) : 1.5 + 2.0 * rng();
    S[4 * i + 2] = (left ? 1 : -1) * (N === 2 ? v0 * (left ? 1 : 1 + 0.3 * (rng() - 0.5)) : 1.0 + 0.8 * rng()); S[4 * i + 3] = 0;
  }
  var tr = L13.rollout(S, N, T), det = tr.map(function (s) {
    var z = [], k; for (k = 0; k < N; k++) z.push(hidden(s[4 * k]) ? null : [s[4 * k] + L13.SO * CY.randn(rng), s[4 * k + 1] + L13.SO * CY.randn(rng)]); return z;
  });
  return { N: N, tr: tr, det: det };
};
/* The filter of lesson 2 for one axis, unrolled: state [position, velocity], F = [[1, g], [0, d]] (friction), one noisy position reading per frame.  Returns [pos, vel] at the last reading. */
function kfAxis(zs, sigO, sigV) {
  var d = Math.exp(-L13.GAMMA * L13.DT), g = (1 - d) / L13.GAMMA, p = zs[0], v = 0, a = sigO * sigO, b = 0, c = 4, i, qv = sigV * sigV;   // P = [[a, b], [b, c]]
  for (i = 1; i < zs.length; i++) {
    var p1 = p + g * v, v1 = d * v, a1 = a + 2 * g * b + g * g * c + qv * g * g, b1 = d * (b + g * c) + qv * g, c1 = d * d * c + qv;       // predict
    var S = a1 + sigO * sigO, k0 = a1 / S, k1 = b1 / S, y = zs[i] - p1;                                                                    // correct
    p = p1 + k0 * y; v = v1 + k1 * y; a = (1 - k0) * a1; b = (1 - k0) * b1; c = c1 - k1 * b1;
  }
  return [p, v];
}
/* the belief of every slot at t0, the last frame before the first one with a ball hidden; tx: the first frame after that with all balls visible again (-1 if none) */
L13.belief = function (trial) {
  var N = trial.N, det = trial.det, tE = 1, i, u, xs, ys, fx, fy, out = new Float64Array(4 * N);
  while (tE < det.length && det[tE].every(function (z) { return z; })) tE++;
  var t0 = tE - 1, tx = tE;
  while (tx < det.length && !det[tx].every(function (z) { return z; })) tx++;
  for (i = 0; i < N; i++) {
    xs = []; ys = [];
    for (u = 0; u <= t0; u++) { xs.push(det[u][i][0]); ys.push(det[u][i][1]); }
    fx = kfAxis(xs, L13.SO, 0.01); fy = kfAxis(ys, L13.SO, 0.01);
    out[4 * i] = fx[0]; out[4 * i + 1] = fy[0]; out[4 * i + 2] = fx[1]; out[4 * i + 3] = fy[1];
  }
  return { t0: t0, tx: tx < det.length ? tx : -1, S: out };
};
/* where each slot expects its ball at the frame tx: 'map' (where it was last seen), 'free' (one-ball model, no neighbours), 'world' (the true interaction), 'pair' (a learned model) */
L13.prior = function (kind, bel, N, model) {
  var s = bel.S, n = bel.tx - bel.t0, u, P = [], i;
  if (kind !== 'map') for (u = 0; u < n; u++) s = kind === 'free' ? L13.stepAlone(s, N) : kind === 'world' ? L13.step(s, N) : model.predict(s, N);
  for (i = 0; i < N; i++) P.push([s[4 * i], s[4 * i + 1]]);
  return P;
};
/* for every detection Z[d], the slot it is given to.  'nn': each detection takes the nearest slot.  'comp': slots compete (softmax over slots for each detection, then each slot moves to the
 * weighted mean of what it won; 4 rounds, temperature 0.25 m).  'opt': the one-to-one matching with the smallest total squared distance. */
function d2(a, b) { return (a[0] - b[0]) * (a[0] - b[0]) + (a[1] - b[1]) * (a[1] - b[1]); }
function argmax(v) { var b = 0, k; for (k = 1; k < v.length; k++) if (v[k] > v[b]) b = k; return b; }
L13.assign = function (rule, P, Z) {
  var n = P.length, d, k;
  if (rule === 'nn') return Z.map(function (z) { var b = 0, k2; for (k2 = 1; k2 < n; k2++) if (d2(P[k2], z) < d2(P[b], z)) b = k2; return b; });
  if (rule === 'comp') {
    var mu = P.map(function (p) { return [p[0], p[1]]; }), A = [], it, tau2 = 2 * 0.25 * 0.25;
    for (it = 0; it < 4; it++) {
      A = Z.map(function (z) { var w = mu.map(function (m) { return Math.exp(-d2(m, z) / tau2); }), s = w.reduce(function (a, c) { return a + c; }, 0) || 1e-300; return w.map(function (v) { return v / s; }); });
      mu = mu.map(function (m, k2) { var sw = 0, sx = 0, sy = 0; Z.forEach(function (z, d3) { sw += A[d3][k2]; sx += A[d3][k2] * z[0]; sy += A[d3][k2] * z[1]; }); return sw > 1e-9 ? [sx / sw, sy / sw] : m; });
    }
    return A.map(argmax);
  }
  var best = Infinity, bp = null;                          // 'opt': every permutation
  (function rec(perm, used, cost) {
    if (perm.length === n) { if (cost < best) { best = cost; bp = perm.slice(); } return; }
    for (var s = 0; s < n; s++) if (!used[s]) { used[s] = true; perm.push(s); rec(perm, used, cost + d2(P[s], Z[perm.length - 1])); perm.pop(); used[s] = false; }
  })([], [], 0);
  return bp;
};
/* identity accuracy at impact parameter b (N = 2) or for a crowd: the share of trials in which EVERY detection is given to the slot of its own ball.  kinds x rules. */
L13.idRun = function (N, b, nTrials, seed, kinds, rules, model) {
  var rng = CY.rng(seed), acc = {}, n = 0, bounce = 0, q, k, r;
  kinds.forEach(function (kd) { acc[kd] = {}; rules.forEach(function (ru) { acc[kd][ru] = 0; }); });
  for (q = 0; q < nTrials; q++) {
    var tl = L13.idTrial(N, b, rng), bel = L13.belief(tl);
    if (bel.tx < 0) continue;
    n++;
    if (N === 2 && tl.tr[bel.tx][0] < tl.tr[bel.tx][4]) bounce++;       // ball A still on the left: the pair bounced
    var Z = tl.det[bel.tx];
    kinds.forEach(function (kd) {
      var P = L13.prior(kd, bel, N, model);
      rules.forEach(function (ru) { if (L13.assign(ru, P, Z).every(function (s, d) { return s === d; })) acc[kd][ru] += 1; });
    });
  }
  kinds.forEach(function (kd) { rules.forEach(function (ru) { acc[kd][ru] /= Math.max(1, n); }); });
  return { n: n, acc: acc, bounce: bounce / Math.max(1, n) };
};

/* ───────── the exit: video of nudged balls ───────── */
/* four buttons, each an impulse of 0.8 m/s in a direction the model does not know (30, 120, 210, 300 degrees) */
L13.BUTTONS = [0, 1, 2, 3].map(function (c) { var a = (30 + 90 * c) * Math.PI / 180; return [0.8 * Math.cos(a), 0.8 * Math.sin(a)]; });
/* a hidden agent presses a random button on a random ball with probability pKick at every step; returns the transitions of nScenes scenes of N balls, 5 steps each */
L13.nudgeVideo = function (N, nScenes, seed, pKick) {
  var rng = CY.rng(seed), out = [], q, t, s, ns, k, c, i;
  for (q = 0; q < nScenes; q++) {
    s = L13.scene(N, rng, L13.WIN);
    for (t = 0; t < 5; t++) {
      var pushed = Float64Array.from(s), who = -1, btn = -1;
      if (rng() < pKick) { who = Math.floor(rng() * N); btn = Math.floor(rng() * 4); pushed[4 * who + 2] += L13.BUTTONS[btn][0]; pushed[4 * who + 3] += L13.BUTTONS[btn][1]; }
      ns = L13.step(pushed, N); out.push({ s: s, s1: ns, who: who, btn: btn }); s = ns;
    }
  }
  return out;
};

/* ───────── the lab: the state the widget works on ───────── */
L13.NSC = 100;                                             // scenes per N in the exam
L13.lab = function () {
  var lab = { D: L13.makeData(3, 800, 5, 11, L13.WIN), pair: new Pair(16, 6), flat: new Flat(3, 16, 2), steps: { pair: 0, flat: 0 }, opt: { batch: 32, lr: 0.02, decay: 0.1, total: 6000, seed: 3 }, _sc: {}, _ex: {}, _ps: {}, _id: {} };
  lab.train = function (which, n) { L13.train(lab[which], lab.D, n, lab.opt); lab.steps[which] += n; };
  lab.reset = function () { lab.pair = new Pair(16, 6); lab.flat = new Flat(3, 16, 2); lab.steps = { pair: 0, flat: 0 }; lab._ex = {}; lab._ps = {}; };
  lab.scenes = function (N) { return lab._sc[N] || (lab._sc[N] = L13.scenes(N, L13.NSC, 21)); };
  lab.model = function (which) { return which === 'pair' ? lab.pair : which === 'flat' ? lab.flat : null; };
  lab.predB = function (which, N) {
    if (which === 'blind') return function (SB, B) { return L13.stepAloneB(SB, B, N); };
    var m = lab.model(which); return function (SB, B) { return m.predictB(SB, B, N); };
  };
  lab.exam = function (which, N) {                         // cached until the model is trained again
    var key = which + N + ':' + (which === 'blind' ? 0 : lab.steps[which]);
    return lab._ex[key] || (lab._ex[key] = L13.exam(lab.predB(which, N), N, lab.scenes(N)));
  };
  lab.sens = function (which, N) {
    var key = which + N + ':' + lab.steps[which], m = lab.model(which);
    return lab._ps[key] === undefined ? (lab._ps[key] = L13.permSens(function (S) { return m.predict(S, N); }, N, lab.scenes(N).slice(0, 60))) : lab._ps[key];
  };
  lab.BG = [0, 0.05, 0.1, 0.15, 0.2, 0.25, 0.3, 0.35, 0.4, 0.45, 0.5];   // the grid of impact parameters (m)
  lab.idStats = function (N, bi) {                         // identity accuracy for N balls (N = 2: at impact parameter BG[bi]); the learned prior is recomputed after training
    var b = N === 2 ? lab.BG[bi] : 0, nT = N === 2 ? 60 : 120, out = { acc: {} }, key = 'id' + N + ':' + bi;
    ['map', 'free', 'world', 'pair'].forEach(function (kd) {
      var k2 = key + kd + (kd === 'pair' ? ':' + lab.steps.pair : ''), r = lab._id[k2] || (lab._id[k2] = L13.idRun(N, b, nT, 1000 * N + bi, [kd], ['nn', 'comp'], lab.pair));
      out.acc[kd] = r.acc[kd]; out.n = r.n; out.bounce = r.bounce;
    });
    return out;
  };
  lab.idExample = function (N, bi) {                       // one typical trial to draw: the truth, the detections, the belief and what each prior says
    var most = lab.idStats(N, bi).n >= (N === 2 ? 30 : 60), out = null, k, rng, tl, bel, P, A;   // do most trials finish?
    for (k = 0; k < 12; k++) {
      rng = CY.rng(77 + bi + 101 * k); tl = L13.idTrial(N, N === 2 ? lab.BG[bi] : 0, rng); bel = L13.belief(tl);
      if (bel.tx < 0) { if (!most) return { trial: tl, bel: bel }; continue; }       // most do not finish: show one that does not; otherwise skip it
      P = {}; A = {};
      ['map', 'free', 'world', 'pair'].forEach(function (kd) { P[kd] = L13.prior(kd, bel, N, lab.pair); A[kd] = L13.assign('comp', P[kd], tl.det[bel.tx]); });
      out = { trial: tl, bel: bel, prior: P, assign: A };
      if (A.world.every(function (s, d) { return s === d; })) return out;             // the true-physics prior keeps the names, as it does in most trials
    }
    return out || { trial: tl, bel: bel };
  };
  lab.view = function (N, q) {                             // one scene: the truth and what each model says when it runs on its own
    var tr = lab.scenes(N)[q], o = { truth: tr };
    ['blind', 'flat', 'pair'].forEach(function (w) { var pb = lab.predB(w, N), s = tr[0], path = [s], t; for (t = 0; t < 10; t++) { s = pb(s, 1); path.push(s); } o[w] = path; });
    return o;
  };
  return lab;
};

if (typeof module !== 'undefined' && module.exports) module.exports = L13; else root.L13 = L13;
})(typeof window !== 'undefined' ? window : this);
