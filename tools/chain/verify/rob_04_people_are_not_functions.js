#!/usr/bin/env node
'use strict';
/* Oracle for robot_model_training lesson 04 (people are not functions: distributions over actions).
 * Re-derives every number the lesson quotes with code written separately from heads_lab.js: its own rollout loop and plant, a brute-force nearest-demo clone for the
 * operators' corrections, a store searched by a range query on one joint angle (the engine uses a grid), its own five heads (plus the median, which the engine does not
 * have), own k-means assignment, own reversal / side / fork statistics.  Only the world's primitives (arm, expert, collision, path) and BN.kmeans (the codebook's
 * centres) come from bench.js.  Candidates are visited in ascending frame order, as the lesson states, so a draw is a function of the data, the query and one random
 * number.  Then it drives the page's widget and checks that what it prints is what the independent computation gives.  Last stdout line: {"facts": {...}}. */
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '../../../all_lessons');
const dir = fs.existsSync(path.join(root, 'robot_model_training_new')) ? 'robot_model_training_new' : 'robot_model_training';
const BN = require(path.join(root, dir, 'bench.js'));
const { loadPage } = require('../dom_probe.js');

let bad = 0;
const fail = (m) => { bad++; console.error('FAIL ' + m); };
const check = (c, m) => { if (!c) fail(m); };
const F = {};
const fx = (k, v, d) => { F[k] = +(+v).toFixed(d === undefined ? 4 : d); };

/* ───── the plant and a rollout, written out ───── */
const DT = 0.05, JIT = 0.01, GUST = 0.05, PLSEED = 5, POLSEED = 1000, SIGMIN = 0.01, ITERS = 4, REV = 0.05, N = 200, DRAWS = 400, DRAWSEED = 11;
function gaussStep(q, u, noise, rng) {                   // q += dt (clip(u) + noise N(0,1)), command clipped at 1.5 rad/s
  const c = [Math.max(-1.5, Math.min(1.5, u[0])), Math.max(-1.5, Math.min(1.5, u[1]))];
  const n0 = noise ? noise * BN.randn(rng) : 0, n1 = noise ? noise * BN.randn(rng) : 0;
  q[0] += DT * (c[0] + n0); q[1] += DT * (c[1] + n1);
}
function run(w, pi, rng, noise, T) {
  const dy = JIT * BN.randn(rng), q = BN.slalom.startQ(w, dy).slice(), S = [], A = [], P = [], xe = BN.slalom.xEnd(w);
  let coll = false, done = false;
  for (let t = 0; t < T; t++) {
    const p = BN.arm.fk(q, w.body); S.push(q.slice()); P.push(p);
    if (BN.slalom.collide(w, p)) { coll = true; break; }
    if (p[0] > xe - 0.02) { done = true; break; }
    const u = pi(q); A.push(u); gaussStep(q, u, noise, rng);
  }
  return { S, A, P, coll, done };
}

/* ───── an operator's data: lesson 3's recipe, with a brute-force clone ───── */
function bruteMean(D, h) {
  return (q) => {
    let sw = 0, a0 = 0, a1 = 0, best = Infinity, bi = 0;
    for (let i = 0; i < D.X0.length; i++) {
      const dx = (D.X0[i] - q[0]) / h, dy = (D.X1[i] - q[1]) / h, e = dx * dx + dy * dy;
      if (e < best) { best = e; bi = i; }
      if (e <= 9) { const wt = Math.exp(-0.5 * e); sw += wt; a0 += wt * D.Y0[i]; a1 += wt * D.Y1[i]; }
    }
    return sw < 1e-12 ? [D.Y0[bi], D.Y1[bi]] : [a0 / sw, a1 / sw];
  };
}
function collect(w, seed, demos, rounds, per) {
  const rng = BN.rng(seed), T = BN.slalom.horizon(w), D = { X0: [], X1: [], Y0: [], Y1: [] }, expert = (q) => BN.slalom.expertAct(w, q);
  const add = (q, a) => { D.X0.push(q[0]); D.X1.push(q[1]); D.Y0.push(a[0]); D.Y1.push(a[1]); };
  for (let k = 0; k < demos; k++) { const r = run(w, expert, rng, 0, T); for (let t = 0; t < r.A.length; t++) add(r.S[t], r.A[t]); }
  for (let round = 0; round < rounds; round++) {
    const clone = bruteMean(D, 0.02), batch = [];
    for (let k = 0; k < per; k++) batch.push(run(w, clone, rng, GUST, T));
    for (const r of batch) for (const q of r.S) add(q, expert(q));
  }
  return D;
}

/* ───── the pooled frames, searched by a range query on one coordinate ───── */
function makeStore(DA, DB, rho, h) {
  const X0 = [], X1 = [], Y0 = [], Y1 = [], C = [], OP = [];
  const put = (D, wt, tag) => { for (let i = 0; i < D.X0.length; i++) { X0.push(D.X0[i]); X1.push(D.X1[i]); Y0.push(D.Y0[i]); Y1.push(D.Y1[i]); C.push(wt); OP.push(tag); } };
  put(DA, 1, 0); if (rho > 0) put(DB, rho, 1);
  const n = X0.length, order = Array.from({ length: n }, (_, i) => i).sort((a, b) => X0[a] - X0[b] || a - b);
  return { n, h, X0, X1, Y0, Y1, C, OP, sid: Int32Array.from(order), sx: Float64Array.from(order.map((i) => X0[i])) };
}
function reach(S, q) {                                   // frames within three bandwidths of q: ids ascending, kernel weights, their sum
  const h = S.h, lo = q[0] - 3 * h - 1e-9, hi = q[0] + 3 * h + 1e-9;
  let a = 0, b = S.n; while (a < b) { const m = (a + b) >> 1; if (S.sx[m] < lo) a = m + 1; else b = m; }
  const ids = [];
  for (let k = a; k < S.n && S.sx[k] <= hi; k++) { const i = S.sid[k], dx = (S.X0[i] - q[0]) / h, dy = (S.X1[i] - q[1]) / h; if (dx * dx + dy * dy <= 9) ids.push(i); }
  ids.sort((x, y) => x - y);
  const wt = new Array(ids.length); let tot = 0;
  for (let k = 0; k < ids.length; k++) { const i = ids[k], dx = (S.X0[i] - q[0]) / h, dy = (S.X1[i] - q[1]) / h; wt[k] = S.C[i] * Math.exp(-0.5 * (dx * dx + dy * dy)); tot += wt[k]; }
  return { ids, wt, tot };
}
function nearestAction(S, q) {
  let best = Infinity, bi = 0;
  for (let i = 0; i < S.n; i++) { const dx = (S.X0[i] - q[0]) / S.h, dy = (S.X1[i] - q[1]) / S.h, e = dx * dx + dy * dy; if (e < best) { best = e; bi = i; } }
  return [S.Y0[bi], S.Y1[bi]];
}

