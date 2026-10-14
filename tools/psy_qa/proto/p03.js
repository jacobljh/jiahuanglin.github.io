// proto/p03.js — sidecar lesson 03 widget maths: 「决策矩阵实验室」 = a weighted decision matrix and how fragile its winner is (a labelled DEMO model, not data).
// run: node tools/psy_qa/proto/p03.js          (NB the p prefix: proto/03.js belongs to the spine)
//
// Setting (FACTS_T6a "(b2)"; every number INVENTED, labelled 示意): five options A–E scored 0–10 on four criteria
//   salary / growth / team / commute:  A 8,6,7,5 · B 6,8,6,8 · C 9,4,5,9 · D 5,7,9,6 · E 7,7,4,3.
// The reader sets four importance sliders (0–100, step 5); weights w_k = slider_k / Σ sliders; total_i = Σ_k w_k·score_ik.
// FACTS to reproduce: w = .4/.3/.2/.1 → A 6.90, B 6.80, C 6.70, D 6.50, E 6.00; equal weights → A 6.50, B 7.00, C 6.75, D 6.75, E 5.25;
//   Pearson correlation between the two total columns = .854.
//
// Two Monte-Carlo draws of 1,000 weight vectors each (PSY.rng; the same base draws are reused when sliders move):
//   (1) 「完全不知道权重」 = uniform on the weight simplex = Dirichlet(1,1,1,1): normalise four exponentials −ln(u).   (independent of the sliders)
//   (2) 「围绕你的权重」  = each of the reader's weights multiplied by 1 + s·(2u − 1), u ~ U(0,1), then renormalised   (s = the 「权重可能偏多少」 slider, 0–100 %)
//       — our own device (not a published method); s = 0 gives the reader's weights back, so the winner share is 100 %.
// For each draw the winner = the option with the highest total (first one on an exact tie). Share = wins / 1,000.
//
// Everything else printed here is the lesson's own derivation (formulas in the comments), reproduced from FACTS or re-derived independently:
//   Haynes 2009 arithmetic, Urbach OR for Haynes's rates, minimum detectable differences, common-language effect sizes, nudge ratios,
//   the crowd-average identity, and the equal-weights correlation table (b).
function mulberry32(seed) { var a = seed >>> 0; return function () { a = (a + 0x6D2B79F5) >>> 0; var t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function gauss(r) { var u = r() || 1e-12, v = r(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }
function erfAS(x) { var s = x < 0 ? -1 : 1; x = Math.abs(x); var t = 1 / (1 + 0.3275911 * x); var y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x); return s * y; }
function phiAS(z) { return 0.5 * (1 + erfAS(z / Math.SQRT2)); }                    // = PSY.phi
function phiExact(z) { if (Math.abs(z) > 5) return phiAS(z); var x = z / Math.SQRT2, s = x, term = x, n; for (n = 1; n < 200; n++) { term *= -x * x / n; s += term / (2 * n + 1); if (Math.abs(term) < 1e-17) break; } return 0.5 * (1 + 2 / Math.sqrt(Math.PI) * s); }

// ───────── the widget's model ─────────
var NAMES = ['A', 'B', 'C', 'D', 'E'], CRIT = ['薪水', '成长', '团队', '通勤'];
var M = [[8, 6, 7, 5], [6, 8, 6, 8], [9, 4, 5, 9], [5, 7, 9, 6], [7, 7, 4, 3]];
var NV = 1000;
function weights(sl) { var s = 0, k, w = []; for (k = 0; k < 4; k++) s += sl[k]; for (k = 0; k < 4; k++) w.push(s > 0 ? sl[k] / s : 0.25); return w; }
function totals(w) { var out = [], i, k, s; for (i = 0; i < 5; i++) { s = 0; for (k = 0; k < 4; k++) s += M[i][k] * w[k]; out.push(s); } return out; }
function order(t) { var o = [0, 1, 2, 3, 4]; o.sort(function (a, b) { return t[b] - t[a] || a - b; }); return o; }
function winner(t) { var b = 0, i; for (i = 1; i < 5; i++) if (t[i] > t[b] + 1e-12) b = i; return b; }
function corr(x, y) { var n = x.length, mx = 0, my = 0, i, sxy = 0, sxx = 0, syy = 0; for (i = 0; i < n; i++) { mx += x[i]; my += y[i]; } mx /= n; my /= n; for (i = 0; i < n; i++) { sxy += (x[i] - mx) * (y[i] - my); sxx += (x[i] - mx) * (x[i] - mx); syy += (y[i] - my) * (y[i] - my); } return sxy / Math.sqrt(sxx * syy); }
function mkBase(seed) {                         // the same 1,000 × 4 uniforms for (2) and 1,000 × 4 exponentials for (1)
  var g = mulberry32(seed * 7919 + 303), U = [], E = [], i, k, row, s;
  for (i = 0; i < NV; i++) { row = []; for (k = 0; k < 4; k++) row.push(g()); U.push(row); }
  for (i = 0; i < NV; i++) { row = []; s = 0; for (k = 0; k < 4; k++) { row.push(-Math.log(g() || 1e-12)); s += row[k]; } for (k = 0; k < 4; k++) row[k] /= s; E.push(row); }
  return { U: U, E: E };
}
function sharesAround(base, w, s) {              // (2)
  var c = [0, 0, 0, 0, 0], i, k, v, z, sum, t;
  for (i = 0; i < NV; i++) { v = []; sum = 0; for (k = 0; k < 4; k++) { z = w[k] * (1 + s * (2 * base.U[i][k] - 1)); v.push(z); sum += z; } if (sum <= 0) v = [0.25, 0.25, 0.25, 0.25]; else for (k = 0; k < 4; k++) v[k] /= sum; c[winner(totals(v))]++; }
  return c;
}
function sharesUniform(base) { var c = [0, 0, 0, 0, 0], i; for (i = 0; i < NV; i++) c[winner(totals(base.E[i]))]++; return c; }
function f2(x) { return x.toFixed(2); }
function pc(x, d) { return (100 * x).toFixed(d === undefined ? 0 : d) + '%'; }
function show(c) { return NAMES.map(function (n, i) { return n + ' ' + Math.round(c[i] / NV * 100) + '%'; }).join(' · '); }

if (require.main === module) {
  var line = function (s) { console.log(s); };
  var DEF = [40, 30, 20, 10], EQ = [25, 25, 25, 25];
  line('=== 1. FACTS (b2) reproduced: totals and correlation ===');
  var tW = totals(weights(DEF)), tE = totals(weights(EQ));
  line('weights .4/.3/.2/.1 → ' + NAMES.map(function (n, i) { return n + ' ' + f2(tW[i]); }).join('  ') + '   order ' + order(tW).map(function (i) { return NAMES[i]; }).join(' > '));
  line('equal weights      → ' + NAMES.map(function (n, i) { return n + ' ' + f2(tE[i]); }).join('  ') + '   order ' + order(tE).map(function (i) { return NAMES[i]; }).join(' > ') + '  (C and D tie at 6.75)');
  line('corr(totals(.4/.3/.2/.1), totals(equal)) = ' + corr(tW, tE).toFixed(4) + '  (FACTS .854)   margins: 1st−2nd ' + f2(tW[order(tW)[0]] - tW[order(tW)[1]]) + ', 1st−3rd ' + f2(tW[order(tW)[0]] - tW[order(tW)[2]]));
  line('E can never strictly win: (A−E) + (B−E) = 5·w3 + 7·w4 ≥ 0 for every weight vector → at least one of A, B is ≥ E; A−E = w1−w2+3w3+2w4, B−E = −w1+w2+2w3+5w4');
  line('check the identity on the matrix: A−E = (8−7, 6−7, 7−4, 5−3) = (1,−1,3,2); B−E = (6−7, 8−7, 6−4, 8−3) = (−1,1,2,5); sum = (0,0,5,7)');

  line('\n=== 2. winner shares, 1,000 draws, seed 1 (what the widget prints) ===');
  var b1 = mkBase(1);
  line('know-nothing (uniform simplex)      : ' + show(sharesUniform(b1)));
  [0, 25, 50, 75, 100].forEach(function (sp) { line('around .4/.3/.2/.1, ±' + String(sp).padStart(3) + '%        : ' + show(sharesAround(b1, weights(DEF), sp / 100))); });
  [0, 25, 50, 75, 100].forEach(function (sp) { line('around equal weights, ±' + String(sp).padStart(3) + '%        : ' + show(sharesAround(b1, weights(EQ), sp / 100))); });

  line('\n=== 2b. reference for the uniform draw: 2,000,000 draws (SE ≈ 0.03 pp) and the seed-to-seed wobble of the 1,000-draw version ===');
  (function () {
    var r = mulberry32(7), c = [0, 0, 0, 0, 0], n = 2000000, i, k, e, s;
    for (i = 0; i < n; i++) { e = []; s = 0; for (k = 0; k < 4; k++) { e.push(-Math.log(r() || 1e-12)); s += e[k]; } for (k = 0; k < 4; k++) e[k] /= s; c[winner(totals(e))]++; }
    line('2e6 uniform draws: ' + NAMES.map(function (nm, j) { return nm + ' ' + (100 * c[j] / n).toFixed(2) + '%'; }).join(' · '));
    function wobble(label, fn) {                // 40 seeds x 1,000 draws -> mean ± SD (pp), min, max for options A–D (E is always 0)
      var sh = [[], [], [], []], sd, cc, j, sds = [];
      for (sd = 1; sd <= 40; sd++) { cc = fn(mkBase(sd)); for (j = 0; j < 4; j++) sh[j].push(cc[j] / NV * 100); }
      line(label + ': ' + ['A', 'B', 'C', 'D'].map(function (nm, q) { var m = sh[q].reduce(function (a, b) { return a + b; }, 0) / 40, v = Math.sqrt(sh[q].reduce(function (a, b) { return a + (b - m) * (b - m); }, 0) / 39); sds.push(v); return nm + ' ' + m.toFixed(1) + ' ± ' + v.toFixed(1) + ' (min ' + Math.min.apply(null, sh[q]).toFixed(1) + ', max ' + Math.max.apply(null, sh[q]).toFixed(1) + ')'; }).join(' · '));
      return sds;
    }
    var sdU = wobble('40 seeds, know-nothing draw, mean ± SD (pp)', sharesUniform);
    var sdA = wobble('40 seeds, around .4/.3/.2/.1 at ±50%, mean ± SD (pp)', function (b) { return sharesAround(b, weights(DEF), 0.5); });
    var allSD = sdU.concat(sdA);
    line('SD range over both draws and options A–D: ' + Math.min.apply(null, allSD).toFixed(1) + '–' + Math.max.apply(null, allSD).toFixed(1) + ' pp (the lesson says 0.7–1.6)');
    line('binomial SE at p = .35, n = 1000: ' + (100 * Math.sqrt(0.35 * 0.65 / 1000)).toFixed(2) + ' pp;  at p = .06: ' + (100 * Math.sqrt(0.06 * 0.94 / 1000)).toFixed(2) + ' pp');
  })();

  line('\n=== 2c. does moving one slider flip the winner? (sliders 0–100, weights normalised) ===');
  [[40, 30, 20, 10], [35, 30, 20, 15], [30, 30, 20, 20], [40, 25, 20, 15], [45, 30, 15, 10], [30, 40, 20, 10], [25, 25, 25, 25], [40, 20, 20, 20], [30, 20, 40, 10], [60, 10, 10, 20]].forEach(function (sl) {
    var t = totals(weights(sl)), o = order(t);
    line('sliders ' + sl.join('/') + ' → ' + o.map(function (i) { return NAMES[i] + ' ' + f2(t[i]); }).join('  '));
  });
  line('smallest single-slider move from 40/30/20/10 that changes the winner (step 5):');
  [0, 1, 2, 3].forEach(function (k) {
    var best = null, d, sl, t;
    for (d = -40; d <= 60; d += 5) { sl = DEF.slice(); sl[k] = DEF[k] + d; if (sl[k] < 0 || sl[k] > 100 || d === 0) continue; t = totals(weights(sl)); if (winner(t) !== 0 && (best === null || Math.abs(d) < Math.abs(best.d))) best = { d: d, win: NAMES[winner(t)] }; }
    line('  ' + CRIT[k] + ': ' + (best ? (best.d > 0 ? '+' : '') + best.d + ' → winner ' + best.win : 'none within range'));
  });

  line('\n=== 3. the widget\'s default KPI strings (seed 1, ±50%) ===');
  (function () {
    var w = weights(DEF), t = totals(w), o = order(t), te = totals(weights(EQ)), oe = order(te), cA = sharesAround(b1, w, 0.5), cU = sharesUniform(b1);
    line('top3     : ' + o.slice(0, 3).map(function (i) { return NAMES[i] + ' ' + f2(t[i]); }).join(' · '));
    line('gaps     : ' + f2(t[o[0]] - t[o[1]]) + ' / ' + f2(t[o[0]] - t[o[2]]));
    line('equal    : ' + NAMES[oe[0]] + ' ' + f2(te[oe[0]]) + ' · corr ' + corr(t, te).toFixed(3));
    line('around   : ' + show(cA));
    line('know-none: ' + show(cU));
    line('winner share around = ' + Math.round(cA[o[0]] / NV * 100) + '%; winner share know-nothing = ' + Math.round(cU[o[0]] / NV * 100) + '%');
  })();

  line('\n=== 4. equal weights vs the optimum — correlation of the two TOTALS, FACTS (b) (DERIVED): corr(1ᵀx, wᵀx) = 1ᵀΣw / √((1ᵀΣ1)(wᵀΣw)), Σ = (1−ρ)I + ρ·11ᵀ ===');
  function corrUnit(k, rho, w) { var S = [], i, j, Sw = [], one = 0, ww = 0, o1 = 0, sw1 = 0; for (i = 0; i < k; i++) { S.push([]); for (j = 0; j < k; j++) S[i].push(i === j ? 1 : rho); } for (i = 0; i < k; i++) { var s = 0; for (j = 0; j < k; j++) s += S[i][j] * w[j]; Sw.push(s); sw1 += s; ww += w[i] * s; for (j = 0; j < k; j++) o1 += S[i][j]; } return sw1 / Math.sqrt(o1 * ww); }
  [['4:3:2:1', [4, 3, 2, 1]], ['6:2:1:1', [6, 2, 1, 1]], ['10:1:1:1 (one dominant)', [10, 1, 1, 1]], ['6 cues 6:5:4:3:2:1', [6, 5, 4, 3, 2, 1]], ['8 cues 8:7:…:1', [8, 7, 6, 5, 4, 3, 2, 1]]].forEach(function (c) {
    line(String(c[0]).padEnd(26) + [0, 0.2, 0.4, 0.6].map(function (rho) { return corrUnit(c[1].length, rho, c[1]).toFixed(3); }).join(' / ') + '   (ρ = 0 / .2 / .4 / .6)');
  });
  line('FACTS: 4:3:2:1 → .913/.953/.974/.986 · 6:2:1:1 → .772/.864/.918/.955 · 10:1:1:1 → .640/.763/.848/.911 · 6 cues → .899/.956/.977/.988 · 8 cues → .891/.959/.980/.990');
  line('validity of equal weights when the optimum is .50 = .50 × the correlation above:  4:3:2:1 at ρ=.3 → ' + (0.5 * corrUnit(4, 0.3, [4, 3, 2, 1])).toFixed(3) + ' (FACTS .483); 10:1:1:1 at ρ=.3 → ' + (0.5 * corrUnit(4, 0.3, [10, 1, 1, 1])).toFixed(3) + ' (FACTS .404)');
  (function () {                                // independent Monte-Carlo check of one claim in FACTS (c): LS weights estimated from n = 30 reach ≈ .415 vs equal weights .483 (4 cues 4:3:2:1, ρ = .3, R = .5)
    var rho = 0.3, k = 4, wTrue = [4, 3, 2, 1], R = 0.5, reps = 1500, n = 30, rng = mulberry32(31), i, j, a, b, tot = 0, cnt = 0;
    var L = [[1, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]], S = [], Sw;                                  // Cholesky of Σ
    for (i = 0; i < k; i++) { S.push([]); for (j = 0; j < k; j++) S[i].push(i === j ? 1 : rho); }
    for (i = 0; i < k; i++) for (j = 0; j <= i; j++) { var s = S[i][j]; for (a = 0; a < j; a++) s -= L[i][a] * L[j][a]; L[i][j] = i === j ? Math.sqrt(s) : s / L[j][j]; }
    function dot(x, y) { var s = 0, q; for (q = 0; q < x.length; q++) s += x[q] * y[q]; return s; }
    function mv(Mx, v) { return Mx.map(function (r) { return dot(r, v); }); }
    var wS = mv(S, wTrue), vopt = Math.sqrt(dot(wTrue, wS)), noiseSD = Math.sqrt(vopt * vopt * (1 / (R * R) - 1)), sumVal = 0, eqVal;
    function validity(wh) { var cov = dot(wh, wS), v = Math.sqrt(dot(wh, mv(S, wh))); return cov / (v * vopt) * R; }   // corr(wh·x, y) with y = w·x + noise, optimum corr = R
    eqVal = validity([1, 1, 1, 1]);
    function solve(A, bvec) { var m = A.length, Mx = A.map(function (r, q) { return r.concat([bvec[q]]); }), p, q, r2, f; for (p = 0; p < m; p++) { var piv = p; for (q = p + 1; q < m; q++) if (Math.abs(Mx[q][p]) > Math.abs(Mx[piv][p])) piv = q; var tmp = Mx[p]; Mx[p] = Mx[piv]; Mx[piv] = tmp; for (q = p + 1; q < m; q++) { f = Mx[q][p] / Mx[p][p]; for (r2 = p; r2 <= m; r2++) Mx[q][r2] -= f * Mx[p][r2]; } } var x = new Array(m); for (p = m - 1; p >= 0; p--) { var s2 = Mx[p][m]; for (q = p + 1; q < m; q++) s2 -= Mx[p][q] * x[q]; x[p] = s2 / Mx[p][p]; } return x; }
    var beat = 0;
    for (var rep = 0; rep < reps; rep++) {
      var X = [], Y = [];
      for (i = 0; i < n; i++) { var z = [gauss(rng), gauss(rng), gauss(rng), gauss(rng)], x = [], q; for (q = 0; q < k; q++) { var s3 = 0; for (var t2 = 0; t2 <= q; t2++) s3 += L[q][t2] * z[t2]; x.push(s3); } X.push(x); Y.push(dot(wTrue, x) + noiseSD * gauss(rng)); }
      var XtX = [], XtY = [];
      for (a = 0; a < k; a++) { XtX.push([]); var sy = 0; for (b = 0; b < k; b++) { var sxx = 0; for (i = 0; i < n; i++) sxx += X[i][a] * X[i][b]; XtX[a].push(sxx); } for (i = 0; i < n; i++) sy += X[i][a] * Y[i]; XtY.push(sy); }
      var bh = solve(XtX, XtY), val = validity(bh); sumVal += val; if (val > eqVal) beat++;
    }
    line('MC check (FACTS (c), 4 cues 4:3:2:1, ρ = .3, R = .50, n = 30, ' + reps + ' fits): LS-weights mean out-of-sample validity ' + (sumVal / reps).toFixed(3) + ' (FACTS .415), equal weights ' + eqVal.toFixed(3) + ' (FACTS .483), share of fits beating equal ' + Math.round(100 * beat / reps) + '% (FACTS 14%)');
  })();

  line('\n=== 5. Haynes 2009 / Urbach 2014 arithmetic (FACTS 03-B, DERIVED) ===');
  (function () {
    var n0 = 3733, n1 = 3955;
    [['deaths', 0.015, 0.008], ['complications', 0.110, 0.070]].forEach(function (c) {
      var d = c[1] - c[2], se = Math.sqrt(c[1] * (1 - c[1]) / n0 + c[2] * (1 - c[2]) / n1), z = d / se;
      line(c[0] + ': per 1000 ' + (c[1] * 1000).toFixed(0) + ' → ' + (c[2] * 1000).toFixed(0) + '; ARR ' + (d * 100).toFixed(2) + ' pp (95% CI ' + ((d - 1.96 * se) * 100).toFixed(2) + ' to ' + ((d + 1.96 * se) * 100).toFixed(2) + '), RRR ' + (100 * (1 - c[2] / c[1])).toFixed(1) + '%, NNT ' + (1 / d).toFixed(0) + ', z ' + z.toFixed(2) + ', two-sided p ≈ ' + (2 * (1 - phiExact(Math.abs(z)))).toFixed(4) + ', implied counts ' + Math.round(c[1] * n0) + ' vs ' + Math.round(c[2] * n1));
    });
    var p = 0.015, mde = (1.96 + 0.8416) * Math.sqrt(p * (1 - p) * (1 / n0 + 1 / n1));
    line('Haynes minimum detectable drop at 80% power (α = .05 two-sided, baseline 1.5%): ' + (mde * 100).toFixed(2) + ' pp = ' + (100 * mde / p).toFixed(0) + '% relative');
    var pu = 0.0071, mdeU = (1.96 + 0.8416) * Math.sqrt(pu * (1 - pu) * (1 / 109341 + 1 / 106370));
    line('Urbach minimum detectable drop (crude, unadjusted): ' + (mdeU * 100).toFixed(3) + ' pp = ' + (100 * mdeU / pu).toFixed(1) + '% of 0.71%;  observed 0.71% → 0.65% = ' + (100 * (1 - 0.65 / 0.71)).toFixed(1) + '% relative (' + (0.71 - 0.65).toFixed(2) + ' pp)');
    line('Haynes rates as odds ratio: ' + ((0.008 / 0.992) / (0.015 / 0.985)).toFixed(3) + ' (Urbach CI 0.80–1.03 excludes it);  Urbach total operations ' + (109341 + 106370));
    line('Keystone: mean 7.7 → 1.4 = −' + (100 * (1 - 1.4 / 7.7)).toFixed(0) + '%; 7.7 → 1.1 = −' + (100 * (1 - 1.1 / 7.7)).toFixed(0) + '%; IRR 0.34 → −' + Math.round(100 * (1 - 0.34)) + '%');
  })();

  line('\n=== 6. plain-language effect sizes (DERIVED): CLES = Φ(d/√2) ===');
  // d = 0.43 is Mertens et al. 2022 AFTER the authors' own correction (212 publications, 447 effects, n = 2,148,439; FACTS_T6a CORRECTION bullet) — the uncorrected 0.45 must not be quoted
  [0.04, 0.11, 0.31, 0.43, 0.68, 0.77, 0.8, 1.0, 1.1].forEach(function (d) { line('d = ' + d.toFixed(2) + ' → a random treated person beats a random control ' + pc(phiExact(d / Math.SQRT2), 1)); });
  line('nudge units vs academic trials: 8.7 / 1.4 = ' + (8.7 / 1.4).toFixed(2) + ' (pp);  33.5 / 8.1 = ' + (33.5 / 8.1).toFixed(2) + ' (relative);  1.4/8.7 = ' + (100 * 1.4 / 8.7).toFixed(0) + '%, 8.1/33.5 = ' + (100 * 8.1 / 33.5).toFixed(0) + '%');
  line('defaults: 86 / 37 = ' + (86 / 37).toFixed(2) + ' (participation, 49 pp apart);  online consent 82 / 42 = ' + (82 / 42).toFixed(2) + ';  actual donation 14.1 → 16.4 = +' + (100 * (16.4 / 14.1 - 1)).toFixed(1) + '%');
  line('Grove 2000: clinical NOT substantially better in ' + (100 - 16) + '–' + (100 - 6) + '% of analyses (84–94%);  replication sample ratio 692 / 20 = ' + (692 / 20).toFixed(1));

  line('\n=== 7. the crowd-average identity (an identity, invented numbers): (x̄ − T)² = mean (xᵢ − T)² − mean (xᵢ − x̄)² ===');
  (function () {
    var x = [1100, 1250, 1180, 1300, 1050, 1210, 1190], T = 1198, n = x.length, m = x.reduce(function (a, b) { return a + b; }, 0) / n, ind = 0, sp = 0, i;
    for (i = 0; i < n; i++) { ind += (x[i] - T) * (x[i] - T); sp += (x[i] - m) * (x[i] - m); }
    line('mean ' + m.toFixed(2) + '; average individual squared error ' + (ind / n).toFixed(2) + '; spread ' + (sp / n).toFixed(2) + '; squared error of the mean ' + ((m - T) * (m - T)).toFixed(2) + ' = ' + (ind / n - sp / n).toFixed(2));
    line('RMS individual error ' + Math.sqrt(ind / n).toFixed(1) + ' lb vs error of the mean ' + Math.abs(m - T).toFixed(1) + ' lb;  Galton: 9/1198 = ' + (900 / 1198).toFixed(2) + '% (printed 0.8%, 9/1207 = ' + (900 / 1207).toFixed(2) + '%)');
  })();

  line('\n=== 8. bias–noise identity check: mean squared error = (mean error)² + variance of the errors ===');
  (function () {
    var e = [3, -1, 4, 1, -5, 9, 2, 6], n = e.length, m = e.reduce(function (a, b) { return a + b; }, 0) / n, mse = e.reduce(function (a, b) { return a + b * b; }, 0) / n, v = e.reduce(function (a, b) { return a + (b - m) * (b - m); }, 0) / n;
    line('errors ' + e.join(',') + ': MSE ' + mse.toFixed(3) + ' = ' + (m * m).toFixed(3) + ' + ' + v.toFixed(3) + ' = ' + (m * m + v).toFixed(3));
  })();

  line('\n=== 9. PSY.rng identity check (loads the real psy.js) ===');
  (function () {
    var fs = require('fs'), vm = require('vm'), path = require('path');
    var src = fs.readFileSync(path.join(__dirname, '../../../all_lessons/psychology_play/lessons/psy.js'), 'utf8');
    var win = { localStorage: { getItem: function () { return null; }, setItem: function () {} } }; win.window = win; vm.createContext(win); vm.runInContext(src, win);
    var a = win.PSY.rng(123), b = mulberry32(123), same = true, i;
    for (i = 0; i < 1000; i++) if (a() !== b()) same = false;
    line('PSY.rng == local mulberry32: ' + same + ' ; PSY.phi(1.96)=' + win.PSY.phi(1.96).toFixed(5) + ' (exact ' + phiExact(1.96).toFixed(5) + ')');
  })();
}
if (typeof module !== 'undefined') module.exports = { M: M, weights: weights, totals: totals, order: order, winner: winner, corr: corr, mkBase: mkBase, sharesAround: sharesAround, sharesUniform: sharesUniform };
