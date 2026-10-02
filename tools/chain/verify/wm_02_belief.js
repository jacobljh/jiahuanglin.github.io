#!/usr/bin/env node
/* Oracle for World Models lesson 02, "The state you cannot see: belief".
 *
 * Experiment: the NUDGE task of lesson 1 (launch, one impulse at step 12, coast 80 steps, success = ball ends in the goal disc) with the agent given what a
 * sensor gives: a noisy position (0.1 m) and nothing while the ball is behind the curtain.  The widget filters a seeded pool of launches (one fixed table of sensor
 * noise per launch and step), tracks 40 steps, and plans the nudge from the belief at step 12.
 *
 * Independent of the widget and of l02_belief.js (which the widget uses):
 *   - a separate five-sub-step integrator (walls + wind), cross-checked against CY.step; closed forms for friction, the unit-wind response and "free flight";
 *   - the filter re-run with the ENGINE's general matrix filter CY.kf (Joseph form) and, for q = 0, with a batch normal-equation (MAP) fit through the prior and
 *     all readings: recursive == batch to 1e-9; scalar fusion identity; blind growth formula == repeated predict; Riccati fixed point;
 *   - least-squares-line slope variance by Monte Carlo; the ladder of hand-made summaries; calibration (NIS, 95 % coverage) on episodes drawn from the filter's own
 *     Gaussian prior (must be exactly honest) and on the launcher's; mismatched noise; wind; the planner and its claim, replayed with the separate integrator;
 *   - the page's own widget is then driven into each state the prose describes and its readouts are compared.
 * Prints {"facts": {...}} as its last line.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '../../../all_lessons');
const DIR = fs.existsSync(path.join(ROOT, 'world_models_new')) ? path.join(ROOT, 'world_models_new') : path.join(ROOT, 'world_models');
const CY = require(path.join(DIR, 'courtyard.js'));
globalThis.CY = CY;
const BL = require(path.join(DIR, 'l02_belief.js'));
const { loadPage } = require('../dom_probe.js');

let fails = 0;
const facts = {};
function ok(name, cond, extra) { if (!cond) { fails++; console.error('FAIL', name, extra === undefined ? '' : extra); } }
const close = (a, b, tol) => Math.abs(a - b) <= (tol === undefined ? 1e-9 : tol);

/* ── 1. an independent integrator: friction, walls, wind (five sub-steps) ── */
const GAMMA = 0.35, DT = 0.1, SUB = 5, RB = 0.1, WALL_E = 0.9, AW = 8, AH = 5, GOAL = { x: 6.6, y: 2.5, r: 0.5 }, SO = 0.1;
const D = Math.exp(-GAMMA * DT), G = (1 - D) / GAMMA, A = k => (1 - Math.pow(D, k)) / GAMMA;
function stepI(s, a, wind, touched) {
  let x = s[0], y = s[1], vx = s[2], vy = s[3];
  if (a) { vx += a[0]; vy += a[1]; }
  const h = DT / SUB, damp = Math.exp(-GAMMA * h), glide = (1 - damp) / GAMMA;
  for (let i = 0; i < SUB; i++) {
    vx += wind[0] * h; vy += wind[1] * h;
    x += vx * glide; y += vy * glide; vx *= damp; vy *= damp;
    if (x < RB) { x = 2 * RB - x; vx = -WALL_E * vx; if (touched) touched.hit = true; }
    if (x > AW - RB) { x = 2 * (AW - RB) - x; vx = -WALL_E * vx; if (touched) touched.hit = true; }
    if (y < RB) { y = 2 * RB - y; vy = -WALL_E * vy; if (touched) touched.hit = true; }
    if (y > AH - RB) { y = 2 * (AH - RB) - y; vy = -WALL_E * vy; if (touched) touched.hit = true; }
  }
  return [x, y, vx, vy];
}
const NOWIND = [0, 0], WIND = [-0.2, 0];
{
  const rng = CY.rng(11); let worst = 0;
  for (let n = 0; n < 600; n++) {
    const wd = n % 2 ? WIND : NOWIND, w = CY.world({ wind: wd });
    let s = [0.3 + 7.4 * rng(), 0.3 + 4.4 * rng(), 6 * rng() - 3, 6 * rng() - 3], q = s.slice();
    for (let t = 0; t < 30; t++) { const a = t === 0 && n % 3 === 0 ? [rng() - 0.5, rng() - 0.5] : null; s = stepI(s, a, wd); q = CY.step(w, q, a); }
    for (let c = 0; c < 4; c++) worst = Math.max(worst, Math.abs(s[c] - q[c]));
  }
  ok('independent integrator == CY.step (600 trajectories, 30 steps, walls and wind included)', worst < 1e-9, worst);
}
facts.d = D; facts.g = G; facts.stop_gain = 1 / GAMMA; facts.fric_pct = 100 * (1 - D);
{ // free flight in closed form: p_k = p_0 + v_0 A_k, v_k = v_0 d^k (no walls in reach)
  const w = CY.world({ W: 1e3, H: 1e3, curtain: null }); let s = [500, 500, 2.2, -0.7]; const s0 = s.slice();
  for (let k = 1; k <= 25; k++) s = CY.step(w, s, null);
  ok('closed form of free flight: position', close(s[0], s0[0] + s0[2] * A(25), 1e-9) && close(s[1], s0[1] + s0[3] * A(25), 1e-9));
  ok('closed form of free flight: velocity', close(s[2], s0[2] * Math.pow(D, 25), 1e-12));
}
// the response of one step to a unit constant acceleration, by the sub-step recurrence (closed form of the five-sub-step scheme)
const WIND_COL = (() => {
  const h = DT / SUB, damp = Math.exp(-GAMMA * h), glide = (1 - damp) / GAMMA; let v = 0, p = 0;
  for (let i = 0; i < SUB; i++) { v += h; p += glide * v; v *= damp; }
  return { cp: p, cv: v };
})();
{
  const F3 = BL.model(true).F;
  ok('the wind column of F read off the simulator == the sub-step recurrence', close(F3[2], WIND_COL.cp, 1e-12) && close(F3[5], WIND_COL.cv, 1e-12), [F3[2], WIND_COL.cp, F3[5], WIND_COL.cv]);
  ok('F for one axis: [1, g; 0, d]', close(BL.model(false).F[1], G, 1e-14) && close(BL.model(false).F[3], D, 1e-14));
  facts.wind_cp = WIND_COL.cp; facts.wind_cv = WIND_COL.cv;
}

/* ── 2. the pool of launches, replayed ── */
const TA = 12, TF = 80, AMAX = 3, KC = 128, T = 40, NEP = 240, NP = 120, SEED = 5;
const W0 = CY.world({});
function makePool(N, seed) {
  const rng = CY.rng(seed), E = [];
  for (let i = 0; i < N; i++) { const s0 = CY.launch(W0, rng), z = []; for (let t = 0; t <= T; t++) z.push([CY.randn(rng), CY.randn(rng)]); E.push({ s0, z }); }
  return E;
}
const POOL = makePool(NEP, SEED);
const PRIOR = [{ mu: [0.5, 2.46], sd: [0.05, 0.29] }, { mu: [2.5, 0], sd: [0.87, 0.43] }];
{ // what the agent knows about the launcher: the first two moments of the launch distribution (speed U(2,3), angle U(-0.3,0.3), y U(1,4), x = 0.5)
  const r = CY.rng(2), n = 200000; let sx = 0, sy = 0, svx = 0, svy = 0, sxx = 0, syy = 0, svxx = 0, svyy = 0;
  for (let i = 0; i < n; i++) { const s = CY.launch(W0, r); sx += s[0]; sy += s[1]; svx += s[2]; svy += s[3]; sxx += s[0] * s[0]; syy += s[1] * s[1]; svxx += s[2] * s[2]; svyy += s[3] * s[3]; }
  const sd = (m, m2) => Math.sqrt(m2 / n - (m / n) ** 2);
  ok('prior mean of vx and sd of vx, vy, y match the launcher', close(svx / n, PRIOR[0].mu[1], 0.01) && close(sd(svx, svxx), PRIOR[0].sd[1], 0.01) && close(sd(svy, svyy), PRIOR[1].sd[1], 0.01) && close(sd(sy, syy), PRIOR[1].sd[0], 0.01) && close(sy / n, 2.5, 0.01) && close(svy / n, 0, 0.01), [svx / n, sd(svx, svxx), sd(svy, svyy), sd(sy, syy)]);
}
function worldOf(width, windOn) { return { curtain: width > 0 ? [2.6, 2.6 + width] : null, wind: windOn ? WIND : NOWIND }; }
const occ = (wc, s) => !!wc.curtain && s[0] > wc.curtain[0] && s[0] < wc.curtain[1];
function trackI(ep, wc) {                         // true path with the separate integrator, which steps touched a wall
  const tr = [ep.s0], free = [true]; let s = ep.s0, f = true;
  for (let t = 0; t < T; t++) { const tc = { hit: false }; s = stepI(s, null, wc.wind, tc); if (tc.hit) f = false; tr.push(s); free.push(f); }
  return { tr, vis: tr.map(s => !occ(wc, s)), free: f, freeUntil: free.lastIndexOf(true) };
}