/* ───── the heads ───── */
function headMean(S, q) {
  const r = reach(S, q); if (!r.ids.length || r.tot < 1e-12) return nearestAction(S, q);
  let s0 = 0, s1 = 0; for (let k = 0; k < r.ids.length; k++) { s0 += r.wt[k] * S.Y0[r.ids[k]]; s1 += r.wt[k] * S.Y1[r.ids[k]]; }
  return [s0 / r.tot, s1 / r.tot];
}
function headSample(S, q, rng) {
  const r = reach(S, q); if (!r.ids.length || r.tot < 1e-12) return nearestAction(S, q);
  let u = rng() * r.tot, k = 0; while (k < r.ids.length - 1 && u > r.wt[k]) { u -= r.wt[k]; k++; }
  return [S.Y0[r.ids[k]], S.Y1[r.ids[k]]];
}
function fitMixture(S, r, K) {                           // K components by farthest-point start and ITERS rounds of weighted k-means; weight, centre, spread each
  const n = r.ids.length, A = r.ids.map((i) => [S.Y0[i], S.Y1[i]]), k = Math.min(K, n), cen = [];
  let b = 0; for (let i = 1; i < n; i++) if (r.wt[i] > r.wt[b]) b = i;
  cen.push([A[b][0], A[b][1]]);
  while (cen.length < k) {                               // the action farthest from the centres chosen so far
    let bd = -1, bi = 0;
    for (let i = 0; i < n; i++) { let d = Infinity; for (const c of cen) { const e = (A[i][0] - c[0]) * (A[i][0] - c[0]) + (A[i][1] - c[1]) * (A[i][1] - c[1]); if (e < d) d = e; } if (d > bd) { bd = d; bi = i; } }
    cen.push([A[bi][0], A[bi][1]]);
  }
  const lab = new Array(n).fill(0), pi = new Array(k).fill(0);
  for (let it = 0; it < ITERS; it++) {
    for (let i = 0; i < n; i++) { let bd = Infinity, bc = 0; for (let c = 0; c < k; c++) { const e = (A[i][0] - cen[c][0]) * (A[i][0] - cen[c][0]) + (A[i][1] - cen[c][1]) * (A[i][1] - cen[c][1]); if (e < bd) { bd = e; bc = c; } } lab[i] = bc; }
    for (let c = 0; c < k; c++) {
      let s0 = 0, s1 = 0, sw = 0; for (let i = 0; i < n; i++) if (lab[i] === c) { s0 += r.wt[i] * A[i][0]; s1 += r.wt[i] * A[i][1]; sw += r.wt[i]; }
      pi[c] = sw; if (sw > 0) cen[c] = [s0 / sw, s1 / sw];
    }
  }
  const sd = new Array(k);
  for (let c = 0; c < k; c++) {
    let v = 0; for (let i = 0; i < n; i++) if (lab[i] === c) v += r.wt[i] * ((A[i][0] - cen[c][0]) * (A[i][0] - cen[c][0]) + (A[i][1] - cen[c][1]) * (A[i][1] - cen[c][1]));
    sd[c] = pi[c] > 0 ? Math.max(Math.sqrt(v / (2 * pi[c])), SIGMIN) : SIGMIN; pi[c] /= r.tot;
  }
  return { k, pi, cen, sd };
}
function headMixture(S, q, rng, K) {
  const r = reach(S, q); if (!r.ids.length || r.tot < 1e-12) return nearestAction(S, q);
  const mx = fitMixture(S, r, K); let u = rng(), c = 0; while (c < mx.k - 1 && u > mx.pi[c]) { u -= mx.pi[c]; c++; }
  return [mx.cen[c][0] + mx.sd[c] * BN.randn(rng), mx.cen[c][1] + mx.sd[c] * BN.randn(rng)];
}
function headMode(S, q) {
  const r = reach(S, q); if (!r.ids.length || r.tot < 1e-12) return nearestAction(S, q);
  const mx = fitMixture(S, r, 2); let c = 0; for (let j = 1; j < mx.k; j++) if (mx.pi[j] > mx.pi[c]) c = j;
  return [mx.cen[c][0], mx.cen[c][1]];
}
function headMedian(S, q) {                              // each coordinate: sort by value, accumulate weight until it reaches half the total
  const r = reach(S, q); if (!r.ids.length || r.tot < 1e-12) return nearestAction(S, q);
  const med = (Y) => { const idx = r.ids.map((_, k) => k).sort((x, y) => Y[r.ids[x]] - Y[r.ids[y]] || x - y); let acc = 0; for (const k of idx) { acc += r.wt[k]; if (acc >= r.tot / 2) return Y[r.ids[k]]; } return Y[r.ids[idx[idx.length - 1]]]; };
  return [med(S.Y0), med(S.Y1)];
}
function makeCodebook(S, K) {                            // centres from k-means over the stored actions (BN.kmeans); each frame goes to its nearest centre
  const X = []; for (let i = 0; i < S.n; i++) X.push([S.Y0[i], S.Y1[i]]);
  const cen = BN.kmeans(X, K, { seed: 3 }).centers.map((c) => [c[0], c[1]]), bin = new Int32Array(S.n);
  for (let i = 0; i < S.n; i++) { let bd = Infinity, bk = 0; for (let k = 0; k < K; k++) { const e = (X[i][0] - cen[k][0]) * (X[i][0] - cen[k][0]) + (X[i][1] - cen[k][1]) * (X[i][1] - cen[k][1]); if (e < bd) { bd = e; bk = k; } } bin[i] = bk; }
  return { K, cen, bin };
}
function headBins(S, q, rng, cb) {
  const r = reach(S, q); if (!r.ids.length || r.tot < 1e-12) return nearestAction(S, q);
  const p = new Array(cb.K).fill(0); for (let k = 0; k < r.ids.length; k++) p[cb.bin[r.ids[k]]] += r.wt[k];
  let u = rng() * r.tot, k = 0; while (k < cb.K - 1 && u > p[k]) { u -= p[k]; k++; }
  return cb.cen[k].slice();
}

