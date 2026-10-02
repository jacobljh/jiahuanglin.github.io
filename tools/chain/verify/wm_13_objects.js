#!/usr/bin/env node
/* Oracle for World Models lesson 13, "Things: a world made of objects".
 *
 * The experiment: the SOFT COURTYARD (private engine l13_things.js): N identical unit-mass balls with a soft shell (contact force k * overlap^2 along the line of centres,
 * conservative), friction as in the Courtyard, soft walls.  Two models learn the RESIDUAL beyond the exact one-ball model: a flat net that reads a receiver's senders side by side
 * (index order) and a pairwise rule phi that reads one sender at a time and is summed.  Both train on 800 scenes x 5 steps of N = 3 balls.
 *
 * Independent checks (not the widget's code path):
 *   world      energy and momentum of a contact, the exchange of velocities in a head-on collision of equal masses, free flight in closed form, and the whole step against an RK4
 *              integration of the same differential equations at a 100 times finer step; additivity of pair effects (a three-ball step against the sum of two-ball steps);
 *   machinery  the network's analytic gradient against finite differences; the pairwise prediction against an explicit double loop; equivariance under random relabellings (exact for
 *              the pairwise rule, large for the flat net); parameter counts against their formulas; the exam metric against a per-scene loop;
 *   binding    an independent re-implementation of the curtain trial (same random stream), the Kalman belief against the shared engine's CY.kf, the three assignment rules, the
 *              identity accuracies; map accuracy = bounce share and free-flight accuracy = pass share (the law of the lesson);
 *   exit       video of nudged balls: the share of the error that is the nudges, the what-if error with and without labels; the arithmetic of labelled hours and of the sampling bill;
 *   widget     the page's own widget is driven (six clicks of each train button, N = 2..10, the who-is-who view at three offsets, reset) and its readouts are compared.
 * Prints {"facts": {...}} as its last line.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '../../../all_lessons');
const DIR = fs.existsSync(path.join(ROOT, 'world_models_new')) ? path.join(ROOT, 'world_models_new') : path.join(ROOT, 'world_models');
const CY = require(path.join(DIR, 'courtyard.js'));
const L13 = require(path.join(DIR, 'l13_things.js'));
const { loadPage } = require('../dom_probe.js');

let fails = 0;
const facts = {};
function ok(name, cond, extra) { if (!cond) { fails++; console.error('FAIL', name, extra === undefined ? '' : JSON.stringify(extra)); } }
const close = (a, b, tol) => Math.abs(a - b) <= (tol === undefined ? 1e-9 : tol);
const T0 = process.hrtime.bigint(); const lap = (s) => console.error('  [' + (Number(process.hrtime.bigint() - T0) / 1e9).toFixed(1) + ' s] ' + s);   // progress on stderr only

/* ───────────────────────── 1 · the world ───────────────────────── */
const GAMMA = 0.35, DT = 0.1, RHO = 0.25, KB = 300, KW = 600, W = 8, H = 5;
ok('engine constants are the ones the page states', L13.GAMMA === GAMMA && L13.DT === DT && L13.RHO === RHO && L13.KB === KB && L13.KW === KW && L13.W === W && L13.H === H);
facts.fric_pct = 100 * (1 - Math.exp(-GAMMA * DT));                                   // velocity lost per step (3.4 %, the Courtyard's)
facts.contact_range = 2 * RHO;                                                        // m
facts.shell = RHO;

