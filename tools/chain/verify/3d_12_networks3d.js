#!/usr/bin/env node
/* Oracle for 3D lesson 12, "Networks that eat 3D".
 *
 * Independent re-derivations (the engine l12_pointnet.js is the code under test; every quoted number gets a second path):
 *   A  the networks: an independent forward pass written from the flat weight vector, finite-difference gradients of the engine's backward pass,
 *      exact permutation invariance of the symmetric form (0 for max, rounding for sum and mean), the plain MLP's failure on a reordered list
 *   B  the form: lesson 11's closed-form posterior mean rebuilt as rho(sum phi(x_j)) with 65 numbers per cloud (any order, any count),
 *      the power-sum counterexample behind the width caveat, the roads (shuffle training, sorting)
 *   C  the critical set recomputed by brute force, exact indifference to deleting the other points, three deletion policies
 *   D  convolution counts by brute force with string-keyed sets: dense, sparse (scatter), submanifold; dilation by repeated union; a sphere in 128^3
 *   E  the exit: balanced fronts (closed-form weights), what the squared-error network answers against the two objects that fit, the arithmetic of the average
 * Then the page's widget is driven into each state quoted in "What to try".   Prints {"facts": {...}} as its last line.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '../../../all_lessons');
const DIR = fs.existsSync(path.join(ROOT, 'computer_vision_3d_new')) ? path.join(ROOT, 'computer_vision_3d_new') : path.join(ROOT, 'computer_vision_3d');
const FL = require(path.join(DIR, 'flatland.js'));
const PN = require(path.join(DIR, 'l12_pointnet.js'));
const { loadPage } = require('../dom_probe.js');
const SH = FL.shape;

let fails = 0;
const facts = {};
function ok(name, cond, extra) { if (!cond) { fails++; console.error('FAIL', name, extra === undefined ? '' : extra); } }
const close = (a, b, tol) => Math.abs(a - b) <= (tol === undefined ? 1e-9 : tol);
const sum = (xs, f) => xs.reduce((s, x, i) => s + (f ? f(x, i) : x), 0);
const mean = xs => sum(xs) / xs.length;

/* ───────────── reference forward passes, written from the flat weight vector ───────────── */
function layerApply(p, ly, h, relu) {
  const o = [];
  for (let j = 0; j < ly.no; j++) { let s = p[ly.o + ly.no * ly.ni + j]; for (let k = 0; k < ly.ni; k++) s += p[ly.o + j * ly.ni + k] * h[k]; o.push(relu ? Math.max(0, s) : s); }
  return o;
}
function refSet(net, X, n) {                       // phi on each point, pool each channel, rho
  const feats = [];
  for (let i = 0; i < n; i++) { let h = [X[2 * i], X[2 * i + 1]]; for (const ly of net.phi.L) h = layerApply(net.p, ly, h, true); feats.push(h); }
  const F = feats[0].length, g = [];
  for (let f = 0; f < F; f++) { const col = feats.map(r => r[f]); g.push(net.pool === 'max' ? Math.max(...col) : net.pool === 'sum' ? sum(col) : mean(col)); }
  let h = g; net.rho.L.forEach((ly, l, a) => { h = layerApply(net.p, ly, h, l < a.length - 1); });
  return { out: h, feats, g };
}
function refMLP(net, X) { let h = Array.from(X); net.phi.L.forEach((ly, l, a) => { h = layerApply(net.p, ly, h, l < a.length - 1); }); return h; }
const sm = z => { const m = Math.max(...z), e = z.map(v => Math.exp(v - m)), s = sum(e); return e.map(v => v / s); };
const maxDiff = (a, b) => Math.max(...Array.from(a, (v, i) => Math.abs(v - b[i])));

/* ───────────── A. the networks ───────────── */
const TEST = PN.testSet(777, 100, PN.N0);          // the widget's test set: 100 clouds of 32 points in scan order
{
  // the data are what they say: noise-free points lie on the boundary of the blob drawn from the same coefficients
  const rng = FL.rng(9); let worst = 0;
  for (let t = 0; t < 40; t++) {
    const th = PN.shape(t % 2, rng), cl = PN.cloud(th, 20, rng, {}), blob = FL.blob(0, 0, 1, SH.harmonics(th), [1, 1, 1]);
    for (let i = 0; i < 20; i++) worst = Math.max(worst, Math.abs(FL.sdfShape(blob, cl.x[2 * i], cl.x[2 * i + 1])));
  }
  ok('cloud points lie on the boundary (SDF of the blob)', worst < 1e-6, worst);
  let ordered = true; TEST.forEach(c => { for (let i = 1; i < c.n; i++) if (c.ang[i] < c.ang[i - 1]) ordered = false; }); ok('test clouds are in scan order', ordered);
  const cls = mean(TEST.map(c => c.y)); ok('test classes balanced', cls === 0.5, cls);
}
{
  // gradients: the engine's backward pass against central differences
  const rng = FL.rng(3), mk = (n, y) => { const c = PN.cloud(PN.shape(y, rng), n, rng, { sd: 0.02 }); return { x: c.x, n: c.n, y }; };
  const batch = [mk(8, 0), mk(8, 1), mk(9, 1)];
  function gradErr(net, bt) {
    const g = new Float64Array(net.p.length); PN.lossGrad(net, bt, g);
    let worst = 0, r2 = FL.rng(11);
    for (let t = 0; t < 60; t++) {
      const i = Math.floor(r2() * net.p.length), h = 1e-6, p0 = net.p[i];
      net.p[i] = p0 + h; const Lp = PN.lossGrad(net, bt, new Float64Array(net.p.length));
      net.p[i] = p0 - h; const Lm = PN.lossGrad(net, bt, new Float64Array(net.p.length)); net.p[i] = p0;
      const num = (Lp - Lm) / (2 * h); worst = Math.max(worst, Math.abs(num - g[i]) / (1e-5 + Math.abs(num)));
    }
    return worst;
  }
  let worst = 0;
  for (const pool of ['max', 'mean', 'sum']) worst = Math.max(worst, gradErr(PN.make('set', { phi: [8, 12], rho: [8], K: 2, pool }, 4), batch));
  worst = Math.max(worst, gradErr(PN.make('mlp', { n: 8, hid: [10, 6], K: 2 }, 4), batch.slice(0, 2).map(b => ({ x: b.x, n: 8, y: b.y }))));
  worst = Math.max(worst, gradErr(PN.make('set', { phi: [8, 12], rho: [8], K: 3, pool: 'max', loss: 'mse' }, 4), batch.map(b => ({ x: b.x, n: b.n, y: [0.1 * b.y, 0.2, -0.3] }))));
  ok('analytic gradients equal finite differences', worst < 1e-3, worst);
  facts.grad_digits = Math.floor(-Math.log10(Math.max(worst, 1e-9)));
}