/* ── 3. the filter by three independent roads ── */
function kfModel(n, q, R) {                        // for the ENGINE's matrix filter
  const F = n === 2 ? [1, G, 0, D] : [1, G, WIND_COL.cp, 0, D, WIND_COL.cv, 0, 0, 1], H = new Array(n).fill(0); H[0] = 1;
  const Q = new Array(n * n).fill(0); Q[n + 1] = q * q;
  return { n, m: 1, F, H, Q, R: [R] };
}
function kfRun(model, mu, sd, zs, vis, Tn) {
  const n = model.n, P0 = new Float64Array(n * n); for (let i = 0; i < n; i++) P0[i * n + i] = sd[i] * sd[i];
  let st = { x: Float64Array.from(mu), P: P0 }; const out = { X: [], P: [], nu: [], S: [] };
  for (let t = 0; t <= Tn; t++) {
    if (t > 0) st = CY.kf.predict(model, st);
    let nu = NaN, S = NaN;
    if (vis[t]) { const up = CY.kf.update(model, st, [zs[t]]); st = { x: up.x, P: up.P }; nu = up.innov[0]; S = up.S[0]; }
    out.X.push(Array.from(st.x)); out.P.push(Array.from(st.P)); out.nu.push(nu); out.S.push(S);
  }
  return out;
}
function batchMean(mu, sd, zs, vis, t, R) {        // MAP fit of (p0, v0) through the prior and every visible reading up to t, then carried to time t
  const info = [1 / (sd[0] * sd[0]), 0, 0, 1 / (sd[1] * sd[1])], rhs = [mu[0] / (sd[0] * sd[0]), mu[1] / (sd[1] * sd[1])];
  for (let u = 0; u <= t; u++) if (vis[u]) { const h = [1, A(u)]; for (let i = 0; i < 2; i++) { rhs[i] += h[i] * zs[u] / R; for (let j = 0; j < 2; j++) info[i * 2 + j] += h[i] * h[j] / R; } }
  const det = info[0] * info[3] - info[1] * info[2], th = [(info[3] * rhs[0] - info[1] * rhs[1]) / det, (-info[2] * rhs[0] + info[0] * rhs[1]) / det];
  const cov = [info[3] / det, -info[1] / det, -info[2] / det, info[0] / det];
  const Ft = [1, A(t), 0, Math.pow(D, t)];           // F^t
  const m = [Ft[0] * th[0] + Ft[1] * th[1], Ft[2] * th[0] + Ft[3] * th[1]];
  const FC = [Ft[0] * cov[0] + Ft[1] * cov[2], Ft[0] * cov[1] + Ft[1] * cov[3], Ft[2] * cov[0] + Ft[3] * cov[2], Ft[2] * cov[1] + Ft[3] * cov[3]];
  return { mean: m, P: [FC[0] * Ft[0] + FC[1] * Ft[1], FC[0] * Ft[2] + FC[1] * Ft[3], FC[2] * Ft[0] + FC[3] * Ft[1], FC[2] * Ft[2] + FC[3] * Ft[3]] };
}
// mirror of the engine's per-setting track, built on the engine's matrix filter
function trackKF(ep, set, ti) {
  const wc = worldOf(set.width, set.wind), n = set.aware ? 3 : 2, R = SO * SO * set.rmult, ax = [];
  const vis = ti.vis, tr = ti.tr;
  for (let c = 0; c < 2; c++) {
    const zs = tr.map((s, t) => s[c] + SO * ep.z[t][c]), mu = PRIOR[c].mu.slice(), sd = PRIOR[c].sd.slice();
    if (n === 3) { mu.push(0); sd.push(0.3); }
    ax.push(kfRun(kfModel(n, set.q, R), mu, sd, zs, vis, T));
  }
  return { ax, n, zs: [0, 1].map(c => tr.map((s, t) => s[c] + SO * ep.z[t][c])) };
}
const TI = {};                                      // true paths per wind setting and width
function tiFor(i, width, windOn) { const k = i + '|' + width + '|' + windOn; return TI[k] || (TI[k] = trackI(POOL[i], worldOf(width, windOn))); }

const BASE = { width: 0.8, wind: 0, aware: 0, rmult: 1, q: 0 };
{ // the engine's scalar-observation filter against the engine's general filter and against the batch fit
  let wX = 0, wP = 0, wB = 0, wBP = 0, wNu = 0;
  for (let i = 0; i < 60; i++) {
    const ti = tiFor(i, 0.8, 0), kk = trackKF(POOL[i], BASE, ti), tk = BL.track(POOL[i], BASE);
    ok('the engine marks the same free-flight launches as the separate integrator', tk.free === ti.free, [i, tk.free, ti.free]);
    for (let c = 0; c < 2; c++) for (let t = 0; t <= T; t++) {
      for (let j = 0; j < 2; j++) wX = Math.max(wX, Math.abs(tk.ax[c].X[t * 2 + j] - kk.ax[c].X[t][j]));
      for (let j = 0; j < 4; j++) wP = Math.max(wP, Math.abs(tk.ax[c].P[t * 4 + j] - kk.ax[c].P[t][j]) / (1e-9 + Math.abs(kk.ax[c].P[t][j])));
      if (ti.vis[t]) wNu = Math.max(wNu, Math.abs(tk.ax[c].nu[t] - kk.ax[c].nu[t]), Math.abs(tk.ax[c].S[t] / kk.ax[c].S[t] - 1));
      const bm = batchMean(PRIOR[c].mu, PRIOR[c].sd, kk.zs[c], ti.vis, t, SO * SO);
      for (let j = 0; j < 2; j++) wB = Math.max(wB, Math.abs(kk.ax[c].X[t][j] - bm.mean[j]));
      for (let j = 0; j < 4; j++) wBP = Math.max(wBP, Math.abs(kk.ax[c].P[t][j] - bm.P[j]) / (1e-9 + Math.abs(bm.P[j])));
    }
  }
  ok('scalar filter (engine l02) == the engine general matrix filter CY.kf: means', wX < 1e-9, wX);
  ok('... covariances (relative)', wP < 1e-8, wP);
  ok('... innovations and their variances', wNu < 1e-8, wNu);
  ok('RECURSIVE == BATCH: the filter mean equals the fit through the prior and all readings so far (q = 0)', wB < 1e-9, wB);
  ok('... and the covariance equals the inverse information (relative)', wBP < 1e-8, wBP);
  facts.batch_gap = wB;
  for (const [nm, set] of [['wind unaware', { ...BASE, wind: 1 }], ['wind aware', { ...BASE, wind: 1, aware: 1 }], ['doubt .05', { ...BASE, q: 0.05 }], ['R/4', { ...BASE, rmult: 0.25 }]]) {
    let w1 = 0;
    for (let i = 0; i < 25; i++) { const ti = tiFor(i, 0.8, set.wind), kk = trackKF(POOL[i], set, ti), tk = BL.track(POOL[i], set); for (let c = 0; c < 2; c++) for (let t = 0; t <= T; t++) for (let j = 0; j < tk.n; j++) w1 = Math.max(w1, Math.abs(tk.ax[c].X[t * tk.n + j] - kk.ax[c].X[t][j])); }
    ok('scalar filter == CY.kf, setting ' + nm, w1 < 1e-9, w1);
  }
}