{ // 1a. energy: kinetic + contact energy of a head-on pair with friction off, away from the walls
  let S = Float64Array.from([3, 2.5, 1, 0, 5, 2.5, -1, 0]);
  const E0 = L13.energy(S, 2); let dmin = 9, Emid = 0;
  for (let t = 0; t < 40; t++) { S = L13.step(S, 2, { gamma: 0 }); Emid = Math.max(Emid, Math.abs(L13.energy(S, 2) - E0) / E0); const d = Math.hypot(S[0] - S[4], S[1] - S[5]); if (d < dmin) dmin = d; }
  const Eend = Math.abs(L13.energy(S, 2) - E0) / E0;
  facts.energy_end_pct = 100 * Eend; facts.energy_mid_pct = 100 * Emid; facts.head_on_min_sep = dmin;
  ok('contact is elastic: after the encounter the energy is back within 0.001 % of its value before', Eend < 1e-5, Eend);
  ok('and during it the discrete energy wobbles by no more than 3 %', Emid < 0.03, Emid);
  // equal masses, head on: the velocities are exchanged (the balls bounce back with each other's velocity)
  ok('head-on, equal masses: velocities are exchanged', close(S[2], -1, 2e-3) && close(S[6], 1, 2e-3) && Math.abs(S[3]) < 1e-9 && Math.abs(S[7]) < 1e-9, Array.from(S));
  facts.exchange_err = Math.max(Math.abs(S[2] + 1), Math.abs(S[6] - 1));
  // contact lasts a few steps: count the steps in which the shells overlap
  let S2 = Float64Array.from([3, 2.5, 1, 0, 5, 2.5, -1, 0]), nov = 0;
  for (let t = 0; t < 40; t++) { S2 = L13.step(S2, 2, { gamma: 0 }); if (Math.hypot(S2[0] - S2[4], S2[1] - S2[5]) < 2 * RHO) nov++; }
  facts.contact_steps = nov;
  ok('a contact lasts two to three steps at a relative speed of 2 m/s', nov >= 2 && nov <= 3, nov);
}
{ // 1b. momentum of an off-centre contact (no walls reached, friction off)
  let S = Float64Array.from([3, 2.5, 1.2, 0, 5, 2.8, -0.8, 0]); const m0 = [S[2] + S[6], S[3] + S[7]];
  for (let t = 0; t < 30; t++) S = L13.step(S, 2, { gamma: 0 });
  ok('momentum of a contact is conserved', close(S[2] + S[6], m0[0], 1e-9) && close(S[3] + S[7], m0[1], 1e-9), [S[2] + S[6], S[3] + S[7], m0]);
}
{ // 1c. free flight in closed form (far from walls): position += v (1 - d)/gamma, v *= d
  const d = Math.exp(-GAMMA * DT), g = (1 - d) / GAMMA; let S = Float64Array.from([3.5, 2.5, 0.7, -0.4]), x = 3.5, y = 2.5, vx = 0.7, vy = -0.4, worst = 0;
  for (let t = 0; t < 10; t++) { S = L13.stepAlone(S, 1); x += g * vx; y += g * vy; vx *= d; vy *= d; worst = Math.max(worst, Math.abs(S[0] - x), Math.abs(S[1] - y), Math.abs(S[2] - vx), Math.abs(S[3] - vy)); }
  ok('one ball in free flight follows the closed form', worst < 1e-12, worst); facts.free_flight_err = worst;
}
{ // 1d. the whole step against RK4 on the same differential equations at 1/100 of the step (walls, contact and friction)
  const acc = (S, N) => { const a = new Float64Array(2 * N);
    for (let i = 0; i < N; i++) { const x = S[4 * i], y = S[4 * i + 1]; let ax = 0, ay = 0, o;
      o = RHO - x; if (o > 0) ax += KW * o * o; o = RHO - (W - x); if (o > 0) ax -= KW * o * o; o = RHO - y; if (o > 0) ay += KW * o * o; o = RHO - (H - y); if (o > 0) ay -= KW * o * o;
      for (let j = 0; j < N; j++) if (j !== i) { const dx = x - S[4 * j], dy = y - S[4 * j + 1], r = Math.hypot(dx, dy); if (r < 2 * RHO && r > 1e-12) { const ov = 2 * RHO - r; ax += KB * ov * ov * dx / r; ay += KB * ov * ov * dy / r; } }
      a[2 * i] = ax; a[2 * i + 1] = ay; }
    return a; };
  const deriv = (S, N) => { const a = acc(S, N), D = new Float64Array(4 * N); for (let i = 0; i < N; i++) { D[4 * i] = S[4 * i + 2]; D[4 * i + 1] = S[4 * i + 3]; D[4 * i + 2] = a[2 * i] - GAMMA * S[4 * i + 2]; D[4 * i + 3] = a[2 * i + 1] - GAMMA * S[4 * i + 3]; } return D; };
  const rk4 = (S, N, h, n) => { let s = Float64Array.from(S); for (let k = 0; k < n; k++) { const add = (a, b, f) => a.map((v, i) => v + f * b[i]); const k1 = deriv(s, N), k2 = deriv(add(s, k1, h / 2), N), k3 = deriv(add(s, k2, h / 2), N), k4 = deriv(add(s, k3, h), N); s = s.map((v, i) => v + h / 6 * (k1[i] + 2 * k2[i] + 2 * k3[i] + k4[i])); } return s; };
  let worst = 0, worstV = 0;
  for (let q = 0; q < 6; q++) { const N = 3, S0 = L13.scene(N, CY.rng(500 + q), L13.WIN); let a = S0, b = S0;
    for (let t = 0; t < 10; t++) { a = L13.step(a, N); b = rk4(b, N, 0.001, 100); }
    for (let i = 0; i < N; i++) { worst = Math.max(worst, Math.hypot(a[4 * i] - b[4 * i], a[4 * i + 1] - b[4 * i + 1])); worstV = Math.max(worstV, Math.hypot(a[4 * i + 2] - b[4 * i + 2], a[4 * i + 3] - b[4 * i + 3])); } }
  facts.rk4_pos_cm = 100 * worst; facts.rk4_vel_cms = 100 * worstV;
  ok('the engine step agrees with RK4 on the same equations (position to 8 mm over 1 s, velocity to 1 cm/s)', worst < 8e-3 && worstV < 1e-2, [worst, worstV]);
}
{ // 1e. the pair effects add: a three-ball step against the sum of the effects of the two-ball steps
  for (const N of [3, 5, 8]) {
    const rng = CY.rng(21); let sRes = 0, sGap = 0, n = 0;
    for (let q = 0; q < 300; q++) { let s = L13.scene(N, rng, L13.WIN);
      for (let t = 0; t < 10; t++) { const ns = L13.step(s, N), al = L13.stepAlone(s, N);
        for (let i = 0; i < N; i++) { let sx = 0, sy = 0;
          for (let j = 0; j < N; j++) if (j !== i) { const two = Float64Array.from([s[4 * i], s[4 * i + 1], s[4 * i + 2], s[4 * i + 3], s[4 * j], s[4 * j + 1], s[4 * j + 2], s[4 * j + 3]]), n2 = L13.step(two, 2); sx += n2[2] - al[4 * i + 2]; sy += n2[3] - al[4 * i + 3]; }
          const rx = ns[4 * i + 2] - al[4 * i + 2], ry = ns[4 * i + 3] - al[4 * i + 3]; sRes += rx * rx + ry * ry; sGap += (rx - sx) ** 2 + (ry - sy) ** 2; n++; }
        s = ns; } }
    facts['resid_rms_' + N] = 100 * Math.sqrt(sRes / n); facts['add_gap_' + N] = 100 * Math.sqrt(sGap / n); facts['add_gap_pct_' + N] = 100 * Math.sqrt(sGap / sRes);
  }
  ok('pair effects add to within 2 % of the effect at N = 3 and 8 % at N = 8', facts.add_gap_pct_3 < 2 && facts.add_gap_pct_8 < 8, [facts.add_gap_pct_3, facts.add_gap_pct_5, facts.add_gap_pct_8]);
}
lap('world checked');

/* ───────────────────────── 2 · the machinery ───────────────────────── */
{ // 2a. the network's analytic gradient against central differences
  const net = new L13.Net([4, 5, 4, 3], 9), rng = CY.rng(3), n = 7, X = new Float64Array(n * 4).map(() => 2 * rng() - 1), Y = new Float64Array(n * 3).map(() => 2 * rng() - 1);
  const loss = () => { const o = net.forward(X, n); let s = 0; for (let k = 0; k < o.length; k++) s += (o[k] - Y[k]) ** 2; return s; };
  net.zero(); const o = net.forward(X, n), d = new Float64Array(o.length); for (let k = 0; k < o.length; k++) d[k] = 2 * (o[k] - Y[k]); net.backward(d);
  let worst = 0; const eps = 1e-6;
  for (let l = 0; l < net.L; l++) { for (const arr of [[net.W[l], net.gW[l]], [net.b[l], net.gb[l]]]) for (let i = 0; i < arr[0].length; i++) { const w0 = arr[0][i]; arr[0][i] = w0 + eps; const lp = loss(); arr[0][i] = w0 - eps; const lm = loss(); arr[0][i] = w0; const num = (lp - lm) / (2 * eps); worst = Math.max(worst, Math.abs(num - arr[1][i]) / Math.max(1e-6, Math.abs(num) + Math.abs(arr[1][i]))); } }
  facts.grad_check = worst; ok('analytic gradient = finite differences (relative error < 1e-5)', worst < 1e-5, worst);
}
{ // 2b. the pairwise prediction is alone(s_i) + sum over senders of phi(sender seen from i): an explicit double loop with single-row forward passes
  const pm = new L13.Pair(16, 4), N = 5, S = L13.scene(N, CY.rng(8), L13.WIN), P = pm.predict(S, N), A = L13.stepAlone(S, N); let worst = 0;
  for (let i = 0; i < N; i++) { const e = [0, 0, 0, 0];
    for (let j = 0; j < N; j++) if (j !== i) { const row = Float64Array.from([(S[4 * j] - S[4 * i]) / 0.5, (S[4 * j + 1] - S[4 * i + 1]) / 0.5, (S[4 * j + 2] - S[4 * i + 2]) / 1.5, (S[4 * j + 3] - S[4 * i + 3]) / 1.5]), m = pm.phi.forward(row, 1); for (let c = 0; c < 4; c++) e[c] += m[c]; }
    const want = [A[4 * i] + 0.02 * e[0], A[4 * i + 1] + 0.02 * e[1], A[4 * i + 2] + 0.3 * e[2], A[4 * i + 3] + 0.3 * e[3]];
    for (let c = 0; c < 4; c++) worst = Math.max(worst, Math.abs(P[4 * i + c] - want[c])); }
  ok('Pair.predict = one-ball model + sum of phi over the senders', worst < 1e-12, worst);
}
{ // 2c. parameter counts against their formulas
  facts.pair_params = new L13.Pair(16, 1).nParams();
  ok('phi: 4 -> 16 -> 16 -> 4 has 420 parameters', facts.pair_params === 4 * 16 + 16 + 16 * 16 + 16 + 16 * 4 + 4);
  for (const N of [2, 3, 4, 5, 6, 8, 10]) { const f = new L13.Flat(N, 16, 1).nParams(); ok('flat net for N = ' + N + ': 64 (N - 1) + 356 parameters', f === 64 * (N - 1) + 356, f); facts['flat_params_' + N] = f; ok('phi does not depend on N', new L13.Pair(16, 1).nParams() === facts.pair_params); }
  const fact = (n) => n <= 1 ? 1 : n * fact(n - 1);
  for (const N of [3, 5, 6, 8, 10]) facts['orders_' + N] = fact(N - 1);
  for (const N of [3, 5, 6, 8, 10]) facts['msgs_' + N] = N * (N - 1);
  facts.msgs_1000 = 1000 * 999;                                                        // a thousand particles, every ordered pair
  facts.macs_pair_10 = new L13.Pair(16, 1).macs(10); facts.macs_msg = 4 * 16 + 16 * 16 + 16 * 4;
  ok('multiply-adds per message from the architecture', facts.macs_msg === 384 && facts.macs_pair_10 === 90 * 384);
}
lap('machinery checked');

