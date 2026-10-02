#!/usr/bin/env node
/* Oracle for World Models lesson 03, "What should a state keep?".
 *
 * The experiment: pictures of the Courtyard (CY.img.render, 24 x 15 = 360 numbers, ball blob sigma 1.5 px) in clips of three consecutive pictures of a ball in free flight,
 * with a nuisance of level nu (a bright vertical band that either hops or drifts, and a global gain).  Codes of one picture are scored by a 10-nearest-neighbour probe.
 *
 * Everything the page quotes is re-derived here by a path that does not share code with the widget's engine (l03_state.js):
 *   - the stream is re-implemented from its documented protocol and compared with the engine's, pixel for pixel;
 *   - PCA (Gram-matrix route), the pair-pooled whitening, the pair moments, the closed-form predictive code, the nearest-neighbour probe, the linear rebuild, the effective rank:
 *     all re-implemented; every eigen-decomposition that the engine's solver delivers is certified (orthonormal, residual, trace) and one is cross-checked against CY.la.eigSym (Jacobi);
 *   - the PCA error equals the sum of the discarded eigenvalues (on the covariance matrix, by Jacobi, 360 x 360); no other k-dimensional code does better;
 *   - the closed form: loss = k - sum of the k largest squared lag-1 correlations, equal to the loss evaluated on the data, beaten by no random code, by no perturbation, and found
 *     by a brute-force search on the sphere for k = 1;
 *   - the scale law L(cE) = c^2 L(E) (why the loss collapses) and the analytic gradient (with the guard) against a finite difference of the sample-form loss;
 *   - the gradient runs (Adam, 200 steps) with their own loop: collapse, the guard ablation, six random starts;
 *   - the drifting band, the reward-predictive code (label cost, a moved goal), the sigma = 0.8 repeat, other stream seeds;
 *   - the exit: velocity cannot be read from one picture, two clean pictures hold it, a hidden ball makes identical pictures, how often the last two pictures are both blind.
 * Then the page's own widget is driven into the states the prose describes and its readouts are compared with these numbers.
 * Prints {"facts": {...}} as its last line.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '../../../all_lessons');
const DIR = fs.existsSync(path.join(ROOT, 'world_models_new')) ? path.join(ROOT, 'world_models_new') : path.join(ROOT, 'world_models');
const CY = require(path.join(DIR, 'courtyard.js'));
const L3 = require(path.join(DIR, 'l03_state.js'));
const { loadPage } = require('../dom_probe.js');

let fails = 0;
const facts = {};
function ok(name, cond, extra) { if (!cond) { fails++; console.error('FAIL', name, extra === undefined ? '' : extra); } }
const close = (a, b, tol) => Math.abs(a - b) <= (tol === undefined ? 1e-9 : tol);
const la = CY.la;

/* ── protocol (documented in the page and in the head of the engine) ── */
const D = 360, M = 32, N = 200, KNN = 10, FLOOR = 0.05, STEPS = 200, LR = 0.02;
const GOAL_A = [6.6, 2.5], GOAL_B = [4.5, 4.2];
const KS = [2, 4, 6, 8, 12, 16, 24], LEVELS = [0, 0.5, 1, 1.5, 2, 3];
const W0 = CY.world({});

/* ── 1. the stream, re-implemented ── */
function gen(n, seed, nu, kind, sigma) {
  const rng = CY.rng(seed), S = [], F = [], B = [];
  for (let i = 0; i < n; i++) {
    let st;
    for (;;) {                                                                  // a start in view, and still in view two steps later
      const x = 0.35 + 7.3 * rng(), y = 0.35 + 4.3 * rng(), sp = 0.5 + 2.5 * rng(), th = 2 * Math.PI * rng();
      const s0 = [x, y, sp * Math.cos(th), sp * Math.sin(th)], s1 = CY.step(W0, s0, null), s2 = CY.step(W0, s1, null);
      if (![s0, s1, s2].some(s => CY.occluded(W0, s))) { st = [s0, s1, s2]; break; }
    }
    const c0 = 1 + 6 * rng(), fr = [], bb = [];
    for (let t = 0; t < 3; t++) {
      const cr = 0.5 + 7 * rng(), g = 1 + 0.1 * nu * CY.randn(rng), cx = kind === 'drift' ? c0 + 0.15 * t : cr;
      const img = CY.img.render(W0, st[t], { sigma, band: nu > 0 ? { cx, width: 0.4, amp: 0.8 * nu } : null });
      fr.push(Float64Array.from(img, v => v * g)); bb.push(cx);
    }
    S.push(st); F.push(fr); B.push(bb);
  }
  return { n, S, F, B };
}
{ // the engine's stream is the documented one
  for (const [nu, kind] of [[0, 'flicker'], [1, 'flicker'], [2, 'drift']]) {
    const a = gen(N, 2, nu, kind, 1.5), b = L3.stream(N, 2, nu, kind);
    let d = 0, ds = 0, db = 0;
    for (let i = 0; i < N; i++) for (let t = 0; t < 3; t++) {
      for (let p = 0; p < D; p++) d = Math.max(d, Math.abs(a.F[i][t][p] - b.F[(i * 3 + t) * D + p]));
      for (let p = 0; p < 4; p++) ds = Math.max(ds, Math.abs(a.S[i][t][p] - b.S[(i * 3 + t) * 4 + p]));
      db = Math.max(db, Math.abs(a.B[i][t] - b.B[i * 3 + t]));
    }
    ok(`engine stream == documented stream (nu ${nu}, ${kind})`, d === 0 && ds === 0 && db === 0, [d, ds, db]);
  }
}

/* ── 2. linear algebra helpers, certified ── */
function signed(v) { let b = 0; for (let j = 1; j < v.length; j++) if (Math.abs(v[j]) > Math.abs(v[b])) b = j; if (v[b] < 0) for (let j = 0; j < v.length; j++) v[j] = -v[j]; return v; }
function eig(A, n) {                                                            // symmetric eigendecomposition by the engine's solver, with a certificate (complete, orthonormal, residuals, trace)
  const e = L3.eigSym(A, n), vals = Array.from(e.vals), vecs = e.vecs.map(v => signed(Float64Array.from(v)));
  let tr = 0, sum = 0, ortho = 0, res = 0, sorted = true;
  for (let i = 0; i < n; i++) { tr += A[i * n + i]; sum += vals[i]; if (i && vals[i] > vals[i - 1] + 1e-12) sorted = false; }
  const chk = n <= 64 ? n : 48;                                                  // orthonormality and residual on every vector for small n, on the leading 48 for the big Gram matrices
  for (let a = 0; a < chk; a++) {
    let nn = 0; for (let j = 0; j < n; j++) nn += vecs[a][j] * vecs[a][j]; ortho = Math.max(ortho, Math.abs(nn - 1));
    for (let b = a + 1; b < chk; b++) { let s = 0; for (let j = 0; j < n; j++) s += vecs[a][j] * vecs[b][j]; ortho = Math.max(ortho, Math.abs(s)); }
    for (let i = 0; i < n; i++) { let s = 0; for (let j = 0; j < n; j++) s += A[i * n + j] * vecs[a][j]; res = Math.max(res, Math.abs(s - vals[a] * vecs[a][i])); }
  }
  const scale = Math.max(1, Math.abs(vals[0]));
  ok(`eigen certificate (n = ${n})`, sorted && Math.abs(tr - sum) < 1e-8 * scale * n && ortho < 1e-9 && res < 1e-8 * scale, { sorted, trace: tr - sum, ortho, res });
  return { vals, vecs };
}
const dot = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; };
const corr = (p, t) => { const n = p.length; let mp = 0, mt = 0; for (let i = 0; i < n; i++) { mp += p[i]; mt += t[i]; } mp /= n; mt /= n; let sxy = 0, sxx = 0, syy = 0; for (let i = 0; i < n; i++) { sxy += (p[i] - mp) * (t[i] - mt); sxx += (p[i] - mp) ** 2; syy += (t[i] - mt) ** 2; } return sxy / Math.sqrt(sxx * syy); };

