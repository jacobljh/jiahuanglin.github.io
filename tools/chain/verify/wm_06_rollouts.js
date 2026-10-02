#!/usr/bin/env node
/* Oracle for World Models lesson 06, "Errors compound: rollouts and horizons".
 *
 * The experiments (all on the Courtyard):
 *   A. a small learned one-step model of lesson 1's nudge task, trained on a log made by an acting OPERATOR, rolled out on its own output (81 steps from the nudge);
 *   B. the same recursion on the EXACT simulator started with a small error: the plain Courtyard (bounded) and a lattice of posts (geometric);
 *   C. four ways of training the model (teacher forcing, noisy inputs, relabelled visited states, multi-step loss), 12 seeds each, the data ladder, an ensemble;
 *   D. re-observation (the state replaced by the true state every m steps);
 *   E. the exit: how often an imagined ending is off by more than the goal's radius for nudges the operator took and for nudges it did not, and the whole error curve, recursion
 *      and horizons for nudges shifted off the log; F. a checkpoint (a model whose friction is 0.30 instead of 0.35) by closed form and by simulation.
 *
 * Independence from the engine (all_lessons/world_models_new/l06_rollout.js): the oracle has its own integrator for walls and round posts (checked against CY.step to 1e-9),
 * its own forward pass (a CY.MLP loaded with the trained weights), its own rollout / median / horizon code, central-difference Jacobians, its own twin-run code, closed forms
 * (J = [[1, g], [0, d]], the velocity-to-position gain 1/gamma, the deflection of an elastic post), a finite-difference check of the multi-step gradient, and a check
 * of the first-order recursion against the measured error curves of every trained model.  Then the page's own widget is driven into the states the prose describes.
 * Prints {"facts": {...}} as its last line.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '../../../all_lessons');
const DIR = fs.existsSync(path.join(ROOT, 'world_models_new')) ? path.join(ROOT, 'world_models_new') : path.join(ROOT, 'world_models');
const CY = require(path.join(DIR, 'courtyard.js'));
const L6 = require(path.join(DIR, 'l06_rollout.js'));
const { loadPage } = require('../dom_probe.js');

let fails = 0;
const facts = {};
function ok(name, cond, extra) { if (!cond) { fails++; console.error('FAIL', name, extra === undefined ? '' : JSON.stringify(extra)); } }
const close = (a, b, tol) => Math.abs(a - b) <= (tol === undefined ? 1e-9 : tol);
const medI = a => { const b = Array.from(a).sort((x, y) => x - y); return b[Math.floor(b.length / 2)]; };       // upper median, written again here
const hypot2 = (a, b) => Math.sqrt(a * a + b * b);

/* ── 0. an independent integrator for walls and round posts (the engine's step is only used to check it) ── */
function stepI(w, s, a) {
  let x = s[0], y = s[1], vx = s[2], vy = s[3];
  if (a) { vx += a[0]; vy += a[1]; }
  const h = w.dt / w.sub, damp = Math.exp(-w.gamma * h), glide = (1 - damp) / w.gamma;
  for (let i = 0; i < w.sub; i++) {
    x += vx * glide; y += vy * glide; vx *= damp; vy *= damp;
    if (x < w.r) { x = 2 * w.r - x; vx = -w.e * vx; }
    if (x > w.W - w.r) { x = 2 * (w.W - w.r) - x; vx = -w.e * vx; }
    if (y < w.r) { y = 2 * w.r - y; vy = -w.e * vy; }
    if (y > w.H - w.r) { y = 2 * (w.H - w.r) - y; vy = -w.e * vy; }
    for (const p of w.posts) {
      const dx = x - p.x, dy = y - p.y, dd = Math.sqrt(dx * dx + dy * dy), R = w.r + p.r;
      if (dd < R && dd > 1e-9) { const nx = dx / dd, ny = dy / dd; x = p.x + nx * R; y = p.y + ny * R; const vn = vx * nx + vy * ny; if (vn < 0) { vx -= (1 + w.ePost) * vn * nx; vy -= (1 + w.ePost) * vn * ny; } }
    }
  }
  return [x, y, vx, vy];
}
const W0 = L6.W, WL = L6.LATTICE, K = L6.K, TA = L6.TA;
{
  const rng = CY.rng(11);
  for (const [name, w] of [['plain', W0], ['lattice', WL]]) {
    let worst = 0;
    for (let n = 0; n < 400; n++) {
      let s = [0.3 + 7.4 * rng(), 0.3 + 4.4 * rng(), 8 * rng() - 4, 8 * rng() - 4], q = s.slice(), a = n % 3 === 0 ? [rng() - 0.5, rng() - 0.5] : null;
      for (let t = 0; t < 20; t++) { s = stepI(w, s, t === 0 ? a : null); q = CY.step(w, q, t === 0 ? a : null); }
      for (let c = 0; c < 4; c++) worst = Math.max(worst, Math.abs(s[c] - q[c]));
    }
    ok('independent integrator == CY.step on the ' + name + ' world (400 trajectories, 20 steps)', worst < 1e-9, worst);
  }
}
facts.gamma = W0.gamma; facts.dt = W0.dt;
const D = Math.exp(-W0.gamma * W0.dt), G = (1 - D) / W0.gamma;
facts.d = D; facts.g = G; facts.stop_gain = 1 / W0.gamma; facts.mem_steps = 1 / (1 - D);
facts.amp_bound = Math.sqrt(1 + 1 / (W0.gamma * W0.gamma));
facts.n_posts = WL.posts.length;
ok('l06 constants agree with the closed forms', close(L6.d, D, 1e-15) && close(L6.g, G, 1e-15));
{ // the free-flight map on one axis is [[1, g], [0, d]]: its n-th power puts a velocity error dv at g (1 - d^n) / (1 - d) dv in position, and that tends to dv / gamma
  let M = [1, 0, 0, 1];                                                  // 2x2 row-major, J^n built by repeated multiplication J M
  for (let n = 1; n <= 400; n++) M = [M[0] + G * M[2], M[1] + G * M[3], D * M[2], D * M[3]];
  ok('J^n position gain from a velocity error == g (1 - d^n) / (1 - d), tending to 1 / gamma', close(M[1], G * (1 - Math.pow(D, 400)) / (1 - D), 1e-12) && close(M[1], 1 / W0.gamma, 1e-5), M[1]);
  ok('J^n velocity entry decays as d^n', close(M[3], Math.pow(D, 400), 1e-12), M[3]);
  ok('g / (1 - d) = 1 / gamma exactly (the sum of the geometric series)', close(G / (1 - D), 1 / W0.gamma, 1e-12));
}

