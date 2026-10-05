/* shelf_lab.js — lesson 4's private engine: how long does a correction keep its value?
 *
 * The lineage is robot lesson 3's: D is 20 calm demonstrations of the expert; clone 1 is the nearest-demo policy trained on D; round n runs clone n for five rollouts under the gust,
 * the program labels every state they visited (the label is the expert's command at that state, a function of the state alone), the labelled frames C_n join everything stored,
 * and clone n+1 is the policy trained on D + C_1 + ... + C_n.  (In the code a clone is numbered by g = n - 1, the number of rounds already stored.)  Four lineages (collection
 * seeds 8, 1, 2, 3) are the four draws of the collection runs' gusts and starts.
 *
 * A SET is the first 800 labelled frames of eight fresh runs of one clone at one gust.  Its VALUE to clone n is the relative reduction of the copy error (robot lesson 1's score, the
 * root-mean-square difference between the policy's command and the expert's, relative to the expert's size) on clone n's own frames (a probe of 30 runs), when the set is added
 * to clone n's stock and the policy is rebuilt.  The RELEVANCE r_k of a set made for the clone k generations back is its value divided by the value of a set made for clone n.
 * A CELL is one (lineage, n, k, gust of the set, gust of the retrained clone) with NDRAW draws; the page's table pools the four lineages.
 *
 * Success gains (SL.gain, SL.driftGain) are what the ledger pays for; each draw needs two evaluations of 200 runs (the base and the retrained policy, on the same starts and gusts, a
 * stream of its own per draw so that no stream's luck is shared), so the page ships the table of them (SL.TABLE, a compact table measured with this file by tools/chain/verify/engine/build_shelf.js and re-derived by a separate
 * implementation in the lesson's oracle) and measures only the copy error live, for one lineage.
 */