/* ───── scoring a policy ───── */
const vyOf = (q, u) => { const J = BN.arm.jac(q); return J[2] * u[0] + J[3] * u[1]; };
const cupOf = (q, a) => { const J = BN.arm.jac(q); return [J[0] * a[0] + J[1] * a[1], J[2] * a[0] + J[3] * a[1]]; };
function reversals(ro) {                                 // consecutive commands with vertical cup velocities both >= 5 cm/s in size and opposite in sign
  let f = 0, prev = 0;
  for (let t = 0; t < ro.A.length; t++) { const v = vyOf(ro.S[t], ro.A[t]); if (Math.abs(v) >= REV) { if (prev !== 0 && Math.sign(v) !== Math.sign(prev)) f++; prev = v; } else prev = 0; }
  return f;
}
function sideAbove(w, ro) {                              // above the first post when the cup reaches its x (or where it stopped)
  const p0 = w.posts[0]; for (let t = 0; t < ro.P.length; t++) if (ro.P[t][0] >= p0[0]) return ro.P[t][1] >= p0[1];
  return ro.P[ro.P.length - 1][1] >= p0[1];
}
function wilson(k, n) { const z = 1.96, p = k / n, d = 1 + z * z / n, c = (p + z * z / (2 * n)) / d, h = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d; return [Math.max(0, c - h), Math.min(1, c + h)]; }
function evaluate(w, act, n, o) {                        // act(q, rngDraw) -> command; every rollout has its own draw stream
  o = o || {}; const rng = BN.rng(o.seed === undefined ? PLSEED : o.seed), T = BN.slalom.horizon(w), pb = o.polseed === undefined ? POLSEED : o.polseed;
  let ok = 0, co = 0, up = 0, rev = 0; const post = new Array(w.n).fill(0);
  for (let k = 0; k < n; k++) {
    const rd = BN.rng(pb + k), r = run(w, (q) => act(q, rd), rng, GUST, T);
    if (r.done) ok++;
    if (r.coll) { co++; const p = r.P[r.P.length - 1]; let bi = 0, bd = 9; w.posts.forEach((c, i) => { const d = Math.hypot(p[0] - c[0], p[1] - c[1]); if (d < bd) { bd = d; bi = i; } }); post[bi]++; }
    if (sideAbove(w, r)) up++; rev += reversals(r);
  }
  const ci = wilson(ok, n);
  return { N: n, succ: ok / n * 100, coll: co / n * 100, below: (1 - up / n) * 100, rev: rev / n, lo: ci[0] * 100, hi: ci[1] * 100, post };
}

/* ───── the experiment ───── */
const nPosts = 5, wA = BN.slalom.world(nPosts, { s0: 1 }), wB = BN.slalom.world(nPosts, { s0: -1 });
const DA = collect(wA, 1, 20, 4, 5), DB = collect(wB, 2, 20, 4, 5), DAcalm = collect(wA, 1, 20, 0, 5);
const nA = DA.X0.length, nB = DB.X0.length; fx('nA', nA, 0); fx('nB', nB, 0);
const rhoOf = (s) => (s === 0 ? 0 : s / (1 - s) * nA / nB);
const storeCache = {};
const store = (s, h) => { const k = s + '|' + h; return storeCache[k] || (storeCache[k] = makeStore(DA, DB, rhoOf(s), h)); };
const cbCache = {};
const book = (s, K) => { const k = (s > 0) + '|' + K; return cbCache[k] || (cbCache[k] = makeCodebook(store(s, 0.02), K)); };
const actOf = (S, kind, K, cb) => {
  if (kind === 'mean') return (q) => headMean(S, q);
  if (kind === 'median') return (q) => headMedian(S, q);
  if (kind === 'mode') return (q) => headMode(S, q);
  if (kind === 'sample') return (q, r) => headSample(S, q, r);
  if (kind === 'mixture') return (q, r) => headMixture(S, q, r, K);
  return (q, r) => headBins(S, q, r, cb);
};
const evCache = {};
function EV(s, h, kind, K, n) {                          // one evaluation of a head on the pooled frames at share s of B and kernel width h
  const key = [s, h, kind, K || 0, n || N].join('|'); if (evCache[key]) return evCache[key];
  const S = store(s, h), cb = kind === 'codebook' ? book(s, K) : null;
  return (evCache[key] = evaluate(wA, actOf(S, kind, K, cb), n || N));
}

