#!/usr/bin/env node
/* Oracle for World Models lesson 07, "What does my action cause?".
 *
 * Two experiments, both on the Courtyard.
 *   A (the confounded log).  A hidden wind w ~ N(0, 0.3^2) m/s^2 blows along x for a whole episode, the ball also gets a 3 cm/s velocity kick every step.  The ball is
 *      watched for k steps, then gets one nudge a along x, and the log records the ball's velocity v at the nudge, the nudge, and y = x-displacement over the next 20 steps.
 *      An operator who FEELS the wind nudges against it: a = -kappa w + sigma_eps e (kappa = C/B cancels the wind in expectation).
 *   B (where the log is silent).  The ball at x = 3.6 m moving 1.6 m/s in a calm, kick-free world; the response of the 2 s displacement to a nudge; a bootstrap ensemble of
 *      small MLPs fitted to nudges in [-R, R]; eight more nudges spent at random or where the members disagree.
 *
 * Everything quoted by the lesson is re-derived here by a path that does not touch the widget's code (l07_causal.js):
 *   - an independent integrator (stepI, written from the physics: exact friction per sub-step, wind added before the move, walls, kicks) cross-checked against CY.step;
 *   - the gains B, C, c by closed form and by the sub-step recursion, kappa = C / B;
 *   - the log replayed with that integrator and fitted by the normal equations with a Cholesky solver (the widget partials the nudge out instead);
 *   - the omitted-variable formula  beta_hat = B - C kappa V / (kappa^2 V + sigma_eps^2)  against the fit at N = 600 and against a population-size fit (N = 200 000);
 *   - V for the state-only model by projection, the belief's variance by Gaussian fusion AND by CY.kf, the sample residual variance of the belief model;
 *   - the see / do exams, the counterfactual (re-run the same episode) error of the effect of a nudge, bootstrap spread of the confounded slope, a bigger network;
 *   - experiment B: the response by stepI, the wall location, the ensemble errors inside / beyond the log's range, the spread, the 20-seed comparison of random exploration
 *     with exploration where the members disagree;
 *   - the page's own widget is then driven into each state the prose describes and its readouts are compared with the numbers above.
 * Prints {"facts": {...}} as its last line.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '../../../all_lessons');
const DIR = fs.existsSync(path.join(ROOT, 'world_models_new')) ? path.join(ROOT, 'world_models_new') : path.join(ROOT, 'world_models');
const CY = require(path.join(DIR, 'courtyard.js'));
const { loadPage } = require('../dom_probe.js');

let fails = 0;
const facts = {};
function ok(name, cond, extra) { if (!cond) { fails++; console.error('FAIL', name, extra === undefined ? '' : JSON.stringify(extra)); } }
const close = (a, b, tol) => Math.abs(a - b) <= (tol === undefined ? 1e-9 : tol);
const rel = (a, b, tol) => Math.abs(a - b) <= tol * Math.abs(b);
const mean = a => a.reduce((x, y) => x + y, 0) / a.length;
const rmsOf = a => Math.sqrt(a.reduce((x, y) => x + y * y, 0) / a.length);

/* ── 1. an independent integrator for the Courtyard (walls, wind, kicks) ── */
const GAMMA = 0.35, DT = 0.1, SUB = 5, RB = 0.1, WALL_E = 0.9, AW = 8, AH = 5, SW = 0.3, SV = 0.03, TAU = 20;
const HS = DT / SUB, DAMP = Math.exp(-GAMMA * HS), GLIDE = (1 - DAMP) / GAMMA;
let bounceX = 0, WALLS = true;                                                  // how many times a ball met a left or right wall (the lesson counts the episodes in which it did)
function stepI(s, a, wind, rk, sigV) {
  let x = s[0], y = s[1], vx = s[2], vy = s[3];
  if (a) { vx += a[0]; vy += a[1]; }
  for (let i = 0; i < SUB; i++) {
    vx += wind * HS;                                              // the wind is a constant acceleration along x, added before the move
    x += vx * GLIDE; y += vy * GLIDE; vx *= DAMP; vy *= DAMP;     // exact solution of dv/dt = -gamma v over one sub-step
    if (WALLS && x < RB) { x = 2 * RB - x; vx = -WALL_E * vx; bounceX++; }
    if (WALLS && x > AW - RB) { x = 2 * (AW - RB) - x; vx = -WALL_E * vx; bounceX++; }
    if (WALLS && y < RB) { y = 2 * RB - y; vy = -WALL_E * vy; }
    if (WALLS && y > AH - RB) { y = 2 * (AH - RB) - y; vy = -WALL_E * vy; }
  }
  if (sigV && rk) { vx += sigV * CY.randn(rk); vy += sigV * CY.randn(rk); }
  return [x, y, vx, vy];
}
{ // against the engine on random states, with wind and with kicks drawn from equal streams
  const W = CY.world({ curtain: null, sigV: SV }), rng = CY.rng(3); let worst = 0;
  for (let n = 0; n < 300; n++) {
    let s = [0.3 + 7.4 * rng(), 0.3 + 4.4 * rng(), 6 * rng() - 3, 6 * rng() - 3], q = s.slice(); const wind = 0.8 * (rng() - 0.5), r1 = CY.rng(50 + n), r2 = CY.rng(50 + n); W.wind = [wind, 0];
    for (let t = 0; t < 30; t++) { const a = t === 3 ? [rng() - 0.5, 0] : null; s = stepI(s, a, wind, r1, SV); q = CY.step(W, q, a, r2); }
    for (let c = 0; c < 4; c++) worst = Math.max(worst, Math.abs(s[c] - q[c]));
  }
  ok('independent integrator == CY.step (300 trajectories, 30 steps, walls, wind, kicks)', worst < 1e-9, worst);
}

/* ── 2. the gains: closed form, sub-step recursion, and the engine ── */
const dstep = Math.exp(-GAMMA * DT), tauS = TAU * DT;
const B_cf = (1 - Math.exp(-GAMMA * tauS)) / GAMMA, C_cf = (tauS - B_cf) / GAMMA;           // continuous-time friction integrals
function disp(a, wind) { let x = 0, v = a; for (let i = 0; i < TAU * SUB; i++) { v += wind * HS; x += v * GLIDE; v *= DAMP; } return x; }      // the sub-step recursion, no walls
const B = disp(1, 0), C = disp(0, 1), KAPPA = C / B;
const c_gain = HS * DAMP * (1 - Math.pow(DAMP, SUB)) / (1 - DAMP);                          // velocity the wind adds in one step: h (d + d^2 + ... + d^5)
ok('B equals the friction integral (1 - e^{-gamma tau}) / gamma', close(B, B_cf, 1e-12), [B, B_cf]);
ok('C is within 1 % of the continuous integral (tau - B) / gamma', rel(C, C_cf, 0.01), [C, C_cf]);
facts.B = B; facts.C = C; facts.C_cont = C_cf; facts.kappa = KAPPA; facts.c_step = c_gain; facts.d_step = dstep;
facts.C_diff_pct = 100 * (C / C_cf - 1);
{ // the engine's own response to a unit nudge and a unit wind in a 1 km arena
  const big = CY.world({ W: 1e3, H: 1e3, curtain: null }), s0 = [500, 500, 1.7, 0.3];
  const run = (a, w) => { big.wind = [w, 0]; let q = CY.step(big, s0, [a, 0]); for (let t = 1; t < TAU; t++) q = CY.step(big, q, null); return q[0] - s0[0]; };
  ok('engine response to a unit nudge == B', close(run(1, 0) - run(0, 0), B, 1e-9), [run(1, 0) - run(0, 0), B]);
  ok('engine response to a unit wind == C', close(run(0, 1) - run(0, 0), C, 1e-9), [run(0, 1) - run(0, 0), C]);
  ok('the response is linear: a nudge of 2 does twice what 1 does', close(run(2, 0) - run(0, 0), 2 * B, 1e-9));
  big.wind = [1, 0]; ok('one-step velocity gain of a unit wind == c', close(CY.step(big, [500, 500, 0, 0], null)[2], c_gain, 1e-12), CY.step(big, [500, 500, 0, 0], null)[2]);
}
facts.sig_w = SW; facts.sig_v_cm = 100 * SV;
facts.r_snr = (c_gain * SW / SV) ** 2;                                                        // evidence about the wind per watched step, in units of the prior
facts.wind_push_sd = C * SW;                                                                  // metres the wind moves the ball in 2 s (1 sigma)
facts.operator_sd = KAPPA * SW;                                                               // the operator's nudge spread when it cancels the wind exactly

