#!/usr/bin/env node
/* Oracle for World Models lesson 04, "Learning the filter and the dynamics".
 *
 * Independent re-derivations (own scalar 2x2 algebra, own random streams, own evaluation loops; the engine l04_dynamics.js and the page are only COMPARED against them):
 *   1. The floor.  Riccati recursion by explicit 2x2 formulas -> S_inf, the steady gain, the impulse response h_j (by pushing a unit impulse through the steady filter, not by matrix
 *      powers), the cold-start curve S_m; the empirical variance of the innovations of a scalar Kalman filter run over the Courtyard's own CY.step stream with jitter.
 *   2. The window.  The free-flight stream re-simulated with a different generator (xorshift + Box-Muller, own state recursion); ridge regression by explicit normal equations;
 *      MSE(m) / S_inf must agree with the engine's, decrease with m, stay above 1, and approach the cold-start curve; the weights must approach h_j.
 *   3. The recurrent net on the plain Courtyard (walls, curtain, nudges): the engine's training schedule is replayed (5 clicks of 60 epochs) and every quoted number is recomputed
 *      with own loops: settled-step error against S_inf, Kalman baseline (own filter, known nudges), linear probe (own normal equations), clean curtain crossings (own selection),
 *      the what-if (own free-run of the net against the closed form g a (1 - d^k)/(1 - d) and the simulator), the surprise after an unlogged push.
 *   4. The Kalman KL identity KL(q||p) = 1/2 [kappa (nu^2/S - 1) - ln(1 - kappa)] against the general Gaussian KL (own 2x2 inverse and determinants), its expectation, the
 *      value at the first reading after the curtain.
 *   5. The fork behind a wide curtain: the map aim error -> (coming-out step, point) by own stepping; the exact posterior of the aim error after one reading; the exact conditional
 *      mean and variance of the coming-out reading by quadrature; the network (same schedule) compared with them; the canonical streams; the checkpoint.
 *   6. The page's own widget is driven with loadPage() through each state the prose describes and its readouts are compared with the independent numbers.
 * Prints {"facts": {...}} as its last line.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '../../../all_lessons');
const DIR = fs.existsSync(path.join(ROOT, 'world_models_new')) ? path.join(ROOT, 'world_models_new') : path.join(ROOT, 'world_models');
const CY = require(path.join(DIR, 'courtyard.js'));
const DY = require(path.join(DIR, 'l04_dynamics.js'));
const { loadPage } = require('../dom_probe.js');

let fails = 0;
const facts = {};
function ok(name, cond, extra) { if (!cond) { fails++; console.error('FAIL', name, extra === undefined ? '' : JSON.stringify(extra)); } }
const close = (a, b, tol) => Math.abs(a - b) <= tol;
const rel = (a, b) => Math.abs(a - b) / Math.max(1e-300, Math.abs(b));
const sum = a => a.reduce((x, y) => x + y, 0), mean = a => sum(a) / a.length;

/* ───────────── own small tools: a different random generator, a linear solver ───────────── */
function xor32(seed) { let x = (seed | 0) || 1; return () => { x ^= x << 13; x ^= x >>> 17; x ^= x << 5; return ((x >>> 0) + 0.5) / 4294967296; }; }
function gauss(r) { const u = r(), v = r(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }
function solve(A, b, n) {                                   // Gauss elimination with partial pivoting; A is n x n (flat), b length n
  const M = []; for (let i = 0; i < n; i++) { M.push([]); for (let j = 0; j < n; j++) M[i].push(A[i * n + j]); M[i].push(b[i]); }
  for (let c = 0; c < n; c++) {
    let p = c; for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    [M[c], M[p]] = [M[p], M[c]];
    for (let r = c + 1; r < n; r++) { const f = M[r][c] / M[c][c]; for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k]; }
  }
  const x = new Array(n).fill(0);
  for (let i = n - 1; i >= 0; i--) { let s = M[i][n]; for (let j = i + 1; j < n; j++) s -= M[i][j] * x[j]; x[i] = s / M[i][i]; }
  return x;
}

/* ───────────── 1. the floor ───────────── */
const GAMMA = 0.35, DT = 0.1, SV = 0.08, SO = 0.1;
const dF = Math.exp(-GAMMA * DT), gF = (1 - dF) / GAMMA;
facts.d_fr = dF; facts.g_pos = gF; facts.sv = SV;
ok('engine constants', close(DY.d, dF, 1e-15) && close(DY.g, gF, 1e-15) && DY.SV === SV && DY.SO === SO);
{ // one step of the Courtyard in free flight is exactly p' = p + g v, v' = d v
  const w0 = CY.world({ W: 1e3, H: 1e3, curtain: null }), s1 = CY.step(w0, [10, 10, 2, -1], null);
  ok('free-flight step = F x', close(s1[0], 10 + gF * 2, 1e-12) && close(s1[1], 10 - gF, 1e-12) && close(s1[2], dF * 2, 1e-12) && close(s1[3], -dF, 1e-12), s1);
}
// own Riccati, explicit formulas.  P = [p00, p01, p11] posterior covariance, flat prior.
function riccati(n) {
  let P = [1e8, 0, 1e8], S = [], pm = null;
  for (let k = 0; k <= n; k++) {
    const a = P[0], b = P[1], c = P[2];
    const m00 = a + 2 * gF * b + gF * gF * c, m01 = dF * (b + gF * c), m11 = dF * dF * c + SV * SV;          // F P F' + diag(0, sv^2)
    pm = [m00, m01, m11]; const s = m00 + SO * SO; S.push(s);
    const k0 = m00 / s, k1 = m01 / s;
    P = [m00 - k0 * m00, m01 - k0 * m01, m11 - k1 * m01];
  }
  const s = pm[0] + SO * SO, K = [pm[0] / s, pm[1] / s], post = [pm[0] - K[0] * pm[0], pm[1] - K[0] * pm[1], pm[2] - K[1] * pm[1]];
  return { S, Sinf: s, Pm: pm, K, post };
}
const RIC = riccati(600), SINF = RIC.Sinf;
facts.sinf = SINF; facts.sinf_cm = 100 * Math.sqrt(SINF); facts.pm_cm = 100 * Math.sqrt(RIC.Pm[0]); facts.sinf_x = SINF / (SO * SO);
ok('S_inf: own Riccati vs engine (CY.kf)', rel(SINF, DY.riccati(DY.model(), 600, 14).Sinf) < 1e-9, [SINF, DY.riccati(DY.model(), 600, 14).Sinf]);
ok('S_inf = P- + R', close(SINF, RIC.Pm[0] + SO * SO, 1e-15));
// the impulse response by pushing a unit impulse through the steady filter: xhat_t = F xhat_{t-1} + K (z_t - H F xhat_{t-1}); h_t = H F xhat_t
function impulse(n, K) {
  const h = []; let x = [0, 0];
  for (let t = 0; t < n; t++) {
    const px = [x[0] + gF * x[1], dF * x[1]], z = t === 0 ? 1 : 0, nu = z - px[0];
    x = [px[0] + K[0] * nu, px[1] + K[1] * nu];
    h.push(x[0] + gF * x[1]);
  }
  return h;
}
const H_OWN = impulse(400, RIC.K);
{ const eng = DY.riccati(DY.model(), 600, 14); let worst = 0; for (let j = 0; j < 14; j++) worst = Math.max(worst, Math.abs(H_OWN[j] - eng.h[j]));
  ok('impulse response: own impulse run vs engine H F M^j K', worst < 1e-9, worst);
  ok('the weights sum to one (a ball held still is predicted to stay)', close(sum(H_OWN), 1, 1e-9), sum(H_OWN));
  facts.h0 = H_OWN[0]; facts.h1 = H_OWN[1]; facts.h2 = H_OWN[2]; facts.h8 = H_OWN[8];
  ok('h_j positive and falling, then a small negative tail from lag 8', H_OWN[0] > H_OWN[1] && H_OWN[1] > H_OWN[2] && H_OWN[7] > 0 && H_OWN[8] < 0 && H_OWN.slice(8, 14).every(v => v < 0), H_OWN.slice(0, 14));
  facts.post_pos_cm = 100 * Math.sqrt(RIC.post[0]); facts.post_vel = Math.sqrt(RIC.post[2]);
  ok('posterior sd (own) vs engine', close(facts.post_pos_cm / 100, eng.post[0], 1e-9) && close(facts.post_vel, eng.post[1], 1e-9));
}
// cold-start curve S_m
facts.s2 = RIC.S[2] / SINF; facts.s8 = RIC.S[8] / SINF; facts.s14 = RIC.S[14] / SINF;
ok('S_m falls to the floor from above', RIC.S.slice(2, 40).every((v, i, a) => v >= SINF - 1e-12 && (i === 0 || v < a[i - 1])), RIC.S.slice(2, 8));
ok('two noisy readings are about four times the floor', facts.s2 > 3.8 && facts.s2 < 4.3, facts.s2);
// empirical innovation variance of a scalar filter on the Courtyard's own stream (CY.step, jitter on): per axis, flat prior, first 30 steps discarded
{
  const w = CY.world({ W: 60, H: 60, curtain: null, sigV: SV }), rng = CY.rng(31); let n = 0, ss = 0, nis = 0;
  for (let i = 0; i < 1500; i++) {
    const sp = 2 + rng(), th = 2 * Math.PI * rng(); let s = [20 + 20 * rng(), 20 + 20 * rng(), sp * Math.cos(th), sp * Math.sin(th)];
    const st = [{ x: [0, 0], P: [1e6, 0, 1e6] }, { x: [0, 0], P: [1e6, 0, 1e6] }];
    for (let t = 0; t < 120; t++) {
      const z = [s[0] + SO * CY.randn(rng), s[1] + SO * CY.randn(rng)];
      for (let ax = 0; ax < 2; ax++) {
        const k = st[ax], a = k.P[0], b = k.P[1], c = k.P[2];
        const px = [k.x[0] + gF * k.x[1], dF * k.x[1]], P = [a + 2 * gF * b + gF * gF * c, dF * (b + gF * c), dF * dF * c + SV * SV];         // predict
        const Sx = P[0] + SO * SO, K0 = P[0] / Sx, K1 = P[1] / Sx, nu = z[ax] - px[0];
        if (t >= 30) { n++; ss += nu * nu; nis += nu * nu / Sx; }
        st[ax] = { x: [px[0] + K0 * nu, px[1] + K1 * nu], P: [P[0] - K0 * P[0], P[1] - K0 * P[1], P[2] - K1 * P[1]] };                  // update
      }
      s = CY.step(w, s, null, rng);
    }
  }
  facts.sinf_emp = ss / n; facts.emp_err = 100 * Math.abs(ss / n / SINF - 1); facts.nis_mean = nis / n; facts.n_innov = n;
  ok('empirical innovation variance = S_inf (within 1 %)', facts.emp_err < 1.0, [ss / n, SINF]);
  ok('normalised innovations have mean square 1', close(nis / n, 1, 0.01), nis / n);
  ok('more than a quarter of a million innovations', n >= 250000, n);
}

