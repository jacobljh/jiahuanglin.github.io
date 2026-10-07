/* l12_proof.js — Lesson 12 (proof): what real trials can prove, what a program is worth as an evaluator, and what the evidence costs.   Load after street.js and l12_data.js.   Namespace SV.l12.   Browser and node.
 *
 * THE PROOF.  A claim "the collision probability p of a step-out is below eps" is a statement about the street.  n independent real trials with f collisions bound p from above by the exact (Clopper-Pearson) limit,
 * the p at which seeing f or fewer collisions has probability alpha = 0.05; with f = 0 that is 1 - 0.05^(1/n), about 3/n (the rule of three).                 L.cpUpper, L.cpLower, L.nFor, L.ruleOfThree
 * THE EVALUATOR.  SV.L12 (builder: tools/chain/verify/engine/build_l12.js) holds the closed-loop outcomes of Lesson 11's loop for twelve candidate systems in five worlds (four programs and the street, a LAB PRIVILEGE):
 * per episode a decision frame and a collision bit, per world the pedestrian's near surface.  L.pool decodes one world; the stopping margin is closed form from (near surface, decision frame).
 * A REAL CAMPAIGN of n episodes per candidate is simulated by drawing n of the street's stored episodes per candidate, with replacement and independently (a project cannot replay one real situation with another candidate): L.draw.
 * The agreement of an evaluator's ranking with the ranking such a campaign estimates is Spearman's rho (average ranks, ties allowed); L.campaigns repeats the campaign R times with seeded draws.
 * AIMING.  Variances of the estimate of a rate under allocations of trials to strata (natural, proportional, Neyman by a program's predicted risk, with a floor): L.varSRS, varProp, varNeyman, alloc, varAlloc.
 * Deterministic: no Math.random, no Date.  Seeds of this lesson: 22,000,000 and up (the builder's situations; the campaigns' draws use SV.rng(L.SEED + r)). */