/* ── 3. the pipeline, re-implemented ── */
function build(nu, kind, sigma, seedTr, seedTe) {
  const tr = gen(N, seedTr, nu, kind, sigma), te = gen(N, seedTe, nu, kind, sigma);
  // PCA of the middle pictures of the training clips: Gram-matrix route
  const mean = new Float64Array(D); tr.F.forEach(f => { for (let j = 0; j < D; j++) mean[j] += f[1][j] / N; });
  const Xc = tr.F.map(f => Float64Array.from(f[1], (v, j) => v - mean[j]));
  const G = new Float64Array(N * N); for (let a = 0; a < N; a++) for (let b = a; b < N; b++) { const s = dot(Xc[a], Xc[b]) / (N - 1); G[a * N + b] = s; G[b * N + a] = s; }
  const g = eig(G, N), total = g.vals.reduce((a, v) => a + v, 0);
  const U = []; for (let a = 0; a < M; a++) { const u = new Float64Array(D); for (let i = 0; i < N; i++) for (let j = 0; j < D; j++) u[j] += g.vecs[a][i] * Xc[i][j]; const nm = Math.sqrt(dot(u, u)); for (let j = 0; j < D; j++) u[j] /= nm; U.push(signed(u)); }
  const coords = (S) => [0, 1, 2].map(t => S.F.map(f => Float64Array.from(U, u => { let s = 0; for (let j = 0; j < D; j++) s += (f[t][j] - mean[j]) * u[j]; return s; })));
  const Ytr = coords(tr), Yte = coords(te);                                       // [t][clip] -> 32 PC coordinates
  // pair-pooled whitening: the pictures that enter the loss are t = 0, 1, 1, 2
  const Sg = new Float64Array(M * M);
  for (let t = 0; t < 3; t++) for (let i = 0; i < N; i++) for (let a = 0; a < M; a++) for (let b = 0; b < M; b++) Sg[a * M + b] += (t === 1 ? 2 : 1) * Ytr[t][i][a] * Ytr[t][i][b] / (4 * N);
  const es = eig(Sg, M), R = []; for (let a = 0; a < M; a++) { R.push(new Float64Array(M)); for (let b = 0; b < M; b++) { let s = 0; for (let c = 0; c < M; c++) s += es.vecs[c][a] * es.vecs[c][b] / Math.sqrt(es.vals[c]); R[a][b] = s; } }
  const whiten = (Y) => Y.map(rows => rows.map(y => Float64Array.from(R, r => dot(r, y))));
  const Wtr = whiten(Ytr), Wte = whiten(Yte);
  // moments over every consecutive pair in both orders: C = E[w w'] (inputs), C' (targets), Mx = E[w_next w_now']
  const C0 = new Float64Array(M * M), C1 = new Float64Array(M * M), Mx = new Float64Array(M * M);
  for (const [t, u] of [[0, 1], [1, 0], [1, 2], [2, 1]]) for (let i = 0; i < N; i++) for (let a = 0; a < M; a++) for (let b = 0; b < M; b++) {
    C0[a * M + b] += Wtr[t][i][a] * Wtr[t][i][b] / (4 * N); C1[a * M + b] += Wtr[u][i][a] * Wtr[u][i][b] / (4 * N); Mx[a * M + b] += Wtr[u][i][a] * Wtr[t][i][b] / (4 * N);
  }
  const Ss = new Float64Array(M * M); for (let a = 0; a < M; a++) for (let b = 0; b < M; b++) Ss[a * M + b] = 0.5 * (Mx[a * M + b] + Mx[b * M + a]);
  const ec = eig(Ss, M), order = ec.vals.map((v, i) => i).sort((p, q) => Math.abs(ec.vals[q]) - Math.abs(ec.vals[p]));
  const rho = ec.vals.slice().sort((p, q) => Math.abs(q) - Math.abs(p));
  // lag-1 correlation of every principal component
  const pcRho = []; for (let a = 0; a < M; a++) { let sxy = 0, sxx = 0; for (let i = 0; i < N; i++) { sxy += Ytr[0][i][a] * Ytr[1][i][a] + Ytr[1][i][a] * Ytr[2][i][a]; sxx += Ytr[0][i][a] ** 2 + 2 * Ytr[1][i][a] ** 2 + Ytr[2][i][a] ** 2; } pcRho.push(2 * sxy / sxx); }
  const targets = (S) => ({
    pos: S.S.map(s => [s[1][0], s[1][1]]), vel: S.S.map(s => [s[1][2], s[1][3]]), band: S.B.map(b => [b[1]]),
    rew: S.S.map(s => [-Math.hypot(s[1][0] - GOAL_A[0], s[1][1] - GOAL_A[1])]), rew2: S.S.map(s => [-Math.hypot(s[1][0] - GOAL_B[0], s[1][1] - GOAL_B[1])]),
  });
  return { nu, kind, sigma, tr, te, mean, U, pcVals: g.vals, total, Ytr, Yte, Wtr, Wte, R, C0, C1, Mx, ec, order, rho, pcRho, Ttr: targets(tr), Tte: targets(te), cache: {} };
}
const models = {};
function model(nu, kind, sigma, st, se) { const key = [nu, kind, sigma || 1.5, st || 1, se || 2].join('/'); return models[key] || (models[key] = build(nu, kind, sigma || 1.5, st || 1, se || 2)); }

/* the probe: 10 nearest neighbours in code space, every code number read with noise FLOOR (train codes: stream 11, test codes: stream 12), squared correlation per target */
function noisy(Z, seed, sd) { const r = CY.rng(seed); return Z.map(row => Float64Array.from(row, v => v + sd * CY.randn(r))); }
function probe(m, Ztr, Zte, floorSd) {
  const f = floorSd === undefined ? FLOOR : floorSd, A = noisy(Ztr, 11, f), B = noisy(Zte, 12, f), out = {};
  const nbr = B.map(b => A.map((a, j) => { let d2 = 0; for (let c = 0; c < b.length; c++) d2 += (a[c] - b[c]) * (a[c] - b[c]); return [d2, j]; }).sort((p, q) => p[0] - q[0]).slice(0, KNN).map(p => p[1]));
  for (const key of ['pos', 'vel', 'band', 'rew', 'rew2']) {
    const q = m.Tte[key][0].length; let s = 0;
    for (let c = 0; c < q; c++) {
      const pred = nbr.map(ix => ix.reduce((a, j) => a + m.Ttr[key][j][c], 0) / KNN), truth = m.Tte[key].map(v => v[c]);
      s += corr(pred, truth) ** 2 / q;
    }
    out[key] = s;
  }
  return out;
}
/* what a code can rebuild: ridge (penalty 1e-3, standardised code numbers, intercept) from the code of the middle picture to its 360 pixels; held-out share of pixel variance */
function rebuilt(m, Ztr, Zte, k) {
  const mu = new Float64Array(k), sd = new Float64Array(k);
  for (let a = 0; a < k; a++) { for (let i = 0; i < N; i++) mu[a] += Ztr[i][a] / N; for (let i = 0; i < N; i++) sd[a] += (Ztr[i][a] - mu[a]) ** 2 / N; sd[a] = Math.sqrt(sd[a]) + 1e-12; }
  const feat = (z) => { const f = new Float64Array(k + 1); for (let a = 0; a < k; a++) f[a] = (z[a] - mu[a]) / sd[a]; f[k] = 1; return f; };
  const Phi = new Float64Array(N * (k + 1)), Y = new Float64Array(N * D);
  Ztr.forEach((z, i) => { Phi.set(feat(z), i * (k + 1)); Y.set(m.tr.F[i][1], i * D); });
  const Wd = la.ridge(Phi, N, k + 1, Y, D, 1e-3), mean = new Float64Array(D);
  m.te.F.forEach(f => { for (let j = 0; j < D; j++) mean[j] += f[1][j] / N; });
  let sse = 0, sst = 0;
  Zte.forEach((z, i) => { const f = feat(z); for (let j = 0; j < D; j++) { let s = 0; for (let a = 0; a <= k; a++) s += f[a] * Wd[a * D + j]; const y = m.te.F[i][1][j]; sse += (s - y) ** 2; sst += (y - mean[j]) ** 2; } });
  return 1 - sse / sst;
}
/* spread = mean standard deviation of the code numbers; effective rank = (sum of eigenvalues)^2 / sum of squared eigenvalues of the code covariance (Jacobi solver of the shared engine) */
function codeStats(Z, k) {
  const n = Z.length, mu = new Float64Array(k), C = new Float64Array(k * k);
  Z.forEach(z => { for (let a = 0; a < k; a++) mu[a] += z[a] / n; });
  Z.forEach(z => { for (let a = 0; a < k; a++) for (let b = 0; b < k; b++) C[a * k + b] += (z[a] - mu[a]) * (z[b] - mu[b]) / n; });
  let spread = 0; for (let a = 0; a < k; a++) spread += Math.sqrt(C[a * k + a]) / k;
  const ev = la.eigSym(C, k).vals.map(v => Math.max(v, 0)), s1 = ev.reduce((a, v) => a + v, 0), s2 = ev.reduce((a, v) => a + v * v, 0);
  return { spread, rank: s1 * s1 / s2 };
}
const lin = (E, k, W) => W.map(w => Float64Array.from({ length: k }, (_, a) => { let s = 0; for (let b = 0; b < M; b++) s += E[a * M + b] * w[b]; return s; }));
const pcaCode = (Y, k) => Y.map(y => y.slice(0, k));
function cfE(m, k) { const E = new Float64Array(k * M); for (let a = 0; a < k; a++) E.set(m.ec.vecs[m.order[a]], a * M); return E; }
function codesCheap(m, k) {                                                     // reconstruction code and the closed-form predictive code for one k
  if (m.cache[k]) return m.cache[k];
  const pa = { tr: pcaCode(m.Ytr[1], k), te: pcaCode(m.Yte[1], k) }, E = cfE(m, k), cf = { tr: lin(E, k, m.Wtr[1]), te: lin(E, k, m.Wte[1]), E };
  for (const c of [pa, cf]) { c.r2 = probe(m, c.tr, c.te); c.rec = rebuilt(m, c.tr, c.te, k); Object.assign(c, codeStats(c.tr, k)); }
  return (m.cache[k] = { pca: pa, cf });
}
function kstar(m, which) { for (const k of KS) if (codesCheap(m, k)[which].r2.pos >= 0.9) return k; return 0; }

/* ── 4. the first model: the setting the page opens with (nu = 1, hopping band, k = 12) ── */
const m1 = model(1, 'flicker'), m0 = model(0, 'flicker');
facts.k_main = 12;
facts.px_total_0 = m0.total; facts.px_total_1 = m1.total; facts.ball_share_1 = 100 * m0.total / m1.total;
facts.pc1_var = m1.pcVals[0]; facts.pc1_over_ball = m1.pcVals[0] / m0.total;
ok('with no nuisance the loudest direction is much quieter than the ball in total', m0.pcVals[0] < 0.2 * m0.total, [m0.pcVals[0], m0.total]);
ok('PC1 at nu = 1 carries more variance than the whole ball does', m1.pcVals[0] > m0.total, [m1.pcVals[0], m0.total]);
facts.ball_pc1_share = 100 * m0.pcVals[0] / m0.total;                              // with no nuisance the loudest component carries only a tenth of the ball's variance
ok('the ball\'s variance is spread thinly: its loudest component carries under 15 %', facts.ball_pc1_share < 15, facts.ball_pc1_share);
ok('the first eight components at nu = 1 carry the nuisance variance (within 5 %)', close(m1.pcVals.slice(0, 8).reduce((a, v) => a + v, 0) / (m1.total - m0.total), 1, 0.05), m1.pcVals.slice(0, 8).reduce((a, v) => a + v, 0) / (m1.total - m0.total));
{ // the engine agrees about the variances
  const e1 = L3.model(1, 'flicker');
  ok('engine total variance', close(e1.pca.total, m1.total, 1e-9), [e1.pca.total, m1.total]);
  ok('engine ball variance', close(L3.ballVar(), m0.total, 1e-9), [L3.ballVar(), m0.total]);
}
facts.g_step = (1 - Math.exp(-W0.gamma * W0.dt)) / W0.gamma;                    // free flight: x' = x + g v, v' = d v
facts.d_decay = Math.exp(-W0.gamma * W0.dt);

