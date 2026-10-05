/* heads_lab.js — lesson 4's private engine: what a policy can output when the right action is not one point.
 *
 * Two operators drive the Bench's slalom: A passes the first post above it (s0 = +1), B below it (s0 = -1); the two routes cross midway between posts.
 * Each operator contributes lesson 3's data: 20 demonstrations, then four rounds of five rollouts of their own current clone, every visited frame
 * labelled by that operator.  A policy is built from the pooled frames, and the five heads differ only in what they do with the frames in reach of a query:
 *   mean       the kernel-weighted mean of their actions (lesson 1's regression: squared error)
 *   sample     draw one of the frames in reach with probability proportional to its kernel weight, and take its action
 *   mixture    K Gaussians fitted to the weighted actions in reach by a few rounds of weighted k-means (EM with the responsibilities rounded), draw a component by its weight, then a point from it
 *   codebook   K prototypes found once by k-means over every stored action; the weights of the frames in reach give a histogram over prototypes; draw a bin, take its prototype
 *   mode       the mean of the heaviest component of the two-component mixture (a deterministic rule on the same distribution)
 * Candidates are always visited in ascending frame order, so that a draw is a function of (the data, the query, one uniform number) and nothing else.
 */
(function (root) {
'use strict';
var BN = root.BN || require('./bench.js');
var HL = {};
HL.H = 0.02;                                   // kernel bandwidth, rad (lesson 1)
HL.SIGMIN = 0.01;                              // smallest spread of a mixture component, rad/s
HL.ITERS = 4;                                  // rounds of weighted k-means per mixture fit
HL.JIT = 0.01; HL.GUST = 0.05; HL.SEED = 5; HL.POLSEED = 1000;
HL.NROLL = 200;
HL.DAGGER = { demos: 20, rounds: 4, per: 5 };  // the data each operator contributes: lesson 3's recipe
HL.SEEDS = { A: 1, B: 2 };

/* ───────────── the operators' data ───────────── */
/* One operator's frames: m calm demonstrations, then `rounds` rounds in which `per` rollouts of the clone built from everything so far (under the gust)
 * are run, every frame they visit is labelled by the operator, and the labelled frames are added.  Returns {q0, q1, a0, a1} as plain arrays. */
HL.collect = function (w, seed, o) {
  o = o || HL.DAGGER;
  var rng = BN.rng(seed), nw = new BN.NW([HL.H, HL.H]), out = { q0: [], q1: [], a0: [], a1: [] }, r, t, k;
  function add(q, a) { nw.add(q, a); out.q0.push(q[0]); out.q1.push(q[1]); out.a0.push(a[0]); out.a1.push(a[1]); }
  BN.demos(w, o.demos, rng, { noise: 0, jit: HL.JIT }).forEach(function (ro) { for (t = 0; t < ro.A.length; t++) add(ro.S[t], ro.A[t]); });
  var clone = function (q) { return nw.predict(q); };
  for (r = 0; r < o.rounds; r++) {
    var batch = [];
    for (k = 0; k < o.per; k++) batch.push(BN.rollout(w, clone, rng, { noise: HL.GUST, jit: HL.JIT }));
    batch.forEach(function (ro) { ro.S.forEach(function (q) { add(q, BN.slalom.expertAct(w, q)); }); });
  }
  return out;
};
/* both operators' data on the n-post course */
HL.operators = function (n, o) {
  var wA = BN.slalom.world(n, { s0: 1 }), wB = BN.slalom.world(n, { s0: -1 });
  return { n: n, wA: wA, wB: wB, A: HL.collect(wA, HL.SEEDS.A, o), B: HL.collect(wB, HL.SEEDS.B, o) };
};

/* ───────────── the store: frames on a grid, candidates in ascending order ───────────── */
var SCRATCH = new Float64Array(1 << 17);
HL.Store = function (ops, rho, h) {            // frames of A (weight 1) and of B (weight rho; none if rho = 0)
  var q0 = [], q1 = [], a0 = [], a1 = [], c = [], op = [], i;
  function put(d, wt, tag) { for (i = 0; i < d.q0.length; i++) { q0.push(d.q0[i]); q1.push(d.q1[i]); a0.push(d.a0[i]); a1.push(d.a1[i]); c.push(wt); op.push(tag); } }
  put(ops.A, 1, 0); if (rho > 0) put(ops.B, rho, 1);
  this.h = h || HL.H; this.n = q0.length; this.q0 = Float64Array.from(q0); this.q1 = Float64Array.from(q1); this.a0 = Float64Array.from(a0); this.a1 = Float64Array.from(a1);
  this.c = Float64Array.from(c); this.op = Uint8Array.from(op); this.ids = new Int32Array(this.n); this.w = new Float64Array(this.n); this.tot = 0; this.m = 0;
  var cell = this.cell = 3 * this.h, lo0 = Infinity, lo1 = Infinity, hi0 = -Infinity, hi1 = -Infinity;
  for (i = 0; i < this.n; i++) { lo0 = Math.min(lo0, this.q0[i]); hi0 = Math.max(hi0, this.q0[i]); lo1 = Math.min(lo1, this.q1[i]); hi1 = Math.max(hi1, this.q1[i]); }
  this.lo0 = lo0 - cell; this.lo1 = lo1 - cell; this.d0 = Math.ceil((hi0 - this.lo0) / cell) + 2; this.d1 = Math.ceil((hi1 - this.lo1) / cell) + 2;
  var cnt = new Int32Array(this.d0 * this.d1 + 1), key = new Int32Array(this.n);
  for (i = 0; i < this.n; i++) { key[i] = Math.floor((this.q0[i] - this.lo0) / cell) * this.d1 + Math.floor((this.q1[i] - this.lo1) / cell); cnt[key[i] + 1]++; }
  for (i = 0; i < this.d0 * this.d1; i++) cnt[i + 1] += cnt[i];
  this.start = cnt; this.item = new Int32Array(this.n); var fill = cnt.slice(0, this.d0 * this.d1);
  for (i = 0; i < this.n; i++) this.item[fill[key[i]]++] = i;
};
var ST = HL.Store.prototype;
/* the frames within three bandwidths of q, ids ascending in this.ids[0..m), kernel weights in this.w[0..m), their sum in this.tot */
ST.near = function (q) {
  var h = this.h, c0 = Math.floor((q[0] - this.lo0) / this.cell), c1 = Math.floor((q[1] - this.lo1) / this.cell), m = 0, i0, i1, p, e, id, dx, dy, d2, k;
  for (i0 = c0 - 1; i0 <= c0 + 1; i0++) {
    if (i0 < 0 || i0 >= this.d0) continue;
    for (i1 = c1 - 1; i1 <= c1 + 1; i1++) {
      if (i1 < 0 || i1 >= this.d1) continue;
      e = this.start[i0 * this.d1 + i1 + 1];
      for (p = this.start[i0 * this.d1 + i1]; p < e; p++) {
        id = this.item[p]; dx = (this.q0[id] - q[0]) / h; dy = (this.q1[id] - q[1]) / h; d2 = dx * dx + dy * dy;
        if (d2 <= 9) { this.ids[m++] = id; SCRATCH[id] = this.c[id] * Math.exp(-0.5 * d2); }
      }
    }
  }
  this.ids.subarray(0, m).sort();
  var tot = 0; for (k = 0; k < m; k++) { this.w[k] = SCRATCH[this.ids[k]]; tot += this.w[k]; }
  this.m = m; this.tot = tot; return m;
};
ST.nearest = function (q) {                    // the single closest stored frame (used when nothing is within reach)
  var best = -1, bd = Infinity, h = this.h, i, dx, dy, d2;
  for (i = 0; i < this.n; i++) { dx = (this.q0[i] - q[0]) / h; dy = (this.q1[i] - q[1]) / h; d2 = dx * dx + dy * dy; if (d2 < bd) { bd = d2; best = i; } }
  return best;
};
ST.far = function (q) { var id = this.nearest(q); return [this.a0[id], this.a1[id]]; };

/* ───────────── the heads ───────────── */
HL.mean = function (S, q) {
  if (S.near(q) === 0 || S.tot < 1e-12) return S.far(q);
  var s0 = 0, s1 = 0, k;
  for (k = 0; k < S.m; k++) { s0 += S.w[k] * S.a0[S.ids[k]]; s1 += S.w[k] * S.a1[S.ids[k]]; }
  return [s0 / S.tot, s1 / S.tot];
};
HL.sample = function (S, q, rng) {
  if (S.near(q) === 0 || S.tot < 1e-12) return S.far(q);
  var u = rng() * S.tot, k = 0;
  while (k < S.m - 1 && u > S.w[k]) { u -= S.w[k]; k++; }
  return [S.a0[S.ids[k]], S.a1[S.ids[k]]];
};
/* K components fitted to the weighted actions in reach: farthest-point start, then HL.ITERS rounds of "assign each action to the nearest centre,
 * move each centre to the weighted mean of its actions"; each component keeps its weight and a spread (rms distance / sqrt 2, at least SIGMIN) */
var MX = { k: 0, pi: new Float64Array(64), m0: new Float64Array(64), m1: new Float64Array(64), sd: new Float64Array(64) };
var G0 = new Float64Array(1 << 14), G1 = new Float64Array(1 << 14), GW = new Float64Array(1 << 14), LAB = new Int32Array(1 << 14);
HL.fit = function (S, K) {
  var n = S.m, k = Math.min(K, n), i, c, it, t, b = 0, d, bd, bi, e, e0, e1, s0, s1, v, tot = S.tot;
  for (i = 0; i < n; i++) { G0[i] = S.a0[S.ids[i]]; G1[i] = S.a1[S.ids[i]]; GW[i] = S.w[i]; if (GW[i] > GW[b]) b = i; }
  MX.m0[0] = G0[b]; MX.m1[0] = G1[b];
  for (c = 1; c < k; c++) {                    // next centre: the action farthest from the centres so far
    bd = -1; bi = 0;
    for (i = 0; i < n; i++) {
      d = Infinity; for (t = 0; t < c; t++) { e0 = G0[i] - MX.m0[t]; e1 = G1[i] - MX.m1[t]; e = e0 * e0 + e1 * e1; if (e < d) d = e; }
      if (d > bd) { bd = d; bi = i; }
    }
    MX.m0[c] = G0[bi]; MX.m1[c] = G1[bi];
  }
  for (it = 0; it < HL.ITERS; it++) {
    for (i = 0; i < n; i++) {
      bd = Infinity; bi = 0;
      for (c = 0; c < k; c++) { e0 = G0[i] - MX.m0[c]; e1 = G1[i] - MX.m1[c]; e = e0 * e0 + e1 * e1; if (e < bd) { bd = e; bi = c; } }
      LAB[i] = bi;
    }
    for (c = 0; c < k; c++) {
      s0 = 0; s1 = 0; MX.pi[c] = 0;
      for (i = 0; i < n; i++) if (LAB[i] === c) { s0 += GW[i] * G0[i]; s1 += GW[i] * G1[i]; MX.pi[c] += GW[i]; }
      if (MX.pi[c] > 0) { MX.m0[c] = s0 / MX.pi[c]; MX.m1[c] = s1 / MX.pi[c]; }
    }
  }
  for (c = 0; c < k; c++) {
    v = 0; for (i = 0; i < n; i++) if (LAB[i] === c) { e0 = G0[i] - MX.m0[c]; e1 = G1[i] - MX.m1[c]; v += GW[i] * (e0 * e0 + e1 * e1); }
    MX.sd[c] = MX.pi[c] > 0 ? Math.max(Math.sqrt(v / (2 * MX.pi[c])), HL.SIGMIN) : HL.SIGMIN; MX.pi[c] /= tot;
  }
  MX.k = k; return MX;
};
HL.mixture = function (S, q, rng, K) {
  if (S.near(q) === 0 || S.tot < 1e-12) return S.far(q);
  var mx = HL.fit(S, K), u = rng(), c = 0;
  while (c < mx.k - 1 && u > mx.pi[c]) { u -= mx.pi[c]; c++; }
  return [mx.m0[c] + mx.sd[c] * BN.randn(rng), mx.m1[c] + mx.sd[c] * BN.randn(rng)];
};
HL.mode = function (S, q) {                    // the centre of the heaviest of two components
  if (S.near(q) === 0 || S.tot < 1e-12) return S.far(q);
  var mx = HL.fit(S, 2), c = 0, j;
  for (j = 1; j < mx.k; j++) if (mx.pi[j] > mx.pi[c]) c = j;
  return [mx.m0[c], mx.m1[c]];
};
/* K prototypes from k-means over the stored actions; bin[i] = the prototype nearest to frame i's action */
HL.codebook = function (S, K) {
  var X = [], i, k, bd, bi, e, d0, d1;
  for (i = 0; i < S.n; i++) X.push([S.a0[i], S.a1[i]]);
  var km = BN.kmeans(X, K, { seed: 3 }), cen = km.centers.map(function (c) { return [c[0], c[1]]; }), bin = new Int32Array(S.n);
  for (i = 0; i < S.n; i++) {
    bd = Infinity; bi = 0;
    for (k = 0; k < K; k++) { d0 = X[i][0] - cen[k][0]; d1 = X[i][1] - cen[k][1]; e = d0 * d0 + d1 * d1; if (e < bd) { bd = e; bi = k; } }
    bin[i] = bi;
  }
  return { K: K, cen: cen, bin: bin };
};
var HIST = new Float64Array(1024);
HL.bins = function (S, q, cb, rng) {
  if (S.near(q) === 0 || S.tot < 1e-12) return S.far(q);
  var k, u; for (k = 0; k < cb.K; k++) HIST[k] = 0;
  for (k = 0; k < S.m; k++) HIST[cb.bin[S.ids[k]]] += S.w[k];
  u = rng() * S.tot; k = 0;
  while (k < cb.K - 1 && u > HIST[k]) { u -= HIST[k]; k++; }
  return cb.cen[k].slice();
};
/* a head as a policy factory for BN.evaluate: head = {kind: 'mean'|'mode'|'sample'|'mixture'|'codebook', K, cb} */
HL.policy = function (S, head) {
  return function (w, k) {
    var rng = BN.rng(HL.POLSEED + k);
    if (head.kind === 'mean') return function (q) { return HL.mean(S, q); };
    if (head.kind === 'sample') return function (q) { return HL.sample(S, q, rng); };
    if (head.kind === 'mixture') return function (q) { return HL.mixture(S, q, rng, head.K); };
    if (head.kind === 'codebook') return function (q) { return HL.bins(S, q, head.cb, rng); };
    return function (q) { return HL.mode(S, q); };
  };
};

/* ───────────── measuring a policy ───────────── */
/* vertical velocity of the cup (m/s) for a joint command u at joint angles q */
HL.vy = function (q, u) { var J = BN.arm.jac(q); return J[2] * u[0] + J[3] * u[1]; };
HL.REV = 0.05;                                 // a reversal: two consecutive commands whose vertical cup velocities are both at least 5 cm/s and of opposite sign
HL.reversals = function (ro) {
  var f = 0, prev = 0, t, v;
  for (t = 0; t < ro.A.length; t++) { v = HL.vy(ro.S[t], ro.A[t]); if (Math.abs(v) >= HL.REV) { if (prev !== 0 && (v > 0) !== (prev > 0)) f++; prev = v; } else prev = 0; }
  return f;
};
/* which side of the first post the cup was on when it reached the post's x (or when it stopped, if it stopped sooner): +1 above, -1 below */
HL.side = function (w, ro) {
  var p0 = w.posts[0], t;
  for (t = 0; t < ro.P.length; t++) if (ro.P[t][0] >= p0[0]) return ro.P[t][1] >= p0[1] ? 1 : -1;
  return ro.P[ro.P.length - 1][1] >= p0[1] ? 1 : -1;
};
/* N rollouts of one head, run a few at a time (BN.evaluate's loop, with the same random stream, keeping only what the readouts need) */
HL.Eval = function (w, S, head, N) {
  this.w = w; this.S = S; this.N = N || HL.NROLL; this.pol = HL.policy(S, head); this.rng = BN.rng(HL.SEED); this.T = BN.slalom.horizon(w);
  this.n = 0; this.ok = 0; this.co = 0; this.up = 0; this.rev = 0; this.keep = [];
};
HL.Eval.prototype.run = function (count) {
  var end = Math.min(this.N, this.n + count), ro, up, rv;
  for (; this.n < end; this.n++) {
    ro = BN.rollout(this.w, this.pol(this.w, this.n), this.rng, { noise: HL.GUST, jit: HL.JIT, T: this.T });
    up = HL.side(this.w, ro) > 0; rv = HL.reversals(ro);
    if (ro.done) this.ok++; if (ro.coll) this.co++; if (up) this.up++; this.rev += rv;
    if (this.keep.length < HL.SHOW) this.keep.push({ P: ro.P, coll: ro.coll, done: ro.done, up: up, rv: rv, vy: this.keep.length < 3 ? ro.A.map(function (u, t) { return HL.vy(ro.S[t], u); }) : null });
  }
  return this.n >= this.N;
};
HL.Eval.prototype.sum = function () {
  var n = Math.max(1, this.n);
  return { n: this.n, succ: this.ok / n, coll: this.co / n, below: 1 - this.up / n, rev: this.rev / n, ci: BN.stats.wilson(this.ok, n), T: this.T };
};
HL.evaluate = function (w, S, head, N) { var ev = new HL.Eval(w, S, head, N); ev.run(ev.N); return ev.sum(); };
HL.SHOW = 14;

/* ───────────── looking at one state ───────────── */
/* cup velocity (m/s) of the joint command a at joint angles q */
HL.cup = function (q, a) { var J = BN.arm.jac(q); return [J[0] * a[0] + J[1] * a[1], J[2] * a[0] + J[3] * a[1]]; };
/* the frames in reach of q, as cup velocities, with the operator that recorded each and the share of the weight each operator holds */
HL.look = function (S, q) {
  var m = S.near(q), out = { m: m, pts: [], wA: 0, wB: 0, vA: [0, 0], vB: [0, 0], mean: [0, 0] }, k, v, w, id;
  for (k = 0; k < m; k++) {
    id = S.ids[k]; w = S.w[k]; v = HL.cup(q, [S.a0[id], S.a1[id]]); out.pts.push({ v: v, op: S.op[id], w: w });
    if (S.op[id] === 0) { out.wA += w; out.vA[0] += w * v[0]; out.vA[1] += w * v[1]; } else { out.wB += w; out.vB[0] += w * v[0]; out.vB[1] += w * v[1]; }
    out.mean[0] += w * v[0]; out.mean[1] += w * v[1];
  }
  var tot = out.wA + out.wB;
  out.shareB = tot > 0 ? out.wB / tot : 0; out.mean = [out.mean[0] / tot, out.mean[1] / tot];
  out.vA = out.wA > 0 ? [out.vA[0] / out.wA, out.vA[1] / out.wA] : null; out.vB = out.wB > 0 ? [out.vB[0] / out.wB, out.vB[1] / out.wB] : null;
  return out;
};
/* n draws of a head at q, as cup velocities (a deterministic head gives one point); a draw whose vertical velocity lies in the middle half of the way
 * between the two operators' mean actions counts as "between the routes", one in the lower quarter as "on B's route" */
HL.draws = function (S, head, q, n, seed) {
  var rng = BN.rng(seed), f = HL.look(S, q), det = head.kind === 'mean' || head.kind === 'mode', m = det ? 1 : n, out = [], between = 0, onB = 0, k, a, v, d;
  for (k = 0; k < m; k++) {
    if (head.kind === 'mean') a = HL.mean(S, q); else if (head.kind === 'mode') a = HL.mode(S, q); else if (head.kind === 'sample') a = HL.sample(S, q, rng);
    else if (head.kind === 'mixture') a = HL.mixture(S, q, rng, head.K); else a = HL.bins(S, q, head.cb, rng);
    v = HL.cup(q, a); out.push(v);
    if (f.vA && f.vB) { d = (v[1] - f.vB[1]) / (f.vA[1] - f.vB[1]); if (d > 0.25 && d < 0.75) between++; else if (d <= 0.25) onB++; }
  }
  return { f: f, pts: out, between: between / m, onB: onB / m };
};
/* the share of the expert's route (by length) at which both operators hold at least a tenth of the kernel weight: the poses where the two routes share a neighbourhood */
HL.shared = function (S, w) {
  var x0 = BN.slalom.xStart(), x1 = BN.slalom.xEnd(w), dx = 0.0025, tot = 0, zone = 0, x, y, py = BN.slalom.yref(w, x0), ds, q, k, a, b;
  for (x = x0 + dx; x <= x1; x += dx) {
    y = BN.slalom.yref(w, x); ds = Math.hypot(dx, y - py); py = y; q = BN.arm.ik([x, y], 1, w.body); S.near(q); a = 0; b = 0;
    for (k = 0; k < S.m; k++) { if (S.op[S.ids[k]] === 0) a += S.w[k]; else b += S.w[k]; }
    tot += ds; if (a + b > 0 && Math.min(a, b) / (a + b) >= 0.1) zone += ds;
  }
  return zone / tot;
};

root.HL = HL;
if (typeof module !== 'undefined' && module.exports) module.exports = HL;
})(typeof window !== 'undefined' ? window : globalThis);