/* ───────────── 2. the window: own simulation and own normal equations ───────────── */
function makeClips(n, seed, T) {
  const r = xor32(seed), out = [];
  for (let i = 0; i < n; i++) {
    const sp = 2 + r(), th = 2 * Math.PI * r(), p = [-10 + 20 * r(), -10 + 20 * r()], v = [sp * Math.cos(th), sp * Math.sin(th)], z = [[], []];
    for (let t = 0; t < T; t++) { for (let a = 0; a < 2; a++) z[a].push(p[a] + SO * gauss(r)); for (let a = 0; a < 2; a++) { p[a] += gF * v[a]; v[a] = dF * v[a] + SV * gauss(r); } }
    out.push(z[0], z[1]);
  }
  return out;
}
const T0 = 13;                                              // every window length is scored on the same steps of every launch: t = 13 .. 38 (the longest window, 14 readings, fits from t = 13 on)
function fitWindow(clips, m, lam) {
  const A = new Array(m * m).fill(0), b = new Array(m).fill(0);
  for (const z of clips) for (let t = T0; t < z.length - 1; t++) for (let i = 0; i < m; i++) { b[i] += z[t - i] * z[t + 1]; for (let j = 0; j < m; j++) A[i * m + j] += z[t - i] * z[t - j]; }
  for (let i = 0; i < m; i++) A[i * m + i] += lam;
  return solve(A, b, m);
}
function windowMSE(clips, w, m) { let s = 0, n = 0; for (const z of clips) for (let t = T0; t < z.length - 1; t++) { let p = 0; for (let i = 0; i < m; i++) p += w[i] * z[t - i]; s += (z[t + 1] - p) * (z[t + 1] - p); n++; } return s / n; }
const L = DY.linear();
const trC = makeClips(3000, 101, 40), teC = makeClips(3000, 202, 40), OWN = {}, MS = [1, 2, 4, 6, 8, 10, 14];
MS.forEach(m => { const w = fitWindow(trC, m, 1e-6); OWN[m] = { w, ratio: windowMSE(teC, w, m) / SINF }; });
MS.forEach(m => ok('MSE(m)/S_inf, own simulation vs engine, m = ' + m, rel(OWN[m].ratio, L.mse[m - 1] / SINF) < 0.02, [OWN[m].ratio, L.mse[m - 1] / SINF]));
const RATIO = L.mse.map(v => v / SINF);
ok('engine Riccati floor = own floor', rel(L.R.Sinf, SINF) < 1e-9);
ok('MSE(m) is above the floor for every m', RATIO.every(v => v > 0.998), RATIO);
ok('MSE(m) decreases with m, strictly', RATIO.every((v, i) => i === 0 || v < RATIO[i - 1]), RATIO);
ok('and approaches the floor from above (within 1 % at m = 14)', RATIO[13] < 1.01 && RATIO[13] > 0.998, RATIO[13]);
ok('m = 1 sits well above it', RATIO[0] > 1.5, RATIO[0]);
ok('the fit is never worse than the cold-start filter and sits on it for long windows', RATIO.every((v, i) => i < 2 || v <= RIC.S[i + 1] / SINF + 0.005) && close(RATIO[7], RIC.S[8] / SINF, 0.03) && close(RATIO[13], RIC.S[14] / SINF, 0.01), [RATIO[7], RIC.S[8] / SINF]);
ok('weights: the first lag of a short window is the dominant one', L.W[3][0] > L.W[3][3]);
{ // weights vs the impulse response
  const wd = m => { let a = 0, b = 0; for (let j = 0; j < m; j++) { a += (L.W[m - 1][j] - H_OWN[j]) ** 2; b += H_OWN[j] ** 2; } return Math.sqrt(a / b); };
  facts.wd6 = wd(6); facts.wd10 = wd(10); facts.wd14 = wd(14);
  ok('relative distance falls with m (m = 6, 10, 14)', facts.wd6 > facts.wd10 && facts.wd10 > facts.wd14 && facts.wd14 < 0.15, [facts.wd6, facts.wd10, facts.wd14]);
  ok('engine rel[] = own relative distance', MS.every(m => close(L.rel[m - 1], wd(m), 1e-9)));
  let g8 = 0; for (let j = 0; j < 8; j++) g8 = Math.max(g8, Math.abs(L.W[13][j] - H_OWN[j])); facts.wgap = g8;
  ok('m = 14 weights match h_j at the first eight lags', g8 < 0.012, g8);
  let g8o = 0; for (let j = 0; j < 8; j++) g8o = Math.max(g8o, Math.abs(OWN[14].w[j] - H_OWN[j])); ok('own-simulation weights at m = 14 match h_j at the first eight lags', g8o < 0.02, g8o);
  // own regression and engine regression agree
  let dw = 0; for (let j = 0; j < 8; j++) dw = Math.max(dw, Math.abs(OWN[14].w[j] - L.W[13][j])); ok('own and engine weights agree (lags 0..7, m = 14)', dw < 0.02, dw);
}
{ // without the jolt the cold-start error keeps falling with the window and never reaches the floor
  const ricSV = (sv, n) => { let P = [1e8, 0, 1e8], S_ = []; for (let k = 0; k <= n; k++) { const a = P[0], b = P[1], c = P[2], m00 = a + 2 * gF * b + gF * gF * c, m01 = dF * (b + gF * c), m11 = dF * dF * c + sv * sv, s_ = m00 + SO * SO; S_.push(s_); const k0 = m00 / s_, k1 = m01 / s_; P = [m00 - k0 * m00, m01 - k0 * m01, m11 - k1 * m01]; } return S_; };
  const S0 = ricSV(0, 400); facts.nojolt14 = S0[14] / (SO * SO); facts.nojolt56 = S0[56] / (SO * SO);
  ok('without the jolt the cold-start error is still falling at m = 14 and m = 56 and is far above the floor at 14', S0.slice(2, 400).every((v, i, a) => i === 0 || v < a[i - 1]) && facts.nojolt14 > 1.2 && facts.nojolt56 > 1.03 && facts.nojolt56 < facts.nojolt14, [facts.nojolt14, facts.nojolt56]);
  ok('with the jolt it has reached the floor by m = 28 (to 0.1 %)', RIC.S[28] / SINF < 1.001, RIC.S[28] / SINF);
  // sampling noise of the reported error on the 6000 test launches (per-launch mean squared errors)
  const te6b = DY.freeClips(6000, 22, 40), per = [];
  for (const z of te6b) { let s_ = 0, n_ = 0; for (let t = 13; t < z.length - 1; t++) { let p_ = 0; for (let i = 0; i < 14; i++) p_ += L.W[13][i] * z[t - i]; s_ += (z[t + 1] - p_) ** 2; n_++; } per.push(s_ / n_); }
  const mu_ = mean(per), se = Math.sqrt(sum(per.map(e => (e - mu_) ** 2)) / (per.length - 1) / per.length) / mu_; facts.test_se_pct = 100 * se;
  ok('the test-set noise of the m = 14 error is about a quarter of a percent', se > 0.0015 && se < 0.0035, se);
}
facts.under3 = 100 * (1 - RATIO[2] / (RIC.S[3] / SINF)); facts.under8 = 100 * (1 - RATIO[7] / (RIC.S[8] / SINF));
{ // the engine's test set is the 6000 launches of seed 22, scored at steps 13..38: reproduce the reported error with own loops
  const te6 = DY.freeClips(6000, 22, 40);
  ok('engine window experiment: 6000 test launches, windows from step 13 (own scoring of the engine weights = reported error)', [1, 8, 14].every(m => close(windowMSE(te6, L.W[m - 1], m) / SINF, RATIO[m - 1], 1e-9)) && te6.length === 12000);
  ok('engine window experiment: 1500 training launches, 26 windows per axis', L.N === 1500 * 2 * 26, L.N);
  ok('the ridge penalty is 1e-6 and the fit has no intercept', /DY\.window\(tr, m, 1e-6\)/.test(DY.linear.toString()));
}
facts.r1 = RATIO[0]; facts.r2 = RATIO[1]; facts.r4 = RATIO[3]; facts.r6 = RATIO[5]; facts.r8 = RATIO[7]; facts.r10 = RATIO[9]; facts.r14 = RATIO[13];
facts.gain1014 = 100 * (RATIO[9] - RATIO[13]) / RATIO[9];