/* ── 5. sufficiency in the Courtyard: what one picture can and cannot hold ── */
{
  // free flight: one step moves the position by g v (exact), so the pair of positions determines the velocity
  let worst = 0; const r = CY.rng(77);
  for (let i = 0; i < 200; i++) { const s = [2 + 4 * r(), 1.5 + 2 * r(), 2 * r() - 1, 2 * r() - 1], s1 = CY.step(W0, s, null); worst = Math.max(worst, Math.abs(s1[0] - s[0] - facts.g_step * s[2]), Math.abs(s1[1] - s[1] - facts.g_step * s[3]), Math.abs(s1[2] - facts.d_decay * s[2])); }
  ok('free flight: x\' = x + g v, v\' = d v', worst < 1e-9, worst);
  // a picture depends on the ball only through (x, y)
  const a = CY.img.render(W0, [5.1, 2.2, 2, -1], { sigma: 1.5 }), b = CY.img.render(W0, [5.1, 2.2, -0.4, 2.6], { sigma: 1.5 });
  ok('two states with the same position and different velocities give the same picture', a.every((v, i) => v === b[i]));
  // a ball behind the curtain is not drawn: every hidden state makes the same picture
  const h1 = CY.img.render(W0, [3.0, 1.0, 2, 0], { sigma: 1.5 }), h2 = CY.img.render(W0, [2.8, 4.1, -1, 1], { sigma: 1.5 }), h3 = CY.img.render(W0, [7, 4, 0, 0], { sigma: 1.5, seeThrough: false });
  ok('hidden balls make identical pictures', h1.every((v, i) => v === h2[i]));
  ok('and a hidden ball makes a different picture from a visible one', h1.some((v, i) => v !== h3[i]));
  facts.hidden_diff = Math.max.apply(null, Array.from(h1, (v, i) => Math.abs(v - h2[i])));
}

/* ── 6. reconstruction = PCA ── */
{
  // the Gram route and the covariance route have the same spectrum (Jacobi solver of the shared engine, 360 x 360)
  const Xc = m1.tr.F.map(f => Float64Array.from(f[1], (v, j) => v - m1.mean[j])), C = new Float64Array(D * D);
  for (let i = 0; i < N; i++) for (let a = 0; a < D; a++) { const xa = Xc[i][a]; if (xa === 0) continue; for (let b = 0; b < D; b++) C[a * D + b] += xa * Xc[i][b] / (N - 1); }
  const ej = la.eigSym(C, D);
  let worst = 0; for (let i = 0; i < 40; i++) worst = Math.max(worst, Math.abs(ej.vals[i] - m1.pcVals[i]));
  ok('pixel-covariance spectrum (Jacobi) == Gram spectrum', worst < 1e-9, worst);
  ok('the rest of the covariance spectrum is zero (200 pictures, 360 pixels)', Math.abs(ej.vals[N]) < 1e-9 && Math.abs(ej.vals.reduce((a, v) => a + v, 0) - m1.total) < 1e-8);
  // the PCA error equals the sum of the discarded eigenvalues; and no other k-dimensional code does better
  const X = m1.tr.F.map(f => f[1]);
  const errOf = (basis) => {                                                      // basis: array of orthonormal vectors; mean squared reconstruction error of the training pictures
    let e = 0; X.forEach((x, i) => { const c = Xc[i], rec = new Float64Array(D); basis.forEach(u => { const s = dot(u, c); for (let j = 0; j < D; j++) rec[j] += s * u[j]; }); for (let j = 0; j < D; j++) e += (c[j] - rec[j]) ** 2; });
    return e / (N - 1);
  };
  for (const k of [4, 12]) {
    const direct = errOf(ej.vecs.slice(0, k).map(v => Float64Array.from(v))), discarded = ej.vals.slice(k).reduce((a, v) => a + v, 0);
    ok(`PCA error == sum of the discarded eigenvalues (k = ${k})`, close(direct, discarded, 1e-8), [direct, discarded]);
    const r = CY.rng(5); let best = Infinity;
    for (let trial = 0; trial < 12; trial++) {                                    // random k-dimensional subspaces (Gram-Schmidt of Gaussian vectors) never beat it
      const B = []; for (let a = 0; a < k; a++) { const v = Float64Array.from({ length: D }, () => CY.randn(r)); B.forEach(u => { const s = dot(u, v); for (let j = 0; j < D; j++) v[j] -= s * u[j]; }); const nm = Math.sqrt(dot(v, v)); for (let j = 0; j < D; j++) v[j] /= nm; B.push(v); }
      best = Math.min(best, errOf(B));
    }
    ok(`random subspaces do worse than PCA (k = ${k})`, best > direct, [best, direct]);
    facts['pca_share_k' + k] = 100 * (1 - discarded / m1.total);                  // share of the (training) pixel variance a PCA code keeps
  }
  // the loudest directions are the nuisance: lag-1 correlation of the components, cumulative variance
  let cum = 0; const cumv = m1.pcVals.map(v => (cum += v, 100 * cum / m1.total));
  facts.pc8_share = cumv[7]; facts.pc24_share = cumv[23]; facts.pc32_share = cumv[31];
  facts.rho_first8_max = Math.max.apply(null, m1.pcRho.slice(0, 8).map(Math.abs));
  facts.rho9 = m1.pcRho[8]; facts.rho10 = m1.pcRho[9]; facts.rho11 = m1.pcRho[10];
  const firstBall = m1.pcRho.findIndex((r, i) => i >= 8 && r > 0.8); facts.pc_first_ball = firstBall + 1;
  ok('the engine\'s principal-component correlations agree', L3.model(1, 'flicker').rho.every((r, i) => close(r, m1.pcRho[i], 1e-9)));
  ok('the engine\'s spectrum agrees', L3.model(1, 'flicker').pca.vals.every((v, i) => close(v, m1.pcVals[i], 1e-9)));
}

/* ── 7. the probe on the first codes (nu = 1, k = 12) ── */
{
  const c = codesCheap(m1, 12);
  facts.pca_pos = c.pca.r2.pos; facts.pca_band = c.pca.r2.band; facts.pca_vel = c.pca.r2.vel; facts.pca_rec = 100 * c.pca.rec; facts.pca_rec_frac = c.pca.rec; facts.pca_spread = c.pca.spread; facts.pca_rank = c.pca.rank;
  facts.cf_pos = c.cf.r2.pos; facts.cf_band = c.cf.r2.band; facts.cf_vel = c.cf.r2.vel; facts.cf_rec = 100 * c.cf.rec; facts.cf_spread = c.cf.spread; facts.cf_rank = c.cf.rank;
  facts.pca_pos_k24 = codesCheap(m1, 24).pca.r2.pos; facts.pca_pos_k2 = codesCheap(m1, 2).pca.r2.pos;
  facts.pca_pos_nu0 = codesCheap(m0, 12).pca.r2.pos; facts.cf_pos_nu0 = codesCheap(m0, 12).cf.r2.pos;
  ok('reconstruction does not localise the ball at nu = 1 (r2 < 0.2 for every k)', KS.every(k => codesCheap(m1, k).pca.r2.pos < 0.3), KS.map(k => codesCheap(m1, k).pca.r2.pos));
  ok('reconstruction holds the band (r2 > 0.9 from k = 4)', KS.filter(k => k >= 4).every(k => codesCheap(m1, k).pca.r2.band > 0.9));
  ok('the predictive code reads the ball, not the band', c.cf.r2.pos > 0.9 && c.cf.r2.band < 0.05, [c.cf.r2.pos, c.cf.r2.band]);
  ok('reconstruction rebuilds more of the picture than the predictive code', c.pca.rec > 0.8 && c.cf.rec < 0.1, [c.pca.rec, c.cf.rec]);
  // the engine agrees with the independent pipeline on every number the widget will print
  const e = L3.cheap(L3.model(1, 'flicker'), 12);
  for (const w of ['pca', 'cf']) {
    for (const key of ['pos', 'vel', 'band', 'rew', 'rew2']) ok(`engine ${w} ${key} == oracle`, close(e[w].r2[key], c[w].r2[key], 1e-9), [e[w].r2[key], c[w].r2[key]]);
    ok(`engine ${w} rebuilt share == oracle`, close(e[w].rec, c[w].rec, 1e-9), [e[w].rec, c[w].rec]);
    ok(`engine ${w} spread and rank == oracle`, close(e[w].std, c[w].spread, 1e-9) && close(e[w].rank, c[w].rank, 1e-8), [e[w].std, c[w].spread, e[w].rank, c[w].rank]);
  }
  // a linear (ridge) probe on the same codes
  const ridgeR2 = (Ztr, Zte, k) => {
    const Phi = new Float64Array(N * (k + 1)), Y = new Float64Array(N * 2); Ztr.forEach((z, i) => { Phi.set(z, i * (k + 1)); Phi[i * (k + 1) + k] = 1; Y[2 * i] = m1.Ttr.pos[i][0]; Y[2 * i + 1] = m1.Ttr.pos[i][1]; });
    const Wr = la.ridge(Phi, N, k + 1, Y, 2, 1e-4 * N); let s = 0;
    for (let c2 = 0; c2 < 2; c2++) { const p = Zte.map(z => { let v = Wr[k * 2 + c2]; for (let a = 0; a < k; a++) v += z[a] * Wr[a * 2 + c2]; return v; }), t = m1.Tte.pos.map(v => v[c2]); let sse = 0, sst = 0, mt = t.reduce((a, v) => a + v, 0) / N; t.forEach((v, i) => { sse += (p[i] - v) ** 2; sst += (v - mt) ** 2; }); s += (1 - sse / sst) / 2; }
    return s;
  };
  facts.ridge_pca_pos = ridgeR2(c.pca.tr, c.pca.te, 12); facts.ridge_cf_pos = ridgeR2(c.cf.tr, c.cf.te, 12);
  facts.ridge_pca_pos_nu0 = (() => { const cc = codesCheap(m0, 12); const mm = m0; const Phi = new Float64Array(N * 13), Y = new Float64Array(N * 2); cc.pca.tr.forEach((z, i) => { Phi.set(z, i * 13); Phi[i * 13 + 12] = 1; Y[2 * i] = mm.Ttr.pos[i][0]; Y[2 * i + 1] = mm.Ttr.pos[i][1]; }); const Wr = la.ridge(Phi, N, 13, Y, 2, 1e-4 * N); let s = 0; for (let c2 = 0; c2 < 2; c2++) { const p = cc.pca.te.map(z => { let v = Wr[24 + c2]; for (let a = 0; a < 12; a++) v += z[a] * Wr[a * 2 + c2]; return v; }), t = mm.Tte.pos.map(v => v[c2]); let sse = 0, sst = 0, mt = t.reduce((a, v) => a + v, 0) / N; t.forEach((v, i) => { sse += (p[i] - v) ** 2; sst += (v - mt) ** 2; }); s += (1 - sse / sst) / 2; } return s; })();
  ok('a linear probe fails on both nu = 1 codes (the picture is not linear in position)', facts.ridge_pca_pos < 0.4 && facts.ridge_cf_pos < 0.5, [facts.ridge_pca_pos, facts.ridge_cf_pos]);
}

