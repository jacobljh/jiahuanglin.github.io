/* l10_jumps.js — temporal abstraction on the Courtyard (World Models, lesson 10).  Everything the lesson's widget computes lives here;
 * the page script only draws and wires controls.   Needs courtyard.js (CY).  Deterministic (seeded generators only).  Node: module.exports.
 *
 *   events    L10.jump(s, S): the true S-step coasting jump of the plain Courtyard (walls only), with a count of the wall hits inside it
 *             (n_x, n_y): the "fast channel".  Identical to S calls of CY.step(w, s, null) (the oracle checks it).
 *   learner   L10.Model: a model of the S-step jump, fitted from pairs (state, state S steps later) of launched balls.  One hidden layer of M tanh
 *             units with FIXED random weights and a readout fitted by ridge regression (closed form), predicting the next STATE (not a change).
 *             Three heads on the same hidden units: the state head (nothing about the skipped events), a count head (predicts the number of
 *             wall hits in the jump), and one readout per (n_x, n_y): the state head with a summary.  model.none(x) / model.summ(x) / model.given(x, n_x, n_y).
 *   study     L10.study(o): for every stride, the one-jump error and the error of CHAINED jumps from launched states, with and without the summary;
 *             reach = the largest covered horizon whose median chained error is within the tolerance.
 *   maze      lesson 9's task T5 (a wall of 11 posts with a gap above y = 3.9; the ball starts within 10 cm of (1, 1) at rest; 160 steps; it DOCKS when it is inside the
 *             goal disc and slower than 0.5 m/s).  The jump planner chooses J macro-actions (one nudge, then S - 1 steps of coasting; |a| <= 0.6 S, the sum of the
 *             S per-step limits) by CEM, executes the first one, observes, plans again.  The skill planner runs the flat receding-horizon CEM toward the current
 *             subgoal.  Both use the simulator as the model: the model-side price is measured by the study.
 */
