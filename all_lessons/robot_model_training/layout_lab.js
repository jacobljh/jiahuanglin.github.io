/* layout_lab.js — lesson 7's private engine: how many layouts does a policy need?
 *
 * The policy is lesson 6's: a table of stored demonstrations, chunks of 16 absolute joint targets, a stiff tracker u = K (target - q) clipped at 1.5 rad/s, on the worn arm
 * (gain 0.85, gust 0.08 rad/s).  What is new is the layout theta = (shift s in m, tilt t in m per m) of the row of posts, and a policy that has been shown N different layouts,
 * each demonstrated m times by the expert (calm demonstrations, start jitter 1 cm).  On a new layout the policy copies the demonstrated layout nearest to it, with
 *     dist(a, b) = |a.s - b.s| + 0.4 |a.t - b.t|     (how far the farthest post moves: the end posts are 0.4 m from the middle of the row),
 * and inside that layout does what lesson 6 did: the stored frame nearest to the arm in joint space, then the 16 poses that followed it, tracked.
 *
 * Experiment.  Box of layouts: shift +-10 cm, tilt +-0.2 (d = 2) or shift only with tilt 0 (d = 1).  Draw g (0..63) is a sequence of 256 layouts uniform in the box, from BN.rng(1000 + g),
 * two numbers per layout (s then t); a set of N layouts is the first N of the sequence, so sets are nested in N.  Test layouts are the centres of a grid (100 cells for d = 1, 20 x 16 for d = 2);
 * test cell c is rolled out once with the generator BN.rng(30000 + c): the first draw is the start jitter (1 cm), then two gust draws per step (joint 1, joint 2).  Success = the cup reaches 2 cm
 * short of the end of the course without touching a post, within the horizon.  The outcome of cell c when it copies layout j depends only on (c, j, m), so the whole curve over N costs about
 * ln N rollouts per cell (the nearest layout changes that often).  Demonstration r of layout j in draw g: the expert's calm run (BN.rollout, BN.expertPolicy) from a start jittered with the
 * generator BN.rng(16 seed + r + 1), seed = (64 d + g) 256 + j.
 *
 * Speed.  The validator runs pages inside a vm context, where every lookup of a global (Math, BN) is slow, so the hot paths below use local copies of Math functions, a copy of BN.rng and BN.randn,
 * and a copy of the expert (BN.slalom.expertAct); all of them do the same arithmetic in the same order, and the lesson's oracle checks it: its own demonstrations (BN.rollout) are the same
 * numbers to the last bit, and its success counts equal this engine's.
 */