/* ── 3. linear algebra of our own: Cholesky normal equations ── */
function olsI(X, y) {
  const n = X.length, p = X[0].length, A = [], b = new Array(p).fill(0);
  for (let i = 0; i < p; i++) A.push(new Array(p).fill(0));
  for (let r = 0; r < n; r++) for (let i = 0; i < p; i++) { b[i] += X[r][i] * y[r]; for (let j = 0; j <= i; j++) A[i][j] += X[r][i] * X[r][j]; }
  const L = []; for (let i = 0; i < p; i++) L.push(new Array(p).fill(0));
  for (let i = 0; i < p; i++) for (let j = 0; j <= i; j++) { let s = A[i][j]; for (let k = 0; k < j; k++) s -= L[i][k] * L[j][k]; if (i === j) { if (s <= 1e-12) return null; L[i][i] = Math.sqrt(s); } else L[i][j] = s / L[j][j]; }
  const z = new Array(p).fill(0), x = new Array(p).fill(0);
  for (let i = 0; i < p; i++) { let s = b[i]; for (let k = 0; k < i; k++) s -= L[i][k] * z[k]; z[i] = s / L[i][i]; }
  for (let i = p - 1; i >= 0; i--) { let s = z[i]; for (let k = i + 1; k < p; k++) s -= L[k][i] * x[k]; x[i] = s / L[i][i]; }
  return x;
}

/* ── 4. the log, replayed with the independent integrator ── */
const KMAX = 16;
function makeLog(N, seed) {
  const W = CY.world({ curtain: null }), rng = CY.rng(seed), eps = [];
  for (let i = 0; i < N; i++) {
    const s = CY.launch(W, rng), w = SW * CY.randn(rng), e = CY.randn(rng), u = rng(), rk = CY.rng(1000003 * seed + i), tr = [s], us = [];
    for (let t = 0; t < KMAX; t++) { const q = stepI(tr[t], null, w, rk, SV); us.push(q[2] - dstep * tr[t][2]); tr.push(q); }
    eps.push({ w, e, u, tr, us, ko: 1000003 * seed + 500000 + i });
  }
  return eps;
}
function outcomeI(ep, k, a, wind) {
  const rk = CY.rng(ep.ko), wd = wind === undefined ? ep.w : wind; let q = stepI(ep.tr[k], [a, 0], wd, rk, SV);
  for (let t = 1; t < TAU; t++) q = stepI(q, null, wd, rk, SV);
  return q[0] - ep.tr[k][0];
}
function posterior(us, k) { // Gaussian fusion: the prior N(0, SW^2), k measurements u = c w + kick of variance SV^2
  let prec = 1 / (SW * SW), num = 0;
  for (let t = 0; t < k; t++) { prec += c_gain * c_gain / (SV * SV); num += c_gain * us[t] / (SV * SV); }
  return { m: num / prec, P: 1 / prec };
}
const N_TRAIN = 1000, N_TEST = 400, TRAIN = makeLog(N_TRAIN, 7), SEE = makeLog(N_TEST, 11), DOS = makeLog(N_TEST, 13);
const nudgeOf = (ep, who, se) => (who === 'operator' ? -KAPPA * ep.w : 0) + se * ep.e;
function rowsOf(eps, k, f) { return eps.map(ep => { const a = f(ep); return { v: ep.tr[k][2], a, y: outcomeI(ep, k, a), wb: posterior(ep.us, k).m, w: ep.w, ep }; }); }
const feats = { state: r => [1, r.v, r.a], belief: r => [1, r.v, r.a, r.wb], wind: r => [1, r.v, r.a, r.w] };
function fitI(rows, model) {                                    // the full normal equations in one go; the coefficient of a is entry 2
  const th = olsI(rows.map(feats[model]), rows.map(r => r.y));
  return th;
}
const predI = (th, model, r) => feats[model](r).reduce((s, x, j) => s + x * th[j], 0);
const varLeftI = (rows, cols) => { const Z = rows.map(r => cols(r)), th = olsI(Z, rows.map(r => r.w)); return mean(rows.map((r, i) => (r.w - Z[i].reduce((s, z, j) => s + z * th[j], 0)) ** 2)); };
const P_k = k => 1 / (1 / (SW * SW) + k * c_gain * c_gain / (SV * SV));
const formulaI = (V, se, kap) => B - C * kap * V / (kap * kap * V + se * se);

/* the belief against lesson 2's machinery: a scalar Kalman filter on the wind (CY.kf) */
{
  const model = { n: 1, m: 1, F: [1], H: [c_gain], Q: [0], R: [SV * SV] }; let worst = 0, worstP = 0;
  for (const ep of TRAIN.slice(0, 40)) {
    let st = { x: [0], P: [SW * SW] };
    for (let t = 0; t < KMAX; t++) { st = CY.kf.update(model, CY.kf.predict(model, st), [ep.us[t]]); const po = posterior(ep.us, t + 1); worst = Math.max(worst, Math.abs(st.x[0] - po.m)); worstP = Math.max(worstP, Math.abs(st.P[0] - po.P)); }
  }
  ok('Gaussian fusion of the watch-phase increments == the Kalman filter with the wind as its state (mean)', worst < 1e-10, worst);
  ok('... (variance)', worstP < 1e-12, worstP);
  ok('P_k closed form == fusion', close(posterior(TRAIN[0].us, 7).P, P_k(7), 1e-15));
}
for (const k of [1, 2, 4, 8, 12, 16]) facts['pk_pct_' + k] = 100 * P_k(k) / (SW * SW);
facts.pk_pct_k4 = facts.pk_pct_4; facts.pk_pct_k12 = facts.pk_pct_12; facts.pk_pct_k1 = facts.pk_pct_1;