/* ───────────── 3. the Courtyard stream, the recurrent net ───────────── */
const S = DY.plainSets(), WP = S.w;
// the data generator does what the lesson says
{
  let en = 0, vn = 0, hid = 0, vis = 0, nn = 0, steps = 0, amin = 9, amax = 0, hidOK = true;
  for (let i = 0; i < 200; i++) {
    const ep = DY.episode(WP, 1000 + i);
    for (let t = 0; t <= ep.T; t++) { const z = ep.Z[t], st = ep.S[t], inC = st[0] > 2.6 && st[0] < 3.4; if (inC !== (z === null)) hidOK = false;
      if (z) { vis++; en += (z[0] - st[0]) ** 2 + (z[1] - st[1]) ** 2; vn += 2; } else hid++;
      if (t < ep.T) { steps++; if (ep.A[t]) { nn++; const m = Math.hypot(ep.A[t][0], ep.A[t][1]); amin = Math.min(amin, m); amax = Math.max(amax, m); } } }
  }
  ok('readings are hidden exactly while x is inside the curtain', hidOK);
  ok('sensor noise is 10 cm', close(Math.sqrt(en / vn), 0.1, 0.002), Math.sqrt(en / vn));
  ok('about 8 % of the logged steps carry a nudge, of size 0.5-2.5 m/s', close(nn / steps, 0.08, 0.01) && amin >= 0.5 - 1e-9 && amax <= 2.5 + 1e-9, [nn / steps, amin, amax]);
  ok('test and probe launches have no nudges', S.te.every(e => e.A.every(a => a === null)) && S.pb.every(e => e.A.every(a => a === null)));
  // the jolt: in free flight the velocity changes by friction only plus N(0, sv^2) (the logged nudge enters as v += a before the friction)
  let r2 = 0, nr = 0;
  for (let i = 0; i < 400; i++) { const ep = S.te[i]; for (let t = 0; t < ep.T; t++) { const a = ep.S[t], b = ep.S[t + 1]; if (DY.nearWall(WP, a) || DY.nearWall(WP, b)) continue; for (const c of [2, 3]) { const e = b[c] - dF * a[c]; r2 += e * e; nr++; } } }
  ok('velocity jolts have standard deviation 0.08 m/s', close(Math.sqrt(r2 / nr), SV, 0.003), Math.sqrt(r2 / nr));
}
ok('200 training episodes, 400 test launches, 200 probe launches', S.seqs.length === 200 && S.te.length === 400 && S.pb.length === 200);
ok('Adam with one episode per update, 10-epoch chunks (the schedule the lesson describes)', /batch: 1/.test(DY.train.toString()) && /epochs: 10/.test(DY.train.toString()));
const X4 = (z, a) => [z ? (z[0] - 4) / 4 : 0, z ? (z[1] - 2.5) / 4 : 0, z ? 1 : 0, a ? a[0] / 3 : 0, a ? a[1] / 3 : 0];
const runOwn = (net, ep) => { const r = net.run(ep.Z.slice(0, ep.T).map((z, t) => X4(z, ep.A[t]))); return { pred: r.ys.map(y => [y[0] * 4 + 4, y[1] * 4 + 2.5]), h: r.hs.slice(1) }; };
const wall = s => Math.min(s[0], 8 - s[0], s[1], 5 - s[1]) < 0.6;
const settledOwn = (ep, t) => { if (t < 9) return false; for (let u = t - 8; u <= t; u++) { if (!ep.Z[u] || ep.A[u] || wall(ep.S[u]) || wall(ep.S[Math.min(ep.T, u + 1)])) return false; } return true; };
const stateOwn = (ep, t) => { const s = ep.S[t], a = ep.A[t] || [0, 0]; return [s[0], s[1], s[2] + a[0], s[3] + a[1]]; };

// own scalar Kalman filter over an episode, per axis, known nudges; returns the prediction of the next reading, its claimed variance, and the posterior state after the reading
function kfOwn(ep) {
  const st = [null, null], pred = [], vr = [], post = [];
  for (let t = 0; t < ep.T; t++) {
    const z = ep.Z[t], a = ep.A[t] || [0, 0], pp = [], vv = [], ps = [0, 0, 0, 0];
    for (let ax = 0; ax < 2; ax++) {
      let k = st[ax];
      if (k === null) k = { x: [z ? z[ax] : (ax ? 2.5 : 0.5), 0], P: [z ? SO * SO : 1, 0, 9] };
      else if (z) { const S0 = k.P[0] + SO * SO, K0 = k.P[0] / S0, K1 = k.P[1] / S0, nu = z[ax] - k.x[0]; k = { x: [k.x[0] + K0 * nu, k.x[1] + K1 * nu], P: [k.P[0] - K0 * k.P[0], k.P[1] - K0 * k.P[1], k.P[2] - K1 * k.P[1]] }; }
      ps[ax] = k.x[0]; ps[2 + ax] = k.x[1] + a[ax];
      const x1 = k.x[1] + a[ax], a0 = k.P[0], b0 = k.P[1], c0 = k.P[2];
      const nx = { x: [k.x[0] + gF * x1, dF * x1], P: [a0 + 2 * gF * b0 + gF * gF * c0, dF * (b0 + gF * c0), dF * dF * c0 + SV * SV] };
      st[ax] = nx; pp.push(nx.x[0]); vv.push(nx.P[0] + SO * SO);
    }
    pred.push(pp); vr.push(vv); post.push(ps);
  }
  return { pred, vr, post };
}
const KF_TE = S.te.map(kfOwn);
function ownSettled(preds) {
  let s = 0, n = 0;
  S.te.forEach((ep, i) => { for (let t = 0; t < ep.T; t++) { const zn = ep.Z[t + 1]; if (!zn || !settledOwn(ep, t)) continue; const p = preds[i][t]; s += ((p[0] - zn[0]) ** 2 + (p[1] - zn[1]) ** 2) / 2; n++; } });
  return { mse: s / n, n };
}
{ const kf = ownSettled(KF_TE.map(k => k.pred)); facts.kf_r = kf.mse / SINF; ok('Kalman filter on settled steps is at the floor (1.0-1.05)', facts.kf_r > 0.99 && facts.kf_r < 1.05, facts.kf_r); facts.n_settled = kf.n; }
// the Kalman posterior error on settled steps against the Riccati posterior sd
{ let ep2 = 0, ev2 = 0, n = 0; S.te.forEach((ep, i) => { for (let t = 0; t < ep.T; t++) { if (!settledOwn(ep, t)) continue; const e = KF_TE[i].post[t], s = stateOwn(ep, t); ep2 += ((e[0] - s[0]) ** 2 + (e[1] - s[1]) ** 2) / 2; ev2 += ((e[2] - s[2]) ** 2 + (e[3] - s[3]) ** 2) / 2; n++; } });
  facts.kfp_pos = 100 * Math.sqrt(ep2 / n); facts.kfp_vel = Math.sqrt(ev2 / n);
  ok('Kalman posterior position error = Riccati sd (5 %)', rel(facts.kfp_pos, facts.post_pos_cm) < 0.05, [facts.kfp_pos, facts.post_pos_cm]);
  ok('Kalman posterior velocity error = Riccati sd (6 %)', rel(facts.kfp_vel, facts.post_vel) < 0.06, [facts.kfp_vel, facts.post_vel]); }

