// proto/11.js — lesson 11 widget maths: "how hard is a developmental window?  wall, soft band or steady slide?"
// (受已发表数字启发的示意模型 — a labelled demo model. The anchor points are published (FACTS_T3b §11 D/E); the curves are 示意.)
// run: node tools/psy_qa/proto/11.js       (the same functions are ported verbatim into 11_development.html; RNG-free, fully deterministic)
//
// A window = a curve p(t) in [0,1]: "how much can experience that starts at age t still change?"  (1 = fully open, 0 = closed).
//   soft band(m, W): p = 1 up to u = m − W/2, falls linearly to 0 at v = m + W/2, 0 afterwards.   W = 0 is a WALL at m (p = 1 for t <= m).
//   steady slide: the same ramp laid over the whole age axis (m = middle, W = whole axis): no window, just "harder and harder".
// Each published number is an AGE INTERVAL [a,b] with a value y in [0,1]; the model's prediction for it is the AVERAGE of p over [a,b]
//   (a = b for a point).  Fit = for every width W (K+1 values from 0 to the whole axis) the position m with the smallest
//   SSE = sum (y − prediction)²  (grid search over m, step = axis/400; no randomness).
//   SSE is NOT weighted by sample size (FACTS gives no group sizes for the cut-off groups) → a descriptive distance, not a test.
// "fits about as well" tolerance: SSE <= min + 0.01 + 0.25·min   (a demo convention, 示意).
//
// ANCHORS (all ages as published; the y rules are the page's own, 示意)
//  Bucharest (Smyke et al. 2010, Table 5 as given in FACTS_T3b W6): share securely attached at 42 months among foster-care children placed
//     BEFORE / AFTER a cut-off (months): 18: 53.8/46.8; 20: 58.8/44.2; 22: 63.6/39.5; 24: 69.0/29.0; 26: 66.7/25.9; 28: 60.0/25.0.
//     Care-as-usual 17.5%, never-institutionalised 64.7%  =>  y = (share − 17.5) / (64.7 − 17.5).  Placement ages assumed uniform on 6–31
//     months (BEIP baseline range: King 2023 6–31, Fox 2011 5–31)  =>  "before c" = [6, c], "after c" = [c, 31].  Popular wall: 24 months.
//  Kitten (Hubel & Wiesel 1970, FACTS_T3a C5): "remains high until some time between the sixth and eighth weeks", "disappearing finally
//     around the end of the third month"  =>  coded y(6 wk) = 1, y(13 wk) = 0 (bounds from words → hollow dots).  Popular wall: 8 weeks.
//  Hearing (Sharma, Dorman & Spahr 2002): age-appropriate P1 latency within 6 months if deprivation <= about 3.5 y; abnormal latencies
//     after 7+ years  =>  coded y(3.5) = 1, y(7) = 0 (hollow dots).  Wall: 3.5 y (the authors' "sensitive period of about 3.5 years").
//  Amblyopia (Scheiman et al. 2005, PEDIG): responders treated vs glasses alone: ages 7–12 53% vs 25%; ages 13–17 25% vs 23%; 13–17 never
//     treated before 47% vs 20%.  Benefit = difference / 28 (the 7–12 benefit, assumed full strength): [7,13) = 1; [13,18) = 2/28 = 0.07
//     (all teens) or 27/28 = 0.96 (never treated).  Popular wall: age 8 ("no treatment after 7–8", which FACTS calls wrong).
//  Absolute pitch (Baharloo et al. 1998, self-report): began training at <= 4 y: 40%; at >= 9 y: 3%  =>  y(4) = 1, y(9) = 0.  No popular age.
var K = 40;                                              // number of W steps; W_j = axis · j / K
var FLOOR = 17.5, CEIL = 64.7, P_LO = 6, P_HI = 31;
var CUTS = [[18, 53.8, 46.8], [20, 58.8, 44.2], [22, 63.6, 39.5], [24, 69.0, 29.0], [26, 66.7, 25.9], [28, 60.0, 25.0]];
function by(s) { return (s - FLOOR) / (CEIL - FLOOR); }
var BUC = [], i, E = 53 - 25;
for (i = 0; i < CUTS.length; i++) { BUC.push({ a: P_LO, b: CUTS[i][0], y: by(CUTS[i][1]), g: 0 }); BUC.push({ a: CUTS[i][0], b: P_HI, y: by(CUTS[i][2]), g: 1 }); }
var DOMS = [
  { key: 'buc', unit: '个月', lo: 0, hi: 40, pop: 24, an: BUC },
  { key: 'kit', unit: '周', lo: 0, hi: 20, pop: 8, an: [{ a: 6, b: 6, y: 1 }, { a: 13, b: 13, y: 0 }] },
  { key: 'ear', unit: '岁', lo: 0, hi: 20, pop: 3.5, an: [{ a: 3.5, b: 3.5, y: 1 }, { a: 7, b: 7, y: 0 }] },
  { key: 'ambAll', unit: '岁', lo: 0, hi: 20, pop: 8, an: [{ a: 7, b: 13, y: 1 }, { a: 13, b: 18, y: (25 - 23) / E }] },
  { key: 'ambUn', unit: '岁', lo: 0, hi: 20, pop: 8, an: [{ a: 7, b: 13, y: 1 }, { a: 13, b: 18, y: (47 - 20) / E }] },
  { key: 'pit', unit: '岁', lo: 0, hi: 20, pop: null, an: [{ a: 4, b: 4, y: 1 }, { a: 9, b: 9, y: 0 }] }
];