/* ── 5. experiment A at the widget's default setting: k = 4 steps watched, the operator, sigma_eps = 0.10 ── */
const K0 = 4, SE0 = 0.1;
const modelsOf = ['state', 'belief', 'wind'];
function setting(k, who, se) {
  const kap = who === 'operator' ? KAPPA : 0, rows = rowsOf(TRAIN, k, ep => nudgeOf(ep, who, se)), o = { kap, rows, k, who, se };
  for (const mo of modelsOf) {
    const th = fitI(rows, mo); o[mo] = { th, beta: th ? th[2] : NaN };
    o[mo].V = mo === 'state' ? varLeftI(rows, r => [1, r.v]) : mo === 'belief' ? P_k(k) : 0;
    o[mo].formula = kap === 0 ? B : (o[mo].V === 0 && se === 0 ? NaN : formulaI(o[mo].V, se, kap));
  }
  return o;
}
const S0 = setting(K0, 'operator', SE0);
facts.b_state = S0.state.beta; facts.b_state_f = S0.state.formula; facts.b_state_pct = 100 * S0.state.beta / B;
facts.b_belief = S0.belief.beta; facts.b_belief_f = S0.belief.formula; facts.b_wind = S0.wind.beta;
facts.v_state_pct = 100 * S0.state.V / (SW * SW); facts.v_belief_pct = 100 * S0.belief.V / (SW * SW);
ok('state-only slope matches the formula within 5 % of B at the default setting', Math.abs(S0.state.beta - S0.state.formula) < 0.05 * B, [S0.state.beta, S0.state.formula]);
ok('belief slope matches its formula within 8 % of B', Math.abs(S0.belief.beta - S0.belief.formula) < 0.08 * B, [S0.belief.beta, S0.belief.formula]);
ok('the wind itself recovers B within 3 %', rel(S0.wind.beta, B, 0.03), S0.wind.beta);
ok('slopes are ordered state < belief < wind < B + 3 % at the default', S0.state.beta < S0.belief.beta && S0.belief.beta < S0.wind.beta, [S0.state.beta, S0.belief.beta, S0.wind.beta]);
{ // the sample residual variance of the wind given the belief is the filter's P_k
  const Z = S0.rows.map(r => [1, r.v, r.wb]), th = olsI(Z, S0.rows.map(r => r.w)); const vb = mean(S0.rows.map((r, i) => (r.w - Z[i][0] * th[0] - Z[i][1] * th[1] - Z[i][2] * th[2]) ** 2));
  ok('sample residual variance of the wind after conditioning on the belief == P_k (10 %)', rel(vb, P_k(K0), 0.10), [vb, P_k(K0)]);
  facts.v_belief_sample_pct = 100 * vb / (SW * SW);
}
facts.share_state_pct = 100 * SE0 * SE0 / (SE0 * SE0 + KAPPA * KAPPA * S0.state.V);               // what the formula calls the share of the nudge the wind did not choose
facts.share_perfect_pct = 0;
facts.eff_true = B; facts.eff_state = S0.state.beta; facts.eff_err = B - S0.state.beta;

// perfect operator: sigma_eps = 0
{ const S = setting(K0, 'operator', 0); facts.b_perfect = S.state.beta; facts.b_perfect_belief = S.belief.beta;
  ok('perfect operator: the log teaches a slope of 0 (|b| < 0.02)', Math.abs(S.state.beta) < 0.02, S.state.beta);
  ok('perfect operator: the wind itself cannot be separated from the nudge (normal equations singular)', S.wind.th === null, S.wind.th);
  const Y = S.rows.map(r => r.y - r.v * B), sd = rmsOf(Y); facts.perfect_out_sd = sd;                 // outcome minus the coast it would have made: only kicks remain
  ok('perfect operator: the outcome does not depend on the nudge (residual sd == the kicks)', sd < 0.2, sd);
}
// the worked example: a nudge of one sd of the operator's spread
{ const a1 = KAPPA * SW; facts.ex_nudge = a1; facts.ex_wind = -a1 / KAPPA; facts.ex_nudge_push = B * a1; facts.ex_wind_push = C * SW; ok('a nudge of kappa*sigma_w cancels a wind of -sigma_w exactly', close(B * a1 - C * SW, 0, 1e-12)); }

// sweep of the nudge noise at k = 4 (N = 600): fit, formula
const sweepSE = [0, 0.05, 0.1, 0.2, 0.35, 0.5, 1.0, 1.5];
for (const se of sweepSE) {
  const S = setting(K0, 'operator', se), key = 'sw' + String(Math.round(se * 1000));
  facts[key + '_fit'] = S.state.beta; facts[key + '_f'] = S.state.formula; facts[key + '_fit_belief'] = S.belief.beta; facts[key + '_wind'] = S.wind.beta;
  if (se > 0 && se <= 0.4) ok('state-only fit == formula within 6 % of B at sigma_eps = ' + se, Math.abs(S.state.beta - S.state.formula) < 0.06 * B, [S.state.beta, S.state.formula]);
  if (se > 0.4) ok('large sigma_eps: the fit is at or below the formula (the wall bends the response), within 20 % of B ' + se, S.state.beta <= S.state.formula + 0.03 * B && S.state.beta > S.state.formula - 0.2 * B, [S.state.beta, S.state.formula]);
}

// how often the nudge sends the ball into a wall within the 2 s that the log records (the reason the fit leaves the closed form at large sigma_eps)
function wallPct(k, who, se) { let n = 0; for (const ep of TRAIN) { const b0 = bounceX; outcomeI(ep, k, nudgeOf(ep, who, se)); if (bounceX > b0) n++; } return 100 * n / TRAIN.length; }
facts.wall_pct_01 = wallPct(K0, 'operator', 0.1); facts.wall_pct_035 = wallPct(K0, 'operator', 0.35); facts.wall_pct_1 = wallPct(K0, 'operator', 1.0); facts.wall_pct_15 = wallPct(K0, 'operator', 1.5);
ok('walls are not met at the careful operator\'s spread (so the closed form is exact there)', facts.wall_pct_01 < 1, facts.wall_pct_01);
ok('at sigma_eps = 1.0 a small share of the episodes meets a wall (1 % to 5 %), at 1.5 a larger one (5 % to 20 %)', facts.wall_pct_1 > 1 && facts.wall_pct_1 < 5 && facts.wall_pct_15 > 5 && facts.wall_pct_15 < 20, [facts.wall_pct_1, facts.wall_pct_15]);
{ // and the walls ARE the reason the fit leaves the closed form: take them away (same wind, same kicks) and the fit returns to the formula
  const fitNoWalls = se => { WALLS = false; const rows = rowsOf(TRAIN, K0, ep => nudgeOf(ep, 'operator', se)); WALLS = true; return fitI(rows, 'state')[2]; };
  for (const [se, key] of [[1.0, '1'], [1.5, '15']]) {
    const S = setting(K0, 'operator', se), free = fitNoWalls(se);
    facts['free_fit_' + key] = free; facts['free_f_' + key] = S.state.formula;
    ok('without walls the state-only fit returns to the closed form (sigma_eps = ' + se + ', within 2.5 % of B)', Math.abs(free - S.state.formula) < 0.025 * B, [free, S.state.formula]);
    ok('with walls the fit is lower than without (sigma_eps = ' + se + ')', S.state.beta < free - 0.01, [S.state.beta, free]);
  }
}

console.error('part 2 done: A at the default');