/* ── 1. the protocol of the page: a log, a held-out set, a model; and the model's weights loaded into a CY.MLP for an independent forward pass ── */
const NTR = 60, NTE = 100;
const tr = L6.makeLog(NTR, 1), te = L6.makeLog(NTE, 2), S = L6.study(te);
facts.n_log = NTR; facts.n_pairs = NTR * L6.T; facts.n_test = NTE;
function viaCY(net) {                                                     // an independent model: CY.MLP with the same weights, its own input scaling
  const m = new CY.MLP(net.sizes, 1);
  for (let l = 0; l < net.L; l++) { m.W[l].set(net.W[l]); m.b[l].set(net.b[l]); }
  return (s, a) => { const o = m.predict([(s[0] - 3) / 2, (s[1] - 2.5) / 1.5, s[2] / 2, s[3] / 2, a ? a[0] : 0, a ? a[1] : 0]); return [s[0] + o[0], s[1] + o[1], s[2] + o[2], s[3] + o[3]]; };
}
const NETS = {};                                                           // cache: 'N:seed:kind'
function getNet(N, seed, kind) {
  const key = N + ':' + seed + ':' + kind;
  if (!NETS[key]) {
    const lk = 'L' + N + ':' + seed;
    if (!NETS[lk]) { NETS['log' + N] = NETS['log' + N] || (N === NTR ? tr : L6.makeLog(N, 1)); NETS[lk] = L6.pretrain(NETS['log' + N], seed); }
    NETS[key] = L6.finish(kind, NETS[lk], NETS['log' + N]);
  }
  return NETS[key];
}
/* the oracle's own truth paths for the held-out launches (independent integrator) */
const nudgeI = i => [te.A[(i * te.T + TA) * 2], te.A[(i * te.T + TA) * 2 + 1]];
const stateI = (i, t) => Array.from(te.S.subarray((i * (te.T + 1) + t) * 4, (i * (te.T + 1) + t) * 4 + 4));
const TRUTH = [];
for (let i = 0; i < NTE; i++) { let s = stateI(i, 0); const p = [s]; for (let t = 0; t < TA + K; t++) { s = stepI(W0, s, t === TA ? nudgeI(i) : null); p.push(s); } TRUTH.push(p); }
{ let worst = 0; for (let i = 0; i < NTE; i++) for (let t = 0; t <= TA + K; t++) for (let c = 0; c < 4; c++) worst = Math.max(worst, Math.abs(TRUTH[i][t][c] - stateI(i, t)[c])); ok('the log is the simulator: held-out states replay with the independent integrator', worst < 1e-9, worst); }
for (let i = 0; i < NTE; i++) for (let k = 0; k <= K; k++) for (let c = 0; c < 4; c++) if (Math.abs(S.truth[i][k][c] - TRUTH[i][TA + k][c]) > 1e-9) ok('study truth path == independent truth', false, [i, k, c]);

/* independent rollouts, errors, horizon, one-step error, central-difference Jacobian, the recursion.  A "study" st = {T: true paths from the nudge (K + 1 states), N: nudges} */
function studyOf(off, seed) {                                              // held-out launches whose nudge is shifted by `off` m/s in a random direction (the oracle's own draws and integrator)
  const rng = CY.rng(seed), T = [], N = [];
  for (let i = 0; i < NTE; i++) {
    const an = 2 * Math.PI * rng(), n0 = nudgeI(i), a = off ? [n0[0] + off * Math.cos(an), n0[1] + off * Math.sin(an)] : n0;
    let s = stateI(i, TA); const p = [s]; for (let k = 0; k < K; k++) { s = stepI(W0, s, k === 0 ? a : null); p.push(s); } T.push(p); N.push(a);
  }
  return { T, N };
}
const ST0 = studyOf(0, 31);
for (let i = 0; i < NTE; i++) for (let k = 0; k <= K; k++) for (let c = 0; c < 4; c++) if (Math.abs(ST0.T[i][k][c] - TRUTH[i][TA + k][c]) > 1e-12) ok('independent study == truth path', false, [i, k, c]);
function rollModel(f, i, m, st = ST0) {                                    // the model from the true state at the nudge, the nudge at the first step; every m steps re-anchored to the true state
  let s = st.T[i][0].slice(); const out = [s];
  for (let k = 1; k <= K; k++) { s = f(s, k === 1 ? st.N[i] : null); if (m > 0 && k % m === 0) s = st.T[i][k].slice(); out.push(s); }
  return out;
}
function errCurve(f, m, st = ST0) {                                        // median over launches of the position error at each k
  const med = [], paths = []; for (let i = 0; i < NTE; i++) paths.push(rollModel(f, i, m, st));
  for (let k = 0; k <= K; k++) med.push(medI(paths.map((p, i) => hypot2(p[k][0] - st.T[i][k][0], p[k][1] - st.T[i][k][1]))));
  return { med, paths };
}
function oneStep(f, st = ST0) { const e = []; for (let i = 0; i < NTE; i++) for (let k = 0; k < K; k++) { const p = f(st.T[i][k], k === 0 ? st.N[i] : null), q = st.T[i][k + 1]; e.push(hypot2(p[0] - q[0], p[1] - q[1])); } return medI(e); }
function oneStepAtNudge(f) { return medI(Array.from({ length: NTE }, (_, i) => { const p = f(TRUTH[i][TA], nudgeI(i)), q = TRUTH[i][TA + 1]; return hypot2(p[0] - q[0], p[1] - q[1]); })); }
function horizonI(med, tau) { for (let k = 0; k < med.length; k++) if (med[k] > tau) return k; return -1; }
function jacFD(f, s, a, h) {                                                // central differences, row = output
  const J = [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]];
  for (let c = 0; c < 4; c++) { const p = s.slice(), q = s.slice(); p[c] += h; q[c] -= h; const fp = f(p, a), fm = f(q, a); for (let r = 0; r < 4; r++) J[r][c] = (fp[r] - fm[r]) / (2 * h); }
  return J;
}
function recursionCurve(f, m, st = ST0, mask = null) {                       // mask(k): whether the one-step error of step k enters (null: all)
  // e(k+1) = J(k) e(k) + delta(k), medians of |e|; J by central differences of the oracle's own forward pass
  const med = [], E = [];
  for (let i = 0; i < NTE; i++) {
    let e = [0, 0, 0, 0]; const row = [e];
    for (let k = 0; k < K; k++) {
      const a = k === 0 ? st.N[i] : null, s = st.T[i][k], p = f(s, a), t1 = st.T[i][k + 1], J = jacFD(f, s, a, 1e-5), n = [0, 0, 0, 0];
      for (let r = 0; r < 4; r++) n[r] = (mask && !mask(k) ? 0 : p[r] - t1[r]) + J[r][0] * e[0] + J[r][1] * e[1] + J[r][2] * e[2] + J[r][3] * e[3];
      e = (m > 0 && (k + 1) % m === 0) ? [0, 0, 0, 0] : n; row.push(e);
    }
    E.push(row);
  }
  for (let k = 0; k <= K; k++) med.push(medI(E.map(r => hypot2(r[k][0], r[k][1]))));
  med.E = E;
  return med;
}

/* engine checks: forward pass, Jacobian, and the multi-step gradient */
const netOne = getNet(NTR, 1, 'one'), fOne = viaCY(netOne);
{
  let worst = 0, rng = CY.rng(5);
  for (let n = 0; n < 300; n++) { const s = [0.5 + 7 * rng(), 0.5 + 4 * rng(), 6 * rng() - 3, 6 * rng() - 3], a = n % 2 ? [2 * rng() - 1, 2 * rng() - 1] : null, p = L6.step(netOne, s, a), q = fOne(s, a); for (let c = 0; c < 4; c++) worst = Math.max(worst, Math.abs(p[c] - q[c])); }
  ok('engine forward pass == CY.MLP forward pass with the same weights', worst < 1e-12, worst);
  let wj = 0; for (let n = 0; n < 100; n++) { const s = [0.5 + 7 * rng(), 0.5 + 4 * rng(), 4 * rng() - 2, 4 * rng() - 2], a = [rng() - 0.5, rng() - 0.5], J = L6.jac(netOne, s, a), Jf = jacFD(fOne, s, a, 1e-5); for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) wj = Math.max(wj, Math.abs(J[r * 4 + c] - Jf[r][c])); }
  ok('analytic input Jacobian == central finite differences (max abs diff < 1e-7)', wj < 1e-7, wj);
  facts.jac_fd_maxdiff = wj;
}
{ // the multi-step gradient: backpropagation through H self-fed steps against central differences of the window loss
  const net = new L6.Net([6, 8, 8, 4], 5), H = 6, ws = L6.workspace(net, H), G0 = net.grad(), G1 = net.grad(); let worst = 0, checked = 0;
  net.zero(G0); L6.windowGrad(net, tr, 3, 10, H, G0, ws);
  const loss = () => { net.zero(G1); return L6.windowGrad(net, tr, 3, 10, H, G1, ws); };
  for (let l = 0; l < net.L; l++) for (const kind of ['W', 'b']) for (const idx of [0, 1, 5, 11]) {
    const arr = kind === 'W' ? net.W[l] : net.b[l]; if (idx >= arr.length) continue;
    const h = 1e-6, old = arr[idx]; arr[idx] = old + h; const lp = loss(); arr[idx] = old - h; const lm = loss(); arr[idx] = old;
    const fd = (lp - lm) / (2 * h), an = (kind === 'W' ? G0.W[l] : G0.b[l])[idx]; worst = Math.max(worst, Math.abs(fd - an) / (Math.abs(fd) + Math.abs(an) + 1e-12)); checked++;
  }
  ok('multi-step gradient (BPTT through 6 self-fed steps) == finite differences (relative error < 1e-6)', worst < 1e-6 && checked > 12, [worst, checked]);
  facts.bptt_fd_relerr = worst;
}