// the training schedule of the widget: five clicks of 60 epochs
const net = DY.newNet(7); let done = 0; const NETR = [];
ok('the recurrent net has 16 hidden units and 5 inputs', net.nHid === 16 && net.nIn === 5 && net.nOut === 2);
const probeOwn = (preds, feat) => {            // ridge from features to the state, fitted on the probe launches (t >= 3), lambda 1e-3; RMS errors on the settled test steps
  const rows = [], tg = []; S.pb.forEach(ep => { const r = runOwn(net, ep); for (let t = 3; t < ep.T; t++) { rows.push(feat(ep, r, t)); tg.push(stateOwn(ep, t)); } });
  const p = rows[0].length, W = [];
  for (let c = 0; c < 4; c++) { const A = new Array(p * p).fill(0), b = new Array(p).fill(0); rows.forEach((x, n) => { for (let i = 0; i < p; i++) { b[i] += x[i] * tg[n][c]; for (let j = 0; j < p; j++) A[i * p + j] += x[i] * x[j]; } }); for (let i = 0; i < p; i++) A[i * p + i] += 1e-3; W.push(solve(A, b, p)); }
  let sp = 0, sv = 0, n = 0;
  S.te.forEach((ep, i) => { for (let t = 0; t < ep.T; t++) { if (!settledOwn(ep, t)) continue; const x = feat(ep, preds[i], t), e = W.map(w => w.reduce((a, wi, k) => a + wi * x[k], 0)), s = stateOwn(ep, t); sp += ((e[0] - s[0]) ** 2 + (e[1] - s[1]) ** 2) / 2; sv += ((e[2] - s[2]) ** 2 + (e[3] - s[3]) ** 2) / 2; n++; } });
  return { pos: Math.sqrt(sp / n), vel: Math.sqrt(sv / n) };
};
const featH = (ep, r, t) => Array.from(r.h[t]).concat([1]), featZ = (ep, r, t) => { const z = ep.Z[t]; return [z ? z[0] : 0, z ? z[1] : 0, z ? 1 : 0, 1]; };
let LAST = null;
for (let c = 1; c <= 5; c++) {
  done = DY.train(net, S.seqs, done, 60);
  const runs = S.te.map(ep => runOwn(net, ep)), m = ownSettled(runs.map(r => r.pred)), rep = DY.plainReport(net, S, SINF);
  ok('engine run == own run (click ' + c + ')', S.te.every((ep, i) => { const e = DY.run(net, ep); return e.pred.every((p, t) => close(p[0], runs[i].pred[t][0], 1e-12) && close(p[1], runs[i].pred[t][1], 1e-12)); }));
  ok('settled error: own loops vs engine report (click ' + c + ')', close(m.mse / SINF, rep.ratio, 1e-9), [m.mse / SINF, rep.ratio]);
  NETR.push({ ratio: m.mse / SINF, ref: m.mse, rep, runs });
  facts['n' + c] = m.mse / SINF;
}
LAST = NETR[4];
ok('the net improves with training and ends within a factor 1.3 of the floor', NETR.every((r, i) => i === 0 || r.ratio < NETR[i - 1].ratio) && facts.n5 < 1.3 && facts.n5 > 1.0, NETR.map(r => r.ratio));
ok('the first 60 epochs leave it far from the floor', facts.n1 > 1.5, facts.n1);
facts.net_vs_kf = 100 * (facts.n5 / facts.kf_r - 1);
{ // probe
  const pH = probeOwn(LAST.runs, featH), pZ = probeOwn(LAST.runs, featZ), rep = LAST.rep;
  facts.pr_pos = 100 * pH.pos; facts.pr_vel = pH.vel; facts.pr0_pos = 100 * pZ.pos; facts.pr0_vel = pZ.vel;
  ok('probe from h: own normal equations vs engine', close(pH.pos, rep.probeH.pos, 1e-6) && close(pH.vel, rep.probeH.vel, 1e-6), [pH, rep.probeH]);
  ok('probe from the reading alone: own vs engine', close(pZ.pos, rep.probeZ.pos, 1e-6) && close(pZ.vel, rep.probeZ.vel, 1e-6), [pZ, rep.probeZ]);
  ok('the reading alone gives the sensor noise (10 cm) in position', close(pZ.pos, 0.1, 0.004), pZ.pos);
  ok('the hidden state beats the reading in position and velocity, and sits above the Kalman posterior', pH.pos < 0.8 * pZ.pos && pH.vel < 0.8 * pZ.vel && pH.pos > facts.kfp_pos / 100 && pH.vel > facts.kfp_vel, [pH, pZ]);
}
{ // clean crossings and the error after the curtain
  const cr = []; S.te.forEach((ep, i) => { let a0 = -1; for (let t = 1; t < ep.T; t++) if (!ep.Z[t] && ep.Z[t - 1]) { a0 = t; break; } if (a0 < 8) return; let b1 = a0; while (b1 < ep.T && !ep.Z[b1]) b1++; if (b1 - a0 < 2 || b1 - a0 > 5 || b1 + 6 >= ep.T) return; for (let u = a0 - 8; u <= b1 + 6; u++) if (ep.A[u] || ep.S[u][1] < 1 || ep.S[u][1] > 4) return; cr.push({ i, a0, b1 }); });
  facts.xn = cr.length;
  { const first = []; S.te.forEach(ep => { let a0 = -1; for (let t = 1; t < ep.T; t++) if (!ep.Z[t] && ep.Z[t - 1]) { a0 = t; break; } if (a0 < 0) return; let b1 = a0; while (b1 < ep.T && !ep.Z[b1]) b1++; first.push(b1 - a0); });
    first.sort((x, y) => x - y); facts.gap_med = first[Math.floor(first.length / 2)];
    ok('the curtain hides a median of 5 readings in a row', facts.gap_med === 5 && first.length === 400, [facts.gap_med, first.length]);
    ok('clean crossings have gaps of three to five steps', cr.every(c => c.b1 - c.a0 >= 3 && c.b1 - c.a0 <= 5)); } ok('clean crossings: own selection = engine selection', cr.length === S.cr.length && cr.every((c, k) => c.i === S.cr[k].i && c.b1 === S.cr[k].b1));
  const gap = (preds, K) => { const o = []; for (let k = 0; k <= K; k++) o.push(mean(cr.map(c => { const zn = S.te[c.i].Z[c.b1 + k], p = preds(c.i)[c.b1 - 1 + k]; return ((p[0] - zn[0]) ** 2 + (p[1] - zn[1]) ** 2) / 2; })) / SINF); return o; };
  const gn = gap(i => LAST.runs[i].pred, 5), gk = gap(i => KF_TE[i].pred, 5);
  const claim = mean(cr.map(c => (KF_TE[c.i].vr[c.b1 - 1][0] + KF_TE[c.i].vr[c.b1 - 1][1]) / 2)) / SINF;
  ok('error after the curtain: own loops vs engine (k = 0..5)', LAST.rep.gap.every((g, k) => close(g, gn[k], 1e-9)), [gn, LAST.rep.gap]);
  facts.gap0 = gn[0]; facts.gap2 = gn[2]; facts.gap3 = gn[3]; facts.kfgap0 = gk[0]; facts.kfclaim0 = claim;
  ok('the Kalman filter is calibrated at the curtain exit (claimed vs actual, 10 %)', rel(claim, gk[0]) < 0.10, [claim, gk[0]]);
  ok('the net errs most at the first reading after the gap, about twice the settled error, and has recovered by k = 3', gn[0] > 1.6 * facts.n5 && gn[3] < 1.3 * facts.n5 && gn[0] > gn[1], [gn, facts.n5]);
  ok('the net is within 40 % of the Kalman filter at the exit', gn[0] < 1.4 * gk[0], [gn[0], gk[0]]);
  facts.su_exit = gn[0] * SINF / NETR[4].ref;
  // window coverage
  const cov = m => { let h = 0, t_ = 0; S.te.forEach(ep => { for (let t = 0; t < ep.T; t++) { t_++; let o = t >= m - 1; for (let u = t - m + 1; o && u <= t; u++) if (!ep.Z[u]) o = false; if (o) h++; } }); return 100 * h / t_; };
  facts.cov1 = cov(1); facts.cov5 = cov(5); facts.cov14 = cov(14);
  ok('window coverage: own loops vs engine', [1, 5, 14].every(m => close(cov(m), 100 * DY.windowCoverage(S.te, m), 1e-9)));
  ok('longer windows have an answer at fewer steps', cov(1) > cov(2) && cov(2) > cov(5) && cov(5) > cov(10) && cov(10) > cov(14));
}
{ // the what-if question
  const t0 = 18, amp = 1.5; let n = 0; const proj = [[], [], [], [], []], err = [0, 0, 0, 0, 0], eff = [0, 0, 0, 0, 0];
  // the closed form against the simulator itself
  const wf0 = CY.world({ W: 1e3, H: 1e3, curtain: null }); let pa = CY.step(wf0, [5, 5, 1.2, 0.4], [0, 1.5]), pb = CY.step(wf0, [5, 5, 1.2, 0.4], null), worst = 0;
  for (let k = 1; k <= 5; k++) { const cf = gF * 1.5 * (1 - Math.pow(dF, k)) / (1 - dF); worst = Math.max(worst, Math.abs(pa[1] - pb[1] - cf), Math.abs(pa[0] - pb[0])); pa = CY.step(wf0, pa, null); pb = CY.step(wf0, pb, null); }
  ok('closed form g a (1 - d^k)/(1 - d) = simulator difference', worst < 1e-9, worst);
  facts.true3_cm = 100 * gF * amp * (1 - Math.pow(dF, 3)) / (1 - dF);
  S.te.forEach((ep, i) => {
    let good = true; for (let u = t0 - 4; u <= t0; u++) if (!ep.Z[u]) good = false;
    const s = ep.S[t0]; if (!good || wall(s) || s[1] < 1 || s[1] > 4 || Math.hypot(s[2], s[3]) < 0.5) return;
    const a = [0, (i % 2 ? 1 : -1) * amp], inputs = ep.Z.slice(0, t0).map((z, t) => X4(z, ep.A[t])), h0 = net.run(inputs).hs[t0];
    const free = nudge => { let h = h0, x = X4(ep.Z[t0], nudge), out = []; for (let k = 0; k < 5; k++) { const r = net.step(h, x); h = r.h; out.push([r.y[0] * 4 + 4, r.y[1] * 4 + 2.5]); x = [r.y[0], r.y[1], 1, 0, 0]; } return out; };
    const d1 = free(a), d0 = free(null);
    for (let k = 0; k < 5; k++) {
      const ef = gF * a[1] * (1 - Math.pow(dF, k + 1)) / (1 - dF), te = [0, ef], ne = [d1[k][0] - d0[k][0], d1[k][1] - d0[k][1]];
      proj[k].push((ne[0] * te[0] + ne[1] * te[1]) / (te[0] * te[0] + te[1] * te[1])); err[k] += Math.hypot(ne[0] - te[0], ne[1] - te[1]); eff[k] += Math.abs(ef);
    }
    n++;
  });
  const wi = DY.whatIfStats(net, S, LAST.runs, amp), ratio = proj.map(mean), spread = proj.map(p => { const m = mean(p); return Math.sqrt(mean(p.map(v => (v - m) ** 2))); });
  ok('what-if: own free-run vs engine (n, ratios, spread, relative error)', wi.n === n && ratio.every((r, k) => close(r, wi.ratio[k], 1e-9) && close(spread[k], wi.spread[k], 1e-9) && close(err[k] / eff[k], wi.rel[k], 1e-9)), [n, wi.n, ratio, wi.ratio]);
  facts.wi_n = n; facts.wi1 = ratio[0]; facts.wi3 = ratio[2]; facts.wi5 = ratio[4]; facts.wi_sp3 = spread[2]; facts.wi_rel3 = 100 * err[2] / eff[2];
  ok('what-if: the imagined effect is within 15 % of the true one on average at k = 1..5 and the launches scatter by less than 0.25', ratio.every(r => Math.abs(r - 1) < 0.15) && spread.every(s => s < 0.25), [ratio, spread]);
  ok('what-if: typical error of the effect below 25 % of its size', err.every((e, k) => e / eff[k] < 0.25), err.map((e, k) => e / eff[k]));
  // and the effect is a nudge-following one: with the nudge the imagined path really moves (not a constant): the sign follows the nudge
  ok('what-if: n is large enough to quote', n > 100, n);
}
{ // surprise after an unlogged push
  const ref = NETR[4].ref, ps = DY.pushStats(net, S, ref, 3, 6); let n = 0; const acc = [0, 0, 0, 0, 0, 0];
  const e0 = DY.episode(WP, 7000, { nudges: false }), e1 = DY.episode(WP, 7000, { nudges: false, hidden: { t: 22, a: [0, 3] } });
  ok('the unlogged push is not in the log but is felt by the world', e1.A.every(a => a === null) && close(e1.S[23][3] - e0.S[23][3], dF * 3, 1e-9) && close(e1.S[22][3], e0.S[22][3], 1e-12), [e1.S[23][3] - e0.S[23][3], dF * 3]);
  for (let i = 0; i < 400; i++) {
    const ep = DY.episode(WP, 7000 + i, { nudges: false, hidden: { t: 22, a: [0, (i % 2 ? 1 : -1) * 3] } });
    if (!settledOwn(ep, 21) || ep.S[22][1] < 1.5 || ep.S[22][1] > 3.5) continue;
    const r = runOwn(net, ep).pred;
    for (let k = 0; k < 6; k++) { const zn = ep.Z[22 + k + 1], p = r[22 + k]; acc[k] += (zn ? ((p[0] - zn[0]) ** 2 + (p[1] - zn[1]) ** 2) / 2 / ref : NaN); }
    n++;
  }
  // (the engine indexes the surprise by the step of the prediction; see DY.surprise: s[t] uses pred[t] against Z[t+1])
  const s = acc.map(v => v / n);
  ok('push surprise: own loops vs engine', n === ps.n && s.every((v, k) => close(v, ps.s[k], 1e-9)), [s, ps.s, n, ps.n]);
  facts.su0 = s[0]; facts.su1 = s[1]; facts.su2 = s[2]; facts.su3 = s[3]; facts.su5 = s[5]; facts.su_n = n;
  ok('surprise peaks within the first frames after the push and decays toward 1', s[1] > 2.5 && Math.max(s[0], s[1], s[2]) > 3 && s[5] < s[1] && s[5] > 0.9, s);
  ok('the curtain exit is a smaller surprise than the push', facts.su_exit > 1.5 && facts.su_exit < s[1], [facts.su_exit, s]);
  ok('push arrow geometry: a 3 m/s sideways push moves the ball 0.29 m in one step', close(gF * 3, 0.2948, 0.001), gF * 3);
}

