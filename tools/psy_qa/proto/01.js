// proto/01.js — lesson 01 widget: a Stroop-style reaction-time test + a simulated participant.
// Model (DEMO values, not measurements; the widget labels them 示意): trial RT = mu_cond * exp(SIG*z - SIG^2/2), z ~ N(0,1)
//   (lognormal with mean mu_cond, so the SD grows with the mean — the same direction as the SDs in Stroop 1935: 10.8 s -> 18.8 s).
//   mu_cong = MU = 650 ms ; mu_incong = MU + delta ; SIG = 0.25 ; every simulated trial is "correct".
// Simulated participant k (1-based within a session): seed 5000 + k ; n congruent draws first, then n incongruent draws.
// Statistics: d = mean_inc - mean_con ; SE = sqrt(s_c^2/n + s_i^2/n) (Welch, unpaired trials) ; z = d / SE.
var MU = 650, SIG = 0.25;
var rng = function (seed) { var a = seed >>> 0; return function () { a = (a + 0x6D2B79F5) >>> 0; var t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };
var gauss = function (r) { var u = r() || 1e-12, v = r(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
var mean = function (a) { var s = 0, i; for (i = 0; i < a.length; i++) s += a[i]; return a.length ? s / a.length : 0; };
var sd = function (a) { var m = mean(a), s = 0, i; for (i = 0; i < a.length; i++) s += (a[i] - m) * (a[i] - m); return a.length > 1 ? Math.sqrt(s / (a.length - 1)) : 0; };
function stats(c, inc) {
  var mc = mean(c), mi = mean(inc), sc = sd(c), si = sd(inc), d = mi - mc, se = Math.sqrt(sc * sc / c.length + si * si / inc.length);
  return { mc: mc, mi: mi, d: d, se: se, z: se > 0 ? d / se : 0 };
}
function simOne(k, delta, n) {
  var r = rng(5000 + k), c = [], inc = [], i, adj = -SIG * SIG / 2;
  for (i = 0; i < n; i++) c.push(MU * Math.exp(SIG * gauss(r) + adj));
  for (i = 0; i < n; i++) inc.push((MU + delta) * Math.exp(SIG * gauss(r) + adj));
  return stats(c, inc);
}
// the reader's 24-trial order: 12 congruent (each colour 3x) + 12 incongruent (every word != ink once), Fisher-Yates with rng(2026); 4 fixed practice trials first
function buildSeq() {
  var rnd = rng(2026), a = [], i, j, t;
  for (i = 0; i < 4; i++) for (j = 0; j < 3; j++) a.push({ w: i, ink: i, c: 1 });
  for (i = 0; i < 4; i++) for (j = 0; j < 4; j++) if (j !== i) a.push({ w: j, ink: i, c: 0 });
  for (i = a.length - 1; i > 0; i--) { j = Math.floor(rnd() * (i + 1)); t = a[i]; a[i] = a[j]; a[j] = t; }
  return [{ w: 0, ink: 0, c: 1, p: 1 }, { w: 1, ink: 2, c: 0, p: 1 }, { w: 3, ink: 3, c: 1, p: 1 }, { w: 2, ink: 0, c: 0, p: 1 }].concat(a);
}
function batch(delta, n, N, k0) {
  var out = [], k;
  for (k = 1; k <= N; k++) out.push(simOne((k0 || 0) + k, delta, n));
  return out;
}
function summ(b) {
  var neg = 0, big = 0, ds = [], i;
  for (i = 0; i < b.length; i++) { if (b[i].d < 0) neg++; if (b[i].z >= 2) big++; ds.push(b[i].d); }
  return { neg: neg, big: big, N: b.length, mean: mean(ds), sd: sd(ds), min: Math.min.apply(null, ds), max: Math.max.apply(null, ds) };
}
// analytic SE of the difference for the lognormal model (equal n)
function seTheory(delta, n) { var f = Math.sqrt(Math.exp(SIG * SIG) - 1); return f * Math.sqrt((MU * MU + (MU + delta) * (MU + delta)) / n); }
if (require.main === module) {
  var f = function (x, k) { return x.toFixed(k === undefined ? 1 : k); };
  console.log('--- analytic SE(d) for the lognormal model, SIG', SIG, 'MU', MU);
  [[80, 6], [80, 12], [80, 24], [80, 48], [0, 12], [150, 12], [150, 48], [40, 12]].forEach(function (p) { console.log('delta', p[0], 'n', p[1], 'SE', f(seTheory(p[0], p[1])), 'expected z', f(p[0] / seTheory(p[0], p[1]), 2)); });
  console.log('--- sim: first 20 participants (a fresh page, press 模拟 20 位 once) and 400 participants');
  [[80, 12], [80, 48], [0, 12], [150, 12], [150, 48], [40, 12], [80, 6]].forEach(function (p) {
    var b20 = summ(batch(p[0], p[1], 20, 0)), b400 = summ(batch(p[0], p[1], 400, 0));
    console.log('delta', p[0], 'n', p[1], '| first20: neg', b20.neg, 'z>=2', b20.big, 'range', f(b20.min, 0), '..', f(b20.max, 0), ' mean', f(b20.mean, 0), 'sd', f(b20.sd, 0), '| 400: neg', b400.neg, '(' + f(b400.neg / 4, 1) + '%)', 'z>=2', b400.big, '(' + f(b400.big / 4, 1) + '%)', 'mean d', f(b400.mean, 1), 'sd d', f(b400.sd, 1));
  });
  console.log('--- default participant 1 (delta 80, n 12)');
  var p1 = simOne(1, 80, 12); console.log('mc', f(p1.mc), 'mi', f(p1.mi), 'd', f(p1.d), 'se', f(p1.se), 'z', f(p1.z, 2));
  var seq = buildSeq(); console.log('seq len', seq.length, 'first 8:', seq.slice(0, 8).map(function (t) { return t.w + '/' + t.ink; }).join(' '), ' congruent in 24:', seq.slice(4).filter(function (t) { return t.c; }).length);
  console.log('--- exclusion rule check: P(RT<150) and P(RT>3000) under lognormal for mu 650/730');
  [650, 730].forEach(function (m) {
    var s = 0, hi = 0, lo = 0, N = 200000, r = rng(1), i, x;
    for (i = 0; i < N; i++) { x = m * Math.exp(SIG * gauss(r) - SIG * SIG / 2); if (x < 150) lo++; if (x > 3000) hi++; }
    console.log('mu', m, 'P(<150)', lo / N, 'P(>3000)', hi / N);
  });
}
if (typeof module !== 'undefined') module.exports = { simOne: simOne, stats: stats, buildSeq: buildSeq, batch: batch, summ: summ, seTheory: seTheory, rng: rng, gauss: gauss };