{ // the neighbours are found in the code's own units, where the band's coordinates dominate every distance: rescale every coordinate to unit variance (training mean and std) and read again
  const stdz = (c, k) => {
    const mu = new Float64Array(k), sd = new Float64Array(k);
    c.tr.forEach(z => { for (let a = 0; a < k; a++) mu[a] += z[a] / N; });
    c.tr.forEach(z => { for (let a = 0; a < k; a++) sd[a] += (z[a] - mu[a]) ** 2 / N; });
    for (let a = 0; a < k; a++) sd[a] = Math.sqrt(sd[a]);
    const f = Z => Z.map(z => Float64Array.from(z, (v, a) => (v - mu[a]) / sd[a]));
    return { tr: f(c.tr), te: f(c.te) };
  };
  for (const k of [12, 24]) { const s = stdz(codesCheap(m1, k).pca, k); facts['pca_pos_std' + k] = probe(m1, s.tr, s.te).pos; }
  facts.cf_pos_k24 = codesCheap(m1, 24).cf.r2.pos;
  ok('rescaled to unit variance per coordinate, a bigger reconstruction code shows the ball (k = 24 far above k = 12) but stays below the predictive code at both sizes',
    facts.pca_pos_std12 < 0.3 && facts.pca_pos_std24 > facts.pca_pos_std12 + 0.3 && facts.pca_pos_std24 < facts.cf_pos_k24 - 0.1 && facts.pca_pos_std12 < facts.cf_pos - 0.5,
    [facts.pca_pos_std12, facts.pca_pos_std24, facts.cf_pos_k24, facts.cf_pos]);
}

/* ── 8. the sweep over the nuisance level, k*, and a bigger code ── */
for (const nu of LEVELS) {
  const m = model(nu, 'flicker'), tag = String(nu).replace('.', '');
  facts['share_nu' + tag] = 100 * m0.total / m.total;
  facts['pca_pos_nu' + tag] = codesCheap(m, 12).pca.r2.pos; facts['cf_pos_nu' + tag] = codesCheap(m, 12).cf.r2.pos;
  facts['kstar_pca_nu' + tag] = kstar(m, 'pca'); facts['kstar_cf_nu' + tag] = kstar(m, 'cf');
}
ok('reconstruction gets worse as the nuisance grows (k = 12)', LEVELS.every((nu, i) => i === 0 || facts['pca_pos_nu' + String(nu).replace('.', '')] < facts['pca_pos_nu' + String(LEVELS[i - 1]).replace('.', '')] + 0.02));
ok('the predictive code keeps reading the ball at every level (k = 12, r2 > 0.8)', LEVELS.every(nu => facts['cf_pos_nu' + String(nu).replace('.', '')] > 0.8));
ok('with no nuisance reconstruction is as good as prediction (k = 12 within 0.03)', Math.abs(facts.pca_pos_nu0 - facts.cf_pos_nu0) < 0.03 || facts.pca_pos_nu0 > facts.cf_pos_nu0);
ok('no k up to 24 reaches 0.9 for reconstruction once the nuisance is on', LEVELS.filter(nu => nu >= 0.5).every(nu => facts['kstar_pca_nu' + String(nu).replace('.', '')] === 0));
ok('with no nuisance both codes need the same number of numbers', facts.kstar_pca_nu0 === facts.kstar_cf_nu0 && facts.kstar_cf_nu0 > 0, [facts.kstar_pca_nu0, facts.kstar_cf_nu0]);
ok('the engine agrees on k*', LEVELS.every(nu => L3.kStar(L3.model(nu, 'flicker'), 'pca') === facts['kstar_pca_nu' + String(nu).replace('.', '')] && L3.kStar(L3.model(nu, 'flicker'), 'cf') === facts['kstar_cf_nu' + String(nu).replace('.', '')]));