/* ── 2. experiment A: the model on its own output ── */
const curvesByKind = {};
for (const kind of L6.KINDS) { const net = getNet(NTR, 1, kind), f = viaCY(net), c = errCurve(f, 0); c.one = oneStep(f); c.f = f; c.net = net; curvesByKind[kind] = c; }
{ // the independent medians agree with the engine's evaluation (so the widget's numbers are the same numbers)
  for (const kind of L6.KINDS) {
    const ev = L6.evalNet(S, curvesByKind[kind].net, 0); let worst = 0; for (let k = 0; k <= K; k++) worst = Math.max(worst, Math.abs(ev.med[k] - curvesByKind[kind].med[k]));
    ok('engine median error curve == independent one (' + kind + ')', worst < 1e-9, worst); ok('engine one-step error == independent one (' + kind + ')', close(ev.one, curvesByKind[kind].one, 1e-12), [ev.one, curvesByKind[kind].one]);
  }
}
const C1 = curvesByKind.one;
facts.one_mm = 1000 * C1.one; facts.nudge_mm = 1000 * oneStepAtNudge(C1.f);
facts.e1_mm = 1000 * C1.med[1]; facts.e10_cm = 100 * C1.med[10]; facts.e30_cm = 100 * C1.med[30]; facts.e81_cm = 100 * C1.med[81];
facts.amp10 = C1.med[10] / C1.one; facts.amp30 = C1.med[30] / C1.one; facts.amp81 = C1.med[81] / C1.one;
facts.h2 = horizonI(C1.med, 0.02); facts.h5 = horizonI(C1.med, 0.05); facts.h10 = horizonI(C1.med, 0.10);
ok('the median error curve of the teacher-forced model is non-decreasing from step 1 to 81 (up to 1 mm)', C1.med.every((v, k) => k < 2 || v >= C1.med[k - 1] - 1e-3), C1.med.slice(0, 5));
ok('compounding: the 10-step error is more than 20 times the one-step error, the 81-step more than 100 times', facts.amp10 > 20 && facts.amp81 > 100, [facts.amp10, facts.amp81]);
ok('the tolerance horizons are ordered and inside the rollout (2 cm < 5 cm < never at 10 cm)', facts.h2 > 0 && facts.h5 > facts.h2 && facts.h10 === -1, [facts.h2, facts.h5, facts.h10]);
{ // the recursion with J by central differences and delta at the true states
  const lin = recursionCurve(C1.f, 0); let worst = 0, k0 = 0;
  for (let k = 1; k <= K; k++) { const r = Math.abs(lin[k] / C1.med[k] - 1); if (r > worst) { worst = r; k0 = k; } }
  facts.lin_maxdiff_pct = 100 * worst; facts.lin30_ratio = lin[30] / C1.med[30]; facts.lin81_ratio = lin[81] / C1.med[81];
  ok('first-order recursion reproduces the median error curve of the default model to within 5 % at every k (worst at k = ' + k0 + ')', worst < 0.05, worst);
  ok('... and to within 0.5 % at k = 10, 30 and 81', [10, 30, 81].every(k => Math.abs(lin[k] / C1.med[k] - 1) < 0.005), [lin[10] / C1.med[10], lin[30] / C1.med[30], lin[81] / C1.med[81]]);
  { // the recursion is linear in delta: the error of the nudge step carried forward and the errors of the 80 coasting steps carried forward add up to the whole
    const nud = recursionCurve(C1.f, 0, ST0, k => k === 0), coa = recursionCurve(C1.f, 0, ST0, k => k > 0); let wl = 0;
    for (let i = 0; i < NTE; i++) for (let c = 0; c < 4; c++) wl = Math.max(wl, Math.abs(lin.E[i][K][c] - nud.E[i][K][c] - coa.E[i][K][c]));
    facts.dec_nudge_cm = 100 * nud[K]; facts.dec_coast_cm = 100 * coa[K];
    ok('the recursion is linear in delta: nudge-step part + coasting part == whole (1e-12)', wl < 1e-12, wl);
    ok('the nudge step alone, carried forward, accounts for a large share of the error at step 81 (more than half of the whole), the 80 coasting steps for another', facts.dec_nudge_cm > 0.5 * facts.e81_cm && facts.dec_coast_cm > 0.5 * facts.e81_cm, [facts.dec_nudge_cm, facts.dec_coast_cm, facts.e81_cm]);
  }
  facts.hz_lin5 = horizonI(lin, 0.05); ok('the recursion predicts the 5 cm horizon to within 2 steps', Math.abs(facts.hz_lin5 - facts.h5) <= 2, [facts.hz_lin5, facts.h5]);
  const ev = L6.evalNet(S, C1.net, 0); let w2 = 0; for (let k = 1; k <= K; k++) w2 = Math.max(w2, Math.abs(ev.lin[k] / lin[k] - 1)); ok('engine recursion (analytic J) == oracle recursion (central differences)', w2 < 2e-3, w2);
}
{ // the learned Jacobian along the true paths: free flight has eigenvalues {1, d}
  let jxx = 0, jvv = 0, jxv = 0, c = 0; const tf = L6.teacherForced(S, C1.net);
  for (let i = 0; i < NTE; i++) for (let k = 1; k < K; k++) { const J = tf.J[i][k]; jxx += (J[0] + J[5]) / 2; jvv += (J[10] + J[15]) / 2; jxv += (J[2] + J[7]) / 2; c++; }
  facts.jxx = jxx / c; facts.jvv = jvv / c; facts.jxv = jxv / c;
  facts.trav_model = facts.jxv / (1 - facts.jvv); facts.trav_gap_pct = 100 * (1 - facts.trav_model * W0.gamma);       // total travel per unit of velocity of the model's own J, against the world's 1 / gamma
  ok('the trained model: total travel per unit of velocity, g / (1 - d) from its own J, is short of 1 / gamma by between 0.3 and 2 %', facts.trav_gap_pct > 0.3 && facts.trav_gap_pct < 2, facts.trav_gap_pct);
  ok('the trained model learned J = [[1, g], [0, d]] of free flight (J_xx, J_vv, J_xv within 2e-3 of 1, d, g)', close(facts.jxx, 1, 2e-3) && close(facts.jvv, D, 2e-3) && close(facts.jxv, G, 2e-3), [facts.jxx, facts.jvv, facts.jxv]);
  const tn = L6.teacherForced(S, curvesByKind.noise.net); let jvn = 0; c = 0; for (let i = 0; i < NTE; i++) for (let k = 1; k < K; k++) { const J = tn.J[i][k]; jvn += (J[10] + J[15]) / 2; c++; }
  facts.jvv_noise = jvn / c; facts.stop_noise_pct = 100 * (1 - (1 / (1 - facts.jvv_noise)) / (1 / (1 - facts.jvv)));
  ok('the noisy-input model damps velocity faster (J_vv below the plain model by more than 0.003)', facts.jvv - facts.jvv_noise > 0.003, [facts.jvv, facts.jvv_noise]);
}
for (const kind of ['noise', 'relabel', 'multi']) { const c = curvesByKind[kind]; facts[kind + '_one_mm'] = 1000 * c.one; facts[kind + '_e30_cm'] = 100 * c.med[30]; facts[kind + '_e81_cm'] = 100 * c.med[81]; facts[kind + '_h5'] = horizonI(c.med, 0.05); }
{ // how far from the true states do the relabelling rounds' visited states lie?
  const vis = L6.visited(curvesByKind.relabel.net, tr, TA + 1, 80); let s = 0; for (let i = 0; i < NTR; i++) for (let k = 0; k < 80; k++) { const t = L6.stateAt(tr, i, TA + 1 + k), v = vis[i * 80 + k]; s += hypot2(v[0] - t[0], v[1] - t[1]); }
  const vb = L6.visited(getNet(NTR, 1, 'one'), tr, TA + 1, 80); let s2 = 0; for (let i = 0; i < NTR; i++) for (let k = 0; k < 80; k++) { const t = L6.stateAt(tr, i, TA + 1 + k), v = vb[i * 80 + k]; s2 += hypot2(v[0] - t[0], v[1] - t[1]); }
  facts.visit_gap_cm = 100 * s2 / (NTR * 80);
}
{ // relabelling pays only if the network is worse at the states its own rollouts visit than at the real states: median one-step error on the 80 coasting steps of the held-out launches, both measured against the independent integrator
  const f = C1.f, real = [], vis = [];
  for (let i = 0; i < NTE; i++) {
    const p = rollModel(f, i, 0);
    for (let k = 1; k < K; k++) {
      const t = ST0.T[i][k + 1], pr = f(ST0.T[i][k], null), pv = f(p[k], null), tv = stepI(W0, p[k], null);
      real.push(hypot2(pr[0] - t[0], pr[1] - t[1])); vis.push(hypot2(pv[0] - tv[0], pv[1] - tv[1]));
    }
  }
  facts.delta_real_coast_mm = 1000 * medI(real); facts.visit_delta_mm = 1000 * medI(vis); facts.visit_delta_ratio = medI(vis) / medI(real);
  ok('the plain network is not worse at the states its own rollouts visit than at the real states (median one-step error ratio within 0.8 to 1.25)', facts.visit_delta_ratio > 0.8 && facts.visit_delta_ratio < 1.25, [facts.delta_real_coast_mm, facts.visit_delta_mm]);
  // the relabelled rollouts of the engine start after the nudge (step TA + 1), so the nudge step, the largest single contributor, is never relabelled
  ok('relabelling starts its rollouts after the nudge: the first visited state is the true state at step TA + 1', (() => { const vis0 = L6.visited(curvesByKind.relabel.net, tr, TA + 1, 3); return Array.from({ length: 4 }, (_, c) => Math.abs(vis0[0][c] - L6.stateAt(tr, 0, TA + 1)[c])).every(v => v < 1e-12); })());
}

