// proto/19.js — lesson 19 widget maths: 「速配 12 轮」(a toy inspired by the social-relations decomposition of Joel, Eastwick & Finkel 2017; not the authors' model).
// Desire of dater i for partner j after a 4-minute date:  d_ij = actor_i + partner_j + relationship_ij + error_ij   (all standard-normal pieces, scaled to variance shares)
//   published structure (Joel 2017 Table 1, ≈): actor 13 · partner 24 · relationship 33 · error 30 (%).  Here actor = 13 and error = 30 are fixed; the slider moves share
//   between 'partner' and 'relationship' with partner + relationship = 57  (so sr = 33 → sp = 24 is the published split).
// 12 partners have 3 visible attributes (外貌/收入/幽默感, independent N(0,1), standardised over the 12).  The standardised partner effect is
//   p = sqrt(R2)·S + sqrt(1−R2)·Z,  S = standardised projection of the attributes on a fixed direction DIR (示意 loadings),  Z = a draw orthogonal to the attributes.
//   R2 = share of the partner effect the 3 attributes can reach (default .22: Joel 2017 Table 2 says > 100 pre-date measures reached 18–27% of partner variance).
// Pre-date predictor ('理想型'): fit_j = Σ w_k · attr_jk with the reader's stated weights (same vector for every simulated dater when 'your list' is used).
// Post-date predictor: post_ij = partner_j + relationship_ij + noise, noise variance = NR × signal variance; NR = 2.2 is chosen so that the within-person correlation of the post-date
//   rating with desire is ≈ .45 at the published split (Eastwick & Finkel 2008: perceived attractiveness rated after the date vs romantic interest, r = .43–.46).
// 1,000 simulated daters face the same 12 partners; each has its own actor, relationship and error draws; row 0 is 'you' (the first 12 rows are drawn as the matrix).
// The widget (19_ideal_partner.html) uses PSY.rng(884): the seed was picked from 1–1500 so that row 0 sits close to the 1,000-dater mean under the default and the presets.
// The 'random lists' column printed below (weights ~ U(0,10) per dater) is an extra check and is NOT shown by the widget.
var PSY = require('./_psy.js');
var NP = 12, ND = 1000, NA = 3, SA = 0.13, SE = 0.30, SUM = 0.57, NR = 2.2;
var DIR = [0.70, 0.40, 0.50];