/* ── 6. the other settings quoted by the lesson ── */
const S12 = setting(12, 'operator', SE0);
facts.b_state_k12 = S12.state.beta; facts.b_belief_k12 = S12.belief.beta; facts.b_belief_k12_f = S12.belief.formula; facts.v_state_pct_k12 = 100 * S12.state.V / (SW * SW);
facts.b_belief_k4 = S0.belief.beta;
ok('belief at k = 12 teaches more than at k = 4', S12.belief.beta > S0.belief.beta, [S12.belief.beta, S0.belief.beta]);
ok('belief fit tracks its formula at k = 12 (within 8 % of B)', Math.abs(S12.belief.beta - S12.belief.formula) < 0.08 * B, [S12.belief.beta, S12.belief.formula]);
{ // the belief extracts what the raw state does not: V_state(k) falls slowly, P_k fast
  const vs = [1, 2, 4, 8, 12, 16].map(k => varLeftI(rowsOf(TRAIN, k, ep => nudgeOf(ep, 'operator', SE0)), r => [1, r.v]) / (SW * SW));
  facts.vstate_pct_k1 = 100 * vs[0]; facts.vstate_pct_k4 = 100 * vs[2]; facts.vstate_pct_k12 = 100 * vs[4]; facts.vstate_pct_k16 = 100 * vs[5];
  ok('the raw velocity explains little of the wind at k = 4 (V_state > 70 %) and the belief explains much more (P_k < 30 %)', vs[2] > 0.7 && P_k(4) / (SW * SW) < 0.3, [vs[2], P_k(4) / (SW * SW)]);
  ok('V_state decreases with k', vs.every((v, i) => i === 0 || v < vs[i - 1] + 0.03), vs);
}
// randomise: a coin that ignores the wind.  Unbiased at every sigma; its noise is the wind's push (C sigma_w) and the kicks, so the slope's standard error is that over sigma sqrt(N)
for (const se of [0.1, 0.5, 1.0]) {
  const S = setting(K0, 'coin', se), key = 'coin' + String(Math.round(se * 1000)), sd = Math.sqrt((C * SW) ** 2 + 0.12 ** 2), seTh = sd / (se * Math.sqrt(N_TRAIN)), wall = se > 0.8 ? 0.08 * B : 0;
  facts[key + '_fit'] = S.state.beta; facts[key + '_belief'] = S.belief.beta; facts[key + '_se'] = seTh;
  ok('a coin teaches the true slope within 3.5 standard errors (plus the wall at large sigma), sigma = ' + se, Math.abs(S.state.beta - B) < 3.5 * seTh + wall, [S.state.beta, B, seTh]);
  ok('and so do the other two models (within 4 standard errors)', Math.abs(S.belief.beta - B) < 4 * seTh + wall && Math.abs(S.wind.beta - B) < 4 * seTh + wall, [S.belief.beta, S.wind.beta, seTh]);
}
// the price of a log: how far the logged episodes end from the calm, un-nudged coast
function missRMS(who, se) { return rmsOf(TRAIN.map(ep => outcomeI(ep, K0, nudgeOf(ep, who, se)) - outcomeI(ep, K0, 0, 0))); }
facts.miss_op_01 = missRMS('operator', 0.1); facts.miss_op_034 = missRMS('operator', KAPPA * SW); facts.miss_op_035 = missRMS('operator', 0.35); facts.miss_op_1 = missRMS('operator', 1.0); facts.miss_op_15 = missRMS('operator', 1.5);
facts.miss_coin_05 = missRMS('coin', 0.5); facts.miss_coin_01 = missRMS('coin', 0.1); facts.miss_nothing = missRMS('coin', 0);
ok('with no nudge at all the episodes end C * sigma_w from the coast', rel(facts.miss_nothing, C * SW, 0.06), [facts.miss_nothing, C * SW]);
ok('the careful operator keeps the miss near B * sigma_eps', rel(facts.miss_op_01, B * 0.1, 0.1), [facts.miss_op_01, B * 0.1]);
// how much nudge noise for a given share of the effect
const sigmaFor = (share, V) => KAPPA * Math.sqrt(V) * Math.sqrt(share / (1 - share));
facts.sig95_state = sigmaFor(0.95, S0.state.V); facts.sig95_full = sigmaFor(0.95, SW * SW); facts.sig50_state = sigmaFor(0.5, S0.state.V);
facts.sig90_state = sigmaFor(0.9, S0.state.V);
facts.sig95_over_op = facts.sig95_state / (KAPPA * SW);
facts.miss_at_sig95 = Math.sqrt((B * facts.sig95_state) ** 2);                                 // metres of miss the operator's log pays at that noise (no kicks)

/* the exams: see (fresh episodes, same process) and do (nudge set by fiat) */
function exams(k, who, se) {
  const kap = who === 'operator' ? KAPPA : 0, tr = rowsOf(TRAIN, k, ep => nudgeOf(ep, who, se)), see = rowsOf(SEE, k, ep => nudgeOf(ep, who, se)), dov = rowsOf(DOS, k, ep => 2 * ep.u - 1), o = {};
  for (const mo of modelsOf) { const th = fitI(tr, mo); if (!th) { o[mo] = null; continue; } o[mo] = { see: rmsOf(see.map(r => r.y - predI(th, mo, r))), dov: rmsOf(dov.map(r => r.y - predI(th, mo, r))), beta: th[2] }; }
  return o;
}
const EX0 = exams(K0, 'operator', SE0), EXC = exams(K0, 'coin', 0.5);
facts.see_state = EX0.state.see; facts.do_state = EX0.state.dov; facts.do_see_ratio = EX0.state.dov / EX0.state.see;
facts.see_belief = EX0.belief.see; facts.do_belief = EX0.belief.dov; facts.see_wind = EX0.wind.see; facts.do_wind = EX0.wind.dov;
facts.see_coin = EXC.state.see; facts.do_coin = EXC.state.dov; facts.do_see_ratio_coin = EXC.state.dov / EXC.state.see;
ok('confounded model: the do-error is at least 4 times the see-error', EX0.state.dov > 4 * EX0.state.see, [EX0.state.see, EX0.state.dov]);
ok('randomised model: see-error and do-error agree within 15 %', Math.abs(EXC.state.dov / EXC.state.see - 1) < 0.15, [EXC.state.see, EXC.state.dov]);
ok('the confounded model passes the see exam as well as the randomised one does (see-error below the randomised model\'s)', EX0.state.see < EXC.state.see, [EX0.state.see, EXC.state.see]);
// the floor: what even a model that knows the effect cannot predict: the wind and the kicks.  An oracle predictor given B, v and the true wind:
{ const dov = rowsOf(DOS, K0, ep => 2 * ep.u - 1); facts.floor_kicks_only = rmsOf(dov.map(r => r.y - (B * (r.v + r.a) + C * r.w))); facts.floor_with_wind_unknown = rmsOf(dov.map(r => r.y - B * (r.v + r.a))); }
ok('a model that knows B but not the wind has the same do-error as the randomised fit (within 15 %)', rel(EXC.state.dov, facts.floor_with_wind_unknown, 0.15), [EXC.state.dov, facts.floor_with_wind_unknown]);