/* ── 3. experiment B: exact model, wrong start — twin runs of the simulator itself ── */
function twinRuns(w, eps, n, seed, KK) {                                    // independent code: pairs of states eps apart (random direction in the 4-D state), followed for KK steps
  const rng = CY.rng(seed), seps = []; for (let k = 0; k <= KK; k++) seps.push([]);
  for (let i = 0; i < n; i++) {
    const s0 = CY.launch(w, rng), v = [CY.randn(rng), CY.randn(rng), CY.randn(rng), CY.randn(rng)], nn = Math.hypot(v[0], v[1], v[2], v[3]);
    let a = s0, b = [s0[0] + eps * v[0] / nn, s0[1] + eps * v[1] / nn, s0[2] + eps * v[2] / nn, s0[3] + eps * v[3] / nn];
    for (let k = 0; k <= KK; k++) { seps[k].push(hypot2(a[0] - b[0], a[1] - b[1])); a = stepI(w, a, null); b = stepI(w, b, null); }
  }
  return seps;
}
/* the lab on the test launches, from the oracle's own truth and kick directions */
function labCurves(w, eps, m) {
  const kicks = L6.kicks(NTE, K), med = [], paths = [];
  for (let i = 0; i < NTE; i++) {
    let s = stateI(i, 0); const tr0 = [s]; for (let k = 1; k <= K; k++) { s = stepI(w, s, null); tr0.push(s); }
    const kick = r => kicks[i][r].map(v => eps * v); let q = tr0[0].map((v, c) => v + kick(0)[c]); const p = [q];
    for (let k = 1; k <= K; k++) { q = stepI(w, q, null); if (m > 0 && k % m === 0) q = tr0[k].map((v, c) => v + kick(k / m)[c]); p.push(q); }
    paths.push({ truth: tr0, model: p });
  }
  for (let k = 0; k <= K; k++) med.push(medI(paths.map(o => hypot2(o.model[k][0] - o.truth[k][0], o.model[k][1] - o.truth[k][1]))));
  return med;
}
const labP = L6.lab(W0, te), labL = L6.lab(WL, te), LABS = { plain: labP, lattice: labL }, WORLDS = { plain: W0, lattice: WL };
for (const name of ['plain', 'lattice']) for (const eps of [1e-2, 1e-4]) {
  const mine = labCurves(WORLDS[name], eps, 0), eng = L6.evalLab(LABS[name], eps, 0); let worst = 0; for (let k = 0; k <= K; k++) worst = Math.max(worst, Math.abs(mine[k] - eng.med[k]) / (mine[k] + 1e-300));
  ok('engine lab median error curve == independent twin-run curve (' + name + ', eps ' + eps + ')', worst < 1e-9, worst);
}
{
  const eps = 1e-2, P = labCurves(W0, eps, 0), Lt = labCurves(WL, eps, 0);
  facts.plain_e10_cm = 100 * P[10]; facts.plain_e30_cm = 100 * P[30]; facts.plain_e81_cm = 100 * P[81]; facts.plain_amp81 = P[81] / eps;
  facts.lat_e10_cm = 100 * Lt[10]; facts.lat_e30_cm = 100 * Lt[30]; facts.lat_e81_cm = 100 * Lt[81]; facts.lat_amp81 = Lt[81] / eps; facts.lat_e81_m = Lt[81];
  const sp = twinRuns(W0, 1e-6, 300, 7, 81); let mx = 0; for (let k = 0; k <= 81; k++) for (const v of sp[k]) mx = Math.max(mx, v / 1e-6); facts.plain_max_amp = mx;
  ok('plain Courtyard: over 300 pairs and 81 steps the error never exceeds sqrt(1 + 1/gamma^2) = 3.03 times the start error', mx <= facts.amp_bound * (1 + 1e-6), mx);
  ok('plain Courtyard: the median error from a 1 cm start stays below 3 times the start error; lattice: the error grows by more than 50 times (geometric)', facts.lat_amp81 > 50 && facts.plain_amp81 < 3, [facts.lat_amp81, facts.plain_amp81]);
}
{ // a growth rate per step from >= 200 independent pairs (start error 1e-6, 40 steps): the mean of ln(|e_40| / eps) / 40
  const eps = 1e-6, rate = (w, seed) => { const sp = twinRuns(w, eps, 300, seed, 40); let acc = 0; for (const v of sp[40]) acc += Math.log(Math.max(v, 1e-14) / eps) / 40; return acc / sp[40].length; };
  facts.lam_lat = rate(WL, 11); facts.lam_plain = rate(W0, 11); facts.lyap_pairs = 300; facts.efold_lat = 1 / facts.lam_lat; facts.decade_steps = Math.LN10 / facts.lam_lat;
  ok('growth rate over 300 pairs: lattice above 0.05 per step (error doubles in under 14 steps), plain below 0.03', facts.lam_lat > 0.05 && facts.lam_plain < 0.03, [facts.lam_lat, facts.lam_plain]);
}
{ // horizon against the start error (5 cm tolerance)
  const T5 = 0.05, row = {};
  for (const [e, key] of [[1e-1, 'e1'], [1e-2, 'e2'], [1e-3, 'e3'], [1e-4, 'e4']]) { const c = labCurves(WL, e, 0); row[key] = horizonI(c, T5); facts['lat_h_' + key] = row[key]; facts['plain_h_' + key] = horizonI(labCurves(W0, e, 0), T5); }
  ok('lattice: one decade of start error (1 cm to 1 mm) buys ln(10)/lambda steps of horizon, to within 6 steps', Math.abs((row.e3 - row.e2) - facts.decade_steps) < 6, [row, facts.decade_steps]);
  ok('plain world: the 5 cm tolerance is never crossed from a start error of 1 cm or less', facts.plain_h_e2 === -1 && facts.plain_h_e3 === -1 && facts.plain_h_e4 === -1, row);
  ok('lattice: from 0.1 mm the 5 cm tolerance is not crossed within the 81 steps', row.e4 === -1, row);
}
{ // the recursion on the lattice: exact while the error is tiny (start error 1e-6), an under-estimate once collisions are no longer linear
  const c6 = L6.evalLab(labL, 1e-6, 0); let w50 = 0, wall = 0; for (let k = 1; k <= K; k++) { const r = Math.abs(c6.lin[k] / c6.med[k] - 1); wall = Math.max(wall, r); if (k <= 50) w50 = Math.max(w50, r); }
  facts.lat_lin_diff_1e6_pct = 100 * w50; facts.lat_lin_diff_1e6_all_pct = 100 * wall;
  ok('lattice, start error 1e-6: the first-order recursion (finite-difference Jacobians) reproduces the median curve to within 1 % up to step 50 and 20 % up to step 81', w50 < 0.01 && wall < 0.20, [w50, wall]);
  const c2 = L6.evalLab(labL, 1e-2, 0); facts.lat_lin_ratio_30 = c2.lin[30] / c2.med[30];
  ok('lattice, start error 1 cm: the recursion UNDER-estimates the measured error at step 30 (ratio below 0.8): collisions are not linear', facts.lat_lin_ratio_30 < 0.8, facts.lat_lin_ratio_30);
  const cp = L6.evalLab(labP, 1e-2, 0); let wp = 0; for (let k = 1; k <= K; k++) wp = Math.max(wp, Math.abs(cp.lin[k] / cp.med[k] - 1)); facts.plain_lin_diff_pct = 100 * wp;
  ok('plain world, start error 1 cm: the recursion reproduces the median curve to within 5 %', wp < 0.05, wp);
}
{ // the deflection of an elastic round post: theta(b) = pi - 2 arcsin(b / R); the gain d theta / d b = -2 / sqrt(R^2 - b^2).  Measured on the simulator (frictionless, elastic,
  // 200 sub-steps) as the least-squares slope over 81 impact parameters in [0.08, 0.12]; a central difference at 1e-4 sees the sub-step staircase of the collision detection instead
  const post = { x: 3.0, y: 2.5, r: 0.2 }, wp = CY.world({ posts: [post], gamma: 0, ePost: 1, curtain: null, W: 20, H: 20, sub: 200, dt: 0.1 }), R = post.r + wp.r;
  const out = b => { let s = [1.0, 2.5 + b, 3, 0]; for (let t = 0; t < 10; t++) s = CY.step(wp, s, null); return Math.atan2(s[3], s[2]); };
  const b0 = 0.1, n = 81, bs = [], ys = []; for (let i = 0; i < n; i++) { bs.push(b0 - 0.02 + 0.04 * i / (n - 1)); ys.push(out(bs[i])); }
  const mb = bs.reduce((a, v) => a + v, 0) / n, my = ys.reduce((a, v) => a + v, 0) / n; let sxy = 0, sxx = 0; for (let i = 0; i < n; i++) { sxy += (bs[i] - mb) * (ys[i] - my); sxx += (bs[i] - mb) ** 2; }
  const gain = Math.abs(sxy / sxx), formula = 2 / Math.sqrt(R * R - b0 * b0);
  facts.post_gain = formula; facts.post_gain_measured = gain; facts.post_deg_per_cm = formula * 0.01 * 180 / Math.PI; facts.post_lat_3m_cm = 100 * 3 * Math.tan(formula * 0.01);
  facts.post_R = R; facts.post_angle_check = Math.abs(out(b0) - (Math.PI - 2 * Math.asin(b0 / R)));
  ok('elastic post: the outgoing angle is pi - 2 arcsin(b / R) (1e-3 rad)', facts.post_angle_check < 1e-3, facts.post_angle_check);
  ok('elastic post: the deflection gain 2 / sqrt(R^2 - b^2) agrees with the simulator within 2 %', Math.abs(gain / formula - 1) < 0.02, [gain, formula]);
}
{ // a persistent per-step velocity error b: the velocity error saturates at b / (1 - d); the position error grows by g b / (1 - d) = b / gamma per step
  const b = 0.001; let ev = 0, ep = 0, epPrev = 0;
  for (let n = 1; n <= 600; n++) { epPrev = ep; ep = ep + G * ev; ev = D * ev + b; if (n === 30) { facts.bias_vel_30_mms = 1000 * ev; facts.bias_pos_30_cm = 100 * ep; } }
  facts.bias_vel_sat_mms = 1000 * b / (1 - D); facts.bias_slope_mm_step = 1000 * b / W0.gamma;
  ok('persistent velocity error: the velocity error tends to b / (1 - d)', close(ev, b / (1 - D), 1e-9), ev);
  ok('persistent velocity error: the position error grows by b / gamma per step', close(ep - epPrev, b / W0.gamma, 1e-9), ep - epPrev);
}