/* ───────────── 4. the Kalman KL identity ───────────── */
{
  const inv2 = M => { const d = M[0] * M[3] - M[1] * M[2]; return [M[3] / d, -M[1] / d, -M[2] / d, M[0] / d]; };
  const mul2 = (A, B) => [A[0] * B[0] + A[1] * B[2], A[0] * B[1] + A[1] * B[3], A[2] * B[0] + A[3] * B[2], A[2] * B[1] + A[3] * B[3]];
  const det2 = M => M[0] * M[3] - M[1] * M[2];
  const klGauss = (m1, P1, m0, P0) => { const Pi = inv2(P0), M = mul2(Pi, P1), dm = [m0[0] - m1[0], m0[1] - m1[1]], q = dm[0] * (Pi[0] * dm[0] + Pi[1] * dm[1]) + dm[1] * (Pi[2] * dm[0] + Pi[3] * dm[1]); return 0.5 * (M[0] + M[3] - 2 + q + Math.log(det2(P0) / det2(P1))); };
  const r = xor32(77); let worst = 0;
  for (let n = 0; n < 200; n++) {
    const a = 0.002 + 0.02 * r(), c = 0.01 + 0.5 * r(), b = (2 * r() - 1) * 0.9 * Math.sqrt(a * c), R_ = 0.005 + 0.02 * r(), x0 = [gauss(r), gauss(r)], z = x0[0] + 3 * gauss(r) * Math.sqrt(a + R_);
    const P = [a, b, b, c], S_ = a + R_, nu = z - x0[0], K = [a / S_, b / S_], x1 = [x0[0] + K[0] * nu, x0[1] + K[1] * nu];
    const P1 = [a - a * a / S_, b - a * b / S_, b - a * b / S_, c - b * b / S_], kappa = a / S_;
    worst = Math.max(worst, Math.abs(klGauss(x1, P1, x0, P) - 0.5 * (kappa * (nu * nu / S_ - 1) - Math.log(1 - kappa))));
  }
  ok('KL(q||p) = 1/2 [kappa (nu^2/S - 1) - ln(1 - kappa)] against the general Gaussian KL (200 random cases)', worst < 1e-9, worst);
  facts.kappa = RIC.Pm[0] / SINF; facts.kl_ss = -0.5 * Math.log(1 - facts.kappa);
  // Monte Carlo of the steady-state expectation
  { const rr = xor32(5); let s_ = 0; const N = 200000; for (let i = 0; i < N; i++) { const nis = gauss(rr) ** 2; s_ += 0.5 * (facts.kappa * (nis - 1) - Math.log(1 - facts.kappa)) / N; } ok('E[KL] in the steady state = -1/2 ln(1 - kappa)', close(s_, facts.kl_ss, 0.003), [s_, facts.kl_ss]); }
  // the first reading after the curtain: prior doubt after a gap (no readings), averaged over the clean crossings' gap lengths; empirical KL along the crossings with the own filter
  const cr = S.cr; let klE = 0, nE = 0, klS = 0, nS = 0;
  cr.forEach(c => {
    const ep = S.te[c.i], k = kfOwn(ep);           // claimed variance of the reading at b1 and of settled readings
    const kap = (v, ax) => (v[ax] - SO * SO) / v[ax];
    for (let ax = 0; ax < 2; ax++) { const vclaim = k.vr[c.b1 - 1][ax], zn = ep.Z[c.b1][ax], nu = zn - k.pred[c.b1 - 1][ax], kp = kap(k.vr[c.b1 - 1], ax); klE += 0.5 * (kp * (nu * nu / vclaim - 1) - Math.log(1 - kp)); nE++; }
    for (let t = c.b1 + 3; t < c.b1 + 6; t++) for (let ax = 0; ax < 2; ax++) { const vclaim = k.vr[t - 1][ax], zn = ep.Z[t][ax], nu = zn - k.pred[t - 1][ax], kp = kap(k.vr[t - 1], ax); klS += 0.5 * (kp * (nu * nu / vclaim - 1) - Math.log(1 - kp)); nS++; }
  });
  facts.kl_exit = klE / nE; facts.kl_x = facts.kl_exit / facts.kl_ss;
  ok('KL at the first reading after the curtain is several times the steady one', facts.kl_x > 2 && facts.kl_x < 4.5, [facts.kl_exit, facts.kl_ss]);
  ok('KL three to five readings after the curtain is back near the steady value', close(klS / nS, facts.kl_ss, 0.06), [klS / nS, facts.kl_ss]);
}