const SETNET = PN.fitSet(1, 300, { phi: [16, 16] }), MLPNET = PN.fitMLP(1, 300);
{
  // the engine's forward equals the independent one
  const rng = FL.rng(21); let wS = 0, wM = 0;
  for (let t = 0; t < 100; t++) {
    const c = TEST[t], n = 3 + Math.floor(rng() * 30), K = PN.subset(c, Array.from({ length: n }, (_, i) => i));
    wS = Math.max(wS, maxDiff(PN.forward(SETNET, K.x, K.n).out, refSet(SETNET, K.x, K.n).out));
    wM = Math.max(wM, maxDiff(PN.forward(MLPNET, c.x, c.n).out, refMLP(MLPNET, c.x)));
  }
  ok('engine forward == reference (set)', wS < 1e-12, wS); ok('engine forward == reference (MLP)', wM < 1e-12, wM);
}
const accOf = (clouds, fwd) => mean(clouds.map(c => { const o = fwd(c); return (o[1] > o[0] ? 1 : 0) === c.y ? 1 : 0; }));
const rs = FL.rng(99), SHUF = TEST.map(c => { const s = PN.shuffle(c, rs); s.y = c.y; return s; });
{
  // permutation invariance of the symmetric form: exactly 0 for max; rounding for the sums (random weights and trained weights)
  const rng = FL.rng(5); let wMax = 0, wSum = 0, wMean = 0, wTrained = 0;
  for (let t = 0; t < 120; t++) {
    const c = PN.cloud(PN.shape(t % 2, rng), 5 + Math.floor(rng() * 40), rng, { sd: 0.02 });
    for (const [pool, key] of [['max', 0], ['sum', 1], ['mean', 2]]) {
      const net = PN.make('set', { phi: [16, 32], rho: [16], K: 2, pool }, 100 + t), a = PN.forward(net, c.x, c.n).out;
      for (let k = 0; k < 5; k++) { const q = PN.shuffle(c, rng), b = PN.forward(net, q.x, q.n).out, d = maxDiff(a, b); if (key === 0) wMax = Math.max(wMax, d); else if (key === 1) wSum = Math.max(wSum, d); else wMean = Math.max(wMean, d); }
    }
    const a = PN.forward(SETNET, c.x, c.n).out, q = PN.shuffle(c, rng); wTrained = Math.max(wTrained, maxDiff(a, PN.forward(SETNET, q.x, q.n).out));
  }
  ok('max pool invariant to the last bit', wMax === 0, wMax); ok('sum pool invariant to rounding', wSum < 1e-12, wSum); ok('mean pool invariant to rounding', wMean < 1e-12, wMean); ok('trained network invariant', wTrained === 0, wTrained);
  facts.inv_err = wMax;
}
{
  // the plain MLP: accuracy in scan order and shuffled, how far its answer moves
  const accO = accOf(TEST, c => refMLP(MLPNET, c.x)), accS = accOf(SHUF, c => refMLP(MLPNET, c.x));
  facts.mlp_order = 100 * accO; facts.mlp_shuf = 100 * accS;
  const r = FL.rng(1), moves = [];
  TEST.forEach(c => { const p0 = sm(refMLP(MLPNET, c.x))[1]; for (let k = 0; k < 24; k++) { const q = PN.shuffle(c, r); moves.push(Math.abs(sm(refMLP(MLPNET, q.x))[1] - p0)); } });
  facts.mlp_change_all = mean(moves);
  ok('MLP is good in the order it was trained in', accO >= 0.86, accO); ok('MLP on shuffled lists is near chance', accS > 0.42 && accS < 0.65, accS);
  ok('MLP answer moves on reshuffling', facts.mlp_change_all > 0.3, facts.mlp_change_all);
  // across training seeds the story does not change
  let lo = 1, hi = 0, plo = 1, pshufMax = 0, plo2 = 1;
  for (let seed = 2; seed <= 5; seed++) {
    const m = PN.fitMLP(seed, 300), s = PN.fitSet(seed, 300, { phi: [16, 16] });
    lo = Math.min(lo, accOf(TEST, c => refMLP(m, c.x))); hi = Math.max(hi, accOf(SHUF, c => refMLP(m, c.x)));
    plo = Math.min(plo, accOf(TEST, c => refSet(s, c.x, c.n).out)); pshufMax = Math.max(pshufMax, Math.abs(accOf(TEST, c => refSet(s, c.x, c.n).out) - accOf(SHUF, c => refSet(s, c.x, c.n).out)));
  }
  ok('MLP in-order accuracy >= 86% for every seed', lo >= 0.86, lo); ok('MLP shuffled accuracy <= 65% for every seed', hi <= 0.65, hi);
  ok('PointNet accuracy >= 95% for every seed', plo >= 0.95, plo); ok('PointNet shuffled == in order for every seed', pshufMax === 0, pshufMax);
  // the symmetric network
  facts.pn_acc = 100 * accOf(TEST, c => refSet(SETNET, c.x, c.n).out); facts.pn_acc_shuf = 100 * accOf(SHUF, c => refSet(SETNET, c.x, c.n).out);
  ok('PointNet shuffled == in order', facts.pn_acc === facts.pn_acc_shuf);
  // how many lists
  let f32 = 1; for (let k = 2; k <= 32; k++) f32 *= k; facts.fact32_e35 = f32 / 1e35; ok('32! is 2.63e35', close(facts.fact32_e35, 2.63, 0.01), f32);
  facts.train_clouds = 300 * 16;
}