/* ───────────────────────── 3 · the lab protocol: train, examine ───────────────────────── */
const lab = L13.lab();
ok('protocol: 800 scenes of 3 balls, 5 steps each', lab.D.n === 4000 && lab.D.N === 3);
for (let c = 0; c < 6; c++) lab.train('pair', 1000);
for (let c = 0; c < 6; c++) lab.train('flat', 1000);
lap('trained both');
// the exam, re-implemented per scene with the models' one-scene predictors
function examIndep(pred, N, seed, nSc) {
  let e1 = 0, e10 = 0, n1 = 0, n10 = 0;
  for (let q = 0; q < nSc; q++) {
    const S0 = L13.scene(N, CY.rng(seed * 1009 + q + 1), { ww: 2.4, wh: 1.6, fixed: true }); let truth = Float64Array.from(S0), free = Float64Array.from(S0);
    for (let t = 0; t < 10; t++) { const nt = L13.step(truth, N), p1 = pred(truth); for (let i = 0; i < N; i++) { e1 += Math.hypot(p1[4 * i] - nt[4 * i], p1[4 * i + 1] - nt[4 * i + 1]); n1++; } free = pred(free); truth = nt; }
    for (let i = 0; i < N; i++) { e10 += Math.hypot(free[4 * i] - truth[4 * i], free[4 * i + 1] - truth[4 * i + 1]); n10++; }
  }
  return { one: 100 * e1 / n1, ten: 100 * e10 / n10 };
}
const NS = [2, 3, 4, 5, 6, 7, 8, 9, 10];
const EX = {};
for (const N of NS) {
  EX[N] = { blind: lab.exam('blind', N), flat: lab.exam('flat', N), pair: lab.exam('pair', N) };
  if (N === 3 || N === 7) {
    const b = examIndep((s) => L13.stepAlone(s, N), N, 21, 100), f = examIndep((s) => lab.flat.predict(s, N), N, 21, 100), p = examIndep((s) => lab.pair.predict(s, N), N, 21, 100);
    ok('exam metric (blind, N = ' + N + ') equals the per-scene loop', close(b.one, EX[N].blind.one, 1e-9) && close(b.ten, EX[N].blind.ten, 1e-9), [b, EX[N].blind]);
    ok('exam metric (flat, N = ' + N + ') equals the per-scene loop', close(f.one, EX[N].flat.one, 1e-9) && close(f.ten, EX[N].flat.ten, 1e-9), [f, EX[N].flat]);
    ok('exam metric (pair, N = ' + N + ') equals the per-scene loop', close(p.one, EX[N].pair.one, 1e-9) && close(p.ten, EX[N].pair.ten, 1e-9), [p, EX[N].pair]);
  }
  for (const w of ['blind', 'flat', 'pair']) { facts[w + '_one_' + N] = EX[N][w].one; facts[w + '_ten_' + N] = EX[N][w].ten; }
}
for (const N of NS.slice(1)) {
  ok('pairwise rule beats the one-ball model at every N (ten steps, factor >= 3 for N >= 3)', EX[N].pair.ten * 3 <= EX[N].blind.ten, [N, EX[N].pair.ten, EX[N].blind.ten]);
  ok('and one step', EX[N].pair.one < EX[N].blind.one, [N, EX[N].pair.one, EX[N].blind.one]);
}
ok('the pairwise error grows slowly and steadily with N (monotone up to 5 % noise)', NS.slice(1).every((N, i, a) => i === 0 || EX[N].pair.ten >= 0.95 * EX[a[i - 1]].pair.ten), NS.map((N) => EX[N].pair.ten));
ok('at the training size the flat net is as good as the pairwise rule (within 40 %)', EX[3].flat.ten < 1.4 * EX[3].pair.ten, [EX[3].flat.ten, EX[3].pair.ten]);
ok('beyond it the cropped flat net is close to knowing nothing about the neighbours (N = 8: within 20 % of the blind error)', EX[8].flat.ten > 0.8 * EX[8].blind.ten, [EX[8].flat.ten, EX[8].blind.ten]);
facts.cut10 = 100 * (EX[10].blind.ten - EX[10].pair.ten) / EX[10].blind.ten;
facts.ratio10 = EX[10].blind.ten / EX[10].pair.ten; facts.ratio5 = EX[5].blind.ten / EX[5].pair.ten; facts.ratio3 = EX[3].blind.ten / EX[3].pair.ten;
// permutation sensitivity (the exam scenes themselves, 60 of them)
const SC3 = lab.scenes(3).slice(0, 60);
facts.perm_flat_3 = lab.sens('flat', 3); facts.perm_pair_3 = lab.sens('pair', 3);
ok('flat net depends on the order of the balls (more than 1 cm/s at N = 3)', facts.perm_flat_3 > 1, facts.perm_flat_3);
for (const N of [3, 5, 8]) { const sc = lab.scenes(N).slice(0, 30), v = L13.permSens((s) => lab.pair.predict(s, N), N, sc, 11); ok('pairwise rule: relabelling the balls relabels the answer (N = ' + N + ')', v < 1e-9, v); facts['perm_pair_' + N] = v; }
{ // an explicit relabelling check, ball by ball, on one scene
  const N = 6, S = L13.scene(N, CY.rng(41), L13.WIN), perm = [3, 0, 5, 1, 4, 2], P = lab.pair.predict(S, N), Q = lab.pair.predict(L13.relabel(S, perm), N); let worst = 0;
  for (let k = 0; k < N; k++) for (let c = 0; c < 4; c++) worst = Math.max(worst, Math.abs(Q[4 * k + c] - P[4 * perm[k] + c]));
  ok('explicit relabelling of six balls', worst < 1e-12, worst);
}
lap('exam + equivariance');