(function (root) {
'use strict';
var SV = root.SV, L = {};
SV.l12 = L;

L.ALPHA = 0.05;
L.Z95 = 1.959964;
L.SEED = 22700000;               // repeat r of a simulated campaign draws with SV.rng(L.SEED + r)
L.R = 400;                       // simulated campaigns per setting
L.GRID = [10, 20, 40, 80, 160, 320, 640, 1280, 2560, 10000, 30000, 100000];
L.NMAX = 2560;                   // campaigns are simulated up to this many episodes per candidate
L.TOL = 0.01;                    // "a best candidate": its street collision rate is within one point of the best's
L.RHO = 0.9;                     // "the evaluator agrees": rank correlation above this
L.EVALS = ['exam', 'aaaa', 'aaba', 'abba', 'bbba'];

/* ───────── exact binomial bounds ───────── */
/* log P(X <= f) for X ~ Binomial(n, p): the terms t(i+1) = t(i) (n - i)/(i + 1) p/(1 - p) from t(0) = (1 - p)^n, added in logs (no underflow) */
L.logBinomCdf = function (f, n, p) {
  var lp = Math.log(p / (1 - p)), lt = n * Math.log1p(-p), s = lt, i;
  for (i = 0; i < f; i++) { lt += Math.log((n - i) / (i + 1)) + lp; s = lt > s ? lt + Math.log1p(Math.exp(s - lt)) : s + Math.log1p(Math.exp(lt - s)); }
  return s;
};
L.binomCdf = function (f, n, p) { return f >= n || p <= 0 ? 1 : p >= 1 ? 0 : Math.exp(L.logBinomCdf(f, n, p)); };
/* the upper limit: the p at which P(X <= f) = alpha, by bisection (the cdf falls as p grows) */
L.cpUpper = function (f, n, alpha) {
  alpha = alpha || L.ALPHA;
  if (f >= n) return 1;
  var lo = 0, hi = 1, mid, i;
  for (i = 0; i < 100; i++) { mid = (lo + hi) / 2; if (L.binomCdf(f, n, mid) > alpha) lo = mid; else hi = mid; }
  return (lo + hi) / 2;
};
/* the lower limit: the p at which P(X >= f) = alpha */
L.cpLower = function (f, n, alpha) {
  alpha = alpha || L.ALPHA;
  if (f <= 0) return 0;
  var lo = 0, hi = 1, mid, i;
  for (i = 0; i < 100; i++) { mid = (lo + hi) / 2; if (1 - L.binomCdf(f - 1, n, mid) < alpha) lo = mid; else hi = mid; }
  return (lo + hi) / 2;
};
L.ruleOfThree = function (n) { return 3 / n; };
/* the fewest trials n with f collisions whose exact upper limit is at most eps */
L.nFor = function (eps, f, alpha) {
  alpha = alpha || L.ALPHA;
  if (f === 0) return Math.ceil(Math.log(alpha) / Math.log1p(-eps));
  var lo = f + 1, hi = lo, mid;
  while (L.cpUpper(f, hi, alpha) > eps) { lo = hi; hi *= 2; }
  while (hi - lo > 1) { mid = Math.floor((lo + hi) / 2); if (L.cpUpper(f, mid, alpha) > eps) lo = mid; else hi = mid; }
  return hi;
};
L.hours = function (n, T) { return n * T; };                                  // real driving hours when a close step-out comes once per T hours

/* ───────── rank statistics ───────── */
L.avgRanks = function (a) {
  var idx = a.map(function (v, i) { return i; }).sort(function (i, j) { return a[i] - a[j]; }), r = new Array(a.length), s = 0, e, k;
  while (s < idx.length) { e = s; while (e + 1 < idx.length && a[idx[e + 1]] === a[idx[s]]) e++; for (k = s; k <= e; k++) r[idx[k]] = (s + e) / 2 + 1; s = e + 1; }
  return r;
};
L.pearson = function (x, y) {
  var n = x.length, mx = 0, my = 0, sxy = 0, sxx = 0, syy = 0, i;
  for (i = 0; i < n; i++) { mx += x[i]; my += y[i]; }
  mx /= n; my /= n;
  for (i = 0; i < n; i++) { sxy += (x[i] - mx) * (y[i] - my); sxx += (x[i] - mx) * (x[i] - mx); syy += (y[i] - my) * (y[i] - my); }
  return sxy / Math.sqrt(sxx * syy);
};
L.spearman = function (a, b) { return L.pearson(L.avgRanks(a), L.avgRanks(b)); };
/* Kendall's tau-b: (concordant - discordant) / sqrt((pairs - ties in a)(pairs - ties in b)) */
L.kendallB = function (a, b) {
  var c = 0, d = 0, ta = 0, tb = 0, n = a.length, i, j, x, y;
  for (i = 0; i < n; i++) for (j = i + 1; j < n; j++) {
    x = Math.sign(a[i] - a[j]); y = Math.sign(b[i] - b[j]);
    if (x === 0 && y === 0) continue;
    if (x === 0) ta++; else if (y === 0) tb++; else if (x === y) c++; else d++;
  }
  return (c - d) / Math.sqrt((c + d + ta) * (c + d + tb));
};

/* ───────── the stored worlds ───────── */
L.dStop = function (cfg) { return cfg.v0 * cfg.tau + cfg.v0 * cfg.v0 / (2 * cfg.a); };
var _pools = {};
/* one world under one operating-point protocol ('S': each candidate's exam threshold, 'W': the exam's rule applied inside the world):
 * {n, M, bits[j] (collision 0/1 per episode), mg[j] (stopping margin, m), rate[j], margin[j] (means), bin (stratum per episode)} */
L.pool = function (id, proto) {
  var key = id + (proto || 'S');
  if (_pools[key]) return _pools[key];
  var D = SV.L12, w = D.data[id], cfg = D.cfg, M = D.systems.length, n = w.n, ds = L.dStop(cfg), p = proto || 'S', out = { id: id, proto: p, n: n, M: M, bits: [], mg: [], rate: [], margin: [], bin: new Uint8Array(n) }, j, i, k, s, m, b, g;
  for (i = 0; i < n; i++) out.bin[i] = w.bin.charCodeAt(i) - 48;
  for (j = 0; j < M; j++) {
    b = new Uint8Array(n); g = new Float64Array(n); s = 0; m = 0;
    for (i = 0; i < n; i++) {
      k = w.kd[p][j].charCodeAt(i) - 49;
      b[i] = w.col[p][j].charCodeAt(i) - 48;
      g[i] = k < 0 ? -ds : w.zc[i] / 1000 - cfg.v0 * k * cfg.dt - ds;      // the stopping margin: the room left when a shuttle that decided at frame k has stopped
      s += b[i]; m += g[i];
    }
    out.bits.push(b); out.mg.push(g); out.rate.push(s / n); out.margin.push(m / n);
  }
  return (_pools[key] = out);
};
/* the rate of every candidate over the episodes of one stratum (NaN if the stratum is empty) */
L.stratumRates = function (pool, h) {
  var r = [], j, i, c = 0, s;
  for (i = 0; i < pool.n; i++) if (pool.bin[i] === h) c++;
  for (j = 0; j < pool.M; j++) { s = 0; for (i = 0; i < pool.n; i++) if (pool.bin[i] === h) s += pool.bits[j][i]; r.push(s / c); }
  return r;
};

/* ───────── simulated real campaigns ───────── */
/* repeat r of a campaign of n episodes per candidate: every candidate meets its own n situations, drawn with replacement from the street's stored ones (SV.rng(L.SEED + r), candidate after candidate) */
L.draw = function (pool, n, r) {
  var rng = SV.rng(L.SEED + r), rate = new Array(pool.M), margin = new Array(pool.M), j, i, q, k, m, N = pool.n, b, g;
  for (j = 0; j < pool.M; j++) {
    b = pool.bits[j]; g = pool.mg[j]; k = 0; m = 0;
    for (i = 0; i < n; i++) { q = Math.floor(rng() * N); k += b[q]; m += g[q]; }
    rate[j] = k / n; margin[j] = m / n;
  }
  return { rate: rate, margin: margin };
};
var _camp = {};
/* R campaigns of n episodes per candidate */
L.campaigns = function (pool, n, R) {
  var key = pool.id + pool.proto + ':' + n + ':' + R;
  if (_camp[key]) return _camp[key];
  var out = [], r;
  for (r = 0; r < R; r++) out.push(L.draw(pool, n, r));
  return (_camp[key] = out);
};
/* an evaluator is a pair of vectors over the candidates, {col: collision rates (worse = higher), mg: mean stopping margins (worse = lower)}; its agreement with each campaign's estimate */
L.agreement = function (camps, ev, useMargin) {
  return camps.map(function (c) { return useMargin ? L.spearman(ev.mg, c.margin) : L.spearman(ev.col, c.rate); });
};
L.evaluator = function (name) {
  var D = SV.L12, T = SV.TABLES;
  if (name === 'exam') { var m = D.systems.map(function (c) { return T.swap[c].realMiss[0]; }); return { col: m, mg: m.map(function (x) { return -x; }), name: name }; }
  var p = L.pool(name, 'S');
  return { col: p.rate, mg: p.margin, name: name };
};
/* the fraction of campaigns whose best-looking candidate has a street rate within tol of the street's best */
L.bestHit = function (camps, streetRate, tol, useMargin) {
  var best = Math.min.apply(null, streetRate), hit = 0;
  camps.forEach(function (c) { var v = useMargin ? c.margin.map(function (x) { return -x; }) : c.rate, j = v.indexOf(Math.min.apply(null, v)); if (streetRate[j] - best <= (tol === undefined ? L.TOL : tol) + 1e-12) hit++; });
  return hit / camps.length;
};
/* the summary a real campaign of n episodes per candidate gives about an evaluator: the mean agreement, the chance it exceeds RHO, the chance of picking a best candidate */
L.validate = function (street, ev, n, R, useMargin) {
  var camps = L.campaigns(street, n, R || L.R), rho = L.agreement(camps, ev, useMargin), s = 0, a = 0, i;
  for (i = 0; i < rho.length; i++) { s += rho[i]; if (rho[i] > L.RHO) a++; }
  return { n: n, mean: s / rho.length, p90: a / rho.length, hit: L.bestHit(camps, street.rate, L.TOL, useMargin), rho: rho };
};

/* ───────── aiming: the variance of the estimate of a rate under an allocation of trials to strata ───────── */
/* all variances are for ONE trial (multiply by 1/n): P = the strata's shares of the street's step-outs, p = the strata's collision probabilities */
L.varSRS = function (P, p) { var m = 0, h; for (h = 0; h < P.length; h++) m += P[h] * p[h]; return m * (1 - m); };
L.varProp = function (P, p) { var v = 0, h; for (h = 0; h < P.length; h++) v += P[h] * p[h] * (1 - p[h]); return v; };
L.varNeyman = function (P, p) { var s = 0, h; for (h = 0; h < P.length; h++) s += P[h] * Math.sqrt(p[h] * (1 - p[h])); return s * s; };
/* the shares of the trials a program's predicted risks pp ask for (Neyman), mixed with the natural shares so that no stratum is left blind: lam = the weight of the natural shares */
L.alloc = function (P, pp, lam) {
  var s = 0, h, w = [];
  for (h = 0; h < P.length; h++) s += P[h] * Math.sqrt(pp[h] * (1 - pp[h]));
  for (h = 0; h < P.length; h++) w.push((1 - lam) * P[h] * Math.sqrt(pp[h] * (1 - pp[h])) / s + lam * P[h]);
  return w;
};
L.varAlloc = function (P, p, w) { var v = 0, h; for (h = 0; h < P.length; h++) v += P[h] * P[h] * p[h] * (1 - p[h]) / w[h]; return v; };

if (typeof module !== 'undefined' && module.exports) module.exports = L;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
