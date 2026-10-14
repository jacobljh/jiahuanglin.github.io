// proto/p00.js — sidecar lesson 00 widget maths: 「改善错觉」 = regression to the mean (a labelled DEMO model, not data).
// run: node tools/psy_qa/proto/p00.js          (NB the p prefix: proto/00.js belongs to the spine)
//
// Setting. N = 4,000 simulated people, each with two standardised scores (week 1, week 2; higher = better):
//   z1 ~ N(0,1);  z2 = r·z1 + √(1−r²)·ε,  ε ~ N(0,1)           → both weeks have mean 0, SD 1, corr(z1, z2) = r.
// r is a STATED PARAMETER (a slider), not a measured constant: FACTS_T6a 00-C / "Widget constants (00)" found no source
// with a test–retest r for a single weekly mood rating. Default r = 0.6 (suggested default in FACTS), slider 0.3–0.9.
// Pick the worst fraction p of week-1 scores (p = 10 / 25 / 50 %): n_sel = round(N·p) people with the lowest z1.
// Randomly split them (u_i < 0.5) into 「做了新习惯」(treated) and 「什么也没做」(control); the treated get +δ added to week 2.
//
// Derivation (re-done here, not copied):
//   E[z2 | z1] = r·z1, so for any selected group  E[z2 − z1 | sel] = (r − 1)·E[z1 | sel] = (1 − r)·|E[z1 | sel]|.
//   For selection "z1 < z_p" with P(z1 < z_p) = p:   E[z1 | z1 < z_p] = −φ(z_p)/p   (truncated normal).
//   ⇒ improvement with NO intervention = (1 − r)·φ(z_p)/p ;  the share of the gap that closes by chance = 1 − r (any p).
//   FACTS DERIVED to reproduce: p=.10, r=.6 → mean z1 −1.755 (cut −1.282), week-2 −1.053, improvement 0.70; p=.25 → −1.271, 0.51; p=.05 → −2.063, 0.83.
function mulberry32(seed) { var a = seed >>> 0; return function () { a = (a + 0x6D2B79F5) >>> 0; var t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function gauss(r) { var u = r() || 1e-12, v = r(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }
function erfAS(x) { var s = x < 0 ? -1 : 1; x = Math.abs(x); var t = 1 / (1 + 0.3275911 * x); var y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x); return s * y; }
function phiAS(z) { return 0.5 * (1 + erfAS(z / Math.SQRT2)); }                    // = PSY.phi
function probit(p) { if (p <= 0) return -8; if (p >= 1) return 8; var lo = -8, hi = 8, i; for (i = 0; i < 60; i++) { var m = (lo + hi) / 2; if (phiAS(m) < p) lo = m; else hi = m; } return (lo + hi) / 2; }   // = PSY.probit
function pdf(x) { return Math.exp(-x * x / 2) / Math.sqrt(2 * Math.PI); }
// a high-precision Phi for the independent check (series for the erf, |z| < 5)
function phiExact(z) { if (Math.abs(z) > 5) return phiAS(z); var x = z / Math.SQRT2, s = x, term = x, n; for (n = 1; n < 200; n++) { term *= -x * x / n; s += term / (2 * n + 1); if (Math.abs(term) < 1e-17) break; } return 0.5 * (1 + 2 / Math.sqrt(Math.PI) * s); }
function probitExact(p) { var lo = -8, hi = 8, i; for (i = 0; i < 80; i++) { var m = (lo + hi) / 2; if (phiExact(m) < p) lo = m; else hi = m; } return (lo + hi) / 2; }

// ───────── the widget's population (deterministic; the same base draws are reused for every r, p, δ so the dots move smoothly) ─────────
var N = 4000;
function makeBase(seed) {
  var rng = mulberry32(seed * 7919 + 11), z1 = [], ep = [], u = [], i, ord;
  for (i = 0; i < N; i++) { z1.push(gauss(rng)); ep.push(gauss(rng)); u.push(rng()); }
  ord = []; for (i = 0; i < N; i++) ord.push(i);
  ord.sort(function (a, b) { return z1[a] - z1[b]; });                              // ascending week-1 score: worst first
  return { z1: z1, ep: ep, u: u, ord: ord };
}
function analytic(r, p) { var zp = probit(p), m1 = -pdf(zp) / p; return { zp: zp, m1: m1, m2: r * m1, imp: (1 - r) * (-m1) }; }
function simulate(base, r, p, delta) {
  var s = Math.sqrt(1 - r * r), nsel = Math.round(N * p), k, i, a = 0, a2 = 0, sumAll1 = 0, sumAll2 = 0, nT = 0, nC = 0, impT = 0, impC = 0, y;
  for (k = 0; k < nsel; k++) {
    i = base.ord[k];
    y = r * base.z1[i] + s * base.ep[i];                                            // week-2 score with no intervention
    sumAll1 += base.z1[i]; sumAll2 += y;
    if (base.u[i] < 0.5) { nT++; impT += (y + delta - base.z1[i]); } else { nC++; impC += (y - base.z1[i]); }
  }
  var an = analytic(r, p), m1 = sumAll1 / nsel, m2 = sumAll2 / nsel, imp = m2 - m1;
  return { nsel: nsel, m1: m1, m2: m2, imp: imp, impFormula: an.imp, share: imp / -m1, shareFormula: 1 - r, nT: nT, nC: nC, impT: impT / nT, impC: impC / nC, diff: impT / nT - impC / nC, delta: delta };
}
function f2(x) { return (x >= 0 ? '+' : '−') + Math.abs(x).toFixed(2); }
function f3(x) { return (x >= 0 ? '+' : '−') + Math.abs(x).toFixed(3); }
function pc(x, d) { return (100 * x).toFixed(d === undefined ? 0 : d) + '%'; }

if (require.main === module) {
  var line = function (s) { console.log(s); };
  line('=== 1. FACTS DERIVED reproduced (analytic, exact Phi) ===');
  [0.10, 0.25, 0.05, 0.50].forEach(function (p) {
    var zp = probitExact(p), m1 = -pdf(zp) / p, r = 0.6;
    line('p=' + p.toFixed(2) + '  cut z_p=' + zp.toFixed(3) + '  mean z1=' + m1.toFixed(3) + '  r=.6 → week-2 mean ' + (r * m1).toFixed(3) + '  improvement ' + ((1 - r) * -m1).toFixed(3) + '   (A–S probit: ' + probit(p).toFixed(3) + ')');
  });
  line('share of the gap closing by chance = 1 − r:  ' + [0.3, 0.5, 0.6, 0.7, 0.8, 0.9].map(function (r) { return 'r=' + r + ' → ' + pc(1 - r); }).join(' · '));
  line('improvement (no intervention) by p and r:');
  [0.10, 0.25, 0.50].forEach(function (p) { line('  p=' + p + ': ' + [0.3, 0.45, 0.6, 0.75, 0.9].map(function (r) { return 'r=' + r + ' ' + analytic(r, p).imp.toFixed(2); }).join('  ')); });

  line('\n=== 1b. Monte-Carlo sanity (2,000,000 draws, seed 5): improvement among the worst 10% at r=.6 ===');
  (function () {
    var rng = mulberry32(5), n = 2000000, r = 0.6, s = Math.sqrt(1 - r * r), cut = probitExact(0.10), c = 0, a1 = 0, a2 = 0, i, x, y;
    for (i = 0; i < n; i++) { x = gauss(rng); y = r * x + s * gauss(rng); if (x < cut) { c++; a1 += x; a2 += y; } }
    line('selected share ' + (c / n).toFixed(4) + '  mean z1 ' + (a1 / c).toFixed(3) + '  mean z2 ' + (a2 / c).toFixed(3) + '  improvement ' + ((a2 - a1) / c).toFixed(3) + '  share ' + ((a2 - a1) / -a1).toFixed(3));
  })();

  line('\n=== 2. the widget model, default state (r=.6, p=10%, δ=0), seeds 1..12 ===');
  var s0;
  for (s0 = 1; s0 <= 12; s0++) {
    var b = makeBase(s0), o = simulate(b, 0.6, 0.10, 0);
    line('seed ' + String(s0).padStart(2) + ': n_sel ' + o.nsel + '  m1 ' + o.m1.toFixed(2) + '  m2 ' + o.m2.toFixed(2) + '  improvement ' + o.imp.toFixed(2) + ' (formula ' + o.impFormula.toFixed(2) + ')  share ' + pc(o.share) + '  nT/nC ' + o.nT + '/' + o.nC + '  impT ' + o.impT.toFixed(2) + '  impC ' + o.impC.toFixed(2) + '  diff ' + f2(o.diff));
  }
  // spread over many seeds
  (function () {
    var K = 400, imps = [], diffs = [], sd, mean, sdv = function (a) { var m = a.reduce(function (x, y) { return x + y; }, 0) / a.length; return { m: m, s: Math.sqrt(a.reduce(function (x, y) { return x + (y - m) * (y - m); }, 0) / (a.length - 1)) }; }, p, out = [];
    [0.10, 0.25, 0.50].forEach(function (pp) {
      imps = []; diffs = [];
      for (var k = 1; k <= K; k++) { var o = simulate(makeBase(k), 0.6, pp, 0); imps.push(o.imp); diffs.push(o.diff); }
      var a = sdv(imps), d = sdv(diffs);
      out.push('p=' + pp + ': improvement mean ' + a.m.toFixed(3) + ' SD ' + a.s.toFixed(3) + '; treated−control mean ' + f3(d.m) + ' SD ' + d.s.toFixed(3));
    });
    line('over ' + K + ' seeds (r=.6, δ=0):\n  ' + out.join('\n  '));
  })();

  line('\n=== 3. default seed 1 across presets ===');
  var base1 = makeBase(1);
  [[0.6, 0.10, 0], [0.6, 0.25, 0], [0.6, 0.50, 0], [0.3, 0.10, 0], [0.9, 0.10, 0], [0.6, 0.10, 0.3], [0.6, 0.10, 0.5], [0.6, 0.10, 1.0]].forEach(function (c) {
    var o = simulate(base1, c[0], c[1], c[2]);
    line('r=' + c[0] + ' p=' + c[1] + ' δ=' + c[2] + ' → n ' + o.nsel + ' m1 ' + o.m1.toFixed(2) + ' m2 ' + o.m2.toFixed(2) + ' imp ' + o.imp.toFixed(2) + '/' + o.impFormula.toFixed(2) + ' share ' + pc(o.share) + '/' + pc(o.shareFormula) + ' impT ' + o.impT.toFixed(2) + ' impC ' + o.impC.toFixed(2) + ' diff ' + f2(o.diff) + ' (δ ' + c[2].toFixed(2) + ')');
  });

  line('\n=== 4. randomisation-test floors (DERIVED, FACTS 00-A) ===');
  function C(n, k) { var r = 1, i; for (i = 1; i <= k; i++) r = r * (n - k + i) / i; return Math.round(r); }
  [6, 8, 10, 12, 14].forEach(function (n) { var c = C(n, n / 2); line('completely randomised, ' + n + ' days (' + n / 2 + '+' + n / 2 + '): ' + c + ' arrangements; min one-sided p = ' + (1 / c).toFixed(4) + '; two-sided ' + (2 / c).toFixed(4)); });
  [4, 5, 6].forEach(function (k) { var c = Math.pow(2, k); line('paired days, ' + k + ' pairs (' + 2 * k + ' days): ' + c + ' arrangements; min one-sided p = ' + (1 / c).toFixed(4) + '; two-sided ' + (2 / c).toFixed(4)); });

  line('\n=== 5. false positives among k independent tests at α=.05 (DERIVED, FACTS 00-B Threat 6) ===');
  line([1, 3, 5, 10, 20].map(function (k) { return 'k=' + k + ' → ' + pc(1 - Math.pow(0.95, k), 1); }).join(' · '));

  line('\n=== 6. plain-language effect sizes (DERIVED, FACTS 00-G): U3 = Φ(d), CLES = Φ(d/√2), r = d/√(d²+4) ===');
  [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.8, 1.0, 1.2].forEach(function (d) { line('d=' + d.toFixed(1) + '  U3 ' + pc(phiExact(d), 1) + '  CLES ' + pc(phiExact(d / Math.SQRT2), 1) + '  r ' + (d / Math.sqrt(d * d + 4)).toFixed(3)); });

  line('\n=== 7. the widget illusion vs the literature, for the prose ===');
  var o7 = simulate(base1, 0.6, 0.10, 0);
  line('default improvement (sim) ' + o7.imp.toFixed(2) + ' SD vs Kraft 2020 median education-RCT effect 0.10 → ratio ' + (o7.imp / 0.10).toFixed(1) + ' (formula ' + analytic(0.6, 0.10).imp.toFixed(3) + ')');
  line('CLES for d = 0.70: ' + pc(phiExact(0.70 / Math.SQRT2), 1) + ' ; U3 ' + pc(phiExact(0.70), 1));

  line('\n=== 8. PSY.rng identity check (loads the real psy.js) ===');
  (function () {
    var fs = require('fs'), vm = require('vm'), path = require('path');
    var src = fs.readFileSync(path.join(__dirname, '../../../all_lessons/psychology_play/lessons/psy.js'), 'utf8');
    var win = { localStorage: { getItem: function () { return null; }, setItem: function () {} } }; win.window = win; vm.createContext(win); vm.runInContext(src, win);
    var a = win.PSY.rng(123), b = mulberry32(123), same = true, i;
    for (i = 0; i < 1000; i++) if (a() !== b()) same = false;
    var g1 = win.PSY.rng(9), g2 = mulberry32(9), gs = true;
    for (i = 0; i < 500; i++) if (win.PSY.gauss(g1) !== gauss(g2)) gs = false;
    line('PSY.rng == local mulberry32: ' + same + ' ; PSY.gauss == local gauss: ' + gs + ' ; PSY.phi(1.2816)=' + win.PSY.phi(1.2816).toFixed(5) + ' ; PSY.probit(.1)=' + win.PSY.probit(0.1).toFixed(4));
  })();
}
if (typeof module !== 'undefined') module.exports = { makeBase: makeBase, simulate: simulate, analytic: analytic };
