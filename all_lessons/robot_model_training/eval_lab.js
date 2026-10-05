/* eval_lab.js — lesson 15's private engine: how many trials does it take to tell one checkpoint from another?
 *
 * Three checkpoints of the five-post course are each run on the same 2,000 trials (trial k: a start offset of 1 cm std from seed 7000 + k, a gust stream from seed
 * 100000 + k, gust 0.05 rad/s).  That pool is the population: every evaluation of N trials is a draw of N of them, and "the true success rate" is the pool's.
 *   prev    a table of 20 demonstrations recorded from the marked start under gusts of 0.0403 rad/s    (68.0 % of the pool's trials succeed)
 *   next    the same recipe recorded under gusts of 0.0537 rad/s                                        (76.0 %)
 *   smooth  a random-feature ridge fit (150 features) of 20 calm demonstrations                         (68.0 %)
 * The settings were tuned once so that the pool rates are exactly 76.0 and 68.0 %; nothing else about them is special.
 * A trial reports success s, progress g (share of the course length reached, 1 when it finished), the post it hit, and its start offset dy.
 *   verdicts   pooled two-proportion z-test (independent trials), exact McNemar (paired trials), a z-test on means (progress); 5 % level
 *   power      exact for success (every pair of counts weighted by its binomial or trinomial probability), normal approximation for progress
 *   pairs      'same' replays the same start and the same gusts (a simulator can), 'start' pairs each trial with its nearest-start neighbour (a robot can match starts, not gusts)
 */