/* ── 4. experiment C: the four ways of training, 12 seeds; the data ladder; an ensemble ── */
const NSEED = 12, rows = [];
for (let seed = 1; seed <= NSEED; seed++) for (const kind of L6.KINDS) {
  const net = getNet(NTR, seed, kind), f = viaCY(net), c = errCurve(f, 0);
  rows.push({ seed, kind, one: oneStep(f), e1: c.med[1], e10: c.med[10], e30: c.med[30], e81: c.med[81], h5: horizonI(c.med, 0.05), h2: horizonI(c.med, 0.02), net, f });
}
const R = (kind, key) => rows.filter(r => r.kind === kind).map(r => r[key]);
const ratioTo = (kind, key) => rows.filter(r => r.kind === kind).map((r, i) => r[key] / rows.filter(q => q.kind === 'one')[i][key]);
facts.seed_one_mm = 1000 * medI(R('one', 'one')); facts.seed_e10_cm = 100 * medI(R('one', 'e10')); facts.seed_e30_cm = 100 * medI(R('one', 'e30')); facts.seed_e81_cm = 100 * medI(R('one', 'e81'));
facts.seed_h5 = medI(R('one', 'h5')); facts.seed_h2 = medI(R('one', 'h2'));
facts.seed_e81_min_cm = 100 * Math.min(...R('one', 'e81')); facts.seed_e81_max_cm = 100 * Math.max(...R('one', 'e81')); facts.seed_spread = Math.max(...R('one', 'e81')) / Math.min(...R('one', 'e81'));
for (const kind of ['noise', 'relabel', 'multi']) {
  const r81 = ratioTo(kind, 'e81'), r30 = ratioTo(kind, 'e30'), key = kind.slice(0, 3);
  facts[key + '_r81'] = medI(r81); facts[key + '_r30'] = medI(r30); facts[key + '_w81'] = r81.filter(x => x < 1).length; facts[key + '_w30'] = r30.filter(x => x < 1).length;
  facts[key + '_seed_e81_cm'] = 100 * medI(R(kind, 'e81')); facts[key + '_seed_h5'] = medI(R(kind, 'h5')); facts[key + '_seed_one_mm'] = 1000 * medI(R(kind, 'one'));
}
facts.n_seeds = NSEED;
ok('noisy inputs with clean targets are worse than teacher forcing at 81 steps on every seed, by more than a factor 2 at the median', facts.noi_w81 === 0 && facts.noi_r81 > 2, [facts.noi_w81, facts.noi_r81]);
ok('relabelling and the multi-step loss are within 25 % of teacher forcing at 81 steps (median of 12 paired ratios) and win on between 3 and 9 of 12 seeds', [facts.rel_r81, facts.mul_r81].every(v => v > 0.8 && v < 1.25) && [facts.rel_w81, facts.mul_w81].every(v => v >= 3 && v <= 9), [facts.rel_r81, facts.mul_r81, facts.rel_w81, facts.mul_w81]);
ok('retraining the same recipe with another seed moves the 81-step error by more than a factor 1.5 (larger than any change of relabelling or multi-step training)', facts.seed_spread > 1.5, facts.seed_spread);
{ // the recursion holds for every one of the 48 trained models
  let worst = 0; for (const r of rows) { const ev = L6.evalNet(S, r.net, 0); for (const k of [10, 30, 81]) worst = Math.max(worst, Math.abs(ev.lin[k] / ev.med[k] - 1)); }
  facts.lin_all_max_pct = 100 * worst; ok('first-order recursion within 3 % of the measured median error at k = 10, 30, 81 for all 48 trained models', worst < 0.03, worst);
}
{ // the data ladder (5 seeds)
  const ladder = {};
  for (const N of [15, 60, 240]) {
    const one = [], h5 = [], e81 = [], e30 = [];
    for (let seed = 1; seed <= 5; seed++) { const f = viaCY(getNet(N, seed, 'one')), c = errCurve(f, 0); one.push(oneStep(f)); h5.push(horizonI(c.med, 0.05)); e81.push(c.med[81]); e30.push(c.med[30]); }
    ladder[N] = { one: medI(one), h5: medI(h5), e81: medI(e81), e30: medI(e30) };
    facts['lad_one_' + N] = 1000 * ladder[N].one; facts['lad_h5_' + N] = ladder[N].h5; facts['lad_e30_' + N] = 100 * ladder[N].e30; facts['lad_e81_' + N] = 100 * ladder[N].e81;
  }
  facts.lad_one_ratio = ladder[15].one / ladder[240].one; facts.lad_decade_equiv = Math.log(facts.lad_one_ratio) / facts.lam_lat; facts.lad_h_ratio = ladder[240].h5 / ladder[15].h5; facts.lad_data_ratio = 240 / 15;
  ok('data ladder: the one-step error falls and the 5 cm horizon rises with the size of the log (15 < 60 < 240 launches)', ladder[15].one > ladder[60].one && ladder[60].one > ladder[240].one && ladder[15].h5 < ladder[60].h5 && ladder[60].h5 < ladder[240].h5, ladder);
  ok('data ladder: 16 times the data buys less than 5 times the horizon', facts.lad_h_ratio < 5 && facts.lad_one_ratio > 5, [facts.lad_h_ratio, facts.lad_one_ratio]);
}
{ // an ensemble of five models: the mean of their rollouts, and how much they disagree
  const fs5 = [1, 2, 3, 4, 5].map(sd => viaCY(getNet(NTR, sd, 'one'))), paths = fs5.map(f => { const P = []; for (let i = 0; i < NTE; i++) P.push(rollModel(f, i, 0)); return P; });
  for (const k of [30, 81]) {
    const memberMed = medI(paths.map(P => medI(P.map((p, i) => hypot2(p[k][0] - TRUTH[i][TA + k][0], p[k][1] - TRUTH[i][TA + k][1]))))), meanErr = [], spread = [];
    for (let i = 0; i < NTE; i++) {
      const mx = paths.reduce((a, P) => a + P[i][k][0], 0) / 5, my = paths.reduce((a, P) => a + P[i][k][1], 0) / 5;
      meanErr.push(hypot2(mx - TRUTH[i][TA + k][0], my - TRUTH[i][TA + k][1])); spread.push(Math.sqrt(paths.reduce((a, P) => a + (P[i][k][0] - mx) ** 2 + (P[i][k][1] - my) ** 2, 0) / 5));
    }
    facts['ens_member_' + k + '_cm'] = 100 * memberMed; facts['ens_mean_' + k + '_cm'] = 100 * medI(meanErr); facts['ens_spread_' + k + '_cm'] = 100 * medI(spread);
  }
  ok('ensemble of 5: the mean of the rollouts is still wrong by more than 60 % of a single member, and the members disagree by less than the mean is wrong (30 steps)', facts.ens_mean_30_cm > 0.6 * facts.ens_member_30_cm && facts.ens_spread_30_cm < facts.ens_mean_30_cm, [facts.ens_mean_30_cm, facts.ens_member_30_cm, facts.ens_spread_30_cm]);
}