/* ───────────── 5. the fork behind a wide curtain ───────────── */
const WF = CY.scenes.fork({ curtain: [0.6, 4.0], sigV: 0 }), TF = 32, VX = 2.4, AIM = 0.15;
ok('engine fork world = the wide-curtain fork', DY.FC[0] === 0.6 && DY.FC[1] === 4.0 && DY.FT === TF && DY.VX === VX && DY.AIM === AIM);
const emergeOwn = b => { let s = [0.5, 2.5 + b, VX, 0]; for (let t = 0; t <= TF; t++) { if (t > 14 && !(s[0] > 0.6 && s[0] < 4.0)) return { t, x: s[0], y: s[1] }; s = CY.step(WF, s, null); } return null; };
const GRID = []; for (let i = -450; i <= 450; i++) GRID.push(i / 1000);
const EM = GRID.map(emergeOwn), tabE = DY.forkTable(DY.forkWorld(DY.FC));
ok('own coming-out table = engine table', GRID.every((b, i) => (EM[i] === null) === (tabE[i].e === null) && (EM[i] === null || (EM[i].t === tabE[i].e.t && close(EM[i].x, tabE[i].e.x, 1e-12) && close(EM[i].y, tabE[i].e.y, 1e-12)))));
{ // structure of the map
  const first = side => { for (let i = 0; i < GRID.length; i++) { const b = GRID[i]; if (side * b > 0 && EM[i]) return Math.abs(b); } return NaN; };
  const bp = (() => { for (let i = 450; i < GRID.length; i++) if (EM[i]) return GRID[i]; })(), bn = (() => { for (let i = 449; i >= 0; i--) if (EM[i]) return -GRID[i]; })();
  facts.b_cm = 100 * (bp + bn) / 2; ok('the stall band is symmetric (within 1 mm) and a few cm wide', close(bp, bn, 0.002) && bp > 0.03 && bp < 0.06, [bp, bn]);
  ok('outside the band the ball comes out on the side it was aimed to', GRID.every((b, i) => !EM[i] || (EM[i].y > 2.5) === (b > 0)));
  ok('inside the band it never comes out within 32 steps', GRID.every((b, i) => Math.abs(b) >= Math.min(bp, bn) - 1e-9 || !EM[i]));
  let Z = 0, pe = 0, dy = 0, tmin = 99, tmax = 0; GRID.forEach((b, i) => { const w = Math.exp(-0.5 * (b / AIM) ** 2); Z += w; if (EM[i]) { pe += w; dy += w * Math.abs(EM[i].y - 2.5); tmin = Math.min(tmin, EM[i].t); tmax = Math.max(tmax, EM[i].t); } });
  facts.emerge = 100 * pe / Z; facts.b_dy = dy / pe; facts.t_min = tmin; facts.t_max = tmax;
  let ne = 0; for (let i = 0; i < 400; i++) { const ep = DY.forkEpisode(DY.forkWorld(DY.FC), 8000 + i); if (DY.forkEmergence(ep) > 0) ne++; }
  ok('empirical share of launches that come out (400 test launches) matches the quadrature (3 points)', close(100 * ne / 400, facts.emerge, 3), [100 * ne / 400, facts.emerge]);
  ok('the world is deterministic given b: same launch twice gives the same ending', (() => { const a = emergeOwn(0.0731), b2 = emergeOwn(0.0731); return a.t === b2.t && a.y === b2.y; })());
  ok('the fork world has no velocity jolts (the jolts of sections 1-5 are switched off)', WF.sigV === 0 && DY.forkWorld(DY.FC).sigV === 0 && CY.world({}).sigV === 0 && CY.world({ sigV: SV }).sigV === SV, [WF.sigV, DY.forkWorld(DY.FC).sigV]);
  // "a closer one hangs on the vertex, the longer the closer it is": the coming-out step falls as the aim error grows, from the edge of the band out to 20 cm
  { let mono = true, prev = 99; for (let i = 0; i < GRID.length; i++) { const b = GRID[i]; if (b < bp - 1e-9 || b > 0.2) continue; if (!EM[i]) { mono = false; break; } if (EM[i].t > prev) mono = false; prev = EM[i].t; }
    ok('the closer to the vertex, the later the ball comes out (non-increasing in b from the edge to 20 cm)', mono);
    // the edge depends on the clock: wait 8 steps longer and balls aimed closer have come out too (here the stream is 32 steps; lesson 5 reads the same edge off the ball at 4 s)
    const edgeAt = T => { for (let i = 450; i < GRID.length; i++) { const b = GRID[i]; let s = [0.5, 2.5 + b, VX, 0], out = false; for (let t = 0; t <= T; t++) { if (t > 14 && !(s[0] > 0.6 && s[0] < 4.0)) { out = true; break; } s = CY.step(WF, s, null); } if (out) return b; } return NaN; };
    facts.edge_t32_cm = 100 * edgeAt(32); facts.edge_t40_cm = 100 * edgeAt(40);
    ok('the edge of the hanging band moves in as the clock runs (3.2 s -> 4.0 s)', facts.edge_t40_cm < facts.edge_t32_cm - 0.2, [facts.edge_t32_cm, facts.edge_t40_cm]);
    // lesson 5's reading of the same edge: the first aim whose ball is more than 1 m from the centre line after 4 s (same physics, a 1 mm grid)
    let e5 = NaN; for (let i = 450; i < GRID.length; i++) { let s = [0.5, 2.5 + GRID[i], VX, 0]; for (let t = 0; t < 40; t++) s = CY.step(WF, s, null); if (Math.abs(s[1] - 2.5) > 1.0) { e5 = GRID[i]; break; } }
    facts.edge_lesson5_cm = 100 * e5;
    ok('under both clocks the edge is about 4 cm (4.4 cm at 3.2 s here, the next lesson reads 4.3 cm off the position at 4 s)', Math.abs(facts.b_cm - 4.4) < 0.06 && Math.abs(facts.edge_lesson5_cm - 4.3) < 0.06, [facts.b_cm, facts.edge_lesson5_cm]);
  }
}
// the posterior of the aim error after one reading
const PREC = 1 / (AIM * AIM) + 1 / (SO * SO), PSTD = Math.sqrt(1 / PREC), PGAIN = (1 / (SO * SO)) / PREC;
facts.post_cm = 100 * PSTD; facts.post_gain = PGAIN;
{ const r = xor32(40); let n = 0, s = 0, s2 = 0; for (let i = 0; i < 2000000; i++) { const b = AIM * gauss(r), z = b + SO * gauss(r); if (Math.abs(z - 0.1) < 0.01) { n++; s += b; s2 += b * b; } }
  ok('posterior mean (z\' = 0.1) by thin-slice Monte Carlo', close(s / n, PGAIN * 0.1, 0.004), [s / n, PGAIN * 0.1]); ok('posterior std by Monte Carlo', close(Math.sqrt(s2 / n - (s / n) ** 2), PSTD, 0.004)); }