/* ───────────── B. the form ───────────── */
{
  // lesson 11's posterior mean rebuilt as rho(sum_j phi(x_j)).  Points arrive as (x, z); phi uses the point's polar coordinates.
  const D = 10, prior = SH.prior('learned'), LamInv = SH.minv(prior.Lam, D), sigma = 0.01, rng = FL.rng(17);
  const phiOf = (x, z) => { const a = Math.atan2(z, x), r = Math.hypot(x, z), h = []; for (let k = 1; k <= 5; k++) h.push(Math.cos(k * a), Math.sin(k * a)); const out = []; for (let i = 0; i < D; i++) for (let j = i; j < D; j++) out.push(h[i] * h[j] / (sigma * sigma)); for (let i = 0; i < D; i++) out.push(h[i] * (r - 1) / (sigma * sigma)); return out; };
  const rhoOf = s => {                         // 55 numbers of P (upper triangle), 10 of b
    const P = new Float64Array(D * D), b = new Float64Array(D); let q = 0;
    for (let i = 0; i < D; i++) for (let j = i; j < D; j++) { P[i * D + j] = P[j * D + i] = s[q++]; }
    for (let i = 0; i < D; i++) b[i] = s[q++];
    const A = new Float64Array(D * D), rhs = new Float64Array(D);
    for (let i = 0; i < D * D; i++) A[i] = LamInv[i] + P[i];
    for (let i = 0; i < D; i++) { let v = b[i]; for (let j = 0; j < D; j++) v += LamInv[i * D + j] * prior.mu[j]; rhs[i] = v; }
    return FL.solve(A, rhs, D);
  };
  let worst = 0, dim = phiOf(1, 0).length;
  for (let t = 0; t < 60; t++) {
    const th = SH.sampleFamily(rng), n = [3, 6, 9, 17, 40][t % 5], cl = PN.cloud(th, n, rng, { sd: sigma });
    const rad = []; for (let i = 0; i < n; i++) rad.push(Math.hypot(cl.x[2 * i], cl.x[2 * i + 1]));
    const ref = SH.posterior(cl.ang, rad, sigma, prior).mean;
    const q = PN.shuffle(cl, rng), s = new Array(dim).fill(0);
    for (let i = 0; i < q.n; i++) { const f = phiOf(q.x[2 * i], q.x[2 * i + 1]); for (let k = 0; k < dim; k++) s[k] += f[k]; }
    worst = Math.max(worst, maxDiff(rhoOf(s), ref));
  }
  ok('lesson 11 posterior mean == rho(sum phi), any order and count', worst < 1e-8, worst);
  facts.ds_dim = dim; facts.ds_digits = Math.floor(-Math.log10(Math.max(worst, 1e-16)));
  ok('65 numbers per cloud', dim === 65);
}
{
  // the width caveat: with phi(x) = (x, x^2) two different 3-point sets share their pooled value; a third power tells them apart
  const A = [1, 5, 6], B = [2, 3, 7], pw = (S, k) => sum(S, v => v ** k);
  ok('p1 equal', pw(A, 1) === pw(B, 1) && pw(A, 1) === 12); ok('p2 equal', pw(A, 2) === pw(B, 2) && pw(A, 2) === 62); ok('p3 differ', pw(A, 3) === 342 && pw(B, 3) === 378);
}
{
  // road: train the plain MLP on shuffled lists.  Same budget, then a wider net with 13 times the steps
  const small = PN.fitMLP(1, 300, { shuffle: true }), wide = PN.fitMLP(1, 4000, { shuffle: true, hid: [128, 64], lr: 0.003 });
  const big = TEST.map(c => c);                                                   // same test clouds, in scan order (the augmented nets must not care)
  const r = FL.rng(2), mv = (net, sub) => { const mvs = []; sub.forEach(c => { const p0 = sm(refMLP(net, c.x))[1]; for (let k = 0; k < 8; k++) { const q = PN.shuffle(c, r); mvs.push(Math.abs(sm(refMLP(net, q.x))[1] - p0)); } }); return mean(mvs); };
  facts.aug_small_acc = 100 * accOf(SHUF, c => refMLP(small, c.x)); facts.aug_wide_acc = 100 * accOf(SHUF, c => refMLP(wide, c.x));
  facts.aug_wide_change = mv(wide, TEST.slice(0, 50)); facts.aug_steps_ratio = 4000 / 300; facts.aug_wide_steps = 4000;
  ok('shuffled training: small MLP stays near chance', facts.aug_small_acc < 62, facts.aug_small_acc);
  ok('shuffled training: wide MLP with 13x steps stays well below the PointNet', facts.aug_wide_acc < facts.pn_acc - 15, [facts.aug_wide_acc, facts.pn_acc]);
  ok('shuffled training: still not invariant', facts.aug_wide_change > 0.02, facts.aug_wide_change);
  void big;
}
{
  // road: sort the points.  Sorting by x then feeding a list: perturb every coordinate by 0.01 and re-sort
  const r = FL.rng(4), sortBy = (c, key) => { const idx = Array.from({ length: c.n }, (_, i) => i).sort((a, b) => key === 'x' ? c.x[2 * a] - c.x[2 * b] : Math.atan2(c.x[2 * a + 1], c.x[2 * a]) - Math.atan2(c.x[2 * b + 1], c.x[2 * b])); return PN.subset(c, idx); };
  const jit = (c, sd) => { const o = PN.subset(c, Array.from({ length: c.n }, (_, i) => i)); for (let i = 0; i < o.x.length; i++) o.x[i] += sd * FL.randn(r); return o; };
  for (const key of ['x', 'angle']) {
    const jumps = [], changed = [];
    TEST.forEach(c => { const a = sortBy(c, key), b = sortBy(jit(c, 0.01), key); jumps.push(Math.max(...Array.from(a.x, (v, i) => Math.abs(v - b.x[i])))); });
    facts['sort_jump_' + key] = mean(jumps);
  }
  facts.sort_noise = 0.01;
  ok('sorting by x: input jumps far more than the noise', facts.sort_jump_x > 20 * 0.01, facts.sort_jump_x);
  ok('sorting by angle: input moves about as much as the noise', facts.sort_jump_angle < 0.15, facts.sort_jump_angle);
}