/* ── 5. experiment D: re-observation ── */
{
  const m = 10, c = errCurve(C1.f, m), cap = Math.max(...c.med), e81 = c.med[81];
  facts.reset10_cap_cm = 100 * cap; facts.reset10_e81_cm = 100 * e81; facts.reset10_e9_cm = 100 * c.med[9]; facts.reset10_e10_cm = 100 * c.med[10];
  ok('exact re-observation every 10 steps: the error is exactly 0 at the steps of re-observation', [10, 20, 30, 40, 50, 60, 70, 80].every(k => c.med[k] === 0), c.med.slice(8, 12));
  ok('re-observation caps the median error far below the open-loop 81-step error', cap < 0.35 * C1.med[81], [cap, C1.med[81]]);
  // identity: after a re-anchor at step k0 the model runs without the nudge, so the error at k0 + j equals the open-loop error of a rollout restarted from the true state at k0
  let worst = 0; for (const i of [0, 7, 40]) { const k0 = 20, f = C1.f; let s = TRUTH[i][TA + k0].slice(); for (let j = 1; j <= 9; j++) { s = f(s, null); const mine = hypot2(s[0] - TRUTH[i][TA + k0 + j][0], s[1] - TRUTH[i][TA + k0 + j][1]); const eng = hypot2(c.paths[i][k0 + j][0] - TRUTH[i][TA + k0 + j][0], c.paths[i][k0 + j][1] - TRUTH[i][TA + k0 + j][1]); worst = Math.max(worst, Math.abs(mine - eng)); } }
  ok('re-anchored rollout == a fresh rollout from the true state', worst < 1e-12, worst);
  const lc = labCurves(WL, 1e-2, 10); facts.lat_reset10_cap_cm = 100 * Math.max(...lc); facts.lat_reset10_e81_cm = 100 * lc[81];
  ok('lattice, start error 1 cm, re-observation every 10 steps: the error stays below 3 cm (open loop: more than 100 cm)', Math.max(...lc) < 0.03 && facts.lat_e81_cm > 100, [Math.max(...lc), facts.lat_e81_cm]);
  const m5 = errCurve(C1.f, 5); facts.reset5_cap_cm = 100 * Math.max(...m5.med);
  ok('a shorter gap between re-observations gives a lower cap (5 steps below 10 steps)', facts.reset5_cap_cm < facts.reset10_cap_cm, [facts.reset5_cap_cm, facts.reset10_cap_cm]);
}

