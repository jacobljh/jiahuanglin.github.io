// proto/p02.js — sidecar lesson 02 widget maths: 「20 题 90% 区间测验」 (MEASURES the reader) + three scores for it.
// run: node tools/psy_qa/proto/p02.js          (NB the p prefix: proto/02.js belongs to the spine)
//
// What the widget does. 20 questions (FACTS_T6a "Widget constants (02) (a)": answers exactly as listed, each from an opened source).
// The reader types a low and a high number per question ("90% sure the truth is in between"); blank questions are skipped.
//   n  = number of questions with two numbers;  k = hits (low ≤ truth ≤ high; low/high swapped if typed the other way round)
//   Reference (DERIVED, FACTS (b)): if the reader's true coverage were 90%, k ~ Bin(n, 0.9). n = 20: mean 18, SD 1.34,
//       P(≤15) = 4.3%, P(≤14) = 1.1%, P(≥19) = 39.2%, P(20) = 12.2%; true coverage 80% → P(k ≥ 15) = 80%, 50% → 2.1%.
//   Brier (one-probability form, every interval = one forecast "90% sure the truth is inside"):
//       BS = (0.01·k + 0.81·(n − k)) / n  — FACTS (b) table: k = 20 → 0.01, 18 → 0.09, 15 → 0.21, 14 → 0.25 (= always 50%), 10 → 0.41, 8 → 0.49.
//       Murphy decomposition with ONE forecast value (0.9): reliability = (0.9 − ō)², resolution = 0, uncertainty = ō(1 − ō), ō = k/n
//       (exact identity, re-checked below).
//   Interval score (Gneiting & Raftery 2007 eq. 43, α = 0.10, penalty 2/α = 20 per unit of miss) on the NATURAL-LOG scale for the
//       magnitude questions Q01–Q15 only — FACTS (b) marks this as the lead's [~] suggestion, not something G&R state. Q16–Q20
//       (marathon length and four years) count for hits and Brier only. A question with low ≤ 0 is skipped in the log score.
//   Strip chart: u = (truth − low)/(high − low): 0 = reader's low, 1 = reader's high; a hit has 0 ≤ u ≤ 1.
//
// 示意读者 (simulated readers; NOT data about people; all constants below are invented, labelled 示意 in the page):
//   z_i ~ N(0,1) from PSY.rng(SEED), one per question in order. A casual guess is the truth times exp(SIG_LOG·z) (magnitude
//   questions) or truth + SIG_YEAR·z (years). The stated 90% interval is the guess ± f × 1.645 × (the guess's own error scale):
//   f = 1 is the honest width, f = 0.4 intervals 40% as wide as the error needs (FACTS 02-A DERIVED: hit rate 2Φ(1.645 f) − 1 = 48.9%).
//   Because all presets share the same z_i, the hit sets are nested (f small ⊂ f large).
//
// Everything printed here must equal what kpi.js prints for the page (after the corresponding click).
function mulberry32(seed) { var a = seed >>> 0; return function () { a = (a + 0x6D2B79F5) >>> 0; var t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function gauss(r) { var u = r() || 1e-12, v = r(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }
function erfAS(x) { var s = x < 0 ? -1 : 1; x = Math.abs(x); var t = 1 / (1 + 0.3275911 * x); var y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x); return s * y; }
function phiAS(z) { return 0.5 * (1 + erfAS(z / Math.SQRT2)); }                    // = PSY.phi
function phiExact(z) { if (Math.abs(z) > 5) return phiAS(z); var x = z / Math.SQRT2, s = x, term = x, n; for (n = 1; n < 200; n++) { term *= -x * x / n; s += term / (2 * n + 1); if (Math.abs(term) < 1e-17) break; } return 0.5 * (1 + 2 / Math.sqrt(Math.PI) * s); }
function pdf(x) { return Math.exp(-x * x / 2) / Math.sqrt(2 * Math.PI); }

// ───────── the 20 questions (FACTS_T6a, "Widget constants (02) (a)") ─────────
var Q = [
  { n: 1, t: 'Earth–Moon mean distance (km)', a: 384400 },
  { n: 2, t: 'Moon diameter (km)', a: 3474.8 },
  { n: 3, t: 'Mars diameter (km)', a: 6779 },
  { n: 4, t: 'Sun diameter (km)', a: 1391400 },
  { n: 5, t: 'Earth equatorial radius (km)', a: 6378.137 },
  { n: 6, t: 'Jupiter mass in Earth masses', a: 317.8 },
  { n: 7, t: 'Earth escape velocity (km/s)', a: 11.186 },
  { n: 8, t: 'Venus sunrise-to-sunrise day (Earth days)', a: 116.75 },
  { n: 9, t: 'Mars sidereal orbital period (Earth days)', a: 686.98 },
  { n: 10, t: 'Mars solar day (hours)', a: 24.6597 },
  { n: 11, t: 'Speed of light (km/s)', a: 299792.458 },
  { n: 12, t: 'Earth–Sun mean distance (million km)', a: 149.6 },
  { n: 13, t: 'Burj Khalifa architectural height (m)', a: 828 },
  { n: 14, t: 'Golden Gate main span (m)', a: 1280 },
  { n: 15, t: 'Golden Gate tower height above water (m)', a: 227 },
  { n: 16, t: 'Marathon length (km)', a: 42.195 },
  { n: 17, t: 'Berlin Wall crossings opened (year)', a: 1989, yr: true },
  { n: 18, t: 'Statue of Liberty dedicated (year)', a: 1886, yr: true },
  { n: 19, t: 'Golden Gate Bridge completed (year)', a: 1937, yr: true },
  { n: 20, t: 'Burj Khalifa completed (year)', a: 2010, yr: true }
];
var NLOG = 15;                                          // Q01–Q15 get the log-scale interval score
var Z95 = 1.645;

// ───────── scoring ─────────
function lchoose(n, k) { var s = 0, i; for (i = 1; i <= k; i++) s += Math.log((n - k + i) / i); return s; }
function binPmf(n, p) { var out = [], k; for (k = 0; k <= n; k++) out.push(Math.exp(lchoose(n, k) + k * Math.log(p) + (n - k) * Math.log(1 - p))); return out; }
function cdf(pm, k) { var s = 0, i; for (i = 0; i <= k; i++) s += pm[i]; return s; }
function median(a) { var b = a.slice().sort(function (x, y) { return x - y; }), m = b.length >> 1; return b.length ? (b.length % 2 ? b[m] : (b[m - 1] + b[m]) / 2) : NaN; }
function intervalScoreLog(l, h, x) { var ll = Math.log(l), uu = Math.log(h), xx = Math.log(x); return (uu - ll) + 20 * Math.max(0, ll - xx) + 20 * Math.max(0, xx - uu); }
function intervalScore(l, h, x) { return (h - l) + 20 * Math.max(0, l - x) + 20 * Math.max(0, x - h); }
// lo, hi: arrays of 20 numbers or NaN
function grade(lo, hi) {
  var n = 0, k = 0, ls = [], rt = [], u = [], i, a, b, l, h, x, hit;
  for (i = 0; i < 20; i++) {
    a = lo[i]; b = hi[i]; u.push(NaN);
    if (!isFinite(a) || !isFinite(b)) continue;
    l = Math.min(a, b); h = Math.max(a, b); x = Q[i].a; n++;
    hit = l <= x && x <= h; if (hit) k++;
    u[i] = h > l ? (x - l) / (h - l) : (x === l ? 0.5 : (x < l ? -9 : 10));
    if (i < NLOG && l > 0) { ls.push(intervalScoreLog(l, h, x)); rt.push(h / l); }
  }
  var pm = n ? binPmf(n, 0.9) : [], o = n ? k / n : NaN;
  return {
    n: n, k: k, rate: o, pLE: n ? cdf(pm, k) : NaN, bs: n ? (0.01 * k + 0.81 * (n - k)) / n : NaN,
    rel: n ? (0.9 - o) * (0.9 - o) : NaN, unc: n ? o * (1 - o) : NaN,
    logS: ls.length ? ls.reduce(function (s, v) { return s + v; }, 0) / ls.length : NaN, nLog: ls.length, ratio: median(rt), u: u
  };
}
function sig3(v) { return Number(v.toPrecision(3)); }

// ───────── simulated readers ─────────
var SIG_LOG = 0.35, SIG_YEAR = 10, SEED = 2026;        // 示意 constants (invented); SEED was fixed up front, sections 5-6 only show it is a typical draw (about a third of seeds meet the window)
function zs(seed) { var r = mulberry32(seed), z = [], i; for (i = 0; i < 20; i++) z.push(gauss(r)); return z; }
function fill(z, f) {
  var lo = [], hi = [], i, q, g, h;
  for (i = 0; i < 20; i++) {
    q = Q[i];
    if (!q.yr) { h = Z95 * f * SIG_LOG; g = q.a * Math.exp(SIG_LOG * z[i]); lo.push(sig3(g * Math.exp(-h))); hi.push(sig3(g * Math.exp(h))); }
    else { h = Z95 * f * SIG_YEAR; g = q.a + SIG_YEAR * z[i]; lo.push(Math.round(g - h)); hi.push(Math.round(g + h)); }
  }
  return { lo: lo, hi: hi };
}
function f2(x) { return isFinite(x) ? x.toFixed(2) : '—'; }
function pc(x, d) { return isFinite(x) ? (100 * x).toFixed(d === undefined ? 1 : d) + '%' : '—'; }

if (require.main === module) {
  var line = function (s) { console.log(s); };
  var pm20 = binPmf(20, 0.9), k;
  line('=== 1. FACTS (b) DERIVED: hits ~ Bin(20, 0.9) ===');
  line('mean ' + (20 * 0.9) + '  SD ' + Math.sqrt(20 * 0.9 * 0.1).toFixed(3) + '  P(≤15) ' + pc(cdf(pm20, 15)) + '  P(≤14) ' + pc(cdf(pm20, 14)) + '  P(≤16) ' + pc(cdf(pm20, 16)) + '  P(≥19) ' + pc(1 - cdf(pm20, 18)) + '  P(20) ' + pc(pm20[20]));
  var pm8 = binPmf(20, 0.8), pm5 = binPmf(20, 0.5);
  line('true coverage 80%: P(k ≥ 15) ' + pc(1 - cdf(pm8, 14)) + '   50%: P(k ≥ 15) ' + pc(1 - cdf(pm5, 14)));
  line('P(k) for k = 12..20: ' + pm20.slice(12).map(function (p, j) { return (12 + j) + ':' + pc(p); }).join('  '));
  line('binomial SD for p = .7, n = 10: ' + (100 * Math.sqrt(0.7 * 0.3 / 10)).toFixed(1) + ' percentage points');

  line('\n=== 2. Brier (one-probability form) by hits k of 20; decomposition ===');
  [20, 19, 18, 17, 16, 15, 14, 13, 12, 10, 8].forEach(function (kk) {
    var o = kk / 20, bs = (0.01 * kk + 0.81 * (20 - kk)) / 20, rel = (0.9 - o) * (0.9 - o), unc = o * (1 - o);
    line('k=' + kk + '  BS ' + bs.toFixed(3) + '   reliability ' + rel.toFixed(4) + ' − resolution 0 + uncertainty ' + unc.toFixed(4) + ' = ' + (rel + unc).toFixed(4) + (Math.abs(rel + unc - bs) < 1e-12 ? '  ✓ identity' : '  ✗'));
  });
  line('always 50%: ' + (0.5 * 0.5) + ' (one-probability) / ' + (2 * 0.25) + ' (original 0–2 form);  base-rate forecaster b(1−b): ' + [0.1, 0.2, 0.3, 0.5].map(function (b) { return 'b=' + b + ' → ' + (b * (1 - b)).toFixed(2); }).join(', '));
  line('worked example 90%: happens ' + ((0.9 - 1) * (0.9 - 1)).toFixed(2) + ' / not ' + (0.81).toFixed(2) + ' (one-prob);  original ' + ((0.1 * 0.1 + 0.01)).toFixed(2) + ' / ' + (0.81 + 0.81).toFixed(2));
  line('BS(k) = 0.81 − 0.04k:  k = 14 → ' + (0.81 - 0.04 * 14).toFixed(2) + ' (= always 50%);  k = 13 → ' + (0.81 - 0.04 * 13).toFixed(2));

  line('\n=== 3. interval score, Q01 (truth 384,400 km): raw units (FACTS 100,000 / 10,000 / 31,000 / 2,838,000) and natural-log (0.288 / 0.026 / 0.081 / 9.521) ===');
  [[300000, 400000], [380000, 390000], [380000, 383000], [100000, 250000]].forEach(function (iv) {
    line('[' + iv[0] + ', ' + iv[1] + ']  raw ' + Math.round(intervalScore(iv[0], iv[1], 384400)) + '   log ' + intervalScoreLog(iv[0], iv[1], 384400).toFixed(3));
  });

  line('\n=== 4. FACTS 02-A DERIVED: hit rate of a normal-error interval whose width is the fraction f of the needed one: 2Φ(1.645 f) − 1 ===');
  line([1.0, 0.8, 0.6, 0.5, 0.4, 0.3, 0.1, 3].map(function (f) { return 'f=' + f + ' → ' + pc(2 * phiExact(Z95 * f) - 1); }).join(' · '));

  line('\n=== 5. simulated readers: which seed? (nested hit sets; want k(0.4) near its expectation 9.8, k(1) near 18, k(0.1) small) ===');
  var fs0 = [0.1, 0.4, 1.0, 3.0], sd, good = [];
  for (sd = 1; sd <= 3000; sd++) {
    var z = zs(sd), ks = fs0.map(function (f) { var o = fill(z, f); return grade(o.lo, o.hi).k; });
    if (ks[0] >= 1 && ks[0] <= 4 && ks[1] >= 9 && ks[1] <= 11 && ks[2] >= 17 && ks[2] <= 19 && ks[3] === 20) good.push(sd + ':' + ks.join('/'));
    if (sd <= 12) line('seed ' + sd + ': hits at f = ' + fs0.join(' / ') + ' → ' + ks.join(' / '));
  }
  line('seeds 1..3000 meeting the window (first 12): ' + good.slice(0, 12).join('  ') + '   [' + good.length + ' of 3000]');
  line('expected hits at f = ' + fs0.join(' / ') + ': ' + fs0.map(function (f) { return (20 * (2 * phiExact(Z95 * f) - 1)).toFixed(1); }).join(' / '));

  line('\n=== 6. the four presets at SEED ' + SEED + ' ===');
  var zz = zs(SEED), names = ['窄 f=0.1', '随手猜 f=0.4', '恰当 f=1.0', '宽 f=3.0'];
  fs0.forEach(function (f, j) {
    var o = fill(zz, f), g = grade(o.lo, o.hi);
    line(names[j] + ': n ' + g.n + '  k ' + g.k + '  rate ' + pc(g.rate, 0) + '  P(≤k | Bin(n, .9)) ' + (g.pLE < 0.001 ? '<0.1%' : pc(g.pLE)) + '  BS ' + f2(g.bs) + ' (= rel ' + f2(g.rel) + ' + unc ' + f2(g.unc) + ' − 0)  logIS ' + f2(g.logS) + ' (' + g.nLog + ' q)  ratio×' + g.ratio.toFixed(2));
  });
  var o1 = fill(zz, 0.4);
  line('casual (f=0.4) intervals, first 6: ' + o1.lo.slice(0, 6).map(function (v, i) { return '[' + v + ', ' + o1.hi[i] + ']'; }).join(' '));
  line('casual (f=0.4) years: ' + o1.lo.slice(16).map(function (v, i) { return '[' + v + ', ' + o1.hi[16 + i] + ']'; }).join(' '));

  line('\n=== 7. does the log interval score have its interior minimum at f ≈ 1? (mean over 3000 seeds, SIG_LOG ' + SIG_LOG + ') ===');
  var fgrid = [0.1, 0.2, 0.4, 0.6, 0.8, 1.0, 1.2, 1.5, 2, 3], acc = fgrid.map(function () { return 0; }), cnt = 0;
  for (sd = 1; sd <= 3000; sd++) { var z7 = zs(sd); fgrid.forEach(function (f, j) { var o = fill(z7, f), g = grade(o.lo, o.hi); acc[j] += g.logS; }); cnt++; }
  line(fgrid.map(function (f, j) { return 'f=' + f + ' → ' + (acc[j] / cnt).toFixed(3); }).join('  '));
  var best = 0; acc.forEach(function (v, j) { if (v < acc[best]) best = j; });
  line('minimum at f = ' + fgrid[best]);

  line('\n=== 8. Monte-Carlo check of 2Φ(1.645 f) − 1 with these readers (magnitude items, 3000 seeds × 16 items) ===');
  [0.1, 0.4, 1.0, 3.0].forEach(function (f) {
    var hits = 0, tot = 0, s2, i2;
    for (s2 = 1; s2 <= 3000; s2++) { var zq = zs(s2), oo = fill(zq, f); for (i2 = 0; i2 < 16; i2++) { tot++; if (oo.lo[i2] <= Q[i2].a && Q[i2].a <= oo.hi[i2]) hits++; } }
    line('f=' + f + ': sim ' + pc(hits / tot) + '   formula ' + pc(2 * phiExact(Z95 * f) - 1));
  });

  line('\n=== 9. PSY.rng / PSY.gauss identity check (loads the real psy.js) ===');
  (function () {
    var fs = require('fs'), vm = require('vm'), path = require('path');
    var src = fs.readFileSync(path.join(__dirname, '../../../all_lessons/psychology_play/lessons/psy.js'), 'utf8');
    var win = { localStorage: { getItem: function () { return null; }, setItem: function () {} } }; win.window = win; vm.createContext(win); vm.runInContext(src, win);
    var a = win.PSY.rng(123), b = mulberry32(123), same = true, i;
    for (i = 0; i < 1000; i++) if (a() !== b()) same = false;
    var g1 = win.PSY.rng(9), g2 = mulberry32(9), gs = true;
    for (i = 0; i < 500; i++) if (win.PSY.gauss(g1) !== gauss(g2)) gs = false;
    line('PSY.rng == local mulberry32: ' + same + ' ; PSY.gauss == local gauss: ' + gs);
  })();
}
if (typeof module !== 'undefined') module.exports = { Q: Q, grade: grade, fill: fill, zs: zs, binPmf: binPmf, cdf: cdf };