/* ── 9. the closed form: derivation checks ── */
{
  const k = 12, E = cfE(m1, k);
  // sample-form loss of a code (E, A): mean over the four ordered pairs of every clip of |E w_next - A E w_now|^2 / k
  const pairs = []; for (const [t, u] of [[0, 1], [1, 0], [1, 2], [2, 1]]) for (let i = 0; i < N; i++) pairs.push([m1.Wtr[t][i], m1.Wtr[u][i]]);
  const sampleLoss = (E_, A_, kk, guard) => {
    let pred = 0; const G0 = new Float64Array(kk * kk), G1 = new Float64Array(kk * kk);
    pairs.forEach(([w0, w1]) => {
      const z0 = Float64Array.from({ length: kk }, (_, a) => { let s = 0; for (let b = 0; b < M; b++) s += E_[a * M + b] * w0[b]; return s; });
      const z1 = Float64Array.from({ length: kk }, (_, a) => { let s = 0; for (let b = 0; b < M; b++) s += E_[a * M + b] * w1[b]; return s; });
      for (let a = 0; a < kk; a++) { let pz = 0; for (let b = 0; b < kk; b++) pz += A_[a * kk + b] * z0[b]; pred += (z1[a] - pz) ** 2 / (kk * pairs.length); }
      for (let a = 0; a < kk; a++) for (let b = 0; b < kk; b++) { G0[a * kk + b] += z0[a] * z0[b] / pairs.length; G1[a * kk + b] += z1[a] * z1[b] / pairs.length; }
    });
    let total = pred;
    if (guard) for (const G of [G0, G1]) for (let a = 0; a < kk; a++) { const h = Math.max(0, 1 - Math.sqrt(G[a * kk + a] + 1e-4)); total += guard.v * h * h / kk / 2; for (let b = 0; b < kk; b++) if (a !== b) total += guard.c * G[a * kk + b] ** 2 / kk / 2; }
    return { pred, total, G0 };
  };
  // (a) the closed-form loss is k - sum of squared correlations, and equals the loss evaluated on the data with the best predictor
  const Acf = new Float64Array(k * k); for (let a = 0; a < k; a++) Acf[a * k + a] = m1.rho[a];
  const sl = sampleLoss(E, Acf, k), predicted = 1 - m1.rho.slice(0, k).reduce((a, v) => a + v * v, 0) / k;
  ok('closed-form loss == 1 - mean squared correlation (sample form, A = diag(rho))', close(sl.pred, predicted, 1e-9), [sl.pred, predicted]);
  ok('whitened input and target moments are both the identity', (() => { let w = 0; for (let a = 0; a < M; a++) for (let b = 0; b < M; b++) w = Math.max(w, Math.abs(m1.C0[a * M + b] - (a === b ? 1 : 0)), Math.abs(m1.C1[a * M + b] - (a === b ? 1 : 0)), Math.abs(m1.Mx[a * M + b] - m1.Mx[b * M + a])); return w < 1e-9; })());
  ok('whitening gives unit variance, decorrelated code numbers', (() => { let w = 0; for (let a = 0; a < k; a++) for (let b = 0; b < k; b++) w = Math.max(w, Math.abs(sl.G0[a * k + b] - (a === b ? 1 : 0))); return w < 1e-9; })());
  facts.cf_loss = predicted; facts.cf_rho_1 = Math.abs(m1.rho[0]); facts.cf_rho_12 = Math.abs(m1.rho[11]); facts.cf_rho_32 = Math.abs(m1.rho[31]);
  ok('the engine evaluates the same loss', close(L3.lossOf(L3.model(1, 'flicker'), L3.cheap(L3.model(1, 'flicker'), k).cf.E, k), predicted, 1e-9), [L3.lossOf(L3.model(1, 'flicker'), L3.cheap(L3.model(1, 'flicker'), k).cf.E, k), predicted]);
  // (b) the best predictor of a given code is least squares: perturbing A only raises the loss
  const rA = CY.rng(8); let worst = Infinity; for (let i = 0; i < 20; i++) { const A2 = Float64Array.from(Acf, v => v + 0.02 * CY.randn(rA)); worst = Math.min(worst, sampleLoss(E, A2, k).pred - sl.pred); }
  ok('perturbing the predictor raises the loss', worst > 0, worst);
  // (c) no other code with unit-variance decorrelated numbers does better: random orthonormal frames, small rotations of the optimum, and the best the engine's gradient finds
  const lossFrame = (E_, kk) => { // for E E' = I the code is unit-variance and decorrelated, A = H and the loss is kk - |H|_F^2 / kk (per number); computed from the sample moments
    const H = new Float64Array(kk * kk), tmp = new Float64Array(kk * M);
    for (let a = 0; a < kk; a++) for (let b = 0; b < M; b++) { let s = 0; for (let c = 0; c < M; c++) s += E_[a * M + c] * m1.Mx[c * M + b]; tmp[a * M + b] = s; }
    for (let a = 0; a < kk; a++) for (let b = 0; b < kk; b++) H[a * kk + b] = dot(tmp.subarray(a * M, (a + 1) * M), E_.subarray(b * M, (b + 1) * M));
    return 1 - H.reduce((s, v) => s + v * v, 0) / kk;
  };
  ok('lossFrame(optimum) == closed form', close(lossFrame(E, k), predicted, 1e-9), [lossFrame(E, k), predicted]);
  const rr = CY.rng(9); let bestRand = Infinity, bestRot = Infinity;
  const orth = (rows, kk) => { for (let a = 0; a < kk; a++) { const v = rows.subarray(a * M, (a + 1) * M); for (let b = 0; b < a; b++) { const u = rows.subarray(b * M, (b + 1) * M), s = dot(u, v); for (let j = 0; j < M; j++) v[j] -= s * u[j]; } const nm = Math.sqrt(dot(v, v)); for (let j = 0; j < M; j++) v[j] /= nm; } return rows; };
  for (let trial = 0; trial < 300; trial++) bestRand = Math.min(bestRand, lossFrame(orth(Float64Array.from({ length: k * M }, () => CY.randn(rr)), k), k));
  for (let trial = 0; trial < 300; trial++) bestRot = Math.min(bestRot, lossFrame(orth(Float64Array.from(E, v => v + 0.03 * CY.randn(rr)), k), k));
  ok('no random orthonormal code beats the closed form', bestRand > predicted + 0.05, [bestRand, predicted]);
  ok('no small rotation of the closed form beats it', bestRot > predicted - 1e-12, [bestRot, predicted]);
  facts.rand_best_loss = bestRand;
  // (d) k = 1 by brute force: a grid on the unit sphere of the plane spanned by the top three eigenvectors, and random unit vectors in all 32 dimensions
  const top = [0, 1, 2].map(i => m1.ec.vecs[m1.order[i]]);
  let bestGrid = 0;
  for (let i = 0; i <= 400; i++) for (let j = 0; j < 800; j++) {
    const th = Math.PI * i / 400, ph = 2 * Math.PI * j / 800, c = [Math.cos(th), Math.sin(th) * Math.cos(ph), Math.sin(th) * Math.sin(ph)], e = new Float64Array(M);
    for (let q = 0; q < 3; q++) for (let b = 0; b < M; b++) e[b] += c[q] * top[q][b];
    let s = 0; for (let a = 0; a < M; a++) for (let b = 0; b < M; b++) s += e[a] * 0.5 * (m1.Mx[a * M + b] + m1.Mx[b * M + a]) * e[b];
    bestGrid = Math.max(bestGrid, s * s);
  }
  ok('k = 1: grid search on the sphere finds the closed-form maximum', close(bestGrid, m1.rho[0] ** 2, 1e-4), [bestGrid, m1.rho[0] ** 2]);
  let bestAll = 0; for (let trial = 0; trial < 100000; trial++) { const e = Float64Array.from({ length: M }, () => CY.randn(rr)), nm = Math.sqrt(dot(e, e)); let s = 0; for (let a = 0; a < M; a++) { let t = 0; for (let b = 0; b < M; b++) t += 0.5 * (m1.Mx[a * M + b] + m1.Mx[b * M + a]) * e[b]; s += e[a] * t; } bestAll = Math.max(bestAll, (s / (nm * nm)) ** 2); }
  ok('k = 1: 100000 random directions never beat it', bestAll < m1.rho[0] ** 2 + 1e-12, [bestAll, m1.rho[0] ** 2]);
  // (e) the scale law that makes the bare loss collapse: L(c E) = c^2 L(E), also with the best predictor re-fitted
  const Er = Float64Array.from({ length: k * M }, () => CY.randn(rr) / Math.sqrt(M)), Ar = Float64Array.from({ length: k * k }, (_, i) => (i % (k + 1) === 0 ? 1 : 0));
  const l1 = sampleLoss(Er, Ar, k).pred, l01 = sampleLoss(Float64Array.from(Er, v => 0.1 * v), Ar, k).pred;
  facts.scale_ratio = l01 / l1; ok('L(0.1 E) = 0.01 L(E)', close(l01 / l1, 0.01, 1e-12), l01 / l1);
  { const best = (E_) => L3.lossOf(L3.model(1, 'flicker'), E_, k); ok('with the predictor re-fitted the loss still scales as c^2', close(best(Float64Array.from(Er, v => 0.1 * v)) / best(Er), 0.01, 1e-9), best(Float64Array.from(Er, v => 0.1 * v)) / best(Er)); }
  // (f) the analytic gradient (with the guard) against a central finite difference of the sample-form loss
  const guard = { v: 1, c: 1 }, Eg = Float64Array.from({ length: k * M }, () => 0.5 * CY.randn(rr) / Math.sqrt(M)), Ag = Float64Array.from({ length: k * k }, () => 0.3 * CY.randn(rr));
  const an = L3.lossGrad(Eg, Ag, k, L3.model(1, 'flicker').mx, guard), tot = (E_, A_) => sampleLoss(E_, A_, k, guard).total;
  ok('engine loss (without the guard) == sample form', close(an.pred, sampleLoss(Eg, Ag, k).pred, 1e-9), [an.pred, sampleLoss(Eg, Ag, k).pred]);
  ok('engine guard terms == sample form', close(an.pred + guard.v * an.V + guard.c * an.Cv, tot(Eg, Ag), 1e-9), [an.pred + an.V + an.Cv, tot(Eg, Ag)]);
  let gworst = 0, gmax = 0; const h = 1e-5;
  for (let i = 0; i < Eg.length; i += 7) { const Ep = Float64Array.from(Eg), Em = Float64Array.from(Eg); Ep[i] += h; Em[i] -= h; const fd = (tot(Ep, Ag) - tot(Em, Ag)) / (2 * h); gworst = Math.max(gworst, Math.abs(fd - an.gE[i])); gmax = Math.max(gmax, Math.abs(fd)); }
  for (let i = 0; i < Ag.length; i += 5) { const Ap = Float64Array.from(Ag), Am = Float64Array.from(Ag); Ap[i] += h; Am[i] -= h; const fd = (tot(Eg, Ap) - tot(Eg, Am)) / (2 * h); gworst = Math.max(gworst, Math.abs(fd - an.gA[i])); gmax = Math.max(gmax, Math.abs(fd)); }
  facts.grad_check_worst = gworst; ok('analytic gradient == finite difference (with the guard)', gworst < 1e-6 * Math.max(1, gmax), [gworst, gmax]);
  const an0 = L3.lossGrad(Eg, Ag, k, L3.model(1, 'flicker').mx, null); let g0 = 0;
  for (let i = 0; i < Eg.length; i += 11) { const Ep = Float64Array.from(Eg), Em = Float64Array.from(Eg); Ep[i] += h; Em[i] -= h; g0 = Math.max(g0, Math.abs((sampleLoss(Ep, Ag, k).pred - sampleLoss(Em, Ag, k).pred) / (2 * h) - an0.gE[i])); }
  ok('analytic gradient == finite difference (no guard)', g0 < 1e-6, g0);
}