/* ───────────── C. the critical set ───────────── */
const CRIT = TEST.map(c => { const R = refSet(SETNET, c.x, c.n), seen = new Set(); for (let f = 0; f < R.g.length; f++) { if (R.g[f] <= 1e-12) continue; let bi = 0; for (let i = 0; i < c.n; i++) if (R.feats[i][f] > R.feats[bi][f]) bi = i; seen.add(bi); } return Array.from(seen).sort((a, b) => a - b); });
{
  let same = true; TEST.forEach((c, i) => { const e = PN.critical(SETNET, c.x, c.n); if (e.join() !== CRIT[i].join()) same = false; });
  ok('critical set: engine == brute force', same);
  facts.crit_mean = mean(CRIT.map(c => c.length)); facts.crit0 = CRIT[0].length; facts.crit_max = Math.max(...CRIT.map(c => c.length)); facts.crit_min = Math.min(...CRIT.map(c => c.length));
  // exact indifference: keep only the critical points -> the pooled vector and the output are identical to the last bit; delete one critical point -> the pooled vector moves
  let dKeep = 0, dOut = 0, minMove = Infinity;
  TEST.forEach((c, i) => {
    const full = refSet(SETNET, c.x, c.n), K = PN.subset(c, CRIT[i]), kr = refSet(SETNET, K.x, K.n);
    dKeep = Math.max(dKeep, maxDiff(full.g, kr.g)); dOut = Math.max(dOut, maxDiff(full.out, kr.out));
    const rest = []; for (let k = 0; k < c.n; k++) if (k !== CRIT[i][0]) rest.push(k);
    const Rr = refSet(SETNET, PN.subset(c, rest).x, c.n - 1); minMove = Math.min(minMove, maxDiff(full.g, Rr.g));
  });
  ok('keeping only the critical points changes nothing', dKeep === 0 && dOut === 0, [dKeep, dOut]);
  ok('deleting a critical point always moves the pooled vector', minMove > 1e-6, minMove);
  facts.keep_only_crit_err = dKeep;
}
const RANKS = TEST.map((c, i) => { const r = FL.rng(500 + i), idx = Array.from({ length: c.n }, (_, k) => k); for (let k = c.n - 1; k > 0; k--) { const j = Math.floor(r() * (k + 1)); [idx[k], idx[j]] = [idx[j], idx[k]]; } const isC = q => CRIT[i].includes(q); return { rand: idx, non: idx.filter(q => !isC(q)).concat(idx.filter(isC)), cri: idx.filter(isC).concat(idx.filter(q => !isC(q))) }; });
function accAt(how, f) {
  return mean(TEST.map((c, i) => { const d = Math.round(f * c.n), gone = new Set(RANKS[i][how].slice(0, d)), keep = []; for (let k = 0; k < c.n; k++) if (!gone.has(k)) keep.push(k); const K = PN.subset(c, keep); const o = refSet(SETNET, K.x, K.n).out; return (o[1] > o[0] ? 1 : 0) === c.y ? 1 : 0; }));
}
{
  for (const f of [0.25, 0.5, 0.7, 0.75, 0.9]) for (const how of ['non', 'rand', 'cri']) facts['acc_' + how + '_' + Math.round(f * 100)] = 100 * accAt(how, f);
  facts.acc_full = 100 * accAt('non', 0);
  ok('non-critical first: accuracy unchanged while the critical points survive', facts.acc_non_50 === facts.acc_full, [facts.acc_non_50, facts.acc_full]);
  ok('critical first hurts more than random at 50%', facts.acc_cri_50 < facts.acc_rand_50, [facts.acc_cri_50, facts.acc_rand_50]);
  ok('deleting half the points, critical ones first, costs under 8 points and no more than 3 points beyond random deletion (section 3 says accuracy falls little)', facts.acc_full - facts.acc_cri_50 < 8 && facts.acc_rand_50 - facts.acc_cri_50 <= 3, [facts.acc_full, facts.acc_cri_50, facts.acc_rand_50]);
}