/* ───────────────────────── 4 · robustness over initialisations; the roads ───────────────────────── */
{ // eight initialisations of both models (the lab's pairwise rule is seed 6 and its flat net seed 2): the claims do not hang on one seed
  const rows = [];
  for (let sd = 1; sd <= 8; sd++) {
    const pm = sd === 6 ? lab.pair : new L13.Pair(16, sd), fm = sd === 2 ? lab.flat : new L13.Flat(3, 16, sd);
    if (sd !== 6) for (let c = 0; c < 6; c++) L13.train(pm, lab.D, 1000, lab.opt);
    if (sd !== 2) for (let c = 0; c < 6; c++) L13.train(fm, lab.D, 1000, lab.opt);
    const r = {}; for (const N of [3, 10]) { const sc = lab.scenes(N); r[N] = { pair: L13.exam((SB, B) => pm.predictB(SB, B, N), N, sc), flat: L13.exam((SB, B) => fm.predictB(SB, B, N), N, sc), blind: EX[N].blind }; }
    rows.push(r);
  }
  const lohi = (f) => { const v = rows.map(f); return [Math.min(...v), Math.max(...v)]; };
  [facts.pair_ten3_lo, facts.pair_ten3_hi] = lohi((r) => r[3].pair.ten); [facts.pair_ten10_lo, facts.pair_ten10_hi] = lohi((r) => r[10].pair.ten); [facts.flat_ten3_lo, facts.flat_ten3_hi] = lohi((r) => r[3].flat.ten);
  rows.forEach((r, i) => { ok('init ' + (i + 1) + ': the pairwise rule beats the one-ball model by 3x at N = 10', r[10].pair.ten * 3 < r[10].blind.ten, [r[10].pair.ten, r[10].blind.ten]); ok('init ' + (i + 1) + ': the cropped flat net is within 25 % of the blind error at N = 10', r[10].flat.ten > 0.75 * r[10].blind.ten, [r[10].flat.ten, r[10].blind.ten]); });
  ok('the flat net shown (init 2) is the best of the eight at N = 3', rows[1][3].flat.ten === facts.flat_ten3_lo, [rows[1][3].flat.ten, facts.flat_ten3_lo]);
  facts.pair_rank3 = 1 + rows.filter((r) => r[3].pair.ten < rows[5][3].pair.ten).length;          // rank (1 = best) of the pairwise rule shown (init 6) among its eight
  ok('the pairwise rule shown (init 6) is neither the best nor the worst of its eight at N = 3 (the page says it is third best)', facts.pair_rank3 === 3, facts.pair_rank3);
  facts.flat_rank3 = 1 + rows.filter((r) => r[3].flat.ten < rows[1][3].flat.ten).length;
  ok('the flat net shown ranks first of its eight', facts.flat_rank3 === 1, facts.flat_rank3);
  ok('the flat net is the more erratic learner: its eight errors at N = 3 span more than 2x, the pairwise rule\'s less than 1.5x', facts.flat_ten3_hi > 2 * facts.flat_ten3_lo && facts.pair_ten3_hi < 1.5 * facts.pair_ten3_lo, [facts.flat_ten3_lo, facts.flat_ten3_hi, facts.pair_ten3_lo, facts.pair_ten3_hi]);
  lap('eight initialisations');
}
{ // road: the flat net with a canonical order: each receiver sees its K = 2 nearest senders, nearest first (own implementation of the rows and of the prediction)
  const K = 2, RX = 0.02, RV = 0.3, dist2 = (S, i, j) => (S[4 * i] - S[4 * j]) ** 2 + (S[4 * i + 1] - S[4 * j + 1]) ** 2;
  function rowsOf(SB, B, N, order) {                                       // B scenes of N balls -> B*N rows of 4K numbers
    const X = new Float64Array(B * N * K * 4);
    for (let b = 0; b < B; b++) {
      const S = SB.subarray(4 * N * b, 4 * N * (b + 1));
      for (let i = 0; i < N; i++) {
        const js = []; for (let j = 0; j < N; j++) if (j !== i) js.push(j);
        if (order === 'near') js.sort((p, q) => dist2(S, i, p) - dist2(S, i, q) || p - q);
        for (let k = 0; k < K; k++) {
          const o = ((b * N + i) * K + k) * 4;
          if (k < js.length) { const j = js[k]; X[o] = (S[4 * j] - S[4 * i]) / 0.5; X[o + 1] = (S[4 * j + 1] - S[4 * i + 1]) / 0.5; X[o + 2] = (S[4 * j + 2] - S[4 * i + 2]) / 1.5; X[o + 3] = (S[4 * j + 3] - S[4 * i + 3]) / 1.5; }
          else { X[o] = 3.2; X[o + 1] = 2; }                                  // far-away dummy, as the engine pads
        }
      }
    }
    return X;
  }
  const predOf = (fm, order) => (SB, B, N) => { const out = fm.net.forward(rowsOf(SB, B, N, order), B * N), A = L13.stepAloneB(SB, B, N), T = new Float64Array(SB.length);
    for (let k = 0; k < SB.length / 4; k++) { T[4 * k] = A[4 * k] + RX * out[4 * k]; T[4 * k + 1] = A[4 * k + 1] + RX * out[4 * k + 1]; T[4 * k + 2] = A[4 * k + 2] + RV * out[4 * k + 2]; T[4 * k + 3] = A[4 * k + 3] + RV * out[4 * k + 3]; } return T; };
  { // the index-order rows and this predictor reproduce the engine's flat net exactly (N = 3 and a cropped N = 5)
    let worst = 0;
    for (const N of [3, 5]) { const SB = Float64Array.from(lab.scenes(N).slice(0, 4).flatMap((tr) => Array.from(tr[0]))), a = predOf(lab.flat, 'index')(SB, 4, N), b = lab.flat.predictB(SB, 4, N); for (let k = 0; k < a.length; k++) worst = Math.max(worst, Math.abs(a[k] - b[k])); }
    ok('own predictor on index-order rows = the engine\'s flat net', worst < 1e-12, worst);
  }
  const D = lab.D, D2 = { S: D.S, S1: D.S1, Y: D.Y, n: D.n, N: 3, X: rowsOf(D.S, D.n, 3, 'near') };
  ok('at N = 3 the sorted rows are the same numbers as the index-order rows, receiver by receiver, up to the order of the two senders', (() => { const A = rowsOf(D.S, 50, 3, 'index'), B = rowsOf(D.S, 50, 3, 'near'); for (let r = 0; r < 150; r++) { const a = [A.slice(8 * r, 8 * r + 4).join(), A.slice(8 * r + 4, 8 * r + 8).join()].sort().join('|'), b = [B.slice(8 * r, 8 * r + 4).join(), B.slice(8 * r + 4, 8 * r + 8).join()].sort().join('|'); if (a !== b) return false; } return true; })());
  const sres = [];
  for (let sd = 1; sd <= 8; sd++) {
    const fm = new L13.Flat(3, 16, sd); for (let c = 0; c < 6; c++) L13.train(fm, D2, 1000, lab.opt);
    const pr = predOf(fm, 'near'), r = {};
    for (const N of [3, 5, 8, 10]) r['t' + N] = L13.exam((SB, B) => pr(SB, B, N), N, lab.scenes(N)).ten;
    r.perm = L13.permSens((S) => pr(S, 1, 3), 3, lab.scenes(3).slice(0, 60), 3);
    sres.push(r);
  }
  const lohi2 = (key) => { const v = sres.map((r) => r[key]); return [Math.min(...v), Math.max(...v)]; };
  for (const N of [3, 5, 8, 10]) [facts['sort_ten' + N + '_lo'], facts['sort_ten' + N + '_hi']] = lohi2('t' + N);
  facts.sort_perm_3 = Math.max(...sres.map((r) => r.perm));
  ok('the sorted flat net is equivariant (relabelling changes its answer by less than 1e-9 cm/s)', facts.sort_perm_3 < 1e-9, facts.sort_perm_3);
  ok('at the training size every sorted init is better than every pairwise init (N = 3)', facts.sort_ten3_hi < facts.pair_ten3_lo, [facts.sort_ten3_hi, facts.pair_ten3_lo]);
  ok('at N = 10 every sorted init is worse than every pairwise init, and still far better than the one-ball model', facts.sort_ten10_lo > facts.pair_ten10_hi && facts.sort_ten10_hi < 0.4 * EX[10].blind.ten, [facts.sort_ten10_lo, facts.pair_ten10_hi, facts.sort_ten10_hi, EX[10].blind.ten]);
  ok('the sorted flat net is the steadier learner: its eight errors at N = 3 span less than 1.5x', facts.sort_ten3_hi < 1.5 * facts.sort_ten3_lo, [facts.sort_ten3_lo, facts.sort_ten3_hi]);
  { // how often a ball touches three or more others at once (the cap of K = 2 senders), in the exam scenes
    for (const N of [3, 10]) { let touch = 0, ge3 = 0; for (const tr of lab.scenes(N)) for (let t = 0; t < 10; t++) { const S = tr[t]; for (let i = 0; i < N; i++) { let k = 0; for (let j = 0; j < N; j++) if (j !== i && dist2(S, i, j) < (2 * RHO) ** 2) k++; if (k) touch++; if (k >= 3) ge3++; } } facts['multi3_' + N] = touch ? 100 * ge3 / touch : 0; }
  }
  lap('sorted flat nets');
}
{ // road: retrain the flat net at every N with the same data and steps
  for (const N of [5, 8]) {
    const D = L13.makeData(N, 800, 5, 11 + N, L13.WIN), fm = new L13.Flat(N, 16, 2);
    for (let c = 0; c < 6; c++) L13.train(fm, D, 1000, lab.opt);
    const e = L13.exam((SB, B) => fm.predictB(SB, B, N), N, lab.scenes(N)); facts['flat_own_ten_' + N] = e.ten; facts['flat_own_one_' + N] = e.one;
    facts['flat_own_perm_' + N] = L13.permSens((s) => fm.predict(s, N), N, lab.scenes(N).slice(0, 60), 5);
    ok('flat net retrained at N = ' + N + ' is still far from the pairwise rule (ten-step error more than 2x)', e.ten > 2 * EX[N].pair.ten, [e.ten, EX[N].pair.ten]);
  }
  lap('flat retrained per N');
}
{ // road: average the messages instead of summing them
  const pm = new L13.Pair(16, 6, 'mean'); for (let c = 0; c < 6; c++) L13.train(pm, lab.D, 1000, lab.opt);
  for (const N of [3, 8]) { const e = L13.exam((SB, B) => pm.predictB(SB, B, N), N, lab.scenes(N)); facts['mean_ten_' + N] = e.ten; facts['mean_one_' + N] = e.one; }
  ok('averaging is as good as summing at N = 3 (within 30 %)', facts.mean_ten_3 < 1.3 * EX[3].pair.ten + 0.5, [facts.mean_ten_3, EX[3].pair.ten]);
  ok('and fails at N = 8 (at least 2.5x the summed rule)', facts.mean_ten_8 > 2.5 * EX[8].pair.ten, [facts.mean_ten_8, EX[8].pair.ten]);
  lap('mean aggregation');
}
facts.share_contact_3 = 0; { // how many one-second futures of three balls contain a contact at all
  let c = 0; const sc = lab.scenes(3); for (const tr of sc) { let any = false; for (const S of tr) for (let i = 0; i < 3; i++) for (let j = i + 1; j < 3; j++) if (Math.hypot(S[4 * i] - S[4 * j], S[4 * i + 1] - S[4 * j + 1]) < 2 * RHO) any = true; if (any) c++; }
  facts.share_contact_3 = 100 * c / sc.length; }
{ // closed form for the entry: the probability that the shells of two balls overlap at some step of a second is about the area swept over the room: only a measured share is quoted
  let c = 0; const sc = lab.scenes(2); for (const tr of sc) { let any = false; for (const S of tr) if (Math.hypot(S[0] - S[4], S[1] - S[5]) < 2 * RHO) any = true; if (any) c++; } facts.share_contact_2 = 100 * c / sc.length;
}