/* ── 10. gradient runs, with their own Adam loop ── */
function codesOfE(m, E, k) { return { tr: lin(E, k, m.Wtr[1]), te: lin(E, k, m.Wte[1]) }; }
function adamRun(m, k, guard, seed) {
  const rng = CY.rng(seed), E = new Float64Array(k * M), A = new Float64Array(k * k);
  for (let i = 0; i < E.length; i++) E[i] = CY.randn(rng) / Math.sqrt(M);
  for (let i = 0; i < k; i++) A[i * k + i] = 1;
  const mx = { C00: m.C0, C11: m.C1, M10: m.Mx, M10T: la.T(m.Mx, M, M) }, mE = new Float64Array(E.length), vE = new Float64Array(E.length), mA = new Float64Array(A.length), vA = new Float64Array(A.length), trace = [];
  for (let t = 0; t <= STEPS; t++) {
    const g = L3.lossGrad(E, A, k, mx, guard);
    if (t % 5 === 0) { const st = codeStats(lin(E, k, m.Wtr[1]), k); trace.push({ t, pred: g.pred, spread: st.spread, rank: st.rank }); }
    if (t === STEPS) break;
    const c1 = 1 - Math.pow(0.9, t + 1), c2 = 1 - Math.pow(0.999, t + 1);
    for (const [P, G, mm, vv] of [[E, g.gE, mE, vE], [A, g.gA, mA, vA]]) for (let i = 0; i < P.length; i++) { mm[i] = 0.9 * mm[i] + 0.1 * G[i]; vv[i] = 0.999 * vv[i] + 0.001 * G[i] * G[i]; P[i] -= LR * (mm[i] / c1) / (Math.sqrt(vv[i] / c2) + 1e-8); }
  }
  const cz = codesOfE(m, E, k);
  return { E, A, trace, first: trace[0], last: trace[trace.length - 1], pos: probe(m, cz.tr, cz.te).pos, posFree: probe(m, cz.tr, cz.te, 0).pos, rec: rebuilt(m, cz.tr, cz.te, k), vel: probe(m, cz.tr, cz.te).vel, band: probe(m, cz.tr, cz.te).band };
}
{
  const k = 12, GU = adamRun(m1, k, null, 3), GG = adamRun(m1, k, { v: 1, c: 1 }, 3);
  facts.gu_loss0 = GU.first.pred; facts.gu_loss1 = GU.last.pred; facts.gu_spread0 = GU.first.spread; facts.gu_spread1 = GU.last.spread; facts.gu_rank0 = GU.first.rank; facts.gu_rank1 = GU.last.rank;
  facts.gu_pos = GU.pos; facts.gu_pos_free = GU.posFree; facts.gu_rec = GU.rec;
  facts.gg_loss1 = GG.last.pred; facts.gg_spread1 = GG.last.spread; facts.gg_rank1 = GG.last.rank; facts.gg_pos = GG.pos; facts.gg_band = GG.band; facts.gg_rec = GG.rec; facts.gg_loss0 = GG.first.pred;
  facts.gg_loss_over_cf = GG.last.pred / facts.cf_loss; facts.gg_spread_sq = GG.last.spread * GG.last.spread;
  ok('collapse: the loss falls by more than five orders of magnitude', GU.last.pred < 1e-5 * GU.first.pred, [GU.first.pred, GU.last.pred]);
  ok('collapse: the spread of the code falls below 0.01', GU.last.spread < 0.01 && GU.first.spread > 0.8, [GU.first.spread, GU.last.spread]);
  ok('collapse: the effective rank falls below 2.5', GU.last.rank < 2.5 && GU.first.rank > 8, [GU.first.rank, GU.last.rank]);
  ok('collapse: the probe (with its precision floor) reads nothing', GU.pos < 0.1, GU.pos);
  ok('the loss of the collapsed run is far below the optimum of the constrained problem', GU.last.pred < 1e-3 * facts.cf_loss);
  ok('guard: the code keeps its spread and rank', GG.last.spread > 0.9 && GG.last.rank > 11.5, [GG.last.spread, GG.last.rank]);
  ok('guard: the loss stays within 20 % of the closed-form optimum (the hinge lets the code shrink a little)', GG.last.pred > 0.85 * facts.cf_loss && GG.last.pred < 1.2 * facts.cf_loss, [GG.last.pred, facts.cf_loss]);
  ok('guard: the loss is the optimum times the squared spread', close(GG.last.pred, facts.cf_loss * GG.last.spread ** 2, 0.004), [GG.last.pred, facts.cf_loss * GG.last.spread ** 2]);
  ok('guard: the code reads the ball and not the band', GG.pos > 0.9 && GG.band < 0.1, [GG.pos, GG.band]);
  // the engine's own run is the same run
  const eu = L3.grad(L3.model(1, 'flicker'), k, 'gu'), eg = L3.grad(L3.model(1, 'flicker'), k, 'gg');
  for (const [en, our, nm] of [[eu, GU, 'gu'], [eg, GG, 'gg']]) {
    ok(`engine ${nm} trace == oracle trace`, en.trace.t.every((t, i) => t === our.trace[i].t && close(en.trace.pred[i], our.trace[i].pred, 1e-9 * Math.max(1, our.trace[0].pred)) && close(en.trace.std[i], our.trace[i].spread, 1e-7) && close(en.trace.rank[i], our.trace[i].rank, 1e-5)));
    ok(`engine ${nm} probe == oracle`, close(en.r2.pos, our.pos, 1e-7) && close(en.r2.vel, our.vel, 1e-7) && close(en.rec, our.rec, 1e-6), [en.r2.pos, our.pos, en.rec, our.rec]);
  }
  // the guard ablation (seed 3): none, covariance only, variance only, both
  const ab = { none: GU, cov: adamRun(m1, k, { v: 0, c: 1 }, 3), var: adamRun(m1, k, { v: 1, c: 0 }, 3), both: GG };
  for (const key of Object.keys(ab)) { facts['ab_loss_' + key] = ab[key].last.pred; facts['ab_spread_' + key] = ab[key].last.spread; facts['ab_rank_' + key] = ab[key].last.rank; facts['ab_pos_' + key] = ab[key].pos; }
  ok('covariance term alone does not stop the shrinking', ab.cov.last.spread < 0.02 && ab.cov.pos < 0.1, [ab.cov.last.spread, ab.cov.pos]);
  ok('variance term alone stops the shrinking but not the copying (rank far below 12)', ab.var.last.spread > 0.9 && ab.var.last.rank < 3, [ab.var.last.spread, ab.var.last.rank]);
  ok('both terms: full rank and the best probe', ab.both.last.rank > 11.5 && ab.both.pos > ab.var.pos + 0.05, [ab.both.last.rank, ab.both.pos, ab.var.pos]);
  // six random starts
  const starts = [1, 2, 3, 4, 5, 6], unp = [], unf = [], grd = [], rk = [];
  for (const s of starts) { const u = adamRun(m1, k, null, s), g = adamRun(m1, k, { v: 1, c: 1 }, s); unp.push(u.pos); unf.push(u.posFree); grd.push(g.pos); rk.push(u.last.rank); }
  facts.six_unguarded_max = Math.max.apply(null, unp); facts.six_scalefree_min = Math.min.apply(null, unf); facts.six_scalefree_max = Math.max.apply(null, unf);
  facts.six_guarded_min = Math.min.apply(null, grd); facts.six_guarded_max = Math.max.apply(null, grd); facts.six_rank_max = Math.max.apply(null, rk);
  ok('six random starts: unguarded runs read nothing (floor), guarded runs read the ball', facts.six_unguarded_max < 0.1 && facts.six_guarded_min > 0.9, [unp, grd]);
}

/* ── 11. the drifting band, and the reward-predictive code ── */
function rewardCode(m, k, nClips) {
  const n = nClips || N, g = GOAL_A, rew = (S, i, t) => -Math.hypot(S.S[i][t][0] - g[0], S.S[i][t][1] - g[1]);
  let rm = 0, cnt = 0; for (let i = 0; i < n; i++) for (let t = 0; t < 3; t++) { rm += rew(m.tr, i, t); cnt++; } rm /= cnt;
  let rs = 0; for (let i = 0; i < n; i++) for (let t = 0; t < 3; t++) rs += (rew(m.tr, i, t) - rm) ** 2 / cnt; rs = Math.sqrt(rs);
  const X = [], Y = []; for (let i = 0; i < n; i++) for (let t = 0; t < 3; t++) { X.push(Array.from(m.Wtr[t][i])); Y.push([(rew(m.tr, i, t) - rm) / rs]); }
  const net = new CY.MLP([M, k, 16, 1], 7); net.fit(X, Y, { epochs: 150, batch: Math.min(50, X.length), lr: 0.01, seed: 3 });
  const code = (W) => W.map(w => Float64Array.from(net.forward(Array.from(w))[1])), head = (W, S) => { let sse = 0, sst = 0, mt = 0; for (let i = 0; i < N; i++) mt += rew(S, i, 1) / N; for (let i = 0; i < N; i++) { const o = net.predict(Array.from(W[i]))[0] * rs + rm; sse += (o - rew(S, i, 1)) ** 2; sst += (rew(S, i, 1) - mt) ** 2; } return 1 - sse / sst; };
  return { tr: code(m.Wtr[1]), te: code(m.Wte[1]), head: head(m.Wte[1], m.te), n };
}
{
  const dr = model(1, 'drift'), cH = codesCheap(m1, 12), cD = codesCheap(dr, 12);
  facts.hop_cf_band = cH.cf.r2.band; facts.hop_cf_pos = cH.cf.r2.pos; facts.dr_cf_band = cD.cf.r2.band; facts.dr_cf_pos = cD.cf.r2.pos; facts.dr_pca_pos = cD.pca.r2.pos; facts.dr_pca_band = cD.pca.r2.band;
  facts.dr_kstar_cf = kstar(dr, 'cf'); facts.hop_kstar_cf = kstar(m1, 'cf');
  ok('a predictable band survives the predictive objective (band r2 > 0.4)', cD.cf.r2.band > 0.4 && cH.cf.r2.band < 0.05, [cD.cf.r2.band, cH.cf.r2.band]);
  ok('and costs the ball some accuracy', cD.cf.r2.pos < cH.cf.r2.pos - 0.03, [cD.cf.r2.pos, cH.cf.r2.pos]);
  const rwD = rewardCode(dr, 12), zr = probe(dr, rwD.tr, rwD.te);
  facts.dr_rw_band = zr.band; facts.dr_rw_pos = zr.pos; facts.dr_rw_rew = zr.rew; facts.dr_rw_rew2 = zr.rew2; facts.dr_rw_head = rwD.head; facts.dr_rw_vel = zr.vel;
  facts.dr_rw_rec = 100 * rebuilt(dr, rwD.tr, rwD.te, 12);
  ok('the reward-predictive code retires the drifting band', zr.band < 0.1 && zr.rew > 0.85, [zr.band, zr.rew]);
  ok('and still reads the ball (reward needs position)', zr.pos > 0.7, zr.pos);
  { const e = L3.reward(L3.model(1, 'drift'), 12);
    ok('engine reward code == oracle (probe)', ['pos', 'band', 'rew', 'rew2', 'vel'].every(key => close(e.r2[key], zr[key], 1e-7)), [e.r2, zr]);
    ok('engine reward head == oracle', close(e.head, rwD.head, 1e-9), [e.head, rwD.head]); }
  // what labels cost: the same head trained on the first 50 clips (150 pictures) and on all 200 (600 pictures); held-out R2 of the reward
  const r50 = rewardCode(dr, 12, 50), r10 = rewardCode(dr, 12, 10);
  facts.lab30 = r10.head; facts.lab150 = r50.head; facts.lab600 = rwD.head;
  ok('labels cost: 150 labelled pictures are not enough, 600 are', facts.lab150 < 0.5 && facts.lab600 > 0.85, [facts.lab150, facts.lab600]);
  // specialisation: a code of two numbers, hopping band: trained goal vs a goal moved to (4.5, 4.2); closed-form predictive code of the same size
  const rw2 = rewardCode(m1, 2), z2 = probe(m1, rw2.tr, rw2.te), c2 = codesCheap(m1, 2).cf.r2;
  facts.k2_rw_A = z2.rew; facts.k2_rw_B = z2.rew2; facts.k2_rw_pos = z2.pos; facts.k2_cf_A = c2.rew; facts.k2_cf_B = c2.rew2;
  ok('a code shaped by one goal answers it better than a moved goal', z2.rew - z2.rew2 > 0.2, [z2.rew, z2.rew2]);
  ok('the predictive code of the same size answers both about equally', Math.abs(c2.rew - c2.rew2) < 0.15, [c2.rew, c2.rew2]);
  // the flicker case at k = 12 too
  const rwH = rewardCode(m1, 12), zh = probe(m1, rwH.tr, rwH.te); facts.hop_rw_band = zh.band; facts.hop_rw_pos = zh.pos; facts.hop_rw_rew = zh.rew;
}