/* ── 6. the exit: nudges the operator took and nudges it did not ── */
function endingsI(f, offset, seed) {
  const rng = CY.rng(seed), errs = [], free = []; let touched = 0;
  for (let i = 0; i < NTE; i++) {
    const an = 2 * Math.PI * rng(), n0 = nudgeI(i), a = [n0[0] + offset * Math.cos(an), n0[1] + offset * Math.sin(an)];
    let s = stateI(i, TA), m = s, hit = false;
    for (let k = 1; k <= K; k++) { s = stepI(W0, s, k === 1 ? a : null); m = f(m, k === 1 ? a : null); if (s[0] < 0.12 || s[0] > 7.88 || s[1] < 0.12 || s[1] > 4.88) hit = true; }
    const e = hypot2(m[0] - s[0], m[1] - s[1]); errs.push(e); if (hit) touched++; else free.push(e);
  }
  return { errs, free, touched };
}
{
  const GR = W0.goal.r, share = (a, t) => a.filter(v => v > t).length / a.length;
  for (const [off, key] of [[0, 'op'], [0.5, 'o5'], [1.0, 'o10']]) {
    const r = endingsI(C1.f, off, 31), e = L6.endings(S, C1.net, off, 31);
    ok('engine exit measurement == independent one (offset ' + off + ')', Math.abs(share(r.errs, GR) - L6.share(e.errs, GR)) < 1e-12 && r.touched === e.touched, [share(r.errs, GR), L6.share(e.errs, GR)]);
    facts['ex_' + key + '_share'] = 100 * share(r.errs, GR); facts['ex_' + key + '_med_cm'] = 100 * medI(r.errs); facts['ex_' + key + '_wall'] = r.touched; facts['ex_' + key + '_free_share'] = r.free.length ? 100 * share(r.free, GR) : 0; facts['ex_' + key + '_free_n'] = r.free.length;
  }
  facts.goal_r_cm = 100 * GR;
  // the same experiment as a whole study (what the widget shows): the error curve, the recursion and the horizons for nudges the operator did not take
  for (const [off, key] of [[0.25, 'o25'], [0.5, 'o5'], [1.0, 'o10']]) {
    const st = studyOf(off, 31), c = errCurve(C1.f, 0, st), lin = recursionCurve(C1.f, 0, st), ev = L6.evalNet(L6.study(te, off, 31), C1.net, 0);
    let worst = 0; for (let k = 0; k <= K; k++) worst = Math.max(worst, Math.abs(ev.med[k] - c.med[k]));
    ok('engine study with nudges shifted by ' + off + ' m/s == independent study (median error at every step)', worst < 1e-9, worst);
    ok('median error at step 81 for the shifted nudges == median of the imagined endings (offset ' + off + ')', off === 0.25 || close(c.med[81], medI(endingsI(C1.f, off, 31).errs), 1e-12), c.med[81]);
    facts['off_' + key + '_e1_cm'] = 100 * c.med[1]; facts['off_' + key + '_e30_cm'] = 100 * c.med[30]; facts['off_' + key + '_e81_cm'] = 100 * c.med[81]; facts['off_' + key + '_one_mm'] = 1000 * oneStep(C1.f, st);
    facts['off_' + key + '_h5'] = horizonI(c.med, 0.05); facts['off_' + key + '_hz5'] = horizonI(lin, 0.05); facts['off_' + key + '_h2'] = horizonI(c.med, 0.02); facts['off_' + key + '_h10'] = horizonI(c.med, 0.10);
    facts['off_' + key + '_lin81'] = lin[81] / c.med[81];
  }
  facts.off_ratio81 = facts.off_o10_e81_cm / facts.e81_cm; facts.off_ratio_nudge = facts.off_o10_e1_cm / (100 * C1.med[1]);
  ok('shifted nudges: the horizon at 5 cm falls from the logged value as the shift grows (0 > 0.25 > 0.5 > 1 m/s)', facts.h5 > facts.off_o25_h5 && facts.off_o25_h5 > facts.off_o5_h5 && facts.off_o5_h5 > facts.off_o10_h5, [facts.h5, facts.off_o25_h5, facts.off_o5_h5, facts.off_o10_h5]);
  ok('shifted nudges: the recursion (J and delta at the true states) still predicts the 5 cm horizon within 1 step, and the error at 81 steps within 5 %', [facts.off_o5_h5 - facts.off_o5_hz5, facts.off_o10_h5 - facts.off_o10_hz5].every(d => Math.abs(d) <= 1) && Math.abs(facts.off_o10_lin81 - 1) < 0.05, [facts.off_o10_h5, facts.off_o10_hz5, facts.off_o10_lin81]);
  ok('shifted nudges: the median error at 81 steps is more than 5 times the logged one for a shift of 1 m/s', facts.off_ratio81 > 5, facts.off_ratio81);
  ok('the operator\'s own nudges: fewer than 3 % of imagined endings are off by more than the goal radius; for nudges 1 m/s away: more than 30 %', facts.ex_op_share < 3 && facts.ex_o10_share > 30, [facts.ex_op_share, facts.ex_o10_share]);
  ok('the gap is not only walls: among the nudges whose true path touches no wall, still more than 10 % are off by more than the goal radius', facts.ex_o10_free_share > 10, facts.ex_o10_free_share);
  // how much of the logged nudge does the state explain?  R^2 of the nudge on the state at the nudge time, on a large log
  const big = L6.makeLog(2000, 5), nB = big.n, X = new Float64Array(nB * 5), Y = new Float64Array(nB * 2), mean = [0, 0];
  for (let i = 0; i < nB; i++) { const s = L6.stateAt(big, i, TA), a = L6.nudgeOf(big, i); X.set([1, s[0], s[1], s[2], s[3]], i * 5); Y.set(a, i * 2); mean[0] += a[0] / nB; mean[1] += a[1] / nB; }
  const Wt = CY.la.ridge(X, nB, 5, Y, 2, 1e-9); let res = 0, tot = 0;
  for (let i = 0; i < nB; i++) for (let c = 0; c < 2; c++) { let p = 0; for (let q = 0; q < 5; q++) p += X[i * 5 + q] * Wt[q * 2 + c]; res += (Y[i * 2 + c] - p) ** 2; tot += (Y[i * 2 + c] - mean[c]) ** 2; }
  facts.nudge_r2_pct = 100 * (1 - res / tot);
  ok('the logged nudge is largely a function of the state (R^2 above 0.6)', facts.nudge_r2_pct > 60, facts.nudge_r2_pct);
}

/* ── 7. checkpoint: a model that is exact except that its friction is 0.30 instead of 0.35 ── */
{
  const v0 = 2, gHat = 0.30, wHat = CY.world({ gamma: gHat, curtain: null, W: 1000, H: 1000 }), wTrue = CY.world({ curtain: null, W: 1000, H: 1000 });
  let a = [0.5, 500, v0, 0], b = a.slice(), one = 0;
  for (let t = 0; t < 800; t++) { a = CY.step(wTrue, a, null); b = CY.step(wHat, b, null); if (t === 0) one = Math.abs(b[0] - a[0]); }
  const gOf = gm => (1 - Math.exp(-gm * W0.dt)) / gm;
  facts.ck_one_mm = 1000 * one; facts.ck_stop_true = a[0] - 0.5; facts.ck_stop_model = b[0] - 0.5; facts.ck_gap = facts.ck_stop_model - facts.ck_stop_true; facts.ck_ratio = facts.ck_gap / one;
  facts.ck_gap_pct = 100 * facts.ck_gap / facts.ck_stop_true;
  ok('checkpoint: the one-step position error is v0 (g(0.30) - g(0.35))', close(one, v0 * (gOf(gHat) - gOf(W0.gamma)), 1e-12), [one, v0 * (gOf(gHat) - gOf(W0.gamma))]);
  ok('checkpoint: stopping distances are v0 / gamma by closed form and by simulation (1e-6)', close(facts.ck_stop_true, v0 / W0.gamma, 1e-6) && close(facts.ck_stop_model, v0 / gHat, 1e-6), [facts.ck_stop_true, facts.ck_stop_model]);
  ok('checkpoint: the final error is more than 1000 times the one-step error', facts.ck_ratio > 1000, facts.ck_ratio);
}