/* ───── one fork: what is in reach, and what a head draws there ───── */
const q0 = BN.slalom.startQ(wA, 0);
const xCross = (wA.posts[0][0] + wA.posts[1][0]) / 2, qX = BN.arm.ik([xCross, BN.slalom.yref(wA, xCross)], 1, wA.body);
function look(S, q) {
  const r = reach(S, q); let wa = 0, wb = 0; const vA = [0, 0], vB = [0, 0], mean = [0, 0];
  for (let k = 0; k < r.ids.length; k++) { const i = r.ids[k], v = cupOf(q, [S.Y0[i], S.Y1[i]]); if (S.OP[i] === 0) { wa += r.wt[k]; vA[0] += r.wt[k] * v[0]; vA[1] += r.wt[k] * v[1]; } else { wb += r.wt[k]; vB[0] += r.wt[k] * v[0]; vB[1] += r.wt[k] * v[1]; } mean[0] += r.wt[k] * v[0]; mean[1] += r.wt[k] * v[1]; }
  const tot = wa + wb;
  return { m: r.ids.length, shareB: wb / tot, vA: wa > 0 ? [vA[0] / wa, vA[1] / wa] : null, vB: wb > 0 ? [vB[0] / wb, vB[1] / wb] : null, mean: [mean[0] / tot, mean[1] / tot], r };
}
function forkDraws(S, q, act, deterministic) {          // 400 draws (one for a deterministic head), as the widget makes them
  const rng = BN.rng(DRAWSEED), f = look(S, q), m = deterministic ? 1 : DRAWS; let between = 0, onB = 0; const pts = [];
  for (let k = 0; k < m; k++) {
    const v = cupOf(q, act(q, rng)); pts.push(v);
    if (f.vA && f.vB) { const d = (v[1] - f.vB[1]) / (f.vA[1] - f.vB[1]); if (d > 0.25 && d < 0.75) between++; else if (d <= 0.25) onB++; }
  }
  return { f, pts, between: between / m * 100, onB: onB / m * 100 };
}
function sharedFraction(S) {                             // share of the expert's route (by length) at which both operators hold >= a tenth of the weight
  const x0 = BN.slalom.xStart(), x1 = BN.slalom.xEnd(wA), dx = 0.0025; let tot = 0, zone = 0, py = BN.slalom.yref(wA, x0);
  for (let x = x0 + dx; x <= x1; x += dx) {
    const y = BN.slalom.yref(wA, x), ds = Math.hypot(dx, y - py); py = y;
    const r = reach(S, BN.arm.ik([x, y], 1, wA.body)); let a = 0, b = 0; r.ids.forEach((i, k) => { if (S.OP[i] === 0) a += r.wt[k]; else b += r.wt[k]; });
    tot += ds; if (a + b > 0 && Math.min(a, b) / (a + b) >= 0.1) zone += ds;
  }
  return zone / tot * 100;
}

/* ═════════ the numbers the lesson quotes ═════════ */
const S1 = store(0.5, 0.02), S0 = store(0, 0.02);

// §1 the second operator
{
  const calm = evaluate(wA, (q) => headMean(makeStore(DAcalm, DB, 0, 0.02), q), N);   // 20 calm demonstrations of A only
  fx('calm_succ', calm.succ, 1);
  const single = EV(0, 0.02, 'mean'), pool = EV(0.5, 0.02, 'mean');
  fx('single_succ', single.succ, 1); fx('single_coll', single.coll, 1); fx('single_lo', single.lo, 1); fx('single_hi', single.hi, 1);
  fx('pool_succ', pool.succ, 1); fx('pool_coll', pool.coll, 1); fx('pool_lo', pool.lo, 1); fx('pool_hi', pool.hi, 1); fx('pool_drop', single.succ - pool.succ, 1);
  pool.post.forEach((c, i) => fx('pool_post' + (i + 1), c, 0));
  const f = look(S1, q0), c = look(S1, qX);
  fx('fr_m', f.m, 0); fx('fr_shareB', f.shareB * 100, 1); fx('fr_vAx', f.vA[0] * 100, 1); fx('fr_vAy', f.vA[1] * 100, 1); fx('fr_vBx', f.vB[0] * 100, 1); fx('fr_vBy', f.vB[1] * 100, 1);
  fx('fr_mx', f.mean[0] * 100, 1); fx('fr_my', f.mean[1] * 100, 1); fx('fr_deg', Math.atan2(f.mean[1], f.mean[0]) * 180 / Math.PI, 1); fx('fr_sep', (f.vA[1] - f.vB[1]) * 100, 1);
  fx('cr_m', c.m, 0); fx('cr_shareB', c.shareB * 100, 1); fx('cr_vAy', c.vA[1] * 100, 1); fx('cr_vBy', c.vB[1] * 100, 1); fx('cr_my', c.mean[1] * 100, 1); fx('cr_sep', (c.vA[1] - c.vB[1]) * 100, 1);
  // the stored action nearest to the mean, in cup velocity, and the scatter of A's actions about their own mean
  let near = Infinity, sc = 0, wsum = 0;
  f.r.ids.forEach((i, k) => { const v = cupOf(q0, [S1.Y0[i], S1.Y1[i]]); near = Math.min(near, Math.hypot(v[0] - f.mean[0], v[1] - f.mean[1])); if (S1.OP[i] === 0) { sc += f.r.wt[k] * ((v[0] - f.vA[0]) ** 2 + (v[1] - f.vA[1]) ** 2); wsum += f.r.wt[k]; } });
  fx('fr_near', near * 100, 1); fx('fr_scatterA', Math.sqrt(sc / wsum) * 100, 1);
  // copy error: the head's action against the operator's own label, relative rms, on fresh calm demonstrations (seed 99, ten of each) and on the stored frames
  const copyErr = (S, w) => { let se = 0, ss = 0; const rg = BN.rng(99); for (let k = 0; k < 10; k++) { const r = run(w, (q) => BN.slalom.expertAct(w, q), rg, 0, BN.slalom.horizon(w)); for (let t = 0; t < r.A.length; t++) { const p = headMean(S, r.S[t]); se += (p[0] - r.A[t][0]) ** 2 + (p[1] - r.A[t][1]) ** 2; ss += r.A[t][0] ** 2 + r.A[t][1] ** 2; } } return Math.sqrt(se / ss) * 100; };
  fx('copy_single', copyErr(S0, wA), 1); fx('copy_poolA', copyErr(S1, wA), 1); fx('copy_poolB', copyErr(S1, wB), 1);
  { let se = 0, ss = 0; for (let i = 0; i < S1.n; i++) { const p = headMean(S1, [S1.X0[i], S1.X1[i]]); se += (p[0] - S1.Y0[i]) ** 2 + (p[1] - S1.Y1[i]) ** 2; ss += S1.Y0[i] ** 2 + S1.Y1[i] ** 2; } fx('copy_train', Math.sqrt(se / ss) * 100, 1); }
  fx('copy_ratio', F.copy_poolA / F.copy_single, 1);
  fx('frames_pool', S1.n, 0); fx('fr_miss', 20 * f.mean[1] / f.mean[0], 1);   // the straight line at the mean's heading, 20 cm to the first post, cup starting level with its centre
  fx('shared_pct', sharedFraction(S1), 1);
  { const rg = BN.rng(3), T = BN.slalom.horizon(wA), K = 40; let steps = 0, zone = 0;
    for (let k = 0; k < K; k++) { const r = run(wA, (q) => BN.slalom.expertAct(wA, q), rg, GUST, T); steps += r.S.length;
      for (const q of r.S) { const rr = reach(S1, q); let a = 0, b = 0; rr.ids.forEach((i, j) => { if (S1.OP[i] === 0) a += rr.wt[j]; else b += rr.wt[j]; }); if (a + b > 0 && Math.min(a, b) / (a + b) >= 0.1) zone++; } }
    fx('expert_steps', steps / K, 0); fx('zone_steps', zone / K, 0); fx('zone_step_pct', zone / steps * 100, 0); }
}