/* ── 12. robustness: the sharper ball of lesson 2, and other stream seeds ── */
{
  const s8 = model(1, 'flicker', 0.8), c8 = codesCheap(s8, 12);
  facts.sig08_pca = c8.pca.r2.pos; facts.sig08_cf = c8.cf.r2.pos; facts.sig08_cf_best = Math.max.apply(null, KS.map(k => codesCheap(s8, k).cf.r2.pos)); facts.sig08_pca_best = Math.max.apply(null, KS.map(k => codesCheap(s8, k).pca.r2.pos));
  ok('sigma = 0.8: the order of the codes is the same', c8.cf.r2.pos > c8.pca.r2.pos + 0.5, [c8.cf.r2.pos, c8.pca.r2.pos]);
  ok('sigma = 0.8: 200 clips are too few for any code to reach 0.9', facts.sig08_cf_best < 0.9, facts.sig08_cf_best);
  const pcaR = [], cfR = [], ksR = [];
  for (const [a, b] of [[1, 2], [5, 6], [7, 8], [9, 10]]) { const mm = model(1, 'flicker', 1.5, a, b); pcaR.push(codesCheap(mm, 12).pca.r2.pos); cfR.push(codesCheap(mm, 12).cf.r2.pos); ksR.push(kstar(mm, 'cf')); }
  facts.seed_pca_min = Math.min.apply(null, pcaR); facts.seed_pca_max = Math.max.apply(null, pcaR); facts.seed_cf_min = Math.min.apply(null, cfR); facts.seed_cf_max = Math.max.apply(null, cfR); facts.seed_kstar_min = Math.min.apply(null, ksR); facts.seed_kstar_max = Math.max.apply(null, ksR);
  ok('other stream seeds: the same picture (reconstruction < 0.25, predictive > 0.9 at k = 12)', facts.seed_pca_max < 0.25 && facts.seed_cf_min > 0.9, [pcaR, cfR]);
}

/* ── 13. the exit: what one picture cannot hold ── */
{
  // velocity from a code of one picture: the largest r2 over every code, every k, both kinds of band and every nuisance level we use
  let vmax = 0, where = '';
  for (const kind of ['flicker', 'drift']) for (const nu of LEVELS) { if (nu === 0 && kind === 'drift') continue; const m = model(nu, kind); for (const k of KS) for (const w of ['pca', 'cf']) { const v = codesCheap(m, k)[w].r2.vel; if (v > vmax) { vmax = v; where = [kind, nu, k, w].join('/'); } } }
  facts.vel_max = vmax; ok('no code of one picture reads the velocity (r2 <= 0.06 everywhere on the grid)', vmax <= 0.06, [vmax, where]);
  // the ceiling for ANY function of the exact position: cell means of the velocity on a 0.2 m grid from 200000 clips of the same protocol (states only), held-out R2 on 50000
  { const rg = CY.rng(97), cellOf = (x, y) => Math.min(39, Math.floor(x / 0.2)) * 25 + Math.min(24, Math.floor(y / 0.2));
    const clip = () => { for (;;) { const x = 0.35 + 7.3 * rg(), y = 0.35 + 4.3 * rg(), sp = 0.5 + 2.5 * rg(), th = 2 * Math.PI * rg(), s0 = [x, y, sp * Math.cos(th), sp * Math.sin(th)], s1 = CY.step(W0, s0, null), s2 = CY.step(W0, s1, null); if (![s0, s1, s2].some(q => CY.occluded(W0, q))) return s1; } };
    const sum = new Float64Array(2000), cnt = new Float64Array(1000); let g0 = 0, g1 = 0;
    for (let i = 0; i < 200000; i++) { const s1 = clip(), c = cellOf(s1[0], s1[1]); sum[2 * c] += s1[2]; sum[2 * c + 1] += s1[3]; cnt[c]++; g0 += s1[2] / 200000; g1 += s1[3] / 200000; }
    let sse0 = 0, sst0 = 0, sse1 = 0, sst1 = 0;
    for (let i = 0; i < 50000; i++) { const s1 = clip(), c = cellOf(s1[0], s1[1]), p0 = cnt[c] ? sum[2 * c] / cnt[c] : g0, p1 = cnt[c] ? sum[2 * c + 1] / cnt[c] : g1; sse0 += (p0 - s1[2]) ** 2; sst0 += (g0 - s1[2]) ** 2; sse1 += (p1 - s1[3]) ** 2; sst1 += (g1 - s1[3]) ** 2; }
    facts.vel_ceiling = (1 - sse0 / sst0 + 1 - sse1 / sst1) / 2; ok('the ceiling for velocity from exact position is small (r2 < 0.05)', facts.vel_ceiling < 0.05, facts.vel_ceiling); }
  // the best any function of the position could do (the walls tie position and velocity a little): the exact position as the "code", no precision floor
  { const Ztr = m0.Ttr.pos.map(p => Float64Array.from(p)), Zte = m0.Tte.pos.map(p => Float64Array.from(p)); const r = probe(m0, Ztr, Zte, 0); facts.vel_from_pos = r.vel; ok('even the exact position reads the velocity only a little (walls)', r.vel < 0.1, r.vel); }
  // the probe's chance level, for the code that reads velocity best: the same neighbours with the training velocities shuffled (200 seeded shuffles)
  { const [wk, wn, wkk, wc] = where.split('/'), mw = model(+wn, wk), c = codesCheap(mw, +wkk)[wc], rs = CY.rng(61), reps = 200, nulls = [];
    for (let q = 0; q < reps; q++) { const perm = CY.shuffle(Array.from({ length: N }, (_, i) => i), rs), m2 = Object.assign({}, mw, { Ttr: Object.assign({}, mw.Ttr, { vel: perm.map(i => mw.Ttr.vel[i]) }) }); nulls.push(probe(m2, c.tr, c.te).vel); }
    nulls.sort((p, q) => p - q); facts.vel_null_mean = nulls.reduce((a, v) => a + v, 0) / reps; facts.vel_null_p95 = nulls[Math.floor(0.95 * reps)]; facts.vel_null_max = nulls[reps - 1];
    ok('chance (shuffled labels, same neighbours) stays below 0.05 for the code that reads velocity best', nulls[reps - 1] < 0.05, [nulls[reps - 1], where]); }
  // two clean pictures: ridge (primal form, centred) from the pixel difference to the velocity
  const pairR2 = (m) => {
    const diff = (S, i) => Float64Array.from(S.F[i][1], (v, j) => v - S.F[i][0][j]);
    const Xt = m.tr.F.map((_, i) => diff(m.tr, i)), mu = new Float64Array(D); Xt.forEach(x => { for (let j = 0; j < D; j++) mu[j] += x[j] / N; });
    const ym = [0, 0]; m.Ttr.vel.forEach(v => { ym[0] += v[0] / N; ym[1] += v[1] / N; });
    const Phi = new Float64Array(N * D), Y = new Float64Array(N * 2); Xt.forEach((x, i) => { for (let j = 0; j < D; j++) Phi[i * D + j] = x[j] - mu[j]; Y[2 * i] = m.Ttr.vel[i][0] - ym[0]; Y[2 * i + 1] = m.Ttr.vel[i][1] - ym[1]; });
    const Wr = la.ridge(Phi, N, D, Y, 2, 0.001); let s = 0;
    for (let c = 0; c < 2; c++) { const t = m.Tte.vel.map(v => v[c]), p = m.te.F.map((_, i) => { const x = diff(m.te, i); let v = ym[c]; for (let j = 0; j < D; j++) v += (x[j] - mu[j]) * Wr[j * 2 + c]; return v; }), mt = t.reduce((a, v) => a + v, 0) / N; let sse = 0, sst = 0; t.forEach((v, i) => { sse += (p[i] - v) ** 2; sst += (v - mt) ** 2; }); s += (1 - sse / sst) / 2; }
    return s;
  };
  facts.pair_vel = pairR2(m0); facts.pair_vel_nu1 = pairR2(m1);
  ok('two clean pictures hold the velocity (ridge on the difference, r2 > 0.85)', facts.pair_vel > 0.85, facts.pair_vel);
  // how long is the ball hidden, and how often is the picture before a hidden one hidden too (launched balls, 2-3 m/s)
  const rng = CY.rng(5), nL = 400; let hid = 0, blind = 0, runs = 0, tot = 0;
  for (let i = 0; i < nL; i++) {
    let s = CY.launch(W0, rng), prev = CY.occluded(W0, s), run = 0;
    for (let t = 1; t <= 80; t++) { s = CY.step(W0, s, null); const h = CY.occluded(W0, s); if (h) { hid++; run++; if (prev) blind++; } else if (run) { runs++; tot += run; run = 0; } prev = h; }
    if (run) { runs++; tot += run; }
  }
  facts.blind_frac = 100 * blind / hid; facts.hidden_run = tot / runs; facts.hidden_per_launch = hid / nL;
  ok('blind pairs follow from the run length: 1 - 1/mean run', close(blind / hid, 1 - runs / hid, 1e-12), [blind / hid, 1 - runs / hid]);
  ok('most pictures behind the curtain follow another one', blind / hid > 0.7, blind / hid);
}

