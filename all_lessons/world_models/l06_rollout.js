/* l06_rollout.js — private engine of World Models lesson 06, "Errors compound: rollouts and horizons".  Global L6; needs courtyard.js (CY) loaded first.
 *
 * What it holds (everything the lesson's widget computes, so that the page script only draws):
 *   - the log: launches of the plain Courtyard in which an OPERATOR nudges once, at step 12, to aim the ball's stopping point at the goal (with habitual noise),
 *     93 steps in all (12 coasting, the nudge, 80 coasting: lesson 1's nudge task);
 *   - a small learned one-step model, s' = s + net(s, a): a tanh MLP with analytic input gradients (CY.MLP has none), Adam, and four ways of training it:
 *     'one' (teacher forcing), 'noise' (noisy inputs, clean targets), 'relabel' (DAgger: the states the model visits, labelled by the simulator),
 *     'multi' (backpropagation through H self-fed steps, finite-difference checked in the oracle);
 *   - rollouts that feed a model its own outputs, with an optional re-observation every m steps (the state is replaced by the true state plus an error);
 *   - the first-order recursion e(k+1) = J(k) e(k) + delta(k), with J the model's Jacobian at the TRUE state and delta the one-step error there;
 *   - "lab" worlds in which the model is the exact simulator but the start is wrong: the plain Courtyard, and a lattice of posts (Jacobians by finite differences);
 *   - studies of the held-out launches, with the logged nudges or with every nudge shifted by `off` m/s in a random direction (nudges the operator never took), and the exit
 *     measurement: how often the imagined ending is off by more than the goal's radius for the nudges the operator took and for the ones it did not;
 *   - a fan of copies of one launch started a little wrong, for the arena picture;
 *   - the widget's three panels (L6.paint) and the labels of its controls (L6.UI); the page script keeps the caches and the readouts.
 * Conventions: state s = [x, y, vx, vy] (m, m/s); one step = 0.1 s; the error of an estimate is the distance between its position and the true position (m);
 * "median" is the upper median (sorted[floor(n/2)]); everything is deterministic (CY.rng).
 */
