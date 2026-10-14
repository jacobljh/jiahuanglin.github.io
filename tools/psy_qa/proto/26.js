// proto/18.js — lesson 18 widget maths: "avoidance blocks extinction" (a labelled DEMO toy, NOT fitted to any data).
// run: node tools/psy_qa/proto/18.js       (the page's widget is a port of run() below; every number the prose quotes is printed here)
//
// What is taken from the sources (FACTS_T3a §09 "Widget constants (09)" and FACTS_T5 18-I):
//   • Rescorla–Wagner (Rescorla 2008): for every cue present on a trial ΔV_i = α_i β (λ − ΣV), ΣV = sum of V over the cues present,
//     λ = 1 if the outcome occurs, 0 if it does not. A nonreinforced compound has asymptote 0, so the error is negative and
//     pushes a cue that was NOT itself reinforced below zero (conditioned inhibition) — Rescorla's own account.
//   • NO source gives α, β, a "typical number of exposure trials" or a share of avoided trials (Milad 2007, Quirk & Mueller 2008: no trial counts).
//     So: the total per-trial step s = αβ = 0.2 (the demo value of lesson 09), every trial count and every avoidance share is a DEMO value.
//   • Extinction is new, context-dependent inhibitory learning and fear returns (renewal, reinstatement; FACTS_T3a §09D, grade A);
//     reinstatement is largely context conditioning (Bouton & Bolles 1979).
//
// The toy (the lesson's own, "inspired by" Rescorla–Wagner + Bouton; not any author's equation):
//   cues: the FEARED CUE C (V_C = 1 at the start: fear 100%, 示意) and the PLACE where one practises (V_R, one per place, start 0).
//   One planned exposure trial, if it really happens, shows C in place j WITHOUT the feared outcome (λ = 0):
//        e = 0 − (V_C + V_Rj);   V_C += a_c·e;   V_Rj += a_r·e;      a_c + a_r = s,   a_r / a_c = R   (R = 1: "cue and place equally salient", 示意)
//   If the person AVOIDS, that trial does not happen: nothing is shown, nothing is updated (no error, no learning).
//   Avoided trials are spread evenly (integer rule, no randomness): trial i happens iff ceil(i·Q/100) > ceil((i−1)·Q/100), Q = 100 − P (P = % avoided).
//   Practice rotates over m places: the t-th trial that really happens uses place (t−1) mod m.
//   Expressed fear:  in a PRACTISED place j:  F = max(0, V_C + V_Rj)  (reported: mean over the places used so far)
//                    in a NEW place:          F = V_C                  (the place cue is 0 there)   ← "renewal"
//   What-if "unsignalled bad event" in practised place j (the feared outcome arrives with NO cue; only the place is present):
//        V_Rj += a_r·(1 − V_Rj)       ← "reinstatement" (context conditioning)
// Closed forms checked below (m = 1):  ΣV_k = (1−s)^k ;  V_C = (R + ΣV_k)/(1+R) → floor R/(1+R) ;  with m places the floor is R/(R+m).
'use strict';
var R = 1;

function happens(i, Pc) { var Q = 100 - Pc; return Math.floor((i * Q + 99) / 100) > Math.floor(((i - 1) * Q + 99) / 100); }

function run(N, Pc, m, s) {
  var ac = s / (1 + R), ar = s * R / (1 + R), vc = 1, vr = [], j, i, k = 0, used = 0, t = [], err, sum, h, n;
  for (j = 0; j < m; j++) vr.push(0);
  function here() { sum = 0; n = Math.max(1, used); for (j = 0; j < n; j++) sum += Math.max(0, vc + (used ? vr[j] : 0)); return sum / n; }
  t.push({ i: 0, go: null, e: 0, here: 1, out: 1 });
  for (i = 1; i <= N; i++) {
    err = null;
    if (happens(i, Pc)) { j = k % m; err = -(vc + vr[j]); vc += ac * err; vr[j] += ar * err; k++; used = Math.min(k, m); }
    t.push({ i: i, go: err !== null, e: err === null ? 0 : -err, here: here(), out: vc });
  }
  // what-if: an unsignalled bad event in one practised place (each practised place in turn; report the mean)
  var evt = 0, nn = Math.max(1, used);
  for (j = 0; j < nn; j++) { var base = vc + (used ? vr[j] : 0), after = base + (used ? ar * (1 - vr[j]) : 0); evt += Math.max(0, used ? after : base); }
  evt /= nn;
  return { t: t, k: k, here: t[N].here, out: vc, evt: evt, ac: ac, ar: ar, vc: vc, vr: vr, used: used };
}
function k50(s) { var n = 0; while (Math.pow(1 - s, n) >= 0.5 - 1e-12) n++; return n; }
function pc(x) { return (100 * x).toFixed(1) + '%'; }
function f3(x) { return x.toFixed(3); }

