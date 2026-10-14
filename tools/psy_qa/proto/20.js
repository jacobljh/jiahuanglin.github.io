// proto/20.js — lesson 20 群体 (DeGroot variant; replaces the lead's sequential-herding draft).  A TOY model: n, rho, lambda are demo values (示意).
// n judges estimate a quantity whose truth is T = 0, so each estimate IS its error.  Unit: one judge's typical error, sigma^2 = 1.
//   x_i = c + u_i,  c ~ N(0, rho)  an error SHARED by the whole crowd (same biased source);  u_i ~ N(0, 1-rho) independent.
// Round 0 = independent crowd.  Closed forms (DERIVED, FACTS_T7d §20 Widget constants):
//   E[crowd error²] = rho + (1-rho)/n ;  n_eff = n / (1 + (n-1) rho) ;  floor = rho ;  E[diversity] = (1-rho)(n-1)/n.
// Then 3 influence rounds (DeGroot, synchronous):  x' = W x.  Judge i moves toward the average of its listening set (4 ring neighbours i±1, i±2) by the fraction lambda:
//   W_ii = 1-lambda, W_ij = lambda/|N_i| for j in N_i.  Symmetric ring ⇒ W doubly stochastic ⇒ the crowd MEAN is preserved exactly; the spread shrinks.
//   Hub switch: judge 0 never moves (row = e_0) and everybody else also listens to judge 0 (added to N_i if it is not there already)
//   ⇒ column sums of W exceed 1 for judge 0 ⇒ the crowd mean drifts toward judge 0's own error (the Becker 2017 centralised pattern, simplified).
// After t rounds x^t = A x^0, A = W^t (rows sum to 1).  With pi_j = (1/n) sum_i A_ij (the weight of judge j's ORIGINAL answer in the crowd mean):
//   individual average error² = rho + (1-rho) S1,   S1 = (1/n) sum_ij A_ij²
//   crowd error²              = rho + (1-rho) S2,   S2 = sum_j pi_j²      (S2 = 1/n iff the weights are equal)
//   diversity                 = (1-rho) * (1/n) sum_i sum_j (A_ij - pi_j)²           (computed independently of S1, S2)
//   identity (exact):  individual average error² − diversity = crowd error²  → the gap prints 0.000.
// These are EXACT expectations over the draws (no sampling noise).  Only "share of members the crowd beats" is not a quadratic form → counted over
// R = 1000 seeded crowds (PSY.rng(1000 + r)), strictly more accurate counts (tolerance 1e-9).  The picture shows the crowd with seed 9.
var PSY = require('./_psy.js');
var R = 1000, SEED0 = 1000, SEED_PIC = 9, ROUNDS = 3;   // R seeded crowds for the 'beats members' count; the widget picture uses seed 9