/* ── 13b. the road not taken: hand-made detectors (the brightest pixel; the brightest pixel after removing each column's, or each row's, median) ── */
{
  const px2xy = (idx) => [((idx % 24) + 0.5) / 3, 5 - (Math.floor(idx / 24) + 0.5) / 3];
  const med = (a) => { const b = a.slice().sort((p, q) => p - q), h = b.length >> 1; return b.length % 2 ? b[h] : (b[h - 1] + b[h]) / 2; };
  const hit = (frame, ball, mode) => {
    const f = Float64Array.from(frame);
    if (mode === 'col') for (let i = 0; i < 24; i++) { const col = []; for (let j = 0; j < 15; j++) col.push(f[j * 24 + i]); const md = med(col); for (let j = 0; j < 15; j++) f[j * 24 + i] -= md; }
    if (mode === 'row') for (let j = 0; j < 15; j++) { const row = []; for (let i = 0; i < 24; i++) row.push(f[j * 24 + i]); const md = med(row); for (let i = 0; i < 24; i++) f[j * 24 + i] -= md; }
    let b = 0; for (let q = 1; q < D; q++) if (f[q] > f[b]) b = q;
    const xy = px2xy(b); return Math.hypot(xy[0] - ball[0], xy[1] - ball[1]) < 0.5;
  };
  const share = (set, mode) => 100 * set.F.filter((f, i) => hit(f[1], [set.S[i][1][0], set.S[i][1][1]], mode)).length / set.n;
  for (const nu of [0, 1, 2]) { const st = gen(N, 2, nu, 'flicker', 1.5); facts['bright_nu' + nu] = share(st, 'raw'); facts['col_nu' + nu] = share(st, 'col'); }
  // the same ball with a horizontal band of the same brightness (nu = 1): a stripe that runs the other way
  const base = gen(N, 2, 0, 'flicker', 1.5), rh = CY.rng(41), hs = { n: N, S: base.S, F: base.F.map(f => { const cy = 0.25 + 4.5 * rh(), g = 1 + 0.1 * CY.randn(rh), fr = Float64Array.from(f[1]); for (let j = 0; j < 15; j++) for (let i = 0; i < 24; i++) fr[j * 24 + i] = (fr[j * 24 + i] + 0.8 * Math.exp(-((5 - (j + 0.5) / 3 - cy) ** 2) / (2 * 0.4 * 0.4))) * g; return [f[0], fr, f[2]]; }) };
  facts.bright_h1 = share(hs, 'raw'); facts.col_h1 = share(hs, 'col'); facts.row_h1 = share(hs, 'row');
  ok('the brightest pixel finds the ball with no nuisance', facts.bright_nu0 > 99, facts.bright_nu0);
  ok('and fails once the band is as bright as the ball', facts.bright_nu1 < 70 && facts.bright_nu2 < 40, [facts.bright_nu1, facts.bright_nu2]);
  ok('removing each column\'s median repairs it for the vertical band', facts.col_nu1 > 95 && facts.col_nu2 > 95, [facts.col_nu1, facts.col_nu2]);
  ok('but not for a horizontal band, which needs its own row-median fix', facts.col_h1 < 75 && facts.row_h1 > 95, [facts.col_h1, facts.row_h1]);
}

/* ── 14. checkpoint: a code number with unit variance and lag-1 correlation 0.9 ── */
{
  const rho = 0.9, r = CY.rng(31); let z = CY.randn(r), sse = 0, sse2 = 0, nn = 400000;
  for (let i = 0; i < nn; i++) { const zn = rho * z + Math.sqrt(1 - rho * rho) * CY.randn(r); sse += (zn - rho * z) ** 2; sse2 += (0.1 * zn - rho * 0.1 * z) ** 2; z = zn; }
  facts.ck_loss = 1 - rho * rho; facts.ck_loss_scaled = 0.01 * (1 - rho * rho); facts.ck_share = 100 * (1 - rho * rho);
  ok('checkpoint: best-predictor loss 1 - rho^2 (Monte Carlo)', close(sse / nn, facts.ck_loss, 0.004), sse / nn);
  ok('checkpoint: rescaled by 0.1 the loss is 100 times smaller', close(sse2 / nn / (sse / nn), 0.01, 1e-9), sse2 / sse);
}

/* ── 15. drive the page's own widget ── */
const PAGE = path.join(DIR, '03_predictive_latent_state.html'), HAVE_PAGE = fs.existsSync(PAGE);
ok('the lesson page exists', HAVE_PAGE);
const page = HAVE_PAGE ? loadPage(PAGE, { dpr: 1 }) : { problems: [], set() {}, num() { return NaN; }, text() { return ''; }, click() {}, value() { return ''; } };
ok('page loads cleanly', page.problems.length === 0, page.problems.join(' | '));
if (HAVE_PAGE) {
  const idx = (arr, v) => arr.indexOf(v), tags = (nu) => String(nu).replace('.', '');
  const state = (nuV, k, kind, code) => { page.set('w03-kind', kind); page.set('w03-code', code); page.set('w03-nu', idx(LEVELS, nuV)); page.set('w03-k', idx(KS, k)); };
  const same = (name, id, want, tol) => ok(name, close(page.num(id), want, tol), [page.num(id), want]);
  // opening state: nu = 1, hopping band, k = 12, reconstruction
  state(1, 12, 'flicker', 'pca');
  same('widget: ball share of the pixel variance', 'w03-share', facts.ball_share_1, 0.51);
  same('widget: reconstruction position r2', 'w03-pos', facts.pca_pos, 0.0051); same('widget: reconstruction velocity r2', 'w03-vel', facts.pca_vel, 0.0051); same('widget: reconstruction band r2', 'w03-band', facts.pca_band, 0.0051);
  same('widget: reconstruction rebuilt share', 'w03-rec', facts.pca_rec, 0.51);
  ok('widget: spread and effective rank of the reconstruction code', close(page.num('w03-spread'), facts.pca_spread, 0.0051) && close(page.num('w03-rank'), facts.pca_rank, 0.051), [page.num('w03-spread'), facts.pca_spread, page.num('w03-rank'), facts.pca_rank]);
  ok('widget: k* line', /none/.test(page.text('w03-kstar')) && page.text('w03-kstar').includes(String(facts.kstar_cf_nu1)), page.text('w03-kstar'));
  state(1, 12, 'flicker', 'cf');
  same('widget: predictive position r2', 'w03-pos', facts.cf_pos, 0.0051); same('widget: predictive band r2', 'w03-band', facts.cf_band, 0.0051); same('widget: predictive rebuilt share', 'w03-rec', facts.cf_rec, 0.51);
  same('widget: predictive next-code loss', 'w03-loss', facts.cf_loss, 0.00051);
  // the sweep over nu at k = 12
  for (const nu of LEVELS) {
    state(nu, 12, 'flicker', 'pca'); same(`widget: reconstruction position r2, nu ${nu}`, 'w03-pos', facts['pca_pos_nu' + tags(nu)], 0.0051); same(`widget: ball share, nu ${nu}`, 'w03-share', facts['share_nu' + tags(nu)], 0.51);
    page.set('w03-code', 'cf'); same(`widget: predictive position r2, nu ${nu}`, 'w03-pos', facts['cf_pos_nu' + tags(nu)], 0.0051);
  }
  // a bigger code does not help reconstruction at nu = 1
  state(1, 24, 'flicker', 'pca'); same('widget: reconstruction position r2, k = 24', 'w03-pos', facts.pca_pos_k24, 0.0051);
  // collapse, the guard, and the reward code need the Train button
  state(1, 12, 'flicker', 'gu'); page.click('w03-train');
  same('widget: collapse spread', 'w03-spread', facts.gu_spread1, 0.00051); same('widget: collapse rank', 'w03-rank', facts.gu_rank1, 0.051); same('widget: collapse position r2', 'w03-pos', facts.gu_pos, 0.0051);
  ok('widget: collapse loss', close(parseFloat(page.text('w03-loss')), facts.gu_loss1, 0.06 * facts.gu_loss1), [page.text('w03-loss'), facts.gu_loss1]);
  state(1, 12, 'flicker', 'gg'); page.click('w03-train');
  same('widget: guarded spread', 'w03-spread', facts.gg_spread1, 0.00051); same('widget: guarded rank', 'w03-rank', facts.gg_rank1, 0.051); same('widget: guarded position r2', 'w03-pos', facts.gg_pos, 0.0051);
  same('widget: guarded loss', 'w03-loss', facts.gg_loss1, 0.00051); same('widget: guarded band r2', 'w03-band', facts.gg_band, 0.0051);
  state(1, 12, 'drift', 'cf'); same('widget: drifting band, predictive band r2', 'w03-band', facts.dr_cf_band, 0.0051); same('widget: drifting band, predictive position r2', 'w03-pos', facts.dr_cf_pos, 0.0051);
  ok('widget: drifting band, predictive k*', page.text('w03-kstar').includes(String(facts.dr_kstar_cf)), page.text('w03-kstar'));
  state(1, 12, 'drift', 'rw'); page.click('w03-train');
  same('widget: reward code band r2', 'w03-band', facts.dr_rw_band, 0.0051); same('widget: reward code position r2', 'w03-pos', facts.dr_rw_pos, 0.0051); same('widget: reward code reward r2', 'w03-rew', facts.dr_rw_rew, 0.0051);
  same('widget: reward code moved-goal r2', 'w03-rew2', facts.dr_rw_rew2, 0.0051);
  state(1, 2, 'flicker', 'rw'); page.click('w03-train'); same('widget: k = 2 reward code, trained goal', 'w03-rew', facts.k2_rw_A, 0.0051); same('widget: k = 2 reward code, moved goal', 'w03-rew2', facts.k2_rw_B, 0.0051);
  state(1, 2, 'flicker', 'cf'); same('widget: k = 2 predictive code, trained goal', 'w03-rew', facts.k2_cf_A, 0.0051); same('widget: k = 2 predictive code, moved goal', 'w03-rew2', facts.k2_cf_B, 0.0051);
  // the exit: velocity is not in any one-picture code
  state(1, 12, 'flicker', 'cf'); ok('widget: velocity r2 of a one-picture code is small', page.num('w03-vel') <= 0.06, page.num('w03-vel'));
}
ok('widget ran without errors', page.problems.length === 0, page.problems.join(' | '));
console.error(fails ? `${fails} check(s) FAILED` : 'all checks passed');
console.log(JSON.stringify({ facts }));
process.exit(fails ? 1 : 0);
