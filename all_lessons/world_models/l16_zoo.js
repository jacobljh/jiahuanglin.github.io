/* l16_zoo.js — the zoo of trained models and their exams (World Models, lesson 16).  Global ZO; needs courtyard.js (CY) loaded first.  Deterministic.  Node: module.exports.
 *
 * The task is lesson 1's nudge (T1): a launched ball, ONE impulse a (|a| <= 3 m/s) at step 12, then 80 steps of coasting; a hit is an ending inside the goal disc.
 * A MODEL is lesson 8's kind: (state at the nudge s, nudge a) -> ending (x, y).  It is a ridge regression on M fixed random tanh features of (s, a), closed form, so a
 * whole zoo trains in a fraction of a second; E = 4 bootstrap members share the features and differ in their read-out; the model's answer is the mean of the members.
 * A RECIPE says what the model was taught from: M units, n trials, how far the nudges in its log reached (rho: uniform in a disc of that radius), whether the log came
 * from windy days on which the operator felt the wind and pushed against it (wind: the standard deviation of the gust, m/s^2), whether the least squares was weighted
 * towards the inputs a planner is likely to ask about (weighted), and whether it is the control (twin: the reference again, another log and other random features).
 * THE EXAMS (the rungs of the ladder that apply to a model that answers in one jump).  On its own log (a fresh draw of the same process): the held-out error and the
 * coverage of its 90 % intervals.  On nudges set by fiat over the whole disc, from fresh launches: the intervention error.  In a planner: random shooting over the first K of
 * 128 fixed candidate nudges; per launch the candidate with the smallest imagined miss is picked and then run in the true Courtyard.  Real success = the pick really hits;
 * imagined success = the model claims a hit; judged success = the other half of the ensemble claims it for the pick of the first half.  Two goals: the series' and a moved one.
 */