(function (root) {
'use strict';
var BN = root.BN || require('./bench.js');
var EL = {};
EL.Z = 1.96; EL.ZB = 0.8416;                      // two-sided 5 % level; 80 % power
EL.K = 2000; EL.GUST = 0.05; EL.JIT = 0.01; EL.SEED_START = 7000; EL.SEED_GUST = 100000;
EL.W = BN.slalom.world(5);
EL.SPEC = { prev: { kind: 'table', dn: 0.0403 }, next: { kind: 'table', dn: 0.0537 }, smooth: { kind: 'smooth', p: 150, bw: 0.1, lam: 0.0048 } };
EL.GRID = [5, 8, 10, 15, 20, 30, 40, 50, 70, 100, 140, 200, 280, 400, 500, 650, 800, 1000];
EL.TRAIN_RUNS = 40;                               // runs of the robot behind the two checkpoints: 20 + 20 demonstrations
EL.WEEK = 40;                                     // hours in a robot-week

/* ───────────── the checkpoints and the pool of trials ───────────── */
EL.demos = function (m, noise, jit) {
  var X = [], Y = [];
  BN.demos(EL.W, m, BN.rng(1), { noise: noise, jit: jit }).forEach(function (ro) { for (var t = 0; t < ro.A.length; t++) { X.push(ro.S[t]); Y.push(ro.A[t]); } });
  return { X: X, Y: Y };
};
EL.policy = function (spec) {
  var d, i;
  if (spec.kind === 'table') {
    d = EL.demos(20, spec.dn, 0);
    var nw = new BN.NW([0.02, 0.02]);
    for (i = 0; i < d.X.length; i++) nw.add(d.X[i], d.Y[i]);
    return function (q) { return nw.predict(q); };
  }
  d = EL.demos(20, 0, EL.JIT);
  var m = new BN.RFF(2, 2, spec.p, spec.bw, spec.lam, 1); m.add(d.X, d.Y); m.solve();
  return function (q) { return Array.from(m.predict(q)); };
};
EL.trial = function (policy, k) {
  var w = EL.W, dy = EL.JIT * BN.randn(BN.rng(EL.SEED_START + k));
  var ro = BN.rollout(w, policy, BN.rng(EL.SEED_GUST + k), { noise: EL.GUST, q0: BN.slalom.startQ(w, dy) });
  var p = ro.P[ro.P.length - 1], x0 = BN.slalom.xStart(), x1 = BN.slalom.xEnd(w), post = -1;
  if (ro.coll) { var bd = 9; w.posts.forEach(function (c, i) { var d = Math.hypot(p[0] - c[0], p[1] - c[1]); if (d < bd) { bd = d; post = i; } }); }
  return { s: ro.done ? 1 : 0, g: ro.done ? 1 : Math.max(0, Math.min(1, (p[0] - x0) / (x1 - x0))), post: post, dy: dy };
};
EL.newPool = function (key) { return { key: key, spec: EL.SPEC[key], pi: null, T: [] }; };
EL.fill = function (pool, count) {                 // run the next `count` trials of the pool; true when all K are done
  if (!pool.pi) pool.pi = EL.policy(pool.spec);
  var stop = Math.min(EL.K, pool.T.length + count);
  while (pool.T.length < stop) pool.T.push(EL.trial(pool.pi, pool.T.length));
  return pool.T.length >= EL.K;
};
EL.stats = function (T) {                          // success rate, mean and sample sd of progress, share of runs that end at each post
  var n = T.length, s = 0, g = 0, g2 = 0, post = [0, 0, 0, 0, 0], i;
  for (i = 0; i < n; i++) { s += T[i].s; g += T[i].g; g2 += T[i].g * T[i].g; if (T[i].post >= 0) post[T[i].post]++; }
  var gm = g / n;
  return { n: n, p: s / n, gm: gm, gvar: (g2 - n * gm * gm) / (n - 1), post: post.map(function (c) { return c / n; }) };
};

/* ───────────── pairs of trials ───────────── */
EL.pairs = function (A, B, mode) {                 // [trial of A, trial of B] for every trial of each pool exactly once
  var out = [], i;
  if (mode === 'same') { for (i = 0; i < A.length; i++) out.push([A[i], B[i]]); return out; }
  var order = A.map(function (t, k) { return k; }).sort(function (a, b) { return A[a].dy - A[b].dy; });
  for (i = 0; i + 1 < order.length; i += 2) { var u = order[i], v = order[i + 1]; out.push([A[u], B[v]]); out.push([A[v], B[u]]); }
  return out;
};
EL.cells = function (pairs) {                      // shares of pairs: only A succeeded, only B succeeded; and the variance of the progress difference B - A
  var a = 0, b = 0, d = 0, d2 = 0, n = pairs.length, i;
  for (i = 0; i < n; i++) { var x = pairs[i][0], y = pairs[i][1]; if (x.s && !y.s) a++; else if (y.s && !x.s) b++; var df = y.g - x.g; d += df; d2 += df * df; }
  var dm = d / n;
  return { aOnly: a / n, bOnly: b / n, psi: (a + b) / n, delta: (b - a) / n, dvar: (d2 - n * dm * dm) / (n - 1) };
};

/* ───────────── the binomial machinery ───────────── */
EL.LF = [0]; for (var li = 1; li <= 2200; li++) EL.LF.push(EL.LF[li - 1] + Math.log(li));
function xlogy(x, y) { return x === 0 ? 0 : x * Math.log(y); }
EL.pmf = function (n, p) {
  var o = new Float64Array(n + 1), k;
  for (k = 0; k <= n; k++) o[k] = Math.exp(EL.LF[n] - EL.LF[k] - EL.LF[n - k] + xlogy(k, p) + xlogy(n - k, 1 - p));
  return o;
};
EL.win = function (n, p) { var sd = Math.sqrt(n * p * (1 - p)) + 1, c = n * p; return [Math.max(0, Math.floor(c - 9 * sd)), Math.min(n, Math.ceil(c + 9 * sd))]; };
EL.zTest = function (k1, k2, n) {                  // pooled two-proportion z-test: +1 when arm 2 is significantly higher, -1 when lower, 0 when there is no verdict
  var s = k1 + k2; if (s === 0 || s === 2 * n) return 0;
  var pp = s / (2 * n), z = (k2 - k1) / n / Math.sqrt(pp * (1 - pp) * 2 / n);
  return z > EL.Z ? 1 : z < -EL.Z ? -1 : 0;
};
EL.powerIndep = function (p1, p2, n) {             // exact: every pair of counts (k1, k2), weighted by its binomial probability; arm 2 is the better one
  var w1 = EL.win(n, p1), w2 = EL.win(n, p2), a = EL.pmf(n, p1), b = EL.pmf(n, p2), o = { right: 0, wrong: 0, more: 0, tie: 0, less: 0 }, i, j;
  for (i = w1[0]; i <= w1[1]; i++) for (j = w2[0]; j <= w2[1]; j++) {
    var w = a[i] * b[j], v = EL.zTest(i, j, n);
    if (v > 0) o.right += w; else if (v < 0) o.wrong += w;
    if (j > i) o.more += w; else if (j === i) o.tie += w; else o.less += w;
  }
  return o;
};
EL.CRIT = {};
EL.mcCrit = function (m) {                         // largest j with 2 P(Binomial(m, 1/2) <= j) <= 0.05, or -1: the exact McNemar rejection region
  if (EL.CRIT[m] !== undefined) return EL.CRIT[m];
  var cum = 0, j = -1, k;
  for (k = 0; k <= m; k++) { cum += Math.exp(EL.LF[m] - EL.LF[k] - EL.LF[m - k] - m * Math.LN2); if (2 * cum <= 0.05) j = k; else break; }
  return (EL.CRIT[m] = j);
};
EL.powerPaired = function (pb, pa, n) {            // exact McNemar over the trinomial (b: only the better arm succeeded, c: only the worse one)
  var r = 1 - pb - pa, wb = EL.win(n, pb), wc = EL.win(n, pa), o = { right: 0, wrong: 0, more: 0, tie: 0, less: 0 }, b, c;
  for (b = wb[0]; b <= wb[1]; b++) for (c = wc[0]; c <= wc[1] && b + c <= n; c++) {
    var w = Math.exp(EL.LF[n] - EL.LF[b] - EL.LF[c] - EL.LF[n - b - c] + xlogy(b, pb) + xlogy(c, pa) + xlogy(n - b - c, r));
    if (b !== c && Math.min(b, c) <= EL.mcCrit(b + c)) { if (b > c) o.right += w; else o.wrong += w; }
    if (b > c) o.more += w; else if (b === c) o.tie += w; else o.less += w;
  }
  return o;
};

/* ───────────── sizes ───────────── */
EL.nIndep = function (p1, p2) { var pb = (p1 + p2) / 2; return Math.ceil(2 * Math.pow(EL.Z + EL.ZB, 2) * pb * (1 - pb) / Math.pow(p2 - p1, 2)); };
EL.nPaired = function (psi, delta) { return Math.ceil(Math.pow(EL.Z * Math.sqrt(psi) + EL.ZB * Math.sqrt(psi - delta * delta), 2) / (delta * delta)); };
EL.nMeans = function (delta, v) { return Math.ceil(Math.pow(EL.Z + EL.ZB, 2) * v / (delta * delta)); };
EL.mdd = function (n, pbar) { return (EL.Z + EL.ZB) * Math.sqrt(2 * pbar * (1 - pbar) / n); };
EL.wilsonWidth = function (p, n) { var z2 = EL.Z * EL.Z; return 2 * EL.Z * Math.sqrt(p * (1 - p) / n + z2 / (4 * n * n)) / (1 + z2 / n); };
EL.hours = function (n, minutes) { return 2 * n * minutes / 60; };

/* ───────────── one design: two checkpoints, a pairing, a metric ───────────── */
/* d = { A: trials of the previous checkpoint, B: trials of the new one, mode: 'indep' | 'start' | 'same', metric: 'succ' | 'prog' }
 * prep(d) adds what the design needs: the pool statistics, the pairs and their cells, and which arm is truly better under the metric. */
EL.prep = function (d) {
  d.sa = EL.stats(d.A); d.sb = EL.stats(d.B);
  d.pairs = d.mode === 'indep' ? null : EL.pairs(d.A, d.B, d.mode);
  d.c = d.pairs ? EL.cells(d.pairs) : null;
  if (d.metric === 'succ') { d.va = d.sa.p; d.vb = d.sb.p; } else { d.va = d.sa.gm; d.vb = d.sb.gm; }
  d.better = d.vb >= d.va ? 'B' : 'A';
  d.delta = Math.abs(d.vb - d.va);
  return d;
};
EL.power = function (d, n) {                       // verdict probabilities of one evaluation of n trials (n pairs when paired), exact: success only
  if (d.pairs) return EL.powerPaired(d.c.bOnly, d.c.aOnly, n);
  return EL.powerIndep(d.sa.p, d.sb.p, n);
};
EL.sizeFor = function (d) {                        // trials per checkpoint for 80 % power, by the closed forms (none for a paired progress score: its differences are far from normal)
  if (d.metric === 'succ') return d.pairs ? EL.nPaired(d.c.psi, d.c.delta) : EL.nIndep(d.sa.p, d.sb.p);
  return d.pairs ? null : EL.nMeans(d.delta, d.sa.gvar + d.sb.gvar);
};
EL.MC_R = 1000; EL.MC_SEED = 61000;
EL.curve = function (d) {                          // verdict probabilities at every size of the grid: exact for success, by resampling for progress
  return d.metric === 'succ' ? EL.GRID.map(function (n) { return EL.power(d, n); }) : EL.mcCurve(d, EL.MC_R, EL.MC_SEED);
};

/* what one evaluation concludes from the running sums of its trials (n per checkpoint, or n pairs):
 * S = { k1, k2 successes of each arm; b, c pairs where only the second / only the first succeeded; m1, m2, q1, q2 sums and sums of squares of progress; dd, d2 sum and sum of squares of the progress difference }
 * returns +1 when the second checkpoint is declared better, -1 when the first is, 0 when there is no verdict */
EL.said = function (d, n, S) {
  if (d.metric === 'succ') {
    if (d.pairs) return S.b !== S.c && Math.min(S.b, S.c) <= EL.mcCrit(S.b + S.c) ? (S.b > S.c ? 1 : -1) : 0;
    return EL.zTest(S.k1, S.k2, n);
  }
  var se, nn = Math.max(1, n - 1);
  if (d.pairs) se = Math.sqrt(Math.max(0, (S.d2 - S.dd * S.dd / n) / nn) / n);
  else se = Math.sqrt(Math.max(0, (S.q1 - S.m1 * S.m1 / n) / nn) / n + Math.max(0, (S.q2 - S.m2 * S.m2 / n) / nn) / n);
  var z = se > 0 ? (S.m2 - S.m1) / n / se : 0;
  return z > EL.Z ? 1 : z < -EL.Z ? -1 : 0;
};
EL.zero = function () { return { k1: 0, k2: 0, b: 0, c: 0, m1: 0, m2: 0, q1: 0, q2: 0, dd: 0, d2: 0 }; };
EL.add = function (d, S, rg) {                     // one more trial per checkpoint (one more pair), drawn from the pool by stream rg
  var x, y;
  if (d.pairs) { var pr = d.pairs[Math.floor(rg() * d.pairs.length)]; x = pr[0]; y = pr[1]; }
  else { x = d.A[Math.floor(rg() * EL.K)]; y = d.B[Math.floor(rg() * EL.K)]; }
  S.k1 += x.s; S.k2 += y.s; S.m1 += x.g; S.m2 += y.g; S.q1 += x.g * x.g; S.q2 += y.g * y.g;
  if (y.s && !x.s) S.b++; else if (x.s && !y.s) S.c++;
  S.dd += y.g - x.g; S.d2 += (y.g - x.g) * (y.g - x.g);
};
/* an evaluation of n trials per checkpoint: what it shows (an estimate and a 95 % interval per arm) and what it concludes */
EL.evaluate = function (d, n, rg) {
  var S = EL.zero(), t, o = { n: n }, s1, s2, r = Math.sqrt(n);
  for (t = 0; t < n; t++) EL.add(d, S, rg);
  if (d.metric === 'succ') { o.e1 = S.k1 / n; o.e2 = S.k2 / n; o.ci1 = BN.stats.wilson(S.k1, n); o.ci2 = BN.stats.wilson(S.k2, n); }
  else {
    s1 = Math.sqrt(Math.max(0, (S.q1 - S.m1 * S.m1 / n) / Math.max(1, n - 1))); s2 = Math.sqrt(Math.max(0, (S.q2 - S.m2 * S.m2 / n) / Math.max(1, n - 1)));
    o.e1 = S.m1 / n; o.e2 = S.m2 / n;
    o.ci1 = [Math.max(0, o.e1 - EL.Z * s1 / r), Math.min(1, o.e1 + EL.Z * s1 / r)]; o.ci2 = [Math.max(0, o.e2 - EL.Z * s2 / r), Math.min(1, o.e2 + EL.Z * s2 / r)];
  }
  o.said = EL.said(d, n, S);
  o.verdict = o.said === 0 ? 0 : (o.said > 0) === (d.better === 'B') ? 1 : -1;     // +1: the truly better one is declared better, -1: the worse one is
  return o;
};
/* power by resampling, for the progress metric: R evaluations of the largest size, each read off at every size of the grid (nested draws) */
EL.mcCurve = function (d, R, seed) {
  var top = EL.GRID[EL.GRID.length - 1], out = EL.GRID.map(function () { return { right: 0, wrong: 0, more: 0, tie: 0, less: 0 }; }), r, t, g, S, rg;
  for (r = 0; r < R; r++) {
    S = EL.zero(); rg = BN.rng(seed + r); g = 0;
    for (t = 1; t <= top; t++) {
      EL.add(d, S, rg);
      if (t === EL.GRID[g]) {
        var v = EL.said(d, t, S), good = (v > 0) === (d.better === 'B'), o = out[g];
        if (v !== 0) { if (good) o.right++; else o.wrong++; }
        var higher = (S.m2 > S.m1) === (d.better === 'B');
        if (S.m2 === S.m1) o.tie++; else if (higher) o.more++; else o.less++;
        g++;
      }
    }
  }
  return out.map(function (o) { return { right: o.right / R, wrong: o.wrong / R, more: o.more / R, tie: o.tie / R, less: o.less / R }; });
};

/* ───────────── the three panels of the widget ───────────── */
var PCT = function (v) { return (v * 100).toFixed(0); };
/* BN.draw.setup with a lower width floor (200 px instead of 280), so that a canvas on a 320 px phone is drawn at the width it is shown at */
EL.setup = function (canvas) {
  var dpr = Math.min((typeof window !== 'undefined' && window.devicePixelRatio) || 1, 3);
  var w = Math.max(200, canvas.clientWidth || 640), h = Math.max(120, canvas.clientHeight || 300), rw = Math.round(w * dpr), rh = Math.round(h * dpr);
  if (canvas.width !== rw || canvas.height !== rh) { canvas.width = rw; canvas.height = rh; }
  var ctx = canvas.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, w, h); ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.__w = w;
  return { ctx: ctx, w: w, h: h };
};
/* text that fits: a panel chooses between a long and a short wording by measuring them in the font it will draw them in */
var SANS = function (z) { return '500 ' + z + 'px -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, sans-serif'; };
var MONO = function (z) { return z + 'px "SF Mono", Menlo, Consolas, monospace'; };
EL.tw = function (ctx, s, size, mono) { ctx.font = (mono ? MONO : SANS)(size); return ctx.measureText(s).width; };
EL.fit = function (ctx, variants, size, room, mono) {          // the first wording that fits in `room` pixels at `size`; failing that the last one, shrunk
  var i, last = variants[variants.length - 1], w;
  for (i = 0; i < variants.length; i++) if (EL.tw(ctx, variants[i], size, mono) <= room) return { s: variants[i], size: size };
  w = EL.tw(ctx, last, size, mono);
  return { s: last, size: Math.max(size * 0.75, size * room / w * 0.97) };
};
/* a row of legend entries from x, centred on y.  entry = {col, dash, dot, sq, labels: [long … short]}; the most generous wording of all of them that fits in `room` is drawn */
EL.legend = function (ctx, x, y, room, entries, size) {
  var D = BN.draw, C = BN.C, GAP = 14, sw = function (e) { return e.sq ? 8 : 16; }, levels = Math.max.apply(null, entries.map(function (e) { return e.labels.length; })), k, ws, tot;
  var lab = function (e, k) { return e.labels[Math.min(k, e.labels.length - 1)]; };
  for (k = 0; k < levels; k++) {
    ws = entries.map(function (e) { return EL.tw(ctx, lab(e, k), size); });
    tot = GAP * (entries.length - 1); entries.forEach(function (e, i) { tot += sw(e) + 4 + ws[i]; });
    if (tot <= room) break;
  }
  k = Math.min(k, levels - 1);
  entries.forEach(function (e, i) {
    if (e.sq) { ctx.fillStyle = e.col; ctx.fillRect(x, y - 4, 8, 8); }
    else { D.line(ctx, x, y, x + 16, y, e.col, e.dash ? 1.5 : 2, e.dash); if (e.dot) D.dot(ctx, x + 8, y, 2.5, e.col); }
    D.text(ctx, lab(e, k), x + sw(e) + 4, y, C.mute, size);
    x += sw(e) + 4 + ws[i] + GAP;
  });
};
/* B = {x, y, w, h}.  rows: evaluations from EL.evaluate; truth = {a, b}: the pool's value of each checkpoint under the metric; o = {n} */
EL.drawRows = function (ctx, B, rows, truth, o) {
  var D = BN.draw, C = BN.C, x0 = B.x + 12, x1 = B.x + B.w - 26, y0 = B.y + 40, y1 = B.y + B.h - 32, nr = rows.length, rh = (y1 - y0) / nr, room = B.w - 16, i, r;
  var X = function (v) { return x0 + v * (x1 - x0); }, col = [C.cyan, C.amber], v1 = function (v) { return (v * 100).toFixed(1); };
  D.frame(ctx, B.x, B.y, B.w, B.h, C.white);
  var t = EL.fit(ctx, [nr + ' evaluations of ' + o.n + ' trials per checkpoint, 95 % intervals', nr + ' evaluations of ' + o.n + ' trials each, 95 % intervals', nr + ' evaluations, ' + o.n + ' trials each'], 11, room);
  D.text(ctx, t.s, B.x + 8, B.y + 13, C.mute, t.size);
  EL.legend(ctx, B.x + 8, B.y + 27, room, [{ col: col[0], dash: [4, 3], labels: ['previous: true value ' + v1(truth.a) + ' %', 'previous ' + v1(truth.a)] },
    { col: col[1], dash: [4, 3], labels: ['new: true value ' + v1(truth.b) + ' %', 'new ' + v1(truth.b)] }], 10);
  for (i = 0; i <= 4; i++) { D.line(ctx, X(i / 4), y0, X(i / 4), y1, C.grid, 1); D.mono(ctx, PCT(i / 4) + '%', X(i / 4), y1 + 9, C.mute, 10, 'center'); }
  [[truth.a, 0], [truth.b, 1]].forEach(function (q) { D.line(ctx, X(q[0]), y0 - 3, X(q[0]), y1, col[q[1]], 1.5, [4, 3]); });
  for (r = 0; r < nr; r++) {
    var cy = y0 + (r + 0.5) * rh, e = rows[r], off = Math.min(2.4, rh * 0.22);
    [[e.ci1, e.e1, -off, 0], [e.ci2, e.e2, off, 1]].forEach(function (a) {
      D.line(ctx, X(a[0][0]), cy + a[2], X(a[0][1]), cy + a[2], col[a[3]], 2); D.dot(ctx, X(a[1]), cy + a[2], 2.2, col[a[3]]);
    });
    ctx.fillStyle = e.verdict > 0 ? C.green : e.verdict < 0 ? C.red : C.dim; var sq = Math.max(3, Math.min(8, rh - 1.5)); ctx.fillRect(x1 + 10, cy - sq / 2, sq, sq);
  }
  EL.legend(ctx, B.x + 8, B.y + B.h - 10, room, [{ col: C.green, sq: 1, labels: ['right verdict', 'right'] }, { col: C.dim, sq: 1, labels: ['no verdict', 'none'] }, { col: C.red, sq: 1, labels: ['wrong verdict', 'wrong'] }], 10);
};
/* the chance of the right verdict (teal) and of the higher count belonging to the better checkpoint (dashed) against n, with the current n and the n for 80 % power marked */
EL.drawCurve = function (ctx, B, curve, ni, n80) {
  var D = BN.draw, C = BN.C, xs = EL.GRID, n = xs[ni], c = curve[ni], by = B.y + 22, bh = B.h - 54;
  var P = D.plot(ctx, [{ xs: [5, 1000], ys: [0.8, 0.8], color: C.green, width: 1, dash: [2, 3] }, { xs: xs, ys: curve.map(function (q) { return q.more; }), color: C.dim, width: 1.5, dash: [4, 4] },
    { xs: xs, ys: curve.map(function (q) { return q.right; }), color: C.teal, width: 2, dots: true, r: 2.5 }], B.x + 34, by, B.w - 48, bh,
    { logx: true, xmin: 5, xmax: 1000, ymin: 0, ymax: 1, xticks: B.w < 290 ? [5, 20, 100, 500] : [5, 10, 20, 50, 100, 200, 500, 1000], yticks: [0, 0.25, 0.5, 0.75, 1], fmty: function (t) { return PCT(t) + '%'; }, xlabel: 'trials per checkpoint, n' });
  EL.legend(ctx, B.x + 6, B.y + 10, B.w - 12, [{ col: C.teal, dot: 1, labels: ['chance of the right verdict', 'right verdict', 'right'] },
    { col: C.dim, dash: [4, 4], labels: ['chance the higher count is the better one\u2019s', 'higher count is right', 'higher count right', 'higher count'] }], 10);
  D.mono(ctx, '80 %', B.x + 40, P.Y(0.8) - 7, C.green, 10, 'left');
  if (n80 && n80 <= 1000) {
    var xn = P.X(Math.max(5, n80)), lab = 'n for 80 % = ' + n80, right = n80 > 200 || xn + 4 + EL.tw(ctx, lab, 10, true) > B.x + B.w - 6;
    D.line(ctx, xn, by, xn, by + bh, C.green, 1, [3, 3]); D.mono(ctx, lab, xn + (right ? -4 : 4), by + bh - 9, C.green, 10, right ? 'right' : 'left');
  }
  D.line(ctx, P.X(n), by, P.X(n), by + bh, C.amber, 1.5); D.dot(ctx, P.X(n), P.Y(c.right), 5, C.amber);
};
/* robot-hours of the evaluation and of the training behind the two checkpoints, on a log axis, with one robot-week marked */
EL.drawPrice = function (ctx, B, evalH, trainH) {
  var D = BN.draw, C = BN.C, x0 = B.x + 12, w = B.w - 28, lo = Math.log(0.5), hi = Math.log(1000), right = B.x + B.w - 6;
  var X = function (h) { return x0 + (Math.log(Math.max(h, 0.5)) - lo) / (hi - lo) * w; }, fmt = function (h) { return h < 10 ? h.toFixed(1) : h.toFixed(0); };
  D.frame(ctx, B.x, B.y, B.w, B.h, C.white);
  var t = EL.fit(ctx, ['robot time of one comparison, hours (log scale)', 'robot-hours per comparison (log scale)', 'robot-hours (log scale)'], 11, B.w - 16);
  D.text(ctx, t.s, B.x + 8, B.y + 14, C.mute, t.size);
  [1, 10, 100, 1000].forEach(function (h) { D.line(ctx, X(h), B.y + 28, X(h), B.y + B.h - 22, C.grid, 1); D.mono(ctx, String(h), X(h), B.y + B.h - 12, C.mute, 10, 'center'); });
  var wk = X(EL.WEEK), fits = wk + 4 + EL.tw(ctx, 'one robot-week', 10, true) <= right;
  D.line(ctx, wk, B.y + 28, wk, B.y + B.h - 22, C.green, 1.5, [4, 3]); D.mono(ctx, 'one robot-week', wk + (fits ? 4 : -4), B.y + B.h - 30, C.green, 10, fits ? 'left' : 'right');
  var bh = Math.max(12, Math.min(22, (B.h - 80) / 3));
  [[evalH, C.amber, 'evaluation, ' + fmt(evalH) + ' h', B.y + 36], [trainH, C.cyan, 'training runs, ' + fmt(trainH) + ' h', B.y + 36 + bh + 12]].forEach(function (b) {
    var xe = X(b[0]), lw = EL.tw(ctx, b[2], 10, true), after = xe + 6 + lw <= right;
    ctx.fillStyle = b[1]; ctx.fillRect(x0, b[3], Math.max(2, xe - x0), bh);
    D.mono(ctx, b[2], after ? xe + 6 : Math.max(x0 + lw + 4, xe - 6), b[3] + bh / 2, C.ink, 10, after ? 'left' : 'right');
  });
};

root.EL = EL;
if (typeof module !== 'undefined' && module.exports) module.exports = EL;
})(typeof window !== 'undefined' ? window : globalThis);