(function (root) {
'use strict';
var BN = root.BN || require('./bench.js');
var LL = {};
var cos = Math.cos, sin = Math.sin, sqrt = Math.sqrt, log = Math.log, imul = Math.imul, hypot = Math.hypot, abs = Math.abs, pow = Math.pow, max = Math.max, min = Math.min, PI = Math.PI;
var DT = 0.05, VMAX = 1.5, CONTACT = 0.05, SW = BN.slalom.W, R5 = SW.postR + SW.grip;
LL.JIT = 0.01; LL.NPOSTS = 5; LL.H = 16; LL.K = 20; LL.GAIN = 0.85; LL.GUST = 0.08;
LL.BOX = { s: 0.10, t: 0.20 }; LL.LEVER = 0.4; LL.NMAX = 256; LL.NDRAW = 64; LL.MMAX = 8;
LL.PRICE = { demo: 9.3, reset: 20, layout: 120 };                       // seconds: one demonstration, putting the cup back after it, rebuilding the row for a new layout

function rng(seed) {                                                    // the generator of BN.rng
  var a = (seed >>> 0) || 1;
  return function () { a = (a + 0x6D2B79F5) >>> 0; var t = a; t = imul(t ^ (t >>> 15), t | 1); t ^= t + imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
function randn(r) { var u = 0; while (u === 0) u = r(); return sqrt(-2 * log(u)) * cos(2 * PI * r()); }
function yref(w, x) {                                                   // the expert's path, as BN.slalom.yref
  var v = w.via, n = w.n, xf = v[1][0], xl = v[n][0], t, j = 1;
  if (x <= xf) { t = max(0, (x - v[0][0]) / (xf - v[0][0])); return v[0][1] + (v[1][1] - v[0][1]) * sin(PI * t / 2); }
  if (x >= xl) { t = min(1, (x - xl) / (v[n + 1][0] - xl)); return v[n + 1][1] + (v[n][1] - v[n + 1][1]) * cos(PI * t / 2); }
  while (j < n && x > v[j + 1][0]) j++;
  t = (x - v[j][0]) / (v[j + 1][0] - v[j][0]);
  return v[j][1] + (v[j + 1][1] - v[j][1]) * (1 - cos(PI * t)) / 2;
}
function expertAct(w, q) {                                              // the expert, as BN.slalom.expertAct: a carrot 6 cm ahead on its path, damped least squares
  var b = w.body, p0 = b.L1 * cos(q[0]) + b.L2 * cos(q[0] + q[1]), p1 = b.L1 * sin(q[0]) + b.L2 * sin(q[0] + q[1]), xa = min(w.xe, p0 + SW.look), ty = yref(w, xa);
  var v0 = xa - p0, v1 = ty - p1, d = hypot(v0, v1) || 1e-9, sp = SW.speed * min(1, max(0, (w.xe - p0) / 0.06 + 0.1)), a0 = v0 / d * sp, a1 = v1 / d * sp;
  var s1 = sin(q[0]), c1 = cos(q[0]), s12 = sin(q[0] + q[1]), c12 = cos(q[0] + q[1]), ja = -b.L1 * s1 - b.L2 * s12, jb = -b.L2 * s12, jc = b.L1 * c1 + b.L2 * c12, jd = b.L2 * c12;
  var m00 = ja * ja + jb * jb + 1e-4, m01 = ja * jc + jb * jd, m11 = jc * jc + jd * jd + 1e-4, det = m00 * m11 - m01 * m01, w0 = (m11 * a0 - m01 * a1) / det, w1 = (-m01 * a0 + m00 * a1) / det;
  return [ja * w0 + jc * w1, jb * w0 + jd * w1];
}

LL.world = function (th) {
  var w = BN.slalom.world(LL.NPOSTS, { shift: th[0], tilt: th[1] });
  w.T = BN.slalom.horizon(w); w.xe = BN.slalom.xEnd(w); w.xr = w.xe - 0.02;
  return w;
};
LL.dist = function (a, b) { return abs(a[0] - b[0]) + LL.LEVER * abs(a[1] - b[1]); };
LL.layouts = function (d, g) {                                          // 256 layouts, uniform in the box (d = 1: tilt 0), nested in N
  var r = rng(1000 + g), out = [], i, s, t;
  for (i = 0; i < LL.NMAX; i++) { s = (2 * r() - 1) * LL.BOX.s; t = (2 * r() - 1) * LL.BOX.t; out.push([s, d === 1 ? 0 : t]); }
  return out;
};
LL.cells = function (d) {                                               // the test layouts: centres of a grid over the box
  var th = [], ns = d === 1 ? 100 : 20, nt = d === 1 ? 1 : 16, a, b;
  for (b = 0; b < nt; b++) for (a = 0; a < ns; a++) th.push([-LL.BOX.s + (a + 0.5) * 2 * LL.BOX.s / ns, d === 1 ? 0 : -LL.BOX.t + (b + 0.5) * 2 * LL.BOX.t / nt]);
  return { d: d, ns: ns, nt: nt, th: th, n: th.length, w: [] };
};
LL.price = function (N, m) { return N * (LL.PRICE.layout + m * (LL.PRICE.demo + LL.PRICE.reset)); };     // operator seconds

/* the table of one demonstrated layout: stored joint states of m calm demonstrations; demonstration r has its own generator, so a table of m is a prefix of a table of m + 1 */
LL.table = function (th, seed) { return { th: th, seed: seed, w: LL.world(th), m: 0, S: [], Ls: [], FQ: [], FR: [], FT: [] }; };
LL.addDemos = function (tab, m) {
  var w = tab.w, b = w.body, P = w.posts, t, i;
  while (tab.m < m) {
    var r = tab.m, rg = rng(tab.seed * 16 + r + 1), q = BN.slalom.startQ(w, LL.JIT * randn(rg)).slice(), S = [], px, py, hit, u, u0, u1;
    for (t = 0; t < w.T; t++) {
      px = b.L1 * cos(q[0]) + b.L2 * cos(q[0] + q[1]); py = b.L1 * sin(q[0]) + b.L2 * sin(q[0] + q[1]); S.push(q[0], q[1]);
      hit = false; for (i = 0; i < P.length; i++) if (hypot(px - P[i][0], py - P[i][1]) < R5) hit = true;
      if (hit || px > w.xr) break;
      u = expertAct(w, q); u0 = u[0]; u1 = u[1];
      q[0] += DT * (max(-VMAX, min(VMAX, u0)) * 1 + 0); q[1] += DT * (max(-VMAX, min(VMAX, u1)) * 1 + 0);
    }
    var Ls = S.length / 2;
    tab.S.push(Float64Array.from(S)); tab.Ls.push(Ls);
    for (t = 0; t < Ls - 1; t++) { tab.FQ.push(S[2 * t], S[2 * t + 1]); tab.FR.push(r); tab.FT.push(t); }
    tab.m++;
  }
  return tab;
};
LL.nearestFrame = function (tab, q, m) {                                // the stored frame (of the first m demonstrations) nearest to the arm in joint space
  var best = -1, bd = 1e30, i, n = tab.FR.length, dx, dy, e;
  for (i = 0; i < n; i++) { if (tab.FR[i] >= m) break; dx = tab.FQ[2 * i] - q[0]; dy = tab.FQ[2 * i + 1] - q[1]; e = dx * dx + dy * dy; if (e < bd) { bd = e; best = i; } }
  return best;
};
/* one rollout of the policy "copy this table" on layout th: chunks of 16 stored poses as targets, tracked by the stiff controller.  o: noise (rad/s), jit (m), keep (record the path), w (the world of th) */
LL.run = function (tab, m, th, seed, o) {
  o = o || {};
  var w = o.w || LL.world(th), T = w.T, xr = w.xr, b = w.body, g = LL.GAIN, sg = o.noise === undefined ? LL.GUST : o.noise, K = LL.K, H = LL.H, C2 = CONTACT * CONTACT, P = w.posts;
  var rg = rng(seed), jit = o.jit === undefined ? LL.JIT : o.jit, q = BN.slalom.startQ(w, jit * randn(rg)).slice(), r = 0, t0 = 0, coll = false, done = false, t, j, i, px, py, dx, dy, id, tt, u0, u1;
  var path = o.keep ? [] : null;
  for (t = 0; t < T; t++) {
    px = b.L1 * cos(q[0]) + b.L2 * cos(q[0] + q[1]); py = b.L1 * sin(q[0]) + b.L2 * sin(q[0] + q[1]);
    if (path) path.push([px, py]);
    for (i = 0; i < P.length; i++) { dx = px - P[i][0]; dy = py - P[i][1]; if (dx * dx + dy * dy < C2) { coll = true; break; } }
    if (px > xr) { done = true; break; }
    j = t % H;
    if (j === 0) { id = LL.nearestFrame(tab, q, m); r = tab.FR[id]; t0 = tab.FT[id]; }
    tt = min(t0 + j + 1, tab.Ls[r] - 1);
    u0 = K * (tab.S[r][2 * tt] - q[0]); u1 = K * (tab.S[r][2 * tt + 1] - q[1]);
    q[0] += DT * (max(-VMAX, min(VMAX, u0)) * g + sg * randn(rg));
    q[1] += DT * (max(-VMAX, min(VMAX, u1)) * g + sg * randn(rg));
  }
  return { ok: done && !coll, coll: coll, done: done, path: path, steps: t };
};

/* a draw of layouts against a grid of test layouts: the outcome of every test cell for every N, m, filled in lazily and cached */
LL.Draw = function (d, g, cells) {
  var n = cells.n, c, j, best, dd, R;
  this.d = d; this.g = g; this.cells = cells; this.th = LL.layouts(d, g); this.tabs = []; this.okm = {}; this.rec = [];
  for (c = 0; c < n; c++) {                                             // layout indices that were, at their turn, the nearest so far to cell c
    R = []; best = 1e9;
    for (j = 0; j < LL.NMAX; j++) { dd = LL.dist(this.th[j], cells.th[c]); if (dd < best) { best = dd; R.push(j); } }
    this.rec.push(R);
  }
};
LL.Draw.prototype.table = function (j, m) { var tab = this.tabs[j] || (this.tabs[j] = LL.table(this.th[j], (64 * this.d + this.g) * 256 + j)); return LL.addDemos(tab, m); };
LL.Draw.prototype.outcome = function (c, j, m) {                        // does test cell c succeed when it copies layout j (m demonstrations)?
  var a = this.okm[m] || (this.okm[m] = new Int8Array(this.cells.n * LL.NMAX).fill(-1)), id = c * LL.NMAX + j, cw = this.cells.w;
  if (a[id] < 0) a[id] = LL.run(this.table(j, m), m, this.cells.th[c], 30000 + c, { w: cw[c] || (cw[c] = LL.world(this.cells.th[c])) }).ok ? 1 : 0;
  return a[id];
};
LL.Draw.prototype.at = function (N, m) {                                // every test cell, with the first N layouts demonstrated m times each
  var n = this.cells.n, ok = new Uint8Array(n), near = new Int16Array(n), dist = new Float64Array(n), c, i, k, R, s = 0, e = 0;
  for (c = 0; c < n; c++) {
    R = this.rec[c]; i = 0; while (i + 1 < R.length && R[i + 1] < N) i++;
    k = R[i]; near[c] = k; dist[c] = LL.dist(this.th[k], this.cells.th[c]); ok[c] = this.outcome(c, k, m); s += ok[c]; e += dist[c];
  }
  return { N: N, m: m, ok: ok, near: near, dist: dist, succ: s / n, err: e / n };
};
LL.Draw.prototype.curve = function (m) {                                // success and error for every N = 1..256 at once (index N): the nearest layout of a cell changes only about ln N times
  var n = this.cells.n, ptr = new Int16Array(n), succ = new Float64Array(LL.NMAX + 1), err = new Float64Array(LL.NMAX + 1), N, c, R, k, s, e;
  for (N = 1; N <= LL.NMAX; N++) {
    s = 0; e = 0;
    for (c = 0; c < n; c++) {
      R = this.rec[c]; while (ptr[c] + 1 < R.length && R[ptr[c] + 1] < N) ptr[c]++;
      k = R[ptr[c]]; s += this.outcome(c, k, m); e += LL.dist(this.th[k], this.cells.th[c]);
    }
    succ[N] = s / n; err[N] = e / n;
  }
  return { succ: succ, err: err };
};

/* what one demonstrated layout buys: one demonstration at the middle of the box, probed on a fine lattice of offsets (3 gust seeds each, 6 for d = 1); the footprint is the set where it succeeds in at least half of them */
LL.footprint = function (d) {
  var tab = LL.addDemos(LL.table([0, 0], 777), 1), ds = d === 1 ? 0.001 : 0.0025, dt = 0.01, ms = Math.round(0.04 / ds), mt = d === 1 ? 0 : 12, ns = d === 1 ? 6 : 3, F = [], a, b, k, hits, th;
  for (a = -ms; a <= ms; a++) for (b = -mt; b <= mt; b++) {
    th = [a * ds, b * dt]; hits = 0;
    for (k = 0; k < ns; k++) if (LL.run(tab, 1, th, 55000 + k).ok) hits++;
    if (hits * 2 >= ns) F.push([a * ds, b * dt]);
  }
  var cell = d === 1 ? ds : ds * dt, lo = 1e9, hi = -1e9;
  F.forEach(function (o) { if (o[1] === 0) { lo = Math.min(lo, o[0]); hi = Math.max(hi, o[0]); } });
  return { d: d, F: F, cell: cell, area: F.length * cell, lo: lo, hi: hi, width: hi - lo + ds };
};
/* the coverage a footprint predicts for N layouts drawn uniformly in the box: cell x is served by a layout at x - offset, and that layout lies in the box with probability (area of the footprint inside the box) / V */
LL.predict = function (fp, cells) {
  var V = fp.d === 1 ? 2 * LL.BOX.s : 4 * LL.BOX.s * LL.BOX.t, a = new Float64Array(cells.n), c, i, x, o, cnt;
  for (c = 0; c < cells.n; c++) {
    x = cells.th[c]; cnt = 0;
    for (i = 0; i < fp.F.length; i++) { o = fp.F[i]; if (abs(x[0] - o[0]) <= LL.BOX.s && (fp.d === 1 || abs(x[1] - o[1]) <= LL.BOX.t)) cnt++; }
    a[c] = cnt * fp.cell / V;
  }
  return { a: a, V: V, share: fp.area / V, at: function (N) { var s = 0; for (var k = 0; k < a.length; k++) s += 1 - pow(1 - a[k], N); return s / a.length; } };
};
LL.slope = function (xs, ys) {                                          // least-squares slope of log y against log x
  var n = xs.length, mx = 0, my = 0, sxy = 0, sxx = 0, i;
  for (i = 0; i < n; i++) { mx += log(xs[i]) / n; my += log(ys[i]) / n; }
  for (i = 0; i < n; i++) { sxy += (log(xs[i]) - mx) * (log(ys[i]) - my); sxx += pow(log(xs[i]) - mx, 2); }
  return sxy / sxx;
};
root.LL = LL;
if (typeof module !== 'undefined' && module.exports) module.exports = LL;
})(typeof window !== 'undefined' ? window : globalThis);
