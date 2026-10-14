// proto/10.js — lesson 10 widget maths: "wanting" and "liking" kept in separate books (a labelled DEMO model, not data).
// run: node tools/psy_qa/proto/10.js
// Day-level model. One reward is taken once a day in the presence of a cue, for U days; then A days of abstinence; then a cue test.
//   V   association cue→reward, Rescorla–Wagner (lesson 09):  V += ALPHA*(1 - V) on use days, unchanged in abstinence (the cue is not met).
//   s   incentive sensitisation (Robinson & Berridge 1993): s += SIG*(1 - s) on use days (needs the cue-paired use), decays DEC_S per abstinence day
//       ("persists for months and years" in rats; the rate is a labelled guess, not a measurement).
//   x   tolerance, only used when 'liking' is set to 'declining': x += RHO*(1 - x) on use days; decays DEC_X per abstinence day
//       ("tolerance can mask sensitisation for several days to several weeks after the drug stops").
//   wanting(cue) = 100 * V * G * (1 + K*s)         G = state gain at the moment of the cue (1 during use; settable at the test: "instant wanting")
//   liking(if taken) = 100 * (1 - LT*x)            LT = 0 ('flat' = IST drawing) or 0.45 ('declining' = tolerance / blunted-reward drawing)
// Units: both on one "示意" scale, liking of the first use = 100. Nothing here is a measured series.
var ALPHA = 0.12, SIG = 0.05, DEC_S = 0.004, RHO = 0.08, DEC_X = 0.05, LT_DECL = 0.45;
function sim(o) {   // o: U, A, K, G, decl (bool)
  var V = 0, s = 0, x = 0, d, n = o.U + o.A, LT = o.decl ? LT_DECL : 0;
  var w = [], l = [], Vs = [], ss = [], xs = [];
  w.push(0); l.push(100); Vs.push(0); ss.push(0); xs.push(0);          // day 0: before any use, the cue means nothing
  for (d = 1; d <= n; d++) {
    // the cue at the start of day d reads the state left by day d-1
    w.push(100 * V * (1 + o.K * s));
    l.push(100 * (1 - LT * x));
    if (d <= o.U) { V += ALPHA * (1 - V); s += SIG * (1 - s); x += RHO * (1 - x); }
    else { s *= (1 - DEC_S); x *= (1 - DEC_X); }
    Vs.push(V); ss.push(s); xs.push(x);
  }
  // end of use (the state after day U) and the cue test after A days of abstinence (state after day U+A, state gain G)
  var sEnd = ss[o.U], VEnd = Vs[o.U], xEnd = xs[o.U];
  var wEnd = 100 * VEnd * (1 + o.K * sEnd), lEnd = 100 * (1 - LT * xEnd);
  var sT = ss[n], VT = Vs[n], xT = xs[n];
  var wT = 100 * VT * o.G * (1 + o.K * sT), lT = 100 * (1 - LT * xT);
  return { w: w, l: l, V: Vs, s: ss, x: xs, wEnd: wEnd, lEnd: lEnd, gapEnd: wEnd - lEnd, wT: wT, lT: lT, gapT: wT - lT, sEnd: sEnd, sT: sT, VT: VT, n: n };
}
function f(x, d) { return x.toFixed(d === undefined ? 1 : d); }
if (require.main === module) {
  var cases = [
    ['default U30 A60 K1.0 G1.0 flat', { U: 30, A: 60, K: 1.0, G: 1.0, decl: false }],
    ['K0 (sensitisation off) flat', { U: 30, A: 60, K: 0, G: 1.0, decl: false }],
    ['K0 declining', { U: 30, A: 60, K: 0, G: 1.0, decl: true }],
    ['K1 declining', { U: 30, A: 60, K: 1.0, G: 1.0, decl: true }],
    ['A180 K1 flat', { U: 30, A: 180, K: 1.0, G: 1.0, decl: false }],
    ['A180 K1 declining', { U: 30, A: 180, K: 1.0, G: 1.0, decl: true }],
    ['A60 K1 flat G1.6 (test in a depleted state)', { U: 30, A: 60, K: 1.0, G: 1.6, decl: false }],
    ['A60 K1 flat G0.6 (sated)', { U: 30, A: 60, K: 1.0, G: 0.6, decl: false }],
    ['U10 A60 K1 flat', { U: 10, A: 60, K: 1.0, G: 1.0, decl: false }],
    ['U5 A60 K1 flat', { U: 5, A: 60, K: 1.0, G: 1.0, decl: false }],
    ['U60 A60 K1 flat', { U: 60, A: 60, K: 1.0, G: 1.0, decl: false }],
    ['U30 A0 K1 declining', { U: 30, A: 0, K: 1.0, G: 1.0, decl: true }],
    ['U30 A14 K1 declining', { U: 30, A: 14, K: 1.0, G: 1.0, decl: true }],
    ['U30 A30 K1 declining', { U: 30, A: 30, K: 1.0, G: 1.0, decl: true }]
  ];
  cases.forEach(function (c) { var r = sim(c[1]); console.log(c[0].padEnd(46), '| end: want', f(r.wEnd), 'like', f(r.lEnd), 'gap', f(r.gapEnd), '| test: want', f(r.wT), 'like', f(r.lT), 'gap', f(r.gapT), '| s_end', f(r.sEnd, 3), 's_test', f(r.sT, 3), 'V', f(r.VT, 3)); });
  var r = sim(cases[0][1]); console.log('trace default (every 5 days): ', r.w.filter(function (_, i) { return i % 5 === 0; }).map(function (v) { return f(v, 0); }).join(' '));
}
if (typeof module !== 'undefined') module.exports = { sim: sim };