/* ───────────────────────── 5 · binding: who is who after the curtain ───────────────────────── */
const CURT = [2.6, 3.4], SO = 0.1, XL = 1.4, W0 = CY.world({});
const hiddenAt = (x) => x > CURT[0] && x < CURT[1];
/* the curtain trial, written out again (the same order of random draws as the engine's, which is what makes the comparison exact) */
function trial(N, b, rng, T) {
  const v0 = 1.0 + 0.8 * rng(), S0 = [];
  for (let i = 0; i < N; i++) {
    const fromLeft = i < N / 2, x = fromLeft ? XL : 6 - XL, y = N === 2 ? (fromLeft ? 2.5 - b / 2 : 2.5 + b / 2) : 1.5 + 2.0 * rng();
    const speed = N === 2 ? (fromLeft ? v0 : v0 * (1 + 0.3 * (rng() - 0.5))) : 1.0 + 0.8 * rng();
    S0.push(x, y, (fromLeft ? 1 : -1) * speed, 0);
  }
  const tr = [Float64Array.from(S0)]; for (let t = 0; t < T; t++) tr.push(L13.step(tr[t], N));
  const det = tr.map((s) => { const z = []; for (let k = 0; k < N; k++) z.push(hiddenAt(s[4 * k]) ? null : [s[4 * k] + SO * CY.randn(rng), s[4 * k + 1] + SO * CY.randn(rng)]); return z; });
  return { tr, det };
}
/* the belief of one axis by the shared engine's generic Kalman filter (lesson 2), against the engine's unrolled version */
function beliefAxis(zs) {
  const model = CY.kf.axisModel(W0, 0.01, SO); let st = { x: Float64Array.from([zs[0], 0]), P: Float64Array.from([SO * SO, 0, 0, 4]) };
  for (let i = 1; i < zs.length; i++) st = CY.kf.update(model, CY.kf.predict(model, st), [zs[i]]);
  return [st.x[0], st.x[1]];
}
function slotsOf(t, N) {
  let tE = 1; while (tE < t.det.length && t.det[tE].every((z) => z)) tE++;
  const t0 = tE - 1; let tx = tE; while (tx < t.det.length && !t.det[tx].every((z) => z)) tx++;
  const S = new Float64Array(4 * N);
  for (let i = 0; i < N; i++) { const xs = [], ys = []; for (let u = 0; u <= t0; u++) { xs.push(t.det[u][i][0]); ys.push(t.det[u][i][1]); } const fx = beliefAxis(xs), fy = beliefAxis(ys); S[4 * i] = fx[0]; S[4 * i + 1] = fy[0]; S[4 * i + 2] = fx[1]; S[4 * i + 3] = fy[1]; }
  return { t0, tx: tx < t.det.length ? tx : -1, S };
}
const sq = (a, b) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2;
function priorOf(kind, sl, N, model) {
  let s = sl.S; if (kind !== 'map') for (let u = sl.t0; u < sl.tx; u++) s = kind === 'free' ? L13.step(s, N, { alone: true }) : kind === 'world' ? L13.step(s, N) : model.predict(s, N);
  return Array.from({ length: N }, (_, i) => [s[4 * i], s[4 * i + 1]]);
}
/* the three rules, again: nearest, competition (matrix form), optimal (permutations by Heap's algorithm) */
function ruleNN(P, Z) { return Z.map((z) => { let b = 0; for (let k = 1; k < P.length; k++) if (sq(P[k], z) < sq(P[b], z)) b = k; return b; }); }
function ruleComp(P, Z, tau, rounds) {
  const K = P.length, M = Z.length; let mu = P.map((p) => p.slice()), A = null;
  for (let r = 0; r < rounds; r++) {
    A = Array.from({ length: M }, (_, d) => { const e = mu.map((m) => Math.exp(-sq(m, Z[d]) / (2 * tau * tau))), z = e.reduce((a, b) => a + b, 0); return e.map((v) => v / z); });
    mu = mu.map((m, k) => { let w = 0, x = 0, y = 0; for (let d = 0; d < M; d++) { w += A[d][k]; x += A[d][k] * Z[d][0]; y += A[d][k] * Z[d][1]; } return w > 1e-9 ? [x / w, y / w] : m; });
  }
  return A.map((row) => row.indexOf(Math.max(...row)));
}
function ruleOpt(P, Z) {
  const n = P.length, a = Array.from({ length: n }, (_, i) => i); let best = Infinity, bp = null;
  const cost = (perm) => perm.reduce((s, slot, d) => s + sq(P[slot], Z[d]), 0);
  (function heap(k) { if (k === 1) { const c = cost(a); if (c < best) { best = c; bp = a.slice(); } return; } for (let i = 0; i < k; i++) { heap(k - 1); const j = k % 2 === 0 ? i : 0; [a[j], a[k - 1]] = [a[k - 1], a[j]]; } })(n);
  return bp;
}
{ // the engine's rules against these, on random scatterings (the optimum can tie, so compare its cost)
  const rng = CY.rng(61); let bad = 0, badOpt = 0;
  for (let q = 0; q < 300; q++) {
    const N = 2 + (q % 4), P = Array.from({ length: N }, () => [3 * rng(), 2 * rng()]), Z = Array.from({ length: N }, () => [3 * rng(), 2 * rng()]);
    if (L13.assign('nn', P, Z).join() !== ruleNN(P, Z).join()) bad++;
    if (L13.assign('comp', P, Z).join() !== ruleComp(P, Z, 0.25, 4).join()) bad++;
    const a = L13.assign('opt', P, Z), b = ruleOpt(P, Z), c = (p) => p.reduce((s, slot, d) => s + sq(P[slot], Z[d]), 0);
    if (Math.abs(c(a) - c(b)) > 1e-12) badOpt++;
  }
  ok('assignment rules: the engine and the oracle choose the same slots (nearest, competition) and the same optimal cost', bad === 0 && badOpt === 0, [bad, badOpt]);
}
{ // the unrolled Kalman filter equals the generic one on a trial's detections
  const rng = CY.rng(5); let worst = 0;
  for (let q = 0; q < 20; q++) { const t = trial(2, 0.4 * (rng() - 0.5), rng, 60), a = slotsOf(t, 2), e = L13.belief({ N: 2, det: t.det });
    ok('same t0, tx', a.t0 === e.t0 && a.tx === e.tx, [a.t0, e.t0, a.tx, e.tx]); for (let k = 0; k < 8; k++) worst = Math.max(worst, Math.abs(a.S[k] - e.S[k])); }
  facts.kf_equiv = worst; ok('engine belief = the generic Kalman filter of lesson 2 (1e-9)', worst < 1e-9, worst);
}
const KINDS = ['map', 'free', 'world', 'pair'], RULES = { nn: (P, Z) => ruleNN(P, Z), comp: (P, Z) => ruleComp(P, Z, 0.25, 4), opt: (P, Z) => ruleOpt(P, Z) };
function runId(N, nTrials, seed, T, bOf, model) {
  const rng = CY.rng(seed), acc = {}; let n = 0, bounce = 0;
  KINDS.forEach((k) => { acc[k] = { nn: 0, comp: 0, opt: 0 }; });
  for (let q = 0; q < nTrials; q++) {
    const b = bOf(rng), t = trial(N, b, rng, T), sl = slotsOf(t, N); if (sl.tx < 0) continue; n++;
    if (N === 2 && t.tr[sl.tx][0] < t.tr[sl.tx][4]) bounce++;
    KINDS.forEach((k) => { const P = priorOf(k, sl, N, model); for (const r of Object.keys(RULES)) if (RULES[r](P, t.det[sl.tx]).every((s, d) => s === d)) acc[k][r]++; });
  }
  KINDS.forEach((k) => { for (const r of Object.keys(RULES)) acc[k][r] = 100 * acc[k][r] / n; });
  return { n, bounce: 100 * bounce / n, acc };
}
{ // N = 2, b uniform in +-0.5 m
  const R = runId(2, 2000, 5, 60, (rng) => rng() - 0.5, lab.pair);
  facts.id_trials = 2000; facts.id_valid = R.n; facts.bounce_pct = R.bounce; facts.pass_pct = 100 - R.bounce;
  for (const k of KINDS) for (const r of ['nn', 'comp']) facts['id_' + k + '_' + r] = R.acc[k][r];
  ok('a map is right exactly when the balls bounce (accuracy within 3 points of the bounce share)', Math.abs(R.acc.map.nn - R.bounce) < 3, [R.acc.map.nn, R.bounce]);
  ok('free flight is right exactly when they pass (within 3 points of the pass share)', Math.abs(R.acc.free.nn - (100 - R.bounce)) < 3, [R.acc.free.nn, 100 - R.bounce]);
  ok('map and free flight together account for 100 % (to 3 points)', Math.abs(R.acc.map.nn + R.acc.free.nn - 100) < 3, [R.acc.map.nn + R.acc.free.nn]);
  ok('the interaction-aware prior (true physics) keeps names in at least 93 % of trials', R.acc.world.nn > 93 && R.acc.world.comp > 93, R.acc.world);
  ok('the learned pairwise rule keeps names as well as the true physics (within 3 points)', Math.abs(R.acc.pair.comp - R.acc.world.comp) < 3 && Math.abs(R.acc.pair.nn - R.acc.world.nn) < 3, [R.acc.pair, R.acc.world]);
  ok('with two points competition and nearest differ by at most 4 points', ['map', 'free', 'world', 'pair'].every((k) => Math.abs(R.acc[k].comp - R.acc[k].nn) < 4), R.acc);
}
{ // a crowd: two balls from each side at random heights
  const R = runId(4, 800, 6, 100, () => 0, lab.pair);
  facts.crowd_valid = R.n; for (const k of KINDS) for (const r of ['nn', 'comp', 'opt']) facts['crowd_' + k + '_' + r] = R.acc[k][r];
  ok('crowd: the learned prior with competition is at least 10 points better than nearest, and within 8 of optimal', R.acc.pair.comp > R.acc.pair.nn + 10 && R.acc.pair.opt - R.acc.pair.comp < 8, R.acc.pair);
  ok('crowd: the interaction-aware prior beats free flight beats the map', R.acc.pair.comp > R.acc.free.comp && R.acc.free.comp > R.acc.map.comp, [R.acc.pair.comp, R.acc.free.comp, R.acc.map.comp]);
  const R6 = runId(6, 400, 7, 100, () => 0, lab.pair); facts.crowd6_valid = R6.n; facts.crowd6_world_opt = R6.acc.world.opt; facts.crowd6_pair_comp = R6.acc.pair.comp; facts.crowd6_free_comp = R6.acc.free.comp;
  ok('six balls: even the true physics with the optimal matching keeps names in under 45 % of trials', R6.acc.world.opt < 45, R6.acc.world);
}
{ // the widget's grid of offsets: the engine's idStats against this implementation on the same seeds (60 trials; seed 1000 N + index)
  const bis = [0, 4, 10];
  for (const bi of bis) {
    const st = lab.idStats(2, bi), R = runId(2, 60, 2000 + bi, 60, () => lab.BG[bi], lab.pair);
    ok('widget grid b = ' + lab.BG[bi] + ': trials and bounce share', st.n === R.n && close(100 * st.bounce, R.bounce, 1e-9), [st.n, R.n]);
    for (const k of KINDS) { ok('widget grid b = ' + lab.BG[bi] + ', ' + k, close(100 * st.acc[k].nn, R.acc[k].nn, 1e-9) && close(100 * st.acc[k].comp, R.acc[k].comp, 1e-9), [st.acc[k], R.acc[k]]); for (const r of ['nn', 'comp']) facts['g' + bi + '_' + k + '_' + r] = R.acc[k][r]; }
    facts['g' + bi + '_n'] = R.n; facts['g' + bi + '_bounce'] = R.bounce;
  }
  ok('head on (b = 0) the map is right and free flight wrong; far off (b = 0.5) the other way round', facts.g0_map_nn > 95 && facts.g0_free_nn < 5 && facts.g10_free_nn > 95 && facts.g10_map_nn < 5, [facts.g0_map_nn, facts.g0_free_nn, facts.g10_free_nn, facts.g10_map_nn]);
}
{ // the interaction-aware prior is not perfect because of the belief that starts it: started from the exact state of the trial it keeps every name
  const rng = CY.rng(5); let n = 0, okBelief = 0, okExact = 0;
  for (let q = 0; q < 2000; q++) {
    const t = trial(2, rng() - 0.5, rng, 60), sl = slotsOf(t, 2); if (sl.tx < 0) continue; n++;
    const Z = t.det[sl.tx]; let s = t.tr[sl.t0]; for (let u = sl.t0; u < sl.tx; u++) s = L13.step(s, 2);
    if (RULES.comp([[s[0], s[1]], [s[4], s[5]]], Z).every((k, d) => k === d)) okExact++;
    if (RULES.comp(priorOf('world', sl, 2, null), Z).every((k, d) => k === d)) okBelief++;
  }
  facts.id_world_exact = 100 * okExact / n;
  ok('started from the exact state (no filter noise) the true-physics prior with competition keeps every name (at least 99.5 % of the trials)', facts.id_world_exact >= 99.5, facts.id_world_exact);
  ok('the pooled experiment above is the same experiment (same seed, same trials)', n === facts.id_valid && close(100 * okBelief / n, facts.id_world_comp, 1e-9), [n, facts.id_valid, 100 * okBelief / n, facts.id_world_comp]);
}
{ // the example trial the widget draws is typical: one that finishes with the true-physics prior right where most trials finish, one that does not finish where most do not
  for (const bi of [0, 2, 6, 10]) { const e = lab.idExample(2, bi); ok('widget example at b = ' + lab.BG[bi] + ' is a finished trial in which the true-physics prior keeps both names', !!e.prior && e.assign.world.every((s, d) => s === d), e.assign && e.assign.world); }
  const e4 = lab.idExample(2, 4); ok('widget example at b = 0.2 is a trial that never finishes', !e4.prior && e4.bel.tx < 0, e4.bel);
}
{ // b = 0.2 m: why most trials never finish: the balls glance off sideways (up and down the court) and stay near the curtain
  const rng = CY.rng(2004); let bad = 0, side = 0;
  for (let q = 0; q < 60; q++) { const t = trial(2, lab.BG[4], rng, 60), sl = slotsOf(t, 2); if (sl.tx >= 0) continue; bad++; const s = t.tr[60];
    if (Math.abs(s[1] - s[5]) > 2 && Math.abs(s[0] - 3) < 0.9 && Math.abs(s[4] - 3) < 0.9) side++; }
  ok('b = 0.2 m: most trials never finish (the count agrees with the widget grid)', bad > 40 && bad === 60 - facts.g4_n, [bad, facts.g4_n]);
  ok('... the balls glance off sideways and stay near the curtain (at least 90 % of the unfinished trials end more than 2 m apart in height, both within 0.9 m of the curtain)', side >= 0.9 * bad, [side, bad]);
}
lap('binding');

