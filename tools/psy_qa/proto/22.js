// proto/14.js — lesson 14 widget maths: who you sample decides what you conclude (a labelled DEMO model, not data).
// run: node tools/psy_qa/proto/14.js
// World: S = 120 societies. Society s has an "industrialisation / market-integration" index m_s ~ U(0,1) and a trait mean
//   mu_s = BASE + gap*sigma*(m_s - 0.5) + tau*eps_s     (BASE .40, tau .04, eps_s ~ N(0,1); gap = how many individual SDs the trait moves between m=0 and m=1; gap=0 → no variation with m).
//   The estimand T = mean over all 120 societies (each society counts once).  Individuals within a society: N(mu_s, sigma^2), sigma .12.
// A study picks k societies WITHOUT replacement with probability ∝ exp(kappa*m_s)  (kappa 0 = random, kappa 20 ≈ only the most industrialised slice),
//   measures n people in each, estimate = mean of the k society sample means.  Interval 'by number of people' = ±1.96*sigma/sqrt(k*n)
//   (sigma known; counts only person-to-person spread, ignores society-to-society spread).
// Repeat the study R = 300 times (seeds 1..R) to get bias, spread, coverage.  Deterministic (PSY.rng = mulberry32, PSY.gauss).
function mulberry32(seed) { var a = seed >>> 0; return function () { a = (a + 0x6D2B79F5) >>> 0; var t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function gauss(r) { var u = r() || 1e-12, v = r(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }
var S = 120, BASE = 0.40, TAU = 0.04, SIGMA = 0.12, R = 300;
var rw = mulberry32(2026), M = [], EPS = [], i;
for (i = 0; i < S; i++) { M.push(rw()); EPS.push(gauss(rw)); }
function means(gap) { var out = [], s, beta = gap * SIGMA; for (s = 0; s < S; s++) out.push(BASE + beta * (M[s] - 0.5) + TAU * EPS[s]); return out; }
function pick(rng, k, kappa) {
  var avail = [], w = [], j, s, out = [];
  for (s = 0; s < S; s++) { avail.push(s); w.push(Math.exp(kappa * (M[s] - 1))); }
  for (j = 0; j < k; j++) {
    var tot = 0, t; for (t = 0; t < avail.length; t++) tot += w[avail[t]];
    var u = rng() * tot, acc = 0, ix = avail.length - 1;
    for (t = 0; t < avail.length; t++) { acc += w[avail[t]]; if (u <= acc) { ix = t; break; } }
    out.push(avail[ix]); avail.splice(ix, 1);
  }
  return out;
}
function study(o, rep) {          // o: k, n, kappa, gap
  var mu = means(o.gap), rng = mulberry32(1000 + rep), ids = pick(rng, o.k, o.kappa), xs = [], t, sum = 0, mbar = 0;
  for (t = 0; t < ids.length; t++) { xs.push(mu[ids[t]] + SIGMA / Math.sqrt(o.n) * gauss(rng)); sum += xs[t]; mbar += M[ids[t]]; }
  var est = sum / o.k;
  var se = SIGMA / Math.sqrt(o.k * o.n);      // interval "by number of people": only person-to-person spread, as if all k*n people were one random sample of one population
  return { ids: ids, est: est, se: se, mbar: mbar / o.k, xs: xs };
}
function run(o) {
  var mu = means(o.gap), T = 0, s; for (s = 0; s < S; s++) T += mu[s]; T /= S;
  var ests = [], cov = 0, r, st, sum = 0, mb = 0;
  for (r = 1; r <= R; r++) { st = study(o, r); ests.push(st.est); sum += st.est; mb += st.mbar; if (Math.abs(st.est - T) <= 1.96 * st.se) cov++; }
  var mean = sum / R, v = 0; for (r = 0; r < R; r++) v += (ests[r] - mean) * (ests[r] - mean); v /= (R - 1);
  var bias = mean - T, partVar = SIGMA * SIGMA / (o.k * o.n), betw = Math.max(0, v - partVar);
  // true between-society SD (all societies) and mean SD seen in a study
  var sdAll = 0; for (s = 0; s < S; s++) sdAll += (mu[s] - T) * (mu[s] - T); sdAll = Math.sqrt(sdAll / (S - 1));
  return { T: T, mean: mean, bias: bias, sd: Math.sqrt(v), partSD: Math.sqrt(partVar), betwSD: Math.sqrt(betw), rmse: Math.sqrt(bias * bias + v), cover: cov / R, mbar: mb / R, sdAll: sdAll, ests: ests };
}
function f(x, d) { return x.toFixed(d === undefined ? 3 : d); }
if (require.main === module) {
  var cases = [
    ['default: k1 n100 kappa20 gap1.0', { k: 1, n: 100, kappa: 20, gap: 1.0 }],
    ['n 5000', { k: 1, n: 5000, kappa: 20, gap: 1.0 }],
    ['k8 kappa10 n100', { k: 8, n: 100, kappa: 10, gap: 1.0 }],
    ['k20 kappa20 n100', { k: 20, n: 100, kappa: 20, gap: 1.0 }],
    ['k30 kappa20 n5000', { k: 30, n: 5000, kappa: 20, gap: 1.0 }],
    ['k8 kappa0 n100', { k: 8, n: 100, kappa: 0, gap: 1.0 }],
    ['k20 kappa0 n100', { k: 20, n: 100, kappa: 0, gap: 1.0 }],
    ['k20 kappa0 n1000', { k: 20, n: 1000, kappa: 0, gap: 1.0 }],
    ['k1 kappa0 n100 (one random society)', { k: 1, n: 100, kappa: 0, gap: 1.0 }],
    ['gap 0 k1 kappa20', { k: 1, n: 100, kappa: 20, gap: 0 }],
    ['gap 0 k20 kappa0', { k: 20, n: 100, kappa: 0, gap: 0 }],
    ['gap .3 k1 kappa20', { k: 1, n: 100, kappa: 20, gap: 0.3 }],
    ['gap .3 k1 kappa20 n5000', { k: 1, n: 5000, kappa: 20, gap: 0.3 }],
    ['gap 2 k1 kappa20', { k: 1, n: 100, kappa: 20, gap: 2 }],
    ['k4 kappa20 n100', { k: 4, n: 100, kappa: 20, gap: 1.0 }],
    ['k12 kappa5 n100', { k: 12, n: 100, kappa: 5, gap: 1.0 }]
  ];
  console.log('T(gap 1) and true between-society SD:', f(run(cases[0][1]).T), f(run(cases[0][1]).sdAll));
  cases.forEach(function (c) { var r = run(c[1]); console.log(c[0].padEnd(46), 'T', f(r.T), 'E[est]', f(r.mean), 'bias', f(r.bias), '(' + f(r.bias / SIGMA, 2) + ' sd)', '| SD part', f(r.partSD), 'betw', f(r.betwSD), 'RMSE', f(r.rmse), '| cover', f(100 * r.cover, 0) + '%', ' mbar', f(r.mbar, 2)); });
  console.log('--- single study #1 for default:', JSON.stringify((function () { var s = study(cases[0][1], 1); return { ids: s.ids, est: f(s.est), se: f(s.se), mbar: f(s.mbar, 2) }; })()));
  var mm = 0; for (i = 0; i < S; i++) mm += M[i]; console.log('mean m over societies', f(mm / S), 'top-10% cut m>=', f(M.slice().sort(function (a, b) { return b - a; })[11], 2));
}
if (typeof module !== 'undefined') module.exports = { run: run, study: study, M: M, EPS: EPS, S: S };