// §2 what squared error returns: the losses at the two forks, in the units training uses (joint velocities)
{
  const L = (S, q, c, p) => { const r = reach(S, q); let s = 0; r.ids.forEach((i, k) => { s += r.wt[k] * (p === 2 ? (S.Y0[i] - c[0]) ** 2 + (S.Y1[i] - c[1]) ** 2 : Math.abs(S.Y0[i] - c[0]) + Math.abs(S.Y1[i] - c[1])); }); return s / r.tot; };
  const jmean = (S, q, tag) => { const r = reach(S, q); let a0 = 0, a1 = 0, w = 0; r.ids.forEach((i, k) => { if (tag === undefined || S.OP[i] === tag) { a0 += r.wt[k] * S.Y0[i]; a1 += r.wt[k] * S.Y1[i]; w += r.wt[k]; } }); return [a0 / w, a1 / w]; };
  for (const [pre, q] of [['', q0], ['x_', qX]]) {
    const m = jmean(S1, q), a = jmean(S1, q, 0), b = jmean(S1, q, 1);
    fx(pre + 'L2_mean', L(S1, q, m, 2), 5); fx(pre + 'L2_ratio_A', L(S1, q, a, 2) / L(S1, q, m, 2), 2); fx(pre + 'L2_ratio_B', L(S1, q, b, 2) / L(S1, q, m, 2), 2);
    fx(pre + 'L1_ratio_A', L(S1, q, a, 1) / L(S1, q, m, 1), 2); fx(pre + 'L1_ratio_B', L(S1, q, b, 1) / L(S1, q, m, 1), 2);
    // the weighted mean really is the minimiser of the squared loss (a search over a grid around it), and the loss at a route exceeds it
    let best = Infinity, bc = null; for (let i = -20; i <= 20; i++) for (let j = -20; j <= 20; j++) { const c = [m[0] + i * 0.01, m[1] + j * 0.01], l = L(S1, q, c, 2); if (l < best) { best = l; bc = c; } }
    check(Math.abs(bc[0] - m[0]) < 1e-9 && Math.abs(bc[1] - m[1]) < 1e-9, 'the weighted mean minimises the squared loss at the fork ' + (pre || 'start'));
  }
  fx('sep_ratio', Math.hypot(...jmean(S1, q0, 0).map((v, i) => v - jmean(S1, q0, 1)[i])) / 2 / (() => { const r = reach(S1, q0), a = jmean(S1, q0, 0); let s = 0, w = 0; r.ids.forEach((i, k) => { if (S1.OP[i] === 0) { s += r.wt[k] * ((S1.Y0[i] - a[0]) ** 2 + (S1.Y1[i] - a[1]) ** 2); w += r.wt[k]; } }); return Math.sqrt(s / w); })(), 1);
}

// §3 one point per pose, and the draw: the pooled data, share of B 50 %
{
  const rows = [['mean', 'mean', 0], ['med', 'median', 0], ['mode', 'mode', 0], ['smp', 'sample', 0]];
  for (const [tag, kind] of rows) {
    const e = EV(0.5, 0.02, kind), d = forkDraws(S1, q0, actOf(S1, kind, 0, null), kind !== 'sample');
    fx(tag + '_succ', e.succ, 1); fx(tag + '_coll', e.coll, 1); fx(tag + '_below', e.below, 1); fx(tag + '_rev', e.rev, 2); fx(tag + '_between', d.between, 1); fx(tag + '_onB', d.onB, 1);
    fx(tag + '_lo', e.lo, 1); fx(tag + '_hi', e.hi, 1);
  }
  const s0 = EV(0, 0.02, 'sample'), m0 = EV(0, 0.02, 'mode'), md0 = EV(0, 0.02, 'median');
  fx('single_smp_succ', s0.succ, 1); fx('single_smp_rev', s0.rev, 2); fx('single_mode_succ', m0.succ, 1); fx('single_med_succ', md0.succ, 1); fx('single_mean_rev', EV(0, 0.02, 'mean').rev, 2);
  fx('smp_cost', s0.succ - F.smp_succ, 1);
  // the share sweep: weight of B's frames set so that B holds 0 ... 50 % of the data
  for (const s of [0, 10, 20, 30, 40, 50]) for (const [tag, kind] of [['mean', 'mean'], ['mode', 'mode'], ['smp', 'sample']]) { const e = EV(s / 100, 0.02, kind); fx(`sw${s}_${tag}`, e.succ, 1); fx(`swb${s}_${tag}`, e.below, 1); }
}