if (require.main === module) {
  var i, k;
  console.log('--- (FACTS 18-I derived) remaining fraction after k real trials at s = 0.2: 0.8^k');
  [1, 2, 5, 10].forEach(function (n) { console.log('k', n, f3(Math.pow(0.8, n))); });
  console.log('trials to fall BELOW 50%:', k50(0.2), '(continuous ln0.5/ln0.8 =', (Math.log(0.5) / Math.log(0.8)).toFixed(2) + ')', ' below 10%:', (function () { var n = 0; while (Math.pow(0.8, n) >= 0.1) n++; return n; })(), ' below 5%:', (function () { var n = 0; while (Math.pow(0.8, n) >= 0.05) n++; return n; })(), ' below 1%:', (function () { var n = 0; while (Math.pow(0.8, n) >= 0.01) n++; return n; })());
  console.log('k50 for s = 0.05 / 0.1 / 0.2 / 0.3 / 0.5:', [0.05, 0.1, 0.2, 0.3, 0.5].map(k50).join(' / '));

  console.log('\n--- check closed forms vs the loop (m = 1)');
  [0.1, 0.2, 0.35].forEach(function (s) {
    var worst = 0, N = 40, r = run(N, 0, 1, s), kk;
    for (kk = 0; kk <= N; kk++) {
      var sv = Math.pow(1 - s, kk), vcF = (R + sv) / (1 + R), hereLoop = r.t[kk].here, outLoop = r.t[kk].out;
      worst = Math.max(worst, Math.abs(hereLoop - sv), Math.abs(outLoop - vcF));
    }
    console.log('s', s, 'max |loop − closed form| over 40 trials =', worst.toExponential(2), ' floor R/(1+R) =', R / (1 + R));
  });
  console.log('floor with m places (R = 1): m = 1..4 →', [1, 2, 3, 4].map(function (m) { return (R / (R + m)).toFixed(3); }).join(' '));
  // m places: long run converges to the floor?
  [1, 2, 3, 4].forEach(function (m) { var r = run(400, 0, m, 0.2); console.log('m', m, 'after 400 real trials: out', f3(r.out), 'here', f3(r.here)); });

  console.log('\n--- WIDGET DEFAULT and presets (N, P%, m, s)');
  var presets = {
    'default N10 P50 m1 s.2': [10, 50, 1, 0.2],
    'p2 none avoided N10 P0': [10, 0, 1, 0.2],
    'p3 N10 P90': [10, 90, 1, 0.2],
    'p4 N10 P100': [10, 100, 1, 0.2],
    'p5 N10 P0 m3': [10, 0, 3, 0.2],
    'slow s.05 N10 P0': [10, 0, 1, 0.05],
    'N30 P50': [30, 50, 1, 0.2],
    'N30 P0': [30, 0, 1, 0.2],
    'N5 P0': [5, 0, 1, 0.2],
    'N1 P0': [1, 0, 1, 0.2],
    'N10 P0 m2': [10, 0, 2, 0.2],
    'N10 P0 m4': [10, 0, 4, 0.2],
    'N10 P50 m3': [10, 50, 3, 0.2],
    'N20 P0 m3': [20, 0, 3, 0.2]
  };
  Object.keys(presets).forEach(function (name) {
    var a = presets[name], r = run(a[0], a[1], a[2], a[3]), ref = run(a[0], 0, a[2], a[3]);
    console.log(name.padEnd(26), 'k', r.k + '/' + a[0], ' here', pc(r.here), '(no-avoid ref ' + pc(ref.here) + ')', ' out', pc(r.out), '(ref ' + pc(ref.out) + ')', ' evt', pc(r.evt), ' k50', k50(a[3]));
  });

  console.log('\n--- default trajectory (N10 P50): which trials happen, error size, fear here/out');
  var d = run(10, 50, 1, 0.2);
  d.t.forEach(function (x) { console.log(' trial', x.i, x.go === null ? '(start)' : (x.go ? 'HAPPENS ' : 'avoided '), 'err', f3(x.e), 'here', f3(x.here), 'out', f3(x.out)); });
  console.log('\n--- no-avoidance trajectory (N10 P0): error sizes');
  run(10, 0, 1, 0.2).t.forEach(function (x) { console.log(' trial', x.i, 'err', f3(x.e), 'here', f3(x.here), 'out', f3(x.out)); });

  console.log('\n--- which trials happen: P = 10..100 for N = 10, 13, 30 (count)');
  [10, 13, 30].forEach(function (N) { var row = []; for (var P = 0; P <= 100; P += 10) { var c = 0; for (i = 1; i <= N; i++) if (happens(i, P)) c++; row.push(P + ':' + c); } console.log('N', N, row.join('  ')); });
  console.log('P=50 N=10 pattern:', (function () { var s = ''; for (i = 1; i <= 10; i++) s += happens(i, 50) ? 'X' : '.'; return s; })(), '  P=90:', (function () { var s = ''; for (i = 1; i <= 10; i++) s += happens(i, 90) ? 'X' : '.'; return s; })(), '  P=30:', (function () { var s = ''; for (i = 1; i <= 10; i++) s += happens(i, 30) ? 'X' : '.'; return s; })());

  console.log('\n--- reinstatement what-if, hand check (m=1, N10 P0): SV =', f3(Math.pow(0.8, 10)), ' V_C =', f3((1 + Math.pow(0.8, 10)) / 2), ' V_R =', f3(Math.pow(0.8, 10) - (1 + Math.pow(0.8, 10)) / 2), ' after one event: F =', f3(Math.pow(0.8, 10) + 0.1 * (1 - (Math.pow(0.8, 10) - (1 + Math.pow(0.8, 10)) / 2))));
  console.log('\n--- stability: s must be < 1 for monotone fall; slider max 0.5');
}
if (typeof module !== 'undefined') module.exports = { run: run, happens: happens, k50: k50 };