(function (root) {
'use strict';
var CY = root.CY || (typeof require !== 'undefined' ? require('./courtyard.js') : null);
var L10 = {};
var W0 = CY.world({ curtain: null });
L10.W0 = W0; L10.TAU = 0.05; L10.STRIDES = [1, 2, 4, 8, 16, 32, 64]; L10.HMAX = 192;

/* ───────────── the fast channel: wall hits inside a jump ───────────── */
L10.stepEv = function (w, s, ev) {                                // CY.step with a = null, walls only, counting the hits
  var st = [s[0], s[1], s[2], s[3]], n = w.sub, h = w.dt / n, damp = Math.exp(-w.gamma * h), glide = (1 - damp) / w.gamma, i;
  for (i = 0; i < n; i++) {
    st[0] += st[2] * glide; st[1] += st[3] * glide; st[2] *= damp; st[3] *= damp;
    if (st[0] < w.r) { st[0] = 2 * w.r - st[0]; st[2] = -w.e * st[2]; ev.nx++; }
    if (st[0] > w.W - w.r) { st[0] = 2 * (w.W - w.r) - st[0]; st[2] = -w.e * st[2]; ev.nx++; }
    if (st[1] < w.r) { st[1] = 2 * w.r - st[1]; st[3] = -w.e * st[3]; ev.ny++; }
    if (st[1] > w.H - w.r) { st[1] = 2 * (w.H - w.r) - st[1]; st[3] = -w.e * st[3]; ev.ny++; }
  }
  return st;
};
L10.jump = function (s0, S) {                                     // the true S-step jump and what happened inside it
  var ev = { nx: 0, ny: 0 }, s = s0, t;
  for (t = 0; t < S; t++) s = L10.stepEv(W0, s, ev);
  return { s: s, nx: ev.nx, ny: ev.ny };
};
var BASE = {};                                                    // launched ball states at random times, shared by every stride (same seeds, same states)
L10.base = function (n, seed, tmax) {                             // tmax: the ball is advanced a random number of steps below tmax first (96 = its first 9.6 s)
  var key = n + ':' + seed + ':' + tmax, r, out, i, t, t0, st;
  if (BASE[key]) return BASE[key];
  r = CY.rng(seed); out = [];
  for (i = 0; i < n; i++) {
    st = CY.launch(W0, r); t0 = Math.floor(r() * tmax);
    for (t = 0; t < t0; t++) st = CY.step(W0, st, null);
    out.push(st);
  }
  return (BASE[key] = out);
};
L10.pairs = function (n, seed, S, tmax) {                         // n pairs (state, the true jump from it); training pairs come from the first 9.6 s of the flights, tests from the first 4.8 s
  return L10.base(n, seed, tmax || 96).map(function (x) { var j = L10.jump(x, S); return { x: x, y: j.s, nx: j.nx, ny: j.ny }; });
};

/* ───────────── the learner ───────────── */
L10.Model = function (o) {                                        // o: {m, scale, lam, seed}; fit(pairs) trains the three heads
  var r, i;
  this.m = o.m; this.lam = o.lam; this.p = o.m + 1;
  r = CY.rng(o.seed); this.W1 = new Float64Array(4 * o.m); this.b1 = new Float64Array(o.m);                   // input i of unit j is W1[i * m + j]
  for (i = 0; i < this.W1.length; i++) this.W1[i] = o.scale * CY.randn(r);
  for (i = 0; i < o.m; i++) this.b1[i] = CY.randn(r);
};
L10.Model.prototype.phi = function (x) {                          // hidden features of a state (plus a constant); the inputs are scaled to about [-1, 1]
  var z0 = x[0] / 4 - 1, z1 = x[1] / 2.5 - 1, z2 = x[2] / 3, z3 = x[3] / 3, f = new Float64Array(this.p), W = this.W1, b = this.b1, j;
  for (j = 0; j < this.m; j++) f[j] = Math.tanh(b[j] + z0 * W[j] + z1 * W[this.m + j] + z2 * W[2 * this.m + j] + z3 * W[3 * this.m + j]);
  f[this.m] = 1; return f;
};
function ridge(F, T, p, q, lam) {                                 // closed form: (FᵀF + lam I) W = FᵀT, accumulated on the upper triangle
  var n = F.length, A = new Float64Array(p * p), B = new Float64Array(p * q), i, a, b, c, f, t;
  for (i = 0; i < n; i++) {
    f = F[i]; t = T[i];
    for (a = 0; a < p; a++) { for (b = a; b < p; b++) A[a * p + b] += f[a] * f[b]; for (c = 0; c < q; c++) B[a * q + c] += f[a] * t[c]; }
  }
  for (a = 0; a < p; a++) { for (b = 0; b < a; b++) A[a * p + b] = A[b * p + a]; A[a * p + a] += lam; }
  return CY.la.solve(A, B, p);
}
function readout(W, f, p, q) { var o = new Array(q), c, k, s; for (c = 0; c < q; c++) { s = 0; for (k = 0; k < p; k++) s += f[k] * W[k * q + c]; o[c] = s; } return o; }
L10.keyOf = function (nx, ny) { return Math.min(nx, 3) * 4 + Math.min(ny, 3); };
L10.Model.prototype.fit = function (D) {
  var p = this.p, self = this, F = D.map(function (d) { return self.phi(d.x); }), g = {}, k, W, T;
  T = D.map(function (d) { return [d.y[0] / 4 - 1, d.y[1] / 2.5 - 1, d.y[2] / 3, d.y[3] / 3, d.nx, d.ny]; });   // four state numbers and the two wall-hit counts, one pass
  W = ridge(F, T, p, 6, this.lam); this.Ws = new Float64Array(p * 4); this.Wc = new Float64Array(p * 2);
  for (k = 0; k < p; k++) { this.Ws.set(W.subarray(k * 6, k * 6 + 4), k * 4); this.Wc.set(W.subarray(k * 6 + 4, k * 6 + 6), k * 2); }
  D.forEach(function (d, i) { k = L10.keyOf(d.nx, d.ny); (g[k] = g[k] || []).push(i); });
  this.Wg = {};                                                                                               // one readout per (n_x, n_y) seen at least 12 times
  for (k in g) if (g[k].length >= 12) this.Wg[k] = ridge(g[k].map(function (i) { return F[i]; }), g[k].map(function (i) { return T[i].slice(0, 4); }), p, 4, this.lam * 3);
  return this;
};
function back(q) { return [(q[0] + 1) * 4, (q[1] + 1) * 2.5, q[2] * 3, q[3] * 3]; }
L10.Model.prototype.none = function (x) { return back(readout(this.Ws, this.phi(x), this.p, 4)); };          // the jump, told nothing about what happens inside it
L10.Model.prototype.counts = function (x, f) { var c = readout(this.Wc, f || this.phi(x), this.p, 2); return [Math.max(0, Math.round(c[0])), Math.max(0, Math.round(c[1]))]; };
L10.Model.prototype.given = function (x, nx, ny, f) { return back(readout(this.Wg[L10.keyOf(nx, ny)] || this.Ws, f || this.phi(x), this.p, 4)); };
L10.Model.prototype.summ = function (x) { var f = this.phi(x), c = this.counts(x, f); return this.given(x, c[0], c[1], f); };   // predict the summary, then the state given it

/* ───────────── the study: one-jump error, chained error, reach ───────────── */
L10.OPT = { m: 64, scale: 1.5, lam: 1e-4, seed: 6, n: 1500, dseed: 107, starts: 100, ntest: 2000 };   // the sixth of twelve draws (feature seed k, data seed 101 + k)
function med(a) { var b = a.slice().sort(function (x, y) { return x - y; }); return b[Math.floor(b.length / 2)]; }
L10.reach = function (meds, S, tau) { var J = 0; while (J < meds.length && meds[J] <= tau) J++; return J * S; };       // covered steps of the longest chain within the tolerance
L10.one = function (S, o) {                                       // fit the three heads at stride S; measure one jump and the chain for three kinds of model
  o = o || L10.OPT;
  var D = L10.pairs(o.n, o.dseed, S), te = L10.pairs(o.ntest, o.dseed + 1000, S, 48), M = new L10.Model(o).fit(D), res = { S: S, model: M }, K = Math.floor(L10.HMAX / S), r = CY.rng(o.dseed + 7), j, k;
  function dist(q, d) { return Math.hypot(q[0] - d.y[0], q[1] - d.y[1]); }
  res.oneNone = med(te.map(function (d) { return dist(M.none(d.x), d); }));                 // told nothing about what happens inside the jump
  res.oneSum = med(te.map(function (d) { return dist(M.summ(d.x), d); }));                  // forecasts the wall hits itself, then predicts the state given them
  res.oneObs = med(te.map(function (d) { return dist(M.given(d.x, d.nx, d.ny), d); }));     // told the wall hits by a fast loop that watched the jump
  var hits = te.filter(function (d) { return d.nx + d.ny > 0; });
  res.hitNone = med(hits.map(function (d) { return dist(M.none(d.x), d); })); res.hitSum = med(hits.map(function (d) { return dist(M.summ(d.x), d); }));
  res.hitObs = med(hits.map(function (d) { return dist(M.given(d.x, d.nx, d.ny), d); }));
  res.recall = hits.filter(function (d) { var c = M.counts(d.x); return c[0] === d.nx && c[1] === d.ny; }).length / Math.max(1, hits.length);
  res.countAcc = te.filter(function (d) { var c = M.counts(d.x); return c[0] === d.nx && c[1] === d.ny; }).length / te.length;
  res.pBounce = hits.length / te.length;
  var En = [], Es = [], Eo = []; for (j = 0; j < K; j++) { En.push([]); Es.push([]); Eo.push([]); }
  for (k = 0; k < o.starts; k++) {
    var st0 = CY.launch(W0, r), t0 = Math.floor(r() * 48), tt;                               // a ball at a random moment of its first 4.8 s
    for (tt = 0; tt < t0; tt++) st0 = CY.step(W0, st0, null);
    var tru = st0, hn = st0, hs = st0, ho = st0, tj;
    for (j = 0; j < K; j++) {
      tj = L10.jump(tru, S); tru = tj.s; hn = M.none(hn); hs = M.summ(hs); ho = M.given(ho, tj.nx, tj.ny);
      En[j].push(Math.hypot(hn[0] - tru[0], hn[1] - tru[1])); Es[j].push(Math.hypot(hs[0] - tru[0], hs[1] - tru[1])); Eo[j].push(Math.hypot(ho[0] - tru[0], ho[1] - tru[1]));
    }
  }
  res.medNone = En.map(med); res.medSum = Es.map(med); res.medObs = Eo.map(med);
  res.reachNone = L10.reach(res.medNone, S, L10.TAU); res.reachSum = L10.reach(res.medSum, S, L10.TAU); res.reachObs = L10.reach(res.medObs, S, L10.TAU);
  res.after = function (J, kind) { var m = kind === 'obs' ? res.medObs : kind === 'sum' ? res.medSum : res.medNone; return m[Math.min(m.length, Math.max(1, J)) - 1]; };   // median error of J chained jumps (J = 1 .. HMAX / S)
  return res;
};
L10.study = function (o) { return L10.STRIDES.map(function (S) { return L10.one(S, o); }); };

/* ───────────── the maze ───────────── */
var posts = []; for (var yy = 0.2; yy <= 3.75; yy += 0.35) posts.push({ x: 4.0, y: +yy.toFixed(2), r: 0.2 });
var WM = CY.world({ curtain: null, posts: posts, goal: { x: 7.0, y: 1.0, r: 0.45 } });
L10.WM = WM; L10.GOAL = WM.goal; L10.AMAX = 0.6; L10.TEP = 160; L10.POP = 60; L10.ITERS = 5; L10.VSTOP = 0.5;
L10.start = function (seed) { var r = CY.rng(7000 + seed); return [1 + 0.2 * (r() - 0.5), 1 + 0.2 * (r() - 0.5), 0, 0]; };   // within 10 cm of (1, 1), at rest (lesson 9's starts)
L10.docked = function (s) { return Math.hypot(s[0] - L10.GOAL.x, s[1] - L10.GOAL.y) < L10.GOAL.r && Math.hypot(s[2], s[3]) <= L10.VSTOP; };
L10.clipTo = function (ax, ay, A) { var n = Math.hypot(ax, ay); return n > A ? [ax * A / n, ay * A / n] : [ax, ay]; };
L10.planJumps = function (s0, J, S, seed, tgt) {                  // CEM over J macro-actions; cost = sum 0.2 * S * distance after each jump + 3 * terminal distance
  var A = L10.AMAX * S, G = tgt || L10.GOAL;
  function cost(v) {
    var q = s0, c = 0, j, u, a;
    for (j = 0; j < J; j++) {
      a = L10.clipTo(v[2 * j], v[2 * j + 1], A); q = CY.step(WM, q, a);
      for (u = 1; u < S; u++) q = CY.step(WM, q, null);
      c += 0.2 * S * Math.hypot(q[0] - G.x, q[1] - G.y);
    }
    return c + 3 * Math.hypot(q[0] - G.x, q[1] - G.y);
  }
  return CY.cem(cost, 2 * J, { iters: L10.ITERS, pop: L10.POP, sd0: 0.5 * A, seed: seed, clip: [-A, A], minSd: 0.02 * Math.max(1, S / 4) }).best;
};
function inDiscStats(s, o) { var d = Math.hypot(s[0] - L10.GOAL.x, s[1] - L10.GOAL.y); if (d < L10.GOAL.r) { o.inDisc++; o.vmin = Math.min(o.vmin, Math.hypot(s[2], s[3])); } }
L10.episodeJumps = function (J, S, seed) {                        // receding horizon: plan J jumps, execute the first (S steps, open loop), observe, plan again
  var s = L10.start(seed), t = 0, hit = -1, path = [[s[0], s[1]]], plans = [], apps = 0, A = L10.AMAX * S, st = { inDisc: 0, vmin: Infinity }, v, a, u, q, jj, aj, pl;
  while (t < L10.TEP && hit < 0) {
    v = L10.planJumps(s, J, S, seed * 1009 + t); apps += L10.POP * L10.ITERS * J;
    a = L10.clipTo(v[0], v[1], A);
    q = s; pl = [[s[0], s[1]]];                                   // the plan as the model sees it: the state after each of the J jumps
    for (jj = 0; jj < J; jj++) { aj = L10.clipTo(v[2 * jj], v[2 * jj + 1], A); q = CY.step(WM, q, aj); for (u = 1; u < S; u++) q = CY.step(WM, q, null); pl.push([q[0], q[1]]); }
    plans.push(pl);
    for (u = 0; u < S && t < L10.TEP; u++, t++) { s = CY.step(WM, s, u === 0 ? a : null); path.push([s[0], s[1]]); inDiscStats(s, st); if (L10.docked(s)) { hit = t + 1; break; } }
  }
  return { hit: hit, path: path, plans: plans, apps: apps, decisions: plans.length, inDisc: st.inDisc, vmin: st.vmin };
};
L10.SUBGOAL = { x: 4.0, y: 4.45 };                                // the waypoint: the middle of the gap above the wall
L10.planTo = function (s0, tgt, H, seed) {                        // the flat receding-horizon planner of lesson 9, cost measured to a target
  var Amax = L10.AMAX;
  function cost(v) {
    var q = s0, c = 0, t, a;
    for (t = 0; t < H; t++) { a = L10.clipTo(v[2 * t], v[2 * t + 1], Amax); q = CY.step(WM, q, a); c += 0.2 * Math.hypot(q[0] - tgt.x, q[1] - tgt.y); }
    return c + 3 * Math.hypot(q[0] - tgt.x, q[1] - tgt.y);
  }
  return CY.cem(cost, 2 * H, { iters: L10.ITERS, pop: L10.POP, sd0: 0.3, seed: seed, clip: [-Amax, Amax], minSd: 0.02 }).best;
};
L10.episodeFlat = function (H, seed) { return L10.episodeSkills(H, seed, [], 0); };
L10.episodeSkills = function (Hlow, seed, waypoints, rad) {       // skills: pursue each subgoal in turn with the flat planner, switch when within rad of it
  var goals = (waypoints === undefined ? [L10.SUBGOAL] : waypoints).concat([L10.GOAL]), gi = 0, s = L10.start(seed), hit = -1, path = [[s[0], s[1]]], sw = [], apps = 0, st = { inDisc: 0, vmin: Infinity }, t, v, a, tg;
  rad = rad === undefined ? 0.4 : rad;
  for (t = 0; t < L10.TEP; t++) {
    while (gi < goals.length - 1 && Math.hypot(s[0] - goals[gi].x, s[1] - goals[gi].y) < rad) { gi++; sw.push(t); }
    tg = goals[gi]; v = L10.planTo(s, tg, Hlow, seed * 1009 + t); apps += L10.POP * L10.ITERS * Hlow;
    a = L10.clipTo(v[0], v[1], L10.AMAX); s = CY.step(WM, s, a); path.push([s[0], s[1]]); inDiscStats(s, st);
    if (L10.docked(s)) { hit = t + 1; break; }
  }
  return { hit: hit, path: path, switches: sw, apps: apps, decisions: path.length - 1, inDisc: st.inDisc, vmin: st.vmin };
};

root.L10 = L10;
if (typeof module !== 'undefined' && module.exports) module.exports = L10;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
