/* l15_contact.js — bodies and contact (World Models, lesson 15).  Everything the lesson's widget computes lives here; the page script only draws and wires
 * controls.  Needs courtyard.js (CY).  Deterministic (seeded generators only).  Node: module.exports.
 *
 *   wall      one axis of the Courtyard (walls are axis-aligned, so x and y never interact: the x-axis is exactly a ball in a corridor 8 m long).  A step maps (p, v)
 *             to (p', v') through CY.step; a wall hit reverses the velocity (v' = -e D v) inside ONE step, so the map is a jump along the line d = G v
 *             (d: distance to the wall ahead, D = e^(-gamma dt): decay per step, G = (1 - D)/gamma: glide per step).  L15.wallLog is a log of launched balls with one nudge
 *             (like lesson 6's log, with random nudges), each transition carrying the TOUCH label c: 0 free, +1 the upper wall pushed back, -1 the lower wall did.
 *             L15.WallNet: a smooth model (tanh MLP 2-12-12-2, Adam).  L15.WallHybrid: a mode (free / upper wall / lower wall) chosen by logistic regression on
 *             (1, p, v) fitted to the touch labels, and one linear law per mode fitted by least squares: the discontinuity is moved into a comparison of two numbers.
 *   block     a block of mass m on a table, normal force N = m g, pushed by a force F held for Tp steps and then released.  Coulomb friction: it holds (stick) while
 *             v = 0 and F <= mu_s N, and slides with a friction force mu_k N otherwise.  L15.blockStep is the exact step (breakaway and stop inside a step included).
 *             Two blocks that look alike, A (1 kg) and B (2 kg).  Models see the camera (v, F) or the camera plus touch (the normal force N from a load cell):
 *             L15.BlockSmooth (tanh MLP) and L15.BlockHybrid (mode stuck/slipping, linear laws in the normalised force u = F/N, a logistic switch on u).
 *   planner   L15.plan: CEM (CY.cem) over a push (F, Tp), the cost being the words: "to the mark" (miss / 5 cm), "gently" (+ 2 F / F_max), "briefly" (+ 2 Tp / Tp_max).
 *   decoy     L15.t1: lesson 1's nudge task on the plain Courtyard, closed loop with one-axis models (best of K nudges by imagined miss, executed in the true world).
 *   widget    L15.sweep, L15.planCount, L15.nearRms, L15.wrongModes, L15.nudgeTest, WallNet.copy: the computations behind the readouts.
 *   canvas    L15.draw(canvas, state): the five panels of the widget (all text goes through CY.draw.mono, which shrinks and truncates at the canvas edge); the page owns the state.
 */