(function (root) {
'use strict';
var BN = root.BN || require('./bench.js');
var DL = root.DL || require('./dagger_lab.js');
var SL = {};
SL.W = DL.WA;                                         // the five-post course, first post passed above
SL.LIN = [8, 1, 2, 3];                                // lineage seeds (8 is the engine's typical one)
SL.NSET = 800; SL.NRUN = 8; SL.NDRAW = 10; SL.NPROBE = 30; SL.NCLONE = 6; SL.NEV = 200; SL.NPOST = 1000;
SL.GUSTS = [0.05, 0.075, 0.10];
SL.FAR = 4;                                           // cm from the expert's path: the tube of robot lessons 2 and 3, beyond which a step is lost

/* ───────────── seeds: one stream per use, so that every number is a function of its arguments ───────────── */
SL.setSeed = function (L, g, k, d, gi) { return 55000 + 100000 * L + 1000 * g + 100 * k + d + 7000 * gi; };      // the d-th set for clone g+1 made by the clone k back, at gust index gi
SL.probeSeed = function (L, g, gi) { return 123456 + g + 100 * L + 1000 * gi; };                                    // the runs whose frames clone g+1 is scored on
SL.refSeed = function (L, g, gi) { return 81000 + g + 100 * L + 1000 * gi; };                                       // the 100 runs behind a reach or coverage figure
SL.succSeed = function (L, g, k, d) { return 9000 + 100000 * L + 1000 * g + 100 * k + d; };                         // the sets behind a success gain
SL.driftSeed = function (gc, d) { return 91000 + 1000 * d + Math.round(gc * 10000); };
SL.evalSeed = function (L, g, d) { return 3000 + 1000 * L + 100 * g + d; };                                         // the 200 runs on which the d-th draw's retrained policy and its base are both scored
SL.driftEval = function (gj, d) { return 4000 + 100 * gj + d; };
SL.postSeed = function (L) { return 2000 + L; };                                                                      // the 1000 runs behind a clone's own success and failure share

/* ───────────── a lineage: the stock after each round and the clone trained on it ───────────── */
var LINS = {};
SL.lineage = function (seed) {
  if (LINS[seed]) return LINS[seed];
  var s = DL.session('prog', 0, 'latest', seed), all = [], i;
  DL.ensure(s, SL.NCLONE - 1);
  for (i = 0; i < s.X.length; i++) all.push([s.X[i], s.Y[i]]);
  return (LINS[seed] = { seed: seed, s: s, all: all, F: s.F, probes: {}, cells: {} });
};
SL.clone = function (lin, n) { return DL.clone(lin.s, n - 1); };                       // the policy trained on the first F[n-1] stored frames
SL.stock = function (lin, n) { return lin.all.slice(0, lin.F[n - 1]); };               // D + C_1 + ... + C_(n-1)
SL.nwOf = function (frames) { var nw = new BN.NW(DL.H), i; for (i = 0; i < frames.length; i++) nw.add(frames[i][0], frames[i][1]); return nw; };

/* ───────────── runs, labelled frames, sets ───────────── */
SL.pol = function (nw) { return function (q) { return DL.predict(nw, q); }; };
SL.runs = function (nw, n, seed, gust) {                                               // n runs of the policy under `gust`, one random stream
  var rng = BN.rng(seed), out = [], j;
  for (j = 0; j < n; j++) out.push(BN.rollout(SL.W, SL.pol(nw), rng, { noise: gust, jit: DL.JIT }));
  return out;
};
SL.frames = function (runs, limit) {                                                   // every visited state of every run, labelled by the expert, in order
  var out = [];
  runs.forEach(function (ro) { for (var t = 0; t < ro.S.length && out.length < limit; t++) out.push([ro.S[t], BN.slalom.expertAct(SL.W, ro.S[t])]); });
  return out;
};
SL.draw = function (nw, seed, gust) { return SL.frames(SL.runs(nw, SL.NRUN, seed, gust), SL.NSET); };
SL.dev = function (q) { return BN.slalom.dev(SL.W, BN.arm.fk(q, SL.W.body)) * 100; };   // centimetres from the expert's path
SL.quantile = function (a, p) { var b = a.slice().sort(function (x, y) { return x - y; }); return b[Math.min(b.length - 1, Math.floor(p * b.length))]; };

/* ───────────── the two values ───────────── */
SL.copyError = function (nw, probe) {
  var se = 0, ss = 0, i;
  for (i = 0; i < probe.length; i++) {
    var p = DL.predict(nw, probe[i][0]), a = probe[i][1];
    se += (p[0] - a[0]) * (p[0] - a[0]) + (p[1] - a[1]) * (p[1] - a[1]); ss += a[0] * a[0] + a[1] * a[1];
  }
  return Math.sqrt(se / ss);
};
SL.success = function (nw, N, gust, seed) { return BN.evaluate(SL.W, function () { return SL.pol(nw); }, N, seed, { noise: gust, jit: DL.JIT }); };   // N runs on one stream, so two policies scored with the same seed meet the same starts and gusts

/* ───────────── a cell: the value of sets made k clones back, for clone n, with the world at gust gi (set) and gj (retrained clone) ───────────── */
SL.probe = function (lin, n, gi) {                                                      // 30 runs of clone n at gust index gi, with its frames and the error of its own stock on them
  var key = n + '|' + gi;
  if (lin.probes[key]) return lin.probes[key];
  var nw = SL.clone(lin, n), runs = SL.runs(nw, SL.NPROBE, SL.probeSeed(lin.seed, n - 1, gi), SL.GUSTS[gi]), fr = SL.frames(runs, Infinity);
  return (lin.probes[key] = { runs: runs, frames: fr, dev: fr.map(function (f) { return SL.dev(f[0]); }), e0: SL.copyError(nw, fr) });
};
SL.cell = function (lin, n, k, gi, gj) {
  var key = [n, k, gi, gj].join('|');
  return lin.cells[key] || (lin.cells[key] = { lin: lin, n: n, k: k, gi: gi, gj: gj, red: [], far: [], done: 0, X0: null });
};
SL.step = function (c) {                                                                // one more draw of the set; the value is the error removed from the clone's own frames
  var lin = c.lin, j = c.n - c.k, pr = SL.probe(lin, c.n, c.gj), d = c.done;
  var X = SL.draw(SL.clone(lin, j), SL.setSeed(lin.seed, c.n - 1, c.k, d, c.gi), SL.GUSTS[c.gi]);
  if (d === 0) c.X0 = X;
  var far = 0, i;
  for (i = 0; i < X.length; i++) if (SL.dev(X[i][0]) > SL.FAR) far++;
  c.far.push(far / X.length);
  var e1 = SL.copyError(SL.nwOf(SL.stock(lin, c.n).concat(X)), pr.frames);
  c.red.push((pr.e0 - e1) / pr.e0); c.done++;
  return c;
};
SL.run = function (c) { while (c.done < SL.NDRAW) SL.step(c); return c; };
SL.mean = function (a) { var s = 0, i; for (i = 0; i < a.length; i++) s += a[i]; return a.length ? s / a.length : NaN; };
SL.sd = function (a) { var m = SL.mean(a), s = 0, i; for (i = 0; i < a.length; i++) s += (a[i] - m) * (a[i] - m); return Math.sqrt(s / Math.max(1, a.length - 1)); };

/* where the set's frames lie against where the retrained clone goes: the share of the clone's frames within one bandwidth of the set, and the clone's frames beyond the set's reach
 * (the distance from the path that 99 % of the frames of the clone that made the set stay within) */
SL.cover = function (c) {
  var pr = SL.probe(c.lin, c.n, c.gj), nwX = SL.nwOf(c.X0), hit = 0, i;
  for (i = 0; i < pr.frames.length; i++) if (DL.dist(nwX, pr.frames[i][0]) < 1) hit++;
  return hit / pr.frames.length;
};
SL.uncovered = function (c) {                                                           // which of the clone's own frames lie a bandwidth or more from every frame of the cell's first set; caches the flags and the covered share
  if (c.unc) return c.unc;
  var pr = SL.probe(c.lin, c.n, c.gj), nwX = SL.nwOf(c.X0), hit = 0;
  c.unc = pr.frames.map(function (f) { var u = DL.dist(nwX, f[0]) >= 1; if (!u) hit++; return u; });
  c.cov = hit / pr.frames.length;
  return c.unc;
};
SL.xy = function (frames) { return frames.map(function (f) { return BN.arm.fk(f[0], SL.W.body); }); };      // where the cup is at each labelled frame
SL.ratio = function (a, b) {                                                            // the value of cell a over the value of cell b, with the delta-method standard error of two independent means
  var ma = SL.mean(a.red), mb = SL.mean(b.red), ea = SL.sd(a.red) / Math.sqrt(a.done), eb = SL.sd(b.red) / Math.sqrt(b.done);
  return { r: ma / mb, se: a === b || a.done < 2 ? NaN : Math.sqrt(Math.pow(ea / mb, 2) + Math.pow(ma * eb / (mb * mb), 2)) };
};
SL.reach = function (c) {
  var src = SL.probe(c.lin, c.n - c.k, c.gi), pr = SL.probe(c.lin, c.n, c.gj), R = SL.quantile(src.dev, 0.99), out = 0, i;
  for (i = 0; i < pr.dev.length; i++) if (pr.dev[i] > R) out++;
  return { reach: R, own: SL.quantile(pr.dev, 0.99), over: out / pr.dev.length };
};

/* ───────────── what the ledger pays for: success points a set adds, scored on the same 200 runs as the base ───────────── */
SL.NGAIN = { 1: 50, 2: 24, 3: 24, 4: 12, 5: 12, 6: 12 };                                // draws per lineage behind each clone's gains
SL.KS = { 1: [0], 2: [0, 1], 3: [0, 1, 2], 4: [0, 1, 2, 3], 5: [0], 6: [0] };            // the ages whose success gain is measured (from clone 4 on success has no room to rank them)
SL.gain = function (lin, n, k, d, base) {                                               // the d-th set made k clones back, added to clone n's stock
  var g = n - 1, seed = SL.evalSeed(lin.seed, g, d), X = SL.draw(SL.clone(lin, n - k), SL.succSeed(lin.seed, g, k, d), SL.GUSTS[0]);
  if (base === undefined) base = SL.success(SL.clone(lin, n), SL.NEV, SL.GUSTS[0], seed).succ;
  return SL.success(SL.nwOf(SL.stock(lin, n).concat(X)), SL.NEV, SL.GUSTS[0], seed).succ - base;
};
SL.driftGain = function (gi, gj, d, base) {                                              // clone 1 (the demonstrations only): set made at gust index gi, retrained policy run at gust index gj
  var lin = SL.lineage(SL.LIN[0]), seed = SL.driftEval(gj, d), X = SL.draw(SL.clone(lin, 1), SL.driftSeed(SL.GUSTS[gi], d), SL.GUSTS[gi]);
  if (base === undefined) base = SL.success(SL.clone(lin, 1), SL.NEV, SL.GUSTS[gj], seed).succ;
  return SL.success(SL.nwOf(SL.stock(lin, 1).concat(X)), SL.NEV, SL.GUSTS[gj], seed).succ - base;
};
SL.NDRIFT = 100;

/* a sideways retraining: the clone is not improved but replaced, trained from scratch on twenty other calm demonstrations (seed B); corrections made for the clone of the old ones (seed A)
 * are compared with corrections made for the new clone, both added to the new demonstrations */
SL.PAIRS = [[1, 2], [3, 4]];
SL.demos = function (seed) {
  var rng = BN.rng(seed), out = [], ds = BN.demos(SL.W, 20, rng, { noise: 0, jit: DL.JIT });
  ds.forEach(function (ro) { for (var t = 0; t < ro.A.length; t++) out.push([ro.S[t], ro.A[t]]); });
  return out;
};
SL.sideGain = function (pi, d) {
  var A = SL.demos(SL.PAIRS[pi][0]), B = SL.demos(SL.PAIRS[pi][1]), nwA = SL.nwOf(A), nwB = SL.nwOf(B), seed = 5000 + 100 * pi + d;
  var base = SL.success(nwB, SL.NEV, SL.GUSTS[0], seed).succ, Xa = SL.draw(nwA, 61000 + 1000 * pi + d, SL.GUSTS[0]), Xb = SL.draw(nwB, 62000 + 1000 * pi + d, SL.GUSTS[0]);
  return { stale: SL.success(SL.nwOf(B.concat(Xa)), SL.NEV, SL.GUSTS[0], seed).succ - base, fresh: SL.success(SL.nwOf(B.concat(Xb)), SL.NEV, SL.GUSTS[0], seed).succ - base };
};
SL.NSIDE = 24;

/*TABLE:BEGIN*/
SL.TABLE = {"gen":[0,1,2,3,4,5],"lineages":4,"draws":{"gain":{"1":50,"2":24,"3":24,"4":12,"5":12,"6":12},"set":10,"drift":100,"side":24,"runsPerClone":1000,"evalRuns":200,"setFrames":800,"probeRuns":30},"gain":{"1|0":{"m":18.4975,"se":0.4561,"n":200},"2|0":{"m":9.7865,"se":0.6322,"n":96},"2|1":{"m":9.3906,"se":0.7115,"n":96,"r":0.9596,"rse":0.0955},"3|0":{"m":5.4427,"se":0.4603,"n":96},"3|1":{"m":4.8073,"se":0.4883,"n":96,"r":0.8833,"rse":0.1167},"3|2":{"m":4.7344,"se":0.4871,"n":96,"r":0.8699,"rse":0.1158},"4|0":{"m":0.8542,"se":0.3391,"n":48},"4|1":{"m":1.2812,"se":0.3065,"n":48,"r":1.5,"rse":0.6953},"4|2":{"m":1.6146,"se":0.3353,"n":48,"r":1.8902,"rse":0.847},"4|3":{"m":1.6667,"se":0.3729,"n":48,"r":1.9512,"rse":0.8892},"5|0":{"m":1,"se":0.3231,"n":48},"6|0":{"m":0.7187,"se":0.2654,"n":48}},"clone":{"succ":[61.95,77.45,86.9,94.375,95.775,96.6],"post":[38.05,22.55,13.1,5.625,4.225,3.4],"n":4000},"smooth":{"1|0":{"m":8.8896,"se":0.4187,"far":5.7875,"n":40},"2|0":{"m":7.2848,"se":0.3727,"far":4.3844,"n":40},"2|1":{"m":6.3629,"se":0.4557,"far":6.9531,"n":40,"r":0.8734,"rse":0.0769},"3|0":{"m":3.7171,"se":0.3275,"far":3.1531,"n":40},"3|1":{"m":4.0437,"se":0.2964,"far":4.4125,"n":40,"r":1.0879,"rse":0.1247},"3|2":{"m":4.7628,"se":0.3931,"far":5.6029,"n":40,"r":1.2813,"rse":0.1547},"4|0":{"m":1.7571,"se":0.1626,"far":2.1625,"n":40},"4|1":{"m":2.2523,"se":0.2013,"far":2.9281,"n":40,"r":1.2819,"rse":0.1649},"4|2":{"m":2.5129,"se":0.2356,"far":3.5,"n":40,"r":1.4302,"rse":0.1884},"4|3":{"m":3.2104,"se":0.2197,"far":6.3938,"n":40,"r":1.8271,"rse":0.2103},"5|0":{"m":1.4099,"se":0.1546,"far":2.0437,"n":40},"5|1":{"m":1.7028,"se":0.1789,"far":2.9906,"n":40,"r":1.2077,"rse":0.1834},"5|2":{"m":2.1001,"se":0.2002,"far":3.4156,"n":40,"r":1.4895,"rse":0.2164},"5|3":{"m":2.8618,"se":0.2306,"far":4.5094,"n":40,"r":2.0297,"rse":0.2762},"5|4":{"m":3.1395,"se":0.2415,"far":7.3187,"n":40,"r":2.2267,"rse":0.2983},"6|0":{"m":0.707,"se":0.1265,"far":1.7844,"n":40},"6|1":{"m":1.2042,"se":0.1969,"far":1.9906,"n":40,"r":1.7031,"rse":0.4129},"6|2":{"m":1.0105,"se":0.1528,"far":2.2781,"n":40,"r":1.4292,"rse":0.3349},"6|3":{"m":1.3772,"se":0.165,"far":3.1125,"n":40,"r":1.9478,"rse":0.4195},"6|4":{"m":1.7493,"se":0.1778,"far":4.2781,"n":40,"r":2.4741,"rse":0.5093},"6|5":{"m":2.3552,"se":0.2709,"far":5.3781,"n":40,"r":3.3311,"rse":0.7087}},"corr":{"2":0.3529,"3":0.6532,"4":0.6935,"5":0.6905,"6":0.6185},"drift":{"0|0":{"m":18.385,"se":0.6593,"r":1,"rse":0.0507,"n":100},"0|1":{"m":16.765,"se":0.6889,"r":0.8041,"rse":0.0398,"n":100},"0|2":{"m":13.04,"se":0.5884,"r":0.8059,"rse":0.0449,"n":100},"1|0":{"m":21.62,"se":0.6128,"r":1.176,"rse":0.0538,"n":100},"1|1":{"m":20.85,"se":0.5759,"r":1,"rse":0.0391,"n":100},"1|2":{"m":15.86,"se":0.5137,"r":0.9802,"rse":0.0451,"n":100},"2|0":{"m":22,"se":0.5673,"r":1.1966,"rse":0.0529,"n":100},"2|1":{"m":21.015,"se":0.6813,"r":1.0079,"rse":0.0429,"n":100},"2|2":{"m":16.18,"se":0.5294,"r":1,"rse":0.0463,"n":100}},"driftSmooth":{"0|0":{"m":8.8896,"r":1,"rse":0.0666},"0|1":{"m":11.2626,"r":0.7552,"rse":0.0561},"0|2":{"m":13.4348,"r":0.701,"rse":0.0428},"1|0":{"m":11.3002,"r":1.2712,"rse":0.0777},"1|1":{"m":14.9126,"r":1,"rse":0.0625},"1|2":{"m":17.4483,"r":0.9105,"rse":0.0465},"2|0":{"m":11.1367,"r":1.2528,"rse":0.0735},"2|1":{"m":15.8204,"r":1.0609,"rse":0.064},"2|2":{"m":19.1642,"r":1,"rse":0.0501}},"side":{"stale":17.4792,"fresh":18.9896,"r":0.9205,"rse":0.0586,"n":48},"reach":{"c1":{"p99":4.8982,"over":0.9994,"cover":91.6824,"n":59837},"c2":{"p99":4.674,"over":0.5446,"cover":95.4463,"n":65002},"c3":{"p99":4.5014,"over":0.2915,"cover":95.5244,"n":68616},"c4":{"p99":4.3986,"over":0.2503,"cover":96.2626,"n":71119},"c5":{"p99":4.2837,"over":0.1377,"cover":96.1398,"n":72612},"c6":{"p99":4.2598,"over":0.1385,"cover":96.1407,"n":72941},"g1":{"p99":5.3548,"over":2.2392,"cover":87.3241,"n":48186},"g2":{"p99":6.1803,"over":3.8369,"cover":82.9704,"n":40371},"R0":4.8982},"disc":{"3|noD":96.875,"4|noD":99.75,"5|noD":99.675,"6|noD":99.55,"5|newest":74.8,"5|oldest":77.45},"framesPerRound":823.5,"successByGen":[61.95,77.45,86.9,94.375,95.775,96.6],"postsByGen":[38.05,22.55,13.1,5.625,4.225,3.4],"valueByGen":[18.4975,9.7865,5.4427,0.8542,1,0.7187],"valueSe":[0.4561,0.6322,0.4603,0.3391,0.3231,0.2654],"keepSuccess":[1,0.9624,1.0083,1.9512,null,null],"keepSmooth":[1,1.2308,1.4076,1.9349,2.3504,3.3311],"driftKeep":{"ratio":[1,1.5,2],"keep":[1,0.8041,0.8059],"keepSmooth":[1,0.7552,0.701],"harsher":[1.176,1.1966]},"notes":{"gen":"rounds already stored: 0 is the clone of the 20 calm demonstrations (clone 1 on the page), g is clone g + 1","keep":"share of a correction set's value that survives a retraining of the policy it was made for, as the ledger should book it: 1 (no decay was measured); keepSuccess[k] and keepSmooth[k] are the measured ratios by age k of the set, in clones","keepSuccess":"age k = 1..3: pooled gain of sets made k clones back divided by the pooled gain of fresh sets, clones 2 to 4 (success points, same 200 runs for base and retrained policy); null where not measured (success saturates from clone 4 on)","keepSmooth":"age k = 1..5: mean over the clones that have a set of that age of the ratio of the relative copy-error reductions on the clone's own frames; it rises with age, from 0.9 to 3.3 across cells","valueByGen":"success points that a fresh set of 800 labelled frames (the first 800 frames of eight runs of the clone itself, gust 0.05) adds to the clone of that generation; 4 lineages, pooled draws","postsByGen":"percent of the clone's own runs under gust 0.05 that end in a post (a failure; none times out); 4 x 1000 runs","successByGen":"percent of the clone's runs under gust 0.05 that complete the course","driftKeep":"value of a set made at gust ratio x 0.05 for the clone of the demonstrations, used by a policy that runs at gust 0.05 (ratio 1) / 0.075 / 0.10, relative to a set made at the gust the policy runs at; success points over 100 draws (keep) and copy-error measure (keepSmooth); harsher: sets made at 0.075 and 0.10, used at 0.05","framesPerRound":"labelled frames per round of five runs, mean of the four lineages (one frame is 0.05 s of motion)","dropDemos":"once at least two rounds are stored, success of the clone trained on the corrections alone (roundsOnlyByGen, gen 2 to 5) is higher than that of the clone trained on the 20 calm demonstrations plus the rounds (successByGen): the ledger's recover.corr curve understates what corrections alone reach","scale":"the Bench task is small: shapes, signs and ratios carry to larger tasks; the totals, the gains in points and the dollar figures do not"}};
/*TABLE:END*/

/* the numbers the next lesson reads (the lead merges this into LG.TABLE.relevance):
 *   gen            the number of rounds already stored (0 = the clone of the demonstrations)
 *   keep           the share of a correction's value that survives one retraining, as the ledger should book it: 1 (nothing expires), an array over the age k of the set; keepSuccess / keepSmooth are the measured ratios (null where not measured)
 *   valueByGen     success points a fresh 800-frame set adds to the clone of that generation
 *   postsByGen     percent of that clone's runs that end in a post (a failure: none times out)
 *   roundsOnlyByGen percent of that clone's runs that complete the course when it is trained on the corrections alone, without the 20 calm demonstrations (null before two rounds are stored)
 *   successByGen   percent of that clone's runs that complete the course (4 lineages x 1000 runs, gust 0.05)
 *   driftKeep      {ratio, keep, keepSmooth, harsher}: value of a set made at gust 0.05, used by a policy that runs at gust ratio * 0.05, relative to a set made at the gust the policy runs at
 *                  (success points, then the copy-error measure); harsher = sets made at 0.075 and 0.10 and used at 0.05
 *   framesPerRound labelled frames per round of five runs, mean of the four lineages
 *   notes          how each is defined, and the finding about the calm demonstrations (notes.dropDemos): once two rounds are stored, the corrections alone beat the corrections plus the
 *                  20 demonstrations, so the ledger's recover.corr curve understates what corrections reach */
SL.table = function () {
  var T = SL.TABLE;
  if (!T) return null;
  return { gen: T.gen, keep: T.gen.map(function () { return 1; }), keepSuccess: T.keepSuccess, keepSmooth: T.keepSmooth, valueByGen: T.valueByGen, postsByGen: T.postsByGen,
           successByGen: T.successByGen, roundsOnlyByGen: T.gen.map(function (g) { var v = T.disc[(g + 1) + '|noD']; return v === undefined ? null : v; }),
           driftKeep: T.driftKeep, framesPerRound: T.framesPerRound, notes: T.notes };
};

root.SL = SL;
if (typeof module !== 'undefined' && module.exports) module.exports = SL;
})(typeof window !== 'undefined' ? window : globalThis);
