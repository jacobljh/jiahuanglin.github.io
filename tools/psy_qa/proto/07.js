// proto/07.js — lesson 07 回归均值: a seeded population that "cures" nothing.
// (Lead's first version used N = 2,000 and an alternating split; the writer enlarged N and made the split random — see "Changes" below.)
// Model (a toy, bivariate-normal; the identity E[z2 | z1] = r·z1 is the textbook result, cf. FACTS_T6a §00-C):
//   every person has a stable part mu ~ N(0,1) and two independent luck parts a, b ~ N(0,1);
//   z1 = sqrt(r)·mu + sqrt(1−r)·a,  z2 = sqrt(r)·mu + sqrt(1−r)·b   (both standard normal, corr(z1, z2) = r = test–retest correlation / reliability);
//   select the extreme q-fraction on z1 (low = "worst", high = "best");
//   a true treatment effect δ (in z units) is ADDED to z2 of the treated people only (everyone selected, or a random half when a control group is on).
// Closed forms (DERIVED): selected-group mean on z1 = ∓ c(q), c(q) = φ(z_q)/q (truncated-normal mean; q = .10 → 1.755);
//   expected change of the selected group = (1−r)·c(q) toward the mean (+ δ for treated).
// Everything printed is a MODEL OUTPUT, not data. r, q, δ are demo values (示意); N = 20,000 simulated people, SEED 707.
// Changes vs the lead's draft: N 2,000 → 20,000 (the controlled estimate had ±0.12 noise at N = 2,000, ±0.04 now); control arm = a seeded coin flip
// (4th draw u per person) instead of alternating ranks; treated-arm mean of z1 is used when a control group is on (the draft mixed arms);
// the "coach" pair (best / worst q with NO true effect) is computed from the same people.
var PSY = require('./_psy.js');
var N = 20000, SEED = 707;
function phi(x) { return Math.exp(-x * x / 2) / Math.sqrt(2 * Math.PI); }
function cOf(q) { var z = PSY.probit(q); return phi(z) / q; }
var MU = new Float64Array(N), A = new Float64Array(N), B = new Float64Array(N), U = new Float64Array(N);
(function () { var rng = PSY.rng(SEED), i; for (i = 0; i < N; i++) { MU[i] = PSY.gauss(rng); A[i] = PSY.gauss(rng); B[i] = PSY.gauss(rng); U[i] = rng(); } })();
function run(o) {
  var r = o.r, q = o.q, d = o.delta || 0, side = o.side || 'low', ctrl = !!o.controlled, sr = Math.sqrt(r), s1 = Math.sqrt(1 - r), i;
  var z1 = new Float64Array(N), z2 = new Float64Array(N);
  for (i = 0; i < N; i++) { z1[i] = sr * MU[i] + s1 * A[i]; z2[i] = sr * MU[i] + s1 * B[i]; }
  var srt = Float64Array.from(z1).sort(), k = Math.round(q * N);
  var lowThr = srt[k - 1], highThr = srt[N - k];
  var pick = side === 'low' ? function (x) { return x <= lowThr; } : function (x) { return x >= highThr; };
  var n1 = 0, s1a = 0, s2a = 0, nc = 0, c1 = 0, c2 = 0, nt = 0, ng = 0;
  var pn = 0, pd = 0, sn = 0, sd = 0;
  for (i = 0; i < N; i++) {
    if (z1[i] >= highThr) { pn++; pd += z2[i] - z1[i]; }
    if (z1[i] <= lowThr) { sn++; sd += z2[i] - z1[i]; }
    if (!pick(z1[i])) continue;
    ng++;
    if (ctrl && U[i] >= 0.5) { nc++; c1 += z1[i]; c2 += z2[i]; }
    else { nt++; s1a += z1[i]; s2a += z2[i] + d; }
  }
  var m1 = s1a / nt, m2 = s2a / nt, c = cOf(q);
  var out = { r: r, q: q, delta: d, side: side, ng: ng, nt: nt, nc: nc, m1: m1, m2: m2, change: m2 - m1, c: c, expChange: (1 - r) * c * (side === 'low' ? 1 : -1),
              praise: pd / pn, scold: sd / sn, ctrlChange: NaN, effect: NaN };
  if (ctrl) { out.ctrlChange = c2 / nc - c1 / nc; out.effect = out.change - out.ctrlChange; }
  return out;
}
function f(x, k) { return (x >= 0 ? '+' : '') + x.toFixed(k === undefined ? 3 : k); }
if (require.main === module) {
  console.log('c(q): q=.05', cOf(0.05).toFixed(3), ' .10', cOf(0.10).toFixed(3), ' .25', cOf(0.25).toFixed(3), ' .50', cOf(0.5).toFixed(3));
  [0.2, 0.5, 0.675, 0.8, 0.92, 1.0].forEach(function (r) {
    var a = run({ r: r, q: 0.1, delta: 0, side: 'low' }), b = run({ r: r, q: 0.1, delta: 0, side: 'high' });
    console.log('r', r.toFixed(3), '| worst 10%: z1', f(a.m1), '-> z2', f(a.m2), 'change', f(a.change), '(theory', f(a.expChange), ') | best 10%: z1', f(b.m1), '-> z2', f(b.m2), 'change', f(b.change), '(theory', f(b.expChange), ')');
  });
  console.log('--- default state: r .5, q .10, δ 0, worst group, no control group');
  var u = run({ r: 0.5, q: 0.1, delta: 0, side: 'low' }), cc = run({ r: 0.5, q: 0.1, delta: 0, side: 'low', controlled: true });
  console.log('no control: z1', f(u.m1), 'z2', f(u.m2), 'change', f(u.change), '| expected (1−r)c(q)', f(u.expChange), '| coach: praise best', f(u.praise), 'scold worst', f(u.scold));
  console.log('with control: treated n', cc.nt, 'control n', cc.nc, '| treated change', f(cc.change), 'control change', f(cc.ctrlChange), 'effect estimate', f(cc.effect));
  console.log('--- true effect δ = +0.30, r .5, q .10: no control change', f(run({ r: 0.5, q: 0.1, delta: 0.3 }).change), ' | controlled estimate', f(run({ r: 0.5, q: 0.1, delta: 0.3, controlled: true }).effect));
  console.log('--- true effect δ = −0.30 (harmful), r .5: no control change', f(run({ r: 0.5, q: 0.1, delta: -0.3 }).change), ' | controlled estimate', f(run({ r: 0.5, q: 0.1, delta: -0.3, controlled: true }).effect));
  console.log('--- presets: pulse r .675 (best 10%), batting r .2 (best 10%), exam r .92 (best 10%)');
  [[0.675, 'high'], [0.2, 'high'], [0.92, 'high'], [0.675, 'low'], [0.2, 'low'], [0.92, 'low']].forEach(function (p) { var o = run({ r: p[0], q: 0.1, delta: 0, side: p[1] }); console.log('  r', p[0], p[1], 'z1', f(o.m1), 'z2', f(o.m2), 'change', f(o.change), 'expected', f(o.expChange), 'coach', f(o.praise), f(o.scold)); });
  console.log('--- q sweep at r .5 (worst): ', [0.05, 0.1, 0.25, 0.5].map(function (q) { var o = run({ r: 0.5, q: q, delta: 0, side: 'low' }); return 'q' + q + ' z1 ' + f(o.m1) + ' change ' + f(o.change) + ' (theory ' + f(o.expChange) + ')'; }).join(' ; '));
  console.log('--- share of the gap that closes at δ=0: r .6 → theory 0.40, sim', (1 - run({ r: 0.6, q: 0.1, delta: 0 }).m2 / run({ r: 0.6, q: 0.1, delta: 0 }).m1).toFixed(3));
  console.log('--- worst-week (r .6, q .10): expected', f(run({ r: 0.6, q: 0.1, delta: 0 }).expChange), ' sim', f(run({ r: 0.6, q: 0.1, delta: 0 }).change));
}
if (typeof module !== 'undefined') module.exports = { run: run, cOf: cOf, N: N };