/* ── 4. the algebra of the lesson ── */
{ // scalar fusion: product of two Gaussians, by quadrature, and the gain form
  let worst = 0; const rr = CY.rng(7);
  for (let i = 0; i < 200; i++) {
    const mu = 4 * rr() - 2, P = 0.01 + 2 * rr(), R = 0.01 + 2 * rr(), z = 4 * rr() - 2;
    const Pn = 1 / (1 / P + 1 / R), mn = Pn * (mu / P + z / R), K = P / (P + R);
    worst = Math.max(worst, Math.abs(mn - (mu + K * (z - mu))), Math.abs(Pn - (1 - K) * P), Math.abs(Pn - P * R / (P + R)));
    let Z = 0, M = 0, V = 0; for (let j = -2000; j <= 2000; j++) { const s = mn + j * Math.sqrt(Pn) / 250, wgt = Math.exp(-0.5 * (s - mu) ** 2 / P - 0.5 * (z - s) ** 2 / R); Z += wgt; M += wgt * s; V += wgt * s * s; }
    M /= Z; V = V / Z - M * M; worst = Math.max(worst, Math.abs(M - mn) / Math.sqrt(Pn), Math.abs(V - Pn) / Pn);
  }
  ok('scalar fusion: precisions add, K = P / (P + R), by closed form and by quadrature of the product', worst < 1e-6, worst);
}
const FCUT = (P, k) => { const a = A(k); return P[0] + 2 * a * P[1] + a * a * P[3]; };
{ // the belief after the ten visible readings before the curtain (q = 0), and blind growth
  const m = kfModel(2, 0, SO * SO), vis = []; for (let t = 0; t <= 10; t++) vis.push(t < 10);
  const run = kfRun(m, PRIOR[0].mu, PRIOR[0].sd, new Array(11).fill(0), vis, 9), P9 = run.P[9], X9 = run.X[9];
  facts.p10_sd_pos = Math.sqrt(P9[0]); facts.p10_sd_vel = Math.sqrt(P9[3]); facts.p10_corr = P9[1] / Math.sqrt(P9[0] * P9[3]);
  let st = { x: Float64Array.from(X9), P: Float64Array.from(P9) }, worst = 0;
  for (let k = 1; k <= 60; k++) { st = CY.kf.predict(m, st); worst = Math.max(worst, Math.abs(st.P[0] - FCUT(P9, k))); if (k === 1 || k === 5 || k === 10 || k === 20 || k === 40) facts['blind_sd_' + k] = Math.sqrt(st.P[0]); }
  ok('blind growth: P_pp(k) = P_pp + 2 A_k P_pv + A_k^2 P_vv equals k repeated predict steps', worst < 1e-12, worst);
  facts.blind_cap = Math.sqrt(P9[0] + 2 * P9[1] / GAMMA + P9[3] / (GAMMA * GAMMA));
  ok('the growth is monotone and capped by the std of the stopping point p + v/gamma', facts.blind_sd_40 < facts.blind_cap && facts.blind_sd_20 < facts.blind_sd_40);
  facts.stop_sd_81 = Math.sqrt(FCUT(P9, 81));
  facts.A81 = A(81); facts.A_inf = 1 / GAMMA;
  // the gain at the first reading after a blind stretch of k steps and the update itself
  for (const k of [5, 20]) {
    let s2 = { x: Float64Array.from(X9), P: Float64Array.from(P9) }; for (let j = 0; j < k; j++) s2 = CY.kf.predict(m, s2);
    const up = CY.kf.update(m, s2, [s2.x[0]]), S = s2.P[0] + SO * SO;
    facts['gain_p_after' + k] = s2.P[0] / S; facts['gain_v_after' + k] = s2.P[1] / S; facts['sd_before_reread' + k] = Math.sqrt(s2.P[0]); facts['sd_after_reread' + k] = Math.sqrt(up.P[0]);
    ok('gain K = P_pp/S, P_pv/S and the posterior position variance P R/(P+R) at the first re-reading (k = ' + k + ')', close(up.P[0], s2.P[0] * SO * SO / S, 1e-12));
  }
}
{ // a position-only reading teaches velocity only through the predicted covariance: P_pv after one predict from an uncorrelated belief
  const P = [0.05 ** 2, 0, 0, 0.3 ** 2], FP = [1, G, 0, D]; // F P F'
  const a = FP[0] * P[0] + FP[1] * P[2], b = FP[0] * P[1] + FP[1] * P[3], c = FP[2] * P[0] + FP[3] * P[2], d = FP[2] * P[1] + FP[3] * P[3];
  const Pxv = a * FP[2] + b * FP[3];
  facts.pv_after_predict = Pxv; ok('an uncorrelated belief becomes correlated after one predict step: P_pv = g d P_vv > 0', close(Pxv, G * D * 0.09, 1e-15) && Pxv > 0);
  void c; void d;
}
{ // steady state with doubt q > 0: iterate the Riccati map written out for the 2 x 2 case; compare with the filter run for 600 steps
  for (const q of [0.05]) {
    let P = [1, 0, 0, 1];
    const R = SO * SO;
    for (let it = 0; it < 4000; it++) {                      // P+ -> predict -> update
      const a = P[0] + G * P[1] + G * P[2] + G * G * P[3], b = D * (P[1] + G * P[3]), c = D * (P[2] + G * P[3]), d = D * D * P[3] + q * q;      // predicted
      const S = a + R, k0 = a / S, k1 = c / S;
      P = [a - k0 * a, b - k0 * b, c - k1 * a, d - k1 * b];
    }
    // P is the posterior fixed point; the predicted covariance is F P F' + Q
    const a = P[0] + G * P[1] + G * P[2] + G * G * P[3], c = D * (P[2] + G * P[3]), S = a + R;
    const f = BL.filter(BL.model(false), R, q, [0, 1], [1, 1]); for (let t = 0; t < 600; t++) { BL.predict(f); BL.update(f, 0); }
    ok('steady-state gain of the filter == fixed point of the Riccati recursion', close(f.K[0], a / S, 1e-9) && close(f.K[1], c / S, 1e-9), [Array.from(f.K), a / S, c / S]);
    ok('...and the posterior covariance is that fixed point', close(f.P[0], P[0], 1e-10) && close(f.P[3], P[3], 1e-10));
    facts.kinf_p = a / S; facts.kinf_v = c / S; facts.pinf_sd_pos = Math.sqrt(P[0]); facts.pinf_sd_vel = Math.sqrt(P[3]);
    const f0 = BL.filter(BL.model(false), R, 0, [0, 1], [1, 1]); for (let t = 0; t < 600; t++) { BL.predict(f0); BL.update(f0, 0); }
    facts.gain_q0_after600 = f0.K[0]; ok('with q = 0 the gain decays to zero: the filter stops listening', f0.K[0] < 0.01, f0.K[0]);
  }
}
{ // slope of a least-squares line through m equally spaced noisy readings: sigma sqrt(12) / (dt sqrt(m (m^2 - 1)))
  const rr = CY.rng(31); const n = 200000;
  for (const m of [2, 10]) {
    const f = Math.sqrt(12) * SO / (DT * Math.sqrt(m * (m * m - 1)));
    let s2 = 0; for (let j = 0; j < n; j++) { let sx = 0, sy = 0, sxx = 0, sxy = 0; for (let t = 0; t < m; t++) { const x = t * DT, y = SO * CY.randn(rr); sx += x; sy += y; sxx += x * x; sxy += x * y; } const sl = (m * sxy - sx * sy) / (m * sxx - sx * sx); s2 += sl * sl; }
    ok('line-fit slope error formula vs Monte Carlo, m = ' + m, close(Math.sqrt(s2 / n), f, 0.003), [Math.sqrt(s2 / n), f]);
    facts['slope_sd_m' + m] = f;
  }
  facts.vel_err2 = Math.SQRT2 * SO / DT; facts.pos_err_from_vel = facts.vel_err2 / GAMMA;
}
{ // two balls on one spot with different velocities: identical readings, endings far apart
  const v1 = 1.0, v2 = 1.8, w = CY.world({ W: 1e3, H: 1e3, curtain: null }); let a = [500, 500, v1, 0], b = [500, 500, v2, 0];
  for (let t = 0; t < TF + 1; t++) { a = CY.step(w, a, null); b = CY.step(w, b, null); }
  facts.two_balls_gap = b[0] - a[0]; ok('two balls: gap = (v2 - v1) A_81', close(facts.two_balls_gap, (v2 - v1) * A(81), 1e-9));
  facts.two_balls_dv = v2 - v1; facts.two_balls_pos_gap_1step = (v2 - v1) * G;
}