(function (root) {
'use strict';
var CY = root.CY || (typeof require !== 'undefined' ? require('./courtyard.js') : null);
var L6 = {};

/* ───────────── the world and the nudge task ───────────── */
L6.W = CY.world({});
L6.TA = 12; L6.K = 81; L6.T = 93; L6.AMAX = 3;                       // nudge at step 12; an imagined ending is 81 steps (the nudge and 80 more); a log has 93 steps
L6.d = Math.exp(-L6.W.gamma * L6.W.dt); L6.g = (1 - L6.d) / L6.W.gamma;   // free flight on one axis: position += g v, v *= d
L6.LATTICE = (function () {
  var ps = [], cols = [1.8, 2.8, 3.8, 4.8, 5.8], c, y;
  for (c = 0; c < cols.length; c++) for (y = 0.8 + (c % 2) * 0.5; y < 4.9; y += 1.0) ps.push({ x: cols[c], y: +y.toFixed(2), r: 0.2 });
  return CY.world({ posts: ps });
})();
L6.median = function (a) { var b = Array.prototype.slice.call(a).sort(function (x, y) { return x - y; }); return b[Math.floor(b.length / 2)]; };

/* ───────────── the log: an operator who aims the stopping point at the goal ───────────── */
L6.operator = function (s, rng, sig) {                                // free flight stops at p + v / gamma, so the nudge that aims it at the goal is gamma (goal - p) - v
  var w = L6.W, a = [w.gamma * (w.goal.x - s[0]) - s[2] + sig * CY.randn(rng), w.gamma * (w.goal.y - s[1]) - s[3] + sig * CY.randn(rng)], n = Math.hypot(a[0], a[1]);
  if (n > L6.AMAX) { a[0] *= L6.AMAX / n; a[1] *= L6.AMAX / n; }
  return a;
};
L6.makeLog = function (n, seed) {
  var rng = CY.rng(seed), T = L6.T, S = new Float64Array(n * (T + 1) * 4), A = new Float64Array(n * T * 2), i, t, s, a;
  for (i = 0; i < n; i++) {
    s = CY.launch(L6.W, rng);
    for (t = 0; t <= T; t++) {
      S.set(s, (i * (T + 1) + t) * 4);
      if (t === T) break;
      a = null;
      if (t === L6.TA) { a = L6.operator(s, rng, 0.25); A[(i * T + t) * 2] = a[0]; A[(i * T + t) * 2 + 1] = a[1]; }
      s = CY.step(L6.W, s, a);
    }
  }
  return { n: n, T: T, S: S, A: A };
};
L6.stateAt = function (log, i, t) { var b = (i * (log.T + 1) + t) * 4; return [log.S[b], log.S[b + 1], log.S[b + 2], log.S[b + 3]]; };
L6.nudgeOf = function (log, i) { var b = (i * log.T + L6.TA) * 2; return [log.A[b], log.A[b + 1]]; };

/* ───────────── a tanh MLP with analytic input gradients, Adam, preallocated buffers ───────────── */
L6.Net = function (sizes, seed) {
  var rng = CY.rng(seed), L = sizes.length - 1, l, i, fi, fo, sc, Wl;
  this.sizes = sizes; this.L = L; this.W = []; this.b = []; this.mW = []; this.vW = []; this.mb = []; this.vb = []; this.t = 0;
  for (l = 0; l < L; l++) {
    fi = sizes[l]; fo = sizes[l + 1]; sc = Math.sqrt(2 / (fi + fo)); Wl = new Float64Array(fi * fo);
    for (i = 0; i < Wl.length; i++) Wl[i] = sc * CY.randn(rng);
    this.W.push(Wl); this.b.push(new Float64Array(fo));
    this.mW.push(new Float64Array(fi * fo)); this.vW.push(new Float64Array(fi * fo)); this.mb.push(new Float64Array(fo)); this.vb.push(new Float64Array(fo));
  }
  this.dbuf = sizes.map(function (n) { return new Float64Array(n); });
  this.own = this.acts();
};
var NP = L6.Net.prototype;
NP.acts = function () { return this.sizes.map(function (n) { return new Float64Array(n); }); };
NP.grad = function () { return { W: this.W.map(function (w) { return new Float64Array(w.length); }), b: this.b.map(function (b) { return new Float64Array(b.length); }) }; };
NP.zero = function (G) { for (var l = 0; l < this.L; l++) { G.W[l].fill(0); G.b[l].fill(0); } };
NP.fwd = function (u, acts) {                                         // acts[0] = input ... acts[L] = output
  var a0 = acts[0], L = this.L, l, i, j, fi, fo, a, y, Wl, b, s;
  for (i = 0; i < a0.length; i++) a0[i] = u[i];
  for (l = 0; l < L; l++) {
    fi = this.sizes[l]; fo = this.sizes[l + 1]; a = acts[l]; y = acts[l + 1]; Wl = this.W[l]; b = this.b[l];
    for (j = 0; j < fo; j++) { s = b[j]; for (i = 0; i < fi; i++) s += a[i] * Wl[i * fo + j]; y[j] = l === L - 1 ? s : Math.tanh(s); }
  }
  return acts[L];
};
NP.bwd = function (acts, dOut, G) {                                   // adds dLoss/dparameters into G; returns dLoss/dinput (a shared buffer: copy before the next call)
  var L = this.L, d = this.dbuf[L], l, i, j, fi, fo, a, Wl, gW, gb, nd, s;
  for (j = 0; j < d.length; j++) d[j] = dOut[j];
  for (l = L - 1; l >= 0; l--) {
    fi = this.sizes[l]; fo = this.sizes[l + 1]; a = acts[l]; Wl = this.W[l]; gW = G.W[l]; gb = G.b[l]; nd = this.dbuf[l];
    for (j = 0; j < fo; j++) { gb[j] += d[j]; for (i = 0; i < fi; i++) gW[i * fo + j] += a[i] * d[j]; }
    for (i = 0; i < fi; i++) { s = 0; for (j = 0; j < fo; j++) s += Wl[i * fo + j] * d[j]; nd[i] = l > 0 ? s * (1 - a[i] * a[i]) : s; }
    d = nd;
  }
  return this.dbuf[0];
};
NP.adam = function (G, lr, scale) {
  var b1 = 0.9, b2 = 0.999, l, i, c1, c2, Wl, gw, mW, vW, bb, gB, mb, vb, gi;
  this.t++; c1 = 1 - Math.pow(b1, this.t); c2 = 1 - Math.pow(b2, this.t);
  for (l = 0; l < this.L; l++) {
    Wl = this.W[l]; gw = G.W[l]; mW = this.mW[l]; vW = this.vW[l]; bb = this.b[l]; gB = G.b[l]; mb = this.mb[l]; vb = this.vb[l];
    for (i = 0; i < Wl.length; i++) { gi = gw[i] * scale; mW[i] = b1 * mW[i] + (1 - b1) * gi; vW[i] = b2 * vW[i] + (1 - b2) * gi * gi; Wl[i] -= lr * (mW[i] / c1) / (Math.sqrt(vW[i] / c2) + 1e-8); }
    for (i = 0; i < bb.length; i++) { gi = gB[i] * scale; mb[i] = b1 * mb[i] + (1 - b1) * gi; vb[i] = b2 * vb[i] + (1 - b2) * gi * gi; bb[i] -= lr * (mb[i] / c1) / (Math.sqrt(vb[i] / c2) + 1e-8); }
  }
};
NP.resetAdam = function () { this.t = 0; for (var l = 0; l < this.L; l++) { this.mW[l].fill(0); this.vW[l].fill(0); this.mb[l].fill(0); this.vb[l].fill(0); } };
NP.clone = function () { var n = new L6.Net(this.sizes, 1); for (var l = 0; l < this.L; l++) { n.W[l].set(this.W[l]); n.b[l].set(this.b[l]); } return n; };

/* the model of the world: s' = s + net(u),  u = [(x - 3)/2, (y - 2.5)/1.5, vx/2, vy/2, ax, ay] */
var MU = [3, 2.5, 0, 0, 0, 0], SC = [2, 1.5, 2, 2, 1, 1], U = new Float64Array(6);
L6.SC = SC;
L6.inputs = function (s, a, u) { u[0] = (s[0] - MU[0]) / SC[0]; u[1] = (s[1] - MU[1]) / SC[1]; u[2] = s[2] / SC[2]; u[3] = s[3] / SC[3]; u[4] = a ? a[0] : 0; u[5] = a ? a[1] : 0; return u; };
L6.step = function (net, s, a) { var o = net.fwd(L6.inputs(s, a, U), net.own); return [s[0] + o[0], s[1] + o[1], s[2] + o[2], s[3] + o[3]]; };
L6.jac = function (net, s, a) {                                       // d s' / d s, row-major 4 x 4: identity plus the network's input gradient
  var acts = net.own, G = net._G || (net._G = net.grad()), J = new Float64Array(16), j, i, din, dOut = new Float64Array(4);
  net.fwd(L6.inputs(s, a, U), acts);
  for (j = 0; j < 4; j++) { dOut.fill(0); dOut[j] = 1; din = net.bwd(acts, dOut, G); for (i = 0; i < 4; i++) J[j * 4 + i] = (i === j ? 1 : 0) + din[i] / SC[i]; }
  return J;
};

/* ───────────── training ───────────── */
L6.pairs = function (log) {                                           // every transition of the log as (inputs, increment): the teacher-forced training set
  var n = log.n, T = log.T, X = new Float64Array(n * T * 6), Y = new Float64Array(n * T * 4), i, t, s, s2, a, q = 0;
  for (i = 0; i < n; i++) for (t = 0; t < T; t++) {
    s = L6.stateAt(log, i, t); s2 = L6.stateAt(log, i, t + 1); a = [log.A[(i * T + t) * 2], log.A[(i * T + t) * 2 + 1]];
    L6.inputs(s, a, U); for (var c = 0; c < 6; c++) X[q * 6 + c] = U[c];
    for (c = 0; c < 4; c++) Y[q * 4 + c] = s2[c] - s[c];
    q++;
  }
  return { X: X, Y: Y };
};
L6.fitOne = function (net, X, Y, o) {                                 // minimise the squared one-step error of the increment (physical units); linear decay of the learning rate
  var n = Y.length / 4, ep, s, k, q, id, cnt, tot, lr, idx = new Int32Array(n), rng = CY.rng(o.seed), acts = net.acts(), G = net.grad(), dOut = new Float64Array(4), u = new Float64Array(6), out, e, batch = o.batch || 32;
  for (k = 0; k < n; k++) idx[k] = k;
  for (ep = 0; ep < o.epochs; ep++) {
    CY.shuffle(idx, rng); lr = o.lr + (o.lrEnd - o.lr) * (o.epochs > 1 ? ep / (o.epochs - 1) : 1);
    for (s = 0; s < n; s += batch) {
      net.zero(G); cnt = Math.min(batch, n - s);
      for (k = 0; k < cnt; k++) {
        id = idx[s + k];
        for (q = 0; q < 6; q++) u[q] = X[id * 6 + q];
        out = net.fwd(u, acts);
        for (q = 0; q < 4; q++) { e = out[q] - Y[id * 4 + q]; dOut[q] = 2 * e; }
        net.bwd(acts, dOut, G);
      }
      net.adam(G, lr, 1 / cnt);
    }
  }
};
/* multi-step loss of one window: roll the model H steps from the true state, loss = mean_j |s^_j - s_j|^2, gradient by backpropagation through the unrolled steps */
L6.windowGrad = function (net, log, i, t0, H, G, ws) {
  var T = log.T, shat = ws.shat, lam = ws.lam, u = ws.u, j, c, o, sj, a, e, loss = 0, w = 1 / H, din, st;
  for (c = 0; c < 4; c++) shat[0][c] = log.S[(i * (T + 1) + t0) * 4 + c];
  for (j = 0; j < H; j++) {                                           // forward: feed the model its own output
    sj = shat[j]; a = [log.A[(i * T + t0 + j) * 2], log.A[(i * T + t0 + j) * 2 + 1]];
    o = net.fwd(L6.inputs(sj, a, u), ws.acts[j]);
    for (c = 0; c < 4; c++) shat[j + 1][c] = sj[c] + o[c];
  }
  lam.fill(0);
  for (j = H - 1; j >= 0; j--) {                                      // backward: dL/ds^_{j+1} = own error + what the later steps pass back through the Jacobian
    st = (i * (T + 1) + t0 + j + 1) * 4;
    for (c = 0; c < 4; c++) { e = shat[j + 1][c] - log.S[st + c]; lam[c] += 2 * w * e; loss += w * e * e; }
    din = net.bwd(ws.acts[j], lam, G);
    for (c = 0; c < 4; c++) lam[c] += din[c] / SC[c];
  }
  return loss;
};
L6.workspace = function (net, H) {
  var sh = [], ac = [], j;
  for (j = 0; j <= H; j++) sh.push(new Float64Array(4));
  for (j = 0; j < H; j++) ac.push(net.acts());
  return { acts: ac, shat: sh, lam: new Float64Array(4), u: new Float64Array(6) };
};
L6.fitMulti = function (net, log, H, o) {
  var n = log.n, T = log.T, rng = CY.rng(o.seed), G = net.grad(), ws = L6.workspace(net, H), jobs = [], i, q, ep, s, k, cnt, lr, batch = o.batch || 16;
  for (i = 0; i < n; i++) for (q = 0; q < o.per; q++) jobs.push(i);
  net.resetAdam();
  for (ep = 0; ep < o.epochs; ep++) {
    CY.shuffle(jobs, rng); lr = o.lr + (o.lrEnd - o.lr) * (o.epochs > 1 ? ep / (o.epochs - 1) : 1);
    for (s = 0; s < jobs.length; s += batch) {
      net.zero(G); cnt = Math.min(batch, jobs.length - s);
      for (k = 0; k < cnt; k++) L6.windowGrad(net, log, jobs[s + k], Math.floor(rng() * (T - H + 1)), H, G, ws);
      net.adam(G, lr, 1 / cnt);
    }
  }
};
L6.concat = function (A, B) { var X = new Float64Array(A.X.length + B.X.length), Y = new Float64Array(A.Y.length + B.Y.length); X.set(A.X); X.set(B.X, A.X.length); Y.set(A.Y); Y.set(B.Y, A.Y.length); return { X: X, Y: Y }; };
L6.labelled = function (states) {                                     // DAgger: label states the MODEL visited with the simulator's true successor (no action)
  var X = new Float64Array(states.length * 6), Y = new Float64Array(states.length * 4), i, c, q;
  for (i = 0; i < states.length; i++) {
    q = CY.step(L6.W, states[i], null); L6.inputs(states[i], null, U);
    for (c = 0; c < 6; c++) X[i * 6 + c] = U[c];
    for (c = 0; c < 4; c++) Y[i * 4 + c] = q[c] - states[i][c];
  }
  return { X: X, Y: Y };
};
L6.visited = function (net, log, t0, K) {                             // the states the model visits when rolled from the true state at t0 on every launch
  var out = [], i, k, s;
  for (i = 0; i < log.n; i++) { s = L6.stateAt(log, i, t0); for (k = 0; k < K; k++) { out.push(s); s = L6.step(net, s, null); } }
  return out;
};
L6.noisyClean = function (log, sp, sv, seed) {                        // the log's inputs with Gaussian noise added; the TARGET stays the clean next state (what a denoising fix does)
  var rng = CY.rng(seed), n = log.n, T = log.T, X = new Float64Array(n * T * 6), Y = new Float64Array(n * T * 4), i, t, s, s2, a, c, q = 0, e;
  for (i = 0; i < n; i++) for (t = 0; t < T; t++) {
    s = L6.stateAt(log, i, t); s2 = L6.stateAt(log, i, t + 1); a = [log.A[(i * T + t) * 2], log.A[(i * T + t) * 2 + 1]];
    e = [sp * CY.randn(rng), sp * CY.randn(rng), sv * CY.randn(rng), sv * CY.randn(rng)];
    L6.inputs([s[0] + e[0], s[1] + e[1], s[2] + e[2], s[3] + e[3]], a, U); for (c = 0; c < 6; c++) X[q * 6 + c] = U[c];
    for (c = 0; c < 4; c++) Y[q * 4 + c] = s2[c] - (s[c] + e[c]);
    q++;
  }
  return { X: X, Y: Y };
};
L6.NET = [6, 12, 12, 4];
L6.pretrain = function (log, seed) {                                  // stage 1, shared by every variant: 60 epochs of teacher forcing
  var net = new L6.Net(L6.NET, seed), P = L6.pairs(log);
  L6.fitOne(net, P.X, P.Y, { epochs: 60, lr: 0.01, lrEnd: 0.0005, seed: 3 });
  return net;
};
L6.KINDS = ['one', 'noise', 'relabel', 'multi'];
L6.finish = function (kind, base, log) {                              // stage 2: 20 more epochs, the same learning-rate ramp for every variant, only the data or the loss differ
  var net = base.clone(), P = L6.pairs(log), r, e, D, lr0 = 0.002, lr1 = 0.0002;
  net.resetAdam();
  if (kind === 'one') L6.fitOne(net, P.X, P.Y, { epochs: 20, lr: lr0, lrEnd: lr1, seed: 4 });
  else if (kind === 'multi') L6.fitMulti(net, log, 10, { epochs: 20, lr: lr0, lrEnd: lr1, seed: 9, per: 15 });
  else if (kind === 'relabel') {
    D = P;
    for (r = 0; r < 2; r++) { D = L6.concat(D, L6.labelled(L6.visited(net, log, L6.TA + 1, 80))); net.resetAdam(); L6.fitOne(net, D.X, D.Y, { epochs: 10, lr: lr0, lrEnd: lr1, seed: 5 + r }); }
  } else if (kind === 'noise') {
    for (e = 0; e < 20; e++) { D = L6.concat(P, L6.noisyClean(log, 0.03, 0.02, 100 + e)); L6.fitOne(net, D.X, D.Y, { epochs: 1, lr: lr0 + (lr1 - lr0) * e / 19, lrEnd: lr0 + (lr1 - lr0) * e / 19, seed: 6 + e }); }
  }
  return net;
};

/* ───────────── rollouts: feeding a model its own output ───────────── */
L6.truthPath = function (world, s0, a1, K) {                          // the real thing: the simulator, with the nudge a1 at the first step
  var p = [s0], k, s = s0;
  for (k = 1; k <= K; k++) { s = CY.step(world, s, k === 1 ? a1 : null); p.push(s); }
  return p;
};
L6.roll = function (step, truth, a1, K, m, kick) {                    // step(s, a) -> s'.  Every m steps the state is replaced by the true state plus kick(r); kick(0) is the error of the start
  var p = [kick ? L6.add(truth[0], kick(0)) : truth[0].slice()], k, s;
  for (k = 1; k <= K; k++) {
    s = step(p[k - 1], k === 1 ? a1 : null);
    if (m > 0 && k % m === 0) s = kick ? L6.add(truth[k], kick(k / m)) : truth[k].slice();
    p.push(s);
  }
  return p;
};
L6.add = function (a, b) { return [a[0] + b[0], a[1] + b[1], a[2] + b[2], a[3] + b[3]]; };
L6.posErr = function (a, b) { return Math.hypot(a[0] - b[0], a[1] - b[1]); };
/* the first-order recursion  e(k+1) = J(k) e(k) + delta(k),  restarted from kick(r) at every re-observation; J[k] (16 numbers) and dl[k] (4) belong to the TRUE state of step k */
L6.linearise = function (J, dl, K, m, kick) {
  var e = kick ? kick(0).slice() : [0, 0, 0, 0], out = [e], k, c, n, Jk;
  for (k = 0; k < K; k++) {
    Jk = J[k]; n = [dl[k][0], dl[k][1], dl[k][2], dl[k][3]];
    for (c = 0; c < 4; c++) n[c] += Jk[c * 4] * e[0] + Jk[c * 4 + 1] * e[1] + Jk[c * 4 + 2] * e[2] + Jk[c * 4 + 3] * e[3];
    if (m > 0 && (k + 1) % m === 0) n = kick ? kick((k + 1) / m).slice() : [0, 0, 0, 0];
    e = n; out.push(e);
  }
  return out;
};
L6.fdJac = function (world, s, a, h) {                                // d s' / d s of the exact simulator by forward differences
  var base = CY.step(world, s, a), J = new Float64Array(16), i, j, p, q;
  for (i = 0; i < 4; i++) { p = s.slice(); p[i] += h; q = CY.step(world, p, a); for (j = 0; j < 4; j++) J[j * 4 + i] = (q[j] - base[j]) / h; }
  return J;
};
L6.horizon = function (med, tau) { for (var k = 0; k < med.length; k++) if (med[k] > tau) return k; return -1; };   // first step whose median error exceeds tau (-1: never within the rollout)

/* unit directions of the errors that a start or a re-observation carries: launch i, r-th observation; independent of the size of the error and of m */
L6.kicks = function (n, R) {
  var out = [], i, r, rng, v, nn;
  for (i = 0; i < n; i++) {
    rng = CY.rng(1000 + i); out.push([]);
    for (r = 0; r <= R; r++) { v = [CY.randn(rng), CY.randn(rng), CY.randn(rng), CY.randn(rng)]; nn = Math.hypot(v[0], v[1], v[2], v[3]); out[i].push([v[0] / nn, v[1] / nn, v[2] / nn, v[3] / nn]); }
  }
  return out;
};

/* ───────────── a study of the learned model: held-out launches, the nudge at step 12 ───────────── */
L6.study = function (test, off, seed) {                              // off > 0: every logged nudge shifted by `off` m/s in a random direction (nudges the operator never took)
  var n = test.n, K = L6.K, S = { id: (off || 0) + ':' + (seed || 0), test: test, n: n, truth: [], nudge: [] }, rng = CY.rng(seed || 31), i, an, a;
  for (i = 0; i < n; i++) {
    an = 2 * Math.PI * rng(); a = L6.nudgeOf(test, i);
    if (off) a = [a[0] + off * Math.cos(an), a[1] + off * Math.sin(an)];
    S.nudge.push(a); S.truth.push(L6.truthPath(L6.W, L6.stateAt(test, i, L6.TA), a, K));
  }
  return S;
};
/* what a trained net does on the study: its rollouts (every m steps re-anchored to the true state), the recursion's prediction, the one-step errors at the true states */
L6.teacherForced = function (S, net) {                                // at every TRUE state of every launch: the model's Jacobian J and its one-step error delta (cached on the net)
  var cache = net._tf || (net._tf = {});
  if (cache[S.id]) return cache[S.id];
  var K = L6.K, J = [], D = [], one = [], i, k, a, p, t1, Ji, Di;
  for (i = 0; i < S.n; i++) {
    Ji = []; Di = [];
    for (k = 0; k < K; k++) {
      a = k === 0 ? S.nudge[i] : null; p = L6.step(net, S.truth[i][k], a); t1 = S.truth[i][k + 1];
      Ji.push(L6.jac(net, S.truth[i][k], a)); Di.push([p[0] - t1[0], p[1] - t1[1], p[2] - t1[2], p[3] - t1[3]]); one.push(Math.hypot(p[0] - t1[0], p[1] - t1[1]));
    }
    J.push(Ji); D.push(Di);
  }
  cache[S.id] = { J: J, D: D, one: L6.median(one) };
  return cache[S.id];
};
L6.evalNet = function (S, net, m) {
  var K = L6.K, n = S.n, step = function (s, a) { return L6.step(net, s, a); }, tf = L6.teacherForced(S, net), med = new Float64Array(K + 1), lin = new Float64Array(K + 1), each = [], paths = [], linE = [], i, k, col, colL;
  for (i = 0; i < n; i++) {
    paths.push(L6.roll(step, S.truth[i], S.nudge[i], K, m, null)); each.push(new Float64Array(K + 1));
    linE.push(L6.linearise(tf.J[i], tf.D[i], K, m, null));
  }
  for (k = 0; k <= K; k++) {
    col = []; colL = [];
    for (i = 0; i < n; i++) { each[i][k] = L6.posErr(paths[i][k], S.truth[i][k]); col.push(each[i][k]); colL.push(Math.hypot(linE[i][k][0], linE[i][k][1])); }
    med[k] = L6.median(col); lin[k] = L6.median(colL);
  }
  return { med: med, lin: lin, each: each, paths: paths, one: tf.one };
};

/* ───────────── labs: the model is the exact simulator, the START is wrong ───────────── */
L6.lab = function (world, test) {                                     // the launches of the test log, rolled from their first step with no nudge
  var K = L6.K, n = test.n, Lb = { world: world, n: n, truth: [], J: [], zeroD: [] }, i, k, p;
  for (i = 0; i < n; i++) {
    p = L6.truthPath(world, L6.stateAt(test, i, 0), null, K); Lb.truth.push(p); Lb.J.push([]);
    for (k = 0; k < K; k++) Lb.J[i].push(L6.fdJac(world, p[k], null, 1e-6));
  }
  for (k = 0; k < K; k++) Lb.zeroD.push([0, 0, 0, 0]);
  Lb.kicks = L6.kicks(n, K);
  return Lb;
};
L6.fan = function (Lb, i, eps, m, n) {                               // n rollouts of launch i from different start errors of size eps (fresh errors at each re-observation): the arena picture
  var out = [], rng = CY.rng(31 + i), step = function (s) { return CY.step(Lb.world, s, null); }, j, r, v, nn, ks;
  for (j = 0; j < n; j++) {
    ks = [];
    for (r = 0; r <= L6.K; r++) { v = [CY.randn(rng), CY.randn(rng), CY.randn(rng), CY.randn(rng)]; nn = Math.hypot(v[0], v[1], v[2], v[3]); ks.push([eps * v[0] / nn, eps * v[1] / nn, eps * v[2] / nn, eps * v[3] / nn]); }
    out.push(L6.roll(step, Lb.truth[i], null, L6.K, m, (function (q) { return function (rr) { return q[rr]; }; })(ks)));
  }
  return out;
};
L6.kickOf = function (Lb, i, eps) { return function (r) { var u = Lb.kicks[i][r]; return [eps * u[0], eps * u[1], eps * u[2], eps * u[3]]; }; };
L6.evalLab = function (Lb, eps, m) {
  var K = L6.K, n = Lb.n, step = function (s) { return CY.step(Lb.world, s, null); }, med = new Float64Array(K + 1), lin = new Float64Array(K + 1), each = [], paths = [], linE = [], i, k, col, colL, kf;
  for (i = 0; i < n; i++) {
    kf = L6.kickOf(Lb, i, eps);
    paths.push(L6.roll(step, Lb.truth[i], null, K, m, kf)); each.push(new Float64Array(K + 1));
    linE.push(L6.linearise(Lb.J[i], Lb.zeroD, K, m, kf));              // an exact model has delta = 0: the recursion carries the start error alone
  }
  for (k = 0; k <= K; k++) {
    col = []; colL = [];
    for (i = 0; i < n; i++) { each[i][k] = L6.posErr(paths[i][k], Lb.truth[i][k]); col.push(each[i][k]); colL.push(Math.hypot(linE[i][k][0], linE[i][k][1])); }
    med[k] = L6.median(col); lin[k] = L6.median(colL);
  }
  return { med: med, lin: lin, each: each, paths: paths };
};

/* ───────────── the exit: imagined endings for nudges the operator took and for nudges it did not ───────────── */
L6.endings = function (S, net, offset, seed) {                        // nudge = the operator's own plus `offset` m/s in a random direction (offset 0: the logged nudge)
  var rng = CY.rng(seed), n = S.n, K = L6.K, errs = [], i, an, a, s0, t, m, k, touched = 0, free = [];
  for (i = 0; i < n; i++) {
    an = 2 * Math.PI * rng(); a = [S.nudge[i][0] + offset * Math.cos(an), S.nudge[i][1] + offset * Math.sin(an)];
    s0 = S.truth[i][0]; t = L6.truthPath(L6.W, s0, a, K); m = s0;
    for (k = 1; k <= K; k++) m = L6.step(net, m, k === 1 ? a : null);
    errs.push(L6.posErr(m, t[K]));
    var hit = false; for (k = 0; k <= K; k++) if (t[k][0] < 0.12 || t[k][0] > 7.88 || t[k][1] < 0.12 || t[k][1] > 4.88) { hit = true; break; }
    if (hit) touched++; else free.push(errs[i]);
  }
  return { errs: errs, free: free, touched: touched };
};
L6.share = function (errs, thr) { var c = 0, i; for (i = 0; i < errs.length; i++) if (errs[i] > thr) c++; return errs.length ? c / errs.length : 0; };

/* ───────────── drawing: the widget's three panels, on the shared canvas kit CY.draw ───────────── */
L6.UI = {
  TAUS: [0.005, 0.01, 0.02, 0.05, 0.1, 0.2, 0.5], TAUL: ['5 mm', '1 cm', '2 cm', '5 cm', '10 cm', '20 cm', '50 cm'], EPSL: ['0.1 mm', '1 mm', '1 cm', '10 cm'], OFF: { op: 0, o5: 0.5, o10: 1 },
  KC: { one: CY.C.amber, noise: CY.C.red, relabel: CY.C.green, multi: CY.C.cyan }, KN: { one: 'teacher forcing', noise: 'noisy inputs', relabel: 'relabelled visits', multi: 'multi-step loss' }
};
/* q = the controls {world, kind, off, eps, m, tau, k}; ev = the series being shown; tau = the tolerance in metres; h = the measured horizon;
 * env = {TE: the held-out log, EX: the launch drawn in the arena, nets: the trained networks so far, study(off), lab(world), fan(q), series(q)} (the page's caches) */
L6.paint = function (cv, q, ev, tau, h, env) {
  var D = CY.draw, C = CY.C, K = L6.K, TA = L6.TA, EX = env.EX, UI = L6.UI, LO = 1e-5, SPAN = Math.log(10 / LO);
  function rad(e, R) { return Math.log(Math.max(e, LO) / LO) / SPAN * R; }
  function ring(ctx, x, y, r, col, w, dash) { ctx.save(); ctx.strokeStyle = col; ctx.lineWidth = w; ctx.setLineDash(dash || []); ctx.beginPath(); ctx.arc(x, y, r, 0, 2 * Math.PI); ctx.stroke(); ctx.restore(); }
  function trace(ctx, v, pts, b, col, w) { D.path(ctx, pts.slice(0, b + 1).map(function (p) { return [v.X(p[0]), v.Y(p[1])]; }), col, w); }
  function arena(ctx, A) {                                        // panel A: one launch, the real path and the model's path (or twelve copies)
    var learned = q.world === 'learned', wd = q.world === 'lattice' ? L6.LATTICE : L6.W, k = q.k, tr = [], fan, i;
    var v = D.view(A[0] + 4, A[1] + 18, A[2] - 8, A[3] - 22, 0, wd.W, 0, wd.H);
    D.frame(ctx, A[0], A[1], A[2], A[3], C.white); D.arena(ctx, v, wd, { curtain: false });
    if (learned) {
      for (i = 0; i <= TA; i++) tr.push(L6.stateAt(env.TE, EX, i));
      fan = [tr.concat(ev.paths[EX].slice(1))]; tr = tr.concat(env.study(q.off).truth[EX].slice(1)); k += TA;
      D.dot(ctx, v.X(tr[TA][0]), v.Y(tr[TA][1]), 3.5, C.red, C.white);
    } else { tr = env.lab(q.world).truth[EX]; fan = env.fan(q); }
    trace(ctx, v, tr, tr.length - 1, 'rgba(8,145,178,0.3)', 1); trace(ctx, v, tr, k, C.cyan, 2);
    fan.forEach(function (f) { trace(ctx, v, f, k, C.amber, 1.2); D.dot(ctx, v.X(f[k][0]), v.Y(f[k][1]), 2.5, C.amber, C.white); });
    D.dot(ctx, v.X(tr[k][0]), v.Y(tr[k][1]), Math.max(3, 0.1 * v.s), C.cyan, C.white);
    D.mono(ctx, learned ? 'launch ' + EX + ', nudge at the red dot' : 'launch ' + EX + ': 12 copies started ' + UI.EPSL[q.eps + 4] + ' wrong', A[0] + 8, A[1] + 10, C.mute, 9);
  }
  function curves(ctx, B) {                                       // panel B: median error against k (log axis), the recursion, the tolerance, the horizon
    var x0 = B[0] + 46, x1 = B[0] + B[2] - 14, y0 = B[1] + 50, y1 = B[1] + B[3] - 30, learned = q.world === 'learned', col = learned ? UI.KC[q.kind] : C.amber, lx = 8, ly = 25, wd;
    var X = function (k) { return x0 + k / K * (x1 - x0); }, Y = function (e) { return y1 - rad(e, y1 - y0); };
    function line(arr, c, w, dash) { var pts = [], k; for (k = arr[0] > 0 ? 0 : 1; k <= K; k++) pts.push([X(k), Y(arr[k])]); D.path(ctx, pts, c, w, dash); }
    D.frame(ctx, B[0], B[1], B[2], B[3], C.white);
    [[1e-5, '10 µm'], [1e-4, '0.1 mm'], [1e-3, '1 mm'], [1e-2, '1 cm'], [1e-1, '10 cm'], [1, '1 m'], [10, '10 m']].forEach(function (g) { D.line(ctx, x0, Y(g[0]), x1, Y(g[0]), C.grid, 1); D.mono(ctx, g[1], x0 - 5, Y(g[0]), C.mute, 9, 'right'); });
    [0, 20, 40, 60, 80].forEach(function (g) { D.mono(ctx, g + '', X(g), y1 + 11, C.mute, 9, 'center'); });
    D.mono(ctx, 'steps k (0.1 s each)', (x0 + x1) / 2, y1 + 24, C.mute, 9, 'center');
    D.mono(ctx, 'median error, 100 launches (solid); recursion (dashed)', B[0] + 8, B[1] + 11, C.mute, 9);
    if (learned) Object.keys(env.nets).forEach(function (kd) {
      if (kd !== q.kind) line(env.series({ world: 'learned', kind: kd, off: q.off, m: q.m }).med, UI.KC[kd], 1.2);
      wd = UI.KN[kd].length * 6 + 14; if (lx + wd > B[2]) { lx = 8; ly += 11; }
      D.mono(ctx, UI.KN[kd], B[0] + lx, B[1] + ly, UI.KC[kd], 9); lx += wd;
    });
    if (q.m) line(env.series({ world: q.world, kind: q.kind, off: q.off, eps: q.eps, m: 0 }).med, C.dim, 1.2);
    line(ev.med, col, 2.8); line(ev.lin, C.purple, 1.5, [5, 3]);
    D.line(ctx, x0, Y(tau), x1, Y(tau), C.red, 1.2, [6, 4]); D.mono(ctx, 'tolerance ' + UI.TAUL[q.tau], x0 + 6, Y(tau) - 7, C.red, 9);
    if (h >= 0) { D.line(ctx, X(h), y0, X(h), y1, C.red, 1, [2, 3]); D.label(ctx, 'H = ' + h, X(h) + 4, y0 + 8, C.red, 10); }
    D.line(ctx, X(q.k), y0, X(q.k), y1, C.ink, 1); D.dot(ctx, X(q.k), Y(ev.med[q.k]), 4, col, C.ink);
  }
  function target(ctx, T) {                                       // panel C: one dot per launch at its error from the true position (log radius)
    var tru = q.world === 'learned' ? env.study(q.off).truth : env.lab(q.world).truth, cx = T[0] + T[2] / 2, cy = T[1] + T[3] / 2 + 8, R = Math.min(T[2], T[3]) / 2 - 22, k = q.k, i, x, y, r, d;
    D.frame(ctx, T[0], T[1], T[2], T[3], C.white);
    [[1e-3, '1 mm'], [1e-2, '1 cm'], [1e-1, '10 cm'], [1, '1 m']].forEach(function (g) { ring(ctx, cx, cy, rad(g[0], R), C.grid, 1); D.mono(ctx, g[1], cx + 3, cy - rad(g[0], R) + 6, C.mute, 9); });
    ring(ctx, cx, cy, rad(tau, R), C.red, 1.5, [5, 3]); ring(ctx, cx, cy, rad(ev.med[k], R), C.amber, 2.2);
    for (i = 0; i < ev.paths.length; i++) {
      x = ev.paths[i][k][0] - tru[i][k][0]; y = ev.paths[i][k][1] - tru[i][k][1]; d = Math.hypot(x, y) || 1e-12; r = rad(d, R) / d;
      D.dot(ctx, cx + r * x, cy - r * y, 2.2, 'rgba(8,145,178,0.65)');
    }
    D.mono(ctx, 'one dot per launch, step ' + k + ' (log radius)', T[0] + 8, T[1] + 11, C.mute, 9);
  }
  var cw = cv.clientWidth, narrow = cw < 600, aw = narrow ? cw - 16 : Math.round(cw * 0.38), ah = Math.round(aw * 0.625) + 22;
  cv.style.height = (narrow ? ah + 700 : 520) + 'px';
  var S = D.setup(cv), ctx = S.ctx;
  arena(ctx, [8, 8, aw, ah]);
  curves(ctx, narrow ? [8, ah + 16, S.w - 16, 300] : [aw + 22, 8, S.w - aw - 30, S.h - 16]);
  target(ctx, narrow ? [8, ah + 324, S.w - 16, 360] : [8, ah + 16, aw, S.h - ah - 24]);
};

root.L6 = L6;
if (typeof module !== 'undefined' && module.exports) module.exports = L6;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