// §5 heads that do not store frames
{
  for (const K of [1, 2, 4, 8]) { const e = EV(0.5, 0.02, 'mixture', K), d = forkDraws(S1, q0, actOf(S1, 'mixture', K, null), false); fx(`mix${K}_succ`, e.succ, 1); fx(`mix${K}_coll`, e.coll, 1); fx(`mix${K}_rev`, e.rev, 2); fx(`mix${K}_between`, d.between, 1); fx(`mix${K}_onB`, d.onB, 1); fx(`mix_par${K}`, 4 * K - 1, 0); }
  for (const K of [2, 4, 8, 16, 32, 64]) { const e = EV(0.5, 0.02, 'codebook', K); fx(`cb${K}_succ`, e.succ, 1); fx(`cb${K}_rev`, e.rev, 2); fx(`cb${K}_post1`, e.post[0], 0); }
  fx('rff_note', 0, 0);
}

// §6 the price of a new draw at every step; the kernel width
{
  for (const [tag, h] of [['10', 0.01], ['15', 0.015], ['20', 0.02], ['30', 0.03]]) {
    fx(`kw${tag}_single`, EV(0, h, 'mean').succ, 1); fx(`kw${tag}_mean`, EV(0.5, h, 'mean').succ, 1); fx(`kw${tag}_smp`, EV(0.5, h, 'sample').succ, 1); fx(`kw${tag}_mode`, EV(0.5, h, 'mode').succ, 1);
    fx(`kw${tag}_zone`, sharedFraction(store(0.5, h)), 1);
  }
  // the draws across eight re-drawn datasets (A seed 10 + 2d, B seed 11 + 2d), 300 rollouts each
  const heads = [['single_mean', 0, 'mean', 0], ['single_smp', 0, 'sample', 0], ['pool_mean', 1, 'mean', 0], ['pool_smp', 1, 'sample', 0], ['pool_mode', 1, 'mode', 0]];
  const acc = {}; heads.forEach((h) => { acc[h[0]] = []; });
  for (let d = 0; d < 8; d++) {
    const dA = collect(wA, 10 + 2 * d, 20, 4, 5), dB = collect(wB, 11 + 2 * d, 20, 4, 5), nAd = dA.X0.length, nBd = dB.X0.length;
    for (const [tag, share, kind, K] of heads) {
      const S = makeStore(dA, dB, share === 0 ? 0 : nAd / nBd, 0.02);
      acc[tag].push(evaluate(wA, actOf(S, kind, K, null), 300, { seed: PLSEED + d, polseed: POLSEED + 7919 * d }).succ);
    }
  }
  for (const [tag] of heads) { const a = acc[tag], m = a.reduce((x, y) => x + y) / a.length; fx('ms_' + tag, m, 1); fx('ms_' + tag + '_min', Math.min(...a), 1); fx('ms_' + tag + '_max', Math.max(...a), 1); }
  fx('ms_smp_coll', 100 - F.ms_pool_smp, 1); fx('ms_smp_coll_lo', 100 - F.ms_pool_smp_max, 1); fx('ms_smp_coll_hi', 100 - F.ms_pool_smp_min, 1); fx('ms_mean_coll', 100 - F.ms_pool_mean, 1);
}

// the checkpoint: independent coin flips of a vertical speed of 9 cm/s, 0.05 s per step, 12 cm/s forward, a post 10 cm ahead
{
  const step = 9 * DT, nPost = 10 / 12 / DT, sd17 = step * Math.sqrt(17), n5 = (5 / step) ** 2;
  fx('ck_step', step, 2); fx('ck_npost', nPost, 1); fx('ck_commit', 5 / step, 1); const perFork = F.zone_steps / 5; fx('ck_fork_steps', perFork, 1); fx('ck_fork_walk', step * Math.sqrt(perFork), 1); fx('ck_fork_commit', step * perFork, 1);   // the shared poses of the expert's run, shared out over the five forks
  fx('gap_steps', 10 / (100 * (BN.slalom.xEnd(wA) - BN.slalom.xStart()) / F.expert_steps), 0);   // 10 cm from a crossing to the next post, at the expert's average speed along the course
  fx('ck_sd17', sd17, 2); fx('ck_n5', n5, 0); fx('ck_t5', n5 * DT, 1); fx('ck_ratio', n5 / nPost, 1); fx('ck_ratio_loss', 2, 0);
  const rg = BN.rng(21); let s2 = 0; const T = 40000; for (let t = 0; t < T; t++) { let y = 0; for (let k = 0; k < 17; k++) y += rg() < 0.5 ? step : -step; s2 += y * y; }
  fx('mc_sd17', Math.sqrt(s2 / T), 2);
  check(Math.abs(F.mc_sd17 - F.ck_sd17) < 0.03, 'independent coin-flip steps spread as step * sqrt(n): ' + F.mc_sd17 + ' vs ' + F.ck_sd17);
  // E[draw] = mean: the sample head's expected action at the start pose equals the kernel mean (200 000 draws)
  const rg2 = BN.rng(33); let a0 = 0, a1 = 0; const M = 200000;
  for (let k = 0; k < M; k++) { const a = headSample(S1, q0, rg2); a0 += a[0]; a1 += a[1]; }
  const m = headMean(S1, q0); fx('mc_mean_gap', Math.hypot(a0 / M - m[0], a1 / M - m[1]), 4);
  check(F.mc_mean_gap < 0.004, 'the expected draw equals the kernel mean (gap ' + F.mc_mean_gap + ' rad/s)');
}