function neighbours(n, i, hub) {
  var s = [];
  [-1, 1, -2, 2].forEach(function (k) { var j = ((i + k) % n + n) % n; if (j !== i && s.indexOf(j) < 0) s.push(j); });
  if (hub && i !== 0 && s.indexOf(0) < 0) s.push(0);
  return s;
}
function buildW(n, lam, hub) {
  var W = [], i, j, s;
  for (i = 0; i < n; i++) {
    W.push(new Array(n).fill(0));
    if (hub && i === 0) { W[0][0] = 1; continue; }
    s = neighbours(n, i, hub);
    W[i][i] = 1 - lam;
    for (j = 0; j < s.length; j++) W[i][s[j]] += lam / s.length;
  }
  return W;
}
function mul(A, B) {
  var n = A.length, C = [], i, j, k, a;
  for (i = 0; i < n; i++) { C.push(new Array(n).fill(0)); for (k = 0; k < n; k++) { a = A[i][k]; if (a !== 0) for (j = 0; j < n; j++) C[i][j] += a * B[k][j]; } }
  return C;
}
function power(W, t) { var A = W, k; for (k = 1; k < t; k++) A = mul(W, A); return A; }
function moments(A, rho) {   // exact expectations for x^t = A x^0
  var n = A.length, pi = new Array(n).fill(0), i, j, S1 = 0, S2 = 0, dv = 0;
  for (i = 0; i < n; i++) for (j = 0; j < n; j++) { pi[j] += A[i][j] / n; S1 += A[i][j] * A[i][j] / n; }
  for (j = 0; j < n; j++) S2 += pi[j] * pi[j];
  for (i = 0; i < n; i++) for (j = 0; j < n; j++) dv += (A[i][j] - pi[j]) * (A[i][j] - pi[j]) / n;
  var ind = rho + (1 - rho) * S1, crowd = rho + (1 - rho) * S2, div = (1 - rho) * dv;
  return { ind: ind, crowd: crowd, div: div, gap: ind - div - crowd, pi: pi };
}
function draw(r, n, rho) {
  var rng = PSY.rng(SEED0 + r), zc = PSY.gauss(rng), x = [], i;
  for (i = 0; i < n; i++) x.push(Math.sqrt(rho) * zc + Math.sqrt(1 - rho) * PSY.gauss(rng));
  return x;
}
function apply(A, x) { return A.map(function (row) { var s = 0, j; for (j = 0; j < x.length; j++) s += row[j] * x[j]; return s; }); }
function beatShare(A, n, rho) {   // average over R seeded crowds of the share of members whose |error| exceeds the crowd mean's |error|
  var r, x, y, m, i, c, tot = 0;
  for (r = 0; r < R; r++) {
    x = apply(A, draw(r, n, rho)); m = 0; for (i = 0; i < n; i++) m += x[i]; m /= n;
    c = 0; for (i = 0; i < n; i++) if (Math.abs(x[i]) > Math.abs(m) + 1e-9) c++;
    tot += c / n;
  }
  return tot / R;
}
function run(o) {
  var W = buildW(o.n, o.lam, o.hub), A0 = [], i, A3 = power(W, ROUNDS);
  for (i = 0; i < o.n; i++) { A0.push(new Array(o.n).fill(0)); A0[i][i] = 1; }
  var m0 = moments(A0, o.rho), m3 = moments(A3, o.rho);
  return { m0: m0, m3: m3, b0: beatShare(A0, o.n, o.rho), b3: beatShare(A3, o.n, o.rho), neff: o.n / (1 + (o.n - 1) * o.rho), theory: o.rho + (1 - o.rho) / o.n, pihub: m3.pi[0] };
}
function f(v, k) { return v.toFixed(k === undefined ? 3 : k); }
if (require.main === module) {
  var base = { n: 25, rho: 0.2, lam: 0.4, hub: false };
  function show(name, o) {
    var q = run(o);
    console.log(name, '| theory crowd', f(q.theory), 'n_eff', f(q.neff, 2), '| pi_0 after', f(q.pihub));
    console.log('   r0: ind', f(q.m0.ind), 'div', f(q.m0.div), 'crowd', f(q.m0.crowd), 'beat', f(q.b0, 3), 'gap', f(q.m0.gap));
    console.log('   r3: ind', f(q.m3.ind), 'div', f(q.m3.div), 'crowd', f(q.m3.crowd), 'beat', f(q.b3, 3), 'gap', f(q.m3.gap));
  }
  var P = function (d) { var o = {}; for (var k in base) o[k] = base[k]; for (k in d) o[k] = d[k]; return o; };
  show('default (n 25, rho .2, lam .4, no hub)', P({}));
  show('independent (lam 0)', P({ lam: 0 }));
  show('hub (lam .4)', P({ hub: true }));
  show('hub, lam .6', P({ hub: true, lam: 0.6 }));
  show('hub, lam .8', P({ hub: true, lam: 0.8 }));
  show('hub, rho .1', P({ hub: true, rho: 0.1 }));
  show('hub, rho 0', P({ hub: true, rho: 0 }));
  show('hub, rho .1, lam .6', P({ hub: true, rho: 0.1, lam: 0.6 }));
  show('rho .8 no influence', P({ rho: 0.8, lam: 0 }));
  show('rho .8 influence', P({ rho: 0.8 }));
  show('n 5', P({ n: 5 }));
  show('n 60', P({ n: 60 }));
  show('n 60 hub', P({ n: 60, hub: true }));
  show('n 5 hub', P({ n: 5, hub: true }));
  show('lam .8', P({ lam: 0.8 }));
  show('rho 0 no hub', P({ rho: 0 }));
  show('rho 0 n 1000?', P({ rho: 0, n: 60, lam: 0 }));
  // invented example (FACTS_T6a, identity check)
  var xs = [1100, 1250, 1180, 1300, 1050, 1210, 1190], T = 1198, m = 0, e = 0, d = 0;
  xs.forEach(function (v) { m += v; }); m /= xs.length; xs.forEach(function (v) { e += (v - T) * (v - T); d += (v - m) * (v - m); }); e /= xs.length; d /= xs.length;
  console.log('identity example: mean', m.toFixed(2), 'avg indiv sq err', e.toFixed(2), 'diversity', d.toFixed(2), 'crowd sq err', ((m - T) * (m - T)).toFixed(2), 'e-d', (e - d).toFixed(2));
  console.log('n=10 rho=.3: theory', (0.3 + 0.7 / 10).toFixed(2), 'n_eff', (10 / (1 + 9 * 0.3)).toFixed(2));
  // crowd #0 picture data
  var x0 = draw(SEED_PIC - SEED0, 25, 0.2), W = buildW(25, 0.4, false), xr = [x0], t;
  for (t = 1; t <= 3; t++) xr.push(apply(W, xr[t - 1]));
  xr.forEach(function (x, t) { var s = x.reduce(function (a, b) { return a + b; }, 0) / x.length; console.log('crowd seed 9 round', t, 'mean', f(s), 'min', f(Math.min.apply(null, x)), 'max', f(Math.max.apply(null, x)), 'hub0', f(x[0])); });
}
if (typeof module !== 'undefined') module.exports = { SEED_PIC: SEED_PIC, run: run, draw: draw, buildW: buildW, power: power, moments: moments, apply: apply, neighbours: neighbours, R: R, ROUNDS: ROUNDS, SEED0: SEED0 };