/* ── 8. the page's own widget ── */
const PAGE = path.join(DIR, '06_long_horizon_rollouts.html'), HAVE_PAGE = fs.existsSync(PAGE);
ok('the lesson page exists', HAVE_PAGE);
const page = HAVE_PAGE ? loadPage(PAGE, { dpr: 1 }) : { problems: [], set() {}, num() { return NaN; }, text() { return ''; }, click() {}, value() { return ''; } };
ok('page loads cleanly', page.problems.length === 0, page.problems.join(' | '));
if (HAVE_PAGE) {
  const lenOk = (id, cm) => { const t = page.text(id), x = cmOf(id); return Math.abs(x - cm) <= (/mm/.test(t) ? 0.00051 : (/cm/.test(t) ? 0.0051 : 0.51)); };    // the readout shows 2 decimals of its own unit
  const cmOf = id => { const t = page.text(id), x = page.num(id); return /mm/.test(t) ? x / 10 : (/\bm\b/.test(t) && !/cm/.test(t) ? x * 100 : x); };      // a length readout in cm
  const setAll = (o) => { for (const [k, v] of Object.entries(o)) page.set('w06-' + k, v); };
  const horizonText = (id, h) => h === -1 ? /never|>/.test(page.text(id)) : page.num(id) === h;
  const T0 = { world: 'learned', kind: 'one', off: 'op', k: 30, m: 0, tau: 3, eps: -2 };
  // (a) the learned model, teacher forcing, no re-observation, the logged nudges
  setAll(T0);
  ok('widget (learned, teacher forcing): one-step error', close(page.num('w06-r1'), facts.one_mm, 0.0051), [page.text('w06-r1'), facts.one_mm]);
  ok('widget: error at step 30', lenOk('w06-r2', facts.e30_cm), [page.text('w06-r2'), facts.e30_cm]);
  ok('widget: errors at steps 10, 30, 81', lenOk('w06-e10', facts.e10_cm) && lenOk('w06-e30', facts.e30_cm) && lenOk('w06-e81', facts.e81_cm), [page.text('w06-e10'), page.text('w06-e30'), page.text('w06-e81')]);
  ok('widget: amplification at step 30', close(page.num('w06-r3'), facts.amp30, 0.051), [page.text('w06-r3'), facts.amp30]);
  ok('widget: horizon at 5 cm, measured and predicted by the recursion', page.num('w06-hz') === facts.h5 && page.num('w06-hzr') === facts.hz_lin5, [page.text('w06-hz'), facts.h5, page.text('w06-hzr'), facts.hz_lin5]);
  ok('widget: recursion / measured at step 30', close(page.num('w06-lin'), facts.lin30_ratio, 0.0051), [page.text('w06-lin'), facts.lin30_ratio]);
  page.set('w06-k', 81); ok('widget: recursion / measured at step 81', close(page.num('w06-lin'), facts.lin81_ratio, 0.0051), [page.text('w06-lin'), facts.lin81_ratio]); page.set('w06-k', 30);
  for (const [ti, tau] of [[1, 0.01], [2, 0.02], [4, 0.10]]) { page.set('w06-tau', ti); ok('widget: horizon at tau = ' + tau + ' m', horizonText('w06-hz', horizonI(C1.med, tau)), [page.text('w06-hz'), horizonI(C1.med, tau)]); }
  page.set('w06-tau', 3);
  // (b) the other ways of training
  for (const kind of ['noise', 'relabel', 'multi']) {
    page.set('w06-kind', kind);
    ok('widget (' + kind + '): errors at 30 and 81 steps', lenOk('w06-e30', facts[kind + '_e30_cm']) && lenOk('w06-e81', facts[kind + '_e81_cm']), [page.text('w06-e30'), facts[kind + '_e30_cm'], page.text('w06-e81'), facts[kind + '_e81_cm']]);
    ok('widget (' + kind + '): horizon at 5 cm', page.num('w06-hz') === facts[kind + '_h5'], [page.text('w06-hz'), facts[kind + '_h5']]);
  }
  page.set('w06-kind', 'one');
  // (c) re-observation every 10 steps
  page.set('w06-m', 10); page.set('w06-k', 9);
  ok('widget: re-observation every 10 steps, error just before the re-observation', lenOk('w06-r2', facts.reset10_e9_cm), [page.text('w06-r2'), facts.reset10_e9_cm]);
  page.set('w06-k', 10); ok('widget: error at the re-observation is 0', page.num('w06-r2') === 0, page.text('w06-r2'));
  ok('widget: error at 81 steps with re-observation every 10', lenOk('w06-e81', facts.reset10_e81_cm), [page.text('w06-e81'), facts.reset10_e81_cm]);
  page.set('w06-m', 5); page.set('w06-k', 4); ok('widget: re-observation every 5 steps, error just before the re-observation', lenOk('w06-r2', 100 * errCurve(C1.f, 5).med[4]), [page.text('w06-r2')]);
  page.set('w06-m', 0); page.set('w06-k', 30);
  // (d) the exact simulator with a wrong start
  for (const [wn, ek] of [['plain', 'plain'], ['lattice', 'lat']]) {
    setAll({ world: wn, eps: -2, m: 0, tau: 3, k: 30 });
    ok('widget (' + wn + ', start error 1 cm): errors at 10, 30, 81', lenOk('w06-e10', facts[ek + '_e10_cm']) && lenOk('w06-e30', facts[ek + '_e30_cm']) && lenOk('w06-e81', facts[ek + '_e81_cm']), [page.text('w06-e10'), facts[ek + '_e10_cm'], page.text('w06-e30'), facts[ek + '_e30_cm'], page.text('w06-e81'), facts[ek + '_e81_cm']]);
  }
  ok('widget (lattice, start error 1 cm): horizon at 5 cm', horizonText('w06-hz', facts.lat_h_e2), [page.text('w06-hz'), facts.lat_h_e2]);
  page.set('w06-eps', -3); ok('widget (lattice, start error 1 mm): horizon at 5 cm', horizonText('w06-hz', facts.lat_h_e3), [page.text('w06-hz'), facts.lat_h_e3]);
  page.set('w06-eps', -4); ok('widget (lattice, start error 0.1 mm): horizon at 5 cm is not reached', horizonText('w06-hz', facts.lat_h_e4), [page.text('w06-hz'), facts.lat_h_e4]);
  page.set('w06-eps', -2); page.set('w06-m', 10); ok('widget (lattice, 1 cm, re-observation every 10): error at 81 steps', lenOk('w06-e81', facts.lat_reset10_e81_cm), [page.text('w06-e81'), facts.lat_reset10_e81_cm]);
  page.set('w06-m', 0); page.set('w06-world', 'plain'); page.set('w06-k', 81);
  ok('widget (plain, 1 cm): the amplification at step 81 is below the closed-form bound', page.num('w06-r3') <= facts.amp_bound + 0.01 && close(page.num('w06-r3'), facts.plain_amp81, 0.051), [page.text('w06-r3'), facts.amp_bound, facts.plain_amp81]);
  page.set('w06-k', 30);
  // (e) the nudges the operator never took
  setAll({ world: 'learned', kind: 'one', m: 0, tau: 3, k: 30 });
  for (const [ov, key] of [['o5', 'o5'], ['o10', 'o10']]) {
    page.set('w06-off', ov);
    ok('widget (nudges shifted by ' + ov + '): error at 81 steps', lenOk('w06-e81', facts['off_' + key + '_e81_cm']), [page.text('w06-e81'), facts['off_' + key + '_e81_cm']]);
    ok('widget (nudges shifted by ' + ov + '): horizon at 5 cm, measured and predicted by the recursion', page.num('w06-hz') === facts['off_' + key + '_h5'] && page.num('w06-hzr') === facts['off_' + key + '_hz5'], [page.text('w06-hz'), facts['off_' + key + '_h5'], page.text('w06-hzr'), facts['off_' + key + '_hz5']]);
  }
  page.set('w06-off', 'op');
}
ok('widget ran without errors', page.problems.length === 0, page.problems.join(' | '));
console.error(fails ? `${fails} check(s) FAILED` : 'all checks passed');
console.log(JSON.stringify({ facts }));
process.exit(fails ? 1 : 0);
