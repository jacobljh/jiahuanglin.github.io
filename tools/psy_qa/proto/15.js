// proto/15.js — lesson 15 widget maths: a discomfort-profile lab, "what you lived" vs "what you remember" (a labelled DEMO model, not data).
// run: node tools/psy_qa/proto/15.js
// Two trials per preset on a 0–14 meter, one sample per time unit (1 s in the cold-water preset).
//   SHORT = the main episode.   LONG = the SAME main episode + an extension of EXT = 30 units that starts at the level where the main
//   episode ended (L0) and falls linearly to L0 - drop.   (long therefore contains every moment of short: its total is never smaller.)
// PUBLISHED (FACTS_T7c §15-A / "Widget constants"; Kahneman, Fredrickson, Schreiber & Redelmeier 1993):
//   short = 60 s at about 14 °C; long = the same 60 s + 30 s of slowly warming water; discomfort meter 0–14, 1-s means;
//   mean drop of the meter in the long trial's last 30 s: M = 2.65.   => cold preset default drop = 2.65.
//   ONLY that drop is published. The profile itself (ramp 2 -> 8 over the first 20 s, plateau 8 up to s = 60, then a linear fall over the
//   extension) is a labelled sketch (示意). The colonoscopy-style profile and its length are NOT published at all (示意).
// Remembered score (a toy, lower = remembered as less unpleasant):
//   R = w * peak + (1 - w) * end + d * (total / 60)        peak = max of the trial, end = mean of its last 10 samples,
//   total = sum of the samples (meter-units x time-units), so total / 60 = "meter-minutes" if the unit is a second.
//   w = how much the peak counts against the end (default 0.5);  d = weight of the plain total (default 0 = a pure peak-and-end summariser).
//   "weights are 示意" — no regression weight from Redelmeier & Kahneman 1996 is used (none are published in the abstract).
// d* = the duration/total weight at which R stops preferring the long trial:  d* = (R0_short - R0_long) / ((total_long - total_short) / 60),
//   defined only when R0 (at d = 0) prefers the long trial.
var PSY = require('./_psy.js');
var EXT = 30, END_WIN = 10, TOP = 14;
function clamp(v) { return Math.max(0, Math.min(TOP, v)); }
// piecewise-linear key points for the colonoscopy-style main episode (示意)
var COLO = [[0, 2], [15, 5], [30, 3], [45, 7], [60, 4], [75, 9], [90, 5], [105, 8], [110, 7], [120, 7]];
function lin(pts, t) {
  var i;
  for (i = 1; i < pts.length; i++) if (t <= pts[i][0]) return pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * (t - pts[i - 1][0]) / (pts[i][0] - pts[i - 1][0]);
  return pts[pts.length - 1][1];
}
function main(preset, seg) {
  var a = [], t;
  if (preset === 'cold') for (t = 1; t <= 60; t++) a.push(2 + 6 * Math.min(t, 20) / 20);
  else if (preset === 'colo') for (t = 1; t <= 120; t++) a.push(lin(COLO, t));
  else for (t = 1; t <= 60; t++) a.push(seg[Math.floor((t - 1) / 15)]);
  return a;
}
function trials(o) {   // o: preset, drop, seg[4], tail[2]
  var s = main(o.preset, o.seg), l = s.slice(), k, L0 = s[s.length - 1];
  if (o.preset === 'custom') { for (k = 1; k <= 30; k++) l.push(o.tail[Math.floor((k - 1) / 15)]); }
  else for (k = 1; k <= EXT; k++) l.push(L0 - o.drop * k / EXT);
  return { s: s.map(clamp), l: l.map(clamp) };
}
function stats(a, w, d) {
  var n = a.length, tot = 0, pk = 0, i, e = 0;
  for (i = 0; i < n; i++) { tot += a[i]; if (a[i] > pk) pk = a[i]; }
  for (i = n - END_WIN; i < n; i++) e += a[i];
  e /= END_WIN;
  return { n: n, total: tot, peak: pk, end: e, mean: tot / n, R: w * pk + (1 - w) * e + d * tot / 60, R0: w * pk + (1 - w) * e };
}
function verdict(x, y) { return Math.abs(x - y) < 0.005 ? 'tie' : (x < y ? 'short' : 'long'); }
function run(o) {
  var T = trials(o), S = stats(T.s, o.w, o.d), Lg = stats(T.l, o.w, o.d);
  var dA = (Lg.total - S.total) / 60, diff0 = S.R0 - Lg.R0, dstar = (dA > 1e-9 && diff0 > 0.005) ? diff0 / dA : null;
  return { S: S, L: Lg, byArea: verdict(S.total, Lg.total), byR: verdict(S.R, Lg.R), byMean: verdict(S.mean, Lg.mean), dstar: dstar };
}
function f(x, k) { return x === null ? '—' : x.toFixed(k === undefined ? 2 : k); }
var DEF = { preset: 'cold', drop: 2.65, seg: [2, 5, 8, 8], tail: [6, 4], w: 0.5, d: 0 };
function mk(over) { var o = {}, k; for (k in DEF) o[k] = DEF[k]; for (k in over) o[k] = over[k]; return o; }
if (require.main === module) {
  var cases = [
    ['cold default (w .5, d 0, drop 2.65)', {}],
    ['cold w=1 (peak only)', { w: 1 }],
    ['cold w=0 (end only)', { w: 0 }],
    ['cold w=.5 d=.34 (at the flip)', { d: 0.34 }],
    ['cold w=.5 d=.2', { d: 0.2 }],
    ['cold w=.5 d=.5', { d: 0.5 }],
    ['cold drop 0 (no relief)', { drop: 0 }],
    ['cold drop 0.5', { drop: 0.5 }],
    ['cold drop 1', { drop: 1 }],
    ['cold drop 2', { drop: 2 }],
    ['cold drop -2 (worse end)', { drop: -2 }],
    ['cold drop 5', { drop: 5 }],
    ['colo default drop 2.0', { preset: 'colo', drop: 2 }],
    ['colo drop 0', { preset: 'colo', drop: 0 }],
    ['colo drop -2', { preset: 'colo', drop: -2 }],
    ['colo drop 2.0 d .5', { preset: 'colo', drop: 2, d: 0.5 }],
    ['custom default', { preset: 'custom' }]
  ];
  cases.forEach(function (c) {
    var o = mk(c[1]), r = run(o);
    console.log(c[0].padEnd(40), '| S: n', r.S.n, 'tot', f(r.S.total, 1), 'pk', f(r.S.peak, 2), 'end', f(r.S.end, 2), 'mean', f(r.S.mean), 'R', f(r.S.R),
      '| L: n', r.L.n, 'tot', f(r.L.total, 1), 'pk', f(r.L.peak, 2), 'end', f(r.L.end, 2), 'mean', f(r.L.mean), 'R', f(r.L.R),
      '| area->', r.byArea, 'R->', r.byR, 'mean->', r.byMean, 'd*', f(r.dstar));
  });
  // mean vs peak-end: for which relief does the plain mean prefer LONG (cold, w .5)?
  var dr; var line = [];
  for (dr = 0; dr <= 3.0001; dr += 0.25) { var r2 = run(mk({ drop: dr })); line.push(dr.toFixed(2) + ':R=' + r2.byR[0] + '/mean=' + r2.byMean[0]); }
  console.log(line.join('  '));
}
if (typeof module !== 'undefined') module.exports = { run: run, trials: trials, stats: stats, mk: mk };