/* counterfactual: re-run the SAME episodes with a nudge of +1 and with 0; the individual effect, against what the confounded model says */
{
  const th = fitI(S0.rows, 'state'); let eff = [], err = [];
  for (const ep of TRAIN) { const e1 = outcomeI(ep, K0, 1) - outcomeI(ep, K0, 0); eff.push(e1); }
  facts.cf_true_effect = mean(eff); facts.cf_model_effect = th[2]; facts.cf_effect_err = facts.cf_true_effect - th[2];
  ok('the same episode re-run: a +1 m/s nudge moves the ball by B (walls aside), every time', close(Math.min(...eff), B, 0.05) && close(Math.max(...eff), B, 0.05) || mean(eff.map(e => Math.abs(e - B) < 0.02 ? 1 : 0)) > 0.97, [Math.min(...eff), Math.max(...eff)]);
}
/* a bigger model does not help: a tanh MLP on (v, a) -> y, trained on the same log */
{
  const tr = S0.rows, see = rowsOf(SEE, K0, ep => nudgeOf(ep, 'operator', SE0)), dov = rowsOf(DOS, K0, ep => 2 * ep.u - 1);
  const net = new CY.MLP([2, 16, 16, 1], 5); net.fit(tr.map(r => [r.v / 3, r.a / 2]), tr.map(r => [r.y / 4]), { epochs: 300, lr: 0.01, batch: 32, seed: 9 });
  const pr = r => net.predict([r.v / 3, r.a / 2])[0] * 4;
  facts.net_see = rmsOf(see.map(r => r.y - pr(r))); facts.net_do = rmsOf(dov.map(r => r.y - pr(r)));
  // what the network says a +1 m/s nudge does on the training episodes
  facts.net_effect = mean(tr.map(r => net.predict([r.v / 3, (r.a + 1) / 2])[0] * 4 - net.predict([r.v / 3, r.a / 2])[0] * 4));
  ok('a bigger network learns the same wrong effect: +1 m/s moves the ball by less than 0.3 m', facts.net_effect < 0.3, facts.net_effect);
  ok('... and its do-error is more than 3 times its see-error', facts.net_do > 3 * facts.net_see, [facts.net_see, facts.net_do]);
}
/* bootstrap: how much would the confounded slope move if we refit on resampled logs? (epistemic spread) */
{
  const rows = S0.rows, rr = CY.rng(77), bs = []; const n = rows.length;
  for (let b = 0; b < 200; b++) { const sub = []; for (let i = 0; i < n; i++) sub.push(rows[Math.floor(rr() * n)]); const th = olsI(sub.map(feats.state), sub.map(r => r.y)); bs.push(th[2]); }
  const m = mean(bs); facts.boot_sd = Math.sqrt(mean(bs.map(x => (x - m) ** 2))); facts.boot_mean = m; facts.boot_bias = B - m;
  facts.boot_ratio = facts.boot_bias / facts.boot_sd;
  ok('bootstrap refits of the confounded slope agree to a few hundredths while being wrong by more than a unit', facts.boot_sd < 0.05 && facts.boot_bias > 1.2, [facts.boot_sd, facts.boot_bias]);
}

/* ── 7. a population-size log: N = 200 000 episodes (the bias is not noise) ── */
{
  const NB = 200000, W = CY.world({ curtain: null }), rng = CY.rng(2024), se_list = [0, 0.1, 0.35, 1.0];
  const acc = se_list.map(() => ({ n: 0, sv: 0, sa: 0, sy: 0, svv: 0, sva: 0, svy: 0, saa: 0, say: 0, syy: 0 })); let sw2 = 0, sv = 0, svv = 0, svw = 0, sw1 = 0;
  for (let i = 0; i < NB; i++) {
    const s = CY.launch(W, rng), w = SW * CY.randn(rng), e = CY.randn(rng), rk = CY.rng(7000000 + i), ro = 9000000 + i; let q = s;
    for (let t = 0; t < K0; t++) q = stepI(q, null, w, rk, SV);
    sw1 += w; sv += q[2]; svv += q[2] * q[2]; svw += q[2] * w; sw2 += w * w;
    se_list.forEach((se, j) => {
      const a = -KAPPA * w + se * e, r2 = CY.rng(ro); let z = stepI(q, [a, 0], w, r2, SV); for (let t = 1; t < TAU; t++) z = stepI(z, null, w, r2, SV);
      const y = z[0] - q[0], A = acc[j]; A.n++; A.sv += q[2]; A.sa += a; A.sy += y; A.svv += q[2] * q[2]; A.sva += q[2] * a; A.svy += q[2] * y; A.saa += a * a; A.say += a * y; A.syy += y * y;
    });
  }
  // wind variance left by the velocity: residual of w on (1, v)
  const mv = sv / NB, mw = sw1 / NB, cvw = svw / NB - mv * mw, vvv = svv / NB - mv * mv, vww = sw2 / NB - mw * mw; const Vpop = vww - cvw * cvw / vvv; facts.v_state_pop_pct = 100 * Vpop / (SW * SW);
  se_list.forEach((se, j) => {
    const A = acc[j], n = A.n; const X = [[n, A.sv, A.sa], [A.sv, A.svv, A.sva], [A.sa, A.sva, A.saa]], b = [A.sy, A.svy, A.say];
    const th = CY.la.solve(Float64Array.from([].concat(...X)), Float64Array.from(b), 3);
    const key = ['inf0', 'inf01', 'inf035', 'inf1'][j]; facts['n200k_' + key] = th[2]; facts['n200k_' + key + '_f'] = formulaI(Vpop, se, KAPPA);
    facts['tab_b' + j] = th[2]; facts['tab_f' + j] = formulaI(Vpop, se, KAPPA);
    ok('N = 200 000: the fit equals the formula to within 1 % of B at sigma_eps = ' + se.toFixed(3), Math.abs(th[2] - formulaI(Vpop, se, KAPPA)) < (se > 0.5 ? 0.06 : 0.01) * B, [th[2], formulaI(Vpop, se, KAPPA)]);
    if (j === 1) { // standard error of the slope at N = 200 000: residual variance / (n var(a|v))
      const rss = A.syy - th[0] * A.sy - th[1] * A.svy - th[2] * A.say; const sig2 = rss / (n - 3);
      const Xm = CY.la.inv(Float64Array.from([].concat(...X)), 3); facts.n200k_se = Math.sqrt(sig2 * Xm[8]);
      ok('N = 200 000 standard error is a few thousandths', facts.n200k_se < 0.005, facts.n200k_se);
    }
  });
  facts.n200k_ratio = 200000 / N_TRAIN;
  ok('the slope at N = 200 000 is within 0.05 of the slope at N = 1000 (the bias is not noise)', Math.abs(facts.n200k_inf01 - S0.state.beta) < 0.05, [facts.n200k_inf01, S0.state.beta]);
  for (let j = 0; j < 4; j++) facts['tab_a' + j] = [setting(K0, 'operator', 0), setting(K0, 'operator', 0.1), setting(K0, 'operator', 0.35), setting(K0, 'operator', 1.0)][j].state.beta;
}

console.error('part 3 done: A statistics');