/* ── 5. the planner and the ladder of summaries, replayed with the separate integrator ── */
const CANDS = []; for (let n = 0; n < NEP; n++) { const rc = CY.rng(1000 + n), c = []; for (let k = 0; k < KC; k++) { const an = 2 * Math.PI * rc(), am = AMAX * Math.sqrt(rc()); c.push([am * Math.cos(an), am * Math.sin(an)]); } CANDS.push(c); }
const outcomeI = (s, a, wind) => { let q = stepI(s, a, wind); for (let u = 0; u < TF; u++) q = stepI(q, null, wind); return q; };
const missI = f => Math.hypot(f[0] - GOAL.x, f[1] - GOAL.y);
const bestI = (bel, wind, n) => { let best = Infinity, bi = 0; for (let k = 0; k < KC; k++) { const m = missI(outcomeI(bel, CANDS[n][k], wind)); if (m < best) { best = m; bi = k; } } return { k: bi, miss: best }; };
const hitI = (truth, a, windReal) => missI(outcomeI(truth, a, windReal)) < GOAL.r;
function ls2(idx, zs) {                        // straight-line fit z = a + b t over the readings in idx (times idx*dt)
  let n = idx.length, st = 0, sz = 0, stt = 0, stz = 0; for (const u of idx) { const t = u * DT; st += t; sz += zs[u]; stt += t * t; stz += t * zs[u]; }
  const b = (n * stz - st * sz) / (n * stt - st * st); return { a: (sz - b * st) / n, b };
}
function lsFriction(idx, zs) {                 // the same, with the motion p_u = p0 + v0 A_u that friction actually produces
  let n = idx.length, sa = 0, sz = 0, saa = 0, saz = 0; for (const u of idx) { const a = A(u); sa += a; sz += zs[u]; saa += a * a; saz += a * zs[u]; }
  const v0 = (n * saz - sa * sz) / (n * saa - sa * sa); return { p0: (sz - v0 * sa) / n, v0 };
}
function summaries(zsXY, vis, t) {             // the hand-made states at step t
  const last = []; for (let u = t; u >= 0; u--) if (vis[u]) last.push(u);
  const two = last.slice(0, 2), ten = last.slice(0, 10), out = {};
  out.two = [0, 1].map(c => zsXY[c][two[0]]).concat([0, 1].map(c => (zsXY[c][two[0]] - zsXY[c][two[1]]) / ((two[0] - two[1]) * DT)));
  const L = [0, 1].map(c => ls2(ten, zsXY[c])); out.line = [L[0].a + L[0].b * t * DT, L[1].a + L[1].b * t * DT, L[0].b, L[1].b];
  const M10 = [0, 1].map(c => lsFriction(ten, zsXY[c])), MA = [0, 1].map(c => lsFriction(last, zsXY[c]));
  const st = (M, c) => [M[c].p0 + M[c].v0 * A(t), M[c].v0 * Math.pow(D, t)];
  out.fric10 = [st(M10, 0)[0], st(M10, 1)[0], st(M10, 0)[1], st(M10, 1)[1]];
  out.fricAll = [st(MA, 0)[0], st(MA, 1)[0], st(MA, 0)[1], st(MA, 1)[1]];
  return out;
}
const S_CLAIM = 48, CLAIM_SEED = 777;
function sampleBelief(mean, P, n, rng) {       // explicit Cholesky, same draw order as the engine: axis x then axis y, one normal per state component
  const out = [];
  for (let c = 0; c < 2; c++) {
    const p = P[c], L = Array.from({ length: n }, () => new Array(n).fill(0));
    for (let i = 0; i < n; i++) for (let j = 0; j <= i; j++) { let s = p[i * n + j]; for (let k = 0; k < j; k++) s -= L[i][k] * L[j][k]; L[i][j] = i === j ? Math.sqrt(Math.max(s, 1e-18)) : s / L[j][j]; }
    const e = []; for (let i = 0; i < n; i++) e.push(CY.randn(rng));
    out.push(mean[c].map((m, i) => { let v = m; for (let j = 0; j <= i; j++) v += L[i][j] * e[j]; return v; }));
  }
  return out;                                  // [[p, v, (w)] for x, [p, v, (w)] for y]
}
function planOne(n, set, ti, kk, t) {          // the belief-mean plan and the belief's claim for launch n at step t; real world = set.wind
  const windReal = set.wind ? WIND : NOWIND, truth = ti.tr[t], nn = kk.n;
  const mean = [0, 1].map(c => kk.ax[c].X[t]), P = [0, 1].map(c => kk.ax[c].P[t]);
  const belState = [mean[0][0], mean[1][0], mean[0][1], mean[1][1]], windEst = nn === 3 ? [mean[0][2], mean[1][2]] : NOWIND;
  const pk = bestI(belState, windEst, n), a = CANDS[n][pk.k], hit = hitI(truth, a, windReal);
  const rng = CY.rng(CLAIM_SEED + n); let c = 0;
  for (let q = 0; q < S_CLAIM; q++) { const sm = sampleBelief(mean, P, nn, rng), st = [sm[0][0], sm[1][0], sm[0][1], sm[1][1]], we = nn === 3 ? [sm[0][2], sm[1][2]] : NOWIND; if (missI(outcomeI(st, a, we)) < GOAL.r) c++; }
  return { hit, claim: c / S_CLAIM, k: pk.k, imag: pk.miss, real: missI(outcomeI(truth, a, windReal)) };
}
function planSet(set, N) {                     // everything the widget reports for the planner, for the first N launches of the pool
  const res = { true: 0, two: 0, mean: 0, claim: 0, line: 0, fric10: 0, fricAll: 0, hidden: 0, velErr: { two: 0, line: 0, fric10: 0, fricAll: 0, mean: 0 } };
  const windReal = set.wind ? WIND : NOWIND, rows = [];
  for (let n = 0; n < N; n++) {
    const ti = tiFor(n, set.width, set.wind), kk = trackKF(POOL[n], set, ti), truth = ti.tr[TA];
    if (!ti.vis[TA]) res.hidden++;
    const pt = bestI(truth, windReal, n); if (hitI(truth, CANDS[n][pt.k], windReal)) res.true++;
    const sm = summaries(kk.zs, ti.vis, TA);
    for (const key of ['two', 'line', 'fric10', 'fricAll']) {
      const pk = bestI(sm[key], NOWIND, n); if (hitI(truth, CANDS[n][pk.k], windReal)) res[key]++;
      res.velErr[key] += ((sm[key][2] - truth[2]) ** 2 + (sm[key][3] - truth[3]) ** 2) / N;
    }
    const pl = planOne(n, set, ti, kk, TA); if (pl.hit) res.mean++; res.claim += pl.claim;
    const bm = [kk.ax[0].X[TA][0], kk.ax[1].X[TA][0], kk.ax[0].X[TA][1], kk.ax[1].X[TA][1]];
    res.velErr.mean += ((bm[2] - truth[2]) ** 2 + (bm[3] - truth[3]) ** 2) / N;
    rows.push({ hit: pl.hit, claim: pl.claim, hidden: !ti.vis[TA], real: pl.real, imag: pl.imag });
  }
  for (const k of ['true', 'two', 'mean', 'claim', 'line', 'fric10', 'fricAll', 'hidden']) res[k] /= N;
  for (const k in res.velErr) res.velErr[k] = Math.sqrt(res.velErr[k]);
  res.rows = rows; return res;
}
const PS = planSet(BASE, NP);
facts.hidden_pct = 100 * PS.hidden;
facts.pl_true = 100 * PS.true; facts.pl_two = 100 * PS.two; facts.pl_line = 100 * PS.line; facts.pl_fric10 = 100 * PS.fric10; facts.pl_fricAll = 100 * PS.fricAll; facts.pl_mean = 100 * PS.mean; facts.pl_claim = 100 * PS.claim;
facts.ve_two = PS.velErr.two; facts.ve_line = PS.velErr.line; facts.ve_fric10 = PS.velErr.fric10; facts.ve_fricAll = PS.velErr.fricAll; facts.ve_mean = PS.velErr.mean;
ok('the ladder is ordered: two readings < line < friction fit (10) < all readings <= belief', PS.two < PS.line + 0.05 && PS.line < PS.fric10 && PS.fric10 < PS.mean && PS.fricAll <= PS.mean + 0.03, [PS.two, PS.line, PS.fric10, PS.fricAll, PS.mean]);
ok('velocity error of the two-reading state matches sqrt(2) * sqrt(2) sigma / dt (vector norm)', close(facts.ve_two / (2 * SO / DT), 1, 0.15), [facts.ve_two, 2 * SO / DT]);
ok('belief velocity error is far below the line and two-reading states', facts.ve_mean < 0.3 * facts.ve_line && facts.ve_line < facts.ve_two);
ok('planner from the true state succeeds on almost every launch', PS.true > 0.93, PS.true);
ok('planner from the last two readings almost never succeeds', PS.two < 0.06, PS.two);
{ // the line fit's bias comes from friction: slope of a line through a decaying velocity is the velocity at the window middle
  const bias = Math.exp(GAMMA * 0.45) - 1; facts.line_bias_frac = 100 * bias; facts.line_bias_ms = bias * 1.8;
}
facts.imag_mean = PS.rows.reduce((a, r) => a + r.imag, 0) / PS.rows.length;
ok('belief-mean planner recovers most of the performance', PS.mean > 0.65 && PS.mean < 0.92, PS.mean);
ok('what the belief claims is within 8 points of what it achieves (120 launches)', Math.abs(PS.claim - PS.mean) < 0.08, [PS.claim, PS.mean]);


