// proto/18.js — lesson 18 widget maths: 「内部视角—外部视角」两个人的账 (a labelled TOY; every parameter is 示意 unless marked PUBLISHED).
// run: node tools/psy_qa/proto/18.js
// 200 seeded people. Person i privately counts k_i slips (k_i ~ Poisson(lambda), by inverse CDF of one stored uniform U_i, so the sample
// changes smoothly when the lambda slider moves — common random numbers). The partner notices each slip independently with visibility v
// (stored uniform W_ij < v), so noticed_i ~ Binomial(k_i, v) in this sample.
// Anchoring-and-adjustment (a proposal, grade C): the person starts from the own count (anchor = every slip was seen) and adjusts toward the
// true rate by a fraction alpha:  est_i = k_i - alpha*(k_i - v*k_i) = k_i*(1 - alpha*(1-v)) = k_i*(v + (1-v)*(1-alpha)).
//   PUBLISHED data point (Gilovich, Medvec & Savitsky 2000, Study 1): wearers expected 46% of observers to name the shirt, 23% did.
//   v = 0.23 is that "actual"; alpha = 0.70 is CHOSEN so that 1 - 0.70*(1-0.23) = 0.461 ~ 46% (a fit to one data point, not a paper parameter).
// Liking (toy): partner's liking of person i = B - c*(slips the partner noticed), clipped to the 1..7 scale; the person predicts it with the
//   estimated number instead: B - c*est_i. Only the number of noticed slips is mis-estimated; the response function is assumed known.
//   B = 6.3 and c = 0.5 are 示意 (c was picked looking at the published range of 0.36-0.65 scale points in Boothby et al. 2018 - so landing
//   in that range is NOT a test; direction and the dependence on alpha, lambda, v are what the model derives).
var PSY = require('./_psy.js');
var N = 200, KCAP = 30, SEED = 18, B = 6.3, C = 0.5;
var rng = PSY.rng(SEED), U = [], W = [], i, j;
for (i = 0; i < N; i++) { U.push(rng()); var row = []; for (j = 0; j < KCAP; j++) row.push(rng()); W.push(row); }
function poisK(lam, u) { var p = Math.exp(-lam), cdf = p, k = 0; while (u > cdf && k < KCAP) { k++; p *= lam / k; cdf += p; } return k; }
function clip(x) { return Math.max(1, Math.min(7, x)); }
function run(lam, v, a) {
  var sk = 0, sn = 0, se = 0, la = 0, lp = 0, zero = 0, i, j, k, n, e, gr = [];
  var share = 1 - a * (1 - v);
  for (i = 0; i < N; i++) {
    k = poisK(lam, U[i]); n = 0; for (j = 0; j < k; j++) if (W[i][j] < v) n++;
    e = k * share; sk += k; sn += n; se += e; la += clip(B - C * n); lp += clip(B - C * e);
    if (!n) zero++; var g = Math.min(k, 14); if (!gr[g]) gr[g] = { c: 0, n: 0, e: 0 }; gr[g].c++; gr[g].n += n; gr[g].e += e;
  }
  return { k: sk / N, n: sn / N, e: se / N, nShare: sk ? sn / sk : 0, eShare: sk ? se / sk : 0, la: la / N, lp: lp / N, gap: (la - lp) / N, zero: zero / N, gr: gr, share: share, tot: sk };
}
function show(name, lam, v, a) {
  var r = run(lam, v, a);
  console.log(name.padEnd(14), 'lam', lam, 'v', v, 'a', a, '| k', r.k.toFixed(2), 'noticed', r.n.toFixed(2), (100 * r.nShare).toFixed(1) + '%', 'est', r.e.toFixed(2), (100 * r.eShare).toFixed(1) + '%',
    '| liking act', r.la.toFixed(2), 'pred', r.lp.toFixed(2), 'gap', r.gap.toFixed(2), '| zero-noticed people', (100 * r.zero).toFixed(0) + '%', '| formula share', (100 * r.share).toFixed(1) + '%', 'slips', r.tot);
  return r;
}
if (require.main === module) {
  show('T恤', 1, 0.23, 0.70); show('一场谈话', 4, 0.23, 0.70); show('完全调整', 4, 0.23, 1.0); show('全被看见', 4, 1.0, 0.70);
  show('alpha 0', 4, 0.23, 0); show('lam 8', 8, 0.23, 0.70); show('lam 2', 2, 0.23, 0.70); show('v .6', 4, 0.6, 0.70); show('v .05', 4, 0.05, 0.70);
  // closed forms the prose relies on:  est share = 1 - a(1-v);  expected liking gap = C*lam*(1-v)*(1-a);  P(no slip noticed) = exp(-lam*v) (Poisson thinning)
  console.log('alpha that reproduces 46% vs 23%:', ((1 - 0.46) / (1 - 0.23)).toFixed(3), '| alpha that reproduces 48% vs 8%:', ((1 - 0.48) / (1 - 0.08)).toFixed(3),
    '| model share at v=.08, alpha=.70:', (100 * (1 - 0.7 * 0.92)).toFixed(1) + '%',
    '| expected gap (lam 4, v .23, a .7):', (C * 4 * 0.77 * 0.3).toFixed(3), '| exp(-lam*v) at lam 4, v .23:', Math.exp(-0.92).toFixed(3));
  // seed sensitivity of the T-shirt preset (just to know how much a 200-person sample wobbles)
  var s, out = [];
  for (s = 1; s <= 30; s++) {
    var rg = PSY.rng(s), sk = 0, sn = 0, ii, jj, k;
    for (ii = 0; ii < N; ii++) { var u = rg(); k = poisK(1, u); for (jj = 0; jj < KCAP; jj++) { var w = rg(); if (jj < k && w < 0.23) sn++; } sk += k; }
    out.push((100 * sn / sk).toFixed(1));
  }
  console.log('T-shirt noticed share, seeds 1..30:', out.join(' '));
}
module.exports = { run: run, show: show };