{
  // the pooled-vector change for the widget's first cloud (independent of the lab): ||g_kept - g_full|| / ||g_full||
  const c = TEST[0], full = refSet(SETNET, c.x, c.n).g;
  const dgAt = (how, f) => { const d = Math.round(f * c.n), gone = new Set(RANKS[0][how].slice(0, d)), keep = []; for (let k = 0; k < c.n; k++) if (!gone.has(k)) keep.push(k); const K = PN.subset(c, keep), g = refSet(SETNET, K.x, K.n).g; return Math.sqrt(sum(g, (v, i) => (v - full[i]) ** 2) / sum(full, v => v * v)); };
  facts.dg_non70 = dgAt('non', 0.7); facts.dg_cri50 = dgAt('cri', 0.5);
  ok('non-critical first at 70%: the pooled vector has not moved', facts.dg_non70 === 0, facts.dg_non70);
  ok('critical first at 50%: the pooled vector has moved', facts.dg_cri50 > 0.02, facts.dg_cri50);
}

/* ───────────── D. what a convolution costs ───────────── */
const SCAN = PN.scan(720, 3);
function brute(pts, h, mode) {
  const B = PN.BOX, gx = Math.ceil((B[1] - B[0]) / h), gz = Math.ceil((B[3] - B[2]) / h), key = (i, j) => i + ',' + j, occ = new Set();
  pts.forEach(p => { const i = Math.floor((p.x - B[0]) / h), j = Math.floor((p.z - B[2]) / h); if (i >= 0 && i < gx && j >= 0 && j < gz) occ.add(key(i, j)); });
  const win = []; for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) win.push([a, b]);
  const inGrid = (i, j) => i >= 0 && i < gx && j >= 0 && j < gz;
  let macs = 0; const out = new Set();
  if (mode === 'dense') { macs = gx * gz * 9; }
  else for (const s of occ) {
    const [i, j] = s.split(',').map(Number);
    if (mode === 'submanifold') out.add(s);
    for (const [a, b] of win) {
      if (!inGrid(i + a, j + b)) continue;
      if (mode === 'sparse') { macs++; out.add(key(i + a, j + b)); } else if (occ.has(key(i + a, j + b))) macs++;
    }
  }
  return { gx, gz, occ: occ.size, macs, out: out.size, set: occ };
}
{
  let worst = 0;
  for (const h of [0.4, 0.2, 0.1, 0.05]) {
    const G = PN.grid(SCAN, h);
    for (const mode of ['dense', 'sparse', 'submanifold']) {
      const b = brute(SCAN, h, mode), e = PN.layer(G, 3, mode);
      worst = Math.max(worst, Math.abs(b.macs - e.macs), Math.abs(b.occ - G.n), mode === 'dense' ? 0 : Math.abs(b.out - e.n));
    }
  }
  ok('layer counts: engine == brute force', worst === 0, worst);
  // the table of the lesson
  for (const [h, tag] of [[0.4, '40'], [0.2, '20'], [0.1, '10'], [0.05, '5']]) {
    const d = brute(SCAN, h, 'dense'), s = brute(SCAN, h, 'sparse'), m = brute(SCAN, h, 'submanifold');
    facts['g_cells_' + tag] = d.gx * d.gz; facts['g_occ_' + tag] = d.occ; facts['g_pct_' + tag] = 100 * d.occ / (d.gx * d.gz);
    facts['g_dense_' + tag] = d.macs; facts['g_sparse_' + tag] = s.macs; facts['g_ratio_' + tag] = d.macs / s.macs; facts['g_sub_' + tag] = m.macs; facts['g_gx_' + tag] = d.gx; facts['g_gz_' + tag] = d.gz;
    // the saving is exactly the empty share (up to the grid border): dense/sparse * occupancy = 1
    ok('dense/sparse == 1/occupancy (h=' + h + ')', close(facts['g_ratio_' + tag] * d.occ / (d.gx * d.gz), 1, 0.03), facts['g_ratio_' + tag] * d.occ / (d.gx * d.gz));
  }
  // dilation by repeated union of shifted copies, against the engine's layer stack
  const h = 0.1, base = brute(SCAN, h, 'sparse'); let cur = base.set; const sites = [cur.size], G = PN.grid(SCAN, h);
  for (let l = 0; l < 4; l++) { const nxt = new Set(); for (const s of cur) { const [i, j] = s.split(',').map(Number); for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) if (i + a >= 0 && i + a < base.gx && j + b >= 0 && j + b < base.gz) nxt.add((i + a) + ',' + (j + b)); } cur = nxt; sites.push(cur.size); }
  const ds = PN.depth(G, 3, 'sparse', 4), dm = PN.depth(G, 3, 'submanifold', 4);
  ok('active sites after k sparse layers == repeated dilation', ds.sites.join() === sites.join(), [ds.sites, sites]);
  ok('submanifold keeps the active set', dm.sites.every(v => v === sites[0]), dm.sites);
  facts.sites0 = sites[0]; for (let l = 1; l <= 4; l++) { facts['sites_sp_' + l] = sites[l]; facts['sites_sm_' + l] = dm.sites[l]; facts['macs_sp_' + l] = ds.macs[l - 1]; }
  facts.grow4 = sites[4] / sites[0]; facts.ratio4 = (4 * brute(SCAN, h, 'dense').macs) / sum(ds.macs); facts.ratio4_sub = (4 * brute(SCAN, h, 'dense').macs) / sum(dm.macs);
  facts.sub_sum4 = sum(dm.macs); facts.sp_sum4 = sum(ds.macs);
  ok('after four layers the sparse saving has shrunk', facts.ratio4 < facts.g_ratio_10 / 2, [facts.ratio4, facts.g_ratio_10]);
}
{
  // three dimensions: the cells a sphere of radius 60 cells touches in a 128^3 grid (a cell is touched when its corners lie on both sides of the surface)
  const N = 128, R = 60, c = N / 2; let touched = 0;
  const inside = (x, y, z) => (x - c) ** 2 + (y - c) ** 2 + (z - c) ** 2 < R * R;
  for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) for (let k = 0; k < N; k++) {
    let n = 0; for (let a = 0; a < 2; a++) for (let b = 0; b < 2; b++) for (let d = 0; d < 2; d++) if (inside(i + a, j + b, k + d)) n++;
    if (n > 0 && n < 8) touched++;
  }
  facts.sph_cells = touched; facts.sph_total = N ** 3; facts.sph_pct = 100 * touched / N ** 3; facts.sph_ratio = N ** 3 / touched; facts.sph_area = 4 * Math.PI * R * R;
  ok('a sphere touches about its area in cells', touched > 0.9 * facts.sph_area && touched < 1.6 * facts.sph_area, [touched, facts.sph_area]);
  facts.d_vox = 128 ** 3;
  // the checkpoint: 600 occupied cells of a 200 x 100 grid, 3x3 window; and the sphere with a 3x3x3 window
  facts.ck_dense = 200 * 100 * 9; facts.ck_sparse = 600 * 9; facts.ck_ratio = facts.ck_dense / facts.ck_sparse; ok('checkpoint ratio is the reciprocal occupancy', close(facts.ck_ratio, 100 / 3, 1e-9));
  facts.ck3_dense = 128 ** 3 * 27 / 1e6; facts.ck3_sparse = touched * 27 / 1e6; facts.ck3_ratio = 128 ** 3 / touched;
  // PointPillars arithmetic from the published figures: D = 9, P = 12000, N = 100; 6000 to 9000 non-empty pillars at about 97% empty; 16.2 ms; VoxelNet 225 ms
  facts.pp_tensor_e6 = 9 * 12000 * 100 / 1e6; facts.pp_cells_lo_e5 = 6000 / 0.03 / 1e5; facts.pp_cells_hi_e5 = 9000 / 0.03 / 1e5;
  facts.pp_hz = 1000 / 16.2; facts.pp_vs_voxelnet = 225 / 16.2; facts.pp_enc = 190 / 1.3; facts.pp_dense_tensor_e8 = 9 * (6000 / 0.03) * 100 / 1e8;
}