/* ── 6. calibration, growth behind the curtain, mismatched noise, wind: the same statistics with the engine's matrix filter ── */
const CHI2 = -2 * Math.log(0.05);
function statsI(set, tmax) {
  tmax = tmax === undefined ? T : tmax;
  let nEp = 0, nisS = 0, nisN = 0, covS = 0, covN = 0, eS = 0, cS = 0, bN = 0, exS = 0, afS = 0, exN = 0, wsT = 0, wsA = 0, weA = 0;
  for (let i = 0; i < NEP; i++) {
    const ti = tiFor(i, set.width, set.wind); if (!ti.free) continue;
    const kk = trackKF(POOL[i], set, ti); nEp++;
    let tIn = -1, tOut = -1;
    for (let t = 0; t <= tmax; t++) {
      const ex = kk.ax[0].X[t][0] - ti.tr[t][0], ey = kk.ax[1].X[t][0] - ti.tr[t][1], px = kk.ax[0].P[t][0], py = kk.ax[1].P[t][0];
      covN++; if (ex * ex / px + ey * ey / py <= CHI2) covS++;
      if (ti.vis[t]) { nisS += 0.5 * (kk.ax[0].nu[t] ** 2 / kk.ax[0].S[t] + kk.ax[1].nu[t] ** 2 / kk.ax[1].S[t]); nisN++; if (tIn >= 0 && tOut < 0) tOut = t; }
      else { bN++; eS += 0.5 * (ex * ex + ey * ey); cS += 0.5 * (px + py); if (tIn < 0) tIn = t; }
    }
    if (tOut > 0) { exS += Math.sqrt(0.5 * (kk.ax[0].P[tOut - 1][0] + kk.ax[1].P[tOut - 1][0])); afS += Math.sqrt(0.5 * (kk.ax[0].P[tOut][0] + kk.ax[1].P[tOut][0])); exN++; }
    if (kk.n === 3) { wsT += Math.sqrt(kk.ax[0].P[tmax][8]) / 1; wsA += Math.sqrt(kk.ax[0].P[TA][8]); weA += kk.ax[0].X[tmax][2]; }
  }
  return { nEp, nis: nisS / nisN, cov: covS / covN, blindErr: bN ? Math.sqrt(eS / bN) : NaN, blindClaim: bN ? Math.sqrt(cS / bN) : NaN, exitStd: exN ? exS / exN : NaN, afterStd: exN ? afS / exN : NaN, nExit: exN, windSdEnd: wsT / nEp, windSdTA: wsA / nEp, windEstEnd: weA / nEp };
}
const SETS = {
  hon: BASE, w2: { ...BASE, width: 2 }, w3: { ...BASE, width: 3 }, w0: { ...BASE, width: 0 }, rq: { ...BASE, rmult: 0.25 }, r4: { ...BASE, rmult: 4 }, dq: { ...BASE, q: 0.05 },
  wp: { ...BASE, wind: 1 }, wa: { ...BASE, wind: 1, aware: 1 }, wd: { ...BASE, wind: 1, q: 0.05 }, an: { ...BASE, aware: 1 },
};
const ST = {};
for (const k in SETS) {
  const a = statsI(SETS[k]), e = BL.stats(pool240(SETS[k]));
  ST[k] = a;
  ok('engine statistics == independent statistics, setting ' + k, close(a.nis, e.nis, 1e-9) && close(a.cov, e.cov, 1e-12) && a.nEp === e.nEp && (isNaN(a.exitStd) ? isNaN(e.exitStd) : close(a.exitStd, e.exitStd, 1e-9) && close(a.afterStd, e.afterStd, 1e-9) && close(a.blindErr, e.blindErr, 1e-9) && close(a.blindClaim, e.blindClaim, 1e-9)), [a, e]);
  facts[k + '_nis'] = a.nis; facts[k + '_cov'] = 100 * a.cov; facts[k + '_n'] = a.nEp; facts[k + '_berr'] = a.blindErr; facts[k + '_bcl'] = a.blindClaim; facts[k + '_exit'] = a.exitStd; facts[k + '_after'] = a.afterStd; facts[k + '_nexit'] = a.nExit;
}
function pool240(set) { const w = BL.world(set.width, set.wind); return POOL.map(ep => BL.track(ep, set, w)); }
{ const f = ST.wa; facts.wa_wsd_ta = f.windSdTA; facts.wa_wsd_end = f.windSdEnd; facts.wa_west_end = f.windEstEnd; }
{ const a = statsI(SETS.wp, TA); facts.wp_nis_t12 = a.nis; facts.wp_cov_t12 = 100 * a.cov; const b = statsI(SETS.wp, 20); facts.wp_nis_t20 = b.nis; const c = statsI(SETS.wp, 30); facts.wp_nis_t30 = c.nis; facts.wp_cov_t30 = 100 * c.cov; }
ok('honest filter: mean NIS within 5 % of 1 and 95 % coverage within 3 points (240 launches)', close(ST.hon.nis, 1, 0.05) && close(100 * ST.hon.cov, 95, 3), [ST.hon.nis, ST.hon.cov]);
ok('a filter that believes the sensor is better than it is is overconfident (NIS > 1, coverage < 95 %)', ST.rq.nis > 2 && ST.rq.cov < 0.8, [ST.rq.nis, ST.rq.cov]);
ok('a filter that believes the sensor is worse than it is is underconfident (NIS < 1, coverage > 95 %)', ST.r4.nis < 0.5 && ST.r4.cov > 0.97, [ST.r4.nis, ST.r4.cov]);
ok('the error behind the curtain is the same whatever the filter claims about itself (rq, hon, r4 within 25 %)', ST.rq.blindErr < 1.25 * ST.hon.blindErr && ST.r4.blindErr < 1.25 * ST.hon.blindErr, [ST.rq.blindErr, ST.hon.blindErr, ST.r4.blindErr]);
ok('behind the curtain the claimed std equals the realised error (honest filter, within 10 %)', close(ST.hon.blindClaim / ST.hon.blindErr, 1, 0.1), [ST.hon.blindClaim, ST.hon.blindErr]);
ok('a wider curtain: the std at the exit grows, the snap back is larger', ST.w2.exitStd > ST.hon.exitStd && ST.w2.exitStd - ST.w2.afterStd > ST.hon.exitStd - ST.hon.afterStd, [ST.hon.exitStd, ST.w2.exitStd]);
ok('a reading always lowers the std (after < exit)', ST.hon.afterStd < ST.hon.exitStd && ST.w2.afterStd < ST.w2.exitStd);
ok('hidden wind, filter unaware: NIS far above 1 and coverage collapses over a 4 s track', ST.wp.nis > 1.5 && ST.wp.cov < 0.7, [ST.wp.nis, ST.wp.cov]);
ok('... but during the first 1.2 s (the time of the nudge) the wind is invisible to the NIS', close(facts.wp_nis_t12, 1, 0.08), facts.wp_nis_t12);
ok('wind state in the filter restores NIS and coverage', close(ST.wa.nis, 1, 0.1) && ST.wa.cov > 0.92, [ST.wa.nis, ST.wa.cov]);
ok('doubt (q = 0.05) also restores them in the windy world, by widening every band', close(ST.wd.nis, 1, 0.1) && ST.wd.cov > 0.92 && ST.wd.blindClaim > ST.wp.blindClaim, [ST.wd.nis, ST.wd.cov, ST.wd.blindClaim, ST.wp.blindClaim]);
ok('doubt in a windless world is underconfident', ST.dq.nis < ST.hon.nis && ST.dq.cov > ST.hon.cov, [ST.dq.nis, ST.dq.cov]);
{ // why the wind is invisible to the NIS in the first 1.2 s: the push is smaller than the sensor's error, not merely absorbed by the velocity state (with the velocity known exactly the NIS is still about 1)
  let s = 0, n = 0;
  for (let i = 0; i < NEP; i++) {
    const ti = tiFor(i, 0.8, 1); if (!ti.free) continue;
    for (let c = 0; c < 2; c++) {
      const zs = ti.tr.map((st, t) => st[c] + SO * POOL[i].z[t][c]), run = kfRun(kfModel(2, 0, SO * SO), [PRIOR[c].mu[0], ti.tr[0][2 + c]], [PRIOR[c].sd[0], 0.01], zs, ti.vis, TA);
      for (let t = 0; t <= TA; t++) if (ti.vis[t]) { s += run.nu[t] ** 2 / run.S[t]; n++; }
    }
  }
  facts.wp_nis_t12_vknown = s / n; facts.wind_push_last_reading = 0.5 * 0.2 * 0.9 * 0.9;
  ok('the wind is invisible to the NIS in the first 1.2 s even when the velocity is known exactly', facts.wp_nis_t12_vknown < 1.15, facts.wp_nis_t12_vknown);
  ok('... because by the last reading before the curtain (0.9 s) it has moved the ball by less than the sensor error', facts.wind_push_last_reading < SO, facts.wind_push_last_reading);
}

{ // honest filter on episodes drawn from its OWN Gaussian prior: must be exactly calibrated (N = 3000)
  const rng = CY.rng(11), N = 3000, mod = kfModel(2, 0, SO * SO);
  let nis = 0, nn = 0, cov = 0, cn = 0;
  for (let i = 0; i < N; i++) {
    const s = [0, 1].map(c => [PRIOR[c].mu[0] + PRIOR[c].sd[0] * CY.randn(rng), PRIOR[c].mu[1] + PRIOR[c].sd[1] * CY.randn(rng)]);
    const tr = []; let st = [s[0][0], s[1][0], s[0][1], s[1][1]];
    for (let t = 0; t <= T; t++) { tr.push(st.slice()); st = [st[0] + G * st[2], st[1] + G * st[3], D * st[2], D * st[3]]; }
    const vis = tr.map(() => true), ax = [0, 1].map(c => kfRun(mod, PRIOR[c].mu, PRIOR[c].sd, tr.map(x => x[c] + SO * CY.randn(rng)), vis, T));
    for (let t = 0; t <= T; t++) {
      nis += 0.5 * (ax[0].nu[t] ** 2 / ax[0].S[t] + ax[1].nu[t] ** 2 / ax[1].S[t]); nn++;
      const ex = ax[0].X[t][0] - tr[t][0], ey = ax[1].X[t][0] - tr[t][1]; cov += (ex * ex / ax[0].P[t][0] + ey * ey / ax[1].P[t][0] <= CHI2) ? 1 : 0; cn++;
    }
  }
  facts.gauss_nis = nis / nn; facts.gauss_cov = 100 * cov / cn;
  ok('episodes drawn from the filter\'s own prior: mean NIS = 1 (3000 episodes)', close(facts.gauss_nis, 1, 0.01), facts.gauss_nis);
  ok('... and the 95 % ellipse holds the truth 95 % of the time', close(facts.gauss_cov, 95, 0.6), facts.gauss_cov);
}
{ // the launcher's episodes, a much larger sample (1500 launches, other seed)
  const BIG = makePool(1500, 91); let nis = 0, nn = 0, cov = 0, cn = 0, kept = 0; const wc = worldOf(0.8, 0), mod = kfModel(2, 0, SO * SO);
  for (const ep of BIG) {
    const ti = trackI(ep, wc); if (!ti.free) continue; kept++;
    const ax = [0, 1].map(c => kfRun(mod, PRIOR[c].mu, PRIOR[c].sd, ti.tr.map((s, t) => s[c] + SO * ep.z[t][c]), ti.vis, T));
    for (let t = 0; t <= T; t++) {
      if (ti.vis[t]) { nis += 0.5 * (ax[0].nu[t] ** 2 / ax[0].S[t] + ax[1].nu[t] ** 2 / ax[1].S[t]); nn++; }
      const ex = ax[0].X[t][0] - ti.tr[t][0], ey = ax[1].X[t][0] - ti.tr[t][1]; cov += (ex * ex / ax[0].P[t][0] + ey * ey / ax[1].P[t][0] <= CHI2) ? 1 : 0; cn++;
    }
  }
  facts.big_nis = nis / nn; facts.big_cov = 100 * cov / cn; facts.big_n = kept;
  ok('launcher episodes, large sample: NIS within 6 % of 1 and coverage within 2 points of 95', close(facts.big_nis, 1, 0.06) && close(facts.big_cov, 95, 2), [facts.big_nis, facts.big_cov]);
}

