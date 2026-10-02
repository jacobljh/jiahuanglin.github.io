/* l08_imagine.js — practice in imagination, on the nudge task of the Courtyard (World Models, lesson 08).
 *
 * Everything the lesson's widget computes and draws lives here (L8.paint draws the four panels); the page script keeps the caches, the readouts and the controls.
 *   task      lesson 1's nudge: a launched ball, ONE impulse a (|a| <= 3 m/s) at step 12, then 80 more steps; ending(s, a) is where the ball stops
 *   reward    a bump around the goal, exp(-1/2 (miss / 0.5)^2); a "hit" is a miss under the goal radius
 *   log       trials of a cautious operator: the nudge is uniform in a disc of radius `range` (the actuator allows 3)
 *   model     an ensemble of tanh MLPs, (state at the nudge, nudge) -> ending position.  The ensemble MEAN is the model; the largest deviation of a
 *             member from the mean, u, is its uncertainty.  (This is lesson 1's M, learned from a log instead of given.)
 *   policy    a = clip(A (s - s0) + b): ten numbers, a linear map from the state to a nudge
 *   optimiser CEM over the ten numbers.  Score = imagined return - lambda * mean(u).  Optionally, every few generations the current policy is run
 *             in the world on fresh launches, those trials join the log and the ensemble is refit (the Dyna loop).
 * Deterministic: seeded generators only.  Needs courtyard.js (CY).  Node: module.exports.
 */