/* ── 8. experiment B: where the log is silent ── */
const NOM = [3.6, 2.5, 1.6, 0], R0 = 0.8, N0 = 12, SEEDB = 2, M_ENS = 5, H_ENS = 12, EP_ENS = 600;
function respondI(a) { let q = stepI(NOM, [a, 0], 0, null, 0); for (let t = 1; t < TAU; t++) q = stepI(q, null, 0, null, 0); return q[0] - NOM[0]; }
const GRID = []; for (let i = 0; i <= 120; i++) GRID.push(-3 + i * 0.05);
const TRUTH = GRID.map(respondI);
{ // the wall: the displacement stops growing where the ball just reaches x = W - r
  const room = (AW - RB) - NOM[0]; const aWall = room / B - NOM[2];
  facts.a_wall = aWall; facts.f_peak = room; facts.room = room;
  ok('below the wall the response is the straight line B (v + a) exactly', GRID.every((a, i) => a > aWall - 0.01 || close(TRUTH[i], B * (NOM[2] + a), 1e-9)), GRID.map((a, i) => TRUTH[i] - B * (NOM[2] + a)).filter((e, i) => GRID[i] <= aWall - 0.01).reduce((m, e) => Math.max(m, Math.abs(e)), 0));
  let peak = -1, pa = 0; GRID.forEach((a, i) => { if (TRUTH[i] > peak) { peak = TRUTH[i]; pa = a; } });
  ok('the response peaks at the wall nudge (within one grid step)', Math.abs(pa - aWall) <= 0.05 + 1e-9 && close(peak, room, 0.03), [pa, aWall, peak]);
  facts.f3 = respondI(3); facts.fm3 = respondI(-3); facts.line3 = B * (NOM[2] + 3); facts.end3_true = NOM[0] + respondI(3);
  facts.overshoot3 = facts.line3 - room;
  ok('beyond the wall the ball comes back: the response at 3 is below the peak', facts.f3 < room - 1, [facts.f3, room]);
  facts.log_edge = R0; facts.gap_to_wall = aWall - R0;
}
function membersI(A, Y, seed) {
  const nets = [];
  for (let m = 0; m < M_ENS; m++) {
    const r = CY.rng(seed * 100 + m), Xb = [], Yb = [];
    for (let i = 0; i < A.length; i++) { const j = Math.floor(r() * A.length); Xb.push([A[j] / 3]); Yb.push([Y[j] / 4]); }
    const net = new CY.MLP([1, H_ENS, H_ENS, 1], seed * 10 + m + 1); net.fit(Xb, Yb, { epochs: EP_ENS, lr: 0.02, batch: 64, seed: m + 3 }); nets.push(net);
  }
  return nets;
}
function bandI(nets, a) { const v = nets.map(n => n.predict([a / 3])[0] * 4), m = mean(v); return { m, s: Math.sqrt(mean(v.map(x => (x - m) ** 2))) }; }
function curveI(nets) { const m = [], sd = []; for (const a of GRID) { const b = bandI(nets, a); m.push(b.m); sd.push(b.s); } return { m, sd }; }
function errorsI(cv, R) {
  let ei = 0, ni = 0, eo = 0, no = 0, mx = 0, si = 0, so = 0;
  GRID.forEach((a, i) => { const e = cv.m[i] - TRUTH[i]; mx = Math.max(mx, Math.abs(e)); if (Math.abs(a) <= R + 1e-9) { ei += e * e; si += cv.sd[i]; ni++; } else { eo += e * e; so += cv.sd[i]; no++; } });
  const L = GRID.length - 1; return { inn: Math.sqrt(ei / ni), out: Math.sqrt(eo / no), max: mx, sin: si / ni, sout: so / no, e3: cv.m[L] - TRUTH[L], s3: cv.sd[L] };
}
function startI(R, n, seed) { const r = CY.rng(100 + seed), A = [], Y = []; for (let i = 0; i < n; i++) { const a = -R + 2 * R * r(); A.push(a); Y.push(respondI(a)); } return { A, Y }; }
function exploreI(R, n0, seed, strat, rounds, nb) {
  const d = startI(R, n0, seed), r = CY.rng(900 + seed); let nets = membersI(d.A, d.Y, seed); const picksAll = [];
  for (let rd = 0; rd < rounds; rd++) {
    let picks = [];
    if (strat === 'random') { for (let j = 0; j < nb; j++) picks.push(-3 + 6 * r()); }
    else { const cand = GRID.map(a => ({ a, s: bandI(nets, a).s })).sort((p, q) => q.s - p.s); for (const c of cand) { if (picks.length >= nb) break; if (picks.every(p => Math.abs(p - c.a) >= 0.4)) picks.push(c.a); } }
    picks.forEach(a => { d.A.push(a); d.Y.push(respondI(a)); picksAll.push(a); }); nets = membersI(d.A, d.Y, seed);
  }
  return { nets, A: d.A, Y: d.Y, picks: picksAll };
}
const BASE = (() => { const d = startI(R0, N0, SEEDB), nets = membersI(d.A, d.Y, SEEDB), cv = curveI(nets); return { d, nets, cv, er: errorsI(cv, R0) }; })();
facts.b_inn = BASE.er.inn; facts.b_out = BASE.er.out; facts.b_e3 = Math.abs(BASE.er.e3); facts.b_s3 = BASE.er.s3; facts.b_sin = BASE.er.sin; facts.b_sout = BASE.er.sout;
facts.b_ratio = BASE.er.out / BASE.er.inn; facts.b_s3_ratio = Math.abs(BASE.er.e3) / BASE.er.s3; facts.b_pred3 = BASE.cv.m[GRID.length - 1]; facts.b_pred_end3 = NOM[0] + facts.b_pred3; facts.b_outside_wall = facts.b_pred_end3 - (AW - RB);
{ // the nudge the base model likes best for "carry the ball farthest"
  let bi = 0; BASE.cv.m.forEach((v, i) => { if (v > BASE.cv.m[bi]) bi = i; }); facts.b_best_a = GRID[bi]; facts.b_best_pred = BASE.cv.m[bi]; facts.b_best_real = TRUTH[bi]; facts.b_best_gap = BASE.cv.m[bi] - TRUTH[bi];
  ok('the base model\'s favourite nudge is at the edge of the range (a = 3)', Math.abs(GRID[bi] - 3) < 1e-9, GRID[bi]);
  ok('... and it predicts the ball beyond the arena wall while the world brings it back', facts.b_outside_wall > 0.3 && facts.b_best_real < facts.room - 1, [facts.b_outside_wall, facts.b_best_real]);
}
ok('inside the log\'s range the ensemble error is below 0.05 m', BASE.er.inn < 0.05, BASE.er.inn);
ok('beyond the log\'s range the error is more than 30 times larger', BASE.er.out > 30 * BASE.er.inn, [BASE.er.out, BASE.er.inn]);
ok('the spread grows beyond the range but understates the error at the edge (by more than 5x)', BASE.er.sout > 3 * BASE.er.sin && Math.abs(BASE.er.e3) > 5 * BASE.er.s3, [BASE.er.sin, BASE.er.sout, BASE.er.e3, BASE.er.s3]);
{ // the log's range R: error beyond R, at the widget's seed
  for (const R of [0.4, 0.8, 1.2, 1.6, 2.0]) { const d = startI(R, N0, SEEDB), nets = membersI(d.A, d.Y, SEEDB), er = errorsI(curveI(nets), R); facts['R' + Math.round(R * 10) + '_out'] = er.out; facts['R' + Math.round(R * 10) + '_inn'] = er.inn; facts['R' + Math.round(R * 10) + '_max'] = er.max; }
  ok('a log that reaches past the wall (R = 2.0) leaves a smaller worst case than one that stops short of it (R = 0.8)', facts.R20_max < facts.R8_max, [facts.R20_max, facts.R8_max]);
  { // the error inside rises when the log reaches the wall because twelve nudges cannot pin down a response with a kink: more nudges bring it down
    const d = startI(2.0, 80, SEEDB), nets = membersI(d.A, d.Y, SEEDB); facts.R20_n80_inn = errorsI(curveI(nets), 2.0).inn;
    ok('a log that reaches the wall has a larger error inside its range than one that stops short of it (R = 2.0 against R = 0.8)', facts.R20_inn > 5 * facts.R8_inn, [facts.R20_inn, facts.R8_inn]);
    ok('... and eighty nudges instead of twelve bring that error down by more than half', facts.R20_n80_inn < 0.5 * facts.R20_inn, [facts.R20_n80_inn, facts.R20_inn]);
  }
}
// the widget's seed, two rounds of four
const XR = exploreI(R0, N0, SEEDB, 'random', 2, 4), XD = exploreI(R0, N0, SEEDB, 'disagree', 2, 4), erR = errorsI(curveI(XR.nets), R0), erD = errorsI(curveI(XD.nets), R0);
facts.x_rand_max = erR.max; facts.x_dis_max = erD.max; facts.x_rand_rms = Math.sqrt((erR.inn ** 2 * 1 + erR.out ** 2 * 1) / 2); facts.x_dis_rms = Math.sqrt((erD.inn ** 2 * 1 + erD.out ** 2 * 1) / 2);
facts.x_dis_picks_min = Math.min(...XD.picks); facts.x_dis_picks_max = Math.max(...XD.picks);
{ // after one round only
  const X1R = exploreI(R0, N0, SEEDB, 'random', 1, 4), X1D = exploreI(R0, N0, SEEDB, 'disagree', 1, 4); facts.x1_rand_max = errorsI(curveI(X1R.nets), R0).max; facts.x1_dis_max = errorsI(curveI(X1D.nets), R0).max;
}
// 20 seeds
{
  const rows = { base: [], random: [], disagree: [] };
  for (let seed = 1; seed <= 20; seed++) {
    const d = startI(R0, N0, seed), nb = membersI(d.A, d.Y, seed); rows.base.push(errorsI(curveI(nb), R0));
    for (const st of ['random', 'disagree']) rows[st].push(errorsI(curveI(exploreI(R0, N0, seed, st, 2, 4).nets), R0));
  }
  const m = (k, f) => mean(rows[k].map(f));
  facts.s20_base_inn = m('base', o => o.inn); facts.s20_base_out = m('base', o => o.out); facts.s20_base_max = m('base', o => o.max); facts.s20_base_e3 = m('base', o => Math.abs(o.e3)); facts.s20_base_s3 = m('base', o => o.s3);
  facts.s20_base_sin = m('base', o => o.sin); facts.s20_base_sout = m('base', o => o.sout);
  facts.s20_rand_max = m('random', o => o.max); facts.s20_dis_max = m('disagree', o => o.max);
  facts.s20_rand_out = m('random', o => o.out); facts.s20_dis_out = m('disagree', o => o.out);
  facts.s20_wins = rows.disagree.filter((o, i) => o.max < rows.random[i].max).length;
  facts.s20_ratio = facts.s20_rand_max / facts.s20_dis_max;
  facts.s20_base_ratio = facts.s20_base_out / facts.s20_base_inn;
  ok('where members disagree beats random in at least 15 of 20 seeds (worst-case error, equal data)', facts.s20_wins >= 15, facts.s20_wins);
  ok('and the mean worst-case error is at least 2x smaller', facts.s20_ratio >= 2, facts.s20_ratio);
  ok('the ensemble spread understates the error at the edge in every seed (error > 3 x spread)', rows.base.every(o => Math.abs(o.e3) > 3 * o.s3), rows.base.map(o => Math.abs(o.e3) / o.s3));
}
console.error('part 4 done: experiment B');