/* ───────────── E. the exit: one answer per input ───────────── */
const BACK = PN.fitBack(3, 800), CLS = PN.classes();
function dist(a, b) {                                   // rms radius difference over the directions the front view did not face, in cm of the 1.15 m statue
  const rad = (th, p) => { let r = 1; for (let k = 1; k <= 5; k++) r += th[2 * k - 2] * Math.cos(k * p) + th[2 * k - 1] * Math.sin(k * p); return r; };
  let s = 0, n = 0;
  for (let q = 0; q < 72; q++) { const p = -Math.PI + 2 * Math.PI * (q + 0.5) / 72; let d = p - PN.ALPHA; d = Math.atan2(Math.sin(d), Math.cos(d)); if (Math.abs(d) <= PN.HALF + 1e-9) continue; s += (rad(a, p) - rad(b, p)) ** 2; n++; }
  return 115 * Math.sqrt(s / n);
}
{
  ok('engine distance == independent distance', close(dist(PN.shape(0, FL.rng(1)), PN.shape(1, FL.rng(2))), PN.dist(PN.shape(0, FL.rng(1)), PN.shape(1, FL.rng(2))), 1e-9));
  const z = PN.zOf(PN.thetaOf([1.3, -0.4])); ok('scores round-trip', close(z[0], 1.3, 1e-9) && close(z[1], -0.4, 1e-9), z);
  // 1500 draws, alternating kinds; the closed-form weight of the oval explanation for each front
  const rng = FL.rng(2468), items = [];
  for (let i = 0; i < 1500; i++) {
    const c = i % 2, th = PN.shape(c, rng), cl = PN.front(th, 16, rng), rad = []; for (let k = 0; k < cl.n; k++) rad.push(Math.hypot(cl.x[2 * k], cl.x[2 * k + 1]));
    const mp = SH.mixturePosterior(cl.ang, rad, PN.FSD, CLS);
    items.push({ c, th, cl, mp, w: mp[0].w });
  }
  const bal = items.filter(it => Math.abs(it.w - 0.5) < 0.15);
  facts.amb_share = 100 * bal.length / items.length; facts.amb_n = bal.length;
  const rms = f => Math.sqrt(mean(bal.map(f)));
  const out = it => PN.thetaOf(refSet(BACK, it.cl.x, it.cl.n).out);
  facts.amb_dO = rms(it => dist(out(it), it.mp[0].mean) ** 2); facts.amb_dT = rms(it => dist(out(it), it.mp[1].mean) ** 2); facts.amb_dOT = rms(it => dist(it.mp[0].mean, it.mp[1].mean) ** 2);
  facts.amb_gap_mean = rms(it => dist(out(it), SH.mixtureMean(it.mp)) ** 2);
  facts.amb_err_net = rms(it => dist(out(it), it.th) ** 2); facts.amb_err_mean = rms(it => dist(SH.mixtureMean(it.mp), it.th) ** 2);
  facts.amb_err_commit = rms(it => dist(it.mp[0].w > 0.5 ? it.mp[0].mean : it.mp[1].mean, it.th) ** 2);
  // do both explanations really fit the front?  rms residual of the 16 readings about each explanation, in cm, against the sensor noise
  const resid = (it, c) => { const A = SH.design(it.cl.ang), n = it.cl.n; let q = 0; for (let k = 0; k < n; k++) { let pr = 1; for (let i = 0; i < 10; i++) pr += A[k * 10 + i] * it.mp[c].mean[i]; q += (Math.hypot(it.cl.x[2 * k], it.cl.x[2 * k + 1]) - pr) ** 2; } return q / n; };
  facts.amb_resO = 115 * rms(it => resid(it, 0)); facts.amb_resT = 115 * rms(it => resid(it, 1)); facts.amb_noise = 115 * PN.FSD;
  ok('both explanations fit the front to within the noise', facts.amb_resO < facts.amb_noise * 1.05 && facts.amb_resT < facts.amb_noise * 1.05, [facts.amb_resO, facts.amb_resT, facts.amb_noise]);
  // and the network's own answer, and the midpoint of the two explanations: do they fit the front too?  (rms residual on the sixteen readings, cm)
  const residTh = (it, th) => { const A = SH.design(it.cl.ang), n = it.cl.n; let q = 0; for (let k = 0; k < n; k++) { let pr = 1; for (let i = 0; i < 10; i++) pr += A[k * 10 + i] * th[i]; q += (Math.hypot(it.cl.x[2 * k], it.cl.x[2 * k + 1]) - pr) ** 2; } return q / n; };
  facts.amb_resNet = 115 * rms(it => residTh(it, out(it)));
  facts.amb_resMid = 115 * rms(it => residTh(it, Array.from(it.mp[0].mean, (v, i) => 0.5 * (v + it.mp[1].mean[i]))));
  ok('the midpoint of two explanations fits the front no worse than their mean residual (residuals are linear in the outline)', facts.amb_resMid <= 0.5 * (facts.amb_resO + facts.amb_resT) + 1e-6, [facts.amb_resMid, facts.amb_resO, facts.amb_resT]);
  facts.amb_wmin = Math.min(...bal.map(it => it.w)); facts.amb_wmax = Math.max(...bal.map(it => it.w));
  ok('the network answers near the average of the two explanations', facts.amb_gap_mean < 0.25 * facts.amb_dOT, [facts.amb_gap_mean, facts.amb_dOT]);
  ok('the answer is about as far from either explanation', Math.abs(facts.amb_dO - facts.amb_dT) < 0.2 * facts.amb_dOT, [facts.amb_dO, facts.amb_dT]);
  ok('committing to the likelier explanation errs more than the average', facts.amb_err_commit > 1.1 * facts.amb_err_mean, [facts.amb_err_commit, facts.amb_err_mean]);
  ok('the network is near the best squared-error answer', facts.amb_err_net < 1.15 * facts.amb_err_mean, [facts.amb_err_net, facts.amb_err_mean]);
  // the two explanations are the Gaussian posterior means of lesson 11, rebuilt from the stacked least-squares system for the first balanced front
  const it0 = bal[0], D = 10;
  [0, 1].forEach(c => {
    const cl = it0.cl, rad = []; for (let k = 0; k < cl.n; k++) rad.push(Math.hypot(cl.x[2 * k], cl.x[2 * k + 1]) - 1);
    const A = SH.design(cl.ang), n = cl.n, s2 = PN.FSD * PN.FSD, Li = SH.minv(CLS[c].Lam, D), M = new Float64Array(D * D), rhs = new Float64Array(D);
    for (let i = 0; i < D; i++) for (let j = 0; j < D; j++) { let v = Li[i * D + j]; for (let k = 0; k < n; k++) v += A[k * D + i] * A[k * D + j] / s2; M[i * D + j] = v; }
    for (let i = 0; i < D; i++) { let v = 0; for (let j = 0; j < D; j++) v += Li[i * D + j] * CLS[c].mu[j]; for (let k = 0; k < n; k++) v += A[k * D + i] * rad[k] / s2; rhs[i] = v; }
    ok('explanation == stacked normal equations (kind ' + c + ')', maxDiff(FL.solve(M, rhs, D), it0.mp[c].mean) < 1e-9);
  });
  // squared error prefers the average: two equally likely answers a, b at distance D; the answer at the midpoint is D/2 from both, committing is 0 or D
  const Dd = facts.amb_dOT; facts.rms_mid = Dd / 2; facts.rms_commit = Dd / Math.SQRT2;
  // the widget's example: front number 1 of PN.ambiguous(11, 400, 8)
  const amb = PN.ambiguous(11, 400, 8), a0 = amb[0], z0 = Array.from(refSet(BACK, a0.cl.x, a0.cl.n).out), th0 = PN.thetaOf(z0);
  facts.ex_z1 = z0[0]; facts.ex_z2 = z0[1]; facts.ex_dO = dist(th0, a0.oval); facts.ex_dT = dist(th0, a0.tref); facts.ex_dOT = dist(a0.oval, a0.tref);
  facts.ex_w = a0.w; ok('front 1 is balanced', Math.abs(a0.w - 0.5) < 0.05, a0.w);
  facts.ex_rms_mid = facts.ex_dOT / 2; facts.ex_rms_commit = facts.ex_dOT / Math.SQRT2;
  ok('example: the answer is near the midpoint', Math.abs(facts.ex_dO - facts.ex_dT) < 0.1 * facts.ex_dOT, [facts.ex_dO, facts.ex_dT]);
  // how often does the world produce an object with both scores above 0.8?
  const r2 = FL.rng(31337); let rare = 0, zs = 0; for (let i = 0; i < 4000; i++) { const zz = PN.zOf(PN.shape(i % 2, r2)); zs += zz[i % 2]; if (zz[0] > 0.8 && zz[1] > 0.8) rare++; }
  facts.z_typ = zs / 4000;       // an oval's elongation and a trefoil's triangularity, averaged: the 1.6 the world is built on (SH.classes: mu = 1.6 x factor)
  facts.rare = rare; facts.rare_of = 4000; ok('the answer is a combination the world almost never makes', rare <= 12, rare);
  const zo = PN.zOf(a0.oval), zt = PN.zOf(a0.tref); facts.ex_zo1 = zo[0]; facts.ex_zo2 = zo[1]; facts.ex_zt1 = zt[0]; facts.ex_zt2 = zt[1];
  // where the front is informative the network is accurate: share of draws where its class-weighted answer is within 6 cm of the closed-form mean
  facts.all_gap_mean = Math.sqrt(mean(items.map(it => dist(out(it), SH.mixtureMean(it.mp)) ** 2)));
}