(function (root) {
'use strict';
var CY = root.CY || (typeof require !== 'undefined' ? require('./courtyard.js') : null);
var ZO = {};
ZO.TA = 12; ZO.TF = 80; ZO.AMAX = 3; ZO.E = 4; ZO.KMAX = 128; ZO.NDEC = 100; ZO.NDO = 300; ZO.NOWN = 200;
ZO.W0 = CY.world({});
ZO.GOALS = [{ x: 6.6, y: 2.5, r: 0.5 }, { x: 4.0, y: 1.2, r: 0.5 }];            // the goal of the series, and a moved goal
var SC = [1 / 8, 1 / 5, 1 / 3, 1 / 3, 1 / 3, 1 / 3];

/* ───────────── the task ───────────── */
ZO.disc = function (rng, rho) { var an = 2 * Math.PI * rng(), am = rho * Math.sqrt(rng()); return [am * Math.cos(an), am * Math.sin(an)]; };
ZO.atNudge = function (w, s) { for (var t = 0; t < ZO.TA; t++) s = CY.step(w, s, null); return s; };
ZO.launchAt = function (rng) { return ZO.atNudge(ZO.W0, CY.launch(ZO.W0, rng)); };
ZO.ending = function (w, s, a) { var q = CY.step(w, s, a); for (var u = 0; u < ZO.TF; u++) q = CY.step(w, q, null); return q; };
ZO.miss = function (e, g) { return Math.hypot(e[0] - g.x, e[1] - g.y); };
/* what one unit of wind (m/s^2 along x) and one unit of nudge (m/s along x) do to the ending, read off the simulator in a floor with no walls in reach */
(function () {
  var big = CY.world({ W: 1e3, H: 1e3, curtain: null }), bw = CY.world({ W: 1e3, H: 1e3, curtain: null, wind: [1, 0] }), s = [500, 500, 1.5, 0];
  var e0 = ZO.ending(big, s, null)[0], C = ZO.ending(bw, s, null)[0] - e0, B = ZO.ending(big, s, [1, 0])[0] - e0;
  ZO.C = C; ZO.B = B; ZO.KAPPA = C / B;
})();

/* ───────────── the recipes: what each model was taught from ───────────── */
ZO.RECIPES = [
  { id: 'tiny',     name: 'tiny',          M: 8,   n: 500,  rho: 3,   what: '8 units, the full range of nudges in its log' },
  { id: 'small',    name: 'small',         M: 24,  n: 500,  rho: 3,   what: '24 units' },
  { id: 'mid',      name: 'mid',           M: 64,  n: 500,  rho: 3,   what: '64 units, 500 trials, nudges over the full range: the reference' },
  { id: 'twin',     name: 'twin',          M: 64,  n: 500,  rho: 3,   twin: 1, what: 'the reference again: same recipe, another log, other random features (the control)' },
  { id: 'big',      name: 'big',           M: 128, n: 500,  rho: 3,   what: '128 units' },
  { id: 'scarce',   name: 'scarce',        M: 64,  n: 100,  rho: 3,   what: 'the reference taught from 100 trials' },
  { id: 'plenty',   name: 'plenty',        M: 64,  n: 2000, rho: 3,   what: 'the reference taught from 2000 trials' },
  { id: 'cautious', name: 'cautious',      M: 64,  n: 500,  rho: 1.2, what: 'the reference, but the log never holds a nudge above 1.2 m/s (lesson 8\'s operator)' },
  { id: 'narrow',   name: 'narrow',        M: 64,  n: 500,  rho: 0.5, what: 'the reference, nudges up to 0.5 m/s only' },
  { id: 'weighted', name: 'weighted',      M: 64,  n: 500,  rho: 3,   weighted: 1, what: 'the reference, least squares weighted towards the inputs whose free-flight stopping point lands near the series\' goal' },
  { id: 'confound', name: 'confounded',    M: 64,  n: 500,  rho: 0.3, wind: 0.05, what: 'the reference, taught from windy days on which the operator felt the wind and pushed against it (lesson 7)' },
  { id: 'bigcaut',  name: 'big-cautious',  M: 128, n: 500,  rho: 1.2, what: '128 units, nudges up to 1.2 m/s' }
];

/* ───────────── logs ───────────── */
/* n trials of the recipe's process: a launch rolled to the nudge (s), a nudge (a), the ending (e) */
ZO.trials = function (n, seed, rc) {
  var r = CY.rng(seed), out = [], i, w, wnd, st, a, e;
  for (i = 0; i < n; i++) {
    wnd = rc.wind ? rc.wind * CY.randn(r) : 0; w = rc.wind ? CY.world({ wind: [wnd, 0] }) : ZO.W0;
    st = ZO.atNudge(w, CY.launch(ZO.W0, r)); a = ZO.disc(r, rc.rho);
    if (rc.wind) a = [a[0] - ZO.KAPPA * wnd, a[1]];                    // the operator feels the wind and pushes against it
    e = ZO.ending(w, st, a);
    out.push({ s: st, a: a, e: e });
  }
  return out;
};

/* ───────────── the model: ridge on fixed random tanh features ───────────── */
ZO.Feat = function (M, seed) {
  var r = CY.rng(seed), j, k; this.M = M; this.p = M + 7; this.R = new Float64Array(M * 6); this.c = new Float64Array(M);
  for (j = 0; j < M; j++) { for (k = 0; k < 6; k++) this.R[j * 6 + k] = 2 * CY.randn(r); this.c[j] = CY.randn(r); }
};
ZO.Feat.prototype.of = function (s, a, phi) {                        // [1, scaled inputs, tanh(R x + c)]
  var M = this.M, R = this.R, j, z;
  phi[0] = 1; phi[1] = s[0] * SC[0]; phi[2] = s[1] * SC[1]; phi[3] = s[2] * SC[2]; phi[4] = s[3] * SC[3]; phi[5] = a[0] * SC[4]; phi[6] = a[1] * SC[5];
  for (j = 0; j < M; j++) {
    z = this.c[j] + R[j * 6] * phi[1] + R[j * 6 + 1] * phi[2] + R[j * 6 + 2] * phi[3] + R[j * 6 + 3] * phi[4] + R[j * 6 + 4] * phi[5] + R[j * 6 + 5] * phi[6];
    phi[7 + j] = Math.tanh(z);
  }
};
/* weights the least squares towards the inputs a planner is likely to ask about: the free-flight stopping point of the post-nudge velocity lands near a goal */
ZO.relevance = function (s, a) {
  var k = (1 - Math.exp(-ZO.W0.gamma * ZO.W0.dt * (ZO.TF + 1))) / ZO.W0.gamma, x = s[0] + k * (s[2] + a[0]), y = s[1] + k * (s[3] + a[1]);
  return 1 + 6 * Math.exp(-0.5 * (Math.pow((x - ZO.GOALS[0].x) / 1.5, 2) + Math.pow((y - ZO.GOALS[0].y) / 1.5, 2)));
};
/* the ensemble: E bootstrap read-outs on shared features.  Fit once; ask many times. */
ZO.Model = function (rc, zseed) {
  var E = ZO.E, data = ZO.trials(rc.n, 1000 * zseed + 17 + (rc.twin ? 500 : 0), rc), n = data.length, p = rc.M + 7, phi = new Float64Array(p), Phi = new Float64Array(n * p), Y = new Float64Array(n * 2), i, e, j, rr;
  this.rc = rc; this.feat = new ZO.Feat(rc.M, 100 * zseed + 5 + rc.M + (rc.twin ? 77 : 0)); this.p = p; this.W = []; this.buf = new Float64Array(p);
  this.rlog = 0; for (i = 0; i < n; i++) this.rlog = Math.max(this.rlog, Math.hypot(data[i].a[0], data[i].a[1]));
  var wt = new Float64Array(n); for (i = 0; i < n; i++) wt[i] = rc.weighted ? ZO.relevance(data[i].s, data[i].a) : 1;
  for (i = 0; i < n; i++) { this.feat.of(data[i].s, data[i].a, phi); Phi.set(phi, i * p); Y[i * 2] = data[i].e[0] / 8; Y[i * 2 + 1] = data[i].e[1] / 5; }
  for (e = 0; e < E; e++) {                                           // bootstrap: member e sees trial i with multiplicity m_i
    rr = CY.rng(7000 * zseed + 31 * e + rc.M + (rc.twin ? 9 : 0)); var mult = new Float64Array(n); for (i = 0; i < n; i++) mult[Math.floor(rr() * n)] += 1;
    var Pw = new Float64Array(n * p), Yw = new Float64Array(n * 2);
    for (i = 0; i < n; i++) { var sw = Math.sqrt(mult[i] * wt[i]); for (j = 0; j < p; j++) Pw[i * p + j] = Phi[i * p + j] * sw; Yw[i * 2] = Y[i * 2] * sw; Yw[i * 2 + 1] = Y[i * 2 + 1] * sw; }
    this.W.push(CY.la.ridge(Pw, n, p, Yw, 2, 1e-3));
  }
};
/* members' endings for (s, a) into out (E x 2); returns the ensemble mean as out[E*2], out[E*2+1] */
ZO.Model.prototype.ask = function (s, a, out) {
  var phi = this.buf, p = this.p, E = this.W.length, e, j, ox, oy, W, mx = 0, my = 0;
  this.feat.of(s, a, phi);
  for (e = 0; e < E; e++) {
    W = this.W[e]; ox = 0; oy = 0;
    for (j = 0; j < p; j++) { ox += phi[j] * W[j * 2]; oy += phi[j] * W[j * 2 + 1]; }
    out[e * 2] = 8 * ox; out[e * 2 + 1] = 5 * oy; mx += 8 * ox; my += 5 * oy;
  }
  out[E * 2] = mx / E; out[E * 2 + 1] = my / E;
  return out;
};

/* ───────────── the fixed sets every model is graded on ───────────── */
/* N launches rolled to the nudge, KMAX candidate nudges (uniform in the disc of radius 3; the same for every set), and the true ending of every launch under every candidate. */
ZO.makeSets = function (N, seed) {
  var K = ZO.KMAX, r = CY.rng(seed), rc = CY.rng(77), i, k, e, S = { N: N, L: [], A: [], TE: new Float64Array(N * K * 2) };
  for (i = 0; i < N; i++) S.L.push(ZO.launchAt(r));
  for (k = 0; k < K; k++) S.A.push(ZO.disc(rc, ZO.AMAX));
  for (i = 0; i < N; i++) for (k = 0; k < K; k++) { e = ZO.ending(ZO.W0, S.L[i], S.A[k]); S.TE[(i * K + k) * 2] = e[0]; S.TE[(i * K + k) * 2 + 1] = e[1]; }
  return S;
};
var SETS = null;
ZO.sets = function () {                                              // the benchmark: 100 launches, and 300 nudges set by fiat for the intervention exam
  if (SETS) return SETS;
  var ri = CY.rng(99), i, d;
  SETS = ZO.makeSets(ZO.NDEC, 5); SETS.DO = [];
  for (i = 0; i < ZO.NDO; i++) { d = { s: ZO.launchAt(ri), a: ZO.disc(ri, ZO.AMAX) }; d.e = ZO.ending(ZO.W0, d.s, d.a); SETS.DO.push(d); }
  return SETS;
};

/* ───────────── exams ───────────── */
/* the model's answer to every (launch, candidate) of a set: PE = ensemble mean, PM[e] = member e (index (i*K+k)*2) */
ZO.predict = function (m, S) {
  var N = S.N, K = ZO.KMAX, E = ZO.E, out = new Float64Array(2 * E + 2), P = { PE: new Float64Array(N * K * 2), PM: [] }, i, k, e, q;
  for (e = 0; e < E; e++) P.PM.push(new Float64Array(N * K * 2));
  for (i = 0; i < N; i++) for (k = 0; k < K; k++) {
    m.ask(S.L[i], S.A[k], out); q = (i * K + k) * 2;
    P.PE[q] = out[2 * E]; P.PE[q + 1] = out[2 * E + 1];
    for (e = 0; e < E; e++) { P.PM[e][q] = out[e * 2]; P.PM[e][q + 1] = out[e * 2 + 1]; }
  }
  return P;
};
/* everything one model is graded on, computed once */
ZO.grade = function (m, zseed) {
  var S = ZO.sets(), E = ZO.E, out = new Float64Array(2 * E + 2), g = { rc: m.rc, rlog: m.rlog }, i, e, d, own, se, cov, nn, sd;
  own = ZO.trials(ZO.NOWN, 50000 + zseed, m.rc); se = 0; cov = 0; nn = 0;
  for (i = 0; i < own.length; i++) {                                 // the model's own log: held-out error and the coverage of its 90 % intervals
    m.ask(own[i].s, own[i].a, out); var mx = out[2 * E], my = out[2 * E + 1], vx = 0, vy = 0;
    for (e = 0; e < E; e++) { vx += (out[e * 2] - mx) * (out[e * 2] - mx); vy += (out[e * 2 + 1] - my) * (out[e * 2 + 1] - my); }
    var sgx = Math.sqrt(vx / E), sgy = Math.sqrt(vy / E);
    se += Math.pow(mx - own[i].e[0], 2) + Math.pow(my - own[i].e[1], 2);
    if (Math.abs(mx - own[i].e[0]) <= 1.645 * sgx) cov++;
    if (Math.abs(my - own[i].e[1]) <= 1.645 * sgy) cov++;
    nn += 2;
  }
  g.own = Math.sqrt(se / own.length); g.cov = cov / nn;
  sd = 0; for (i = 0; i < S.DO.length; i++) { d = S.DO[i]; m.ask(d.s, d.a, out); sd += Math.pow(out[2 * E] - d.e[0], 2) + Math.pow(out[2 * E + 1] - d.e[1], 2); }
  g.dox = Math.sqrt(sd / S.DO.length);
  var P = ZO.predict(m, S); g.PE = P.PE; g.PM = P.PM;
  return g;
};
/* the planner on a prediction table P for goal g: for every K = 1..KMAX the share of launches where the pick (the candidate with the smallest imagined miss among the first K)
 * really hits (real), where the model claims a hit (imag), and where the pick lies beyond rlog (out).  `judge` (optional) is another table that grades the same picks. */
ZO.planner = function (P, g, rlog, judge, S) {
  S = S || ZO.sets(); var N = S.N, K = ZO.KMAX, real = new Float64Array(K), imag = new Float64Array(K), out = new Float64Array(K), jud = judge ? new Float64Array(K) : null, i, k, best, bi, q, m;
  for (i = 0; i < N; i++) {
    best = Infinity; bi = 0;
    for (k = 0; k < K; k++) {
      q = (i * K + k) * 2; m = Math.hypot(P[q] - g.x, P[q + 1] - g.y);
      if (m < best) { best = m; bi = k; }
      if (Math.hypot(S.TE[(i * K + bi) * 2] - g.x, S.TE[(i * K + bi) * 2 + 1] - g.y) < g.r) real[k] += 1 / N;
      if (best < g.r) imag[k] += 1 / N;
      if (rlog !== undefined && Math.hypot(S.A[bi][0], S.A[bi][1]) > rlog) out[k] += 1 / N;
      if (judge && Math.hypot(judge[(i * K + bi) * 2] - g.x, judge[(i * K + bi) * 2 + 1] - g.y) < g.r) jud[k] += 1 / N;
    }
  }
  return { real: real, imag: imag, out: out, judged: jud };
};
/* the exact model: the simulator itself */
ZO.exact = function (g, S) { S = S || ZO.sets(); return ZO.planner(S.TE, g, undefined, undefined, S); };

/* ───────────── statistics ───────────── */
/* Kendall's tau-b between x and y (ties counted as in tau-b) */
ZO.tau = function (x, y) {
  var n = x.length, c = 0, d = 0, tx = 0, ty = 0, i, j, a, b;
  for (i = 0; i < n; i++) for (j = i + 1; j < n; j++) {
    a = Math.sign(x[i] - x[j]); b = Math.sign(y[i] - y[j]);
    if (a === 0 && b === 0) continue; if (a === 0) tx++; else if (b === 0) ty++; else if (a === b) c++; else d++;
  }
  return (c - d) / Math.sqrt((c + d + tx) * (c + d + ty));
};

ZO.build = function (zseed) {
  var zoo = { zseed: zseed, models: [], grades: [] }, i;
  ZO.sets();
  for (i = 0; i < ZO.RECIPES.length; i++) { var m = new ZO.Model(ZO.RECIPES[i], zseed); zoo.models.push(m); zoo.grades.push(ZO.grade(m, zseed)); }
  return zoo;
};
/* launches needed per policy to tell success rates p1 and p2 apart (two-sided alpha = 0.05, power 0.8, normal approximation of the binomial) */
ZO.nNeeded = function (p1, p2) {
  var pb = (p1 + p2) / 2, za = 1.959964, zb = 0.841621, d = Math.abs(p1 - p2);
  if (d < 1e-9) return Infinity;
  return Math.pow(za * Math.sqrt(2 * pb * (1 - pb)) + zb * Math.sqrt(p1 * (1 - p1) + p2 * (1 - p2)), 2) / (d * d);
};

/* ───────────── the session: the zoo, graded, and what the planner makes of it for each goal ───────────── */
ZO.RUNGS = [
  { id: 'own', name: 'held-out error on its own log',      unit: 'm', log: true,  of: function (g) { return g.own; },                              sign: -1 },
  { id: 'cal', name: 'coverage of its 90 % intervals',      unit: '%', log: false, of: function (g) { return 100 * g.cov; },                        sign: 1, ideal: 90 },
  { id: 'dox', name: 'error under nudges set by fiat',      unit: 'm', log: true,  of: function (g) { return g.dox; },                              sign: -1 },
  { id: 'img', name: 'success it imagines for itself',      unit: '%', log: false, of: function (g, p, K) { return 100 * p.imag[K - 1]; },           sign: 1 },
  { id: 'jud', name: 'success judged by its held-out half', unit: '%', log: false, of: function (g, p, K, jd) { return 100 * jd.judged[K - 1]; },    sign: 1 }
];
ZO.half = function (A, B) { var o = new Float64Array(A.length), i; for (i = 0; i < o.length; i++) o[i] = 0.5 * (A[i] + B[i]); return o; };
ZO.session = function (zseed) {
  var S = { zoo: ZO.build(zseed), plan: [], jud: [], ex: [], n: ZO.RECIPES.length }, gi, j, g;
  for (gi = 0; gi < ZO.GOALS.length; gi++) {
    S.ex.push(ZO.exact(ZO.GOALS[gi])); S.plan.push([]); S.jud.push([]);
    for (j = 0; j < S.n; j++) {
      g = S.zoo.grades[j];
      S.plan[gi].push(ZO.planner(g.PE, ZO.GOALS[gi], S.zoo.models[j].rlog));
      S.jud[gi].push(ZO.planner(ZO.half(g.PM[0], g.PM[1]), ZO.GOALS[gi], S.zoo.models[j].rlog, ZO.half(g.PM[2], g.PM[3])));   // plan with half the members, let the other half grade the picks
    }
  }
  return S;
};
/* the number the scatter plots for model j on rung r (and the number whose ordering is compared with the decision's) */
ZO.score = function (S, r, j, K, gi) { var R = ZO.RUNGS[r], v = R.of(S.zoo.grades[j], S.plan[gi][j], K, S.jud[gi][j]); return R.ideal !== undefined ? -Math.abs(v - R.ideal) : R.sign * v; };
ZO.tauOf = function (S, r, K, gi) {
  var x = [], y = [], j; for (j = 0; j < S.n; j++) { x.push(ZO.score(S, r, j, K, gi)); y.push(S.plan[gi][j].real[K - 1]); }
  return ZO.tau(x, y);
};
/* the model with the best held-out error, and the model with the best decision at budget K for goal gi (best[0] = first one in case of a tie) */
ZO.reversal = function (S, K, gi) {
  var gr = S.zoo.grades, pretty = 0, useful = 0, j;
  for (j = 1; j < S.n; j++) { if (gr[j].own < gr[pretty].own) pretty = j; if (S.plan[gi][j].real[K - 1] > S.plan[gi][useful].real[K - 1]) useful = j; }
  return { pretty: pretty, useful: useful, same: pretty === useful };
};
/* where one model's pick for a launch goes: imagined ending, real ending, and the true path of that nudge */
ZO.pick = function (S, j, i, K, gi) {
  var P = S.zoo.grades[j].PE, g = ZO.GOALS[gi], KM = ZO.KMAX, best = Infinity, bi = 0, k, m, sets = ZO.sets(), q, pts, s, a;
  for (k = 0; k < K; k++) { m = Math.hypot(P[(i * KM + k) * 2] - g.x, P[(i * KM + k) * 2 + 1] - g.y); if (m < best) { best = m; bi = k; } }
  q = (i * KM + bi) * 2; a = sets.A[bi]; s = sets.L[i];
  var st = CY.step(ZO.W0, s, a); pts = [[s[0], s[1]], [st[0], st[1]]];
  for (k = 0; k < ZO.TF; k++) { st = CY.step(ZO.W0, st, null); pts.push([st[0], st[1]]); }
  return { k: bi, a: a, imag: [P[q], P[q + 1]], real: [sets.TE[q], sets.TE[q + 1]], imissed: best, rmiss: Math.hypot(sets.TE[q] - g.x, sets.TE[q + 1] - g.y), path: pts };
};

/* ───────────── the widget: one setting of the controls -> numbers and a picture ───────────── */
ZO.DEFAULT = { rung: 0, kidx: 6, A: 8, B: 4, launch: 40, goal: 0 };    // narrow against big, held-out error, K = 64, the series' goal, a launch on which narrow imagines a hit and misses by 2 m
ZO.compute = function (S, v) {
  var K = Math.pow(2, v.kidx), gi = v.goal, c = { K: K, gi: gi, g: ZO.GOALS[gi] }, j, r;
  c.xs = []; c.ys = []; c.vals = [];
  for (j = 0; j < S.n; j++) { c.vals.push(ZO.RUNGS[v.rung].of(S.zoo.grades[j], S.plan[gi][j], K, S.jud[gi][j])); c.ys.push(S.plan[gi][j].real[K - 1]); }
  c.tau = ZO.tauOf(S, v.rung, K, gi); c.taus = []; for (r = 0; r < ZO.RUNGS.length; r++) c.taus.push(ZO.tauOf(S, r, K, gi));
  c.rev = ZO.reversal(S, K, gi); c.exact = S.ex[gi].real[K - 1];
  var best = 0; for (j = 1; j < S.n; j++) if (ZO.score(S, v.rung, j, K, gi) > ZO.score(S, v.rung, best, K, gi)) best = j;
  c.best = best;
  c.pa = ZO.pick(S, v.A, v.launch, K, gi); c.pb = ZO.pick(S, v.B, v.launch, K, gi);
  c.ra = S.plan[gi][v.A].real[K - 1]; c.rb = S.plan[gi][v.B].real[K - 1]; c.ia = S.plan[gi][v.A].imag[K - 1]; c.ib = S.plan[gi][v.B].imag[K - 1];
  c.nab = ZO.nNeeded(c.ra, c.rb);
  c.sea = Math.sqrt(c.ra * (1 - c.ra) / ZO.NDEC);
  return c;
};
/* the numbers of the readout row, as text (the first number of every entry is the one the lesson quotes) */
ZO.readouts = function (S, v, c) {
  var R = ZO.RUNGS[v.rung], pct = function (x) { return Math.round(100 * x) + ' %'; }, nm = function (j) { return ZO.RECIPES[j].name; }, o = {}, ex = function (j) {
    var val = R.of(S.zoo.grades[j], S.plan[c.gi][j], c.K, S.jud[c.gi][j]); return R.unit === 'm' ? val.toFixed(2) + ' m' : Math.round(val) + ' %';
  };
  o.rung = R.name; o.k = 'K = ' + c.K; o.ep = '#' + v.launch;
  o.tau = c.tau.toFixed(2); o.taus = c.taus.map(function (x) { return x.toFixed(2); }).join(' / ');
  o.best = nm(c.best) + ' · real ' + pct(c.ys[c.best]);
  o.a = pct(c.ra) + ' real · ' + pct(c.ia) + ' imagined · exam ' + ex(v.A);
  o.b = pct(c.rb) + ' real · ' + pct(c.ib) + ' imagined · exam ' + ex(v.B);
  o.rev = c.rev.same ? nm(c.rev.pretty) + ' wins both' : nm(c.rev.pretty) + ' ' + S.zoo.grades[c.rev.pretty].own.toFixed(2) + ' m, real ' + pct(c.ys[c.rev.pretty]) + ' · ' + nm(c.rev.useful) + ' ' + S.zoo.grades[c.rev.useful].own.toFixed(2) + ' m, real ' + pct(c.ys[c.rev.useful]);
  o.n = isFinite(c.nab) ? '' + Math.ceil(c.nab) : 'tie';
  o.pick = 'A imagines ' + c.pa.imissed.toFixed(2) + ' m, lands ' + c.pa.rmiss.toFixed(2) + ' m · B imagines ' + c.pb.imissed.toFixed(2) + ' m, lands ' + c.pb.rmiss.toFixed(2) + ' m';
  return o;
};
ZO.layout = function (w) {
  var m = 8, narrow = w < 600, L = { narrow: narrow, m: m, w: w };
  if (narrow) {
    var aw = w - 2 * m, ah = Math.round(aw * 5 / 8);
    L.sc = { x: m, y: m, w: aw, h: 340 }; L.ar = { x: m, y: 340 + 2 * m, w: aw, h: ah }; L.cu = { x: m, y: 340 + ah + 4 * m + 18, w: aw, h: 178 };
    L.h = L.cu.y + L.cu.h + m;
  } else {
    var lw = Math.round(w * 0.5) - m, rw = w - lw - 3 * m, ah2 = Math.min(Math.round(rw * 5 / 8), 215);
    L.sc = { x: m, y: m, w: lw, h: 470 - 2 * m }; L.ar = { x: lw + 2 * m, y: m, w: rw, h: ah2 }; L.cu = { x: lw + 2 * m, y: m + ah2 + 34, w: rw, h: 470 - ah2 - 34 - 2 * m };
    L.h = 470;
  }
  return L;
};
var FAM = { A: CY.C.purple, B: CY.C.amber };
function nice(v, d) { return v.toFixed(d); }
ZO.paint = function (cv, S, v, c) {
  var D = CY.draw, C = CY.C, L = ZO.layout(cv.clientWidth || 640), st = D.setup(cv), ctx = st.ctx, j, k, R = ZO.RUNGS[v.rung];
  /* scatter: this exam against the real success of the planner, better to the right */
  var sc = L.sc, px = sc.x + 40, py = sc.y + 38, pw = sc.w - 40 - 12, ph = sc.h - 38 - 70;
  D.frame(ctx, sc.x, sc.y, sc.w, sc.h, C.white);
  D.mono(ctx, 'exam: ' + R.name, sc.x + 8, sc.y + 11, C.ink, 9);
  D.mono(ctx, '\u03c4 = ' + c.tau.toFixed(2), sc.x + sc.w - 8, py - 9, C.purple, 10, 'right');   // one row below the exam name, which can be long
  var us = c.vals.map(function (x) { return R.log ? -Math.log10(x) : x; }), lo = Math.min.apply(null, us), hi = Math.max.apply(null, us), pad = (hi - lo) * 0.08 + 1e-9;
  if (R.ideal !== undefined) { lo = Math.min(lo, 0); hi = Math.max(hi, 100); pad = 0; } else if (!R.log) { lo = Math.min(lo, 40); hi = Math.max(hi, 100); }
  lo -= pad; hi += pad;
  var X = function (u) { return px + (u - lo) / (hi - lo) * pw; }, Y = function (y) { return py + ph * (1 - y); };
  [0, 0.25, 0.5, 0.75, 1].forEach(function (g) { D.line(ctx, px, Y(g), px + pw, Y(g), C.grid, 1); D.mono(ctx, Math.round(100 * g) + '', px - 5, Y(g), C.mute, 9, 'right'); });
  D.mono(ctx, 'real success of the planner, %', sc.x + 8, py - 9, C.mute, 9);
  var ticks = R.log ? (R.id === 'own' ? [0.3, 0.5, 1, 1.5] : [0.5, 1, 2, 5, 10]) : [0, 25, 50, 75, 100];
  ticks.forEach(function (tv) { var u = R.log ? -Math.log10(tv) : tv; if (u < lo || u > hi) return; D.line(ctx, X(u), py, X(u), py + ph, C.grid, 1); D.mono(ctx, tv + '', X(u), py + ph + 10, C.mute, 9, 'center'); });
  if (R.ideal !== undefined) D.line(ctx, X(90), py, X(90), py + ph, C.green, 1, [3, 3]);
  D.mono(ctx, R.name + ' (' + R.unit + '), better →', px + pw, py + ph + 24, C.mute, 9, 'right');
  D.line(ctx, px, Y(c.exact), px + pw, Y(c.exact), C.dim, 1.2, [5, 4]); D.mono(ctx, 'exact model ' + Math.round(100 * c.exact), px + 4, Y(c.exact) + (c.exact > 0.9 ? 8 : -7), C.dim, 9);
  for (j = 0; j < S.n; j++) {
    var cx = X(us[j]), cy = Y(c.ys[j]), isA = j === v.A, isB = j === v.B;
    D.dot(ctx, cx, cy, 9, isA ? C.purpleSoft : isB ? C.amberSoft : C.white, isA ? FAM.A : isB ? FAM.B : C.dim);
    if (isA || isB) { ctx.save(); ctx.strokeStyle = isA ? FAM.A : FAM.B; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(cx, cy, 9, 0, 2 * Math.PI); ctx.stroke(); ctx.restore(); }
  }
  /* the star (a shape, not text) beside the best model; then the model numbers: dots can sit on top of one another, so each number takes the
     first of a few nearby places whose box is free of the numbers placed before it, of the star and of the axis and header text */
  var bx = X(us[c.best]), by = Y(c.ys[c.best]), boxes = [[sc.x, sc.x + sc.w + 40, sc.y, py - 3], [px - 36, px - 1, py - 8, py + ph + 6], [px - 8, px + pw + 40, py + ph + 6, py + ph + 36], [sc.x + sc.w - 3, sc.x + sc.w + 40, sc.y, sc.y + sc.h]];
  var ey = Y(c.exact) + (c.exact > 0.9 ? 8 : -7), OFF = [[0, 0]], order = [v.A, v.B, c.best], put = {};
  [10, 20, 30, 40, 50].forEach(function (r) { OFF.push([0, -r], [0, r], [-r - 1, 0], [r + 1, 0], [-r, -r], [r, -r], [-r, r], [r, r]); });      // five rings of places round a dot
  var isFree = function (b) { return boxes.every(function (q) { return b[1] <= q[0] || b[0] >= q[1] || b[3] <= q[2] || b[2] >= q[3]; }); };
  ctx.save(); ctx.fillStyle = C.green; ctx.beginPath();
  for (k = 0; k < 10; k++) ctx.lineTo(bx + 11 + (k % 2 ? 2.5 : 6) * Math.cos(-Math.PI / 2 + k * Math.PI / 5), by - 11 + (k % 2 ? 2.5 : 6) * Math.sin(-Math.PI / 2 + k * Math.PI / 5));
  ctx.closePath(); ctx.fill(); ctx.restore();
  boxes.push([bx + 4, bx + 18, by - 18, by - 4], [px + 3, px + 8 + 5.7 * ('exact model ' + Math.round(100 * c.exact)).length, ey - 5.5, ey + 5.5]);
  for (j = 0; j < S.n; j++) if (order.indexOf(j) < 0) order.push(j);
  order.forEach(function (jj) {
    if (put[jj]) return;
    var w = 5.7 * String(jj + 1).length, x0 = X(us[jj]), y0 = Y(c.ys[jj]), t, o, b;
    for (t = 0; t < OFF.length; t++) { o = OFF[t]; b = [x0 + o[0] - w / 2, x0 + o[0] + w / 2, y0 + o[1] - 5, y0 + o[1] + 5]; if (isFree(b)) break; }
    if (t === OFF.length) { o = OFF[0]; b = [x0 - w / 2, x0 + w / 2, y0 - 5, y0 + 5]; }
    boxes.push(b); put[jj] = o;
  });
  for (j = 0; j < S.n; j++) {
    var o = put[j], d = Math.hypot(o[0], o[1]);
    if (d > 15) D.line(ctx, X(us[j]) + o[0] * 9 / d, Y(c.ys[j]) + o[1] * 9 / d, X(us[j]) + o[0] * (1 - 6 / d), Y(c.ys[j]) + o[1] * (1 - 6 / d), C.dim, 0.8);     // a thin leader from a displaced number to its dot
    D.mono(ctx, '' + (j + 1), X(us[j]) + o[0], Y(c.ys[j]) + o[1], C.ink, 9, 'center');
  }
  for (j = 0; j < S.n; j++) D.mono(ctx, (j + 1) + ' ' + ZO.RECIPES[j].name, sc.x + 8 + (j % 3) * Math.round((sc.w - 16) / 3), sc.y + sc.h - 34 + Math.floor(j / 3) * 9 + (L.narrow ? 0 : 0), j === v.A ? FAM.A : j === v.B ? FAM.B : C.mute, 8);
  /* arena: the two models' picks for one launch */
  var ar = L.ar, W0 = ZO.W0, vw = D.view(ar.x, ar.y, ar.w, ar.h, 0, 8, 0, 5), world = { W: W0.W, H: W0.H, goal: c.g, curtain: null, posts: [], diamonds: [] };
  D.arena(ctx, vw, world, { curtain: false });
  var s0 = ZO.sets().L[v.launch], lastA = [-99, -99];
  [[c.pa, FAM.A, 'A', v.A], [c.pb, FAM.B, 'B', v.B]].forEach(function (q) {
    var pk = q[0], col = q[1];
    D.path(ctx, pk.path.map(function (u) { return [vw.X(u[0]), vw.Y(u[1])]; }), col, 1.8);
    D.line(ctx, vw.X(pk.imag[0]), vw.Y(pk.imag[1]), vw.X(pk.real[0]), vw.Y(pk.real[1]), col, 1, [3, 3]);
    ctx.save(); ctx.strokeStyle = col; ctx.lineWidth = 2; ctx.setLineDash([2, 2]); ctx.beginPath(); ctx.arc(vw.X(pk.imag[0]), vw.Y(pk.imag[1]), 6, 0, 2 * Math.PI); ctx.stroke(); ctx.restore();
    D.dot(ctx, vw.X(pk.real[0]), vw.Y(pk.real[1]), 5, col, C.white);
    D.arrow(ctx, vw.X(s0[0]), vw.Y(s0[1]), vw.X(s0[0] + 0.35 * pk.a[0]), vw.Y(s0[1] + 0.35 * pk.a[1]), col, 2, 6);
    var lx = vw.X(pk.real[0]) + 8, ly = vw.Y(pk.real[1]) - 8;
    if (q[2] === 'B' && Math.abs(lx - lastA[0]) < 9 && Math.abs(ly - lastA[1]) < 12) ly += 14;      // B lands where A landed: its letter steps down
    if (q[2] === 'A') lastA = [lx, ly];
    D.label(ctx, q[2], lx, ly, col, 10);
  });
  D.dot(ctx, vw.X(s0[0]), vw.Y(s0[1]), 4, C.ink, C.white);
  D.arrow(ctx, vw.X(s0[0]), vw.Y(s0[1]), vw.X(s0[0] + 0.35 * s0[2]), vw.Y(s0[1] + 0.35 * s0[3]), C.ink, 1.5, 6);
  D.mono(ctx, 'launch #' + v.launch + ' · ring imagined, dot real', ar.x + 4, ar.y + ar.h + 9, C.mute, 8);
  /* success against the planner's budget K */
  var cu = L.cu, qx = cu.x + 30, qy = cu.y + 24, qw = cu.w - 40, qh = cu.h - 68, XK = function (i) { return qx + i / 7 * qw; }, YS = function (y) { return qy + qh * (1 - y); };
  D.frame(ctx, cu.x, cu.y, cu.w, cu.h, C.white);
  [0, 0.5, 1].forEach(function (g) { D.line(ctx, qx, YS(g), qx + qw, YS(g), C.grid, 1); D.mono(ctx, Math.round(100 * g) + '', qx - 4, YS(g), C.mute, 9, 'right'); });
  for (k = 0; k <= 7; k += 1) D.mono(ctx, '' + Math.pow(2, k), XK(k), qy + qh + 10, C.mute, 9, 'center');
  D.mono(ctx, 'planner budget K (candidate nudges)', qx + qw / 2, qy + qh + 22, C.mute, 9, 'center'); D.mono(ctx, 'success, %', cu.x + 6, cu.y + 9, C.mute, 9);
  var line = function (arr, col, w, dash) { var pts = []; for (var i = 0; i <= 7; i++) pts.push([XK(i), YS(arr[Math.pow(2, i) - 1])]); D.path(ctx, pts, col, w, dash); };
  line(S.ex[c.gi].real, C.dim, 1.5);
  line(S.plan[c.gi][v.A].real, FAM.A, 2.2); line(S.plan[c.gi][v.A].imag, FAM.A, 1.5, [4, 3]);
  line(S.plan[c.gi][v.B].real, FAM.B, 2.2); line(S.plan[c.gi][v.B].imag, FAM.B, 1.5, [4, 3]);
  D.line(ctx, XK(v.kidx), qy, XK(v.kidx), qy + qh, C.ink, 1, [2, 3]);
  D.mono(ctx, 'solid: real   dashed: imagined   grey: exact model', cu.x + 6, cu.y + cu.h - 8, C.mute, 8);
};

if (typeof module !== 'undefined' && module.exports) module.exports = ZO;
root.ZO = ZO;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
