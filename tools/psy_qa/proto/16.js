// proto/16.js — lesson 16 widget maths: cutting a continuous scale into "types" (a labelled DEMO model, not data).
// run: node tools/psy_qa/proto/16.js
//
// Setting. A trait is measured twice. X, Y are the two standardised scores of one person, jointly normal, corr(X, Y) = r
// (r is a KNOB: the two sittings may be days or years apart; the gap can be measurement noise or real change).
// A "type letter" = which side of the population median (z = 0) the score falls on, at each sitting.
// P(flip) = P(the two letters differ).
//
// Derivation (re-done here, not copied):
//   Given X = x, Y ~ N(r x, 1 - r^2).   So P(Y > 0 | x) = Phi(r x / s),  s = sqrt(1 - r^2).
//   P(X > 0, Y > 0) = ∫_0^∞ phi(x) Phi(r x / s) dx = 1/4 + arcsin(r) / (2π)        (orthant probability; checked numerically below)
//   P(same side)    = 2 P(X > 0, Y > 0) = 1/2 + arcsin(r)/π     →     P(flip) = 1/2 − arcsin(r)/π = arccos(r)/π.
//   Who flips: given the first score x, P(flip | x) = Phi(− r |x| / s)  (50% at the cut, falling with distance).
//   K independent scales (MBTI has four): P(no letter changes) = (1 − P(flip))^K.
//
// Simulation used by the widget (deterministic): N = 4000 people, K = 4 independent scales; for scale s and person i
//   draw T, E1, E2 ~ N(0,1) once (seeded); X = √r·T + √(1−r)·E1, Y = √r·T + √(1−r)·E2  →  Var = 1, Cov = r.
//   The same base draws are reused for every r, so the dots move smoothly when r changes.
function mulberry32(seed) { var a = seed >>> 0; return function () { a = (a + 0x6D2B79F5) >>> 0; var t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function gauss(r) { var u = r() || 1e-12, v = r(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }
function erfAS(x) { var s = x < 0 ? -1 : 1; x = Math.abs(x); var t = 1 / (1 + 0.3275911 * x); var y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x); return s * y; }
function phiAS(z) { return 0.5 * (1 + erfAS(z / Math.SQRT2)); }                 // = PSY.phi
// a high-precision Phi for the independent check (series for the erf, |z| < 8)
function phiExact(z) { var x = z / Math.SQRT2, s = x, term = x, n; for (n = 1; n < 200; n++) { term *= -x * x / n; s += term / (2 * n + 1); if (Math.abs(term) < 1e-17) break; } var erf = 2 / Math.sqrt(Math.PI) * s; if (Math.abs(z) > 5) return phiAS(z); return 0.5 * (1 + erf); }
function pdf(x) { return Math.exp(-x * x / 2) / Math.sqrt(2 * Math.PI); }

function flipFormula(r) { return Math.acos(r) / Math.PI; }
function flipGiven(x, r) { return phiAS(-r * Math.abs(x) / Math.sqrt(1 - r * r)); }
function allSame(r, K) { return Math.pow(1 - flipFormula(r), K); }

// ───────── 1. independent checks of arccos(r)/π ─────────
function orthantNumeric(r) { var s = Math.sqrt(1 - r * r), h = 0.0005, x, acc = 0; for (x = h / 2; x < 9; x += h) acc += pdf(x) * phiExact(r * x / s) * h; return acc; }
function flipNumeric(r) { var s = Math.sqrt(1 - r * r), h = 0.0005, x, acc = 0; for (x = -9 + h / 2; x < 9; x += h) acc += pdf(x) * phiExact(-r * Math.abs(x) / s) * h; return acc; }
function flipMC(r, n, seed) { var rng = mulberry32(seed), a = Math.sqrt(r), b = Math.sqrt(1 - r), i, f = 0, t, x, y; for (i = 0; i < n; i++) { t = gauss(rng); x = a * t + b * gauss(rng); y = a * t + b * gauss(rng); if ((x > 0) !== (y > 0)) f++; } return f / n; }

// ───────── 2. the widget's simulation ─────────
var N = 4000, K = 4, NB = 400;      // people, scales, dots drawn in the scatter
function makeBase(seed) { var base = [], s, i, rng; for (s = 0; s < K; s++) { rng = mulberry32(seed * 100 + s + 1); var T = [], E1 = [], E2 = []; for (i = 0; i < N; i++) { T.push(gauss(rng)); E1.push(gauss(rng)); E2.push(gauss(rng)); } base.push({ T: T, E1: E1, E2: E2 }); } return base; }
var BINS = 24, BW = 0.25, XMIN = -3;   // who-flips histogram: 24 bins of 0.25 SD over [-3, 3)
function simulate(base, r) {
  var a = Math.sqrt(r), b = Math.sqrt(1 - r), s, i, x, y, flips = 0, noFlipPerson = [], bins = [], binFlip = [], k, nNear = 0, fNear = 0;
  for (k = 0; k < BINS; k++) { bins.push(0); binFlip.push(0); }
  for (i = 0; i < N; i++) noFlipPerson.push(1);
  for (s = 0; s < K; s++) for (i = 0; i < N; i++) {
    x = a * base[s].T[i] + b * base[s].E1[i]; y = a * base[s].T[i] + b * base[s].E2[i];
    var fl = (x > 0) !== (y > 0);
    if (fl) { flips++; noFlipPerson[i] = 0; }
    k = Math.floor((x - XMIN) / BW); if (k >= 0 && k < BINS) { bins[k]++; if (fl) binFlip[k]++; }
    if (Math.abs(x) < 0.25) { nNear++; if (fl) fNear++; }
  }
  var none = 0; for (i = 0; i < N; i++) none += noFlipPerson[i];
  return { flipSim: flips / (N * K), noneSim: none / N, bins: bins, binFlip: binFlip, nearShareSim: nNear / (N * K), nearFlipSim: nNear ? fNear / nNear : 0 };
}
// share of people with |x| < c, and their flip rate (formula, trapezoid)
function nearFormula(r, c) { var h = 0.0005, x, num = 0, den = 0, w; for (x = -c + h / 2; x < c; x += h) { w = pdf(x) * h; den += w; num += w * flipGiven(x, r); } return { share: den, flip: num / den }; }
// among those who flip: share whose first score is within |x| < c
function flippersWithin(r, c) { var h = 0.0005, x, num = 0, den = 0, w; for (x = -9 + h / 2; x < 9; x += h) { w = pdf(x) * flipGiven(x, r) * h; den += w; if (Math.abs(x) < c) num += w; } return num / den; }

function pc(x, d) { return (100 * x).toFixed(d === undefined ? 1 : d) + '%'; }
if (require.main === module) {
  console.log('--- 1. arccos(r)/π vs numerical integration vs seeded Monte-Carlo (400,000 draws) ---');
  console.log('r     formula   orthant-int  flip-int    MC       |MC-formula|');
  [0.31, 0.50, 0.54, 0.64, 0.74, 0.80, 0.86, 0.90, 0.95].forEach(function (r) {
    var f = flipFormula(r), o = 1 - 2 * orthantNumeric(r) * 1, fi = flipNumeric(r), mc = flipMC(r, 400000, 7);
    console.log(r.toFixed(2), pc(f, 3).padStart(9), pc(1 - 2 * orthantNumeric(r), 3).padStart(11), pc(fi, 3).padStart(11), pc(mc, 3).padStart(9), (Math.abs(mc - f) * 100).toFixed(3).padStart(8) + ' pp');
  });
  console.log('(orthant identity: P(X>0,Y>0) = 1/4 + asin(r)/(2π):', [0.64, 0.9].map(function (r) { return orthantNumeric(r).toFixed(5) + ' vs ' + (0.25 + Math.asin(r) / (2 * Math.PI)).toFixed(5); }).join(' ; '), ')');

  console.log('\n--- 2. table: r → P(flip per letter), P(all four unchanged) = (1-P)^4, P(>=1 letter changed) ---');
  [0.31, 0.50, 0.54, 0.60, 0.64, 0.70, 0.71, 0.74, 0.80, 0.86, 0.90, 0.95].forEach(function (r) {
    var P = flipFormula(r);
    console.log('r', r.toFixed(2), ' flip', pc(P), ' per-letter unchanged', pc(1 - P), ' all four unchanged', pc(allSame(r, 4)), ' >=1 changed', pc(1 - allSame(r, 4)));
  });

  console.log('\n--- 3. calibration against the second-hand "about 83% / 75% of letters unchanged" figures ---');
  [0.83, 0.75].forEach(function (u) { var r = Math.cos(Math.PI * (1 - u)); console.log('per-letter unchanged', pc(u, 0), '→ r =', r.toFixed(3), '→ all four unchanged', pc(Math.pow(u, 4)), '(model at that r:', pc(allSame(r, 4)), ')'); });
  console.log('r = .86:', 'flip', pc(flipFormula(0.86)), 'unchanged', pc(1 - flipFormula(0.86)), 'all four', pc(allSame(0.86, 4)));
  console.log('r = .71:', 'flip', pc(flipFormula(0.71)), 'unchanged', pc(1 - flipFormula(0.71)), 'all four', pc(allSame(0.71, 4)));

  console.log('\n--- 4. who flips: P(flip | x) = Phi(-r|x|/sqrt(1-r^2)) ---');
  [0.64, 0.80, 0.90].forEach(function (r) { console.log('r', r, [0, 0.25, 0.5, 1, 1.5, 2].map(function (x) { return 'x=' + x + ':' + pc(flipGiven(x, r)); }).join('  ')); });
  [0.54, 0.64, 0.74, 0.80, 0.90, 0.95].forEach(function (r) {
    var n25 = nearFormula(r, 0.25), n5 = nearFormula(r, 0.5);
    console.log('r', r.toFixed(2), '| within ±0.25 SD: share', pc(n25.share), 'flip rate', pc(n25.flip), '| within ±0.5 SD: share', pc(n5.share), 'flip rate', pc(n5.flip), '| flippers within ±0.5 SD:', pc(flippersWithin(r, 0.5), 0), 'within ±1 SD:', pc(flippersWithin(r, 1), 0));
  });

  console.log('\n--- 5. the widget simulation (N=4000 people × K=4 scales, seed 1) ---');
  var base = makeBase(1);
  [0.54, 0.64, 0.74, 0.86, 0.90, 0.95].forEach(function (r) {
    var o = simulate(base, r);
    console.log('r', r.toFixed(2), 'formula', pc(flipFormula(r)), 'sim', pc(o.flipSim), '| all-four-unchanged formula', pc(allSame(r, 4)), 'sim', pc(o.noneSim), '| near ±0.25: sim share', pc(o.nearShareSim), 'sim flip', pc(o.nearFlipSim));
  });
  var o64 = simulate(base, 0.64), tot = 0, totF = 0;
  console.log('bin share of all (r .64):', o64.bins.map(function (n, k) { tot += n; totF += o64.binFlip[k]; return (100 * n / (N * K)).toFixed(1); }).join(' '));
  console.log('bin flipped share      :', o64.binFlip.map(function (n) { return (100 * n / (N * K)).toFixed(1); }).join(' '));
  console.log('max bin share', Math.max.apply(null, o64.bins) / (N * K), ' expected centre-bin share', (pdf(0.125) * 0.25).toFixed(4));
  // seeds: how much do the simulated KPIs wobble?
  var d = [], sd2 = [];
  for (var sd = 1; sd <= 8; sd++) { var o = simulate(makeBase(sd), 0.64); d.push(pc(o.flipSim)); sd2.push(pc(o.noneSim)); }
  console.log('r .64, seeds 1..8: flip sim', d.join(' '), '| all-four-unchanged sim', sd2.join(' '));
}
if (typeof module !== 'undefined') module.exports = { flipFormula: flipFormula, flipGiven: flipGiven, allSame: allSame, makeBase: makeBase, simulate: simulate, nearFormula: nearFormula, flippersWithin: flippersWithin };