/* ── 7. the planner at scale, the ceiling, and the other uses of the belief ── */
const candsFor = n => n < NEP ? CANDS[n] : (() => { const rc = CY.rng(1000 + n), c = []; for (let k = 0; k < KC; k++) { const an = 2 * Math.PI * rc(), am = AMAX * Math.sqrt(rc()); c.push([am * Math.cos(an), am * Math.sin(an)]); } return c; })();
const bestIc = (bel, wind, cands) => { let best = Infinity, bi = 0; for (let k = 0; k < cands.length; k++) { const m = missI(outcomeI(bel, cands[k], wind)); if (m < best) { best = m; bi = k; } } return { k: bi, miss: best }; };
function discProb(sx, sy, r) {                 // P(|(X, Y)| < r) for independent zero-mean Gaussians, midpoint rule in polar coordinates
  let p = 0; const nr = 200, na = 90;
  for (let i = 0; i < nr; i++) { const rr = (i + 0.5) * r / nr; for (let j = 0; j < na; j++) { const th = (j + 0.5) * 2 * Math.PI / na; p += Math.exp(-0.5 * (rr * Math.cos(th) / sx) ** 2 - 0.5 * (rr * Math.sin(th) / sy) ** 2) * rr * (r / nr) * (2 * Math.PI / na); } }
  return p / (2 * Math.PI * sx * sy);
}
{ // large sample of nudge planning: belief mean, claim, true state, last two readings (600 launches from another seed)
  const NB = 600, BIG = makePool(NB, 92), wc = worldOf(0.8, 0), mod = kfModel(2, 0, SO * SO); let hm = 0, cl = 0, ht = 0, h2 = 0, ceil = 0, nceil = 0;
  for (let n = 0; n < NB; n++) {
    const ep = BIG[n], ti = trackI(ep, wc), cands = candsFor(1000 + n); // other candidate seeds: n + 1000
    const ax = [0, 1].map(c => kfRun(mod, PRIOR[c].mu, PRIOR[c].sd, ti.tr.map((s, t) => s[c] + SO * ep.z[t][c]), ti.vis, TA)), kk = { ax, n: 2 };
    const truth = ti.tr[TA], mean = [0, 1].map(c => ax[c].X[TA]), P = [0, 1].map(c => ax[c].P[TA]);
    const bel = [mean[0][0], mean[1][0], mean[0][1], mean[1][1]], pk = bestIc(bel, NOWIND, cands), a = cands[pk.k];
    if (hitI(truth, a, NOWIND)) hm++;
    const rng = CY.rng(CLAIM_SEED + n); let c = 0; for (let q = 0; q < S_CLAIM; q++) { const sm = sampleBelief(mean, P, 2, rng); if (missI(outcomeI([sm[0][0], sm[1][0], sm[0][1], sm[1][1]], a, NOWIND)) < GOAL.r) c++; } cl += c / S_CLAIM;
    const pt = bestIc(truth, NOWIND, cands); if (hitI(truth, cands[pt.k], NOWIND)) ht++;
    const sm2 = summaries([0, 1].map(cc => ti.tr.map((s, t) => s[cc] + SO * ep.z[t][cc])), ti.vis, TA), p2 = bestIc(sm2.two, NOWIND, cands); if (hitI(truth, cands[p2.k], NOWIND)) h2++;
    if (n < 240) { ceil += discProb(Math.sqrt(FCUT(P[0], 81)), Math.sqrt(FCUT(P[1], 81)), GOAL.r); nceil++; }
  }
  facts.big_pl_mean = 100 * hm / NB; facts.big_pl_claim = 100 * cl / NB; facts.big_pl_true = 100 * ht / NB; facts.big_pl_two = 100 * h2 / NB; facts.ceiling = 100 * ceil / nceil;
  ok('large sample: what the belief claims is within 4 points of what it achieves', Math.abs(facts.big_pl_claim - facts.big_pl_mean) < 4, [facts.big_pl_claim, facts.big_pl_mean]);
  ok('the achieved rate is below the information ceiling (a centred cloud on the goal)', facts.big_pl_mean < facts.ceiling + 2, [facts.big_pl_mean, facts.ceiling]);
}
{ // the stopping-point std from the belief at the nudge time on the widget's launches, and the ceiling formula 1 - exp(-r^2 / 2 sigma^2)
  let s2 = 0, c2 = 0; const N = NP;
  for (let n = 0; n < N; n++) { const ti = tiFor(n, 0.8, 0), kk = trackKF(POOL[n], BASE, ti), sx = FCUT(kk.ax[0].P[TA], 81), sy = FCUT(kk.ax[1].P[TA], 81); s2 += 0.5 * (sx + sy) / N; c2 += discProb(Math.sqrt(sx), Math.sqrt(sy), GOAL.r) / N; }
  facts.end_sd = Math.sqrt(s2); facts.ceiling_formula = 100 * (1 - Math.exp(-GOAL.r * GOAL.r / (2 * s2))); facts.ceiling_120 = 100 * c2; facts.ceiling_se = 100 * Math.sqrt(c2 * (1 - c2) / N);   // standard error of a success rate measured on N launches
  ok('1 - exp(-r^2 / 2 sigma^2) with the mean stopping-point variance is within 3 points of the exact disc probability', close(facts.ceiling_formula, facts.ceiling_120, 3), [facts.ceiling_formula, facts.ceiling_120]);
}
{ // choosing by expected success under the belief instead of by the mean's miss (S = 16 states, 120 launches)
  const S3 = 16; let h3 = 0;
  for (let n = 0; n < NP; n++) {
    const ti = tiFor(n, 0.8, 0), kk = trackKF(POOL[n], BASE, ti), mean = [0, 1].map(c => kk.ax[c].X[TA]), P = [0, 1].map(c => kk.ax[c].P[TA]), rng = CY.rng(900 + n), smp = [];
    for (let q = 0; q < S3; q++) { const sm = sampleBelief(mean, P, 2, rng); smp.push([sm[0][0], sm[1][0], sm[0][1], sm[1][1]]); }
    let bestC = -1, bk = 0; for (let k = 0; k < KC; k++) { let c = 0; for (const st of smp) if (missI(outcomeI(st, CANDS[n][k], NOWIND)) < GOAL.r) c++; if (c > bestC) { bestC = c; bk = k; } }
    if (hitI(ti.tr[TA], CANDS[n][bk], NOWIND)) h3++;
  }
  facts.pl_p3 = 100 * h3 / NP;
  ok('choosing the nudge by its success under the belief does not beat aiming the mean here (within 6 points)', Math.abs(facts.pl_p3 - facts.pl_mean) < 6, [facts.pl_p3, facts.pl_mean]);
}
{ // 512 candidates instead of 128: the belief planner reaches the information limit
  const cK = (n, K) => { const rc = CY.rng(1000 + n), c = []; for (let k = 0; k < K; k++) { const an = 2 * Math.PI * rc(), am = AMAX * Math.sqrt(rc()); c.push([am * Math.cos(an), am * Math.sin(an)]); } return c; };
  let h = 0, h128 = 0;
  for (let n = 0; n < NP; n++) {
    const ti = tiFor(n, 0.8, 0), kk = trackKF(POOL[n], BASE, ti), bel = [kk.ax[0].X[TA][0], kk.ax[1].X[TA][0], kk.ax[0].X[TA][1], kk.ax[1].X[TA][1]], c512 = cK(n, 512);
    const pk = bestIc(bel, NOWIND, c512); if (hitI(ti.tr[TA], c512[pk.k], NOWIND)) h++;
    ok('the first 128 of the 512 candidates are the 128 candidates', c512[127][0] === CANDS[n][127][0] && c512[127][1] === CANDS[n][127][1]);
  }
  facts.pl_k512 = 100 * h / NP;
  ok('with 512 candidates the belief planner is within 5 points of the information ceiling', Math.abs(facts.pl_k512 - facts.ceiling_120) < 5, [facts.pl_k512, facts.ceiling_120]);
  ok('... and within the sampling error (one standard error of a 120-launch rate) of it, so the prose may say "at that limit"', Math.abs(facts.pl_k512 - facts.ceiling_120) < facts.ceiling_se, [facts.pl_k512, facts.ceiling_120, facts.ceiling_se]);
}
{ // the cloud of endings has nearly the same size for every nudge that ends near the goal (so aiming the mean and centring the cloud coincide)
  let tot = 0, cnt = 0, worst = 0;
  for (let n = 0; n < 40; n++) {
    const ti = tiFor(n, 0.8, 0), kk = trackKF(POOL[n], BASE, ti), mean = [0, 1].map(c => kk.ax[c].X[TA]), P = [0, 1].map(c => kk.ax[c].P[TA]), rng = CY.rng(5 + n), smp = [];
    for (let q = 0; q < 16; q++) { const sm = sampleBelief(mean, P, 2, rng); smp.push([sm[0][0], sm[1][0], sm[0][1], sm[1][1]]); }
    const bel = [mean[0][0], mean[1][0], mean[0][1], mean[1][1]], sds = [];
    for (let k = 0; k < KC; k++) {
      const m0 = outcomeI(bel, CANDS[n][k], NOWIND); if (missI(m0) > 0.6) continue;
      const ends = smp.map(st => outcomeI(st, CANDS[n][k], NOWIND)), mx = ends.reduce((a, e) => a + e[0], 0) / 16, my = ends.reduce((a, e) => a + e[1], 0) / 16;
      sds.push(Math.sqrt(ends.reduce((a, e) => a + ((e[0] - mx) ** 2 + (e[1] - my) ** 2) / 2, 0) / 16));
    }
    if (sds.length >= 2) { const r = Math.max(...sds) / Math.min(...sds) - 1; tot += r; cnt++; worst = Math.max(worst, r); }
  }
  facts.cloud_var_pct = 100 * tot / cnt; facts.cloud_var_worst_pct = 100 * worst;
  ok('the size of the cloud of endings differs by under 15 % on average between candidates that end near the goal', facts.cloud_var_pct < 15, facts.cloud_var_pct);
}
{ // the push of a 0.2 m/s^2 wind over the 8.1 s after the nudge, from rest
  const wf = CY.world({ W: 1e3, H: 1e3, curtain: null, wind: WIND }); let s0 = [500, 500, 0, 0]; for (let t = 0; t <= TF; t++) s0 = CY.step(wf, s0, null);
  facts.wind_push = 500 - s0[0];
  ok('wind push over 8.1 s agrees with (w/gamma)(T - A_81) to 3 %', close(facts.wind_push / ((0.2 / GAMMA) * ((TF + 1) * DT - A(TF + 1))), 1, 0.03), facts.wind_push);
}
// wind: planners
{
  const light = k => { const set = SETS[k], res = { mean: 0, claim: 0, true: 0, two: 0 }, windReal = set.wind ? WIND : NOWIND;
    for (let n = 0; n < NP; n++) {
      const ti = tiFor(n, set.width, set.wind), kk = trackKF(POOL[n], set, ti), truth = ti.tr[TA];
      const pl = planOne(n, set, ti, kk, TA); if (pl.hit) res.mean++; res.claim += pl.claim;
      const pt = bestI(truth, windReal, n); if (hitI(truth, CANDS[n][pt.k], windReal)) res.true++;
      const sm = summaries(kk.zs, ti.vis, TA), p2 = bestI(sm.two, NOWIND, n); if (hitI(truth, CANDS[n][p2.k], windReal)) res.two++;
    }
    for (const q in res) res[q] = 100 * res[q] / NP; return res; };
  for (const k of ['w2', 'w3', 'w0', 'rq', 'r4', 'dq', 'wp', 'wa', 'wd', 'an']) { const r = light(k); facts[k + '_pm'] = r.mean; facts[k + '_pc'] = r.claim; facts[k + '_pt'] = r.true; facts[k + '_p2'] = r.two; }
  facts.hon_pm = facts.pl_mean; facts.hon_pc = facts.pl_claim; facts.hon_pt = facts.pl_true; facts.hon_p2 = facts.pl_two;
  ok('wind, filter unaware: the planner is confidently wrong (claims far more than it achieves)', facts.wp_pc > 50 && facts.wp_pm < 15, [facts.wp_pc, facts.wp_pm]);
  ok('wind state: the belief knows it does not know (claim about equal to achieved, both low)', facts.wa_pc < 15 && facts.wa_pm < 20 && Math.abs(facts.wa_pc - facts.wa_pm) < 10, [facts.wa_pc, facts.wa_pm]);
  ok('doubt does not repair the future: still claims much more than it achieves', facts.wd_pc > 25 && facts.wd_pm < 15, [facts.wd_pc, facts.wd_pm]);
  ok('mismatched sensor noise: claims differ in the predicted direction (overconfident for R/4, underconfident for 4R)', facts.rq_pc > facts.rq_pm + 5 && facts.r4_pc < facts.r4_pm - 5, [facts.rq_pc, facts.rq_pm, facts.r4_pc, facts.r4_pm]);
  ok('an oracle planner that knows the wind still does well', facts.wp_pt > 75, facts.wp_pt);
  ok('with no curtain the belief planner does at least as well as with the default curtain', facts.w0_pm >= facts.pl_mean - 1, [facts.w0_pm, facts.pl_mean]);
}