function std(a) {            // centre and scale to sd 1 with the (n−1) divisor, so a 12-sample piece has the same expected variance as an iid N(0,1) draw
  var n = a.length, m = 0, s = 0, i;
  for (i = 0; i < n; i++) m += a[i]; m /= n;
  for (i = 0; i < n; i++) s += (a[i] - m) * (a[i] - m); s = Math.sqrt(s / (n - 1)) || 1;
  return a.map(function (v) { return (v - m) / s; });
}
function build(seed) {
  var r = PSY.rng(seed), j, k, i, t;
  var A = [[], [], []];
  for (k = 0; k < NA; k++) {
    var col = []; for (j = 0; j < NP; j++) col.push(PSY.gauss(r));
    for (t = 0; t < k; t++) { var c = 0, q = 0; for (j = 0; j < NP; j++) { c += col[j] * A[t][j]; q += A[t][j] * A[t][j]; } for (j = 0; j < NP; j++) col[j] -= c / q * A[t][j]; }   // Gram–Schmidt: attributes uncorrelated in this sample
    A[k] = std(col);
  }
  // Z: draw, residualise on the three attribute columns (OLS, columns are centred), standardise
  var v = std((function () { var a = []; for (j = 0; j < NP; j++) a.push(PSY.gauss(r)); return a; })());
  var G = [[0, 0, 0], [0, 0, 0], [0, 0, 0]], b = [0, 0, 0];
  for (k = 0; k < NA; k++) { for (t = 0; t < NA; t++) for (j = 0; j < NP; j++) G[k][t] += A[k][j] * A[t][j]; for (j = 0; j < NP; j++) b[k] += A[k][j] * v[j]; }
  var coef = solve3(G, b), Z = [];
  for (j = 0; j < NP; j++) Z.push(v[j] - coef[0] * A[0][j] - coef[1] * A[1][j] - coef[2] * A[2][j]);
  Z = std(Z);
  var dn = Math.sqrt(DIR[0] * DIR[0] + DIR[1] * DIR[1] + DIR[2] * DIR[2]), S = [];
  for (j = 0; j < NP; j++) S.push((DIR[0] * A[0][j] + DIR[1] * A[1][j] + DIR[2] * A[2][j]) / dn);
  S = std(S);
  var act = [], rel = [], err = [], pn = [];
  for (i = 0; i < ND; i++) { act.push(PSY.gauss(r)); var a1 = [], a2 = [], a3 = []; for (j = 0; j < NP; j++) { a1.push(PSY.gauss(r)); a2.push(PSY.gauss(r)); a3.push(PSY.gauss(r)); } rel.push(a1); err.push(a2); pn.push(a3); }
  return { A: A, Z: Z, S: S, act: act, rel: rel, err: err, pn: pn };
}
function solve3(G, b) {     // Cramer's rule, 3×3
  function det(m) { return m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]); }
  var D = det(G), out = [], k, i, M;
  for (k = 0; k < 3; k++) { M = [G[0].slice(), G[1].slice(), G[2].slice()]; for (i = 0; i < 3; i++) M[i][k] = b[i]; out.push(D ? det(M) / D : 0); }
  return out;
}
function model(D, o) {      // o: sr (0..57 %), r2 (0..1), w [3], post (bool)
  var sr = o.sr / 100, sp = SUM - sr, a = Math.sqrt(SA), P = Math.sqrt(sp), R = Math.sqrt(sr), E = Math.sqrt(SE), q = Math.sqrt(o.r2), q2 = Math.sqrt(1 - o.r2);
  var NPZ = Math.sqrt(NR * SUM);
  var p = [], fit = [], i, j, d = [], pre = [], post = [], rs = [], rsRand = [], ws = o.w;
  for (j = 0; j < NP; j++) { p.push(q * D.S[j] + q2 * D.Z[j]); fit.push(ws[0] * D.A[0][j] + ws[1] * D.A[1][j] + ws[2] * D.A[2][j]); }
  var rng = PSY.rng(1919);
  for (i = 0; i < ND; i++) {
    var di = [], pi_ = [], f2 = [];
    var wr = [10 * rng(), 10 * rng(), 10 * rng()];
    for (j = 0; j < NP; j++) {
      di.push(a * D.act[i] + P * p[j] + R * D.rel[i][j] + E * D.err[i][j]);
      pi_.push(P * p[j] + R * D.rel[i][j] + NPZ * D.pn[i][j]);
      f2.push(wr[0] * D.A[0][j] + wr[1] * D.A[1][j] + wr[2] * D.A[2][j]);
    }
    d.push(di); post.push(pi_);
    rs.push(o.post ? PSY.corr(pi_, di) : PSY.corr(fit, di));
    rsRand.push(PSY.corr(f2, di));
  }
  return { p: p, fit: fit, d: d, post: post, rs: rs, rsRand: rsRand, ceil: Math.sqrt(o.r2 * sp / (1 - SA)), ceilPost: Math.sqrt((sp + sr) / ((1 - SA) * (1 + NR))) };
}
function pct(a, q) { var s = a.slice().sort(function (x, y) { return x - y; }); var h = (s.length - 1) * q, lo = Math.floor(h), hi = Math.ceil(h); return s[lo] + (s[hi] - s[lo]) * (h - lo); }
function summ(a) { return { mean: PSY.mean(a), p10: pct(a, 0.1), p50: pct(a, 0.5), p90: pct(a, 0.9), neg: a.filter(function (x) { return x < 0; }).length / a.length, lt: a.filter(function (x) { return x < 0.1; }).length / a.length }; }
function f(x, n) { return (x < 0 ? '−' : '') + Math.abs(x).toFixed(n === undefined ? 2 : n); }
if (require.main === module) {
  var seeds = process.argv[2] ? [parseInt(process.argv[2], 10)] : [884];
  seeds.forEach(function (seed) {
    var D = build(seed);
    var def = { sr: 33, r2: 0.22, w: [5, 5, 5], post: false };
    console.log('seed', seed);
    function show(label, o) {
      var m = model(D, o), s = summ(m.rs), sR = summ(m.rsRand);
      console.log(label.padEnd(28), 'you r=' + f(m.rs[0]), '| 1000 mean=' + f(s.mean), 'P10..P90=' + f(s.p10) + '..' + f(s.p90), 'r<0:' + (100 * s.neg).toFixed(0) + '%', 'r<.1:' + (100 * s.lt).toFixed(0) + '%', '| random lists mean=' + f(sR.mean), 'P10..P90=' + f(sR.p10) + '..' + f(sR.p90), '| ceil=' + f(m.ceil) + ' ceilPost=' + f(m.ceilPost));
    }
    show('default pre', def);
    show('default post', Object.assign({}, def, { post: true }));
    show('sr 10 (sp 47)', Object.assign({}, def, { sr: 10 }));
    show('sr 0 (sp 57)', Object.assign({}, def, { sr: 0 }));
    show('sr 57 (sp 0)', Object.assign({}, def, { sr: 57 }));
    show('r2 100', Object.assign({}, def, { r2: 1 }));
    show('r2 50', Object.assign({}, def, { r2: 0.5 }));
    show('r2 0', Object.assign({}, def, { r2: 0 }));
    show('sr 0 r2 100', Object.assign({}, def, { sr: 0, r2: 1 }));
    show('best list (7,4,5)', Object.assign({}, def, { w: [7, 4, 5] }));
    show('only income', Object.assign({}, def, { w: [0, 10, 0] }));
    show('only looks', Object.assign({}, def, { w: [10, 0, 0] }));
    show('all zero', Object.assign({}, def, { w: [0, 0, 0] }));
    // analytic checks quoted in the lesson
    console.log('analytic: ceiling default =', Math.sqrt(0.22 * 0.24 / 0.87).toFixed(3), '| within-person corr of post-date rating with desire =', Math.sqrt(0.57 / (0.87 * (1 + NR))).toFixed(3), '| R2 of the relationship part by the post-date rating =', (0.33 / (0.57 * (1 + NR))).toFixed(3));
    var mnM = 9, mxM = -9, mn0 = 9, mx0 = -9, a, b, c, q, mm, cnt = 0, negP5 = model(D, { sr: 0, r2: 1, w: [5, 5, 5], post: false }).rs.filter(function (x) { return x < 0; }).length;
    for (a = 0; a <= 10; a++) for (b = 0; b <= 10; b++) for (c = 0; c <= 10; c++) { if (a + b + c === 0) continue; q = model(D, { sr: 33, r2: 0.22, w: [a, b, c], post: false }); mm = summ(q.rs).mean; cnt++; mnM = Math.min(mnM, mm); mxM = Math.max(mxM, mm); mn0 = Math.min(mn0, q.rs[0]); mx0 = Math.max(mx0, q.rs[0]); }
    console.log('grid of', cnt, 'integer lists (0–10 each, not all zero): mean r over 1,000 daters in [' + f(mnM, 3) + ', ' + f(mxM, 3) + ']; your 12-date r in [' + f(mn0, 3) + ', ' + f(mx0, 3) + ']; negatives among the 1,000 at sr 0 / R2 100:', negP5);
  });
}
if (typeof module !== 'undefined') module.exports = { build: build, model: model, summ: summ };
