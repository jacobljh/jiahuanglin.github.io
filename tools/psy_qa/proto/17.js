// proto/17.js — lesson 17 widget maths: a prediction that decides where to look (示意 toy; NOT a model of any disorder, NOT fitted to any data).
// run: node tools/psy_qa/proto/17.js          (the page's widget is a port of person()/run() below; every number the prose quotes is printed here)
//
// REPLACES the early toy (Beta belief + habit): the belief is now a Rescorla–Wagner / delta-rule estimate (lesson 09), because
//   (a) 1/m is then literally "how far one new piece of evidence moves the prediction" = the prior's strength (m ≈ number of experiences it is worth),
//   (b) there is no fixed pseudo-count, so the model has a plasticity–stability trade-off (flexible beliefs get re-scared by chance bad days) that a Beta count cannot show.
//
// World: ONE recurring choice, "go or stay out" (a situation that now scares the person). The true chance that going ends badly is fixed, TRUTH = 0.05 (示意: it is mostly fine).
// Person (one per seed): prediction th = believed chance that going ends badly; habit h = pull towards staying out (relief that has been reinforced).
//   each round:  p = 1/(1+exp(-(BEN − HARM·th − h)/SC))      the chance of going by choice (logistic noise = exploration)
//                forced with probability f (life makes the person go: work, school, family) → goes if forced OR chosen
//                if goes:  outcome bad with prob TRUTH;  th ← th + (outcome − th)/m      (R–W with learning rate 1/m);   h ← h·(1 − DECAY)
//                if stays: NO outcome is observed, so th does not move (no prediction error);   h ← h + eta      (relief; "behaviours followed by satisfaction are repeated", lesson 09)
//   start: a fright sets th = th0 (th0 ≥ 0.20 > LO, so every run starts "not well").
// States (hysteresis, so chance flicker around one cutoff is not counted):  "well" once th < LO = 0.15;  back to "not well" if th ≥ HI = 0.25 (= BEN/HARM: break-even for going when h = 0).
//   recovered-and-held = got well, never fell back;  fell back = got well, then th ≥ HI at least once;  never well = th never below LO in T = 360 rounds.
// Common random numbers: person k of luck-block b uses PSY.rng(1000 + 200·b + k) with three draws per round (forced, chosen, outcome) whatever the path,
// so moving a slider changes outcomes smoothly and the same luck is replayed.
var T = 360, NP = 200, SHOW = 12, TRUTH = 0.05, BEN = 1, HARM = 4, SC = 0.35, DECAY = 0.2, LO = 0.15, HI = 0.25;
function mulberry32(seed) { var a = seed >>> 0; return function () { a = (a + 0x6D2B79F5) >>> 0; var t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }   // = PSY.rng
function person(seed, th0, m, eta, f, truth) {
  var r = mulberry32(seed), th = th0, h = 0, ill = th0 >= LO, rec = ill ? -1 : 0, nrel = 0, went = 0, t, u1, u2, u3, p, go;
  var path = [th], wt = [0], st = [ill ? 1 : 0], tr = truth === undefined ? TRUTH : truth;
  for (t = 1; t <= T; t++) {
    u1 = r(); u2 = r(); u3 = r();
    p = 1 / (1 + Math.exp(-(BEN - HARM * th - h) / SC));
    go = u1 < f || u2 < p;
    if (go) { went++; th += ((u3 < tr ? 1 : 0) - th) / m; h *= 1 - DECAY; } else h += eta;
    if (ill && th < LO) { ill = false; if (rec < 0) rec = t; } else if (!ill && th >= HI) { ill = true; nrel++; }
    path.push(th); wt.push(go ? 1 : 0); st.push(ill ? 1 : 0);
  }
  return { path: path, wt: wt, st: st, rec: rec, nrel: nrel, went: went / T };
}
function run(o) {   // o: th (th0), m, eta, f, luck
  var P = [], i, p, held = 0, rel = 0, never = 0, r90 = 0, rt = [], ws = 0, curve = [], t;
  for (t = 0; t <= T; t++) curve.push(0);
  for (i = 0; i < NP; i++) {
    p = person(1000 + 200 * o.luck + i, o.th, o.m, o.eta, o.f, o.truth); P.push(p); ws += p.went;
    if (p.rec < 0) never++; else { rt.push(p.rec); if (p.rec <= 90) r90++; if (p.nrel > 0) rel++; else held++; }
    for (t = 0; t <= T; t++) curve[t] += p.st[t];
  }
  rt.sort(function (a, b) { return a - b; });
  return { P: P, held: held, rel: rel, never: never, r90: r90, med: rt.length ? rt[(rt.length - 1) >> 1] : -1, went: ws / NP, curve: curve.map(function (c) { return c / NP; }) };
}
function pct(x) { return Math.round(100 * x) + '%'; }
function line(lab, o) {
  var r = run(o);
  console.log(lab.padEnd(30), '好转并保持', pct(r.held / NP).padStart(4), '又掉回去', pct(r.rel / NP).padStart(4), '一直没好转', pct(r.never / NP).padStart(4), '90内好转', pct(r.r90 / NP).padStart(4), '中位', String(r.med).padStart(4), '去了', pct(r.went).padStart(4), ' | 此刻没好转 @90', pct(r.curve[90]).padStart(4), '@360', pct(r.curve[360]).padStart(4));
  return r;
}
var DEF = { th: 0.40, m: 10, eta: 0.03, f: 0.02, luck: 0 };
function with_(x) { return Object.assign({}, DEF, x); }
if (require.main === module) {
  console.log('== independent checks of the update rule ==');
  // (1) always going (f = 1) and no bad outcomes (truth = 0): th_n = th0 (1 − 1/m)^n, so recovery at the first n with th0 (1−1/m)^n < LO
  (function () {
    var p = person(1, 0.40, 10, 0.03, 1, 0), n = Math.ceil(Math.log(LO / 0.40) / Math.log(1 - 1 / 10));
    console.log('  th0 0.40, m 10, always go, no harm: sim recovers at round', p.rec, '| closed form ceil(ln(0.15/0.40)/ln(0.9)) =', n, '| 0.4·0.9^10 =', (0.4 * Math.pow(0.9, 10)).toFixed(4), '(< 0.15) and 0.4·0.9^9 =', (0.4 * Math.pow(0.9, 9)).toFixed(4), '(≥ 0.15)');
  })();
  // (2) mean-preserving: with every round a go, E[th_t] = TRUTH + (th0 − TRUTH)(1 − 1/m)^t → TRUTH
  (function () {
    var i, s = 0, s60 = 0, p; for (i = 0; i < 2000; i++) { p = person(50000 + i, 0.40, 10, 0.03, 1); s += p.path[360]; s60 += p.path[30]; }
    console.log('  always go, 2000 runs: mean th at round 30 =', (s60 / 2000).toFixed(4), '(theory', (0.05 + 0.35 * Math.pow(0.9, 30)).toFixed(4) + ') | at round 360 =', (s / 2000).toFixed(4), '(theory 0.0500)');
  })();
  // (3) choice rule: at th = BEN/HARM and h = 0 the chance of going is 1/2
  console.log('  p(go) at th = BEN/HARM, h = 0:', (1 / (1 + Math.exp(-(BEN - HARM * 0.25) / SC))).toFixed(3));
  // (4) evidence-arrival KPI = mean over rounds of go; compare with 1 − (stay rounds) accounting
  (function () { var r = run(DEF), s = 0, i, t; for (i = 0; i < NP; i++) for (t = 1; t <= T; t++) s += r.P[i].wt[t]; console.log('  went KPI', r.went.toFixed(4), 'vs recount', (s / (NP * T)).toFixed(4)); })();

  console.log('\n== default and presets (luck block 0, 200 people, T = 360 rounds) ==');
  line('p1 default th.40 m10 η.03 f.02', DEF);
  line('p2 smaller fright th.30', with_({ th: 0.30 }));
  line('p3 bigger fright th.50', with_({ th: 0.50 }));
  line('p4 no relief η 0', with_({ eta: 0 }));
  line('p5 life forces f .10', with_({ f: 0.10 }));
  line('p6 harder prior m 20', with_({ m: 20 }));
  line('p7 softer prior m 4', with_({ m: 4 }));
  console.log('\n== scans ==');
  [0.20, 0.25, 0.30, 0.35, 0.40, 0.45, 0.50, 0.55, 0.60].forEach(function (x) { line('th0 ' + x, with_({ th: x })); });
  [3, 4, 5, 6, 8, 10, 12, 15, 20, 25, 30].forEach(function (x) { line('m ' + x, with_({ m: x })); });
  [0, 0.01, 0.02, 0.03, 0.04, 0.05, 0.06].forEach(function (x) { line('eta ' + x, with_({ eta: x })); });
  [0, 0.01, 0.02, 0.03, 0.05, 0.10, 0.20].forEach(function (x) { line('f ' + x, with_({ f: x })); });
  console.log('\n== luck blocks (same settings, different luck): the group numbers move a few points, the 12 drawn lines change completely ==');
  [0, 1, 2, 3, 4].forEach(function (b) { line('luck ' + b, with_({ luck: b })); });
  console.log('\n== the 12 drawn people at the default (category, recovery round, fall-backs) ==');
  (function () {
    var r = run(DEF), out = [], i, p, cat;
    for (i = 0; i < SHOW; i++) { p = r.P[i]; cat = p.rec < 0 ? 'never' : (p.nrel ? 'fell' + p.nrel : 'held'); out.push(cat + (p.rec >= 0 ? '@' + p.rec : '') + ' went ' + pct(p.went)); }
    console.log('  ' + out.join(' | '));
    var g = [0, 15, 30, 60, 90, 180, 270, 360].map(function (t) { return t + ':' + pct(r.curve[t]); });
    console.log('  group curve (share not well):', g.join(' '));
  })();
  console.log('\n== what the model does NOT contain (stated on the page): no relief → no lock-in ==');
  line('η 0, f 0, th.60 (belief gate only)', with_({ eta: 0, f: 0, th: 0.60 }));
  line('f 0 (nearly absorbing stuck state)', with_({ f: 0 }));
  console.log('\n== if the world really is dangerous (truth .40), avoiding is not a mistake: ==');
  line('truth .40, default', with_({ truth: 0.40 }));
}
if (typeof module !== 'undefined') module.exports = { person: person, run: run, DEF: DEF };
