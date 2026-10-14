// proto/10.js — lesson 10 widget maths: 「同一个刺激，不同的预期」(a labelled DEMO model, not data).
// run: node tools/psy_qa/proto/10.js
// Pain-rating toy: reported pain R = posterior mean of "how threatening is this input", precision-weighted (the lesson-03 cue-combination rule):
//   R = (π_p·μ + π_s·x) / (π_p + π_s) = w·μ + (1 − w)·x,   w = π_p / (π_p + π_s)
//   x = input reading = clamp(s_t + σ_s·z_t, 0, 100), σ_s = K / √π_s  (so low input precision = noisy input AND a bigger weight on the expectation)
//   μ = the expectation, set by the cue at trial 1 (μ0) and updated by a delta rule on the prediction error δ = R − μ:  μ ← μ + α·δ
//   (the update learns from what was FELT, R, not from the raw input — the positive-feedback loop of Jepma et al. 2018 — so a confident expectation (large w) learns slowly: δ = (1 − w)(x − μ))
//   40 trials; with 'reverse' on, from trial 21 the stimulus after the same cue is 100 − s (contingency reversed, as in Atlas et al. 2022).
//   pull_t = w·(μ_t − s_t): how far the expectation moves the rating away from the true stimulus, noise-free.
// Constants: N = 40 trials, REV = 21, K = 8 are TUNED (示意). π and μ0 values are 示意: no published values exist (FACTS_T7b widget constants).
var P = require('./_psy.js');
var N = 40, REV = 21, K = 8;
var Z = (function () { var r = P.rng(2010), z = [0], i; for (i = 1; i <= N; i++) z.push(P.gauss(r)); return z; })();
function clamp(v) { return Math.max(0, Math.min(100, v)); }
function sim(o) {   // o: s, mu0, ps, pp, a, rev
  var w = o.pp / (o.pp + o.ps), sig = K / Math.sqrt(o.ps), mu = o.mu0, t, tr = [];
  for (t = 1; t <= N; t++) {
    var st = (o.rev && t >= REV) ? 100 - o.s : o.s;
    var x = clamp(st + sig * Z[t]);
    var R = w * mu + (1 - w) * x, d = R - mu;
    tr.push({ t: t, s: st, x: x, mu: mu, R: R, d: d, pull: w * (mu - st) });
    mu = mu + o.a * d;
  }
  function win(lo, hi, key) { var s = 0, n = 0, i; for (i = lo - 1; i < hi; i++) { s += tr[i][key]; n++; } return s / n; }
  var mx = 0, mxT = 0, i;
  for (i = 0; i < N; i++) if (Math.abs(tr[i].pull) > Math.abs(mx) + 1e-9) { mx = tr[i].pull; mxT = i + 1; }
  return { w: w, sig: sig, tr: tr, muEnd: mu, sL: win(31, 40, 's'), RL: win(31, 40, 'R'), pullL: win(31, 40, 'pull'), dL: win(31, 40, 'd'), pull1: tr[0].pull, R1: tr[0].R, R5: win(1, 5, 'R'), pull5: win(1, 5, 'pull'), mx: mx, mxT: mxT };
}
function f(x, d) { return x.toFixed(d === undefined ? 1 : d); }
function sg(x) { return (x >= 0 ? '+' : '−') + Math.abs(x).toFixed(1); }
var DEF = { s: 50, mu0: 80, ps: 4, pp: 2, a: 0.3, rev: false };
function mk(over) { var o = {}, k; for (k in DEF) o[k] = DEF[k]; for (k in over) o[k] = over[k]; return o; }
function line(name, o) {
  var r = sim(o);
  console.log(name.padEnd(36), '| w', f(r.w, 3), '| trial1 R', f(r.R1), 'pull1', sg(r.pull1), '| first5 R', f(r.R5), 'pull', sg(r.pull5), '| last10: s', f(r.sL), 'R', f(r.RL), 'pull', sg(r.pullL), 'δ', sg(r.dL), '| μ_end', f(r.muEnd), '| max pull', sg(r.mx), '@', r.mxT);
  return r;
}
if (require.main === module) {
  line('default (high cue 80, s50)', DEF);
  line('neutral cue 50', mk({ mu0: 50 }));
  line('low cue 20', mk({ mu0: 20 }));
  line('high cue 80, same s, ps 16 (clear input)', mk({ ps: 16 }));
  line('high cue 80, ps 8', mk({ ps: 8 }));
  line('high cue 80, ps 2', mk({ ps: 2 }));
  line('noisy input ps 1 (preset)', mk({ ps: 1 }));
  line('pp 0 (ignore expectation)', mk({ pp: 0 }));
  line('pp 16 ps 2 (stubborn)', mk({ pp: 16, ps: 2 }));
  line('pp 16 ps 4', mk({ pp: 16 }));
  line('alpha 0 (no learning)', mk({ a: 0 }));
  line('alpha 1', mk({ a: 1 }));
  line('reversal: s25 mu0 25 rev', mk({ s: 25, mu0: 25, rev: true }));
  line('reversal: s25 mu0 25 rev ps1', mk({ s: 25, mu0: 25, rev: true, ps: 1 }));
  line('reversal: s25 mu0 25 rev pp 0', mk({ s: 25, mu0: 25, rev: true, pp: 0 }));
  line('reversal: s25 mu0 25 rev pp 16 ps2', mk({ s: 25, mu0: 25, rev: true, pp: 16, ps: 2 }));
  line('s 90 mu0 80', mk({ s: 90 }));
  line('s 10 mu0 80', mk({ s: 10 }));
  line('s 100 mu0 80', mk({ s: 100 }));
  line('s 0 mu0 0', mk({ s: 0, mu0: 0 }));
  var r = sim(mk({ s: 25, mu0: 25, rev: true }));
  console.log('reversal trace R:', r.tr.map(function (q) { return Math.round(q.R); }).join(' '));
  console.log('reversal trace mu:', r.tr.map(function (q) { return Math.round(q.mu); }).join(' '));
  console.log('reversal trace pull:', r.tr.map(function (q) { return f(q.pull, 0); }).join(' '));
  r = sim(DEF);
  console.log('default trace R:', r.tr.map(function (q) { return Math.round(q.R); }).join(' '));
  console.log('default trace mu:', r.tr.map(function (q) { return Math.round(q.mu); }).join(' '));
  // the "pull grows as input precision falls" sweep (trial-1 pull, s50 mu0 80, pp 2)
  console.log('sweep ps -> w, pull1:', [1, 2, 4, 8, 16].map(function (ps) { var q = sim(mk({ ps: ps })); return 'ps' + ps + ' w' + f(q.w, 2) + ' pull1 ' + sg(q.pull1); }).join(' ; '));
  console.log('sweep pp -> w, pull1 (ps4):', [0, 1, 2, 4, 8, 16].map(function (pp) { var q = sim(mk({ pp: pp })); return 'pp' + pp + ' w' + f(q.w, 2) + ' pull1 ' + sg(q.pull1) + ' muEnd ' + f(q.muEnd); }).join(' ; '));
}
if (typeof module !== 'undefined') module.exports = { sim: sim, Z: Z };