/* ───────────── the page's widget, driven into each state the prose quotes ───────────── */
const PAGE = path.join(DIR, '12_networks_for_3d.html');
if (fs.existsSync(PAGE)) {
  const page = loadPage(PAGE, { dpr: 1 });
  ok('page loads cleanly', page.problems.length === 0, page.problems.join(' | '));
  const n = id => page.num(id);
  // view 1 at 0% deleted: the readouts equal the independent numbers
  ok('widget: PointNet accuracy', close(n('w12-m1'), facts.pn_acc, 0.51), [n('w12-m1'), facts.pn_acc]);
  ok('widget: MLP in scan order', close(n('w12-m2'), facts.mlp_order, 0.51), [n('w12-m2'), facts.mlp_order]);
  ok('widget: MLP shuffled', close(n('w12-m3'), facts.mlp_shuf, 0.51), [n('w12-m3'), facts.mlp_shuf]);
  ok('widget: PointNet answer moves by 0', n('w12-m5') === 0);
  ok('widget: critical points of cloud 1', close(n('w12-m6'), facts.crit0, 0.01), [n('w12-m6'), facts.crit0]);
  {
    const c = TEST[0], r = FL.rng(1000), p0 = sm(refMLP(MLPNET, c.x))[1]; let m = 0;
    for (let k = 0; k < 24; k++) { const q = PN.shuffle(c, r); m += Math.abs(sm(refMLP(MLPNET, q.x))[1] - p0) / 24; }
    ok('widget: MLP answer moves (cloud 1)', close(n('w12-m4'), m, 0.0051), [n('w12-m4'), m]); facts.mlp_change0 = m;
  }
  // view 1, non-critical first at 70%
  page.set('w12-del', 70);
  ok('widget 70%, non-critical first: accuracy unchanged', close(n('w12-m1'), facts.acc_non_70, 0.51), [n('w12-m1'), facts.acc_non_70]);
  ok('widget 70%: pooled feature has not moved', n('w12-m7') === 0, n('w12-m7')); facts.kept70 = 32 - Math.round(0.7 * 32);
  page.set('w12-how', 'cri'); page.set('w12-del', 50);
  ok('widget 50%, critical first', close(n('w12-m1'), facts.acc_cri_50, 0.51), [n('w12-m1'), facts.acc_cri_50]); facts.dg_cri50 = n('w12-m7'); ok('critical-first moves the pooled feature', n('w12-m7') > 0.02, n('w12-m7'));
  page.set('w12-how', 'rand');
  ok('widget 50%, random', close(n('w12-m1'), facts.acc_rand_50, 0.51), [n('w12-m1'), facts.acc_rand_50]);
  page.set('w12-how', 'non'); page.set('w12-del', 0);
  // view 2
  page.set('w12-view', 'scan'); page.set('w12-cell', 10);
  ok('widget scan: occupied cells', n('w12-m2') === facts.g_occ_10, [n('w12-m2'), facts.g_occ_10]);
  ok('widget scan: dense multiply-adds', n('w12-m3') === facts.g_dense_10, [n('w12-m3'), facts.g_dense_10]);
  ok('widget scan: sparse multiply-adds', n('w12-m4') === facts.g_sparse_10, [n('w12-m4'), facts.g_sparse_10]);
  ok('widget scan: ratio', close(n('w12-m5'), facts.g_ratio_10, 0.051), [n('w12-m5'), facts.g_ratio_10]);
  ok('widget scan: submanifold', n('w12-m6') === facts.g_sub_10, [n('w12-m6'), facts.g_sub_10]);
  ok('widget scan: active after 4 sparse layers', n('w12-m7') === facts.sites_sp_4, [n('w12-m7'), facts.sites_sp_4]);
  page.set('w12-cell', 5);
  ok('widget scan 5 cm: ratio', close(n('w12-m5'), facts.g_ratio_5, 0.051), [n('w12-m5'), facts.g_ratio_5]);
  // view 3
  page.set('w12-view', 'back');
  ok('widget back: elongation score', close(n('w12-m1'), facts.ex_z1, 0.0051), [n('w12-m1'), facts.ex_z1]);
  ok('widget back: triangularity score', close(n('w12-m2'), facts.ex_z2, 0.0051), [n('w12-m2'), facts.ex_z2]);
  ok('widget back: distance to the oval', close(n('w12-m3'), facts.ex_dO, 0.051), [n('w12-m3'), facts.ex_dO]);
  ok('widget back: distance to the trefoil', close(n('w12-m4'), facts.ex_dT, 0.051), [n('w12-m4'), facts.ex_dT]);
  ok('widget back: the two apart', close(n('w12-m5'), facts.ex_dOT, 0.051), [n('w12-m5'), facts.ex_dOT]);
  ok('widget back: rare objects', n('w12-m6') === facts.rare, [n('w12-m6'), facts.rare]);
  ok('widget ran without errors', page.problems.length === 0, page.problems.join(' | '));
}

console.error(fails ? `${fails} check(s) FAILED` : 'all checks passed');
console.log(JSON.stringify({ facts }));
process.exit(fails ? 1 : 0);