(function (root) {
'use strict';
var CY = root.CY || (typeof require !== 'undefined' ? require('./courtyard.js') : null);
var L8 = {};
var W0 = CY.world({}), TA = 12, TF = 80, AMAX = 3, GOAL = W0.goal, SBAR = [3.5, 2.5, 1.5, 0], RSIG = 0.5;
L8.TA = TA; L8.TF = TF; L8.AMAX = AMAX; L8.GOAL = GOAL; L8.W0 = W0;

/* ───────────── the task ───────────── */
L8.launches = function (n, seed) {                                // n launches rolled to the nudge time: the state s = [x, y, vx, vy] the policy is handed
  var r = CY.rng(seed), out = [], i, t, s;
  for (i = 0; i < n; i++) { s = CY.launch(W0, r); for (t = 0; t < TA; t++) s = CY.step(W0, s, null); out.push(s); }
  return out;
};
L8.ending = function (s, a) {                                     // the world: the nudge, then everything coasts
  var q = CY.step(W0, s, a);
  for (var u = 0; u < TF; u++) q = CY.step(W0, q, null);
  return q;
};
L8.launchPaths = function (n, seed) {                              // the same launches as L8.launches, with the positions of steps 0..12 (to draw where the ball came from)
  var r = CY.rng(seed), out = [], i, t, s, pts;
  for (i = 0; i < n; i++) { s = CY.launch(W0, r); pts = [[s[0], s[1]]]; for (t = 0; t < TA; t++) { s = CY.step(W0, s, null); pts.push([s[0], s[1]]); } out.push(pts); }
  return out;
};
L8.path = function (s, a) {                                       // positions along the ending: the nudge step, then the coast
  var q = CY.step(W0, s, a), pts = [[s[0], s[1]], [q[0], q[1]]];
  for (var u = 0; u < TF; u++) { q = CY.step(W0, q, null); pts.push([q[0], q[1]]); }
  return pts;
};
L8.bump = function (miss) { return Math.exp(-0.5 * (miss / RSIG) * (miss / RSIG)); };
L8.miss = function (x, y, goal) { goal = goal || GOAL; return Math.hypot(x - goal.x, y - goal.y); };

/* ───────────── the policy: ten numbers ───────────── */
L8.nudge = function (th, s) {
  var f0 = s[0] - SBAR[0], f1 = s[1] - SBAR[1], f2 = s[2] - SBAR[2], f3 = s[3] - SBAR[3];
  var ax = th[4] + th[0] * f0 + th[1] * f1 + th[2] * f2 + th[3] * f3, ay = th[9] + th[5] * f0 + th[6] * f1 + th[7] * f2 + th[8] * f3;
  var n = Math.hypot(ax, ay);
  if (n > AMAX) { ax *= AMAX / n; ay *= AMAX / n; }
  return [ax, ay];
};

/* ───────────── the log ───────────── */
L8.makeLog = function (n, range, seed) {                          // n real trials: launch, random nudge inside the disc, record the ending
  var r = CY.rng(seed), S = [], A = [], E = [], i, s, an, am, a;
  for (i = 0; i < n; i++) {
    s = CY.launch(W0, r); for (var t = 0; t < TA; t++) s = CY.step(W0, s, null);
    an = 2 * Math.PI * r(); am = range * Math.sqrt(r()); a = [am * Math.cos(an), am * Math.sin(an)];
    S.push(s); A.push(a); E.push(L8.ending(s, a));
  }
  return { S: S, A: A, E: E, range: range };
};

/* ───────────── the model: an ensemble of MLPs ───────────── */
var FEAT = new Float64Array(6);
function feat(s, a) { FEAT[0] = (s[0] - 3.5) / 2; FEAT[1] = (s[1] - 2.5) / 1.5; FEAT[2] = s[2] - 1.5; FEAT[3] = s[3]; FEAT[4] = a[0]; FEAT[5] = a[1]; return FEAT; }
function Model(log, o) {
  o = o || {};
  this.M = o.M || 5; this.H = o.H || 8; this.seed = o.seed || 500; this.epochs = o.epochs || 120; this.log = log; this.nets = [];
  for (var m = 0; m < this.M; m++) this.nets.push(new CY.MLP([6, this.H, this.H, 2], 11 + m));
  this.fit(0, this.epochs);
}
Model.prototype.fit = function (round, epochs) {                   // every member sees its own bootstrap resample of the log
  var N = this.log.S.length, X = [], Y = [], i, m, k;
  for (i = 0; i < N; i++) { X.push(Array.from(feat(this.log.S[i], this.log.A[i]))); Y.push([(this.log.E[i][0] - 4) / 2, (this.log.E[i][1] - 2.5) / 1.5]); }
  for (m = 0; m < this.M; m++) {
    var rb = CY.rng(this.seed + m + 97 * round), Xb = [], Yb = [];
    for (i = 0; i < N; i++) { k = Math.floor(rb() * N); Xb.push(X[k]); Yb.push(Y[k]); }
    this.nets[m].fit(Xb, Yb, { epochs: epochs, lr: 0.02, batch: 32, seed: 3 + m + round });
  }
};
Model.prototype.clone = function () {
  var c = Object.create(Model.prototype), m, l;
  c.M = this.M; c.H = this.H; c.seed = this.seed; c.epochs = this.epochs; c.nets = [];
  c.log = { S: this.log.S.slice(), A: this.log.A.slice(), E: this.log.E.slice(), range: this.log.range };
  for (m = 0; m < this.M; m++) {
    var n = new CY.MLP([6, this.H, this.H, 2], 11 + m), o = this.nets[m];
    for (l = 0; l < o.L; l++) { n.W[l].set(o.W[l]); n.b[l].set(o.b[l]); n.mW[l].set(o.mW[l]); n.vW[l].set(o.vW[l]); n.mb[l].set(o.mb[l]); n.vb[l].set(o.vb[l]); }
    n.t = o.t; c.nets.push(n);
  }
  return c;
};
Model.prototype.add = function (S, A, E) { for (var i = 0; i < S.length; i++) { this.log.S.push(S[i]); this.log.A.push(A[i]); this.log.E.push(E[i]); } };
/* the ensemble's answer for (s, a): mean ending in metres and the largest deviation of a member from it; writes into out = {x, y, u, px, py} */
var H1 = new Float64Array(64), H2 = new Float64Array(64);
Model.prototype.predict = function (s, a, out) {
  var f = feat(s, a), M = this.M, H = this.H, mx = 0, my = 0, m, j, i, z;
  if (!this.px) { this.px = new Float64Array(M); this.py = new Float64Array(M); }
  for (m = 0; m < M; m++) {
    var n = this.nets[m], W1 = n.W[0], b1 = n.b[0], W2 = n.W[1], b2 = n.b[1], W3 = n.W[2], b3 = n.b[2];
    for (j = 0; j < H; j++) { z = b1[j]; for (i = 0; i < 6; i++) z += f[i] * W1[i * H + j]; H1[j] = Math.tanh(z); }
    for (j = 0; j < H; j++) { z = b2[j]; for (i = 0; i < H; i++) z += H1[i] * W2[i * H + j]; H2[j] = Math.tanh(z); }
    var ox = b3[0], oy = b3[1];
    for (i = 0; i < H; i++) { ox += H2[i] * W3[i * 2]; oy += H2[i] * W3[i * 2 + 1]; }
    this.px[m] = ox * 2 + 4; this.py[m] = oy * 1.5 + 2.5; mx += this.px[m] / M; my += this.py[m] / M;
  }
  var u = 0;
  for (m = 0; m < M; m++) u = Math.max(u, Math.hypot(this.px[m] - mx, this.py[m] - my));
  out = out || {}; out.x = mx; out.y = my; out.u = u; out.px = this.px; out.py = this.py;
  return out;
};
L8.Model = Model;

/* ───────────── scoring a policy ───────────── */
L8.imagined = function (model, th, S, lam, goal) {                 // what the model believes: return, hits, mean uncertainty, share of nudges outside the log
  var J = 0, h = 0, U = 0, out = 0, o = {}, i, a, mi;
  goal = goal || GOAL;
  for (i = 0; i < S.length; i++) {
    a = L8.nudge(th, S[i]); model.predict(S[i], a, o); mi = L8.miss(o.x, o.y, goal);
    J += L8.bump(mi); U += o.u; if (mi < goal.r) h++; if (Math.hypot(a[0], a[1]) > model.log.range) out++;
  }
  var n = S.length;
  return { J: J / n, hits: h / n, U: U / n, outside: out / n, score: J / n - (lam || 0) * U / n };
};
L8.real = function (th, S, goal) {                                 // what happens in the world
  var J = 0, h = 0, i, e, mi;
  goal = goal || GOAL;
  for (i = 0; i < S.length; i++) { e = L8.ending(S[i], L8.nudge(th, S[i])); mi = L8.miss(e[0], e[1], goal); J += L8.bump(mi); if (mi < goal.r) h++; }
  return { J: J / S.length, hits: h / S.length };
};

/* ───────────── the optimiser: CEM over the ten numbers ───────────── */
function CEM(o) {
  this.d = o.dim || 10; this.pop = o.pop || 48; this.el = o.elite || 8; this.rng = CY.rng(o.seed || 1); this.minSd = o.minSd || 0.01;
  this.mu = new Float64Array(this.d); this.sd = new Float64Array(this.d).fill(o.sd0 || 0.5);
}
CEM.prototype.step = function (obj) {                             // sample a population around mu, keep the best, refit mu and sd to them
  var c = [], i, j, v, m, s2;
  for (i = 0; i < this.pop; i++) {
    v = new Float64Array(this.d);
    for (j = 0; j < this.d; j++) v[j] = this.mu[j] + this.sd[j] * CY.randn(this.rng);
    c.push({ v: v, f: obj(v) });
  }
  c.sort(function (a, b) { return b.f - a.f; });
  for (j = 0; j < this.d; j++) {
    m = 0; s2 = 0;
    for (i = 0; i < this.el; i++) m += c[i].v[j] / this.el;
    for (i = 0; i < this.el; i++) s2 += (c[i].v[j] - m) * (c[i].v[j] - m) / this.el;
    this.mu[j] = m; this.sd[j] = Math.max(Math.sqrt(s2), this.minSd);
  }
  return c[0];
};
L8.CEM = CEM;

/* One run of practice.  cfg: variant 'exact' | 'naive' | 'pess' | 'dyna' | 'both', lam, gens, pop, elite, sd0, seed, roundGens, fresh, S (the launches), base (a fitted Model on the log), nlog.
 * Record g (0..gens): the best policy found after g generations (by the optimiser's own score), judged by the model and by the world; `trials` counts real trials so far. */
L8.practice = function (cfg) {
  var v = cfg.variant, useLam = (v === 'pess' || v === 'both') ? cfg.lam : 0, rounds = (v === 'dyna' || v === 'both');
  var model = v === 'exact' ? null : cfg.base.clone(), S = cfg.S, G = cfg.gens, cem = new CEM({ pop: cfg.pop, elite: cfg.elite, sd0: cfg.sd0, seed: cfg.seed });
  var rec = [], trials = cfg.nlog || 0, round = 0, g, i;
  function score(th) { return model ? L8.imagined(model, th, S, useLam).score : L8.real(th, S).J; }
  var best = { v: Float64Array.from(cem.mu), f: score(cem.mu) };       // the incumbent starts as "do nothing"
  var snap = cfg.base;                                                  // the model as the optimiser saw it at this step (a copy is kept after every refit)
  function row(g, refit) {
    var th = best.v, re = L8.real(th, S), im = model ? L8.imagined(model, th, S, useLam) : { J: re.J, hits: re.hits, U: 0, outside: 0, score: re.J };
    rec.push({ g: g, K: g * cfg.pop, th: Float64Array.from(th), imJ: im.J, imHits: im.hits, U: im.U, outside: im.outside, score: im.score, reJ: re.J, reHits: re.hits, trials: trials, refit: !!refit, model: model ? snap : null });
  }
  row(0);
  for (g = 1; g <= G; g++) {
    var c = cem.step(score), refit = false;
    if (c.f > best.f) best = { v: c.v, f: c.f };
    if (rounds && g % cfg.roundGens === 0 && g < G) {                    // the Dyna step: run the policy on fresh launches, add the trials, refit the ensemble
      var F = L8.launches(cfg.fresh, 7000 + 31 * round), A = [], E = [], rx = CY.rng(8000 + 31 * round), a;
      for (i = 0; i < F.length; i++) {                                 // the policy acts with a little exploration noise
        a = L8.nudge(best.v, F[i]); a = [a[0] + (cfg.explore || 0) * CY.randn(rx), a[1] + (cfg.explore || 0) * CY.randn(rx)];
        A.push(a); E.push(L8.ending(F[i], a));
      }
      model.add(F, A, E); round++; model.fit(round, cfg.refitEpochs || 40); trials += cfg.fresh; refit = true;
      for (i = 0; i < cem.d; i++) cem.sd[i] = Math.max(cem.sd[i], cfg.sdReset || 0.3);
      best.f = score(best.v); snap = model.clone();                    // the incumbent is re-scored by the refit model
    }
    row(g, refit);
  }
  return { rec: rec, model: model };
};

/* ───────────── random policies, and the law they obey ───────────── */
L8.pool = function (model, S, n, sd, seed) {                       // n policies drawn blindly from the optimiser's starting distribution; imagined and real return of each
  var r = CY.rng(seed), out = [], i, j, th;
  for (i = 0; i < n; i++) {
    th = new Float64Array(10); for (j = 0; j < 10; j++) th[j] = sd * CY.randn(r);
    out.push({ jh: L8.imagined(model, th, S, 0).J, jr: L8.real(th, S).J });
  }
  return out;
};
L8.emax = function (K) {                                           // E[max of K standard normals] = integral of 1 - Phi^K over x > 0 minus Phi^K over x < 0
  if (K <= 1) return 0;
  var s = 0, x, dx = 0.002, p;
  for (x = 0; x < 9; x += dx) { p = CY.stats.ncdf(x + dx / 2); s += (1 - Math.pow(p, K)) * dx; }
  for (x = -9; x < 0; x += dx) { p = CY.stats.ncdf(x + dx / 2); s -= Math.pow(p, K) * dx; }
  return s;
};

/* ───────────── where the model is wrong ───────────── */
L8.NBINS = [[0, 0.6], [0.6, 1.2], [1.2, 1.8], [1.8, 2.4], [2.4, 3.0]];
L8.errorByNudge = function (model, n, seed) {                       // n fresh launches per bin of |a|; RMS error of the ensemble mean (m) and mean disagreement u (m)
  var r = CY.rng(seed), o = {}, rms = [], uu = [];
  L8.NBINS.forEach(function (b, k) {
    var S = L8.launches(n, seed + 1 + k), se = 0, us = 0, i, am, an, a, e;
    for (i = 0; i < n; i++) {
      am = b[0] + (b[1] - b[0]) * r(); an = 2 * Math.PI * r(); a = [am * Math.cos(an), am * Math.sin(an)];
      e = L8.ending(S[i], a); model.predict(S[i], a, o); se += (o.x - e[0]) * (o.x - e[0]) + (o.y - e[1]) * (o.y - e[1]); us += o.u;
    }
    rms.push(Math.sqrt(se / n)); uu.push(us / n);
  });
  return { rms: rms, u: uu };
};
L8.expectedBest = function (pool, K) {                              // the winner of a random K-subset of the pool (by imagined return): exact expectation over all subsets
  var n = pool.length, idx = [], i, p = K / n, gap = 0, re = 0, im = 0, it;
  for (i = 0; i < n; i++) idx.push(i);
  idx.sort(function (a, b) { return pool[b].jh - pool[a].jh; });
  for (i = 1; i <= n - K + 1; i++) {                                // rank i wins if the other K-1 members of the subset rank below it
    it = pool[idx[i - 1]]; gap += p * (it.jh - it.jr); re += p * it.jr; im += p * it.jh;
    if (i < n) p *= (n - i - K + 1) / (n - i);
  }
  return { gap: gap, real: re, imag: im };
};

/* ───────────── decision-time search with the same model (the exit) ───────────── */
L8.search = function (model, S, goal, K, lam, seed) {              // for every launch: K random nudges, keep the one the model likes best; score it in the world
  var r = CY.rng(seed), o = {}, imH = 0, reH = 0, picks = [], i, k, best, bi, an, am, a, sc, e, mi;
  for (i = 0; i < S.length; i++) {
    best = -1e9; bi = null;
    for (k = 0; k < K; k++) {
      an = 2 * Math.PI * r(); am = AMAX * Math.sqrt(r()); a = [am * Math.cos(an), am * Math.sin(an)];
      model.predict(S[i], a, o); sc = L8.bump(L8.miss(o.x, o.y, goal)) - lam * o.u;
      if (sc > best) { best = sc; bi = a; }
    }
    model.predict(S[i], bi, o); if (L8.miss(o.x, o.y, goal) < goal.r) imH++;
    e = L8.ending(S[i], bi); mi = L8.miss(e[0], e[1], goal); if (mi < goal.r) reH++;
    picks.push(bi);
  }
  return { imHits: imH / S.length, reHits: reH / S.length, nudges: picks };
};

/* ───────────── drawing: the widget's four panels, on the shared canvas kit CY.draw ───────────── */
/* ST = the state being shown {rg, nw, g, ep, rw: the run's record, x: its row at generation g, s: the launch, a: the nudge, mod: the model, mp: its answer for (s, a)};
 * env = the page's data {S: the 60 launches, PATH: where they came from, W2: the world with the new goal, G1: the old goal, GENS, POP,
 *       ERR / POOL: the model-error and blind-pool studies by log (filled a moment after the first paint), srch(rg): the decision-time search, emax(K)} */
L8.paint = function (cv, ST, env) {
  var D = CY.draw, C = CY.C, GENS = env.GENS, POP = env.POP, S = env.S, G1 = env.G1, LN = D.line, MO = D.mono, PA = D.path, DOT = D.dot, LB = D.label;
  function axes(ctx, b, xl, yl) {                  // frame, captions, ticks; returns the plot area [x, y, w, h]
    D.frame(ctx, b[0], b[1], b[2], b[3], C.white);
    var r = [b[0] + 38, b[1] + 18, b[2] - 52, b[3] - 48];
    LN(ctx, r[0], r[1] + r[3], r[0] + r[2], r[1] + r[3], C.dim, 1); LN(ctx, r[0], r[1], r[0], r[1] + r[3], C.dim, 1);
    MO(ctx, xl, r[0] + r[2] / 2, b[1] + b[3] - 8, C.mute, 10, 'center'); MO(ctx, yl, b[0] + 8, b[1] + 9, C.mute, 10, 'left');
    return r;
  }
  function ticks(ctx, r, X, vs) { vs.forEach(function (t) { MO(ctx, String(t), X(t), r[1] + r[3] + 11, C.mute, 9, 'center'); }); }
  function grid(ctx, r, Y) { [0, 0.5, 1].forEach(function (y) { LN(ctx, r[0], Y(y), r[0] + r[2], Y(y), y ? C.grid : C.dim, 1); MO(ctx, y.toFixed(1), r[0] - 5, Y(y), C.mute, 9, 'right'); }); }
  function panelA(ctx, b) {                                     // one launch: the nudge, the world, the five networks
    D.frame(ctx, b[0], b[1], b[2], b[3], C.white);
    var v = D.view(b[0] + 6, b[1] + 6, b[2] - 12, b[3] - 50, 0, 8, 0, 5), s = ST.s, a = ST.a, P = L8.path(s, a), mp = ST.mp, i, px = function (p) { return [v.X(p[0]), v.Y(p[1])]; }, end = px(P[P.length - 1]);
    D.arena(ctx, v, ST.nw ? env.W2 : L8.W0, {});
    if (ST.nw) DOT(ctx, v.X(G1.x), v.Y(G1.y), G1.r * v.s, 'rgba(98,98,115,0.12)', C.dim);
    PA(ctx, env.PATH[ST.ep].map(px), C.dim, 1.5, [3, 3]); PA(ctx, P.map(px), C.cyan, 2);
    if (ST.nw) PA(ctx, L8.path(s, env.srch(ST.rg).nudges[ST.ep]).map(px), C.green, 2, [5, 3]);
    DOT(ctx, v.X(s[0]), v.Y(s[1]), 4, C.ink); D.arrow(ctx, v.X(s[0]), v.Y(s[1]), v.X(s[0] + 0.35 * a[0]), v.Y(s[1] + 0.35 * a[1]), C.red, 2, 6); DOT(ctx, end[0], end[1], 4.5, C.cyan, C.white);
    for (i = 0; i < ST.mod.M; i++) DOT(ctx, v.X(mp.px[i]), v.Y(mp.py[i]), 3, C.purple);
    MO(ctx, '×', v.X(mp.x), v.Y(mp.y), C.amber, 24, 'center');
    MO(ctx, 'launch ' + ST.ep + ' · nudge ' + Math.hypot(a[0], a[1]).toFixed(2) + ' m/s' + (ST.nw ? ' · green: fresh search' : ''), b[0] + 8, b[1] + b[3] - 30, C.ink, 10);
    MO(ctx, 'red: nudge · cyan: world · purple: networks · ×: mean', b[0] + 8, b[1] + b[3] - 12, C.mute, 9);
  }
  function panelB(ctx, b) {                                     // imagined and real return of the best policy so far, generation by generation
    var rw = ST.rw, r = axes(ctx, b, 'generation g (K = 96 g candidates tried)', 'return'), X = function (g) { return r[0] + g / GENS * r[2]; }, Y = function (y) { return r[1] + r[3] - y * r[3]; }, g;
    grid(ctx, r, Y); ticks(ctx, r, X, [0, 6, 12, 18, 24]);
    ctx.save(); ctx.fillStyle = C.redSoft; ctx.beginPath();
    for (g = 0; g <= GENS; g++) ctx.lineTo(X(g), Y(rw[g].imJ));
    for (g = GENS; g >= 0; g--) ctx.lineTo(X(g), Y(rw[g].reJ));
    ctx.closePath(); ctx.fill(); ctx.restore();
    LN(ctx, r[0], Y(rw[0].reJ), r[0] + r[2], Y(rw[0].reJ), C.dim, 1.2, [4, 3]); MO(ctx, 'doing nothing', r[0] + r[2] - 4, Y(rw[0].reJ) + 9, C.mute, 9, 'right');
    rw.forEach(function (q) { if (q.refit) { LN(ctx, X(q.g), r[1], X(q.g), r[1] + r[3], C.purple, 1, [2, 3]); MO(ctx, 'refit', X(q.g), r[1] + 6, C.purple, 9, 'center'); } });
    PA(ctx, rw.map(function (q) { return [X(q.g), Y(q.imJ)]; }), C.amber, 2.4); PA(ctx, rw.map(function (q) { return [X(q.g), Y(q.reJ)]; }), C.cyan, 2.4);
    LN(ctx, X(ST.g), r[1], X(ST.g), r[1] + r[3], C.ink, 1); DOT(ctx, X(ST.g), Y(ST.x.imJ), 4, C.amber, C.white); DOT(ctx, X(ST.g), Y(ST.x.reJ), 4, C.cyan, C.white);
    LB(ctx, 'imagined (the model)', r[0] + 10, r[1] + 16, C.amber, 10); LB(ctx, 'real (the world)', r[0] + 10, r[1] + 30, C.cyan, 10);
  }
  function panelC(ctx, b) {                                     // where the model is wrong, and where the policy sends its nudges
    var r = axes(ctx, b, 'nudge size |a| (m/s)', 'model error, doubt (m)'), X = function (a) { return r[0] + a / 3 * r[2]; }, Y = function (m) { return r[1] + r[3] - Math.min(m, 2.5) / 2.5 * r[3]; }, E = env.ERR[ST.rg];
    if (!E) return;
    ctx.fillStyle = C.greenSoft; ctx.fillRect(X(0), r[1], X(+ST.rg) - X(0), r[3]); MO(ctx, 'the log', X(0) + 4, r[1] + 7, C.green, 9, 'left');
    L8.NBINS.forEach(function (bn, k) {
      var w = (X(bn[1]) - X(bn[0])) * 0.4;
      ctx.fillStyle = C.red; ctx.fillRect(X(bn[0]) + 3, Y(E.rms[k]), w, r[1] + r[3] - Y(E.rms[k])); ctx.fillStyle = C.purple; ctx.fillRect(X(bn[0]) + 3 + w, Y(E.u[k]), w, r[1] + r[3] - Y(E.u[k]));
    });
    ticks(ctx, r, X, [0, 1, 2, 3]);
    [1, 2].forEach(function (m) { LN(ctx, r[0], Y(m), r[0] + r[2], Y(m), C.grid, 1); MO(ctx, String(m), r[0] - 5, Y(m), C.mute, 9, 'right'); });
    S.forEach(function (s) { var a = L8.nudge(ST.x.th, s), n = Math.hypot(a[0], a[1]); LN(ctx, X(n), r[1] + r[3] - 1, X(n), r[1] + r[3] - 10, C.ink, 1.4); });
    LB(ctx, 'RMS error', r[0] + 8, r[1] + 22, C.red, 10); LB(ctx, 'disagreement u', r[0] + 8, r[1] + 36, C.purple, 10); LB(ctx, 'black ticks: the policy\'s nudges', r[0] + 8, r[1] + 50, C.ink, 10);
  }
  function panelD(ctx, b) {                                     // the optimiser's curse: gap against the number of candidates
    var r = axes(ctx, b, 'candidates tried K (log scale)', 'imagined − real'), P = env.POOL[ST.rg], lk = Math.log(POP * GENS), Ks = [], K;
    var X = function (K) { return r[0] + Math.log(K) / lk * r[2]; }, Y = function (y) { return r[1] + r[3] - (Math.min(1, Math.max(-0.2, y)) + 0.2) / 1.2 * r[3]; };
    if (!P) return;
    grid(ctx, r, Y); ticks(ctx, r, X, [1, 10, 100, 1000]);
    for (K = 2; K <= POP * GENS; K = Math.ceil(K * 1.25)) Ks.push(K);
    PA(ctx, Ks.map(function (K) { return [X(K), Y(P.delta * env.emax(K))]; }), C.amber, 1.6, [5, 3]); PA(ctx, Ks.map(function (K) { return [X(K), Y(P.delta * Math.sqrt(2 * Math.log(K)))]; }), C.amber, 1.2, [1, 3]);
    PA(ctx, P.blind.map(function (q) { return [X(q[0]), Y(q[1])]; }), C.green, 2);
    PA(ctx, ST.rw.slice(1).map(function (q) { return [X(POP * q.g), Y(q.imJ - q.reJ)]; }), C.red, 2.2); DOT(ctx, X(Math.max(1, POP * ST.g)), Y(ST.x.imJ - ST.x.reJ), 4, C.red, C.white);
    LB(ctx, 'this run', r[0] + 10, r[1] + 16, C.red, 10); LB(ctx, 'blind best of K', r[0] + 10, r[1] + 30, C.green, 10); LB(ctx, 'δ·E[max] dashed, δ√(2 ln K) dotted', r[0] + 10, r[1] + 44, C.amber, 10);
  }
  cv.style.height = (cv.clientWidth < 600 ? 1090 : 660) + 'px';
  var Sx = D.setup(cv), ctx = Sx.ctx, w = Sx.w, h = Sx.h, narrow = w < 600, lw = narrow ? w - 16 : Math.round(w * 0.42);
  panelA(ctx, narrow ? [8, 8, lw, 250] : [8, 8, lw, 300]); panelB(ctx, narrow ? [8, 270, lw, 260] : [lw + 22, 8, w - lw - 30, 300]);
  panelC(ctx, narrow ? [8, 542, lw, 260] : [8, 322, lw, h - 330]); panelD(ctx, narrow ? [8, 814, lw, 260] : [lw + 22, 322, w - lw - 30, h - 330]);
};

root.L8 = L8;
if (typeof module !== 'undefined' && module.exports) module.exports = L8;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