// ∫ p dt measured from the ramp's start u (negative left of u): G(b) − G(a) = ∫_a^b p
function G(t, m, W) {
  if (W <= 0) return Math.min(t, m);
  var u = m - W / 2, v = m + W / 2;
  if (t <= u) return t - u;
  if (t < v) return (W * W - (v - t) * (v - t)) / (2 * W);
  return W / 2;
}
function pAt(t, m, W) { if (W <= 0) return t <= m ? 1 : 0; var u = m - W / 2, v = m + W / 2; return t <= u ? 1 : t >= v ? 0 : (v - t) / W; }
function avgP(a, b, m, W) { return b - a < 1e-9 ? pAt(a, m, W) : (G(b, m, W) - G(a, m, W)) / (b - a); }
function sse(an, m, W) { var s = 0, j, d; for (j = 0; j < an.length; j++) { d = an[j].y - avgP(an[j].a, an[j].b, m, W); s += d * d; } return s; }
function bestM(d, W) {
  var step = (d.hi - d.lo) / 400, idx, m, s, bm = d.lo, bs = 1e9;
  for (idx = 0; idx <= 600; idx++) { m = d.lo + idx * step; s = sse(d.an, m, W); if (s < bs - 1e-12) { bs = s; bm = m; } }
  return { m: bm, s: bs };
}
function summary(d) {
  var span = d.hi - d.lo, pr = [], j, r, jm = 0, mn = 1e9, idx, m, s;
  for (j = 0; j <= K; j++) { r = bestM(d, span * j / K); pr.push({ W: span * j / K, m: r.m, s: r.s }); if (r.s < mn - 1e-12) { mn = r.s; jm = j; } }
  var tol = mn + 0.01 + 0.25 * mn, jl = jm, jh = jm, wlo = null, whi = null, step = span / 400;
  while (jl > 0 && pr[jl - 1].s <= tol) jl--;
  while (jh < K && pr[jh + 1].s <= tol) jh++;
  for (idx = 0; idx <= 600; idx++) { m = d.lo + idx * step; s = sse(d.an, m, 0); if (s <= tol) { if (wlo === null) wlo = m; whi = m; } }
  return { pr: pr, min: mn, jMin: jm, tol: tol, jLo: jl, jHi: jh, jDef: Math.round((jl + jh) / 2), wLo: wlo, wHi: whi,
    steady: sse(d.an, (d.lo + d.hi) / 2, span), forced: d.pop === null ? null : sse(d.an, d.pop, 0) };
}
function f1(x) { return x.toFixed(1); }
function lowT(x) { return (Math.floor(x * 10 + 1e-6) / 10).toFixed(1); }       // a range's lower edge, widened to the tenth
function upT(x) { return (Math.ceil(x * 10 - 1e-6) / 10).toFixed(1); }          // its upper edge (grid points sit one step inside the boundary)
module.exports = { DOMS: DOMS, summary: summary, sse: sse, avgP: avgP, pAt: pAt, K: K, by: by, lowT: lowT, upT: upT };

if (require.main === module) {
  function f(x, n) { return x === null ? '—' : x.toFixed(n === undefined ? 3 : n); }
  DOMS.forEach(function (d) {
    var r = summary(d), span = d.hi - d.lo, w = function (j) { return f(span * j / K, 1); };
    console.log('== ' + d.key + '  n anchors ' + d.an.length + '  axis [' + d.lo + ',' + d.hi + '] ' + d.unit);
    console.log('   k1 wall positions that fit as well: ' + lowT(r.wLo) + '–' + upT(r.wHi) + '   k2 wall SSE ' + f(r.pr[0].s) + ' (best m ' + f1(r.pr[0].m) + ')');
    console.log('   k3 min SSE ' + f(r.min) + ' at W = ' + w(r.jMin) + ' (m ' + f1(r.pr[r.jMin].m) + '); W range ' + w(r.jLo) + '–' + w(r.jHi) + ' (tol ' + f(r.tol) + '); default j ' + r.jDef + ' → W ' + w(r.jDef) + ', m ' + f1(r.pr[r.jDef].m) + ', SSE ' + f(r.pr[r.jDef].s));
    console.log('   k4 steady slide SSE ' + f(r.steady) + '   k5 forced wall at ' + d.pop + ': SSE ' + f(r.forced) + (r.forced !== null && r.pr[0].s > 0.005 ? '  ratio ' + f(r.forced / r.pr[0].s, 2) : ''));
    var mx = 0; r.pr.forEach(function (p) { mx = Math.max(mx, p.s); });
    console.log('   profile max ' + f(mx) + ';  profile: ' + r.pr.filter(function (p, j) { return j % 5 === 0; }).map(function (p) { return f(p.s, 3); }).join(' '));
  });
  var b = DOMS[0], r0 = summary(b);
  console.log('\nBucharest anchors (y): ' + b.an.map(function (x) { return '[' + x.a + ',' + x.b + ']' + x.y.toFixed(2); }).join(' '));
  console.log('RMS per anchor at best: ' + Math.sqrt(r0.min / 12).toFixed(3) + ' (≈ ' + (Math.sqrt(r0.min / 12) * (CEIL - FLOOR)).toFixed(1) + ' percentage points of secure share); wall ' + Math.sqrt(r0.pr[0].s / 12).toFixed(3));
  console.log('wall at best m predicts (published share → wall → soft default → wall@24):');
  b.an.forEach(function (x) {
    var sh = function (y) { return (FLOOR + y * (CEIL - FLOOR)).toFixed(1); };
    console.log('   [' + x.a + ',' + x.b + '] ' + sh(x.y) + ' → ' + sh(avgP(x.a, x.b, r0.pr[0].m, 0)) + ' ; ' + sh(avgP(x.a, x.b, r0.pr[r0.jDef].m, r0.pr[r0.jDef].W)) + ' ; ' + sh(avgP(x.a, x.b, 24, 0)));
  });
}