// the exact conditional mean and variance of the coming-out reading at step ts (readings include the sensor noise), by quadrature over b
function condOwn(zp, ts) {
  const mu = PGAIN * zp; let Z = 0, mx = 0, my = 0, mxx = 0, myy = 0;
  GRID.forEach((b, i) => { const e = EM[i]; if (!e || e.t !== ts) return; const w = Math.exp(-0.5 * ((b - mu) / PSTD) ** 2); Z += w; mx += w * e.x; my += w * e.y; mxx += w * e.x * e.x; myy += w * e.y * e.y; });
  if (!Z) return null; mx /= Z; my /= Z; return { mx, my, vx: mxx / Z - mx * mx + SO * SO, vy: myy / Z - my * my + SO * SO };
}
const FW_ = DY.forkWorld(DY.FC), ftr = [], fte = []; for (let i = 0; i < 240; i++) ftr.push(DY.forkEpisode(FW_, 2000 + i)); for (let i = 0; i < 400; i++) fte.push(DY.forkEpisode(FW_, 8000 + i));
ok('fork launches: one reading at the launcher, none behind the curtain, readings again after the post', fte.every(ep => ep.Z[0] && !ep.Z[1] && !ep.Z[14]));
const fnet = DY.newNet(7), fseq = ftr.map(DY.seq); let fdone = 0; const FST = [];
const emergeStep = ep => { for (let t = 15; t <= ep.T; t++) if (ep.Z[t] && !ep.Z[t - 1]) return t; return -1; };
function forkEval() {
  let em = 0, irr = 0, dev = 0, n = 0, els = 0, ne = 0, aem = 0, airr = 0, an = 0;
  fte.forEach(ep => {
    const r = runOwn(fnet, ep), te = emergeStep(ep);
    for (let t = 0; t < ep.T; t++) {
      const zn = ep.Z[t + 1]; if (!zn) continue; const p = r.pred[t], e = ((p[0] - zn[0]) ** 2 + (p[1] - zn[1]) ** 2) / 2;
      if (t + 1 !== te) { els += e; ne++; continue; }
      const c = condOwn(ep.Z[0][1] - 2.5, te); if (!c) continue;
      em += e; irr += (c.vx + c.vy) / 2; dev += ((p[0] - c.mx) ** 2 + (p[1] - c.my) ** 2) / 2; n++;
      if (Math.abs(ep.Z[0][1] - 2.5) < 0.05) { aem += e; airr += (c.vx + c.vy) / 2; an++; }
    }
  });
  return { n, em: em / n, irr: irr / n, els: els / ne, dev: Math.sqrt(dev / n), an, aem: aem / an, airr: airr / an };
}
{ // the exact conditional-mean predictor scored on the same launches and frames: what ANY predictor would have scored on this sample
  let ex = 0, n = 0; fte.forEach(ep => { const te = emergeStep(ep); if (te < 0) return; const c = condOwn(ep.Z[0][1] - 2.5, te); if (!c) return; const zn = ep.Z[te]; ex += ((c.mx - zn[0]) ** 2 + (c.my - zn[1]) ** 2) / 2; n++; });
  facts.fk_exact = ex / n; facts.fk_n_exact = n;
}
for (let c = 1; c <= 5; c++) {
  fdone = DY.train(fnet, fseq, fdone, 60); const mine = forkEval(), eng = DY.forkStats(fnet, tabE, fte);
  ok('fork stats: own loops vs engine (click ' + c + ')', mine.n === eng.n && mine.an === eng.an && ['em', 'irr', 'els', 'dev', 'aem', 'airr'].every(k => close(mine[k], eng[k], 1e-9)), [mine, eng]);
  FST.push(mine);
}
{ const F = FST[4]; facts.fk_em = F.em; facts.fk_irr = F.irr; facts.fk_els = F.els; facts.fk_dev = 100 * F.dev; facts.fk_an = F.an; facts.fk_aem = F.aem; facts.fk_airr = F.airr; facts.fk_els_x = F.els / (SO * SO); facts.fk_ratio = F.em / F.els; facts.fk_aratio = F.aem / F.els; facts.fk_n = F.n;
  ok('fork: the error at the coming-out frame falls with training', FST.every((f, i) => i === 0 || f.em < FST[i - 1].em + 0.002), FST.map(f => f.em));
  ok('fork: the network reaches the attainable error at that frame (within 15 %, sampling noise may put it a little under)', F.em > 0.85 * F.irr && F.em < 1.15 * F.irr, [F.em, F.irr]);
  ok('fork: it sits within 12 cm of the exact conditional mean there', F.dev < 0.12, F.dev);
  ok('fork: the exact predictor scores about the same as the network on this sample (sampling noise), and the expected attainable error is within 10 % of it', Math.abs(F.em - facts.fk_exact) < 0.006 && Math.abs(F.irr - facts.fk_exact) / F.irr < 0.1, [F.em, F.irr, facts.fk_exact]);
  ok('fork: elsewhere it is near the sensor floor (deterministic world) and the fork frame is several times worse', F.els < 0.02 && F.els > SO * SO * 0.9 && F.em > 3 * F.els, [F.els, F.em]);
  ok('fork: for launches whose reading is on the centre line the gap is an order of magnitude', F.aem > 8 * F.els && F.aem > 0.9 * F.airr && F.aem < 1.25 * F.airr, [F.aem, F.airr, F.els]);
  ok('fork: the best attainable error is above the floor of a deterministic world by the branch spread', F.irr > 3 * SO * SO, F.irr); }
// canonical streams: one reading z' then darkness
const E = []; { const er = CY.rng(11); for (let i = 0; i < 300; i++) E.push(CY.randn(er)); }
function caseOwn(zp, withNet) {
  const mu = PGAIN * zp, cl = []; E.forEach(e => { const o = emergeOwn(mu + PSTD * e); if (o) cl.push(o); });
  const cnt = {}; cl.forEach(o => { cnt[o.t] = (cnt[o.t] || 0) + 1; }); let ts = 0; Object.keys(cnt).forEach(k => { if (!ts || cnt[k] > cnt[ts] || (cnt[k] === cnt[ts] && +k < ts)) ts = +k; });
  const out = { n: cl.length, ts, c: condOwn(zp, ts) };
  if (withNet) { const Z = [[0.5, 2.5 + zp]]; for (let t = 1; t <= TF; t++) Z.push(null); const ep = { Z, A: Z.map(() => null), T: TF }, p = runOwn(fnet, ep).pred[ts - 1]; out.pred = p; out.depth = 0.6 - Math.abs(p[0] - 4.4) - Math.abs(p[1] - 2.5); out.near = cl.filter(o => Math.hypot(o.x - p[0], o.y - p[1]) < 0.3).length / cl.length; out.up = cl.filter(o => o.y > 2.5).length / cl.length; }
  return out;
}
const CASE = {}; [-0.2, -0.1, 0, 0.1, 0.2].forEach(zp => { CASE[zp] = caseOwn(zp, true); const eng = DY.forkCase(FW_, tabE, fnet, zp, E); ok('fork case z\' = ' + zp + ': own vs engine', eng.ts === CASE[zp].ts && close(eng.depth, CASE[zp].depth, 1e-9) && close(eng.near, CASE[zp].near, 1e-12) && close(eng.cloud.length, CASE[zp].n, 0), [eng.ts, CASE[zp].ts]); });
{ const c0 = CASE[0];
  facts.fk_x = c0.pred[0]; facts.fk_y = c0.pred[1]; facts.fk_depth = 100 * c0.depth; facts.fk_near0 = 100 * c0.near; facts.fk_near10 = 100 * CASE[0.1].near; facts.fk_near10m = 100 * CASE[-0.1].near; facts.fk_p_up0 = c0.up;
  ok('canonical case: the exact answer is the middle of the post\'s right half and the net agrees with it (within 0.1 m)', c0.c && Math.hypot(c0.pred[0] - c0.c.mx, c0.pred[1] - c0.c.my) < 0.1 && close(c0.c.my, 2.5, 0.05), [c0.pred, c0.c]);
  ok('canonical case: the answer is inside the diamond (|x - 4.4| + |y - 2.5| < 0.6)', Math.abs(c0.pred[0] - 4.4) + Math.abs(c0.pred[1] - 2.5) < 0.6 && c0.depth > 0.1, [c0.pred, c0.depth]);
  ok('canonical case: the real outcomes are two branches and none is within 0.3 m of the answer', close(c0.up, 0.5, 0.1) && c0.near === 0, [c0.up, c0.near]);
  ok('where the reading decides (z\' = +-10 cm) the network picks a side and most real outcomes are within 0.3 m of its answer', CASE[0.1].pred[1] > 2.6 && CASE[-0.1].pred[1] < 2.4 && CASE[0.1].near > 0.7 && CASE[-0.1].near > 0.7, [CASE[0.1].pred, CASE[-0.1].pred, CASE[0.1].near, CASE[-0.1].near]);
  ok('and for z\' = +-20 cm even more so', CASE[0.2].near > 0.9 && CASE[-0.2].near > 0.9);
  ok('the depth claim: the answer for z\' = 0 is far deeper in the post than at the decided readings', c0.depth > CASE[0.1].depth + 0.1);
  facts.fk_branch_gap = 100 * 0.5; }