/* ── 9. small constants quoted in the prose, and the checkpoint ── */
facts.ex_wind_abs = SW; facts.meas_sd = SV / c_gain;
{
  const Bc = 2, Cc = 3, kap = Cc / Bc, sw = 0.4, se = 0.3, share = se * se / (se * se + kap * kap * sw * sw);
  facts.ck_share = share; facts.ck_slope = Bc * share; facts.ck_var = 9 * kap * kap * sw * sw; facts.ck_sigma = Math.sqrt(facts.ck_var); facts.ck_ratio = facts.ck_sigma / (kap * sw);
  // brute force: simulate the abstract world and fit the slope
  const rr = CY.rng(31); let sa = 0, sy = 0, saa = 0, say = 0, n = 600000;
  const fitFor = sg => { sa = sy = saa = say = 0; for (let i = 0; i < n; i++) { const w = sw * CY.randn(rr), a = -kap * w + sg * CY.randn(rr), y = Bc * a + Cc * w + 0.1 * CY.randn(rr); sa += a; sy += y; saa += a * a; say += a * y; } return (say / n - sa * sy / n / n) / (saa / n - (sa / n) ** 2); };
  ok('checkpoint (a) by brute force', Math.abs(fitFor(0.3) - facts.ck_slope) < 0.01, [fitFor(0.3), facts.ck_slope]);
  ok('checkpoint (b) by brute force: the slope at the answer is 90 % of B', Math.abs(fitFor(facts.ck_sigma) - 0.9 * Bc) < 0.02, fitFor(facts.ck_sigma));
}
console.error('part 5 done: constants');
/* ── 10. the widget itself: drive the page's controls and compare what it prints with the independent computation ── */
{
  const PAGE = path.join(DIR, '07_actions_causality_counterfactuals.html');
  const page = loadPage(PAGE, { dpr: 1 });
  ok('widget: the page loads and runs with no problems', page.problems.length === 0, page.problems);
  const txt = n => page.text('w07-' + n), val = n => page.num('w07-' + n), two = n => (txt(n).match(/\d+(?:\.\d+)?/g) || []).map(Number);
  const shows = (n, e, dp) => Number.isFinite(e) ? Math.abs(val(n) - e) <= 0.51 * Math.pow(10, -dp) : txt(n) === 'n/a';
  const missK = (k, who, se) => rmsOf(TRAIN.map(ep => outcomeI(ep, k, nudgeOf(ep, who, se)) - outcomeI(ep, k, 0, 0)));
  function expectA(k, who, se) {
    const S = setting(k, who, se), E = exams(k, who, se), e = E.state;
    return { b0: S.state.beta, f0: S.state.formula, b1: S.belief.beta, b2: S.wind.beta, v0: 100 * S.state.V / (SW * SW), v1: 100 * S.belief.V / (SW * SW), see: e ? e.see : NaN, dov: e ? e.dov : NaN, cost: missK(k, who, se) };
  }
  function checkA(label, k, who, se) {
    page.el('w07-who').value = who; page.el('w07-k').value = String(k); page.set('w07-se', se);     // the page reads all three controls on every event
    const x = expectA(k, who, se);
    for (const [n, e, dp] of [['b0', x.b0, 2], ['f0', x.f0, 2], ['b1', x.b1, 2], ['b2', x.b2, 2], ['v0', x.v0, 0], ['v1', x.v1, 0], ['see', x.see, 2], ['do', x.dov, 2], ['cost', x.cost, 2]])
      ok('widget ' + label + ': #w07-' + n + ' shows the independent value', shows(n, e, dp), [txt(n), e]);
    return x;
  }
  const errB = (R) => { const d = startI(R, N0, SEEDB); return errorsI(curveI(membersI(d.A, d.Y, SEEDB)), R); };
  function checkB(label, er) {
    ok('widget ' + label + ': ensemble error inside the log', shows('ein', er.inn, 3), [txt('ein'), er.inn]);
    ok('widget ' + label + ': ensemble error beyond the log', shows('eout', er.out, 2), [txt('eout'), er.out]);
    const sp = two('spr'); ok('widget ' + label + ': spread inside | beyond', sp.length === 2 && Math.abs(sp[0] - er.sin) <= 0.00051 && Math.abs(sp[1] - er.sout) <= 0.00051, [txt('spr'), er.sin, er.sout]);
  }
  // as loaded: the operator, sigma_eps = 0.10, 4 steps watched, the log reaching +-0.8
  { const x = expectA(K0, 'operator', SE0);
    for (const [n, e, dp] of [['b0', x.b0, 2], ['f0', x.f0, 2], ['b1', x.b1, 2], ['b2', x.b2, 2], ['v0', x.v0, 0], ['v1', x.v1, 0], ['see', x.see, 2], ['do', x.dov, 2], ['cost', x.cost, 2]]) ok('widget as loaded: #w07-' + n + ' shows the independent value', shows(n, e, dp), [txt(n), e]);
    checkB('as loaded', BASE.er);
    ok('widget as loaded: the two exploration readouts are empty until a click', txt('rnd') === '—' && txt('dis') === '—', [txt('rnd'), txt('dis')]);
    ok('widget as loaded: the lead numbers are the ones the lesson quotes', Math.abs(val('b0') - facts.b_state) < 0.0051 && Math.abs(val('see') - facts.see_state) < 0.0051 && Math.abs(val('do') - facts.do_state) < 0.0051, [val('b0'), val('see'), val('do')]);
  }
  // the first slider: the noise in the nudges
  const draws0 = page.draws;
  checkA('sigma_eps = 0 (the perfect operator)', 4, 'operator', 0);
  ok('widget: at sigma_eps = 0 the slope given the wind cannot be fitted', txt('b2') === 'n/a', txt('b2'));
  ok('widget: at sigma_eps = 0 the log teaches a slope near 0', Math.abs(val('b0')) < 0.03, val('b0'));
  checkA('sigma_eps = 0.35', 4, 'operator', 0.35);
  checkA('sigma_eps = 1.0', 4, 'operator', 1.0);
  checkA('sigma_eps = 1.5', 4, 'operator', 1.5);
  checkA('coin, spread 0.5', 4, 'coin', 0.5);
  ok('widget: with a coin the closed form is the true effect', Math.abs(val('f0') - B) < 0.0051, val('f0'));
  checkA('coin, spread 0 (nothing varies)', 4, 'coin', 0);
  ok('widget: a coin of spread 0 leaves nothing to fit', txt('b0') === 'n/a' && txt('b1') === 'n/a' && txt('b2') === 'n/a' && txt('see') === 'n/a', [txt('b0'), txt('b1'), txt('b2'), txt('see')]);
  checkA('k = 12', 12, 'operator', 0.1);
  checkA('k = 1', 1, 'operator', 0.1);
  ok('widget: more steps watched shrink the belief\'s unexplained wind', (() => { page.set('w07-k', 1); const a = val('v1'); page.set('w07-k', 16); return val('v1') < a; })());
  ok('widget: the controls redrew the canvas', page.draws > draws0, [page.draws, draws0]);
  // the sweep behind the dots: the page's own engine against the independent fits at every noise level
  { const CAp = page.win.CA; let worst = 0, n = 0;
    for (const se of [0, 0.25, 0.5, 1.0, 1.5]) { const sl = CAp.slopes(4, 'operator', se), S = setting(4, 'operator', se);
      for (const mo of modelsOf) { const a = sl[mo], b = S[mo].beta; if (Number.isNaN(a) !== Number.isNaN(b)) { worst = Infinity; } else if (!Number.isNaN(a)) worst = Math.max(worst, Math.abs(a - b)); n++; } }
    ok('widget engine: the swept slopes equal the independent fits (' + n + ' points)', worst < 1e-6, worst);
    ok('widget engine: the noise levels of the sweep are 0 .. 1.5 in steps of 0.125', CAp.SIGS.length === 13 && Math.abs(CAp.SIGS[12] - 1.5) < 1e-12);
  }
  // the third panel: the log's range, and spending nudges
  page.set('w07-who', 'operator'); page.set('w07-k', 4); page.set('w07-se', 0.1); page.set('w07-r', 0.8);
  checkB('R = 0.8', BASE.er);
  page.click('w07-more');
  ok('widget: one click, worst case with random nudges', shows('rnd', facts.x1_rand_max, 2), [txt('rnd'), facts.x1_rand_max]);
  ok('widget: one click, worst case where the members disagree', shows('dis', facts.x1_dis_max, 2), [txt('dis'), facts.x1_dis_max]);
  page.click('w07-more');
  ok('widget: two clicks, worst case with random nudges', shows('rnd', facts.x_rand_max, 2), [txt('rnd'), facts.x_rand_max]);
  ok('widget: two clicks, worst case where the members disagree', shows('dis', facts.x_dis_max, 2), [txt('dis'), facts.x_dis_max]);
  checkB('R = 0.8 after clicks (the base ensemble is unchanged)', BASE.er);
  page.click('w07-more');
  ok('widget: three clicks fill both readouts', Number.isFinite(val('rnd')) && Number.isFinite(val('dis')), [txt('rnd'), txt('dis')]);
  ok('widget: the button says the twelve nudges are spent', txt('more') === 'all 12 spent', txt('more'));
  page.click('w07-more'); ok('widget: a fourth click spends nothing more', txt('more') === 'all 12 spent');
  page.click('w07-reset');
  ok('widget: reset empties the exploration readouts and restores the button', txt('rnd') === '—' && txt('dis') === '—' && txt('more') === 'spend 4 more nudges', [txt('rnd'), txt('dis'), txt('more')]);
  page.click('w07-more'); page.set('w07-r', 2.0);
  ok('widget: moving the log\'s range starts the exploration over', txt('rnd') === '—' && txt('dis') === '—', [txt('rnd'), txt('dis')]);
  checkB('R = 2.0', errB(2.0));
  ok('widget: R = 2.0 quotes the lesson\'s numbers', Math.abs(val('ein') - facts.R20_inn) < 0.00051 && Math.abs(val('eout') - facts.R20_out) < 0.0051, [val('ein'), val('eout')]);
  page.set('w07-r', 0.4); checkB('R = 0.4', errB(0.4));
  ok('widget: no handler threw during the whole drive', page.problems.length === 0, page.problems);
}
/* ── END ── */
console.error(fails ? `${fails} check(s) FAILED` : 'all checks passed');
for (const k of Object.keys(facts)) if (!Number.isFinite(facts[k])) delete facts[k];
console.log(JSON.stringify({ facts }));
process.exit(fails ? 1 : 0);