/* ═════════ claims of the prose, asserted ═════════ */
check(F.single_succ >= 92 && F.single_succ <= 99, 'one operator, four rounds: about nineteen in twenty (' + F.single_succ + ')');
check(F.calm_succ >= 55 && F.calm_succ <= 75, 'one operator, 20 calm demonstrations: about six or seven in ten (' + F.calm_succ + ')');
check(F.pool_succ < 65 && F.pool_drop > 30, 'two operators pooled, mean head: the success collapses (' + F.pool_succ + ', drop ' + F.pool_drop + ')');
check(F.ms_single_mean > 90 && F.ms_pool_mean < 62 && F.ms_pool_mean > 40, 'across eight datasets: one operator > 90 %, pooled mean 40-62 % (' + F.ms_single_mean + ', ' + F.ms_pool_mean + ')');
check(F.fr_vAy > 5 && F.fr_vBy < -5 && Math.abs(F.fr_my) < 4, 'at the start pose the two operators point opposite ways and the kernel mean is nearly dead ahead');
check(F.fr_deg < 15 && F.fr_deg > -15, 'the kernel mean points within 15 degrees of the first post');
check(F.fr_near > 2.5 && F.fr_near < 6, 'the stored action nearest to the mean is a few cm/s away');
check(F.L2_ratio_A > 1.3 && F.L2_ratio_B > 1.3 && F.x_L2_ratio_A > 1.3 && F.x_L2_ratio_B > 1.3, 'squared error prefers the average to either route at both forks');
check(Math.abs(F.L2_ratio_A - 100 / (100 - F.fr_shareB)) < 0.03 && Math.abs(F.L2_ratio_B - 100 / F.fr_shareB) < 0.03 && Math.abs(F.x_L2_ratio_A - 100 / (100 - F.cr_shareB)) < 0.03 && Math.abs(F.x_L2_ratio_B - 100 / F.cr_shareB) < 0.03, 'the loss at a route is 1/p times the loss at the mean, p the route\'s share of the weight');
check(F.L1_ratio_A < 1 && F.x_L1_ratio_B < 1, 'absolute error prefers the heavier route at both forks, not the average');
check(F.copy_poolA > 5 * F.copy_single && Math.abs(F.copy_train - F.copy_poolA) < 5, 'the pooled mean head is far worse on fresh frames, and just as bad on its own frames (a floor, not under-fit)');
check(F.shared_pct > 10 && F.shared_pct < 25 && F.zone_step_pct > 10 && F.zone_step_pct < 25, 'the two routes share a neighbourhood for roughly a sixth of the route');
check(F.med_succ > 85 && F.mode_succ > 95 && F.med_below < 30 && F.mode_below < 30, 'median and heaviest hump finish the course and send fewer than 30 % of runs to B\'s side');
check(F.med_onB === 0 && F.mode_onB === 0 && F.mean_between === 100, 'at the start pose the mean sits between the routes, the median and the mode sit on A');
check(F.smp_between < 2 && F.smp_onB > F.fr_shareB - 8 && F.smp_onB < F.fr_shareB + 8, 'drawn actions are never between the routes and fall on B in proportion to its weight in reach');
check(F.smp_succ > F.pool_succ + 5 && F.smp_succ < F.single_smp_succ - 10, 'drawing beats the mean on the pooled data and loses to one operator drawing');
check(F.ms_pool_smp > F.ms_pool_mean + 10 && F.ms_pool_smp < F.ms_single_smp - 8 && F.ms_pool_mode > 93, 'the same ordering over eight datasets');
check(F.ms_smp_coll > 22 && F.ms_smp_coll < 36, 'about three in ten drawn runs end in a post over eight datasets (' + F.ms_smp_coll + ')');
check(F.mode_rev > 1.5 && F.mode_rev < F.smp_rev / 2, 'the heaviest hump flips where the weights cross, a few times a course, a quarter of what a draw does');
check(F.smp_below > 35 && F.smp_below < 65 && F.single_smp_succ < F.single_succ - 4, 'the draw uses both routes, and on one operator\'s data it is worse than the mean');
check(Math.abs(F.sw0_mode - F.sw50_mode) < 4 && F.sw0_mean > F.sw10_mean && F.sw10_mean > F.sw20_mean && F.sw20_mean > F.sw30_mean && F.sw30_mean > F.sw40_mean && F.sw40_mean >= F.sw50_mean, 'the mean falls steadily with the second operator\'s share, the heaviest hump does not move');
check(Math.abs(F.cb64_succ - F.smp_succ) < 10 && Math.abs(F.cb16_succ - F.smp_succ) < 10 && Math.abs(F.mix4_succ - F.mix2_succ) < 10, 'a codebook of 16 or more and a mixture of 4 do what the draw does');
check(F.mean_rev === 0 && F.single_smp_rev < 0.5 && F.smp_rev > 8 && F.mode_rev < 5, 'reversals: none for the mean, almost none for one operator drawing, many for two, a few for the mode');
check(Math.abs(F.mix1_succ - F.pool_succ) < 12 && F.mix1_between > 20, 'one Gaussian hump sits between the routes and does no better than the mean (' + F.mix1_succ + ' against ' + F.pool_succ + ')');
check(F.mix2_succ > F.mix1_succ + 15 && Math.abs(F.mix8_succ - F.mix2_succ) < 10 && F.mix2_between < 2, 'two humps hold the two routes, eight are no better');
check(F.cb2_succ < 10 && F.cb4_succ < 50 && F.cb16_succ > 60 && F.cb32_succ > 55 && F.cb64_succ > 55, 'a codebook needs about sixteen prototypes, and more change nothing');
check(F.kw10_mean > F.kw15_mean && F.kw15_mean > F.kw20_mean && F.kw20_mean > F.kw30_mean, 'a wider kernel hurts the mean');
check(F.kw10_smp > F.kw15_smp && F.kw15_smp > F.kw20_smp && F.kw20_smp > F.kw30_smp, 'a wider kernel hurts the draw');
check(F.kw10_zone < F.kw20_zone && F.kw20_zone < F.kw30_zone, 'a wider kernel widens the shared zone');
check(F.kw10_mean > 90, 'a kernel half as wide makes the pooled mean policy nearly harmless (' + F.kw10_mean + ')');
check(F.sw0_smp - F.sw20_smp > 10 && Math.abs(F.sw20_smp - F.sw50_smp) < 8, 'the second operator costs the draw its success already at 20 % share, and more share costs little more');
check(F.swb30_mode < 10 && F.swb40_mode < 15 && F.swb40_smp > 25, 'the heaviest hump hardly ever takes B\'s side below 50 % share, the draw does');
check(F.sw0_mean > F.sw20_mean && F.sw20_mean > F.sw30_mean, 'more of B in the data hurts the mean');