/* ── 8. the roads and the exit: counts ── */
facts.grid_cells = (AW / 0.05) * (AH / 0.05) * (6 / 0.05) * (6 / 0.05);
facts.grid_gb = facts.grid_cells * 8 / 1e9;
facts.grid_axis_cells = (AW / 0.05) * (6 / 0.05) + (AH / 0.05) * (6 / 0.05);
facts.belief_numbers = 4 + 6; facts.belief_numbers_full = 4 + 10;
{ // a bootstrap particle filter after the first reading: the share of the particles that still count (effective sample size / N), averaged over launches
  const rng = CY.rng(5), N = 4000, reps = 150; let acc = 0;
  for (let r = 0; r < reps; r++) {
    const tx = PRIOR[0].mu[0] + PRIOR[0].sd[0] * CY.randn(rng), ty = PRIOR[1].mu[0] + PRIOR[1].sd[0] * CY.randn(rng), zx = tx + SO * CY.randn(rng), zy = ty + SO * CY.randn(rng); let sw = 0, sw2 = 0;
    for (let i = 0; i < N; i++) { const x0 = PRIOR[0].mu[0] + PRIOR[0].sd[0] * CY.randn(rng), y0 = PRIOR[1].mu[0] + PRIOR[1].sd[0] * CY.randn(rng), wgt = Math.exp(-0.5 * ((zx - x0) / SO) ** 2 - 0.5 * ((zy - y0) / SO) ** 2); sw += wgt; sw2 += wgt * wgt; }
    acc += sw * sw / sw2 / N / reps;
  }
  facts.pf_ess_pct = 100 * acc;
}
{ // the camera: 24 x 15 numbers, the ball changes only a few of them
  const img = CY.img.render(W0, [1.5, 2.5, 0, 0]), img0 = CY.img.render(W0, [1.5, 2.5, 0, 0], { ball: 0 }); let cnt = 0, tot = 0;
  for (let i = 0; i < img.length; i++) { tot++; if (Math.abs(img[i] - img0[i]) > 0.05) cnt++; }
  facts.pix_total = img.length; facts.pix_ball = cnt;
  { // the blob's peak and width, measured from the picture: a ball at the centre of pixel (16, 7) and its neighbour one pixel to the right (the goal disc and curtain cancel in the difference)
    const s = [(16 + 0.5) / 3, 5 - (7 + 0.5) / 3, 0, 0], a = CY.img.render(W0, s), b = CY.img.render(W0, s, { ball: 0 }), d0 = a[7 * 24 + 16] - b[7 * 24 + 16], d1 = a[7 * 24 + 17] - b[7 * 24 + 17];
    facts.pix_peak = d0; facts.pix_sigma = Math.sqrt(-1 / (2 * Math.log(d1 / d0)));
    ok('the ball in the picture is a Gaussian blob of peak 0.8 and width sigma = 0.8 pixel', close(d0, 0.8, 1e-6) && close(facts.pix_sigma, 0.8, 1e-4), [d0, facts.pix_sigma]);
  }
  let c2 = 0, n2 = 0; const rr = CY.rng(3); for (let j = 0; j < 400; j++) { const s = [0.6 + 1.9 * rr(), 0.4 + 4.2 * rr(), 0, 0], a = CY.img.render(W0, s), b = CY.img.render(W0, s, { ball: 0 }); let c = 0; for (let i = 0; i < a.length; i++) if (Math.abs(a[i] - b[i]) > 0.05) c++; c2 += c; n2++; }
  facts.pix_ball_mean = c2 / n2;
  ok('the ball changes only a few of the 360 pixels', facts.pix_ball_mean < 20 && facts.pix_total === 360, [facts.pix_ball_mean, facts.pix_total]);
  // the pixel map is not linear in the ball's position: two positions one pixel apart, the midpoint is not the average of the images
  const a = CY.img.render(W0, [1.5, 2.5, 0, 0]), b = CY.img.render(W0, [1.5 + 1 / 3, 2.5, 0, 0]), m = CY.img.render(W0, [1.5 + 1 / 6, 2.5, 0, 0]); let dev = 0, nrm = 0;
  for (let i = 0; i < a.length; i++) { dev += (m[i] - 0.5 * (a[i] + b[i])) ** 2; nrm += (b[i] - a[i]) ** 2; }
  facts.pix_nonlin = Math.sqrt(dev / nrm); ok('the picture is not a linear function of position (midpoint image != average of the two images)', facts.pix_nonlin > 0.05, facts.pix_nonlin);
}
{ // the checkpoint: fuse a belief N(2.00, 0.20^2) with a reading 2.15 of noise 0.1, then with a wrongly assumed noise 0.3
  const mu = 2.0, P = 0.04, z = 2.15;
  const fuse = R => { const K = P / (P + R); return { K, mean: mu + K * (z - mu), sd: Math.sqrt(P * (1 - K)) }; };
  const a = fuse(0.01), b = fuse(0.09);
  facts.ck_K = a.K; facts.ck_mean = a.mean; facts.ck_sd = a.sd; facts.ck_Kb = b.K; facts.ck_meanb = b.mean; facts.ck_sdb = b.sd; facts.ck_nis = (P + 0.01) / (P + 0.09);
  // check by simulation: mean of nu^2 / S under the wrong assumption
  const rr = CY.rng(8); let s2 = 0; const n = 400000; for (let i = 0; i < n; i++) { const x = Math.sqrt(P) * CY.randn(rr), zz = x + 0.1 * CY.randn(rr); s2 += zz * zz / (P + 0.09); }
  ok('checkpoint: mean NIS of a filter that assumes sensor noise 0.3 m when it is 0.1 m is S_true / S_assumed', close(s2 / n, facts.ck_nis, 0.01), [s2 / n, facts.ck_nis]);
}
facts.lag_bias_pct = 100 * (Math.exp(GAMMA * 0.45) - 1);
{ // a straight line through ten noiseless readings of the decaying ball: its slope is the velocity in the middle of the window, and the ball was (exp(gamma 0.45) - 1) = 17 % faster than at the last reading
  const v0 = 2.2, ts = [], zs = []; for (let k = 0; k < 10; k++) { ts.push(k * DT); zs.push(v0 * A(k)); }
  const n = 10, st = ts.reduce((a, b) => a + b, 0), sz = zs.reduce((a, b) => a + b, 0), stt = ts.reduce((a, b) => a + b * b, 0), stz = ts.reduce((a, b, i) => a + b * zs[i], 0), slope = (n * stz - st * sz) / (n * stt - st * st);
  const vEnd = v0 * Math.pow(D, 9), vMid = v0 * Math.exp(-GAMMA * 0.45);
  ok('the slope of a line through ten noiseless readings is the velocity at the middle of the window (1 %)', Math.abs(slope / vMid - 1) < 0.01, [slope, vMid]);
  ok('... which is the quoted fraction faster than the ball at the last reading (within 1 point)', Math.abs(100 * (slope / vEnd - 1) - facts.lag_bias_pct) < 1, [100 * (slope / vEnd - 1), facts.lag_bias_pct]);
}