/* ───────────────────────── 6 · the exit: video of nudged balls, labelled hours, the sampling bill ───────────────────────── */
{ // a hidden agent presses one of four buttons on a random ball with probability 0.3 per step; the video records states, not presses
  const N = 3, BTN = [0, 1, 2, 3].map((c) => [0.8 * Math.cos((30 + 90 * c) * Math.PI / 180), 0.8 * Math.sin((30 + 90 * c) * Math.PI / 180)]), d = Math.exp(-GAMMA * DT);
  function video(pKick, nScenes, seed) {
    const rng = CY.rng(seed), out = [];
    for (let q = 0; q < nScenes; q++) { let s = L13.scene(N, rng, { ww: 2.4, wh: 1.6, fixed: true });
      for (let t = 0; t < 5; t++) { const pushed = Float64Array.from(s); let who = -1, btn = -1;
        if (rng() < pKick) { who = Math.floor(rng() * N); btn = Math.floor(rng() * 4); pushed[4 * who + 2] += BTN[btn][0]; pushed[4 * who + 3] += BTN[btn][1]; }
        const ns = L13.step(pushed, N); out.push({ s, s1: ns, who, btn }); s = ns; } }
    return out;
  }
  const vErr2 = (P, T, i) => (P[4 * i + 2] - T[4 * i + 2]) ** 2 + (P[4 * i + 3] - T[4 * i + 3]) ** 2;
  const rms = (V, f) => { let s = 0, n = 0; for (const t of V) { const P = lab.pair.predict(t.s, N); for (let i = 0; i < N; i++) if (f(t, i)) { s += vErr2(P, t.s1, i); n++; } } return { rms: 100 * Math.sqrt(s / n), ss: s, n }; };
  const clean = rms(video(0, 400, 77), () => true), V = video(0.3, 400, 77), all = rms(V, () => true), kicked = rms(V, (t, i) => i === t.who), kicks = V.filter((t) => t.who >= 0).length;
  facts.nudge_clean = clean.rms; facts.nudge_all = all.rms; facts.nudge_share = 100 * kicked.ss / all.ss; facts.nudge_kicked = kicked.rms; facts.nudge_frac = 100 * kicks / V.length; facts.nudge_transitions = V.length;
  const floor = 100 * Math.sqrt((kicks / V.length / N) * (0.8 * d) ** 2); facts.nudge_floor = floor;
  ok('the error on the video is the nudges: rms error^2 = model error^2 + (p/N)(0.8 d)^2 to 5 %', Math.abs(all.rms ** 2 - (clean.rms ** 2 + floor ** 2)) / all.rms ** 2 < 0.05, [all.rms, clean.rms, floor]);
  ok('97 % or more of the squared error lies on the pressed balls', facts.nudge_share > 95, facts.nudge_share);
  // what-if: press button c on ball 1 of held-out states; the model has no label to learn the buttons from, so it answers "nothing"
  const held = lab.scenes(N); let sU = 0, sL = 0, nW = 0; const fit = [0, 1, 2, 3].map(() => ({ x: 0, y: 0, n: 0 }));
  const Vl = video(0.3, 1500, 78);
  for (const t of Vl) if (t.who >= 0 && fit[t.btn].n < 1) { const P = lab.pair.predict(t.s, N); fit[t.btn].x += (t.s1[4 * t.who + 2] - P[4 * t.who + 2]) / d; fit[t.btn].y += (t.s1[4 * t.who + 3] - P[4 * t.who + 3]) / d; fit[t.btn].n++; }
  const uhat = fit.map((f) => [f.x / f.n, f.y / f.n]);
  for (const tr of held) for (let t = 0; t < 5; t++) for (let c = 0; c < 4; c++) {
    const S = tr[t], pushed = Float64Array.from(S); pushed[6] += BTN[c][0]; pushed[7] += BTN[c][1]; const truth = L13.step(pushed, N);
    sU += vErr2(lab.pair.predict(S, N), truth, 1);
    const q = Float64Array.from(S); q[6] += uhat[c][0]; q[7] += uhat[c][1]; sL += vErr2(lab.pair.predict(q, N), truth, 1); nW++; }
  facts.whatif_none = 100 * Math.sqrt(sU / nW); facts.whatif_label1 = 100 * Math.sqrt(sL / nW); facts.push_cms = 100 * 0.8 * d;
  ok('without labels the answer to "what if I press" is wrong by the whole push (within 3 %)', Math.abs(facts.whatif_none - facts.push_cms) / facts.push_cms < 0.03, [facts.whatif_none, facts.push_cms]);
  ok('with one labelled press per button the answer is within 5 cm/s', facts.whatif_label1 < 5, facts.whatif_label1);
  lap('nudged video');
}
{ // arithmetic of the exit (inputs from the cited sources are the prose's; everything here is division)
  facts.tokens_frame = (256 / 16) ** 2; facts.frame_ms = 1000 / 24; facts.tok_ms = facts.frame_ms / facts.tokens_frame; facts.pass3_ms = facts.frame_ms / 3; facts.pass4_ms = facts.frame_ms / 4;
  facts.d4_ms = 1000 / 21; facts.d4_pass_ms = facts.d4_ms / 4; facts.d4_over_pct = 100 * (facts.d4_ms / facts.frame_ms - 1);
  facts.lab_share_pct = 100 * 100 / 2500; facts.vpt_gain = 70000 / 1962;
  facts.numbers_frame = 256 * 256 * 3; ok('a 256 x 256 RGB frame is 196,608 numbers and 256 tokens at patch 16', facts.numbers_frame === 196608 && facts.tokens_frame === 256);
}