/* ═════════ the widget prints the same numbers ═════════ */
const html = path.join(root, dir, '04_people_are_not_functions.html');
if (fs.existsSync(html)) {
  const pg = loadPage(html);
  pg.problems.forEach((p) => fail('page problem: ' + p));
  const eqd = (id, want, digits, what) => { const got = pg.num(id); if (!(Math.abs(got - want) <= 0.5 * Math.pow(10, -digits) + 1e-9)) fail(`${what}: widget #${id} prints ${got}, independent computation gives ${want.toFixed(digits + 2)}`); };
  const SHARES = [0, 10, 20, 30, 40, 50], KS = [1, 2, 4, 8, 16, 32, 64], HS = [0.01, 0.015, 0.02, 0.03];
  const state = (si, head, ki, hi, fork) => { pg.set('w04-share', si); pg.set('w04-head', head); pg.set('w04-K', ki); pg.set('w04-h', hi); pg.set('w04-fork', fork); pg.drain(); };
  const probe = (si, head, ki, hi, fork, tag) => {
    const s = SHARES[si] / 100, h = HS[hi], K = head === 'mixture' ? Math.min(KS[ki], 8) : KS[ki], S = store(s, h), q = fork === 'start' ? q0 : qX;
    const kind = head, e = EV(s, h, kind, kind === 'mixture' || kind === 'codebook' ? K : 0), cb = kind === 'codebook' ? book(s, K) : null;
    const d = forkDraws(S, q, actOf(S, kind, K, cb), kind === 'mean' || kind === 'mode'), f = look(S, q);
    eqd('w04-succ', e.succ, 1, tag + ' success'); eqd('w04-coll', e.coll, 1, tag + ' collisions'); eqd('w04-below', e.below, 1, tag + ' below the first post'); eqd('w04-rev', e.rev, 2, tag + ' reversals');
    eqd('w04-between', d.between, 1, tag + ' draws between'); eqd('w04-onB', d.onB, 1, tag + ' draws on B'); eqd('w04-wB', f.shareB * 100, 1, tag + ' B weight at the fork');
    eqd('w04-shared', sharedFraction(S), 1, tag + ' shared zone'); eqd('w04-frames', S.n, 0, tag + ' frames');
    const want = `${e.lo.toFixed(1)}–${e.hi.toFixed(1)} %`; if (pg.text('w04-ci') !== want) fail(`${tag} interval: widget prints '${pg.text('w04-ci')}', expected '${want}'`);
  };
  state(5, 'mean', 1, 2, 'start'); probe(5, 'mean', 1, 2, 'start', 'default');
  state(0, 'mean', 1, 2, 'start'); probe(0, 'mean', 1, 2, 'start', 'share 0');
  state(5, 'sample', 1, 2, 'start'); probe(5, 'sample', 1, 2, 'start', 'draw');
  state(5, 'mode', 1, 2, 'start'); probe(5, 'mode', 1, 2, 'start', 'heaviest hump');
  state(5, 'mixture', 0, 2, 'start'); probe(5, 'mixture', 0, 2, 'start', 'mixture K=1');
  state(5, 'mixture', 1, 2, 'start'); probe(5, 'mixture', 1, 2, 'start', 'mixture K=2');
  state(5, 'mixture', 3, 2, 'start'); probe(5, 'mixture', 3, 2, 'start', 'mixture K=8');
  state(5, 'codebook', 1, 2, 'start'); probe(5, 'codebook', 1, 2, 'start', 'codebook K=2');
  state(5, 'codebook', 4, 2, 'start'); probe(5, 'codebook', 4, 2, 'start', 'codebook K=16');
  state(5, 'codebook', 6, 2, 'start'); probe(5, 'codebook', 6, 2, 'start', 'codebook K=64');
  state(3, 'sample', 1, 2, 'start'); probe(3, 'sample', 1, 2, 'start', 'draw, share 30');
  state(0, 'codebook', 4, 2, 'start'); probe(0, 'codebook', 4, 2, 'start', 'codebook K=16, share 0');
  state(5, 'mean', 1, 0, 'start'); probe(5, 'mean', 1, 0, 'start', 'mean, kernel 0.010');
  state(5, 'sample', 1, 0, 'start'); probe(5, 'sample', 1, 0, 'start', 'draw, kernel 0.010');
  state(5, 'mean', 1, 3, 'start'); probe(5, 'mean', 1, 3, 'start', 'mean, kernel 0.030');
  state(1, 'sample', 1, 2, 'start'); probe(1, 'sample', 1, 2, 'start', 'draw, share 10');
  state(3, 'mode', 1, 2, 'start'); probe(3, 'mode', 1, 2, 'start', 'heaviest hump, share 30');
  state(5, 'mixture', 6, 2, 'start'); probe(5, 'mixture', 6, 2, 'start', 'mixture, slider at 64 (capped at 8)');
  state(5, 'sample', 1, 1, 'cross'); probe(5, 'sample', 1, 1, 'cross', 'draw, kernel 0.015, first crossing');
  state(5, 'mean', 1, 2, 'cross'); probe(5, 'mean', 1, 2, 'cross', 'mean, first crossing');
}

console.log(JSON.stringify({ facts: F }));
process.exit(bad ? 1 : 0);