(function (root) {
'use strict';
var CY = root.CY || (typeof require !== 'undefined' ? require('./courtyard.js') : null);
var L15 = {};

/* ───────────────────────────── the wall: one axis of the Courtyard ───────────────────────────── */
var WW = CY.world({ curtain: null });
var DEC = Math.exp(-WW.gamma * WW.dt), GLD = (1 - DEC) / WW.gamma;           // free flight on one axis: p' = p + GLD v, v' = DEC v
L15.WW = WW; L15.DEC = DEC; L15.GLD = GLD; L15.E = WW.e;
L15.AX = { x: { lo: WW.r, hi: WW.W - WW.r, mid: WW.W / 2, half: WW.W / 2 }, y: { lo: WW.r, hi: WW.H - WW.r, mid: WW.H / 2, half: WW.H / 2 } };
L15.axisStep = function (ax, p, v) {                                          // the true one-axis step: CY.step with the other axis at rest
  var q = CY.step(WW, ax === 'x' ? [p, 2.5, v, 0] : [4, p, 0, v], null);
  return ax === 'x' ? [q[0], q[2]] : [q[1], q[3]];
};
L15.wallLog = function (nLaunch, seed) {                                      // launches with one random nudge (|a| <= 3) at step 12, 93 steps each; both axes, with touch labels
  var r = CY.rng(seed), out = { x: [], y: [] }, i, t, k, ax;
  for (i = 0; i < nLaunch; i++) {
    var s = CY.launch(WW, r), an = 2 * Math.PI * r(), am = 3 * Math.sqrt(r());
    for (t = 0; t < 93; t++) {
      var sin = t === 12 ? [s[0], s[1], s[2] + am * Math.cos(an), s[3] + am * Math.sin(an)] : s, q = CY.step(WW, sin, null);
      for (k = 0; k < 2; k++) {
        ax = k === 0 ? 'x' : 'y';
        var p = sin[k], v = sin[2 + k], v1 = q[2 + k];
        out[ax].push({ p: p, v: v, p1: q[k], v1: v1, c: Math.abs(v1 - DEC * v) < 1e-9 ? 0 : (v > 0 ? 1 : -1) });
      }
      s = q;
    }
  }
  return out;
};
L15.wallDist = function (ax, s) { return s.v > 0 ? L15.AX[ax].hi - s.p : s.p - L15.AX[ax].lo; };     // distance to the wall AHEAD

/* a smooth model: tanh MLP, input (position, velocity) scaled to about [-1, 1], output (change of position, change of velocity) */
L15.WallNet = function (ax, seed) { this.ax = ax; this.seed = seed; this.net = new CY.MLP([2, 12, 12, 2], seed); this.epochs = 0; this.stage = 0; };
L15.WallNet.prototype.feat = function (p, v) { var a = L15.AX[this.ax]; return [(p - a.mid) / a.half, v / 3]; };
L15.WallNet.prototype.train = function (log, epochs, lr) {                     // one stage of Adam; the standard schedule is three stages of 40 epochs at lr .01, .003, .001
  var self = this, X = log.map(function (s) { return self.feat(s.p, s.v); }), Y = log.map(function (s) { return [(s.p1 - s.p) / 0.5, s.v1 - s.v]; });
  this.net.fit(X, Y, { epochs: epochs, batch: 32, lr: lr, seed: this.seed + 10 * this.stage++ });
  this.epochs += epochs; return this;
};
L15.WallNet.prototype.trainStd = function (log) { var self = this; self.stage = 0; [0.01, 0.003, 0.001].forEach(function (lr) { self.train(log, 40, lr); }); return self; };
L15.WallNet.prototype.pred = function (p, v) { var o = this.net.predict(this.feat(p, v)); return [p + 0.5 * o[0], v + o[1]]; };

/* a hybrid: the mode is chosen by a comparison of two numbers, then a LINEAR law of that mode applies.  Mode labels come from touch. */
function fitLogistic(Z, y, lam) {                                              // Newton's method on the logistic loss, ridge on the slopes; Z rows (1, z1, z2)
  var w = [0, 0, 0], it, i, a, b, n = Z.length;
  for (it = 0; it < 40; it++) {
    var g = [0, 0, 0], H = [0, 0, 0, 0, 0, 0, 0, 0, 0];
    for (i = 0; i < n; i++) {
      var t = w[0] * Z[i][0] + w[1] * Z[i][1] + w[2] * Z[i][2], p = 1 / (1 + Math.exp(-t)), d = p - y[i], h = Math.max(p * (1 - p), 1e-9);
      for (a = 0; a < 3; a++) { g[a] += d * Z[i][a]; for (b = 0; b < 3; b++) H[a * 3 + b] += h * Z[i][a] * Z[i][b]; }
    }
    for (a = 1; a < 3; a++) { g[a] += lam * w[a]; H[a * 3 + a] += lam; }
    H[0] += 1e-9;
    var st = CY.la.solve(H, g, 3); if (!st) break;
    var mx = 0; for (a = 0; a < 3; a++) { w[a] -= st[a]; mx = Math.max(mx, Math.abs(st[a])); }
    if (mx < 1e-9) break;
  }
  return w;
}
L15.WallHybrid = function (ax, log, lam) {
  var a = L15.AX[ax], self = this;
  lam = lam === undefined ? 1e-5 : lam;
  this.ax = ax; this.law = {};
  [0, 1, -1].forEach(function (m) {                                            // one linear law per mode: (p', v') = coefficients . (1, p, v)
    var S = log.filter(function (s) { return s.c === m; });
    var Phi = new Float64Array(S.length * 3), Y = new Float64Array(S.length * 2);
    S.forEach(function (s, i) { Phi[i * 3] = 1; Phi[i * 3 + 1] = s.p; Phi[i * 3 + 2] = s.v; Y[i * 2] = s.p1; Y[i * 2 + 1] = s.v1; });
    self.law[m] = S.length >= 3 ? CY.la.ridge(Phi, S.length, 3, Y, 2, 1e-9) : null;
  });
  var Z = log.map(function (s) { return [1, (s.p - a.mid) / a.half, s.v / 3]; });
  this.wUp = fitLogistic(Z, log.map(function (s) { return s.c === 1 ? 1 : 0; }), lam);
  this.wDn = fitLogistic(Z, log.map(function (s) { return s.c === -1 ? 1 : 0; }), lam);
};
L15.WallHybrid.prototype.mode = function (p, v) {
  var a = L15.AX[this.ax], z0 = (p - a.mid) / a.half, z1 = v / 3, u = this.wUp, d = this.wDn;
  if (u[0] + u[1] * z0 + u[2] * z1 > 0) return 1;
  return d[0] + d[1] * z0 + d[2] * z1 > 0 ? -1 : 0;
};
L15.WallHybrid.prototype.pred = function (p, v) {
  var L = this.law[this.mode(p, v)] || this.law[0];
  return [L[0] + L[2] * p + L[4] * v, L[1] + L[3] * p + L[5] * v];
};
L15.WallHybrid.prototype.boundary = function (v) {                             // distance to the upper wall at which the classifier switches to "bounce", at approach speed v
  for (var d = 0.8; d >= 0; d -= 0.0005) if (this.mode(L15.AX[this.ax].hi - d, v) === 1) return d;
  return null;
};
L15.wallTrue = function (ax, v, d) { return L15.axisStep(ax, L15.AX[ax].hi - d, v)[1]; };    // the true next velocity of a ball d from the upper wall, moving at v
L15.softWidth = function (pred, ax, v) {                                       // 10 % to 90 % width of the transition of the predicted next velocity, scanning toward the wall
  var hi = DEC * v, lo = -WW.e * DEC * v, d10 = null, d90 = null, d, f;
  for (d = 0.9; d >= -0.1; d -= 0.002) {
    f = (hi - pred(L15.AX[ax].hi - d, v)[1]) / (hi - lo);
    if (f > 0.1 && d10 === null) d10 = d;
    if (f > 0.9) { d90 = d; break; }
  }
  return d10 !== null && d90 !== null ? d10 - d90 : null;
};
L15.WALL_BINS = [[0, 0.1], [0.1, 0.2], [0.2, 0.3], [0.3, 0.5], [0.5, 1], [1, 99]];
L15.wallErrors = function (pred, ax, log) {                                    // RMS error of the next velocity, by contact / by distance to the wall ahead (balls faster than 0.3 m/s)
  var bins = L15.WALL_BINS.map(function () { return [0, 0]; }), con = [0, 0], tot = [0, 0], i;
  var medC = [];
  for (i = 0; i < log.length; i++) {
    var s = log[i], e = pred(s.p, s.v)[1] - s.v1; tot[0] += e * e; tot[1]++;
    if (s.c) { con[0] += e * e; con[1]++; medC.push(Math.abs(e)); }
    if (Math.abs(s.v) > 0.3) { var d = L15.wallDist(ax, s); for (var b = 0; b < bins.length; b++) if (d >= L15.WALL_BINS[b][0] && d < L15.WALL_BINS[b][1]) { bins[b][0] += e * e; bins[b][1]++; } }
  }
  medC.sort(function (a, b) { return a - b; });
  return { contact: Math.sqrt(con[0] / con[1]), nContact: con[1], all: Math.sqrt(tot[0] / tot[1]), nAll: tot[1], share: con[0] / tot[0],
           medianContact: medC.length ? medC[Math.floor(medC.length / 2)] : 0,
           bins: bins.map(function (q) { return q[1] ? Math.sqrt(q[0] / q[1]) : NaN; }), counts: bins.map(function (q) { return q[1]; }) };
};

/* ───────────────────────────── the block: Coulomb friction ───────────────────────────── */
var G0 = 9.81, DTB = 0.05, MUS = 0.5, MUK = 0.3, FMAX = 12, TPB = 6, TMAX = 10;
L15.G0 = G0; L15.DTB = DTB; L15.MUS = MUS; L15.MUK = MUK; L15.FMAX = FMAX; L15.TPB = TPB; L15.TMAX = TMAX;
L15.BLK = { A: { m: 1 }, B: { m: 2 } };
L15.blockStep = function (m, x, v, F) {                                        // exact Coulomb step: push F >= 0 held over the step; returns [x', v', f], f = friction force on the block
  var N = m * G0, Fs = MUS * N, Fk = MUK * N, a;
  if (v === 0) {
    if (F <= Fs) return [x, 0, F];                                             // stick: static friction balances the push
    a = (F - Fk) / m; return [x + 0.5 * a * DTB * DTB, a * DTB, Fk];          // breakaway: kinetic friction from the first instant
  }
  a = (F - Fk) / m;
  if (a >= 0 || v + a * DTB > 0) return [x + v * DTB + 0.5 * a * DTB * DTB, v + a * DTB, Fk];
  var ts = -v / a;                                                             // it stops inside the step
  return [x + v * ts + 0.5 * a * ts * ts, 0, Fk];
};
L15.blockPush = function (m, F, Tp, T) {                                       // true trajectory of "push F for Tp steps, then release", T steps in all
  var x = 0, v = 0, X = [0], V = [0], FF = [], t, o;
  for (t = 0; t < T; t++) { o = L15.blockStep(m, x, v, t < Tp ? F : 0); x = o[0]; v = o[1]; X.push(x); V.push(v); FF.push(o[2]); }
  return { X: X, V: V, F: FF };
};
L15.blockFinal = function (m, F, Tp) {                                         // closed form of the same thing (stick below mu_s N; else a push of Tp steps then a slide to rest)
  var N = m * G0, Fs = MUS * N, Fk = MUK * N;
  if (F <= Fs) return 0;
  var a = (F - Fk) / m, T = Tp * DTB, v1 = a * T;
  return 0.5 * a * T * T + v1 * v1 / (2 * Fk / m);
};
L15.blockLog = function (nPer, seed) {                                         // push-and-release episodes, blocks alternating A, B; F ~ U(0, 12) N, Tp ~ {3..10} steps, 40 steps each
  var r = CY.rng(seed), S = [], e, t;
  for (e = 0; e < nPer * 2; e++) {
    var blk = e % 2 === 0 ? 'A' : 'B', m = L15.BLK[blk].m, F = FMAX * r(), Tp = 3 + Math.floor(8 * r()), x = 0, v = 0;
    for (t = 0; t < 40; t++) {
      var Fa = t < Tp ? F : 0, o = L15.blockStep(m, x, v, Fa);
      S.push({ blk: blk, N: m * G0, v: v, F: Fa, dv: o[1] - v, dx: o[0] - x, f: o[2], slip0: v > 0 ? 1 : 0, slip1: o[1] > 0 ? 1 : 0 });
      x = o[0]; v = o[1];
    }
  }
  return S;
};

/* a smooth model of the block: tanh MLP, input (v, F[, N]), output (change of velocity, change of position, friction force felt) */
L15.BlockSmooth = function (touch, seed) { this.touch = touch; this.seed = seed; this.net = new CY.MLP([touch ? 3 : 2, 12, 12, 3], seed); };
L15.BlockSmooth.prototype.feat = function (s) { return this.touch ? [s.v / 1.5, s.F / 7, s.N / 20] : [s.v / 1.5, s.F / 7]; };
L15.BlockSmooth.prototype.train = function (log) {
  var self = this; this.net = new CY.MLP([this.touch ? 3 : 2, 12, 12, 3], this.seed);
  var X = log.map(function (s) { return self.feat(s); }), Y = log.map(function (s) { return [s.dv / 0.5, s.dx / 0.05, s.f / 7]; });
  [0.01, 0.003, 0.001].forEach(function (lr, i) { self.net.fit(X, Y, { epochs: 20, batch: 32, lr: lr, seed: self.seed + i }); });
  return this;
};
L15.BlockSmooth.prototype.step = function (blk, x, v, F) {
  var o = this.net.predict(this.feat({ v: v, F: F, N: L15.BLK[blk].m * G0 }));
  return [x + o[1] * 0.05, Math.max(0, v + o[0] * 0.5), o[2] * 7];
};

/* a hybrid model of the block: the mode (stuck or slipping) is read from v; slipping follows one linear law in (v, q), stuck is rest; a stuck block starts to slip
 * when a logistic switch on q is confident.  q is the normalised force F/N when the touch channel gives N, and the raw force F when only the camera is there. */
L15.BlockHybrid = function (touch, log) {                                      // with touch the friction law is fitted per unit of N: f / N is linear in (v, q)
  var q = function (s) { return touch ? s.F / s.N : s.F; }, sc = touch ? 2 : 0.2, i;
  var slip = log.filter(function (s) { return s.slip0 && s.slip1; }), stuck = log.filter(function (s) { return !s.slip0; });
  var Phi = new Float64Array(slip.length * 3), Y = new Float64Array(slip.length * 3);
  slip.forEach(function (s, i) { Phi[i * 3] = 1; Phi[i * 3 + 1] = s.v; Phi[i * 3 + 2] = q(s); Y[i * 3] = s.dv; Y[i * 3 + 1] = s.dx; Y[i * 3 + 2] = touch ? s.f / s.N : s.f; });
  this.touch = touch; this.sc = sc; this.law = CY.la.ridge(Phi, slip.length, 3, Y, 3, 1e-9);
  var w = [0, 0], g, H, t, p, d, h, st, a, b;
  for (var it = 0; it < 60; it++) {                                            // 1-D logistic regression of "starts to slip" on q (Newton, ridge on the slope)
    g = [0, 0]; H = [0, 0, 0, 0];
    stuck.forEach(function (s) {
      var z = [1, q(s) * sc]; t = w[0] + w[1] * z[1]; p = 1 / (1 + Math.exp(-t)); d = p - s.slip1; h = Math.max(p * (1 - p), 1e-9);
      for (a = 0; a < 2; a++) { g[a] += d * z[a]; for (b = 0; b < 2; b++) H[a * 2 + b] += h * z[a] * z[b]; }
    });
    g[1] += 1e-4 * w[1]; H[3] += 1e-4; H[0] += 1e-9;
    st = CY.la.solve(H, g, 2); w[0] -= st[0]; w[1] -= st[1];
    if (Math.abs(st[0]) + Math.abs(st[1]) < 1e-10) break;
  }
  this.w = w; this.pthr = 0.9;
  this.theta = -w[0] / (w[1] * sc);                                            // where the switch is 50 % sure: the model's own estimate of mu_s (touch) or of the pooled breakaway force (camera)
  this.sharp = w[1] * sc;                                                      // its steepness per unit of q
};
L15.BlockHybrid.prototype.pStart = function (qq) { return 1 / (1 + Math.exp(-(this.w[0] + this.w[1] * qq * this.sc))); };
L15.BlockHybrid.prototype.act = function () { return this.theta + Math.log(this.pthr / (1 - this.pthr)) / this.sharp; };   // where the switch is pthr sure: the model lets a stuck block slip only from here (theta is where it is 50 % sure)
L15.BlockHybrid.prototype.mu = function () { var L = this.law; return { muk: -L[0] / (G0 * DTB), mus: this.theta }; };   // touch model only: law's constant term is -mu_k g dt
L15.BlockHybrid.prototype.step = function (blk, x, v, F) {
  var N = L15.BLK[blk].m * G0, qq = this.touch ? F / N : F, L = this.law;
  if (v === 0 && this.pStart(qq) < this.pthr) return [x, 0, F];                // stuck stays stuck unless the switch is confident
  var dv = L[0] + L[3] * v + L[6] * qq, dx = L[1] + L[4] * v + L[7] * qq, f = L[2] + L[5] * v + L[8] * qq;
  return [x + dx, Math.max(0, v + dv), this.touch ? f * N : f];
};
L15.blockRoll = function (model, blk, F, Tp, T) {                              // a model's imagined "push F for Tp steps, then release" (model.step(blk, x, v, F) -> [x', v', f])
  var x = 0, v = 0, X = [0], V = [0], FF = [], t, o;
  for (t = 0; t < T; t++) { o = model.step(blk, x, v, t < Tp ? F : 0); x = o[0]; v = o[1]; X.push(x); V.push(v); FF.push(o[2]); }
  return { X: X, V: V, F: FF };
};
L15.TROLL = 60;                                                                // steps rolled for a final distance: 3 s, long enough for every push to come to rest
L15.blockFinalModel = function (model, blk, F, Tp) { var X = L15.blockRoll(model, blk, F, Tp, L15.TROLL).X; return X[X.length - 1]; };

/* planning with words: CEM over a push (F, Tp); the cost is the sentence.  planner uses the model's imagined final distance. */
L15.WORDS = { none: 'to the mark', briefly: 'to the mark, briefly', gently: 'to the mark, gently' };
L15.wordCost = function (words, miss, F, Tp) {
  var c = miss / 0.05;                                                         // "to the mark": miss in units of the 5 cm tolerance
  if (words === 'gently') c += 2 * F / FMAX;                                   // "gently": the force costs
  else if (words === 'briefly') c += 2 * Tp / TMAX;                            // "briefly": the duration costs
  return c;
};
L15.plan = function (model, blk, xstar, words, seed) {
  var best = CY.cem(function (v) {
    var F = v[0], Tp = Math.max(2, Math.min(TMAX, Math.round(v[1])));
    return L15.wordCost(words, Math.abs(L15.blockFinalModel(model, blk, F, Tp) - xstar), F, Tp);
  }, 2, { iters: 8, pop: 80, elite: 12, mu0: [6, 6], sd0: [4, 3], clip: [0, FMAX], seed: seed || 11, minSd: 1e-3 }).best;
  return { F: best[0], Tp: Math.max(2, Math.min(TMAX, Math.round(best[1]))) };
};
L15.PLAN_TARGETS = [0.15, 0.25, 0.35];
L15.planSuite = function (model, words, seed) {                                // 3 marks x 2 blocks: success = the REAL block ends within 5 cm of the mark
  var out = [], blk, i;
  ['A', 'B'].forEach(function (blk) {
    L15.PLAN_TARGETS.forEach(function (xs) {
      var p = L15.plan(model, blk, xs, words, seed), real = L15.blockFinal(L15.BLK[blk].m, p.F, p.Tp);
      out.push({ blk: blk, xstar: xs, F: p.F, Tp: p.Tp, real: real, ok: Math.abs(real - xs) <= 0.05 });
    });
  });
  return out;
};

/* ───────────────────────────── the decoy: lesson 1's nudge task, closed loop ───────────────────────────── */
var TA = 12, TF = 80;
L15.t1Launches = function (n, seed) { var r = CY.rng(seed), out = [], i, t; for (i = 0; i < n; i++) { var s = CY.launch(WW, r); for (t = 0; t < TA; t++) s = CY.step(WW, s, null); out.push(s); } return out; };
L15.t1Cands = function (K, seed) { var r = CY.rng(seed), out = [], k; for (k = 0; k < K; k++) { var an = 2 * Math.PI * r(), am = 3 * Math.sqrt(r()); out.push([am * Math.cos(an), am * Math.sin(an)]); } return out; };
L15.t1Imagine = function (px, py, s, a) {                                      // px(p, v) -> [p', v'] on the x axis, py likewise on y: nudge, then 81 steps
  var x = s[0], y = s[1], vx = s[2] + a[0], vy = s[3] + a[1], t, o, q;
  for (t = 0; t <= TF; t++) { o = px(x, vx); q = py(y, vy); x = o[0]; vx = o[1]; y = q[0]; vy = q[1]; }
  return [x, y];
};
L15.t1 = function (px, py, launches, cands) {                                  // best of K by imagined miss; the chosen nudge is then executed in the TRUE world
  var succ = 0, imag = 0, real = 0, g = WW.goal, i, k;
  launches.forEach(function (s) {
    var best = Infinity, bk = 0;
    for (k = 0; k < cands.length; k++) { var f = L15.t1Imagine(px, py, s, cands[k]), m = Math.hypot(f[0] - g.x, f[1] - g.y); if (m < best) { best = m; bk = k; } }
    var q = CY.step(WW, s, cands[bk]); for (i = 0; i < TF; i++) q = CY.step(WW, q, null);
    var mr = Math.hypot(q[0] - g.x, q[1] - g.y); if (mr < g.r) succ++; imag += best; real += mr;
  });
  return { success: succ / launches.length, imagined: imag / launches.length, real: real / launches.length };
};
L15.frictionOnly = function (p, v) { return [p + GLD * v, DEC * v]; };       // the free-flight law and nothing else: no walls

/* ───────────────────────────── what the widget asks for ───────────────────────────── */
L15.WallNet.prototype.copy = function () {                                     // a frozen copy of the weights (prediction only)
  var c = new L15.WallNet(this.ax, this.seed), dup = function (A) { return A.map(function (a) { return Float64Array.from(a); }); };
  c.net.W = dup(this.net.W); c.net.b = dup(this.net.b); c.epochs = this.epochs; c.stage = this.stage; return c;
};
L15.nearRms = function (pred, ax, log) {                                       // RMS next-velocity error of balls within 0.5 m of the wall ahead (the first four distance bins)
  var e = L15.wallErrors(pred, ax, log), s = 0, n = 0, i;
  for (i = 0; i < 4; i++) { s += e.bins[i] * e.bins[i] * e.counts[i]; n += e.counts[i]; }
  return Math.sqrt(s / n);
};
L15.wrongModes = function (hyb, log) { var n = 0; log.forEach(function (s) { if (hyb.mode(s.p, s.v) !== s.c) n++; }); return n; };
L15.sweep = function (sm, hy) {                                                // final distance against push force (0 to 12 N, steps of 0.1 N), both blocks, truth / smooth / hybrid; mean absolute errors
  var o = { F: [], A: [[], [], []], B: [[], [], []], es: 0, eh: 0 }, k;
  for (k = 0; k <= 120; k++) {
    o.F.push(k / 10);
    ['A', 'B'].forEach(function (b) {
      var t = L15.blockFinal(L15.BLK[b].m, k / 10, L15.TPB), s = L15.blockFinalModel(sm, b, k / 10, L15.TPB), h = L15.blockFinalModel(hy, b, k / 10, L15.TPB);
      o[b][0].push(t); o[b][1].push(s); o[b][2].push(h); o.es += Math.abs(s - t) / 242; o.eh += Math.abs(h - t) / 242;
    });
  }
  return o;
};
L15.planCount = function (model, words, seed) { return L15.planSuite(model, words, seed).filter(function (x) { return x.ok; }).length; };
L15.nudgeTest = function (nx, hx, log, test) {                                 // lesson 1's nudge task, 60 launches, best of 128 imagined nudges; one-step RMS over both axes of the held-out log
  var ny = new L15.WallNet('y', 103).trainStd(log.y), hy = new L15.WallHybrid('y', log.y), L = L15.t1Launches(60, 5), K = L15.t1Cands(128, 1000);
  var one = function (px, py) {
    var r = L15.t1(px, py, L, K), a = L15.wallErrors(px, 'x', test.x), b = L15.wallErrors(py, 'y', test.y);
    return { success: r.success, rms: Math.sqrt((a.all * a.all * a.nAll + b.all * b.all * b.nAll) / (a.nAll + b.nAll)) };
  };
  return [one(L15.frictionOnly, L15.frictionOnly), one(function (p, v) { return nx.pred(p, v); }, function (p, v) { return ny.pred(p, v); }), one(function (p, v) { return hx.pred(p, v); }, function (p, v) { return hy.pred(p, v); })];
};

/* ───────────────────────────── the widget's canvas: drawing only, the page owns the state ───────────────────────────── */
function boxes(w) {                                                    // three panels over two on a wide canvas, five stacked below 760 px
  var c1 = Math.round(w * 0.34), c2 = Math.round((w - c1 - 40) / 2), h2 = Math.round(w / 2), i, b = [];
  if (w < 760) { for (i = 0; i < 5; i++) b.push([8, 8 + i * 204, w - 16, 190]); return b; }
  return [[8, 8, c1, 270], [c1 + 22, 8, c2, 270], [c1 + c2 + 36, 8, w - c1 - c2 - 44, 270], [8, 296, h2 - 14, 256], [h2 + 6, 296, w - h2 - 14, 256]];
}
function panel(ctx, b, title, x0, x1, y0, y1, xt, yt, xl, fmt) {         // a framed plot with ticks; returns the data-to-pixel maps
  var D = CY.draw, C = CY.C, L = b[0] + 38, T = b[1] + 26, W = b[2] - 50, H = b[3] - 56;
  var m = { L: L, T: T, W: W, H: H, X: function (x) { return L + (x - x0) / (x1 - x0) * W; }, Y: function (y) { return T + H - (y - y0) / (y1 - y0) * H; } };
  D.frame(ctx, b[0], b[1], b[2], b[3], C.white); D.mono(ctx, title, b[0] + 8, b[1] + 12, C.mute, 9);
  D.line(ctx, L, T + H, L + W, T + H, C.dim, 1); D.line(ctx, L, T, L, T + H, C.dim, 1);
  xt.forEach(function (t) { D.line(ctx, m.X(t), T, m.X(t), T + H, C.grid, 1); D.mono(ctx, fmt ? fmt(t) : t + '', m.X(t), T + H + 10, C.mute, 9, 'center'); });
  yt.forEach(function (t) { D.line(ctx, L, m.Y(t), L + W, m.Y(t), C.grid, 1); D.mono(ctx, t + '', L - 4, m.Y(t), C.mute, 9, 'right'); });
  D.mono(ctx, xl, L + W / 2, T + H + 24, C.mute, 9, 'center');
  return m;
}
function curves(ctx, m, xs, ys) {                                      // truth (ink), hybrid (amber), smooth (purple, once trained)
  var D = CY.draw, C = CY.C, pts = function (a) { return xs.map(function (x, i) { return [m.X(x), m.Y(a[i])]; }); };
  D.path(ctx, pts(ys[0]), C.ink, 3); D.path(ctx, pts(ys[2]), C.amber, 1.6); if (ys[1] && ys[1].length) D.path(ctx, pts(ys[1]), C.purple, 2);
}
L15.draw = function (cv, S) {                                          // S: F (N), v (m/s), blk, M {s, h} block models, sw sweep or null, log wall log (x axis), net trained wall net or null, hyb wall hybrid
  cv.style.height = (cv.clientWidth < 760 ? 1020 : 560) + 'px';
  var D = CY.draw, C = CY.C, XR = L15.AX.x.hi, g = D.setup(cv), ctx = g.ctx, b = boxes(g.w), v = S.v, F = S.F, blk = S.blk, i;
  var m = panel(ctx, b[0], 'v′ against wall distance, ball at ' + v.toFixed(1) + ' m/s', 0.7, 0, -3.2, 3.2, [0.7, 0.5, 0.3, 0.1, 0], [-2, 0, 2], 'distance d to the wall (cm)', function (t) { return Math.round(t * 100) + ''; });
  S.log.forEach(function (s) { if (s.v > 0 && Math.abs(s.v - v) < 0.35 && XR - s.p < 0.7) D.dot(ctx, m.X(XR - s.p), m.Y(s.v1), 2, s.c ? C.red : C.cyan); });
  var ds = [], tv = [], hv = [], sv = [];
  for (i = 0; i <= 140; i++) { var d = 0.7 - i * 0.005; ds.push(d); tv.push(L15.wallTrue('x', v, d)); hv.push(S.hyb.pred(XR - d, v)[1]); if (S.net) sv.push(S.net.pred(XR - d, v)[1]); }
  D.line(ctx, m.X(GLD * v), m.T, m.X(GLD * v), m.T + m.H, C.dim, 1, [3, 3]);
  curves(ctx, m, ds, [tv, sv, hv]);
  [['A', 1.8, [0, 0.5, 1, 1.5]], ['B', 0.3, [0, 0.1, 0.2, 0.3]]].forEach(function (q, j) {
    var mf = panel(ctx, b[1 + j], 'block ' + q[0] + ' (' + L15.BLK[q[0]].m + ' kg): where it stops (m)', 0, 12, 0, q[1], [0, 3, 6, 9, 12], q[2], 'push force F (N)'), xs = mf.X(MUS * L15.BLK[q[0]].m * G0);
    D.line(ctx, xs, mf.T, xs, mf.T + mf.H, C.dim, 1, [3, 3]);
    if (S.sw) curves(ctx, mf, S.sw.F, S.sw[q[0]]); else D.mono(ctx, 'training the block networks ...', mf.L + 8, mf.T + 14, C.purple, 9);
    D.line(ctx, mf.X(F), mf.T, mf.X(F), mf.T + mf.H, C.cyan, 1.4);
  });
  var T = 40, tt = L15.blockPush(L15.BLK[blk].m, F, TPB, T), th = L15.blockRoll(S.M.h, blk, F, TPB, T), ts = S.M.s ? L15.blockRoll(S.M.s, blk, F, TPB, T) : null, tx = [];
  for (i = 0; i <= T; i++) tx.push(i * DTB);
  var xmax = Math.max(0.12, tt.X[T], th.X[T], ts ? ts.X[T] : 0) * 1.1, cmv = function (a) { return a.map(function (x) { return 100 * x; }); }, rep = function (a) { return a.concat([a[a.length - 1]]); };
  var mx = panel(ctx, b[3], 'block ' + blk + ', F = ' + F.toFixed(2) + ' N for 0.3 s: position (cm)', 0, 2, 0, 100 * xmax, [0, 0.5, 1, 1.5, 2], [0, Math.round(50 * xmax), Math.round(100 * xmax)], 'time (s)');
  curves(ctx, mx, tx, [cmv(tt.X), ts ? cmv(ts.X) : null, cmv(th.X)]);
  var mo = panel(ctx, b[4], 'friction force (N); dashed: the push', 0, 2, 0, 14, [0, 0.5, 1, 1.5, 2], [0, 5, 10], 'time (s)');
  curves(ctx, mo, tx, [rep(tt.F), ts ? rep(ts.F) : null, rep(th.F)]);
  D.line(ctx, mo.X(0), mo.Y(F), mo.X(TPB * DTB), mo.Y(F), C.cyan, 1.4, [4, 3]);
};

if (typeof module !== 'undefined' && module.exports) module.exports = L15;
root.L15 = L15;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