/* ───────────────────────── 7 · the page's own widget, driven into the states the prose describes ───────────────────────── */
{
  const page = loadPage(path.join(DIR, '13_objects_and_interactions.html'), { console: { log() {}, warn() {}, error() {} } });
  ok('the page loads without a script error', page.problems.length === 0, page.problems);
  const nums = (id) => (page.text(id).match(/\d[\d,]*(?:\.\d+)?/g) || []).map((x) => parseFloat(x.replace(/,/g, '')));
  const near = (a, b, tol) => a.length === b.length && a.every((v, i) => Math.abs(v - b[i]) <= tol + 1e-9);
  const fact = (n) => n <= 1 ? 1 : n * fact(n - 1);
  page.set('w13-n', 5);
  ok('untrained: the models show a dash and the one-ball model its number', /—/.test(page.text('w13-ten')) && near(nums('w13-ten'), [EX[5].blind.ten], 0.05), page.text('w13-ten'));
  ok('untrained: the parameter readout is the pairwise count and the flat count for this N', near(nums('w13-par'), [420, 64 * 4 + 356], 0), page.text('w13-par'));
  for (let c = 0; c < 6; c++) page.click('w13-tp');
  for (let c = 0; c < 6; c++) page.click('w13-tf');
  ok('six clicks of 1000 steps each', near(nums('w13-steps'), [6000, 6000], 0), page.text('w13-steps'));
  for (const N of [2, 3, 5, 8, 10]) {
    page.set('w13-n', N);
    ok('widget, N = ' + N + ': ten-step errors (one-ball / flat / pairwise)', near(nums('w13-ten'), [EX[N].blind.ten, EX[N].flat.ten, EX[N].pair.ten], 0.05), [page.text('w13-ten'), EX[N]]);
    ok('widget, N = ' + N + ': one-step errors', near(nums('w13-one'), [EX[N].blind.one, EX[N].flat.one, EX[N].pair.one], 0.005), [page.text('w13-one'), EX[N]]);
    ok('widget, N = ' + N + ': parameters', near(nums('w13-par'), [420, 64 * (N - 1) + 356], 0), page.text('w13-par'));
    ok('widget, N = ' + N + ': orders and messages', near(nums('w13-ord'), [fact(N - 1), N * (N - 1)], 0), page.text('w13-ord'));
  }
  page.set('w13-n', 3);
  ok('widget: relabelling changes the pairwise answer by 0 and the flat net\'s by the lab figure', near(nums('w13-sens'), [0, facts.perm_flat_3], 0.05), page.text('w13-sens'));
  page.set('w13-mode', 'who');
  for (const bi of [0, 4, 10]) {
    page.set('w13-b', bi);
    ok('widget: the offset label', near(nums('w13-b-v'), [lab.BG[bi]], 0.005), page.text('w13-b-v'));
    for (const k of KINDS) ok('widget, who is who, b = ' + lab.BG[bi] + ', ' + k + ' (nearest / competition)', near(nums('w13-i-' + k), [facts['g' + bi + '_' + k + '_nn'], facts['g' + bi + '_' + k + '_comp']], 0.5), [page.text('w13-i-' + k)]);
    ok('widget, who is who, b = ' + lab.BG[bi] + ': trials and bounce share', near(nums('w13-i-n'), [facts['g' + bi + '_n'], facts['g' + bi + '_bounce']], 0.5), page.text('w13-i-n'));
  }
  page.click('w13-rs');
  ok('reset: no training steps and no trained numbers', near(nums('w13-steps'), [0, 0], 0) && /—/.test(page.text('w13-i-pair')), [page.text('w13-steps'), page.text('w13-i-pair')]);
  ok('the widget drew on its canvas', page.draws > 100, page.draws);
  lap('widget driven');
}

console.error(fails ? fails + ' check(s) FAILED' : 'sections 1-7 passed');
console.log(JSON.stringify({ facts }));
process.exit(fails ? 1 : 0);