// other initialisations of both networks (same data, same schedule): the spread behind the single-run numbers the lesson quotes (engine evaluators, checked above against own loops)
{
  const R_ = { n5: [facts.n5], gap0: [facts.gap0], wi3: [facts.wi3], depth: [facts.fk_depth], near0: [facts.fk_near0], em: [FST[4].em] };
  [11, 19, 23].forEach(sd => {
    const nn = DY.newNet(sd); DY.train(nn, S.seqs, 0, 300); const rp = DY.plainReport(nn, S, SINF), wi = DY.whatIfStats(nn, S, rp.runs, 1.5);
    const fn = DY.newNet(sd); DY.train(fn, fseq, 0, 300); const c0 = DY.forkCase(FW_, tabE, fn, 0, E), st = DY.forkStats(fn, tabE, fte);
    R_.n5.push(rp.ratio); R_.gap0.push(rp.gap[0]); R_.wi3.push(wi.ratio[2]); R_.depth.push(100 * c0.depth); R_.near0.push(100 * c0.near); R_.em.push(st.em);
  });
  const lo = a => Math.min.apply(null, a), hi = a => Math.max.apply(null, a);
  facts.rng_n5_lo = lo(R_.n5); facts.rng_n5_hi = hi(R_.n5); facts.rng_gap0_lo = lo(R_.gap0); facts.rng_gap0_hi = hi(R_.gap0); facts.rng_wi3_lo = lo(R_.wi3); facts.rng_wi3_hi = hi(R_.wi3); facts.rng_depth_lo = lo(R_.depth); facts.rng_depth_hi = hi(R_.depth); facts.rng_near0_hi = hi(R_.near0);
  ok('four initialisations: the free-flight ratio ends between 1.15 and 1.4 times the floor', facts.rng_n5_lo > 1.15 && facts.rng_n5_hi < 1.4, R_.n5);
  ok('four initialisations: the curtain exit is always the worst step (above the free-flight ratio)', R_.gap0.every((g, i) => g > R_.n5[i]), [R_.gap0, R_.n5]);
  ok('four initialisations: the imagined nudge effect at k = 3 is within 15 % of the true one', R_.wi3.every(v => Math.abs(v - 1) < 0.15), R_.wi3);
  ok('four initialisations: the fork answer at z\' = 0 is inside the post and under 1 % of the real outcomes are within 0.3 m of it', R_.depth.every(d => d > 10) && R_.near0.every(v => v < 1), [R_.depth, R_.near0]);
  ok('four initialisations: the fork error at the coming-out frame is within 15 % of the attainable error', R_.em.every(e => e > 0.85 * FST[4].irr && e < 1.15 * FST[4].irr), R_.em);
}
// the checkpoint
{ const K = 0.3, h = []; let x = 0; for (let t = 0; t < 200; t++) { const z = t === 0 ? 1 : 0; x = x + K * (z - x); h.push(x); }          // random-walk filter: prediction of the next reading is x
  ok('checkpoint weights K (1 - K)^j by running the scalar filter on an impulse', h.slice(0, 10).every((v, j) => close(v, K * Math.pow(1 - K, j), 1e-12)) && close(sum(h), 1, 1e-9));
  facts.ck_w0 = h[0]; facts.ck_w1 = h[1]; facts.ck_w2 = h[2];
  const tail = m => sum(h.slice(m)); facts.ck_tail8 = tail(8); facts.ck_tail9 = tail(9);
  let m95 = 0; while (tail(m95) > 0.05) m95++; facts.ck_m = m95;
  ok('checkpoint: weight beyond m readings is (1 - K)^m, below 5 % first at m = 9', close(tail(8), Math.pow(0.7, 8), 1e-9) && close(tail(9), Math.pow(0.7, 9), 1e-9) && tail(8) > 0.05 && tail(9) < 0.05 && m95 === 9); }

/* ───────────── 6. drive the page's widget ───────────── */
const PAGE = path.join(DIR, '04_learning_latent_dynamics.html'), HAVE_PAGE = fs.existsSync(PAGE);
ok('the lesson page exists', HAVE_PAGE);
const page = HAVE_PAGE ? loadPage(PAGE, { dpr: 1 }) : { problems: [], set() { }, num() { return NaN; }, text() { return ''; }, click() { } };
ok('page loads cleanly', page.problems.length === 0, page.problems.join(' | '));
const nums = id => (page.text(id).replace(/−/g, '-').match(/-?\d+(?:\.\d+)?/g) || []).map(Number);
if (HAVE_PAGE) {
  page.set('w04-mode', 'cross');
  for (const m of [1, 4, 8, 14]) {
    page.set('w04-m', m);
    ok('widget: window error, m = ' + m, close(page.num('w04-mse'), RATIO[m - 1], 0.0051), [page.num('w04-mse'), RATIO[m - 1]]);
    ok('widget: weights vs filter, m = ' + m, close(page.num('w04-wd'), L.rel[m - 1], 0.0005), [page.num('w04-wd'), L.rel[m - 1]]);
    ok('widget: steps with a full window, m = ' + m, close(page.num('w04-cov'), m === 1 ? facts.cov1 : m === 14 ? facts.cov14 : 100 * DY.windowCoverage(S.te, m), 0.051));
  }
  page.set('w04-m', 5); ok('widget: coverage, m = 5', close(page.num('w04-cov'), facts.cov5, 0.051));
  ok('widget: floor', close(nums('w04-floor')[0], SINF, 0.00005) && close(nums('w04-floor')[1], facts.sinf_cm, 0.051), nums('w04-floor'));
  ok('widget: untrained net says so and the probe is empty', /untrained/.test(page.text('w04-rnn')) && !/\d/.test(page.text('w04-probe')));
  const prb = LAST.rep;
  for (let c = 1; c <= 5; c++) {
    page.click('w04-train');
    ok('widget: recurrent net error after click ' + c, close(nums('w04-rnn')[0], facts['n' + c], 0.0051) && nums('w04-rnn')[1] === 60 * c, [nums('w04-rnn'), facts['n' + c]]);
  }
  ok('widget: probe from h (position cm, velocity m/s)', close(nums('w04-probe')[0], facts.pr_pos, 0.051) && close(nums('w04-probe')[1], facts.pr_vel, 0.0051), [nums('w04-probe'), facts.pr_pos, facts.pr_vel]);
  ok('widget: error after the curtain, k = 0 and k = 3', close(nums('w04-gap')[0], facts.gap0, 0.0051) && close(nums('w04-gap')[1], facts.gap3, 0.0051), [nums('w04-gap'), facts.gap0, facts.gap3]);
  void prb;
  page.set('w04-mode', 'nudge'); page.set('w04-s', 15);
  ok('widget: nudge effect ratio at k = 1, 3, 5', close(nums('w04-what')[0], facts.wi1, 0.0051) && close(nums('w04-what')[1], facts.wi3, 0.0051) && close(nums('w04-what')[2], facts.wi5, 0.0051), [nums('w04-what'), facts.wi1, facts.wi3, facts.wi5]);
  page.set('w04-s', 0); ok('widget: a zero nudge has no ratio', !/\d/.test(page.text('w04-what')));
  page.set('w04-mode', 'push'); page.set('w04-s', 30);
  ok('widget: surprise at frames 0-3 after a 3 m/s push', [facts.su0, facts.su1, facts.su2, facts.su3].every((v, k) => close(nums('w04-sur')[k], v, 0.051)), [nums('w04-sur'), facts.su0, facts.su1, facts.su2, facts.su3]);
  page.set('w04-mode', 'fork'); page.set('w04-s', 0);
  ok('widget: fork readouts empty before the fork net is trained', !/\d/.test(page.text('w04-fk')) && !/\d/.test(page.text('w04-depth')));
  for (let c = 1; c <= 5; c++) page.click('w04-ftrain');
  ok('widget: fork error at the coming-out frame, elsewhere, best possible', close(nums('w04-fk')[0], facts.fk_em, 0.00051) && close(nums('w04-fk')[1], facts.fk_els, 0.00051) && close(nums('w04-fk')[2], facts.fk_irr, 0.00051), [nums('w04-fk'), facts.fk_em, facts.fk_els, facts.fk_irr]);
  ok('widget: depth inside the diamond and the share within 0.3 m at z\' = 0', close(page.num('w04-depth'), facts.fk_depth, 0.51) && close(page.num('w04-near'), facts.fk_near0, 0.51), [page.num('w04-depth'), facts.fk_depth, page.num('w04-near'), facts.fk_near0]);
  page.set('w04-s', 10); ok('widget: share within 0.3 m at z\' = +10 cm', close(page.num('w04-near'), facts.fk_near10, 0.51), [page.num('w04-near'), facts.fk_near10]);
  page.set('w04-s', -10); ok('widget: share within 0.3 m at z\' = -10 cm', close(page.num('w04-near'), facts.fk_near10m, 0.51));
  // a narrow canvas must draw without errors too
  page.el('w04-canvas').clientWidth = 375; page.set('w04-m', 9); page.set('w04-mode', 'cross'); page.set('w04-mode', 'fork');
}
ok('widget ran without errors', page.problems.length === 0, page.problems.join(' | '));
console.error(fails ? `${fails} check(s) FAILED` : 'all checks passed');
console.log(JSON.stringify({ facts }));
process.exit(fails ? 1 : 0);
