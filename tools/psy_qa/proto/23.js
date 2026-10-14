// proto/15.js — lesson 15 widget maths: a computerised choice-blindness task (a proxy of Johansson, Hall & Sikström 2008) and its scoring.
// run: node tools/psy_qa/proto/15.js
// Design copied from the 2008 computer version: 15 forced choices, 3 manipulated (always trials 7, 10 and 14); on a manipulated trial the pair of patterns
// swaps places during a 50 ms flash after the choice, so the framed picture is the one NOT chosen. Deviations (declared in the page): abstract patterns drawn on a canvas,
// no 1500 ms time limit, a 'why did you choose it' menu after every trial, and detection is only collected AFTER the 15 trials (the paper also counted spontaneous remarks).
// Scoring as in the paper's retrospective part: a manipulated trial is 'detected' if the reader marks it as odd afterwards; marking an unmanipulated trial is a false alarm.
// The simulated participant detects each manipulated trial with probability p, independently (a labelled model, not data), says 'I would have noticed' with probability .85 when nothing was detected
// (the paper states 85% of non-detectors said they would have noticed), and gives a specific reason (not 'can't say') on 80% of trials (labelled guess).
var NT = 15, SWAP = [7, 10, 14], REASONS = ['颜色', '形状', '平衡感', '有意思', '说不清'];
var PAL = ['#e11d48', '#f59e0b', '#16a34a', '#0ea5e9', '#6366f1', '#a855f7'], BGS = ['#f1f5f9', '#fef3c7', '#e0f2fe', '#fce7f3', '#dcfce7', '#ede9fe'];
function mulberry32(seed) { var a = seed >>> 0; return function () { a = (a + 0x6D2B79F5) >>> 0; var t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function isSwap(t) { return SWAP.indexOf(t) >= 0; }
function pattern(seed) {          // a 3x3 grid of coloured cells from the shared palette plus a centre dot: similar 'feel', different arrangement
  var r = mulberry32(seed), cells = [], i, pal = [];
  for (i = 0; i < 3; i++) pal.push(PAL[Math.floor(r() * PAL.length)]);
  for (i = 0; i < 9; i++) cells.push(pal[Math.floor(r() * 3)]);
  return { bg: BGS[Math.floor(r() * BGS.length)], cells: cells, dot: pal[Math.floor(r() * 3)] };
}
function score(manip, flagged, reasons) {      // manip/flagged: arrays of booleans (length NT); reasons: index per trial
  var det = 0, fa = 0, spec = 0, t, nm = 0;
  for (t = 0; t < NT; t++) {
    if (manip[t]) { nm++; if (flagged[t]) det++; if (reasons[t] !== 4) spec++; }
    else if (flagged[t]) fa++;
  }
  return { n: nm, det: det, fa: fa, spec: spec };
}
function simPart(k, p) {
  var r = mulberry32(9000 + k), manip = [], flagged = [], reasons = [], t, det = 0;
  for (t = 1; t <= NT; t++) {
    manip.push(isSwap(t)); reasons.push(r() < 0.8 ? Math.floor(r() * 4) : 4);
    flagged.push(isSwap(t) && r() < p); if (flagged[t - 1]) det++;
  }
  var pred = det > 0 ? true : r() < 0.85;
  var s = score(manip, flagged, reasons); s.pred = pred; s.k = k;
  return s;
}
function simMany(n, p) {
  var hist = [0, 0, 0, 0], i, s, tot = 0, nm = 0, yes = 0, none = 0;
  for (i = 1; i <= n; i++) { s = simPart(i, p); hist[s.det]++; tot += s.det; nm += s.n; if (s.det === 0) { none++; if (s.pred) yes++; } }
  return { hist: hist, rate: tot / nm, none: none, yes: yes, n: n };
}
function f(x, d) { return x.toFixed(d === undefined ? 3 : d); }
if (require.main === module) {
  [0.19, 0.12, 0.39, 0.6, 0].forEach(function (p) {
    var m = simMany(20, p), exp0 = Math.pow(1 - p, 3);
    console.log('p', p, '| 20 sims: hist(0..3 detected)', m.hist.join('/'), 'rate', f(m.rate, 3), '| none', m.none, '(independence expects', f(20 * exp0, 1) + ')', '| of the none, said "would notice"', m.yes);
  });
  var big = simMany(2000, 0.19); console.log('2000 sims p .19: none share', f(big.none / 2000), 'expected', f(Math.pow(0.81, 3)), 'rate', f(big.rate));
  console.log('simPart(1,.19):', JSON.stringify(simPart(1, 0.19)));
  var pa = pattern(1500), pb = pattern(1501); console.log('pattern sample', JSON.stringify(pa));
  console.log('swap trials', SWAP.join(','), '| manual score example:', JSON.stringify(score([0,0,0,0,0,0,1,0,0,1,0,0,0,1,0].map(Boolean), [0,0,0,0,0,0,1,0,0,0,0,0,1,0,0].map(Boolean), [0,1,2,3,4,0,4,1,2,3,0,1,2,3,0])));
}
if (typeof module !== 'undefined') module.exports = { pattern: pattern, score: score, simPart: simPart, simMany: simMany, SWAP: SWAP };