/* ── 9. the page's own widget, driven into each state the prose describes: what it prints must equal the independent numbers above ── */
const PAGE = path.join(DIR, '02_partial_observability_beliefs.html'), HAVE_PAGE = fs.existsSync(PAGE);
ok('the lesson page exists', HAVE_PAGE);
const page = HAVE_PAGE ? loadPage(PAGE, { dpr: 1 }) : { problems: [], set() { return this; }, num() { return NaN; }, text() { return ''; }, el() { return { style: {} }; } };
ok('page loads cleanly', page.problems.length === 0, page.problems.join(' | '));
if (HAVE_PAGE) {
  const num = id => page.num('w02-' + id), txt = id => page.text('w02-' + id);
  // [setting, curtain width, the sensor noise the filter believes (as a multiple of the real variance), the filter's doubt q, wind]
  const DRIVE = [['hon', 0.8, 1, 0, 'off'], ['w2', 2, 1, 0, 'off'], ['w3', 3, 1, 0, 'off'], ['w0', 0, 1, 0, 'off'], ['rq', 0.8, 0.25, 0, 'off'], ['r4', 0.8, 4, 0, 'off'],
                 ['dq', 0.8, 1, 0.05, 'off'], ['wp', 0.8, 1, 0, 'plain'], ['wa', 0.8, 1, 0, 'aware'], ['wd', 0.8, 1, 0.05, 'plain']];
  const LAUNCH = 16;                                          // the widget's default launch
  const near = (what, got, want, tol) => ok('widget readout ' + what, Math.abs(got - want) <= tol, [got, want]);
  for (const [k, width, rm, q, wind] of DRIVE) {
    page.set('w02-w', width); page.set('w02-r', rm); page.set('w02-q', q); page.set('w02-wind', wind); page.set('w02-ep', LAUNCH);
    const st = ST[k], set = SETS[k], tag = k + ': ';
    for (const [id, v] of [['exit', st.exitStd], ['after', st.afterStd], ['berr', st.blindErr], ['bcl', st.blindClaim]]) {
      if (isNaN(v)) ok('widget readout ' + tag + id + ' shows a dash when the ball is never lost', txt(id) === '—', txt(id));
      else near(tag + id, num(id), v, 0.0005 + 1e-9);
    }
    near(tag + 'NIS', num('nis'), st.nis, 0.005 + 1e-9); near(tag + 'coverage', num('cov'), 100 * st.cov, 0.05 + 1e-9);
    ok('widget readout ' + tag + 'launches in the statistics', txt('nep') === st.nEp + ' of ' + NEP, txt('nep'));
    const pf = k === 'hon' ? { pt: facts.pl_true, p2: facts.pl_two, pm: facts.pl_mean, pc: facts.pl_claim } : { pt: facts[k + '_pt'], p2: facts[k + '_p2'], pm: facts[k + '_pm'], pc: facts[k + '_pc'] };
    for (const id of ['pt', 'p2', 'pm', 'pc']) near(tag + id, num(id), pf[id], 0.05 + 1e-9);
    const ti = tiFor(LAUNCH, set.width, set.wind), pl = planOne(LAUNCH, set, ti, trackKF(POOL[LAUNCH], set, ti), TA);
    ok('widget readout ' + tag + 'this launch', txt('hit') === (100 * pl.claim).toFixed(0) + ' % claimed · ' + (pl.hit ? 'hit' : 'miss'), [txt('hit'), pl.claim, pl.hit]);
  }
  /* the layout: 590 px high at desktop width; at a phone's width the page script takes the height from the one-column layout; no panel overlaps another or leaves the canvas */
  const cv = page.el('w02-canvas');
  ok('desktop width: the page script sets the canvas height to 590 px', cv.style.height === '590px', cv.style.height);
  cv.clientWidth = 313; page.set('w02-ep', LAUNCH);
  ok('phone width (313 px): the page script sets the canvas height from the one-column layout', cv.style.height === BL.layout(313).H + 'px' && BL.layout(313).H > 590, [cv.style.height, BL.layout(313).H]);
  cv.clientWidth = 640; page.set('w02-ep', LAUNCH);
  ok('back at 640 px the height is 590 px again', cv.style.height === '590px', cv.style.height);
  const boxes = L => ({ A: L.A, B: L.B, C: L.C, D: { x: L.D.x, y: L.D.y, w: L.D.w, h: L.D.n * L.D.dy }, E: { x: L.E.x, y: L.E.y, w: 210, h: L.E.h + 13 * L.E.lines } });   // E: the picture and four text lines (at most 38 characters of 9 px mono, 210 px)
  for (const w of [280, 313, 343, 375, 480, 599, 600, 640, 720, 790]) {
    const L = BL.layout(w), bx = boxes(L), names = Object.keys(bx), eps = 1e-9;
    ok('layout at ' + w + ' px: ' + (w < 600 ? 'one column' : 'two columns'), L.narrow === (w < 600) && (w < 600 ? L.C.x === L.A.x : L.C.x > L.A.x + L.A.w), L);
    for (const a of names) { const r = bx[a]; ok('layout at ' + w + ' px: panel ' + a + ' lies inside the canvas', r.x >= 0 && r.y >= 0 && r.x + r.w <= w + eps && r.y + r.h <= L.H + eps, [a, r, L.H]); }
    for (let i = 0; i < names.length; i++) for (let j = i + 1; j < names.length; j++) {
      const p = bx[names[i]], q = bx[names[j]];
      ok('layout at ' + w + ' px: panels ' + names[i] + ' and ' + names[j] + ' do not overlap', p.x + p.w <= q.x + eps || q.x + q.w <= p.x + eps || p.y + p.h <= q.y + eps || q.y + q.h <= p.y + eps, [p, q]);
    }
  }
  /* painting: BL.paint on a recording context draws every text and rectangle inside the canvas, at phone, tablet and desktop widths */
  { const STp = BL.compute(BL.session(), { width: 0.8, wind: 0, aware: 0, rmult: 1, q: 0 }, LAUNCH);
    for (const w of [280, 313, 343, 375, 599, 600, 640, 790]) {
      const L = BL.layout(w), texts = [], rects = []; let font = 10;
      const ctx = new Proxy({}, {
        get(t, k) { if (k in t) return t[k]; if (k === 'fillText') return (str, x, y) => texts.push({ str: String(str), x, y, font, align: t.textAlign || 'left' }); if (k === 'fillRect' || k === 'strokeRect') return (x, y, ww, hh) => rects.push({ x, y, ww, hh }); if (k === 'measureText') return str => ({ width: String(str).length * 0.6 * font }); return () => {}; },
        set(t, k, v) { t[k] = v; if (k === 'font') { const m = /(\d+(?:\.\d+)?)px/.exec(v); if (m) font = +m[1]; } return true; }
      });
      BL.paint({ clientWidth: w, clientHeight: L.H, width: 0, height: 0, style: {}, getContext: () => ctx }, STp);
      const out = [];
      for (const t of texts) { const tw = t.str.length * 0.6 * t.font, x0 = t.align === 'right' ? t.x - tw : t.align === 'center' ? t.x - tw / 2 : t.x; if (x0 < -1 || x0 + tw > w + 1 || t.y < 0 || t.y > L.H) out.push(t.str); }
      for (const r of rects) if (r.x < -1 || r.y < -1 || r.x + r.ww > w + 1 || r.y + r.hh > L.H + 1) out.push(JSON.stringify(r));
      ok('painting at ' + w + ' px draws ' + texts.length + ' texts and ' + rects.length + ' rectangles, all inside the canvas', texts.length > 10 && rects.length > 10 && out.length === 0, out.slice(0, 3));
    } }
  ok('the pixel count printed under the camera picture is the one the prose quotes (ball at (1.5, 2.5))', BL.ballPixels(W0, [1.5, 2.5, 0, 0]) === facts.pix_ball, [BL.ballPixels(W0, [1.5, 2.5, 0, 0]), facts.pix_ball]);
}
ok('widget ran without errors', page.problems.length === 0, page.problems.join(' | '));
console.error(fails ? `${fails} check(s) FAILED` : 'all checks passed');
console.log(JSON.stringify({ facts }));
process.exit(fails ? 1 : 0);
